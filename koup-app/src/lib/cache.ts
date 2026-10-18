/**
 * KoUp High-Performance Multi-Tier Client Cache Layer
 * Provides:
 * 1. Synchronous In-Memory LRU Cache (0ms instant access)
 * 2. Persistent Storage (localStorage with sessionStorage fallback and auto-pruning)
 * 3. Global Media Registry (synchronous instant hydration for series & episode pages)
 * 4. Stale-While-Revalidate (SWR) with background non-blocking revalidation
 * 5. In-flight promise deduplication to prevent duplicate concurrent network queries
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

// In-memory cache map (LRU with max entries limit)
const MAX_MEMORY_ENTRIES = 800;
const memoryCache = new Map<string, CacheEntry<any>>();

// In-flight fetch promises to prevent redundant concurrent requests
const inFlightRequests = new Map<string, Promise<any>>();

// In-memory instant media registry (by slug and by numeric id)
const mediaBySlug = new Map<string, any>();
const mediaById = new Map<number, any>();

const STORAGE_PREFIX = 'koup_cache_v4_';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getFromStorage<T>(key: string): CacheEntry<T> | null {
  if (!isBrowser()) return null;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_PREFIX + key) ||
      window.sessionStorage?.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function pruneStorage(): void {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    // Remove oldest 30% of keys to free quota
    keysToRemove.slice(0, Math.ceil(keysToRemove.length * 0.3)).forEach((k) => {
      window.localStorage.removeItem(k);
    });
  } catch {}
}

function saveToStorage<T>(key: string, entry: CacheEntry<T>): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    try {
      pruneStorage();
      window.sessionStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // Ignore if completely full
    }
  }
}

function removeFromStorage(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
    window.sessionStorage?.removeItem(STORAGE_PREFIX + key);
  } catch {}
}

/**
 * Access memory cache with LRU re-ordering.
 */
function getMemoryEntry<T>(key: string): CacheEntry<T> | undefined {
  const entry = memoryCache.get(key);
  if (entry) {
    // Refresh LRU position by re-inserting at the end
    memoryCache.delete(key);
    memoryCache.set(key, entry);
  }
  return entry;
}

/**
 * Put entry in memory cache with LRU eviction of oldest entries.
 */
function setMemoryEntry<T>(key: string, entry: CacheEntry<T>): void {
  if (memoryCache.has(key)) {
    memoryCache.delete(key);
  } else if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, entry);
}

/**
 * Register a media item into the global synchronous registry.
 * This makes detail pages open in 0ms with zero network wait!
 */
export function registerMediaItem(item: any, persistToDisk = false): void {
  if (!item || typeof item !== 'object') return;
  if (item.slug) {
    const s = String(item.slug).toLowerCase();
    mediaBySlug.set(s, item);
  }
  if (item.id) {
    mediaById.set(Number(item.id), item);
  }
  if (persistToDisk && item.slug && item.title) {
    const s = String(item.slug).toLowerCase();
    saveToStorage(`media_stub_${s}`, {
      data: item,
      timestamp: Date.now(),
      ttlMs: 86400_000, // 24 hours
    });
  }
}

export function registerMediaItems(items: any[]): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    registerMediaItem(item, false);
  }
}

/**
 * Synchronously retrieves a media item from memory or persistent storage.
 * Returns null only on a true cold miss (e.g. direct URL paste).
 */
export function getMediaFromCache(slugOrId: string | number): any | null {
  if (!slugOrId) return null;
  if (typeof slugOrId === 'number' || (!isNaN(Number(slugOrId)) && !String(slugOrId).includes('-'))) {
    const byId = mediaById.get(Number(slugOrId));
    if (byId) return byId;
  }

  const cleanSlug = String(slugOrId).toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const bySlug = mediaBySlug.get(cleanSlug);
  if (bySlug) return bySlug;

  // Try persistent storage
  const fromStorage = getFromStorage<any>(`media_stub_${cleanSlug}`);
  if (fromStorage?.data) {
    registerMediaItem(fromStorage.data);
    return fromStorage.data;
  }
  return null;
}

