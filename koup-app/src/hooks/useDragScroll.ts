import { useRef, useEffect } from 'react';
import { setAccordionDragLock } from '@/components/AccordionMediaCard';

/**
 * Ultra-high-performance 120/144 FPS mouse drag-to-scroll hook with RAF scheduling,
 * 1:1 direct tracking, pointer-event isolation, and momentum inertia.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const targetScrollLeftRef = useRef(0);
  const hasDraggedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const momentumRafRef = useRef<number | null>(null);

  // Velocity tracking for silky smooth momentum on mouse release
  const historyRef = useRef<{ x: number; time: number }[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const cancelMomentum = () => {
      if (momentumRafRef.current !== null) {
        cancelAnimationFrame(momentumRafRef.current);
        momentumRafRef.current = null;
      }
    };

    const cancelRaf = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDownRef.current) return;

      const currentX = e.clientX;
      const now = performance.now();
      const deltaX = currentX - startXRef.current;

      // Track last 4 positions for release velocity
      historyRef.current.push({ x: currentX, time: now });
      if (historyRef.current.length > 5) {
        historyRef.current.shift();
      }

      if (Math.abs(deltaX) > 4) {
        if (!hasDraggedRef.current) {
          hasDraggedRef.current = true;
          setAccordionDragLock(true);
          el.classList.add('is-dragging');
          document.body.classList.add('is-dragging-rail');
        }

        // 1:1 direct pixel tracking with mouse
        targetScrollLeftRef.current = startScrollLeftRef.current - deltaX;

        // Schedule scroll update strictly on requestAnimationFrame (compositor sync)
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            el.scrollLeft = targetScrollLeftRef.current;
            rafIdRef.current = null;
          });
        }
      }
    };

    const onMouseUp = () => {
      if (!isDownRef.current) return;
      isDownRef.current = false;

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      cancelRaf();

      if (hasDraggedRef.current) {
        el.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-rail');

        // Calculate release velocity from history
        let velocityX = 0;
        const hist = historyRef.current;
        if (hist.length >= 2) {
          const first = hist[0];
          const last = hist[hist.length - 1];
          const dt = last.time - first.time;
          if (dt > 10 && dt < 200) {
            velocityX = (last.x - first.x) / dt; // px per ms
          }
        }

        // Apply smooth momentum if user flicked with velocity
        if (Math.abs(velocityX) > 0.25) {
          let currentSpeed = velocityX * 16; // amplify momentum flick
          const maxSpeed = 45;
          currentSpeed = Math.max(-maxSpeed, Math.min(maxSpeed, currentSpeed));

          const momentumLoop = () => {
            if (isDownRef.current || Math.abs(currentSpeed) < 0.4) {
              setAccordionDragLock(false);
              momentumRafRef.current = null;
              return;
            }

            el.scrollLeft -= currentSpeed;
            currentSpeed *= 0.94; // smooth exponential decay

            momentumRafRef.current = requestAnimationFrame(momentumLoop);
          };

          momentumRafRef.current = requestAnimationFrame(momentumLoop);
        } else {
          // No flick: unlock accordion hover quickly
          setTimeout(() => {
            if (!isDownRef.current) {
              setAccordionDragLock(false);
            }
          }, 60);
        }
      } else {
        setAccordionDragLock(false);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      // Only drag with primary left mouse button
      if (e.button !== 0) return;

      // Don't drag inside text inputs, form elements or interactive dropdowns
      if ((e.target as HTMLElement).closest('input, textarea, select, [data-interactive]')) {
        return;
      }

      cancelMomentum();
      cancelRaf();

      isDownRef.current = true;
      hasDraggedRef.current = false;
      startXRef.current = e.clientX;
      startScrollLeftRef.current = el.scrollLeft;
      targetScrollLeftRef.current = el.scrollLeft;
      historyRef.current = [{ x: e.clientX, time: performance.now() }];

      // Lock accordion hover immediately on mouse down so clicking never opens hover preview
      setAccordionDragLock(true);

      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseup', onMouseUp);
    };

    // Capture click events during or right after a drag to prevent accidental navigation
    const onClickCapture = (e: MouseEvent) => {
      if (hasDraggedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          hasDraggedRef.current = false;
        }, 80);
      }
    };

    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('dragstart', onDragStart as any);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      cancelMomentum();
      cancelRaf();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('dragstart', onDragStart as any);
      el.removeEventListener('click', onClickCapture, true);
      el.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-rail');
    };
  }, []);

  return ref;
}
