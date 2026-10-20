import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aocvcotmikzlwbaezdpl.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

const serviceRoleKey =
  typeof window === 'undefined'
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : undefined;

export const supabaseAdmin =
  typeof window === 'undefined' && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : supabase;

export interface MediaItem {
  id: number;
  slug: string;
  content_type: 'dizi' | 'film' | 'anime' | 'program' | string;
  country?: string;
  country_code: string;
  country_name: string;
  title: string;
  title_tr?: string | null;
  title_en?: string | null;
  native_title?: string | null;
  aka_titles: string[];
  overview: string;
  release_year: number;
  episode_count: number;
  duration_minutes: number;
  status_broadcast: string;
  status_translation: string;
  cover_image: string;
  poster_fallback_url?: string | null;
  backdrop_image?: string | null;
  logo_image?: string | null;
  trailer_url?: string | null;
  mydramalist_url?: string | null;
  mdl_id?: string | null;
  anilist_id?: number | null;
  anilist_url?: string | null;
  imdb_id?: string | null;
  tmdb_id?: number | null;
  source_url?: string | null;
  alt_sites: string[];
  categories: string[];
  tags: string[];
  site_rating: number;
  site_rating_count: number;
  rating?: number | null;
  mdl_rating?: number | null;
  anilist_rating?: number | null;
  imdb_rating?: number | null;
  imdb_score?: number | null;
  tmdb_score?: number | null;
  vote_average?: number | null;
  air_days: number[];
  air_time?: string | null;
  next_episode_number?: number | null;
  next_episode_at?: string | null;
  last_published_episode?: number | null;
  sources_count: number;
  episodes_available: number;
  views_count?: number;
  views_total: number;
  views_weekly: number;
  favorites_count: number;
  followers_count: number;
  is_featured: boolean;
  featured_order: number;
}

export interface PersonItem {
  id: number;
  slug: string;
  name: string;
  native_name?: string | null;
  person_type: 'actor' | 'character' | 'seiyuu' | 'director';
  country_code?: string | null;
  image_url?: string | null;
  mydramalist_url?: string | null;
  profile_url?: string | null;
  anilist_id?: number | null;
  tmdb_id?: number | null;
  bio_tr?: string | null;
  birth_date?: string | null;
  death_date?: string | null;
  gender?: string | null;
  place_of_birth?: string | null;
  also_known_as?: string[] | null;
  blood_type?: string | null;
  height?: string | null;
  favorites_count: number;
  followers_count: number;
  comments_count: number;
  drama_count: number;
  avg_rating: number;
}

export interface CastMember {
  media_id: number;
  person_id: number;
  role_type: 'lead' | 'support' | 'character' | 'seiyuu' | 'director';
  character_name?: string | null;
  voice_actor_name?: string | null;
  voice_actor_image?: string | null;
  voice_actor_slug?: string | null;
  billing_order: number;
  people?: PersonItem;
  media?: MediaItem;
}

export interface EpisodeSource {
  source_name: string;
  embed_id: string;
  direct_url: string;
  provider: string;
  site: string;
  fansub?: string | null;
  stream_type: 'hls' | 'mp4' | 'tau' | 'postmessage_iframe' | 'locked_iframe';
  quality_label?: string;
}

export interface EpisodeData {
  id: number;
  season_number: number;
  episode_number: number;
  episode_name: string;
  episode_type: string;
  status?: 'published' | 'scheduled' | 'broken' | 'pending_source';
  pending?: boolean;
  scheduled_release_at?: string | null;
  translation_note?: string | null;
  react_fire?: number;
  react_cry?: number;
  react_shock?: number;
  react_angry?: number;
  views_count?: number;
  intro_start_sec?: number | null;
  intro_end_sec?: number | null;
  sources: EpisodeSource[];
}

