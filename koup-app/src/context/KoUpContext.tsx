'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  supabase,
  MediaItem,
  UserProfile,
  UserMediaProgress,
} from '@/lib/supabase';
import { playNotificationChime, SoundTone } from '@/lib/sound';
import { invalidateCache } from '@/lib/cache';

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
  authLoading: boolean;
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
  markNotificationRead: (id: string) => void;
  markNotificationUnread: (id: string) => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
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
  const [authLoading, setAuthLoading] = useState(true);
  const [progressMap, setProgressMap] = useState<Record<number, UserMediaProgress>>({});
  const [favPersonIds, setFavPersonIds] = useState<number[]>([]);
  const [followedMediaIds, setFollowedMediaIds] = useState<number[]>([]);
  const [followedPersonIds, setFollowedPersonIds] = useState<number[]>([]);
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const [activeToast, setActiveToast] = useState<ToastNotification | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isRouletteOpen, setIsRouletteOpen] = useState(false);

  const isHydratedRef = useRef(false);
  const recentNotifsRef = useRef<Map<string, number>>(new Map());
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightProfileSyncRef = useRef<Map<string, Promise<UserProfile | null>>>(new Map());

  // Sync user profile strictly fresh from DB profiles table (memory-only dedupe, NEVER sessionStorage)
  const syncUserProfile = useCallback(async (userId: string, authUser?: any) => {
    try {
      let fetchPromise = inFlightProfileSyncRef.current.get(userId);
      if (!fetchPromise) {
        fetchPromise = (async () => {
          const { data: prof, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

          if (prof && !error) {
            return prof as UserProfile;
          }
          return null;
        })().finally(() => {
          inFlightProfileSyncRef.current.delete(userId);
        });
        inFlightProfileSyncRef.current.set(userId, fetchPromise);
      }

      const profile = await fetchPromise;

      if (profile) {
        // Profile role comes ONLY from database verification
        setUser(profile);
        try {
          // Cache locally for offline/instant basic UI but ALWAYS strip elevated role
          localStorage.setItem('koup_profile_v1', JSON.stringify({ ...profile, role: 'user' }));
        } catch {}
      } else if (authUser) {
        const fallback: UserProfile = {
          id: userId,
          username:
            authUser.user_metadata?.username ||
            authUser.email?.split('@')[0] ||
            'kullanici',
          display_name:
            authUser.user_metadata?.display_name ||
            authUser.email?.split('@')[0] ||
            'Kullanıcı',
          role: 'user', // Default unprivileged
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
      }

      // Fetch user notifications from Supabase if table exists
      const activeUserId = profile?.id || userId;
      if (activeUserId) {
        void supabase
          .from('user_notifications')
          .select('*')
          .eq('user_id', activeUserId)
          .order('created_at', { ascending: false })
          .limit(40)
          .then(({ data: dbNotifs }) => {
            if (dbNotifs && dbNotifs.length > 0) {
              const formatted: ToastNotification[] = dbNotifs.map((row: any) => ({
                id: row.id,
                title: row.title,
                body: row.body,
                type: (row.type === 'comment_reply' ? 'reply' : row.type === 'new_episode' ? 'episode' : row.type === 'actor_update' ? 'actor' : 'info') as ToastNotification['type'],
                linkUrl: row.link_url || undefined,
                createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString('tr-TR') : 'Şimdi',
                isRead: Boolean(row.is_read),
              }));
              setNotifications((prev) => {
                const map = new Map<string, ToastNotification>();
                formatted.forEach((n) => map.set(n.id, n));
                prev.forEach((n) => {
                  if (!map.has(n.id)) map.set(n.id, n);
                });
                const merged = Array.from(map.values()).slice(0, 50);
                try {
                  localStorage.setItem('koup_notifs_v1', JSON.stringify(merged));
                } catch {}
                return merged;
              });
            }
          });
      }
    } catch (err) {
      console.error('Error syncing user profile:', err);
    }
  }, []);

  // Hydrate persisted state from localStorage & synchronize Supabase auth
  useEffect(() => {
    let isMounted = true;

    try {
      const savedProg = localStorage.getItem('koup_progress_v1');
      if (savedProg) {
        const parsed = JSON.parse(savedProg);
        if (parsed && typeof parsed === 'object') setProgressMap(parsed);
      }

      const savedFavP = localStorage.getItem('koup_fav_people_v1');
      if (savedFavP) {
        const parsed = JSON.parse(savedFavP);
        if (Array.isArray(parsed)) setFavPersonIds(parsed);
      }

      const savedFolM = localStorage.getItem('koup_fol_media_v1');
      if (savedFolM) {
        const parsed = JSON.parse(savedFolM);
        if (Array.isArray(parsed)) setFollowedMediaIds(parsed);
      }

      const savedFolP = localStorage.getItem('koup_fol_people_v1');
      if (savedFolP) {
        const parsed = JSON.parse(savedFolP);
        if (Array.isArray(parsed)) setFollowedPersonIds(parsed);
      }

      const savedProf = localStorage.getItem('koup_profile_v1');
      if (savedProf) {
        const parsed = JSON.parse(savedProf);
        if (parsed && parsed.id && parsed.id !== 'local-cinema-member') {
          // SECURITY: Always neutralize role from localStorage cache. Role comes ONLY from DB.
          setUser({
            ...parsed,
            role: 'user',
          });
        } else {
          localStorage.removeItem('koup_profile_v1');
        }
      }

      const savedNotifs = localStorage.getItem('koup_notifs_v1');
      if (savedNotifs) {
        const parsedN = JSON.parse(savedNotifs);
        if (Array.isArray(parsedN)) {
          // Permanently clean and mark as read any legacy sample notifications
          const cleaned = parsedN.map((n: any) => {
            if (
              n.id === 'notif-comment-1' ||
              n.id === 'notif-ep-1' ||
              n.id === 'notif-actor-1' ||
              n.id === 'welcome-1' ||
              n.id === 'sched-2'
            ) {
              return { ...n, isRead: true };
            }
            return n;
          });
          setNotifications(cleaned.slice(0, 50));
          try {
            localStorage.setItem('koup_notifs_v1', JSON.stringify(cleaned.slice(0, 50)));
          } catch {}
        }
      }
    } catch {
      // ignore storage errors
    } finally {
      isHydratedRef.current = true;
    }

    // Check real Supabase session & sync verified profile fresh from DB
    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      try {
        if (data?.session?.user) {
          await syncUserProfile(data.session.user.id, data.session.user);
        } else {
          setUser(null);
          try {
            localStorage.removeItem('koup_profile_v1');
          } catch {}
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    });

    // Listen to real Supabase auth state transitions with mount guards
    const { data: authSub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      if (event === 'SIGNED_OUT') {
        setUser(null);
        try {
          localStorage.removeItem('koup_profile_v1');
        } catch {}
        invalidateCache();
        setAuthLoading(false);
        return;
      }

      if (session?.user) {
        await syncUserProfile(session.user.id, session.user);
        if (isMounted) setAuthLoading(false);
      } else if (event === 'INITIAL_SESSION' && !session) {
        setUser(null);
        try {
          localStorage.removeItem('koup_profile_v1');
        } catch {}
        if (isMounted) setAuthLoading(false);
      }
    });

    // Global Cmd+K / Ctrl+K shortcut for instant omnibox search
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      isMounted = false;
      authSub.subscription.unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [syncUserProfile]);

  // Push notification with deduplication, throttling, and max list size cap
  const pushNotification = useCallback(
    (
      title: string,
      body: string,
      type: ToastNotification['type'] = 'info',
      linkUrl?: string
    ) => {
      const key = `${title}::${body}`;
      const now = Date.now();
      const lastSeen = recentNotifsRef.current.get(key) || 0;

      // Throttle exact duplicate notifications within 3.5s (prevents double-renders in StrictMode)
      if (now - lastSeen < 3500) {
        return;
      }
      recentNotifsRef.current.set(key, now);

      // Clean up throttling map
      if (recentNotifsRef.current.size > 40) {
        for (const [k, time] of recentNotifsRef.current.entries()) {
          if (now - time > 10000) recentNotifsRef.current.delete(k);
        }
      }

      const item: ToastNotification = {
        id: `notif-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        type,
        linkUrl,
        createdAt: 'Şimdi',
        isRead: false,
      };

      setNotifications((prev) => {
        const filtered = prev.filter((n) => n.id !== item.id);
        const next = [item, ...filtered].slice(0, 50);
        try {
          localStorage.setItem('koup_notifs_v1', JSON.stringify(next));
        } catch {}
        return next;
      });

      setActiveToast(item);

      const settings = user?.notification_settings || DEFAULT_NOTIFICATION_SETTINGS;
      if (settings.sound_enabled) {
        playNotificationChime(
          (settings.sound_tone as SoundTone) || 'apple_glass',
          settings.sound_volume ?? 0.7,
          settings.mute_during_fullscreen ?? true
        );
      }

      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = setTimeout(() => {
        setActiveToast((curr) => (curr?.id === item.id ? null : curr));
      }, 4500);

      // Persist to Supabase user_notifications table if authenticated
      if (user?.id) {
        let dbType: 'comment_reply' | 'mention' | 'new_episode' | 'actor_update' | 'report_resolved' | 'system' = 'system';
        if (type === 'reply') dbType = 'comment_reply';
        else if (type === 'episode') dbType = 'new_episode';
        else if (type === 'actor') dbType = 'actor_update';

        void Promise.resolve(
          supabase.from('user_notifications').insert({
            user_id: user.id,
            title,
            body,
            type: dbType,
            link_url: linkUrl || null,
            is_read: false,
          })
        ).catch(() => {});
      }
    },
    [user?.id, user?.notification_settings]
  );

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
        } catch {}
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
        } catch {}
        return next;
      });
    },
    [pushNotification]
  );

  const setLibraryStatus = useCallback(
    (media: MediaItem, status: UserMediaProgress['status'], score?: number) => {
      setProgressMap((prev) => {
        const existing = prev[media.id];
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
        const next = { ...prev, [media.id]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const toggleMediaFavorite = useCallback((media: MediaItem) => {
    setProgressMap((prev) => {
      const existing = prev[media.id];
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
      const next = { ...prev, [media.id]: updated };
      try {
        localStorage.setItem('koup_progress_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const toggleMediaFollow = useCallback((media: MediaItem) => {
    setFollowedMediaIds((prev) => {
      const exists = prev.includes(media.id);
      const next = exists ? prev.filter((id) => id !== media.id) : [...prev, media.id];
      try {
        localStorage.setItem('koup_fol_media_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const togglePersonFavorite = useCallback(
    async (personId: number, _personName?: string): Promise<number> => {
      let expectedCount = 0;
      setFavPersonIds((prev) => {
        const isFav = prev.includes(personId);
        const next = isFav ? prev.filter((id) => id !== personId) : [...prev, personId];
        expectedCount = next.length;
        try {
          localStorage.setItem('koup_fav_people_v1', JSON.stringify(next));
        } catch {}
        return next;
      });

      // Fire-and-forget RPC sync to database
      void Promise.resolve(
        supabase.rpc('increment_person_favorite', {
          p_person_id: personId,
          p_delta: favPersonIds.includes(personId) ? -1 : 1,
        })
      ).catch(() => {});

      return expectedCount;
    },
    [favPersonIds]
  );

  const togglePersonFollow = useCallback((personId: number, _personName?: string) => {
    setFollowedPersonIds((prev) => {
      const exists = prev.includes(personId);
      const next = exists ? prev.filter((id) => id !== personId) : [...prev, personId];
      try {
        localStorage.setItem('koup_fol_people_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      try {
        localStorage.setItem('koup_notifs_v1', JSON.stringify(next));
      } catch {}
      return next;
    });

    if (user?.id) {
      void Promise.resolve(
        supabase.from('user_notifications').update({ is_read: true }).eq('id', id)
      ).catch(() => {});
    }
  }, [user?.id]);

  const markNotificationUnread = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, isRead: false } : n));
      try {
        localStorage.setItem('koup_notifs_v1', JSON.stringify(next));
      } catch {}
      return next;
    });

    if (user?.id) {
      void Promise.resolve(
        supabase.from('user_notifications').update({ is_read: false }).eq('id', id)
      ).catch(() => {});
    }
  }, [user?.id]);

  const deleteNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      try {
        localStorage.setItem('koup_notifs_v1', JSON.stringify(next));
      } catch {}
      return next;
    });

    if (user?.id) {
      void Promise.resolve(
        supabase.from('user_notifications').delete().eq('id', id)
      ).catch(() => {});
    }
  }, [user?.id]);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    try {
      localStorage.setItem('koup_notifs_v1', JSON.stringify([]));
    } catch {}

    if (user?.id) {
      void Promise.resolve(
        supabase.from('user_notifications').delete().eq('user_id', user.id)
      ).catch(() => {});
    }
  }, [user?.id]);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, isRead: true }));
      try {
        localStorage.setItem('koup_notifs_v1', JSON.stringify(next));
      } catch {}
      return next;
    });

    if (user?.id) {
      void Promise.resolve(
        supabase
          .from('user_notifications')
          .update({ is_read: true })
          .eq('user_id', user.id)
          .eq('is_read', false)
      ).catch(() => {});
    }
  }, [user?.id]);

  const dismissToast = useCallback(() => {
    setActiveToast(null);
  }, []);

  const updateProfileSettings = useCallback(
    async (patch: Partial<UserProfile>) => {
      // Disallow client elevation of role
      const { role: _ignoredRole, ...safePatch } = patch;

      setUser((prev) => {
        if (!prev) return null;
        const updated = { ...prev, ...safePatch };
        try {
          localStorage.setItem('koup_profile_v1', JSON.stringify({ ...updated, role: 'user' }));
        } catch {}
        return updated;
      });

      if (user?.id) {
        await supabase.from('profiles').update(safePatch).eq('id', user.id);
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
        await syncUserProfile(data.user.id, data.user);
        pushNotification('Giriş Başarılı', 'KoUp kütüphaneniz hazır.', 'success');
      }
      return null;
    },
    [syncUserProfile, pushNotification]
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
        await new Promise((r) => setTimeout(r, 600));
        await syncUserProfile(data.user.id, data.user);
        pushNotification('Hesap Oluşturuldu', `KoUp ailesine hoş geldin, ${username}!`, 'success');
      }
      return null;
    },
    [syncUserProfile, pushNotification]
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    try {
      localStorage.removeItem('koup_profile_v1');
    } catch {}
    invalidateCache();
    pushNotification('Oturum Kapatıldı', 'Misafir sinema moduna geçildi.', 'info');
  }, [pushNotification]);

  const soundEnabled = Boolean(user?.notification_settings?.sound_enabled ?? true);

  const toggleSound = useCallback(() => {
    setUser((prev) => {
      if (!prev) return null;
      const nextSettings = {
        ...prev.notification_settings,
        sound_enabled: !prev.notification_settings?.sound_enabled,
      };
      const updated = { ...prev, notification_settings: nextSettings };
      try {
        localStorage.setItem('koup_profile_v1', JSON.stringify({ ...updated, role: 'user' }));
      } catch {}
      return updated;
    });
  }, []);

  const triggerSound = useCallback((_kind?: string) => {
    return;
  }, []);

  const continueWatchingList = useMemo(() => {
    return Object.values(progressMap)
      .filter((p) => p.status === 'watching' && p.media)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 30);
  }, [progressMap]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.isRead).length;
  }, [notifications]);

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

  // Memoize context value to prevent wasteful whole-app re-renders
  const contextValue = useMemo<KoUpContextValue>(() => {
    return {
      user,
      profile: user,
      authLoading,
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
      markNotificationRead,
      markNotificationUnread,
      deleteNotification,
      clearAllNotifications,
      dismissToast,
      updateProfileSettings,
      loginWithEmail,
      registerWithEmail,
      logout,
    };
  }, [
    user,
    authLoading,
    progressMap,
    continueWatchingList,
    favPersonIds,
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
    isAuthModalOpen,
    isRouletteOpen,
    updateEpisodeProgress,
    toggleEpisodeWatched,
    setLibraryStatus,
    toggleMediaFavorite,
    toggleMediaFollow,
    togglePersonFavorite,
    togglePersonFollow,
    pushNotification,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationUnread,
    deleteNotification,
    clearAllNotifications,
    dismissToast,
    updateProfileSettings,
    loginWithEmail,
    registerWithEmail,
    logout,
  ]);

  return <KoUpContext.Provider value={contextValue}>{children}</KoUpContext.Provider>;
}

export function useKoUp() {
  const ctx = useContext(KoUpContext);
  if (!ctx) throw new Error('useKoUp must be used inside KoUpProvider');
  return ctx;
}
