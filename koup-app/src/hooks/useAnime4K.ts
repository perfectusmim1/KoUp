import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Anime4KRenderer,
  Anime4KMode,
  Anime4KTargetResolution,
  Anime4KStats,
  probeVideoSourceReadable,
} from '@/lib/anime4k';

export type { Anime4KMode, Anime4KTargetResolution, Anime4KStats };

const MODE_STORAGE_KEY = 'koup_anime4k_mode';
const RESOLUTION_STORAGE_KEY = 'koup_anime4k_resolution';
const RESET_KEY = 'koup_anime4k_v3_default_off';

export interface UseAnime4KOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled: boolean; // Only true when resolvedMode is native_hls or native_mp4
  streamUrl?: string; // Active video stream URL to detect source changes
  onFpsWarning?: (fps: number, downgradedTo: Anime4KMode) => void;
  onResolutionDowngrade?: (
    fromRes: Anime4KTargetResolution,
    toRes: Anime4KTargetResolution
  ) => void;
  onError?: (err: Error) => void;
  onFallback?: (err: Error) => void;
}

export interface UseAnime4KReturn {
  mode: Anime4KMode;
  setMode: (mode: Anime4KMode) => void;
  resolution: Anime4KTargetResolution;
  setResolution: (res: Anime4KTargetResolution) => void;
  isSupported: boolean;
  isSourceSupported: boolean;
  stats: Anime4KStats | null;
  isUpscaling: boolean;
  isRenderingSuccessfully: boolean;
  rendererRef: React.RefObject<Anime4KRenderer | null>;
  recheckSource: () => Promise<boolean>;
}

/**
 * Custom React hook managing the Anime4K video upscaler lifecycle.
 *
 * Handles WebGL 2.0 / WebGPU capability detection, per-source GPU readability probing,
 * persistent preference storage, target resolution presets, and automatic watchdog downgrade.
 */
