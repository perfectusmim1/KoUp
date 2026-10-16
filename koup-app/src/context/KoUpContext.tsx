'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  supabase,
  MediaItem,
  UserProfile,
  UserMediaProgress,
} from '@/lib/supabase';
import { playNotificationChime, SoundTone } from '@/lib/sound';

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'episode' | 'actor' | 'reply' | 'success';
  linkUrl?: string;
  createdAt: string;
  isRead: boolean;
}

interface KoUpContextValue {
  user: UserProfile | null;
  profile: UserProfile | null;
  progressMap: Record<number, UserMediaProgress>;
  continueWatchingList: UserMediaProgress[];
  favPersonIds: number[];
  personFavorites: number[];
  followedMediaIds: number[];
  followedPersonIds: number[];
  notifications: ToastNotification[];
  activeToast: ToastNotification | null;
  soundEnabled: boolean;
  toggleSound: () => void;
  triggerSound: (kind?: string) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (v: boolean) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (v: boolean) => void;
  isRouletteOpen: boolean;
  setIsRouletteOpen: (v: boolean) => void;
  unreadCount: number;
  updateWatchStatus: (
    mediaId: number,
    status: UserMediaProgress['status'],
    season?: number,
    episode?: number
  ) => void;
  updateEpisodeProgress: (
    media: MediaItem,
    seasonNum: number,
    episodeNum: number,
    episodeTitle: string,
    positionSec: number,
    durationSec: number,
    markCompletedEpisode?: boolean
  ) => void;
  toggleEpisodeWatched: (media: MediaItem, episodeNum: number, upToHere?: boolean) => void;
  setLibraryStatus: (
    media: MediaItem,
    status: UserMediaProgress['status'],
    score?: number
  ) => void;
  toggleMediaFavorite: (media: MediaItem) => void;
  toggleMediaFollow: (media: MediaItem) => void;
  togglePersonFavorite: (personId: number, personName?: string) => Promise<number>;
  togglePersonFollow: (personId: number, personName?: string) => void;
  pushNotification: (
    title: string,
    body: string,
    type?: ToastNotification['type'],
    linkUrl?: string
  ) => void;
  markAllNotificationsRead: () => void;
  markNotificationsRead: () => void;
  dismissToast: () => void;
  updateProfileSettings: (patch: Partial<UserProfile>) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<string | null>;
  registerWithEmail: (
    email: string,
    password: string,
    username: string
  ) => Promise<string | null>;
  logout: () => Promise<void>;
}

const DEFAULT_NOTIFICATION_SETTINGS = {
  sound_enabled: true,
  sound_tone: 'apple_glass' as const,
  sound_volume: 0.7,
  mute_during_fullscreen: true,
  notify_new_episode: true,
  notify_followed_actor: true,
  notify_comment_reply: true,
  notify_list_activity: true,
};

const KoUpContext = createContext<KoUpContextValue | null>(null);

