import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    const targetType = body.target_type === 'person' ? 'person' : 'media';
    const targetId = Number(body.target_id);

    if (!userId || !targetId || Number.isNaN(targetId)) {
      return NextResponse.json(
        { success: false, error: 'Geçersiz parametreler.' },
        { status: 400 }
      );
    }

    const client = supabaseAdmin || supabase;
    const { data, error } = await client.rpc('toggle_user_follow', {
      p_user_id: userId,
      p_target_type: targetType,
      p_target_id: targetId,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, following: Boolean(data) });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Sunucu hatası' },
      { status: 500 }
    );
  }
}
