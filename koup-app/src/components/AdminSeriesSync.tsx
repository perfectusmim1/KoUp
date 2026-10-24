'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Terminal,
  X,
  Link as LinkIcon,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import KoupInput from '@/components/KoupInput';

interface AdminSeriesSyncProps {
  dramaId: number;
  dramaTitle: string;
  dramaSlug: string;
  pendingCount?: number;
  onSyncComplete?: (result: { episodesAdded: number; sourcesAdded: number; provider: string }) => void;
}

const SYNC_OPTIONS: SelectOption[] = [
  {
    value: 'auto',
    label: 'Otomatik Akıllı Tespit',
    description: 'Mevcut kaynaklar ve yapım ülkesine göre otomatik seçer',
    icon: (
      <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center flex-shrink-0 text-sky-400">
        <Sparkles className="w-3.5 h-3.5 text-sky-400" />
      </div>
    ),
  },
  {
    value: 'asyawatch',
    label: 'AsyaWatch (HLS)',
    description: 'four.pichive.online 1080p Native HLS',
    icon: (
      <div className="w-5 h-5 rounded-md bg-sky-950/40 border border-sky-500/30 flex items-center justify-center flex-shrink-0 text-sky-400 shadow-sm shadow-sky-500/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L14.2 8.3L20.8 9.2L16.2 13.9L17.4 20.6L12 17.6L6.6 20.6L7.8 13.9L3.2 9.2L9.8 8.3L12 2Z" fill="#38bdf8" />
          <circle cx="12" cy="12" r="2.5" fill="#0f172a" />
        </svg>
      </div>
    ),
  },
  {
    value: 'bldrama',
    label: 'BLDrama & WebDramaTurkey',
    description: 'BL & Asya Dizileri Doğrudan HLS & Alternatifler',
    icon: (
      <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-500 p-[1px] flex-shrink-0">
        <div className="w-full h-full bg-zinc-950 rounded-[5px] flex items-center justify-center">
          <span className="text-[8.5px] font-black tracking-tight bg-gradient-to-r from-pink-400 to-indigo-300 bg-clip-text text-transparent">BL</span>
        </div>
      </div>
    ),
  },
  {
    value: 'dizikorea',
    label: 'DiziKorea Asya',
    description: 'playerdkorea 1080p HLS akışları',
    icon: (
      <div className="w-5 h-5 rounded-md bg-amber-950/40 border border-amber-500/30 flex items-center justify-center flex-shrink-0 shadow-sm shadow-amber-500/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#f59e0b" strokeWidth="1.5" />
          <path d="M12 3C7 3 3 7 3 12C3 15 5 17 8 18C10 16 11 14 11 12C11 9 13 8 16 9C19 10 20 12 21 12C21 7 17 3 12 3Z" fill="#ef4444" />
          <path d="M12 21C17 21 21 17 21 12C21 9 19 7 16 6C14 8 13 10 13 12C13 15 11 16 8 15C5 14 4 12 3 12C3 17 7 21 12 21Z" fill="#3b82f6" />
        </svg>
      </div>
    ),
  },
  {
    value: 'dizifon',
    label: 'DiziFon / AsyaDizi',
    description: 'Asya Dizi & Film alternatif akışları',
    icon: (
      <div className="w-5 h-5 rounded-md bg-purple-950/40 border border-purple-500/30 flex items-center justify-center flex-shrink-0 text-purple-300 shadow-sm shadow-purple-500/10">
        <span className="text-[8px] font-extrabold tracking-tighter text-purple-400">DF</span>
      </div>
    ),
  },
  {
    value: 'dizibox',
    label: 'DiziBOX Global',
    description: 'DBX Pro 1080p HLS akışları',
    icon: (
      <div className="w-5 h-5 rounded-md bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 text-emerald-400 shadow-sm shadow-emerald-500/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>
    ),
  },
  {
    value: 'hdfilm',
    label: 'HDFilmcehennemi',
    description: 'Close Dual & Rapidrame Doğrudan 1080p HLS',
    icon: (
      <div className="w-5 h-5 rounded-md bg-orange-950/40 border border-orange-500/30 flex items-center justify-center flex-shrink-0 text-orange-400 shadow-sm shadow-orange-500/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 23c-4.97 0-9-3.58-9-8 0-4.07 3.53-7.57 6-10.5.58-.7 1.45-1.72 2-2.5.55.78 1.42 1.8 2 2.5 2.47 2.93 6 6.43 6 10.5 0 4.42-4.03 8-9 8zm0-15.5c-1.8 2.25-4.5 5.25-4.5 7.5 0 2.48 2.02 4.5 4.5 4.5s4.5-2.02 4.5-4.5c0-2.25-2.7-5.25-4.5-7.5z" fill="#f97316" />
        </svg>
      </div>
    ),
  },
  {
    value: 'dizilla',
    label: 'Dizilla Global & Anime',
    description: 'AES-256 Çözülmüş 1080p Native HLS',
    icon: (
      <div className="w-5 h-5 rounded-md bg-rose-950/40 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-400 shadow-sm shadow-rose-500/10">
        <span className="text-[8px] font-black italic tracking-tighter text-rose-400">DZ</span>
      </div>
    ),
  },
  {
    value: 'animecix',
    label: 'AnimeciX',
    description: 'Tau-Video & Sibnet alternatifleri',
    icon: (
      <div className="w-5 h-5 rounded-md bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-center flex-shrink-0 text-cyan-400 shadow-sm shadow-cyan-500/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#22d3ee" />
        </svg>
      </div>
    ),
  },
  {
    value: 'asyaanimeleri',
    label: 'AsyaAnimeleri',
    description: 'Asya Animeleri & Dizi alternatifleri',
    icon: (
      <div className="w-5 h-5 rounded-md bg-red-950/40 border border-red-600/30 flex items-center justify-center flex-shrink-0 text-red-400 shadow-sm shadow-red-600/10">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 5h20v2H2V5zm3 3h14v2H5V8zm2 3h10v11h-2v-9h-6v9H7V11z" fill="#f43f5e" />
        </svg>
      </div>
    ),
  },
  {
    value: 'ddizi',
    label: 'DDizi Yerli & Klasik',
    description: 'YouTube HD & HLS resmi yayınlar',
    icon: (
      <div className="w-5 h-5 rounded-md bg-red-950/40 border border-red-500/30 flex items-center justify-center flex-shrink-0 text-red-400 shadow-sm shadow-red-500/10">
        <div className="w-3.5 h-3 rounded-[3px] bg-red-600 flex items-center justify-center text-[7.5px] font-black text-white leading-none">
          d
        </div>
      </div>
    ),
  },
  {
    value: '__manual__',
    label: 'Özel Dizi URL\'si Gir...',
    description: 'DiziBOX, HDFilm vb. doğrudan dizi URL\'si yapıştırın',
    icon: (
      <div className="w-5 h-5 rounded-md bg-sky-950/30 border border-sky-500/30 flex items-center justify-center flex-shrink-0 text-sky-400">
        <LinkIcon className="w-3.5 h-3.5" />
      </div>
    ),
  },
];

