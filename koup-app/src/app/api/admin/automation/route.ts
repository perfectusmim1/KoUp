import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { supabase } from '@/lib/supabase';
import { verifyAdminAuth, resolvePythonBinary, checkAdminRateLimit } from '@/lib/adminAuth';
import { hasLocalPython, dispatchCloudScraperJob } from '@/lib/server/scraperDispatch';

export const dynamic = 'force-dynamic';

let isAutomationRunning = false;

export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
    const runId = searchParams.get('runId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);

    // 1. Fetch active scrapers from scraper_configs
    const { data: scrapersData, error: scrapersErr } = await supabase
      .from('scraper_configs')
      .select('*')
      .order('id');

    if (scrapersErr) {
      console.error('Error fetching scraper_configs:', scrapersErr);
    }

    // 2. Fetch automation runs from automation_runs table
    let runsQuery = supabase
      .from('automation_runs')
      .select('*')
      .order('id', { ascending: false })
      .limit(limit);

    if (runId) {
      runsQuery = runsQuery.eq('id', parseInt(runId, 10));
    }

    let { data: runs, error: runsErr } = await runsQuery;
    if (runsErr) {
      console.error('Error fetching automation_runs:', runsErr);
      runs = [];
    }

    const latestRun = runs?.[0] || null;

    return NextResponse.json({
      ok: true,
      latestRun,
      runs: runs || [],
      scrapers: scrapersData || [],
    });
  } catch (err: any) {
    console.error('Automation API GET error:', err);
    return NextResponse.json({ error: err.message || 'Veri yüklenemedi' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const rate = checkAdminRateLimit(`automation:${authCheck.userId}`, 6, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Çok fazla otomasyon isteği. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const action = body.action || '';

    // Action 1: Toggle single scraper on/off in the 12-hour cron
    if (action === 'toggle_scraper') {
      const { scraperId, is_enabled } = body;
      if (!scraperId || typeof is_enabled !== 'boolean') {
        return NextResponse.json({ error: 'Geçersiz parametreler' }, { status: 400 });
      }

      const { error } = await supabase
        .from('scraper_configs')
        .update({ is_enabled })
        .eq('id', scraperId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, scraperId, is_enabled });
    }

    // Action 2: Toggle all scrapers on/off
    if (action === 'toggle_all') {
      const { is_enabled } = body;
      if (typeof is_enabled !== 'boolean') {
        return NextResponse.json({ error: 'Geçersiz parametreler' }, { status: 400 });
      }

      const { error } = await supabase
        .from('scraper_configs')
        .update({ is_enabled })
        .neq('id', '');

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, is_enabled });
    }

    // Action 3: Trigger automation pipeline run manually with live NDJSON log streaming
    if (action === 'trigger_automation') {
      const target = (body.target || 'all').toString().trim();
      const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'cron_sync_pipeline.py');
      const isCloudEnv = !hasLocalPython() || !fs.existsSync(scriptPath);

      if (!isCloudEnv && isAutomationRunning) {
        return NextResponse.json(
          { error: 'Zaten çalışan aktif bir otomasyon süreci var. Lütfen tamamlanmasını bekleyin.' },
          { status: 409 }
        );
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const logs: string[] = [];
          let closed = false;

          const sendEvent = (obj: any) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
            } catch (_) {}
          };

          const logMsg = (line: string) => {
            logs.push(line);
            sendEvent({ type: 'log', line });
          };

          // 1. Cloud (Vercel) Environment: Trigger via GitHub Actions API
          if (isCloudEnv) {
            const nowStr = new Date().toTimeString().split(' ')[0];
            logMsg(`[${nowStr}] [SİSTEM] Bulut (Vercel) ortamı algılandı. GitHub Actions Otomasyon Motoru devreye sokuluyor...`);

            try {
              const dispatchRes = await dispatchCloudScraperJob({
                target,
                script: 'scripts/cron_sync_pipeline.py',
                workflowFile: 'scraper_cron.yml',
                inputs: {
                  target_site: target,
                  pending_limit: '150',
                  batch_dramas: '30',
                },
                sendEvent,
                streamLogs: true,
              });

              if (dispatchRes.ok) {
                logMsg(`[${nowStr}] [BAŞARILI] GitHub Actions iş akışı başarıyla tetiklendi! (Run ID: ${dispatchRes.runId})`);
                logMsg(`[${nowStr}] [BİLGİ] Ubuntu runner üzerinde 45 dakika boyunca tüm botlar, seriler ve kaynaklar Cloudflare R2 ile senkronize edilecek.`);
                logMsg(`[${nowStr}] [CANLI] İlerlemeyi GitHub Actions sekmesinden veya Admin Panelindeki son çalıştırma geçmişinden takip edebilirsiniz.`);
                sendEvent({
                  type: 'result',
                  ok: true,
                  target,
                  logs,
                  message: 'GitHub Actions otomasyonu başarıyla başlatıldı.',
                });
              } else {
                logMsg(`[${nowStr}] [HATA] ${dispatchRes.error}`);
                sendEvent({
                  type: 'result',
                  ok: false,
                  target,
                  logs,
                  error: dispatchRes.error || 'GitHub Actions tetiklenemedi',
                });
              }
            } catch (err: any) {
              logMsg(`[${nowStr}] [HATA] GitHub Actions isteği başarısız: ${err.message}`);
              sendEvent({
                type: 'result',
                ok: false,
                target,
                logs,
                error: err.message,
              });
            } finally {
              closed = true;
              try { controller.close(); } catch (_) {}
            }
            return;
          }

          // 2. Local / VPS Environment: Run Python Script directly with live subprocess streaming
          isAutomationRunning = true;
          let stdoutBuf = '';
          const args = ['-u', scriptPath, '--target', target, '--trigger', 'admin_trigger'];

          const processLine = (rawLine: string) => {
            const line = rawLine.trim();
            if (!line) return;
            logs.push(line);
            sendEvent({ type: 'log', line });
          };

          const pythonBin = resolvePythonBinary();
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
          }, 600000); // 10 minutes timeout

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
              const nowStr = new Date().toTimeString().split(' ')[0];
              const errLine = `[${nowStr}] [UYARI] ${errText.split(/\r?\n/)[0].slice(0, 160)}`;
              logs.push(errLine);
              sendEvent({ type: 'log', line: errLine });
            }
          });

          child.on('close', async (exitCode) => {
            isAutomationRunning = false;
            clearTimeout(killTimer);
            if (stdoutBuf.trim()) {
              processLine(stdoutBuf);
              stdoutBuf = '';
            }

            // Fetch the newly created run record from Supabase
            let latestRunData = null;
            try {
              const { data: latest } = await supabase
                .from('automation_runs')
                .select('*')
                .order('id', { ascending: false })
                .limit(1)
                .single();
              latestRunData = latest;
            } catch (_) {}

            sendEvent({
              type: 'result',
              ok: exitCode === 0,
              exitCode,
              target,
              logs,
              latestRun: latestRunData,
            });

            closed = true;
            try {
              controller.close();
            } catch (_) {}
          });

          child.on('error', (err) => {
            isAutomationRunning = false;
            clearTimeout(killTimer);
            sendEvent({
              type: 'error',
              error: err.message || 'Otomasyon alt işlemi başlatılamadı',
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
          Connection: 'keep-alive',
        },
      });
    }

    return NextResponse.json({ error: 'Bilinmeyen işlem' }, { status: 400 });
  } catch (err: any) {
    console.error('Automation POST error:', err);
    return NextResponse.json({ error: err.message || 'İşlem gerçekleştirilemedi' }, { status: 500 });
  }
}
