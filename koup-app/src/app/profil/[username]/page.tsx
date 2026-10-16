'use client';

import React, { use, useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
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
  ShieldCheck,
  Play,
  Check,
  Share2,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  UserProfile,
  getProxiedImageUrl,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';

type ProfileTab = 'overview' | 'library' | 'history' | 'lists' | 'import' | 'settings';

const AVATAR_PRESETS = [
  { name: 'K-Drama Protagonist', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
  { name: 'Anime Director', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
  { name: 'Cinema Collector', url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80' },
  { name: 'Neo Seoul Vibe', url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&auto=format&fit=crop&q=80' },
  { name: 'Midnight Streamer', url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&auto=format&fit=crop&q=80' },
];

function ProfileInnerContent({ targetUsername }: { targetUsername: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const {
    user,
    progressMap,
    continueWatchingList,
    personFavorites,
    soundEnabled,
    toggleSound,
    triggerSound,
    logout,
    setIsAuthModalOpen,
    updateProfileSettings,
  } = useKoUp();

  const [profileData, setProfileData] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Determine ownership
  const isOwner = Boolean(
    user && (
      user.username.toLowerCase() === targetUsername.toLowerCase() ||
      (profileData?.id && user.id === profileData.id)
    )
  );

  // Tab State
  const tabParam = searchParams.get('tab') as ProfileTab | null;
  const validTabs: ProfileTab[] = ['overview', 'library', 'history', 'lists', 'import', 'settings'];
  const initialTab: ProfileTab =
    tabParam && validTabs.includes(tabParam)
      ? (!isOwner && (tabParam === 'settings' || tabParam === 'import') ? 'overview' : tabParam)
      : 'overview';

  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [libraryFilter, setLibraryFilter] = useState<string>('ALL');
  const [watchedMedia, setWatchedMedia] = useState<MediaItem[]>([]);
  const [favPeople, setFavPeople] = useState<PersonItem[]>([]);

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
    {
      id: 2,
      title: 'Soluksuz İzlenen Gizem & Gerilim Animeleri',
      description: 'Zihin yoran ters köşeler ve kusursuz senaryolar',
      count: 5,
    },
  ]);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  // Sync tab with URL search parameter
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      if (!isOwner && (tabParam === 'settings' || tabParam === 'import')) {
        setActiveTab('overview');
      } else {
        setActiveTab(tabParam);
      }
    }
  }, [tabParam, isOwner]);

  const switchTab = (tab: ProfileTab) => {
    triggerSound('click');
    setActiveTab(tab);
    const url = `/profil/${encodeURIComponent(targetUsername)}${tab === 'overview' ? '' : `?tab=${tab}`}`;
    router.push(url, { scroll: false });
  };

  // Fetch profile from Supabase profiles table
  useEffect(() => {
    let isMounted = true;
    async function fetchProfile() {
      setIsLoadingProfile(true);
      try {
        const { data: dbUser } = await supabase
          .from('profiles')
          .select('*')
          .ilike('username', targetUsername)
          .maybeSingle();

        if (!isMounted) return;

        if (dbUser) {
          setProfileData(dbUser as UserProfile);
        } else if (user && user.username.toLowerCase() === targetUsername.toLowerCase()) {
          setProfileData(user);
        } else {
          // Graceful fallback profile
          setProfileData({
            id: `guest-${targetUsername}`,
            username: targetUsername,
            display_name: targetUsername,
            bio: 'K-Drama, C-Drama ve Anime tutkunu • KoUp Sinema Severi',
            avatar_url: null,
            banner_url: null,
            role: 'user',
            is_private: false,
            hide_watch_history: false,
            notification_settings: {
              sound_enabled: true,
              sound_tone: 'apple_glass',
              sound_volume: 0.7,
              mute_during_fullscreen: true,
              notify_new_episode: true,
              notify_followed_actor: true,
              notify_comment_reply: true,
              notify_list_activity: true,
            },
            stats_episodes_watched: 0,
            stats_series_completed: 0,
            stats_movies_completed: 0,
            stats_anime_completed: 0,
            stats_total_minutes: 0,
            mdl_username: null,
            anilist_username: null,
            anilist_auto_sync: false,
          });
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
        if (user && user.username.toLowerCase() === targetUsername.toLowerCase()) {
          setProfileData(user);
        }
      } finally {
        if (isMounted) setIsLoadingProfile(false);
      }
    }

    fetchProfile();
    return () => {
      isMounted = false;
    };
  }, [targetUsername, user]);

  // Sync settings form fields once profile data is ready
  useEffect(() => {
    const activeProf = isOwner && user ? user : profileData;
    if (activeProf) {
      setEditDisplayName(activeProf.display_name || '');
      setEditBio(activeProf.bio || '');
      setEditAvatarUrl(activeProf.avatar_url || '');
      setEditIsPrivate(Boolean(activeProf.is_private));
      setEditHideWatchHistory(Boolean(activeProf.hide_watch_history));
    }
  }, [profileData, isOwner, user]);

  // Load media and favorites
  useEffect(() => {
    async function loadMediaAndPeople() {
      if (isOwner) {
        const mIds = Object.keys(progressMap).map(Number).filter((n) => !isNaN(n));
        if (mIds.length > 0) {
          const { data: mRows } = await supabase
            .from('media')
            .select('*')
            .in('id', mIds);
          setWatchedMedia((mRows as MediaItem[]) || []);
        } else {
          setWatchedMedia([]);
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
      } else {
        // Visitor viewing public profile: load top featured or recent items for public showcase
        const { data: sampleMedia } = await supabase
          .from('media')
          .select('*')
          .limit(8);
        setWatchedMedia((sampleMedia as MediaItem[]) || []);
      }
    }

    loadMediaAndPeople();
  }, [isOwner, progressMap, personFavorites]);

  // Save Settings Handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
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

      setProfileData((prev) =>
        prev
          ? {
              ...prev,
              display_name: editDisplayName.trim() || prev.username,
              bio: editBio.trim() || null,
              avatar_url: editAvatarUrl.trim() || null,
              is_private: editIsPrivate,
              hide_watch_history: editHideWatchHistory,
            }
          : null
      );

      triggerSound('success');
      setSettingsStatus('Profil ayarlarınız başarıyla kaydedildi.');
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

  // Custom List Creator
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

  const currentDisplayProfile = isOwner && user ? user : profileData;
  const isPrivate = Boolean(currentDisplayProfile?.is_private);
  const hideHistory = Boolean(currentDisplayProfile?.hide_watch_history);

  // Filtered watched media
  const filteredWatchedMedia = watchedMedia.filter((m) => {
    if (libraryFilter === 'ALL') return true;
    return progressMap[m.id]?.status === libraryFilter;
  });

  // Calculate statistics
  const totalWatchedEpisodes = isOwner
    ? Object.values(progressMap).reduce((acc, p) => acc + (p.watched_episodes?.length || 0), 0)
    : currentDisplayProfile?.stats_episodes_watched || 0;

  const totalScreenHours = isOwner
    ? (totalWatchedEpisodes * 0.75).toFixed(1)
    : ((currentDisplayProfile?.stats_total_minutes || 0) / 60).toFixed(1);

  const totalCompleted = isOwner
    ? Object.values(progressMap).filter((p) => p.status === 'completed').length
    : currentDisplayProfile?.stats_series_completed || 0;

  // Heatmap simulation data (6 months)
  const heatmapWeeks = Array.from({ length: 26 }, () =>
    Array.from({ length: 7 }, () => 0)
  );

  // Tabs for owner vs visitor
  const TABS: Array<{
    id: ProfileTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = isOwner
    ? [
        { id: 'overview', label: 'Genel Bakış & Drama DNA', icon: BarChart3 },
        { id: 'library', label: `Kütüphanem (${watchedMedia.length})`, icon: Library },
        { id: 'history', label: 'İzleme Geçmişim', icon: Clock },
        { id: 'lists', label: `Özel Listelerim (${customLists.length})`, icon: FolderHeart },
        { id: 'import', label: 'MDL & AniList Tek Tıkla Aktarım', icon: Zap },
        { id: 'settings', label: 'Ayarlar & Gizlilik', icon: Settings },
      ]
    : [
        { id: 'overview', label: 'Genel Bakış & Drama DNA', icon: BarChart3 },
        { id: 'library', label: `Kütüphane (${watchedMedia.length})`, icon: Library },
        { id: 'history', label: 'İzleme Geçmişi', icon: Clock },
        { id: 'lists', label: `Listeler (${customLists.length})`, icon: FolderHeart },
      ];

  if (isLoadingProfile) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center pt-28">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-white/50 font-mono tracking-wider">Profil Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* PROFILE HERO BANNER */}
      <div className="rounded-3xl overflow-hidden bg-[#0f0f11] border border-white/[0.08] shadow-2xl">
        <div className="h-36 sm:h-52 bg-gradient-to-r from-[#101524] via-[#141b2d] to-[#0c101d] relative overflow-hidden">
          <div className="absolute inset-0 cinema-vignette" />
          <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 w-96 h-36 bg-blue-600/10 blur-2xl pointer-events-none" />
        </div>

        <div className="px-6 sm:px-10 pb-8 -mt-12 relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            {/* Clean Avatar Circle */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#17171b] flex items-center justify-center shrink-0">
              {currentDisplayProfile?.avatar_url ? (
                <img
                  src={getProxiedImageUrl(
                    currentDisplayProfile.avatar_url,
                    currentDisplayProfile.display_name || currentDisplayProfile.username
                  )}
                  alt={currentDisplayProfile.display_name || currentDisplayProfile.username}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-11 h-11 text-white/80" />
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {currentDisplayProfile?.display_name || currentDisplayProfile?.username || targetUsername}
                </h1>

                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white/[0.06] text-white/65 border border-white/10">
                  @{currentDisplayProfile?.username || targetUsername}
                </span>

                {currentDisplayProfile?.role === 'admin' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    <span>YÖNETİCİ (ADMIN)</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-white/10 text-white/70 border border-white/10">
                    {(currentDisplayProfile?.role || 'ÜYE').toUpperCase()}
                  </span>
                )}

                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-white border border-white/15">
                  {isPrivate ? (
                    <>
                      <Lock className="w-3 h-3 text-sky-400" />
                      <span>Gizli Profil</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3 h-3 text-sky-400" />
                      <span>Herkese Açık</span>
                    </>
                  )}
                </span>
              </div>

              <p className="text-xs sm:text-sm text-white/60 max-w-xl">
                {currentDisplayProfile?.bio ||
                  'K-Drama, C-Drama ve Anime tutkunu • KoUp Sinema Koleksiyoneri'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isOwner ? (
              <>
                <button
                  onClick={() => switchTab('settings')}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full glass-pill text-xs font-semibold text-white hover:bg-white/15 cursor-pointer transition-all"
                >
                  <Settings className="w-3.5 h-3.5 text-sky-400" />
                  <span>Ayarlar</span>
                </button>
                <button
                  onClick={() => logout()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30 text-xs font-semibold hover:bg-rose-500/30 cursor-pointer transition-all"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Çıkış Yap</span>
                </button>
              </>
            ) : !user ? (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Giriş Yap / Takip Et</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* NAVIGATION TABS WITH FLUID SPRING SLIDING PILL */}
        {(!isPrivate || isOwner) && (
          <div className="px-6 sm:px-10 pb-4 flex items-center gap-2 overflow-x-auto no-scrollbar border-t border-white/[0.06] pt-4">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => switchTab(t.id)}
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
        )}
      </div>

      {/* PRIVATE PROFILE STATE FOR VISITORS */}
      {isPrivate && !isOwner ? (
        <div className="rounded-3xl bg-[#0f0f11] p-12 sm:p-16 text-center border border-white/[0.08] space-y-4">
          <div className="w-16 h-16 rounded-full bg-sky-500/10 border border-sky-400/30 flex items-center justify-center mx-auto text-sky-400 shadow-[0_0_24px_rgba(56,189,248,0.2)]">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Bu Profil Gizlidir
          </h2>
          <p className="text-xs sm:text-sm text-white/50 max-w-md mx-auto leading-relaxed">
            @{currentDisplayProfile?.username} profilini gizli hesap olarak ayarlamıştır. Kütüphane, izleme geçmişi ve özel listeler yalnızca kullanıcının kendisine görünür.
          </p>
        </div>
      ) : (
        /* TAB CONTENT */
        <AnimatePresence mode="wait">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-8"
            >
              {/* Electric Blue Bento Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-28 h-28 bg-sky-500/10 rounded-full blur-2xl pointer-events-none" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400/80">
                    Toplam İzlenen Bölüm
                  </span>
                  <div className="text-3xl font-extrabold text-sky-400 mt-2 font-mono">
                    {totalWatchedEpisodes} Bölüm
                  </div>
                  <span className="text-xs text-white/45 mt-1 block">
                    K-Drama, C-Drama & Anime
                  </span>
                </div>

                <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#2997ff]">
                    Toplam Ekran Süresi
                  </span>
                  <div className="text-3xl font-extrabold text-[#2997ff] mt-2 font-mono">
                    {totalScreenHours} Saat
                  </div>
                  <span className="text-xs text-white/45 mt-1 block">
                    Gerçek izleme geçmişi
                  </span>
                </div>

                <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl pointer-events-none" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400/80">
                    Tamamlanan Yapım
                  </span>
                  <div className="text-3xl font-extrabold text-purple-400 mt-2 font-mono">
                    {totalCompleted}
                  </div>
                  <span className="text-xs text-white/45 mt-1 block">
                    Dizi, Anime & Sinema Filmi
                  </span>
                </div>

                <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-28 h-28 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400/80">
                    Favori Oyuncu & Karakter
                  </span>
                  <div className="text-3xl font-extrabold text-rose-400 mt-2 font-mono">
                    {isOwner ? personFavorites.length : favPeople.length} Yıldız
                  </div>
                  <span className="text-xs text-white/45 mt-1 block">
                    Koleksiyondaki yıldızlar
                  </span>
                </div>
              </div>

              {/* Drama DNA + Favorite Stars */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-5">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-sky-400" />
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
                            className="h-full rounded-full bg-[#2997ff] shadow-[0_0_8px_rgba(41,151,255,0.7)]"
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
                        Favori Oyuncular & Karakterler
                      </h3>
                    </div>
                    <Link
                      href="/oyuncular"
                      className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
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

              {/* 365-Day Watch Activity Heatmap (Electric Blue Style) */}
              {hideHistory && !isOwner ? (
                <div className="rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] text-center text-xs text-white/50">
                  Kullanıcı izleme aktivite haritasını gizli tutmaktadır.
                </div>
              ) : (
                <div className="rounded-3xl bg-[#0f0f11] p-6 sm:p-8 border border-white/[0.08] space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-sky-400" />
                      <span>Yıllık İzleme Aktivite Haritası (Son 6 Ay)</span>
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
                                ? 'bg-sky-500/20'
                                : lvl === 2
                                ? 'bg-sky-500/40'
                                : lvl === 3
                                ? 'bg-sky-400/80 shadow-[0_0_6px_rgba(56,189,248,0.35)]'
                                : 'bg-[#2997ff] shadow-[0_0_10px_rgba(41,151,255,0.7)]'
                            }`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 2: LIBRARY */}
          {activeTab === 'library' && (
            <motion.div
              key="library"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              {hideHistory && !isOwner ? (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/10 space-y-3">
                  <Lock className="w-8 h-8 text-sky-400 mx-auto" />
                  <p className="text-sm text-white/60">
                    Bu kullanıcı kütüphanesini ve izleme listelerini gizli tutmayı tercih etmiştir.
                  </p>
                </div>
              ) : (
                <>
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
                        iconColor: 'text-sky-400',
                        activeClass: 'bg-sky-500 text-black font-bold shadow-[0_0_18px_rgba(14,165,233,0.45)]',
                        inactiveClass: 'glass-pill text-sky-300/80 hover:text-sky-200 border-sky-500/20 hover:border-sky-500/40',
                      },
                      {
                        id: 'completed',
                        label: 'Tamamlandı',
                        icon: CheckCircle2,
                        iconColor: 'text-[#2997ff]',
                        activeClass: 'bg-[#2997ff] text-white font-bold shadow-[0_0_18px_rgba(41,151,255,0.45)]',
                        inactiveClass: 'glass-pill text-blue-300/80 hover:text-blue-200 border-blue-500/20 hover:border-blue-500/40',
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
                    <div className="rounded-3xl bg-[#0f0f11] p-14 text-center border border-white/10 space-y-3">
                      <p className="text-sm text-white/60">
                        Bu izleme durumunda henüz kayıtlı bir dizi veya anime bulunmuyor.
                      </p>
                      {isOwner && (
                        <Link
                          href="/kesfet"
                          className="inline-block mt-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all"
                        >
                          Katalogdan Yapım Ekle
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {filteredWatchedMedia.map((m) => (
                        <AccordionMediaCard key={m.id} item={m} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* TAB 3: WATCH HISTORY */}
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-6"
            >
              {hideHistory && !isOwner ? (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/10 space-y-3">
                  <Lock className="w-8 h-8 text-sky-400 mx-auto" />
                  <p className="text-sm text-white/60">
                    Bu kullanıcı izleme geçmişini gizli tutmaktadır.
                  </p>
                </div>
              ) : isOwner ? (
                continueWatchingList.length === 0 ? (
                  <div className="rounded-3xl bg-[#0f0f11] p-14 text-center border border-white/10 space-y-3">
                    <Clock className="w-8 h-8 text-sky-400 mx-auto mb-2" />
                    <p className="text-sm text-white/60">
                      Henüz izleme geçmişiniz bulunmuyor.
                    </p>
                    <p className="text-xs text-white/40 max-w-sm mx-auto">
                      Dizilerin bölümlerini oynatmaya başladığınızda kaldığınız dakika ve saniye otomatik olarak burada listelenecektir.
                    </p>
                    <Link
                      href="/kesfet"
                      className="inline-block mt-3 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all"
                    >
                      Dizi & Anime Keşfet
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {continueWatchingList.map((item) => {
                      const media = item.media;
                      const progressPct =
                        item.resume_duration_sec > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (item.resume_position_sec / item.resume_duration_sec) * 100
                              )
                            )
                          : 0;

                      return (
                        <div
                          key={item.media_id}
                          className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-4 flex gap-4 hover:border-white/20 transition-all group"
                        >
                          <div className="relative w-20 h-28 rounded-2xl overflow-hidden bg-black/60 shrink-0 border border-white/10">
                            {media?.cover_image ? (
                              <img
                                src={getProxiedImageUrl(media.cover_image, media.title)}
                                alt={media.title || 'Kapak'}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white/30">
                                <FilmIcon />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            <div>
                              <h4 className="text-sm font-bold text-white truncate">
                                {media?.title || `Yapım #${item.media_id}`}
                              </h4>
                              <div className="text-xs text-sky-400 font-mono mt-0.5">
                                {item.last_season_num}. Sezon · {item.last_episode_num}. Bölüm
                              </div>
                              {item.last_episode_title && (
                                <p className="text-[11px] text-white/50 truncate mt-0.5">
                                  {item.last_episode_title}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2 mt-2">
                              {/* Progress bar */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-mono text-white/50">
                                  <span>Kalan Süre</span>
                                  <span>%{progressPct}</span>
                                </div>
                                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full bg-sky-400 rounded-full"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              </div>

                              <Link
                                href={
                                  media?.slug
                                    ? `/seri/${media.slug}/${item.last_episode_num}`
                                    : `/seri/${item.media_id}`
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold transition-all w-fit"
                              >
                                <Play className="w-3 h-3 text-sky-400 fill-sky-400" />
                                <span>Kaldığın Yerden Oynat</span>
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/10 space-y-2">
                  <p className="text-xs text-white/50">
                    Kullanıcının herkese açık izleme geçmişi burada listelenir.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 4: CUSTOM LISTS */}
          {activeTab === 'lists' && (
            <motion.div
              key="lists"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6"
            >
              {isOwner && (
                <form
                  onSubmit={handleCreateList}
                  className="lg:col-span-4 rounded-3xl bg-[#0f0f11] p-6 border border-white/[0.08] space-y-4 h-fit"
                >
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FolderPlus className="w-4 h-4 text-sky-400" />
                    <span>Yeni Özel Koleksiyon Oluştur</span>
                  </h3>
                  <input
                    type="text"
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e.target.value)}
                    placeholder="Örn: En İyi Wuxia & Fantastik Seçkim"
                    className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
                  />
                  <textarea
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    rows={3}
                    placeholder="Koleksiyon açıklaması..."
                    className="w-full px-4 py-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-md"
                  >
                    Koleksiyonu Kaydet
                  </button>
                </form>
              )}

              <div
                className={`${
                  isOwner ? 'lg:col-span-8' : 'lg:col-span-12'
                } grid grid-cols-1 sm:grid-cols-2 gap-4`}
              >
                {customLists.map((lst) => (
                  <div
                    key={lst.id}
                    className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-6 flex flex-col justify-between hover:border-white/20 transition-all group"
                  >
                    <div>
                      <span className="text-[10px] font-mono text-sky-400 uppercase tracking-wider font-semibold">
                        Herkese Açık Koleksiyon
                      </span>
                      <h4 className="text-lg font-bold text-white mt-1 group-hover:text-sky-300 transition-colors">
                        {lst.title}
                      </h4>
                      <p className="text-xs text-white/60 mt-1">
                        {lst.description}
                      </p>
                    </div>
                    <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono text-white/50">
                      <span>{lst.count} Yapım</span>
                      <span className="text-sky-400 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                        <span>Görüntüle</span>
                        <span>→</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* TAB 5: 1-CLICK MDL & ANILIST WATCHLIST IMPORT (OWNER ONLY) */}
          {activeTab === 'import' && isOwner && (
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
                    className="flex-1 px-4 py-2.5 rounded-full bg-black/55 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
                  />
                  <button
                    onClick={() => handleImport('mdl')}
                    disabled={isImporting}
                    className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer flex items-center gap-1.5 hover:bg-white/90 transition-all shrink-0"
                  >
                    <Download className="w-3.5 h-3.5 text-black" />
                    <span>{isImporting ? 'Çekiliyor...' : "MDL'den Çek"}</span>
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
                    className="flex-1 px-4 py-2.5 rounded-full bg-black/55 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400/50"
                  />
                  <button
                    onClick={() => handleImport('anilist')}
                    disabled={isImporting}
                    className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs cursor-pointer flex items-center gap-1.5 hover:bg-white/90 transition-all shrink-0"
                  >
                    <Download className="w-3.5 h-3.5 text-black" />
                    <span>{isImporting ? 'Çekiliyor...' : "AniList'ten Çek"}</span>
                  </button>
                </div>
              </div>

              {importStatus && (
                <div className="md:col-span-2 p-4 rounded-2xl bg-white/[0.06] border border-white/20 text-xs font-mono text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>{importStatus}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 6: SETTINGS & PRIVACY (OWNER ONLY) */}
          {activeTab === 'settings' && isOwner && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-3xl bg-[#0f0f11] p-6 sm:p-10 border border-white/[0.08] max-w-2xl space-y-8"
            >
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <Settings className="w-5 h-5 text-sky-400" />
                  <span>Profil & Gizlilik Ayarları</span>
                </h3>
                <p className="text-xs text-white/55 mt-1">
                  Kişisel profil detaylarını, arayüz seslerini ve gizlilik tercihlerinizi düzenleyin.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-6">
                {/* Profile Identity */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-white/40">
                    Kimlik & Görünüm
                  </h4>

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
                      placeholder="Favori türlerin, izleme hedeflerin..."
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

                    {/* Presets */}
                    <div className="pt-2">
                      <span className="text-[11px] text-white/45 block mb-2 font-mono">
                        Hızlı Avatar Seçenekleri:
                      </span>
                      <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                        {AVATAR_PRESETS.map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setEditAvatarUrl(preset.url)}
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

                {/* Privacy Settings */}
                <div className="space-y-3 pt-4 border-t border-white/[0.08]">
                  <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-white/40">
                    Gizlilik & Görünürlük
                  </h4>

                  <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <Lock className="w-4 h-4 text-sky-400" />
                        <span>Gizli Profil Modu (Private Account)</span>
                      </div>
                      <div className="text-xs text-white/55 mt-0.5">
                        Açıldığında profil sayfandaki kütüphane ve listeleri yalnızca sen görebilirsin.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={editIsPrivate}
                      onChange={(e) => setEditIsPrivate(e.target.checked)}
                      className="w-5 h-5 accent-sky-400 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <Clock className="w-4 h-4 text-sky-400" />
                        <span>İzleme Geçmişimi & Kütüphanemi Gizle</span>
                      </div>
                      <div className="text-xs text-white/55 mt-0.5">
                        Profilin açık kalsın ama izlediğin diziler diğer ziyaretçilere görünmesin.
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

                {/* Sound Micro-Interactions */}
                <div className="space-y-3 pt-4 border-t border-white/[0.08]">
                  <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-white/40">
                    Arayüz Deneyimi
                  </h4>

                  <label className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 cursor-pointer hover:border-white/20 transition-all">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-sky-400" />
                        <span>Arayüz Sesli Mikro-Etkileşimleri (Web Audio API)</span>
                      </div>
                      <div className="text-xs text-white/55 mt-0.5">
                        Kart açılışlarında ve buton tıklamalarında Apple tarzı ince akustik ses efektleri.
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

                {settingsStatus && (
                  <div className="p-3.5 rounded-2xl bg-sky-500/10 border border-sky-400/30 text-xs text-sky-300 font-mono flex items-center gap-2">
                    <Check className="w-4 h-4 text-sky-400" />
                    <span>{settingsStatus}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="w-full py-3 rounded-full bg-white text-black font-bold text-xs cursor-pointer hover:bg-white/90 transition-all shadow-lg"
                >
                  {isSavingSettings ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

function FilmIcon() {
  return (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
    </svg>
  );
}

export default function ProfileUserPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const resolvedParams = use(params);
  const targetUsername = decodeURIComponent(resolvedParams.username);

  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center pt-28">
          <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ProfileInnerContent targetUsername={targetUsername} />
    </Suspense>
  );
}
