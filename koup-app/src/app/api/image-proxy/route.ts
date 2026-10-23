import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max to prevent memory exhaustion

const SCRAPER_BLOCK_HOSTS = [
  'webdrama',
  'macellan',
  'hdfilmcehennemi',
  'dizifon',
  'dizikorea',
  'ddizi',
  'dizibox',
  'asyaanimeleri',
  'asyaluna',
  'asyadizi',
  'turkanime',
  'asyaking',
  'diziyou',
  'dizilla',
];

function isScraperHost(urlStr?: string | null): boolean {
  if (!urlStr) return false;
  const low = urlStr.toLowerCase();
  return SCRAPER_BLOCK_HOSTS.some((h) => low.includes(h));
}

function persistEnrichedCoverToSupabase(mediaId?: string | number | null, posterUrl?: string | null, tmdbId?: string | number | null) {
  if (!mediaId || !posterUrl || !posterUrl.startsWith('https://image.tmdb.org/')) return;
  const mId = typeof mediaId === 'number' ? mediaId : parseInt(String(mediaId), 10);
  if (isNaN(mId) || mId <= 0) return;

  const payload: Record<string, any> = {
    cover_image: posterUrl,
    updated_at: new Date().toISOString(),
  };
  if (tmdbId) {
    const tId = typeof tmdbId === 'number' ? tmdbId : parseInt(String(tmdbId), 10);
    if (!isNaN(tId) && tId > 0) payload.tmdb_id = tId;
  }

  void Promise.resolve(
    supabaseAdmin
      .from('media')
      .update(payload)
      .eq('id', mId)
  ).catch(() => {});
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.home$/i,
  /\.arpa$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
];

function isBlockedIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Explicit host patterns
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }

  // Exact IP / hostname blocks
  if (['127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata'].includes(host)) {
    return true;
  }

  // IPv4 Private & Loopback & Link-Local & CGNAT regex
  // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 0.0.0.0/8
  const ipv4PrivateRegex =
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(?:6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|0\.)/;
  if (ipv4PrivateRegex.test(host)) {
    return true;
  }

  // IPv6 Private & Loopback (fc00::/7, fe80::/10, ::1, ::ffff:127.0.0.1)
  if (host.startsWith('::') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }

  // Obfuscated / integer decimal IP format (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) {
    return true;
  }

  return false;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPersonFallbackSvg(rawName?: string | null): string {
  const cleanName = (rawName || 'Oyuncu').trim();
  const initials = cleanName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="avatarBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e2029"/>
      <stop offset="50%" stop-color="#121318"/>
      <stop offset="100%" stop-color="#0a0a0d"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="60%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="400" rx="200" fill="url(#avatarBg)"/>
  <circle cx="200" cy="200" r="190" fill="url(#glow)"/>
  <circle cx="200" cy="200" r="196" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="4"/>
  <text x="200" y="218" text-anchor="middle" fill="#ffffff" fill-opacity="0.88" font-family="sans-serif" font-weight="700" font-size="72" letter-spacing="2">${escapeXml(
    initials || 'KP'
  )}</text>
  <text x="200" y="255" text-anchor="middle" fill="#38BDF8" fill-opacity="0.6" font-family="sans-serif" font-weight="600" font-size="14" letter-spacing="3">KOUP CAST</text>
</svg>`;
}

function buildFallbackSvg(rawTitle?: string | null): string {
  const cleanTitle = (rawTitle || '').trim();
  if (!cleanTitle) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141418"/>
      <stop offset="50%" stop-color="#0d0d11"/>
      <stop offset="100%" stop-color="#08080a"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#E5A93C" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <polygon points="120,620 480,220 530,270 180,660" fill="url(#beam)"/>
  <text x="300" y="450" text-anchor="middle" fill="#ffffff" fill-opacity="0.82" font-family="sans-serif" font-weight="800" font-size="64" letter-spacing="6">KoUp</text>
  <text x="300" y="495" text-anchor="middle" fill="#a1a1aa" fill-opacity="0.6" font-family="sans-serif" font-weight="500" font-size="18" letter-spacing="4">CINEMA ARCHIVE</text>
</svg>`;
  }

  const words = cleanTitle.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= 18) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w.slice(0, 20);
      if (lines.length >= 2) break;
    }
  }
  if (current && lines.length < 3) lines.push(current);

  const startY = lines.length === 1 ? 445 : lines.length === 2 ? 425 : 405;
  const textElements = lines
    .map(
      (line, idx) =>
        `<text x="300" y="${startY + idx * 44}" text-anchor="middle" fill="#ffffff" fill-opacity="0.9" font-family="sans-serif" font-weight="800" font-size="34" letter-spacing="1">${escapeXml(
          line
        )}</text>`
    )
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#14161d"/>
      <stop offset="50%" stop-color="#0d0e12"/>
      <stop offset="100%" stop-color="#08080a"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.32"/>
      <stop offset="50%" stop-color="#E5A93C" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <polygon points="100,640 490,210 540,260 170,680" fill="url(#beam)"/>
  <text x="300" y="330" text-anchor="middle" fill="#38BDF8" fill-opacity="0.7" font-family="sans-serif" font-weight="700" font-size="16" letter-spacing="6">KOUP TV+</text>
  ${textElements}
  <text x="300" y="555" text-anchor="middle" fill="#a1a1aa" fill-opacity="0.5" font-family="sans-serif" font-weight="500" font-size="15" letter-spacing="4">CINEMA ARCHIVE</text>
