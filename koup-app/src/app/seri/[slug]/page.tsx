'use client';

import React, { useState, useEffect, use, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Heart,
  Bell,
  AlertTriangle,
  Play,
  Film,
  Users,
  CheckCircle2,
  Star,
  Plus,
  Eye,
  Bookmark,
  PauseCircle,
  XCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  X,
} from 'lucide-react';
import { motion, LayoutGroup } from 'motion/react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  CastMember,
  getProxiedImageUrl,
  COUNTRY_LABELS,
  getCountryFlag,
  formatContentTypeTR,
  getNextEpisodeNumber,
  cleanOverviewText,
  cleanMediaTitle,
  cleanEpisodeName,
  formatEpisodeTitle,
} from '@/lib/supabase';
import { cachedQuery, getMediaFromCache, getCache, registerMediaItem, setCache } from '@/lib/cache';
import { recordTasteSignal, rankRelatedMedia } from '@/lib/tasteProfile';
import { useKoUp } from '@/context/KoUpContext';
import CountryFlag from '@/components/CountryFlag';
import RichCommentSection from '@/components/RichCommentSection';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import { useDragScroll } from '@/hooks/useDragScroll';
import CustomSelect from '@/components/CustomSelect';
import AddToListModal from '@/components/AddToListModal';
import AdminSeriesSync from '@/components/AdminSeriesSync';

