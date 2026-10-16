'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Play,
  Plus,
  Bell,
  ChevronLeft,
  ChevronRight,
  Flame,
  Sparkles,
  Calendar,
  Newspaper,
  Heart,
  ArrowRight,
  Clock,
  Check,
  Tv,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  MagazinePost,
  getProxiedImageUrl,
  COUNTRY_FLAGS,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';

export default function HomePage() {
  const {
    continueWatchingList,
    progressMap,
    followedMediaIds,
    favPersonIds,
    setLibraryStatus,
    toggleMediaFollow,
    togglePersonFavorite,
  } = useKoUp();

  const [heroItems, setHeroItems] = useState<MediaItem[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);

  const [top10Items, setTop10Items] = useState<MediaItem[]>([]);
  const [kdramaItems, setKdramaItems] = useState<MediaItem[]>([]);
  const [cdramaItems, setCdramaItems] = useState<MediaItem[]>([]);
  const [animeItems, setAnimeItems] = useState<MediaItem[]>([]);
  const [globalItems, setGlobalItems] = useState<MediaItem[]>([]);
  const [recentEpisodes, setRecentEpisodes] = useState<
    Array<{
      id: number;
      media_id: number;
      season_number: number;
      episode_number: number;
      episode_name: string;
      status: string;
      media?: MediaItem;
    }>
  >([]);
  const [topPeople, setTopPeople] = useState<PersonItem[]>([]);
  const [magPosts, setMagPosts] = useState<MagazinePost[]>([]);
  const [quickFilter, setQuickFilter] = useState<string>('ALL');
  const [filteredRail, setFilteredRail] = useState<MediaItem[]>([]);

  useEffect(() => {
    async function fetchHomeData() {
      const [
        featRes,
        kdRes,
        cdRes,
        anRes,
        glRes,
        peopRes,
        magRes,
        epRes,
      ] = await Promise.all([
        supabase
          .from('media')
          .select('*')
          .eq('is_featured', true)
          .order('featured_order', { ascending: true })
          .limit(10),
        supabase
          .from('media')
          .select('*')
          .eq('content_type', 'dizi')
          .eq('country_code', 'KR')
          .order('sources_count', { ascending: false })
          .limit(16),
        supabase
          .from('media')
          .select('*')
          .eq('content_type', 'dizi')
          .eq('country_code', 'CN')
          .order('sources_count', { ascending: false })
          .limit(16),
        supabase
          .from('media')
          .select('*')
          .eq('content_type', 'anime')
          .order('sources_count', { ascending: false })
          .limit(16),
        supabase
          .from('media')
          .select('*')
          .not('imdb_id', 'is', null)
          .order('sources_count', { ascending: false })
          .limit(16),
        supabase
          .from('people')
          .select('*')
          .order('favorites_count', { ascending: false })
          .limit(14),
        supabase
          .from('magazine_posts')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(6),
        supabase
          .from('episodes')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(12),
      ]);

      const feats = (featRes.data as MediaItem[]) || [];
      const kds = (kdRes.data as MediaItem[]) || [];
      const cds = (cdRes.data as MediaItem[]) || [];
      const ans = (anRes.data as MediaItem[]) || [];
      const gls = (glRes.data as MediaItem[]) || [];

      setHeroItems(feats.length > 0 ? feats.slice(0, 8) : kds.slice(0, 8));
      setTop10Items([...kds.slice(0, 4), ...ans.slice(0, 4), ...cds.slice(0, 2)]);
      setKdramaItems(kds);
      setCdramaItems(cds);
      setAnimeItems(ans);
      setGlobalItems(gls);
      setFilteredRail([...kds.slice(0, 5), ...ans.slice(0, 5), ...cds.slice(0, 4)]);
      setTopPeople((peopRes.data as PersonItem[]) || []);
      setMagPosts((magRes.data as MagazinePost[]) || []);
      fetch('/api/magazin/live?limit=8')
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j?.posts) && j.posts.length > 0) {
            setMagPosts(j.posts);
          }
        })
        .catch(() => {});

      if (epRes.data && epRes.data.length > 0) {
        const mIds = Array.from(new Set(epRes.data.map((e) => e.media_id)));
        const { data: mRows } = await supabase
          .from('media')
          .select('*')
          .in('id', mIds);
        const mMap = new Map(((mRows as MediaItem[]) || []).map((m) => [m.id, m]));
        setRecentEpisodes(
          epRes.data
            .map((e) => ({ ...e, media: mMap.get(e.media_id) }))
            .filter((e) => e.media)
        );
      }
    }
    fetchHomeData();
  }, []);

  // Auto-advance hero every 7.5 seconds unless paused
  useEffect(() => {
    if (isHeroPaused || heroItems.length <= 1) return;
    const t = setInterval(() => {
      setHeroIdx((prev) => (prev + 1) % heroItems.length);
    }, 7500);
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
  const nextThreeHeroes = heroItems.length > 1
    ? [
        heroItems[(heroIdx + 1) % heroItems.length],
        heroItems[(heroIdx + 2) % heroItems.length],
        heroItems[(heroIdx + 3) % heroItems.length],
      ].filter(Boolean)
    : [];

  return (
    <div className="pb-20">
      {/* 1. DEV "EN POPÜLER SERİLER" HERO SLIDER (78vh, APPLE TV+ + MUBI AESTHETIC) */}
      <section
        onMouseEnter={() => setIsHeroPaused(true)}
        onMouseLeave={() => setIsHeroPaused(false)}
        className="relative w-full h-[82vh] min-h-[600px] max-h-[920px] flex items-end overflow-hidden"
      >
        {activeHero ? (
          <>
            {/* Background Cinema Backdrop with LCP High Fetch Priority */}
            <div className="absolute inset-0 w-full h-full">
              <img
                key={activeHero.id}
                src={getProxiedImageUrl(
                  activeHero.backdrop_image || activeHero.cover_image,
                  activeHero.poster_fallback_url
                )}
                alt={activeHero.title}
                fetchPriority="high"
                className="w-full h-full object-cover object-center scale-105 transition-transform duration-1000 ease-out"
              />
              <div className="absolute inset-0 cinema-hero-vignette" />
            </div>

            {/* Foreground Content */}
            <div className="relative z-20 max-w-[1680px] mx-auto w-full px-6 sm:px-10 lg:px-14 pb-12 sm:pb-16 flex flex-col lg:flex-row items-start lg:items-end justify-between gap-8">
              {/* Left: Editorial Typography, Dual Ratings, Status & Actions */}
              <div className="max-w-2xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider bg-white/15 backdrop-blur-md text-white border border-white/20">
                    {COUNTRY_FLAGS[activeHero.country_code] || '🎬'}{' '}
                    {activeHero.country_name} · #{heroIdx + 1} Vitrin
                  </span>

                  {/* Site Rating */}
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-white text-black">
                    ★ {Number(activeHero.site_rating || 8.9).toFixed(1)}
                  </span>

                  {/* MDL Rating */}
                  {activeHero.mdl_rating && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#E5A93C]/20 text-[#E5A93C] border border-[#E5A93C]/40">
                      MDL {Number(activeHero.mdl_rating).toFixed(1)}
                    </span>
                  )}

                  {/* AniList Rating */}
                  {activeHero.anilist_rating && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40">
                      AniList {activeHero.anilist_rating}%
                    </span>
                  )}

                  {/* IMDb Rating */}
                  {activeHero.imdb_rating && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#F5C518]/20 text-[#F5C518] border border-[#F5C518]/40">
                      IMDb {Number(activeHero.imdb_rating).toFixed(1)}
                    </span>
                  )}

                  {/* Separate Broadcast & Translation Status Pills */}
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    Yayın: {activeHero.status_broadcast || 'Final'}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-sky-500/20 text-sky-300 border border-sky-400/30">
                    Çeviri: {activeHero.status_translation || 'Tamamlandı'}
                  </span>
                </div>

                <div>
                  <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.06]">
                    {activeHero.title}
                  </h1>
                  {activeHero.native_title && (
                    <div className="text-sm sm:text-base font-medium text-white/55 mt-1.5">
                      {activeHero.native_title} · {activeHero.release_year} ·{' '}
                      {activeHero.episodes_available || activeHero.episode_count} Bölüm
                    </div>
                  )}
                </div>

                <p className="text-sm sm:text-base text-white/80 line-clamp-2 sm:line-clamp-3 leading-relaxed max-w-xl">
                  {activeHero.overview}
                </p>

                {activeHero.categories && activeHero.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeHero.categories.slice(0, 5).map((cat) => (
                      <Link
                        key={cat}
                        href={`/kesfet?genre=${encodeURIComponent(cat)}`}
                        className="text-xs px-3 py-1 rounded-full bg-white/[0.08] hover:bg-white/15 text-white/85 border border-white/10 transition-all"
                      >
                        {cat}
                      </Link>
                    ))}
                  </div>
                )}

                {/* Action Cluster */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Link
                    href={`/seri/${activeHero.slug}`}
                    className="flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-white text-black font-bold text-sm shadow-[0_0_30px_rgba(255,255,255,0.35)] hover:scale-[1.03] active:scale-[0.98] transition-all"
                  >
                    <Play className="w-4 h-4 fill-black" />
                    <span>Hemen İzle</span>
                  </Link>

                  <button
                    onClick={() => setLibraryStatus(activeHero, 'plan_to_watch')}
                    className="flex items-center gap-2 px-5 py-3.5 rounded-full apple-glass-pill text-white text-sm font-semibold hover:bg-white/15 transition-all cursor-pointer"
                  >
                    {progressMap[activeHero.id] ? (
                      <>
                        <Check className="w-4 h-4 text-sky-400" />
                        <span>Listemde</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        <span>Listeme Ekle</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => toggleMediaFollow(activeHero)}
                    className={`flex items-center gap-2 px-4 py-3.5 rounded-full text-sm font-semibold border transition-all cursor-pointer ${
                      followedMediaIds.includes(activeHero.id)
                        ? 'bg-sky-400/20 border-sky-400 text-sky-300'
                        : 'apple-glass-pill text-white/85 hover:text-white'
                    }`}
                  >
                    <Bell className="w-4 h-4" />
                    <span>
                      {followedMediaIds.includes(activeHero.id)
                        ? 'Takip Ediliyor'
                        : 'Takip Et'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Right: 3-Item Frosted Glass Mini Scene Dock + Slider Arrows */}
              <div className="w-full lg:w-auto flex flex-col items-end gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-white/50 mr-2">
                    Sıradaki Vitrin ({heroIdx + 1}/{heroItems.length})
                  </span>
                  <button
                    onClick={() =>
                      setHeroIdx(
                        (prev) => (prev - 1 + heroItems.length) % heroItems.length
                      )
                    }
                    className="w-9 h-9 rounded-full apple-glass-pill flex items-center justify-center text-white hover:bg-white/20 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() =>
                      setHeroIdx((prev) => (prev + 1) % heroItems.length)
                    }
                    className="w-9 h-9 rounded-full apple-glass-pill flex items-center justify-center text-white hover:bg-white/20 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Frosted Glass Hero Dock */}
                <div className="hidden sm:flex items-center gap-2.5 p-2 rounded-3xl apple-glass border border-white/15">
                  {nextThreeHeroes.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        const targetIdx = heroItems.findIndex((h) => h.id === item.id);
                        if (targetIdx >= 0) setHeroIdx(targetIdx);
                      }}
                      className="flex items-center gap-2.5 p-2 rounded-2xl bg-white/[0.04] hover:bg-white/15 border border-white/[0.07] transition-all text-left w-52 cursor-pointer group"
                    >
                      <img
                        src={getProxiedImageUrl(
                          item.cover_image,
                          item.poster_fallback_url
                        )}
                        alt={item.title}
                        loading="lazy"
                        fetchPriority="low"
                        className="w-11 h-14 rounded-xl object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate group-hover:text-sky-300">
                          {item.title}
                        </div>
                        <div className="text-[10px] font-mono text-amber-300 mt-0.5">
                          ★ {item.site_rating} · {item.country_code}
                        </div>
                        <div className="text-[10px] text-white/45 truncate">
                          {item.episodes_available || item.episode_count} Bölüm
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-sm font-mono text-sky-400 animate-pulse">
              KoUp Sinema Vitrini Yükleniyor...
            </div>
          </div>
        )}
      </section>

      {/* MAIN CONTENT RAILS */}
      <div className="max-w-[1680px] mx-auto px-6 sm:px-10 lg:px-14 space-y-14 -mt-4 relative z-30">
        {/* 2. KALDIĞIN YERDEN DEVAM ET (CONTINUE WATCHING STRIP) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-sky-400">
                Kişisel Arşiv · Sıfır Kesinti
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                Kaldığın Yerden Devam Et
              </h2>
            </div>
            <Link
              href="/profil"
              className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1"
            >
              <span>Tüm İlerlemem</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(continueWatchingList.length > 0
              ? continueWatchingList.slice(0, 4)
              : kdramaItems.slice(0, 4).map((m, idx) => ({
                  media_id: m.id,
                  status: 'watching' as const,
                  is_favorite: false,
                  watched_episodes: [1, 2],
                  last_season_num: 1,
                  last_episode_num: idx + 2,
                  last_episode_title: `${idx + 2}. Bölüm`,
                  resume_position_sec: 1420 + idx * 300,
                  resume_duration_sec: 3600,
                  updated_at: new Date().toISOString(),
                  media: m,
                }))
            ).map((prog) => {
              const m = prog.media!;
              const pct = Math.min(
                96,
                Math.max(
                  12,
                  Math.round(
                    ((prog.resume_position_sec || 900) /
                      (prog.resume_duration_sec || 3600)) *
                      100
                  )
                )
              );
              const remMin = Math.max(
                5,
                Math.round(
                  ((prog.resume_duration_sec || 3600) -
                    (prog.resume_position_sec || 900)) /
                    60
                )
              );
              return (
                <Link
                  key={m.id}
                  href={`/seri/${m.slug}?sezon=${prog.last_season_num}&bolum=${prog.last_episode_num}`}
                  className="koup-projection-card group rounded-2xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col"
                >
                  <div className="relative aspect-video overflow-hidden">
                    <img
                      src={getProxiedImageUrl(
                        m.backdrop_image || m.cover_image,
                        m.poster_fallback_url
                      )}
                      alt={m.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-90 group-hover:scale-110 transition-transform">
                      <div className="w-12 h-12 rounded-full apple-glass flex items-center justify-center border border-white/25">
                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                    <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/70 text-sky-300 border border-sky-400/30">
                      S{prog.last_season_num} : B{prog.last_episode_num}
                    </span>
                    {/* Bottom Progress Bar */}
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full bg-gradient-to-r from-sky-400 to-amber-300"
                      />
                    </div>
                  </div>
                  <div className="p-3.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white truncate">
                        {m.title}
                      </h3>
                      <p className="text-xs text-white/50 truncate">
                        {prog.last_episode_title || `${prog.last_episode_num}. Bölüm`}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-white/55 shrink-0">
                      {remMin} dk kaldı
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* 3. CANLI SON YÜKLENEN BÖLÜMLER & YAKINDA TAKVİM ŞERİDİ */}
        {recentEpisodes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400">
                    Otomatik Bot & 24 Saat Watchdog Aktif
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white">
                    Son Yüklenen & Yakında Yayınlanacak Bölümler
                  </h2>
                </div>
              </div>
              <Link
                href="/takvim"
                className="text-xs font-semibold text-sky-400 hover:underline flex items-center gap-1"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Haftalık Yayın Takvimi</span>
              </Link>
            </div>

            <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar pb-2">
              {recentEpisodes.map((ep) => {
                const m = ep.media!;
                const isSched = ep.status === 'scheduled';
                return (
                  <Link
                    key={`${ep.media_id}-${ep.season_number}-${ep.episode_number}`}
                    href={`/seri/${m.slug}?sezon=${ep.season_number}&bolum=${ep.episode_number}`}
                    className="koup-projection-card shrink-0 w-64 rounded-2xl p-3 bg-[#121216] border border-white/[0.08] flex items-center gap-3"
                  >
                    <img
                      src={getProxiedImageUrl(m.cover_image, m.poster_fallback_url)}
                      alt={m.title}
                      loading="lazy"
                      className="w-14 h-20 rounded-xl object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={`inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded-full mb-1 ${
                          isSched
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                        }`}
                      >
                        {isSched
                          ? `⏳ Yakında · B${ep.episode_number}`
                          : `⚡ Yeni · S${ep.season_number} B${ep.episode_number}`}
                      </span>
                      <h4 className="text-xs font-bold text-white truncate">
                        {m.title}
                      </h4>
                      <p className="text-[11px] text-white/55 truncate mt-0.5">
                        {ep.episode_name}
                      </p>
                      <div className="text-[10px] font-mono text-white/40 mt-1">
                        {COUNTRY_FLAGS[m.country_code] || '🎬'} {m.country_name}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. BUGÜN TÜRKİYE'DE EN POPÜLER 10 İÇERİK (HORIZONTAL STRIP ACCORDION) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-300">
                Trendler · Haftalık İzlenme Liderleri
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                Bugün En Popüler 10 İçerik
              </h2>
            </div>
            <span className="hidden sm:inline text-xs text-white/45 font-mono">
              Kartların üzerine gelerek 16:9 sinema önizlemesini açın
            </span>
          </div>

          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {top10Items.slice(0, 10).map((item, idx) => (
              <AccordionMediaCard
                key={item.id}
                item={item}
                rankNumber={idx + 1}
                priority={idx < 3}
              />
            ))}
          </div>
        </section>

        {/* 5. HIZLI KEŞİF & ÜLKE / TÜR FİLTRE BARI */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-sky-400">
                Anlık Katalog Filtresi
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                Ülke & Evrene Göre Hızlı Keşfet
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'ALL', label: '✨ Tümü' },
                { id: 'KR', label: '🇰🇷 Güney Kore (K-Drama)' },
                { id: 'CN', label: '🇨🇳 Çin (C-Drama & Wuxia)' },
                { id: 'ANIME', label: '🇯🇵 Anime (AniList)' },
                { id: 'GLOBAL', label: '🇺🇸 Global & IMDb Seçkisi' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setQuickFilter(tab.id)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    quickFilter === tab.id
                      ? 'bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.35)]'
                      : 'apple-glass-pill text-white/75 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {filteredRail.map((item) => (
              <AccordionMediaCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        {/* 6. OYUNCULAR & ANİME KARAKTERLERİ VİTRİNİ (EN ÇOK FAVORİ ALANDAN AZA) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-pink-400">
                MDL & AniList Yıldızları · Favori Sıralaması
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                En Çok Favori Alan Oyuncular & Anime Karakterleri
              </h2>
            </div>
            <Link
              href="/oyuncular"
              className="text-xs font-semibold text-pink-300 hover:underline flex items-center gap-1"
            >
              <span>Tüm Sıralamayı Gör (21.814)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {topPeople.map((person, idx) => {
              const isFav = favPersonIds.includes(person.id);
              return (
                <div
                  key={person.id}
                  className="koup-projection-card shrink-0 w-44 rounded-2xl p-3.5 bg-[#121216] border border-white/[0.08] flex flex-col items-center text-center group"
                >
                  <div className="relative mb-3">
                    <Link href={`/oyuncu/${person.slug}`}>
                      <img
                        src={getProxiedImageUrl(person.image_url)}
                        alt={person.name}
                        loading="lazy"
                        className="w-24 h-24 rounded-full object-cover border-2 border-white/15 group-hover:border-sky-400 transition-all"
                      />
                    </Link>
                    <span className="absolute -top-1 -left-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/85 text-amber-300 border border-amber-400/30">
                      #{idx + 1}
                    </span>
                    <button
                      onClick={() => togglePersonFavorite(person.id, person.name)}
                      title="Favorilere Ekle"
                      className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                        isFav
                          ? 'bg-pink-500 border-pink-300 text-white'
                          : 'bg-black/85 border-white/20 text-pink-300 hover:scale-110'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-white' : ''}`} />
                    </button>
                  </div>

                  <Link
                    href={`/oyuncu/${person.slug}`}
                    className="text-xs font-bold text-white truncate w-full group-hover:text-sky-300"
                  >
                    {person.name}
                  </Link>
                  <span className="text-[10px] font-mono uppercase text-white/45 mt-0.5">
                    {person.person_type === 'character'
                      ? '🎌 Anime Karakteri'
                      : person.person_type === 'seiyuu'
                      ? '🎙️ Seiyuu'
                      : '🎬 Oyuncu'}
                  </span>
                  <div className="mt-2 px-2.5 py-0.5 rounded-full bg-pink-500/15 border border-pink-400/25 text-[11px] font-mono text-pink-300">
                    ❤️ {(person.favorites_count + (isFav ? 1 : 0)).toLocaleString('tr-TR')}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 7. ASYAMAG MAGAZİN & DEDİKODU VİTRİNİ (KOUP İÇİNDE TAM OKUMA) */}
        {magPosts.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-300">
                  AsyaMag Entegrasyonu · Kore & Çin Gündemi
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-amber-300" />
                  <span>Asya Magazin & Dedikodu Köşesi</span>
                </h2>
              </div>
              <Link
                href="/magazin"
                className="text-xs font-semibold text-amber-300 hover:underline flex items-center gap-1"
              >
                <span>Tüm Dedikodu & Haberler</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {magPosts.slice(0, 3).map((post) => (
                <Link
                  key={post.id}
                  href={`/magazin/${post.slug}`}
                  className="koup-projection-card rounded-3xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col group"
                >
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={getProxiedImageUrl(post.featured_image)}
                      alt={post.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-transparent to-black/30" />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                      {(post.categories || ['Magazin']).slice(0, 2).map((cat) => (
                        <span
                          key={cat}
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/20 backdrop-blur-md text-amber-300 border border-amber-400/35"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-2">
                        {post.title}
                      </h3>
                      <p className="text-xs text-white/60 mt-2 line-clamp-2 leading-relaxed">
                        {post.excerpt}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/45">
                      <span>
                        {new Date(post.published_at).toLocaleDateString('tr-TR')}
                      </span>
                      <span className="text-sky-400">KoUp İçinde Oku →</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 8. K-DRAMA, ANIME & IMDb SINEMA RAILS */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E5A93C]">
                MyDramaList Bağlantılı · DiziYou 1080p HLS
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                🇰🇷 Efsane Kore Dizileri (K-Drama)
              </h2>
            </div>
            <Link
              href="/kesfet?type=dizi&country=KR"
              className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1"
            >
              <span>Tümünü Gör</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {kdramaItems.map((item) => (
              <AccordionMediaCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#38BDF8]">
                AniList Çift Yönlü Köprü · Tau-Video 1080p
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                🇯🇵 En Çok İzlenen Animeler
              </h2>
            </div>
            <Link
              href="/kesfet?type=anime"
              className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1"
            >
              <span>Tümünü Gör (7.069)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {animeItems.map((item) => (
              <AccordionMediaCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#F5C518]">
                IMDb & TMDB Eşleşmeli · Sinema & Global Diziler
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                🍿 IMDb Yüksek Puanlı Dizi & Filmler
              </h2>
            </div>
            <Link
              href="/kesfet?type=film"
              className="text-xs font-semibold text-white/60 hover:text-white flex items-center gap-1"
            >
              <span>Tümünü Gör</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
            {globalItems.map((item) => (
              <AccordionMediaCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