export interface MagazinePost {
  id: number;
  wp_post_id?: number;
  slug: string;
  title: string;
  excerpt: string;
  content_html: string;
  featured_image?: string | null;
  categories: string[];
  tags: string[];
  is_gossip?: boolean;
  author_name?: string;
  source_site?: 'AsyaMag' | 'KoreZin' | string;
  related_media_ids: number[];
  related_person_ids: number[];
  source_url?: string | null;
  likes_count: number;
  views_count?: number;
  comments_count: number;
  published_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  bio?: string | null;
  role: 'user' | 'translator' | 'editor' | 'moderator' | 'mod' | 'admin' | string;
  is_banned?: boolean;
  ban_type?: 'soft' | 'hard' | null;
  ban_reason?: string | null;
  ban_expires_at?: string | null;
  fingerprint_hash?: string | null;
  warning_count?: number;
  is_private: boolean;
  hide_watch_history: boolean;
  hide_library?: boolean;
  hide_comments?: boolean;
  notification_settings: {
    sound_enabled: boolean;
    sound_tone: 'apple_glass' | 'soft_chime' | 'minimal_pop';
    sound_volume: number;
    mute_during_fullscreen: boolean;
    notify_new_episode: boolean;
    notify_followed_actor: boolean;
    notify_comment_reply: boolean;
    notify_list_activity: boolean;
  };
  stats_episodes_watched: number;
  stats_series_completed: number;
  stats_movies_completed: number;
  stats_anime_completed: number;
  stats_total_minutes: number;
  mdl_username?: string | null;
  anilist_username?: string | null;
  anilist_auto_sync: boolean;
}

export interface EpisodeProgressEntry {
  position: number;
  duration: number;
  updated_at?: string;
}

export interface UserMediaProgress {
  user_id?: string;
  media_id: number;
  status: 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
  is_favorite: boolean;
  is_favorited?: boolean;
  user_score?: number | null;
  watched_episodes: number[];
  last_season_num: number;
  last_episode_num: number;
  last_episode_title?: string | null;
  current_season?: number;
  current_episode?: number;
  resume_position_sec: number;
  resume_duration_sec: number;
  position_seconds?: number;
  duration_seconds?: number;
  episode_positions?: Record<string, EpisodeProgressEntry>;
  updated_at: string;
  media?: MediaItem;
}

/**
 * Gets progress information for a specific episode of a media.
 * Checks episode_positions dictionary, localStorage fallback, and main media progress.
 */
export function getEpisodeProgress(
  prog: UserMediaProgress | undefined | null,
  mediaId: number,
  seasonNum: number,
  episodeNum: number
): {
  position: number;
  duration: number;
  percent: number;
  isWatched: boolean;
  remainingMinutes: number;
} {
  const isWatched = Array.isArray(prog?.watched_episodes) && prog.watched_episodes.includes(episodeNum);
  const key1 = `${seasonNum || 1}_${episodeNum}`;
  const key2 = `s${seasonNum || 1}_e${episodeNum}`;

  let pos = 0;
  let dur = (prog?.media?.duration_minutes ? prog.media.duration_minutes * 60 : 0) || prog?.resume_duration_sec || 3600;

  // 1. Check prog.episode_positions
  const epRec = prog?.episode_positions?.[key1] || prog?.episode_positions?.[key2];
  if (epRec && typeof epRec.position === 'number') {
    pos = epRec.position;
    if (epRec.duration && epRec.duration > 0) dur = epRec.duration;
  } else if (
    prog &&
    (prog.last_episode_num === episodeNum && (prog.last_season_num || 1) === (seasonNum || 1))
  ) {
    // 2. Fallback to main media resume position if this was the last active episode
    pos = prog.resume_position_sec || 0;
    dur = prog.resume_duration_sec || dur;
  }

  // 3. Fallback to localStorage standalone key
  if (pos === 0 && typeof window !== 'undefined') {
    try {
      const localVal = localStorage.getItem(`koup_ep_pos_${mediaId}_${seasonNum || 1}_${episodeNum}`);
      if (localVal) {
        const parsed = JSON.parse(localVal);
        if (typeof parsed === 'number') {
          pos = parsed;
        } else if (parsed && typeof parsed.position === 'number') {
          pos = parsed.position;
          if (parsed.duration) dur = parsed.duration;
        }
      }
    } catch {}
  }

  if (isWatched) {
    return {
      position: pos,
      duration: dur,
      percent: 100,
      isWatched: true,
      remainingMinutes: 0,
    };
  }

  const safeDur = dur > 0 ? dur : 3600;
  const rawPct = (pos / safeDur) * 100;
  const percent = pos > 10 ? Math.min(99, Math.max(5, Math.round(rawPct))) : 0;
  const remainingSec = Math.max(0, safeDur - pos);
  const remainingMinutes = Math.ceil(remainingSec / 60);

  return {
    position: pos,
    duration: safeDur,
    percent,
    isWatched: false,
    remainingMinutes,
  };
}

