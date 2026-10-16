'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  Play,
  Trash2,
  Search,
  Compass,
  LogIn,
  CheckCircle2,
  Film,
  Sparkles,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import { getProxiedImageUrl, UserMediaProgress } from '@/lib/supabase';

type HistoryFilter = 'ALL' | 'in_progress' | 'completed';

export default function WatchHistoryPage() {
  const {
    user,
    progressMap,
    continueWatchingList,
    setIsAuthModalOpen,
    triggerSound,
  } = useKoUp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<HistoryFilter>('ALL');

  // Collect all history items from progressMap that have media or progress
  const allHistoryItems = useMemo(() => {
    return Object.values(progressMap)
      .filter((item) => item.media || item.resume_position_sec > 0 || (item.watched_episodes && item.watched_episodes.length > 0))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [progressMap]);

  // Filtered list
  const filteredHistory = useMemo(() => {
    return allHistoryItems.filter((item) => {
      const media = item.media;
      const progressPct =
        item.resume_duration_sec > 0
          ? Math.min(100, Math.round((item.resume_position_sec / item.resume_duration_sec) * 100))
          : 0;

      // Filter by progress status
      if (filterType === 'in_progress') {
        if (progressPct >= 95 || item.status === 'completed') return false;
      } else if (filterType === 'completed') {
        if (progressPct < 95 && item.status !== 'completed') return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (media?.title || '').toLowerCase().includes(q);
        const matchEp = (item.last_episode_title || '').toLowerCase().includes(q);
        if (!matchTitle && !matchEp) return false;
      }

      return true;
    });
  }, [allHistoryItems, filterType, searchQuery]);

  // Helper format seconds
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  // If user is not logged in
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-2xl">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Clock className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              İzleme Geçmişim
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              Kaldığınız dakikaları senkronize etmek ve geçmişinizi görüntülemek için lütfen giriş yapın.
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
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/20 text-sky-400 text-xs font-mono font-semibold">
            <Clock className="w-3.5 h-3.5" />
            <span>Oynatma İlerlemesi & Geçmiş</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            İzleme Geçmişim
          </h1>
          <p className="text-xs sm:text-sm text-white/55 max-w-2xl">
            Tüm cihazlarınızda senkronize edilen izleme geçmişiniz, kaldığınız bölüm ve dakika detayları.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-all cursor-pointer"
          >
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Yeni İçerik Keşfet</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
          {[
            { id: 'ALL' as const, label: `Tüm Geçmiş (${allHistoryItems.length})` },
            { id: 'in_progress' as const, label: 'Kaldığım Yerden Devam Et' },
            { id: 'completed' as const, label: 'Tamamlananlar' },
          ].map((flt) => (
            <button
              key={flt.id}
              onClick={() => {
                triggerSound('click');
                setFilterType(flt.id);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer shrink-0 ${
                filterType === flt.id
                  ? 'bg-white text-black shadow-md'
                  : 'bg-white/[0.05] text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {flt.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Geçmişte yapım ara..."
            className="w-full pl-8 pr-3 py-1.5 rounded-full bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400"
          />
        </div>
      </div>

      {/* Grid of History Cards */}
      {filteredHistory.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <Clock className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aramanıza uygun bir izleme kaydı bulunamadı'
                : 'Henüz izleme geçmişiniz bulunmuyor'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              Dizilerin bölümlerini oynatmaya başladığınızda kaldığınız dakika ve saniye otomatik olarak burada listelenecektir.
            </p>
          </div>
          <Link
            href="/kesfet"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-md"
          >
            <Compass className="w-4 h-4" />
            <span>Dizi & Anime Keşfet</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredHistory.map((item) => {
            const media = item.media;
            const progressPct =
              item.resume_duration_sec > 0
                ? Math.min(
                    100,
                    Math.round((item.resume_position_sec / item.resume_duration_sec) * 100)
                  )
                : 0;

            const remainingSec = Math.max(
              0,
              (item.resume_duration_sec || 0) - (item.resume_position_sec || 0)
            );

            const playUrl = media?.slug
              ? `/seri/${media.slug}/${item.last_episode_num || 1}`
              : `/seri/${item.media_id}`;

            return (
              <div
                key={item.media_id}
                className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-4 sm:p-5 flex gap-4 hover:border-white/20 transition-all group relative overflow-hidden shadow-xl"
              >
                {/* Poster image */}
                <Link
                  href={playUrl}
                  onClick={() => triggerSound('click')}
                  className="relative w-24 h-34 sm:w-28 sm:h-38 rounded-2xl overflow-hidden bg-black/60 shrink-0 border border-white/10 group-hover:border-sky-400/50 transition-colors"
                >
                  {media?.cover_image ? (
                    <img
                      src={getProxiedImageUrl(media.cover_image, media.title)}
                      alt={media.title || 'Kapak'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-white/30">
                      <Film className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center text-white group-hover:scale-110 group-hover:bg-sky-500 group-hover:text-black group-hover:border-transparent transition-all shadow-lg">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </div>
                  </div>
                </Link>

                {/* Content Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/70">
                        {media?.content_type === 'anime' ? 'ANİME' : 'DİZİ'}
                      </span>
                      {progressPct >= 95 ? (
                        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Bitti</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-sky-400 font-semibold">
                          %{progressPct} İzlendi
                        </span>
                      )}
                    </div>

                    <Link
                      href={playUrl}
                      onClick={() => triggerSound('click')}
                      className="block mt-1 text-sm sm:text-base font-bold text-white hover:text-sky-300 transition-colors truncate"
                    >
                      {media?.title || `Yapım #${item.media_id}`}
                    </Link>

                    <div className="text-xs text-white/60 font-mono mt-0.5">
                      {item.last_season_num || 1}. Sezon · {item.last_episode_num || 1}. Bölüm
                    </div>

                    {item.last_episode_title && (
                      <p className="text-[11px] text-white/45 truncate mt-0.5">
                        {item.last_episode_title}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2.5 mt-3">
                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-white/50">
                        <span>
                          {item.resume_position_sec > 0
                            ? `${formatTime(item.resume_position_sec)} / ${formatTime(
                                item.resume_duration_sec || 3600
                              )}`
                            : 'Başlanmadı'}
                        </span>
                        {remainingSec > 0 && <span>{formatTime(remainingSec)} kaldı</span>}
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-sky-400 rounded-full transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Resume Action Button */}
                    <Link
                      href={playUrl}
                      onClick={() => triggerSound('click')}
                      className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all w-fit shadow-md cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-black" />
                      <span>Kaldığın Yerden Oynat</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
