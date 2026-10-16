'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings,
  User,
  Lock,
  Clock,
  Volume2,
  Zap,
  Download,
  UserX,
  Search,
  Check,
  ChevronLeft,
  ExternalLink,
  ShieldCheck,
  LogOut,
  Sparkles,
  LogIn,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import { getProxiedImageUrl } from '@/lib/supabase';

const AVATAR_PRESETS = [
  { name: 'K-Drama Protagonist', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
  { name: 'Anime Director', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
  { name: 'Cinema Collector', url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80' },
  { name: 'Neo Seoul Vibe', url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&auto=format&fit=crop&q=80' },
  { name: 'Midnight Streamer', url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&auto=format&fit=crop&q=80' },
];

export default function SettingsPage() {
  const router = useRouter();
  const {
    user,
    soundEnabled,
    toggleSound,
    triggerSound,
    logout,
    setIsAuthModalOpen,
    updateProfileSettings,
    blockedUsers,
    unblockUser,
  } = useKoUp();

  // Settings form states
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editHideWatchHistory, setEditHideWatchHistory] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  // MDL / AniList 1-Click Import state
  const [mdlUsername, setMdlUsername] = useState('');
  const [anilistUsername, setAnilistUsername] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Blocked users search
  const [blockedSearchQuery, setBlockedSearchQuery] = useState('');

  // Initial populate from user
  useEffect(() => {
    if (user) {
      setEditDisplayName(user.display_name || '');
      setEditBio(user.bio || '');
      setEditAvatarUrl(user.avatar_url || '');
      setEditIsPrivate(Boolean(user.is_private));
      setEditHideWatchHistory(Boolean(user.hide_watch_history));
    }
  }, [user]);

  // Save Settings Handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSavingSettings(true);
    setSettingsStatus(null);
    triggerSound('click');

    try {
      await updateProfileSettings({
        display_name: editDisplayName.trim() || undefined,
        bio: editBio.trim() || undefined,
        avatar_url: editAvatarUrl.trim() || undefined,
        is_private: editIsPrivate,
        hide_watch_history: editHideWatchHistory,
      });

      triggerSound('success');
      setSettingsStatus('Ayarlarınız başarıyla kaydedildi.');
      setTimeout(() => setSettingsStatus(null), 3500);
    } catch {
      setSettingsStatus('Ayarlar kaydedilirken bir hata oluştu.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // MDL / AniList Import Handler
  const handleImport = async (source: 'mdl' | 'anilist') => {
    const uname = source === 'mdl' ? mdlUsername.trim() : anilistUsername.trim();
    if (!uname) return;
    setIsImporting(true);
    setImportStatus(null);
    triggerSound('click');

    try {
      const res = await fetch('/api/mdl-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, username: uname }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSound('success');
        setImportStatus(
          `${data.message} (${data.matchedCount} yapım KoUp kütüphanenize bağlandı)`
        );
      } else {
        setImportStatus(`Hata: ${data.error || 'İçe aktarım başarısız'}`);
      }
    } catch {
      setImportStatus('Bağlantı hatası oluştu.');
    } finally {
      setIsImporting(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-2xl">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Settings className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Ayarlar & Gizlilik
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              Hesap tercihlerinizi, gizlilik modunu ve izleme aktarımlarını yönetmek için lütfen giriş yapın.
            </p>
          </div>

          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-4xl mx-auto px-5 sm:px-8 space-y-8">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div className="space-y-1">
          <Link
            href={`/profil/${encodeURIComponent(user.username)}`}
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-medium transition-colors mb-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Profilimi Görüntüle</span>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Settings className="w-7 h-7 text-sky-400" />
            <span>Ayarlar & Gizlilik</span>
          </h1>
          <p className="text-xs sm:text-sm text-white/55">
            Kişisel profil detaylarınızı, görünümünüzü, izleme aktarımlarını ve gizlilik tercihlerinizi düzenleyin.
          </p>
        </div>

        {/* Quick Profile Summary Badge */}
        <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 self-start sm:self-auto">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
            {user.avatar_url ? (
              <img
                src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username)}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4 text-white/70" />
            )}
          </div>
          <div className="min-w-0 pr-2">
            <div className="text-xs font-bold text-white truncate max-w-[140px]">
              {user.display_name || user.username}
            </div>
            <div className="text-[10px] font-mono text-white/50 truncate">
              @{user.username}
            </div>
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="space-y-8">
        {/* SECTION 1: IDENTITY & APPEARANCE */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-6 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <User className="w-4 h-4 text-sky-400" />
              <span>Kimlik & Profil Görünümü</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Profil sayfanızda diğer kullanıcılara görünen adınız, biyografiniz ve avatarınız.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white/80">
                Görünen Ad (Display Name)
              </label>
              <input
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="Örn: Sinema Sever"
                className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-white/80">
                Biyografi
              </label>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                placeholder="Favori türleriniz, izleme hedefleriniz, sinema tutkunuz..."
                className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
              />
            </div>

            {/* Avatar URL & Presets */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/80">
                Profil Fotoğrafı URL veya Hazır Seçenekler
              </label>
              <input
                type="url"
                value={editAvatarUrl}
                onChange={(e) => setEditAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
              />

              <div className="pt-2">
                <span className="text-[11px] text-white/45 block mb-2 font-mono">
                  Hızlı Seçim Koleksiyonu:
                </span>
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                  {AVATAR_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        setEditAvatarUrl(preset.url);
                      }}
                      className={`w-12 h-12 rounded-2xl overflow-hidden border-2 transition-all cursor-pointer shrink-0 ${
                        editAvatarUrl === preset.url
                          ? 'border-sky-400 ring-2 ring-sky-400/30'
                          : 'border-white/15 opacity-60 hover:opacity-100'
                      }`}
                      title={preset.name}
                    >
                      <img
                        src={preset.url}
                        alt={preset.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: 1-CLICK WATCHLIST IMPORT (MDL & ANILIST) */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-5 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-sky-400" />
              <span>İzleme Listesi Aktarım Merkezi (MDL & AniList)</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Diğer platformlardaki izleme geçmişinizi, puanlarınızı ve bölümlerinizi tek tıkla KoUp arşivinize aktarın.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* MDL Box */}
            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span className="text-xs font-bold text-amber-300">MyDramaList (MDL)</span>
                </div>
                <span className="text-[10px] font-mono text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                  Şifresiz
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed">
                K-Drama ve C-Drama listeni aktarmak için yalnızca açık MDL kullanıcı adını gir:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mdlUsername}
                  onChange={(e) => setMdlUsername(e.target.value)}
                  placeholder="MDL kullanıcı adı..."
                  className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400/50"
                />
                <button
                  type="button"
                  onClick={() => handleImport('mdl')}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 transition-all cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isImporting ? '...' : 'Aktar'}</span>
                </button>
              </div>
            </div>

            {/* AniList Box */}
            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                  <span className="text-xs font-bold text-sky-300">AniList GraphQL</span>
                </div>
                <span className="text-[10px] font-mono text-sky-400/80 bg-sky-400/10 px-2 py-0.5 rounded-full border border-sky-400/20">
                  API Senkron
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Anime kütüphaneni ve bölüm ilerlemeni senkronize etmek için AniList kullanıcı adını gir:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={anilistUsername}
                  onChange={(e) => setAnilistUsername(e.target.value)}
                  placeholder="AniList kullanıcı adı..."
                  className="flex-1 px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
                />
                <button
                  type="button"
                  onClick={() => handleImport('anilist')}
                  disabled={isImporting}
                  className="px-4 py-2 rounded-xl bg-sky-400 text-black font-bold text-xs hover:bg-sky-300 transition-all cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isImporting ? '...' : 'Aktar'}</span>
                </button>
              </div>
            </div>
          </div>

          {importStatus && (
            <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/30 text-xs font-mono text-sky-300 flex items-center gap-2">
              <Zap className="w-4 h-4 text-sky-400 shrink-0" />
              <span>{importStatus}</span>
            </div>
          )}
        </div>

        {/* SECTION 3: PRIVACY & VISIBILITY */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-sky-400" />
              <span>Gizlilik & Görünürlük Tercihleri</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Profilinizin diğer kullanıcılara nasıl görüneceğini kontrol edin.
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sky-400" />
                  <span>Gizli Profil Modu (Private Account)</span>
                </div>
                <div className="text-xs text-white/55 mt-0.5">
                  Açıldığında profil sayfanızdaki kütüphane ve listeleri yalnızca siz görebilirsiniz.
                </div>
              </div>
              <input
                type="checkbox"
                checked={editIsPrivate}
                onChange={(e) => setEditIsPrivate(e.target.checked)}
                className="w-5 h-5 accent-sky-400 cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-400" />
                  <span>İzleme Geçmişimi & Kütüphanemi Gizle</span>
                </div>
                <div className="text-xs text-white/55 mt-0.5">
                  Profiliniz açık kalsın ama izlediğiniz diziler diğer ziyaretçilere görünmesin.
                </div>
              </div>
              <input
                type="checkbox"
                checked={editHideWatchHistory}
                onChange={(e) => setEditHideWatchHistory(e.target.checked)}
                className="w-5 h-5 accent-sky-400 cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* SECTION 4: SOUND & MICRO-INTERACTIONS */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-sky-400" />
              <span>Arayüz Deneyimi & Sesler</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Sinematik arayüz ses efektlerini özelleştirin.
            </p>
          </div>

          <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-sky-400" />
                <span>Arayüz Sesli Mikro-Etkileşimleri (Web Audio API)</span>
              </div>
              <div className="text-xs text-white/55 mt-0.5">
                Kart açılışlarında ve buton tıklamalarında Apple TV+ tarzı ince akustik ses efektleri.
              </div>
            </div>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={toggleSound}
              className="w-5 h-5 accent-sky-400 cursor-pointer"
            />
          </label>
        </div>

        {/* SECTION 5: BLOCKED USERS MANAGEMENT */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                <span>Engellenen Kullanıcılar ({blockedUsers.length})</span>
              </h2>
              <p className="text-xs text-white/50 mt-0.5">
                Engellediğiniz kullanıcılar sizin yorumlarınızı göremez, siz de onların yorumlarını görmezsiniz. Profilinize erişimleri kısıtlanır.
              </p>
            </div>

            {blockedUsers.length > 0 && (
              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={blockedSearchQuery}
                  onChange={(e) => setBlockedSearchQuery(e.target.value)}
                  placeholder="Engellenen ara..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-full bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400"
                />
              </div>
            )}
          </div>

          {blockedUsers.length === 0 ? (
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-xs text-white/40 text-center font-mono">
              Henüz engellediğiniz bir kullanıcı bulunmuyor.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {blockedUsers
                .filter(
                  (u) =>
                    !blockedSearchQuery.trim() ||
                    u.username.toLowerCase().includes(blockedSearchQuery.toLowerCase()) ||
                    (u.display_name && u.display_name.toLowerCase().includes(blockedSearchQuery.toLowerCase()))
                )
                .map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/20 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                        {u.avatar_url ? (
                          <img
                            src={getProxiedImageUrl(u.avatar_url, u.username)}
                            alt={u.username}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-4 h-4 text-white/60" />
                        )}
                      </div>
                      <div className="min-w-0 truncate">
                        <div className="text-xs font-bold text-white truncate">
                          {u.display_name || u.username}
                        </div>
                        <div className="text-[10px] font-mono text-white/40 truncate">
                          @{u.username}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        unblockUser(u.id);
                      }}
                      className="px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs font-semibold cursor-pointer transition-all shrink-0 ml-2"
                    >
                      Engeli Kaldır
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* FEEDBACK & SUBMIT BUTTON */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          {settingsStatus ? (
            <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/30 text-xs text-sky-300 font-mono flex items-center gap-2">
              <Check className="w-4 h-4 text-sky-400" />
              <span>{settingsStatus}</span>
            </div>
          ) : (
            <span className="text-xs text-white/40">
              Değişikliklerin profilinizde geçerli olması için kaydetmeyi unutmayın.
            </span>
          )}

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="w-full sm:w-auto px-8 py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSavingSettings ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Kaydediliyor...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Ayarları Kaydet</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Danger / Logout Zone */}
      <div className="pt-8 border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold text-white/80">Oturumu Sonlandır</div>
          <div className="text-[11px] text-white/40">
            Cihazınızdaki mevcut oturumu güvenle kapatın.
          </div>
        </div>

        <button
          onClick={() => {
            triggerSound('click');
            logout();
            router.push('/');
          }}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold cursor-pointer transition-all self-start sm:self-auto"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Çıkış Yap</span>
        </button>
      </div>
    </div>
  );
}
