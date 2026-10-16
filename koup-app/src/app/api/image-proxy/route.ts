import { NextRequest, NextResponse } from 'next/server';

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
];

function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTS.includes(hostname.toLowerCase())) return true;
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(hostname)) {
    return true;
  }
  return false;
}

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#141418"/>
      <stop offset="50%" stop-color="#0d0d11"/>
      <stop offset="100%" stop-color="#08080a"/>
    </linearGradient>
    <linearGradient id="beam" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#E5A93C" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <polygon points="120,620 480,220 530,270 180,660" fill="url(#beam)"/>
  <text x="300" y="450" text-anchor="middle" fill="#ffffff" fill-opacity="0.82" font-family="sans-serif" font-weight="800" font-size="64" letter-spacing="6">KoUp</text>
  <text x="300" y="495" text-anchor="middle" fill="#a1a1aa" fill-opacity="0.6" font-family="sans-serif" font-weight="500" font-size="18" letter-spacing="4">CINEMA ARCHIVE</text>
</svg>`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  const fallbackUrl = searchParams.get('fallback');

  if (!targetUrl) {
    return new NextResponse(FALLBACK_SVG, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    });
  }

  const urlsToTry = [targetUrl];
  if (fallbackUrl && fallbackUrl !== targetUrl) {
    urlsToTry.push(fallbackUrl);
  }

  for (const rawUrl of urlsToTry) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      if (isPrivateIp(parsed.hostname)) continue;

      const resp = await fetch(parsed.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Referer: `${parsed.protocol}//${parsed.hostname}/`,
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
        continue;
      }

      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 100) continue;

      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': contentType.startsWith('image/') ? contentType : 'image/jpeg',
          'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=86400, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch {
      // Try next URL in fallback chain
    }
  }

  return new NextResponse(FALLBACK_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
