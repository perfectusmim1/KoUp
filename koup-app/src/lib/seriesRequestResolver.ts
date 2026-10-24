import { supabaseAdmin } from '@/lib/supabase';

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

export type RequestSourceType = 'anilist' | 'tmdb' | 'mdl' | 'imdb';

export interface ResolvedSeriesPreview {
  source_type: RequestSourceType;
  source_url: string;
  external_id: string;
  title: string;
  original_title: string | null;
  overview: string;
  cover_image: string;
  backdrop_image: string | null;
  release_year: number | null;
  content_type: 'dizi' | 'anime' | 'film';
  country_code: string | null;
  rating: string | null;
  episodes_count: number | null;
  existing_media?: {
    id: number;
    title: string;
    slug: string;
  } | null;
}

export interface ParsedRequestLink {
  sourceType: RequestSourceType;
  canonicalUrl: string;
  externalId: string;
  rawId: string;
  tmdbMediaType?: 'tv' | 'movie';
  mdlSlugTitle?: string;
}

export function parseSeriesRequestUrl(inputUrl: string): ParsedRequestLink | null {
  if (!inputUrl || typeof inputUrl !== 'string') return null;
  const trimmed = inputUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const path = parsed.pathname;

  // 1. AniList: https://anilist.co/anime/154587/Sousou-no-Frieren/
  if (host === 'anilist.co') {
    const m = path.match(/^\/anime\/(\d+)/i);
    if (!m) return null;
    const id = m[1];
    return {
      sourceType: 'anilist',
      canonicalUrl: `https://anilist.co/anime/${id}`,
      externalId: `anilist:${id}`,
      rawId: id,
    };
  }

  // 2. TMDB: https://www.themoviedb.org/tv/12345-slug or /movie/12345-slug
  if (host === 'themoviedb.org') {
    const m = path.match(/^\/(tv|movie)\/(\d+)/i);
    if (!m) return null;
    const mediaType = m[1].toLowerCase() as 'tv' | 'movie';
    const id = m[2];
    return {
      sourceType: 'tmdb',
      canonicalUrl: `https://www.themoviedb.org/${mediaType}/${id}`,
      externalId: `tmdb:${mediaType}:${id}`,
      rawId: id,
      tmdbMediaType: mediaType,
    };
  }

  // 3. MyDramaList (MDL): https://mydramalist.com/756775-queen-of-tears
  if (host === 'mydramalist.com') {
    const m =
      path.match(/^\/(\d+)(?:-([a-zA-Z0-9\-_]+))?/i) ||
      path.match(/^\/titles\/(\d+)/i);
    if (!m) return null;
    const id = m[1];
    const slugPart = m[2] || '';
    const humanSlug = slugPart
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      sourceType: 'mdl',
      canonicalUrl: slugPart
        ? `https://mydramalist.com/${id}-${slugPart}`
        : `https://mydramalist.com/${id}`,
      externalId: `mdl:${id}`,
      rawId: id,
      mdlSlugTitle: humanSlug || undefined,
    };
  }

  // 4. IMDb: https://www.imdb.com/title/tt12345678/
  if (host === 'imdb.com') {
    const m = path.match(/\/title\/(tt\d+)/i);
    if (!m) return null;
    const ttId = m[1].toLowerCase();
    return {
      sourceType: 'imdb',
      canonicalUrl: `https://www.imdb.com/title/${ttId}/`,
      externalId: `imdb:${ttId}`,
      rawId: ttId,
    };
  }

  return null;
}

function stripHtmlTags(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\(Source:.*?\)/gis, '')
    .replace(/\[Written by.*?\]/gis, '')
    .trim();
}

async function translateToTurkish(text: string): Promise<string> {
  const clean = stripHtmlTags(text);
  if (!clean || clean.length < 8) return clean;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(
      clean
    )}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const tr = data[0].map((s: any) => s[0]).join('').trim();
        if (tr.length > 8) return tr;
      }
    }
  } catch {}
  return clean;
}

