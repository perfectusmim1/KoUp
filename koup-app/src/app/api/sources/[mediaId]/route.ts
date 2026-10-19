import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { supabase } from '@/lib/supabase';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { cleanFansubName, cleanSourceName } from '@/lib/cleanFansub';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (s3Client) return s3Client;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.CF_R2_ENDPOINT;
  if (!accessKeyId || !secretAccessKey || !endpoint) return null;

  s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  return s3Client;
}

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
    p === 'hdfilm-close' ||
    p === 'close' ||
    p === 'rapidrame' ||
    p === 'asyawatch' ||
    p === 'dizilla' ||
    p === 'dbx' ||
    p === 'dizibox' ||
    u.includes('pichive') ||
    u.includes('dplayer') ||
    u.includes('hotlinger') ||
    u.includes('molystream') ||
    u.includes('playmix.uno') ||
    u.includes('rapidrame') ||
    u.includes('/rplayer/') ||
    u.includes('hdfilmcehennemi.mobi/video/embed/') ||
    u.includes('.m3u8') ||
    u.includes('master.txt')
  ) {
    return 'hls';
  }
  if (
    u.endsWith('.mp4') ||
    u.includes('.mp4?') ||
    p === 'mail.ru' ||
    p === 'mail' ||
    u.includes('my.mail.ru')
  ) {
    return 'mp4';
  }
  if (
    p === 'uqload' ||
    u.includes('uqload.') ||
    p === 'voe' ||
    u.includes('voe.sx') ||
    u.includes('voe.') ||
    p === 'vk' ||
    u.includes('vk.com') ||
    p === 'ok.ru' ||
    p === 'odnoklassniki' ||
    u.includes('ok.ru')
  ) {
    return 'hls';
  }
  if (p === 'tau-video' || u.includes('tau-video.xyz')) {
    return 'tau';
  }
  if (['dailymotion'].includes(p)) {
    return 'postmessage_iframe';
  }
  return 'locked_iframe';
}

function isDeadSource(provider?: string | null, directUrl?: string | null, sourceName?: string | null): boolean {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();
  const n = (sourceName || '').toLowerCase();
  if (!u || u === 'dead') return true;
  if (
    p === 'dead' ||
    p === 'sibnet' ||
    p === 'sendvid' ||
    n.includes('sibnet') ||
    u.includes('sibnet.ru') ||
    u.includes('sendvid') ||
    p.includes('gdrive') ||
    p.includes('google') ||
    u.includes('drive.google.com') ||
    u.includes('docs.google.com') ||
    u.includes('4meplayer') ||
    u.includes('p2pplay') ||
    u.includes('rpmplay') ||
    u.includes('uns.bio') ||
    u.includes('playerdkorea.xyz') ||
    u.includes('video.diziasya.com')
  ) {
    return true;
  }
  return false;
}

