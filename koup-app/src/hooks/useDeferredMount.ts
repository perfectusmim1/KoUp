'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  startTransition,
} from 'react';

interface ScheduledTask {
  order: number;
  mount: () => void;
  isDone: () => boolean;
}

class IdleQueueScheduler {
  private queue: ScheduledTask[] = [];
  private idleId: number | null = null;
  private isRunning = false;

  private scheduleNext() {
    if (this.queue.length === 0) {
      this.isRunning = false;
      return;
    }
    this.isRunning = true;

    const runTask = () => {
      this.idleId = null;
      // Clean up any tasks that were already mounted (e.g. by IntersectionObserver or scroll restoration)
      this.queue = this.queue.filter((t) => !t.isDone());
      if (this.queue.length === 0) {
        this.isRunning = false;
        return;
      }

      // Sort remaining tasks by order ascending (top-to-bottom sequence)
      this.queue.sort((a, b) => a.order - b.order);

      const nextTask = this.queue.shift();
      if (nextTask && !nextTask.isDone()) {
        nextTask.mount();
      }

      if (this.queue.length > 0) {
        this.scheduleNext();
      } else {
        this.isRunning = false;
      }
    };

    if (typeof window !== 'undefined') {
      if (typeof window.requestIdleCallback === 'function') {
        this.idleId = window.requestIdleCallback(runTask, { timeout: 600 });
      } else {
        this.idleId = window.setTimeout(runTask, 50);
      }
    }
  }

  register(task: ScheduledTask) {
    this.queue.push(task);
    if (!this.isRunning) {
      this.scheduleNext();
    }
  }

  unregister(task: ScheduledTask) {
    this.queue = this.queue.filter((t) => t !== task);
    if (this.queue.length === 0 && this.idleId !== null && typeof window !== 'undefined') {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.idleId);
      } else {
        window.clearTimeout(this.idleId);
      }
      this.idleId = null;
      this.isRunning = false;
    }
  }

  mountAllNow() {
    if (this.idleId !== null && typeof window !== 'undefined') {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.idleId);
      } else {
        window.clearTimeout(this.idleId);
      }
      this.idleId = null;
    }
    const pending = [...this.queue];
    this.queue = [];
    this.isRunning = false;
    for (const t of pending) {
      if (!t.isDone()) {
        t.mount();
      }
    }
  }
}

const scheduler = new IdleQueueScheduler();

/**
 * Checks whether the user is restoring a previous scroll position
 * (e.g. back navigation or page reload with scroll offset).
 */
export function isScrollRestorationActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.scrollY > 15) return true;
    if (
      window.history?.state &&
      typeof window.history.state.__koup_scrollY === 'number' &&
      window.history.state.__koup_scrollY > 15
    ) {
      return true;
    }
    const currentKey = window.location.pathname + (window.location.search || '');
    const raw = sessionStorage.getItem(`koup_scroll_${currentKey}`);
    if (raw !== null && parseInt(raw, 10) > 15) {
      return true;
    }
  } catch {
    // Ignore any browser security/sessionStorage exceptions
  }
  return false;
}

export interface DeferredMountResult {
  isMounted: boolean;
  ref: (node: HTMLElement | null) => void;
}

/**
 * Hook to progressively mount below-the-fold rails.
 * Sections with order <= 0 mount immediately.
 * Other sections mount either when their turn arrives in the idle queue or
 * when an IntersectionObserver with rootMargin 800px detects them near viewport.
 */
export function useDeferredMount(order: number): DeferredMountResult {
  // If order is <= 0 (e.g. the first content rail), mount immediately during SSR and initial hydration.
  const [isMounted, setIsMounted] = useState(() => order <= 0);
  const isMountedRef = useRef(order <= 0);
  const domNodeRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const triggerMount = useCallback(() => {
    if (isMountedRef.current) return;
    isMountedRef.current = true;
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    startTransition(() => {
      setIsMounted(true);
    });
  }, []);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      domNodeRef.current = node;
      if (order <= 0 || isMountedRef.current) return;

      if (node && typeof IntersectionObserver !== 'undefined') {
        if (!observerRef.current) {
          observerRef.current = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  triggerMount();
                  break;
                }
              }
            },
            { rootMargin: '800px 0px' }
          );
        }
        observerRef.current.observe(node);
      }
    },
    [order, triggerMount]
  );

  useEffect(() => {
    if (order <= 0 || isMounted) return;

    // Fast-path: Back navigation / saved scroll position restores everything immediately
    if (isScrollRestorationActive()) {
      scheduler.mountAllNow();
      triggerMount();
      return;
    }

    const task: ScheduledTask = {
      order,
      mount: triggerMount,
      isDone: () => isMountedRef.current,
    };

    scheduler.register(task);

    return () => {
      scheduler.unregister(task);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [order, isMounted, triggerMount]);

  return { isMounted, ref: setRef };
}
