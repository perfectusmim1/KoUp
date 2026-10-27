import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns';

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

function isBlockedIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }
  if (['127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata'].includes(host)) {
    return true;
  }
  const ipv4PrivateRegex =
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(?:6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|0\.)/;
  if (ipv4PrivateRegex.test(host)) return true;
  if (host.startsWith('::') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) return true;
  return false;
}

async function isBlockedAfterDnsLookup(hostname: string): Promise<boolean> {
  if (isBlockedIpOrHost(hostname)) return true;
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    if (!records || records.length === 0) return true;
    return records.some((rec) => isBlockedIpOrHost(rec.address));
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  let targetUrl = searchParams.get('url');
  const customRef = searchParams.get('ref');
  const embedUrl = searchParams.get('embed');
  const requestedQuality = searchParams.get('q') || 'hd';
  const shzCookie = searchParams.get('shz_cookie') || '';

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
        referer = 'https://diziizle.wiki/';
        origin = 'https://diziizle.wiki';
      }
    } else if (
      targetUrl.includes('dtpasn.asia') ||
      targetUrl.includes('dtpasn') ||
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

    if (targetUrl.includes('shortizle.com')) {
      upstreamHeaders['Referer'] = 'https://shortizle.com/';
      upstreamHeaders['Origin'] = 'https://shortizle.com';
      upstreamHeaders['Sec-Fetch-Site'] = 'same-site';
      upstreamHeaders['Sec-Fetch-Mode'] = 'cors';
      upstreamHeaders['Sec-Fetch-Dest'] = 'empty';
      if (shzCookie && /^[a-f0-9]+$/i.test(shzCookie)) {
        upstreamHeaders['Cookie'] = `__Host-shortizle_media=${shzCookie}`;
      }
    }

    const isMediaChunk =
      targetUrl.includes('.ts') ||
      targetUrl.includes('.mp4') ||
      targetUrl.includes('.m4s') ||
      targetUrl.includes('.webm') ||
      targetUrl.includes('stream.shortizle.com/v1/') ||
      targetUrl.includes('okcdn.ru') ||
      targetUrl.includes('mycdn.me') ||
      (targetUrl.includes('.jpg') && (targetUrl.includes('/f/') || targetUrl.includes('/o/a/') || targetUrl.includes('/m/a/') || targetUrl.includes('/dual')));
    const fetchTimeoutMs = isMediaChunk ? 60000 : 20000;

    let upstreamRes: Response | null = null;
    try {
      upstreamRes = await fetch(targetUrl, {
        headers: upstreamHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch {}

    // 1-time retry for media chunks if initial connection was interrupted
    if (!upstreamRes && isMediaChunk) {
      try {
        upstreamRes = await fetch(targetUrl, {
          headers: upstreamHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(fetchTimeoutMs),
        });
      } catch {}
    }

    // Self-healing for OK.ru / okcdn.ru on HTTP 400 (IP mismatch between Lambdas or token rotation)
    if (
      (!upstreamRes || upstreamRes.status === 400 || upstreamRes.status === 403) &&
      (targetUrl.includes('okcdn.ru') || targetUrl.includes('mycdn.me') || targetUrl.includes('ok.ru')) &&
      embedUrl
    ) {
      try {
        const embedRes = await fetch(embedUrl, {
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
              upstreamRes = await fetch(freshUrl, {
                headers: upstreamHeaders,
                redirect: 'follow',
                signal: AbortSignal.timeout(fetchTimeoutMs),
              });
            }
          }
        }
      } catch (err) {
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
            if (curlOutput && (curlOutput.includes('#EXTM3U') || curlOutput.includes('#EXTINF'))) {
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
      targetUrl.includes('/m.php') ||
      targetUrl.includes('/l.php') ||
      targetUrl.includes('/ld.php');

    if (isPlaylist) {
      const text = await upstreamRes.text();

      // Check if upstream actually returned a security error string
      if (text.trim().toLowerCase().includes('security error')) {
        // Retry with alternative referer variations
        const altRes = await fetch(targetUrl, {
          headers: {
            ...upstreamHeaders,
            Referer: 'https://dizikorea3.com/',
            Origin: 'https://dizikorea3.com',
          },
        });
        if (altRes.ok) {
          const altText = await altRes.text();
          if (!altText.trim().toLowerCase().includes('security error')) {
            return rewritePlaylist(altText, targetUrl, req, referer);
          }
        }
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
      (targetUrl.includes('.png') && (targetUrl.includes('/1080p/') || targetUrl.includes('/720p/') || targetUrl.includes('/480p/') || targetUrl.includes('/sheila') || targetUrl.includes('/v/'))) ||
      (targetUrl.includes('.jpg') && (targetUrl.includes('/f/') || targetUrl.includes('/o/a/') || targetUrl.includes('/m/a/') || targetUrl.includes('/dual')))
    ) {
      responseHeaders.set('content-type', 'video/mp2t');
    } else if (targetUrl.includes('.mp4') || targetUrl.includes('okcdn.ru') || targetUrl.includes('mycdn.me')) {
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
  const shzCookie = new URL(req.url).searchParams.get('shz_cookie') || '';
  const shzSuffix =
    shzCookie && /^[a-f0-9]+$/i.test(shzCookie)
      ? `&shz_cookie=${encodeURIComponent(shzCookie)}`
      : '';
  const refSuffix = `${referer ? `&ref=${encodeURIComponent(referer)}` : ''}${shzSuffix}`;
  const proxyBase = `${proto}://${host}/api/stream-proxy?url=`;

  const lines = content.split('\n');
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Fix syntax defects in upstream master playlists (e.g. Pichive missing comma before RESOLUTION or double commas)
      if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
        let fixed = trimmed
          // Strip misleading/hardcoded CODECS (e.g. Pichive advertising mp4a.40.2 when audio is actually MP3, causing Chrome MSE bufferAddCodecError)
          .replace(/,?\s*CODECS="[^"]*"/i, '')
          .replace(/,,+/g, ',')
          .replace(/([0-9a-zA-Z_"])RESOLUTION=/g, '$1,RESOLUTION=')
          .replace(/([0-9a-zA-Z_"])NAME=/g, '$1,NAME=')
          .replace(/,,+/g, ',');
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
