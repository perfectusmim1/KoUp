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
  urgent?: boolean;
  mount: () => void;
  isDone: () => boolean;
}

class IdleQueueScheduler {
  private queue: ScheduledTask[] = [];
  private delayId: number | null = null;
  private idleId: number | null = null;
  private rafId: number | null = null;
  private isRunning = false;

  private cancelPendingTimers() {
    if (typeof window === 'undefined') return;
    if (this.delayId !== null) {
      window.clearTimeout(this.delayId);
      this.delayId = null;
    }
    if (this.idleId !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(this.idleId);
      } else {
        window.clearTimeout(this.idleId);
      }
      this.idleId = null;
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private scheduleNext() {
    this.queue = this.queue.filter((t) => !t.isDone());
    if (this.queue.length === 0) {
      this.isRunning = false;
      return;
    }
    this.isRunning = true;

    const hasUrgent = this.queue.some((t) => t.urgent);

    const runTask = () => {
      this.delayId = null;
      this.idleId = null;
      this.rafId = null;
      // Clean up any tasks that were already mounted
      this.queue = this.queue.filter((t) => !t.isDone());
      if (this.queue.length === 0) {
        this.isRunning = false;
        return;
      }

      // Sort urgent tasks first, then by order ascending (top-to-bottom sequence)
      this.queue.sort((a, b) => {
        const uA = a.urgent ? 0 : 1;
        const uB = b.urgent ? 0 : 1;
        if (uA !== uB) return uA - uB;
        return a.order - b.order;
      });

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
      if (hasUrgent) {
        // Urgent (nearing viewport via IntersectionObserver): mount on next frame with zero visible pop-in
        this.rafId = window.requestAnimationFrame(runTask);
      } else {
        // Far below the fold: drip-mount gently during idle time so initial LCP, TBT, memory & mobile taps stay 60fps
        const isNarrowMobile = window.innerWidth < 768;
        if (isNarrowMobile) {
          // On mobile, only eagerly idle-warm rail order <= 1; deeper rails mount on-demand via IntersectionObserver (600px rootMargin)
          const nextNonUrgent = this.queue.reduce((min, t) => Math.min(min, t.order), Infinity);
          if (nextNonUrgent > 1) {
            this.isRunning = false;
            return;
          }
        }
        this.delayId = window.setTimeout(() => {
          this.delayId = null;
          if (typeof window.requestIdleCallback === 'function') {
            this.idleId = window.requestIdleCallback(runTask, { timeout: 2200 });
          } else {
            this.idleId = window.setTimeout(runTask, 280);
          }
        }, isNarrowMobile ? 900 : 350);
      }
    }
  }

  register(task: ScheduledTask) {
    this.queue.push(task);
    if (!this.isRunning) {
      this.scheduleNext();
    }
  }

  promoteUrgent(task: ScheduledTask) {
    if (task.isDone()) return;
    task.urgent = true;
    if (!this.queue.includes(task)) {
      this.queue.push(task);
    }
    // If waiting on an idle callback (not already waiting on rAF), upgrade to rAF
    if (this.rafId === null) {
      this.cancelPendingTimers();
      this.scheduleNext();
    }
  }

  unregister(task: ScheduledTask) {
    this.queue = this.queue.filter((t) => t !== task);
    if (this.queue.length === 0) {
      this.cancelPendingTimers();
      this.isRunning = false;
    }
  }

  mountAllNow() {
    this.cancelPendingTimers();
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
    if (window.scrollY > 20) return true;
    if (
      window.history?.state &&
      typeof window.history.state.__koup_scrollY === 'number' &&
      window.history.state.__koup_scrollY > 20
    ) {
      return true;
    }
    const currentKey = window.location.pathname + (window.location.search || '');
    const raw = sessionStorage.getItem(`koup_scroll_${currentKey}`);
    if (raw !== null && parseInt(raw, 10) > 20) {
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
 * when an IntersectionObserver with rootMargin 250px promotes them to the
 * 1-per-frame urgent rAF queue.
 */
export function useDeferredMount(order: number): DeferredMountResult {
  // Mount only the first below-hero section (order <= 0) immediately; deeper rails mount on-demand via IntersectionObserver (600px lookahead) or gentle idle trickle.
  const [isMounted, setIsMounted] = useState(() => order <= 0);
  const isMountedRef = useRef(order <= 0);
  const domNodeRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const taskRef = useRef<ScheduledTask | null>(null);

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

  if (!taskRef.current) {
    taskRef.current = {
      order,
      mount: triggerMount,
      isDone: () => isMountedRef.current,
    };
  } else {
    taskRef.current.order = order;
    taskRef.current.mount = triggerMount;
  }

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
                  if (observerRef.current) {
                    observerRef.current.disconnect();
                    observerRef.current = null;
                  }
                  if (taskRef.current) {
                    scheduler.promoteUrgent(taskRef.current);
                  } else {
                    triggerMount();
                  }
                  break;
                }
              }
            },
            { rootMargin: '600px 0px' }
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

    const task = taskRef.current!;
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
