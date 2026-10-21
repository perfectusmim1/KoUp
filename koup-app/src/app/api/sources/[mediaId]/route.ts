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
    p === 'morencius' ||
    p === 'ev' ||
    p === 'filemoon' ||
    p === 'byse' ||
    p === 'gdriveplayer' ||
    p === 'gdplayer' ||
    p === 'upns' ||
    p === 'streamwish' ||
    p === 'vidhide' ||
    p === 'streamruby' ||
    p === 'dzen' ||
    u.includes('morencius') ||
    u.includes('filemoon') ||
    u.includes('bysesukior') ||
    u.includes('bysedikamoum') ||
    u.includes('byse.') ||
    u.includes('gdriveplayer') ||
    u.includes('gdplayer') ||
    u.includes('upns') ||
    u.includes('streamwish') ||
    u.includes('ghbrisk') ||
    u.includes('dhtpre') ||
    u.includes('streamruby') ||
    u.includes('dzen.ru') ||
    u.includes('luluvdo') ||
    u.includes('lulustream') ||
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
    p === 'mp4upload' ||
    u.includes('mp4upload') ||
    u.endsWith('.mp4') ||
    u.includes('.mp4?') ||
    u.includes('ddizi.tel/player/mp4') ||
    p === 'mail.ru' ||
    p === 'mail' ||
    u.includes('my.mail.ru') ||
    u.includes('yadi.sk') ||
    u.includes('disk.yandex')
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
  if (p === 'dailymotion' || u.includes('dailymotion.com') || u.includes('dai.ly')) {
    return 'hls';
  }
  return 'locked_iframe';
}

function isDeadSource(provider?: string | null, directUrl?: string | null, sourceName?: string | null): boolean {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();
  const n = (sourceName || '').toLowerCase();
  if (!u || u === 'dead' || !u.startsWith('http') || u.startsWith('javascript:') || u.includes('void(0)')) return true;
  if (
    p === 'dead' ||
    p === 'sibnet' ||
    p === 'sendvid' ||
    p === 'pixeldrain' ||
    n.includes('sibnet') ||
    u.includes('sibnet.ru') ||
    u.includes('sendvid') ||
    u.includes('pixeldrain.com') ||
    p.includes('gdrive') ||
    p.includes('google') ||
    u.includes('drive.google.com') ||
    u.includes('docs.google.com') ||
    u.includes('4meplayer') ||
    u.includes('p2pplay') ||
    u.includes('rpmplay') ||
    u.includes('uns.bio') ||
    u.includes('playerdkorea.xyz') ||
    u.includes('video.diziasya.com') ||
    u.includes('parklogic') ||
    u.includes('vtube.to') ||
    u.includes('highload.to') ||
    u.includes('vadshar.com') ||
    u.includes('viidshar.com') ||
    u.includes('segavid.com') ||
    u.includes('upload.do') ||
    u.includes('lylxan.com') ||
    u.includes('embedrise.com') ||
    u.includes('embedgram.com') ||
    u.includes('openload.co') ||
    u.includes('streammango.com') ||
    u.includes('rapidvideo.com') ||
    u.includes('estream.to') ||
    u.includes('vid.me') ||
    u.includes('cloudvideo.tv') ||
    u.includes('wolfstream.tv') ||
    u.includes('mystream.to') ||
    u.includes('vidmoly.me') ||
    u.includes('fembed.com') ||
    u.includes('feurl.com') ||
    u.includes('suzihaza.com') ||
    u.includes('gounlimited.to') ||
    u.includes('jetload.net') ||
    u.includes('supervideo.tv') ||
    u.includes('upstream.to') ||
    u.includes('mixdrop')
  ) {
    return true;
  }
  return false;
}

