import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { verifyAdminAuth, resolvePythonBinary } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

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

function slugifyTR(text: string): string {
  const trMap: Record<string, string> = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i',
    ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  };
  return text
    .split('')
    .map((c) => trMap[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || '').trim().slice(0, 140);
    const dramaId = body.drama_id ? Number(body.drama_id) : null;
    const connectedSites: string[] = Array.isArray(body.connected_sites)
      ? body.connected_sites.filter((s: any) => typeof s === 'string' && /^[a-z0-9_-]+$/.test(s))
      : ['asyawatch', 'dizikorea', 'dizifon'];
    const autoSave = Boolean(body.auto_save);

    if (!title) {
      return NextResponse.json({ error: 'Başlık (title) parametresi zorunludur.' }, { status: 400 });
    }

    const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'series_automation_runner.py');
    const isLocalPython = !process.env.VERCEL && fs.existsSync(scriptPath);

    let parsed: any = null;

    if (isLocalPython) {
      const py = resolvePythonBinary();
      const args = [scriptPath, '--resolve-slugs', '--title', title];
      if (connectedSites.length > 0) {
        args.push('--connected-sites', connectedSites.join(','));
      }

      const { stdout } = await execFileAsync(py, args, {
        cwd: path.resolve(process.cwd(), '..'),
        timeout: 25000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        const match = stdout.match(/\{[\s\S]*"suggested_slugs"[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        }
      }
    } else {
      // Cloud/Vercel fallback: generate deterministic normalized slugs per site
      const baseSlug = slugifyTR(title);
      const suggested: Record<string, string> = {};
      for (const siteKey of connectedSites) {
        suggested[siteKey] = baseSlug;
      }
      parsed = {
        ok: true,
        title,
        suggested_slugs: suggested,
        cloud_fallback: true,
      };
    }

    if (!parsed) {
      return NextResponse.json({ error: 'Site slugları çözümlenemedi.' }, { status: 500 });
    }

    if (autoSave && dramaId && parsed.suggested_slugs) {
      const db = getArchiveDb();
      let mergedSlugs = { ...parsed.suggested_slugs };

      if (db) {
        const existingRow = db.prepare('SELECT site_slugs FROM series_automations WHERE media_id = ?').get(dramaId) as any;
        if (existingRow?.site_slugs) {
          try {
            const oldSlugs = JSON.parse(existingRow.site_slugs);
            mergedSlugs = { ...oldSlugs, ...parsed.suggested_slugs };
          } catch {}
        }

        db.prepare("UPDATE series_automations SET site_slugs = ?, updated_at = datetime('now') WHERE media_id = ?")
          .run(JSON.stringify(mergedSlugs), dramaId);
      }

      const supa = supabaseAdmin || supabase;
      const { data: existingSupa } = await supa
        .from('series_automations')
        .select('site_slugs')
        .eq('media_id', dramaId)
        .maybeSingle();

      if (existingSupa?.site_slugs && typeof existingSupa.site_slugs === 'object') {
        mergedSlugs = { ...(existingSupa.site_slugs as Record<string, string>), ...mergedSlugs };
      }

      await supa
        .from('series_automations')
        .update({
          site_slugs: mergedSlugs,
          updated_at: new Date().toISOString(),
        })
        .eq('media_id', dramaId);

      parsed.saved = true;
      parsed.merged_slugs = mergedSlugs;
    }

    return NextResponse.json({ ok: true, ...parsed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Slug çözümleme hatası' }, { status: 500 });
  }
}
