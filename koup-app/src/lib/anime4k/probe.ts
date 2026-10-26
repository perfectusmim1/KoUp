/**
 * Anime4K Video Source GPU-Readability Probe
 *
 * Verifies whether the active HTML5 video element frames can be ingested into GPU
 * textures without triggering cross-origin SecurityError exceptions (tainted canvas).
 *
 * Readable sources:
 * - HLS.js / MediaSource blobs (`blob:http...`)
 * - Same-origin streams (`/api/stream-proxy`, local origin)
 * - Cross-origin streams with proper CORS headers
 *
 * Non-readable sources:
 * - Direct MP4 files hosted on foreign CDNs without Access-Control-Allow-Origin (e.g. Tau Video)
 */

export async function probeVideoSourceReadable(video: HTMLVideoElement): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  if (!video || !video.src && video.currentSrc === '') {
    return false;
  }

  // Ensure video has decoded frame data ready
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    try {
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const onReady = () => {
          cleanup();
          resolve();
        };

        const onError = () => {
          cleanup();
          reject(new Error('Video load error during probe'));
        };

        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onError);
          if (timer) clearTimeout(timer);
        };

        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }

        video.addEventListener('loadeddata', onReady, { once: true });
        video.addEventListener('canplay', onReady, { once: true });
        video.addEventListener('error', onError, { once: true });
        timer = setTimeout(() => {
          cleanup();
          // Timeout waiting for frame data: treat as unreadable to be safe
          resolve();
        }, 3000);
      });
    } catch {
      return false;
    }
  }

  if (video.videoWidth === 0 || video.videoHeight === 0) {
    return false;
  }

  // Create lightweight 1x1 test canvas
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  let gl: WebGL2RenderingContext | null = null;
  let tex: WebGLTexture | null = null;

  try {
    gl = canvas.getContext('webgl2', {
      powerPreference: 'low-power',
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      // Fallback probe via 2D canvas getImageData (also throws SecurityError on tainted media)
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return false;
      ctx2d.drawImage(video, 0, 0, 1, 1);
      ctx2d.getImageData(0, 0, 1, 1); // Throws SecurityError if cross-origin tainted
      return true;
    }

    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // This call attempts to upload video frame pixels into WebGL texture.
    // If video is tainted cross-origin without CORS, the browser throws DOMException SecurityError.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);

    return true;
  } catch (err: unknown) {
    // DOMException SecurityError or WebGL upload rejection
    return false;
  } finally {
    if (gl) {
      try {
        if (tex) gl.deleteTexture(tex);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      } catch {}
    }
    canvas.width = 0;
    canvas.height = 0;
  }
}
