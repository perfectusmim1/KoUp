import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { verifyAdminAuth, resolvePythonBinary } from '@/lib/adminAuth';
import { hasLocalPython, dispatchCloudScraperJob } from '@/lib/server/scraperDispatch';
import { supabaseAdmin } from '@/lib/supabase';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { cleanSourceName } from '@/lib/cleanFansub';

const ANIMECIX_KEY_RAW = Buffer.from('i4C7R2fXGocdYgFLzCbDlsJjukf8G58b', 'utf-8');

function makeAnimecixHeader(queryStr: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ANIMECIX_KEY_RAW, iv);
  const plaintext = Buffer.from('{version}' + queryStr, 'utf-8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `${enc.toString('base64')}.${iv.toString('base64')}`;
}

function cleanAnimecixProvider(name: string, url: string): string {
  const urlLow = (url || '').toLowerCase();
  const nameLow = (name || '').toLowerCase();
  if (urlLow.includes('tau-video') || nameLow.includes('tau-video') || nameLow.includes('tau')) {
    return 'tau-video';
  }
  if (urlLow.includes('sibnet.ru')) return 'sibnet';
  if (urlLow.includes('ok.ru') || urlLow.includes('odnoklassniki')) return 'ok.ru';
  if (urlLow.includes('drive.google.com')) return 'googledrive';
  if (urlLow.includes('mega.nz')) return 'mega';
  if (urlLow.includes('dailymotion.com')) return 'dailymotion';
  if (urlLow.includes('dood')) return 'doodstream';
  if (urlLow.includes('uqload')) return 'uqload';
  if (urlLow.includes('mp4upload')) return 'mp4upload';
  if (urlLow.includes('sendvid')) return 'sendvid';
  if (urlLow.includes('mail.ru')) return 'mail.ru';
  if (nameLow) return nameLow.replace(/\s+/g, '');
  return 'embed';
}

