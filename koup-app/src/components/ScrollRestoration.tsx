'use client';

import { useEffect, useRef, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function ScrollRestorationInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Combine pathname and search parameters for a precise page key
  const searchStr = searchParams?.toString();
  const currentKey = pathname + (searchStr ? `?${searchStr}` : '');

  const isRestoringRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const isPopStateRef = useRef(false);
  const prevKeyRef = useRef<string | null>(null);
  const lastScrollYRef = useRef<number>(0);
  const rafScrollSaveRef = useRef<number | null>(null);

  // 1. Intercept navigation and clicks to capture scroll position BEFORE Next.js resets to 0
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // Save scroll on ANY clickable interaction (cards, buttons, links)
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const clickable = target?.closest?.('a, button, [role="button"], [data-clickable], .cursor-pointer');
      if (clickable) {
        const curY = Math.round(window.scrollY);
        if (curY > 0) {
          const key = window.location.pathname + window.location.search;
          try {
            sessionStorage.setItem(`koup_scroll_${key}`, String(curY));
            const st = window.history.state || {};
            window.history.replaceState({ ...st, __koup_scrollY: curY }, '');
          } catch {}
        }
      }
    };
    document.addEventListener('click', handleGlobalClick, { capture: true, passive: true });

    // Intercept pushState
    const origPushState = window.history.pushState;
    window.history.pushState = function (...args) {
      const oldKey = window.location.pathname + window.location.search;
      const oldY = Math.round(window.scrollY);
      if (oldY > 0) {
        try {
          sessionStorage.setItem(`koup_scroll_${oldKey}`, String(oldY));
          const st = window.history.state || {};
          window.history.replaceState({ ...st, __koup_scrollY: oldY }, '');
        } catch {}
      }
      isNavigatingRef.current = true;
      return origPushState.apply(this, args);
    };

    // Listen for Back/Forward navigation
    const handlePopState = (e: PopStateEvent) => {
      isPopStateRef.current = true;
      if (e.state && typeof e.state.__koup_scrollY === 'number') {
        const key = window.location.pathname + window.location.search;
        try {
          sessionStorage.setItem(`koup_scroll_${key}`, String(e.state.__koup_scrollY));
        } catch {}
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.history.pushState = origPushState;
      document.removeEventListener('click', handleGlobalClick, { capture: true });
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // 2. Continuously save non-zero scroll position
  useEffect(() => {
    if (!currentKey) return;
    const storageKey = `koup_scroll_${currentKey}`;

    const saveScrollNow = () => {
      if (isRestoringRef.current || isNavigatingRef.current) return;
      const y = Math.round(window.scrollY);
      if (y > 0) {
        lastScrollYRef.current = y;
        try {
          sessionStorage.setItem(storageKey, String(y));
          const st = window.history.state || {};
          window.history.replaceState({ ...st, __koup_scrollY: y }, '');
        } catch {}
      }
    };

    const handleScroll = () => {
      if (isRestoringRef.current || isNavigatingRef.current) return;
      const y = Math.round(window.scrollY);
      if (y > 0) {
        lastScrollYRef.current = y;
        if (rafScrollSaveRef.current) cancelAnimationFrame(rafScrollSaveRef.current);
        rafScrollSaveRef.current = requestAnimationFrame(() => {
          if (isRestoringRef.current || isNavigatingRef.current) return;
          try {
            sessionStorage.setItem(storageKey, String(lastScrollYRef.current));
            const st = window.history.state || {};
            window.history.replaceState({ ...st, __koup_scrollY: lastScrollYRef.current }, '');
          } catch {}
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeunload', saveScrollNow);
    window.addEventListener('pagehide', saveScrollNow);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveScrollNow();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (lastScrollYRef.current > 0) {
        try {
          sessionStorage.setItem(storageKey, String(lastScrollYRef.current));
        } catch {}
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeunload', saveScrollNow);
      window.removeEventListener('pagehide', saveScrollNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafScrollSaveRef.current) cancelAnimationFrame(rafScrollSaveRef.current);
    };
  }, [currentKey]);

  // 3. Height-Aware, Mobile-Tolerant Scroll Restoration
  useEffect(() => {
    if (!currentKey) return;
    const storageKey = `koup_scroll_${currentKey}`;
    const isFirstMount = prevKeyRef.current === null;
    const isKeyChange = prevKeyRef.current !== null && prevKeyRef.current !== currentKey;
    const isPopState = isPopStateRef.current;

    isPopStateRef.current = false;
    prevKeyRef.current = currentKey;

    let savedY = 0;
    try {
      if (window.history.state && typeof window.history.state.__koup_scrollY === 'number') {
        savedY = window.history.state.__koup_scrollY;
      }
    } catch {}

    if (!savedY) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw !== null) savedY = parseInt(raw, 10) || 0;
      } catch {}
    }

    const shouldRestore = isPopState || (isFirstMount && savedY > 15);

    if (!shouldRestore) {
      isNavigatingRef.current = true;
      lastScrollYRef.current = 0;

      if (typeof window !== 'undefined' && window.location.hash) {
        const targetId = window.location.hash.slice(1);
        setTimeout(() => {
          const el = document.getElementById(targetId);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 120);
      } else if (isKeyChange) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }

      const navTimeout = setTimeout(() => {
        isNavigatingRef.current = false;
      }, 150);

      return () => clearTimeout(navTimeout);
    }

    if (savedY <= 15) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      lastScrollYRef.current = 0;
      isNavigatingRef.current = false;
      return;
    }

    // Active Height-Aware Restoration Loop
    isRestoringRef.current = true;
    lastScrollYRef.current = savedY;
    let userScrolled = false;
    let touchStartY = 0;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let settledFrames = 0;
    const startTime = performance.now();
    const MAX_WAIT_MS = 4500;

    const stopRestoration = () => {
      userScrolled = true;
      isRestoringRef.current = false;
      isNavigatingRef.current = false;
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
    };

    const onWheel = () => {
      stopRestoration();
    };

    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY || 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      // Only cancel if user actually drags by more than 40px
      const currentY = e.touches[0]?.clientY || 0;
      if (Math.abs(currentY - touchStartY) > 40) {
        stopRestoration();
      }
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    const step = () => {
      if (userScrolled) return;

      const docHeight = document.documentElement.scrollHeight;
      const clientH = window.innerHeight;
      const maxScroll = Math.max(0, docHeight - clientH);

      if (maxScroll >= savedY) {
        window.scrollTo({ top: savedY, behavior: 'instant' });
        if (Math.abs(window.scrollY - savedY) <= 4) {
          settledFrames++;
          if (settledFrames >= 12 || performance.now() - startTime > 1600) {
            stopRestoration();
            return;
          }
        } else {
          settledFrames = 0;
        }
      } else if (maxScroll > 0) {
        window.scrollTo({ top: maxScroll, behavior: 'instant' });
        settledFrames = 0;
      }

      if (performance.now() - startTime < MAX_WAIT_MS) {
        rafId = requestAnimationFrame(step);
      } else {
        stopRestoration();
      }
    };

    step();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!userScrolled) step();
      });
      resizeObserver.observe(document.documentElement);
      if (document.body) resizeObserver.observe(document.body);
    }

    return () => {
      stopRestoration();
    };
  }, [currentKey]);

  return null;
}

export default function ScrollRestoration() {
  return (
    <Suspense fallback={null}>
      <ScrollRestorationInner />
    </Suspense>
  );
}
