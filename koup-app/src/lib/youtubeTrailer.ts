/**
 * Clean YouTube trailer playback helpers (Vitrin / Kart / Player trailer mode)
 * -----------------------------------------------------------------------------
 * YouTube draws its own UI (big center play/pause button, spinner, title bar) *inside*
 * a cross-origin iframe. CSS/JS from our page can never reach into that iframe, so the
 * overlay cannot be "deleted". What we CAN do is never show the iframe while YouTube's
 * UI is on screen:
 *
 *  1. Keep the trailer invisible (opacity 0, backdrop image on top) until the video has
 *     *actually advanced* N seconds of real playback (measured via the player's
 *     currentTime, not a wall-clock timer — so slow networks / buffering can't leak the
 *     startup overlay anymore).
 *  2. Hide again instantly on pause / long buffering, and require a shorter real-playback
 *     window before re-revealing (resume bezel).
 *  3. Loop *before* the video ends (seekTo 0 at duration - 0.6s) so YouTube's end screen /
 *     replay button never renders.
 */

/** Seconds of real playback before the first reveal (ensures YouTube's center bezel and play button are 100% vanished). */
export const TRAILER_FIRST_REVEAL_SEC = 3.9;
/** Seconds of real playback before re-revealing after a pause / buffering stall. */
export const TRAILER_RESUME_REVEAL_SEC = 2.0;
/** Loop this many seconds before the end so the end screen never appears. */
export const TRAILER_LOOP_LEAD_SEC = 0.6;
/** If YouTube telemetry is blocked (adblock / privacy extensions), reveal after this many ms. */
export const TRAILER_TELEMETRY_FALLBACK_MS = 6000;

