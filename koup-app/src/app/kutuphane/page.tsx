'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Library,
  Sparkles,
  Clock,
  CheckCircle2,
  Bookmark,
  PauseCircle,
  XCircle,
  Search,
  Compass,
  Tv,
  Film,
  LogIn,
  Trash2,
  X,
  ArrowUpDown,
  Star,
  ArrowDownAZ,
} from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';
import { supabase, MediaItem, cleanMediaTitle } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import Pagination from '@/components/Pagination';
import { usePillDragTracking } from '@/hooks/usePillDragTracking';

const CARD_STATUS_OPTIONS: SelectOption[] = [
  {
    value: 'watching',
    label: 'İzleniyor',
    icon: <Clock className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    value: 'completed',
    label: 'Tamamlandı',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    value: 'plan_to_watch',
    label: 'Planlanan',
    icon: <Bookmark className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    value: 'on_hold',
    label: 'Beklemede',
    icon: <PauseCircle className="w-3.5 h-3.5 text-purple-400" />,
  },
  {
    value: 'dropped',
    label: 'Bıraktım',
    icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
  },
];

type LibraryStatus = 'ALL' | 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
type ContentTypeFilter = 'ALL' | 'drama' | 'anime' | 'movie';
type SortOption = 'default' | 'newest' | 'oldest' | 'rating' | 'title_asc';

const LIBRARY_SORT_OPTIONS: SelectOption[] = [
  {
    value: 'default',
    label: 'Varsayılan Sıralama',
    icon: <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    value: 'newest',
    label: 'En Yeni Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    value: 'oldest',
    label: 'En Eski Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    value: 'rating',
    label: 'En Yüksek Puan',
    icon: <Star className="w-3.5 h-3.5 text-yellow-400" />,
  },
  {
    value: 'title_asc',
    label: 'İsme Göre (A-Z)',
    icon: <ArrowDownAZ className="w-3.5 h-3.5 text-purple-400" />,
  },
];

