import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { supabase, cleanOverviewText } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

let archiveDb: DatabaseSync | null = null;
function getArchiveDb(): DatabaseSync | null {
  if (archiveDb) return archiveDb;
  const dbPath = process.env.ARCHIVE_DB_PATH || path.resolve(process.cwd(), '..', 'webdrama_archive.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    archiveDb = new DatabaseSync(dbPath);
    return archiveDb;
  } catch {
    return null;
  }
}

function cleanHtmlText(htmlStr: string): string {
  if (!htmlStr) return '';
  let s = cleanOverviewText(htmlStr);
  s = s.replace(/\(Source:.*?\)/gis, '');
  s = s.replace(/\[Written by.*?\]/gis, '');
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
    'dizikorea',
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

const COUNTRY_MAP: Record<string, string> = {
  KR: 'Güney Kore',
  CN: 'Çin',
  JP: 'Japonya',
  TH: 'Tayland',
  TW: 'Tayvan',
  HK: 'Hong Kong',
  PH: 'Filipinler',
  US: 'ABD',
  GB: 'Birleşik Krallık',
  FR: 'Fransa',
  DE: 'Almanya',
  ES: 'İspanya',
  IT: 'İtalya',
  TR: 'Türkiye',
  IN: 'Hindistan',
};

async function translateToTurkish(text: string): Promise<string> {
  if (!text || text.trim().length < 10) return text || '';
  try {
    const clean = text
      .replace(/\(Source:.*?\)/gis, '')
      .replace(/\[Written by.*?\]/gis, '')
      .trim();
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const tr = data[0].map((s: any) => s[0]).join('').trim();
        if (tr.length > 10) return tr;
      }
    }
  } catch {}
  return text;
}

