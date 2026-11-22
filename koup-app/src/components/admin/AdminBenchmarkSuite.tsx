'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Gauge,
  Play,
  Square,
  Monitor,
  Smartphone,
  Cpu,
  RefreshCw,
  Download,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  Activity,
  MousePointerClick,
  Layers,
  Eye,
  EyeOff,
  Server,
  Clock,
  Trash2,
} from 'lucide-react';
import { adminFetch } from '@/lib/adminClient';

type ProfileId = 'pc' | 'mobile_high' | 'mobile_mid' | 'mobile_low';

interface DeviceProfile {
  id: ProfileId;
  label: string;
  shortLabel: string;
  cpuLabel: string;
  cpuFactor: number;
  width: number;
  height: number;
  cpuBurnMsPerFrame: number;
  clickCpuBurnMs: number;
  accent: string;
}

const DEVICE_PROFILES: DeviceProfile[] = [
  {
    id: 'pc',
    label: 'PC Masaüstü',
    shortLabel: 'PC',
    cpuLabel: '1x',
    cpuFactor: 1,
    width: 1440,
    height: 900,
    cpuBurnMsPerFrame: 0,
    clickCpuBurnMs: 0,
    accent: 'text-sky-400 border-sky-400/35 bg-sky-500/15',
  },
  {
    id: 'mobile_high',
    label: 'Yüksek Mobil',
    shortLabel: 'Yüksek',
    cpuLabel: '2x',
    cpuFactor: 2,
    width: 390,
    height: 844,
    cpuBurnMsPerFrame: 4.5,
    clickCpuBurnMs: 8,
    accent: 'text-emerald-400 border-emerald-400/35 bg-emerald-500/15',
  },
  {
    id: 'mobile_mid',
    label: 'Orta Mobil',
    shortLabel: 'Orta',
    cpuLabel: '4x',
    cpuFactor: 4,
    width: 390,
    height: 844,
    cpuBurnMsPerFrame: 9.5,
    clickCpuBurnMs: 18,
    accent: 'text-amber-400 border-amber-400/35 bg-amber-500/15',
  },
  {
    id: 'mobile_low',
    label: 'Düşük Mobil',
    shortLabel: 'Düşük',
    cpuLabel: '6x',
    cpuFactor: 6,
    width: 390,
    height: 844,
    cpuBurnMsPerFrame: 15.5,
    clickCpuBurnMs: 32,
    accent: 'text-rose-400 border-rose-400/35 bg-rose-500/15',
  },
];

interface BenchmarkRoute {
  id: string;
  label: string;
  path: string;
  category: 'core' | 'catalog' | 'detail' | 'player';
}

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

interface InteractionLog {
  label: string;
  inpMs: number;
}

interface PageBenchmarkResult {
  routeId: string;
  routeLabel: string;
  path: string;
  profileId: ProfileId;
  score: number;
  ttfbMs: number;
  fcpMs: number;
  lcpMs: number;
  domReadyMs: number;
  loadMs: number;
  cls: number;
  tbtMs: number;
  maxLongTaskMs: number;
  longTaskCount: number;
  avgFps: number;
  minFps: number;
  jankFrames: number;
  avgInpMs: number;
  maxInpMs: number;
  interactionsTested: number;
  interactionLogs: InteractionLog[];
  domNodes: number;
  heapMb: number | null;
  requestsCount: number;
  transferKb: number;
  overflowPx: number;
  consoleErrors: string[];
  status: 'ok' | 'warn' | 'error';
  errorMsg?: string;
}

interface BenchmarkRunRecord {
  id: string;
  startedAt: string;
  completedAt: string;
  durationSec: number;
  profiles: ProfileId[];
  results: PageBenchmarkResult[];
  serverProbes: ServerProbeMetric[];
}

const HISTORY_STORAGE_KEY = 'koup_admin_benchmark_runs_v1';

const UNSAFE_CLICK_PATTERN =
  /(sil|kaldır|çıkış|logout|ban|engelle|sıfırla|reset|iptal|gönder|kaydet|onayla|ödeme|raporla|bildir|admin|giriş|kayıt)/i;

function burnCpuMs(ms: number) {
  if (ms <= 0) return;
  const end = performance.now() + ms;
  let acc = 0;
  while (performance.now() < end) {
    acc += Math.sqrt(12345.6789);
  }
  return acc;
}

function computePageScore(m: Omit<PageBenchmarkResult, 'score' | 'status'>): {
  score: number;
  status: 'ok' | 'warn' | 'error';
} {
  let score = 100;
  if (m.lcpMs > 4000) score -= 24;
  else if (m.lcpMs > 2500) score -= 12;
  else if (m.lcpMs > 1800) score -= 5;

  if (m.fcpMs > 3000) score -= 14;
  else if (m.fcpMs > 1800) score -= 7;

  if (m.tbtMs > 600) score -= 20;
  else if (m.tbtMs > 200) score -= 10;
  else if (m.tbtMs > 100) score -= 4;

  if (m.cls > 0.25) score -= 16;
  else if (m.cls > 0.1) score -= 8;

  if (m.maxInpMs > 300) score -= 16;
  else if (m.maxInpMs > 150) score -= 8;
  else if (m.maxInpMs > 90) score -= 3;

  if (m.avgFps > 0 && m.avgFps < 30) score -= 18;
  else if (m.avgFps > 0 && m.avgFps < 48) score -= 9;

  if (m.domNodes > 2500) score -= 12;
  else if (m.domNodes > 1500) score -= 6;

  if (m.overflowPx > 2) score -= 10;
  if (m.consoleErrors.length > 0) score -= Math.min(20, m.consoleErrors.length * 7);

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const status: 'ok' | 'warn' | 'error' =
    m.errorMsg || clamped < 55 ? 'error' : clamped < 80 ? 'warn' : 'ok';
  return { score: clamped, status };
}