export default function KutuphanePage() {
  const user = useKoUpSelector((s) => s.user);
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const setLibraryStatus = useKoUpSelector((s) => s.setLibraryStatus);
  const removeFromLibrary = useKoUpSelector((s) => s.removeFromLibrary);
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);

  const [activeStatus, setActiveStatus] = useState<LibraryStatus>('ALL');
  const [activeType, setActiveType] = useState<ContentTypeFilter>('ALL');

  const { containerRef: typeTabsRef, dragProps: typeTabsDragProps } = usePillDragTracking<ContentTypeFilter>({
    activeTab: activeType,
    onTabChange: (newType) => {
      setActiveType(newType);
      setCurrentPage(1);
    },
    triggerSound,
  });
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 36;
  const [libraryMedia, setLibraryMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Load user's media items from progressMap
  useEffect(() => {
    let isMounted = true;
    async function loadLibrary() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const mediaIds = Object.keys(progressMap)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0 && progressMap[n]?.status);

      if (mediaIds.length === 0) {
        if (isMounted) {
          setLibraryMedia([]);
          setIsLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('media')
          .select('*')
          .in('id', mediaIds);

        if (!error && data && isMounted) {
          setLibraryMedia(data as MediaItem[]);
        }
      } catch (err) {
        console.error('Failed to load library media:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadLibrary();
    return () => {
      isMounted = false;
    };
  }, [user, progressMap]);

  // Compute status metrics
  const statusCounts = useMemo(() => {
    const counts = {
      ALL: 0,
      watching: 0,
      completed: 0,
      plan_to_watch: 0,
      on_hold: 0,
      dropped: 0,
    };

    let totalWithStatus = 0;
    libraryMedia.forEach((m) => {
      const prog = progressMap[m.id];
      const st = prog?.status as LibraryStatus | undefined;
      if (st && counts[st] !== undefined) {
        counts[st]++;
        totalWithStatus++;
      }
    });

    counts.ALL = totalWithStatus;
    return counts;
  }, [libraryMedia, progressMap]);

  // Filtered media list
  const filteredMedia = useMemo(() => {
    const filtered = libraryMedia.filter((item) => {
      const prog = progressMap[item.id];
      if (!prog?.status) return false;

      // 1. Status Filter
      if (activeStatus !== 'ALL') {
        if (prog?.status !== activeStatus) return false;
      }

      // 2. Type Filter
      if (activeType !== 'ALL') {
        const itemType = (item.content_type || '').toLowerCase();
        if (activeType === 'drama' && itemType !== 'drama' && itemType !== 'series' && itemType !== 'dizi') {
          return false;
        }
        if (activeType === 'anime' && itemType !== 'anime') {
          return false;
        }
        if (activeType === 'movie' && itemType !== 'movie' && itemType !== 'film') {
          return false;
        }
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (item.title || '').toLowerCase().includes(q);
        const matchOriginal = ((item as any).original_title || item.native_title || '').toLowerCase().includes(q);
        if (!matchTitle && !matchOriginal) return false;
      }

      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'newest') {
      sorted.sort((a, b) => {
        const tA = new Date(progressMap[a.id]?.updated_at || 0).getTime();
        const tB = new Date(progressMap[b.id]?.updated_at || 0).getTime();
        return tB - tA || b.id - a.id;
      });
    } else if (sortBy === 'oldest') {
      sorted.sort((a, b) => {
        const tA = new Date(progressMap[a.id]?.updated_at || 0).getTime();
        const tB = new Date(progressMap[b.id]?.updated_at || 0).getTime();
        return tA - tB || a.id - b.id;
      });
    } else if (sortBy === 'rating') {
      sorted.sort((a, b) => {
        const rA = Number(a.site_rating || a.mdl_rating || a.imdb_rating || 0);
        const rB = Number(b.site_rating || b.mdl_rating || b.imdb_rating || 0);
        return rB - rA;
      });
    } else if (sortBy === 'title_asc') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'tr'));
    }

    return sorted;
  }, [libraryMedia, activeStatus, activeType, searchQuery, sortBy, progressMap]);

  // Paginated slice for current page
  const paginatedMedia = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredMedia.slice(start, start + PAGE_SIZE);
  }, [filteredMedia, currentPage]);

  // If user is not logged in
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Library className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Kişisel Kütüphanem
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              İzlediğiniz, planladığınız ve bitirdiğiniz yapımları kaydetmek ve düzenlemek için lütfen giriş yapın.
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
      {/* Page Header */}
      <div className="pb-6 border-b border-white/[0.08]">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Kütüphanem
        </h1>
      </div>

      {/* Metric Breakdown Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            id: 'ALL' as const,
            label: 'Toplam Yapım',
            count: statusCounts.ALL,
            icon: Sparkles,
            color: 'text-white',
            activeClass: 'bg-white/[0.07] border-white/40 shadow-[0_4px_16px_rgba(255,255,255,0.06)]',
            activeLabel: 'text-white font-semibold',
          },
          {
            id: 'watching' as const,
            label: 'İzleniyor',
            count: statusCounts.watching,
            icon: Clock,
            color: 'text-sky-400',
            activeClass: 'bg-sky-500/[0.08] border-sky-400/60 shadow-[0_4px_16px_rgba(56,189,248,0.12)]',
            activeLabel: 'text-sky-300 font-semibold',
          },
          {
            id: 'completed' as const,
            label: 'Tamamlandı',
            count: statusCounts.completed,
            icon: CheckCircle2,
            color: 'text-emerald-400',
            activeClass: 'bg-emerald-500/[0.08] border-emerald-400/60 shadow-[0_4px_16px_rgba(16,185,129,0.12)]',
            activeLabel: 'text-emerald-300 font-semibold',
          },
          {
            id: 'plan_to_watch' as const,
            label: 'Planlanan',
            count: statusCounts.plan_to_watch,
            icon: Bookmark,
            color: 'text-amber-400',
            activeClass: 'bg-amber-500/[0.08] border-amber-400/60 shadow-[0_4px_16px_rgba(245,158,11,0.12)]',
            activeLabel: 'text-amber-300 font-semibold',
          },
          {
            id: 'on_hold' as const,
            label: 'Beklemede',
            count: statusCounts.on_hold,
            icon: PauseCircle,
            color: 'text-purple-400',
            activeClass: 'bg-purple-500/[0.08] border-purple-400/60 shadow-[0_4px_16px_rgba(168,85,247,0.12)]',
            activeLabel: 'text-purple-300 font-semibold',
          },
          {
            id: 'dropped' as const,
            label: 'Bıraktım',
            count: statusCounts.dropped,
            icon: XCircle,
            color: 'text-rose-400',
            activeClass: 'bg-rose-500/[0.08] border-rose-400/60 shadow-[0_4px_16px_rgba(244,63,94,0.12)]',
            activeLabel: 'text-rose-300 font-semibold',
          },
        ].map((item) => {
          const Icon = item.icon;
          const isSelected = activeStatus === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                triggerSound('click');
                setActiveStatus(item.id);
                setCurrentPage(1);
              }}
              className={`p-4 rounded-3xl border transition-all duration-200 cursor-pointer text-left select-none ${
                isSelected
                  ? item.activeClass
                  : 'bg-[#0f0f12]/90 border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-mono transition-colors ${isSelected ? item.activeLabel : 'text-white/50'}`}>
                  {item.label}
                </span>
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <div className="text-2xl font-black text-white mt-2 font-mono">
                {item.count}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        {/* Content Type Filter */}
        <div className="overflow-x-auto no-scrollbar pb-1 sm:pb-0 [-webkit-overflow-scrolling:touch] shrink-0 mx-auto sm:mx-0">
          <div
            ref={typeTabsRef}
            {...typeTabsDragProps}
            className="inline-flex w-max items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 select-none touch-pan-x cursor-pointer sm:cursor-grab sm:active:cursor-grabbing overflow-hidden"
          >
            {[
              {
                id: 'ALL' as const,
                label: 'Hepsi',
                icon: Compass,
                activePillClass:
                  'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
              },
              {
                id: 'drama' as const,
                label: 'Dizi',
                icon: Tv,
                activePillClass:
                  'bg-gradient-to-r from-blue-500 to-indigo-600 shadow-[0_0_18px_rgba(99,102,241,0.45)] border border-indigo-400/40',
              },
              {
                id: 'anime' as const,
                label: 'Anime',
                icon: Sparkles,
                activePillClass:
                  'bg-gradient-to-r from-purple-500 to-pink-600 shadow-[0_0_18px_rgba(168,85,247,0.45)] border border-purple-400/40',
              },
              {
                id: 'movie' as const,
                label: 'Film',
                icon: Film,
                activePillClass:
                  'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(245,158,11,0.45)] border border-amber-400/40',
              },
            ].map((tp) => {
              const Icon = tp.icon;
              const active = activeType === tp.id;

              return (
                <button
                  key={tp.id}
                  data-tab-id={tp.id}
                  type="button"
                  onClick={() => {
                    triggerSound('click');
                    setActiveType(tp.id);
                    setCurrentPage(1);
                  }}
                  className={`relative shrink-0 flex items-center gap-2 px-3.5 sm:px-4 h-9 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer select-none touch-manipulation ${
                    active
                      ? 'text-white font-extrabold'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="kutuphane-type-active-pill"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                      className={`absolute inset-0 rounded-xl ${tp.activePillClass} z-0 select-none pointer-events-none`}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10 pointer-events-none" />
                  <span className="relative z-10 pointer-events-none">{tp.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort & Search Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <div className="w-full sm:w-52 shrink-0">
            <CustomSelect
              value={sortBy}
              onChange={(val) => {
                triggerSound('click');
                setSortBy((val as SortOption) || 'default');
                setCurrentPage(1);
              }}
              options={LIBRARY_SORT_OPTIONS}
              variant="glass"
              size="sm"
              searchable={false}
              aria-label="Sıralama seçin"
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Kütüphanede ara..."
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
      </div>

      {/* Main Content Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5 pt-2 pb-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-2xl sm:rounded-3xl bg-white/[0.03] border border-white/[0.06] animate-pulse"
            />
          ))}
        </div>
      ) : filteredMedia.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <Library className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aradığınız kriterde yapım bulunamadı'
                : 'Bu filtrede henüz bir yapım bulunmuyor'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              {searchQuery.trim()
                ? 'Farklı bir arama terimi deneyebilir veya filtreleri sıfırlayabilirsiniz.'
                : 'Katalogdan dizi ve anime keşfederek kütüphanenize ekleyebilir veya durumlarını güncelleyebilirsiniz.'}
            </p>
          </div>
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-md"
          >
            <Compass className="w-4 h-4" />
            <span>Katalogdan Yapım Ekle</span>
          </Link>
        </div>
      ) : (
        <motion.div
          key={`kutuphane-grid-${activeType}-${activeStatus}-${searchQuery}-${sortBy}-${currentPage}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5"
        >
          {paginatedMedia.map((m, idx) => {
            const prog = progressMap[m.id];
            const currentStatus = prog?.status || 'watching';
            const watchedCount = prog?.watched_episodes?.length || 0;
            const totalEps = m.episode_count || 0;
            const isFilm = m.content_type === 'film' || m.content_type === 'movie';

            return (
              <div
                key={m.id}
                className="group relative flex flex-col rounded-2xl bg-[#0f0f12] border border-white/10 hover:border-white/25 overflow-hidden transition-[border-color,box-shadow] duration-200 shadow-lg hover:shadow-2xl"
              >
                {/* Poster & Direct Play */}
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-black/60">
                  <AccordionMediaCard item={m} fluidWidth={true} />
                </div>

                {/* Library Management Strip */}
                <div className="p-2.5 bg-[#0a0a0d] border-t border-white/[0.08] flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    {/* Status Dropdown */}
                    <div className="flex-1 min-w-0">
                      <CustomSelect
                        value={currentStatus}
                        allowDeselect={true}
                        onChange={(val) => {
                          triggerSound?.('click');
                          if (!val || val === currentStatus) {
                            setLibraryStatus(m, null);
                          } else {
                            setLibraryStatus(m, val as any);
                          }
                        }}
                        options={CARD_STATUS_OPTIONS}
                        variant="glass"
                        size="sm"
                        portal={true}
                        searchable={false}
                        direction="auto"
                        className="w-full"
                        triggerClassName="!py-1.5 !px-2.5 !rounded-xl !text-[11px] font-semibold w-full justify-between !bg-white/[0.06] hover:!bg-white/10 !border-white/10"
                      />
                    </div>

                    {/* Quick Remove from Library Button */}
                    <button
                      type="button"
                      onClick={async () => {
                        triggerSound?.('click');
                        const confirmed = await confirmDialog({
                          title: 'Kütüphaneden Kaldır',
                          message: `"${cleanMediaTitle(m.title)}" serisini kütüphanenizden ve izleme geçmişinizden kaldırmak istediğinize emin misiniz?`,
                          confirmText: 'Kaldır',
                          cancelText: 'Vazgeç',
                          isDestructive: true,
                          icon: 'trash',
                        });
                        if (confirmed) {
                          await removeFromLibrary(m.id);
                        }
                      }}
                      className="p-2 rounded-xl bg-white/[0.05] hover:bg-rose-500/20 text-white/40 hover:text-rose-300 border border-white/10 hover:border-rose-400/30 transition-colors cursor-pointer shrink-0"
                      aria-label="Kütüphaneden Kaldır"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Watched Episode Indicator */}
                  {isFilm ? (
                    <div className="flex items-center justify-between text-[10px] font-mono text-white/50 px-0.5">
                      <span>Tür:</span>
                      <span className="font-bold text-white/80">
                        {currentStatus === 'completed' || watchedCount > 0 ? 'İzlendi' : 'Film'}
                      </span>
                    </div>
                  ) : totalEps > 0 ? (
                    <div className="flex items-center justify-between text-[10px] font-mono text-white/50 px-0.5">
                      <span>İlerleme:</span>
                      <span className="font-bold text-white/80">
                        {watchedCount} / {totalEps} Bölüm
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {!isLoading && filteredMedia.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredMedia.length}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="yapımdan"
          scrollToOffset={300}
        />
      )}
    </div>
  );
}
