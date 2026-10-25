'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Sparkles,
  ChevronRight,
  Tv,
  Film,
  Flame,
  LayoutGrid,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  getProxiedImageUrl,
  cleanMediaTitle,
} from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import Pagination from '@/components/Pagination';

interface EpisodeItem {
  id: number;
  media_id: number;
  season_number: number;
  episode_number: number;
  episode_name: string | null;
  published_at: string | null;
  status: string;
  media?: MediaItem | null;
}

const PAGE_SIZE = 50;

const TYPE_FILTERS = [
  {
    id: 'ALL',
    label: 'Tümü',
    icon: LayoutGrid,
    activePillClass: 'bg-white shadow-[0_0_18px_rgba(255,255,255,0.35)]',
    activeTextClass: 'text-black font-extrabold',
  },
  {
    id: 'dizi',
    label: 'Diziler',
    icon: Tv,
    activePillClass: 'bg-sky-500 shadow-[0_0_20px_rgba(56,189,248,0.45)]',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'anime',
    label: 'Animeler',
    icon: Flame,
    activePillClass: 'bg-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.45)]',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'film',
    label: 'Filmler',
    icon: Film,
    activePillClass: 'bg-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.45)]',
    activeTextClass: 'text-white font-extrabold',
  },
];

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Yeni';
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    if (diffSec < 60) return 'Az önce';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} sa önce`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Dün';
    if (diffDays < 7) return `${diffDays} gün önce`;
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return 'Yeni';
  }
}

function RecentEpisodesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const initialPage = useMemo(() => {
    const p = Number(searchParams.get('page'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  }, [searchParams]);

  const initialType = useMemo(() => {
    const t = searchParams.get('tur');
    return t && ['dizi', 'anime', 'film'].includes(t) ? t : 'ALL';
  }, [searchParams]);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // In-memory caches for zero-latency pagination and tab navigation
  const pageCacheRef = useRef<Map<string, EpisodeItem[]>>(new Map());
  const countsCacheRef = useRef<Record<string, number>>({});

  // Sync state with URL params if changed externally
  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    setTypeFilter(initialType);
  }, [initialType]);

  // Fetch 50 episodes per page (ultra-fast indexed query decoupled from count)
  useEffect(() => {
    let isCancelled = false;
    const cacheKey = `${typeFilter}_p${currentPage}`;

    // 1. Instant render if cached
    if (pageCacheRef.current.has(cacheKey)) {
      setEpisodes(pageCacheRef.current.get(cacheKey)!);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // 2. Instant total count sync if cached
    if (typeof countsCacheRef.current[typeFilter] === 'number') {
      setTotalCount(countsCacheRef.current[typeFilter]);
    }

    async function fetchEpisodes() {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      try {
        let query = supabase
          .from('episodes')
          .select(
            `
            id,
            media_id,
            season_number,
            episode_number,
            episode_name,
            published_at,
            status,
            media:media_id (
              id,
              slug,
              title,
              cover_image,
              backdrop_image,
              content_type,
              tmdb_id
            )
          `
          )
          .eq('status', 'published')
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false });

        if (typeFilter !== 'ALL') {
          query = query.eq('content_type', typeFilter);
        }

        // Fast data range query
        const { data, error } = await query.range(from, to);

        if (error) {
          console.error('[Son Eklenenler] Yükleme hatası:', error.message);
          if (!isCancelled) {
            setEpisodes([]);
          }
        } else if (!isCancelled) {
          const list = ((data as any[]) || [])
            .map((item) => ({
              ...item,
              media: item.media as MediaItem | null,
            }))
            .filter((item) => item.media);

          pageCacheRef.current.set(cacheKey, list);
          setEpisodes(list);
        }
      } catch (err) {
        console.error('[Son Eklenenler] Beklenmeyen hata:', err);
        if (!isCancelled) {
          setEpisodes([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }

      // Fast non-blocking count query if not in cache
      if (typeof countsCacheRef.current[typeFilter] !== 'number') {
        try {
          let countQuery = supabase
            .from('episodes')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'published');

          if (typeFilter !== 'ALL') {
            countQuery = countQuery.eq('content_type', typeFilter);
          }

          const { count, error: countErr } = await countQuery;
          if (!countErr && typeof count === 'number' && !isCancelled) {
            countsCacheRef.current[typeFilter] = count;
            setTotalCount(count);
          }
        } catch {
          // Count failure does not affect cards display
        }
      }
    }

    fetchEpisodes();

    return () => {
      isCancelled = true;
    };
  }, [currentPage, typeFilter]);

  const updateUrlParams = (newPage: number, newType: string) => {
    const params = new URLSearchParams();
    if (newPage > 1) params.set('page', String(newPage));
    if (newType !== 'ALL') params.set('tur', newType);
    const queryString = params.toString();
    router.push(queryString ? `/son-eklenenler?${queryString}` : '/son-eklenenler');
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    updateUrlParams(page, typeFilter);
  };

  const handleTypeChange = (typeId: string) => {
    triggerSound?.('click');
    setTypeFilter(typeId);
    setCurrentPage(1);
    updateUrlParams(1, typeId);
  };

  return (
    <div className="pt-24 sm:pt-28 pb-20 max-w-[1720px] mx-auto px-4 sm:px-6 md:px-10 lg:px-14 space-y-6 sm:space-y-8">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-white/40">
        <Link href="/" className="hover:text-white transition-colors">
          Ana Sayfa
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-white font-medium">Son Eklenen Bölümler</span>
      </nav>

      {/* Header Banner Card (Cinema Dark Glass Design) */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 md:p-10 border border-white/10 shadow-2xl relative overflow-hidden">
        {/* Subtle Background Glow Accent */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
              Son Eklenen Bölümler
            </h1>
          </div>

          {/* Content Type Filter Pills */}
          <div className="inline-flex w-max items-center gap-1.5 sm:gap-2 p-1.5 rounded-2xl glass-pill-dark shrink-0 overflow-x-auto no-scrollbar max-w-full overflow-hidden">
            {TYPE_FILTERS.map((f) => {
              const active = typeFilter === f.id;
              const Icon = f.icon;
              return (
                <button
                  key={f.id}
                  onClick={() => handleTypeChange(f.id)}
                  className={`relative flex items-center gap-2 px-4 h-9 rounded-xl text-xs font-semibold cursor-pointer transition-colors duration-200 shrink-0 select-none ${
                    active ? f.activeTextClass : 'text-white/70 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="recent-episodes-active-type"
                      transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                      className={`absolute inset-0 rounded-xl ${f.activePillClass}`}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="flex items-center justify-between py-2 border-b border-white/[0.08] text-xs font-mono text-white/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>
            Toplam <span className="text-white font-bold">{totalCount.toLocaleString('tr-TR')}</span> bölüm
          </span>
        </div>
        <div>
          <span>Sayfa başına 50 bölüm</span>
        </div>
      </div>

      {/* Episodes Grid with Exact Home Page Card Design */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="w-full rounded-2xl sm:rounded-3xl aspect-[16/10] sm:aspect-[21/9] min-h-[160px] sm:min-h-[175px] bg-[#0c0c0e] border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : episodes.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-[#0c0c0e] border border-white/10 shadow-xl">
          <p className="text-base font-semibold text-white/70">
            Seçtiğiniz filtreye uygun yeni bölüm bulunamadı.
          </p>
          <button
            onClick={() => handleTypeChange('ALL')}
            className="mt-4 px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-colors cursor-pointer"
          >
            Tüm Bölümleri Göster
          </button>
        </div>
      ) : (
        <motion.div
          key={`son-eklenenler-grid-${typeFilter}-${currentPage}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5"
        >
          {episodes.map((ep, idx) => {
            const m = ep.media as MediaItem;
            if (!m) return null;
            const seasonNum = ep.season_number || 1;
            const epNum = ep.episode_number || 1;
            const isFilmItem = m.content_type === 'film' || m.content_type === 'movie';
            const timeLabel = formatRelativeTime(ep.published_at);
            const episodeLabel = isFilmItem
              ? 'Film Eklendi'
              : seasonNum > 1
              ? `S${seasonNum} • ${epNum}. Bölüm Eklendi`
              : `${epNum}. Bölüm Eklendi`;

            return (
              <motion.div
                key={`${ep.id}-${m.id}-${seasonNum}-${epNum}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.22,
                  delay: Math.min(idx * 0.015, 0.18),
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="w-full"
              >
                <Link
                  href={`/seri/${m.slug}/${epNum}?season=${seasonNum}`}
                  className="w-full group relative rounded-2xl sm:rounded-3xl overflow-hidden aspect-[16/10] sm:aspect-[21/9] min-h-[160px] sm:min-h-[175px] bg-[#0c0c0e] border border-white/10 hover:border-white/30 transition-all duration-300 active:scale-[0.99] shadow-xl cursor-pointer block"
                >
                {/* Full Card Cover Image with gentle zoom on hover */}
                <img
                  src={getProxiedImageUrl(
                    m.backdrop_image || m.cover_image,
                    m.title,
                    null,
                    'w780',
                    'banner',
                    m.tmdb_id,
                    m.content_type === 'film' ? 'movie' : 'tv'
                  )}
                  alt={m.title}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                />

                {/* Smooth Bottom Gradient Darkening */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent pointer-events-none" />

                {/* Card Content Overlay pinned to bottom */}
                <div className="absolute inset-x-0 bottom-0 z-10 p-3.5 sm:p-4 flex flex-col justify-end">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-white font-bold text-xs sm:text-[14px] truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        {cleanMediaTitle(m.title)}
                      </span>
                      <span className="text-[10px] sm:text-[11px] text-sky-400 font-semibold tracking-wide mt-0.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] truncate">
                        {episodeLabel}
                      </span>
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-mono text-white/80 shrink-0 px-2 py-0.5 rounded-lg bg-black/80 border border-white/15 shadow-sm">
                      {timeLabel}
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
      )}

      {/* Pagination Component */}
      {!isLoading && totalCount > PAGE_SIZE && (
        <Pagination
          currentPage={currentPage}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="bölümden"
          scrollToOffset={140}
        />
      )}
    </div>
  );
}

export default function RecentEpisodesPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-32 text-center text-sm font-mono text-white/50">
          Son Eklenen Bölümler Yükleniyor...
        </div>
      }
    >
      <RecentEpisodesContent />
    </Suspense>
  );
}