function scoreTmdbCandidate(queryTitle: string, candidate: any, targetYear?: number, targetCountry?: string): number {
  let score = 0;
  const tName = (candidate.name || candidate.title || '').toLowerCase();
  const oName = (candidate.original_name || candidate.original_title || '').toLowerCase();
  const qLow = queryTitle.toLowerCase();

  if (qLow === tName || qLow === oName) score += 60;
  else if (qLow.includes(tName) || tName.includes(qLow) || qLow.includes(oName) || oName.includes(qLow)) score += 35;
  else score += 10;

  const dateStr = candidate.first_air_date || candidate.release_date || '';
  if (dateStr && targetYear) {
    const itemYear = parseInt(dateStr.slice(0, 4), 10);
    if (!isNaN(itemYear)) {
      const diff = Math.abs(itemYear - targetYear);
      if (diff === 0) score += 35;
      else if (diff === 1) score += 20;
      else if (diff >= 3) score -= 35;
    }
  }

  const origLang = candidate.original_language || '';
  const originCountries = candidate.origin_country || [];
  if (targetCountry) {
    const tc = targetCountry.toUpperCase();
    if (originCountries.includes(tc)) score += 25;
    else if (tc === 'KR' && origLang === 'ko') score += 25;
    else if (tc === 'CN' && (origLang === 'zh' || origLang === 'cn')) score += 25;
    else if (tc === 'JP' && origLang === 'ja') score += 25;
    else if (tc === 'TH' && origLang === 'th') score += 25;
    else if (['KR', 'CN', 'JP', 'TH'].includes(tc) && ['en', 'es', 'de', 'fr'].includes(origLang)) score -= 30;
  }

  if (candidate.poster_path) score += 10;
  if (candidate.backdrop_path) score += 5;

  return score;
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const slug = searchParams.get('slug');
    const force = searchParams.get('force') === 'true';

    if (!id && !slug) {
      return NextResponse.json({ error: 'id veya slug belirtilmelidir' }, { status: 400 });
    }

    let q = supabase.from('media').select('*');
    if (id) q = q.eq('id', Number(id));
    else if (slug) q = q.eq('slug', slug);

    const { data: media, error } = await q.single();
    if (error || !media) {
      return NextResponse.json({ error: 'Yapım bulunamadı' }, { status: 404 });
    }

    const isOfficialHighResCover =
      !!media.cover_image &&
      (media.cover_image.includes('image.tmdb.org') ||
        media.cover_image.includes('s4.anilist.co'));
    const hasBadOverview = isBadOverview(media.overview);
    const hasImages = !!(isOfficialHighResCover && media.backdrop_image);
    const hasValidImdbId = !!media.imdb_id && /^tt\d+$/.test(media.imdb_id);
    const hasImdbRating = (media.imdb_rating && Number(media.imdb_rating) > 0) || (media.content_type === 'anime' && media.anilist_rating);
    const hasMatching = !!(media.tmdb_id || media.anilist_id || (media.mdl_id && hasImdbRating));

    // If completely intact and not force requested, return already enriched
    if (!force && !hasBadOverview && hasImages && hasMatching && hasImdbRating && (hasValidImdbId || !media.imdb_id)) {
      return NextResponse.json({
        alreadyEnriched: true,
        media: {
          id: media.id,
          title: media.title,
          overview: media.overview,
          tmdb_id: media.tmdb_id,
          imdb_id: media.imdb_id,
          imdb_rating: media.imdb_rating,
          mdl_id: media.mdl_id,
          mdl_rating: media.mdl_rating,
          anilist_id: media.anilist_id,
          anilist_rating: media.anilist_rating,
          cover_image: media.cover_image,
          backdrop_image: media.backdrop_image,
        },
      });
    }

    const patch: any = {
      p_media_id: media.id,
    };

    // Candidate titles to search TMDB & AniList
    const rawClean = media.title
      .replace(/\(\d{4}\)/g, '')
      .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full)\b/gi, '')
      .trim();
    const searchQueries: string[] = [rawClean, media.title];
    if (media.title_en && !searchQueries.includes(media.title_en)) searchQueries.push(media.title_en);
    if (Array.isArray(media.aka_titles)) {
      for (const aka of media.aka_titles) {
        if (aka && !searchQueries.includes(aka)) searchQueries.push(aka);
      }
    }
    if (media.native_title && !searchQueries.includes(media.native_title)) searchQueries.push(media.native_title);

    // 1. Check local archive first (instant & clean)
    const db = getArchiveDb();
    if (db) {
      try {
        const sqliteRow = db.prepare('SELECT overview, mydramalist_url, imdb_id, anilist_id FROM dramas WHERE id = ?').get(media.id) as any;
        if (sqliteRow) {
          if (hasBadOverview && !isBadOverview(sqliteRow.overview)) {
            patch.p_overview = cleanOverviewText(sqliteRow.overview);
          }
          if (!media.mdl_id && sqliteRow.mydramalist_url) {
            patch.p_mdl_id = extractMdlId(sqliteRow.mydramalist_url);
          }
          if (!media.imdb_id && sqliteRow.imdb_id && sqliteRow.imdb_id.startsWith('tt')) {
            patch.p_imdb_id = sqliteRow.imdb_id;
          }
        }
      } catch {}
    }

    // 2. AniList GraphQL Lookup for Anime
    let anilistHit: any = null;
    if (media.content_type === 'anime') {
      try {
        const cleanForAniList = rawClean.replace(/\b(TV|2nd Season|Season \d+|Part \d+)\b/gi, '').trim();
        const gql = `
          query ($search: String) {
            Media(search: $search, type: ANIME) {
              id
              siteUrl
              title { romaji english native }
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
          signal: AbortSignal.timeout(6000),
        });
        if (alResp.ok) {
          const alJson = await alResp.json();
          anilistHit = alJson.data?.Media;
          if (anilistHit) {
            patch.p_anilist_id = anilistHit.id;
            patch.p_anilist_url = anilistHit.siteUrl || `https://anilist.co/anime/${anilistHit.id}`;
            if (anilistHit.averageScore) {
              patch.p_anilist_rating = Number(anilistHit.averageScore);
            }
            if ((hasBadOverview || !patch.p_overview) && anilistHit.description) {
              const cleanAlDesc = cleanHtmlText(anilistHit.description);
              if (cleanAlDesc.length > 30) {
                patch.p_overview = cleanAlDesc;
              }
            }
            if (!media.cover_image && (anilistHit.coverImage?.extraLarge || anilistHit.coverImage?.large)) {
              patch.p_cover_image = anilistHit.coverImage?.extraLarge || anilistHit.coverImage?.large;
            }
            if (!media.backdrop_image && anilistHit.bannerImage) {
              patch.p_backdrop_image = anilistHit.bannerImage;
            }
          }
        }
      } catch {}
    }

    // 3. TMDB API Lookup (for all series, films, and anime with Turkish overviews)
    let tmdbHit: any = null;
    let tmdbType: 'tv' | 'movie' = media.content_type === 'film' ? 'movie' : 'tv';

    // A. If imdb_id is available, find directly by IMDb ID
    const effectiveImdb = patch.p_imdb_id || media.imdb_id;
    if (effectiveImdb && effectiveImdb.startsWith('tt')) {
      try {
        const findUrl = `https://api.themoviedb.org/3/find/${effectiveImdb}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
        const fResp = await fetch(findUrl, { signal: AbortSignal.timeout(6000) });
        if (fResp.ok) {
          const fData = await fResp.json();
          const items = (fData.tv_results || []).concat(fData.movie_results || []);
          if (items.length > 0) {
            tmdbHit = items[0];
            tmdbType = (fData.tv_results || []).length > 0 ? 'tv' : 'movie';
          }
        }
      } catch {}
    }

    // B. Search by candidate titles if not matched yet
    if (!tmdbHit) {
      const endpoints = media.content_type === 'film' ? ['search/movie', 'search/tv'] : ['search/tv', 'search/movie'];
      let bestScore = 0;
      for (const qTitle of searchQueries) {
        if (!qTitle || qTitle.length < 2) continue;
        for (const ep of endpoints) {
          try {
            const searchUrl = `https://api.themoviedb.org/3/${ep}?query=${encodeURIComponent(qTitle)}&api_key=${TMDB_API_KEY}&language=tr-TR`;
            const sResp = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
            if (sResp.ok) {
              const sData = await sResp.json();
              if (sData.results && sData.results.length > 0) {
                for (const r of sData.results) {
                  const score = scoreTmdbCandidate(qTitle, r, media.release_year, media.country_code);
                  if (score > bestScore) {
                    bestScore = score;
                    tmdbHit = r;
                    tmdbType = ep.includes('movie') ? 'movie' : 'tv';
                  }
                }
              }
            }
          } catch {}
        }
        if (bestScore >= 80) break;
      }
      if (bestScore < 45) {
        tmdbHit = null;
      }
    }

    // Process TMDB Hit
    if (tmdbHit) {
      patch.p_tmdb_id = tmdbHit.id;

      // Turkish Overview: Try TMDB tr-TR first, otherwise fetch English and translate to Turkish!
      const trOv = cleanOverviewText(tmdbHit.overview);
      if (trOv.length > 30 && !isBadOverview(trOv)) {
        patch.p_overview = trOv;
      } else if (!patch.p_overview && hasBadOverview) {
        try {
          const enUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbHit.id}?api_key=${TMDB_API_KEY}&language=en-US`;
          const enResp = await fetch(enUrl, { signal: AbortSignal.timeout(4000) });
          if (enResp.ok) {
            const enData = await enResp.json();
            const cleanEn = cleanOverviewText(enData.overview);
            if (cleanEn.length > 20) {
              const translated = await translateToTurkish(cleanEn);
              if (translated && translated.length > 20) {
                patch.p_overview = translated;
              } else {
                patch.p_overview = cleanEn;
              }
            }
          }
        } catch {}
      }

      // Title & Native Title
      if (tmdbHit.title || tmdbHit.name) {
        patch.p_title_tr = tmdbHit.title || tmdbHit.name;
      }
      if (tmdbHit.original_title || tmdbHit.original_name) {
        patch.p_native_title = tmdbHit.original_title || tmdbHit.original_name;
      }

      // Origin Country & Year correction (fix Asian titles erroneously marked as US)
      const originCountries = tmdbHit.origin_country || [];
      let detectedCountry = originCountries[0];
      if (!detectedCountry && tmdbHit.original_language) {
        const langMap: Record<string, string> = { ko: 'KR', zh: 'CN', ja: 'JP', th: 'TH', en: 'US' };
        detectedCountry = langMap[tmdbHit.original_language];
      }
      if (detectedCountry) {
        detectedCountry = detectedCountry.toUpperCase();
        if (
          media.country_code === 'US' ||
          !media.country_code ||
          (['KR', 'CN', 'JP', 'TH', 'TW'].includes(detectedCountry) && media.country_code !== detectedCountry)
        ) {
          patch.p_country_code = detectedCountry;
          patch.p_country_name = COUNTRY_MAP[detectedCountry] || 'Asya';
        }
      }

      const dateStr = tmdbHit.first_air_date || tmdbHit.release_date;
      if (dateStr && dateStr.length >= 4) {
        const y = parseInt(dateStr.slice(0, 4), 10);
        if (!isNaN(y) && (!media.release_year || Math.abs(media.release_year - y) > 0)) {
          patch.p_release_year = y;
        }
      }

      // Backdrop Image
      if (
        (!media.backdrop_image || !media.backdrop_image.includes('image.tmdb.org')) &&
        tmdbHit.backdrop_path
      ) {
        patch.p_backdrop_image = `https://image.tmdb.org/t/p/w1280${tmdbHit.backdrop_path}`;
      }

      // Cover Poster Image — replace low-res/landscape scraped covers with official 2:3 TMDB poster!
      if (!isOfficialHighResCover && tmdbHit.poster_path) {
        patch.p_cover_image = `https://image.tmdb.org/t/p/w780${tmdbHit.poster_path}`;
      }

      // Fetch external IDs (IMDb ID) from TMDB
      if ((!media.imdb_id || !/^tt\d+$/.test(media.imdb_id)) && !patch.p_imdb_id) {
        try {
          const extUrl = `https://api.themoviedb.org/3/${tmdbType}/${tmdbHit.id}/external_ids?api_key=${TMDB_API_KEY}`;
          const extResp = await fetch(extUrl, { signal: AbortSignal.timeout(4000) });
          if (extResp.ok) {
            const extData = await extResp.json();
            if (extData.imdb_id && /^tt\d+$/.test(extData.imdb_id)) {
              patch.p_imdb_id = extData.imdb_id;
            }
          }
        } catch {}
      }
    }

    // 3.5. Authoritative IMDb Rating from Cinemeta (NEVER from TMDB vote_average!)
    const effectiveImdbId = patch.p_imdb_id || (media.imdb_id && /^tt\d+$/.test(media.imdb_id) ? media.imdb_id : null);
    if (effectiveImdbId) {
      const typesToTry = media.content_type === 'film' ? ['movie', 'series'] : ['series', 'movie'];
      for (const cmType of typesToTry) {
        try {
          const cmUrl = `https://v3-cinemeta.strem.io/meta/${cmType}/${effectiveImdbId}.json`;
          const cmResp = await fetch(cmUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(3500),
          });
          if (cmResp.ok) {
            const text = await cmResp.text();
            if (text.startsWith('{')) {
              const cmData = JSON.parse(text);
              const cmRating = cmData?.meta?.imdbRating;
              if (cmRating && Number(cmRating) > 0) {
                patch.p_imdb_rating = Number(Number(cmRating).toFixed(1));
                break;
              }
            }
          }
        } catch {}
      }
    }

    // 3.8. Bogus MDL cleanup: If content is Western (US, GB, DE, FR), remove any invalid MDL link
    const effectiveCountry = patch.p_country_code || media.country_code;
    if (['US', 'GB', 'DE', 'FR', 'ES', 'IT'].includes(effectiveCountry) && media.mdl_id) {
      patch.p_mdl_id = '__CLEAR__';
    }

    // 4. Guaranteed Editorial Turkish Overview Fallback if still empty or garbage
    if (hasBadOverview && !patch.p_overview) {
      const yearStr = media.release_year ? `${media.release_year} yılı ` : '';
      const catStr = media.categories && media.categories.length > 0 ? `${media.categories.slice(0, 3).join(', ')} türündeki ` : '';
      const typeStr = formatContentTypeTR(media.content_type, media.country_code);
      patch.p_overview = `${media.title}, ${yearStr}${catStr}${typeStr} yapımıdır. KoUp platformu üzerinde kesintisiz, Full HD ve Türkçe altyazılı seçenekleriyle tüm bölümlerini izleyebilirsiniz.`;
    }

    // 5. Apply to Supabase DB via patch_media_metadata RPC
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('patch_media_metadata', patch);
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message, patch }, { status: 500 });
    }

    // 6. Also persist directly to local SQLite archive for instant offline/local speed
    if (db) {
      try {
        db.prepare(`
          UPDATE dramas
          SET cover_image = COALESCE(?, cover_image),
              overview = COALESCE(?, overview),
              imdb_id = COALESCE(?, imdb_id),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          patch.p_cover_image || null,
          patch.p_overview || null,
          patch.p_imdb_id || null,
          media.id
        );
      } catch {}
    }

    return NextResponse.json({
      success: true,
      updatedMedia: {
        id: media.id,
        title: media.title,
        title_tr: patch.p_title_tr || media.title_tr,
        native_title: patch.p_native_title || media.native_title,
        country_code: patch.p_country_code || media.country_code,
        country_name: patch.p_country_name || media.country_name,
        release_year: patch.p_release_year || media.release_year,
        overview: patch.p_overview || media.overview,
        tmdb_id: patch.p_tmdb_id || media.tmdb_id,
        imdb_id: patch.p_imdb_id || media.imdb_id,
        imdb_rating: patch.p_imdb_rating || media.imdb_rating,
        mdl_id: patch.p_mdl_id === '__CLEAR__' ? null : (patch.p_mdl_id || media.mdl_id),
        mdl_rating: patch.p_mdl_rating || media.mdl_rating,
        anilist_id: patch.p_anilist_id || media.anilist_id,
        anilist_rating: patch.p_anilist_rating || media.anilist_rating,
        cover_image: patch.p_cover_image || media.cover_image,
        backdrop_image: patch.p_backdrop_image || media.backdrop_image,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body.id || body.mediaId;
    const slug = body.slug;
    const force = body.force === true;
    const url = new URL(req.url);
    if (id) url.searchParams.set('id', String(id));
    if (slug) url.searchParams.set('slug', String(slug));
    if (force) url.searchParams.set('force', 'true');
    return GET(new NextRequest(url, { headers: req.headers }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