function getDisplaySourceName(
  provider?: string | null,
  rawSourceName?: string | null,
  directUrl?: string | null,
  site?: string | null
): string {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();
  const s = (site || '').toLowerCase();
  const raw = cleanSourceName(rawSourceName);

  // 1. AsyaWatch primary native streams
  if (p === 'asyawatch' || s === 'asyawatch' || u.includes('pichive') || u.includes('molystream')) {
    return 'Orijinal';
  }
  // 2. Dizilla / Dizibox
  if (p === 'dizilla' || s === 'dizilla' || u.includes('dplayer') || u.includes('hotlinger')) {
    return 'Dizilla';
  }
  // 3. Scraped native site streams
  if (p.includes('diziyou') || u.includes('diziyou')) {
    if (raw && (raw.includes('Altyaz') || raw.includes('Dublaj'))) {
      return raw;
    }
    return 'Orijinal (Altyazılı)';
  }
  if (p.includes('dizikorea') || u.includes('dizikorea') || p.includes('hdfilm')) {
    return 'Orijinal';
  }
  // 4. Tau Video
  if (p === 'tau-video' || u.includes('tau-video')) {
    return 'Tau Video';
  }
  // 5. Specific video hosts: keep their recognizable honest provider name
  if (p === 'vk' || u.includes('vk.com')) return 'VK';
  if (p === 'mail.ru' || p === 'mail' || u.includes('mail.ru')) return 'Mail.ru';
  if (p === 'uqload' || u.includes('uqload')) return 'Uqload';
  if (p === 'voe' || u.includes('voe.sx') || u.includes('voe.')) return 'VOE';
  if (p === 'ok.ru' || p === 'odnoklassniki' || u.includes('ok.ru')) return 'OK.ru';
  if (p === 'filemoon' || u.includes('bysesukior') || u.includes('filemoon')) return 'Filemoon';
  if (p === 'streamwish' || u.includes('ghbrisk') || u.includes('streamwish')) return 'Streamwish';
  if (p === 'yourupload' || u.includes('yourupload')) return 'YourUpload';
  if (p === 'vidmoly' || u.includes('vidmoly')) return 'Vidmoly';
  if (p === 'dailymotion' || u.includes('dailymotion')) return 'Dailymotion';
  if (p === 'mp4upload' || u.includes('mp4upload')) return 'Mp4Upload';
  if (p === 'mega' || u.includes('mega.nz')) return 'Mega';

  // 6. If original raw name is already descriptive
  if (raw && !['kaynak', 'other', 'default', 'varsayılan', 'vip', 'vi̇p'].includes(raw.toLowerCase())) {
    return raw;
  }

  return p && p !== 'other' ? p.toUpperCase() : 'Kaynak';
}

function applySourceNumbering<T extends { source_name: string }>(sources: T[]): T[] {
  const counts: Record<string, number> = {};
  for (const s of sources) {
    counts[s.source_name] = (counts[s.source_name] || 0) + 1;
  }
  const seen: Record<string, number> = {};
  return sources.map((s) => {
    const base = s.source_name;
    seen[base] = (seen[base] || 0) + 1;
    const finalName = counts[base] > 1 && seen[base] > 1 ? `${base} ${seen[base]}` : base;
    return {
      ...s,
      source_name: finalName,
    };
  });
}

