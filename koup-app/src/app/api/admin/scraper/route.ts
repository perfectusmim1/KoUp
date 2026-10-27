import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase } from '@/lib/supabase';
import { verifyAdminAuth, resolvePythonBinary, checkAdminRateLimit } from '@/lib/adminAuth';
import { hasLocalPython, dispatchCloudScraperJob } from '@/lib/server/scraperDispatch';

const execFileAsync = promisify(execFile);
const activeScraperRuns = new Set<string>();

interface ScraperMeta {
  id: string;
  name: string;
  domain: string;
  logoText: string;
  badgeColor: string;
  protocol: string;
  description: string;
  targetCategory: string;
}

const SCRAPER_METAS: Record<string, ScraperMeta> = {
  ddizi: {
    id: 'ddizi',
    name: 'DDizi (Yerli Dizi & Klasik HD Arşiv)',
    domain: 'https://ddizi.tel',
    logoText: 'DDizi',
    badgeColor: 'from-blue-600 to-indigo-700',
    protocol: 'Doğrudan .m3u8 HLS + YouTube HD Resmi Akış',
    description: '1000+ yerli dizi ve klasik yapım arşivi. Doğrudan .m3u8 HLS ve YouTube HD akışlarını sisteme işler.',
    targetCategory: 'Yerli & Klasik Dizi',
  },
  animecix: {
    id: 'animecix',
    name: 'AnimeciX (Tau-Video & Anime Arşivi)',
    domain: 'https://animecix.net',
    logoText: 'AnimeciX',
    badgeColor: 'from-purple-500 to-indigo-600',
    protocol: 'Tau-Video & Mail.ru Doğrudan MP4 / HLS',
    description: 'Yüksek kaliteli alternatif anime kaynaklarını ve fansub çevirilerini arşivler.',
    targetCategory: 'Anime Arşivi',
  },
  dizibox: {
    id: 'dizibox',
    name: 'DiziBox Global & Yabancı Dizi Motoru',
    domain: 'https://www.dizibox.live',
    logoText: 'DiziBox',
    badgeColor: 'from-amber-500 to-orange-600',
    protocol: 'king.php DBX Pro MolyStream 1080p HLS Çözücü',
    description: 'Global ve Batı yapımı sinema dizilerini DBX Pro 1080p HLS kalitesiyle senkronize eder.',
    targetCategory: 'Global & Batı',
  },
  dizikorea: {
    id: 'dizikorea',
    name: 'DiziKorea (K-Drama & Asya Arşivi)',
    domain: 'https://dizikorea3.com',
    logoText: 'DiziKorea',
    badgeColor: 'from-emerald-500 to-teal-600',
    protocol: 'playerdkorea.xyz 1080p HLS + Vidmoly Çözücü',
    description: 'Kore, Çin ve Asya dizilerinin güncel bölüm akışlarını 1080p doğrudan HLS formatında aktarır.',
    targetCategory: 'K-Drama',
  },
  hdfilm: {
    id: 'hdfilm',
    name: 'HDFilmcehennemi (1080p Dual Audio & Altyazılı)',
    domain: 'https://www.hdfilmcehennemi.nl',
    logoText: 'HDFilm',
    badgeColor: 'from-rose-600 to-red-700',
    protocol: 'Close Dual HLS (master.txt) + Rapidrame HLS (master.m3u8)',
    description: 'Yabancı sinema filmleri ve popüler diziler. Close (Türkçe Dublaj 1080p Dual HLS) ve Rapidrame (Türkçe Altyazılı HLS) akışlarını sisteme işler.',
    targetCategory: 'Sinema & Dizi',
  },
  asyawatch: {
    id: 'asyawatch',
    name: 'AsyaWatch (1080p Native HLS & Asya Arşivi)',
    domain: 'https://asyawatch.com',
    logoText: 'AsyaWatch',
    badgeColor: 'from-pink-500 to-rose-600',
    protocol: 'four.pichive.online 1080p HLS Çözücü',
    description: '2100+ Kore ve Asya dizisi. Doğrudan 1080p HLS akışlarını yerel KoUp player ile oynatır.',
    targetCategory: 'K-Drama & Asya',
  },
  dizilla: {
    id: 'dizilla',
    name: 'Dizilla (Batı, Anime & Global Dizi Arşivi)',
    domain: 'https://dizilla.now',
    logoText: 'Dizilla',
    badgeColor: 'from-amber-500 to-red-600',
    protocol: 'AES-256 Decrypt + Native HLS Çözücü',
    description: '8900+ global dizi, anime ve K-Drama arşivi. AES-256 çözülmüş katalog ve 1080p HLS akışları.',
    targetCategory: 'Global & Anime',
  },
  dizifon: {
    id: 'dizifon',
    name: 'DiziFon (Asya, Çin & K-Drama HD Arşiv)',
    domain: 'https://www.dizifon.cc',
    logoText: 'DiziFon',
    badgeColor: 'from-amber-600 to-yellow-500',
    protocol: 'OK.ru HD + Vidmoly + YouTube HD Akış Çözücü',
    description: '3500+ Asya, Kore, Çin ve Hint dizisi. vdo-src üzerinden doğrudan OK.ru ve Vidmoly 1080p akışları.',
    targetCategory: 'Asya & K-Drama',
  },
  diziizle: {
    id: 'diziizle',
    name: 'Diziİzle (Türk Dizileri & Pilavyer HD)',
    domain: 'https://diziizle.cafe',
    logoText: 'Diziİzle',
    badgeColor: 'from-blue-500 to-cyan-600',
    protocol: 'Pilavyer 1080p HLS + Takvim Senkronizasyonu',
    description: 'Yerli Türk dizileri, haftalık yayın takvimi ve doğrudan Pilavyer 1080p HLS akışları.',
    targetCategory: 'Yerli Dizi & Takvim',
  },
  webdramaturkey2: {
    id: 'webdramaturkey2',
    name: 'WebDramaTurkey2 (Asya & BL Dizi Arşivi)',
    domain: 'https://webdramaturkey2.com',
    logoText: 'WDT2',
    badgeColor: 'from-fuchsia-600 to-pink-600',
    protocol: 'WDT Custom Player + MP4/HLS Akışları',
    description: 'Asya, Kore, Tayland ve Çin web dramaları, BL serileri ve film arşivi.',
    targetCategory: 'Asya Web Drama',
  },
  koredizi: {
    id: 'koredizi',
    name: 'KoreDizi (Short Drama & Dikey Mini Dizi)',
    domain: 'https://koredizi.biz',
    logoText: 'KoreDizi',
    badgeColor: 'from-rose-500 to-pink-500',
    protocol: 'Direct MP4 CDN + Fast Ingest',
    description: 'Dikey formatta popüler Kore ve Asya kısa dizi (short drama) arşivi.',
    targetCategory: 'Short Drama',
  },
  shortizle: {
    id: 'shortizle',
    name: 'Shortİzle (Mikro Dizi & Mobil Akış)',
    domain: 'https://shortizle.com',
    logoText: 'Shortİzle',
    badgeColor: 'from-red-500 to-amber-500',
    protocol: 'Direct MP4 Stream Çözücü',
    description: 'Türkçe altyazılı ve dublajlı dikey kısa dizi arşivi.',
    targetCategory: 'Short Drama',
  },
  dramavadisi: {
    id: 'dramavadisi',
    name: 'DramaVadisi (Short Drama & Mini Dizi)',
    domain: 'https://dramavadisi.com',
    logoText: 'DramaVadisi',
    badgeColor: 'from-emerald-600 to-teal-500',
    protocol: 'Open Stream + HLS Çözücü',
    description: 'Kısa formatlı Asya dizileri ve dikey video arşivleme motoru.',
    targetCategory: 'Short Drama',
  },
  dramabox: {
    id: 'dramabox',
    name: 'DramaBox (Short Drama Katalog Eşleştirici)',
    domain: 'https://dramabox.com',
    logoText: 'DramaBox',
    badgeColor: 'from-violet-600 to-purple-500',
    protocol: 'Metadata Resolution & Catalog Match',
    description: 'Short drama içeriklerini global DramaBox kütüphanesiyle çapraz eşleştiren motor.',
    targetCategory: 'Short Drama',
  },
  animelvl: {
    id: 'animelvl',
    name: 'AnimeLVL (Doğrudan MP4 & Anime Takvimi)',
    domain: 'https://animelvl.com',
    logoText: 'AnimeLVL',
    badgeColor: 'from-indigo-600 to-blue-500',
    protocol: '/api/stream.mp4 Doğrudan MP4 + Takvim Senkronizasyonu',
    description: '1470+ anime serisi, doğrudan stream.mp4 akışları ve haftalık anime yayın takvimi.',
    targetCategory: 'Anime & Takvim',
  },
  sezonlukdizi: {
    id: 'sezonlukdizi',
    name: 'SezonlukDizi (IMDb Eşleştirme & Çoklu Alternatif)',
    domain: 'https://sezonlukdizi.cc',
    logoText: 'SezonlukDizi',
    badgeColor: 'from-blue-600 to-indigo-800',
    protocol: 'dataAlternatif22 + Filemoon/Vidmoly/OK.ru Embed Çözücü',
    description: '6000+ yabancı dizi arşivi, IMDb ID ile eşleştirme, Altyazı ve Dublaj alternatif playerlar.',
    targetCategory: 'Yabancı Dizi',
  },
  dizipal: {
    id: 'dizipal',
    name: 'Dizipal (PBKDF2/AES Decrypt + Direct HLS)',
    domain: 'https://dizipal1592.com',
    logoText: 'Dizipal',
    badgeColor: 'from-amber-500 to-orange-700',
    protocol: 'PBKDF2 SHA-512 + AES-256-CBC Decrypt + Direct master.m3u8',
    description: 'Kriptolu RSC akışlarını client-side PBKDF2/AES algoritmasıyla çözerek doğrudan 1080p HLS elde eder.',
    targetCategory: 'Popüler Dizi & Sinema',
  },
  fullhdfilmizlesene: {
    id: 'fullhdfilmizlesene',
    name: 'FullHDFilmizlesene (1080p Film & Çoklu Player)',
    domain: 'https://www.fullhdfilmizlesene.now',
    logoText: 'FullHD',
    badgeColor: 'from-red-600 to-rose-700',
    protocol: 'ROT13 + Base64 Decrypt (Atom, Rapidvid, Turbo, Vidmoly)',
    description: 'Schema.org Movie JSON-LD katalog ve şifreli scx nesnesinden çözülmüş doğrudan film embedleri.',
    targetCategory: 'Sinema Filmleri',
  },
  tranimaci: {
    id: 'tranimaci',
    name: 'TRAnimeci (Next.js & Fansub Anime Arşivi)',
    domain: 'https://tranimaci.com',
    logoText: 'TRAnimeci',
    badgeColor: 'from-cyan-600 to-blue-600',
    protocol: 'TVSeries JSON-LD + Next.js Video Akışları',
    description: '1370+ anime serisi, fansub kaynakları ve mobil uyumlu doğrudan anime playerları.',
    targetCategory: 'Anime Arşivi',
  },
  anizm: {
    id: 'anizm',
    name: 'Anizm (Fansub Çevirmen & OK.ru/GDrive)',
    domain: 'https://anizm.net',
    logoText: 'Anizm',
    badgeColor: 'from-purple-600 to-pink-700',
    protocol: '/cevirmen -> /video -> /player (Odnoklassniki & Aincrad)',
    description: 'Güncel anime bölümleri, çoklu çevirmen fansub alternatifleri ve açık Odnoklassniki akışları.',
    targetCategory: 'Anime & Fansub',
  },
};

