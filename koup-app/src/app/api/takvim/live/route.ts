import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const DAY_MAP: Record<number, string> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const SCHEDULE_SYNC_COOLDOWN_MS = 30 * 60_000;
const scheduleSyncCooldownMap = new Map<number, number>();

function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown-ip'
  );
}

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function isAuthorizedSyncCaller(req: NextRequest): Promise<boolean> {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const authHeader = req.headers.get('authorization') || '';
  if (cronSecret && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && timingSafeMatch(token, cronSecret)) {
      return true;
    }
  }

  const adminAuth = await verifyAdminAuth(req, { allowModerator: false });
  return adminAuth.authorized;
}

function canSyncMediaSchedule(mediaId: number, force = false): boolean {
  if (!hasServiceRoleKey()) return false;
  if (force) return true;
  const now = Date.now();
  const last = scheduleSyncCooldownMap.get(mediaId);
  if (last && now - last < SCHEDULE_SYNC_COOLDOWN_MS) {
    return false;
  }
  if (scheduleSyncCooldownMap.size >= 500) {
    const oldest = scheduleSyncCooldownMap.keys().next().value;
    if (oldest !== undefined) scheduleSyncCooldownMap.delete(oldest);
  }
  scheduleSyncCooldownMap.set(mediaId, now);
  return true;
}

