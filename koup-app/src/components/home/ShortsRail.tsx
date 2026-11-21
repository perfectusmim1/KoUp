'use client';

import React, { useRef, memo } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { MediaItem } from '@/lib/supabase';
import ShortsCard from '@/components/shorts/ShortsCard';

export interface ShortsRailProps {
  items: MediaItem[];
  title?: string;
  className?: string;
}

function ShortsRailComponent({
  items,
  title = 'Kısa Dramalar',
  className = 'w-full px-4 sm:px-6 md:px-14 max-w-full my-6 sm:my-8',
}: ShortsRailProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (!items || items.length === 0) return null;

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white">
          {title}
        </h2>
        <div className="flex items-center gap-3">
          <Link
            href="/kesfet?type=kisa_drama"
            className="text-[11px] sm:text-[12px] tracking-wider uppercase font-semibold text-white/60 hover:text-white transition-colors flex items-center gap-1 cursor-pointer min-h-[44px]"
          >
            <span>Tümünü Keşfet</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })
              }
              aria-label="Geri"
              className="w-11 h-11 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })
              }
              aria-label="İleri"
              className="w-11 h-11 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex items-center gap-3.5 sm:gap-4.5 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-4 no-scrollbar [-webkit-overflow-scrolling:touch] max-w-full"
      >
        {items.map((item, idx) => (
          <div
            key={`short-row-${item.id}`}
            className="w-36 sm:w-44 md:w-48 shrink-0 snap-start"
          >
            <ShortsCard item={item} priority={idx < 4} />
          </div>
        ))}
      </div>
    </section>
  );
}

export { ShortsRailComponent as ShortsRail };
export default memo(ShortsRailComponent);
