'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Crown,
  Megaphone,
  ShieldAlert,
  ScrollText,
  Search,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Pin,
  X,
  Clock,
  Filter,
} from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import KoupInput from '@/components/KoupInput';
import { adminFetch } from '@/lib/adminClient';
import { getProxiedImageUrl, supabase } from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';

export interface AuditLogRow {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface MasterpieceItem {
  id: number;
  slug: string;
  title: string;
  cover_image?: string;
  content_type?: string;
  rating?: number;
  release_year?: number;
}

interface AdminSettingsAndAuditProps {
  mode: 'settings' | 'audit_log';
  initialAuditLogs?: AuditLogRow[];
  initialSettings?: Record<string, unknown>;
}

export default function AdminSettingsAndAudit({
  mode,
  initialAuditLogs = [],
  initialSettings = {},
}: AdminSettingsAndAuditProps) {
  const pushNotification = useKoUpSelector((s) => s.pushNotification);

  // Masterpieces state
  const [rotationMode, setRotationMode] = useState<'daily' | 'weekly' | 'manual'>('daily');
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);
  const [activeMasterpieces, setActiveMasterpieces] = useState<MasterpieceItem[]>([]);
  const [loadingMasterpieces, setLoadingMasterpieces] = useState(false);
  const [savingMasterpieces, setSavingMasterpieces] = useState(false);
  const [mpSearchQuery, setMpSearchQuery] = useState('');
  const [mpSearchResults, setMpSearchResults] = useState<MasterpieceItem[]>([]);

