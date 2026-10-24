import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { verifyUserSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Liste ID gereklidir.' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    let { data, error } = await supabase.rpc('get_list_detail', {
      list_identifier: id,
      p_user_id: userId || null,
    });

    if (error) {
      console.error('Error fetching list detail RPC:', error);
    }

    if (!data && userId) {
      const isNum = /^[0-9]+$/.test(id);
      let q = (supabaseAdmin || supabase)
        .from('custom_lists')
        .select(`
          *,
          creator:profiles!user_id(id, username, display_name, avatar_url, bio)
        `)
        .eq('user_id', userId);
      if (isNum) q = q.eq('id', Number(id));
      else q = q.eq('slug', id);

      const { data: directList } = await q.maybeSingle();
      if (directList) {
        const mediaIds = Array.isArray(directList.media_ids) ? directList.media_ids : [];
        let items: any[] = [];
        if (mediaIds.length > 0) {
          const { data: mediaRows } = await (supabaseAdmin || supabase)
            .from('media')
            .select('id, slug, title, content_type, cover_image, backdrop_image, release_year, episode_count, country_code, country_name, site_rating, overview, categories')
            .in('id', mediaIds);
          if (mediaRows) {
            const mediaMap = new Map(mediaRows.map((m: any) => [m.id, m]));
            items = mediaIds.map((mid: number) => mediaMap.get(mid)).filter(Boolean);
          }
        }
        data = {
          id: directList.id,
          slug: directList.slug,
          title: directList.title,
          description: directList.description,
          cover_image_url: directList.cover_image_url || null,
          backdrop_image_url: directList.backdrop_image_url || null,
          visibility: directList.visibility,
          likes_count: directList.likes_count || 0,
          follower_count: directList.follower_count || 0,
          created_at: directList.created_at,
          updated_at: directList.updated_at,
          item_count: mediaIds.length,
          creator: directList.creator,
          items,
        };
      }
    }

    if (data) {
      const db = supabaseAdmin || supabase;
      const isNum = /^[0-9]+$/.test(id);
      let cq = db.from('custom_lists').select('id, cover_image_url, backdrop_image_url, likes_count');
      if (isNum) cq = cq.eq('id', Number(id));
      else cq = cq.eq('slug', id);
      const { data: cRow } = await cq.maybeSingle();
      if (cRow) {
        if (data.cover_image_url === undefined) data.cover_image_url = cRow.cover_image_url || null;
        if (data.backdrop_image_url === undefined) data.backdrop_image_url = cRow.backdrop_image_url || null;
        data.likes_count = Math.max(data.likes_count || 0, cRow.likes_count || 0);
      }

      const listNumericId = Number(data.id || cRow?.id || 0);
      if (listNumericId > 0) {
        const { count: realLikesCount } = await db
          .from('custom_list_likes')
          .select('*', { count: 'exact', head: true })
          .eq('list_id', listNumericId);
        if (typeof realLikesCount === 'number') {
          data.likes_count = Math.max(realLikesCount, data.likes_count || 0);
        }
      }
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Liste bulunamadı veya gizli.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, list: data });
  } catch (err: any) {
    console.error('API /api/lists/[id] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Sunucu hatası' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyUserSession(req);
    const { id } = await params;
    const body = await req.json();
    const { action, media_id, title, description, visibility, user_id: bodyUserId, cover_image_url, backdrop_image_url } = body;

    const user_id = session.authenticated ? session.userId! : null;
    if (!user_id || (bodyUserId && bodyUserId !== user_id && session.role !== 'admin')) {
      return NextResponse.json(
        { success: false, error: 'Bu işlem için oturum açmalısınız.' },
        { status: 401 }
      );
    }

    const isNum = /^[0-9]+$/.test(id);
    let query = (supabaseAdmin || supabase).from('custom_lists').select('*');
    if (isNum) query = query.eq('id', Number(id));
    else query = query.eq('slug', id);

    const { data: existingList, error: fetchErr } = await query.single();
    if (fetchErr || !existingList) {
      return NextResponse.json(
        { success: false, error: 'Liste bulunamadı.' },
        { status: 404 }
      );
    }

    // Strict ownership check (only list owner or admin may modify)
    if (existingList.user_id !== user_id && session.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Bu listeyi düzenleme yetkiniz yok.' },
        { status: 403 }
      );
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (title && title.trim().length >= 2) updates.title = title.trim();
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (cover_image_url !== undefined) updates.cover_image_url = cover_image_url ? cover_image_url.trim() : null;
    if (backdrop_image_url !== undefined) updates.backdrop_image_url = backdrop_image_url ? backdrop_image_url.trim() : null;
    if (visibility === 'public' || visibility === 'private') updates.visibility = visibility;

    // Handle adding/removing media items
    if (action === 'add' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? existingList.media_ids.map(Number) : [];
      const numMedia = Number(media_id);
      if (!currentIds.includes(numMedia)) {
        currentIds.push(numMedia);
      }
      updates.media_ids = currentIds;
    } else if (action === 'remove' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? existingList.media_ids.map(Number) : [];
      updates.media_ids = currentIds.filter((m: number) => Number(m) !== Number(media_id));
    } else if (action === 'toggle' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? existingList.media_ids.map(Number) : [];
      const numMedia = Number(media_id);
      if (currentIds.includes(numMedia)) {
        updates.media_ids = currentIds.filter((m: number) => Number(m) !== numMedia);
      } else {
        currentIds.push(numMedia);
        updates.media_ids = currentIds;
      }
    }

    const targetUserId = user_id || existingList.user_id;

    const { data: updatedList, error: updateErr } = await (supabaseAdmin || supabase).rpc('update_custom_list', {
      p_list_id: existingList.id,
      p_user_id: targetUserId,
      p_title: updates.title ?? null,
      p_description: updates.description ?? null,
      p_visibility: updates.visibility ?? null,
      p_media_ids: updates.media_ids !== undefined ? updates.media_ids.map(Number) : null,
    });

    if (updateErr) {
      console.warn('RPC update_custom_list error, attempting table update fallback:', updateErr);
      const { data: tableData, error: tableErr } = await (supabaseAdmin || supabase)
        .from('custom_lists')
        .update(updates)
        .eq('id', existingList.id)
        .select()
        .single();
      if (tableErr) {
        return NextResponse.json(
          { success: false, error: tableErr.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, list: tableData });
    }

    if (updatedList) {
      const extraCols: Record<string, any> = {};
      if (updates.cover_image_url !== undefined) extraCols.cover_image_url = updates.cover_image_url;
      if (updates.backdrop_image_url !== undefined) extraCols.backdrop_image_url = updates.backdrop_image_url;

      if (Object.keys(extraCols).length > 0) {
        await (supabaseAdmin || supabase)
          .from('custom_lists')
          .update(extraCols)
          .eq('id', existingList.id);
        Object.assign(updatedList, extraCols);
      }
    }

    return NextResponse.json({ success: true, list: updatedList });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Güncelleme başarısız' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyUserSession(req);
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const queryUserId = searchParams.get('user_id');
    const userId = session.authenticated ? session.userId! : null;

    if (!userId || (queryUserId && queryUserId !== userId && session.role !== 'admin')) {
      return NextResponse.json(
        { success: false, error: 'Kullanıcı oturumu gereklidir.' },
        { status: 401 }
      );
    }

    // Call RPC delete
    const { data: deleted, error: delErr } = await (supabaseAdmin || supabase).rpc('delete_custom_list', {
      list_identifier: id,
      p_user_id: userId,
    });

    if (delErr) {
      console.error('delete_custom_list RPC error:', delErr);
    }

    if (deleted) {
      return NextResponse.json({ success: true, message: 'Liste silindi' });
    }

    // Resilient fallback with strict owner or admin check
    const isNum = /^[0-9]+$/.test(id);
    let checkQuery = (supabaseAdmin || supabase).from('custom_lists').select('id, user_id');
    if (isNum) checkQuery = checkQuery.eq('id', Number(id));
    else checkQuery = checkQuery.eq('slug', id);

    const { data: listRow } = await checkQuery.maybeSingle();
    if (!listRow) {
      // If the list is already gone from DB, treat as fulfilled so UI cleans up immediately
      return NextResponse.json({
        success: true,
        message: 'Liste zaten silinmiş veya mevcut değil.',
        already_deleted: true,
      });
    }

    let isAuthorized = listRow.user_id === userId;
    if (!isAuthorized) {
      const { data: profile } = await (supabaseAdmin || supabase)
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.role === 'admin' || profile?.role === 'superadmin' || profile?.role === 'mod') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { success: false, error: 'Bu listeyi silme yetkiniz yok.' },
        { status: 403 }
      );
    }

    // Clean up relations first if any exist
    await (supabaseAdmin || supabase)
      .from('custom_list_likes')
      .delete()
      .eq('list_id', listRow.id);

    const { error: directDelErr } = await (supabaseAdmin || supabase)
      .from('custom_lists')
      .delete()
      .eq('id', listRow.id);

    if (directDelErr) {
      console.error('Direct delete custom_lists error:', directDelErr);
      return NextResponse.json(
        { success: false, error: directDelErr.message || 'Liste silinemedi.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Liste silindi' });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Silme işlemi başarısız' },
      { status: 500 }
    );
  }
}

