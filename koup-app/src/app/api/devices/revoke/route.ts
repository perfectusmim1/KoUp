import { NextRequest, NextResponse } from 'next/server';
import {
  verifyUserSession,
  getServiceSupabase,
  checkAdminRateLimit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

function isValidDeviceIdentifier(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 200) return false;
  return !/[\u0000-\u001F\u007F]/.test(trimmed);
}

/**
 * Authenticated server route to revoke one device or all other devices for the signed-in user.
 */
export async function POST(req: NextRequest) {
  const session = await verifyUserSession(req);
  if (!session.authenticated || !session.userId) {
    return NextResponse.json(
      { ok: false, error: session.error || 'Oturum doğrulanamadı.' },
      { status: session.status || 401 }
    );
  }

  const rate = checkAdminRateLimit(`device-revoke:${session.userId}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Çok fazla cihaz oturum işlemi yaptınız. Lütfen ${rate.retryAfterSec} saniye bekleyin.`,
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

  // Prevent IDOR spoofing if a caller explicitly passes a mismatched user_id
  if (typeof body.user_id === 'string' && body.user_id.trim() !== session.userId) {
    return NextResponse.json(
      { ok: false, error: 'Yetkisiz işlem: Yalnızca kendi cihaz oturumlarınızı yönetebilirsiniz.' },
      { status: 403 }
    );
  }

  const rawAction = typeof body.action === 'string' ? body.action.trim() : '';
  const action =
    rawAction ||
    (body.device_id !== undefined
      ? 'revoke_one'
      : body.current_device_id !== undefined
      ? 'revoke_all_others'
      : '');

  const db = getServiceSupabase();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: 'Supabase servis bağlantısı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  try {
    if (action === 'revoke_one') {
      if (!isValidDeviceIdentifier(body.device_id)) {
        return NextResponse.json(
          { ok: false, error: 'Geçerli bir device_id değeri zorunludur.' },
          { status: 400 }
        );
      }

      const deviceId = body.device_id.trim();
      const { data, error } = await db.rpc('revoke_user_device', {
        p_device_id: deviceId,
        p_user_id: session.userId,
      });

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message || 'Cihaz oturumu kapatılamadı.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, revoked: Boolean(data ?? true) });
    }

    if (action === 'revoke_all_others') {
      if (!isValidDeviceIdentifier(body.current_device_id)) {
        return NextResponse.json(
          { ok: false, error: 'Geçerli bir current_device_id değeri zorunludur.' },
          { status: 400 }
        );
      }

      const currentDeviceId = body.current_device_id.trim();
      const { data, error } = await db.rpc('revoke_all_other_devices', {
        p_current_device_id: currentDeviceId,
        p_user_id: session.userId,
      });

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message || 'Diğer cihaz oturumları kapatılamadı.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, revoked: Boolean(data ?? true) });
    }

    return NextResponse.json(
      { ok: false, error: 'Geçersiz işlem türü (revoke_one veya revoke_all_others bekleniyor).' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Beklenmeyen sunucu hatası.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
