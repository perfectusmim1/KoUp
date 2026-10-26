'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import type Hls from 'hls.js';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Layers,
  Clock,
  X,
  Check,
  Lock,
  Unlock,
  ArrowLeft,
  Sun,
  RotateCw,
  Play,
  Lightbulb,
  Sparkles,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  Film,
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Cast as CastIcon,
  FastForward,
  Settings,
} from 'lucide-react';
import {
  MediaItem,
  EpisodeData,
  EpisodeSource,
  CastMember,
  getProxiedImageUrl,
  cleanMediaTitle,
  cleanQualityLabel,
  cleanEpisodeName,
  formatEpisodeTitle,
  getEpisodeProgress,
} from '@/lib/supabase';
import { useKoUp, useKoUpSelector } from '@/context/KoUpContext';
import { cleanSourceName } from '@/lib/cleanFansub';
import NetflixEpisodePopover from '@/components/NetflixEpisodePopover';
import { buildCleanTrailerEmbedUrl, watchYouTubeIframe } from '@/lib/youtubeTrailer';

/* ============================================================================
   CUSTOM NETFLIX AUTHENTIC SVG ICONS (Matched to Reference Screenshots)
   ============================================================================ */

function NetflixRewind10Icon({
  className = 'w-14 h-14',
  isAnimating = false,
}: {
  className?: string;
  isAnimating?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${isAnimating ? 'animate-rewind-spring' : ''}`}
    >
      {/* Circular 300-degree arc */}
      <path
        d="M22.5 11.8C14.5 15.5 9 23.6 9 33C9 45.7 19.3 56 32 56C44.7 56 55 45.7 55 33C55 21.6 46.7 12.1 35.8 10.3"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* Double left-pointing arrows at top */}
      <path
        d="M27.5 5.5L21 11.2L27.5 16.9"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M35.5 5.5L29 11.2L35.5 16.9"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 5 numeral centered */}
      <text
        x="32"
        y="39.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="19"
        fontWeight="700"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Plus Jakarta Sans', sans-serif"
        letterSpacing="-0.5"
      >
        5
      </text>
    </svg>
  );
}

const NetflixRewind5Icon = NetflixRewind10Icon;

function NetflixForward10Icon({
  className = 'w-14 h-14',
  isAnimating = false,
}: {
  className?: string;
  isAnimating?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${isAnimating ? 'animate-forward-spring' : ''}`}
    >
      {/* Circular 300-degree arc */}
      <path
        d="M41.5 11.8C49.5 15.5 55 23.6 55 33C55 45.7 44.7 56 32 56C19.3 56 9 45.7 9 33C9 21.6 17.3 12.1 28.2 10.3"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* Double right-pointing arrows at top */}
      <path
        d="M36.5 5.5L43 11.2L36.5 16.9"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28.5 5.5L35 11.2L28.5 16.9"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 5 numeral centered */}
      <text
        x="32"
        y="39.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="19"
        fontWeight="700"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Plus Jakarta Sans', sans-serif"
        letterSpacing="-0.5"
      >
        5
      </text>
    </svg>
  );
}

const NetflixForward5Icon = NetflixForward10Icon;

function NetflixPauseBarsIcon({ className = 'w-16 h-16' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="11" y="7" width="9.5" height="34" rx="1.5" fill="currentColor" />
      <rect x="27.5" y="7" width="9.5" height="34" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function NetflixPlayTriangleIcon({ className = 'w-16 h-16' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M13 7.8C13 6.6 14.3 5.9 15.3 6.5L40.2 22.7C41.1 23.3 41.1 24.7 40.2 25.3L15.3 41.5C14.3 42.1 13 41.4 13 40.2V7.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NetflixEpisodesIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="7" width="15" height="12" rx="1.5" fill="currentColor" />
      <path
        d="M6 4.5H19.5C20.3284 4.5 21 5.17157 21 6V15.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9 2H21.5C22.3284 2 23 2.67157 23 3.5V12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NetflixSpeedIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M4.2 18.5C2.8 16.7 2 14.4 2 12C2 6.5 6.5 2 12 2C17.5 2 22 6.5 22 12C22 14.4 21.2 16.7 19.8 18.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13L16.5 7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="2" fill="currentColor" />
    </svg>
  );
}

function NetflixNextEpIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M4 5.2C4 4.4 4.9 3.9 5.6 4.4L16.2 11.2C16.8 11.6 16.8 12.4 16.2 12.8L5.6 19.6C4.9 20.1 4 19.6 4 18.8V5.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <line
        x1="19.5"
        y1="4.5"
        x2="19.5"
        y2="19.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NetflixAudioSubtitleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M20 4H4C2.9 4 2 4.9 2 6V16C2 17.1 2.9 18 4 18H7L10 21V18H20C21.1 18 22 17.1 22 16V6C22 4.9 21.1 4 20 4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="7" y1="9" x2="17" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="7" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export interface SubtitleTrack {
  label: string;
  lang: string;
  url: string;
  default?: boolean;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface AudioTrackOption {
  id: number;
  label: string;
  name?: string;
  lang?: string;
}

function parseWebVTT(vttText: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;
  const blocks = vttText.replace(/\r\n/g, '\n').split(/\n\n+/);

  const parseSec = (h: string | undefined, m: string, s: string, ms: string) => {
    const hours = h ? parseInt(h, 10) : 0;
    const mins = parseInt(m, 10);
    const secs = parseInt(s, 10);
    const millis = parseInt(ms, 10);
    return hours * 3600 + mins * 60 + secs + millis / 1000;
  };

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (timeRegex.test(lines[i])) {
        timeIndex = i;
        break;
      }
    }
    if (timeIndex === -1) continue;
    const match = lines[timeIndex].match(timeRegex);
    if (!match) continue;

    const start = parseSec(match[1], match[2], match[3], match[4]);
    const end = parseSec(match[5], match[6], match[7], match[8]);
    const textLines = lines
      .slice(timeIndex + 1)
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    const dedupedLines: string[] = [];
    for (const line of textLines) {
      if (dedupedLines.length === 0 || dedupedLines[dedupedLines.length - 1] !== line) {
        dedupedLines.push(line);
      }
    }
    const text = dedupedLines.join('\n').trim();
    if (text) {
      const prevCue = cues[cues.length - 1];
      if (prevCue && prevCue.text === text && Math.abs(prevCue.start - start) < 0.05) {
        prevCue.end = Math.max(prevCue.end, end);
      } else {
        cues.push({ start, end, text });
      }
    }
  }
  return cues;
}

/* ============================================================================
   STREAM URL HELPERS
   ============================================================================ */

function isUnframableUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return true;
  const low = rawUrl.toLowerCase();
  if (
    low.includes('.m3u8') ||
    low.includes('.mp4') ||
    low.includes('.ts') ||
    low.includes('.webm') ||
    low.includes('.vtt')
  ) {
    return true;
  }
  if (
    low.includes('pichive') ||
    low.includes('dplayer') ||
    low.includes('hotlinger') ||
    low.includes('asyawatch') ||
    low.includes('dizilla') ||
    low.includes('azelvid') ||
    low.includes('playerdkorea') ||
    low.includes('ddizi.tel') ||
    low.includes('storage.diziyou.one') ||
    low.includes('dystream') ||
    low.includes('vmpx.online') ||
    low.includes('acek-cdn') ||
    low.includes('owphbf24') ||
    low.includes('sprintcdn') ||
    low.includes('fastsupplyhub') ||
    low.includes('smartcheckout') ||
    low.includes('videopixelvanto') ||
    low.includes('tau-video.xyz/api/') ||
    low.includes('hdfilmcehennemi') ||
    low.includes('rapidrame') ||
    low.includes('/rplayer/')
  ) {
    return true;
  }
  return false;
}

function formatStreamUrlWithTimestamp(rawUrl: string, startSec: number): string {
  if (!rawUrl || startSec <= 10) return rawUrl;
  const sec = Math.floor(startSec);
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      u.searchParams.set('start', String(sec));
      return u.toString();
    }
    if (u.hostname.includes('ok.ru') || u.hostname.includes('odnoklassniki')) {
      u.searchParams.set('time', String(sec));
      return u.toString();
    }
    if (u.hostname.includes('dailymotion.com')) {
      u.searchParams.set('start', String(sec));
      return u.toString();
    }
    if (!u.searchParams.has('t') && !u.searchParams.has('time')) {
      u.searchParams.set('t', String(sec));
    }
    u.hash = `t=${sec}`;
    return u.toString();
  } catch {
    if (rawUrl.includes('#')) {
      return `${rawUrl.split('#')[0]}#t=${sec}`;
    }
    return `${rawUrl}#t=${sec}`;
  }
}

