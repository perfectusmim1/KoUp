/**
 * KoUp Lightweight Client-Side Cache Layer
 * Provides In-Memory + SessionStorage caching with TTL, in-flight request deduplication,
 * and Stale-While-Revalidate (SWR) for Supabase and REST API queries.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

// In-memory cache map (fastest, survives component re-renders)
const memoryCache = new Map<string, CacheEntry<any>>();

// In-flight fetch promises to prevent redundant concurrent requests
const inFlightRequests = new Map<string, Promise<any>>();

const SESSION_PREFIX = 'koup_cache_';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function getFromSession<T>(key: string): CacheEntry<T> | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function saveToSession<T>(key: string, entry: CacheEntry<T>): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or private browsing restrictions - ignore safely
  }
}

function removeFromSession(key: string): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(SESSION_PREFIX + key);
  } catch {}
}

/**
 * Execute a query with caching, in-flight deduplication, and stale-while-revalidate.
 *
 * @param key Unique cache key (e.g. 'catalog_kr_drama_10')
 * @param ttlMs Time-to-live in milliseconds (e.g. 60_000 for 1 minute)
 * @param fetcher Async function returning fresh data
 */
export async function cachedQuery<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  // 1. Check in-memory cache
  let entry = memoryCache.get(key) as CacheEntry<T> | undefined;

  // 2. Fallback to sessionStorage if not in memory
  if (!entry) {
    const sessionEntry = getFromSession<T>(key);
    if (sessionEntry) {
      entry = sessionEntry;
      memoryCache.set(key, entry);
    }
  }

  // 3. Stale-While-Revalidate logic
  if (entry) {
    const age = now - entry.timestamp;
    if (age < entry.ttlMs) {
      // Fresh cache hit - return immediately
      return entry.data;
    }

    // Cache is stale: Trigger background revalidation (do not block UI)
    if (!inFlightRequests.has(key)) {
      const bgPromise = fetcher()
        .then((freshData) => {
          const freshEntry: CacheEntry<T> = {
            data: freshData,
            timestamp: Date.now(),
            ttlMs,
          };
          memoryCache.set(key, freshEntry);
          saveToSession(key, freshEntry);
          return freshData;
        })
        .catch((err) => {
          console.warn(`[KoUp Cache] Background revalidate failed for ${key}:`, err);
          return entry!.data;
        })
        .finally(() => {
          inFlightRequests.delete(key);
        });

      inFlightRequests.set(key, bgPromise);
    }

    // Return stale data immediately for snappy UI
    return entry.data;
  }

  // 4. Cache miss: Check if an in-flight request already exists
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key) as Promise<T>;
  }

  // 5. Fetch fresh data and populate both caches
  const requestPromise = (async () => {
    try {
      const freshData = await fetcher();
      const freshEntry: CacheEntry<T> = {
        data: freshData,
        timestamp: Date.now(),
        ttlMs,
      };
      memoryCache.set(key, freshEntry);
      saveToSession(key, freshEntry);
      return freshData;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, requestPromise);
  return requestPromise;
}

/**
 * Manually set or update a cache item.
 */
export function setCache<T>(key: string, data: T, ttlMs = 120_000): void {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttlMs,
  };
  memoryCache.set(key, entry);
  saveToSession(key, entry);
}

/**
 * Get item from cache synchronously if present and not expired.
 */
export function getCache<T>(key: string): T | null {
  const now = Date.now();
  let entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = getFromSession<T>(key) || undefined;
    if (entry) memoryCache.set(key, entry);
  }
  if (entry && now - entry.timestamp < entry.ttlMs) {
    return entry.data;
  }
  return null;
}

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 */
export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    memoryCache.clear();
    if (isBrowser()) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k?.startsWith(SESSION_PREFIX)) keysToRemove.push(k);
        }
        for (const k of keysToRemove) window.sessionStorage.removeItem(k);
      } catch {}
    }
    return;
  }

  // Invalidate matching memory keys
  for (const k of Array.from(memoryCache.keys())) {
    if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
      memoryCache.delete(k);
    }
  }

  // Invalidate matching sessionStorage keys
  if (isBrowser()) {
    try {
      const fullPrefix = SESSION_PREFIX + keyOrPrefix;
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k && (k === fullPrefix || k.startsWith(fullPrefix))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) window.sessionStorage.removeItem(k);
    } catch {}
  }
}
