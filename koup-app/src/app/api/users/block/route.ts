import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id parametresi gereklidir' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('fetch_user_blocks_for_id', {
      p_user_id: userId,
    });

    if (error) {
      console.error('Error fetching blocks RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      blocked_users: data?.blocked_users || [],
      blocked_by_ids: data?.blocked_by_ids || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Sunucu hatası' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { blocker_id, blocked_id, action = 'toggle' } = body;

    if (!blocker_id || !blocked_id) {
      return NextResponse.json(
        { success: false, error: 'blocker_id ve blocked_id gereklidir' },
        { status: 400 }
      );
    }

    if (blocker_id === blocked_id) {
      return NextResponse.json(
        { success: false, error: 'Kendinizi engelleyemezsiniz' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('manage_user_block', {
      p_blocker_id: blocker_id,
      p_blocked_id: blocked_id,
      p_action: action,
    });

    if (error) {
      console.error('Error managing user block RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'İşlem başarısız' },
      { status: 500 }
    );
  }
}
