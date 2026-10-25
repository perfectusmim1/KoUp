'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Heart,
  Search,
  Sparkles,
  Bell,
  Clapperboard,
  Mic,
  UserCheck,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  supabase,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import CustomSelect from '@/components/CustomSelect';
import Pagination from '@/components/Pagination';
// KoUp Actors Pagination


const PERSON_TABS = [
  {
    id: 'all',
    label: 'Tüm Yıldızlar & Karakterler',
    icon: Sparkles,
    activePillClass:
      'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'actor',
    label: 'Dizi & Sinema Oyuncuları',
    icon: Clapperboard,
    activePillClass:
      'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_0_18px_rgba(16,185,129,0.45)] border border-emerald-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'character',
    label: 'Anime Karakterleri',
    icon: UserCheck,
    activePillClass:
      'bg-gradient-to-r from-purple-500 to-pink-600 shadow-[0_0_18px_rgba(168,85,247,0.45)] border border-purple-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
  {
    id: 'seiyuu',
    label: 'Seslendirmenler (Seiyuu)',
    icon: Mic,
    activePillClass:
      'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(245,158,11,0.45)] border border-amber-400/40',
    activeTextClass: 'text-white font-extrabold',
  },
] as const;

export default function ActorsLeaderboardPage() {
  const favPersonIds = useKoUpSelector((s) => s.favPersonIds);
  const followedPersonIds = useKoUpSelector((s) => s.followedPersonIds);
  const togglePersonFavorite = useKoUpSelector((s) => s.togglePersonFavorite);
  const togglePersonFollow = useKoUpSelector((s) => s.togglePersonFollow);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const [people, setPeople] = useState<PersonItem[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'actor' | 'character' | 'seiyuu'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'favs' | 'dramas'>('favs');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const PAGE_SIZE = 48;

  useEffect(() => {
    async function fetchPeople() {
      setIsLoading(true);
      try {
        let query = supabase
          .from('people')
          .select('*', { count: 'exact' })
          .range((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE - 1);

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

        const { data: resData, count: resCount } = await query;
        setPeople((resData as PersonItem[]) || []);
        if (typeof resCount === 'number') {
          setTotalCount(resCount);
        }
      } finally {
        setIsLoading(false);
      }
    }

    const timer = setTimeout(fetchPeople, 140);
    return () => clearTimeout(timer);
  }, [filterType, searchQuery, sortBy, currentPage]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* HEADER & FILTER BAR */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Oyuncular & Karakterler
          </h1>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] mx-auto sm:mx-0">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Oyuncu veya anime karakteri ara..."
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56 sm:w-64 font-medium"
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

          <div className="mx-auto sm:mx-0">
            <CustomSelect
              value={sortBy}
              onChange={(val) => {
                setSortBy(val as 'favs' | 'dramas');
                setCurrentPage(1);
              }}
              variant="pill"
              options={[
                {
                  value: 'favs',
                  label: 'En Çok Favorilenenler',
                  icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
                },
                {
                  value: 'dramas',
                  label: 'En Çok Yapımda Rol Alan',
                  icon: <Clapperboard className="w-3.5 h-3.5 text-sky-400" />,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* CATEGORY TABS WITH FLUID SPRING PILL */}
      <div className="overflow-x-auto no-scrollbar pb-1.5 [-webkit-overflow-scrolling:touch]">
        <div className="inline-flex items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10">
          {PERSON_TABS.map((tab, idx, arr) => {
            const Icon = tab.icon;
            const active = filterType === tab.id;
            const prevTab = idx > 0 ? arr[idx - 1] : null;
            const nextTab = idx < arr.length - 1 ? arr[idx + 1] : null;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  triggerSound('click');
                  setFilterType(tab.id);
                  setCurrentPage(1);
                }}
                className={`relative shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-[color,transform] duration-75 cursor-pointer select-none touch-manipulation active:scale-95 ${
                  active ? tab.activeTextClass : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="oyuncular-tab-active-pill"
                    drag="x"
                    dragConstraints={{ left: -45, right: 45 }}
                    dragElastic={0.2}
                    dragSnapToOrigin
                    onDragEnd={(_, info) => {
                      if (info.offset.x > 25 && nextTab) {
                        triggerSound('click');
                        setFilterType(nextTab.id);
                        setCurrentPage(1);
                      } else if (info.offset.x < -25 && prevTab) {
                        triggerSound('click');
                        setFilterType(prevTab.id);
                        setCurrentPage(1);
                      }
                    }}
                    initial={false}
                    transition={{ type: 'spring', stiffness: 520, damping: 35, mass: 0.5 }}
                    className={`absolute inset-0 rounded-xl ${tab.activePillClass} z-0 cursor-grab active:cursor-grabbing select-none`}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10 pointer-events-none" />
                <span className="relative z-10 pointer-events-none">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* LEADERBOARD GRID */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="rounded-3xl p-4 bg-[#0f0f11] border border-white/[0.06] animate-pulse flex flex-col justify-between"
            >
              <div className="aspect-square rounded-2xl bg-white/[0.04] mb-3" />
              <div className="h-4 w-3/4 rounded-lg bg-white/[0.06] mb-2" />
              <div className="h-3 w-1/2 rounded-lg bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="py-24 text-center rounded-3xl bg-[#0f0f11] border border-white/10">
          <p className="text-base text-white/70">
            Aramanıza uygun oyuncu veya karakter bulunamadı.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {people.map((person, idx) => {
            const rank = (currentPage - 1) * PAGE_SIZE + idx + 1;
            const isFav = favPersonIds.includes(person.id);
            const isFol = followedPersonIds.includes(person.id);
            const displayFavs = person.favorites_count || 0;

            return (
              <div
                key={person.id}
                className="rounded-3xl p-4 flex flex-col justify-between group bg-[#0f0f11] border border-white/[0.08] hover:border-white/30 hover:shadow-[0_0_24px_-4px_rgba(41,151,255,0.25),0_10px_24px_rgba(0,0,0,0.7)] transition-all duration-200"
              >
                <div>
                  <div className="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-black/50 border border-white/10 group-hover:border-white/30 transition-colors">
                    <Link href={`/oyuncu/${person.slug}`}>
                      <img
                        src={getProxiedImageUrl(person.image_url, person.name, null, 'w500', 'person', person.tmdb_id)}
                        alt={person.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
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
                    onClick={async () => {
                      const wasFav = favPersonIds.includes(person.id);
                      setPeople((prev) =>
                        prev.map((p) =>
                          p.id === person.id
                            ? {
                                ...p,
                                favorites_count: Math.max(
                                  0,
                                  (p.favorites_count || 0) + (wasFav ? -1 : 1)
                                ),
                              }
                            : p
                        )
                      );
                      await togglePersonFavorite(person.id, person.name);
                    }}
                    title={isFav ? 'Favorilerimde' : 'Favorilere Ekle (Beğen)'}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-full text-xs font-mono font-bold border transition-colors cursor-pointer ${
                      isFav
                        ? 'bg-rose-500 border-rose-400 text-white shadow-[0_0_12px_rgba(244,63,94,0.35)]'
                        : 'bg-white/[0.05] border-white/10 text-white/85 hover:bg-white/10'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : 'text-rose-400'}`} />
                    <span>{displayFavs > 0 ? displayFavs : 'Favorile'}</span>
                  </button>

                  <button
                    onClick={() => togglePersonFollow(person.id, person.name)}
                    aria-label={isFol ? 'Takibi Bırak' : 'Takip Et (Yeni Seri Bildirimi)'}
                    title={isFol ? 'Takip Ediliyor (Yeni seriler bildirilecek)' : 'Takip Et (Yeni serilerinde bildirim al)'}
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
                      isFol
                        ? 'bg-sky-400 text-slate-950 border-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                        : 'bg-white/[0.05] border-white/10 text-white/65 hover:text-white'
                    }`}
                  >
                    <Bell className={`w-3.5 h-3.5 ${isFol ? 'fill-slate-950' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {!isLoading && (
        <Pagination
          currentPage={currentPage}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setCurrentPage}
          itemLabel="oyuncu ve anime karakterinden"
          scrollToOffset={180}
        />
      )}
    </div>
  );
}
