'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  User,
  Lock,
  Globe,
  Volume2,
  RefreshCw,
  FolderPlus,
  Heart,
  Clock,
  CheckCircle2,
  Sparkles,
  Settings,
  Play,
  EyeOff,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import { playNotificationChime, SoundTone } from '@/lib/sound';
import AccordionMediaCard from '@/components/AccordionMediaCard';

interface CustomListObj {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  visibility: 'public' | 'private' | 'unlisted';
  media_ids: number[];
}

export default function ProfilePage() {
  const {
    user,
    progressMap,
    favPersonIds,
    setLibraryStatus,
    updateProfileSettings,
    pushNotification,
    setIsAuthModalOpen,
  } = useKoUp();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'library' | 'lists' | 'sync' | 'settings'
  >('overview');
  const [libraryFilter, setLibraryFilter] = useState<
    'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped' | 'favorites'
  >('watching');

  const [favPeople, setFavPeople] = useState<PersonItem[]>([]);

  // Custom Lists state
  const [customLists, setCustomLists] = useState<CustomListObj[]>([
    {
      id: 'list-1',
      title: 'En İyi Soğuk CEO & Sözleşmeli Evlilik K-Dramaları',
      description: 'Romantik komedi ve yüksek kimyalı favori Kore dizilerim.',
      cover_image_url:
        'https://image.tmdb.org/t/p/original/rAOjnEFTuNysY7bot8zonhImGMh.jpg',
      visibility: 'public',
      media_ids: [1, 2, 3, 4],
    },
  ]);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [newListCoverUrl, setNewListCoverUrl] = useState('');
  const [newListVisibility, setNewListVisibility] = useState<
    'public' | 'private' | 'unlisted'
  >('public');

  // MDL & AniList 1-Click Import state
  const [mdlUsername, setMdlUsername] = useState(user?.mdl_username || '');
  const [anilistUsername, setAnilistUsername] = useState(
    user?.anilist_username || ''
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    platform: string;
    username: string;
    matchedCount: number;
    matchedItems: Array<{ media: MediaItem; status: string; score: number }>;
  } | null>(null);

  useEffect(() => {
    if (favPersonIds.length > 0) {
      supabase
        .from('people')
        .select('*')
        .in('id', favPersonIds)
        .then(({ data }) => {
          setFavPeople((data as PersonItem[]) || []);
        });
    } else {
      setFavPeople([]);
    }
  }, [favPersonIds]);

  const progressEntries = Object.values(progressMap).filter((p) => p.media);
  const totalWatchedEps =
    (user?.stats_episodes_watched || 48) +
    progressEntries.reduce((acc, p) => acc + (p.watched_episodes?.length || 1), 0);
  const totalHours = Math.round((totalWatchedEps * 52) / 60);
  const totalDays = (totalHours / 24).toFixed(1);

  const filteredLibrary = progressEntries.filter((p) => {
    if (libraryFilter === 'favorites') return p.is_favorite;
    return p.status === libraryFilter;
  });

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    const item: CustomListObj = {
      id: `lst-${Date.now()}`,
      title: newListTitle.trim(),
      description: newListDesc.trim() || 'Özel KoUp koleksiyonu',
      cover_image_url:
        newListCoverUrl.trim() ||
        'https://image.tmdb.org/t/p/original/rAOjnEFTuNysY7bot8zonhImGMh.jpg',
      visibility: newListVisibility,
      media_ids: progressEntries.slice(0, 4).map((p) => p.media_id),
    };
    setCustomLists((prev) => [item, ...prev]);
    setNewListTitle('');
    setNewListDesc('');
    setNewListCoverUrl('');
    pushNotification(
      'Özel Liste Oluşturuldu 📁',
      `"${item.title}" koleksiyonun (${item.visibility.toUpperCase()}) yayına alındı.`,
      'success'
    );
  };

  const handleExternalImport = async (platform: 'mdl' | 'anilist') => {
    const uname = platform === 'mdl' ? mdlUsername : anilistUsername;
    if (!uname.trim()) {
      pushNotification(
        'Kullanıcı Adı Gerekli',
        `Lütfen ${platform === 'mdl' ? 'MyDramaList' : 'AniList'} kullanıcı adınızı girin.`,
        'info'
      );
      return;
    }

    setIsSyncing(true);
    try {
      const resp = await fetch('/api/mdl-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, username: uname.trim() }),
      });
      const data = await resp.json();
      if (resp.ok && data.matchedItems) {
        setSyncResult(data);
        for (const item of data.matchedItems) {
          if (item.media) {
            setLibraryStatus(
              item.media as MediaItem,
              (item.status as 'watching' | 'completed') || 'completed',
              item.score
            );
          }
        }
        pushNotification(
          `${platform.toUpperCase()} İçe Aktarma Tamamlandı ⚡`,
          `${data.matchedCount} yapım KoUp kütüphanene ve istatistiklerine senkronlandı!`,
          'success'
        );
      } else {
        pushNotification(
          'İçe Aktarma Bilgisi',
          data.error || 'Kullanıcı bulunamadı.',
          'info'
        );
      }
    } catch {
      pushNotification('Bağlantı Hatası', 'İçe aktarma servisine ulaşılamadı.', 'info');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-4 sm:px-8 lg:px-14 space-y-8">
      {/* 1. PROFILE BANNER & HEADER */}
      <div className="rounded-3xl overflow-hidden apple-glass border border-white/15">
        <div className="relative h-44 sm:h-56 overflow-hidden">
          <img
            src={getProxiedImageUrl(user?.banner_url)}
            alt="Profil Kapak"
            className="w-full h-full object-cover brightness-75"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08080A] via-black/30 to-transparent" />
        </div>

        <div className="px-6 sm:px-10 pb-8 -mt-14 relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-5 text-center sm:text-left">
            <img
              src={getProxiedImageUrl(user?.avatar_url)}
              alt={user?.display_name || 'Profil'}
              className="w-28 h-28 rounded-3xl object-cover border-4 border-[#08080A] shadow-2xl"
            />
            <div>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                  {user?.display_name}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-white/75">
                  @{user?.username}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-sky-400/20 text-sky-300 border border-sky-400/30">
                  {user?.is_private ? '🔒 Gizli Profil' : '🌍 Herkese Açık Profil'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-white/65 mt-1">{user?.bio}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="px-4 py-2.5 rounded-full apple-glass-pill text-xs font-semibold text-sky-300 hover:bg-sky-400/15 cursor-pointer"
            >
              Supabase Hesap Bağla / Değiştir
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Gizlilik & Ses Ayarları</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 sm:px-10 py-3 border-t border-white/10 flex flex-wrap gap-2 bg-black/30">
          {[
            { id: 'overview', label: '📊 Genel Bakış & Drama DNA' },
            { id: 'library', label: `📚 Kütüphanem (${progressEntries.length})` },
            { id: 'lists', label: `📁 Özel Listelerim (${customLists.length})` },
            { id: 'sync', label: '⚡ MDL & AniList Tek Tıkla Aktarım' },
            { id: 'settings', label: '⚙️ Gizlilik & Sesli Bildirim Ayarları' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                activeTab === t.id
                  ? 'bg-white text-black shadow'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: OVERVIEW & DRAMA DNA */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-3xl apple-glass p-6 border border-white/10">
              <div className="text-xs font-mono text-sky-400">TOPLAM İZLENEN BÖLÜM</div>
              <div className="text-3xl font-mono font-extrabold text-white mt-2">
                {totalWatchedEps} Bölüm
              </div>
              <div className="text-xs text-white/50 mt-1">
                K-Drama, C-Drama & Anime
              </div>
            </div>

            <div className="rounded-3xl apple-glass p-6 border border-white/10">
              <div className="text-xs font-mono text-amber-300">TOPLAM EKRAN SÜRESİ</div>
              <div className="text-3xl font-mono font-extrabold text-white mt-2">
                {totalDays} Gün
              </div>
              <div className="text-xs text-white/50 mt-1">
                Yaklaşık {totalHours} saat sinema keyfi
              </div>
            </div>

            <div className="rounded-3xl apple-glass p-6 border border-white/10">
              <div className="text-xs font-mono text-emerald-400">TAMAMLANAN YAPIM</div>
              <div className="text-3xl font-mono font-extrabold text-white mt-2">
                {(user?.stats_series_completed || 6) +
                  (user?.stats_anime_completed || 5) +
                  progressEntries.filter((p) => p.status === 'completed').length}
              </div>
              <div className="text-xs text-white/50 mt-1">
                Dizi, Anime & Sinema Filmi
              </div>
            </div>

            <div className="rounded-3xl apple-glass p-6 border border-white/10">
              <div className="text-xs font-mono text-pink-400">
                FAVORİ OYUNCU & KARAKTER
              </div>
              <div className="text-3xl font-mono font-extrabold text-white mt-2">
                {favPersonIds.length} Yıldız
              </div>
              <div className="text-xs text-white/50 mt-1">
                MDL & AniList favorilerin
              </div>
            </div>
          </div>

          {/* Drama & Anime DNA Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-3xl apple-glass p-6 border border-white/10 space-y-4">
              <h3 className="text-base font-bold text-white">
                🧬 Drama & Anime DNA · Ülke Dağılımı
              </h3>
              <div className="space-y-3">
                {[
                  { label: '🇰🇷 Güney Kore (K-Drama)', pct: 58, color: 'bg-sky-400' },
                  { label: '🇯🇵 Japonya (Anime & J-Drama)', pct: 26, color: 'bg-amber-400' },
                  { label: '🇨🇳 Çin (C-Drama & Wuxia)', pct: 12, color: 'bg-emerald-400' },
                  { label: '🇹🇭 Tayland & Global', pct: 4, color: 'bg-pink-400' },
                ].map((row) => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/85 font-medium">{row.label}</span>
                      <span className="font-mono text-white/60">%{row.pct}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        style={{ width: `${row.pct}%` }}
                        className={`h-full rounded-full ${row.color}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Favorite Actors & Anime Characters */}
            <div className="rounded-3xl apple-glass p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">
                  ❤️ Favori Oyuncularım & Karakterlerim
                </h3>
                <Link href="/oyuncular" className="text-xs text-sky-400 hover:underline">
                  Yıldız Keşfet →
                </Link>
              </div>
              {favPeople.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/50">
                  Oyuncular veya anime karakterleri sayfasından ❤️ butonuna tıklayarak favori yıldızlarını buraya ekleyebilirsin.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {favPeople.map((p) => (
                    <Link
                      key={p.id}
                      href={`/oyuncu/${p.slug}`}
                      className="flex items-center gap-2.5 p-2 rounded-2xl bg-white/[0.04] hover:bg-white/10 border border-white/10"
                    >
                      <img
                        src={getProxiedImageUrl(p.image_url)}
                        alt={p.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {p.name}
                        </div>
                        <div className="text-[10px] font-mono text-pink-300">
                          ❤️ {p.favorites_count + 1}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 6-TAB PERSONAL LIBRARY */}
      {activeTab === 'library' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'watching', label: '▶ İzliyorum' },
              { id: 'completed', label: '✓ Tamamladım' },
              { id: 'plan_to_watch', label: '📌 İzleyeceğim' },
              { id: 'on_hold', label: '⏸ Beklemede' },
              { id: 'dropped', label: '✕ Bıraktım' },
              { id: 'favorites', label: '❤️ Favorilerim' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setLibraryFilter(tab.id as typeof libraryFilter)}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  libraryFilter === tab.id
                    ? 'bg-sky-400 text-black'
                    : 'apple-glass-pill text-white/75 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredLibrary.length === 0 ? (
            <div className="rounded-3xl apple-glass p-12 text-center border border-white/10">
              <p className="text-sm text-white/60 mb-4">
                Bu sekmede henüz yapım yok. Katalogdan ekleyebilir veya MDL/AniList hesabını tek tıkla içe aktarabilirsin.
              </p>
              <button
                onClick={() => setActiveTab('sync')}
                className="px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
              >
                MDL / AniList Listemi Aktar →
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {filteredLibrary.map((entry) =>
                entry.media ? (
                  <AccordionMediaCard key={entry.media.id} item={entry.media} />
                ) : null
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CUSTOM LISTS WITH URL COVER IMAGE */}
      {activeTab === 'lists' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <form
            onSubmit={handleCreateList}
            className="rounded-3xl apple-glass p-6 border border-white/15 space-y-4 h-fit"
          >
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <FolderPlus className="w-5 h-5 text-sky-400" />
              <span>Yeni Özel Liste Oluştur</span>
            </h3>
            <div>
              <label className="block text-xs text-white/60 mb-1">Liste Başlığı</label>
              <input
                type="text"
                required
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                placeholder="Örn: Ağlatan Kore Dizileri Seçkisi"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">
                Kapak Görseli URL (Supabase Storage kullanılmaz)
              </label>
              <input
                type="url"
                value={newListCoverUrl}
                onChange={(e) => setNewListCoverUrl(e.target.value)}
                placeholder="https://... (Görsel URL)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Görünürlük</label>
              <select
                value={newListVisibility}
                onChange={(e) =>
                  setNewListVisibility(
                    e.target.value as 'public' | 'private' | 'unlisted'
                  )
                }
                className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-xs text-white"
              >
                <option value="public">🌍 Herkese Açık (Public)</option>
                <option value="private">🔒 Sadece Bana Özel (Private)</option>
                <option value="unlisted">🔗 Sadece Link İle (Unlisted)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Açıklama</label>
              <textarea
                rows={2}
                value={newListDesc}
                onChange={(e) => setNewListDesc(e.target.value)}
                placeholder="Liste hakkında kısa not..."
                className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer"
            >
              Koleksiyonu Oluştur
            </button>
          </form>

          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {customLists.map((lst) => (
              <div
                key={lst.id}
                className="koup-projection-card rounded-3xl overflow-hidden bg-[#121216] border border-white/10 flex flex-col"
              >
                <div className="relative h-44">
                  <img
                    src={getProxiedImageUrl(lst.cover_image_url)}
                    alt={lst.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#121216] via-black/30 to-transparent" />
                  <span className="absolute top-3 right-3 px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-black/75 text-sky-300 border border-white/15">
                    {lst.visibility.toUpperCase()}
                  </span>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-base font-bold text-white">{lst.title}</h4>
                    <p className="text-xs text-white/60 mt-1">{lst.description}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono text-emerald-300">
                    <span>%75 Tamamlandı</span>
                    <span>{lst.media_ids.length} Yapım</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: 1-CLICK MYDRAMALIST & ANILIST IMPORT */}
      {activeTab === 'sync' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MDL Import Card */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-[#E5A93C]/30 space-y-4">
            <div className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-[#E5A93C]/20 text-[#E5A93C] w-fit">
              MyDramaList · Tek Tıkla Liste İçe Aktarma
            </div>
            <h3 className="text-xl font-bold text-white">
              MDL İzleme Listeni KoUp&apos;a Aktar
            </h3>
            <p className="text-xs text-white/65 leading-relaxed">
              Şifre gerekmez. Herkese açık MyDramaList kullanıcı adını gir; izlediğin K-Drama, C-Drama ve Asya filmleri otomatik olarak KoUp kütüphanene eklensin.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={mdlUsername}
                onChange={(e) => setMdlUsername(e.target.value)}
                placeholder="MDL Kullanıcı Adın (örn: kdrama_fan)"
                className="flex-1 px-4 py-2.5 rounded-full bg-black/60 border border-white/15 text-xs text-white"
              />
              <button
                onClick={() => handleExternalImport('mdl')}
                disabled={isSyncing}
                className="px-5 py-2.5 rounded-full bg-[#E5A93C] text-black font-bold text-xs cursor-pointer"
              >
                {isSyncing ? 'Aktarılıyor...' : 'MDL Listemi Çek'}
              </button>
            </div>
          </div>

          {/* AniList Sync Card */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-[#38BDF8]/30 space-y-4">
            <div className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] w-fit">
              AniList GraphQL · Resmi Anime Senkronu
            </div>
            <h3 className="text-xl font-bold text-white">
              AniList Hesabını & Animelerini Eşitle
            </h3>
            <p className="text-xs text-white/65 leading-relaxed">
              AniList kullanıcı adını girerek tüm anime izleme geçmişini, puanlarını ve bölüm ilerlemeni KoUp arşivindeki 7.069 animeyle anında eşleştir.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={anilistUsername}
                onChange={(e) => setAnilistUsername(e.target.value)}
                placeholder="AniList Kullanıcı Adın (örn: Josh)"
                className="flex-1 px-4 py-2.5 rounded-full bg-black/60 border border-white/15 text-xs text-white"
              />
              <button
                onClick={() => handleExternalImport('anilist')}
                disabled={isSyncing}
                className="px-5 py-2.5 rounded-full bg-[#38BDF8] text-black font-bold text-xs cursor-pointer"
              >
                {isSyncing ? 'Eşitleniyor...' : 'AniList Senkronla'}
              </button>
            </div>
          </div>

          {syncResult && (
            <div className="md:col-span-2 rounded-3xl apple-glass p-6 border border-emerald-400/30">
              <h4 className="text-sm font-bold text-emerald-300 mb-3">
                ✓ {syncResult.username} ({syncResult.platform.toUpperCase()}) hesabından{' '}
                {syncResult.matchedCount} yapım başarıyla kütüphanene aktarıldı!
              </h4>
              <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
                {syncResult.matchedItems.map((item) => (
                  <AccordionMediaCard key={item.media.id} item={item.media} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PRIVACY & AUDIO NOTIFICATION SETTINGS */}
      {activeTab === 'settings' && user && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Privacy & Profile URL Customization */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-sky-400" />
              <span>Profil Gizliliği & Görsel URL Ayarları</span>
            </h3>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-bold text-white">
                  Gizli Profil (Private Mode)
                </div>
                <div className="text-[11px] text-white/55">
                  Açıldığında profilin ve istatistiklerin sadece sana görünür
                </div>
              </div>
              <input
                type="checkbox"
                checked={user.is_private}
                onChange={(e) =>
                  updateProfileSettings({ is_private: e.target.checked })
                }
                className="accent-sky-400 w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-bold text-white">
                  Sadece İzleme Geçmişimi Gizle
                </div>
                <div className="text-[11px] text-white/55">
                  Profilin açık kalır ancak izlediğin bölümler diğer kullanıcılara gizlenir
                </div>
              </div>
              <input
                type="checkbox"
                checked={user.hide_watch_history}
                onChange={(e) =>
                  updateProfileSettings({ hide_watch_history: e.target.checked })
                }
                className="accent-sky-400 w-4 h-4"
              />
            </label>

            <div>
              <label className="block text-xs text-white/60 mb-1">
                Avatar Görsel URL
              </label>
              <input
                type="url"
                defaultValue={user.avatar_url || ''}
                onBlur={(e) => updateProfileSettings({ avatar_url: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-white/60 mb-1">
                Profil Banner Görsel URL
              </label>
              <input
                type="url"
                defaultValue={user.banner_url || ''}
                onBlur={(e) => updateProfileSettings({ banner_url: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
          </div>

          {/* Web Audio Notification Chime Settings */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-amber-300" />
              <span>Canlı Sesli Bildirim & Sinema Modu Ayarları</span>
            </h3>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-bold text-white">
                  Bildirim Sesleri (Apple Glass Chime)
                </div>
                <div className="text-[11px] text-white/55">
                  Yeni bölüm veya yorum yanıtı geldiğinde kristal ses çalar
                </div>
              </div>
              <input
                type="checkbox"
                checked={user.notification_settings.sound_enabled}
                onChange={(e) =>
                  updateProfileSettings({
                    notification_settings: {
                      ...user.notification_settings,
                      sound_enabled: e.target.checked,
                    },
                  })
                }
                className="accent-amber-400 w-4 h-4"
              />
            </label>

            <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">Bildirim Ses Tonu</span>
                <button
                  type="button"
                  onClick={() =>
                    playNotificationChime(
                      user.notification_settings.sound_tone,
                      user.notification_settings.sound_volume,
                      false
                    )
                  }
                  className="px-3 py-1 rounded-full bg-amber-400 text-black font-bold text-[11px] cursor-pointer"
                >
                  🔊 Sesi Dene
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'apple_glass', label: 'Apple Glass' },
                    { id: 'soft_chime', label: 'Soft Chime' },
                    { id: 'minimal_pop', label: 'Minimal Pop' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      playNotificationChime(t.id, 0.7, false);
                      updateProfileSettings({
                        notification_settings: {
                          ...user.notification_settings,
                          sound_tone: t.id,
                        },
                      });
                    }}
                    className={`py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                      user.notification_settings.sound_tone === t.id
                        ? 'bg-white text-black border-white'
                        : 'bg-black/40 text-white/70 border-white/10'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-bold text-white">
                  Akıllı Sinema Modu (Tam Ekranda Sustur)
                </div>
                <div className="text-[11px] text-white/55">
                  Tam ekranda dizi/anime izlerken bildirim seslerini otomatik susturur
                </div>
              </div>
              <input
                type="checkbox"
                checked={user.notification_settings.mute_during_fullscreen}
                onChange={(e) =>
                  updateProfileSettings({
                    notification_settings: {
                      ...user.notification_settings,
                      mute_during_fullscreen: e.target.checked,
                    },
                  })
                }
                className="accent-sky-400 w-4 h-4"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