function normalizePlayerStreamUrl(rawUrl: string, startSec: number): { url: string; isYouTube: boolean } {
  if (!rawUrl) return { url: '', isYouTube: false };

  const isYt =
    rawUrl.includes('youtube.com') ||
    rawUrl.includes('youtu.be') ||
    rawUrl.includes('youtube-nocookie.com');

  if (isYt) {
    let videoId = '';
    const embedMatch = rawUrl.match(/\/embed\/([a-zA-Z0-9_\-]+)/);
    const watchMatch = rawUrl.match(/[?&]v=([a-zA-Z0-9_\-]+)/);
    const shortMatch = rawUrl.match(/youtu\.be\/([a-zA-Z0-9_\-]+)/);

    if (embedMatch) videoId = embedMatch[1];
    else if (watchMatch) videoId = watchMatch[1];
    else if (shortMatch) videoId = shortMatch[1];

    if (videoId) {
      const origin =
        typeof window !== 'undefined' && window.location.origin
          ? window.location.origin
          : 'http://localhost:3000';
      const sec = Math.floor(startSec || 0);
      const startParam = sec > 10 ? `&start=${sec}` : '';
      const cleanYtUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&controls=1&modestbranding=1&iv_load_policy=3&origin=${encodeURIComponent(
        origin
      )}&widget_referrer=${encodeURIComponent(origin)}${startParam}`;
      return { url: cleanYtUrl, isYouTube: true };
    }
  }

  return { url: formatStreamUrlWithTimestamp(rawUrl, startSec), isYouTube: false };
}

export interface NetflixPlayerProps {
  media: MediaItem;
  episodes?: EpisodeData[];
  isLoadingEpisodes?: boolean;
  currentSeason?: number;
  currentEpisode?: number;
  onSelectEpisode?: (season: number, episode: number) => void;
  cast?: CastMember[];
  selectedSourceIdx?: number;
  onSourceDead?: (deadUrl: string) => void;
  onSelectSourceIdx?: (idx: number) => void;
  cinemaLightsOff?: boolean;
  onToggleCinemaLights?: () => void;
  ambientLightingEnabled?: boolean;
  onToggleAmbientLighting?: () => void;
  autoNextEnabled?: boolean;
  onToggleAutoNext?: () => void;
  initialSeekTime?: number;
  isTrailerMode?: boolean;
  trailerYoutubeId?: string | null;
  onCloseTrailer?: () => void;
  hasRail?: boolean;
  variant?: 'default' | 'vertical' | string;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
}

type ActivePanel = 'episodes' | 'speed' | 'sources' | 'audio_subtitles' | 'quality' | 'playback_settings' | null;

// Module-level persistent cache for episode video preview frame snapshots
// Key: `${mediaId}_s${seasonNumber}_e${episodeNumber}` -> Data URL string
const episodePreviewCache = new Map<string, string>();

const EP_ROW_COLLAPSED_H = 44;
const EP_ROW_EXPANDED_H = 132;

export default function NetflixPlayer({
  media,
  episodes = [],
  isLoadingEpisodes = false,
  currentSeason = 1,
  currentEpisode = 1,
  onSelectEpisode = () => {},
  selectedSourceIdx: propSelectedSourceIdx,
  onSelectSourceIdx,
  onSourceDead,
  cinemaLightsOff: propCinemaLightsOff,
  onToggleCinemaLights,
  ambientLightingEnabled: propAmbientLightingEnabled,
  onToggleAmbientLighting: propOnToggleAmbientLighting,
  autoNextEnabled: propAutoNextEnabled,
  onToggleAutoNext: propOnToggleAutoNext,
  initialSeekTime = 0,
  isTrailerMode = false,
  trailerYoutubeId: propTrailerYoutubeId,
  onCloseTrailer,
  hasRail = false,
}: NetflixPlayerProps) {
  const router = useRouter();
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const updateEpisodeProgress = useKoUpSelector((s) => s.updateEpisodeProgress);
  const toggleEpisodeWatched = useKoUpSelector((s) => s.toggleEpisodeWatched);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const isTrailerMuted = useKoUpSelector((s) => s.isTrailerMuted);
  const setTrailerMuted = useKoUpSelector((s) => s.setTrailerMuted);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const scrubberRef = useRef<HTMLInputElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTouchTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingVolumeRef = useRef(false);
  const volumeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedVolumeRef = useRef(1);
  const isHoveringBottomControlsRef = useRef(false);

  // Performance & high-frequency event throttling refs
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const bufferedPercentRef = useRef(0);
  const activeSubtitleTextRef = useRef<string | null>(null);
  const nextCountdownRef = useRef<number | null>(null);
  const hoverTimeRef = useRef<number | null>(null);
  const lastPointerMoveRef = useRef(0);

  const currentEpObj =
    episodes.find(
      (e) =>
        (e.season_number || 1) === currentSeason && e.episode_number === currentEpisode
    ) ||
    episodes.find((e) => e.episode_number === currentEpisode) ||
    episodes[0];

  const availableSources: EpisodeSource[] = currentEpObj?.sources || [];
  const filteredSources = availableSources;

  // Source selection state with sticky memory across episodes
  const [internalSourceIdx, setInternalSourceIdx] = useState(0);
  const selectedSourceIdx =
    propSelectedSourceIdx !== undefined ? propSelectedSourceIdx : internalSourceIdx;

  const setSelectedSourceIdx = useCallback(
    (idx: number) => {
      const src = filteredSources[idx];
      if (src) {
        const prov = src.provider || src.source_name;
        if (prov && typeof window !== 'undefined') {
          try {
            localStorage.setItem('koup_preferred_provider', prov);
          } catch {}
        }
      }
      if (onSelectSourceIdx) onSelectSourceIdx(idx);
      else setInternalSourceIdx(idx);
    },
    [filteredSources, onSelectSourceIdx]
  );

  const activeSource: EpisodeSource | undefined =
    filteredSources[selectedSourceIdx] || availableSources[0];

  const selectPreferredSourceForEpisode = useCallback(() => {
    if (typeof window === 'undefined' || filteredSources.length === 0) {
      if (onSelectSourceIdx) onSelectSourceIdx(0);
      else setInternalSourceIdx(0);
      return;
    }
    const savedProvider = localStorage.getItem('koup_preferred_provider')?.toLowerCase().trim();

    if (savedProvider) {
      const matchIdx = filteredSources.findIndex((s) => {
        const sProv = (s.provider || '').toLowerCase();
        const sName = (s.source_name || '').toLowerCase();
        return sProv === savedProvider || sName.includes(savedProvider) || savedProvider.includes(sName);
      });
      if (matchIdx !== -1) {
        if (onSelectSourceIdx) onSelectSourceIdx(matchIdx);
        else setInternalSourceIdx(matchIdx);
        return;
      }
    }
    if (onSelectSourceIdx) onSelectSourceIdx(0);
    else setInternalSourceIdx(0);
  }, [filteredSources, onSelectSourceIdx]);

  // Dedicated YouTube watch state
  const [forceEmbedYouTube, setForceEmbedYouTube] = useState(false);
  useEffect(() => {
    setForceEmbedYouTube(false);
  }, [currentEpisode, currentSeason, selectedSourceIdx]);

  // Cinema lights handling
  const [internalCinemaLights, setInternalCinemaLights] = useState(false);
  const cinemaLightsOff =
    propCinemaLightsOff !== undefined ? propCinemaLightsOff : internalCinemaLights;
  const toggleCinemaLights = useCallback(() => {
    if (onToggleCinemaLights) {
      onToggleCinemaLights();
    } else {
      setInternalCinemaLights((v) => !v);
    }
  }, [onToggleCinemaLights]);

  const isMovie = media.content_type === 'film' || media.content_type === 'movie';

  // Stream resolution state
  const [resolvedMode, setResolvedMode] = useState<
    'native_hls' | 'native_mp4' | 'iframe' | 'trailer' | 'resolving' | 'error'
  >(isTrailerMode ? 'trailer' : 'resolving');
  const [streamUrl, setStreamUrl] = useState<string>('');
  const hasRefreshedStreamRef = useRef(false);
  const [internalTrailerYtId, setInternalTrailerYtId] = useState<string | null>(
    propTrailerYoutubeId || null
  );

  // HUD Toast feedback
  const [hudToast, setHudToast] = useState<{ label: string; key: number } | null>(null);
  const hudToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerHudToast = useCallback((label: string) => {
    if (hudToastTimerRef.current) clearTimeout(hudToastTimerRef.current);
    setHudToast({ label, key: Date.now() });
    hudToastTimerRef.current = setTimeout(() => {
      setHudToast(null);
    }, 1100);
  }, []);

  // Google Cast / Remote Playback API
  const [isCasting, setIsCasting] = useState(false);
  const [isCastSupported, setIsCastSupported] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initCast = () => {
      if ((window as any).cast?.framework) {
        try {
          (window as any).cast.framework.CastContext.getInstance().setOptions({
            receiverApplicationId: (window as any).chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845',
            autoJoinPolicy: (window as any).chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED,
          });
          setIsCastSupported(true);
        } catch {}
      }
    };

    if (!(window as any).cast) {
      (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
        if (isAvailable) initCast();
      };
      if (!document.getElementById('google-cast-sdk')) {
        const script = document.createElement('script');
        script.id = 'google-cast-sdk';
        script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
        script.async = true;
        document.head.appendChild(script);
      }
    } else {
      initCast();
    }

    const video = videoRef.current as any;
    if (video?.remote) {
      setIsCastSupported(true);
      const updateCastState = () => {
        setIsCasting(video.remote.state === 'connected' || video.remote.state === 'connecting');
      };
      video.remote.addEventListener('connecting', updateCastState);
      video.remote.addEventListener('connect', updateCastState);
      video.remote.addEventListener('disconnect', updateCastState);
      return () => {
        video.remote?.removeEventListener?.('connecting', updateCastState);
        video.remote?.removeEventListener?.('connect', updateCastState);
        video.remote?.removeEventListener?.('disconnect', updateCastState);
      };
    }
  }, [resolvedMode]);

  const handleCastPrompt = useCallback(async () => {
    triggerHudToast('Televizyon Aranıyor...');

    // 1. Try Google Cast Web SDK (Direct native Chromecast dialog in Chrome / Edge)
    if (typeof window !== 'undefined' && (window as any).cast?.framework) {
      try {
        const castContext = (window as any).cast.framework.CastContext.getInstance();
        await castContext.requestSession();
        setIsCasting(true);
        triggerHudToast('Televizyona Bağlandı!');
        return;
      } catch (err: any) {
        if (err !== 'cancel' && err?.errorCode !== 'cancel') {
          console.log('Google Cast requestSession:', err);
        }
      }
    }

    // 2. Try HTML5 RemotePlayback API (Android Chrome & Smart TV browsers)
    const video = videoRef.current as any;
    if (video?.remote && typeof video.remote.prompt === 'function') {
      try {
        await video.remote.prompt();
        return;
      } catch (err: any) {
        if (err.name !== 'NotFoundError' && err.name !== 'NotAllowedError') {
          console.warn('RemotePlayback prompt error:', err);
        }
      }
    }

    // 3. Try WebKit / Safari AirPlay
    if (video?.webkitShowPlaybackTargetPicker) {
      try {
        video.webkitShowPlaybackTargetPicker();
        return;
      } catch (err) {
        console.warn('AirPlay prompt error:', err);
      }
    }

    // 4. Always provide immediate, helpful instructions if direct hardware hook couldn't open native dialog
    pushNotification(
      'TV / Ekrana Yansıt',
      'Tarayıcınızın menüsünden (⋮ Üç Nokta -> Yayınla / Cast) veya sayfaya sağ tıklayıp "Yayınla..." seçeneğini kullanarak doğrudan televizyonunuza aktarabilirsiniz.',
      'info'
    );
    triggerHudToast('Menüden "Yayınla / Cast" seçin');
  }, [pushNotification, triggerHudToast]);

  useEffect(() => {
    if (propTrailerYoutubeId) {
      setInternalTrailerYtId(propTrailerYoutubeId);
    } else if (isTrailerMode && media?.id) {
      fetch(
        `/api/media/trailer?id=${media.id}&slug=${encodeURIComponent(media.slug || '')}&title=${encodeURIComponent(media.title || '')}`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d?.youtubeId) setInternalTrailerYtId(d.youtubeId);
        })
        .catch(() => {});
    }
  }, [propTrailerYoutubeId, isTrailerMode, media?.id, media?.slug, media?.title]);

  const sendTrailerYtCommand = useCallback((func: string, args: any[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({
          event: 'command',
          func,
          args,
        }),
        '*'
      );
    } catch {}
  }, []);

  const [isTrailerReady, setIsTrailerReady] = useState(false);
  const effectiveTrailerYtId = isTrailerMode ? (internalTrailerYtId || propTrailerYoutubeId) : null;
  const trailerStreamUrl = effectiveTrailerYtId
    ? buildCleanTrailerEmbedUrl(effectiveTrailerYtId)
    : '';

  const trailerWatchCleanupRef = useRef<(() => void) | null>(null);
  const handleTrailerIframeLoad = useCallback((e: React.SyntheticEvent<HTMLIFrameElement>) => {
    trailerWatchCleanupRef.current?.();
    sendTrailerYtCommand('mute');
    trailerWatchCleanupRef.current = watchYouTubeIframe(e.currentTarget, {
      onVisibleChange: (visible) => {
        setIsTrailerReady(visible);
        if (visible) {
          if (!isTrailerMuted) {
            sendTrailerYtCommand('unMute');
            sendTrailerYtCommand('setVolume', [85]);
          } else {
            sendTrailerYtCommand('mute');
          }
        } else {
          sendTrailerYtCommand('mute');
        }
      },
    });
  }, [isTrailerMuted, sendTrailerYtCommand]);

  useEffect(() => {
    if (!isTrailerMode) {
      trailerWatchCleanupRef.current?.();
      trailerWatchCleanupRef.current = null;
      setIsTrailerReady(false);
    }
  }, [isTrailerMode]);

  useEffect(() => {
    if (isTrailerMode && isTrailerReady) {
      if (isTrailerMuted) {
        sendTrailerYtCommand('mute');
      } else {
        sendTrailerYtCommand('unMute');
        sendTrailerYtCommand('setVolume', [85]);
      }
    }
  }, [isTrailerMuted, isTrailerMode, isTrailerReady, sendTrailerYtCommand]);

  useEffect(() => {
    return () => {
      trailerWatchCleanupRef.current?.();
      trailerWatchCleanupRef.current = null;
    };
  }, []);

  const [qualities, setQualities] = useState<Array<{ label: string; url: string; levelIndex?: number }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('koup_preferred_quality') || 'Otomatik';
      } catch {}
    }
    return 'Otomatik';
  });
  const [isResolving, setIsResolving] = useState(false);

  // Subtitles & Dual Audio tracks state
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('off');
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number>(0);

  // Native video playback & HUD state
  const [isPlaying, setIsPlaying] = useState(isTrailerMode ? true : false);
  const [isBuffering, setIsBuffering] = useState(false);
  const initialCalculatedResume = (() => {
    try {
      if (initialSeekTime && initialSeekTime > 0) return initialSeekTime;
      const epProg = getEpisodeProgress(
        progressMap[media.id],
        media.id,
        currentSeason,
        currentEpisode
      );
      if (epProg.isWatched && epProg.position >= epProg.duration * 0.92) return 0;
      return epProg.position || 0;
    } catch {
      return 0;
    }
  })();
  const [currentTime, setCurrentTime] = useState<number>(initialCalculatedResume);
  const [isResumeReady, setIsResumeReady] = useState<boolean>(initialCalculatedResume <= 3);
  const [duration, setDuration] = useState<number>(() => {
    return isTrailerMode ? 180 : 0;
  });
  const [deadSourceKeys, setDeadSourceKeys] = useState<Set<string>>(() => new Set());
  const [bufferedPercent, setBufferedPercent] = useState(0);

  // Progress ticker for smooth trailer seekbar
  useEffect(() => {
    if (!isTrailerMode || !isPlaying) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      setCurrentTime((prev) => {
        const d = duration > 0 ? duration : 180;
        return prev < d ? prev + 0.5 : 0;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [isTrailerMode, isPlaying, duration]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number>(0);
  const [showRemainingTime, setShowRemainingTime] = useState(true);

  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const saved = localStorage.getItem('koup_player_volume');
      if (saved !== null) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
      }
    } catch {}
    return 1;
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (isTrailerMode) return Boolean(isTrailerMuted);
    if (typeof window === 'undefined') return false;
    try {
      const savedMute = localStorage.getItem('koup_player_muted');
      if (savedMute !== null) return savedMute === 'true';
    } catch {}
    return false;
  });
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [brightness, setBrightness] = useState(100); // 45% to 130%
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(!isTrailerMode);
  const showOverlayRef = useRef(showOverlay);
  showOverlayRef.current = showOverlay;
  const [isScreenLocked, setIsScreenLocked] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [videoZoomScale, setVideoZoomScale] = useState<number>(1);
  const pinchStateRef = useRef<{
    active: boolean;
    startDist: number;
    startScale: number;
    triggeredInGesture: boolean;
    lastPinchEndTime: number;
  }>({
    active: false,
    startDist: 0,
    startScale: 1,
    triggeredInGesture: false,
    lastPinchEndTime: 0,
  });

  useEffect(() => {
    if (!isFullscreen) {
      setVideoZoomScale(1);
    }
  }, [isFullscreen]);
  const [activePanel, _setActivePanel] = useState<ActivePanel>(null);
  const activePanelRef = useRef<ActivePanel>(null);

  const setActivePanel = useCallback(
    (action: React.SetStateAction<ActivePanel>) => {
      _setActivePanel((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        activePanelRef.current = next;
        if (next !== null && hideControlsTimer.current) {
          clearTimeout(hideControlsTimer.current);
          hideControlsTimer.current = null;
        }
        return next;
      });
    },
    []
  );

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isMobileInline =
    !isFullscreen &&
    (isTouchDevice || (typeof window !== 'undefined' && window.innerWidth < 768));

  const SPEED_RATES = useMemo(
    () => [
      { value: 0.25, label: '0.25x' },
      { value: 0.5, label: '0.5x' },
      { value: 0.75, label: '0.75x' },
      { value: 1, label: '1x' },
      { value: 1.25, label: '1.25x' },
      { value: 1.5, label: '1.5x' },
      { value: 2, label: '2x' },
    ],
    []
  );

  const applySpeed = useCallback(
    (rate: number) => {
      if (rate === playbackRate) return;
      setPlaybackRate(rate);
      if (videoRef.current) videoRef.current.playbackRate = rate;
      triggerHudToast(`Hız: ${rate === 1 ? '1x' : `${rate}x`}`);
    },
    [playbackRate, triggerHudToast]
  );

  // Prevent background body scroll when mobile bottom sheet modal is open
  useEffect(() => {
    if (
      isMobileInline &&
      (activePanel === 'speed' ||
        activePanel === 'audio_subtitles' ||
        activePanel === 'playback_settings')
    ) {
      const origOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = origOverflow;
      };
    }
  }, [isMobileInline, activePanel]);
  const [capturedFrameUrl, setCapturedFrameUrl] = useState<string | null>(null);

  // Instant Seek & Volume Feedback Animations
  const [seekFeedback, setSeekFeedback] = useState<{
    dir: 'left' | 'right';
    amount: number;
    key: number;
  } | null>(null);
  const seekFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Netflix Mobile Double-Tap Edge Ripple Wave
  const [mobileSeekRipple, setMobileSeekRipple] = useState<{
    dir: 'left' | 'right';
    amount: number;
    key: number;
  } | null>(null);
  const mobileSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sinematik Işıklandırma (YouTube-style Dual-Buffer Ambient Lighting)
  const ambientCanvasRefA = useRef<HTMLCanvasElement | null>(null);
  const ambientCanvasRefB = useRef<HTMLCanvasElement | null>(null);
  const activeAmbientBufferRef = useRef<0 | 1>(0);
  const [internalAmbientLighting, setInternalAmbientLighting] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_ambient_lighting');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const ambientLightingEnabled =
    propAmbientLightingEnabled !== undefined ? propAmbientLightingEnabled : internalAmbientLighting;

  const toggleAmbientLighting = useCallback(() => {
    if (propOnToggleAmbientLighting) {
      propOnToggleAmbientLighting();
      return;
    }
    setInternalAmbientLighting((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_ambient_lighting', String(next));
      } catch {}
      triggerHudToast(next ? 'Sinematik Işıklandırma: Açık' : 'Sinematik Işıklandırma: Kapalı');
      return next;
    });
  }, [propOnToggleAmbientLighting, triggerHudToast]);

  // Seamless quality switching helper (HLS levels & MP4 stream URLs)
  const handleSelectQuality = useCallback(
    (q: { label: string; url: string; levelIndex?: number }) => {
      const cleanLabel = cleanQualityLabel(q.label);
      setSelectedQuality(cleanLabel);
      try {
        localStorage.setItem('koup_preferred_quality', cleanLabel);
      } catch {}

      // 1. HLS multi-level dynamic bitrate switching
      if (hlsRef.current && typeof q.levelIndex === 'number') {
        hlsRef.current.currentLevel = q.levelIndex;
        triggerHudToast(`Kalite: ${cleanLabel}`);
        return;
      }

      // 2. Direct MP4 / source URL switching with playback time preservation
      if (videoRef.current && q.url && q.url !== streamUrl) {
        const cur = videoRef.current.currentTime;
        const wasPaused = videoRef.current.paused;
        setStreamUrl(q.url);
        videoRef.current.src = q.url;
        videoRef.current.currentTime = cur;
        if (!wasPaused) {
          videoRef.current.play().catch(() => {});
        }
      }
      triggerHudToast(`Kalite: ${cleanLabel}`);
    },
    [streamUrl, triggerHudToast]
  );

  // Synchronize audio volume & muted state with videoRef
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [isMuted, volume]);

  // Ambient lighting canvas frame sampling loop with dual-buffer fluid crossfade (wave-like color flow)
  useEffect(() => {
    if (!ambientLightingEnabled || !isPlaying || isFullscreen || isTrailerMode) return;
    const canvasA = ambientCanvasRefA.current;
    const canvasB = ambientCanvasRefB.current;
    if (!canvasA || !canvasB) return;

    const ctxA = canvasA.getContext('2d', { willReadFrequently: false });
    const ctxB = canvasB.getContext('2d', { willReadFrequently: false });
    if (!ctxA || !ctxB) return;

    let timerId: NodeJS.Timeout | null = null;
    let isCancelled = false;

    // Instant sample on mount / seek so lighting responds without delay
    const sampleInstant = () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          ctxA.drawImage(v, 0, 0, 32, 18);
          ctxB.drawImage(v, 0, 0, 32, 18);
          canvasA.style.opacity = '1';
          canvasB.style.opacity = '0';
          activeAmbientBufferRef.current = 0;
        } catch {}
      }
    };
    sampleInstant();

    // Silky smooth cross-fade loop (650ms sampling cadence with 1200ms GPU opacity blend)
    const sampleCrossfade = () => {
      if (isCancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.paused) return;

      requestAnimationFrame(() => {
        if (isCancelled) return;
        try {
          const nextBuffer: 0 | 1 = activeAmbientBufferRef.current === 0 ? 1 : 0;
          const targetCanvas = nextBuffer === 1 ? canvasB : canvasA;
          const currentCanvas = nextBuffer === 1 ? canvasA : canvasB;
          const targetCtx = nextBuffer === 1 ? ctxB : ctxA;

          targetCtx.drawImage(v, 0, 0, 32, 18);
          targetCanvas.style.opacity = '1';
          currentCanvas.style.opacity = '0';
          activeAmbientBufferRef.current = nextBuffer;
        } catch {}
      });
    };

    timerId = setInterval(sampleCrossfade, 650);

    const handleSeeked = () => {
      sampleInstant();
    };
    const vEl = videoRef.current;
    vEl?.addEventListener('seeked', handleSeeked);

    return () => {
      isCancelled = true;
      if (timerId) clearInterval(timerId);
      vEl?.removeEventListener('seeked', handleSeeked);
    };
  }, [ambientLightingEnabled, isPlaying, isFullscreen, isTrailerMode]);

  // Detect touch / mobile device vs desktop mouse
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const updateTouch = () => {
      setIsTouchDevice(mq.matches || ('ontouchstart' in window && window.innerWidth < 1024));
    };
    updateTouch();
    mq.addEventListener?.('change', updateTouch);
    window.addEventListener('resize', updateTouch);
    return () => {
      mq.removeEventListener?.('change', updateTouch);
      window.removeEventListener('resize', updateTouch);
    };
  }, []);

  const [internalAutoNext, setInternalAutoNext] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_auto_next');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const autoNextEnabled =
    propAutoNextEnabled !== undefined ? propAutoNextEnabled : internalAutoNext;

  const toggleAutoNext = useCallback(() => {
    if (propOnToggleAutoNext) {
      propOnToggleAutoNext();
      return;
    }
    setInternalAutoNext((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_auto_next', String(next));
      } catch {}
      triggerHudToast(next ? 'Otomatik Sonraki Bölüm: Açık' : 'Otomatik Sonraki Bölüm: Kapalı');
      return next;
    });
  }, [propOnToggleAutoNext, triggerHudToast]);

  const [autoSkipIntro, setAutoSkipIntro] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem('koup_auto_skip_intro');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const toggleAutoSkipIntro = useCallback(() => {
    setAutoSkipIntro((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_auto_skip_intro', String(next));
      } catch {}
      triggerHudToast(next ? 'Otomatik İntro Atlama: Açık' : 'Otomatik İntro Atlama: Kapalı');
      return next;
    });
  }, [triggerHudToast]);

  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [cancelledAutoNextForEp, setCancelledAutoNextForEp] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState<number>(3);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSkippedIntroEpRef = useRef<string | null>(null);
  const hasTriggeredNextRef = useRef(false);

  const selectSubtitleDirect = useCallback(async (label: string, subList: SubtitleTrack[]) => {
    setSelectedSubtitle(label);
    if (label === 'off') {
      setSubtitleCues([]);
      setActiveSubtitleText(null);
      return;
    }
    const sub = subList.find((s) => s.label === label);
    if (sub) {
      try {
        const resp = await fetch(sub.url);
        if (resp.ok) {
          const text = await resp.text();
          const cues = parseWebVTT(text);
          setSubtitleCues(cues);
        }
      } catch {}
    }
  }, []);

  const handleSelectSubtitle = useCallback(
    (label: string) => {
      selectSubtitleDirect(label, subtitles);
      if (label === 'off') {
        triggerHudToast('Altyazı: Kapalı');
      } else {
        triggerHudToast(`Altyazı: ${label}`);
      }
    },
    [selectSubtitleDirect, subtitles, triggerHudToast]
  );

  const switchAudioTrack = useCallback(
    (trackId: number) => {
      setCurrentAudioTrackId(trackId);
      if (hlsRef.current) {
        hlsRef.current.audioTrack = trackId;
        const trackObj = audioTracks.find((t) => t.id === trackId);
        triggerHudToast(`Ses: ${trackObj?.label || 'Değiştirildi'}`);
      }
    },
    [audioTracks, triggerHudToast]
  );

  // Scheduled Episode Live Countdown
  const [countdownText, setCountdownText] = useState('');

  // Keep active episode frame synced when currentSeason/currentEpisode changes
  useEffect(() => {
    const key = `${media.id}_s${currentSeason || 1}_e${currentEpisode || 1}`;
    const cached = episodePreviewCache.get(key);
    setCapturedFrameUrl(cached || null);
  }, [media.id, currentSeason, currentEpisode]);

  // Capture a live video frame for the active episode preview when opening the Episodes popover
  const captureCurrentVideoFrame = useCallback(() => {
    const key = `${media.id}_s${currentSeason || 1}_e${currentEpisode || 1}`;
    // If already cached, reuse immediately without recreating or redrawing canvas
    const cached = episodePreviewCache.get(key);
    if (cached) {
      if (capturedFrameUrl !== cached) setCapturedFrameUrl(cached);
      return;
    }

    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;

    // Minimum 30s preferred to ensure intro cards/watermarks/red logos have finished
    const isPastIntro = v.currentTime >= 60 || (v.duration > 0 && v.duration < 60 && v.currentTime >= 25);
    if (!isPastIntro && !episodePreviewCache.has(key)) {
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Center-crop source video frame into 16:9 (320x180) to eliminate any letterbox borders
        const vW = v.videoWidth;
        const vH = v.videoHeight;
        const vAspect = vW / vH;
        const targetAspect = 16 / 9;
        let sx = 0;
        let sy = 0;
        let sw = vW;
        let sh = vH;
        if (vAspect > targetAspect) {
          sw = Math.round(vH * targetAspect);
          sx = Math.round((vW - sw) / 2);
        } else {
          sh = Math.round(vW / targetAspect);
          sy = Math.round((vH - sh) / 2);
        }
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, 320, 180);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (dataUrl && dataUrl.startsWith('data:image/')) {
          episodePreviewCache.set(key, dataUrl);
          setCapturedFrameUrl(dataUrl);
        }
      }
    } catch {
      // Cross-origin stream without CORS headers falls back to series backdrop image
    }
  }, [media.id, currentSeason, currentEpisode, capturedFrameUrl]);

  const seasons = Array.from(
    new Set(episodes.map((e) => e.season_number || 1))
  ).sort((a, b) => a - b);

  // Capture video frame when episodes panel is opened
  useEffect(() => {
    if (activePanel !== 'episodes') return;
    captureCurrentVideoFrame();
  }, [activePanel, captureCurrentVideoFrame]);

  // Exact resume position & duration computation
  // Stabilize initial resume time per episode session so that frequent local progress flushes
  // do not cause targetResume to constantly change and re-resolve the stream / re-mount HLS!
  const epSessionKey = `${media?.id || 0}_${currentSeason}_${currentEpisode}`;
  const epSessionRef = useRef<string>('');
  const initialResumeRef = useRef<number>(0);
  const targetResumeRef = useRef<number>(0);

  if (epSessionRef.current !== epSessionKey) {
    const isFirstMount = epSessionRef.current === '';
    epSessionRef.current = epSessionKey;

    const epProg = getEpisodeProgress(
      progressMap[media.id],
      media.id,
      currentSeason,
      currentEpisode
    );

    if (isFirstMount && initialSeekTime && initialSeekTime > 0) {
      initialResumeRef.current = initialSeekTime;
    } else if (epProg.isWatched && epProg.position >= epProg.duration * 0.92) {
      initialResumeRef.current = 0;
    } else if (epProg.position > 0) {
      initialResumeRef.current = epProg.position;
    } else {
      initialResumeRef.current = 0;
    }
  }

  const targetResume = initialResumeRef.current;
  targetResumeRef.current = targetResume;
  const userProgress = progressMap[media.id];

  const mediaTotalDuration =
    (media.duration_minutes ? media.duration_minutes * 60 : 0) ||
    userProgress?.resume_duration_sec ||
    3600;

  // Telemetry refs for tracking progress
  const [fallbackIframeUrl, setFallbackIframeUrl] = useState<string>('');
  const trackedTimeRef = useRef<number>(targetResume);
  const trackedDurationRef = useRef<number>(mediaTotalDuration);
  const hasRealTelemetryRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const isScrubbingRef = useRef<boolean>(false);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    isScrubbingRef.current = isScrubbing;
  }, [isScrubbing]);

  // When episode changes, reset telemetry refs, restore sticky preferred source and close drawers
  const prevEpKeyRef = useRef<string>(`${currentSeason}_${currentEpisode}`);
  useEffect(() => {
    const key = `${currentSeason}_${currentEpisode}`;
    if (prevEpKeyRef.current !== key) {
      prevEpKeyRef.current = key;
      trackedTimeRef.current = targetResume;
      trackedDurationRef.current = 0;
      setCurrentTime(targetResume);
      setDuration(isTrailerMode ? 180 : 0);
      durationRef.current = 0;
      setIsResumeReady(targetResume <= 3);
      hasRealTelemetryRef.current = false;
      setActivePanel(null);
      selectPreferredSourceForEpisode();
    }
  }, [currentSeason, currentEpisode, mediaTotalDuration, targetResume, selectPreferredSourceForEpisode]);

  const sendSeekToIframe = useCallback((timeSec: number) => {
    if (!iframeRef.current?.contentWindow) return;
    const win = iframeRef.current.contentWindow;
    const sec = Math.floor(timeSec);
    try {
      win.postMessage(JSON.stringify({ event: 'seek', time: sec }), '*');
    } catch {}
    try {
      win.postMessage(JSON.stringify({ method: 'setCurrentTime', value: sec }), '*');
    } catch {}
    try {
      win.postMessage(JSON.stringify({ type: 'player:seek', data: { time: sec } }), '*');
    } catch {}
    try {
      win.postMessage({ type: 'seek', time: sec, seconds: sec }, '*');
    } catch {}
    try {
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [sec, true] }),
        '*'
      );
    } catch {}
  }, []);

  // Sync sticky preferred source and clear countdown when episode changes
  useEffect(() => {
    selectPreferredSourceForEpisode();
    setNextCountdown(null);
  }, [currentSeason, currentEpisode, selectPreferredSourceForEpisode]);

  // Fullscreen change synchronization
  useEffect(() => {
    const handleFullscreenChange = () => {
      const activeFs = Boolean(
        document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement
      );
      setIsFullscreen(activeFs);
      if (!activeFs) {
        setActivePanel((prev) => (prev === 'quality' || prev === 'episodes' ? null : prev));
        try {
          (screen.orientation as any)?.unlock?.();
        } catch {}
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Global unmount cleanup
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      if (singleClickTimerRef.current) clearTimeout(singleClickTimerRef.current);
      if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
      if (hudToastTimerRef.current) clearTimeout(hudToastTimerRef.current);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const video = videoRef.current as any;
    if (!el) return;

    const isCurrentlyFs = Boolean(
      document.fullscreenElement || (document as any).webkitFullscreenElement
    );

    if (!isCurrentlyFs) {
      if (el.requestFullscreen) {
        await el.requestFullscreen().catch(() => {});
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      } else if (video?.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
      try {
        await (screen.orientation as any)?.lock?.('landscape');
      } catch {}
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
    }
  }, []);

  // External fullscreen trigger event listener
  useEffect(() => {
    const handleFsTrigger = () => {
      toggleFullscreen();
    };
    window.addEventListener('koup-toggle-fullscreen', handleFsTrigger);
    return () => window.removeEventListener('koup-toggle-fullscreen', handleFsTrigger);
  }, [toggleFullscreen]);

  // Resolve active source via /api/resolve-stream
  const activeSourceUrl = activeSource?.direct_url || '';
  const activeSourceProvider = activeSource?.provider || '';

  useEffect(() => {
    if (isTrailerMode) {
      setResolvedMode('trailer');
      setIsResolving(false);
      return;
    }
    if (!activeSourceUrl) {
      setIsResolving(false);
      return;
    }
    let cancelled = false;

    async function resolve() {
      hasRefreshedStreamRef.current = false;
      setIsResolving(true);
      setResolvedMode('resolving');
      const normalizedFallback = normalizePlayerStreamUrl(activeSourceUrl, targetResume).url;
      setFallbackIframeUrl(normalizedFallback);
      setAudioTracks([]);
      setCurrentAudioTrackId(0);

      try {
        let data: any = null;
        let respStatus = 200;

        // Direct Client-Side / Local Edge Resolution for Tau Video (bypasses Vercel US-East datacenter WAF blocks on tau-video.xyz)
        const isTauSource =
          activeSourceProvider === 'tau-video' ||
          activeSourceProvider.toLowerCase().includes('tau') ||
          activeSourceUrl.toLowerCase().includes('tau-video');

        if (isTauSource) {
          const tauCode =
            activeSourceUrl.match(/\/embed\/([a-zA-Z0-9_-]+)/)?.[1] ||
            activeSourceUrl.match(/\/video\/([a-zA-Z0-9_-]+)/)?.[1] ||
            activeSourceUrl.match(/([a-f0-9]{24,64})/i)?.[1] ||
            activeSourceUrl.split('/').pop()?.split('?')[0];

          if (tauCode) {
            let tauJson: any = null;
            let tauDead = false;

            // 1. Primary: Direct browser fetch to tau-video.xyz API (uses user's residential IP, CORS-enabled '*')
            try {
              const directTauResp = await fetch(
                `https://tau-video.xyz/api/video/${encodeURIComponent(tauCode)}`,
                {
                  headers: { Accept: 'application/json' },
                  signal: AbortSignal.timeout(4500),
                }
              );
              if (directTauResp.status === 404 || directTauResp.status === 410) {
                tauDead = true;
              } else if (directTauResp.ok) {
                const parsed = await directTauResp.json();
                if (parsed?.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
                  tauJson = parsed;
                }
              }
            } catch {}

            // 2. Secondary: Local Cloudflare Edge Worker (hits user's nearest TR/EU Cloudflare PoP)
            if (!tauJson && !tauDead) {
              try {
                const edgeTauResp = await fetch(
                  `https://koup-edge-worker.caganhuseyinerdil.workers.dev/tau?key=${encodeURIComponent(tauCode)}`,
                  {
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(4500),
                  }
                );
                if (edgeTauResp.status === 404 || edgeTauResp.status === 410) {
                  tauDead = true;
                } else if (edgeTauResp.ok) {
                  const parsed = await edgeTauResp.json();
                  if (parsed?.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
                    tauJson = parsed;
                  }
                }
              } catch {}
            }

            if (tauDead) {
              respStatus = 410;
              data = { isDead: true };
            } else if (tauJson?.urls && tauJson.urls.length > 0) {
              const sorted = [...tauJson.urls].sort((a: any, b: any) => {
                const qa = parseInt(a.label || '0', 10);
                const qb = parseInt(b.label || '0', 10);
                return qb - qa;
              });
              const directQualities = sorted.map((q: any) => ({
                label: q.label || '1080p',
                url: q.url,
              }));
              data = {
                mode: 'native_mp4',
                qualities: directQualities,
                streamUrl: directQualities[0].url,
                thumbnails: tauJson.thumbnails || undefined,
                fallbackIframe: activeSourceUrl,
              };
            }
          }
        }

        // Direct Client-Side / Local Edge Resolution for AsyaWatch & Pichive / DPlayer (bypasses Vercel AWS Lambda WAF checks)
        const isPichiveSource =
          activeSourceProvider === 'asyawatch' ||
          activeSourceProvider.toLowerCase().includes('asyawatch') ||
          activeSourceProvider.toLowerCase().includes('pichive') ||
          activeSourceProvider.toLowerCase().includes('dplayer') ||
          activeSourceUrl.toLowerCase().includes('pichive.online') ||
          activeSourceUrl.toLowerCase().includes('dplayer82.site') ||
          activeSourceUrl.toLowerCase().includes('dplayer') ||
          activeSourceUrl.toLowerCase().includes('sn.hotlinger.com');

        if (!data && isPichiveSource) {
          try {
            const edgePichiveResp = await fetch(
              `https://koup-edge-worker.caganhuseyinerdil.workers.dev/pichive?url=${encodeURIComponent(activeSourceUrl)}`,
              {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(6000),
              }
            );

            if (edgePichiveResp.status === 410) {
              respStatus = 410;
              data = { isDead: true };
            } else if (edgePichiveResp.ok) {
              const pData = await edgePichiveResp.json();
              if (pData?.status === 'success' && pData.streamUrl) {
                const masterUrl = pData.streamUrl;
                const origin = 'https://four.pichive.online';
                const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterUrl)}&ref=${encodeURIComponent(activeSourceUrl)}`;
                const subtitles = (pData.subtitles || []).map((s: any) => {
                  const rawFile = String(s.file || '');
                  const fullSubUrl = rawFile.startsWith('http')
                    ? rawFile
                    : rawFile.startsWith('//')
                    ? `https:${rawFile}`
                    : `${origin}${rawFile.startsWith('/') ? '' : '/'}${rawFile}`;
                  return {
                    label: s.label || 'Türkçe',
                    lang: s.lang || 'tr',
                    url: `/api/stream-proxy?url=${encodeURIComponent(fullSubUrl)}&ref=${encodeURIComponent(activeSourceUrl)}`,
                    default: !!s.default,
                  };
                });

                data = {
                  mode: 'native_hls',
                  streamUrl: proxiedMaster,
                  streamType: 'hls',
                  directUrl: masterUrl,
                  posterImage: pData.poster || null,
                  subtitles,
                  qualities: [
                    { label: '1080p (Orijinal)', url: proxiedMaster },
                  ],
                  fallbackIframe: null,
                };
              }
            }
          } catch (err) {
            console.warn('Direct Pichive edge resolution error:', err);
          }
        }

        if (!data) {
          const params = new URLSearchParams({
            url: activeSourceUrl,
            provider: activeSourceProvider,
          });
          const resp = await fetch(`/api/resolve-stream?${params.toString()}`, { cache: 'no-store' });
          respStatus = resp.status;
          data = await resp.json();
        }
        if (cancelled) return;

        if (respStatus === 410 || data.isDead) {
          const deadUrl = activeSource?.direct_url || activeSourceUrl;
          const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
          if (deadUrl) {
            setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
          }

          if (onSourceDead && deadUrl) {
            onSourceDead(deadUrl);
            return;
          }

          const nextWorkingIdx = filteredSources.findIndex(
            (s, idx) =>
              idx !== selectedSourceIdx &&
              s.direct_url !== deadUrl &&
              s.direct_url !== activeSourceUrl &&
              !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
              !deadSourceKeys.has(s.direct_url || '')
          );

          if (nextWorkingIdx !== -1) {
            pushNotification(
              'Otomatik Yedek Kaynağa Geçildi',
              `${activeSource?.source_name || 'Kaynak'} yayından kaldırılmış, çalışan başka bir kaynağa geçiliyor.`,
              'info'
            );
            setSelectedSourceIdx(nextWorkingIdx);
            return;
          }
          setResolvedMode('error');
          return;
        }

        if (data.mode === 'native_hls' || data.mode === 'native_mp4') {
          setResolvedMode(data.mode);
          setQualities(data.qualities || []);
          setAudioTracks([]);
          setCurrentAudioTrackId(0);
          const savedPref = typeof window !== 'undefined' ? localStorage.getItem('koup_preferred_quality') : null;
          const matchedPref = savedPref && savedPref !== 'Otomatik'
            ? (data.qualities || []).find((q: any) => cleanQualityLabel(q.label) === cleanQualityLabel(savedPref))
            : null;
          setSelectedQuality(matchedPref ? cleanQualityLabel(matchedPref.label) : cleanQualityLabel(data.qualities?.[0]?.label || 'Otomatik'));
          const targetStream = matchedPref?.url || data.streamUrl || data.qualities?.[0]?.url || '';
          setStreamUrl(targetStream);
          const rawSubs: SubtitleTrack[] = data.subtitles || [];
          const seenSubUrls = new Set<string>();
          const byCleanLabel = new Map<string, SubtitleTrack>();
          for (const s of rawSubs) {
            if (!s?.url || seenSubUrls.has(s.url)) continue;
            seenSubUrls.add(s.url);
            let baseLabel = (s.label || 'Altyazı')
              .replace(/\s*altyaz[ıi]$/i, '')
              .replace(/\s*\(\d+\)$/, '')
              .trim();
            const lowLbl = baseLabel.toLocaleLowerCase('tr-TR').replace(/i\u0307/g, 'i');
            if (lowLbl.includes('türk') || lowLbl.includes('turk') || lowLbl === 'forced') {
              baseLabel = 'Türkçe';
            } else if (lowLbl.includes('ing') || lowLbl.includes('eng')) {
              baseLabel = 'İngilizce';
            }
            const isForcedUrl = s.url.toLowerCase().includes('forced') || lowLbl === 'forced';
            if (!byCleanLabel.has(baseLabel) || !isForcedUrl) {
              byCleanLabel.set(baseLabel, {
                ...s,
                label: baseLabel,
              });
            }
          }
          const incomingSubs: SubtitleTrack[] = Array.from(byCleanLabel.values());
          setSubtitles(incomingSubs);
          if (incomingSubs.length > 0) {
            const trSub = incomingSubs.find((s) => s.lang === 'tr') || incomingSubs[0];
            if (trSub) {
              selectSubtitleDirect(trSub.label, incomingSubs);
            }
          } else {
            setSelectedSubtitle('off');
            setSubtitleCues([]);
            setActiveSubtitleText(null);
          }
          if (data.fallbackIframe) {
            setFallbackIframeUrl(
              normalizePlayerStreamUrl(data.fallbackIframe, targetResume).url
            );
          }
        } else {
          const finalIframe = data.iframeUrl || normalizedFallback;
          if (isUnframableUrl(finalIframe)) {
            const deadUrl = activeSource?.direct_url || activeSourceUrl;
            const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
            if (deadUrl) {
              setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
            }

            if (onSourceDead && deadUrl) {
              onSourceDead(deadUrl);
              return;
            }

            const nextWorkingIdx = filteredSources.findIndex(
              (s, idx) =>
                idx !== selectedSourceIdx &&
                s.direct_url !== deadUrl &&
                s.direct_url !== activeSourceUrl &&
                !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                !deadSourceKeys.has(s.direct_url || '')
            );
            if (nextWorkingIdx !== -1) {
              pushNotification(
                'Çerçevelenemeyen Kaynak Atlandı',
                `${activeSource?.source_name || 'Kaynak'} doğrudan oynatılamıyor ve yerleştirilemiyor, çalışan başka bir kaynağa geçiliyor.`,
                'info'
              );
              setSelectedSourceIdx(nextWorkingIdx);
              return;
            }
            setResolvedMode('error');
            return;
          }

          setResolvedMode('iframe');
          setStreamUrl(finalIframe);
          setQualities([]);
          setSubtitles([]);
          setSelectedSubtitle('off');
          setSubtitleCues([]);
          setActiveSubtitleText(null);
          setAudioTracks([]);
        }
      } catch {
        if (!cancelled && activeSourceUrl) {
          const deadUrl = activeSource?.direct_url || activeSourceUrl;
          const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
          if (deadUrl) {
            setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
          }

          if (onSourceDead && deadUrl) {
            onSourceDead(deadUrl);
            return;
          }

          const nextWorkingIdx = filteredSources.findIndex(
            (s, idx) =>
              idx !== selectedSourceIdx &&
              s.direct_url !== deadUrl &&
              s.direct_url !== activeSourceUrl &&
              !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
              !deadSourceKeys.has(s.direct_url || '')
          );
          if (nextWorkingIdx !== -1) {
            pushNotification(
              'Otomatik Yedek Kaynağa Geçildi',
              `${activeSource?.source_name || 'Kaynak'} yanıt vermiyor, sıradaki kaynağa geçiliyor.`,
              'info'
            );
            setSelectedSourceIdx(nextWorkingIdx);
            return;
          }
          setResolvedMode('error');
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [activeSourceUrl, activeSourceProvider, selectedSourceIdx]);

  // Attach HLS.js or direct MP4 when resolvedMode is native
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl || resolvedMode === 'iframe') return;

    if (hlsRef.current) {
      hlsRef.current.stopLoad();
      hlsRef.current.detachMedia();
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setAudioTracks([]);
    setCurrentAudioTrackId(0);

    setIsBuffering(true);
    let cancelled = false;

    if (resolvedMode === 'native_hls') {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled || !videoRef.current) return;
          if (Hls.isSupported()) {
            const resumeSec = targetResumeRef.current;
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              // Turbo Preloading & Broadband Buffer Tuning (optimized for fast broadband & instant seeking)
              maxBufferLength: 90,
              maxMaxBufferLength: 300,
              maxBufferSize: 250 * 1024 * 1024,
              backBufferLength: 90,
              maxBufferHole: 0.5,
              highBufferWatchdogPeriod: 2,
              nudgeMaxRetry: 5,
              abrEwmaDefaultEstimate: 5000000,
              capLevelToPlayerSize: false,
              fragLoadingMaxRetry: 4,
              fragLoadingRetryDelay: 500,
              fragLoadingMaxRetryTimeout: 10000,
              levelLoadingMaxRetry: 4,
              levelLoadingRetryDelay: 500,
              levelLoadingMaxRetryTimeout: 10000,
              startPosition: resumeSec > 3 ? resumeSec : -1,
            });
            hls.subtitleDisplay = false;
            hls.subtitleTrack = -1;
            hlsRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, (_ev, data) => {
              hls.subtitleDisplay = false;
              hls.subtitleTrack = -1;
              try {
                if (video.textTracks) {
                  for (let i = 0; i < video.textTracks.length; i++) {
                    video.textTracks[i].mode = 'disabled';
                  }
                }
              } catch {}
              setIsBuffering(false);
              const resumeSec = targetResumeRef.current;
              if (resumeSec > 3) {
                try {
                  video.currentTime = resumeSec;
                } catch {}
              } else {
                setIsResumeReady(true);
              }
              video.playbackRate = playbackRate;
              video.play().catch(() => {});

              if (data?.levels && data.levels.length > 0) {
                const hlsQualities: Array<{ label: string; url: string; levelIndex?: number }> = [
                  { label: 'Otomatik', url: '', levelIndex: -1 },
                ];
                const sortedLevels = data.levels
                  .map((lvl: any, index: number) => ({ lvl, index }))
                  .sort((a: any, b: any) => {
                    const hA = a.lvl.height || (a.lvl.attrs?.RESOLUTION ? parseInt(a.lvl.attrs.RESOLUTION.split('x')[1] || '0', 10) : 0) || a.lvl.bitrate || 0;
                    const hB = b.lvl.height || (b.lvl.attrs?.RESOLUTION ? parseInt(b.lvl.attrs.RESOLUTION.split('x')[1] || '0', 10) : 0) || b.lvl.bitrate || 0;
                    return hB - hA;
                  });

                const seenLabels = new Set<string>();
                const defaultRankLabels = ['1080p', '720p', '480p', '360p'];

                for (let rank = 0; rank < sortedLevels.length; rank++) {
                  const item = sortedLevels[rank];
                  const lvl = item.lvl;
                  let label = '';

                  if (lvl.height && lvl.height > 0) {
                    label = `${lvl.height}p`;
                  } else if (lvl.attrs?.RESOLUTION) {
                    const m = String(lvl.attrs.RESOLUTION).match(/\d+x(\d+)/);
                    if (m?.[1]) label = `${m[1]}p`;
                  } else if (lvl.name || lvl.attrs?.NAME) {
                    const n = String(lvl.name || lvl.attrs?.NAME).toUpperCase();
                    if (n.includes('FHD') || n.includes('1080')) label = '1080p';
                    else if (n.includes('HD') || n.includes('720')) label = '720p';
                    else if (n.includes('SD') || n.includes('480')) label = '480p';
                    else if (n.includes('360')) label = '360p';
                  } else if (lvl.bitrate) {
                    if (lvl.bitrate >= 2000000) label = '1080p';
                    else if (lvl.bitrate >= 1000000) label = '720p';
                    else if (lvl.bitrate >= 500000) label = '480p';
                    else label = '360p';
                  }

                  if (!label || seenLabels.has(label)) {
                    const fallback = defaultRankLabels.find((l) => !seenLabels.has(l));
                    label = fallback || `${Math.max(360, 1080 - rank * 360)}p`;
                  }

                  seenLabels.add(label);
                  hlsQualities.push({
                    label,
                    url: '',
                    levelIndex: item.index,
                  });
                }
                const savedPref = typeof window !== 'undefined' ? localStorage.getItem('koup_preferred_quality') : null;
                let appliedQuality = 'Otomatik';
                if (savedPref && savedPref !== 'Otomatik') {
                  const matched = hlsQualities.find(
                    (q) =>
                      q.label.toLowerCase() === savedPref.toLowerCase() ||
                      (savedPref.includes('1080') && q.label.includes('1080')) ||
                      (savedPref.includes('720') && q.label.includes('720'))
                  );
                  if (matched && matched.levelIndex !== undefined && matched.levelIndex >= 0) {
                    hls.currentLevel = matched.levelIndex;
                    appliedQuality = matched.label;
                  }
                }
                setQualities(hlsQualities);
                setSelectedQuality(appliedQuality);
              }
            });

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_ev, data) => {
              if (data?.audioTracks && data.audioTracks.length > 0) {
                const mapped = data.audioTracks.map((t, idx) => {
                  const name = (t.name || '').toLowerCase();
                  const lang = (t.lang || '').toLowerCase();
                  let label = t.name || `Ses ${idx + 1}`;
                  if (name.includes('turkish') || name.includes('türk') || lang === 'tr') {
                    label = 'Türkçe (Dublaj)';
                  } else if (name.includes('original') || name.includes('eng') || lang === 'en') {
                    label = 'Orijinal Ses';
                  }
                  return {
                    id: idx,
                    name: t.name,
                    lang: t.lang,
                    label,
                  };
                });
                setAudioTracks(mapped);
                setCurrentAudioTrackId(hls.audioTrack >= 0 ? hls.audioTrack : 0);
              } else {
                setAudioTracks([]);
                setCurrentAudioTrackId(0);
              }
            });

            hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_ev, data) => {
              setCurrentAudioTrackId(data.id);
            });

            let hlsNetworkRetryCount = 0;
            hls.on(Hls.Events.ERROR, (_ev, errData) => {
              if (errData.fatal) {
                switch (errData.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR: {
                    const httpCode = errData.response?.code;
                    hlsNetworkRetryCount += 1;
                    if (httpCode === 403 || httpCode === 404 || hlsNetworkRetryCount > 2) {
                      // Attempt a 1-time fresh resolve with refresh=1 if stream token expired
                      if (!hasRefreshedStreamRef.current && activeSourceUrl && (httpCode === 403 || httpCode === 404)) {
                        hasRefreshedStreamRef.current = true;
                        const refreshParams = new URLSearchParams({
                          url: activeSourceUrl,
                          provider: activeSourceProvider,
                          refresh: '1',
                        });
                        void fetch(`/api/resolve-stream?${refreshParams.toString()}`, { cache: 'no-store' })
                          .then((r) => r.json())
                          .then((freshData) => {
                            if (freshData?.streamUrl && (freshData.mode === 'native_hls' || freshData.mode === 'native_mp4')) {
                              setStreamUrl(freshData.streamUrl);
                              hls.loadSource(freshData.streamUrl);
                              hls.startLoad();
                            } else {
                              const deadUrl = activeSource?.direct_url || activeSourceUrl;
                              const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
                              if (deadUrl) {
                                setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
                              }
                              if (onSourceDead && deadUrl) {
                                onSourceDead(deadUrl);
                                return;
                              }
                              const nextWorkingIdx = filteredSources.findIndex(
                                (s, idx) =>
                                  idx !== selectedSourceIdx &&
                                  s.direct_url !== deadUrl &&
                                  s.direct_url !== activeSourceUrl &&
                                  !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                                  !deadSourceKeys.has(s.direct_url || '')
                              );
                              if (nextWorkingIdx !== -1) {
                                pushNotification(
                                  'Otomatik Yedek Kaynağa Geçildi',
                                  `${activeSource?.source_name || 'Mevcut kaynak'} yanıt vermedi (${httpCode || 'bağlantı hatası'}), sıradaki kaynağa geçiliyor.`,
                                  'info'
                                );
                                setSelectedSourceIdx(nextWorkingIdx);
                              } else if (fallbackIframeUrl) {
                                setStreamUrl(fallbackIframeUrl);
                                setResolvedMode('iframe');
                              }
                            }
                          })
                          .catch(() => {
                            const deadUrl = activeSource?.direct_url || activeSourceUrl;
                            const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
                            if (deadUrl) {
                              setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
                            }
                            if (onSourceDead && deadUrl) {
                              onSourceDead(deadUrl);
                              return;
                            }
                            const nextWorkingIdx = filteredSources.findIndex(
                              (s, idx) =>
                                idx !== selectedSourceIdx &&
                                s.direct_url !== deadUrl &&
                                s.direct_url !== activeSourceUrl &&
                                !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                                !deadSourceKeys.has(s.direct_url || '')
                            );
                            if (nextWorkingIdx !== -1) {
                              setSelectedSourceIdx(nextWorkingIdx);
                            } else if (fallbackIframeUrl) {
                              setStreamUrl(fallbackIframeUrl);
                              setResolvedMode('iframe');
                            }
                          });
                        return;
                      }

                      const deadUrl = activeSource?.direct_url || activeSourceUrl;
                      const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
                      if (deadUrl) {
                        setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
                      }
                      if (onSourceDead && deadUrl) {
                        onSourceDead(deadUrl);
                        return;
                      }
                      const nextWorkingIdx = filteredSources.findIndex(
                        (s, idx) =>
                          idx !== selectedSourceIdx &&
                          s.direct_url !== deadUrl &&
                          s.direct_url !== activeSourceUrl &&
                          !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                          !deadSourceKeys.has(s.direct_url || '')
                      );
                      if (nextWorkingIdx !== -1) {
                        pushNotification(
                          'Otomatik Yedek Kaynağa Geçildi',
                          `${activeSource?.source_name || 'Mevcut kaynak'} yanıt vermedi (${httpCode || 'bağlantı hatası'}), sıradaki kaynağa geçiliyor.`,
                          'info'
                        );
                        setSelectedSourceIdx(nextWorkingIdx);
                      } else if (fallbackIframeUrl) {
                        setStreamUrl(fallbackIframeUrl);
                        setResolvedMode('iframe');
                      }
                    } else {
                      hls.startLoad();
                    }
                    break;
                  }
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    hls.recoverMediaError();
                    break;
                  default: {
                    const deadUrl = activeSource?.direct_url || activeSourceUrl;
                    const deadKey = activeSource?.id ? String(activeSource.id) : deadUrl;
                    if (deadUrl) {
                      setDeadSourceKeys((prev) => new Set(prev).add(deadUrl).add(deadKey));
                    }
                    if (onSourceDead && deadUrl) {
                      onSourceDead(deadUrl);
                      return;
                    }
                    const nextWorkingIdx = filteredSources.findIndex(
                      (s, idx) =>
                        idx !== selectedSourceIdx &&
                        s.direct_url !== deadUrl &&
                        s.direct_url !== activeSourceUrl &&
                        !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                        !deadSourceKeys.has(s.direct_url || '')
                    );
                    if (nextWorkingIdx !== -1) {
                      pushNotification(
                        'Otomatik Yedek Kaynağa Geçildi',
                        `${activeSource?.source_name || 'Kaynak'} yanıt vermedi, sıradaki kaynağa geçiliyor.`,
                        'info'
                      );
                      setSelectedSourceIdx(nextWorkingIdx);
                    } else if (fallbackIframeUrl) {
                      setStreamUrl(fallbackIframeUrl);
                      setResolvedMode('iframe');
                    } else {
                      setResolvedMode('iframe');
                    }
                    break;
                  }
                }
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.playbackRate = playbackRate;
            video.play().catch(() => {});
          }
        })
        .catch(() => {
          if (!cancelled && video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.playbackRate = playbackRate;
            video.play().catch(() => {});
          }
        });
    } else if (resolvedMode === 'native_mp4') {
      video.src = streamUrl;
      video.playbackRate = playbackRate;
      video.play().catch(() => {});
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [resolvedMode, streamUrl]);

  // Loaded metadata resume seeking for Native video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || resolvedMode === 'iframe') return;

    let seekApplied = false;

    const handleLoadedMetadata = () => {
      setIsBuffering(false);
      if (video.duration && !Number.isNaN(video.duration)) {
        setDuration(video.duration);
      }
      const resumeSec = targetResumeRef.current;
      if (!seekApplied && resumeSec > 3) {
        seekApplied = true;
        try {
          video.currentTime = resumeSec;
        } catch {}
      } else if (resumeSec <= 3) {
        setIsResumeReady(true);
      }
    };

    const safetyTimer = setTimeout(() => {
      setIsResumeReady(true);
    }, 2500);

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleLoadedMetadata);
    return () => {
      clearTimeout(safetyTimer);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleLoadedMetadata);
    };
  }, [resolvedMode, streamUrl, currentSeason, currentEpisode]);

  // Iframe seek to targetResume once active source resolves
  useEffect(() => {
    if (resolvedMode === 'iframe' && targetResumeRef.current > 3) {
      const timer = setTimeout(() => {
        sendSeekToIframe(targetResumeRef.current);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [resolvedMode, streamUrl, currentSeason, currentEpisode, sendSeekToIframe]);

  // Centralized flush helper for local-first tracking and smart Supabase egress sync
  const flushCurrentProgress = useCallback(
    (reason: 'playback' | 'pause' | 'exit' | 'completed' = 'exit', keepalive = false) => {
      if (isTrailerMode) return;

      const isIframe = resolvedMode === 'iframe';
      const curPos = isIframe
        ? trackedTimeRef.current
        : videoRef.current && !Number.isNaN(videoRef.current.currentTime) && videoRef.current.currentTime > 0
        ? Math.floor(videoRef.current.currentTime)
        : trackedTimeRef.current;
      const curDur = isIframe
        ? trackedDurationRef.current || mediaTotalDuration
        : videoRef.current?.duration && !Number.isNaN(videoRef.current.duration)
        ? Math.floor(videoRef.current.duration)
        : trackedDurationRef.current || mediaTotalDuration;

      if (curPos > 0 || reason === 'completed') {
        updateEpisodeProgress(
          media,
          currentSeason,
          currentEpisode,
          formatEpisodeTitle(
            currentEpObj?.episode_name,
            currentSeason,
            currentEpisode
          ),
          curPos,
          curDur,
          reason === 'completed',
          { reason, keepalive }
        );
      }
    },
    [
      isTrailerMode,
      resolvedMode,
      media,
      currentSeason,
      currentEpisode,
      currentEpObj,
      mediaTotalDuration,
      updateEpisodeProgress,
    ]
  );

  // Native video frequent local-first progress tracking (4s interval, 0 network overhead)
  useEffect(() => {
    if (resolvedMode === 'iframe' || !isPlaying || isTrailerMode) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && videoRef.current && !videoRef.current.paused) {
        flushCurrentProgress('playback', false);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [resolvedMode, isPlaying, isTrailerMode, flushCurrentProgress]);

  // Native video flush on pagehide, beforeunload, visibilitychange and unmount
  useEffect(() => {
    if (resolvedMode === 'iframe' || isTrailerMode) return;

    const handleBeforeUnload = () => flushCurrentProgress('exit', true);
    const handlePageHide = () => flushCurrentProgress('exit', true);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushCurrentProgress('exit', false);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flushCurrentProgress('exit', false);
    };
  }, [resolvedMode, isTrailerMode, flushCurrentProgress]);

  // Episode navigation computation
  const currentEpIndex = episodes.findIndex(
    (e) =>
      (e.season_number || 1) === currentSeason && e.episode_number === currentEpisode
  );
  const nextEp =
    currentEpIndex >= 0 && currentEpIndex + 1 < episodes.length
      ? episodes[currentEpIndex + 1]
      : null;

  const handleNextEpisode = useCallback(() => {
    if (nextEp) {
      flushCurrentProgress('exit', false);
      onSelectEpisode(nextEp.season_number || currentSeason, nextEp.episode_number);
    }
  }, [nextEp, flushCurrentProgress, onSelectEpisode, currentSeason]);

  // Listen to real postMessage telemetry from compatible external players (YouTube, Player.js, JWPlayer, Video.js)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        let data = e.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {}
        }
        if (!data || typeof data !== 'object') return;

        const incomingTime =
          data.info?.currentTime ??
          data.time ??
          data.currentTime ??
          data.seconds ??
          data.position ??
          data.data?.time ??
          data.data?.currentTime ??
          (data.event === 'timeupdate' && typeof data.value === 'number'
            ? data.value
            : undefined);

        const incomingDur =
          data.info?.duration ??
          data.duration ??
          data.totalTime ??
          data.data?.duration ??
          (data.event === 'timeupdate' && typeof data.duration === 'number'
            ? data.duration
            : undefined);

        if (typeof incomingTime === 'number' && !Number.isNaN(incomingTime) && incomingTime > 0) {
          const floorTime = Math.floor(incomingTime);
          trackedTimeRef.current = floorTime;
          hasRealTelemetryRef.current = true;
          if (floorTime !== currentTimeRef.current) {
            currentTimeRef.current = floorTime;
            setCurrentTime(incomingTime);
          }
        }
        if (typeof incomingDur === 'number' && !Number.isNaN(incomingDur) && incomingDur > 0) {
          const floorDur = Math.floor(incomingDur);
          trackedDurationRef.current = floorDur;
          if (floorDur !== durationRef.current) {
            durationRef.current = floorDur;
            setDuration(incomingDur);
            setIsBuffering(false);
          }
        }

        if (isTrailerMode && data.info?.playerState != null) {
          if (data.info.playerState === 1) {
            setIsPlaying(true);
            setIsBuffering(false);
          } else if (data.info.playerState === 2) {
            setIsPlaying(false);
          } else if (data.info.playerState === 0) {
            setIsPlaying(false);
          }
        } else if (!isTrailerMode && (data.info?.playerState === 2 || data.event === 'pause')) {
          setIsPlaying(false);
          flushCurrentProgress('pause', false);
        }

        const isEndedEvent =
          data?.event === 'ended' ||
          data?.event === 'finish' ||
          (data?.event === 'infoDelivery' && data?.info?.playerState === 0) ||
          (data?.event === 'onStateChange' && data?.info === 0);

        if (isEndedEvent && !isTrailerMode) {
          flushCurrentProgress('completed', false);
          if (autoNextEnabled && nextEp) {
            handleNextEpisode();
          }
        }
      } catch {}
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [autoNextEnabled, handleNextEpisode, nextEp, flushCurrentProgress, isTrailerMode]);

  // Universal Iframe Progress & Resume Sync
  // Frequent local-first updates (4s interval) + Smart Supabase egress sync
  useEffect(() => {
    if (resolvedMode !== 'iframe' || isTrailerMode) return;

    const syncInterval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        // If external iframe doesn't have postMessage, increment elapsed active time
        if (!hasRealTelemetryRef.current) {
          trackedTimeRef.current += 4;
        }
        flushCurrentProgress('playback', false);
      }
    }, 4000);

    const progressTicker = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && isPlaying) {
        if (!hasRealTelemetryRef.current) {
          setCurrentTime((prev) => {
            const next = prev + 1;
            currentTimeRef.current = Math.floor(next);
            trackedTimeRef.current = Math.floor(next);
            return next;
          });
        }
      }
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushCurrentProgress('exit', false);
      }
    };

    const handleBeforeUnload = () => flushCurrentProgress('exit', true);
    const handlePageHide = () => flushCurrentProgress('exit', true);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      clearInterval(syncInterval);
      clearInterval(progressTicker);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      flushCurrentProgress('exit', false);
    };
  }, [resolvedMode, isTrailerMode, flushCurrentProgress]);

  // Listen to koup-seek-player custom event from comment timestamps
  useEffect(() => {
    const handleSeekEvent = (e: Event) => {
      const custom = e as CustomEvent<{ time: number }>;
      const sec = custom.detail?.time;
      if (typeof sec === 'number' && !Number.isNaN(sec)) {
        if (videoRef.current) {
          videoRef.current.currentTime = sec;
          videoRef.current.play().catch(() => {});
        } else if (iframeRef.current) {
          sendSeekToIframe(sec);
        }
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    window.addEventListener('koup-seek-player', handleSeekEvent);
    return () => window.removeEventListener('koup-seek-player', handleSeekEvent);
  }, [sendSeekToIframe]);

  const isTrulyScheduled =
    currentEpObj?.status === 'scheduled' &&
    Boolean(
      currentEpObj?.scheduled_release_at &&
        new Date(currentEpObj.scheduled_release_at).getTime() > Date.now()
    );

  const isPendingOrNoSource =
    !isLoadingEpisodes &&
    episodes.length > 0 &&
    !isTrulyScheduled &&
    (Boolean(currentEpObj?.pending) ||
      currentEpObj?.status === 'pending_source' ||
      availableSources.length === 0);

  const currentEpIdx = useMemo(() => {
    const idx = episodes.findIndex(
      (e) => (e.season_number || 1) === currentSeason && e.episode_number === currentEpisode
    );
    return idx >= 0 ? idx : episodes.findIndex((e) => e.episode_number === currentEpisode);
  }, [episodes, currentSeason, currentEpisode]);

  const prevAvailableEp = useMemo(() => {
    if (currentEpIdx <= 0) return null;
    for (let i = currentEpIdx - 1; i >= 0; i--) {
      const ep = episodes[i];
      const isPending = Boolean(ep.pending) || ep.status === 'pending_source' || !ep.sources || ep.sources.length === 0;
      if (!isPending) {
        return ep;
      }
    }
    return episodes[currentEpIdx - 1] || null;
  }, [episodes, currentEpIdx]);

  // Scheduled Episode Live Countdown Timer
  useEffect(() => {
    if (!isTrulyScheduled || !currentEpObj?.scheduled_release_at) {
      setCountdownText('');
      return;
    }
    const targetTime = new Date(currentEpObj.scheduled_release_at).getTime();

    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((targetTime - Date.now()) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setCountdownText(`${h} saat, ${m} dakika, ${s} saniye`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [isTrulyScheduled, currentEpObj?.scheduled_release_at]);

  /* ==========================================================================
      ZERO-LAG HUD VISIBILITY & TRANSPORT ACTIONS
     ========================================================================== */

  const scheduleHideOverlay = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (activePanelRef.current !== null || isHoveringBottomControlsRef.current) return;
    hideControlsTimer.current = setTimeout(() => {
      if (
        isPlayingRef.current &&
        !activePanelRef.current &&
        !isScrubbingRef.current &&
        !isHoveringBottomControlsRef.current
      ) {
        showOverlayRef.current = false;
        setShowOverlay(false);
        setShowVolumeSlider(false);
      }
    }, 2500);
  }, []);

  const revealControls = useCallback(() => {
    if (!showOverlayRef.current) {
      showOverlayRef.current = true;
      setShowOverlay(true);
    }
    if (!activePanelRef.current && !isHoveringBottomControlsRef.current) {
      scheduleHideOverlay();
    }
  }, [scheduleHideOverlay]);

  const handlePointerMoveContainer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (showOverlayRef.current) {
        if (now - lastPointerMoveRef.current > 400) {
          lastPointerMoveRef.current = now;
          scheduleHideOverlay();
        }
        return;
      }
      lastPointerMoveRef.current = now;
      revealControls();
    },
    [scheduleHideOverlay, revealControls]
  );

  // Keep overlay visible when paused, scrubbing, hovering or when a drawer/panel is open
  useEffect(() => {
    if (!isPlaying || activePanel !== null || isScrubbing || hoverTime !== null) {
      setShowOverlay(true);
      if (hideControlsTimer.current) {
        clearTimeout(hideControlsTimer.current);
        hideControlsTimer.current = null;
      }
    } else {
      scheduleHideOverlay();
    }
  }, [isPlaying, activePanel, isScrubbing, hoverTime, scheduleHideOverlay]);

  const togglePlayPause = useCallback(() => {
    if (isTrailerMode) {
      if (isPlaying) {
        sendTrailerYtCommand('pauseVideo');
        setIsPlaying(false);
      } else {
        sendTrailerYtCommand('playVideo');
        setIsPlaying(true);
      }
      revealControls();
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setIsPlaying(true);
      v.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      setIsPlaying(false);
      v.pause();
    }
    revealControls();
  }, [revealControls, isTrailerMode, isPlaying, sendTrailerYtCommand]);

  const seekBy = useCallback(
    (deltaSec: number, revealHud = false, triggerFeedback = false) => {
      const dir = deltaSec < 0 ? 'left' : 'right';
      const absDelta = Math.abs(deltaSec);

      if (isTrailerMode) {
        const maxDur = duration > 0 ? duration : 180;
        const nextTime = Math.max(0, Math.min(maxDur, currentTime + deltaSec));
        sendSeekToIframe(nextTime);
        currentTimeRef.current = Math.floor(nextTime);
        setCurrentTime(nextTime);

        if (triggerFeedback) {
          setSeekFeedback((prev) => {
            const accumulated =
              prev && prev.dir === dir ? prev.amount + absDelta : absDelta;
            return {
              dir,
              amount: accumulated,
              key: Date.now(),
            };
          });

          if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
          seekFeedbackTimerRef.current = setTimeout(() => {
            setSeekFeedback(null);
          }, 750);
        }

        if (revealHud) {
          revealControls();
        }
        return;
      }

      const v = videoRef.current;
      if (!v) {
        if (iframeRef.current) {
          const maxDur = duration > 0 ? duration : 3600;
          const nextTime = Math.max(0, Math.min(maxDur, currentTime + deltaSec));
          sendSeekToIframe(nextTime);
          currentTimeRef.current = Math.floor(nextTime);
          setCurrentTime(nextTime);
        }
      } else {
        const maxDur = v.duration && !Number.isNaN(v.duration) ? v.duration : duration || 3600;
        const nextTime = Math.max(0, Math.min(maxDur, v.currentTime + deltaSec));
        v.currentTime = nextTime;
        currentTimeRef.current = Math.floor(nextTime);
        setCurrentTime(nextTime);
      }

      if (triggerFeedback) {
        setSeekFeedback((prev) => {
          const accumulated =
            prev && prev.dir === dir ? prev.amount + absDelta : absDelta;
          return {
            dir,
            amount: accumulated,
            key: Date.now(),
          };
        });

        if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
        seekFeedbackTimerRef.current = setTimeout(() => {
          setSeekFeedback(null);
        }, 750);
      }

      if (revealHud) {
        revealControls();
      }
    },
    [duration, revealControls, isTrailerMode, currentTime, sendSeekToIframe]
  );

  const triggerMobileSeek = useCallback(
    (dir: 'left' | 'right') => {
      const delta = dir === 'left' ? -5 : 5;
      seekBy(delta, false, false);
      setMobileSeekRipple((prev) => {
        const accumulated = prev && prev.dir === dir ? prev.amount + 5 : 5;
        return { dir, amount: accumulated, key: Date.now() };
      });
      if (mobileSeekTimerRef.current) clearTimeout(mobileSeekTimerRef.current);
      mobileSeekTimerRef.current = setTimeout(() => {
        setMobileSeekRipple(null);
      }, 700);
    },
    [seekBy]
  );

  // Accurate database-driven intro & outro skip handler (no fake hardcoded timers)
  const hasIntro =
    currentEpObj?.intro_start_sec != null &&
    currentEpObj?.intro_end_sec != null &&
    currentEpObj.intro_end_sec > currentEpObj.intro_start_sec;

  const isInsideIntro =
    hasIntro &&
    currentTime >= currentEpObj.intro_start_sec! &&
    currentTime < currentEpObj.intro_end_sec!;

  const hasOutro =
    currentEpObj?.outro_start_sec != null &&
    currentEpObj.outro_start_sec > 0;

  const isInsideOutro =
    hasOutro &&
    currentTime >= currentEpObj.outro_start_sec! &&
    (currentEpObj.outro_end_sec == null || currentTime <= currentEpObj.outro_end_sec);

  const handleSkipIntro = useCallback(() => {
    if (currentEpObj?.intro_end_sec) {
      const target = currentEpObj.intro_end_sec;
      if (videoRef.current) {
        videoRef.current.currentTime = target;
        currentTimeRef.current = Math.floor(target);
        setCurrentTime(target);
      } else if (iframeRef.current) {
        sendSeekToIframe(target);
        currentTimeRef.current = Math.floor(target);
        setCurrentTime(target);
      }
      triggerHudToast('İntro Atlandı');
      revealControls();
    }
  }, [currentEpObj?.intro_end_sec, sendSeekToIframe, triggerHudToast, revealControls]);

  const handleSkipOutro = useCallback(() => {
    if (!isMovie && nextEp) {
      triggerHudToast('Sonraki Bölüme Geçiliyor...');
      handleNextEpisode();
    }
  }, [isMovie, nextEp, triggerHudToast, handleNextEpisode]);

  const handleNextEpisodeRef = useRef(handleNextEpisode);
  handleNextEpisodeRef.current = handleNextEpisode;

  // Auto-skip intro effect (per episode 1-time auto skip, prevents infinite loops)
  useEffect(() => {
    if (!autoSkipIntro || !isInsideIntro || isTrailerMode) return;
    const epKey = `${media.id}_s${currentSeason}_e${currentEpisode}`;
    if (autoSkippedIntroEpRef.current === epKey) return;
    autoSkippedIntroEpRef.current = epKey;
    handleSkipIntro();
    triggerHudToast('İntro Otomatik Atlandı');
  }, [
    autoSkipIntro,
    isInsideIntro,
    isTrailerMode,
    media.id,
    currentSeason,
    currentEpisode,
    handleSkipIntro,
    triggerHudToast,
  ]);

  // Reset auto-next episode state on episode change
  useEffect(() => {
    setCancelledAutoNextForEp(false);
    setCountdownRemaining(3);
    hasTriggeredNextRef.current = false;
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, [media.id, currentSeason, currentEpisode]);

  // Outro auto-next 3s countdown trigger
  const effectiveTotalDuration =
    duration > 0
      ? duration
      : (currentEpObj as any)?.duration
      ? Number((currentEpObj as any).duration)
      : 0;

  const shouldShowCountdown =
    !isMovie &&
    !isTrailerMode &&
    Boolean(nextEp) &&
    autoNextEnabled &&
    !cancelledAutoNextForEp &&
    (isInsideOutro ||
      (!hasOutro &&
        effectiveTotalDuration > 20 &&
        currentTime >= effectiveTotalDuration - 5 &&
        currentTime < effectiveTotalDuration));

  useEffect(() => {
    if (shouldShowCountdown && isPlaying) {
      if (!countdownTimerRef.current && !hasTriggeredNextRef.current) {
        setCountdownRemaining(3);
        countdownTimerRef.current = setInterval(() => {
          setCountdownRemaining((prev) => {
            if (prev <= 1) {
              if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
              }
              if (!hasTriggeredNextRef.current) {
                hasTriggeredNextRef.current = true;
                handleNextEpisodeRef.current();
              }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } else {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }

    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [shouldShowCountdown, isPlaying]);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, []);

  const adjustVolume = useCallback(
    (delta: number) => {
      const currentEffective = isMuted ? 0 : volume;
      const nextVol = Math.max(0, Math.min(1, Math.round((currentEffective + delta) * 100) / 100));
      setVolume(nextVol);
      const nextMuted = nextVol === 0;
      setIsMuted(nextMuted);
      try {
        localStorage.setItem('koup_player_volume', String(nextVol));
        localStorage.setItem('koup_player_muted', String(nextMuted));
      } catch {}
      if (nextVol > 0) savedVolumeRef.current = nextVol;
      if (isTrailerMode) {
        sendTrailerYtCommand('setVolume', [Math.round(nextVol * 100)]);
        if (nextVol === 0) sendTrailerYtCommand('mute');
        else sendTrailerYtCommand('unMute');
      } else if (videoRef.current) {
        videoRef.current.volume = nextVol;
        videoRef.current.muted = nextVol === 0;
      }
      triggerHudToast(`Ses: %${Math.round(nextVol * 100)}`);
    },
    [isMuted, volume, isTrailerMode, sendTrailerYtCommand, triggerHudToast]
  );

  const toggleMute = useCallback(() => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    try {
      localStorage.setItem('koup_player_muted', String(nextMute));
    } catch {}
    if (isTrailerMode && setTrailerMuted) {
      setTrailerMuted(nextMute);
    }
    if (nextMute) {
      if (volume > 0) savedVolumeRef.current = volume;
    } else {
      const restored = savedVolumeRef.current > 0 ? savedVolumeRef.current : 0.5;
      setVolume(restored);
      try {
        localStorage.setItem('koup_player_volume', String(restored));
      } catch {}
      if (isTrailerMode) {
        sendTrailerYtCommand('setVolume', [Math.round(restored * 100)]);
      } else if (videoRef.current) {
        videoRef.current.volume = restored;
      }
    }
    if (isTrailerMode) {
      if (nextMute) sendTrailerYtCommand('mute');
      else sendTrailerYtCommand('unMute');
    } else if (videoRef.current) {
      videoRef.current.muted = nextMute;
    }
    const currentToastVol = nextMute ? 0 : (savedVolumeRef.current || volume || 0.5);
    triggerHudToast(nextMute ? 'Ses Kapatıldı' : `Ses: %${Math.round(currentToastVol * 100)}`);
  }, [isMuted, volume, isTrailerMode, setTrailerMuted, sendTrailerYtCommand, triggerHudToast]);

  // Complete Keyboard Shortcuts (Space/K, ArrowLeft/J, ArrowRight, ArrowUp/Down, M, F, N, S, E, L, 0-9, Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl &&
        ((targetEl.closest &&
          targetEl.closest(
            'input:not([type="range"]), textarea, select, [contenteditable="true"], [role="textbox"], form'
          )) ||
          targetEl.isContentEditable ||
          ['TEXTAREA', 'SELECT'].includes(targetEl.tagName) ||
          (targetEl.tagName === 'INPUT' && (targetEl as HTMLInputElement).type !== 'range'))
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === 'escape') {
        if (activePanel) {
          e.preventDefault();
          setActivePanel(null);
          return;
        }
        if (isTrailerMode && onCloseTrailer) {
          e.preventDefault();
          onCloseTrailer();
          return;
        }
      }

      if (isScreenLocked) return;

      if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (key === 'l' || key === 'c') {
        e.preventDefault();
        toggleCinemaLights();
        return;
      }
      if (key === 'n' && !isTrailerMode) {
        e.preventDefault();
        handleNextEpisode();
        return;
      }
      if (key === 'e' && !isTrailerMode && !isMovie) {
        e.preventDefault();
        setActivePanel((prev) => (prev === 'episodes' ? null : 'episodes'));
        return;
      }
      if (key === 's' && isInsideIntro && !isTrailerMode) {
        e.preventDefault();
        handleSkipIntro();
        return;
      }
      if ((key === 'n' || key === 's') && isInsideOutro && !isMovie && nextEp && !isTrailerMode) {
        e.preventDefault();
        handleSkipOutro();
        return;
      }

      if (isTrailerMode || (resolvedMode !== 'iframe' && videoRef.current)) {
        if (key === ' ' || e.code === 'Space' || key === 'k') {
          e.preventDefault();
          togglePlayPause();
        } else if (key === 'arrowright') {
          e.preventDefault();
          seekBy(5);
        } else if (key === 'arrowleft' || key === 'j') {
          e.preventDefault();
          seekBy(-5);
        } else if (key === 'arrowup') {
          e.preventDefault();
          adjustVolume(0.1);
        } else if (key === 'arrowdown') {
          e.preventDefault();
          adjustVolume(-0.1);
        } else if (key === 'm') {
          e.preventDefault();
          toggleMute();
        } else if (/^[0-9]$/.test(key)) {
          e.preventDefault();
          const pct = Number(key) / 10;
          if (isTrailerMode) {
            const d = duration > 0 ? duration : 180;
            const t = d * pct;
            sendSeekToIframe(t);
            currentTimeRef.current = Math.floor(t);
            setCurrentTime(t);
            revealControls();
          } else if (videoRef.current?.duration) {
            videoRef.current.currentTime = videoRef.current.duration * pct;
            currentTimeRef.current = Math.floor(videoRef.current.currentTime);
            setCurrentTime(videoRef.current.currentTime);
            revealControls();
          }
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activePanel,
    isScreenLocked,
    resolvedMode,
    isInsideIntro,
    handleSkipIntro,
    isInsideOutro,
    handleSkipOutro,
    toggleFullscreen,
    toggleCinemaLights,
    handleNextEpisode,
    togglePlayPause,
    seekBy,
    adjustVolume,
    toggleMute,
    triggerHudToast,
    revealControls,
  ]);

  const handleStageTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isFullscreen || isScreenLocked || isTrailerMode) return;
    if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      pinchStateRef.current = {
        active: true,
        startDist: Math.max(10, dist),
        startScale: videoZoomScale,
        triggeredInGesture: false,
        lastPinchEndTime: Date.now(),
      };
      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = null;
      }
    }
  };

  const handleStageTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!pinchStateRef.current.active || e.touches.length < 2) return;
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const ratio = dist / pinchStateRef.current.startDist;
    pinchStateRef.current.lastPinchEndTime = Date.now();

    if (!pinchStateRef.current.triggeredInGesture) {
      if (ratio > 1.12) {
        pinchStateRef.current.triggeredInGesture = true;
        const nextScale = pinchStateRef.current.startScale < 1.13 ? 1.15 : 1.24;
        setVideoZoomScale(nextScale);
        triggerHudToast(
          nextScale === 1.15
            ? 'Yakınlaştırıldı (Siyah Barlar Gizlendi)'
            : 'Tam Ekran Dolduruldu'
        );
      } else if (ratio < 0.88) {
        pinchStateRef.current.triggeredInGesture = true;
        const nextScale = pinchStateRef.current.startScale > 1.2 ? 1.15 : 1;
        setVideoZoomScale(nextScale);
        triggerHudToast(
          nextScale === 1
            ? 'Orijinal Boyut'
            : 'Yakınlaştırıldı (Siyah Barlar Gizlendi)'
        );
      }
    }
  };

  const handleStageTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pinchStateRef.current.active && e.touches.length < 2) {
      pinchStateRef.current.active = false;
      pinchStateRef.current.lastPinchEndTime = Date.now();
    }
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touchStartPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  // Handle stage surface pointer click / double-click / mobile double-tap
  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      pinchStateRef.current.active ||
      Date.now() - pinchStateRef.current.lastPinchEndTime < 350
    ) {
      return;
    }

    // Ignore if user clicked inside an interactive control or open drawer
    if ((e.target as HTMLElement).closest('[data-netflix-control="true"]')) {
      return;
    }

    if (activePanel) {
      setActivePanel(null);
      return;
    }

    if (isScreenLocked) {
      setShowOverlay((prev) => !prev);
      scheduleHideOverlay();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
    const now = Date.now();

    if (e.pointerType === 'touch') {
      // Sayfayı kaydırma / sürükleme hareketini (scroll gesture) dokunma ile karıştırma
      const dist = Math.hypot(
        e.clientX - touchStartPosRef.current.x,
        e.clientY - touchStartPosRef.current.y
      );
      if (dist > 16) {
        return;
      }

      const timeSinceLast = now - lastTouchTapRef.current.time;
      if (timeSinceLast < 320 && Math.abs(relX - lastTouchTapRef.current.x) < 0.35) {
        // Double tap on mobile: Left 38% rewinds 10s, Right 38% forwards 10s
        if (singleClickTimerRef.current) {
          clearTimeout(singleClickTimerRef.current);
          singleClickTimerRef.current = null;
        }
        lastTouchTapRef.current = { time: 0, x: 0 };

        // Çift dokunmada arayüzü KESİNLİKLE kapalı tut
        showOverlayRef.current = false;
        setShowOverlay(false);
        if (hideControlsTimer.current) {
          clearTimeout(hideControlsTimer.current);
          hideControlsTimer.current = null;
        }

        if (relX < 0.38) {
          triggerMobileSeek('left');
        } else if (relX > 0.62) {
          triggerMobileSeek('right');
        } else {
          togglePlayPause();
        }
        return;
      }

      lastTouchTapRef.current = { time: now, x: relX };

      // Kenar seek bölgelerine dokunulduğunda olası çift dokunmayı arayüzü açmadan yakala
      const isSeekZone = relX < 0.38 || relX > 0.62;

      const toggleControls = () => {
        if (!showOverlayRef.current) {
          showOverlayRef.current = true;
          setShowOverlay(true);
          scheduleHideOverlay();
        } else {
          showOverlayRef.current = false;
          setShowOverlay(false);
          if (hideControlsTimer.current) {
            clearTimeout(hideControlsTimer.current);
            hideControlsTimer.current = null;
          }
        }
      };

      if (singleClickTimerRef.current) {
        clearTimeout(singleClickTimerRef.current);
        singleClickTimerRef.current = null;
      }

      if (isSeekZone && !showOverlayRef.current) {
        singleClickTimerRef.current = setTimeout(() => {
          singleClickTimerRef.current = null;
          toggleControls();
        }, 220);
      } else {
        toggleControls();
      }
    } else {
      // Desktop mouse: immediate play/pause, double-click toggles fullscreen
      const timeSinceLast = now - lastTouchTapRef.current.time;
      if (timeSinceLast < 260) {
        lastTouchTapRef.current = { time: 0, x: 0 };
        togglePlayPause();
        toggleFullscreen();
        return;
      }
      lastTouchTapRef.current = { time: now, x: relX };
      togglePlayPause();
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || Number.isNaN(sec) || sec < 0) return '0:00';
    const totalSec = Math.floor(sec);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const effectiveTime = isScrubbing ? scrubTime : currentTime;
  const safeDuration = duration > 0 ? duration : isTrailerMode ? 180 : 0;
  const remainingSec = duration > 0 ? Math.max(0, duration - effectiveTime) : 0;

  const cleanTitle = cleanMediaTitle(media.title);
  const episodeDisplayTitle = isTrailerMode
    ? `${cleanTitle} • Resmi Tanıtım Fragmanı`
    : isMovie
    ? cleanTitle
    : formatEpisodeTitle(
        currentEpObj?.episode_name,
        currentSeason,
        currentEpisode,
        { includeSeasonPrefix: true }
      );

  const fallbackBackdropUrl = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.title
  );



  return (
    <div className={isTrailerMode ? "w-full h-full flex items-center justify-center overflow-hidden" : "relative"}>
      {/* SİNEMATİK IŞIKLANDIRMA (Volumetric Ambient Lighting with Organic Spread & Silk Diffusion) */}
      {ambientLightingEnabled && !isFullscreen && !isTrailerMode && (
        <div
          aria-hidden="true"
          className={`ambient-light-aura absolute pointer-events-none select-none -z-10 transition-opacity duration-1000 ease-out -top-36 sm:-top-48 md:-top-64 lg:-top-80 xl:-top-[380px] -bottom-48 sm:-bottom-64 md:-bottom-80 lg:-bottom-[540px] xl:-bottom-[680px] -left-36 sm:-left-48 md:-left-72 lg:-left-96 xl:-left-[460px] ${
            hasRail
              ? '-right-36 sm:-right-52 md:-right-72 lg:-right-[700px] xl:-right-[880px]'
              : '-right-36 sm:-right-48 md:-right-72 lg:-right-96 xl:-right-[460px]'
          }`}
          style={{
            opacity: isPlaying ? 0.98 : 0.60,
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            maskImage: `radial-gradient(ellipse 62% 58% at ${hasRail ? '42% 40%' : '50% 40%'}, black 0%, black 28%, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0.72) 60%, rgba(0,0,0,0.48) 78%, rgba(0,0,0,0.22) 90%, rgba(0,0,0,0.05) 96%, transparent 100%)`,
            WebkitMaskImage: `radial-gradient(ellipse 62% 58% at ${hasRail ? '42% 40%' : '50% 40%'}, black 0%, black 28%, rgba(0,0,0,0.92) 42%, rgba(0,0,0,0.72) 60%, rgba(0,0,0,0.48) 78%, rgba(0,0,0,0.22) 90%, rgba(0,0,0,0.05) 96%, transparent 100%)`,
          }}
        >
          {/* Dual-buffer real-time ambient canvases with fluid 1200ms crossfade and organic wave motion */}
          <div className="w-full h-full relative animate-ambient-wave filter blur-[80px] sm:blur-[110px] md:blur-[140px] lg:blur-[180px] saturate-[1.50] brightness-[1.18]">
            <canvas
              ref={ambientCanvasRefA}
              width={32}
              height={18}
              style={{
                transition: 'opacity 1200ms cubic-bezier(0.25, 1, 0.5, 1)',
                opacity: 1,
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
              }}
              className="absolute inset-0 w-full h-full object-cover rounded-[48px]"
            />
            <canvas
              ref={ambientCanvasRefB}
              width={32}
              height={18}
              style={{
                transition: 'opacity 1200ms cubic-bezier(0.25, 1, 0.5, 1)',
                opacity: 0,
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
              }}
              className="absolute inset-0 w-full h-full object-cover rounded-[48px]"
            />
          </div>

          {/* Ambient radiant fallback aura blending smoothly into website glass background */}
          <div
            className="absolute inset-0 filter blur-[56px] sm:blur-[80px] md:blur-[108px] lg:blur-[130px] scale-[1.12] opacity-35 rounded-[48px] -z-10"
            style={{
              backgroundImage:
                media?.backdrop_image || media?.cover_image
                  ? `url(${getProxiedImageUrl(
                      media.backdrop_image || media.cover_image,
                      media.cover_image,
                      media.title,
                      'w780'
                    )})`
                  : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        </div>
      )}

      {/* MAIN UNIFIED KOUP NETFLIX PLAYER CONTAINER */}
      <div
        id="koup-player-container"
        ref={containerRef}
        onPointerMove={handlePointerMoveContainer}
        onMouseLeave={() => {
          isHoveringBottomControlsRef.current = false;
          if (isPlaying && !activePanel && !isScrubbing) {
            showOverlayRef.current = false;
            setShowOverlay(false);
            setShowVolumeSlider(false);
          }
        }}
        style={isFullscreen || isTrailerMode ? undefined : { width: '100%', height: '100%' }}
        className={`relative mx-auto select-none bg-black overflow-hidden ${
          !showOverlay && isPlaying ? 'cursor-none' : 'cursor-default'
        } ${
          isFullscreen
            ? 'fixed inset-0 z-50 w-screen h-screen max-w-none rounded-none border-none aspect-auto flex flex-col justify-center items-center'
            : isTrailerMode
            ? 'w-full h-full max-w-[calc(100dvh*16/9)] max-h-[100dvh] aspect-video rounded-none border-none shadow-none z-20 flex flex-col justify-center'
            : `w-full aspect-video rounded-2xl sm:rounded-3xl border z-20 transition-[border-color,box-shadow] duration-300 ${
                cinemaLightsOff
                  ? 'border-sky-500/30 shadow-[0_0_30px_rgba(41,151,255,0.15),0_10px_25px_rgba(0,0,0,0.5)]'
                  : 'border-white/10 shadow-[0_10px_25px_rgba(0,0,0,0.45)]'
              }`
        }`}
      >
        {/* CORE VIDEO AREA */}
        {isTrulyScheduled ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#0c0c0e] to-black">
            <div className="w-14 h-14 rounded-3xl bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center mb-4">
              <Clock className="w-7 h-7 text-[#E50914] animate-pulse" />
            </div>
            <div className="text-xs font-mono uppercase tracking-widest text-white/60 mb-1">
              Yayın Takvimi · Canlı Geri Sayım
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-extrabold text-white tracking-tight mb-4">
              {countdownText || 'Hesaplanıyor...'}
            </h3>
            <div className="max-w-lg px-5 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-xs sm:text-sm text-white/80 leading-relaxed">
              {currentEpObj?.translation_note ||
                (isMovie
                  ? 'Film yayını bekleniyor. Kaynaklar eklendiğinde oynatıcı aktif olacaktır.'
                  : 'Çeviri işlemi için bölümün orijinal yayını bekleniyor. Bölüm yayınlandığı anda kaynaklar eklenecektir.')}
            </div>
          </div>
        ) : (isLoadingEpisodes || (episodes.length === 0 && !isTrailerMode)) ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-black relative">
            {(media.backdrop_image || media.cover_image) && (
              <img
                src={getProxiedImageUrl(
                  media.backdrop_image || media.cover_image,
                  media.cover_image,
                  media.title,
                  "w1280"
                )}
                alt=""
                aria-hidden="true"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.triedCover && media.cover_image) {
                    target.dataset.triedCover = 'true';
                    target.src = getProxiedImageUrl(media.cover_image, null, media.title, 'w500');
                  } else {
                    target.style.display = 'none';
                  }
                }}
                className="absolute inset-0 w-full h-full object-cover opacity-20 filter blur-sm pointer-events-none"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-3">
              <Film className="w-8 h-8 text-sky-400 animate-spin" />
              <p className="text-white/80 font-medium text-sm">
                KoUp Sinema Oynatıcısı Hazırlanıyor...
              </p>
            </div>
          </div>
        ) : isPendingOrNoSource ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#0c0c0e] via-[#08080a] to-black relative overflow-hidden select-none">
            {/* Background subtle ambient glow */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
              <div className="w-80 h-80 rounded-full bg-amber-500/25 blur-3xl" />
            </div>

            <div className="relative z-10 flex flex-col items-center max-w-lg px-4">
              <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center mb-4 text-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.18)]">
                <Clock className="w-8 h-8" />
              </div>

              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 font-mono text-[11px] font-semibold mb-3">
                <span>Yakında</span>
              </div>

              <h3 className="text-xl sm:text-3xl font-bold text-white tracking-tight mb-2.5">
                Bu bölüm yakında eklenecek
              </h3>

              <p className="text-xs sm:text-sm text-white/60 mb-6 leading-relaxed max-w-md">
                Kaynak bulunduğunda otomatik olarak eklenecek. Daha sonra tekrar kontrol edebilirsin.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {prevAvailableEp && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectEpisode(
                        prevAvailableEp.season_number || currentSeason,
                        prevAvailableEp.episode_number
                      );
                    }}
                    className="px-4.5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition-[transform,background-color] duration-150 hover:scale-105 active:scale-95 shadow-lg"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Önceki Bölüm ({prevAvailableEp.episode_number}. Bölüm)</span>
                  </button>
                )}

                <Link
                  href={`/seri/${media.slug}`}
                  className="px-5 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition-[transform,background-color] duration-150 hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(41,151,255,0.4)]"
                >
                  <Film className="w-4 h-4" />
                  <span>Seri Sayfasına Dön</span>
                </Link>
              </div>
            </div>
          </div>
        ) : resolvedMode === 'resolving' ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-black relative">
            {(media.backdrop_image || media.cover_image) && (
              <img
                src={getProxiedImageUrl(
                  media.backdrop_image || media.cover_image,
                  media.cover_image,
                  media.title,
                  'w1280'
                )}
                alt=""
                aria-hidden="true"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.triedCover && media.cover_image) {
                    target.dataset.triedCover = 'true';
                    target.src = getProxiedImageUrl(media.cover_image, null, media.title, 'w500');
                  } else {
                    target.style.display = 'none';
                  }
                }}
                className="absolute inset-0 w-full h-full object-cover opacity-20 filter blur-sm pointer-events-none"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full border-4 border-white/15 border-t-[#E50914] animate-spin" />
              <div className="text-white/80 text-xs font-medium tracking-wide">
                Video akışı hazırlanıyor...
              </div>
            </div>
          </div>
        ) : resolvedMode === 'error' ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#0c0c0e] to-black relative">
            <div className="w-14 h-14 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
              <AlertTriangle className="w-7 h-7 text-[#E50914]" />
            </div>
            <div className="text-xs font-mono uppercase tracking-widest text-[#E50914] mb-1">
              Kaynak Durumu
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
              Bu Kaynağa Şu Anda Erişilemiyor
            </h3>
            <p className="max-w-md text-xs sm:text-sm text-white/60 mb-5 leading-relaxed">
              Bu video sunucusu geçici olarak yanıt vermiyor. Lütfen alternatif kaynakları deneyin.
            </p>
            {filteredSources.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mb-5">
                {filteredSources.map((s, idx) => (
                  <button
                    key={`${s.embed_id || s.direct_url}_${idx}`}
                    type="button"
                    onClick={() => setSelectedSourceIdx(idx)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 cursor-pointer ${
                      selectedSourceIdx === idx
                        ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/25'
                        : 'bg-white/10 hover:bg-white/20 text-white/80'
                    }`}
                  >
                    {s.source_name || `Kaynak ${idx + 1}`}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition-transform active:scale-95"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Sayfayı Yenile</span>
            </button>
          </div>
        ) : resolvedMode === 'native_hls' || resolvedMode === 'native_mp4' || resolvedMode === 'trailer' ? (
          /* ==================================================================
             LAYER 1: AUTHENTIC NETFLIX NATIVE PLAYER (HLS / MP4 / Trailer)
             ================================================================== */
          <div
            onPointerDown={handleStagePointerDown}
            onPointerUp={handleStagePointerUp}
            onTouchStart={handleStageTouchStart}
            onTouchMove={handleStageTouchMove}
            onTouchEnd={handleStageTouchEnd}
            className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
          >
            {resolvedMode === 'trailer' ? (
              <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center select-none bg-black">
                {/* Backdrop / Poster while loading trailer */}
                {(media.backdrop_image || media.cover_image) && (
                  <img
                    src={getProxiedImageUrl(
                      media.backdrop_image || media.cover_image,
                      media.cover_image,
                      media.title,
                      'w1280'
                    )}
                    alt=""
                    aria-hidden="true"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.dataset.triedCover && media.cover_image) {
                        target.dataset.triedCover = 'true';
                        target.src = getProxiedImageUrl(media.cover_image, null, media.title, 'w500');
                      } else {
                        target.style.display = 'none';
                      }
                    }}
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${
                      isTrailerReady ? 'opacity-0' : 'opacity-60'
                    }`}
                  />
                )}
                {!isTrailerReady && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-12 h-12 rounded-full border-4 border-white/15 border-t-[#E50914] animate-spin" />
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  key={trailerStreamUrl}
                  src={trailerStreamUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  onLoad={handleTrailerIframeLoad}
                  className={`w-[138%] h-[138%] min-w-[138%] min-h-[138%] border-0 pointer-events-none select-none transition-opacity duration-700 ${
                    isTrailerReady ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                preload="auto"
                muted={isMuted}
                style={{
                  ...(brightness !== 100 ? { filter: `brightness(${brightness}%)` } : {}),
                  ...(isFullscreen && videoZoomScale !== 1
                    ? { transform: `scale(${videoZoomScale})` }
                    : {}),
                  transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 300ms ease',
                }}
                onPlay={() => {
                  setIsPlaying(true);
                  setIsBuffering(false);
                }}
                onPlaying={() => {
                  setIsPlaying(true);
                  setIsBuffering(false);
                }}
                onWaiting={() => setIsBuffering(true)}
                onCanPlay={() => {
                  setIsBuffering(false);
                  if (videoRef.current) {
                    videoRef.current.muted = isMuted;
                    videoRef.current.volume = isMuted ? 0 : volume;
                  }
                  if (targetResumeRef.current <= 3) setIsResumeReady(true);
                }}
                onSeeked={() => {
                  setIsBuffering(false);
                  setIsResumeReady(true);
                  const v = videoRef.current;
                  if (v && !Number.isNaN(v.currentTime)) {
                    const actualTime = v.currentTime;
                    const floorSec = Math.floor(actualTime);
                    currentTimeRef.current = floorSec;
                    setCurrentTime(actualTime);
                    trackedTimeRef.current = floorSec;
                  }
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setTimeout(() => {
                    flushCurrentProgress('pause', false);
                  }, 60);
                }}
              onProgress={() => {
                const v = videoRef.current;
                if (!v || !v.duration || v.buffered.length === 0) return;
                const bufferedEnd = v.buffered.end(v.buffered.length - 1);
                const pct = Math.round(
                  Math.min(100, Math.max(0, (bufferedEnd / v.duration) * 100))
                );
                if (pct !== bufferedPercentRef.current) {
                  bufferedPercentRef.current = pct;
                  setBufferedPercent(pct);
                }
              }}
              onTimeUpdate={() => {
                const v = videoRef.current;
                if (!v || isScrubbingRef.current) return;
                const resumeSec = targetResumeRef.current;
                if (resumeSec > 3 && !isResumeReady && v.currentTime >= resumeSec - 2) {
                  setIsResumeReady(true);
                }
                const curSec = Math.floor(v.currentTime);
                const isInitialSeeking = resumeSec > 3 && v.currentTime < 1.5;
                if (!isInitialSeeking && curSec !== currentTimeRef.current) {
                  currentTimeRef.current = curSec;
                  setCurrentTime(curSec);
                }
                if (curSec > 0) {
                  trackedTimeRef.current = curSec;
                }
                // Auto-capture frame for episode preview cache once playback reaches >= 120s
                if (curSec >= 120 && curSec <= 126) {
                  const epKey = `${media.id}_s${currentSeason || 1}_e${currentEpisode || 1}`;
                  if (!episodePreviewCache.has(epKey)) {
                    captureCurrentVideoFrame();
                  }
                }
                // Subtitle cue matching for authentic Netflix subtitle rendering
                if (subtitleCues.length > 0) {
                  const t = v.currentTime;
                  const cur = subtitleCues.find((c) => t >= c.start && t <= c.end);
                  const nextSubtitle = cur ? cur.text : null;
                  if (nextSubtitle !== activeSubtitleTextRef.current) {
                    activeSubtitleTextRef.current = nextSubtitle;
                    setActiveSubtitleText(nextSubtitle);
                  }
                } else if (activeSubtitleTextRef.current !== null) {
                  activeSubtitleTextRef.current = null;
                  setActiveSubtitleText(null);
                }
                const vDur = Math.floor(v.duration || 0);
                if (vDur > 0 && vDur !== durationRef.current) {
                  durationRef.current = vDur;
                  setDuration(v.duration);
                }
                if (
                  autoNextEnabled &&
                  v.duration > 120 &&
                  v.duration - v.currentTime <= 15 &&
                  v.duration - v.currentTime > 0 &&
                  nextEp
                ) {
                  const rem = Math.ceil(v.duration - v.currentTime);
                  if (rem !== nextCountdownRef.current) {
                    nextCountdownRef.current = rem;
                    setNextCountdown(rem);
                  }
                } else if (nextCountdownRef.current !== null) {
                  nextCountdownRef.current = null;
                  setNextCountdown(null);
                }
              }}
              onEnded={() => {
                flushCurrentProgress('completed', false);
                if (autoNextEnabled && nextEp) {
                  handleNextEpisode();
                }
              }}
              onError={() => {
                const v = videoRef.current;
                // Ignore if video element has no active src or is tearing down
                if (!v || !v.currentSrc || v.currentSrc === '' || v.currentSrc === window.location.href) {
                  return;
                }
                // If native MP4 failed on direct URL, attempt stream-proxy before giving up to iframe
                if (resolvedMode === 'native_mp4' && streamUrl && !v.src.includes('/api/stream-proxy')) {
                  const proxied = `/api/stream-proxy?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent('https://tau-video.xyz/')}`;
                  v.src = proxied;
                  v.load();
                  v.play().catch(() => {});
                  return;
                }
                // If there is another non-dead source, advance automatically
                const nextWorkingIdx = filteredSources.findIndex(
                  (s, idx) =>
                    idx !== selectedSourceIdx &&
                    !deadSourceKeys.has(s.id ? String(s.id) : (s.direct_url || '')) &&
                    s.direct_url !== activeSourceUrl
                );
                if (nextWorkingIdx !== -1) {
                  pushNotification(
                    'Kaynak Değiştirildi',
                    `${activeSource?.source_name || 'Kaynak'} yüklenemedi, alternatif kaynağa bağlanılıyor.`,
                    'info'
                  );
                  setSelectedSourceIdx(nextWorkingIdx);
                  return;
                }
                if (fallbackIframeUrl) {
                  setStreamUrl(fallbackIframeUrl);
                  setResolvedMode('iframe');
                } else {
                  setResolvedMode('error');
                }
              }}
              className={`w-full h-full object-contain pointer-events-none transition-opacity duration-300 ${
                isResumeReady || targetResumeRef.current <= 3 ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

            {/* NETFLIX BUFFERING RING (Suppressed when HUD controls are visible so it never collides with center play/pause button) */}
            {!showOverlay && (isBuffering || isResolving || (!isResumeReady && targetResumeRef.current > 3)) && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-4 border-white/15 border-t-[#E50914] animate-spin" />
              </div>
            )}

            {/* NETFLIX AUTHENTIC SUBTITLE OVERLAY */}
            {activeSubtitleText && (
              <div
                className={`pointer-events-none absolute inset-x-0 transition-[bottom] duration-200 z-30 flex justify-center px-2 sm:px-8 text-center ${
                  showOverlay
                    ? isFullscreen
                      ? 'bottom-20 sm:bottom-24 md:bottom-28'
                      : 'bottom-10 sm:bottom-14 md:bottom-16'
                    : isFullscreen
                      ? 'bottom-6 sm:bottom-10 md:bottom-12'
                      : 'bottom-2 sm:bottom-4 md:bottom-6'
                }`}
              >
                <div
                  style={{
                    fontFamily:
                      '"Netflix Sans", "Helvetica Neue", Segoe UI, Roboto, Ubuntu, sans-serif',
                    textShadow:
                      '0 0 4px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.9)',
                  }}
                  className={`text-white font-normal max-w-5xl tracking-normal select-none leading-snug whitespace-pre-line text-center ${
                    !isFullscreen
                      ? 'text-xs sm:text-base md:text-xl lg:text-2xl'
                      : 'text-sm sm:text-xl md:text-[28px] lg:text-[32px]'
                  }`}
                >
                  {activeSubtitleText}
                </div>
              </div>
            )}

            {/* TRANSIENT KEYBOARD/VOLUME STATUS PILL */}
            {hudToast && (
              <div
                key={hudToast.key}
                className="absolute top-12 sm:top-16 left-1/2 -translate-x-1/2 z-40 px-3.5 sm:px-4 py-1.5 rounded-full bg-black/85 border border-white/15 text-white text-[11px] sm:text-sm font-semibold tracking-wide pointer-events-none shadow-2xl"
              >
                {hudToast.label}
              </div>
            )}

            {/* NETFLIX AUTHENTIC MOBILE DOUBLE-TAP EDGE RIPPLE WAVE */}
            <AnimatePresence>
              {mobileSeekRipple && (
                <motion.div
                  key={`mobile-ripple-${mobileSeekRipple.key}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className={`absolute inset-y-0 z-35 pointer-events-none flex flex-col items-center justify-center select-none ${
                    mobileSeekRipple.dir === 'left'
                      ? 'left-0 w-2/5 rounded-r-[100%] bg-gradient-to-r from-white/[0.22] via-white/[0.08] to-transparent'
                      : 'right-0 w-2/5 rounded-l-[100%] bg-gradient-to-l from-white/[0.22] via-white/[0.08] to-transparent'
                  }`}
                >
                  <motion.div
                    animate={
                      mobileSeekRipple.dir === 'left'
                        ? { x: [0, -8, 0] }
                        : { x: [0, 8, 0] }
                    }
                    transition={{ repeat: Infinity, duration: 0.45, ease: 'easeInOut' }}
                    className="flex items-center text-white"
                  >
                    {mobileSeekRipple.dir === 'left' ? (
                      <ChevronsLeft className="w-9 h-9 sm:w-11 sm:h-11 text-white" />
                    ) : (
                      <ChevronsRight className="w-9 h-9 sm:w-11 sm:h-11 text-white" />
                    )}
                  </motion.div>
                  <div className="text-white font-bold text-xs sm:text-sm tracking-wide mt-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                    {mobileSeekRipple.amount} saniye
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SCREEN LOCKED OVERLAY */}
            {isScreenLocked ? (
              <div
                className={`netflix-hud-layer absolute inset-0 z-40 flex flex-col items-center justify-between p-4 sm:p-8 bg-black/25 ${
                  showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="w-full flex justify-end">
                  <button
                    type="button"
                    data-netflix-control="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsScreenLocked(false);
                      triggerHudToast('Ekran Kilidi Açıldı');
                      revealControls();
                    }}
                    className="flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full bg-black/80 hover:bg-black text-white border border-white/25 text-xs sm:text-sm font-bold shadow-2xl cursor-pointer transition-transform active:scale-95"
                  >
                    <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#E50914]" />
                    <span>Ekran Kilitli · Kilidi Aç</span>
                  </button>
                </div>
                <div />
              </div>
            ) : (
              /* ================================================================
                 AUTHENTIC NETFLIX FULL HUD OVERLAY (PROPORTIONALLY SIZED FOR MOBILE)
                 ================================================================ */
              <div
                className={`netflix-hud-layer absolute inset-0 z-30 flex flex-col justify-between h-full overflow-hidden transition-colors duration-200 pointer-events-none will-change-[opacity] ${
                  showOverlay ? 'bg-black/10' : 'bg-transparent'
                }`}
              >
                {/* 1. TOP BAR */}
                <div
                  data-netflix-control="true"
                  onClick={(e) => e.stopPropagation()}
                  className={`w-full px-3 sm:px-8 pt-2 sm:pt-4 pb-2 sm:pb-4 bg-gradient-to-b from-black/75 via-black/20 to-transparent flex items-center justify-between gap-2.5 sm:gap-4 shrink-0 transition-opacity duration-200 ${
                    showOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Left: Back Arrow ONLY on Mobile, Fullscreen, or Trailer Mode; on PC windowed mode use spacer */}
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    {isTrailerMode ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (onCloseTrailer) onCloseTrailer();
                          else router.back();
                        }}
                        aria-label="Fragmandan Çık"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-colors duration-150 cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                        <span className="hidden sm:inline">Geri</span>
                      </button>
                    ) : isTouchDevice || isFullscreen ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isFullscreen) {
                            toggleFullscreen();
                          } else {
                            router.push(`/seri/${media.slug}`);
                          }
                        }}
                        aria-label="Geri"
                        className="p-1 sm:p-1.5 text-white/90 hover:text-white hover:scale-110 active:scale-95 transition-transform cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-5 h-5 sm:w-7 sm:h-7 stroke-[2.2]" />
                      </button>
                    ) : (
                      <div className="w-8 shrink-0" />
                    )}

                    {isTouchDevice && (
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        {isTrailerMode && (
                          <span className="px-1.5 py-0.5 rounded bg-[#E50914] text-white font-black text-[9px] tracking-wider uppercase shrink-0">
                            FRAGMAN
                          </span>
                        )}
                        <span className="text-white font-bold text-xs sm:text-sm truncate max-w-[240px] sm:max-w-xs">
                          {episodeDisplayTitle}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Center (PC Only): Centered Episode Title or Fragman Banner */}
                  {!isTouchDevice && (
                    <div className="flex items-center justify-center gap-2.5 min-w-0 text-center">
                      {isTrailerMode && (
                        <span className="px-2 py-0.5 rounded bg-[#E50914] text-white font-black text-[10px] tracking-wider uppercase shrink-0">
                          FRAGMAN
                        </span>
                      )}
                      <h2 className="text-white font-semibold text-sm sm:text-base lg:text-lg tracking-tight truncate [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                        {isTrailerMode ? cleanMediaTitle(media.title) : episodeDisplayTitle}
                      </h2>
                    </div>
                  )}

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    {isTrailerMode ? (
                      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        {episodes && episodes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onCloseTrailer) onCloseTrailer();
                              const epNum = currentEpisode || 1;
                              const sQuery = currentSeason && currentSeason > 1 ? `?season=${currentSeason}` : '';
                              router.push(`/seri/${media.slug}/${epNum}${sQuery}`);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-black hover:bg-white/90 text-xs font-bold shadow-md cursor-pointer transition-transform active:scale-95"
                          >
                            <Play className="w-3.5 h-3.5 fill-black" />
                            <span className="hidden sm:inline">
                              {isMovie
                                ? 'Filmi İzle'
                                : currentEpisode && currentEpisode > 1
                                ? `${currentEpisode}. Bölümü İzle`
                                : '1. Bölümü İzle'}
                            </span>
                          </button>
                        )}
                        {onCloseTrailer && (
                          <button
                            type="button"
                            onClick={onCloseTrailer}
                            aria-label="Kapat"
                            className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/20 transition-colors duration-150 cursor-pointer"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ) : isTouchDevice ? (
                      <div className="flex items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleCastPrompt}
                          aria-label={isCasting ? "TV'ye Yansıtılıyor" : "TV'ye Yansıt (Chromecast)"}
                          className={`p-1 shrink-0 transition-transform cursor-pointer ${
                            isCasting
                              ? 'text-[#E50914] scale-110 drop-shadow-[0_0_8px_rgba(229,9,20,0.6)] animate-pulse'
                              : 'text-white/90 hover:text-white active:scale-95'
                          }`}
                        >
                          <CastIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                        {isFullscreen && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsScreenLocked(true);
                              setActivePanel(null);
                              triggerHudToast('Ekran Kilitlendi');
                            }}
                            aria-label="Ekran Kontrollerini Kilitle"
                            className="p-1 text-white/90 hover:text-white active:scale-95 transition-transform cursor-pointer"
                          >
                            <Unlock className="w-4 h-4 sm:w-5 sm:h-5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="w-8 flex justify-end" />
                    )}
                  </div>
                </div>

                {/* 2. MIDDLE STAGE: Left Brightness + Center Transport Trio + Right Volume */}
                <div className="relative flex-1 flex items-center justify-center px-2 sm:px-10 min-h-0 overflow-hidden pointer-events-none">
                  {/* MOBILE: Left Vertical Brightness Bar */}
                  {isTouchDevice && isFullscreen && (
                    <div
                      data-netflix-control="true"
                      onClick={(e) => e.stopPropagation()}
                      className={`flex flex-col items-center gap-1 sm:gap-2.5 absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 z-30 transition-opacity duration-150 ${
                        showOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setBrightness(100);
                          triggerHudToast('Parlaklık: %100');
                        }}
                        aria-label="Parlaklığı Sıfırla (%100)"
                        className="text-white/85 active:text-white cursor-pointer p-0.5"
                      >
                        <Sun className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                      </button>
                      <div className="relative h-14 sm:h-24 w-1 sm:w-1.5 rounded-full bg-white/25 overflow-hidden flex flex-col justify-end">
                        <div
                          style={{
                            height: `${((brightness - 45) / (130 - 45)) * 100}%`,
                          }}
                          className="w-full bg-white rounded-full transition-[height] duration-75"
                        />
                        <input
                          type="range"
                          min={45}
                          max={130}
                          step={1}
                          value={brightness}
                          aria-label="Ekran parlaklığı"
                          onChange={(e) => setBrightness(Number(e.target.value))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Center Transport Controls: In regular playback only show trio; when playing, keep center clear (no ||). In trailer mode, keep center completely clear while playing, only show play button if paused */}
                  {!isTrailerMode ? (
                    <div
                      className="flex items-center justify-center gap-6 sm:gap-16 md:gap-24 pointer-events-none select-none"
                    >
                      {/* Rewind 5s Button */}
                      <button
                        type="button"
                        data-netflix-control="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          seekBy(-5, true);
                        }}
                        aria-label="5 Saniye Geri Sar"
                        className={`text-white hover:scale-110 active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:drop-shadow-[0_0_20px_rgba(255,255,255,0.45)] cursor-pointer p-1 sm:p-2 focus:outline-none ${
                          showOverlay
                            ? 'opacity-100 pointer-events-auto'
                            : 'opacity-0 pointer-events-none'
                        }`}
                      >
                        <NetflixRewind10Icon
                          key={seekFeedback?.key}
                          className="w-8 h-8 sm:w-13 sm:h-13 md:w-16 md:h-16"
                          isAnimating={seekFeedback?.dir === 'left'}
                        />
                      </button>

                      {/* Center Play / Pause Button */}
                      <button
                        type="button"
                        data-netflix-control="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePlayPause();
                        }}
                        aria-label={isPlaying ? 'Duraklat' : 'Oynat'}
                        className={`text-white hover:scale-110 active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:drop-shadow-[0_0_26px_rgba(255,255,255,0.55)] cursor-pointer p-1 sm:p-2 focus:outline-none flex items-center justify-center ${
                          showOverlay
                            ? 'opacity-100 pointer-events-auto'
                            : 'opacity-0 pointer-events-none'
                        }`}
                      >
                        <div key={isPlaying ? 'pause' : 'play'} className="animate-play-pop flex items-center justify-center">
                          {isPlaying ? (
                            <NetflixPauseBarsIcon className="w-10 h-10 sm:w-18 sm:h-18 md:w-22 md:h-22" />
                          ) : (
                            <NetflixPlayTriangleIcon className="w-10 h-10 sm:w-18 sm:h-18 md:w-22 md:h-22" />
                          )}
                        </div>
                      </button>

                      {/* Forward 5s Button */}
                      <button
                        type="button"
                        data-netflix-control="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          seekBy(5, true);
                        }}
                        aria-label="5 Saniye İleri Sar"
                        className={`text-white hover:scale-110 active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:drop-shadow-[0_0_20px_rgba(255,255,255,0.45)] cursor-pointer p-1 sm:p-2 focus:outline-none ${
                          showOverlay
                            ? 'opacity-100 pointer-events-auto'
                            : 'opacity-0 pointer-events-none'
                        }`}
                      >
                        <NetflixForward10Icon
                          key={seekFeedback?.key}
                          className="w-8 h-8 sm:w-13 sm:h-13 md:w-16 md:h-16"
                          isAnimating={seekFeedback?.dir === 'right'}
                        />
                      </button>
                    </div>
                  ) : (
                    /* Trailer Mode: Center is 100% clean while playing. If paused, show Play triangle to resume */
                    <div className="flex items-center justify-center gap-6 sm:gap-16 md:gap-24 pointer-events-none select-none">
                      {seekFeedback?.dir === 'left' && (
                        <div className="text-white p-1 sm:p-2">
                          <NetflixRewind10Icon
                            key={seekFeedback?.key}
                            className="w-8 h-8 sm:w-13 sm:h-13 md:w-16 md:h-16"
                            isAnimating={true}
                          />
                        </div>
                      )}
                      {!isPlaying && (
                        <button
                          type="button"
                          data-netflix-control="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlayPause();
                          }}
                          aria-label="Oynat"
                          className="p-3 sm:p-4 rounded-full bg-black/80 hover:bg-black/90 text-white border border-white/20 hover:scale-115 active:scale-85 transition-all duration-150 ease-out cursor-pointer shadow-2xl pointer-events-auto hover:drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]"
                        >
                          <div className="animate-play-pop flex items-center justify-center">
                            <NetflixPlayTriangleIcon className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16" />
                          </div>
                        </button>
                      )}
                      {seekFeedback?.dir === 'right' && (
                        <div className="text-white p-1 sm:p-2">
                          <NetflixForward10Icon
                            key={seekFeedback?.key}
                            className="w-8 h-8 sm:w-13 sm:h-13 md:w-16 md:h-16"
                            isAnimating={true}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* MOBILE: Right Vertical Volume Bar */}
                  {isTouchDevice && isFullscreen && (
                    <div
                      data-netflix-control="true"
                      onClick={(e) => e.stopPropagation()}
                      className={`flex flex-col items-center gap-1 sm:gap-2.5 absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-30 transition-opacity duration-150 ${
                        showOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={toggleMute}
                        aria-label={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
                        className="text-white/85 active:text-white cursor-pointer p-0.5"
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-[#E50914]" />
                        ) : volume < 0.5 ? (
                          <Volume1 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                        )}
                      </button>
                      <div className="relative h-14 sm:h-24 w-1 sm:w-1.5 rounded-full bg-white/25 overflow-hidden flex flex-col justify-end">
                        <div
                          style={{
                            height: `${(isMuted ? 0 : volume) * 100}%`,
                          }}
                          className="w-full bg-white rounded-full transition-[height] duration-75"
                        />
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={isMuted ? 0 : volume}
                          aria-label="Ses seviyesi"
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setVolume(v);
                            const nextMuted = v === 0;
                            setIsMuted(nextMuted);
                            try {
                              localStorage.setItem('koup_player_volume', String(v));
                              localStorage.setItem('koup_player_muted', String(nextMuted));
                            } catch {}
                            if (v > 0) savedVolumeRef.current = v;
                            if (videoRef.current) {
                              videoRef.current.volume = v;
                              videoRef.current.muted = v === 0;
                            }
                            revealControls();
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. BOTTOM SECTION: Scrubber Timeline + Dedicated PC / Mobile Action Row */}
                <div
                  data-netflix-control="true"
                  onClick={(e) => e.stopPropagation()}
                  onPointerEnter={() => {
                    isHoveringBottomControlsRef.current = true;
                    if (hideControlsTimer.current) {
                      clearTimeout(hideControlsTimer.current);
                      hideControlsTimer.current = null;
                    }
                    if (!showOverlayRef.current) {
                      showOverlayRef.current = true;
                      setShowOverlay(true);
                    }
                  }}
                  onPointerMove={() => {
                    isHoveringBottomControlsRef.current = true;
                    if (hideControlsTimer.current) {
                      clearTimeout(hideControlsTimer.current);
                      hideControlsTimer.current = null;
                    }
                    if (!showOverlayRef.current) {
                      showOverlayRef.current = true;
                      setShowOverlay(true);
                    }
                  }}
                  onPointerLeave={() => {
                    isHoveringBottomControlsRef.current = false;
                    scheduleHideOverlay();
                  }}
                  className={`w-full px-3 sm:px-8 pb-1.5 sm:pb-4 pt-1.5 sm:pt-4 bg-gradient-to-t from-black/75 via-black/20 to-transparent space-y-1 sm:space-y-2.5 shrink-0 transition-opacity duration-200 ${
                    showOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {/* RED TIMELINE SCRUBBER + RIGHT TIMESTAMP */}
                  <div className="flex items-center gap-2.5 sm:gap-4">
                    <div
                      className="relative flex-1 flex items-center"
                      onPointerMove={(e) => {
                        if (isTouchDevice) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                        );
                        const targetSec = Math.round(pct * safeDuration);
                        const targetPct = Math.round(pct * 1000) / 10;
                        if (targetSec !== hoverTimeRef.current) {
                          hoverTimeRef.current = targetSec;
                          setHoverPercent(targetPct);
                          setHoverTime(targetSec);
                        }
                      }}
                      onPointerLeave={() => {
                        hoverTimeRef.current = null;
                        setHoverTime(null);
                      }}
                    >
                      {/* PC Hover Timestamp Tooltip */}
                      {!isTouchDevice && hoverTime !== null && safeDuration > 0 && (
                        <div
                          style={{
                            left: `${Math.min(94, Math.max(6, hoverPercent))}%`,
                          }}
                          className="-translate-x-1/2 -top-8 absolute px-2.5 py-1 rounded bg-black/90 border border-white/20 text-white font-mono text-xs font-bold pointer-events-none shadow-lg whitespace-nowrap"
                        >
                          {formatTime(hoverTime)}
                        </div>
                      )}

                      <input
                        ref={scrubberRef}
                        type="range"
                        min={0}
                        max={safeDuration > 0 ? safeDuration : 100}
                        step={0.1}
                        value={safeDuration > 0 ? effectiveTime : 0}
                        aria-label="Video ilerleme çubuğu"
                        aria-valuetext={
                          safeDuration > 0
                            ? `${formatTime(effectiveTime)} / ${formatTime(safeDuration)}`
                            : `${formatTime(effectiveTime)} / --:--`
                        }
                        style={
                          {
                            '--attr-min': 0,
                            '--attr-max': safeDuration > 0 ? safeDuration : 100,
                            '--control-value': safeDuration > 0 ? effectiveTime : 0,
                            '--buffered-progress': safeDuration > 0 ? `${bufferedPercent}%` : '0%',
                            '--intro-start':
                              hasIntro && safeDuration > 0
                                ? `${Math.max(0, Math.min(100, (currentEpObj.intro_start_sec! / safeDuration) * 100))}%`
                                : '0%',
                            '--intro-end':
                              hasIntro && safeDuration > 0
                                ? `${Math.max(0, Math.min(100, (currentEpObj.intro_end_sec! / safeDuration) * 100))}%`
                                : '0%',
                            '--outro-start':
                              hasOutro && safeDuration > 0
                                ? `${Math.max(0, Math.min(100, (currentEpObj.outro_start_sec! / safeDuration) * 100))}%`
                                : '0%',
                            '--outro-end':
                              hasOutro && safeDuration > 0
                                ? `${Math.max(0, Math.min(100, ((currentEpObj.outro_end_sec || safeDuration) / safeDuration) * 100))}%`
                                : '0%',
                          } as React.CSSProperties
                        }
                        onPointerDown={() => {
                          if (safeDuration <= 0) return;
                          setIsScrubbing(true);
                          setScrubTime(currentTime);
                        }}
                        onChange={(e) => {
                          if (safeDuration <= 0) return;
                          const val = Number(e.target.value);
                          setScrubTime(val);
                          currentTimeRef.current = Math.floor(val);
                          setCurrentTime(val);
                          if (isTrailerMode) {
                            sendSeekToIframe(val);
                          } else if (videoRef.current) {
                            videoRef.current.currentTime = val;
                          }
                        }}
                        onPointerUp={(e) => {
                          if (safeDuration <= 0) return;
                          const val = Number((e.target as HTMLInputElement).value);
                          if (isTrailerMode) {
                            sendSeekToIframe(val);
                          } else if (videoRef.current) {
                            videoRef.current.currentTime = val;
                          }
                          currentTimeRef.current = Math.floor(val);
                          setCurrentTime(val);
                          setIsScrubbing(false);
                        }}
                        className="netflix-scrubber"
                      />
                    </div>

                    {/* Right Timestamp */}
                    <button
                      type="button"
                      onClick={() => setShowRemainingTime((v) => !v)}
                      aria-label="Süre görünümünü değiştir"
                      className="text-[11px] sm:text-xs font-medium text-white/95 hover:text-white tabular-nums shrink-0 cursor-pointer [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] transition-colors text-right select-none"
                    >
                      {showRemainingTime ? (
                        safeDuration > 0 ? (
                          `-${formatTime(remainingSec)}`
                        ) : (
                          '--:--'
                        )
                      ) : safeDuration > 0 ? (
                        `${formatTime(effectiveTime)} / ${formatTime(safeDuration)}`
                      ) : (
                        `${formatTime(effectiveTime)} / --:--`
                      )}
                    </button>
                  </div>

                  {/* Quality Popover Reusable Renderer - Perfectly Centered Above Quality Button */}
                  {(() => null)()}

                  {/* DEDICATED ACTION BAR: PC vs MOBILE */}
                  {isTouchDevice ? (
                    /* MOBILE ACTION BAR (Proportionally fitted for mobile windowed mode) */
                    <div className="flex items-center justify-around gap-1 sm:gap-3 pt-0 overflow-visible text-[11px] sm:text-xs">
                      {!isTrailerMode && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setActivePanel((prev) => (prev === 'speed' ? null : 'speed'))
                            }
                            aria-label={`Oynatma Hızı (${playbackRate}x)`}
                            className={`flex items-center gap-1 py-1 text-xs font-medium cursor-pointer shrink-0 ${
                              activePanel === 'speed' ? 'text-[#E50914] font-bold' : 'text-white/90'
                            }`}
                          >
                            <NetflixSpeedIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            <span>Hız ({playbackRate}x)</span>
                          </button>

                          {!isMovie && isFullscreen && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePanel((prev) =>
                                  prev === 'episodes' ? null : 'episodes'
                                )
                              }
                              aria-label="Bölümler"
                              className={`flex items-center gap-1 py-1 text-xs font-medium cursor-pointer shrink-0 ${
                                activePanel === 'episodes'
                                  ? 'text-[#E50914] font-bold'
                                  : 'text-white/90'
                              }`}
                            >
                              <NetflixEpisodesIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              <span>Bölümler</span>
                            </button>
                          )}

                          {qualities.length > 0 && isFullscreen && (
                            <div className="relative flex items-center shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePanel((prev) =>
                                    prev === 'quality' ? null : 'quality'
                                  )
                                }
                                aria-label={`Kalite (${cleanQualityLabel(selectedQuality)})`}
                                className={`flex items-center gap-1 py-1 text-xs font-medium cursor-pointer shrink-0 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] ${
                                  activePanel === 'quality'
                                    ? 'text-[#E50914] font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
                                    : 'text-white/90 hover:text-white'
                                }`}
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                <span>{cleanQualityLabel(selectedQuality)}</span>
                              </button>

                              <AnimatePresence>
                                {activePanel === 'quality' && (
                                  <motion.div
                                    key="panel-quality-mobile"
                                    initial={{ opacity: 0, scale: 0.94, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.94, y: 10 }}
                                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                                    data-netflix-control="true"
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 min-w-[170px] max-w-[220px] max-h-[240px] overflow-y-auto no-scrollbar p-2.5 rounded-xl bg-[#181818]/98 backdrop-blur-sm border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.95)] space-y-1 select-none"
                                  >
                                    <div className="flex items-center border-b border-white/10 pb-1.5 mb-1 px-1">
                                      <span className="text-white/60 font-semibold text-[11px] uppercase tracking-wider">
                                        Kalite Seçimi
                                      </span>
                                    </div>
                                    {qualities.map((q, qIdx) => {
                                      const cleanLabel = cleanQualityLabel(q.label);
                                      const isSelected = cleanQualityLabel(selectedQuality) === cleanLabel;
                                      return (
                                        <button
                                          key={`${cleanLabel}-${q.url || ''}-${qIdx}`}
                                          type="button"
                                          onClick={() => {
                                            handleSelectQuality(q);
                                            setActivePanel(null);
                                          }}
                                          className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-medium flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                            isSelected
                                              ? 'text-white font-bold bg-white/10'
                                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                          }`}
                                        >
                                          <span>{cleanLabel}</span>
                                          {isSelected && (
                                            <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                                          )}
                                        </button>
                                      );
                                    })}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {(audioTracks.length > 1 || subtitles.length > 0) && (
                            <button
                              type="button"
                              onClick={() =>
                                setActivePanel((prev) =>
                                  prev === 'audio_subtitles' ? null : 'audio_subtitles'
                                )
                              }
                              aria-label="Ses ve Altyazı"
                              className={`flex items-center gap-1 py-1 text-xs font-medium cursor-pointer shrink-0 ${
                                activePanel === 'audio_subtitles'
                                  ? 'text-[#E50914] font-bold'
                                  : 'text-white/90'
                              }`}
                            >
                              <NetflixAudioSubtitleIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              <span>Ses & Altyazı</span>
                            </button>
                          )}

                          {!isMovie && nextEp && (
                            <button
                              type="button"
                              onClick={handleNextEpisode}
                              aria-label={`Sonraki Bölüm: ${nextEp.episode_number}. Bölüm`}
                              className="flex items-center gap-1 py-1 text-xs font-medium text-white/90 cursor-pointer shrink-0"
                            >
                              <NetflixNextEpIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              <span>Sonraki</span>
                            </button>
                          )}

                          {/* Oynatma Ayarları Butonu (Mobile) */}
                          <div className="relative flex items-center shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setActivePanel((prev) =>
                                  prev === 'playback_settings' ? null : 'playback_settings'
                                )
                              }
                              aria-label="Oynatma Tercihleri"
                              className={`flex items-center gap-1 py-1 text-xs font-medium cursor-pointer shrink-0 transition-colors ${
                                activePanel === 'playback_settings'
                                  ? 'text-[#E50914] font-bold'
                                  : 'text-white/90 hover:text-white'
                              }`}
                            >
                              <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              <span className="hidden xs:inline">Ayarlar</span>
                            </button>

                            {/* Fullscreen Mobile Popover */}
                            <AnimatePresence>
                              {isFullscreen && activePanel === 'playback_settings' && (
                                <motion.div
                                  key="panel-settings-mobile"
                                  initial={{ opacity: 0, scale: 0.94, y: 10 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.94, y: 10 }}
                                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                                  data-netflix-control="true"
                                  onClick={(e) => e.stopPropagation()}
                                  className="absolute bottom-full mb-3 right-0 z-50 w-72 p-3 rounded-2xl bg-[#141414]/98 backdrop-blur-xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.95)] space-y-2 select-none"
                                >
                                  <div className="flex items-center justify-between border-b border-white/10 pb-2 px-1">
                                    <span className="text-white/80 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                      <Settings className="w-3.5 h-3.5 text-[#E50914]" />
                                      Oynatma Tercihleri
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setActivePanel(null)}
                                      className="text-white/50 hover:text-white p-0.5 rounded cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  <div
                                    onClick={toggleAutoSkipIntro}
                                    className="w-full px-2 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-white/5 cursor-pointer transition-colors"
                                  >
                                    <div className="min-w-0 pr-1">
                                      <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                                        <FastForward className="w-3.5 h-3.5 text-amber-400" />
                                        <span>Otomatik İntro Atla</span>
                                      </div>
                                      <div className="text-[10px] text-zinc-400 mt-0.5">
                                        İntro başladığında doğrudan atlar
                                      </div>
                                    </div>
                                    <div
                                      className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                                        autoSkipIntro ? 'bg-[#E50914]' : 'bg-zinc-700'
                                      }`}
                                    >
                                      <div
                                        className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                                          autoSkipIntro ? 'translate-x-4' : 'translate-x-0'
                                        }`}
                                      />
                                    </div>
                                  </div>

                                  {!isMovie && (
                                    <div
                                      onClick={toggleAutoNext}
                                      className="w-full px-2 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-white/5 cursor-pointer transition-colors"
                                    >
                                      <div className="min-w-0 pr-1">
                                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                                          <NetflixNextEpIcon className="w-3.5 h-3.5 text-cyan-400" />
                                          <span>Otomatik Sonraki Bölüm</span>
                                        </div>
                                        <div className="text-[10px] text-zinc-400 mt-0.5">
                                          Outroda 3sn geri sayıp geçer
                                        </div>
                                      </div>
                                      <div
                                        className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                                          autoNextEnabled ? 'bg-[#E50914]' : 'bg-zinc-700'
                                        }`}
                                      >
                                        <div
                                          className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                                            autoNextEnabled ? 'translate-x-4' : 'translate-x-0'
                                          }`}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Tam Ekran Butonu */}
                          <button
                            type="button"
                            onClick={toggleFullscreen}
                            aria-label={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
                            className="flex items-center gap-1 py-1 text-xs font-medium text-white/90 hover:text-white active:scale-95 transition-transform cursor-pointer shrink-0"
                          >
                            {isFullscreen ? (
                              <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            ) : (
                              <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            )}
                            <span>{isFullscreen ? 'Küçült' : 'Tam Ekran'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    /* PC ACTION BAR */
                    <div className="flex items-center justify-between gap-2 sm:gap-4 md:gap-6 pt-0.5 min-w-0 flex-nowrap">
                      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                        <button
                          type="button"
                          onClick={togglePlayPause}
                          aria-label={isPlaying ? 'Duraklat (Space / K)' : 'Oynat (Space / K)'}
                          className="text-white/95 hover:text-white hover:scale-115 active:scale-85 hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.45)] transition-all duration-150 ease-out cursor-pointer"
                        >
                          <div key={isPlaying ? 'pause' : 'play'} className="animate-play-pop flex items-center justify-center">
                            {isPlaying ? (
                              <NetflixPauseBarsIcon className="w-6 h-6" />
                            ) : (
                              <NetflixPlayTriangleIcon className="w-6 h-6" />
                            )}
                          </div>
                        </button>

                        {/* HORIZONTAL VOLUME SLIDER: expands to the right (PC only) */}
                        {(() => {
                          const THUMB = 12;
                          const TRACK_W = 72;
                          const level = isMuted ? 0 : volume;
                          const open = showVolumeSlider || isDraggingVolume;
                          const applyVolume = (raw: number) => {
                            const rounded = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
                            if (rounded === volume && isMuted === (rounded === 0)) return;
                            setVolume(rounded);
                            const nextMuted = rounded === 0;
                            setIsMuted(nextMuted);
                            try {
                              localStorage.setItem('koup_player_volume', String(rounded));
                              localStorage.setItem('koup_player_muted', String(nextMuted));
                            } catch {}
                            if (rounded > 0) savedVolumeRef.current = rounded;
                            if (isTrailerMode) {
                              sendTrailerYtCommand('setVolume', [Math.round(rounded * 100)]);
                              if (rounded === 0) sendTrailerYtCommand('mute');
                              else sendTrailerYtCommand('unMute');
                            } else if (videoRef.current) {
                              videoRef.current.volume = rounded;
                              videoRef.current.muted = rounded === 0;
                            }
                          };

                          return (
                            <div
                              className="relative flex items-center shrink-0 select-none"
                              onMouseEnter={() => {
                                if (volumeHideTimerRef.current) {
                                  clearTimeout(volumeHideTimerRef.current);
                                  volumeHideTimerRef.current = null;
                                }
                                setShowVolumeSlider(true);
                              }}
                              onMouseLeave={() => {
                                if (isDraggingVolumeRef.current) return;
                                volumeHideTimerRef.current = setTimeout(() => {
                                  if (!isDraggingVolumeRef.current) setShowVolumeSlider(false);
                                }, 150);
                              }}
                              onWheel={(e) => {
                                e.preventDefault();
                                adjustVolume(e.deltaY < 0 ? 0.05 : -0.05);
                              }}
                            >
                              {/* Speaker Icon Button: Sized and animated identically to Fullscreen & Cast (stable bounding box, zero jitter) */}
                              <button
                                type="button"
                                onClick={toggleMute}
                                aria-label={isMuted ? 'Sesi Aç (M)' : 'Sesi Kapat (M)'}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-200 group/vol cursor-pointer shrink-0 text-white/90 hover:text-white"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="w-5 h-5 shrink-0 group-hover/vol:scale-110 transition-transform duration-200 ease-out will-change-transform transform-gpu"
                                  fill="none"
                                >
                                  {/* Solid white speaker cone */}
                                  <polygon
                                    points="11 4 6 8.5 2 8.5 2 15.5 6 15.5 11 20 11 4"
                                    fill="currentColor"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinejoin="round"
                                  />
                                  {/* Sound waves or mute X */}
                                  {level === 0 ? (
                                    <>
                                      <line x1="16" y1="8.5" x2="22" y2="15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                                      <line x1="22" y1="8.5" x2="16" y2="15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                                    </>
                                  ) : level < 0.5 ? (
                                    <path
                                      d="M15.5 8a5 5 0 0 1 0 8"
                                      stroke="currentColor"
                                      strokeWidth="2.2"
                                      strokeLinecap="round"
                                    />
                                  ) : (
                                    <>
                                      <path
                                        d="M15.5 8a5 5 0 0 1 0 8"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                      />
                                      <path
                                        d="M19 4.5a10.5 10.5 0 0 1 0 15"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                      />
                                    </>
                                  )}
                                </svg>
                              </button>

                              {/* Horizontal Slider Track: smoothly expands to the right without displacing the speaker button */}
                              <div
                                className={`overflow-hidden transition-[max-width,opacity] duration-150 ease-out flex items-center ${
                                  open ? 'max-w-[88px] opacity-100 pl-1.5 pr-1' : 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0'
                                }`}
                              >
                                <div
                                  className="relative w-[72px] h-8 flex items-center cursor-pointer touch-none shrink-0"
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    isDraggingVolumeRef.current = true;
                                    setIsDraggingVolume(true);
                                    setShowVolumeSlider(true);
                                    if (volumeHideTimerRef.current) {
                                      clearTimeout(volumeHideTimerRef.current);
                                      volumeHideTimerRef.current = null;
                                    }
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const calc = (clientX: number) =>
                                      applyVolume(
                                        (clientX - rect.left - THUMB / 2) / (rect.width - THUMB)
                                      );
                                    calc(e.clientX);
                                    const handleMove = (ev: PointerEvent) => calc(ev.clientX);
                                    const onUp = () => {
                                      isDraggingVolumeRef.current = false;
                                      setIsDraggingVolume(false);
                                      window.removeEventListener('pointermove', handleMove);
                                      window.removeEventListener('pointerup', onUp);
                                      window.removeEventListener('pointercancel', onUp);
                                    };
                                    window.addEventListener('pointermove', handleMove);
                                    window.addEventListener('pointerup', onUp);
                                    window.addEventListener('pointercancel', onUp);
                                  }}
                                >
                                  {/* Groove Line */}
                                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white/40 pointer-events-none" />
                                  {/* Filled Line */}
                                  <div
                                    className="absolute left-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-white pointer-events-none"
                                    style={{
                                      width: `${level * (TRACK_W - THUMB) + THUMB / 2}px`,
                                    }}
                                  />
                                  {/* Thumb */}
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white pointer-events-none shadow-sm"
                                    style={{
                                      width: `${THUMB}px`,
                                      height: `${THUMB}px`,
                                      left: `${level * (TRACK_W - THUMB)}px`,
                                    }}
                                  />
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={level}
                                    aria-label="Ses seviyesi"
                                    onChange={(e) => applyVolume(Number(e.target.value))}
                                    className="sr-only"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {!isTrailerMode && (
                          <button
                            type="button"
                            onClick={() =>
                              setActivePanel((prev) => (prev === 'speed' ? null : 'speed'))
                            }
                            aria-label="Oynatma Hızı"
                            className={`flex items-center gap-1.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] ${
                              activePanel === 'speed'
                                ? 'text-[#E50914] font-bold'
                                : 'text-white/90 hover:text-white'
                            }`}
                          >
                            <NetflixSpeedIcon className="w-5 h-5 shrink-0" />
                            <span className="hidden sm:inline">Hız ({playbackRate}x)</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 sm:gap-4 md:gap-6 shrink-0 flex-nowrap min-w-0">
                        {!isTrailerMode && (
                          <>
                            {!isMovie && (
                              <div className="relative flex items-center shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActivePanel((prev) =>
                                      prev === 'episodes' ? null : 'episodes'
                                    )
                                  }
                                  aria-label="Bölümler (E)"
                                  className={`flex items-center gap-1.5 py-1 text-sm font-medium transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap ${
                                    activePanel === 'episodes'
                                      ? 'text-[#E50914] font-bold'
                                      : 'text-white/90 hover:text-white'
                                  }`}
                                >
                                  <NetflixEpisodesIcon className="w-5 h-5 shrink-0" />
                                  <span className="hidden sm:inline">Bölümler</span>
                                </button>

                                <AnimatePresence>
                                  {activePanel === 'episodes' && (
                                    <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50">
                                      <NetflixEpisodePopover
                                        media={media}
                                        episodes={episodes}
                                        currentSeason={currentSeason}
                                        currentEpisode={currentEpisode}
                                        seasons={seasons}
                                        effectiveTime={effectiveTime}
                                        safeDuration={safeDuration}
                                        progressMap={progressMap}
                                        toggleEpisodeWatched={toggleEpisodeWatched}
                                        onSelectEpisode={onSelectEpisode}
                                        flushCurrentProgress={flushCurrentProgress}
                                        onClose={() => setActivePanel(null)}
                                        capturedFrameUrl={capturedFrameUrl}
                                        fallbackBackdropUrl={fallbackBackdropUrl}
                                        episodePreviewCache={episodePreviewCache}
                                      />
                                    </div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}

                            {(audioTracks.length > 1 || subtitles.length > 0) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePanel((prev) =>
                                    prev === 'audio_subtitles' ? null : 'audio_subtitles'
                                  )
                                }
                                aria-label="Ses ve Altyazı"
                                className={`flex items-center gap-1.5 py-1 text-sm font-medium transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap ${
                                  activePanel === 'audio_subtitles'
                                    ? 'text-[#E50914] font-bold'
                                    : 'text-white/90 hover:text-white'
                                }`}
                              >
                                <NetflixAudioSubtitleIcon className="w-5 h-5 shrink-0" />
                                <span className="hidden md:inline">Ses ve Altyazı</span>
                              </button>
                            )}

                            {!isMovie && nextEp && (
                              <button
                                type="button"
                                onClick={handleNextEpisode}
                                aria-label={`Sonraki Bölüm (N): ${nextEp.episode_number}. Bölüm`}
                                className="flex items-center gap-1.5 py-1 text-sm font-medium text-white/90 hover:text-white transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap"
                              >
                                <NetflixNextEpIcon className="w-5 h-5 shrink-0" />
                                <span className="hidden sm:inline">Sonraki Bölüm</span>
                              </button>
                            )}

                            {qualities.length > 0 && (
                              <div className="relative flex items-center shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActivePanel((prev) =>
                                      prev === 'quality' ? null : 'quality'
                                    )
                                  }
                                  aria-label={`Video Kalitesi: ${cleanQualityLabel(selectedQuality)}`}
                                  className={`flex items-center gap-1.5 py-1 text-sm font-medium transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap ${
                                    activePanel === 'quality'
                                      ? 'text-[#E50914] font-bold'
                                      : 'text-white/90 hover:text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]'
                                  }`}
                                >
                                  <SlidersHorizontal className="w-4 h-4 shrink-0" />
                                  <span>{cleanQualityLabel(selectedQuality)}</span>
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                      activePanel === 'quality' ? 'rotate-180 text-white' : 'text-white/60'
                                    }`}
                                  />
                                </button>

                                <AnimatePresence>
                                    {activePanel === 'quality' && (
                                      <motion.div
                                        key="panel-quality-pc"
                                        initial={{ opacity: 0, scale: 0.94, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.94, y: 10 }}
                                        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                                        data-netflix-control="true"
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 min-w-[170px] max-w-[220px] max-h-[300px] overflow-y-auto no-scrollbar p-2.5 rounded-xl bg-[#181818]/98 backdrop-blur-sm border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.95)] space-y-1 select-none"
                                      >
                                        <div className="flex items-center border-b border-white/10 pb-1.5 mb-1 px-1">
                                          <span className="text-white/60 font-semibold text-[11px] uppercase tracking-wider">
                                            Kalite Seçimi
                                          </span>
                                        </div>
                                        {qualities.map((q, qIdx) => {
                                          const cleanLabel = cleanQualityLabel(q.label);
                                          const isSelected = cleanQualityLabel(selectedQuality) === cleanLabel;
                                          return (
                                            <button
                                              key={`${cleanLabel}-${q.url || ''}-${qIdx}`}
                                              type="button"
                                              onClick={() => {
                                                handleSelectQuality(q);
                                                setActivePanel(null);
                                              }}
                                              className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-medium flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                                isSelected
                                                  ? 'text-white font-bold bg-white/10'
                                                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                              }`}
                                            >
                                              <span>{cleanLabel}</span>
                                              {isSelected && (
                                                <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                                              )}
                                            </button>
                                          );
                                        })}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                            )}

                            {/* Oynatma Ayarları Popover (PC) */}
                            <div className="relative flex items-center shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePanel((prev) =>
                                    prev === 'playback_settings' ? null : 'playback_settings'
                                  )
                                }
                                aria-label="Oynatma Tercihleri"
                                className={`flex items-center gap-1.5 py-1 text-sm font-medium transition-colors duration-150 cursor-pointer shrink-0 whitespace-nowrap ${
                                  activePanel === 'playback_settings'
                                    ? 'text-[#E50914] font-bold'
                                    : 'text-white/90 hover:text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]'
                                }`}
                              >
                                <Settings className="w-4 h-4 shrink-0" />
                                <span className="hidden lg:inline">Ayarlar</span>
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                    activePanel === 'playback_settings' ? 'rotate-180 text-white' : 'text-white/60'
                                  }`}
                                />
                              </button>

                              <AnimatePresence>
                                {activePanel === 'playback_settings' && (
                                  <motion.div
                                    key="panel-settings-pc"
                                    initial={{ opacity: 0, scale: 0.94, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.94, y: 10 }}
                                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                                    data-netflix-control="true"
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 w-76 p-3 rounded-2xl bg-[#141414]/98 backdrop-blur-xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.95)] space-y-2 select-none"
                                  >
                                    <div className="flex items-center justify-between border-b border-white/10 pb-2 px-1">
                                      <span className="text-white/80 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        <Settings className="w-3.5 h-3.5 text-[#E50914]" />
                                        Oynatma Tercihleri
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => setActivePanel(null)}
                                        className="text-white/50 hover:text-white p-0.5 rounded cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>

                                    <div
                                      onClick={toggleAutoSkipIntro}
                                      className="w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-3 hover:bg-white/5 cursor-pointer transition-colors"
                                    >
                                      <div className="min-w-0 pr-1">
                                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                                          <FastForward className="w-3.5 h-3.5 text-amber-400" />
                                          <span>Otomatik İntro Atla</span>
                                        </div>
                                        <div className="text-[10px] text-zinc-400 mt-0.5">
                                          İntro başladığında doğrudan atlar
                                        </div>
                                      </div>
                                      <div
                                        className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                                          autoSkipIntro ? 'bg-[#E50914]' : 'bg-zinc-700'
                                        }`}
                                      >
                                        <div
                                          className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                                            autoSkipIntro ? 'translate-x-4' : 'translate-x-0'
                                          }`}
                                        />
                                      </div>
                                    </div>

                                    {!isMovie && (
                                      <div
                                        onClick={toggleAutoNext}
                                        className="w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-3 hover:bg-white/5 cursor-pointer transition-colors"
                                      >
                                        <div className="min-w-0 pr-1">
                                          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                                            <NetflixNextEpIcon className="w-3.5 h-3.5 text-cyan-400" />
                                            <span>Otomatik Sonraki Bölüm</span>
                                          </div>
                                          <div className="text-[10px] text-zinc-400 mt-0.5">
                                            Outroda 3sn geri sayıp geçer
                                          </div>
                                        </div>
                                        <div
                                          className={`w-9 h-5 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                                            autoNextEnabled ? 'bg-[#E50914]' : 'bg-zinc-700'
                                          }`}
                                        >
                                          <div
                                            className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                                              autoNextEnabled ? 'translate-x-4' : 'translate-x-0'
                                            }`}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </>
                        )}

                        {/* Google Cast / TV Yansıt Butonu: Titremeyen stabil konteyner & GPU hızlandırmalı ikon ölçekleme */}
                        <button
                          type="button"
                          onClick={handleCastPrompt}
                          aria-label={isCasting ? "TV'ye Yansıtılıyor" : "TV'ye Yansıt (Chromecast)"}
                          title={isCasting ? "TV'ye Yansıtılıyor" : "TV'ye Yansıt (Chromecast)"}
                          className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-200 group/cast cursor-pointer shrink-0 ${
                            isCasting
                              ? 'text-sky-400 drop-shadow-[0_0_8px_rgba(56,189,248,0.6)] animate-pulse'
                              : 'text-white/90 hover:text-white'
                          }`}
                        >
                          <CastIcon className="w-5 h-5 group-hover/cast:scale-110 transition-transform duration-200 ease-out will-change-transform transform-gpu" />
                        </button>

                        {/* Tam Ekran Butonu: Titremeyen stabil konteyner & GPU hızlandırmalı ikon ölçekleme */}
                        <button
                          type="button"
                          onClick={toggleFullscreen}
                          aria-label={isFullscreen ? 'Tam Ekrandan Çık (F)' : 'Tam Ekran (F)'}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-200 group/fs text-white/90 hover:text-white cursor-pointer shrink-0"
                        >
                          <div className="w-5 h-5 flex items-center justify-center group-hover/fs:scale-110 transition-transform duration-200 ease-out will-change-transform transform-gpu">
                            {isFullscreen ? (
                              <Minimize className="w-5 h-5" />
                            ) : (
                              <Maximize className="w-5 h-5" />
                            )}
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================
               FLOATING ACTION LAYER: Skip Intro & Next Episode (Countdown Card / Skip Outro)
               Positioned independently from showOverlay so it ALWAYS stays 100% visible
               Smoothly transitions between bottom-24 (HUD open) and bottom-8 (HUD hidden)
               ================================================================ */}
            {!isScreenLocked &&
              !isTrailerMode &&
              (isInsideIntro ||
                shouldShowCountdown ||
                (isInsideOutro && !isMovie && Boolean(nextEp))) && (
                <div
                  data-netflix-control="true"
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute z-40 pointer-events-auto transition-all duration-300 ease-out select-none ${
                    showOverlay
                      ? 'bottom-24 sm:bottom-28 right-4 sm:right-8'
                      : 'bottom-8 sm:bottom-10 right-6 sm:right-8'
                  }`}
                >
                  {/* 1. Skip Intro Floating Buttons */}
                  {isInsideIntro && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSkipIntro}
                        className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-white hover:bg-white/90 text-black font-bold text-xs sm:text-sm tracking-wide shadow-2xl transition-all active:scale-95 cursor-pointer flex items-center gap-2 border border-white/40 hover:shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                      >
                        <FastForward className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
                        <span>İntroyu Atla</span>
                        <span className="text-[10px] text-black/60 hidden sm:inline font-mono">
                          (S)
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={toggleAutoSkipIntro}
                        title={
                          autoSkipIntro
                            ? 'Otomatik İntro Atlama: Açık (Kapatmak için tıkla)'
                            : 'Otomatik İntro Atlama: Kapalı (Açmak için tıkla)'
                        }
                        className={`px-2.5 py-1.5 sm:py-2 rounded-xl text-xs font-semibold tracking-wide shadow-xl transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 border backdrop-blur-md ${
                          autoSkipIntro
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
                            : 'bg-black/70 text-white/75 border-white/20 hover:text-white hover:bg-black/90'
                        }`}
                      >
                        <Sparkles
                          className={`w-3.5 h-3.5 ${
                            autoSkipIntro ? 'text-emerald-400' : 'text-zinc-400'
                          }`}
                        />
                        <span className="hidden sm:inline">Otomatik:</span>
                        <span>{autoSkipIntro ? 'Açık' : 'Kapalı'}</span>
                      </button>
                    </div>
                  )}

                  {/* 2. Next Episode Countdown Card */}
                  {!isInsideIntro && shouldShowCountdown && nextEp && (() => {
                    const nextEpKey = `${media.id}_s${nextEp.season_number || currentSeason}_e${nextEp.episode_number}`;
                    const cachedThumb = episodePreviewCache.get(nextEpKey);
                    const rawThumb =
                      cachedThumb ||
                      (nextEp as any).still_path ||
                      (nextEp as any).thumbnail ||
                      (nextEp as any).still_url ||
                      fallbackBackdropUrl ||
                      media.backdrop_image ||
                      media.cover_image ||
                      (media as any).poster_image;
                    const nextEpThumbnail = rawThumb
                      ? rawThumb.startsWith('data:')
                        ? rawThumb
                        : getProxiedImageUrl(rawThumb, media.title)
                      : '';

                    return (
                      <div className="w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-2xl bg-zinc-950/95 backdrop-blur-xl border border-white/15 p-3.5 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3">
                          {/* Thumbnail */}
                          <div className="relative w-24 sm:w-28 aspect-video rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-white/10 shadow-inner">
                            {nextEpThumbnail ? (
                              <img
                                src={nextEpThumbnail}
                                alt={`Bölüm ${nextEp.episode_number}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-white/40">
                                <Film className="w-6 h-6" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <div className="w-7 h-7 rounded-full bg-white/25 backdrop-blur-sm border border-white/40 flex items-center justify-center shadow-lg">
                                <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />
                              </div>
                            </div>
                            <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[9px] font-bold text-white/90">
                              {nextEp.episode_number}. Bölüm
                            </div>
                          </div>

                          {/* Title & Countdown Progress */}
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[#E50914] flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#E50914] animate-ping" />
                              <span>SIRADAKİ BÖLÜM</span>
                            </div>
                            <div className="text-xs sm:text-sm font-bold text-white truncate mt-0.5">
                              {nextEp.season_number && nextEp.season_number > 1
                                ? `${nextEp.season_number}. Sezon `
                                : ''}
                              {nextEp.episode_number}. Bölüm
                              {nextEp.episode_name &&
                              !/^\d+$/.test(nextEp.episode_name.trim())
                                ? ` • ${cleanEpisodeName(nextEp.episode_name)}`
                                : ''}
                            </div>
                            <div className="text-[11px] text-zinc-300 flex items-center gap-1.5 mt-1">
                              <Clock className="w-3 h-3 text-red-500 animate-pulse shrink-0" />
                              <span>
                                <strong className="text-white font-bold">
                                  {countdownRemaining}
                                </strong>{' '}
                                saniye içinde başlıyor...
                              </span>
                            </div>
                            <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden mt-1.5">
                              <div
                                className="h-full bg-gradient-to-r from-red-600 via-[#E50914] to-red-400 rounded-full transition-all duration-1000 ease-linear"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    Math.max(0, ((3 - countdownRemaining) / 3) * 100)
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                          <button
                            type="button"
                            onClick={() => {
                              if (countdownTimerRef.current) {
                                clearInterval(countdownTimerRef.current);
                                countdownTimerRef.current = null;
                              }
                              if (!hasTriggeredNextRef.current) {
                                hasTriggeredNextRef.current = true;
                                handleNextEpisodeRef.current();
                              }
                            }}
                            className="flex-1 py-1.5 px-3 rounded-xl bg-white hover:bg-white/90 active:scale-95 text-black font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
                          >
                            <NetflixNextEpIcon className="w-3.5 h-3.5" />
                            <span>Hemen Geç</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (countdownTimerRef.current) {
                                clearInterval(countdownTimerRef.current);
                                countdownTimerRef.current = null;
                              }
                              setCancelledAutoNextForEp(true);
                              triggerHudToast('Otomatik geçiş iptal edildi');
                            }}
                            className="py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white/90 hover:text-white font-medium text-xs flex items-center justify-center gap-1 transition-all border border-white/10 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>İptal</span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. Manual Skip Outro Button (when countdown is cancelled or autoNext is disabled) */}
                  {!isInsideIntro &&
                    !shouldShowCountdown &&
                    isInsideOutro &&
                    !isMovie &&
                    nextEp && (
                      <button
                        type="button"
                        onClick={handleSkipOutro}
                        className="px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-bold text-xs sm:text-sm tracking-wide shadow-2xl transition-all active:scale-95 cursor-pointer flex items-center gap-2 border border-cyan-300/40 hover:shadow-[0_0_20px_rgba(34,211,238,0.4)]"
                      >
                        <NetflixNextEpIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        <span>Sonraki Bölüme Geç</span>
                        <span className="text-[10px] text-black/60 hidden sm:inline font-mono">
                          (N)
                        </span>
                      </button>
                    )}
                </div>
              )}

            {/* ================================================================
               IN-PLAYER NETFLIX POPOVERS (Speed, Floating Episodes, Sources)
               ================================================================ */}
            <AnimatePresence>
              {/* A. AUTHENTIC NETFLIX PLAYBACK SPEED POPOVER */}
              {!isMobileInline && activePanel === 'speed' && (() => {
                const currentRate = playbackRate || 1;
                let activeIndex = SPEED_RATES.findIndex((r) => r.value === currentRate);
                if (activeIndex === -1) {
                  let minDiff = Infinity;
                  let closestIdx = 3;
                  SPEED_RATES.forEach((r, idx) => {
                    const diff = Math.abs(r.value - currentRate);
                    if (diff < minDiff) {
                      minDiff = diff;
                      closestIdx = idx;
                    }
                  });
                  activeIndex = closestIdx;
                }
                const activePercent = (activeIndex / (SPEED_RATES.length - 1)) * 100;

                const updateSpeedFromX = (clientX: number, trackEl: HTMLElement) => {
                  const rect = trackEl.getBoundingClientRect();
                  const rawPct = (clientX - rect.left) / Math.max(1, rect.width);
                  const clamped = Math.max(0, Math.min(1, rawPct));
                  const closestIdx = Math.round(clamped * (SPEED_RATES.length - 1));
                  const targetRate = SPEED_RATES[closestIdx].value;
                  applySpeed(targetRate);
                };

                const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {}
                  updateSpeedFromX(e.clientX, e.currentTarget);
                };

                const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
                  if (e.buttons === 0) return;
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  updateSpeedFromX(e.clientX, e.currentTarget);
                };

                const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    }
                  } catch {}
                };

                return (
                  <motion.div
                    key="panel-speed"
                    initial={{ opacity: 0, scale: 0.94, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, y: 12 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    data-netflix-control="true"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 sm:left-6 md:left-8 sm:translate-x-0 z-50 w-[90vw] sm:w-[480px] max-w-[500px] p-3.5 sm:p-6 rounded-xl bg-[#222222] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.9)] select-none"
                  >
                    {/* Header: Title + Close Button */}
                    <div className="flex items-center justify-between mb-5 sm:mb-8">
                      <div className="text-white font-bold text-sm sm:text-[17px] tracking-normal">
                        Oynatma Hızı
                      </div>
                      <button
                        type="button"
                        onClick={() => setActivePanel(null)}
                        className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
                        aria-label="Kapat"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Horizontal Segmented Track with Equal Spacing */}
                    <div
                      className="relative mx-3 sm:mx-6 h-8 flex items-center cursor-pointer select-none touch-none mb-6"
                      onPointerDown={handleTrackPointerDown}
                      onPointerMove={handleTrackPointerMove}
                      onPointerUp={handleTrackPointerUp}
                      onPointerCancel={handleTrackPointerUp}
                    >
                      {/* Gray Connecting Track Line */}
                      <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[2px] bg-[#666666] rounded-full pointer-events-none" />

                      {/* Active Indicator: Gray-Bordered Ring with White Center Dot */}
                      <div
                        style={{ left: `${activePercent}%` }}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-[#a3a3a3] bg-[#222222] shadow-md flex items-center justify-center transition-[left] duration-150 ease-out pointer-events-none z-10"
                      >
                        <div className="w-2.5 h-2.5 rounded-full bg-white" />
                      </div>

                      {/* Dots and Labels */}
                      {SPEED_RATES.map((item, idx) => {
                        const pct = (idx / (SPEED_RATES.length - 1)) * 100;
                        const isSelected = idx === activeIndex;

                        return (
                          <div
                            key={item.value}
                            style={{ left: `${pct}%` }}
                            onClick={(e) => {
                              e.stopPropagation();
                              applySpeed(item.value);
                            }}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center cursor-pointer group py-3"
                          >
                            {/* Unselected small circle */}
                            <div
                              className={`w-2 sm:w-2.5 h-2 sm:h-2.5 rounded-full transition-[transform,opacity,background-color] duration-150 ${
                                isSelected
                                  ? 'opacity-0 scale-50'
                                  : 'bg-[#d6d6d6] group-hover:scale-125 group-hover:bg-white'
                              }`}
                            />

                            {/* Label underneath */}
                            <span
                              className={`absolute top-7 whitespace-nowrap transition-colors duration-150 select-none ${
                                isSelected
                                  ? 'text-white font-bold text-[11px] sm:text-xs md:text-[13px]'
                                  : 'text-[#a3a3a3] font-medium text-[11px] sm:text-xs md:text-[13px] group-hover:text-white'
                              }`}
                            >
                              {item.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })()}

              {/* B. AUTHENTIC NETFLIX FLOATING EPISODE POPOVER (Mobile / Touch Viewport Centered) */}
              {isTouchDevice && activePanel === 'episodes' && (
                <div className="fixed sm:absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 z-50">
                  <NetflixEpisodePopover
                    media={media}
                    episodes={episodes}
                    currentSeason={currentSeason}
                    currentEpisode={currentEpisode}
                    seasons={seasons}
                    effectiveTime={effectiveTime}
                    safeDuration={safeDuration}
                    progressMap={progressMap}
                    toggleEpisodeWatched={toggleEpisodeWatched}
                    onSelectEpisode={onSelectEpisode}
                    flushCurrentProgress={flushCurrentProgress}
                    onClose={() => setActivePanel(null)}
                    capturedFrameUrl={capturedFrameUrl}
                    fallbackBackdropUrl={fallbackBackdropUrl}
                    episodePreviewCache={episodePreviewCache}
                  />
                </div>
              )}



              {/* D. NETFLIX AUDIO & SUBTITLES POPOVER (Matched to Reference Screenshots) */}
              {!isMobileInline && activePanel === 'audio_subtitles' && (
                <motion.div
                  key="panel-audio-subtitles"
                  initial={{ opacity: 0, scale: 0.95, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 12 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  data-netflix-control="true"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-14 sm:bottom-20 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md sm:max-w-xl p-4 sm:p-6 rounded-xl bg-[#181818]/98 backdrop-blur-sm border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.95)] max-h-[85%] overflow-y-auto custom-scrollbar select-none"
                >
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
                    <div className="text-white font-bold text-sm sm:text-base tracking-wide">
                      Ses & Altyazı
                    </div>
                    <button
                      type="button"
                      onClick={() => setActivePanel(null)}
                      className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
                      aria-label="Kapat"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:gap-6">
                    {/* LEFT COLUMN: AUDIO */}
                    <div className="space-y-2.5">
                      <div className="text-white font-bold text-sm sm:text-base tracking-wide">
                        Seslendirme / Dublaj
                      </div>
                      <div className="space-y-0.5">
                        {audioTracks.length > 0 ? (
                          audioTracks.map((track) => {
                            const isSelected = currentAudioTrackId === track.id;
                            return (
                              <button
                                key={`audio-${track.id}`}
                                type="button"
                                onClick={() => switchAudioTrack(track.id)}
                                className={`w-full px-2.5 py-1.5 rounded-md text-left text-xs sm:text-sm flex items-center gap-2.5 cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'text-white font-medium hover:bg-white/10'
                                    : 'text-zinc-400 font-medium hover:text-white hover:bg-white/10'
                                }`}
                              >
                                {isSelected ? (
                                  <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                                ) : (
                                  <div className="w-4 h-4 shrink-0" />
                                )}
                                <span className="truncate">{track.label}</span>
                              </button>
                            );
                          })
                        ) : (
                          <button
                            type="button"
                            className="w-full px-2.5 py-1.5 rounded-md text-left text-xs sm:text-sm flex items-center gap-2.5 cursor-default text-white font-medium hover:bg-white/10"
                          >
                            <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                            <span className="truncate">Orijinal [Varsayılan]</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* RIGHT COLUMN: SUBTITLES */}
                    <div className="space-y-2.5 border-l border-white/10 pl-3 sm:pl-6">
                      <div className="text-white font-bold text-sm sm:text-base tracking-wide">
                        Altyazı
                      </div>
                      <div className="space-y-0.5">
                        {/* Off option */}
                        <button
                          type="button"
                          onClick={() => handleSelectSubtitle('off')}
                          className={`w-full px-2.5 py-1.5 rounded-md text-left text-xs sm:text-sm flex items-center gap-2.5 cursor-pointer transition-colors ${
                            selectedSubtitle === 'off'
                              ? 'text-white font-medium hover:bg-white/10'
                              : 'text-zinc-400 font-medium hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {selectedSubtitle === 'off' ? (
                            <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                          ) : (
                            <div className="w-4 h-4 shrink-0" />
                          )}
                          <span>Kapalı</span>
                        </button>

                        {/* Subtitle track list */}
                        {subtitles.map((sub, subIdx) => {
                          const isSelected = selectedSubtitle === sub.label;
                          return (
                            <button
                              key={`sub-${sub.label}-${subIdx}`}
                              type="button"
                              onClick={() => handleSelectSubtitle(sub.label)}
                              className={`w-full px-2.5 py-1.5 rounded-md text-left text-xs sm:text-sm flex items-center gap-2.5 cursor-pointer transition-colors ${
                                isSelected
                                  ? 'text-white font-medium hover:bg-white/10'
                                  : 'text-zinc-400 font-medium hover:text-white hover:bg-white/10'
                              }`}
                            >
                              {isSelected ? (
                                <Check className="w-4 h-4 text-white stroke-[2.5] shrink-0" />
                              ) : (
                                <div className="w-4 h-4 shrink-0" />
                              )}
                              <span className="truncate">{sub.label}</span>
                            </button>
                          );
                        })}

                        {subtitles.length === 0 && (
                          <div className="text-xs text-zinc-500 italic py-1 px-2.5">
                            Harici altyazı yok
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* ==================================================================
             LAYER 2: UNIVERSAL IFRAME SHELL WITH NETFLIX TOP HUD
             ================================================================== */
          <div className="relative w-full h-full bg-black">
            {isResolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/85 z-20">
                <div className="w-12 h-12 rounded-full border-4 border-white/15 border-t-[#E50914] animate-spin" />
              </div>
            )}

            {/* Netflix Top Bar in Fullscreen for Iframe Mode */}
            {isFullscreen && (
              <div
                className={`netflix-hud-layer absolute top-0 left-0 right-0 z-40 px-6 py-4 bg-gradient-to-b from-black/75 via-black/20 to-transparent flex items-center justify-between gap-4 ${
                  showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-200 group/fsBack text-white cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5 group-hover/fsBack:scale-110 transition-transform duration-200 ease-out will-change-transform transform-gpu" />
                  </button>
                  <span className="text-sm sm:text-base font-semibold text-white">
                    {episodeDisplayTitle}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {(() => {
                    const isYt =
                      Boolean(
                        streamUrl &&
                          (streamUrl.includes('youtube.com') ||
                            streamUrl.includes('youtu.be') ||
                            streamUrl.includes('youtube-nocookie.com'))
                      ) || activeSource?.provider === 'youtube';
                    let ytWatch = '';
                    if (isYt && streamUrl) {
                      const vMatch = streamUrl.match(/\/embed\/([a-zA-Z0-9_\-]+)/) || streamUrl.match(/[?&]v=([a-zA-Z0-9_\-]+)/);
                      if (vMatch) ytWatch = `https://www.youtube.com/watch?v=${vMatch[1]}`;
                    }
                    if (!isYt || !ytWatch) return null;
                    return (
                      <a
                        href={ytWatch}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold transition-[transform,background-color] duration-150 shadow-lg hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                        title="YouTube'da Yeni Sekmede Aç"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>YouTube'da Aç</span>
                      </a>
                    );
                  })()}
                  {!isMovie && nextEp && (
                    <button
                      type="button"
                      onClick={handleNextEpisode}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-white text-black text-xs font-bold cursor-pointer"
                    >
                      <NetflixNextEpIcon className="w-4 h-4" />
                      <span>Sonraki Bölüm</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all duration-200 group/fsMin text-white cursor-pointer"
                  >
                    <Minimize className="w-5 h-5 group-hover/fsMin:scale-110 transition-transform duration-200 ease-out will-change-transform transform-gpu" />
                  </button>
                </div>
              </div>
            )}

            {streamUrl ? (
              <>

                {(() => {
                  const isCurrentYouTube =
                    Boolean(
                      streamUrl &&
                        (streamUrl.includes('youtube.com') ||
                          streamUrl.includes('youtu.be') ||
                          streamUrl.includes('youtube-nocookie.com'))
                    ) || activeSource?.provider === 'youtube';

                  let ytWatchUrl = '';
                  if (isCurrentYouTube && streamUrl) {
                    const vMatch = streamUrl.match(/\/embed\/([a-zA-Z0-9_\-]+)/) || streamUrl.match(/[?&]v=([a-zA-Z0-9_\-]+)/);
                    if (vMatch) ytWatchUrl = `https://www.youtube.com/watch?v=${vMatch[1]}`;
                  }

                  const nonYtSources = filteredSources.filter(
                    (s) =>
                      !s.direct_url?.includes('youtube.com') &&
                      !s.direct_url?.includes('youtu.be') &&
                      s.provider !== 'youtube'
                  );

                  if (isCurrentYouTube && !forceEmbedYouTube) {
                    return (
                      <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-zinc-950 via-[#140608] to-black p-2 sm:p-6 text-center select-none overflow-y-auto overflow-x-hidden no-scrollbar">
                        {/* Soft Ambient Aura */}
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-600/20 via-transparent to-transparent pointer-events-none" />

                        <div className="relative z-10 max-w-md mx-auto flex flex-col items-center gap-1.5 sm:gap-4 my-auto py-1 px-2">
                          <div className="w-8 h-8 sm:w-16 sm:h-16 rounded-lg sm:rounded-2xl bg-red-600/15 border border-red-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.25)] shrink-0">
                            <svg className="w-4 h-4 sm:w-8 sm:h-8 fill-[#FF0000]" viewBox="0 0 24 24">
                              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                            </svg>
                          </div>

                          <div className="space-y-0.5 sm:space-y-1.5 max-w-full">
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[9px] sm:text-[11px] font-bold tracking-wider uppercase">
                              YouTube Resmi Yayını
                            </div>
                            <h2 className="text-xs sm:text-lg md:text-xl font-extrabold text-white tracking-tight leading-snug line-clamp-1">
                              {isMovie ? media?.title : `${media?.title} · ${currentSeason}. Sezon ${currentEpisode}. Bölüm`}
                            </h2>
                            <p className="text-[10px] sm:text-xs text-zinc-400 max-w-sm leading-tight line-clamp-2 px-1">
                              {isMovie
                                ? 'Bu filmin yayıncısı harici sitelerde gömülü oynatmayı kısıtladığı için doğrudan YouTube üzerinden izleyebilirsiniz.'
                                : 'Bu bölümün yayıncısı harici sitelerde gömülü oynatmayı kısıtladığı için doğrudan YouTube üzerinden izleyebilirsiniz.'}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2.5 pt-0.5 sm:pt-1">
                            {ytWatchUrl && (
                              <a
                                href={ytWatchUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-4 py-1.5 sm:px-6 sm:py-2.5 rounded-full bg-[#E50914] hover:bg-[#b80710] text-white font-bold text-[11px] sm:text-xs tracking-wide shadow-[0_0_25px_rgba(229,9,20,0.45)] hover:scale-105 active:scale-95 transition-[transform,background-color] duration-150 cursor-pointer"
                              >
                                <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-white" />
                                <span>YouTube'da İzle</span>
                                <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3 opacity-80" />
                              </a>
                            )}

                            {nonYtSources.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextIdx = filteredSources.findIndex((s) => nonYtSources.includes(s));
                                  if (nextIdx !== -1) setSelectedSourceIdx(nextIdx);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/15 hover:bg-white/25 text-white font-medium text-[10px] sm:text-xs border border-white/10 transition-colors duration-150 cursor-pointer"
                              >
                                <span>Alternatif Kaynak ({nonYtSources.length})</span>
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => setForceEmbedYouTube(true)}
                            className="text-[9px] sm:text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-4 transition-colors cursor-pointer"
                          >
                            Gömülü oynatıcıyı yine de açmayı dene
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (isUnframableUrl(streamUrl)) {
                    return (
                      <div className="relative w-full h-full flex flex-col items-center justify-center bg-zinc-950/95 text-center p-6 select-none z-10">
                        <div className="w-14 h-14 rounded-full bg-red-600/15 border border-red-500/30 flex items-center justify-center mb-3">
                          <AlertTriangle className="w-7 h-7 text-red-500" />
                        </div>
                        <h2 className="text-lg font-bold text-white mb-2">Bu Kaynak Gömülü Oynatılamıyor</h2>
                        <p className="text-xs text-zinc-400 max-w-sm mb-5 leading-relaxed">
                          Yayıncı bu içeriğin harici sitelere doğrudan yerleştirilmesini engellemiştir. Lütfen alternatif bir kaynak seçiniz.
                        </p>
                        <div className="flex items-center gap-2.5">
                          {filteredSources.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextIdx = (selectedSourceIdx + 1) % filteredSources.length;
                                setSelectedSourceIdx(nextIdx);
                              }}
                              className="px-4 py-2 rounded-full bg-[#E50914] hover:bg-[#b80710] text-white font-semibold text-xs transition-colors cursor-pointer"
                            >
                              Sıradaki Kaynağa Geç
                            </button>
                          )}
                          {activeSourceUrl && (
                            <a
                              href={activeSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                            >
                              <span>Yeni Sekmede Aç</span>
                              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                      {isCurrentYouTube && ytWatchUrl && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto bg-black/90 border border-white/15 rounded-full px-4 py-1.5 flex items-center gap-2 text-xs text-zinc-300 shadow-2xl">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>Yayıncı harici oynatmayı kısıtladıysa:</span>
                          <a
                            href={ytWatchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#E50914] hover:text-[#ff3b47] font-semibold underline underline-offset-2 flex items-center gap-1"
                          >
                            YouTube'da Doğrudan İzle <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => setForceEmbedYouTube(false)}
                            className="ml-2 text-zinc-400 hover:text-white underline text-[11px]"
                          >
                            Özel Ekrana Dön
                          </button>
                        </div>
                      )}
                      <iframe
                        ref={iframeRef}
                        key={streamUrl}
                        src={streamUrl}
                        allowFullScreen
                        onLoad={() => {
                          const win = iframeRef.current?.contentWindow;
                          if (!win) return;
                          try {
                            win.postMessage(
                              JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
                              '*'
                            );
                            win.postMessage(
                              JSON.stringify({
                                event: 'command',
                                func: 'addEventListener',
                                args: ['onStateChange'],
                                id: 1,
                                channel: 'widget',
                              }),
                              '*'
                            );
                            win.postMessage(
                              JSON.stringify({
                                context: 'player.js',
                                method: 'addEventListener',
                                value: 'timeupdate',
                              }),
                              '*'
                            );
                            win.postMessage(
                              JSON.stringify({
                                context: 'player.js',
                                method: 'addEventListener',
                                value: 'ended',
                              }),
                              '*'
                            );
                          } catch {}
                        }}
                        allow={
                          isCurrentYouTube
                            ? 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                            : 'autoplay; fullscreen; encrypted-media; picture-in-picture'
                        }
                        referrerPolicy={
                          isCurrentYouTube ? 'strict-origin-when-cross-origin' : 'no-referrer'
                        }
                        className="w-full h-full border-0"
                      />
                    </div>
                  );
                })()}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black">
                <div className="w-12 h-12 rounded-full border-4 border-white/15 border-t-[#E50914] animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================================================================
         MOBILE INLINE BOTTOM SHEET PORTAL
         Rendered directly to document.body when !isFullscreen on mobile
         ================================================================ */}
      {isMounted && isMobileInline && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {(activePanel === 'speed' ||
            activePanel === 'audio_subtitles' ||
            activePanel === 'playback_settings') && (
            <>
              {/* Semi-transparent Dimmed Backdrop */}
              <motion.div
                key="mobile-sheet-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setActivePanel(null)}
                className="fixed inset-0 z-[99998] bg-black/60 backdrop-blur-sm touch-none"
              />

              {/* Bottom Sheet Drawer */}
              <motion.div
                key={`mobile-sheet-${activePanel}`}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="fixed inset-x-0 bottom-0 z-[99999] rounded-t-3xl bg-[#181818]/98 backdrop-blur-md border-t border-white/15 px-4 pt-3 pb-6 max-h-[75vh] flex flex-col shadow-[0_-12px_40px_rgba(0,0,0,0.85)] select-none"
              >
                {/* Pull Handle */}
                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-3 shrink-0" />

                {/* Header */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 shrink-0">
                  <div className="text-white font-bold text-sm tracking-wide flex items-center gap-2">
                    {activePanel === 'speed' && (
                      <>
                        <NetflixSpeedIcon className="w-4 h-4 text-[#E50914]" />
                        <span>Oynatma Hızı</span>
                        <span className="text-xs font-normal text-white/50">({playbackRate}x)</span>
                      </>
                    )}
                    {activePanel === 'audio_subtitles' && (
                      <>
                        <NetflixAudioSubtitleIcon className="w-4 h-4 text-[#E50914]" />
                        <span>Ses ve Altyazı</span>
                      </>
                    )}
                    {activePanel === 'playback_settings' && (
                      <>
                        <Settings className="w-4 h-4 text-[#E50914]" />
                        <span>Oynatma Tercihleri</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="w-8 h-8 rounded-full bg-white/10 active:bg-white/20 flex items-center justify-center text-white/80 active:text-white cursor-pointer"
                    aria-label="Kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Panel 1: Playback Speed Quick Buttons */}
                {activePanel === 'speed' && (
                  <div className="py-2 space-y-4">
                    <div className="grid grid-cols-3 gap-2.5">
                      {[
                        { value: 0.5, label: '0.5x' },
                        { value: 0.75, label: '0.75x' },
                        { value: 1, label: '1x (Normal)' },
                        { value: 1.25, label: '1.25x' },
                        { value: 1.5, label: '1.5x' },
                        { value: 2, label: '2x' },
                      ].map((item) => {
                        const isSelected = Math.abs(playbackRate - item.value) < 0.05;
                        return (
                          <button
                            key={`mobile-speed-${item.value}`}
                            type="button"
                            onClick={() => {
                              applySpeed(item.value);
                              setActivePanel(null);
                            }}
                            className={`min-h-[44px] px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#E50914] text-white shadow-lg shadow-[#E50914]/30'
                                : 'bg-white/5 text-zinc-300 hover:bg-white/10 active:bg-white/15'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Panel 2: Audio & Subtitles Two-Column Side-by-Side */}
                {activePanel === 'audio_subtitles' && (
                  <div className="grid grid-cols-2 gap-3 min-h-0 overflow-y-auto custom-scrollbar py-1">
                    {/* AUDIO COLUMN */}
                    <div className="space-y-1.5">
                      <div className="text-white/60 font-semibold text-[11px] uppercase tracking-wider px-1">
                        Seslendirme
                      </div>
                      <div className="space-y-1">
                        {audioTracks.length > 0 ? (
                          audioTracks.map((track) => {
                            const isSelected = currentAudioTrackId === track.id;
                            return (
                              <button
                                key={`sheet-audio-${track.id}`}
                                type="button"
                                onClick={() => switchAudioTrack(track.id)}
                                className={`w-full min-h-[42px] px-2.5 py-1.5 rounded-xl text-left text-xs flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-white/10 text-white font-semibold'
                                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">{track.label}</span>
                                {isSelected && (
                                  <Check className="w-3.5 h-3.5 text-white stroke-[2.5] shrink-0" />
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <button
                            type="button"
                            className="w-full min-h-[42px] px-2.5 py-1.5 rounded-xl text-left text-xs flex items-center justify-between gap-1.5 cursor-default bg-white/10 text-white font-semibold"
                          >
                            <span className="truncate">Orijinal [Varsayılan]</span>
                            <Check className="w-3.5 h-3.5 text-white stroke-[2.5] shrink-0" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* SUBTITLE COLUMN */}
                    <div className="space-y-1.5 border-l border-white/10 pl-3">
                      <div className="text-white/60 font-semibold text-[11px] uppercase tracking-wider px-1">
                        Altyazı
                      </div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => handleSelectSubtitle('off')}
                          className={`w-full min-h-[42px] px-2.5 py-1.5 rounded-xl text-left text-xs flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                            selectedSubtitle === 'off'
                              ? 'bg-white/10 text-white font-semibold'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <span>Kapalı</span>
                          {selectedSubtitle === 'off' && (
                            <Check className="w-3.5 h-3.5 text-white stroke-[2.5] shrink-0" />
                          )}
                        </button>

                        {subtitles.map((sub, idx) => {
                          const isSelected = selectedSubtitle === sub.label;
                          return (
                            <button
                              key={`sheet-sub-${sub.label}-${idx}`}
                              type="button"
                              onClick={() => handleSelectSubtitle(sub.label)}
                              className={`w-full min-h-[42px] px-2.5 py-1.5 rounded-xl text-left text-xs flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-white/10 text-white font-semibold'
                                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <span className="truncate">{sub.label}</span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-white stroke-[2.5] shrink-0" />
                              )}
                            </button>
                          );
                        })}

                        {subtitles.length === 0 && (
                          <div className="text-[11px] text-zinc-500 italic py-2 px-1">
                            Harici altyazı yok
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Panel 3: Playback Settings */}
                {activePanel === 'playback_settings' && (
                  <div className="space-y-2.5 py-1">
                    <div
                      onClick={toggleAutoSkipIntro}
                      className="w-full p-3.5 rounded-2xl bg-white/5 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/10 active:bg-white/15 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          <FastForward className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Otomatik İntro Atla</span>
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5">
                          İntro başladığında doğrudan atlar
                        </div>
                      </div>
                      <div
                        className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                          autoSkipIntro ? 'bg-[#E50914]' : 'bg-zinc-700'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                            autoSkipIntro ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </div>

                    {!isMovie && (
                      <div
                        onClick={toggleAutoNext}
                        className="w-full p-3.5 rounded-2xl bg-white/5 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/10 active:bg-white/15 transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="text-sm font-semibold text-white flex items-center gap-2">
                            <NetflixNextEpIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                            <span>Otomatik Sonraki Bölüm</span>
                          </div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            Outroda 3sn geri sayıp sonrakine geçer
                          </div>
                        </div>
                        <div
                          className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center ${
                            autoNextEnabled ? 'bg-[#E50914]' : 'bg-zinc-700'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                              autoNextEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