</svg>`;
}

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const titlePosterCache = new Map<string, string>();
const personPosterCache = new Map<string, string>();

async function fetchTmdbPersonForTitle(rawName: string): Promise<string | null> {
  const cleanName = (rawName || '').replace(/\s+/g, ' ').trim();
  if (!cleanName || cleanName.length < 2) return null;

  const cacheKey = cleanName.toLowerCase();
  if (personPosterCache.has(cacheKey)) {
    return personPosterCache.get(cacheKey) || null;
  }

  // Generate queries including hyphenation and Asian name ordering:
  // e.g. "Tang Shui Yu" -> "Shuiyu Tang", "Cha Chung Hwa" -> "Cha Chung-hwa"
  const queries: string[] = [cleanName];
  if (cleanName.includes('-')) {
    const noDash = cleanName.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (!queries.includes(noDash)) queries.push(noDash);
  } else {
    const words = cleanName.split(' ');
    if (words.length === 3) {
      queries.push(`${words[0]} ${words[1]}-${words[2]}`);
      queries.push(`${words[1]} ${words[2]} ${words[0]}`);
      queries.push(`${words[0]} ${words[1]}${words[2]}`);
      queries.push(`${words[1]}${words[2]} ${words[0]}`);
      queries.push(`${words[0]} ${words[1]}`);
    } else if (words.length === 2) {
      queries.push(`${words[1]} ${words[0]}`);
    }
  }

  for (const q of queries) {
    try {
      const url = `https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(
        q
      )}&api_key=${TMDB_API_KEY}&language=tr-TR`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const d = await res.json();
        const results = (d.results || []) as any[];
        const withProfile = results.filter((p) => !!p.profile_path);
        if (withProfile.length > 0) {
          const normQ = q.toLowerCase().replace(/[^a-z0-9]/g, '');
          withProfile.sort((a, b) => {
            const aNameNorm = (a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const bNameNorm = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const aExact = aNameNorm === normQ;
            const bExact = bNameNorm === normQ;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            return (b.popularity || 0) - (a.popularity || 0);
          });

          const hit = withProfile[0];
          const imgUrl = `https://image.tmdb.org/t/p/w185${hit.profile_path}`;
          personPosterCache.set(cacheKey, imgUrl);
          return imgUrl;
        }
      }
    } catch {}
  }

  // AniList Character or Staff fallback
  try {
    const gql = `
      query ($search: String) {
        Page(page: 1, perPage: 2) {
          characters(search: $search) {
            image { large medium }
          }
          staff(search: $search) {
            image { large medium }
          }
        }
      }
    `;
    const alResp = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: gql, variables: { search: cleanName } }),
      signal: AbortSignal.timeout(3500),
    });
    if (alResp.ok) {
      const alJson = await alResp.json();
      const charHit = alJson.data?.Page?.characters?.[0]?.image;
      const staffHit = alJson.data?.Page?.staff?.[0]?.image;
      const hitUrl = charHit?.large || charHit?.medium || staffHit?.large || staffHit?.medium;
      if (hitUrl) {
        personPosterCache.set(cacheKey, hitUrl);
        return hitUrl;
      }
    }
  } catch {}

  return null;
}

