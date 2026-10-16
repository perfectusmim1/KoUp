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
  selectedSourceIdx?: number;
  onSelectSourceIdx?: (idx: number) => void;
  selectedFansub?: string;
  cinemaLightsOff?: boolean;
  onToggleCinemaLights?: () => void;
}

export default function NetflixPlayer({
  media,
  episodes,
  currentSeason,
  currentEpisode,
  onSelectEpisode,
  cast = [],
  selectedSourceIdx: propSelectedSourceIdx,
  onSelectSourceIdx,
  selectedFansub: propSelectedFansub = 'all',
  cinemaLightsOff: propCinemaLightsOff,
  onToggleCinemaLights,
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

  // Source selection handling (can be controlled externally or internally)
  const [internalSourceIdx, setInternalSourceIdx] = useState(0);
  const selectedSourceIdx =
    propSelectedSourceIdx !== undefined ? propSelectedSourceIdx : internalSourceIdx;
  const setSelectedSourceIdx = (idx: number) => {
    if (onSelectSourceIdx) onSelectSourceIdx(idx);
    else setInternalSourceIdx(idx);
  };

  const filteredSources =
    propSelectedFansub === 'all'
      ? availableSources
      : availableSources.filter((s) => s.fansub === propSelectedFansub);

  const activeSource: EpisodeSource | undefined =
    filteredSources[selectedSourceIdx] || availableSources[0];

  // Cinema lights handling
  const [internalCinemaLights, setInternalCinemaLights] = useState(false);
  const cinemaLightsOff =
    propCinemaLightsOff !== undefined ? propCinemaLightsOff : internalCinemaLights;
  const setCinemaLightsOff = (v: boolean | ((prev: boolean) => boolean)) => {
    if (onToggleCinemaLights) {
      onToggleCinemaLights();
    } else {
      setInternalCinemaLights(v);
    }
  };

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
  const [showOverlay, setShowOverlay] = useState(true);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  // Scheduled Episode Live Countdown
  const [countdownText, setCountdownText] = useState('14 saat, 28 dakika, 19 saniye');

  // Reset internal source index when episode changes
  useEffect(() => {
    setInternalSourceIdx(0);
    setNextCountdown(null);
  }, [currentSeason, currentEpisode]);

  // Fullscreen toggle event listener for external buttons
  useEffect(() => {
    const handleFsTrigger = () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(() => {});
        setIsFullscreen(true);
      } else {
        document.exitFullscreen().catch(() => {});
        setIsFullscreen(false);
      }
    };
    window.addEventListener('koup-toggle-fullscreen', handleFsTrigger);
    return () => window.removeEventListener('koup-toggle-fullscreen', handleFsTrigger);
  }, []);

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
              setSelectedSourceIdx(selectedSourceIdx + 1);
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
      setShowOverlay(false);
    }, 3400);
  }, []);

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
        {/* Sleek Minimal HUD (ONLY in Fullscreen mode when mouse is moving) */}
        {isFullscreen && (
          <div
            className={`absolute top-0 left-0 right-0 z-30 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
              showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all cursor-pointer"
                  title="Tam Ekrandan Çık (Esc)"
                >
                  <Minimize className="w-4 h-4" />
                </button>
                <div>
                  <div className="text-sm sm:text-base font-bold text-white">
                    {media.title}
                  </div>
                  <div className="text-xs text-white/60">
                    S{currentSeason} : B{currentEpisode} · {currentEpObj?.episode_name || `${currentEpisode}. Bölüm`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-white/10 text-white/80 font-mono text-xs border border-white/15">
                  {activeSource?.source_name || 'KoUp Stream'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFullscreen();
                  }}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all cursor-pointer"
                  title="Tam Ekran"
                >
                  <Minimize className="w-4 h-4" />
                </button>
              </div>
            </div>
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
    </div>
  );
}
