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

  // 1. Ensure browser native scroll restoration is permanently set to 'manual'
  // and intercept history.pushState & link clicks to preserve scroll position before Next.js resets to 0
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // Intercept history.pushState to lock the previous page's scroll position before Next.js executes window.scrollTo(0, 0)
    const origPushState = window.history.pushState;
    window.history.pushState = function (...args) {
      const oldKey = window.location.pathname + window.location.search;
      const oldY = Math.round(window.scrollY);
      if (oldY > 0) {
        try {
          sessionStorage.setItem(`koup_scroll_${oldKey}`, String(oldY));
        } catch {}
      }
      isNavigatingRef.current = true;
      return origPushState.apply(this, args);
    };

    // Capture link clicks before router navigation
    const handleDocumentClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('a[href]');
      if (target) {
        const href = target.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
          const oldKey = window.location.pathname + window.location.search;
          const oldY = Math.round(window.scrollY);
          if (oldY > 0) {
            try {
              sessionStorage.setItem(`koup_scroll_${oldKey}`, String(oldY));
            } catch {}
          }
          isNavigatingRef.current = true;
        }
      }
    };
    document.addEventListener('click', handleDocumentClick, { capture: true });

    // Listen for browser Back/Forward navigation
    const handlePopState = () => {
      isPopStateRef.current = true;
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.history.pushState = origPushState;
      document.removeEventListener('click', handleDocumentClick, { capture: true });
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // 2. Continuously & efficiently save user scroll position for current page
  useEffect(() => {
    if (!currentKey) return;

    const storageKey = `koup_scroll_${currentKey}`;
    lastScrollYRef.current = Math.round(window.scrollY);

    const saveScrollNow = () => {
      if (isRestoringRef.current || isNavigatingRef.current) return;
      const y = Math.round(window.scrollY);
      lastScrollYRef.current = y;
      try {
        sessionStorage.setItem(storageKey, String(y));
      } catch {}
    };

    const handleScroll = () => {
      if (isRestoringRef.current || isNavigatingRef.current) return;
      lastScrollYRef.current = Math.round(window.scrollY);
      if (rafScrollSaveRef.current) cancelAnimationFrame(rafScrollSaveRef.current);
      rafScrollSaveRef.current = requestAnimationFrame(() => {
        if (isRestoringRef.current || isNavigatingRef.current) return;
        try {
          sessionStorage.setItem(storageKey, String(lastScrollYRef.current));
        } catch {}
      });
    };

    // Save on scroll, visibility change, beforeunload, and pagehide
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeunload', saveScrollNow);
    window.addEventListener('pagehide', saveScrollNow);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveScrollNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Save the last known genuine user scroll position on route exit
      if (lastScrollYRef.current > 0) {
        try {
          sessionStorage.setItem(storageKey, String(lastScrollYRef.current));
        } catch {}
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeunload', saveScrollNow);
      window.removeEventListener('pagehide', saveScrollNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafScrollSaveRef.current) {
        cancelAnimationFrame(rafScrollSaveRef.current);
      }
    };
  }, [currentKey]);

  // 3. Height-aware, async-tolerant Scroll Restoration
  useEffect(() => {
    if (!currentKey) return;

    const storageKey = `koup_scroll_${currentKey}`;
    const isFirstMount = prevKeyRef.current === null;
    const isKeyChange = prevKeyRef.current !== null && prevKeyRef.current !== currentKey;
    const isPopState = isPopStateRef.current;

    // Reset popstate flag
    isPopStateRef.current = false;
    prevKeyRef.current = currentKey;

    // Determine if this is a reload (F5) or back/forward navigation
    let isReload = false;
    try {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0) {
        const navType = (navEntries[0] as PerformanceNavigationTiming).type;
        if (navType === 'reload' || navType === 'back_forward') {
          isReload = true;
        }
      } else if (typeof window !== 'undefined' && window.performance && (window.performance as any).navigation) {
        const legacyType = (window.performance as any).navigation.type;
        if (legacyType === 1 || legacyType === 2) {
          isReload = true;
        }
      }
    } catch {}

    // Check if we have a saved scroll position in sessionStorage
    let savedY = 0;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        savedY = parseInt(raw, 10) || 0;
      }
    } catch {}

    const shouldRestore = (isFirstMount && (isReload || savedY > 10)) || isPopState;

    if (!shouldRestore) {
      // Clean forward navigation to a new page (e.g. clicked a link in navbar)
      isNavigatingRef.current = true;
      lastScrollYRef.current = 0;

      // If there's an anchor hash (e.g. #comments), let it scroll to that element
      if (typeof window !== 'undefined' && window.location.hash) {
        const targetId = window.location.hash.slice(1);
        const checkHashTarget = () => {
          const el = document.getElementById(targetId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth' });
          }
        };
        setTimeout(checkHashTarget, 100);
      } else if (isKeyChange) {
        // Forward page transition: start at the very top
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }

      // Re-enable scroll listening after paint settles
      const navTimeout = setTimeout(() => {
        isNavigatingRef.current = false;
      }, 150);

      return () => {
        clearTimeout(navTimeout);
      };
    }

    if (savedY <= 10) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      lastScrollYRef.current = 0;
      isNavigatingRef.current = false;
      return;
    }

    // Active Height-Aware Restoration Loop
    isRestoringRef.current = true;
    lastScrollYRef.current = savedY;
    let userInterrupted = false;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let settledFrames = 0;
    const startTime = performance.now();
    const MAX_WAIT_MS = 4000; // wait up to 4s for async media & comments

    const stopRestoration = () => {
      userInterrupted = true;
      isRestoringRef.current = false;
      isNavigatingRef.current = false;
      window.removeEventListener('wheel', onUserInteract);
      window.removeEventListener('touchstart', onUserInteract);
      window.removeEventListener('pointerdown', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeObserver) resizeObserver.disconnect();
    };

    const onUserInteract = () => {
      stopRestoration();
    };

    window.addEventListener('wheel', onUserInteract, { passive: true, once: true });
    window.addEventListener('touchstart', onUserInteract, { passive: true, once: true });
    window.addEventListener('pointerdown', onUserInteract, { passive: true, once: true });
    window.addEventListener('keydown', onUserInteract, { passive: true, once: true });

    const step = () => {
      if (userInterrupted) return;

      const docHeight = document.documentElement.scrollHeight;
      const clientH = window.innerHeight;
      const maxScroll = Math.max(0, docHeight - clientH);

      if (maxScroll >= savedY) {
        // Full target height is available in DOM!
        window.scrollTo({ top: savedY, behavior: 'instant' });

        if (Math.abs(window.scrollY - savedY) <= 3) {
          settledFrames++;
          // Keep locked for 15 frames (~250ms) to counteract delayed layout shifts from images
          if (settledFrames >= 15 || performance.now() - startTime > 1800) {
            stopRestoration();
            return;
          }
        } else {
          settledFrames = 0;
        }
      } else if (maxScroll > 0) {
        // Document is still growing (skeleton -> async data)
        // Keep user scrolled down as much as currently rendered to prevent 0 clamp
        window.scrollTo({ top: maxScroll, behavior: 'instant' });
        settledFrames = 0;
      }

      if (performance.now() - startTime < MAX_WAIT_MS) {
        rafId = requestAnimationFrame(step);
      } else {
        stopRestoration();
      }
    };

    // Initial immediate step
    step();

    // Attach ResizeObserver to immediately catch DOM height increases from React renders
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!userInterrupted) {
          step();
        }
      });
      resizeObserver.observe(document.documentElement);
      if (document.body) {
        resizeObserver.observe(document.body);
      }
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
