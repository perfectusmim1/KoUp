'use client';

import React, { memo } from 'react';
import Link from 'next/link';
import { Star, Eye } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
  cleanMediaTitle,
  formatViewCount,
  formatBroadcastStatus,
} from '@/lib/supabase';
import CountryFlag from '@/components/CountryFlag';

interface DirectMediaCardProps {
  item: MediaItem;
  priority?: boolean;
}

function DirectMediaCardComponent({
  item,
  priority = false,
}: DirectMediaCardProps) {
  const displayTitle = cleanMediaTitle(item.title);
  const countryCode = item.country_code || item.country;
  const isFilm = item.content_type === 'film' || item.content_type === 'movie';
  const mediaType: 'tv' | 'movie' = isFilm ? 'movie' : 'tv';
  const totalEps = isFilm ? 0 : Number(item.episode_count || 0);
  const availEps = isFilm ? 0 : Number(item.episodes_available || 0);

  const epLabel = (() => {
    if (isFilm) return null;
    if (totalEps > 0 && availEps > 0 && totalEps > availEps) {
      return `${availEps} / ${totalEps} Bölüm`;
    }
    const count = availEps || totalEps;
    return count > 0 ? `${count} Bölüm` : null;
  })();

  const posterSrc = getProxiedImageUrl(
    item.cover_image,
    item.poster_fallback_url || null,
    item.title,
    'w500',
    'poster',
    item.tmdb_id,
    mediaType,
    item.release_year,
    item.native_title,
    item.id
  );

  const ratingInfo = (() => {
    const siteRatingCount = Number(item.site_rating_count || 0);
    const siteRating = Number(item.site_rating || 0);

    if (siteRatingCount >= 50 && siteRating > 0) {
      return {
        score: siteRating.toFixed(1),
        isKoUp: true,
      };
    }

    if (item.content_type === 'anime' && item.anilist_rating && Number(item.anilist_rating) > 0) {
      const val = Number(item.anilist_rating);
      return {
        score: val > 10 ? (val / 10).toFixed(1) : val.toFixed(1),
        isKoUp: false,
      };
    }
    const imdbVal = item.imdb_rating ?? (item as any).imdb_score ?? (item as any).vote_average;
    if (imdbVal != null && !isNaN(Number(imdbVal)) && Number(imdbVal) > 0) {
      return {
        score: Number(imdbVal).toFixed(1),
        isKoUp: false,
      };
    }
    if (item.mdl_rating && Number(item.mdl_rating) > 0) {
      return {
        score: Number(item.mdl_rating).toFixed(1),
        isKoUp: false,
      };
    }
    if (item.rating && Number(item.rating) > 0) {
      return {
        score: Number(item.rating).toFixed(1),
        isKoUp: false,
      };
    }
    return null;
  })();

  return (
    <Link
      href={`/seri/${item.slug}`}
      aria-label={displayTitle}
      className="group relative block w-full aspect-[2/3] rounded-xl sm:rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/10 hover:border-white/30 shadow-[0_12px_28px_rgba(0,0,0,0.6)] hover:shadow-[0_18px_36px_rgba(0,0,0,0.85)] hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 ease-out select-none cursor-pointer"
    >
      {/* Poster Image */}
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
            )}&title=${encodeURIComponent(item.title)}&mediaType=${mediaType}&type=poster`;
          } else {
            target.src = '/logo-dark.png';
          }
        }}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
      />

      {/* Top Gradient for badges */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/80 via-black/30 to-transparent pointer-events-none z-10" />

      {/* Top Badges */}
      <div className="absolute top-2 sm:top-2.5 left-2 sm:left-2.5 right-2 sm:right-2.5 z-20 flex items-center justify-between gap-1.5 pointer-events-none">
        <div className="flex items-center gap-1.5">
          {countryCode && (
            <span className="inline-flex items-center justify-center filter drop-shadow-[0_2px_5px_rgba(0,0,0,0.95)]">
              <CountryFlag code={countryCode} size="md" className="rounded-[3px]" />
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold tracking-wider uppercase bg-black/75 border border-white/15 text-white/90">
            {formatContentTypeTR(item.content_type, countryCode)}
          </span>
        </div>

        {ratingInfo && (
          <div className="inline-flex items-center gap-1 filter drop-shadow-[0_2px_5px_rgba(0,0,0,0.95)]">
            {ratingInfo.isKoUp ? (
              <>
                <span className="text-[9px] font-black tracking-wider uppercase text-sky-400 bg-sky-500/20 px-1 py-0.5 rounded border border-sky-400/30">
                  KoUp
                </span>
                <Star className="w-3.5 h-3.5 fill-sky-400 text-sky-400 shrink-0 drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
              </>
            ) : (
              <Star className="w-3.5 h-3.5 fill-[#f5c518] text-[#f5c518] shrink-0" />
            )}
            <span className="font-extrabold text-xs sm:text-[13px] text-white tracking-tight leading-none">
              {ratingInfo.score}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none z-10" />

      {/* Bottom Content Area */}
      <div className="absolute bottom-0 inset-x-0 p-2.5 sm:p-3.5 z-20 flex flex-col justify-end text-left pointer-events-none">
        {(item.release_year || epLabel || (!isFilm && item.status_broadcast)) && (
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium text-white/65 mb-0.5 font-mono">
            {item.release_year && <span>{item.release_year}</span>}
            {item.release_year && epLabel && <span className="text-white/40">•</span>}
            {epLabel && (
              <span className={totalEps > availEps && availEps > 0 ? 'text-sky-300 font-semibold' : ''}>
                {epLabel}
              </span>
            )}
            {!isFilm && item.status_broadcast && (
              <>
                {(item.release_year || epLabel) && <span className="text-white/40">•</span>}
                <span className={formatBroadcastStatus(item.status_broadcast) === 'Devam Ediyor' ? 'text-emerald-400 font-semibold' : 'text-white/60'}>
                  {formatBroadcastStatus(item.status_broadcast)}
                </span>
              </>
            )}
          </div>
        )}

        <h3 className="text-xs sm:text-[14px] font-bold text-white leading-snug line-clamp-2 group-hover:text-sky-300 transition-colors">
          {displayTitle}
        </h3>

        {(item.views_total || item.views_count) ? (
          <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-white/50">
            <Eye className="w-3 h-3 text-sky-400/80 shrink-0" />
            <span>{formatViewCount(item.views_total ?? item.views_count ?? 0)}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export default memo(DirectMediaCardComponent);
