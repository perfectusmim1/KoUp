import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

// In-memory sliding window rate limiter
interface RateRecord {
  lastReportTime: number;
  reportCount: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateRecord>();

// Clean up stale IP records every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime && now - record.lastReportTime > 300_000) {
      rateLimitMap.delete(key);
    }
  }
}, 600_000);

export async function POST(req: NextRequest) {
  try {
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown-ip';

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Geçersiz veri biçimi.' }, { status: 400 });
    }

    const {
      reporter_id,
      target_type = 'media',
      media_id,
      season_number,
      episode_number,
      provider_name,
      issue_category,
      details,
    } = body;

    if (!issue_category || typeof issue_category !== 'string') {
      return NextResponse.json({ error: 'Lütfen bir sorun kategorisi seçin.' }, { status: 400 });
    }

    const rateKey = reporter_id ? `user:${reporter_id}` : `ip:${clientIp}`;
    const now = Date.now();
    const record = rateLimitMap.get(rateKey) || {
      lastReportTime: 0,
      reportCount: 0,
      resetTime: now + 600_000, // 10 min window
    };

    // 1. Mandatory Cooldown: Minimum 60 seconds between any reports
    const elapsedSinceLast = now - record.lastReportTime;
    const COOLDOWN_MS = 60_000; // 60 seconds
    if (elapsedSinceLast < COOLDOWN_MS) {
      const waitSeconds = Math.ceil((COOLDOWN_MS - elapsedSinceLast) / 1000);
      return NextResponse.json(
        {
          error: `Peş peşe bildirim gönderemezsiniz. Lütfen yeni bildirim için ${waitSeconds} saniye bekleyin.`,
          cooldownRemaining: waitSeconds,
        },
        { status: 429 }
      );
    }

    // 2. Window Cap: Maximum 5 reports per 10 minutes
    if (now > record.resetTime) {
      record.reportCount = 0;
      record.resetTime = now + 600_000;
    }

    if (record.reportCount >= 5) {
      const waitMinutes = Math.ceil((record.resetTime - now) / 60_000);
      return NextResponse.json(
        {
          error: `Çok fazla bildirim gönderdiniz (10 dakikada en fazla 5). Lütfen ${waitMinutes} dakika sonra tekrar deneyin.`,
          cooldownRemaining: waitMinutes * 60,
        },
        { status: 429 }
      );
    }

    const db = supabaseAdmin || supabase;

    // 3. Database Check: Prevent duplicate reports for the exact same media/episode in the last 15 minutes
    if (media_id) {
      const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000).toISOString();
      let dupQuery = db
        .from('issue_reports')
        .select('id')
        .eq('media_id', media_id)
        .gte('created_at', fifteenMinutesAgo)
        .limit(1);

      if (reporter_id) {
        dupQuery = dupQuery.eq('reporter_id', reporter_id);
      }
      if (episode_number !== undefined && episode_number !== null) {
        dupQuery = dupQuery.eq('episode_number', episode_number);
      }

      const { data: dupData } = await dupQuery;
      if (dupData && dupData.length > 0) {
        return NextResponse.json(
          {
            error: 'Bu içerik için zaten kısa süre önce bir bildirim gönderdiniz. Teknik ekibimiz incelemektedir.',
            cooldownRemaining: 60,
          },
          { status: 429 }
        );
      }
    }

    // Clean & sanitize details
    const sanitizedDetails = (typeof details === 'string' ? details : '')
      .replace(/[<>]/g, '')
      .slice(0, 500)
      .trim();

    // Insert into Supabase issue_reports
    const { error: insertError } = await db.from('issue_reports').insert({
      reporter_id: reporter_id || null,
      target_type: target_type || 'media',
      media_id: media_id ? Number(media_id) : null,
      season_number: season_number !== undefined && season_number !== null ? Number(season_number) : 1,
      episode_number: episode_number !== undefined && episode_number !== null ? Number(episode_number) : 0,
      provider_name: provider_name || 'general',
      issue_category: issue_category.slice(0, 80),
      details: sanitizedDetails || 'Kullanıcı sorun bildirimi',
      status: 'open',
    });

    if (insertError) {
      console.error('[REPORTS API] Insert error:', insertError);
      return NextResponse.json({ error: 'Bildirim kaydedilirken bir hata oluştu.' }, { status: 500 });
    }

    // Update rate limit tracker
    record.lastReportTime = now;
    record.reportCount += 1;
    rateLimitMap.set(rateKey, record);

    return NextResponse.json({
      ok: true,
      message: 'Bildiriminiz teknik ekibe iletildi. Teşekkür ederiz.',
      cooldown: 60,
    });
  } catch (err: any) {
    console.error('[REPORTS API] Unexpected error:', err);
    return NextResponse.json({ error: 'Beklenmeyen bir hata oluştu.' }, { status: 500 });
  }
}
