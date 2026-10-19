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
  Check,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase, MediaItem, getCountryFlag } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CountryFlag from '@/components/CountryFlag';
import Pagination from '@/components/Pagination';
import { useKoUp } from '@/context/KoUpContext';
import CustomSelect from '@/components/CustomSelect';
import { cachedQuery, getCache, registerMediaItems } from '@/lib/cache';
import { normalizeSearchQuery } from '@/lib/search';
import { useDragScroll } from '@/hooks/useDragScroll';
import { rankSearchResults } from '@/lib/searchRanking';

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

const YEAR_OPTIONS = [
  { value: 'ALL', label: 'Tüm Yıllar' },
  { value: '2026', label: '2026' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
  { value: '2023', label: '2023' },
  { value: '2022', label: '2022' },
  { value: '2021', label: '2021' },
  { value: '2020', label: '2020' },
  { value: '2019', label: '2019' },
  { value: '2018', label: '2018' },
  { value: '2015-2017', label: '2015 - 2017' },
  { value: '2010-2014', label: '2010 - 2014' },
  { value: '2000-2009', label: '2000 - 2009' },
  { value: '1990-1999', label: '1990 - 1999' },
  { value: '1990 Öncesi', label: '1990 Öncesi' },
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

function applyYearFilter(query: any, yearFilter: string) {
  if (!yearFilter || yearFilter === 'ALL') return query;
  if (/^\d{4}$/.test(yearFilter)) {
    return query.eq('release_year', Number(yearFilter));
  }
  if (yearFilter.includes('-')) {
    const [start, end] = yearFilter.split('-').map(Number);
    if (start && end) {
      return query.gte('release_year', start).lte('release_year', end);
    }
  }
  if (yearFilter === '1990 Öncesi' || yearFilter.toLowerCase().includes('öncesi')) {
    return query.lt('release_year', 1990);
  }
  return query;
}

function DiscoverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { triggerSound } = useKoUp();
  const typeRowRef = useDragScroll<HTMLDivElement>();
  const genreRowRef = useDragScroll<HTMLDivElement>();

  const initialType = searchParams.get('type') || 'ALL';
  const initialCountry = searchParams.get('country') || 'ALL';
  const initialYear = searchParams.get('year') || 'ALL';
  const initialCategoryParam = searchParams.get('category') || searchParams.get('genre') || '';
  const initialGenres = initialCategoryParam && initialCategoryParam !== 'Tümü'
    ? initialCategoryParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const initialSort = (searchParams.get('sort') as any) || 'views';
  const initialQ = searchParams.get('q') || '';
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);

  const [isMounted, setIsMounted] = useState(false);
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [countryFilter, setCountryFilter] = useState(initialCountry);
  const [yearFilter, setYearFilter] = useState(initialYear);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);
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
    const y = searchParams.get('year');
    const q = searchParams.get('q');
    const s = searchParams.get('sort');
    const p = searchParams.get('page');
    const cat = searchParams.get('category') || searchParams.get('genre');
    if (t) setTypeFilter(t);
    if (c) setCountryFilter(c.toUpperCase());
    if (y) setYearFilter(y);
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
      const genresKey = selectedGenres.length > 0 ? selectedGenres.slice().sort().join('-') : 'all';
      const cacheKey = `kesfet_${typeFilter}_${countryFilter}_${yearFilter}_${genresKey}_${sortBy}_${normalized || 'all'}_p${currentPage}`;
      const countKey = `kesfet_count_${typeFilter}_${countryFilter}_${yearFilter}_${genresKey}_${normalized || 'all'}`;

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
            if (yearFilter === 'ALL' && selectedGenres.length <= 1 && raw.length >= 2) {
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
            query = applyYearFilter(query, yearFilter);

            if (normalized.length >= 2 || raw.length >= 2) {
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
            if (yearFilter === 'ALL' && selectedGenres.length <= 1) {
              try {
                const rpcCount = await supabase.rpc('count_search_media', {
                  p_query: raw,
                  p_type: typeFilter,
                  p_country: countryFilter,
                  p_genre: selectedGenres.length === 1 ? selectedGenres[0] : 'Tümü',
                });
                if (rpcCount.data !== null && rpcCount.data !== undefined && Number(rpcCount.data) > 0) {
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
              cQuery = applyYearFilter(cQuery, yearFilter);
              if (normalized.length >= 2 || raw.length >= 2) {
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
  }, [typeFilter, countryFilter, yearFilter, selectedGenres, sortBy, debouncedQuery, currentPage]);

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

  const countryOptions = COUNTRIES.map((c) => ({
    value: c.id,
    label: c.label,
    icon: c.code ? <CountryFlag code={c.code} size="sm" /> : <Globe className="w-3.5 h-3.5 text-sky-400" />,
  }));

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
                  : '26.750+ Master Yapım'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
              Keşfet
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] w-full sm:w-auto justify-between sm:justify-start">
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
                value={yearFilter}
                onChange={(val) => {
                  setYearFilter(val);
                  setCurrentPage(1);
                }}
                variant="pill"
                aria-label="Yıl Filtresi"
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
                  { value: 'latest', label: 'Son Eklenen' },
                  { value: 'views', label: 'En Çok İzlenen' },
                  { value: 'rating', label: 'En Yüksek Puanlı' },
                  { value: 'year', label: 'En Yeni Yıl' },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Content Type Row with Fluid Spring Sliding Pills */}
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
            className={`relative shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 cursor-pointer ${
              selectedGenres.length === 0
                ? 'text-black font-bold'
                : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white'
            }`}
          >
            {selectedGenres.length === 0 && (
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
            <span className="relative z-10">Tümü</span>
          </button>

          {selectedGenres.length > 0 && (
            <button
              onClick={() => {
                triggerSound('click');
                setSelectedGenres([]);
                setCurrentPage(1);
              }}
              className="relative shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Temizle ({selectedGenres.length})</span>
            </button>
          )}

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
                    ? 'bg-white text-black font-bold shadow-[0_0_16px_rgba(255,255,255,0.35)]'
                    : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white'
                }`}
              >
                {active && <Check className="w-3 h-3 stroke-[3] text-black" />}
                <span>{g}</span>
              </button>
            );
          })}
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