/**
 * Calculates the next episode number to watch based on watched_episodes.
 * For example, if episodes 1 and 2 are marked as watched ([1, 2]), returns 3.
 */
export function getNextEpisodeNumber(
  prog?: UserMediaProgress | null,
  totalEpisodes?: number | null
): number {
  if (!prog) return 1;
  const watched = Array.isArray(prog.watched_episodes) ? prog.watched_episodes : [];
  const maxWatched = watched.length > 0 ? Math.max(...watched) : 0;
  let nextEp = prog.last_episode_num || 1;

  if (watched.length > 0 && (watched.includes(nextEp) || nextEp <= maxWatched)) {
    nextEp = maxWatched + 1;
  }

  if (totalEpisodes && totalEpisodes > 0 && nextEp > totalEpisodes) {
    nextEp = totalEpisodes;
  }

  return Math.max(1, nextEp);
}

/**
 * Computes episode-based progress metrics (next episode, watched count, completion %)
 * for Continue Watching cards, Series Detail, History, and Profile pages.
 */
export function getEpisodeProgressStats(
  prog?: UserMediaProgress | null,
  media?: MediaItem | null
) {
  const watched = Array.isArray(prog?.watched_episodes) ? prog.watched_episodes : [];
  const watchedCount = watched.length;
  const isFilm =
    media?.content_type === 'film' ||
    media?.content_type === 'movie' ||
    prog?.media?.content_type === 'film' ||
    prog?.media?.content_type === 'movie';
  const totalEpisodes = isFilm ? 1 : (media?.episode_count || prog?.media?.episode_count || 0);
  const season = prog?.last_season_num || 1;
  const nextEpisode = isFilm ? 1 : getNextEpisodeNumber(prog, totalEpisodes);

  const resumePos = prog?.resume_position_sec || 0;
  const resumeDur =
    prog?.resume_duration_sec ||
    ((media?.duration_minutes || prog?.media?.duration_minutes || 0) * 60) ||
    3600;
  const hasMidMovieProgress = isFilm && resumePos > 15 && resumeDur > 0 && resumePos / resumeDur < 0.85;

  const isCompleted = hasMidMovieProgress
    ? false
    : prog?.status === 'completed' || (totalEpisodes > 0 && watchedCount >= totalEpisodes);

  let progressPercent = 0;
  if (isCompleted) {
    progressPercent = 100;
  } else if (isFilm && resumeDur > 0 && resumePos > 0) {
    progressPercent = Math.min(99, Math.max(5, Math.round((resumePos / resumeDur) * 100)));
  } else if (totalEpisodes > 0 && watchedCount > 0) {
    progressPercent = Math.min(100, Math.max(5, Math.round((watchedCount / totalEpisodes) * 100)));
  } else if (watchedCount > 0) {
    progressPercent = Math.min(95, Math.max(8, watchedCount * 8));
  } else if (nextEpisode > 1 && totalEpisodes > 0) {
    progressPercent = Math.min(95, Math.max(5, Math.round(((nextEpisode - 1) / totalEpisodes) * 100)));
  } else if (resumeDur > 0 && resumePos > 10) {
    progressPercent = Math.min(95, Math.max(6, Math.round((resumePos / resumeDur) * 100)));
  } else if (prog) {
    progressPercent = 6;
  }

  return {
    season,
    nextEpisode,
    watchedCount,
    totalEpisodes,
    progressPercent,
    isCompleted,
    isAllWatched: isCompleted,
    isFilm,
    resumePos,
    resumeDur,
  };
}


