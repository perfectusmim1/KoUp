import { supabase, UserMediaProgress } from '@/lib/supabase';

export const SIGNIFICANT_DELTA_SEC = 10;
export const PERIODIC_SYNC_INTERVAL_MS = 150_000; // 2.5 minutes (150s) fallback for uninterrupted sessions
export const LOCAL_TICK_INTERVAL_MS = 4000; // 4 seconds local-first update

export type ProgressSyncReason =
  | 'playback'
  | 'pause'
  | 'exit'
  | 'completed'
  | 'periodic'
  | 'reconcile'
  | 'manual';

export interface ProgressSyncOptions {
  immediate?: boolean;
  forceSync?: boolean;
  keepalive?: boolean;
  reason?: ProgressSyncReason;
}

export interface LastSyncSnapshot {
  positionSec: number;
  seasonNum: number;
  episodeNum: number;
  status?: string | null;
  watchedCount: number;
  syncedAt: number;
}

// In-memory token cache for synchronous access during beforeunload/pagehide
let cachedAccessToken: string | null = null;

if (typeof window !== 'undefined') {
  try {
    void supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.access_token) {
        cachedAccessToken = data.session.access_token;
      }
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      cachedAccessToken = session?.access_token || null;
    });
  } catch {}
}

export function setCachedAccessToken(token: string | null) {
  cachedAccessToken = token;
}

export function getCachedAccessToken(): string | null {
  if (cachedAccessToken) return cachedAccessToken;
  if (typeof window === 'undefined') return null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const val = localStorage.getItem(k);
        if (val) {
          const parsed = JSON.parse(val);
          const token =
            parsed?.access_token ||
            parsed?.session?.access_token ||
            parsed?.currentSession?.access_token;
          if (token) {
            cachedAccessToken = token;
            return token;
          }
        }
      }
    }
  } catch {}

  return null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

const VALID_STATUSES = new Set(['watching', 'completed', 'plan_to_watch', 'on_hold', 'dropped']);

export function sanitizeProgressDbPayload(
  item: Partial<UserMediaProgress> & { user_id?: string; media_id: number },
  fallbackUserId?: string
) {
  const rawUid = item.user_id && item.user_id !== 'guest' ? item.user_id : fallbackUserId;
  const uid = isValidUuid(rawUid) ? rawUid : undefined;

  const validStatus = item.status && VALID_STATUSES.has(item.status) ? item.status : null;

  let validScore: number | null = null;
  if (typeof item.user_score === 'number' && item.user_score >= 1 && item.user_score <= 10) {
    validScore = Math.round(item.user_score);
  }

  return {
    user_id: uid,
    media_id: Number(item.media_id),
    status: validStatus,
    is_favorite: Boolean(item.is_favorite),
    user_score: validScore,
    watched_episodes: Array.isArray(item.watched_episodes)
      ? item.watched_episodes.map(Number).filter((n) => !Number.isNaN(n) && n > 0)
      : [],
    last_season_num: Number(item.last_season_num) || 1,
    last_episode_num: Number(item.last_episode_num) || 1,
    last_episode_title: item.last_episode_title ?? null,
    resume_position_sec: Math.max(0, Math.floor(Number(item.resume_position_sec) || 0)),
    resume_duration_sec: Math.max(0, Math.floor(Number(item.resume_duration_sec) || 3600)),
    episode_positions:
      item.episode_positions && typeof item.episode_positions === 'object'
        ? item.episode_positions
        : {},
    updated_at: item.updated_at || new Date().toISOString(),
  };
}

/**
 * Sends a progress upsert to Supabase.
 * - Safely validates active auth session (guests stay local without triggering DB RLS errors).
 * - Enforces valid UUIDs and table constraints (status enum, score range).
 * - If keepalive: true is passed (e.g. during pagehide / beforeunload), uses fetch with keepalive: true.
 * - Otherwise uses standard supabase client upsert with structured diagnostic logging.
 */
