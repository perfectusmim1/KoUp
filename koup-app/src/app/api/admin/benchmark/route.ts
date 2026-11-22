import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminAuth,
  getServiceSupabase,
  checkAdminRateLimit,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ServerProbeMetric {
  id: string;
  label: string;
  endpoint: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  payloadKb: number;
  detail?: string;
}

interface BenchmarkTargetRoute {
  id: string;
  label: string;
  path: string;
  category: 'core' | 'catalog' | 'detail' | 'player';
}

async function fetchTimed(
  url: string,
  timeoutMs = 8000,
  headers?: Record<string, string>
): Promise<{ status: number; ok: boolean; latencyMs: number; payloadKb: number; text: string }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - t0);
    const payloadKb = Math.round((Buffer.byteLength(text, 'utf8') / 1024) * 10) / 10;
    return { status: res.status, ok: res.ok, latencyMs, payloadKb, text };
  } catch (err: any) {
    return {
      status: 0,
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      payloadKb: 0,
      text: err?.message || 'Timeout',
    };
  }
}

export async function GET(req: NextRequest) {
  // Strictly Admin-Only — never allow moderators or regular users
  const auth = await verifyAdminAuth(req, { allowModerator: false });
  if (!auth.authorized) return auth.response!;

  const rl = checkAdminRateLimit(`benchmark:get:${auth.userId}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Çok fazla benchmark isteği. Lütfen biraz bekleyin.' },
      { status: 429 }
    );
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase servis bağlantısı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  try {
    const [seriesRes, shortRes, actorRes, listRes] = await Promise.all([
      supabase
        .from('media')
        .select('id, slug, title, episode_count')
        .neq('content_type', 'kisa_drama')
        .gt('sources_count', 0)
        .order('views_total', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('media')
        .select('id, slug, title, episode_count')
        .eq('content_type', 'kisa_drama')
        .gt('sources_count', 0)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('people')
        .select('slug, name')
        .order('favorites_count', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('custom_lists')
        .select('id, title')
        .eq('is_public', true)
        .order('likes_count', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const sampleSeries = seriesRes.data || null;
    const sampleShort = shortRes.data || null;
    const sampleActor = actorRes.data || null;
    const sampleList = listRes.data || null;

    const routes: BenchmarkTargetRoute[] = [
      { id: 'home', label: 'Ana Sayfa', path: '/', category: 'core' },
      { id: 'kesfet', label: 'Keşfet', path: '/kesfet', category: 'catalog' },
      { id: 'son-eklenenler', label: 'Son Eklenenler', path: '/son-eklenenler', category: 'catalog' },
      { id: 'oyuncular', label: 'Oyuncular', path: '/oyuncular', category: 'catalog' },
      { id: 'listeler', label: 'Listeler', path: '/listeler', category: 'catalog' },
      { id: 'magazin', label: 'Magazin', path: '/magazin', category: 'catalog' },
      { id: 'takvim', label: 'Takvim', path: '/takvim', category: 'catalog' },
      { id: 'ayarlar', label: 'Ayarlar', path: '/ayarlar', category: 'core' },
    ];

    if (sampleSeries?.slug) {
      routes.push({
        id: 'series-detail',
        label: `Seri Detay (${sampleSeries.title.slice(0, 22)})`,
        path: `/seri/${sampleSeries.slug}`,
        category: 'detail',
      });
      routes.push({
        id: 'episode-watch',
        label: `Bölüm İzle (${sampleSeries.title.slice(0, 20)})`,
        path: `/seri/${sampleSeries.slug}/1`,
        category: 'player',
      });
    }

    if (sampleShort?.slug) {
      routes.push({
        id: 'short-watch',
        label: `Kısa Drama İzle (${sampleShort.title.slice(0, 18)})`,
        path: `/seri/${sampleShort.slug}/1`,
        category: 'player',
      });
    }

    if (sampleActor?.slug) {
      routes.push({
        id: 'actor-detail',
        label: `Oyuncu Detay (${sampleActor.name.slice(0, 18)})`,
        path: `/oyuncu/${sampleActor.slug}`,
        category: 'detail',
      });
    }

    if (sampleList?.id) {
      routes.push({
        id: 'list-detail',
        label: `Liste Detay`,
        path: `/listeler/${sampleList.id}`,
        category: 'detail',
      });
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      routes,
      samples: {
        series: sampleSeries,
        short: sampleShort,
        actor: sampleActor,
        list: sampleList,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Benchmark hedefleri yüklenemedi.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Strictly Admin-Only
  const auth = await verifyAdminAuth(req, { allowModerator: false });
  if (!auth.authorized) return auth.response!;

  const rl = checkAdminRateLimit(`benchmark:post:${auth.userId}`, 15, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Benchmark sunucu testi hız limitine ulaşıldı. 1 dakika sonra tekrar deneyin.' },
      { status: 429 }
    );
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase servis bağlantısı yapılandırılmamış.' },
      { status: 500 }
    );
  }

  let body: { sampleSeriesId?: number; sampleShortId?: number } = {};
  try {
    body = await req.json();
  } catch {}

  const origin = new URL(req.url).origin;
  const r2Public = (
    process.env.R2_PUBLIC_URL || 'https://pub-e62742f127324512937cc3ff34c976bd.r2.dev'
  ).replace(/\/$/, '');
  const workerBase = (
    process.env.NEXT_PUBLIC_CF_WORKER_URL ||
    'https://koup-edge-worker.caganhuseyinerdil.workers.dev'
  ).replace(/\/$/, '');

  const seriesId = Number(body.sampleSeriesId) > 0 ? Number(body.sampleSeriesId) : 1;
  const shortId = Number(body.sampleShortId) > 0 ? Number(body.sampleShortId) : 55109;

  const probes: ServerProbeMetric[] = [];

  // 1. Supabase media catalog query
  const sbMediaStart = performance.now();
  const { data: sbMediaRows, error: sbMediaErr } = await supabase
    .from('media')
    .select('id, slug, title, cover_image, content_type, views_total')
    .order('views_total', { ascending: false })
    .limit(24);
  const sbMediaMs = Math.round(performance.now() - sbMediaStart);
  probes.push({
    id: 'sb_media_home',
    label: 'Supabase Ana Katalog Sorgusu (24 kayıt)',
    endpoint: 'public.media (top 24)',
    status: sbMediaErr ? 500 : 200,
    ok: !sbMediaErr,
    latencyMs: sbMediaMs,
    payloadKb: Math.round((Buffer.byteLength(JSON.stringify(sbMediaRows || []), 'utf8') / 1024) * 10) / 10,
    detail: sbMediaErr ? sbMediaErr.message : `${sbMediaRows?.length || 0} yapım`,
  });

  // 2. Supabase latest episodes feed query
  const sbEpStart = performance.now();
  const { data: sbEpRows, error: sbEpErr } = await supabase
    .from('episodes')
    .select('id, media_id, season_number, episode_number, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(30);
  const sbEpMs = Math.round(performance.now() - sbEpStart);
  probes.push({
    id: 'sb_episodes_feed',
    label: 'Supabase Son Bölümler Akışı (30 kayıt)',
    endpoint: 'public.episodes (latest 30)',
    status: sbEpErr ? 500 : 200,
    ok: !sbEpErr,
    latencyMs: sbEpMs,
    payloadKb: Math.round((Buffer.byteLength(JSON.stringify(sbEpRows || []), 'utf8') / 1024) * 10) / 10,
    detail: sbEpErr ? sbEpErr.message : `${sbEpRows?.length || 0} bölüm`,
  });

  // 3-7. Parallel HTTP Probes (R2 CDN, API Sources, Edge Worker, Takvim, Magazin)
  const [r2Series, r2Short, apiSources, apiTakvim, apiMagazin, workerHealth] = await Promise.all([
    fetchTimed(`${r2Public}/sources/${seriesId}.json`, 6000),
    fetchTimed(`${r2Public}/sources/${shortId}.json`, 6000),
    fetchTimed(`${origin}/api/sources/${seriesId}`, 7000),
    fetchTimed(`${origin}/api/takvim/live`, 7000),
    fetchTimed(`${origin}/api/magazin/live`, 7000),
    fetchTimed(`${workerBase}/`, 5000),
  ]);

  probes.push(
    {
      id: 'r2_series_bundle',
      label: `R2 CDN Kaynak Paketi (#${seriesId})`,
      endpoint: `/sources/${seriesId}.json`,
      status: r2Series.status,
      ok: r2Series.ok,
      latencyMs: r2Series.latencyMs,
      payloadKb: r2Series.payloadKb,
    },
    {
      id: 'r2_short_bundle',
      label: `R2 CDN Kısa Drama Paketi (#${shortId})`,
      endpoint: `/sources/${shortId}.json`,
      status: r2Short.status,
      ok: r2Short.ok,
      latencyMs: r2Short.latencyMs,
      payloadKb: r2Short.payloadKb,
    },
    {
      id: 'api_sources',
      label: `Kaynak Çözümleme API (/api/sources/${seriesId})`,
      endpoint: `/api/sources/${seriesId}`,
      status: apiSources.status,
      ok: apiSources.ok,
      latencyMs: apiSources.latencyMs,
      payloadKb: apiSources.payloadKb,
    },
    {
      id: 'api_takvim',
      label: 'Canlı Takvim API (/api/takvim/live)',
      endpoint: '/api/takvim/live',
      status: apiTakvim.status,
      ok: apiTakvim.ok,
      latencyMs: apiTakvim.latencyMs,
      payloadKb: apiTakvim.payloadKb,
    },
    {
      id: 'api_magazin',
      label: 'Canlı Magazin API (/api/magazin/live)',
      endpoint: '/api/magazin/live',
      status: apiMagazin.status,
      ok: apiMagazin.ok,
      latencyMs: apiMagazin.latencyMs,
      payloadKb: apiMagazin.payloadKb,
    },
    {
      id: 'cf_edge_worker',
      label: 'Cloudflare Edge Worker (Canlı Ping)',
      endpoint: workerBase,
      status: workerHealth.status,
      ok: workerHealth.ok,
      latencyMs: workerHealth.latencyMs,
      payloadKb: workerHealth.payloadKb,
    }
  );

  return NextResponse.json({
    ok: true,
    measuredAt: new Date().toISOString(),
    probes,
  });
}