export default function SeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const router = useRouter();
  const { slug } = use(params);
  const searchParams = useSearchParams();

  const {
    user,
    progressMap,
    followedMediaIds,
    setLibraryStatus,
    setMediaScore,
    toggleMediaFavorite,
    toggleMediaFollow,
    toggleEpisodeWatched,
    pushNotification,
    openAuthModal,
    isSoftBanned,
  } = useKoUp();

  // Initialize deterministically on both SSR and Client initial pass to prevent Hydration Mismatch!
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [relatedMedia, setRelatedMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [showAllCast, setShowAllCast] = useState(false);
  const [showAllEpisodes, setShowAllEpisodes] = useState(false);
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [trailerYoutubeId, setTrailerYoutubeId] = useState<string | null>(null);
  const [showTrailerModal, setShowTrailerModal] = useState(false);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [hoveredScore, setHoveredScore] = useState<number | null>(null);
  const ratingTriggerRef = useRef<HTMLDivElement>(null);
  const [ratingCoords, setRatingCoords] = useState<{ top: number; left: number } | null>(null);
  const relatedScrollRef = useDragScroll<HTMLDivElement>();

  const [showSeriesReport, setShowSeriesReport] = useState(false);
  const [seriesReportCategory, setSeriesReportCategory] = useState('Eksik Bölümler Var');
  const [seriesReportNote, setSeriesReportNote] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Position rating picker accurately relative to viewport
  useEffect(() => {
    if (!showRatingPicker || !ratingTriggerRef.current) return;
    const updateCoords = () => {
      if (!ratingTriggerRef.current) return;
      const rect = ratingTriggerRef.current.getBoundingClientRect();
      const pickerWidth = 280;
      let left = rect.left + rect.width / 2 - pickerWidth / 2;
      if (typeof window !== 'undefined') {
        if (left < 16) left = 16;
        if (left + pickerWidth > window.innerWidth - 16) {
          left = window.innerWidth - 16 - pickerWidth;
        }
      }
      setRatingCoords({
        top: rect.bottom + 8,
        left,
      });
    };
    updateCoords();
    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords, true);
    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [showRatingPicker]);

  // Close rating picker on click outside
  useEffect(() => {
    if (!showRatingPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.('[data-rating-popover]')) {
        setShowRatingPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRatingPicker]);

  // Close trailer modal on Escape key press
  useEffect(() => {
    if (!showTrailerModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTrailerModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTrailerModal]);

  useEffect(() => {
    let isCancelled = false;
    const decodedSlug = decodeURIComponent(slug);

    // 1. Immediately hydrate from synchronous memory/storage cache post-SSR (<1ms, zero hydration mismatch)
    const cachedMedia = getMediaFromCache(decodedSlug);
    const cachedEpisodes = cachedMedia
      ? getCache<EpisodeData[]>(`episodes_${cachedMedia.id}`, true) || []
      : [];

    if (cachedMedia) {
      setMedia(cachedMedia);
      setIsLoading(false);
      if (cachedEpisodes.length > 0) {
        setEpisodes(cachedEpisodes);
        setSelectedSeason(cachedEpisodes[0].season_number || 1);
      }
    } else {
      setIsLoading(true);
    }

    async function loadSeries() {
      try {
        const knownId = cachedMedia?.id;

        // Fetch media with cast AND parallel fetch episodes if ID is already known
        const mediaWithCastPromise = cachedQuery<{
          media: MediaItem | null;
          cast: CastMember[];
        }>(`media_detail_${decodedSlug}`, 300_000, async () => {
          let { data: mData } = await supabase
            .from('media')
            .select('*')
            .eq('slug', decodedSlug)
            .single();

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

          if (!mData) return { media: null, cast: [] };

          const { data: castRows } = await supabase
            .from('media_cast')
            .select('*, people(*)')
            .eq('media_id', mData.id)
            .order('billing_order', { ascending: true })
            .limit(24);

          return {
            media: mData as MediaItem,
            cast: (castRows as CastMember[]) || [],
          };
        });

        const episodesPromise = knownId
          ? cachedQuery<EpisodeData[]>(`episodes_${knownId}`, 300_000, async () => {
              const res = await fetch(`/api/sources/${knownId}`);
              const payload = await res.json();
              return payload.episodes || [];
            })
          : null;

        const mediaWithCast = await mediaWithCastPromise;
        if (isCancelled) return;

        if (!mediaWithCast.media) {
          setIsLoading(false);
          return;
        }

        const item = mediaWithCast.media;
        registerMediaItem(item, true);
        recordTasteSignal(item, 'view');
        setMedia(item);
        setCast(mediaWithCast.cast);
        setIsLoading(false);

        // Non-blocking view increment
        supabase.rpc('increment_media_view', { p_media_id: item.id }).then(() => {});

        // Non-blocking auto-enrich if metadata is incomplete, has dummy overview, or wrong country
        const needsEnrich =
          !item.overview ||
          item.overview.length < 50 ||
          item.overview.includes('üzerinden eklendi') ||
          !item.cover_image ||
          !item.backdrop_image ||
          !item.release_year ||
          (item.country_code === 'US' && (item.content_type === 'dizi' || (item.alt_sites && item.alt_sites.some((s) => s.includes('diziyou') || s.includes('asyadizi')))));

        if (needsEnrich) {
          fetch(`/api/media/auto-enrich?id=${item.id}`)
            .then((res) => res.json())
            .then((data) => {
              if (data?.updatedMedia && !isCancelled) {
                setMedia((prev) => (prev ? { ...prev, ...data.updatedMedia } : prev));
                registerMediaItem({ ...item, ...data.updatedMedia }, true);
              }
            })
            .catch(() => {});
        }

        // Handle direct ?play=1 redirect
        if (searchParams.get('play')) {
          const userProgForRedirect = progressMap[item.id];
          const computedNextEp = getNextEpisodeNumber(
            userProgForRedirect,
            item.episode_count || 1
          );
          const epToPlay = searchParams.get('ep') || String(computedNextEp);
          const seasonToPlay =
            searchParams.get('season') ||
            String(userProgForRedirect?.last_season_num || 1);
          router.replace(`/seri/${item.slug}/${epToPlay}?season=${seasonToPlay}`);
          return;
        }

        // Parallel cached fetches for episode list & multi-signal related media
        const actualEpisodesPromise =
          episodesPromise ||
          cachedQuery<EpisodeData[]>(`episodes_${item.id}`, 300_000, async () => {
            const res = await fetch(`/api/sources/${item.id}`);
            const payload = await res.json();
            return payload.episodes || [];
          });

        const relatedPromise = cachedQuery<MediaItem[]>(
          `smart_related_v2_${item.id}`,
          300_000,
          async () => {
            const countryCode = (item.country_code || item.country || '').toUpperCase().trim();
            const queries: Promise<any>[] = [];

            // 1. Candidates from the exact same country & content type
            if (countryCode && countryCode !== 'GL') {
              queries.push(
                supabase
                  .from('media')
                  .select('*')
                  .eq('country_code', countryCode)
                  .eq('content_type', item.content_type)
                  .neq('id', item.id)
                  .order('mdl_rating', { ascending: false, nullsFirst: false })
                  .limit(45) as unknown as Promise<any>
              );
            }

            // 2. Broader candidates of the same content type for genre intersection
            queries.push(
              supabase
                .from('media')
                .select('*')
                .eq('content_type', item.content_type)
                .neq('id', item.id)
                .order('views_total', { ascending: false })
                .limit(45) as unknown as Promise<any>
            );

            const results = await Promise.all(queries);
            const candidatePool: MediaItem[] = [];
            for (const r of results) {
              if (Array.isArray(r?.data)) {
                candidatePool.push(...(r.data as MediaItem[]));
              }
            }

            return rankRelatedMedia(item, candidatePool, 12);
          }
        );

        const [epsList, relList] = await Promise.all([actualEpisodesPromise, relatedPromise]);
        if (isCancelled) return;

        setEpisodes(epsList);
        if (epsList.length > 0) {
          setSelectedSeason(epsList[0].season_number || 1);
        }
        setRelatedMedia(relList);
      } catch (err) {
        console.error('Error loading series data:', err);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadSeries();

    return () => {
      isCancelled = true;
    };
  }, [slug, searchParams, router]);

  // Dynamic document title
  useEffect(() => {
    if (media?.title) {
      document.title = `${cleanMediaTitle(media.title)} İzle • KoUp Sinema`;
    }
  }, [media?.title]);

  // Helper to detect SEO junk or stub overviews
  const isBadOverviewText = (text?: string | null) => {
    if (!text || text.trim().length < 40) return true;
    const low = text.toLowerCase();
    const garbage = [
      '1080p',
      'full hd',
      'altyazılı',
      'altyazili',
      'tek parça',
      'tek parca',
      'kalitede',
      'dizisini türkçe',
      'dizisini turkce',
      'filmini türkçe',
      'filmini turkce',
      'dizibox',
      'diziyou',
      'webdramaturkey',
      'dizikorea',
      'asyadizi',
      'kesintisiz izle',
      'yapımı dizi serisi',
      'yapımı film serisi',
      'yapımı program serisi',
      'bölümlerini türkçe',
      'sayfasından izleyebilirsiniz',
    ];
    return garbage.some((g) => low.includes(g));
  };

  // On-the-fly self-healing overview, trailer & high-res TMDB poster/backdrop resolver
  useEffect(() => {
    if (!media) return;
    const isScrapedCover =
      !media.cover_image ||
      (!media.cover_image.includes('image.tmdb.org') &&
        !media.cover_image.includes('s4.anilist.co'));
    const needsOverview = isBadOverviewText(media.overview);
    const needsImages = isScrapedCover || !media.backdrop_image;
    const needsMatching = !media.tmdb_id && !media.anilist_id && !media.mdl_id;
    const needsImdbRating = !(media.imdb_rating || (media as any).imdb_score || media.vote_average);
    const hasCorruptedImdb = !!media.imdb_id && !/^tt\d+$/.test(media.imdb_id);

    // 1. Resolve official trailer & high-res TMDB poster/backdrop & live rating
    fetch(
      `/api/media/trailer?id=${media.id}&slug=${encodeURIComponent(media.slug)}&title=${encodeURIComponent(media.title)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d?.youtubeId) {
          setTrailerYoutubeId(d.youtubeId);
        }
        if (d?.posterUrl || d?.backdropUrl || d?.imdbRating || d?.imdbId) {
          setMedia((prev) => {
            if (!prev) return prev;
            const updated = {
              ...prev,
              cover_image:
                d.posterUrl && isScrapedCover ? d.posterUrl : prev.cover_image,
              backdrop_image: d.backdropUrl || prev.backdrop_image,
              imdb_id: d.imdbId && /^tt\d+$/.test(d.imdbId) ? d.imdbId : prev.imdb_id,
              imdb_rating: d.imdbRating || prev.imdb_rating,
            };
            registerMediaItem(updated, true);
            return updated;
          });
        }
      })
      .catch(() => {});

    // 2. Enrich overview & ratings if needed
    if (needsOverview || needsImages || needsMatching || needsImdbRating || hasCorruptedImdb) {
      fetch(`/api/media/auto-enrich?id=${media.id}&slug=${encodeURIComponent(media.slug)}`)
        .then((r) => r.json())
        .then((res) => {
          const fresh = res?.updatedMedia || res?.media;
          if (fresh) {
            setMedia((prev) => {
              if (!prev) return prev;
              const updated = { ...prev, ...fresh };
              registerMediaItem(updated, true);
              const decodedSlug = decodeURIComponent(slug);
              setCache(`media_detail_${decodedSlug}`, { media: updated, cast }, 300_000);
              return updated;
            });
          }
        })
        .catch(() => {});
    }
  }, [media?.id, media?.slug]);

  if (isLoading && !media) {
    return (
      <div className="min-h-screen pb-32 text-white pt-24 sm:pt-28 relative overflow-hidden bg-[#080808]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 space-y-8 animate-pulse">
          {/* Hero Banner Skeleton */}
          <div className="h-[380px] sm:h-[460px] rounded-3xl bg-white/[0.04] border border-white/10 relative overflow-hidden flex flex-col justify-end p-6 sm:p-10 space-y-4">
            <div className="h-6 w-32 bg-white/10 rounded-full" />
            <div className="h-10 sm:h-14 w-2/3 max-w-md bg-white/15 rounded-2xl" />
            <div className="h-4 w-96 max-w-full bg-white/10 rounded-lg" />
            <div className="flex gap-3 pt-2">
              <div className="h-11 w-36 bg-sky-500/20 rounded-full" />
              <div className="h-11 w-11 bg-white/10 rounded-full" />
              <div className="h-11 w-11 bg-white/10 rounded-full" />
            </div>
          </div>
          {/* Episode List Skeleton */}
          <div className="space-y-4">
            <div className="h-6 w-44 bg-white/10 rounded-lg" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white/[0.03] border border-white/[0.06]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 px-4 text-center bg-[#080808]">
        <h1 className="text-2xl font-bold text-white mb-2">Yapım Bulunamadı</h1>
        <p className="text-sm text-white/60 mb-6">
          Aradığınız dizi, film veya anime taşınmış ya da arşive kaldırılmış olabilir.
        </p>
        <Link
          href="/kesfet"
          className="px-6 py-3 rounded-full bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 transition-colors shadow-lg"
        >
          Kataloğa Dön
        </Link>
      </div>
    );
  }

  const userProg = user ? progressMap[media.id] : undefined;
  const isFavorited = Boolean(user && (userProg?.is_favorite || userProg?.is_favorited));
  const isFollowed = Boolean(user && followedMediaIds.includes(media.id));
  const totalEpCount = Math.max(media.episode_count || 0, episodes.length, 1);
  const resumeEp = user ? getNextEpisodeNumber(userProg, totalEpCount) : 1;
  const resumeSeason = (user && userProg?.last_season_num) || 1;
  const watchedEpCount = Array.isArray(userProg?.watched_episodes)
    ? userProg.watched_episodes.length
    : 0;
  const hasResumeProgress = Boolean(
    user &&
      (watchedEpCount > 0 ||
        (userProg?.last_episode_num && userProg.last_episode_num > 1) ||
        userProg?.status === 'watching')
  );

  const seasons = Array.from(
    new Set(episodes.map((e) => e.season_number || 1))
  ).sort((a, b) => a - b);

  const seasonEpisodes = episodes.filter(
    (e) => (e.season_number || 1) === selectedSeason
  );

  const submitSeriesIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!media) return;
    setIsSubmittingReport(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id || user?.id || null;

      await supabase.from('issue_reports').insert({
        reporter_id: uid,
        target_type: 'media',
        media_id: media.id,
        season_number: 1,
        episode_number: 0,
        provider_name: 'series_overview',
        issue_category: seriesReportCategory,
        details: seriesReportNote.trim() || `${media.title} hakkında sorun bildirimi`,
        status: 'open',
      });

      pushNotification(
        'Sorun Bildirimi Alındı',
        `${media.title} için "${seriesReportCategory}" bildiriminiz teknik ekibe iletildi.`,
        'info'
      );
    } catch {
      pushNotification(
        'Sorun Bildirimi Alındı',
        `${media.title} bildirimi kaydedildi.`,
        'info'
      );
    } finally {
      setIsSubmittingReport(false);
      setShowSeriesReport(false);
      setSeriesReportNote('');
    }
  };

  const handleAdminSyncComplete = async () => {
    if (!media) return;
    try {
      const { data: freshEpisodes } = await supabase
        .from('episodes')
        .select('*, sources:episode_sources(*)')
        .eq('drama_id', media.id)
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true });

      if (freshEpisodes && freshEpisodes.length > 0) {
        setEpisodes(freshEpisodes as unknown as EpisodeData[]);
        setCache(`episodes_${media.id}`, freshEpisodes, 3600);
      }
    } catch (e) {
      console.error('Error refreshing episodes after sync:', e);
    }
  };

  const backdropSrc = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.cover_image,
    media.title,
    'w780'
  );
  const posterSrc = getProxiedImageUrl(
    media.cover_image,
    media.poster_fallback_url || null,
    media.title,
    'w500'
  );

  return (
    <div className="min-h-screen pb-32 bg-[#080808] text-white">
      {/* 1. CINEMATIC HERO BANNER */}
      <div className="relative w-full min-h-[520px] md:min-h-[580px] flex items-end pt-24 md:pt-28 pb-8 md:pb-12">
        {/* Full Backdrop (Blurred Glass Ambient) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={backdropSrc}
            alt={media.title}
            className="w-full h-full object-cover filter blur-2xl scale-110 opacity-75 transform-gpu"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/50 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#080808]/75 via-transparent to-transparent hidden md:block" />
        </div>

        {/* Hero Meta Info */}
        <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex flex-col md:flex-row items-center md:items-start gap-6 sm:gap-8 lg:gap-10 text-center md:text-left">
          {/* Vertical Poster with Glass Glow - Strict 2:3 Cinema Aspect Ratio (Grand & prominent) */}
          <div className="relative w-52 sm:w-64 md:w-72 lg:w-80 shrink-0 aspect-[2/3] rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_30px_70px_rgba(0,0,0,0.95)] border border-white/20 bg-[#121216] self-center md:self-start md:sticky md:top-28">
            {/* Ambient Blurred Fill for non-standard image aspect ratios */}
            <img
              src={posterSrc}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-125 blur-lg opacity-40 brightness-75 pointer-events-none"
            />
            <img
              src={posterSrc}
              alt={media.title}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="relative z-10 w-full h-full object-cover object-top"
            />
          </div>

          <div className="flex-1 flex flex-col justify-between w-full py-1 md:py-2 space-y-4 md:space-y-0">
            {/* Top Meta Block: Badges, Title, Ratings, Categories */}
            <div className="space-y-3.5">
              {/* Top Badges Row: Flag & Country, Content Type, Year, Episodes */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                <Link
                  href={`/kesfet?country=${encodeURIComponent(((media.country_code || media.country) || '').toUpperCase())}`}
                  prefetch={true}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/80 backdrop-blur-md border border-white/15 text-xs text-white font-bold hover:bg-white/20 hover:border-white/35 transition-all cursor-pointer shadow-sm"
                  aria-label={`${COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] || 'Ülke'} yapımlarını keşfet`}
                >
                  <CountryFlag code={media.country_code || media.country} size="sm" />
                  <span>
                    {COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] ||
                      media.country_name ||
                      media.country ||
                      'ASYA'}
                  </span>
                </Link>

                <Link
                  href={`/kesfet?type=${encodeURIComponent(media.content_type || 'dizi')}${media.country_code || media.country ? `&country=${encodeURIComponent(((media.country_code || media.country) || '').toUpperCase())}` : ''}`}
                  prefetch={true}
                  className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-bold uppercase tracking-wider text-white/90 hover:bg-white/20 hover:border-white/35 transition-all cursor-pointer shadow-sm"
                >
                  {formatContentTypeTR(media.content_type, media.country_code || media.country)}
                </Link>

                {media.release_year && (
                  <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-mono text-white/75">
                    {media.release_year}
                  </span>
                )}

                {media.episode_count > 0 && (
                  <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs font-mono text-white/75">
                    {media.episode_count} Bölüm
                  </span>
                )}
              </div>

              {/* Title */}
              <div className="space-y-1">
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.12]">
                  {cleanMediaTitle(media.title)}
                </h1>

                {/* Original / Native Title */}
                {(media.native_title || media.title_en) && (
                  <p className="text-xs sm:text-sm md:text-base text-white/60 font-medium">
                    {cleanMediaTitle(media.native_title || media.title_en)}
                  </p>
                )}
              </div>

              {/* Ratings Bar */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-0.5">
                {media.site_rating && Number(media.site_rating) > 0 && media.site_rating_count && Number(media.site_rating_count) > 0 ? (
                  <div className="px-3.5 py-1 rounded-full bg-sky-500/20 border border-sky-400/40 text-xs font-mono text-sky-300 font-bold inline-flex items-center gap-1.5 shadow-[0_0_14px_rgba(56,189,248,0.25)]">
                    <Star className="w-3.5 h-3.5 fill-sky-400 text-sky-400" />
                    <span>KoUp {Number(media.site_rating).toFixed(1)}</span>
                    <span className="text-[11px] text-sky-300/70 font-normal">({media.site_rating_count} oy)</span>
                  </div>
                ) : (
                  <div className="px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-xs font-mono text-white/50 inline-flex items-center gap-1.5" title="Henüz kullanıcı puanı yok. İlk puanı vererek katkıda bulun!">
                    <Star className="w-3.5 h-3.5 text-white/30" />
                    <span>KoUp Puanı: —</span>
                  </div>
                )}

                {media.mdl_rating || media.mdl_id ? (
                  <a
                    href={media.mydramalist_url || (media.mdl_id ? `https://mydramalist.com/${media.mdl_id}` : '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-amber-400/20 border border-white/15 hover:border-amber-400/40 text-xs font-mono text-amber-300 font-bold transition-colors inline-flex items-center gap-1"
                    aria-label="MyDramaList Sayfasını Aç"
                  >
                    <span>MDL</span>
                    <span>{media.mdl_rating ? media.mdl_rating : 'Profil'}</span>
                  </a>
                ) : null}

                {media.anilist_rating || media.anilist_id ? (
                  <a
                    href={media.anilist_url || (media.anilist_id ? `https://anilist.co/anime/${media.anilist_id}` : '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-sky-400/20 border border-white/15 hover:border-sky-400/40 text-xs font-mono text-sky-300 font-bold transition-colors inline-flex items-center gap-1"
                    aria-label="AniList Sayfasını Aç"
                  >
                    <span>AniList</span>
                    <span>{media.anilist_rating ? `${media.anilist_rating}%` : 'Profil'}</span>
                  </a>
                ) : null}

                {media.imdb_rating || (media as any).imdb_score || media.vote_average || media.imdb_id ? (
                  <a
                    href={
                      media.imdb_id && /^tt\d+$/.test(media.imdb_id)
                        ? `https://www.imdb.com/title/${media.imdb_id}/`
                        : `https://www.imdb.com/find/?q=${encodeURIComponent(cleanMediaTitle(media.title))}&s=tt`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-yellow-400/20 border border-white/15 hover:border-yellow-400/40 text-xs font-mono text-yellow-300 font-bold transition-colors inline-flex items-center gap-1"
                    aria-label="IMDb Sayfasını Aç"
                  >
                    <span>IMDb</span>
                    <span>
                      {(() => {
                        const val = media.imdb_rating ?? (media as any).imdb_score ?? media.vote_average;
                        return val && !isNaN(Number(val)) && Number(val) > 0 ? Number(val).toFixed(1) : 'Profil';
                      })()}
                    </span>
                  </a>
                ) : null}

                {media.tmdb_id ? (
                  <a
                    href={`https://www.themoviedb.org/${media.content_type === 'film' ? 'movie' : 'tv'}/${media.tmdb_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-full bg-white/10 hover:bg-emerald-400/20 border border-white/15 hover:border-emerald-400/40 text-xs font-mono text-emerald-300 font-bold transition-colors inline-flex items-center gap-1"
                    aria-label="TMDB Sayfasını Aç"
                  >
                    <span>TMDB</span>
                  </a>
                ) : null}

                {(media.status_translation || episodes[0]?.translation_note) && (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5">
                    <span className="text-emerald-400/80 font-normal">Çeviri Durumu:</span>
                    <span className="font-bold">{media.status_translation || episodes[0]?.translation_note}</span>
                  </span>
                )}
              </div>

              {/* Categories */}
              {media.categories && media.categories.length > 0 && (
                <div className="flex flex-wrap justify-center md:justify-start gap-1.5 pt-0.5">
                  {media.categories.map((cat) => (
                    <Link
                      key={cat}
                      href={`/kesfet?category=${encodeURIComponent(cat)}`}
                      prefetch={true}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] text-white/80 border border-white/10 hover:bg-white/15 hover:text-white hover:border-white/30 transition-all cursor-pointer"
                      aria-label={`${cat} kategorisindeki yapımları keşfet`}
                    >
                      {cat}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Action Bar: Watch CTA, + Kütüphaneme Ekle, Favorile, Takip Et */}
            <div className="pt-4 md:pt-4 overflow-visible">
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full py-3 relative z-20 overflow-visible">
              {/* Primary Watch & Trailer Button Pair (Full-width row on mobile, compact on desktop) */}
              <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-2.5">
                {/* Primary Watch Button */}
                <Link
                  href={`/seri/${media.slug}/${resumeEp}?season=${resumeSeason}`}
                  className="flex-1 sm:flex-initial sm:w-auto shrink-0 whitespace-nowrap flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs transition-all glow-blue active:scale-[0.98] cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white shrink-0" />
                  <span className="truncate">
                    {hasResumeProgress
                      ? `${resumeEp}. Bölümden Devam Et`
                      : '1. Bölümü İzle'}
                  </span>
                </Link>

                {/* Fragmanı İzle */}
                <button
                  type="button"
                  onClick={() => setShowTrailerModal(true)}
                  className="flex-1 sm:flex-initial sm:w-auto shrink-0 whitespace-nowrap flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 hover:border-sky-400/50 text-white font-bold text-xs transition-all hover:shadow-[0_0_18px_rgba(56,189,248,0.3)] active:scale-[0.98] cursor-pointer"
                >
                  <Film className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="truncate">Fragmanı İzle</span>
                </button>
              </div>

              {/* + Kütüphaneme Ekle Dropdown (Full-width row on mobile, compact on desktop) */}
              <div className="w-full sm:w-auto shrink-0">
                <CustomSelect
                  className="w-full sm:w-auto"
                  triggerClassName="w-full sm:w-auto justify-between px-4 py-2.5 sm:py-2 text-xs"
                  value={userProg?.status || ''}
                  onChange={(val) => {
                    if (!user) {
                      openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
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
                    if (val) {
                      setLibraryStatus(
                        media,
                        val as
                          | 'watching'
                          | 'completed'
                          | 'plan_to_watch'
                          | 'on_hold'
                          | 'dropped'
                      );
                    }
                  }}
                  variant="white"
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                  placeholder="Kütüphane"
                  portal={true}
                  direction="auto"
                  options={[
                    {
                      value: 'watching',
                      label: 'İzliyorum',
                      icon: <Eye className="w-3.5 h-3.5 text-sky-400" />,
                    },
                    {
                      value: 'completed',
                      label: 'Tamamladım',
                      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
                    },
                    {
                      value: 'plan_to_watch',
                      label: 'İzleyeceğim',
                      icon: <Bookmark className="w-3.5 h-3.5 text-amber-400" />,
                    },
                    {
                      value: 'on_hold',
                      label: 'Beklemede',
                      icon: <PauseCircle className="w-3.5 h-3.5 text-purple-400" />,
                    },
                    {
                      value: 'dropped',
                      label: 'Bıraktım',
                      icon: <XCircle className="w-3.5 h-3.5 text-rose-400" />,
                    },
                  ]}
                />
              </div>

              {/* Favorile Button */}
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
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
                  toggleMediaFavorite(media);
                }}
                className={`col-span-1 sm:w-auto shrink-0 whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden ${
                  isFavorited
                    ? 'bg-rose-500/20 border-rose-400 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                    : 'apple-glass-pill text-white hover:bg-white/15'
                }`}
              >
                <Heart
                  className={`w-4 h-4 ${isFavorited ? 'fill-rose-400 text-rose-400' : ''}`}
                />
                <span>{isFavorited ? 'Favorilerimde' : 'Favorile'}</span>
              </button>

              {/* Puan Ver Button & Popover */}
              <div ref={ratingTriggerRef} data-rating-popover="true" className="relative col-span-1 sm:w-auto shrink-0 w-full">
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      openAuthModal('Puan verebilmek için lütfen giriş yapın.');
                      return;
                    }
                    setShowRatingPicker((v) => !v);
                  }}
                  className={`whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden ${
                    userProg?.user_score
                      ? 'bg-amber-400/20 border-amber-400 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                      : 'apple-glass-pill text-white hover:bg-white/15'
                  }`}
                >
                  <Star
                    className={`w-4 h-4 ${userProg?.user_score ? 'fill-amber-400 text-amber-400' : 'text-white/70'}`}
                  />
                  <span>
                    {userProg?.user_score ? `${userProg.user_score}/10 Puanım` : 'Puan Ver'}
                  </span>
                </button>

                {showRatingPicker && typeof document !== 'undefined' && ratingCoords &&
                  createPortal(
                    <div
                      data-rating-popover="true"
                      style={{
                        position: 'fixed',
                        top: ratingCoords.top,
                        left: ratingCoords.left,
                        zIndex: 99999,
                      }}
                      className="p-3.5 rounded-2xl bg-[#141416]/98 backdrop-blur-2xl border border-white/20 shadow-[0_24px_60px_rgba(0,0,0,0.95),0_0_25px_rgba(251,191,36,0.18)] flex flex-col items-center gap-2 min-w-[280px]"
                    >
                      <div className="flex items-center justify-between w-full px-1 text-[11px] font-semibold text-white/70">
                        <span>Bu yapımı puanla:</span>
                        <span className="font-mono text-amber-400 font-bold text-[13px]">
                          {hoveredScore ?? userProg?.user_score ?? '—'}/10
                        </span>
                      </div>

                      <div className="flex items-center gap-1 py-1">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((starVal) => {
                          const activeVal = hoveredScore ?? userProg?.user_score ?? 0;
                          const isFilled = starVal <= activeVal;
                          return (
                            <button
                              key={starVal}
                              type="button"
                              onMouseEnter={() => setHoveredScore(starVal)}
                              onMouseLeave={() => setHoveredScore(null)}
                              onClick={() => {
                                if (media) {
                                  const oldScore = userProg?.user_score;
                                  const curCount = Number(media.site_rating_count || 0);
                                  const curRating = Number(media.site_rating || 0);
                                  let newCount = curCount;
                                  let newRating = curRating;

                                  if (oldScore) {
                                    newRating = ((curRating * curCount) - oldScore + starVal) / (curCount || 1);
                                  } else {
                                    newCount = curCount + 1;
                                    newRating = ((curRating * curCount) + starVal) / newCount;
                                  }

                                  setMedia((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          site_rating: Number(newRating.toFixed(1)),
                                          site_rating_count: newCount,
                                        }
                                      : prev
                                  );

                                  setMediaScore(media, starVal);
                                  setShowRatingPicker(false);
                                }
                              }}
                              className="p-0.5 hover:scale-125 transition-transform cursor-pointer"
                              aria-label={`${starVal} Puan`}
                            >
                              <Star
                                className={`w-5 h-5 transition-colors ${
                                  isFilled
                                    ? 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(245,197,24,0.6)]'
                                    : 'text-white/25 hover:text-white/60'
                                }`}
                              />
                            </button>
                          );
                        })}
                      </div>

                      {userProg?.user_score && (
                        <button
                          type="button"
                          onClick={() => {
                            if (media) {
                              const oldScore = userProg.user_score;
                              const curCount = Number(media.site_rating_count || 0);
                              const curRating = Number(media.site_rating || 0);
                              const newCount = Math.max(0, curCount - 1);
                              const newRating = newCount > 0 ? Math.max(0, (curRating * curCount - (oldScore || 0)) / newCount) : 0;

                              setMedia((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      site_rating: Number(newRating.toFixed(1)),
                                      site_rating_count: newCount,
                                    }
                                  : prev
                              );

                              setMediaScore(media, null);
                              setShowRatingPicker(false);
                            }
                          }}
                          className="text-[10px] text-rose-400 hover:text-rose-300 font-medium transition-colors pt-1 cursor-pointer"
                        >
                          Puanımı Kaldır
                        </button>
                      )}
                    </div>,
                    document.body
                  )}
              </div>

              {/* Takip Et Button */}
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
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
                  toggleMediaFollow(media);
                }}
                className={`col-span-1 sm:w-auto shrink-0 whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden ${
                  isFollowed
                    ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.35)]'
                    : 'apple-glass-pill text-white hover:bg-white/15'
                }`}
              >
                <Bell className={`w-4 h-4 ${isFollowed ? 'fill-black' : ''}`} />
                <span>{isFollowed ? 'Takipte' : 'Takip Et'}</span>
              </button>

              {/* Listeye Ekle Button */}
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    openAuthModal('Listelerinizi yönetebilmek için lütfen giriş yapın.');
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
                  setShowAddToListModal(true);
                }}
                className="col-span-1 sm:w-auto shrink-0 whitespace-nowrap w-full flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-full text-xs font-semibold border apple-glass-pill text-sky-300 hover:bg-sky-500/15 border-sky-400/30 transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden"
              >
                <ListPlus className="w-4 h-4 text-sky-400" />
                <span>Listeye Ekle</span>
              </button>

              {/* Sorun Bildir Button */}
              <button
                type="button"
                onClick={() => setShowSeriesReport(true)}
                aria-label="Sorun Bildir"
                className="w-full sm:w-10 h-10 px-4 sm:px-0 rounded-full apple-glass-pill text-amber-300 hover:bg-amber-400/20 hover:text-amber-200 border border-amber-400/30 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-95 shrink-0 text-xs font-semibold"
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">Sorun Bildir</span>
              </button>
            </div>

            {/* Synopsis / Story Summary - Thicker font, pure cinema feel over dark background */}
            <div className="pt-3.5 space-y-2">
              <p className="text-sm sm:text-base text-white/95 font-medium leading-relaxed tracking-normal whitespace-pre-line">
                {media.overview && !isBadOverviewText(media.overview)
                  ? cleanOverviewText(media.overview)
                  : `${media.title}, ${media.release_year ? `${media.release_year} yılında yayınlanan ` : ''}${media.categories && media.categories.length > 0 ? `${media.categories.slice(0, 3).join(', ')} türündeki ` : ''}${formatContentTypeTR(media.content_type, media.country_code || media.country)} yapımıdır. KoUp platformu üzerinde kesintisiz, Full HD ve Türkçe altyazılı seçenekleriyle tüm bölümlerini izleyebilirsiniz.`}
              </p>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. MAIN BODY CONTENT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 space-y-12">

        {/* 3. CAST & CHARACTERS */}
        {cast.length > 0 && (
          <section className="p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-400" />
                <span>Oyuncu Kadrosu & Karakterler ({cast.length})</span>
              </h2>
              {cast.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setShowAllCast((v) => !v)}
                  className="text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>{showAllCast ? 'Daha Az Göster' : 'Tümünü Gör'}</span>
                  {showAllCast ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : (
                <span className="text-xs text-white/50">Profil ve filmografi için oyuncuya tıklayın</span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {(showAllCast ? cast : cast.slice(0, 6)).map((c) => {
                const p = c.people;
                if (!p) return null;
                return (
                  <Link
                    key={`${c.person_id}-${c.character_name || ''}`}
                    href={`/oyuncu/${p.slug}`}
                    className="p-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col items-center text-center group"
                  >
                    <div className="w-20 h-20 rounded-full overflow-hidden border border-white/15 group-hover:border-sky-400/60 transition-all mb-3 shadow-md">
                      <img
                        src={getProxiedImageUrl(p.image_url, p.name, null, 'w500', 'person')}
                        alt={p.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-sky-300 transition-colors">
                      {p.name}
                    </div>
                    {c.character_name && (
                      <div className="text-[11px] text-white/50 line-clamp-1 mt-0.5">
                        {c.character_name}
                      </div>
                    )}
                    <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded bg-white/[0.06] text-white/60 mt-1.5">
                      {c.role_type === 'lead' ? 'Başrol' : 'Kadro'}
                    </span>
                  </Link>
                );
              })}
            </div>

            {cast.length > 6 && (
              <div className="flex justify-center mt-6 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllCast((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full apple-glass-pill hover:bg-white/15 text-xs font-semibold text-white/90 hover:text-white border border-white/15 transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  <span>
                    {showAllCast
                      ? 'Daha Az Göster'
                      : `Tümünü Gör (${cast.length} Oyuncu)`}
                  </span>
                  {showAllCast ? (
                    <ChevronUp className="w-4 h-4 text-sky-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-sky-400" />
                  )}
                </button>
              </div>
            )}
          </section>
        )}

        {/* 4. FULL EPISODES GRID */}
        <section className="p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Film className="w-5 h-5 text-sky-400" />
                  <span>Bölüm Listesi ({seasonEpisodes.length} Bölüm)</span>
                </h2>
                {user?.role === 'admin' && (
                  <AdminSeriesSync
                    dramaId={media.id}
                    dramaTitle={media.title}
                    dramaSlug={media.slug}
                    onSyncComplete={handleAdminSyncComplete}
                  />
                )}
              </div>
              <p className="text-xs text-white/50 mt-1">
                İzlemek istediğiniz bölüme tıklayarak doğrudan video oynatıcı sayfasına geçebilirsiniz.
              </p>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3">
              {/* Season Selector Tabs if Multi-Season with Fluid Sliding Pill */}
              {seasons.length > 1 && (
                <LayoutGroup id="seri-season-selector-group">
                  <div className="flex items-center gap-1 p-1 rounded-full glass-pill-dark border border-white/12 overflow-x-auto no-scrollbar">
                    {seasons.map((s) => {
                      const active = selectedSeason === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            if (selectedSeason === s) return;
                            React.startTransition(() => {
                              setSelectedSeason(s);
                              setShowAllEpisodes(false);
                            });
                          }}
                          className={`relative px-4 py-1.5 rounded-full text-xs font-bold font-mono transition-colors duration-200 cursor-pointer select-none ${
                            active
                              ? 'text-white'
                              : 'text-white/70 hover:text-white'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="seri-season-active-pill"
                              initial={false}
                              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.5 }}
                              className="absolute inset-0 rounded-full bg-[#2997ff] shadow-[0_0_16px_rgba(41,151,255,0.45)]"
                            />
                          )}
                          <span className="relative z-10">{s}. Sezon</span>
                        </button>
                      );
                    })}
                  </div>
                </LayoutGroup>
              )}

              {seasonEpisodes.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllEpisodes((v) => !v)}
                  className="text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <span>{showAllEpisodes ? 'Daha Az Göster' : 'Tümünü Gör'}</span>
                  {showAllEpisodes ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {seasonEpisodes.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/45">
              Bu sezon için henüz bölüm yüklenmedi.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {(showAllEpisodes ? seasonEpisodes : seasonEpisodes.slice(0, 4)).map((ep) => {
                  const isWatched = (userProg?.watched_episodes || []).includes(
                    ep.episode_number
                  );
                  return (
                    <div
                      key={`${ep.season_number}-${ep.episode_number}`}
                      className={`p-4 rounded-2xl border transition-all duration-300 flex items-center justify-between group shadow-md ${
                        isWatched
                          ? 'bg-emerald-500/[0.05] hover:bg-emerald-500/[0.09] border-emerald-500/35 hover:border-emerald-400/65 shadow-[0_0_14px_rgba(16,185,129,0.16)] hover:shadow-[0_0_22px_rgba(16,185,129,0.3)]'
                          : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06] hover:border-sky-400/60 hover:shadow-[0_0_18px_rgba(56,189,248,0.22)]'
                      }`}
                    >
                      <Link
                        href={`/seri/${media.slug}/${ep.episode_number}?season=${ep.season_number || selectedSeason || 1}`}
                        className="flex items-center gap-3 min-w-0 pr-2 flex-1 cursor-pointer"
                      >
                        <div
                          className={`w-10 h-10 rounded-xl font-mono font-bold text-xs flex items-center justify-center shrink-0 border transition-colors ${
                            isWatched
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                              : 'bg-white/10 border-white/10 text-white/90'
                          }`}
                        >
                          {ep.episode_number}
                        </div>
                        <div className="min-w-0">
                          <div
                            className={`text-xs font-bold text-white transition-colors truncate ${
                              isWatched ? 'group-hover:text-emerald-300' : 'group-hover:text-sky-300'
                            }`}
                          >
                            {formatEpisodeTitle(
                              ep.episode_name,
                              ep.season_number || selectedSeason || 1,
                              ep.episode_number
                            )}
                          </div>
                          {isWatched && (
                            <div className="text-[10px] font-mono mt-0.5">
                              <span className="text-emerald-400 font-medium">İzlendi</span>
                            </div>
                          )}
                        </div>
                      </Link>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!user) {
                              openAuthModal('Bölümleri izlendi olarak işaretlemek için lütfen giriş yapın.');
                              return;
                            }
                            toggleEpisodeWatched(media, ep.episode_number);
                          }}
                          aria-label={isWatched ? 'İzlendi işaretini kaldır' : 'İzlendi olarak işaretle'}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer border ${
                            isWatched
                              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400 hover:bg-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                              : 'bg-white/[0.05] border-white/10 text-white/40 hover:text-white hover:border-white/30'
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <Link
                          href={`/seri/${media.slug}/${ep.episode_number}?season=${ep.season_number || selectedSeason || 1}`}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                            isWatched
                              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 group-hover:bg-emerald-500 group-hover:text-white group-hover:border-emerald-400 shadow-sm'
                              : 'bg-white/10 text-white group-hover:bg-[#2997ff] group-hover:text-white'
                          }`}
                          aria-label={`${ep.episode_number}. Bölümü İzle`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              {seasonEpisodes.length > 4 && (
                <div className="flex justify-center mt-6 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAllEpisodes((prev) => !prev)}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full apple-glass-pill hover:bg-white/15 text-xs font-semibold text-white/90 hover:text-white border border-white/15 transition-all cursor-pointer shadow-sm active:scale-95"
                  >
                    <span>
                      {showAllEpisodes
                        ? 'Daha Az Göster'
                        : `Tümünü Gör (${seasonEpisodes.length} Bölüm)`}
                    </span>
                    {showAllEpisodes ? (
                      <ChevronUp className="w-4 h-4 text-sky-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-sky-400" />
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* 5. RELATED RECOMMENDATIONS */}
        {relatedMedia.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] uppercase text-sky-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {[
                      COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] ||
                        media.country_name,
                      Array.isArray(media.categories) && media.categories.length > 0
                        ? media.categories.slice(0, 2).join(', ')
                        : null,
                      'Akıllı Eşleşme',
                    ]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                  Benzer Yapımlar & Önerilenler
                </h2>
              </div>
              {/* Arrow navigation buttons just like home page */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    relatedScrollRef.current?.scrollBy({ left: -560, behavior: 'smooth' })
                  }
                  aria-label="Sola Kaydır"
                  className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    relatedScrollRef.current?.scrollBy({ left: 560, behavior: 'smooth' })
                  }
                  aria-label="Sağa Kaydır"
                  className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              ref={relatedScrollRef}
              className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2 [-webkit-overflow-scrolling:touch]"
            >
              {relatedMedia.map((item) => (
                <AccordionMediaCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* 6. GENERAL SERIES DISCUSSION & COMMENTS */}
        <RichCommentSection
          targetType="media"
          mediaId={media.id}
          targetTitle={media.title}
        />
      </div>

      {/* Add To List Modal */}
      <AddToListModal
        isOpen={showAddToListModal}
        onClose={() => setShowAddToListModal(false)}
        media={media}
      />

      {/* Official Native YouTube Cinema Trailer Modal */}
      {showTrailerModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-3 sm:p-6 md:p-8 animate-in fade-in duration-200"
          onClick={() => setShowTrailerModal(false)}
        >
          {/* Top Bar with Title and Close Button */}
          <div
            className="w-full max-w-5xl flex items-center justify-between pb-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2 py-0.5 rounded bg-[#E50914] text-white font-black text-[10px] tracking-wider uppercase shrink-0">
                FRAGMAN
              </span>
              <h3 className="text-sm sm:text-base font-bold truncate text-white/90">
                {cleanMediaTitle(media.title)}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowTrailerModal(false)}
              aria-label="Fragmanı Kapat"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all cursor-pointer border border-white/15 hover:scale-105 active:scale-95"
            >
              <X className="w-4 h-4" />
              <span>Kapat (Esc)</span>
            </button>
          </div>

          {/* 16:9 Official YouTube Player Viewport */}
          <div
            className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl sm:rounded-3xl border border-white/15 overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.95)]"
            onClick={(e) => e.stopPropagation()}
          >
            {trailerYoutubeId ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailerYoutubeId}?autoplay=1&rel=0&playsinline=1`}
                title={`${cleanMediaTitle(media.title)} Fragman`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full h-full border-0"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/70">
                <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-[#E50914] animate-spin" />
                <span className="text-xs font-medium">Fragman aranıyor...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Series Issue Report Floating Modal */}
      {showSeriesReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#0e0e14] border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-white text-base">Seri Sorunu Bildir</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSeriesReport(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-white/60">
              <span className="font-semibold text-white/90">{media.title}</span> hakkında fark ettiğiniz eksik veya hatalı bir bilgiyi iletin. Moderasyon ekibimiz en kısa sürede inceleyecektir.
            </p>

            <form onSubmit={submitSeriesIssue} className="space-y-4">
              {/* Category Chips */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                  Bildirim Nedeni
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    'Eksik Bölümler Var',
                    'Eşleşme Yanlış',
                    'Oyuncu Bilgisi Eksik',
                    'Afiş Görseli Bozuk',
                    'Takvim Günü Yanlış',
                    'Diğer',
                  ].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSeriesReportCategory(cat)}
                      className={`p-2.5 rounded-xl text-xs text-left transition-all cursor-pointer border ${
                        seriesReportCategory === cat
                          ? 'bg-amber-400/20 border-amber-400/50 text-amber-200 font-semibold shadow-sm'
                          : 'bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-white/[0.06] hover:text-white'
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
                  value={seriesReportNote}
                  onChange={(e) => setSeriesReportNote(e.target.value)}
                  placeholder="Detaylı açıklama veya not ekleyin..."
                  className="w-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 rounded-2xl p-3 text-xs text-white placeholder-white/35 focus:outline-none focus:border-amber-400/60 focus:ring-2 focus:ring-amber-400/20 focus:shadow-[0_0_16px_rgba(251,191,36,0.25)] resize-none transition-all font-medium"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSeriesReport(false)}
                  className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium cursor-pointer transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="px-5 py-2 rounded-full bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isSubmittingReport ? 'İletiliyor...' : 'Bildirimi Gönder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
