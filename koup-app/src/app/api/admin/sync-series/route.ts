import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyAdminAuth } from '@/lib/adminAuth';

const execFileAsync = promisify(execFile);

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
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: `Senkronizasyon motoru bulunamadı: ${scriptPath}` },
        { status: 500 }
      );
    }

    const pythonBin = getPythonPath();
    const args = [scriptPath, '--drama-id', String(dramaId), '--provider', provider];

    if (manualUrl && typeof manualUrl === 'string' && manualUrl.trim().length > 0) {
      args.push('--manual-url', manualUrl.trim());
    }

    // 3. Execute target sync subprocess with 60s timeout
    let stdout = '';
    let stderr = '';
    try {
      const execResult = await execFileAsync(pythonBin, args, {
        cwd: path.resolve(process.cwd(), '..'),
        timeout: 60000,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
      });
      stdout = execResult.stdout || '';
      stderr = execResult.stderr || '';
    } catch (procErr: any) {
      stdout = procErr.stdout || '';
      stderr = procErr.stderr || '';
      if (!stdout && stderr) {
        throw new Error(stderr.slice(0, 400));
      }
    }

    // 4. Parse stdout logs and __RESULT__ payload
    const rawLines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const logs: string[] = [];
    let resultPayload: any = null;

    for (const line of rawLines) {
      if (line.startsWith('__RESULT__ ')) {
        try {
          resultPayload = JSON.parse(line.replace('__RESULT__ ', '').trim());
        } catch (_) {}
      } else if (line.startsWith('[')) {
        logs.push(line);
      }
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

    return NextResponse.json({
      ok: true,
      dramaId,
      dramaTitle: resultPayload.dramaTitle || '',
      provider: resultPayload.provider || provider,
      episodesAdded: resultPayload.episodesAdded ?? 0,
      sourcesAdded: resultPayload.sourcesAdded ?? 0,
      logs,
      timestamp: resultPayload.timestamp || new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Single series sync error:', err);
    return NextResponse.json(
      { error: err.message || 'Senkronizasyon işlemi sırasında beklenmeyen bir hata oluştu.' },
      { status: 500 }
    );
  }
}
