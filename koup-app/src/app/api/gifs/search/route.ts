import { NextRequest, NextResponse } from 'next/server';

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'sXpGFDGZs0Dv1mmNFvYaGUvYwKX0PWIh';

// In-memory LRU cache to minimize external network requests and maximize speed
const searchCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(30, Math.max(1, Number(searchParams.get('limit')) || 16));

    const cacheKey = `${q.toLowerCase()}_${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
        },
      });
    }

    const endpoint = q && q !== 'trending'
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13&lang=tr`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=${limit}&rating=pg-13`;

    const res = await fetch(endpoint, {
      next: { revalidate: 1800 },
      headers: {
        'User-Agent': 'KoUp-Web-Client/2.0',
      },
    });

    if (!res.ok) {
      return NextResponse.json({ gifs: [], error: 'Upstream fetch failed' }, { status: 200 });
    }

    const json = await res.json();
    const rawList = Array.isArray(json?.data) ? json.data : [];

    const gifs = rawList.map((g: any) => ({
      id: g.id,
      title: g.title || 'GIF',
      url: g.images?.fixed_height?.url || g.images?.original?.url || '',
      previewUrl: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || '',
      width: Number(g.images?.fixed_height?.width) || 200,
      height: Number(g.images?.fixed_height?.height) || 200,
    })).filter((g: any) => Boolean(g.url));

    const responsePayload = { gifs };

    // Update in-memory cache
    if (searchCache.size > 200) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { data: responsePayload, timestamp: Date.now() });

    return NextResponse.json(responsePayload, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { gifs: [], error: err?.message || 'Internal error' },
      { status: 200 }
    );
  }
}
