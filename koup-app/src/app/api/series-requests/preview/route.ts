import { NextRequest, NextResponse } from 'next/server';
import { checkAdminRateLimit } from '@/lib/adminAuth';
import { resolveSeriesRequestUrl } from '@/lib/seriesRequestResolver';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'anon';
    const rate = checkAdminRateLimit(`series-req-preview:${ip}`, 25, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: `Çok fazla önizleme isteği gönderdiniz. Lütfen ${rate.retryAfterSec} saniye bekleyin.`,
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!url) {
      return NextResponse.json(
        { ok: false, error: 'Lütfen geçerli bir AniList, TMDB, MyDramaList veya IMDb bağlantısı girin.' },
        { status: 400 }
      );
    }

    const result = await resolveSeriesRequestUrl(url);
    if (result.error || !result.data) {
      return NextResponse.json(
        { ok: false, error: result.error || 'Seri bilgileri çekilemedi.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      preview: result.data,
    });
  } catch (err: any) {
    console.error('[series-requests/preview] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Seri bilgileri çekilirken beklenmeyen bir hata oluştu.' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim() || '';
  if (!url) {
    return NextResponse.json(
      { ok: false, error: 'Lütfen geçerli bir bağlantı girin.' },
      { status: 400 }
    );
  }
  const result = await resolveSeriesRequestUrl(url);
  if (result.error || !result.data) {
    return NextResponse.json(
      { ok: false, error: result.error || 'Seri bilgileri çekilemedi.' },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, preview: result.data });
}
