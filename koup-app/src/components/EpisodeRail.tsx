'use client';

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Film, Check, Eye } from 'lucide-react';
import {
  MediaItem,
  EpisodeData,
  cleanEpisodeName,
  getEpisodeProgress,
  UserMediaProgress,
  formatViewCount,
  getProxiedImageUrl,
} from '@/lib/supabase';
import CustomSelect from '@/components/CustomSelect';

interface EpisodeRailProps {
  mediaSlug: string;
  mediaTitle: string;
  mediaId: number;
  mediaBackdrop?: string | null;
  mediaCover?: string | null;
  episodes: EpisodeData[];
  currentSeason: number;
  currentEpNum: number;
  seasons: number[];
  cinemaLightsOff?: boolean;
  playerHeight: number | null;
  watchedEpisodes: number[];
  userProgress?: UserMediaProgress | null;
  onSelectEpisode: (epNum: number, seasonNum: number) => void;
  onToggleWatched: (ep: EpisodeData) => void;
  onSelectSeason: (season: number) => void;
  ambientLightingEnabled?: boolean;
}

interface EpisodeRailRowProps {
  ep: EpisodeData;
  isPlayingThis: boolean;
  epWatched: boolean;
  cinemaLightsOff: boolean;
  currentSeason: number;
  mediaId: number;
  thumbnailUrl: string;
  userProgress?: UserMediaProgress | null;
  onSelectEpisode: (epNum: number, seasonNum: number) => void;
  onToggleWatched: (ep: EpisodeData) => void;
}

