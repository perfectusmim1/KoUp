/**
 * KoUp Production Edge Worker & Stream Resolver
 * Deployed on Cloudflare Global Edge Network
 * URL: https://koup-edge-worker.caganhuseyinerdil.workers.dev
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Universal CORS headers for KoUp Frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. Live Magazin & News Edge Cache
    if (url.pathname === '/magazin') {
      const limit = url.searchParams.get('limit') || '20';
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

    // 3. Universal Stream Resolver / Header Bypass (Vidmoly, Sibnet, Ok.ru)
    if (url.pathname === '/resolve') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Missing target url parameter' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const parsed = new URL(targetUrl);
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': `${parsed.protocol}//${parsed.host}/`,
        };

        const res = await fetch(targetUrl, { headers });
        const html = await res.text();

        // Extract potential m3u8 or mp4 sources from embedded scripts
        const m3u8Match = html.match(/(?:file|sources?|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i);
        const mp4Match = html.match(/(?:file|sources?|src)\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']/i);

        return new Response(
          JSON.stringify({
            target: targetUrl,
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
