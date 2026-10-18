'use client';

import React, { use, useState, useEffect, useMemo, Suspense } from 'react';
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
  UserX,
  ShieldAlert,
  Search,
  MessageSquare,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  supabase,
  MediaItem,
  PersonItem,
  UserProfile,
  UserMediaProgress,
  getProxiedImageUrl,
  getEpisodeProgressStats,
} from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import CountryFlag from '@/components/CountryFlag';

type ProfileTab = 'overview' | 'library' | 'history' | 'lists' | 'comments' | 'import' | 'settings';

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
    blockedUsers,
    blockUser,
    unblockUser,
    isUserBlocked,
    isBlockedBy,
    pushNotification,
    refreshUserLibrary,
  } = useKoUp();

  const [profileData, setProfileData] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [blockedSearchQuery, setBlockedSearchQuery] = useState('');

  // Determine ownership
  const isOwner = Boolean(
    user && (
      user.username.toLowerCase() === targetUsername.toLowerCase() ||
      (profileData?.id && user.id === profileData.id)
    )
  );

  // Tab State
  const tabParam = searchParams.get('tab') as ProfileTab | null;
  const validTabs: ProfileTab[] = ['overview', 'library', 'history', 'lists', 'comments', 'import', 'settings'];
  const initialTab: ProfileTab =
    tabParam && validTabs.includes(tabParam)
      ? (!isOwner && (tabParam === 'settings' || tabParam === 'import') ? 'overview' : tabParam)
      : 'overview';

  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [libraryFilter, setLibraryFilter] = useState<string>('ALL');
  const [watchedMedia, setWatchedMedia] = useState<MediaItem[]>([]);
  const [targetProgressMap, setTargetProgressMap] = useState<Record<number, UserMediaProgress>>({});
  const [favPeople, setFavPeople] = useState<PersonItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  // User comments on profile
  const [profileComments, setProfileComments] = useState<
    Array<{
      id: string;
      user_id: string;
      target_type: string;
      media_id?: number | null;
      season_number?: number | null;
      episode_number?: number | null;
      content_html: string;
      has_spoiler?: boolean;
      likes_count?: number;
      dislikes_count?: number;
      created_at: string;
      media?: {
        id: number;
        slug: string;
        title: string;
        cover_image?: string | null;
        content_type?: string;
      } | null;
    }>
  >([]);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});

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

  // Custom Lists (Zero mock data - strictly derived from Supabase custom_lists table)
  const [customLists, setCustomLists] = useState<
    Array<{ id: number; title: string; description: string; count: number }>
  >([]);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  // Sync tab with URL search parameter & redirect dedicated routes
  useEffect(() => {
    if (tabParam) {
      if (tabParam === 'settings' || tabParam === 'import') {
        router.replace('/ayarlar');
        return;
      }
      if (tabParam === 'history') {
        router.replace('/gecmis');
        return;
      }
      if (validTabs.includes(tabParam)) {
        setActiveTab(tabParam);
      }
    }
  }, [tabParam, router]);

  const switchTab = (tab: ProfileTab) => {
    triggerSound('click');
    if (tab === 'settings' || tab === 'import') {
      router.push('/ayarlar');
      return;
    }
    if (tab === 'history') {
      router.push('/gecmis');
      return;
    }
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

  // Unified Profile Data Loader (Strictly real Supabase data, Zero mock leaks)
  useEffect(() => {
    let isMounted = true;
    async function loadUnifiedProfileData() {
      if (!profileData?.id) return;
      setIsLoadingLibrary(true);

      const targetId = profileData.id;
      const isProfilePrivate = Boolean(profileData.is_private);
      const isHistoryHidden = Boolean(profileData.hide_watch_history);

      try {
        // 1. WATCH PROGRESS & WATCHED MEDIA
        if (!isOwner && (isProfilePrivate || isHistoryHidden)) {
          if (isMounted) {
            setWatchedMedia([]);
            setTargetProgressMap({});
          }
        } else if (isOwner && Object.keys(progressMap).length > 0) {
          // Owner local-first reactive progress
          if (isMounted) setTargetProgressMap(progressMap);
          const mIds = Object.keys(progressMap).map(Number).filter((n) => !isNaN(n));
          if (mIds.length > 0) {
            const { data: mRows } = await supabase.from('media').select('*').in('id', mIds);
            if (isMounted) setWatchedMedia((mRows as MediaItem[]) || []);
          } else if (isMounted) {
            setWatchedMedia([]);
          }
        } else {
          // Visitor viewing public profile OR fresh owner without cached map:
          // Query real user_media_progress directly from Supabase!
          const { data: progRows } = await supabase
            .from('user_media_progress')
            .select('*, media:media_id (*)')
            .eq('user_id', targetId);

          if (isMounted) {
            if (progRows && progRows.length > 0) {
              const pMap: Record<number, UserMediaProgress> = {};
              const mList: MediaItem[] = [];
              progRows.forEach((r: any) => {
                pMap[r.media_id] = r as UserMediaProgress;
                if (r.media) mList.push(r.media as MediaItem);
              });
              setTargetProgressMap(pMap);
              setWatchedMedia(mList);
            } else {
              setTargetProgressMap({});
              setWatchedMedia([]);
            }
          }
        }

        // 2. FAVORITE PEOPLE / ACTORS
        const { data: favRows } = await supabase
          .from('person_favorites')
          .select('person_id, people:person_id (*)')
          .eq('user_id', targetId);

        if (isMounted) {
          if (favRows && favRows.length > 0) {
            const pList = favRows.map((r: any) => r.people).filter(Boolean) as PersonItem[];
            setFavPeople(pList);
          } else {
            setFavPeople([]);
          }
        }

        // 3. USER COMMENTS TAB
        const { data: commentRows } = await supabase
          .from('comments')
          .select('id, user_id, target_type, media_id, season_number, episode_number, content_html, has_spoiler, likes_count, dislikes_count, created_at, media:media_id (id, slug, title, cover_image, content_type)')
          .eq('user_id', targetId)
          .eq('is_hidden', false)
          .order('created_at', { ascending: false })
          .limit(50);

        if (isMounted) {
          setProfileComments((commentRows as any[]) || []);
        }

        // 4. CUSTOM LISTS (Filtered by visibility for visitors, zero hardcoded data)
        let listQuery = supabase
          .from('custom_lists')
          .select('id, slug, title, description, visibility, media_ids, likes_count')
          .eq('user_id', targetId);

        if (!isOwner) {
          listQuery = listQuery.eq('visibility', 'public');
        }

        const { data: listsData } = await listQuery.order('created_at', { ascending: false });
        if (isMounted) {
          if (listsData && listsData.length > 0) {
            setCustomLists(
              listsData.map((l: any) => ({
                id: l.id,
                title: l.title,
                description: l.description || 'Özel Koleksiyon',
                count: Array.isArray(l.media_ids) ? l.media_ids.length : 0,
              }))
            );
          } else {
            setCustomLists([]);
          }
        }
      } catch (err) {
        console.error('Error loading unified profile data:', err);
      } finally {
        if (isMounted) setIsLoadingLibrary(false);
      }
    }

    loadUnifiedProfileData();
    return () => {
      isMounted = false;
    };
  }, [profileData?.id, isOwner, progressMap]);

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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch('/api/mdl-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          source,
          username: uname,
          userId: user?.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSound('success');
        setImportStatus(
          `${data.message} (${data.matchedCount} yapım KoUp kütüphanenize başarıyla bağlandı)`
        );
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

  // Custom List Creator
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    triggerSound('success');
    const titleVal = newListTitle.trim();
    const descVal = newListDesc.trim() || 'Özel Koleksiyon';

    setNewListTitle('');
    setNewListDesc('');

    if (user?.id) {
      try {
        const res = await fetch('/api/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: titleVal,
            description: descVal,
            visibility: 'public',
            user_id: user.id,
            media_ids: [],
          }),
        });
        const d = await res.json();
        if (d.success && d.list) {
          setCustomLists((prev) => [
            {
              id: d.list.id,
              title: d.list.title,
              description: d.list.description || '',
              count: 0,
            },
            ...prev,
          ]);
          pushNotification('Liste Oluşturuldu', 'Yeni listeniz kaydedildi.', 'success');
          return;
        }
      } catch (err) {
        console.error('Error creating list:', err);
      }
    }

    setCustomLists((prev) => [
      ...prev,
      {
        id: Date.now(),
        title: titleVal,
        description: descVal,
        count: 0,
      },
    ]);
  };

  const currentDisplayProfile = isOwner && user ? user : profileData;
  const isPrivate = Boolean(currentDisplayProfile?.is_private);
  const hideHistory = Boolean(currentDisplayProfile?.hide_watch_history);

  // Active progress map (Local-first for owner, targetProgressMap for visitors)
  const activeProgMap = isOwner && Object.keys(progressMap).length > 0 ? progressMap : targetProgressMap;
  const progressItems = Object.values(activeProgMap);

  // Filtered watched media
  const filteredWatchedMedia = watchedMedia.filter((m) => {
    if (libraryFilter === 'ALL') return true;
    return activeProgMap[m.id]?.status === libraryFilter;
  });

  // Calculate live statistics (Derived strictly from real user_media_progress data)
  const totalWatchedEpisodes = progressItems.reduce(
    (acc, p) => acc + (p.watched_episodes?.length || 0),
    0
  );

  const totalScreenHours = (totalWatchedEpisodes * 0.75).toFixed(1);

  const totalCompleted = progressItems.filter((p) => p.status === 'completed').length;

  // Country DNA Breakdown
  const countryBreakdown = useMemo(() => {
    if (watchedMedia.length === 0) {
      return [
        { label: 'Güney Kore (K-Drama)', code: 'KR', displayCode: 'KR', pct: 45 },
        { label: 'Japonya (Anime & J-Drama)', code: 'JP', displayCode: 'JP', pct: 25 },
        { label: 'Çin (C-Drama & Wuxia)', code: 'CN', displayCode: 'CN', pct: 15 },
        { label: 'Amerika Birleşik Devletleri (ABD)', code: 'US', displayCode: 'US', pct: 10 },
        { label: 'Tayland & Global', code: 'TH', displayCode: 'GL', pct: 5 },
      ];
    }

    let kr = 0;
    let jp = 0;
    let cn = 0;
    let us = 0;
    let gl = 0;

    watchedMedia.forEach((m) => {
      const cc = (m.country_code || m.country || '').toUpperCase();
      const ct = (m.content_type || '').toLowerCase();
      if (cc === 'KR') kr++;
      else if (cc === 'JP' || ct === 'anime') jp++;
      else if (cc === 'CN') cn++;
      else if (cc === 'US' || cc === 'USA') us++;
      else gl++;
    });

    const total = watchedMedia.length;
    const krPct = Math.round((kr / total) * 100);
    const jpPct = Math.round((jp / total) * 100);
    const cnPct = Math.round((cn / total) * 100);
    const usPct = Math.round((us / total) * 100);
    const glPct = Math.max(0, 100 - (krPct + jpPct + cnPct + usPct));

    return [
      { label: 'Güney Kore (K-Drama)', code: 'KR', displayCode: 'KR', pct: krPct },
      { label: 'Japonya (Anime & J-Drama)', code: 'JP', displayCode: 'JP', pct: jpPct },
      { label: 'Çin (C-Drama & Wuxia)', code: 'CN', displayCode: 'CN', pct: cnPct },
      { label: 'Amerika Birleşik Devletleri (ABD)', code: 'US', displayCode: 'US', pct: usPct },
      { label: 'Tayland & Global', code: 'TH', displayCode: 'GL', pct: glPct },
    ];
  }, [watchedMedia]);

  // Tabs: Profile is strictly for public viewing/showcase ("profil görünüm için")
  const TABS: Array<{
    id: ProfileTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'overview', label: 'Genel Bakış & Drama DNA', icon: BarChart3 },
    { id: 'library', label: `Kütüphane (${watchedMedia.length})`, icon: Library },
    { id: 'lists', label: `Özel Listeler (${customLists.length})`, icon: FolderHeart },
    { id: 'comments', label: `Yorumlar (${profileComments.length})`, icon: MessageSquare },
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

  // Access Denial Gate: If this profile's owner has blocked the current user
  const isBlockedByTarget = Boolean(!isOwner && profileData?.id && isBlockedBy(profileData.id));
  if (isBlockedByTarget) {
    return (
      <div className="pt-36 pb-24 max-w-xl mx-auto px-5 text-center">
        <div className="rounded-3xl bg-[#0f0f13] p-10 sm:p-14 border border-rose-500/30 space-y-5 shadow-2xl">
          <div className="w-20 h-20 rounded-3xl bg-rose-500/15 border-2 border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(244,63,94,0.3)]">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 font-mono text-xs uppercase tracking-wider font-bold">
            Erişim Engellendi
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Bu kullanıcı tarafından engellendin
          </h2>
          <p className="text-sm text-white/60 leading-relaxed max-w-md mx-auto">
            Bu profilin içerikleri ve kütüphanesi görüntülenemez.
          </p>
          <div className="pt-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all shadow-lg"
            >
              <span>Ana Sayfaya Dön</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8 relative">
      {/* AMBIENT CINEMATIC BACKGROUND GLOW FROM BANNER (Not in a box, spreads soft atmospheric light) */}
      {currentDisplayProfile?.banner_url && (
        <div className="absolute -top-12 left-0 right-0 h-[540px] overflow-hidden pointer-events-none -z-10 select-none">
          <div
            className="w-full h-full bg-cover bg-center blur-[75px] opacity-40 scale-125 transform-gpu transition-all duration-700"
            style={{
              backgroundImage: `url(${getProxiedImageUrl(
                currentDisplayProfile.banner_url,
                currentDisplayProfile.username,
                null,
                'original',
                'banner'
              )})`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#09090b]/75 to-[#09090b]" />
        </div>
      )}

      {/* PROFILE HERO BANNER */}
      <div className="rounded-3xl overflow-hidden bg-[#0f0f11] border border-white/[0.08] shadow-2xl relative">
        <div className="h-44 sm:h-64 relative overflow-hidden bg-gradient-to-r from-[#101524] via-[#141b2d] to-[#0c101d]">
          {currentDisplayProfile?.banner_url ? (
            <>
              <img
                src={getProxiedImageUrl(
                  currentDisplayProfile.banner_url,
                  currentDisplayProfile.username,
                  null,
                  'original',
                  'banner'
                )}
                alt="Profil Kapak Görseli"
                className="w-full h-full object-cover object-center scale-105 transform-gpu"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f11] via-[#0f0f11]/50 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0f0f11]/70 via-transparent to-[#0f0f11]/70" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 cinema-vignette" />
              <div className="absolute -top-16 -right-16 w-80 h-80 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
              <div className="absolute bottom-0 left-1/4 w-96 h-36 bg-blue-600/10 blur-2xl pointer-events-none" />
            </>
          )}
        </div>

        <div className="px-6 sm:px-10 pb-8 -mt-12 relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            {/* Clean Avatar Circle */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl bg-[#17171b] flex items-center justify-center shrink-0">
              {currentDisplayProfile?.avatar_url ? (
                <img
                  src={getProxiedImageUrl(
                    currentDisplayProfile.avatar_url,
                    currentDisplayProfile.display_name || currentDisplayProfile.username,
                    null,
                    'w185',
                    'person'
                  )}
                  alt={currentDisplayProfile.display_name || currentDisplayProfile.username}
                  loading="eager"
                  decoding="async"
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
            {isOwner ? null : !user ? (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Giriş Yap / Takip Et</span>
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (!profileData?.id) return;
                  triggerSound('click');
                  if (isUserBlocked(profileData.id)) {
                    await unblockUser(profileData.id);
                  } else {
                    await blockUser(
                      profileData.id,
                      profileData.username,
                      profileData.display_name || undefined,
                      profileData.avatar_url || undefined
                    );
                  }
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer transition-all ${
                  isUserBlocked(profileData?.id)
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-white/[0.06] text-white/70 border border-white/10 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30'
                }`}
              >
                <UserX className="w-3.5 h-3.5" />
                <span>{isUserBlocked(profileData?.id) ? 'Engeli Kaldır' : 'Engelle'}</span>
              </button>
            )}
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
                      Ülke Dağılımı
                    </h3>
                  </div>
                  <div className="space-y-4">
                    {countryBreakdown.map((row) => (
                      <div key={row.code} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold text-white/85">
                          <span className="flex items-center gap-2.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 shrink-0">
                              <CountryFlag code={row.code} size="sm" className="rounded-xs shadow-xs" />
                              <span className="text-[10px] font-mono font-bold text-white/70">
                                {row.displayCode || row.code}
                              </span>
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
                            src={getProxiedImageUrl(p.image_url, p.name, null, 'w500', 'person')}
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
                  {isOwner && (
                    <div className="p-4 rounded-3xl bg-sky-500/10 border border-sky-400/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2.5">
                        <Library className="w-4 h-4 text-sky-400 shrink-0" />
                        <span className="text-xs text-white/80">
                          Kütüphanenizi tam ekran filtrelemek, aramak ve durumları toplu yönetmek için kütüphane sayfanızı kullanın.
                        </span>
                      </div>
                      <Link
                        href="/kutuphane"
                        onClick={() => triggerSound('click')}
                        className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all shrink-0 text-center shadow-sm"
                      >
                        Kütüphanemi Yönet →
                      </Link>
                    </div>
                  )}

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
                        iconColor: 'text-emerald-400',
                        activeClass: 'bg-emerald-500 text-black font-bold shadow-[0_0_18px_rgba(16,185,129,0.45)]',
                        inactiveClass: 'glass-pill text-emerald-300/80 hover:text-emerald-200 border-emerald-500/20 hover:border-emerald-500/40',
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
                      Dizilerin bölümlerini izledikçe ve işaretledikçe sıradaki bölümleriniz otomatik olarak burada listelenecektir.
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
                      const stats = getEpisodeProgressStats(item, media);
                      const barPct = Math.max(
                        stats.watchedCount > 0 ? 6 : 3,
                        stats.progressPercent
                      );

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
                                Sıradaki: {stats.season}. Sezon · {stats.nextEpisode}. Bölüm
                              </div>
                              <p className="text-[11px] text-white/50 truncate mt-0.5">
                                {stats.watchedCount} / {stats.totalEpisodes} Bölüm İzlendi
                              </p>
                            </div>

                            <div className="space-y-2 mt-2">
                              {/* Episode Progress bar */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px] font-mono text-white/50">
                                  <span>Bölüm İlerlemesi</span>
                                  <span>%{stats.progressPercent}</span>
                                </div>
                                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full bg-sky-400 rounded-full"
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                              </div>

                              <Link
                                href={
                                  media?.slug
                                    ? `/seri/${media.slug}/${stats.nextEpisode}?season=${stats.season}`
                                    : `/seri/${item.media_id}`
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold transition-all w-fit"
                              >
                                <Play className="w-3 h-3 text-sky-400 fill-sky-400" />
                                <span>{stats.nextEpisode}. Bölümden Devam Et</span>
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
                <div className="lg:col-span-12 p-4 rounded-3xl bg-sky-500/10 border border-sky-400/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <FolderHeart className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="text-xs text-white/80">
                      Özel koleksiyon oluşturmak, afişleri ve gizlilik ayarlarını tam ekran yönetmek için listeler yönetim sayfasını kullanın.
                    </span>
                  </div>
                  <Link
                    href="/listelerim"
                    onClick={() => triggerSound('click')}
                    className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all shrink-0 text-center shadow-sm"
                  >
                    Özel Listelerimi Yönet →
                  </Link>
                </div>
              )}

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
                    className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
                  />
                  <textarea
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    rows={3}
                    placeholder="Koleksiyon açıklaması..."
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all resize-none font-medium"
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
                {customLists.length === 0 ? (
                  <div className="col-span-full rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/[0.08] space-y-3">
                    <FolderHeart className="w-8 h-8 text-white/20 mx-auto" />
                    <p className="text-sm text-white/60">
                      {isOwner
                        ? 'Henüz bir özel liste oluşturmadınız. Sol taraftaki formdan hemen yeni bir koleksiyon başlatabilirsiniz.'
                        : 'Bu kullanıcı henüz herkese açık bir özel liste oluşturmamış.'}
                    </p>
                  </div>
                ) : (
                  customLists.map((lst) => (
                    <Link
                      key={lst.id}
                      href={`/listeler/${lst.id}`}
                      onClick={() => triggerSound('click')}
                      className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-6 flex flex-col justify-between hover:border-sky-400/40 hover:bg-white/[0.03] transition-all group cursor-pointer"
                    >
                      <div>
                        <span className="text-[10px] font-mono text-sky-400 uppercase tracking-wider font-semibold">
                          Özel Koleksiyon
                        </span>
                        <h4 className="text-lg font-bold text-white mt-1 group-hover:text-sky-300 transition-colors">
                          {lst.title}
                        </h4>
                        <p className="text-xs text-white/60 mt-1 line-clamp-2">
                          {lst.description}
                        </p>
                      </div>
                      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-mono text-white/50">
                        <span>{lst.count} Yapım</span>
                        <span className="text-sky-400 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1 font-semibold">
                          <span>İncele</span>
                          <span>→</span>
                        </span>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 5: USER COMMENTS & REVIEWS */}
          {activeTab === 'comments' && (
            <motion.div
              key="comments"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-sky-400" />
                    <span>Paylaşılan Yorumlar ({profileComments.length})</span>
                  </h3>
                  <p className="text-xs text-white/50 mt-0.5">
                    Kullanıcının dizi, film, anime ve bölümlere yazdığı en son değerlendirmeler.
                  </p>
                </div>
              </div>

              {profileComments.length === 0 ? (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/[0.08] space-y-3">
                  <MessageSquare className="w-8 h-8 text-white/20 mx-auto" />
                  <p className="text-sm text-white/60">
                    Bu kullanıcı henüz bir yorum veya değerlendirme paylaşmamış.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {profileComments.map((comment) => {
                    const isSpoiler = Boolean(comment.has_spoiler);
                    const isRevealed = revealedSpoilers[comment.id];
                    const media = comment.media;
                    const isEpisode = Boolean(comment.season_number && comment.episode_number);

                    const targetLink = media?.slug
                      ? isEpisode
                        ? `/seri/${media.slug}/${comment.episode_number}?season=${comment.season_number}`
                        : `/${media.content_type === 'film' ? 'film' : 'seri'}/${media.slug}`
                      : '#';

                    return (
                      <div
                        key={comment.id}
                        className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-5 sm:p-6 space-y-3.5 hover:border-white/20 transition-all"
                      >
                        {/* Target Media Header */}
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <Link
                            href={targetLink}
                            className="flex items-center gap-3 group/link min-w-0"
                          >
                            {media?.cover_image && (
                              <img
                                src={getProxiedImageUrl(media.cover_image, media.title, null, 'w185', 'poster')}
                                alt={media.title || 'Kapak'}
                                className="w-9 h-12 rounded-lg object-cover border border-white/10 shrink-0 group-hover/link:scale-105 transition-transform"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white group-hover/link:text-sky-300 transition-colors truncate">
                                {media?.title || 'Yapım'}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] font-mono text-white/45 mt-0.5 flex-wrap">
                                {isEpisode ? (
                                  <span className="text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded-full border border-sky-400/20">
                                    {comment.season_number}. Sezon {comment.episode_number}. Bölüm
                                  </span>
                                ) : (
                                  <span className="text-white/60 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                                    Genel İnceleme
                                  </span>
                                )}
                                <span>•</span>
                                <span>
                                  {comment.created_at
                                    ? new Date(comment.created_at).toLocaleDateString('tr-TR', {
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric',
                                      })
                                    : 'Geçmiş'}
                                </span>
                              </div>
                            </div>
                          </Link>

                          {/* Likes count */}
                          <div className="flex items-center gap-3 text-xs font-mono text-white/50 shrink-0">
                            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/10">
                              <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400/30" />
                              <span>{comment.likes_count || 0}</span>
                            </span>
                          </div>
                        </div>

                        {/* Comment Body with Spoiler Protection */}
                        {isSpoiler && !isRevealed ? (
                          <div
                            onClick={() =>
                              setRevealedSpoilers((prev) => ({ ...prev, [comment.id]: true }))
                            }
                            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 cursor-pointer hover:bg-amber-500/15 transition-all flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2.5 text-xs text-amber-300 font-semibold">
                              <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
                              <span>Bu yorum sürprizbozan (spoiler) içerir. Görmek için tıklayın.</span>
                            </div>
                            <span className="text-[10px] font-mono text-amber-400 underline shrink-0">
                              Göster
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs sm:text-sm text-white/80 leading-relaxed break-words bg-black/20 p-4 rounded-2xl border border-white/[0.04]">
                            <div
                              dangerouslySetInnerHTML={{ __html: comment.content_html }}
                              className="prose prose-invert prose-xs max-w-none [&_p]:m-0"
                            />
                            {isSpoiler && (
                              <div className="mt-2 text-[10px] font-mono text-amber-400/70 flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                <span>Spoiler içeriği gösterildi</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
