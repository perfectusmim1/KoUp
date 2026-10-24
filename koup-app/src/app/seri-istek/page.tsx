'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Link2,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Trash2,
  Film,
  Tv,
  Star,
  Calendar,
  Layers,
  Loader2,
  Check,
  Search,
  RefreshCw,
  Info,
  ArrowRight,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useKoUp } from '@/context/KoUpContext';
import { supabase } from '@/lib/supabase';

interface PreviewMetadata {
  source_type: 'anilist' | 'tmdb' | 'mdl' | 'imdb';
  source_url: string;
  external_id: string;
  title: string;
  original_title: string | null;
  overview: string;
  cover_image: string | null;
  backdrop_image: string | null;
  release_year: number | null;
  content_type: 'series' | 'movie' | 'anime';
  country_code: string | null;
  rating: number | null;
  episodes_count: number | null;
  existing_media?: {
    id: string;
    slug: string;
    title: string;
  } | null;
}

interface SeriesRequestItem {
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
}

const SOURCE_CONFIG: Record<
  'anilist' | 'tmdb' | 'mdl' | 'imdb',
  { label: string; domain: string; badgeClass: string; example: string }
> = {
  anilist: {
    label: 'AniList',
    domain: 'anilist.co',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    example: 'https://anilist.co/anime/151807/Solo-Leveling/',
  },
  tmdb: {
    label: 'TMDB',
    domain: 'themoviedb.org',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    example: 'https://www.themoviedb.org/tv/1396-breaking-bad',
  },
  mdl: {
    label: 'MyDramaList',
    domain: 'mydramalist.com',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    example: 'https://mydramalist.com/702267-weak-hero',
  },
  imdb: {
    label: 'IMDb',
    domain: 'imdb.com',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    example: 'https://www.imdb.com/title/tt0903747/',
  },
};

