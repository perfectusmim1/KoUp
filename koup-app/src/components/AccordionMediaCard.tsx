'use client';

import React, { useState, useRef, useEffect, memo, useCallback, useId } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Heart, Bell, Star, Info, Volume2, VolumeX, Eye } from 'lucide-react';
import {
  MediaItem,
  getProxiedImageUrl,
  formatContentTypeTR,
  getNextEpisodeNumber,
  cleanOverviewText,
  cleanMediaTitle,
  formatViewCount,
} from '@/lib/supabase';
import { useKoUpSelector, useKoUpStoreGet } from '@/context/KoUpContext';
import CountryFlag from '@/components/CountryFlag';
import Top10Numeral from '@/components/Top10Numeral';
import { registerMediaItem, cachedQuery } from '@/lib/cache';
import { recordTasteSignal } from '@/lib/tasteProfile';
import { buildCleanTrailerEmbedUrl, watchYouTubeIframe, postYouTubeCommand } from '@/lib/youtubeTrailer';

interface AccordionMediaCardProps {
  item: MediaItem;
  rank?: number;
  priority?: boolean;
  fluidWidth?: boolean;
}

// Drag lock flag for horizontal carousels to prevent accidental hover/clicks while swiping
let isDragLocked = false;
let dragLockTimer: NodeJS.Timeout | null = null;

// Global O(1) coordinated accordion hover controller:
// Directly invokes the single closing card and the single opening card without any Map lookup!
let activeCardId: number | string | null = null;
let activeCardCloseFn: (() => void) | null = null;
let hoverIntentTimer: NodeJS.Timeout | null = null;

export function broadcastAccordionHover(
  id: number | string | null,
  openFn?: () => void,
  closeFn?: () => void
) {
  if (id !== null && activeCardId === id) return;

  // 1. Immediately close ONLY the previously expanded card (O(1))
  if (activeCardCloseFn) {
    const closePrev = activeCardCloseFn;
    activeCardCloseFn = null;
    activeCardId = null;
    closePrev();
  }

  // 2. Open ONLY the newly requested card (O(1))
  if (id !== null && openFn && closeFn) {
    activeCardId = id;
    activeCardCloseFn = closeFn;
    openFn();
  }
}

export function requestAccordionHover(
  id: number | string | null,
  openFn?: () => void,
  closeFn?: () => void,
  immediate = false
) {
  if (hoverIntentTimer) {
    clearTimeout(hoverIntentTimer);
    hoverIntentTimer = null;
  }
  if (id === null || immediate) {
    broadcastAccordionHover(id, openFn, closeFn);
    return;
  }
  if (activeCardId === id) return;

  hoverIntentTimer = setTimeout(() => {
    hoverIntentTimer = null;
    if (!isDragLocked) {
      broadcastAccordionHover(id, openFn, closeFn);
    }
  }, 90);
}

export function cancelAccordionHover(id?: number | string) {
  if (hoverIntentTimer) {
    clearTimeout(hoverIntentTimer);
    hoverIntentTimer = null;
  }
  if (id === undefined || activeCardId === id) {
    broadcastAccordionHover(null);
  }
}

export function setAccordionDragLock(locked: boolean) {
  if (dragLockTimer) {
    clearTimeout(dragLockTimer);
    dragLockTimer = null;
  }
  if (locked) {
    isDragLocked = true;
    cancelAccordionHover();
    // Safety auto-unlock so a swallowed mouseup/navigation never leaves cards permanently locked
    dragLockTimer = setTimeout(() => {
      isDragLocked = false;
      dragLockTimer = null;
    }, 800);
  } else {
    dragLockTimer = setTimeout(() => {
      isDragLocked = false;
      dragLockTimer = null;
    }, 90);
  }
}

export function isAccordionDragLocked() {
  return isDragLocked;
}

// Bounded LRU-like in-memory set of pre-decoded image URLs
const MAX_PRELOADED_IMAGES = 250;
const preloadedImageCache = new Set<string>();

