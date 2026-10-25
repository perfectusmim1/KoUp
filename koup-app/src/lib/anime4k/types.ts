/**
 * Anime4K WebGL 2.0 Types & Interfaces
 */

/**
 * Processing modes for Anime4K.
 * - 'off': Direct passthrough copy (zero enhancement overhead)
 * - 'fast': Adaptive luma & edge gradient sharpening with anti-ringing limiting (mobile GPU friendly)
 * - 'ultra': Bilateral restorative filter + directional line push / thinning + anti-ringing (desktop GPU)
 */
export type Anime4KMode = 'off' | 'fast' | 'ultra';

/**
 * Real-time rendering performance statistics.
 */
export interface Anime4KStats {
  /** Current frames per second */
  fps: number;
  /** Active Anime4K processing mode */
  mode: Anime4KMode;
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
   * Receives the degraded FPS value.
   */
  onFpsDrop?: (fps: number) => void;

  /**
   * Callback fired on unrecoverable WebGL errors or context loss failures.
   */
  onError?: (err: Error) => void;

  /**
   * Periodic callback providing real-time rendering statistics.
   */
  onStatsUpdate?: (stats: Anime4KStats) => void;

  /**
   * Initial processing mode on creation.
   * @default 'fast'
   */
  initialMode?: Anime4KMode;

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
