'use client';

import React, { useState, useEffect, use } from 'react';
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
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  CastMember,
  getProxiedImageUrl,
  COUNTRY_LABELS,
  getCountryFlag,
  formatContentTypeTR,
} from '@/lib/supabase';
import { cachedQuery } from '@/lib/cache';
import { useKoUp } from '@/context/KoUpContext';
import CountryFlag from '@/components/CountryFlag';
import RichCommentSection from '@/components/RichCommentSection';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CustomSelect from '@/components/CustomSelect';

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
    toggleMediaFavorite,
    toggleMediaFollow,
    toggleEpisodeWatched,
    pushNotification,
    openAuthModal,
    isSoftBanned,
  } = useKoUp();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [relatedMedia, setRelatedMedia] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState(1);

  const [showSeriesReport, setShowSeriesReport] = useState(false);
  const [seriesReportCategory, setSeriesReportCategory] = useState('Eksik Bölümler Var');
  const [seriesReportNote, setSeriesReportNote] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadSeries() {
      setIsLoading(true);
      const decodedSlug = decodeURIComponent(slug);

      try {
        // Cached media details + cast query (TTL: 300_000ms = 5 minutes)
        const mediaWithCast = await cachedQuery<{
          media: MediaItem | null;
          cast: CastMember[];
        }>(`media_${decodedSlug}`, 300_000, async () => {
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

        if (isCancelled) return;

        if (!mediaWithCast.media) {
          setIsLoading(false);
          return;
        }

        const item = mediaWithCast.media;
        setMedia(item);
        setCast(mediaWithCast.cast);

        // Non-blocking view increment
        supabase.rpc('increment_media_view', { p_media_id: item.id }).then(() => {});

        // Handle direct ?play=1 redirect
        if (searchParams.get('play')) {
          const epToPlay = searchParams.get('ep') || '1';
          router.replace(`/seri/${item.slug}/${epToPlay}`);
          return;
        }

        // Parallel cached fetches for episode list & related media
        const [epsList, relList] = await Promise.all([
          cachedQuery<EpisodeData[]>(`episodes_${item.id}`, 300_000, async () => {
            const res = await fetch(`/api/sources/${item.id}`);
            const payload = await res.json();
            return payload.episodes || [];
          }),
          cachedQuery<MediaItem[]>(
            `related_${item.content_type}_${item.id}`,
            300_000,
            async () => {
              const { data } = await supabase
                .from('media')
                .select('*')
                .eq('content_type', item.content_type)
                .neq('id', item.id)
                .order('views_total', { ascending: false })
                .limit(10);
              return (data as MediaItem[]) || [];
            }
          ),
        ]);

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
      document.title = `${media.title} İzle • KoUp Sinema`;
    }
  }, [media?.title]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 bg-[#080808]">
        <div className="text-sm font-mono text-emerald-400 animate-pulse flex items-center gap-2">
          <Film className="w-4 h-4 animate-spin text-emerald-400" />
          <span>Seri Bilgileri ve Bölüm Listesi Hazırlanıyor...</span>
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

  const userProg = progressMap[media.id];
  const isFavorited = Boolean(userProg?.is_favorite || userProg?.is_favorited);
  const isFollowed = followedMediaIds.includes(media.id);
  const resumeEp = userProg?.last_episode_num || 1;

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

  const backdropSrc = getProxiedImageUrl(
    media.backdrop_image || media.cover_image,
    media.title
  );
  const posterSrc = getProxiedImageUrl(media.cover_image, media.title);

  return (
    <div className="min-h-screen pb-32 bg-[#080808] text-white">
      {/* 1. CINEMATIC HERO BANNER */}
      <div className="relative w-full min-h-[520px] md:h-[65vh] md:min-h-[500px] md:max-h-[720px] flex items-end pt-24 md:pt-0">
        {/* Full Backdrop (Clipped) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={backdropSrc}
            alt={media.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#080808] via-transparent to-transparent opacity-80" />
        </div>

        {/* Hero Meta Info */}
        <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full pb-8 md:pb-10 flex flex-col md:flex-row items-center md:items-end gap-5 sm:gap-8 text-center md:text-left">
          {/* Vertical Poster with Glass Glow */}
          <div className="w-32 sm:w-44 md:w-56 shrink-0 aspect-[2/3] rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-white/20">
            <img
              src={posterSrc}
              alt={media.title}
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 space-y-3 w-full">
            {/* Top Badges Row: Flag & Country, Content Type, Year, Episodes */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/80 backdrop-blur-md border border-white/15 text-xs text-white font-bold">
                <CountryFlag code={media.country_code || media.country} size="sm" />
                <span>
                  {COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] ||
                    media.country_name ||
                    media.country ||
                    'ASYA'}
                </span>
              </span>

              <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-bold uppercase tracking-wider text-white/90">
                {formatContentTypeTR(media.content_type, media.country_code || media.country)}
              </span>

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
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
              {media.title}
            </h1>

            {/* Original / Native Title */}
            {(media.native_title || media.title_en) && (
              <p className="text-xs sm:text-sm text-white/55 font-medium">
                {media.native_title || media.title_en}
              </p>
            )}

            {/* Ratings Bar */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-0.5">
              {media.rating && media.rating > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs font-bold">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{Number(media.rating).toFixed(1)} Puan</span>
                </span>
              ) : null}

              {media.mdl_rating ? (
                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono text-amber-300 font-bold">
                  MDL {media.mdl_rating}
                </span>
              ) : null}

              {media.anilist_rating ? (
                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono text-sky-300 font-bold">
                  AniList {media.anilist_rating}%
                </span>
              ) : null}

              {media.imdb_rating ? (
                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono text-yellow-300 font-bold">
                  IMDb {media.imdb_rating}
                </span>
              ) : null}
            </div>

            {/* Categories */}
            {media.categories && media.categories.length > 0 && (
              <div className="flex flex-wrap justify-center md:justify-start gap-1.5 pt-1">
                {media.categories.map((cat) => (
                  <span
                    key={cat}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] text-white/80 border border-white/10"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}

            {/* ACTION BAR: Watch CTA, + Kütüphaneme Ekle, Favorile, Takip Et in 2x2 grid on mobile */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3 pt-3 w-full">
              {/* Primary Watch Button */}
              <Link
                href={`/seri/${media.slug}/${resumeEp}`}
                className="col-span-2 sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs transition-all shadow-[0_0_25px_rgba(41,151,255,0.45)] active:scale-[0.98] transform-gpu backface-hidden cursor-pointer"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>
                  {userProg?.last_episode_num
                    ? `${userProg.last_episode_num}. Bölümden Devam Et`
                    : '1. Bölümü İzle'}
                </span>
              </Link>

              {/* + Kütüphaneme Ekle Dropdown */}
              <div className="col-span-1 sm:w-auto w-full">
                <CustomSelect
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
                      icon: <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />,
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
                className={`col-span-1 sm:w-auto w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden ${
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
                className={`col-span-1 sm:w-auto w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold border transition-all cursor-pointer active:scale-[0.98] transform-gpu backface-hidden ${
                  isFollowed
                    ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.35)]'
                    : 'apple-glass-pill text-white hover:bg-white/15'
                }`}
              >
                <Bell className={`w-4 h-4 ${isFollowed ? 'fill-black' : ''}`} />
                <span>{isFollowed ? 'Takipte' : 'Takip Et'}</span>
              </button>

              {/* Sorun Bildir Button */}
              <button
                type="button"
                onClick={() => setShowSeriesReport((v) => !v)}
                className="col-span-1 sm:w-auto w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-full apple-glass-pill text-amber-300 hover:bg-amber-400/15 text-xs font-medium cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Sorun Bildir</span>
              </button>
            </div>

            {/* Series Report Modal / Inline Form */}
            {showSeriesReport && (
              <form
                onSubmit={submitSeriesIssue}
                className="mt-3 p-4 rounded-2xl bg-[#141418] border border-amber-400/30 flex flex-col sm:flex-row gap-3 max-w-2xl"
              >
                <CustomSelect
                  value={seriesReportCategory}
                  onChange={(val) => setSeriesReportCategory(val)}
                  variant="dark"
                  size="sm"
                  options={[
                    { value: 'Eksik Bölümler Var', label: 'Eksik Bölümler Var' },
                    { value: 'MDL / AniList / IMDb Eşleşmesi Yanlış', label: 'Eşleşme Yanlış' },
                    { value: 'Oyuncu / Karakter Bilgisi Eksik', label: 'Oyuncu Bilgisi Eksik' },
                    { value: 'Kapak / Afiş Görseli Bozuk', label: 'Afiş Görseli Bozuk' },
                    { value: 'Yayın Takvimi Günü Yanlış', label: 'Takvim Günü Yanlış' },
                  ]}
                />
                <input
                  type="text"
                  value={seriesReportNote}
                  onChange={(e) => setSeriesReportNote(e.target.value)}
                  placeholder="Detay yazın (opsiyonel)..."
                  className="flex-1 px-3 py-2 rounded-xl bg-black border border-white/15 text-xs text-white placeholder-white/35 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="px-4 py-2 rounded-full bg-amber-400 text-black font-bold text-xs cursor-pointer hover:bg-amber-300 disabled:opacity-50"
                >
                  {isSubmittingReport ? 'İletiliyor...' : 'Gönder'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* 2. MAIN BODY CONTENT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 space-y-12">
        {/* Overview & Fansub Translation Notes */}
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08] space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-400" />
            <span>Konu & Yapım Özeti</span>
          </h2>
          <p className="text-sm sm:text-base text-white/80 leading-relaxed font-light">
            {media.overview || 'Bu yapım için henüz Türkçe detaylı özet eklenmedi.'}
          </p>

          {(episodes[0]?.translation_note || media.status_translation) && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/25 text-xs text-amber-200">
              <span className="font-bold">Çeviri Notu:</span>{' '}
              {episodes[0]?.translation_note || `Çeviri Durumu: ${media.status_translation}`}
            </div>
          )}
        </div>

        {/* 3. CAST & CHARACTERS */}
        {cast.length > 0 && (
          <section className="p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-400" />
                <span>Oyuncu Kadrosu & Karakterler ({cast.length})</span>
              </h2>
              <span className="text-xs text-white/50">Profil ve filmografi için oyuncuya tıklayın</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {cast.map((c) => {
                const p = c.people;
                if (!p) return null;
                return (
                  <Link
                    key={`${c.person_id}-${c.character_name || ''}`}
                    href={`/oyuncu/${p.slug}`}
                    className="p-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/20 transition-all flex flex-col items-center text-center group"
                  >
                    <div className="w-20 h-20 rounded-full overflow-hidden border border-white/15 group-hover:border-emerald-400/50 transition-all mb-3 shadow-md">
                      <img
                        src={getProxiedImageUrl(p.image_url, p.name)}
                        alt={p.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="text-xs font-bold text-white line-clamp-1 group-hover:text-emerald-300 transition-colors">
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
          </section>
        )}

        {/* 4. FULL EPISODES GRID */}
        <section className="p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Film className="w-5 h-5 text-emerald-400" />
                <span>Bölüm Listesi ({episodes.length} Bölüm)</span>
              </h2>
              <p className="text-xs text-white/50 mt-1">
                İzlemek istediğiniz bölüme tıklayarak doğrudan video oynatıcı sayfasına geçebilirsiniz.
              </p>
            </div>

            {/* Season Selector Tabs if Multi-Season */}
            {seasons.length > 1 && (
              <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/[0.05] border border-white/10 overflow-x-auto no-scrollbar">
                {seasons.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSelectedSeason(s)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold font-mono transition-all cursor-pointer ${
                      selectedSeason === s
                        ? 'bg-emerald-500 text-black shadow-md'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {s}. Sezon
                  </button>
                ))}
              </div>
            )}
          </div>

          {seasonEpisodes.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/45">
              Bu sezon için henüz bölüm yüklenmedi.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {seasonEpisodes.map((ep) => {
                const isWatched = (userProg?.watched_episodes || []).includes(
                  ep.episode_number
                );
                return (
                  <Link
                    key={`${ep.season_number}-${ep.episode_number}`}
                    href={`/seri/${media.slug}/${ep.episode_number}`}
                    className="p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] hover:border-emerald-400/40 transition-all flex items-center justify-between group cursor-pointer shadow-md"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div className="w-10 h-10 rounded-xl bg-white/10 group-hover:bg-emerald-500 group-hover:text-black font-mono font-bold text-xs flex items-center justify-center shrink-0 transition-colors">
                        {ep.episode_number}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors truncate">
                          {ep.episode_name || `${ep.episode_number}. Bölüm`}
                        </div>
                        <div className="text-[10px] font-mono text-white/45 mt-0.5">
                          {ep.sources?.length || 0} Alternatif Kaynak
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isWatched && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      )}
                      <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-emerald-500 group-hover:text-black flex items-center justify-center transition-all">
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 5. RELATED RECOMMENDATIONS */}
        {relatedMedia.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-white">
              Benzer Yapımlar & Önerilenler
            </h2>
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar py-2">
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
    </div>
  );
}
