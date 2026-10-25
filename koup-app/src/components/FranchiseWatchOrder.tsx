'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  Layers,
  Play,
  Film,
  Tv,
  Sparkles,
  CheckCircle2,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
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
  progressMap,
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

  const hasBothCategories = mainItems.length > 0 && sideItems.length > 0;

  // Determine if current series is in 'side' so we show the right tab by default
  const currentInSide = useMemo(
    () => sideItems.some((i) => i.id === currentMediaId),
    [sideItems, currentMediaId]
  );

  const [activeTab, setActiveTab] = useState<FilterTab>(() => {
    if (!hasBothCategories) return 'all';
    return currentInSide ? 'all' : 'main';
  });

  const [isGridExpanded, setIsGridExpanded] = useState(false);

  // Sync default tab when navigating between series
  useEffect(() => {
    if (!hasBothCategories) {
      setActiveTab('all');
    } else if (currentInSide && activeTab === 'main') {
      setActiveTab('all');
    }
  }, [currentMediaId, hasBothCategories, currentInSide]);

  const displayedItems = useMemo(() => {
    if (!hasBothCategories || activeTab === 'all') {
      return franchise.items;
    }
    if (activeTab === 'main') {
      return mainItems;
    }
    return sideItems;
  }, [franchise.items, mainItems, sideItems, hasBothCategories, activeTab]);

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
    const userProg = progressMap?.[item.id];
    const isCompleted = userProg?.status === 'completed';
    const isWatching = userProg?.status === 'watching';
    const isMovie =
      item.content_type === 'film' ||
      item.format === 'MOVIE' ||
      item.role_label.toLowerCase().includes('film');

    const stepNumber = idx + 1;

    return (
      <React.Fragment key={item.id}>
        <Link
          ref={isCurrent && !isGrid ? (activeCardRef as React.RefObject<HTMLAnchorElement>) : undefined}
          href={`/seri/${item.slug}`}
          prefetch={false}
          aria-current={isCurrent ? 'page' : undefined}
          className={`group relative flex ${
            isGrid
              ? 'flex-row items-center gap-3.5 p-3 rounded-2xl w-full'
              : 'flex-col w-[184px] sm:w-[204px] shrink-0 rounded-2xl p-2.5'
          } transition-[transform,background-color,border-color,box-shadow] duration-200 select-none ${
            isCurrent
              ? 'bg-[#2997ff]/[0.09] border-2 border-[#2997ff]/70 shadow-[0_0_24px_rgba(41,151,255,0.18)]'
              : 'bg-[#121216]/90 hover:bg-[#18181f] border border-white/[0.08] hover:border-white/25 hover:-translate-y-0.5'
          }`}
        >
          {/* Poster Container */}
          <div
            className={`relative overflow-hidden rounded-xl bg-black/60 shrink-0 ${
              isGrid ? 'w-16 sm:w-20 aspect-[2/3]' : 'w-full aspect-[16/10]'
            }`}
          >
            <img
              src={posterUrl}
              alt={cleanTitle}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

            {/* Top-left Step Order Number Badge */}
            <div
              className={`absolute top-1.5 left-1.5 flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-black tracking-tight shadow-md ${
                isCurrent
                  ? 'bg-sky-400 text-black'
                  : item.category === 'main'
                  ? 'bg-black/80 text-white border border-white/20'
                  : 'bg-black/75 text-white/80 border border-white/10'
              }`}
            >
              <span>#{String(stepNumber).padStart(2, '0')}</span>
            </div>

            {/* Top-right User Progress or Current Indicator */}
            {isCurrent ? (
              <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-lg bg-sky-500 text-black text-[10px] font-extrabold uppercase tracking-wider shadow-md flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping" />
                <span>Açık</span>
              </div>
            ) : isCompleted ? (
              <div
                title="İzlendi"
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500/90 text-black flex items-center justify-center shadow-md"
              >
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
            ) : isWatching ? (
              <div
                title="İzleniyor"
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-amber-400/90 text-black flex items-center justify-center shadow-md"
              >
                <Clock className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
            ) : null}

            {/* Bottom-left Role Badge inside rail card */}
            {!isGrid && (
              <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1">
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold truncate ${
                    item.category === 'main'
                      ? 'bg-sky-500/25 text-sky-200 border border-sky-400/35'
                      : 'bg-amber-500/20 text-amber-200 border border-amber-400/30'
                  }`}
                >
                  {item.role_label}
                </span>
                {item.release_year > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono font-semibold text-white/80 shrink-0">
                    {item.release_year}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Info Column */}
          <div className={`flex flex-col min-w-0 flex-1 ${isGrid ? 'justify-center' : 'mt-2.5'}`}>
            {isGrid && (
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    item.category === 'main'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-400/25'
                  }`}
                >
                  {item.role_label}
                </span>
                {item.release_year > 0 && (
                  <span className="text-[11px] font-mono text-white/50">
                    • {item.release_year}
                  </span>
                )}
                {isCurrent && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-400/20 text-sky-300 text-[10px] font-bold">
                    Şu An Buradasınız
                  </span>
                )}
              </div>
            )}

            <h3
              className={`font-bold leading-snug line-clamp-2 transition-colors ${
                isGrid ? 'text-xs sm:text-sm' : 'text-xs min-h-[2.25rem]'
              } ${
                isCurrent
                  ? 'text-sky-300'
                  : 'text-white/90 group-hover:text-white'
              }`}
            >
              {cleanTitle}
            </h3>

            <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-white/[0.06] text-[11px] text-white/55">
              <span className="inline-flex items-center gap-1 truncate">
                {isMovie ? (
                  <>
                    <Film className="w-3 h-3 text-amber-400/80 shrink-0" />
                    <span>Sinema Filmi</span>
                  </>
                ) : (
                  <>
                    <Tv className="w-3 h-3 text-sky-400/80 shrink-0" />
                    <span>
                      {item.episode_count > 0 ? `${item.episode_count} Bölüm` : 'Seri'}
                    </span>
                  </>
                )}
              </span>

              <span
                className={`inline-flex items-center gap-0.5 font-semibold shrink-0 ${
                  isCurrent
                    ? 'text-sky-400'
                    : 'text-white/40 group-hover:text-white/80'
                }`}
              >
                {isCurrent ? (
                  <span>İnceleniyor</span>
                ) : (
                  <>
                    <span>Aç</span>
                    <Play className="w-2.5 h-2.5 fill-current" />
                  </>
                )}
              </span>
            </div>
          </div>
        </Link>

        {/* Visual Watch-Order Arrow Connector between sequential items in Horizontal Rail */}
        {!isGrid && idx < displayedItems.length - 1 && (
          <div
            aria-hidden="true"
            className="flex items-center justify-center shrink-0 text-white/25 px-0.5"
          >
            <ArrowRight className="w-4 h-4" />
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <section
      aria-label="İzleme Sırası ve Bağlantılı Seriler"
      className="space-y-4 rounded-3xl bg-[#0c0c10]/90 border border-white/[0.08] p-4 sm:p-6 shadow-xl [content-visibility:auto] [contain-intrinsic-size:auto_none_auto_280px] [contain:layout_paint_style]"
    >
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-3 border-b border-white/[0.07]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-[0.16em] uppercase text-sky-400">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>SERİ EVRENİ & İZLEME SIRASI</span>
            <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/25 text-sky-300 tracking-normal font-semibold">
              {franchise.items.length} Yapım
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight flex flex-wrap items-center gap-2">
            <span>{cleanFranchiseTitle}</span>
            <span className="text-xs sm:text-sm font-medium text-white/50">
              — Kronolojik İzleme Rehberi
            </span>
          </h2>
        </div>

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

      {/* Primary Chronological Watch-Order Rail (Always smooth and accessible) */}
      <div
        ref={railRef}
        className="flex items-stretch gap-2 overflow-x-auto overflow-y-hidden no-scrollbar py-1.5 [-webkit-overflow-scrolling:touch]"
      >
        {displayedItems.map((item, idx) => renderCard(item, idx, false))}
      </div>

      {/* Expandable Multi-Column Grid Drawer (120fps fluid CSS expansion without DOM destruction) */}
      {displayedItems.length > 4 && (
        <>
          <div className={`koup-expandable-drawer ${isGridExpanded ? 'is-expanded' : ''}`}>
            <div className="koup-expandable-inner">
              <div className="pt-3.5 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-3 text-xs text-white/50">
                  <span className="font-semibold uppercase tracking-wider text-[11px] text-[#2997ff]">Tüm Seri Kataloğu</span>
                  <span>{displayedItems.length} Yapım Listeleniyor</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {displayedItems.map((item, idx) => renderCard(item, idx, true))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={() => setIsGridExpanded((prev) => !prev)}
              className="min-h-[38px] inline-flex items-center gap-2 px-5 py-2 rounded-full glass-pill hover:bg-white/15 text-xs font-semibold text-white/90 border border-white/15 hover:border-white/30 transition-all cursor-pointer active:scale-95 shadow-sm"
            >
              <span>
                {isGridExpanded
                  ? 'Genişletilmiş Listeyi Kapat'
                  : `Tüm İzleme Sırasını Liste Olarak Aç (${displayedItems.length} Yapım)`}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${
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
