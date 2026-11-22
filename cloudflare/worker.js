/**
 * KoUp Production Edge Worker & Stream Resolver
 * Deployed on Cloudflare Global Edge Network
 * URL: https://koup-edge-worker.caganhuseyinerdil.workers.dev
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1?\]?|\[?fc[0-9a-f]{2}:.*|\[?fd[0-9a-f]{2}:.*|\[?fe80:.*)$/i;

function isSafeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (!host || PRIVATE_HOST_RE.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
      return null;
    }
    if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedPichiveTarget(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  const pathAndQuery = (parsedUrl.pathname + parsedUrl.search).toLowerCase();
  if (
    host === 'pichive.online' ||
    host.endsWith('.pichive.online') ||
    host === 'asyawatch.com' ||
    host.endsWith('.asyawatch.com') ||
    host.includes('slz8fn87k0') ||
    host.includes('glogv5ppja') ||
    host.includes('kk6k2tczh8') ||
    host.includes('qakqjhcvip') ||
    host.includes('fq6ay6al70') ||
    host.includes('gew2tjg5up') ||
    host.includes('pichive') ||
    host.includes('dplayer') ||
    host.includes('hotlinger')
  ) {
    return true;
  }
  // Allow CDN segment/playlist nodes referenced by Pichive manifests (including disguised .jpg / .png chunks)
  if (
    pathAndQuery.includes('.m3u8') ||
    pathAndQuery.includes('.ts') ||
    pathAndQuery.includes('.m4s') ||
    pathAndQuery.includes('.vtt') ||
    pathAndQuery.includes('.jpg') ||
    pathAndQuery.includes('.png') ||
    pathAndQuery.includes('.mp4') ||
    pathAndQuery.includes('/m.php') ||
    pathAndQuery.includes('/l.php') ||
    pathAndQuery.includes('/ld.php') ||
    pathAndQuery.includes('/hls/') ||
    pathAndQuery.includes('/seg') ||
    pathAndQuery.includes('/chunk') ||
    pathAndQuery.includes('/f/') ||
    pathAndQuery.includes('/o/a/') ||
    pathAndQuery.includes('/m/a/') ||
    pathAndQuery.includes('/dual/')
  ) {
    return true;
  }
  return false;
}

const RESOLVE_HOST_KEYWORDS = [
  'vidmoly',
  'ok.ru',
  'odnoklassniki',
  'sibnet',
  'uqload',
  'mail.ru',
  'molystream',
  'dizibox',
  'dizikorea',
  'morencius',
  'rapidrame',
  'hdfilm',
  'tau-video',
  'pichive',
  'asyawatch',
  'dizilla',
  'dizifon',
  'voe',
  'filemoon',
  'streamtape',
];

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Universal CORS headers for KoUp Frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
      'X-Content-Type-Options': 'nosniff',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. Live Magazin & News Edge Cache
    if (url.pathname === '/magazin') {
      const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      let cached = await cache.match(cacheKey);
      if (cached) return cached;

      const resp = await fetch(`https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page=${limit}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KoUp-Edge/2.0',
          'Accept': 'application/json',
        },
      });

      const data = await resp.text();
      const edgeResponse = new Response(data, {
        status: resp.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=180, s-maxage=300',
        },
      });

      ctx.waitUntil(cache.put(cacheKey, edgeResponse.clone()));
      return edgeResponse;
    }

    // 2. Tau-Video API Stream Extractor
    if (url.pathname === '/tau') {
      const key = url.searchParams.get('key') || '';
      if (!/^[a-zA-Z0-9_-]{16,64}$/.test(key)) {
        return new Response(JSON.stringify({ error: 'Invalid tau key' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resp = await fetch(`https://tau-video.xyz/api/video/${key}`, {
        headers: {
          'Referer': `https://tau-video.xyz/embed/${key}`,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const data = await resp.text();
      return new Response(data, {
        status: resp.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
        },
      });
    }

    // 2.5 Pichive / AsyaWatch Native Stream Extractor
    if (url.pathname === '/pichive') {
      const targetIframe = url.searchParams.get('url') || '';
      if (!targetIframe) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let normalizedIframe = targetIframe;
      if (normalizedIframe.startsWith('//')) normalizedIframe = 'https:' + normalizedIframe;
      const parsedIframeCheck = isSafeHttpUrl(normalizedIframe);
      if (!parsedIframeCheck || !isAllowedPichiveTarget(parsedIframeCheck)) {
        return new Response(JSON.stringify({ error: 'Forbidden target host' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Edge Cache (1 hour cache to prevent Cloudflare 1015 rate limiting)
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;
      try {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
      } catch {}

      try {
        const iframeUrl = parsedIframeCheck.toString();

        const iframeResp = await fetch(iframeUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': 'https://asyawatch.com/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site',
            'Upgrade-Insecure-Requests': '1',
          },
        });

        if (!iframeResp.ok) {
          const errBody = await iframeResp.text();
          return new Response(JSON.stringify({
            error: `Iframe HTTP ${iframeResp.status}`,
            isDead: true,
            status: iframeResp.status,
            bodySnippet: errBody.slice(0, 300),
            cfRay: iframeResp.headers.get('cf-ray'),
            server: iframeResp.headers.get('server')
          }), {
            status: iframeResp.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const html = await iframeResp.text();
        const tokenMatch = html.match(/openPlayer\(\s*['"]([^'"]+)['"]/);
        if (!tokenMatch?.[1]) {
          return new Response(JSON.stringify({ error: 'openPlayer token not found in iframe', isDead: true }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const token = tokenMatch[1];
        const origin = parsedIframeCheck.origin;
        const source2Url = `${origin}/source2.php?v=${encodeURIComponent(token)}`;

        const s2Resp = await fetch(source2Url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': iframeUrl,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
          },
        });

        if (!s2Resp.ok) {
          return new Response(JSON.stringify({ error: `source2.php HTTP ${s2Resp.status}`, isDead: true }), {
            status: s2Resp.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const s2Data = await s2Resp.json();
        const playlistItem = s2Data?.playlist?.[0];
        let masterStreamUrl = playlistItem?.sources?.[0]?.file;
        if (masterStreamUrl) {
          masterStreamUrl = masterStreamUrl.replace('m.php', 'master.m3u8');
        }

        let subtitles = [];
        const subMatch = html.match(/\[\s*\{\s*["']file["']\s*:\s*["'][^"']+\.vtt[^"']*["'][\s\S]*?\]/);
        if (subMatch?.[0]) {
          try {
            subtitles = JSON.parse(subMatch[0]);
          } catch {}
        }

        const edgeResp = new Response(
          JSON.stringify({
            status: 'success',
            streamUrl: masterStreamUrl,
            subtitles,
            poster: playlistItem?.image || null,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=3600, s-maxage=7200',
            },
          }
        );

        if (ctx && ctx.waitUntil) {
          ctx.waitUntil(cache.put(cacheKey, edgeResp.clone()));
        }
        return edgeResp;
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err), isDead: true }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 2.6 Pichive / AsyaWatch Stream & Chunk Edge Proxy
    if (url.pathname === '/pichive-proxy') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response('Missing url', { status: 400, headers: corsHeaders });
      }

      const parsedTarget = isSafeHttpUrl(targetUrl);
      if (!parsedTarget || !isAllowedPichiveTarget(parsedTarget)) {
        return new Response(JSON.stringify({ error: 'Forbidden proxy target' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const rawRef = url.searchParams.get('ref');
        const safeRefParsed = rawRef ? isSafeHttpUrl(rawRef) : null;
        const customRef = safeRefParsed ? safeRefParsed.toString() : 'https://four.pichive.online/';
        const origin = safeRefParsed ? safeRefParsed.origin : 'https://four.pichive.online';

        const forwardHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': customRef,
          'Origin': origin,
          'Accept': '*/*',
        };

        const range = request.headers.get('Range');
        if (range) forwardHeaders['Range'] = range;

        const upstreamRes = await fetch(parsedTarget.toString(), {
          headers: forwardHeaders,
        });

        const contentType = upstreamRes.headers.get('content-type') || '';
        const isPlaylist =
          contentType.includes('mpegurl') ||
          contentType.includes('text/plain') ||
          targetUrl.includes('.m3u8') ||
          targetUrl.includes('/m.php') ||
          targetUrl.includes('/l.php') ||
          targetUrl.includes('/ld.php');

        if (isPlaylist) {
          const text = await upstreamRes.text();
          const workerBase = `${url.origin}/pichive-proxy?url=`;
          const refSuffix = `&ref=${encodeURIComponent(customRef)}`;

          const rewritten = text.split('\n').map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
              if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
                return trimmed
                  .replace(/,?\s*CODECS="[^"]*"/i, '')
                  .replace(/,,+/g, ',')
                  .replace(/([0-9a-zA-Z_"])RESOLUTION=/g, '$1,RESOLUTION=')
                  .replace(/([0-9a-zA-Z_"])NAME=/g, '$1,NAME=')
                  .replace(/,,+/g, ',');
              }
              if (trimmed.includes('URI="')) {
                return trimmed.replace(/URI="([^"]+)"/g, (_, uriVal) => {
                  try {
                    const absUri = new URL(uriVal, targetUrl).toString();
                    return `URI="${workerBase}${encodeURIComponent(absUri)}${refSuffix}"`;
                  } catch {
                    return `URI="${uriVal}"`;
                  }
                });
              }
              return line;
            }

            try {
              const abs = new URL(trimmed, targetUrl).toString();
              return `${workerBase}${encodeURIComponent(abs)}${refSuffix}`;
            } catch {
              return line;
            }
          }).join('\n');

          return new Response(rewritten, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Cache-Control': 'public, max-age=60',
            },
          });
        }

        // Binary chunk (.ts or masked .jpg)
        const resHeaders = new Headers(corsHeaders);
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
          const val = upstreamRes.headers.get(h);
          if (val) resHeaders.set(h, val);
        }
        if (targetUrl.includes('.ts') || targetUrl.includes('.jpg') || targetUrl.includes('.png')) {
          resHeaders.set('content-type', 'video/mp2t');
        }
        if (!resHeaders.has('cache-control')) {
          resHeaders.set('cache-control', 'public, max-age=86400, immutable');
        }

        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: resHeaders,
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 2.6 Shortİzle Edge Stream Resolver (bypasses Vercel AWS datacenter 403)
    if (url.pathname === '/shortizle') {
      const targetUrl = url.searchParams.get('url') || '';
      const parsedTarget = isSafeHttpUrl(targetUrl);
      if (!parsedTarget || !parsedTarget.hostname.toLowerCase().endsWith('shortizle.com')) {
        return new Response(JSON.stringify({ ok: false, error: 'Forbidden shortizle target' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const ua =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        const watchParam = parsedTarget.searchParams.get('watch') || '';
        const kindParam = (parsedTarget.searchParams.get('kind') || '').toLowerCase();
        const mediaIdMatch = parsedTarget.pathname.match(/\/media\/[^/]+\/(\d+)/i);
        const targetSourceId = mediaIdMatch?.[1] ? Number(mediaIdMatch[1]) : null;

        let watchUrl = '';
        if (watchParam) {
          watchUrl = watchParam.startsWith('http')
            ? watchParam
            : `https://shortizle.com${watchParam.startsWith('/') ? '' : '/'}${watchParam}`;
        } else if (parsedTarget.pathname.startsWith('/watch/')) {
          watchUrl = `https://shortizle.com${parsedTarget.pathname}`;
        } else if (parsedTarget.pathname.startsWith('/embed/')) {
          watchUrl = `https://shortizle.com${parsedTarget.pathname.replace(/^\/embed\//i, '/watch/')}`;
        }

        if (!watchUrl || !isSafeHttpUrl(watchUrl)?.hostname.toLowerCase().endsWith('shortizle.com')) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid shortizle watchUrl' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const watchResp = await fetch(watchUrl, {
          headers: {
            'User-Agent': ua,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            Referer: 'https://shortizle.com/',
            'Upgrade-Insecure-Requests': '1',
          },
        });

        if (!watchResp.ok) {
          return new Response(
            JSON.stringify({ ok: false, status: watchResp.status, error: `watch_http_${watchResp.status}` }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const rawCookies =
          typeof watchResp.headers.getSetCookie === 'function'
            ? watchResp.headers.getSetCookie()
            : (watchResp.headers.get('set-cookie') || '').split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
        const cookiePairs = rawCookies
          .map((c) => c.split(';')[0]?.trim())
          .filter(Boolean)
          .join('; ');

        const watchHtml = await watchResp.text();
        let inertiaProps = null;

        const appScriptMatch = watchHtml.match(/<script[^>]*data-page=["']app["'][^>]*>([\s\S]*?)<\/script>/i);
        if (appScriptMatch?.[1]) {
          try {
            inertiaProps = JSON.parse(appScriptMatch[1].trim())?.props;
          } catch {}
        }
        if (!inertiaProps) {
          const dpMatch = watchHtml.match(/data-page="([^"]+)"/i);
          if (dpMatch?.[1] && dpMatch[1].trim().startsWith('{')) {
            try {
              const unescaped = dpMatch[1]
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
              inertiaProps = JSON.parse(unescaped)?.props;
            } catch {}
          }
        }

        const extSources = inertiaProps?.externalSources || {};
        const candidates = [];
        const order = kindParam === 'dublaj' ? ['dublaj', 'altyazi'] : ['altyazi', 'dublaj'];
        for (const k of order) {
          if (Array.isArray(extSources[k])) candidates.push(...extSources[k]);
        }

        const matched = targetSourceId ? candidates.find((c) => Number(c?.id) === targetSourceId) : null;
        const evalList = matched ? [matched, ...candidates.filter((c) => c !== matched)] : candidates;

        for (const cand of evalList) {
          if (!cand) continue;
          if (cand.url && (cand.url.includes('.m3u8') || cand.url.includes('.mp4'))) {
            return new Response(
              JSON.stringify({
                ok: true,
                streamUrl: cand.url,
                streamType: cand.url.includes('.m3u8') ? 'hls' : 'mp4',
                subtitleUrl: cand.subtitle_url || null,
                shzCookie: '',
                watchUrl,
                isDub: kindParam === 'dublaj',
              }),
              {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
              }
            );
          }

          if (cand.resolve_url) {
            const resolveFullUrl = cand.resolve_url.startsWith('http')
              ? cand.resolve_url
              : `https://shortizle.com${cand.resolve_url}`;
            try {
              const resResp = await fetch(resolveFullUrl, {
                headers: {
                  'User-Agent': ua,
                  Accept: 'application/json, text/plain, */*',
                  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                  Referer: watchUrl,
                  Cookie: cookiePairs,
                  'X-Requested-With': 'XMLHttpRequest',
                },
              });
              if (!resResp.ok) continue;
              const resJson = await resResp.json();
              let finalM3u8 = null;
              let shzMediaCookie = '';

              if (resJson?.gateway_bootstrap?.url && resJson?.gateway_bootstrap?.token) {
                const authResp = await fetch(resJson.gateway_bootstrap.url, {
                  method: 'POST',
                  headers: {
                    'User-Agent': ua,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Origin: 'https://shortizle.com',
                    Referer: 'https://shortizle.com/',
                  },
                  body: JSON.stringify({ token: resJson.gateway_bootstrap.token }),
                });
                if (authResp.ok) {
                  const authCookies =
                    typeof authResp.headers.getSetCookie === 'function'
                      ? authResp.headers.getSetCookie()
                      : [authResp.headers.get('set-cookie') || ''];
                  for (const ac of authCookies) {
                    const m = ac.match(/__Host-shortizle_media=([a-f0-9]+)/i);
                    if (m?.[1]) {
                      shzMediaCookie = m[1];
                      break;
                    }
                  }
                  const authJson = await authResp.json();
                  if (authJson?.url) finalM3u8 = authJson.url;
                }
              } else if (resJson?.url) {
                finalM3u8 = resJson.url.startsWith('/') ? `https://shortizle.com${resJson.url}` : resJson.url;
              }

              if (finalM3u8) {
                return new Response(
                  JSON.stringify({
                    ok: true,
                    streamUrl: finalM3u8,
                    streamType: finalM3u8.includes('.mp4') ? 'mp4' : 'hls',
                    subtitleUrl: cand.subtitle_url || resJson.subtitle_url || null,
                    shzCookie: shzMediaCookie,
                    watchUrl,
                    isDub: (Boolean(cand.selection_key) && kindParam === 'dublaj') || finalM3u8.includes('cut=dub'),
                  }),
                  {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                  }
                );
              }
            } catch {
              continue;
            }
          }
        }

        return new Response(JSON.stringify({ ok: false, error: 'shortizle_no_stream' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. Universal Stream Resolver / Header Bypass (Vidmoly, Sibnet, Ok.ru)
    if (url.pathname === '/resolve') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing target url parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const parsed = isSafeHttpUrl(targetUrl);
      const hostLower = parsed ? parsed.hostname.toLowerCase() : '';
      const isAllowedHost =
        parsed && RESOLVE_HOST_KEYWORDS.some((kw) => hostLower.includes(kw));

      if (!parsed || !isAllowedHost) {
        return new Response(JSON.stringify({ error: 'Forbidden resolver host' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': `${parsed.protocol}//${parsed.host}/`,
        };

        const res = await fetch(parsed.toString(), { headers });
        const html = await res.text();

        // Extract potential m3u8 or mp4 sources from embedded scripts
        const m3u8Match = html.match(/(?:file|sources?|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i);
        const mp4Match = html.match(/(?:file|sources?|src)\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']/i);

        return new Response(
          JSON.stringify({
            target: parsed.toString(),
            found_m3u8: m3u8Match ? m3u8Match[1] : null,
            found_mp4: mp4Match ? mp4Match[1] : null,
            status: 'resolved',
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=300',
            },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. R2 Object Storage: Ultra-Fast Distributed Catalog & Episode Cache
    if (url.pathname.startsWith('/archive/')) {
      let key = '';
      try {
        key = decodeURIComponent(url.pathname.slice('/archive/'.length)).trim();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid object key' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!key || key.includes('..') || key.includes('\\') || key.startsWith('/')) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'GET') {
        // Strictly restrict public GET to sources/{id}.json bundles only — never expose db/* or internal files
        if (!/^sources\/[a-zA-Z0-9_-]+\.json$/.test(key)) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (!env.ARCHIVE_BUCKET) {
          return new Response(JSON.stringify({ error: 'R2 bucket binding not configured' }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const object = await env.ARCHIVE_BUCKET.get(key);
        if (!object) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const headers = new Headers(corsHeaders);
        headers.set('Content-Type', object.httpMetadata?.contentType || 'application/json; charset=utf-8');
        headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        headers.set('ETag', object.httpEtag);
        return new Response(object.body, { headers });
      }

      if (request.method === 'PUT' || request.method === 'POST') {
        const auth = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
        if (!env.R2_SECRET || !timingSafeEqualStr(auth, String(env.R2_SECRET))) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!/^sources\/[a-zA-Z0-9_-]+\.json$/.test(key)) {
          return new Response(JSON.stringify({ error: 'Forbidden object key' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const data = await request.text();
        await env.ARCHIVE_BUCKET.put(key, data, {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        });
        return new Response(JSON.stringify({ success: true, key }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Default: Health / Info
    return new Response(
      JSON.stringify({
        service: 'KoUp Global Edge Worker & Stream Dispatcher',
        status: 'online',
        region: request.cf?.colo || 'FRA',
        endpoints: [
          '/magazin?limit=20',
          '/tau?key=<id>',
          '/resolve?url=<videoUrl>',
          '/health',
        ],
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  },

  // Cloudflare Scheduled Cron (Runs every 30 minutes)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        fetch('https://asyamag.com/wp-json/wp/v2/posts?_embed=true&per_page=15', {
          headers: { 'User-Agent': 'Mozilla/5.0 KoUp-Cron/2.0' },
        }),
      ])
    );
  },
};