async function fetchAnimecixFromCloud(endpoint: string, qs: string): Promise<any | null> {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const searchMatch = endpoint === 'titles' && qs ? qs.match(/(?:^|&)query=([^&]+)/) : null;
  const searchQueryEnc = searchMatch?.[1] || null;

  // 1. Primary: Cloudflare Edge Worker (/pichive-proxy with _=.mp4 suffix)
  try {
    const targetUrl = searchQueryEnc
      ? `https://animecix.tv/secure/search/${searchQueryEnc}?limit=12&_=.mp4`
      : `https://animecix.tv/secure/${endpoint}?${qs}&_=.mp4`;
    const edgeUrl = `https://koup-edge-worker.caganhuseyinerdil.workers.dev/pichive-proxy?url=${encodeURIComponent(
      targetUrl
    )}&ref=${encodeURIComponent('https://animecix.tv/')}`;
    const edgeRes = await fetch(edgeUrl, {
      headers: { Accept: 'application/json', 'User-Agent': ua },
      signal: AbortSignal.timeout(9000),
    });
    if (edgeRes.ok) {
      const data = await edgeRes.json();
      if (endpoint === 'titles' && !data?.pagination && Array.isArray(data?.results)) {
        return { pagination: { data: data.results, last_page: 1 } };
      }
      if (data && (data.pagination || data.results || data.data)) {
        return data;
      }
    }
  } catch {}

  // 2. Fallback: Direct mirror domains with X-E-H header
  const h = makeAnimecixHeader(qs || '');
  for (const dom of ['https://animecix.tv', 'https://animecix.net', 'https://mangacix.net']) {
    try {
      const url = qs ? `${dom}/secure/${endpoint}?${qs}` : `${dom}/secure/${endpoint}`;
      const res = await fetch(url, {
        headers: {
          'X-E-H': h,
          Accept: 'application/json',
          Referer: `${dom}/`,
          Origin: dom,
          'User-Agent': ua,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (endpoint !== 'titles' || data?.pagination || data?.results) {
          return data;
        }
      }
      if (searchQueryEnc) {
        const sRes = await fetch(`${dom}/secure/search/${searchQueryEnc}?limit=12`, {
          headers: { Accept: 'application/json', Referer: `${dom}/`, 'User-Agent': ua },
          signal: AbortSignal.timeout(8000),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData?.results)) {
            return { pagination: { data: sData.results, last_page: 1 } };
          }
        }
      }
    } catch {}
  }

  return null;
}

type PrefetchedAnimecix = {
  animeId: number;
  targetName?: string;
  isMovie?: boolean;
  videos: any[];
};

const ANIMECIX_DEAD_HOSTS = [
  'sibnet', 'sendvid', 'drive.google.com', 'docs.google.com', 'dood', 'short.icu',
  'pixeldrain', '4meplayer', 'upns.one', 'vudeo.', 'streamsb.', 'streamtape.com/e/',
];

function getR2Client(): S3Client | null {
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.CF_R2_ENDPOINT;
  if (!accessKeyId || !secretAccessKey || !endpoint) return null;
  return new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
}

/**
 * Direct Vercel-side AnimeciX merge: AnimeciX videos -> R2 sources/{id}.json + Supabase episodes/media.
 * Works without GitHub Actions; the follow-up Python run reconciles the R2 bundle back into SQLite.
 */
async function runDirectAnimecixSync(
  dramaId: number,
  pre: PrefetchedAnimecix,
  log: (line: string) => void,
  manualUrl?: string
): Promise<{ episodesAdded: number; sourcesAdded: number }> {
  const animeId = Number(pre.animeId);
  if (!Number.isInteger(animeId) || animeId <= 0) return { episodesAdded: 0, sourcesAdded: 0 };
  const videos = Array.isArray(pre.videos) ? pre.videos.slice(0, 4000) : [];

  // Resolve missing episode_num from episode_id ordering per season
  const bySeason = new Map<number, Map<number, number | null>>();
  for (const v of videos) {
    const s = Number(v?.season_num || 1);
    const eid = Number(v?.episode_id || 0);
    if (!eid) continue;
    if (!bySeason.has(s)) bySeason.set(s, new Map());
    const m = bySeason.get(s)!;
    if (!m.has(eid) || v?.episode_num != null) m.set(eid, v?.episode_num != null ? Number(v.episode_num) : null);
  }
  const eidToNum = new Map<number, number>();
  for (const m of bySeason.values()) {
    let cur = 0;
    for (const eid of [...m.keys()].sort((a, b) => a - b)) {
      const known = m.get(eid);
      cur = known != null ? known : cur + 1;
      eidToNum.set(eid, cur);
    }
  }

  // Load existing R2 bundle
  const s3 = getR2Client();
  const bucket = process.env.CF_R2_BUCKET || 'koup-archive';
  let bundle: any = null;
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `sources/${dramaId}.json` }));
      if (res.Body) bundle = JSON.parse(await res.Body.transformToString());
    } catch {}
  }
  const { data: mediaRow } = await supabaseAdmin
    .from('media')
    .select('id, title, slug, content_type, episode_count')
    .eq('id', dramaId)
    .maybeSingle();
  if (!bundle || !Array.isArray(bundle.episodes)) {
    bundle = {
      media_id: dramaId,
      title: mediaRow?.title || pre.targetName || '',
      slug: mediaRow?.slug || '',
      content_type: mediaRow?.content_type || 'anime',
      episodes: [],
    };
  }

  const isDragonBall = dramaId === 6997 || animeId === 84 || mediaRow?.slug === 'dragon-ball';
  const isAnime = (mediaRow?.content_type || bundle.content_type) === 'anime';
  const existingSeasons = new Set(bundle.episodes.map((e: any) => Number(e.season_number || 1)));
  const hasOnlySingleSeason = existingSeasons.size <= 1;

  // Check explicit season in title or manualUrl
  const parseExplicitSeason = (title?: string, url?: string): number | null => {
    const uMatch = (url || '').match(/(?:season|sezon)[/-](\d+)/i) || (url || '').match(/[?&]season=(\d+)/i);
    if (uMatch) {
      const s = parseInt(uMatch[1], 10);
      if (!Number.isNaN(s) && s > 0) return s;
    }
    const tMatch = (title || '').match(/(\d+)\s*\.\s*sezon/i) ||
                   (title || '').match(/season\s*(\d+)/i) ||
                   (title || '').match(/(\d+)(?:st|nd|rd|th)\s*season/i);
    if (tMatch) {
      const s = parseInt(tMatch[1], 10);
      if (!Number.isNaN(s) && s > 0) return s;
    }
    return null;
  };
  const explicitSeason = parseExplicitSeason(mediaRow?.title || bundle.title, manualUrl);

  const epMap = new Map<string, any>();
  for (const ep of bundle.episodes) epMap.set(`${ep.season_number || 1}-${ep.episode_number}`, ep);
  const existingUrls = new Set<string>();
  for (const ep of bundle.episodes) for (const s of ep.sources || []) if (s?.direct_url) existingUrls.add(s.direct_url);

  let episodesAdded = 0;
  let sourcesAdded = 0;
  const touched = new Set<string>();

  for (const v of videos) {
    if (Number(v?.title_id || animeId) !== animeId) continue;
    const url = String(v?.url || '').trim();
    if (!/^https?:\/\//i.test(url) || existingUrls.has(url)) continue;
    const low = url.toLowerCase();
    const name = String(v?.name || '');
    if (
      v?.type === 'trailer' || v?.category === 'trailer' || /youtu\.?be/.test(low) ||
      name.toLowerCase().includes('trailer') || name.toLowerCase().includes('fragman') ||
      ANIMECIX_DEAD_HOSTS.some((d) => low.includes(d)) || low.endsWith('/e/')
    ) continue;

    let eNum: number | null = v?.episode_num != null ? Number(v.episode_num) : null;
    if (eNum == null && v?.episode_id) eNum = eidToNum.get(Number(v.episode_id)) ?? null;
    if (eNum == null && !pre.isMovie) continue;
    const rawSeasonNum = Number(v?.season_num || 1);
    const eFinal = eNum || 1;

    let sNum = rawSeasonNum;
    if (isDragonBall) {
      sNum = 1;
      if (eFinal > 153) continue;
    } else if (isAnime && hasOnlySingleSeason) {
      if (explicitSeason) {
        if (rawSeasonNum !== explicitSeason) continue;
        sNum = 1;
      } else {
        if (rawSeasonNum !== 1) continue;
        sNum = 1;
      }
    }

    const key = `${sNum}-${eFinal}`;

    let ep = epMap.get(key);
    if (!ep) {
      ep = {
        id: -(animeId * 100000 + sNum * 10000 + eFinal),
        season_number: sNum,
        episode_number: eFinal,
        episode_name: `Bölüm ${eFinal}`,
        episode_type: 'bolum',
        status: 'published',
        sources: [],
      };
      epMap.set(key, ep);
      bundle.episodes.push(ep);
      episodesAdded++;
    }

    const prov = cleanAnimecixProvider(name, url);
    const base =
      prov === 'tau-video' ? 'Tau Video' : prov === 'uqload' ? 'Uqload' : prov === 'mp4upload' ? 'Mp4Upload'
      : prov === 'ok.ru' ? 'OK.ru HD' : prov === 'mail.ru' ? 'Mail.ru HD' : cleanSourceName(name || prov);
    ep.sources.push({
      id: Number(v?.id) || Date.now(),
      source_name: base,
      provider: prov,
      direct_url: url,
      embed_id: `animecix_${v?.id || ''}`,
      site: 'animecix',
      fansub: null,
      quality_label: '1080p',
    });
    ep.status = 'published';
    existingUrls.add(url);
    sourcesAdded++;
    touched.add(key);
  }

  if (sourcesAdded === 0) {
    log(`[AnimeciX] #${animeId}: Yeni bölüm/kaynak yok (arşiv güncel).`);
    return { episodesAdded, sourcesAdded };
  }

  bundle.episodes.sort(
    (a: any, b: any) => (a.season_number || 1) - (b.season_number || 1) || a.episode_number - b.episode_number
  );
  // Tau Video first, then Uqload
  for (const ep of bundle.episodes) {
    const pr = (s: any) => (s.provider === 'tau-video' ? 0 : s.provider === 'uqload' ? 1 : 2);
    ep.sources.sort((a: any, b: any) => pr(a) - pr(b));
  }

  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `sources/${dramaId}.json`,
        Body: JSON.stringify(bundle),
        ContentType: 'application/json',
        CacheControl: 'public, max-age=60',
      })
    );
    log(`[R2] sources/${dramaId}.json güncellendi.`);
  }

  // Supabase episodes upsert (preserve published_at of existing rows)
  const nowIso = new Date().toISOString();
  const { data: existingRows } = await supabaseAdmin
    .from('episodes')
    .select('season_number, episode_number, status, published_at')
    .eq('media_id', dramaId);
  const existMap = new Map<string, any>();
  for (const r of existingRows || []) existMap.set(`${r.season_number || 1}-${r.episode_number}`, r);

  let newlyPublished = false;
  const rows = bundle.episodes
    .filter((ep: any) => touched.has(`${ep.season_number || 1}-${ep.episode_number}`))
    .map((ep: any) => {
      const k = `${ep.season_number || 1}-${ep.episode_number}`;
      const ex = existMap.get(k);
      let publishedAt = ex?.published_at || null;
      if (!ex || ex.status === 'pending_source' || ex.status === 'placeholder') {
        publishedAt = nowIso;
        newlyPublished = true;
      }
      return {
        media_id: dramaId,
        season_number: ep.season_number || 1,
        episode_number: ep.episode_number,
        episode_name: ep.episode_name || `Bölüm ${ep.episode_number}`,
        episode_type: ep.episode_type || 'normal',
        status: 'published',
        video_sources: ep.sources,
        published_at: publishedAt,
      };
    });
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabaseAdmin
      .from('episodes')
      .upsert(rows.slice(i, i + 50), { onConflict: 'media_id,season_number,episode_number' });
    if (error) log(`[UYARI] Supabase episodes: ${error.message}`);
  }

  const publishedCount = bundle.episodes.filter((e: any) => !e.pending && (e.sources || []).length > 0).length;
  const maxEpInBundle = Math.max(0, ...bundle.episodes.map((e: any) => Number(e.episode_number) || 0));
  const newTotalEpisodes = Math.max(publishedCount, maxEpInBundle);
  const nextEpisodeNumber = newTotalEpisodes + 1;

  const mediaPatch: Record<string, any> = {
    episode_count: Math.max(bundle.episodes.length, mediaRow?.episode_count || 0),
    episodes_available: newTotalEpisodes,
    next_episode_number: nextEpisodeNumber,
    updated_at: nowIso,
  };
  if (newlyPublished) {
    mediaPatch.last_published_episode = maxEpInBundle || 1;
    mediaPatch.last_published_at = nowIso;
  }
  await supabaseAdmin.from('media').update(mediaPatch).eq('id', dramaId);

  // Keep calendar_schedules synchronized with the updated next_episode_number
  await supabaseAdmin
    .from('calendar_schedules')
    .update({
      next_episode_number: nextEpisodeNumber,
      episode_label: `${nextEpisodeNumber}. Bölüm`,
    })
    .or(`media_id.eq.${dramaId},slug.eq.${bundle.slug || ''}`);

  log(`[Supabase] media, episodes & calendar_schedules güncellendi (Sıradaki Bölüm: ${nextEpisodeNumber}).`);

  return { episodesAdded, sourcesAdded };
}

