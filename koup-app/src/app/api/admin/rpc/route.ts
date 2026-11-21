import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const ALLOWED_RPCS = new Set([
  'admin_dashboard_stats',
  'admin_log_action',
  'admin_search_users',
  'admin_send_broadcast',
  'admin_triage_report',
] as const);

type AllowedRpc =
  | 'admin_dashboard_stats'
  | 'admin_log_action'
  | 'admin_search_users'
  | 'admin_send_broadcast'
  | 'admin_triage_report';

const ALLOWED_USER_ROLES = new Set([
  'ALL',
  'user',
  'translator',
  'editor',
  'moderator',
  'mod',
  'admin',
  'banned',
]);

const ALLOWED_USER_SORTS = new Set(['newest', 'oldest', 'username', 'warnings']);
const ALLOWED_REPORT_STATUSES = new Set(['open', 'in_progress', 'resolved', 'dismissed']);
const ALLOWED_AUDIENCE_TYPES = new Set(['global', 'media_followers', 'role', 'single_user']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSafeLinkOrAssetUrl(raw: string): boolean {
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw.length <= 500;
  }
  try {
    const parsed = new URL(raw);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && raw.length <= 500;
  } catch {
    return false;
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Authenticated server gateway for privileged SECURITY DEFINER admin RPCs.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdminAuth(req, { allowModerator: true });
  if (!auth.authorized) return auth.response!;

  const rate = checkAdminRateLimit(`admin-rpc:${auth.userId || 'anon'}`, 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Çok fazla yönetim isteği gönderildi. Lütfen ${rate.retryAfterSec} saniye bekleyin.`,
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  }

  if (!isPlainObject(body)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz istek gövdesi.' }, { status: 400 });
  }

  const rpcName = typeof body.rpc === 'string' ? body.rpc.trim() : '';
  if (!ALLOWED_RPCS.has(rpcName as AllowedRpc)) {
    return NextResponse.json(
      { ok: false, error: 'İzin verilmeyen veya geçersiz RPC adı.' },
      { status: 403 }
    );
  }

  const rawParams = body.params === undefined ? {} : body.params;
  if (!isPlainObject(rawParams)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz RPC parametreleri.' }, { status: 400 });
  }

  const db = getServiceSupabase();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: 'Supabase servis bağlantısı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  let validatedParams: Record<string, unknown> = {};

  switch (rpcName as AllowedRpc) {
    case 'admin_dashboard_stats': {
      validatedParams = {};
      break;
    }

    case 'admin_search_users': {
      const pQuery =
        typeof rawParams.p_query === 'string' ? rawParams.p_query.trim().slice(0, 100) : '';
      const pRole =
        typeof rawParams.p_role === 'string' ? rawParams.p_role.trim() : 'ALL';
      const pSort =
        typeof rawParams.p_sort === 'string' ? rawParams.p_sort.trim() : 'newest';
      const pLimitRaw = rawParams.p_limit === undefined ? 50 : Number(rawParams.p_limit);
      const pOffsetRaw = rawParams.p_offset === undefined ? 0 : Number(rawParams.p_offset);

      if (!ALLOWED_USER_ROLES.has(pRole)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz rol filtresi.' }, { status: 400 });
      }
      if (!ALLOWED_USER_SORTS.has(pSort)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz sıralama ölçütü.' }, { status: 400 });
      }
      if (!Number.isInteger(pLimitRaw) || pLimitRaw < 1 || pLimitRaw > 100) {
        return NextResponse.json({ ok: false, error: 'Geçersiz sayfa limiti (1-100).' }, { status: 400 });
      }
      if (!Number.isInteger(pOffsetRaw) || pOffsetRaw < 0 || pOffsetRaw > 100_000) {
        return NextResponse.json({ ok: false, error: 'Geçersiz sayfa başlangıcı.' }, { status: 400 });
      }

      validatedParams = {
        p_query: pQuery,
        p_role: pRole,
        p_sort: pSort,
        p_limit: pLimitRaw,
        p_offset: pOffsetRaw,
        p_actor_id: auth.userId || null,
      };
      break;
    }

    case 'admin_log_action': {
      const pAction = typeof rawParams.p_action === 'string' ? rawParams.p_action.trim() : '';
      const pTargetType =
        typeof rawParams.p_target_type === 'string' ? rawParams.p_target_type.trim() : '';

      if (!/^[a-z0-9_.:-]{2,80}$/i.test(pAction)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz p_action değeri.' }, { status: 400 });
      }
      if (!pTargetType || pTargetType.length > 64) {
        return NextResponse.json({ ok: false, error: 'Geçersiz p_target_type değeri.' }, { status: 400 });
      }

      const pTargetId =
        rawParams.p_target_id === null || rawParams.p_target_id === undefined
          ? null
          : String(rawParams.p_target_id).trim().slice(0, 128);
      const pSummary =
        rawParams.p_summary === null || rawParams.p_summary === undefined
          ? null
          : String(rawParams.p_summary).trim().slice(0, 500);

      let pMetadata: Record<string, unknown> = {};
      if (rawParams.p_metadata !== undefined && rawParams.p_metadata !== null) {
        if (!isPlainObject(rawParams.p_metadata)) {
          return NextResponse.json({ ok: false, error: 'p_metadata nesne olmalıdır.' }, { status: 400 });
        }
        if (JSON.stringify(rawParams.p_metadata).length > 16_384) {
          return NextResponse.json({ ok: false, error: 'p_metadata boyutu çok büyük.' }, { status: 400 });
        }
        pMetadata = rawParams.p_metadata;
      }

      validatedParams = {
        p_action: pAction,
        p_target_type: pTargetType,
        p_target_id: pTargetId,
        p_summary: pSummary,
        p_metadata: pMetadata,
        p_actor_id: auth.userId || null,
      };
      break;
    }

    case 'admin_send_broadcast': {
      if (auth.role !== 'admin') {
        return NextResponse.json(
          { ok: false, error: 'Yetkisiz erişim: Toplu bildirim için Admin yetkisi zorunludur.' },
          { status: 403 }
        );
      }

      const pTitle = typeof rawParams.p_title === 'string' ? rawParams.p_title.trim() : '';
      const pMessage = typeof rawParams.p_message === 'string' ? rawParams.p_message.trim() : '';
      const pLinkUrl =
        typeof rawParams.p_link_url === 'string' && rawParams.p_link_url.trim()
          ? rawParams.p_link_url.trim()
          : '/';
      const pAudienceType =
        typeof rawParams.p_audience_type === 'string' ? rawParams.p_audience_type.trim() : 'global';

      if (!pTitle || pTitle.length > 200) {
        return NextResponse.json({ ok: false, error: 'Bildirim başlığı 1-200 karakter olmalıdır.' }, { status: 400 });
      }
      if (!pMessage || pMessage.length > 2000) {
        return NextResponse.json({ ok: false, error: 'Bildirim içeriği 1-2000 karakter olmalıdır.' }, { status: 400 });
      }
      if (!isSafeLinkOrAssetUrl(pLinkUrl)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz bağlantı adresi.' }, { status: 400 });
      }

      let pThumbnailUrl: string | null = null;
      if (rawParams.p_thumbnail_url !== null && rawParams.p_thumbnail_url !== undefined) {
        const thumbStr = String(rawParams.p_thumbnail_url).trim();
        if (thumbStr) {
          if (!isSafeLinkOrAssetUrl(thumbStr)) {
            return NextResponse.json({ ok: false, error: 'Geçersiz küçük resim bağlantısı.' }, { status: 400 });
          }
          pThumbnailUrl = thumbStr;
        }
      }

      if (!ALLOWED_AUDIENCE_TYPES.has(pAudienceType)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz hedef kitle türü.' }, { status: 400 });
      }

      let pAudienceValue: string | null = null;
      if (pAudienceType === 'media_followers') {
        const mediaIdStr = String(rawParams.p_audience_value ?? '').trim();
        if (!/^\d{1,10}$/.test(mediaIdStr) || Number(mediaIdStr) <= 0) {
          return NextResponse.json({ ok: false, error: 'Geçerli bir hedef dizi ID gereklidir.' }, { status: 400 });
        }
        pAudienceValue = mediaIdStr;
      } else if (pAudienceType === 'role') {
        const roleVal = String(rawParams.p_audience_value ?? '').trim();
        if (!ALLOWED_USER_ROLES.has(roleVal) || roleVal === 'ALL') {
          return NextResponse.json({ ok: false, error: 'Geçersiz hedef rol değeri.' }, { status: 400 });
        }
        pAudienceValue = roleVal;
      } else if (pAudienceType === 'single_user') {
        const uidVal = String(rawParams.p_audience_value ?? '').trim();
        if (!UUID_REGEX.test(uidVal)) {
          return NextResponse.json({ ok: false, error: 'Geçersiz hedef kullanıcı UUID değeri.' }, { status: 400 });
        }
        pAudienceValue = uidVal;
      }

      validatedParams = {
        p_title: pTitle,
        p_message: pMessage,
        p_link_url: pLinkUrl,
        p_thumbnail_url: pThumbnailUrl,
        p_audience_type: pAudienceType,
        p_audience_value: pAudienceValue,
        p_actor_id: auth.userId || null,
      };
      break;
    }

    case 'admin_triage_report': {
      const pReportId = Number(rawParams.p_report_id);
      const pStatus = typeof rawParams.p_status === 'string' ? rawParams.p_status.trim() : '';
      const pAdminNote =
        rawParams.p_admin_note === null || rawParams.p_admin_note === undefined
          ? null
          : String(rawParams.p_admin_note).trim().slice(0, 1000);
      const pNotifyReporter =
        rawParams.p_notify_reporter === undefined ? true : Boolean(rawParams.p_notify_reporter);

      if (!Number.isInteger(pReportId) || pReportId <= 0 || pReportId > 100_000_000) {
        return NextResponse.json({ ok: false, error: 'Geçersiz p_report_id değeri.' }, { status: 400 });
      }
      if (!ALLOWED_REPORT_STATUSES.has(pStatus)) {
        return NextResponse.json({ ok: false, error: 'Geçersiz rapor durumu.' }, { status: 400 });
      }

      validatedParams = {
        p_report_id: pReportId,
        p_status: pStatus,
        p_admin_note: pAdminNote || null,
        p_notify_reporter: pNotifyReporter,
        p_actor_id: auth.userId || null,
      };
      break;
    }
  }

  try {
    const { data, error } = await db.rpc(rpcName, validatedParams);
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || 'RPC işlemi yürütülemedi.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Beklenmeyen sunucu hatası.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
