'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Film,
  Tv,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { motion, LayoutGroup } from 'motion/react';
import type { FranchiseData, FranchiseItem } from '@/lib/server/seriesData';
import { cleanMediaTitle, getProxiedImageUrl } from '@/lib/supabase';
import { useDragScroll } from '@/hooks/useDragScroll';

interface FranchiseWatchOrderProps {
  franchise: FranchiseData;
  currentMediaId: number;
  progressMap?: Record<number, { status?: string | null; progress?: number }>;
}

type FilterTab = 'main' | 'side' | 'all';

export default function FranchiseWatchOrder({
  franchise,
  currentMediaId,
}: FranchiseWatchOrderProps) {
  const railRef = useDragScroll<HTMLDivElement>();
  const activeCardRef = useRef<HTMLAnchorElement | HTMLDivElement | null>(null);

  const mainItems = useMemo(
    () => franchise.items.filter((i) => i.category === 'main'),
    [franchise.items]
  );
  const sideItems = useMemo(
    () => franchise.items.filter((i) => i.category === 'side'),
    [franchise.items]
  );

  // Interleave main + movies/specials chronologically by release_year for "Tümü"
  const chronologicalAllItems = useMemo(() => {
    return [...franchise.items].sort((a, b) => {
      const yA = a.release_year && a.release_year > 0 ? a.release_year : 9999;
      const yB = b.release_year && b.release_year > 0 ? b.release_year : 9999;
      if (yA !== yB) return yA - yB;
      // Within the same year, put main series before movies/specials
      if (a.category !== b.category) return a.category === 'main' ? -1 : 1;
      return a.watch_order - b.watch_order;
    });
  }, [franchise.items]);

  const hasBothCategories = mainItems.length > 0 && sideItems.length > 0;

  const currentInSide = useMemo(
    () => sideItems.some((i) => i.id === currentMediaId),
    [sideItems, currentMediaId]
  );

  const [activeTab, setActiveTab] = useState<FilterTab>(() => {
    if (!hasBothCategories) return 'all';
    return currentInSide ? 'all' : 'main';
  });

  const [isGridExpanded, setIsGridExpanded] = useState(false);

  useEffect(() => {
    if (!hasBothCategories) {
      setActiveTab('all');
    } else if (currentInSide && activeTab === 'main') {
      setActiveTab('all');
    }
  }, [currentMediaId, hasBothCategories, currentInSide]);

  const displayedItems = useMemo(() => {
    if (!hasBothCategories || activeTab === 'all') {
      return chronologicalAllItems;
    }
    if (activeTab === 'main') {
      return mainItems;
    }
    return sideItems;
  }, [chronologicalAllItems, mainItems, sideItems, hasBothCategories, activeTab]);

  // Auto-scroll horizontal rail so the current media item is visible
  useEffect(() => {
    if (isGridExpanded) return;
    const container = railRef.current;
    const activeEl = activeCardRef.current;
    if (!container || !activeEl) return;

    const timer = setTimeout(() => {
      try {
        const containerRect = container.getBoundingClientRect();
        const activeRect = activeEl.getBoundingClientRect();
        const offset =
          activeRect.left -
          containerRect.left +
          container.scrollLeft -
          containerRect.width / 2 +
          activeRect.width / 2;
        container.scrollTo({
          left: Math.max(0, offset),
          behavior: 'smooth',
        });
      } catch {
        // Ignore layout scroll errors
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [activeTab, currentMediaId, isGridExpanded, railRef]);

  if (!franchise || !franchise.items || franchise.items.length < 2) {
    return null;
  }

  const cleanFranchiseTitle = cleanMediaTitle(franchise.title);

  const renderCard = (item: FranchiseItem, idx: number, isGrid: boolean) => {
    const isCurrent = item.id === currentMediaId;
    const cleanTitle = cleanMediaTitle(item.title);
    const posterUrl = getProxiedImageUrl(item.cover_image, item.title, null, 'w342');
    const isMovie =
      item.content_type === 'film' ||
      item.format === 'MOVIE' ||
      item.role_label.toLowerCase().includes('film');

    const stepNumber = idx + 1;
    const metaParts: string[] = [];
    if (item.release_year && item.release_year > 0) {
      metaParts.push(String(item.release_year));
    }
    if (isMovie) {
      metaParts.push('Film');
    } else if (item.episode_count && item.episode_count > 0) {
      metaParts.push(`${item.episode_count} Bölüm`);
    } else {
      metaParts.push('Dizi');
    }

    return (
      <Link
        key={item.id}
        ref={isCurrent && !isGrid ? (activeCardRef as React.RefObject<HTMLAnchorElement>) : undefined}
        href={`/seri/${item.slug}`}
        prefetch={false}
        aria-current={isCurrent ? 'page' : undefined}
        className={`group relative flex ${
          isGrid
            ? 'flex-row items-center gap-3.5 p-2.5 rounded-2xl w-full'
            : 'flex-col w-[176px] sm:w-[196px] shrink-0 rounded-2xl p-2.5'
        } transition-colors duration-150 select-none ${
          isCurrent
            ? 'bg-[#2997ff]/[0.09] border-2 border-[#2997ff]/70'
            : 'bg-[#121216]/90 hover:bg-[#18181f] border border-white/[0.08] hover:border-white/20'
        }`}
      >
        {/* Poster Container */}
        <div
          className={`relative overflow-hidden rounded-xl bg-black/60 shrink-0 ${
            isGrid ? 'w-14 sm:w-16 aspect-[2/3]' : 'w-full aspect-[16/10]'
          }`}
        >
          <img
            src={posterUrl}
            alt={cleanTitle}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Top-left Step Order Number Badge */}
          <div
            className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-tight ${
              isCurrent
                ? 'bg-[#2997ff] text-white'
                : 'bg-black/75 text-white/85 border border-white/15'
            }`}
          >
            #{String(stepNumber).padStart(2, '0')}
          </div>
        </div>

        {/* Info Column */}
        <div className={`flex flex-col min-w-0 flex-1 ${isGrid ? 'justify-center' : 'mt-2'}`}>
          <h3
            className={`font-bold leading-snug line-clamp-2 transition-colors text-xs ${
              isGrid ? 'sm:text-sm' : 'min-h-[2.1rem]'
            } ${
              isCurrent
                ? 'text-[#2997ff]'
                : 'text-white/90 group-hover:text-white'
            }`}
          >
            {cleanTitle}
          </h3>

          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-white/50 truncate">
            {isMovie ? (
              <Film className="w-3 h-3 text-white/40 shrink-0" />
            ) : (
              <Tv className="w-3 h-3 text-white/40 shrink-0" />
            )}
            <span className="truncate">{metaParts.join(' • ')}</span>
          </div>
        </div>
      </Link>
    );
  };

  return (
    <section
      aria-label="Seri Evreni"
      className="space-y-3.5 rounded-3xl bg-[#0c0c10]/90 border border-white/[0.08] p-4 sm:p-6 shadow-xl [content-visibility:auto] [contain-intrinsic-size:auto_none_auto_260px] [contain:layout_paint_style]"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/[0.07]">
        <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight flex flex-wrap items-center gap-2">
          <span>{cleanFranchiseTitle}</span>
          <span className="text-xs sm:text-sm font-medium text-white/50">
            — Seri Evreni
          </span>
        </h2>

        {/* Category Filter Tabs + View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {hasBothCategories && (
            <LayoutGroup id="franchise-filter-tabs">
              <div
                role="tablist"
                aria-label="İzleme Sırası Filtresi"
                className="inline-flex w-max items-center gap-1 p-1 rounded-full glass-pill-dark border border-white/12 select-none"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'main'}
                  onClick={() => setActiveTab('main')}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 select-none ${
                    activeTab === 'main' ? 'text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {activeTab === 'main' && (
                    <motion.span
                      layoutId="franchise-active-tab-pill"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
                      className="absolute inset-0 rounded-full bg-[#2997ff] shadow-[0_0_12px_rgba(41,151,255,0.35)]"
                    />
                  )}
                  <Tv className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Ana Sıra ({mainItems.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'side'}
                  onClick={() => setActiveTab('side')}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 select-none ${
                    activeTab === 'side' ? 'text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {activeTab === 'side' && (
                    <motion.span
                      layoutId="franchise-active-tab-pill"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
                      className="absolute inset-0 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.35)]"
                    />
                  )}
                  <Sparkles className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Filmler & Özel ({sideItems.length})</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'all'}
                  onClick={() => setActiveTab('all')}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer select-none ${
                    activeTab === 'all' ? 'text-white' : 'text-white/60 hover:text-white'
                  }`}
                >
                  {activeTab === 'all' && (
                    <motion.span
                      layoutId="franchise-active-tab-pill"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
                      className="absolute inset-0 rounded-full bg-white/20 border border-white/25 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                    />
                  )}
                  <span className="relative z-10">Tümü ({franchise.items.length})</span>
                </button>
              </div>
            </LayoutGroup>
          )}

          {/* Scroll Arrows for Horizontal Rail */}
          {displayedItems.length > 3 && (
            <div className="hidden sm:flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                onClick={() =>
                  railRef.current?.scrollBy({ left: -460, behavior: 'smooth' })
                }
                aria-label="Sola Kaydır"
                className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  railRef.current?.scrollBy({ left: 460, behavior: 'smooth' })
                }
                aria-label="Sağa Kaydır"
                className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Primary Watch-Order Rail */}
      <div
        ref={railRef}
        className="flex items-stretch gap-3 overflow-x-auto overflow-y-hidden no-scrollbar py-1 [-webkit-overflow-scrolling:touch]"
      >
        {displayedItems.map((item, idx) => renderCard(item, idx, false))}
      </div>

      {/* Expandable Multi-Column Grid Drawer */}
      {displayedItems.length > 4 && (
        <>
          <div className={`koup-expandable-drawer ${isGridExpanded ? 'is-expanded' : ''}`}>
            <div className="koup-expandable-inner">
              <div className="pt-3 border-t border-white/[0.06]">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {displayedItems.map((item, idx) => renderCard(item, idx, true))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-0.5">
            <button
              type="button"
              onClick={() => setIsGridExpanded((prev) => !prev)}
              className="min-h-[36px] inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-pill hover:bg-white/15 text-xs font-semibold text-white/85 border border-white/12 hover:border-white/25 transition-colors cursor-pointer"
            >
              <span>
                {isGridExpanded
                  ? 'Listeyi Daralt'
                  : `Tümünü Gör (${displayedItems.length})`}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isGridExpanded ? 'rotate-180 text-[#2997ff]' : 'text-white/60'
                }`}
              />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
