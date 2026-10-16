'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Plus, Check, Bell, Heart } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  COUNTRY_FLAGS,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

interface AccordionMediaCardProps {
  item: MediaItem;
  rankNumber?: number;
  priority?: boolean;
}

export default function AccordionMediaCard({
  item,
  rankNumber,
  priority = false,
}: AccordionMediaCardProps) {
  const router = useRouter();
  const {
    progressMap,
    followedMediaIds,
    setLibraryStatus,
    toggleMediaFavorite,
    toggleMediaFollow,
  } = useKoUp();

  const [isExpanded, setIsExpanded] = useState(false);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const userProg = progressMap[item.id];
  const isInWatchlist = Boolean(userProg);
  const isFavorited = Boolean(userProg?.is_favorite);
  const isFollowed = followedMediaIds.includes(item.id);

  const handleMouseEnter = () => {
    // 80ms Hover Prefetching for 0ms navigation
    prefetchTimerRef.current = setTimeout(() => {
      router.prefetch(`/seri/${item.slug}`);
    }, 80);

    // 180ms intent delay before horizontal strip accordion expansion
    hoverTimerRef.current = setTimeout(() => {
      setIsExpanded(true);
    }, 180);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    setIsExpanded(false);
  };

  const posterSrc = getProxiedImageUrl(item.cover_image, item.poster_fallback_url);
  const backdropSrc = getProxiedImageUrl(
    item.backdrop_image || item.cover_image,
    item.poster_fallback_url
  );

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      className={`koup-projection-card group relative shrink-0 rounded-2xl overflow-hidden bg-[#121216] border border-white/[0.08] select-none transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isExpanded
          ? 'w-[340px] sm:w-[400px] h-[310px] z-30'
          : 'w-[185px] sm:w-[210px] h-[310px] z-10'
      }`}
    >
      {/* Background Image switches smoothly from 2:3 Poster to 16:9 Cinema Backdrop */}
      <Link href={`/seri/${item.slug}`} className="block w-full h-full relative">
        <img
          src={isExpanded ? backdropSrc : posterSrc}
          alt={item.title}
          loading={priority ? undefined : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.fallbackApplied) {
              target.dataset.fallbackApplied = '1';
              target.src = '/logo-dark.png';
            }
          }}
          className={`w-full h-full object-cover transition-transform duration-700 ease-out ${
            isExpanded ? 'scale-105 brightness-90' : 'scale-100'
          }`}
        />

        {/* Subtle Dark Cinema Gradient */}
        <div
          className={`absolute inset-0 transition-opacity duration-500 ${
            isExpanded
              ? 'bg-gradient-to-t from-[#08080A] via-[#08080A]/75 to-black/20'
              : 'bg-gradient-to-t from-[#08080A] via-black/20 to-transparent'
          }`}
        />

        {/* Top Badges: Multi-Source Color-Coded Ratings + Country */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-1.5 z-20">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Site Rating (Crisp White/Silver) */}
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-black/70 backdrop-blur-md text-white border border-white/15">
              ★ {Number(item.site_rating || 8.5).toFixed(1)}
            </span>

            {/* MDL Rating (Cinema Amber #E5A93C) */}
            {item.mdl_rating && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#E5A93C]/20 backdrop-blur-md text-[#E5A93C] border border-[#E5A93C]/40">
                MDL {Number(item.mdl_rating).toFixed(1)}
              </span>
            )}

            {/* AniList Rating (Sky Blue #38BDF8) */}
            {item.anilist_rating && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#38BDF8]/20 backdrop-blur-md text-[#38BDF8] border border-[#38BDF8]/40">
                AL {item.anilist_rating}%
              </span>
            )}

            {/* IMDb Rating (Gold #F5C518) */}
            {!item.mdl_rating && !item.anilist_rating && item.imdb_rating && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F5C518]/20 backdrop-blur-md text-[#F5C518] border border-[#F5C518]/40">
                IMDb {Number(item.imdb_rating).toFixed(1)}
              </span>
            )}
          </div>

          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/65 backdrop-blur-md text-white/80 border border-white/10">
            {COUNTRY_FLAGS[item.country_code] || '🎬'} {item.country_code}
          </span>
        </div>

        {/* Top 10 Rank Badge if present */}
        {typeof rankNumber === 'number' && (
          <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
            <span className="font-mono font-black text-3xl sm:text-4xl tracking-tighter text-white/25 group-hover:text-amber-300/60 transition-colors">
              #{String(rankNumber).padStart(2, '0')}
            </span>
          </div>
        )}

        {/* Bottom Content Area: Morphs between Compact Poster & Expanded 16:9 Scene Preview */}
        <div className="absolute bottom-0 left-0 right-0 p-3.5 z-20 flex flex-col justify-end">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-sky-300 mb-1">
            <span className="uppercase">{item.content_type}</span>
            <span>·</span>
            <span>{item.release_year || 2024}</span>
            <span>·</span>
            <span>
              {item.episodes_available || item.episode_count || 1} Bölüm
            </span>
          </div>

          <h3 className="text-sm sm:text-[15px] font-bold text-white leading-snug line-clamp-1 group-hover:text-sky-100 transition-colors">
            {item.title}
          </h3>

          {item.native_title && !isExpanded && (
            <p className="text-[11px] text-white/45 line-clamp-1 mt-0.5">
              {item.native_title}
            </p>
          )}

          {/* Expanded Accordion Details */}
          {isExpanded && (
            <div className="mt-2 space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-xs text-white/75 line-clamp-2 leading-relaxed">
                {item.overview}
              </p>

              {item.categories && item.categories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.categories.slice(0, 3).map((cat) => (
                    <span
                      key={cat}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/80 border border-white/10"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}

              <div
                onClick={(e) => e.preventDefault()}
                className="flex items-center gap-2 pt-1"
              >
                <button
                  onClick={() => router.push(`/seri/${item.slug}`)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-black" />
                  Hemen İzle
                </button>

                <button
                  onClick={() => setLibraryStatus(item, 'plan_to_watch')}
                  title="İzleme Listeme Ekle"
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                    isInWatchlist
                      ? 'bg-sky-400/25 border-sky-400 text-sky-300'
                      : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
                  }`}
                >
                  {isInWatchlist ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                </button>

                <button
                  onClick={() => toggleMediaFavorite(item)}
                  title="Favorilere Ekle"
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                    isFavorited
                      ? 'bg-pink-500/25 border-pink-400 text-pink-300'
                      : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-pink-400' : ''}`} />
                </button>

                <button
                  onClick={() => toggleMediaFollow(item)}
                  title="Yeni Bölüm Bildirimi Aç"
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                    isFollowed
                      ? 'bg-amber-400/25 border-amber-400 text-amber-300'
                      : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}
