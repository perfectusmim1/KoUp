'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar,
  Bell,
  Play,
  ShieldCheck,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
  cleanMediaTitle,
} from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import { cachedQuery, getCache } from '@/lib/cache';

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

function isScheduleAnime(item: CalendarScheduleItem): boolean {
  return (
    item.source_site === 'tranimeizle' ||
    item.source_site === 'animecix' ||
    item.source_site === 'asyaanimeleri' ||
    Boolean(item.category?.toLowerCase().includes('anime')) ||
    Boolean(item.category?.toLowerCase().includes('donghua')) ||
    item.media?.content_type === 'anime'
  );
}

function isScheduleKdrama(item: CalendarScheduleItem): boolean {
  if (isScheduleAnime(item)) return false;
  return (
    item.source_site === 'dizikorea' ||
    Boolean(item.category?.toLowerCase().includes('kore')) ||
    Boolean(item.category?.toLowerCase().includes('k-drama')) ||
    Boolean(item.category?.toLowerCase().includes('çin')) ||
    item.media?.country_code === 'KR' ||
    item.media?.country_code === 'CN'
  );
}

function cleanScheduleCategory(category?: string | null): string {
  if (!category) return 'Dizi';
  const trimmed = category.trim();
  if (trimmed.startsWith('{') || trimmed.includes('_id')) {
    try {
      const parsed = JSON.parse(trimmed);
      const name = parsed.display_name || parsed.name;
      if (name) {
        if (/anim/i.test(name)) return 'Anime';
        if (/action|aksiyon/i.test(name)) return 'Aksiyon';
        if (/drama|dram/i.test(name)) return 'Dram';
        if (/comedy|komedi/i.test(name)) return 'Komedi';
        return name;
      }
    } catch {}
    if (/anim/i.test(trimmed)) return 'Anime';
    if (/action|aksiyon/i.test(trimmed)) return 'Aksiyon';
    if (/drama|dram/i.test(trimmed)) return 'Dram';
    return 'Dizi';
  }
  return trimmed;
}

function getScheduleDayLabel(item: CalendarScheduleItem): string {
  if (item.date_label && !item.date_label.includes('{')) {
    return item.date_label;
  }
  const day = DAYS.find((d) => d.id === item.day_of_week);
  return day ? day.name : 'Pazartesi';
}