function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 65) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(score: number): string {
  if (score >= 85) return 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300';
  if (score >= 65) return 'bg-amber-500/15 border-amber-400/30 text-amber-300';
  return 'bg-rose-500/15 border-rose-400/30 text-rose-300';
}

export default function AdminBenchmarkSuite() {
  const [routes, setRoutes] = useState<BenchmarkRoute[]>([]);
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<ProfileId[]>([
    'pc',
    'mobile_high',
    'mobile_mid',
    'mobile_low',
  ]);
  const [samples, setSamples] = useState<{ series?: any; short?: any }>({});
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [activeViewport, setActiveViewport] = useState<{ width: number; height: number }>({
    width: 1440,
    height: 900,
  });
  const [showLiveStage, setShowLiveStage] = useState(true);

  const [results, setResults] = useState<PageBenchmarkResult[]>([]);
  const [serverProbes, setServerProbes] = useState<ServerProbeMetric[]>([]);
  const [history, setHistory] = useState<BenchmarkRunRecord[]>([]);
  const [activeFilterProfile, setActiveFilterProfile] = useState<ProfileId | 'all'>('all');
  const [copiedMd, setCopiedMd] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 8));
      }
    } catch {}
  }, []);

  const loadTargets = useCallback(async () => {
    setLoadingTargets(true);
    setTargetError(null);
    try {
      const res = await adminFetch('/api/admin/benchmark');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const loadedRoutes: BenchmarkRoute[] = Array.isArray(data?.routes) ? data.routes : [];
      setRoutes(loadedRoutes);
      setSelectedRouteIds(loadedRoutes.map((r) => r.id));
      setSamples(data?.samples || {});
    } catch (err: any) {
      setTargetError(err?.message || 'Benchmark hedefleri yüklenemedi.');
    } finally {
      setLoadingTargets(false);
    }
  }, []);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const toggleProfile = (id: ProfileId) => {
    setSelectedProfiles((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((p) => p !== id) : prev;
      }
      return [...prev, id];
    });
  };

  const toggleRoute = (id: string) => {
    setSelectedRouteIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const measureSinglePage = useCallback(
    async (route: BenchmarkRoute, profile: DeviceProfile): Promise<PageBenchmarkResult> => {
      setActiveViewport({ width: profile.width, height: profile.height });
      await new Promise((r) => setTimeout(r, 80));

      const iframe = iframeRef.current;
      if (!iframe) {
        return {
          routeId: route.id,
          routeLabel: route.label,
          path: route.path,
          profileId: profile.id,
          score: 0,
          ttfbMs: 0,
          fcpMs: 0,
          lcpMs: 0,
          domReadyMs: 0,
          loadMs: 0,
          cls: 0,
          tbtMs: 0,
          maxLongTaskMs: 0,
          longTaskCount: 0,
          avgFps: 0,
          minFps: 0,
          jankFrames: 0,
          avgInpMs: 0,
          maxInpMs: 0,
          interactionsTested: 0,
          interactionLogs: [],
          domNodes: 0,
          heapMb: null,
          requestsCount: 0,
          transferKb: 0,
          overflowPx: 0,
          consoleErrors: [],
          status: 'error',
          errorMsg: 'Test sahnesi başlatılamadı',
        };
      }

      const sep = route.path.includes('?') ? '&' : '?';
      const targetUrl = `${window.location.origin}${route.path}${sep}_bench=${profile.id}_${Date.now()}`;

      const consoleErrors: string[] = [];
      let lcpValue = 0;
      let clsValue = 0;
      let tbtValue = 0;
      let maxLongTask = 0;
      let longTaskCount = 0;
      const observers: PerformanceObserver[] = [];

      const loadResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let done = false;
        const finish = (ok: boolean, error?: string) => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          iframe.onload = null;
          iframe.onerror = null;
          resolve({ ok, error });
        };

        const timeoutId = setTimeout(() => finish(false, 'Sayfa yükleme zaman aşımı (14s)'), 14000);

        iframe.onload = () => {
          try {
            const win = iframe.contentWindow as any;
            if (!win || !win.document) {
              finish(false, 'İframe erişimi engellendi');
              return;
            }
            const origErr = win.console?.error;
            if (typeof origErr === 'function') {
              win.console.error = (...args: any[]) => {
                const msg = args
                  .map((a) => (typeof a === 'string' ? a : a?.message || String(a)))
                  .join(' ')
                  .slice(0, 180);
                if (msg && consoleErrors.length < 15) consoleErrors.push(msg);
                origErr.apply(win.console, args);
              };
            }
            win.addEventListener('error', (ev: ErrorEvent) => {
              if (ev?.message && consoleErrors.length < 15) {
                consoleErrors.push(ev.message.slice(0, 180));
              }
            });
            win.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
              const reason = String(ev?.reason || 'Unhandled rejection').slice(0, 180);
              if (consoleErrors.length < 15) consoleErrors.push(reason);
            });

            if (typeof win.PerformanceObserver === 'function') {
              try {
                const lcpObs = new win.PerformanceObserver((list: PerformanceObserverEntryList) => {
                  for (const entry of list.getEntries()) {
                    lcpValue = Math.max(lcpValue, entry.startTime);
                  }
                });
                lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
                observers.push(lcpObs);
              } catch {}

              try {
                const clsObs = new win.PerformanceObserver((list: PerformanceObserverEntryList) => {
                  for (const entry of list.getEntries() as any[]) {
                    if (!entry.hadRecentInput && typeof entry.value === 'number') {
                      clsValue += entry.value;
                    }
                  }
                });
                clsObs.observe({ type: 'layout-shift', buffered: true });
                observers.push(clsObs);
              } catch {}

              try {
                const ltObs = new win.PerformanceObserver((list: PerformanceObserverEntryList) => {
                  for (const entry of list.getEntries()) {
                    const dur = entry.duration || 0;
                    if (dur > 50) {
                      tbtValue += dur - 50;
                      longTaskCount += 1;
                      if (dur > maxLongTask) maxLongTask = dur;
                    }
                  }
                });
                ltObs.observe({ type: 'longtask', buffered: true });
                observers.push(ltObs);
              } catch {}
            }
          } catch {}
          finish(true);
        };

        iframe.onerror = () => finish(false, 'Sayfa yüklenemedi');
        iframe.src = targetUrl;
      });

      if (!loadResult.ok || abortRef.current) {
        observers.forEach((o) => {
          try {
            o.disconnect();
          } catch {}
        });
        return {
          routeId: route.id,
          routeLabel: route.label,
          path: route.path,
          profileId: profile.id,
          score: 0,
          ttfbMs: 0,
          fcpMs: 0,
          lcpMs: 0,
          domReadyMs: 0,
          loadMs: 0,
          cls: 0,
          tbtMs: 0,
          maxLongTaskMs: 0,
          longTaskCount: 0,
          avgFps: 0,
          minFps: 0,
          jankFrames: 0,
          avgInpMs: 0,
          maxInpMs: 0,
          interactionsTested: 0,
          interactionLogs: [],
          domNodes: 0,
          heapMb: null,
          requestsCount: 0,
          transferKb: 0,
          overflowPx: 0,
          consoleErrors,
          status: 'error',
          errorMsg: loadResult.error || 'Durduruldu',
        };
      }

      // Allow hydration + data fetches + initial paint to settle
      await new Promise((r) => setTimeout(r, 1100));

      const win = iframe.contentWindow as any;
      const doc = win?.document as Document | undefined;

      // 1. Scroll & FPS Stress Loop (with profile CPU slowdown contention)
      let avgFps = 60;
      let minFps = 60;
      let jankFrames = 0;

      if (win && doc && !abortRef.current) {
        const fpsMetrics = await new Promise<{ avgFps: number; minFps: number; jankFrames: number }>(
          (resolve) => {
            const deltas: number[] = [];
            let lastTs = performance.now();
            const startTs = lastTs;
            const maxScroll = Math.max(
              0,
              Math.min(1800, (doc.documentElement?.scrollHeight || 0) - profile.height)
            );
            const durationMs = 1050;

            const tick = (now: number) => {
              const dt = now - lastTs;
              lastTs = now;
              if (deltas.length > 0 || dt > 0) {
                deltas.push(dt);
              }
              if (profile.cpuBurnMsPerFrame > 0) {
                burnCpuMs(profile.cpuBurnMsPerFrame);
              }
              const elapsed = now - startTs;
              const p = Math.min(1, elapsed / durationMs);
              const wave = p < 0.5 ? p * 2 : (1 - p) * 2;
              try {
                win.scrollTo(0, Math.round(maxScroll * wave));
              } catch {}

              if (elapsed < durationMs && !abortRef.current) {
                win.requestAnimationFrame(tick);
              } else {
                try {
                  win.scrollTo(0, 0);
                } catch {}
                const valid = deltas.slice(1).filter((d) => d > 0 && d < 2000);
                if (valid.length === 0) {
                  resolve({ avgFps: 60, minFps: 60, jankFrames: 0 });
                  return;
                }
                const meanDt = valid.reduce((a, b) => a + b, 0) / valid.length;
                const worstDt = Math.max(...valid);
                const jank = valid.filter((d) => d > 33.4).length;
                resolve({
                  avgFps: Math.min(120, Math.round(1000 / meanDt)),
                  minFps: Math.max(1, Math.round(1000 / worstDt)),
                  jankFrames: jank,
                });
              }
            };
            win.requestAnimationFrame(tick);
          }
        );
        avgFps = fpsMetrics.avgFps;
        minFps = fpsMetrics.minFps;
        jankFrames = fpsMetrics.jankFrames;
      }

      // 2. Real Interactive Button / Filter / Dropdown Click Tests (INP Measurement)
      const interactionLogs: InteractionLog[] = [];
      if (win && doc && !abortRef.current) {
        try {
          const rawCandidates = Array.from(
            doc.querySelectorAll<HTMLElement>(
              'main button:not([disabled]), [role="tab"], [aria-haspopup="listbox"], button[data-tab-id]'
            )
          );
          const safeButtons = rawCandidates
            .filter((el) => {
              if (el.closest('nav') || el.closest('header') || el.closest('footer')) return false;
              const rect = el.getBoundingClientRect();
              if (rect.width < 20 || rect.height < 20) return false;
              const style = win.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                return false;
              }
              const txt = (el.innerText || el.getAttribute('aria-label') || '').trim();
              if (!txt || txt.length > 48) return false;
              if (UNSAFE_CLICK_PATTERN.test(txt)) return false;
              return true;
            })
            .slice(0, 4);

          for (const btn of safeButtons) {
            if (abortRef.current) break;
            const label = (btn.innerText || btn.getAttribute('aria-label') || 'Buton')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 28);

            const inpMs = await new Promise<number>((resolve) => {
              const t0 = performance.now();
              try {
                btn.click();
              } catch {}
              if (profile.clickCpuBurnMs > 0) {
                burnCpuMs(profile.clickCpuBurnMs);
              }
              win.requestAnimationFrame(() => {
                win.requestAnimationFrame(() => {
                  resolve(Math.round(performance.now() - t0));
                });
              });
            });
            interactionLogs.push({ label, inpMs });
            await new Promise((r) => setTimeout(r, 120));
          }
        } catch {}
      }

      // 3. Collect Navigation, Paint, Resource, DOM, Heap, Overflow Metrics
      let ttfbMs = 0;
      let domReadyMs = 0;
      let loadMs = 0;
      let fcpMs = 0;
      let requestsCount = 0;
      let transferKb = 0;
      let domNodes = 0;
      let heapMb: number | null = null;
      let overflowPx = 0;

      if (win && doc) {
        try {
          const nav = win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          if (nav) {
            ttfbMs = Math.max(0, Math.round(nav.responseStart - nav.requestStart));
            domReadyMs = Math.max(0, Math.round(nav.domContentLoadedEventEnd));
            loadMs = Math.max(0, Math.round(nav.loadEventEnd || nav.domComplete));
          }
          const paints = win.performance.getEntriesByType('paint') as PerformanceEntry[];
          const fcpEntry = paints.find((p) => p.name === 'first-contentful-paint');
          if (fcpEntry) fcpMs = Math.round(fcpEntry.startTime);

          const resources = win.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
          requestsCount = resources.length;
          const totalBytes = resources.reduce(
            (sum, r) => sum + (r.transferSize || r.encodedBodySize || 0),
            0
          );
          transferKb = Math.round((totalBytes / 1024) * 10) / 10;

          domNodes = doc.querySelectorAll('*').length;
          overflowPx = Math.max(
            0,
            Math.round((doc.documentElement?.scrollWidth || 0) - (win.innerWidth || profile.width))
          );

          const mem = (win.performance as any).memory;
          if (mem && typeof mem.usedJSHeapSize === 'number') {
            heapMb = Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
          }
        } catch {}
      }

      observers.forEach((o) => {
        try {
          o.disconnect();
        } catch {}
      });

      const effectiveLcp = Math.round(lcpValue || fcpMs || domReadyMs);
      const effectiveTbt = Math.round(tbtValue);
      const avgInpMs =
        interactionLogs.length > 0
          ? Math.round(interactionLogs.reduce((a, b) => a + b.inpMs, 0) / interactionLogs.length)
          : 0;
      const maxInpMs =
        interactionLogs.length > 0 ? Math.max(...interactionLogs.map((i) => i.inpMs)) : 0;

      const baseMetrics: Omit<PageBenchmarkResult, 'score' | 'status'> = {
        routeId: route.id,
        routeLabel: route.label,
        path: route.path,
        profileId: profile.id,
        ttfbMs,
        fcpMs,
        lcpMs: effectiveLcp,
        domReadyMs,
        loadMs,
        cls: Math.round(clsValue * 1000) / 1000,
        tbtMs: effectiveTbt,
        maxLongTaskMs: Math.round(maxLongTask),
        longTaskCount,
        avgFps,
        minFps,
        jankFrames,
        avgInpMs,
        maxInpMs,
        interactionsTested: interactionLogs.length,
        interactionLogs,
        domNodes,
        heapMb,
        requestsCount,
        transferKb,
        overflowPx,
        consoleErrors,
      };

      const { score, status } = computePageScore(baseMetrics);
      return { ...baseMetrics, score, status };
    },
    []
  );

  const runServerProbes = useCallback(async (): Promise<ServerProbeMetric[]> => {
    try {
      const res = await adminFetch('/api/admin/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleSeriesId: samples.series?.id,
          sampleShortId: samples.short?.id,
        }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.probes) ? data.probes : [];
    } catch {
      return [];
    }
  }, [samples.series?.id, samples.short?.id]);

  const startBenchmark = async () => {
    const activeRoutes = routes.filter((r) => selectedRouteIds.includes(r.id));
    const activeProfiles = DEVICE_PROFILES.filter((p) => selectedProfiles.includes(p.id));
    if (activeRoutes.length === 0 || activeProfiles.length === 0) return;

    abortRef.current = false;
    setIsRunning(true);
    setResults([]);
    setServerProbes([]);
    setProgressPct(2);
    const runStart = Date.now();
    const startedAt = new Date().toISOString();

    setProgressText('Sunucu, Supabase, R2 ve Edge API yanıt süreleri ölçülüyor...');
    const probes = await runServerProbes();
    setServerProbes(probes);
    if (abortRef.current) {
      setIsRunning(false);
      setProgressText('Benchmark durduruldu.');
      return;
    }

    const totalSteps = activeProfiles.length * activeRoutes.length;
    let completed = 0;
    const collected: PageBenchmarkResult[] = [];

    for (const profile of activeProfiles) {
      for (const route of activeRoutes) {
        if (abortRef.current) break;
        setProgressText(
          `${profile.label} (${profile.cpuLabel}) · ${route.label} (${route.path}) test ediliyor... [${completed + 1}/${totalSteps}]`
        );
        const res = await measureSinglePage(route, profile);
        collected.push(res);
        setResults([...collected]);
        completed += 1;
        setProgressPct(Math.round((completed / totalSteps) * 100));
      }
      if (abortRef.current) break;
    }

    if (iframeRef.current) {
      iframeRef.current.src = 'about:blank';
    }

    const durationSec = Math.round(((Date.now() - runStart) / 1000) * 10) / 10;
    if (collected.length > 0) {
      const record: BenchmarkRunRecord = {
        id: `run_${Date.now()}`,
        startedAt,
        completedAt: new Date().toISOString(),
        durationSec,
        profiles: activeProfiles.map((p) => p.id),
        results: collected,
        serverProbes: probes,
      };
      setHistory((prev) => {
        const next = [record, ...prev].slice(0, 8);
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }

    setProgressText(
      abortRef.current
        ? `Durduruldu (${completed}/${totalSteps} ölçüm tamamlandı)`
        : `Tamamlandı · ${completed} ölçüm · ${durationSec} sn`
    );
    setIsRunning(false);
  };

  const stopBenchmark = () => {
    abortRef.current = true;
    setProgressText('Durduruluyor...');
  };

  const profileSummaries = useMemo(() => {
    return DEVICE_PROFILES.map((profile) => {
      const rows = results.filter((r) => r.profileId === profile.id);
      if (rows.length === 0) return { profile, count: 0, avgScore: 0, avgLcp: 0, avgTbt: 0, avgFps: 0, avgInp: 0, avgDom: 0, errors: 0 };
      const avg = (fn: (r: PageBenchmarkResult) => number) =>
        Math.round(rows.reduce((a, b) => a + fn(b), 0) / rows.length);
      return {
        profile,
        count: rows.length,
        avgScore: avg((r) => r.score),
        avgLcp: avg((r) => r.lcpMs),
        avgTbt: avg((r) => r.tbtMs),
        avgFps: avg((r) => r.avgFps),
        avgInp: avg((r) => r.maxInpMs),
        avgDom: avg((r) => r.domNodes),
        errors: rows.reduce((a, b) => a + b.consoleErrors.length + (b.errorMsg ? 1 : 0), 0),
      };
    });
  }, [results]);

  const bottlenecks = useMemo(() => {
    const items: Array<{ severity: 'critical' | 'warn'; title: string; detail: string }> = [];
    for (const p of serverProbes) {
      if (!p.ok) {
        items.push({
          severity: 'critical',
          title: `API Hatası: ${p.label}`,
          detail: `HTTP ${p.status} · ${p.latencyMs} ms`,
        });
      } else if (p.latencyMs > 900) {
        items.push({
          severity: 'critical',
          title: `Yavaş Sunucu Ucu: ${p.label}`,
          detail: `${p.latencyMs} ms · ${p.payloadKb} KB`,
        });
      } else if (p.latencyMs > 450) {
        items.push({
          severity: 'warn',
          title: `Orta Gecikme: ${p.label}`,
          detail: `${p.latencyMs} ms · ${p.payloadKb} KB`,
        });
      }
    }

    for (const r of results) {
      const pName = DEVICE_PROFILES.find((p) => p.id === r.profileId)?.shortLabel || r.profileId;
      if (r.overflowPx > 2) {
        items.push({
          severity: 'critical',
          title: `Yatay Taşma: ${r.routeLabel} (${pName})`,
          detail: `+${r.overflowPx}px ekran dışına taşıyor`,
        });
      }
      if (r.consoleErrors.length > 0) {
        items.push({
          severity: 'critical',
          title: `Konsol Hatası: ${r.routeLabel} (${pName})`,
          detail: `${r.consoleErrors.length} hata — ${r.consoleErrors[0]}`,
        });
      }
      if (r.lcpMs > 3000) {
        items.push({
          severity: 'critical',
          title: `Yüksek LCP: ${r.routeLabel} (${pName})`,
          detail: `LCP ${r.lcpMs} ms · FCP ${r.fcpMs} ms`,
        });
      }
      if (r.tbtMs > 300) {
        items.push({
          severity: 'critical',
          title: `Ana İş Parçacığı Blokajı (TBT): ${r.routeLabel} (${pName})`,
          detail: `TBT ${r.tbtMs} ms · En uzun görev ${r.maxLongTaskMs} ms`,
        });
      }
      if (r.avgFps > 0 && r.avgFps < 35) {
        items.push({
          severity: 'critical',
          title: `Düşük FPS: ${r.routeLabel} (${pName})`,
          detail: `Ort. ${r.avgFps} FPS (Min ${r.minFps}) · ${r.jankFrames} takılan kare`,
        });
      }
      if (r.maxInpMs > 200) {
        items.push({
          severity: 'warn',
          title: `Yavaş Tıklama Yanıtı (INP): ${r.routeLabel} (${pName})`,
          detail: `Maks. ${r.maxInpMs} ms (Ort. ${r.avgInpMs} ms)`,
        });
      }
      if (r.domNodes > 2000) {
        items.push({
          severity: 'warn',
          title: `Ağır DOM Ağacı: ${r.routeLabel} (${pName})`,
          detail: `${r.domNodes.toLocaleString('tr-TR')} DOM düğümü`,
        });
      }
    }
    return items.slice(0, 18);
  }, [results, serverProbes]);

  const filteredResults = useMemo(() => {
    if (activeFilterProfile === 'all') return results;
    return results.filter((r) => r.profileId === activeFilterProfile);
  }, [results, activeFilterProfile]);

  const buildMarkdownReport = () => {
    const lines: string[] = [
      `# KoUp 4 Kademeli Performans & İnteraktif Benchmark Raporu`,
      `Tarih: ${new Date().toLocaleString('tr-TR')}`,
      '',
      '## 1. Profil Özeti',
      '| Profil | CPU | Ort. Skor | LCP (ms) | TBT (ms) | Ort. FPS | Maks. INP (ms) | DOM | Hata |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ];
    for (const s of profileSummaries) {
      if (s.count === 0) continue;
      lines.push(
        `| ${s.profile.label} | ${s.profile.cpuLabel} | ${s.avgScore}/100 | ${s.avgLcp} | ${s.avgTbt} | ${s.avgFps} | ${s.avgInp} | ${s.avgDom} | ${s.errors} |`
      );
    }
    if (serverProbes.length > 0) {
      lines.push('', '## 2. Sunucu & Altyapı Ölçümleri', '| Uç | Durum | Gecikme (ms) | Boyut (KB) |', '|---|---:|---:|---:|');
      for (const p of serverProbes) {
        lines.push(`| ${p.label} | ${p.status} | ${p.latencyMs} | ${p.payloadKb} |`);
      }
    }
    lines.push(
      '',
      '## 3. Sayfa Bazlı Detaylar',
      '| Profil | Sayfa | Skor | TTFB | FCP | LCP | CLS | TBT | FPS | INP | DOM | Taşma | Hata |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
    );
    for (const r of results) {
      const pName = DEVICE_PROFILES.find((p) => p.id === r.profileId)?.shortLabel || r.profileId;
      lines.push(
        `| ${pName} | ${r.routeLabel} (\`${r.path}\`) | ${r.score} | ${r.ttfbMs} | ${r.fcpMs} | ${r.lcpMs} | ${r.cls} | ${r.tbtMs} | ${r.avgFps} | ${r.maxInpMs} | ${r.domNodes} | ${r.overflowPx}px | ${r.consoleErrors.length} |`
      );
    }
    return lines.join('\n');
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdownReport());
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {}
  };

  const handleDownloadJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      serverProbes,
      results,
      bottlenecks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `koup-benchmark-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stageScale = activeViewport.width > 500 ? 0.45 : 0.72;

  return (
    <div className="space-y-6">
      {/* Control Header */}
      <div className="rounded-3xl apple-glass p-5 sm:p-6 border border-white/15 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500/25 to-blue-600/25 border border-cyan-400/30 flex items-center justify-center shrink-0">
              <Gauge className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                Performans & İnteraktif Benchmark Laboratuvarı
              </h2>
              <p className="text-xs text-white/55">
                Tüm sayfalar, canlı buton tıklamaları (INP), FPS/akıcılık ve 4 kademeli cihaz profilleri
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowLiveStage((s) => !s)}
              className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/80 flex items-center gap-2 transition-colors cursor-pointer"
            >
              {showLiveStage ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              <span>{showLiveStage ? 'Sahneyi Gizle' : 'Canlı Sahne'}</span>
            </button>

            <button
              type="button"
              onClick={loadTargets}
              disabled={isRunning || loadingTargets}
              className="min-h-[44px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/80 flex items-center gap-2 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loadingTargets ? 'animate-spin' : ''}`} />
              <span>Hedefleri Yenile</span>
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={stopBenchmark}
                className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-2 shadow-lg shadow-rose-500/25 transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Testi Durdur</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startBenchmark}
                disabled={loadingTargets || selectedRouteIds.length === 0}
                className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-black flex items-center gap-2 shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-40 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Benchmark Başlat ({selectedProfiles.length * selectedRouteIds.length} Test)</span>
              </button>
            )}
          </div>
        </div>

        {targetError && (
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-400/30 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{targetError}</span>
          </div>
        )}

        {/* 4 Device Profiles Selector */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {DEVICE_PROFILES.map((p) => {
            const active = selectedProfiles.includes(p.id);
            const Icon = p.id === 'pc' ? Monitor : Smartphone;
            return (
              <button
                key={p.id}
                type="button"
                disabled={isRunning}
                onClick={() => toggleProfile(p.id)}
                className={`min-h-[58px] p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2 disabled:opacity-60 ${
                  active
                    ? `${p.accent} shadow-lg`
                    : 'bg-black/40 border-white/10 text-white/55 hover:border-white/25 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold truncate">{p.label}</div>
                    <div className="text-[10px] font-mono opacity-80">
                      {p.width}×{p.height} · CPU {p.cpuLabel}
                    </div>
                  </div>
                </div>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    active ? 'border-current bg-current/20' : 'border-white/25'
                  }`}
                >
                  {active && <Check className="w-2.5 h-2.5" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Target Routes Checkboxes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white/75 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Test Edilecek Sayfalar ({selectedRouteIds.length}/{routes.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setSelectedRouteIds(routes.map((r) => r.id))}
                className="text-[11px] font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
              >
                Tümünü Seç
              </button>
              <span className="text-white/25">·</span>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setSelectedRouteIds(routes.slice(0, 4).map((r) => r.id))}
                className="text-[11px] font-bold text-white/60 hover:text-white cursor-pointer"
              >
                Hızlı (İlk 4)
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {routes.map((r) => {
              const active = selectedRouteIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => toggleRoute(r.id)}
                  className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
                    active
                      ? 'bg-white/15 border-white/30 text-white'
                      : 'bg-black/35 border-white/10 text-white/50 hover:text-white/85'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Progress Bar */}
        {(isRunning || progressText) && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/80 font-medium truncate pr-2">{progressText}</span>
              <span className="font-mono font-bold text-cyan-300 shrink-0">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-400 to-blue-500"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Live Preview Stage (Iframe always mounted for same-origin testing) */}
      <div
        className={`rounded-3xl apple-glass border border-white/15 overflow-hidden transition-all ${
          showLiveStage && isRunning ? 'p-4' : 'h-0 p-0 border-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold text-white/80 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span>
              Canlı Test Sahnesi · {activeViewport.width}×{activeViewport.height}
            </span>
          </div>
        </div>
        <div className="w-full overflow-x-auto flex justify-center bg-black/70 rounded-2xl p-3 border border-white/10">
          <div
            style={{
              width: Math.round(activeViewport.width * stageScale),
              height: Math.round(activeViewport.height * stageScale),
            }}
            className="relative overflow-hidden rounded-xl border border-white/15 bg-[#070709] shrink-0"
          >
            <iframe
              ref={iframeRef}
              title="KoUp Benchmark Stage"
              style={{
                width: activeViewport.width,
                height: activeViewport.height,
                transform: `scale(${stageScale})`,
                transformOrigin: 'top left',
              }}
              className="border-0 bg-[#070709]"
            />
          </div>
        </div>
      </div>

      {/* 4-Tier Profile Comparison Cards */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {profileSummaries.map((s) => (
            <div
              key={s.profile.id}
              className="rounded-3xl apple-glass p-4 border border-white/12 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black text-white">{s.profile.label}</div>
                  <div className="text-[11px] font-mono text-white/50">
                    {s.profile.width}×{s.profile.height} · CPU {s.profile.cpuLabel}
                  </div>
                </div>
                {s.count > 0 ? (
                  <div
                    className={`px-2.5 py-1 rounded-xl border text-sm font-mono font-black ${scoreBg(
                      s.avgScore
                    )}`}
                  >
                    {s.avgScore}
                  </div>
                ) : (
                  <span className="text-[11px] text-white/35">—</span>
                )}
              </div>

              {s.count > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">LCP</div>
                    <div className="text-xs font-mono font-bold text-white">{s.avgLcp}ms</div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">FPS</div>
                    <div className="text-xs font-mono font-bold text-white">{s.avgFps}</div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">INP</div>
                    <div className="text-xs font-mono font-bold text-white">{s.avgInp}ms</div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">TBT</div>
                    <div className="text-xs font-mono font-bold text-white">{s.avgTbt}ms</div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">DOM</div>
                    <div className="text-xs font-mono font-bold text-white">{s.avgDom}</div>
                  </div>
                  <div className="p-2 rounded-xl bg-black/45 border border-white/[0.06]">
                    <div className="text-[10px] text-white/45">Hata</div>
                    <div
                      className={`text-xs font-mono font-bold ${
                        s.errors > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {s.errors}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Automatic Bottleneck Diagnostics */}
      {bottlenecks.length > 0 && (
        <div className="rounded-3xl apple-glass p-5 border border-white/15 space-y-3">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Tespit Edilen Performans Darboğazları ({bottlenecks.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {bottlenecks.map((b, i) => (
              <div
                key={`${b.title}-${i}`}
                className={`p-3 rounded-2xl border text-xs flex items-start gap-2.5 ${
                  b.severity === 'critical'
                    ? 'bg-rose-500/10 border-rose-400/25 text-rose-100'
                    : 'bg-amber-500/10 border-amber-400/25 text-amber-100'
                }`}
              >
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    b.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'
                  }`}
                />
                <div className="min-w-0">
                  <div className="font-bold truncate">{b.title}</div>
                  <div className="text-[11px] opacity-80 break-words">{b.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Server & Infrastructure Probes */}
      {serverProbes.length > 0 && (
        <div className="rounded-3xl apple-glass p-5 border border-white/15 space-y-3">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Server className="w-4 h-4 text-sky-400" />
            Sunucu, Veritabanı & Edge API Ölçümleri
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {serverProbes.map((p) => (
              <div
                key={p.id}
                className="p-3.5 rounded-2xl bg-black/50 border border-white/10 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white truncate">{p.label}</span>
                  {p.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span
                    className={
                      !p.ok || p.latencyMs > 800
                        ? 'text-rose-400 font-bold'
                        : p.latencyMs > 350
                        ? 'text-amber-300 font-bold'
                        : 'text-emerald-300 font-bold'
                    }
                  >
                    {p.latencyMs} ms
                  </span>
                  <span className="text-white/55">
                    HTTP {p.status} · {p.payloadKb} KB
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Results Table */}
      {results.length > 0 && (
        <div className="rounded-3xl apple-glass p-5 border border-white/15 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilterProfile('all')}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                  activeFilterProfile === 'all'
                    ? 'bg-white/15 border-white/30 text-white'
                    : 'bg-black/40 border-white/10 text-white/55 hover:text-white'
                }`}
              >
                Tümü ({results.length})
              </button>
              {DEVICE_PROFILES.map((p) => {
                const cnt = results.filter((r) => r.profileId === p.id).length;
                if (cnt === 0) return null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveFilterProfile(p.id)}
                    className={`min-h-[36px] px-3 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                      activeFilterProfile === p.id
                        ? p.accent
                        : 'bg-black/40 border-white/10 text-white/55 hover:text-white'
                    }`}
                  >
                    {p.shortLabel} ({p.cpuLabel})
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="min-h-[40px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
              >
                {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedMd ? 'Kopyalandı' : 'Markdown Kopyala'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="min-h-[40px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON İndir</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-left border-collapse min-w-[920px]">
              <thead>
                <tr className="border-b border-white/10 text-[11px] font-mono text-white/50">
                  <th className="py-2.5 pr-3">Profil</th>
                  <th className="py-2.5 pr-3">Sayfa</th>
                  <th className="py-2.5 px-2 text-right">Skor</th>
                  <th className="py-2.5 px-2 text-right">TTFB</th>
                  <th className="py-2.5 px-2 text-right">FCP</th>
                  <th className="py-2.5 px-2 text-right">LCP</th>
                  <th className="py-2.5 px-2 text-right">CLS</th>
                  <th className="py-2.5 px-2 text-right">TBT</th>
                  <th className="py-2.5 px-2 text-right">FPS</th>
                  <th className="py-2.5 px-2 text-right">INP / Tık</th>
                  <th className="py-2.5 px-2 text-right">DOM</th>
                  <th className="py-2.5 px-2 text-right">Ağ</th>
                  <th className="py-2.5 pl-2 text-right">Taşma / Hata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {filteredResults.map((r) => {
                  const prof = DEVICE_PROFILES.find((p) => p.id === r.profileId);
                  return (
                    <tr key={`${r.profileId}_${r.routeId}`} className="hover:bg-white/[0.03]">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] text-white/75">
                          {prof?.shortLabel} ({prof?.cpuLabel})
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-white">{r.routeLabel}</div>
                        <div className="text-[10px] font-mono text-white/45">{r.path}</div>
                      </td>
                      <td className={`py-2.5 px-2 text-right font-mono font-black ${scoreColor(r.score)}`}>
                        {r.score}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-white/80">{r.ttfbMs}ms</td>
                      <td className="py-2.5 px-2 text-right font-mono text-white/80">{r.fcpMs}ms</td>
                      <td
                        className={`py-2.5 px-2 text-right font-mono font-bold ${
                          r.lcpMs > 2500 ? 'text-rose-400' : r.lcpMs > 1800 ? 'text-amber-300' : 'text-emerald-300'
                        }`}
                      >
                        {r.lcpMs}ms
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-white/80">{r.cls}</td>
                      <td
                        className={`py-2.5 px-2 text-right font-mono ${
                          r.tbtMs > 200 ? 'text-rose-400 font-bold' : 'text-white/80'
                        }`}
                      >
                        {r.tbtMs}ms
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-mono font-bold ${
                          r.avgFps < 35 ? 'text-rose-400' : r.avgFps < 50 ? 'text-amber-300' : 'text-emerald-300'
                        }`}
                      >
                        {r.avgFps}
                        <span className="text-[10px] text-white/40 font-normal">/{r.minFps}</span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-white/85 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <MousePointerClick className="w-3 h-3 text-cyan-400" />
                          {r.maxInpMs}ms ({r.interactionsTested})
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-mono ${
                          r.domNodes > 2000 ? 'text-amber-300 font-bold' : 'text-white/75'
                        }`}
                      >
                        {r.domNodes.toLocaleString('tr-TR')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-white/70 whitespace-nowrap">
                        {r.requestsCount} · {r.transferKb}KB
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono whitespace-nowrap">
                        <span className={r.overflowPx > 2 ? 'text-rose-400 font-bold' : 'text-white/50'}>
                          {r.overflowPx}px
                        </span>
                        <span className="text-white/25 mx-1">/</span>
                        <span className={r.consoleErrors.length > 0 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          {r.consoleErrors.length}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Past Benchmark History */}
      <AnimatePresence>
        {history.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-3xl apple-glass p-5 border border-white/12 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-white/60" />
                Önceki Benchmark Kayıtları ({history.length})
              </h3>
              <button
                type="button"
                onClick={() => {
                  setHistory([]);
                  try {
                    localStorage.removeItem(HISTORY_STORAGE_KEY);
                  } catch {}
                }}
                className="text-xs text-white/50 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Geçmişi Temizle</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {history.map((run) => {
                const avgScore =
                  run.results.length > 0
                    ? Math.round(run.results.reduce((a, b) => a + b.score, 0) / run.results.length)
                    : 0;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => {
                      setResults(run.results);
                      setServerProbes(run.serverProbes);
                    }}
                    className="p-3.5 rounded-2xl bg-black/45 hover:bg-white/[0.06] border border-white/10 text-left transition-colors cursor-pointer space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-white/60">
                        {new Date(run.completedAt).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className={`text-xs font-mono font-black ${scoreColor(avgScore)}`}>
                        {avgScore}/100
                      </span>
                    </div>
                    <div className="text-[11px] text-white/75 flex items-center gap-1.5">
                      <Cpu className="w-3 h-3 text-cyan-400" />
                      <span>
                        {run.results.length} test · {run.durationSec}sn
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
