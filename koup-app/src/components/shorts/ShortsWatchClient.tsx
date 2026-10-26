'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Layers,
  List,
  Sparkles,
  Play,
  Check,
  X,
  Eye,
  Share2,
  RotateCw,
  Film,
} from 'lucide-react';
import {
  MediaItem,
  EpisodeData,
  EpisodeSource,
  cleanMediaTitle,
  getProxiedImageUrl,
  formatViewCount,
  getEpisodeProgress,
  cleanOverviewText,
} from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import NetflixPlayer from '@/components/NetflixPlayer';
import CountryFlag from '@/components/CountryFlag';
import { isShortDrama } from './ShortsCard';

export interface ShortsWatchClientProps {
  media: MediaItem;
  episodes: EpisodeData[];
  currentEpisode: number;
  currentSeason?: number;
  initialSourceIdx?: number;
  onSelectEpisode?: (season: number, episode: number) => void;
  onSelectSourceIdx?: (idx: number) => void;
  onSourceDead?: (deadUrl: string) => void;
  ambientLightingEnabled?: boolean;
  onToggleAmbientLighting?: () => void;
  autoNextEnabled?: boolean;
  onToggleAutoNext?: () => void;
}

export default function ShortsWatchClient({
  media,
  episodes = [],
  currentEpisode = 1,
  currentSeason = 1,
  initialSourceIdx = 0,
  onSelectEpisode,
  onSelectSourceIdx,
  onSourceDead,
  ambientLightingEnabled = true,
  onToggleAmbientLighting,
  autoNextEnabled = true,
  onToggleAutoNext,
}: ShortsWatchClientProps) {
  const router = useRouter();
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const toggleEpisodeWatched = useKoUpSelector((s) => s.toggleEpisodeWatched);
  const user = useKoUpSelector((s) => s.user);
  const openAuthModal = useKoUpSelector((s) => s.openAuthModal);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);

  const [activeEpNum, setActiveEpNum] = useState<number>(currentEpisode);
  const [selectedSourceIdx, setSelectedSourceIdx] = useState<number>(initialSourceIdx);
  const [showMobileEpisodesSheet, setShowMobileEpisodesSheet] = useState<boolean>(false);
  const [showMobileSourcesSheet, setShowMobileSourcesSheet] = useState<boolean>(false);
  const [isOverviewExpanded, setIsOverviewExpanded] = useState<boolean>(false);

  // Sync internal active episode when prop changes
  useEffect(() => {
    setActiveEpNum(currentEpisode);
  }, [currentEpisode]);

  // Sort episodes in ascending order (1..N)
  const sortedEpisodes = useMemo(() => {
    return [...episodes].sort((a, b) => a.episode_number - b.episode_number);
  }, [episodes]);

  const activeEpIndex = useMemo(() => {
    return sortedEpisodes.findIndex((e) => e.episode_number === activeEpNum);
  }, [sortedEpisodes, activeEpNum]);

  const currentEp = activeEpIndex >= 0 ? sortedEpisodes[activeEpIndex] : sortedEpisodes[0];
  const prevEp = activeEpIndex > 0 ? sortedEpisodes[activeEpIndex - 1] : null;
  const nextEp =
    activeEpIndex >= 0 && activeEpIndex + 1 < sortedEpisodes.length
      ? sortedEpisodes[activeEpIndex + 1]
      : null;

  // Available sources for the current active episode
  const availableSources = useMemo(() => {
    return currentEp?.sources || [];
  }, [currentEp]);

  // Handle switching to a specific episode
  const handleGoToEpisode = useCallback(
    (epNum: number) => {
      setActiveEpNum(epNum);
      setSelectedSourceIdx(0);
      setShowMobileEpisodesSheet(false);

      if (onSelectEpisode) {
        onSelectEpisode(1, epNum);
      }
      if (typeof window !== 'undefined') {
        window.history.pushState(null, '', `/seri/${media.slug}/${epNum}`);
      }
    },
    [media.slug, onSelectEpisode]
  );

  const goToNext = useCallback(() => {
    if (nextEp) {
      handleGoToEpisode(nextEp.episode_number);
    }
  }, [nextEp, handleGoToEpisode]);

  const goToPrev = useCallback(() => {
    if (prevEp) {
      handleGoToEpisode(prevEp.episode_number);
    }
  }, [prevEp, handleGoToEpisode]);

  // Background Prefetch for next episode stream resolution
  useEffect(() => {
    if (!nextEp?.sources?.[0]?.direct_url) return;
    const controller = new AbortController();
    const firstSource = nextEp.sources[0];
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        url: firstSource.direct_url,
        provider: firstSource.provider || '',
      });
      fetch(`/api/resolve-stream?${params.toString()}`, {
        cache: 'force-cache',
        signal: controller.signal,
      }).catch(() => {});
    }, 2800);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [nextEp?.episode_number, nextEp?.sources]);

  // Keyboard navigation: ArrowUp (Prev) / ArrowDown (Next)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        goToNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        goToPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrev]);

  // Touch Swipe Gestures for Mobile (TikTok / Reels swipe)
  const touchStartYRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current === null || touchStartXRef.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartYRef.current = null;
    touchStartXRef.current = null;

    // Minimum swipe threshold of 70px with dominant vertical movement
    if (Math.abs(deltaY) > 70 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
      if (deltaY < 0) {
        // Swiped UP -> Next Episode
        goToNext();
      } else {
        // Swiped DOWN -> Previous Episode
        goToPrev();
      }
    }
  };

  // Chunking for large episode lists (50 episodes per tab: 1-50, 51-100...)
  const CHUNK_SIZE = 50;
  const totalChunks = Math.max(1, Math.ceil(sortedEpisodes.length / CHUNK_SIZE));
  const activeChunkIndex = Math.floor(Math.max(0, activeEpNum - 1) / CHUNK_SIZE);
  const [selectedChunk, setSelectedChunk] = useState<number>(activeChunkIndex);

  // Sync tab chunk when active episode changes
  useEffect(() => {
    setSelectedChunk(activeChunkIndex);
  }, [activeChunkIndex]);

  const displayedEpisodes = useMemo(() => {
    if (sortedEpisodes.length <= CHUNK_SIZE) return sortedEpisodes;
    const start = selectedChunk * CHUNK_SIZE;
    return sortedEpisodes.slice(start, start + CHUNK_SIZE);
  }, [sortedEpisodes, selectedChunk]);

  const displayTitle = cleanMediaTitle(media.title);
  const backdropUrl = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.cover_image,
    media.title,
    'w1280',
    'banner'
  );

  const cleanDesc = cleanOverviewText(media.overview);

  return (
    <div
      className="relative w-full min-h-[100dvh] bg-[#070709] text-white flex flex-col justify-between overflow-x-hidden select-none pt-[72px] sm:pt-[92px] pb-3"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Cinematic Ambient Backdrop Blur */}
      {backdropUrl && (
        <div
          className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-35"
          style={{
            backgroundImage: `url(${backdropUrl})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(60px) saturate(160%)',
            transform: 'scale(1.15)',
          }}
        />
      )}
      <div className="fixed inset-0 bg-gradient-to-b from-black/80 via-black/85 to-[#070709] pointer-events-none z-0" />

      {/* TOP COMPACT HEADER / NAVIGATION (Mobile Only - Under Navbar) */}
      <header className="relative z-30 w-full px-3 py-1.5 flex lg:hidden items-center justify-between border-b-0 bg-transparent backdrop-blur-none">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/seri/${media.slug}`}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 text-xs font-semibold transition-all cursor-pointer min-h-[44px] min-w-[44px] justify-center shrink-0"
            aria-label="Dizi Detayına Dön"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden xs:inline">Detay</span>
          </Link>

          <h1 className="text-xs sm:text-sm font-bold text-white/90 truncate max-w-[200px]">
            {displayTitle}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-xs text-white/70 shrink-0">
          <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/10 font-bold text-white">
            {activeEpNum}. Bölüm
          </span>
          <span className="text-white/40">/</span>
          <span>{sortedEpisodes.length || media.episode_count || 1}</span>
        </div>
      </header>

      {/* MAIN VIEWPORT LAYOUT */}
      <main className="relative z-10 w-full flex-1 flex flex-col lg:flex-row items-center justify-center max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-2 sm:py-4 gap-4 lg:gap-8">
        {/* DESKTOP LEFT: Vertical Nav Arrows (ArrowUp / ArrowDown) */}
        <aside className="hidden lg:flex flex-col items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={goToPrev}
            disabled={!prevEp}
            aria-label="Önceki Bölüm (Yukarı Ok)"
            className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              prevEp
                ? 'bg-white/10 hover:bg-white/20 text-white border-white/15 hover:scale-105 active:scale-95 shadow-lg'
                : 'bg-white/[0.03] text-white/20 border-white/5 cursor-not-allowed'
            }`}
          >
            <ChevronUp className="w-5 h-5" />
            <span className="text-[9px] font-mono font-bold">Önceki</span>
          </button>

          <div className="w-px h-8 bg-white/10" />

          <button
            type="button"
            onClick={goToNext}
            disabled={!nextEp}
            aria-label="Sonraki Bölüm (Aşağı Ok)"
            className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer border ${
              nextEp
                ? 'bg-gradient-to-b from-[#E50914] to-rose-600 hover:from-red-600 hover:to-rose-700 text-white border-red-500/40 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(229,9,20,0.4)]'
                : 'bg-white/[0.03] text-white/20 border-white/5 cursor-not-allowed'
            }`}
          >
            <ChevronDown className="w-5 h-5" />
            <span className="text-[9px] font-mono font-bold">Sonraki</span>
          </button>
        </aside>

        {/* CENTER: 9:16 VERTICAL NETFLIX PLAYER */}
        <section className="relative w-full max-w-[390px] sm:max-w-[420px] lg:max-w-[440px] flex flex-col items-center justify-center shrink-0">
          <div className="relative w-full aspect-[9/16] max-h-[calc(100dvh-196px)] lg:max-h-[calc(100dvh-116px)] rounded-2xl sm:rounded-3xl overflow-hidden bg-black shadow-[0_20px_60px_rgba(0,0,0,0.9)] border border-white/15">
            <NetflixPlayer
              variant="vertical"
              media={media}
              episodes={episodes}
              isLoadingEpisodes={episodes.length === 0}
              currentSeason={currentSeason}
              currentEpisode={activeEpNum}
              onSelectEpisode={(s, ep) => handleGoToEpisode(ep)}
              onNextEpisode={goToNext}
              onPrevEpisode={goToPrev}
              selectedSourceIdx={selectedSourceIdx}
              onSelectSourceIdx={(idx) => {
                setSelectedSourceIdx(idx);
                if (onSelectSourceIdx) onSelectSourceIdx(idx);
              }}
              onSourceDead={onSourceDead}
              ambientLightingEnabled={ambientLightingEnabled}
              onToggleAmbientLighting={onToggleAmbientLighting}
              autoNextEnabled={autoNextEnabled}
              onToggleAutoNext={onToggleAutoNext}
              hasRail={false}
            />
          </div>

          {/* MOBILE ONLY: Bottom Glass Quick Bar (Eliminates video overlay & subtitle collisions!) */}
          <div className="lg:hidden w-full max-w-[390px] mt-2.5 px-1 flex items-center justify-between gap-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-xl">
            {/* Prev Ep */}
            <button
              type="button"
              onClick={goToPrev}
              disabled={!prevEp}
              aria-label="Önceki Bölüm"
              className={`h-11 px-3 rounded-xl flex items-center justify-center gap-1 font-mono text-xs font-bold transition-all min-h-[44px] min-w-[44px] cursor-pointer ${
                prevEp
                  ? 'bg-white/10 hover:bg-white/20 text-white active:scale-95 border border-white/10'
                  : 'bg-white/[0.03] text-white/20 border border-white/5 cursor-not-allowed'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden xs:inline">Önceki</span>
            </button>

            {/* Episodes bottom sheet trigger */}
            <button
              type="button"
              onClick={() => setShowMobileEpisodesSheet(true)}
              aria-label="Bölümler Listesi"
              className="flex-1 h-11 px-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 border border-white/10 text-white flex items-center justify-center gap-1.5 font-mono text-xs font-bold transition-all min-h-[44px] cursor-pointer"
            >
              <List className="w-4 h-4 text-amber-300" />
              <span>Bölüm: {activeEpNum}/{sortedEpisodes.length || 1}</span>
            </button>

            {/* Sources sheet trigger */}
            {availableSources.length > 1 && (
              <button
                type="button"
                onClick={() => setShowMobileSourcesSheet(true)}
                aria-label="Kaynak Seçimi"
                className="h-11 px-3 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 border border-white/10 text-white flex items-center justify-center gap-1.5 font-mono text-xs font-bold transition-all min-h-[44px] min-w-[44px] cursor-pointer"
              >
                <Layers className="w-4 h-4 text-sky-400" />
                <span className="hidden xs:inline">Kaynak</span>
              </button>
            )}

            {/* Next Ep */}
            <button
              type="button"
              onClick={goToNext}
              disabled={!nextEp}
              aria-label="Sonraki Bölüm"
              className={`h-11 px-3 rounded-xl flex items-center justify-center gap-1 font-mono text-xs font-bold transition-all min-h-[44px] min-w-[44px] cursor-pointer ${
                nextEp
                  ? 'bg-gradient-to-r from-[#E50914] to-rose-600 hover:from-red-600 hover:to-rose-700 text-white active:scale-95 shadow-[0_0_12px_rgba(229,9,20,0.5)] border border-red-500/40'
                  : 'bg-white/[0.03] text-white/20 border border-white/5 cursor-not-allowed'
              }`}
            >
              <span className="hidden xs:inline">Sonraki</span>
              <ChevronDown className="w-4 h-4 -rotate-90" />
            </button>
          </div>
        </section>

        {/* DESKTOP RIGHT: Elegant Glass Side Panel (Meta, Sources, 1..N Episode Grid) */}
        <section className="hidden lg:flex flex-col w-full max-w-sm h-[calc(100dvh-116px)] max-h-[calc(100dvh-116px)] rounded-3xl bg-white/[0.04] backdrop-blur-2xl border border-white/10 p-5 overflow-hidden shadow-2xl">
          {/* Header & Meta */}
          <div className="pb-4 border-b border-white/[0.08]">
            {/* Desktop Back to Detail Link */}
            <div className="mb-3">
              <Link
                href={`/seri/${media.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white/80 hover:text-white text-xs font-semibold transition-all border border-white/10 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Dizi Detayına Dön</span>
              </Link>
            </div>

            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 border border-amber-400/30 text-amber-300">
                <Sparkles className="w-2.5 h-2.5" />
                <span>Kısa Drama</span>
              </span>
              <span className="text-[11px] font-mono text-white/50">
                Toplam {sortedEpisodes.length} Bölüm
              </span>
            </div>
            <h2 className="text-base font-extrabold text-white leading-tight mb-1">
              {displayTitle}
            </h2>
            {cleanDesc && (
              <p
                onClick={() => setIsOverviewExpanded((prev) => !prev)}
                className={`text-xs text-white/60 leading-relaxed cursor-pointer hover:text-white/80 transition-colors ${
                  isOverviewExpanded ? '' : 'line-clamp-2'
                }`}
                title="Açmak için tıklayın"
              >
                {cleanDesc}
              </p>
            )}
          </div>

          {/* Source Selector (Pill / Custom select) */}
          {availableSources.length > 1 && (
            <div className="py-3.5 border-b border-white/[0.08]">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-2 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-sky-400" />
                <span>Yayın Kaynağı ({availableSources.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableSources.map((s, idx) => {
                  const isSelected = selectedSourceIdx === idx;
                  return (
                    <button
                      key={`src-pill-${idx}`}
                      type="button"
                      onClick={() => setSelectedSourceIdx(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                          : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {s.source_name || `Kaynak ${idx + 1}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Episode Range Tabs (e.g. 1-50, 51-100) if > 50 episodes */}
          {totalChunks > 1 && (
            <div className="py-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              {Array.from({ length: totalChunks }, (_, i) => {
                const start = i * CHUNK_SIZE + 1;
                const end = Math.min((i + 1) * CHUNK_SIZE, sortedEpisodes.length);
                const isSelected = selectedChunk === i;
                return (
                  <button
                    key={`chunk-tab-${i}`}
                    type="button"
                    onClick={() => setSelectedChunk(i)}
                    className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-white text-black shadow-md'
                        : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {start}-{end}
                  </button>
                );
              })}
            </div>
          )}

          {/* Compact Numbered Episode Grid (1..N) */}
          <div className="flex-1 overflow-y-auto pr-1 mt-2.5 no-scrollbar">
            <div className="grid grid-cols-5 gap-2">
              {displayedEpisodes.map((ep) => {
                const isCurrent = ep.episode_number === activeEpNum;
                const epProg = getEpisodeProgress(
                  progressMap[media.id],
                  media.id,
                  1,
                  ep.episode_number
                );
                const isWatched = epProg.isWatched;

                return (
                  <button
                    key={`ep-grid-btn-${ep.episode_number}`}
                    type="button"
                    onClick={() => handleGoToEpisode(ep.episode_number)}
                    className={`h-11 rounded-xl text-xs font-mono font-bold flex flex-col items-center justify-center transition-all cursor-pointer relative border ${
                      isCurrent
                        ? 'bg-gradient-to-tr from-[#E50914] to-rose-600 text-white border-red-400 shadow-[0_0_14px_rgba(229,9,20,0.5)] scale-105 z-10'
                        : isWatched
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                    }`}
                  >
                    <span>{ep.episode_number}</span>
                    {isWatched && !isCurrent && (
                      <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* MOBILE BOTTOM SHEET FOR EPISODES (Animated with framer-motion) */}
      <AnimatePresence>
        {showMobileEpisodesSheet && (
          <div className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileEpisodesSheet(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
            />

            {/* Bottom Sheet Modal */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative z-10 w-full max-h-[80dvh] rounded-t-3xl bg-[#111114] border-t border-white/15 p-5 flex flex-col shadow-2xl"
            >
              {/* Grab handle */}
              <div className="w-12 h-1 rounded-full bg-white/25 mx-auto mb-4" />

              {/* Sheet Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-sm font-bold text-white">Bölüm Seç</h3>
                  <p className="text-[11px] font-mono text-white/50">
                    Toplam {sortedEpisodes.length} Bölüm
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileEpisodesSheet(false)}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Chunk Tabs if > 50 */}
              {totalChunks > 1 && (
                <div className="py-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                  {Array.from({ length: totalChunks }, (_, i) => {
                    const start = i * CHUNK_SIZE + 1;
                    const end = Math.min((i + 1) * CHUNK_SIZE, sortedEpisodes.length);
                    const isSelected = selectedChunk === i;
                    return (
                      <button
                        key={`mob-chunk-${i}`}
                        type="button"
                        onClick={() => setSelectedChunk(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                          isSelected
                            ? 'bg-white text-black shadow-md'
                            : 'bg-white/5 text-white/60 hover:text-white'
                        }`}
                      >
                        {start}-{end}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Episode Grid */}
              <div className="flex-1 overflow-y-auto mt-3 pr-1">
                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                  {displayedEpisodes.map((ep) => {
                    const isCurrent = ep.episode_number === activeEpNum;
                    const epProg = getEpisodeProgress(
                      progressMap[media.id],
                      media.id,
                      1,
                      ep.episode_number
                    );
                    const isWatched = epProg.isWatched;

                    return (
                      <button
                        key={`mob-ep-${ep.episode_number}`}
                        type="button"
                        onClick={() => handleGoToEpisode(ep.episode_number)}
                        className={`h-11 rounded-xl text-xs font-mono font-bold flex flex-col items-center justify-center transition-all cursor-pointer relative border ${
                          isCurrent
                            ? 'bg-gradient-to-tr from-[#E50914] to-rose-600 text-white border-red-400 shadow-[0_0_12px_rgba(229,9,20,0.6)]'
                            : isWatched
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                            : 'bg-white/[0.05] border-white/10 text-white/80'
                        }`}
                      >
                        <span>{ep.episode_number}</span>
                        {isWatched && !isCurrent && (
                          <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MOBILE BOTTOM SHEET FOR SOURCES (Animated) */}
      <AnimatePresence>
        {showMobileSourcesSheet && (
          <div className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileSourcesSheet(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="relative z-10 w-full rounded-t-3xl bg-[#111114] border-t border-white/15 p-5 flex flex-col shadow-2xl"
            >
              <div className="w-12 h-1 rounded-full bg-white/25 mx-auto mb-4" />
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <h3 className="text-sm font-bold text-white">Yayın Kaynağı Seç</h3>
                <button
                  type="button"
                  onClick={() => setShowMobileSourcesSheet(false)}
                  className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center cursor-pointer"
                  aria-label="Kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-2 mt-4">
                {availableSources.map((s, idx) => {
                  const isSelected = selectedSourceIdx === idx;
                  return (
                    <button
                      key={`mob-src-${idx}`}
                      type="button"
                      onClick={() => {
                        setSelectedSourceIdx(idx);
                        setShowMobileSourcesSheet(false);
                      }}
                      className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors border ${
                        isSelected
                          ? 'bg-sky-500/20 text-sky-300 border-sky-400/40 font-bold'
                          : 'bg-white/5 text-white/80 border-white/10'
                      }`}
                    >
                      <span>{s.source_name || `Kaynak ${idx + 1}`}</span>
                      {isSelected && <Check className="w-4 h-4 text-sky-400" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Dedicated Short Drama Detail View for /seri/[slug]
 * Renders a sleek 9:16 poster, "KISA DRAMA" badge, 1..N numbered episode grid,
 * and skips broken/empty cast blocks.
 */
export function ShortsDetailClient({
  media,
  episodes = [],
}: {
  media: MediaItem;
  episodes: EpisodeData[];
}) {
  const [loadedEpisodes, setLoadedEpisodes] = useState<EpisodeData[]>(episodes);

  useEffect(() => {
    if (episodes && episodes.length > 0) {
      setLoadedEpisodes(episodes);
      return;
    }
    let active = true;
    fetch(`/api/sources/${media.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.episodes && Array.isArray(d.episodes) && d.episodes.length > 0) {
          setLoadedEpisodes(d.episodes);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [media.id, episodes]);

  const sortedEpisodes = useMemo(() => {
    if (loadedEpisodes && loadedEpisodes.length > 0) {
      return [...loadedEpisodes].sort((a, b) => a.episode_number - b.episode_number);
    }
    const count = media.episode_count || 0;
    if (count > 0) {
      return Array.from({ length: count }, (_, i) => ({
        id: -(i + 1),
        season_number: 1,
        episode_number: i + 1,
        episode_name: `${i + 1}. Bölüm`,
        episode_type: 'bolum' as const,
        sources: [],
      })) as EpisodeData[];
    }
    return [];
  }, [loadedEpisodes, media.episode_count]);

  const CHUNK_SIZE = 50;
  const totalChunks = Math.max(1, Math.ceil(sortedEpisodes.length / CHUNK_SIZE));
  const [selectedChunk, setSelectedChunk] = useState(0);

  const displayedEpisodes = useMemo(() => {
    if (sortedEpisodes.length <= CHUNK_SIZE) return sortedEpisodes;
    const start = selectedChunk * CHUNK_SIZE;
    return sortedEpisodes.slice(start, start + CHUNK_SIZE);
  }, [sortedEpisodes, selectedChunk]);

  const displayTitle = cleanMediaTitle(media.title);
  const cleanDesc = cleanOverviewText(media.overview);
  const hasDistinctNativeTitle = !!(
    media.native_title &&
    cleanMediaTitle(media.native_title).toLowerCase() !== displayTitle.toLowerCase()
  );

  const posterUrl = getProxiedImageUrl(
    media.cover_image,
    media.poster_fallback_url || null,
    media.title,
    'w500',
    'poster',
    media.tmdb_id,
    'tv',
    media.release_year,
    media.native_title,
    media.id
  );
  const backdropUrl = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.cover_image,
    media.title,
    'w1280',
    'banner'
  );

  return (
    <div className="relative min-h-screen bg-[#070709] text-white pt-24 sm:pt-28 pb-16 overflow-x-hidden">
      {/* Blurred Cinematic Backdrop */}
      {backdropUrl && (
        <div
          className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-30"
          style={{
            backgroundImage: `url(${backdropUrl})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(70px) saturate(160%)',
            transform: 'scale(1.2)',
          }}
        />
      )}
      <div className="fixed inset-0 bg-gradient-to-b from-black/85 via-black/90 to-[#070709] pointer-events-none z-0" />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6">
        {/* HERO SECTION */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-10 pt-4 pb-8">
          {/* Responsive Vertical Poster (Single Badge on Meta, none duplicated on poster) */}
          <div className="w-36 sm:w-52 md:w-60 aspect-[2/3] sm:aspect-[9/16] rounded-2xl sm:rounded-3xl overflow-hidden bg-black/60 border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.9)] shrink-0 relative group">
            <img
              src={posterUrl}
              alt={displayTitle}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>

          {/* Details & Actions */}
          <div className="flex-1 flex flex-col text-center md:text-left">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2.5">
              <span className="px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-gradient-to-r from-amber-500/80 to-rose-500/80 text-white border border-white/20 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                Kısa Drama
              </span>
              {media.country_code && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-xs font-semibold">
                  <CountryFlag code={media.country_code} size="sm" />
                  <span>{media.country_code}</span>
                </span>
              )}
              {media.release_year && (
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-xs font-mono text-white/70">
                  {media.release_year}
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-400/30 text-xs font-mono text-sky-300">
                {sortedEpisodes.length} Bölüm
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-2">
              {displayTitle}
            </h1>

            {hasDistinctNativeTitle && (
              <p className="text-xs sm:text-sm text-white/50 font-medium mb-4">
                {media.native_title}
              </p>
            )}

            {cleanDesc && (
              <p className="text-xs sm:text-sm text-white/75 leading-relaxed max-w-2xl mb-6 line-clamp-3 hover:line-clamp-none cursor-pointer transition-all" title="Açmak için tıklayın">
                {cleanDesc}
              </p>
            )}

            {/* Quick Watch Button */}
            <div className="flex items-center justify-center md:justify-start gap-3 pt-2">
              <Link
                href={`/seri/${media.slug}/1`}
                className="px-6 py-3 rounded-full bg-gradient-to-r from-[#E50914] to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-bold text-sm flex items-center gap-2 shadow-[0_0_24px_rgba(229,9,20,0.5)] transition-all active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>1. Bölümü İzle</span>
              </Link>
            </div>
          </div>
        </div>

        {/* EPISODE GRID SECTION (1..N Compact numbered boxes) */}
        <section className="mt-8 pt-8 border-t border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2.5">
              <Film className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg sm:text-xl font-bold text-white">
                Bölümler
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-xs font-mono text-white/70">
                {sortedEpisodes.length}
              </span>
            </div>

            {/* Range Tabs if > 50 */}
            {totalChunks > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {Array.from({ length: totalChunks }, (_, i) => {
                  const start = i * CHUNK_SIZE + 1;
                  const end = Math.min((i + 1) * CHUNK_SIZE, sortedEpisodes.length);
                  const isSelected = selectedChunk === i;
                  return (
                    <button
                      key={`detail-chunk-${i}`}
                      type="button"
                      onClick={() => setSelectedChunk(i)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-white text-black shadow-md'
                          : 'bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {start}-{end}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Compact 1..N Numbered Grid */}
          <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-12 gap-2">
            {displayedEpisodes.map((ep) => (
              <Link
                key={`detail-ep-${ep.episode_number}`}
                href={`/seri/${media.slug}/${ep.episode_number}`}
                className="h-11 rounded-xl bg-white/[0.05] hover:bg-white/15 border border-white/10 hover:border-amber-400/40 text-white font-mono font-bold text-sm flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-sm min-h-[44px]"
              >
                <span>{ep.episode_number}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
