import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyUserSession } from '@/lib/adminAuth';

export async function GET(req: NextRequest) {
  try {
    const session = await verifyUserSession(req);
    const { searchParams } = new URL(req.url);
    const requestedId = searchParams.get('user_id');

    const userId = session.authenticated ? session.userId! : null;
    if (!userId || (requestedId && requestedId !== userId && session.role !== 'admin')) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim.' },
        { status: 401 }
      );
    }

    const { data, error } = await supabase.rpc('fetch_user_blocks_for_id', {
      p_user_id: userId,
    });

    if (error) {
      console.error('Error fetching user blocks RPC:', error);
      return NextResponse.json(
        { success: false, error: error.message, blocks: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      blocks: data || [],
    });
  } catch (err: any) {
    console.error('Unexpected error in GET /api/users/block:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal Server Error', blocks: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifyUserSession(req);
    const body = await req.json();
    const { blocker_id, blocked_id, action = 'toggle' } = body;

    const verifiedBlockerId = session.authenticated ? session.userId! : null;
    if (!verifiedBlockerId || (blocker_id && blocker_id !== verifiedBlockerId)) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz işlem: Oturum doğrulanamadı.' },
        { status: 401 }
      );
    }

    if (!blocked_id) {
      return NextResponse.json(
        { success: false, error: 'blocked_id gereklidir' },
        { status: 400 }
      );
    }

    if (verifiedBlockerId === blocked_id) {
      return NextResponse.json(
        { success: false, error: 'Kendinizi engelleyemezsiniz' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('manage_user_block', {
      p_blocker_id: verifiedBlockerId,
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

    return NextResponse.json({
      success: true,
      result: data,
    });
  } catch (err: any) {
    console.error('Unexpected error in POST /api/users/block:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
