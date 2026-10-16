import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 3600;

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
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

  // 2. Direct HLS / MP4 pass-through
  if (url.includes('.m3u8') || url.includes('master.txt')) {
    return NextResponse.json(
      {
        mode: 'native_hls',
        streamUrl: url,
        qualities: [{ label: 'Auto (1080p HLS)', url }],
      },
      { headers: CACHE_HEADERS }
    );
  }
  if (url.endsWith('.mp4') || url.includes('.mp4?')) {
    return NextResponse.json(
      {
        mode: 'native_mp4',
        streamUrl: url,
        qualities: [{ label: '1080p Direct', url }],
      },
      { headers: CACHE_HEADERS }
    );
  }

  // 3. Default to iframe shell with KoUp Netflix Top Control Dock
  return NextResponse.json(
    {
      mode: 'iframe',
      iframeUrl: url,
    },
    { headers: CACHE_HEADERS }
  );
}
