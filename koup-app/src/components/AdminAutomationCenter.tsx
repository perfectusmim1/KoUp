'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Radio,
  Clock,
  Sparkles,
  Film,
  Tv,
  Layers,
  Activity,
  Play,
  RefreshCw,
  Search,
  X,
  ExternalLink,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  Check,
  ShieldCheck,
  Globe,
  SlidersHorizontal,
  Copy,
  Calendar,
} from 'lucide-react';
import { getProxiedImageUrl, formatContentTypeTR } from '@/lib/supabase';
import CountryFlag from '@/components/CountryFlag';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import { adminFetch } from '@/lib/adminClient';

export interface ScraperConfigRow {
  id: string;
  name: string;
  site_url: string;
  cron_schedule: string;
  is_enabled: boolean;
  last_run_at?: string | null;
  last_status: string;
  items_synced: number;
  notes?: string | null;
}

export interface AddedDramaItem {
  id: number;
  title: string;
  slug: string;
  cover_image?: string;
  content_type?: string;
  country_code?: string;
  country_name?: string;
  release_year?: number;
  site?: string;
  added_at?: string;
}

export interface AddedEpisodeItem {
  id?: number;
  drama_id?: number;
  drama_title?: string;
  drama_slug?: string;
  cover_image?: string;
  season_number: number;
  episode_number: number;
  episode_name?: string;
  added_at?: string;
}

export interface AddedSourceItem {
  id?: number;
  episode_id?: number;
  drama_id?: number;
  drama_title?: string;
  drama_slug?: string;
  season_number?: number;
  episode_number?: number;
  episode_name?: string;
  source_name?: string;
  provider?: string;
  site?: string;
  direct_url?: string;
  added_at?: string;
}

export interface AutomationRunRecord {
  id: number;
  run_id: string;
  trigger_type: string;
  status: 'running' | 'completed' | 'failed';
  target: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
  total_dramas_added: number;
  total_episodes_added: number;
  total_sources_added: number;
  dramas_added_list?: AddedDramaItem[];
  episodes_added_list?: AddedEpisodeItem[];
  sources_added_list?: AddedSourceItem[];
  scrapers_summary?: Record<string, any>;
  logs?: string[];
  error_message?: string;
  created_at?: string;
}

interface AdminAutomationCenterProps {
  scrapers: ScraperConfigRow[];
  onOpenScraperDetail: (scraperId: string) => void;
  onRunSingleScraper: (scraperId: string) => void;
  runningScraperId: string | null;
  isAdmin: boolean;
  pushNotification: (
    title: string,
    message: string,
    type?: 'success' | 'info' | 'system' | 'episode' | 'actor' | 'reply'
  ) => void;
}

const SCRAPER_BRANDS: Record<
  string,
  {
    logoText: string;
    domain: string;
    bgGradient: string;
    borderGlow: string;
    textColor: string;
    category: string;
    protocol: string;
  }
> = {
  ddizi: {
    logoText: 'DDizi',
    domain: 'https://ddizi.tel',
    bgGradient: 'from-blue-600/25 via-indigo-700/20 to-blue-950/40',
    borderGlow: 'border-blue-500/40 group-hover:border-blue-400/80',
    textColor: 'text-blue-300',
    category: 'Yerli Dizi & Klasik HD',
    protocol: 'Doğrudan .m3u8 HLS + YouTube HD Resmi Akış',
  },
  animecix: {
    logoText: 'AnimeciX',
    domain: 'https://animecix.net',
    bgGradient: 'from-purple-600/25 via-indigo-700/20 to-purple-950/40',
    borderGlow: 'border-purple-500/40 group-hover:border-purple-400/80',
    textColor: 'text-purple-300',
    category: 'Anime & Fansub Arşivi',
    protocol: 'Tau-Video & Mail.ru Doğrudan MP4 / HLS',
  },
  dizibox: {
    logoText: 'DiziBox',
    domain: 'https://www.dizibox.live',
    bgGradient: 'from-amber-600/25 via-orange-700/20 to-amber-950/40',
    borderGlow: 'border-amber-500/40 group-hover:border-amber-400/80',
    textColor: 'text-amber-300',
    category: 'Global & Batı Sinema Dizileri',
    protocol: 'king.php DBX Pro MolyStream 1080p HLS',
  },
  dizikorea: {
    logoText: 'DiziKorea',
    domain: 'https://dizikorea3.com',
    bgGradient: 'from-emerald-600/25 via-teal-700/20 to-emerald-950/40',
    borderGlow: 'border-emerald-500/40 group-hover:border-emerald-400/80',
    textColor: 'text-emerald-300',
    category: 'K-Drama & Asya Dizileri',
    protocol: 'playerdkorea.xyz 1080p HLS + Vidmoly',
  },
  hdfilm: {
    logoText: 'HDFilm',
    domain: 'https://www.hdfilmcehennemi.nl',
    bgGradient: 'from-rose-600/25 via-red-700/20 to-rose-950/40',
    borderGlow: 'border-rose-500/40 group-hover:border-rose-400/80',
    textColor: 'text-rose-300',
    category: 'Sinema & Yabancı Dizi',
    protocol: 'Close Dual HLS (Dublaj) + Rapidrame (Altyazılı)',
  },
  asyawatch: {
    logoText: 'AsyaWatch',
    domain: 'https://asyawatch.com',
    bgGradient: 'from-pink-600/25 via-rose-700/20 to-pink-950/40',
    borderGlow: 'border-pink-500/40 group-hover:border-pink-400/80',
    textColor: 'text-pink-300',
    category: 'K-Drama & Asya Arşivi',
    protocol: 'four.pichive.online 1080p Native HLS',
  },
  dizilla: {
    logoText: 'Dizilla',
    domain: 'https://dizilla.now',
    bgGradient: 'from-amber-600/25 via-red-700/20 to-amber-950/40',
    borderGlow: 'border-amber-500/40 group-hover:border-amber-400/80',
    textColor: 'text-amber-300',
    category: 'Global, Anime & K-Drama',
    protocol: 'AES-256 Decrypt + 1080p Native HLS',
  },
  dizifon: {
    logoText: 'DiziFon',
    domain: 'https://www.dizifon.cc',
    bgGradient: 'from-amber-600/25 via-yellow-600/20 to-amber-950/40',
    borderGlow: 'border-amber-500/40 group-hover:border-amber-400/80',
    textColor: 'text-amber-300',
    category: 'Asya, Çin & K-Drama HD',
    protocol: 'OK.ru HD + Vidmoly + YouTube HD Akış Çözücü',
  },
};

