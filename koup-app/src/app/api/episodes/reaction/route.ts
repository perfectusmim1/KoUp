import { NextRequest, NextResponse } from 'next/server';
import {
  verifyUserSession,
  getServiceSupabase,
  checkAdminRateLimit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_REACTIONS = new Set(['fire', 'cry', 'shock', 'angry'] as const);
type EpisodeReaction = 'fire' | 'cry' | 'shock' | 'angry';

/**
 * Authenticated episode reaction endpoint backed by service-role RPC increment_episode_reaction.
 */
export async function POST(req: NextRequest) {
  const session = await verifyUserSession(req);
  if (!session.authenticated || !session.userId) {
    return NextResponse.json(
      { ok: false, error: session.error || 'Tepki bırakabilmek için lütfen giriş yapın.' },
      { status: session.status || 401 }
    );
  }

  const rate = checkAdminRateLimit(`episode-reaction:${session.userId}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Çok hızlı tepki gönderiyorsunuz. Lütfen ${rate.retryAfterSec} saniye bekleyin.`,
      },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false, error: 'Geçersiz istek gövdesi.' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  }

  const mediaId = Number(body.media_id);
  const season = body.season === undefined ? 1 : Number(body.season);
  const episode = Number(body.episode);
  const reaction = typeof body.reaction === 'string' ? body.reaction.trim() : '';

  if (!Number.isInteger(mediaId) || mediaId <= 0 || mediaId > 10_000_000) {
    return NextResponse.json({ ok: false, error: 'Geçersiz media_id değeri.' }, { status: 400 });
  }
  if (!Number.isInteger(season) || season <= 0 || season > 500) {
    return NextResponse.json({ ok: false, error: 'Geçersiz season değeri.' }, { status: 400 });
  }
  if (!Number.isInteger(episode) || episode <= 0 || episode > 50_000) {
    return NextResponse.json({ ok: false, error: 'Geçersiz episode değeri.' }, { status: 400 });
  }
  if (!ALLOWED_REACTIONS.has(reaction as EpisodeReaction)) {
    return NextResponse.json(
      { ok: false, error: 'Geçersiz tepki türü (fire, cry, shock, angry).' },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: 'Supabase servis bağlantısı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  try {
    const { error } = await db.rpc('increment_episode_reaction', {
      p_media_id: mediaId,
      p_season: season,
      p_episode: episode,
      p_reaction: reaction,
      p_user_id: session.userId,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'Bölüm tepkisi kaydedilemedi.' },
        { status: 500 }
      );
    }

    const { data: epRow } = await db
      .from('episodes')
      .select('react_fire, react_cry, react_shock, react_angry')
      .eq('media_id', mediaId)
      .eq('season_number', season)
      .eq('episode_number', episode)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      reactions: {
        fire: Number(epRow?.react_fire || 0),
        cry: Number(epRow?.react_cry || 0),
        shock: Number(epRow?.react_shock || 0),
        angry: Number(epRow?.react_angry || 0),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Beklenmeyen sunucu hatası.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