async function resolveTmdbById(
  id: string,
  mediaType: 'tv' | 'movie'
): Promise<Omit<ResolvedSeriesPreview, 'source_type' | 'source_url' | 'external_id'> | null> {
  try {
    const [trRes, enRes] = await Promise.all([
      fetch(
        `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=tr-TR`,
        { signal: AbortSignal.timeout(7000) }
      ),
      fetch(
        `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=en-US`,
        { signal: AbortSignal.timeout(7000) }
      ),
    ]);

    if (!trRes.ok && !enRes.ok) return null;
    const trData = trRes.ok ? await trRes.json() : {};
    const enData = enRes.ok ? await enRes.json() : {};
    const data = Object.keys(trData).length > 0 ? trData : enData;

    const title =
      trData.name ||
      trData.title ||
      enData.name ||
      enData.title ||
      data.original_name ||
      data.original_title ||
      'Bilinmeyen Yapım';
    const originalTitle =
      data.original_name || data.original_title || enData.name || enData.title || null;

    let overview = (trData.overview || '').trim();
    if (!overview && enData.overview) {
      overview = await translateToTurkish(enData.overview);
    }

    const posterPath = data.poster_path || enData.poster_path;
    const backdropPath = data.backdrop_path || enData.backdrop_path;
    const coverImage = posterPath ? `https://image.tmdb.org/t/p/w780${posterPath}` : '/logo-dark.png';
    const backdropImage = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null;

    const dateStr = data.first_air_date || data.release_date || '';
    const releaseYear = dateStr ? Number(dateStr.slice(0, 4)) || null : null;

    const originCountries: string[] =
      data.origin_country ||
      (Array.isArray(data.production_countries)
        ? data.production_countries.map((c: any) => c.iso_3166_1)
        : []);
    const countryCode = originCountries[0] ? String(originCountries[0]).toUpperCase() : null;

    const genres: any[] = data.genres || enData.genres || [];
    const isAnimation = genres.some(
      (g) => g.id === 16 || /anim/i.test(String(g.name || ''))
    );

    const contentType: 'dizi' | 'anime' | 'film' =
      mediaType === 'movie'
        ? 'film'
        : isAnimation && ['JP', 'CN', 'KR'].includes(countryCode || '')
        ? 'anime'
        : 'dizi';

    const voteAvg = Number(data.vote_average || 0);
    const rating = voteAvg > 0 ? voteAvg.toFixed(1) : null;
    const episodesCount =
      mediaType === 'tv' && Number(data.number_of_episodes) > 0
        ? Number(data.number_of_episodes)
        : mediaType === 'movie'
        ? 1
        : null;

    return {
      title,
      original_title: originalTitle,
      overview: overview || `${title} yapımı için kullanıcı seri isteği.`,
      cover_image: coverImage,
      backdrop_image: backdropImage,
      release_year: releaseYear,
      content_type: contentType,
      country_code: countryCode,
      rating,
      episodes_count: episodesCount,
    };
  } catch {
    return null;
  }
}

async function resolveAnilistById(
  id: string
): Promise<Omit<ResolvedSeriesPreview, 'source_type' | 'source_url' | 'external_id'> | null> {
  try {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          format
          episodes
          seasonYear
          startDate { year }
          countryOfOrigin
          averageScore
          title {
            romaji
            english
            native
          }
          description(asHtml: false)
          coverImage {
            extraLarge
            large
          }
          bannerImage
        }
      }
    `;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { id: Number(id) } }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const m = json?.data?.Media;
    if (!m) return null;

    const title = m.title?.romaji || m.title?.english || m.title?.native || `Anime #${id}`;
    const originalTitle = m.title?.native || m.title?.english || null;
    const rawDesc = stripHtmlTags(m.description || '');
    const overview = rawDesc ? await translateToTurkish(rawDesc) : `${title} anime serisi.`;
    const coverImage = m.coverImage?.extraLarge || m.coverImage?.large || '/logo-dark.png';
    const backdropImage = m.bannerImage || null;
    const releaseYear = m.seasonYear || m.startDate?.year || null;
    const contentType: 'dizi' | 'anime' | 'film' = m.format === 'MOVIE' ? 'film' : 'anime';
    const countryCode = m.countryOfOrigin ? String(m.countryOfOrigin).toUpperCase() : 'JP';
    const rating = m.averageScore ? `${(Number(m.averageScore) / 10).toFixed(1)}` : null;
    const episodesCount = m.episodes ? Number(m.episodes) : null;

    return {
      title,
      original_title: originalTitle,
      overview,
      cover_image: coverImage,
      backdrop_image: backdropImage,
      release_year: releaseYear,
      content_type: contentType,
      country_code: countryCode,
      rating,
      episodes_count: episodesCount,
    };
  } catch {
    return null;
  }
}

