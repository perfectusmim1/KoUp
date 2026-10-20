'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPathRef = useRef<string>(pathname);

  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;

    const el = containerRef.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    el.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 6px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ],
      {
        duration: 180,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }
    );
  }, [pathname]);

  return (
    <div ref={containerRef} className="w-full max-w-full">
      {children}
    </div>
  );
}
