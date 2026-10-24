'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Workflow,
  Search,
  Plus,
  RefreshCw,
  Play,
  Check,
  X,
  ExternalLink,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Tv,
  Film,
  Sparkles,
  Layers,
  Clock,
  Trash2,
  Settings,
  ChevronRight,
  ChevronDown,
  Globe,
  SlidersHorizontal,
  Power,
  Info,
  Radio,
  Compass,
  Edit2,
} from 'lucide-react';
import { getProxiedImageUrl, formatContentTypeTR } from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import { adminFetch } from '@/lib/adminClient';
import KoupInput from '@/components/KoupInput';

export interface AutomatedSeriesItem {
  media_id: number;
  title: string;
  slug: string;
  poster_url?: string;
  content_type?: string;
  status_broadcast?: string;
  episode_count: number;
  sources_count: number;
  is_active: boolean;
  connected_sites: string[];
  site_slugs: Record<string, string>;
  last_synced_at?: string | null;
  last_status: string;
  last_message?: string | null;
  last_episodes_added?: number;
  last_sources_added?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CatalogSearchResult {
  id: number;
  title: string;
  slug: string;
  cover_image?: string;
  content_type?: string;
  status_broadcast?: string;
  episode_count: number;
  sources_count: number;
  release_year?: number;
  is_automated: boolean;
  connected_sites: string[];
  site_slugs: Record<string, string>;
}

export interface LiveSearchResult {
  site: string;
  site_name: string;
  badge: string;
  title: string;
  slug: string;
  url: string;
  cover_image?: string | null;
}

const ALL_SUPPORTED_SITES = [
  { id: 'asyawatch', name: 'AsyaWatch', badge: '1080p HLS', color: 'from-sky-500/20 to-blue-600/20 text-sky-300 border-sky-500/30' },
  { id: 'dizikorea', name: 'DiziKorea', badge: 'PlayerDKorea', color: 'from-amber-500/20 to-orange-600/20 text-amber-300 border-amber-500/30' },
  { id: 'dizifon', name: 'DiziFon', badge: 'OK.ru / Vidmoly', color: 'from-violet-500/20 to-purple-600/20 text-violet-300 border-violet-500/30' },
  { id: 'dizibox', name: 'DiziBox', badge: 'DBX Pro HLS', color: 'from-emerald-500/20 to-teal-600/20 text-emerald-300 border-emerald-500/30' },
  { id: 'dizilla', name: 'Dizilla', badge: '1080p Native', color: 'from-rose-500/20 to-pink-600/20 text-rose-300 border-rose-500/30' },
  { id: 'animecix', name: 'AnimeciX', badge: 'Tau-Video', color: 'from-cyan-500/20 to-indigo-600/20 text-cyan-300 border-cyan-500/30' },
  { id: 'ddizi', name: 'DDizi', badge: 'YouTube HD', color: 'from-red-500/20 to-rose-600/20 text-red-300 border-red-500/30' },
  { id: 'hdfilm', name: 'HDFilmcehennemi', badge: 'Rapidrame HLS', color: 'from-amber-600/20 to-red-600/20 text-amber-400 border-amber-600/30' },
];

function cleanDisplayTitle(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^★[\d.]+\s*/i, '')
    .replace(/\b(izle|hdfilmcehennemi|film izle|dizi izle|türkçe dublaj|türkçe altyazılı|kore dizisi|kore|japon|tayland|çin|d1)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function AdminSeriesAutomation() {
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);

  const [automations, setAutomations] = useState<AutomatedSeriesItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'ongoing' | 'idle'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalTab, setAddModalTab] = useState<'catalog' | 'live' | 'manual'>('catalog');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [catalogResults, setCatalogResults] = useState<CatalogSearchResult[]>([]);
  const [liveResults, setLiveResults] = useState<LiveSearchResult[]>([]);
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogSearchResult | null>(null);
  const [selectedLiveItem, setSelectedLiveItem] = useState<LiveSearchResult | null>(null);

  // Manual Creation State
  const [manualTitle, setManualTitle] = useState('');
  const [manualSlug, setManualSlug] = useState('');
  const [manualContentType, setManualContentType] = useState<'dizi' | 'anime' | 'film'>('dizi');
  const [manualSite, setManualSite] = useState('asyawatch');

  // Selected Sites & Slugs for Addition
  const [addSites, setAddSites] = useState<string[]>(['asyawatch', 'dizikorea', 'dizifon']);
  const [addSiteSlugs, setAddSiteSlugs] = useState<Record<string, string>>({});
  const [isAddingSaving, setIsAddingSaving] = useState(false);

  // Slug Edit Modal State
  const [editingSeries, setEditingSeries] = useState<AutomatedSeriesItem | null>(null);
  const [editingSlugs, setEditingSlugs] = useState<Record<string, string>>({});
  const [isResolvingSlugs, setIsResolvingSlugs] = useState(false);
  const [slugVerificationResults, setSlugVerificationResults] = useState<Record<string, any>>({});

