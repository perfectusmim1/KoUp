import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds timeout

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

let archiveDb: DatabaseSync | null = null;
function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath = process.env.ARCHIVE_DB_PATH || path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    archiveDb = new DatabaseSync(dbPath, { readOnly: true });
    return archiveDb;
  } catch {
    return null;
  }
}

function cleanHtmlText(htmlStr: string): string {
  if (!htmlStr) return '';
  let s = htmlStr.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\(Source:.*?\)/gis, '');
  s = s.replace(/\[Written by.*?\]/gis, '');
  s = s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return s.trim();
}

function isBadOverview(text: string | null | undefined): boolean {
  if (!text || text.trim().length < 40) return true;
  const low = text.toLowerCase();
  const garbage = [
    '1080p',
    'full hd',
    'altyazılı',
    'altyazili',
    'tek parça',
    'tek parca',
    'kalitede',
    'dizisini türkçe',
    'dizisini turkce',
    'filmini türkçe',
    'filmini turkce',
    'dizibox',
    'diziyou',
    'webdramaturkey',
    'asyadizi',
    'kesintisiz izle',
    'yapımı dizi serisi',
    'yapımı film serisi',
    'yapımı program serisi',
    'bölümlerini türkçe',
    'sayfasından izleyebilirsiniz',
  ];
  return garbage.some((g) => low.includes(g));
}

function extractMdlId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/mydramalist\.com\/([0-9a-z-]+)/i);
  return m ? m[1] : null;
}

function formatContentTypeTR(contentType?: string, countryCode?: string): string {
  if (contentType === 'anime') return 'Anime';
  if (contentType === 'film') return 'Sinema Filmi';
  if (contentType === 'program') return 'Varyete & TV Programı';
  if (countryCode === 'KR') return 'K-Drama';
  if (countryCode === 'CN') return 'C-Drama';
  if (countryCode === 'JP') return 'J-Drama';
  if (countryCode === 'TH') return 'Tayland Dizisi';
  return 'Dizi';
}

