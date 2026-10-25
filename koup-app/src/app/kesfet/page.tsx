'use client';

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
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
  Check,
  X,
  Clock,
  TrendingUp,
  Star,
  Calendar,
  ArrowUpDown,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase, MediaItem, getCountryFlag } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CountryFlag from '@/components/CountryFlag';
import Pagination from '@/components/Pagination';
import { useKoUpSelector } from '@/context/KoUpContext';
import CustomSelect from '@/components/CustomSelect';
import { cachedQuery, getCache, registerMediaItems } from '@/lib/cache';
import { normalizeSearchQuery } from '@/lib/search';
import { useDragScroll } from '@/hooks/useDragScroll';
import { usePillDragTracking } from '@/hooks/usePillDragTracking';
import { rankSearchResults } from '@/lib/searchRanking';

const ITEMS_PER_PAGE = 36;

const CONTENT_TYPES = [
  {
    id: 'ALL',
    label: 'Tüm Türler',
    icon: Layers,
    activePillClass:
      'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'dizi',
    label: 'Diziler',
    icon: Tv,
    activePillClass:
      'bg-gradient-to-r from-blue-500 to-indigo-600 shadow-[0_0_18px_rgba(99,102,241,0.45)] border border-indigo-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'anime',
    label: 'Animeler',
    icon: Sparkles,
    activePillClass:
      'bg-gradient-to-r from-purple-500 to-pink-600 shadow-[0_0_18px_rgba(168,85,247,0.45)] border border-purple-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'film',
    label: 'Sinema Filmleri',
    icon: Film,
    activePillClass:
      'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(245,158,11,0.45)] border border-amber-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'program',
    label: 'Varyete & TV Programları',
    icon: Mic,
    activePillClass:
      'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_0_18px_rgba(16,185,129,0.45)] border border-emerald-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
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

const YEAR_OPTIONS = [
  { value: 'ALL', label: 'Tüm Yıllar' },
  ...Array.from({ length: 2027 - 1970 + 1 }, (_, i) => {
    const yr = String(2027 - i);
    return { value: yr, label: yr };
  }),
];

const GENRES = [
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
  'Suç',
  'Tarih',
  'Aile',
  'Gençlik',
  'Okul',
  'Psikolojik',
  'Korku',
  'BL',
  'GL',
  'Melodram',
  'Spor',
  'Müzik',
  'Yaşamdan Kesitler',
  'Askeri',
  'Siyaset',
  'Hukuk',
  'Tıp',
  'İntikam',
];

function applyYearFilter(query: any, yearFilter: string[] | string) {
  const years = Array.isArray(yearFilter)
    ? yearFilter.filter((y) => y && y !== 'ALL')
    : yearFilter && yearFilter !== 'ALL'
    ? yearFilter.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  if (years.length === 0) return query;
  if (years.length === 1) {
    return query.eq('release_year', Number(years[0]));
  }
  return query.in('release_year', years.map(Number));
}

function DiscoverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const genreRowRef = useDragScroll<HTMLDivElement>();

  const initialType = searchParams.get('type') || 'ALL';
  const initialCountry = searchParams.get('country') || 'ALL';
  const initialYearParam = searchParams.get('year') || '';
  const initialYears = initialYearParam && initialYearParam !== 'ALL'
    ? initialYearParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const initialCategoryParam = searchParams.get('category') || searchParams.get('genre') || '';
  const initialGenres = initialCategoryParam && initialCategoryParam !== 'Tümü'
    ? initialCategoryParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const initialSort = (searchParams.get('sort') as any) || 'views';
  const initialQ = searchParams.get('q') || '';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);

  const [isMounted, setIsMounted] = useState(false);
  const [typeFilter, setTypeFilter] = useState(initialType);

  const { containerRef: typeRowRef, dragProps: typeDragProps } = usePillDragTracking<string>({
    activeTab: typeFilter,
    onTabChange: (newType) => {
      setTypeFilter(newType);
      setCurrentPage(1);
    },
    triggerSound,
  });
  const [countryFilter, setCountryFilter] = useState(initialCountry);
  const [selectedYears, setSelectedYears] = useState<string[]>(initialYears);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);
  const [sortBy, setSortBy] = useState<'latest' | 'views' | 'rating' | 'year'>(initialSort);
  const [searchQuery, setSearchQuery] = useState(initialQ);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQ);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalCount, setTotalCount] = useState<number>(24746);
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
    const y = searchParams.get('year');
    const q = searchParams.get('q');
    const s = searchParams.get('sort');
    const p = searchParams.get('page');
    const cat = searchParams.get('category') || searchParams.get('genre');
    if (t) setTypeFilter(t);
    if (c) setCountryFilter(c.toUpperCase());
    if (y !== null) {
      if (!y || y === 'ALL') {
        setSelectedYears([]);
      } else {
        const parts = y.split(',').map((s) => s.trim()).filter(Boolean);
        setSelectedYears(parts);
      }
    }
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
    if (cat !== null) {
      if (!cat || cat === 'Tümü') {
        setSelectedGenres([]);
      } else {
        const parts = cat.split(',').map((g) => g.trim()).filter(Boolean);
        setSelectedGenres(parts);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      const { normalized, raw } = normalizeSearchQuery(debouncedQuery);
      const isAllYears = selectedYears.length === 0 || selectedYears.includes('ALL');
      const yearsKey = selectedYears.length > 0 ? selectedYears.slice().sort().join('-') : 'all';
      const genresKey = selectedGenres.length > 0 ? selectedGenres.slice().sort().join('-') : 'all';
      const cacheKey = `kesfet_v2_${typeFilter}_${countryFilter}_${yearsKey}_${genresKey}_${sortBy}_${normalized || 'all'}_p${currentPage}`;
      const countKey = `kesfet_count_v2_${typeFilter}_${countryFilter}_${yearsKey}_${genresKey}_${normalized || 'all'}`;

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
            // 1. High-performance multi-token fuzzy search via search_media RPC if standard filters
            if (isAllYears && selectedGenres.length <= 1 && raw.length >= 2) {
              try {
                const rpcRes = await supabase.rpc('search_media', {
                  p_query: raw,
                  p_type: typeFilter,
                  p_country: countryFilter,
                  p_genre: selectedGenres.length === 1 ? selectedGenres[0] : 'Tümü',
                  p_sort: sortBy,
                  p_limit: ITEMS_PER_PAGE,
                  p_offset: offset,
                });

                if (rpcRes.data && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
                  const results = rpcRes.data as MediaItem[];
                  return rankSearchResults(results, raw);
                }
              } catch (rpcErr) {
                console.warn('search_media RPC notice:', rpcErr);
              }
            }

            // 2. Direct database query with multi-genre & year support
            let query = supabase.from('media').select('*');

            if (typeFilter !== 'ALL') {
              query = query.eq('content_type', typeFilter);
            }
            if (countryFilter !== 'ALL') {
              query = query.eq('country_code', countryFilter);
            }
            if (selectedGenres.length > 0) {
              query = query.contains('categories', selectedGenres);
            }
            query = applyYearFilter(query, selectedYears);

            const searchTokens = raw.trim().split(/\s+/).filter(Boolean);
            if (searchTokens.length > 1) {
              for (const t of searchTokens) {
                query = query.or(`title.ilike.%${t}%,slug.ilike.%${t}%,search_text.ilike.%${t}%`);
              }
            } else if (normalized.length >= 2 || raw.length >= 2) {
              query = query.or(`title.ilike.%${raw}%,slug.ilike.%${normalized || raw}%,search_text.ilike.%${normalized || raw}%`);
            }

            if (raw.length >= 2) {
              // When searching text, relevance comes first
              const { data: resData } = await query.limit(100);
              const ranked = rankSearchResults((resData as MediaItem[]) || [], raw);
              return ranked.slice(offset, offset + ITEMS_PER_PAGE);
            }

            if (sortBy === 'latest') {
              query = query.order('id', { ascending: false });
            } else if (sortBy === 'views') {
              query = query.order('views_total', { ascending: false, nullsFirst: false });
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
          }, (freshItems) => {
            if (active && Array.isArray(freshItems) && freshItems.length > 0) {
              setItems(freshItems);
            }
          }),
          cachedQuery(countKey, 120_000, async () => {
            if (
              isAllYears &&
              selectedGenres.length === 0 &&
              typeFilter === 'ALL' &&
              countryFilter === 'ALL' &&
              !normalized &&
              !raw
            ) {
              return 24746;
            }

            if (isAllYears && selectedGenres.length <= 1) {
              try {
                const rpcCount = await supabase.rpc('count_search_media', {
                  p_query: raw,
                  p_type: typeFilter,
                  p_country: countryFilter,
                  p_genre: selectedGenres.length === 1 ? selectedGenres[0] : 'Tümü',
                });
                if (rpcCount.data !== null && rpcCount.data !== undefined) {
                  return Number(rpcCount.data);
                }
              } catch (cntErr) {
                console.warn('count_search_media RPC notice:', cntErr);
              }
            }

            try {
              let cQuery = supabase.from('media').select('*', { count: 'exact', head: true });
              if (typeFilter !== 'ALL') cQuery = cQuery.eq('content_type', typeFilter);
              if (countryFilter !== 'ALL') cQuery = cQuery.eq('country_code', countryFilter);
              if (selectedGenres.length > 0) cQuery = cQuery.contains('categories', selectedGenres);
              cQuery = applyYearFilter(cQuery, selectedYears);
              const searchTokens = raw.trim().split(/\s+/).filter(Boolean);
              if (searchTokens.length > 1) {
                for (const t of searchTokens) {
                  cQuery = cQuery.or(`title.ilike.%${t}%,slug.ilike.%${t}%,search_text.ilike.%${t}%`);
                }
              } else if (normalized.length >= 2 || raw.length >= 2) {
                cQuery = cQuery.or(`title.ilike.%${raw}%,slug.ilike.%${normalized || raw}%,search_text.ilike.%${normalized || raw}%`);
              }
              const { count, error } = await cQuery;
              if (!error && typeof count === 'number') {
                return count;
              }
            } catch (err) {
              console.warn('count query notice:', err);
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
  }, [typeFilter, countryFilter, selectedYears, selectedGenres, sortBy, debouncedQuery, currentPage]);

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));

  const goToPage = useCallback(
    (page: number) => {
      if (page < 1 || page > totalPages || page === currentPage) return;
      triggerSound?.('click');
      setCurrentPage(page);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 180, behavior: 'instant' });
      }
    },
    [totalPages, currentPage, triggerSound]
  );

  const countryOptions = useMemo(
    () =>
      COUNTRIES.map((c) => ({
        value: c.id,
        label: c.label,
        icon: c.code ? <CountryFlag code={c.code} size="sm" /> : <Globe className="w-3.5 h-3.5 text-sky-400" />,
      })),
    []
  );

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* FILTER CONTROL PANEL (Clean Dark Surface, Zero Emojis, Fluid Spring Tabs) */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
              <SlidersHorizontal className="w-3.5 h-3.5 text-white/70" />
              <span suppressHydrationWarning>
                {totalCount > 0
                  ? `${totalCount.toLocaleString('tr-TR')} Master Yapım`
                  : '24.746 Master Yapım'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
              Keşfet
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] w-full sm:w-auto justify-between sm:justify-start">
              <Search className="w-4 h-4 text-white/60 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Başlık, orijinal ad veya AKA ara..."
                className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full sm:w-64 font-medium"
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

            <div className="flex flex-wrap items-center justify-center gap-2.5 w-full sm:w-auto">
              <CustomSelect
                value={countryFilter}
                onChange={(val) => {
                  setCountryFilter(val);
                  setCurrentPage(1);
                }}
                variant="pill"
                aria-label="Ülke Filtresi"
                options={countryOptions}
              />

              <CustomSelect
                multiple={true}
                value={selectedYears}
                onChange={(val: string[]) => {
                  setSelectedYears(val);
                  setCurrentPage(1);
                  const url = new URL(window.location.href);
                  if (val.length > 0) {
                    url.searchParams.set('year', val.join(','));
                  } else {
                    url.searchParams.delete('year');
                  }
                  url.searchParams.set('page', '1');
                  window.history.replaceState(null, '', url.toString());
                }}
                variant="pill"
                aria-label="Yıl Filtresi"
                placeholder="Tüm Yıllar"
                options={YEAR_OPTIONS}
              />

              <CustomSelect
                value={sortBy}
                onChange={(val) => {
                  setSortBy(val as any);
                  setCurrentPage(1);
                }}
                variant="pill"
                aria-label="Sıralama Ölçütü"
                options={[
                  {
                    value: 'latest',
                    label: 'Son Eklenen',
                    icon: <Clock className="w-3.5 h-3.5 text-emerald-400" />,
                  },
                  {
                    value: 'views',
                    label: 'En Çok İzlenen',
                    icon: <TrendingUp className="w-3.5 h-3.5 text-sky-400" />,
                  },
                  {
                    value: 'rating',
                    label: 'En Yüksek Puanlı',
                    icon: <Star className="w-3.5 h-3.5 text-yellow-400" />,
                  },
                  {
                    value: 'year',
                    label: 'En Yeni Yıl',
                    icon: <Calendar className="w-3.5 h-3.5 text-purple-400" />,
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Content Type Row with Fluid Spring Sliding Pills & Real-Time Drag Tracking */}
        <div className="pt-2 border-t border-white/[0.06] overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]">
          <div
            ref={typeRowRef}
            {...typeDragProps}
            className="inline-flex w-max items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 select-none touch-pan-x cursor-pointer sm:cursor-grab sm:active:cursor-grabbing overflow-hidden"
          >
            {CONTENT_TYPES.map((ct) => {
              const Icon = ct.icon;
              const active = typeFilter === ct.id;

              return (
                <button
                  key={ct.id}
                  data-tab-id={ct.id}
                  type="button"
                  onClick={() => {
                    triggerSound('click');
                    setTypeFilter(ct.id);
                    setCurrentPage(1);
                  }}
                  className={`relative shrink-0 flex items-center gap-2 px-3.5 sm:px-4 h-9 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer select-none touch-manipulation ${
                    active ? ct.activeTextClass : 'text-white/70 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="kesfet-type-active-pill"
                      initial={false}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 30,
                        mass: 0.8,
                      }}
                      className={`absolute inset-0 rounded-xl ${ct.activePillClass} z-0 select-none pointer-events-none`}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10 pointer-events-none" />
                  <span className="relative z-10 pointer-events-none">{ct.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-Select Genre Chips with Drag-Scroll */}
        <div
          ref={genreRowRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]"
        >
          <button
            onClick={() => {
              triggerSound('click');
              setSelectedGenres([]);
              setCurrentPage(1);
            }}
            className={`relative shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
              selectedGenres.length === 0
                ? 'bg-white text-black font-extrabold shadow-[0_0_18px_rgba(255,255,255,0.35)]'
                : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <span className="relative z-10">Tümü</span>
          </button>

          {GENRES.map((g) => {
            const active = selectedGenres.includes(g);
            return (
              <button
                key={g}
                onClick={() => {
                  triggerSound('click');
                  setCurrentPage(1);
                  setSelectedGenres((prev) =>
                    prev.includes(g)
                      ? prev.filter((item) => item !== g)
                      : [...prev, g]
                  );
                }}
                className={`relative shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
                  active
                    ? 'bg-sky-500 text-white font-extrabold shadow-[0_0_16px_rgba(14,165,233,0.45)] border border-sky-400/60'
                    : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                {active && <Check className="w-3 h-3 stroke-[3] text-white" />}
                <span>{g}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4 pt-2.5 pb-6">
          {Array.from({ length: 18 }).map((_, i) => (
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3.5 sm:gap-4 pt-2.5 pb-6 transition-opacity duration-200">
          {items.map((item, idx) => (
            <AccordionMediaCard
              key={item.id}
              item={item}
              fluidWidth={true}
              priority={idx < 6}
            />
          ))}
        </div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {isMounted && !isLoading && (
        <Pagination
          currentPage={currentPage}
          totalCount={totalCount}
          pageSize={ITEMS_PER_PAGE}
          onPageChange={goToPage}
          itemLabel="yapımdan"
          scrollToOffset={180}
        />
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
