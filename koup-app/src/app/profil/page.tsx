'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Heart,
  Clock,
  CheckCircle2,
  Bookmark,
  PauseCircle,
  XCircle,
  Lock,
  Globe,
  Download,
  Volume2,
  FolderPlus,
  Sparkles,
  LogIn,
  BarChart3,
  Library,
  FolderHeart,
  Zap,
  Settings,
  Activity,
  ChevronRight,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';

type ProfileTab = 'overview' | 'library' | 'lists' | 'import' | 'settings';

export default function ProfilePage() {
  const {
    user,
    profile,
    progressMap,
    personFavorites,
    soundEnabled,
    toggleSound,
    triggerSound,
    logout,
    setIsAuthModalOpen,
  } = useKoUp();

  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [libraryFilter, setLibraryFilter] = useState<string>('ALL');
  const [watchedMedia, setWatchedMedia] = useState<MediaItem[]>([]);
  const [favPeople, setFavPeople] = useState<PersonItem[]>([]);

  // MDL / AniList 1-Click Import state
  const [mdlUsername, setMdlUsername] = useState('');
  const [anilistUsername, setAnilistUsername] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Privacy toggles
  const [isPrivateProfile, setIsPrivateProfile] = useState(false);
  const [hideWatchHistory, setHideWatchHistory] = useState(false);

  // Custom Lists
  const [customLists, setCustomLists] = useState<
    Array<{ id: number; title: string; description: string; count: number }>
  >([
    {
      id: 1,
      title: 'Ağlatan Kore Dizileri Seçkim',
      description: 'Mendilsiz izlenmeyecek duygusal başyapıtlar',
      count: 8,
    },
  ]);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  // Auth Modal state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  useEffect(() => {
    async function loadUserMediaAndPeople() {
      const mIds = Object.keys(progressMap).map(Number);
      if (mIds.length > 0) {
        const { data: mRows } = await supabase
          .from('media')
          .select('*')
          .in('id', mIds);
        setWatchedMedia((mRows as MediaItem[]) || []);
      }

      if (personFavorites.length > 0) {
        const { data: pRows } = await supabase
          .from('people')
          .select('*')
          .in('id', personFavorites);
        setFavPeople((pRows as PersonItem[]) || []);
      } else {
        setFavPeople([]);
      }
    }

    loadUserMediaAndPeople();
  }, [progressMap, personFavorites]);

  const handleImport = async (source: 'mdl' | 'anilist') => {
    const username = source === 'mdl' ? mdlUsername.trim() : anilistUsername.trim();
    if (!username) return;
    setIsImporting(true);
    setImportStatus(null);
    triggerSound('click');

    try {
      const res = await fetch('/api/mdl-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, username }),
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

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    triggerSound('success');
    setCustomLists((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: newListTitle.trim(),
        description: newListDesc.trim() || 'Özel Koleksiyon',
        count: 0,
      },
    ]);
    setNewListTitle('');
    setNewListDesc('');
  };

  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return;
    setAuthStatus('Giriş yapılıyor...');
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput,
      password: passwordInput,
    });
    if (error) {
      const { error: signUpErr } = await supabase.auth.signUp({
        email: emailInput,
        password: passwordInput,
      });
      if (signUpErr) {
        setAuthStatus(`Uyarı: ${signUpErr.message}`);
      } else {
        setAuthStatus('Hesap oluşturuldu ve oturum açıldı.');
        setTimeout(() => setAuthModalOpen(false), 1200);
      }
    } else {
      setAuthStatus('Başarıyla giriş yapıldı.');
      setTimeout(() => setAuthModalOpen(false), 900);
    }
  };

  const heatmapWeeks = Array.from({ length: 26 }, () =>
    Array.from({ length: 7 }, () => 0)
  );

  const filteredWatchedMedia = watchedMedia.filter((m) => {
    if (libraryFilter === 'ALL') return true;
    return progressMap[m.id]?.status === libraryFilter;
  });

  const TABS: Array<{
    id: ProfileTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Genel Bakış & Drama DNA', icon: BarChart3 },
    { id: 'library', label: `Kütüphanem (${watchedMedia.length})`, icon: Library },
    { id: 'lists', label: `Özel Listelerim (${customLists.length})`, icon: FolderHeart },
    { id: 'import', label: 'MDL & AniList Tek Tıkla Aktarım', icon: Zap },
    { id: 'settings', label: 'Gizlilik & Ses Ayarları', icon: Settings },
  ];

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* PROFILE HERO BANNER (Clean Dark Slate, No Broken Avatar Image) */}
      <div className="rounded-3xl overflow-hidden bg-[#0f0f11] border border-white/[0.08] shadow-2xl">
        <div className="h-36 sm:h-48 bg-gradient-to-r from-[#141418] via-[#1c1c22] to-[#121215] relative overflow-hidden">
          <div className="absolute inset-0 cinema-vignette" />
        </div>

        <div className="px-6 sm:px-10 pb-8 -mt-12 relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            {/* Clean Avatar Circle — Fallback Icon if No Avatar URL */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#17171b] flex items-center justify-center shrink-0">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name || 'Kullanıcı'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-11 h-11 text-white/80" />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {user ? (user.display_name || user.username) : 'Misafir Sinema Üyesi'}
                </h1>
                {user ? (
                  <>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white/[0.06] text-white/65 border border-white/10">
                      @{user.username}
                    </span>
                    {user.role === 'admin' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                        SİSTEM YÖNETİCİSİ (ADMIN)
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-white/10 text-white/70 border border-white/10">
                        {user.role.toUpperCase()}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-white/60">
                    Oturum Açılmadı
                  </span>
                )}
                {user && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-white border border-white/15">
                    {isPrivateProfile ? (
                      <>
                        <Lock className="w-3 h-3" />
                        <span>Gizli Profil</span>
                      </>
                    ) : (
                      <>
                        <Globe className="w-3 h-3" />
                        <span>Herkese Açık Profil</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-white/60 max-w-xl">
                {user
                  ? (user.bio || 'K-Drama, C-Drama ve Anime tutkunu • KoUp Sinema Koleksiyoneri')
                  : 'Giriş yaparak izleme geçmişinizi, favorilerinizi ve özel listelerinizi tüm cihazlarınızda eşitleyebilirsiniz.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {user ? (
              <>
                <button
                  onClick={() => setActiveTab('settings')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full glass-pill text-xs font-semibold text-white hover:bg-white/15 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Ayarlar</span>
                </button>
                <button
                  onClick={() => logout()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30 text-xs font-semibold hover:bg-rose-500/30 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Çıkış Yap</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Giriş Yap / Kayıt Ol</span>
              </button>
            )}
          </div>
        </div>

        {/* NAVIGATION TABS WITH FLUID SPRING SLIDING PILL */}
        <div className="px-6 sm:px-10 pb-4 flex items-center gap-2 overflow-x-auto no-scrollbar border-t border-white/[0.06] pt-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  triggerSound('click');
                  setActiveTab(t.id);
                }}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active ? 'text-black' : 'glass-pill text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="profile-active-tab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT WITH SMOOTH ENTRY ANIMATION */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-8"
          >
            {/* Stats Bento Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/80">
                  Toplam İzlenen Bölüm
                </span>
                <div className="text-3xl font-extrabold text-emerald-400 mt-2">
                  {Object.values(progressMap).reduce((acc, p) => acc + (p.watched_episodes?.length || 0), 0)} Bölüm
                </div>
                <span className="text-xs text-white/45 mt-1 block">
                  K-Drama, C-Drama & Anime
                </span>
              </div>

              <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400/80">
                  Toplam Ekran Süresi
                </span>
                <div className="text-3xl font-extrabold text-sky-400 mt-2">
                  {(Object.values(progressMap).reduce((acc, p) => acc + (p.watched_episodes?.length || 0), 0) * 0.75).toFixed(1)} Saat
                </div>
                <span className="text-xs text-white/45 mt-1 block">
                  Gerçek izleme geçmişin
                </span>
              </div>

              <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400/80">
                  Tamamlanan Yapım
                </span>
                <div className="text-3xl font-extrabold text-purple-400 mt-2">
                  {Object.values(progressMap).filter((p) => p.status === 'completed').length}
                </div>
                <span className="text-xs text-white/45 mt-1 block">
                  Dizi, Anime & Sinema Filmi
                </span>
              </div>

              <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400/80">
                  Favori Oyuncu & Karakter
                </span>
                <div className="text-3xl font-extrabold text-rose-400 mt-2">
                  {personFavorites.length} Yıldız
                </div>
                <span className="text-xs text-white/45 mt-1 block">
                  MDL & AniList favorilerin
                </span>
              </div>
            </div>

            {/* Drama DNA + Favorite Stars */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-white/80" />
                  <h3 className="text-lg font-bold text-white">
                    Drama & Anime DNA • Ülke Dağılımı
                  </h3>
                </div>
                <div className="space-y-4">
                  {[
                    { label: 'Güney Kore (K-Drama)', code: 'KR', pct: 58 },
                    { label: 'Japonya (Anime & J-Drama)', code: 'JP', pct: 26 },
                    { label: 'Çin (C-Drama & Wuxia)', code: 'CN', pct: 12 },
                    { label: 'Tayland & Global', code: 'GL', pct: 4 },
                  ].map((row) => (
                    <div key={row.code} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-semibold text-white/85">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-white/60">
                            {row.code}
                          </span>
                          <span>{row.label}</span>
                        </span>
                        <span className="font-mono text-white/60">%{row.pct}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-white shadow-[0_0_8px_white]"
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Favorited Actors & Anime Characters */}
              <div className="lg:col-span-6 rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
                    <h3 className="text-lg font-bold text-white">
                      Favori Oyuncularım & Karakterlerim
                    </h3>
                  </div>
                  <Link
                    href="/oyuncular"
                    className="text-xs font-semibold text-white/70 hover:text-white flex items-center gap-1"
                  >
                    <span>Yıldız Keşfet</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {favPeople.length === 0 ? (
                  <div className="py-10 text-center text-xs text-white/45">
                    Oyuncular veya anime karakterleri sayfasından kalp butonuna tıklayarak favori yıldızlarını buraya ekleyebilirsin.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {favPeople.map((p) => (
                      <Link
                        key={p.id}
                        href={`/oyuncu/${p.slug}`}
                        className="flex items-center gap-2.5 p-2.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors"
                      >
                        <img
                          src={getProxiedImageUrl(p.image_url, p.name)}
                          alt={p.name}
                          className="w-11 h-11 rounded-full object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {p.name}
                          </div>
                          <div className="text-[10px] font-mono text-white/50">
                            {p.favorites_count + 1} Favori
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 365-Day Watch Activity Heatmap */}
            <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">
                  Yıllık İzleme Aktivite Haritası (Son 6 Ay)
                </h3>
                <span className="text-xs font-mono text-white/45">
                  Günlük Bölüm Yoğunluğu
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 no-scrollbar">
                {heatmapWeeks.map((week, wIdx) => (
                  <div key={wIdx} className="flex flex-col gap-1.5 shrink-0">
                    {week.map((lvl, dIdx) => (
                      <div
                        key={dIdx}
                        className={`w-3.5 h-3.5 rounded-sm transition-colors ${
                          lvl === 0
                            ? 'bg-white/[0.05]'
                            : lvl === 1
                              ? 'bg-emerald-500/25'
                              : lvl === 2
                                ? 'bg-emerald-500/50'
                                : lvl === 3
                                  ? 'bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.3)]'
                                  : 'bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                        }`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 2: LIBRARY (5 Watch States) */}
        {activeTab === 'library' && (
          <motion.div
            key="library"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              {[
                {
                  id: 'ALL',
                  label: 'Tümü',
                  icon: Sparkles,
                  iconColor: 'text-white',
                  activeClass: 'bg-white text-black font-bold shadow-[0_0_15px_rgba(255,255,255,0.3)]',
                  inactiveClass: 'glass-pill text-white/80 hover:text-white',
                },
                {
                  id: 'watching',
                  label: 'İzleniyor',
                  icon: Clock,
                  iconColor: 'text-emerald-400',
                  activeClass: 'bg-emerald-500 text-black font-bold shadow-[0_0_18px_rgba(16,185,129,0.45)]',
                  inactiveClass: 'glass-pill text-emerald-300/80 hover:text-emerald-200 border-emerald-500/20 hover:border-emerald-500/40',
                },
                {
                  id: 'completed',
                  label: 'Tamamlandı',
                  icon: CheckCircle2,
                  iconColor: 'text-sky-400',
                  activeClass: 'bg-sky-500 text-black font-bold shadow-[0_0_18px_rgba(14,165,233,0.45)]',
                  inactiveClass: 'glass-pill text-sky-300/80 hover:text-sky-200 border-sky-500/20 hover:border-sky-500/40',
                },
                {
                  id: 'plan_to_watch',
                  label: 'Planlanan',
                  icon: Bookmark,
                  iconColor: 'text-amber-400',
                  activeClass: 'bg-amber-400 text-black font-bold shadow-[0_0_18px_rgba(251,191,36,0.45)]',
                  inactiveClass: 'glass-pill text-amber-300/80 hover:text-amber-200 border-amber-500/20 hover:border-amber-500/40',
                },
                {
                  id: 'on_hold',
                  label: 'Beklemede',
                  icon: PauseCircle,
                  iconColor: 'text-purple-400',
                  activeClass: 'bg-purple-500 text-white font-bold shadow-[0_0_18px_rgba(168,85,247,0.45)]',
                  inactiveClass: 'glass-pill text-purple-300/80 hover:text-purple-200 border-purple-500/20 hover:border-purple-500/40',
                },
                {
                  id: 'dropped',
                  label: 'Bıraktım',
                  icon: XCircle,
                  iconColor: 'text-rose-400',
                  activeClass: 'bg-rose-500 text-white font-bold shadow-[0_0_18px_rgba(244,63,94,0.45)]',
                  inactiveClass: 'glass-pill text-rose-300/80 hover:text-rose-200 border-rose-500/20 hover:border-rose-500/40',
                },
              ].map((st) => {
                const Icon = st.icon;
                const active = libraryFilter === st.id;
                return (
                  <button
                    key={st.id}
                    onClick={() => {
                      triggerSound('click');
                      setLibraryFilter(st.id);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-all active:scale-[0.98] ${
                      active ? st.activeClass : st.inactiveClass
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? '' : st.iconColor}`} />
                    <span>{st.label}</span>
                  </button>
                );
              })}
            </div>

            {filteredWatchedMedia.length === 0 ? (
              <div className="rounded-3xl bg-[#0f0f11] p-14 text-center border border-white/10">
                <p className="text-sm text-white/60">
                  Bu izleme durumunda henüz kayıtlı bir dizi veya anime bulunmuyor.
                </p>
                <Link
                  href="/kesfet"
                  className="inline-block mt-4 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold"
                >
                  Katalogdan Yapım Ekle
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {filteredWatchedMedia.map((m) => (
                  <AccordionMediaCard key={m.id} item={m} />
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 3: CUSTOM LISTS */}
        {activeTab === 'lists' && (
          <motion.div
            key="lists"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-6"
          >
            <form
              onSubmit={handleCreateList}
              className="lg:col-span-4 rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] space-y-4 h-fit"
            >
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-white/80" />
                <span>Yeni Özel Koleksiyon Oluştur</span>
              </h3>
              <input
                type="text"
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                placeholder="Örn: En İyi Wuxia & Fantastik Seçkim"
                className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none"
              />
              <textarea
                value={newListDesc}
                onChange={(e) => setNewListDesc(e.target.value)}
                rows={3}
                placeholder="Koleksiyon açıklaması..."
                className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-full bg-white text-black text-xs font-bold cursor-pointer"
              >
                Koleksiyonu Kaydet
              </button>
            </form>

            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {customLists.map((lst) => (
                <div
                  key={lst.id}
                  className="koup-projection-card rounded-3xl p-6 flex flex-col justify-between"
                >
                  <div>
                    <span className="text-[10px] font-mono text-white/60 uppercase">
                      Herkese Açık Koleksiyon
                    </span>
                    <h4 className="text-lg font-bold text-white mt-1">
                      {lst.title}
                    </h4>
                    <p className="text-xs text-white/60 mt-1">
                      {lst.description}
                    </p>
                  </div>
                  <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono text-white/50">
                    <span>{lst.count} Yapım</span>
                    <span className="text-white/80">Paylaş →</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* TAB 4: 1-CLICK MDL & ANILIST WATCHLIST IMPORT */}
        {activeTab === 'import' && (
          <motion.div
            key="import"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {/* MyDramaList 1-Click Import */}
            <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4">
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-amber-400/15 text-amber-300 border border-amber-400/30">
                MyDramaList (MDL) • Şifresiz Açık Profil İçe Aktarma
              </span>
              <h3 className="text-xl font-bold text-white">
                MDL İzleme Listeni Tek Tıkla KoUp&apos;a Aktar
              </h3>
              <p className="text-xs text-white/65 leading-relaxed">
                MyDramaList şifreni vermene gerek kalmadan yalnızca kullanıcı adını girerek açık izleme listendeki K-Drama ve C-Drama puanlarını KoUp hesabına aktarabilirsin.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mdlUsername}
                  onChange={(e) => setMdlUsername(e.target.value)}
                  placeholder="MDL kullanıcı adın..."
                  className="flex-1 px-4 py-2.5 rounded-full bg-black/55 border border-white/15 text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => handleImport('mdl')}
                  disabled={isImporting}
                  className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>MDL&apos;den Çek</span>
                </button>
              </div>
            </div>

            {/* AniList GraphQL 1-Click Sync */}
            <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4">
              <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-sky-400/15 text-sky-300 border border-sky-400/30">
                AniList GraphQL • Resmi API Senkronizasyonu
              </span>
              <h3 className="text-xl font-bold text-white">
                AniList Anime Kütüphaneni Senkronize Et
              </h3>
              <p className="text-xs text-white/65 leading-relaxed">
                AniList kullanıcı adını girerek izlediğin animeleri, puanlarını ve bölüm ilerlemelerini doğrudan KoUp üzerindeki 7.069 animeyle eşleştir.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={anilistUsername}
                  onChange={(e) => setAnilistUsername(e.target.value)}
                  placeholder="AniList kullanıcı adın..."
                  className="flex-1 px-4 py-2.5 rounded-full bg-black/55 border border-white/15 text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => handleImport('anilist')}
                  disabled={isImporting}
                  className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>AniList&apos;ten Çek</span>
                </button>
              </div>
            </div>

            {importStatus && (
              <div className="md:col-span-2 p-4 rounded-2xl bg-white/[0.06] border border-white/20 text-xs font-mono text-white">
                {importStatus}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 5: PRIVACY & SOUND MICRO-INTERACTION SETTINGS */}
        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] max-w-2xl space-y-6"
          >
            <h3 className="text-lg font-bold text-white">
              Profil Gizliliği & Arayüz Deneyimi Ayarları
            </h3>

            <div className="space-y-4">
              <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
                <div>
                  <div className="text-sm font-bold text-white">
                    Gizli Profil Modu (Private Account)
                  </div>
                  <div className="text-xs text-white/55">
                    Açıldığında profil sayfanı yalnızca sen görebilirsin.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isPrivateProfile}
                  onChange={(e) => setIsPrivateProfile(e.target.checked)}
                  className="w-5 h-5 accent-white"
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
                <div>
                  <div className="text-sm font-bold text-white">
                    İzleme Geçmişimi & Kütüphanemi Gizle
                  </div>
                  <div className="text-xs text-white/55">
                    Profilin açık kalsın ama izlediğin diziler diğer kullanıcılara görünmesin.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={hideWatchHistory}
                  onChange={(e) => setHideWatchHistory(e.target.checked)}
                  className="w-5 h-5 accent-white"
                />
              </label>

              <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer">
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-white/80" />
                    <span>Arayüz Sesli Mikro-Etkileşimleri (Web Audio API)</span>
                  </div>
                  <div className="text-xs text-white/55">
                    Kart açılışlarında ve buton tıklamalarında ince akustik ses efektleri.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={toggleSound}
                  className="w-5 h-5 accent-white"
                />
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SUPABASE AUTH MODAL */}
      <AnimatePresence>
        {authModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.form
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onSubmit={handleSupabaseLogin}
              className="w-full max-w-md rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/15 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">
                  KoUp Hesap Girişi / Kayıt
                </h3>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="text-xs text-white/50 hover:text-white cursor-pointer"
                >
                  Kapat
                </button>
              </div>
              <p className="text-xs text-white/60">
                Tüm cihazlarınız arasında izleme geçmişi ve favori listelerinizi anında senkronize edin.
              </p>
              <input
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="E-posta adresin..."
                className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
              />
              <input
                type="password"
                required
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Şifren (en az 6 karakter)..."
                className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
              />
              {authStatus && (
                <div className="text-xs font-mono text-white/80">{authStatus}</div>
              )}
              <button
                type="submit"
                className="w-full py-3 rounded-full bg-white text-black font-bold text-xs cursor-pointer"
              >
                Giriş Yap / Kayıt Ol
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
