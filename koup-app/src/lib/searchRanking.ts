import { MediaItem } from '@/lib/supabase';

/**
 * Calculates a search relevance score for a given MediaItem based on query matching.
 * Higher score = more relevant result.
 */
export function getSearchRelevanceScore(item: MediaItem, query: string): number {
  if (!query || !query.trim()) return 0;

  const rawQ = query.trim().toLowerCase();
  const normalizedQ = rawQ.replace(/[^a-z0-9ğüşıöç]/gi, '').toLowerCase();
  const title = (item.title || '').trim();
  const titleLower = title.toLowerCase();
  const titleNormalized = titleLower.replace(/[^a-z0-9ğüşıöç]/gi, '');
  const nativeTitleLower = (item.native_title || '').trim().toLowerCase();
  const slugLower = (item.slug || '').trim().toLowerCase();

  let score = 0;

  // 1. Exact Match (Highest priority)
  if (titleLower === rawQ || titleNormalized === normalizedQ) {
    score += 1_000_000;
  }
  // 2. Exact Title followed by a colon or separator (e.g. "One Piece: ...", "One Piece - ...", "One Piece (...")
  else if (
    titleLower.startsWith(rawQ + ':') ||
    titleLower.startsWith(rawQ + ' -') ||
    titleLower.startsWith(rawQ + ' (') ||
    titleLower.startsWith(rawQ + ' ')
  ) {
    score += 500_000;
  }
  // 3. Title starts with query
  else if (titleLower.startsWith(rawQ) || titleNormalized.startsWith(normalizedQ)) {
    score += 300_000;
  }
  // 4. Word boundary match (e.g. query is a distinct word inside title)
  else if (new RegExp(`(?:^|[^a-z0-9])${rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i').test(titleLower)) {
    score += 150_000;
  }
  // 5. Title contains query
  else if (titleLower.includes(rawQ) || titleNormalized.includes(normalizedQ)) {
    score += 80_000;
  }
  // 6. Slug or Native Title match
  else if (slugLower.includes(rawQ.replace(/\s+/g, '-')) || nativeTitleLower.includes(rawQ)) {
    score += 40_000;
  }

  // Length penalty: Shorter titles that match are much more likely to be the main/parent series
  // e.g. "One Piece" (9 chars) vs "One Piece: Araburu Henkaku no Log: Anyaku Suru Kakumeigun!" (61 chars)
  const titleLength = title.length;
  score -= Math.min(titleLength * 150, 40_000);

  // Main series / Episode count boost:
  // Recaps / OVAs / TV specials usually have 1 or 2 episodes.
  // Main series have 10-1000+ episodes.
  const eps = item.episode_count || 0;
  if (eps >= 50) {
    score += 25_000;
  } else if (eps >= 12) {
    score += 15_000;
  } else if (eps > 1) {
    score += 5_000;
  }

  // Views & Popularity boost
  const views = item.views_total || 0;
  score += Math.min(views * 2, 20_000);

  // Rating boost
  const rating = item.mdl_rating || item.imdb_rating || (item.anilist_rating ? item.anilist_rating / 10 : 0) || 0;
  score += rating * 500;

  return score;
}

/**
 * Sorts an array of MediaItems by relevance to the query.
 */
export function rankSearchResults<T extends MediaItem>(items: T[], query: string): T[] {
  if (!query || !query.trim() || items.length <= 1) return items;

  return [...items].sort((a, b) => {
    const scoreA = getSearchRelevanceScore(a, query);
    const scoreB = getSearchRelevanceScore(b, query);
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    // Secondary tie-breaker: shorter title first
    if ((a.title || '').length !== (b.title || '').length) {
      return (a.title || '').length - (b.title || '').length;
    }
    // Tertiary tie-breaker: more episodes first (main series)
    if ((b.episode_count || 0) !== (a.episode_count || 0)) {
      return (b.episode_count || 0) - (a.episode_count || 0);
    }
    // Quaternary tie-breaker: higher views
    return (b.views_total || 0) - (a.views_total || 0);
  });
}