function getProviderPriority(provider: string, directUrl: string, contentType: string): number {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();

  // Top priority: working AsyaWatch, Dizilla, and direct inner HLS streams
  if (
    p === 'asyawatch' ||
    u.includes('pichive') ||
    p === 'dizilla' ||
    u.includes('dplayer') ||
    p === 'hdfilm-hls' ||
    u.includes('master.txt') ||
    u.includes('.m3u8')
  ) {
    return 0;
  }

  if (contentType === 'anime') {
    if (p === 'tau-video' || u.includes('tau-video')) return 1;
    if (p.includes('hls') || u.includes('.m3u8')) return 2;
  } else {
    if (
      p.includes('rapid') ||
      p.includes('hls') ||
      p === 'hdfilm-close' ||
      p === 'close' ||
      u.includes('rapidrame') ||
      u.includes('/rplayer/') ||
      u.includes('/video/embed/') ||
      p === 'diziyou' ||
      p === 'dbx' ||
      p === 'dizibox' ||
      u.includes('molystream')
    ) {
      return 1;
    }
    if (p === 'tau-video' || u.includes('tau-video')) return 2;
  }
  // Native player streams: Mail.ru, VK, Uqload, VOE
  if (['mail.ru', 'mail', 'vk'].includes(p) || u.includes('mail.ru') || u.includes('vk.com')) {
    return 3;
  }
  if (p === 'uqload' || u.includes('uqload') || p === 'voe' || u.includes('voe.sx') || u.includes('voe.')) {
    return 4;
  }
  if (['vidmoly', 'filemoon', 'yourupload'].includes(p)) {
    return 5;
  }
  if (['mp4upload', 'dailymotion', 'mega'].includes(p)) {
    return 6;
  }
  if (p === 'ok.ru' || p === 'odnoklassniki' || u.includes('ok.ru') || u.includes('odnoklassniki')) {
    return 7;
  }
  return 8;
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
    const r2PublicUrl =
      process.env.R2_PUBLIC_URL ||
      'https://pub-e62742f127324512937cc3ff34c976bd.r2.dev';

    let episodes: Array<{
      id: number;
      season_number: number;
      episode_number: number;
      episode_name: string;
      episode_type: string;
      status: 'published' | 'scheduled' | 'broken' | 'pending_source';
      pending?: boolean;
      scheduled_release_at?: string | null;
      translation_note?: string | null;
      react_fire: number;
      react_cry: number;
      react_shock: number;
      react_angry?: number;
      views_count?: number;
      intro_start_sec?: number | null;
      intro_end_sec?: number | null;
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

    // TIER 1: Cloudflare R2 Authenticated S3 Client
    const s3 = getS3Client();
    const bucket = process.env.CF_R2_BUCKET || 'koup-archive';
    if (s3) {
      try {
        const cmd = new GetObjectCommand({
          Bucket: bucket,
          Key: `sources/${idNum}.json`,
        });
        const res = await s3.send(cmd);
        if (res.Body) {
          const bodyStr = await res.Body.transformToString();
          const r2Data = JSON.parse(bodyStr);
          if (r2Data && Array.isArray(r2Data.episodes) && r2Data.episodes.length > 0) {
            episodes = r2Data.episodes;
          }
        }
      } catch {
        // Fallback to CDN or SQLite
      }
    }

    // TIER 1.1: Cloudflare R2 Edge CDN Public Fetch Fallback
    if (episodes.length === 0) {
      try {
        const r2Res = await fetch(`${r2PublicUrl}/sources/${idNum}.json`, {
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(1800),
        });
        if (r2Res.ok) {
          const r2Data = await r2Res.json();
          if (r2Data && Array.isArray(r2Data.episodes) && r2Data.episodes.length > 0) {
            episodes = r2Data.episodes;
          }
        }
      } catch {}
    }

    // TIER 1.2: Check local disk bundle (if local disk has more up-to-date episodes than cloud R2)
    const localBundlePath = path.resolve(process.cwd(), '..', 'r2_bundles', 'sources', `${idNum}.json`);
    if (fs.existsSync(localBundlePath)) {
      try {
        const localRaw = fs.readFileSync(localBundlePath, 'utf-8');
        const localData = JSON.parse(localRaw);
        if (localData && Array.isArray(localData.episodes) && localData.episodes.length > episodes.length) {
          episodes = localData.episodes;
          // Auto-sync to R2 so Cloudflare R2 gets the complete dataset
          if (s3) {
            s3.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `sources/${idNum}.json`,
                Body: localRaw,
                ContentType: 'application/json',
                CacheControl: 'public, max-age=60',
              })
            ).catch(() => {});
          }
        }
      } catch {}
    }

    // Sanitize R2/CDN episodes to strip dead sources and re-normalize native streams (Mail.ru, Uqload, VOE, VK, OK.RU) as Orijinal
    if (episodes.length > 0) {
      const dramaRow = getArchiveDb()
        ?.prepare('SELECT content_type FROM dramas WHERE id = ?')
        ?.get(idNum) as { content_type?: string } | undefined;
      const cType = (dramaRow?.content_type || 'dizi').toLowerCase();

      episodes = episodes.map((ep) => {
        const filtered = (ep.sources || []).filter(
          (s) => !isDeadSource(s.provider, s.direct_url, s.source_name)
        );
        const sorted = [...filtered].sort(
          (a, b) =>
            getProviderPriority(a.provider, a.direct_url, cType) -
            getProviderPriority(b.provider, b.direct_url, cType)
        );

        let orijinalIdx = 0;
        const normalized = sorted.map((s) => {
          const stype = classifyStreamType(s.provider, s.direct_url);
          const isNative = stype === 'hls' || stype === 'tau' || stype === 'mp4';
          let cleanName = cleanSourceName(s.source_name);
          if (isNative) {
            orijinalIdx++;
            cleanName = orijinalIdx === 1 ? 'Orijinal' : `Orijinal ${orijinalIdx}`;
          }
          return {
            ...s,
            source_name: cleanName,
            fansub: cleanFansubName(s.fansub),
            stream_type: stype,
            quality_label: isNative ? '1080p' : s.quality_label || 'HD Embed',
          };
        });
        const isPending = Boolean((ep as any).pending) || ep.status === 'pending_source';
        return {
          ...ep,
          pending: isPending ? true : undefined,
          status: isPending ? ('pending_source' as const) : ep.status,
          sources: normalized,
        };
      });
    }

    // TIER 2: SQLite Archive Database (Fast local fallback or richer dataset)
    const db = getArchiveDb();
    let sqliteEpCount = 0;
    if (db) {
      try {
        const countRow = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE drama_id = ?').get(idNum) as { count?: number } | undefined;
        sqliteEpCount = countRow?.count || 0;
      } catch {}
    }

    if (episodes.length === 0 || sqliteEpCount > episodes.length) {
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
           AND direct_url != ''
           AND provider != 'dead'
           AND provider != 'sibnet'
           AND provider != 'sendvid'
           AND provider NOT LIKE '%sibnet%'
           AND provider NOT LIKE '%gdrive%'
           AND provider NOT LIKE '%google%'
           AND direct_url NOT LIKE '%sibnet.ru%'
           AND direct_url NOT LIKE '%sendvid%'
           AND direct_url NOT LIKE '%drive.google.com%'
           AND direct_url NOT LIKE '%docs.google.com%'
           AND direct_url NOT LIKE '%4meplayer%'
           AND direct_url NOT LIKE '%p2pplay%'
           AND direct_url NOT LIKE '%rpmplay%'
            AND direct_url NOT LIKE '%uns.bio%'
            AND direct_url NOT LIKE '%playerdkorea.xyz%'
            AND direct_url NOT LIKE '%video.diziasya.com%'`
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

        // Check if there are other working sources
        const hasAlternativeSources = rawSources.some(
          (s) =>
            s.direct_url &&
            !s.direct_url.includes('ok.ru') &&
            !s.direct_url.includes('odnoklassniki') &&
            s.provider !== 'ok.ru' &&
            s.provider !== 'odnoklassniki'
        );

        const seenUrls = new Set<string>();
        const processed = rawSources
          .filter((s) => {
            if (!s.direct_url || seenUrls.has(s.direct_url)) return false;
            // Omit blocked ok.ru / odnoklassniki when other sources exist
            if (
              hasAlternativeSources &&
              (s.provider === 'ok.ru' ||
                s.provider === 'odnoklassniki' ||
                s.direct_url.includes('ok.ru') ||
                s.direct_url.includes('odnoklassniki'))
            ) {
              return false;
            }
            seenUrls.add(s.direct_url);
            return true;
          })
          .map((s) => {
            const stype = classifyStreamType(s.provider, s.direct_url);
            const prio = getProviderPriority(s.provider, s.direct_url, contentType);

            let cleanName = cleanSourceName(s.source_name || s.provider || 'Kaynak');
            const isNative = stype === 'hls' || stype === 'tau' || stype === 'mp4' || s.provider === 'diziyou-hls' || s.provider === 'hdfilm-hls' || s.provider === 'asyawatch' || s.direct_url.includes('pichive');
            let cleanFansub = cleanFansubName(s.fansub);

            if (s.provider === 'asyawatch' || s.site === 'asyawatch' || s.direct_url.includes('pichive')) {
              cleanName = 'Orijinal';
              cleanFansub = null;
            } else if (s.provider === 'dizilla' || s.site === 'dizilla' || s.direct_url.includes('dplayer') || s.direct_url.includes('hotlinger')) {
              cleanName = 'Dizilla';
              cleanFansub = null;
            } else if (isNative) {
              cleanName = 'Orijinal';
            } else if (cleanName.toLowerCase().includes('dizikorea') || cleanName.toLowerCase().includes('diziyou')) {
              cleanName = 'Orijinal';
            }

            return {
              source_name: cleanName,
              embed_id: s.embed_id,
              direct_url: s.direct_url,
              provider: s.provider || 'other',
              site: s.site || 'webdrama',
              fansub: cleanFansub,
              stream_type: stype,
              quality_label:
                isNative || s.provider === 'asyawatch' || s.provider === 'dizilla' || s.direct_url.includes('pichive') || s.direct_url.includes('dplayer')
                  ? '1080p'
                  : 'HD Embed',
              _prio: prio,
            };
          })
          .sort((a, b) => a._prio - b._prio)
          .slice(0, 18)
          .map((s, idx, arr) => {
            const { _prio, ...rest } = s;
            // If multiple 'Orijinal' sources exist, differentiate with Orijinal, Orijinal 2, etc.
            if (rest.source_name === 'Orijinal') {
              const previousOrijinalCount = arr.slice(0, idx).filter((x) => x.source_name.startsWith('Orijinal')).length;
              if (previousOrijinalCount > 0) {
                rest.source_name = `Orijinal ${previousOrijinalCount + 1}`;
              }
            }
            return rest;
          });

        return {
          id: ep.id,
          season_number: ep.season_number || 1,
          episode_number: ep.episode_number || 1,
          episode_name: (() => {
            const raw = ep.episode_name || '';
            const isCorrupted = !raw || raw.includes('') || raw.includes('\ufffd') || /B.l.m/i.test(raw);
            return isCorrupted ? `${ep.episode_number || 1}. Bölüm` : raw;
          })(),
          episode_type: ep.episode_type || 'bolum',
          status: 'published',
          scheduled_release_at: null,
          translation_note: null,
          react_fire: 0,
          react_cry: 0,
          react_shock: 0,
          react_angry: 0,
          views_count: 0,
          sources: processed,
        };
      });
    }
  }

    // Merge live Supabase episode reactions, view counts, scheduled upcoming episodes & intro skip timestamps
    const { data: liveEps } = await supabase
      .from('episodes')
      .select(
        'season_number, episode_number, episode_name, status, scheduled_release_at, translation_note, react_fire, react_cry, react_shock, react_angry, views_count, intro_start_sec, intro_end_sec'
      )
      .eq('media_id', idNum)
      .or(
        'views_count.gt.0,react_fire.gt.0,react_cry.gt.0,react_shock.gt.0,react_angry.gt.0,status.eq.scheduled,status.eq.pending_source,intro_start_sec.not.is.null'
      )
      .order('season_number', { ascending: true })
      .order('episode_number', { ascending: true })
      .limit(3000);

    if (liveEps && liveEps.length > 0) {
      const epMap = new Map(
        episodes.map((e) => [`${e.season_number}_${e.episode_number}`, e])
      );
      for (const le of liveEps) {
        const key = `${le.season_number}_${le.episode_number}`;
        const existing = epMap.get(key);
        if (existing) {
          existing.react_fire = le.react_fire || 0;
          existing.react_cry = le.react_cry || 0;
          existing.react_shock = le.react_shock || 0;
          existing.react_angry = le.react_angry || 0;
          existing.views_count = Number(le.views_count || 0);
          if (le.intro_start_sec != null) existing.intro_start_sec = le.intro_start_sec;
          if (le.intro_end_sec != null) existing.intro_end_sec = le.intro_end_sec;
          if (le.status === 'pending_source') {
            existing.status = 'pending_source';
            existing.pending = true;
          } else if (le.status === 'scheduled' && existing.sources.length === 0) {
            existing.status = 'scheduled';
            existing.scheduled_release_at = le.scheduled_release_at;
            existing.translation_note = le.translation_note;
          }
        } else if (le.status === 'scheduled' || le.status === 'pending_source') {
          episodes.push({
            id: idNum * 1000 + le.episode_number,
            season_number: le.season_number || 1,
            episode_number: le.episode_number || 1,
            episode_name: le.episode_name || `${le.episode_number}. Bölüm`,
            episode_type: 'bolum',
            status: le.status as 'scheduled' | 'pending_source',
            pending: le.status === 'pending_source',
            scheduled_release_at: le.scheduled_release_at,
            translation_note: le.translation_note,
            react_fire: le.react_fire || 0,
            react_cry: le.react_cry || 0,
            react_shock: le.react_shock || 0,
            react_angry: le.react_angry || 0,
            views_count: Number(le.views_count || 0),
            intro_start_sec: le.intro_start_sec || null,
            intro_end_sec: le.intro_end_sec || null,
            sources: [],
          });
        }
      }

      episodes.sort((a, b) => {
        const sDiff = (a.season_number || 1) - (b.season_number || 1);
        if (sDiff !== 0) return sDiff;
        return (a.episode_number || 1) - (b.episode_number || 1);
      });
    }

    return NextResponse.json(
      { mediaId: idNum, totalEpisodes: episodes.length, episodes },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (err) {
    console.error('Error loading episode sources:', err);
    return NextResponse.json(
      { mediaId: idNum, totalEpisodes: 0, episodes: [] },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  }
}