function transliterateTrToAscii(str: string): string {
  return str
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/²/g, '2')
    .replace(/³/g, '3');
}

function normalizeTitleForMatch(str?: string | null): string {
  if (!str) return '';
  return transliterateTrToAscii(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSlugFromUrl(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    const lastPart = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const cleanFile = decodeURIComponent(lastPart).replace(/\.(webp|jpe?g|png|avif)$/i, '');
    const cleanSlug = cleanFile
      .replace(/^(?:hd-film-|hd-|film-|\d+-)+/gi, '')
      .replace(/-(?:izle|full|hdf-\d+|hdf|film|\d+)$/gi, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanSlug.length >= 2 ? cleanSlug : null;
  } catch {
    return null;
  }
}

function isTitleMatch(expectedTitle?: string | null, candidateTitle?: string | null): boolean {
  if (!expectedTitle) return true;
  if (!candidateTitle) return false;

  const cleanExp = normalizeTitleForMatch(expectedTitle);
  const cleanCand = normalizeTitleForMatch(candidateTitle);

  if (!cleanExp) return true;
  if (!cleanCand) return false;

  if (cleanCand === cleanExp) return true;

  // Check matching without trailing season numbers
  const expNoSeason = cleanExp.replace(/\s+(?:season|sezon|\d+)$/gi, '').trim();
  const candNoSeason = cleanCand.replace(/\s+(?:season|sezon|\d+)$/gi, '').trim();
  if (expNoSeason && candNoSeason && expNoSeason === candNoSeason) {
    return true;
  }

  const expWords = cleanExp.split(/\s+/).filter(Boolean);
  const candWords = cleanCand.split(/\s+/).filter(Boolean);

  if (expWords.length === 0 || candWords.length === 0) return false;

  // For short titles (1 word or <= 5 chars), require exact normalized match
  if (cleanExp.length <= 5 || expWords.length === 1) {
    return cleanCand === cleanExp;
  }

  // Exact phrase containment with minimal word count difference
  const candSpaced = ` ${cleanCand} `;
  const expSpaced = ` ${cleanExp} `;
  if (candSpaced.includes(expSpaced) || expSpaced.includes(candSpaced)) {
    if (Math.abs(candWords.length - expWords.length) <= 2) {
      return true;
    }
  }

  // Word overlap match for multi-word titles
  if (expWords.length >= 2 && candWords.length >= 2) {
    const common = expWords.filter((w) => candWords.includes(w));
    if (
      common.length >= Math.ceil(expWords.length * 0.8) &&
      Math.abs(expWords.length - candWords.length) <= 1
    ) {
      return true;
    }
  }

  return false;
}

async function fetchTmdbPosterById(
  tmdbId: number | string,
  mediaType?: 'tv' | 'movie' | null,
  titleHint?: string | null,
  isBanner = false
): Promise<string | null> {
  const idStr = String(tmdbId).trim();
  if (!idStr || idStr === '0' || idStr === 'null') return null;
  const cacheKey = `tmdb_id_${idStr}_${mediaType || 'any'}_${isBanner ? 'banner' : 'poster'}`;
  if (titlePosterCache.has(cacheKey)) {
    return titlePosterCache.get(cacheKey) || null;
  }

  // Check the appropriate endpoint first (tv for series/anime, movie for films)
  const endpoints: Array<'tv' | 'movie'> =
    mediaType === 'movie' ? ['movie', 'tv'] : ['tv', 'movie'];

  for (const ep of endpoints) {
    try {
      // 1. Try tr-TR first, fallback to en-US / untranslated for posters/backdrops
      for (const lang of ['tr-TR', 'en-US']) {
        const url = `https://api.themoviedb.org/3/${ep}/${idStr}?api_key=${TMDB_API_KEY}&language=${lang}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const d = await res.json();
          if (d.adult === true) continue;

          if (isBanner) {
            if (d.backdrop_path) {
              const backdropUrl = `https://image.tmdb.org/t/p/w1280${d.backdrop_path}`;
              titlePosterCache.set(cacheKey, backdropUrl);
              return backdropUrl;
            }
            if (d.poster_path) {
              const posterAsBanner = `https://image.tmdb.org/t/p/w780${d.poster_path}`;
              titlePosterCache.set(cacheKey, posterAsBanner);
              return posterAsBanner;
            }
          } else {
            if (d.poster_path) {
              const posterUrl = `https://image.tmdb.org/t/p/w500${d.poster_path}`;
              titlePosterCache.set(cacheKey, posterUrl);
              return posterUrl;
            }
            if (d.backdrop_path) {
              const backdropAsPoster = `https://image.tmdb.org/t/p/w500${d.backdrop_path}`;
              titlePosterCache.set(cacheKey, backdropAsPoster);
              return backdropAsPoster;
            }
          }
        }
      }
    } catch {}
  }

  // Fallback to title search if ID didn't give images
  if (titleHint) {
    return fetchTmdbPosterForTitle(titleHint, null, mediaType);
  }

  return null;
}