const EpisodeRailRow = memo(function EpisodeRailRow({
  ep,
  isPlayingThis,
  epWatched,
  cinemaLightsOff,
  currentSeason,
  mediaId,
  thumbnailUrl,
  userProgress,
  onSelectEpisode,
  onToggleWatched,
}: EpisodeRailRowProps) {
  const cleanSubtitle = useMemo(() => {
    if (!ep.episode_name) return null;
    const cleaned = cleanEpisodeName(
      ep.episode_name,
      ep.season_number || currentSeason,
      ep.episode_number
    );
    if (
      !cleaned ||
      cleaned === `${ep.episode_number}. Bölüm` ||
      cleaned === `Bölüm ${ep.episode_number}` ||
      cleaned === `${ep.season_number || currentSeason}. Sezon ${ep.episode_number}. Bölüm`
    ) {
      return null;
    }
    return cleaned;
  }, [ep.episode_name, ep.season_number, ep.episode_number, currentSeason]);

  const epProg = useMemo(() => {
    if (epWatched) return null;
    const p = getEpisodeProgress(
      userProgress,
      mediaId,
      ep.season_number || currentSeason,
      ep.episode_number
    );
    return p && p.position > 15 ? p : null;
  }, [userProgress, mediaId, ep.season_number, ep.episode_number, currentSeason, epWatched]);

  return (
    <div
      onClick={() => {
        if (!isPlayingThis) {
          onSelectEpisode(
            ep.episode_number,
            ep.season_number || currentSeason
          );
        }
      }}
      aria-label={`${ep.episode_number}. Bölüm`}
      style={{ contain: 'content' }}
      data-active={isPlayingThis}
      className={`relative rounded-2xl border transition-[background-color,border-color,box-shadow] duration-200 cursor-pointer flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 group select-none ${
        epWatched && isPlayingThis
          ? 'bg-emerald-500/[0.16] border-emerald-400/80 shadow-[0_0_20px_rgba(16,185,129,0.3)] ring-1 ring-emerald-400/50'
          : epWatched && !isPlayingThis
          ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.10] border-emerald-500/25 hover:border-emerald-400/50'
          : isPlayingThis
          ? 'bg-sky-500/[0.12] border-sky-400/60 shadow-[0_0_18px_rgba(41,151,255,0.22)] ring-1 ring-sky-400/30'
          : 'bg-white/[0.025] hover:bg-white/[0.06] border-white/[0.06] hover:border-white/15'
      }`}
    >
      {/* 16:9 Thumbnail Image */}
      <div
        style={{ contain: 'paint' }}
        className={`relative ${
          cinemaLightsOff ? 'w-20 sm:w-22' : 'w-24 sm:w-28'
        } aspect-video shrink-0 rounded-xl overflow-hidden bg-[#16161d] border border-white/10 group-hover:border-white/20 transition-colors shadow-xs`}
      >
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={`w-full h-full object-cover select-none pointer-events-none ${
            epWatched && !isPlayingThis ? 'opacity-70 saturate-75' : ''
          }`}
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.failed) {
              target.dataset.failed = 'true';
              target.src = '/logo-dark.png';
            }
          }}
        />
        {/* Subtle ambient gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* Middle: Title, Subtitle, Views & Progress */}
      <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-xs sm:text-[13px] font-bold truncate transition-colors ${
              epWatched && isPlayingThis
                ? 'text-emerald-300 font-extrabold'
                : epWatched && !isPlayingThis
                ? 'text-emerald-100/90 group-hover:text-white font-bold'
                : isPlayingThis
                ? 'text-sky-300 font-extrabold'
                : 'text-white group-hover:text-white font-bold'
            }`}
          >
            {ep.episode_number}. Bölüm
          </span>

          {(ep.pending || ep.status === 'pending_source') && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
              Yakında
            </span>
          )}
        </div>

        {/* Secondary title if distinct from episode number */}
        {cleanSubtitle && (
          <p className="text-[11px] text-white/45 truncate leading-tight">
            {cleanSubtitle}
          </p>
        )}

        {/* Görüntülenme Sayısı (Views) & Watch Progress */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-white/50 mt-0.5">
          <span
            className="inline-flex items-center gap-1 text-white/55"
            title="Bölüm Görüntülenme Sayısı"
          >
            <Eye className="w-3 h-3 text-sky-400/80 shrink-0" />
            <span>{formatViewCount(ep.views_count || 0)}</span>
          </span>

          {!epWatched && epProg && epProg.remainingMinutes > 0 && (
            <span className="inline-flex items-center gap-1 text-sky-300/80">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>{epProg.remainingMinutes} dk</span>
            </span>
          )}
        </div>

        {/* In-progress mini bar */}
        {!epWatched && epProg && (
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mt-1 max-w-[120px]">
            <div
              style={{ width: `${epProg.percent}%` }}
              className="h-full bg-sky-400 rounded-full"
            />
          </div>
        )}
      </div>

      {/* Right: Custom Watched Toggle Switch (Okundu / İzlendi İşaretleme) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleWatched(ep);
        }}
        aria-label={
          epWatched
            ? 'İzlendi (Kaldırmak için tıkla)'
            : 'İzlendi olarak işaretle'
        }
        className="shrink-0 flex items-center pl-1"
      >
        <div
          className={`relative rounded-full transition-all duration-200 cursor-pointer flex items-center px-0.5 border ${
            cinemaLightsOff ? 'w-8 h-4.5' : 'w-10 h-5.5'
          } ${
            epWatched
              ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
              : 'bg-white/10 border-white/20 hover:border-white/40 hover:bg-white/15'
          }`}
        >
          <div
            className={`rounded-full bg-white shadow-md flex items-center justify-center transition-transform duration-200 ${
              cinemaLightsOff
                ? `w-3.5 h-3.5 ${epWatched ? 'translate-x-3.5' : 'translate-x-0'}`
                : `w-4.5 h-4.5 ${epWatched ? 'translate-x-4.5' : 'translate-x-0'}`
            }`}
          >
            {epWatched ? (
              <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

function EpisodeRailComponent({
  mediaSlug,
  mediaTitle,
  mediaId,
  mediaBackdrop,
  mediaCover,
  episodes,
  currentSeason,
  currentEpNum,
  seasons,
  cinemaLightsOff = false,
  playerHeight,
  watchedEpisodes,
  userProgress,
  onSelectEpisode,
  onToggleWatched,
  onSelectSeason,
  ambientLightingEnabled = false,
}: EpisodeRailProps) {
  const railListRef = useRef<HTMLDivElement | null>(null);

  // Memoized thumbnail URL for all episode rows
  const thumbnailUrl = useMemo(() => {
    return getProxiedImageUrl(
      mediaBackdrop || mediaCover,
      mediaCover,
      mediaTitle,
      'w300',
      'banner'
    );
  }, [mediaBackdrop, mediaCover, mediaTitle]);

  // Filter episodes for current season (memoized)
  const currentSeasonEpisodes = useMemo(
    () => episodes.filter((e) => (e.season_number || 1) === currentSeason),
    [episodes, currentSeason]
  );

  // Fast O(1) set lookup for watched episodes
  const watchedSet = useMemo(
    () => new Set(watchedEpisodes || []),
    [watchedEpisodes]
  );

  // Auto-scroll cleanly to active episode inside rail container without affecting window scroll
  useEffect(() => {
    const container = railListRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();

    const isAbove = activeRect.top < containerRect.top + 8;
    const isBelow = activeRect.bottom > containerRect.bottom - 8;

    if (isAbove || isBelow) {
      const currentRelativeTop = activeRect.top - containerRect.top + container.scrollTop;
      const targetScroll = currentRelativeTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth',
      });
    }
  }, [currentEpNum, currentSeason]);

  return (
    <div className="w-full min-h-0 relative z-20">
      <div
        style={
          playerHeight
            ? ({ '--player-height': `${playerHeight}px` } as React.CSSProperties)
            : undefined
        }
        className={`rounded-3xl border flex flex-col transition-[height,padding,background-color,border-color,box-shadow] duration-300 min-h-0 overflow-hidden player-synced-height ${
          ambientLightingEnabled
            ? 'bg-[#0a0a0f]/45 backdrop-blur-xl border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.36),inset_0_1px_1px_rgba(255,255,255,0.08)]'
            : 'bg-[#0e0e12] border-white/10 shadow-xl'
        } ${
          cinemaLightsOff
            ? 'p-2 sm:p-2.5 h-[400px] sm:h-[440px]'
            : 'p-3.5 sm:p-4 h-[500px] sm:h-[540px]'
        }`}
      >
        {/* Rail Header */}
        <div
          className={`border-b border-white/10 shrink-0 ${
            cinemaLightsOff
              ? 'pb-2 mb-2 space-y-1.5'
              : 'flex items-center justify-between gap-2 pb-3 mb-3'
          }`}
        >
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Film className="w-4 h-4 text-sky-400 shrink-0" />
              {!cinemaLightsOff && (
                <h3 className="text-sm font-bold text-white tracking-wide truncate">
                  Bölüm Listesi
                </h3>
              )}
            </div>
            <span className="text-[11px] font-mono text-white/50 bg-white/5 px-2 py-0.5 rounded-full border border-white/10 shrink-0">
              {currentSeasonEpisodes.length} Bölüm
            </span>
          </div>

          {/* Multi-Season Dropdown */}
          {seasons.length > 1 && (
            <div
              className={
                cinemaLightsOff
                  ? 'w-full'
                  : 'min-w-[110px] max-w-[130px] shrink-0'
              }
            >
              <CustomSelect
                value={String(currentSeason)}
                onChange={(val) => onSelectSeason(Number(val) || 1)}
                variant="dark"
                size="sm"
                portal={true}
                options={seasons.map((s) => ({
                  value: String(s),
                  label: `${s}. Sezon`,
                }))}
              />
            </div>
          )}
        </div>

        {/* Vertical Scroll List with zero layout jitter & instant response */}
        <div
          ref={railListRef}
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 p-1 [-webkit-overflow-scrolling:touch]"
        >
          <div className="space-y-2">
            {currentSeasonEpisodes.map((ep) => {
              const isPlayingThis =
                (ep.season_number || 1) === currentSeason &&
                ep.episode_number === currentEpNum;
              const epWatched = watchedSet.has(ep.episode_number);

              return (
                <EpisodeRailRow
                  key={ep.id || `${ep.season_number}-${ep.episode_number}`}
                  ep={ep}
                  isPlayingThis={isPlayingThis}
                  epWatched={epWatched}
                  cinemaLightsOff={cinemaLightsOff}
                  currentSeason={currentSeason}
                  mediaId={mediaId}
                  thumbnailUrl={thumbnailUrl}
                  userProgress={userProgress}
                  onSelectEpisode={onSelectEpisode}
                  onToggleWatched={onToggleWatched}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export const EpisodeRail = memo(EpisodeRailComponent);
export default EpisodeRail;
