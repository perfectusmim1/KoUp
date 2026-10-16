'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Calendar, Clock, Bell, Play, Star } from 'lucide-react';
import {
  supabase,
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

const DAYS = [
  { id: 1, name: 'Pazartesi', short: 'PZT' },
  { id: 2, name: 'Salı', short: 'SAL' },
  { id: 3, name: 'Çarşamba', short: 'ÇAR' },
  { id: 4, name: 'Perşembe', short: 'PER' },
  { id: '5', num: 5, name: 'Cuma', short: 'CUM' },
  { id: 6, name: 'Cumartesi', short: 'CMT' },
  { id: 7, name: 'Pazar', short: 'PAZ' },
].map((d, i) => ({ id: i + 1, name: d.name, short: d.short }));

export default function CalendarPage() {
  const { followedMediaIds, toggleMediaFollow, triggerSound } = useKoUp();
  const [selectedDay, setSelectedDay] = useState<number>(
    ((new Date().getDay() + 6) % 7) + 1
  );
  const [dayItems, setDayItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDaySchedule() {
      setIsLoading(true);
      const offset = (selectedDay - 1) * 18;
      const { data } = await supabase
        .from('media')
        .select('*')
        .in('content_type', ['dizi', 'anime'])
        .order('views_count', { ascending: false })
        .range(offset, offset + 17);
      setDayItems((data as MediaItem[]) || []);
      setIsLoading(false);
    }
    loadDaySchedule();
  }, [selectedDay]);

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] shadow-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>Haftalık Yayın & Çeviri Takvimi • Canlı Geri Sayım</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Yayın Takvimi & Yeni Bölüm Saatleri
          </h1>
          <p className="text-sm text-white/60 max-w-2xl">
            Haftanın 7 günü yayınlanan Kore, Çin, Tayland dizileri ve animelerin yeni bölüm saatlerini takip et, bildirim zilini aç.
          </p>
        </div>

        {/* 7-Day Selector Tabs with Spring Sliding Pill */}
        <div className="grid grid-cols-7 gap-1.5 glass-pill-dark p-1.5 rounded-2xl">
          {DAYS.map((d) => {
            const active = selectedDay === d.id;
            return (
              <button
                key={d.id}
                onClick={() => {
                  triggerSound('click');
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

      {isLoading ? (
        <div className="py-20 text-center text-sm font-mono text-white/50 animate-pulse">
          Yayın Takvimi Yükleniyor...
        </div>
      ) : (
        <motion.div
          key={selectedDay}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {dayItems.map((item, idx) => {
            const isFol = followedMediaIds.includes(item.id);
            const nextEp = Math.max(1, (item.episode_count || 12));
            const airHour = `${18 + (idx % 5)}:${idx % 2 === 0 ? '00' : '30'}`;
            return (
              <div
                key={item.id}
                className="koup-projection-card rounded-3xl p-4 flex items-center gap-4"
              >
                <Link href={`/seri/${item.slug}`} className="shrink-0">
                  <img
                    src={getProxiedImageUrl(item.cover_image, item.title)}
                    alt={item.title}
                    loading="lazy"
                    className="w-20 h-28 rounded-2xl object-cover border border-white/10"
                  />
                </Link>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      TSİ {airHour}
                    </span>
                    <span className="text-white/75 font-semibold">
                      {nextEp}. Bölüm
                    </span>
                  </div>

                  <Link
                    href={`/seri/${item.slug}`}
                    className="block text-sm font-bold text-white truncate hover:text-white/80"
                  >
                    {item.title}
                  </Link>

                  <div className="text-xs text-white/50 flex items-center gap-1.5 truncate">
                    <span>{formatContentTypeTR(item.content_type, item.country)}</span>
                    {item.rating ? (
                      <>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1 text-white/75">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          {Number(item.rating).toFixed(1)}
                        </span>
                      </>
                    ) : null}
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    <Link
                      href={`/seri/${item.slug}?play=1`}
                      className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-white text-black text-[11px] font-bold hover:scale-105 transition-transform"
                    >
                      <Play className="w-3 h-3 fill-black" />
                      <span>Bölüm Sayfası</span>
                    </Link>

                    <button
                      onClick={() => toggleMediaFollow(item)}
                      title="Yeni bölüm bildirimi al"
                      className={`p-1.5 rounded-full border text-xs cursor-pointer transition-all ${
                        isFol
                          ? 'bg-white text-black border-white'
                          : 'bg-white/[0.06] border-white/15 text-white/75 hover:text-white'
                      }`}
                    >
                      <Bell className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
