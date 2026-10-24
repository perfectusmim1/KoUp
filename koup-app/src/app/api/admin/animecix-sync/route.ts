import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { cleanFansubName, cleanSourceName } from '@/lib/cleanFansub';
import { verifyAdminAuth } from '@/lib/adminAuth';

const KEY_RAW = Buffer.from('i4C7R2fXGocdYgFLzCbDlsJjukf8G58b', 'utf-8');

function makeAnimecixHeader(queryStr: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_RAW, iv);
  const plaintext = Buffer.from('{version}' + queryStr, 'utf-8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `${enc.toString('base64')}.${iv.toString('base64')}`;
}

function cleanProvider(name: string, url: string): string {
  const urlLow = (url || '').toLowerCase();
  const nameLow = (name || '').toLowerCase();
  if (urlLow.includes('tau-video') || nameLow.includes('tau-video') || nameLow.includes('tau')) {
    return 'tau-video';
  }
  if (urlLow.includes('sibnet.ru')) return 'sibnet';
  if (urlLow.includes('ok.ru') || urlLow.includes('odnoklassniki')) return 'ok.ru';
  if (urlLow.includes('drive.google.com')) return 'googledrive';
  if (urlLow.includes('mega.nz')) return 'mega';
  if (urlLow.includes('dailymotion.com')) return 'dailymotion';
  if (urlLow.includes('dood')) return 'doodstream';
  if (urlLow.includes('uqload')) return 'uqload';
  if (urlLow.includes('mp4upload')) return 'mp4upload';
  if (urlLow.includes('sendvid')) return 'sendvid';
  if (urlLow.includes('mail.ru')) return 'mail.ru';
  if (nameLow) return nameLow.replace(/\s+/g, '');
  return 'embed';
}

