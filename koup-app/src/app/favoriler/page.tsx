'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Heart,
  Sparkles,
  Tv,
  Film,
  Search,
  Compass,
  LogIn,
  X,
  ArrowUpDown,
  Clock,
  Star,
  ArrowDownAZ,
} from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';
import { supabase, MediaItem } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import Pagination from '@/components/Pagination';

type ContentTypeFilter = 'ALL' | 'drama' | 'anime' | 'movie';
type SortOption = 'default' | 'newest' | 'oldest' | 'rating' | 'title_asc';

const SORT_OPTIONS: SelectOption[] = [
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

export default function FavorilerPage() {
  const user = useKoUpSelector((s) => s.user);
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const [activeType, setActiveType] = useState<ContentTypeFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 36;
  const [favoriteMedia, setFavoriteMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Load user's favorite media items from progressMap
  useEffect(() => {
    let isMounted = true;
    async function loadFavorites() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const favIds = Object.keys(progressMap)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0 && progressMap[n]?.is_favorite);

      if (favIds.length === 0) {
        if (isMounted) {
          setFavoriteMedia([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('media')
          .select('*')
          .in('id', favIds);

        if (!error && data && isMounted) {
          setFavoriteMedia(data as MediaItem[]);
        }
      } catch (err) {
        console.error('Failed to load favorite media:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadFavorites();
    return () => {
      isMounted = false;
    };
  }, [user, progressMap]);

  // Compute type counts
  const typeCounts = useMemo(() => {
    const counts = {
      ALL: 0,
      drama: 0,
      anime: 0,
      movie: 0,
    };

    favoriteMedia.forEach((m) => {
      if (!progressMap[m.id]?.is_favorite) return;
      counts.ALL++;
      const t = (m.content_type || '').toLowerCase();
      if (t === 'anime') counts.anime++;
      else if (t === 'movie' || t === 'film') counts.movie++;
      else counts.drama++;
    });

    return counts;
  }, [favoriteMedia, progressMap]);

  // Filtered & sorted media list
  const filteredMedia = useMemo(() => {
    const list = favoriteMedia.filter((item) => {
      const prog = progressMap[item.id];
      if (!prog?.is_favorite) return false;

      if (activeType !== 'ALL') {
        const itemType = (item.content_type || '').toLowerCase();
        if (
          activeType === 'drama' &&
          itemType !== 'drama' &&
          itemType !== 'series' &&
          itemType !== 'dizi'
        ) {
          return false;
        }
        if (activeType === 'anime' && itemType !== 'anime') {
          return false;
        }
        if (activeType === 'movie' && itemType !== 'movie' && itemType !== 'film') {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = (item.title || '').toLowerCase().includes(q);
        const matchOriginal = (
          (item as any).original_title ||
          item.native_title ||
          ''
        )
          .toLowerCase()
          .includes(q);
        if (!matchTitle && !matchOriginal) return false;
      }

      return true;
    });

    const sorted = [...list];
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
    } else {
      // default: most recently updated first
      sorted.sort((a, b) => {
        const tA = new Date(progressMap[a.id]?.updated_at || 0).getTime();
        const tB = new Date(progressMap[b.id]?.updated_at || 0).getTime();
        return tB - tA;
      });
    }

    return sorted;
  }, [favoriteMedia, activeType, searchQuery, sortBy, progressMap]);

  const paginatedMedia = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredMedia.slice(start, start + PAGE_SIZE);
  }, [filteredMedia, currentPage]);

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(244,63,94,0.18)] backdrop-blur-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-rose-500/10 border border-rose-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(244,63,94,0.25)]">
            <Heart className="w-10 h-10 text-rose-400 fill-rose-400/20" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Favori Serilerim
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              Favorilerinize eklediğiniz dizi, anime ve filmleri görüntülemek ve yönetmek için lütfen giriş yapın.
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
          Favori Serilerim
        </h1>
      </div>

      {/* Metric Breakdown Cards (Filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            id: 'ALL' as const,
            label: 'Toplam Favori',
            count: typeCounts.ALL,
            icon: Heart,
            color: 'text-rose-400',
          },
          {
            id: 'drama' as const,
            label: 'Diziler',
            count: typeCounts.drama,
            icon: Tv,
            color: 'text-sky-400',
          },
          {
            id: 'anime' as const,
            label: 'Animeler',
            count: typeCounts.anime,
            icon: Sparkles,
            color: 'text-purple-400',
          },
          {
            id: 'movie' as const,
            label: 'Filmler',
            count: typeCounts.movie,
            icon: Film,
            color: 'text-amber-400',
          },
        ].map((item) => {
          const Icon = item.icon;
          const isSelected = activeType === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                triggerSound('click');
                setActiveType(item.id);
                setCurrentPage(1);
              }}
              className={`p-4 rounded-3xl border transition-all cursor-pointer text-left select-none ${
                isSelected
                  ? 'bg-rose-500/10 border-rose-500/50 shadow-[0_0_24px_rgba(244,63,94,0.22)] ring-1 ring-rose-400/30'
                  : 'bg-[#0f0f12]/90 border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-mono font-medium ${isSelected ? 'text-white' : 'text-white/50'}`}>
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

      {/* Sort and Search Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="w-full sm:w-56 shrink-0">
          <CustomSelect
            value={sortBy}
            onChange={(val) => {
              triggerSound('click');
              setSortBy((val as SortOption) || 'default');
              setCurrentPage(1);
            }}
            options={SORT_OPTIONS}
            variant="glass"
            size="sm"
            searchable={false}
            aria-label="Sıralama seçin"
            className="w-full"
          />
        </div>

        <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] min-w-[220px] flex-1 sm:flex-initial">
          <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Favorilerde ara..."
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

      {/* Main Content Grid */}
      {isLoading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-rose-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(244,63,94,0.4)]" />
            <p className="text-xs text-white/50 font-mono tracking-wider">
              Favorileriniz yükleniyor...
            </p>
          </div>
        </div>
      ) : filteredMedia.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-400/20 flex items-center justify-center mx-auto text-rose-400">
            <Heart className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aradığınız kriterde favori yapım bulunamadı'
                : 'Henüz favorilerinize eklediğiniz bir yapım yok'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              {searchQuery.trim()
                ? 'Farklı bir arama terimi deneyebilir veya filtreleri sıfırlayabilirsiniz.'
                : 'Dizi, anime ve film kartlarındaki veya seri detay sayfasındaki kalp ikonuna tıklayarak favorilerinize ekleyebilirsiniz.'}
            </p>
          </div>
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-md"
          >
            <Compass className="w-4 h-4" />
            <span>Yapımları Keşfet</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
          {paginatedMedia.map((m, idx) => (
            <div
              key={m.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_340px]"
            >
              <AccordionMediaCard item={m} priority={idx < 6} fluidWidth={true} />
            </div>
          ))}
        </div>
      )}

      {!isLoading && filteredMedia.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredMedia.length}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="favori yapımdan"
          scrollToOffset={300}
        />
      )}
    </div>
  );
}
