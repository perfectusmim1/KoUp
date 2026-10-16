'use client';

export type SoundTone = 'apple_glass' | 'soft_chime' | 'minimal_pop';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function playNotificationChime(
  tone: SoundTone = 'apple_glass',
  volume = 0.7,
  muteDuringFullscreen = true
) {
  if (typeof window === 'undefined') return;
  if (muteDuringFullscreen && document.fullscreenElement) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (tone === 'apple_glass') {
      // Crystal harmonic dual-note Apple TV+ glass chime
      const freqs = [1046.5, 1567.98, 2093.0];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const noteGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now + idx * 0.055);
        noteGain.gain.setValueAtTime(0.0001, now + idx * 0.055);
        noteGain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.22), now + idx * 0.055 + 0.02);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.055 + 0.55);
        osc.connect(noteGain);
        noteGain.connect(ctx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.6);
      });
    } else if (tone === 'soft_chime') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.25), now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.48);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.08);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.3), now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.16);
    }
  } catch {
    // Ignore audio autoplay block if user hasn't interacted yet
  }
}