async function resolveImdbById(
  ttId: string
): Promise<Omit<ResolvedSeriesPreview, 'source_type' | 'source_url' | 'external_id'> | null> {
  // 1. Try TMDB /find/{imdb_id} first for rich localized metadata
  try {
    const findRes = await fetch(
      `https://api.themoviedb.org/3/find/${ttId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=tr-TR`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (findRes.ok) {
      const findData = await findRes.json();
      const tvHit = findData?.tv_results?.[0];
      const movieHit = findData?.movie_results?.[0];
      if (tvHit?.id) {
        const resolved = await resolveTmdbById(String(tvHit.id), 'tv');
        if (resolved) return resolved;
      }
      if (movieHit?.id) {
        const resolved = await resolveTmdbById(String(movieHit.id), 'movie');
        if (resolved) return resolved;
      }
    }
  } catch {}

  // 2. Fallback to Stremio Cinemeta API for IMDb IDs
  for (const type of ['series', 'movie'] as const) {
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${ttId}.json`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const meta = json?.meta;
      if (!meta || !meta.name) continue;

      const overview = meta.description
        ? await translateToTurkish(meta.description)
        : `${meta.name} yapımı.`;
      const yearMatch = String(meta.releaseInfo || meta.year || '').match(/(\d{4})/);
      return {
        title: meta.name,
        original_title: meta.name,
        overview,
        cover_image: meta.poster || '/logo-dark.png',
        backdrop_image: meta.background || null,
        release_year: yearMatch ? Number(yearMatch[1]) : null,
        content_type: type === 'movie' ? 'film' : 'dizi',
        country_code: meta.country ? String(meta.country).slice(0, 2).toUpperCase() : null,
        rating: meta.imdbRating ? String(meta.imdbRating) : null,
        episodes_count: Array.isArray(meta.videos) ? meta.videos.length : null,
      };
    } catch {}
  }

  return null;
}

async function resolveMdlByLink(
  mdlId: string,
  slugTitle?: string
): Promise<Omit<ResolvedSeriesPreview, 'source_type' | 'source_url' | 'external_id'> | null> {
  let extractedTitle = slugTitle
    ? slugTitle
        .split(' ')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ')
    : '';
  let mdlPoster = '';
  let mdlSynopsis = '';
  let mdlYear: number | null = null;
  let mdlRating: string | null = null;
  let mdlEpisodes: number | null = null;
  let mdlNativeTitle: string | null = null;

  // 1. Try Kuryana MDL JSON API if available
  try {
    const kurRes = await fetch(`https://kuryana.vercel.app/id/${mdlId}`, {
      signal: AbortSignal.timeout(4500),
    });
    if (kurRes.ok) {
      const kd = await kurRes.json();
      const d = kd?.data;
      if (d?.title) {
        extractedTitle = d.title;
        mdlPoster = d.poster || '';
        mdlSynopsis = d.synopsis || '';
        mdlRating = d.rating ? String(d.rating) : null;
        if (d.details?.episodes) mdlEpisodes = Number(d.details.episodes) || null;
        if (d.others?.native_title?.[0]) mdlNativeTitle = d.others.native_title[0];
        const ym = String(d.details?.aired || d.year || '').match(/(\d{4})/);
        if (ym) mdlYear = Number(ym[1]);
      }
    }
  } catch {}

  // 2. Try direct HTML meta extraction if title/poster still missing
  if (!mdlPoster || !mdlSynopsis) {
    try {
      const htmlRes = await fetch(`https://mydramalist.com/${mdlId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
        const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
        const ogDesc = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];
        if (ogTitle && !ogTitle.toLowerCase().includes('just a moment')) {
          const cleanOgTitle = ogTitle.replace(/\s*\(\d{4}\).*$/, '').replace(/\s*-\s*MyDramaList.*$/i, '').trim();
          if (cleanOgTitle) extractedTitle = cleanOgTitle;
          const ym = ogTitle.match(/\((\d{4})\)/);
          if (ym) mdlYear = Number(ym[1]);
        }
        if (ogImage && !mdlPoster) mdlPoster = ogImage;
        if (ogDesc && !mdlSynopsis) mdlSynopsis = ogDesc;
      }
    } catch {}
  }

  // 3. Cross-enrich with TMDB using extractedTitle (or cleaned base title without "Season X")
  if (extractedTitle) {
    const searchCandidates = Array.from(
      new Set([
        extractedTitle,
        extractedTitle.replace(/\bSeason\s+\d+\b/gi, '').replace(/\bPart\s+\d+\b/gi, '').trim(),
      ])
    ).filter(Boolean);

    for (const q of searchCandidates) {
      try {
        const sRes = await fetch(
          `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(
            q
          )}&language=tr-TR`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (sRes.ok) {
          const sData = await sRes.json();
          const results: any[] = (sData?.results || []).filter(
            (r: any) => r.media_type === 'tv' || r.media_type === 'movie'
          );
          // Prefer Asian origin series if available
          const best =
            results.find((r) =>
              (r.origin_country || []).some((c: string) =>
                ['KR', 'CN', 'JP', 'TH', 'TW', 'HK', 'PH'].includes(c.toUpperCase())
              )
            ) || results[0];

          if (best?.id) {
            const tmdbResolved = await resolveTmdbById(
              String(best.id),
              best.media_type === 'movie' ? 'movie' : 'tv'
            );
            if (tmdbResolved) {
              const translatedMdlSynopsis = mdlSynopsis
                ? await translateToTurkish(mdlSynopsis)
                : '';
              return {
                title: extractedTitle || tmdbResolved.title,
                original_title: mdlNativeTitle || tmdbResolved.original_title,
                overview:
                  tmdbResolved.overview && tmdbResolved.overview.length > 25
                    ? tmdbResolved.overview
                    : translatedMdlSynopsis || tmdbResolved.overview,
                cover_image: tmdbResolved.cover_image || mdlPoster || '/logo-dark.png',
                backdrop_image: tmdbResolved.backdrop_image,
                release_year: mdlYear || tmdbResolved.release_year,
                content_type: tmdbResolved.content_type,
                country_code: tmdbResolved.country_code || 'KR',
                rating: mdlRating || tmdbResolved.rating,
                episodes_count: mdlEpisodes || tmdbResolved.episodes_count,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 4. If TMDB didn't have a match, use the MDL data directly
  if (extractedTitle) {
    const overview = mdlSynopsis
      ? await translateToTurkish(mdlSynopsis)
      : `${extractedTitle} (MyDramaList #${mdlId}) Asya yapımı dizi isteği.`;
    return {
      title: extractedTitle,
      original_title: mdlNativeTitle || extractedTitle,
      overview,
      cover_image: mdlPoster || '/logo-dark.png',
      backdrop_image: null,
      release_year: mdlYear,
      content_type: 'dizi',
      country_code: 'KR',
      rating: mdlRating,
      episodes_count: mdlEpisodes,
    };
  }

  return null;
}

export async function resolveSeriesRequestUrl(
  rawUrl: string
): Promise<{ data?: ResolvedSeriesPreview; error?: string }> {
  const parsed = parseSeriesRequestUrl(rawUrl);
  if (!parsed) {
    return {
      error:
        'Geçersiz bağlantı! Sadece AniList (anilist.co), TMDB (themoviedb.org), MyDramaList (mydramalist.com) veya IMDb (imdb.com) dizi/film bağlantıları kabul edilmektedir.',
    };
  }

  let metadata: Omit<ResolvedSeriesPreview, 'source_type' | 'source_url' | 'external_id'> | null =
    null;

  if (parsed.sourceType === 'tmdb') {
    metadata = await resolveTmdbById(parsed.rawId, parsed.tmdbMediaType || 'tv');
  } else if (parsed.sourceType === 'anilist') {
    metadata = await resolveAnilistById(parsed.rawId);
  } else if (parsed.sourceType === 'imdb') {
    metadata = await resolveImdbById(parsed.rawId);
  } else if (parsed.sourceType === 'mdl') {
    metadata = await resolveMdlByLink(parsed.rawId, parsed.mdlSlugTitle);
  }

  if (!metadata) {
    return {
      error:
        'Bağlantıdaki seri bilgileri çekilemedi. Lütfen bağlantının doğru bir yapım sayfasına ait olduğundan emin olun.',
    };
  }

  // Check if series already exists in public.media
  let existingMedia: { id: number; title: string; slug: string } | null = null;
  try {
    if (parsed.sourceType === 'tmdb') {
      const { data } = await supabaseAdmin
        .from('media')
        .select('id, title, slug')
        .eq('tmdb_id', Number(parsed.rawId))
        .limit(1)
        .maybeSingle();
      if (data) existingMedia = data;
    } else if (parsed.sourceType === 'anilist') {
      const { data } = await supabaseAdmin
        .from('media')
        .select('id, title, slug')
        .eq('anilist_id', Number(parsed.rawId))
        .limit(1)
        .maybeSingle();
      if (data) existingMedia = data;
    } else if (parsed.sourceType === 'imdb') {
      const { data } = await supabaseAdmin
        .from('media')
        .select('id, title, slug')
        .eq('imdb_id', parsed.rawId)
        .limit(1)
        .maybeSingle();
      if (data) existingMedia = data;
    } else if (parsed.sourceType === 'mdl') {
      const { data } = await supabaseAdmin
        .from('media')
        .select('id, title, slug')
        .or(`mdl_id.eq.${parsed.rawId},mydramalist_url.ilike.%/${parsed.rawId}%`)
        .limit(1)
        .maybeSingle();
      if (data) existingMedia = data;
    }

    if (!existingMedia && metadata.title) {
      const { data } = await supabaseAdmin
        .from('media')
        .select('id, title, slug')
        .or(`title.ilike.${metadata.title},title_en.ilike.${metadata.title}`)
        .limit(1)
        .maybeSingle();
      if (data) existingMedia = data;
    }
  } catch {}

  return {
    data: {
      source_type: parsed.sourceType,
      source_url: parsed.canonicalUrl,
      external_id: parsed.externalId,
      ...metadata,
      existing_media: existingMedia,
    },
  };
}
