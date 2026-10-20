'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Plus,
  Check,
  Info,
  Flame,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Clock,
  Award,
  Heart,
  Newspaper,
  Tv,
  Film,
  Globe,
  Layers,
  Star,
  Radio,
  Volume2,
  VolumeX,
  Bell,
  Eye,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  MagazinePost,
  getProxiedImageUrl,
  formatContentTypeTR,
  getEpisodeProgressStats,
  cleanOverviewText,
  cleanMediaTitle,
  formatViewCount,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard, { requestAccordionHover, preloadMediaImages } from '@/components/AccordionMediaCard';
import Top10Numeral from '@/components/Top10Numeral';
import { cachedQuery, getCache, registerMediaItems } from '@/lib/cache';
import {
  buildPersonalizedFeed,
  getTasteProfile,
  getTasteSummary,
  syncProgressToTasteProfile,
  openCookiePreferencesModal,
} from '@/lib/tasteProfile';
import { useDragScroll } from '@/hooks/useDragScroll';

// Vitrin Trailer Reveal & Seamless Loop Timing
const HERO_TRAILER_FIRST_REVEAL_SEC = 3.9;
const HERO_TRAILER_RESUME_REVEAL_SEC = 2.0;
const HERO_TRAILER_LOOP_LEAD_SEC = 0.6;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface HomeDataBundle {
  feats: MediaItem[];
  kds: MediaItem[];
  cds: MediaItem[];
  ans: MediaItem[];
  gls: MediaItem[];
  episodes: any[];
  people: PersonItem[];
  magPosts: MagazinePost[];
  // Server-side weekly trending (Supabase RPC get_weekly_top10)
  top10Series?: MediaItem[];
  top10Movies?: MediaItem[];
  recentEpsProcessed?: any[];
}

// Module-level cache so navigating back to home in the same session is 0ms instant
let memoryHomeBundle: HomeDataBundle | null = null;

const AWARD_BADGES = [
  'MDL 9.0+ Seçkisi',
  'Kore Reyting Rekortmeni',
  'Eleştirmenlerin Favorisi',
  'Öne Çıkan Yapım',
];

function getTypeBadgeClass(contentType?: string, countryCode?: string): string {
  const ct = (contentType || '').toLowerCase();
  const cc = (countryCode || '').toUpperCase();
  if (ct === 'anime') return 'badge-type badge-anime';
  if (ct === 'movie' || ct === 'film') return 'badge-type badge-movie';
  if (ct === 'program' || ct === 'variety') return 'badge-type badge-variety';
  if (cc === 'KR') return 'badge-type badge-kdrama';
  if (cc === 'CN') return 'badge-type badge-cdrama';
  if (cc === 'JP') return 'badge-type badge-anime';
  return 'badge-type badge-global';
}

