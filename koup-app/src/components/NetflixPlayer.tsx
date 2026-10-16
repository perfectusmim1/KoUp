'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import Link from 'next/link';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipForward,
  SkipBack,
  Layers,
  ListVideo,
  Users,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Lightbulb,
  Clock,
  Subtitles,
  Settings,
  X,
} from 'lucide-react';
import {
  MediaItem,
  EpisodeData,
  EpisodeSource,
  CastMember,
  getProxiedImageUrl,
  supabase,
} from '@/lib/supabase';
import CustomSelect from '@/components/CustomSelect';
import { useKoUp } from '@/context/KoUpContext';

interface NetflixPlayerProps {
  media: MediaItem;
  episodes: EpisodeData[];
  currentSeason: number;
  currentEpisode: number;
  onSelectEpisode: (season: number, episode: number) => void;
  cast?: CastMember[];
}

export default function NetflixPlayer({
  media,
  episodes,
  currentSeason,
  currentEpisode,
  onSelectEpisode,
  cast = [],
}: NetflixPlayerProps) {
  const {
    progressMap,
    updateEpisodeProgress,
    toggleEpisodeWatched,
    pushNotification,
  } = useKoUp();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  const currentEpObj =
    episodes.find(
      (e) =>
        e.season_number === currentSeason && e.episode_number === currentEpisode
    ) || episodes[0];

  const availableSources: EpisodeSource[] = currentEpObj?.sources || [];

  // Fansub filter
  const uniqueFansubs = Array.from(
    new Set(availableSources.map((s) => s.fansub).filter(Boolean))
  ) as string[];
  const [selectedFansub, setSelectedFansub] = useState<string>('all');

  const filteredSources =
    selectedFansub === 'all'
      ? availableSources
      : availableSources.filter((s) => s.fansub === selectedFansub);

  const [selectedSourceIdx, setSelectedSourceIdx] = useState(0);
  const activeSource: EpisodeSource | undefined =
    filteredSources[selectedSourceIdx] || availableSources[0];

  // Stream resolution state (for Native HLS / MP4 / Tau-Video vs Iframe)
  const [resolvedMode, setResolvedMode] = useState<
    'native_hls' | 'native_mp4' | 'iframe'
  >('iframe');
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [qualities, setQualities] = useState<Array<{ label: string; url: string }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('Auto');
  const [isResolving, setIsResolving] = useState(false);

  // Native video state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cinemaLightsOff, setCinemaLightsOff] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  // In-player drawers (Sources, Episodes, InSight Cast, Report Issue)
  const [activeDrawer, setActiveDrawer] = useState<
    null | 'sources' | 'episodes' | 'insight' | 'report'
  >(null);
  const [drawerSeason, setDrawerSeason] = useState(currentSeason);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  // Scheduled Episode Live Countdown
  const [countdownText, setCountdownText] = useState('14 saat, 28 dakika, 19 saniye');

  // Issue Report state
  const [reportReason, setReportReason] = useState('Video Açılmıyor / Kırık Kaynak');
  const [reportDetails, setReportDetails] = useState('');

  // Reset source index when episode changes
  useEffect(() => {
    setSelectedSourceIdx(0);
    setSelectedFansub('all');
    setActiveDrawer(null);
    setNextCountdown(null);
    setDrawerSeason(currentSeason);
  }, [currentSeason, currentEpisode]);

  // Resolve active source via /api/resolve-stream
  useEffect(() => {
    if (!activeSource) return;
    let cancelled = false;

    async function resolve() {
      if (!activeSource || !activeSource.direct_url) {
        setResolvedMode('iframe');
        setStreamUrl('');
        return;
      }
      setIsResolving(true);
      try {
        const sourceUrl = activeSource.direct_url;
        const sourceProvider = activeSource.provider || '';
        const params = new URLSearchParams({
          url: sourceUrl,
          provider: sourceProvider,
        });
        const resp = await fetch(`/api/resolve-stream?${params.toString()}`);
        const data = await resp.json();
        if (cancelled) return;

        if (data.mode === 'native_hls' || data.mode === 'native_mp4') {
          setResolvedMode(data.mode);
          setStreamUrl(data.streamUrl);
          setQualities(data.qualities || []);
          setSelectedQuality(data.qualities?.[0]?.label || '1080p');
        } else {
          setResolvedMode('iframe');
          setStreamUrl(sourceUrl);
          setQualities([]);
        }
      } catch {
        if (!cancelled && activeSource?.direct_url) {
          setResolvedMode('iframe');
          setStreamUrl(activeSource.direct_url);
        }
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [activeSource]);

  // Attach HLS.js or direct MP4 when resolvedMode is native
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const savedResume = progressMap[media.id]?.resume_position_sec || 0;

    if (resolvedMode === 'native_hls') {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (savedResume > 15) video.currentTime = savedResume;
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_ev, errData) => {
          if (errData.fatal) {
            // Auto-failover to next working source!
            if (selectedSourceIdx + 1 < filteredSources.length) {
              pushNotification(
                'Otomatik Yedek Kaynağa Geçildi',
                `${activeSource?.source_name} yanıt vermedi, sıradaki kaynağa geçiliyor.`,
                'info'
              );
              setSelectedSourceIdx((idx) => idx + 1);
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
      }
    } else if (resolvedMode === 'native_mp4') {
      video.src = streamUrl;
      if (savedResume > 15) video.currentTime = savedResume;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [resolvedMode, streamUrl]);

  // Listen to postMessage from OK.RU / VK / Dailymotion iframes
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.event === 'ended' && autoNextEnabled) {
          handleNextEpisode();
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [autoNextEnabled, currentSeason, currentEpisode]);

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
          try {
            iframeRef.current.contentWindow?.postMessage(
              JSON.stringify({ event: 'seek', time: sec }),
              '*'
            );
          } catch {}
        }
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    window.addEventListener('koup-seek-player', handleSeekEvent);
    return () => window.removeEventListener('koup-seek-player', handleSeekEvent);
  }, []);

  // Scheduled Episode Live Countdown Timer
  useEffect(() => {
    if (currentEpObj?.status !== 'scheduled' && availableSources.length > 0) return;
    const targetTime = currentEpObj?.scheduled_release_at
      ? new Date(currentEpObj.scheduled_release_at).getTime()
      : Date.now() + 14 * 3600 * 1000 + 25 * 60 * 1000;

    const timer = setInterval(() => {
      const diff = Math.max(0, Math.floor((targetTime - Date.now()) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setCountdownText(`${h} saat, ${m} dakika, ${s} saniye`);
    }, 1000);
    return () => clearInterval(timer);
  }, [currentEpObj, availableSources.length]);

  const triggerControlsVisibility = useCallback(() => {
    setShowOverlay(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (activeDrawer === null) {
        setShowOverlay(false);
      }
    }, 3400);
  }, [activeDrawer]);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard shortcuts (F fullscreen, Space play/pause, ArrowLeft/Right 10s, L Cinema Mode, N Next Episode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setCinemaLightsOff((v) => !v);
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNextEpisode();
      } else if (resolvedMode !== 'iframe' && videoRef.current) {
        if (e.key === ' ') {
          e.preventDefault();
          if (videoRef.current.paused) videoRef.current.play();
          else videoRef.current.pause();
        } else if (e.key === 'ArrowRight') {
          videoRef.current.currentTime += 10;
        } else if (e.key === 'ArrowLeft') {
          videoRef.current.currentTime -= 10;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resolvedMode, currentSeason, currentEpisode]);

  const currentEpIndex = episodes.findIndex(
    (e) =>
      e.season_number === currentSeason && e.episode_number === currentEpisode
  );
  const prevEp = currentEpIndex > 0 ? episodes[currentEpIndex - 1] : null;
  const nextEp =
    currentEpIndex >= 0 && currentEpIndex + 1 < episodes.length
      ? episodes[currentEpIndex + 1]
      : null;

  const handleNextEpisode = () => {
    if (nextEp) {
      toggleEpisodeWatched(media, currentEpisode, false);
      onSelectEpisode(nextEp.season_number, nextEp.episode_number);
    }
  };

  const handlePrevEpisode = () => {
    if (prevEp) {
      onSelectEpisode(prevEp.season_number, prevEp.episode_number);
    }
  };

  const formatTime = (sec: number) => {
    if (!sec || Number.isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const seasonsList = Array.from(
    new Set(episodes.map((e) => e.season_number || 1))
  ).sort((a, b) => a - b);

  const isEpisodeWatched = (
    progressMap[media.id]?.watched_episodes || []
  ).includes(currentEpisode);

  const submitIssueReport = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('issue_reports').insert({
      target_type: 'episode',
      media_id: media.id,
      season_number: currentSeason,
      episode_number: currentEpisode,
      provider_name: activeSource?.provider || 'unknown',
      issue_category: reportReason,
      details: reportDetails || `${activeSource?.source_name} kaynağı kontrol talebi`,
    });
    setActiveDrawer(null);
    setReportDetails('');
    pushNotification(
      'Sorun Bildirimi Alındı',
      '24 Saat Watchdog botu bu bölümü anında yeniden tarama kuyruğuna aldı.',
      'success'
    );
    // Auto-switch to backup source if available
    if (selectedSourceIdx + 1 < filteredSources.length) {
      setSelectedSourceIdx((i) => i + 1);
    }
  };

  return (
    <div className="relative">
      {/* Cinema Lights-Off Backdrop */}
      {cinemaLightsOff && (
        <div
          onClick={() => setCinemaLightsOff(false)}
          className="fixed inset-0 bg-black/95 z-40 transition-opacity duration-500"
        />
      )}

      {/* MAIN UNIFIED KOUP NETFLIX PLAYER CONTAINER */}
      <div
        ref={containerRef}
        onMouseMove={triggerControlsVisibility}
        onClick={triggerControlsVisibility}
        style={
          !isFullscreen
            ? {
                maxWidth: cinemaLightsOff
                  ? 'min(1240px, calc(82vh * 16 / 9))'
                  : 'min(1040px, calc(68vh * 16 / 9))',
              }
            : undefined
        }
        className={`relative mx-auto w-full aspect-video rounded-3xl overflow-hidden bg-black border border-white/15 shadow-[0_30px_90px_rgba(0,0,0,0.95)] select-none transition-all duration-300 ${
          isFullscreen
            ? 'max-w-none rounded-none border-none'
            : cinemaLightsOff
            ? 'z-50 ring-2 ring-white/30'
            : 'z-20'
        }`}
      >
        {/* TOP FLOATING NETFLIX GLASS CONTROL DOCK (WORKS OVER ALL SOURCES & IN FULLSCREEN!) */}
        <div
          className={`absolute top-0 left-0 right-0 z-30 p-3 sm:p-5 bg-gradient-to-b from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${
            showOverlay || activeDrawer !== null
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* Left: Series Title + Season/Episode Badge */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="px-3 py-1 rounded-full bg-white text-black font-mono font-bold text-xs shrink-0 shadow">
                S{currentSeason} : B{currentEpisode}
              </div>
              <div className="min-w-0">
                <div className="text-sm sm:text-base font-bold text-white truncate">
                  {media.title}
                </div>
                <div className="text-[11px] text-white/60 truncate">
                  {currentEpObj?.episode_name || `${currentEpisode}. Bölüm`} ·{' '}
                  <span className="text-sky-400 font-mono">
                    {activeSource?.source_name || 'KoUp Stream'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: In-Player Source Switcher, Fansub Picker, Episode Drawer, InSight & Tools */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* In-Player Source Selector Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDrawer(activeDrawer === 'sources' ? null : 'sources');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer border ${
                  activeDrawer === 'sources'
                    ? 'bg-sky-400 text-black border-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.5)]'
                    : 'apple-glass-pill text-white hover:border-sky-400/50'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  Kaynak: {activeSource?.source_name || 'Seç'} (
                  {filteredSources.length})
                </span>
              </button>

              {/* In-Player Season & Episode Drawer Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDrawer(activeDrawer === 'episodes' ? null : 'episodes');
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer border ${
                  activeDrawer === 'episodes'
                    ? 'bg-amber-400 text-black border-amber-300'
                    : 'apple-glass-pill text-white hover:border-amber-400/50'
                }`}
              >
                <ListVideo className="w-3.5 h-3.5" />
                <span>Bölümler ({episodes.length})</span>
              </button>

              {/* In-Player Apple TV+ InSight Cast Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDrawer(activeDrawer === 'insight' ? null : 'insight');
                }}
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${
                  activeDrawer === 'insight'
                    ? 'bg-white text-black border-white'
                    : 'apple-glass-pill text-white/85 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-sky-400" />
                <span>InSight Kadro</span>
              </button>

              {/* Mark Watched Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleEpisodeWatched(media, currentEpisode, false);
                }}
                title="Bölümü İzlendi İşaretle"
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border ${
                  isEpisodeWatched
                    ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                    : 'apple-glass-pill text-white/80 hover:text-white'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {isEpisodeWatched ? 'İzlendi' : 'İzlendi İşaretle'}
                </span>
              </button>

              {/* Report Issue Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDrawer(activeDrawer === 'report' ? null : 'report');
                }}
                title="Bölüm / Kaynak Sorunu Bildir"
                className="w-8 h-8 rounded-full apple-glass-pill flex items-center justify-center text-amber-300 hover:bg-amber-400/20 transition-all cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </button>

              {/* Cinema Lights Off */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCinemaLightsOff((v) => !v);
                }}
                title="Işıkları Kapat (Sinema Modu - L)"
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  cinemaLightsOff
                    ? 'bg-amber-400 text-black'
                    : 'apple-glass-pill text-white/80 hover:text-white'
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" />
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                title="Tam Ekran (F)"
                className="w-8 h-8 rounded-full apple-glass-pill flex items-center justify-center text-white/85 hover:text-white transition-all cursor-pointer"
              >
                {isFullscreen ? (
                  <Minimize className="w-3.5 h-3.5" />
                ) : (
                  <Maximize className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Quick Inline Source Pills Row (Instant 1-click source switch on top of player) */}
          {filteredSources.length > 1 && (
            <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {filteredSources.slice(0, 10).map((src, idx) => {
                const isNative =
                  src.stream_type === 'hls' ||
                  src.stream_type === 'tau' ||
                  src.stream_type === 'mp4';
                const active = idx === selectedSourceIdx;
                return (
                  <button
                    key={`${src.embed_id}-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSourceIdx(idx);
                    }}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono transition-all cursor-pointer border ${
                      active
                        ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.55)] scale-105'
                        : 'bg-black/65 text-white/75 border-white/15 hover:text-white hover:border-white/35'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isNative ? 'bg-emerald-400' : 'bg-sky-400'
                      }`}
                    />
                    <span>{src.source_name}</span>
                    {src.fansub && src.fansub !== 'Varsayılan' && (
                      <span className="opacity-65">({src.fansub})</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* IN-PLAYER SLIDE-OVER DRAWERS (SOURCES / EPISODES / INSIGHT / REPORT) */}
        {activeDrawer === 'sources' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 right-4 bottom-16 w-80 sm:w-96 rounded-3xl apple-glass border border-white/20 p-5 z-40 overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Oynatıcı Kaynak & Fansub Seçici
                </h4>
                <p className="text-[11px] text-white/55">
                  Yeşil noktalı kaynaklar doğrudan KoUp Netflix Player ile oynatılır
                </p>
              </div>
              <button
                onClick={() => setActiveDrawer(null)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uniqueFansubs.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] font-mono uppercase tracking-wider text-white/45 mb-1.5">
                  Çevirmen / Fansub Filtresi
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => {
                      setSelectedFansub('all');
                      setSelectedSourceIdx(0);
                    }}
                    className={`px-2.5 py-1 rounded-full text-xs cursor-pointer ${
                      selectedFansub === 'all'
                        ? 'bg-sky-400 text-black font-semibold'
                        : 'bg-white/10 text-white/75'
                    }`}
                  >
                    Tümü
                  </button>
                  {uniqueFansubs.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setSelectedFansub(f);
                        setSelectedSourceIdx(0);
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs cursor-pointer ${
                        selectedFansub === f
                          ? 'bg-sky-400 text-black font-semibold'
                          : 'bg-white/10 text-white/75'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {filteredSources.map((src, idx) => {
                const isNative =
                  src.stream_type === 'hls' ||
                  src.stream_type === 'tau' ||
                  src.stream_type === 'mp4';
                return (
                  <button
                    key={`${src.embed_id}-${idx}`}
                    onClick={() => {
                      setSelectedSourceIdx(idx);
                      setActiveDrawer(null);
                    }}
                    className={`w-full flex items-center justify-between p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      idx === selectedSourceIdx
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                        : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/10'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isNative ? 'bg-emerald-400' : 'bg-sky-400'
                          }`}
                        />
                        <span>{src.source_name}</span>
                      </div>
                      <div className="text-[10px] font-mono text-white/50 mt-0.5">
                        Sağlayıcı: {src.provider} · Site: {src.site}
                        {src.fansub ? ` · Çeviri: ${src.fansub}` : ''}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                        isNative
                          ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                          : 'bg-white/10 text-white/70'
                      }`}
                    >
                      {src.quality_label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeDrawer === 'episodes' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 right-4 bottom-16 w-80 sm:w-96 rounded-3xl apple-glass border border-white/20 p-5 z-40 overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <h4 className="text-sm font-bold text-white">
                Sezon & Bölüm Seçici
              </h4>
              <button
                onClick={() => setActiveDrawer(null)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {seasonsList.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-3 pb-1">
                {seasonsList.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDrawerSeason(s)}
                    className={`px-3 py-1 rounded-full text-xs font-mono cursor-pointer ${
                      drawerSeason === s
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/10 text-white/75'
                    }`}
                  >
                    {s}. Sezon
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              {episodes
                .filter((e) => (e.season_number || 1) === drawerSeason)
                .map((ep) => {
                  const isCurrent =
                    ep.season_number === currentSeason &&
                    ep.episode_number === currentEpisode;
                  const watched = (
                    progressMap[media.id]?.watched_episodes || []
                  ).includes(ep.episode_number);
                  return (
                    <button
                      key={`${ep.season_number}-${ep.episode_number}`}
                      onClick={() => {
                        onSelectEpisode(ep.season_number, ep.episode_number);
                        setActiveDrawer(null);
                      }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                          : 'bg-white/[0.04] border-white/[0.06] text-white/80 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-xl bg-white/10 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                          {ep.episode_number}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {ep.episode_name}
                          </div>
                          <div className="text-[10px] font-mono text-white/45">
                            {ep.status === 'scheduled'
                              ? 'Yakında Yayınlanacak'
                              : `${ep.sources?.length || 0} Aktif Kaynak`}
                          </div>
                        </div>
                      </div>
                      {watched && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {activeDrawer === 'insight' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 right-4 bottom-16 w-80 sm:w-96 rounded-3xl apple-glass border border-white/20 p-5 z-40 overflow-y-auto shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <div>
                <h4 className="text-sm font-bold text-white">
                  Apple TV+ InSight · Bu Yapımda Kim Var?
                </h4>
                <p className="text-[11px] text-white/55">
                  Oyuncu veya karaktere tıklayarak profiline gidebilirsin
                </p>
              </div>
              <button
                onClick={() => setActiveDrawer(null)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2.5">
              {cast.length === 0 ? (
                <div className="text-xs text-white/50 py-6 text-center">
                  Kadro bilgisi aşağıda listelenmiştir.
                </div>
              ) : (
                cast.map((c) => (
                  <Link
                    key={`${c.person_id}-${c.role_type}`}
                    href={`/oyuncu/${c.people?.slug || c.person_id}`}
                    className="flex items-center gap-3 p-2 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10 transition-all"
                  >
                    <img
                      src={getProxiedImageUrl(c.people?.image_url)}
                      alt={c.people?.name || 'Oyuncu'}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">
                        {c.people?.name}
                      </div>
                      <div className="text-[11px] text-sky-300 truncate">
                        {c.character_name || 'Başrol'}
                      </div>
                      {c.voice_actor_name && (
                        <div className="text-[10px] text-amber-300 truncate">
                          Seiyuu: {c.voice_actor_name}
                        </div>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}

        {activeDrawer === 'report' && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-16 right-4 w-80 sm:w-96 rounded-3xl apple-glass border border-white/20 p-5 z-40 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <h4 className="text-sm font-bold text-white">
                Bölüm / Kaynak Sorunu Bildir
              </h4>
              <button
                onClick={() => setActiveDrawer(null)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitIssueReport} className="space-y-3">
              <CustomSelect
                value={reportReason}
                onChange={(val) => setReportReason(val)}
                variant="dark"
                size="sm"
                className="w-full"
                triggerClassName="w-full justify-between"
                menuClassName="w-full"
                options={[
                  { value: 'Video Açılmıyor / Kırık Kaynak', label: 'Video Açılmıyor / Kırık Kaynak' },
                  { value: 'Altyazı Senkronu Kayık / Yok', label: 'Altyazı Senkronu Kayık / Yok' },
                  { value: 'Yanlış Bölüm Yüklenmiş', label: 'Yanlış Bölüm Yüklenmiş' },
                  { value: 'Ses Gelmiyor / Kalite Düşük', label: 'Ses Gelmiyor / Kalite Düşük' },
                ]}
              />
              <textarea
                rows={2}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Ek açıklama (opsiyonel)..."
                className="w-full px-3 py-2 rounded-xl bg-black/70 border border-white/15 text-xs text-white"
              />
              <button
                type="submit"
                className="w-full py-2 rounded-full bg-amber-400 text-black font-bold text-xs cursor-pointer hover:bg-amber-300 transition-all"
              >
                Watchdog Onarımını Başlat & Yedek Kaynağa Geç
              </button>
            </form>
          </div>
        )}

        {/* CORE VIDEO AREA: SCHEDULED COUNTDOWN OR NATIVE HLS/MP4 OR LOCKED IFRAME */}
        {currentEpObj?.status === 'scheduled' || availableSources.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#090D14] to-[#08080A]">
            <div className="w-14 h-14 rounded-3xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center mb-4">
              <Clock className="w-7 h-7 text-emerald-400 animate-pulse" />
            </div>
            <div className="text-xs font-mono uppercase tracking-widest text-emerald-300 mb-1">
              Yayın Takvimi · Canlı Geri Sayım
            </div>
            <h3 className="text-2xl sm:text-4xl font-mono font-extrabold text-white tracking-tight mb-4">
              {countdownText}
            </h3>
            <div className="max-w-lg px-5 py-3 rounded-2xl bg-emerald-950/50 border border-emerald-400/30 text-xs sm:text-sm text-emerald-200 leading-relaxed">
              {currentEpObj?.translation_note ||
                'Çeviri işlemi için bölümün yayınlanması bekleniyor, kaynak geldiği gibi çeviri süreci başlayacaktır.'}
            </div>
          </div>
        ) : resolvedMode === 'native_hls' || resolvedMode === 'native_mp4' ? (
          /* LAYER 1: 100% NATIVE KOUP NETFLIX PLAYER (DiziYou HLS, HDFilm HLS, Tau-Video MP4) */
          <div className="relative w-full h-full bg-black flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => {
                setIsPlaying(false);
                if (videoRef.current) {
                  updateEpisodeProgress(
                    media,
                    currentSeason,
                    currentEpisode,
                    currentEpObj?.episode_name || `${currentEpisode}. Bölüm`,
                    videoRef.current.currentTime,
                    videoRef.current.duration || 3600
                  );
                }
              }}
              onTimeUpdate={() => {
                const v = videoRef.current;
                if (!v) return;
                setCurrentTime(v.currentTime);
                setDuration(v.duration || 0);
                if (
                  autoNextEnabled &&
                  v.duration > 120 &&
                  v.duration - v.currentTime <= 15 &&
                  v.duration - v.currentTime > 0 &&
                  nextEp
                ) {
                  setNextCountdown(Math.ceil(v.duration - v.currentTime));
                } else {
                  setNextCountdown(null);
                }
              }}
              onEnded={() => {
                updateEpisodeProgress(
                  media,
                  currentSeason,
                  currentEpisode,
                  currentEpObj?.episode_name || `${currentEpisode}. Bölüm`,
                  duration,
                  duration,
                  true
                );
                if (autoNextEnabled && nextEp) {
                  handleNextEpisode();
                }
              }}
              onError={() => {
                // If direct stream encounters CORS/token error, fallback seamlessly to iframe
                setResolvedMode('iframe');
              }}
              className="w-full h-full object-contain"
            />

            {/* Skip Intro & Auto-Next Floating Cards */}
            {currentTime >= 15 && currentTime <= 105 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) videoRef.current.currentTime += 85;
                }}
                className="absolute bottom-24 right-6 z-30 px-4 py-2 rounded-full bg-white/95 text-black font-bold text-xs shadow-2xl hover:scale-105 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span>İntroyu Atla (+85sn)</span>
                <SkipForward className="w-3.5 h-3.5 fill-black" />
              </button>
            )}

            {nextCountdown !== null && nextEp && (
              <div className="absolute bottom-24 right-6 z-30 p-4 rounded-2xl apple-glass border border-sky-400/40 flex items-center gap-3 shadow-2xl">
                <div>
                  <div className="text-[11px] font-mono text-sky-300">
                    Sonraki Bölüm ({nextCountdown} sn)
                  </div>
                  <div className="text-xs font-bold text-white">
                    {nextEp.episode_number}. Bölüm
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNextEpisode();
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
                >
                  Hemen Geç
                </button>
              </div>
            )}

            {/* Custom Netflix Bottom Scrubber Bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${
                showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              {/* Spectral Timeline Scrubber */}
              <div className="mb-3 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCurrentTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="w-full h-1.5 accent-sky-400 bg-white/25 rounded-full cursor-pointer"
                />
                <span className="text-xs font-mono text-white/80 shrink-0">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      if (v.paused) v.play();
                      else v.pause();
                    }}
                    className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-all cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 fill-black" />
                    ) : (
                      <Play className="w-4 h-4 fill-black ml-0.5" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime -= 10;
                    }}
                    title="10 Saniye Geri"
                    className="w-9 h-9 rounded-full apple-glass-pill flex items-center justify-center text-white hover:text-sky-300 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime += 10;
                    }}
                    title="10 Saniye İleri"
                    className="w-9 h-9 rounded-full apple-glass-pill flex items-center justify-center text-white hover:text-sky-300 cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>

                  <div className="hidden sm:flex items-center gap-2">
                    <button
                      onClick={() => {
                        const nextMute = !isMuted;
                        setIsMuted(nextMute);
                        if (videoRef.current) videoRef.current.muted = nextMute;
                      }}
                      className="text-white/80 hover:text-white cursor-pointer"
                    >
                      {isMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setVolume(v);
                        setIsMuted(v === 0);
                        if (videoRef.current) videoRef.current.volume = v;
                      }}
                      className="w-20 h-1 accent-white bg-white/25 rounded-full cursor-pointer"
                    />
                  </div>
                </div>

                {/* Right Native Controls: Quality, Speed, Next Episode */}
                <div className="flex items-center gap-2">
                  {qualities.length > 1 && (
                    <CustomSelect
                      value={selectedQuality}
                      onChange={(val) => {
                        const q = qualities.find((x) => x.label === val);
                        if (q && videoRef.current) {
                          const t = videoRef.current.currentTime;
                          setSelectedQuality(q.label);
                          setStreamUrl(q.url);
                          setTimeout(() => {
                            if (videoRef.current) videoRef.current.currentTime = t;
                          }, 150);
                        }
                      }}
                      variant="dark"
                      size="sm"
                      options={qualities.map((q) => ({ value: q.label, label: q.label }))}
                    />
                  )}

                  <CustomSelect
                    value={String(playbackRate)}
                    onChange={(val) => {
                      const r = Number(val);
                      setPlaybackRate(r);
                      if (videoRef.current) videoRef.current.playbackRate = r;
                    }}
                    variant="dark"
                    size="sm"
                    options={[0.75, 1, 1.25, 1.5, 2].map((r) => ({
                      value: String(r),
                      label: `${r}x Hız`,
                    }))}
                  />

                  {nextEp && (
                    <button
                      onClick={handleNextEpisode}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:scale-105 transition-all cursor-pointer"
                    >
                      <span>Sonraki Bölüm</span>
                      <SkipForward className="w-3.5 h-3.5 fill-black" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* LAYER 2: UNIVERSAL IFRAME SHELL WITH UNOBSTRUCTED NATIVE CONTROLS + TOP NETFLIX DOCK */
          <div className="relative w-full h-full bg-black">
            {isResolving && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
                <div className="text-xs font-mono text-sky-400 animate-pulse">
                  KoUp Stream Köprüsü hazırlanıyor...
                </div>
              </div>
            )}
            {streamUrl ? (
              <iframe
                ref={iframeRef}
                key={streamUrl}
                src={streamUrl}
                allowFullScreen
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                referrerPolicy="no-referrer"
                className="w-full h-full border-0"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-black">
                <div className="text-xs font-mono text-white/50 animate-pulse">
                  Oynatıcı ve akış hazırlanıyor...
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AMBIENT APPLE GLASS BOTTOM BAR (EPISODE NAVIGATION & AUTO-NEXT TOGGLE) */}
      <div className="mt-3 p-3.5 rounded-2xl apple-glass flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevEpisode}
            disabled={!prevEp}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/[0.07] hover:bg-white/15 disabled:opacity-35 text-xs font-medium text-white transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <SkipBack className="w-3.5 h-3.5" />
            <span>Önceki Bölüm</span>
          </button>

          <button
            onClick={handleNextEpisode}
            disabled={!nextEp}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black disabled:opacity-35 text-xs font-bold hover:scale-[1.02] transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <span>Sonraki Bölüm ({nextEp ? `B${nextEp.episode_number}` : 'Final'})</span>
            <SkipForward className="w-3.5 h-3.5 fill-black" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-white/75 hover:text-white">
            <input
              type="checkbox"
              checked={autoNextEnabled}
              onChange={(e) => setAutoNextEnabled(e.target.checked)}
              className="accent-sky-400 rounded"
            />
            <span>Kesintisiz Bölüm Geçişi</span>
          </label>

          <button
            onClick={() => toggleEpisodeWatched(media, currentEpisode, true)}
            className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/15 text-white/80 border border-white/10 text-[11px] cursor-pointer"
          >
            1-{currentEpisode}. Bölümleri İzlendi İşaretle
          </button>
        </div>
      </div>
    </div>
  );
}