export default function AdminSeriesSync({
  dramaId,
  dramaTitle,
  dramaSlug,
  pendingCount,
  onSyncComplete,
}: AdminSeriesSyncProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [internalPendingCount, setInternalPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (pendingCount !== undefined) return;
    let isCancelled = false;
    async function fetchPendingCount() {
      try {
        const { count } = await supabase
          .from('episodes')
          .select('id', { count: 'exact', head: true })
          .eq('media_id', dramaId)
          .eq('status', 'pending_source');
        if (!isCancelled && typeof count === 'number') {
          setInternalPendingCount(count);
        }
      } catch {}
    }
    fetchPendingCount();
    return () => {
      isCancelled = true;
    };
  }, [dramaId, pendingCount]);

  const effectivePendingCount = pendingCount !== undefined ? pendingCount : (internalPendingCount || 0);

  // Manual URL Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState('');

  // Logs Modal
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Clear toast after 5s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleTriggerSync = async (providerOverride?: string, customUrl?: string) => {
    const prov = providerOverride || selectedProvider;
    setIsSyncing(true);
    setStatusText('Başlatılıyor...');
    setLogs([]);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch('/api/admin/sync-series', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          dramaId,
          slug: dramaSlug,
          provider: prov,
          manualUrl: customUrl || (prov === 'manual' ? manualUrlInput : undefined),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Senkronizasyon işlemi başarısız oldu.');
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: any = null;
        let streamError: string | null = null;

        const handleMessage = (lineStr: string) => {
          const trimmed = lineStr.trim();
          if (!trimmed) return;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'log' && msg.line) {
              setLogs((prev) => [...prev, msg.line]);
              const cleanStatus = msg.line.replace(/^\[[^\]]+\]\s*(\[[^\]]+\]\s*)?/, '').slice(0, 36);
              if (cleanStatus) setStatusText(cleanStatus);
            } else if (msg.type === 'result') {
              finalResult = msg;
            } else if (msg.type === 'error') {
              streamError = msg.error || 'Senkronizasyon hatası';
              setLogs((prev) => [...prev, `[HATA] ${streamError}`]);
            }
          } catch (_) {}
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            handleMessage(line);
          }
        }
        if (buffer.trim()) {
          handleMessage(buffer);
        }

        if (streamError) {
          throw new Error(streamError);
        }

        const resolvedProvider = finalResult?.provider || prov;

        if (finalResult?.cloud) {
          setToast({
            type: 'success',
            message: '🚀 GitHub Actions bulut senkronizasyonu başlatıldı! Arka planda 1-2 dakika içinde bölümler ve kaynaklar güncellenecektir.',
          });
          if (onSyncComplete) {
            onSyncComplete({ episodesAdded: 0, sourcesAdded: 0, provider: resolvedProvider });
          }
        } else {
          const epAdded = finalResult?.episodesAdded ?? 0;
          const srcAdded = finalResult?.sourcesAdded ?? 0;

          setToast({
            type: 'success',
            message: `Senkronizasyon tamamlandı (${resolvedProvider.toUpperCase()}): +${epAdded} yeni bölüm, +${srcAdded} yeni kaynak!`,
          });

          if (onSyncComplete) {
            onSyncComplete({ episodesAdded: epAdded, sourcesAdded: srcAdded, provider: resolvedProvider });
          }
        }
      } else {
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || 'Senkronizasyon işlemi başarısız oldu.');
        }

        setLogs(data.logs || []);
        const resolvedProvider = data.provider || prov;

        if (data.cloud) {
          setToast({
            type: 'success',
            message: '🚀 GitHub Actions bulut senkronizasyonu başlatıldı! Arka planda 1-2 dakika içinde bölümler ve kaynaklar güncellenecektir.',
          });
          if (onSyncComplete) {
            onSyncComplete({ episodesAdded: 0, sourcesAdded: 0, provider: resolvedProvider });
          }
        } else {
          const epAdded = data.episodesAdded ?? 0;
          const srcAdded = data.sourcesAdded ?? 0;

          setToast({
            type: 'success',
            message: `Senkronizasyon tamamlandı (${resolvedProvider.toUpperCase()}): +${epAdded} yeni bölüm, +${srcAdded} yeni kaynak!`,
          });

          if (onSyncComplete) {
            onSyncComplete({ episodesAdded: epAdded, sourcesAdded: srcAdded, provider: resolvedProvider });
          }
        }
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      setToast({
        type: 'error',
        message: err.message || 'Senkronizasyon sırasında hata oluştu.',
      });
    } finally {
      setIsSyncing(false);
      setStatusText(null);
    }
  };

  const handleProviderSelect = (val: string) => {
    if (!val) return;
    if (val === '__manual__') {
      setShowManualModal(true);
      return;
    }
    setSelectedProvider(val);
    handleTriggerSync(val);
  };

  return (
    <div className="relative inline-flex flex-wrap items-center gap-2">
      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-2xl border ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="text-xs font-semibold">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="p-1 rounded-full hover:bg-white/10 transition-colors ml-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sitenin Genel CustomSelect Dropdown Bileşeni */}
      <CustomSelect
        value={selectedProvider}
        onChange={handleProviderSelect}
        options={SYNC_OPTIONS}
        triggerLabel={isSyncing ? (statusText || 'Senkronize Ediliyor...') : 'Senkronize Et'}
        leftIcon={
          isSyncing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
          )
        }
        disabled={isSyncing}
        size="sm"
        variant="glass"
        triggerClassName="px-3.5 py-1.5 text-xs rounded-full gap-2 hover:border-sky-400/40 hover:shadow-[0_0_15px_rgba(56,189,248,0.2)] transition-all font-bold cursor-pointer"
        menuClassName="min-w-[280px] max-w-[340px]"
        searchPlaceholder="Sağlayıcı veya site ara..."
        direction="auto"
      />

      {/* Pending Episodes Badge for Admins */}
      {effectivePendingCount > 0 && (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
          title={`${effectivePendingCount} bölüm henüz oynatılabilir video kaynağına sahip değil ("pending_source")`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>{effectivePendingCount} kaynak bekliyor</span>
        </span>
      )}

      {/* View Last / Live Logs Button if logs exist */}
      {logs.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLogsModal(true)}
          className="text-[11px] font-mono text-sky-400/80 hover:text-sky-300 flex items-center gap-1 transition-colors px-1 cursor-pointer"
        >
          <Terminal className="w-3 h-3" />
          <span>
            {isSyncing ? `Canlı Günlük (${logs.length} satır)` : `Son Günlük (${logs.length} satır)`}
          </span>
        </button>
      )}

      {/* Manual URL Modal */}
      <AnimatePresence>
        {showManualModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowManualModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-lg rounded-3xl bg-[#0f0f13] border border-white/15 p-6 sm:p-7 shadow-2xl space-y-4 z-10"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-sky-400" />
                  <span>Özel Dizi URL'si ile Senkronize Et</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-white/70 leading-relaxed">
                İlgili sitedeki tam dizi sayfa linkini yapıştırın. Sistem tüm sezonları, bölümleri ve akış
                kaynaklarını otomatik olarak çekip bu yapıma bağlayacaktır.
              </p>

              <div className="space-y-1.5">
                <label className="text-[11px] font-mono text-white/50">Hedef URL:</label>
                <KoupInput
                  type="url"
                  value={manualUrlInput}
                  onChange={(e) => setManualUrlInput(e.target.value)}
                  placeholder="Örn: https://asyawatch.com/dizi/... veya https://bldramaturkey.co/dizi/..."
                  size="sm"
                  inputClassName="text-xs font-mono font-medium"
                />
                <p className="text-[10px] text-white/40 pt-1">
                  Desteklenen Siteler: AsyaWatch, BLDrama/WebDramaTurkey, DiziBOX, DiziKorea, DiziFon, HDFilmcehennemi, Dizilla, AnimeciX, AsyaAnimeleri, DDizi
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-5 py-2.5 rounded-full glass-pill text-xs font-semibold text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="button"
                  disabled={!manualUrlInput.trim()}
                  onClick={() => {
                    setShowManualModal(false);
                    handleTriggerSync('auto', manualUrlInput.trim());
                  }}
                  className="px-6 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Senkronizasyonu Başlat
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logs Inspection Modal */}
      <AnimatePresence>
        {showLogsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLogsModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-2xl rounded-3xl bg-[#0c0c0e] border border-white/15 p-6 shadow-2xl flex flex-col max-h-[80vh] z-10"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>Senkronizasyon İşlem Günlükleri</span>
                </h3>
                <div className="flex items-center gap-2">
                  <a
                    href="https://github.com/perfectusmim1/KoUp/actions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <span>GitHub Actions Canlı Takip Et</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowLogsModal(false)}
                    className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3.5 rounded-2xl bg-black/70 border border-white/10 font-mono text-[11px] text-emerald-300/90 space-y-1 no-scrollbar">
                {logs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                    {line}
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="button"
                  onClick={() => setShowLogsModal(false)}
                  className="px-5 py-2.5 rounded-full glass-pill text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