export function preloadImage(url?: string | null, onDecoded?: () => void) {
  if (typeof window === 'undefined' || !url) return;
  if (preloadedImageCache.has(url)) {
    onDecoded?.();
    return;
  }
  if (preloadedImageCache.size >= MAX_PRELOADED_IMAGES) {
    const oldest = preloadedImageCache.values().next().value;
    if (oldest) preloadedImageCache.delete(oldest);
  }
  preloadedImageCache.add(url);

  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') {
      img
        .decode()
        .then(() => onDecoded?.())
        .catch(() => onDecoded?.());
    } else {
      img.onload = () => onDecoded?.();
      img.onerror = () => onDecoded?.();
    }
  } catch {
    onDecoded?.();
  }
}

export function preloadMediaImages(items?: (MediaItem | null | undefined)[]) {
  if (typeof window === 'undefined' || !items || items.length === 0) return;
  if (window.innerWidth < 768) return;
  // Stagger-preload the first 6 visible cards' w780 backdrops during idle time
  // (pauses automatically while any card is actively expanding)
  const slice = items.slice(0, 6);
  slice.forEach((item, idx) => {
    if (!item?.backdrop_image || item.backdrop_image === item.cover_image) return;
    const mediaType: 'tv' | 'movie' = item.content_type === 'film' ? 'movie' : 'tv';
    const url = getProxiedImageUrl(
      item.backdrop_image,
      item.cover_image,
      item.title,
      'w780',
      'banner',
      item.tmdb_id,
      mediaType
    );
    if (!url || preloadedImageCache.has(url)) return;
    setTimeout(() => {
      if (activeCardId === null && !isDragLocked) {
        preloadImage(url);
      }
    }, idx * 90);
  });
}

function getCleanOverview(overview?: string | null): string | null {
  if (!overview) return null;
  const cleaned = cleanOverviewText(overview);
  if (cleaned.length < 25) return null;
  const low = cleaned.toLowerCase();
  if (
    low.includes('dizisini türkçe') ||
    low.includes('1080p full hd') ||
    low.includes('sayfasından izleyebilirsiniz')
  ) {
    return null;
  }
  return cleaned.replace(/\s*\n+\s*/g, ' ').trim();
}

// Client-side memory cache for trailer & upgraded TMDB poster lookups
const clientTrailerCache = new Map<
  number | string,
  { youtubeId: string | null; posterUrl: string | null; backdropUrl: string | null; rating: number | null }
>();

