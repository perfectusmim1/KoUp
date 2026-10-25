'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  Search,
  RefreshCw,
  Film,
  Star,
  Calendar,
  Layers,
  User,
  MessageSquare,
  Link2,
  Check,
  Loader2,
} from 'lucide-react';
import { adminFetch } from '@/lib/adminClient';
import { supabase } from '@/lib/supabase';
import CustomSelect from '@/components/CustomSelect';
import KoupInput from '@/components/KoupInput';
import { useKoUp } from '@/context/KoUpContext';
import { motion } from 'motion/react';

export interface AdminSeriesRequestRow {
  id: string | number;
  user_id: string;
  source_type: 'anilist' | 'tmdb' | 'mdl' | 'imdb';
  source_url: string;
  external_id: string;
  title: string;
  original_title: string | null;
  overview: string | null;
  cover_image: string | null;
  backdrop_image: string | null;
  release_year: number | null;
  content_type: string | null;
  country_code: string | null;
  rating: number | null;
  episodes_count: number | null;
  user_note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  media_id: string | null;
  media_slug: string | null;
  created_at: string;
  reviewed_at: string | null;
  requester?: {
    id: string;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    role?: string | null;
  } | null;
}

const SOURCE_BADGES: Record<
  string,
  { label: string; cls: string }
