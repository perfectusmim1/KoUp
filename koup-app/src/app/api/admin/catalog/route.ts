import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
  resolvePythonBinary,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

function getS3Client(): S3Client | null {
  const endpoint = process.env.CF_R2_ENDPOINT;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucketName(): string {
  return process.env.CF_R2_BUCKET || 'koup-archive';
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function runLocalCatalogPatch(
  action: 'series_upsert' | 'series_delete' | 'episode_upsert' | 'episode_delete' | 'source_sync' | 'backup_db',
  payload: Record<string, unknown>,
  backupR2 = false
): Promise<{ ok: boolean; syncedLocalDb: boolean; output?: string }> {
  const rootDir = path.resolve(process.cwd(), '..');
  const scriptPath = path.join(rootDir, 'scripts', 'admin_apply_catalog_patch.py');
  const dbPath = path.join(rootDir, 'webdrama_archive.db');

  if (!fs.existsSync(scriptPath) || !fs.existsSync(dbPath)) {
    return { ok: true, syncedLocalDb: false };
  }

  const pythonBin = resolvePythonBinary(rootDir);
  const args = [
    '-u',
    scriptPath,
    '--action',
    action,
    '--payload-json',
    JSON.stringify(payload),
  ];
  if (backupR2) args.push('--backup-r2');

  return new Promise((resolve) => {
    const proc = spawn(pythonBin, args, {
      cwd: rootDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d) => {
      out += d.toString();
    });
    proc.on('close', (code) => {
      resolve({ ok: code === 0, syncedLocalDb: code === 0, output: out.slice(-1000) });
    });
    proc.on('error', () => {
      resolve({ ok: false, syncedLocalDb: false });
    });
  });
}

async function readR2SourceBundle(mediaId: number): Promise<Record<string, unknown> | null> {
  const rootDir = path.resolve(process.cwd(), '..');
  const localBundlePath = path.join(rootDir, 'r2_bundles', 'sources', `${mediaId}.json`);
  if (fs.existsSync(localBundlePath)) {
    try {
      const raw = fs.readFileSync(localBundlePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      // Fall through to R2
    }
  }

  const s3 = getS3Client();
  if (s3) {
    try {
      const resp = await s3.send(
        new GetObjectCommand({
          Bucket: getBucketName(),
          Key: `sources/${mediaId}.json`,
        })
      );
      const bodyStr = await resp.Body?.transformToString('utf-8');
      if (bodyStr) return JSON.parse(bodyStr);
    } catch {
      // Fall through to edge worker
    }
  }

  try {
    const workerUrl = process.env.NEXT_PUBLIC_CF_WORKER_URL || 'https://koup-edge-worker.caganhuseyinerdil.workers.dev';
    const r = await fetch(`${workerUrl}/archive/sources/${mediaId}.json`, { cache: 'no-store' });
    if (r.ok) {
      return await r.json();
    }
  } catch {
    // Ignore
  }

  return null;
}

async function writeR2SourceBundle(mediaId: number, bundle: Record<string, unknown>): Promise<boolean> {
  const s3 = getS3Client();
  if (!s3) return false;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: getBucketName(),
        Key: `sources/${mediaId}.json`,
        Body: JSON.stringify(bundle),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=60',
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuth(req, { allowModerator: true });
  if (!auth.authorized) return auth.response!;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'r2_sources';

  if (action === 'r2_sources') {
    const mediaId = Number(searchParams.get('mediaId') || 0);
    if (!mediaId) {
      return NextResponse.json({ error: 'Geçersiz mediaId' }, { status: 400 });
    }
    const bundle = await readR2SourceBundle(mediaId);
    return NextResponse.json({
      ok: true,
      mediaId,
      bundle: bundle || { media_id: mediaId, episodes: [] },
    });
  }

  if (action === 'enrich_preview') {
    const title = (searchParams.get('title') || '').trim();
    const year = searchParams.get('year') || '';
    const contentType = searchParams.get('contentType') || 'dizi';
    if (!title) {
      return NextResponse.json({ error: 'Başlık gerekli' }, { status: 400 });
    }

    try {
      if (contentType === 'anime') {
        const gql = `
          query ($search: String) {
            Media(search: $search, type: ANIME) {
              id
              title { romaji english native }
              startDate { year }
              coverImage { extraLarge large }
              bannerImage
              description(asHtml: false)
              siteUrl
            }
          }
        `;
        const aniRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: gql, variables: { search: title } }),
        });
        if (aniRes.ok) {
          const aniJson = await aniRes.json();
          const media = aniJson?.data?.Media;
          if (media) {
            const cleanDesc = String(media.description || '').replace(/<[^>]+>/g, '').trim();
            return NextResponse.json({
              ok: true,
              metadata: {
                anilist_id: media.id,
                native_title: media.title?.native || media.title?.romaji || title,
                release_year: media.startDate?.year || (year ? Number(year) : undefined),
                cover_image: media.coverImage?.extraLarge || media.coverImage?.large || undefined,
                backdrop_image: media.bannerImage || media.coverImage?.extraLarge || undefined,
                overview: cleanDesc || undefined,
                country_code: 'JP',
                country_name: 'Japonya',
              },
            });
          }
        }
      }

      if (!TMDB_API_KEY) {
        return NextResponse.json(
          { ok: false, error: 'TMDB_API_KEY ortam değişkeni tanımlı değil.' },
          { status: 500 }
        );
      }

      const endpoint = contentType === 'film' ? 'search/movie' : 'search/tv';
      const yearParam = year ? (contentType === 'film' ? `&year=${encodeURIComponent(year)}` : `&first_air_date_year=${encodeURIComponent(year)}`) : '';
      const trRes = await fetch(
        `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=tr-TR${yearParam}`
      );
      const trData = trRes.ok ? await trRes.json() : null;
      let hit = trData?.results?.[0];

      if (!hit) {
        const enRes = await fetch(
          `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=en-US${yearParam}`
        );
        const enData = enRes.ok ? await enRes.json() : null;
        hit = enData?.results?.[0];
      }

      if (!hit) {
        return NextResponse.json({ ok: false, error: 'TMDB/AniList üzerinde eşleşme bulunamadı.' }, { status: 404 });
      }

      const releaseDate = hit.first_air_date || hit.release_date || '';
      const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : undefined;
      const originCountry = Array.isArray(hit.origin_country) && hit.origin_country[0] ? String(hit.origin_country[0]).toUpperCase() : undefined;

      return NextResponse.json({
        ok: true,
        metadata: {
          tmdb_id: hit.id,
          native_title: hit.original_name || hit.original_title || hit.name || hit.title,
          release_year: releaseYear,
          cover_image: hit.poster_path ? `https://image.tmdb.org/t/p/w780${hit.poster_path}` : undefined,
          backdrop_image: hit.backdrop_path ? `https://image.tmdb.org/t/p/original${hit.backdrop_path}` : undefined,
          overview: hit.overview || undefined,
          country_code: originCountry,
        },
      });
    } catch (err) {
      return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Bilinmeyen action' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth.authorized) return auth.response!;

  const rate = checkAdminRateLimit(`catalog:${auth.userId}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Çok fazla katalog isteği gönderildi. Lütfen biraz bekleyin.' }, { status: 429 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase servis bağlantısı yapılandırılmamış.' }, { status: 500 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON gövdesi' }, { status: 400 });
  }

  const action = String(body.action || '');

  // 1. Live Video / Embed Source Probe
  if (action === 'source_probe') {
    const rawUrl = String(body.url || '').trim();
    if (!isSafeExternalUrl(rawUrl)) {
      return NextResponse.json({ ok: false, error: 'Geçersiz veya güvenli olmayan URL.' }, { status: 400 });
    }
    const startMs = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      let resp: Response;
      try {
        resp = await fetch(rawUrl, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        if (resp.status === 405 || resp.status === 403) {
          resp = await fetch(rawUrl, {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
              Range: 'bytes=0-1024',
            },
            redirect: 'follow',
            signal: controller.signal,
          });
        }
      } finally {
        clearTimeout(timeout);
      }

      const latencyMs = Date.now() - startMs;
      const contentType = resp.headers.get('content-type') || 'unknown';
      const lowerUrl = rawUrl.toLowerCase();
      const streamType =
        lowerUrl.includes('.m3u8') || contentType.includes('mpegurl')
          ? 'HLS (.m3u8)'
          : lowerUrl.includes('.mp4') || contentType.includes('video/mp4')
          ? 'MP4 Direct'
          : 'Iframe / Embed';

      return NextResponse.json({
        ok: resp.ok || resp.status === 206 || resp.status === 302,
        status: resp.status,
        latencyMs,
        contentType,
        streamType,
        finalUrl: resp.url || rawUrl,
      });
    } catch (err) {
      return NextResponse.json({
        ok: false,
        status: 0,
        latencyMs: Date.now() - startMs,
        error: (err as Error).message || 'Bağlantı zaman aşımı',
      });
    }
  }

  // 2. Series Save (Full Storage Sync: Supabase + SQLite + R2 Bundle)
  if (action === 'series_save') {
    const series = (body.series || {}) as Record<string, unknown>;
    const title = String(series.title || '').trim();
    const slug = String(series.slug || '').trim();
    if (!title || !slug) {
      return NextResponse.json({ error: 'Başlık ve slug zorunludur.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = {
      title,
      slug,
      native_title: series.native_title ? String(series.native_title).trim() : title,
      content_type: series.content_type || 'dizi',
      country_code: series.country_code || 'KR',
      country_name: series.country_name || 'Güney Kore',
      release_year: Number(series.release_year) || new Date().getFullYear(),
      status_broadcast: series.status_broadcast || 'Devam Ediyor',
      cover_image: series.cover_image ? String(series.cover_image).trim() : '/logo-dark.png',
      backdrop_image: series.backdrop_image ? String(series.backdrop_image).trim() : String(series.cover_image || '/logo-dark.png').trim(),
      overview: series.overview ? String(series.overview).trim() : '',
      is_featured: Boolean(series.is_featured),
      tmdb_id: series.tmdb_id ? Number(series.tmdb_id) : null,
      imdb_id: series.imdb_id ? String(series.imdb_id).trim() : null,
      anilist_id: series.anilist_id ? Number(series.anilist_id) : null,
      updated_at: nowIso,
    };

    let mediaId = Number(series.id || 0);
    let savedRow: Record<string, unknown> | null = null;

    if (mediaId > 0) {
      const { data, error } = await supabase
        .from('media')
        .update(payload)
        .eq('id', mediaId)
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      savedRow = data as Record<string, unknown>;
    } else {
      const { data: maxRow } = await supabase
        .from('media')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      mediaId = Number(maxRow?.id || 10000) + 1;
      const { data, error } = await supabase
        .from('media')
        .insert({ id: mediaId, ...payload, episode_count: 0, sources_count: 0 })
        .select('*')
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      savedRow = data as Record<string, unknown>;
    }

    const syncResult = await runLocalCatalogPatch('series_upsert', { id: mediaId, ...payload });
    if (!syncResult.syncedLocalDb) {
      const existingBundle = await readR2SourceBundle(mediaId);
      if (existingBundle) {
        existingBundle.title = title;
        existingBundle.slug = slug;
        existingBundle.content_type = payload.content_type;
        await writeR2SourceBundle(mediaId, existingBundle);
      }
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: series.id ? 'series.update' : 'series.create',
      target_type: 'media',
      target_id: String(mediaId),
      summary: `"${title}" (#${mediaId}) yapımı kaydedildi ve R2/Arşiv ile eşitlendi`,
      metadata: { slug, content_type: payload.content_type, syncedLocalDb: syncResult.syncedLocalDb },
    });

    return NextResponse.json({
      ok: true,
      series: savedRow,
      syncedLocalDb: syncResult.syncedLocalDb,
    });
  }

  // 3. Series Delete (Full Storage Sync: Supabase + SQLite + R2 Bundle Delete)
  if (action === 'series_delete') {
    const mediaId = Number(body.mediaId || body.id || 0);
    if (!mediaId) {
      return NextResponse.json({ error: 'Geçersiz mediaId' }, { status: 400 });
    }

    const { data: targetMedia } = await supabase
      .from('media')
      .select('id, title, slug')
      .eq('id', mediaId)
      .maybeSingle();

    await supabase.from('episodes').delete().eq('media_id', mediaId);
    await supabase.from('series_automations').delete().eq('media_id', mediaId);
    const { error } = await supabase.from('media').delete().eq('id', mediaId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const syncResult = await runLocalCatalogPatch('series_delete', { id: mediaId });
    if (!syncResult.syncedLocalDb) {
      const s3 = getS3Client();
      if (s3) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: `sources/${mediaId}.json` }));
        } catch {
          // Ignore
        }
      }
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'series.delete',
      target_type: 'media',
      target_id: String(mediaId),
      summary: `"${targetMedia?.title || mediaId}" (#${mediaId}) yapımı tüm bölümleri ve R2 paketiyle silindi`,
      metadata: { slug: targetMedia?.slug, syncedLocalDb: syncResult.syncedLocalDb },
    });

    return NextResponse.json({ ok: true, mediaId, syncedLocalDb: syncResult.syncedLocalDb });
  }

  // 4. Episode Save / Upsert (Full Storage Sync)
  if (action === 'episode_save') {
    const ep = (body.episode || {}) as Record<string, unknown>;
    const mediaId = Number(ep.media_id || body.mediaId || 0);
    const seasonNumber = Number(ep.season_number || 1);
    const episodeNumber = Number(ep.episode_number || 0);
    if (!mediaId || !episodeNumber) {
      return NextResponse.json({ error: 'media_id ve episode_number zorunludur.' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const status = String(ep.status || 'published');
    const episodeName = String(ep.episode_name || `${episodeNumber}. Bölüm`).trim();
    const episodeType = String(ep.episode_type || 'normal');
    const scheduledPublishAt = status === 'scheduled' && ep.scheduled_publish_at ? String(ep.scheduled_publish_at) : null;
    const publishedAt = status === 'published' ? (ep.published_at ? String(ep.published_at) : nowIso) : null;
    const videoSources = Array.isArray(ep.video_sources) ? ep.video_sources : undefined;

    const upsertPayload: Record<string, unknown> = {
      media_id: mediaId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
      episode_name: episodeName,
      episode_type: episodeType,
      status,
      scheduled_publish_at: scheduledPublishAt,
      published_at: publishedAt,
    };
    if (videoSources !== undefined) {
      upsertPayload.video_sources = videoSources;
    }
    if (ep.intro_start_sec !== undefined) {
      upsertPayload.intro_start_sec = ep.intro_start_sec != null ? Number(ep.intro_start_sec) : null;
    }
    if (ep.intro_end_sec !== undefined) {
      upsertPayload.intro_end_sec = ep.intro_end_sec != null ? Number(ep.intro_end_sec) : null;
    }
    if (ep.outro_start_sec !== undefined) {
      upsertPayload.outro_start_sec = ep.outro_start_sec != null ? Number(ep.outro_start_sec) : null;
    }
    if (ep.outro_end_sec !== undefined) {
      upsertPayload.outro_end_sec = ep.outro_end_sec != null ? Number(ep.outro_end_sec) : null;
    }

    const { data: savedEp, error } = await supabase
      .from('episodes')
      .upsert(upsertPayload, { onConflict: 'media_id,season_number,episode_number' })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const syncResult = await runLocalCatalogPatch('episode_upsert', {
      media_id: mediaId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
      episode_name: episodeName,
      episode_type: episodeType,
      status,
      video_sources: videoSources,
    });

    if (!syncResult.syncedLocalDb) {
      const bundle = (await readR2SourceBundle(mediaId)) || { media_id: mediaId, episodes: [] };
      const epsList = Array.isArray(bundle.episodes) ? [...(bundle.episodes as Record<string, unknown>[])] : [];
      const existingIdx = epsList.findIndex(
        (e) => Number(e.season_number || 1) === seasonNumber && Number(e.episode_number) === episodeNumber
      );
      const updatedEntry = {
        ...(existingIdx >= 0 ? epsList[existingIdx] : {}),
        season_number: seasonNumber,
        episode_number: episodeNumber,
        episode_name: episodeName,
        episode_type: episodeType,
        status,
        sources: videoSources ?? (existingIdx >= 0 ? epsList[existingIdx].sources || [] : []),
      };
      if (existingIdx >= 0) epsList[existingIdx] = updatedEntry;
      else epsList.push(updatedEntry);
      epsList.sort(
        (a, b) =>
          Number(a.season_number || 1) - Number(b.season_number || 1) ||
          Number(a.episode_number || 0) - Number(b.episode_number || 0)
      );
      bundle.episodes = epsList;
      await writeR2SourceBundle(mediaId, bundle);
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'episode.upsert',
      target_type: 'episode',
      target_id: `${mediaId}:S${seasonNumber}E${episodeNumber}`,
      summary: `#${mediaId} S${seasonNumber}B${episodeNumber} (${episodeName}) kaydedildi`,
      metadata: { status, episodeType, syncedLocalDb: syncResult.syncedLocalDb },
    });

    return NextResponse.json({ ok: true, episode: savedEp, syncedLocalDb: syncResult.syncedLocalDb });
  }

  // 5. Episode Delete (Full Storage Sync)
  if (action === 'episode_delete') {
    const mediaId = Number(body.mediaId || 0);
    const seasonNumber = Number(body.seasonNumber || 1);
    const episodeNumber = Number(body.episodeNumber || 0);
    if (!mediaId || !episodeNumber) {
      return NextResponse.json({ error: 'mediaId ve episodeNumber zorunludur.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('episodes')
      .delete()
      .eq('media_id', mediaId)
      .eq('season_number', seasonNumber)
      .eq('episode_number', episodeNumber);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const syncResult = await runLocalCatalogPatch('episode_delete', {
      media_id: mediaId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    });

    if (!syncResult.syncedLocalDb) {
      const bundle = await readR2SourceBundle(mediaId);
      if (bundle && Array.isArray(bundle.episodes)) {
        bundle.episodes = (bundle.episodes as Record<string, unknown>[]).filter(
          (e) => !(Number(e.season_number || 1) === seasonNumber && Number(e.episode_number) === episodeNumber)
        );
        await writeR2SourceBundle(mediaId, bundle);
      }
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'episode.delete',
      target_type: 'episode',
      target_id: `${mediaId}:S${seasonNumber}E${episodeNumber}`,
      summary: `#${mediaId} S${seasonNumber}B${episodeNumber} bölümü tüm katmanlardan silindi`,
      metadata: { syncedLocalDb: syncResult.syncedLocalDb },
    });

    return NextResponse.json({ ok: true, syncedLocalDb: syncResult.syncedLocalDb });
  }

  // 6. Source Sync (Add / Delete / Reorder sources across Supabase + SQLite + R2 Bundle)
  if (action === 'source_sync') {
    const mediaId = Number(body.mediaId || 0);
    const seasonNumber = Number(body.seasonNumber || 1);
    const episodeNumber = Number(body.episodeNumber || 0);
    const episodeName = String(body.episodeName || `${episodeNumber}. Bölüm`);
    const sources = Array.isArray(body.sources) ? body.sources : [];

    if (!mediaId || !episodeNumber) {
      return NextResponse.json({ error: 'mediaId ve episodeNumber zorunludur.' }, { status: 400 });
    }

    const newStatus = sources.length > 0 ? 'published' : String(body.status || 'published');
    const { data: updatedEp, error } = await supabase
      .from('episodes')
      .upsert(
        {
          media_id: mediaId,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          episode_name: episodeName,
          status: newStatus,
          video_sources: sources,
          published_at: new Date().toISOString(),
        },
        { onConflict: 'media_id,season_number,episode_number' }
      )
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const syncResult = await runLocalCatalogPatch('source_sync', {
      media_id: mediaId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
      episode_name: episodeName,
      status: newStatus,
      video_sources: sources,
    });

    if (!syncResult.syncedLocalDb) {
      const bundle = (await readR2SourceBundle(mediaId)) || { media_id: mediaId, episodes: [] };
      const epsList = Array.isArray(bundle.episodes) ? [...(bundle.episodes as Record<string, unknown>[])] : [];
      const existingIdx = epsList.findIndex(
        (e) => Number(e.season_number || 1) === seasonNumber && Number(e.episode_number) === episodeNumber
      );
      if (existingIdx >= 0) {
        epsList[existingIdx] = {
          ...epsList[existingIdx],
          sources,
          status: newStatus,
          pending: false,
        };
      } else {
        epsList.push({
          season_number: seasonNumber,
          episode_number: episodeNumber,
          episode_name: episodeName,
          episode_type: 'normal',
          status: newStatus,
          sources,
        });
      }
      bundle.episodes = epsList;
      await writeR2SourceBundle(mediaId, bundle);
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'episode.sources_sync',
      target_type: 'episode',
      target_id: `${mediaId}:S${seasonNumber}E${episodeNumber}`,
      summary: `#${mediaId} S${seasonNumber}B${episodeNumber} video kaynakları güncellendi (${sources.length} kaynak)`,
      metadata: { sourcesCount: sources.length, syncedLocalDb: syncResult.syncedLocalDb },
    });

    return NextResponse.json({
      ok: true,
      episode: updatedEp,
      sourcesCount: sources.length,
      syncedLocalDb: syncResult.syncedLocalDb,
    });
  }

  // 7. Bulk Schedule Episodes
  if (action === 'bulk_schedule') {
    const mediaId = Number(body.mediaId || 0);
    const seasonNumber = Number(body.seasonNumber || 1);
    const fromEp = Math.max(1, Number(body.fromEp || 1));
    const toEp = Math.min(fromEp + 100, Number(body.toEp || fromEp));
    const intervalHours = Math.max(1, Number(body.intervalHours || 168));
    const startAtMs = body.startAt ? new Date(String(body.startAt)).getTime() : Date.now() + 86400_000;

    if (!mediaId || Number.isNaN(startAtMs)) {
      return NextResponse.json({ error: 'Geçersiz zamanlama parametreleri.' }, { status: 400 });
    }

    const rows = [];
    for (let epNum = fromEp; epNum <= toEp; epNum++) {
      const idx = epNum - fromEp;
      const schedIso = new Date(startAtMs + idx * intervalHours * 3600_000).toISOString();
      rows.push({
        media_id: mediaId,
        season_number: seasonNumber,
        episode_number: epNum,
        episode_name: `${epNum}. Bölüm`,
        episode_type: 'normal',
        status: 'scheduled',
        scheduled_publish_at: schedIso,
      });
    }

    const { error } = await supabase
      .from('episodes')
      .upsert(rows, { onConflict: 'media_id,season_number,episode_number' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'episode.bulk_schedule',
      target_type: 'media',
      target_id: String(mediaId),
      summary: `#${mediaId} S${seasonNumber} için ${fromEp}-${toEp}. bölümler toplu zamanlandı`,
      metadata: { seasonNumber, fromEp, toEp, intervalHours },
    });

    return NextResponse.json({ ok: true, count: rows.length });
  }

  return NextResponse.json({ error: 'Geçersiz action parametresi.' }, { status: 400 });
}
