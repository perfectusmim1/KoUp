/**
 * Anime4K WebGL 2.0 Renderer
 *
 * High-performance, zero-memory-leak WebGL 2.0 renderer applying real-time
 * Anime4K upscaling, line reconstruction, and edge sharpening to HTML5 video.
 */

import { Anime4KMode, Anime4KOptions, Anime4KStats } from './types';
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
  private options: Required<Omit<Anime4KOptions, 'onFpsDrop' | 'onError' | 'onStatsUpdate'>> &
    Pick<Anime4KOptions, 'onFpsDrop' | 'onError' | 'onStatsUpdate'>;

  private gl: WebGL2RenderingContext;
  private mode: Anime4KMode;
  private strength: number;

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

  // FPS Watchdog & Performance Metrics
  private frameTimestamps: number[] = [];
  private consecutiveLowFpsCount = 0;
  private lastStatsTime = 0;
  private lastRenderTimeMs = 0;

  // Bound event handlers for clean removal
  private handleContextLost: (e: Event) => void;
  private handleContextRestored: () => void;
  private handleSeeked: () => void;
  private handleLoadedMetadata: () => void;

  /**
   * Safe check for WebGL 2.0 availability in the current environment.
   */
  public static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return false;
    }
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
    this.canvas = canvas;
    this.options = {
      initialMode: options?.initialMode ?? 'fast',
      fpsThreshold: options?.fpsThreshold ?? 23,
      fpsDropConsecutiveFrames: options?.fpsDropConsecutiveFrames ?? 45,
      strength: options?.strength ?? 1.0,
      statsIntervalMs: options?.statsIntervalMs ?? 500,
      maxPixelRatio: options?.maxPixelRatio ?? 2.0,
      onFpsDrop: options?.onFpsDrop,
      onError: options?.onError,
      onStatsUpdate: options?.onStatsUpdate,
    };

    this.mode = this.options.initialMode;
    this.strength = Math.max(0.0, Math.min(2.0, this.options.strength));

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      const err = new Error('WebGL 2.0 context could not be initialized.');
      this.options.onError?.(err);
      throw err;
    }

    this.gl = gl;

    // Context loss handlers
    this.handleContextLost = (e: Event) => {
      e.preventDefault();
      this.isContextLost = true;
      this.options.onError?.(new Error('WebGL context was lost.'));
    };

    this.handleContextRestored = () => {
      this.isContextLost = false;
      try {
        this.initWebGLResources();
        this.requestRender();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.options.onError?.(error);
      }
    };

    this.handleSeeked = () => {
      this.requestRender();
    };

    this.handleLoadedMetadata = () => {
      this.updateDimensions();
      this.requestRender();
    };

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    // Initialize shaders, geometry, and textures
    try {
      this.initWebGLResources();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError?.(error);
      throw error;
    }
  }

  /**
   * Initializes or recreates all WebGL programs, buffers, and textures.
   */
  private initWebGLResources(): void {
    const gl = this.gl;

    // Clean existing programs if any
    for (const info of this.programs.values()) {
      gl.deleteProgram(info.program);
    }
    this.programs.clear();

    // Compile programs for all modes
    this.programs.set('off', this.buildProgramInfo(PASSTHROUGH_FRAGMENT_SHADER_SOURCE));
    this.programs.set('fast', this.buildProgramInfo(FAST_FRAGMENT_SHADER_SOURCE));
    this.programs.set('ultra', this.buildProgramInfo(ULTRA_FRAGMENT_SHADER_SOURCE));

    // Fullscreen quad VAO & VBO setup
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    // 2 triangles covering [-1, 1] clip space
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Texture allocation
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.textureWidth = 0;
    this.textureHeight = 0;
  }

  /**
   * Compiles and inspects uniform locations for a shader pass.
   */
  private buildProgramInfo(fragmentShaderSource: string): ProgramInfo {
    const gl = this.gl;
    const program = createProgram(gl, VERTEX_SHADER_SOURCE, fragmentShaderSource);

    return {
      program,
      uTexture: gl.getUniformLocation(program, 'u_texture'),
      uTexelSize: gl.getUniformLocation(program, 'u_texelSize'),
      uStrength: gl.getUniformLocation(program, 'u_strength'),
      uFlipY: gl.getUniformLocation(program, 'u_flipY'),
    };
  }

  /**
   * Attaches an HTML5 video element and starts processing frames.
   */
  public attachVideo(video: HTMLVideoElement): void {
    if (this.isDestroyed) return;

    if (this.video) {
      this.detachVideo();
    }

    this.video = video;
    this.frameTimestamps = [];
    this.consecutiveLowFpsCount = 0;

    video.addEventListener('seeked', this.handleSeeked);
    video.addEventListener('loadedmetadata', this.handleLoadedMetadata);

    if (video.readyState >= 1) {
      this.updateDimensions();
    }

    this.startLoop();
  }

  /**
   * Detaches the currently attached video and cancels frame callbacks.
   */
  public detachVideo(): void {
    this.stopLoop();

    if (this.video) {
      this.video.removeEventListener('seeked', this.handleSeeked);
      this.video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.video = null;
    }

    this.frameTimestamps = [];
    this.consecutiveLowFpsCount = 0;
  }

  /**
   * Starts video frame callbacks using requestVideoFrameCallback when supported,
   * falling back to requestAnimationFrame.
   */
  private startLoop(): void {
    if (this.isDestroyed || !this.video) return;

    const video = this.video;
    const hasVFC =
      typeof (video as unknown as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function' &&
      typeof (video as unknown as { cancelVideoFrameCallback?: unknown }).cancelVideoFrameCallback === 'function';

    if (hasVFC) {
      const vfcCallback = (now: DOMHighResTimeStamp) => {
        if (this.isDestroyed || !this.video) return;
        this.processFrame(now);
        this.videoFrameCallbackId = (
          this.video as unknown as {
            requestVideoFrameCallback: (cb: (now: number, meta: unknown) => void) => number;
          }
        ).requestVideoFrameCallback(vfcCallback);
      };
      this.videoFrameCallbackId = (
        video as unknown as {
          requestVideoFrameCallback: (cb: (now: number, meta: unknown) => void) => number;
        }
      ).requestVideoFrameCallback(vfcCallback);
    } else {
      const rafCallback = (now: DOMHighResTimeStamp) => {
        if (this.isDestroyed || !this.video) return;
        this.processFrame(now);
        this.rafId = requestAnimationFrame(rafCallback);
      };
      this.rafId = requestAnimationFrame(rafCallback);
    }
  }

  /**
   * Cancels active video frame or requestAnimationFrame callbacks.
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
   * Updates canvas buffer size and WebGL viewport to match video or display size.
   */
  private updateDimensions(): void {
    if (!this.video || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return;
    }

    const dpr =
      typeof window !== 'undefined'
        ? Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio)
        : 1;

    const displayW = this.canvas.clientWidth > 0 ? this.canvas.clientWidth : this.video.videoWidth;
    const displayH = this.canvas.clientHeight > 0 ? this.canvas.clientHeight : this.video.videoHeight;

    const targetWidth = Math.max(1, Math.round(displayW * dpr));
    const targetHeight = Math.max(1, Math.round(displayH * dpr));

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Processes a video frame, tracks performance metrics, and applies FPS watchdog.
   */
  private processFrame(now: number): void {
    if (this.isDestroyed || this.isContextLost || !this.video) return;

    // Only render when video has valid dimensions and frame data
    if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return;
    }

    const renderStart = performance.now();
    try {
      this.render();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError?.(error);
    }
    this.lastRenderTimeMs = performance.now() - renderStart;

    // Record timestamp for FPS tracking
    this.frameTimestamps.push(now);
    while (this.frameTimestamps.length > 0 && now - this.frameTimestamps[0] > 1200) {
      this.frameTimestamps.shift();
    }

    let currentFps = 60;
    if (this.frameTimestamps.length >= 2) {
      const windowDurationSec = (now - this.frameTimestamps[0]) / 1000;
      if (windowDurationSec > 0) {
        currentFps = (this.frameTimestamps.length - 1) / windowDurationSec;
      }
    }

    // FPS Watchdog: active during playback when enhancement is enabled
    const isPlaying = !this.video.paused && !this.video.ended && this.video.readyState >= 2;
    if (isPlaying && this.mode !== 'off') {
      if (currentFps < this.options.fpsThreshold) {
        this.consecutiveLowFpsCount++;
        if (this.consecutiveLowFpsCount >= this.options.fpsDropConsecutiveFrames) {
          const droppedFps = Math.round(currentFps);
          this.options.onFpsDrop?.(droppedFps);

          // Downgrade quality
          if (this.mode === 'ultra') {
            this.setMode('fast');
          } else if (this.mode === 'fast') {
            this.setMode('off');
          }

          this.consecutiveLowFpsCount = 0;
        }
      } else {
        this.consecutiveLowFpsCount = Math.max(0, this.consecutiveLowFpsCount - 1);
      }
    } else {
      this.consecutiveLowFpsCount = 0;
    }

    // Periodic statistics update
    if (this.options.onStatsUpdate && now - this.lastStatsTime >= this.options.statsIntervalMs) {
      this.lastStatsTime = now;
      let droppedFrames = 0;

      if (
        typeof (
          this.video as unknown as {
            getVideoPlaybackQuality?: () => { droppedVideoFrames?: number };
          }
        ).getVideoPlaybackQuality === 'function'
      ) {
        const quality = (
          this.video as unknown as {
            getVideoPlaybackQuality: () => { droppedVideoFrames?: number };
          }
        ).getVideoPlaybackQuality();
        droppedFrames = quality.droppedVideoFrames ?? 0;
      }

      this.options.onStatsUpdate({
        fps: Math.round(currentFps),
        mode: this.mode,
        droppedFrames,
        renderTimeMs: Math.round(this.lastRenderTimeMs * 100) / 100,
      });
    }
  }

  /**
   * Internal render execution: uploads video texture and renders fullscreen quad with active shader.
   */
  private render(): void {
    const gl = this.gl;
    const video = this.video;
    if (!video || !this.texture || !this.vao) return;

    this.updateDimensions();

    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    // Efficient texture upload: reallocation on size change, subimage update otherwise
    if (this.textureWidth !== video.videoWidth || this.textureHeight !== video.videoHeight) {
      this.textureWidth = video.videoWidth;
      this.textureHeight = video.videoHeight;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    }

    const programInfo = this.programs.get(this.mode) || this.programs.get('off');
    if (!programInfo) return;

    gl.useProgram(programInfo.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (programInfo.uTexture) {
      gl.uniform1i(programInfo.uTexture, 0);
    }

    if (programInfo.uFlipY) {
      // 1 flattens top-of-video to top-of-quad without UNPACK_FLIP_Y overhead
      gl.uniform1i(programInfo.uFlipY, 1);
    }

    if (programInfo.uTexelSize && this.textureWidth > 0 && this.textureHeight > 0) {
      gl.uniform2f(
        programInfo.uTexelSize,
        1.0 / this.textureWidth,
        1.0 / this.textureHeight
      );
    }

    if (programInfo.uStrength) {
      gl.uniform1f(programInfo.uStrength, this.strength);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /**
   * Manually triggers a single frame render (useful when video is paused or seeking).
   */
  public requestRender(): void {
    if (this.isDestroyed || this.isContextLost) return;
    try {
      this.render();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError?.(error);
    }
  }

  /**
   * Sets the active Anime4K enhancement mode.
   */
  public setMode(mode: Anime4KMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.consecutiveLowFpsCount = 0;
    this.requestRender();
  }

  /**
   * Gets the active Anime4K enhancement mode.
   */
  public getMode(): Anime4KMode {
    return this.mode;
  }

  /**
   * Sets enhancement strength multiplier (0.0 to 2.0).
   */
  public setStrength(strength: number): void {
    this.strength = Math.max(0.0, Math.min(2.0, strength));
    this.requestRender();
  }

  /**
   * Gets current enhancement strength multiplier.
   */
  public getStrength(): number {
    return this.strength;
  }

  /**
   * Disposes all WebGL buffers, textures, shaders, and frame callbacks.
   * Completely frees GPU resources with WEBGL_lose_context.
   */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.detachVideo();

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    const gl = this.gl;
    if (gl) {
      if (this.texture) {
        gl.deleteTexture(this.texture);
        this.texture = null;
      }

      if (this.vbo) {
        gl.deleteBuffer(this.vbo);
        this.vbo = null;
      }

      if (this.vao) {
        gl.deleteVertexArray(this.vao);
        this.vao = null;
      }

      for (const info of this.programs.values()) {
        gl.deleteProgram(info.program);
      }
      this.programs.clear();

      try {
        const loseExt = gl.getExtension('WEBGL_lose_context');
        if (loseExt) {
          loseExt.loseContext();
        }
      } catch {
        // Ignore errors during loseContext on teardown
      }
    }

    this.frameTimestamps = [];
  }
}
