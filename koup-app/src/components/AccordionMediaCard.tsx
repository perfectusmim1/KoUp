'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Plus, Check, Heart, Bell, Star } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
  getCountryFlag,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

interface AccordionMediaCardProps {
  item: MediaItem;
  rank?: number;
  priority?: boolean;
}

const COUNTRY_SHORT_TR: Record<string, string> = {
  KR: 'GÜNEY KORE',
  CN: 'ÇİN',
  JP: 'JAPONYA',
  TH: 'TAYLAND',
  TW: 'TAYVAN',
  HK: 'HONG KONG',
  PH: 'FİLİPİNLER',
  US: 'ABD',
  GB: 'İNGİLTERE',
  TR: 'TÜRKİYE',
  GL: 'GLOBAL',
};

export default function AccordionMediaCard({
  item,
  rank,
  priority = false,
}: AccordionMediaCardProps) {
  const router = useRouter();
  const {
    progressMap,
    updateWatchStatus,
    toggleMediaFavorite,
    toggleMediaFollow,
    followedMediaIds,
    triggerSound,
  } = useKoUp();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isNearRight, setIsNearRight] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const prefetchRef = useRef(false);

  const userProg = progressMap[item.id];
  const inWatchlist = Boolean(userProg);
  const isFavorited = Boolean(userProg?.is_favorite || userProg?.is_favorited);
  const isFollowed = Boolean(followedMediaIds.includes(item.id));

  const handleMouseEnter = () => {
    if (!prefetchRef.current) {
      prefetchRef.current = true;
      router.prefetch(`/seri/${item.slug}`);
      router.prefetch(`/seri/${item.slug}/1`);
    }

    if (cardRef.current && typeof window !== 'undefined') {
      const rect = cardRef.current.getBoundingClientRect();
      if (rect.right + 190 > window.innerWidth) {
        setIsNearRight(true);
      } else {
        setIsNearRight(false);
      }
    }

    setIsExpanded(true);
    triggerSound('expand');
  };

  const handleMouseLeave = () => {
    setIsExpanded(false);
  };

  const posterSrc = getProxiedImageUrl(item.cover_image, item.title);
  const backdropSrc = getProxiedImageUrl(
    item.backdrop_image || item.cover_image,
    item.title
  );

  const countryLabel =
    COUNTRY_SHORT_TR[(item.country || '').toUpperCase()] ||
    item.country ||
    'ASYA';

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => {
        // Navigate to series page if not clicking interactive action buttons
        if ((e.target as HTMLElement).closest('button, a')) return;
        router.push(`/seri/${item.slug}`);
      }}
      style={{
        width: isExpanded ? '390px' : '204px',
        minWidth: isExpanded ? '390px' : '204px',
        maxWidth: 'calc(100vw - 32px)',
        transformOrigin: isNearRight ? 'right center' : 'left center',
      }}
      className="koup-accordion-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer select-none h-[306px] group transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]"
    >
      {/* Rank Numeral Overlay if part of a Ranked Row */}
      {rank !== undefined && (
        <div className="absolute -left-2 bottom-2 z-20 pointer-events-none">
          <span className="text-7xl font-black text-stroke-numeral leading-none">
            {rank}
          </span>
        </div>
      )}

      {/* Vertical 2:3 Poster */}
      <img
        src={posterSrc}
        alt={item.title}
        loading={priority ? undefined : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isExpanded ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
        }`}
      />

      {/* Widescreen 16:9 Scene Backdrop */}
      <img
        src={backdropSrc}
        alt={item.title}
        loading="lazy"
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isExpanded ? 'opacity-100 scale-105' : 'opacity-0 scale-100'
        }`}
      />

      {/* Smooth Dark Vignette Gradient */}
      <div
        className={`absolute inset-0 transition-opacity duration-400 ${
          isExpanded
            ? 'bg-gradient-to-t from-[#080808] via-[#080808]/80 to-black/30'
            : 'bg-gradient-to-t from-[#080808] via-[#080808]/35 to-transparent'
        }`}
      />

      {/* Top Badges Row with National Flag */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-1.5 z-10 pointer-events-none">
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.rating && item.rating > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-black/80 backdrop-blur-md text-white border border-white/15 shadow-sm">
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
              <span>{Number(item.rating).toFixed(1)}</span>
            </span>
          ) : null}

          {item.mdl_rating ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-amber-300 border border-amber-400/30">
              MDL {item.mdl_rating}
            </span>
          ) : null}

          {item.anilist_rating ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-sky-300 border border-sky-400/30">
              AL {item.anilist_rating}%
            </span>
          ) : null}

          {isExpanded && item.imdb_rating ? (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md text-yellow-300 border border-yellow-400/35">
              IMDb {item.imdb_rating}
            </span>
          ) : null}
        </div>

        {item.country && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider bg-black/80 backdrop-blur-md text-white/90 border border-white/15 shrink-0 shadow-sm">
            <span>{getCountryFlag(item.country)}</span>
            <span>{countryLabel}</span>
          </span>
        )}
      </div>

      {/* Bottom Info Content */}
      <div className="absolute bottom-0 left-0 right-0 p-4 z-10 flex flex-col justify-end">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">
          <span>{getCountryFlag(item.country)}</span>
          <span>{formatContentTypeTR(item.content_type, item.country)}</span>
          {item.release_year && <span>• {item.release_year}</span>}
          {item.episode_count > 0 && <span>• {item.episode_count} Bölüm</span>}
        </div>

        <h3 className="text-[15px] font-bold text-white leading-snug line-clamp-1">
          {item.title}
        </h3>

        {/* Smoothly Animated Expanded Details Drawer */}
        <div
          className={`overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isExpanded
              ? 'max-h-44 opacity-100 translate-y-0 mt-2'
              : 'max-h-0 opacity-0 translate-y-2 mt-0'
          }`}
        >
          {item.overview && (
            <p className="text-xs text-white/75 line-clamp-2 leading-relaxed">
              {item.overview}
            </p>
          )}

          {/* Genre Chips */}
          {item.categories && item.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {item.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat}
                  className="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.08] text-white/80 border border-white/10"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}

          {/* Quick Action Bar (Events isolated so clicking buttons does NOT trigger series page navigation!) */}
          <div
            className="flex items-center gap-2 pt-3"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                triggerSound('click');
                router.push(`/seri/${item.slug}/1`);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black font-bold text-xs hover:scale-105 active:scale-95 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.35)] cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>Hemen İzle</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateWatchStatus(
                  item.id,
                  inWatchlist ? 'plan_to_watch' : 'watching',
                  1,
                  1
                );
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={inWatchlist ? 'Listede' : 'Listeme Ekle'}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                inWatchlist
                  ? 'bg-white text-black border-white'
                  : 'glass-pill text-white hover:bg-white/20'
              }`}
            >
              {inWatchlist ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleMediaFavorite(item);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={isFavorited ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                isFavorited
                  ? 'bg-rose-500 border-rose-400 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                  : 'glass-pill text-white hover:bg-white/20'
              }`}
            >
              <Heart
                className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`}
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleMediaFollow(item);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={isFollowed ? 'Takibi Bırak' : 'Yeni Bölüm Bildirimlerini Aç'}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                isFollowed
                  ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.4)]'
                  : 'glass-pill text-white/80 hover:text-white hover:bg-white/20'
              }`}
            >
              <Bell className={`w-3.5 h-3.5 ${isFollowed ? 'fill-black' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
