'use client';

import React, { memo } from 'react';
import Link from 'next/link';
import { Play, Sparkles, Eye } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  cleanMediaTitle,
  formatViewCount,
  isShortDrama,
} from '@/lib/supabase';
import CountryFlag from '@/components/CountryFlag';

export { isShortDrama };

export interface ShortsCardProps {
  item: MediaItem;
  priority?: boolean;
  className?: string;
  href?: string;
}

function ShortsCardComponent({
  item,
  priority = false,
  className = '',
  href,
}: ShortsCardProps) {
  const displayTitle = cleanMediaTitle(item.title);
  const countryCode = item.country_code || item.country;
  const totalEps = Number(item.episode_count || item.episodes_available || 0);
  const views = Number(item.views_total ?? item.views_count ?? 0);

  const posterSrc = getProxiedImageUrl(
    item.cover_image,
    item.poster_fallback_url || null,
    item.title,
    'w500',
    'poster',
    item.tmdb_id,
    'tv',
    item.release_year,
    item.native_title,
    item.id
  );

  const targetHref = href || `/seri/${item.slug}/1`;

  return (
    <Link
      href={targetHref}
      aria-label={`${displayTitle} - Kısa Drama İzle`}
      className={`group relative block w-full aspect-[9/16] rounded-2xl overflow-hidden bg-[#0a0a0c] border border-white/10 hover:border-amber-400/50 shadow-[0_12px_28px_rgba(0,0,0,0.7)] hover:shadow-[0_18px_36px_rgba(245,158,11,0.22)] hover:scale-[1.03] active:scale-[0.98] transition-all duration-300 ease-out select-none cursor-pointer ${className}`}
    >
      {/* 9:16 Vertical Poster Image */}
      <img
        src={posterSrc}
        alt={displayTitle}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={(e) => {
          const target = e.currentTarget;
          if (
            !target.dataset.triedFallback &&
            item.poster_fallback_url &&
            item.poster_fallback_url !== item.cover_image
          ) {
            target.dataset.triedFallback = 'true';
            target.src = getProxiedImageUrl(
              item.poster_fallback_url,
              null,
              item.title,
              'w500',
              'poster',
              item.tmdb_id
            );
          } else if (!target.dataset.triedProxy && item.title) {
            target.dataset.triedProxy = 'true';
            target.src = `/api/image-proxy?mediaId=${item.id}&tmdbId=${encodeURIComponent(
              String(item.tmdb_id || '')
            )}&title=${encodeURIComponent(item.title)}&mediaType=tv&type=poster`;
          } else {
            target.src = '/logo-dark.png';
          }
        }}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
      />

      {/* Top Gradient for badges readability */}
      <div className="absolute top-0 inset-x-0 h-20 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none z-10" />

      {/* Top Badges (Single sleek pill on top, episode count moved to clean bottom meta) */}
      <div className="absolute top-2.5 left-2.5 z-20 flex items-center pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-500/90 via-orange-500/90 to-rose-500/90 text-white backdrop-blur-md border border-white/25 shadow-[0_2px_12px_rgba(245,158,11,0.4)]">
          <Sparkles className="w-2.5 h-2.5 text-amber-200 fill-amber-200 animate-pulse" />
          <span className="sm:hidden">KISA</span>
          <span className="hidden sm:inline">KISA DRAMA</span>
        </span>
      </div>

      {/* Centered Play Button Micro-Interaction on Hover */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none z-20">
        <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-amber-500/80 to-rose-500/80 backdrop-blur-md border border-white/40 flex items-center justify-center shadow-[0_0_24px_rgba(245,158,11,0.6)] transform scale-75 group-hover:scale-100 transition-transform duration-300">
          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
        </div>
      </div>

      {/* Bottom Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none z-10" />

      {/* Bottom Content Area */}
      <div className="absolute bottom-0 inset-x-0 p-2.5 sm:p-3.5 z-20 flex flex-col justify-end text-left pointer-events-none">
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-medium text-white/75 mb-1 font-mono">
          {countryCode && (
            <span className="inline-flex items-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              <CountryFlag code={countryCode} size="sm" className="rounded-[2px]" />
            </span>
          )}
          {item.release_year && <span>{item.release_year}</span>}
          {totalEps > 0 && (
            <span className="text-amber-300/90 font-bold">
              {totalEps} Bölüm
            </span>
          )}
          {views > 0 && (
            <span className="flex items-center gap-1 text-sky-400 font-semibold ml-auto">
              <Eye className="w-3 h-3 text-sky-400" />
              <span>{formatViewCount(views)}</span>
            </span>
          )}
        </div>

        <h3 className="text-xs sm:text-[13px] font-bold text-white leading-snug line-clamp-2 group-hover:text-amber-300 transition-colors drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {displayTitle}
        </h3>
      </div>
    </Link>
  );
}

export default memo(ShortsCardComponent);
