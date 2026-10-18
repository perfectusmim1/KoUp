import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

interface TrailerResult {
  youtubeId: string | null;
  trailerUrl: string | null;
  source: 'db' | 'tmdb' | 'anilist' | 'youtube_search' | 'none';
  posterUrl?: string | null;
  backdropUrl?: string | null;
  imdbId?: string | null;
  imdbRating?: number | null;
}

// Fast in-memory server cache (per media id/slug) so repeated hover/detail checks resolve in <1ms
const trailerCache = new Map<string, { data: TrailerResult; ts: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function extractYouTubeId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const s = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function isScrapedLowResImage(url?: string | null): boolean {
  if (!url) return true;
  if (url.includes('image.tmdb.org') || url.includes('s4.anilist.co')) return false;
  return true;
}

async function fetchTmdbTrailerAndImages(
  tmdbId: number | null,
  imdbId: string | null,
  titles: string[],
  contentType: string,
  countryCode?: string | null
): Promise<{
  youtubeId: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  resolvedTmdbId: number | null;
  resolvedImdbId: string | null;
  voteAverage: number | null;
}> {
  let activeTmdbId = tmdbId;
  let mediaType: 'tv' | 'movie' = contentType === 'film' ? 'movie' : 'tv';
  let posterPath: string | null = null;
  let backdropPath: string | null = null;
  let voteAverage: number | null = null;

  // 1. Resolve via IMDb ID if tmdbId is missing
  if (!activeTmdbId && imdbId && imdbId.startsWith('tt')) {
    try {
      const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&language=tr-TR&api_key=${TMDB_API_KEY}`;
      const r = await fetch(findUrl, { signal: AbortSignal.timeout(4500) });
      if (r.ok) {
        const d = await r.json();
        const hit = (d.tv_results || [])[0] || (d.movie_results || [])[0];
        if (hit) {
          activeTmdbId = hit.id;
          mediaType = (d.tv_results || []).length > 0 ? 'tv' : 'movie';
          posterPath = hit.poster_path || null;
          backdropPath = hit.backdrop_path || null;
          if (hit.vote_average && Number(hit.vote_average) > 0) {
            voteAverage = Number(Number(hit.vote_average).toFixed(1));
          }
        }
      }
    } catch {}
  }

  // 2. Search TMDB by candidate titles if still not resolved or if we need poster/backdrop paths
  if (!activeTmdbId || !posterPath) {
    const endpoints: Array<'tv' | 'movie'> =
      contentType === 'film' ? ['movie', 'tv'] : ['tv', 'movie'];

    for (const rawTitle of titles) {
      const cleanTitle = (rawTitle || '')
        .replace(/\(\d{4}\)/g, '')
        .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full)\b/gi, '')
        .trim();
      if (!cleanTitle || cleanTitle.length < 2) continue;

      for (const ep of endpoints) {
        try {
          const sUrl = `https://api.themoviedb.org/3/search/${ep}?query=${encodeURIComponent(
            cleanTitle
          )}&language=tr-TR&api_key=${TMDB_API_KEY}`;
          const r = await fetch(sUrl, { signal: AbortSignal.timeout(4500) });
          if (r.ok) {
            const d = await r.json();
            const results: any[] = d.results || [];
            if (results.length > 0) {
              // Prefer country match if countryCode is known
              const cc = (countryCode || '').toUpperCase();
              const matched =
                (cc
                  ? results.find(
                      (item) =>
                        Array.isArray(item.origin_country) &&
                        item.origin_country.includes(cc) &&
                        (item.poster_path || item.backdrop_path)
                    )
                  : null) ||
                results.find((item) => item.poster_path || item.backdrop_path) ||
                results[0];

              if (matched) {
                if (!activeTmdbId) {
                  activeTmdbId = matched.id;
                  mediaType = ep;
                }
                if (!posterPath && matched.poster_path) posterPath = matched.poster_path;
                if (!backdropPath && matched.backdrop_path) backdropPath = matched.backdrop_path;
                if (!voteAverage && matched.vote_average && Number(matched.vote_average) > 0) {
                  voteAverage = Number(Number(matched.vote_average).toFixed(1));
                }
                break;
              }
            }
          }
        } catch {}
      }
      if (activeTmdbId && posterPath) break;
    }
  }

  let youtubeId: string | null = null;

  if (activeTmdbId) {
    try {
      // Query TMDB videos with multi-language fallback (TR, EN, KO, JA, ZH, null)
      const vidUrl = `https://api.themoviedb.org/3/${mediaType}/${activeTmdbId}/videos?api_key=${TMDB_API_KEY}&include_video_language=tr,en,ko,ja,zh,null`;
      const vr = await fetch(vidUrl, { signal: AbortSignal.timeout(4500) });
      if (vr.ok) {
        const vd = await vr.json();
        const results: any[] = (vd.results || []).filter(
          (v: any) => v.site === 'YouTube' && v.key
        );

        // Sort priority: Official Trailer -> Trailer -> Teaser -> Clip -> Opening
        const scoreVideo = (v: any) => {
          let s = 0;
          if (v.type === 'Trailer') s += 50;
          else if (v.type === 'Teaser') s += 35;
          else if (v.type === 'Opening Credits') s += 25;
          else if (v.type === 'Clip') s += 15;
          if (v.official) s += 20;
          if (v.iso_639_1 === 'tr') s += 15;
          else if (v.iso_639_1 === 'en') s += 10;
          return s;
        };

        results.sort((a, b) => scoreVideo(b) - scoreVideo(a));
        if (results.length > 0) {
          youtubeId = results[0].key;
        }
      }

      // If posterPath or backdropPath is still missing, fetch details directly
      if (!posterPath || !backdropPath) {
        const detUrl = `https://api.themoviedb.org/3/${mediaType}/${activeTmdbId}?api_key=${TMDB_API_KEY}&language=tr-TR`;
        const dr = await fetch(detUrl, { signal: AbortSignal.timeout(4000) });
        if (dr.ok) {
          const dd = await dr.json();
          if (!posterPath && dd.poster_path) posterPath = dd.poster_path;
          if (!backdropPath && dd.backdrop_path) backdropPath = dd.backdrop_path;
        }
      }
    } catch {}
  }

  // Resolve external IDs (IMDb ID) from TMDB if missing or corrupted
  let resolvedImdbId: string | null = null;
  if (activeTmdbId && (!imdbId || !/^tt\d+$/.test(imdbId))) {
    try {
      const extUrl = `https://api.themoviedb.org/3/${mediaType}/${activeTmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const er = await fetch(extUrl, { signal: AbortSignal.timeout(3500) });
      if (er.ok) {
        const ed = await er.json();
        if (ed.imdb_id && /^tt\d+$/.test(ed.imdb_id)) {
          resolvedImdbId = ed.imdb_id;
        }
      }
    } catch {}
  }

  return {
    youtubeId,
    posterUrl: posterPath ? `https://image.tmdb.org/t/p/w780${posterPath}` : null,
    backdropUrl: backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null,
    resolvedTmdbId: activeTmdbId,
    resolvedImdbId,
    voteAverage,
  };
}