function getProviderPriority(provider: string, directUrl: string, contentType: string, sourceName?: string): number {
  const p = (provider || '').toLowerCase();
  const u = (directUrl || '').toLowerCase();
  const s = (sourceName || '').toLowerCase();

  const hasTrSub = s.includes('altyaz') || u.includes('altyaz') || p.includes('sub');
  const hasTrDub = s.includes('dublaj') || s.includes('dual') || u.includes('dublaj') || p.includes('dub');

  // Top priority (Tier 0): Verified Turkish subtitled or dubbed players (Rapidrame, Diziyou, HDFilm, DiziKorea, DiziBox, Dizilla)
  if (p === 'rapidrame' || u.includes('/rplayer/') || (u.includes('rapidrame') && !u.includes('/embed/'))) {
    return -2;
  }
  if (p.includes('diziyou') || u.includes('storage.diziyou')) {
    return -1;
  }
  if (
    hasTrSub ||
    hasTrDub ||
    p === 'hdfilm-close' ||
    u.includes('hdfilmcehennemi.mobi') ||
    p === 'dizikorea' ||
    u.includes('playerdkorea') ||
    p === 'dizibox' ||
    p === 'dbx' ||
    p === 'dizilla'
  ) {
    return 0;
  }

  // Tier 1: Clean high-speed players with Turkish or embedded audio (Vidmoly, Uqload, Tau-Video, MP4Upload)
  if (
    p === 'vidmoly' || u.includes('vidmoly') ||
    p === 'tau-video' || u.includes('tau-video') ||
    p === 'uqload' || u.includes('uqload') ||
    p === 'mp4upload' || u.includes('mp4upload')
  ) {
    return 1;
  }

  // Tier 2: Multi-resolution social video hosts (Mail.ru, OK.ru, VK)
  if (
    ['mail.ru', 'mail', 'vk', 'ok.ru', 'odnoklassniki'].includes(p) ||
    u.includes('mail.ru') || u.includes('vk.com') || u.includes('ok.ru')
  ) {
    return 2;
  }

  // Tier 3: Direct raw HLS without explicit Turkish subtitles (e.g. Diziyou raw streams)
  if (p.includes('diziyou') || u.includes('storage.diziyou') || u.includes('.m3u8')) {
    return 3;
  }

  // Tier 4: Fragile hosts or iframe fallbacks (Pichive, VOE, Filemoon)
  if (u.includes('pichive') || p === 'voe' || u.includes('voe.') || p === 'filemoon') {
    return 5;
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
            getProviderPriority(a.provider, a.direct_url, cType, a.source_name) -
            getProviderPriority(b.provider, b.direct_url, cType, b.source_name)
        );

        const mappedSources = sorted.map((s) => {
          const stype = classifyStreamType(s.provider, s.direct_url);
          const isNative = stype === 'hls' || stype === 'tau' || stype === 'mp4';
          const displayName = getDisplaySourceName(s.provider, s.source_name, s.direct_url, s.site);
          return {
            ...s,
            source_name: displayName,
            fansub: cleanFansubName(s.fansub),
            stream_type: stype,
            quality_label: isNative ? '1080p' : s.quality_label || 'HD Embed',
          };
        });
        const normalized = applySourceNumbering(mappedSources);
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

        const seenUrls = new Set<string>();
        const processed = rawSources
          .filter((s) => {
            if (!s.direct_url || seenUrls.has(s.direct_url)) return false;
            if (isDeadSource(s.provider, s.direct_url, s.source_name)) return false;
            seenUrls.add(s.direct_url);
            return true;
          })
          .map((s) => {
            const stype = classifyStreamType(s.provider, s.direct_url);
            const prio = getProviderPriority(s.provider, s.direct_url, contentType, s.source_name);

            const isNative = stype === 'hls' || stype === 'tau' || stype === 'mp4' || s.provider === 'diziyou-hls' || s.provider === 'hdfilm-hls' || s.provider === 'asyawatch' || s.direct_url.includes('pichive');
            const cleanName = getDisplaySourceName(s.provider, s.source_name, s.direct_url, s.site);
            const isOriginalSite = s.provider === 'asyawatch' || s.site === 'asyawatch' || s.direct_url.includes('pichive');
            const cleanFansub = isOriginalSite ? null : cleanFansubName(s.fansub);

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
          .map((s) => {
            const { _prio, ...rest } = s;
            return rest;
          });

        const numberedSources = applySourceNumbering(processed);

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
          sources: numberedSources,
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

    // Sort episode sources by provider priority & re-number
    for (const ep of episodes) {
      if (Array.isArray(ep.sources) && ep.sources.length > 1) {
        ep.sources.sort((a, b) => {
          const prioA = getProviderPriority(a.provider, a.direct_url, '', a.source_name);
          const prioB = getProviderPriority(b.provider, b.direct_url, '', b.source_name);
          return prioA - prioB;
        });
        ep.sources = applySourceNumbering(ep.sources);
      }
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
