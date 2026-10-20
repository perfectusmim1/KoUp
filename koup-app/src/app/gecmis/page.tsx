'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Clock,
  Play,
  Search,
  Compass,
  LogIn,
  CheckCircle2,
  Film,
  X,
} from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';
import {
  getProxiedImageUrl,
  getEpisodeProgressStats,
  cleanMediaTitle,
} from '@/lib/supabase';
import Pagination from '@/components/Pagination';

type HistoryFilter = 'ALL' | 'in_progress' | 'completed';

export default function WatchHistoryPage() {
  const user = useKoUpSelector((s) => s.user);
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<HistoryFilter>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 24;

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Collect all history items from progressMap that have media or progress
  const allHistoryItems = useMemo(() => {
    return Object.values(progressMap)
      .filter(
        (item) =>
          item.media ||
          item.status === 'watching' ||
          item.status === 'completed' ||
          (item.watched_episodes && item.watched_episodes.length > 0)
      )
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [progressMap]);

  // Filtered list
  const filteredHistory = useMemo(() => {
    return allHistoryItems.filter((item) => {
      const media = item.media;
      const stats = getEpisodeProgressStats(item, media);

      // Filter by progress status
      if (filterType === 'in_progress') {
        if (stats.isAllWatched || item.status === 'completed') return false;
      } else if (filterType === 'completed') {
        if (!stats.isAllWatched && item.status !== 'completed') return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (media?.title || '').toLowerCase().includes(q);
        const matchEp = (item.last_episode_title || '').toLowerCase().includes(q);
        if (!matchTitle && !matchEp) return false;
      }

      return true;
    });
  }, [allHistoryItems, filterType, searchQuery]);

  // Paginated slice for current page
  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredHistory.slice(start, start + PAGE_SIZE);
  }, [filteredHistory, currentPage]);

  // If user is not logged in
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Clock className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              İzleme Geçmişim
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              İzlediğiniz bölümleri senkronize etmek ve geçmişinizi görüntülemek için lütfen giriş yapın.
            </p>
          </div>

          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            İzleme Geçmişim
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Yeni İçerik Keşfet</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          {[
            { id: 'ALL' as const, label: `Tüm Geçmiş (${allHistoryItems.length})` },
            { id: 'in_progress' as const, label: 'Kaldığım Yerden Devam Et' },
            { id: 'completed' as const, label: 'Tamamlananlar' },
          ].map((flt) => {
            const active = filterType === flt.id;
            return (
              <button
                key={flt.id}
                onClick={() => {
                  triggerSound('click');
                  setFilterType(flt.id);
                  setCurrentPage(1);
                }}
                className={`relative px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors duration-200 cursor-pointer shrink-0 ${
                  active
                    ? 'text-black'
                    : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="gecmis-filter-active-pill"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                    className="absolute inset-0 rounded-full bg-white shadow-md"
                  />
                )}
                <span className="relative z-10">{flt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Geçmişte yapım ara..."
            className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="text-white/40 hover:text-white transition-colors cursor-pointer"
              aria-label="Aramayı temizle"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid of History Cards */}
      {filteredHistory.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <Clock className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aramanıza uygun bir izleme kaydı bulunamadı'
                : 'Henüz izleme geçmişiniz bulunmuyor'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              Dizilerin bölümlerini izledikçe ve işaretledikçe sıradaki bölümleriniz otomatik olarak burada listelenecektir.
            </p>
          </div>
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-md"
          >
            <Compass className="w-4 h-4" />
            <span>Dizi & Anime Keşfet</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {paginatedHistory.map((item, idx) => {
            const media = item.media;
            const stats = getEpisodeProgressStats(item, media);
            const barPct = Math.max(
              stats.watchedCount > 0 ? 6 : 3,
              stats.progressPercent
            );

            const seriesUrl = media?.slug ? `/seri/${media.slug}` : `/seri/${item.media_id}`;
            const playUrl = media?.slug
              ? `/seri/${media.slug}/${stats.nextEpisode}?season=${stats.season}`
              : `/seri/${item.media_id}`;

            return (
              <div
                key={`history-${item.media_id}-${stats.season}-${stats.nextEpisode}-${idx}`}
                className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-4 sm:p-5 flex gap-4 hover:border-white/20 transition-[border-color] duration-200 group relative overflow-hidden shadow-xl [content-visibility:auto] [contain-intrinsic-size:auto_180px]"
              >
                {/* Poster image */}
                <Link
                  href={playUrl}
                  onClick={() => triggerSound('click')}
                  className="relative w-24 h-34 sm:w-28 sm:h-38 rounded-2xl overflow-hidden bg-black/60 shrink-0 border border-white/10 group-hover:border-white/25 transition-colors isolate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  {media?.cover_image ? (
                    <img
                      src={getProxiedImageUrl(media.cover_image, media.title)}
                      alt={media.title || 'Kapak'}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-200 ease-out"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30">
                      <Film className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 ease-out pointer-events-none">
                    <div className="w-10 h-10 rounded-full bg-black/85 border border-white/20 flex items-center justify-center text-white shadow-xl transition-transform duration-200 ease-out">
                      <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                    </div>
                  </div>
                </Link>

                {/* Content Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/70">
                        {stats.isFilm
                          ? 'FİLM'
                          : media?.content_type === 'anime'
                          ? 'ANİME'
                          : 'DİZİ'}
                      </span>
                      {stats.isAllWatched ? (
                        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Tamamlandı</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-sky-400 font-semibold">
                          {stats.isFilm
                            ? stats.resumePos > 60
                              ? `${Math.floor(stats.resumePos / 60)}/${Math.max(1, Math.floor(stats.resumeDur / 60))} Dk`
                              : 'İzleniyor'
                            : `${stats.watchedCount}/${stats.totalEpisodes} Bölüm`}
                        </span>
                      )}
                    </div>

                    <Link
                      href={seriesUrl}
                      onClick={() => triggerSound('click')}
                      className="block mt-1 text-sm sm:text-base font-bold text-white hover:text-sky-300 transition-colors truncate"
                    >
                      {cleanMediaTitle(media?.title) || `Yapım #${item.media_id}`}
                    </Link>

                    <div className="text-xs text-sky-400 font-mono font-semibold mt-0.5">
                      {stats.isAllWatched
                        ? stats.isFilm
                          ? 'Film Tamamlandı'
                          : `${stats.season}. Sezon · Tüm Bölümler İzlendi`
                        : stats.isFilm
                        ? 'Kaldığın Yerden Devam Et'
                        : `Sıradaki: ${stats.season}. Sezon · ${stats.nextEpisode}. Bölüm`}
                    </div>
                  </div>

                  <div className="space-y-2.5 mt-3">
                    {/* Episode Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-white/50">
                        <span>
                          {stats.isFilm
                            ? stats.isAllWatched
                              ? 'Film İzlendi'
                              : `${Math.floor(stats.resumePos / 60)} Dk İzlendi`
                            : `${stats.watchedCount} Bölüm İzlendi`}
                        </span>
                        <span>%{stats.progressPercent}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-sky-400 rounded-full transition-[width] duration-300"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Resume Action Button */}
                    <Link
                      href={playUrl}
                      onClick={() => triggerSound('click')}
                      className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors w-fit glow-white cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-black" />
                      <span>
                        {stats.isAllWatched
                          ? 'Tekrar İzle'
                          : stats.isFilm
                          ? 'Filme Devam Et'
                          : `${stats.nextEpisode}. Bölümden Devam Et`}
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {filteredHistory.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredHistory.length}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="izleme kaydından"
          scrollToOffset={240}
        />
      )}
    </div>
  );
}
