'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Clock, Bell, Play } from 'lucide-react';
import {
  supabase,
  MediaItem,
  getProxiedImageUrl,
  COUNTRY_FLAGS,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

const DAYS = [
  { id: 1, name: 'Pazartesi', short: 'PZT' },
  { id: 2, name: 'Salı', short: 'SAL' },
  { id: 3, name: 'Çarşamba', short: 'ÇAR' },
  { id: 4, name: 'Perşembe', short: 'PER' },
  { id: 5, name: 'Cuma', short: 'CUM' },
  { id: 6, name: 'Cumartesi', short: 'CMT' },
  { id: 7, name: 'Pazar', short: 'PAZ' },
];

export default function CalendarPage() {
  const { followedMediaIds, toggleMediaFollow } = useKoUp();
  const [selectedDay, setSelectedDay] = useState<number>(
    ((new Date().getDay() + 6) % 7) + 1
  );
  const [dayItems, setDayItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDaySchedule() {
      setIsLoading(true);
      const { data } = await supabase
        .from('media')
        .select('*')
        .contains('air_days', [selectedDay])
        .order('sources_count', { ascending: false })
        .limit(24);
      setDayItems((data as MediaItem[]) || []);
      setIsLoading(false);
    }
    loadDaySchedule();
  }, [selectedDay]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-8">
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-widest text-emerald-400 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>Haftalık Yayın & Çeviri Takvimi · Canlı Geri Sayım</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white">
            Yayın Takvimi & Yeni Bölüm Saatleri
          </h1>
          <p className="text-sm text-white/65 max-w-2xl">
            Haftanın 7 günü yayınlanan Kore, Çin, Tayland dizileri ve animelerin yeni bölüm saatlerini takip et, bildirim zilini aç.
          </p>
        </div>

        {/* 7-Day Selector Tabs */}
        <div className="grid grid-cols-7 gap-1.5 bg-black/50 p-1.5 rounded-2xl border border-white/10">
          {DAYS.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDay(d.id)}
              className={`px-3 py-2.5 rounded-xl text-center transition-all cursor-pointer ${
                selectedDay === d.id
                  ? 'bg-white text-black font-bold shadow'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="text-xs font-mono font-bold">{d.short}</div>
              <div className="hidden sm:block text-[10px] opacity-75">{d.name}</div>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-emerald-400 animate-pulse">
          Yayın Takvimi Yükleniyor...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dayItems.map((item, idx) => {
            const isFol = followedMediaIds.includes(item.id);
            const nextEp = (item.episodes_available || 1) + 1;
            const airHour = `${18 + (idx % 5)}:${idx % 2 === 0 ? '00' : '30'}`;
            return (
              <div
                key={item.id}
                className="koup-projection-card rounded-3xl p-4 bg-[#121216] border border-white/10 flex items-center gap-4"
              >
                <Link href={`/seri/${item.slug}`} className="shrink-0">
                  <img
                    src={getProxiedImageUrl(item.cover_image, item.poster_fallback_url)}
                    alt={item.title}
                    loading="lazy"
                    className="w-20 h-28 rounded-2xl object-cover border border-white/10"
                  />
                </Link>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      TSİ {airHour}
                    </span>
                    <span className="text-amber-300">
                      {nextEp}. Bölüm
                    </span>
                  </div>

                  <Link
                    href={`/seri/${item.slug}`}
                    className="block text-sm font-bold text-white truncate hover:text-sky-300"
                  >
                    {item.title}
                  </Link>

                  <div className="text-xs text-white/50 truncate">
                    {COUNTRY_FLAGS[item.country_code] || '🎬'} {item.country_name} · ★{' '}
                    {item.site_rating}
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    <Link
                      href={`/seri/${item.slug}?sezon=1&bolum=${nextEp}`}
                      className="flex items-center gap-1 px-3 py-1 rounded-full bg-white text-black text-[11px] font-bold"
                    >
                      <Play className="w-3 h-3 fill-black" />
                      <span>Bölüm Sayfası</span>
                    </Link>

                    <button
                      onClick={() => toggleMediaFollow(item)}
                      className={`p-1.5 rounded-full border text-xs cursor-pointer ${
                        isFol
                          ? 'bg-sky-400/25 border-sky-400 text-sky-300'
                          : 'bg-white/10 border-white/15 text-white/75'
                      }`}
                    >
                      <Bell className="w-3.5 h-3.5" />
                    </button>
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
