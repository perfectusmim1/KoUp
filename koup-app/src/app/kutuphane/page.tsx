'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Library,
  Sparkles,
  Clock,
  CheckCircle2,
  Bookmark,
  PauseCircle,
  XCircle,
  Search,
  Filter,
  Compass,
  LogIn,
  Tv,
  Film,
  Layers,
  BarChart2,
  ChevronRight,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import { supabase, MediaItem } from '@/lib/supabase';
import AccordionMediaCard from '@/components/AccordionMediaCard';

type LibraryStatus = 'ALL' | 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped';
type ContentTypeFilter = 'ALL' | 'drama' | 'anime' | 'movie';

export default function KutuphanePage() {
  const { user, progressMap, setIsAuthModalOpen, triggerSound } = useKoUp();

  const [activeStatus, setActiveStatus] = useState<LibraryStatus>('ALL');
  const [activeType, setActiveType] = useState<ContentTypeFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryMedia, setLibraryMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load user's media items from progressMap
  useEffect(() => {
    let isMounted = true;
    async function loadLibrary() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const mediaIds = Object.keys(progressMap).map(Number).filter((n) => !isNaN(n) && n > 0);

      if (mediaIds.length === 0) {
        if (isMounted) {
          setLibraryMedia([]);
          setIsLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('media')
          .select('*')
          .in('id', mediaIds);

        if (!error && data && isMounted) {
          setLibraryMedia(data as MediaItem[]);
        }
      } catch (err) {
        console.error('Failed to load library media:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadLibrary();
    return () => {
      isMounted = false;
    };
  }, [user, progressMap]);

  // Compute status metrics
  const statusCounts = useMemo(() => {
    const counts = {
      ALL: libraryMedia.length,
      watching: 0,
      completed: 0,
      plan_to_watch: 0,
      on_hold: 0,
      dropped: 0,
    };

    libraryMedia.forEach((m) => {
      const prog = progressMap[m.id];
      const st = prog?.status as LibraryStatus | undefined;
      if (st && counts[st] !== undefined) {
        counts[st]++;
      }
    });

    return counts;
  }, [libraryMedia, progressMap]);

  // Filtered media list
  const filteredMedia = useMemo(() => {
    return libraryMedia.filter((item) => {
      // 1. Status Filter
      if (activeStatus !== 'ALL') {
        const prog = progressMap[item.id];
        if (prog?.status !== activeStatus) return false;
      }

      // 2. Type Filter
      if (activeType !== 'ALL') {
        const itemType = (item.content_type || '').toLowerCase();
        if (activeType === 'drama' && itemType !== 'drama' && itemType !== 'series' && itemType !== 'dizi') {
          return false;
        }
        if (activeType === 'anime' && itemType !== 'anime') {
          return false;
        }
        if (activeType === 'movie' && itemType !== 'movie' && itemType !== 'film') {
          return false;
        }
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (item.title || '').toLowerCase().includes(q);
        const matchOriginal = (item.original_title || '').toLowerCase().includes(q);
        if (!matchTitle && !matchOriginal) return false;
      }

      return true;
    });
  }, [libraryMedia, activeStatus, activeType, searchQuery, progressMap]);

  // If user is not logged in
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-2xl">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Library className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Kişisel Kütüphanem
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              İzlediğiniz, planladığınız ve bitirdiğiniz yapımları kaydetmek ve düzenlemek için lütfen giriş yapın.
            </p>
          </div>

          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/20 text-sky-400 text-xs font-mono font-semibold">
            <Library className="w-3.5 h-3.5" />
            <span>Koleksiyon & Takip Yönetimi</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Kütüphanem
          </h1>
          <p className="text-xs sm:text-sm text-white/55 max-w-2xl">
            İzlemekte olduğunuz, tamamladığınız, planladığınız ve duraklattığınız tüm Asya dizileri ve animeleri tek ekrandan yönetin.
          </p>
        </div>

        {/* Action Link to Discover */}
        <Link
          href="/kesfet"
          onClick={() => triggerSound('click')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-all self-start md:self-auto cursor-pointer"
        >
          <Compass className="w-4 h-4 text-sky-400" />
          <span>Katalogdan Yapım Keşfet</span>
        </Link>
      </div>

      {/* Metric Breakdown Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { id: 'ALL' as const, label: 'Toplam Yapım', count: statusCounts.ALL, icon: Sparkles, color: 'text-white', border: 'border-white/15' },
          { id: 'watching' as const, label: 'İzleniyor', count: statusCounts.watching, icon: Clock, color: 'text-sky-400', border: 'border-sky-500/30' },
          { id: 'completed' as const, label: 'Tamamlandı', count: statusCounts.completed, icon: CheckCircle2, color: 'text-[#2997ff]', border: 'border-blue-500/30' },
          { id: 'plan_to_watch' as const, label: 'Planlanan', count: statusCounts.plan_to_watch, icon: Bookmark, color: 'text-amber-400', border: 'border-amber-500/30' },
          { id: 'on_hold' as const, label: 'Beklemede', count: statusCounts.on_hold, icon: PauseCircle, color: 'text-purple-400', border: 'border-purple-500/30' },
          { id: 'dropped' as const, label: 'Bıraktım', count: statusCounts.dropped, icon: XCircle, color: 'text-rose-400', border: 'border-rose-500/30' },
        ].map((item) => {
          const Icon = item.icon;
          const isSelected = activeStatus === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                triggerSound('click');
                setActiveStatus(item.id);
              }}
              className={`p-4 rounded-3xl border transition-all cursor-pointer text-left ${
                isSelected
                  ? 'bg-white/[0.1] border-sky-400/60 shadow-[0_0_20px_rgba(41,151,255,0.2)]'
                  : 'bg-[#0f0f12]/90 border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-medium text-white/50">{item.label}</span>
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <div className="text-2xl font-black text-white mt-2 font-mono">
                {item.count}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        {/* Status Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
          {[
            { id: 'ALL' as const, label: 'Tümü' },
            { id: 'watching' as const, label: 'İzleniyor' },
            { id: 'completed' as const, label: 'Tamamlandı' },
            { id: 'plan_to_watch' as const, label: 'Planlanan' },
            { id: 'on_hold' as const, label: 'Beklemede' },
            { id: 'dropped' as const, label: 'Bıraktım' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => {
                triggerSound('click');
                setActiveStatus(st.id);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer shrink-0 ${
                activeStatus === st.id
                  ? 'bg-white text-black shadow-md'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Content Type Filter & Search Input */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/[0.05] border border-white/10 shrink-0">
            {[
              { id: 'ALL' as const, label: 'Hepsi' },
              { id: 'drama' as const, label: 'Dizi' },
              { id: 'anime' as const, label: 'Anime' },
              { id: 'movie' as const, label: 'Film' },
            ].map((tp) => (
              <button
                key={tp.id}
                onClick={() => {
                  triggerSound('click');
                  setActiveType(tp.id);
                }}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                  activeType === tp.id
                    ? 'bg-sky-500 text-black font-bold'
                    : 'text-white/60 hover:text-white'
                }`}
              >
                {tp.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Kütüphanede ara..."
              className="w-full pl-8 pr-3 py-1.5 rounded-full bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400"
            />
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      {isLoading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(56,189,248,0.4)]" />
            <p className="text-xs text-white/50 font-mono tracking-wider">Kütüphaneniz yükleniyor...</p>
          </div>
        </div>
      ) : filteredMedia.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <Library className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aradığınız kriterde yapım bulunamadı'
                : 'Bu filtrede henüz bir yapım bulunmuyor'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              {searchQuery.trim()
                ? 'Farklı bir arama terimi deneyebilir veya filtreleri sıfırlayabilirsiniz.'
                : 'Katalogdan dizi ve anime keşfederek kütüphanenize ekleyebilir veya durumlarını güncelleyebilirsiniz.'}
            </p>
          </div>
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-md"
          >
            <Compass className="w-4 h-4" />
            <span>Katalogdan Yapım Ekle</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
          {filteredMedia.map((m) => (
            <AccordionMediaCard key={m.id} item={m} fluidWidth={true} />
          ))}
        </div>
      )}
    </div>
  );
}
