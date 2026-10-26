import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
  logAdminAudit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAdminAuth(req, { allowModerator: true });
    if (!auth.authorized) {
      return auth.response || NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const db = getServiceSupabase();
    if (!db) {
      return NextResponse.json({ error: 'Supabase servis bağlantısı yapılandırılmamış.' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 100;

    // 1. Fetch match review queue items
    let queueQuery = db
      .from('match_review_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') {
      queueQuery = queueQuery.eq('status', status);
    }

    const { data: queueItems, error: queueErr } = await queueQuery;

    // 2. Fetch scraper domain configurations
    const { data: scraperConfigs, error: configsErr } = await db
      .from('scraper_configs')
      .select('id, name, site_url, base_url, domain_strategy, gateway_url, is_enabled, last_run_at, last_ok_at, last_error')
      .order('id', { ascending: true });

    if (queueErr && !queueErr.message?.includes('relation "match_review_queue" does not exist')) {
      console.error('[match-queue] Queue fetch error:', queueErr);
      return NextResponse.json({ error: queueErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      queue: queueItems || [],
      scraperConfigs: scraperConfigs || [],
      error: configsErr?.message || undefined,
    });
  } catch (err: any) {
    console.error('[match-queue] GET unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Kuyruk yüklenemedi.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handleMutation(req);
}

export async function PATCH(req: NextRequest) {
  return handleMutation(req);
}

async function handleMutation(req: NextRequest) {
  try {
    const auth = await verifyAdminAuth(req);
    if (!auth.authorized) {
      return auth.response || NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const rate = checkAdminRateLimit(`match-queue:${auth.userId}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `İşlem sınırı aşıldı. Lütfen ${rate.retryAfterSec} sn sonra tekrar deneyin.` },
        { status: 429 }
      );
    }

    const db = getServiceSupabase();
    if (!db) {
      return NextResponse.json({ error: 'Supabase servis bağlantısı yapılandırılmamış.' }, { status: 500 });
    }

    const body = await req.json();
    const action = String(body.action || '').trim().toLowerCase();

    // Action 1: Approve or Reject a Match Review Queue Item
    if (action === 'approve' || action === 'reject') {
      const id = body.id;
      if (!id) {
        return NextResponse.json({ error: 'Kayıt ID zorunludur.' }, { status: 400 });
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const nowIso = new Date().toISOString();

      const { data: updated, error: updErr } = await db
        .from('match_review_queue')
        .update({
          status: newStatus,
          reviewed_at: nowIso,
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action,
        id,
        status: newStatus,
        item: updated,
      });
    }

    // Action 2: Update Domain / Base URL for a Scraper Config
    if (action === 'update_domain') {
      const scraperId = String(body.scraperId || body.id || '').trim();
      const baseUrl = String(body.baseUrl || body.base_url || '').trim();

      if (!scraperId || !/^[a-z0-9_-]{2,32}$/.test(scraperId)) {
        return NextResponse.json(
          { error: 'Geçersiz scraperId formatı. Sadece a-z, 0-9, _ ve - kullanılabilir (2-32 karakter).' },
          { status: 400 }
        );
      }

      if (!baseUrl || !isSafeHttpsUrl(baseUrl)) {
        return NextResponse.json(
          { error: 'Geçersiz veya güvensiz alan adı. URL mutlaka "https://" ile başlamalı ve geçerli bir alan adı olmalıdır.' },
          { status: 400 }
        );
      }

      const { data: updatedConfig, error: configErr } = await db
        .from('scraper_configs')
        .update({
          base_url: baseUrl,
          site_url: baseUrl,
        })
        .eq('id', scraperId)
        .select()
        .maybeSingle();

      if (configErr) {
        return NextResponse.json({ error: configErr.message }, { status: 500 });
      }

      await logAdminAudit({
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'scraper_config.update_domain',
        targetType: 'scraper_configs',
        targetId: scraperId,
        summary: `${scraperId} sağlayıcısının alan adı güncellendi: ${baseUrl}`,
        metadata: { scraperId, base_url: baseUrl, site_url: baseUrl },
      });

      return NextResponse.json({
        ok: true,
        action: 'update_domain',
        scraperId,
        base_url: baseUrl,
        config: updatedConfig,
      });
    }

    return NextResponse.json(
      { error: `Desteklenmeyen eylem: '${action}'. Geçerli eylemler: approve, reject, update_domain` },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[match-queue] Mutation error:', err);
    return NextResponse.json({ error: err?.message || 'İşlem başarısız oldu.' }, { status: 500 });
  }
}
