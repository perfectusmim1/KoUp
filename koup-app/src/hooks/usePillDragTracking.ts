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
 * High-performance real-time pointer/mouse drag tracking hook for pill tab bars.
 * Allows smooth sweeping drag gestures across any number of tabs:
 * - Switches tabs instantly in real time during the drag phase (not just on release)
 * - The active indicator morphs and follows the mouse across all tabs seamlessly
 * - Supports horizontal auto-scroll when dragging near edges of overflowing tab bars
 * - 0ms latency tactile response for normal clicks and touches
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

  // Store latest values in refs to avoid stale closures during pointer event loops
  const activeTabRef = useRef<T>(activeTab);
  activeTabRef.current = activeTab;

  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;

  const triggerSoundRef = useRef(triggerSound);
  triggerSoundRef.current = triggerSound;

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

        // Ensure newly active tab is visible within scrollable containers
        const activeBtn = buttons.find(
          (b) => b.getAttribute(tabAttribute) === String(closestTabId)
        );
        if (activeBtn) {
          activeBtn.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest',
          });
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

      const rect = container.getBoundingClientRect();
      const margin = 35;

      if (clientX > rect.right - margin && container.scrollLeft < container.scrollWidth - container.clientWidth) {
        const factor = Math.min(1, (clientX - (rect.right - margin)) / margin);
        container.scrollLeft += Math.max(2, Math.round(factor * 14));
      } else if (clientX < rect.left + margin && container.scrollLeft > 0) {
        const factor = Math.min(1, ((rect.left + margin) - clientX) / margin);
        container.scrollLeft -= Math.max(2, Math.round(factor * 14));
      }
    },
    [disableAutoScroll]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only respond to main button (left click or primary touch)
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
      } catch (_) {
        // Fallback if setPointerCapture is unsupported or fails
      }

      checkTabAtClientX(e.clientX);
    },
    [checkTabAtClientX]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return;

      const deltaX = Math.abs(e.clientX - startXRef.current);
      const deltaY = Math.abs(e.clientY - startYRef.current);

      // On touch devices, if the initial gesture is predominantly vertical, release to allow normal page scrolling
      if (e.pointerType === 'touch' && !hasMovedRef.current) {
        if (deltaY > deltaX && deltaY > 8) {
          isDraggingRef.current = false;
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch (_) {}
          return;
        }
      }

      if (deltaX > 2 || e.pointerType === 'mouse') {
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
    },
    []
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