  // Announcement banner state
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerText, setBannerText] = useState('');
  const [bannerLink, setBannerLink] = useState('');
  const [bannerVariant, setBannerVariant] = useState('info');
  const [savingBanner, setSavingBanner] = useState(false);

  // Comment watchlist state
  const [watchlistKeywords, setWatchlistKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [savingWatchlist, setSavingWatchlist] = useState(false);

  // Audit Log state
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>(initialAuditLogs);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');

  useEffect(() => {
    const ann = initialSettings.announcement_banner as Record<string, unknown> | undefined;
    if (ann) {
      setBannerEnabled(Boolean(ann.enabled));
      setBannerText(String(ann.text || ''));
      setBannerLink(String(ann.link || ''));
      setBannerVariant(String(ann.variant || 'info'));
    }
    const wl = initialSettings.comment_watchlist as Record<string, unknown> | undefined;
    if (wl && Array.isArray(wl.keywords)) {
      setWatchlistKeywords(wl.keywords.map(String));
    }
  }, [initialSettings]);

  const loadMasterpieces = async () => {
    setLoadingMasterpieces(true);
    try {
      const res = await adminFetch('/api/admin/masterpieces');
      const data = await res.json();
      if (data.config) {
        setRotationMode(data.config.rotationMode || 'daily');
        setPinnedIds(Array.isArray(data.config.pinnedIds) ? data.config.pinnedIds : []);
      }
      if (Array.isArray(data.items)) {
        setActiveMasterpieces(data.items);
      }
    } catch {
      // Ignore
    } finally {
      setLoadingMasterpieces(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await adminFetch('/api/admin/maintenance');
      const data = await res.json();
      if (data.ok && Array.isArray(data.auditLogs)) {
        setAuditLogs(data.auditLogs);
      }
      if (data.ok && data.siteSettings) {
        const ann = data.siteSettings.announcement_banner;
        if (ann) {
          setBannerEnabled(Boolean(ann.enabled));
          setBannerText(String(ann.text || ''));
          setBannerLink(String(ann.link || ''));
          setBannerVariant(String(ann.variant || 'info'));
        }
        const wl = data.siteSettings.comment_watchlist;
        if (wl && Array.isArray(wl.keywords)) {
          setWatchlistKeywords(wl.keywords.map(String));
        }
      }
    } catch {
      // Ignore
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (mode === 'settings') {
      loadMasterpieces();
      loadAuditLogs();
    } else {
      loadAuditLogs();
    }
  }, [mode]);

  useEffect(() => {
    if (mpSearchQuery.trim().length < 2) {
      setMpSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('media')
        .select('id, slug, title, cover_image, content_type, rating, release_year')
        .ilike('title', `%${mpSearchQuery.trim()}%`)
        .limit(8);
      setMpSearchResults((data as MasterpieceItem[]) || []);
    }, 280);
    return () => clearTimeout(timer);
  }, [mpSearchQuery]);

  const handleSaveMasterpieces = async () => {
    setSavingMasterpieces(true);
    try {
      const res = await adminFetch('/api/admin/masterpieces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotationMode, pinnedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Kaydedilemedi');
      pushNotification('Başyapıtlar Güncellendi', 'Ana sayfa Başyapıtlar rotasyon ayarları kaydedildi.', 'info');
      await loadMasterpieces();
    } catch (err) {
      pushNotification('Hata', (err as Error).message, 'system');
    } finally {
      setSavingMasterpieces(false);
    }
  };

  const handleSaveBanner = async () => {
    setSavingBanner(true);
    try {
      const res = await adminFetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_site_setting',
          key: 'announcement_banner',
          value: {
            enabled: bannerEnabled,
            text: bannerText.trim(),
            link: bannerLink.trim(),
            variant: bannerVariant,
          },
        }),
      });
      if (!res.ok) throw new Error('Duyuru bandı kaydedilemedi');
      pushNotification('Kaydedildi', 'Site duyuru bandı ayarları güncellendi.', 'info');
    } catch (err) {
      pushNotification('Hata', (err as Error).message, 'system');
    } finally {
      setSavingBanner(false);
    }
  };

  const handleSaveWatchlist = async (nextList: string[]) => {
    setSavingWatchlist(true);
    try {
      const res = await adminFetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_site_setting',
          key: 'comment_watchlist',
          value: { keywords: nextList },
        }),
      });
      if (!res.ok) throw new Error('Kelime listesi kaydedilemedi');
      setWatchlistKeywords(nextList);
      pushNotification('Kaydedildi', 'Yorum moderasyon izleme kelimeleri güncellendi.', 'info');
    } catch (err) {
      pushNotification('Hata', (err as Error).message, 'system');
    } finally {
      setSavingWatchlist(false);
    }
  };

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter((row) => {
      if (auditActionFilter !== 'all' && !row.action.startsWith(auditActionFilter)) return false;
      if (auditSearch.trim()) {
        const q = auditSearch.toLowerCase();
        return (
          row.summary.toLowerCase().includes(q) ||
          row.action.toLowerCase().includes(q) ||
          (row.target_id || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [auditLogs, auditActionFilter, auditSearch]);

  if (mode === 'audit_log') {
    return (
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-3xl bg-[#0d0d11]/90 border border-white/10">
          <div className="flex-1 max-w-md">
            <KoupInput
              type="text"
              placeholder="Denetim kaydında ara (işlem, özet, hedef ID)..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              clearable
              onClear={() => setAuditSearch('')}
              size="sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <CustomSelect
              value={auditActionFilter}
              onChange={setAuditActionFilter}
              size="sm"
              options={[
                { value: 'all', label: 'Tüm İşlemler' },
                { value: 'series.', label: 'Yapım / Seri İşlemleri' },
                { value: 'episode.', label: 'Bölüm & Kaynak İşlemleri' },
                { value: 'user.', label: 'Kullanıcı & Ban İşlemleri' },
                { value: 'report.', label: 'Sorun Bildirimi Triyajı' },
                { value: 'broadcast.', label: 'Duyuru & Bildirimler' },
                { value: 'maintenance.', label: 'Bakım Görevleri' },
                { value: 'settings.', label: 'Site Ayarları' },
              ]}
            />
            <button
              onClick={loadAuditLogs}
              disabled={loadingAudit}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? 'animate-spin' : ''}`} />
              <span>Yenile</span>
            </button>
          </div>
        </div>

        <div className="rounded-3xl bg-[#0d0d11]/90 border border-white/10 overflow-hidden">
          {filteredAuditLogs.length === 0 ? (
            <div className="p-12 text-center text-white/40 text-xs">
              Eşleşen denetim kaydı bulunamadı.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-white/45 font-mono text-[10px] uppercase bg-white/[0.02]">
                    <th className="py-3 px-4">Tarih</th>
                    <th className="py-3 px-4">Yetkili</th>
                    <th className="py-3 px-4">Eylem Kodu</th>
                    <th className="py-3 px-4">Hedef</th>
                    <th className="py-3 px-4">İşlem Özeti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-white/55 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 uppercase">
                          {log.actor_role || 'admin'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-amber-300 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-white/60 whitespace-nowrap">
                        {log.target_type ? `${log.target_type}:${log.target_id || ''}` : log.target_id || '—'}
                      </td>
                      <td className="py-3 px-4 text-white/90 font-medium">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. MASTERPIECES (BAŞYAPITLAR) ROTATION & PINNING MANAGER */}
      <div className="p-6 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Ana Sayfa &ldquo;Başyapıtlar&rdquo; Rotasyon Yöneticisi</h3>
              <p className="text-xs text-white/50">
                Ana sayfadaki 6 Başyapıt kartının otomatik rotasyon sıklığını belirleyin veya istediğiniz dizileri sabitleyin.
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveMasterpieces}
            disabled={savingMasterpieces}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-black hover:bg-amber-300 transition-all cursor-pointer disabled:opacity-40 self-start sm:self-center"
          >
            {savingMasterpieces ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Başyapıt Ayarlarını Kaydet</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Rotation Mode + Search to Pin */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-white/70 block mb-1.5">Rotasyon Modu</label>
              <CustomSelect
                value={rotationMode}
                onChange={(v) => setRotationMode(v as 'daily' | 'weekly' | 'manual')}
                size="sm"
                options={[
                  { value: 'daily', label: 'Günlük Otomatik Rotasyon (Önerilen)' },
                  { value: 'weekly', label: 'Haftalık Otomatik Rotasyon' },
                  { value: 'manual', label: 'Tamamen Manuel (Sabitlenenler Öncelikli)' },
                ]}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/70 block">
                Başyapıtlara Sabitlemek İçin Dizi Ara ({pinnedIds.length}/6 Sabit)
              </label>
              <KoupInput
                type="text"
                placeholder="Dizi veya anime adı yazın..."
                value={mpSearchQuery}
                onChange={(e) => setMpSearchQuery(e.target.value)}
                leftIcon={<Search className="w-4 h-4" />}
                clearable
                onClear={() => setMpSearchQuery('')}
                size="sm"
              />

              {mpSearchResults.length > 0 && (
                <div className="rounded-2xl bg-black/70 border border-white/10 divide-y divide-white/[0.06] max-h-48 overflow-y-auto">
                  {mpSearchResults.map((item) => {
                    const isPinned = pinnedIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 flex items-center justify-between gap-2 hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{item.title}</div>
                          <div className="text-[10px] text-white/45 font-mono">
                            #{item.id} • {item.release_year || '—'}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (isPinned) {
                              setPinnedIds(pinnedIds.filter((id) => id !== item.id));
                            } else if (pinnedIds.length < 6) {
                              setPinnedIds([...pinnedIds, item.id]);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                            isPinned
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                          }`}
                        >
                          {isPinned ? 'Sabiti Kaldır' : '+ Sabitle'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Active 6 Masterpieces Preview */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/70">
                Şu Anda Gösterilen 6 Başyapıt ({loadingMasterpieces ? 'Yükleniyor...' : 'Canlı Önizleme'})
              </span>
              {pinnedIds.length > 0 && (
                <button
                  onClick={() => setPinnedIds([])}
                  className="text-[11px] text-rose-400 hover:text-rose-300 cursor-pointer"
                >
                  Tüm Sabitleri Temizle ({pinnedIds.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {activeMasterpieces.map((item, idx) => {
                const isPinned = pinnedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-2xl border flex items-center gap-3 ${
                      isPinned
                        ? 'bg-amber-500/10 border-amber-500/40'
                        : 'bg-white/[0.02] border-white/10'
                    }`}
                  >
                    <div className="w-11 h-16 rounded-xl overflow-hidden bg-black/60 shrink-0 border border-white/10 relative">
                      {item.cover_image && (
                        <img
                          src={getProxiedImageUrl(item.cover_image)}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <span className="absolute top-1 left-1 px-1.5 py-0.2 rounded bg-black/80 text-[10px] font-black text-amber-400">
                        #{idx + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">{item.title}</div>
                      <div className="text-[10px] text-white/45 mt-0.5">
                        #{item.id} • ★ {item.rating || '8.8'}
                      </div>
                      <button
                        onClick={() => {
                          if (isPinned) {
                            setPinnedIds(pinnedIds.filter((id) => id !== item.id));
                          } else if (pinnedIds.length < 6) {
                            setPinnedIds([...pinnedIds, item.id]);
                          }
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 cursor-pointer"
                      >
                        <Pin className="w-3 h-3" />
                        <span>{isPinned ? 'Sabitlendi (Kaldır)' : 'Sabitle'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2. SITE ANNOUNCEMENT BANNER & COMMENT WATCHLIST */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Announcement Banner */}
        <div className="p-6 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <Megaphone className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Site Geneli Duyuru Bandı</h4>
                  <p className="text-[11px] text-white/45">Özel bakım veya etkinlik duyurularını üst bantta gösterin.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={bannerEnabled}
                  onChange={(e) => setBannerEnabled(e.target.checked)}
                  className="rounded border-white/20 bg-black/50 text-sky-500 focus:ring-0"
                />
                <span>{bannerEnabled ? 'Aktif' : 'Kapalı'}</span>
              </label>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-white/60 block mb-1">Duyuru Metni</label>
                <KoupInput
                  type="text"
                  value={bannerText}
                  onChange={(e) => setBannerText(e.target.value)}
                  placeholder="Örn: Bu gece 03:00'te sunucu bakım çalışması yapılacaktır."
                  size="sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-white/60 block mb-1">Yönlendirme Linki (Opsiyonel)</label>
                  <KoupInput
                    type="text"
                    value={bannerLink}
                    onChange={(e) => setBannerLink(e.target.value)}
                    placeholder="Örn: /takvim"
                    size="sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-white/60 block mb-1">Görsel Stil</label>
                  <CustomSelect
                    value={bannerVariant}
                    onChange={setBannerVariant}
                    size="sm"
                    options={[
                      { value: 'info', label: 'Mavi (Bilgilendirme)' },
                      { value: 'warning', label: 'Kehribar (Uyarı / Bakım)' },
                      { value: 'celebration', label: 'Zümrüt (Kutlama / Yeni Özellik)' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-white/[0.06]">
            <button
              onClick={handleSaveBanner}
              disabled={savingBanner}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-sky-500 text-black hover:bg-sky-400 transition-all cursor-pointer disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Duyuru Bandını Kaydet</span>
            </button>
          </div>
        </div>

        {/* Comment Watchlist Keywords */}
        <div className="p-6 rounded-3xl bg-[#0d0d11]/90 border border-white/10 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Yorum Moderasyon İzleme Kelimeleri</h4>
                <p className="text-[11px] text-white/45">
                  Bu kelimeleri içeren yorumlar Yorum Moderasyonu sekmesinde otomatik olarak kırmızı uyarı ile vurgulanır.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <KoupInput
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newKeyword.trim()) {
                      e.preventDefault();
                      const kw = newKeyword.trim().toLowerCase();
                      if (!watchlistKeywords.includes(kw)) {
                        handleSaveWatchlist([...watchlistKeywords, kw]);
                      }
                      setNewKeyword('');
                    }
                  }}
                  placeholder="Yeni kelime veya domain ekle (örn: telegram, discord.gg, reklam)..."
                  size="sm"
                />
              </div>
              <button
                onClick={() => {
                  const kw = newKeyword.trim().toLowerCase();
                  if (kw && !watchlistKeywords.includes(kw)) {
                    handleSaveWatchlist([...watchlistKeywords, kw]);
                    setNewKeyword('');
                  }
                }}
                disabled={savingWatchlist || !newKeyword.trim()}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500 text-white hover:bg-rose-400 cursor-pointer disabled:opacity-40"
              >
                + Ekle
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {watchlistKeywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono bg-rose-500/15 text-rose-300 border border-rose-500/30"
                >
                  <span>{kw}</span>
                  <button
                    onClick={() => handleSaveWatchlist(watchlistKeywords.filter((k) => k !== kw))}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-white/40 pt-3 border-t border-white/[0.06]">
            Toplam {watchlistKeywords.length} aktif filtre kelimesi denetleniyor.
          </div>
        </div>
      </div>
    </div>
  );
}
