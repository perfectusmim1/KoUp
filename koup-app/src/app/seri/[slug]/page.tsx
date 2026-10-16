'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Heart,
  Bell,
  AlertTriangle,
  Calendar,
  ExternalLink,
  Flame,
  Droplets,
  Zap,
  Users,
  CheckCircle2,
  Star,
  Newspaper,
  Globe2,
  Mic,
  Clock,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  CastMember,
  MagazinePost,
  getProxiedImageUrl,
  COUNTRY_LABELS,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import NetflixPlayer from '@/components/NetflixPlayer';
import RichCommentSection from '@/components/RichCommentSection';
import AccordionMediaCard from '@/components/AccordionMediaCard';

const DAY_NAMES = [
  { id: 1, short: 'PZT', full: 'Pazartesi' },
  { id: 2, short: 'SAL', full: 'Salı' },
  { id: 3, short: 'ÇAR', full: 'Çarşamba' },
  { id: 4, short: 'PER', full: 'Perşembe' },
  { id: 5, short: 'CUM', full: 'Cuma' },
  { id: 6, short: 'CMT', full: 'Cumartesi' },
  { id: 7, short: 'PAZ', full: 'Pazar' },
];

export default function SeriesDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const searchParams = useSearchParams();

  const {
    progressMap,
    followedMediaIds,
    favPersonIds,
    setLibraryStatus,
    toggleMediaFavorite,
    toggleMediaFollow,
    toggleEpisodeWatched,
    togglePersonFavorite,
    pushNotification,
  } = useKoUp();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [relatedMedia, setRelatedMedia] = useState<MediaItem[]>([]);
  const [relatedMag, setRelatedMag] = useState<MagazinePost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [currentSeason, setCurrentSeason] = useState<number>(
    Number(searchParams.get('sezon')) || 1
  );
  const [currentEpisode, setCurrentEpisode] = useState<number>(
    Number(searchParams.get('bolum')) || 1
  );
  const [commentScope, setCommentScope] = useState<'episode' | 'media'>('episode');
  const [showSeriesReport, setShowSeriesReport] = useState(false);
  const [seriesReportCategory, setSeriesReportCategory] = useState(
    'Eksik Bölümler Var'
  );
  const [seriesReportNote, setSeriesReportNote] = useState('');

  const [reactionBumps, setReactionBumps] = useState<{
    fire: number;
    cry: number;
    shock: number;
  }>({ fire: 0, cry: 0, shock: 0 });

  useEffect(() => {
    async function loadSeries() {
      setIsLoading(true);
      const decodedSlug = decodeURIComponent(slug);

      let { data: mData } = await supabase
        .from('media')
        .select('*')
        .eq('slug', decodedSlug)
        .single();

      if (!mData && !Number.isNaN(Number(decodedSlug))) {
        const byId = await supabase
          .from('media')
          .select('*')
          .eq('id', Number(decodedSlug))
          .single();
        mData = byId.data;
      }

      if (!mData) {
        setIsLoading(false);
        return;
      }

      const item = mData as MediaItem;
      setMedia(item);

      supabase.rpc('increment_media_view', { p_media_id: item.id }).then(() => {});

      fetch(`/api/sources/${item.id}`)
        .then((r) => r.json())
        .then((payload) => {
          const eps: EpisodeData[] = payload.episodes || [];
          setEpisodes(eps);
          if (eps.length > 0 && !searchParams.get('bolum')) {
            const savedProg = progressMap[item.id];
            if (savedProg?.last_episode_num) {
              setCurrentSeason(savedProg.last_season_num || 1);
              setCurrentEpisode(savedProg.last_episode_num);
            } else {
              setCurrentSeason(eps[0].season_number || 1);
              setCurrentEpisode(eps[0].episode_number || 1);
            }
          }
        })
        .catch(() => {});

      const { data: castRows } = await supabase
        .from('media_cast')
        .select('*, people(*)')
        .eq('media_id', item.id)
        .order('billing_order', { ascending: true })
        .limit(24);
      setCast((castRows as CastMember[]) || []);

      const { data: relRows } = await supabase
        .from('media')
        .select('*')
        .eq('content_type', item.content_type)
        .neq('id', item.id)
        .order('views_count', { ascending: false })
        .limit(10);
      setRelatedMedia((relRows as MediaItem[]) || []);

      const { data: magRows } = await supabase
        .from('magazine_posts')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(3);
      setRelatedMag((magRows as MagazinePost[]) || []);

      setIsLoading(false);
    }

    loadSeries();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24">
        <div className="text-sm font-mono text-white/60 animate-pulse">
          Sinema Sahnesi ve Oynatıcı Kaynakları Hazırlanıyor...
        </div>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center pt-24 px-4 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Yapım Bulunamadı</h1>
        <p className="text-sm text-white/60 mb-6">
          Aradığınız dizi, film veya anime taşınmış olabilir.
        </p>
        <Link
          href="/kesfet"
          className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs"
        >
          Kataloğa Dön
        </Link>
      </div>
    );
  }

  const userProg = progressMap[media.id];
  const watchedSet = new Set(userProg?.watched_episodes || []);
  const isFavorited = Boolean(userProg?.is_favorite);
  const isFollowed = followedMediaIds.includes(media.id);

  const seasons = Array.from(
    new Set(episodes.map((e) => e.season_number || 1))
  ).sort((a, b) => a - b);

  const currentSeasonEpisodes = episodes.filter(
    (e) => (e.season_number || 1) === currentSeason
  );

  const activeEpObj =
    episodes.find(
      (e) =>
        e.season_number === currentSeason && e.episode_number === currentEpisode
    ) || episodes[0];

  const handleEpisodeReaction = async (type: 'fire' | 'cry' | 'shock') => {
    setReactionBumps((prev) => ({ ...prev, [type]: prev[type] + 1 }));
    await supabase.rpc('increment_episode_reaction', {
      p_media_id: media.id,
      p_season: currentSeason,
      p_episode: currentEpisode,
      p_reaction: type,
    });
    const labels = {
      fire: 'Efsane Bölümdü',
      cry: 'Duygusal / Ağlattı',
      shock: 'Şok / Ters Köşe',
    };
    pushNotification(
      'Bölüm Tepkin Kaydedildi',
      `${media.title} ${currentEpisode}. Bölüm için "${labels[type]}" oyu verdin.`,
      'success'
    );
  };

  const submitSeriesIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from('issue_reports').insert({
      target_type: 'media',
      media_id: media.id,
      issue_category: seriesReportCategory,
      details: seriesReportNote || `${media.title} seri metadata bildirimi`,
    });
    setShowSeriesReport(false);
    setSeriesReportNote('');
    pushNotification(
      'Seri Bildirimi Admin Paneline İletildi',
      'MDL / AniList / TMDB senkron motoru kontrol listesine eklendi.',
      'success'
    );
  };

  const airDays = media.air_days?.length ? media.air_days : [3, 4];
  const countryCode = (media.country || media.country_code || 'GL').toUpperCase();
  const countryLabel =
    COUNTRY_LABELS[countryCode] || media.country_name || countryCode;

  return (
    <div className="pb-24">
      {/* AMBIENT CINEMA BACKDROP BANNER */}
      <div className="relative w-full h-[52vh] min-h-[380px] max-h-[540px] overflow-hidden">
        <img
          src={getProxiedImageUrl(
            media.backdrop_image || media.cover_image,
            media.poster_fallback_url
          )}
          alt={media.title}
          fetchPriority="high"
          className="w-full h-full object-cover object-center scale-105 blur-[2px] brightness-75"
        />
        <div className="absolute inset-0 cinema-vignette" />
      </div>

      {/* MAIN CONTAINER */}
      <div className="max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 -mt-56 relative z-20 space-y-12">
        {/* 1. SERIES METADATA HEADER CARD */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/10 flex flex-col lg:flex-row gap-8 items-start"
        >
          {/* Left 2:3 Poster */}
          <div className="w-44 sm:w-56 shrink-0 mx-auto lg:mx-0">
            <div className="koup-projection-card rounded-2xl overflow-hidden border border-white/15 shadow-2xl aspect-[2/3]">
              <img
                src={getProxiedImageUrl(media.cover_image, media.poster_fallback_url)}
                alt={media.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Center/Right Metadata */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Badges Row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold bg-white/10 text-white border border-white/15">
                <Globe2 className="w-3.5 h-3.5 text-white/75" />
                <span>{countryLabel}</span>
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-mono uppercase bg-white/[0.06] text-white/85 border border-white/10">
                {media.content_type} · {media.release_year}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-400/25">
                Yayın Durumu: {media.status_broadcast || 'Final'}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-amber-500/15 text-amber-300 border border-amber-400/25">
                Çeviri Durumu: {media.status_translation || 'Tamamlandı'}
              </span>
            </div>

            {/* Title & Original Native Title */}
            <div>
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
                {media.title}
              </h1>
              {media.native_title && (
                <div className="text-sm sm:text-base text-white/55 mt-1">
                  Orijinal Adı: <span className="text-white/80">{media.native_title}</span>
                </div>
              )}
              {media.aka_titles && media.aka_titles.length > 0 && (
                <div className="text-xs text-white/45 mt-1 truncate">
                  Bilinen Diğer İsimler (AKA): {media.aka_titles.slice(0, 5).join(' · ')}
                </div>
              )}
            </div>

            {/* Distinct Multi-Source Rating Badges + External Links */}
            <div className="flex flex-wrap items-center gap-3 py-1">
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-white/10 border border-white/20">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="font-mono font-bold text-sm text-white">
                  {Number(media.site_rating || 8.7).toFixed(1)}
                </span>
                <span className="text-[11px] text-white/55">
                  ({media.site_rating_count || 120} oy)
                </span>
              </div>

              {media.mydramalist_url && (
                <a
                  href={media.mydramalist_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-[#E5A93C]/15 border border-[#E5A93C]/35 text-[#E5A93C] text-xs font-mono font-bold hover:bg-[#E5A93C]/25 transition-all"
                >
                  <span>MDL {Number(media.mdl_rating || 8.6).toFixed(1)}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {media.anilist_id && (
                <a
                  href={
                    media.anilist_url ||
                    `https://anilist.co/anime/${media.anilist_id}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-white/10 border border-white/20 text-white text-xs font-mono font-bold hover:bg-white/15 transition-all"
                >
                  <span>AniList {media.anilist_rating || 85}%</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              {media.imdb_id && (
                <a
                  href={`https://www.imdb.com/title/${media.imdb_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-2xl bg-[#F5C518]/15 border border-[#F5C518]/35 text-[#F5C518] text-xs font-mono font-bold hover:bg-[#F5C518]/25 transition-all"
                >
                  <span>IMDb {Number(media.imdb_rating || 8.3).toFixed(1)}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {/* Clean Synopsis */}
            <p className="text-sm sm:text-[15px] text-white/80 leading-relaxed">
              {media.overview}
            </p>

            {/* Genres & Tropes */}
            <div className="flex flex-wrap gap-1.5">
              {(media.categories || []).map((cat) => (
                <Link
                  key={cat}
                  href={`/kesfet?genre=${encodeURIComponent(cat)}`}
                  className="px-3 py-1 rounded-full text-xs bg-white/[0.06] hover:bg-white/15 text-white/85 border border-white/10 transition-all"
                >
                  {cat}
                </Link>
              ))}
            </div>

            {/* Library Status, Favorite, Follow & Report Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <select
                value={userProg?.status || ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setLibraryStatus(
                      media,
                      e.target.value as
                        | 'watching'
                        | 'completed'
                        | 'plan_to_watch'
                        | 'on_hold'
                        | 'dropped'
                    );
                  }
                }}
                className="px-4 py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer"
              >
                <option value="">+ Kütüphaneme Ekle</option>
                <option value="watching">İzliyorum</option>
                <option value="completed">Tamamladım</option>
                <option value="plan_to_watch">İzleyeceğim</option>
                <option value="on_hold">Beklemede</option>
                <option value="dropped">Bıraktım</option>
              </select>

              <button
                onClick={() => toggleMediaFavorite(media)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isFavorited
                    ? 'bg-pink-500/20 border-pink-400/50 text-pink-200'
                    : 'apple-glass-pill text-white hover:bg-white/15'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorited ? 'fill-pink-400 text-pink-400' : ''}`} />
                <span>{isFavorited ? 'Favorilerimde' : 'Favorile'}</span>
              </button>

              <button
                onClick={() => toggleMediaFollow(media)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isFollowed
                    ? 'bg-white text-black border-white'
                    : 'apple-glass-pill text-white hover:bg-white/15'
                }`}
              >
                <Bell className="w-4 h-4" />
                <span>{isFollowed ? 'Yeni Bölüm Bildirimi Açık' : 'Seriyi Takip Et'}</span>
              </button>

              <button
                onClick={() => setShowSeriesReport((v) => !v)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full apple-glass-pill text-amber-300 hover:bg-amber-400/15 text-xs font-medium cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Seri Sorun Bildir</span>
              </button>
            </div>

            {showSeriesReport && (
              <form
                onSubmit={submitSeriesIssue}
                className="mt-3 p-4 rounded-2xl bg-black/60 border border-amber-400/30 flex flex-col sm:flex-row gap-3"
              >
                <select
                  value={seriesReportCategory}
                  onChange={(e) => setSeriesReportCategory(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-black border border-white/15 text-xs text-white"
                >
                  <option>Eksik Bölümler Var</option>
                  <option>MDL / AniList / IMDb Eşleşmesi Yanlış</option>
                  <option>Oyuncu / Karakter Bilgisi Eksik</option>
                  <option>Kapak / Afiş Görseli Bozuk</option>
                  <option>Yayın Takvimi Günü Yanlış</option>
                </select>
                <input
                  type="text"
                  value={seriesReportNote}
                  onChange={(e) => setSeriesReportNote(e.target.value)}
                  placeholder="Detay yazın (opsiyonel)..."
                  className="flex-1 px-3 py-2 rounded-xl bg-black border border-white/15 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-full bg-amber-400 text-black font-bold text-xs cursor-pointer"
                >
                  Gönder
                </button>
              </form>
            )}
          </div>

          {/* Right: Broadcast Calendar Widget */}
          <div className="w-full lg:w-80 shrink-0 rounded-2xl bg-black/45 border border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Calendar className="w-4 h-4 text-white/75" />
                <span>Yayın & Çeviri Takvimi</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/80">
                TSİ {media.air_time || '21:00'}
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {DAY_NAMES.map((d) => {
                const isAirDay = airDays.includes(d.id);
                return (
                  <div
                    key={d.id}
                    className={`py-1.5 rounded-lg text-center text-[10px] font-mono font-bold border ${
                      isAirDay
                        ? 'bg-white text-black border-white shadow-[0_0_12px_rgba(255,255,255,0.25)]'
                        : 'bg-white/[0.03] border-white/[0.06] text-white/35'
                    }`}
                  >
                    {d.short}
                  </div>
                );
              })}
            </div>

            <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs space-y-1">
              <div className="flex items-center justify-between text-white/85 font-semibold">
                <span>Sıradaki / Son Bölüm:</span>
                <span className="font-mono text-amber-300">
                  {episodes.length || media.episode_count || 1}. Bölüm
                </span>
              </div>
              <div className="text-[11px] text-white/50 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>24 Saat Watchdog kaynak kontrolü aktif</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 2. EMBEDDED DUAL-LAYER KOUP NETFLIX PLAYER */}
        <section id="player-section">
          <NetflixPlayer
            media={media}
            episodes={episodes}
            currentSeason={currentSeason}
            currentEpisode={currentEpisode}
            onSelectEpisode={(s, e) => {
              setCurrentSeason(s);
              setCurrentEpisode(e);
            }}
            cast={cast}
          />
        </section>

        {/* 3. EPISODE END QUICK REACTION & EXCITEMENT GRAPH + SEASON/EPISODE GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Columns: Season Tabs & Episode Selector Grid */}
          <div className="lg:col-span-2 rounded-3xl apple-glass p-6 border border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Sezonlar & Bölümler ({episodes.length} Bölüm)
                </h2>
                <p className="text-xs text-white/50">
                  İzlediğiniz bölümler yeşil tik ile işaretlenir
                </p>
              </div>

              {seasons.length > 1 && (
                <div className="flex flex-wrap gap-1.5 p-1 rounded-full bg-white/[0.04] border border-white/[0.08]">
                  {seasons.map((s) => {
                    const active = currentSeason === s;
                    return (
                      <button
                        key={s}
                        onClick={() => setCurrentSeason(s)}
                        className={`relative px-3.5 py-1.5 rounded-full text-xs font-mono font-bold transition-colors cursor-pointer ${
                          active ? 'text-black' : 'text-white/75 hover:text-white'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="koup-season-tab-pill"
                            transition={{
                              type: 'spring',
                              stiffness: 420,
                              damping: 32,
                            }}
                            className="absolute inset-0 rounded-full bg-white"
                          />
                        )}
                        <span className="relative z-10">{s}. Sezon</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-96 overflow-y-auto pr-1">
              {currentSeasonEpisodes.map((ep) => {
                const isCurrent =
                  ep.season_number === currentSeason &&
                  ep.episode_number === currentEpisode;
                const isWatched = watchedSet.has(ep.episode_number);
                const isSched = ep.status === 'scheduled';
                return (
                  <div
                    key={`${ep.season_number}-${ep.episode_number}`}
                    className={`group rounded-2xl p-3 border transition-all flex items-center justify-between gap-2 ${
                      isCurrent
                        ? 'bg-white text-black border-white shadow-[0_0_24px_rgba(255,255,255,0.2)]'
                        : isSched
                        ? 'bg-amber-500/10 border-amber-400/30 text-amber-200'
                        : 'bg-white/[0.03] border-white/[0.07] text-white/80 hover:bg-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setCurrentSeason(ep.season_number);
                        setCurrentEpisode(ep.episode_number);
                      }}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="text-xs font-mono font-bold truncate">
                        {ep.episode_number}. Bölüm
                      </div>
                      <div
                        className={`text-[10px] truncate flex items-center gap-1 ${
                          isCurrent ? 'text-black/65' : 'text-white/50'
                        }`}
                      >
                        {isSched ? (
                          <>
                            <Clock className="w-2.5 h-2.5" />
                            <span>Geri Sayımda</span>
                          </>
                        ) : (
                          <span>{ep.sources?.length || 0} Kaynak</span>
                        )}
                      </div>
                    </button>

                    <button
                      onClick={() =>
                        toggleEpisodeWatched(media, ep.episode_number, false)
                      }
                      title="İzlendi İşaretle / Kaldır"
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isWatched
                          ? 'bg-emerald-500/25 text-emerald-500'
                          : isCurrent
                          ? 'bg-black/10 text-black/45 hover:text-black'
                          : 'bg-white/5 text-white/30 hover:text-white'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Episode Reaction Bar & Excitement Graph */}
          <div className="rounded-3xl apple-glass p-6 border border-white/10 flex flex-col justify-between space-y-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                Bölüm Sonu Nabzı · S{currentSeason} B{currentEpisode}
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Bu Bölümü Nasıl Buldun?
              </h3>
              <p className="text-xs text-white/55 mt-1">
                Tepkin bölüm heyecan grafiğini anında günceller
              </p>

              <div className="grid grid-cols-3 gap-2.5 mt-4">
                <button
                  onClick={() => handleEpisodeReaction('fire')}
                  className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 hover:border-white/30 flex flex-col items-center text-center transition-all cursor-pointer"
                >
                  <Flame className="w-5 h-5 text-amber-400" />
                  <div className="text-xs font-bold text-white mt-1.5">Efsane</div>
                  <div className="text-[11px] font-mono text-white/60 mt-0.5">
                    {(activeEpObj?.react_fire || 24) + reactionBumps.fire}
                  </div>
                </button>

                <button
                  onClick={() => handleEpisodeReaction('cry')}
                  className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 hover:border-white/30 flex flex-col items-center text-center transition-all cursor-pointer"
                >
                  <Droplets className="w-5 h-5 text-sky-300" />
                  <div className="text-xs font-bold text-white mt-1.5">Ağlattı</div>
                  <div className="text-[11px] font-mono text-white/60 mt-0.5">
                    {(activeEpObj?.react_cry || 11) + reactionBumps.cry}
                  </div>
                </button>

                <button
                  onClick={() => handleEpisodeReaction('shock')}
                  className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.1] border border-white/10 hover:border-white/30 flex flex-col items-center text-center transition-all cursor-pointer"
                >
                  <Zap className="w-5 h-5 text-pink-300" />
                  <div className="text-xs font-bold text-white mt-1.5">Şok</div>
                  <div className="text-[11px] font-mono text-white/60 mt-0.5">
                    {(activeEpObj?.react_shock || 16) + reactionBumps.shock}
                  </div>
                </button>
              </div>
            </div>

            {/* Mini Episode Excitement Sparkline Bar Chart (Clean Monochrome White Specular) */}
            <div className="pt-4 border-t border-white/10">
              <div className="text-[11px] font-mono text-white/55 mb-2 flex items-center justify-between">
                <span>Sezon Heyecan Grafiği</span>
                <span className="text-white/85">
                  Zirve: B{Math.min(episodes.length || 1, 8)}
                </span>
              </div>
              <div className="h-16 flex items-end gap-1.5">
                {currentSeasonEpisodes.slice(0, 12).map((ep) => {
                  const totalScore =
                    (ep.react_fire || 15) +
                    (ep.react_cry || 6) +
                    (ep.react_shock || 8);
                  const hPct = Math.min(100, Math.max(25, (totalScore % 75) + 25));
                  const active = ep.episode_number === currentEpisode;
                  return (
                    <div
                      key={ep.episode_number}
                      onClick={() => setCurrentEpisode(ep.episode_number)}
                      title={`${ep.episode_number}. Bölüm Heyecan: ${totalScore}`}
                      style={{ height: `${hPct}%` }}
                      className={`flex-1 rounded-t-md cursor-pointer transition-all ${
                        active
                          ? 'bg-white shadow-[0_0_8px_white]'
                          : 'bg-white/15 hover:bg-white/35'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 4. CAST, ACTORS, ANIME CHARACTERS & SEIYUU SECTION */}
        {cast.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
                  MDL & AniList İlişki Ağı · Favori & Yorum Desteği
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-white/75" />
                  <span>
                    {media.content_type === 'anime'
                      ? 'Anime Karakterleri & Seslendirmenler (Seiyuu)'
                      : 'Oyuncu Kadrosu & Karakterler'}
                  </span>
                </h2>
              </div>
              <Link
                href="/oyuncular"
                className="text-xs font-semibold text-white/70 hover:text-white transition-colors"
              >
                Tüm Oyuncular & Karakterler →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {cast.map((c) => {
                const p = c.people;
                if (!p) return null;
                const isFav = favPersonIds.includes(p.id);
                return (
                  <div
                    key={`${c.person_id}-${c.role_type}`}
                    className="koup-projection-card rounded-2xl p-3.5 bg-[#0f0f11] border border-white/[0.08] flex items-center justify-between gap-3"
                  >
                    <Link
                      href={`/oyuncu/${p.slug}`}
                      className="flex items-center gap-3 min-w-0 flex-1"
                    >
                      <img
                        src={getProxiedImageUrl(p.image_url)}
                        alt={p.name}
                        loading="lazy"
                        className="w-14 h-14 rounded-2xl object-cover border border-white/15 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate hover:text-white/80">
                          {p.name}
                        </div>
                        <div className="text-xs text-white/60 truncate">
                          {c.character_name || 'Başrol'}
                        </div>
                        {c.voice_actor_name && (
                          <div className="text-[11px] text-amber-300 truncate mt-0.5 flex items-center gap-1">
                            <Mic className="w-3 h-3 shrink-0" />
                            <span className="truncate">{c.voice_actor_name}</span>
                          </div>
                        )}
                      </div>
                    </Link>

                    <button
                      onClick={() => togglePersonFavorite(p.id, p.name)}
                      className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-1 cursor-pointer transition-all ${
                        isFav
                          ? 'bg-pink-500/20 border-pink-400/50 text-pink-200'
                          : 'bg-white/[0.04] border-white/10 text-white/65 hover:text-white'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-pink-400 text-pink-400' : ''}`} />
                      <span>{p.favorites_count + (isFav ? 1 : 0)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 5. RELATED ASYAMAG GOSSIP & NEWS */}
        {relatedMag.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-amber-300" />
                <span>İlgili AsyaMag Haberleri & Dedikodular</span>
              </h2>
              <Link href="/magazin" className="text-xs text-white/70 hover:text-white">
                Magazin Merkezine Git →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {relatedMag.map((post) => (
                <Link
                  key={post.id}
                  href={`/magazin/${post.slug}`}
                  className="p-4 rounded-2xl bg-[#0f0f11] border border-white/[0.08] hover:border-white/25 transition-all flex gap-3.5 items-center"
                >
                  <img
                    src={getProxiedImageUrl(post.featured_image)}
                    alt={post.title}
                    loading="lazy"
                    className="w-20 h-20 rounded-xl object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono text-amber-300">
                      {(post.categories || ['Magazin'])[0]}
                    </span>
                    <h4 className="text-xs font-bold text-white line-clamp-2 mt-0.5">
                      {post.title}
                    </h4>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 6. RELATED / FRANCHISE SERIES */}
        {relatedMedia.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-white mb-4">
              Benzer Yapımlar & Önerilenler
            </h2>
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
              {relatedMedia.map((item) => (
                <AccordionMediaCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* 7. DUAL-SCOPE RICH COMMENTS (EPISODE COMMENTS vs SERIES COMMENTS) */}
        <div>
          <div className="inline-flex items-center gap-1 p-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-2">
            {(
              [
                {
                  id: 'episode',
                  label: `S${currentSeason} B${currentEpisode} Bölüm Yorumları`,
                },
                { id: 'media', label: 'Seri Genel Yorumları' },
              ] as const
            ).map((tab) => {
              const active = commentScope === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCommentScope(tab.id)}
                  className={`relative px-4 py-2 rounded-full text-xs font-bold transition-colors cursor-pointer ${
                    active ? 'text-black' : 'text-white/75 hover:text-white'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="koup-comment-scope-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 420,
                        damping: 32,
                      }}
                      className="absolute inset-0 rounded-full bg-white"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <RichCommentSection
            targetType={commentScope}
            mediaId={media.id}
            seasonNumber={commentScope === 'episode' ? currentSeason : undefined}
            episodeNumber={commentScope === 'episode' ? currentEpisode : undefined}
            targetTitle={
              commentScope === 'episode'
                ? `${media.title} (${currentSeason}. Sezon ${currentEpisode}. Bölüm)`
                : media.title
            }
          />
        </div>
      </div>
    </div>
  );
}
