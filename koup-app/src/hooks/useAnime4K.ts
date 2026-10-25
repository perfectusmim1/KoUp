import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Anime4KRenderer, Anime4KMode, Anime4KStats } from '@/lib/anime4k';

export type { Anime4KMode, Anime4KStats };

const STORAGE_KEY = 'koup_anime4k_mode';

export interface UseAnime4KOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled: boolean; // Yalnızca native_hls ve native_mp4 durumunda true
  onFpsWarning?: (fps: number, downgradedTo: Anime4KMode) => void;
  onError?: (err: Error) => void;
}

export interface UseAnime4KReturn {
  mode: Anime4KMode;
  setMode: (mode: Anime4KMode) => void;
  isSupported: boolean;
  stats: Anime4KStats | null;
  isUpscaling: boolean;
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
}: UseAnime4KOptions): UseAnime4KReturn {
  // WebGL 2.0 capability detection (synchronous & SSR-safe)
  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Anime4KRenderer.isSupported();
  }, []);

  // Initialize mode from localStorage or capability-aware default
  const [mode, setModeState] = useState<Anime4KMode>(() => {
    if (typeof window === 'undefined') return 'off';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'off' || saved === 'fast' || saved === 'ultra') {
        return saved;
      }
    } catch {}
    return Anime4KRenderer.isSupported() ? 'fast' : 'off';
  });

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

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    if (rendererRef.current && rendererRef.current.getMode() !== mode) {
      rendererRef.current.setMode(mode);
    }
  }, [mode]);

  // Mode changer with persistent storage
  const setMode = useCallback((newMode: Anime4KMode) => {
    modeRef.current = newMode;
    setModeState(newMode);
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
              try {
                localStorage.setItem(STORAGE_KEY, downgraded);
              } catch {}
              onFpsWarningRef.current?.(droppedFps, downgraded);
            },
            onError: (err: Error) => {
              onErrorRef.current?.(err);
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

  const isUpscaling = mode !== 'off' && isSupported && enabled;

  return {
    mode,
    setMode,
    isSupported,
    stats,
    isUpscaling,
    rendererRef,
  };
}
