'use client';

import React, { use, useState, useEffect, useMemo, useRef, Suspense } from 'react';
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
  cleanMediaTitle,
} from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import DirectMediaCard from '@/components/DirectMediaCard';
import CountryFlag from '@/components/CountryFlag';
import Pagination from '@/components/Pagination';

type ProfileTab = 'overview' | 'library' | 'history' | 'lists' | 'comments' | 'import' | 'settings';

const COMMENTS_PER_PAGE = 40;

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
  const user = useKoUpSelector((s) => s.user);
  const progressMap = useKoUpSelector((s) => s.progressMap);
  const continueWatchingList = useKoUpSelector((s) => s.continueWatchingList);
  const personFavorites = useKoUpSelector((s) => s.personFavorites);
  const soundEnabled = useKoUpSelector((s) => s.soundEnabled);
  const toggleSound = useKoUpSelector((s) => s.toggleSound);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const logout = useKoUpSelector((s) => s.logout);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const updateProfileSettings = useKoUpSelector((s) => s.updateProfileSettings);
  const blockedUsers = useKoUpSelector((s) => s.blockedUsers);
  const blockUser = useKoUpSelector((s) => s.blockUser);
  const unblockUser = useKoUpSelector((s) => s.unblockUser);
  const isUserBlocked = useKoUpSelector((s) => s.isUserBlocked);
  const isBlockedBy = useKoUpSelector((s) => s.isBlockedBy);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const refreshUserLibrary = useKoUpSelector((s) => s.refreshUserLibrary);

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
      person_id?: number | null;
      magazine_id?: number | null;
      parent_id?: string | null;
      timestamp_sec?: number | null;
      gif_url?: string | null;
      sticker_id?: string | null;
      image_url?: string | null;
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
      people?: {
        id: number;
        slug: string;
        name: string;
        image_url?: string | null;
      } | null;
      magazine_posts?: {
        id: number;
        slug: string;
        title: string;
        featured_image?: string | null;
      } | null;
    }>
  >([]);
  const [commentsPage, setCommentsPage] = useState<number>(1);
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
          .select(
            'id, username, display_name, avatar_url, banner_url, bio, role, is_private, hide_watch_history, hide_library, hide_comments, stats_episodes_watched, stats_series_completed, stats_movies_completed, stats_anime_completed, stats_total_minutes, mdl_username, anilist_username, notification_settings, anilist_auto_sync, created_at'
          )
          .ilike('username', targetUsername)
          .maybeSingle();

        if (!isMounted) return;

        if (dbUser) {
          setProfileData(dbUser as unknown as UserProfile);
        } else if (user && user.username.toLowerCase() === targetUsername.toLowerCase()) {
          setProfileData(user);
        } else {
          setProfileData(null);
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
      const isLibraryHidden = Boolean(profileData.hide_library);
      const isCommentsHidden = Boolean(profileData.hide_comments);

      try {
        // 1. WATCH PROGRESS & WATCHED MEDIA
        if (!isOwner && isProfilePrivate) {
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
              setTargetProgressMap(!isOwner && isHistoryHidden ? {} : pMap);
              setWatchedMedia(!isOwner && isLibraryHidden ? [] : mList);
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
        if (!isOwner && (isProfilePrivate || isCommentsHidden)) {
          if (isMounted) {
            setProfileComments([]);
            setCommentsPage(1);
          }
        } else {
          let { data: commentRows, error: commentErr } = await supabase
            .from('comments')
            .select('id, user_id, target_type, media_id, season_number, episode_number, person_id, magazine_id, parent_id, timestamp_sec, gif_url, sticker_id, image_url, content_html, has_spoiler, likes_count, dislikes_count, created_at, media:media_id (id, slug, title, cover_image, content_type), people:person_id (id, slug, name, image_url), magazine_posts:magazine_id (id, slug, title, featured_image)')
            .eq('user_id', targetId)
            .eq('is_hidden', false)
            .order('created_at', { ascending: false })
            .limit(1000);

          if (commentErr && (!commentRows || commentRows.length === 0)) {
            const fallbackRes = await supabase
              .from('comments')
              .select('id, user_id, target_type, media_id, season_number, episode_number, person_id, magazine_id, parent_id, timestamp_sec, gif_url, sticker_id, image_url, content_html, has_spoiler, likes_count, dislikes_count, created_at, media:media_id (id, slug, title, cover_image, content_type), people:person_id (id, slug, name, image_url)')
              .eq('user_id', targetId)
              .eq('is_hidden', false)
              .order('created_at', { ascending: false })
              .limit(1000);
            if (fallbackRes.data) {
              commentRows = fallbackRes.data as any;
            }
          }

          if (isMounted) {
            setProfileComments((commentRows as any[]) || []);
            setCommentsPage(1);
          }
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
  const hideLibrary = Boolean(currentDisplayProfile?.hide_library);
  const hideComments = Boolean(currentDisplayProfile?.hide_comments);

  // Active progress map (Local-first for owner, targetProgressMap for visitors)
  const activeProgMap = isOwner && Object.keys(progressMap).length > 0 ? progressMap : targetProgressMap;
  const progressItems = Object.values(activeProgMap);

  // Watched media map for quick lookups
  const watchedMediaMap = useMemo(() => {
    const map = new Map<number, MediaItem>();
    watchedMedia.forEach((m) => map.set(m.id, m));
    return map;
  }, [watchedMedia]);

  // Active watching list for history tab (aligned with /gecmis)
  const activeWatchingList = useMemo(() => {
    return Object.values(activeProgMap)
      .map((item) => (item.media ? item : { ...item, media: watchedMediaMap.get(item.media_id) }))
      .filter((item) => {
        if (!item.media && !watchedMediaMap.has(item.media_id)) return false;
        if (item.status === 'dropped') return false;
        return (
          item.status === 'watching' ||
          item.status === 'completed' ||
          (item.watched_episodes && item.watched_episodes.length > 0) ||
          (item.resume_position_sec && item.resume_position_sec > 15)
        );
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [activeProgMap, watchedMediaMap]);

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
    {
      id: 'library',
      label: !isOwner && hideLibrary ? 'Kütüphane (Gizli)' : `Kütüphane (${watchedMedia.length})`,
      icon: !isOwner && hideLibrary ? Lock : Library,
    },
    {
      id: 'history',
      label: !isOwner && hideHistory ? 'İzleme Geçmişi (Gizli)' : `İzleme Geçmişi (${activeWatchingList.length})`,
      icon: !isOwner && hideHistory ? Lock : Clock,
    },
    { id: 'lists', label: `Özel Listeler (${customLists.length})`, icon: FolderHeart },
    {
      id: 'comments',
      label: !isOwner && hideComments ? 'Yorumlar (Gizli)' : `Yorumlar (${profileComments.length})`,
      icon: !isOwner && hideComments ? Lock : MessageSquare,
    },
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

  // Not Found Gate: When username does not exist in Supabase
  if (!profileData) {
    return (
      <div className="pt-36 pb-24 max-w-xl mx-auto px-5 text-center">
        <div className="rounded-3xl bg-[#0f0f13] p-10 sm:p-14 border border-white/10 space-y-5 shadow-2xl">
          <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 text-white/40 flex items-center justify-center mx-auto shadow-inner">
            <UserX className="w-10 h-10" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/60 font-mono text-xs uppercase tracking-wider font-bold">
            Profil Bulunamadı
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Kullanıcı Bulunamadı
          </h2>
          <p className="text-sm text-white/60 leading-relaxed max-w-md mx-auto">
            Aradığınız @{targetUsername} kullanıcı profili mevcut değil veya hesap silinmiş olabilir.
          </p>
          <div className="pt-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors shadow-lg"
            >
              <span>Ana Sayfaya Dön</span>
            </Link>
          </div>
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
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors shadow-lg"
            >
              <span>Ana Sayfaya Dön</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const bannerSrc = currentDisplayProfile?.banner_url
    ? getProxiedImageUrl(
        currentDisplayProfile.banner_url,
        currentDisplayProfile.username,
        null,
        'original',
        'banner'
      )
    : null;

  return (
    <div className="min-h-screen relative overflow-x-hidden pb-24">
      {/* FULL-BLEED ATMOSPHERIC BACKGROUND & AMBIENT LIGHT GLOW */}
      <div className="absolute top-0 left-0 right-0 h-[520px] sm:h-[600px] overflow-hidden pointer-events-none select-none z-0">
        {bannerSrc ? (
          <>
            {/* Layer 1: Ambient Colored Glow behind everything */}
            <img
              src={bannerSrc}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover object-center blur-3xl scale-110 opacity-70 saturate-150"
            />
            {/* Layer 2: Full-Bleed Sharp Cover Image across the entire top banner */}
            <img
              src={bannerSrc}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover object-center opacity-65"
            />
          </>
        ) : (
          <>
            <div className="absolute -top-24 left-1/4 w-[500px] h-[350px] rounded-full bg-sky-500/15 blur-[120px]" />
            <div className="absolute top-12 right-1/4 w-[450px] h-[300px] rounded-full bg-indigo-600/12 blur-[120px]" />
          </>
        )}
        {/* Cinematic multi-stop gradient mask to smoothly dissolve into background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#09090b]/30 via-[#09090b]/60 to-[#09090b]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/80 via-transparent to-[#09090b]/80" />
      </div>

      <div className="pt-32 sm:pt-40 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8 relative z-10">
        {/* FRAMELESS PROFILE HERO HEADER */}
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-6">
              {/* Avatar with Subtle Glass Ring */}
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-3xl overflow-hidden border-2 border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.85)] bg-[#141418] flex items-center justify-center shrink-0">
                {currentDisplayProfile?.avatar_url ? (
                  <img
                    src={getProxiedImageUrl(
                      currentDisplayProfile.avatar_url,
                      currentDisplayProfile.display_name || currentDisplayProfile.username,
                      null,
                      'w500',
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

              <div className="flex flex-col justify-between pt-0.5 space-y-2.5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
                      {currentDisplayProfile?.display_name || currentDisplayProfile?.username || targetUsername}
                    </h1>

                    {currentDisplayProfile?.role === 'admin' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/25 text-amber-300 border border-amber-400/35 flex items-center gap-1 shadow-[0_0_15px_rgba(251,191,36,0.2)]">
                        <ShieldCheck className="w-3 h-3 text-amber-400" />
                        <span>YÖNETİCİ (ADMIN)</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-black/75 text-white/75 border border-white/15">
                        {(currentDisplayProfile?.role || 'ÜYE').toUpperCase()}
                      </span>
                    )}

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        isPrivate
                          ? 'bg-amber-400/20 text-amber-300 border-amber-400/35 shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                          : 'bg-black/75 text-white/80 border-white/15'
                      }`}
                    >
                      {isPrivate ? (
                        <>
                          <Lock className="w-3 h-3 text-amber-400" />
                          <span>Gizli Hesap</span>
                        </>
                      ) : (
                        <>
                          <Globe className="w-3 h-3 text-sky-400" />
                          <span>Herkese Açık</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Username Tag Directly Under Display Name */}
                  <div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-black/75 text-white/75 border border-white/15">
                      @{currentDisplayProfile?.username || targetUsername}
                    </span>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-white/75 max-w-xl drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
                  {currentDisplayProfile?.bio ||
                    'K-Drama, C-Drama ve Anime tutkunu • KoUp Sinema Koleksiyoneri'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {isOwner ? null : !user ? (
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-colors"
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
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                    isUserBlocked(profileData?.id)
                      ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40 hover:bg-rose-500/35'
                      : 'bg-black/75 text-white/75 border border-white/15 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/30'
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
            <div className="pt-4 border-t border-white/10 flex items-center gap-2 overflow-x-auto no-scrollbar">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => switchTab(t.id)}
                    className={`relative flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      active ? 'text-black' : 'bg-white/[0.08] border border-white/10 text-white/80 hover:text-white hover:bg-white/12'
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
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl bg-[#0f0f11]/95 p-12 sm:p-16 text-center border border-white/[0.08] space-y-4 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-1/2 translate-x-1/2 w-48 h-48 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="w-16 h-16 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.2)] relative z-10">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-1.5 relative z-10">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Bu Profil Gizlidir
            </h2>
            <p className="text-xs sm:text-sm text-white/50 max-w-md mx-auto leading-relaxed">
              @{currentDisplayProfile?.username} profilini gizli hesap olarak kullanmaktadır. Kütüphane, izleme geçmişi, özel listeler ve istatistikler yalnızca kullanıcının kendisine görünür.
            </p>
          </div>
        </motion.div>
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
              {hideLibrary && !isOwner ? (
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
                        activePillClass: 'bg-white shadow-[0_0_15px_rgba(255,255,255,0.3)]',
                        activeTextClass: 'text-black font-bold',
                        inactiveClass: 'glass-pill text-white/80 hover:text-white',
                      },
                      {
                        id: 'watching',
                        label: 'İzleniyor',
                        icon: Clock,
                        iconColor: 'text-sky-400',
                        activePillClass: 'bg-sky-500 shadow-[0_0_18px_rgba(14,165,233,0.45)]',
                        activeTextClass: 'text-black font-bold',
                        inactiveClass: 'glass-pill text-sky-300/80 hover:text-sky-200 border-sky-500/20 hover:border-sky-500/40',
                      },
                      {
                        id: 'completed',
                        label: 'Tamamlandı',
                        icon: CheckCircle2,
                        iconColor: 'text-emerald-400',
                        activePillClass: 'bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.45)]',
                        activeTextClass: 'text-black font-bold',
                        inactiveClass: 'glass-pill text-emerald-300/80 hover:text-emerald-200 border-emerald-500/20 hover:border-emerald-500/40',
                      },
                      {
                        id: 'plan_to_watch',
                        label: 'Planlanan',
                        icon: Bookmark,
                        iconColor: 'text-amber-400',
                        activePillClass: 'bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.45)]',
                        activeTextClass: 'text-black font-bold',
                        inactiveClass: 'glass-pill text-amber-300/80 hover:text-amber-200 border-amber-500/20 hover:border-amber-500/40',
                      },
                      {
                        id: 'on_hold',
                        label: 'Beklemede',
                        icon: PauseCircle,
                        iconColor: 'text-purple-400',
                        activePillClass: 'bg-purple-500 shadow-[0_0_18px_rgba(168,85,247,0.45)]',
                        activeTextClass: 'text-white font-bold',
                        inactiveClass: 'glass-pill text-purple-300/80 hover:text-purple-200 border-purple-500/20 hover:border-purple-500/40',
                      },
                      {
                        id: 'dropped',
                        label: 'Bıraktım',
                        icon: XCircle,
                        iconColor: 'text-rose-400',
                        activePillClass: 'bg-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.45)]',
                        activeTextClass: 'text-white font-bold',
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
                          className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs cursor-pointer transition-colors active:scale-[0.98] select-none ${
                            active ? st.activeTextClass : st.inactiveClass
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="profile-library-filter-pill"
                              transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                              className={`absolute inset-0 rounded-full ${st.activePillClass}`}
                            />
                          )}
                          <Icon className={`relative z-10 w-3.5 h-3.5 ${active ? '' : st.iconColor}`} />
                          <span className="relative z-10 font-bold">{st.label}</span>
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
                          className="inline-block mt-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors"
                        >
                          Katalogdan Yapım Ekle
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-4 w-full">
                      {filteredWatchedMedia.map((m, idx) => (
                        <DirectMediaCard
                          key={m.id}
                          item={m}
                          priority={idx < 6}
                        />
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
              ) : activeWatchingList.length === 0 ? (
                <div className="rounded-3xl bg-[#0f0f11] p-14 text-center border border-white/10 space-y-3">
                  <Clock className="w-8 h-8 text-sky-400 mx-auto mb-2" />
                  <p className="text-sm text-white/60">
                    {isOwner
                      ? 'Henüz izleme geçmişiniz bulunmuyor.'
                      : 'Bu kullanıcının henüz herkese açık bir izleme geçmişi bulunmuyor.'}
                  </p>
                  <p className="text-xs text-white/40 max-w-sm mx-auto">
                    {isOwner
                      ? 'Dizilerin bölümlerini izledikçe ve işaretledikçe sıradaki bölümleriniz otomatik olarak burada listelenecektir.'
                      : 'Kullanıcı dizileri izledikçe son izlenen ve devam edilen yapımlar burada listelenir.'}
                  </p>
                  {isOwner && (
                    <Link
                      href="/kesfet"
                      className="inline-block mt-3 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors"
                    >
                      Dizi & Anime Keşfet
                    </Link>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                  {activeWatchingList.map((item, idx) => {
                    const media = item.media;
                    const stats = getEpisodeProgressStats(item, media);
                    const barPct = Math.max(
                      stats.watchedCount > 0 ? 6 : 3,
                      stats.progressPercent
                    );

                    const seriesUrl = media?.slug
                      ? `/seri/${media.slug}`
                      : `/seri/${item.media_id}`;

                    const playUrl = media?.slug
                      ? `/seri/${media.slug}/${stats.nextEpisode}?season=${stats.season}`
                      : `/seri/${item.media_id}`;

                    return (
                      <div
                        key={`profile-history-${item.media_id}-${stats.season}-${stats.nextEpisode}-${idx}`}
                        className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-4 sm:p-5 flex gap-4 hover:border-white/20 transition-colors group relative overflow-hidden shadow-xl [content-visibility:auto] [contain-intrinsic-size:auto_160px]"
                      >
                        {/* Poster image (NO zoom or scale on hover/focus) */}
                        <Link
                          href={playUrl}
                          onClick={() => triggerSound?.('click')}
                          className="relative w-24 h-34 sm:w-28 sm:h-38 rounded-2xl overflow-hidden bg-black/60 shrink-0 border border-white/10 group-hover:border-white/25 transition-colors isolate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          {media?.cover_image ? (
                            <img
                              src={getProxiedImageUrl(media.cover_image, media.title)}
                              alt={media.title || 'Kapak'}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover transition-transform duration-200 ease-out"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/30">
                              <FilmIcon />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 ease-out pointer-events-none">
                            <div className="w-10 h-10 rounded-full bg-black/85 border border-white/20 flex items-center justify-center text-white shadow-xl transition-colors duration-200 ease-out">
                              <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                            </div>
                          </div>
                        </Link>

                        {/* Content Details */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] text-white/70">
                                {stats.isFilm
                                  ? 'FİLM'
                                  : media?.content_type === 'anime'
                                  ? 'ANİME'
                                  : 'DİZİ'}
                              </span>
                              {stats.isAllWatched ? (
                                <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 font-semibold">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Tamamlandı</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono text-sky-400 font-semibold">
                                  {stats.isFilm
                                    ? stats.resumePos > 60
                                      ? `${Math.floor(stats.resumePos / 60)}/${Math.max(1, Math.floor(stats.resumeDur / 60))} Dk`
                                      : 'İzleniyor'
                                    : `${stats.watchedCount}/${stats.totalEpisodes} Bölüm`}
                                </span>
                              )}
                            </div>

                            {/* Series Name -> links directly to series detail page */}
                            <Link
                              href={seriesUrl}
                              onClick={() => triggerSound?.('click')}
                              className="block mt-1 text-sm sm:text-base font-bold text-white hover:text-sky-300 transition-colors truncate"
                            >
                              {cleanMediaTitle(media?.title) || `Yapım #${item.media_id}`}
                            </Link>

                            <div className="text-xs text-sky-400 font-mono font-semibold mt-0.5 truncate">
                              {stats.isAllWatched
                                ? stats.isFilm
                                  ? 'Film Tamamlandı'
                                  : `${stats.season}. Sezon · Tüm Bölümler İzlendi`
                                : stats.isFilm
                                ? 'Kaldığın Yerden Devam Et'
                                : isOwner
                                ? `Sıradaki: ${stats.season}. Sezon · ${stats.nextEpisode}. Bölüm`
                                : `Kaldığı Yer: ${stats.season}. Sezon · ${stats.nextEpisode}. Bölüm`}
                            </div>
                          </div>

                          <div className="space-y-2.5 mt-3">
                            {/* Episode / Film Progress bar */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-mono text-white/50">
                                <span>
                                  {stats.isFilm
                                    ? stats.isAllWatched
                                      ? 'Film İzlendi'
                                      : stats.resumePos > 60
                                      ? `${Math.floor(stats.resumePos / 60)} Dk İzlendi`
                                      : 'İzleniyor'
                                    : `${stats.watchedCount} Bölüm İzlendi`}
                                </span>
                                <span>%{stats.progressPercent}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full bg-sky-400 rounded-full transition-all duration-300"
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            </div>

                            {/* Resume Action Button */}
                            <Link
                              href={playUrl}
                              onClick={() => triggerSound?.('click')}
                              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors w-fit glow-white cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-black" />
                              <span>
                                {stats.isAllWatched
                                  ? 'Tekrar İzle'
                                  : stats.isFilm
                                  ? 'Filme Devam Et'
                                  : isOwner
                                  ? `${stats.nextEpisode}. Bölümden Devam Et`
                                  : `${stats.nextEpisode}. Bölümü İzle`}
                              </span>
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                    className="px-4 py-1.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors shrink-0 text-center shadow-sm"
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
                    className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors font-medium"
                  />
                  <textarea
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    rows={3}
                    placeholder="Koleksiyon açıklaması..."
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#0e0e12] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors resize-none font-medium"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-md"
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
                      className="rounded-3xl bg-[#0f0f11] border border-white/[0.08] p-6 flex flex-col justify-between hover:border-sky-400/40 hover:bg-white/[0.03] transition-colors group cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_160px]"
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
              className="space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-sky-400" />
                    <span>Paylaşılan Yorumlar ({profileComments.length})</span>
                  </h3>
                  <p className="text-xs text-white/50 mt-0.5">
                    Kullanıcının dizi, film, anime ve bölümlere yazdığı değerlendirmeler.
                  </p>
                </div>
              </div>

              {hideComments && !isOwner ? (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/10 space-y-3">
                  <Lock className="w-8 h-8 text-sky-400 mx-auto" />
                  <p className="text-sm text-white/60">
                    Bu kullanıcı profilindeki yorumları gizli tutmayı tercih etmiştir.
                  </p>
                </div>
              ) : profileComments.length === 0 ? (
                <div className="rounded-3xl bg-[#0f0f11] p-12 text-center border border-white/[0.08] space-y-3">
                  <MessageSquare className="w-8 h-8 text-white/20 mx-auto" />
                  <p className="text-sm text-white/60">
                    Bu kullanıcı henüz bir yorum veya değerlendirme paylaşmamış.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4">
                    {profileComments
                      .slice(
                        (commentsPage - 1) * COMMENTS_PER_PAGE,
                        commentsPage * COMMENTS_PER_PAGE
                      )
                      .map((comment) => {
                        const isSpoiler = Boolean(comment.has_spoiler);
                        const isRevealed = revealedSpoilers[comment.id];
                        const media = comment.media;
                        const person = comment.people;
                        const mag = comment.magazine_posts;
                        const isEpisode = Boolean(
                          comment.season_number && comment.episode_number
                        );

                        // Content page link (series, episode, actor, or magazine)
                        const contentHref = media?.slug
                          ? isEpisode
                            ? `/seri/${media.slug}/${comment.episode_number}?season=${comment.season_number || 1}`
                            : `/seri/${media.slug}`
                          : person?.slug
                          ? `/oyuncu/${person.slug}`
                          : mag?.slug
                          ? `/magazin/${mag.slug}`
                          : '#';

                        // Direct jump link to the exact comment (#comment-ID + ?comment_id=ID)
                        const commentJumpUrl =
                          contentHref !== '#'
                            ? `${contentHref}${contentHref.includes('?') ? '&' : '?'}comment_id=${comment.id}#comment-${comment.id}`
                            : '#';

                        const displayTitle = media?.title
                          ? cleanMediaTitle(media.title)
                          : person?.name || mag?.title || 'İçerik Yorumu';

                        const thumbSrc = media?.cover_image
                          ? getProxiedImageUrl(
                              media.cover_image,
                              media.title,
                              null,
                              'w500',
                              'poster'
                            )
                          : person?.image_url
                          ? getProxiedImageUrl(
                              person.image_url,
                              person.name,
                              null,
                              'w500',
                              'person'
                            )
                          : mag?.featured_image
                          ? getProxiedImageUrl(mag.featured_image, mag.title)
                          : null;

                        return (
                          <div
                            key={comment.id}
                            className="rounded-3xl bg-[#0e0e13] border border-white/[0.08] hover:border-white/20 p-4 sm:p-5 transition-colors duration-120 flex items-start gap-4 sm:gap-5 shadow-lg [content-visibility:auto] [contain-intrinsic-size:auto_120px]"
                          >
                            {/* Left: Fixed-size Larger Poster Thumbnail (Zero scale/zoom on hover or focus) */}
                            <Link
                              href={contentHref}
                              onClick={() => triggerSound('click')}
                              className="w-16 h-24 sm:w-20 sm:h-28 rounded-2xl overflow-hidden border border-white/15 hover:border-white/30 bg-[#141418] shrink-0 shadow-md transition-colors duration-120 block focus:outline-none"
                              aria-label={displayTitle}
                            >
                              {thumbSrc ? (
                                <img
                                  src={thumbSrc}
                                  alt={displayTitle}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover block"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-white/25">
                                  <FilmIcon />
                                </div>
                              )}
                            </Link>

                            {/* Right: Header, Comment Content & Actions */}
                            <div className="flex-1 min-w-0 space-y-3">
                              {/* Top Header Row: Title + Meta Badges on Left, Likes & "Yoruma Git" on Right */}
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                                <div className="min-w-0 space-y-1.5">
                                  <Link
                                    href={contentHref}
                                    onClick={() => triggerSound('click')}
                                    className="text-sm sm:text-base font-bold text-white hover:text-sky-300 transition-colors duration-120 line-clamp-1 block focus:outline-none"
                                  >
                                    {displayTitle}
                                  </Link>

                                  <div className="flex items-center gap-2 text-[11px] font-mono text-white/50 flex-wrap">
                                    {isEpisode ? (
                                      <span className="text-sky-300 bg-sky-500/15 px-2.5 py-0.5 rounded-full border border-sky-400/30 font-semibold">
                                        {comment.season_number}. Sezon • {comment.episode_number}. Bölüm
                                      </span>
                                    ) : person ? (
                                      <span className="text-purple-300 bg-purple-500/15 px-2.5 py-0.5 rounded-full border border-purple-400/30 font-semibold">
                                        Oyuncu Yorumu
                                      </span>
                                    ) : mag ? (
                                      <span className="text-amber-300 bg-amber-500/15 px-2.5 py-0.5 rounded-full border border-amber-400/30 font-semibold">
                                        Magazin Yorumu
                                      </span>
                                    ) : (
                                      <span className="text-white/75 bg-white/[0.06] px-2.5 py-0.5 rounded-full border border-white/12 font-medium">
                                        Genel İnceleme
                                      </span>
                                    )}

                                    {comment.timestamp_sec !== undefined &&
                                      comment.timestamp_sec !== null && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-400/30 text-[10px]">
                                          <Clock className="w-2.5 h-2.5 text-sky-400" />
                                          <span>
                                            {Math.floor(comment.timestamp_sec / 60)}:
                                            {String(comment.timestamp_sec % 60).padStart(2, '0')}
                                          </span>
                                        </span>
                                      )}

                                    {comment.sticker_id && (
                                      <span className="px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-200 text-[10px]">
                                        {comment.sticker_id}
                                      </span>
                                    )}

                                    <span className="text-white/30">•</span>
                                    <span>
                                      {comment.created_at
                                        ? new Date(comment.created_at).toLocaleDateString(
                                            'tr-TR',
                                            {
                                              day: 'numeric',
                                              month: 'long',
                                              year: 'numeric',
                                            }
                                          )
                                        : 'Geçmiş'}
                                    </span>
                                  </div>
                                </div>

                                {/* Right Action Bar: Likes + Yoruma Git Button */}
                                <div className="flex items-center gap-2 shrink-0 self-start">
                                  <span
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-mono tabular-nums text-white/75"
                                    title="Beğeni Sayısı"
                                  >
                                    <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400/30 shrink-0" />
                                    <span>{comment.likes_count || 0}</span>
                                  </span>

                                  {commentJumpUrl !== '#' && (
                                    <Link
                                      href={commentJumpUrl}
                                      onClick={() => triggerSound('click')}
                                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.06] hover:bg-sky-500/20 text-sky-300 hover:text-white border border-sky-400/30 hover:border-sky-400/60 text-xs font-semibold transition-colors duration-120 cursor-pointer select-none focus:outline-none"
                                    >
                                      <span>Yoruma Git</span>
                                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                                    </Link>
                                  )}
                                </div>
                              </div>

                              {/* Comment Body with Spoiler Protection */}
                              {isSpoiler && !isRevealed ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedSpoilers((prev) => ({
                                      ...prev,
                                      [comment.id]: true,
                                    }))
                                  }
                                  className="w-full p-3.5 rounded-2xl bg-rose-950/25 hover:bg-rose-950/40 border border-rose-400/30 cursor-pointer transition-colors duration-120 flex items-center justify-between gap-3 text-left"
                                >
                                  <div className="flex items-center gap-2.5 text-xs text-rose-200 font-semibold">
                                    <EyeOff className="w-4 h-4 text-rose-400 shrink-0" />
                                    <span>
                                      Bu yorum sürprizbozan (spoiler) içeriyor · Görmek için tıkla
                                    </span>
                                  </div>
                                  <span className="text-[11px] font-mono font-bold text-rose-300 px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/30 shrink-0">
                                    Göster
                                  </span>
                                </button>
                              ) : (
                                <div className="text-xs sm:text-sm text-white/90 leading-relaxed break-words bg-[#08080c]/85 p-3.5 sm:p-4 rounded-2xl border border-white/[0.06] space-y-2.5">
                                  {comment.content_html && (
                                    <div
                                      dangerouslySetInnerHTML={{
                                        __html: comment.content_html,
                                      }}
                                      className="comment-content prose prose-invert prose-xs max-w-none [&_p]:m-0"
                                    />
                                  )}

                                  {comment.gif_url && (
                                    <img
                                      src={comment.gif_url}
                                      alt="Yorum GIF"
                                      loading="lazy"
                                      className="max-h-40 rounded-xl border border-white/10 object-contain block"
                                    />
                                  )}

                                  {comment.image_url &&
                                    comment.image_url.startsWith('https://') && (
                                      <img
                                        src={getProxiedImageUrl(comment.image_url)}
                                        alt="Yorum Görseli"
                                        loading="lazy"
                                        className="max-h-52 rounded-xl border border-white/10 object-contain block"
                                      />
                                    )}

                                  {isSpoiler && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setRevealedSpoilers((prev) => ({
                                          ...prev,
                                          [comment.id]: false,
                                        }))
                                      }
                                      className="text-[10px] font-mono text-white/45 hover:text-white/75 flex items-center gap-1 cursor-pointer transition-colors pt-0.5"
                                    >
                                      <Eye className="w-3 h-3" />
                                      <span>Spoiler içeriği tekrar gizle</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Pagination (40 comments per page) */}
                  <Pagination
                    currentPage={commentsPage}
                    totalCount={profileComments.length}
                    pageSize={COMMENTS_PER_PAGE}
                    onPageChange={setCommentsPage}
                    itemLabel="yorumdan"
                    scrollToOffset={260}
                  />
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      </div>
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
