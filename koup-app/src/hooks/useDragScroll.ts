import { useRef, useEffect, useCallback } from 'react';

/**
 * High-performance hook providing smooth mouse drag-to-scroll for horizontal containers on PC.
 * Automatically handles click suppression when dragging so links/cards don't trigger accidentally.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      // Only primary mouse button (left click)
      if (e.button !== 0) return;
      isDownRef.current = true;
      hasDraggedRef.current = false;
      startXRef.current = e.pageX - el.offsetLeft;
      scrollLeftRef.current = el.scrollLeft;
      el.style.cursor = 'grab';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDownRef.current) return;
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startXRef.current) * 1.4; // 1.4x momentum multiplier

      if (Math.abs(walk) > 6) {
        hasDraggedRef.current = true;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
        el.scrollLeft = scrollLeftRef.current - walk;
      }
    };

    const onMouseUp = () => {
      isDownRef.current = false;
      el.style.cursor = '';
      el.style.removeProperty('user-select');
    };

    const onMouseLeave = () => {
      if (isDownRef.current) {
        isDownRef.current = false;
        el.style.cursor = '';
        el.style.removeProperty('user-select');
      }
    };

    // Capture click events during or right after a drag to prevent accidental navigation
    const onClickCapture = (e: MouseEvent) => {
      if (hasDraggedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        hasDraggedRef.current = false;
      }
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}
