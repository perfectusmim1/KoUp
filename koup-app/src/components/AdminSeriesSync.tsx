'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import KoupInput from '@/components/KoupInput';
import { useKoUpSelector } from '@/context/KoUpContext';

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
    label: "Özel Dizi URL'si Gir...",
    description: "DiziBOX, HDFilm vb. doğrudan dizi URL'si yapıştırın",
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
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [internalPendingCount, setInternalPendingCount] = useState<number | null>(null);

  // Active Job & Live Tracking
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [githubRunUrl, setGithubRunUrl] = useState<string | null>(null);

  // Manual URL Modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualUrlInput, setManualUrlInput] = useState('');

  // Logs Modal
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (showLogsModal && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogsModal]);

  // Clear toast after 5s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Fetch initial pending count
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

  // Apply state update from Supabase Realtime or Poller
  const applyJobState = useCallback(
    (job: any) => {
      if (!job) return;

      if (job.external_ref) {
        setGithubRunUrl(job.external_ref);
      }

      if (Array.isArray(job.logs) && job.logs.length > 0) {
        setLogs(job.logs);
      }

      const st = job.status as 'queued' | 'running' | 'completed' | 'failed';
      setSyncStatus(st);
      if (typeof job.progress === 'number') {
        setSyncProgress(job.progress);
      }

      if (st === 'queued') {
        setIsSyncing(true);
        setStatusText('Kuyrukta (GitHub Actions Bekleniyor...)');
      } else if (st === 'running') {
        setIsSyncing(true);
        const lastLog = Array.isArray(job.logs) && job.logs.length > 0 ? job.logs[job.logs.length - 1] : null;
        const cleanMsg = lastLog ? lastLog.replace(/^\[[^\]]+\]\s*(\[[^\]]+\]\s*)?/, '').slice(0, 36) : null;
        setStatusText(cleanMsg || `Bulutta Taranıyor (%${job.progress || 40})`);
      } else if (st === 'completed') {
        setIsSyncing(false);
        setStatusText('Tamamlandı!');
        setSyncProgress(100);
        triggerSound('success');

        const epAdded = job.result?.episodesAdded ?? 0;
        const srcAdded = job.result?.sourcesAdded ?? 0;
        const resolvedProv = job.params?.provider || selectedProvider;

        setToast({
          type: 'success',
          message: `Senkronizasyon tamamlandı (${resolvedProv.toUpperCase()}): +${epAdded} yeni bölüm, +${srcAdded} yeni kaynak!`,
        });

        if (onSyncComplete) {
          onSyncComplete({ episodesAdded: epAdded, sourcesAdded: srcAdded, provider: resolvedProv });
        }
      } else if (st === 'failed') {
        setIsSyncing(false);
        setStatusText('Hata Oluştu');
        triggerSound('click');
        setToast({
          type: 'error',
          message: job.error_message || 'Senkronizasyon işlemi hata ile sonuçlandı.',
        });
      }
    },
    [onSyncComplete, selectedProvider]
  );

  // Supabase Realtime listener & polling fallback for active job
  useEffect(() => {
    if (!activeJobId) return;

    let isSubscribed = true;
    const channel = supabase
      .channel(`realtime:admin_job:${activeJobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'admin_jobs',
          filter: `id=eq.${activeJobId}`,
        },
        (payload: any) => {
          if (!isSubscribed) return;
          applyJobState(payload.new);
        }
      )
      .subscribe();

    // Secondary fallback poller (every 2.5s) in case WebSocket reconnects
    const pollInterval = setInterval(async () => {
      if (!isSubscribed) return;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const res = await fetch(`/api/admin/sync-series?jobId=${activeJobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (isSubscribed && data.job) {
            applyJobState(data.job);
            if (data.job.status === 'completed' || data.job.status === 'failed') {
              clearInterval(pollInterval);
            }
          }
        }
      } catch {}
    }, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [activeJobId, applyJobState]);

  // Check on mount if an active sync job is already running for this drama
  useEffect(() => {
    if (!dramaId) return;
    let isCancelled = false;

    async function checkExistingJob() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const res = await fetch(`/api/admin/sync-series?dramaId=${dramaId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.job && (data.job.status === 'queued' || data.job.status === 'running')) {
            const ageMs = Date.now() - new Date(data.job.created_at).getTime();
            // Only attach if started within last 20 minutes
            if (ageMs < 1200000) {
              setActiveJobId(data.job.id);
              applyJobState(data.job);
            }
          }
        }
      } catch {}
    }

    void checkExistingJob();
    return () => {
      isCancelled = true;
    };
  }, [dramaId, applyJobState]);

  const prefetchAnimecixFromEdge = async (
    prov: string,
    effectiveUrl?: string
  ): Promise<{ animeId: number; targetName: string; isMovie: boolean; videos: any[] } | null> => {
    try {
      const edgeProxy = (target: string) =>
        `https://koup-edge-worker.caganhuseyinerdil.workers.dev/pichive-proxy?url=${encodeURIComponent(
          target
        )}&ref=${encodeURIComponent('https://animecix.tv/')}`;

      let animeId: number | null = null;
      let targetName = dramaTitle;
      let isMovie = false;

      if (effectiveUrl) {
        const mUrl = effectiveUrl.match(/\/titles\/(\d+)/i);
        if (mUrl?.[1]) {
          animeId = parseInt(mUrl[1], 10);
        } else if (/^\d+$/.test(effectiveUrl.trim())) {
          animeId = parseInt(effectiveUrl.trim(), 10);
        }
      }

      const { data: mediaRow } = await supabase
        .from('media')
        .select('id, title, native_title, content_type, source_url, release_year')
        .eq('id', dramaId)
        .maybeSingle();

      if (mediaRow?.content_type === 'film') {
        isMovie = true;
      }

      if (!animeId && mediaRow?.source_url) {
        const mSrc = String(mediaRow.source_url).match(/\/titles\/(\d+)/i);
        if (mSrc?.[1]) {
          animeId = parseInt(mSrc[1], 10);
        }
      }

      const isExplicitAnimecix =
        prov === 'animecix' ||
        Boolean(effectiveUrl && /animecix|mangacix/i.test(effectiveUrl)) ||
        Boolean(animeId) ||
        (prov === 'auto' && mediaRow?.content_type === 'anime');

      if (!isExplicitAnimecix) {
        return null;
      }

      if (!animeId) {
        setStatusText('AnimeciX Üzerinde Aranıyor...');
        const norm = (s: string) =>
          (s || '')
            .toLowerCase()
            .replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
            .trim();

        const queries = Array.from(
          new Set([dramaTitle, mediaRow?.title, mediaRow?.native_title].filter(Boolean) as string[])
        );

        for (const q of queries) {
          const searchUrl = edgeProxy(
            `https://animecix.tv/secure/search/${encodeURIComponent(q.trim())}?limit=12&_=.mp4`
          );
          const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(7000) }).catch(() => null);
          if (!sRes || !sRes.ok) continue;
          const sJson = await sRes.json().catch(() => null);
          const results: any[] = sJson?.results || sJson?.pagination?.data || [];
          const targetNorm = norm(q);

          let bestItem: any = null;
          let bestScore = 0;
          for (const item of results) {
            if (!item?.id) continue;
            for (const cand of [item.name, item.name_english, item.original_title]) {
              if (!cand) continue;
              const cNorm = norm(cand);
              if (!cNorm) continue;
              let score = 0;
              if (cNorm === targetNorm) {
                score = 1.0;
              } else if (cNorm.includes(targetNorm) || targetNorm.includes(cNorm)) {
                const shorter = Math.min(cNorm.length, targetNorm.length);
                const longer = Math.max(cNorm.length, targetNorm.length);
                score = 0.78 + (shorter / Math.max(1, longer)) * 0.2;
              }
              if (mediaRow?.release_year && item.year && Number(mediaRow.release_year) === Number(item.year)) {
                score += 0.05;
              }
              if (score > bestScore) {
                bestScore = score;
                bestItem = item;
              }
            }
          }

          if (bestItem && bestScore >= 0.75) {
            animeId = Number(bestItem.id);
            targetName = bestItem.name || bestItem.name_english || dramaTitle;
            if (bestItem.title_type === 'movie' || bestItem.is_movie) {
              isMovie = true;
            }
            break;
          }
        }
      }

      if (!animeId) {
        return null;
      }

      setStatusText(`AnimeciX #${animeId} Bölümleri Çekiliyor...`);
      const allVideos: any[] = [];
      let page = 1;
      while (page <= 20) {
        const vUrl = edgeProxy(
          `https://animecix.tv/secure/videos?titleId=${animeId}&page=${page}&perPage=100&_=.mp4`
        );
        const vRes = await fetch(vUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (!vRes || !vRes.ok) break;
        const vJson = await vRes.json().catch(() => null);
        const pageVideos: any[] = vJson?.pagination?.data || [];
        if (!pageVideos.length) break;
        allVideos.push(...pageVideos);
        const lastPage = Number(vJson?.pagination?.last_page || 1);
        if (page >= lastPage) break;
        page += 1;
      }

      if (allVideos.length === 0) {
        return null;
      }

      return {
        animeId,
        targetName,
        isMovie,
        videos: allVideos,
      };
    } catch {
      return null;
    }
  };

  const handleTriggerSync = async (providerOverride?: string, customUrl?: string) => {
    const prov = providerOverride || selectedProvider;
    const effectiveManualUrl = customUrl || (prov === '__manual__' ? manualUrlInput : undefined);
    setIsSyncing(true);
    setSyncStatus('queued');
    setSyncProgress(10);
    setStatusText('Kuyruğa Alınıyor...');
    setLogs([]);
    triggerSound('click');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const prefetchedAnimecix = await prefetchAnimecixFromEdge(prov, effectiveManualUrl);
      if (prefetchedAnimecix) {
        setSyncProgress(45);
        setStatusText(`AnimeciX (${prefetchedAnimecix.videos.length} Kaynak) Eşitleniyor...`);
      }

      const res = await fetch('/api/admin/sync-series', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          dramaId,
          slug: dramaSlug,
          dramaTitle,
          provider: prov,
          manualUrl: effectiveManualUrl,
          prefetchedAnimecix: prefetchedAnimecix || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Senkronizasyon işlemi başlatılamadı.');
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleMessage = (lineStr: string) => {
          const trimmed = lineStr.trim();
          if (!trimmed) return;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'job_created' && msg.jobId) {
              setActiveJobId(msg.jobId);
              setSyncStatus(msg.status || 'queued');
            } else if (msg.type === 'log' && msg.line) {
              setLogs((prev) => [...prev, msg.line]);
              const cleanStatus = msg.line.replace(/^\[[^\]]+\]\s*(\[[^\]]+\]\s*)?/, '').slice(0, 36);
              if (cleanStatus) setStatusText(cleanStatus);
            } else if (msg.type === 'result') {
              if (msg.jobId) {
                setActiveJobId(msg.jobId);
              }
              if (msg.cloud) {
                // In cloud mode, keep syncing state active and let Supabase Realtime update it!
                setIsSyncing(true);
                setSyncStatus('queued');
                setStatusText('Kuyrukta (GitHub Actions Bekleniyor...)');
                setSyncProgress(20);
              } else {
                // Local mode finished
                setIsSyncing(false);
                setSyncStatus('completed');
                setSyncProgress(100);
                triggerSound('success');
                const epAdded = msg.episodesAdded ?? 0;
                const srcAdded = msg.sourcesAdded ?? 0;
                setToast({
                  type: 'success',
                  message: `Senkronizasyon tamamlandı (${(msg.provider || prov).toUpperCase()}): +${epAdded} yeni bölüm, +${srcAdded} yeni kaynak!`,
                });
                if (onSyncComplete) {
                  onSyncComplete({ episodesAdded: epAdded, sourcesAdded: srcAdded, provider: msg.provider || prov });
                }
              }
            } else if (msg.type === 'error') {
              setLogs((prev) => [...prev, `[HATA] ${msg.error}`]);
              setSyncStatus('failed');
              setIsSyncing(false);
              throw new Error(msg.error);
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
      } else {
        const data = await res.json();
        if (!data.ok) {
          throw new Error(data.error || 'Senkronizasyon başlatılamadı.');
        }
        if (data.jobId) {
          setActiveJobId(data.jobId);
        }
      }
    } catch (err: any) {
      console.error('Sync failed:', err);
      setSyncStatus('failed');
      setIsSyncing(false);
      setStatusText(null);
      setToast({
        type: 'error',
        message: err.message || 'Senkronizasyon sırasında hata oluştu.',
      });
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

      {/* Main Trigger / CustomSelect or Live Status Button */}
      {isSyncing ? (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLogsModal(true)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer shadow-lg ${
              syncStatus === 'queued'
                ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 hover:bg-amber-500/25'
                : 'bg-sky-500/15 border-sky-500/35 text-sky-300 hover:bg-sky-500/25'
            }`}
          >
            {syncStatus === 'queued' ? (
              <Clock className="w-3.5 h-3.5 animate-pulse text-amber-400" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
            )}
            <span>{statusText || (syncStatus === 'queued' ? 'Kuyrukta Bekliyor...' : 'Bulutta Taranıyor...')}</span>
            {syncProgress > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-[10px] font-mono text-white/80">
                %{syncProgress}
              </span>
            )}
          </button>
        </div>
      ) : (
        <CustomSelect
          value={selectedProvider}
          onChange={handleProviderSelect}
          options={SYNC_OPTIONS}
          triggerLabel="Senkronize Et"
          leftIcon={<RefreshCw className="w-3.5 h-3.5 text-sky-400" />}
          disabled={isSyncing}
          size="sm"
          variant="glass"
          triggerClassName="px-3.5 py-1.5 text-xs rounded-full gap-2 hover:border-white/30 transition-all font-bold cursor-pointer"
          menuClassName="min-w-[280px] max-w-[340px]"
          searchPlaceholder="Sağlayıcı veya site ara..."
          direction="auto"
        />
      )}

      {/* Pending Episodes Badge for Admins */}
      {effectivePendingCount > 0 && !isSyncing && (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0"
          title={`${effectivePendingCount} bölüm henüz oynatılabilir video kaynağına sahip değil ("pending_source")`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>{effectivePendingCount} kaynak bekliyor</span>
        </span>
      )}

      {/* View Live Logs Button */}
      {logs.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLogsModal(true)}
          className={`text-[11px] font-mono flex items-center gap-1.5 transition-colors px-2.5 py-1 rounded-full border cursor-pointer ${
            isSyncing
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20'
              : 'bg-white/[0.04] border-white/10 text-white/60 hover:text-white'
          }`}
        >
          <Terminal className="w-3 h-3 text-sky-400" />
          <span>{isSyncing ? `Canlı Terminal (${logs.length})` : `Günlük (${logs.length})`}</span>
          {isSyncing && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />}
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

      {/* Logs Inspection Modal with Realtime Terminal */}
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
              exit={{ opacity: 0, scale: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-2xl rounded-3xl bg-[#0c0c0e] border border-white/15 p-6 shadow-2xl flex flex-col max-h-[85vh] z-10"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Senkronizasyon Canlı Konsolu</span>
                      {isSyncing && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                          <span>CANLI</span>
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-white/40 mt-0.5 font-mono">
                      {dramaTitle} (#{dramaId})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={githubRunUrl || 'https://github.com/perfectusmim1/KoUp/actions'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <span>GitHub Actions</span>
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

              {/* Progress Bar */}
              {isSyncing && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-1">
                    <span>{statusText || 'İşleniyor...'}</span>
                    <span className="text-sky-400 font-bold">%{syncProgress}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-sky-400 via-indigo-400 to-emerald-400 rounded-full"
                      animate={{ width: `${Math.max(5, syncProgress)}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              )}

              {/* Terminal Logs Output */}
              <div className="flex-1 overflow-y-auto p-4 rounded-2xl bg-black/80 border border-white/10 font-mono text-[11px] text-emerald-300/90 space-y-1.5 min-h-[240px] max-h-[420px] select-text">
                {logs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-white/30 italic">
                    Konsol çıktısı bekleniyor...
                  </div>
                ) : (
                  logs.map((line, idx) => {
                    const isErr = line.includes('[HATA]') || line.includes('[UYARI]') || line.includes('Error');
                    const isSuccess = line.includes('[BAŞARILI]') || line.includes('[TAMAMLANDI]');
                    const isSection = line.startsWith('===');
                    return (
                      <div
                        key={idx}
                        className={`whitespace-pre-wrap leading-relaxed ${
                          isErr
                            ? 'text-rose-400 font-bold'
                            : isSuccess
                            ? 'text-emerald-400 font-bold'
                            : isSection
                            ? 'text-sky-400 font-bold pt-1 pb-0.5'
                            : 'text-zinc-300'
                        }`}
                      >
                        {line}
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-[11px] font-mono text-white/40">
                  {logs.length} satır günlük kaydedildi
                </span>
                <button
                  type="button"
                  onClick={() => setShowLogsModal(false)}
                  className="px-5 py-2 rounded-full glass-pill text-white font-semibold text-xs transition-colors cursor-pointer"
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