async function enrichSingleMedia(m: any, db: DatabaseSync | null): Promise<any | null> {
  let needsUpdate = false;
  const patch: any = { id: m.id };

  const hasBadOverview = isBadOverview(m.overview);

  // 1. Check local archive first
  if (db) {
    try {
      const sqliteRow = db.prepare('SELECT overview, mydramalist_url, imdb_id, anilist_id FROM dramas WHERE id = ?').get(m.id) as any;
      if (sqliteRow) {
        if (hasBadOverview && !isBadOverview(sqliteRow.overview)) {
          patch.overview = sqliteRow.overview.trim();
          needsUpdate = true;
        }
        if (!m.mdl_id && (sqliteRow.mydramalist_url || m.mydramalist_url)) {
          patch.mdl_id = extractMdlId(sqliteRow.mydramalist_url || m.mydramalist_url);
          if (patch.mdl_id) needsUpdate = true;
        }
        if (!m.imdb_id && sqliteRow.imdb_id && sqliteRow.imdb_id.startsWith('tt')) {
          patch.imdb_id = sqliteRow.imdb_id;
          needsUpdate = true;
        }
      }
    } catch {}
  }

  // Candidate title
  const rawClean = m.title
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full)\b/gi, '')
    .trim();

  // 2. AniList for anime
  if (m.content_type === 'anime' && (!m.anilist_id || (hasBadOverview && !patch.overview))) {
    // Check anilist_cache first
    if (db) {
      try {
        const cleanT = rawClean.toLowerCase();
        const alc = db.prepare('SELECT anilist_id, anilist_url, raw_json FROM anilist_cache WHERE search_key = ? OR lower(english_title) = ? OR lower(romaji_title) = ?').get(cleanT, cleanT, cleanT) as any;
        if (alc) {
          if (!m.anilist_id && alc.anilist_id) {
            patch.anilist_id = alc.anilist_id;
            patch.anilist_url = alc.anilist_url || `https://anilist.co/anime/${alc.anilist_id}`;
            needsUpdate = true;
          }
          if (alc.raw_json) {
            const parsed = JSON.parse(alc.raw_json);
            if ((hasBadOverview && !patch.overview) && parsed.description) {
              const cleanDesc = cleanHtmlText(parsed.description);
              if (cleanDesc.length > 30) {
                patch.overview = cleanDesc;
                needsUpdate = true;
              }
            }
            if (!m.anilist_rating && parsed.averageScore) {
              patch.anilist_rating = Number(parsed.averageScore);
              needsUpdate = true;
            }
          }
        }
      } catch {}
    }

    // If still missing AniList ID, query live GraphQL
    if (!patch.anilist_id && !m.anilist_id) {
      try {
        const cleanForAniList = rawClean.replace(/\b(TV|2nd Season|Season \d+|Part \d+)\b/gi, '').trim();
        const gql = `
          query ($search: String) {
            Media(search: $search, type: ANIME) {
              id
              siteUrl
              description(asHtml: false)
              averageScore
              bannerImage
              coverImage { large extraLarge }
            }
          }
        `;
        const alResp = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query: gql, variables: { search: cleanForAniList } }),
          signal: AbortSignal.timeout(4000),
        });
        if (alResp.ok) {
          const alJson = await alResp.json();
          const hit = alJson.data?.Media;
          if (hit) {
            patch.anilist_id = hit.id;
            patch.anilist_url = hit.siteUrl || `https://anilist.co/anime/${hit.id}`;
            if (hit.averageScore) patch.anilist_rating = Number(hit.averageScore);
            if ((hasBadOverview && !patch.overview) && hit.description) {
              const cleanAlDesc = cleanHtmlText(hit.description);
              if (cleanAlDesc.length > 30) patch.overview = cleanAlDesc;
            }
            needsUpdate = true;
          }
        }
      } catch {}
    }
  }

  // 3. TMDB API for missing overview or missing tmdb_id
  if (!m.tmdb_id || (hasBadOverview && !patch.overview)) {
    try {
      const ep = m.content_type === 'film' ? 'movie' : 'tv';
      let tmdbHit: any = null;

      // Find by IMDb if available
      const effectiveImdb = patch.imdb_id || m.imdb_id;
      if (effectiveImdb && effectiveImdb.startsWith('tt')) {
        const findUrl = `https://api.themoviedb.org/3/find/${effectiveImdb}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
        const fResp = await fetch(findUrl, { signal: AbortSignal.timeout(4000) });
        if (fResp.ok) {
          const fData = await fResp.json();
          const items = (fData.tv_results || []).concat(fData.movie_results || []);
          if (items.length > 0) tmdbHit = items[0];
        }
      }

      // Search by title if not found
      if (!tmdbHit && rawClean.length >= 2) {
        const sUrl = `https://api.themoviedb.org/3/search/${ep}?query=${encodeURIComponent(rawClean)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
        const sResp = await fetch(sUrl, { signal: AbortSignal.timeout(4000) });
        if (sResp.ok) {
          const sData = await sResp.json();
          if (sData.results && sData.results.length > 0) tmdbHit = sData.results[0];
        }
      }

      if (tmdbHit) {
        patch.tmdb_id = tmdbHit.id;
        needsUpdate = true;

        const trOv = (tmdbHit.overview || '').trim();
        if (trOv.length > 30 && !isBadOverview(trOv)) {
          patch.overview = trOv;
        } else if (!patch.overview && hasBadOverview) {
          // English fallback
          try {
            const enUrl = `https://api.themoviedb.org/3/${ep}/${tmdbHit.id}?api_key=${TMDB_API_KEY}&language=en-US`;
            const enResp = await fetch(enUrl, { signal: AbortSignal.timeout(3000) });
            if (enResp.ok) {
              const enData = await enResp.json();
              if (enData.overview && enData.overview.trim().length > 30) {
                patch.overview = enData.overview.trim();
              }
            }
          } catch {}
        }

        if (tmdbHit.vote_average && Number(tmdbHit.vote_average) > 0 && !m.imdb_rating) {
          patch.imdb_rating = Number(Number(tmdbHit.vote_average).toFixed(1));
        }
        if (!m.backdrop_image && tmdbHit.backdrop_path) {
          patch.backdrop_image = `https://image.tmdb.org/t/p/original${tmdbHit.backdrop_path}`;
        }
        if (!m.cover_image && tmdbHit.poster_path) {
          patch.cover_image = `https://image.tmdb.org/t/p/w780${tmdbHit.poster_path}`;
        }
      }

      // Cinemeta fallback if rating is still missing
      if (!patch.imdb_rating && !m.imdb_rating && effectiveImdb && effectiveImdb.startsWith('tt')) {
        const typesToTry = m.content_type === 'film' ? ['movie', 'series'] : ['series', 'movie'];
        for (const cmType of typesToTry) {
          try {
            const cmUrl = `https://v3-cinemeta.strem.io/meta/${cmType}/${effectiveImdb}.json`;
            const cmResp = await fetch(cmUrl, { signal: AbortSignal.timeout(3000) });
            if (cmResp.ok) {
              const cmData = await cmResp.json();
              const cmRating = cmData?.meta?.imdbRating;
              if (cmRating && Number(cmRating) > 0) {
                patch.imdb_rating = Number(Number(cmRating).toFixed(1));
                needsUpdate = true;
                break;
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  // 4. Clean editorial fallback if still empty or bad
  if (hasBadOverview && !patch.overview) {
    const yearStr = m.release_year ? `${m.release_year} yılı ` : '';
    const catStr = m.categories && m.categories.length > 0 ? `${m.categories.slice(0, 3).join(', ')} türündeki ` : '';
    const typeStr = formatContentTypeTR(m.content_type, m.country_code);
    patch.overview = `${m.title}, ${yearStr}${catStr}${typeStr} yapımıdır. KoUp platformu üzerinde kesintisiz, Full HD ve Türkçe altyazılı seçenekleriyle tüm bölümlerini izleyebilirsiniz.`;
    needsUpdate = true;
  }

  return needsUpdate ? patch : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'bad_overviews';
    const limit = Math.min(Number(searchParams.get('limit') || '60'), 150);
    const offset = Number(searchParams.get('offset') || '0');

    const db = getArchiveDb();

    let query = supabase.from('media').select('*');

    if (mode === 'vitrin') {
      query = query.or('is_featured.eq.true,featured_order.not.is.null').order('views_total', { ascending: false }).limit(limit);
    } else if (mode === 'top') {
      query = query.order('views_total', { ascending: false }).limit(limit);
    } else if (mode === 'bad_overviews') {
      query = query
        .or('overview.is.null,overview.ilike.%1080p%,overview.ilike.%altyazılı%,overview.ilike.%tek parça%,overview.ilike.%kalitede%,overview.ilike.%yapımı dizi serisi%,overview.ilike.%yapımı film serisi%')
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
    } else if (mode === 'missing_imdb_rating' || mode === 'missing_ratings') {
      query = query
        .not('imdb_id', 'is', null)
        .is('imdb_rating', null)
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
    } else {
      query = query.order('id', { ascending: true }).range(offset, offset + limit - 1);
    }

    const { data: mediaBatch, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Enrich concurrently in small chunks of 10 to respect external rate limits
    const patches: any[] = [];
    const chunkSize = 10;
    for (let i = 0; i < (mediaBatch || []).length; i += chunkSize) {
      const slice = (mediaBatch || []).slice(i, i + chunkSize);
      const results = await Promise.all(slice.map((m) => enrichSingleMedia(m, db)));
      for (const p of results) {
        if (p) patches.push(p);
      }
    }

    let appliedCount = 0;
    if (patches.length > 0) {
      const { data: count, error: rpcErr } = await supabaseAdmin.rpc('patch_media_metadata_batch', {
        p_items: patches,
      });
      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message, patchesCount: patches.length }, { status: 500 });
      }
      appliedCount = count;
    }

    return NextResponse.json({
      success: true,
      mode,
      batchSize: mediaBatch?.length || 0,
      offset,
      limit,
      patchesPrepared: patches.length,
      appliedCount,
      samplePatches: patches.slice(0, 3),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
