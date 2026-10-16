'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { supabase, MediaItem, COUNTRY_FLAGS } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';

const GENRE_FILTERS = [
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
  const searchParams = useSearchParams();

  const [typeFilter, setTypeFilter] = useState<string>(
    searchParams.get('type') || 'all'
  );
  const [countryFilter, setCountryFilter] = useState<string>(
    searchParams.get('country') || 'all'
  );
  const [genreFilter, setGenreFilter] = useState<string>(
    searchParams.get('genre') || 'Tümü'
  );
  const [sortBy, setSortBy] = useState<'popular' | 'rating' | 'year'>('popular');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const PAGE_SIZE = 36;

  useEffect(() => {
    const t = searchParams.get('type');
    if (t) setTypeFilter(t);
    const c = searchParams.get('country');
    if (c) setCountryFilter(c);
    const g = searchParams.get('genre');
    if (g) setGenreFilter(g);
  }, [searchParams]);

  useEffect(() => {
    async function loadCatalog() {
      setIsLoading(true);
      let query = supabase
        .from('media')
        .select('*')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (typeFilter !== 'all') {
        query = query.eq('content_type', typeFilter);
      }
      if (countryFilter !== 'all') {
        query = query.eq('country_code', countryFilter);
      }
      if (genreFilter !== 'Tümü') {
        query = query.contains('categories', [genreFilter]);
      }
      if (searchQuery.trim().length >= 2) {
        query = query.ilike('search_text', `%${searchQuery.trim().toLowerCase()}%`);
      }

      if (sortBy === 'popular') {
        query = query.order('sources_count', { ascending: false });
      } else if (sortBy === 'rating') {
        query = query.order('site_rating', { ascending: false });
      } else {
        query = query.order('release_year', { ascending: false });
      }

      const { data } = await query;
      setItems((data as MediaItem[]) || []);
      setIsLoading(false);
    }

    const timer = setTimeout(loadCatalog, 150);
    return () => clearTimeout(timer);
  }, [typeFilter, countryFilter, genreFilter, sortBy, searchQuery, page]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-8">
      {/* HEADER & MULTIDIMENSIONAL FILTER PANEL */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-sky-400 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" />
              <span>17.509 Master Yapım · Çok Boyutlu Katalog & Trope Motoru</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white mt-1">
              Keşfet · Dizi, Anime & Film Arşivi
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-black/55 border border-white/15">
              <Search className="w-4 h-4 text-sky-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Başlık, orijinal ad veya AKA ara..."
                className="bg-transparent text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none w-56"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'popular' | 'rating' | 'year')
              }
              className="px-4 py-2.5 rounded-full apple-glass-pill text-xs font-bold text-white cursor-pointer"
            >
              <option value="popular" className="bg-black">
                🔥 En Çok İzlenen & Kaynaklı
              </option>
              <option value="rating" className="bg-black">
                ★ En Yüksek Puanlı (MDL / AniList / IMDb)
              </option>
              <option value="year" className="bg-black">
                📅 En Yeni Yapımlar
              </option>
            </select>
          </div>
        </div>

        {/* Content Type & Country Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
          {[
            { id: 'all', label: 'Tüm Türler' },
            { id: 'dizi', label: '📺 Diziler (K-Drama / C-Drama / Global)' },
            { id: 'anime', label: '🎌 Animeler (AniList)' },
            { id: 'film', label: '🍿 Sinema Filmleri' },
            { id: 'program', label: '🎙️ Varyete & TV Programları' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTypeFilter(t.id);
                setPage(0);
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                typeFilter === t.id
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/75 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="h-4 w-px bg-white/15 mx-1" />

          {[
            { id: 'all', label: '🌍 Tüm Ülkeler' },
            { id: 'KR', label: '🇰🇷 Güney Kore' },
            { id: 'CN', label: '🇨🇳 Çin' },
            { id: 'JP', label: '🇯🇵 Japonya' },
            { id: 'TH', label: '🇹🇭 Tayland' },
            { id: 'TW', label: '🇹🇼 Tayvan' },
            { id: 'US', label: '🇺🇸 ABD / Global' },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCountryFilter(c.id);
                setPage(0);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                countryFilter === c.id
                  ? 'bg-sky-400 text-black font-bold'
                  : 'bg-white/[0.06] text-white/75 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Genre Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {GENRE_FILTERS.map((g) => (
            <button
              key={g}
              onClick={() => {
                setGenreFilter(g);
                setPage(0);
              }}
              className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all cursor-pointer ${
                genreFilter === g
                  ? 'bg-amber-400 text-black font-bold'
                  : 'bg-white/[0.04] text-white/65 hover:text-white border border-white/[0.07]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* RESULTS GRID */}
      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-sky-400 animate-pulse">
          Katalog Filtreleniyor...
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-sm text-white/50">
          Seçtiğiniz filtrelere uygun yapım bulunamadı.
        </div>
      ) : (
        <div className="flex flex-wrap justify-center sm:justify-start gap-4">
          {items.map((item) => (
            <AccordionMediaCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* PAGINATION */}
      <div className="flex items-center justify-center gap-3 pt-6">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="px-5 py-2.5 rounded-full apple-glass-pill text-xs font-semibold text-white disabled:opacity-35 cursor-pointer"
        >
          ← Önceki Sayfa
        </button>
        <span className="text-xs font-mono text-white/60">Sayfa {page + 1}</span>
        <button
          disabled={items.length < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
          className="px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold disabled:opacity-35 cursor-pointer"
        >
          Sonraki Sayfa →
        </button>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="pt-32 text-center text-sm font-mono text-sky-400">
          Katalog Yükleniyor...
        </div>
      }
    >
      <DiscoverContent />
    </Suspense>
  );
}
