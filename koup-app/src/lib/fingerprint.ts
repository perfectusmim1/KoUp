/**
 * KoUp Client Device / Browser Fingerprint Generator
 * Generates a stable deterministic hardware & browser profile hash
 * for 2-tier security and Hard Ban (Cihaz / IP Ban) enforcement.
 */

async function sha256(str: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const buffer = new TextEncoder().encode(str);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }

  // FNV-1a 32-bit hash fallback expanded to hex
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul ? Math.imul(h1, 0x01000193) : (h1 * 0x01000193) >>> 0;
    h2 ^= ch;
    h2 = Math.imul ? Math.imul(h2, 0x01000193) : (h2 * 0x01000193) >>> 0;
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}${str.length.toString(16)}`;
}

export async function getClientFingerprint(): Promise<string> {
  if (typeof window === 'undefined') {
    return 'ssr_server_context';
  }

  try {
    const cached = localStorage.getItem('koup_device_fingerprint_v1');
    if (cached && cached.length >= 16) {
      return cached;
    }
  } catch {
    // ignore storage access error
  }

  const components: string[] = [];

  try {
    components.push(`ua:${navigator.userAgent}`);
    components.push(`lang:${navigator.language || (navigator as any).userLanguage || ''}`);
    components.push(`platform:${navigator.platform || ''}`);
    components.push(`concurrency:${navigator.hardwareConcurrency || 4}`);
    components.push(`memory:${(navigator as any).deviceMemory || 8}`);
    components.push(`screen:${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`);
    components.push(`pixelRatio:${window.devicePixelRatio || 1}`);
    components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone || ''}`);

    // Canvas fingerprinting
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 30, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('KoUp,Cinema~2026', 2, 8);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('KoUp,Cinema~2026', 4, 10);
      components.push(`canvas:${canvas.toDataURL()}`);
    }
  } catch {
    // Continue with available components
  }

  const rawString = components.join('|||');
  const fpHash = await sha256(rawString);

  try {
    localStorage.setItem('koup_device_fingerprint_v1', fpHash);
  } catch {}

  return fpHash;
}
