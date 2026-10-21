import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyAdminAuth } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

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

export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ catalog: [], live_sites: [] });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'live_multi_search.py');
    const pythonBin = getPythonPath();

    const { stdout } = await execFileAsync(pythonBin, [scriptPath, q], {
      timeout: 12000,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });

    const parsed = JSON.parse(stdout.trim());
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}
