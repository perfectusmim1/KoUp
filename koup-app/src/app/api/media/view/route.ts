import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase, checkAdminRateLimit } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const VIEWER_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown-ip'
  );
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = checkAdminRateLimit(`media-view:${ip}`, 60, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { counted: false, error: 'Çok fazla görüntüleme isteği gönderildi.' },
        { status: 429 }
      );
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ counted: false, error: 'Geçersiz istek gövdesi.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ counted: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
    }

    const mediaId = Number(body.media_id);
    if (!Number.isInteger(mediaId) || mediaId <= 0 || mediaId > 10_000_000) {
      return NextResponse.json({ counted: false, error: 'Geçersiz media_id.' }, { status: 400 });
    }

    let viewerKey: string | null = null;
    if (body.viewer_key !== undefined && body.viewer_key !== null) {
      if (typeof body.viewer_key !== 'string') {
        return NextResponse.json({ counted: false, error: 'Geçersiz viewer_key.' }, { status: 400 });
      }
      const trimmedKey = body.viewer_key.trim();
      if (trimmedKey.length > 0) {
        if (!VIEWER_KEY_REGEX.test(trimmedKey)) {
          return NextResponse.json({ counted: false, error: 'Geçersiz viewer_key biçimi.' }, { status: 400 });
        }
        viewerKey = trimmedKey;
      }
    }

    if (body.kind !== undefined && body.kind !== 'detail' && body.kind !== 'watch') {
      return NextResponse.json({ counted: false, error: 'Geçersiz kind değeri.' }, { status: 400 });
    }
    const kind = body.kind === 'watch' ? 'watch' : 'detail';

    const season = body.season === undefined ? 1 : Number(body.season);
    const episode = body.episode === undefined ? 1 : Number(body.episode);
    if (!Number.isInteger(season) || season <= 0 || season > 500) {
      return NextResponse.json({ counted: false, error: 'Geçersiz season değeri.' }, { status: 400 });
    }
    if (!Number.isInteger(episode) || episode <= 0 || episode > 50_000) {
      return NextResponse.json({ counted: false, error: 'Geçersiz episode değeri.' }, { status: 400 });
    }

    const client = getServiceSupabase();
    const { data, error } = await client.rpc('increment_media_view', {
      p_media_id: mediaId,
      p_viewer_key: viewerKey,
      p_kind: kind,
      p_season: season,
      p_episode: episode,
    });

    if (error) {
      return NextResponse.json({ counted: false }, { status: 200 });
    }

    return NextResponse.json(data || { counted: false });
  } catch {
    return NextResponse.json({ counted: false }, { status: 200 });
  }
}
