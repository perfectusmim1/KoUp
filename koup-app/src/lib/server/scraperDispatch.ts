import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getServiceSupabase, resolvePythonBinary } from '@/lib/adminAuth';

export interface DispatchCloudOptions {
  target?: string;
  script: string;
  args?: string[];
  workflowFile?: string;
  inputs?: Record<string, string>;
  sendEvent?: (event: any) => void;
  streamLogs?: boolean;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface DispatchCloudResult {
  ok: boolean;
  cloud: boolean;
  runId: string;
  target?: string;
  script: string;
  message?: string;
  error?: string;
}

let cachedHasPython: boolean | null = null;

export function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NEXT_RUNTIME === 'edge' ||
    process.env.CF_PAGES
  );
}

export function hasLocalPython(): boolean {
  if (isServerlessRuntime()) {
    return false;
  }
  if (cachedHasPython !== null) {
    return cachedHasPython;
  }
  try {
    const pythonBin = resolvePythonBinary();
    const probe = spawnSync(pythonBin, ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    });
    cachedHasPython = probe.status === 0;
    return cachedHasPython;
  } catch {
    cachedHasPython = false;
    return false;
  }
}

export async function dispatchCloudScraperJob(
  options: DispatchCloudOptions
): Promise<DispatchCloudResult> {
  const {
    target = 'all',
    script,
    args = [],
    workflowFile = 'admin_job.yml',
    inputs = {},
    sendEvent,
    streamLogs = true,
    pollTimeoutMs = 25000,
    pollIntervalMs = 1500,
  } = options;

  const runId = crypto.randomUUID();
  const db = getServiceSupabase();

  // 1. Supabase scraper_runs tablosuna kaydet (tablo yoksa sessizce devam)
  try {
    if (db) {
      await db.from('scraper_runs').insert({
        id: runId,
        target,
        script,
        status: 'queued',
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[scraperDispatch] scraper_runs insert skipped:', err);
  }

  // 2. GitHub Token Doğrulaması
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_PAT ||
    process.env.GH_PAT;

  if (!token) {
    const errMsg = 'Bulut otomasyonu için GITHUB_TOKEN veya GH_TOKEN ortam değişkeni tanımlı değil.';
    if (sendEvent) {
      sendEvent({
        type: 'log',
        line: `[${new Date().toTimeString().split(' ')[0]}] [HATA] ${errMsg}`,
      });
      sendEvent({ type: 'error', error: errMsg });
    }
    return {
      ok: false,
      cloud: true,
      runId,
      target,
      script,
      error: errMsg,
    };
  }

  const repo = process.env.GITHUB_REPO || 'perfectusmim1/KoUp';
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`;

  let dispatchInputs: Record<string, string> = {};
  if (workflowFile === 'admin_job.yml') {
    dispatchInputs = {
      run_id: runId,
      script,
      target_site: target,
      extra_args: JSON.stringify(args),
      ...inputs,
    };
  } else if (workflowFile === 'scraper_cron.yml') {
    dispatchInputs = {
      target_site: target,
      pending_limit: '150',
      batch_dramas: '30',
      ...inputs,
    };
  } else {
    dispatchInputs = {
      run_id: runId,
      target,
      ...inputs,
    };
  }

  const nowStr = () => new Date().toTimeString().split(' ')[0];

  if (sendEvent) {
    sendEvent({
      type: 'log',
      line: `[${nowStr()}] [Bulut] GitHub Actions işçisi tetikleniyor (${workflowFile} -> ${repo})...`,
    });
  }

  try {
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'KoUp-App-ScraperDispatcher/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: dispatchInputs,
      }),
    });

    if (!ghRes.ok && ghRes.status !== 204) {
      const errText = await ghRes.text();
      const failMsg = `GitHub Actions API hatası (HTTP ${ghRes.status}): ${errText}`;
      if (sendEvent) {
        sendEvent({
          type: 'log',
          line: `[${nowStr()}] [HATA] ${failMsg}`,
        });
        sendEvent({ type: 'error', error: failMsg });
      }
      return {
        ok: false,
        cloud: true,
        runId,
        target,
        script,
        error: failMsg,
      };
    }

    if (sendEvent) {
      sendEvent({
        type: 'log',
        line: `[${nowStr()}] [BAŞLATILDI] Bulut iş akışı kuyruğa alındı (Run ID: ${runId}).`,
      });
    }

    // 3. Canlı Log Akışı: scraper_logs tablosunu kısa süre poll et
    if (streamLogs && sendEvent && db) {
      const seenLogIds = new Set<string>();
      const startTime = Date.now();

      while (Date.now() - startTime < pollTimeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        try {
          const { data: logRows } = await db
            .from('scraper_logs')
            .select('id, seq, level, line, created_at')
            .eq('run_id', runId)
            .order('seq', { ascending: true });

          if (Array.isArray(logRows) && logRows.length > 0) {
            for (const row of logRows) {
              const rowId = String(row.id || row.seq || row.created_at || row.line);
              if (!seenLogIds.has(rowId)) {
                seenLogIds.add(rowId);
                sendEvent({
                  type: 'log',
                  line: row.line,
                });
              }
            }
          }

          // Durum kontrolü: success, completed, failed veya cancelled olduysa erken çık
          const { data: runData } = await db
            .from('scraper_runs')
            .select('status')
            .eq('id', runId)
            .maybeSingle();

          if (
            runData?.status === 'success' ||
            runData?.status === 'completed' ||
            runData?.status === 'failed' ||
            runData?.status === 'cancelled'
          ) {
            break;
          }
        } catch {
          // Tablo yoksa veya ağ hatası olursa beklemeden devam et
          break;
        }
      }
    }

    return {
      ok: true,
      cloud: true,
      runId,
      target,
      script,
      message: 'GitHub Actions bulut otomasyonu başarıyla başlatıldı.',
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'GitHub API bağlantı hatası';
    if (sendEvent) {
      sendEvent({
        type: 'log',
        line: `[${nowStr()}] [HATA] İstek gönderilemedi: ${errorMsg}`,
      });
      sendEvent({ type: 'error', error: errorMsg });
    }
    return {
      ok: false,
      cloud: true,
      runId,
      target,
      script,
      error: errorMsg,
    };
  }
}
