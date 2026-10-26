/**
 * Anime4K WebGPU / WebGL 2.0 Types & Interfaces
 */

/**
 * Processing modes for Anime4K.
 * - 'off': Direct passthrough copy (zero enhancement overhead)
 * - 'fast': Lightweight Anime4K restoration & line push (mobile GPU friendly)
 * - 'ultra': Full Anime4K restorative CNN / line reconstruction + de-ringing (desktop GPU)
 */
export type Anime4KMode = 'off' | 'fast' | 'ultra';

/**
 * Target output resolution presets.
 * - 'auto': Automatic scaling based on container physical pixels (display px * DPR)
 * - '1080p': Fixed 1080p target height (1920x1080 for 16:9, 1440x1080 for 4:3)
 * - '1440p': Fixed 1440p target height (2560x1440 for 16:9, 1920x1440 for 4:3)
 * - '4k': Fixed 2160p target height (3840x2160 for 16:9, 2880x2160 for 4:3)
 */
export type Anime4KTargetResolution = 'auto' | '1080p' | '1440p' | '4k';

/**
 * Real-time rendering performance statistics.
 */
export interface Anime4KStats {
  /** Current frames per second */
  fps: number;
  /** Active Anime4K processing mode */
  mode: Anime4KMode;
  /** Active target resolution preset */
  resolution: Anime4KTargetResolution;
  /** Actual canvas drawing buffer width */
  targetWidth: number;
  /** Actual canvas drawing buffer height */
  targetHeight: number;
  /** GPU rendering backend currently in use */
  backend: 'webgpu' | 'webgl2';
  /** Number of dropped frames reported by HTML5 video playback */
  droppedFrames: number;
  /** GPU render time per frame in milliseconds */
  renderTimeMs: number;
}

/**
 * Configuration options for Anime4KRenderer.
 */
export interface Anime4KOptions {
  /**
   * Callback fired when FPS drops below threshold for a sustained duration.
   * Receives the degraded FPS value and the newly assigned mode.
   */
  onFpsDrop?: (fps: number, downgradedMode: Anime4KMode) => void;

  /**
   * Callback fired when FPS watchdog downgrades target resolution before degrading mode.
   */
  onResolutionDowngrade?: (
    fromRes: Anime4KTargetResolution,
    toRes: Anime4KTargetResolution
  ) => void;

  /**
   * Callback fired on unrecoverable GPU errors or context loss failures.
   */
  onError?: (err: Error) => void;

  /**
   * Callback fired when WebGL/WebGPU fails due to CORS / tainted canvas or texture upload error,
   * triggering instant graceful fallback to native video.
   */
  onFallback?: (err: Error) => void;

  /**
   * Callback fired when a frame is rendered successfully to the canvas.
   */
  onRenderSuccess?: () => void;

  /**
   * Periodic callback providing real-time rendering statistics.
   */
  onStatsUpdate?: (stats: Anime4KStats) => void;

  /**
   * Initial processing mode on creation.
   * @default 'off'
   */
  initialMode?: Anime4KMode;

  /**
   * Initial target resolution on creation.
   * @default 'auto'
   */
  initialResolution?: Anime4KTargetResolution;

  /**
   * FPS threshold below which watchdog considers performance degraded.
   * @default 23
   */
  fpsThreshold?: number;

  /**
   * Number of consecutive frames below fpsThreshold required to trigger automatic downgrade.
   * @default 45
   */
  fpsDropConsecutiveFrames?: number;

  /**
   * Enhancement strength multiplier (0.0 to 2.0).
   * @default 1.0
   */
  strength?: number;

  /**
   * Stats update frequency in milliseconds.
   * @default 500
   */
  statsIntervalMs?: number;

  /**
   * Maximum device pixel ratio cap for canvas buffer resolution to prevent GPU fill-rate choke.
   * @default 2.0
   */
  maxPixelRatio?: number;
}
