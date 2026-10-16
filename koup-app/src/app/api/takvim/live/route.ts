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

    return NextResponse.json({
      success: true,
      count: filtered.length,
      enabledScrapers: Array.from(enabledSites),
      schedules: filtered,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