async function fetchAniListTrailer(
  anilistId: number | null,
  titles: string[]
): Promise<{ youtubeId: string | null; posterUrl: string | null; backdropUrl: string | null }> {
  try {
    const query = anilistId
      ? `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            trailer { id site }
            bannerImage
            coverImage { extraLarge large }
          }
        }
      `
      : `
        query ($search: String) {
          Media(search: $search, type: ANIME) {
            trailer { id site }
            bannerImage
            coverImage { extraLarge large }
          }
        }
      `;

    const cleanSearch = (titles[0] || '')
      .replace(/\b(TV|2nd Season|Season \d+|Part \d+)\b/gi, '')
      .trim();

    const variables = anilistId ? { id: anilistId } : { search: cleanSearch };
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(4500),
    });

    if (r.ok) {
      const d = await r.json();
      const m = d?.data?.Media;
      if (m) {
        const ytId =
          m.trailer?.site?.toLowerCase() === 'youtube' && m.trailer?.id
            ? String(m.trailer.id).trim()
            : null;
        return {
          youtubeId: ytId,
          posterUrl: m.coverImage?.extraLarge || m.coverImage?.large || null,
          backdropUrl: m.bannerImage || null,
        };
      }
    }
  } catch {}
  return { youtubeId: null, posterUrl: null, backdropUrl: null };
}