function AccordionMediaCardComponent({
  item,
  rank,
  priority = false,
  fluidWidth = false,
}: AccordionMediaCardProps) {
  const router = useRouter();
  const getStore = useKoUpStoreGet();
  const isUserActive = useKoUpSelector((s) => Boolean(s.user || s.authLoading));
  const userProg = useKoUpSelector((s) => (s.user || s.authLoading ? s.progressMap[item.id] : undefined));
  const isFollowed = useKoUpSelector((s) => Boolean((s.user || s.authLoading) && s.followedMediaIds.includes(item.id)));
  const isTrailerMuted = useKoUpSelector((s) => s.isTrailerMuted);
  const autoCardTrailerEnabled = useKoUpSelector((s) => s.autoCardTrailerEnabled);

  const [isHovered, setIsHovered] = useState(false);
  const [mountBackdrop, setMountBackdrop] = useState(false);
  const hasRealCover = Boolean(
    item.cover_image &&
    item.cover_image.trim() !== '' &&
    item.cover_image !== '/logo-dark.png' &&
    !item.cover_image.includes('logo-dark')
  );
  const [upgradedPoster, setUpgradedPoster] = useState<string | null>(
    () => (!hasRealCover ? (clientTrailerCache.get(item.id)?.posterUrl || null) : null)
  );
  const [upgradedBackdrop, setUpgradedBackdrop] = useState<string | null>(
    () => clientTrailerCache.get(item.id)?.backdropUrl || null
  );
  const [trailerYoutubeId, setTrailerYoutubeId] = useState<string | null>(
    () => clientTrailerCache.get(item.id)?.youtubeId || null
  );
  const [upgradedRating, setUpgradedRating] = useState<number | null>(
    () => clientTrailerCache.get(item.id)?.rating || null
  );
  const [showTrailerVideo, setShowTrailerVideo] = useState(false);
  const [isTrailerReady, setIsTrailerReady] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const trailerIframeRef = useRef<HTMLIFrameElement>(null);
  const prefetchRef = useRef(false);
  const prefetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const trailerTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Unique per-card-instance ID so the same MediaItem rendered in "Sana Özel" AND "K-Drama" rows never collides!
  const cardKey = useId();

  const isFavorited = Boolean(isUserActive && (userProg?.is_favorite || userProg?.is_favorited));
  const displayTitle = cleanMediaTitle(item.title);

  // Always retain authentic scraped cover if present, never overwrite with TMDB fuzzy matches
  const effectiveCover = hasRealCover ? item.cover_image : (upgradedPoster || item.cover_image);
  const effectiveBackdrop = upgradedBackdrop || item.backdrop_image;

  const mediaType: 'tv' | 'movie' = item.content_type === 'film' ? 'movie' : 'tv';
  const effectiveEpCount =
    item.content_type === 'film'
      ? 0
      : Math.max(Number(item.episode_count || 0), Number(item.episodes_available || 0));

  // Request w342 for 2:3 vertical poster (~480p resolution) and w780 for 16:9 card backdrop
  const posterSrc = getProxiedImageUrl(
    effectiveCover,
    item.poster_fallback_url || null,
    item.title,
    'w342',
    'poster',
    item.tmdb_id,
    mediaType
  );
  const hasDistinctBackdrop = Boolean(
    effectiveBackdrop &&
      effectiveBackdrop.trim() !== '' &&
      effectiveBackdrop !== effectiveCover
  );
  const backdropSrc = hasDistinctBackdrop
    ? getProxiedImageUrl(effectiveBackdrop, effectiveCover, item.title, 'w780', 'banner', item.tmdb_id, mediaType)
    : posterSrc;

  const countryCode = item.country_code || item.country;
  const cleanOverview = getCleanOverview(item.overview);
  const genres = Array.isArray(item.categories) ? item.categories.slice(0, 3) : [];

  // Puan gösterimi: 50+ kullanıcı oy verdiyse KoUp puanı, aksi halde IMDb/AniList/MDL fallback
  const ratingInfo = (() => {
    const siteRatingCount = Number(item.site_rating_count || 0);
    const siteRating = Number(item.site_rating || 0);

    if (siteRatingCount >= 50 && siteRating > 0) {
      return {
        score: siteRating.toFixed(1),
        isKoUp: true,
        count: siteRatingCount,
      };
    }

    if (item.content_type === 'anime' && item.anilist_rating && Number(item.anilist_rating) > 0) {
      const val = Number(item.anilist_rating);
      return {
        score: val > 10 ? (val / 10).toFixed(1) : val.toFixed(1),
        isKoUp: false,
      };
    }
    const imdbVal = upgradedRating ?? item.imdb_rating ?? (item as any).imdb_score ?? (item as any).vote_average;
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
    if (item.anilist_rating && Number(item.anilist_rating) > 0) {
      const val = Number(item.anilist_rating);
      return {
        score: val > 10 ? (val / 10).toFixed(1) : val.toFixed(1),
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

  useEffect(() => {
    registerMediaItem(item, false);
  }, [item]);

  const fetchTrailerAndUpgradeImages = useCallback(async () => {
    if (!item.id) return null;
    const cached = clientTrailerCache.get(item.id);
    if (cached) {
      if (!hasRealCover && cached.posterUrl) {
        setUpgradedPoster(cached.posterUrl);
      }
      if (cached.backdropUrl) setUpgradedBackdrop(cached.backdropUrl);
      if (cached.youtubeId) setTrailerYoutubeId(cached.youtubeId);
      if (cached.rating) setUpgradedRating(cached.rating);
      return cached;
    }

    try {
      const r = await fetch(
        `/api/media/trailer?id=${item.id}&slug=${encodeURIComponent(item.slug || '')}&title=${encodeURIComponent(item.title || '')}`
      );
      if (!r.ok) return null;
      const d = await r.json();
      const resolvedRating = d.imdbRating || d.voteAverage;
      const numRating =
        resolvedRating && !isNaN(Number(resolvedRating)) && Number(resolvedRating) > 0
          ? Number(Number(resolvedRating).toFixed(1))
          : null;
      const entry = {
        youtubeId: d.youtubeId || null,
        posterUrl: d.posterUrl || null,
        backdropUrl: d.backdropUrl || null,
        rating: numRating,
      };
      if (!hasRealCover && entry.posterUrl && entry.posterUrl.includes('image.tmdb.org')) {
        setUpgradedPoster(entry.posterUrl);
      }
      if (!item.backdrop_image && entry.backdropUrl) {
        setUpgradedBackdrop(entry.backdropUrl);
      }
      if (entry.youtubeId) {
        setTrailerYoutubeId(entry.youtubeId);
      }
      if (entry.rating) {
        setUpgradedRating(entry.rating);
      }
      clientTrailerCache.set(item.id, entry);
      return entry;
    } catch {
      return null;
    }
  }, [item.id, item.slug, item.title, hasRealCover, item.backdrop_image]);

  // Clean up active hover state if this card unmounts while open
  useEffect(() => {
    return () => {
      if (activeCardId === cardKey) {
        activeCardId = null;
        activeCardCloseFn = null;
      }
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      if (trailerTimerRef.current) clearTimeout(trailerTimerRef.current);
    };
  }, [cardKey]);

  const handleMouseEnter = useCallback(() => {
    if (isDragLocked) return;

    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return;
    }

    // Ensure backdrop is decoded & mounted before width transition begins
    if (hasDistinctBackdrop && !mountBackdrop) {
      preloadImage(backdropSrc, () => {
        setMountBackdrop(true);
      });
    }

    if (fluidWidth) {
      setIsHovered(true);
      if (!upgradedRating && !ratingInfo) {
        fetchTrailerAndUpgradeImages();
      }
    } else {
      requestAccordionHover(
        cardKey,
        () => {
          setIsHovered(true);
        },
        () => {
          setIsHovered(false);
          setShowTrailerVideo(false);
          setIsTrailerReady(false);
        }
      );
    }

    // Defer route prefetch, episode cache & trailer start until AFTER the 260ms width expansion finishes!
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      if (!upgradedRating && !ratingInfo) {
        fetchTrailerAndUpgradeImages();
      }
      if (!prefetchRef.current) {
        prefetchRef.current = true;
        router.prefetch(`/seri/${item.slug}`);
        if (item.id) {
          cachedQuery(`episodes_${item.id}`, 300_000, () =>
            fetch(`/api/sources/${item.id}`)
              .then((r) => r.json())
              .then((d) => d.episodes || [])
          ).catch(() => {});
        }
      }
    }, 420);

    // Start trailer playback 380ms after hover (once card width expansion animation is 100% finished)
    if (!fluidWidth && autoCardTrailerEnabled) {
      if (trailerTimerRef.current) clearTimeout(trailerTimerRef.current);
      trailerTimerRef.current = setTimeout(async () => {
        const cached = clientTrailerCache.get(item.id);
        if (cached?.youtubeId) {
          if (activeCardId === cardKey) {
            setIsTrailerReady(false);
            setShowTrailerVideo(true);
          }
          return;
        }
        const res = await fetchTrailerAndUpgradeImages();
        if (res?.youtubeId && activeCardId === cardKey) {
          setIsTrailerReady(false);
          setShowTrailerVideo(true);
        }
      }, 380);
    }
  }, [
    cardKey,
    fluidWidth,
    autoCardTrailerEnabled,
    hasDistinctBackdrop,
    mountBackdrop,
    backdropSrc,
    item.id,
    item.slug,
    router,
    fetchTrailerAndUpgradeImages,
  ]);

  const isTrailerMutedRef = useRef(isTrailerMuted);
  useEffect(() => {
    isTrailerMutedRef.current = isTrailerMuted;
  }, [isTrailerMuted]);

  const handleMouseLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
    if (trailerTimerRef.current) {
      clearTimeout(trailerTimerRef.current);
      trailerTimerRef.current = null;
    }
    // Mute immediately and reset video state
    postYouTubeCommand(trailerIframeRef.current, 'mute');
    setShowTrailerVideo(false);
    setIsTrailerReady(false);
    if (fluidWidth) {
      setIsHovered(false);
    } else {
      cancelAccordionHover(cardKey);
    }
  }, [cardKey, fluidWidth]);

  const toggleTrailerMute = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const st = getStore();
      st.triggerSound?.('click');
      st.toggleTrailerMuted();
    },
    [getStore]
  );

  // Synchronize YouTube iframe volume & mute state whenever global isTrailerMuted changes
  useEffect(() => {
    if (showTrailerVideo && isTrailerReady && trailerIframeRef.current?.contentWindow) {
      if (isTrailerMuted) {
        postYouTubeCommand(trailerIframeRef.current, 'mute');
      } else {
        postYouTubeCommand(trailerIframeRef.current, 'unMute');
        postYouTubeCommand(trailerIframeRef.current, 'setVolume', [85]);
      }
    }
  }, [isTrailerMuted, showTrailerVideo, isTrailerReady]);

  // Clean reveal: trailer starts immediately in the background strictly muted.
  // The moment the play button overlay disappears, it becomes visible;
  // if sound is unmuted, audio kicks in right at that moment!
  const trailerWatchCleanupRef = useRef<(() => void) | null>(null);
  const handleTrailerIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    trailerWatchCleanupRef.current?.();
    const iframe = e.currentTarget;
    // Strictly mute immediately on load so no audio leaks while hidden
    postYouTubeCommand(iframe, 'mute');

    trailerWatchCleanupRef.current = watchYouTubeIframe(iframe, {
      onVisibleChange: (visible) => {
        setIsTrailerReady(visible);
        if (visible) {
          if (!isTrailerMutedRef.current) {
            postYouTubeCommand(iframe, 'unMute');
            postYouTubeCommand(iframe, 'setVolume', [85]);
          } else {
            postYouTubeCommand(iframe, 'mute');
          }
        } else {
          postYouTubeCommand(iframe, 'mute');
        }
      },
    });
  }, []);

  useEffect(() => {
    if (showTrailerVideo) return;
    trailerWatchCleanupRef.current?.();
    trailerWatchCleanupRef.current = null;
  }, [showTrailerVideo]);

  useEffect(() => {
    return () => {
      trailerWatchCleanupRef.current?.();
      trailerWatchCleanupRef.current = null;
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        getStore().triggerSound?.('click');
        router.push(`/seri/${item.slug}`);
      }
    },
    [item.slug, router, getStore]
  );

  const isAccordionExpanded = !fluidWidth && isHovered;
  const isTrailerActive = isAccordionExpanded && showTrailerVideo && isTrailerReady;

  return (
    <div
      ref={cardRef}
      role="link"
      aria-label={`${displayTitle} detay sayfası`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        handleMouseLeave();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        router.push(`/seri/${item.slug}`);
      }}
      style={{
        ['WebkitUserDrag' as any]: 'none',
        userSelect: 'none',
      }}
      className={`koup-accordion-card koup-focus-ring relative select-none rounded-2xl overflow-hidden cursor-pointer group bg-[#0f0f11] ${
        fluidWidth
          ? 'w-full aspect-[2/3]'
          : isAccordionExpanded
            ? 'w-[320px] sm:w-[370px] md:w-[420px] h-[250px] sm:h-[280px] md:h-[300px] shrink-0 z-30 border-white/40 shadow-[0_18px_40px_rgba(0,0,0,0.9)]'
            : 'w-[165px] sm:w-[185px] md:w-[200px] h-[250px] sm:h-[280px] md:h-[300px] shrink-0 z-10 border-white/10 hover:border-white/25 shadow-md'
      }`}
    >
      {/* Background Instant Navigation Link */}
          <Link
            href={`/seri/${item.slug}`}
            prefetch={false}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            className="absolute inset-0 z-0 select-none"
            aria-label={displayTitle}
            tabIndex={-1}
          />

          {/* Rank Numeral Overlay if part of a Ranked Row (Vector Clean, Artifact-Free) */}
          {rank !== undefined && (
            <div
              className={`absolute -left-1.5 bottom-1.5 z-20 pointer-events-none transition-opacity duration-200 ${
                isAccordionExpanded ? 'opacity-15' : 'opacity-100'
              }`}
            >
              <Top10Numeral rank={rank} className="h-12 sm:h-16 w-auto" />
            </div>
          )}

          {/* LAYER 1: Base Poster Image (Rock-solid single DOM node: zero flicker, priority-aware lazy loading) */}
          <img
            src={posterSrc}
            alt={item.title}
            width={200}
            height={300}
            draggable={false}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.dataset.triedFallback && item.poster_fallback_url && item.poster_fallback_url !== effectiveCover) {
                target.dataset.triedFallback = 'true';
                target.src = getProxiedImageUrl(item.poster_fallback_url, null, item.title, 'w342', 'poster', item.tmdb_id, mediaType);
              } else if (!target.dataset.triedTmdb && item.title) {
                target.dataset.triedTmdb = 'true';
                target.src = `/api/image-proxy?title=${encodeURIComponent(item.title)}&type=media`;
              }
            }}
            className={`absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none transition-opacity duration-250 ${
              isAccordionExpanded && ((hasDistinctBackdrop && mountBackdrop) || isTrailerReady)
                ? 'opacity-0'
                : 'opacity-100'
            }`}
          />

      {/* LAYER 2: 16:9 Widescreen Backdrop Image (Mounted once, GPU opacity crossfade only) */}
      {!fluidWidth && mountBackdrop && hasDistinctBackdrop && (
        <img
          src={backdropSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none transition-opacity duration-250 ${
            isAccordionExpanded && !isTrailerReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* LAYER 3: Live 16:9 Trailer Video Preview on Expanded Card */}
      {isAccordionExpanded && showTrailerVideo && trailerYoutubeId && (
        <div
          className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-500 ${
            isTrailerReady ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <iframe
            ref={trailerIframeRef}
            src={buildCleanTrailerEmbedUrl(trailerYoutubeId)}
            title={`${displayTitle} Fragman`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            onLoad={handleTrailerIframeLoad}
            className="absolute top-1/2 left-1/2 w-[140%] h-[140%] -translate-x-1/2 -translate-y-1/2 border-0 pointer-events-none select-none"
          />
          {/* Transparent interaction shield to ensure YouTube never receives accidental taps/pauses */}
          <div className="absolute inset-0 pointer-events-auto bg-transparent select-none" />
        </div>
      )}

      {/* Unified GPU-Friendly Vignette Gradient */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          isAccordionExpanded
            ? isTrailerActive
              ? 'bg-gradient-to-t from-[#08080a]/90 via-[#08080a]/25 to-transparent'
              : 'bg-gradient-to-t from-[#08080a] via-[#08080a]/60 to-black/20'
            : 'bg-gradient-to-t from-black via-black/40 to-transparent'
        }`}
      />

      {/* Top Scrim Shadow so Country Flag & Star Rating are always crystal-clear on bright posters */}
      <div
        className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/80 via-black/35 to-transparent pointer-events-none z-10"
      />

      {/* Top Badges: Country Flag, Content Type, Ratings & Top-Right Trailer Mute Button */}
      <div className="absolute top-2.5 left-2.5 right-2.5 z-20 flex items-center justify-between gap-1.5 pointer-events-none">
        <div className="flex items-center gap-1.5">
          {countryCode ? (
            <span className="inline-flex items-center justify-center filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] drop-shadow-[0_1px_3px_rgba(0,0,0,1)] select-none">
              <CountryFlag code={countryCode} size="md" className="rounded-[3px] drop-shadow-[0_2px_5px_rgba(0,0,0,0.95)]" />
            </span>
          ) : null}

          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase bg-black/80 border border-white/20 text-white transition-opacity duration-200 ${
              isAccordionExpanded ? 'opacity-100' : 'opacity-0 hidden sm:inline-block'
            }`}
          >
            {formatContentTypeTR(item.content_type, countryCode)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Top-Right Netflix-Style White Mute / Unmute Button (Pure icon with drop-shadow, no circular container) */}
          {isAccordionExpanded && showTrailerVideo && trailerYoutubeId && (
            <button
              type="button"
              onClick={toggleTrailerMute}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              aria-label={isTrailerMuted ? 'Fragman Sesini Aç' : 'Fragman Sesini Kapat'}
              className="pointer-events-auto p-1 text-white/95 hover:text-white hover:scale-125 active:scale-90 transition-transform cursor-pointer drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]"
            >
              {isTrailerMuted ? (
                <VolumeX className="w-4.5 h-4.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
              ) : (
                <Volume2 className="w-4.5 h-4.5 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]" />
              )}
            </button>
          )}

          {ratingInfo && (
            <div className="inline-flex items-center gap-1 filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] drop-shadow-[0_1px_3px_rgba(0,0,0,1)] select-none">
              {ratingInfo.isKoUp ? (
                <>
                  <span className="text-[9px] font-black tracking-wider uppercase text-sky-400 bg-sky-500/20 px-1 py-0.5 rounded border border-sky-400/30">
                    KoUp
                  </span>
                  <Star className="w-3.5 h-3.5 fill-sky-400 text-sky-400 shrink-0 drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]" />
                </>
              ) : (
                <Star className="w-3.5 h-3.5 fill-[#f5c518] text-[#f5c518] shrink-0 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]" />
              )}
              <span className="font-extrabold text-[12px] sm:text-[13px] text-white tracking-tight drop-shadow-[0_2px_6px_rgba(0,0,0,1)] [text-shadow:0_2px_6px_rgba(0,0,0,1),0_1px_3px_rgba(0,0,0,0.95)] leading-none">
                {ratingInfo.score}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Content Area */}
      <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-3.5 z-20 flex flex-col justify-end text-left pointer-events-none">
        {(item.release_year || effectiveEpCount > 0) && (
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/65 mb-0.5">
            {item.release_year && (
              <span className="font-mono text-white/75">{item.release_year}</span>
            )}
            {item.release_year && effectiveEpCount > 0 && (
              <span className="text-white/40">•</span>
            )}
            {effectiveEpCount > 0 && (
              <span className="font-mono text-white/75">{effectiveEpCount} Bölüm</span>
            )}
            {isAccordionExpanded && item.status_broadcast && (
              <>
                <span className="text-white/40">•</span>
                <span className="text-emerald-300 font-semibold">
                  {item.status_broadcast}
                </span>
              </>
            )}
            {isAccordionExpanded && (
              <>
                <span className="text-white/40">•</span>
                <span
                  className="inline-flex items-center gap-1 font-mono text-sky-300/90"
                  title="Toplam Görüntülenme"
                >
                  <Eye className="w-3 h-3 text-sky-400 shrink-0" />
                  <span>{formatViewCount(item.views_total ?? item.views_count ?? 0)}</span>
                </span>
              </>
            )}
          </div>
        )}

        <h3 className="text-[13px] sm:text-[15px] font-bold text-white leading-snug line-clamp-1 drop-shadow-md">
          {displayTitle}
        </h3>

        {/* Expanded Widescreen Details: Fixed target width so text/genres never re-wrap across 30 frames during card width expansion */}
        {!fluidWidth && (
          <div
            className={`w-[296px] sm:w-[342px] md:w-[392px] overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${
              isAccordionExpanded && !isTrailerActive
                ? 'max-h-[76px] opacity-100 translate-y-0 mt-1.5'
                : 'max-h-0 opacity-0 translate-y-2 mt-0 pointer-events-none'
            }`}
          >
            {genres.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mb-1">
                {genres.map((g) => (
                  <span
                    key={g}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/12 text-white/90 border border-white/15"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
            {cleanOverview && (
              <p className="text-[11px] text-white/75 leading-relaxed line-clamp-2">
                {cleanOverview}
              </p>
            )}
          </div>
        )}

        {/* Quick Action Drawer on Hover */}
        <div
          className={`overflow-hidden pointer-events-auto transition-[max-height,opacity,transform] duration-200 ease-out ${
            isHovered
              ? 'max-h-[44px] opacity-100 translate-y-0'
              : 'max-h-0 opacity-0 translate-y-1'
          }`}
        >
          <div className="flex items-center gap-1.5 pt-2">
            {(() => {
              const nextEpNum = isUserActive
                ? getNextEpisodeNumber(userProg, item.episode_count || 1)
                : 1;
              const nextSeasonNum = (isUserActive && userProg?.last_season_num) || 1;
              const hasProgress = Boolean(
                isUserActive &&
                  ((userProg?.watched_episodes && userProg.watched_episodes.length > 0) ||
                    (userProg?.last_episode_num && userProg.last_episode_num > 1))
              );

              const isFilm = item.content_type === 'film' || item.content_type === 'movie';

              return (
                <Link
                  href={`/seri/${item.slug}/${nextEpNum}?season=${nextSeasonNum}`}
                  prefetch={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    getStore().triggerSound?.('click');
                  }}
                  aria-label={`${displayTitle} hemen izle`}
                  className="flex-1 py-1.5 px-3 rounded-full bg-white text-black font-bold text-[11px] flex items-center justify-center gap-1.5 hover:bg-white/90 active:scale-[0.98] transition-transform cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-black shrink-0" />
                  <span>
                    {isFilm
                      ? hasProgress
                        ? isAccordionExpanded
                          ? 'Filme Devam Et'
                          : 'Devam Et'
                        : isAccordionExpanded
                        ? 'Filmi İzle'
                        : 'İzle'
                      : hasProgress
                      ? isAccordionExpanded
                        ? `${nextEpNum}. Bölümden Devam`
                        : `${nextEpNum}. Bölüm`
                      : isAccordionExpanded
                      ? 'Hemen İzle'
                      : 'İzle'}
                  </span>
                </Link>
              );
            })()}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const st = getStore();
                st.triggerSound?.('click');
                st.toggleMediaFavorite(item);
              }}
              aria-label="Favorilere Ekle"
              className={`w-7 h-7 rounded-full bg-white/12 border border-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer ${
                isFavorited ? 'text-rose-400' : 'text-white/85 hover:text-white'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-rose-400' : ''}`} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const st = getStore();
                st.triggerSound?.('click');
                st.toggleMediaFollow(item);
              }}
              aria-label="Yeni Bölümleri Takip Et"
              className={`w-7 h-7 rounded-full bg-white/12 border border-white/15 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer ${
                isFollowed ? 'text-amber-300' : 'text-white/85 hover:text-white'
              }`}
            >
              <Bell className={`w-3.5 h-3.5 ${isFollowed ? 'fill-amber-300' : ''}`} />
            </button>

            {isAccordionExpanded && (
              <Link
                href={`/seri/${item.slug}`}
                prefetch={false}
                onClick={(e) => {
                  e.stopPropagation();
                  getStore().triggerSound?.('click');
                }}
                aria-label={`${item.title} detaylar`}
                className="w-7 h-7 rounded-full bg-white/12 border border-white/15 hover:bg-white/25 flex items-center justify-center text-white/85 hover:text-white transition-colors cursor-pointer"
              >
                <Info className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(AccordionMediaCardComponent);