export default function HomePage() {
  const router = useRouter();
  const {
    user,
    progressMap,
    updateWatchStatus,
    togglePersonFavorite,
    personFavorites,
    followedPersonIds,
    togglePersonFollow,
    triggerSound,
    isTrailerMuted,
    toggleTrailerMuted,
  } = useKoUp();

  const [heroItems, setHeroItems] = useState<MediaItem[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);
  const [heroTrailerYtId, setHeroTrailerYtId] = useState<string | null>(null);
  const [isHeroTrailerReady, setIsHeroTrailerReady] = useState(false);
  const [heroTrailerEnded, setHeroTrailerEnded] = useState(false);
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const [isHeroInViewport, setIsHeroInViewport] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);
  const heroPlayerRef = useRef<any>(null);
  const heroPlayerContainerRef = useRef<HTMLDivElement | null>(null);
  const heroTrailerTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Live mirrors for YouTube player callbacks (avoid stale closures)
  const heroRevealedRef = useRef(false);
  const heroPauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTrailerMutedRef = useRef(isTrailerMuted);
  const isHeroInViewportRef = useRef(isHeroInViewport);
  useEffect(() => {
    isTrailerMutedRef.current = isTrailerMuted;
  }, [isTrailerMuted]);
  useEffect(() => {
    isHeroInViewportRef.current = isHeroInViewport;
  }, [isHeroInViewport]);

  const [top10SeriesItems, setTop10SeriesItems] = useState<MediaItem[]>([]);
  const [top10MoviesItems, setTop10MoviesItems] = useState<MediaItem[]>([]);
  const [kdramaItems, setKdramaItems] = useState<MediaItem[]>([]);
  const [cdramaItems, setCdramaItems] = useState<MediaItem[]>([]);
  const [animeItems, setAnimeItems] = useState<MediaItem[]>([]);
  const [globalItems, setGlobalItems] = useState<MediaItem[]>([]);
  const [recentEpisodes, setRecentEpisodes] = useState<any[]>([]);
  const [topPeople, setTopPeople] = useState<PersonItem[]>([]);
  const [magPosts, setMagPosts] = useState<MagazinePost[]>([]);

  const top10SeriesScrollRef = useDragScroll<HTMLDivElement>();
  const top10MoviesScrollRef = useDragScroll<HTMLDivElement>();
  const heroThumbnailsRef = useDragScroll<HTMLDivElement>();

  const applyBundle = (bundle: HomeDataBundle) => {
    memoryHomeBundle = bundle;
    const {
      feats,
      kds,
      cds,
      ans,
      gls,
      people,
      magPosts: initialMagPosts,
      top10Series,
      top10Movies,
    } = bundle;
    if (feats?.length || kds?.length) {
      setHeroItems(feats && feats.length > 0 ? feats.slice(0, 6) : (kds || []).slice(0, 6));
    }
    if (top10Series && top10Series.length > 0) {
      setTop10SeriesItems(top10Series.slice(0, 10));
    } else if (kds?.length || ans?.length || cds?.length) {
      setTop10SeriesItems([
        ...(kds || []).filter((m) => m.content_type !== 'film').slice(0, 4),
        ...(ans || []).filter((m) => m.content_type !== 'film').slice(0, 4),
        ...(cds || []).filter((m) => m.content_type !== 'film').slice(0, 2),
      ]);
    }
    if (top10Movies && top10Movies.length > 0) {
      setTop10MoviesItems(top10Movies.slice(0, 10));
    } else {
      const fallbackFilms = [...(kds || []), ...(ans || []), ...(cds || []), ...(gls || [])].filter(
        (m) => m.content_type === 'film' || m.content_type === 'movie'
      );
      if (fallbackFilms.length > 0) {
        setTop10MoviesItems(fallbackFilms.slice(0, 10));
      }
    }
    if (kds) setKdramaItems(kds);
    if (cds) setCdramaItems(cds);
    if (ans) setAnimeItems(ans);
    if (gls) setGlobalItems(gls);
    if (people) setTopPeople(people);
    if (initialMagPosts && initialMagPosts.length > 0) {
      setMagPosts(initialMagPosts);
    }
    if (bundle.recentEpsProcessed && bundle.recentEpsProcessed.length > 0) {
      setRecentEpisodes(bundle.recentEpsProcessed);
    }

    // Register items into synchronous memory cache for 0ms navigation without competing with Hero LCP bandwidth
    if (typeof window !== 'undefined') {
      const allRowItems = [
        ...(kds || []),
        ...(ans || []),
        ...(cds || []),
        ...(gls || []),
        ...(feats || []),
        ...(top10Series || []),
        ...(top10Movies || []),
      ];
      registerMediaItems(allRowItems);
    }
  };

  useEffect(() => {
    // 1. Instantly populate on client mount from memory or localStorage cache for 0ms transition
    const cached = memoryHomeBundle || getCache<HomeDataBundle>('home_catalog_bundle_v5');
    if (cached) {
      applyBundle(cached);
    }

    async function fetchHomeData() {
      const homeData = await cachedQuery('home_catalog_bundle_v5', 300_000, async () => {
        const [
          featRes,
          kdRes,
          cdRes,
          anRes,
          glRes,
          epRes,
          peopRes,
          magRes,
          top10SeriesRes,
          top10MoviesRes,
        ] = await Promise.all([
          supabase
            .from('media')
            .select('*')
            .eq('is_featured', true)
            .not('backdrop_image', 'is', null)
            .order('featured_order', { ascending: true })
            .limit(10),
          supabase
            .from('media')
            .select('*')
            .eq('country_code', 'KR')
            .order('mdl_rating', { ascending: false, nullsFirst: false })
            .limit(16),
          supabase
            .from('media')
            .select('*')
            .eq('country_code', 'CN')
            .order('mdl_rating', { ascending: false, nullsFirst: false })
            .limit(16),
          supabase
            .from('media')
            .select('*')
            .eq('content_type', 'anime')
            .not('anilist_rating', 'is', null)
            .order('anilist_rating', { ascending: false })
            .limit(16),
          supabase
            .from('media')
            .select('*')
            .in('country_code', ['US', 'TH', 'TW', 'JP'])
            .neq('content_type', 'anime')
            .order('imdb_rating', { ascending: false, nullsFirst: false })
            .order('mdl_rating', { ascending: false, nullsFirst: false })
            .limit(16),
          supabase
            .from('episodes')
            .select(
              'id, media_id, season_number, episode_number, episode_name, published_at, status, scheduled_release_at, translation_note, react_fire'
            )
            .order('id', { ascending: false })
            .limit(12),
          supabase
            .from('people')
            .select('*')
            .order('favorites_count', { ascending: false })
            .order('drama_count', { ascending: false })
            .limit(12),
          supabase
            .from('magazine_posts')
            .select('*')
            .order('published_at', { ascending: false })
            .limit(8),
          // Separate Top 10 Series & Top 10 Movies from real user activity + cumulative views
          supabase.rpc('get_weekly_top10', {
            p_limit: 10,
            p_days: 7,
            p_category: 'series',
          }),
          supabase.rpc('get_weekly_top10', {
            p_limit: 10,
            p_days: 7,
            p_category: 'film',
          }),
        ]);

        let featItems = (featRes.data as MediaItem[]) || [];
        if (featItems.length < 4) {
          const { data: fallbackFeats } = await supabase
            .from('media')
            .select('*')
            .not('backdrop_image', 'is', null)
            .order('mdl_rating', { ascending: false, nullsFirst: false })
            .order('imdb_rating', { ascending: false, nullsFirst: false })
            .limit(8);
          if (fallbackFeats) {
            const seen = new Set(featItems.map((f) => f.id));
            const extra = fallbackFeats.filter((f) => !seen.has(f.id));
            featItems = [...featItems, ...extra];
          }
        }

        let movieItems = top10MoviesRes.error
          ? []
          : ((top10MoviesRes.data as MediaItem[]) || []);
        if (movieItems.length < 10) {
          const { data: fallbackMovies } = await supabase
            .from('media')
            .select('*')
            .eq('content_type', 'film')
            .not('cover_image', 'is', null)
            .order('imdb_rating', { ascending: false, nullsFirst: false })
            .order('views_total', { ascending: false, nullsFirst: false })
            .limit(10);
          if (fallbackMovies && fallbackMovies.length > 0) {
            const seen = new Set(movieItems.map((m) => m.id));
            const extra = fallbackMovies.filter((m) => !seen.has(m.id));
            movieItems = [...movieItems, ...extra].slice(0, 10);
          }
        }

        return {
          feats: featItems,
          kds: (kdRes.data as MediaItem[]) || [],
          cds: (cdRes.data as MediaItem[]) || [],
          ans: (anRes.data as MediaItem[]) || [],
          gls: (glRes.data as MediaItem[]) || [],
          episodes: epRes.data || [],
          people: (peopRes.data as PersonItem[]) || [],
          magPosts: (magRes.data as MagazinePost[]) || [],
          top10Series: top10SeriesRes.error
            ? []
            : ((top10SeriesRes.data as MediaItem[]) || []),
          top10Movies: movieItems,
        };
      });

      applyBundle(homeData);

      // Canlı AsyaMag API Güncellemesi
      fetch('/api/magazin/live?limit=8')
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j?.posts) && j.posts.length > 0) {
            setMagPosts(j.posts);
            if (memoryHomeBundle) memoryHomeBundle.magPosts = j.posts;
          }
        })
        .catch(() => {});

      let processedEps: any[] = [];
      const episodes = homeData.episodes;
      if (episodes && episodes.length > 0) {
        const mIds = Array.from(new Set(episodes.map((e: any) => e.media_id)));
        const mRows = await cachedQuery(
          `home_episodes_media_${mIds.sort().join('_')}`,
          300_000,
          async () => {
            const { data } = await supabase.from('media').select('*').in('id', mIds);
            return (data as MediaItem[]) || [];
          }
        );
        const mMap = new Map(((mRows as MediaItem[]) || []).map((m) => [m.id, m]));
        processedEps = episodes
          .map((e: any) => ({ ...e, media: mMap.get(e.media_id) }))
          .filter((e: any) => e.media);
        setRecentEpisodes(processedEps);
      }

      memoryHomeBundle = {
        ...homeData,
        recentEpsProcessed: processedEps,
      };
    }
    fetchHomeData();
  }, []);

  // Auto-advance hero slider:
  // - If a trailer is actively playing: let it play through without abruptly cutting it off!
  // - Once trailer ends: return to the static backdrop image, hold for 6 seconds, then advance to next series
  // - If no trailer: advance every 8.5 seconds
  // Synchronize Hero Carousel Advance:
  // - If a trailer is actively looping: let it play for a 35s cinematic showcase, then smoothly advance
  // - Once trailer ends (or static): advance after 8.5 seconds
  useEffect(() => {
    if (isHeroPaused || !isHeroInViewport || heroItems.length <= 1) return;

    // While trailer is actively looping on desktop/PC, provide a 35-second cinematic showcase before auto-advancing
    if (isDesktop && isHeroTrailerReady && !heroTrailerEnded) {
      const trailerAdvanceTimer = setTimeout(() => {
        setHeroIdx((prev) => (prev + 1) % heroItems.length);
      }, 35000);
      return () => clearTimeout(trailerAdvanceTimer);
    }

    const delayMs = heroTrailerEnded ? 6000 : 8500;
    const t = setTimeout(() => {
      setHeroIdx((prev) => (prev + 1) % heroItems.length);
    }, delayMs);

    return () => clearTimeout(t);
  }, [isHeroPaused, isHeroInViewport, heroItems.length, isHeroTrailerReady, heroTrailerEnded, isDesktop]);

  // Pause hero trailer video and slide advance when scrolled out of viewport (or tab hidden)
  useEffect(() => {
    const el = heroSectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = entry.isIntersecting;
        isHeroInViewportRef.current = inView;
        setIsHeroInViewport(inView);
      },
      { threshold: 0.12 }
    );
    observer.observe(el);

    const checkInView = () => {
      if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) {
        isHeroInViewportRef.current = false;
        setIsHeroInViewport(false);
      } else {
        if (heroSectionRef.current) {
          const rect = heroSectionRef.current.getBoundingClientRect();
          const inView = rect.bottom > 100 && rect.top < window.innerHeight - 100;
          isHeroInViewportRef.current = inView;
          setIsHeroInViewport(inView);
        }
      }
    };

    const handleBlur = () => {
      // User minimized or switched away from the browser window: mute and pause immediately!
      isHeroInViewportRef.current = false;
      setIsHeroInViewport(false);
    };

    document.addEventListener('visibilitychange', checkInView);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', checkInView);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', checkInView);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', checkInView);
    };
  }, []);

  const activeHero = heroItems[heroIdx] || heroItems[0];

  // Fetch trailer for active Hero vitrin after a smooth 150ms stabilization delay (PC / Desktop Only)
  useEffect(() => {
    setHeroTrailerYtId(null);
    setIsHeroTrailerReady(false);
    setHeroTrailerEnded(false);
    if (heroTrailerTimerRef.current) {
      clearTimeout(heroTrailerTimerRef.current);
    }
    // Strictly disable vitrin trailer on mobile devices
    if (!isDesktop || !activeHero?.id) return;

    const currentHeroId = activeHero.id;
    heroTrailerTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/media/trailer?id=${activeHero.id}&slug=${encodeURIComponent(activeHero.slug || '')}&title=${encodeURIComponent(activeHero.title || '')}`
        );
        if (!r.ok) return;
        const d = await r.json();
        if (d?.youtubeId && currentHeroId === activeHero.id) {
          setHeroTrailerEnded(false);
          setHeroTrailerYtId(d.youtubeId);
        }
      } catch {}
    }, 150);

    return () => {
      if (heroTrailerTimerRef.current) {
        clearTimeout(heroTrailerTimerRef.current);
      }
    };
  }, [activeHero?.id, activeHero?.slug, activeHero?.title, isDesktop]);

  // Load YouTube IFrame API script once globally (PC / Desktop Only)
  useEffect(() => {
    if (typeof window === 'undefined' || !isDesktop) return;
    if (!window.YT) {
      const existingScript = document.getElementById('youtube-iframe-api');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
      }
    }
  }, [isDesktop]);

  // Initialize and manage YouTube IFrame Player instance for active Hero trailer (PC / Desktop Only)
  useEffect(() => {
    if (!isDesktop || !heroTrailerYtId) {
      if (heroPlayerRef.current) {
        try {
          heroPlayerRef.current.destroy();
        } catch {}
        heroPlayerRef.current = null;
      }
      setIsHeroTrailerReady(false);
      setHeroTrailerEnded(false);
      return;
    }

    let isSubscribed = true;
    let progressPoll: ReturnType<typeof setInterval> | null = null;
    let bufferHideTimer: ReturnType<typeof setTimeout> | null = null;
    let playRevealTimer: ReturnType<typeof setTimeout> | null = null;
    let revealBaseline: number | null = null;
    let hasRevealedOnce = false;
    let lastLoopAt = 0;

    const clearPlayReveal = () => {
      if (playRevealTimer) {
        clearTimeout(playRevealTimer);
        playRevealTimer = null;
      }
    };

    const triggerReveal = (player: any) => {
      if (!isSubscribed || heroRevealedRef.current) return;
      if (!isHeroInViewportRef.current || (typeof document !== 'undefined' && document.hidden)) {
        try {
          player.mute();
          player.pauseVideo();
        } catch {}
        return;
      }
      heroRevealedRef.current = true;
      hasRevealedOnce = true;
      setIsHeroTrailerReady(true);
      if (!isTrailerMutedRef.current) {
        try {
          player.unMute();
          player.setVolume(85);
        } catch {}
      }
    };

    const setHidden = (player?: any) => {
      clearPlayReveal();
      if (heroRevealedRef.current) {
        heroRevealedRef.current = false;
        setIsHeroTrailerReady(false);
      }
      if (player) {
        try {
          player.mute();
        } catch {}
      }
    };

    const stopProgressPoll = () => {
      if (progressPoll) clearInterval(progressPoll);
      progressPoll = null;
    };

    const startProgressPoll = (player: any) => {
      stopProgressPoll();
      clearPlayReveal();

      if (!isHeroInViewportRef.current || (typeof document !== 'undefined' && document.hidden)) {
        try {
          player.mute();
          player.pauseVideo();
        } catch {}
        return;
      }

      // Reliable 1.35s countdown: YouTube's center play button overlay finishes fading out in ~1.0-1.2s.
      // At 1.35s, it is guaranteed gone.
      const delayMs = (hasRevealedOnce ? HERO_TRAILER_RESUME_REVEAL_SEC : HERO_TRAILER_FIRST_REVEAL_SEC) * 1000;
      playRevealTimer = setTimeout(() => {
        if (!isSubscribed) return;
        if (!isHeroInViewportRef.current || (typeof document !== 'undefined' && document.hidden)) {
          clearPlayReveal();
          return;
        }
        triggerReveal(player);
      }, delayMs);

      progressPoll = setInterval(() => {
        if (!isSubscribed) return stopProgressPoll();
        if (!isHeroInViewportRef.current || (typeof document !== 'undefined' && document.hidden)) {
          stopProgressPoll();
          clearPlayReveal();
          try {
            player.mute();
            player.pauseVideo();
          } catch {}
          return;
        }
        let t = NaN;
        let dur = 0;
        try {
          t = player.getCurrentTime();
          dur = player.getDuration() || 0;
        } catch {
          return;
        }
        if (!Number.isFinite(t)) return;

        if (!heroRevealedRef.current) {
          if (revealBaseline === null || t < revealBaseline) {
            revealBaseline = t;
          } else if (
            t - revealBaseline >=
            (hasRevealedOnce ? HERO_TRAILER_RESUME_REVEAL_SEC : HERO_TRAILER_FIRST_REVEAL_SEC)
          ) {
            clearPlayReveal();
            triggerReveal(player);
          }
        }

        // Loop just before the end so YouTube's end screen / replay button never renders
        if (dur > 5 && t >= dur - HERO_TRAILER_LOOP_LEAD_SEC && Date.now() - lastLoopAt > 2000) {
          lastLoopAt = Date.now();
          try {
            player.seekTo(0, true);
          } catch {}
        }
      }, 150);
    };

    const initPlayer = () => {
      if (!isSubscribed || !heroPlayerContainerRef.current) return;

      // Clean up previous instance
      if (heroPlayerRef.current) {
        try {
          heroPlayerRef.current.destroy();
        } catch {}
        heroPlayerRef.current = null;
      }

      const playerDivId = `yt-hero-player-${Date.now()}`;
      heroPlayerContainerRef.current.innerHTML = `<div id="${playerDivId}"></div>`;

      try {
        heroPlayerRef.current = new window.YT.Player(playerDivId, {
          videoId: heroTrailerYtId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: (e: any) => {
              if (!isSubscribed) return;
              try {
                e.target.mute();
              } catch {}
              if (isHeroInViewportRef.current) {
                e.target.playVideo();
              }
            },
            onStateChange: (e: any) => {
              if (!isSubscribed) return;
              const YTState = window.YT?.PlayerState;
              if (!YTState) return;

              // 1. PLAYING: start countdown & poll. Video is revealed after 1.35s once YouTube's
              //    own center play button has completely faded away. Audio unmutes at that exact moment.
              if (e.data === YTState.PLAYING) {
                if (!isHeroInViewportRef.current || (typeof document !== 'undefined' && document.hidden)) {
                  try {
                    e.target.mute();
                    e.target.pauseVideo();
                  } catch {}
                  return;
                }
                setHeroTrailerEnded(false);
                if (bufferHideTimer) {
                  clearTimeout(bufferHideTimer);
                  bufferHideTimer = null;
                }
                if (!heroRevealedRef.current) revealBaseline = null;
                startProgressPoll(e.target);
              }
              // 2. BUFFERING: hide only if YouTube's spinner would stay on screen
              else if (e.data === YTState.BUFFERING) {
                if (bufferHideTimer) clearTimeout(bufferHideTimer);
                bufferHideTimer = setTimeout(() => {
                  try {
                    if (e.target.getPlayerState() === YTState.BUFFERING) {
                      revealBaseline = null;
                      setHidden(e.target);
                    }
                  } catch {}
                }, 450);
              }
              // 3. PAUSED / CUED / UNSTARTED: hide immediately and mute so the pause bezel / play button is NEVER visible
              else if (
                e.data === YTState.PAUSED ||
                e.data === YTState.CUED ||
                e.data === -1
              ) {
                stopProgressPoll();
                revealBaseline = null;
                setHidden(e.target);
              }
              // 4. ENDED (fallback if the pre-end loop was missed): hide, restart silently
              else if (e.data === YTState.ENDED) {
                revealBaseline = null;
                setHidden(e.target);
                try {
                  e.target.seekTo(0, true);
                  e.target.playVideo();
                } catch {}
              }
            },
            onError: () => {
              if (!isSubscribed) return;
              stopProgressPoll();
              setHidden();
              setIsHeroTrailerReady(false);
              setHeroTrailerEnded(true);
            },
          },
        });
      } catch (err) {
        console.error('Error initializing YT Player:', err);
      }
    };

    let didInit = false;
    const initOnce = () => {
      if (didInit) return;
      didInit = true;
      initPlayer();
    };

    if (window.YT && window.YT.Player) {
      initOnce();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        initOnce();
      };
      // Fallback check if script loads without triggering callback
      const checkInterval = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(checkInterval);
          initOnce();
        }
      }, 200);
      setTimeout(() => clearInterval(checkInterval), 4000);
    }

    return () => {
      isSubscribed = false;
      stopProgressPoll();
      clearPlayReveal();
      if (bufferHideTimer) clearTimeout(bufferHideTimer);
      if (heroPlayerRef.current) {
        try {
          heroPlayerRef.current.destroy();
        } catch {}
        heroPlayerRef.current = null;
      }
    };
  }, [heroTrailerYtId, isDesktop]);

  // Synchronize playback when hero scrolls into or out of view
  useEffect(() => {
    const p = heroPlayerRef.current;
    if (!p) return;
    if (heroPauseTimerRef.current) {
      clearTimeout(heroPauseTimerRef.current);
      heroPauseTimerRef.current = null;
    }
    try {
      if (isHeroInViewport && (typeof document === 'undefined' || !document.hidden)) {
        if (!heroTrailerEnded && heroTrailerYtId) {
          p.playVideo();
          if (!isTrailerMuted && heroRevealedRef.current && isHeroTrailerReady) {
            p.unMute();
            p.setVolume(85);
          }
        }
      } else {
        heroRevealedRef.current = false;
        setIsHeroTrailerReady(false);
        try {
          p.mute();
          p.pauseVideo();
        } catch {}
      }
    } catch {}
  }, [isHeroInViewport, heroTrailerEnded, heroTrailerYtId, isTrailerMuted, isHeroTrailerReady]);

  // Synchronize Hero YouTube player volume & mute state whenever global isTrailerMuted changes
  useEffect(() => {
    const p = heroPlayerRef.current;
    if (p && typeof p.mute === 'function') {
      try {
        if (isTrailerMuted) {
          p.mute();
        } else {
          // Strictly only unmute if the trailer has actually been revealed to the user!
          if (heroRevealedRef.current && isHeroTrailerReady) {
            p.unMute();
            p.setVolume(85);
          }
        }
      } catch {}
    }
  }, [isTrailerMuted, isHeroTrailerReady]);

  const continueWatchingItems = useMemo(() => {
    if (!user) return [];
    const watchingProgressList = Object.values(progressMap)
      .filter((p) => {
        if (p.status === 'dropped') return false;
        if (p.status === 'watching') return true;
        const pos = p.resume_position_sec || 0;
        const dur = p.resume_duration_sec || 3600;
        if (pos > 15 && dur > 0 && pos / dur < 0.85) return true;
        return (
          Array.isArray(p.watched_episodes) &&
          p.watched_episodes.length > 0 &&
          p.status !== 'completed'
        );
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    if (watchingProgressList.length === 0) return [];

    const pool = [...kdramaItems, ...animeItems, ...cdramaItems, ...globalItems, ...heroItems];
    const poolMap = new Map<number, MediaItem>();
    pool.forEach((m) => poolMap.set(m.id, m));

    const seen = new Set<number>();
    const result: MediaItem[] = [];
    for (const p of watchingProgressList) {
      const mediaItem = poolMap.get(p.media_id) || p.media;
      if (mediaItem && !seen.has(mediaItem.id)) {
        seen.add(mediaItem.id);
        result.push(mediaItem);
        if (result.length >= 8) break;
      }
    }
    return result;
  }, [user, progressMap, kdramaItems, animeItems, cdramaItems, globalItems, heroItems]);

  const [tasteVersion, setTasteVersion] = useState(0);

  // Sync user's watch progress into Taste DNA and listen for live taste/cookie updates
  useEffect(() => {
    const allPool = [
      ...kdramaItems,
      ...animeItems,
      ...cdramaItems,
      ...globalItems,
      ...heroItems,
    ];
    if (allPool.length > 0 && Object.keys(progressMap).length > 0) {
      syncProgressToTasteProfile(progressMap, allPool);
    }
  }, [progressMap, kdramaItems, animeItems, cdramaItems, globalItems, heroItems]);

  useEffect(() => {
    const bump = () => setTasteVersion((v) => v + 1);
    window.addEventListener('koup:taste-updated', bump);
    window.addEventListener('koup:consent-updated', bump);
    return () => {
      window.removeEventListener('koup:taste-updated', bump);
      window.removeEventListener('koup:consent-updated', bump);
    };
  }, []);

  const { personalizedItems, tasteSummary, orderedCategoryRows } = useMemo(() => {
    const allPool = [
      ...kdramaItems,
      ...animeItems,
      ...cdramaItems,
      ...globalItems,
      ...heroItems,
    ];
    const profile = getTasteProfile();
    const summary = getTasteSummary(profile);
    const feed = buildPersonalizedFeed(allPool, progressMap, 14);

    const baseRows = [
      {
        key: 'kdrama',
        score: (profile.countries['KR'] || 0) + (profile.types['dizi'] || 0) * 0.5,
                title: 'Kore Dizileri',
        href: '/kesfet?country=KR',
        items: kdramaItems,
      },
      {
        key: 'anime',
        score: (profile.types['anime'] || 0) * 1.4 + (profile.countries['JP'] || 0) * 0.8,
                title: 'Animeler',
        href: '/kesfet?type=anime',
        items: animeItems,
      },
      {
        key: 'cdrama',
        score: (profile.countries['CN'] || 0) * 1.3,
                title: 'Çin Dizileri',
        href: '/kesfet?country=CN',
        items: cdramaItems,
      },
    ];

    if (summary.hasTaste) {
      baseRows.sort((a, b) => b.score - a.score);
    }

    return {
      personalizedItems: feed,
      tasteSummary: summary,
      orderedCategoryRows: baseRows,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kdramaItems, animeItems, cdramaItems, globalItems, heroItems, progressMap, tasteVersion]);

  return (
    <div className="min-h-screen pb-28 bg-[#080808] w-full max-w-full overflow-x-hidden">
      {/* =====================================================================
          1. HERO SECTION: Full-Viewport Cinematic Immersion Banner (ui/code.html)
      ===================================================================== */}
      <section
        ref={heroSectionRef}
        onMouseEnter={() => setIsHeroPaused(true)}
        onMouseLeave={() => setIsHeroPaused(false)}
        className="relative w-full h-[94vh] min-h-[640px] max-h-[1040px] flex items-end overflow-hidden max-w-full"
      >
        {activeHero ? (
          <>
            {/* Crossfading Widescreen Backdrop */}
            <div className="absolute inset-0 w-full h-full overflow-hidden">
              <AnimatePresence mode="sync">
                <motion.img
                  key={activeHero.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: 'easeOut' }}
                  src={getProxiedImageUrl(
                    activeHero.backdrop_image || activeHero.cover_image,
                    activeHero.cover_image,
                    activeHero.title,
                    'w1280'
                  )}
                  alt={activeHero.title}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover object-center"
                />
              </AnimatePresence>

              {/* Dynamic 16:9 Cinema Hero Trailer Video (Netflix Style - PC / Desktop Only) */}
              {isDesktop && heroTrailerYtId && (
                <div
                  className={`hidden md:block absolute inset-0 w-full h-full overflow-hidden transition-opacity duration-700 pointer-events-none select-none z-0 ${
                    isHeroTrailerReady && !heroTrailerEnded ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{
                    visibility: isHeroTrailerReady && !heroTrailerEnded ? 'visible' : 'hidden',
                  }}
                >
                  <div
                    ref={heroPlayerContainerRef}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[56.25vw] min-h-full min-w-[177.77vh] scale-[1.28] transform-gpu border-0 pointer-events-none select-none [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:border-0 [&_iframe]:pointer-events-none"
                  />
                  {/* Invisible overlay absorbing any inadvertent clicks */}
                  <div className="absolute inset-0 pointer-events-auto bg-transparent select-none z-10" />
                </div>
              )}

              {/* 1. Deep Cinema Vignette Layer */}
              <div className="absolute inset-0 cinema-vignette pointer-events-none z-10" />

              {/* 2. Soft Obsidian Bottom Gradient: Melts the bottom seamlessly into the #080808 background without hiding the lower video */}
              <div className="absolute inset-x-0 bottom-0 h-44 sm:h-56 md:h-64 bg-gradient-to-t from-[#080808] via-[#080808]/70 via-25% to-transparent pointer-events-none z-10" />

              {/* 3. Left-edge text protection gradient: keeps typography legible while letting video & backdrop show through */}
              <div className="absolute inset-y-0 left-0 w-full sm:w-3/5 md:w-[46%] bg-gradient-to-r from-[#080808]/85 via-[#080808]/40 to-transparent pointer-events-none z-10" />

              {/* 4. Top-edge navbar blend */}
              <div className="absolute inset-x-0 top-0 h-28 sm:h-36 bg-gradient-to-b from-[#080808]/65 via-[#080808]/20 to-transparent pointer-events-none z-10" />
            </div>

            {/* Top-Right Hero Mute/Unmute Button (Netflix Style: Pure white icon with shadow - PC / Desktop Only) */}
            {isDesktop && heroTrailerYtId && isHeroTrailerReady && !heroTrailerEnded && (
              <div className="hidden md:block absolute top-20 sm:top-24 md:top-28 right-4 sm:right-6 md:right-14 z-30">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerSound?.('click');
                    toggleTrailerMuted();
                  }}
                  aria-label={isTrailerMuted ? 'Vitrin Fragman Sesini Aç' : 'Vitrin Fragman Sesini Kapat'}
                  className="p-2 text-white/95 hover:text-white hover:scale-120 active:scale-90 transition-transform cursor-pointer drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)]"
                >
                  {isTrailerMuted ? (
                    <VolumeX className="w-5 h-5 sm:w-7 sm:h-7 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" />
                  ) : (
                    <Volume2 className="w-5 h-5 sm:w-7 sm:h-7 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]" />
                  )}
                </button>
              </div>
            )}

            {/* Hero Main Typographic Overlay */}
            <div className="relative z-20 w-full px-4 sm:px-6 md:px-14 pb-12 sm:pb-16 flex flex-col lg:flex-row lg:items-end justify-between gap-8 lg:gap-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeHero.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                  className="max-w-2xl flex flex-col gap-3.5 sm:gap-4 min-w-0"
                >
                  {/* Genuine Metadata */}
                  <div className="flex items-center flex-wrap gap-2 text-[10px] sm:text-[11px] font-semibold tracking-[0.12em] uppercase text-white/75">
                    <span className={getTypeBadgeClass(activeHero.content_type, activeHero.country_code || activeHero.country)}>
                      {formatContentTypeTR(activeHero.content_type, activeHero.country_code || activeHero.country)}
                    </span>
                    {activeHero.release_year && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="text-white/90">{activeHero.release_year}</span>
                      </>
                    )}
                    <span className="text-white/35">•</span>
                    <span className="text-white/90">FHD 1080p</span>
                    {activeHero.mdl_rating && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="text-amber-300 font-bold tracking-normal text-[11px] sm:text-[12px]">
                          MDL {activeHero.mdl_rating}
                        </span>
                      </>
                    )}
                    {(() => {
                      const score = activeHero.imdb_rating ?? activeHero.imdb_score ?? activeHero.vote_average;
                      if (!score || isNaN(Number(score)) || Number(score) <= 0) return null;
                      return (
                        <>
                          <span className="text-white/35">•</span>
                          <span className="text-[#f5c518] font-bold tracking-normal text-[11px] sm:text-[12px]">
                            IMDb {Number(score).toFixed(1)}
                          </span>
                        </>
                      );
                    })()}
                    {activeHero.anilist_rating && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="text-sky-300 font-bold tracking-normal text-[11px] sm:text-[12px]">
                          AniList {activeHero.anilist_rating}%
                        </span>
                      </>
                    )}
                  </div>

                  {/* Pure White Display Title */}
                  <h1 className="text-2xl sm:text-4xl md:text-6xl lg:text-7xl font-extrabold text-white tracking-[-0.04em] leading-[1.1] drop-shadow-[0_12px_32px_rgba(0,0,0,0.9)] break-words">
                    {cleanMediaTitle(activeHero.title)}
                  </h1>

                  <p className="text-xs sm:text-[15px] md:text-[16px] text-white/75 font-normal leading-relaxed max-w-xl line-clamp-2 sm:line-clamp-3 drop-shadow-md break-words">
                    {cleanOverviewText(activeHero.overview) ||
                      'KoUp 1080p sinema kalitesinde, tüm alternatif kaynaklar ve Türkçe altyazı seçenekleriyle hemen izlemeye başlayın.'}
                  </p>

                  {/* Sleek Pill Actions (Exact ui/code.html) */}
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3.5 pt-1 sm:pt-2 w-full">
                    {(() => {
                      const heroProg = user ? progressMap[activeHero.id] : undefined;
                      const heroStats = getEpisodeProgressStats(heroProg, activeHero);
                      const hasWatchedProgress =
                        heroStats.watchedCount > 0 || heroProg?.status === 'watching';
                      const isHeroFilm = activeHero.content_type === 'film' || activeHero.content_type === 'movie';

                      return (
                        <Link
                          href={
                            hasWatchedProgress
                              ? `/seri/${activeHero.slug}/${heroStats.nextEpisode}?season=${heroStats.season}`
                              : `/seri/${activeHero.slug}/1?season=1`
                          }
                          prefetch={true}
                          onClick={() => triggerSound('click')}
                          className="flex-1 sm:flex-initial justify-center flex items-center gap-2 px-5 sm:px-8 py-3 sm:py-3.5 rounded-full bg-white text-black font-bold text-xs sm:text-[14px] hover:bg-white/90 active:scale-[0.98] transition-all duration-200 transform-gpu backface-hidden glow-white cursor-pointer whitespace-nowrap"
                        >
                          <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-black shrink-0" />
                          <span>
                            {isHeroFilm
                              ? hasWatchedProgress
                                ? 'Filme Devam Et'
                                : 'Filmi İzle'
                              : hasWatchedProgress
                              ? `${heroStats.nextEpisode}. Bölümden Devam Et`
                              : 'Hemen İzle'}
                          </span>
                        </Link>
                      );
                    })()}

                    <button
                      onClick={() =>
                        updateWatchStatus(activeHero.id, 'watching', 1, 1)
                      }
                      className="flex-1 sm:flex-initial justify-center flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-3.5 rounded-full glass-pill hover:bg-white/15 text-white font-semibold text-xs sm:text-[14px] active:scale-[0.98] transition-all duration-200 transform-gpu backface-hidden cursor-pointer whitespace-nowrap"
                    >
                      {user && progressMap[activeHero.id] && progressMap[activeHero.id]?.status !== 'dropped' ? (
                        <>
                          <Check className="w-4 h-4 text-sky-400 shrink-0" />
                          <span>Listemde</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 text-white/85 shrink-0" />
                          <span>Listeme Ekle</span>
                        </>
                      )}
                    </button>

                    <Link
                      href={`/seri/${activeHero.slug}`}
                      prefetch={true}
                      aria-label="Detaylar"
                      className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-full glass-pill hover:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all duration-300"
                    >
                      <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                    </Link>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Floating Interactive Preview Rail (Bottom Right — Exact ui/code.html) */}
              <div className="relative flex flex-col items-start lg:items-end gap-2 sm:gap-2.5 z-20 w-full lg:w-auto max-w-full min-w-0 overflow-hidden">
                <span className="text-[10px] tracking-[0.2em] font-semibold uppercase text-white/45">
                  Sıradaki Vitrin Seçkisi
                </span>
                <div
                  ref={heroThumbnailsRef}
                  className="flex items-center gap-2 sm:gap-2.5 glass-pill-dark p-1.5 rounded-2xl shadow-[0_20px_45px_rgba(0,0,0,0.85)] max-w-full overflow-x-auto no-scrollbar scroll-smooth [-webkit-overflow-scrolling:touch]"
                >
                  {heroItems.slice(0, 4).map((hItem, idx) => {
                    const active = idx === heroIdx;
                    return (
                      <button
                        key={hItem.id}
                        type="button"
                        onClick={() => {
                          triggerSound('click');
                          setHeroIdx(idx);
                        }}
                        aria-label={cleanMediaTitle(hItem.title)}
                        title={cleanMediaTitle(hItem.title)}
                        className={`relative w-16 h-10 sm:w-20 sm:h-12 rounded-xl overflow-hidden cursor-pointer transition-opacity duration-200 shrink-0 ${
                          active
                            ? 'ring-2 ring-white opacity-100 shadow-[0_0_20px_rgba(255,255,255,0.45)] z-10'
                            : 'opacity-40 hover:opacity-85 ring-1 ring-white/15'
                        }`}
                      >
                        <img
                          src={getProxiedImageUrl(
                            hItem.backdrop_image || hItem.cover_image,
                            hItem.cover_image,
                            hItem.title
                          )}
                          alt={hItem.title}
                          loading="lazy"
                          fetchPriority="low"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (!target.dataset.triedCover && hItem.cover_image && target.src !== hItem.cover_image) {
                              target.dataset.triedCover = 'true';
                              target.src = getProxiedImageUrl(hItem.cover_image, null, hItem.title);
                            }
                          }}
                          className="w-full h-full object-cover"
                        />
                        {active && (
                          <div className="absolute inset-0 ring-1 ring-inset ring-white/30 pointer-events-none" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="relative w-full h-full bg-[#0a0a0f] flex flex-col justify-end px-4 sm:px-6 md:px-14 pb-16 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-transparent to-black/40 pointer-events-none" />
            <div className="relative z-10 max-w-2xl space-y-4">
              <div className="h-4 w-32 bg-white/[0.08] rounded-full animate-pulse" />
              <div className="h-10 sm:h-14 w-3/4 max-w-lg bg-white/[0.08] rounded-2xl animate-pulse" />
              <div className="space-y-2 pt-1">
                <div className="h-3.5 w-full max-w-md bg-white/[0.05] rounded-md animate-pulse" />
                <div className="h-3.5 w-2/3 max-w-sm bg-white/[0.05] rounded-md animate-pulse" />
              </div>
              <div className="flex gap-4 pt-4">
                <div className="h-12 w-36 bg-white/[0.08] rounded-full animate-pulse" />
                <div className="h-12 w-32 bg-white/[0.05] rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="w-full space-y-12 sm:space-y-16 pt-8 sm:pt-12 max-w-full overflow-x-hidden">
        {/* =====================================================================
            2. 21:9 ULTRA-WIDE CINEMA CARDS ("Kaldığın Yerden Devam Et" — Exact ui/code.html)
        ===================================================================== */}
        {continueWatchingItems.length > 0 && (
          <section className="w-full px-4 sm:px-6 md:px-14 max-w-full">
            <div className="flex flex-col gap-1 mb-4 sm:mb-6">
              <div className="flex items-center justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                  Kişisel Arşiv
                </span>
                <Link
                  href="/gecmis"
                  prefetch={true}
                  className="text-[11px] sm:text-[12px] tracking-wider uppercase font-semibold text-white/50 hover:text-white flex items-center gap-1 transition-colors"
                >
                  <span>Tümünü Gör</span>
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Link>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white mt-0.5">
                Kaldığın Yerden Devam Et
              </h2>
            </div>

            <div className="flex md:grid md:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto md:overflow-visible pb-3 md:pb-0 no-scrollbar snap-x snap-mandatory [-webkit-overflow-scrolling:touch] max-w-full">
              {continueWatchingItems.map((item) => {
                const prog = progressMap[item.id];
                const stats = getEpisodeProgressStats(prog, item);
                const isFilmItem = item.content_type === 'film' || item.content_type === 'movie' || stats.isFilm;
                const barPct = Math.max(
                  stats.watchedCount > 0 ? 6 : 3,
                  stats.progressPercent
                );

                return (
                  <Link
                    key={item.id}
                    href={`/seri/${item.slug}/${stats.nextEpisode}?season=${stats.season}`}
                    prefetch={true}
                    className="w-[78vw] sm:w-[82vw] max-w-[320px] sm:max-w-[340px] shrink-0 md:w-auto snap-start group relative rounded-2xl sm:rounded-3xl overflow-hidden aspect-[16/10] sm:aspect-[21/9] min-h-[160px] sm:min-h-[175px] bg-[#0c0c0e] border border-white/10 hover:border-white/30 transition-all duration-300 active:scale-[0.99] shadow-xl cursor-pointer block"
                  >
                    {/* Full Card Cover Image with gentle zoom on hover */}
                    <img
                      src={getProxiedImageUrl(
                        item.backdrop_image || item.cover_image,
                        item.title
                      )}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                    />

                    {/* Smooth Bottom Gradient Darkening (Görsel kesilmiyor, altta estetik karartma) */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent pointer-events-none" />



                    {/* Card Content Overlay pinned to bottom */}
                    <div className="absolute inset-x-0 bottom-0 z-10 p-3.5 sm:p-4 flex flex-col justify-end">
                      <div className="flex items-center justify-between gap-2 mb-2 sm:mb-2.5">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-white font-bold text-xs sm:text-[14px] truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {cleanMediaTitle(item.title)}
                          </span>
                          <span className="text-[10px] sm:text-[11px] text-sky-400 font-semibold tracking-wide mt-0.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {isFilmItem
                              ? 'Filme Devam Et'
                              : `S${stats.season} • ${stats.nextEpisode}. Bölümden Devam Et`}
                          </span>
                        </div>
                        <span className="text-[10px] sm:text-[11px] font-mono text-white/80 shrink-0 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/15 shadow-sm">
                          {isFilmItem
                            ? stats.resumePos > 60
                              ? `${Math.floor(stats.resumePos / 60)}/${Math.max(1, Math.floor(stats.resumeDur / 60))} Dk`
                              : 'FİLM'
                            : `${stats.watchedCount}/${stats.totalEpisodes} Bölüm`}
                        </span>
                      </div>

                      {/* Floating Inset Progress Bar (Kenarlara yapışık değil, yüzer vaziyette) */}
                      <div className="w-full h-1.5 rounded-full bg-white/25 backdrop-blur-md overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.95)] transition-all duration-500"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* =====================================================================
            3A. TOP 10 DİZİLER WITH INTEGRATED STROKE OUTLINE NUMERALS
        ===================================================================== */}
        {top10SeriesItems.length > 0 && (
          <section className="w-full px-4 sm:px-6 md:px-14 cv-auto max-w-full">
            <div className="flex flex-col gap-1 mb-6 sm:mb-8">
              <div className="flex items-center justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase text-sky-400/80">
                  Trend Diziler
                </span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() =>
                      top10SeriesScrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })
                    }
                    aria-label="Geri"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <button
                    onClick={() =>
                      top10SeriesScrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })
                    }
                    aria-label="İleri"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white mt-0.5">
                Bugün Türkiye&apos;de En Popüler 10 Dizi
              </h2>
            </div>

            <div
              ref={top10SeriesScrollRef}
              className="flex items-end gap-4 sm:gap-8 md:gap-10 overflow-x-auto overflow-y-hidden overscroll-y-auto overscroll-x-contain pb-6 pt-3 no-scrollbar snap-x snap-mandatory [-webkit-overflow-scrolling:touch] h-[240px] sm:h-[320px] md:h-[380px] max-w-full"
            >
              {top10SeriesItems.map((item, idx) => (
                <Link
                  key={item.id}
                  href={`/seri/${item.slug}`}
                  prefetch={true}
                  className="shrink-0 flex items-end group cursor-pointer snap-start relative pl-2 sm:pl-4 md:pl-6"
                >
                  {/* Netflix/Apple TV+ Top 10 Stroke Numeral (Vector Clean, Artifact-Free) */}
                  <Top10Numeral
                    rank={idx + 1}
                    className="h-[76px] sm:h-[110px] md:h-[145px] w-auto select-none pointer-events-none drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)] -translate-x-2 sm:-translate-x-4 md:-translate-x-6 -mr-4 sm:-mr-6 md:-mr-8 z-0 shrink-0"
                  />

                  <div className="relative z-10 w-28 sm:w-40 md:w-52 min-w-[112px] sm:min-w-[160px] aspect-[2/3] rounded-xl sm:rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/10 group-hover:border-white/30 shadow-[0_20px_45px_rgba(0,0,0,0.85)] group-hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-end p-2.5 sm:p-4">
                    <img
                      src={getProxiedImageUrl(item.cover_image, item.title, null, 'w342', 'poster')}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-black/40 to-transparent" />
                    <div className="relative z-10 flex flex-col gap-0.5">
                      <span className="text-xs sm:text-[15px] font-bold text-white truncate">
                        {cleanMediaTitle(item.title)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-mono text-sky-300/90">
                        <Eye className="w-3 h-3 text-sky-400 shrink-0" />
                        <span>{formatViewCount(item.views_total ?? item.views_count ?? 0)}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* =====================================================================
            3B. TOP 10 FİLMLER WITH INTEGRATED STROKE OUTLINE NUMERALS
        ===================================================================== */}
        {top10MoviesItems.length > 0 && (
          <section className="w-full px-4 sm:px-6 md:px-14 cv-auto max-w-full">
            <div className="flex flex-col gap-1 mb-6 sm:mb-8">
              <div className="flex items-center justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase text-amber-400/80">
                  Trend Filmler
                </span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() =>
                      top10MoviesScrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })
                    }
                    aria-label="Geri"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <button
                    onClick={() =>
                      top10MoviesScrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })
                    }
                    aria-label="İleri"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white mt-0.5">
                Bugün Türkiye&apos;de En Popüler 10 Film
              </h2>
            </div>

            <div
              ref={top10MoviesScrollRef}
              className="flex items-end gap-4 sm:gap-8 md:gap-10 overflow-x-auto overflow-y-hidden overscroll-y-auto overscroll-x-contain pb-6 pt-3 no-scrollbar snap-x snap-mandatory [-webkit-overflow-scrolling:touch] h-[240px] sm:h-[320px] md:h-[380px] max-w-full"
            >
              {top10MoviesItems.map((item, idx) => (
                <Link
                  key={item.id}
                  href={`/seri/${item.slug}`}
                  prefetch={true}
                  className="shrink-0 flex items-end group cursor-pointer snap-start relative pl-2 sm:pl-4 md:pl-6"
                >
                  {/* Netflix/Apple TV+ Top 10 Stroke Numeral (Vector Clean, Artifact-Free) */}
                  <Top10Numeral
                    rank={idx + 1}
                    className="h-[76px] sm:h-[110px] md:h-[145px] w-auto select-none pointer-events-none drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)] -translate-x-2 sm:-translate-x-4 md:-translate-x-6 -mr-4 sm:-mr-6 md:-mr-8 z-0 shrink-0"
                  />

                  <div className="relative z-10 w-28 sm:w-40 md:w-52 min-w-[112px] sm:min-w-[160px] aspect-[2/3] rounded-xl sm:rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/10 group-hover:border-white/30 shadow-[0_20px_45px_rgba(0,0,0,0.85)] group-hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-end p-2.5 sm:p-4">
                    <img
                      src={getProxiedImageUrl(item.cover_image, item.title, null, 'w342', 'poster')}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-black/40 to-transparent" />
                    <div className="relative z-10 flex flex-col gap-0.5">
                      <span className="text-xs sm:text-[15px] font-bold text-white truncate">
                        {cleanMediaTitle(item.title)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-mono text-amber-300/90">
                        <Eye className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>{formatViewCount(item.views_total ?? item.views_count ?? 0)}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* =====================================================================
            4. SANA ÖZEL SEÇKİ (Cookie & İzleme Verisiyle Beslenen Canlı Öneri Satırı)
        ===================================================================== */}
        {personalizedItems.length > 0 && (
          <AccordionRow
            title="Sana Özel Önerilen Yapımlar"
            href="/kesfet"
            items={personalizedItems}
            onConfigureTaste={openCookiePreferencesModal}
          />
        )}

        {/* =====================================================================
            5. K-DRAMA, ANIME & C-DRAMA ACCORDION ROWS (Kullanıcı Zevkine Göre Dinamik Sıralı)
        ===================================================================== */}
        {orderedCategoryRows.map((row) => (
          <AccordionRow
            key={row.key}
            subtitle={row.subtitle}
            title={row.title}
            href={row.href}
            items={row.items}
          />
        ))}

        {/* =====================================================================
            7. OYUNCULAR, ANİME KARAKTERLERİ & SEİYUU LİDERLİK TABLOSU (No Emojis)
        ===================================================================== */}
        {topPeople.length > 0 && (
          <section className="w-full px-4 sm:px-6 md:px-14 cv-auto max-w-full">
            <div className="rounded-2xl sm:rounded-3xl bg-[#0f0f11] p-4 sm:p-8 border border-white/[0.08]">
              <div className="flex flex-col gap-1.5 mb-6">
                <div className="flex items-center justify-end">
                  <Link
                    href="/oyuncular"
                    prefetch={true}
                    className="inline-flex items-center gap-1.5 px-3.5 sm:px-5 py-1.5 sm:py-2.5 rounded-full glass-pill text-[11px] sm:text-xs font-semibold text-white hover:bg-white/15 transition-all whitespace-nowrap"
                  >
                    <span>Tüm Sıralama (21.814)</span>
                    <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </Link>
                </div>
                <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight mt-0.5">
                  En Çok Favorilenen Oyuncular
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                {topPeople.slice(0, 12).map((person, idx) => {
                  const isFav = personFavorites.includes(person.id);
                  const isFollowed = followedPersonIds.includes(person.id);
                  return (
                    <div
                      key={person.id}
                      className="rounded-2xl p-3 sm:p-3.5 flex flex-col items-center text-center group relative bg-[#0f0f11] border border-white/[0.08] hover:border-white/30 hover:shadow-[0_0_24px_-4px_rgba(41,151,255,0.25),0_10px_24px_rgba(0,0,0,0.7)] transition-all duration-300"
                    >
                      <span className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-black/75 border border-white/15 text-[9px] sm:text-[10px] font-mono font-bold text-white flex items-center justify-center">
                        #{idx + 1}
                      </span>

                      {/* Favorite (Like) & Follow (New Series Alert) Buttons */}
                      <div className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 flex items-center gap-1.5 z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePersonFavorite(person.id, person.name);
                          }}
                          aria-label={isFav ? "Favorilerden Çıkar" : "Favorilere Ekle (Beğen)"}
                          title={isFav ? "Favorilerimde" : "Favorilere Ekle (Beğen)"}
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                            isFav
                              ? 'bg-rose-500 border-rose-300 text-white shadow-[0_0_10px_rgba(244,63,94,0.4)]'
                              : 'bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40'
                          }`}
                        >
                          <Heart className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isFav ? 'fill-white' : ''}`} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePersonFollow(person.id, person.name);
                          }}
                          aria-label={isFollowed ? "Takibi Bırak" : "Takip Et (Yeni Seri Bildirimi)"}
                          title={isFollowed ? "Takip Ediliyor (Yeni seriler bildirilecek)" : "Takip Et (Yeni serilerinde bildirim al)"}
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                            isFollowed
                              ? 'bg-sky-400 border-sky-300 text-slate-950 shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                              : 'bg-black/60 border-white/15 text-white/70 hover:text-white hover:border-white/40'
                          }`}
                        >
                          <Bell className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isFollowed ? 'fill-slate-950' : ''}`} />
                        </button>
                      </div>

                      <Link href={`/oyuncu/${person.slug}`} prefetch={true} className="flex flex-col items-center w-full">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden border border-white/15 group-hover:border-white/40 transition-all mb-2.5 sm:mb-3">
                          <img
                            src={getProxiedImageUrl(person.image_url, person.name, null, 'w500', 'person')}
                            alt={person.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="text-xs font-bold text-white line-clamp-1 w-full">
                          {person.name}
                        </div>
                        <div className="text-[10px] text-white/45 mt-0.5 truncate w-full">
                          {person.person_type === 'character'
                            ? 'Anime Karakteri'
                            : person.person_type === 'seiyuu'
                              ? 'Seiyuu'
                              : 'Oyuncu'}
                        </div>
                        <div className="mt-2 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[9px] sm:text-[10px] font-mono text-white/80">
                          <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                          <span>{person.favorites_count || 0}</span>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* =====================================================================
            8. CANLI ASYAMAG MAGAZİN & DEDİKODU VİTRİNİ (In-Site Reader)
        ===================================================================== */}
        {magPosts.length > 0 && (
          <section className="w-full px-4 sm:px-6 md:px-14 cv-auto max-w-full">
            <div className="flex flex-col gap-1 mb-4 sm:mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-semibold tracking-[0.2em] uppercase text-white/50">
                  <Newspaper className="w-3.5 h-3.5 text-white/60" />
                  <span>Magazin & Gündem</span>
                </div>
                <Link
                  href="/magazin"
                  prefetch={true}
                  className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <span>Tüm Haberler</span>
                  <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Link>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-white tracking-tight mt-0.5">
                Son Dakika
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {magPosts.slice(0, 4).map((post) => (
                <Link
                  key={post.slug}
                  href={`/magazin/${post.slug}`}
                  prefetch={true}
                  className="koup-projection-card rounded-2xl overflow-hidden flex flex-col justify-between group"
                >
                  <div className="relative h-40 sm:h-44 overflow-hidden">
                    <img
                      src={getProxiedImageUrl(post.featured_image, post.title)}
                      alt={post.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f11] via-black/25 to-transparent" />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur-md border ${
                          post.source_site === 'KoreZin' || post.slug.startsWith('kz-') || post.source_url?.includes('korezin.com')
                            ? 'bg-rose-600/85 text-white border-rose-400/40'
                            : 'bg-sky-600/85 text-white border-sky-400/40'
                        }`}
                      >
                        {post.source_site === 'KoreZin' || post.slug.startsWith('kz-') || post.source_url?.includes('korezin.com') ? 'KoreZin' : 'AsyaMag'}
                      </span>
                      {(post.categories || ['Magazin']).slice(0, 1).map((c) => (
                        <span
                          key={c}
                          className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-black/75 backdrop-blur-md text-white border border-white/15"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">
                        {post.title}
                      </h3>
                      <p className="text-xs text-white/55 line-clamp-2 mt-2 leading-relaxed">
                        {post.excerpt}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/45">
                      <span>
                        {new Date(post.published_at).toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                      <span className="text-white/80 font-semibold">
                        İçeride Oku →
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function AccordionRow({
  subtitle,
  title,
  href,
  items,
  onConfigureTaste,
}: {
  subtitle?: string;
  title: string;
  href: string;
  items: MediaItem[];
  onConfigureTaste?: () => void;
}) {
  const scrollRef = useDragScroll<HTMLDivElement>();

  if (!items || items.length === 0) return null;

  return (
    <section className="w-full px-4 sm:px-6 md:px-14 cv-auto max-w-full">
      <div className="flex flex-col gap-1 mb-4 sm:mb-5">
        <div className="flex items-center justify-between min-h-[22px]">
          {subtitle ? (
            <span
              className={`text-[10px] sm:text-[11px] font-bold tracking-[0.2em] uppercase ${
                onConfigureTaste ? 'text-sky-400 flex items-center gap-1.5' : 'text-white/40'
              }`}
            >
              {onConfigureTaste && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">{subtitle}</span>
            </span>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto shrink-0">
            {onConfigureTaste && (
              <button
                type="button"
                onClick={onConfigureTaste}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full glass-pill text-[11px] font-semibold text-sky-300 hover:text-white border border-sky-400/25 transition-colors cursor-pointer mr-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Zevk Ayarları</span>
              </button>
            )}
            <button
              onClick={() =>
                scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })
              }
              aria-label="Sola Kaydır"
              className="hidden sm:flex w-8 h-8 rounded-full glass-pill items-center justify-center text-white/70 hover:text-white cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() =>
                scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })
              }
              aria-label="Sağa Kaydır"
              className="hidden sm:flex w-8 h-8 rounded-full glass-pill items-center justify-center text-white/70 hover:text-white cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <Link
              href={href}
              prefetch={true}
              className="text-xs font-semibold text-white/55 hover:text-white flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <span>Tümünü Gör</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white mt-0.5">
          {title}
        </h2>
      </div>

      <div
        ref={scrollRef}
        onMouseEnter={() => {
          preloadMediaImages(items);
        }}
        onMouseLeave={() => requestAccordionHover(null)}
        className="flex items-center gap-3 sm:gap-4 overflow-x-auto min-h-[300px] sm:min-h-[330px] py-2 sm:py-3 no-scrollbar [-webkit-overflow-scrolling:touch] max-w-full"
      >
        {items.map((item, idx) => (
          <AccordionMediaCard key={item.id} item={item} priority={idx < 4} />
        ))}
      </div>
    </section>
  );
}