async function fetchTmdbPersonById(personId: number | string): Promise<string | null> {
  const idStr = String(personId).trim();
  if (!idStr || idStr === '0' || idStr === 'null') return null;
  const cacheKey = `tmdb_person_id_${idStr}`;
  if (titlePosterCache.has(cacheKey)) {
    return titlePosterCache.get(cacheKey) || null;
  }

  try {
    const url = `https://api.themoviedb.org/3/person/${idStr}?api_key=${TMDB_API_KEY}&language=tr-TR`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const d = await res.json();
      if (d.adult === true) return null;
      if (d.profile_path) {
        const profileUrl = `https://image.tmdb.org/t/p/w500${d.profile_path}`;
        titlePosterCache.set(cacheKey, profileUrl);
        return profileUrl;
      }
    }
  } catch {}
  return null;
}

async function fetchTmdbPosterForTitle(
  rawTitle: string,
  urlHint?: string | null,
  mediaType?: 'tv' | 'movie' | null,
  year?: string | number | null,
  nativeTitle?: string | null
): Promise<string | null> {
  const cleanTitle = (rawTitle || '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(izle|turkce|altyazili|dizi|film|hd|full|\d+\.\s*sezon|\d+\.\s*bolum)\b/gi, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\s+/g, ' ')
    .trim();

  const slugHint = extractSlugFromUrl(urlHint);
  const numYear = year ? parseInt(String(year), 10) : null;

  const cacheKey = `${cleanTitle.toLowerCase()}__${(slugHint || '').toLowerCase()}__${mediaType || ''}__${numYear || ''}__${(nativeTitle || '').toLowerCase()}`;
  if (titlePosterCache.has(cacheKey)) {
    return titlePosterCache.get(cacheKey) || null;
  }

  const queries: string[] = [];
  function addQuery(q?: string | null) {
    if (!q) return;
    const parts = q.split(/[/|,;()]+/).map((s) => s.trim()).filter(Boolean);
    for (const part of (parts.length > 1 ? [q, ...parts] : [q])) {
      const trimmed = part
        .replace(/²/g, '2')
        .replace(/³/g, '3')
        .trim();
      if (trimmed.length >= 2 && !queries.includes(trimmed)) {
        queries.push(trimmed);
      }
      const ascii = transliterateTrToAscii(trimmed);
      if (ascii.length >= 2 && !queries.includes(ascii)) {
        queries.push(ascii);
      }
      const noSeason = trimmed.replace(/\s+(?:season|sezon|\d+\.?\s*(?:sezon|season)|\d+)$/gi, '').trim();
      if (noSeason && noSeason.length >= 2 && !queries.includes(noSeason)) {
        queries.push(noSeason);
        const noSeasonAscii = transliterateTrToAscii(noSeason);
        if (noSeasonAscii.length >= 2 && !queries.includes(noSeasonAscii)) {
          queries.push(noSeasonAscii);
        }
      }
    }
  }

  // High priority: search nativeTitle first if provided
  if (nativeTitle && nativeTitle.trim()) {
    addQuery(nativeTitle.trim());
  }
  if (slugHint) addQuery(slugHint);
  if (cleanTitle) {
    addQuery(cleanTitle);
    if (cleanTitle.includes(':')) {
      addQuery(cleanTitle.split(':')[0].trim());
    }
    if (cleanTitle.includes('-')) {
      addQuery(cleanTitle.replace(/-/g, ' ').replace(/\s+/g, ' ').trim());
    }
  }

  const endpoints: Array<'movie' | 'tv'> =
    mediaType === 'movie' ? ['movie', 'tv'] : mediaType === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

  for (const q of queries) {
    for (const ep of endpoints) {
      for (const langParam of ['&language=tr-TR', '']) {
        try {
          const yearParam =
            numYear && numYear > 1900
              ? ep === 'movie'
                ? `&primary_release_year=${numYear}`
                : `&first_air_date_year=${numYear}`
              : '';
          const url = `https://api.themoviedb.org/3/search/${ep}?query=${encodeURIComponent(
            q
          )}&api_key=${TMDB_API_KEY}&include_adult=false${langParam}${yearParam}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const d = await res.json();
            const results = ((d.results || []) as any[]).filter((r) => !r.adult);
            const hit = results.find((r: any) => {
              if (!r.poster_path) return false;
              // Validate release year if known
              const relDate = r.release_date || r.first_air_date || '';
              if (relDate && numYear && numYear > 1900) {
                const cYear = parseInt(relDate.slice(0, 4), 10);
                if (!isNaN(cYear) && Math.abs(cYear - numYear) > 1) {
                  return false;
                }
              }
              const title = r.title || r.name;
              const origTitle = r.original_title || r.original_name;
              const matchExpected = cleanTitle || slugHint || '';
              return (
                isTitleMatch(matchExpected, title) ||
                isTitleMatch(matchExpected, origTitle) ||
                (nativeTitle ? isTitleMatch(nativeTitle, title) || isTitleMatch(nativeTitle, origTitle) : false)
              );
            });
            if (hit?.poster_path) {
              const posterUrl = `https://image.tmdb.org/t/p/w500${hit.poster_path}`;
              titlePosterCache.set(cacheKey, posterUrl);
              return posterUrl;
            }
          }
        } catch {}
      }
    }
  }

  // AniList Fallback for anime or TV
  if (mediaType !== 'movie') {
    for (const q of queries.slice(0, 3)) {
      try {
        const gql = `
          query ($search: String) {
            Media(search: $search, type: ANIME) {
              coverImage { extraLarge large }
            }
          }
        `;
        const alResp = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: gql, variables: { search: q } }),
          signal: AbortSignal.timeout(3000),
        });
        if (alResp.ok) {
          const alJson = await alResp.json();
          const img = alJson.data?.Media?.coverImage?.extraLarge || alJson.data?.Media?.coverImage?.large;
          if (img) {
            titlePosterCache.set(cacheKey, img);
            return img;
          }
        }
      } catch {}
    }
  }

  return null;
}

