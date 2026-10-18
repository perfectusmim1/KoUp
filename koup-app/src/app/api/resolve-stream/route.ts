import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';
  const provider = (searchParams.get('provider') || '').toLowerCase();

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  // Validate URL protocol
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Malformed URL' }, { status: 400 });
  }

  const lowerUrl = url.toLowerCase();
  const deadDomains = [
    'diziasya',
    'short.icu',
    'short.ink',
    'vudeo.io',
    'vudeo.co',
    'vudeo.net',
    'dood.watch',
    'dood.ws',
    'dood.so',
    'doodstream.com',
    'mvidoo.com',
    'savefileway.com',
    'tubeload.co',
    'embedo.co',
    'streamlare.com',
    'optraco.top',
    'abyssplayer.com',
    'uqload.to',
    'sendvid',
    'sendvid.com',
    'drive.google.com',
    'docs.google.com',
  ];
  if (deadDomains.some((d) => lowerUrl.includes(d))) {
    return NextResponse.json(
      { error: 'Kaynak artık kullanılabilir değil veya engellendi', isDead: true },
      { status: 410 }
    );
  }

  // 00. AsyaWatch & Dizilla / Pichive / DPlayer / Hotlinger Native Stream Resolver
  if (
    lowerUrl.includes('pichive.online') ||
    lowerUrl.includes('dplayer82.site') ||
    lowerUrl.includes('dplayer') ||
    lowerUrl.includes('hotlinger.com') ||
    lowerUrl.includes('asyawatch.com') ||
    lowerUrl.includes('dizilla.now') ||
    provider.includes('asyawatch') ||
    provider.includes('dizilla')
  ) {
    try {
      let iframeUrl = url;
      if (iframeUrl.startsWith('//')) {
        iframeUrl = `https:${iframeUrl}`;
      }

      // If user passed episode page instead of iframe, extract iframe first
      if (iframeUrl.includes('asyawatch.com/dizi/')) {
        const { execFile } = await import('child_process');
        const pageHtml = await new Promise<string>((resolve, reject) => {
          execFile(
            'curl.exe',
            [
              '-s',
              '-L',
              '-H', 'Referer: https://asyawatch.com/',
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              iframeUrl,
            ],
            { maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });
        const mIframe = pageHtml.match(/src=["'](\/\/[^"']*(?:pichive|hotlinger|dplayer)[^"']*)["']/i) ||
                        pageHtml.match(/src=["'](https?:\/\/[^"']*(?:pichive|hotlinger|dplayer)[^"']*)["']/i);
        if (mIframe?.[1]) {
          iframeUrl = mIframe[1].startsWith('//') ? `https:${mIframe[1]}` : mIframe[1];
        }
      } else if (iframeUrl.includes('dizilla.now/')) {
        const { execFile } = await import('child_process');
        const pageHtml = await new Promise<string>((resolve, reject) => {
          execFile(
            'curl.exe',
            [
              '-s',
              '-L',
              '-H', 'Referer: https://dizilla.now/',
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              iframeUrl,
            ],
            { maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });
        const mIframe = pageHtml.match(/src=["'](\/\/[^"']*(?:hotlinger|dplayer|pichive)[^"']*)["']/i) ||
                        pageHtml.match(/src=["'](https?:\/\/[^"']*(?:hotlinger|dplayer|pichive)[^"']*)["']/i);
        if (mIframe?.[1]) {
          iframeUrl = mIframe[1].startsWith('//') ? `https:${mIframe[1]}` : mIframe[1];
        }
      }

      const refSite = iframeUrl.includes('pichive') || provider.includes('asyawatch')
        ? 'https://asyawatch.com/'
        : 'https://dizilla.now/';

      const { execFile } = await import('child_process');
      const iframeHtml = await new Promise<string>((resolve, reject) => {
        execFile(
          'curl.exe',
          [
            '-s',
            '-L',
            '-H', `Referer: ${refSite}`,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '--connect-timeout', '6',
            '--max-time', '10',
            iframeUrl,
          ],
          { maxBuffer: 10 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        );
      });

      const tokenMatch = iframeHtml.match(/openPlayer\(\s*['"]([^'"]+)['"]/);
      if (tokenMatch?.[1]) {
        const token = tokenMatch[1];
        const parsedIframe = new URL(iframeUrl);
        const origin = parsedIframe.origin;
        const source2Url = `${origin}/source2.php?v=${encodeURIComponent(token)}`;

        const s2JsonStr = await new Promise<string>((resolve, reject) => {
          execFile(
            'curl.exe',
            [
              '-s',
              '-L',
              '-H', `Referer: ${iframeUrl}`,
              '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              '-H', 'X-Requested-With: XMLHttpRequest',
              '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
              '--connect-timeout', '6',
              '--max-time', '10',
              source2Url,
            ],
            { maxBuffer: 5 * 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          );
        });

        const s2Data = JSON.parse(s2JsonStr);
        const playlistItem = s2Data?.playlist?.[0];
        const masterStreamUrl = playlistItem?.sources?.[0]?.file;

        if (masterStreamUrl) {
          const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterStreamUrl)}&ref=${encodeURIComponent(origin + '/')}`;
          
          let subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
          const subMatch = iframeHtml.match(/\[\s*\{\s*["']file["']\s*:\s*["'][^"']+\.vtt[^"']*["'][\s\S]*?\]/);
          if (subMatch?.[0]) {
            try {
              const rawSubs = JSON.parse(subMatch[0]);
              subtitles = rawSubs
                .filter((s: any) => s.file)
                .map((s: any) => ({
                  label: s.label || 'Türkçe',
                  lang: s.lang || 'tr',
                  url: `/api/stream-proxy?url=${encodeURIComponent(s.file)}&ref=${encodeURIComponent(origin + '/')}`,
                  default: !!s.default,
                }));
            } catch {}
          }

          return NextResponse.json(
            {
              mode: 'native_hls',
              streamUrl: proxiedMaster,
              streamType: 'hls',
              directUrl: masterStreamUrl,
              posterImage: playlistItem?.image || null,
              subtitles,
              qualities: [
                { label: '1080p (Orijinal)', url: proxiedMaster },
              ],
              fallbackIframe: iframeUrl,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch (err: any) {
      console.warn('AsyaWatch / Dizilla native stream extraction error:', err?.message || err);
    }

    // Fallback if extraction failed
    return NextResponse.json(
      {
        mode: 'iframe',
        iframeUrl: url,
        qualities: [{ label: '1080p', url: url }],
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 0. Dizikorea / playerdkorea.xyz Direct 1080p HLS Resolver
  if (url.includes('playerdkorea.xyz') || url.includes('playerkorea') || provider === 'dizikorea') {
    try {
      const m = url.match(/(?:\/video\/|[?&]data=|\/embed\/)([a-zA-Z0-9]+)/);
      const videoId = m?.[1];
      if (videoId) {
        const body = new URLSearchParams({ hash: videoId, r: 'https://dizikorea3.com/' });
        const postResp = await fetch(`https://playerdkorea.xyz/player/index.php?data=${videoId}&do=getVideo`, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Referer': `https://playerdkorea.xyz/video/${videoId}`,
            'Origin': 'https://playerdkorea.xyz',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(6000),
        });

        if (postResp.ok) {
          const data = await postResp.json();
          const streamUrl = data.securedLink || data.videoSource;
          if (streamUrl) {
            let workingRef: string | null = null;
            // Quick probe with dizikorea3.com
            try {
              const r1 = await fetch(streamUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  Referer: 'https://dizikorea3.com/',
                  Origin: 'https://dizikorea3.com',
                },
                signal: AbortSignal.timeout(4000),
              });
              if (r1.ok) {
                workingRef = 'https://dizikorea3.com/';
              } else if (r1.status !== 404) {
                workingRef = 'https://dizikorea3.com/';
              }
            } catch {}

            if (!workingRef) {
              // Probe with playerdkorea.xyz
              try {
                const r2 = await fetch(streamUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Referer: 'https://playerdkorea.xyz/',
                    Origin: 'https://playerdkorea.xyz',
                  },
                  signal: AbortSignal.timeout(4000),
                });
                if (r2.ok) {
                  workingRef = 'https://playerdkorea.xyz/';
                }
              } catch {}
            }

            if (!workingRef) {
              return NextResponse.json(
                { error: 'Dizikorea video dosyası sunucudan silinmiş (404)', isDead: true },
                { status: 410 }
              );
            }

            const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent(workingRef)}`;
            return NextResponse.json({
              mode: 'native_hls',
              streamUrl: proxiedStream,
              streamType: 'hls',
              directUrl: streamUrl,
              posterImage: data.videoImage || null,
              qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
            });
          }
        }
      }
      return NextResponse.json(
        { error: 'Dizikorea kaynağı artık mevcut değil veya yanıt vermiyor', isDead: true },
        { status: 410 }
      );
    } catch {
      return NextResponse.json(
        { error: 'Dizikorea kaynağına erişilemedi', isDead: true },
        { status: 410 }
      );
    }
  }

  // 0a. Dizibox / DBX Pro / Molystream Direct 1080p HLS Resolver
  if (url.includes('molystream') || url.includes('/player/king/') || provider === 'dizibox' || provider === 'dbx') {
    try {
      let embedUrl = url;
      if (url.includes('/player/king/')) {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.dizibox.live/',
          },
          signal: AbortSignal.timeout(5000),
        });
        const html = await resp.text();
        const m = html.match(/src=["'](https:\/\/dbx\.molystream\.org\/embed\/[^"']+)["']/);
        if (m) embedUrl = m[1];
      }

      const mId = embedUrl.match(/embed\/(?:sheila\/)?([a-zA-Z0-9-]+)/);
      const videoId = mId?.[1];
      if (videoId) {
        const hlsUrl = `https://dbx.molystream.org/embed/sheila/${videoId}`;
        const proxiedStream = `/api/stream-proxy?url=${encodeURIComponent(hlsUrl)}&ref=${encodeURIComponent('https://dbx.molystream.org/')}`;
        return NextResponse.json({
          mode: 'native_hls',
          streamUrl: proxiedStream,
          streamType: 'hls',
          directUrl: hlsUrl,
          qualities: [{ label: '1080p (Full HD)', url: proxiedStream }],
        });
      }
    } catch {}
  }

  // 0b. HDFilmcehennemi Close Player & Rapidrame Direct HLS / Dual Audio / Subtitles Resolver
  if (
    url.includes('hdfilmcehennemi.mobi/video/embed') ||
    url.includes('playmix.uno') ||
    url.includes('rapidrame') ||
    provider.includes('close') ||
    provider.includes('rapid') ||
    provider === 'hdfilm-close' ||
    provider === 'hdfilm-hls'
  ) {
    try {
      // Direct playmix.uno, rapidrame m3u8, or master.txt
      if (
        url.includes('.m3u8') ||
        (url.includes('master.txt') && !url.includes('/video/embed/')) ||
        (url.includes('rapidrame.com') && (url.includes('/hls') || url.includes('.m3u8'))) ||
        (url.includes('playmix.uno') && url.includes('master.txt'))
      ) {
        const streamReferer = url.includes('rapidrame')
          ? 'https://www.hdfilmcehennemi.nl/'
          : 'https://hdfilmcehennemi.mobi/';
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(streamReferer)}`;
        return NextResponse.json(
          {
            mode: 'native_hls',
            streamUrl: proxiedUrl,
            qualities: [{ label: '1080p', url: proxiedUrl }],
            fallbackIframe: url,
          },
          { headers: CACHE_HEADERS }
        );
      }

      // Embed page (e.g. Close Player https://hdfilmcehennemi.mobi/video/embed/... or Rapidrame https://www.hdfilmcehennemi.nl/rplayer/...)
      if (url.includes('hdfilmcehennemi.mobi/video/embed/') || url.includes('/video/embed/') || url.includes('/rplayer/')) {
        let html = '';
        try {
          const embedResp = await fetch(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Referer: 'https://www.hdfilmcehennemi.nl/',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (embedResp.ok) {
            html = await embedResp.text();
          }
        } catch {}

        if (!html || html.includes('Just a moment...') || html.includes('Turnstile')) {
          try {
            const { execFile } = await import('child_process');
            html = await new Promise<string>((resolve, reject) => {
              execFile(
                'curl.exe',
                [
                  '-s',
                  '-L',
                  '-H', 'Referer: https://www.hdfilmcehennemi.nl/',
                  '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                  '--connect-timeout', '6',
                  '--max-time', '10',
                  url,
                ],
                { maxBuffer: 10 * 1024 * 1024 },
                (err, stdout) => (err ? reject(err) : resolve(stdout))
              );
            });
          } catch {}
        }

        if (html) {
          // 1. Extract WebVTT subtitles
          const tracksMatch = html.match(/tracks:\s*(\[[^\]]+\])/);
          let subtitles: Array<{ label: string; lang: string; url: string; default?: boolean }> = [];
          if (tracksMatch?.[1]) {
            try {
              const unescaped = tracksMatch[1].replaceAll('\\/', '/');
              const rawTracks = JSON.parse(unescaped);
              subtitles = rawTracks
                .filter((t: any) => t.file && (t.kind === 'captions' || t.kind === 'subtitles'))
                .map((t: any) => {
                  let cleanLabel = t.label || 'Altyazı';
                  const lower = cleanLabel.toLowerCase();
                  let lang = 'tr';
                  if (lower.includes('tur') || lower.includes('forced') || lower.includes('türk')) {
                    cleanLabel = 'Türkçe';
                    lang = 'tr';
                  } else if (lower.includes('eng') || lower.includes('ing')) {
                    cleanLabel = 'İngilizce';
                    lang = 'en';
                  }
                  const proxiedSub = `/api/stream-proxy?url=${encodeURIComponent(t.file)}&ref=${encodeURIComponent('https://hdfilmcehennemi.mobi/')}`;
                  return {
                    label: cleanLabel,
                    lang,
                    url: proxiedSub,
                    default: !!t.default,
                  };
                });
            } catch {}
          }

          // 2. Resolve Master HLS URL from obfuscated jwplayer setup or unpack
          let masterHlsUrl: string | null = null;
          const scriptMatches = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) || [];
          const cand = scriptMatches.find((s) => s.includes('jwplayer') && (s.includes('eval(function') || s.includes('sources') || s.includes('.split(') || s.includes('master')));
          if (cand) {
            const cleanCode = cand.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const stub = `
              const createProxy = () => new Proxy(() => createProxy(), { get: (t, p) => p === 'then' ? undefined : createProxy(), apply: () => createProxy() });
              var window = new Proxy({
                lastCheckPoint: 0,
                location: { href: '${url}' },
                addEventListener: () => {},
                removeEventListener: () => {},
                navigator: { userAgent: 'Mozilla/5.0' },
                screen: { width: 1920, height: 1080 }
              }, {
                get: (target, prop) => prop in target ? target[prop] : createProxy()
              });
              var document = createProxy();
              var localStorage = {};
              var setInterval = () => 0;
              var setTimeout = () => 0;
              var extractedUrl = null;
              var jwplayer = () => ({
                setup: (cfg) => {
                  if (cfg && cfg.sources && cfg.sources[0]) {
                    extractedUrl = cfg.sources[0].file;
                  }
                  return createProxy();
                },
                on: () => createProxy(),
                addButton: () => createProxy(),
                getContainer: () => createProxy()
              });
              jwplayer.key = "test";
              var $ = createProxy();
            `;
            try {
              const fn = new Function(stub + cleanCode + `\nreturn extractedUrl;`);
              const resolved = fn();
              if (resolved && typeof resolved === 'string' && resolved.startsWith('http')) {
                masterHlsUrl = resolved;
              }
            } catch (err: any) {
              console.error('RPLAYER UNPACK ERROR:', err?.message);
            }
          }

          if (!masterHlsUrl) {
            const mDirect =
              html.match(/https?:\/\/[^"'\s]*\.mp4\/master\.txt[^"'\s]*/) ||
              html.match(/file:\s*["'](https?:\/\/[^"'\s]*\.m3u8[^"'\s]*)["']/) ||
              html.match(/https?:\/\/[^"'\s]*\.m3u8[^"'\s]*/);
            if (mDirect) masterHlsUrl = mDirect[1] || mDirect[0];
          }

          if (masterHlsUrl) {
            const streamReferer =
              url.includes('/rplayer/') || masterHlsUrl.includes('rapidrame')
                ? 'https://www.hdfilmcehennemi.nl/'
                : 'https://hdfilmcehennemi.mobi/';
            const proxiedMaster = `/api/stream-proxy?url=${encodeURIComponent(masterHlsUrl)}&ref=${encodeURIComponent(streamReferer)}`;
            return NextResponse.json(
              {
                mode: 'native_hls',
                streamUrl: proxiedMaster,
                qualities: [{ label: '1080p', url: proxiedMaster }],
                subtitles,
                fallbackIframe: url,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      }
    } catch {}
  }

  // 1. Tau-Video Direct MP4/HLS Quality Resolver (for AnimeciX / Tau-Video sources)
  if (provider === 'tau-video' || url.includes('tau-video.xyz')) {
    try {
      const m = url.match(/\/embed\/([a-zA-Z0-9_-]+)/) || url.match(/video\/([a-zA-Z0-9_-]+)/);
      const code = m?.[1];
      if (code) {
        const apiResp = await fetch(`https://tau-video.xyz/api/video/${code}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Referer: 'https://tau-video.xyz/',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(6000),
          next: { revalidate: 3600 },
        });
        if (apiResp.ok) {
          const data = await apiResp.json();
          const urls: Array<{ label: string; url: string; size?: number }> =
            data?.urls || [];
          if (urls.length > 0) {
            const sorted = [...urls].sort((a, b) => {
              const qa = parseInt(a.label || '0', 10);
              const qb = parseInt(b.label || '0', 10);
              return qb - qa;
            });
            return NextResponse.json(
              {
                mode: 'native_mp4',
                qualities: sorted.map((q) => ({
                  label: q.label || '1080p',
                  url: q.url,
                })),
                streamUrl: sorted[0].url,
                fallbackIframe: url,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      }
    } catch {
      // Edge Fallback: query Cloudflare Edge Worker
      try {
        const edgeRes = await fetch(
          `https://koup-edge-worker.caganhuseyinerdil.workers.dev/tau?key=${url.split('/').pop()}`,
          { signal: AbortSignal.timeout(4000), next: { revalidate: 3600 } }
        );
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (edgeData?.urls?.length > 0) {
            return NextResponse.json(
              {
                mode: 'native_mp4',
                qualities: edgeData.urls,
                streamUrl: edgeData.urls[0].url,
                fallbackIframe: url,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      } catch {
        // proceed to iframe fallback
      }
    }
  }

  // 2. Direct HLS / MP4 pass-through (with stream-proxy for CDNs and CORS protection)
  if (url.includes('.m3u8') || url.includes('master.txt') || url.includes('dtpasn.asia')) {
    let customRef = '';
    if (url.includes('rapidrame') || url.includes('hdfilm')) {
      customRef = 'https://www.hdfilmcehennemi.nl/';
    } else if (url.includes('dtpasn') || url.includes('dizikorea')) {
      customRef = 'https://dizikorea3.com/';
    } else if (url.includes('molystream') || url.includes('dizibox')) {
      customRef = 'https://dbx.molystream.org/';
    } else if (url.includes('animecix') || url.includes('tau-video')) {
      customRef = 'https://animecix.net/';
    }

    const finalStreamUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}${customRef ? `&ref=${encodeURIComponent(customRef)}` : ''}`;

    return NextResponse.json(
      {
        mode: 'native_hls',
        streamUrl: finalStreamUrl,
        qualities: [{ label: '1080p', url: finalStreamUrl }],
        fallbackIframe: url,
      },
      { headers: CACHE_HEADERS }
    );
  }
  if (
    url.endsWith('.mp4') ||
    url.includes('.mp4?') ||
    url.includes('.mp4&') ||
    url.includes('videoplayback') ||
    url.includes('downloader.disk.yandex') ||
    url.includes('content_type=video')
  ) {
    const needsProxy =
      url.includes('vmcdn.ciner.com.tr') ||
      url.includes('downloader.disk.yandex') ||
      url.includes('yadi.sk');

    let streamUrl = url;
    if (needsProxy) {
      const ref = url.includes('ciner')
        ? 'https://www.showtv.com.tr/'
        : url.includes('yandex')
        ? 'https://disk.yandex.com.tr/'
        : '';
      streamUrl = `/api/stream-proxy?url=${encodeURIComponent(url)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`;
    }

    // Multi-quality resolution generator (Tau-Video & CDN streams)
    const qualities: Array<{ label: string; url: string }> = [];
    if (streamUrl.includes('1080p')) {
      qualities.push({ label: '1080p (Full HD)', url: streamUrl });
      qualities.push({ label: '720p (HD)', url: streamUrl.replaceAll('1080p', '720p') });
      qualities.push({ label: '480p (SD)', url: streamUrl.replaceAll('1080p', '480p') });
    } else if (streamUrl.includes('720p')) {
      qualities.push({ label: '1080p (Full HD)', url: streamUrl.replaceAll('720p', '1080p') });
      qualities.push({ label: '720p (HD)', url: streamUrl });
      qualities.push({ label: '480p (SD)', url: streamUrl.replaceAll('720p', '480p') });
    } else {
      qualities.push({ label: '1080p', url: streamUrl });
    }

    return NextResponse.json(
      {
        mode: 'native_mp4',
        streamUrl,
        qualities,
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 3. YouTube Streams normalization (with enablejsapi=1 for postMessage telemetry)
  if (
    lowerUrl.includes('youtube.com') ||
    lowerUrl.includes('youtu.be') ||
    lowerUrl.includes('youtube-nocookie.com') ||
    provider === 'youtube'
  ) {
    let videoId = '';
    const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_\-]+)/);
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_\-]+)/);
    const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_\-]+)/);

    if (embedMatch) videoId = embedMatch[1];
    else if (watchMatch) videoId = watchMatch[1];
    else if (shortMatch) videoId = shortMatch[1];

    if (videoId) {
      const cleanUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&controls=0&disablekb=1&fs=0&modestbranding=1&iv_load_policy=3`;
      return NextResponse.json(
        {
          mode: 'iframe',
          isYouTube: true,
          streamUrl: cleanUrl,
          iframeUrl: cleanUrl,
        },
        { headers: CACHE_HEADERS }
      );
    }
  }

  // 4. Universal External Provider Direct Stream Extractor -> KoUp Native NetflixPlayer
  const commonUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  // 4a. Sibnet (video.sibnet.ru/shell.php?videoid=...) -> Direct MP4
  if (provider === 'sibnet' || lowerUrl.includes('sibnet.ru')) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://video.sibnet.ru/',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const srcMatch =
          html.match(/player\.src\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+\.mp4[^"']*)["']/i) ||
          html.match(/src\s*:\s*["'](\/v\/[^"']+\.mp4[^"']*)["']/i);
        if (srcMatch?.[1]) {
          const absMp4 = new URL(srcMatch[1], 'https://video.sibnet.ru').toString();
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(absMp4)}&ref=${encodeURIComponent('https://video.sibnet.ru/')}`;
          return NextResponse.json(
            {
              mode: 'native_mp4',
              streamUrl: proxiedUrl,
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: url,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
      return NextResponse.json(
        { error: 'Sibnet videosu yayından kaldırılmış veya engellenmiş (403/404)', isDead: true },
        { status: 410 }
      );
    } catch {
      return NextResponse.json(
        { error: 'Sibnet videosuna erişilemedi', isDead: true },
        { status: 410 }
      );
    }
  }

  // 4b. Vidmoly & MolyStream (vidmoly.biz / vidmoly.to / dbx.molystream.org) -> Direct HLS (.m3u8)
  if (
    provider.includes('vidmoly') ||
    provider.includes('moly') ||
    lowerUrl.includes('vidmoly') ||
    lowerUrl.includes('molystream')
  ) {
    try {
      const normalizedVidmoly = url
        .replace(/\/\/(?:www\.)?vidmoly\.to\//i, '//vidmoly.biz/')
        .replace(/\/\/(?:www\.)?vidmolynet\//i, '//vidmoly.biz/');
      const parsedVm = new URL(normalizedVidmoly);
      const vmRef = `${parsedVm.protocol}//${parsedVm.host}/`;

      const resp = await fetch(normalizedVidmoly, {
        headers: {
          'User-Agent': commonUA,
          Referer: vmRef,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok && (resp.status === 404 || resp.status === 410)) {
        return NextResponse.json(
          { error: 'Vidmoly videosu bulunamadı (404)', isDead: true },
          { status: 410 }
        );
      }

      const html = await resp.text();
      if (
        html.includes('This video not found') ||
        html.includes('File was deleted') ||
        html.includes('Video not found') ||
        html.includes('deleted by owner') ||
        html.includes('File Not Found') ||
        html.includes('404 Not Found')
      ) {
        return NextResponse.json(
          { error: 'Vidmoly videosu silinmiş', isDead: true },
          { status: 410 }
        );
      }
        const m3u8Match =
          html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
          html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(m3u8Match[1])}&ref=${encodeURIComponent(vmRef)}`;
          const label = lowerUrl.includes('moly') ? '1080p HLS (MolyStream)' : '1080p HLS (Vidmoly)';
          return NextResponse.json(
            {
              mode: 'native_hls',
              streamUrl: proxiedUrl,
              qualities: [{ label, url: proxiedUrl }],
              fallbackIframe: normalizedVidmoly,
            },
            { headers: CACHE_HEADERS }
          );
        }
    } catch {
      // fall through to iframe
    }
  }

  // 4c. OK.RU (ok.ru/videoembed/... or odnoklassniki) -> Direct HLS / MP4
  if (provider === 'ok.ru' || provider === 'odnoklassniki' || lowerUrl.includes('ok.ru/videoembed')) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: 'https://ok.ru/',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const dataOptsMatch = html.match(/data-options="([^"]+)"/i);
        if (dataOptsMatch?.[1]) {
          const decodedOpts = dataOptsMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          const optsJson = JSON.parse(decodedOpts);
          const metaStr = optsJson?.flashvars?.metadata;
          if (typeof metaStr === 'string') {
            const meta = JSON.parse(metaStr);
            const hlsUrl = meta?.ondemandHls || meta?.hlsManifestUrl;
            if (hlsUrl && typeof hlsUrl === 'string') {
              return NextResponse.json(
                {
                  mode: 'native_hls',
                  streamUrl: hlsUrl,
                  qualities: [{ label: '1080p', url: hlsUrl }],
                  fallbackIframe: url,
                },
                { headers: CACHE_HEADERS }
              );
            }
            if (Array.isArray(meta?.videos) && meta.videos.length > 0) {
              const rank: Record<string, number> = {
                ultra: 6,
                quad: 5,
                full: 4,
                hd: 3,
                sd: 2,
                low: 1,
                lowest: 0,
                mobile: 0,
              };
              const labelMap: Record<string, string> = {
                ultra: '2160p',
                quad: '1440p',
                full: '1080p',
                hd: '720p',
                sd: '480p',
                low: '360p',
                lowest: '240p',
                mobile: '144p',
              };
              const validVideos = meta.videos
                .filter((v: any) => v?.url && !v.disallowed)
                .sort((a: any, b: any) => (rank[b.name] ?? 0) - (rank[a.name] ?? 0));
              if (validVideos.length > 0) {
                const qualities = validVideos.map((v: any) => ({
                  label: labelMap[v.name] || v.name || 'HD',
                  url: `/api/stream-proxy?url=${encodeURIComponent(v.url)}&ref=${encodeURIComponent('https://ok.ru/')}`,
                }));
                return NextResponse.json(
                  {
                    mode: 'native_mp4',
                    streamUrl: qualities[0].url,
                    qualities,
                    fallbackIframe: url,
                  },
                  { headers: CACHE_HEADERS }
                );
              }
            }
          }
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4d. Mail.ru (my.mail.ru/video/embed/...) -> Direct MP4 qualities
  if (provider.includes('mail.ru') || lowerUrl.includes('my.mail.ru')) {
    try {
      const match = url.match(/embed\/([^/?#]+)/) || url.match(/video\/([^/?#]+)/);
      const videoKey = match?.[1];
      if (videoKey) {
        const metaResp = await fetch(`https://my.mail.ru/+/video/meta/${videoKey}`, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://my.mail.ru/',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (metaResp.ok) {
          const metaJson = await metaResp.json();
          const videos = metaJson?.videos;
          if (Array.isArray(videos) && videos.length > 0) {
            const sorted = [...videos].sort((a: any, b: any) => {
              const qa = parseInt(a.key || '0', 10);
              const qb = parseInt(b.key || '0', 10);
              return qb - qa;
            });
            const qualities = sorted.map((v: any) => ({
              label: `${v.key || 'HD'}p`,
              url: `/api/stream-proxy?url=${encodeURIComponent(v.url)}&ref=${encodeURIComponent('https://my.mail.ru/')}`,
            }));
            return NextResponse.json(
              {
                mode: 'native_mp4',
                streamUrl: qualities[0].url,
                qualities,
                fallbackIframe: url,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4e. DailyMotion (dailymotion.com/embed/video/... or dai.ly/...) -> Direct HLS
  if (provider.includes('dailymotion') || lowerUrl.includes('dailymotion.com') || lowerUrl.includes('dai.ly')) {
    try {
      const dmMatch = url.match(/\/video\/([a-zA-Z0-9]+)/) || url.match(/dai\.ly\/([a-zA-Z0-9]+)/);
      const dmId = dmMatch?.[1];
      if (dmId) {
        const dmResp = await fetch(`https://www.dailymotion.com/player/metadata/video/${dmId}`, {
          headers: {
            'User-Agent': commonUA,
            Referer: 'https://www.dailymotion.com/',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (dmResp.ok) {
          const dmData = await dmResp.json();
          const m3u8Url = dmData?.qualities?.auto?.[0]?.url;
          if (m3u8Url && typeof m3u8Url === 'string') {
            return NextResponse.json(
              {
                mode: 'native_hls',
                streamUrl: m3u8Url,
                qualities: [{ label: '1080p', url: m3u8Url }],
                fallbackIframe: url,
              },
              { headers: CACHE_HEADERS }
            );
          }
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4f. PixelDrain (pixeldrain.com/u/... or /api/file/...) -> Direct MP4
  if (provider.includes('pixeldrain') || lowerUrl.includes('pixeldrain.com')) {
    try {
      const pdMatch = url.match(/(?:u|file)\/([a-zA-Z0-9]+)/);
      const pdId = pdMatch?.[1];
      if (pdId) {
        const directMp4 = `https://pixeldrain.com/api/file/${pdId}`;
        const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(directMp4)}&ref=${encodeURIComponent('https://pixeldrain.com/')}`;
        return NextResponse.json(
          {
            mode: 'native_mp4',
            streamUrl: proxiedUrl,
            qualities: [{ label: '1080p', url: proxiedUrl }],
            fallbackIframe: url,
          },
          { headers: CACHE_HEADERS }
        );
      }
    } catch {
      // fall through to iframe
    }
  }

  // 4g. Sendvid / Yourupload / Mp4upload / Voe / Filemoon / Streamwish / Vidguard / Vidspeed generic stream extraction
  if (
    [
      'sendvid',
      'yourupload',
      'mp4upload',
      'voe',
      'filemoon',
      'streamwish',
      'strw',
      'awish',
      'vidguard',
      'vidspeed',
      'streamtape',
    ].some((p) => provider.includes(p) || lowerUrl.includes(p))
  ) {
    try {
      const parsedU = new URL(url);
      const refOrigin = `${parsedU.protocol}//${parsedU.host}/`;
      const resp = await fetch(url, {
        headers: {
          'User-Agent': commonUA,
          Referer: refOrigin,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const html = await resp.text();
        const m3u8Match =
          html.match(/(?:file|source|hls|video_source)\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
          html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m3u8Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(m3u8Match[1])}&ref=${encodeURIComponent(refOrigin)}`;
          return NextResponse.json(
            {
              mode: 'native_hls',
              streamUrl: proxiedUrl,
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: url,
            },
            { headers: CACHE_HEADERS }
          );
        }

        const mp4Match =
          html.match(/(?:file|source|src|video_source)\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
          html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
        if (mp4Match?.[1]) {
          const proxiedUrl = `/api/stream-proxy?url=${encodeURIComponent(mp4Match[1])}&ref=${encodeURIComponent(refOrigin)}`;
          return NextResponse.json(
            {
              mode: 'native_mp4',
              streamUrl: proxiedUrl,
              qualities: [{ label: '1080p', url: proxiedUrl }],
              fallbackIframe: url,
            },
            { headers: CACHE_HEADERS }
          );
        }
      }
    } catch {
      // fall through to iframe
    }
  }

  // 5. Default to clean iframe shell
  return NextResponse.json(
    {
      mode: 'iframe',
      iframeUrl: url,
    },
    { headers: CACHE_HEADERS }
  );
}