> = {
  anilist: {
    label: 'AniList',
    cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  tmdb: {
    label: 'TMDB',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  mdl: {
    label: 'MyDramaList',
    cls: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  imdb: {
    label: 'IMDb',
    cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
};

interface AdminSeriesRequestsProps {
  onPendingCountChange?: (count: number) => void;
}

export default function AdminSeriesRequests({
  onPendingCountChange,
}: AdminSeriesRequestsProps) {
  const { triggerSound } = useKoUp();
  const [requests, setRequests] = useState<AdminSeriesRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all'
  );
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [draftNotes, setDraftNotes] = useState<Record<string | number, string>>({});
  const [draftSlugs, setDraftSlugs] = useState<Record<string | number, string>>({});
  const [processingId, setProcessingId] = useState<string | number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/series-requests?admin=1');
      const json = await res.json();
      if (json.ok && Array.isArray(json.requests)) {
        setRequests(json.requests);
        const pendingCount = json.requests.filter(
          (r: AdminSeriesRequestRow) => r.status === 'pending'
        ).length;
        onPendingCountChange?.(pendingCount);
      }
    } catch (err) {
      console.error('Seri istekleri alınamadı:', err);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-series-requests-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'series_requests' },
        () => {
          loadRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadRequests]);

  const handleUpdateStatus = async (
    reqItem: AdminSeriesRequestRow,
    newStatus: 'pending' | 'approved' | 'rejected'
  ) => {
    setProcessingId(reqItem.id);
    setFeedback(null);
    try {
      const adminNote =
        draftNotes[reqItem.id] !== undefined
          ? draftNotes[reqItem.id]
          : reqItem.admin_note || '';
      const mediaSlug =
        draftSlugs[reqItem.id] !== undefined
          ? draftSlugs[reqItem.id]
          : reqItem.media_slug || '';

      const res = await adminFetch('/api/series-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: reqItem.id,
          status: newStatus,
          admin_note: adminNote,
          media_slug: mediaSlug,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFeedback({
          type: 'err',
          text: json.error || 'Durum güncellenemedi.',
        });
        return;
      }

      setRequests((prev) => {
        const next = prev.map((r) =>
          r.id === reqItem.id ? { ...r, ...json.request, requester: r.requester } : r
        );
        const pendingCount = next.filter((r) => r.status === 'pending').length;
        onPendingCountChange?.(pendingCount);
        return next;
      });

      setFeedback({
        type: 'ok',
        text:
          newStatus === 'approved'
            ? `"${reqItem.title}" onaylandı ve kullanıcıya doğrudan bildirim gönderildi!`
            : newStatus === 'rejected'
            ? `"${reqItem.title}" reddedildi.`
            : `"${reqItem.title}" tekrar beklemeye alındı.`,
      });
    } catch {
      setFeedback({
        type: 'err',
        text: 'Sunucu ile bağlantı kurulurken hata oluştu.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (reqItem: AdminSeriesRequestRow) => {
    setProcessingId(reqItem.id);
    setFeedback(null);
    try {
      const res = await adminFetch(
        `/api/series-requests?id=${encodeURIComponent(reqItem.id)}`,
        {
          method: 'DELETE',
        }
      );
      const json = await res.json();
      if (json.ok) {
        setRequests((prev) => {
          const next = prev.filter((r) => r.id !== reqItem.id);
          const pendingCount = next.filter((r) => r.status === 'pending').length;
          onPendingCountChange?.(pendingCount);
          return next;
        });
        setFeedback({
          type: 'ok',
          text: `"${reqItem.title}" isteği silindi.`,
        });
      }
    } catch {
      setFeedback({
        type: 'err',
        text: 'İstek silinemedi.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const counts = useMemo(() => {
    return {
      all: requests.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: requests.filter((r) => r.status === 'approved').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    };
  }, [requests]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && r.source_type !== sourceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = r.title?.toLowerCase().includes(q);
        const matchOrig = r.original_title?.toLowerCase().includes(q);
        const matchUser =
          r.requester?.username?.toLowerCase().includes(q) ||
          r.requester?.display_name?.toLowerCase().includes(q);
        if (!matchTitle && !matchOrig && !matchUser) return false;
      }
      return true;
    });
  }, [requests, statusFilter, sourceFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header & Metrics */}
      <div className="rounded-3xl apple-glass p-6 border border-white/15 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-sky-400">
              <Sparkles className="w-4 h-4" />
              <span>TOPLULUK SERİ İSTEKLERİ YÖNETİMİ</span>
            </div>
            <h2 className="text-xl font-black text-white">
              Kullanıcı Seri İstekleri (AniList / TMDB / MDL / IMDb)
            </h2>
            
          </div>

          <button
            type="button"
            onClick={loadRequests}
            disabled={loading}
            className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white flex items-center gap-2 self-start sm:self-auto cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Yenile</span>
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-black/50 border border-white/10">
            <div className="text-[10px] font-mono text-white/50">TOPLAM İSTEK</div>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{counts.all}</div>
          </div>
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25">
            <div className="text-[10px] font-mono text-amber-300">ONAY BEKLEYEN</div>
            <div className="text-2xl font-black text-amber-300 font-mono mt-0.5">
              {counts.pending}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25">
            <div className="text-[10px] font-mono text-emerald-300">ONAYLANAN</div>
            <div className="text-2xl font-black text-emerald-300 font-mono mt-0.5">
              {counts.approved}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25">
            <div className="text-[10px] font-mono text-rose-300">REDDEDİLEN</div>
            <div className="text-2xl font-black text-rose-300 font-mono mt-0.5">
              {counts.rejected}
            </div>
          </div>
        </div>

        {/* Filter Bar with Fluid Spring Sliding Active Pill */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-white/10">
          <div className="flex items-center gap-1.5 p-1 rounded-2xl glass-pill-dark border border-white/10 overflow-x-auto no-scrollbar select-none">
            {[
              {
                id: 'all' as const,
                label: 'Tümü',
                count: counts.all,
                activeGlow:
                  'bg-gradient-to-r from-sky-500 to-blue-600 shadow-[0_0_18px_rgba(56,189,248,0.45)] border border-sky-400/40',
              },
              {
                id: 'pending' as const,
                label: 'Bekliyor',
                count: counts.pending,
                activeGlow:
                  'bg-gradient-to-r from-amber-500 to-orange-600 shadow-[0_0_18px_rgba(245,158,11,0.45)] border border-amber-400/40',
              },
              {
                id: 'approved' as const,
                label: 'Onaylandı',
                count: counts.approved,
                activeGlow:
                  'bg-gradient-to-r from-emerald-500 to-teal-600 shadow-[0_0_18px_rgba(16,185,129,0.45)] border border-emerald-400/40',
              },
              {
                id: 'rejected' as const,
                label: 'Reddedildi',
                count: counts.rejected,
                activeGlow:
                  'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_18px_rgba(244,63,94,0.45)] border border-rose-400/40',
              },
            ].map((tab, idx, arr) => {
              const active = statusFilter === tab.id;
              const prevTab = idx > 0 ? arr[idx - 1] : null;
              const nextTab = idx < arr.length - 1 ? arr[idx + 1] : null;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    triggerSound?.('click');
                    setStatusFilter(tab.id);
                  }}
                  className={`relative shrink-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold transition-[color,transform] duration-75 cursor-pointer select-none touch-manipulation active:scale-95 ${
                    active ? 'text-white font-extrabold' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="admin-series-requests-active-pill"
                      drag="x"
                      dragConstraints={{ left: -45, right: 45 }}
                      dragElastic={0.2}
                      dragSnapToOrigin
                      onDragEnd={(_, info) => {
                        if (info.offset.x > 25 && nextTab) {
                          triggerSound?.('click');
                          setStatusFilter(nextTab.id);
                        } else if (info.offset.x < -25 && prevTab) {
                          triggerSound?.('click');
                          setStatusFilter(prevTab.id);
                        }
                      }}
                      initial={false}
                      transition={{
                        type: 'spring',
                        stiffness: 520,
                        damping: 35,
                        mass: 0.5,
                      }}
                      className={`absolute inset-0 rounded-xl ${tab.activeGlow} z-0 cursor-grab active:cursor-grabbing select-none`}
                    />
                  )}
                  <span className="relative z-10 pointer-events-none">{tab.label}</span>
                  <span
                    className={`relative z-10 pointer-events-none px-1.5 py-0.2 rounded-full text-[10px] font-mono transition-colors ${
                      active ? 'bg-white/25 text-white' : 'bg-white/10 text-white/75'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="w-full sm:w-44">
              <CustomSelect
                value={sourceFilter}
                onChange={(val) => setSourceFilter(val)}
                options={[
                  { value: 'all', label: 'Tüm Kaynaklar' },
                  { value: 'anilist', label: 'AniList' },
                  { value: 'tmdb', label: 'TMDB' },
                  { value: 'mdl', label: 'MyDramaList' },
                  { value: 'imdb', label: 'IMDb' },
                ]}
                variant="dark"
                size="sm"
                className="w-full"
                triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2 text-xs"
                menuClassName="w-full"
              />
            </div>

            <div className="w-full sm:w-64">
              <KoupInput
                type="text"
                placeholder="Seri adı veya kullanıcı ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                leftIcon={<Search className="w-3.5 h-3.5 text-white/40" />}
                clearable
                onClear={() => setSearchQuery('')}
              />
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-2xl border text-xs font-medium flex items-center justify-between ${
              feedback.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-white/60 hover:text-white text-[11px] font-bold ml-4"
            >
              Kapat
            </button>
          </div>
        )}
      </div>

      {/* Request Cards */}
      {loading && requests.length === 0 ? (
        <div className="p-12 rounded-3xl apple-glass border border-white/10 flex items-center justify-center gap-3 text-sm text-white/60">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <span>Seri istekleri yükleniyor...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-3xl apple-glass border border-white/10 text-center space-y-2">
          <p className="text-sm font-bold text-white/80">
            Bu filtreye uygun seri isteği bulunamadı.
          </p>
          <p className="text-xs text-white/45">
            Kullanıcılar /seri-istek sayfasından yeni istek gönderdiğinde burada listelenir.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((req) => {
            const srcBadge = SOURCE_BADGES[req.source_type] || SOURCE_BADGES.tmdb;
            const isBusy = processingId === req.id;
            const currentSlug =
              draftSlugs[req.id] !== undefined ? draftSlugs[req.id] : req.media_slug || '';
            const currentNote =
              draftNotes[req.id] !== undefined ? draftNotes[req.id] : req.admin_note || '';

            const cardStyle =
              req.status === 'approved'
                ? 'border-emerald-500/40 hover:border-emerald-400/60 bg-gradient-to-br from-emerald-950/20 via-[#0e0e12]/95 to-[#0e0e12] shadow-[0_0_24px_rgba(16,185,129,0.06)]'
                : req.status === 'rejected'
                ? 'border-rose-500/40 hover:border-rose-400/60 bg-gradient-to-br from-rose-950/20 via-[#0e0e12]/95 to-[#0e0e12] shadow-[0_0_24px_rgba(244,63,94,0.06)]'
                : 'border-amber-500/40 hover:border-amber-400/60 bg-gradient-to-br from-amber-950/20 via-[#0e0e12]/95 to-[#0e0e12] shadow-[0_0_24px_rgba(245,158,11,0.06)]';

            return (
              <div
                key={req.id}
                className={`rounded-3xl border p-5 sm:p-6 flex flex-col lg:flex-row gap-5 transition-all duration-300 relative overflow-hidden ${cardStyle}`}
              >
                {/* Left: Poster + Source Info */}
                <div className="flex gap-4 flex-1 min-w-0">
                  <div className="w-28 sm:w-32 aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0 shadow-lg">
                    {req.cover_image ? (
                      <img
                        src={req.cover_image}
                        alt={req.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/30">
                        <Film className="w-7 h-7" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {req.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Onaylandı
                        </span>
                      ) : req.status === 'rejected' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          <XCircle className="w-3.5 h-3.5" />
                          Reddedildi
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <Clock className="w-3.5 h-3.5" />
                          Bekliyor
                        </span>
                      )}

                      <a
                        href={req.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border hover:opacity-80 transition-opacity ${srcBadge.cls}`}
                      >
                        <span>{srcBadge.label}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      {req.release_year && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[11px] text-white/75">
                          <Calendar className="w-3 h-3" />
                          {req.release_year}
                        </span>
                      )}

                      {req.rating && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-[11px] font-bold text-amber-300">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          {req.rating}
                        </span>
                      )}

                      {req.episodes_count && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[11px] text-white/75">
                          <Layers className="w-3 h-3" />
                          {req.episodes_count} Bölüm
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base sm:text-lg font-extrabold text-white leading-snug">
                        {req.title}
                      </h3>
                      {req.original_title &&
                        req.original_title.toLowerCase() !== req.title.toLowerCase() && (
                          <p className="text-xs text-white/50">{req.original_title}</p>
                        )}
                    </div>

                    <p className="text-xs text-white/75 leading-relaxed line-clamp-3">
                      {req.overview || 'Açıklama bulunmuyor.'}
                    </p>

                    {/* Requester & User Note */}
                    <div className="pt-1 flex flex-wrap items-center gap-3 text-xs text-white/60">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/10">
                        <User className="w-3.5 h-3.5 text-sky-400" />
                        <span className="font-semibold text-white/85">
                          {req.requester?.display_name ||
                            req.requester?.username ||
                            req.user_id.slice(0, 8)}
                        </span>
                        {req.requester?.username && (
                          <span className="text-white/40">@{req.requester.username}</span>
                        )}
                      </div>

                      <span className="text-[11px] text-white/45">
                        {new Date(req.created_at).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {req.user_note && (
                      <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200 flex items-start gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Kullanıcı Notu:</span> {req.user_note}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Admin Controls */}
                <div className="w-full lg:w-80 shrink-0 flex flex-col justify-between gap-3 pt-4 lg:pt-0 lg:pl-5 border-t lg:border-t-0 lg:border-l border-white/10">
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-white/50 mb-1">
                        Site İçi Seri Slug (İsteğe Bağlı)
                      </label>
                      <div className="relative">
                        <Link2 className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={currentSlug}
                          onChange={(e) =>
                            setDraftSlugs((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder="Örn: solo-leveling"
                          className="w-full pl-8 pr-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono uppercase text-white/50 mb-1">
                        Yönetici Notu (Bildirimde Gözükür)
                      </label>
                      <input
                        type="text"
                        value={currentNote}
                        onChange={(e) =>
                          setDraftNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                        }
                        placeholder="Örn: Arşive eklendi, iyi seyirler!"
                        className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleUpdateStatus(req, 'approved')}
                      className="flex-1 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-xs shadow-lg shadow-emerald-500/25 border border-emerald-400/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-white" />
                      )}
                      <span>Onayla</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleUpdateStatus(req, 'rejected')}
                      className="flex-1 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500 text-white font-extrabold text-xs shadow-lg shadow-rose-500/25 border border-rose-400/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5 text-white" />
                      <span>Reddet</span>
                    </button>

                    {req.status !== 'pending' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleUpdateStatus(req, 'pending')}
                        title="Tekrar Beklemeye Al"
                        className="p-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold text-xs shadow-lg shadow-amber-500/25 border border-amber-400/30 flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                      >
                        <Clock className="w-3.5 h-3.5 text-white" />
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDelete(req)}
                      title="İsteği Sil"
                      className="p-2.5 rounded-2xl bg-white/10 hover:bg-rose-600 text-white border border-white/15 hover:border-rose-500/40 shadow-sm flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>

                  {req.media_slug && (
                    <Link
                      href={`/seri/${req.media_slug}`}
                      className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1 justify-end"
                    >
                      <span>Eşleşen Seriye Git (/seri/{req.media_slug})</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
