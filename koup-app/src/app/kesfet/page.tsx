'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  SlidersHorizontal,
  Tv,
  Sparkles,
  Film,
  Mic,
  Globe,
  Layers,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase, MediaItem, getCountryFlag } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CountryFlag from '@/components/CountryFlag';
import { useKoUp } from '@/context/KoUpContext';
import CustomSelect from '@/components/CustomSelect';
import { cachedQuery, getCache, registerMediaItems } from '@/lib/cache';
import { normalizeSearchQuery } from '@/lib/search';
import { useDragScroll } from '@/hooks/useDragScroll';

const ITEMS_PER_PAGE = 36;

const CONTENT_TYPES = [
  { id: 'ALL', label: 'Tüm Türler', icon: Layers },
  { id: 'dizi', label: 'Diziler (K-Drama / C-Drama / Global)', icon: Tv },
  { id: 'anime', label: 'Animeler (AniList)', icon: Sparkles },
  { id: 'film', label: 'Sinema Filmleri', icon: Film },
  { id: 'program', label: 'Varyete & TV Programları', icon: Mic },
];

const COUNTRIES = [
  { id: 'ALL', label: 'Tüm Ülkeler', code: '' },
  { id: 'KR', label: 'Güney Kore', code: 'KR' },
  { id: 'TR', label: 'Türkiye', code: 'TR' },
  { id: 'CN', label: 'Çin', code: 'CN' },
  { id: 'JP', label: 'Japonya', code: 'JP' },
  { id: 'TH', label: 'Tayland', code: 'TH' },
  { id: 'TW', label: 'Tayvan', code: 'TW' },
  { id: 'US', label: 'ABD & Global', code: 'US' },
];

const GENRES = [
  'Tümü',
  'Romantik',
  'Dram',
  'Aksiyon',
  'Komedi',
  'Fantastik',
  'Gizem',
  'Gerilim',
  'Doğaüstü',
  'Bilim Kurgu',
  'Macera',
];

function DiscoverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { triggerSound } = useKoUp();
  const typeRowRef = useDragScroll<HTMLDivElement>();
  const genreRowRef = useDragScroll<HTMLDivElement>();

  const initialType = searchParams.get('type') || 'ALL';
  const initialCountry = searchParams.get('country') || 'ALL';
  const initialCategory = searchParams.get('category') || searchParams.get('genre') || 'Tümü';
  const initialSort = (searchParams.get('sort') as any) || 'views';
  const initialQ = searchParams.get('q') || '';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const [isMounted, setIsMounted] = useState(false);
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [countryFilter, setCountryFilter] = useState(initialCountry);
  const [genreFilter, setGenreFilter] = useState(initialCategory);
  const [sortBy, setSortBy] = useState<'latest' | 'views' | 'rating' | 'year'>(initialSort);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQ);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Debounce search query input (220ms) to prevent excessive concurrent database hits
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Sync debounced search query with URL search param
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (debouncedQuery.trim()) {
      url.searchParams.set('q', debouncedQuery.trim());
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState(null, '', url.toString());
  }, [debouncedQuery]);

  useEffect(() => {
    const t = searchParams.get('type');
    const c = searchParams.get('country');
    const q = searchParams.get('q');
    const s = searchParams.get('sort');
    const p = searchParams.get('page');
    const cat = searchParams.get('category') || searchParams.get('genre');
    if (t) setTypeFilter(t);
    if (c) setCountryFilter(c.toUpperCase());
    if (q !== null) {
      setSearchQuery(q);
      setDebouncedQuery(q);
    }
    if (s && ['latest', 'views', 'rating', 'year'].includes(s)) {
      setSortBy(s as any);
    }
    if (p) {
      setCurrentPage(Math.max(1, Number(p) || 1));
    }
    if (cat) {
      const matched = GENRES.find((g) => g.toLowerCase() === cat.toLowerCase());
      setGenreFilter(matched || cat);
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      const { normalized, raw } = normalizeSearchQuery(debouncedQuery);
      const cacheKey = `kesfet_${typeFilter}_${countryFilter}_${genreFilter}_${sortBy}_${normalized || 'all'}_p${currentPage}`;
      const countKey = `kesfet_count_${typeFilter}_${countryFilter}_${genreFilter}_${normalized || 'all'}`;

      const cached = getCache<MediaItem[]>(cacheKey, true);
      const cachedCount = getCache<number>(countKey, true);

      if (cached && cached.length > 0) {
        if (!active) return;
        setItems(cached);
        if (cachedCount !== null) setTotalCount(cachedCount);
        setIsLoading(false);
      } else if (items.length === 0) {
        setIsLoading(true);
      }

      const offset = (currentPage - 1) * ITEMS_PER_PAGE;

      try {
        const [data, countRes] = await Promise.all([
          cachedQuery(cacheKey, 60_000, async () => {
            // 1. High-performance multi-token fuzzy search via search_media RPC
            try {
              const rpcRes = await supabase.rpc('search_media', {
                p_query: raw,
                p_type: typeFilter,
                p_country: countryFilter,
                p_genre: genreFilter,
                p_sort: sortBy,
                p_limit: ITEMS_PER_PAGE,
                p_offset: offset,
              });

              if (rpcRes.data && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
                return rpcRes.data as MediaItem[];
              }
            } catch (rpcErr) {
              console.warn('search_media RPC notice:', rpcErr);
            }

            // 2. Direct database query fallback with trigram indexing
            let query = supabase.from('media').select('*');

            if (typeFilter !== 'ALL') {
              query = query.eq('content_type', typeFilter);
            }
            if (countryFilter !== 'ALL') {
              query = query.eq('country_code', countryFilter);
            }
            if (genreFilter !== 'Tümü') {
              query = query.contains('categories', [genreFilter]);
            }
            if (normalized.length >= 2 || raw.length >= 2) {
              query = query.or(`title.ilike.%${raw}%,slug.ilike.%${normalized || raw}%,search_text.ilike.%${normalized || raw}%`);
            }

            if (sortBy === 'latest') {
              query = query.order('id', { ascending: false });
            } else if (sortBy === 'views') {
              query = query.order('views_total', { ascending: false });
            } else if (sortBy === 'rating') {
              query = query.order('site_rating', { ascending: false, nullsFirst: false });
            } else {
              query = query.order('release_year', {
                ascending: false,
                nullsFirst: false,
              });
            }

            const { data: resData } = await query.range(offset, offset + ITEMS_PER_PAGE - 1);
            return (resData as MediaItem[]) || [];
          }),
          cachedQuery(countKey, 120_000, async () => {
            try {
              const rpcCount = await supabase.rpc('count_search_media', {
                p_query: raw,
                p_type: typeFilter,
                p_country: countryFilter,
                p_genre: genreFilter,
              });
              if (rpcCount.data !== null && rpcCount.data !== undefined) {
                return Number(rpcCount.data);
              }
            } catch (cntErr) {
              console.warn('count_search_media RPC notice:', cntErr);
            }
            return 0;
          }),
        ]);

        if (!active) return;
        setItems(data);
        setTotalCount(Math.max(countRes, data.length));
        registerMediaItems(data);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    loadCatalog();

    return () => {
      active = false;
    };
  }, [typeFilter, countryFilter, genreFilter, sortBy, debouncedQuery, currentPage]);

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    triggerSound('click');
    setCurrentPage(page);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 180, behavior: 'smooth' });
    }
  };

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  };

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* FILTER CONTROL PANEL (Clean Dark Surface, Zero Emojis, Fluid Spring Tabs) */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
              <SlidersHorizontal className="w-3.5 h-3.5 text-white/70" />
              <span suppressHydrationWarning>
                {isMounted && totalCount > 0
                  ? `${totalCount.toLocaleString('tr-TR')} Master Yapım`
                  : '26.750+ Master Yapım'}{' '}
                • Çok Boyutlu Katalog Motoru
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
              Keşfet • Dizi, Anime & Film Arşivi
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)]">
              <Search className="w-4 h-4 text-white/60 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Başlık, orijinal ad veya AKA ara..."
                className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56 sm:w-64 font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                  aria-label="Aramayı temizle"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <CustomSelect
              value={sortBy}
              onChange={(val) => {
                setSortBy(val as any);
                setCurrentPage(1);
              }}
              variant="pill"
              aria-label="Sıralama Ölçütü"
              options={[
                { value: 'latest', label: 'Son Eklenen' },
                { value: 'views', label: 'En Çok İzlenen & Kaynaklı' },
                { value: 'rating', label: 'En Yüksek Puanlı (MDL / AL / IMDb)' },
                { value: 'year', label: 'En Yeni Yıl (2026 → Eski)' },
              ]}
            />
          </div>
        </div>

        {/* Type + Country Row with Fluid Spring Sliding Pills */}
        <div
          ref={typeRowRef}
          className="flex items-center gap-2 pt-2 border-t border-white/[0.06] overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]"
        >
          {CONTENT_TYPES.map((ct) => {
            const Icon = ct.icon;
            const active = typeFilter === ct.id;
            return (
              <button
                key={ct.id}
                onClick={() => {
                  triggerSound('click');
                  setTypeFilter(ct.id);
                  setCurrentPage(1);
                }}
                className={`relative shrink-0 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                  active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="kesfet-type-active-pill"
                    initial={false}
                    transition={{
                      type: 'spring',
                      stiffness: 480,
                      damping: 34,
                      mass: 0.6,
                    }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.4)]"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{ct.label}</span>
              </button>
            );
          })}

          <div className="h-5 w-px bg-white/10 mx-1 shrink-0 hidden sm:block" />

          {(() => {
            const hasCountry = COUNTRIES.some((c) => c.id === countryFilter);
            const countriesList = hasCountry
              ? COUNTRIES
              : [
                  ...COUNTRIES,
                  {
                    id: countryFilter,
                    label: countryFilter,
                    code: countryFilter,
                  },
                ];

            return countriesList.map((c) => {
              const active = countryFilter === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    triggerSound('click');
                    setCountryFilter(c.id);
                    setCurrentPage(1);
                  }}
                  className={`relative shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                    active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="kesfet-country-active-pill"
                      initial={false}
                      transition={{
                        type: 'spring',
                        stiffness: 480,
                        damping: 34,
                        mass: 0.6,
                      }}
                      className="absolute inset-0 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.4)]"
                    />
                  )}
                  {c.code ? (
                    <span className="relative z-10 flex items-center mr-0.5">
                      <CountryFlag code={c.code} size="sm" />
                    </span>
                  ) : (
                    <Globe className="w-3.5 h-3.5 relative z-10" />
                  )}
                  <span className="relative z-10">{c.label}</span>
                </button>
              );
            });
          })()}
        </div>

        {/* Genre Chips with Fluid Spring Sliding Pill */}
        <div
          ref={genreRowRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]"
        >
          {(() => {
            const genresList =
              genreFilter !== 'Tümü' && !GENRES.includes(genreFilter)
                ? [genreFilter, ...GENRES]
                : GENRES;

            return genresList.map((g) => {
              const active = genreFilter === g;
              return (
                <button
                  key={g}
                  onClick={() => {
                    triggerSound('click');
                    setGenreFilter(g);
                    setCurrentPage(1);
                  }}
                  className={`relative shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 cursor-pointer ${
                    active
                      ? 'text-black'
                      : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="kesfet-genre-active-pill"
                      initial={false}
                      transition={{
                        type: 'spring',
                        stiffness: 480,
                        damping: 34,
                        mass: 0.6,
                      }}
                      className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                    />
                  )}
                  <span className="relative z-10">{g}</span>
                </button>
              );
            });
          })()}
        </div>
      </div>

      {isLoading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4 pt-2.5 pb-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-[#0f0f11] border border-white/10">
          <p className="text-base text-white/70">
            Seçtiğiniz filtrelere uygun yapım bulunamadı.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4 pt-2.5 pb-6">
          {items.map((item) => (
            <AccordionMediaCard key={item.id} item={item} fluidWidth={true} />
          ))}
        </div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {isMounted && !isLoading && totalPages > 1 && (
        <div className="pt-8 pb-12 flex flex-col sm:flex-row items-center justify-between gap-5 border-t border-white/[0.08]">
          <div className="text-xs font-mono text-white/50">
            Toplam <span className="text-white font-bold">{totalCount.toLocaleString('tr-TR')}</span> yapımdan{' '}
            <span className="text-sky-400 font-bold">
              {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{' '}
              {Math.min(currentPage * ITEMS_PER_PAGE, totalCount)}
            </span>{' '}
            arası gösteriliyor (Sayfa {currentPage} / {totalPages})
          </div>

          <div className="flex items-center gap-1.5">
            {/* First Page */}
            {currentPage > 2 && (
              <button
                onClick={() => goToPage(1)}
                aria-label="İlk Sayfa"
                className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/25 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer hidden md:flex"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
            )}

            {/* Previous Page */}
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className={`px-3.5 h-9 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-all ${
                currentPage <= 1
                  ? 'bg-white/[0.02] border-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-white/[0.04] border-white/10 hover:border-white/25 text-white/80 hover:text-white cursor-pointer'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Önceki</span>
            </button>

            {/* Numbered Page Buttons */}
            <div className="flex items-center gap-1">
              {getPageNumbers().map((p, idx) => {
                if (p === '...') {
                  return (
                    <span
                      key={`ellipsis-${idx}`}
                      className="w-8 h-9 flex items-center justify-center text-xs text-white/40 font-mono"
                    >
                      …
                    </span>
                  );
                }
                const pageNum = Number(p);
                const isActive = pageNum === currentPage;
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`w-9 h-9 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#2997ff] text-white glow-blue scale-105'
                        : 'bg-white/[0.04] border border-white/10 hover:border-white/25 text-white/70 hover:text-white hover:bg-white/[0.08]'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            {/* Next Page */}
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className={`px-3.5 h-9 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-all ${
                currentPage >= totalPages
                  ? 'bg-white/[0.02] border-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-white/[0.04] border-white/10 hover:border-white/25 text-white/80 hover:text-white cursor-pointer'
              }`}
            >
              <span className="hidden sm:inline">Sonraki</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Last Page */}
            {currentPage < totalPages - 1 && (
              <button
                onClick={() => goToPage(totalPages)}
                aria-label="Son Sayfa"
                className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/25 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer hidden md:flex"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-32 text-center text-sm font-mono text-white/50">
          Yükleniyor...
        </div>
      }
    >
      <DiscoverContent />
    </Suspense>
  );
}
