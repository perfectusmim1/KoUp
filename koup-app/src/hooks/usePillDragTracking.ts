'use client';

import { useRef, useEffect, useCallback } from 'react';

export interface UsePillDragTrackingOptions<T extends string | number> {
  activeTab: T;
  onTabChange: (id: T) => void;
  triggerSound?: (type: string) => void;
  /**
   * Optional custom attribute for tab elements. Defaults to 'data-tab-id'.
   */
  tabAttribute?: string;
  /**
   * Optional flag to disable auto-scrolling on overflow containers.
   */
  disableAutoScroll?: boolean;
}

/**
 * Finds the scrollable horizontal parent element of a given node
 */
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  if (!node || typeof window === 'undefined') return null;
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      style.overflowX === 'auto' ||
      style.overflowX === 'scroll'
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Smoothly centers an active tab button within its scrollable parent container.
 * - If the tab is first, it aligns to the start (scrollLeft = 0).
 * - If the tab is last, it aligns to the end (scrollLeft = maxScrollLeft).
 * - If the tab is anywhere in between, it centers directly in the container viewport.
 */
export function centerTabInContainer(
  activeBtn: HTMLElement,
  tabAttributeOrSmooth: string | boolean = 'data-tab-id',
  smooth = true
) {
  if (!activeBtn || typeof window === 'undefined') return;
  const tabAttribute =
    typeof tabAttributeOrSmooth === 'string' ? tabAttributeOrSmooth : 'data-tab-id';
  const isSmooth =
    typeof tabAttributeOrSmooth === 'boolean' ? tabAttributeOrSmooth : smooth;

  const scrollParent = getScrollParent(activeBtn) || activeBtn.parentElement;
  if (!scrollParent) return;

  const parentRect = scrollParent.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();

  // Find position among tab siblings
  const siblings = Array.from(
    (activeBtn.parentElement || scrollParent).querySelectorAll<HTMLElement>(`[${tabAttribute}]`)
  );
  const index = siblings.indexOf(activeBtn);
  const isFirst = index === 0;
  const isLast = index === siblings.length - 1;

  const maxScrollLeft = Math.max(0, scrollParent.scrollWidth - scrollParent.clientWidth);

  let targetScrollLeft: number;
  if (isFirst) {
    targetScrollLeft = 0;
  } else if (isLast) {
    targetScrollLeft = maxScrollLeft;
  } else {
    // Distance from button center to parent viewport center
    const btnCenter = btnRect.left + btnRect.width / 2;
    const parentCenter = parentRect.left + parentRect.width / 2;
    const diff = btnCenter - parentCenter;
    targetScrollLeft = scrollParent.scrollLeft + diff;
  }

  const clampedScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));

  if (Math.abs(scrollParent.scrollLeft - clampedScrollLeft) > 1.5) {
    scrollParent.scrollTo({
      left: clampedScrollLeft,
      behavior: isSmooth ? 'smooth' : 'auto',
    });
  }
}

/**
 * High-performance tab navigation & auto-centering hook.
 * - On Mobile / Touch devices:
 *   Native, fluid horizontal swipe gestures with zero resistance (no pointer drag hijacking).
 *   Selected options are automatically centered in the viewport smoothly.
 * - On PC / Mouse:
 *   Supports click-and-drag sweeping across tabs with mouse tracking and edge auto-scrolling.
 * - Guaranteed centering:
 *   Whenever activeTab changes, centers the chosen tab unless it's first or last.
 */
