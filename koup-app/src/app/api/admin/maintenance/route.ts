import { NextRequest, NextResponse } from 'next/server';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
  resolvePythonBinary,
} from '@/lib/adminAuth';
import { hasLocalPython, dispatchCloudScraperJob } from '@/lib/server/scraperDispatch';

export const dynamic = 'force-dynamic';

let activeMaintenanceJob: string | null = null;

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

export async function GET(req: NextRequest) {
  const auth = await verifyAdminAuth(req, { allowModerator: true });
  if (!auth.authorized) return auth.response!;

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase servis bağlantısı yapılandırılmamış.' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') || 'full';

  // 1. Measure Supabase latency & fetch settings
  const sbStart = Date.now();
  const { data: settingsRows } = await supabase.from('site_settings').select('key, value, updated_at');
  const supabaseLatencyMs = Date.now() - sbStart;

  const siteSettings: Record<string, unknown> = {};
  for (const row of settingsRows || []) {
    siteSettings[row.key] = row.value;
  }

  if (mode === 'settings') {
    return NextResponse.json({ ok: true, siteSettings, supabaseLatencyMs });
  }

  // 2. Measure Cloudflare Worker latency
  const workerUrl = process.env.NEXT_PUBLIC_CF_WORKER_URL || 'https://koup-edge-worker.caganhuseyinerdil.workers.dev';
  let workerLatencyMs = -1;
  let workerStatusOk = false;
  try {
    const wStart = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${workerUrl}/archive/sources/1.json`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    workerLatencyMs = Date.now() - wStart;
    workerStatusOk = resp.status === 200 || resp.status === 404;
  } catch {
    workerStatusOk = false;
  }

  // 3. Check R2 DB backup status via HeadObjectCommand
  let r2DbLastModified: string | null = null;
  let r2DbSizeMb: number | null = null;
  let r2DbAgeMinutes: number | null = null;
  const s3 = getS3Client();
  if (s3) {
    try {
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: process.env.CF_R2_BUCKET || 'koup-archive',
          Key: 'db/webdrama_archive.db',
        })
      );
      if (head.LastModified) {
        r2DbLastModified = head.LastModified.toISOString();
        r2DbAgeMinutes = Math.round((Date.now() - head.LastModified.getTime()) / 60_000);
      }
      if (head.ContentLength) {
        r2DbSizeMb = Math.round((head.ContentLength / (1024 * 1024)) * 10) / 10;
      }
    } catch {
      // Ignore if not found
    }
  }

  // 4. Check local SQLite status
  const rootDir = path.resolve(process.cwd(), '..');
  const localDbPath = path.join(rootDir, 'webdrama_archive.db');
  let localDbExists = false;
  let localDbSizeMb: number | null = null;
  let localDbModifiedAt: string | null = null;
  if (fs.existsSync(localDbPath)) {
    try {
      const st = fs.statSync(localDbPath);
      localDbExists = true;
      localDbSizeMb = Math.round((st.size / (1024 * 1024)) * 10) / 10;
      localDbModifiedAt = st.mtime.toISOString();
    } catch {
      // Ignore
    }
  }

  // 5. Fetch recent automation_runs & compute real scraper bot metrics
  const [runsRes, jobsRes, auditRes] = await Promise.all([
    supabase
      .from('automation_runs')
      .select('id, run_type, status, started_at, finished_at, duration_seconds, total_episodes_added, scrapers_summary, error_log')
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('admin_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(30),
    supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  const botStatsMap: Record<
    string,
    {
      id: string;
      totalRuns: number;
      successRuns: number;
      failedRuns: number;
      successRate: number;
      totalEpisodesAdded: number;
      totalDurationSec: number;
      avgDurationSec: number;
      lastRunAt: string | null;
      lastStatus: string;
    }
  > = {};

  for (const run of runsRes.data || []) {
    const summaryArr = Array.isArray(run.scrapers_summary) ? run.scrapers_summary : [];
    for (const item of summaryArr) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const botId = String(rec.id || rec.bot || rec.site || '').toLowerCase();
      if (!botId) continue;
      if (!botStatsMap[botId]) {
        botStatsMap[botId] = {
          id: botId,
          totalRuns: 0,
          successRuns: 0,
          failedRuns: 0,
          successRate: 100,
          totalEpisodesAdded: 0,
          totalDurationSec: 0,
          avgDurationSec: 0,
          lastRunAt: run.started_at || null,
          lastStatus: String(rec.status || run.status || 'completed'),
        };
      }
      const st = botStatsMap[botId];
      st.totalRuns += 1;
      const itemStatus = String(rec.status || run.status || 'completed').toLowerCase();
      if (itemStatus === 'failed' || itemStatus === 'error') {
        st.failedRuns += 1;
      } else {
        st.successRuns += 1;
      }
      st.totalEpisodesAdded += Number(rec.added || rec.episodes_added || 0);
      st.totalDurationSec += Number(rec.duration || rec.duration_seconds || 0);
    }
  }

  for (const st of Object.values(botStatsMap)) {
    st.successRate = st.totalRuns > 0 ? Math.round((st.successRuns / st.totalRuns) * 1000) / 10 : 100;
    st.avgDurationSec = st.totalRuns > 0 ? Math.round((st.totalDurationSec / st.totalRuns) * 10) / 10 : 0;
  }

  return NextResponse.json({
    ok: true,
    health: {
      supabaseLatencyMs,
      workerLatencyMs,
      workerStatusOk,
      r2DbLastModified,
      r2DbSizeMb,
      r2DbAgeMinutes,
      localDbExists,
      localDbSizeMb,
      localDbModifiedAt,
      activeMaintenanceJob,
    },
    botStats: botStatsMap,
    recentRuns: runsRes.data || [],
    adminJobs: jobsRes.data || [],
    auditLogs: auditRes.data || [],
    siteSettings,
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuth(req);
  if (!auth.authorized) return auth.response!;

  const rate = checkAdminRateLimit(`maintenance:${auth.userId}`, 25, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Çok fazla bakım isteği gönderildi. Lütfen biraz bekleyin.' }, { status: 429 });
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

  // Fast Action 1: Save Site Setting
  if (action === 'save_site_setting') {
    const key = String(body.key || '').trim();
    const value = body.value;
    const allowedKeys = new Set(['announcement_banner', 'comment_watchlist', 'scraper_defaults', 'masterpieces']);
    if (!allowedKeys.has(key) || value === undefined) {
      return NextResponse.json({ error: 'Geçersiz ayar anahtarı veya değeri.' }, { status: 400 });
    }

    const { error } = await supabase.from('site_settings').upsert(
      {
        key,
        value,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'settings.update',
      target_type: 'site_settings',
      target_id: key,
      summary: `"${key}" site ayarı güncellendi`,
      metadata: { key },
    });

    return NextResponse.json({ ok: true, key, value });
  }

  // Fast Action 2: Publish Due Scheduled Episodes
  if (action === 'publish_due_scheduled') {
    const nowIso = new Date().toISOString();
    const { data: dueRows, error: fetchErr } = await supabase
      .from('episodes')
      .select('id, media_id, season_number, episode_number')
      .eq('status', 'scheduled')
      .lte('scheduled_publish_at', nowIso)
      .limit(500);

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const ids = (dueRows || []).map((r: { id: number }) => r.id);
    if (ids.length > 0) {
      const { error: updErr } = await supabase
        .from('episodes')
        .update({ status: 'published', published_at: nowIso })
        .in('id', ids);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    await supabase.from('admin_audit_log').insert({
      actor_id: auth.userId,
      actor_role: auth.role,
      action: 'episode.publish_due_scheduled',
      target_type: 'episodes',
      target_id: 'due_batch',
      summary: `Vakti gelen ${ids.length} zamanlanmış bölüm yayına alındı`,
      metadata: { count: ids.length },
    });

    return NextResponse.json({ ok: true, publishedCount: ids.length });
  }

  // Streaming Maintenance Tools
  const tool = String(body.tool || action || '');
  const params = (body.params || {}) as Record<string, unknown>;

  const rootDir = path.resolve(process.cwd(), '..');
  const dbPath = path.join(rootDir, 'webdrama_archive.db');
  const pythonBin = resolvePythonBinary(rootDir);

  type CommandStep = { label: string; scriptRelPath: string; args: string[] };
  const steps: CommandStep[] = [];
  let jobTitle = '';

  if (tool === 'auto_heal_gaps') {
    jobTitle = 'Eksik Bölüm Onarıcı (Auto-Heal Archive Gaps)';
    const limit = Math.min(200, Math.max(1, Number(params.limit || 25)));
    const maxGap = Math.min(100, Math.max(1, Number(params.maxGap || 30)));
    const args = ['--limit', String(limit), '--max-gap', String(maxGap)];
    if (params.country && String(params.country) !== 'ALL') args.push('--country', String(params.country));
    if (params.provider && String(params.provider) !== 'all') args.push('--provider', String(params.provider));
    if (params.dramaId) args.push('--drama-id', String(Number(params.dramaId)));
    if (params.dryRun) args.push('--dry-run');
    steps.push({ label: jobTitle, scriptRelPath: path.join('scrapers', 'auto_heal_archive_gaps.py'), args });
  } else if (tool === 'recheck_pending') {
    jobTitle = 'Bekleyen Kaynak Çözücü (Recheck Pending Episodes)';
    const limit = Math.min(300, Math.max(1, Number(params.limit || 50)));
    const args = ['--limit', String(limit)];
    if (params.dramaId) args.push('--drama-id', String(Number(params.dramaId)));
    if (params.site && String(params.site) !== 'all') args.push('--site', String(params.site));
    if (params.force) args.push('--force');
    if (params.dryRun) args.push('--dry-run');
    steps.push({ label: jobTitle, scriptRelPath: path.join('scripts', 'recheck_pending_episodes.py'), args });
  } else if (tool === 'audit_catalog') {
    jobTitle = 'Katalog Sağlık Denetçisi (Audit Engine)';
    const category = String(params.category || 'korea');
    const allowedCategories = new Set(['korea', 'anime_jp', 'anime_donghua', 'asia_other', 'western', 'movies_tr']);
    const safeCat = allowedCategories.has(category) ? category : 'korea';
    const limit = Math.min(500, Math.max(5, Number(params.limit || 50)));
    steps.push({
      label: `${jobTitle} [${safeCat}]`,
      scriptRelPath: path.join('scripts', 'audit_engine.py'),
      args: ['--category', safeCat, '--limit', String(limit), '--concurrency', '40'],
    });
  } else if (tool === 'purge_dead_sources') {
    jobTitle = 'Ölü Kaynak Temizleyici (Purge Dead Sources)';
    const sample = Math.min(500, Math.max(0, Number(params.sample ?? 50)));
    const args = ['--sample', String(sample)];
    if (params.apply && !params.dryRun) args.push('--apply');
    if (params.resetCheckpoint) args.push('--reset-checkpoint');
    steps.push({ label: jobTitle, scriptRelPath: path.join('scripts', 'purge_dead_sources_full.py'), args });
  } else if (tool === 'merge_duplicates') {
    jobTitle = 'Mükerrer Yapım Birleştirici (Merge Duplicates)';
    const args: string[] = [];
    if (params.dryRun !== false) args.push('--dry-run');
    steps.push({ label: jobTitle, scriptRelPath: path.join('scripts', 'merge_duplicates.py'), args });
  } else if (tool === 'export_r2_bundles') {
    jobTitle = 'R2 Kaynak Paketlerini Dışa Aktar ve Yükle';
    steps.push({ label: 'JSON Paketlerini Oluştur', scriptRelPath: path.join('scripts', 'export_sources_bundles.py'), args: [] });
    steps.push({ label: "Cloudflare R2'ye Yükle", scriptRelPath: path.join('scripts', 'upload_to_r2.py'), args: [] });
  } else if (tool === 'sync_supabase_episodes') {
    jobTitle = 'Supabase Bölüm & Kaynak Senkronizasyonu';
    steps.push({ label: jobTitle, scriptRelPath: path.join('scripts', 'sync_all_episodes_to_supabase.py'), args: [] });
  } else if (tool === 'sync_calendars') {
    jobTitle = 'Canlı Yayın Takvimi Senkronizasyonu (TMDB & AniList)';
    steps.push({ label: jobTitle, scriptRelPath: path.join('scripts', 'sync_real_calendars.py'), args: [] });
  } else if (tool === 'backup_db_r2') {
    jobTitle = 'SQLite WAL Checkpoint & Cloudflare R2 DB Yedeği';
    steps.push({
      label: jobTitle,
      scriptRelPath: path.join('scripts', 'admin_apply_catalog_patch.py'),
      args: ['--action', 'backup_db'],
    });
  } else {
    return NextResponse.json({ error: `Bilinmeyen bakım aracı: ${tool}` }, { status: 400 });
  }

  if (activeMaintenanceJob) {
    return NextResponse.json(
      { error: `Şu anda başka bir bakım görevi çalışıyor (${activeMaintenanceJob}). Lütfen bitmesini bekleyin.` },
      { status: 409 }
    );
  }

  // Check if local environment is available
  const firstScriptPath = path.join(rootDir, steps[0].scriptRelPath);
  if (!hasLocalPython() || !fs.existsSync(firstScriptPath) || !fs.existsSync(dbPath)) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (obj: any) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch (_) {}
        };

        const nowStr = () => new Date().toTimeString().split(' ')[0];
        sendEvent({
          type: 'log',
          message: `[${nowStr()}] [Bulut] Vercel ortamı algılandı -> '${jobTitle}' görevi için GitHub Actions işçisi tetikleniyor...`,
        });

        const firstStep = steps[0];
        const scriptRel = firstStep.scriptRelPath.replace(/\\/g, '/');

        const dispatchRes = await dispatchCloudScraperJob({
          target: tool,
          script: scriptRel,
          workflowFile: 'admin_job.yml',
          args: firstStep.args,
          sendEvent: (ev) => {
            if (ev.type === 'log') {
              sendEvent({ type: 'log', message: ev.line });
            } else {
              sendEvent(ev);
            }
          },
          streamLogs: true,
        });

        sendEvent({
          type: 'result',
          ok: dispatchRes.ok,
          cloud: true,
          tool,
          message: dispatchRes.ok
            ? `[BAŞLATILDI] Bulut (Vercel) ortamında GitHub Actions işçisi tetiklendi (Run ID: ${dispatchRes.runId}).`
            : dispatchRes.error,
          error: dispatchRes.error,
        });

        try {
          controller.close();
        } catch (_) {}
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  }

  activeMaintenanceJob = tool;

  // Insert running job in public.admin_jobs
  const { data: jobRow } = await supabase
    .from('admin_jobs')
    .insert({
      job_type: tool,
      status: 'running',
      triggered_by: auth.userId,
      params,
      logs_tail: [`[BAŞLATILDI] ${jobTitle}`],
    })
    .select('id')
    .maybeSingle();

  const jobId = jobRow?.id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const logsTail: string[] = [`[BAŞLATILDI] ${jobTitle}`];
      let parsedResult: Record<string, unknown> | null = null;
      let hasFailed = false;

      const sendEvent = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // Stream closed
        }
      };

      sendEvent({ type: 'start', tool, jobTitle, jobId });

      try {
        for (const step of steps) {
          const fullScriptPath = path.join(rootDir, step.scriptRelPath);
          sendEvent({ type: 'log', message: `▶ ${step.label} başlatılıyor (${step.scriptRelPath} ${step.args.join(' ')})...` });

          const exitCode = await new Promise<number>((resolve) => {
            const proc = spawn(pythonBin, ['-u', fullScriptPath, ...step.args], {
              cwd: rootDir,
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });

            let buffer = '';
            const handleLines = (chunkStr: string) => {
              buffer += chunkStr;
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';
              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;
                if (line.startsWith('__RESULT__')) {
                  try {
                    parsedResult = JSON.parse(line.replace('__RESULT__', '').trim());
                  } catch {
                    // Ignore
                  }
                  continue;
                }
                logsTail.push(line);
                if (logsTail.length > 80) logsTail.shift();
                sendEvent({ type: 'log', message: line });
              }
            };

            proc.stdout.on('data', (d) => handleLines(d.toString('utf-8')));
            proc.stderr.on('data', (d) => handleLines(d.toString('utf-8')));
            proc.on('close', (code) => resolve(code ?? 0));
            proc.on('error', (err) => {
              sendEvent({ type: 'error', message: err.message });
              resolve(1);
            });
          });

          if (exitCode !== 0) {
            hasFailed = true;
            sendEvent({ type: 'error', message: `${step.label} hata kodu ile sonlandı (Kod: ${exitCode})` });
            break;
          }
        }
      } finally {
        activeMaintenanceJob = null;
        const finalStatus = hasFailed ? 'failed' : 'completed';
        const nowIso = new Date().toISOString();

        if (jobId) {
          await supabase
            .from('admin_jobs')
            .update({
              status: finalStatus,
              logs_tail: logsTail,
              result_summary: parsedResult || { ok: !hasFailed },
              finished_at: nowIso,
            })
            .eq('id', jobId);
        }

        await supabase.from('admin_audit_log').insert({
          actor_id: auth.userId,
          actor_role: auth.role,
          action: `maintenance.${tool}`,
          target_type: 'maintenance_job',
          target_id: jobId ? String(jobId) : tool,
          summary: `${jobTitle} (${finalStatus === 'completed' ? 'Başarılı' : 'Hatalı'})`,
          metadata: { params, result: parsedResult },
        });

        sendEvent({
          type: 'done',
          ok: !hasFailed,
          jobId,
          result: parsedResult,
        });
        try {
          controller.close();
        } catch {
          // Ignore
        }
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
