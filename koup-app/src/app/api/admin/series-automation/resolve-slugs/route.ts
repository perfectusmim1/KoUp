import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase } from '@/lib/supabase';
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

let archiveDb: DatabaseSync | null = null;
function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath =
    process.env.ARCHIVE_DB_PATH ||
    path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (!fs.existsSync(dbPath)) return null;
  archiveDb = new DatabaseSync(dbPath);
  return archiveDb;
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json().catch(() => ({}));
    const title = (body.title || '').trim();
    const dramaId = body.drama_id ? Number(body.drama_id) : null;
    const connectedSites = Array.isArray(body.connected_sites) ? body.connected_sites : null;
    const autoSave = Boolean(body.auto_save);

    if (!title) {
      return NextResponse.json({ error: 'Başlık (title) parametresi zorunludur.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'series_automation_runner.py');
    const py = getPythonPath();
    const args = [scriptPath, '--resolve-slugs', '--title', title];

    if (connectedSites && connectedSites.length > 0) {
      args.push('--connected-sites', connectedSites.join(','));
    }

    const { stdout } = await execFileAsync(py, args, {
      cwd: path.resolve(process.cwd(), '..'),
      timeout: 25000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let parsed: any = null;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      // Find JSON block in stdout
      const match = stdout.match(/\{[\s\S]*"suggested_slugs"[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    if (!parsed) {
      return NextResponse.json({ error: 'Site slugları çözümlenemedi.', raw: stdout }, { status: 500 });
    }

    // Auto-save to SQLite and Supabase if requested
    if (autoSave && dramaId && parsed.suggested_slugs) {
      const db = getArchiveDb();
      if (db) {
        // Read existing slugs to merge
        const existingRow = db.prepare('SELECT site_slugs FROM series_automations WHERE media_id = ?').get(dramaId) as any;
        let mergedSlugs = { ...parsed.suggested_slugs };
        if (existingRow?.site_slugs) {
          try {
            const oldSlugs = JSON.parse(existingRow.site_slugs);
            mergedSlugs = { ...oldSlugs, ...parsed.suggested_slugs };
          } catch {}
        }

        db.prepare("UPDATE series_automations SET site_slugs = ?, updated_at = datetime('now') WHERE media_id = ?")
          .run(JSON.stringify(mergedSlugs), dramaId);

        // Supabase sync
        await supabase
          .from('series_automations')
          .update({
            site_slugs: mergedSlugs,
            updated_at: new Date().toISOString(),
          })
          .eq('media_id', dramaId);

        parsed.saved = true;
        parsed.merged_slugs = mergedSlugs;
      }
    }

    return NextResponse.json({ ok: true, ...parsed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Slug çözümleme hatası' }, { status: 500 });
  }
}
