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
  FileText,
  X,
  Laptop,
  Smartphone,
  Tablet,
  Monitor,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  Sliders,
  Compass,
  Play,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import { supabase } from '@/lib/supabase';
import { getProxiedImageUrl } from '@/lib/supabase';
import {
  fetchUserDevices,
  terminateDeviceSession,
  terminateAllOtherDevices,
  UserDevice,
} from '@/lib/deviceTracker';


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
    refreshUserLibrary,
    deviceFingerprint,
    navbarBehavior,
    setNavbarBehavior,
    floatingNavbarEnabled,
    setFloatingNavbarEnabled,
    autoCardTrailerEnabled,
    setAutoCardTrailerEnabled,
  } = useKoUp();

  // Settings form states
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarUrl, setEditAvatarUrl] = useState('');
  const [editBannerUrl, setEditBannerUrl] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editHideWatchHistory, setEditHideWatchHistory] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  // Active Devices & Session Security state
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [deviceActionMsg, setDeviceActionMsg] = useState<string | null>(null);

  // MDL / AniList / Text 1-Click Import state
  const [mdlUsername, setMdlUsername] = useState('');
  const [anilistUsername, setAnilistUsername] = useState('');
  const [customTextTitles, setCustomTextTitles] = useState('');
  const [importTab, setImportTab] = useState<'username' | 'text'>('username');
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
      setEditBannerUrl(user.banner_url || '');
      setEditIsPrivate(Boolean(user.is_private));
      setEditHideWatchHistory(Boolean(user.hide_watch_history));
    }
  }, [user]);

  // Load registered active devices
  const loadDevices = async () => {
    if (!user?.id) return;
    setIsLoadingDevices(true);
    try {
      const list = await fetchUserDevices(user.id, deviceFingerprint);
      setDevices(list);
    } catch {
      // ignore
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (user?.id) {
      loadDevices();
    } else {
      setDevices([]);
    }
  }, [user?.id, deviceFingerprint]);

  const handleTerminateDevice = async (deviceId: string) => {
    if (!user?.id) return;
    triggerSound('click');
    const success = await terminateDeviceSession(deviceId, user.id);
    if (success) {
      triggerSound('success');
      setDeviceActionMsg('Cihaz oturumu başarıyla kapatıldı.');
      setTimeout(() => setDeviceActionMsg(null), 3500);
      setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));
    }
  };

  const handleTerminateAllOthers = async () => {
    if (!user?.id) return;
    triggerSound('click');
    const curFp = deviceFingerprint || (typeof window !== 'undefined' ? localStorage.getItem('koup_device_fingerprint_v1') || '' : '');
    const success = await terminateAllOtherDevices(user.id, curFp);
    if (success) {
      triggerSound('success');
      setDeviceActionMsg('Diğer tüm cihaz oturumları kapatıldı.');
      setTimeout(() => setDeviceActionMsg(null), 3500);
      setDevices((prev) => prev.filter((d) => d.device_id === curFp || d.is_current));
    }
  };

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
        banner_url: editBannerUrl.trim() || null,
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

  // MDL / AniList / Text Import Handler
  const handleImport = async (source: 'mdl' | 'anilist' | 'text') => {
    let uname = '';
    let textBody = '';
    if (source === 'mdl') uname = mdlUsername.trim();
    else if (source === 'anilist') uname = anilistUsername.trim();
    else if (source === 'text') textBody = customTextTitles.trim();

    if (source !== 'text' && !uname) return;
    if (source === 'text' && !textBody) return;

    setIsImporting(true);
    setImportStatus(null);
    triggerSound('click');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch('/api/mdl-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          platform: source,
          source,
          username: uname || undefined,
          text: textBody || undefined,
          userId: user?.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSound('success');
        setImportStatus(
          `${data.message} (${data.matchedCount} yapım KoUp kütüphanenize başarıyla bağlandı)`
        );
        if (source === 'text') {
          setCustomTextTitles('');
        }
        await refreshUserLibrary();
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
      <div className="pt-28 pb-24 max-w-4xl mx-auto px-5 sm:px-8 space-y-8">
        <div className="rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-6 sm:p-8 text-center space-y-4 shadow-xl backdrop-blur-2xl">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <Settings className="w-8 h-8 text-sky-400" />
          </div>

          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Ayarlar & Tercihler
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-md mx-auto">
              Profil bilgilerinizi, izleme aktarımlarını ve hesap güvenliğinizi yönetmek için lütfen giriş yapın. Cihaz arayüz tercihlerinizi aşağıdan doğrudan özelleştirebilirsiniz.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full sm:w-auto mx-auto py-2.5 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>
        </div>

        {/* SECTION: PREFERENCES (Arayüz & İzleme Tercihleri) */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-6 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400" />
              <span>Arayüz & İzleme Tercihleri</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Sayfa kaydırma davranışlarını, üst bar animasyonunu ve kart önizleme seçeneklerini kişiselleştirin.
            </p>
          </div>

          <div className="space-y-4">
            {/* 1. Üst Bar (Navbar) Davranışı */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-400" />
                    <span>Üst Menü (Navbar) Kaydırma Davranışı</span>
                  </div>
                  <div className="text-xs text-white/55 mt-0.5">
                    Sayfayı aşağı kaydırdığınızda üst menünün nasıl davranacağını seçin.
                  </div>
                </div>

                {/* Segmented Switch with 3 Options and Fluid Spring Pill */}
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-black/40 border border-white/10 shrink-0 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('floating');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'floating'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'floating' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-unauth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Ayrılan Yüzen Bar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('sticky');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'sticky'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'sticky' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-unauth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Sabit Klasik Bar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('static');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'static'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'static' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-unauth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Yukarıda Kalan Bar</span>
                  </button>
                </div>
              </div>
              <div className="text-[11px] text-white/45 flex items-center gap-1.5 pt-1 border-t border-white/5">
                <span className="font-medium text-white/70">
                  {navbarBehavior === 'floating'
                    ? '✨ Aktif Mod:'
                    : navbarBehavior === 'sticky'
                    ? '📌 Aktif Mod:'
                    : '🔝 Aktif Mod:'}
                </span>
                <span>
                  {navbarBehavior === 'floating'
                    ? 'Sayfa aşağı kaydırıldığında üst bar kenarlardan ayrılarak yüzen şık bir ada (dock) haline gelir ve ekranda sizinle kalır.'
                    : navbarBehavior === 'sticky'
                    ? 'Üst bar sayfanın en üstünde tam genişlikte sabit durur; aşağı kaydırdıkça ekranın tepesinde sizinle gelmeye devam eder.'
                    : 'Üst bar sitenin en üstüne sabittir (bize değil). Sayfayı aşağı kaydırdığınızda sizinle gelmez, sayfanın başında yukarıda kalır.'}
                </span>
              </div>
            </div>

            {/* 2. Seri ve Film Kartlarında Otomatik Fragman Önizleme */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Play className="w-4 h-4 text-sky-400" />
                  <span>Seri & Film Kartlarında Otomatik Fragman</span>
                </div>
                <div className="text-xs text-white/55 mt-0.5">
                  Kartların üzerinde fareyle durulduğunda arka planda otomatik video fragmanının başlamasını kontrol edin.
                </div>
              </div>

              {/* iOS / Apple Style Toggle Switch */}
              <button
                type="button"
                onClick={() => {
                  triggerSound('click');
                  setAutoCardTrailerEnabled(!autoCardTrailerEnabled);
                }}
                role="switch"
                aria-checked={autoCardTrailerEnabled}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoCardTrailerEnabled ? 'bg-sky-500' : 'bg-white/20'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    autoCardTrailerEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
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
                src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username, null, 'w185', 'person')}
                alt=""
                loading="lazy"
                decoding="async"
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
                className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
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
                className="w-full px-4 py-2.5 rounded-2xl bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all resize-none font-medium"
              />
            </div>

            {/* Avatar URL */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/80">
                Profil Fotoğrafı URL
              </label>
              <input
                type="url"
                value={editAvatarUrl}
                onChange={(e) => setEditAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
              />
            </div>

            {/* Banner (Thumbnail) URL */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-white/80 flex items-center justify-between">
                <span>Kapak Görseli / Banner (Thumbnail) URL</span>
                <span className="text-[10px] font-mono text-white/40">Sinematik Atmosfer</span>
              </label>
              <input
                type="url"
                value={editBannerUrl}
                onChange={(e) => setEditBannerUrl(e.target.value)}
                placeholder="https://... (Geniş yatay kapak görseli linki)"
                className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
              />
              <p className="text-[11px] text-white/45">
                Profil sayfanızın en arkasında sinematik, hafif blurlu ve atmosferik bir ışık kaynağı olarak yayılır.
              </p>
              {editBannerUrl.trim() && (
                <div className="relative h-28 rounded-2xl overflow-hidden border border-white/15 bg-black/40 mt-2">
                  <img
                    src={getProxiedImageUrl(editBannerUrl.trim(), 'banner-preview', null, 'original', 'banner')}
                    alt="Kapak Önizleme"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-3">
                    <span className="text-[10px] font-mono text-white/80 bg-black/60 px-2.5 py-0.5 rounded-full border border-white/10">
                      Canlı Kapak Önizlemesi
                    </span>
                  </div>
                </div>
              )}
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

          {/* Import Mode Tabs with Fluid Spring Sliding Pill */}
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/[0.04] border border-white/10 w-fit">
            <button
              type="button"
              onClick={() => {
                triggerSound('click');
                setImportTab('username');
              }}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                importTab === 'username'
                  ? 'text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {importTab === 'username' && (
                <motion.span
                  layoutId="ayarlar-import-tab-pill"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                  className="absolute inset-0 rounded-full bg-white shadow-md"
                />
              )}
              <Zap className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">Platform Kullanıcı Adı ile</span>
            </button>
            <button
              type="button"
              onClick={() => {
                triggerSound('click');
                setImportTab('text');
              }}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                importTab === 'text'
                  ? 'text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {importTab === 'text' && (
                <motion.span
                  layoutId="ayarlar-import-tab-pill"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                  className="absolute inset-0 rounded-full bg-white shadow-md"
                />
              )}
              <FileText className="w-3.5 h-3.5 relative z-10" />
              <span className="relative z-10">Dizi İsimlerini Yapıştırarak</span>
            </button>
          </div>

          {importTab === 'username' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* MDL Box */}
              <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="text-xs font-bold text-amber-300">MyDramaList (MDL)</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                    Otomatik Scraper
                  </span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Açık MDL kullanıcı adınızı veya dramalist linkinizi giriniz (gizli profiller için yan sekmeden dizi isimlerini yapıştırabilirsiniz):
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mdlUsername}
                    onChange={(e) => setMdlUsername(e.target.value)}
                    placeholder="MDL kullanıcı adı veya linki..."
                    className="flex-1 px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-amber-400/60 focus:ring-2 focus:ring-amber-400/20 focus:shadow-[0_0_16px_rgba(251,191,36,0.25)] transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => handleImport('mdl')}
                    disabled={isImporting}
                    className="px-4 py-2.5 rounded-full bg-amber-400 text-black font-bold text-xs hover:bg-amber-300 transition-all cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1.5 shadow-md"
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
                  Anime kütüphanenizi ve bölüm ilerlemenizi senkronize etmek için AniList kullanıcı adınızı girin:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={anilistUsername}
                    onChange={(e) => setAnilistUsername(e.target.value)}
                    placeholder="AniList kullanıcı adı..."
                    className="flex-1 px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => handleImport('anilist')}
                    disabled={isImporting}
                    className="px-4 py-2.5 rounded-full bg-sky-400 text-black font-bold text-xs hover:bg-sky-300 transition-all cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1.5 shadow-md"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isImporting ? '...' : 'Aktar'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-white">Dizi & Anime İsimlerini Doğrudan Yapıştır</span>
                </div>
                <span className="text-[10px] font-mono text-sky-400/80 bg-sky-400/10 px-2 py-0.5 rounded-full border border-sky-400/20">
                  %100 Doğrulanmış Eşleşme
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Her satıra bir yapım adı yazarak veya MDL / Word / Not Defteri listenizi kopyalayıp yapıştırarak KoUp kütüphanenize anında bağlayabilirsiniz:
              </p>
              <textarea
                value={customTextTitles}
                onChange={(e) => setCustomTextTitles(e.target.value)}
                rows={5}
                placeholder="Örnek:&#10;Guardian: The Lonely and Great God&#10;Reply 1988&#10;Goblin&#10;Crash Landing on You&#10;Alchemy of Souls"
                className="w-full px-4 py-3 rounded-2xl bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] font-mono transition-all resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleImport('text')}
                  disabled={isImporting || !customTextTitles.trim()}
                  className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2 shadow-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isImporting ? 'Yapımlar Eşleştiriliyor...' : 'Listeyi Kütüphaneme Aktar'}</span>
                </button>
              </div>
            </div>
          )}

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

        {/* SECTION 4: PREFERENCES (Arayüz & İzleme Tercihleri) */}
        <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-6 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400" />
              <span>Arayüz & İzleme Tercihleri</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Sayfa kaydırma davranışlarını, üst bar animasyonunu ve kart önizleme seçeneklerini kişiselleştirin.
            </p>
          </div>

          <div className="space-y-4">
            {/* 1. Üst Bar (Navbar) Davranışı */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-400" />
                    <span>Üst Menü (Navbar) Kaydırma Davranışı</span>
                  </div>
                  <div className="text-xs text-white/55 mt-0.5">
                    Sayfayı aşağı kaydırdığınızda üst menünün nasıl davranacağını seçin.
                  </div>
                </div>

                {/* Segmented Switch with 3 Options and Fluid Spring Pill */}
                <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-full bg-black/40 border border-white/10 shrink-0 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('floating');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'floating'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'floating' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-auth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Ayrılan Yüzen Bar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('sticky');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'sticky'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'sticky' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-auth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Sabit Klasik Bar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerSound('click');
                      setNavbarBehavior('static');
                    }}
                    className={`relative px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                      navbarBehavior === 'static'
                        ? 'text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {navbarBehavior === 'static' && (
                      <motion.span
                        layoutId="ayarlar-navbar-behavior-pill-auth"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.6 }}
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                      />
                    )}
                    <span className="relative z-10">Yukarıda Kalan Bar</span>
                  </button>
                </div>
              </div>
              <div className="text-[11px] text-white/45 flex items-center gap-1.5 pt-1 border-t border-white/5">
                <span className="font-medium text-white/70">
                  {navbarBehavior === 'floating'
                    ? '✨ Aktif Mod:'
                    : navbarBehavior === 'sticky'
                    ? '📌 Aktif Mod:'
                    : '🔝 Aktif Mod:'}
                </span>
                <span>
                  {navbarBehavior === 'floating'
                    ? 'Sayfa aşağı kaydırıldığında üst bar kenarlardan ayrılarak yüzen şık bir ada (dock) haline gelir ve ekranda sizinle kalır.'
                    : navbarBehavior === 'sticky'
                    ? 'Üst bar sayfanın en üstünde tam genişlikte sabit durur; aşağı kaydırdıkça ekranın tepesinde sizinle gelmeye devam eder.'
                    : 'Üst bar sitenin en üstüne sabittir (bize değil). Sayfayı aşağı kaydırdığınızda sizinle gelmez, sayfanın başında yukarıda kalır.'}
                </span>
              </div>
            </div>

            {/* 2. Seri ve Film Kartlarında Otomatik Fragman Önizleme */}
            <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Play className="w-4 h-4 text-sky-400" />
                  <span>Seri & Film Kartlarında Otomatik Fragman</span>
                </div>
                <div className="text-xs text-white/55 mt-0.5">
                  Kartların üzerinde fareyle durulduğunda arka planda otomatik video fragmanının başlamasını kontrol edin.
                </div>
              </div>

              {/* iOS / Apple Style Toggle Switch */}
              <button
                type="button"
                onClick={() => {
                  triggerSound('click');
                  setAutoCardTrailerEnabled(!autoCardTrailerEnabled);
                }}
                role="switch"
                aria-checked={autoCardTrailerEnabled}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoCardTrailerEnabled ? 'bg-sky-500' : 'bg-white/20'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    autoCardTrailerEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 5: SOUND & MICRO-INTERACTIONS */}
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
              <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
                <input
                  type="text"
                  value={blockedSearchQuery}
                  onChange={(e) => setBlockedSearchQuery(e.target.value)}
                  placeholder="Engellenen ara..."
                  className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
                />
                {blockedSearchQuery && (
                  <button
                    onClick={() => setBlockedSearchQuery('')}
                    className="text-white/40 hover:text-white transition-colors cursor-pointer"
                    aria-label="Aramayı temizle"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
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

      {/* SECTION: AKTİF CİHAZLAR & OTURUM GÜVENLİĞİ */}
      <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Laptop className="w-4 h-4 text-sky-400" />
              <span>Aktif Cihazlar & Oturum Güvenliği ({devices.length})</span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              KoUp hesabınıza bağlı tüm cihazlar ve son etkinlik zamanları. Tanımadığınız cihazları tek tıkla sonlandırabilirsiniz.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                triggerSound('click');
                loadDevices();
              }}
              disabled={isLoadingDevices}
              className="p-2.5 rounded-full bg-white/[0.04] border border-white/10 hover:border-white/20 text-white/70 hover:text-white transition-all cursor-pointer disabled:opacity-50"
              title="Yenile"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevices ? 'animate-spin text-sky-400' : ''}`} />
            </button>

            {devices.filter((d) => !d.is_current).length > 0 && (
              <button
                type="button"
                onClick={handleTerminateAllOthers}
                className="px-4 py-2 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Diğer Cihazları Kapat</span>
              </button>
            )}
          </div>
        </div>

        {deviceActionMsg && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-mono flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{deviceActionMsg}</span>
          </div>
        )}

        {isLoadingDevices && devices.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-white/40 font-mono">Cihazlar taranıyor...</span>
          </div>
        ) : devices.length === 0 ? (
          <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-xs text-white/40 text-center font-mono">
            Kayıtlı aktif oturum bilgisi bulunmuyor.
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map((d) => {
              const isCurrent = Boolean(d.is_current);
              const isMob = d.device_type === 'mobile';
              const isTab = d.device_type === 'tablet';

              return (
                <div
                  key={d.id || d.device_id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl transition-all gap-4 border ${
                    isCurrent
                      ? 'bg-sky-500/[0.04] border-sky-500/30 shadow-[0_0_20px_rgba(14,165,233,0.06)]'
                      : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                        isCurrent
                          ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                          : 'bg-white/5 border-white/10 text-white/60'
                      }`}
                    >
                      {isMob ? (
                        <Smartphone className="w-5 h-5" />
                      ) : isTab ? (
                        <Tablet className="w-5 h-5" />
                      ) : (
                        <Monitor className="w-5 h-5" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {d.device_name || 'Bilinmeyen Cihaz'}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Bu Cihaz (Mevcut)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-white/45 flex-wrap font-mono">
                        <span>{d.browser || 'Tarayıcı'}</span>
                        <span>•</span>
                        <span>{d.os || 'İşletim Sistemi'}</span>
                        {d.ip && (
                          <>
                            <span>•</span>
                            <span className="text-white/60">IP: {d.ip}</span>
                          </>
                        )}
                      </div>
                      <div className="text-[10px] text-white/35 font-mono">
                        Son Etkinlik: {d.last_active_at ? new Date(d.last_active_at).toLocaleString('tr-TR') : 'Şimdi'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {isCurrent ? (
                      <span className="text-[11px] font-mono text-white/40 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10">
                        Aktif Oturum
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleTerminateDevice(d.device_id)}
                        className="px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 text-xs font-semibold cursor-pointer transition-all"
                      >
                        Oturumu Kapat
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
