export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: 'episode' | 'actor' | 'reply' | 'system' | 'info' | 'success' | 'error';
  linkUrl?: string;
  imageUrl?: string;
  createdAt: string;
  rawCreatedAt?: string;
  isRead: boolean;
  mediaId?: number;
  personId?: number;
}

export interface ParsedEpisodeInfo {
  seriesKey: string;
  seasonNumber: number;
  episodeNumber: number;
}

/**
 * Extracts series slug/key, season number, and episode number from notification metadata.
 */
export function parseEpisodeInfo(n: {
  title?: string;
  body?: string;
  type?: string;
  linkUrl?: string;
  link_url?: string;
}): ParsedEpisodeInfo | null {
  const link = n.linkUrl || (n as any).link_url || '';
  const title = (n.title || '').trim();
  const body = (n.body || '').trim();

  const isEp =
    n.type === 'episode' ||
    n.type === 'new_episode' ||
    link.startsWith('/seri/') ||
    body.includes('Bölüm') ||
    title.includes('Bölüm');

  if (!isEp) return null;

  // 1. Series identifier (slug from URL or cleaned title)
  let seriesKey = '';
  const urlMatch = link.match(/\/seri\/([^/?#]+)/i);
  if (urlMatch && urlMatch[1]) {
    seriesKey = urlMatch[1].toLowerCase().trim();
  } else if (title) {
    seriesKey = (title.includes('•') ? title.split('•')[0] : title).trim().toLowerCase();
  }

  // 2. Episode number
  let episodeNumber = 0;
  const epUrlMatch = link.match(/\/seri\/[^/?#]+\/(\d+)/i);
  if (epUrlMatch && epUrlMatch[1]) {
    episodeNumber = parseInt(epUrlMatch[1], 10);
  } else {
    const bodyMatch = body.match(/(\d+)\s*\.?\s*Bölüm/i) || body.match(/Bölüm\s*(\d+)/i);
    if (bodyMatch && bodyMatch[1]) {
      episodeNumber = parseInt(bodyMatch[1], 10);
    } else {
      const titleMatch = title.match(/(\d+)\s*\.?\s*Bölüm/i) || title.match(/Bölüm\s*(\d+)/i);
      if (titleMatch && titleMatch[1]) episodeNumber = parseInt(titleMatch[1], 10);
    }
  }

  // 3. Season number (default 1)
  let seasonNumber = 1;
  const seasonMatch = body.match(/(\d+)\s*\.?\s*Sezon/i) || title.match(/(\d+)\s*\.?\s*Sezon/i);
  if (seasonMatch && seasonMatch[1]) {
    seasonNumber = parseInt(seasonMatch[1], 10);
  }

  if (!seriesKey && episodeNumber === 0) return null;
  return { seriesKey, seasonNumber, episodeNumber };
}

/**
 * Deterministic comparison function for notifications:
 * - If consecutive / co-occurring episode notifications belong to the same series:
 *   Sorts HIGHER episode number at the TOP (e.g. 16. Bölüm > 15. Bölüm > 14. Bölüm > 13. Bölüm).
 * - Otherwise orders by timestamp (newest first).
 * - Guaranteed 100% deterministic tie-breaker prevents scrambling on page refresh (F5).
 */
export function compareNotifications(
  a: ToastNotification,
  b: ToastNotification
): number {
  if (a.id === b.id) return 0;

  const aEp = parseEpisodeInfo(a);
  const bEp = parseEpisodeInfo(b);

  const timeA = a.rawCreatedAt ? new Date(a.rawCreatedAt).getTime() : 0;
  const timeB = b.rawCreatedAt ? new Date(b.rawCreatedAt).getTime() : 0;
  const timeDiff = Math.abs(timeA - timeB);

  // If both notifications belong to the same series:
  if (aEp && bEp && aEp.seriesKey && aEp.seriesKey === bEp.seriesKey) {
    // If they were released in the same time window (within 24 hours, or co-occurring in the feed)
    if (timeDiff < 86_400_000 || timeA === 0 || timeB === 0) {
      if (aEp.seasonNumber !== bEp.seasonNumber) {
        return bEp.seasonNumber - aEp.seasonNumber; // Higher season on top
      }
      if (aEp.episodeNumber !== bEp.episodeNumber) {
        return bEp.episodeNumber - aEp.episodeNumber; // Higher episode on top (e.g. 16 before 13)
      }
    }
  }

  // Standard chronological sort: newer timestamp first (if difference > 1s)
  if (timeDiff > 1000) {
    return timeB - timeA;
  }

  // If one is DB notification and one is temporary optimistic ID
  const aIsDb = !a.id.startsWith('notif-');
  const bIsDb = !b.id.startsWith('notif-');
  if (aIsDb && !bIsDb) return -1;
  if (!aIsDb && bIsDb) return 1;

  // If same series but within 1s timestamp
  if (aEp && bEp && aEp.seriesKey === bEp.seriesKey) {
    if (aEp.seasonNumber !== bEp.seasonNumber) {
      return bEp.seasonNumber - aEp.seasonNumber;
    }
    if (aEp.episodeNumber !== bEp.episodeNumber) {
      return bEp.episodeNumber - aEp.episodeNumber;
    }
  }

  // Absolute deterministic tie-breaker: never scramble order on F5
  return b.id.localeCompare(a.id);
}

/**
 * Deduplicates and sorts notifications deterministically.
 * Preserves `isRead = true` if any duplicate instance was read.
 */
export function dedupeAndSortNotifications(
  notifications: ToastNotification[]
): ToastNotification[] {
  const seenIds = new Set<string>();
  const seenFps = new Map<string, ToastNotification>();

  // Sort deterministically first
  const sorted = [...notifications].sort(compareNotifications);

  for (const n of sorted) {
    if (!n || !n.id) continue;
    if (seenIds.has(n.id)) continue;
    seenIds.add(n.id);

    const fp = n.linkUrl
      ? `${n.type}::${n.linkUrl.toLowerCase().trim()}`
      : `${(n.title || '').trim()}::${(n.body || '').trim()}`;

    if (seenFps.has(fp)) {
      const existing = seenFps.get(fp)!;
      // If either notification was already marked as read, preserve isRead = true
      if (n.isRead && !existing.isRead) {
        existing.isRead = true;
      }
      continue;
    }

    seenFps.set(fp, { ...n });
  }

  return Array.from(seenFps.values());
}
