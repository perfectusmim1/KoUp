'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  ShieldCheck,
  Database,
  CloudUpload,
  Sparkles,
  RefreshCw,
  Trash2,
  GitMerge,
  Activity,
  Terminal,
  Play,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  FileJson,
  Zap,
  Server,
  HardDrive,
  X,
} from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import KoupInput from '@/components/KoupInput';
import { adminFetch } from '@/lib/adminClient';
import { useKoUpSelector } from '@/context/KoUpContext';

export interface SystemHealthData {
  supabaseLatencyMs: number;
  workerLatencyMs: number;
  workerStatusOk: boolean;
  r2DbLastModified: string | null;
  r2DbSizeMb: number | null;
  r2DbAgeMinutes: number | null;
  localDbExists: boolean;
  localDbSizeMb: number | null;
  localDbModifiedAt: string | null;
  activeMaintenanceJob: string | null;
}

export interface AdminJobRow {
  id: number;
  job_type: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, unknown>;
  logs_tail: string[];
  result_summary: Record<string, unknown>;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

interface DuplicateGroupPreview {
  primary: { id: number; title: string; slug: string; episode_count: number; sources_count: number };
  duplicates: Array<{ id: number; title: string; slug: string; episode_count: number; sources_count: number }>;
}

interface AdminMaintenanceHubProps {
  initialHealth?: SystemHealthData | null;
  initialJobs?: AdminJobRow[];
  onRefreshDashboard?: () => void;
}

export default function AdminMaintenanceHub({
  initialHealth,
  initialJobs = [],
  onRefreshDashboard,
}: AdminMaintenanceHubProps) {
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);

  const [health, setHealth] = useState<SystemHealthData | null>(initialHealth || null);
  const [jobs, setJobs] = useState<AdminJobRow[]>(initialJobs);
  const [loadingHealth, setLoadingHealth] = useState(false);

  // Active streaming console state
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [consoleTitle, setConsoleTitle] = useState<string>('Bakım & Onarım Terminali');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [duplicatePreview, setDuplicatePreview] = useState<DuplicateGroupPreview[] | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Tool parameters
  const [healLimit, setHealLimit] = useState('25');
  const [healMaxGap, setHealMaxGap] = useState('30');
  const [healCountry, setHealCountry] = useState('ALL');
  const [healProvider, setHealProvider] = useState('all');
  const [healDramaId, setHealDramaId] = useState('');
  const [healDryRun, setHealDryRun] = useState(false);

  const [pendingLimit, setPendingLimit] = useState('50');
  const [pendingSite, setPendingSite] = useState('all');
  const [pendingDramaId, setPendingDramaId] = useState('');
  const [pendingForce, setPendingForce] = useState(false);
  const [pendingDryRun, setPendingDryRun] = useState(false);

  const [purgeSample, setPurgeSample] = useState('100');
  const [purgeApply, setPurgeApply] = useState(false);

  const [auditCategory, setAuditCategory] = useState('korea');
  const [auditLimit, setAuditLimit] = useState('50');

  const [overviewLimit, setOverviewLimit] = useState('40');
  const [overviewDryRun, setOverviewDryRun] = useState(false);

  const [animecixLimit, setAnimecixLimit] = useState('15');
  const [animecixForce, setAnimecixForce] = useState(false);

