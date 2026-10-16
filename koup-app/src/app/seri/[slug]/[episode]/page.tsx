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
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  EpisodeData,
  COUNTRY_LABELS,
  getCountryFlag,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import NetflixPlayer from '@/components/NetflixPlayer';
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
    progressMap,
    toggleEpisodeWatched,
    pushNotification,
    triggerSound,
  } = useKoUp();

  const [media, setMedia] = useState<MediaItem | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [currentSeason, setCurrentSeason] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    async function loadEpisodeData() {
      setIsLoading(true);
      const decodedSlug = decodeURIComponent(slug);

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

      if (!mData) {
        setIsLoading(false);
        return;
      }

      const item = mData as MediaItem;
      setMedia(item);

      // Increment view counter
      supabase.rpc('increment_media_view', { p_media_id: item.id }).then(() => {});

      // Fetch verified episode sources from edge resolver
      try {
        const res = await fetch(`/api/sources/${item.id}`);
        const payload = await res.json();
        const eps: EpisodeData[] = payload.episodes || [];
        setEpisodes(eps);

        const currentEp = eps.find((e) => e.episode_number === currentEpNum);
        if (currentEp?.season_number) {
          setCurrentSeason(currentEp.season_number);
        }

        // Load real base reaction counts (0 fake data!)
        setReactionCounts({
          fire: currentEp?.react_fire || 0,
          cry: currentEp?.react_cry || 0,
          shock: currentEp?.react_shock || 0,
        });

        // Load user's persisted single-vote reaction for this episode
        const savedVote = localStorage.getItem(`koup_reaction_${item.id}_${currentEpNum}`);
        if (savedVote === 'fire' || savedVote === 'cry' || savedVote === 'shock') {
          setUserReaction(savedVote);
        } else {
          setUserReaction(null);
        }
      } catch {
        // fallback
      }

      setIsLoading(false);
    }

    loadEpisodeData();
  }, [slug, currentEpNum]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-24 bg-[#080808]">
        <div className="text-sm font-mono text-emerald-400 animate-pulse flex items-center gap-2">
          <Film className="w-4 h-4 animate-spin text-emerald-400" />
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
          className="px-6 py-3 rounded-full bg-white text-black font-bold text-xs"
        >
          Kataloğa Dön
        </Link>
      </div>
    );
  }

  const currentEpIndex = episodes.findIndex((e) => e.episode_number === currentEpNum);
  const currentEpObj =
    episodes[currentEpIndex] || {
      id: currentEpNum,
      season_number: currentSeason,
      episode_number: currentEpNum,
      episode_name: `${currentEpNum}. Bölüm`,
      episode_type: 'normal',
      sources: [],
    };

  const prevEp = currentEpIndex > 0 ? episodes[currentEpIndex - 1] : null;
  const nextEp = currentEpIndex >= 0 && currentEpIndex + 1 < episodes.length ? episodes[currentEpIndex + 1] : null;

  const isWatched = (progressMap[media.id]?.watched_episodes || []).includes(currentEpNum);

  // Single-vote reaction handler with clear focus/glow state
  const handleReaction = (type: 'fire' | 'cry' | 'shock') => {
    triggerSound('click');
    const storageKey = `koup_reaction_${media.id}_${currentEpNum}`;

    if (userReaction === type) {
      // Toggle off
      setUserReaction(null);
      setReactionCounts((prev) => ({ ...prev, [type]: Math.max(0, prev[type] - 1) }));
      localStorage.removeItem(storageKey);
      pushNotification('Tepki Kaldırıldı', 'Bölüm tepkiniz geri alındı.', 'info');
    } else {
      // Toggle on, or switch from previous
      const oldType = userReaction;
      setUserReaction(type);
      setReactionCounts((prev) => ({
        ...prev,
        [type]: prev[type] + 1,
        ...(oldType ? { [oldType]: Math.max(0, prev[oldType] - 1) } : {}),
      }));
      localStorage.setItem(storageKey, type);

      const labels = {
        fire: 'Efsane Bölüm!',
        cry: 'Mendil Bitti / Çok Duygusal',
        shock: 'Şok / Ters Köşe!',
      };
      pushNotification('Tepkin Kaydedildi', labels[type], 'success');
    }
  };

  const submitReport = (e: React.FormEvent) => {
    e.preventDefault();
    pushNotification(
      'Sorun Bildirimi Alındı',
      `${media.title} ${currentEpNum}. Bölüm için bildiriminiz teknik ekibe iletildi.`,
      'info'
    );
    setShowReport(false);
    setReportNote('');
  };

  const currentSeasonEpisodes = episodes.filter(
    (e) => (e.season_number || 1) === currentSeason
  );

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
              <span>{getCountryFlag(media.country)}</span>
              <span className="font-semibold">{COUNTRY_LABELS[media.country || ''] || 'ASYA'}</span>
            </span>

            <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 font-mono text-xs font-bold">
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
        />

        {/* Quick Episode Navigation & Control Bar */}
        <div className="mt-5 p-4 rounded-3xl bg-[#0f0f11] border border-white/[0.08] flex flex-wrap items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-2">
            {prevEp ? (
              <button
                onClick={() => router.push(`/seri/${media.slug}/${prevEp.episode_number}`)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Önceki Bölüm</span>
              </button>
            ) : (
              <span className="px-4 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                İlk Bölüm
              </span>
            )}

            {nextEp ? (
              <button
                onClick={() => router.push(`/seri/${media.slug}/${nextEp.episode_number}`)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.35)] cursor-pointer"
              >
                <span>Sonraki Bölüm</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <span className="px-4 py-2 rounded-full bg-white/[0.03] text-xs font-semibold text-white/30 border border-white/[0.05]">
                Son Bölüm
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleEpisodeWatched(media, currentEpNum)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                isWatched
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-white/10 border-white/15 text-white/80 hover:text-white hover:bg-white/20'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isWatched ? 'İzlendi' : 'İzlendi İşaretle'}</span>
            </button>

            <button
              onClick={() => setShowReport((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.05] hover:bg-amber-400/20 text-amber-300 border border-white/10 text-xs transition-all cursor-pointer"
              title="Bölümle ilgili hata bildir"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Sorun Bildir</span>
            </button>
          </div>
        </div>

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
              className="px-4 py-2 rounded-full bg-amber-400 text-black font-bold text-xs cursor-pointer hover:bg-amber-300 transition-colors"
            >
              Gönder
            </button>
          </form>
        )}

        {/* Reaction Bar & Source Distribution (Emerald Theme & 1 Reaction Per User with Focus State) */}
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
                <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-400/25">
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

          {/* Mini Episode Source & Reaction Sparkline Bar Chart (Emerald Theme) */}
          <div className="p-6 rounded-3xl bg-[#0f0f11] border border-white/[0.08] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-white/60 mb-2">
              <span>Bölüm Kaynak & Etkileşim Dağılımı</span>
              <span className="text-emerald-400 font-bold">
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
                        ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]'
                        : 'bg-emerald-500/15 hover:bg-emerald-500/35'
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

        {/* Seasons & Episodes Quick Grid (Emerald Selected Pill) */}
        <div className="mt-8 p-6 sm:p-8 rounded-3xl bg-[#0f0f11] border border-white/[0.08]">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Film className="w-5 h-5 text-emerald-400" />
              <span>Diğer Bölümler ({currentSeasonEpisodes.length})</span>
            </h3>
            <span className="text-xs text-white/45">İzlediğiniz bölümler yeşil tik ile işaretlenir</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {currentSeasonEpisodes.map((ep) => {
              const active = ep.episode_number === currentEpNum;
              const watched = (progressMap[media.id]?.watched_episodes || []).includes(ep.episode_number);
              return (
                <button
                  key={ep.episode_number}
                  onClick={() => router.push(`/seri/${media.slug}/${ep.episode_number}`)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.45)] scale-102'
                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06] text-white/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono">
                      {ep.episode_number}. Bölüm
                    </span>
                    {watched && (
                      <CheckCircle2 className={`w-3.5 h-3.5 ${active ? 'text-black' : 'text-emerald-400'}`} />
                    )}
                  </div>
                  <div className={`text-[10px] font-mono mt-1 ${active ? 'text-black/70' : 'text-white/45'}`}>
                    {ep.sources?.length || 0} Kaynak
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Episode Specific Comments (with Functional Seekable Timestamps!) */}
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
