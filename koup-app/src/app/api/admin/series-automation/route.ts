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

export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    // Try Supabase first
    const { data: supaRows, error } = await supabase
      .from('series_automations')
      .select('*')
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });

    if (!error && supaRows && supaRows.length > 0) {
      return NextResponse.json({ automations: supaRows });
    }

    // SQLite fallback
    const db = getArchiveDb();
    if (db) {
      const stmt = db.prepare(`
        SELECT media_id, title, slug, poster_url, content_type, status_broadcast,
               episode_count, sources_count, is_active, connected_sites, site_slugs,
               last_synced_at, last_status, last_message, last_episodes_added, last_sources_added,
               created_at, updated_at
        FROM series_automations
        ORDER BY is_active DESC, updated_at DESC
      `);
      const rows = stmt.all() as any[];
      const mapped = rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
        connected_sites: typeof r.connected_sites === 'string' ? JSON.parse(r.connected_sites) : r.connected_sites,
        site_slugs: typeof r.site_slugs === 'string' ? JSON.parse(r.site_slugs) : r.site_slugs,
      }));
      return NextResponse.json({ automations: mapped });
    }

    return NextResponse.json({ automations: [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json();
    const {
      media_id,
      title,
      slug,
      poster_url,
      content_type = 'dizi',
      status_broadcast = 'Devam Ediyor',
      is_active = true,
      connected_sites = ['asyawatch', 'dizikorea', 'dizifon'],
      site_slugs = {},
      site,
    } = body;

    // Out-of-catalog or newly created series
    if (!media_id || media_id === 'new') {
      if (!title) {
        return NextResponse.json({ error: 'Yeni seri eklemek için başlık (title) gereklidir.' }, { status: 400 });
      }

      const scriptPath = path.resolve(process.cwd(), '..', 'scripts', 'series_automation_runner.py');
      const pythonBin = getPythonPath();
      const runArgs = [
        scriptPath,
        '--add',
        '--title', title,
        '--slug', slug || '',
        '--site', site || (Array.isArray(connected_sites) && connected_sites[0]) || 'asyawatch',
        '--connected-sites', Array.isArray(connected_sites) ? connected_sites.join(',') : 'asyawatch,dizikorea,dizifon',
        '--site-slugs', JSON.stringify(site_slugs || {}),
        '--content-type', content_type || 'dizi',
        '--poster', poster_url || '',
      ];

      const { stdout } = await execFileAsync(pythonBin, runArgs, {
        timeout: 45000,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
      });

      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('__RESULT__ ')) {
          const resObj = JSON.parse(line.slice(11).trim());
          return NextResponse.json({
            ok: true,
            message: `"${resObj.title}" serisi oluşturuldu ve otomasyona bağlandı.`,
            media_id: resObj.media_id,
            data: resObj,
          });
        }
      }

      return NextResponse.json({
        ok: true,
        message: `"${title}" serisi otomasyona bağlandı.`,
      });
    }

    const db = getArchiveDb();
    let dramaTitle = title;
    let dramaSlug = slug;
    let dramaPoster = poster_url;
    let dramaType = content_type;
    let dramaStatus = status_broadcast;
    let epCount = 0;
    let srcCount = 0;

    if (db) {
      const stmt = db.prepare('SELECT id, title, slug, cover_image, content_type, status_broadcast, episode_count, sources_count FROM dramas WHERE id = ?');
      const d = stmt.get(Number(media_id)) as any;
      if (d) {
        if (d.status_broadcast === 'Final' || d.status_broadcast === 'Tamamlandı') {
          return NextResponse.json({
            error: `"${d.title}" zaten ${d.status_broadcast} yapmış bir dizi. Seri otomasyonu yalnızca devam eden serileri takip eder.`
          }, { status: 400 });
        }
        dramaTitle = dramaTitle || d.title;
        dramaSlug = dramaSlug || d.slug;
        dramaPoster = dramaPoster || d.cover_image;
        dramaType = dramaType || d.content_type;
        dramaStatus = dramaStatus || d.status_broadcast;
        epCount = Number(d.episode_count) || 0;
        srcCount = Number(d.sources_count) || 0;
      }

      const upsertStmt = db.prepare(`
        INSERT INTO series_automations (
          media_id, title, slug, poster_url, content_type, status_broadcast,
          episode_count, sources_count, is_active, connected_sites, site_slugs,
          last_status, last_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'Otomasyona bağlandı', datetime('now'), datetime('now'))
        ON CONFLICT(media_id) DO UPDATE SET
          title = excluded.title,
          slug = excluded.slug,
          poster_url = excluded.poster_url,
          content_type = excluded.content_type,
          status_broadcast = excluded.status_broadcast,
          is_active = excluded.is_active,
          connected_sites = excluded.connected_sites,
          site_slugs = excluded.site_slugs,
          updated_at = datetime('now')
      `);

      upsertStmt.run(
        Number(media_id),
        dramaTitle,
        dramaSlug,
        dramaPoster,
        dramaType,
        dramaStatus,
        epCount,
        srcCount,
        is_active ? 1 : 0,
        JSON.stringify(connected_sites),
        JSON.stringify(site_slugs)
      );
    }

    // Supabase upsert
    try {
      await supabase.from('series_automations').upsert({
        media_id: Number(media_id),
        title: dramaTitle,
        slug: dramaSlug,
        poster_url: dramaPoster,
        content_type: dramaType,
        status_broadcast: dramaStatus,
        episode_count: epCount,
        sources_count: srcCount,
        is_active: Boolean(is_active),
        connected_sites,
        site_slugs,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'media_id' });
    } catch {}

    return NextResponse.json({
      ok: true,
      message: `${dramaTitle} otomasyona başarıyla bağlandı.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
    const mediaId = searchParams.get('media_id');
    if (!mediaId) {
      return NextResponse.json({ error: 'media_id gereklidir.' }, { status: 400 });
    }

    const db = getArchiveDb();
    if (db) {
      const stmt = db.prepare('DELETE FROM series_automations WHERE media_id = ?');
      stmt.run(Number(mediaId));
    }

    try {
      await supabase.from('series_automations').delete().eq('media_id', Number(mediaId));
    } catch {}

    return NextResponse.json({ ok: true, message: 'Seri otomasyondan kaldırıldı.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Hata' }, { status: 500 });
  }
}