async function processImageBuffer(
  rawBuf: ArrayBuffer | Buffer,
  rawContentType: string,
  sizeParam?: string | null
): Promise<{ buf: BodyInit; contentType: string }> {
  const isSvg = rawContentType === 'image/svg+xml' || rawContentType.includes('svg');
  if (isSvg || sizeParam === 'original') {
    return {
      buf: new Uint8Array(Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf)),
      contentType: rawContentType.startsWith('image/') ? rawContentType : 'image/jpeg',
    };
  }

  try {
    const inputBuf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
    const targetWidth =
      sizeParam === 'w92'
        ? 92
        : sizeParam === 'w154'
        ? 154
        : sizeParam === 'w185'
        ? 185
        : sizeParam === 'w300'
        ? 300
        : sizeParam === 'w342'
        ? 342
        : sizeParam === 'w480'
        ? 480
        : sizeParam === 'w500'
        ? 500
        : sizeParam === 'w780'
        ? 780
        : sizeParam === 'w1280'
        ? 1280
        : 500;
    const resized = await sharp(inputBuf)
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { buf: new Uint8Array(resized), contentType: 'image/webp' };
  } catch {
    return {
      buf: new Uint8Array(Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf)),
      contentType: rawContentType.startsWith('image/') ? rawContentType : 'image/jpeg',
    };
  }
}

