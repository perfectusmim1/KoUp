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

const CATEGORY_FILTERS = [
  { id: 'all', label: 'Tüm Kategoriler' },
  { id: 'kdrama', label: 'K-Drama & Asya Dizileri' },
  { id: 'anime', label: 'Animeler' },
  { id: 'dizi', label: 'Popüler & Global Diziler' },
];

function isScheduleAnime(item: CalendarScheduleItem): boolean {
  return (
    item.source_site === 'tranimeizle' ||
    item.source_site === 'animecix' ||
    Boolean(item.category?.toLowerCase().includes('anime')) ||
    item.media?.content_type === 'anime'
  );
}

function isScheduleKdrama(item: CalendarScheduleItem): boolean {
  if (isScheduleAnime(item)) return false;
  return (
    item.source_site === 'webdramaturkey' ||
    Boolean(item.category?.toLowerCase().includes('kore')) ||
    Boolean(item.category?.toLowerCase().includes('k-drama')) ||
    Boolean(item.category?.toLowerCase().includes('çin')) ||
    item.media?.country_code === 'KR' ||
    item.media?.country_code === 'CN'
  );
}

export default function CalendarPage() {
  const { followedMediaIds, toggleMediaFollow, triggerSound, pushNotification } =
    useKoUp();

  const [selectedDay, setSelectedDay] = useState<number>(
    ((new Date().getDay() + 6) % 7) + 1
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [schedules, setSchedules] = useState<CalendarScheduleItem[]>([]);
  const [enabledScrapers, setEnabledScrapers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      setIsLoading(true);
      try {
        const cacheKey = `takvim_schedules_${selectedDay}`;
        const result = await cachedQuery(cacheKey, 120_000, async () => {
          const params = new URLSearchParams({
            day: String(selectedDay),
          });

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
  }, [selectedDay]);

  const activeDayName = DAYS.find((d) => d.id === selectedDay)?.name || 'Pazartesi';

  const displayedSchedules = schedules.filter((item) => {
    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'anime') return isScheduleAnime(item);
    if (selectedCategory === 'kdrama') return isScheduleKdrama(item);
    if (selectedCategory === 'dizi') return !isScheduleAnime(item) && !isScheduleKdrama(item);
    return true;
  });

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Header Banner Card */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/10 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-white/50 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sky-400" />
            <span>Yayın Takvimi • Canlı Yayın Akışı & Yeni Bölümler</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Yayın Takvimi & Yeni Bölüm Programı
          </h1>
          <p className="text-sm text-white/60 max-w-2xl">
            Aktif yayını devam eden Kore dizileri, Asya yapımları ve popüler animelerin haftalık yayın programı. Yeni bölümler yayınlandığı gün güncellenir.
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

      {/* Category Filter Pills (Internal Scraper Sources Completely Removed) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-mono text-white/45 mr-1">Kategori:</span>
        {CATEGORY_FILTERS.map((cf) => {
          const active = selectedCategory === cf.id;
          return (
            <button
              key={cf.id}
              onClick={() => {
                triggerSound?.('click');
                setSelectedCategory(cf.id);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer border ${
                active
                  ? 'bg-white text-black font-bold border-white shadow-[0_0_16px_rgba(255,255,255,0.25)]'
                  : 'bg-white/[0.04] text-white/70 border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              {cf.label}
            </button>
          );
        })}
      </div>

      {/* Day Overview Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
          <h2 className="text-lg font-bold text-white">
            {activeDayName} Günü Yayınlanan Seriler
          </h2>
          <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/10 text-white/80">
            {displayedSchedules.length} Yapım
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-white/50">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
          <span>Doğrulanmış Orijinal Yayın Günleri</span>
        </div>
      </div>

      {/* Grid of Calendar Items */}
      {isLoading ? (
        <div className="py-24 text-center text-sm font-mono text-white/50 animate-pulse">
          Canlı yayın takvimi ve program bilgileri getiriliyor...
        </div>
      ) : displayedSchedules.length === 0 ? (
        <div className="py-24 text-center rounded-3xl apple-glass p-8 border border-white/10 space-y-3">
          <div className="w-12 h-12 rounded-full bg-white/10 mx-auto flex items-center justify-center text-white/60">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">
            {activeDayName} gününe ait aktif yayın bulunamadı
          </h3>
          <p className="text-xs text-white/50 max-w-md mx-auto">
            Seçili gün veya kategori için yeni bölüm yayını bulunmuyor.
          </p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${selectedDay}-${selectedCategory}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4"
          >
            {displayedSchedules.map((item) => {
              const targetSlug = item.media?.slug || item.slug;
              const coverImg =
                item.media?.cover_image ||
                item.cover_image ||
                'https://cdn.webdrama.io/cover/default.jpeg';
              const isFollowed = item.media_id
                ? followedMediaIds.includes(item.media_id)
                : false;

              const categoryBadge = isScheduleAnime(item)
                ? { label: 'ANİME', color: 'bg-[#1b1035] text-purple-200 border-purple-400/60 shadow-md font-bold' }
                : (item.media?.country_code === 'KR' || item.category?.toLowerCase().includes('kore'))
                ? { label: 'K-DRAMA', color: 'bg-[#0c1d33] text-sky-200 border-sky-400/60 shadow-md font-bold' }
                : (item.media?.country_code === 'CN' || item.category?.toLowerCase().includes('çin'))
                ? { label: 'C-DRAMA', color: 'bg-[#2a1708] text-amber-200 border-amber-400/60 shadow-md font-bold' }
                : { label: item.category || 'DİZİ', color: 'bg-[#0f1d2e] text-blue-200 border-blue-400/60 shadow-md font-bold' };

              return (
                <div
                  key={`${item.source_site}-${item.id}`}
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

                    {/* Category Badge - Opaque High Contrast */}
                    <span
                      className={`absolute top-2.5 left-2.5 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border shadow-md ${categoryBadge.color}`}
                    >
                      {categoryBadge.label}
                    </span>

                    {/* Episode Badge - Opaque High Contrast */}
                    {item.episode_label && (
                      <span className="absolute bottom-2.5 left-2.5 right-2.5 text-[11px] font-mono font-bold px-2 py-1 rounded-xl bg-black/90 backdrop-blur-md text-white border border-white/25 truncate text-center shadow-md">
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
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