/**
 * Dynamically resolves appropriate TTL for queries:
 * - 15 minutes (900,000ms) for categories / actors / people
 * - 5 minutes (300,000ms) for media items / catalog rows / home bundles
 */
export function resolveQueryTTL(key: string, customTtlMs?: number): number {
  if (typeof customTtlMs === 'number') {
    return Math.max(0, customTtlMs);
  }

  const k = key.toLowerCase();
  const isActorOrCategory =
    k.includes('person') ||
    k.includes('oyuncu') ||
    k.includes('people') ||
    k.includes('actor') ||
    k.includes('categor') ||
    k.includes('genre');

  if (isActorOrCategory) {
    return 1200_000; // 20 minutes (SWR non-blocking background revalidation)
  }

  const isMediaOrCatalog =
    k.includes('media') ||
    k.includes('seri') ||
    k.includes('home_') ||
    k.includes('catalog') ||
    k.includes('explore') ||
    k.includes('kesfet') ||
    k.includes('episode');

  if (isMediaOrCatalog) {
    return 600_000; // 10 minutes (SWR non-blocking background revalidation)
  }

  return 300_000; // 5 minutes default
}

/**
 * Execute a query with caching, in-flight deduplication, and stale-while-revalidate.
 */
export async function cachedQuery<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const effectiveTtl = resolveQueryTTL(key, ttlMs);

  // 1. Check in-memory LRU cache
  let entry = getMemoryEntry<T>(key);

  // 2. Fallback to persistent storage if not in memory
  if (!entry) {
    const storageEntry = getFromStorage<T>(key);
    if (storageEntry) {
      entry = storageEntry;
      setMemoryEntry(key, entry);
    }
  }

  // 3. Stale-While-Revalidate logic
  if (entry) {
    const age = now - entry.timestamp;
    if (age < entry.ttlMs) {
      // Fresh cache hit - return immediately (0ms)
      return entry.data;
    }

    // Cache is stale: Trigger background revalidation (do not block UI!)
    if (!inFlightRequests.has(key)) {
      const bgPromise = fetcher()
        .then((freshData) => {
          const freshEntry: CacheEntry<T> = {
            data: freshData,
            timestamp: Date.now(),
            ttlMs: effectiveTtl,
          };
          setMemoryEntry(key, freshEntry);
          saveToStorage(key, freshEntry);
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

    // Return stale data immediately for snappy instant UI
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
        ttlMs: effectiveTtl,
      };
      setMemoryEntry(key, freshEntry);
      saveToStorage(key, freshEntry);
      return freshData;
    } finally {
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, requestPromise);
  return requestPromise;
}

/**
 * Manually set or update a cache item with LRU management and persistent sync.
 */
export function setCache<T>(key: string, data: T, ttlMs = 300_000): void {
  const effectiveTtl = resolveQueryTTL(key, ttlMs);
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttlMs: effectiveTtl,
  };
  setMemoryEntry(key, entry);
  saveToStorage(key, entry);
}

/**
 * Get item from cache synchronously if present. Returns stale data if allowStale is true.
 */
export function getCache<T>(key: string, allowStale = true): T | null {
  const now = Date.now();
  let entry = getMemoryEntry<T>(key);
  if (!entry) {
    entry = getFromStorage<T>(key) || undefined;
    if (entry) setMemoryEntry(key, entry);
  }
  if (!entry) return null;
  if (now - entry.timestamp < entry.ttlMs || allowStale) {
    return entry.data;
  }
  return null;
}

export const getSynchronousCache = getCache;
export const setSynchronousCache = setCache;

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 */
export function invalidateCache(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    memoryCache.clear();
    mediaBySlug.clear();
    mediaById.clear();
    if (isBrowser()) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
        }
        for (const k of keysToRemove) window.localStorage.removeItem(k);
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

  // Invalidate matching storage keys
  if (isBrowser()) {
    try {
      const fullPrefix = STORAGE_PREFIX + keyOrPrefix;
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && (k === fullPrefix || k.startsWith(fullPrefix))) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) window.localStorage.removeItem(k);
    } catch {}
  }
}
