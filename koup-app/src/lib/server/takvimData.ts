import { getServiceSupabase } from '@/lib/adminAuth';

export const DAY_MAP: Record<number, string> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

const SLIM_TAKVIM_MEDIA_COLUMNS = [
  'id',
  'slug',
  'title',
  'cover_image',
  'poster_fallback_url',
  'content_type',
  'country_code',
  'release_year',
  'native_title',
  'status_broadcast',
  'air_days',
  'next_episode_at',
  'next_episode_number',
  'episodes_available',
  'tmdb_id',
].join(', ');

export function getTurkeyNow(): {
  dateStr: string;
  dayOfWeek: number;
  hour: number;
  timestampMs: number;
} {
  const now = new Date();
  const trTime = new Date(now.getTime() + 3 * 3600_000);
  const year = trTime.getUTCFullYear();
  const month = String(trTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(trTime.getUTCDate()).padStart(2, '0');
  const jsDay = trTime.getUTCDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;
  return {
    dateStr: `${year}-${month}-${day}`,
    dayOfWeek,
    hour: trTime.getUTCHours(),
    timestampMs: now.getTime(),
  };
}

export function getIsoDayOfWeekFromDateStr(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 1;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const d = dt.getUTCDay();
  return d === 0 ? 7 : d;
}

export function diffDaysInTurkey(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

export function cleanScheduleCategoryText(cat?: string | null): string {
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

export function computeCountdownInfo(
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

      let bestWeeklyDiff: number | null = null;
      if (validDays.length > 0) {
        for (const d of validDays) {
          const delta = (d - trNow.dayOfWeek + 7) % 7;
          if (bestWeeklyDiff === null || delta < bestWeeklyDiff) {
            bestWeeklyDiff = delta;
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

export async function getWeeklyCalendarServer(options?: {
  day?: number | null;
  source?: string | null;
}): Promise<{
  success: boolean;
  count: number;
  enabledScrapers: string[];
  schedules: any[];
  error?: string;
}> {
  try {
    const db = getServiceSupabase();
    const { data: configs } = await db
      .from('scraper_configs')
      .select('id, is_enabled');

    const disabledSites = new Set(
      (configs || []).filter((c) => c.is_enabled === false).map((c) => c.id)
    );
    const enabledSites = new Set(
      (configs || []).filter((c) => c.is_enabled !== false).map((c) => c.id)
    );

    const eightDaysAgoIso = new Date(Date.now() - 8 * 86400_000).toISOString();
    let query = db
      .from('calendar_schedules')
      .select(
        `id, source_site, day_of_week, date_label, title, slug, episode_label, category, cover_image, source_url, media_id, next_episode_at, next_episode_number, updated_at, media(${SLIM_TAKVIM_MEDIA_COLUMNS})`
      )
      .gte('updated_at', eightDaysAgoIso);

    if (options?.source && options.source !== 'all') {
      query = query.eq('source_site', options.source);
    }

    const { data: allSchedules, error } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(2000);

    if (error) {
      return { success: false, count: 0, enabledScrapers: [], schedules: [], error: error.message };
    }

    const seriesAirDaysMap = new Map<string, Set<number>>();
    for (const s of (allSchedules as any[]) || []) {
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

    const targetDayNum =
      options?.day && !Number.isNaN(Number(options.day)) ? Number(options.day) : null;

    const filtered = ((allSchedules as any[]) || []).filter((s) => {
      if (targetDayNum !== null && Number(s.day_of_week) !== targetDayNum) {
        return false;
      }
      if (s.source_site === 'tranimeizle' || s.source_site === 'animecix') {
        if (disabledSites.has('animecix')) return false;
      } else if (disabledSites.has(s.source_site)) {
        return false;
      }

      const st = (s.media?.status_broadcast || '').trim();
      const yr = Number(s.media?.release_year || 2026);
      if (st === 'Final' || st === 'Canceled') return false;
      if (st === 'Tamamlandı' && yr < 2026) return false;

      return true;
    });

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
        category: cleanScheduleCategoryText(s.category),
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

    return {
      success: true,
      count: sanitized.length,
      enabledScrapers: Array.from(enabledSites),
      schedules: sanitized,
    };
  } catch (err: any) {
    return {
      success: false,
      count: 0,
      enabledScrapers: [],
      schedules: [],
      error: err?.message || 'Internal error',
    };
  }
}
