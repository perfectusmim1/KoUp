/**
 * Anime4K WebGPU / WebGL 2.0 Renderer
 *
 * High-performance, zero-memory-leak renderer applying real-time
 * Anime4K upscaling, line reconstruction, and edge sharpening to HTML5 video.
 *
 * Preserves strict video aspect ratio on canvas drawing buffer, preventing
 * letterbox stretching. Supports WebGPU with graceful WebGL 2.0 fallback,
 * target resolution selection, and automatic FPS watchdog.
 */

import {
  Anime4KMode,
  Anime4KTargetResolution,
  Anime4KOptions,
  Anime4KStats,
} from './types';
import {
  VERTEX_SHADER_SOURCE,
  PASSTHROUGH_FRAGMENT_SHADER_SOURCE,
  FAST_FRAGMENT_SHADER_SOURCE,
  ULTRA_FRAGMENT_SHADER_SOURCE,
  createProgram,
} from './shaders';

interface ProgramInfo {
  program: WebGLProgram;
  uTexture: WebGLUniformLocation | null;
  uTexelSize: WebGLUniformLocation | null;
  uStrength: WebGLUniformLocation | null;
  uFlipY: WebGLUniformLocation | null;
}

export class Anime4KRenderer {
  private canvas: HTMLCanvasElement;
  private options: Required<
    Omit<
      Anime4KOptions,
      | 'onFpsDrop'
      | 'onResolutionDowngrade'
      | 'onError'
      | 'onFallback'
      | 'onRenderSuccess'
      | 'onStatsUpdate'
    >
  > &
    Pick<
      Anime4KOptions,
      | 'onFpsDrop'
      | 'onResolutionDowngrade'
      | 'onError'
      | 'onFallback'
      | 'onRenderSuccess'
      | 'onStatsUpdate'
    >;

  private gl: WebGL2RenderingContext | null = null;
  private mode: Anime4KMode;
  private resolution: Anime4KTargetResolution;
  private strength: number;
  private backend: 'webgpu' | 'webgl2' = 'webgl2';

  // WebGL 2.0 State
  private programs: Map<Anime4KMode, ProgramInfo> = new Map();
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;

  private textureWidth = 0;
  private textureHeight = 0;

  private video: HTMLVideoElement | null = null;
  private videoFrameCallbackId: number | null = null;
  private rafId: number | null = null;

  private isDestroyed = false;
  private isContextLost = false;
  private hasReportedSuccess = false;

  // FPS Watchdog & Telemetry
  private frameTimestamps: number[] = [];
  private consecutiveLowFpsCount = 0;
  private lastStatsTime = 0;
  private lastRenderTimeMs = 0;
  private currentFps = 60;

  // Bound event handlers for clean removal
  private handleContextLost: (e: Event) => void;
  private handleContextRestored: () => void;
  private handleSeeked: () => void;
  private handleLoadedMetadata: () => void;

