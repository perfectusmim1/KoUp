'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar,
  Clock,
  Bell,
  Play,
  Star,
  Tv,
  Film,
  Sparkles,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import { cachedQuery } from '@/lib/cache';

interface CalendarScheduleItem {
  id: number;
  source_site: string;
  day_of_week: number;
  date_label: string;
  title: string;
  slug: string;
  episode_label: string;
  category: string;
  cover_image: string;
  source_url: string;
  media_id: number | null;
  media?: MediaItem | null;
}

const DAYS = [
  { id: 1, name: 'Pazartesi', short: 'PZT' },
  { id: 2, name: 'Salı', short: 'SAL' },
  { id: 3, name: 'Çarşamba', short: 'ÇAR' },
  { id: 4, name: 'Perşembe', short: 'PER' },
  { id: 5, name: 'Cuma', short: 'CUM' },
  { id: 6, name: 'Cumartesi', short: 'CMT' },
  { id: 7, name: 'Pazar', short: 'PAZ' },
];

const SOURCE_FILTERS = [
  { id: 'all', label: 'Tüm Kaynaklar' },
  { id: 'webdramaturkey', label: 'WebDramaTurkey (K-Drama & C-Drama)' },
  { id: 'dizibox', label: 'DiziBox (Yabancı Dizi & TV)' },
  { id: 'tranimeizle', label: 'Anime Takvimi (AniList)' },
];

