import { useRef, useEffect } from 'react';
import { setAccordionDragLock } from '@/components/AccordionMediaCard';

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
      // Allow dragging across buttons/cards, only exclude text inputs/dropdowns
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;

      isDownRef.current = true;
      hasDraggedRef.current = false;
      startXRef.current = e.pageX - el.offsetLeft;
      scrollLeftRef.current = el.scrollLeft;
      el.style.cursor = 'grab';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDownRef.current) return;
      const x = e.pageX - el.offsetLeft;
      const walk = (x - startXRef.current) * 1.5; // smooth momentum multiplier

      if (Math.abs(walk) > 5) {
        if (!hasDraggedRef.current) {
          hasDraggedRef.current = true;
          setAccordionDragLock(true);
        }
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
        el.scrollLeft = scrollLeftRef.current - walk;
      }
    };

    const onMouseUp = () => {
      if (isDownRef.current) {
        isDownRef.current = false;
        el.style.cursor = '';
        el.style.removeProperty('user-select');
        if (hasDraggedRef.current) {
          setAccordionDragLock(false);
        }
      }
    };

    const onMouseLeave = () => {
      if (isDownRef.current) {
        isDownRef.current = false;
        el.style.cursor = '';
        el.style.removeProperty('user-select');
        if (hasDraggedRef.current) {
          setAccordionDragLock(false);
        }
      }
    };

    // Capture click events during or right after a drag to prevent accidental navigation
    const onClickCapture = (e: MouseEvent) => {
      if (hasDraggedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          hasDraggedRef.current = false;
        }, 100);
      }
    };

    // Prevent native link/image dragging from stealing mousemove events
    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('dragstart', onDragStart as any);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('dragstart', onDragStart as any);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}