export function extractYouTubeId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const s = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/v=([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function buildModalTrailerEmbedUrl(youtubeId: string): string {
  const cleanId = extractYouTubeId(youtubeId) || youtubeId;
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    playsinline: '1',
    enablejsapi: '1',
    modestbranding: '1',
    hl: 'tr',
  });
  if (typeof window !== 'undefined') {
    params.set('origin', window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${cleanId}?${params.toString()}`;
}

export function buildCleanTrailerEmbedUrl(youtubeId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    modestbranding: '1',
    rel: '0',
    showinfo: '0',
    iv_load_policy: '3',
    playsinline: '1',
    enablejsapi: '1',
    cc_load_policy: '1',
    cc_lang_pref: 'tr',
    hl: 'tr',
  });
  if (typeof window !== 'undefined') {
    params.set('origin', window.location.origin);
    params.set('widget_referrer', window.location.origin);
  }
  return `https://www.youtube-nocookie.com/embed/${youtubeId}?${params.toString()}`;
}

export function postYouTubeCommand(
  iframe: HTMLIFrameElement | null | undefined,
  func: string,
  args: unknown[] = []
) {
  const win = iframe?.contentWindow;
  if (!win) return;
  try {
    win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  } catch {}
}

interface WatchOptions {
  /** Called with true once the trailer is safe to show, false whenever it must be hidden. */
  onVisibleChange: (visible: boolean) => void;
  firstRevealSec?: number;
  resumeRevealSec?: number;
}

/**
 * Attaches postMessage telemetry to a raw YouTube embed iframe (must have enablejsapi=1).
 * Call from the iframe's onLoad. Returns a cleanup function.
 */
export function watchYouTubeIframe(iframe: HTMLIFrameElement, opts: WatchOptions): () => void {
  const firstRevealSec = opts.firstRevealSec ?? TRAILER_FIRST_REVEAL_SEC;
  const resumeRevealSec = opts.resumeRevealSec ?? TRAILER_RESUME_REVEAL_SEC;

  let disposed = false;
  let gotTelemetry = false;
  let playerState = -1;
  let baseline: number | null = null;
  let duration = 0;
  let visible = false;
  let hasRevealedOnce = false;
  let bufferHideTimer: ReturnType<typeof setTimeout> | null = null;
  let playRevealTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLoopAt = 0;

  const setVisible = (v: boolean) => {
    if (disposed || visible === v) return;
    visible = v;
    if (v) hasRevealedOnce = true;
    opts.onVisibleChange(v);
  };

  const clearPlayReveal = () => {
    if (playRevealTimer) {
      clearTimeout(playRevealTimer);
      playRevealTimer = null;
    }
  };

  const handleState = (state: number) => {
    if (state === playerState) return;
    playerState = state;

    if (state === 1) {
      if (bufferHideTimer) {
        clearTimeout(bufferHideTimer);
        bufferHideTimer = null;
      }
      // Fresh real-playback window starts on the next currentTime tick
      if (!visible) {
        baseline = null;
        clearPlayReveal();
        // Reliable fallback countdown in continuous PLAYING state:
        // YouTube's center play button fadeout finishes in 1.0 - 1.2s.
        // At 1.35s (first) or 0.7s (resume), reveal is guaranteed clean!
        const delayMs = (hasRevealedOnce ? resumeRevealSec : firstRevealSec) * 1000;
        playRevealTimer = setTimeout(() => {
          if (!disposed && playerState === 1) {
            setVisible(true);
          }
        }, delayMs);
      }
      return;
    }

    clearPlayReveal();

    if (state === 3) {
      // Short buffers are fine; only hide if YouTube's spinner would stay visible
      if (bufferHideTimer) clearTimeout(bufferHideTimer);
      bufferHideTimer = setTimeout(() => {
        if (playerState === 3) {
          baseline = null;
          setVisible(false);
        }
      }, 450);
      return;
    }

    if (state === 0) {
      // Fallback if pre-end loop missed: restart silently, stay hidden until clean again
      baseline = null;
      setVisible(false);
      postYouTubeCommand(iframe, 'seekTo', [0, true]);
      postYouTubeCommand(iframe, 'playVideo');
      return;
    }

    // -1 unstarted, 2 paused, 5 cued → hide immediately (pause bezel / big play button)
    baseline = null;
    setVisible(false);
  };

  const handleTime = (t: number) => {
    if (playerState !== 1 || !Number.isFinite(t)) return;

    if (!visible) {
      if (baseline === null || t < baseline) {
        baseline = t;
        return;
      }
      const need = hasRevealedOnce ? resumeRevealSec : firstRevealSec;
      if (t - baseline >= need) {
        clearPlayReveal();
        setVisible(true);
      }
    }

    // Seamless loop before YouTube's end screen can render
    if (duration > 5 && t >= duration - TRAILER_LOOP_LEAD_SEC) {
      const now = Date.now();
      if (now - lastLoopAt > 2000) {
        lastLoopAt = now;
        postYouTubeCommand(iframe, 'seekTo', [0, true]);
      }
    }
  };

  const onMessage = (e: MessageEvent) => {
    if (disposed || e.source !== iframe.contentWindow) return;
    let d: any;
    try {
      d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!d || typeof d !== 'object') return;
    gotTelemetry = true;

    if (d.event === 'onStateChange' && typeof d.info === 'number') {
      handleState(d.info);
    } else if ((d.event === 'infoDelivery' || d.event === 'initialDelivery') && d.info) {
      if (typeof d.info.duration === 'number' && d.info.duration > 0) duration = d.info.duration;
      if (typeof d.info.playerState === 'number') handleState(d.info.playerState);
      if (typeof d.info.currentTime === 'number') handleTime(d.info.currentTime);
    }
  };

  window.addEventListener('message', onMessage);

  // Handshake: ask the widget to start streaming state + currentTime to us
  const listenId = `koup-${Math.random().toString(36).slice(2)}`;
  const handshake = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage(JSON.stringify({ event: 'listening', id: listenId, channel: 'widget' }), '*');
      win.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: listenId, channel: 'widget' }),
        '*'
      );
    } catch {}
  };
  handshake();
  let pings = 0;
  const pingTimer = setInterval(() => {
    if (disposed || gotTelemetry || ++pings > 30) {
      clearInterval(pingTimer);
      return;
    }
    handshake();
  }, 250);

  const fallbackTimer = setTimeout(() => {
    if (!gotTelemetry) setVisible(true);
  }, TRAILER_TELEMETRY_FALLBACK_MS);

  return () => {
    disposed = true;
    window.removeEventListener('message', onMessage);
    clearInterval(pingTimer);
    clearTimeout(fallbackTimer);
    clearPlayReveal();
    if (bufferHideTimer) clearTimeout(bufferHideTimer);
  };
}
