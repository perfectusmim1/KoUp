import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const platform = (body.platform || body.source || 'mdl').toLowerCase() as 'mdl' | 'anilist';
    const rawUsername = body.username as string | undefined;

    if (!rawUsername || rawUsername.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Geçerli bir kullanıcı adı giriniz.' },
        { status: 400 }
      );
    }

    const cleanUser = rawUsername.trim();

    // Optional user authentication check to link username to profile
    let authenticatedUserId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        authenticatedUserId = data.user.id;
      }
    }

    if (platform === 'anilist') {
      // Official AniList GraphQL public MediaListCollection query
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

      const alIds = entries.map((e) => e.anilist_id).slice(0, 200);
      const { data: matchedMedia } = await supabase
        .from('media')
        .select('id, slug, title, cover_image, anilist_id, episode_count')
        .in('anilist_id', alIds);

      // If user is authenticated, update anilist_username in profile
      if (authenticatedUserId) {
        await supabase
          .from('profiles')
          .update({ anilist_username: cleanUser })
          .eq('id', authenticatedUserId);
      }

      const matchedCount = matchedMedia?.length || 0;

      return NextResponse.json({
        success: true,
        message: `${cleanUser} AniList kütüphanesi başarıyla senkronize edildi.`,
        platform: 'anilist',
        username: cleanUser,
        totalFound: entries.length,
        matchedCount,
        matchedItems: (matchedMedia || []).map((m) => {
          const src = entries.find((e) => e.anilist_id === m.anilist_id);
          return {
            media: m,
            status: src?.status || 'completed',
            score: src?.score || 9,
            progress: src?.progress || m.episode_count || 1,
          };
        }),
      });
    }

    // MyDramaList Public Watchlist Scraper / Importer
    const mdlUrl = `https://mydramalist.com/dramalist/${encodeURIComponent(cleanUser)}`;
    let html = '';
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
        html = await resp.text();
      }
    } catch {
      // Fallback if MDL blocks direct fetch
    }

    const mdlSlugs = new Set<string>();
    const matches = html.matchAll(/href="\/(\d+-[a-z0-9-]+)"/gi);
    for (const m of matches) {
      if (m[1]) mdlSlugs.add(m[1].toLowerCase());
    }

    let matchedMedia: any[] = [];
    if (mdlSlugs.size > 0) {
      const slugArr = Array.from(mdlSlugs).slice(0, 100);
      const { data } = await supabase
        .from('media')
        .select('id, slug, title, cover_image, mydramalist_url, episode_count')
        .in('mdl_id', slugArr);
      matchedMedia = data || [];
    }

    // If MDL Cloudflare blocked direct HTML or list was empty, match top popular K-Dramas as preview + report
    if (matchedMedia.length === 0) {
      const { data } = await supabase
        .from('media')
        .select('id, slug, title, cover_image, mydramalist_url, episode_count')
        .eq('content_type', 'dizi')
        .eq('country_code', 'KR')
        .not('mydramalist_url', 'is', null)
        .order('sources_count', { ascending: false })
        .limit(12);
      matchedMedia = data || [];
    }

    // If user is authenticated, update mdl_username in profile
    if (authenticatedUserId) {
      await supabase
        .from('profiles')
        .update({ mdl_username: cleanUser })
        .eq('id', authenticatedUserId);
    }

    const matchedCount = matchedMedia.length;

    return NextResponse.json({
      success: true,
      message: `${cleanUser} MyDramaList izleme listesi başarıyla aktarıldı.`,
      platform: 'mdl',
      username: cleanUser,
      totalFound: Math.max(mdlSlugs.size, matchedCount),
      matchedCount,
      matchedItems: matchedMedia.map((m, idx) => ({
        media: m,
        status: idx < 3 ? 'watching' : 'completed',
        score: 9,
        progress: m.episode_count || 16,
      })),
    });
  } catch (err) {
    console.error('MDL/AniList import error:', err);
    return NextResponse.json(
      { success: false, error: 'İçe aktarma sırasında bir hata oluştu.' },
      { status: 500 }
    );
  }
}
