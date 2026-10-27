'use client';

import React, { useRef, memo } from 'react';
import Link from 'next/link';
import { Sparkles, ChevronRight, ChevronLeft } from 'lucide-react';
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
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] sm:text-[11px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-500/90 via-orange-500/90 to-rose-500/90 text-white border border-white/20 shadow-[0_0_14px_rgba(245,158,11,0.35)]">
              <Sparkles className="w-3 h-3 text-amber-200 fill-amber-200" />
              <span>SHORTS</span>
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white mt-1.5">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/kesfet?type=kisa_drama"
            className="text-xs sm:text-sm font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer"
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
              className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })
              }
              aria-label="İleri"
              className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
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
