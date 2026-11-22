'use client';

import React, { memo } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
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
      className={`group relative block w-full aspect-[9/16] rounded-xl sm:rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/10 hover:border-white/30 focus-visible:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 shadow-[0_12px_28px_rgba(0,0,0,0.6)] hover:shadow-[0_18px_36px_rgba(0,0,0,0.85)] focus-visible:shadow-[0_18px_36px_rgba(0,0,0,0.85)] hover:scale-[1.03] focus-visible:scale-[1.03] active:scale-[0.98] transition-all duration-200 ease-out select-none cursor-pointer ${className}`}
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
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105 group-focus-visible:scale-105"
      />

      {/* Top Gradient for badges readability */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none z-10" />

      {/* Top Badge */}
      <div className="absolute top-2 sm:top-2.5 left-2 sm:left-2.5 z-20 flex items-center pointer-events-none">
        <span className="px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-black/75 border border-white/15 text-white/90">
          <span className="sm:hidden">KISA</span>
          <span className="hidden sm:inline">KISA DRAMA</span>
        </span>
      </div>

      {/* Bottom Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent pointer-events-none z-10" />

      {/* Bottom Content Area */}
      <div className="absolute bottom-0 inset-x-0 p-2.5 sm:p-3.5 z-20 flex flex-col justify-end text-left pointer-events-none">
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-medium text-white/70 mb-1 font-mono">
          {countryCode && (
            <span className="inline-flex items-center filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              <CountryFlag code={countryCode} size="sm" className="rounded-[2px]" />
            </span>
          )}
          {item.release_year && <span>{item.release_year}</span>}
          {totalEps > 0 && (
            <span className="text-sky-300 font-semibold">
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

        <h3 className="text-xs sm:text-[14px] font-bold text-white leading-snug line-clamp-2 group-hover:text-sky-300 group-focus-visible:text-sky-300 transition-colors drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {displayTitle}
        </h3>
      </div>
    </Link>
  );
}

export default memo(ShortsCardComponent);
