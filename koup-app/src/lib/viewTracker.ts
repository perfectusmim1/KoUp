import { supabase } from '@/lib/supabase';
import { getClientFingerprint } from '@/lib/fingerprint';

/**
 * Records a de-duplicated view event in Supabase (media_view_events) and updates
 * cumulative series/film views (media.views_total) + per-episode views (episodes.views_count).
 *
 * - 'detail' = series/film detail page click (+1 to media.views_total)
 * - 'watch'  = episode/film player open (+1 to episodes.views_count AND +1 to media.views_total)
 * - Client-side 6-hour localStorage cooldown + server-side IP/fingerprint/uid daily deduplication
 *   ensures rapid F5 refreshes never inflate view counts like a bot.
 */
const sessionTracked = new Set<string>();
const COOLDOWN_STORAGE_KEY = 'koup_view_cooldown_v1';
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours anti-F5 window

function isOnClientCooldown(eventKey: string): boolean {
  if (typeof window === 'undefined') return true;
  if (sessionTracked.has(eventKey)) return true;
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number>;
    const lastTs = map[eventKey];
    if (lastTs && Date.now() - lastTs < COOLDOWN_MS) {
      sessionTracked.add(eventKey);
      return true;
    }
  } catch {}
  return false;
}

function markClientCooldown(eventKey: string) {
  sessionTracked.add(eventKey);
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    // Prune expired entries to keep localStorage tiny
    for (const k of Object.keys(map)) {
      if (now - map[k] > COOLDOWN_MS) {
        delete map[k];
      }
    }
    map[eventKey] = now;
    localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export interface ViewTrackResult {
  counted: boolean;
  views_total?: number;
  episode_views?: number;
}

export function trackMediaView(
  mediaId: number | null | undefined,
  kind: 'detail' | 'watch' = 'detail',
  seasonNum: number = 1,
  episodeNum: number = 1,
  onUpdate?: (res: ViewTrackResult) => void
) {
  if (!mediaId || typeof window === 'undefined') return;
  const s = Math.max(1, Number(seasonNum) || 1);
  const e = Math.max(1, Number(episodeNum) || 1);
  const eventKey =
    kind === 'watch' ? `watch:${mediaId}:s${s}:e${e}` : `detail:${mediaId}`;

  if (isOnClientCooldown(eventKey)) return;
  markClientCooldown(eventKey);

  getClientFingerprint()
    .catch(() => null)
    .then((fp) =>
      fetch('/api/media/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_id: mediaId,
          viewer_key: fp && fp !== 'ssr_server_context' ? fp : null,
          kind,
          season: s,
          episode: e,
        }),
      })
    )
    .then((res) => (res.ok ? res.json() : null))
    .then(
      (data) => {
        if (data && typeof data === 'object' && onUpdate) {
          onUpdate(data as ViewTrackResult);
        }
      },
      () => {}
    );
}

