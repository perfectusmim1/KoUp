import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns';
import net from 'node:net';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

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

function stripIpv6ZoneAndBrackets(raw: string): string {
  return raw.toLowerCase().trim().replace(/^\[|\]$/g, '').split('%')[0];
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // Multicast & reserved (224.0.0.0/4+)
  return false;
}

function isBlockedIpAddress(rawIp: string): boolean {
  const ip = stripIpv6ZoneAndBrackets(rawIp);
  if (!ip) return true;

  if (net.isIPv4(ip)) {
    return isBlockedIpv4(ip);
  }
  if (!net.isIPv6(ip)) {
    return true;
  }

  // Unspecified / Loopback
  if (ip === '::' || ip === '::1' || ip === '0:0:0:0:0:0:0:0' || ip === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:127.0.0.1, ::ffff:7f00:1, ::127.0.0.1)
  const v4Dotted = ip.match(/(?:^::(?:ffff:)?|:)([0-9]{1,3}(?:\.[0-9]{1,3}){3})$/);
  if (v4Dotted?.[1]) {
    return isBlockedIpv4(v4Dotted[1]);
  }
  const v4Hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4Hex) {
    const hi = parseInt(v4Hex[1], 16);
    const lo = parseInt(v4Hex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }

  // Extract first 16-bit group for CIDR prefix checks
  const firstGroupHex = ip.split(':')[0] || '0';
  const firstGroup = parseInt(firstGroupHex, 16);
  if (Number.isNaN(firstGroup)) return true;

  // ULA fc00::/7 (0xfc00 .. 0xfdff)
  if ((firstGroup & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10 (0xfe80 .. 0xfebf)
  if ((firstGroup & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((firstGroup & 0xff00) === 0xff00) return true;
  // NAT64 well-known prefix 64:ff9b::/96
  if (ip.startsWith('64:ff9b::') || ip.startsWith('64:ff9b:1::')) return true;

  return false;
}

function isBlockedIpOrHost(hostname: string): boolean {
  const host = stripIpv6ZoneAndBrackets(hostname);
  if (!host) return true;
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }
  if (['127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata'].includes(host)) {
    return true;
  }
  if (net.isIP(host) !== 0) {
    return isBlockedIpAddress(host);
  }
  // Block integer/hex/octal IP shorthands
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(host)) return true;
  if (/^\d+\.\d+$/.test(host) || /^\d+\.\d+\.\d+$/.test(host)) return true;
  return false;
}

async function isBlockedAfterDnsLookup(hostname: string): Promise<boolean> {
  const host = stripIpv6ZoneAndBrackets(hostname);
  if (isBlockedIpOrHost(host)) return true;
  if (net.isIP(host) !== 0) {
    return isBlockedIpAddress(host);
  }
  try {
    const records = await dns.promises.lookup(host, { all: true });
    if (!records || records.length === 0) return true;
    return records.some((rec) => isBlockedIpAddress(rec.address));
  } catch {
    return true;
  }
}

class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

async function safeFetchWithRedirects(
  initialUrl: string,
  init: RequestInit,
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new SsrfBlockedError('Blocked protocol');
    }
    if (await isBlockedAfterDnsLookup(parsed.hostname)) {
      throw new SsrfBlockedError('Blocked SSRF target');
    }

    const res = await fetch(currentUrl, currentInit);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      res.body?.cancel?.().catch(() => {});
      if (!location || hop === maxRedirects) {
        return { response: res, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).toString();
      if ([301, 302, 303].includes(res.status) && currentInit.method && currentInit.method !== 'GET' && currentInit.method !== 'HEAD') {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      continue;
    }

    return { response: res, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

function isInvalidPlaylistBody(body: string): boolean {
  const trimmed = body.trim();
  const low = trimmed.toLowerCase();
  if (!trimmed) return true;
  if (low.includes('security error')) return true;
  if (low.startsWith('<!doctype') || low.startsWith('<html')) return true;
  return !body.includes('#EXTM3U') && !body.includes('#EXTINF');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let targetUrl = searchParams.get('url');
  const customRef = searchParams.get('ref');
  const embedUrl = searchParams.get('embed');
  const requestedQuality = searchParams.get('q') || 'hd';
  const shzCookie = searchParams.get('shz_cookie') || '';
  const dtCookie = searchParams.get('dt_cookie') || '';

  if (targetUrl && !targetUrl.startsWith('http')) {
    if (targetUrl.startsWith('//')) {
      targetUrl = `https:${targetUrl}`;
    } else if (targetUrl.startsWith('/') && customRef && customRef.startsWith('http')) {
      try {
        const refOrigin = new URL(customRef).origin;
        targetUrl = `${refOrigin}${targetUrl}`;
      } catch {}
    }
  }

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
  }

  try {
    const parsedTarget = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedTarget.protocol) || (await isBlockedAfterDnsLookup(parsedTarget.hostname))) {
      return NextResponse.json({ error: 'Blocked host or protocol' }, { status: 403 });
    }

    // Determine the proper Referer & Origin to bypass hotlink protection
    let referer = 'https://dizikorea3.com/';
    let origin = 'https://dizikorea3.com';

    if (customRef && customRef.startsWith('http')) {
      try {
        const refParsed = new URL(customRef);
        referer = customRef;
        origin = `${refParsed.protocol}//${refParsed.host}`;
      } catch {}
    } else if (targetUrl.includes('dizikorea')) {
      referer = 'https://dizikorea3.com/';
      origin = 'https://dizikorea3.com';
    } else if (targetUrl.includes('diziyou')) {
      referer = 'https://diziyou.one/';
      origin = 'https://diziyou.one';
    } else if (
      targetUrl.includes('dizibox') ||
      targetUrl.includes('molystream') ||
      (targetUrl.includes('/v/') && (targetUrl.includes('.xyz') || targetUrl.includes('dby')))
    ) {
      referer = 'https://dbx.molystream.org/';
      origin = 'https://dbx.molystream.org';
    } else if (
      targetUrl.includes('morencius') ||
      targetUrl.includes('acek-cdn') ||
      targetUrl.includes('dramiyos') ||
      targetUrl.includes('videopixelvanto') ||
      targetUrl.includes('smartcheckout.shop') ||
      targetUrl.includes('fastsupplyhub.shop')
    ) {
      referer = 'https://morencius.com/';
      origin = 'https://morencius.com';
    } else if (targetUrl.includes('gdriveplayer') || targetUrl.includes('stream121')) {
      referer = 'https://gdriveplayer.to/';
      origin = 'https://gdriveplayer.to';
    } else if (targetUrl.includes('ciner') || targetUrl.includes('showtv')) {
      referer = 'https://www.showtv.com.tr/';
      origin = 'https://www.showtv.com.tr';
    } else if (targetUrl.includes('mncdn') || targetUrl.includes('puhu')) {
      referer = 'https://puhu.tv/';
      origin = 'https://puhu.tv';
    } else if (targetUrl.includes('tabii')) {
      referer = 'https://www.tabii.com/';
      origin = 'https://www.tabii.com';
    } else if (targetUrl.includes('twimg') || targetUrl.includes('twitter')) {
      referer = 'https://twitter.com/';
      origin = 'https://twitter.com';
    } else if (targetUrl.includes('yandex') || targetUrl.includes('yadi.sk')) {
      referer = 'https://disk.yandex.com.tr/';
      origin = 'https://disk.yandex.com.tr';
    } else if (targetUrl.includes('tranimeizle')) {
      referer = 'https://tranimeizle.net/';
      origin = 'https://tranimeizle.net';
    } else if (targetUrl.includes('animecix') || targetUrl.includes('tau-video')) {
      referer = 'https://animecix.net/';
      origin = 'https://animecix.net';
    } else if (targetUrl.includes('mail.ru')) {
      referer = 'https://my.mail.ru/';
      origin = 'https://my.mail.ru';
    } else if (targetUrl.includes('uqload')) {
      referer = 'https://uqload.vc/';
      origin = 'https://uqload.vc';
    } else if (
      targetUrl.includes('vidmoly') ||
      targetUrl.includes('vmoly') ||
      targetUrl.includes('vmpx')
    ) {
      referer = 'https://vidmoly.org/';
      origin = 'https://vidmoly.org';
    } else if (
      targetUrl.includes('filemoon') ||
      targetUrl.includes('byse') ||
      targetUrl.includes('owphbf24') ||
      targetUrl.includes('sprintcdn')
    ) {
      referer = 'https://filemoon.sx/';
      origin = 'https://filemoon.sx';
    } else if (targetUrl.includes('sendvid')) {
      referer = 'https://sendvid.com/';
      origin = 'https://sendvid.com';
    } else if (targetUrl.includes('yourupload')) {
      referer = 'https://www.yourupload.com/';
      origin = 'https://www.yourupload.com';
    } else if (targetUrl.includes('mp4upload')) {
      referer = 'https://www.mp4upload.com/';
      origin = 'https://www.mp4upload.com';
    } else if (targetUrl.includes('ok.ru') || targetUrl.includes('okcdn.ru') || targetUrl.includes('mycdn.me')) {
      referer = 'https://ok.ru/';
      origin = 'https://ok.ru';
    } else if (targetUrl.includes('vk.com') || targetUrl.includes('vkuser') || targetUrl.includes('userapi.com')) {
      referer = 'https://vk.com/';
      origin = 'https://vk.com';
    } else if (
      targetUrl.includes('hdfilmcehennemi') ||
      targetUrl.includes('cdnimages') ||
      targetUrl.includes('playmix') ||
      targetUrl.includes('rapidload') ||
      targetUrl.includes('closeload') ||
      targetUrl.includes('rapidrame') ||
      targetUrl.includes('rplayer')
    ) {
      referer = 'https://www.hdfilmcehennemi.nl/';
      origin = 'https://www.hdfilmcehennemi.nl';
    } else if (
      targetUrl.includes('pichive.online') ||
      targetUrl.includes('hotlinger.com') ||
      targetUrl.includes('dplayer82.site') ||
      targetUrl.includes('dplayer') ||
      targetUrl.includes('gew2tjg5up') ||
      targetUrl.includes('kk6k2tczh8') ||
      targetUrl.includes('glogv5ppja') ||
      targetUrl.includes('slz8fn87k0') ||
      targetUrl.includes('qakqjhcvip') ||
      targetUrl.includes('fq6ay6al70')
    ) {
      if (customRef) {
        referer = customRef;
        try {
          origin = new URL(customRef).origin;
        } catch {}
      } else if (targetUrl.includes('hotlinger')) {
        referer = 'https://sn.hotlinger.com/';
        origin = 'https://sn.hotlinger.com';
      } else if (targetUrl.includes('dplayer82.site')) {
        referer = 'https://sn.dplayer82.site/';
        origin = 'https://sn.dplayer82.site';
      } else {
        referer = 'https://four.pichive.online/';
        origin = 'https://four.pichive.online';
      }
    } else if (
      targetUrl.includes('pilavyerplay') ||
      targetUrl.includes('pilavyer') ||
      targetUrl.includes('diziizle')
    ) {
      if (customRef) {
        referer = customRef;
        try {
          origin = new URL(customRef).origin;
        } catch {}
      } else {
        referer = 'https://diziizle.cafe/';
        origin = 'https://diziizle.cafe';
      }
    } else if (
      targetUrl.includes('dtpasn.asia') ||
      targetUrl.includes('dtpasn') ||
      targetUrl.includes('dtlux') ||
      targetUrl.includes('webdramaturkey')
    ) {
      if (customRef) {
        referer = customRef;
        try {
          origin = new URL(customRef).origin;
        } catch {}
      } else {
        referer = 'https://dtpasn.asia/';
        origin = 'https://dtpasn.asia';
      }
    } else if (targetUrl.includes('dramavadisi')) {
      referer = customRef || 'https://dramavadisi.com/';
      origin = 'https://dramavadisi.com';
    } else if (targetUrl.includes('dramabox')) {
      referer = customRef || 'https://www.dramabox.com/';
      origin = 'https://www.dramabox.com';
    } else if (
      targetUrl.includes('rapidvid') ||
      targetUrl.includes('cdnimage') ||
      targetUrl.includes('turbo.imgz.me')
    ) {
      if (customRef) {
        referer = customRef;
        try {
          origin = new URL(customRef).origin;
        } catch {}
      } else {
        referer = 'https://rapidvid.net/';
        origin = 'https://rapidvid.net';
      }
    }

    const clientUA = req.headers.get('user-agent');
    const upstreamHeaders: Record<string, string> = {
      'User-Agent':
        clientUA && !clientUA.includes('node') && !clientUA.includes('curl')
          ? clientUA
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Referer: referer,
      Origin: origin,
      Accept: '*/*',
    };

    // Forward Range header if client requested byte range (for video seek)
    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    if (
      targetUrl.includes('shortizle.com') ||
      targetUrl.includes('b-cdn.net') ||
      targetUrl.includes('mybigdramapool.com')
    ) {
      referer = 'https://shortizle.com/';
      origin = 'https://shortizle.com';
      upstreamHeaders['Referer'] = 'https://shortizle.com/';
      upstreamHeaders['Origin'] = 'https://shortizle.com';
      upstreamHeaders['Sec-Fetch-Site'] = targetUrl.includes('shortizle.com') ? 'same-site' : 'cross-site';
      upstreamHeaders['Sec-Fetch-Mode'] = 'cors';
      upstreamHeaders['Sec-Fetch-Dest'] = 'empty';
      if (shzCookie && /^[a-f0-9]+$/i.test(shzCookie)) {
        upstreamHeaders['Cookie'] = `__Host-shortizle_media=${shzCookie}`;
      }
    } else if (
      (targetUrl.includes('dtpasn.asia') || targetUrl.includes('dtlux')) &&
      dtCookie &&
      /^[a-zA-Z0-9_-]{8,128}$/.test(dtCookie)
    ) {
      upstreamHeaders['Cookie'] = `fireplayer_player=${dtCookie}`;
    }

    const isMediaChunk =
      targetUrl.includes('.ts') ||
      targetUrl.includes('.dts') ||
      targetUrl.includes('.mp4') ||
      targetUrl.includes('.m4s') ||
      targetUrl.includes('.webm') ||
      targetUrl.includes('stream.shortizle.com/v1/') ||
      targetUrl.includes('mybigdramapool.com') ||
      targetUrl.includes('b-cdn.net') ||
      targetUrl.includes('dramaboxdb.com') ||
      targetUrl.includes('okcdn.ru') ||
      targetUrl.includes('mycdn.me') ||
      (targetUrl.includes('.js') && (targetUrl.includes('/f/') || targetUrl.includes('dtlux'))) ||
      (targetUrl.includes('.jpg') && (targetUrl.includes('/f/') || targetUrl.includes('/o/a/') || targetUrl.includes('/m/a/') || targetUrl.includes('/dual')));
    const fetchTimeoutMs = isMediaChunk ? 60000 : 20000;

    let upstreamRes: Response | null = null;
    try {
      const fetched = await safeFetchWithRedirects(targetUrl, {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      upstreamRes = fetched.response;
    } catch (err) {
      if (err instanceof SsrfBlockedError) throw err;
    }

    // 1-time retry for media chunks if initial connection was interrupted
    if (!upstreamRes && isMediaChunk) {
      try {
        const retried = await safeFetchWithRedirects(targetUrl, {
          headers: upstreamHeaders,
          signal: AbortSignal.timeout(fetchTimeoutMs),
        });
        upstreamRes = retried.response;
      } catch (err) {
        if (err instanceof SsrfBlockedError) throw err;
      }
    }

    // Self-healing for OK.ru / okcdn.ru on HTTP 400 (IP mismatch between Lambdas or token rotation)
    if (
      (!upstreamRes || upstreamRes.status === 400 || upstreamRes.status === 403) &&
      (targetUrl.includes('okcdn.ru') || targetUrl.includes('mycdn.me') || targetUrl.includes('ok.ru')) &&
      embedUrl
    ) {
      try {
        const { response: embedRes } = await safeFetchWithRedirects(embedUrl, {
          headers: {
            'User-Agent': upstreamHeaders['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Referer: 'https://ok.ru/',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(6000),
        });
        if (embedRes.ok) {
          const embedHtml = await embedRes.text();
          const match =
            embedHtml.match(/data-options="([^"]+)"/i) ||
            embedHtml.match(/data-options=(["'])(.*?)\1/s);
          const raw = match ? (match[2] || match[1]) : null;
          if (raw) {
            const decoded = raw
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/&#39;/g, "'")
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');
            const opts = JSON.parse(decoded);
            const metaRaw = opts?.flashvars?.metadata;
            const meta = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : (metaRaw || {});
            const videos = Array.isArray(meta?.videos) ? meta.videos : [];
            const matched = videos.find((v: any) => v?.name === requestedQuality) || videos[0];
            const freshUrl = matched?.url || meta?.ondemandHls;

            if (freshUrl && typeof freshUrl === 'string') {
              const healed = await safeFetchWithRedirects(freshUrl, {
                headers: upstreamHeaders,
                signal: AbortSignal.timeout(fetchTimeoutMs),
              });
              upstreamRes = healed.response;
            }
          }
        }
      } catch (err) {
        if (err instanceof SsrfBlockedError) throw err;
        console.warn('Self-healing okcdn fetch error:', err);
      }
    }

    // If upstream fetch failed or returned 403 (e.g. Cloudflare on Pichive/Hotlinger playlists/subtitles), fall back to curl!
    if (!upstreamRes || (!upstreamRes.ok && upstreamRes.status !== 206)) {
      if (
        targetUrl.includes('pichive') ||
        targetUrl.includes('hotlinger') ||
        targetUrl.includes('dplayer') ||
        targetUrl.includes('glogv5ppja') ||
        targetUrl.includes('diziyou') ||
        targetUrl.includes('.vtt')
      ) {
        if (targetUrl.includes('.vtt')) {
          try {
            const { execFile } = await import('child_process');
            const vttOutput = await new Promise<string>((resolve, reject) => {
              execFile(
                CURL_BIN,
                [
                  '-s',
                  '-L',
                  '-H', `Referer: ${referer}`,
                  '-H', `Origin: ${origin}`,
                  '-H', `User-Agent: ${upstreamHeaders['User-Agent']}`,
                  '--connect-timeout', '6',
                  '--max-time', '10',
                  targetUrl,
                ],
                { maxBuffer: 5 * 1024 * 1024 },
                (err, stdout) => (err ? reject(err) : resolve(stdout))
              );
            });
            if (vttOutput && (vttOutput.includes('WEBVTT') || vttOutput.length > 10)) {
              return new NextResponse(vttOutput, {
                status: 200,
                headers: {
                  'Content-Type': 'text/vtt; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'public, max-age=86400',
                },
              });
            }
          } catch {}
        }

        const isPlayListUrl =
          targetUrl.includes('/m.php') ||
          targetUrl.includes('/l.php') ||
          targetUrl.includes('/ld.php') ||
          targetUrl.includes('.m3u8') ||
          targetUrl.includes('master.txt');
        if (isPlayListUrl) {
          try {
            const { execFile } = await import('child_process');
            const curlOutput = await new Promise<string>((resolve, reject) => {
              execFile(
                CURL_BIN,
                [
                  '-s',
                  '-L',
                  '-H', `Referer: ${referer}`,
                  '-H', `User-Agent: ${upstreamHeaders['User-Agent']}`,
                  '--connect-timeout', '6',
                  '--max-time', '10',
                  targetUrl,
                ],
                { maxBuffer: 10 * 1024 * 1024 },
                (err, stdout) => (err ? reject(err) : resolve(stdout))
              );
            });
            if (curlOutput && !isInvalidPlaylistBody(curlOutput)) {
              return rewritePlaylist(curlOutput, targetUrl, req, referer);
            }
          } catch {}
        }
      }

      if (!upstreamRes) {
        return new NextResponse(`Upstream failed to connect`, {
          status: 502,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new NextResponse(`Upstream returned ${upstreamRes.status}`, {
        status: upstreamRes.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    const contentType = upstreamRes.headers.get('content-type') || '';
    const isPlaylist =
      contentType.includes('mpegurl') ||
      contentType.includes('text/plain') ||
      targetUrl.includes('.m3u8') ||
      targetUrl.includes('master.txt') ||
      (targetUrl.includes('dtpasn.asia') && targetUrl.includes('/hls/')) ||
      targetUrl.includes('/m.php') ||
      targetUrl.includes('/l.php') ||
      targetUrl.includes('/ld.php');

    if (isPlaylist) {
      const text = await upstreamRes.text();

      // Detect 'security error', HTML error pages, or any non-EXTM3U payload; never forward garbage to hls.js
      if (isInvalidPlaylistBody(text)) {
        const retryRefs =
          targetUrl.includes('dtpasn') || targetUrl.includes('dizikorea')
            ? ['https://dtpasn.asia/', 'https://koredizi.com/', 'https://dizikorea3.com/', 'https://webdramaturkey2.com/']
            : ['https://dizikorea3.com/'];

        for (const altRef of retryRefs) {
          try {
            const altOrigin = new URL(altRef).origin;
            const { response: altRes } = await safeFetchWithRedirects(targetUrl, {
              headers: {
                ...upstreamHeaders,
                Referer: altRef,
                Origin: altOrigin,
              },
              signal: AbortSignal.timeout(fetchTimeoutMs),
            });
            if (altRes.ok) {
              const altText = await altRes.text();
              if (!isInvalidPlaylistBody(altText)) {
                return rewritePlaylist(altText, targetUrl, req, altRef);
              }
            }
          } catch {}
        }

        return new NextResponse('Upstream returned invalid playlist or security error', {
          status: 502,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      return rewritePlaylist(text, targetUrl, req, referer);
    }

    // Binary media stream (.ts chunk, .mp4, init segment)
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
    ];

    for (const h of forwardHeaders) {
      const val = upstreamRes.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    if (
      targetUrl.includes('.ts') ||
      targetUrl.includes('.dts') ||
      (targetUrl.includes('.js') && (targetUrl.includes('/f/') || targetUrl.includes('dtlux'))) ||
      (targetUrl.includes('.png') && (targetUrl.includes('/1080p/') || targetUrl.includes('/720p/') || targetUrl.includes('/480p/') || targetUrl.includes('/sheila') || targetUrl.includes('/v/'))) ||
      (targetUrl.includes('.jpg') && (targetUrl.includes('/f/') || targetUrl.includes('/o/a/') || targetUrl.includes('/m/a/') || targetUrl.includes('/dual')))
    ) {
      responseHeaders.set('content-type', 'video/mp2t');
    } else if (targetUrl.includes('.mp4') || targetUrl.includes('okcdn.ru') || targetUrl.includes('mycdn.me') || targetUrl.includes('dramaboxdb.com')) {
      responseHeaders.set('content-type', 'video/mp4');
    } else if (targetUrl.includes('.vtt')) {
      responseHeaders.set('content-type', 'text/vtt; charset=utf-8');
    }

    if (!responseHeaders.has('cache-control')) {
      responseHeaders.set('cache-control', 'public, max-age=86400, immutable');
    }

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err: any) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json(
        { error: 'Blocked host or protocol' },
        { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    console.error('Stream proxy error:', err);
    return NextResponse.json(
      { error: 'Proxy request failed', details: err?.message || String(err) },
      { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

function rewritePlaylist(
  content: string,
  baseTargetUrl: string,
  req: NextRequest,
  referer?: string
): NextResponse {
  const host = req.headers.get('host') || 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const reqParams = new URL(req.url).searchParams;
  const shzCookie = reqParams.get('shz_cookie') || '';
  const dtCookie = reqParams.get('dt_cookie') || '';
  const shzSuffix =
    shzCookie && /^[a-f0-9]+$/i.test(shzCookie)
      ? `&shz_cookie=${encodeURIComponent(shzCookie)}`
      : '';
  const dtSuffix =
    dtCookie && /^[a-zA-Z0-9_-]{8,128}$/.test(dtCookie)
      ? `&dt_cookie=${encodeURIComponent(dtCookie)}`
      : '';
  const refSuffix = `${referer ? `&ref=${encodeURIComponent(referer)}` : ''}${shzSuffix}${dtSuffix}`;
  const proxyBase = `${proto}://${host}/api/stream-proxy?url=`;

  const lines = content.split('\n');
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Fix syntax defects in upstream master playlists (e.g. Pichive missing comma before RESOLUTION or double commas)
      if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
        let fixed = trimmed;
        if (baseTargetUrl.includes('pichive') || baseTargetUrl.includes('hotlinger')) {
          fixed = fixed.replace(/,?\s*CODECS="[^"]*"/i, '');
        }
        fixed = fixed
          .replace(/,,+/g, ',')
          .replace(/([0-9a-zA-Z_"])RESOLUTION=/g, '$1,RESOLUTION=')
          .replace(/([0-9a-zA-Z_"])NAME=/g, '$1,NAME=')
          .replace(/,,+/g, ',')
          .replace(/,+$/g, '');
        return fixed;
      }

      // Check for URI in tags like #EXT-X-KEY or #EXT-X-MEDIA:TYPE=AUDIO,...URI="..."
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uriVal) => {
          try {
            const absoluteUri = new URL(uriVal, baseTargetUrl).toString();
            return `URI="${proxyBase}${encodeURIComponent(absoluteUri)}${refSuffix}"`;
          } catch {
            return `URI="${uriVal}"`;
          }
        });
      }
      return line;
    }

    try {
      const absoluteUrl = new URL(trimmed, baseTargetUrl).toString();
      const parsed = new URL(absoluteUrl);
      const hostLower = parsed.hostname.toLowerCase();
      const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();

      // Sub-playlists must continue to be proxied so inner links are processed
      const isSubPlaylist =
        pathAndQuery.includes('.m3u8') ||
        pathAndQuery.includes('master.txt') ||
        (hostLower.includes('dtpasn') && pathAndQuery.includes('/hls/')) ||
        pathAndQuery.includes('/m.php') ||
        pathAndQuery.includes('/l.php') ||
        pathAndQuery.includes('/ld.php') ||
        pathAndQuery.includes('/m0/') ||
        pathAndQuery.includes('/m1/') ||
        pathAndQuery.includes('/ml/') ||
        pathAndQuery.includes('/mg/') ||
        pathAndQuery.includes('stream.php');

      if (isSubPlaylist) {
        return `${proxyBase}${encodeURIComponent(absoluteUrl)}${refSuffix}`;
      }

      // Open-CORS CDNs: return direct segment URL so user streams at direct 500 Mbps without proxy choke!
      const isOpenCorsCdn =
        hostLower.includes('vmpx.online') ||
        hostLower.includes('media.mybigdramapool.com') ||
        hostLower.includes('acek-cdn.com') ||
        hostLower.includes('owphbf24.com') ||
        hostLower.includes('sprintcdn') ||
        hostLower.includes('dystream.com') ||
        hostLower.includes('tau-video.xyz') ||
        hostLower.includes('fastsupplyhub.shop') ||
        hostLower.includes('smartcheckout.shop') ||
        hostLower.includes('videopixelvanto.com') ||
        hostLower.includes('dramiyos') ||
        hostLower.includes('sibnet.ru');

      if (isOpenCorsCdn) {
        return absoluteUrl;
      }

      // For CDNs requiring hotlink proxying (Pichive, Ok.ru, Mail.ru)
      return `${proxyBase}${encodeURIComponent(absoluteUrl)}${refSuffix}`;
    } catch {
      return line;
    }
  });

  return new NextResponse(rewrittenLines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
