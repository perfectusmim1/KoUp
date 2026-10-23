'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Film, Star, ChevronRight, Play, Sparkles, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import {
  MediaItem,
  CastMember,
  getProxiedImageUrl,
  formatContentTypeTR,
  cleanOverviewText,
  supabase,
} from '@/lib/supabase';

// Common words to ignore when scanning for titles to avoid false positives
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'you', 'love', 'in', 'of', 'to', 'a', 'an', 'tv', 'drama',
  'dizi', 'dizisi', 'dizileri', 'film', 'filmi', 'filmleri', 'anime', 'kore',
  'güney kore', 'south korea', 'bir', 've', 'ile', 'veya', 'ben', 'sen', 'o',
  'rol', 'rolleri', 'rolleriyle', 'başrol', 'oyuncu', 'oyuncusu', 'aktris', 'aktör',
  'hangul', 'hanja', 'doğumlu', 'dikkat', 'çekti', 'yılında', 'başladı', 'yer', 'aldı'
]);

function getCountryFlag(code?: string | null): string {
  if (!code) return '🌐';
  const c = code.toUpperCase();
  if (c === 'KR') return '🇰🇷';
  if (c === 'JP') return '🇯🇵';
  if (c === 'CN') return '🇨🇳';
  if (c === 'TW') return '🇹🇼';
  if (c === 'TH') return '🇹🇭';
  if (c === 'TR') return '🇹🇷';
  if (c === 'US') return '🇺🇸';
  if (c === 'GB') return '🇬🇧';
  if (c === 'FR') return '🇫🇷';
  if (c === 'DE') return '🇩🇪';
  if (c === 'ES') return '🇪🇸';
  if (c === 'IT') return '🇮🇹';
  if (c === 'PH') return '🇵🇭';
  if (c === 'IN') return '🇮🇳';
  if (c === 'HK') return '🇭🇰';
  return '🌐';
}

interface ActiveHoverState {
  media: MediaItem;
  rect: DOMRect;
  showBelow: boolean;
}

interface WikiBioTextProps {
  text?: string | null;
  credits?: CastMember[];
  personName?: string;
  fallbackText?: string;
  className?: string;
}