export function cleanScrapedSlug(rawSlug?: string | null): string {
  if (!rawSlug) return '';
  let s = decodeURIComponent(rawSlug).trim().toLowerCase();
  s = s
    .replace(/(?:-(?:hd-film-izle|filmi-izle|film-izle|dizi-izle|izle|full-hd|full|hdfc|hdf|hf|\d+))+$/gi, '')
    .replace(/^(?:hd-film-|hd-|film-|\d+-)+/gi, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
  return s;
}

function isLikelyUrl(val?: string | null): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:')
  );
}

export function getProxiedImageUrl(
  url?: string | null,
  fallbackOrTitle?: string | null,
  titleHint?: string | null,
  tmdbSize: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500',
  type?: 'media' | 'person' | 'character' | 'banner' | 'poster',
  tmdbId?: number | string | null,
  mediaType?: 'tv' | 'movie' | null,
  year?: number | string | null,
  nativeTitle?: string | null
): string {
  const isFallbackUrl = isLikelyUrl(fallbackOrTitle);
  const resolvedTitle = titleHint || (!isFallbackUrl ? fallbackOrTitle : null);
  const typeQuery = type ? `&type=${type}` : '';
  const mtQuery = mediaType ? `&mediaType=${mediaType}` : '';
  const yrQuery = year ? `&year=${encodeURIComponent(String(year))}` : '';
  const ntQuery = nativeTitle ? `&nativeTitle=${encodeURIComponent(nativeTitle.trim())}` : '';

  if (!url || !url.trim() || url === '/logo-dark.png') {
    if (isFallbackUrl && fallbackOrTitle) {
      return getProxiedImageUrl(fallbackOrTitle, null, resolvedTitle, tmdbSize, type, tmdbId, mediaType, year, nativeTitle);
    }
    if (tmdbId) {
      return `/api/image-proxy?tmdbId=${encodeURIComponent(String(tmdbId))}${typeQuery}${mtQuery}${yrQuery}${ntQuery}`;
    }
    if (resolvedTitle && resolvedTitle.trim()) {
      return `/api/image-proxy?title=${encodeURIComponent(resolvedTitle.trim())}${typeQuery}${mtQuery}${yrQuery}${ntQuery}`;
    }
    return type === 'person' ? '/logo-dark.png' : '/logo-dark.png';
  }

  if (url.startsWith('/') || url.startsWith('data:')) return url;

  // TMDB resolution: ensure correct size is requested without huge downloads, optimized for mobile
  if (url.includes('image.tmdb.org')) {
    const isMobileClient = typeof window !== 'undefined' && window.innerWidth > 0 && window.innerWidth < 768;
    let effectiveSize = tmdbSize;

    if (type === 'person') {
      effectiveSize = tmdbSize === 'w500' ? 'w185' : tmdbSize;
    } else if (isMobileClient) {
      // Mobile screens never need > 720p (w780 is TMDB's 720p tier, w342 for posters)
      if (effectiveSize === 'original' || effectiveSize === 'w1280') {
        effectiveSize = 'w780';
      } else if (type === 'poster' && (effectiveSize === 'w500' || effectiveSize === 'w780')) {
        effectiveSize = 'w342';
      }
    } else {
      if (effectiveSize === 'original') {
        effectiveSize = 'w1280';
      }
    }

    return url.replace(
      /\/t\/p\/(original|w1280|w780|w500|w342|w185|w154|w92|h632)\//,
      `/t/p/${effectiveSize}/`
    );
  }

  // Google OAuth Avatars: normalize size to ~192px so high-res avatars don't suffer from downscaling aliasing
  if (url.includes('lh3.googleusercontent.com')) {
    if (url.includes('=s')) {
      return url.replace(/=s\d+(-c)?/, '=s192-c');
    }
    return `${url}=s192-c`;
  }

  if (url.includes('s4.anilist.co')) {
    return url;
  }

  const params = new URLSearchParams({ url });
  if (isFallbackUrl && fallbackOrTitle) {
    params.set('fallback', fallbackOrTitle);
  }
  if (resolvedTitle && resolvedTitle.trim()) {
    params.set('title', resolvedTitle.trim());
  }
  if (type) {
    params.set('type', type);
  }
  if (tmdbId) {
    params.set('tmdbId', String(tmdbId));
  }
  if (mediaType) {
    params.set('mediaType', mediaType);
  }
  if (year) {
    params.set('year', String(year));
  }
  if (nativeTitle && nativeTitle.trim()) {
    params.set('nativeTitle', nativeTitle.trim());
  }
  return `/api/image-proxy?${params.toString()}`;
}

