import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export interface AdminAuthResult {
  authorized: boolean;
  error?: string;
  status: number;
  userId?: string;
  role?: 'admin' | 'moderator' | string;
  username?: string;
  response?: NextResponse;
}

export interface VerifyAdminOptions {
  allowModerator?: boolean;
}

interface RateBucket {
  timestamps: number[];
}

const adminRateBuckets = new Map<string, RateBucket>();

export function getServiceSupabase() {
  return supabaseAdmin || supabase;
}

export function checkAdminRateLimit(
  key: string,
  maxRequests = 30,
  windowMs = 60_000
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = adminRateBuckets.get(key) || { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSec };
  }

  bucket.timestamps.push(now);
  adminRateBuckets.set(key, bucket);
  return { allowed: true, retryAfterSec: 0 };
}

export function extractBearerOrCookieToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate && candidate !== 'undefined' && candidate !== 'null') {
      return candidate;
    }
  }

  const allCookies = req.cookies.getAll();
  const tokenCookies = allCookies
    .filter((c) => c.name.includes('-auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (tokenCookies.length > 0) {
    const combined = tokenCookies.map((c) => c.value).join('');
    try {
      const parsed = JSON.parse(decodeURIComponent(combined));
      return parsed?.access_token || parsed?.[0] || null;
    } catch {
      return combined || null;
    }
  }

  return null;
}

export async function verifyUserSession(
  req: NextRequest
): Promise<{ authenticated: boolean; userId?: string; role?: string; error?: string; status: number }> {
  const token = extractBearerOrCookieToken(req);

  if (!token) {
    return { authenticated: false, error: 'Oturum anahtarı bulunamadı.', status: 401 };
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return { authenticated: false, error: 'Oturum geçersiz veya süresi dolmuş.', status: 401 };
  }

  const db = getServiceSupabase();
  const { data: profile } = await db
    .from('profiles')
    .select('role, is_banned')
    .eq('id', userData.user.id)
    .single();

  if (profile?.is_banned) {
    return { authenticated: false, error: 'Hesabınız askıya alınmıştır.', status: 403 };
  }

  return {
    authenticated: true,
    userId: userData.user.id,
    role: profile?.role || 'user',
    status: 200,
  };
}

function buildUnauthorizedResult(error: string, status: number): AdminAuthResult {
  return {
    authorized: false,
    error,
    status,
    response: NextResponse.json({ ok: false, error }, { status }),
  };
}

export async function verifyAdminAuth(
  req: NextRequest,
  options: VerifyAdminOptions = {}
): Promise<AdminAuthResult> {
  const token = extractBearerOrCookieToken(req);

  // Strict environment check: NEVER trust spoofable Host or Referer headers.
  // Dev fallback requires explicit ADMIN_DEV_BYPASS=1 in local development only.
  const isStrictLocalDev =
    process.env.NODE_ENV === 'development' &&
    process.env.ADMIN_DEV_BYPASS === '1' &&
    !process.env.VERCEL &&
    !process.env.CF_PAGES;

  if (!token) {
    if (isStrictLocalDev) {
      return {
        authorized: true,
        status: 200,
        userId: '89cc34ec-3b3e-4d8f-b891-b84b2bdb3b25',
        role: 'admin',
        username: 'admin',
      };
    }
    return buildUnauthorizedResult('Yetkisiz erişim: Oturum anahtarı bulunamadı.', 401);
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return buildUnauthorizedResult('Yetkisiz erişim: Oturum geçersiz veya süresi dolmuş.', 401);
  }

  const db = getServiceSupabase();
  const { data: profile, error: profError } = await db
    .from('profiles')
    .select('role, username, is_banned')
    .eq('id', userData.user.id)
    .single();

  if (profError || !profile || profile.is_banned) {
    return buildUnauthorizedResult('Yetkisiz erişim: Profil doğrulanamadı.', 403);
  }

  const userRole = profile.role || 'user';
  const isAdmin = userRole === 'admin';
  const isMod = userRole === 'moderator' || userRole === 'mod';

  if (isAdmin || (options.allowModerator && isMod)) {
    return {
      authorized: true,
      status: 200,
      userId: userData.user.id,
      role: isAdmin ? 'admin' : 'moderator',
      username: profile.username || 'admin',
    };
  }

  return buildUnauthorizedResult(
    options.allowModerator
      ? 'Yetkisiz erişim: Bu işlem için Admin veya Moderatör yetkisi zorunludur.'
      : 'Yetkisiz erişim: Bu işlem için Admin yetkisi zorunludur.',
    403
  );
}

export async function logAdminAudit(params: {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getServiceSupabase();
    await db.from('admin_audit_log').insert({
      actor_id: params.actorId || null,
      actor_role: params.actorRole || 'admin',
      action: params.action,
      target_type: params.targetType || null,
      target_id: params.targetId || null,
      summary: params.summary,
      metadata: params.metadata || {},
    });
  } catch {
    // non-blocking audit log
  }
}

export function resolvePythonBinary(_preferVenvOrRootDir?: boolean | string): string {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      for (const ver of ['Python313', 'Python312', 'Python311', 'Python310']) {
        const candidate = `${localAppData}\\Programs\\Python\\${ver}\\python.exe`;
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return 'python';
  }
  return 'python3';
}