  const fetchMaintenanceStatus = async () => {
    setLoadingHealth(true);
    try {
      const res = await adminFetch('/api/admin/maintenance');
      const data = await res.json();
      if (data.ok) {
        setHealth(data.health || null);
        setJobs(data.adminJobs || []);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    if (!initialHealth) {
      fetchMaintenanceStatus();
    }
  }, []);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs]);

  const runStreamingTool = async (
    tool: string,
    title: string,
    params: Record<string, unknown> = {},
    confirmConfig?: { title: string; description: string }
  ) => {
    if (runningTool) {
      pushNotification('İşlem Devam Ediyor', 'Lütfen mevcut bakım görevinin tamamlanmasını bekleyin.', 'info');
      return;
    }

    if (confirmConfig) {
      const ok = await confirmDialog({
        title: confirmConfig.title,
        message: confirmConfig.description,
        confirmText: 'Onayla ve Başlat',
        cancelText: 'Vazgeç',
        isDestructive: true,
        icon: 'alert',
      });
      if (!ok) return;
    }

    setRunningTool(tool);
    setConsoleTitle(title);
    setConsoleLogs([`[${new Date().toLocaleTimeString('tr-TR')}] ▶ ${title} başlatılıyor...`]);
    if (tool !== 'merge_duplicates') {
      setDuplicatePreview(null);
    }

    try {
      const res = await adminFetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, params }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status} hatası`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          if (!rawLine.trim()) continue;
          try {
            const ev = JSON.parse(rawLine);
            if (ev.type === 'log' && ev.message) {
              setConsoleLogs((prev) => [...prev.slice(-250), ev.message]);
            } else if (ev.type === 'error' && ev.message) {
              setConsoleLogs((prev) => [...prev, `[HATA] ${ev.message}`]);
            } else if (ev.type === 'done') {
              if (tool === 'merge_duplicates' && ev.result?.groups && Array.isArray(ev.result.groups)) {
                setDuplicatePreview(ev.result.groups);
              }
              setConsoleLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString('tr-TR')}] ${
                  ev.ok ? '✓ İşlem başarıyla tamamlandı.' : '✕ İşlem hata ile sonlandı.'
                }`,
              ]);
              pushNotification(
                ev.ok ? 'Bakım Tamamlandı' : 'Bakım Uyarısı',
                `${title} ${ev.ok ? 'başarıyla tamamlandı.' : 'hata ile sonlandı.'}`,
                ev.ok ? 'info' : 'warning'
              );
            }
          } catch {
            setConsoleLogs((prev) => [...prev.slice(-250), rawLine]);
          }
        }
      }
      await fetchMaintenanceStatus();
      onRefreshDashboard?.();
    } catch (err) {
      const msg = (err as Error).message;
      setConsoleLogs((prev) => [...prev, `[KRİTİK HATA] ${msg}`]);
      pushNotification('Bakım Hatası', msg, 'error');
    } finally {
      setRunningTool(null);
    }
  };

  const runBulkOverviews = async () => {
    if (runningTool) return;
    setRunningTool('bulk_fix_overviews');
    setConsoleTitle('Eksik Özet & Meta Tamamlayıcı (TMDB & AniList)');
    setConsoleLogs([`[${new Date().toLocaleTimeString('tr-TR')}] ▶ Eksik özet taraması başlatıldı...`]);

    try {
      const limit = Math.min(80, Math.max(5, Number(overviewLimit) || 40));
      const res = await adminFetch(
        `/api/admin/bulk-fix-overviews?limit=${limit}&offset=0&dry=${overviewDryRun ? '1' : '0'}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'İşlem başarısız');

      setConsoleLogs((prev) => [
        ...prev,
        `Taranan Yapım: ${data.scanned || 0} | Güncellenen: ${data.updatedCount || 0} | Eşleşmeyen: ${data.failedCount || 0}`,
        ...(Array.isArray(data.updated)
          ? data.updated.map((u: { id: number; title: string; source: string }) => `  ✓ #${u.id} "${u.title}" (${u.source})`)
          : []),
      ]);
      pushNotification(
        'Özet Tamamlama Bitti',
        `${data.updatedCount || 0} yapımın Türkçe/İngilizce özeti güncellendi.`,
        'info'
      );
      onRefreshDashboard?.();
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[HATA] ${(err as Error).message}`]);
      pushNotification('Hata', (err as Error).message, 'error');
    } finally {
      setRunningTool(null);
    }
  };

  const runAnimecixSync = async () => {
    if (runningTool) return;
    setRunningTool('animecix_sync');
    setConsoleTitle('AnimeciX Derin Kataloğu Senkronize Et');
    setConsoleLogs([`[${new Date().toLocaleTimeString('tr-TR')}] ▶ AnimeciX taraması başlatıldı...`]);

    try {
      const limit = Math.min(30, Math.max(1, Number(animecixLimit) || 15));
      const res = await adminFetch(
        `/api/admin/animecix-sync?limit=${limit}&offset=0&force=${animecixForce ? '1' : '0'}`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AnimeciX senkronizasyonu başarısız');

      setConsoleLogs((prev) => [
        ...prev,
        `Taranan Anime: ${data.scanned || 0} | Eşleşen: ${data.matchedCount || 0} | Eklenen Bölüm: ${data.episodesUpserted || 0} | Eklenen Kaynak: ${data.totalSourcesAdded || 0}`,
        ...(Array.isArray(data.matched)
          ? data.matched.map(
              (m: { id: number; title: string; episodesAdded: number; sourcesAdded: number }) =>
                `  ✓ #${m.id} "${m.title}" (+${m.episodesAdded} bölüm, +${m.sourcesAdded} kaynak)`
            )
          : []),
      ]);
      pushNotification(
        'AnimeciX Tamamlandı',
        `+${data.episodesUpserted || 0} bölüm ve +${data.totalSourcesAdded || 0} kaynak eklendi.`,
        'info'
      );
      onRefreshDashboard?.();
    } catch (err) {
      setConsoleLogs((prev) => [...prev, `[HATA] ${(err as Error).message}`]);
      pushNotification('Hata', (err as Error).message, 'error');
    } finally {
      setRunningTool(null);
    }
  };

  const formatAge = (mins: number | null) => {
    if (mins === null || mins === undefined) return 'Bilinmiyor';
    if (mins < 60) return `${mins} dk önce`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} saat ${mins % 60} dk önce`;
    return `${Math.floor(hours / 24)} gün önce`;
  };

  return (
    <div className="space-y-6">
      {/* 1. REAL-TIME STORAGE & INFRASTRUCTURE HEALTH */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl bg-[#0d0d11]/90 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/45">Supabase Veritabanı</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">
              {health?.supabaseLatencyMs !== undefined ? `${health.supabaseLatencyMs} ms` : '—'}
            </span>
            <span className="text-[11px] text-emerald-400 font-semibold">Çevrimiçi</span>
          </div>
          <div className="mt-1 text-[11px] text-white/40">PostgreSQL + Realtime + RLS Aktif</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0d0d11]/90 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/45">Cloudflare Edge Worker</span>
            <Server className={`w-4 h-4 ${health?.workerStatusOk ? 'text-sky-400' : 'text-amber-400'}`} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">
              {health?.workerLatencyMs && health.workerLatencyMs > 0 ? `${health.workerLatencyMs} ms` : '—'}
            </span>
            <span className={`text-[11px] font-semibold ${health?.workerStatusOk ? 'text-sky-400' : 'text-amber-400'}`}>
              {health?.workerStatusOk ? 'Koruma Aktif' : 'Kontrol Ediliyor'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-white/40">SSRF Korumalı Proxy & R2 CDN</div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0d0d11]/90 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/45">Cloudflare R2 DB Yedeği</span>
            <CloudUpload
              className={`w-4 h-4 ${
                (health?.r2DbAgeMinutes ?? 0) > 1440 ? 'text-amber-400' : 'text-violet-400'
              }`}
            />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-black text-white">{formatAge(health?.r2DbAgeMinutes ?? null)}</span>
            {health?.r2DbSizeMb && <span className="text-xs font-mono text-violet-300">{health.r2DbSizeMb} MB</span>}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
            <span>db/webdrama_archive.db</span>
            <button
              onClick={() => runStreamingTool('backup_db_r2', 'SQLite WAL Checkpoint & R2 DB Yedeği')}
              disabled={runningTool !== null}
              className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer disabled:opacity-40"
            >
              Şimdi Yedekle →
            </button>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#0d0d11]/90 border border-white/10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/45">Yerel SQLite Arşivi</span>
            <HardDrive className={`w-4 h-4 ${health?.localDbExists ? 'text-emerald-400' : 'text-white/30'}`} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-black text-white">
              {health?.localDbExists ? `${health.localDbSizeMb || 0} MB` : 'Bulut Modu'}
            </span>
            <span className="text-[11px] text-white/50">
              {health?.localDbExists ? 'Yerel Bağlı' : 'Vercel / Serverless'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
            <span>Kural 11 Tam Senkron</span>
            <button
              onClick={fetchMaintenanceStatus}
              disabled={loadingHealth}
              className="text-white/60 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loadingHealth ? 'animate-spin' : ''}`} />
              <span>Yenile</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. FULL STORAGE SYNC CHAIN (GEMINI.MD RULE 11 QUICK BAR) */}
      <div className="p-4 sm:p-5 rounded-3xl bg-[#0e0e12] border border-white/10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
            <h3 className="text-sm font-bold text-white">
              Tam Depolama Eşitleme Zinciri (SQLite ⇄ R2 JSON Paketleri ⇄ R2 DB ⇄ Supabase)
            </h3>
          </div>
          
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 w-full lg:w-auto">
          <button
            onClick={() => runStreamingTool('export_r2_bundles', 'R2 Kaynak Paketlerini Dışa Aktar ve Yükle')}
            disabled={runningTool !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 transition-all cursor-pointer disabled:opacity-40"
          >
            <FileJson className="w-3.5 h-3.5" />
            <span>R2 Paketlerini Eşitle</span>
          </button>

          <button
            onClick={() => runStreamingTool('sync_supabase_episodes', 'Supabase Bölüm & Kaynak Senkronizasyonu')}
            disabled={runningTool !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer disabled:opacity-40"
          >
            <Database className="w-3.5 h-3.5" />
            <span>Supabase&apos;e Eşitle</span>
          </button>

          <button
            onClick={() => runStreamingTool('sync_calendars', 'Canlı Yayın Takvimi Senkronizasyonu')}
            disabled={runningTool !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-all cursor-pointer disabled:opacity-40"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Yayın Takvimini Güncelle</span>
          </button>

          <button
            onClick={() => runStreamingTool('backup_db_r2', 'SQLite WAL Checkpoint & Cloudflare R2 DB Yedeği')}
            disabled={runningTool !== null}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/30 transition-all cursor-pointer disabled:opacity-40"
          >
            <CloudUpload className="w-3.5 h-3.5" />
            <span>R2 DB Yedekle</span>
          </button>
        </div>
      </div>

      {/* 3. INTERACTIVE MAINTENANCE ENGINES GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card A: Auto-Heal Archive Gaps */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Wrench className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Eksik Bölüm Onarıcı (Auto-Heal Archive Gaps)</h4>
                  
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Dizi Limiti</label>
                <KoupInput
                  type="number"
                  value={healLimit}
                  onChange={(e) => setHealLimit(e.target.value)}
                  size="sm"
                  placeholder="25"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Ülke Filtresi</label>
                <CustomSelect
                  value={healCountry}
                  onChange={setHealCountry}
                  size="sm"
                  options={[
                    { value: 'ALL', label: 'Tüm Ülkeler' },
                    { value: 'KR', label: 'Güney Kore (KR)' },
                    { value: 'CN', label: 'Çin (CN)' },
                    { value: 'TH', label: 'Tayland (TH)' },
                    { value: 'JP', label: 'Japonya (JP)' },
                    { value: 'TR', label: 'Türkiye (TR)' },
                  ]}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-mono text-white/45 block mb-1">Özel Dizi ID (Opsiyonel)</label>
                <KoupInput
                  type="number"
                  value={healDramaId}
                  onChange={(e) => setHealDramaId(e.target.value)}
                  size="sm"
                  placeholder="Tümü"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={healDryRun}
                onChange={(e) => setHealDryRun(e.target.checked)}
                className="rounded border-white/20 bg-black/50 text-sky-500 focus:ring-0"
              />
              <span>Yalnızca Önizleme (Dry-Run)</span>
            </label>

            <button
              onClick={() =>
                runStreamingTool('auto_heal_gaps', 'Eksik Bölüm Onarıcı', {
                  limit: Number(healLimit) || 25,
                  maxGap: Number(healMaxGap) || 30,
                  country: healCountry,
                  provider: healProvider,
                  dramaId: healDramaId ? Number(healDramaId) : undefined,
                  dryRun: healDryRun,
                })
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 transition-all cursor-pointer disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{healDryRun ? 'Eksikleri Listele' : 'Onarımı Başlat'}</span>
            </button>
          </div>
        </div>

        {/* Card B: Recheck Pending Episodes */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <RefreshCw className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Bekleyen Kaynak Çözücü (Recheck Pending)</h4>
                
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Bölüm Limiti</label>
                <KoupInput
                  type="number"
                  value={pendingLimit}
                  onChange={(e) => setPendingLimit(e.target.value)}
                  size="sm"
                  placeholder="50"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Hedef Site</label>
                <CustomSelect
                  value={pendingSite}
                  onChange={setPendingSite}
                  size="sm"
                  options={[
                    { value: 'all', label: 'Tüm Siteler (Çapraz)' },
                    { value: 'shortizle', label: 'Shortİzle (Kısa Drama)' },
                    { value: 'dramavadisi', label: 'DramaVadisi (Kısa Drama)' },
                    { value: 'koredizi', label: 'KoreDizi (K-Drama & Shorts)' },
                    { value: 'dramabox', label: 'DramaBox (Orijinal Shorts)' },
                    { value: 'diziizle', label: 'Diziİzle (Yabancı Dizi)' },
                    { value: 'webdramaturkey2', label: 'WebDramaTurkey2 (WDT)' },
                    { value: 'animelvl', label: 'AnimeLVL (Anime)' },
                    { value: 'sezonlukdizi', label: 'SezonlukDizi (VIP)' },
                    { value: 'dizipal', label: 'Dizipal (Dinamik Domain)' },
                    { value: 'fullhdfilmizlesene', label: 'FullHDFilmİzlesene' },
                    { value: 'tranimaci', label: 'TrAnimaci (Anime)' },
                    { value: 'asyawatch', label: 'AsyaWatch' },
                    { value: 'dizikorea', label: 'DiziKorea' },
                    { value: 'dizifon', label: 'DiziFon' },
                    { value: 'dizibox', label: 'DiziBOX' },
                    { value: 'animecix', label: 'AnimeciX' },
                  ]}
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[10px] font-mono text-white/45 block mb-1">Özel Dizi ID</label>
                <KoupInput
                  type="number"
                  value={pendingDramaId}
                  onChange={(e) => setPendingDramaId(e.target.value)}
                  size="sm"
                  placeholder="Tümü"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pendingForce}
                  onChange={(e) => setPendingForce(e.target.checked)}
                  className="rounded border-white/20 bg-black/50 text-amber-500 focus:ring-0"
                />
                <span>Zaman Aşımını Atla (--force)</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pendingDryRun}
                  onChange={(e) => setPendingDryRun(e.target.checked)}
                  className="rounded border-white/20 bg-black/50 text-amber-500 focus:ring-0"
                />
                <span>Dry-Run</span>
              </label>
            </div>

            <button
              onClick={() =>
                runStreamingTool('recheck_pending', 'Bekleyen Kaynak Çözücü', {
                  limit: Number(pendingLimit) || 50,
                  site: pendingSite,
                  dramaId: pendingDramaId ? Number(pendingDramaId) : undefined,
                  force: pendingForce,
                  dryRun: pendingDryRun,
                })
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-black hover:bg-amber-300 transition-all cursor-pointer disabled:opacity-40"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Bekleyenleri Çöz</span>
            </button>
          </div>
        </div>

        {/* Card C: Merge Duplicates (Dry-Run + Apply) */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <GitMerge className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Mükerrer Yapım Birleştirici (Merge Duplicates)</h4>
                
              </div>
            </div>

            {duplicatePreview && (
              <div className="p-3 rounded-2xl bg-black/50 border border-white/10 max-h-40 overflow-y-auto space-y-1.5">
                <div className="text-[11px] font-bold text-sky-300">
                  Tespit Edilen Kümeler ({duplicatePreview.length}):
                </div>
                {duplicatePreview.length === 0 ? (
                  <div className="text-xs text-emerald-400">✓ Arşivde mükerrer yapım bulunmadı!</div>
                ) : (
                  duplicatePreview.map((g, idx) => (
                    <div key={idx} className="text-[11px] text-white/75 border-b border-white/[0.05] pb-1">
                      <span className="text-emerald-300 font-semibold">
                        Ana #{g.primary.id} {g.primary.title}
                      </span>{' '}
                      ←{' '}
                      {g.duplicates.map((d) => `#${d.id} (${d.slug})`).join(', ')}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
            <button
              onClick={() =>
                runStreamingTool('merge_duplicates', 'Mükerrer Yapım Önizleme (Dry-Run)', { dryRun: true })
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition-all cursor-pointer disabled:opacity-40"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Önce Önizle (Dry-Run)</span>
            </button>

            <button
              onClick={() =>
                runStreamingTool(
                  'merge_duplicates',
                  'Mükerrer Yapımları Canlı Birleştir',
                  { dryRun: false },
                  {
                    title: 'Mükerrer Yapımları Birleştir',
                    description:
                      'Tespit edilen mükerrer dizilerin bölümleri ve kaynakları ana diziye aktarılacak, kopya kayıtlar SQLite, R2 ve Supabase üzerinden temizlenecektir. Onaylıyor musunuz?',
                  }
                )
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-sky-500 text-black hover:bg-sky-400 transition-all cursor-pointer disabled:opacity-40"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Birleştirmeyi Uygula</span>
            </button>
          </div>
        </div>

        {/* Card D: Purge Dead Sources */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Ölü Kaynak Temizleyici (Purge Dead Sources)</h4>
                
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">
                  Sağlayıcı Başına Örneklem (0 = Tamamı)
                </label>
                <KoupInput
                  type="number"
                  value={purgeSample}
                  onChange={(e) => setPurgeSample(e.target.value)}
                  size="sm"
                  placeholder="100"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={purgeApply}
                    onChange={(e) => setPurgeApply(e.target.checked)}
                    className="rounded border-white/20 bg-black/50 text-rose-500 focus:ring-0"
                  />
                  <span>Ölü Kaynakları Veritabanından Sil (--apply)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
            <button
              onClick={() =>
                runStreamingTool(
                  'purge_dead_sources',
                  'Ölü Kaynak Denetimi ve Temizliği',
                  { sample: Number(purgeSample) || 0, apply: purgeApply, dryRun: !purgeApply },
                  purgeApply
                    ? {
                        title: 'Ölü Kaynakları Kalıcı Olarak Sil',
                        description:
                          'Doğrulanmış ölü video kaynakları arşivden silinecektir. Devam etmek istiyor musunuz?',
                      }
                    : undefined
                )
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-all cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{purgeApply ? 'Ölü Kaynakları Temizle' : 'Ölü Kaynakları Test Et (Dry-Run)'}</span>
            </button>
          </div>
        </div>

        {/* Card E: Catalog Audit Engine */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Katalog Sağlık Denetçisi (Audit Engine)</h4>
                
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Denetim Kategorisi</label>
                <CustomSelect
                  value={auditCategory}
                  onChange={setAuditCategory}
                  size="sm"
                  options={[
                    { value: 'korea', label: 'Güney Kore Dizileri' },
                    { value: 'anime_jp', label: 'Japonya Animeleri' },
                    { value: 'anime_donghua', label: 'Çin Donghua / Anime' },
                    { value: 'asia_other', label: 'Diğer Asya (TH/TW/CN)' },
                    { value: 'western', label: 'Batı Dizileri (US/GB)' },
                    { value: 'movies_tr', label: 'Filmler & Yerli Yapımlar' },
                  ]}
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Test Dizi Limiti</label>
                <KoupInput
                  type="number"
                  value={auditLimit}
                  onChange={(e) => setAuditLimit(e.target.value)}
                  size="sm"
                  placeholder="50"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
            <button
              onClick={() =>
                runStreamingTool('audit_catalog', `Katalog Denetimi (${auditCategory})`, {
                  category: auditCategory,
                  limit: Number(auditLimit) || 50,
                })
              }
              disabled={runningTool !== null}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-violet-500/25 hover:bg-violet-500/35 text-violet-200 border border-violet-500/30 transition-all cursor-pointer disabled:opacity-40"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Denetimi Başlat</span>
            </button>
          </div>
        </div>

        {/* Card F: Bulk Overview Enricher & AnimeciX Sync */}
        <div className="p-5 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Meta Veri Tamamlayıcı & AnimeciX Derin Tarama</h4>
                
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">Eksik Özet Batch Limiti</label>
                <KoupInput
                  type="number"
                  value={overviewLimit}
                  onChange={(e) => setOverviewLimit(e.target.value)}
                  size="sm"
                  placeholder="40"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-white/45 block mb-1">AnimeciX Tarama Limiti</label>
                <KoupInput
                  type="number"
                  value={animecixLimit}
                  onChange={(e) => setAnimecixLimit(e.target.value)}
                  size="sm"
                  placeholder="15"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overviewDryRun}
                  onChange={(e) => setOverviewDryRun(e.target.checked)}
                  className="rounded border-white/20 bg-black/50 text-cyan-500 focus:ring-0"
                />
                <span>Özet Dry-Run</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-white/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={animecixForce}
                  onChange={(e) => setAnimecixForce(e.target.checked)}
                  className="rounded border-white/20 bg-black/50 text-cyan-500 focus:ring-0"
                />
                <span>AnimeciX Zorla</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runBulkOverviews}
                disabled={runningTool !== null}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/15 text-white transition-all cursor-pointer disabled:opacity-40"
              >
                Eksik Özetleri Doldur
              </button>
              <button
                onClick={runAnimecixSync}
                disabled={runningTool !== null}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-cyan-500 text-black hover:bg-cyan-400 transition-all cursor-pointer disabled:opacity-40"
              >
                AnimeciX Eşitle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. LIVE NDJSON STREAMING CONSOLE */}
      <div className="rounded-3xl bg-[#09090c] border border-white/10 overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 bg-white/[0.03] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white">{consoleTitle}</span>
            {runningTool && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Çalışıyor ({runningTool})</span>
              </span>
            )}
          </div>
          {consoleLogs.length > 0 && (
            <button
              onClick={() => setConsoleLogs([])}
              className="text-[11px] text-white/40 hover:text-white cursor-pointer"
            >
              Konsolu Temizle
            </button>
          )}
        </div>

        <div className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-1 bg-black/80 select-text">
          {consoleLogs.length === 0 ? (
            <div className="text-white/30 italic">
              Yukarıdaki bakım araçlarından birini çalıştırdığınızda canlı Python / motor çıktıları burada akacaktır...
            </div>
          ) : (
            consoleLogs.map((line, i) => {
              const isErr = line.includes('HATA') || line.includes('ERROR') || line.includes('✕');
              const isOk = line.includes('SUCCESS') || line.includes('✓') || line.includes('Onarıldı');
              return (
                <div
                  key={i}
                  className={`leading-relaxed break-words ${
                    isErr ? 'text-rose-400' : isOk ? 'text-emerald-300' : 'text-white/80'
                  }`}
                >
                  {line}
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>
      </div>

      {/* 5. RECENT ADMIN JOBS HISTORY */}
      {jobs.length > 0 && (
        <div className="rounded-3xl bg-[#0d0d11]/90 border border-white/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-400" />
              <span>Son Çalıştırılan Bakım Görevleri ({jobs.length})</span>
            </h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/45 font-mono text-[10px] uppercase">
                  <th className="py-2.5 px-3">Görev</th>
                  <th className="py-2.5 px-3">Durum</th>
                  <th className="py-2.5 px-3">Başlangıç</th>
                  <th className="py-2.5 px-3">Bitiş</th>
                  <th className="py-2.5 px-3 text-right">Günlük</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {jobs.slice(0, 12).map((j) => (
                  <tr key={j.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-mono font-semibold text-white">{j.job_type}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          j.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : j.status === 'running'
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {j.status === 'completed' ? 'Tamamlandı' : j.status === 'running' ? 'Çalışıyor' : 'Hatalı'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-white/50">
                      {new Date(j.started_at).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-white/50">
                      {j.finished_at
                        ? new Date(j.finished_at).toLocaleTimeString('tr-TR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {Array.isArray(j.logs_tail) && j.logs_tail.length > 0 && (
                        <button
                          onClick={() => {
                            setConsoleTitle(`Görev #${j.id} (${j.job_type}) Günlüğü`);
                            setConsoleLogs(j.logs_tail);
                          }}
                          className="text-sky-400 hover:text-sky-300 font-mono text-[11px] cursor-pointer"
                        >
                          Konsolda Gör ({j.logs_tail.length})
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
