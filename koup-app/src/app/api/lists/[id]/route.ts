import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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

    const { data, error } = await supabase.rpc('get_list_detail', {
      list_identifier: id,
    });

    if (error) {
      console.error('Error fetching list detail RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
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
    const { id } = await params;
    const body = await req.json();
    const { action, media_id, title, description, visibility, user_id } = body;

    const isNum = /^[0-9]+$/.test(id);
    let query = supabase.from('custom_lists').select('*');
    if (isNum) query = query.eq('id', Number(id));
    else query = query.eq('slug', id);

    const { data: existingList, error: fetchErr } = await query.single();
    if (fetchErr || !existingList) {
      return NextResponse.json(
        { success: false, error: 'Liste bulunamadı.' },
        { status: 404 }
      );
    }

    // Check ownership if user_id is provided
    if (user_id && existingList.user_id !== user_id) {
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
    if (visibility === 'public' || visibility === 'private') updates.visibility = visibility;

    // Handle adding/removing media items
    if (action === 'add' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? [...existingList.media_ids] : [];
      if (!currentIds.includes(Number(media_id))) {
        currentIds.push(Number(media_id));
        updates.media_ids = currentIds;
      }
    } else if (action === 'remove' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? [...existingList.media_ids] : [];
      updates.media_ids = currentIds.filter((m) => Number(m) !== Number(media_id));
    } else if (action === 'toggle' && media_id) {
      const currentIds = Array.isArray(existingList.media_ids) ? [...existingList.media_ids] : [];
      const numMedia = Number(media_id);
      if (currentIds.includes(numMedia)) {
        updates.media_ids = currentIds.filter((m) => Number(m) !== numMedia);
      } else {
        currentIds.push(numMedia);
        updates.media_ids = currentIds;
      }
    }

    const { data: updatedList, error: updateErr } = await supabase
      .from('custom_lists')
      .update(updates)
      .eq('id', existingList.id)
      .select('*')
      .single();

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 }
      );
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
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    const isNum = /^[0-9]+$/.test(id);
    let query = supabase.from('custom_lists').select('id, user_id');
    if (isNum) query = query.eq('id', Number(id));
    else query = query.eq('slug', id);

    const { data: existingList, error: fetchErr } = await query.single();
    if (fetchErr || !existingList) {
      return NextResponse.json(
        { success: false, error: 'Liste bulunamadı.' },
        { status: 404 }
      );
    }

    if (userId && existingList.user_id !== userId) {
      return NextResponse.json(
        { success: false, error: 'Bu listeyi silme yetkiniz yok.' },
        { status: 403 }
      );
    }

    const { error: delErr } = await supabase
      .from('custom_lists')
      .delete()
      .eq('id', existingList.id);

    if (delErr) {
      return NextResponse.json(
        { success: false, error: delErr.message },
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
