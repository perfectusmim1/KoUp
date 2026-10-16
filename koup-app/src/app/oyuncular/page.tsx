'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Heart,
  Search,
  Sparkles,
  Trophy,
  Bell,
  Clapperboard,
  Mic,
  UserCheck,
} from 'lucide-react';
import {
  supabase,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import CustomSelect from '@/components/CustomSelect';
import { cachedQuery } from '@/lib/cache';

const PERSON_TABS = [
  { id: 'all', label: 'Tüm Yıldızlar & Karakterler', icon: Sparkles },
  { id: 'actor', label: 'Dizi & Sinema Oyuncuları (MDL)', icon: Clapperboard },
  { id: 'character', label: 'Anime Karakterleri (AniList)', icon: UserCheck },
  { id: 'seiyuu', label: 'Seslendirmenler (Seiyuu)', icon: Mic },
] as const;

export default function ActorsLeaderboardPage() {
  const {
    favPersonIds,
    followedPersonIds,
    togglePersonFavorite,
    togglePersonFollow,
    triggerSound,
  } = useKoUp();

  const [people, setPeople] = useState<PersonItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'actor' | 'character' | 'seiyuu'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'favs' | 'dramas'>('favs');
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const PAGE_SIZE = 48;

  useEffect(() => {
    async function fetchPeople() {
      setIsLoading(true);
      try {
        const cacheKey = `top_people_${filterType}_${sortBy}_${page}_${searchQuery.trim().toLowerCase()}`;
        const data = await cachedQuery(cacheKey, 300_000, async () => {
          let query = supabase
            .from('people')
            .select('*')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (filterType !== 'all') {
            query = query.eq('person_type', filterType);
          }
          if (searchQuery.trim().length >= 2) {
            query = query.ilike('name', `%${searchQuery.trim()}%`);
          }
          if (sortBy === 'favs') {
            query = query
              .order('favorites_count', { ascending: false })
              .order('drama_count', { ascending: false });
          } else {
            query = query.order('drama_count', { ascending: false });
          }

          const { data: resData } = await query;
          return (resData as PersonItem[]) || [];
        });

        setPeople(data);
      } finally {
        setIsLoading(false);
      }
    }

    const timer = setTimeout(fetchPeople, 140);
    return () => clearTimeout(timer);
  }, [filterType, searchQuery, sortBy, page]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* HEADER & FILTER BAR */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
            <Trophy className="w-3.5 h-3.5 text-amber-300" />
            <span>21.814 Oyuncu, Anime Karakteri & Seiyuu • Canlı Favori Sıralaması</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Oyuncular & Anime Karakterleri Evreni
          </h1>
          <p className="text-sm text-white/60 max-w-2xl">
            En çok favori alan K-Drama/C-Drama oyuncularını, AniList anime karakterlerini ve Japonca seslendirmenleri keşfet, favorile ve yorum bırak.
          </p>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full glass-pill-dark">
            <Search className="w-4 h-4 text-white/60" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Oyuncu veya anime karakteri ara..."
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56"
            />
          </div>

          <CustomSelect
            value={sortBy}
            onChange={(val) => setSortBy(val as 'favs' | 'dramas')}
            variant="pill"
            options={[
              { value: 'favs', label: 'En Çok Favorilenenler' },
              { value: 'dramas', label: 'En Çok Yapımda Rol Alan' },
            ]}
          />
        </div>
      </div>

      {/* CATEGORY TABS WITH FLUID SPRING PILL */}
      <div className="flex flex-wrap items-center gap-2">
        {PERSON_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = filterType === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                triggerSound('click');
                setFilterType(tab.id);
                setPage(0);
              }}
              className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="actors-category-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.4)]"
                />
              )}
              <Icon className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* LEADERBOARD GRID */}
      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-white/50 animate-pulse">
          Oyuncu ve Karakter Sıralaması Yükleniyor...
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
        >
          {people.map((person, idx) => {
            const rank = page * PAGE_SIZE + idx + 1;
            const isFav = favPersonIds.includes(person.id);
            const isFol = followedPersonIds.includes(person.id);
            const displayFavs = person.favorites_count + (isFav ? 1 : 0);

            return (
              <div
                key={person.id}
                className="koup-projection-card cv-card rounded-3xl p-4 flex flex-col justify-between group"
              >
                <div>
                  <div className="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-black/50 border border-white/10">
                    <Link href={`/oyuncu/${person.slug}`}>
                      <img
                        src={getProxiedImageUrl(person.image_url, person.name)}
                        alt={person.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </Link>

                    {/* Rank Badge */}
                    <span
                      className={`absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-extrabold border ${
                        rank === 1
                          ? 'bg-amber-400/25 text-amber-300 border-amber-400/50 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                          : rank === 2
                          ? 'bg-slate-300/25 text-slate-100 border-slate-300/50 shadow-[0_0_12px_rgba(203,213,225,0.3)]'
                          : rank === 3
                          ? 'bg-amber-700/30 text-amber-300 border-amber-600/50 shadow-[0_0_12px_rgba(180,83,9,0.3)]'
                          : 'bg-black/80 text-white/90 border-white/15'
                      }`}
                    >
                      #{rank}
                    </span>

                    {/* Type Badge */}
                    <span
                      className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${
                        person.person_type === 'character'
                          ? 'bg-purple-500/20 text-purple-200 border-purple-400/30'
                          : person.person_type === 'seiyuu'
                          ? 'bg-sky-500/20 text-sky-200 border-sky-400/30'
                          : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                      }`}
                    >
                      {person.person_type === 'character'
                        ? 'Karakter'
                        : person.person_type === 'seiyuu'
                          ? 'Seiyuu'
                          : 'Oyuncu'}
                    </span>
                  </div>

                  <Link
                    href={`/oyuncu/${person.slug}`}
                    className="block text-sm font-bold text-white truncate group-hover:text-white transition-colors"
                  >
                    {person.name}
                  </Link>
                  {person.native_name && (
                    <div className="text-[11px] text-white/45 truncate">
                      {person.native_name}
                    </div>
                  )}
                </div>

                {/* Bottom Favorite & Follow Actions */}
                <div className="mt-3 pt-2.5 border-t border-white/[0.07] flex items-center justify-between gap-2">
                  <button
                    onClick={() => togglePersonFavorite(person.id, person.name)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-full text-xs font-mono font-bold border transition-all cursor-pointer ${
                      isFav
                        ? 'bg-rose-500 border-rose-400 text-white'
                        : 'bg-white/[0.05] border-white/10 text-white/85 hover:bg-white/10'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : 'text-rose-400'}`} />
                    <span>{displayFavs > 0 ? displayFavs : 'Favorile'}</span>
                  </button>

                  <button
                    onClick={() => togglePersonFollow(person.id, person.name)}
                    title="Takip Et (Yeni dizi/haber bildirimi)"
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                      isFol
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.05] border-white/10 text-white/65 hover:text-white'
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* PAGINATION */}
      <div className="flex items-center justify-center gap-3 pt-6">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="px-5 py-2.5 rounded-full glass-pill text-xs font-semibold text-white disabled:opacity-35 cursor-pointer"
        >
          ← Önceki Sayfa
        </button>
        <span className="text-xs font-mono text-white/60">Sayfa {page + 1}</span>
        <button
          disabled={people.length < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
          className="px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold disabled:opacity-35 cursor-pointer"
        >
          Sonraki Sayfa →
        </button>
      </div>
    </div>
  );
}
