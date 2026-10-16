'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Plus, Check, Heart, Bell, Star } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
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

// Global active accordion card tracker to synchronize single-card expansion in rows
// and eliminate ping-pong width oscillation when moving mouse between sibling cards
let currentActiveCardId: number | null = null;
const activeListeners = new Set<(activeId: number | null) => void>();

function setActiveCard(id: number | null) {
  currentActiveCardId = id;
  activeListeners.forEach((listener) => listener(id));
}

export default function AccordionMediaCard({
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

  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const prefetchRef = useRef(false);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe to global active card changes for accordion row mode
  useEffect(() => {
    if (fluidWidth) return;

    const listener = (activeId: number | null) => {
      if (activeId !== item.id) {
        setIsHovered(false);
      }
    };
    activeListeners.add(listener);
    return () => {
      activeListeners.delete(listener);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, [item.id, fluidWidth]);

  const userProg = progressMap[item.id];
  const inWatchlist = Boolean(userProg);
  const isFavorited = Boolean(userProg?.is_favorite || userProg?.is_favorited);
  const isFollowed = Boolean(followedMediaIds.includes(item.id));

  const handleMouseEnter = () => {
    // Touch/mobile check
    if (typeof window !== 'undefined') {
      const isTouchOrMobile =
        window.matchMedia('(hover: none)').matches || window.innerWidth < 768;
      if (isTouchOrMobile) return;
    }

    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    // Instant prefetch
    if (!prefetchRef.current) {
      prefetchRef.current = true;
      router.prefetch(`/seri/${item.slug}`);
      router.prefetch(`/seri/${item.slug}/1`);
    }

    if (fluidWidth) {
      // In grid view: smooth instantaneous scale without shifting grid siblings
      setIsHovered(true);
      triggerSound?.('hover');
    } else {
      // In accordion carousel row: coordinated single-card expansion
      // If another card is already active, switch immediately (0ms delay) to avoid jump
      const delay = currentActiveCardId !== null && currentActiveCardId !== item.id ? 0 : 35;
      hoverTimerRef.current = setTimeout(() => {
        setActiveCard(item.id);
        setIsHovered(true);
        triggerSound?.('expand');
      }, delay);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (fluidWidth) {
      setIsHovered(false);
    } else {
      // Short delay when leaving entirely
      hoverTimerRef.current = setTimeout(() => {
        if (currentActiveCardId === item.id) {
          setActiveCard(null);
        }
        setIsHovered(false);
      }, 60);
    }
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

  // IN GRID MODE (fluidWidth = true):
  // Stays 100% within its grid cell. Smooth cinema scale on hover without breaking or overlapping neighboring columns.
  if (fluidWidth) {
    return (
      <div
        ref={cardRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          router.push(`/seri/${item.slug}`);
        }}
        tabIndex={0}
        style={{
          transform: isHovered ? 'scale(1.04) translateY(-3px)' : 'scale(1) translateY(0)',
          zIndex: isHovered ? 30 : 1,
          transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.28s ease',
          willChange: 'transform',
        }}
        className="relative w-full rounded-2xl overflow-hidden cursor-pointer select-none aspect-[2/3] group bg-[#0f0f11] border border-white/10 hover:border-white/30 shadow-lg hover:shadow-[0_20px_40px_rgba(0,0,0,0.85)]"
      >
        <Link
          href={`/seri/${item.slug}`}
          prefetch={true}
          className="absolute inset-0 z-0"
          aria-label={item.title}
          tabIndex={-1}
        />

        {/* Poster Image */}
        <img
          src={posterSrc}
          alt={item.title}
          loading={priority ? undefined : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-90 group-hover:opacity-95 transition-opacity" />

        {/* Top Badges */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 pointer-events-none">
          <div className="flex items-center gap-1.5">
            {countryCode && (
              <span className="w-5 h-3.5 rounded-xs overflow-hidden shadow-sm shrink-0 flex items-center justify-center">
                <CountryFlag code={countryCode} size="sm" />
              </span>
            )}
            <span className="px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-white/15 text-[10px] font-mono font-bold text-white uppercase tracking-wider">
              {item.content_type === 'anime' ? 'ANİME' : item.content_type === 'movie' ? 'FİLM' : 'DİZİ'}
            </span>
          </div>

          {(item.rating || item.mdl_rating || item.imdb_rating) && (
            <span className="px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md border border-amber-400/40 text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>{item.rating || item.mdl_rating || item.imdb_rating}</span>
            </span>
          )}
        </div>

        {/* Bottom Metadata & Quick Play Button */}
        <div className="absolute bottom-0 left-0 right-0 p-3 z-10 flex flex-col justify-end">
          <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
            {item.title}
          </h4>

          <div className="flex items-center justify-between mt-1 text-[10px] font-mono text-white/50">
            <span>{item.release_year || ''}</span>
            {item.episode_count ? <span>{item.episode_count} Bölüm</span> : null}
          </div>

          {/* Action Row on Hover */}
          <div
            className={`flex items-center gap-2 mt-2 pt-2 border-t border-white/10 transition-all duration-200 ${
              isHovered ? 'opacity-100 max-h-10' : 'opacity-0 max-h-0 overflow-hidden'
            }`}
          >
            <Link
              href={`/seri/${item.slug}?play=1`}
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
              }}
              className="flex-1 py-1.5 px-3 rounded-full bg-white text-black text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-white/90 transition-all shadow-md"
            >
              <Play className="w-3 h-3 fill-black" />
              <span>İzle</span>
            </Link>

            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
                updateWatchStatus(item.id, inWatchlist ? 'dropped' : 'watching', 1, 1);
              }}
              className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all"
              title="Kütüphaneme Ekle"
            >
              {inWatchlist ? <Check className="w-3.5 h-3.5 text-sky-400" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // IN ACCORDION CAROUSEL ROW MODE (fluidWidth = false):
  // Expands horizontally with coordinated single-card switching to eliminate jitter
  const isExpanded = isHovered;

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        router.push(`/seri/${item.slug}`);
      }}
      style={{
        width: isExpanded ? '390px' : '204px',
        minWidth: isExpanded ? '390px' : '204px',
        maxWidth: isExpanded ? 'calc(100vw - 32px)' : '204px',
        zIndex: isExpanded ? 40 : 1,
        transition: 'width 0.3s cubic-bezier(0.2, 0.9, 0.3, 1), min-width 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)',
        willChange: 'width, min-width',
      }}
      className="koup-accordion-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer select-none h-[306px] group"
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
          isExpanded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      />

      {/* Deep Vignette Gradients */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none" />
      {isExpanded && (
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent pointer-events-none" />
      )}

      {/* Top Left Flag & Top Right Ratings */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {countryCode ? (
          <div className="w-5 h-3.5 rounded-xs overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.8)] border border-white/20 shrink-0 flex items-center justify-center">
            <CountryFlag code={countryCode} size="sm" />
          </div>
        ) : (
          <span />
        )}

        {/* Rating Badges */}
        <div className="flex items-center gap-1.5">
          {item.imdb_rating && (
            <span className="badge-rating badge-rating-imdb shadow-md">
              IMDb {item.imdb_rating}
            </span>
          )}
          {item.mdl_rating && !item.imdb_rating && (
            <span className="badge-rating badge-rating-mdl shadow-md">
              MDL {item.mdl_rating}
            </span>
          )}
          {item.anilist_rating && !item.imdb_rating && !item.mdl_rating && (
            <span className="badge-rating badge-rating-anilist shadow-md">
              AL {item.anilist_rating}%
            </span>
          )}
        </div>
      </div>

      {/* Bottom Content Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 z-30 flex flex-col justify-end text-left">
        {/* COLLAPSED VIEW */}
        <div
          className={`transition-all duration-300 ${
            isExpanded ? 'opacity-0 translate-y-2 pointer-events-none' : 'opacity-100 translate-y-0'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono tracking-wider uppercase text-white/50">
              {item.content_type === 'anime'
                ? 'ANİME'
                : item.content_type === 'movie'
                ? 'FİLM'
                : 'DİZİ'}
            </span>
            {item.release_year && (
              <span className="text-[10px] font-mono text-white/40">
                • {item.release_year}
              </span>
            )}
            {item.episode_count > 0 && (
              <span className="text-[10px] font-mono text-white/40">
                • {item.episode_count} Bölüm
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-white truncate drop-shadow-md">
            {item.title}
          </h3>
        </div>

        {/* EXPANDED VIEW */}
        <div
          className={`transition-all duration-300 ${
            isExpanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider uppercase bg-white/20 text-white">
              {item.content_type === 'anime'
                ? 'ANİME'
                : item.content_type === 'movie'
                ? 'FİLM'
                : 'DİZİ'}
            </span>
            {item.release_year && (
              <span className="text-[11px] font-mono text-white/60">
                {item.release_year}
              </span>
            )}
            {item.episode_count > 0 && (
              <span className="text-[11px] font-mono text-white/60">
                • {item.episode_count} Bölüm
              </span>
            )}
          </div>

          <h3 className="text-base font-extrabold text-white leading-tight drop-shadow-lg mb-1.5 line-clamp-1">
            {item.title}
          </h3>

          <p className="text-xs text-white/70 line-clamp-2 leading-relaxed mb-3 font-normal drop-shadow">
            {item.overview ||
              `${item.title} tüm alternatif kaynaklar, Türkçe altyazı ve 1080p sinema kalitesinde hemen izlenebilir.`}
          </p>

          {item.categories && item.categories.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 overflow-hidden">
              {item.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat}
                  className="px-2 py-0.5 rounded-md text-[10px] bg-white/10 text-white/75 truncate"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}

          {/* Quick Interactive Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Link
              href={`/seri/${item.slug}?play=1`}
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 active:scale-[0.98] transition-all shadow-lg"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>Hemen İzle</span>
            </Link>

            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
                updateWatchStatus(
                  item.id,
                  inWatchlist ? 'dropped' : 'watching',
                  1,
                  1
                );
              }}
              className="w-8 h-8 rounded-full glass-pill hover:bg-white/20 flex items-center justify-center text-white cursor-pointer transition-all"
              title={inWatchlist ? 'Listeden Çıkar' : 'Listeme Ekle'}
            >
              {inWatchlist ? (
                <Check className="w-4 h-4 text-sky-400" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
                toggleMediaFavorite(item);
              }}
              className={`w-8 h-8 rounded-full glass-pill hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer ${
                isFavorited ? 'text-rose-400' : 'text-white/80 hover:text-white'
              }`}
              title="Favorilere Ekle"
            >
              <Heart
                className={`w-4 h-4 ${isFavorited ? 'fill-rose-400' : ''}`}
              />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerSound?.('click');
                toggleMediaFollow(item);
              }}
              className={`w-8 h-8 rounded-full glass-pill hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer ${
                isFollowed ? 'text-amber-300' : 'text-white/80 hover:text-white'
              }`}
              title="Yeni Bölümleri Takip Et"
            >
              <Bell className={`w-4 h-4 ${isFollowed ? 'fill-amber-300' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
