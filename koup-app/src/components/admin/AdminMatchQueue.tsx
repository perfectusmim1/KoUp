'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Workflow,
  Globe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Search,
  Sparkles,
  ShieldCheck,
  Check,
  X,
  Layers,
  ArrowRight,
  Clock,
  Edit2,
  Save,
} from 'lucide-react';
import { adminFetch } from '@/lib/adminClient';
import { useKoUpSelector } from '@/context/KoUpContext';

export interface MatchQueueItem {
  id: number;
  site: string;
  remote_title: string;
  remote_url?: string | null;
  remote_year?: number | null;
  remote_episode_count?: number | null;
  candidate_drama_id?: number | null;
  candidate_title: string;
  candidate_year?: number | null;
  score: number;
  reasons?: string[] | any;
  status: 'pending' | 'approved' | 'rejected';
  payload?: any;
  created_at: string;
  reviewed_at?: string | null;
}

export interface ScraperDomainConfig {
  id: string;
  name: string;
  site_url: string;
  base_url?: string | null;
  domain_strategy?: string | null;
  gateway_url?: string | null;
  is_enabled: boolean;
  last_run_at?: string | null;
  last_ok_at?: string | null;
  last_error?: string | null;
}

const SITE_BADGE_STYLES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  shortizle: { label: 'Shortİzle', bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-400/30' },
  dramavadisi: { label: 'DramaVadisi', bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-400/30' },
  koredizi: { label: 'KoreDizi', bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-400/30' },
  dramabox: { label: 'DramaBox', bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-400/30' },
  diziizle: { label: 'Diziİzle', bg: 'bg-blue-500/15', text: 'text-blue-300', border: 'border-blue-400/30' },
  webdramaturkey2: { label: 'WDT2', bg: 'bg-pink-500/15', text: 'text-pink-300', border: 'border-pink-400/30' },
  animelvl: { label: 'AnimeLVL', bg: 'bg-violet-500/15', text: 'text-violet-300', border: 'border-violet-400/30' },
  sezonlukdizi: { label: 'SezonlukDizi', bg: 'bg-teal-500/15', text: 'text-teal-300', border: 'border-teal-400/30' },
  dizipal: { label: 'Dizipal', bg: 'bg-cyan-500/15', text: 'text-cyan-300', border: 'border-cyan-400/30' },
  fullhdfilmizlesene: { label: 'FullHDFilm', bg: 'bg-amber-600/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  tranimaci: { label: 'TrAnimaci', bg: 'bg-purple-500/15', text: 'text-purple-300', border: 'border-purple-400/30' },
  dizikorea: { label: 'DiziKorea', bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-400/30' },
  asyawatch: { label: 'AsyaWatch', bg: 'bg-pink-500/15', text: 'text-pink-300', border: 'border-pink-400/30' },
  dizibox: { label: 'DiziBox', bg: 'bg-emerald-600/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  animecix: { label: 'AnimeciX', bg: 'bg-cyan-500/15', text: 'text-cyan-300', border: 'border-cyan-400/30' },
  dizilla: { label: 'Dizilla', bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-400/30' },
  dizifon: { label: 'DiziFon', bg: 'bg-yellow-500/15', text: 'text-yellow-300', border: 'border-yellow-400/30' },
  ddizi: { label: 'DDizi', bg: 'bg-red-500/15', text: 'text-red-300', border: 'border-red-400/30' },
  hdfilm: { label: 'HDFilm', bg: 'bg-rose-600/15', text: 'text-rose-400', border: 'border-rose-500/30' },
};

export default function AdminMatchQueue() {
  const pushNotification = useKoUpSelector((s) => s.pushNotification);

  const [activeSubTab, setActiveSubTab] = useState<'queue' | 'domains'>('queue');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isMutatingId, setIsMutatingId] = useState<number | string | null>(null);

  const [queueItems, setQueueItems] = useState<MatchQueueItem[]>([]);
  const [scraperConfigs, setScraperConfigs] = useState<ScraperDomainConfig[]>([]);

  // Domain edit drafts: scraperId -> draftUrl
  const [domainDrafts, setDomainDrafts] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const resp = await adminFetch(`/api/admin/match-queue?status=${statusFilter}&limit=150`, {
        cache: 'no-store',
      });
      const data = await resp.json();
      if (data.ok) {
        setQueueItems(data.queue || []);
        setScraperConfigs(data.scraperConfigs || []);

        // Initialize domain drafts
        const drafts: Record<string, string> = {};
        (data.scraperConfigs || []).forEach((c: ScraperDomainConfig) => {
          drafts[c.id] = c.base_url || c.site_url || '';
        });
        setDomainDrafts(drafts);
      } else {
        pushNotification('Hata', data.error || 'Veriler yüklenemedi.', 'error');
      }
    } catch (err: any) {
      console.error('Failed to fetch match-queue data:', err);
      pushNotification('Hata', 'Kuyruk yüklenirken bağlantı hatası oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, pushNotification]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Action: Approve or Reject a Match Review Queue Item
  const handleReviewAction = async (id: number, action: 'approve' | 'reject') => {
    setIsMutatingId(id);
    try {
      const resp = await adminFetch('/api/admin/match-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      });
      const res = await resp.json();
      if (res.ok) {
        setQueueItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() }
              : item
          )
        );
        pushNotification(
          action === 'approve' ? 'Eşleşme Onaylandı' : 'Eşleşme Reddedildi',
          `Kayıt #${id} başarıyla ${action === 'approve' ? 'onaylandı' : 'reddedildi'}.`,
          'success'
        );
      } else {
        pushNotification('İşlem Başarısız', res.error || 'İşlem tamamlanamadı.', 'error');
      }
    } catch (err: any) {
      console.error('Review mutation error:', err);
      pushNotification('Hata', 'İşlem sırasında sunucu hatası oluştu.', 'error');
    } finally {
      setIsMutatingId(null);
    }
  };

  // Action: Update Domain / Base URL for a scraper
  const handleUpdateDomain = async (scraperId: string) => {
    const draft = domainDrafts[scraperId]?.trim();
    if (!draft) {
      pushNotification('Uyarı', 'Lütfen geçerli bir alan adı URL\'si girin.', 'error');
      return;
    }
    if (!draft.startsWith('https://')) {
      pushNotification('Güvenlik Uyarısı', 'Alan adı mutlaka "https://" ile başlamalıdır.', 'error');
      return;
    }

    setIsMutatingId(scraperId);
    try {
      const resp = await adminFetch('/api/admin/match-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_domain', scraperId, baseUrl: draft }),
      });
      const res = await resp.json();
      if (res.ok) {
        setScraperConfigs((prev) =>
          prev.map((c) => (c.id === scraperId ? { ...c, base_url: draft, site_url: draft } : c))
        );
        pushNotification(
          'Alan Adı Güncellendi',
          `${scraperId} botunun alan adı '${draft}' olarak kaydedildi.`,
          'success'
        );
      } else {
        pushNotification('Güncelleme Başarısız', res.error || 'Alan adı güncellenemedi.', 'error');
      }
    } catch (err: any) {
      console.error('Domain update error:', err);
      pushNotification('Hata', 'Alan adı güncellenirken sunucu hatası oluştu.', 'error');
    } finally {
      setIsMutatingId(null);
    }
  };

  // Filtered queue items
  const filteredQueue = useMemo(() => {
    return queueItems.filter((item) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.remote_title?.toLowerCase().includes(q) ||
        item.candidate_title?.toLowerCase().includes(q) ||
        item.site?.toLowerCase().includes(q)
      );
    });
  }, [queueItems, searchQuery]);

  const pendingCount = useMemo(() => {
    return queueItems.filter((i) => i.status === 'pending').length;
  }, [queueItems]);

  return (
    <div className="w-full space-y-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-white/[0.03] border border-white/10 backdrop-blur-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
            <Workflow className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Eşleşme Onay Kuyruğu & Domain Yönetimi
              </h2>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 border border-amber-400/40 text-amber-300 animate-pulse">
                  {pendingCount} Bekleyen
                </span>
              )}
            </div>
            <p className="text-xs text-white/50 leading-relaxed mt-0.5">
              Sınırda kalan şüpheli yapım eşleşmelerini denetleyin; scraper botlarının güncel alan adlarını yönetin.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 hover:text-white text-xs font-semibold transition-all cursor-pointer border border-white/10 active:scale-95 disabled:opacity-50 min-h-[44px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Yenile</span>
          </button>
        </div>
      </div>

      {/* TOP SUB-TAB PILLS (Zero native <select>) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('queue')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 min-h-[44px] ${
              activeSubTab === 'queue'
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-[0_0_15px_rgba(245,158,11,0.35)] border border-amber-400/40'
                : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white border border-white/10'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>Eşleşme Kuyruğu</span>
            {pendingCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black/40 text-amber-200">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('domains')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 min-h-[44px] ${
              activeSubTab === 'domains'
                ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-[0_0_15px_rgba(56,189,248,0.35)] border border-sky-400/40'
                : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white border border-white/10'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Scraper Alan Adları ({scraperConfigs.length})</span>
          </button>
        </div>

        {/* Search bar inside active tab */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Başlık veya bot adı ara..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400/50 transition-colors"
          />
        </div>
      </div>

      {/* VIEW 1: MATCH REVIEW QUEUE */}
      {activeSubTab === 'queue' && (
        <div className="space-y-4">
          {/* Status Filter Pills (No <select>) */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <span className="text-[11px] font-mono text-white/50 uppercase tracking-wider mr-1">
              Durum:
            </span>
            {(
              [
                { id: 'pending', label: 'Bekleyenler', count: pendingCount },
                { id: 'approved', label: 'Onaylananlar' },
                { id: 'rejected', label: 'Reddedilenler' },
                { id: 'all', label: 'Tümü' },
              ] as Array<{ id: 'pending' | 'approved' | 'rejected' | 'all'; label: string; count?: number }>
            ).map((s) => {
              const active = statusFilter === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px] ${
                    active
                      ? 'bg-white text-black font-extrabold shadow-md'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
                  }`}
                >
                  <span>{s.label}</span>
                  {s.count !== undefined && s.count > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-black font-mono font-bold">
                      {s.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Queue List */}
          {isLoading ? (
            <div className="p-12 text-center rounded-3xl bg-white/[0.02] border border-white/10">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
              <p className="text-xs font-mono text-white/50">Eşleşme kuyruğu taranıyor...</p>
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="p-12 text-center rounded-3xl bg-white/[0.02] border border-white/10">
              <ShieldCheck className="w-10 h-10 text-emerald-400/80 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-white mb-1">
                {statusFilter === 'pending'
                  ? 'Bekleyen Eşleşme Bulunmuyor'
                  : 'Filtreye Uygun Kayıt Bulunamadı'}
              </h3>
              <p className="text-xs text-white/50 max-w-md mx-auto">
                Tüm scraper yapımları yüksek güven skoruyla (%80+) otomatik bağlandı veya incelendi.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {filteredQueue.map((item) => {
                const siteBadge = SITE_BADGE_STYLES[item.site] || {
                  label: item.site,
                  bg: 'bg-white/10',
                  text: 'text-white/80',
                  border: 'border-white/20',
                };
                const scorePercent = Math.round(item.score * 100);
                const isPending = item.status === 'pending';
                const isMutating = isMutatingId === item.id;

                const reasonsList: string[] = Array.isArray(item.reasons)
                  ? item.reasons
                  : typeof item.reasons === 'string'
                  ? [item.reasons]
                  : [];

                return (
                  <div
                    key={`match-item-${item.id}`}
                    className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                      isPending
                        ? 'bg-[#0e0e12] border-white/15 hover:border-amber-400/40 shadow-lg'
                        : item.status === 'approved'
                        ? 'bg-emerald-950/10 border-emerald-500/20'
                        : 'bg-rose-950/10 border-rose-500/20 opacity-70'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Left: Comparison columns */}
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                        {/* Remote scraped candidate */}
                        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${siteBadge.bg} ${siteBadge.text} ${siteBadge.border}`}
                            >
                              {siteBadge.label}
                            </span>
                            {item.remote_url && (
                              <a
                                href={item.remote_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-white/40 hover:text-white transition-colors"
                                title="Uzak kaynağı aç"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-white leading-tight">
                            {item.remote_title}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-white/50">
                            {item.remote_year && <span>Yıl: {item.remote_year}</span>}
                            {item.remote_episode_count && (
                              <span>• {item.remote_episode_count} Bölüm</span>
                            )}
                          </div>
                        </div>

                        {/* Arrow separator on tablet/desktop */}
                        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5 relative">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-400/30">
                              KoUp Adayı
                            </span>
                            {item.candidate_drama_id && (
                              <span className="text-[10px] font-mono text-white/40">
                                #{item.candidate_drama_id}
                              </span>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-white leading-tight truncate">
                            {item.candidate_title || 'Belirsiz'}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-white/50">
                            {item.candidate_year && <span>Yıl: {item.candidate_year}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Right: Confidence score & Actions */}
                      <div className="flex flex-wrap lg:flex-col items-start lg:items-end justify-between gap-3 shrink-0">
                        <div className="flex items-center gap-2">
                          {/* Score Badge */}
                          <div
                            className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold border flex items-center gap-1 ${
                              scorePercent >= 75
                                ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                                : 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                            }`}
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>%{scorePercent} Güven</span>
                          </div>

                          {/* Status Badge */}
                          <span
                            className={`px-2.5 py-1 rounded-xl text-xs font-bold uppercase tracking-wider border ${
                              item.status === 'approved'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : item.status === 'rejected'
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                            }`}
                          >
                            {item.status === 'approved'
                              ? 'Onaylandı'
                              : item.status === 'rejected'
                              ? 'Reddedildi'
                              : 'İnceleme Bekliyor'}
                          </span>
                        </div>

                        {/* Action buttons if pending */}
                        {isPending && (
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => handleReviewAction(item.id, 'approve')}
                              disabled={isMutating}
                              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(16,185,129,0.35)] cursor-pointer active:scale-95 disabled:opacity-50 min-h-[44px]"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Onayla</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleReviewAction(item.id, 'reject')}
                              disabled={isMutating}
                              className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 min-h-[44px]"
                            >
                              <X className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Reddet</span>
                            </button>
                          </div>
                        )}

                        {/* Reasons tags */}
                        {reasonsList.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1 max-w-xs justify-end">
                            {reasonsList.map((r, rIdx) => (
                              <span
                                key={`r-${rIdx}`}
                                className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-mono text-white/50"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: SCRAPER DYNAMIC DOMAIN MANAGEMENT */}
      {activeSubTab === 'domains' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-400/20 flex items-start gap-3">
            <Globe className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div className="text-xs text-sky-200/90 leading-relaxed">
              <strong>Canlı Alan Adı (Base URL) Güncellemesi:</strong> Botların Cloudflare korumasını veya periyodik domain değişikliklerini aşabilmesi için güncel adresi buraya girip kaydedin. Bir sonraki scraper çalışmasında yeni domain kullanılır.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {scraperConfigs.map((config) => {
              const siteBadge = SITE_BADGE_STYLES[config.id] || {
                label: config.name,
                bg: 'bg-white/10',
                text: 'text-white/80',
                border: 'border-white/20',
              };
              const draft = domainDrafts[config.id] || '';
              const isDirty = draft !== (config.base_url || config.site_url || '');
              const isMutating = isMutatingId === config.id;

              return (
                <div
                  key={`cfg-${config.id}`}
                  className="p-4 sm:p-5 rounded-2xl bg-[#0e0e12] border border-white/10 hover:border-white/20 transition-all space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${siteBadge.bg} ${siteBadge.text} ${siteBadge.border}`}
                      >
                        {siteBadge.label}
                      </span>
                      <span className="text-xs font-mono font-bold text-white">
                        {config.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {config.domain_strategy && (
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-white/5 border border-white/10 text-white/60">
                          {config.domain_strategy}
                        </span>
                      )}
                      <span
                        className={`w-2 h-2 rounded-full ${
                          config.is_enabled ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                        }`}
                        title={config.is_enabled ? 'Aktif' : 'Devre Dışı'}
                      />
                    </div>
                  </div>

                  {/* Base URL edit field */}
                  <div>
                    <label className="text-[10px] font-mono text-white/50 block mb-1">
                      Canlı Base URL:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        value={draft}
                        onChange={(e) =>
                          setDomainDrafts((prev) => ({ ...prev, [config.id]: e.target.value }))
                        }
                        placeholder="https://..."
                        className="flex-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/15 text-xs font-mono text-white focus:outline-none focus:border-sky-400 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdateDomain(config.id)}
                        disabled={!isDirty || isMutating}
                        className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer min-h-[44px] ${
                          isDirty
                            ? 'bg-sky-500 hover:bg-sky-400 text-black shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                            : 'bg-white/5 text-white/30 border border-white/5 cursor-not-allowed'
                        }`}
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isMutating ? 'Kaydediliyor...' : 'Kaydet'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Metadata: last run & error */}
                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-white/40">
                    <div>
                      {config.last_ok_at ? (
                        <span className="text-emerald-400/80">
                          Son Başarılı: {new Date(config.last_ok_at).toLocaleTimeString('tr-TR')}
                        </span>
                      ) : (
                        <span>Henüz çalıştırılmadı</span>
                      )}
                    </div>
                    {config.last_error && (
                      <span className="text-rose-400 truncate max-w-[150px]" title={config.last_error}>
                        Hata: {config.last_error}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
