import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q')?.toLowerCase()?.trim() || '';
    const sort = searchParams.get('sort') || 'popular'; // 'popular' | 'items' | 'newest'

    // Call RPC to get public lists with preview posters
    const { data: lists, error } = await supabase.rpc('get_public_lists');

    if (error) {
      console.error('Error fetching public lists RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message, lists: [] },
        { status: 500 }
      );
    }

    let results = Array.isArray(lists) ? [...lists] : [];

    // Filter by query (title, description, or creator username)
    if (query) {
      results = results.filter((item) => {
        const title = (item.title || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const username = (item.creator?.username || '').toLowerCase();
        const displayName = (item.creator?.display_name || '').toLowerCase();
        return (
          title.includes(query) ||
          desc.includes(query) ||
          username.includes(query) ||
          displayName.includes(query)
        );
      });
    }

    // Sort
    if (sort === 'popular') {
      results.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (sort === 'items') {
      results.sort((a, b) => (b.item_count || 0) - (a.item_count || 0));
    } else if (sort === 'newest') {
      results.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    return NextResponse.json(
      {
        success: true,
        count: results.length,
        lists: results,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
        },
      }
    );
  } catch (err: any) {
    console.error('API /api/lists error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Sunucu hatası', lists: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, description, visibility, user_id, media_ids } = body;

    if (!title || title.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Liste başlığı en az 2 karakter olmalıdır.' },
        { status: 400 }
      );
    }

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'Liste oluşturmak için giriş yapmalısınız.' },
        { status: 401 }
      );
    }

    const cleanTitle = title.trim();
    const baseSlug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'liste';
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await supabase.rpc('create_custom_list', {
      p_user_id: user_id,
      p_title: cleanTitle,
      p_description: description?.trim() || null,
      p_visibility: visibility === 'private' ? 'private' : 'public',
      p_media_ids: Array.isArray(media_ids) ? media_ids : [],
    });

    if (error) {
      console.warn('Failed to create custom list via RPC, trying direct insert:', error);
      const { data: insertData, error: insertErr } = await supabase
        .from('custom_lists')
        .insert({
          user_id,
          title: cleanTitle,
          description: description?.trim() || null,
          visibility: visibility === 'private' ? 'private' : 'public',
          media_ids: Array.isArray(media_ids) ? media_ids : [],
          slug,
        })
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json(
          { success: false, error: insertErr.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, list: insertData });
    }

    return NextResponse.json({ success: true, list: data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Liste oluşturulamadı' },
      { status: 500 }
    );
  }
}
