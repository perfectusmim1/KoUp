import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const revalidate = 60; // Cache for 60 seconds

const DAY_MAP: Record<number, string> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

const TMDB_API_KEY = process.env.TMDB_API_KEY || '4c092d2cfd6d9c0e3aa3dab12c7d4756';

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

async function resolveLiveScheduleForMedia(media: any): Promise<{
  airDays: number[];
  nextEpisodeAt: string | null;
  nextEpisodeNumber: number | null;
  episodeLabel: string | null;
} | null> {
  if (!media || media.content_type === 'film' || media.content_type === 'movie') return null;
  const status = (media.status_broadcast || '').trim();
  if (status === 'Final' || status === 'Canceled') return null;

  // 1. Try TMDB if tmdb_id is available
  if (media.tmdb_id && media.content_type !== 'anime') {
    try {
      const r = await fetch(
        `https://api.themoviedb.org/3/tv/${media.tmdb_id}?api_key=${TMDB_API_KEY}&language=tr-TR`,
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

          // Persist to media & calendar_schedules in background
          supabaseAdmin
            .from('media')
            .update({
              air_days: mergedDays,
              next_episode_at: isoAt,
              next_episode_number: epNum,
            })
            .eq('id', media.id)
            .then(() => {});

          const cc = (media.country_code || '').toUpperCase();
          const sourceSite = ['KR', 'CN', 'JP', 'TH', 'TW'].includes(cc) ? 'dizikorea' : 'dizibox';
          supabaseAdmin
            .rpc('upsert_calendar_schedule', {
              p_source_site: sourceSite,
              p_day_of_week: dow,
              p_date_label: DAY_MAP[dow] || 'Pazartesi',
              p_title: media.title,
              p_slug: media.slug,
              p_episode_label: epLabel,
              p_category: cc === 'KR' ? 'K-Drama' : 'Dizi',
              p_cover_image: media.cover_image || '',
              p_source_url: `https://www.themoviedb.org/tv/${media.tmdb_id}`,
              p_sync_secret: 'koup_sync_secure_token_2026',
              p_next_episode_at: isoAt,
              p_next_episode_number: epNum,
            })
            .then(() => {});

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
      const query = media.anilist_id
        ? `query ($id: Int) { Media(id: $id, type: ANIME) { id status nextAiringEpisode { airingAt episode } } }`
        : `query ($search: String) { Media(search: $search, type: ANIME) { id status nextAiringEpisode { airingAt episode } } }`;
      const variables = media.anilist_id
        ? { id: Number(media.anilist_id) }
        : { search: media.title_en || media.native_title || media.title };

      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

          supabaseAdmin
            .from('media')
            .update({
              air_days: mergedDays,
              next_episode_at: isoAt,
              next_episode_number: epNum,
            })
            .eq('id', media.id)
            .then(() => {});

          supabaseAdmin
            .rpc('upsert_calendar_schedule', {
              p_source_site: 'animecix',
              p_day_of_week: dow,
              p_date_label: DAY_MAP[dow] || 'Pazartesi',
              p_title: media.title,
              p_slug: media.slug,
              p_episode_label: epLabel,
              p_category: 'Anime',
              p_cover_image: media.cover_image || '',
              p_source_url: `https://anilist.co/anime/${json?.data?.Media?.id || media.anilist_id || ''}`,
              p_sync_secret: 'koup_sync_secure_token_2026',
              p_next_episode_at: isoAt,
              p_next_episode_number: epNum,
            })
            .then(() => {});

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');
    const source = searchParams.get('source');
    const mediaIdParam = searchParams.get('mediaId');
    const slugParam = searchParams.get('slug');

    // =========================================================================
    // MODE A: Single Series Schedule & Countdown Lookup (?mediaId=... or ?slug=...)
    // =========================================================================
    if (mediaIdParam || slugParam) {
      let mediaRow: any = null;
      if (mediaIdParam && !Number.isNaN(Number(mediaIdParam))) {
        const { data } = await supabase
          .from('media')
          .select(
            'id, slug, title, title_en, native_title, content_type, country_code, status_broadcast, cover_image, air_days, air_time, next_episode_at, next_episode_number, episodes_available, episode_count, tmdb_id, anilist_id'
          )
          .eq('id', Number(mediaIdParam))
          .maybeSingle();
        mediaRow = data;
      } else if (slugParam) {
        const { data } = await supabase
          .from('media')
          .select(
            'id, slug, title, title_en, native_title, content_type, country_code, status_broadcast, cover_image, air_days, air_time, next_episode_at, next_episode_number, episodes_available, episode_count, tmdb_id, anilist_id'
          )
          .eq('slug', slugParam)
          .maybeSingle();
        mediaRow = data;
      }

      if (!mediaRow || mediaRow.content_type === 'film' || mediaRow.content_type === 'movie') {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      const normStatus = (mediaRow.status_broadcast || '').trim();
      if (normStatus === 'Final' || normStatus === 'Canceled') {
        return NextResponse.json({ supported: false, schedules: [] });
      }

      // Query calendar_schedules for this media_id or slug
      const cleanSlug = (mediaRow.slug || '').replace(/-(box|you|hd|izle|dizi|\d+)$/i, '');
      const orFilters = [`media_id.eq.${mediaRow.id}`, `slug.eq.${mediaRow.slug}`];
      if (cleanSlug && cleanSlug !== mediaRow.slug) {
        orFilters.push(`slug.eq.${cleanSlug}`);
      }

      const { data: schedRows } = await supabase
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
        (daySet.size === 0 || isNextEpInPast) &&
        (normStatus === 'Devam Ediyor' || normStatus === 'Yayında' || activeSchedules.length > 0)
      ) {
        const liveResolved = await resolveLiveScheduleForMedia(mediaRow);
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

      const countdown = computeCountdownInfo(finalAirDays, nextEpAt);
      const effectiveAirDays =
        finalAirDays.length > 0 ? finalAirDays : [countdown.nextAirDayOfWeek];
      const airDayNames = effectiveAirDays.map((d) => DAY_MAP[d] || 'Pazartesi');

      if (!epLabel) {
        if (nextEpNum) {
          epLabel = `${nextEpNum}. Bölüm`;
        } else if (mediaRow.episodes_available > 0) {
          epLabel = `${Number(mediaRow.episodes_available) + 1}. Bölüm`;
        } else {
          epLabel = 'Yeni Bölüm';
        }
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
    const { data: configs } = await supabase
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
    let query = supabase
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

      return {
        ...s,
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
