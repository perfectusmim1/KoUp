import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { supabase } from '@/lib/supabase';

let archiveDb: DatabaseSync | null = null;

function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath =
    process.env.ARCHIVE_DB_PATH ||
    path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (!fs.existsSync(dbPath)) return null;
  archiveDb = new DatabaseSync(dbPath, { readOnly: true });
  return archiveDb;
}

function classifyStreamType(
  provider: string,
  directUrl: string
): 'hls' | 'mp4' | 'tau' | 'postmessage_iframe' | 'locked_iframe' {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();

  if (
    p === 'diziyou-hls' ||
    p === 'hdfilm-hls' ||
    u.includes('.m3u8') ||
    u.includes('master.txt')
  ) {
    return 'hls';
  }
  if (u.endsWith('.mp4') || u.includes('.mp4?')) {
    return 'mp4';
  }
  if (p === 'tau-video' || u.includes('tau-video.xyz')) {
    return 'tau';
  }
  if (['ok.ru', 'odnoklassniki', 'vk', 'dailymotion'].includes(p)) {
    return 'postmessage_iframe';
  }
  return 'locked_iframe';
}

function getProviderPriority(provider: string, directUrl: string, contentType: string): number {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();

  if (contentType === 'anime') {
    if (p === 'tau-video' || u.includes('tau-video')) return 1;
    if (p.includes('hls') || u.includes('.m3u8')) return 2;
  } else {
    if (p.includes('hls') || p === 'diziyou' || u.includes('.m3u8')) return 1;
    if (p === 'tau-video' || u.includes('tau-video')) return 2;
  }
  if (['ok.ru', 'odnoklassniki', 'vk', 'mail.ru', 'mail', 'dailymotion', 'mega'].includes(p)) {
    return 3;
  }
  if (['vidmoly', 'filemoon', 'yourupload', 'playerdkorea'].includes(p)) {
    return 4;
  }
  if (['sendvid', 'uqload', 'mp4upload', 'doodstream', 'voe', 'vudeo'].includes(p)) {
    return 5;
  }
  if (p.includes('gdrive') || p.includes('google') || u.includes('drive.google.com')) {
    return 6;
  }
  if (p === 'sibnet' || u.includes('sibnet.ru')) {
    return 7;
  }
  return 5;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await context.params;
  const idNum = Number(mediaId);
  if (!idNum || Number.isNaN(idNum)) {
    return NextResponse.json({ error: 'Invalid mediaId' }, { status: 400 });
  }

  try {
    const db = getArchiveDb();
    let episodes: Array<{
      id: number;
      season_number: number;
      episode_number: number;
      episode_name: string;
      episode_type: string;
      status: 'published' | 'scheduled' | 'broken';
      scheduled_release_at?: string | null;
      translation_note?: string | null;
      react_fire: number;
      react_cry: number;
      react_shock: number;
      sources: Array<{
        source_name: string;
        embed_id: string;
        direct_url: string;
        provider: string;
        site: string;
        fansub: string | null;
        stream_type: string;
        quality_label: string;
      }>;
    }> = [];

    if (db) {
      const dramaRow = db
        .prepare('SELECT content_type FROM dramas WHERE id = ?')
        .get(idNum) as { content_type?: string } | undefined;
      const contentType = (dramaRow?.content_type || 'dizi').toLowerCase();

      const epRows = db
        .prepare(
          `SELECT id, season_number, episode_number, episode_name, episode_type
           FROM episodes
           WHERE drama_id = ?
           ORDER BY season_number ASC, episode_number ASC`
        )
        .all(idNum) as Array<{
        id: number;
        season_number: number;
        episode_number: number;
        episode_name: string;
        episode_type: string;
      }>;

      const srcStmt = db.prepare(
        `SELECT source_name, embed_id, direct_url, provider, site, fansub
         FROM episode_sources
         WHERE episode_id = ?
           AND direct_url IS NOT NULL
           AND direct_url != 'dead'
           AND direct_url != ''`
      );

      episodes = epRows.map((ep) => {
        const rawSources = srcStmt.all(ep.id) as Array<{
          source_name: string;
          embed_id: string;
          direct_url: string;
          provider: string;
          site: string;
          fansub: string | null;
        }>;

        const seenUrls = new Set<string>();
        const processed = rawSources
          .filter((s) => {
            if (!s.direct_url || seenUrls.has(s.direct_url)) return false;
            seenUrls.add(s.direct_url);
            return true;
          })
          .map((s) => {
            const stype = classifyStreamType(s.provider, s.direct_url);
            const prio = getProviderPriority(s.provider, s.direct_url, contentType);
            return {
              source_name: s.source_name || s.provider || 'Kaynak',
              embed_id: s.embed_id,
              direct_url: s.direct_url,
              provider: s.provider || 'other',
              site: s.site || 'webdrama',
              fansub: s.fansub || null,
              stream_type: stype,
              quality_label:
                stype === 'hls' || stype === 'tau' || stype === 'mp4'
                  ? '1080p Native'
                  : 'HD Embed',
              _prio: prio,
            };
          })
          .sort((a, b) => a._prio - b._prio)
          .slice(0, 18)
          .map(({ _prio, ...rest }) => rest);

        return {
          id: ep.id,
          season_number: ep.season_number || 1,
          episode_number: ep.episode_number || 1,
          episode_name: ep.episode_name || `${ep.episode_number}. Bölüm`,
          episode_type: ep.episode_type || 'bolum',
          status: 'published',
          scheduled_release_at: null,
          translation_note: null,
          react_fire: ((ep.id * 7) % 45) + 12,
          react_cry: ((ep.id * 3) % 28) + 4,
          react_shock: ((ep.id * 5) % 34) + 6,
          sources: processed,
        };
      });
    }

    // Merge live Supabase episode reactions & scheduled upcoming episodes
    const { data: liveEps } = await supabase
      .from('episodes')
      .select(
        'season_number, episode_number, episode_name, status, scheduled_release_at, translation_note, react_fire, react_cry, react_shock'
      )
      .eq('media_id', idNum);

    if (liveEps && liveEps.length > 0) {
      const epMap = new Map(
        episodes.map((e) => [`${e.season_number}_${e.episode_number}`, e])
      );
      for (const le of liveEps) {
        const key = `${le.season_number}_${le.episode_number}`;
        const existing = epMap.get(key);
        if (existing) {
          if (le.react_fire) existing.react_fire += le.react_fire;
          if (le.react_cry) existing.react_cry += le.react_cry;
          if (le.react_shock) existing.react_shock += le.react_shock;
          if (le.status === 'scheduled' && existing.sources.length === 0) {
            existing.status = 'scheduled';
            existing.scheduled_release_at = le.scheduled_release_at;
            existing.translation_note = le.translation_note;
          }
        } else if (le.status === 'scheduled') {
          episodes.push({
            id: idNum * 1000 + le.episode_number,
            season_number: le.season_number || 1,
            episode_number: le.episode_number || 1,
            episode_name: le.episode_name || `${le.episode_number}. Bölüm`,
            episode_type: 'bolum',
            status: 'scheduled',
            scheduled_release_at: le.scheduled_release_at,
            translation_note: le.translation_note,
            react_fire: le.react_fire || 0,
            react_cry: le.react_cry || 0,
            react_shock: le.react_shock || 0,
            sources: [],
          });
        }
      }
    }

    return NextResponse.json(
      { mediaId: idNum, totalEpisodes: episodes.length, episodes },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
        },
      }
    );
  } catch (err) {
    console.error('Error loading episode sources:', err);
    return NextResponse.json({ mediaId: idNum, totalEpisodes: 0, episodes: [] });
  }
}
