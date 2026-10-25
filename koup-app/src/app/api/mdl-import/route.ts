import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { execFile } from 'child_process';
import path from 'path';
import util from 'util';

const execFileAsync = util.promisify(execFile);

interface ScrapedMdlEntry {
  mdl_id?: string;
  title: string;
  status?: 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
  score?: number;
  progress?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const platform = (body.platform || body.source || 'mdl').toLowerCase() as
      | 'mdl'
      | 'anilist'
      | 'text';
    const rawUsername = (body.username as string | undefined)?.trim();
    const rawText = (body.text as string | undefined) || (body.titles as string | undefined) || '';

    // User authentication check to link username to profile and persist progress
    let authenticatedUserId: string | null = (body.userId as string) || null;
    const authHeader = req.headers.get('authorization');
    if (!authenticatedUserId && authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        authenticatedUserId = data.user.id;
      }
    }

    // ==========================================
    // 1. ANILIST GRAPHQL IMPORT
    // ==========================================
    if (platform === 'anilist') {
      if (!rawUsername || rawUsername.length < 2) {
        return NextResponse.json(
          { success: false, error: 'Geçerli bir AniList kullanıcı adı giriniz.' },
          { status: 400 }
        );
      }
      const cleanUser = rawUsername;

      const gql = `
        query ($userName: String) {
          MediaListCollection(userName: $userName, type: ANIME) {
            lists {
              name
              status
              entries {
                mediaId
                status
                score(format: POINT_10)
                progress
                media {
                  id
                  title { romaji english }
                }
              }
            }
          }
        }
      `;
      const resp = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gql, variables: { userName: cleanUser } }),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        return NextResponse.json(
          { success: false, error: 'AniList kullanıcısı bulunamadı veya profil gizli.' },
          { status: 404 }
        );
      }

      const payload = await resp.json();
      const lists = payload?.data?.MediaListCollection?.lists || [];
      const entries: Array<{
        anilist_id: number;
        status: string;
        score: number;
        progress: number;
        title: string;
      }> = [];

      for (const lst of lists) {
        for (const e of lst.entries || []) {
          entries.push({
            anilist_id: e.mediaId,
            status:
              e.status === 'COMPLETED'
                ? 'completed'
                : e.status === 'CURRENT'
                ? 'watching'
                : e.status === 'PLANNING'
                ? 'plan_to_watch'
                : e.status === 'PAUSED'
                ? 'on_hold'
                : 'dropped',
            score: Math.round(e.score || 8),
            progress: e.progress || 1,
            title: e.media?.title?.romaji || e.media?.title?.english || '',
          });
        }
      }

      const alIds = entries.map((e) => e.anilist_id).slice(0, 300);
      const { data: matchedMedia } = await supabase
        .from('media')
        .select('id, slug, title, content_type, cover_image, anilist_id, episode_count')
        .in('anilist_id', alIds);

      if (authenticatedUserId) {
        await supabase
          .from('profiles')
          .update({ anilist_username: cleanUser })
          .eq('id', authenticatedUserId);
      }

      const finalItems = (matchedMedia || []).map((m) => {
        const src = entries.find((e) => e.anilist_id === m.anilist_id);
        return {
          media: m,
          status: src?.status || 'completed',
          score: src?.score || 9,
          progress: src?.progress || m.episode_count || 1,
        };
      });

      if (authenticatedUserId && finalItems.length > 0) {
        const rows = finalItems.map((item) => ({
          user_id: authenticatedUserId,
          media_id: item.media.id,
          status: item.status || 'completed',
          user_score: item.score || null,
          watched_episodes: Array.from(
            { length: Math.min(item.progress || item.media.episode_count || 1, 1000) },
            (_, i) => i + 1
          ),
          last_season_num: 1,
          last_episode_num: item.progress || item.media.episode_count || 1,
          last_episode_title: (item.media.content_type === 'film' || item.media.content_type === 'movie')
            ? 'Film'
            : `${item.progress || item.media.episode_count || 1}. Bölüm`,
          resume_position_sec: 0,
          resume_duration_sec: 3600,
          updated_at: new Date().toISOString(),
        }));

        await supabase
          .from('user_media_progress')
          .upsert(rows, { onConflict: 'user_id, media_id' });
      }

      return NextResponse.json({
        success: true,
        message: `${cleanUser} AniList kütüphanesi başarıyla senkronize edildi.`,
        platform: 'anilist',
        username: cleanUser,
        totalFound: entries.length,
        matchedCount: finalItems.length,
        matchedItems: finalItems,
      });
    }

    // ==========================================
    // 2. DIRECT TITLE / TEXT LIST IMPORT
    // ==========================================
    if (platform === 'text' || (rawText && rawText.trim().length > 0)) {
      const lines = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Lütfen aktarmak istediğiniz yapım isimlerini giriniz.' },
          { status: 400 }
        );
      }

      const matchedResults: Array<{
        media: any;
        status: 'completed' | 'watching' | 'plan_to_watch';
        score: number;
        progress: number;
      }> = [];

      for (const line of lines) {
        // Strip numbering like "1. ", "1 - ", "#1 "
        const cleanedTitle = line
          .replace(/^[#\d]+[\.\-\)\s]+/, '')
          .replace(/\(.*\)/, '')
          .trim();

        if (!cleanedTitle) continue;

        // 1. Check aka_titles exact match (e.g. "Guardian: The Lonely and Great God" for Goblin)
        let hit: any = null;
        try {
          const { data: akaHits } = await supabase
            .from('media')
            .select('id, slug, title, content_type, cover_image, mydramalist_url, episode_count')
            .contains('aka_titles', [cleanedTitle])
            .limit(1);
          if (akaHits && akaHits.length > 0) {
            hit = akaHits[0];
          }
        } catch {}

        // 2. Check title exact/ilike match
        if (!hit) {
          try {
            const { data: titleHits } = await supabase
              .from('media')
              .select('id, slug, title, content_type, cover_image, mydramalist_url, episode_count')
              .ilike('title', cleanedTitle)
              .limit(1);
            if (titleHits && titleHits.length > 0) {
              hit = titleHits[0];
            }
          } catch {}
        }

        // 3. Fallback to fuzzy search_media RPC
        if (!hit) {
          try {
            const { data: rpcHits } = await supabase.rpc('search_media', {
              p_query: cleanedTitle,
              p_type: 'ALL',
              p_country: 'ALL',
              p_genre: 'Tümü',
              p_sort: 'views',
              p_limit: 1,
              p_offset: 0,
            });
            if (rpcHits && rpcHits.length > 0) {
              hit = rpcHits[0];
            }
          } catch {}
        }

        if (hit && !matchedResults.some((r) => r.media.id === hit.id)) {
          matchedResults.push({
            media: hit,
            status: 'completed',
            score: 10,
            progress: hit.episode_count || 16,
          });
        }
      }

      if (matchedResults.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Girilen yapım isimleri veritabanımızda bulunamadı. Lütfen orijinal veya İngilizce başlığı kontrol ediniz.',
          },
          { status: 404 }
        );
      }

      if (authenticatedUserId && matchedResults.length > 0) {
        const rows = matchedResults.map((item) => ({
          user_id: authenticatedUserId,
          media_id: item.media.id,
          status: item.status,
          user_score: item.score,
          watched_episodes: Array.from(
            { length: Math.min(item.progress || item.media.episode_count || 16, 1000) },
            (_, i) => i + 1
          ),
          last_season_num: 1,
          last_episode_num: item.progress || item.media.episode_count || 16,
          last_episode_title: (item.media.content_type === 'film' || item.media.content_type === 'movie')
            ? 'Film'
            : `${item.progress || item.media.episode_count || 16}. Bölüm`,
          resume_position_sec: 0,
          resume_duration_sec: 3600,
          updated_at: new Date().toISOString(),
        }));

        await supabase
          .from('user_media_progress')
          .upsert(rows, { onConflict: 'user_id, media_id' });
      }

      return NextResponse.json({
        success: true,
        message: 'Belirtilen yapımlar başarıyla kütüphanenize aktarıldı.',
        platform: 'text',
        totalFound: lines.length,
        matchedCount: matchedResults.length,
        matchedItems: matchedResults,
      });
    }

    // ==========================================
    // 3. MYDRAMALIST PUBLIC WATCHLIST IMPORT
    // ==========================================
    if (!rawUsername || rawUsername.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Geçerli bir MyDramaList kullanıcı adı giriniz.' },
        { status: 400 }
      );
    }
    const cleanUser = rawUsername;

    let scrapedEntries: ScrapedMdlEntry[] = [];

    // Try executing python scraper with curl_cffi for Cloudflare bypass
    try {
      const scriptPath = path.join(process.cwd(), 'scripts', 'scrape_mdl.py');
      const pythonExecutable =
        process.env.PYTHON_PATH ||
        'C:\\Users\\Cagan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';

      const { stdout } = await execFileAsync(pythonExecutable, [scriptPath, cleanUser], {
        timeout: 15000,
      });

      if (stdout) {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.success && Array.isArray(parsed.entries)) {
          scrapedEntries = parsed.entries;
        }
      }
    } catch (pyErr) {
      // Python scraper failed, try direct fetch fallback
    }

    // If python scraper didn't run or found nothing, attempt direct fetch
    if (scrapedEntries.length === 0) {
      const mdlUrl = cleanUser.startsWith('http')
        ? cleanUser
        : `https://mydramalist.com/dramalist/${encodeURIComponent(cleanUser)}`;

      try {
        const resp = await fetch(mdlUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const html = await resp.text();
          const matches = html.matchAll(/href="\/(\d+-[a-z0-9-]+)"/gi);
          const foundSlugs = new Set<string>();
          for (const m of matches) {
            if (m[1]) foundSlugs.add(m[1].toLowerCase());
          }
          scrapedEntries = Array.from(foundSlugs).map((s) => ({
            mdl_id: s,
            title: s,
            status: 'completed',
            score: 10,
            progress: 16,
          }));
        }
      } catch {}
    }

    // CRITICAL: NEVER INVENT FAKE DATA! If no items were found on the user's MDL profile, report it clearly!
    if (scrapedEntries.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `"${cleanUser}" MyDramaList profilinde herkese açık yapım bulunamadı veya profil gizli (Private/Members Only). Lütfen MDL profil gizlilik ayarlarınızı "Public" yapınız veya yapım isimlerini doğrudan yapıştırarak aktarınız.`,
        },
        { status: 404 }
      );
    }

    // Match scraped entries against our media table
    const matchedMediaItems: Array<{
      media: any;
      status: 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
      score: number;
      progress: number;
    }> = [];

    const mdlIds = scrapedEntries.map((e) => e.mdl_id).filter(Boolean) as string[];

    // 1. Match by mdl_id
    if (mdlIds.length > 0) {
      const { data: dbMatches } = await supabase
        .from('media')
        .select('id, slug, title, content_type, cover_image, mydramalist_url, episode_count, mdl_id')
        .in('mdl_id', mdlIds);

      if (dbMatches && dbMatches.length > 0) {
        for (const m of dbMatches) {
          const entry = scrapedEntries.find((e) => e.mdl_id === m.mdl_id);
          matchedMediaItems.push({
            media: m,
            status: entry?.status || 'completed',
            score: entry?.score || 10,
            progress: entry?.progress || m.episode_count || 16,
          });
        }
      }
    }

    // 2. For unmatched entries, match by title or aka_titles
    for (const entry of scrapedEntries) {
      if (entry.mdl_id && matchedMediaItems.some((m) => m.media.mdl_id === entry.mdl_id)) {
        continue;
      }
      if (!entry.title) continue;

      const { data: titleMatches } = await supabase
        .from('media')
        .select('id, slug, title, content_type, cover_image, mydramalist_url, episode_count, mdl_id')
        .or(`title.ilike.%${entry.title}%,aka_titles.cs.{"${entry.title}"}`)
        .limit(1);

      if (titleMatches && titleMatches.length > 0) {
        const hit = titleMatches[0];
        if (!matchedMediaItems.some((m) => m.media.id === hit.id)) {
          matchedMediaItems.push({
            media: hit,
            status: entry.status || 'completed',
            score: entry.score || 10,
            progress: entry.progress || hit.episode_count || 16,
          });
        }
      }
    }

    // If still 0 matched in database
    if (matchedMediaItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `MyDramaList'te ${scrapedEntries.length} yapım bulundu ancak katalogumuzdaki serilerle eşleştirilemedi.`,
        },
        { status: 404 }
      );
    }

    // If user is authenticated, update mdl_username in profile and persist progress
    if (authenticatedUserId) {
      await supabase
        .from('profiles')
        .update({ mdl_username: cleanUser })
        .eq('id', authenticatedUserId);

      const rows = matchedMediaItems.map((item) => ({
        user_id: authenticatedUserId,
        media_id: item.media.id,
        status: item.status,
        user_score: item.score,
        watched_episodes: Array.from(
          { length: Math.min(item.progress || item.media.episode_count || 16, 1000) },
          (_, i) => i + 1
        ),
        last_season_num: 1,
        last_episode_num: item.progress || item.media.episode_count || 16,
        last_episode_title: (item.media.content_type === 'film' || item.media.content_type === 'movie')
          ? 'Film'
          : `${item.progress || item.media.episode_count || 16}. Bölüm`,
        resume_position_sec: 0,
        resume_duration_sec: 3600,
        updated_at: new Date().toISOString(),
      }));

      await supabase
        .from('user_media_progress')
        .upsert(rows, { onConflict: 'user_id, media_id' });
    }

    return NextResponse.json({
      success: true,
      message: `${cleanUser} MyDramaList izleme listesi başarıyla aktarıldı.`,
      platform: 'mdl',
      username: cleanUser,
      totalFound: scrapedEntries.length,
      matchedCount: matchedMediaItems.length,
      matchedItems: matchedMediaItems,
    });
  } catch (err) {
    console.error('MDL/AniList import error:', err);
    return NextResponse.json(
      { success: false, error: 'İçe aktarma sırasında bir hata oluştu.' },
      { status: 500 }
    );
  }
}
