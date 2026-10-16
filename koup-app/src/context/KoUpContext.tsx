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

const DEFAULT_PROFILE: UserProfile = {
  id: 'local-cinema-member',
  username: 'koup_sinema',
  display_name: 'KoUp VIP Üye',
  avatar_url: null,
  banner_url: 'https://image.tmdb.org/t/p/original/rAOjnEFTuNysY7bot8zonhImGMh.jpg',
  bio: 'K-Drama, C-Drama ve Anime tutkunu · KoUp Sinema Koleksiyoneri',
  role: 'admin',
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
  stats_episodes_watched: 48,
  stats_series_completed: 6,
  stats_movies_completed: 4,
  stats_anime_completed: 5,
  stats_total_minutes: 2840,
  mdl_username: '',
  anilist_username: '',
  anilist_auto_sync: true,
};

const KoUpContext = createContext<KoUpContextValue | null>(null);

export function KoUpProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(DEFAULT_PROFILE);
  const [progressMap, setProgressMap] = useState<Record<number, UserMediaProgress>>({});
  const [favPersonIds, setFavPersonIds] = useState<number[]>([]);
  const [followedMediaIds, setFollowedMediaIds] = useState<number[]>([]);
  const [followedPersonIds, setFollowedPersonIds] = useState<number[]>([]);
  const [notifications, setNotifications] = useState<ToastNotification[]>([
    {
      id: 'welcome-1',
      title: 'KoUp Sinema Evrenine Hoş Geldin',
      body: '17.509 dizi, film, anime ve 21.814 oyuncu/karakter Frankfurt Edge sunucusuyla aktif.',
      type: 'episode',
      linkUrl: '/kesfet',
      createdAt: 'Şimdi',
      isRead: false,
    },
    {
      id: 'sched-2',
      title: 'Yeni Bölüm Takvimi Güncellendi',
      body: 'Takip ettiğin dizilerin bu haftaki yayın saatleri ve geri sayımları hazır.',
      type: 'info',
      linkUrl: '/takvim',
      createdAt: '12 dk önce',
      isRead: false,
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
      if (savedProf) setUser(JSON.parse(savedProf));
    } catch {
      // ignore storage errors
    }

    // Check real Supabase session
    supabase.auth.getSession().then(async ({ data }) => {
      if (data?.session?.user) {
        const uid = data.session.user.id;
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', uid)
          .single();
        if (prof) {
          setUser({ ...DEFAULT_PROFILE, ...prof, role: prof.role || 'admin' });
        }
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
    return () => window.removeEventListener('keydown', onKeyDown);
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

      const settings = user?.notification_settings || DEFAULT_PROFILE.notification_settings;
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
      const labels: Record<string, string> = {
        watching: 'İzliyorum',
        completed: 'Tamamladım',
        plan_to_watch: 'İzleyeceğim',
        on_hold: 'Beklemede',
        dropped: 'Bıraktım',
      };
      pushNotification(
        'Kütüphane Güncellendi',
        `${media.title} "${labels[status] || status}" listene eklendi.`,
        'success'
      );
    },
    [progressMap, saveProgressMap, pushNotification]
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
      pushNotification(
        nextFav ? 'Favorilere Eklendi' : 'Favorilerden Çıkarıldı',
        `${media.title} favori listende güncellendi.`,
        'success'
      );
    },
    [progressMap, saveProgressMap, pushNotification]
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
        pushNotification(
          exists ? 'Takip Bırakıldı' : 'Seri Takibe Alındı',
          exists
            ? `${media.title} bildirimleri kapatıldı.`
            : `${media.title} için yeni bölüm yüklendiğinde anında sesli bildirim alacaksın.`,
          'episode'
        );
        return next;
      });
    },
    [pushNotification]
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
      const { data: curr } = await supabase
        .from('people')
        .select('favorites_count')
        .eq('id', personId)
        .single();
      const newCount = Math.max(0, (curr?.favorites_count || 10) + delta);

      pushNotification(
        isFav ? 'Favoriden Çıkarıldı' : 'Oyuncu / Karakter Favorilendi',
        personName
          ? `${personName} favori sıralamasında ${isFav ? 'güncellendi' : 'yükseldi'}!`
          : 'Favori tercihin kaydedildi.',
        'actor'
      );
      return newCount;
    },
    [favPersonIds, pushNotification]
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
        pushNotification(
          exists ? 'Oyuncu Takibi Bırakıldı' : 'Oyuncu Takibe Alındı',
          personName
            ? `${personName} yeni bir diziye veya AsyaMag haberine konu olduğunda bildirim alacaksın.`
            : 'Takip listen güncellendi.',
          'actor'
        );
        return next;
      });
    },
    [pushNotification]
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
        const updated = { ...(prev || DEFAULT_PROFILE), ...patch };
        try {
          localStorage.setItem('koup_profile_v1', JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
      pushNotification('Ayarlar Kaydedildi', 'Profil ve bildirim tercihlerin güncellendi.', 'success');
    },
    [pushNotification]
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
        const merged: UserProfile = {
          ...DEFAULT_PROFILE,
          ...(prof || {}),
          id: data.user.id,
          username: prof?.username || email.split('@')[0],
          display_name: prof?.display_name || email.split('@')[0],
        };
        setUser(merged);
        localStorage.setItem('koup_profile_v1', JSON.stringify(merged));
        pushNotification('Giriş Başarılı', `Tekrar hoş geldin, ${merged.display_name}!`, 'success');
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
        const merged: UserProfile = {
          ...DEFAULT_PROFILE,
          id: data.user.id,
          username,
          display_name: username,
        };
        setUser(merged);
        localStorage.setItem('koup_profile_v1', JSON.stringify(merged));
        pushNotification('Hesap Oluşturuldu', `KoUp ailesine hoş geldin, ${username}!`, 'success');
      }
      return null;
    },
    [pushNotification]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(DEFAULT_PROFILE);
    localStorage.removeItem('koup_profile_v1');
    pushNotification('Oturum Kapatıldı', 'Misafir sinema moduna geçildi.', 'info');
  }, [pushNotification]);

  const soundEnabled = Boolean(
    user?.notification_settings?.sound_enabled ?? true
  );

  const toggleSound = useCallback(() => {
    setUser((prev) => {
      const base = prev || DEFAULT_PROFILE;
      const nextSettings = {
        ...base.notification_settings,
        sound_enabled: !base.notification_settings.sound_enabled,
      };
      const updated = { ...base, notification_settings: nextSettings };
      try {
        localStorage.setItem('koup_profile_v1', JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const triggerSound = useCallback(
    (kind?: string) => {
      const settings =
        user?.notification_settings || DEFAULT_PROFILE.notification_settings;
      if (!settings.sound_enabled) return;
      playNotificationChime(
        kind === 'click'
          ? 'minimal_pop'
          : (settings.sound_tone as SoundTone) || 'apple_glass',
        kind === 'click' ? 0.35 : settings.sound_volume ?? 0.7,
        settings.mute_during_fullscreen ?? true
      );
    },
    [user]
  );

  const continueWatchingList = Object.values(progressMap)
    .filter((p) => p.status === 'watching' && p.media)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 30);

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