function getPythonPath(): string {
  return resolvePythonBinary();
}

/**
 * GET: Retrieve real-time sync job status and logs (or proxy AnimeciX from EU region)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Lightweight EU Proxy for GitHub Actions Python runners
    if (searchParams.get('proxyAnimecix') === '1') {
      const svcHeader = req.headers.get('x-service-key') || '';
      const validSvcKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
      const isSvcAuth = Boolean(validSvcKey && svcHeader && svcHeader === validSvcKey);
      if (!isSvcAuth) {
        const authCheck = await verifyAdminAuth(req);
        if (!authCheck.authorized) {
          return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
        }
      }
      const endpoint = searchParams.get('endpoint') || 'titles';
      const qs = searchParams.get('qs') || '';
      const data = await fetchAnimecixFromCloud(endpoint, qs);
      if (!data) {
        return NextResponse.json({ error: 'AnimeciX upstream unreachable' }, { status: 502 });
      }
      return NextResponse.json(data);
    }

    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const jobId = searchParams.get('jobId');
    const dramaIdStr = searchParams.get('dramaId');

    let job: any = null;

    if (jobId) {
      const { data } = await supabaseAdmin
        .from('admin_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      job = data;
    } else if (dramaIdStr) {
      const dramaIdNum = parseInt(dramaIdStr, 10);
      if (!isNaN(dramaIdNum)) {
        const { data } = await supabaseAdmin
          .from('admin_jobs')
          .select('*')
          .eq('kind', 'sync_series')
          .contains('params', { dramaId: dramaIdNum })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        job = data;
      }
    }

    // GitHub Actions API status self-healing check:
    // If job is in 'queued' or 'running' for more than 15 seconds, check GitHub's workflow run status
    if (job && (job.status === 'queued' || job.status === 'running') && job.runner === 'github_actions') {
      const elapsedSec = (Date.now() - new Date(job.created_at).getTime()) / 1000;
      const ghToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GH_PAT;

      if (elapsedSec > 12 && ghToken) {
        try {
          const ghRes = await fetch(
            'https://api.github.com/repos/perfectusmim1/KoUp/actions/workflows/sync_single_series.yml/runs?per_page=3',
            {
              headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'KoUp-App',
              },
              cache: 'no-store',
            }
          );

          if (ghRes.ok) {
            const ghData = await ghRes.json();
            const latestRun = ghData?.workflow_runs?.[0];
            if (latestRun) {
              const runCreatedTime = new Date(latestRun.created_at).getTime();
              const jobCreatedTime = new Date(job.created_at).getTime();

              // If run matches job creation window (+/- 3 minutes)
              if (Math.abs(runCreatedTime - jobCreatedTime) < 180000) {
                if (latestRun.status === 'in_progress' && job.status === 'queued') {
                  await supabaseAdmin
                    .from('admin_jobs')
                    .update({
                      status: 'running',
                      progress: 30,
                      external_ref: latestRun.html_url,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', job.id);
                  job.status = 'running';
                  job.progress = 30;
                  job.external_ref = latestRun.html_url;
                } else if (latestRun.status === 'completed') {
                  const isSuccess = latestRun.conclusion === 'success';
                  const finalStatus = isSuccess ? 'completed' : 'failed';
                  await supabaseAdmin
                    .from('admin_jobs')
                    .update({
                      status: finalStatus,
                      progress: 100,
                      external_ref: latestRun.html_url,
                      finished_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', job.id);
                  job.status = finalStatus;
                  job.progress = 100;
                  job.external_ref = latestRun.html_url;
                }
              }
            }
          }
        } catch {
          // ignore GitHub polling error
        }
      }
    }

    return NextResponse.json({ ok: true, job: job || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}

/**
 * POST: Trigger single series live synchronization
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Strict Admin Authentication
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    // 2. Parse request parameters
    const body = await req.json();
    const { dramaId, slug, provider = 'auto', manualUrl, dramaTitle, prefetchedAnimecix } = body as {
      dramaId: number;
      slug?: string;
      provider?: string;
      manualUrl?: string;
      dramaTitle?: string;
      prefetchedAnimecix?: PrefetchedAnimecix;
    };

    if (!dramaId || typeof dramaId !== 'number') {
      return NextResponse.json({ error: 'Geçerli bir dramaId gereklidir.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scrapers', 'sync_target_drama.py');
    const isLocalPython = hasLocalPython() && fs.existsSync(scriptPath);

    const encoder = new TextEncoder();
    const nowStr = () => new Date().toTimeString().split(' ')[0];

    // 3. Create persistent tracking record in Supabase admin_jobs table
    const initialLogs = [
      `[${nowStr()}] [Başlatıldı] Dizi #${dramaId} için senkronizasyon kuyruğu oluşturuldu (Sağlayıcı: ${provider.toUpperCase()})`,
    ];

    const { data: jobRow, error: jobErr } = await supabaseAdmin
      .from('admin_jobs')
      .insert({
        kind: 'sync_series',
        title: `${dramaTitle || 'Dizi'} Senkronizasyonu (#${dramaId})`,
        params: { dramaId, slug, provider, manualUrl },
        status: 'queued',
        progress: 10,
        runner: isLocalPython ? 'local' : 'github_actions',
        created_by: authCheck.userId,
        started_at: new Date().toISOString(),
        logs: initialLogs,
      })
      .select('id')
      .single();

    if (jobErr) {
      console.warn('[SYNC_JOB_INSERT_WARNING]', jobErr.message);
    }
    const jobId = jobRow?.id || `temp-${Date.now()}`;

    // =========================================================================
    // PRODUCTION / VERCEL: DISPATCH GITHUB ACTIONS BULUT SENKRONİZASYONU
    // =========================================================================
    if (!isLocalPython) {
      const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GH_PAT;
      if (!githubToken) {
        if (jobId && !jobId.startsWith('temp-')) {
          await supabaseAdmin
            .from('admin_jobs')
            .update({
              status: 'failed',
              error_message: 'GITHUB_TOKEN ortam değişkeni eksik.',
              finished_at: new Date().toISOString(),
            })
            .eq('id', jobId);
        }
        return NextResponse.json(
          { error: 'GitHub Actions erişim anahtarı (GITHUB_TOKEN) sunucu ortamında tanımlı değil.' },
          { status: 500 }
        );
      }

      const stream = new ReadableStream({
        async start(controller) {
          const sendEvent = (obj: any) => {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
            } catch (_) {}
          };

          sendEvent({
            type: 'job_created',
            jobId,
            dramaId,
            provider,
            status: 'queued',
          });

          sendEvent({
            type: 'log',
            line: `[${nowStr()}] [Bulut] Vercel Serverless ortamı algılandı -> GitHub Actions bulut motoru tetikleniyor...`,
          });
          sendEvent({
            type: 'log',
            line: `[${nowStr()}] [Bulut] Dizi #${dramaId} için hedef sağlayıcı: ${provider.toUpperCase()}${manualUrl ? ` (${manualUrl})` : ''}`,
          });

          // Instant AnimeciX sync directly on Vercel (no GitHub Actions wait, no datacenter IP block)
          let directAnimecix: { episodesAdded: number; sourcesAdded: number } | null = null;
          const isAnimecixRequest =
            provider === 'animecix' || /animecix|mangacix/i.test(manualUrl || '') || Boolean(prefetchedAnimecix);
          if (isAnimecixRequest) {
            try {
              let pre: PrefetchedAnimecix | null =
                prefetchedAnimecix && Array.isArray(prefetchedAnimecix.videos) && prefetchedAnimecix.videos.length > 0
                  ? prefetchedAnimecix
                  : null;
              if (!pre) {
                const idMatch = (manualUrl || '').match(/\/titles\/(\d+)/i);
                const aid = idMatch ? parseInt(idMatch[1], 10) : 0;
                if (aid > 0) {
                  const vids: any[] = [];
                  for (let page = 1; page <= 20; page++) {
                    const d = await fetchAnimecixFromCloud('videos', `titleId=${aid}&page=${page}&perPage=100`);
                    const pv: any[] = d?.pagination?.data || [];
                    if (!pv.length) break;
                    vids.push(...pv);
                    if (page >= Number(d?.pagination?.last_page || 1)) break;
                  }
                  if (vids.length) pre = { animeId: aid, videos: vids };
                }
              }
              if (pre) {
                const logs: string[] = [];
                directAnimecix = await runDirectAnimecixSync(
                  dramaId,
                  pre,
                  (l) => {
                    const line = `[${nowStr()}] ${l}`;
                    logs.push(line);
                    sendEvent({ type: 'log', line });
                  },
                  manualUrl
                );
                const doneLine = `[${nowStr()}] [TAMAMLANDI] AnimeciX anlık eşitleme: +${directAnimecix.episodesAdded} yeni bölüm, +${directAnimecix.sourcesAdded} yeni kaynak.`;
                sendEvent({ type: 'log', line: doneLine });
                if (jobId && !jobId.startsWith('temp-')) {
                  await supabaseAdmin
                    .from('admin_jobs')
                    .update({
                      status: 'completed',
                      progress: 100,
                      runner: 'vercel',
                      logs: [...initialLogs, ...logs, doneLine],
                      result: { ok: true, dramaId, provider: 'animecix', ...directAnimecix },
                      finished_at: new Date().toISOString(),
                    })
                    .eq('id', jobId);
                }
              }
            } catch (e: any) {
              sendEvent({ type: 'log', line: `[${nowStr()}] [UYARI] Anlık AnimeciX eşitleme hatası: ${e?.message || e}` });
            }
          }

          if (directAnimecix) {
            // Background GitHub Actions run (fire-and-forget) reconciles R2 bundle into SQLite archive + R2 DB backup
            fetch(
              'https://api.github.com/repos/perfectusmim1/KoUp/actions/workflows/sync_single_series.yml/dispatches',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${githubToken}`,
                  Accept: 'application/vnd.github.v3+json',
                  'User-Agent': 'KoUp-App',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ref: 'main',
                  inputs: {
                    drama_id: String(dramaId),
                    provider: 'animecix',
                    manual_url: prefetchedAnimecix?.animeId
                      ? `https://animecix.tv/titles/${prefetchedAnimecix.animeId}`
                      : (manualUrl || '').trim(),
                    job_id: '',
                  },
                }),
              }
            ).catch(() => {});

            sendEvent({
              type: 'result',
              ok: true,
              cloud: false,
              jobId,
              dramaId,
              provider: 'animecix',
              episodesAdded: directAnimecix.episodesAdded,
              sourcesAdded: directAnimecix.sourcesAdded,
              timestamp: new Date().toISOString(),
            });
            try {
              controller.close();
            } catch (_) {}
            return;
          }

          try {
            const ghRes = await fetch(
              'https://api.github.com/repos/perfectusmim1/KoUp/actions/workflows/sync_single_series.yml/dispatches',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${githubToken}`,
                  Accept: 'application/vnd.github.v3+json',
                  'User-Agent': 'KoUp-App',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  ref: 'main',
                  inputs: {
                    drama_id: String(dramaId),
                    provider: provider || 'auto',
                    manual_url: (manualUrl || '').trim(),
                    job_id: jobId || '',
                  },
                }),
              }
            );

            if (!ghRes.ok) {
              const errText = await ghRes.text();
              if (jobId && !jobId.startsWith('temp-')) {
                await supabaseAdmin
                  .from('admin_jobs')
                  .update({
                    status: 'failed',
                    error_message: `GitHub API (${ghRes.status}): ${errText}`,
                    finished_at: new Date().toISOString(),
                  })
                  .eq('id', jobId);
              }
              sendEvent({
                type: 'error',
                error: `GitHub Actions API hatası (${ghRes.status}): ${errText}`,
              });
            } else {
              const queueMsg = `[${nowStr()}] [Kuyrukta] GitHub Actions iş parçacığı başarıyla kuyruğa alındı!`;
              sendEvent({
                type: 'log',
                line: queueMsg,
              });
              sendEvent({
                type: 'log',
                line: `[${nowStr()}] [Canlı Takip] Supabase Realtime ile iş parçacığı anlık olarak izleniyor (~1 dk).`,
              });

              if (jobId && !jobId.startsWith('temp-')) {
                await supabaseAdmin
                  .from('admin_jobs')
                  .update({
                    status: 'queued',
                    progress: 15,
                    logs: [...initialLogs, queueMsg],
                  })
                  .eq('id', jobId);
              }

              sendEvent({
                type: 'result',
                ok: true,
                cloud: true,
                jobId,
                dramaId,
                provider,
                message: 'GitHub Actions bulut senkronizasyonu başlatıldı! Canlı olarak izleniyor...',
                actionsUrl: 'https://github.com/perfectusmim1/KoUp/actions',
                timestamp: new Date().toISOString(),
              });
            }
          } catch (ghErr: any) {
            sendEvent({
              type: 'error',
              error: ghErr.message || 'GitHub Actions tetiklenirken beklenmeyen bir hata oluştu.',
            });
          } finally {
            try {
              controller.close();
            } catch (_) {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    // =========================================================================
    // LOCALHOST / DEVELOPMENT: RUN LOCAL PYTHON SCRIPT DIRECTLY
    // =========================================================================
    const pythonBin = resolvePythonBinary();
    const args = [
      '-u',
      path.resolve(process.cwd(), '..', 'scripts', 'sync_single_series_runner.py'),
      '--drama-id',
      String(dramaId),
      '--provider',
      provider,
      '--job-id',
      jobId,
    ];

    if (manualUrl && typeof manualUrl === 'string' && manualUrl.trim().length > 0) {
      args.push('--manual-url', manualUrl.trim());
    }

    const stream = new ReadableStream({
      start(controller) {
        const logs: string[] = [...initialLogs];
        let resultPayload: any = null;
        let stdoutBuf = '';
        let closed = false;

        const sendEvent = (obj: any) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch (_) {}
        };

        sendEvent({
          type: 'job_created',
          jobId,
          dramaId,
          provider,
          status: 'running',
        });

        const processLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line) return;
          if (line.startsWith('__RESULT__ ')) {
            try {
              resultPayload = JSON.parse(line.replace('__RESULT__ ', '').trim());
            } catch (_) {}
          } else if (line.startsWith('[')) {
            logs.push(line);
            sendEvent({ type: 'log', line });
          }
        };

        const child = spawn(pythonBin, args, {
          cwd: path.resolve(process.cwd(), '..'),
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1',
          },
        });

        const killTimer = setTimeout(() => {
          try {
            child.kill('SIGTERM');
          } catch (_) {}
        }, 120000);

        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString('utf-8');
          const parts = stdoutBuf.split(/\r?\n/);
          stdoutBuf = parts.pop() || '';
          for (const part of parts) {
            processLine(part);
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const errText = chunk.toString('utf-8').trim();
          if (errText && !errText.includes('Warning')) {
            const errLine = `[${nowStr()}] [UYARI] ${errText.split(/\r?\n/)[0].slice(0, 160)}`;
            logs.push(errLine);
            sendEvent({ type: 'log', line: errLine });
          }
        });

        child.on('close', async (code) => {
          clearTimeout(killTimer);
          if (stdoutBuf.trim()) {
            processLine(stdoutBuf);
            stdoutBuf = '';
          }

          // Double Fail-safe: Ensure newly generated bundle is uploaded to Cloudflare R2 bucket
          try {
            const bundlePath = path.resolve(process.cwd(), '..', 'r2_bundles', 'sources', `${dramaId}.json`);
            if (fs.existsSync(bundlePath)) {
              const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
              const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
              const endpoint = process.env.CF_R2_ENDPOINT;
              const bucket = process.env.CF_R2_BUCKET || 'koup-archive';
              if (accessKeyId && secretAccessKey && endpoint) {
                const s3 = new S3Client({
                  region: 'auto',
                  endpoint,
                  credentials: { accessKeyId, secretAccessKey },
                });
                const fileBuf = fs.readFileSync(bundlePath);
                await s3.send(
                  new PutObjectCommand({
                    Bucket: bucket,
                    Key: `sources/${dramaId}.json`,
                    Body: fileBuf,
                    ContentType: 'application/json',
                    CacheControl: 'public, max-age=60',
                  })
                );
              }
            }
          } catch (r2Err) {
            console.error('[SYNC_R2_UPLOAD_ERROR]', r2Err);
          }

          const isSuccess = code === 0;

          if (isSuccess) {
            try {
              // Ensure media.episodes_available, next_episode_number and calendar_schedules are up-to-date
              const { data: epRows } = await supabaseAdmin
                .from('episodes')
                .select('episode_number')
                .eq('media_id', dramaId)
                .order('episode_number', { ascending: false });

              const maxEp = epRows && epRows.length > 0 ? Number(epRows[0].episode_number || 0) : 0;
              const epCount = epRows?.length || 0;
              const actualMax = Math.max(maxEp, epCount);
              if (actualMax > 0) {
                const nextNum = actualMax + 1;
                await supabaseAdmin
                  .from('media')
                  .update({
                    episodes_available: actualMax,
                    next_episode_number: nextNum,
                  })
                  .eq('id', dramaId);

                await supabaseAdmin
                  .from('calendar_schedules')
                  .update({
                    next_episode_number: nextNum,
                    episode_label: `${nextNum}. Bölüm`,
                  })
                  .eq('media_id', dramaId);
              }
            } catch (syncSchedErr) {
              console.error('[SYNC_SCHEDULE_UPDATE_ERROR]', syncSchedErr);
            }
          }

          if (!resultPayload) {
            resultPayload = {
              ok: isSuccess,
              dramaId,
              provider,
              episodesAdded: 0,
              sourcesAdded: 0,
              timestamp: new Date().toISOString(),
            };
          }

          if (jobId && !jobId.startsWith('temp-')) {
            await supabaseAdmin
              .from('admin_jobs')
              .update({
                status: isSuccess ? 'completed' : 'failed',
                progress: 100,
                logs,
                result: resultPayload,
                finished_at: new Date().toISOString(),
              })
              .eq('id', jobId);
          }

          sendEvent({
            type: 'result',
            ok: isSuccess,
            cloud: false,
            jobId,
            dramaId,
            dramaTitle: resultPayload.dramaTitle || '',
            provider: resultPayload.provider || provider,
            episodesAdded: resultPayload.episodesAdded ?? 0,
            sourcesAdded: resultPayload.sourcesAdded ?? 0,
            logs,
            timestamp: resultPayload.timestamp || new Date().toISOString(),
          });

          closed = true;
          try {
            controller.close();
          } catch (_) {}
        });

        child.on('error', (err) => {
          clearTimeout(killTimer);
          sendEvent({
            type: 'error',
            error: err.message || 'Senkronizasyon alt işlemi başlatılamadı',
          });
          closed = true;
          try {
            controller.close();
          } catch (_) {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err: any) {
    console.error('Single series sync error:', err);
    return NextResponse.json(
      { error: err.message || 'Senkronizasyon işlemi sırasında beklenmeyen bir hata oluştu.' },
      { status: 500 }
    );
  }
}
