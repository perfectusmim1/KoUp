'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Zap,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Terminal,
  X,
  Link as LinkIcon,
  Sparkles,
} from 'lucide-react';

interface AdminSeriesSyncProps {
  dramaId: number;
  dramaTitle: string;
  dramaSlug: string;
  onSyncComplete?: (result: { episodesAdded: number; sourcesAdded: number; provider: string }) => void;
}

const PROVIDERS = [
  { id: 'auto', name: 'Otomatik Akıllı Tespit', desc: 'Mevcut kaynaklar ve yapım ülkesine göre otomatik seçer', icon: '⚡' },
  { id: 'dizibox', name: 'DiziBOX Global', desc: 'DBX Pro 1080p HLS akışları', icon: '📦' },
  { id: 'hdfilm', name: 'HDFilmcehennemi', desc: 'Close Player & Rapidrame Dual 1080p', icon: '🔥' },
  { id: 'dizikorea', name: 'DiziKorea Asya', desc: 'playerdkorea 1080p HLS akışları', icon: '🌸' },
  { id: 'animecix', name: 'AnimeciX', desc: 'Tau-Video & Sibnet alternatifleri', icon: '⚡' },
  { id: 'ddizi', name: 'DDizi Yerli & Klasik', desc: 'YouTube HD & HLS resmi yayınlar', icon: '📺' },
];

export default function AdminSeriesSync({
  dramaId,
  dramaTitle,
  dramaSlug,
  onSyncComplete,
}: AdminSeriesSyncProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  // Manual URL Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState('');

  // Logs Modal
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    setStatusText('Senkronizasyon başlatılıyor...');
    setIsDropdownOpen(false);

    try {
      const res = await fetch('/api/admin/sync-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dramaId,
          slug: dramaSlug,
          provider: prov,
          manualUrl: customUrl || (prov === 'manual' ? manualUrlInput : undefined),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Senkronizasyon işlemi başarısız oldu.');
      }

      setLogs(data.logs || []);
      const epAdded = data.episodesAdded ?? 0;
      const srcAdded = data.sourcesAdded ?? 0;
      const resolvedProvider = data.provider || prov;

      setToast({
        type: 'success',
        message: `Senkronizasyon tamamlandı (${resolvedProvider.toUpperCase()}): +${epAdded} yeni bölüm, +${srcAdded} yeni kaynak bağlandı!`,
      });

      if (onSyncComplete) {
        onSyncComplete({ episodesAdded: epAdded, sourcesAdded: srcAdded, provider: resolvedProvider });
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

  const activeProviderMeta = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  return (
    <div className="relative inline-flex flex-col items-start gap-2">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border transition-all animate-in fade-in slide-in-from-bottom-4 ${
            toast.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/80 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="p-1 rounded-full hover:bg-white/10 transition-colors ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Admin Action Split Toolbar */}
      <div
        ref={dropdownRef}
        className="relative flex items-stretch rounded-full bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-yellow-500/20 border border-amber-400/40 shadow-[0_0_20px_rgba(245,158,11,0.2)] p-0.5"
      >
        {/* Left Action Button */}
        <button
          type="button"
          disabled={isSyncing}
          onClick={() => handleTriggerSync()}
          className="flex items-center gap-2 px-4 py-2 rounded-l-full bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 hover:text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {isSyncing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          )}
          <span>
            {isSyncing
              ? statusText || 'Senkronize Ediliyor...'
              : `Senkronize Et (${activeProviderMeta.name.split(' ')[0]})`}
          </span>
        </button>

        {/* Dropdown Toggle Arrow */}
        <button
          type="button"
          disabled={isSyncing}
          onClick={() => setIsDropdownOpen((v) => !v)}
          className="px-2.5 py-2 rounded-r-full border-l border-amber-400/30 bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 hover:text-white transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Kaynak sağlayıcı seç"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isDropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown Popover */}
        {isDropdownOpen && (
          <div className="absolute top-full left-0 mt-2 w-80 rounded-2xl bg-[#121217] border border-white/15 shadow-2xl backdrop-blur-2xl p-2 z-50 animate-in fade-in zoom-in-95">
            <div className="px-3 py-2 border-b border-white/10 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                Hedef Senkronizasyon Sağlayıcısı
              </span>
            </div>

            <div className="space-y-1">
              {PROVIDERS.map((p) => {
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(p.id);
                      setIsDropdownOpen(false);
                      handleTriggerSync(p.id);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/20 border border-amber-400/40 text-amber-200'
                        : 'hover:bg-white/[0.06] text-white/80 hover:text-white'
                    }`}
                  >
                    <span className="text-base shrink-0 mt-0.5">{p.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold flex items-center justify-between">
                        <span>{p.name}</span>
                        {isSelected && <span className="text-[10px] text-amber-400 font-mono">SEÇİLİ</span>}
                      </div>
                      <p className="text-[11px] text-white/50 line-clamp-1 mt-0.5">{p.desc}</p>
                    </div>
                  </button>
                );
              })}

              {/* Custom URL Option */}
              <button
                type="button"
                onClick={() => {
                  setIsDropdownOpen(false);
                  setShowManualModal(true);
                }}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-sky-500/15 border border-dashed border-sky-400/30 text-sky-300 hover:text-sky-200 transition-all flex items-start gap-2.5 cursor-pointer mt-1"
              >
                <LinkIcon className="w-4 h-4 shrink-0 mt-1 text-sky-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold">Özel Kaynak Linki Gir...</div>
                  <p className="text-[11px] text-sky-300/60 line-clamp-1 mt-0.5">
                    DiziBOX, HDFilm vb. doğrudan dizi URL'sini yapıştırın
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* View Last Logs Button if logs exist */}
      {logs.length > 0 && !isSyncing && (
        <button
          type="button"
          onClick={() => setShowLogsModal(true)}
          className="text-[11px] font-mono text-amber-400/80 hover:text-amber-300 flex items-center gap-1 transition-colors px-1 cursor-pointer"
        >
          <Terminal className="w-3 h-3" />
          <span>Son Tarama Günlüğünü Gör ({logs.length} satır)</span>
        </button>
      )}

      {/* Manual URL Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl bg-[#121216] border border-white/20 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-sky-400" />
                <span>Özel Dizi URL'si ile Senkronize Et</span>
              </h3>
              <button
                onClick={() => setShowManualModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white cursor-pointer"
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
              <input
                type="url"
                value={manualUrlInput}
                onChange={(e) => setManualUrlInput(e.target.value)}
                placeholder="Örn: https://www.dizibox.live/diziler/the-mentalist/ veya https://www.hdfilmcehennemi.nl/dizi/..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/15 text-xs text-white placeholder-white/30 focus:outline-none focus:border-sky-400 font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white/70 hover:bg-white/10 transition-colors cursor-pointer"
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
                className="px-5 py-2 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Senkronizasyonu Başlat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Inspection Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-2xl rounded-3xl bg-[#0c0c0e] border border-white/20 p-6 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-amber-400" />
                <span>Senkronizasyon İşlem Günlükleri</span>
              </h3>
              <button
                onClick={() => setShowLogsModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 rounded-2xl bg-black/60 border border-white/10 font-mono text-[11px] text-emerald-300/90 space-y-1 no-scrollbar">
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
                className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