export function KoUpProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [progressMap, setProgressMap] = useState<Record<number, UserMediaProgress>>({});
  const [favPersonIds, setFavPersonIds] = useState<number[]>([]);
  const [followedMediaIds, setFollowedMediaIds] = useState<number[]>([]);
  const [followedPersonIds, setFollowedPersonIds] = useState<number[]>([]);
  const [notifications, setNotifications] = useState<ToastNotification[]>([
    {
      id: 'notif-comment-1',
      title: 'Yorumuna Yeni Yanıt Geldi',
      body: '@elif_kdrama: "Kesinlikle katılıyorum, 1. bölüm son sahnesi efsaneydi!"',
      type: 'reply',
      linkUrl: '/seri/reply-izle/1',
      createdAt: '10 dk önce',
      isRead: false,
    },
    {
      id: 'notif-ep-1',
      title: 'Takip Ettiğin Dizide Yeni Bölüm!',
      body: '"Reply 1988" dizisinin 2. bölümü arşive yüklendi.',
      type: 'episode',
      linkUrl: '/seri/reply-izle/2',
      createdAt: '25 dk önce',
      isRead: false,
    },
    {
      id: 'notif-actor-1',
      title: 'Takip Ettiğin Oyuncudan Yeni Yapım!',
      body: 'Yoo In Na kadrosunda yer aldığı "Touch Your Heart" yayına girdi.',
      type: 'actor',
      linkUrl: '/seri/reply-izle/1',
      createdAt: '2 saat önce',
      isRead: true,
    },
  ]);
  const [activeToast, setActiveToast] = useState<ToastNotification | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isRouletteOpen, setIsRouletteOpen] = useState(false);

  // Load persisted state from localStorage + Supabase Auth
  useEffect(() => {
    try {
      const savedProg = localStorage.getItem('koup_progress_v1');
      if (savedProg) setProgressMap(JSON.parse(savedProg));
      const savedFavP = localStorage.getItem('koup_fav_people_v1');
      if (savedFavP) setFavPersonIds(JSON.parse(savedFavP));
      const savedFolM = localStorage.getItem('koup_fol_media_v1');
      if (savedFolM) setFollowedMediaIds(JSON.parse(savedFolM));
      const savedFolP = localStorage.getItem('koup_fol_people_v1');
      if (savedFolP) setFollowedPersonIds(JSON.parse(savedFolP));
      const savedProf = localStorage.getItem('koup_profile_v1');
      if (savedProf) {
        const parsed = JSON.parse(savedProf);
        // Discard any stale mock admin user
        if (parsed && parsed.id !== 'local-cinema-member') {
          setUser(parsed);
        } else {
          localStorage.removeItem('koup_profile_v1');
        }
      }
    } catch {
      // ignore storage errors
    }

    // Check real Supabase session & sync profile
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) {
        const uid = data.session.user.id;
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .single();
        if (prof) {
          setUser(prof as UserProfile);
          localStorage.setItem('koup_profile_v1', JSON.stringify(prof));
        }
      } else {
        setUser(null);
        localStorage.removeItem('koup_profile_v1');
      }
    };
    loadSession();

    // Listen to real Supabase auth state transitions
    const { data: authSub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        if (prof) {
          setUser(prof as UserProfile);
          localStorage.setItem('koup_profile_v1', JSON.stringify(prof));
        }
      } else {
        setUser(null);
        localStorage.removeItem('koup_profile_v1');
      }
    });

    // Global Cmd+K / Ctrl+K shortcut for instant search
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      authSub.subscription.unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const pushNotification = useCallback(
    (
      title: string,
      body: string,
      type: ToastNotification['type'] = 'info',
      linkUrl?: string
    ) => {
      const item: ToastNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        type,
        linkUrl,
        createdAt: 'Şimdi',
        isRead: false,
      };
      setNotifications((prev) => [item, ...prev.slice(0, 29)]);
      setActiveToast(item);

      const settings = user?.notification_settings || DEFAULT_NOTIFICATION_SETTINGS;
      if (settings.sound_enabled) {
        playNotificationChime(
          (settings.sound_tone as SoundTone) || 'apple_glass',
          settings.sound_volume ?? 0.7,
          settings.mute_during_fullscreen ?? true
        );
      }

      setTimeout(() => {
        setActiveToast((curr) => (curr?.id === item.id ? null : curr));
      }, 4500);
    },
    [user]
  );

  const saveProgressMap = useCallback((nextMap: Record<number, UserMediaProgress>) => {
    // Anti-bloat cap: Keep max 30 active continue-watching items in local buffer
    setProgressMap(nextMap);
    try {
      localStorage.setItem('koup_progress_v1', JSON.stringify(nextMap));
    } catch {
      // ignore
    }
  }, []);

  const updateEpisodeProgress = useCallback(
    (
      media: MediaItem,
      seasonNum: number,
      episodeNum: number,
      episodeTitle: string,
      positionSec: number,
      durationSec: number,
      markCompletedEpisode = false
    ) => {
      setProgressMap((prev) => {
        const existing = prev[media.id] || {
          media_id: media.id,
          status: 'watching',
          is_favorite: false,
          watched_episodes: [],
          last_season_num: seasonNum,
          last_episode_num: episodeNum,
          last_episode_title: episodeTitle,
          resume_position_sec: positionSec,
          resume_duration_sec: durationSec || 3600,
          updated_at: new Date().toISOString(),
          media,
        };

        const watchedSet = new Set(existing.watched_episodes || []);
        if (markCompletedEpisode || (durationSec > 0 && positionSec / durationSec >= 0.85)) {
          watchedSet.add(episodeNum);
        }

        const updated: UserMediaProgress = {
          ...existing,
          status:
            media.episode_count > 0 && watchedSet.size >= media.episode_count
              ? 'completed'
              : 'watching',
          watched_episodes: Array.from(watchedSet).sort((a, b) => a - b),
          last_season_num: seasonNum,
          last_episode_num: episodeNum,
          last_episode_title: episodeTitle,
          resume_position_sec: Math.floor(positionSec),
          resume_duration_sec: Math.floor(durationSec || 3600),
          updated_at: new Date().toISOString(),
          media,
        };

        const next = { ...prev, [media.id]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const toggleEpisodeWatched = useCallback(
    (media: MediaItem, episodeNum: number, upToHere = false) => {
      setProgressMap((prev) => {
        const existing = prev[media.id] || {
          media_id: media.id,
          status: 'watching',
          is_favorite: false,
          watched_episodes: [],
          last_season_num: 1,
          last_episode_num: episodeNum,
          last_episode_title: `${episodeNum}. Bölüm`,
          resume_position_sec: 0,
          resume_duration_sec: 3600,
          updated_at: new Date().toISOString(),
          media,
        };

        const watchedSet = new Set(existing.watched_episodes || []);
        if (upToHere) {
          for (let i = 1; i <= episodeNum; i++) watchedSet.add(i);
          pushNotification(
            'Toplu İzlendi İşaretlendi',
            `${media.title} · 1-${episodeNum}. bölümler izlendi olarak kaydedildi.`,
            'success'
          );
        } else {
          if (watchedSet.has(episodeNum)) {
            watchedSet.delete(episodeNum);
          } else {
            watchedSet.add(episodeNum);
          }
        }

        const updated: UserMediaProgress = {
          ...existing,
          watched_episodes: Array.from(watchedSet).sort((a, b) => a - b),
          last_episode_num: episodeNum,
          updated_at: new Date().toISOString(),
          media,
        };

        const next = { ...prev, [media.id]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [pushNotification]
  );

  const setLibraryStatus = useCallback(
    (media: MediaItem, status: UserMediaProgress['status'], score?: number) => {
      const existing = progressMap[media.id];
      const updated: UserMediaProgress = {
        media_id: media.id,
        status,
        is_favorite: existing?.is_favorite ?? false,
        user_score: score ?? existing?.user_score ?? null,
        watched_episodes: existing?.watched_episodes ?? [],
        last_season_num: existing?.last_season_num ?? 1,
        last_episode_num: existing?.last_episode_num ?? 1,
        last_episode_title: existing?.last_episode_title ?? '1. Bölüm',
        resume_position_sec: existing?.resume_position_sec ?? 0,
        resume_duration_sec: existing?.resume_duration_sec ?? 3600,
        updated_at: new Date().toISOString(),
        media,
      };
      saveProgressMap({ ...progressMap, [media.id]: updated });
    },
    [progressMap, saveProgressMap]
  );

  const toggleMediaFavorite = useCallback(
    (media: MediaItem) => {
      const existing = progressMap[media.id];
      const nextFav = !(existing?.is_favorite ?? false);
      const updated: UserMediaProgress = {
        media_id: media.id,
        status: existing?.status ?? 'watching',
        is_favorite: nextFav,
        user_score: existing?.user_score ?? null,
        watched_episodes: existing?.watched_episodes ?? [],
        last_season_num: existing?.last_season_num ?? 1,
        last_episode_num: existing?.last_episode_num ?? 1,
        resume_position_sec: existing?.resume_position_sec ?? 0,
        resume_duration_sec: existing?.resume_duration_sec ?? 3600,
        updated_at: new Date().toISOString(),
        media,
      };
      saveProgressMap({ ...progressMap, [media.id]: updated });
    },
    [progressMap, saveProgressMap]
  );

  const toggleMediaFollow = useCallback(
    (media: MediaItem) => {
      setFollowedMediaIds((prev) => {
        const exists = prev.includes(media.id);
        const next = exists ? prev.filter((id) => id !== media.id) : [...prev, media.id];
        try {
          localStorage.setItem('koup_fol_media_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const togglePersonFavorite = useCallback(
    async (personId: number, personName?: string): Promise<number> => {
      const isFav = favPersonIds.includes(personId);
      const next = isFav
        ? favPersonIds.filter((id) => id !== personId)
        : [...favPersonIds, personId];
      setFavPersonIds(next);
      try {
        localStorage.setItem('koup_fav_people_v1', JSON.stringify(next));
      } catch {
        // ignore
      }

      const delta = isFav ? -1 : 1;
      const expectedCount = isFav ? Math.max(0, favPersonIds.length - 1) : favPersonIds.length + 1;

      // Non-blocking fire-and-forget sync to Supabase (zero UI lag)
      void Promise.resolve(
        supabase.rpc('increment_person_favorite', {
          p_person_id: personId,
          p_delta: delta,
        })
      ).catch(() => {});

      return expectedCount;
    },
    [favPersonIds]
  );

  const togglePersonFollow = useCallback(
    (personId: number, personName?: string) => {
      setFollowedPersonIds((prev) => {
        const exists = prev.includes(personId);
        const next = exists ? prev.filter((id) => id !== personId) : [...prev, personId];
        try {
          localStorage.setItem('koup_fol_people_v1', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, []);

  const dismissToast = useCallback(() => {
    setActiveToast(null);
  }, []);

  const updateProfileSettings = useCallback(
    async (patch: Partial<UserProfile>) => {
      setUser((prev) => {
        if (!prev) return null;
        const updated = { ...prev, ...patch };
        try {
          localStorage.setItem('koup_profile_v1', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
      if (user?.id) {
        await supabase.from('profiles').update(patch).eq('id', user.id);
      }
      pushNotification('Ayarlar Kaydedildi', 'Profil ve bildirim tercihlerin güncellendi.', 'success');
    },
    [user?.id, pushNotification]
  );

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      if (data.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();
        if (prof) {
          setUser(prof as UserProfile);
          localStorage.setItem('koup_profile_v1', JSON.stringify(prof));
          pushNotification('Giriş Başarılı', `Tekrar hoş geldin, ${prof.display_name || prof.username}!`, 'success');
        }
      }
      return null;
    },
    [pushNotification]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, username: string): Promise<string | null> => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username, display_name: username },
        },
      });
      if (error) return error.message;
      if (data.user) {
        // Wait 600ms for Postgres handle_new_user trigger to populate profiles
        await new Promise((r) => setTimeout(r, 600));
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();
        if (prof) {
          setUser(prof as UserProfile);
          localStorage.setItem('koup_profile_v1', JSON.stringify(prof));
        } else {
          const fallback: UserProfile = {
            id: data.user.id,
            username,
            display_name: username,
            role: 'user',
            is_private: false,
            hide_watch_history: false,
            notification_settings: DEFAULT_NOTIFICATION_SETTINGS,
            stats_episodes_watched: 0,
            stats_series_completed: 0,
            stats_movies_completed: 0,
            stats_anime_completed: 0,
            stats_total_minutes: 0,
            anilist_auto_sync: false,
          };
          setUser(fallback);
          localStorage.setItem('koup_profile_v1', JSON.stringify(fallback));
        }
        pushNotification('Hesap Oluşturuldu', `KoUp ailesine hoş geldin, ${username}!`, 'success');
      }
      return null;
    },
    [pushNotification]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('koup_profile_v1');
    pushNotification('Oturum Kapatıldı', 'Misafir sinema moduna geçildi.', 'info');
  }, [pushNotification]);

  const soundEnabled = Boolean(
    user?.notification_settings?.sound_enabled ?? true
  );

  const toggleSound = useCallback(() => {
    setUser((prev) => {
      if (!prev) return null;
      const nextSettings = {
        ...prev.notification_settings,
        sound_enabled: !prev.notification_settings?.sound_enabled,
      };
      const updated = { ...prev, notification_settings: nextSettings };
      try {
        localStorage.setItem('koup_profile_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const triggerSound = useCallback(
    (_kind?: string) => {
      // User request: Disable continuous UI interaction sounds; sound only plays when pushNotification arrives.
      return;
    },
    []
  );

  const continueWatchingList = Object.values(progressMap)
    .filter((p) => p.status === 'watching' && p.media)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 30);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const updateWatchStatus = useCallback(
    (
      mediaId: number,
      status: UserMediaProgress['status'],
      season = 1,
      episode = 1
    ) => {
      setProgressMap((prev) => {
        const existing = prev[mediaId];
        const updated: UserMediaProgress = existing
          ? {
              ...existing,
              status,
              last_season_num: season,
              last_episode_num: episode,
              updated_at: new Date().toISOString(),
            }
          : {
              media_id: mediaId,
              status,
              is_favorite: false,
              watched_episodes: [],
              last_season_num: season,
              last_episode_num: episode,
              resume_position_sec: 0,
              resume_duration_sec: 3600,
              updated_at: new Date().toISOString(),
            };
        const next = { ...prev, [mediaId]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {}
        return next;
      });
      pushNotification('Liste Güncellendi', 'İçerik tercihiniz kaydedildi.', 'success');
    },
    [pushNotification]
  );

  return (
    <KoUpContext.Provider
      value={{
        user,
        profile: user,
        progressMap,
        continueWatchingList,
        favPersonIds,
        personFavorites: favPersonIds,
        followedMediaIds,
        followedPersonIds,
        notifications,
        unreadCount,
        updateWatchStatus,
        activeToast,
        soundEnabled,
        toggleSound,
        triggerSound,
        isSearchOpen,
        setIsSearchOpen,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isRouletteOpen,
        setIsRouletteOpen,
        updateEpisodeProgress,
        toggleEpisodeWatched,
        setLibraryStatus,
        toggleMediaFavorite,
        toggleMediaFollow,
        togglePersonFavorite,
        togglePersonFollow,
        pushNotification,
        markAllNotificationsRead,
        markNotificationsRead: markAllNotificationsRead,
        dismissToast,
        updateProfileSettings,
        loginWithEmail,
        registerWithEmail,
        logout,
      }}
    >
      {children}
    </KoUpContext.Provider>
  );
}

export function useKoUp() {
  const ctx = useContext(KoUpContext);
  if (!ctx) throw new Error('useKoUp must be used inside KoUpProvider');
  return ctx;
}