export default function CalendarPage() {
  const { followedMediaIds, toggleMediaFollow, triggerSound, pushNotification } =
    useKoUp();

  const [selectedDay, setSelectedDay] = useState<number>(
    ((new Date().getDay() + 6) % 7) + 1
  );
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [schedules, setSchedules] = useState<CalendarScheduleItem[]>([]);
  const [enabledScrapers, setEnabledScrapers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      setIsLoading(true);
      try {
        const cacheKey = `takvim_schedules_${selectedDay}_${selectedSource}`;
        const result = await cachedQuery(cacheKey, 120_000, async () => {
          const params = new URLSearchParams({
            day: String(selectedDay),
          });
          if (selectedSource !== 'all') {
            params.set('source', selectedSource);
          }

          const res = await fetch(`/api/takvim/live?${params.toString()}`);
          return res.json();
        });

        if (cancelled) return;

        if (result?.success && Array.isArray(result?.schedules)) {
          setSchedules(result.schedules);
          setEnabledScrapers(result.enabledScrapers || []);
        } else {
          setSchedules([]);
        }
      } catch (err) {
        if (!cancelled) setSchedules([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [selectedDay, selectedSource]);

  const activeDayName = DAYS.find((d) => d.id === selectedDay)?.name || 'Pazartesi';

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Header Banner Card */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/10 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-white/50 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span>Gerçek Yayın Takvimi • Canlı Scraper & AniList Senkronizasyonu</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Yayın Takvimi & Yeni Bölüm Programı
          </h1>
          <p className="text-sm text-white/60 max-w-2xl">
            Sadece aktif yayını olan güncel seriler listelenir. Admin panelde açık olan
            kaynakların (WebDramaTurkey, DiziBox, AniList) orijinal takvimleriyle anlık
            senkronizedir.
          </p>
        </div>

        {/* 7-Day Selector Tabs */}
        <div className="grid grid-cols-7 gap-1.5 glass-pill-dark p-1.5 rounded-2xl shrink-0">
          {DAYS.map((d) => {
            const active = selectedDay === d.id;
            return (
              <button
                key={d.id}
                onClick={() => {
                  triggerSound?.('click');
                  setSelectedDay(d.id);
                }}
                className={`relative px-3 py-2.5 rounded-xl text-center transition-colors cursor-pointer ${
                  active ? 'text-black font-bold' : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="calendar-day-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-xl bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                  />
                )}
                <div className="relative z-10 text-xs font-mono font-bold">
                  {d.short}
                </div>
                <div className="relative z-10 hidden sm:block text-[10px] opacity-75">
                  {d.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scraper Source Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono text-white/45 mr-1">Kaynak Filtresi:</span>
        {SOURCE_FILTERS.map((sf) => {
          const active = selectedSource === sf.id;
          return (
            <button
              key={sf.id}
              onClick={() => {
                triggerSound?.('click');
                setSelectedSource(sf.id);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer border ${
                active
                  ? 'bg-white text-black font-bold border-white shadow-[0_0_16px_rgba(255,255,255,0.25)]'
                  : 'bg-white/[0.04] text-white/70 border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              {sf.label}
            </button>
          );
        })}
      </div>

      {/* Day Overview Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="text-lg font-bold text-white">
            {activeDayName} Günü Yayınlanan Seriler
          </h2>
          <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/10 text-white/80">
            {schedules.length} Yapım
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-white/50">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Doğrulanmış Orijinal Yayın Günleri</span>
        </div>
      </div>

      {/* Grid of Calendar Items */}
      {isLoading ? (
        <div className="py-24 text-center text-sm font-mono text-white/50 animate-pulse">
          Canlı yayın takvimi ve kaynak bilgileri getiriliyor...
        </div>
      ) : schedules.length === 0 ? (
        <div className="py-24 text-center rounded-3xl apple-glass p-8 border border-white/10 space-y-3">
          <div className="w-12 h-12 rounded-full bg-white/10 mx-auto flex items-center justify-center text-white/60">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">
            {activeDayName} gününe ait aktif yayın bulunamadı
          </h3>
          <p className="text-xs text-white/50 max-w-md mx-auto">
            Bu gün için seçili kaynakta yeni bölüm takvimi bulunmuyor veya ilgili kaynak
            Admin Panelinden devre dışı bırakılmış olabilir.
          </p>
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {schedules.map((item) => {
              const targetSlug = item.media?.slug || item.slug;
              const coverImg =
                item.media?.cover_image ||
                item.cover_image ||
                'https://cdn.webdrama.io/cover/default.jpeg';
              const isFollowed = item.media_id
                ? followedMediaIds.includes(item.media_id)
                : false;

              const sourceBadge =
                item.source_site === 'webdramaturkey'
                  ? { label: 'WebDrama', color: 'bg-amber-400/20 text-amber-300 border-amber-400/30' }
                  : item.source_site === 'dizibox'
                  ? { label: 'DiziBox', color: 'bg-sky-400/20 text-sky-300 border-sky-400/30' }
                  : { label: 'AniList', color: 'bg-indigo-400/20 text-indigo-300 border-indigo-400/30' };

              return (
                <motion.div
                  key={`${item.source_site}-${item.id}`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25 }}
                  className="group rounded-2xl apple-glass cv-card overflow-hidden border border-white/10 hover:border-white/30 transition-all flex flex-col"
                >
                  {/* Poster Thumbnail */}
                  <Link
                    href={`/seri/${targetSlug}`}
                    className="relative aspect-[2/3] w-full overflow-hidden block bg-black/60"
                  >
                    <img
                      src={getProxiedImageUrl(coverImg)}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />

                    {/* Source Site Badge */}
                    <span
                      className={`absolute top-2.5 left-2.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border backdrop-blur-md ${sourceBadge.color}`}
                    >
                      {sourceBadge.label}
                    </span>

                    {/* Episode Badge */}
                    {item.episode_label && (
                      <span className="absolute bottom-2.5 left-2.5 right-2.5 text-[11px] font-mono font-bold px-2 py-1 rounded-xl bg-black/80 backdrop-blur-md text-white border border-white/15 truncate text-center">
                        {item.episode_label}
                      </span>
                    )}
                  </Link>

                  {/* Metadata Card Footer */}
                  <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-white/50 mb-1">
                        <span className="truncate">{item.category || 'Dizi'}</span>
                        {item.date_label && (
                          <span className="truncate ml-1 text-white/70">
                            {item.date_label}
                          </span>
                        )}
                      </div>

                      <Link
                        href={`/seri/${targetSlug}`}
                        className="text-xs sm:text-sm font-bold text-white hover:text-white/80 line-clamp-2 leading-snug"
                      >
                        {item.title}
                      </Link>
                    </div>

                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-1.5">
                      <Link
                        href={`/seri/${targetSlug}`}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-white/10 hover:bg-white text-white hover:text-black text-xs font-mono font-semibold transition-all"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>İzle</span>
                      </Link>

                      {item.media && (
                        <button
                          onClick={() => {
                            if (item.media) toggleMediaFollow(item.media);
                          }}
                          title={isFollowed ? 'Takibi Bırak' : 'Yeni Bölüm Bildirimi Aç'}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
                            isFollowed
                              ? 'bg-white text-black border-white'
                              : 'bg-white/[0.04] border-white/10 text-white/60 hover:text-white'
                          }`}
                        >
                          <Bell className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
