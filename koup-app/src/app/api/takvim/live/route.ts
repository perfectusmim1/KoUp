import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const revalidate = 60; // Cache for 60 seconds

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');
    const source = searchParams.get('source');

    // 1. Fetch enabled scrapers from scraper_configs
    const { data: configs } = await supabase
      .from('scraper_configs')
      .select('id, is_enabled');

    const enabledSites = new Set(
      (configs || [])
        .filter((c) => c.is_enabled)
        .map((c) => c.id)
    );

    // 2. Query calendar_schedules
    let query = supabase
      .from('calendar_schedules')
      .select('*, media(*)');

    if (day && !Number.isNaN(Number(day))) {
      query = query.eq('day_of_week', Number(day));
    }

    if (source && source !== 'all') {
      query = query.eq('source_site', source);
    }

    const { data: schedules, error } = await query.order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 3. Filter only entries whose scraper is enabled in admin
    const filtered = (schedules || []).filter((s) => {
      // Map aliases if needed (e.g. tranimeizle vs animecix)
      if (s.source_site === 'tranimeizle' || s.source_site === 'animecix') {
        return enabledSites.has('tranimeizle') || enabledSites.has('animecix');
      }
      return enabledSites.has(s.source_site);
    });

    const DAY_MAP: Record<number, string> = {
      1: 'Pazartesi',
      2: 'Salı',
      3: 'Çarşamba',
      4: 'Perşembe',
      5: 'Cuma',
      6: 'Cumartesi',
      7: 'Pazar',
    };

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

    const sanitized = filtered.map((s) => {
      const bestCover =
        s.media?.cover_image ||
        s.cover_image ||
        s.media?.poster_fallback_url ||
        '/logo-dark.png';
      return {
        ...s,
        cover_image: bestCover,
        category: cleanCategory(s.category),
        date_label: s.date_label && !s.date_label.includes('{') ? s.date_label : (DAY_MAP[s.day_of_week] || 'Pazartesi'),
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