export function useAnime4K({
  videoRef,
  canvasRef,
  enabled,
  streamUrl,
  onFpsWarning,
  onResolutionDowngrade,
  onError,
  onFallback,
}: UseAnime4KOptions): UseAnime4KReturn {
  // WebGL 2.0 / WebGPU hardware capability detection (synchronous & SSR-safe)
  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Anime4KRenderer.isSupported();
  }, []);

  // Per-source readability probe state: false until verified readable by GPU
  const [isSourceSupported, setIsSourceSupported] = useState(false);

  // Initialize mode: ALWAYS default strictly to 'off'
  const [mode, setModeState] = useState<Anime4KMode>(() => {
    if (typeof window === 'undefined') return 'off';
    try {
      if (!localStorage.getItem(RESET_KEY)) {
        localStorage.setItem(RESET_KEY, '1');
        localStorage.setItem(MODE_STORAGE_KEY, 'off');
        return 'off';
      }
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === 'fast' || saved === 'ultra') {
        return saved;
      }
    } catch {}
    return 'off';
  });

  // Target resolution state with localStorage persistence
  const [resolution, setResolutionState] = useState<Anime4KTargetResolution>(() => {
    if (typeof window === 'undefined') return 'auto';
    try {
      const saved = localStorage.getItem(RESOLUTION_STORAGE_KEY);
      if (saved === 'auto' || saved === '1080p' || saved === '1440p' || saved === '4k') {
        return saved;
      }
    } catch {}
    return 'auto';
  });

  const [isRenderingSuccessfully, setIsRenderingSuccessfully] = useState(false);
  const [stats, setStats] = useState<Anime4KStats | null>(null);
  const rendererRef = useRef<Anime4KRenderer | null>(null);

  // Keep references to latest callbacks and state to avoid recreating effects
  const onFpsWarningRef = useRef(onFpsWarning);
  useEffect(() => {
    onFpsWarningRef.current = onFpsWarning;
  }, [onFpsWarning]);

  const onResolutionDowngradeRef = useRef(onResolutionDowngrade);
  useEffect(() => {
    onResolutionDowngradeRef.current = onResolutionDowngrade;
  }, [onResolutionDowngrade]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    if (mode === 'off') {
      setIsRenderingSuccessfully(false);
    }
    if (rendererRef.current && rendererRef.current.getMode() !== mode) {
      rendererRef.current.setMode(mode);
    }
  }, [mode]);

  const resolutionRef = useRef(resolution);
  useEffect(() => {
    resolutionRef.current = resolution;
    if (rendererRef.current && rendererRef.current.getResolution() !== resolution) {
      rendererRef.current.setResolution(resolution);
    }
  }, [resolution]);

  // Mode changer with persistent storage
  const setMode = useCallback((newMode: Anime4KMode) => {
    modeRef.current = newMode;
    setModeState(newMode);
    if (newMode === 'off') {
      setIsRenderingSuccessfully(false);
    }
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(MODE_STORAGE_KEY, newMode);
      }
    } catch {}
    if (rendererRef.current) {
      rendererRef.current.setMode(newMode);
    }
  }, []);

  // Resolution changer with persistent storage
  const setResolution = useCallback((newRes: Anime4KTargetResolution) => {
    resolutionRef.current = newRes;
    setResolutionState(newRes);
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(RESOLUTION_STORAGE_KEY, newRes);
      }
    } catch {}
    if (rendererRef.current) {
      rendererRef.current.setResolution(newRes);
    }
  }, []);

  // Source readability probe handler
  const recheckSource = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current;
    if (!video || !enabled) {
      setIsSourceSupported(false);
      return false;
    }

    try {
      const readable = await probeVideoSourceReadable(video);
      setIsSourceSupported(readable);
      if (!readable) {
        // If source cannot be read by GPU, ensure mode is off and clean state
        if (modeRef.current !== 'off') {
          modeRef.current = 'off';
          setModeState('off');
        }
        setIsRenderingSuccessfully(false);
      }
      return readable;
    } catch {
      setIsSourceSupported(false);
      return false;
    }
  }, [enabled, videoRef]);

  // Run probe on streamUrl change or video source change
  useEffect(() => {
    let cancelled = false;
    setIsSourceSupported(false);
    setIsRenderingSuccessfully(false);

    // On source change, turn off upscale
    if (modeRef.current !== 'off') {
      modeRef.current = 'off';
      setModeState('off');
    }

    if (!enabled || !isSupported) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const probe = async () => {
      if (cancelled) return;
      const readable = await probeVideoSourceReadable(video);
      if (!cancelled) {
        setIsSourceSupported(readable);
      }
    };

    if (video.readyState >= 2 && video.videoWidth > 0) {
      probe();
    } else {
      const onLoaded = () => {
        if (!cancelled) probe();
      };
      video.addEventListener('loadeddata', onLoaded, { once: true });
      return () => {
        cancelled = true;
        video.removeEventListener('loadeddata', onLoaded);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, isSupported, streamUrl, videoRef]);

  // Manage Anime4KRenderer lifecycle
  useEffect(() => {
    if (!enabled || !isSupported || !isSourceSupported) {
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      setIsRenderingSuccessfully(false);
      setStats(null);
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;

    const initOrAttach = () => {
      if (cancelled) return;

      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (!canvas || !video) {
        rafId = requestAnimationFrame(initOrAttach);
        return;
      }

      if (!rendererRef.current) {
        try {
          const renderer = new Anime4KRenderer(canvas, {
            initialMode: modeRef.current,
            initialResolution: resolutionRef.current,
            onFpsDrop: (droppedFps: number, downgradedMode: Anime4KMode) => {
              modeRef.current = downgradedMode;
              setModeState(downgradedMode);
              if (downgradedMode === 'off') {
                setIsRenderingSuccessfully(false);
              }
              try {
                if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
                  localStorage.setItem(MODE_STORAGE_KEY, downgradedMode);
                }
              } catch {}
              onFpsWarningRef.current?.(droppedFps, downgradedMode);
            },
            onResolutionDowngrade: (fromRes, toRes) => {
              resolutionRef.current = toRes;
              setResolutionState(toRes);
              try {
                if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
                  localStorage.setItem(RESOLUTION_STORAGE_KEY, toRes);
                }
              } catch {}
              onResolutionDowngradeRef.current?.(fromRes, toRes);
            },
            onError: (err: Error) => {
              onErrorRef.current?.(err);
            },
            onFallback: (err: Error) => {
              modeRef.current = 'off';
              setModeState('off');
              setIsRenderingSuccessfully(false);
              try {
                if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
                  localStorage.setItem(MODE_STORAGE_KEY, 'off');
                }
              } catch {}
              onFallbackRef.current?.(err);
            },
            onRenderSuccess: () => {
              if (!cancelled) {
                setIsRenderingSuccessfully(true);
              }
            },
            onStatsUpdate: (newStats: Anime4KStats) => {
              if (!cancelled) {
                setStats(newStats);
              }
            },
          });

          renderer.attachVideo(video);
          rendererRef.current = renderer;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          onErrorRef.current?.(error);
        }
      } else {
        rendererRef.current.attachVideo(video);
        rendererRef.current.setMode(modeRef.current);
        rendererRef.current.setResolution(resolutionRef.current);
      }
    };

    initOrAttach();

    return () => {
      cancelled = true;
      setIsRenderingSuccessfully(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
      setStats(null);
    };
  }, [enabled, isSupported, isSourceSupported, canvasRef, videoRef]);

  const isUpscaling =
    mode !== 'off' &&
    isSupported &&
    enabled &&
    isSourceSupported &&
    isRenderingSuccessfully;

  return {
    mode,
    setMode,
    resolution,
    setResolution,
    isSupported,
    isSourceSupported,
    stats,
    isUpscaling,
    isRenderingSuccessfully,
    rendererRef,
    recheckSource,
  };
}