export default function WikiBioText({
  text,
  credits = [],
  personName = '',
  fallbackText,
  className = '',
}: WikiBioTextProps) {
  const [extraMediaMap, setExtraMediaMap] = useState<Record<string, MediaItem>>({});
  const [activeHover, setActiveHover] = useState<ActiveHoverState | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [mounted, setMounted] = useState(false);

  const textRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 1. Build initial media lookup map from actor's credits
  const creditsMediaMap = useMemo(() => {
    const map = new Map<string, MediaItem>();
    const lowerPerson = personName.trim().toLowerCase();

    for (const c of credits) {
      const m = c.media;
      if (!m || !m.title) continue;

      const candidates = [
        m.title,
        m.title_en,
        m.title_tr,
        m.native_title,
        ...(Array.isArray(m.aka_titles) ? m.aka_titles : []),
      ].filter(Boolean) as string[];

      for (const raw of candidates) {
        const cleaned = raw.trim();
        const low = cleaned.toLowerCase();
        if (
          cleaned.length >= 2 &&
          !STOP_WORDS.has(low) &&
          low !== lowerPerson &&
          !/^\d+$/.test(cleaned)
        ) {
          map.set(low, m);
        }
      }
    }
    return map;
  }, [credits, personName]);

  // 2. Discover potential external titles mentioned in bio like "Title (YYYY)" that might not be in credits
  useEffect(() => {
    if (!text) return;

    const pattern = /([A-Za-z0-9ÇĞİÖŞÜçğıöşü\s:,'&-]{3,50})\s*\(\d{4}\)/g;
    const candidatesToFetch: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1].trim();
      const low = candidate.toLowerCase();
      if (
        !creditsMediaMap.has(low) &&
        !extraMediaMap[low] &&
        !STOP_WORDS.has(low) &&
        low !== personName.trim().toLowerCase()
      ) {
        candidatesToFetch.push(candidate);
      }
    }

    if (candidatesToFetch.length === 0) return;

    let isCancelled = false;
    async function fetchMissingMedia() {
      try {
        const { data } = await supabase
          .from('media')
          .select(
            'id, slug, content_type, country_code, country_name, title, title_tr, title_en, native_title, aka_titles, overview, release_year, episode_count, cover_image, backdrop_image, categories, site_rating, rating, mdl_rating, imdb_rating'
          )
          .in('title', candidatesToFetch.slice(0, 5));

        if (data && data.length > 0 && !isCancelled) {
          setExtraMediaMap((prev) => {
            const next = { ...prev };
            for (const item of data as MediaItem[]) {
              if (item.title) next[item.title.toLowerCase()] = item;
              if (item.title_en) next[item.title_en.toLowerCase()] = item;
              if (Array.isArray(item.aka_titles)) {
                for (const a of item.aka_titles) {
                  if (typeof a === 'string') next[a.toLowerCase()] = item;
                }
              }
            }
            return next;
          });
        }
      } catch (err) {
        console.error('Failed to auto-resolve bio media titles:', err);
      }
    }

    fetchMissingMedia();

    return () => {
      isCancelled = true;
    };
  }, [text, creditsMediaMap, extraMediaMap, personName]);

  // 3. Combined map of known titles -> MediaItem
  const allMediaMap = useMemo(() => {
    const combined = new Map<string, MediaItem>(creditsMediaMap);
    for (const [key, val] of Object.entries(extraMediaMap)) {
      if (!combined.has(key)) {
        combined.set(key, val);
      }
    }
    return combined;
  }, [creditsMediaMap, extraMediaMap]);

  // 4. Sorted candidates (longest first to avoid greedy substring collisions)
  const sortedCandidateKeys = useMemo(() => {
    return Array.from(allMediaMap.keys()).sort((a, b) => b.length - a.length);
  }, [allMediaMap]);

  // 5. Build regex and parse text into segments
  const bioSegments = useMemo(() => {
    const rawContent = (text || fallbackText || '').trim();
    if (!rawContent || sortedCandidateKeys.length === 0) {
      return [{ type: 'text' as const, content: rawContent }];
    }

    // Escape regex special chars
    const escaped = sortedCandidateKeys.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    // Word boundary pattern supporting unicode Turkish & Latin letters
    const regex = new RegExp(`(?<![\\wÀ-ž])(${escaped.join('|')})(?![\\wÀ-ž])`, 'gi');

    const segments: Array<
      | { type: 'text'; content: string }
      | { type: 'media'; content: string; media: MediaItem }
    > = [];

    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(rawContent)) !== null) {
      const matchStart = m.index;
      const matchEnd = regex.lastIndex;
      const matchedString = m[0];

      if (matchStart > lastIdx) {
        segments.push({
          type: 'text',
          content: rawContent.slice(lastIdx, matchStart),
        });
      }

      const mediaObj = allMediaMap.get(matchedString.toLowerCase());
      if (mediaObj) {
        segments.push({
          type: 'media',
          content: matchedString,
          media: mediaObj,
        });
      } else {
        segments.push({
          type: 'text',
          content: matchedString,
        });
      }

      lastIdx = matchEnd;
    }

    if (lastIdx < rawContent.length) {
      segments.push({
        type: 'text',
        content: rawContent.slice(lastIdx),
      });
    }

    return segments;
  }, [text, fallbackText, sortedCandidateKeys, allMediaMap]);

  // Handlers for hovercard interactions
  const handleLinkMouseEnter = useCallback(
    (media: MediaItem, element: HTMLElement) => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      hoverTimerRef.current = setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
        const spaceBelow = viewportHeight - rect.bottom;
        const POPOVER_HEIGHT = 240;

        // User preference: "wiki iyi hoş ama yazının altında çıksın"
        // Always prefer showing BELOW the text, unless there is physically no space at the bottom
        const showBelow = spaceBelow >= POPOVER_HEIGHT || spaceBelow >= rect.top;

        setActiveHover({
          media,
          rect,
          showBelow,
        });
      }, 100);
    },
    []
  );

  const handleLinkMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    closeTimerRef.current = setTimeout(() => {
      setActiveHover(null);
    }, 220);
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => {
      setActiveHover(null);
    }, 200);
  }, []);

  // Dismiss on scroll or window resize
  useEffect(() => {
    const handleDismiss = () => {
      if (activeHover) setActiveHover(null);
    };
    window.addEventListener('scroll', handleDismiss, { passive: true });
    window.addEventListener('resize', handleDismiss, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [activeHover]);

  // True overflow detection: Only show "Devamını Oku" if text actually overflows 4 lines
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const checkOverflow = () => {
      if (!isExpanded) {
        const isClamped = el.scrollHeight > el.clientHeight + 4;
        setHasOverflow(isClamped);
      }
    };

    checkOverflow();
    const timer = setTimeout(checkOverflow, 60);
    window.addEventListener('resize', checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [bioSegments, isExpanded]);

  return (
    <div className={`relative ${className}`}>
      {/* Biography Content with interactive Wiki links */}
      <div
        ref={textRef}
        className={`text-sm sm:text-base text-white/80 leading-relaxed transition-all duration-300 ${
          !isExpanded ? 'line-clamp-4' : ''
        }`}
      >
        {bioSegments.map((segment, idx) => {
          if (segment.type === 'text') {
            return <React.Fragment key={idx}>{segment.content}</React.Fragment>;
          }

          const m = segment.media;
          return (
            <Link
              key={idx}
              href={`/seri/${m.slug || m.id}`}
              onMouseEnter={(e) => handleLinkMouseEnter(m, e.currentTarget)}
              onMouseLeave={handleLinkMouseLeave}
              className="inline-flex items-center gap-0.5 text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-400/40 hover:decoration-sky-300 underline-offset-4 px-1 py-0.5 -mx-0.5 rounded-md hover:bg-sky-500/10 transition-colors duration-150 cursor-pointer"
            >
              <span>{segment.content}</span>
            </Link>
          );
        })}
      </div>

      {/* Expand / Collapse toggle: Rendered ONLY when text actually exceeds 4 lines */}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer select-none"
        >
          <span>{isExpanded ? 'Daha Az Göster' : 'Devamını Oku'}</span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {/* PORTAL WIKI HOVERCARD */}
      {mounted &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {activeHover && (
              <WikiHoverCard
                state={activeHover}
                onMouseEnter={handleCardMouseEnter}
                onMouseLeave={handleCardMouseLeave}
              />
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Dedicated Wiki Hovercard Component (rendered inside React Portal)
// ----------------------------------------------------------------------

interface WikiHoverCardProps {
  state: ActiveHoverState;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function WikiHoverCard({ state, onMouseEnter, onMouseLeave }: WikiHoverCardProps) {
  const { media, rect, showBelow } = state;

  const POPOVER_WIDTH = 320;
  const POPOVER_ESTIMATED_HEIGHT = 230;

  // Compute fixed coordinates relative to viewport
  const top = showBelow
    ? rect.bottom + 8
    : Math.max(12, rect.top - 8);

  const left = Math.max(
    14,
    Math.min(
      (typeof window !== 'undefined' ? window.innerWidth : 1200) - POPOVER_WIDTH - 14,
      rect.left + rect.width / 2 - POPOVER_WIDTH / 2
    )
  );

  const ratingVal =
    media.site_rating ||
    media.rating ||
    media.mdl_rating ||
    media.imdb_rating ||
    0;

  const flag = getCountryFlag(media.country_code);
  const typeLabel = formatContentTypeTR(media.content_type, media.country_code);
  const overviewClean = cleanOverviewText(media.overview);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: showBelow ? -6 : 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: showBelow ? -6 : 6 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        top,
        left,
        width: POPOVER_WIDTH,
        transform: showBelow ? 'none' : 'translateY(-100%)',
        zIndex: 99999,
      }}
      className="rounded-2xl bg-[#0e0e13]/95 backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_25px_rgba(56,189,248,0.18)] overflow-hidden pointer-events-auto select-none"
    >
      <Link
        href={`/seri/${media.slug || media.id}`}
        className="block group cursor-pointer"
      >
        {/* Top Mini Backdrop Banner */}
        <div className="h-16 relative overflow-hidden bg-black/60 border-b border-white/[0.08]">
          {media.backdrop_image || media.cover_image ? (
            <img
              src={getProxiedImageUrl(
                media.backdrop_image || media.cover_image,
                media.title
              )}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover opacity-35 filter blur-xs group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-r from-sky-500/10 via-purple-500/10 to-transparent" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e13] via-[#0e0e13]/60 to-transparent" />

          {/* Floating Badges over banner */}
          <div className="absolute top-2 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-[10px] font-mono text-white/90">
              <span>{flag}</span>
              <span>{typeLabel}</span>
              {media.release_year ? <span>• {media.release_year}</span> : null}
            </span>

            {ratingVal > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-400/30 text-amber-300 text-[10px] font-mono font-bold">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>{ratingVal.toFixed(1)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 pt-2">
          <div className="flex gap-3">
            {/* Poster Thumbnail */}
            <div className="w-16 h-24 rounded-xl overflow-hidden shrink-0 border border-white/20 shadow-2xl bg-black/50 -mt-7 relative z-10">
              {media.cover_image ? (
                <img
                  src={getProxiedImageUrl(media.cover_image, media.title)}
                  alt={media.title}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30">
                  <Film className="w-6 h-6" />
                </div>
              )}
            </div>

            {/* Title & Metadata */}
            <div className="min-w-0 flex-1">
              <h4 className="text-xs sm:text-sm font-extrabold text-white group-hover:text-sky-300 transition-colors line-clamp-1 leading-snug break-words">
                {media.title}
              </h4>
              {media.native_title && media.native_title !== media.title && (
                <div className="text-[10px] text-white/45 font-mono truncate mt-0.5">
                  {media.native_title}
                </div>
              )}

              {/* Episodes / Status */}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-white/60">
                {media.episode_count ? (
                  <span>{media.episode_count} Bölüm</span>
                ) : null}
                {media.status_broadcast ? (
                  <>
                    <span>•</span>
                    <span className="text-sky-400">{media.status_broadcast}</span>
                  </>
                ) : null}
              </div>

              {/* Category Pills */}
              {Array.isArray(media.categories) && media.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {media.categories.slice(0, 2).map((cat, cIdx) => (
                    <span
                      key={cIdx}
                      className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-[9px] text-white/70 font-mono"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Overview Synopsis */}
          {overviewClean && (
            <p className="text-[11px] text-white/70 line-clamp-2 mt-2 leading-relaxed break-words">
              {overviewClean}
            </p>
          )}

          {/* Footer Action */}
          <div className="mt-2.5 pt-2 border-t border-white/[0.08] flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>KoUp Arşivinde</span>
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 group-hover:text-sky-300 group-hover:translate-x-0.5 transition-all">
              <span>Seri Sayfasına Git</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