export const COUNTRY_LABELS: Record<string, string> = {
  KR: 'GÜNEY KORE',
  CN: 'ÇİN',
  JP: 'JAPONYA',
  TH: 'TAYLAND',
  TW: 'TAYVAN',
  HK: 'HONG KONG',
  PH: 'FİLİPİNLER',
  ID: 'ENDONEZYA',
  MY: 'MALEZYA',
  SG: 'SİNGAPUR',
  VN: 'VİETNAM',
  IN: 'HİNDİSTAN',
  PK: 'PAKİSTAN',
  IR: 'İRAN',
  US: 'ABD',
  GB: 'İNGİLTERE',
  TR: 'TÜRKİYE',
  PL: 'POLONYA',
  FR: 'FRANSA',
  DE: 'ALMANYA',
  ES: 'İSPANYA',
  IT: 'İTALYA',
  RU: 'RUSYA',
  CA: 'KANADA',
  AU: 'AVUSTRALYA',
  BR: 'BREZİLYA',
  MX: 'MEKSİKA',
  AR: 'ARJANTİN',
  BE: 'BELÇİKA',
  NL: 'HOLLANDA',
  SE: 'İSVEÇ',
  NO: 'NORVEÇ',
  DK: 'DANİMARKA',
  FI: 'FİNLANDİYA',
  AT: 'AVUSTURYA',
  CH: 'İSVİÇRE',
  IE: 'İRLANDA',
  PT: 'PORTEKİZ',
  GR: 'YUNANİSTAN',
  CZ: 'ÇEKYA',
  HU: 'MACARİSTAN',
  RO: 'ROMANYA',
  UA: 'UKRAYNA',
  ZA: 'GÜNEY AFRİKA',
  EG: 'MISIR',
  NZ: 'YENİ ZELANDA',
  CO: 'KOLOMBİYA',
  CL: 'ŞİLİ',
  GL: 'GLOBAL',
};

export const COUNTRY_FLAG_EMOJIS: Record<string, string> = Object.keys(COUNTRY_LABELS).reduce(
  (acc, code) => {
    acc[code] = code;
    return acc;
  },
  {} as Record<string, string>
);

export function getCountryFlag(countryCodeOrName?: string | null): string {
  if (!countryCodeOrName) return 'GL';
  const c = countryCodeOrName.toUpperCase().trim();
  if (COUNTRY_FLAG_EMOJIS[c]) return COUNTRY_FLAG_EMOJIS[c];
  if (c.includes('KOR')) return 'KR';
  if (c.includes('ÇIN') || c.includes('CIN') || c.includes('CHINA')) return 'CN';
  if (c.includes('JAP')) return 'JP';
  if (c.includes('THAI') || c.includes('TAYL')) return 'TH';
  if (c.includes('TAIW') || c.includes('TAYV')) return 'TW';
  if (c.includes('POLON') || c.includes('POLAND')) return 'PL';
  if (c.includes('FRANS') || c.includes('FRANCE')) return 'FR';
  if (c.includes('ALMAN') || c.includes('GERMAN')) return 'DE';
  if (c.includes('ISPAN') || c.includes('İSPAN') || c.includes('SPAIN')) return 'ES';
  if (c.includes('ITAL') || c.includes('İTAL')) return 'IT';
  if (c.includes('HIND') || c.includes('HİND') || c.includes('INDIA')) return 'IN';
  if (c.includes('IRAN') || c.includes('İRAN')) return 'IR';
  if (c.includes('RUS')) return 'RU';
  if (c.includes('KANAD') || c.includes('CANAD')) return 'CA';
  if (c.includes('BREZ') || c.includes('BRAZ')) return 'BR';
  if (c.includes('AVUSTRAL') || c.includes('AUSTRAL')) return 'AU';
  if (c.includes('MEKS') || c.includes('MEX')) return 'MX';
  if (c.includes('ARJAN') || c.includes('ARGEN')) return 'AR';
  if (c.includes('BELÇ') || c.includes('BELC') || c.includes('BELG')) return 'BE';
  if (c.includes('HOLLAND') || c.includes('NETHER')) return 'NL';
  if (c.includes('İSVEÇ') || c.includes('ISVEC') || c.includes('SWED')) return 'SE';
  if (c.includes('NORV')) return 'NO';
  if (c.includes('DANİM') || c.includes('DANIM') || c.includes('DENM')) return 'DK';
  if (c.includes('ABD') || c.includes('USA') || c.includes('AMERICA') || c.includes('UNITED STATES')) return 'US';
  if (c.includes('TURK') || c.includes('TÜRK')) return 'TR';
  if (c.includes('UK') || c.includes('BRIT') || c.includes('INGIL') || c.includes('İNGİL') || c.includes('BİRLEŞİK KRALLIK')) return 'GB';
  if (c.includes('PHILIP') || c.includes('FILIP') || c.includes('FİLİP')) return 'PH';
  if (c.includes('HONG')) return 'HK';
  if (c.includes('ENDON') || c.includes('INDON')) return 'ID';
  return /^[A-Z]{2}$/.test(c) ? c : 'GL';
}

