import { NextRequest, NextResponse } from 'next/server';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max to prevent memory exhaustion

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.home$/i,
  /\.arpa$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
];

function isBlockedIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Explicit host patterns
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }

  // Exact IP / hostname blocks
  if (['127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata'].includes(host)) {
    return true;
  }

  // IPv4 Private & Loopback & Link-Local & CGNAT regex
  // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, 0.0.0.0/8
  const ipv4PrivateRegex =
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(?:6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|0\.)/;
  if (ipv4PrivateRegex.test(host)) {
    return true;
  }

  // IPv6 Private & Loopback (fc00::/7, fe80::/10, ::1, ::ffff:127.0.0.1)
  if (host.startsWith('::') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }

  // Obfuscated / integer decimal IP format (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) {
    return true;
  }

  return false;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

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

export const revalidate = 2592000; // 30 days

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');
  const fallbackUrl = searchParams.get('fallback');

  if (!targetUrl) {
    return new NextResponse(FALLBACK_SVG, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=2592000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const urlsToTry = [targetUrl];
  if (fallbackUrl && fallbackUrl !== targetUrl) {
    urlsToTry.push(fallbackUrl);
  }

  for (const rawUrl of urlsToTry) {
    try {
      const parsed = new URL(rawUrl);

      // 1. Restrict protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        continue;
      }

      // 2. Restrict ports (only standard HTTP/HTTPS ports)
      if (parsed.port && !['80', '443'].includes(parsed.port)) {
        continue;
      }

      // 3. Block private IPs & localhost (SSRF protection)
      if (isBlockedIpOrHost(parsed.hostname)) {
        continue;
      }

      const resp = await fetch(parsed.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Referer: `${parsed.protocol}//${parsed.hostname}/`,
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!resp.ok) continue;

      // 4. Validate Content-Length before downloading large buffers
      const contentLengthHeader = resp.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > MAX_IMAGE_SIZE_BYTES) {
          continue;
        }
      }

      // 5. Validate Content-Type
      const rawContentType = (resp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
      const isAllowedType = ALLOWED_CONTENT_TYPES.has(rawContentType) || rawContentType.startsWith('image/');
      if (!isAllowedType) {
        continue;
      }

      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 100 || buf.byteLength > MAX_IMAGE_SIZE_BYTES) {
        continue;
      }

      // If SVG, ensure it is sanitized/sandboxed
      const headers: Record<string, string> = {
        'Content-Type': rawContentType.startsWith('image/') ? rawContentType : 'image/jpeg',
        'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      };

      if (rawContentType === 'image/svg+xml') {
        headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
      }

      return new NextResponse(buf, {
        status: 200,
        headers,
      });
    } catch {
      // Try next fallback
    }
  }

  return new NextResponse(FALLBACK_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