export default function SeriesRequestPage() {
  const { user, openAuthModal } = useKoUp();

  const [urlInput, setUrlInput] = useState('');
  const [userNote, setUserNote] = useState('');
  const [preview, setPreview] = useState<PreviewMetadata | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [myRequests, setMyRequests] = useState<SeriesRequestItem[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'all'
  );
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }, []);

  const fetchMyRequests = useCallback(async () => {
    if (!user?.id) {
      setMyRequests([]);
      return;
    }
    setIsLoadingRequests(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/series-requests', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.requests)) {
        setMyRequests(json.requests);
      }
    } catch (err) {
      console.error('Seri istekleri yüklenemedi:', err);
    } finally {
      setIsLoadingRequests(false);
    }
  }, [user?.id, getAccessToken]);

  useEffect(() => {
    fetchMyRequests();
  }, [fetchMyRequests]);

  // Realtime subscription so user immediately sees approval/rejection
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`user-series-requests-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'series_requests',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchMyRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchMyRequests]);

  const fetchPreview = useCallback(async (targetUrl: string) => {
    const clean = targetUrl.trim();
    if (!clean) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    setIsPreviewLoading(true);
    setPreviewError(null);
    setSubmitMessage(null);

    try {
      const res = await fetch('/api/series-requests/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clean }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.preview) {
        setPreview(null);
        setPreviewError(json.error || 'Seri bilgileri alınamadı.');
        return;
      }
      setPreview(json.preview);
    } catch {
      setPreview(null);
      setPreviewError('Bağlantı kontrol edilirken bir hata oluştu.');
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  // Auto-preview when a valid looking URL is pasted/typed
  useEffect(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    const looksLikeSupportedUrl =
      /anilist\.co\/anime\/\d+/i.test(trimmed) ||
      /themoviedb\.org\/(tv|movie)\/\d+/i.test(trimmed) ||
      /mydramalist\.com\/\d+/i.test(trimmed) ||
      /imdb\.com\/title\/tt\d+/i.test(trimmed);

    if (!looksLikeSupportedUrl) {
      const timer = setTimeout(() => {
        if (trimmed.length > 10) {
          setPreview(null);
          setPreviewError(
            'Sadece geçerli AniList, TMDB, MyDramaList (MDL) veya IMDb seri bağlantıları kabul edilmektedir.'
          );
        }
      }, 500);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      fetchPreview(trimmed);
    }, 550);

    return () => clearTimeout(timer);
  }, [urlInput, fetchPreview]);

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }
    if (!urlInput.trim() || !preview) {
      setSubmitMessage({
        type: 'error',
        text: 'Lütfen önce geçerli bir seri bağlantısı girin ve seri bilgilerinin yüklenmesini bekleyin.',
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      const token = await getAccessToken();
      const res = await fetch('/api/series-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          url: urlInput.trim(),
          user_note: userNote.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setSubmitMessage({
          type: 'error',
          text: json.error || 'İstek gönderilirken bir hata oluştu.',
        });
        return;
      }

      setSubmitMessage({
        type: 'success',
        text: `"${preview.title}" seri isteğiniz başarıyla gönderildi! Onaylandığında bildirim alacaksınız.`,
      });
      setUrlInput('');
      setUserNote('');
      setPreview(null);
      if (json.request) {
        setMyRequests((prev) => [json.request, ...prev.filter((r) => r.id !== json.request.id)]);
      } else {
        fetchMyRequests();
      }
    } catch {
      setSubmitMessage({
        type: 'error',
        text: 'Sunucu ile iletişim kurulurken bir hata oluştu.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = async (id: string | number) => {
    setDeletingId(id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/series-requests?id=${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (json.ok) {
        setMyRequests((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err) {
      console.error('İstek silinemedi:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return myRequests;
    return myRequests.filter((r) => r.status === statusFilter);
  }, [myRequests, statusFilter]);

  const counts = useMemo(() => {
    return {
      all: myRequests.length,
      pending: myRequests.filter((r) => r.status === 'pending').length,
      approved: myRequests.filter((r) => r.status === 'approved').length,
      rejected: myRequests.filter((r) => r.status === 'rejected').length,
    };
  }, [myRequests]);

  return (
    <div className="min-h-screen bg-[#070709] text-white flex flex-col selection:bg-white/20">
      <Navbar />

      <main className="flex-1 pt-24 sm:pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 sm:p-10 mb-8 shadow-2xl">
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[11px] font-bold uppercase tracking-widest text-sky-400">
                <Sparkles size={13} />
                Topluluk İstek Merkezi
              </div>
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
                Seri İstek Gönder
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Arşivde görmek istediğiniz dizi, film veya animelerin{' '}
                <span className="text-white font-semibold">AniList</span>,{' '}
                <span className="text-white font-semibold">TMDB</span>,{' '}
                <span className="text-white font-semibold">MyDramaList</span> veya{' '}
                <span className="text-white font-semibold">IMDb</span> bağlantısını yapıştırın.
                Seri görseli, ismi ve açıklaması otomatik çekilir; onaylandığında anında bildirim alırsınız.
              </p>
            </div>

            {/* Supported Platforms Pill Grid */}
            <div className="grid grid-cols-2 gap-2.5 shrink-0">
              {(Object.keys(SOURCE_CONFIG) as Array<keyof typeof SOURCE_CONFIG>).map((key) => {
                const cfg = SOURCE_CONFIG[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setUrlInput(cfg.example)}
                    title={`Örnek ${cfg.label} bağlantısı dene`}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98] ${cfg.badgeClass}`}
                  >
                    <ShieldCheck size={15} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold leading-tight truncate">
                        {cfg.label}
                      </div>
                      <div className="text-[10px] opacity-75 truncate">{cfg.domain}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Request Form & Live Preview Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-12">
          {/* Form Column */}
          <div className="lg:col-span-7 rounded-3xl border border-white/10 bg-[#0d0d11]/90 backdrop-blur-xl p-5 sm:p-7 flex flex-col justify-between shadow-xl">
            <form onSubmit={handleSubmitRequest} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  Seri Bağlantısı (AniList / TMDB / MDL / IMDb) *
                </label>
                <div className="relative flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2
                      size={17}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                    />
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://mydramalist.com/702267-weak-hero veya https://anilist.co/anime/..."
                      className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50 focus:bg-white/[0.06] transition-all"
                    />
                    {urlInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setUrlInput('');
                          setPreview(null);
                          setPreviewError(null);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-1 rounded-lg transition-colors"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchPreview(urlInput)}
                    disabled={!urlInput.trim() || isPreviewLoading}
                    className="px-4 py-3.5 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] disabled:opacity-40 border border-white/10 text-xs font-bold text-white transition-all flex items-center gap-2 shrink-0"
                  >
                    {isPreviewLoading ? (
                      <Loader2 size={15} className="animate-spin text-sky-400" />
                    ) : (
                      <Search size={15} className="text-sky-400" />
                    )}
                    <span className="hidden sm:inline">Bilgileri Çek</span>
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500 flex items-center gap-1.5">
                  <Info size={12} className="text-zinc-400 shrink-0" />
                  Bağlantıyı yapıştırdığınızda seri görseli, ismi ve açıklaması otomatik olarak çekilir.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  Ek Notunuz (İsteğe Bağlı)
                </label>
                <div className="relative">
                  <MessageSquare
                    size={16}
                    className="absolute left-4 top-3.5 text-zinc-500 pointer-events-none"
                  />
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={userNote}
                    onChange={(e) => setUserNote(e.target.value)}
                    placeholder="Örn: 2. sezonu da eklenirse çok sevinirim, Türkçe altyazılı..."
                    className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/50 focus:bg-white/[0.06] transition-all resize-none"
                  />
                </div>
              </div>

              {/* Error or Feedback Messages */}
              <AnimatePresence mode="wait">
                {previewError && (
                  <motion.div
                    key="preview-error"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-start gap-2.5"
                  >
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                    <span>{previewError}</span>
                  </motion.div>
                )}

                {submitMessage && (
                  <motion.div
                    key="submit-msg"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
                      submitMessage.type === 'success'
                        ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                        : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                    }`}
                  >
                    {submitMessage.type === 'success' ? (
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-400" />
                    ) : (
                      <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-400" />
                    )}
                    <span>{submitMessage.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {!user ? (
                  <button
                    type="button"
                    onClick={() => openAuthModal('Seri isteği göndermek için lütfen giriş yapın.')}
                    className="w-full py-3.5 px-6 rounded-2xl bg-white text-black font-bold text-xs uppercase tracking-wider hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
                  >
                    İstek Göndermek İçin Giriş Yapın
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!preview || isSubmitting || isPreviewLoading}
                    className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-40 disabled:pointer-events-none text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/20 transition-all flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Gönderiliyor...
                      </>
                    ) : (
                      <>
                        <Send size={15} />
                        Seri İsteğini Gönder
                      </>
                    )}
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Live Automatic Preview Column */}
          <div className="lg:col-span-5 rounded-3xl border border-white/10 bg-[#0d0d11]/90 backdrop-blur-xl p-5 sm:p-6 flex flex-col justify-center relative overflow-hidden min-h-[320px] shadow-xl">
            <AnimatePresence mode="wait">
              {isPreviewLoading ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center text-center py-12 space-y-3"
                >
                  <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                    <Loader2 size={22} className="animate-spin text-sky-400" />
                  </div>
                  <p className="text-xs font-bold text-zinc-300">
                    Seri bilgileri ve görseli otomatik çekiliyor...
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Lütfen birkaç saniye bekleyin
                  </p>
                </motion.div>
              ) : preview ? (
                <motion.div
                  key={preview.external_id}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="space-y-4 relative z-10"
                >
                  {preview.backdrop_image && (
                    <div
                      className="absolute -inset-6 opacity-15 blur-2xl bg-cover bg-center pointer-events-none"
                      style={{ backgroundImage: `url(${preview.backdrop_image})` }}
                    />
                  )}

                  <div className="relative flex gap-4">
                    <div className="w-28 sm:w-32 aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0 shadow-lg">
                      {preview.cover_image ? (
                        <img
                          src={preview.cover_image}
                          alt={preview.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          <Film size={28} />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                            SOURCE_CONFIG[preview.source_type]?.badgeClass
                          }`}
                        >
                          {SOURCE_CONFIG[preview.source_type]?.label}
                        </span>
                        {preview.release_year && (
                          <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-bold text-zinc-300 flex items-center gap-1">
                            <Calendar size={10} />
                            {preview.release_year}
                          </span>
                        )}
                        {preview.rating && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-[10px] font-bold text-amber-300 flex items-center gap-1">
                            <Star size={10} className="fill-amber-400 text-amber-400" />
                            {preview.rating}
                          </span>
                        )}
                        {preview.episodes_count && (
                          <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-bold text-zinc-300 flex items-center gap-1">
                            <Layers size={10} />
                            {preview.episodes_count} Bölüm
                          </span>
                        )}
                      </div>

                      <h3 className="text-base sm:text-lg font-extrabold text-white leading-snug line-clamp-2">
                        {preview.title}
                      </h3>

                      {preview.original_title &&
                        preview.original_title.toLowerCase() !== preview.title.toLowerCase() && (
                          <p className="text-[11px] text-zinc-400 truncate">
                            {preview.original_title}
                          </p>
                        )}

                      <p className="text-xs text-zinc-300/90 leading-relaxed line-clamp-4">
                        {preview.overview || 'Bu seri için açıklama bulunmuyor.'}
                      </p>
                    </div>
                  </div>

                  {preview.existing_media && (
                    <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3">
                      <div className="text-xs text-amber-200">
                        <span className="font-bold">Bilgi:</span> Bu seri zaten arşivimizde mevcut
                        olabilir. Yine de eksik sezon/bölüm için istek gönderebilirsiniz.
                      </div>
                      <Link
                        href={`/seri/${preview.existing_media.slug}`}
                        className="px-3 py-1.5 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 text-[11px] font-bold shrink-0 flex items-center gap-1 transition-colors"
                      >
                        Seriye Git
                        <ExternalLink size={12} />
                      </Link>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center text-center py-10 px-4 space-y-3"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-500">
                    <Tv size={24} />
                  </div>
                  <div className="space-y-1 max-w-xs">
                    <h3 className="text-sm font-bold text-zinc-300">Otomatik Seri Önizlemesi</h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Sol taraftaki alana bir <strong className="text-zinc-400">AniList</strong>,{' '}
                      <strong className="text-zinc-400">TMDB</strong>,{' '}
                      <strong className="text-zinc-400">MyDramaList</strong> veya{' '}
                      <strong className="text-zinc-400">IMDb</strong> linki yapıştırdığınızda seri
                      poster ve detayları burada belirecektir.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* User's Submitted Requests Section */}
        <section className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
                Seri İsteklerim
              </h2>
              <button
                type="button"
                onClick={fetchMyRequests}
                disabled={isLoadingRequests}
                className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-zinc-400 hover:text-white transition-all"
                title="Listeyi Yenile"
              >
                <RefreshCw size={14} className={isLoadingRequests ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
              {[
                {
                  id: 'all' as const,
                  label: 'Tümü',
                  count: counts.all,
                  activeCls:
                    'bg-gradient-to-r from-sky-500 to-blue-600 text-white font-extrabold shadow-lg shadow-sky-500/25 border-sky-400/40',
                  inactiveCls:
                    'bg-white/[0.04] text-white/80 hover:text-white hover:bg-white/[0.08] border-white/10',
                },
                {
                  id: 'pending' as const,
                  label: 'Bekliyor',
                  count: counts.pending,
                  activeCls:
                    'bg-gradient-to-r from-amber-500 to-orange-600 text-white font-extrabold shadow-lg shadow-amber-500/25 border-amber-400/40',
                  inactiveCls:
                    'bg-amber-500/10 text-amber-300 hover:text-white hover:bg-amber-500/20 border-amber-500/25',
                },
                {
                  id: 'approved' as const,
                  label: 'Onaylandı',
                  count: counts.approved,
                  activeCls:
                    'bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold shadow-lg shadow-emerald-500/25 border-emerald-400/40',
                  inactiveCls:
                    'bg-emerald-500/10 text-emerald-300 hover:text-white hover:bg-emerald-500/20 border-emerald-500/25',
                },
                {
                  id: 'rejected' as const,
                  label: 'Reddedildi',
                  count: counts.rejected,
                  activeCls:
                    'bg-gradient-to-r from-rose-500 to-red-600 text-white font-extrabold shadow-lg shadow-rose-500/25 border-rose-400/40',
                  inactiveCls:
                    'bg-rose-500/10 text-rose-300 hover:text-white hover:bg-rose-500/20 border-rose-500/25',
                },
              ].map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-4 py-2 rounded-2xl text-xs font-bold border transition-all flex items-center gap-2 shrink-0 cursor-pointer active:scale-95 ${
                      active ? tab.activeCls : tab.inactiveCls
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        active ? 'bg-white/25 text-white' : 'bg-white/10 text-white'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {!user ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-10 text-center space-y-3">
              <p className="text-sm text-zinc-400">
                Gönderdiğiniz seri isteklerini ve onay durumlarını takip etmek için giriş yapın.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal('Seri isteklerinizi görüntülemek için lütfen giriş yapın.')}
                className="px-5 py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-zinc-200 transition-colors"
              >
                Giriş Yap
              </button>
            </div>
          ) : isLoadingRequests && myRequests.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-44 rounded-3xl bg-white/[0.03] border border-white/5 animate-pulse"
                />
              ))}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-12 text-center space-y-2">
              <p className="text-sm font-bold text-zinc-300">
                Henüz bu kategoride bir seri isteğiniz bulunmuyor.
              </p>
              <p className="text-xs text-zinc-500">
                Yukarıdaki formdan AniList, TMDB, MyDramaList veya IMDb linki ile hemen istek gönderebilirsiniz.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredRequests.map((req) => {
                const srcCfg =
                  SOURCE_CONFIG[req.source_type] || SOURCE_CONFIG.tmdb;
                const statusBadge =
                  req.status === 'approved'
                    ? {
                        label: 'Onaylandı',
                        icon: <CheckCircle2 size={13} />,
                        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                      }
                    : req.status === 'rejected'
                    ? {
                        label: 'Reddedildi',
                        icon: <XCircle size={13} />,
                        cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
                      }
                    : {
                        label: 'Bekliyor',
                        icon: <Clock size={13} />,
                        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                      };

                return (
                  <motion.div
                    key={req.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-3xl border border-white/10 bg-[#0d0d11]/90 hover:border-white/20 p-4 sm:p-5 flex gap-4 transition-all relative overflow-hidden group"
                  >
                    {/* Poster */}
                    <div className="w-24 sm:w-28 aspect-[2/3] rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0">
                      {req.cover_image ? (
                        <img
                          src={req.cover_image}
                          alt={req.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          <Film size={24} />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between space-y-2">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${statusBadge.cls}`}
                            >
                              {statusBadge.icon}
                              {statusBadge.label}
                            </span>
                            <a
                              href={req.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border hover:opacity-80 transition-opacity ${srcCfg.badgeClass}`}
                            >
                              {srcCfg.label}
                              <ExternalLink size={10} />
                            </a>
                          </div>

                          {req.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRequest(req.id)}
                              disabled={deletingId === req.id}
                              title="İsteği Geri Çek"
                              className="p-1.5 rounded-xl text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            >
                              {deletingId === req.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          )}
                        </div>

                        <h3 className="text-sm sm:text-base font-extrabold text-white line-clamp-1">
                          {req.title}
                        </h3>

                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                          {req.overview || 'Açıklama bulunmuyor.'}
                        </p>

                        {req.user_note && (
                          <div className="text-[11px] text-zinc-400 bg-white/[0.03] border border-white/5 rounded-xl px-2.5 py-1.5">
                            <span className="font-bold text-zinc-300">Notunuz:</span> {req.user_note}
                          </div>
                        )}

                        {req.admin_note && (
                          <div className="text-[11px] text-sky-200 bg-sky-500/10 border border-sky-500/20 rounded-xl px-2.5 py-1.5">
                            <span className="font-bold text-sky-300">Yönetici Notu:</span>{' '}
                            {req.admin_note}
                          </div>
                        )}
                      </div>

                      <div className="pt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                        <span>
                          {new Date(req.created_at).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>

                        {req.media_slug && (
                          <Link
                            href={`/seri/${req.media_slug}`}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] transition-colors"
                          >
                            <Check size={12} />
                            Seriyi İzle
                          </Link>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