export default function CalendarPage() {
  const followedMediaIds = useKoUpSelector((s) => s.followedMediaIds);
  const toggleMediaFollow = useKoUpSelector((s) => s.toggleMediaFollow);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);

  const todayDay = ((new Date().getDay() + 6) % 7) + 1;
  const initialData = getCache<{ success: boolean; schedules: CalendarScheduleItem[]; enabledScrapers: string[] }>(
    `takvim_schedules_${todayDay}`,
    true
  );

  const [selectedDay, setSelectedDay] = useState<number>(todayDay);
  const [schedules, setSchedules] = useState<CalendarScheduleItem[]>(() => initialData?.schedules || []);
  const [enabledScrapers, setEnabledScrapers] = useState<string[]>(() => initialData?.enabledScrapers || []);
  const [isLoading, setIsLoading] = useState(() => !initialData?.schedules || initialData.schedules.length === 0);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      const cacheKey = `takvim_schedules_${selectedDay}`;
      const cached = getCache<{ success: boolean; schedules: CalendarScheduleItem[]; enabledScrapers: string[] }>(
        cacheKey,
        true
      );
      if (cached?.schedules && cached.schedules.length > 0) {
        setSchedules(cached.schedules);
        setEnabledScrapers(cached.enabledScrapers || []);
        setIsLoading(false);
      } else if (schedules.length === 0) {
        setIsLoading(true);
      }

      try {
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
        if (!cancelled && schedules.length === 0) setSchedules([]);
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

  const displayedSchedules = schedules;

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Header Banner Card */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/10 shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Yayın Takvimi
          </h1>
        </div>

        {/* 7-Day Selector Tabs */}
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5 glass-pill-dark p-1 sm:p-1.5 rounded-2xl shrink-0 w-full lg:w-auto">
          {DAYS.map((d) => {
            const active = selectedDay === d.id;
            return (
              <button
                key={d.id}
                onClick={() => {
                  triggerSound?.('click');
                  setSelectedDay(d.id);
                }}
                className={`flex flex-col items-center justify-center text-center w-full min-w-0 p-1 sm:p-2.5 rounded-xl cursor-pointer relative transition-colors ${
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
                <span className="w-full text-center relative z-10 text-xs font-mono font-bold">
                  {d.short}
                </span>
                <span className="w-full text-center relative z-10 hidden sm:block text-[10px] opacity-75">
                  {d.name}
                </span>
              </button>
            );
          })}
        </div>
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
      {isLoading && displayedSchedules.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-3xl bg-white/[0.03] border border-white/[0.06] animate-pulse"
            />
          ))}
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
            Seçili gün için yeni bölüm yayını bulunmuyor.
          </p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedDay}
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
                item.media?.poster_fallback_url ||
                '/logo-dark.png';
              const isFollowed = item.media_id
                ? followedMediaIds.includes(item.media_id)
                : false;

              const cleanCat = cleanScheduleCategory(item.category);
              const dayLabel = getScheduleDayLabel(item);

              const categoryBadge = isScheduleAnime(item)
                ? { label: 'ANİME', color: 'bg-[#1b1035] text-purple-200 border-purple-400/60 shadow-md font-bold' }
                : (item.media?.country_code === 'KR' || cleanCat.toLowerCase().includes('kore'))
                ? { label: 'K-DRAMA', color: 'bg-[#0c1d33] text-sky-200 border-sky-400/60 shadow-md font-bold' }
                : (item.media?.country_code === 'CN' || cleanCat.toLowerCase().includes('çin'))
                ? { label: 'C-DRAMA', color: 'bg-[#2a1708] text-amber-200 border-amber-400/60 shadow-md font-bold' }
                : { label: cleanCat || 'DİZİ', color: 'bg-[#0f1d2e] text-blue-200 border-blue-400/60 shadow-md font-bold' };

              return (
                <div
                  key={`${item.source_site}-${item.id}`}
                  className="group rounded-2xl apple-glass cv-card overflow-hidden border border-white/10 hover:border-white/30 transition-[border-color] duration-200 flex flex-col [content-visibility:auto] [contain-intrinsic-size:auto_380px]"
                >
                  {/* Poster Thumbnail */}
                  <Link
                    href={`/seri/${targetSlug}`}
                    className="relative aspect-[2/3] w-full overflow-hidden block bg-black/60"
                  >
                    <img
                      src={getProxiedImageUrl(
                        coverImg,
                        item.media?.poster_fallback_url || item.cover_image,
                        item.title,
                        'w500',
                        'media',
                        item.media?.tmdb_id,
                        item.media?.content_type === 'film' || item.media?.content_type === 'movie' ? 'movie' : 'tv',
                        item.media?.release_year,
                        item.media?.native_title
                      )}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (!target.dataset.triedMedia && item.media?.cover_image && target.src !== item.media.cover_image) {
                          target.dataset.triedMedia = 'true';
                          target.src = item.media.cover_image;
                        } else if (!target.dataset.triedFallback && item.media?.poster_fallback_url) {
                          target.dataset.triedFallback = 'true';
                          target.src = item.media.poster_fallback_url;
                        } else if (!target.dataset.triedTmdb && item.title) {
                          target.dataset.triedTmdb = 'true';
                          target.src = `/api/image-proxy?title=${encodeURIComponent(item.title)}&type=media`;
                        }
                      }}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />

                    {/* Category Badge - Opaque High Contrast */}
                    <span
                      className={`absolute top-2.5 left-2.5 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border shadow-md ${categoryBadge.color}`}
                    >
                      {categoryBadge.label}
                    </span>

                    {/* Day Badge - Replaced Episode Count as Requested */}
                    <span className="absolute bottom-2.5 left-2.5 right-2.5 text-[11px] font-mono font-bold px-2 py-1 rounded-xl bg-black/90 text-white border border-white/25 truncate text-center shadow-md flex items-center justify-center gap-1.5">
                      <Calendar className="w-3 h-3 text-sky-400 shrink-0" />
                      <span>{dayLabel}</span>
                    </span>
                  </Link>

                  {/* Metadata Card Footer */}
                  <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-white/50 mb-1">
                        <span className="truncate max-w-[60%]">{cleanCat}</span>
                        <span className="truncate ml-1 text-white/70">
                          {dayLabel}
                        </span>
                      </div>

                      <Link
                        href={`/seri/${targetSlug}`}
                        className="text-xs sm:text-sm font-bold text-white hover:text-white/80 line-clamp-2 leading-snug"
                      >
                        {cleanMediaTitle(item.title)}
                      </Link>
                    </div>

                    <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-1.5">
                      <Link
                        href={`/seri/${targetSlug}`}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl bg-white/10 hover:bg-white text-white hover:text-black text-xs font-mono font-semibold transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>İzle</span>
                      </Link>

                      {item.media && (
                        <button
                          onClick={() => {
                            if (item.media) toggleMediaFollow(item.media);
                          }}
                          aria-label={isFollowed ? 'Takibi Bırak' : 'Yeni Bölüm Bildirimi Aç'}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors cursor-pointer border ${
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