export default function AdminAutomationCenter({
  scrapers,
  onOpenScraperDetail,
  onRunSingleScraper,
  runningScraperId,
  isAdmin,
  pushNotification,
}: AdminAutomationCenterProps) {
  // Automation Data State
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<AutomationRunRecord | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [localScrapers, setLocalScrapers] = useState<ScraperConfigRow[]>(scrapers);

  // Trigger & Streaming State
  const [isAutomationRunning, setIsAutomationRunning] = useState(false);
  const [automationTarget, setAutomationTarget] = useState('all');
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [showLiveConsole, setShowLiveConsole] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Interactive Drilldown Modals
  const [activeModal, setActiveModal] = useState<'series' | 'episodes' | 'sources' | 'run_details' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'dizi' | 'film' | 'anime'>('all');
  const [providerFilter, setProviderFilter] = useState('all');

  // Sync props scrapers to local state
  useEffect(() => {
    if (scrapers && scrapers.length > 0) {
      setLocalScrapers(scrapers);
    }
  }, [scrapers]);

  // Load automation runs and statistics from API
  const fetchAutomationData = async (runId?: number) => {
    if (!isAdmin) return;
    setIsLoadingRuns(true);
    try {
      const url = runId ? `/api/admin/automation?runId=${runId}` : '/api/admin/automation';
      const res = await adminFetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.runs)) {
          setRuns(data.runs);
          if (!selectedRun || runId) {
            setSelectedRun(data.runs[0] || null);
          } else {
            // Keep matching run updated
            const updatedCurrent = data.runs.find((r: AutomationRunRecord) => r.id === selectedRun.id);
            setSelectedRun(updatedCurrent || data.runs[0] || null);
          }
        }
        if (Array.isArray(data.scrapers) && data.scrapers.length > 0) {
          setLocalScrapers(data.scrapers);
        }
      }
    } catch (err) {
      console.error('fetchAutomationData error:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  useEffect(() => {
    fetchAutomationData();
  }, [isAdmin]);

  // Auto-scroll terminal logs
  useEffect(() => {
    if (showLiveConsole && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveLogs, showLiveConsole]);

  // Toggle single scraper in 12h cron
  const handleToggleScraperInCron = async (botId: string, currentEnabled: boolean) => {
    const nextState = !currentEnabled;
    // Optimistic UI update
    setLocalScrapers((prev) =>
      prev.map((s) => (s.id === botId ? { ...s, is_enabled: nextState } : s))
    );

    try {
      const res = await adminFetch('/api/admin/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_scraper', scraperId: botId, is_enabled: nextState }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Ayar kaydedilemedi');
      }
      pushNotification(
        'Otomasyon Ayarı Güncellendi',
        `${botId} botu 12 saatlik otomasyonda ${nextState ? 'AKTİF' : 'DEVRE DIŞI'} olarak ayarlandı.`,
        'success'
      );
    } catch (err: any) {
      // Revert optimistic update
      setLocalScrapers((prev) =>
        prev.map((s) => (s.id === botId ? { ...s, is_enabled: currentEnabled } : s))
      );
      pushNotification('Hata', err.message || 'Durum değiştirilemedi.', 'info');
    }
  };

  // Toggle all scrapers
  const handleToggleAllScrapers = async (enable: boolean) => {
    setLocalScrapers((prev) => prev.map((s) => ({ ...s, is_enabled: enable })));
    try {
      const res = await adminFetch('/api/admin/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle_all', is_enabled: enable }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Tüm botlar güncellenemedi');
      }
      pushNotification(
        'Toplu Bot Ayarı',
        `Tüm botlar 12 saatlik otomasyonda ${enable ? 'AKTİF' : 'DEVRE DIŞI'} yapıldı.`,
        'success'
      );
    } catch (err: any) {
      fetchAutomationData();
      pushNotification('Hata', err.message || 'İşlem başarısız.', 'info');
    }
  };

  // Trigger automation with real-time NDJSON stream
  const handleRunFullAutomation = async () => {
    if (isAutomationRunning) return;
    setIsAutomationRunning(true);
    setShowLiveConsole(true);
    setLiveLogs([
      `[${new Date().toTimeString().split(' ')[0]}] [SİSTEM] 12 Saatlik KoUp Otomasyon Pipeline başlatılıyor (Hedef: ${automationTarget})...`,
    ]);

    try {
      const resp = await adminFetch('/api/admin/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_automation', target: automationTarget }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Otomasyon başlatılamadı');
      }

      if (resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line.trim());
              if (event.type === 'log') {
                setLiveLogs((prev) => [...prev.slice(-150), event.line]);
              } else if (event.type === 'result') {
                if (event.latestRun) {
                  setSelectedRun(event.latestRun);
                }
              }
            } catch (_) {}
          }
        }
      }

      await fetchAutomationData();
      pushNotification(
        'Otomasyon Başarıyla Tamamlandı',
        'Tüm aktif botlar, seriler ve kaynaklar Cloudflare R2 ile senkronize edildi.',
        'success'
      );
    } catch (err: any) {
      pushNotification('Otomasyon Hatası', err.message || 'Çalışma sırasında hata oluştu.', 'system');
    } finally {
      setIsAutomationRunning(false);
    }
  };

  // Target options for select
  const targetOptions: SelectOption[] = [
    { value: 'all', label: 'Tüm Aktif Botlar & Çözücü (Tam Pipeline)', description: 'Tüm botları, haberleri, takvimi ve bekleyen kaynakları sırayla çalıştırır' },
    { value: 'dizikorea', label: 'DiziKorea (K-Drama)', description: 'Kore, Çin ve Asya dizilerinin son bölümlerini tarar' },
    { value: 'animecix', label: 'AnimeciX (Anime)', description: 'Yeni anime bölümleri ve Tau-Video akışlarını işler' },
    { value: 'dizibox', label: 'DiziBox (Yabancı Dizi)', description: 'DBX Pro 1080p HLS akışlarını günceller' },
    { value: 'hdfilm', label: 'HDFilmcehennemi (Sinema & Dizi)', description: 'Close Dublaj ve Rapidrame Altyazılı akışlarını tarar' },
    { value: 'ddizi', label: 'DDizi (Yerli Dizi)', description: 'Yerli diziler ve klasik yapımları senkronize eder' },
    { value: 'dizilla', label: 'Dizilla (Batı & Anime)', description: 'AES-256 çözülmüş katalog ve 1080p akışları işler' },
    { value: 'dizifon', label: 'DiziFon (Asya HD)', description: 'OK.ru HD ve Vidmoly Asya akışlarını tarar' },
    { value: 'asyawatch', label: 'AsyaWatch (Asya HLS)', description: 'four.pichive.online 1080p yerel akışlarını çözer' },
    { value: 'pending_resolver', label: 'Bekleyen Kaynak Çözücü', description: 'Oynatılamayan bölümler için çapraz site araması yapar' },
    { value: 'calendar', label: 'Yayın Takvimi Eşitlemesi', description: 'DiziKorea ve DiziBox takvimini günceller' },
    { value: 'watchdog_24h', label: '24s Rolling Watchdog', description: 'Son eklenen bölümlerin kaynak sağlığını test eder' },
  ];

  // Active counts
  const enabledBotsCount = useMemo(() => {
    return localScrapers.filter((s) => s.is_enabled).length;
  }, [localScrapers]);

  // Filtered lists for modals
  const filteredDramas = useMemo(() => {
    const list = selectedRun?.dramas_added_list || [];
    return list.filter((item) => {
      const matchSearch =
        !searchQuery ||
        item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.slug?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchType = typeFilter === 'all' || item.content_type === typeFilter;
      return matchSearch && matchType;
    });
  }, [selectedRun, searchQuery, typeFilter]);

  const filteredEpisodes = useMemo(() => {
    const list = selectedRun?.episodes_added_list || [];
    return list.filter((item) => {
      const matchSearch =
        !searchQuery ||
        item.drama_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.episode_name?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [selectedRun, searchQuery]);

  const filteredSources = useMemo(() => {
    const list = selectedRun?.sources_added_list || [];
    return list.filter((item) => {
      const matchSearch =
        !searchQuery ||
        item.drama_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.source_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.provider?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchProvider = providerFilter === 'all' || item.provider === providerFilter;
      return matchSearch && matchProvider;
    });
  }, [selectedRun, searchQuery, providerFilter]);

  // Unique providers in sources list
  const availableProviders = useMemo(() => {
    const list = selectedRun?.sources_added_list || [];
    const set = new Set<string>();
    for (const s of list) {
      if (s.provider) set.add(s.provider);
    }
    return Array.from(set);
  }, [selectedRun]);

  // Format time helper
  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Bilinmiyor';
    try {
      const d = new Date(dateStr);
      const diffMs = Date.now() - d.getTime();
      const mins = Math.floor(diffMs / (1000 * 60));
      if (mins < 1) return 'Az önce';
      if (mins < 60) return `${mins} dk önce`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours} saat önce`;
      const days = Math.floor(hours / 24);
      return `${days} gün önce`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* ================= HERO AUTOMATION COMMAND CENTER BANNER ================= */}
      <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 relative overflow-hidden space-y-6">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-15 pointer-events-none bg-gradient-to-br from-emerald-500 via-sky-600 to-indigo-700" />

        {/* Top Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                12 Saatlik Cron Aktif
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-white/60">
                0 */12 * * * (00:00 & 12:00 UTC)
              </span>
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-sky-300">
                Cloudflare R2 Arşiv Senkronize
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Radio className="w-6 h-6 text-emerald-400" />
              <span>Otomasyon & Scraper İstatistik Merkezi</span>
            </h1>
            <p className="text-xs sm:text-sm text-white/60 max-w-2xl leading-relaxed">
              12 saatte bir çalışan çok kaynaklı tarayıcı botlarının performansını, yeni eklenen serileri, bölümleri ve oynatılabilir kaynakları buradan anlık izleyip yönetebilirsiniz.
            </p>
          </div>

          {/* Quick Stats Badges */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="px-3.5 py-2 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-white/40" />
              <div className="text-left">
                <span className="text-[10px] font-mono text-white/45 block">Son Otomasyon</span>
                <span className="text-xs font-bold font-mono text-white">
                  {selectedRun?.completed_at ? formatTimeAgo(selectedRun.completed_at) : 'Tamamlandı'}
                </span>
              </div>
            </div>

            <div className="px-3.5 py-2 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <div className="text-left">
                <span className="text-[10px] font-mono text-white/45 block">Aktif Bot Sayısı</span>
                <span className="text-xs font-bold font-mono text-emerald-400">
                  {enabledBotsCount} / {localScrapers.length} Aktif
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => fetchAutomationData()}
              disabled={isLoadingRuns}
              className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer disabled:opacity-50"
              title="Verileri Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingRuns ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Action Controls & Trigger Bar */}
        <div className="pt-4 border-t border-white/[0.08] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 relative z-10">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <div className="w-full sm:w-80">
              <CustomSelect
                value={automationTarget}
                onChange={setAutomationTarget}
                options={targetOptions}
                placeholder="Çalıştırılacak Görevi Seçiniz"
                size="sm"
                variant="glass"
              />
            </div>

            <button
              type="button"
              onClick={handleRunFullAutomation}
              disabled={isAutomationRunning}
              className={`px-5 py-2.5 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-lg ${
                isAutomationRunning
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20'
              }`}
            >
              {isAutomationRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Otomasyon Çalışıyor...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-black" />
                  <span>Otomasyonu Şimdi Çalıştır</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto">
            {liveLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLiveConsole(!showLiveConsole)}
                className={`px-3 py-2 rounded-2xl text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  showLiveConsole
                    ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>{showLiveConsole ? 'Konsolu Gizle' : 'Canlı Konsol'}</span>
                {liveLogs.length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse ml-0.5" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveModal('run_details')}
              className="px-3.5 py-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>Çalışma Raporu</span>
            </button>
          </div>
        </div>

        {/* Live Streaming Terminal Console */}
        <AnimatePresence>
          {showLiveConsole && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 rounded-2xl bg-black/85 border border-white/15 font-mono text-[11px] space-y-1.5 shadow-2xl">
                <div className="flex items-center justify-between pb-2 border-b border-white/10 text-white/50">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-white font-bold">Canlı Otomasyon Çıktısı</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLiveLogs([])}
                    className="text-[10px] text-white/40 hover:text-white transition-colors cursor-pointer"
                  >
                    Temizle
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-2 text-white/80">
                  {liveLogs.map((logLine, idx) => (
                    <div
                      key={idx}
                      className={`leading-relaxed ${
                        logLine.includes('[HATA]') || logLine.includes('[FATAL]')
                          ? 'text-rose-400'
                          : logLine.includes('[AKINCI]') || logLine.includes('[SONUÇ]')
                          ? 'text-emerald-300 font-bold'
                          : logLine.includes('[UYARI]')
                          ? 'text-amber-300'
                          : 'text-white/80'
                      }`}
                    >
                      {logLine}
                    </div>
                  ))}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ================= 4 CLICKABLE STAT CARDS (USER REQUIREMENT) ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: YENİ EKLENEN SERİLER (CLICKABLE) */}
        <motion.button
          type="button"
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            setSearchQuery('');
            setTypeFilter('all');
            setActiveModal('series');
          }}
          className="p-5 rounded-3xl apple-glass border border-purple-500/30 hover:border-purple-400/70 bg-gradient-to-br from-purple-500/10 via-white/[0.02] to-transparent text-left transition-all cursor-pointer group shadow-lg flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-purple-500/20 border border-purple-500/30 text-purple-300 group-hover:scale-110 transition-transform">
              <Film className="w-5 h-5" />
            </div>
            <span className="px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/25 text-[10px] font-mono font-bold text-purple-300 flex items-center gap-1">
              <span>Tıkla & Listele</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <span className="text-3xl font-black font-mono text-white tracking-tight block">
              +{selectedRun?.total_dramas_added ?? (selectedRun?.dramas_added_list?.length || 0)}
            </span>
            <span className="text-xs font-bold text-purple-200 mt-0.5 block">
              Yeni Eklenen Yapımlar
            </span>
            <p className="text-[11px] text-white/50 mt-1 leading-snug">
              Otomasyonda keşfedilen yeni dizi, anime ve sinema yapımları.
            </p>
          </div>

          <div className="pt-2 border-t border-white/[0.06] text-[10px] font-mono text-purple-300/80 flex items-center justify-between">
            <span>{selectedRun?.dramas_added_list?.length || 0} Yapım Kayıtlı</span>
            <span className="underline group-hover:text-purple-200">Kataloğu Aç</span>
          </div>
        </motion.button>

        {/* CARD 2: YENİ EKLENEN BÖLÜMLER (CLICKABLE) */}
        <motion.button
          type="button"
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            setSearchQuery('');
            setActiveModal('episodes');
          }}
          className="p-5 rounded-3xl apple-glass border border-emerald-500/30 hover:border-emerald-400/70 bg-gradient-to-br from-emerald-500/10 via-white/[0.02] to-transparent text-left transition-all cursor-pointer group shadow-lg flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 group-hover:scale-110 transition-transform">
              <Tv className="w-5 h-5" />
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-mono font-bold text-emerald-300 flex items-center gap-1">
              <span>Tıkla & Listele</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <span className="text-3xl font-black font-mono text-white tracking-tight block">
              +{selectedRun?.total_episodes_added ?? (selectedRun?.episodes_added_list?.length || 0)}
            </span>
            <span className="text-xs font-bold text-emerald-200 mt-0.5 block">
              Yeni Eklenen Bölümler
            </span>
            <p className="text-[11px] text-white/50 mt-1 leading-snug">
              Son tarama döngüsünde sisteme işlenen yeni bölüm yayınları.
            </p>
          </div>

          <div className="pt-2 border-t border-white/[0.06] text-[10px] font-mono text-emerald-300/80 flex items-center justify-between">
            <span>{selectedRun?.episodes_added_list?.length || 0} Bölüm Kayıtlı</span>
            <span className="underline group-hover:text-emerald-200">Bölümleri Aç</span>
          </div>
        </motion.button>

        {/* CARD 3: EKLENEN CANLI KAYNAKLAR (CLICKABLE) */}
        <motion.button
          type="button"
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            setSearchQuery('');
            setProviderFilter('all');
            setActiveModal('sources');
          }}
          className="p-5 rounded-3xl apple-glass border border-amber-500/30 hover:border-amber-400/70 bg-gradient-to-br from-amber-500/10 via-white/[0.02] to-transparent text-left transition-all cursor-pointer group shadow-lg flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-300 group-hover:scale-110 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/25 text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1">
              <span>Tıkla & Listele</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <span className="text-3xl font-black font-mono text-white tracking-tight block">
              +{selectedRun?.total_sources_added ?? (selectedRun?.sources_added_list?.length || 0)}
            </span>
            <span className="text-xs font-bold text-amber-200 mt-0.5 block">
              Canlı Oynatma Kaynakları
            </span>
            <p className="text-[11px] text-white/50 mt-1 leading-snug">
              MolyStream, Close HLS, Rapidrame, OK.ru, Tau-Video doğrudan akışları.
            </p>
          </div>

          <div className="pt-2 border-t border-white/[0.06] text-[10px] font-mono text-amber-300/80 flex items-center justify-between">
            <span>{selectedRun?.sources_added_list?.length || 0} Akış Doğrulandı</span>
            <span className="underline group-hover:text-amber-200">Kaynakları Gör</span>
          </div>
        </motion.button>

        {/* CARD 4: ÇALIŞMA SÜRESİ & DURUM */}
        <motion.button
          type="button"
          whileHover={{ y: -3, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActiveModal('run_details')}
          className="p-5 rounded-3xl apple-glass border border-sky-500/30 hover:border-sky-400/70 bg-gradient-to-br from-sky-500/10 via-white/[0.02] to-transparent text-left transition-all cursor-pointer group shadow-lg flex flex-col justify-between gap-4"
        >
          <div className="flex items-center justify-between">
            <div className="p-3 rounded-2xl bg-sky-500/20 border border-sky-500/30 text-sky-300 group-hover:scale-110 transition-transform">
              <Activity className="w-5 h-5" />
            </div>
            <span className="px-2.5 py-1 rounded-full bg-sky-500/15 border border-sky-500/25 text-[10px] font-mono font-bold text-sky-300 flex items-center gap-1">
              <span>Raporu Gör</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>

          <div>
            <span className="text-3xl font-black font-mono text-white tracking-tight block">
              {selectedRun?.duration_seconds ? `${selectedRun.duration_seconds} sn` : 'Tamam'}
            </span>
            <span className="text-xs font-bold text-sky-200 mt-0.5 block">
              Çalışma Süresi & Durum
            </span>
            <p className="text-[11px] text-white/50 mt-1 leading-snug">
              {selectedRun?.status === 'completed'
                ? 'Başarıyla tamamlandı ve R2’ye yedeklendi.'
                : selectedRun?.status === 'running'
                ? 'İşlem arka planda devam ediyor...'
                : 'Son çalışma sağlığı doğrulanıyor.'}
            </p>
          </div>

          <div className="pt-2 border-t border-white/[0.06] text-[10px] font-mono text-sky-300/80 flex items-center justify-between">
            <span>Tetikleyici: {selectedRun?.trigger_type || 'cron'}</span>
            <span className="underline group-hover:text-sky-200">Detaylı Log</span>
          </div>
        </motion.button>
      </div>

      {/* ================= RUN SELECTOR / HISTORY CAROUSEL ================= */}
      {runs.length > 1 && (
        <div className="p-4 rounded-3xl apple-glass border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white">İncelenen Otomasyon Çalışması:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {runs.slice(0, 5).map((run, idx) => {
              const isSelected = selectedRun?.id === run.id;
              const dateLabel = run.started_at
                ? new Date(run.started_at).toLocaleDateString('tr-TR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : `Çalışma #${run.id}`;

              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRun(run)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-emerald-500 text-black border-emerald-400 shadow-md font-bold'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {idx === 0 ? `En Son (${dateLabel})` : dateLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= BOT CONTROLS GRID (ENABLE/DISABLE IN 12H CRON) ================= */}
      <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-emerald-400" />
              <span>12 Saatlik Otomasyona Dahil Edilen Botlar</span>
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              Aşağıdaki anahtarlar ile botların 12 saatlik otomatik cron döngüsünde çalışıp çalışmayacağını kontrol edebilirsiniz.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleToggleAllScrapers(true)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs cursor-pointer transition-all"
            >
              Tümünü Aç
            </button>
            <button
              type="button"
              onClick={() => handleToggleAllScrapers(false)}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white font-semibold text-xs cursor-pointer transition-all"
            >
              Tümünü Kapat
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {localScrapers.map((bot) => {
            const isRunning = runningScraperId === bot.id;
            const brand = SCRAPER_BRANDS[bot.id];

            return (
              <div
                key={bot.id}
                className="p-5 rounded-3xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between gap-5 group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`px-3 py-1.5 rounded-2xl bg-gradient-to-br ${
                          brand?.bgGradient || 'from-sky-500/25 to-blue-900/40'
                        } border ${brand?.borderGlow || 'border-white/20'} flex items-center gap-2 shrink-0`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${
                            bot.is_enabled ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                          }`}
                        />
                        <span
                          className={`text-[11px] font-black tracking-wider uppercase font-mono ${
                            brand?.textColor || 'text-white'
                          }`}
                        >
                          {brand?.logoText || bot.name.slice(0, 8)}
                        </span>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                          {bot.name}
                        </h3>
                        {brand?.category && (
                          <span className="text-[10px] font-mono text-white/50 block">
                            {brand.category}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Enable/Disable Toggle */}
                    <button
                      type="button"
                      onClick={() => handleToggleScraperInCron(bot.id, bot.is_enabled)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-mono font-bold transition-all cursor-pointer border ${
                        bot.is_enabled
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border-rose-400/40 hover:bg-rose-500/30'
                      }`}
                    >
                      {bot.is_enabled ? '12s Cron’da Aktif' : 'Devre Dışı (Atlanır)'}
                    </button>
                  </div>

                  <p className="text-xs text-white/60 leading-relaxed">
                    {bot.notes || brand?.protocol}
                  </p>

                  {brand?.domain && (
                    <div className="flex items-center gap-2">
                      <a
                        href={brand.domain}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        <Globe className="w-3 h-3" />
                        <span>{brand.domain.replace('https://', '')}</span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/80">
                      {(bot.items_synced || 0).toLocaleString('tr-TR')} Senkron
                    </span>
                    <span className="text-[11px] font-mono text-white/40">
                      {bot.last_run_at ? formatTimeAgo(bot.last_run_at) : 'Beklemede'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenScraperDetail(bot.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5 text-sky-400" />
                      <span>Detay & Konsol</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRunSingleScraper(bot.id)}
                      disabled={isRunning || isAutomationRunning}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all cursor-pointer shadow ${
                        isRunning
                          ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40 animate-pulse'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {isRunning ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Çalışıyor...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-emerald-300" />
                          <span>Tek Başına Çalıştır</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ================= CRON EXECUTION HISTORY TABLE ================= */}
      {runs.length > 0 && (
        <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-sky-400" />
              <span>Geçmiş Otomasyon Çalışma Günlüğü</span>
            </h2>
            <span className="text-xs font-mono text-white/50">Son {runs.length} Kayıt</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/10 text-white/50">
                  <th className="pb-3 font-semibold">Çalışma ID / Tarih</th>
                  <th className="pb-3 font-semibold">Tetikleyici</th>
                  <th className="pb-3 font-semibold">Süre</th>
                  <th className="pb-3 font-semibold">Yeni Seri</th>
                  <th className="pb-3 font-semibold">Yeni Bölüm</th>
                  <th className="pb-3 font-semibold">Eklenen Kaynak</th>
                  <th className="pb-3 font-semibold">Durum</th>
                  <th className="pb-3 font-semibold text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {runs.map((r) => {
                  const isCurrent = selectedRun?.id === r.id;
                  const dateStr = r.started_at
                    ? new Date(r.started_at).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-';

                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-white/[0.03] transition-colors ${
                        isCurrent ? 'bg-white/[0.04]' : ''
                      }`}
                    >
                      <td className="py-3 text-white font-bold flex items-center gap-2">
                        {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                        <span>{r.run_id}</span>
                        <span className="text-white/40 font-normal">({dateStr})</span>
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-white/70 text-[10px]">
                          {r.trigger_type === 'cron'
                            ? '12s Cron'
                            : r.trigger_type === 'admin_trigger'
                            ? 'Admin Paneli'
                            : r.trigger_type}
                        </span>
                      </td>
                      <td className="py-3 text-white/70">
                        {r.duration_seconds ? `${r.duration_seconds}s` : '-'}
                      </td>
                      <td className="py-3 text-purple-300 font-bold">
                        +{r.total_dramas_added}
                      </td>
                      <td className="py-3 text-emerald-300 font-bold">
                        +{r.total_episodes_added}
                      </td>
                      <td className="py-3 text-amber-300 font-bold">
                        +{r.total_sources_added}
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            r.status === 'completed'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : r.status === 'running'
                              ? 'bg-sky-500/20 text-sky-300 animate-pulse'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {r.status === 'completed'
                            ? 'Başarılı'
                            : r.status === 'running'
                            ? 'İşleniyor'
                            : 'Hata'}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRun(r);
                            setActiveModal('run_details');
                          }}
                          className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold cursor-pointer transition-all"
                        >
                          İncele
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ================= MODAL 1: YENİ EKLENEN SERİLER ================= */}
      <AnimatePresence>
        {activeModal === 'series' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-4xl max-h-[85vh] rounded-3xl apple-glass border border-white/20 flex flex-col overflow-hidden shadow-2xl bg-[#0f1117]"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Yeni Eklenen Seriler</span>
                      <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-mono">
                        {filteredDramas.length} Seri
                      </span>
                    </h3>
                    <p className="text-xs text-white/50">
                      Çalışma: {selectedRun?.run_id || 'En Son'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Filters Bar */}
              <div className="p-4 border-b border-white/[0.06] bg-white/[0.02] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Seri adı veya slug ara..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-400"
                  />
                </div>

                <div className="flex items-center gap-1.5 self-start sm:self-auto">
                  {(['all', 'dizi', 'film', 'anime'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                        typeFilter === t
                          ? 'bg-purple-500 text-white'
                          : 'bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      {t === 'all' ? 'Hepsi' : formatContentTypeTR(t)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Series List */}
              <div className="p-6 overflow-y-auto space-y-3 flex-1">
                {filteredDramas.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-xs">
                    Aranan kriterlere uygun yeni eklenen seri bulunamadı.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {filteredDramas.map((d, idx) => (
                      <div
                        key={d.id || idx}
                        className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-white/20 transition-all flex items-center gap-3 group"
                      >
                        <div className="w-12 h-16 rounded-xl bg-black/50 overflow-hidden shrink-0 border border-white/10 relative">
                          <img
                            src={getProxiedImageUrl(d.cover_image)}
                            alt={d.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-white truncate group-hover:text-purple-300 transition-colors">
                            {d.title}
                          </h4>

                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] text-white/50">
                            {d.country_code && <CountryFlag code={d.country_code} />}
                            <span>{d.release_year || '2026'}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70">
                              {formatContentTypeTR(d.content_type || 'dizi')}
                            </span>
                            {d.site && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                                {d.site}
                              </span>
                            )}
                          </div>

                          <div className="mt-2">
                            <Link
                              href={`/seri/${d.slug}`}
                              target="_blank"
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 transition-colors"
                            >
                              <span>Seriye Git</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL 2: YENİ EKLENEN BÖLÜMLER ================= */}
      <AnimatePresence>
        {activeModal === 'episodes' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-4xl max-h-[85vh] rounded-3xl apple-glass border border-white/20 flex flex-col overflow-hidden shadow-2xl bg-[#0f1117]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <Tv className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Yeni Eklenen Bölümler</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-mono">
                        {filteredEpisodes.length} Bölüm
                      </span>
                    </h3>
                    <p className="text-xs text-white/50">
                      Çalışma: {selectedRun?.run_id || 'En Son'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="p-4 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="relative w-full sm:w-80">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Dizi adı veya bölüm ara..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              {/* Episodes List */}
              <div className="p-6 overflow-y-auto space-y-2.5 flex-1">
                {filteredEpisodes.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-xs">
                    Aranan kriterlere uygun bölüm bulunamadı.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {filteredEpisodes.map((ep, idx) => (
                      <div
                        key={ep.id || idx}
                        className="py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] px-2 rounded-xl transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold shrink-0">
                              S{ep.season_number}E{ep.episode_number}
                            </span>
                            <span className="text-xs font-bold text-white truncate">
                              {ep.drama_title || 'Bilinmeyen Seri'}
                            </span>
                          </div>
                          <span className="text-[11px] text-white/50 mt-0.5 block truncate">
                            {ep.episode_name || `${ep.episode_number}. Bölüm`}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {ep.drama_slug && (
                            <Link
                              href={`/seri/${ep.drama_slug}/${ep.episode_number}`}
                              target="_blank"
                              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1 transition-all"
                            >
                              <span>Bölümü Aç</span>
                              <ExternalLink className="w-3 h-3 text-emerald-400" />
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL 3: EKLENEN CANLI KAYNAKLAR ================= */}
      <AnimatePresence>
        {activeModal === 'sources' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-4xl max-h-[85vh] rounded-3xl apple-glass border border-white/20 flex flex-col overflow-hidden shadow-2xl bg-[#0f1117]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Eklenen Oynatma Kaynakları</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono">
                        {filteredSources.length} Kaynak
                      </span>
                    </h3>
                    <p className="text-xs text-white/50">
                      Çalışma: {selectedRun?.run_id || 'En Son'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Filters */}
              <div className="p-4 border-b border-white/[0.06] bg-white/[0.02] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Seri, kaynak veya provider ara..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400"
                  />
                </div>

                {availableProviders.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
                    <button
                      type="button"
                      onClick={() => setProviderFilter('all')}
                      className={`px-2.5 py-1 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                        providerFilter === 'all'
                          ? 'bg-amber-500 text-black font-bold'
                          : 'bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      Tüm Sağlayıcılar
                    </button>
                    {availableProviders.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setProviderFilter(p)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-mono font-semibold cursor-pointer transition-all ${
                          providerFilter === p
                            ? 'bg-amber-500 text-black font-bold'
                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Sources List */}
              <div className="p-6 overflow-y-auto space-y-2.5 flex-1">
                {filteredSources.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-xs">
                    Aranan kriterlere uygun kaynak bulunamadı.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {filteredSources.map((src, idx) => (
                      <div
                        key={src.id || idx}
                        className="py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] px-2 rounded-xl transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono text-[11px] font-bold shrink-0">
                              {src.provider || 'Akış'}
                            </span>
                            <span className="text-xs font-bold text-white truncate">
                              {src.drama_title || 'Bilinmeyen Seri'}
                            </span>
                            {src.season_number && src.episode_number && (
                              <span className="text-[10px] font-mono text-white/40">
                                (S{src.season_number}E{src.episode_number})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/50">
                            <span>Kaynak: {src.source_name || '1080p Orijinal'}</span>
                            {src.site && <span>• Site: {src.site}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {src.drama_slug && src.episode_number && (
                            <Link
                              href={`/seri/${src.drama_slug}/${src.episode_number}`}
                              target="_blank"
                              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1 transition-all"
                            >
                              <span>Oynat</span>
                              <ExternalLink className="w-3 h-3 text-amber-400" />
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL 4: DETAYLI ÇALIŞMA RAPORU & LOGLAR ================= */}
      <AnimatePresence>
        {activeModal === 'run_details' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="w-full max-w-3xl max-h-[85vh] rounded-3xl apple-glass border border-white/20 flex flex-col overflow-hidden shadow-2xl bg-[#0f1117]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-sky-500/20 text-sky-300 border border-sky-500/30">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>Otomasyon Çalışma Raporu</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/70 text-xs font-mono">
                        {selectedRun?.run_id || 'Kayıt'}
                      </span>
                    </h3>
                    <p className="text-xs text-white/50">
                      Tetikleyici: {selectedRun?.trigger_type || 'cron'} • Durum:{' '}
                      {selectedRun?.status === 'completed' ? 'Başarılı' : 'İşleniyor'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {/* Metrics Summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                    <span className="text-[10px] font-mono text-white/50 block">Eklenen Seri</span>
                    <span className="text-xl font-bold font-mono text-purple-300">
                      +{selectedRun?.total_dramas_added || 0}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                    <span className="text-[10px] font-mono text-white/50 block">Eklenen Bölüm</span>
                    <span className="text-xl font-bold font-mono text-emerald-300">
                      +{selectedRun?.total_episodes_added || 0}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-center">
                    <span className="text-[10px] font-mono text-white/50 block">Eklenen Kaynak</span>
                    <span className="text-xl font-bold font-mono text-amber-300">
                      +{selectedRun?.total_sources_added || 0}
                    </span>
                  </div>
                </div>

                {/* Per Scraper Breakdown */}
                {selectedRun?.scrapers_summary &&
                  Object.keys(selectedRun.scrapers_summary).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                        Bot Bazında İşlem Özeti
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {Object.entries(selectedRun.scrapers_summary).map(([botKey, s]: any) => (
                          <div
                            key={botKey}
                            className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-between text-xs"
                          >
                            <div>
                              <span className="font-bold text-white block capitalize">
                                {s.label || botKey}
                              </span>
                              <span className="text-[10px] text-white/50 font-mono">
                                Süre: {s.duration_seconds || 0}s • İşlenen: {s.items_processed || 0}
                              </span>
                            </div>
                            <div className="text-right font-mono text-[11px]">
                              <span className="text-purple-300">+{s.dramas_added || 0}S</span>{' '}
                              <span className="text-emerald-300">+{s.episodes_added || 0}B</span>{' '}
                              <span className="text-amber-300">+{s.sources_added || 0}K</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Full Logs Terminal */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                      Otomasyon Terminal Günlüğü
                    </h4>
                    {selectedRun?.logs && selectedRun.logs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(selectedRun.logs?.join('\n') || '');
                          pushNotification('Kopyalandı', 'Loglar panoya kopyalandı.', 'success');
                        }}
                        className="text-[10px] font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Logları Kopyala</span>
                      </button>
                    )}
                  </div>

                  <div className="p-4 rounded-2xl bg-black/90 border border-white/10 font-mono text-[11px] max-h-64 overflow-y-auto space-y-1 text-white/70">
                    {selectedRun?.logs && selectedRun.logs.length > 0 ? (
                      selectedRun.logs.map((line: string, i: number) => (
                        <div
                          key={i}
                          className={
                            line.includes('[HATA]')
                              ? 'text-rose-400'
                              : line.includes('[AKINCI]') || line.includes('[SONUÇ]')
                              ? 'text-emerald-300'
                              : ''
                          }
                        >
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="text-white/40">Bu çalışma için kayıtlı log bulunamadı.</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
