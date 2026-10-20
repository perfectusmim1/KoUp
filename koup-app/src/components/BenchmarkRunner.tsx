'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Gauge,
  Play,
  Square,
  RotateCcw,
  Check,
  Copy,
  X,
  Smartphone,
  Monitor,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  Sparkles,
  Compass,
  Film,
  Calendar,
  Layers,
  BarChart2,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

export type BenchmarkMode = 'desktop' | 'mobile';

interface BenchmarkResults {
  mode: BenchmarkMode;
  durationSec: number;
  totalFrames: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  stabilityPercent: number;
  onePercentLowFps: number;
  avgFrameTimeMs: number;
  maxFrameTimeMs: number;
  jankCount: number;
  jankPercent: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  gradeTitle: string;
  gradeColor: string;
  date: string;
  pagesTested: string[];
  fpsHistory: number[];
}

interface TourStageDef {
  id: string;
  name: string;
  routeHint: string;
  fractionStart: number;
  fractionEnd: number;
  icon: string;
}

const TOUR_STAGES: TourStageDef[] = [
  {
    id: 'home',
    name: '1. Anasayfa: Vitrin & Seri Kartları',
    routeHint: '/',
    fractionStart: 0.0,
    fractionEnd: 0.22,
    icon: '🏠',
  },
  {
    id: 'explore',
    name: '2. Keşfet: Medya Grid & Filtreler',
    routeHint: '/kesfet',
    fractionStart: 0.22,
    fractionEnd: 0.44,
    icon: '🧭',
  },
  {
    id: 'series',
    name: '3. Seri Detay: Bölüm Rayı & Oynatıcı',
    routeHint: '/seri',
    fractionStart: 0.44,
    fractionEnd: 0.68,
    icon: '🎬',
  },
  {
    id: 'calendar',
    name: '4. Yayın Takvimi: Canlı Akış & Günler',
    routeHint: '/takvim',
    fractionStart: 0.68,
    fractionEnd: 0.84,
    icon: '📅',
  },
  {
    id: 'stress',
    name: '5. Final: Yüksek Hızlı GPU Stres Testi',
    routeHint: '/',
    fractionStart: 0.84,
    fractionEnd: 1.0,
    icon: '🔥',
  },
];

