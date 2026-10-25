import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Anime4KRenderer, Anime4KMode, Anime4KStats } from '@/lib/anime4k';

export type { Anime4KMode, Anime4KStats };

const STORAGE_KEY = 'koup_anime4k_mode';
const RESET_KEY = 'koup_anime4k_v2_default_off';

export interface UseAnime4KOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled: boolean; // Yalnızca native_hls ve native_mp4 durumunda true
  onFpsWarning?: (fps: number, downgradedTo: Anime4KMode) => void;
  onError?: (err: Error) => void;
  onFallback?: (err: Error) => void;
}

export interface UseAnime4KReturn {
  mode: Anime4KMode;
  setMode: (mode: Anime4KMode) => void;
  isSupported: boolean;
  stats: Anime4KStats | null;
  isUpscaling: boolean;
  isRenderingSuccessfully: boolean;
  rendererRef: React.RefObject<Anime4KRenderer | null>;
}

/**
 * Custom React hook managing the Anime4K WebGL 2.0 video upscaler lifecycle.
 *
 * Handles WebGL 2.0 capability detection, persistent preference storage,
 * video element attachment/detachment, real-time telemetry stats,
 * and automatic performance watchdog downgrade.
 */
export function useAnime4K({
  videoRef,
  canvasRef,
  enabled,
  onFpsWarning,
  onError,
  onFallback,
}: UseAnime4KOptions): UseAnime4KReturn {
  // WebGL 2.0 capability detection (synchronous & SSR-safe)
  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Anime4KRenderer.isSupported();
  }, []);

  // Initialize mode: ALWAYS default strictly to 'off'
  // If legacy localStorage has 'fast' from prior default, reset it to 'off'
  const [mode, setModeState] = useState<Anime4KMode>(() => {
    if (typeof window === 'undefined') return 'off';
    try {
      if (!localStorage.getItem(RESET_KEY)) {
        localStorage.setItem(RESET_KEY, '1');
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (legacy === 'fast') {
          localStorage.setItem(STORAGE_KEY, 'off');
          return 'off';
        }
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'fast' || saved === 'ultra') {
        return saved;
      }
    } catch {}
    return 'off';
  });

  const [isRenderingSuccessfully, setIsRenderingSuccessfully] = useState(false);
  const [stats, setStats] = useState<Anime4KStats | null>(null);
  const rendererRef = useRef<Anime4KRenderer | null>(null);

  // Keep references to latest callbacks and state to avoid recreating effects
  const onFpsWarningRef = useRef(onFpsWarning);
  useEffect(() => {
    onFpsWarningRef.current = onFpsWarning;
  }, [onFpsWarning]);

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

  // Mode changer with persistent storage
  const setMode = useCallback((newMode: Anime4KMode) => {
    modeRef.current = newMode;
    setModeState(newMode);
    if (newMode === 'off') {
      setIsRenderingSuccessfully(false);
    }
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {}
    if (rendererRef.current) {
      rendererRef.current.setMode(newMode);
    }
  }, []);

  // Manage Anime4KRenderer lifecycle
  useEffect(() => {
    if (!enabled || !isSupported) {
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
        // Elements may mount in a subsequent microtask/frame
        rafId = requestAnimationFrame(initOrAttach);
        return;
      }

      if (!rendererRef.current) {
        try {
          const renderer = new Anime4KRenderer(canvas, {
            initialMode: modeRef.current,
            onFpsDrop: (droppedFps: number) => {
              const current = renderer.getMode();
              const downgraded: Anime4KMode = current === 'ultra' ? 'fast' : 'off';
              modeRef.current = downgraded;
              setModeState(downgraded);
              if (downgraded === 'off') {
                setIsRenderingSuccessfully(false);
              }
              try {
                localStorage.setItem(STORAGE_KEY, downgraded);
              } catch {}
              onFpsWarningRef.current?.(droppedFps, downgraded);
            },
            onError: (err: Error) => {
              onErrorRef.current?.(err);
            },
            onFallback: (err: Error) => {
              modeRef.current = 'off';
              setModeState('off');
              setIsRenderingSuccessfully(false);
              try {
                localStorage.setItem(STORAGE_KEY, 'off');
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
  }, [enabled, isSupported, canvasRef, videoRef]);

  const isUpscaling = mode !== 'off' && isSupported && enabled && isRenderingSuccessfully;

  return {
    mode,
    setMode,
    isSupported,
    stats,
    isUpscaling,
    isRenderingSuccessfully,
    rendererRef,
  };
}
