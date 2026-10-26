import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { verifyAdminAuth, resolvePythonBinary, checkAdminRateLimit } from '@/lib/adminAuth';
import { hasLocalPython, dispatchCloudScraperJob } from '@/lib/server/scraperDispatch';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const rate = checkAdminRateLimit(`series-auto-sync:${authCheck.userId}`, 15, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Çok fazla istek. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { dramaId, allActive = false } = body as { dramaId?: number; allActive?: boolean };

    if (!dramaId && !allActive) {
      return NextResponse.json({ error: 'dramaId veya allActive belirtilmelidir.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'series_automation_runner.py');
    const isLocalPython = hasLocalPython() && fs.existsSync(scriptPath);
    const encoder = new TextEncoder();

    // =========================================================================
    // VERCEL / CLOUD FALLBACK: DISPATCH TO GITHUB ACTIONS
    // =========================================================================
    if (!isLocalPython) {
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
            line: `[${nowStr()}] [Bulut] Vercel Serverless ortamı algılandı -> GitHub Actions bulut motoru tetikleniyor...`,
          });

          try {
            const workflowFile = dramaId ? 'sync_single_series.yml' : 'admin_job.yml';
            const script = dramaId ? 'scrapers/sync_target_drama.py' : 'scripts/series_automation_runner.py';
            const args = dramaId ? ['--drama-id', String(dramaId)] : ['--all-active'];
            const inputs: Record<string, string> = dramaId
              ? { drama_id: String(dramaId), provider: 'auto', manual_url: '' }
              : { target_site: 'all' };

            const dispatchRes = await dispatchCloudScraperJob({
              target: dramaId ? `series-${dramaId}` : 'all',
              script,
              workflowFile,
              args,
              inputs,
              sendEvent,
              streamLogs: true,
            });

            if (!dispatchRes.ok) {
              sendEvent({
                type: 'error',
                error: dispatchRes.error || 'GitHub Actions tetiklenemedi',
              });
            } else {
              sendEvent({
                type: 'log',
                line: `[${nowStr()}] [BAŞARILI] GitHub Actions seri otomasyon işi kuyruğa alındı (Run ID: ${dispatchRes.runId})!`,
              });
              sendEvent({
                type: 'done',
                exitCode: 0,
                ok: true,
                result: {
                  ok: true,
                  cloud: true,
                  dramaId,
                  allActive,
                  message: 'Bulut senkronizasyonu başlatıldı (~1-2 dk içinde tamamlanacak).',
                },
              });
            }
          } catch (ghErr: any) {
            sendEvent({
              type: 'error',
              error: ghErr.message || 'GitHub Actions tetiklenirken hata oluştu.',
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

    const pythonBin = resolvePythonBinary();
    const args = ['-u', scriptPath];
    if (allActive) {
      args.push('--all-active');
    } else if (dramaId) {
      args.push('--drama-id', String(Number(dramaId)));
    }

    const stream = new ReadableStream({
      start(controller) {
        let stdoutBuf = '';
        let closed = false;
        let resultPayload: any = null;

        const sendEvent = (obj: any) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch (_) {}
        };

        const processLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line) return;
          if (line.startsWith('__RESULT__ ')) {
            try {
              resultPayload = JSON.parse(line.replace('__RESULT__ ', '').trim());
              sendEvent({ type: 'result', data: resultPayload });
            } catch (_) {}
          } else if (line.startsWith('__ITEM__ ')) {
            try {
              const item = JSON.parse(line.replace('__ITEM__ ', '').trim());
              sendEvent({ type: 'item', data: item });
            } catch (_) {}
          } else {
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
        }, 180000);

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
            sendEvent({ type: 'log', line: `[UYARI] ${errText.slice(0, 160)}` });
          }
        });

        child.on('close', (code) => {
          clearTimeout(killTimer);
          if (stdoutBuf.trim()) {
            processLine(stdoutBuf);
          }
          sendEvent({
            type: 'done',
            exitCode: code,
            result: resultPayload,
            ok: code === 0,
          });
          closed = true;
          try {
            controller.close();
          } catch (_) {}
        });

        child.on('error', (err) => {
          clearTimeout(killTimer);
          sendEvent({ type: 'error', error: err.message });
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}
