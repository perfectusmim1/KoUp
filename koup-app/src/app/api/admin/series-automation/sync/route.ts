import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { verifyAdminAuth } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json();
    const { dramaId, allActive = false } = body as { dramaId?: number; allActive?: boolean };

    if (!dramaId && !allActive) {
      return NextResponse.json({ error: 'dramaId veya allActive belirtilmelidir.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'series_automation_runner.py');
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: `Script bulunamadı: ${scriptPath}` }, { status: 500 });
    }

    const pythonBin = getPythonPath();
    const args = ['-u', scriptPath];
    if (allActive) {
      args.push('--all-active');
    } else if (dramaId) {
      args.push('--drama-id', String(dramaId));
    }

    const encoder = new TextEncoder();
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