function getTurkeyNow(): { dateStr: string; dayOfWeek: number; hour: number; timestampMs: number } {
  const now = new Date();
  // Shift to UTC+3 (Europe/Istanbul is permanently UTC+3)
  const trTime = new Date(now.getTime() + 3 * 3600_000);
  const year = trTime.getUTCFullYear();
  const month = String(trTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(trTime.getUTCDate()).padStart(2, '0');
  const jsDay = trTime.getUTCDay(); // 0=Sun..6=Sat
  const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  return {
    dateStr: `${year}-${month}-${day}`,
    dayOfWeek,
    hour: trTime.getUTCHours(),
    timestampMs: now.getTime(),
  };
}

function getIsoDayOfWeekFromDateStr(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 1;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const d = dt.getUTCDay();
  return d === 0 ? 7 : d;
}

function diffDaysInTurkey(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

function cleanCategory(cat?: string | null): string {
  if (!cat) return 'Dizi';
  const trimmed = cat.trim();
  if (trimmed.startsWith('{') || trimmed.includes('_id')) {
    try {
      const parsed = JSON.parse(trimmed);
      const name = parsed.display_name || parsed.name;
      if (name) {
        if (/anim/i.test(name)) return 'Anime';
        if (/action|aksiyon/i.test(name)) return 'Aksiyon';
        if (/drama|dram/i.test(name)) return 'Dram';
        if (/comedy|komedi/i.test(name)) return 'Komedi';
        return name;
      }
    } catch {}
    if (/anim/i.test(trimmed)) return 'Anime';
    if (/action|aksiyon/i.test(trimmed)) return 'Aksiyon';
    if (/drama|dram/i.test(trimmed)) return 'Dram';
    return 'Dizi';
  }
  return trimmed;
}

function computeCountdownInfo(
  airDays: number[],
  nextEpisodeAt?: string | null
): {
  daysUntil: number;
  hoursUntil: number | null;
  nextAirDayOfWeek: number;
  nextAirDayName: string;
  countdownLabel: string;
  nextAirDateIso: string | null;
} {
  const trNow = getTurkeyNow();
  const validDays = Array.from(
    new Set((airDays || []).map(Number).filter((d) => d >= 1 && d <= 7))
  ).sort((a, b) => a - b);

  // 1. Check if we have a valid future nextEpisodeAt date
  if (nextEpisodeAt) {
    const dt = new Date(nextEpisodeAt);
    if (!Number.isNaN(dt.getTime())) {
      const trTarget = new Date(dt.getTime() + 3 * 3600_000);
      const tY = trTarget.getUTCFullYear();
      const tM = String(trTarget.getUTCMonth() + 1).padStart(2, '0');
      const tD = String(trTarget.getUTCDate()).padStart(2, '0');
      const targetDateStr = `${tY}-${tM}-${tD}`;
      const diffD = diffDaysInTurkey(trNow.dateStr, targetDateStr);
      const targetDow = getIsoDayOfWeekFromDateStr(targetDateStr);

      // If air_days has multiple days in a week (e.g. Mon & Tue) and the closest day in air_days is sooner than targetDateStr,
      // check whether a closer weekly broadcast day exists
      let bestWeeklyDiff: number | null = null;
      let bestWeeklyDow: number | null = null;
      if (validDays.length > 0) {
        for (const d of validDays) {
          const delta = (d - trNow.dayOfWeek + 7) % 7;
          if (bestWeeklyDiff === null || delta < bestWeeklyDiff) {
            bestWeeklyDiff = delta;
            bestWeeklyDow = d;
          }
        }
      }

      if (diffD >= 0 && (bestWeeklyDiff === null || diffD <= bestWeeklyDiff || validDays.length <= 1)) {
        const diffMs = dt.getTime() - trNow.timestampMs;
        const hoursUntil = diffMs > 0 ? Math.max(1, Math.round(diffMs / 3600_000)) : null;
        const dayName = DAY_MAP[targetDow] || 'Pazartesi';
        const countdownLabel =
          diffD === 0
            ? 'Bugün Yayınlanıyor'
            : diffD === 1
            ? 'Yarın (1 Gün Sonra)'
            : `${diffD} Gün Sonra`;
        return {
          daysUntil: diffD,
          hoursUntil,
          nextAirDayOfWeek: targetDow,
          nextAirDayName: dayName,
          countdownLabel,
          nextAirDateIso: dt.toISOString(),
        };
      }
    }
  }

  // 2. Compute from weekly air_days (1=Mon .. 7=Sun)
  const fallbackDays = validDays.length > 0 ? validDays : [trNow.dayOfWeek];
  let minDelta = 7;
  let nextDow = fallbackDays[0];

  for (const d of fallbackDays) {
    const delta = (d - trNow.dayOfWeek + 7) % 7;
    if (delta < minDelta) {
      minDelta = delta;
      nextDow = d;
    }
  }

  const nextAirDayName = DAY_MAP[nextDow] || 'Pazartesi';
  const countdownLabel =
    minDelta === 0
      ? 'Bugün Yayınlanıyor'
      : minDelta === 1
      ? 'Yarın (1 Gün Sonra)'
      : `${minDelta} Gün Sonra`;

  const nextDateMs = trNow.timestampMs + minDelta * 86_400_000;
  return {
    daysUntil: minDelta,
    hoursUntil: minDelta === 0 ? Math.max(1, 20 - trNow.hour) : minDelta * 24,
    nextAirDayOfWeek: nextDow,
    nextAirDayName,
    countdownLabel,
    nextAirDateIso: new Date(nextDateMs).toISOString(),
  };
}

async function resolveLiveScheduleForMedia(
  media: any,
  options: { persist?: boolean; force?: boolean } = {}
): Promise<{
  airDays: number[];
  nextEpisodeAt: string | null;
  nextEpisodeNumber: number | null;
  episodeLabel: string | null;
} | null> {
  if (!media || media.content_type === 'film' || media.content_type === 'movie') return null;
  const status = (media.status_broadcast || '').trim();
  if (status === 'Final' || status === 'Canceled') return null;

  const db = getServiceSupabase();
  const shouldPersist = Boolean(options.persist) && canSyncMediaSchedule(Number(media.id), Boolean(options.force));

  // 1. Try TMDB if tmdb_id is available
  const tmdbIdNum = Number(media.tmdb_id);
  if (TMDB_API_KEY && Number.isInteger(tmdbIdNum) && tmdbIdNum > 0 && media.content_type !== 'anime') {
    try {
      const r = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbIdNum}?api_key=${TMDB_API_KEY}&language=tr-TR`,
        { next: { revalidate: 1800 } }
      );
      if (r.ok) {
        const data = await r.json();
        const nextEp = data?.next_episode_to_air;
        if (nextEp?.air_date) {
          const dow = getIsoDayOfWeekFromDateStr(nextEp.air_date);
          const isoAt = `${nextEp.air_date}T20:00:00+03:00`;
          const epNum = Number(nextEp.episode_number) || 1;
          const sNum = Number(nextEp.season_number) || 1;
          const epLabel = `${sNum}. Sezon ${epNum}. Bölüm`;
          const existingDays = Array.isArray(media.air_days) ? media.air_days.map(Number) : [];
          const mergedDays = Array.from(new Set([...existingDays, dow]))
            .filter((d) => d >= 1 && d <= 7)
            .sort((a, b) => a - b);

          if (shouldPersist) {
            void Promise.resolve(
              db
                .from('media')
                .update({
                  air_days: mergedDays,
                  next_episode_at: isoAt,
                  next_episode_number: epNum,
                })
                .eq('id', media.id)
            ).catch(() => {});

            const cc = (media.country_code || '').toUpperCase();
            const sourceSite = ['KR', 'CN', 'JP', 'TH', 'TW'].includes(cc) ? 'dizikorea' : 'dizibox';
            void Promise.resolve(
              db.rpc('upsert_calendar_schedule', {
                p_source_site: sourceSite,
                p_day_of_week: dow,
                p_date_label: DAY_MAP[dow] || 'Pazartesi',
                p_title: media.title,
                p_slug: media.slug,
                p_episode_label: epLabel,
                p_category: cc === 'KR' ? 'K-Drama' : 'Dizi',
                p_cover_image: media.cover_image || '',
                p_source_url: `https://www.themoviedb.org/tv/${tmdbIdNum}`,
                p_next_episode_at: isoAt,
                p_next_episode_number: epNum,
              })
            ).catch(() => {});
          }

          return {
            airDays: mergedDays,
            nextEpisodeAt: isoAt,
            nextEpisodeNumber: epNum,
            episodeLabel: epLabel,
          };
        }
      }
    } catch {}
  }

  // 2. Try AniList GraphQL if anime or anilist_id is present
  if (media.content_type === 'anime' || media.anilist_id) {
    try {
      const anilistIdNum = Number(media.anilist_id);
      const hasValidAnilistId = Number.isInteger(anilistIdNum) && anilistIdNum > 0;
      const query = hasValidAnilistId
        ? `query ($id: Int) { Media(id: $id, type: ANIME) { id status nextAiringEpisode { airingAt episode } } }`
        : `query ($search: String) { Media(search: $search, type: ANIME) { id status nextAiringEpisode { airingAt episode } } }`;
      const variables = hasValidAnilistId
        ? { id: anilistIdNum }
        : { search: media.title_en || media.native_title || media.title };

      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        next: { revalidate: 1800 },
      });
      if (r.ok) {
        const json = await r.json();
        const nextAir = json?.data?.Media?.nextAiringEpisode;
        if (nextAir?.airingAt) {
          const dt = new Date(Number(nextAir.airingAt) * 1000);
          const trDt = new Date(dt.getTime() + 3 * 3600_000);
          const jsDay = trDt.getUTCDay();
          const dow = jsDay === 0 ? 7 : jsDay;
          const isoAt = dt.toISOString();
          const epNum = Number(nextAir.episode) || 1;
          const epLabel = `${epNum}. Bölüm`;
          const existingDays = Array.isArray(media.air_days) ? media.air_days.map(Number) : [];
          const mergedDays = Array.from(new Set([...existingDays, dow]))
            .filter((d) => d >= 1 && d <= 7)
            .sort((a, b) => a - b);

          if (shouldPersist) {
            void Promise.resolve(
              db
                .from('media')
                .update({
                  air_days: mergedDays,
                  next_episode_at: isoAt,
                  next_episode_number: epNum,
                })
                .eq('id', media.id)
            ).catch(() => {});

            void Promise.resolve(
              db.rpc('upsert_calendar_schedule', {
                p_source_site: 'animecix',
                p_day_of_week: dow,
                p_date_label: DAY_MAP[dow] || 'Pazartesi',
                p_title: media.title,
                p_slug: media.slug,
                p_episode_label: epLabel,
                p_category: 'Anime',
                p_cover_image: media.cover_image || '',
                p_source_url: `https://anilist.co/anime/${json?.data?.Media?.id || (hasValidAnilistId ? anilistIdNum : '')}`,
                p_next_episode_at: isoAt,
                p_next_episode_number: epNum,
              })
            ).catch(() => {});
          }

          return {
            airDays: mergedDays,
            nextEpisodeAt: isoAt,
            nextEpisodeNumber: epNum,
            episodeLabel: epLabel,
          };
        }
      }
    } catch {}
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rate = checkAdminRateLimit(`takvim-live:${ip}`, 60, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Çok fazla takvim isteği gönderildi. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');
    const source = searchParams.get('source');
    const mediaIdParam = searchParams.get('mediaId');
    const slugParam = searchParams.get('slug');
    const forceSync = searchParams.get('force') === 'true' || searchParams.get('force') === '1' || searchParams.get('sync') === '1';

    if (forceSync) {
      const authorized = await isAuthorizedSyncCaller(req);
      if (!authorized) {
        return NextResponse.json({ error: 'Yetkisiz erişim.' }, { status: 401 });
      }
    }

    if (day !== null) {
      const dayNum = Number(day);
      if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 7) {
        return NextResponse.json({ error: 'Geçersiz day parametresi (1-7).' }, { status: 400 });
      }
    }
    if (source !== null && source !== 'all' && !/^[a-z0-9_-]{1,32}$/i.test(source)) {
      return NextResponse.json({ error: 'Geçersiz source parametresi.' }, { status: 400 });
    }
    if (mediaIdParam !== null) {
      const mediaIdNum = Number(mediaIdParam);
      if (!Number.isInteger(mediaIdNum) || mediaIdNum <= 0 || mediaIdNum > 10_000_000) {
        return NextResponse.json({ error: 'Geçersiz mediaId parametresi.' }, { status: 400 });
      }
    }
    if (slugParam !== null) {
      const trimmedSlug = slugParam.trim();
      if (!trimmedSlug || trimmedSlug.length > 200 || /[\u0000-\u001F\u007F%*,()]/.test(trimmedSlug)) {
        return NextResponse.json({ error: 'Geçersiz slug parametresi.' }, { status: 400 });
      }
    }

    const db = getServiceSupabase();

    // =========================================================================
    // MODE A: Single Series Schedule & Countdown Lookup (?mediaId=... or ?slug=...)
    // =========================================================================
    if (mediaIdParam || slugParam) {
      let mediaRow: any = null;
      if (mediaIdParam) {
        const { data } = await db
          .from('media')
          .select(
            'id, slug, title, title_en, native_title, content_type, country_code, status_broadcast, cover_image, air_days, air_time, next_episode_at, next_episode_number, episodes_available, episode_count, tmdb_id, anilist_id'
          )
          .eq('id', Number(mediaIdParam))
          .maybeSingle();
        mediaRow = data;
      } else if (slugParam) {
        const { data } = await db
          .from('media')
          .select(
            'id, slug, title, title_en, native_title, content_type, country_code, status_broadcast, cover_image, air_days, air_time, next_episode_at, next_episode_number, episodes_available, episode_count, tmdb_id, anilist_id'
          )
          .eq('slug', slugParam.trim())
          .maybeSingle();
        mediaRow = data;
      }

      if (!mediaRow || mediaRow.content_type === 'film' || mediaRow.content_type === 'movie') {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      // Check episodes table: detect upcoming/pending episodes vs max published episode
      const { data: epStatusRows } = await db
        .from('episodes')
        .select('episode_number, season_number, status')
        .eq('media_id', mediaRow.id)
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true });

      let firstUpcomingEpNum: number | null = null;
      let maxPublishedEpFromDb = 0;

      if (epStatusRows && epStatusRows.length > 0) {
        for (const ep of epStatusRows) {
          const num = Number(ep.episode_number) || 0;
          const isPending =
            ep.status === 'pending_source' ||
            ep.status === 'scheduled' ||
            ep.status === 'placeholder' ||
            ep.status === 'upcoming' ||
            ep.status === 'yakinda';
          if (isPending) {
            if (firstUpcomingEpNum === null || num < firstUpcomingEpNum) {
              firstUpcomingEpNum = num;
            }
          } else {
            if (num > maxPublishedEpFromDb) {
              maxPublishedEpFromDb = num;
            }
          }
        }
      }

      const actualMaxEp = maxPublishedEpFromDb || Number(mediaRow.episodes_available || 0);

      const normStatus = (mediaRow.status_broadcast || '').trim();
      if (normStatus === 'Final' || normStatus === 'Canceled') {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      // Query calendar_schedules for this media_id or slug
      const safeRowSlug = String(mediaRow.slug || '').replace(/[,()"]/g, '');
      const cleanSlug = safeRowSlug.replace(/-(box|you|hd|izle|dizi|\d+)$/i, '');
      const orFilters = [`media_id.eq.${mediaRow.id}`];
      if (safeRowSlug) orFilters.push(`slug.eq.${safeRowSlug}`);
      if (cleanSlug && cleanSlug !== safeRowSlug) {
        orFilters.push(`slug.eq.${cleanSlug}`);
      }

      const { data: schedRows } = await db
        .from('calendar_schedules')
        .select('*')
        .or(orFilters.join(','))
        .order('day_of_week', { ascending: true });

      const activeSchedules = schedRows || [];

      // Collect air_days from both calendar_schedules and media.air_days
      const daySet = new Set<number>();
      for (const s of activeSchedules) {
        if (s.day_of_week >= 1 && s.day_of_week <= 7) {
          daySet.add(Number(s.day_of_week));
        }
      }
      if (Array.isArray(mediaRow.air_days)) {
        for (const d of mediaRow.air_days) {
          const nd = Number(d);
          if (nd >= 1 && nd <= 7) daySet.add(nd);
        }
      }

      let nextEpAt: string | null =
        mediaRow.next_episode_at ||
        activeSchedules.find((s) => s.next_episode_at)?.next_episode_at ||
        null;
      let nextEpNum: number | null =
        mediaRow.next_episode_number ||
        activeSchedules.find((s) => s.next_episode_number)?.next_episode_number ||
        null;
      let epLabel: string | null =
        activeSchedules.find((s) => s.episode_label)?.episode_label || null;

      // If no schedule found or nextEpAt is in the past, attempt live TMDB/AniList resolution for ongoing series
      const isNextEpInPast =
        !nextEpAt || new Date(nextEpAt).getTime() < Date.now() - 12 * 3600_000;
      if (
        (forceSync || daySet.size === 0 || isNextEpInPast) &&
        (normStatus === 'Devam Ediyor' || normStatus === 'Yayında' || activeSchedules.length > 0)
      ) {
        const liveResolved = await resolveLiveScheduleForMedia(mediaRow, {
          persist: true,
          force: forceSync,
        });
        if (liveResolved) {
          liveResolved.airDays.forEach((d) => daySet.add(d));
          if (liveResolved.nextEpisodeAt) nextEpAt = liveResolved.nextEpisodeAt;
          if (liveResolved.nextEpisodeNumber) nextEpNum = liveResolved.nextEpisodeNumber;
          if (liveResolved.episodeLabel && !epLabel) epLabel = liveResolved.episodeLabel;
        }
      }

      // If completed and not in active calendar_schedules, do not show countdown
      if (normStatus === 'Tamamlandı' && activeSchedules.length === 0) {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      const finalAirDays = Array.from(daySet).sort((a, b) => a - b);
      if (finalAirDays.length === 0 && !nextEpAt) {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      // Enforce: If upcoming episodes exist, next episode MUST be the earliest upcoming one!
      if (firstUpcomingEpNum !== null) {
        nextEpNum = firstUpcomingEpNum;
        epLabel = `${firstUpcomingEpNum}. Bölüm`;
      } else if (actualMaxEp > 0) {
        const epMatch = (epLabel || '').match(/(\d+)\s*\.?\s*Bölüm/i);
        const labelEpNum = epMatch ? parseInt(epMatch[1], 10) : 0;
        if (!nextEpNum || nextEpNum <= actualMaxEp || (labelEpNum > 0 && labelEpNum <= actualMaxEp)) {
          nextEpNum = actualMaxEp + 1;
          epLabel = `${nextEpNum}. Bölüm`;
        }
      }

      if (!epLabel) {
        if (nextEpNum) {
          epLabel = `${nextEpNum}. Bölüm`;
        } else if (actualMaxEp > 0) {
          epLabel = `${actualMaxEp + 1}. Bölüm`;
        } else {
          epLabel = 'Yeni Bölüm';
        }
      }

      let countdown = computeCountdownInfo(finalAirDays, nextEpAt);

      // If countdown says "Bugün Yayınlanıyor" (daysUntil === 0) but that episode is ALREADY available on the site,
      // advance countdown to the next weekly air date so it does not stay stuck on today's already-uploaded episode!
      if (countdown.daysUntil === 0 && actualMaxEp >= (nextEpNum || 1)) {
        const nextWeekDays = finalAirDays.length > 0 ? finalAirDays : [countdown.nextAirDayOfWeek];
        let minAdvance = 7;
        let nextDow = nextWeekDays[0];
        const trNow = getTurkeyNow();
        for (const d of nextWeekDays) {
          const delta = (d - trNow.dayOfWeek + 7) % 7;
          const effectiveDelta = delta === 0 ? 7 : delta;
          if (effectiveDelta < minAdvance) {
            minAdvance = effectiveDelta;
            nextDow = d;
          }
        }
        const nextAirDayName = DAY_MAP[nextDow] || 'Pazartesi';
        const nextDateMs = trNow.timestampMs + minAdvance * 86_400_000;
        countdown = {
          daysUntil: minAdvance,
          hoursUntil: minAdvance * 24,
          nextAirDayOfWeek: nextDow,
          nextAirDayName,
          countdownLabel: minAdvance === 1 ? 'Yarın (1 Gün Sonra)' : `${minAdvance} Gün Sonra`,
          nextAirDateIso: new Date(nextDateMs).toISOString(),
        };
      }

      const effectiveAirDays =
        finalAirDays.length > 0 ? finalAirDays : [countdown.nextAirDayOfWeek];
      const airDayNames = effectiveAirDays.map((d) => DAY_MAP[d] || 'Pazartesi');

      // Sync updated next_episode_number and schedule back to media & calendar_schedules in background
      if (
        nextEpNum &&
        (mediaRow.next_episode_number !== nextEpNum || mediaRow.episodes_available !== actualMaxEp) &&
        canSyncMediaSchedule(Number(mediaRow.id), forceSync)
      ) {
        void Promise.resolve(
          db
            .from('media')
            .update({
              episodes_available: actualMaxEp,
              next_episode_number: nextEpNum,
              ...(countdown.nextAirDateIso ? { next_episode_at: countdown.nextAirDateIso } : {}),
            })
            .eq('id', mediaRow.id)
        ).catch(() => {});

        void Promise.resolve(
          db
            .from('calendar_schedules')
            .update({
              next_episode_number: nextEpNum,
              episode_label: epLabel,
              ...(countdown.nextAirDateIso ? { next_episode_at: countdown.nextAirDateIso } : {}),
            })
            .or(safeRowSlug ? `media_id.eq.${mediaRow.id},slug.eq.${safeRowSlug}` : `media_id.eq.${mediaRow.id}`)
        ).catch(() => {});
      }

      return NextResponse.json(
        {
          supported: true,
          media_id: mediaRow.id,
          slug: mediaRow.slug,
          air_days: effectiveAirDays,
          air_day_names: airDayNames,
          air_time: mediaRow.air_time || '20:00',
          next_air_day_of_week: countdown.nextAirDayOfWeek,
          next_air_day_name: countdown.nextAirDayName,
          days_until: countdown.daysUntil,
          hours_until: countdown.hoursUntil,
          countdown_label: countdown.countdownLabel,
          next_episode_at: countdown.nextAirDateIso,
          next_episode_number: nextEpNum,
          next_episode_label: epLabel,
          schedules: activeSchedules,
        },
        {
          headers: {
            'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
          },
        }
      );
    }

    // =========================================================================
    // MODE B: Weekly Broadcast Calendar Page (/takvim)
    // =========================================================================
    const { data: configs } = await db
      .from('scraper_configs')
      .select('id, is_enabled');

    // Only exclude a source_site if it is explicitly configured as disabled in scraper_configs
    const disabledSites = new Set(
      (configs || [])
        .filter((c) => c.is_enabled === false)
        .map((c) => c.id)
    );
    const enabledSites = new Set(
      (configs || [])
        .filter((c) => c.is_enabled !== false)
        .map((c) => c.id)
    );

    // Fetch ALL calendar_schedules so we also know multi-day air_days for each series
    let query = db
      .from('calendar_schedules')
      .select('*, media(*)');

    if (source && source !== 'all') {
      query = query.eq('source_site', source);
    }

    const { data: allSchedules, error } = await query.order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Map multi-day broadcast schedules per series (by media_id or slug)
    const seriesAirDaysMap = new Map<string, Set<number>>();
    for (const s of allSchedules || []) {
      const key = s.media_id ? `m:${s.media_id}` : `s:${s.slug}`;
      if (!seriesAirDaysMap.has(key)) {
        seriesAirDaysMap.set(key, new Set<number>());
      }
      if (s.day_of_week >= 1 && s.day_of_week <= 7) {
        seriesAirDaysMap.get(key)!.add(Number(s.day_of_week));
      }
      if (Array.isArray(s.media?.air_days)) {
        for (const d of s.media.air_days) {
          const nd = Number(d);
          if (nd >= 1 && nd <= 7) seriesAirDaysMap.get(key)!.add(nd);
        }
      }
    }

    const targetDayNum = day && !Number.isNaN(Number(day)) ? Number(day) : null;

    const filtered = (allSchedules || []).filter((s) => {
      if (targetDayNum !== null && Number(s.day_of_week) !== targetDayNum) {
        return false;
      }
      if (s.source_site === 'tranimeizle' || s.source_site === 'animecix') {
        if (disabledSites.has('animecix')) return false;
      } else if (disabledSites.has(s.source_site)) {
        return false;
      }

      // Exclude finished/canceled series
      const st = (s.media?.status_broadcast || '').trim();
      const yr = Number(s.media?.release_year || 2026);
      if (st === 'Final' || st === 'Canceled') return false;
      if (st === 'Tamamlandı' && yr < 2026) return false;

      return true;
    });

    // Deduplicate on the same day by media_id or normalized title/slug
    const seenOnDay = new Set<string>();
    const deduplicated: any[] = [];
    for (const s of filtered) {
      const normTitle = (s.media?.title || s.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9ğüşıöç]+/g, '');
      const dedupKey = `${s.day_of_week}:${s.media_id ? `id_${s.media_id}` : normTitle || s.slug}`;
      if (seenOnDay.has(dedupKey)) continue;
      seenOnDay.add(dedupKey);
      deduplicated.push(s);
    }

    const sanitized = deduplicated.map((s) => {
      const bestCover =
        s.media?.cover_image ||
        s.cover_image ||
        s.media?.poster_fallback_url ||
        '/logo-dark.png';
      const key = s.media_id ? `m:${s.media_id}` : `s:${s.slug}`;
      const allDays = Array.from(seriesAirDaysMap.get(key) || [Number(s.day_of_week)]).sort(
        (a, b) => a - b
      );
      const allDayNames = allDays.map((d) => DAY_MAP[d] || 'Pazartesi');
      const countdown = computeCountdownInfo(
        allDays,
        s.next_episode_at || s.media?.next_episode_at
      );

      const avail = Number(s.media?.episodes_available || 0);
      let sNextEp = s.next_episode_number || s.media?.next_episode_number || null;
      let sEpLabel = s.episode_label;
      if (avail > 0 && sNextEp && sNextEp < avail) {
        sNextEp = avail + 1;
        sEpLabel = `${sNextEp}. Bölüm`;
      }

      return {
        ...s,
        next_episode_number: sNextEp,
        episode_label: sEpLabel,
        cover_image: bestCover,
        category: cleanCategory(s.category),
        date_label:
          s.date_label && !s.date_label.includes('{')
            ? s.date_label
            : DAY_MAP[s.day_of_week] || 'Pazartesi',
        air_days: allDays,
        air_day_names: allDayNames,
        days_until: countdown.daysUntil,
        countdown_label: countdown.countdownLabel,
        next_air_day_name: countdown.nextAirDayName,
      };
    });

    return NextResponse.json(
      {
        success: true,
        count: sanitized.length,
        enabledScrapers: Array.from(enabledSites),
        schedules: sanitized,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authorized = await isAuthorizedSyncCaller(req);
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: 'Yetkisiz erişim: Admin veya CRON yetkisi zorunludur.' },
      { status: 401 }
    );
  }

  const ip = getClientIp(req);
  const rate = checkAdminRateLimit(`takvim-sync-post:${ip}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: `Çok fazla senkronizasyon isteği. Lütfen ${rate.retryAfterSec} saniye bekleyin.` },
      { status: 429 }
    );
  }

  if (!hasServiceRoleKey()) {
    return NextResponse.json(
      { ok: false, error: 'Supabase servis anahtarı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Geçersiz JSON gövdesi.' }, { status: 400 });
  }

  const mediaId = body.mediaId !== undefined ? Number(body.mediaId) : body.id !== undefined ? Number(body.id) : null;
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';

  if (mediaId !== null && (!Number.isInteger(mediaId) || mediaId <= 0 || mediaId > 10_000_000)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz mediaId.' }, { status: 400 });
  }
  if (!mediaId && (!slug || slug.length > 200 || /[\u0000-\u001F\u007F%*,()]/.test(slug))) {
    return NextResponse.json({ ok: false, error: 'Geçerli bir mediaId veya slug gereklidir.' }, { status: 400 });
  }

  const db = getServiceSupabase();
  let mediaQuery = db
    .from('media')
    .select(
      'id, slug, title, title_en, native_title, content_type, country_code, status_broadcast, cover_image, air_days, air_time, next_episode_at, next_episode_number, episodes_available, episode_count, tmdb_id, anilist_id'
    );
  mediaQuery = mediaId ? mediaQuery.eq('id', mediaId) : mediaQuery.eq('slug', slug);
  const { data: mediaRow, error } = await mediaQuery.maybeSingle();

  if (error || !mediaRow) {
    return NextResponse.json({ ok: false, error: 'Yapım bulunamadı.' }, { status: 404 });
  }

  const resolved = await resolveLiveScheduleForMedia(mediaRow, { persist: true, force: true });
  return NextResponse.json({
    ok: true,
    media_id: mediaRow.id,
    slug: mediaRow.slug,
    resolved,
  });
}