export async function syncProgressRecordToSupabase(
  payload: any | any[],
  options?: { keepalive?: boolean }
): Promise<boolean> {
  if (!payload) return true;
  const isArray = Array.isArray(payload);
  const rows = isArray ? payload : [payload];
  if (rows.length === 0) return true;

  // 1. Verify active session and user credentials
  let sessionUserId: string | null = null;
  let accessToken: string | null = getCachedAccessToken();

  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id) {
      sessionUserId = data.session.user.id;
      if (data.session.access_token) {
        accessToken = data.session.access_token;
        setCachedAccessToken(accessToken);
      }
    }
  } catch {
    // Session check failsafe
  }

  // If user is not authenticated or does not have a valid UUID, DO NOT sync to Supabase.
  // Guests' progress is safely stored and retained in localStorage.
  if (!sessionUserId || !isValidUuid(sessionUserId)) {
    return true;
  }

  // 2. Sanitize and prepare rows for the authenticated user
  const sanitizedRows = rows
    .filter((r) => r && typeof r === 'object' && r.media_id && !Number.isNaN(Number(r.media_id)))
    .map((r) => sanitizeProgressDbPayload({ ...r, user_id: sessionUserId }, sessionUserId))
    .filter((r) => r.user_id && isValidUuid(r.user_id));

  if (sanitizedRows.length === 0) {
    return true;
  }

  const payloadToSend = isArray ? sanitizedRows : sanitizedRows[0];

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aocvcotmikzlwbaezdpl.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  // 3. Keepalive sync for page unload / tab close
  if (options?.keepalive && typeof window !== 'undefined') {
    if (accessToken) {
      const endpoint = `${supabaseUrl}/rest/v1/user_media_progress?on_conflict=user_id,media_id`;
      try {
        void fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(payloadToSend),
          keepalive: true,
        }).catch((e) => {
          console.warn('Keepalive progress sync notice:', e?.message || e);
        });
        return true;
      } catch (e: any) {
        console.warn('Keepalive fetch notice:', e?.message || e);
      }
    }
    // During pagehide/beforeunload, do not fall back to standard async upsert (browser aborts it)
    return true;
  }

  // 4. Standard client-side upsert with authenticated supabase client
  try {
    const { error } = await supabase
      .from('user_media_progress')
      .upsert(payloadToSend, { onConflict: 'user_id,media_id' });

    if (error) {
      if (error.code === '23503') {
        // Media no longer exists in DB (e.g. duplicate merged/deleted). Do not spam console or retry.
        return true;
      }
      console.warn('user_media_progress sync notice:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn('Supabase upsert exception:', e?.message || e);
    return false;
  }
}

/**
 * Determines whether a given progress update should trigger an upsert to Supabase.
 * Enforces the smart egress throttling criteria:
 * - Completed or episode changed -> Sync immediately.
 * - Pause -> Sync only if delta >= 10s.
 * - Exit / Tab Hide / Unmount -> Sync only if delta >= 10s.
 * - Regular continuous playback -> Do NOT sync, except for periodic fallback every 120-180s with delta >= 10s.
 */
export function shouldSyncToSupabase(
  newPos: number,
  newSeason: number,
  newEpisode: number,
  newStatus: string | null | undefined,
  newWatchedCount: number,
  lastSync: LastSyncSnapshot | undefined,
  options?: ProgressSyncOptions
): boolean {
  if (options?.forceSync || options?.immediate) {
    return true;
  }

  const reason = options?.reason || 'playback';

  if (reason === 'reconcile' || reason === 'manual' || reason === 'completed') {
    return true;
  }

  // If there was no previous sync recorded for this media
  if (!lastSync) {
    // If user pauses or exits after watching at least SIGNIFICANT_DELTA_SEC (10s), sync!
    if (reason === 'pause' || reason === 'exit') {
      return newPos >= SIGNIFICANT_DELTA_SEC;
    }
    // Periodic background fallback when starting from scratch and uninterrupted
    if (reason === 'playback' || reason === 'periodic') {
      return newPos >= PERIODIC_SYNC_INTERVAL_MS / 1000;
    }
    return false;
  }

  // 1. Episode or season changed -> sync!
  if (lastSync.seasonNum !== newSeason || lastSync.episodeNum !== newEpisode) {
    return true;
  }

  // 2. Status or watched episodes count changed -> sync!
  if ((lastSync.status || '') !== (newStatus || '') || lastSync.watchedCount !== newWatchedCount) {
    return true;
  }

  const delta = Math.abs(newPos - lastSync.positionSec);

  // 3. User paused: sync ONLY if delta >= 10 seconds
  if (reason === 'pause') {
    return delta >= SIGNIFICANT_DELTA_SEC;
  }

  // 4. Navigation / Tab switch / Unmount / Exit: sync ONLY if delta >= 10 seconds
  if (reason === 'exit') {
    return delta >= SIGNIFICANT_DELTA_SEC;
  }

  // 5. Periodic background fallback: sync ONLY at most once every 120-180 seconds with delta >= 10s
  if (reason === 'playback' || reason === 'periodic') {
    const elapsedSinceLastSync = Date.now() - lastSync.syncedAt;
    if (elapsedSinceLastSync >= PERIODIC_SYNC_INTERVAL_MS && delta >= SIGNIFICANT_DELTA_SEC) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Reconciles local progress state (koup_progress_v1) with fresh records from Supabase.
 * If local has a more recent updated_at or higher resume_position_sec, local progress is preserved
 * and queued to be reconciled back to Supabase.
 */
export function reconcileProgressMaps(
  localMap: Record<number, UserMediaProgress>,
  dbRows: any[],
  activeUserId: string
): {
  mergedMap: Record<number, UserMediaProgress>;
  itemsToSyncToSupabase: any[];
} {
  const dbMap: Record<number, UserMediaProgress> = {};
  if (Array.isArray(dbRows)) {
    dbRows.forEach((row: any) => {
      if (row.media_id) {
        dbMap[row.media_id] = {
          user_id: activeUserId,
          media_id: row.media_id,
          status: row.status,
          is_favorite: Boolean(row.is_favorite),
          user_score: row.user_score ?? null,
          watched_episodes: Array.isArray(row.watched_episodes) ? row.watched_episodes : [],
          last_season_num: row.last_season_num ?? 1,
          last_episode_num: row.last_episode_num ?? 1,
          last_episode_title: row.last_episode_title ?? '1. Bölüm',
          resume_position_sec: row.resume_position_sec ?? 0,
          resume_duration_sec: row.resume_duration_sec ?? 3600,
          episode_positions: row.episode_positions || {},
          updated_at: row.updated_at || new Date().toISOString(),
          media: row.media || undefined,
        };
      }
    });
  }

  const mergedMap: Record<number, UserMediaProgress> = {};
  const itemsToSyncToSupabase: any[] = [];

  const allMediaIds = new Set([
    ...Object.keys(localMap || {}).map(Number),
    ...Object.keys(dbMap).map(Number),
  ]);

  allMediaIds.forEach((id) => {
    if (!id || Number.isNaN(id)) return;

    const local = localMap ? localMap[id] : undefined;
    const db = dbMap[id];

    // Discard local data if it belongs to a different authenticated user to prevent cross-account pollution
    const isLocalValidUser = !local?.user_id || local.user_id === 'guest' || local.user_id === activeUserId;

    if (!db && local && isLocalValidUser) {
      // Local exists, Supabase has nothing -> keep local and sync to Supabase!
      const reconciled: UserMediaProgress = {
        ...local,
        user_id: activeUserId,
      };
      mergedMap[id] = reconciled;
      itemsToSyncToSupabase.push(sanitizeProgressDbPayload(reconciled, activeUserId));
      return;
    }

    if (db && (!local || !isLocalValidUser)) {
      // Supabase has progress, local has nothing (or wrong user) -> keep Supabase
      mergedMap[id] = db;
      return;
    }

    if (db && local && isLocalValidUser) {
      // Both exist: check if local is more advanced or newer
      const localTime = local.updated_at ? new Date(local.updated_at).getTime() : 0;
      const dbTime = db.updated_at ? new Date(db.updated_at).getTime() : 0;

      let localIsNewer = false;

      // 1. Strictly newer updated_at timestamp
      if (localTime > dbTime) {
        localIsNewer = true;
      }
      // 2. Same season and episode, but local has higher resume position
      else if (
        local.last_season_num === db.last_season_num &&
        local.last_episode_num === db.last_episode_num &&
        (local.resume_position_sec || 0) > (db.resume_position_sec || 0)
      ) {
        localIsNewer = true;
      }
      // 3. Local is on a subsequent episode/season
      else if (
        (local.last_season_num || 1) > (db.last_season_num || 1) ||
        (
          (local.last_season_num || 1) === (db.last_season_num || 1) &&
          (local.last_episode_num || 1) > (db.last_episode_num || 1)
        )
      ) {
        localIsNewer = true;
      }
      // 4. Local has marked more episodes as watched
      else if (
        (local.watched_episodes?.length || 0) > (db.watched_episodes?.length || 0)
      ) {
        localIsNewer = true;
      }

      const mergedEpisodePositions = {
        ...(db.episode_positions || {}),
        ...(local.episode_positions || {}),
      };

      if (localIsNewer) {
        const reconciled: UserMediaProgress = {
          ...local,
          episode_positions: mergedEpisodePositions,
          user_id: activeUserId,
          media: db.media || local.media,
          updated_at: local.updated_at || new Date().toISOString(),
        };
        mergedMap[id] = reconciled;
        itemsToSyncToSupabase.push(sanitizeProgressDbPayload(reconciled, activeUserId));
      } else {
        mergedMap[id] = {
          ...db,
          episode_positions: mergedEpisodePositions,
          media: db.media || local.media,
        };
      }
    }

    const current = mergedMap[id];
    if (current) {
      const isFilm =
        current.media?.content_type === 'film' || current.media?.content_type === 'movie';
      const pos = current.resume_position_sec || 0;
      const dur = current.resume_duration_sec || 3600;
      if (
        isFilm &&
        current.status === 'completed' &&
        pos > 15 &&
        dur > 0 &&
        pos / dur < 0.85
      ) {
        current.status = 'watching';
        current.watched_episodes = [];
      }
    }
  });

  return { mergedMap, itemsToSyncToSupabase };
}
