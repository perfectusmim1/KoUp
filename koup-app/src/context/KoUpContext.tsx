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
import {
  reconcileProgressMaps,
  shouldSyncToSupabase,
  syncProgressRecordToSupabase,
  sanitizeProgressDbPayload,
  setCachedAccessToken,
  LastSyncSnapshot,
  ProgressSyncOptions,
  SIGNIFICANT_DELTA_SEC,
} from '@/lib/progressSync';
import { playNotificationChime, SoundTone } from '@/lib/sound';
import { invalidateCache } from '@/lib/cache';
import { getClientFingerprint } from '@/lib/fingerprint';
import { registerOrHeartbeatDevice } from '@/lib/deviceTracker';
import ConfirmModal from '@/components/ConfirmModal';

export interface ConfirmDialogOptions {
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  icon?: 'trash' | 'alert' | 'help';
}

export interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type: 'episode' | 'actor' | 'reply' | 'system' | 'info' | 'success';
  linkUrl?: string;
  imageUrl?: string;
  createdAt: string;
  isRead: boolean;
  mediaId?: number;
  personId?: number;
}

export type NavbarBehavior = 'floating' | 'sticky' | 'static';

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
  isTrailerMuted: boolean;
  toggleTrailerMuted: () => void;
  setTrailerMuted: (muted: boolean) => void;
  navbarBehavior: NavbarBehavior;
  setNavbarBehavior: (mode: NavbarBehavior) => void;
  floatingNavbarEnabled: boolean;
  setFloatingNavbarEnabled: (v: boolean) => void;
  autoCardTrailerEnabled: boolean;
  setAutoCardTrailerEnabled: (v: boolean) => void;
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
    markCompletedEpisode?: boolean,
    options?: ProgressSyncOptions
  ) => void;
  flushProgressSync: (mediaId?: number, options?: { keepalive?: boolean }) => void;
  toggleEpisodeWatched: (media: MediaItem, episodeNum: number, upToHere?: boolean) => void;
  setLibraryStatus: (
    media: MediaItem,
    status: UserMediaProgress['status'],
    score?: number
  ) => void;
  setMediaScore: (media: MediaItem, score: number | null) => void;
  removeFromLibrary: (mediaId: number) => Promise<void>;
  refreshUserLibrary: () => Promise<void>;
  toggleMediaFavorite: (media: MediaItem) => void;
  toggleMediaFollow: (media: MediaItem) => void;
  togglePersonFavorite: (personId: number, personName?: string) => Promise<number>;
  togglePersonFollow: (personId: number, personName?: string) => void;
  pushNotification: (
    title: string,
    body: string,
    type?: ToastNotification['type'],
    linkUrl?: string,
    extra?: { mediaId?: number; personId?: number; imageUrl?: string }
  ) => void;
  markAllNotificationsRead: () => void;
  markNotificationsRead: () => void;
  markNotificationRead: (id: string) => void;
  markNotificationUnread: (id: string) => void;
  deleteNotification: (id: string) => void;
  clearAllNotifications: () => void;
  dismissToast: () => void;
  updateProfileSettings: (patch: Partial<UserProfile>) => Promise<void>;
  blockedUsers: Array<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    created_at?: string;
  }>;
  blockedByUserIds: string[];
  blockUser: (
    targetUserId: string,
    targetUsername?: string,
    targetDisplayName?: string,
    targetAvatar?: string
  ) => Promise<boolean>;
  unblockUser: (targetUserId: string) => Promise<boolean>;
  isUserBlocked: (userId?: string | null) => boolean;
  isBlockedBy: (userId?: string | null) => boolean;
  loginWithEmail: (email: string, password: string) => Promise<string | null>;
  registerWithEmail: (
    email: string,
    password: string,
    username: string
  ) => Promise<string | null>;
  logout: () => Promise<void>;
  confirmDialog: (options: ConfirmDialogOptions) => Promise<boolean>;
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
  const lastSyncedProgressRef = useRef<Record<number, LastSyncSnapshot>>({});
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
  const [blockedUsers, setBlockedUsers] = useState<
    Array<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      created_at?: string;
    }>
  >([]);
  const [blockedByUserIds, setBlockedByUserIds] = useState<string[]>([]);

  // Site-wide Persistent Trailer Mute State (remembers user sound choice across all cards & hero)
  const [isTrailerMuted, setIsTrailerMutedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_trailer_muted');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {}
    return true;
  });

  const setTrailerMuted = useCallback((muted: boolean) => {
    setIsTrailerMutedState(muted);
    try {
      localStorage.setItem('koup_trailer_muted', String(muted));
    } catch {}
  }, []);

  const toggleTrailerMuted = useCallback(() => {
    setIsTrailerMutedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('koup_trailer_muted', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Persistent User Preferences: Navbar Behavior ('floating' | 'sticky' | 'static') & Hover Trailer Auto-Play
  const [navbarBehavior, setNavbarBehaviorState] = useState<NavbarBehavior>('floating');

  const setNavbarBehavior = useCallback((mode: NavbarBehavior) => {
    setNavbarBehaviorState(mode);
    try {
      localStorage.setItem('koup_pref_navbar_behavior', mode);
      localStorage.setItem('koup_pref_floating_navbar', String(mode === 'floating'));
    } catch {}
  }, []);

  const floatingNavbarEnabled = navbarBehavior === 'floating';

  const setFloatingNavbarEnabled = useCallback((enabled: boolean) => {
    setNavbarBehavior(enabled ? 'floating' : 'sticky');
  }, [setNavbarBehavior]);

  const [autoCardTrailerEnabled, setAutoCardTrailerEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('koup_pref_auto_card_trailer');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {}
    return true;
  });

  const setAutoCardTrailerEnabled = useCallback((enabled: boolean) => {
    setAutoCardTrailerEnabledState(enabled);
    try {
      localStorage.setItem('koup_pref_auto_card_trailer', String(enabled));
    } catch {}
  }, []);

  // Hydrate persistent preferences on client mount (avoids Next.js SSR hydration mismatch)
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('koup_pref_navbar_behavior') as NavbarBehavior;
      if (savedMode === 'floating' || savedMode === 'sticky' || savedMode === 'static') {
        setNavbarBehaviorState(savedMode);
      } else {
        const legacy = localStorage.getItem('koup_pref_floating_navbar');
        if (legacy === 'false') setNavbarBehaviorState('sticky');
        else if (legacy === 'true') setNavbarBehaviorState('floating');
      }

      const savedTrailer = localStorage.getItem('koup_pref_auto_card_trailer');
      if (savedTrailer !== null) {
        setAutoCardTrailerEnabledState(savedTrailer === 'true');
      }
    } catch {}
  }, []);

  // Global Confirmation Dialog State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmDialogOptions;
    resolve?: (val: boolean) => void;
  }>({
    isOpen: false,
    options: { title: '', message: '' },
  });

  const confirmDialog = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = useCallback(() => {
    setConfirmState((prev) => {
      if (prev.resolve) prev.resolve(false);
      return { ...prev, isOpen: false, resolve: undefined };
    });
  }, []);

  const handleConfirmAccept = useCallback(() => {
    setConfirmState((prev) => {
      if (prev.resolve) prev.resolve(true);
      return { ...prev, isOpen: false, resolve: undefined };
    });
  }, []);

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
        void registerOrHeartbeatDevice(activeUserId);
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
                    imageUrl: row.image_url || undefined,
                    createdAt: row.created_at
                      ? new Date(row.created_at).toLocaleDateString('tr-TR')
                      : 'Şimdi',
                    isRead: Boolean(row.is_read),
                  };
                })
                .filter((n: ToastNotification) => {
                  const t = n.title.toLowerCase();
                  const b = n.body.toLowerCase();
                  // Permanently reject dummy notifications, self-comment alerts, & broadcast spam
                  return !(
                    t.includes('reply 1988') ||
                    t.includes('yoo in na') ||
                    t.includes('vitrin') ||
                    t.includes('slider') ||
                    t.includes('hesap oluşturuldu') ||
                    t.includes('oturum kapatıldı') ||
                    t.includes('yorumun yayınlandı') ||
                    t.includes('yanıtınız gönderildi') ||
                    t.includes('yanıtın gönderildi') ||
                    b.includes('reply 1988') ||
                    b.includes('yoo in na') ||
                    b.includes('tartışmasına katkın kaydedildi') ||
                    b.includes('yorumuna yanıtınız eklendi')
                  );
                });

              // Clean up any historical self-notifications from database
              void supabase
                .from('user_notifications')
                .delete()
                .eq('user_id', activeUserId)
                .in('title', ['Yanıtınız Gönderildi', 'Yorumun Yayınlandı', 'Yanıtın Gönderildi']);

              setNotifications((prev) => {
                const map = new Map<string, ToastNotification>();
                formatted.forEach((n) => map.set(n.id, n));
                prev.forEach((n) => {
                  const t = n.title.toLowerCase();
                  const b = n.body.toLowerCase();
                  const isJunk =
                    t.includes('yorumun yayınlandı') ||
                    t.includes('yanıtınız gönderildi') ||
                    t.includes('yanıtın gönderildi') ||
                    b.includes('tartışmasına katkın kaydedildi') ||
                    b.includes('yorumuna yanıtınız eklendi');
                  if (!isJunk && !map.has(n.id)) map.set(n.id, n);
                });
                const merged = Array.from(map.values()).slice(0, 50);
                try {
                  localStorage.setItem('koup_notifs_v1', JSON.stringify(merged));
                } catch {}
                return merged;
              });
            }
          });

        // Fetch authenticated user's person favorites fresh from Supabase
        void supabase
          .from('person_favorites')
          .select('person_id')
          .eq('user_id', activeUserId)
          .then(({ data: dbFavs }) => {
            if (dbFavs && Array.isArray(dbFavs)) {
              const ids = dbFavs.map((r: any) => Number(r.person_id));
              setFavPersonIds(ids);
              try {
                localStorage.setItem('koup_fav_people_v1', JSON.stringify(ids));
              } catch {}
            }
          });

        // Fetch authenticated user's media progress fresh from Supabase and reconcile with local-first storage
        void supabase
          .from('user_media_progress')
          .select('*, media:media_id (*)')
          .eq('user_id', activeUserId)
          .then(({ data: dbProg }) => {
            if (dbProg && Array.isArray(dbProg)) {
              let localMap: Record<number, UserMediaProgress> = {};
              try {
                const raw = localStorage.getItem('koup_progress_v1');
                if (raw) localMap = JSON.parse(raw) || {};
              } catch {}

              const { mergedMap, itemsToSyncToSupabase } = reconcileProgressMaps(
                localMap,
                dbProg,
                activeUserId
              );

              setProgressMap(mergedMap);
              try {
                localStorage.setItem('koup_progress_v1', JSON.stringify(mergedMap));
              } catch {}

              // Update snapshot of current sync state
              Object.values(mergedMap).forEach((item) => {
                lastSyncedProgressRef.current[item.media_id] = {
                  positionSec: item.resume_position_sec ?? 0,
                  seasonNum: item.last_season_num ?? 1,
                  episodeNum: item.last_episode_num ?? 1,
                  status: item.status,
                  watchedCount: (item.watched_episodes || []).length,
                  syncedAt: Date.now(),
                };
              });

              // If local had newer progress buffered, reconcile it back to Supabase
              if (itemsToSyncToSupabase.length > 0) {
                void syncProgressRecordToSupabase(itemsToSyncToSupabase);
              }
            }
          });

        // Fetch authenticated user's follows fresh from Supabase
        void supabase
          .from('user_follows')
          .select('target_type, target_id')
          .eq('user_id', activeUserId)
          .then(({ data: dbFollows }) => {
            if (dbFollows && Array.isArray(dbFollows)) {
              const mIds: number[] = [];
              const pIds: number[] = [];
              dbFollows.forEach((row: any) => {
                const numId = Number(row.target_id);
                if (row.target_type === 'media') mIds.push(numId);
                else if (row.target_type === 'person') pIds.push(numId);
              });
              setFollowedMediaIds(mIds);
              setFollowedPersonIds(pIds);
              try {
                localStorage.setItem('koup_fol_media_v1', JSON.stringify(mIds));
                localStorage.setItem('koup_fol_people_v1', JSON.stringify(pIds));
              } catch {}
            }
          });
      }
    } catch (err) {
      console.error('Error syncing user profile:', err);
    }
  }, []);

  // Site-wide native tooltip suppression: prevents annoying native browser hover popup boxes across the app
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sanitizeElement = (el: Element) => {
      if (el.tagName === 'IFRAME') return;
      const title = el.getAttribute('title');
      if (title) {
        if (!el.getAttribute('aria-label')) {
          el.setAttribute('aria-label', title);
        }
        el.removeAttribute('title');
      }
    };

    // Sanitize any existing elements on mount
    try {
      document.querySelectorAll('[title]:not(iframe)').forEach(sanitizeElement);
    } catch {}

    // MutationObserver guarantees dynamic / hydrated nodes lose title immediately
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'title') {
            if (m.target instanceof Element) sanitizeElement(m.target);
          } else if (m.type === 'childList') {
            m.addedNodes.forEach((node) => {
              if (node instanceof Element) {
                sanitizeElement(node);
                node.querySelectorAll?.('[title]:not(iframe)').forEach(sanitizeElement);
              }
            });
          }
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['title'],
        childList: true,
        subtree: true,
      });
    } catch {}

    const handlePointer = (e: Event) => {
      const target = (e.target as HTMLElement)?.closest?.('[title]');
      if (target) sanitizeElement(target);
    };

    document.addEventListener('mouseover', handlePointer, { capture: true, passive: true });
    document.addEventListener('pointerenter', handlePointer, { capture: true, passive: true });

    return () => {
      observer?.disconnect();
      document.removeEventListener('mouseover', handlePointer, { capture: true });
      document.removeEventListener('pointerenter', handlePointer, { capture: true });
    };
  }, []);

  // Hydrate persisted state from localStorage & synchronize Supabase auth
  useEffect(() => {
    let isMounted = true;

    try {
      // Local-first: always hydrate watch progress instantly on client
      const savedProg = localStorage.getItem('koup_progress_v1');
      if (savedProg) {
        const parsedProg = JSON.parse(savedProg);
        if (parsedProg && typeof parsedProg === 'object') setProgressMap(parsedProg);
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

          const savedFavP = localStorage.getItem('koup_fav_people_v1');
          if (savedFavP) {
            const parsedFavP = JSON.parse(savedFavP);
            if (Array.isArray(parsedFavP)) setFavPersonIds(parsedFavP);
          }

          const savedFolM = localStorage.getItem('koup_fol_media_v1');
          if (savedFolM) {
            const parsedFolM = JSON.parse(savedFolM);
            if (Array.isArray(parsedFolM)) setFollowedMediaIds(parsedFolM);
          }

          const savedFolP = localStorage.getItem('koup_fol_people_v1');
          if (savedFolP) {
            const parsedFolP = JSON.parse(savedFolP);
            if (Array.isArray(parsedFolP)) setFollowedPersonIds(parsedFolP);
          }

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
          localStorage.removeItem('koup_notifs_v1');
          localStorage.removeItem('koup_fav_people_v1');
          localStorage.removeItem('koup_fol_media_v1');
          localStorage.removeItem('koup_fol_people_v1');
          setUser(null);
          setFavPersonIds([]);
          setFollowedMediaIds([]);
          setFollowedPersonIds([]);
          setNotifications([]);
        }
      } else {
        setUser(null);
        setFavPersonIds([]);
        setFollowedMediaIds([]);
        setFollowedPersonIds([]);
        setNotifications([]);
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
          if (data.session.access_token) setCachedAccessToken(data.session.access_token);
          await syncUserProfile(data.session.user.id, data.session.user);
        } else {
          setUser(null);
          setFavPersonIds([]);
          setFollowedMediaIds([]);
          setFollowedPersonIds([]);
          setNotifications([]);
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
        setCachedAccessToken(null);
        setUser(null);
        setProgressMap({});
        setFavPersonIds([]);
        setFollowedMediaIds([]);
        setFollowedPersonIds([]);
        setNotifications([]);
        try {
          localStorage.removeItem('koup_profile_v1');
          localStorage.removeItem('koup_notifs_v1');
          localStorage.removeItem('koup_progress_v1');
          localStorage.removeItem('koup_fav_people_v1');
          localStorage.removeItem('koup_fol_media_v1');
          localStorage.removeItem('koup_fol_people_v1');
        } catch {}
        invalidateCache();
        setAuthLoading(false);
        return;
      }

      if (session?.user) {
        if (session.access_token) setCachedAccessToken(session.access_token);
        await syncUserProfile(session.user.id, session.user);
        if (isMounted) setAuthLoading(false);
      } else if (event === 'INITIAL_SESSION' && !session) {
        setUser(null);
        setFavPersonIds([]);
        setFollowedMediaIds([]);
        setFollowedPersonIds([]);
        setNotifications([]);
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
      extra?: { mediaId?: number; personId?: number; imageUrl?: string }
    ) => {
      // 1. STRICT GUEST USER GUARD:
      // NO notifications should be pushed to guest users!
      if (!user) {
        return;
      }

      // 2. DISALLOW UNWANTED SPAM / BROADCASTS / SELF-NOTIFICATIONS:
      // Eliminate "Vitrin Güncellendi", slider broadcasts, or dummy notifications, and NEVER self-notify for own comments!
      const lowerTitle = title.toLowerCase();
      const lowerBody = body.toLowerCase();
      if (
        lowerTitle.includes('vitrin') ||
        lowerTitle.includes('slider') ||
        lowerTitle.includes('oturum kapatıldı') ||
        lowerTitle.includes('hesap oluşturuldu') ||
        lowerTitle.includes('yorumun yayınlandı') ||
        lowerTitle.includes('yanıtınız gönderildi') ||
        lowerTitle.includes('yanıtın gönderildi') ||
        lowerTitle.includes('reply 1988') ||
        lowerTitle.includes('yoo in na') ||
        lowerBody.includes('reply 1988') ||
        lowerBody.includes('yoo in na') ||
        lowerBody.includes('katkın kaydedildi') ||
        lowerBody.includes('yorumuna yanıtınız eklendi')
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

      // 4. REAL INBOX NOTIFICATION TYPES ALLOWED:
      // 1. episode: New episode uploaded for a series that the user follows.
      // 2. actor: Followed actor in a new release or project.
      // 3. reply: Someone replied to the user's comment (never own comments).
      // 4. system: Official warning or message from admin/mod team.
      let finalType: 'episode' | 'actor' | 'reply' | 'system' = 'system';
      if (type === 'episode') {
        finalType = 'episode';
      } else if (type === 'actor') {
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
        imageUrl: extra?.imageUrl,
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
          image_url: extra?.imageUrl || null,
          is_read: false,
        })
      ).catch(() => {});
    },
    [user, followedMediaIds, followedPersonIds, favPersonIds]
  );


  const refreshUserLibrary = useCallback(async () => {
    if (!user) return;
    try {
      const { data: dbProg } = await supabase
        .from('user_media_progress')
        .select('*, media:media_id (*)')
        .eq('user_id', user.id);

      if (dbProg && Array.isArray(dbProg)) {
        let localMap: Record<number, UserMediaProgress> = {};
        try {
          const raw = localStorage.getItem('koup_progress_v1');
          if (raw) localMap = JSON.parse(raw) || {};
        } catch {}

        const { mergedMap, itemsToSyncToSupabase } = reconcileProgressMaps(
          localMap,
          dbProg,
          user.id
        );

        setProgressMap(mergedMap);
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(mergedMap));
        } catch {}

        Object.values(mergedMap).forEach((item) => {
          lastSyncedProgressRef.current[item.media_id] = {
            positionSec: item.resume_position_sec ?? 0,
            seasonNum: item.last_season_num ?? 1,
            episodeNum: item.last_episode_num ?? 1,
            status: item.status,
            watchedCount: (item.watched_episodes || []).length,
            syncedAt: Date.now(),
          };
        });

        if (itemsToSyncToSupabase.length > 0) {
          void syncProgressRecordToSupabase(itemsToSyncToSupabase);
        }
      }
    } catch (e) {
      console.error('Error refreshing library:', e);
    }
  }, [user]);

  const updateEpisodeProgress = useCallback(
    (
      media: MediaItem,
      seasonNum: number,
      episodeNum: number,
      episodeTitle: string,
      positionSec: number,
      durationSec: number,
      markCompletedEpisode = false,
      options?: ProgressSyncOptions
    ) => {
      const roundedPos = Math.floor(positionSec);
      const roundedDur = Math.floor(durationSec || 3600);

      setProgressMap((prev) => {
        const existing = prev[media.id] || {
          media_id: media.id,
          status: 'watching',
          is_favorite: false,
          watched_episodes: [],
          last_season_num: seasonNum,
          last_episode_num: episodeNum,
          last_episode_title: episodeTitle,
          resume_position_sec: roundedPos,
          resume_duration_sec: roundedDur,
          updated_at: new Date().toISOString(),
          media,
        };

        const watchedSet = new Set(existing.watched_episodes || []);
        if (markCompletedEpisode || (roundedDur > 0 && roundedPos / roundedDur >= 0.85)) {
          watchedSet.add(episodeNum);
        }

        const watchedArr = Array.from(watchedSet).sort((a, b) => a - b);
        const maxWatched = watchedArr.length > 0 ? Math.max(...watchedArr) : 0;

        let nextLastEp = episodeNum;
        let nextLastEpTitle = episodeTitle;
        let nextResumePos = roundedPos;

        // If this episode was just completed (or reached > 85%), advance the series-level pointer to the next episode
        const isCompletedNow = markCompletedEpisode || (roundedDur > 0 && roundedPos / roundedDur >= 0.85);
        if (isCompletedNow) {
          const computedNext =
            media.episode_count && media.episode_count > 0
              ? Math.min(media.episode_count, maxWatched + 1)
              : maxWatched + 1;
          nextLastEp = computedNext;
          nextLastEpTitle = `${computedNext}. Bölüm`;
          if (computedNext !== episodeNum) {
            nextResumePos = 0;
          }
        }

        // Per-episode progress record
        const epKey = `${seasonNum}_${episodeNum}`;
        const prevEpisodePositions = existing.episode_positions || {};
        const newEpisodePositions = {
          ...prevEpisodePositions,
          [epKey]: {
            position: roundedPos,
            duration: roundedDur,
            updated_at: new Date().toISOString(),
          },
        };

        try {
          localStorage.setItem(
            `koup_ep_pos_${media.id}_${seasonNum}_${episodeNum}`,
            JSON.stringify({ position: roundedPos, duration: roundedDur })
          );
        } catch {}

        const updated: UserMediaProgress = {
          ...existing,
          user_id: user ? user.id : 'guest',
          status:
            media.episode_count > 0 && watchedSet.size >= media.episode_count
              ? 'completed'
              : 'watching',
          watched_episodes: watchedArr,
          last_season_num: seasonNum,
          last_episode_num: nextLastEp,
          last_episode_title: nextLastEpTitle,
          resume_position_sec: nextResumePos,
          resume_duration_sec: roundedDur,
          episode_positions: newEpisodePositions,
          updated_at: new Date().toISOString(),
          media: existing.media || media,
        };

        const next = { ...prev, [media.id]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {}

        // Smart Supabase Egress Optimization:
        let lastSync = lastSyncedProgressRef.current[media.id];
        if (!lastSync) {
          lastSync = {
            positionSec: nextResumePos,
            seasonNum,
            episodeNum: nextLastEp,
            status: updated.status,
            watchedCount: watchedArr.length,
            syncedAt: Date.now(),
          };
          lastSyncedProgressRef.current[media.id] = lastSync;
        }

        const shouldSync = shouldSyncToSupabase(
          nextResumePos,
          seasonNum,
          nextLastEp,
          updated.status,
          watchedArr.length,
          lastSync,
          options
        );

        if (user && shouldSync) {
          lastSyncedProgressRef.current[media.id] = {
            positionSec: nextResumePos,
            seasonNum,
            episodeNum: nextLastEp,
            status: updated.status,
            watchedCount: watchedArr.length,
            syncedAt: Date.now(),
          };

          const payload = sanitizeProgressDbPayload({ ...updated, user_id: user.id }, user.id);
          void syncProgressRecordToSupabase(payload, { keepalive: options?.keepalive });
        }

        return next;
      });
    },
    [user]
  );

  const flushProgressSync = useCallback(
    (mediaId?: number, options?: { keepalive?: boolean }) => {
      if (!user) return;
      try {
        const raw = localStorage.getItem('koup_progress_v1');
        const map: Record<number, UserMediaProgress> = raw ? JSON.parse(raw) : progressMap;

        const targets = mediaId && map[mediaId] ? [map[mediaId]] : Object.values(map);
        const toSync: any[] = [];

        targets.forEach((item) => {
          if (!item || !item.media_id) return;
          const lastSync = lastSyncedProgressRef.current[item.media_id];
          const delta = lastSync
            ? Math.abs((item.resume_position_sec || 0) - lastSync.positionSec)
            : item.resume_position_sec || 0;

          if (
            !lastSync ||
            delta >= SIGNIFICANT_DELTA_SEC ||
            lastSync.seasonNum !== item.last_season_num ||
            lastSync.episodeNum !== item.last_episode_num ||
            lastSync.status !== item.status
          ) {
            toSync.push(sanitizeProgressDbPayload({ ...item, user_id: user.id }, user.id));
            lastSyncedProgressRef.current[item.media_id] = {
              positionSec: item.resume_position_sec || 0,
              seasonNum: item.last_season_num || 1,
              episodeNum: item.last_episode_num || 1,
              status: item.status,
              watchedCount: (item.watched_episodes || []).length,
              syncedAt: Date.now(),
            };
          }
        });

        if (toSync.length > 0) {
          void syncProgressRecordToSupabase(toSync, options);
        }
      } catch (e) {
        console.warn('Failed to flush progress sync:', e);
      }
    },
    [user, progressMap]
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

        const watchedArr = Array.from(watchedSet).sort((a, b) => a - b);
        const maxWatched = watchedArr.length > 0 ? Math.max(...watchedArr) : 0;
        const nextEpNum =
          watchedArr.length > 0
            ? media.episode_count && media.episode_count > 0
              ? Math.min(media.episode_count, maxWatched + 1)
              : maxWatched + 1
            : 1;

        const nextStatus: UserMediaProgress['status'] =
          media.episode_count > 0 && watchedSet.size >= media.episode_count
            ? 'completed'
            : watchedSet.size > 0
            ? 'watching'
            : existing.status || 'watching';

        const isNowWatched = watchedSet.has(episodeNum);
        const epKey = `${existing.last_season_num || 1}_${episodeNum}`;
        const prevEpPositions = existing.episode_positions || {};
        const safeDur = existing.resume_duration_sec || 3600;
        const newEpPositions = {
          ...prevEpPositions,
          [epKey]: {
            position: isNowWatched ? safeDur : 0,
            duration: safeDur,
            updated_at: new Date().toISOString(),
          },
        };
        try {
          localStorage.setItem(
            `koup_ep_pos_${media.id}_${existing.last_season_num || 1}_${episodeNum}`,
            JSON.stringify({ position: isNowWatched ? safeDur : 0, duration: safeDur })
          );
        } catch {}

        const updated: UserMediaProgress = {
          ...existing,
          user_id: user.id,
          media_id: media.id,
          status: nextStatus,
          watched_episodes: watchedArr,
          last_episode_num: nextEpNum,
          last_episode_title: `${nextEpNum}. Bölüm`,
          resume_position_sec: 0,
          episode_positions: newEpPositions,
          updated_at: new Date().toISOString(),
          media,
        };

        const next = { ...prev, [media.id]: updated };
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {}

        lastSyncedProgressRef.current[media.id] = {
          positionSec: updated.resume_position_sec || 0,
          seasonNum: updated.last_season_num || 1,
          episodeNum: updated.last_episode_num || 1,
          status: updated.status,
          watchedCount: updated.watched_episodes.length,
          syncedAt: Date.now(),
        };

        const payload = sanitizeProgressDbPayload(updated, user.id);
        void syncProgressRecordToSupabase(payload);

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
          user_id: user.id,
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

        lastSyncedProgressRef.current[media.id] = {
          positionSec: updated.resume_position_sec || 0,
          seasonNum: updated.last_season_num || 1,
          episodeNum: updated.last_episode_num || 1,
          status: updated.status,
          watchedCount: updated.watched_episodes.length,
          syncedAt: Date.now(),
        };

        const payload = sanitizeProgressDbPayload(updated, user.id);
        void syncProgressRecordToSupabase(payload);

        return next;
      });
    },
    [user, isSoftBanned, openAuthModal, pushNotification]
  );

  const setMediaScore = useCallback(
    (media: MediaItem, score: number | null) => {
      if (!user) {
        openAuthModal('Puan verebilmek için lütfen giriş yapın.');
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
          user_id: user.id,
          media_id: media.id,
          status: existing?.status ?? 'watching',
          is_favorite: existing?.is_favorite ?? false,
          user_score: score,
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

        lastSyncedProgressRef.current[media.id] = {
          positionSec: updated.resume_position_sec || 0,
          seasonNum: updated.last_season_num || 1,
          episodeNum: updated.last_episode_num || 1,
          status: updated.status,
          watchedCount: updated.watched_episodes.length,
          syncedAt: Date.now(),
        };

        const payload = sanitizeProgressDbPayload(updated, user.id);
        void syncProgressRecordToSupabase(payload);

        return next;
      });

      if (score != null) {
        pushNotification(
          'Puanınız Kaydedildi',
          `Bu yapım için ${score}/10 puanınız başarıyla kaydedildi.`,
          'success'
        );
      } else {
        pushNotification(
          'Puan Kaldırıldı',
          'Puanınız başarıyla kaldırıldı.',
          'info'
        );
      }
    },
    [user, isSoftBanned, openAuthModal, pushNotification]
  );

  const removeFromLibrary = useCallback(
    async (mediaId: number) => {
      if (!user) {
        openAuthModal('İşlem yapabilmek için lütfen giriş yapın.');
        return;
      }
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[mediaId];
        try {
          localStorage.setItem('koup_progress_v1', JSON.stringify(next));
        } catch {}
        return next;
      });

      delete lastSyncedProgressRef.current[mediaId];
      try {
        await supabase
          .from('user_media_progress')
          .delete()
          .eq('user_id', user.id)
          .eq('media_id', mediaId);

        pushNotification(
          'Kütüphaneden Kaldırıldı',
          'Yapım kütüphanenizden başarıyla kaldırıldı.',
          'info'
        );
      } catch (err) {
        console.error('Failed to delete from user_media_progress:', err);
      }
    },
    [user, openAuthModal, pushNotification]
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
        user_id: user.id,
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

      lastSyncedProgressRef.current[media.id] = {
        positionSec: updated.resume_position_sec || 0,
        seasonNum: updated.last_season_num || 1,
        episodeNum: updated.last_episode_num || 1,
        status: updated.status,
        watchedCount: updated.watched_episodes.length,
        syncedAt: Date.now(),
      };

      const payload = sanitizeProgressDbPayload(updated, user.id);
      void syncProgressRecordToSupabase(payload);

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

      // Persist to user_follows in Supabase
      if (exists) {
        void supabase
          .from('user_follows')
          .delete()
          .eq('user_id', user.id)
          .eq('target_type', 'media')
          .eq('target_id', media.id);
      } else {
        void supabase
          .from('user_follows')
          .insert({
            user_id: user.id,
            target_type: 'media',
            target_id: media.id,
          });
      }

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

      const isFav = favPersonIds.includes(personId);
      const next = isFav ? favPersonIds.filter((id) => id !== personId) : [...favPersonIds, personId];
      setFavPersonIds(next);
      try {
        localStorage.setItem('koup_fav_people_v1', JSON.stringify(next));
      } catch {}

      // Persist to real Supabase person_favorites table
      // (The DB trigger update_person_fav_count automatically increments/decrements people.favorites_count)
      try {
        if (isFav) {
          await supabase
            .from('person_favorites')
            .delete()
            .eq('user_id', user.id)
            .eq('person_id', personId);
        } else {
          await supabase
            .from('person_favorites')
            .insert({ user_id: user.id, person_id: personId });
        }
      } catch (err) {
        console.error('Failed to sync person_favorite to Supabase:', err);
      }

      // Invalidate people & person caches so any subsequent fetch sees fresh data
      try {
        invalidateCache('top_people_');
        invalidateCache('person_');
        invalidateCache('people_');
      } catch {}

      return next.length;
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

      // Persist to user_follows in Supabase
      if (exists) {
        void supabase
          .from('user_follows')
          .delete()
          .eq('user_id', user.id)
          .eq('target_type', 'person')
          .eq('target_id', personId);
      } else {
        void supabase
          .from('user_follows')
          .insert({
            user_id: user.id,
            target_type: 'person',
            target_id: personId,
          });
      }

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
      if (data.session?.access_token) {
        setCachedAccessToken(data.session.access_token);
      }
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

      // Auto-confirm user immediately so user is never blocked by expired activation link
      try {
        await supabase.rpc('confirm_user_by_email', { target_email: email });
      } catch {}

      if (data.session?.access_token) {
        setCachedAccessToken(data.session.access_token);
      }

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
    setCachedAccessToken(null);
    await supabase.auth.signOut();
    setUser(null);
    setProgressMap({});
    setFavPersonIds([]);
    setFollowedMediaIds([]);
    setFollowedPersonIds([]);
    setNotifications([]);
    try {
      localStorage.removeItem('koup_profile_v1');
      localStorage.removeItem('koup_notifs_v1');
      localStorage.removeItem('koup_progress_v1');
      localStorage.removeItem('koup_fav_people_v1');
      localStorage.removeItem('koup_fol_media_v1');
      localStorage.removeItem('koup_fol_people_v1');
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
              user_id: user.id,
              media_id: mediaId,
              status,
              last_season_num: season,
              last_episode_num: episode,
              updated_at: new Date().toISOString(),
            }
          : {
              user_id: user.id,
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

        if (user) {
          lastSyncedProgressRef.current[mediaId] = {
            positionSec: updated.resume_position_sec || 0,
            seasonNum: updated.last_season_num || 1,
            episodeNum: updated.last_episode_num || 1,
            status: updated.status,
            watchedCount: (updated.watched_episodes || []).length,
            syncedAt: Date.now(),
          };

          const payload = sanitizeProgressDbPayload(updated, user.id);
          void syncProgressRecordToSupabase(payload);
        }

        return next;
      });
      pushNotification('Liste Güncellendi', 'İçerik tercihiniz kaydedildi.', 'success');
    },
    [user, isSoftBanned, openAuthModal, pushNotification]
  );

  // Load blocks from DB or localStorage
  useEffect(() => {
    if (!user?.id) {
      try {
        const local = localStorage.getItem('koup_blocked_v1');
        if (local) setBlockedUsers(JSON.parse(local));
      } catch {}
      return;
    }

    async function loadBlocks() {
      try {
        const res = await fetch(`/api/users/block?user_id=${user!.id}`);
        const data = await res.json();
        if (data.success) {
          setBlockedUsers(data.blocked_users || []);
          setBlockedByUserIds(data.blocked_by_ids || []);
          try {
            localStorage.setItem('koup_blocked_v1', JSON.stringify(data.blocked_users || []));
          } catch {}
        }
      } catch (err) {
        console.error('Failed to load blocks:', err);
      }
    }
    loadBlocks();
  }, [user?.id]);

  const blockUser = useCallback(
    async (
      targetUserId: string,
      targetUsername?: string,
      targetDisplayName?: string,
      targetAvatar?: string
    ) => {
      if (!user) {
        setIsAuthModalOpen(true);
        setAuthModalMessage('Kullanıcı engellemek için lütfen giriş yapın.');
        return false;
      }
      if (user.id === targetUserId) {
        pushNotification('Geçersiz İşlem', 'Kendinizi engelleyemezsiniz.', 'info');
        return false;
      }

      const newBlockedUser = {
        id: targetUserId,
        username: targetUsername || 'kullanici',
        display_name: targetDisplayName || targetUsername || 'Kullanıcı',
        avatar_url: targetAvatar || null,
        created_at: new Date().toISOString(),
      };

      setBlockedUsers((prev) => {
        if (prev.some((u) => u.id === targetUserId)) return prev;
        const updated = [newBlockedUser, ...prev];
        try {
          localStorage.setItem('koup_blocked_v1', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      triggerSound('click');
      pushNotification(
        'Kullanıcı Engellendi',
        `@${targetUsername || 'kullanici'} engellendi. Karşılıklı yorumlarınız ve profil erişimi gizlendi.`,
        'info'
      );

      try {
        await fetch('/api/users/block', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blocker_id: user.id,
            blocked_id: targetUserId,
            action: 'block',
          }),
        });
        return true;
      } catch (err) {
        console.error('Failed to persist block:', err);
        return true;
      }
    },
    [user, triggerSound, pushNotification]
  );

  const unblockUser = useCallback(
    async (targetUserId: string) => {
      setBlockedUsers((prev) => {
        const updated = prev.filter((u) => u.id !== targetUserId);
        try {
          localStorage.setItem('koup_blocked_v1', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      triggerSound('click');
      pushNotification('Engel Kaldırıldı', 'Kullanıcının engeli kaldırıldı.', 'success');

      if (user?.id) {
        try {
          await fetch('/api/users/block', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              blocker_id: user.id,
              blocked_id: targetUserId,
              action: 'unblock',
            }),
          });
        } catch (err) {
          console.error('Failed to unblock on server:', err);
        }
      }
      return true;
    },
    [user, triggerSound, pushNotification]
  );

  const isUserBlocked = useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return blockedUsers.some((u) => u.id === userId);
    },
    [blockedUsers]
  );

  const isBlockedBy = useCallback(
    (userId?: string | null) => {
      if (!userId) return false;
      return blockedByUserIds.includes(userId);
    },
    [blockedByUserIds]
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
      flushProgressSync,
      toggleEpisodeWatched,
      setLibraryStatus,
      setMediaScore,
      removeFromLibrary,
      refreshUserLibrary,
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
      blockedUsers,
      blockedByUserIds,
      blockUser,
      unblockUser,
      isUserBlocked,
      isBlockedBy,
      loginWithEmail,
      registerWithEmail,
      logout,
      confirmDialog,
      isTrailerMuted,
      toggleTrailerMuted,
      setTrailerMuted,
      navbarBehavior,
      setNavbarBehavior,
      floatingNavbarEnabled,
      setFloatingNavbarEnabled,
      autoCardTrailerEnabled,
      setAutoCardTrailerEnabled,
    };
  }, [
    isTrailerMuted,
    toggleTrailerMuted,
    setTrailerMuted,
    navbarBehavior,
    setNavbarBehavior,
    floatingNavbarEnabled,
    setFloatingNavbarEnabled,
    autoCardTrailerEnabled,
    setAutoCardTrailerEnabled,
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
    flushProgressSync,
    toggleEpisodeWatched,
    setLibraryStatus,
    setMediaScore,
    removeFromLibrary,
    refreshUserLibrary,
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
    blockedUsers,
    blockedByUserIds,
    blockUser,
    unblockUser,
    isUserBlocked,
    isBlockedBy,
    loginWithEmail,
    registerWithEmail,
    logout,
    confirmDialog,
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
          <ConfirmModal
            isOpen={confirmState.isOpen}
            onClose={handleConfirmClose}
            onConfirm={handleConfirmAccept}
            title={confirmState.options.title}
            message={confirmState.options.message}
            confirmText={confirmState.options.confirmText}
            cancelText={confirmState.options.cancelText}
            isDestructive={confirmState.options.isDestructive}
            icon={confirmState.options.icon}
          />
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
