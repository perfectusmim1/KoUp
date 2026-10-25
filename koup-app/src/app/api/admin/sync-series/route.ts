import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { verifyAdminAuth, resolvePythonBinary } from '@/lib/adminAuth';
import { supabaseAdmin } from '@/lib/supabase';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getPythonPath(): string {
  return resolvePythonBinary();
}

/**
 * GET: Retrieve real-time sync job status and logs
 */
export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
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
    const { dramaId, slug, provider = 'auto', manualUrl, dramaTitle } = body as {
      dramaId: number;
      slug?: string;
      provider?: string;
      manualUrl?: string;
      dramaTitle?: string;
    };

    if (!dramaId || typeof dramaId !== 'number') {
      return NextResponse.json({ error: 'Geçerli bir dramaId gereklidir.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scrapers', 'sync_target_drama.py');
    const isLocalPython = !process.env.VERCEL && fs.existsSync(scriptPath);

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
    const pythonBin = getPythonPath();
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
