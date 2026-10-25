import { NextRequest, NextResponse } from 'next/server';
import { getFranchiseForMedia } from '@/lib/server/seriesData';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQ = 120;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX_REQ) return false;
  entry.count += 1;
  return true;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1';

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 }
    );
  }

  const { id } = await context.params;
  const mediaId = Number(id);
  if (!mediaId || Number.isNaN(mediaId) || mediaId <= 0 || mediaId > 10_000_000) {
    return NextResponse.json(
      { error: 'Invalid media ID' },
      { status: 400 }
    );
  }

  const franchise = getFranchiseForMedia(mediaId);

  return NextResponse.json(
    { franchise },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
