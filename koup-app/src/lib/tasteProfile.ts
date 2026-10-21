'use client';

import { MediaItem, UserMediaProgress, COUNTRY_LABELS } from '@/lib/supabase';

export interface CookieConsentState {
  decided: boolean;
  necessary: boolean;
  personalization: boolean;
  performance: boolean;
  updatedAt: number;
}

export interface UserTasteProfile {
  genres: Record<string, number>;
  countries: Record<string, number>;
  types: Record<string, number>;
  tags: Record<string, number>;
  viewedIds: number[];
  watchedIds: number[];
  updatedAt: number;
}

const CONSENT_KEY = 'koup_cookie_consent_v1';
const TASTE_KEY = 'koup_taste_profile_v1';
const CONSENT_EVENT = 'koup:consent-updated';
const TASTE_EVENT = 'koup:taste-updated';

const DEFAULT_CONSENT: CookieConsentState = {
  decided: false,
  necessary: true,
  personalization: true,
  performance: true,
  updatedAt: 0,
};

const EMPTY_TASTE: UserTasteProfile = {
  genres: {},
  countries: {},
  types: {},
  tags: {},
  viewedIds: [],
  watchedIds: [],
  updatedAt: 0,
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function setBrowserCookie(name: string, value: string, days = 365) {
  if (!isBrowser()) return;
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch {
    // Ignore cookie write errors
  }
}

function getBrowserCookie(name: string): string | null {
  if (!isBrowser()) return null;
  try {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsentState {
  if (!isBrowser()) return DEFAULT_CONSENT;
  try {
    const raw =
      window.localStorage.getItem(CONSENT_KEY) || getBrowserCookie(CONSENT_KEY);
    if (!raw) return DEFAULT_CONSENT;
    const parsed = JSON.parse(raw);
    return {
      decided: Boolean(parsed.decided),
      necessary: true,
      personalization: parsed.personalization !== false,
      performance: parsed.performance !== false,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return DEFAULT_CONSENT;
  }
}

export function saveCookieConsent(
  partial: Partial<Omit<CookieConsentState, 'necessary' | 'decided'>>
): CookieConsentState {
  const current = getCookieConsent();
  const next: CookieConsentState = {
    decided: true,
    necessary: true,
    personalization:
      partial.personalization !== undefined
        ? partial.personalization
        : current.personalization,
    performance:
      partial.performance !== undefined ? partial.performance : current.performance,
    updatedAt: Date.now(),
  };

  if (isBrowser()) {
    try {
      const serialized = JSON.stringify(next);
      window.localStorage.setItem(CONSENT_KEY, serialized);
      setBrowserCookie(CONSENT_KEY, serialized, 365);
      if (!next.personalization) {
        window.localStorage.removeItem(TASTE_KEY);
      }
      window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: next }));
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}

export function openCookiePreferencesModal() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent('koup:open-cookie-modal'));
}

export function getTasteProfile(): UserTasteProfile {
  if (!isBrowser()) return EMPTY_TASTE;
  const consent = getCookieConsent();
  if (consent.decided && !consent.personalization) {
    return EMPTY_TASTE;
  }
  try {
    const raw = window.localStorage.getItem(TASTE_KEY);
    if (!raw) return EMPTY_TASTE;
    const parsed = JSON.parse(raw);
    return {
      genres: parsed.genres || {},
      countries: parsed.countries || {},
      types: parsed.types || {},
      tags: parsed.tags || {},
      viewedIds: Array.isArray(parsed.viewedIds) ? parsed.viewedIds : [],
      watchedIds: Array.isArray(parsed.watchedIds) ? parsed.watchedIds : [],
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return EMPTY_TASTE;
  }
}

function saveTasteProfile(profile: UserTasteProfile) {
  if (!isBrowser()) return;
  try {
    profile.updatedAt = Date.now();
    window.localStorage.setItem(TASTE_KEY, JSON.stringify(profile));
    // Also store a compact summary cookie (top 3 genres + top 2 countries) for lightweight inspection
    const topGenres = Object.entries(profile.genres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    const topCountries = Object.entries(profile.countries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([k]) => k);
    setBrowserCookie(
      'koup_taste_dna',
      JSON.stringify({ g: topGenres, c: topCountries }),
      180
    );
    window.dispatchEvent(new CustomEvent(TASTE_EVENT, { detail: profile }));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Records a user interaction signal to enrich their Taste DNA profile.
 * Signal weights:
 * - 'hover': +1 (user expanded card to inspect)
 * - 'view': +3 (user opened series detail page)
 * - 'watch': +6 (user started watching an episode)
 * - 'favorite': +10 (user favorited or added to library)
 */
export function recordTasteSignal(
  media: MediaItem | null | undefined,
  signal: 'hover' | 'view' | 'watch' | 'favorite'
) {
  if (!isBrowser() || !media || !media.id) return;
  const consent = getCookieConsent();
  if (consent.decided && !consent.personalization) return;

  const weightMap = {
    hover: 1,
    view: 3,
    watch: 6,
    favorite: 10,
  };
  const weight = weightMap[signal] || 1;
  const profile = getTasteProfile();

  // Avoid spamming weight if user repeatedly hovers the exact same card
  if (signal === 'hover' && profile.viewedIds.slice(0, 8).includes(media.id)) {
    return;
  }

  // 1. Country affinity
  const country = (media.country_code || media.country || '').toUpperCase().trim();
  if (country && country !== 'GL') {
    profile.countries[country] = (profile.countries[country] || 0) + weight;
  }

  // 2. Content Type affinity
  const cType = (media.content_type || 'dizi').toLowerCase().trim();
  if (cType) {
    profile.types[cType] = (profile.types[cType] || 0) + weight;
  }

  // 3. Genre / Category affinity
  if (Array.isArray(media.categories)) {
    for (const rawCat of media.categories.slice(0, 5)) {
      const cat = String(rawCat || '').trim();
      if (cat && cat.length > 1) {
        profile.genres[cat] = (profile.genres[cat] || 0) + weight;
      }
    }
  }

  // 4. Tag affinity
  if (Array.isArray(media.tags)) {
    for (const rawTag of media.tags.slice(0, 5)) {
      const tag = String(rawTag || '').trim();
      if (tag && tag.length > 1) {
        profile.tags[tag] = (profile.tags[tag] || 0) + Math.max(1, Math.floor(weight / 2));
      }
    }
  }

  // 5. Recent IDs tracking (bounded to 60)
  profile.viewedIds = [
    media.id,
    ...profile.viewedIds.filter((id) => id !== media.id),
  ].slice(0, 60);

  if (signal === 'watch' || signal === 'favorite') {
    profile.watchedIds = [
      media.id,
      ...profile.watchedIds.filter((id) => id !== media.id),
    ].slice(0, 60);
  }

  saveTasteProfile(profile);
}

/**
 * Syncs logged-in user's watch progressMap into the Taste Profile so existing library items
 * immediately shape recommendations even on first cookie consent.
 */
export function syncProgressToTasteProfile(
  progressMap: Record<number, UserMediaProgress>,
  catalogPool: MediaItem[]
) {
  if (!isBrowser() || !progressMap) return;
  const consent = getCookieConsent();
  if (consent.decided && !consent.personalization) return;

  const entries = Object.values(progressMap);
  if (entries.length === 0) return;

  const poolMap = new Map<number, MediaItem>();
  for (const m of catalogPool) {
    if (m?.id) poolMap.set(m.id, m);
  }

  let updated = false;
  const profile = getTasteProfile();

  for (const prog of entries) {
    const item = prog.media || poolMap.get(prog.media_id);
    if (!item || !item.id) continue;
    if (profile.watchedIds.includes(item.id)) continue;

    const w = prog.is_favorite || prog.is_favorited ? 8 : prog.status === 'watching' ? 5 : 3;
    const country = (item.country_code || item.country || '').toUpperCase().trim();
    if (country && country !== 'GL') {
      profile.countries[country] = (profile.countries[country] || 0) + w;
    }
    const cType = (item.content_type || 'dizi').toLowerCase().trim();
    if (cType) {
      profile.types[cType] = (profile.types[cType] || 0) + w;
    }
    if (Array.isArray(item.categories)) {
      for (const cat of item.categories.slice(0, 4)) {
        if (cat) profile.genres[cat] = (profile.genres[cat] || 0) + w;
      }
    }
    profile.watchedIds.push(item.id);
    updated = true;
  }

  if (updated) {
    profile.watchedIds = profile.watchedIds.slice(0, 80);
    saveTasteProfile(profile);
  }
}

/**
 * Returns human-readable summary of the user's Taste DNA for UI badges & subtitles.
 */
export function getTasteSummary(profile = getTasteProfile()): {
  hasTaste: boolean;
  topGenres: string[];
  topCountries: string[];
  topType: string | null;
  subtitleText: string;
} {
  const topGenres = Object.entries(profile.genres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  const topCountries = Object.entries(profile.countries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c);

  const topType =
    Object.entries(profile.types).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const hasTaste = topGenres.length > 0 || topCountries.length > 0;

  if (!hasTaste) {
    return {
      hasTaste: false,
      topGenres: [],
      topCountries: [],
      topType: null,
      subtitleText: 'Kişisel Zevk Analizi',
    };
  }

  const countryNames = topCountries
    .map((c) => COUNTRY_LABELS[c] || c)
    .join(' & ');
  const genreNames = topGenres.slice(0, 2).join(', ');

  const parts = [countryNames, genreNames].filter(Boolean);
  return {
    hasTaste: true,
    topGenres,
    topCountries,
    topType,
    subtitleText:
      parts.length > 0
        ? `${parts.join(' • ')} Tercihlerine Göre`
        : 'İzleme Geçmişine Göre Seçildi',
  };
}

/**
 * Multi-Signal Similarity Scorer for "Benzer Yapımlar & Önerilenler" on Series Detail Page.
 * Evaluates:
 * 1. Genre / Category intersection (+30 per shared genre, +15 bonus for primary genre match)
 * 2. Exact Country match (+35 for same country_code: KR->KR, CN->CN, JP->JP, TH->TH)
 * 3. Content Type match (+25 for dizi->dizi, anime->anime, film->film)
 * 4. Tag & Keyword overlap (+12 per shared tag)
 * 5. User's Personal Taste DNA affinity (+up to 20 pts)
 * 6. Quality Rating tie-breaker (MDL / IMDb / AniList score)
 */
export function rankRelatedMedia(
  source: MediaItem,
  candidates: MediaItem[],
  limit = 12
): MediaItem[] {
  if (!source || !Array.isArray(candidates) || candidates.length === 0) return [];

  const srcCountry = (source.country_code || source.country || '').toUpperCase().trim();
  const srcType = (source.content_type || 'dizi').toLowerCase().trim();
  const srcCats = new Set(
    (Array.isArray(source.categories) ? source.categories : []).map((c) =>
      String(c).toLowerCase().trim()
    )
  );
  const primaryCat = Array.isArray(source.categories) && source.categories[0]
    ? String(source.categories[0]).toLowerCase().trim()
    : null;
  const srcTags = new Set(
    (Array.isArray(source.tags) ? source.tags : []).map((t) =>
      String(t).toLowerCase().trim()
    )
  );

  const taste = getTasteProfile();
  const maxGenreWeight = Math.max(1, ...Object.values(taste.genres), 1);

  const scored = candidates
    .filter((c) => c && c.id !== source.id && c.slug !== source.slug)
    .map((cand) => {
      let score = 0;

      const candCountry = (cand.country_code || cand.country || '').toUpperCase().trim();
      const candType = (cand.content_type || 'dizi').toLowerCase().trim();

      // 1. Same Content Type (+25)
      if (candType === srcType) {
        score += 25;
      } else {
        score -= 15;
      }

      // 2. Same Country (+35)
      if (srcCountry && candCountry === srcCountry) {
        score += 35;
      }

      // 3. Genre / Category Overlap (+30 per match, +15 primary match)
      const candCats = Array.isArray(cand.categories) ? cand.categories : [];
      let matchedGenreCount = 0;
      for (const rawCat of candCats) {
        const norm = String(rawCat).toLowerCase().trim();
        if (srcCats.has(norm)) {
          matchedGenreCount++;
          score += 30;
          if (primaryCat && norm === primaryCat) {
            score += 15;
          }
        }
        // Personal taste bonus for this genre
        if (taste.genres[rawCat]) {
          score += Math.round((taste.genres[rawCat] / maxGenreWeight) * 8);
        }
      }

      // Penalty if source had categories and candidate matched 0 of them
      if (srcCats.size > 0 && matchedGenreCount === 0) {
        score -= 25;
      }

      // 4. Shared Tags (+12 per match)
      if (srcTags.size > 0 && Array.isArray(cand.tags)) {
        for (const t of cand.tags) {
          if (srcTags.has(String(t).toLowerCase().trim())) {
            score += 12;
          }
        }
      }

      // 5. Release Year proximity (+8 if within 3 years)
      if (source.release_year && cand.release_year) {
        const diff = Math.abs(source.release_year - cand.release_year);
        if (diff <= 2) score += 8;
        else if (diff <= 5) score += 4;
      }

      // 6. Rating Quality Tie-Breaker (0 to 15 pts)
      const bestRating =
        cand.mdl_rating ||
        cand.imdb_rating ||
        (cand.anilist_rating ? cand.anilist_rating / 10 : 0) ||
        cand.rating ||
        7.5;
      score += Math.min(15, Math.max(0, Number(bestRating) * 1.5));

      return { cand, score };
    });

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by ID
  const seen = new Set<number>();
  const result: MediaItem[] = [];
  for (const { cand } of scored) {
    if (!seen.has(cand.id)) {
      seen.add(cand.id);
      result.push(cand);
      if (result.length >= limit) break;
    }
  }

  return result;
}

/**
 * Generates a personalized list of MediaItems for the Homepage "Sana Özel Seçki" row
 * based on the user's Cookie Taste DNA and watch history.
 */
export function buildPersonalizedFeed(
  pool: MediaItem[],
  progressMap: Record<number, UserMediaProgress> = {},
  limit = 60
): MediaItem[] {
  const taste = getTasteProfile();
  const summary = getTasteSummary(taste);
  if (!summary.hasTaste || !Array.isArray(pool) || pool.length === 0) {
    if (!Array.isArray(pool) || pool.length === 0) return [];
    const seen = new Set<number>();
    return pool
      .filter((m) => {
        if (!m || !m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        const s = progressMap[m.id]?.status;
        return s !== 'completed' && s !== 'dropped';
      })
      .sort((a, b) => {
        const rA = Number(a.mdl_rating || a.imdb_rating || a.rating || 0);
        const rB = Number(b.mdl_rating || b.imdb_rating || b.rating || 0);
        return rB - rA;
      })
      .slice(0, limit);
  }

  const maxGenre = Math.max(1, ...Object.values(taste.genres), 1);
  const maxCountry = Math.max(1, ...Object.values(taste.countries), 1);
  const maxType = Math.max(1, ...Object.values(taste.types), 1);

  const seenIds = new Set<number>();
  const scored: Array<{ item: MediaItem; score: number }> = [];

  for (const item of pool) {
    if (!item || !item.id || seenIds.has(item.id)) continue;
    seenIds.add(item.id);

    // Skip already completed or dropped shows in "Sana Özel Yeni Keşifler"
    const userStatus = progressMap[item.id]?.status;
    if (userStatus === 'completed' || userStatus === 'dropped') continue;

    let score = 0;

    // Country score (up to 40 pts)
    const country = (item.country_code || item.country || '').toUpperCase().trim();
    if (country && taste.countries[country]) {
      score += (taste.countries[country] / maxCountry) * 40;
    }

    // Content Type score (up to 25 pts)
    const cType = (item.content_type || 'dizi').toLowerCase().trim();
    if (cType && taste.types[cType]) {
      score += (taste.types[cType] / maxType) * 25;
    }

    // Genre score (up to 55 pts)
    if (Array.isArray(item.categories)) {
      for (const cat of item.categories) {
        if (taste.genres[cat]) {
          score += (taste.genres[cat] / maxGenre) * 22;
        }
      }
    }

    // Slight boost for high ratings
    const bestRating =
      item.mdl_rating ||
      item.imdb_rating ||
      (item.anilist_rating ? item.anilist_rating / 10 : 0) ||
      item.rating ||
      7.5;
    score += Number(bestRating) * 1.2;

    // If currently watching, slightly lower priority in "Discover" since it's already in Continue Watching
    if (userStatus === 'watching') {
      score -= 15;
    }

    if (score > 12) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const result = scored.map((s) => s.item);

  // If scored items are fewer than limit (e.g. 60), fill remaining slots from high-rated pool items
  if (result.length < limit) {
    const scoredIds = new Set(result.map((m) => m.id));
    const extra = pool
      .filter((m) => {
        if (!m || !m.id || scoredIds.has(m.id)) return false;
        const s = progressMap[m.id]?.status;
        return s !== 'completed' && s !== 'dropped';
      })
      .sort((a, b) => {
        const rA = Number(a.mdl_rating || a.imdb_rating || a.rating || 0);
        const rB = Number(b.mdl_rating || b.imdb_rating || b.rating || 0);
        return rB - rA;
      });
    result.push(...extra.slice(0, limit - result.length));
  }

  return result.slice(0, limit);
}
