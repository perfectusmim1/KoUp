'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Plus, Check, Heart, Bell, Star } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import CountryFlag from '@/components/CountryFlag';

interface AccordionMediaCardProps {
  item: MediaItem;
  rank?: number;
  priority?: boolean;
  fluidWidth?: boolean;
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

function getTypeBadgeClass(contentType?: string, countryCode?: string): string {
  const ct = (contentType || '').toLowerCase();
  const cc = (countryCode || '').toUpperCase();
  if (ct === 'anime') return 'badge-type badge-anime';
  if (ct === 'movie' || ct === 'film') return 'badge-type badge-movie';
  if (ct === 'program' || ct === 'variety') return 'badge-type badge-variety';
  if (cc === 'KR') return 'badge-type badge-kdrama';
  if (cc === 'CN') return 'badge-type badge-cdrama';
  if (cc === 'JP') return 'badge-type badge-anime';
  return 'badge-type badge-global';
}

function AccordionMediaCard({
  item,
  rank,
  priority = false,
  fluidWidth = false,
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
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const userProg = progressMap[item.id];
  const inWatchlist = Boolean(userProg);
  const isFavorited = Boolean(userProg?.is_favorite || userProg?.is_favorited);
  const isFollowed = Boolean(followedMediaIds.includes(item.id));

  const handleMouseEnter = () => {
    // On mobile touch devices (hover: none or window width < 768px): cards should NOT expand width
    if (typeof window !== 'undefined') {
      const isTouchOrMobile =
        window.matchMedia('(hover: none)').matches || window.innerWidth < 768;
      if (isTouchOrMobile) return;
    }

    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    hoverTimerRef.current = setTimeout(() => {
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
    }, 70);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setIsExpanded(false);
  };

  const posterSrc = getProxiedImageUrl(item.cover_image, item.title);
  const backdropSrc = getProxiedImageUrl(
    item.backdrop_image || item.cover_image,
    item.title
  );

  const countryCode = item.country_code || item.country;
  const countryLabel =
    COUNTRY_SHORT_TR[(countryCode || '').toUpperCase()] ||
    item.country_name ||
    countryCode ||
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
        width: isExpanded
          ? '390px'
          : fluidWidth
          ? '100%'
          : undefined,
        minWidth: isExpanded
          ? '390px'
          : fluidWidth
          ? '0px'
          : undefined,
        maxWidth: isExpanded ? 'calc(100vw - 32px)' : undefined,
        transformOrigin: isNearRight ? 'right center' : 'left center',
        transition:
          'width 0.35s cubic-bezier(0.25, 1, 0.5, 1), transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)',
        willChange: 'width, transform',
      }}
      className={`koup-accordion-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer select-none h-[306px] group ${
        fluidWidth
          ? 'w-full min-w-0'
          : 'w-[160px] sm:w-[204px] min-w-[150px] sm:min-w-[204px]'
      }`}
    >
      {/* Background Instant Navigation Link with 0ms Prefetch */}
      <Link
        href={`/seri/${item.slug}`}
        prefetch={true}
        className="absolute inset-0 z-0"
        aria-label={item.title}
        tabIndex={-1}
      />

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
        width={390}
        height={306}
        loading={priority ? undefined : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isExpanded ? 'opacity-0 scale-105' : 'opacity-100 scale-100'
        }`}
      />

      {/* Widescreen 16:9 Scene Backdrop */}
      <img
        src={backdropSrc}
        alt={item.title}
        width={390}
        height={306}
        loading="lazy"
        decoding="async"
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

      {/* Top Badges Row: Left = Country Flag, Right = Exactly ONE Score */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-1.5 z-10 pointer-events-none">
        {/* Top-Left: National Flag */}
        <div>
          {countryCode ? (
            <span className="inline-flex items-center justify-center p-1 rounded-md bg-black/80 backdrop-blur-md border border-white/15 shadow-sm">
              <CountryFlag code={countryCode} size="md" />
            </span>
          ) : null}
        </div>

        {/* Top-Right: Exactly ONE Rating Badge (IMDb > MDL > AniList > Rating) */}
        <div>
          {(() => {
            const singleRating = item.imdb_rating
              ? {
                  label: `IMDb ${item.imdb_rating}`,
                  cls: 'text-yellow-300 border-yellow-400/35',
                  hasStar: false,
                }
              : item.mdl_rating
              ? {
                  label: `MDL ${item.mdl_rating}`,
                  cls: 'text-amber-300 border-amber-400/30',
                  hasStar: false,
                }
              : item.anilist_rating
              ? {
                  label: `AL ${item.anilist_rating}%`,
                  cls: 'text-sky-300 border-sky-400/30',
                  hasStar: false,
                }
              : item.rating && item.rating > 0
              ? {
                  label: Number(item.rating).toFixed(1),
                  cls: 'text-white border-white/15',
                  hasStar: true,
                }
              : null;

            if (!singleRating) return null;

            return (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/80 backdrop-blur-md border shadow-sm ${singleRating.cls}`}
              >
                {singleRating.hasStar && (
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" />
                )}
                <span>{singleRating.label}</span>
              </span>
            );
          })()}
        </div>
      </div>

      {/* Bottom Info Content */}
      <div className="absolute bottom-0 left-0 right-0 p-4 z-10 flex flex-col justify-end">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">
          <span className={getTypeBadgeClass(item.content_type, countryCode)}>
            {formatContentTypeTR(item.content_type, countryCode)}
          </span>
          {item.release_year && <span>• {item.release_year}</span>}
          {item.episode_count > 0 && <span>• {item.episode_count} Bölüm</span>}
        </div>

        <h3 className="text-[15px] font-bold text-white leading-snug line-clamp-1">
          {item.title}
        </h3>

        {/* Smoothly Animated Expanded Details Drawer with Intrinsic Grid Rows */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isExpanded
              ? 'grid-rows-[1fr] opacity-100 mt-2'
              : 'grid-rows-[0fr] opacity-0 mt-0 pointer-events-none'
          }`}
        >
          <div className="overflow-hidden space-y-2">
            {item.overview && (
              <p className="text-xs text-white/75 line-clamp-2 leading-relaxed">
                {item.overview}
              </p>
            )}

            {/* Genre Chips */}
            {item.categories && item.categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
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
            <Link
              href={`/seri/${item.slug}/1`}
              prefetch={true}
              onClick={(e) => {
                e.stopPropagation();
                triggerSound('click');
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-[0.97] transition-all shadow-[0_2px_12px_rgba(0,0,0,0.6)] border border-white/20 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>Hemen İzle</span>
            </Link>

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
    </div>
  );
}

export default React.memo(AccordionMediaCard);