export default function BenchmarkRunner() {
  const router = useRouter();
  const currentPathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<number>(60);
  const [selectedMode, setSelectedMode] = useState<BenchmarkMode>('desktop');

  // Real-time HUD states
  const [liveFps, setLiveFps] = useState<number>(60);
  const [liveLatencyMs, setLiveLatencyMs] = useState<number>(16.6);
  const [currentAvgFps, setCurrentAvgFps] = useState<number>(60);
  const [currentMinFps, setCurrentMinFps] = useState<number>(60);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [activeStageText, setActiveStageText] = useState<string>('Test Hazırlanıyor...');
  const [currentRouteBadge, setCurrentRouteBadge] = useState<string>('/');
  const [liveSparkline, setLiveSparkline] = useState<number[]>([]);
  const [virtualPointerPos, setVirtualPointerPos] = useState<{
    x: number;
    y: number;
    visible: boolean;
    label: string;
  }>({
    x: 0,
    y: 0,
    visible: false,
    label: '',
  });

  // Final Results state
  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [copied, setCopied] = useState(false);

  // Measurement references
  const rafIdRef = useRef<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const fpsHistoryRef = useRef<number[]>([]);
  const lastTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const targetDurationMsRef = useRef<number>(60000);
  const isRunningRef = useRef<boolean>(false);
  const modeRef = useRef<BenchmarkMode>('desktop');
  const testedPagesSetRef = useRef<Set<string>>(new Set());

  // Navigation & Tour stage tracking
  const currentStageIndexRef = useRef<number>(-1);
  const stageTransitionCooldownRef = useRef<number>(0);
  const dynamicSeriesPathRef = useRef<string>('/seri/squid-game');
  const lastInteractionTimeRef = useRef<number>(0);
  const lastSwipeTriggerTimeRef = useRef<number>(0);
  const activeHoveredElementRef = useRef<HTMLElement | null>(null);

  // Helper to discover actual series slugs from the current page
  const discoverSeriesPath = useCallback(() => {
    if (typeof document === 'undefined') return '/seri/squid-game';
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/seri/"]'));
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (
        href &&
        href !== '/seri' &&
        !href.includes('/episode') &&
        !href.endsWith('/') &&
        href.split('/').length === 3
      ) {
        return href;
      }
    }
    return '/seri/squid-game';
  }, []);

  // Stop benchmark cleanly & calculate final metrics
  const finishBenchmark = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Collapse any active card
    if (activeHoveredElementRef.current) {
      activeHoveredElementRef.current.dispatchEvent(
        new MouseEvent('mouseleave', { bubbles: true, cancelable: true })
      );
      activeHoveredElementRef.current.blur?.();
      activeHoveredElementRef.current = null;
    }

    setVirtualPointerPos((prev) => ({ ...prev, visible: false }));

    const frames = frameTimesRef.current;
    if (frames.length === 0) return;

    // Calculate metrics
    const totalTimeMs = frames.reduce((sum, d) => sum + d, 0);
    const totalFrames = frames.length;
    const avgFrameTimeMs = totalTimeMs / totalFrames;
    const avgFps = totalFrames / (totalTimeMs / 1000);
    const maxFrameTimeMs = Math.max(...frames);

    const history = fpsHistoryRef.current;
    // Skip initial 4 warmup samples
    const validSamples = history.length > 5 ? history.slice(4) : history;
    const minFps = validSamples.length > 0 ? Math.min(...validSamples) : Math.round(avgFps);
    const maxFps = validSamples.length > 0 ? Math.max(...validSamples) : Math.round(avgFps);

    // Stability: percentage of samples that did not experience heavy drops (>25% from avg)
    const stableSamples = validSamples.filter((v) => v >= avgFps * 0.75).length;
    const stabilityPercent =
      validSamples.length > 0 ? Math.round((stableSamples / validSamples.length) * 100) : 100;

    // 1% Low FPS (worst 1% of frames)
    const sorted = [...frames].sort((a, b) => b - a);
    const onePercentCount = Math.max(1, Math.floor(sorted.length * 0.01));
    const worstOnePercentFrames = sorted.slice(0, onePercentCount);
    const worstAvgDelta =
      worstOnePercentFrames.reduce((s, v) => s + v, 0) / worstOnePercentFrames.length;
    const onePercentLowFps = Math.max(1, 1000 / worstAvgDelta);

    // Jank frames (> 33.33ms, drop below 30 FPS)
    const jankCount = frames.filter((d) => d > 33.33).length;
    const jankPercent = (jankCount / totalFrames) * 100;

    // Grade evaluation with Target 90+ FPS in mind
    let grade: 'S' | 'A' | 'B' | 'C' | 'D' = 'A';
    let gradeTitle = 'Çok Akıcı (Stabil Performans)';
    let gradeColor = 'text-sky-400 border-sky-400/40 bg-sky-500/15 shadow-[0_0_20px_rgba(56,189,248,0.25)]';

    if (minFps >= 90 && avgFps >= 95) {
      grade = 'S';
      gradeTitle = 'Ultra Akıcılık (Hedef 90+ FPS Sabit)';
      gradeColor =
        'text-emerald-400 border-emerald-400/40 bg-emerald-500/15 shadow-[0_0_25px_rgba(16,185,129,0.35)]';
    } else if (avgFps >= 75 && minFps >= 60) {
      grade = 'A';
      gradeTitle = 'Yüksek Akıcılık (60+ FPS Stabil)';
      gradeColor =
        'text-sky-400 border-sky-400/40 bg-sky-500/15 shadow-[0_0_20px_rgba(56,189,248,0.25)]';
    } else if (avgFps >= 50) {
      grade = 'B';
      gradeTitle = 'Kabul Edilebilir Akıcılık';
      gradeColor =
        'text-amber-400 border-amber-400/40 bg-amber-500/15 shadow-[0_0_20px_rgba(251,191,36,0.25)]';
    } else if (avgFps >= 30) {
      grade = 'C';
      gradeTitle = 'Orta / Mikro Takılmalar Mevcut';
      gradeColor =
        'text-orange-400 border-orange-400/40 bg-orange-500/15 shadow-[0_0_20px_rgba(249,115,22,0.25)]';
    } else {
      grade = 'D';
      gradeTitle = 'Düşük FPS / Optimizasyon Gerekli';
      gradeColor =
        'text-rose-400 border-rose-400/40 bg-rose-500/15 shadow-[0_0_20px_rgba(244,63,94,0.3)]';
    }

    const pagesList = Array.from(testedPagesSetRef.current);
    if (pagesList.length === 0) {
      pagesList.push('Anasayfa (/)', 'Keşfet (/kesfet)', 'Seri Detayı', 'Takvim (/takvim)');
    }

    const report: BenchmarkResults = {
      mode: modeRef.current,
      durationSec: Math.round(totalTimeMs / 1000),
      totalFrames,
      avgFps: Math.round(avgFps * 10) / 10,
      minFps: Math.round(minFps * 10) / 10,
      maxFps: Math.round(maxFps * 10) / 10,
      stabilityPercent,
      onePercentLowFps: Math.round(onePercentLowFps * 10) / 10,
      avgFrameTimeMs: Math.round(avgFrameTimeMs * 10) / 10,
      maxFrameTimeMs: Math.round(maxFrameTimeMs * 10) / 10,
      jankCount,
      jankPercent: Math.round(jankPercent * 10) / 10,
      grade,
      gradeTitle,
      gradeColor,
      date: new Date().toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      pagesTested: pagesList,
      fpsHistory: history,
    };

    setResults(report);
    setShowResults(true);
  }, []);

  // Multi-Page Tour & Fast Scroll Orchestrator
  const stepTourAndInteractions = useCallback(
    (progress: number, now: number, elapsed: number) => {
      const isMobile = modeRef.current === 'mobile';

      // 1. Determine active tour stage
      let activeIndex = TOUR_STAGES.findIndex(
        (s) => progress >= s.fractionStart && progress < s.fractionEnd
      );
      if (activeIndex === -1) activeIndex = TOUR_STAGES.length - 1;
      const stage = TOUR_STAGES[activeIndex];

      // Record visited page
      if (typeof window !== 'undefined') {
        testedPagesSetRef.current.add(window.location.pathname);
        setCurrentRouteBadge(window.location.pathname);
      }

      // 2. Detect stage transition -> navigate to target page
      if (activeIndex !== currentStageIndexRef.current) {
        currentStageIndexRef.current = activeIndex;
        stageTransitionCooldownRef.current = now + 800; // 800ms cooldown for page hydration

        // Collapse previous open card
        if (activeHoveredElementRef.current) {
          activeHoveredElementRef.current.dispatchEvent(
            new MouseEvent('mouseleave', { bubbles: true, cancelable: true })
          );
          activeHoveredElementRef.current.blur?.();
          activeHoveredElementRef.current = null;
        }

        // Determine destination route
        let dest = stage.routeHint;
        if (stage.id === 'series') {
          dest = dynamicSeriesPathRef.current || '/seri/squid-game';
        }

        // Navigate client-side via Next.js router
        if (window.location.pathname !== dest) {
          router.push(dest);
        }

        // Reset scroll position on route change
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });

        setActiveStageText(`🚀 ${stage.name} - Rota Yükleniyor...`);
        setVirtualPointerPos({
          x: window.innerWidth * 0.5,
          y: window.innerHeight * 0.45,
          visible: true,
          label: `Sayfaya Geçiliyor: ${dest}`,
        });
        return;
      }

      // During page transition cooldown, continue measuring FPS and let DOM mount
      if (now < stageTransitionCooldownRef.current) {
        setActiveStageText(`⚡ ${stage.name} - DOM & Bileşenler Yükleniyor...`);
        return;
      }

      // Update series path dynamically if on home or explore
      if (activeIndex <= 1) {
        const found = discoverSeriesPath();
        if (found) dynamicSeriesPathRef.current = found;
      }

      // 3. Local progress within this stage (0.0 to 1.0)
      const stageSpan = stage.fractionEnd - stage.fractionStart;
      const localP = Math.max(0, Math.min(1, (progress - stage.fractionStart) / stageSpan));

      // Fast Scroll Speed: 20px per frame (~1200 px/sec) on desktop, 14px on mobile
      const fastScrollDelta = isMobile ? 14 : 20;

      // STAGE SPECIFIC BEHAVIORS:
      if (stage.id === 'stress') {
        // --- STAGE 5: FINAL HIGH-SPEED STRESS TEST ---
        setActiveStageText('🔥 5. Aşama: Tam Sayfa Yüksek Hızlı GPU Stres & Jank Tespiti...');
        const cyclePeriod = 2200;
        const isScrollingDown = Math.floor(elapsed / cyclePeriod) % 2 === 0;

        if (isScrollingDown) {
          window.scrollBy({ top: isMobile ? 26 : 38, behavior: 'auto' });
        } else {
          window.scrollBy({ top: isMobile ? -26 : -38, behavior: 'auto' });
        }

        setVirtualPointerPos({
          x: window.innerWidth * (isMobile ? 0.5 : 0.6),
          y: window.innerHeight * (isScrollingDown ? 0.75 : 0.25),
          visible: true,
          label: isScrollingDown ? '⚡ Yüksek Hızlı Aşağı İniş' : '⚡ Yüksek Hızlı Yukarı Çıkış',
        });
      } else if (localP < 0.32) {
        // --- PHASE A: RAPID SWEEP DOWNWARDS ---
        setActiveStageText(`${stage.icon} ${stage.name}: Hızlı Aşağı Kaydırma...`);
        window.scrollBy({ top: fastScrollDelta, behavior: 'auto' });

        setVirtualPointerPos({
          x: window.innerWidth * (isMobile ? 0.5 : 0.65),
          y: window.innerHeight * 0.65,
          visible: true,
          label: isMobile ? '📱 Dokunmatik Hızlı Kaydırma' : '⚡ Hızlı Sayfa Taraması',
        });
      } else if (localP < 0.68) {
        // --- PHASE B: INTERACTIVE COMPONENT & CARD TESTING ---
        if (stage.id === 'home' || stage.id === 'explore') {
          // Accordion Media Card Hover / Tap testing
          const cards = Array.from(document.querySelectorAll<HTMLElement>('.koup-accordion-card'));
          const inViewCards = cards.filter((c) => {
            const r = c.getBoundingClientRect();
            return r.top >= 40 && r.bottom <= window.innerHeight - 40;
          });

          if (inViewCards.length > 0) {
            const cardIdx = Math.floor(elapsed / 1200) % inViewCards.length;
            const targetCard = inViewCards[cardIdx];
            const r = targetCard.getBoundingClientRect();

            setActiveStageText(
              isMobile
                ? '📱 Seri Kartı Dokunuldu (Touch Expand)...'
                : '🎬 Seri Kartı Açılıyor (Accordion Hover & Önizleme)...'
            );

            setVirtualPointerPos({
              x: Math.max(30, Math.min(window.innerWidth - 30, r.left + r.width / 2)),
              y: Math.max(50, Math.min(window.innerHeight - 50, r.top + r.height / 2)),
              visible: true,
              label: isMobile ? 'Parmakla Dokunuldu' : 'Kart Genişletiliyor (Hover)',
            });

            // Expand card
            if (activeHoveredElementRef.current !== targetCard) {
              if (activeHoveredElementRef.current) {
                activeHoveredElementRef.current.dispatchEvent(
                  new MouseEvent('mouseleave', { bubbles: true, cancelable: true })
                );
                activeHoveredElementRef.current.blur?.();
              }
              activeHoveredElementRef.current = targetCard;
              targetCard.dispatchEvent(
                new MouseEvent('mouseenter', { bubbles: true, cancelable: true })
              );
              targetCard.focus?.();
            }
          } else {
            window.scrollBy({ top: fastScrollDelta, behavior: 'auto' });
          }
        } else if (stage.id === 'series') {
          // Episode Rail & Cast swipe
          setActiveStageText('🎬 Seri Detayı: Bölüm Listesi & Ray Kaydırma...');
          const rails = Array.from(
            document.querySelectorAll<HTMLElement>('.overflow-x-auto, [data-drag-scroll]')
          );
          if (rails.length > 0) {
            const activeRail = rails[0];
            const r = activeRail.getBoundingClientRect();
            const swipeDirection = Math.floor(elapsed / 1200) % 2 === 0 ? 1 : -1;

            if (now - lastSwipeTriggerTimeRef.current > 1100) {
              lastSwipeTriggerTimeRef.current = now;
              activeRail.scrollBy({
                left: swipeDirection * (isMobile ? 320 : 480),
                behavior: 'smooth',
              });
            }

            setVirtualPointerPos({
              x: Math.max(
                40,
                Math.min(window.innerWidth - 40, r.left + r.width * 0.5 + swipeDirection * 100)
              ),
              y: r.top + r.height * 0.5,
              visible: true,
              label: isMobile ? '📱 Bölüm Rayı Swipe' : '↔️ Bölüm Rayı Kaydırma',
            });
          } else {
            window.scrollBy({ top: fastScrollDelta, behavior: 'auto' });
          }
        } else if (stage.id === 'calendar') {
          // Calendar Day Tab testing
          setActiveStageText('📅 Yayın Takvimi: Gün Sekmeleri & Akış...');
          const dayButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(
            (b) => {
              const text = b.textContent || '';
              return (
                text.includes('Pazartesi') ||
                text.includes('Salı') ||
                text.includes('Çarşamba') ||
                text.includes('Perşembe') ||
                text.includes('Cuma') ||
                text.includes('Bugün')
              );
            }
          );

          if (dayButtons.length > 0) {
            const btnIdx = Math.floor(elapsed / 1500) % dayButtons.length;
            const targetBtn = dayButtons[btnIdx];
            const r = targetBtn.getBoundingClientRect();

            setVirtualPointerPos({
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              visible: true,
              label: `Gün Sekmesi: ${targetBtn.textContent?.trim().slice(0, 10)}`,
            });

            if (Math.floor(elapsed / 1500) !== Math.floor((elapsed - 100) / 1500)) {
              targetBtn.click();
            }
          }
          window.scrollBy({ top: isMobile ? 8 : 12, behavior: 'auto' });
        }
      } else {
        // --- PHASE C: FAST HORIZONTAL SWIPE & FLICK TO BOTTOM/TOP ---
        setActiveStageText(`${stage.icon} ${stage.name}: Yatay Ray Swipe & Hızlı Kaydırma...`);

        if (activeHoveredElementRef.current) {
          activeHoveredElementRef.current.dispatchEvent(
            new MouseEvent('mouseleave', { bubbles: true, cancelable: true })
          );
          activeHoveredElementRef.current.blur?.();
          activeHoveredElementRef.current = null;
        }

        const rails = Array.from(
          document.querySelectorAll<HTMLElement>('.overflow-x-auto, [data-drag-scroll]')
        );
        if (rails.length > 0 && localP < 0.88) {
          const rail = rails[Math.floor(elapsed / 1500) % rails.length];
          const swipeDirection = Math.floor(elapsed / 1200) % 2 === 0 ? 1 : -1;

          if (now - lastSwipeTriggerTimeRef.current > 1100) {
            lastSwipeTriggerTimeRef.current = now;
            rail.scrollBy({
              left: swipeDirection * (isMobile ? 380 : 550),
              behavior: 'smooth',
            });
          }

          const r = rail.getBoundingClientRect();
          setVirtualPointerPos({
            x: Math.max(
              50,
              Math.min(window.innerWidth - 50, r.left + r.width * 0.5 + swipeDirection * 120)
            ),
            y: r.top + r.height * 0.5,
            visible: true,
            label: isMobile ? '📱 Yatay Dokunmatik Swipe' : '↔️ Yatay Ray Kaydırma',
          });
        } else {
          window.scrollBy({ top: fastScrollDelta * 1.5, behavior: 'auto' });
          setVirtualPointerPos({
            x: window.innerWidth * 0.5,
            y: window.innerHeight * 0.8,
            visible: true,
            label: '⚡ Hızlı Alt Taraması',
          });
        }
      }
    },
    [router, discoverSeriesPath]
  );

  // Main benchmark loop via requestAnimationFrame
  const startBenchmark = useCallback(() => {
    setIsOpen(false);
    setShowResults(false);
    setIsRunning(true);
    isRunningRef.current = true;
    modeRef.current = selectedMode;

    const durationMs = selectedDuration * 1000;
    targetDurationMsRef.current = durationMs;

    frameTimesRef.current = [];
    fpsHistoryRef.current = [];
    testedPagesSetRef.current = new Set();
    currentStageIndexRef.current = -1;
    stageTransitionCooldownRef.current = 0;
    lastSwipeTriggerTimeRef.current = 0;
    activeHoveredElementRef.current = null;
    setLiveSparkline([]);

    if (typeof window !== 'undefined') {
      testedPagesSetRef.current.add(window.location.pathname);
    }

    startTimeRef.current = performance.now();
    lastTimeRef.current = performance.now();
    lastInteractionTimeRef.current = 0;

    function loop(now: number) {
      if (!isRunningRef.current) return;

      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // Filter extreme pause / tab freeze (>1000ms)
      if (delta > 0 && delta < 1000) {
        frameTimesRef.current.push(delta);
      }

      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / durationMs);

      // Update Live HUD & Sample FPS every ~90ms
      if (now - lastInteractionTimeRef.current > 90) {
        lastInteractionTimeRef.current = now;
        const currentFps = delta > 0 ? Math.min(144, Math.round(1000 / delta)) : 60;
        setLiveFps(currentFps);
        setLiveLatencyMs(Math.round(delta * 10) / 10);
        setProgressPercent(Math.round(progress * 100));
        setElapsedSec(Math.round(elapsed / 1000));

        fpsHistoryRef.current.push(currentFps);
        setLiveSparkline((prev) => {
          const next = [...prev, currentFps];
          return next.length > 36 ? next.slice(-36) : next;
        });

        // Running progressive average FPS & min FPS
        const frames = frameTimesRef.current;
        if (frames.length > 10) {
          const totalTime = frames.reduce((a, b) => a + b, 0);
          const runningAvg = Math.round((frames.length / (totalTime / 1000)) * 10) / 10;
          setCurrentAvgFps(runningAvg);

          const hist = fpsHistoryRef.current;
          if (hist.length > 4) {
            setCurrentMinFps(Math.min(...hist.slice(3)));
          }
        }

        // Run multi-page tour & interactions
        stepTourAndInteractions(progress, now, elapsed);
      }

      if (elapsed >= durationMs) {
        finishBenchmark();
      } else {
        rafIdRef.current = requestAnimationFrame(loop);
      }
    }

    rafIdRef.current = requestAnimationFrame(loop);
  }, [selectedDuration, selectedMode, stepTourAndInteractions, finishBenchmark]);

  // Copy results to clipboard
  const handleCopyResults = () => {
    if (!results) return;
    const text = `=== KOUP PERFORMANCE BENCHMARK RAPORU ===
Tarih: ${results.date}
Mod: ${results.mode === 'mobile' ? 'Mobil Simülasyonu (Galaxy S8+)' : 'Masaüstü Standart'}
Test Süresi: ${results.durationSec} saniye
Test Edilen Sayfalar: ${results.pagesTested.join('  ➜  ')}
Toplam İşlenen Kare: ${results.totalFrames.toLocaleString()} kare

--- PERFORMANS & STABİLİTE DEĞERLERİ ---
• Ortalama FPS: ${results.avgFps} FPS
• Minimum FPS (En Düşük Dip): ${results.minFps} FPS  [Hedef: >=90 FPS ${results.minFps >= 90 ? 'BAŞARILI' : 'OPTİMİZASYON DEVAM'}]
• Maksimum FPS: ${results.maxFps} FPS
• FPS Stabilite Skoru: %${results.stabilityPercent}
• %1 Low FPS (En Kötü %1): ${results.onePercentLowFps} FPS
• Ortalama Kare Gecikmesi: ${results.avgFrameTimeMs} ms
• Maksimum Kare Donması (Spike): ${results.maxFrameTimeMs} ms
• Takılan Kare (Jank >33ms): ${results.jankCount} adet (%${results.jankPercent})
• Genel Derecelendirme: [${results.grade}] ${results.gradeTitle}
==========================================`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  return (
    <>
      {/* 1. FLOATING LAUNCHER BUTTON */}
      {!isRunning && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-5 right-5 z-[9990] flex items-center"
        >
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-label="Benchmark Testini Aç"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#121217]/95 hover:bg-[#1a1a22] border border-white/20 hover:border-sky-400/50 shadow-[0_8px_30px_rgba(0,0,0,0.85)] text-white text-xs font-bold transition-colors cursor-pointer group backdrop-blur-sm"
          >
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <Gauge className="w-4 h-4 text-sky-400 group-hover:rotate-12 transition-transform" />
            <span>⚡ Benchmark Testi</span>
          </button>
        </motion.div>
      )}

      {/* 2. LIVE RUNNER HUD (During active benchmark) */}
      <AnimatePresence>
        {isRunning && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[10000] w-[96%] max-w-4xl pointer-events-auto"
          >
            <div className="rounded-3xl bg-[#0b0b0f]/95 border border-sky-400/40 p-3 sm:p-4 shadow-[0_16px_50px_rgba(0,0,0,0.95)] backdrop-blur-sm space-y-2.5">
              {/* Top Row: Live Stats & Mini Sparkline Graph */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 font-mono">
                    <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span
                      className={`text-sm font-black ${
                        liveFps >= 90
                          ? 'text-emerald-400'
                          : liveFps >= 60
                          ? 'text-sky-400'
                          : liveFps >= 40
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {liveFps} FPS
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/60 border border-white/10 font-mono text-xs">
                    <Clock className="w-3 h-3 text-white/50 shrink-0" />
                    <span className="text-white/80">{liveLatencyMs} ms</span>
                  </div>

                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-400/20 font-mono text-xs text-emerald-300">
                    <span>Ort:</span>
                    <strong className="font-bold">{currentAvgFps} FPS</strong>
                  </div>

                  <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-sky-500/10 border border-sky-400/20 font-mono text-xs text-sky-300">
                    <span>Min:</span>
                    <strong
                      className={`font-bold ${
                        currentMinFps >= 90 ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {currentMinFps} FPS
                    </strong>
                  </div>

                  {/* Real-time mini SVG Sparkline */}
                  {liveSparkline.length > 5 && (
                    <div className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-xl bg-black/40 border border-white/10">
                      <svg width="80" height="20" className="overflow-visible">
                        <polyline
                          fill="none"
                          stroke={liveFps >= 90 ? '#34d399' : liveFps >= 60 ? '#38bdf8' : '#f43f5e'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={liveSparkline
                            .map((val, idx) => {
                              const x = (idx / (liveSparkline.length - 1)) * 80;
                              const y = 20 - Math.min(20, Math.max(0, (val / 144) * 20));
                              return `${x},${y}`;
                            })
                            .join(' ')}
                        />
                      </svg>
                      <span className="text-[9px] font-mono text-white/40">144Hz</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-mono text-white/70">
                    {elapsedSec}s / {selectedDuration}s ({progressPercent}%)
                  </span>

                  <button
                    type="button"
                    onClick={finishBenchmark}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-300 text-xs font-bold transition-colors cursor-pointer"
                  >
                    <Square className="w-3 h-3 fill-rose-300" />
                    <span>Durdur</span>
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-sky-500 via-indigo-400 to-emerald-400"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Bottom: Active Stage Info & Route Badge */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-white/75">
                <span className="truncate">{activeStageText}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300 text-[10px] font-bold">
                    {currentRouteBadge}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 uppercase font-bold text-[10px] text-white/60">
                    {selectedMode === 'mobile' ? '📱 Mobil' : '🖥️ Masaüstü'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. VIRTUAL BOT POINTER */}
      {isRunning && virtualPointerPos.visible && (
        <div
          className="fixed pointer-events-none z-[10001] transition-all duration-200 ease-out"
          style={{
            left: `${virtualPointerPos.x}px`,
            top: `${virtualPointerPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {selectedMode === 'mobile' ? (
            <div className="relative flex flex-col items-center">
              <div className="w-12 h-12 rounded-full border-2 border-amber-400/80 bg-amber-400/20 animate-ping absolute" />
              <div className="w-10 h-10 rounded-full border-2 border-amber-400 bg-amber-400/35 backdrop-blur-xs flex items-center justify-center shadow-[0_0_18px_rgba(251,191,36,0.6)]">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <span className="mt-1.5 px-2.5 py-0.5 rounded-full bg-black/90 border border-amber-400/40 text-[10px] font-mono text-amber-300 whitespace-nowrap shadow-lg">
                {virtualPointerPos.label}
              </span>
            </div>
          ) : (
            <div className="relative flex flex-col items-center">
              <div className="w-8 h-8 rounded-full border border-sky-400 bg-sky-400/30 animate-pulse shadow-[0_0_18px_rgba(56,189,248,0.8)] flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-white shadow-sm" />
              </div>
              <span className="mt-1 px-2.5 py-0.5 rounded-full bg-black/90 border border-sky-400/40 text-[10px] font-mono text-sky-300 whitespace-nowrap shadow-lg">
                {virtualPointerPos.label}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 4. SETUP MODAL */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/80 cursor-pointer"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-lg bg-[#0e0e14] border border-white/15 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 z-10"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5 text-sky-400">
                  <div className="w-9 h-9 rounded-2xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center">
                    <Gauge className="w-5 h-5 text-sky-400" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white text-base">KoUp Benchmark & FPS Testi</h3>
                    <p className="text-[11px] text-white/50">
                      Hedef: 90+ FPS Min Değer & Stabilite Grafiği
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode Selection */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                  Çalışma Modu
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedMode('desktop')}
                    className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-colors cursor-pointer ${
                      selectedMode === 'desktop'
                        ? 'bg-sky-500/15 border-sky-400/60 shadow-[0_0_16px_rgba(56,189,248,0.2)]'
                        : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <Monitor
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        selectedMode === 'desktop' ? 'text-sky-400' : 'text-white/40'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold text-white">Masaüstü Modu</div>
                      <div className="text-[11px] text-white/50 leading-relaxed mt-0.5">
                        Hızlı kaydırma, hover ile kart açılışları ve ray gezintisi.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMode('mobile')}
                    className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-colors cursor-pointer ${
                      selectedMode === 'mobile'
                        ? 'bg-amber-500/15 border-amber-400/60 shadow-[0_0_16px_rgba(251,191,36,0.2)]'
                        : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <Smartphone
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        selectedMode === 'mobile' ? 'text-amber-400' : 'text-white/40'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold text-white">Mobil Modu (Galaxy S8+)</div>
                      <div className="text-[11px] text-white/50 leading-relaxed mt-0.5">
                        Dokunmatik kaydırma, mobil swipe ve parmakla kart dokunma simülasyonu.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Duration Selection */}
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                  Test Süresi
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { sec: 60, label: '60 Saniye', sub: 'Hızlı Tur (1 Dk)' },
                    { sec: 90, label: '90 Saniye', sub: 'Önerilen (1.5 Dk)' },
                    { sec: 120, label: '120 Saniye', sub: 'Tam Stres (2 Dk)' },
                  ].map((opt) => (
                    <button
                      key={opt.sec}
                      type="button"
                      onClick={() => setSelectedDuration(opt.sec)}
                      className={`p-2.5 rounded-2xl border text-center transition-colors cursor-pointer ${
                        selectedDuration === opt.sec
                          ? 'bg-white text-black border-white font-bold shadow-md'
                          : 'bg-white/[0.03] border-white/10 text-white/80 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="text-xs">{opt.label}</div>
                      <div
                        className={`text-[10px] ${
                          selectedDuration === opt.sec ? 'text-black/60' : 'text-white/40'
                        }`}
                      >
                        {opt.sub}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2.5 rounded-full text-xs font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Vazgeç
                </button>

                <button
                  type="button"
                  onClick={startBenchmark}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs shadow-[0_0_25px_rgba(41,151,255,0.45)] transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>Testi Başlat ({selectedDuration}s)</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. RESULTS REPORT MODAL WITH FPS TIMELINE GRAPH */}
      <AnimatePresence>
        {showResults && results && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowResults(false)}
              className="fixed inset-0 bg-black/85 cursor-pointer"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-2xl bg-[#0e0e14] border border-white/15 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 z-10 my-8"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white text-base">Benchmark Test Sonuçları</h3>
                    <p className="text-[11px] font-mono text-white/50">
                      {results.date} • {results.mode === 'mobile' ? '📱 Galaxy S8+ Modu' : '🖥️ Masaüstü Modu'} • {results.durationSec}s
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowResults(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Performance Grade Banner */}
              <div className={`p-4 rounded-3xl border flex items-center justify-between gap-4 ${results.gradeColor}`}>
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-semibold opacity-75">
                    Genel Performans & Stabilite Skoru
                  </span>
                  <div className="text-base sm:text-lg font-black text-white">{results.gradeTitle}</div>
                  <div className="text-[11px] text-white/80 font-mono">
                    Stabilite: %{results.stabilityPercent} • Min FPS: {results.minFps} FPS
                  </div>
                </div>
                <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/20 flex items-center justify-center text-3xl font-black text-white shadow-inner shrink-0">
                  {results.grade}
                </div>
              </div>

              {/* PRIMARY STATS GRID (6 Key Metrics) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <span className="text-[10px] font-mono text-white/40 uppercase">Ortalama FPS</span>
                  <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                    {results.avgFps}
                  </div>
                  <span className="text-[10px] text-white/50">Kare / Saniye</span>
                </div>

                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-[10px] font-mono text-white/40 uppercase">Minimum FPS</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        results.minFps >= 90
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      Hedef ≥90
                    </span>
                  </div>
                  <div
                    className={`text-xl sm:text-2xl font-black font-mono ${
                      results.minFps >= 90
                        ? 'text-emerald-400'
                        : results.minFps >= 60
                        ? 'text-sky-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {results.minFps}
                  </div>
                  <span className="text-[10px] text-white/50">En Düşük Dip</span>
                </div>

                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <span className="text-[10px] font-mono text-white/40 uppercase">Stabilite Skoru</span>
                  <div className="text-xl sm:text-2xl font-black text-sky-400 font-mono">
                    %{results.stabilityPercent}
                  </div>
                  <span className="text-[10px] text-white/50">Dalgalanma Payı</span>
                </div>

                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <span className="text-[10px] font-mono text-white/40 uppercase">%1 Low FPS</span>
                  <div className="text-xl sm:text-2xl font-black text-sky-300 font-mono">
                    {results.onePercentLowFps}
                  </div>
                  <span className="text-[10px] text-white/50">En Kötü %1</span>
                </div>

                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <span className="text-[10px] font-mono text-white/40 uppercase">Kare Gecikmesi</span>
                  <div className="text-xl sm:text-2xl font-black text-white font-mono">
                    {results.avgFrameTimeMs}
                  </div>
                  <span className="text-[10px] text-white/50">Ortalama ms</span>
                </div>

                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center space-y-0.5">
                  <span className="text-[10px] font-mono text-white/40 uppercase">Maks Spike</span>
                  <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
                    {results.maxFrameTimeMs}
                  </div>
                  <span className="text-[10px] text-white/50">Maksimum ms</span>
                </div>
              </div>

              {/* FPS TIMELINE AREA CHART (SVG Visual Curve) */}
              {results.fpsHistory.length > 5 && (
                <div className="p-4 rounded-2xl bg-black/60 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono text-white/70">
                    <div className="flex items-center gap-1.5 font-bold text-white">
                      <BarChart2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>FPS Stabilite & Zaman Grafiği</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="flex items-center gap-1 text-emerald-400 font-bold">
                        <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> Hedef: 90+ FPS
                      </span>
                      <span className="text-white/40">Tepe: {results.maxFps} FPS</span>
                    </div>
                  </div>

                  <div className="w-full h-28 relative">
                    {/* SVG Chart */}
                    <svg
                      viewBox={`0 0 ${Math.max(100, results.fpsHistory.length * 6)} 100`}
                      preserveAspectRatio="none"
                      className="w-full h-full overflow-visible"
                    >
                      <defs>
                        <linearGradient id="fpsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                          <stop offset="50%" stopColor="#34d399" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* 90 FPS Target Reference Line */}
                      <line
                        x1="0"
                        y1={100 - (90 / 144) * 100}
                        x2={results.fpsHistory.length * 6}
                        y2={100 - (90 / 144) * 100}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                        strokeWidth="1"
                        opacity="0.6"
                      />

                      {/* Area Fill */}
                      <polygon
                        fill="url(#fpsGradient)"
                        points={`0,100 ${results.fpsHistory
                          .map((val, idx) => {
                            const x = idx * 6;
                            const y = 100 - Math.min(100, Math.max(0, (val / 144) * 100));
                            return `${x},${y}`;
                          })
                          .join(' ')} ${(results.fpsHistory.length - 1) * 6},100`}
                      />

                      {/* Curve Line */}
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={results.fpsHistory
                          .map((val, idx) => {
                            const x = idx * 6;
                            const y = 100 - Math.min(100, Math.max(0, (val / 144) * 100));
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    </svg>
                  </div>
                </div>
              )}

              {/* Visited Pages Badge Bar */}
              <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5">
                <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">
                  Test Edilen Rotalar ({results.pagesTested.length} Rota):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {results.pagesTested.map((p, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 text-[11px] font-mono text-white/80"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {/* Detailed Breakdown */}
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5 text-xs">
                <div className="flex items-center justify-between py-0.5 border-b border-white/5 text-white/70">
                  <span>Toplam İşlenen Kare Sayısı:</span>
                  <strong className="font-mono text-white font-bold">
                    {results.totalFrames.toLocaleString()} kare
                  </strong>
                </div>

                <div className="flex items-center justify-between py-0.5 border-b border-white/5 text-white/70">
                  <span>Takılan / Düşen Kare (Jank &gt;33ms):</span>
                  <strong className="font-mono text-rose-300 font-bold">
                    {results.jankCount} kare (%{results.jankPercent})
                  </strong>
                </div>

                <div className="flex items-center justify-between py-0.5 text-white/70">
                  <span>Monitör Tazeleme Standardı:</span>
                  <strong className="font-mono text-emerald-400 font-bold">
                    120Hz / 144Hz Donanımsal
                  </strong>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCopyResults}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Rapor Kopyalandı!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-white/60" />
                      <span>Raporu Kopyala</span>
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResults(false);
                      setIsOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/5 hover:bg-white/15 text-white/80 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Yeniden Test Et</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowResults(false)}
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-colors cursor-pointer shadow-md"
                  >
                    Kapat
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