export function usePillDragTracking<T extends string | number>({
  activeTab,
  onTabChange,
  triggerSound,
  tabAttribute = 'data-tab-id',
  disableAutoScroll = false,
}: UsePillDragTrackingOptions<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const hasMovedRef = useRef(false);

  // Store latest values in refs to avoid stale closures during event loops
  const activeTabRef = useRef<T>(activeTab);
  activeTabRef.current = activeTab;

  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;

  const triggerSoundRef = useRef(triggerSound);
  triggerSoundRef.current = triggerSound;

  // Center the active tab whenever activeTab changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId: NodeJS.Timeout | null = null;
    const rafId = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const activeBtn = container.querySelector<HTMLElement>(
        `[${tabAttribute}="${String(activeTab)}"]`
      );
      if (activeBtn) {
        centerTabInContainer(activeBtn, tabAttribute, true);
      } else {
        // Fallback retry shortly if button is mounting
        timeoutId = setTimeout(() => {
          const btn = container.querySelector<HTMLElement>(
            `[${tabAttribute}="${String(activeTab)}"]`
          );
          if (btn) {
            centerTabInContainer(btn, tabAttribute, false);
          }
        }, 70);
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeTab, tabAttribute]);

  const checkTabAtClientX = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;

      const buttons = Array.from(
        container.querySelectorAll<HTMLElement>(`[${tabAttribute}]`)
      );
      if (buttons.length === 0) return;

      let closestTabId: T | null = null;
      let minDistance = Infinity;

      for (const btn of buttons) {
        const rawId = btn.getAttribute(tabAttribute);
        if (rawId === null) continue;
        const tabId = rawId as unknown as T;

        const rect = btn.getBoundingClientRect();

        // Direct containment check
        if (clientX >= rect.left && clientX <= rect.right) {
          closestTabId = tabId;
          break;
        }

        // Distance to horizontal center
        const center = (rect.left + rect.right) / 2;
        const dist = Math.abs(clientX - center);
        if (dist < minDistance) {
          minDistance = dist;
          closestTabId = tabId;
        }
      }

      if (closestTabId !== null && closestTabId !== activeTabRef.current) {
        activeTabRef.current = closestTabId;
        onTabChangeRef.current(closestTabId);
        triggerSoundRef.current?.('click');

        const activeBtn = buttons.find(
          (b) => b.getAttribute(tabAttribute) === String(closestTabId)
        );
        if (activeBtn) {
          centerTabInContainer(activeBtn, true);
        }
      }
    },
    [tabAttribute]
  );

  const handleAutoScroll = useCallback(
    (clientX: number) => {
      if (disableAutoScroll) return;
      const container = containerRef.current;
      if (!container) return;

      const scrollParent = getScrollParent(container) || container;
      const rect = scrollParent.getBoundingClientRect();
      const margin = 40;

      if (
        clientX > rect.right - margin &&
        scrollParent.scrollLeft < scrollParent.scrollWidth - scrollParent.clientWidth
      ) {
        const factor = Math.min(1, (clientX - (rect.right - margin)) / margin);
        scrollParent.scrollLeft += Math.max(3, Math.round(factor * 16));
      } else if (clientX < rect.left + margin && scrollParent.scrollLeft > 0) {
        const factor = Math.min(1, (rect.left + margin - clientX) / margin);
        scrollParent.scrollLeft -= Math.max(3, Math.round(factor * 16));
      }
    },
    [disableAutoScroll]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // On mobile / touch devices: Do NOT initiate pointer drag tracking!
      // This allows silky-smooth native swipe scrolling on touchscreens without
      // dragging the button along with the user's thumb.
      if (e.pointerType === 'touch') {
        return;
      }

      // Mouse on Desktop: Only respond to primary left click
      if (e.button !== 0) return;

      const container = containerRef.current;
      if (!container) return;

      isDraggingRef.current = true;
      pointerIdRef.current = e.pointerId;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      hasMovedRef.current = false;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}

      checkTabAtClientX(e.clientX);
    },
    [checkTabAtClientX]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      if (e.pointerType === 'touch') return;

      const deltaX = Math.abs(e.clientX - startXRef.current);
      if (deltaX > 2) {
        hasMovedRef.current = true;
      }

      checkTabAtClientX(e.clientX);
      handleAutoScroll(e.clientX);
    },
    [checkTabAtClientX, handleAutoScroll]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}

      const container = containerRef.current;
      if (container) {
        const activeBtn = container.querySelector<HTMLElement>(
          `[${tabAttribute}="${String(activeTabRef.current)}"]`
        );
        if (activeBtn) {
          centerTabInContainer(activeBtn, true);
        }
      }
    },
    [tabAttribute]
  );

  return {
    containerRef,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
