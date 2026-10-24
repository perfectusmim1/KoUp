'use client';

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { motion } from 'motion/react';
import { X, Play, ChevronDown, Eye } from 'lucide-react';
import {
  MediaItem,
  EpisodeData,
  cleanMediaTitle,
  cleanEpisodeName,
  getEpisodeProgress,
  formatViewCount,
} from '@/lib/supabase';

const EP_ROW_COLLAPSED_H = 44;

interface NetflixEpisodePopoverProps {
  media: MediaItem;
  episodes: EpisodeData[];
  currentSeason: number;
  currentEpisode: number;
  seasons: number[];
  effectiveTime: number;
  safeDuration: number;
  progressMap: any;
  toggleEpisodeWatched: (media: MediaItem, epNum: number) => void;
  onSelectEpisode: (season: number, ep: number) => void;
  flushCurrentProgress: (action?: 'completed' | 'playback' | 'pause' | 'exit', arg?: boolean) => void;
  onClose: () => void;
  capturedFrameUrl: string | null;
  fallbackBackdropUrl: string;
  episodePreviewCache: Map<string, string>;
}

interface NetflixEpisodeRowProps {
  ep: EpisodeData;
  media: MediaItem;
  drawerSeason: number;
  currentSeason: number;
  currentEpisode: number;
  isExpanded: boolean;
  isEpWatched: boolean;
  effectiveTime: number;
  safeDuration: number;
  progressMap: any;
  capturedFrameUrl: string | null;
  fallbackBackdropUrl: string;
  episodePreviewCache: Map<string, string>;
  onSelectEpisode: (season: number, ep: number) => void;
  toggleEpisodeWatched: (media: MediaItem, epNum: number) => void;
  onExpand: (epNum: number) => void;
  flushCurrentProgress: (action?: 'completed' | 'playback' | 'pause' | 'exit', arg?: boolean) => void;
  onClose: () => void;
}

