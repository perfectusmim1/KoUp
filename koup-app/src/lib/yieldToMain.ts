'use client';

/**
 * Yields control back to the browser main thread using scheduler.yield()
 * when available, falling back to setTimeout(0).
 */
export function yieldToMain(): Promise<void> {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    };
    if (g.scheduler && typeof g.scheduler.yield === 'function') {
      return g.scheduler.yield();
    }
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Schedules non-critical background work during browser idle periods
 * so critical-path LCP and hydration are never blocked.
 */
export function runWhenIdle(callback: () => void, timeoutMs = 2000): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => {
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(id);
      }
    };
  }
  const timer = setTimeout(callback, Math.min(timeoutMs, 350));
  return () => clearTimeout(timer);
}