export const COUNTRY_FLAGS: Record<string, string> = COUNTRY_FLAG_EMOJIS;

export function formatContentTypeTR(contentType?: string | null, country?: string | null): string {
  const c = (country || '').toUpperCase();
  const t = (contentType || 'dizi').toLowerCase();
  if (t === 'anime') return 'ANİME';
  if (t === 'film' || t === 'movie') return 'FİLM';
  if (t === 'program') return 'PROGRAM';
  if (c === 'KR') return 'K-DRAMA';
  if (c === 'CN') return 'C-DRAMA';
  if (c === 'JP') return 'J-DRAMA';
  if (c === 'TH') return 'THAI DRAMA';
  return 'DİZİ';
}

/**
 * Sanitizes scraped overview text across all series and pages:
 * - Converts <br>, <br/>, <br />, </p>, </div> into natural newlines
 * - Strips any remaining HTML tags (<p>, <span>, <b>, <i>, etc.)
 * - Unescapes HTML entities (&nbsp;, &amp;, &quot;, &#39;, &lt;, &gt;, &mdash;, etc.)
 * - Normalizes whitespace, trimming each line, and collapsing 3+ newlines into 2
 */
export function cleanOverviewText(raw?: string | null): string {
  if (!raw) return '';
  let text = sanitizeMojibake(String(raw));

  // Replace break tags and paragraph/div closing tags with newlines
  text = text.replace(/<(?:br\s*\/?>|\/(?:p|div)>)/gi, '\n');

  // Strip any remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode standard HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return '';
      }
    });

  // Normalize lines: trim each line, collapse excessive consecutive blank lines
  const lines = text.split('\n').map((l) => l.trim());
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Re-export cache layer utilities for direct import from supabase.ts
export { cachedQuery, invalidateCache, setCache, getCache, resolveQueryTTL } from '@/lib/cache';

/**
 * Sanitizes mojibake caused by UTF-8 bytes being mistakenly decoded as Windows-1254 or Latin-1
 */
export function sanitizeMojibake(text?: string | null): string {
  if (!text) return '';
  let s = String(text);

  if (/[\u00C3\u00C4\u00C5\uFFFD]/.test(s)) {
    s = s
      .replace(/\u00C3\u2021/g, 'Ç')
      .replace(/\u00C3\u2013/g, 'Ö')
      .replace(/\u00C3\u0153/g, 'Ü')
      .replace(/\u00C3\u009C/g, 'Ü')
      .replace(/\u00C3\u00A7/g, 'ç')
      .replace(/\u00C3\u00B6/g, 'ö')
      .replace(/\u00C3\u00BC/g, 'ü')
      .replace(/\u00C3\u00A2/g, 'â')
      .replace(/\u00C3\u00AE/g, 'î')
      .replace(/\u00C3\u00A9/g, 'é')
      .replace(/\u00C4\u00B0/g, 'İ')
      .replace(/\u00C4\u00B1/g, 'ı')
      .replace(/\u00C4\u017E/g, 'Ğ')
      .replace(/\u00C4\u017D/g, 'Ğ')
      .replace(/\u00C4\u0178/g, 'ğ')
      .replace(/\u00C4\u011F/g, 'ğ')
      .replace(/\u00C5\u017E/g, 'Ş')
      .replace(/\u00C5\u017D/g, 'Ş')
      .replace(/\u00C5\u0178/g, 'ş')
      .replace(/\u00C5\uFFFD/g, 'ş')
      .replace(/\u00C2/g, '')
      .replace(/\u00C5/g, 'Ş');
  }

  s = s
    .replace(/Ã§/g, 'ç')
    .replace(/Ã‡/g, 'Ç')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã–/g, 'Ö')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ãœ/g, 'Ü')
    .replace(/Ä±/g, 'ı')
    .replace(/Ä°/g, 'İ')
    .replace(/ÄŸ/g, 'ğ')
    .replace(/Äž/g, 'Ğ')
    .replace(/ÅŸ/g, 'ş')
    .replace(/Åž/g, 'Ş');

  return s;
}