async function fetchAndStreamImage(resolvedUrl: string, sizeParam?: string | null): Promise<NextResponse | null> {
  try {
    const posterResp = await fetch(resolvedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });

    if (posterResp.ok) {
      const rawContentType = posterResp.headers.get('content-type') || 'image/jpeg';
      const rawBuf = await posterResp.arrayBuffer();
      if (rawBuf.byteLength > 100) {
        const { buf, contentType } = await processImageBuffer(rawBuf, rawContentType, sizeParam);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=86400, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }
  } catch {}
  return null;
}

export const revalidate = 2592000; // 30 days

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('url');
    const fallbackUrl = searchParams.get('fallback');
    const titleParam = searchParams.get('title');
    const tmdbIdParam = searchParams.get('tmdbId');
    const mediaIdParam = searchParams.get('mediaId');
    const mediaTypeParam = searchParams.get('mediaType') as 'tv' | 'movie' | null;
    const typeParam = searchParams.get('type'); // 'person' | 'character' | 'media' | null
    const yearParam = searchParams.get('year') || searchParams.get('release_year');
    const nativeTitleParam = searchParams.get('nativeTitle') || searchParams.get('native_title');
    const sizeParam = searchParams.get('size') || (typeParam === 'banner' ? 'w1280' : 'w500');

    const isPerson = typeParam === 'person' || typeParam === 'character';

    const urlsToTry: string[] = [];

    if (targetUrl) {
      // Map old dead scraper actor URLs to official MyDramaList CDN
      if (targetUrl.includes('cdn.webdrama.io/actor/')) {
        const mdlUrl = targetUrl.replace(/https?:\/\/cdn\.webdrama\.io\/actor\//i, 'https://i.mydramalist.com/');
        urlsToTry.push(mdlUrl);
      }

      // If it's already an official CDN URL, stream directly
      if (targetUrl.includes('image.tmdb.org') || targetUrl.includes('s4.anilist.co') || targetUrl.includes('i.mydramalist.com')) {
        urlsToTry.push(targetUrl);
      } else if (!isScraperHost(targetUrl)) {
        // Scraper hosts block Node.js with Cloudflare/DDoS-Guard 403, immediately handled via TMDB fallback below
        const uncroppedMaster = targetUrl
          .replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp|avif)(?:\?.*)?$)/i, '')
          .replace(/[?&](?:resize|fit|w|h)=[^&]+/gi, '');
        if (uncroppedMaster !== targetUrl && uncroppedMaster.startsWith('http')) {
          urlsToTry.push(uncroppedMaster);
        }
        urlsToTry.push(targetUrl);
      }
    }

    if (
      fallbackUrl &&
      !urlsToTry.includes(fallbackUrl) &&
      (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://')) &&
      !isScraperHost(fallbackUrl)
    ) {
      urlsToTry.push(fallbackUrl);
    }

    // 1. Try fetching provided URLs directly
    for (const rawUrl of urlsToTry) {
      try {
        const parsed = new URL(rawUrl);

        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        if (parsed.port && !['80', '443'].includes(parsed.port)) continue;
        if (isBlockedIpOrHost(parsed.hostname)) continue;

        const resp = await fetch(parsed.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Referer: `${parsed.protocol}//${parsed.hostname}/`,
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(4500),
        });

        if (!resp.ok) continue;

        const contentLengthHeader = resp.headers.get('content-length');
        if (contentLengthHeader) {
          const contentLength = parseInt(contentLengthHeader, 10);
          if (contentLength > MAX_IMAGE_SIZE_BYTES) continue;
        }

        const rawContentType = (resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
        const isAllowedType = ALLOWED_CONTENT_TYPES.has(rawContentType) || rawContentType.startsWith('image/');
        if (!isAllowedType) continue;

        const rawBuf = await resp.arrayBuffer();
        if (rawBuf.byteLength < 100 || rawBuf.byteLength > MAX_IMAGE_SIZE_BYTES) continue;

        const { buf, contentType } = await processImageBuffer(rawBuf, rawContentType, sizeParam);

        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=86400, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
        };

        if (contentType === 'image/svg+xml') {
          headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
        }

        return new NextResponse(buf, {
          status: 200,
          headers,
        });
      } catch {}
    }

    // 2. High-priority TMDB ID lookup if direct URL was missing or unreachable
    if (tmdbIdParam) {
      if (isPerson) {
        const personPhoto = await fetchTmdbPersonById(tmdbIdParam);
        if (personPhoto) {
          const streamed = await fetchAndStreamImage(personPhoto, sizeParam);
          if (streamed) return streamed;
        }
      } else {
        const isBanner = typeParam === 'banner' || typeParam === 'backdrop';
        const tmdbPoster = await fetchTmdbPosterById(tmdbIdParam, mediaTypeParam, titleParam, isBanner);
        if (tmdbPoster) {
          if (!isBanner) {
            persistEnrichedCoverToSupabase(mediaIdParam, tmdbPoster, tmdbIdParam);
          }
          const streamed = await fetchAndStreamImage(tmdbPoster, sizeParam);
          if (streamed) return streamed;
        }
      }
    }

    // 3. Person / Actor branch
    if (isPerson) {
      if (tmdbIdParam) {
        const personPhoto = await fetchTmdbPersonById(tmdbIdParam);
        if (personPhoto) {
          const streamed = await fetchAndStreamImage(personPhoto, sizeParam);
          if (streamed) return streamed;
        }
      }
      if (titleParam) {
        const personPhotoUrl = await fetchTmdbPersonForTitle(titleParam);
        if (personPhotoUrl) {
          const streamed = await fetchAndStreamImage(personPhotoUrl, sizeParam);
          if (streamed) return streamed;
        }
      }
      return new NextResponse(buildPersonFallbackSvg(titleParam || 'Oyuncu'), {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // 3. Media / Title branch (with automatic Person fallback)
    if (titleParam || targetUrl) {
      const posterUrl = await fetchTmdbPosterForTitle(
        titleParam || '',
        targetUrl || fallbackUrl,
        mediaTypeParam,
        yearParam,
        nativeTitleParam
      );
      if (posterUrl) {
        persistEnrichedCoverToSupabase(mediaIdParam, posterUrl);
        const streamed = await fetchAndStreamImage(posterUrl, sizeParam);
        if (streamed) return streamed;
      }

      // If title wasn't found as a movie/tv/anime, try person search (handles actors requested without type)
      if (titleParam) {
        const personPhotoUrl = await fetchTmdbPersonForTitle(titleParam);
        if (personPhotoUrl) {
          const streamed = await fetchAndStreamImage(personPhotoUrl, sizeParam);
          if (streamed) return streamed;
        }
      }
    }

    // 3.9. Last-Resort Real Image Fallback: If TMDB search yielded nothing, try streaming targetUrl or fallbackUrl directly!
    const candidatesToFetch = [targetUrl, fallbackUrl].filter(
      (u): u is string => !!u && (u.startsWith('http://') || u.startsWith('https://'))
    );
    for (const rawUrl of candidatesToFetch) {
      if (rawUrl.includes('cdn.webdrama.io')) continue; // Skip dead domain
      try {
        const streamed = await fetchAndStreamImage(rawUrl, sizeParam);
        if (streamed) return streamed;
      } catch {}
    }

    // 4. Default Fallback
    const fallbackSvg = isPerson
      ? buildPersonFallbackSvg(titleParam || fallbackUrl)
      : buildFallbackSvg(titleParam || fallbackUrl);

    return new NextResponse(fallbackSvg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: any) {
    return new NextResponse(buildFallbackSvg(), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