export async function GET(req: NextRequest) {
  const authCheck = await verifyAdminAuth(req);
  if (!authCheck.authorized) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'inspect';

  const dbPath =
    process.env.ARCHIVE_DB_PATH ||
    path.resolve(process.cwd(), '..', 'webdrama_archive.db');

  if (!fs.existsSync(dbPath)) {
    return NextResponse.json({ error: 'Database file not found', dbPath }, { status: 404 });
  }

  const db = new DatabaseSync(dbPath);

  // 1. PURGE BROKEN SOURCES
  if (action === 'purge_broken') {
    const sendvidRes = db.prepare(
      "DELETE FROM episode_sources WHERE provider = 'sendvid' OR direct_url LIKE '%sendvid%' OR direct_url LIKE '%sendvid.com%'"
    ).run();

    const gdriveRes = db.prepare(
      "DELETE FROM episode_sources WHERE provider LIKE '%gdrive%' OR provider LIKE '%google%' OR direct_url LIKE '%drive.google.com%' OR direct_url LIKE '%docs.google.com%'"
    ).run();

    const deadDomainsRes = db.prepare(
      `DELETE FROM episode_sources WHERE
       direct_url LIKE '%four.pichive.online%' OR
       direct_url LIKE '%short.icu%' OR
       direct_url LIKE '%short.ink%' OR
       direct_url LIKE '%vudeo.io%' OR
       direct_url LIKE '%vudeo.co%' OR
       direct_url LIKE '%vudeo.net%' OR
       direct_url LIKE '%mvidoo.com%' OR
       direct_url LIKE '%savefileway.com%' OR
       direct_url LIKE '%tubeload.co%' OR
       direct_url LIKE '%embedo.co%' OR
       direct_url LIKE '%streamlare.com%' OR
       direct_url LIKE '%optraco.top%' OR
       direct_url LIKE '%abyssplayer.com%' OR
       direct_url LIKE '%uqload.to%' OR
       direct_url LIKE '%video.diziasya.com%' OR
       direct_url LIKE '%4meplayer%' OR
       direct_url LIKE '%p2pplay%' OR
       direct_url LIKE '%rpmplay%' OR
       direct_url LIKE '%uns.bio%' OR
       direct_url LIKE '%videa.hu%' OR
       direct_url LIKE '%videa.com%' OR
       direct_url = 'https://vidmoly.biz/embed-5px2t9ix314s.html' OR
       provider = 'sibnet' OR
       LOWER(source_name) LIKE '%sibnet%' OR
       direct_url LIKE '%sibnet.ru%' OR
       direct_url LIKE '%playerdkorea.xyz/player/index.php?data=c0a5a65e55124eae3388586316a25f57%'`
    ).run();

    // Checkpoint WAL to flush all deletions into the main db file immediately
    const ckpt = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();

    return NextResponse.json({
      ok: true,
      deletedSendvid: sendvidRes.changes,
      deletedGdrive: gdriveRes.changes,
      deletedOtherDead: deadDomainsRes.changes,
      totalDeleted: Number(sendvidRes.changes) + Number(gdriveRes.changes) + Number(deadDomainsRes.changes),
      checkpoint: ckpt,
    });
  }

  // 1b. WAL CHECKPOINT & TRUNCATE
  if (action === 'wal_checkpoint') {
    const ckpt = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all();
    return NextResponse.json({
      ok: true,
      checkpoint: ckpt,
    });
  }

  // 2. SYNC ONE PIECE FROM ANIMECIX
  if (action === 'sync_one_piece') {
    const dramaId = 9679; // One Piece anime ID
    let totalVideos = 0;
    let addedCount = 0;
    let skippedCount = 0;
    let page = 1;
    const perPage = 200;

    // Cache existing episodes for One Piece: (season, epNum) -> episodeId
    const epRows = db
      .prepare('SELECT id, season_number, episode_number FROM episodes WHERE drama_id = ?')
      .all(dramaId) as Array<{ id: number; season_number: number; episode_number: number }>;
    
    const epMap = new Map<string, number>();
    for (const r of epRows) {
      epMap.set(`${r.season_number || 1}-${r.episode_number}`, r.id);
    }

    // Cache existing sources for One Piece: direct_url Set
    const srcRows = db
      .prepare(
        `SELECT es.direct_url
         FROM episode_sources es
         JOIN episodes e ON es.episode_id = e.id
         WHERE e.drama_id = ? AND es.direct_url IS NOT NULL`
      )
      .all(dramaId) as Array<{ direct_url: string }>;
    
    const existingUrls = new Set<string>(srcRows.map((r) => r.direct_url));

    const insertEpStmt = db.prepare(
      `INSERT INTO episodes (drama_id, season_number, episode_number, episode_name, episode_url, episode_type)
       VALUES (?, ?, ?, ?, ?, 'episode')`
    );

    const insertSrcStmt = db.prepare(
      `INSERT INTO episode_sources (episode_id, source_name, embed_id, direct_url, provider, site, fansub)
       VALUES (?, ?, ?, ?, ?, 'animecix', ?)`
    );

    const tauVideoCount = { count: 0 };
    const sampleTauVideos: any[] = [];

    while (page <= 30) {
      const qs = `titleId=66&page=${page}&perPage=${perPage}`;
      const h = makeAnimecixHeader(qs);
      const resp = await fetch(`https://animecix.tv/secure/videos?${qs}`, {
        headers: {
          'X-E-H': h,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });

      if (!resp.ok) break;

      const data = await resp.json();
      const videos = data?.pagination?.data || [];
      const lastPage = data?.pagination?.last_page || 1;
      totalVideos += videos.length;

      for (const v of videos) {
        const url = (v.url || '').trim();
        if (!url || existingUrls.has(url)) {
          skippedCount++;
          continue;
        }

        const urlLow = url.toLowerCase();
        // Skip dead/broken platforms
        if (
          urlLow.includes('sibnet.ru') ||
          urlLow.includes('sibnet') ||
          urlLow.includes('sendvid') ||
          urlLow.includes('drive.google.com') ||
          urlLow.includes('docs.google.com') ||
          urlLow.includes('dood') ||
          urlLow.includes('short.icu')
        ) {
          skippedCount++;
          continue;
        }

        const seasonNum = v.season_num || 1;
        const episodeNum = v.episode_num || 1;
        const epKey = `${seasonNum}-${episodeNum}`;

        let epId = epMap.get(epKey);
        if (!epId) {
          const epUrl = `https://animecix.tv/titles/66/season/${seasonNum}/episode/${episodeNum}`;
          const res = insertEpStmt.run(dramaId, seasonNum, episodeNum, `Bölüm ${episodeNum}`, epUrl);
          epId = Number(res.lastInsertRowid);
          epMap.set(epKey, epId);
        }

        const provider = cleanProvider(v.name, url);
        if (provider === 'tau-video') {
          tauVideoCount.count++;
          if (sampleTauVideos.length < 5) {
            sampleTauVideos.push({ seasonNum, episodeNum, url, name: v.name, extra: v.extra });
          }
        }

        const sourceName = cleanSourceName(v.name || (provider === 'tau-video' ? 'Tau-Video' : 'Kaynak'));
        const fansub = cleanFansubName(v.extra);
        const embedId = `animecix_${v.id || Math.random().toString(36).substring(7)}`;

        try {
          insertSrcStmt.run(epId, sourceName, embedId, url, provider, fansub);
          existingUrls.add(url);
          addedCount++;
        } catch {
          skippedCount++;
        }
      }

      if (page >= lastPage) break;
      page++;
    }

    // Also update site_done
    try {
      db.prepare("INSERT OR REPLACE INTO site_done (site, url) VALUES ('animecix', 'title_66')").run();
    } catch {}

    return NextResponse.json({
      ok: true,
      dramaId,
      totalPagesFetched: page,
      totalVideosFetched: totalVideos,
      addedSources: addedCount,
      skippedSources: skippedCount,
      tauVideoSourcesFound: tauVideoCount.count,
      sampleTauVideos,
    });
  }

  // 3. AUDIT ANIME (Find anime titles with 0 sources or marked in site_done without sources)
  if (action === 'audit_anime') {
    const totalAnime = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE content_type = 'anime'").get() as any;
    const animeWithoutSources = db.prepare(`
      SELECT d.id, d.title, d.slug, d.anilist_id,
        (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count
      FROM dramas d
      WHERE d.content_type = 'anime'
        AND NOT EXISTS (
          SELECT 1 FROM episodes e
          JOIN episode_sources es ON es.episode_id = e.id
          WHERE e.drama_id = d.id
        )
      ORDER BY ep_count DESC, d.id ASC
      LIMIT 100
    `).all() as any[];

    const siteDoneCount = db.prepare("SELECT COUNT(*) as count FROM site_done WHERE site = 'animecix'").get() as any;

    return NextResponse.json({
      totalAnime: totalAnime?.count || 0,
      missingSourceCount: animeWithoutSources.length,
      sampleMissing: animeWithoutSources.slice(0, 30),
      siteDoneCount: siteDoneCount?.count || 0
    });
  }

  // 3.5 CHECK ANIMECIX REMOTE CATALOG
  if (action === 'check_animecix_remote') {
    try {
      const qs = 'page=1&perPage=1';
      const h = makeAnimecixHeader(qs);
      const resp = await fetch(`https://animecix.tv/secure/titles?${qs}`, {
        headers: {
          'X-E-H': h,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      const data = resp.ok ? await resp.json() : null;
      return NextResponse.json({
        ok: resp.ok,
        status: resp.status,
        remoteTotal: data?.pagination?.total || data?.total || null,
        remoteLastPage: data?.pagination?.last_page || null,
        sample: data?.pagination?.data?.[0] || null,
      });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message });
    }
  }

  if (action === 'sample_done') {
    const rows = db.prepare("SELECT url FROM site_done WHERE site = 'animecix' LIMIT 20").all();
    return NextResponse.json({ rows });
  }

  if (action === 'check_popular_anime') {
    const popularTitles = [
      'One Piece',
      'Naruto',
      'Bleach',
      'Attack on Titan',
      'Death Note',
      'Jujutsu Kaisen',
      'Kimetsu no Yaiba',
      'Hunter x Hunter',
      'Solo Leveling',
      'Chainsaw Man'
    ];

    const results = [];
    for (const title of popularTitles) {
      const drama = db.prepare(`
        SELECT d.id, d.title, d.slug,
          (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id) as ep_count,
          (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON es.episode_id = e.id WHERE e.drama_id = d.id) as total_sources,
          (SELECT COUNT(*) FROM episode_sources es JOIN episodes e ON es.episode_id = e.id WHERE e.drama_id = d.id AND (es.site = 'animecix' OR es.provider = 'tau-video')) as animecix_sources
        FROM dramas d
        WHERE d.content_type = 'anime' AND (d.title LIKE ? OR d.slug LIKE ?)
        LIMIT 1
      `).get(`%${title}%`, `%${title.toLowerCase().replace(/\s+/g, '-')}%`) as any;

      if (drama) results.push(drama);
    }

    return NextResponse.json({ results });
  }

  // 4. INSPECT (default)
  const animecixSources = db
    .prepare("SELECT COUNT(*) as count FROM episode_sources WHERE site = 'animecix' OR provider = 'tau-video'")
    .get() as { count: number };

  const sendvidSources = db
    .prepare("SELECT COUNT(*) as count FROM episode_sources WHERE provider = 'sendvid' OR direct_url LIKE '%sendvid%'")
    .get() as { count: number };

  const gdriveSources = db
    .prepare("SELECT COUNT(*) as count FROM episode_sources WHERE provider LIKE '%gdrive%' OR provider LIKE '%google%' OR direct_url LIKE '%drive.google.com%'")
    .get() as { count: number };

  let doneCount = 0;
  try {
    const doneRow = db.prepare("SELECT COUNT(*) as count FROM site_done WHERE site = 'animecix'").get() as any;
    doneCount = doneRow?.count || 0;
  } catch {}

  return NextResponse.json({
    animecixSourcesCount: animecixSources.count,
    sendvidSourcesCount: sendvidSources.count,
    gdriveSourcesCount: gdriveSources.count,
    animecixDoneTitles: doneCount,
  });
}
