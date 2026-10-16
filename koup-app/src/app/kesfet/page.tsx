'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
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
} from 'lucide-react';
import { supabase, MediaItem } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import { useKoUp } from '@/context/KoUpContext';

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
  const searchParams = useSearchParams();
  const { triggerSound } = useKoUp();

  const [typeFilter, setTypeFilter] = useState(
    searchParams.get('type') || 'ALL'
  );
  const [countryFilter, setCountryFilter] = useState(
    searchParams.get('country') || 'ALL'
  );
  const [genreFilter, setGenreFilter] = useState('Tümü');
  const [sortBy, setSortBy] = useState<'views' | 'rating' | 'year'>('views');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const t = searchParams.get('type');
    const c = searchParams.get('country');
    const q = searchParams.get('q');
    if (t) setTypeFilter(t);
    if (c) setCountryFilter(c);
    if (q !== null) setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    async function loadCatalog() {
      setIsLoading(true);
      let query = supabase.from('media').select('*');

      if (typeFilter !== 'ALL') {
        query = query.eq('content_type', typeFilter);
      }
      if (countryFilter !== 'ALL') {
        query = query.eq('country', countryFilter);
      }
      if (genreFilter !== 'Tümü') {
        query = query.contains('categories', [genreFilter]);
      }
      if (searchQuery.trim().length >= 2) {
        query = query.ilike('search_text', `%${searchQuery.trim().toLowerCase()}%`);
      }

      if (sortBy === 'views') {
        query = query.order('views_count', { ascending: false });
      } else if (sortBy === 'rating') {
        query = query.order('rating', { ascending: false, nullsFirst: false });
      } else {
        query = query.order('release_year', {
          ascending: false,
          nullsFirst: false,
        });
      }

      const { data } = await query.limit(72);
      setItems((data as MediaItem[]) || []);
      setIsLoading(false);
    }

    loadCatalog();
  }, [typeFilter, countryFilter, genreFilter, sortBy, searchQuery]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* FILTER CONTROL PANEL (Clean Dark Surface, Zero Emojis, Fluid Spring Tabs) */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
              <SlidersHorizontal className="w-3.5 h-3.5 text-white/70" />
              <span>17.509 Master Yapım • Çok Boyutlu Katalog Motoru</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight mt-1">
              Keşfet • Dizi, Anime & Film Arşivi
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full glass-pill-dark">
              <Search className="w-4 h-4 text-white/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Başlık, orijinal ad veya AKA ara..."
                className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56 sm:w-64"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-4 py-2.5 rounded-full glass-pill-dark text-xs font-semibold text-white focus:outline-none cursor-pointer"
            >
              <option value="views" className="bg-[#0f0f11] text-white">
                En Çok İzlenen & Kaynaklı
              </option>
              <option value="rating" className="bg-[#0f0f11] text-white">
                En Yüksek Puanlı (MDL / AniList / IMDb)
              </option>
              <option value="year" className="bg-[#0f0f11] text-white">
                En Yeni Yıl (2026 → Eski)
              </option>
            </select>
          </div>
        </div>

        {/* Type + Country Row with Fluid Spring Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06]">
          {CONTENT_TYPES.map((ct) => {
            const Icon = ct.icon;
            const active = typeFilter === ct.id;
            return (
              <button
                key={ct.id}
                onClick={() => {
                  triggerSound('click');
                  setTypeFilter(ct.id);
                }}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="kesfet-type-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{ct.label}</span>
              </button>
            );
          })}

          <div className="h-5 w-px bg-white/10 mx-1 hidden sm:block" />

          {COUNTRIES.map((c) => {
            const active = countryFilter === c.id;
            return (
              <button
                key={c.id}
                onClick={() => {
                  triggerSound('click');
                  setCountryFilter(c.id);
                }}
                className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="kesfet-country-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                  />
                )}
                {c.code ? (
                  <span className="relative z-10 text-[10px] font-mono opacity-65">
                    {c.code}
                  </span>
                ) : (
                  <Globe className="w-3.5 h-3.5 relative z-10" />
                )}
                <span className="relative z-10">{c.label}</span>
              </button>
            );
          })}
        </div>

        {/* Genre Chips with Spring Pill */}
        <div className="flex flex-wrap items-center gap-2">
          {GENRES.map((g) => {
            const active = genreFilter === g;
            return (
              <button
                key={g}
                onClick={() => {
                  triggerSound('click');
                  setGenreFilter(g);
                }}
                className={`relative px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'text-black'
                    : 'bg-white/[0.04] text-white/65 border border-white/10 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="kesfet-genre-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-white shadow"
                  />
                )}
                <span className="relative z-10">{g}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* RESULTS GRID WITH ACCORDION CARDS */}
      {isLoading ? (
        <div className="py-24 text-center text-sm font-mono text-white/50 animate-pulse">
          Katalog Yükleniyor...
        </div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-[#0f0f11] border border-white/10">
          <p className="text-base text-white/70">
            Seçtiğiniz filtrelere uygun yapım bulunamadı.
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center justify-center sm:justify-start gap-4"
        >
          {items.map((item) => (
            <AccordionMediaCard key={item.id} item={item} />
          ))}
        </motion.div>
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
