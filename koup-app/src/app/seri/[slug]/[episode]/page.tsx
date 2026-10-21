'use client';

import React, { useState, useEffect, useRef, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Droplets,
  Zap,
  Angry,
  CheckCircle2,
  Check,
  RotateCcw,
  AlertTriangle,
  Play,
  Film,
  Layers,
  Lightbulb,
  Sparkles,
  SkipForward,
  Maximize,
  Eye,
  X,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  EpisodeSource,
  COUNTRY_LABELS,
  getProxiedImageUrl,
  cleanMediaTitle,
  cleanQualityLabel,
  cleanEpisodeName,
  formatEpisodeTitle,
  getEpisodeProgress,
  cleanScrapedSlug,
  formatViewCount,
} from '@/lib/supabase';
import { trackMediaView } from '@/lib/viewTracker';
import { cachedQuery, getCache, getMediaFromCache, registerMediaItem, updateCachedMedia } from '@/lib/cache';
import { recordTasteSignal } from '@/lib/tasteProfile';
import { cleanSourceName } from '@/lib/cleanFansub';
import dynamic from 'next/dynamic';
import { useKoUpSelector } from '@/context/KoUpContext';
import NetflixPlayer from '@/components/NetflixPlayer';
import CountryFlag from '@/components/CountryFlag';
import CustomSelect from '@/components/CustomSelect';
import EpisodeRail from '@/components/EpisodeRail';

const RichCommentSection = dynamic(
  () => import('@/components/RichCommentSection'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[280px] rounded-3xl bg-[#0f0f11] border border-white/[0.08]" />
    ),
  }
);

const EMPTY_WATCHED_ARRAY: number[] = [];