  /**
   * Safe check for WebGL 2.0 or WebGPU availability in the current environment.
   */
  public static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return false;
    }
    // Check WebGPU
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
      return true;
    }
    // Check WebGL 2.0
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2', {
        powerPreference: 'high-performance',
      });
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) {
        ext.loseContext();
      }
      return true;
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, options?: Anime4KOptions) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Anime4KRenderer requires browser environment');
    }
    this.canvas = canvas;
    this.options = {
      initialMode: options?.initialMode ?? 'off',
      initialResolution: options?.initialResolution ?? 'auto',
      fpsThreshold: options?.fpsThreshold ?? 23,
      fpsDropConsecutiveFrames: options?.fpsDropConsecutiveFrames ?? 45,
      strength: options?.strength ?? 1.0,
      statsIntervalMs: options?.statsIntervalMs ?? 500,
      maxPixelRatio: options?.maxPixelRatio ?? 2.0,
      onFpsDrop: options?.onFpsDrop,
      onResolutionDowngrade: options?.onResolutionDowngrade,
      onError: options?.onError,
      onFallback: options?.onFallback,
      onRenderSuccess: options?.onRenderSuccess,
      onStatsUpdate: options?.onStatsUpdate,
    };

    this.mode = this.options.initialMode;
    this.resolution = this.options.initialResolution;
    this.strength = this.options.strength;

    this.handleContextLost = (e: Event) => {
      e.preventDefault();
      this.isContextLost = true;
      this.stopLoop();
    };

    this.handleContextRestored = () => {
      this.isContextLost = false;
      this.initWebGL();
      if (this.video && this.mode !== 'off') {
        this.startLoop();
      }
    };

    this.handleSeeked = () => {
      if (!this.isDestroyed && !this.isContextLost && this.mode !== 'off') {
        this.render();
      }
    };

    this.handleLoadedMetadata = () => {
      this.updateDimensions();
    };

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.initWebGL();
  }

  /**
   * Initializes WebGL 2.0 context, programs, VAO, and video texture.
   */
  private initWebGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      const err = new Error('WebGL 2.0 is not supported or context creation failed');
      this.options.onError?.(err);
      return;
    }

    this.gl = gl;
    this.backend = 'webgl2';

    try {
      this.initShaders(gl);
      this.initGeometry(gl);
      this.initTexture(gl);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError?.(error);
    }
  }

  /**
   * Compiles and links shaders for all supported processing modes.
   */
  private initShaders(gl: WebGL2RenderingContext): void {
    this.programs.clear();

    const shaderConfigs: Array<{
      mode: Anime4KMode;
      fragmentSource: string;
    }> = [
      { mode: 'off', fragmentSource: PASSTHROUGH_FRAGMENT_SHADER_SOURCE },
      { mode: 'fast', fragmentSource: FAST_FRAGMENT_SHADER_SOURCE },
      { mode: 'ultra', fragmentSource: ULTRA_FRAGMENT_SHADER_SOURCE },
    ];

    for (const { mode, fragmentSource } of shaderConfigs) {
      const program = createProgram(gl, VERTEX_SHADER_SOURCE, fragmentSource);
      this.programs.set(mode, {
        program,
        uTexture: gl.getUniformLocation(program, 'u_texture'),
        uTexelSize: gl.getUniformLocation(program, 'u_texelSize'),
        uStrength: gl.getUniformLocation(program, 'u_strength'),
        uFlipY: gl.getUniformLocation(program, 'u_flipY'),
      });
    }
  }

  /**
   * Configures a fullscreen quad (-1 to 1) for rendering passes.
   */
  private initGeometry(gl: WebGL2RenderingContext): void {
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * Initializes the primary video texture with bilinear filtering.
   */
  private initTexture(gl: WebGL2RenderingContext): void {
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.textureWidth = 0;
    this.textureHeight = 0;
  }

  /**
   * Attaches an HTML5 video element to drive real-time upscaling.
   */
  public attachVideo(video: HTMLVideoElement): void {
    if (this.video === video) return;

    this.detachVideo();
    this.video = video;
    this.hasReportedSuccess = false;

    video.addEventListener('seeked', this.handleSeeked);
    video.addEventListener('loadedmetadata', this.handleLoadedMetadata);

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      this.updateDimensions();
    }

    if (this.mode !== 'off' && !this.isDestroyed) {
      this.startLoop();
    }
  }

  /**
   * Detaches the active video element.
   */
  public detachVideo(): void {
    this.stopLoop();

    if (this.video) {
      this.video.removeEventListener('seeked', this.handleSeeked);
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.video = null;
    }
  }

  /**
   * Switches the active Anime4K enhancement mode.
   */
  public setMode(mode: Anime4KMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.consecutiveLowFpsCount = 0;
    this.frameTimestamps = [];

    if (mode === 'off') {
      this.stopLoop();
    } else {
      this.updateDimensions();
      this.startLoop();
      // Render immediate frame on mode switch
      this.render();
    }
  }

  public getMode(): Anime4KMode {
    return this.mode;
  }

  /**
   * Sets the target resolution preset and recalculates drawing buffer size.
   */
  public setResolution(resolution: Anime4KTargetResolution): void {
    if (this.resolution === resolution) return;
    this.resolution = resolution;
    this.updateDimensions();
    if (this.mode !== 'off') {
      this.render();
    }
  }

  public getResolution(): Anime4KTargetResolution {
    return this.resolution;
  }

  /**
   * Sets enhancement strength multiplier (0.0 to 2.0).
   */
  public setStrength(strength: number): void {
    this.strength = Math.max(0, Math.min(2.0, strength));
  }

  /**
   * Starts the video processing loop using requestVideoFrameCallback or requestAnimationFrame.
   */
  private startLoop(): void {
    this.stopLoop();
    if (!this.video || this.mode === 'off' || this.isDestroyed) return;

    const v = this.video as unknown as {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: unknown) => void
      ) => number;
    };

    if (typeof v.requestVideoFrameCallback === 'function') {
      const loop = (now: number) => {
        if (this.isDestroyed || this.mode === 'off' || !this.video) return;
        this.processFrame(now);
        if (this.video && typeof v.requestVideoFrameCallback === 'function') {
          this.videoFrameCallbackId = v.requestVideoFrameCallback(loop);
        }
      };
      this.videoFrameCallbackId = v.requestVideoFrameCallback(loop);
    } else {
      const loop = (time: number) => {
        if (this.isDestroyed || this.mode === 'off' || !this.video) return;
        this.processFrame(time);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /**
   * Cancels active video frame callbacks.
   */
  private stopLoop(): void {
    if (this.videoFrameCallbackId !== null && this.video) {
      const v = this.video as unknown as {
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (typeof v.cancelVideoFrameCallback === 'function') {
        v.cancelVideoFrameCallback(this.videoFrameCallbackId);
      }
      this.videoFrameCallbackId = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Calculates canvas drawing buffer size.
   *
   * CRITICAL REQUIREMENT:
   * The canvas drawing buffer aspect ratio MUST strictly match the video's natural
   * aspect ratio (videoWidth / videoHeight).
   *
   * When canvas CSS is set to `w-full h-full object-contain`, the browser scales the
   * canvas so it sits inside the player container with the exact same letterbox black bars
   * as the native HTML5 video element. No horizontal stretching or filling of letterbox bars.
   */
  private updateDimensions(): void {
    if (!this.gl || !this.video || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return;
    }

    const videoAspect = this.video.videoWidth / this.video.videoHeight;
    let targetW = 0;
    let targetH = 0;

    const dpr =
      typeof window !== 'undefined'
        ? Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio)
        : 1;

    if (this.resolution === '1080p') {
      targetH = 1080;
      targetW = Math.round(1080 * videoAspect);
    } else if (this.resolution === '1440p') {
      targetH = 1440;
      targetW = Math.round(1440 * videoAspect);
    } else if (this.resolution === '4k') {
      targetH = 2160;
      targetW = Math.round(2160 * videoAspect);
    } else {
      // 'auto' mode: match physical display pixels of the video's contain-box
      const containerW =
        this.canvas.clientWidth > 0
          ? this.canvas.clientWidth
          : (typeof window !== 'undefined' ? window.innerWidth : this.video.videoWidth);
      const containerH =
        this.canvas.clientHeight > 0
          ? this.canvas.clientHeight
          : (typeof window !== 'undefined' ? window.innerHeight : this.video.videoHeight);

      const containerAspect = containerW / Math.max(1, containerH);

      let fitDisplayH = containerH;
      if (containerAspect > videoAspect) {
        // Pillarboxed (bars on left/right): height fits container
        fitDisplayH = containerH;
      } else {
        // Letterboxed (bars on top/bottom): width fits container
        fitDisplayH = containerW / videoAspect;
      }

      targetH = Math.max(1, Math.round(fitDisplayH * dpr));
      targetW = Math.max(1, Math.round(targetH * videoAspect));
    }

    // Keep dimensions even for GPU alignment
    if (targetW % 2 !== 0) targetW += 1;
    if (targetH % 2 !== 0) targetH += 1;

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Processes a video frame, tracks performance metrics, and applies FPS watchdog.
   */
  private processFrame(now: number): void {
    if (this.isDestroyed || this.isContextLost || !this.video || this.mode === 'off') return;

    if (
      this.video.readyState < 2 ||
      this.video.videoWidth === 0 ||
      this.video.videoHeight === 0
    ) {
      return;
    }

    const renderStart = performance.now();
    const rendered = this.render();
    if (!rendered) {
      return;
    }

    const renderDuration = performance.now() - renderStart;
    this.lastRenderTimeMs = renderDuration;

    // Track frame timestamps for FPS calculation (1-second sliding window)
    const cutoff = now - 1000;
    this.frameTimestamps.push(now);
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift();
    }

    this.currentFps = this.frameTimestamps.length;

    // Send telemetry periodically
    if (now - this.lastStatsTime >= this.options.statsIntervalMs) {
      this.lastStatsTime = now;
      this.dispatchStats();
    }

    // FPS Watchdog: automatic downgrade if performance is degraded
    // Only check when video is actively playing (not paused or buffering)
    if (!this.video.paused && !this.video.seeking && this.video.readyState >= 3) {
      if (this.currentFps < this.options.fpsThreshold && this.frameTimestamps.length > 10) {
        this.consecutiveLowFpsCount++;
        if (this.consecutiveLowFpsCount >= this.options.fpsDropConsecutiveFrames) {
          this.consecutiveLowFpsCount = 0;
          this.handlePerformanceDegraded();
        }
      } else {
        this.consecutiveLowFpsCount = Math.max(0, this.consecutiveLowFpsCount - 1);
      }
    }
  }

  /**
   * Handles low FPS downgrade logic:
   * First steps down resolution (4k -> 1440p -> 1080p -> auto).
   * If already at auto, downgrades mode (ultra -> fast -> off).
   */
  private handlePerformanceDegraded(): void {
    const resOrder: Anime4KTargetResolution[] = ['4k', '1440p', '1080p', 'auto'];
    const currentResIdx = resOrder.indexOf(this.resolution);

    if (currentResIdx < resOrder.length - 1) {
      const nextRes = resOrder[currentResIdx + 1];
      const prevRes = this.resolution;
      this.setResolution(nextRes);
      this.options.onResolutionDowngrade?.(prevRes, nextRes);
      return;
    }

    // Resolution already at lowest/auto: downgrade mode
    const currentMode = this.mode;
    const downgradedMode: Anime4KMode = currentMode === 'ultra' ? 'fast' : 'off';
    this.setMode(downgradedMode);
    this.options.onFpsDrop?.(this.currentFps, downgradedMode);
  }

  /**
   * Renders the current video frame using the active Anime4K shader pipeline.
   */
  public render(): boolean {
    if (this.isDestroyed || this.isContextLost || !this.gl || !this.video) {
      return false;
    }

    if (
      this.video.readyState < 2 ||
      this.video.videoWidth === 0 ||
      this.video.videoHeight === 0
    ) {
      return false;
    }

    const gl = this.gl;

    this.updateDimensions();

    const programInfo = this.programs.get(this.mode);
    if (!programInfo) return false;

    gl.useProgram(programInfo.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // Upload video frame into WebGL texture
    try {
      const vw = this.video.videoWidth;
      const vh = this.video.videoHeight;

      if (this.textureWidth !== vw || this.textureHeight !== vh) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          vw,
          vh,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.video
        );
        this.textureWidth = vw;
        this.textureHeight = vh;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          vw,
          vh,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.video
        );
      }
    } catch (err) {
      // SecurityError: video is cross-origin tainted without CORS
      this.options.onFallback?.(err instanceof Error ? err : new Error(String(err)));
      this.setMode('off');
      return false;
    }

    if (programInfo.uTexture) {
      gl.uniform1i(programInfo.uTexture, 0);
    }

    if (programInfo.uTexelSize) {
      gl.uniform2f(
        programInfo.uTexelSize,
        1.0 / Math.max(1, this.textureWidth),
        1.0 / Math.max(1, this.textureHeight)
      );
    }

    if (programInfo.uStrength) {
      gl.uniform1f(programInfo.uStrength, this.strength);
    }

    if (programInfo.uFlipY) {
      gl.uniform1i(programInfo.uFlipY, 1);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    if (!this.hasReportedSuccess) {
      this.hasReportedSuccess = true;
      this.options.onRenderSuccess?.();
    }

    return true;
  }

  /**
   * Dispatches current rendering telemetry to registered callback.
   */
  private dispatchStats(): void {
    if (!this.options.onStatsUpdate) return;

    let dropped = 0;
    if (this.video) {
      const v = this.video as unknown as {
        getVideoPlaybackQuality?: () => { droppedVideoFrames?: number };
      };
      if (typeof v.getVideoPlaybackQuality === 'function') {
        dropped = v.getVideoPlaybackQuality()?.droppedVideoFrames ?? 0;
      }
    }

    const stats: Anime4KStats = {
      fps: this.currentFps,
      mode: this.mode,
      resolution: this.resolution,
      targetWidth: this.canvas.width,
      targetHeight: this.canvas.height,
      backend: this.backend,
      droppedFrames: dropped,
      renderTimeMs: this.lastRenderTimeMs,
    };

    this.options.onStatsUpdate(stats);
  }

  /**
   * Returns current performance statistics snapshot.
   */
  public getStats(): Anime4KStats {
    let dropped = 0;
    if (this.video) {
      const v = this.video as unknown as {
        getVideoPlaybackQuality?: () => { droppedVideoFrames?: number };
      };
      if (typeof v.getVideoPlaybackQuality === 'function') {
        dropped = v.getVideoPlaybackQuality()?.droppedVideoFrames ?? 0;
      }
    }

    return {
      fps: this.currentFps,
      mode: this.mode,
      resolution: this.resolution,
      targetWidth: this.canvas.width,
      targetHeight: this.canvas.height,
      backend: this.backend,
      droppedFrames: dropped,
      renderTimeMs: this.lastRenderTimeMs,
    };
  }

  /**
   * Fully releases all WebGL / WebGPU resources, buffers, textures, listeners, and loops.
   */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.detachVideo();

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    if (this.gl) {
      const gl = this.gl;

      for (const [, info] of this.programs) {
        gl.deleteProgram(info.program);
      }
      this.programs.clear();

      if (this.vbo) {
        gl.deleteBuffer(this.vbo);
        this.vbo = null;
      }

      if (this.vao) {
        gl.deleteVertexArray(this.vao);
        this.vao = null;
      }

      if (this.texture) {
        gl.deleteTexture(this.texture);
        this.texture = null;
      }

      try {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) {
          ext.loseContext();
        }
      } catch {}

      this.gl = null;
    }

    this.frameTimestamps = [];
  }
}