const NetflixEpisodeRow = memo(function NetflixEpisodeRow({
  ep,
  media,
  drawerSeason,
  currentSeason,
  currentEpisode,
  isExpanded,
  isEpWatched,
  effectiveTime,
  safeDuration,
  progressMap,
  capturedFrameUrl,
  fallbackBackdropUrl,
  episodePreviewCache,
  onSelectEpisode,
  toggleEpisodeWatched,
  onExpand,
  flushCurrentProgress,
  onClose,
}: NetflixEpisodeRowProps) {
  const epSeason = ep.season_number || drawerSeason;
  const isCurrent =
    epSeason === currentSeason &&
    ep.episode_number === currentEpisode;

  let epSavedProg = getEpisodeProgress(
    progressMap?.[media.id],
    media.id,
    epSeason,
    ep.episode_number
  );

  if (epSavedProg.position <= 0 && typeof window !== 'undefined') {
    try {
      const rawLocal = localStorage.getItem(`koup_ep_pos_${media.id}_${epSeason}_${ep.episode_number}`);
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal);
        const pos = typeof parsed === 'number' ? parsed : parsed?.position || 0;
        const dur = parsed?.duration || safeDuration || 3600;
        if (pos > 0) {
          const pct = Math.min(99, Math.max(5, Math.round((pos / dur) * 100)));
          const remMin = Math.ceil(Math.max(0, dur - pos) / 60);
          epSavedProg = {
            position: pos,
            duration: dur,
            percent: pct,
            isWatched: isEpWatched,
            remainingMinutes: remMin,
          };
        }
      }
    } catch {}
  }

  let epProgressPct = 0;
  let epRemainingLabel: string | null = null;

  if (isCurrent) {
    const currentRatio = safeDuration > 0 ? effectiveTime / safeDuration : 0;
    epProgressPct = Math.min(100, Math.max(6, Math.round(currentRatio * 100)));
    const remMin = Math.max(1, Math.ceil((safeDuration - effectiveTime) / 60));
    epRemainingLabel = `${remMin} dk kaldı`;
  } else if (isEpWatched) {
    epProgressPct = 100;
    epRemainingLabel = 'İzlendi';
  } else if (epSavedProg.percent > 0 || epSavedProg.position > 5) {
    epProgressPct = epSavedProg.percent;
    epRemainingLabel = `${epSavedProg.remainingMinutes} dk kaldı`;
  }

  const epSubtitle = cleanEpisodeName(
    ep.episode_name,
    epSeason,
    ep.episode_number
  );
  const hasSubtitle =
    epSubtitle && epSubtitle !== `${ep.episode_number}. Bölüm`;
  const epTitle = hasSubtitle
    ? epSubtitle
    : `${ep.episode_number}. Bölüm`;

  const epCacheKey = `${media.id}_s${epSeason}_e${ep.episode_number}`;
  const cachedEpImg = episodePreviewCache.get(epCacheKey);
  const previewImg =
    cachedEpImg ||
    (isCurrent && capturedFrameUrl
      ? capturedFrameUrl
      : fallbackBackdropUrl);

  if (isExpanded) {
    return (
      <div
        key={`expanded-${ep.id || `${ep.season_number}-${ep.episode_number}`}`}
        style={{ contain: 'content' }}
        onClick={() => {
          onClose();
          if (!isCurrent) {
            flushCurrentProgress('exit', false);
            onSelectEpisode(
              epSeason,
              ep.episode_number
            );
          }
        }}
        className="bg-[#121212] hover:bg-[#1a1a1a] px-2.5 sm:px-4 py-2 sm:py-2.5 flex flex-col gap-2 border-l-4 border-l-white cursor-pointer select-none group transition-colors duration-150"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs sm:text-sm font-bold text-white font-mono shrink-0">
              {ep.episode_number}
            </span>
            <span className="text-xs sm:text-sm font-bold text-white truncate">
              {epTitle}
            </span>
            {(ep.pending || ep.status === 'pending_source') && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                Yakında
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative w-20 sm:w-28 aspect-video rounded overflow-hidden bg-black/90 border border-white/15 shrink-0">
            {previewImg && (
              <img
                src={previewImg}
                alt={epTitle}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  if (
                    fallbackBackdropUrl &&
                    e.currentTarget.src !== fallbackBackdropUrl
                  ) {
                    e.currentTarget.src = fallbackBackdropUrl;
                  }
                }}
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-black/35 group-hover:bg-black/50 flex items-center justify-center transition-colors">
              <div
                key={`play-circle-${ep.episode_number}`}
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/75 group-hover:bg-black/90 group-focus:bg-black/90 border border-white/35 group-hover:border-white/70 flex items-center justify-center text-white shadow-md"
              >
                <Play className="w-3.5 h-3.5 fill-white text-white translate-x-[1px]" />
              </div>
            </div>
            {epProgressPct > 0 && (
              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25">
                <div
                  style={{ width: `${epProgressPct}%` }}
                  className={`h-full ${isEpWatched ? 'bg-emerald-400' : 'bg-[#E50914]'}`}
                />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[10px] sm:text-xs font-semibold text-white/90 leading-tight line-clamp-1 sm:line-clamp-2">
              {isCurrent
                ? 'Şu anda bu bölümdesiniz'
                : `${epSeason}. Sezon ${ep.episode_number}. Bölüm${hasSubtitle ? ` • ${epSubtitle}` : ''}`}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
              <span className="inline-flex items-center gap-1 text-white/55">
                <Eye className="w-3 h-3 text-red-500 shrink-0" />
                <span>{formatViewCount(ep.views_count || 0)}</span>
              </span>
              {epRemainingLabel && (
                <span className={isEpWatched ? 'text-emerald-400 font-semibold' : 'text-white/60'}>
                  • {isEpWatched ? '✓ İzlendi' : `⏱ ${epRemainingLabel}`}
                </span>
              )}
            </div>
            {ep.intro_start_sec != null && (
              <div className="flex flex-wrap items-center gap-1.5 text-[9px] sm:text-[10px] font-mono text-amber-400 font-semibold">
                <span>• İntro Atlama</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      key={`collapsed-${ep.id || `${ep.season_number}-${ep.episode_number}`}`}
      style={{ height: EP_ROW_COLLAPSED_H, contain: 'content' }}
      onClick={() => {
        onExpand(ep.episode_number);
      }}
      className="px-3.5 sm:px-5 flex items-center justify-between gap-3 bg-[#1b1b1b] hover:bg-[#262626] transition-colors duration-150 cursor-pointer select-none group"
    >
      <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
        <span
          className={`text-xs sm:text-sm font-mono font-bold w-5 sm:w-6 shrink-0 ${
            isCurrent ? 'text-white font-black' : 'text-white/65 group-hover:text-white'
          }`}
        >
          {ep.episode_number}
        </span>
        <span
          className={`text-xs sm:text-sm truncate ${
            isCurrent
              ? 'text-white font-bold'
              : 'text-white/80 font-medium group-hover:text-white'
          }`}
        >
          {epTitle}
        </span>
        {(ep.pending || ep.status === 'pending_source') && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
            Yakında
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {epProgressPct > 0 && (
          <div className="flex items-center gap-1.5">
            {epRemainingLabel && !isEpWatched && (
              <span className="text-[10px] font-mono text-white/50">
                {epRemainingLabel}
              </span>
            )}
            <div className="w-10 sm:w-14 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                style={{ width: `${epProgressPct}%` }}
                className={`h-full ${isEpWatched ? 'bg-emerald-400' : 'bg-[#E50914]'}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function NetflixEpisodePopoverComponent({
  media,
  episodes,
  currentSeason,
  currentEpisode,
  seasons,
  effectiveTime,
  safeDuration,
  progressMap,
  toggleEpisodeWatched,
  onSelectEpisode,
  flushCurrentProgress,
  onClose,
  capturedFrameUrl,
  fallbackBackdropUrl,
  episodePreviewCache,
}: NetflixEpisodePopoverProps) {
  const [drawerSeason, setDrawerSeason] = useState<number>(currentSeason || 1);
  const [expandedEpNum, setExpandedEpNum] = useState<number>(currentEpisode);
  const [epPopoverScrollTop, setEpPopoverScrollTop] = useState<number>(0);
  const epPopoverListRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Fast O(1) set lookup for watched episodes
  const watchedSet = useMemo(
    () => new Set(progressMap[media.id]?.watched_episodes || []),
    [progressMap, media.id]
  );

  // Filter episodes for active drawer season
  const drawerEpisodes = useMemo(
    () => episodes.filter((e) => (e.season_number || 1) === drawerSeason),
    [episodes, drawerSeason]
  );

  // Auto-scroll to current episode on mount or when season changes
  useEffect(() => {
    const idx = drawerEpisodes.findIndex(
      (e) => e.episode_number === currentEpisode
    );
    if (idx >= 0) {
      const targetScroll = Math.max(0, idx * EP_ROW_COLLAPSED_H - 60);
      setEpPopoverScrollTop(targetScroll);
      requestAnimationFrame(() => {
        if (epPopoverListRef.current) {
          epPopoverListRef.current.scrollTop = targetScroll;
        }
      });
    }
  }, [drawerSeason]);

  // Throttled scroll listener to guarantee 60-120fps with zero parent player re-renders
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      setEpPopoverScrollTop(st);
      rafIdRef.current = null;
    });
  };

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Virtualization window calculation
  const totalEpCount = drawerEpisodes.length;
  const visibleWindowCount = 14;
  const startEpIndex = Math.max(
    0,
    Math.floor(epPopoverScrollTop / EP_ROW_COLLAPSED_H) - 4
  );
  const endEpIndex = Math.min(
    totalEpCount,
    startEpIndex + visibleWindowCount + 8
  );
  const visiblePopoverEpisodes = drawerEpisodes.slice(
    startEpIndex,
    endEpIndex
  );
  const topSpacerHeight = startEpIndex * EP_ROW_COLLAPSED_H;
  const bottomSpacerHeight = Math.max(
    0,
    (totalEpCount - endEpIndex) * EP_ROW_COLLAPSED_H
  );

  return (
    <motion.div
      key="panel-episodes"
      initial={{ opacity: 0, scale: 0.95, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 16 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      data-netflix-control="true"
      className="w-[92vw] sm:w-[400px] max-w-[420px] h-[300px] sm:h-[380px] max-h-[60vh] rounded-xl bg-[#181818] border border-white/15 shadow-[0_24px_75px_rgba(0,0,0,0.95)] flex flex-col overflow-hidden"
    >
      {/* Netflix Popover Header: Series Title + Season Tabs + Close */}
      <div className="px-3 sm:px-4 pt-2.5 sm:pt-3.5 pb-2 sm:pb-2.5 bg-[#202020] border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h3 className="text-xs sm:text-sm font-bold text-white truncate">
            {cleanMediaTitle(media.title)}
          </h3>
          {seasons.length > 1 && (
            <div className="flex items-center gap-1 mt-1 overflow-x-auto no-scrollbar">
              {seasons.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setDrawerSeason(s);
                    setEpPopoverScrollTop(0);
                    if (epPopoverListRef.current) {
                      epPopoverListRef.current.scrollTop = 0;
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-bold transition-colors cursor-pointer shrink-0 ${
                    drawerSeason === s
                      ? 'bg-white text-black font-black'
                      : 'bg-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  {s}. Sezon
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer shrink-0"
          aria-label="Kapat"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Virtualized Netflix Episode Rows */}
      <div
        ref={epPopoverListRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto divide-y divide-white/[0.06] custom-scrollbar [-webkit-overflow-scrolling:touch]"
      >
        {topSpacerHeight > 0 && (
          <div style={{ height: topSpacerHeight }} aria-hidden="true" />
        )}

        {visiblePopoverEpisodes.map((ep) => (
          <NetflixEpisodeRow
            key={ep.id || `${ep.season_number}-${ep.episode_number}`}
            ep={ep}
            media={media}
            drawerSeason={drawerSeason}
            currentSeason={currentSeason}
            currentEpisode={currentEpisode}
            isExpanded={expandedEpNum === ep.episode_number}
            isEpWatched={watchedSet.has(ep.episode_number)}
            effectiveTime={effectiveTime}
            safeDuration={safeDuration}
            progressMap={progressMap}
            capturedFrameUrl={capturedFrameUrl}
            fallbackBackdropUrl={fallbackBackdropUrl}
            episodePreviewCache={episodePreviewCache}
            onSelectEpisode={onSelectEpisode}
            toggleEpisodeWatched={toggleEpisodeWatched}
            onExpand={setExpandedEpNum}
            flushCurrentProgress={flushCurrentProgress}
            onClose={onClose}
          />
        ))}

        {bottomSpacerHeight > 0 && (
          <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
        )}
      </div>
    </motion.div>
  );
}

export const NetflixEpisodePopover = memo(NetflixEpisodePopoverComponent);
export default NetflixEpisodePopover;
