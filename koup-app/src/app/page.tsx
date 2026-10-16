'use client';

import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  MagazinePost,
  getProxiedImageUrl,
  formatContentTypeTR,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import { cachedQuery, getCache } from '@/lib/cache';

interface HomeDataBundle {
  feats: MediaItem[];
  kds: MediaItem[];
  cds: MediaItem[];
  ans: MediaItem[];
  gls: MediaItem[];
  episodes: any[];
  people: PersonItem[];
  magPosts: MagazinePost[];
  recentEpsProcessed?: any[];
}

// Module-level cache so navigating back to home in the same session is 0ms instant
let memoryHomeBundle: HomeDataBundle | null = null;

type QuickFilter = 'ALL' | 'KR' | 'CN' | 'ANIME' | 'GLOBAL';

const QUICK_FILTERS: Array<{
  id: QuickFilter;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'ALL', label: 'Tümü', sub: '17.509 Yapım', icon: Layers },
  { id: 'KR', label: 'K-Drama', sub: 'Güney Kore', icon: Tv },
  { id: 'CN', label: 'C-Drama & Wuxia', sub: 'Çin', icon: Sparkles },
  { id: 'ANIME', label: 'Anime', sub: 'AniList', icon: Flame },
  { id: 'GLOBAL', label: 'Global & Batı', sub: 'IMDb & DiziBox', icon: Globe },
];

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
  const { progressMap, updateWatchStatus, togglePersonFavorite, personFavorites, triggerSound } =
    useKoUp();

  // Instant render from module memory or synchronous cache
  const initialBundle =
    memoryHomeBundle ||
    (typeof window !== 'undefined' ? getCache<HomeDataBundle>('home_catalog_bundle') : null);

  const [heroItems, setHeroItems] = useState<MediaItem[]>(() =>
    initialBundle
      ? initialBundle.feats.length > 0
        ? initialBundle.feats.slice(0, 6)
        : initialBundle.kds.slice(0, 6)
      : []
  );
  const [heroIdx, setHeroIdx] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);

  const [top10Items, setTop10Items] = useState<MediaItem[]>(() =>
    initialBundle
      ? [
          ...initialBundle.kds.slice(0, 4),
          ...initialBundle.ans.slice(0, 4),
          ...initialBundle.cds.slice(0, 2),
        ]
      : []
  );
  const [kdramaItems, setKdramaItems] = useState<MediaItem[]>(() => initialBundle?.kds || []);
  const [cdramaItems, setCdramaItems] = useState<MediaItem[]>(() => initialBundle?.cds || []);
  const [animeItems, setAnimeItems] = useState<MediaItem[]>(() => initialBundle?.ans || []);
  const [globalItems, setGlobalItems] = useState<MediaItem[]>(() => initialBundle?.gls || []);
  const [recentEpisodes, setRecentEpisodes] = useState<any[]>(
    () => initialBundle?.recentEpsProcessed || []
  );
  const [topPeople, setTopPeople] = useState<PersonItem[]>(() => initialBundle?.people || []);
  const [magPosts, setMagPosts] = useState<MagazinePost[]>(() => initialBundle?.magPosts || []);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('ALL');
  const [filteredRail, setFilteredRail] = useState<MediaItem[]>(() =>
    initialBundle
      ? [
          ...initialBundle.kds.slice(0, 5),
          ...initialBundle.ans.slice(0, 5),
          ...initialBundle.cds.slice(0, 4),
        ]
      : []
  );

  const top10ScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchHomeData() {
      const homeData = await cachedQuery('home_catalog_bundle', 300_000, async () => {
        const [
          featRes,
          kdRes,
          cdRes,
          anRes,
          glRes,
          epRes,
          peopRes,
          magRes,
        ] = await Promise.all([
          supabase
            .from('media')
            .select('*')
            .not('backdrop_image', 'is', null)
            .order('mdl_rating', { ascending: false, nullsFirst: false })
            .order('imdb_rating', { ascending: false, nullsFirst: false })
            .limit(12),
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
        ]);

        return {
          feats: (featRes.data as MediaItem[]) || [],
          kds: (kdRes.data as MediaItem[]) || [],
          cds: (cdRes.data as MediaItem[]) || [],
          ans: (anRes.data as MediaItem[]) || [],
          gls: (glRes.data as MediaItem[]) || [],
          episodes: epRes.data || [],
          people: (peopRes.data as PersonItem[]) || [],
          magPosts: (magRes.data as MagazinePost[]) || [],
        };
      });

      const { feats, kds, cds, ans, gls, episodes, people, magPosts: initialMagPosts } = homeData;

      setHeroItems(feats.length > 0 ? feats.slice(0, 6) : kds.slice(0, 6));
      setTop10Items([...kds.slice(0, 4), ...ans.slice(0, 4), ...cds.slice(0, 2)]);
      setKdramaItems(kds);
      setCdramaItems(cds);
      setAnimeItems(ans);
      setGlobalItems(gls);
      setFilteredRail([...kds.slice(0, 5), ...ans.slice(0, 5), ...cds.slice(0, 4)]);
      setTopPeople(people);
      setMagPosts(initialMagPosts);

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

  // Auto-advance hero every 8 seconds unless hovered
  useEffect(() => {
    if (isHeroPaused || heroItems.length <= 1) return;
    const t = setInterval(() => {
      setHeroIdx((prev) => (prev + 1) % heroItems.length);
    }, 8000);
    return () => clearInterval(t);
  }, [isHeroPaused, heroItems.length]);

  // Quick filter rail update
  useEffect(() => {
    if (quickFilter === 'ALL') {
      setFilteredRail([
        ...kdramaItems.slice(0, 5),
        ...animeItems.slice(0, 5),
        ...cdramaItems.slice(0, 4),
      ]);
    } else if (quickFilter === 'KR') {
      setFilteredRail(kdramaItems);
    } else if (quickFilter === 'CN') {
      setFilteredRail(cdramaItems);
    } else if (quickFilter === 'ANIME') {
      setFilteredRail(animeItems);
    } else if (quickFilter === 'GLOBAL') {
      setFilteredRail(globalItems);
    }
  }, [quickFilter, kdramaItems, cdramaItems, animeItems, globalItems]);

  const activeHero = heroItems[heroIdx] || heroItems[0];
  const continueWatchingIds = Object.values(progressMap)
    .filter((p) => p.status === 'watching')
    .map((p) => p.media_id);

  const continueWatchingItems = [
    ...kdramaItems,
    ...animeItems,
    ...cdramaItems,
    ...heroItems,
  ]
    .filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx)
    .filter((item) => continueWatchingIds.includes(item.id))
    .slice(0, 4);

  const featuretteItems = (heroItems.length >= 4 ? heroItems : kdramaItems).slice(0, 4);

  return (
    <div className="min-h-screen pb-28 bg-[#080808]">
      {/* =====================================================================
          1. HERO SECTION: Full-Viewport Cinematic Immersion Banner (ui/code.html)
      ===================================================================== */}
      <section
        onMouseEnter={() => setIsHeroPaused(true)}
        onMouseLeave={() => setIsHeroPaused(false)}
        className="relative w-full h-[94vh] min-h-[680px] max-h-[1040px] flex items-end overflow-hidden"
      >
        {activeHero ? (
          <>
            {/* Crossfading Widescreen Backdrop */}
            <div className="absolute inset-0 w-full h-full">
              <AnimatePresence mode="sync">
                <motion.img
                  key={activeHero.id}
                  initial={{ opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
                  src={getProxiedImageUrl(
                    activeHero.backdrop_image || activeHero.cover_image,
                    activeHero.title
                  )}
                  alt={activeHero.title}
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover object-center"
                />
              </AnimatePresence>
              <div className="absolute inset-0 cinema-vignette" />
            </div>

            {/* Hero Main Typographic Overlay */}
            <div className="relative z-20 w-full px-6 md:px-14 pb-16 flex flex-col lg:flex-row lg:items-end justify-between gap-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeHero.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                  className="max-w-2xl flex flex-col gap-4"
                >
                  {/* Genuine Metadata */}
                  <div className="flex items-center flex-wrap gap-2.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-white/75">
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
                        <span className="text-amber-300 font-bold tracking-normal text-[12px]">
                          MDL {activeHero.mdl_rating}
                        </span>
                      </>
                    )}
                    {activeHero.imdb_rating && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="text-[#f5c518] font-bold tracking-normal text-[12px]">
                          IMDb {activeHero.imdb_rating}
                        </span>
                      </>
                    )}
                    {activeHero.anilist_rating && (
                      <>
                        <span className="text-white/35">•</span>
                        <span className="text-sky-300 font-bold tracking-normal text-[12px]">
                          AniList {activeHero.anilist_rating}%
                        </span>
                      </>
                    )}
                  </div>

                  {/* Pure White Display Title */}
                  <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-white tracking-[-0.04em] leading-[1.05] drop-shadow-[0_12px_32px_rgba(0,0,0,0.9)]">
                    {activeHero.title}
                  </h1>

                  <p className="text-sm sm:text-[15px] md:text-[16px] text-white/75 font-normal leading-relaxed max-w-xl line-clamp-3 drop-shadow-md">
                    {activeHero.overview ||
                      'KoUp 1080p sinema kalitesinde, tüm alternatif kaynaklar ve Türkçe altyazı seçenekleriyle hemen izlemeye başlayın.'}
                  </p>

                  {/* Sleek Pill Actions (Exact ui/code.html) */}
                  <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5 pt-2 w-full">
                    <Link
                      href={`/seri/${activeHero.slug}?play=1`}
                      prefetch={true}
                      onClick={() => triggerSound('click')}
                      className="w-full sm:w-auto justify-center flex items-center gap-2.5 px-8 py-3.5 rounded-full bg-white text-black font-bold text-[14px] hover:bg-white/90 active:scale-[0.98] transition-all duration-200 transform-gpu backface-hidden shadow-[0_4px_24px_rgba(255,255,255,0.25)] cursor-pointer"
                    >
                      <Play className="w-5 h-5 fill-black" />
                      <span>Hemen İzle</span>
                    </Link>

                    <button
                      onClick={() =>
                        updateWatchStatus(activeHero.id, 'watching', 1, 1)
                      }
                      className="flex-1 sm:flex-initial justify-center flex items-center gap-2 px-6 py-3.5 rounded-full glass-pill hover:bg-white/15 text-white font-semibold text-[14px] active:scale-[0.98] transition-all duration-200 transform-gpu backface-hidden cursor-pointer"
                    >
                      {progressMap[activeHero.id] ? (
                        <>
                          <Check className="w-4 h-4 text-sky-400" />
                          <span>Listemde</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 text-white/85" />
                          <span>Listeme Ekle</span>
                        </>
                      )}
                    </button>

                    <Link
                      href={`/seri/${activeHero.slug}`}
                      prefetch={true}
                      aria-label="Detaylar"
                      className="w-12 h-12 shrink-0 rounded-full glass-pill hover:bg-white/15 flex items-center justify-center text-white/80 hover:text-white transition-all duration-300"
                    >
                      <Info className="w-5 h-5" />
                    </Link>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Floating Interactive Preview Rail (Bottom Right — Exact ui/code.html) */}
              <div className="relative flex flex-col items-start lg:items-end gap-3 z-20 w-full lg:w-auto">
                <span className="text-[10px] tracking-[0.2em] font-semibold uppercase text-white/45">
                  Sıradaki Vitrin Seçkisi
                </span>
                <div className="flex items-center gap-2.5 glass-pill-dark p-2 rounded-2xl shadow-[0_20px_45px_rgba(0,0,0,0.85)] overflow-x-auto max-w-full no-scrollbar scroll-smooth [-webkit-overflow-scrolling:touch]">
                  {heroItems.slice(0, 4).map((hItem, idx) => {
                    const active = idx === heroIdx;
                    return (
                      <button
                        key={hItem.id}
                        onClick={() => {
                          triggerSound('click');
                          setHeroIdx(idx);
                        }}
                        className={`relative flex items-center gap-3 p-1.5 pr-4 rounded-xl cursor-pointer transition-all duration-300 text-left shrink-0 ${
                          active
                            ? 'bg-white/12 border border-white/25 opacity-100'
                            : 'hover:bg-white/[0.06] border border-transparent opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={getProxiedImageUrl(
                            hItem.backdrop_image || hItem.cover_image,
                            hItem.title
                          )}
                          alt={hItem.title}
                          loading="lazy"
                          fetchPriority="low"
                          className="w-16 h-10 rounded-lg object-cover shrink-0 shadow-md"
                        />
                        <div className="flex flex-col max-w-[130px]">
                          <span className="text-[12px] font-semibold text-white truncate">
                            {hItem.title}
                          </span>
                          <span className="text-[10px] text-white/50 tracking-wider truncate">
                            {formatContentTypeTR(hItem.content_type, hItem.country_code || hItem.country)}
                          </span>
                        </div>
                        {active && (
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping ml-1" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </div>
        )}
      </section>

      <div className="w-full space-y-16 pt-12">
        {/* =====================================================================
            2. 21:9 ULTRA-WIDE CINEMA CARDS ("Kaldığın Yerden Devam Et" — Exact ui/code.html)
               Fixes Screenshot 4: Clean dark card + razor-thin 2px pure white glowing progress bar!
        ===================================================================== */}
        {continueWatchingItems.length > 0 && (
          <section className="w-full px-6 md:px-14">
            <div className="flex items-end justify-between mb-6">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                  Kişisel Arşiv
                </span>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-1">
                  Kaldığın Yerden Devam Et
                </h2>
              </div>
              <Link
                href="/profil"
                prefetch={true}
                className="text-[12px] tracking-wider uppercase font-semibold text-white/50 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <span>Tümünü Gör</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="flex md:grid md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-x-auto md:overflow-visible pb-3 md:pb-0 no-scrollbar snap-x snap-mandatory [-webkit-overflow-scrolling:touch]">
              {continueWatchingItems.map((item) => {
                const prog = progressMap[item.id];
                const pct = Math.min(
                  Math.max(
                    Math.round(
                      ((prog?.position_seconds || 920) /
                        (prog?.duration_seconds || 2700)) *
                        100
                    ),
                    15
                  ),
                  92
                );
                const minsLeft = Math.max(
                  5,
                  Math.round(
                    ((prog?.duration_seconds || 2700) -
                      (prog?.position_seconds || 920)) /
                      60
                  )
                );

                return (
                  <Link
                    key={item.id}
                    href={`/seri/${item.slug}?play=1&ep=${prog?.current_episode || 1}`}
                    prefetch={true}
                    className="w-[82vw] max-w-[320px] shrink-0 md:w-auto snap-start group relative rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/[0.08] hover:border-white/25 transition-all duration-500 shadow-xl cursor-pointer block"
                  >
                    <div className="relative w-full aspect-[21/9] overflow-hidden">
                      <img
                        src={getProxiedImageUrl(
                          item.backdrop_image || item.cover_image,
                          item.title
                        )}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f11] via-black/30 to-transparent" />

                      {/* Razor Minimal Pure White Progress Line (Exact ui/code.html) */}
                      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/15">
                        <div
                          className="h-full bg-white shadow-[0_0_8px_white] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="p-4 flex items-center justify-between">
                      <div className="flex flex-col min-w-0 pr-3">
                        <span className="text-white font-semibold text-[14px] truncate">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-white/50 tracking-wide mt-0.5">
                          S{prog?.current_season || 1} • B{prog?.current_episode || 1}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-white/40 shrink-0">
                        {minsLeft} dk kaldı
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* =====================================================================
            3. SIGNATURE APPLE TV+ BILLBOARD FEATURETTES (Exact ui/code.html Section 2)
        ===================================================================== */}
        {featuretteItems.length > 0 && (
          <section className="w-full px-6 md:px-14 cv-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                  Ödüllü Sinema Portfolyosu
                </span>
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white mt-1">
                  KoUp Orijinal Başyapıtlar
                </h2>
              </div>
              <p className="text-white/50 text-[14px] max-w-md font-light leading-relaxed">
                MyDramaList, AniList ve küresel festivallerde en yüksek puanı almış seçkin yapımlar.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {featuretteItems.map((item, idx) => (
                <Link
                  key={item.id}
                  href={`/seri/${item.slug}`}
                  prefetch={true}
                  className="group relative rounded-3xl overflow-hidden bg-[#0f0f11] h-[440px] flex flex-col justify-between p-7 border border-white/10 hover:border-white/30 transition-all duration-500 shadow-2xl cursor-pointer"
                >
                  <img
                    src={getProxiedImageUrl(
                      item.cover_image || item.backdrop_image,
                      item.title
                    )}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-black/60 to-black/30" />

                  {/* Top Award Badge */}
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-pill border border-amber-300/30 text-amber-200">
                      <Award className="w-3.5 h-3.5 text-amber-300" />
                      <span className="text-[10px] tracking-[0.14em] uppercase font-bold">
                        {AWARD_BADGES[idx % AWARD_BADGES.length]}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-white/60">
                      {item.episode_count > 0 ? `${item.episode_count} Bölüm` : item.release_year}
                    </span>
                  </div>

                  {/* Bottom Meta & Sleek Controls */}
                  <div className="relative z-10 flex flex-col gap-2">
                    <h3 className="text-2xl font-bold text-white tracking-tight leading-tight line-clamp-1">
                      {item.title}
                    </h3>
                    <p className="text-white/70 text-[13px] line-clamp-2 font-normal leading-relaxed">
                      {item.overview ||
                        'Unutulmaz karakterler ve sürükleyici atmosferiyle sezonun en çok konuşulan yapımı.'}
                    </p>
                    <div className="pt-2.5 flex items-center justify-between border-t border-white/10 mt-1">
                      <span className="text-[11px] text-white/60 tracking-wider font-medium truncate pr-2">
                        {(item.categories || ['Dram', 'Romantik']).slice(0, 2).join(' • ')}
                      </span>
                      <div className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-xl group-hover:scale-105 shrink-0">
                        <Play className="w-4 h-4 fill-black ml-0.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* =====================================================================
            4. TOP 10 WITH INTEGRATED STROKE OUTLINE NUMERALS (Exact ui/code.html Section 3)
        ===================================================================== */}
        <section className="w-full px-6 md:px-14 cv-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                Trendler
              </span>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-1">
                Bugün Türkiye&apos;de En Popüler 10 İçerik
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  top10ScrollRef.current?.scrollBy({ left: -520, behavior: 'smooth' })
                }
                aria-label="Geri"
                className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() =>
                  top10ScrollRef.current?.scrollBy({ left: 520, behavior: 'smooth' })
                }
                aria-label="İleri"
                className="w-10 h-10 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            ref={top10ScrollRef}
            className="flex items-stretch gap-6 sm:gap-10 overflow-x-auto pb-6 pt-4 no-scrollbar snap-x snap-mandatory [-webkit-overflow-scrolling:touch]"
          >
            {top10Items.map((item, idx) => (
              <Link
                key={item.id}
                href={`/seri/${item.slug}`}
                prefetch={true}
                className="shrink-0 flex items-end group cursor-pointer snap-start relative pl-3 sm:pl-4 md:pl-6"
              >
                {/* Netflix/Apple TV+ Top 10 Stroke Numeral */}
                <span className="text-[96px] sm:text-[125px] md:text-[145px] font-black leading-[0.78] tracking-tighter text-stroke-numeral select-none pointer-events-none drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)] -translate-x-3 sm:-translate-x-4 md:-translate-x-6 -mr-5 sm:-mr-6 md:-mr-8 z-0">
                  {idx + 1}
                </span>

                <div className="relative z-10 w-36 sm:w-44 md:w-52 min-w-[144px] aspect-[2/3] rounded-2xl overflow-hidden bg-[#0f0f11] border border-white/10 group-hover:border-white/30 shadow-[0_20px_45px_rgba(0,0,0,0.85)] group-hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-end p-3.5 sm:p-4">
                  <img
                    src={getProxiedImageUrl(item.cover_image, item.title)}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-black/40 to-transparent" />
                  <div className="relative z-10 flex flex-col">
                    <span className="text-[14px] sm:text-[15px] font-bold text-white truncate">
                      {item.title}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* =====================================================================
            5. INTERACTIVE QUICK FILTER BAR WITH FLUID SPRING PILL + ACCORDION ROW
        ===================================================================== */}
        <section className="w-full px-6 md:px-14 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                Akordiyon Sahne Önizleme
              </span>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mt-1">
                Katalog Vitrini
              </h2>
            </div>

            {/* Spring-Animated Filter Pill Bar */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-full glass-pill-dark overflow-x-auto no-scrollbar">
              {QUICK_FILTERS.map((f) => {
                const Icon = f.icon;
                const active = quickFilter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => {
                      triggerSound('click');
                      setQuickFilter(f.id);
                    }}
                    className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                      active ? 'text-black' : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="home-quick-filter-pill"
                        transition={{
                          type: 'spring',
                          stiffness: 420,
                          damping: 32,
                        }}
                        className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                      />
                    )}
                    <Icon className="w-3.5 h-3.5 relative z-10" />
                    <span className="relative z-10">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3.5 sm:gap-4 overflow-x-auto pb-4 pt-1 no-scrollbar [-webkit-overflow-scrolling:touch]">
            {filteredRail.map((item, i) => (
              <AccordionMediaCard
                key={item.id}
                item={item}
                priority={i < 4}
              />
            ))}
          </div>
        </section>

        {/* =====================================================================
            6. K-DRAMA, ANIME & C-DRAMA ACCORDION ROWS
        ===================================================================== */}
        <AccordionRow
          subtitle="MyDramaList Yüksek Puanlı"
          title="Kore Dizileri (K-Drama)"
          href="/kesfet?country=KR"
          items={kdramaItems}
        />

        <AccordionRow
          subtitle="AniList Sezonun Zirvesi"
          title="Animeler (Tau-Video 1080p)"
          href="/kesfet?type=anime"
          items={animeItems}
        />

        <AccordionRow
          subtitle="Wuxia, Xianxia & Modern Romantik"
          title="Çin Dizileri (C-Drama)"
          href="/kesfet?country=CN"
          items={cdramaItems}
        />

        {/* =====================================================================
            7. OYUNCULAR, ANİME KARAKTERLERİ & SEİYUU LİDERLİK TABLOSU (No Emojis)
        ===================================================================== */}
        {topPeople.length > 0 && (
          <section className="w-full px-6 md:px-14 cv-auto">
            <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08]">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
                <div>
                  <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
                    Topluluk Favori Sıralaması
                  </span>
                  <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mt-1">
                    En Çok Favorilenen Oyuncular & Anime Karakterleri
                  </h2>
                </div>
                <Link
                  href="/oyuncular"
                  prefetch={true}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass-pill text-xs font-semibold text-white hover:bg-white/15 transition-all"
                >
                  <span>Tüm Sıralamayı Gör (21.814)</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {topPeople.slice(0, 12).map((person, idx) => {
                  const isFav = personFavorites.includes(person.id);
                  return (
                    <div
                      key={person.id}
                      className="koup-projection-card rounded-2xl p-3.5 flex flex-col items-center text-center group relative"
                    >
                      <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full bg-black/75 border border-white/15 text-[10px] font-mono font-bold text-white flex items-center justify-center">
                        #{idx + 1}
                      </span>

                      <button
                        onClick={() => togglePersonFavorite(person.id)}
                        title="Favorilere Ekle"
                        className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                          isFav
                            ? 'bg-rose-500 border-rose-300 text-white'
                            : 'bg-black/60 border-white/15 text-white/70 hover:text-white'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : ''}`} />
                      </button>

                      <Link href={`/oyuncu/${person.slug}`} prefetch={true} className="flex flex-col items-center">
                        <div className="w-20 h-20 rounded-full overflow-hidden border border-white/15 group-hover:border-white/40 transition-all mb-3">
                          <img
                            src={getProxiedImageUrl(person.image_url, person.name)}
                            alt={person.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        </div>
                        <div className="text-xs font-bold text-white line-clamp-1">
                          {person.name}
                        </div>
                        <div className="text-[10px] text-white/45 mt-0.5">
                          {person.person_type === 'character'
                            ? 'Anime Karakteri'
                            : person.person_type === 'seiyuu'
                              ? 'Seiyuu'
                              : 'Oyuncu'}
                        </div>
                        <div className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-mono text-white/80">
                          <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                          <span>{(person.favorites_count || 0) + (isFav ? 1 : 0)}</span>
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
          <section className="w-full px-6 md:px-14 cv-auto">
            <div className="flex items-end justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] uppercase text-white/50">
                  <Newspaper className="w-3.5 h-3.5 text-white/60" />
                  <span>Magazin & Gündem</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mt-1">
                  Son Dakika Magazin & Gündem
                </h2>
              </div>
              <Link
                href="/magazin"
                prefetch={true}
                className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Tüm Haberler</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {magPosts.slice(0, 4).map((post) => (
                <Link
                  key={post.slug}
                  href={`/magazin/${post.slug}`}
                  prefetch={true}
                  className="koup-projection-card rounded-2xl overflow-hidden flex flex-col justify-between group"
                >
                  <div className="relative h-44 overflow-hidden">
                    <img
                      src={getProxiedImageUrl(post.featured_image, post.title)}
                      alt={post.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f11] via-black/25 to-transparent" />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      {(post.categories || ['Magazin']).slice(0, 2).map((c) => (
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
}: {
  subtitle: string;
  title: string;
  href: string;
  items: MediaItem[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  return (
    <section className="w-full px-6 md:px-14 cv-auto">
      <div className="flex items-end justify-between mb-5">
        <div>
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-white/40">
            {subtitle}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              scrollRef.current?.scrollBy({ left: -560, behavior: 'smooth' })
            }
            aria-label="Sola Kaydır"
            className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() =>
              scrollRef.current?.scrollBy({ left: 560, behavior: 'smooth' })
            }
            aria-label="Sağa Kaydır"
            className="w-9 h-9 rounded-full glass-pill flex items-center justify-center text-white/70 hover:text-white cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <Link
            href={href}
            prefetch={true}
            className="text-xs font-semibold text-white/55 hover:text-white flex items-center gap-1 ml-2 transition-colors"
          >
            <span>Tümünü Gör</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex items-center gap-3.5 sm:gap-4 overflow-x-auto pb-4 pt-1 no-scrollbar [-webkit-overflow-scrolling:touch]"
      >
        {items.map((item) => (
          <AccordionMediaCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