/**
 * Sanitizes polluted scraped media titles (e.g. "Örümcek Adam: Eve Dönüş Yok izleSpider" -> "Örümcek Adam: Eve Dönüş Yok")
 * - Fixes corrupted mojibake character sequences
 * - Strips scraper artifacts like "izleSpider", "izle", "filmi izle", "dizi izle"
 * - Removes glued English subtitles merged into Turkish titles (e.g. "Title izleTitle (2025)")
 * - Normalizes colon spacing and extra whitespace
 */
export function cleanMediaTitle(rawTitle?: string | null): string {
  if (!rawTitle) return '';
  let t = sanitizeMojibake(String(rawTitle)).trim();

  // Pattern 1: Title with glued "izleSpider" e.g. "Örümcek Adam: Eve Dönüş Yok izleSpider"
  t = t.replace(/\s*izle\s*[A-Za-z0-9\s]*Spider\b/i, '');

  // Pattern 2: Title with "izleNative (Year)" or "izle<English Title>"
  t = t.replace(/\s*izle\s*[A-Za-z0-9\s:,'-]+\(\d{4}\)\s*$/i, '');
  t = t.replace(/\s+izle\s+[A-Z][a-zA-Z0-9\s:,'-]{3,}$/, '');

  // Pattern 3: Trailing izle / dublaj / altyazılı / tek parça / 1080p suffixes
  t = t.replace(/\s+(?:izle\s*(?:hd\d*|full\s*hd)?|film\s+izle|dizi\s+izle|türkçe\s+dublajlı?|türkçe\s+altyazılı?|tek\s+parça|1080p|full\s*hd)\s*$/i, '');

  // Pattern 4: Any standalone trailing "izle"
  t = t.replace(/\s+izle$/i, '');

  // Specific scraper typo fixes
  t = t.replace(/Asla Vazgeçmemm\b/g, 'Asla Vazgeçmem');

  // Clean trailing punctuation or weird hyphens
  t = t.replace(/[\s–-]+$/, '').trim();

  return t;
}

/**
 * Sanitizes raw quality strings (e.g. "Auto (1080p HLS)", "AUTO 1080P HLS", "1080p Direct") -> "1080p"
 */
export function cleanQualityLabel(raw?: string | null): string {
  if (!raw) return '1080p';
  const clean = String(raw).trim();
  if (/otomatik|auto/i.test(clean)) return 'Otomatik';
  if (/seviye/i.test(clean)) return '1080p';
  if (/2160p|4k/i.test(clean)) return '4K';
  if (/1080p?/i.test(clean)) return '1080p';
  if (/720p?/i.test(clean)) return '720p';
  if (/480p?/i.test(clean)) return '480p';
  if (/360p?/i.test(clean)) return '360p';
  const stripped = clean
    .replace(/\b(HLS|DIRECT|HD|FHD|DASH)\b/gi, '')
    .replace(/[()[\]{}]/g, '')
    .trim();
  return stripped || '1080p';
}

/**
 * Sanitizes polluted scraped episode names (e.g. '1. Sezon 2. Bölüm(Tremor)1 Ocak 2020' -> 'Tremor')
 * - Strips Turkish & English dates (e.g. '1 Ocak 2020', '15 Mart 2021')
 * - Strips redundant 'X. Sezon', 'Y. Bölüm', 'Season X Episode Y', 'S1:B2' prefixes
 * - Cleans collapsed parentheses around episode subtitles e.g. '(Tremor)' -> 'Tremor'
 * - Removes surrounding quotes and redundant punctuation
 */
export function cleanEpisodeName(
  rawName?: string | null,
  seasonNum?: number,
  episodeNum?: number
): string {
  if (!rawName) return episodeNum ? `${episodeNum}. Bölüm` : '';
  let s = sanitizeMojibake(String(rawName)).trim();

  // Strip dates e.g. "1 Ocak 2020", "15 Mart 2021", "January 1, 2020"
  s = s.replace(
    /\s*\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi,
    ''
  );
  s = s.replace(/\s*\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '');
  s = s.replace(/\s*\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/g, '');

  // Strip quotes and edge symbols
  s = s.replace(/^["'“”«»`]+|["'“”«»`]+$/g, '').trim();

  // Strip redundant leading season/episode prefix, e.g. "1. Sezon 2. Bölüm", "1.Sezon 2.Bölüm", "2. Bölüm", "S1:B2"
  s = s.replace(/^(?:\d+\s*\.?\s*Sezon\s*)?(?:\d+\s*\.?\s*Bölüm\s*)/i, '').trim();
  s = s.replace(/^(?:Season\s*\d+\s*)?(?:Episode\s*\d+\s*)/i, '').trim();
  s = s.replace(/^S\d+[:\s]*B\d+\s*[-:•]?\s*/i, '').trim();
  s = s.replace(/^Bölüm\s*\d+\s*[-:•]?\s*/i, '').trim();

  // Strip leading punctuation
  s = s.replace(/^[-:•|~–—\s]+/, '').trim();

  // Handle collapsed parentheses like "(Tremor)" or "(Part 1)"
  const parenMatch = s.match(/^\(([^)]+)\)$/);
  if (parenMatch) {
    s = parenMatch[1].trim();
  }

  // Strip trailing punctuation
  s = s.replace(/[-:•|~–—\s]+$/, '').trim();
  s = s.replace(/^["'“”«»`]+|["'“”«»`]+$/g, '').trim();

  // If the extracted subtitle is empty, generic, or just repeats the episode number
  if (
    !s ||
    /^(?:bölüm|episode|part)\s*\d*$/i.test(s) ||
    s === `${episodeNum}` ||
    s === `${episodeNum}. Bölüm`
  ) {
    return episodeNum ? `${episodeNum}. Bölüm` : '';
  }

  return s;
}

/**
 * Formats a clean episode display title (e.g. "S1:B2 • Tremor" or "2. Bölüm • Tremor" or "2. Bölüm")
 */
export function formatEpisodeTitle(
  rawName?: string | null,
  seasonNum: number = 1,
  episodeNum: number = 1,
  options?: { includeSeasonPrefix?: boolean; includeEpisodeNum?: boolean }
): string {
  const subtitle = cleanEpisodeName(rawName, seasonNum, episodeNum);
  const isGeneric = !subtitle || subtitle === `${episodeNum}. Bölüm`;

  if (options?.includeSeasonPrefix) {
    const prefix = `S${seasonNum}:B${episodeNum}`;
    if (isGeneric) {
      return `${prefix} • ${episodeNum}. Bölüm`;
    }
    return `${prefix} • ${subtitle}`;
  }

  if (options?.includeEpisodeNum !== false) {
    if (isGeneric) {
      return `${episodeNum}. Bölüm`;
    }
    return `${episodeNum}. Bölüm • ${subtitle}`;
  }

  return isGeneric ? `${episodeNum}. Bölüm` : subtitle;
}

/**
 * Formats view counts compactly (e.g. 0 -> "0", 420 -> "420", 1250 -> "1.2K", 3000 -> "3K", 1200000 -> "1.2M")
 */
export function formatViewCount(count?: number | null): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}K`;
  }
  const m = n / 1_000_000;
  return `${m >= 10 ? Math.round(m) : Number(m.toFixed(1))}M`;
}


