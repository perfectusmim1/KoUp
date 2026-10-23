import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { verifyAdminAuth } from '@/lib/adminAuth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Helper to find Python executable across Windows environments
function getPythonPath(): string {
  const possiblePaths = [
    'C:\\Users\\Cagan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    'python',
    'py',
  ];

  for (const p of possiblePaths) {
    if (p.includes('\\')) {
      if (fs.existsSync(p)) return p;
    } else {
      return p;
    }
  }
  return 'python';
}

export async function POST(req: NextRequest) {
  try {
    // 1. Strict Admin Authentication
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    // 2. Parse request parameters
    const body = await req.json();
    const { dramaId, provider = 'auto', manualUrl } = body as {
      dramaId: number;
      slug?: string;
      provider?: string;
      manualUrl?: string;
    };

    if (!dramaId || typeof dramaId !== 'number') {
      return NextResponse.json({ error: 'Geçerli bir dramaId gereklidir.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scrapers', 'sync_target_drama.py');
    const isLocalPython = !process.env.VERCEL && fs.existsSync(scriptPath);

    const encoder = new TextEncoder();

    // =========================================================================
    // PRODUCTION / VERCEL: DISPATCH GITHUB ACTIONS BULUT SENKRONİZASYONU
    // =========================================================================
    if (!isLocalPython) {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
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

          const nowStr = () => new Date().toTimeString().split(' ')[0];
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
                  },
                }),
              }
            );

            if (!ghRes.ok) {
              const errText = await ghRes.text();
              sendEvent({
                type: 'error',
                error: `GitHub Actions API hatası (${ghRes.status}): ${errText}`,
              });
            } else {
              sendEvent({
                type: 'log',
                line: `[${nowStr()}] [BAŞARILI] GitHub Actions iş parçacığı başarıyla kuyruğa alındı!`,
              });
              sendEvent({
                type: 'log',
                line: `[${nowStr()}] [Bilgi] Python 3.12 bulut çalışanı R2 veritabanını indirecek ve Supabase ile eşitleyecektir (~1-2 dk).`,
              });
              sendEvent({
                type: 'result',
                ok: true,
                cloud: true,
                dramaId,
                provider,
                message: 'GitHub Actions bulut senkronizasyonu başlatıldı! Arka planda 1-2 dakika içinde bölümler ve kaynaklar güncellenecektir.',
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
    const args = ['-u', scriptPath, '--drama-id', String(dramaId), '--provider', provider];

    if (manualUrl && typeof manualUrl === 'string' && manualUrl.trim().length > 0) {
      args.push('--manual-url', manualUrl.trim());
    }

    const stream = new ReadableStream({
      start(controller) {
        const logs: string[] = [];
        let resultPayload: any = null;
        let stdoutBuf = '';
        let closed = false;

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
            const nowStr = new Date().toTimeString().split(' ')[0];
            const errLine = `[${nowStr}] [UYARI] ${errText.split(/\r?\n/)[0].slice(0, 160)}`;
            logs.push(errLine);
            sendEvent({ type: 'log', line: errLine });
          }
        });

        child.on('close', async () => {
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

          if (!resultPayload) {
            resultPayload = {
              ok: true,
              dramaId,
              provider,
              episodesAdded: 0,
              sourcesAdded: 0,
              timestamp: new Date().toISOString(),
            };
          }

          sendEvent({
            type: 'result',
            ok: true,
            cloud: false,
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
