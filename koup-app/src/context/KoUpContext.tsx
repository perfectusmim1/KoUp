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
import { getClientFingerprint } from '@/lib/fingerprint';

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: 'episode' | 'actor' | 'reply' | 'system' | 'info' | 'success';
  linkUrl?: string;
  createdAt: string;
  isRead: boolean;
  mediaId?: number;
  personId?: number;
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
  authModalMessage: string | null;
  setAuthModalMessage: (msg: string | null) => void;
  openAuthModal: (message?: string) => void;
  isSoftBanned: boolean;
  isHardBanned: boolean;
  hardBanReason: string | null;
  deviceFingerprint: string;
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
    linkUrl?: string,
    extra?: { mediaId?: number; personId?: number }
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
  const [authModalMessage, setAuthModalMessage] = useState<string | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>('');
  const [isHardBanned, setIsHardBanned] = useState(false);
  const [hardBanReason, setHardBanReason] = useState<string | null>(null);
  const [isRouletteOpen, setIsRouletteOpen] = useState(false);

  const openAuthModal = useCallback((message?: string) => {
    setAuthModalMessage(message || 'İşlem yapabilmek için lütfen giriş yapın.');
    setIsAuthModalOpen(true);
  }, []);

  const isSoftBanned = Boolean(
    user && user.is_banned && (user.ban_type === 'soft' || user.role === 'banned')
  );

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
        if (profile.is_banned && profile.ban_type === 'hard') {
          setIsHardBanned(true);
          setHardBanReason(profile.ban_reason || 'Cihazınız kalıcı olarak yasaklanmıştır.');
        }
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

      // Fetch user notifications from Supabase if table exists (strictly for authenticated users)
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
              const formatted: ToastNotification[] = dbNotifs
                .map((row: any) => {
                  let mappedType: ToastNotification['type'] = 'system';
                  if (row.type === 'comment_reply' || row.type === 'reply') mappedType = 'reply';
                  else if (row.type === 'new_episode' || row.type === 'episode') mappedType = 'episode';
                  else if (row.type === 'actor_update' || row.type === 'actor') mappedType = 'actor';
                  else mappedType = 'system';

                  return {
                    id: String(row.id),
                    title: row.title || 'Bildirim',
                    body: row.body || '',
                    type: mappedType,
                    linkUrl: row.link_url || undefined,
                    createdAt: row.created_at
                      ? new Date(row.created_at).toLocaleDateString('tr-TR')
                      : 'Şimdi',
                    isRead: Boolean(row.is_read),
                  };
                })
                .filter((n: ToastNotification) => {
                  const t = n.title.toLowerCase();
                  const b = n.body.toLowerCase();
                  // Permanently reject dummy notifications & broadcast spam
                  return !(
                    t.includes('reply 1988') ||
                    t.includes('yoo in na') ||
                    t.includes('vitrin') ||
                    t.includes('slider') ||
                    t.includes('hesap oluşturuldu') ||
                    t.includes('oturum kapatıldı') ||
                    b.includes('reply 1988') ||
                    b.includes('yoo in na')
                  );
                });

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

          // Only load notifications if user is authenticated!
          const savedNotifs = localStorage.getItem('koup_notifs_v1');
          if (savedNotifs) {
            const parsedN = JSON.parse(savedNotifs);
            if (Array.isArray(parsedN)) {
              // Permanently filter out any legacy dummy notifications or unwanted spam
              const cleaned = parsedN.filter((n: any) => {
                if (!n || !n.title) return false;
                const t = (n.title || '').toLowerCase();
                const b = (n.body || '').toLowerCase();
                if (
                  t.includes('reply 1988') ||
                  t.includes('yoo in na') ||
                  t.includes('vitrin') ||
                  t.includes('slider') ||
                  t.includes('hesap oluşturuldu') ||
                  t.includes('oturum kapatıldı') ||
                  b.includes('reply 1988') ||
                  b.includes('yoo in na') ||
                  n.id === 'notif-comment-1' ||
                  n.id === 'notif-ep-1' ||
                  n.id === 'notif-actor-1' ||
                  n.id === 'welcome-1' ||
                  n.id === 'sched-2'
                ) {
                  return false;
                }
                return ['episode', 'actor', 'reply', 'system'].includes(n.type);
              });
              setNotifications(cleaned.slice(0, 50));
              try {
                localStorage.setItem('koup_notifs_v1', JSON.stringify(cleaned.slice(0, 50)));
              } catch {}
            }
          }
        } else {
          localStorage.removeItem('koup_profile_v1');
          setNotifications([]);
          try {
            localStorage.removeItem('koup_notifs_v1');
          } catch {}
        }
      } else {
        // Guest user: Zero automated notifications loaded!
        setNotifications([]);
        try {
          localStorage.removeItem('koup_notifs_v1');
        } catch {}
      }
    } catch {
      // ignore storage errors
    } finally {
      isHydratedRef.current = true;
    }

    // Initialize device fingerprint and enforce Hard Ban check
    getClientFingerprint().then(async (fp) => {
      if (!isMounted) return;
      setDeviceFingerprint(fp);

      try {
        const { data: bannedRows, error } = await supabase
          .from('banned_fingerprints')
          .select('id, reason, is_active')
          .eq('fingerprint_hash', fp)
          .eq('is_active', true)
          .limit(1);

        if (!error && bannedRows && bannedRows.length > 0) {
          setIsHardBanned(true);
          setHardBanReason(
            bannedRows[0].reason ||
              'Cihazınız topluluk kurallarının ağır ihlali nedeniyle KoUp platformundan kalıcı olarak yasaklanmıştır.'
          );
        }
      } catch {
        // ignore
      }
    });

    // Check real Supabase session & sync verified profile fresh from DB
    supabase.auth.getSession().then(async ({ data }) => {
      if (!isMounted) return;
      try {
        if (data?.session?.user) {
          await syncUserProfile(data.session.user.id, data.session.user);
        } else {
          setUser(null);
          setNotifications([]);
          try {
            localStorage.removeItem('koup_profile_v1');
            localStorage.removeItem('koup_notifs_v1');
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
        setNotifications([]);
        try {
          localStorage.removeItem('koup_profile_v1');
          localStorage.removeItem('koup_notifs_v1');
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
        setNotifications([]);
        try {
          localStorage.removeItem('koup_profile_v1');
          localStorage.removeItem('koup_notifs_v1');
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


  // Push notification with guest guard, spam elimination, and 4 allowed notification types
  const pushNotification = useCallback(
    (
      title: string,
      body: string,
      type: ToastNotification['type'] = 'system',
      linkUrl?: string,
      extra?: { mediaId?: number; personId?: number }
    ) => {
      // 1. STRICT GUEST USER GUARD:
      // NO notifications should be pushed to guest users!
      if (!user) {
        return;
      }

      // 2. DISALLOW UNWANTED SPAM / BROADCASTS:
      // Search for and eliminate "Vitrin Güncellendi", slider broadcasts, or dummy notifications!
      const lowerTitle = title.toLowerCase();
      const lowerBody = body.toLowerCase();
      if (
        lowerTitle.includes('vitrin') ||
        lowerTitle.includes('slider') ||
        lowerTitle.includes('oturum kapatıldı') ||
        lowerTitle.includes('hesap oluşturuldu') ||
        lowerTitle.includes('reply 1988') ||
        lowerTitle.includes('yoo in na') ||
        lowerBody.includes('reply 1988') ||
        lowerBody.includes('yoo in na')
      ) {
        return;
      }

      // 3. Transient UI Toasts ('info', 'success'):
      // General feedback ("Ayarlar Kaydedildi", "Kaynak Eklendi") shows as activeToast for feedback,
      // but does NOT pollute the user's permanent notifications inbox.
      if (type === 'info' || type === 'success') {
        const toastItem: ToastNotification = {
          id: `toast-${Date.now()}`,
          title,
          body,
          type: 'system',
          linkUrl,
          createdAt: 'Şimdi',
          isRead: true,
        };
        setActiveToast(toastItem);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setActiveToast((curr) => (curr?.id === toastItem.id ? null : curr));
        }, 4000);
        return;
      }

      // 4. THE ONLY 4 REAL NOTIFICATION TYPES ALLOWED:
      // 1. episode: New episode uploaded for a series that the user ACTUALLY follows in followedMediaIds.
      // 2. actor: Followed actor in a new release that the user ACTUALLY follows in followedPersonIds.
      // 3. reply: Someone replied to the user's comment.
      // 4. system: Official warning or message from admin/mod team.
      let finalType: 'episode' | 'actor' | 'reply' | 'system' = 'system';

      if (type === 'episode') {
        if (extra?.mediaId && !followedMediaIds.includes(extra.mediaId)) {
          return; // Skip: user does not follow this media
        }
        finalType = 'episode';
      } else if (type === 'actor') {
        if (
          extra?.personId &&
          !followedPersonIds.includes(extra.personId) &&
          !favPersonIds.includes(extra.personId)
        ) {
          return; // Skip: user does not follow this actor
        }
        finalType = 'actor';
      } else if (type === 'reply') {
        finalType = 'reply';
      } else {
        finalType = 'system';
      }

      const key = `${title}::${body}`;
      const now = Date.now();
      const lastSeen = recentNotifsRef.current.get(key) || 0;

      // Throttle exact duplicate notifications within 3.5s
      if (now - lastSeen < 3500) {
        return;
      }
      recentNotifsRef.current.set(key, now);

      if (recentNotifsRef.current.size > 40) {
        for (const [k, time] of recentNotifsRef.current.entries()) {
          if (now - time > 10000) recentNotifsRef.current.delete(k);
        }
      }

      const item: ToastNotification = {
        id: `notif-${now}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        type: finalType,
        linkUrl,
        createdAt: 'Şimdi',
        isRead: false,
        mediaId: extra?.mediaId,
        personId: extra?.personId,
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

      const settings = user.notification_settings || DEFAULT_NOTIFICATION_SETTINGS;
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
      let dbType: 'comment_reply' | 'mention' | 'new_episode' | 'actor_update' | 'report_resolved' | 'system' = 'system';
      if (finalType === 'reply') dbType = 'comment_reply';
      else if (finalType === 'episode') dbType = 'new_episode';
      else if (finalType === 'actor') dbType = 'actor_update';

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
    },
    [user, followedMediaIds, followedPersonIds, favPersonIds]
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
      if (!user) {
        openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
        return;
      }
      if (isSoftBanned) {
        pushNotification(
          'Hesap Askıda',
          'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
          'info'
        );
        return;
      }

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
    [user, isSoftBanned, openAuthModal, pushNotification]
  );

  const setLibraryStatus = useCallback(
    (media: MediaItem, status: UserMediaProgress['status'], score?: number) => {
      if (!user) {
        openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
        return;
      }
      if (isSoftBanned) {
        pushNotification(
          'Hesap Askıda',
          'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
          'info'
        );
        return;
      }

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
    [user, isSoftBanned, openAuthModal, pushNotification]
  );

  const toggleMediaFavorite = useCallback((media: MediaItem) => {
    if (!user) {
      openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
      return;
    }
    if (isSoftBanned) {
      pushNotification(
        'Hesap Askıda',
        'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
        'info'
      );
      return;
    }

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
  }, [user, isSoftBanned, openAuthModal, pushNotification]);

  const toggleMediaFollow = useCallback((media: MediaItem) => {
    if (!user) {
      openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
      return;
    }
    if (isSoftBanned) {
      pushNotification(
        'Hesap Askıda',
        'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
        'info'
      );
      return;
    }

    setFollowedMediaIds((prev) => {
      const exists = prev.includes(media.id);
      const next = exists ? prev.filter((id) => id !== media.id) : [...prev, media.id];
      try {
        localStorage.setItem('koup_fol_media_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [user, isSoftBanned, openAuthModal, pushNotification]);

  const togglePersonFavorite = useCallback(
    async (personId: number, _personName?: string): Promise<number> => {
      if (!user) {
        openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
        return 0;
      }
      if (isSoftBanned) {
        pushNotification(
          'Hesap Askıda',
          'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
          'info'
        );
        return favPersonIds.length;
      }

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
    [user, isSoftBanned, favPersonIds, openAuthModal, pushNotification]
  );

  const togglePersonFollow = useCallback((personId: number, _personName?: string) => {
    if (!user) {
      openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
      return;
    }
    if (isSoftBanned) {
      pushNotification(
        'Hesap Askıda',
        'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
        'info'
      );
      return;
    }

    setFollowedPersonIds((prev) => {
      const exists = prev.includes(personId);
      const next = exists ? prev.filter((id) => id !== personId) : [...prev, personId];
      try {
        localStorage.setItem('koup_fol_people_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [user, isSoftBanned, openAuthModal, pushNotification]);

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
    setNotifications([]);
    try {
      localStorage.removeItem('koup_profile_v1');
      localStorage.removeItem('koup_notifs_v1');
    } catch {}
    invalidateCache();
  }, []);

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
      if (!user) {
        openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
        return;
      }
      if (isSoftBanned) {
        pushNotification(
          'Hesap Askıda',
          'Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.',
          'info'
        );
        return;
      }

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
    [user, isSoftBanned, openAuthModal, pushNotification]
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
      authModalMessage,
      setAuthModalMessage,
      openAuthModal,
      isSoftBanned,
      isHardBanned,
      hardBanReason,
      deviceFingerprint,
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
    authModalMessage,
    openAuthModal,
    isSoftBanned,
    isHardBanned,
    hardBanReason,
    deviceFingerprint,
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

  return (
    <KoUpContext.Provider value={contextValue}>
      {isHardBanned ? (
        <div className="fixed inset-0 z-[9999999] bg-[#070709] text-white flex flex-col items-center justify-center p-6 text-center select-none overflow-y-auto">
          <div className="w-24 h-24 rounded-3xl bg-rose-600/20 border-2 border-rose-500/40 text-rose-400 flex items-center justify-center mb-6 shadow-[0_0_60px_rgba(225,29,72,0.45)]">
            <svg
              className="w-12 h-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 font-mono text-xs uppercase tracking-widest font-bold mb-4">
            Cihaz & Donanım Seviyesinde Engellendi
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight mb-4 max-w-2xl leading-tight">
            Erişiminiz Engellendi (403 Banned)
          </h1>
          <p className="text-base text-white/70 max-w-xl leading-relaxed mb-6 font-medium">
            Cihazınız topluluk kurallarının ağır ihlali nedeniyle KoUp platformundan kalıcı olarak yasaklanmıştır.
          </p>
          {hardBanReason && (
            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 max-w-md w-full text-left mb-6">
              <div className="text-[11px] font-mono uppercase tracking-wider text-rose-400 font-bold mb-1">
                Yasaklama Gerekçesi
              </div>
              <div className="text-xs text-white/90">
                {hardBanReason}
              </div>
            </div>
          )}
          <div className="text-xs text-white/35 font-mono">
            Güvenlik Kimliği: {deviceFingerprint ? deviceFingerprint.slice(0, 24) : 'Hesap İmzası'}... · KoUp Güvenlik Duvarı
          </div>
        </div>
      ) : (
        <>
          {isSoftBanned && (
            <div className="fixed top-0 left-0 right-0 z-[999990] bg-rose-600/95 text-white backdrop-blur-md px-4 py-2.5 shadow-xl flex items-center justify-center gap-2.5 text-xs font-semibold border-b border-rose-400/40 text-center">
              <svg
                className="w-4 h-4 text-rose-200 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>
                Hesabınız topluluk kuralları ihlali nedeniyle askıya alınmıştır. İçerik etkileşimleri devre dışıdır.
                {user?.ban_reason ? ` (Gerekçe: ${user.ban_reason})` : ''}
              </span>
            </div>
          )}
          {children}
        </>
      )}
    </KoUpContext.Provider>
  );
}

export function useKoUp() {
  const ctx = useContext(KoUpContext);
  if (!ctx) throw new Error('useKoUp must be used inside KoUpProvider');
  return ctx;
}
