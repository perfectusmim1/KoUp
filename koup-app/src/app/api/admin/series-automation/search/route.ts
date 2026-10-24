import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase } from '@/lib/supabase';
import { verifyAdminAuth, resolvePythonBinary } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim().slice(0, 120);
    if (!q || q.length < 2) {
      return NextResponse.json({ catalog: [], live_sites: [] });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'live_multi_search.py');
    const isLocalPython = !process.env.VERCEL && fs.existsSync(scriptPath);

    if (isLocalPython) {
      const pythonBin = resolvePythonBinary();
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
    }

    // Cloud/Vercel fallback: search Supabase catalog directly
    const { data: catalogRows } = await supabase.rpc('search_catalog', {
      p_query: q,
      p_limit: 20,
    });

    return NextResponse.json({
      catalog: (catalogRows || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        poster_url: r.cover_image,
        content_type: r.content_type,
        status_broadcast: r.status_broadcast,
        episode_count: r.episode_count,
        sources_count: r.sources_count,
      })),
      live_sites: [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}
