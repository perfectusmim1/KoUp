'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Droplets,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Play,
  Film,
  Sparkles,
  Layers,
  Lightbulb,
  Maximize,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  EpisodeSource,
  COUNTRY_LABELS,
  getCountryFlag,
} from '@/lib/supabase';
import { cachedQuery } from '@/lib/cache';
import { useKoUp } from '@/context/KoUpContext';
import NetflixPlayer from '@/components/NetflixPlayer';
import CountryFlag from '@/components/CountryFlag';
import RichCommentSection from '@/components/RichCommentSection';
import CustomSelect from '@/components/CustomSelect';

export default function EpisodeWatchPage({
  params,
}: {
  params: Promise<{ slug: string; episode: string }>;
}) {
  const router = useRouter();
  const { slug, episode } = use(params);
  const currentEpNum = Number(episode) || 1;

  const {
    user,
    progressMap,
    toggleEpisodeWatched,
    updateEpisodeProgress,
    pushNotification,
    triggerSound,
  } = useKoUp();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [currentSeason, setCurrentSeason] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Source & Control Deck State
  const [selectedSourceIdx, setSelectedSourceIdx] = useState(0);
  const [selectedFansub, setSelectedFansub] = useState('all');
  const [cinemaLightsOff, setCinemaLightsOff] = useState(false);
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);

  // Single-vote reaction per episode per user
  const [userReaction, setUserReaction] = useState<'fire' | 'cry' | 'shock' | null>(null);
  const [reactionCounts, setReactionCounts] = useState<{
    fire: number;
    cry: number;
    shock: number;
  }>({ fire: 0, cry: 0, shock: 0 });

  // Issue report drawer
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState('Kaynak Açılmıyor / Kırık');
  const [reportNote, setReportNote] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Reset source selection on episode change
  useEffect(() => {
    setSelectedSourceIdx(0);
    setSelectedFansub('all');
    setShowEpisodeDrawer(false);
  }, [currentEpNum]);

  useEffect(() => {
    let isCancelled = false;

    async function loadEpisodeData() {
      setIsLoading(true);
      const decodedSlug = decodeURIComponent(slug);

      const mediaItem = await cachedQuery<MediaItem | null>(
        `media_${decodedSlug}`,
        300_000,
        async () => {
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

          return (mData as MediaItem) || null;
        }
      );

      if (isCancelled) return;

      if (!mediaItem) {
        setIsLoading(false);
        return;
      }

      setMedia(mediaItem);

      // Increment view counter non-blockingly
      supabase.rpc('increment_media_view', { p_media_id: mediaItem.id }).then(() => {});

      // Fetch verified episode sources from edge resolver with caching
      try {
        const rawEps = await cachedQuery<EpisodeData[]>(
          `episodes_${mediaItem.id}`,
          300_000,
          async () => {
            const res = await fetch(`/api/sources/${mediaItem.id}`);
            const payload = await res.json();
            return payload.episodes || [];
          }
        );
        if (isCancelled) return;

        // Sort episodes strictly by season then episode number
        const sortedEps = [...rawEps].sort(
          (a, b) =>
            (a.season_number || 1) - (b.season_number || 1) ||
            a.episode_number - b.episode_number
        );
        setEpisodes(sortedEps);

        const currentEp = sortedEps.find((e) => e.episode_number === currentEpNum);
        const activeSeason = currentEp?.season_number || 1;
        setCurrentSeason(activeSeason);

        // Update watching status in KoUpContext progress map
        const existingProg = progressMap[mediaItem.id];
        const initialPos = existingProg?.resume_position_sec || 0;
        updateEpisodeProgress(
          mediaItem,
          activeSeason,
          currentEpNum,
          currentEp?.episode_name || `${currentEpNum}. Bölüm`,
          initialPos,
          3600
        );

        // Load base reaction counts
        setReactionCounts({
          fire: currentEp?.react_fire || 0,
          cry: currentEp?.react_cry || 0,
          shock: currentEp?.react_shock || 0,
        });

        // Load user's persisted single-vote reaction for this episode
        const savedVote = localStorage.getItem(`koup_reaction_${mediaItem.id}_${currentEpNum}`);
        if (savedVote === 'fire' || savedVote === 'cry' || savedVote === 'shock') {
          setUserReaction(savedVote);
        } else {
          setUserReaction(null);
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
  }, [slug, currentEpNum]);

  // Dynamic document title
  useEffect(() => {
    if (media?.title) {
      document.title = `${media.title} ${currentEpNum}. Bölüm İzle • KoUp Sinema`;
    }
  }, [media?.title, currentEpNum]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 bg-[#080808]">
        <div className="text-sm font-mono text-sky-400 animate-pulse flex items-center gap-2">
          <Film className="w-4 h-4 animate-spin text-sky-400" />
          <span>Sinema Oynatıcısı ve Kaynaklar Yükleniyor...</span>
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
          className="px-6 py-3 rounded-full bg-[#2997ff] text-white font-bold text-xs hover:bg-sky-400 transition-colors shadow-lg shadow-blue-500/25"
        >
          Kataloğa Dön
        </Link>
      </div>
    );
  }

  // Robust episode bounds checking
  const currentEpIndex = episodes.findIndex(
    (e) => (e.season_number || 1) === currentSeason && e.episode_number === currentEpNum
  );
  const fallbackIndex =
    currentEpIndex >= 0 ? currentEpIndex : episodes.findIndex((e) => e.episode_number === currentEpNum);

  const currentEpObj =
    (fallbackIndex >= 0 ? episodes[fallbackIndex] : null) || {
      id: currentEpNum,
      season_number: currentSeason,
      episode_number: currentEpNum,
      episode_name: `${currentEpNum}. Bölüm`,
      episode_type: 'normal',
      sources: [],
    };

  const prevEp = fallbackIndex > 0 ? episodes[fallbackIndex - 1] : null;
  const nextEp =
    fallbackIndex >= 0 && fallbackIndex + 1 < episodes.length
      ? episodes[fallbackIndex + 1]
      : null;

  const isWatched = (progressMap[media.id]?.watched_episodes || []).includes(currentEpNum);

  // Single-vote reaction handler with real Supabase RPC persistence
  const handleReaction = async (type: 'fire' | 'cry' | 'shock') => {
    triggerSound('click');
    const storageKey = `koup_reaction_${media.id}_${currentEpNum}`;

    if (userReaction === type) {
      // Toggle off
      setUserReaction(null);
      setReactionCounts((prev) => ({ ...prev, [type]: Math.max(0, prev[type] - 1) }));
      localStorage.removeItem(storageKey);
    } else {
      // Toggle on or switch
      const oldType = userReaction;
      setUserReaction(type);
      setReactionCounts((prev) => ({
        ...prev,
        [type]: prev[type] + 1,
        ...(oldType ? { [oldType]: Math.max(0, prev[oldType] - 1) } : {}),
      }));
      localStorage.setItem(storageKey, type);

      // Persist to Supabase via RPC (fire and forget, silent)
      supabase
        .rpc('increment_episode_reaction', {
          p_media_id: media.id,
          p_season: currentSeason,
          p_episode: currentEpNum,
          p_reaction: type,
        })
        .then(() => {});
    }
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingReport(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id || user?.id || null;

      await supabase.from('issue_reports').insert({
        reporter_id: uid,
        target_type: 'episode',
        media_id: media.id,
        season_number: currentSeason,
        episode_number: currentEpNum,
        provider_name: activeSource?.provider || 'episode_player',
        issue_category: reportCategory,
        details: reportNote.trim() || `${media.title} ${currentEpNum}. Bölüm sorun bildirimi`,
        status: 'open',
      });

      pushNotification(
        'Sorun Bildirimi Alındı',
        `${media.title} ${currentEpNum}. Bölüm için bildiriminiz teknik ekibe iletildi.`,
        'info'
      );
    } catch {
      pushNotification(
        'Sorun Bildirimi Alındı',
        'Bildiriminiz kaydedildi.',
        'info'
      );
    } finally {
      setIsSubmittingReport(false);
      setShowReport(false);
      setReportNote('');
    }
  };

  const currentSeasonEpisodes = episodes.filter(
    (e) => (e.season_number || 1) === currentSeason
  );

  const availableSources: EpisodeSource[] = currentEpObj?.sources || [];
  const uniqueFansubs = Array.from(
    new Set(availableSources.map((s) => s.fansub).filter(Boolean))
  ) as string[];

  const filteredSources =
    selectedFansub === 'all'
      ? availableSources
      : availableSources.filter((s) => s.fansub === selectedFansub);

  const activeSource: EpisodeSource | undefined =
    filteredSources[selectedSourceIdx] || availableSources[0];

  return (
    <div className="min-h-screen pb-32 bg-[#080808] text-white pt-20">
      {/* Top Header Breadcrumb & Back Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-white/[0.08]">
          <Link
            href={`/seri/${media.slug}`}
            className="inline-flex items-center gap-2 text-xs font-semibold text-white/70 hover:text-white transition-all group"
          >
            <ChevronLeft className="w-4 h-4 text-white/50 group-hover:-translate-x-0.5 transition-transform" />
            <span>Seri Sayfasına Dön</span>
          </Link>

          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-xs text-white/80">
              <CountryFlag code={media.country_code || media.country} size="sm" />
              <span className="font-semibold">
                {COUNTRY_LABELS[((media.country_code || media.country) || '').toUpperCase()] ||
                  media.country_name ||
                  'ASYA'}
              </span>
            </span>

            <span className="px-3 py-1 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-300 font-mono text-xs font-bold">
              S{currentSeason} : B{currentEpNum}
            </span>
          </div>
        </div>
      </div>

      {/* Main Netflix Player Stage */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <NetflixPlayer
          media={media}
          episodes={episodes}
          currentSeason={currentSeason}
          currentEpisode={currentEpNum}
          onSelectEpisode={(s, e) => {
            router.push(`/seri/${media.slug}/${e}`);
          }}
          selectedSourceIdx={selectedSourceIdx}
          onSelectSourceIdx={(idx) => setSelectedSourceIdx(idx)}
          selectedFansub={selectedFansub}
          cinemaLightsOff={cinemaLightsOff}
          onToggleCinemaLights={() => setCinemaLightsOff((v) => !v)}
        />

        {/* Sleek External Cinema Control & Source Deck */}
        <div className="mt-4 p-4 sm:p-5 rounded-3xl bg-[#0f0f11] border border-white/[0.08] shadow-2xl space-y-3.5">
          {/* Row 1: Source & Server Switcher Pills */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-white/50 shrink-0 mr-1 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>Kaynaklar ({filteredSources.length}):</span>
              </span>

              {filteredSources.length === 0 ? (
                <span className="text-xs text-white/40">Kaynak hazırlanıyor...</span>
              ) : (
                filteredSources.map((src, idx) => {
                  const active = idx === selectedSourceIdx;
                  const isNative =
                    src.stream_type === 'hls' ||
                    src.stream_type === 'tau' ||
                    src.stream_type === 'mp4';
                  return (
                    <button
                      key={`${src.embed_id || idx}-${idx}`}
                      onClick={() => setSelectedSourceIdx(idx)}
                      className={`shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-medium transition-all cursor-pointer border ${
                        active
                          ? 'bg-[#2997ff] text-white font-bold border-sky-400 shadow-[0_0_18px_rgba(41,151,255,0.45)] scale-[1.03]'
                          : 'bg-white/[0.05] hover:bg-white/[0.12] text-white/80 border-white/10 hover:text-white'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isNative ? 'bg-sky-400' : 'bg-blue-400'
                        } ${active ? 'bg-white' : ''}`}
                      />
                      <span>{src.source_name || `Kaynak ${idx + 1}`}</span>
                      {src.fansub && src.fansub !== 'Varsayılan' && (
                        <span className={`text-[10px] ${active ? 'text-black/75' : 'text-white/50'}`}>
                          ({src.fansub})
                        </span>
                      )}
                      {src.quality_label && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            active ? 'bg-black/20 text-black font-bold' : 'bg-white/10 text-white/60'
                          }`}
                        >
                          {src.quality_label}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Fansub Selector + Cinema Mode + Fullscreen */}
            <div className="flex items-center gap-2 shrink-0">
              {uniqueFansubs.length > 1 && (
                <CustomSelect
                  value={selectedFansub}
                  onChange={(val) => {
                    setSelectedFansub(val);
                    setSelectedSourceIdx(0);
                  }}
                  variant="dark"
                  size="sm"
                  options={[
                    { value: 'all', label: 'Tüm Çeviriler' },
                    ...uniqueFansubs.map((f) => ({ value: f, label: f })),
                  ]}
                />
              )}

              <button
                onClick={() => setCinemaLightsOff((v) => !v)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  cinemaLightsOff
                    ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.4)]'
                    : 'bg-white/[0.05] hover:bg-white/[0.12] text-white/80 border-white/10 hover:text-white'
                }`}
                title="Sinema Modu (L)"
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {cinemaLightsOff ? 'Normal Mod' : 'Sinema Modu'}
                </span>
              </button>

              <button
                onClick={() => {
                  const el = document.getElementById('koup-player-container');
                  if (!document.fullscreenElement) {
                    if (el?.requestFullscreen) {
                      el.requestFullscreen().catch(() => {});
                    } else {
                      document.documentElement.requestFullscreen().catch(() => {});
                    }
                  } else {
                    document.exitFullscreen().catch(() => {});
                  }
                }}
                className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-all cursor-pointer"
                title="Tam Ekran (F)"
              >
                <Maximize className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Row 2: Episode Navigation & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {prevEp ? (
                <button
                  onClick={() => router.push(`/seri/${media.slug}/${prevEp.episode_number}`)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Önceki Bölüm (B{prevEp.episode_number})</span>
                </button>
              ) : (
                <span className="px-4 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                  İlk Bölüm
                </span>
              )}

              {nextEp ? (
                <button
                  onClick={() => router.push(`/seri/${media.slug}/${nextEp.episode_number}`)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white text-xs font-bold transition-all shadow-[0_0_15px_rgba(41,151,255,0.35)] cursor-pointer"
                >
                  <span>Sonraki Bölüm (B{nextEp.episode_number})</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <span className="px-4 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                  Final Bölümü
                </span>
              )}

              <button
                onClick={() => setShowEpisodeDrawer((v) => !v)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  showEpisodeDrawer
                    ? 'bg-white text-black border-white'
                    : 'bg-white/[0.05] hover:bg-white/10 text-white/80 border-white/10'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Bölüm Listesi ({currentSeasonEpisodes.length})</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleEpisodeWatched(media, currentEpNum)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isWatched
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-white/10 border-white/15 text-white/80 hover:text-white hover:bg-white/20'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isWatched ? 'İzlendi' : 'İzlendi İşaretle'}</span>
              </button>

              <button
                onClick={() => setShowReport((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs transition-all cursor-pointer ${
                  showReport
                    ? 'bg-amber-400 text-black border-amber-300 font-bold'
                    : 'bg-white/[0.05] hover:bg-amber-400/20 text-amber-300 border-white/10'
                }`}
                title="Bölümle ilgili hata bildir"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Sorun Bildir</span>
              </button>
            </div>
          </div>
        </div>

        {/* Expandable Episode List Tray */}
        {showEpisodeDrawer && (
          <div className="mt-3 p-4 sm:p-5 rounded-3xl bg-[#141418] border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-white">
                  {currentSeason}. Sezon Bölümleri ({currentSeasonEpisodes.length})
                </span>
              </div>
              <button
                onClick={() => setShowEpisodeDrawer(false)}
                className="text-xs text-white/50 hover:text-white cursor-pointer"
              >
                Gizle
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5 max-h-64 overflow-y-auto pr-1">
              {currentSeasonEpisodes.map((ep) => {
                const isCurrent = ep.episode_number === currentEpNum;
                const watched = (
                  progressMap[media.id]?.watched_episodes || []
                ).includes(ep.episode_number);
                return (
                  <button
                    key={`${ep.season_number}-${ep.episode_number}`}
                    onClick={() => {
                      router.push(`/seri/${media.slug}/${ep.episode_number}`);
                      setShowEpisodeDrawer(false);
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative ${
                      isCurrent
                        ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-[0_0_15px_rgba(41,151,255,0.35)]'
                        : 'bg-white/[0.03] border-white/[0.08] text-white/80 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold">
                        B{ep.episode_number}
                      </span>
                      {watched && (
                        <CheckCircle2 className="w-3 h-3 text-sky-400" />
                      )}
                    </div>
                    <div className="text-[10px] text-white/50 truncate mt-1">
                      {ep.episode_name || `${ep.episode_number}. Bölüm`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Issue Report Form Drawer */}
        {showReport && (
          <form
            onSubmit={submitReport}
            className="mt-3 p-4 rounded-2xl bg-[#141418] border border-amber-400/30 flex flex-col sm:flex-row gap-3"
          >
            <CustomSelect
              value={reportCategory}
              onChange={(val) => setReportCategory(val)}
              variant="dark"
              size="sm"
              options={[
                { value: 'Kaynak Açılmıyor / Kırık', label: 'Kaynak Açılmıyor / Kırık' },
                { value: 'Altyazı / Dublaj Senkronu Bozuk', label: 'Altyazı Senkronu Bozuk' },
                { value: 'Ses Yok veya Kalite Çok Düşük', label: 'Ses / Kalite Hatası' },
                { value: 'Yanlış Bölüm Yüklü', label: 'Yanlış Bölüm Yüklü' },
              ]}
            />
            <input
              type="text"
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
              placeholder="Detay yazın (opsiyonel)..."
              className="flex-1 px-3 py-2 rounded-xl bg-black border border-white/15 text-xs text-white placeholder-white/35 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSubmittingReport}
              className="px-4 py-2 rounded-full bg-amber-400 text-black font-bold text-xs cursor-pointer hover:bg-amber-300 transition-colors disabled:opacity-50"
            >
              {isSubmittingReport ? 'İletiliyor...' : 'Gönder'}
            </button>
          </form>
        )}

        {/* Reaction Bar & Source Distribution */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Reaction Box */}
          <div className="p-6 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40">
                  Bölüm Sonu Nabzı
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">
                  Bu Bölümü Nasıl Buldun?
                </h3>
              </div>
              {userReaction && (
                <span className="text-[11px] font-semibold text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-full border border-sky-400/25">
                  ✓ Tepkin Kaydedildi
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4">
              {/* Efsane / Fire Reaction */}
              <button
                onClick={() => handleReaction('fire')}
                className={`p-3.5 rounded-2xl flex flex-col items-center text-center transition-all cursor-pointer border ${
                  userReaction === 'fire'
                    ? 'bg-amber-400/25 border-amber-400 text-amber-300 ring-2 ring-amber-400/50 shadow-[0_0_18px_rgba(251,191,36,0.35)] scale-102'
                    : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/25 text-white/80'
                }`}
              >
                <Flame className={`w-5 h-5 ${userReaction === 'fire' ? 'fill-amber-400 text-amber-400' : 'text-amber-400'}`} />
                <div className="text-xs font-bold mt-1.5">Efsane</div>
                <div className="text-[11px] font-mono opacity-70 mt-0.5">
                  {reactionCounts.fire}
                </div>
              </button>

              {/* Ağlattı / Cry Reaction */}
              <button
                onClick={() => handleReaction('cry')}
                className={`p-3.5 rounded-2xl flex flex-col items-center text-center transition-all cursor-pointer border ${
                  userReaction === 'cry'
                    ? 'bg-sky-400/25 border-sky-400 text-sky-300 ring-2 ring-sky-400/50 shadow-[0_0_18px_rgba(56,189,248,0.35)] scale-102'
                    : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/25 text-white/80'
                }`}
              >
                <Droplets className={`w-5 h-5 ${userReaction === 'cry' ? 'fill-sky-400 text-sky-400' : 'text-sky-300'}`} />
                <div className="text-xs font-bold mt-1.5">Ağlattı</div>
                <div className="text-[11px] font-mono opacity-70 mt-0.5">
                  {reactionCounts.cry}
                </div>
              </button>

              {/* Şok / Shock Reaction */}
              <button
                onClick={() => handleReaction('shock')}
                className={`p-3.5 rounded-2xl flex flex-col items-center text-center transition-all cursor-pointer border ${
                  userReaction === 'shock'
                    ? 'bg-pink-400/25 border-pink-400 text-pink-300 ring-2 ring-pink-400/50 shadow-[0_0_18px_rgba(244,114,182,0.35)] scale-102'
                    : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/25 text-white/80'
                }`}
              >
                <Zap className={`w-5 h-5 ${userReaction === 'shock' ? 'fill-pink-400 text-pink-400' : 'text-pink-300'}`} />
                <div className="text-xs font-bold mt-1.5">Şok</div>
                <div className="text-[11px] font-mono opacity-70 mt-0.5">
                  {reactionCounts.shock}
                </div>
              </button>
            </div>
          </div>

          {/* Mini Episode Source & Reaction Sparkline Bar Chart */}
          <div className="p-6 rounded-3xl bg-[#0f0f11] border border-white/[0.08] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
              <span>Bölüm Kaynak & Etkileşim Dağılımı</span>
              <span className="text-sky-400 font-bold">
                Aktif: B{currentEpNum} ({currentEpObj?.sources?.length || 0} Kaynak)
              </span>
            </div>

            <div className="h-20 flex items-end gap-1.5 pt-2">
              {currentSeasonEpisodes.slice(0, 16).map((ep) => {
                const totalScore =
                  (ep.react_fire || 0) +
                  (ep.react_cry || 0) +
                  (ep.react_shock || 0) +
                  (ep.sources?.length || 1) * 8;
                const hPct = Math.min(100, Math.max(25, totalScore));
                const active = ep.episode_number === currentEpNum;
                return (
                  <div
                    key={ep.episode_number}
                    onClick={() => router.push(`/seri/${media.slug}/${ep.episode_number}`)}
                    title={`${ep.episode_number}. Bölüm · ${ep.sources?.length || 0} Kaynak`}
                    style={{ height: `${hPct}%` }}
                    className={`flex-1 rounded-t-md cursor-pointer transition-all ${
                      active
                        ? 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.7)]'
                        : 'bg-sky-500/15 hover:bg-sky-500/35'
                    }`}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-white/40 pt-2 border-t border-white/[0.06] mt-2">
              <span>Sezon {currentSeason}</span>
              <span>{currentSeasonEpisodes.length} Bölüm Toplam</span>
            </div>
          </div>
        </div>

        {/* Episode Specific Comments */}
        <RichCommentSection
          targetType="episode"
          mediaId={media.id}
          seasonNumber={currentSeason}
          episodeNumber={currentEpNum}
          targetTitle={`${media.title} • ${currentEpNum}. Bölüm`}
        />
      </div>
    </div>
  );
}