async function searchYouTubeTrailerFallback(
  title: string,
  countryCode?: string | null,
  contentType?: string | null
): Promise<string | null> {
  try {
    const clean = title
      .replace(/\(\d{4}\)/g, '')
      .replace(/\b(izle|turkce|altyazili)\b/gi, '')
      .trim();
    const isTr = (countryCode || '').toUpperCase() === 'TR';
    const suffix = isTr
      ? 'dizisi resmi fragman'
      : contentType === 'anime'
        ? 'anime official trailer pv'
        : 'official trailer';
    const q = `${clean} ${suffix}`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=tr`;
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const slugParam = searchParams.get('slug');
    const titleParam = searchParams.get('title');

    const cacheKey = idParam || slugParam || titleParam || '';
    if (!cacheKey) {
      return NextResponse.json({ youtubeId: null, trailerUrl: null, source: 'none' });
    }

    const cached = trailerCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    let media: any = null;
    if (idParam) {
      const { data } = await supabase.from('media').select('*').eq('id', Number(idParam)).single();
      media = data;
    } else if (slugParam) {
      const { data } = await supabase.from('media').select('*').eq('slug', slugParam).single();
      media = data;
    }

    if (!media && !titleParam) {
      return NextResponse.json({ youtubeId: null, trailerUrl: null, source: 'none' });
    }

    // 1. Check if trailer_url is already stored in DB
    const existingYtId = extractYouTubeId(media?.trailer_url);
    const needsBetterImages =
      media && (isScrapedLowResImage(media.cover_image) || !media.backdrop_image);

    if (existingYtId && !needsBetterImages) {
      const res: TrailerResult = {
        youtubeId: existingYtId,
        trailerUrl: `https://www.youtube.com/watch?v=${existingYtId}`,
        source: 'db',
        posterUrl: media.cover_image,
        backdropUrl: media.backdrop_image,
      };
      trailerCache.set(cacheKey, { data: res, ts: Date.now() });
      return NextResponse.json(res);
    }

    const titles = [
      media?.title || titleParam || '',
      media?.title_en || '',
      media?.native_title || '',
      ...(Array.isArray(media?.aka_titles) ? media.aka_titles : []),
    ].filter(Boolean);

    let youtubeId: string | null = existingYtId;
    let source: TrailerResult['source'] = existingYtId ? 'db' : 'none';
    let posterUrl: string | null = null;
    let backdropUrl: string | null = null;

    // 2. If Anime, try AniList first
    if (media?.content_type === 'anime' || media?.anilist_id) {
      const al = await fetchAniListTrailer(media?.anilist_id || null, titles);
      if (al.youtubeId && !youtubeId) {
        youtubeId = al.youtubeId;
        source = 'anilist';
      }
      if (al.posterUrl) posterUrl = al.posterUrl;
      if (al.backdropUrl) backdropUrl = al.backdropUrl;
    }

    // 3. Try TMDB (for both trailer AND official 2:3 vertical poster + 16:9 backdrop!)
    const tmdb = await fetchTmdbTrailerAndImages(
      media?.tmdb_id || null,
      media?.imdb_id || null,
      titles,
      media?.content_type || 'dizi',
      media?.country_code || media?.country
    );

    if (tmdb.youtubeId && !youtubeId) {
      youtubeId = tmdb.youtubeId;
      source = 'tmdb';
    }
    if (tmdb.posterUrl && !posterUrl) posterUrl = tmdb.posterUrl;
    if (tmdb.backdropUrl && !backdropUrl) backdropUrl = tmdb.backdropUrl;

    // 4. Fallback to YouTube Trailer Search (covers MDL Asian dramas & Turkish TV series)
    if (!youtubeId && titles[0]) {
      const ytFallback = await searchYouTubeTrailerFallback(
        titles[0],
        media?.country_code || media?.country,
        media?.content_type
      );
      if (ytFallback) {
        youtubeId = ytFallback;
        source = 'youtube_search';
      }
    }

    // 5. Persist upgraded poster/backdrop, tmdb_id, imdb_id & imdb_rating to Supabase
    if (media?.id && (posterUrl || backdropUrl || tmdb.resolvedTmdbId || tmdb.resolvedImdbId || tmdb.voteAverage)) {
      const patch: any = { p_media_id: media.id };
      let shouldPatch = false;
      if (posterUrl && isScrapedLowResImage(media.cover_image)) {
        patch.p_cover_image = posterUrl;
        shouldPatch = true;
      }
      if (backdropUrl && (!media.backdrop_image || isScrapedLowResImage(media.backdrop_image))) {
        patch.p_backdrop_image = backdropUrl;
        shouldPatch = true;
      }
      if (tmdb.resolvedTmdbId && !media.tmdb_id) {
        patch.p_tmdb_id = tmdb.resolvedTmdbId;
        shouldPatch = true;
      }
      if (tmdb.resolvedImdbId && (!media.imdb_id || !/^tt\d+$/.test(media.imdb_id))) {
        patch.p_imdb_id = tmdb.resolvedImdbId;
        shouldPatch = true;
      }
      if (tmdb.voteAverage && !media.imdb_rating && !(media as any).imdb_score) {
        patch.p_imdb_rating = tmdb.voteAverage;
        shouldPatch = true;
      }
      if (shouldPatch) {
        supabase.rpc('patch_media_metadata', patch).then(() => {});
      }
    }

    const result: TrailerResult = {
      youtubeId,
      trailerUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
      source,
      posterUrl: posterUrl || media?.cover_image || null,
      backdropUrl: backdropUrl || media?.backdrop_image || null,
      imdbId: tmdb.resolvedImdbId || (media?.imdb_id && /^tt\d+$/.test(media.imdb_id) ? media.imdb_id : null),
      imdbRating: tmdb.voteAverage || media?.imdb_rating || null,
    };

    trailerCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { youtubeId: null, trailerUrl: null, source: 'none', error: err?.message },
      { status: 200 }
    );
  }
}
