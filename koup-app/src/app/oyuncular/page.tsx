'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Heart,
  Search,
  Users,
  Sparkles,
  Trophy,
  ExternalLink,
  Bell,
} from 'lucide-react';
import {
  supabase,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

export default function ActorsLeaderboardPage() {
  const {
    favPersonIds,
    followedPersonIds,
    togglePersonFavorite,
    togglePersonFollow,
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
        query = query.order('favorites_count', { ascending: false });
      } else {
        query = query.order('drama_count', { ascending: false });
      }

      const { data } = await query;
      setPeople((data as PersonItem[]) || []);
      setIsLoading(false);
    }

    const timer = setTimeout(fetchPeople, 150);
    return () => clearTimeout(timer);
  }, [filterType, searchQuery, sortBy, page]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-8">
      {/* HEADER & FILTER BAR */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-pink-400">
            <Trophy className="w-4 h-4" />
            <span>21.814 Oyuncu, Anime Karakteri & Seiyuu · Canlı Favori Sıralaması</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Oyuncular & Anime Karakterleri Evreni
          </h1>
          <p className="text-sm text-white/65 max-w-2xl">
            En çok favori (❤️) alan K-Drama/C-Drama oyuncularını, AniList anime karakterlerini ve Japonca seslendirmenleri keşfet, favorile ve yorum bırak.
          </p>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/55 border border-white/15">
            <Search className="w-4 h-4 text-sky-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Oyuncu veya anime karakteri ara..."
              className="bg-transparent text-sm text-white placeholder-white/40 focus:outline-none w-56"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'favs' | 'dramas')}
            className="px-4 py-2.5 rounded-full apple-glass-pill text-xs font-semibold text-white cursor-pointer"
          >
            <option value="favs" className="bg-black">
              ❤️ En Çok Favori Alandan Aza
            </option>
            <option value="dramas" className="bg-black">
              🎬 En Çok Yapımda Rol Alan
            </option>
          </select>
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: '✨ Tüm Yıldızlar & Karakterler' },
          { id: 'actor', label: '🎬 Dizi & Sinema Oyuncuları (MDL)' },
          { id: 'character', label: '🎌 Anime Karakterleri (AniList)' },
          { id: 'seiyuu', label: '🎙️ Seslendirmenler (Seiyuu)' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setFilterType(tab.id as typeof filterType);
              setPage(0);
            }}
            className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              filterType === tab.id
                ? 'bg-white text-black shadow-[0_0_24px_rgba(255,255,255,0.4)]'
                : 'apple-glass-pill text-white/75 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* LEADERBOARD GRID */}
      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-sky-400 animate-pulse">
          Oyuncu ve Karakter Sıralaması Yükleniyor...
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {people.map((person, idx) => {
            const rank = page * PAGE_SIZE + idx + 1;
            const isFav = favPersonIds.includes(person.id);
            const isFol = followedPersonIds.includes(person.id);
            const displayFavs = person.favorites_count + (isFav ? 1 : 0);

            return (
              <div
                key={person.id}
                className="koup-projection-card rounded-3xl p-4 bg-[#121216] border border-white/[0.08] flex flex-col justify-between group"
              >
                <div>
                  <div className="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-black/50 border border-white/10">
                    <Link href={`/oyuncu/${person.slug}`}>
                      <img
                        src={getProxiedImageUrl(person.image_url)}
                        alt={person.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </Link>

                    {/* Rank Badge */}
                    <span
                      className={`absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-extrabold border ${
                        rank <= 3
                          ? 'bg-amber-400 text-black border-amber-200 shadow-[0_0_15px_rgba(229,169,60,0.6)]'
                          : 'bg-black/80 text-white border-white/15'
                      }`}
                    >
                      #{rank}
                    </span>

                    {/* Type Badge */}
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/75 backdrop-blur-md text-sky-300 border border-white/10">
                      {person.person_type === 'character'
                        ? '🎌 Karakter'
                        : person.person_type === 'seiyuu'
                        ? '🎙️ Seiyuu'
                        : '🎬 Oyuncu'}
                    </span>
                  </div>

                  <Link
                    href={`/oyuncu/${person.slug}`}
                    className="block text-sm font-bold text-white truncate group-hover:text-sky-300 transition-colors"
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
                        ? 'bg-pink-500/25 border-pink-400 text-pink-300 shadow-[0_0_15px_rgba(236,72,153,0.3)]'
                        : 'bg-white/[0.05] border-white/10 text-pink-300 hover:bg-pink-500/15'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-pink-400' : ''}`} />
                    <span>{displayFavs.toLocaleString('tr-TR')}</span>
                  </button>

                  <button
                    onClick={() => togglePersonFollow(person.id, person.name)}
                    title="Takip Et (Yeni dizi/haber bildirimi)"
                    className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                      isFol
                        ? 'bg-sky-400/25 border-sky-400 text-sky-300'
                        : 'bg-white/[0.05] border-white/10 text-white/65 hover:text-white'
                    }`}
                  >
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
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
