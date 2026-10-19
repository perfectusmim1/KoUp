import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mediaId = Number(body.media_id);
    if (!mediaId || Number.isNaN(mediaId)) {
      return NextResponse.json({ counted: false }, { status: 400 });
    }

    const viewerKey =
      typeof body.viewer_key === 'string' && body.viewer_key.length >= 8
        ? body.viewer_key.slice(0, 128)
        : null;
    const kind = body.kind === 'watch' ? 'watch' : 'detail';
    const season = Math.max(1, Number(body.season) || 1);
    const episode = Math.max(1, Number(body.episode) || 1);

    const client = supabaseAdmin || supabase;
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