  // Sync / Execution Terminal Drawer
  const [activeSyncingId, setActiveSyncingId] = useState<number | 'all' | null>(null);
  const [showLogsDrawer, setShowLogsDrawer] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncTitle, setSyncTitle] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load Automations
  const loadAutomations = async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/series-automation', { cache: 'no-store' });
      const data = await res.json();
      if (data.automations) {
        setAutomations(data.automations);
      }
    } catch (err: any) {
      pushNotification('Hata', 'Seri otomasyonları yüklenemedi: ' + err.message, 'system');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAutomations();
  }, []);

  // Multi-Site & Catalog Search Debounced
  useEffect(() => {
    if (!showAddModal || searchTerm.trim().length < 2) {
      setCatalogResults([]);
      setLiveResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await adminFetch(
          `/api/admin/series-automation/search?q=${encodeURIComponent(searchTerm.trim())}`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        setCatalogResults(data.catalog || []);
        setLiveResults(data.live_sites || []);

        // Auto switch tab if catalog empty but live sites found
        if ((!data.catalog || data.catalog.length === 0) && data.live_sites && data.live_sites.length > 0) {
          setAddModalTab('live');
        }
      } catch (e) {
        setCatalogResults([]);
        setLiveResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm, showAddModal]);

  // Toggle Active/Inactive
  const handleToggleActive = async (item: AutomatedSeriesItem) => {
    const nextVal = !item.is_active;
    setAutomations((prev) =>
      prev.map((a) => (a.media_id === item.media_id ? { ...a, is_active: nextVal } : a))
    );

    try {
      const res = await adminFetch('/api/admin/series-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_id: item.media_id,
          title: item.title,
          slug: item.slug,
          is_active: nextVal,
          connected_sites: item.connected_sites,
          site_slugs: item.site_slugs,
        }),
      });
      if (res.ok) {
        pushNotification(
          nextVal ? 'Otomasyon Aktifleştirildi' : 'Otomasyon Duraklatıldı',
          `${item.title} için otomatik tarama ${nextVal ? 'açıldı' : 'kapatıldı'}.`,
          'info'
        );
      }
    } catch {
      loadAutomations();
    }
  };

  // Toggle Connected Site for a Series
  const handleToggleSite = async (item: AutomatedSeriesItem, siteId: string) => {
    const exists = item.connected_sites.includes(siteId);
    let nextSites = exists
      ? item.connected_sites.filter((s) => s !== siteId)
      : [...item.connected_sites, siteId];

    if (nextSites.length === 0) {
      pushNotification('Uyarı', 'En az 1 bağlı site kalmalıdır.', 'info');
      return;
    }

    setAutomations((prev) =>
      prev.map((a) => (a.media_id === item.media_id ? { ...a, connected_sites: nextSites } : a))
    );

    try {
      await adminFetch('/api/admin/series-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_id: item.media_id,
          title: item.title,
          slug: item.slug,
          is_active: item.is_active,
          connected_sites: nextSites,
          site_slugs: item.site_slugs,
        }),
      });
      pushNotification('Siteler Güncellendi', `${item.title} için bağlı kaynak siteleri güncellendi.`, 'info');
    } catch {
      loadAutomations();
    }
  };

  // Delete from Automation
  const handleDeleteSeries = async (item: AutomatedSeriesItem) => {
    const ok = await confirmDialog({
      title: 'Seriyi Otomasyondan Çıkar',
      message: `"${item.title}" serisi otomatik tarama havuzundan kaldırılacaktır. Dizinin kendisi veya mevcut bölümleri silinmez, yalnızca haftalık otomatik kontrol sona erer.`,
      confirmText: 'Otomasyondan Çıkar',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      const res = await adminFetch(`/api/admin/series-automation?media_id=${item.media_id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setAutomations((prev) => prev.filter((a) => a.media_id !== item.media_id));
        pushNotification('Kaldırıldı', `"${item.title}" otomasyon listesinden çıkarıldı.`, 'info');
      }
    } catch (e: any) {
      pushNotification('Hata', 'Kaldırılamadı: ' + e.message, 'system');
    }
  };

  // Add Series to Automation
  const handleConfirmAdd = async () => {
    setIsAddingSaving(true);
    try {
      let payload: any = {};

      if (addModalTab === 'catalog') {
        if (!selectedCatalogItem) return;
        payload = {
          media_id: selectedCatalogItem.id,
          title: selectedCatalogItem.title,
          slug: selectedCatalogItem.slug,
          poster_url: selectedCatalogItem.cover_image,
          content_type: selectedCatalogItem.content_type,
          status_broadcast: selectedCatalogItem.status_broadcast,
          is_active: true,
          connected_sites: addSites,
          site_slugs: addSiteSlugs,
        };
      } else if (addModalTab === 'live') {
        if (!selectedLiveItem) return;
        const cleanTitle = cleanDisplayTitle(selectedLiveItem.title);
        payload = {
          media_id: 'new',
          title: cleanTitle,
          slug: selectedLiveItem.slug,
          site: selectedLiveItem.site,
          connected_sites: addSites,
          site_slugs: {
            ...addSiteSlugs,
            [selectedLiveItem.site]: selectedLiveItem.slug,
          },
          poster_url: selectedLiveItem.cover_image,
          content_type: selectedLiveItem.site === 'animecix' ? 'anime' : 'dizi',
          status_broadcast: 'Devam Ediyor',
          is_active: true,
        };
      } else if (addModalTab === 'manual') {
        if (!manualTitle.trim()) {
          pushNotification('Eksik Bilgi', 'Dizi başlığı girmelisin.', 'info');
          return;
        }
        const candidateSlug = (manualSlug.trim() || manualTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
        payload = {
          media_id: 'new',
          title: manualTitle.trim(),
          slug: candidateSlug,
          site: manualSite,
          connected_sites: addSites,
          site_slugs: {
            ...addSiteSlugs,
            [manualSite]: candidateSlug,
          },
          content_type: manualContentType,
          status_broadcast: 'Devam Ediyor',
          is_active: true,
        };
      }

      const res = await adminFetch('/api/admin/series-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (res.ok) {
        pushNotification('Başarılı', resData.message || 'Seri otomasyona bağlandı.', 'info');
        setShowAddModal(false);
        setSelectedCatalogItem(null);
        setSelectedLiveItem(null);
        setSearchTerm('');
        setManualTitle('');
        setManualSlug('');
        loadAutomations();
      } else {
        pushNotification('Hata', resData.error || 'Eklenemedi.', 'system');
      }
    } catch (e: any) {
      pushNotification('Hata', 'Eklenemedi: ' + e.message, 'system');
    } finally {
      setIsAddingSaving(false);
    }
  };

  // Auto-resolve real slugs across connected sites
  const handleAutoResolveSlugs = async () => {
    if (!editingSeries) return;
    setIsResolvingSlugs(true);
    try {
      const res = await adminFetch('/api/admin/series-automation/resolve-slugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingSeries.title,
          drama_id: editingSeries.media_id,
          connected_sites: editingSeries.connected_sites,
        }),
      });
      const data = await res.json();
      if (data.ok && data.results) {
        setSlugVerificationResults(data.results);
        if (data.suggested_slugs && Object.keys(data.suggested_slugs).length > 0) {
          setEditingSlugs((prev) => ({
            ...prev,
            ...data.suggested_slugs,
          }));
          pushNotification(
            'Doğrulama Başarılı',
            `${Object.keys(data.suggested_slugs).length} sitede özel slug tespit edildi ve form dolduruldu.`,
            'info'
          );
        } else {
          pushNotification('Bilgi', 'Sitelerde özel isim eki tespit edilmedi, varsayılan slug geçerli.', 'info');
        }
      } else {
        pushNotification('Hata', data.error || 'Siteler taranamadı', 'system');
      }
    } catch (e: any) {
      pushNotification('Hata', 'İstek başarısız: ' + e.message, 'system');
    } finally {
      setIsResolvingSlugs(false);
    }
  };

  // Save Slug Overrides
  const handleSaveSlugs = async () => {
    if (!editingSeries) return;
    try {
      const res = await adminFetch('/api/admin/series-automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_id: editingSeries.media_id,
          title: editingSeries.title,
          slug: editingSeries.slug,
          is_active: editingSeries.is_active,
          connected_sites: editingSeries.connected_sites,
          site_slugs: editingSlugs,
        }),
      });
      if (res.ok) {
        pushNotification('Kaydedildi', 'Özel site adresleri/slug tanımları güncellendi.', 'info');
        setEditingSeries(null);
        setSlugVerificationResults({});
        loadAutomations();
      }
    } catch (e: any) {
      pushNotification('Hata', 'Kaydedilemedi: ' + e.message, 'system');
    }
  };

  // Run Sync
  const handleRunSync = async (item?: AutomatedSeriesItem) => {
    const isAll = !item;
    setActiveSyncingId(isAll ? 'all' : item.media_id);
    setSyncTitle(isAll ? 'Tüm Aktif Seriler Çapraz Taranıyor' : `${item.title} Çapraz Taranıyor`);
    setSyncLogs([]);
    setShowLogsDrawer(true);

    try {
      const res = await adminFetch('/api/admin/series-automation/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dramaId: item ? item.media_id : undefined,
          allActive: isAll,
        }),
      });

      if (!res.body) {
        throw new Error('Yanıt akışı başlatılamadı.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'log') {
              setSyncLogs((prev) => [...prev, ev.line]);
            } else if (ev.type === 'result' && ev.data) {
              const r = ev.data;
              pushNotification(
                'Tarama Tamamlandı',
                `${r.title || 'Seri'}: +${r.episodesAdded || 0} Bölüm | +${r.sourcesAdded || 0} Kaynak`,
                'info'
              );
            } else if (ev.type === 'done') {
              setSyncLogs((prev) => [...prev, `[SİSTEM] İşlem tamamlandı (Kod: ${ev.exitCode}).`]);
            }
          } catch {
            setSyncLogs((prev) => [...prev, line]);
          }
        }
      }
      loadAutomations();
    } catch (err: any) {
      setSyncLogs((prev) => [...prev, `[KRİTİK HATA] ${err.message}`]);
      pushNotification('Hata', 'Tarama sırasında sorun oluştu: ' + err.message, 'system');
    } finally {
      setActiveSyncingId(null);
    }
  };

  // Scroll to bottom of terminal
  useEffect(() => {
    if (showLogsDrawer && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [syncLogs, showLogsDrawer]);

  // Filtered List
  const filteredAutomations = useMemo(() => {
    return automations.filter((item) => {
      if (filterMode === 'active' && !item.is_active) return false;
      if (filterMode === 'ongoing' && !item.status_broadcast?.toLowerCase().includes('devam')) return false;
      if (filterMode === 'idle' && item.is_active) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.title.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q);
      }
      return true;
    });
  }, [automations, filterMode, searchQuery]);

  // Overall Stats
  const stats = useMemo(() => {
    const total = automations.length;
    const active = automations.filter((a) => a.is_active).length;
    const ongoing = automations.filter((a) => a.status_broadcast?.toLowerCase().includes('devam')).length;
    const totalEps = automations.reduce((acc, a) => acc + (a.episode_count || 0), 0);
    const totalSrcs = automations.reduce((acc, a) => acc + (a.sources_count || 0), 0);
    return { total, active, ongoing, totalEps, totalSrcs };
  }, [automations]);

  return (
    <div className="space-y-6">
      {/* 1. HEADER STATS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-[#0f0f11] border border-white/[0.08] shadow-lg">
          <div className="flex items-center justify-between text-white/50 text-xs font-medium">
            <span>Bağlı Seriler</span>
            <Workflow className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1">{stats.total}</div>
          <div className="text-[11px] text-white/40 mt-0.5">Otomasyon havuzunda</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0f0f11] border border-white/[0.08] shadow-lg">
          <div className="flex items-center justify-between text-white/50 text-xs font-medium">
            <span>Aktif Taranan</span>
            <Power className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{stats.active}</div>
          <div className="text-[11px] text-emerald-400/60 mt-0.5">Cron & anlık taramaya açık</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0f0f11] border border-white/[0.08] shadow-lg">
          <div className="flex items-center justify-between text-white/50 text-xs font-medium">
            <span>Devam Eden (Canlı)</span>
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 mt-1">{stats.ongoing}</div>
          <div className="text-[11px] text-white/40 mt-0.5">Haftalık yeni bölüm bekleyen</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0f0f11] border border-white/[0.08] shadow-lg">
          <div className="flex items-center justify-between text-white/50 text-xs font-medium">
            <span>Toplam Akış</span>
            <Layers className="w-4 h-4 text-violet-400" />
          </div>
          <div className="text-2xl font-black text-violet-300 mt-1">{stats.totalSrcs}</div>
          <div className="text-[11px] text-white/40 mt-0.5">{stats.totalEps} Bölümde hazır</div>
        </div>
      </div>

      {/* 2. ACTION BAR & FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-[#0f0f11] border border-white/[0.08]">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <KoupInput
            type="text"
            placeholder="Bağlı serilerde filtrele (isim / slug)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
            clearable
            onClear={() => setSearchQuery('')}
            size="sm"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'Tümü' },
            { id: 'active', label: 'Yalnızca Aktifler' },
            { id: 'ongoing', label: 'Devam Edenler' },
            { id: 'idle', label: 'Duraklatılanlar' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterMode(f.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                filterMode === f.id
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.08]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleRunSync()}
            disabled={activeSyncingId !== null || stats.active === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${activeSyncingId === 'all' ? 'animate-spin' : ''}`} />
            <span>Tüm Aktifleri Tara</span>
          </button>

          <button
            onClick={() => {
              setShowAddModal(true);
              setSearchTerm('');
              setSelectedCatalogItem(null);
              setSelectedLiveItem(null);
              setAddModalTab('catalog');
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 shadow-lg transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Seri Bağla</span>
          </button>
        </div>
      </div>

      {/* 3. SERIES LIST / CARDS */}
      {isLoading ? (
        <div className="p-12 text-center text-white/50 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-sky-400" />
          <span>Seri otomasyonları yükleniyor...</span>
        </div>
      ) : filteredAutomations.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
          <Workflow className="w-12 h-12 text-white/20 mx-auto mb-3" />
          <div className="text-white font-semibold text-base">Henüz otomasyona bağlı seri bulunmuyor</div>
          <p className="text-white/40 text-xs mt-1 max-w-md mx-auto">
            Yukarıdaki &ldquo;Yeni Seri Bağla&rdquo; butonuna tıklayarak katalog içi veya canlı sitelerdeki herhangi bir yapımı
            AsyaWatch, DiziKorea, DiziFon vb. sitelerle eşleyip otomatik taramaya bağlayabilirsin.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredAutomations.map((item) => {
            const isSyncingThis = activeSyncingId === item.media_id;
            const isOngoing = item.status_broadcast?.toLowerCase().includes('devam');

            return (
              <motion.div
                key={item.media_id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-4 rounded-2xl bg-[#0f0f11] border transition-all ${
                  item.is_active
                    ? 'border-white/10 hover:border-white/20'
                    : 'border-white/[0.04] opacity-65 bg-black/40'
                }`}
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  {/* Left Info */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Poster */}
                    <div className="w-12 h-16 rounded-xl overflow-hidden bg-black/60 shrink-0 border border-white/10 relative">
                      {item.poster_url ? (
                        <img
                          src={getProxiedImageUrl(item.poster_url)}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/30 text-[10px]">
                          Foto Yok
                        </div>
                      )}
                      {isOngoing && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-black animate-pulse" />
                      )}
                    </div>

                    {/* Titles & Counts */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white hover:text-sky-300 transition-colors truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.08] text-white/70">
                          #{item.media_id}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isOngoing
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-white/10 text-white/60'
                          }`}
                        >
                          {item.status_broadcast || 'Dizi'}
                        </span>
                      </div>

                      {/* Stats & Last Synced */}
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50 flex-wrap">
                        <span className="font-mono text-white/80 font-medium">
                          {item.episode_count} Bölüm • {item.sources_count} Kaynak
                        </span>
                        <span>•</span>
                        <span className="text-white/40 text-[11px]">
                          {item.last_synced_at
                            ? `Son Tarama: ${new Date(item.last_synced_at).toLocaleString('tr-TR', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : 'Henüz taranmadı'}
                        </span>
                        {item.last_message && (
                          <>
                            <span>•</span>
                            <span className="text-sky-400/80 text-[11px] truncate max-w-xs font-mono">
                              {item.last_message}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Connected Sites Interactive Pills */}
                  <div className="flex flex-col gap-1 w-full lg:w-auto">
                    <div className="text-[10px] font-mono text-white/40 flex items-center justify-between gap-2">
                      <span>BAĞLI KAYNAK SİTELERİ ({item.connected_sites.length})</span>
                      <button
                        onClick={() => {
                          setEditingSeries(item);
                          setEditingSlugs(item.site_slugs || {});
                        }}
                        className="text-sky-400 hover:text-sky-300 flex items-center gap-1 text-[10px] cursor-pointer"
                      >
                        <Settings className="w-3 h-3" />
                        <span>Slug Ayarları</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ALL_SUPPORTED_SITES.map((site) => {
                        const isConnected = item.connected_sites.includes(site.id);
                        const hasOverride = item.site_slugs && item.site_slugs[site.id];

                        return (
                          <button
                            key={site.id}
                            onClick={() => handleToggleSite(item, site.id)}
                            title={`${site.name} (${site.badge}) ${
                              hasOverride ? `[Özel Slug: ${item.site_slugs[site.id]}]` : ''
                            } - Tıklayarak aç/kapa`}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all flex items-center gap-1.5 cursor-pointer border ${
                              isConnected
                                ? `${site.color} shadow-sm font-semibold`
                                : 'bg-black/30 border-white/[0.05] text-white/30 hover:text-white/60 hover:border-white/10'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-current' : 'bg-white/20'}`} />
                            <span>{site.name}</span>
                            {hasOverride && <span className="text-[9px] opacity-75">★</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Actions & Toggle */}
                  <div className="flex items-center gap-2.5 self-end lg:self-center shrink-0">
                    {/* Toggle Active Button */}
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                        item.is_active
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                          : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{item.is_active ? 'Otomasyon Açık' : 'Kapalı'}</span>
                    </button>

                    {/* Instant Multi-site Sync */}
                    <button
                      onClick={() => handleRunSync(item)}
                      disabled={isSyncingThis || activeSyncingId !== null}
                      title="Bağlı tüm sitelerden şimdi yeni bölümleri tara"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Play className={`w-3 h-3 ${isSyncingThis ? 'animate-spin' : ''}`} />
                      <span>{isSyncingThis ? 'Taranıyor...' : 'Şimdi Çapraz Tara'}</span>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDeleteSeries(item)}
                      title="Otomasyondan Kaldır"
                      className="p-1.5 rounded-xl text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 4. MODAL: YENİ SERİ BAĞLA (KATALOG İÇİ + CANLI SİTELER + MANUEL) */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-[#0f0f11] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-sky-400" />
                  <h3 className="text-base font-bold text-white">Yeni Seriyi Otomasyona Bağla</h3>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sub-Tabs: Katalog / Canlı Siteler / Manuel */}
              <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-black/40 border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setAddModalTab('catalog');
                    setSelectedLiveItem(null);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    addModalTab === 'catalog'
                      ? 'bg-white text-black shadow-md'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>KoUp Kataloğu ({catalogResults.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAddModalTab('live');
                    setSelectedCatalogItem(null);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    addModalTab === 'live'
                      ? 'bg-white text-black shadow-md'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Canlı Siteler & Katalog Dışı ({liveResults.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAddModalTab('manual');
                    setSelectedCatalogItem(null);
                    setSelectedLiveItem(null);
                  }}
                  className={`py-1.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    addModalTab === 'manual'
                      ? 'bg-white text-black shadow-md'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Manuel</span>
                </button>
              </div>

              {/* Search Input (For catalog & live search) */}
              {addModalTab !== 'manual' && (
                <div className="space-y-1.5">
                  <KoupInput
                    type="text"
                    placeholder="Dizi veya anime adı girin (örn: Doctor X, Tales of Zestiria, Revenant)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    leftIcon={<Search className="w-4 h-4" />}
                    rightSlot={
                      isSearching ? <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" /> : undefined
                    }
                    clearable
                    onClear={() => setSearchTerm('')}
                    size="sm"
                    autoFocus
                  />
                  <div className="text-[11px] text-white/40 px-1">
                    {addModalTab === 'catalog'
                      ? 'KoUp veritabanında kayıtlı mevcut dizileri bulur.'
                      : 'AsyaWatch, DiziFon, DiziKorea, AnimeciX ve DiziBox üzerinde anlık arar. Katalogda olmayan yeni serileri doğrudan içeri aktarır.'}
                  </div>
                </div>
              )}

              {/* TAB 1: KATALOG RESULTS */}
              {addModalTab === 'catalog' && (
                <div className="flex-1 overflow-y-auto max-h-56 space-y-2 no-scrollbar pr-1">
                  {catalogResults.length === 0 ? (
                    <div className="p-8 text-center text-white/40 text-xs">
                      {searchTerm.trim().length >= 2
                        ? isSearching
                          ? 'Katalog taranıyor...'
                          : 'Katalogda eşleşen dizi bulunamadı. "Canlı Siteler & Katalog Dışı" sekmesinden arayabilirsin.'
                        : 'Aramak için yukarıya en az 2 harf yazın.'}
                    </div>
                  ) : (
                    catalogResults.map((r) => {
                      const isSelected = selectedCatalogItem?.id === r.id;
                      return (
                        <div
                          key={r.id}
                          onClick={() => {
                            setSelectedCatalogItem(r);
                            setSelectedLiveItem(null);
                            if (r.content_type === 'anime') {
                              setAddSites(['animecix', 'asyawatch']);
                            } else {
                              setAddSites(['asyawatch', 'dizikorea', 'dizifon']);
                            }
                            setAddSiteSlugs(r.site_slugs || {});
                          }}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-sky-500/15 border-sky-500/50 shadow-md'
                              : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-14 rounded-lg bg-black/60 overflow-hidden shrink-0 border border-white/10">
                              {r.cover_image && (
                                <img
                                  src={getProxiedImageUrl(r.cover_image)}
                                  alt={r.title}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">{r.title}</div>
                              <div className="text-[11px] text-white/50 mt-0.5 flex items-center gap-2">
                                <span>#{r.id}</span>
                                <span>•</span>
                                <span>{r.episode_count} Bölüm</span>
                                <span>•</span>
                                <span className="text-sky-400 font-mono">{r.status_broadcast || 'Dizi'}</span>
                              </div>
                            </div>
                          </div>

                          {isSelected ? (
                            <div className="w-6 h-6 rounded-full bg-sky-500 text-black flex items-center justify-center font-bold text-xs shrink-0">
                              <Check className="w-3.5 h-3.5" />
                            </div>
                          ) : r.is_automated ? (
                            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              Zaten Bağlı
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* TAB 2: LIVE SITES RESULTS (KATALOG DIŞI) */}
              {addModalTab === 'live' && (
                <div className="flex-1 overflow-y-auto max-h-56 space-y-2 no-scrollbar pr-1">
                  {liveResults.length === 0 ? (
                    <div className="p-8 text-center text-white/40 text-xs">
                      {searchTerm.trim().length >= 2
                        ? isSearching
                          ? 'Canlı scraper siteleri taranıyor...'
                          : 'Desteklenen sitelerde sonuç bulunamadı. "Manuel" sekmesinden doğrudan ekleyebilirsin.'
                        : 'Aramak için yukarıya dizi adını yazın.'}
                    </div>
                  ) : (
                    liveResults.map((r, i) => {
                      const isSelected = selectedLiveItem?.site === r.site && selectedLiveItem?.slug === r.slug;
                      const siteMeta = ALL_SUPPORTED_SITES.find((s) => s.id === r.site) || {
                        name: r.site_name,
                        badge: r.badge,
                        color: 'text-sky-300 border-sky-500/30',
                      };

                      return (
                        <div
                          key={`${r.site}-${r.slug}-${i}`}
                          onClick={() => {
                            setSelectedLiveItem(r);
                            setSelectedCatalogItem(null);
                            // Pre-configure this site as connected
                            setAddSites((prev) => (prev.includes(r.site) ? prev : [r.site, ...prev]));
                            setAddSiteSlugs((prev) => ({ ...prev, [r.site]: r.slug }));
                          }}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-amber-500/15 border-amber-500/50 shadow-md'
                              : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-black/60 border border-white/10 flex items-center justify-center text-amber-400 shrink-0">
                              <Globe className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">
                                {cleanDisplayTitle(r.title) || r.title}
                              </div>
                              <div className="text-[11px] text-white/50 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className={`font-semibold ${siteMeta.color.split(' ')[2] || 'text-white/80'}`}>
                                  {r.site_name}
                                </span>
                                <span>•</span>
                                <span className="text-white/40 font-mono text-[10px]">{r.slug}</span>
                                <span>•</span>
                                <span className="text-amber-400/80 font-mono text-[10px]">{r.badge}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isSelected ? (
                              <div className="w-6 h-6 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-xs">
                                <Check className="w-3.5 h-3.5" />
                              </div>
                            ) : (
                              <span className="text-[10px] text-amber-300/80 font-mono bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                                Katalog Dışı
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* TAB 3: MANUEL SERIES ENTRY */}
              {addModalTab === 'manual' && (
                <div className="space-y-3 py-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-white/70">Dizi / Yapım Başlığı *</label>
                      <KoupInput
                        type="text"
                        placeholder="Örn: Undercover High School"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        size="sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-white/70">Özel / Aday Slug</label>
                      <KoupInput
                        type="text"
                        placeholder="örn: undercover-high-school"
                        value={manualSlug}
                        onChange={(e) => setManualSlug(e.target.value)}
                        size="sm"
                        inputClassName="font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-white/70">İçerik Türü</label>
                      <div className="flex items-center gap-2">
                        {(['dizi', 'anime', 'film'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setManualContentType(t);
                              if (t === 'anime') {
                                setAddSites(['animecix', 'asyawatch']);
                                setManualSite('animecix');
                              } else {
                                setAddSites(['asyawatch', 'dizikorea', 'dizifon']);
                                setManualSite('asyawatch');
                              }
                            }}
                            className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                              manualContentType === t
                                ? 'bg-white text-black border-white shadow-sm'
                                : 'bg-black/40 text-white/50 border-white/10 hover:text-white'
                            }`}
                          >
                            {t === 'dizi' ? 'Dizi' : t === 'anime' ? 'Anime' : 'Film'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-white/70">Birincil Keşif Sitesi</label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ALL_SUPPORTED_SITES.slice(0, 4).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setManualSite(s.id)}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all border cursor-pointer ${
                              manualSite === s.id
                                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold'
                                : 'bg-black/40 text-white/40 border-white/10'
                            }`}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Select Connected Scraper Sites */}
              {(selectedCatalogItem || selectedLiveItem || addModalTab === 'manual') && (
                <div className="space-y-2 pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-white/80">
                      Bu Seri İçin Otomatik Taranacak Siteler ({addSites.length}):
                    </label>
                    <span className="text-[10px] text-white/40">Çoklu kaynak havuzu</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ALL_SUPPORTED_SITES.map((site) => {
                      const active = addSites.includes(site.id);
                      return (
                        <button
                          key={site.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setAddSites(addSites.filter((s) => s !== site.id));
                            } else {
                              setAddSites([...addSites, site.id]);
                            }
                          }}
                          className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                            active
                              ? `${site.color} border-current shadow-md font-bold`
                              : 'bg-black/40 border-white/10 text-white/40 hover:text-white/70'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{site.name}</span>
                            {active && <Check className="w-3.5 h-3.5" />}
                          </div>
                          <div className="text-[10px] opacity-75 mt-0.5">{site.badge}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white transition-colors cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAdd}
                  disabled={
                    isAddingSaving ||
                    (addModalTab === 'catalog' && !selectedCatalogItem) ||
                    (addModalTab === 'live' && !selectedLiveItem) ||
                    (addModalTab === 'manual' && !manualTitle.trim()) ||
                    addSites.length === 0
                  }
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 shadow-lg transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isAddingSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {addModalTab === 'live' || addModalTab === 'manual'
                      ? 'Kataloğa Ekle ve Otomasyona Bağla'
                      : 'Otomasyona Bağla ve Kaydet'}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. MODAL: SITE SLUG OVERRIDE SETTINGS */}
      <AnimatePresence>
        {editingSeries && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-[#0f0f11] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-sky-400" />
                  <h3 className="text-sm font-bold text-white">
                    Özel Site Adres / Slug Tanımları ({editingSeries.title})
                  </h3>
                </div>
                <button
                  onClick={() => setEditingSeries(null)}
                  className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Auto-Resolve Banner */}
              <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                    <span>Otomatik Site Adresi Doğrulama</span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed">
                    Sitelerde dizinin farklı adlandırılıp adlandırılmadığını (örn. <span className="font-mono text-sky-300">-2026</span> veya <span className="font-mono text-sky-300">-izle</span>) anında tara ve doğrulanmış adresi otomatik doldur.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isResolvingSlugs}
                  onClick={handleAutoResolveSlugs}
                  className="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-500 text-white hover:bg-sky-400 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-sky-500/20"
                >
                  {isResolvingSlugs ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isResolvingSlugs ? 'Taranıyor...' : 'Sitelerden Otomatik Bul'}</span>
                </button>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {editingSeries.connected_sites.map((siteId) => {
                  const sInfo = ALL_SUPPORTED_SITES.find((s) => s.id === siteId) || { name: siteId, badge: '' };
                  const verif = slugVerificationResults[siteId];

                  return (
                    <div key={siteId} className="space-y-1.5 p-3 rounded-2xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{sInfo.name}</span>
                          {sInfo.badge && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-white/10 text-white/60 font-mono">
                              {sInfo.badge}
                            </span>
                          )}
                          {verif && (
                            verif.found ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-mono">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Doğrulandı: {verif.slug}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-400" />
                                <span>Sitede bulunamadı</span>
                              </span>
                            )
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            const next = editingSeries.connected_sites.filter((s) => s !== siteId);
                            setEditingSeries({ ...editingSeries, connected_sites: next });
                            const nextSlugs = { ...editingSlugs };
                            delete nextSlugs[siteId];
                            setEditingSlugs(nextSlugs);
                          }}
                          className="text-[10px] text-white/40 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          Bağlantıyı Kaldır
                        </button>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-white/50 flex items-center justify-between">
                          <span>Özel Arama Slug&apos;ı:</span>
                          <span className="text-white/30 text-[10px]">
                            Varsayılan: {editingSeries.slug}
                          </span>
                        </label>
                        <KoupInput
                          type="text"
                          placeholder={editingSeries.slug}
                          value={editingSlugs[siteId] || ''}
                          onChange={(e) =>
                            setEditingSlugs({
                              ...editingSlugs,
                              [siteId]: e.target.value.trim(),
                            })
                          }
                          size="sm"
                          inputClassName="font-mono text-xs"
                        />
                      </div>

                      {verif?.url && (
                        <div className="text-[10px] text-right">
                          <a href={verif.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                            Site Sayfası Doğrulandı ↗
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                <button
                  onClick={() => setEditingSeries(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white/60 hover:text-white cursor-pointer"
                >
                  İptal
                </button>
                <button
                  onClick={handleSaveSlugs}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 shadow-lg cursor-pointer"
                >
                  Ayarları Kaydet
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. LOGS / EXECUTION TERMINAL DRAWER */}
      <AnimatePresence>
        {showLogsDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-3xl bg-[#0b0b0e] border border-white/15 rounded-3xl p-5 shadow-2xl flex flex-col max-h-[85vh] space-y-3"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-white">{syncTitle}</span>
                  {activeSyncingId !== null && (
                    <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin ml-2" />
                  )}
                </div>
                <button
                  onClick={() => setShowLogsDrawer(false)}
                  className="p-1.5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Terminal Logs View */}
              <div className="flex-1 overflow-y-auto bg-black/90 p-4 rounded-2xl border border-white/10 font-mono text-xs text-white/80 space-y-1 select-text">
                {syncLogs.length === 0 ? (
                  <div className="text-white/40 italic">Çapraz tarama motoru başlatılıyor...</div>
                ) : (
                  syncLogs.map((log, i) => {
                    const isError = log.includes('HATA') || log.includes('UYARI');
                    const isSuccess = log.includes('Tamamlandı') || log.includes('bağlandı') || log.includes('akış bulundu');
                    return (
                      <div
                        key={i}
                        className={`leading-relaxed ${
                          isError
                            ? 'text-rose-400'
                            : isSuccess
                            ? 'text-emerald-300'
                            : 'text-white/80'
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-[11px] text-white/40 font-mono">
                  {activeSyncingId !== null ? 'Tarama devam ediyor...' : 'İşlem tamamlandı.'}
                </div>
                <button
                  onClick={() => setShowLogsDrawer(false)}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold bg-white text-black hover:bg-white/90 cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}