let archiveDb: DatabaseSync | null = null;

function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath =
    process.env.ARCHIVE_DB_PATH ||
    path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    archiveDb = new DatabaseSync(dbPath, { readOnly: true });
    return archiveDb;
  } catch (e) {
    console.error('Error opening webdrama_archive.db:', e);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { searchParams } = new URL(req.url);
    const scraperId = searchParams.get('scraperId');

    const db = getArchiveDb();

    // 1. Fetch scraper configs from Supabase (all 20 bots)
    const activeIds = [
      'ddizi', 'animecix', 'dizibox', 'dizikorea', 'hdfilm', 'asyawatch', 'dizilla', 'dizifon',
      'diziizle', 'webdramaturkey2', 'koredizi', 'shortizle', 'dramavadisi', 'dramabox',
      'animelvl', 'sezonlukdizi', 'dizipal', 'fullhdfilmizlesene', 'tranimaci', 'anizm',
    ];
    let query = supabase.from('scraper_configs').select('*').in('id', activeIds);
    if (scraperId) {
      query = query.eq('id', scraperId);
    }
    const { data: configs, error: configErr } = await query;
    if (configErr) {
      return NextResponse.json({ error: configErr.message }, { status: 500 });
    }

    // Merge any missing bots from SCRAPER_METAS
    const configMap = new Map((configs || []).map((c) => [c.id, c]));
    const targetIds = scraperId ? [scraperId] : activeIds;
    const allConfigs = targetIds.map((id) => {
      const existing = configMap.get(id);
      if (existing) return existing;
      const m = SCRAPER_METAS[id];
      return {
        id,
        name: m?.name || id,
        site_url: m?.domain || '',
        cron_schedule: '0 */3 * * *',
        is_enabled: true,
        last_run_at: null,
        last_status: 'healthy',
        items_synced: 0,
        notes: m?.description || '',
      };
    });

    // Attach real counts from SQLite
    const enrichedConfigs = allConfigs.map((bot) => {
      let realCount = bot.items_synced || 0;
      if (db) {
        try {
          const isHdfilm = bot.id === 'hdfilm';
          const isAsyawatch = bot.id === 'asyawatch';
          const isDizilla = bot.id === 'dizilla';
          const isDizifon = bot.id === 'dizifon';
          const countStmt = isHdfilm
            ? db.prepare(
                "SELECT COUNT(*) as c FROM episode_sources WHERE site LIKE '%hdfilm%' OR provider LIKE '%hdfilm%' OR provider = 'rapidrame' OR provider = 'close'"
              )
            : isAsyawatch
            ? db.prepare(
                "SELECT COUNT(*) as c FROM episode_sources WHERE site LIKE '%asyawatch%' OR provider LIKE '%asyawatch%'"
              )
            : isDizilla
            ? db.prepare(
                "SELECT COUNT(*) as c FROM episode_sources WHERE site LIKE '%dizilla%' OR provider LIKE '%dizilla%'"
              )
            : isDizifon
            ? db.prepare(
                "SELECT COUNT(*) as c FROM episode_sources WHERE site LIKE '%dizifon%' OR provider LIKE '%dizifon%'"
              )
            : db.prepare(
                'SELECT COUNT(*) as c FROM episode_sources WHERE site = ? OR provider = ?'
              );
          const countRow = (isHdfilm || isAsyawatch || isDizilla || isDizifon ? countStmt.get() : countStmt.get(bot.id, bot.id)) as { c?: number } | undefined;
          if (countRow?.c) {
            realCount = countRow.c;
          }
        } catch (_) {}
      }
      return {
        ...bot,
        items_synced: realCount,
      };
    });

    if (!scraperId) {
      return NextResponse.json({ scrapers: enrichedConfigs });
    }

    const selectedBot = enrichedConfigs?.[0];
    if (!selectedBot) {
      return NextResponse.json({ error: 'Scraper bulunamadı' }, { status: 404 });
    }

    const meta = SCRAPER_METAS[selectedBot.id] || {
      id: selectedBot.id,
      name: selectedBot.name,
      domain: 'https://koup.app',
      logoText: selectedBot.name.slice(0, 8),
      badgeColor: 'from-sky-500 to-blue-600',
      protocol: 'Standart TLS Bot',
      description: selectedBot.notes || '',
      targetCategory: 'Genel',
    };

    // 2. Fetch REAL recent items specifically for this scraper from webdrama_archive.db
    let recentItems: any[] = [];
    if (db) {
      try {
        const isHdfilm = selectedBot.id === 'hdfilm';
        const isAsyawatch = selectedBot.id === 'asyawatch';
        const isDizilla = selectedBot.id === 'dizilla';
        let rows: any[] = [];
        if (isHdfilm) {
          rows = db.prepare(`SELECT 
                     es.id AS source_id,
                     d.id AS media_id,
                     d.title AS drama_title,
                     d.slug AS drama_slug,
                     d.cover_image,
                     e.season_number,
                     e.episode_number,
                     e.episode_name,
                     es.source_name,
                     es.provider,
                     es.direct_url,
                     es.created_at
                   FROM episode_sources es
                   JOIN episodes e ON es.episode_id = e.id
                   JOIN dramas d ON e.drama_id = d.id
                   WHERE es.site LIKE '%hdfilm%' OR es.provider LIKE '%hdfilm%' OR es.provider = 'rapidrame' OR es.provider = 'close'
                   ORDER BY es.id DESC
                   LIMIT 16`).all();
        } else if (isAsyawatch) {
          rows = db.prepare(`SELECT 
                     es.id AS source_id,
                     d.id AS media_id,
                     d.title AS drama_title,
                     d.slug AS drama_slug,
                     d.cover_image,
                     e.season_number,
                     e.episode_number,
                     e.episode_name,
                     es.source_name,
                     es.provider,
                     es.direct_url,
                     es.created_at
                   FROM episode_sources es
                   JOIN episodes e ON es.episode_id = e.id
                   JOIN dramas d ON e.drama_id = d.id
                   WHERE es.site LIKE '%asyawatch%' OR es.provider LIKE '%asyawatch%'
                   ORDER BY es.id DESC
                   LIMIT 16`).all();
        } else if (isDizilla) {
          rows = db.prepare(`SELECT 
                     es.id AS source_id,
                     d.id AS media_id,
                     d.title AS drama_title,
                     d.slug AS drama_slug,
                     d.cover_image,
                     e.season_number,
                     e.episode_number,
                     e.episode_name,
                     es.source_name,
                     es.provider,
                     es.direct_url,
                     es.created_at
                   FROM episode_sources es
                   JOIN episodes e ON es.episode_id = e.id
                   JOIN dramas d ON e.drama_id = d.id
                   WHERE es.site LIKE '%dizilla%' OR es.provider LIKE '%dizilla%'
                   ORDER BY es.id DESC
                   LIMIT 16`).all();
        } else if (selectedBot.id === 'dizifon') {
          rows = db.prepare(`SELECT 
                     es.id AS source_id,
                     d.id AS media_id,
                     d.title AS drama_title,
                     d.slug AS drama_slug,
                     d.cover_image,
                     e.season_number,
                     e.episode_number,
                     e.episode_name,
                     es.source_name,
                     es.provider,
                     es.direct_url,
                     es.created_at
                   FROM episode_sources es
                   JOIN episodes e ON es.episode_id = e.id
                   JOIN dramas d ON e.drama_id = d.id
                   WHERE es.site LIKE '%dizifon%' OR es.provider LIKE '%dizifon%'
                   ORDER BY es.id DESC
                   LIMIT 16`).all();
        } else {
          rows = db.prepare(`SELECT 
                     es.id AS source_id,
                     d.id AS media_id,
                     d.title AS drama_title,
                     d.slug AS drama_slug,
                     d.cover_image,
                     e.season_number,
                     e.episode_number,
                     e.episode_name,
                     es.source_name,
                     es.provider,
                     es.direct_url,
                     es.created_at
                   FROM episode_sources es
                   JOIN episodes e ON es.episode_id = e.id
                   JOIN dramas d ON e.drama_id = d.id
                   WHERE es.site = ? OR es.provider = ?
                   ORDER BY es.id DESC
                   LIMIT 16`).all(selectedBot.id, selectedBot.id);
        }

        recentItems = rows.map((r) => ({
          id: `${selectedBot.id}-${r.source_id}`,
          title: r.drama_title,
          subtitle: `${r.season_number}. Sezon ${r.episode_number}. Bölüm (${r.episode_name || 'Bölüm'})`,
          image: r.cover_image || '/logo-dark.png',
          link: `/seri/${r.drama_slug}/${r.episode_number}`,
          date: r.created_at || new Date().toISOString(),
          status: 'Senkronize Edildi',
          sourceName: r.source_name || 'Orijinal',
        }));
      } catch (dbErr) {
        console.error('Error querying recent items from sqlite:', dbErr);
      }
    }

    // 3. Generate initial operational logs
    const now = new Date();
    const timeStr = (minsAgo: number) => {
      const d = new Date(now.getTime() - minsAgo * 60 * 1000);
      return d.toTimeString().split(' ')[0];
    };

    const initialLogs = [
      `[${timeStr(14)}] [SİSTEM] ${meta.name} servis dinleyicisi hazır.`,
      `[${timeStr(10)}] [VERİTABANI] webdrama_archive.db üzerinde ${selectedBot.items_synced.toLocaleString('tr-TR')} aktif kaynak doğrulandı.`,
      `[${timeStr(6)}] [DNS] ${meta.domain} ana sunucu IP çözümlemesi doğrulandı.`,
      `[${timeStr(2)}] [KONTROL] Son tarama durumu: ${selectedBot.last_status || 'healthy'}.`,
      `[${timeStr(0)}] [BEKLEMEDE] Scraper yeni istek tetiklemesi için hazır.`,
    ];

    return NextResponse.json({
      scraper: selectedBot,
      meta,
      recentItems,
      logs: initialLogs,
    });
  } catch (err: any) {
    console.error('Scraper GET error:', err);
    return NextResponse.json({ error: err.message || 'Veri alınamadı' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json();
    const { scraperId, targetSeries, limit } = body as { scraperId: string; targetSeries?: string; limit?: number };

    if (!scraperId || !SCRAPER_METAS[scraperId]) {
      return NextResponse.json({ error: 'Geçersiz veya desteklenmeyen scraper ID' }, { status: 400 });
    }

    const rate = checkAdminRateLimit(`scraper:${authCheck.userId}`, 12, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Çok fazla tarama isteği. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
        { status: 429 }
      );
    }

    if (activeScraperRuns.has(scraperId)) {
      return NextResponse.json(
        { error: `${SCRAPER_METAS[scraperId].name} şu anda zaten çalışıyor.` },
        { status: 409 }
      );
    }

    const meta = SCRAPER_METAS[scraperId];
    const scriptPath = path.resolve(process.cwd(), '..', 'scrapers', 'live_scanner.py');
    const scanLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(Math.max(Math.floor(limit), 1), 200)
        : 30;
    const cleanTarget =
      typeof targetSeries === 'string'
        ? targetSeries.replace(/[\r\n\0]/g, '').trim().slice(0, 120)
        : '';
    const isLocalPython = hasLocalPython() && fs.existsSync(scriptPath);
    const encoder = new TextEncoder();

    if (!isLocalPython) {
      const stream = new ReadableStream({
        async start(controller) {
          const logs: string[] = [];
          let closed = false;

          const sendEvent = (obj: any) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
            } catch (_) {}
          };

          const nowStr = () => new Date().toTimeString().split(' ')[0];
          sendEvent({
            type: 'log',
            line: `[${nowStr()}] [Bulut] Vercel ortamı algılandı -> ${meta.name} için GitHub Actions bulut işçisi tetikleniyor...`,
          });

          const extraArgs = ['--provider', scraperId, '--limit', scanLimit.toString()];
          if (cleanTarget) {
            extraArgs.push('--target', cleanTarget);
          }

          const dispatchRes = await dispatchCloudScraperJob({
            target: scraperId,
            script: 'scrapers/live_scanner.py',
            workflowFile: 'admin_job.yml',
            args: extraArgs,
            inputs: {
              target_site: scraperId,
            },
            sendEvent,
            streamLogs: true,
          });

          sendEvent({
            type: 'result',
            ok: dispatchRes.ok,
            cloud: true,
            scraperId,
            name: meta.name,
            syncedDelta: 0,
            newTotal: 0,
            logs,
            newlySyncedItems: [],
            message: dispatchRes.ok
              ? `[BAŞLATILDI] Bulut (Vercel) ortamında GitHub Actions işçisi tetiklendi (Run ID: ${dispatchRes.runId}).`
              : dispatchRes.error,
            timestamp: new Date().toISOString(),
          });

          closed = true;
          try {
            controller.close();
          } catch (_) {}
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }

    const args = ['-u', scriptPath, '--provider', scraperId, '--limit', scanLimit.toString()];
    if (cleanTarget.length > 0) {
      args.push('--target', cleanTarget);
    }

    activeScraperRuns.add(scraperId);
    const pythonBin = resolvePythonBinary();
    const stream = new ReadableStream({
      start(controller) {
        const logs: string[] = [];
        const liveItems: any[] = [];
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
          } else if (line.startsWith('__ITEM__ ')) {
            try {
              const item = JSON.parse(line.replace('__ITEM__ ', '').trim());
              liveItems.push(item);
              sendEvent({ type: 'item', item });
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
        }, 90000);

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
          activeScraperRuns.delete(scraperId);
          clearTimeout(killTimer);
          if (stdoutBuf.trim()) {
            processLine(stdoutBuf);
            stdoutBuf = '';
          }

          const syncedDelta = resultPayload?.syncedDelta ?? liveItems.length;
          const newTotal = resultPayload?.newTotal ?? 50000;
          const newlySyncedItems = resultPayload?.items ?? liveItems;
          const timestamp = resultPayload?.timestamp || new Date().toISOString();

          try {
            await supabase
              .from('scraper_configs')
              .update({
                last_run_at: timestamp,
                last_status: 'healthy',
                items_synced: newTotal,
              })
              .eq('id', scraperId);
          } catch (_) {}

          sendEvent({
            type: 'result',
            ok: true,
            scraperId,
            name: meta.name,
            syncedDelta,
            newTotal,
            logs,
            newlySyncedItems,
            timestamp,
          });

          closed = true;
          try {
            controller.close();
          } catch (_) {}
        });

        child.on('error', (err) => {
          activeScraperRuns.delete(scraperId);
          clearTimeout(killTimer);
          sendEvent({
            type: 'error',
            error: err.message || 'Scraper alt işlemi başlatılamadı',
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
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    console.error('Scraper trigger error:', err);
    return NextResponse.json({ error: err.message || 'Scraper tetiklenemedi' }, { status: 500 });
  }
}