export default function EpisodeWatchPage({
  params,
}: {
  params: Promise<{ slug: string; episode: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { slug, episode } = use(params);
  const currentEpNum = Number.isNaN(Number(episode)) ? 1 : Number(episode);
  const urlSeason = searchParams.get('season');
  const urlSeasonNum = urlSeason ? Number(urlSeason) : null;

  // Active episode state for seamless in-player transitions without unmounting or leaving fullscreen
  const [activeEpNum, setActiveEpNum] = useState<number>(currentEpNum);

  useEffect(() => {
    setActiveEpNum(currentEpNum);
  }, [currentEpNum]);

  const user = useKoUpSelector((s) => s.user);
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const toggleEpisodeWatched = useKoUpSelector((s) => s.toggleEpisodeWatched);
  const updateEpisodeProgress = useKoUpSelector((s) => s.updateEpisodeProgress);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const openAuthModal = useKoUpSelector((s) => s.openAuthModal);
  const isSoftBanned = useKoUpSelector((s) => s.isSoftBanned);

  // Initialize deterministically on both SSR and Client initial pass to prevent Hydration Mismatch!
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [currentSeason, setCurrentSeason] = useState(urlSeasonNum || 1);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedSourceIdx, setSelectedSourceIdx] = useState(0);
  const preferredSourceRef = useRef<{ provider?: string; source_name?: string }>({});
  const [liveEpisodeViews, setLiveEpisodeViews] = useState<Record<string, number>>({});

  const handleSelectSourceIdx = useCallback((idx: number) => {
    setSelectedSourceIdx(idx);
  }, []);

  // Ambient Lighting (persisted across episode changes and refreshes)
  const [ambientLightingEnabled, setAmbientLightingEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_ambient_lighting');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      const savedAmbient = localStorage.getItem('koup_ambient_lighting');
      if (savedAmbient !== null) {
        setAmbientLightingEnabled(savedAmbient === 'true');
      }
    } catch {}
  }, []);

  const handleToggleAmbientLighting = () => {
    setAmbientLightingEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_ambient_lighting', String(next));
      } catch {}
      return next;
    });
  };

  // Otomatik Sonraki Bölüm (persisted in localStorage)
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_auto_next');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const handleToggleAutoNext = () => {
    setAutoNextEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_auto_next', String(next));
      } catch {}
      return next;
    });
  };

  // Seamless episode switching: preserves identical video source & fansub across episodes if available
  const handleSelectEpisode = useCallback(
    (s: number, e: number) => {
      const targetSeason = s || currentSeason || 1;
      const targetEpNum = e;
      setActiveEpNum(targetEpNum);
      if (s) setCurrentSeason(targetSeason);

      // Smart source persistence: match previous active source provider or source name in target episode
      const targetEp = episodes.find(
        (ep) => (ep.season_number || 1) === targetSeason && ep.episode_number === targetEpNum
      );

      const pref = preferredSourceRef.current;
      if (targetEp && Array.isArray(targetEp.sources) && targetEp.sources.length > 0) {
        const candidates = targetEp.sources;

        // Find matching source index (exact provider + source_name, then same provider, then same source_name)
        let matchIdx = candidates.findIndex((src) => {
          const pMatch = pref.provider && src.provider && src.provider.toLowerCase() === pref.provider.toLowerCase();
          const nMatch = pref.source_name && src.source_name && cleanSourceName(src.source_name).toLowerCase() === pref.source_name.toLowerCase();
          return pMatch && nMatch;
        });

        if (matchIdx < 0 && pref.provider) {
          matchIdx = candidates.findIndex(
            (src) => src.provider && src.provider.toLowerCase() === pref.provider!.toLowerCase()
          );
        }

        if (matchIdx < 0 && pref.source_name) {
          matchIdx = candidates.findIndex(
            (src) => src.source_name && cleanSourceName(src.source_name).toLowerCase() === pref.source_name!.toLowerCase()
          );
        }

        setSelectedSourceIdx(matchIdx >= 0 ? matchIdx : 0);
      } else {
        setSelectedSourceIdx(0);
      }

      const targetSlug = media?.slug || slug;
      const newUrl = `/seri/${targetSlug}/${e}?season=${targetSeason}`;
      window.history.pushState(null, '', newUrl);
    },
    [media?.slug, slug, currentSeason, episodes]
  );

  // Sync state if user clicks browser Back / Forward buttons
  useEffect(() => {
    const onPopState = () => {
      const parts = window.location.pathname.split('/');
      const epFromUrl = Number(parts[parts.length - 1]);
      const sp = new URLSearchParams(window.location.search);
      const sFromUrl = Number(sp.get('season')) || 1;
      if (epFromUrl && !isNaN(epFromUrl)) {
        setActiveEpNum(epFromUrl);
        setCurrentSeason(sFromUrl);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Synced Video Player height for right rail
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);

  // Keep right episode rail height in perfect pixel sync with the video player
  useEffect(() => {
    const el = playerContainerRef.current;
    if (!el) return;

    const updateHeight = () => {
      const h = el.offsetHeight;
      if (h > 0) {
        setPlayerHeight(h);
      }
    };

    updateHeight();

    const ro = new ResizeObserver(() => {
      updateHeight();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  // Single-vote reaction per episode per user (fire, cry, shock, angry)
  const [userReaction, setUserReaction] = useState<'fire' | 'cry' | 'shock' | 'angry' | null>(null);
  const [reactionCounts, setReactionCounts] = useState<{
    fire: number;
    cry: number;
    shock: number;
    angry: number;
  }>({ fire: 0, cry: 0, shock: 0, angry: 0 });

  // Issue report drawer
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState('Kaynak Açılmıyor / Kırık');
  const [reportNote, setReportNote] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportCooldownSec, setReportCooldownSec] = useState<number>(0);

  // Issue report rate-limit cooldown tracker
  useEffect(() => {
    try {
      const lastReport = Number(localStorage.getItem('koup_last_issue_report_time') || 0);
      const diff = Math.ceil((60_000 - (Date.now() - lastReport)) / 1000);
      if (diff > 0) setReportCooldownSec(diff);
    } catch {}
  }, []);

  useEffect(() => {
    if (reportCooldownSec <= 0) return;
    const timer = setInterval(() => {
      setReportCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [reportCooldownSec]);

  const handleToggleWatchedEpisode = (ep: EpisodeData) => {
    if (!user) {
      openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
      return;
    }
    if (isSoftBanned) {
      return;
    }
    if (!media) return;

    // Toggle watched in KoUp context without annoying toast popups
    toggleEpisodeWatched(media, ep.episode_number);
  };

  // Reset source selection on episode change
  useEffect(() => {
    setSelectedSourceIdx(0);
  }, [activeEpNum]);

  useEffect(() => {
    let isCancelled = false;
    const decodedSlug = decodeURIComponent(slug);
    const cachedMedia = getMediaFromCache(decodedSlug);
    const cachedEpisodesRaw = cachedMedia
      ? getCache<EpisodeData[]>(`episodes_${cachedMedia.id}`, true) || []
      : [];
    const cachedEpisodes = cachedEpisodesRaw.map((ep) => ({
      ...ep,
      sources: (ep.sources || []).filter(
        (s) =>
          s?.direct_url &&
          s.direct_url.startsWith('http') &&
          !s.direct_url.includes('javascript:') &&
          !s.direct_url.includes('void(0)') &&
          !s.direct_url.includes('embed-7fm0wb9yzf4m.html') &&
          !s.direct_url.includes('playerdkorea.xyz') &&
          !s.direct_url.includes('asyaanim.upns.one') &&
          !s.direct_url.includes('vidmoly.me') &&
          s.provider !== 'dead' &&
          s.provider !== 'sibnet' &&
          s.provider !== 'sendvid' &&
          s.provider !== 'pixeldrain'
      ),
    }));

    if (cachedMedia) {
      setMedia(cachedMedia);
      if (cachedEpisodes.length > 0) {
        setEpisodes(cachedEpisodes);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
    } else {
      setIsLoading(true);
    }

    async function loadEpisodeData() {
      const rawMediaItem = await cachedQuery<any>(
        `media_item_${decodedSlug}`,
        300_000,
        async () => {
          let { data: mData } = await supabase
            .from('media')
            .select('*')
            .eq('slug', decodedSlug)
            .single();

          if (!mData) {
            const cleanedSlug = cleanScrapedSlug(decodedSlug);
            if (cleanedSlug && cleanedSlug !== decodedSlug) {
              const { data: cleanRow } = await supabase
                .from('media')
                .select('*')
                .eq('slug', cleanedSlug)
                .maybeSingle();
              mData = cleanRow;

              if (!mData) {
                const { data: prefixRows } = await supabase
                  .from('media')
                  .select('*')
                  .ilike('slug', `${cleanedSlug}%`)
                  .limit(1);
                if (prefixRows && prefixRows[0]) {
                  mData = prefixRows[0];
                }
              }
            }
          }

          if (!mData) {
            const { data: akaRows } = await supabase
              .from('media')
              .select('*')
              .contains('aka_titles', [decodedSlug])
              .limit(1);
            if (akaRows && akaRows[0]) {
              mData = akaRows[0];
            }
          }

          if (!mData) {
            const { data: fallbackRows } = await supabase
              .from('media')
              .select('*')
              .or(`slug.eq.${decodedSlug}-izle,slug.ilike.${decodedSlug}%`)
              .limit(1);
            if (fallbackRows && fallbackRows[0]) {
              mData = fallbackRows[0];
            }
          }

          if (!mData && !Number.isNaN(Number(decodedSlug))) {
            const byId = await supabase
              .from('media')
              .select('*')
              .eq('id', Number(decodedSlug))
              .single();
            mData = byId.data;
          }

          return (mData as MediaItem) || null;
        }
      );

      if (isCancelled) return;

      const mediaItem: MediaItem | null =
        rawMediaItem?.media ? rawMediaItem.media : rawMediaItem;

      if (!mediaItem || !mediaItem.id) {
        setIsLoading(false);
        return;
      }

      if (typeof window !== 'undefined' && mediaItem.slug && mediaItem.slug !== decodedSlug) {
        window.history.replaceState(
          null,
          '',
          `/seri/${mediaItem.slug}/${currentEpNum}${window.location.search}`
        );
      }
      registerMediaItem(mediaItem, true);
      recordTasteSignal(mediaItem, 'watch');
      setMedia(mediaItem);

      // Fetch verified episode sources directly from edge resolver
      try {
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(`koup_cache_episodes_${mediaItem.id}`);
          } catch {}
        }
        const res = await fetch(`/api/sources/${mediaItem.id}`, { cache: 'no-store' });
        const payload = await res.json();
        const rawEps: EpisodeData[] = (payload.episodes || []).map((ep: EpisodeData) => ({
          ...ep,
          sources: (ep.sources || []).filter(
            (s) => s?.direct_url && s.direct_url.startsWith('http') && !s.direct_url.includes('javascript:') && !s.direct_url.includes('void(0)')
          ),
        }));
        if (isCancelled) return;

        // Sort episodes strictly by season then episode number
        const sortedEps = [...rawEps].sort(
          (a, b) =>
            (a.season_number || 1) - (b.season_number || 1) ||
            a.episode_number - b.episode_number
        );
        setEpisodes(sortedEps);

        const currentEp =
          (urlSeasonNum
            ? sortedEps.find(
                (e) =>
                  (e.season_number || 1) === urlSeasonNum &&
                  e.episode_number === currentEpNum
              )
            : null) ||
          sortedEps.find(
            (e) =>
              (e.season_number || 1) === currentSeason &&
              e.episode_number === currentEpNum
          ) ||
          sortedEps.find((e) => e.episode_number === currentEpNum) ||
          sortedEps[0];
        const activeSeason = currentEp?.season_number || urlSeasonNum || currentSeason || 1;
        setCurrentSeason(activeSeason);

        // Update watching status in KoUpContext progress map (authenticated users only)
        if (user) {
          const existingProg = progressMap[mediaItem.id];
          const urlSeekSec = Number(searchParams.get('t')) || 0;
          const targetEpNum = currentEp?.episode_number !== undefined ? currentEp.episode_number : currentEpNum;
          const savedEpProg = getEpisodeProgress(
            existingProg,
            mediaItem.id,
            activeSeason,
            targetEpNum
          );
          const initialPos = urlSeekSec > 0 ? urlSeekSec : (savedEpProg.position || 0);
          const mediaDuration =
            (mediaItem.duration_minutes ? mediaItem.duration_minutes * 60 : 0) ||
            savedEpProg.duration ||
            (existingProg?.resume_duration_sec || 3600);

          updateEpisodeProgress(
            mediaItem,
            activeSeason,
            targetEpNum,
            formatEpisodeTitle(
              currentEp?.episode_name,
              activeSeason,
              targetEpNum
            ),
            initialPos,
            mediaDuration,
            false,
            { reason: 'playback' }
          );
        }
      } catch (err) {
        console.error('Error loading episode data:', err);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadEpisodeData();

    return () => {
      isCancelled = true;
    };
  }, [slug, currentEpNum, urlSeasonNum]);

  // Real-time synchronization of episode reaction counts & logged-in user reaction on mount, season/ep switch, and auth change
  useEffect(() => {
    if (!media?.id) return;
    const mediaId = media.id;
    let isMounted = true;

    // Instant synchronous cache restore to prevent any flicker or focus loss on F5
    try {
      const localSaved = localStorage.getItem(`koup_reaction_${mediaId}_${currentSeason}_${activeEpNum}`);
      if (localSaved && ['fire', 'cry', 'shock', 'angry'].includes(localSaved)) {
        setUserReaction(localSaved as any);
      }
    } catch {}

    async function syncReactions() {
      try {
        // 1. Fetch live aggregate reaction counts directly from Supabase episodes table
        const { data: epRow } = await supabase
          .from('episodes')
          .select('react_fire, react_cry, react_shock, react_angry')
          .eq('media_id', mediaId)
          .eq('season_number', currentSeason)
          .eq('episode_number', activeEpNum)
          .maybeSingle();

        if (isMounted && epRow) {
          setReactionCounts({
            fire: epRow.react_fire || 0,
            cry: epRow.react_cry || 0,
            shock: epRow.react_shock || 0,
            angry: epRow.react_angry || 0,
          });
        }

        // 2. Fetch logged-in user's active reaction (directly check session to avoid waiting for context)
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUid = sessionData?.session?.user?.id || user?.id;

        if (activeUid) {
          const { data: userReactRow } = await supabase
            .from('episode_reactions')
            .select('reaction')
            .eq('user_id', activeUid)
            .eq('media_id', mediaId)
            .eq('season_number', currentSeason)
            .eq('episode_number', activeEpNum)
            .maybeSingle();

          if (isMounted) {
            const serverReaction = (userReactRow?.reaction as any) || null;
            setUserReaction(serverReaction);
            try {
              if (serverReaction) {
                localStorage.setItem(`koup_reaction_${mediaId}_${currentSeason}_${activeEpNum}`, serverReaction);
              } else {
                localStorage.removeItem(`koup_reaction_${mediaId}_${currentSeason}_${activeEpNum}`);
              }
            } catch {}
          }
        }
      } catch (err) {
        console.error('Error syncing episode reactions:', err);
      }
    }

    syncReactions();

    return () => {
      isMounted = false;
    };
  }, [media?.id, currentSeason, activeEpNum, user?.id]);

  // Track per-episode view with anti-F5 protection and live count sync
  useEffect(() => {
    if (!media?.id || activeEpNum === undefined || activeEpNum === null) return;
    const mId = media.id;
    const sNum = currentSeason || 1;
    const eNum = activeEpNum;

    trackMediaView(mId, 'watch', sNum, eNum, (res) => {
      if (typeof res.views_total === 'number') {
        setMedia((prev) =>
          prev && prev.id === mId
            ? { ...prev, views_total: res.views_total! }
            : prev
        );
        updateCachedMedia({ id: mId, slug: media.slug, views_total: res.views_total });
      }
      if (typeof res.episode_views === 'number') {
        const epKey = `${sNum}_${eNum}`;
        setLiveEpisodeViews((prev) => ({ ...prev, [epKey]: res.episode_views! }));
        setEpisodes((prev) =>
          prev.map((ep) =>
            (ep.season_number || 1) === sNum && ep.episode_number === eNum
              ? { ...ep, views_count: res.episode_views }
              : ep
          )
        );
      }
    });
  }, [media?.id, currentSeason, activeEpNum]);

  // Dynamic document title
  useEffect(() => {
    if (media?.title) {
      document.title = `${cleanMediaTitle(media.title)} ${activeEpNum}. Bölüm İzle • KoUp Sinema`;
    }
  }, [media?.title, activeEpNum]);

  // Robust episode bounds checking
  const isFilm = Boolean(
    media && (
      media.content_type === 'film' ||
      media.content_type === 'movie' ||
      ((media.episode_count === 1 || episodes.length <= 1) && media.content_type !== 'dizi')
    )
  );
  const isMovie = isFilm;
  const currentEpIndex = episodes.findIndex(
    (e) => (e.season_number || 1) === currentSeason && e.episode_number === activeEpNum
  );
  const matchedIndex =
    currentEpIndex >= 0
      ? currentEpIndex
      : episodes.findIndex((e) => e.episode_number === activeEpNum);
  const activeEpIndex =
    matchedIndex >= 0 ? matchedIndex : episodes.length > 0 ? 0 : -1;

  const currentEpObj =
    (activeEpIndex >= 0 ? episodes[activeEpIndex] : null) || {
      id: activeEpNum,
      season_number: currentSeason,
      episode_number: activeEpNum,
      episode_name: `${activeEpNum}. Bölüm`,
      episode_type: 'normal',
      sources: [],
    };

  const prevEp = activeEpIndex > 0 ? episodes[activeEpIndex - 1] : null;
  const nextEp =
    activeEpIndex >= 0 && activeEpIndex + 1 < episodes.length
      ? episodes[activeEpIndex + 1]
      : null;

  const seasons = Array.from(
    new Set(episodes.map((e) => e.season_number || 1))
  ).sort((a, b) => a - b);

  const rawSources: EpisodeSource[] = currentEpObj?.sources || [];
  const availableSources: EpisodeSource[] = rawSources.map((s) => ({
    ...s,
    source_name: cleanSourceName(s.source_name),
  }));

  const filteredSources = availableSources;

  const activeSource: EpisodeSource | undefined =
    filteredSources[selectedSourceIdx] || availableSources[0];

  // Track active source preference for seamless cross-episode playback continuity
  useEffect(() => {
    if (activeSource) {
      preferredSourceRef.current = {
        provider: activeSource.provider,
        source_name: activeSource.source_name,
      };
    }
  }, [activeSource?.provider, activeSource?.source_name]);




  if (isLoading) {
    return (
      <div className="min-h-screen pt-24 pb-20 bg-[#080808] px-4 sm:px-8 max-w-7xl mx-auto space-y-6">
        <div className="aspect-video w-full rounded-3xl bg-white/[0.03] border border-white/[0.08] animate-pulse flex items-center justify-center relative overflow-hidden">
          <div className="flex flex-col items-center gap-3 text-sky-400/70 font-mono text-xs">
            <Film className="w-8 h-8 animate-spin text-sky-400" />
            <span>KoUp Sinema Oynatıcısı Hazırlanıyor...</span>
          </div>
        </div>
        <div className="space-y-3">
          <div className="h-8 w-2/5 rounded-xl bg-white/[0.05] animate-pulse" />
          <div className="h-4 w-1/4 rounded-lg bg-white/[0.03] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 px-4 text-center bg-[#080808]">
        <h1 className="text-2xl font-bold text-white mb-2">Bölüm Bulunamadı</h1>
        <p className="text-sm text-white/60 mb-6">
          Aradığınız dizi veya bölüm yayından kaldırılmış olabilir.
        </p>
        <Link
          href="/kesfet"
          className="px-6 py-3 rounded-full bg-[#2997ff] text-white font-bold text-xs hover:bg-sky-400 transition-colors glow-blue cursor-pointer"
        >
          Kataloğa Dön
        </Link>
      </div>
    );
  }


  // Single-vote reaction handler with real Supabase RPC persistence
  const handleReaction = async (type: 'fire' | 'cry' | 'shock' | 'angry') => {
    if (!user) {
      openAuthModal('Tepki bırakabilmek için lütfen giriş yapın.');
      return;
    }
    if (isSoftBanned) {
      pushNotification(
        'Hesap Askıda',
        'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
        'info'
      );
      return;
    }
    triggerSound('click');

    const oldType = userReaction;
    const isTogglingOff = oldType === type;
    const newType = isTogglingOff ? null : type;

    // Optimistic UI update + instant local storage sync
    setUserReaction(newType);
    try {
      if (newType) {
        localStorage.setItem(`koup_reaction_${media.id}_${currentSeason}_${activeEpNum}`, newType);
      } else {
        localStorage.removeItem(`koup_reaction_${media.id}_${currentSeason}_${activeEpNum}`);
      }
    } catch {}

    setReactionCounts((prev) => {
      const updated = { ...prev };
      if (oldType) updated[oldType] = Math.max(0, updated[oldType] - 1);
      if (newType) updated[newType] = (updated[newType] || 0) + 1;
      return updated;
    });

    try {
      const { error } = await supabase.rpc('increment_episode_reaction', {
        p_media_id: media.id,
        p_season: currentSeason,
        p_episode: activeEpNum,
        p_reaction: type,
      });

      if (error) {
        console.error('Failed to update episode reaction:', error);
        // Revert on error
        setUserReaction(oldType);
        try {
          if (oldType) {
            localStorage.setItem(`koup_reaction_${media.id}_${currentSeason}_${activeEpNum}`, oldType);
          } else {
            localStorage.removeItem(`koup_reaction_${media.id}_${currentSeason}_${activeEpNum}`);
          }
        } catch {}
        setReactionCounts((prev) => {
          const reverted = { ...prev };
          if (newType) reverted[newType] = Math.max(0, reverted[newType] - 1);
          if (oldType) reverted[oldType] = (reverted[oldType] || 0) + 1;
          return reverted;
        });
      } else {
        // Fetch authoritative aggregate counts from DB
        const { data: epRow } = await supabase
          .from('episodes')
          .select('react_fire, react_cry, react_shock, react_angry')
          .eq('media_id', media.id)
          .eq('season_number', currentSeason)
          .eq('episode_number', activeEpNum)
          .maybeSingle();

        if (epRow) {
          setReactionCounts({
            fire: epRow.react_fire || 0,
            cry: epRow.react_cry || 0,
            shock: epRow.react_shock || 0,
            angry: epRow.react_angry || 0,
          });
        }
      }
    } catch (err) {
      console.error('Failed to persist episode reaction in DB:', err);
    }
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!media) return;

    if (reportCooldownSec > 0) {
      pushNotification(
        'İşlem Sınırı',
        `Peş peşe bildirim gönderemezsiniz. Lütfen ${reportCooldownSec} saniye bekleyin.`,
        'info'
      );
      return;
    }

    setIsSubmittingReport(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id || user?.id || null;

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporter_id: uid,
          target_type: 'episode',
          media_id: media.id,
          season_number: currentSeason,
          episode_number: activeEpNum,
          provider_name: activeSource?.provider || 'episode_player',
          issue_category: reportCategory,
          details:
            reportNote.trim() ||
            `${media.title} S${currentSeason}:B${activeEpNum} (${activeSource?.source_name || 'Varsayılan Kaynak'}) – ${reportCategory}`,
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) {
          const cd = Number(payload.cooldownRemaining) || 60;
          setReportCooldownSec(cd);
          try {
            localStorage.setItem('koup_last_issue_report_time', String(Date.now() - (60 - cd) * 1000));
          } catch {}
          pushNotification('Bildirim Limiti', payload.error || 'Lütfen bekleyin.', 'info');
        } else {
          pushNotification('Hata', payload.error || 'Bildirim kaydedilemedi.', 'info');
        }
        return;
      }

      // Success: Save cooldown
      try {
        localStorage.setItem('koup_last_issue_report_time', String(Date.now()));
      } catch {}
      setReportCooldownSec(60);

      pushNotification(
        'Sorun Bildirimi Alındı',
        isMovie
          ? `${media.title} filmi için bildiriminiz teknik ekibe iletildi.`
          : `${media.title} ${activeEpNum}. Bölüm için bildiriminiz teknik ekibe iletildi.`,
        'info'
      );
      setShowReport(false);
      setReportNote('');
    } catch {
      pushNotification(
        'Sorun Bildirimi',
        'Sunucuya ulaşılamadı, lütfen daha sonra tekrar deneyin.',
        'info'
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };




  const cinemaStageStyle: React.CSSProperties = {
    maxWidth: isFilm ? '1020px' : '1360px',
  };

  return (
    <div className="min-h-screen pb-32 text-white relative overflow-hidden bg-[#060608] pt-24 sm:pt-28 transition-[padding,background-color] duration-300">
      {/* Dynamic Ambient Lighting Diffused Across Site Background (GPU Layer Promoted) */}
      <div
        style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
        className="fixed inset-0 pointer-events-none -z-10 overflow-hidden"
      >
        <img
          src={getProxiedImageUrl(
            media.backdrop_image || media.cover_image,
            media.cover_image,
            media.title,
            'w300',
            'banner',
            media.tmdb_id,
            media.content_type === 'film' ? 'movie' : 'tv',
            media.release_year,
            media.native_title
          )}
          alt=""
          aria-hidden="true"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.triedPoster && media.cover_image) {
              target.dataset.triedPoster = 'true';
              target.src = getProxiedImageUrl(media.cover_image, null, media.title, 'w300', 'poster', media.tmdb_id);
            } else if (!target.dataset.triedProxy && media.title) {
              target.dataset.triedProxy = 'true';
              target.src = `/api/image-proxy?tmdbId=${encodeURIComponent(String(media.tmdb_id || ''))}&title=${encodeURIComponent(media.title)}&type=banner`;
            }
          }}
          style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}
          className="w-full h-full object-cover filter blur-[120px] scale-125 transition-opacity duration-700 opacity-35 brightness-105 saturate-140"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#060608]/50 via-[#060608]/85 to-[#060608] transition-colors duration-700" />
      </div>

      {/* 7% Proportional UI Scaling Wrapper for Episode Watch Interface */}
      <div className="w-full [zoom:0.93] origin-top">
        {/* Top Header Navigation & Source Selector Bar */}
      <div
        style={cinemaStageStyle}
        className="relative z-40 mx-auto px-3 sm:px-6 mb-2 sm:mb-2.5 w-full transition-[max-width,padding] duration-300"
      >
        <div className={`flex flex-wrap items-center justify-between gap-2.5 rounded-2xl sm:rounded-3xl border transition-[background-color,border-color,box-shadow] duration-300 p-3 sm:px-5 sm:py-3 ${
          ambientLightingEnabled
            ? 'bg-[#0a0a0f]/45 backdrop-blur-xl border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.36),inset_0_1px_1px_rgba(255,255,255,0.08)]'
            : 'bg-[#0e0e12] border-white/10 shadow-xl'
        }`}>
          {/* Left: Back to series or film detail */}
          <Link
            href={`/seri/${media.slug}`}
            className="inline-flex items-center gap-2 text-xs font-semibold text-white/80 hover:text-white transition-colors group shrink-0"
          >
            <ChevronLeft className="w-4 h-4 text-white/50 group-hover:-translate-x-1 transition-transform" />
            <span>{isFilm ? 'Film Detayına Dön' : 'Seri Sayfasına Dön'}</span>
          </Link>

          {/* Center / Right: Kaynak Seçici Dropdown */}
          <div className="flex items-center gap-2.5 ml-auto sm:ml-0 justify-end sm:justify-center sm:flex-1 sm:max-w-md">
            {filteredSources.length > 0 ? (
              <div className="w-auto min-w-0 sm:min-w-[220px]">
                <CustomSelect
                  value={String(selectedSourceIdx)}
                  onChange={(val) => setSelectedSourceIdx(Number(val) || 0)}
                  variant="dark"
                  size="sm"
                  leftIcon={<Layers className="w-3.5 h-3.5 text-sky-400" />}
                  portal={true}
                  options={filteredSources.map((s, idx) => {
                    const isNative =
                      s.stream_type === 'hls' ||
                      s.stream_type === 'tau' ||
                      s.stream_type === 'mp4';
                    const baseName = cleanSourceName(s.source_name || `Kaynak ${idx + 1}`);
                    return {
                      value: String(idx),
                      label: baseName,
                      icon: (
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isNative
                              ? 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
                              : 'bg-blue-400'
                          }`}
                        />
                      ),
                    };
                  })}
                />
              </div>
            ) : isLoading || episodes.length === 0 ? (
              <span className="text-xs text-white/40 font-mono">Kaynak Hazırlanıyor...</span>
            ) : (currentEpObj?.pending || currentEpObj?.status === 'pending_source') ? (
              <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-mono font-medium">
                Bölüm Yakında Eklenecek
              </span>
            ) : (
              <span className="text-xs text-white/40 font-mono">Kaynak Hazırlanıyor...</span>
            )}
          </div>

          {/* Right / Row 2 on mobile: Badges & Controls */}
          <div className="w-full sm:w-auto flex items-center justify-center sm:justify-end gap-2 shrink-0 pt-1 sm:pt-0">
            <Link
              href={`/kesfet?country=${encodeURIComponent(
                ((media.country_code || media.country) || '').toUpperCase()
              )}`}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/80 hover:bg-white/15 transition-colors"
            >
              <CountryFlag code={media.country_code || media.country} size="sm" />
              <span className="font-semibold text-[11px] uppercase">
                {COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] ||
                  media.country_name ||
                  media.country ||
                  'ASYA'}
              </span>
            </Link>

            {isFilm ? (
              <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 font-mono text-xs font-bold tracking-wider">
                FİLM
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-300 font-mono text-xs font-bold">
                S{currentSeason} : B{activeEpNum}
              </span>
            )}

            <span
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-mono text-white/80"
              title={
                isFilm
                  ? 'Toplam Film Görüntülenmesi'
                  : `${activeEpNum}. Bölüm Görüntülenmesi (Seri Toplamı: ${formatViewCount(media.views_total ?? 0)})`
              }
            >
              <Eye className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>
                {formatViewCount(
                  isFilm
                    ? Math.max(media.views_total || 0, currentEpObj.views_count || 0)
                    : (liveEpisodeViews[`${currentEpObj.season_number || 1}_${currentEpObj.episode_number}`] ?? currentEpObj.views_count ?? 0)
                )}
              </span>
            </span>

            {/* Sinematik Işıklandırma Button (Same button style as Sinema Modu, not a toggle, persisted) */}
            <button
              type="button"
              onClick={handleToggleAmbientLighting}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                ambientLightingEnabled
                  ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.4)]'
                  : 'bg-white/[0.05] hover:bg-white/[0.12] text-white/80 border-white/10 hover:text-white'
              }`}
              aria-label="Sinematik Işıklandırma"
              title="Sinematik Işıklandırma (Video renklerini ekrana yayar)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                Sinematik Işıklandırma
              </span>
            </button>

            {/* Otomatik Sonraki Bölüm Button (Only for series) */}
            {!isMovie && (
              <button
                type="button"
                onClick={handleToggleAutoNext}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  autoNextEnabled
                    ? 'bg-[#2997ff] text-white border-sky-400 shadow-[0_0_15px_rgba(41,151,255,0.4)]'
                    : 'bg-white/[0.05] hover:bg-white/[0.12] text-white/80 border-white/10 hover:text-white'
                }`}
                aria-label="Otomatik Sonraki Bölüm"
                title="Otomatik Sonraki Bölüm (Bölüm bitince sıradakine otomatik geçer)"
              >
                <SkipForward className="w-3.5 h-3.5" />
                <span className="hidden md:inline">
                  Otomatik Sonraki Bölüm
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Player + Vertical Episode Rail Stage */}
      <div
        style={cinemaStageStyle}
        className="relative z-20 mx-auto px-3 sm:px-6 w-full transition-[max-width,padding] duration-300"
      >
        <div className={`grid gap-3 sm:gap-3.5 items-start ${isMovie ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[1fr_310px] xl:grid-cols-[1fr_330px]'} transition-[grid-template-columns] duration-300`}>
          {/* LEFT: Video Player Area */}
          <div className="space-y-2.5 sm:space-y-3 min-w-0">
            <div ref={playerContainerRef} className="relative">
              {/* Netflix Player */}
              <NetflixPlayer
                media={media}
                episodes={episodes}
                isLoadingEpisodes={isLoading || episodes.length === 0}
                currentSeason={currentSeason}
                currentEpisode={activeEpNum}
                onSelectEpisode={handleSelectEpisode}
                selectedSourceIdx={selectedSourceIdx}
                onSelectSourceIdx={handleSelectSourceIdx}
                ambientLightingEnabled={ambientLightingEnabled}
                onToggleAmbientLighting={handleToggleAmbientLighting}
                autoNextEnabled={autoNextEnabled}
                onToggleAutoNext={handleToggleAutoNext}
                hasRail={!isMovie}
                initialSeekTime={(() => {
                  const urlT = Number(searchParams.get('t')) || 0;
                  if (urlT > 0) return urlT;
                  if (!media?.id) return 0;
                  const epProg = getEpisodeProgress(
                    progressMap[media.id],
                    media.id,
                    currentSeason,
                    activeEpNum
                  );
                  if (epProg.position > 15 && epProg.position < epProg.duration * 0.95) {
                    return epProg.position;
                  }
                  return epProg.isWatched ? 0 : (epProg.position || 0);
                })()}
              />
            </div>

            {/* Quick Navigation, Reactions & Report Under Player */}
            <div className={`relative z-20 rounded-2xl sm:rounded-3xl border flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4 transition-[background-color,border-color,box-shadow] duration-300 ${
              ambientLightingEnabled
                ? 'bg-[#0a0a0f]/45 backdrop-blur-xl border-white/12 shadow-[0_8px_32px_rgba(0,0,0,0.36),inset_0_1px_1px_rgba(255,255,255,0.08)]'
                : 'bg-[#0e0e12] border-white/10 shadow-xl'
            }`}>
              {/* Previous / Next / Mark Watched buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {!isMovie && (prevEp ? (
                  <button
                    onClick={() =>
                      handleSelectEpisode(
                        prevEp.season_number || currentSeason,
                        prevEp.episode_number
                      )
                    }
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Önceki</span>
                  </button>
                ) : (
                  <span className="px-3.5 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                    İlk Bölüm
                  </span>
                ))}

                {(() => {
                  const isCurrentEpWatched = (
                    progressMap[media.id]?.watched_episodes || []
                  ).includes(activeEpNum);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleEpisodeWatched(media, activeEpNum)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-colors cursor-pointer ${
                        isCurrentEpWatched
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                          : 'bg-white/[0.06] hover:bg-white/15 border-white/15 text-white/90 hover:text-white'
                      }`}
                      aria-label={
                        isCurrentEpWatched
                          ? (isFilm ? 'Bu filmi izlenmedi olarak işaretle' : 'Bu bölümü izlenmedi olarak işaretle')
                          : (isFilm ? 'Bu filmi izlendi olarak işaretle' : 'Bu bölümü izlendi olarak işaretle')
                      }
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {isFilm
                          ? (isCurrentEpWatched ? 'İzlendi' : 'İzlendi İşaretle')
                          : (isCurrentEpWatched ? `${activeEpNum}. Bölüm İzlendi` : 'İzlendi İşaretle')}
                      </span>
                    </button>
                  );
                })()}

                {!isMovie && (nextEp ? (
                  <button
                    onClick={() =>
                      handleSelectEpisode(
                        nextEp.season_number || currentSeason,
                        nextEp.episode_number
                      )
                    }
                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white text-xs font-bold transition-[background-color,box-shadow] shadow-[0_0_15px_rgba(41,151,255,0.35)] cursor-pointer"
                  >
                    <span>Sonraki</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="px-3.5 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                    Final Bölümü
                  </span>
                ))}
              </div>

              {/* Reaction Badges + Sorun Bildir */}
              <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-2.5 w-full sm:w-auto">
                {/* Flame, Tear, Zap, Angry reactions with fixed dimensions, tabular counts & crisp hover */}
                <div className="flex items-center justify-center gap-1 bg-white/[0.04] p-1 rounded-2xl sm:rounded-full border border-white/10 flex-wrap max-w-full">
                  <button
                    type="button"
                    onClick={() => handleReaction('fire')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                      userReaction === 'fire'
                        ? 'bg-amber-500/25 hover:bg-amber-500/35 text-amber-300 border-amber-400/50 hover:border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
                        : 'bg-transparent border-transparent text-white/75 hover:text-white hover:bg-amber-500/15 hover:border-amber-400/30'
                    }`}
                    aria-label="Efsane"
                  >
                    <Flame
                      className={`w-3.5 h-3.5 shrink-0 transition-colors duration-120 ${
                        userReaction === 'fire' ? 'fill-amber-400 text-amber-400' : 'text-amber-400'
                      }`}
                    />
                    <span className="font-semibold text-white/95 text-[11px]">Efsane</span>
                    <span className="font-mono tabular-nums text-white/60 text-[10px] font-bold min-w-[16px] text-center inline-block">
                      {reactionCounts.fire}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReaction('cry')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                      userReaction === 'cry'
                        ? 'bg-sky-500/25 hover:bg-sky-500/35 text-sky-300 border-sky-400/50 hover:border-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
                        : 'bg-transparent border-transparent text-white/75 hover:text-white hover:bg-sky-500/15 hover:border-sky-400/30'
                    }`}
                    aria-label="Ağlattı"
                  >
                    <Droplets
                      className={`w-3.5 h-3.5 shrink-0 transition-colors duration-120 ${
                        userReaction === 'cry' ? 'fill-sky-400 text-sky-400' : 'text-sky-300'
                      }`}
                    />
                    <span className="font-semibold text-white/95 text-[11px]">Ağlattı</span>
                    <span className="font-mono tabular-nums text-white/60 text-[10px] font-bold min-w-[16px] text-center inline-block">
                      {reactionCounts.cry}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReaction('shock')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                      userReaction === 'shock'
                        ? 'bg-purple-500/25 hover:bg-purple-500/35 text-purple-300 border-purple-400/50 hover:border-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                        : 'bg-transparent border-transparent text-white/75 hover:text-white hover:bg-purple-500/15 hover:border-purple-400/30'
                    }`}
                    aria-label="Şok"
                  >
                    <Zap
                      className={`w-3.5 h-3.5 shrink-0 transition-colors duration-120 ${
                        userReaction === 'shock' ? 'fill-purple-400 text-purple-400' : 'text-purple-300'
                      }`}
                    />
                    <span className="font-semibold text-white/95 text-[11px]">Şok</span>
                    <span className="font-mono tabular-nums text-white/60 text-[10px] font-bold min-w-[16px] text-center inline-block">
                      {reactionCounts.shock}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReaction('angry')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                      userReaction === 'angry'
                        ? 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-300 border-rose-400/50 hover:border-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
                        : 'bg-transparent border-transparent text-white/75 hover:text-white hover:bg-rose-500/15 hover:border-rose-400/30'
                    }`}
                    aria-label="Sinir"
                  >
                    <Angry
                      className={`w-3.5 h-3.5 shrink-0 transition-colors duration-120 ${
                        userReaction === 'angry' ? 'text-rose-400 stroke-[2.5]' : 'text-rose-400'
                      }`}
                    />
                    <span className="font-semibold text-white/95 text-[11px]">Sinir</span>
                    <span className="font-mono tabular-nums text-white/60 text-[10px] font-bold min-w-[16px] text-center inline-block">
                      {reactionCounts.angry}
                    </span>
                  </button>
                </div>

                {/* Sorun Bildir */}
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-colors duration-120 ease-out cursor-pointer select-none mx-auto sm:mx-0 ${
                    showReport
                      ? 'bg-amber-400 hover:bg-amber-300 text-black border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.35)]'
                      : 'bg-white/[0.05] hover:bg-amber-400/20 text-amber-300 hover:text-amber-200 border-white/10 hover:border-amber-400/40'
                  }`}
                  aria-label="Bölümle ilgili hata bildir"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Bildir</span>
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Vertical Scrollable Episode List Rail (Only for series, not movies) */}
          {!isMovie && (
            <EpisodeRail
              mediaSlug={media.slug}
              mediaTitle={media.title}
              mediaId={media.id}
              episodes={episodes}
              currentSeason={currentSeason}
              currentEpNum={activeEpNum}
              seasons={seasons}
              playerHeight={playerHeight}
              watchedEpisodes={progressMap[media.id]?.watched_episodes || EMPTY_WATCHED_ARRAY}
              userProgress={progressMap[media.id]}
              onSelectEpisode={(epNum, seasonNum) => {
                handleSelectEpisode(seasonNum, epNum);
              }}
              onToggleWatched={handleToggleWatchedEpisode}
              onSelectSeason={(season) => setCurrentSeason(season)}
              ambientLightingEnabled={ambientLightingEnabled}
            />
          )}
        </div>

        {/* Episode Specific Comments */}
        <div className="mt-8">
          <RichCommentSection
            targetType="episode"
            mediaId={media.id}
            seasonNumber={currentSeason}
            episodeNumber={activeEpNum}
            targetTitle={isFilm ? cleanMediaTitle(media.title) : `${cleanMediaTitle(media.title)} • ${activeEpNum}. Bölüm`}
          />
        </div>
      </div>
      </div>

      {/* Centered Episode Issue Report Modal (Matches Series Report Modal) */}
      <AnimatePresence>
        {showReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReport(false)}
              className="absolute inset-0 bg-black/80 cursor-pointer"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 14 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md bg-[#0e0e14] border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4 z-10"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="font-bold text-white text-base">
                    {isMovie ? 'Film Sorunu Bildir' : 'Bölüm Sorunu Bildir'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReport(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-colors duration-120 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-white/60">
                <span className="font-semibold text-white/90">{cleanMediaTitle(media.title)}</span>
                {!isMovie && (
                  <span className="text-sky-400 font-semibold"> • {activeEpNum}. Bölüm</span>
                )}{' '}
                için yaşadığınız oynatıcı veya kaynak sorununu seçin. Teknik ekibimiz en kısa sürede kontrol edecektir.
              </p>

              <form onSubmit={submitReport} className="space-y-4">
                {/* Category Chips */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                    Bildirim Nedeni
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      'Kaynak Açılmıyor / Kırık',
                      'Altyazı Senkronu Bozuk',
                      'Ses / Kalite Hatası',
                      isMovie ? 'Yanlış Film Yüklü' : 'Yanlış Bölüm Yüklü',
                      'Video Donuyor / Takılıyor',
                      'Diğer',
                    ].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setReportCategory(cat)}
                        className={`p-2.5 rounded-xl text-xs text-left transition-colors duration-120 cursor-pointer border ${
                          reportCategory === cat
                            ? 'bg-amber-400/20 border-amber-400/50 text-amber-200 font-semibold shadow-sm'
                            : 'bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-white/[0.07] hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional details textarea */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                    Açıklama / Detay (İsteğe Bağlı)
                  </label>
                  <textarea
                    rows={3}
                    value={reportNote}
                    onChange={(e) => setReportNote(e.target.value)}
                    placeholder="Hangi dakikada veya hangi kaynakta sorun yaşadığınızı belirtebilirsiniz..."
                    className="koup-input text-xs py-2.5 px-3.5 resize-none font-medium"
                  />
                </div>

                {/* Cooldown Warning Banner */}
                {reportCooldownSec > 0 && (
                  <div className="flex items-center gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-medium">
                    <Clock className="w-4 h-4 shrink-0 text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />
                    <span>Peş peşe bildirim limiti aktif: Yeni bildirim için <strong>{reportCooldownSec}</strong> saniye bekleyin.</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReport(false)}
                    className="px-4 py-2 rounded-full glass-pill text-white/70 hover:text-white text-xs font-medium cursor-pointer transition-colors duration-120"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingReport || reportCooldownSec > 0}
                    className="px-5 py-2 rounded-full bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-120 cursor-pointer"
                  >
                    {isSubmittingReport
                      ? 'İletiliyor...'
                      : reportCooldownSec > 0
                      ? `Bekleyin (${reportCooldownSec}s)`
                      : 'Bildirimi Gönder'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
