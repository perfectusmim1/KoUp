import { NextRequest, NextResponse } from 'next/server';
import {
  checkAdminRateLimit,
  getServiceSupabase,
  logAdminAudit,
  verifyAdminAuth,
  verifyUserSession,
} from '@/lib/adminAuth';
import { resolveSeriesRequestUrl } from '@/lib/seriesRequestResolver';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getServiceSupabase();
    const isAdminQuery = req.nextUrl.searchParams.get('admin') === '1';
    const statusFilter = req.nextUrl.searchParams.get('status')?.trim() || '';

    if (isAdminQuery) {
      const auth = await verifyAdminAuth(req, { allowModerator: true });
      if (!auth.authorized) {
        return auth.response!;
      }

      let query = db
        .from('series_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(250);

      if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
        query = query.eq('status', statusFilter);
      }

      const { data: rows, error } = await query;
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const userIds = Array.from(
        new Set((rows || []).map((r: any) => r.user_id).filter(Boolean))
      );

      const profilesMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await db
          .from('profiles')
          .select('id, username, display_name, avatar_url, role')
          .in('id', userIds);
        for (const p of profiles || []) {
          profilesMap[p.id] = p;
        }
      }

      const enriched = (rows || []).map((r: any) => ({
        ...r,
        requester: profilesMap[r.user_id] || null,
      }));

      return NextResponse.json({ ok: true, requests: enriched });
    }

    const session = await verifyUserSession(req);
    if (!session.authenticated || !session.userId) {
      return NextResponse.json(
        { ok: false, error: session.error || 'Oturum açmanız gerekiyor.' },
        { status: session.status || 401 }
      );
    }

    const { data: rows, error } = await db
      .from('series_requests')
      .select('*')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, requests: rows || [] });
  } catch (err: any) {
    console.error('[series-requests GET] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'İstekler yüklenirken bir hata oluştu.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifyUserSession(req);
    if (!session.authenticated || !session.userId) {
      return NextResponse.json(
        { ok: false, error: session.error || 'Seri isteği göndermek için giriş yapmalısınız.' },
        { status: session.status || 401 }
      );
    }

    const rate = checkAdminRateLimit(`series-req-post:${session.userId}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: `Çok hızlı istek gönderiyorsunuz. Lütfen ${rate.retryAfterSec} saniye bekleyin.`,
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const userNote =
      typeof body?.user_note === 'string' ? body.user_note.trim().slice(0, 500) : null;

    if (!rawUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Lütfen geçerli bir AniList, TMDB, MyDramaList veya IMDb bağlantısı girin.',
        },
        { status: 400 }
      );
    }

    // Always resolve & validate on the server so metadata cannot be forged
    const resolved = await resolveSeriesRequestUrl(rawUrl);
    if (resolved.error || !resolved.data) {
      return NextResponse.json(
        { ok: false, error: resolved.error || 'Seri bilgileri çekilemedi.' },
        { status: 400 }
      );
    }

    const meta = resolved.data;
    const db = getServiceSupabase();

    // Prevent duplicate request from the same user for the same external series
    const { data: existingUserReq } = await db
      .from('series_requests')
      .select('id, status, title')
      .eq('user_id', session.userId)
      .eq('external_id', meta.external_id)
      .in('status', ['pending', 'approved'])
      .maybeSingle();

    if (existingUserReq) {
      const statusText =
        existingUserReq.status === 'approved' ? 'zaten onaylanmış' : 'şu anda onay bekliyor';
      return NextResponse.json(
        {
          ok: false,
          error: `"${existingUserReq.title}" için gönderdiğiniz istek ${statusText}.`,
        },
        { status: 409 }
      );
    }

    const insertPayload = {
      user_id: session.userId,
      source_type: meta.source_type,
      source_url: meta.source_url,
      external_id: meta.external_id,
      title: meta.title,
      original_title: meta.original_title,
      overview: meta.overview,
      cover_image: meta.cover_image,
      backdrop_image: meta.backdrop_image,
      release_year: meta.release_year,
      content_type: meta.content_type,
      country_code: meta.country_code,
      rating: meta.rating,
      episodes_count: meta.episodes_count,
      user_note: userNote || null,
      status: 'pending',
      media_id: meta.existing_media?.id || null,
      media_slug: meta.existing_media?.slug || null,
    };

    const { data: created, error: insertError } = await db
      .from('series_requests')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) {
      console.error('[series-requests POST] Insert error:', insertError);
      return NextResponse.json(
        { ok: false, error: 'Seri isteği kaydedilirken bir hata oluştu.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: created,
    });
  } catch (err: any) {
    console.error('[series-requests POST] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Seri isteği gönderilirken beklenmeyen bir hata oluştu.' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await verifyAdminAuth(req, { allowModerator: true });
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const status = typeof body?.status === 'string' ? body.status.trim() : '';
    const adminNote =
      typeof body?.admin_note === 'string' ? body.admin_note.trim().slice(0, 600) : null;
    const mediaSlugInput =
      typeof body?.media_slug === 'string'
        ? body.media_slug
            .trim()
            .replace(/^\/?(seri\/)?/, '')
            .replace(/\/+$/, '')
        : undefined;

    if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { ok: false, error: 'Geçersiz istek ID veya durum bilgisi.' },
        { status: 400 }
      );
    }

    const db = getServiceSupabase();
    const { data: existing, error: fetchError } = await db
      .from('series_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { ok: false, error: 'Seri isteği bulunamadı.' },
        { status: 404 }
      );
    }

    let resolvedMediaSlug =
      mediaSlugInput !== undefined ? mediaSlugInput || null : existing.media_slug || null;
    let resolvedMediaId = existing.media_id || null;

    if (resolvedMediaSlug) {
      const { data: matchedMedia } = await db
        .from('media')
        .select('id, slug')
        .eq('slug', resolvedMediaSlug)
        .maybeSingle();
      if (matchedMedia) {
        resolvedMediaId = matchedMedia.id;
        resolvedMediaSlug = matchedMedia.slug;
      }
    } else if (!resolvedMediaSlug && existing.title) {
      const { data: byTitle } = await db
        .from('media')
        .select('id, slug')
        .or(`title.ilike.${existing.title.replace(/[,%()]/g, ' ').trim()}`)
        .limit(1)
        .maybeSingle();
      if (byTitle) {
        resolvedMediaId = byTitle.id;
        resolvedMediaSlug = byTitle.slug;
      }
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      status,
      admin_note: adminNote,
      media_id: resolvedMediaId,
      media_slug: resolvedMediaSlug,
      reviewed_by: auth.userId || null,
      reviewed_at: nowIso,
      updated_at: nowIso,
    };

    const { data: updated, error: updateError } = await db
      .from('series_requests')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { ok: false, error: updateError?.message || 'İstek güncellenemedi.' },
        { status: 500 }
      );
    }

    // Send direct notification to the user when approved
    if (status === 'approved' && existing.user_id) {
      const linkUrl = resolvedMediaSlug ? `/seri/${resolvedMediaSlug}` : '/seri-istek';
      const noteSuffix = adminNote ? ` Yönetici Notu: ${adminNote}` : '';
      await db.from('user_notifications').insert({
        user_id: existing.user_id,
        type: 'system',
        title: 'Seri İsteğiniz Onaylandı! 🎉',
        body: `İstekte bulunduğunuz "${existing.title}" serisi onaylandı!${noteSuffix}`,
        link_url: linkUrl,
        image_url: existing.cover_image || null,
        is_read: false,
      });
    }

    await logAdminAudit({
      actorId: auth.userId,
      actorRole: auth.role,
      action: `series_request_${status}`,
      targetType: 'series_request',
      targetId: id,
      summary: `"${existing.title}" seri isteği ${status === 'approved' ? 'onaylandı' : status === 'rejected' ? 'reddedildi' : 'beklemeye alındı'}.`,
      metadata: {
        source_type: existing.source_type,
        source_url: existing.source_url,
        requester_id: existing.user_id,
        media_slug: resolvedMediaSlug,
      },
    });

    return NextResponse.json({
      ok: true,
      request: updated,
    });
  } catch (err: any) {
    console.error('[series-requests PATCH] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'İstek durumu güncellenirken bir hata oluştu.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await verifyUserSession(req);
    if (!session.authenticated || !session.userId) {
      return NextResponse.json(
        { ok: false, error: session.error || 'Oturum açmanız gerekiyor.' },
        { status: session.status || 401 }
      );
    }

    const id =
      req.nextUrl.searchParams.get('id')?.trim() ||
      (await req.json().catch(() => ({})))?.id ||
      '';

    if (!id) {
      return NextResponse.json({ ok: false, error: 'İstek ID belirtilmedi.' }, { status: 400 });
    }

    const db = getServiceSupabase();
    const { data: existing } = await db
      .from('series_requests')
      .select('id, user_id, status, title')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ ok: false, error: 'İstek bulunamadı.' }, { status: 404 });
    }

    const isAdminOrMod =
      session.role === 'admin' || session.role === 'moderator' || session.role === 'mod';
    const isOwnerPending =
      existing.user_id === session.userId && existing.status === 'pending';

    if (!isAdminOrMod && !isOwnerPending) {
      return NextResponse.json(
        { ok: false, error: 'Bu isteği silme yetkiniz bulunmuyor.' },
        { status: 403 }
      );
    }

    const { error: delError } = await db.from('series_requests').delete().eq('id', id);
    if (delError) {
      return NextResponse.json({ ok: false, error: delError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[series-requests DELETE] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'İstek silinirken bir hata oluştu.' },
      { status: 500 }
    );
  }
}
