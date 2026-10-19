'use client';

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Film, Play, Check, Eye } from 'lucide-react';
import { MediaItem, EpisodeData, formatEpisodeTitle, getEpisodeProgress, UserMediaProgress, formatViewCount } from '@/lib/supabase';
import CustomSelect from '@/components/CustomSelect';

const RAIL_ITEM_HEIGHT_NORMAL = 64;
const RAIL_ITEM_HEIGHT_COMPACT = 52;

interface EpisodeRailProps {
  mediaSlug: string;
  mediaTitle: string;
  mediaId: number;
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

function EpisodeRailComponent({
  mediaSlug,
  mediaTitle,
  mediaId,
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
  const rafIdRef = useRef<number | null>(null);
  const [railScrollTop, setRailScrollTop] = useState(0);

  const railRowHeight = cinemaLightsOff
    ? RAIL_ITEM_HEIGHT_COMPACT
    : RAIL_ITEM_HEIGHT_NORMAL;

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

  // Auto-scroll to active episode when season, episode or row height changes
  useEffect(() => {
    if (currentSeasonEpisodes.length === 0) return;
    const idx = currentSeasonEpisodes.findIndex(
      (e) => e.episode_number === currentEpNum
    );
    if (idx >= 0) {
      const targetScroll = Math.max(0, idx * railRowHeight - railRowHeight * 2);
      setRailScrollTop(targetScroll);
      requestAnimationFrame(() => {
        if (railListRef.current) {
          railListRef.current.scrollTop = targetScroll;
        }
      });
    }
  }, [currentEpNum, currentSeason, currentSeasonEpisodes.length, railRowHeight]);

  // Throttled onScroll to ensure buttery smooth 60-120fps scrolling with zero parent re-renders
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      setRailScrollTop(st);
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
  const totalRailEpisodes = currentSeasonEpisodes.length;
  const visibleRailCount = 14;
  const railStartIdx = Math.max(0, Math.floor(railScrollTop / railRowHeight) - 4);
  const railEndIdx = Math.min(
    totalRailEpisodes,
    railStartIdx + visibleRailCount + 8
  );
  const visibleRailEpisodes = currentSeasonEpisodes.slice(
    railStartIdx,
    railEndIdx
  );
  const railTopSpacer = railStartIdx * railRowHeight;
  const railBottomSpacer = Math.max(
    0,
    (totalRailEpisodes - railEndIdx) * railRowHeight
  );

  return (
    <div className="w-full min-h-0 relative z-20">
      <div
        style={
          playerHeight
            ? ({ '--player-height': `${playerHeight}px` } as React.CSSProperties)
            : undefined
        }
        className={`rounded-3xl border shadow-xl flex flex-col transition-all duration-300 min-h-0 overflow-hidden player-synced-height ${
          ambientLightingEnabled
            ? 'bg-[#0b0b0f]/72 backdrop-blur-xl border-white/15'
            : 'bg-[#0e0e12] border-white/10'
        } ${
          cinemaLightsOff
            ? 'p-2 sm:p-2.5 h-[380px] sm:h-[420px]'
            : 'p-4 sm:p-4.5 h-[470px] sm:h-[490px]'
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

        {/* Virtualized Vertical Scroll List with O(1) Lookups & zero parent re-renders */}
        <div
          ref={railListRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto custom-scrollbar min-h-0 p-1.5 [-webkit-overflow-scrolling:touch]"
        >
          {railTopSpacer > 0 && (
            <div style={{ height: railTopSpacer }} aria-hidden="true" />
          )}

          <div className="space-y-1.5">
            {visibleRailEpisodes.map((ep) => {
              const isPlayingThis =
                (ep.season_number || 1) === currentSeason &&
                ep.episode_number === currentEpNum;
              const epWatched = watchedSet.has(ep.episode_number);

              return (
                <div
                  key={ep.id || `${ep.season_number}-${ep.episode_number}`}
                  onClick={() => {
                    if (!isPlayingThis) {
                      onSelectEpisode(
                        ep.episode_number,
                        ep.season_number || currentSeason
                      );
                    }
                  }}
                  aria-label={formatEpisodeTitle(
                    ep.episode_name,
                    ep.season_number || currentSeason,
                    ep.episode_number
                  )}
                  title={`${formatEpisodeTitle(
                    ep.episode_name,
                    ep.season_number || currentSeason,
                    ep.episode_number
                  )}${epWatched ? ' (İzlendi)' : ''}`}
                  style={{ contain: 'content' }}
                  className={`rounded-2xl border transition-colors duration-150 cursor-pointer flex items-center justify-between group select-none ${
                    cinemaLightsOff ? 'p-2 gap-2' : 'p-2.5 sm:p-3 gap-3'
                  } ${
                    isPlayingThis
                      ? epWatched
                        ? 'bg-emerald-500/15 border-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.28)]'
                        : 'bg-sky-500/15 border-sky-400/60 shadow-[0_0_12px_rgba(41,151,255,0.28)]'
                      : epWatched
                      ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.09] border-emerald-500/35 hover:border-emerald-400/65 shadow-[0_0_8px_rgba(16,185,129,0.12)] hover:shadow-[0_0_14px_rgba(16,185,129,0.22)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06] hover:border-sky-400/60 hover:shadow-[0_0_12px_rgba(56,189,248,0.18)]'
                  }`}
                >
                  {/* Left: Number (& Title only when NOT in Sinema Modu on desktop) */}
                  <div
                    className={`flex items-center gap-2 sm:gap-2.5 min-w-0 ${
                      cinemaLightsOff ? 'shrink-0' : ''
                    }`}
                  >
                    <div
                      className={`rounded-xl flex items-center justify-center font-mono font-bold text-xs shrink-0 border transition-colors ${
                        cinemaLightsOff
                          ? 'min-w-[32px] w-8 h-8 text-[11px]'
                          : 'min-w-[36px] w-9 h-9'
                      } ${
                        isPlayingThis
                          ? epWatched
                            ? 'bg-emerald-500 border-emerald-400 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                            : 'bg-[#2997ff] border-sky-400 text-white shadow-[0_0_10px_rgba(41,151,255,0.4)]'
                          : epWatched
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          : 'bg-white/10 border-white/10 text-white/90'
                      }`}
                    >
                      {isPlayingThis ? (
                        <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                      ) : (
                        ep.episode_number
                      )}
                    </div>

                    <div
                      className={
                        cinemaLightsOff ? 'min-w-0 lg:hidden' : 'min-w-0'
                      }
                    >
                      <div
                        className={`text-xs font-bold truncate transition-colors ${
                          isPlayingThis
                            ? epWatched
                              ? 'text-emerald-300'
                              : 'text-sky-300'
                            : epWatched
                            ? 'text-white group-hover:text-emerald-300'
                            : 'text-white group-hover:text-sky-200'
                        }`}
                      >
                        {formatEpisodeTitle(
                          ep.episode_name,
                          ep.season_number || currentSeason,
                          ep.episode_number
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center flex-wrap gap-2 text-[10px] font-mono">
                        <span
                          className="inline-flex items-center gap-1 text-white/50"
                          title="Bölüm Görüntülenme Sayısı"
                        >
                          <Eye className="w-3 h-3 text-sky-400/80 shrink-0" />
                          <span>{formatViewCount(ep.views_count || 0)}</span>
                        </span>

                        {epWatched ? (
                          <span className="text-emerald-400 font-medium">
                            • İzlendi
                          </span>
                        ) : (() => {
                          const epProg = getEpisodeProgress(
                            userProgress,
                            mediaId,
                            ep.season_number || currentSeason,
                            ep.episode_number
                          );
                          if (epProg.position > 15) {
                            return (
                              <div className="flex items-center gap-1.5">
                                <div className="w-12 h-1 bg-white/20 rounded-full overflow-hidden">
                                  <div
                                    style={{ width: `${epProg.percent}%` }}
                                    className="h-full bg-[#E50914]"
                                  />
                                </div>
                                <span className="text-[9px] font-mono text-white/50">
                                  {epProg.remainingMinutes} dk kaldı
                                </span>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Right: Custom Watched Toggle Switch */}
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
                    className="shrink-0 flex items-center ml-auto"
                  >
                    <div
                      className={`relative rounded-full transition-colors duration-150 cursor-pointer flex items-center px-0.5 border ${
                        cinemaLightsOff ? 'w-9 h-5' : 'w-11 h-6'
                      } ${
                        epWatched
                          ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                          : 'bg-white/10 border-white/20 hover:border-white/40'
                      }`}
                    >
                      <div
                        className={`rounded-full bg-white shadow-md flex items-center justify-center transition-transform duration-200 transform-gpu ${
                          cinemaLightsOff
                            ? `w-4 h-4 ${epWatched ? 'translate-x-3.5' : 'translate-x-0'}`
                            : `w-5 h-5 ${epWatched ? 'translate-x-5' : 'translate-x-0'}`
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
            })}
          </div>

          {railBottomSpacer > 0 && (
            <div style={{ height: railBottomSpacer }} aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}

export const EpisodeRail = memo(EpisodeRailComponent);
export default EpisodeRail;
