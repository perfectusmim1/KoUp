'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  ShieldAlert,
  Users,
  Film,
  Tv,
  MessageSquare,
  Radio,
  AlertTriangle,
  Send,
  RefreshCw,
  Search,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  Lock,
  Unlock,
  Volume2,
  Star,
  ExternalLink,
  SlidersHorizontal,
  ChevronDown,
  Layers,
  Database,
  Eye,
  X,
  Play,
  Save,
  LogIn,
  UserPlus,
  LogOut,
  KeyRound,
} from 'lucide-react';
import { supabase, MediaItem, formatContentTypeTR } from '@/lib/supabase';
import CountryFlag from '@/components/CountryFlag';
import { useKoUp } from '@/context/KoUpContext';

type AdminTab =
  | 'overview'
  | 'users'
  | 'series'
  | 'episodes'
  | 'comments'
  | 'scrapers'
  | 'reports'
  | 'broadcast';

interface ScraperConfigRow {
  id: string;
  name: string;
  site_url: string;
  cron_schedule: string;
  is_enabled: boolean;
  last_run_at?: string | null;
  last_status: string;
  items_synced: number;
  notes?: string | null;
}

interface IssueReportRow {
  id: number;
  target_type: string;
  media_id: number;
  season_number: number;
  episode_number: number;
  provider_name?: string | null;
  issue_category: string;
  details?: string | null;
  status: string;
  created_at: string;
}

interface UserProfileRow {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  role: string;
  created_at: string;
  stats_episodes_watched?: number;
  stats_series_completed?: number;
  stats_total_minutes?: number;
}

interface AdminCommentRow {
  id: string | number;
  user_id: string;
  media_id: number;
  episode_id?: number | null;
  content_json: any;
  has_spoiler: boolean;
  likes_count: number;
  created_at: string;
  profiles?: {
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
    role?: string;
  } | null;
  media?: {
    title: string;
    slug: string;
  } | null;
}

interface AdminEpisodeItem {
  id: number;
  media_id: number;
  season_number: number;
  episode_number: number;
  episode_name: string;
  episode_type: string;
  status: string;
  scheduled_release_at?: string | null;
  translation_note?: string | null;
  video_sources?: any[];
}

export default function AdminDashboardPage() {
  const {
    user,
    setIsAuthModalOpen,
    pushNotification,
    loginWithEmail,
    registerWithEmail,
    logout,
  } = useKoUp();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // 403 Security Gate Inline Auth State
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [adminCount, setAdminCount] = useState<number | null>(null);

  // Stats
  const [stats, setStats] = useState({
    totalMedia: 17559,
    totalPeople: 21814,
    totalEpisodes: 2515,
    totalUsers: 0,
    totalComments: 0,
    openReports: 0,
  });

  // Scrapers, Reports, Vitrin
  const [scrapers, setScrapers] = useState<ScraperConfigRow[]>([]);
  const [reports, setReports] = useState<IssueReportRow[]>([]);
  const [featuredMedia, setFeaturedMedia] = useState<MediaItem[]>([]);
  const [runningScraperId, setRunningScraperId] = useState<string | null>(null);

  // Broadcast
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');

  // Users Tab State
  const [usersList, setUsersList] = useState<UserProfileRow[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');
  const [promoteEmailInput, setPromoteEmailInput] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  // Series Tab State
  const [seriesList, setSeriesList] = useState<MediaItem[]>([]);
  const [seriesSearchQuery, setSeriesSearchQuery] = useState('');
  const [seriesTypeFilter, setSeriesTypeFilter] = useState('ALL');
  const [seriesCountryFilter, setSeriesCountryFilter] = useState('ALL');
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [editingSeries, setEditingSeries] = useState<Partial<MediaItem> | null>(null);

  // Episodes Tab State
  const [selectedMediaForEp, setSelectedMediaForEp] = useState<MediaItem | null>(null);
  const [episodesList, setEpisodesList] = useState<AdminEpisodeItem[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [epModalOpen, setEpModalOpen] = useState(false);
  const [editingEp, setEditingEp] = useState<Partial<AdminEpisodeItem> | null>(null);
  const [newSourceModalOpen, setNewSourceModalOpen] = useState(false);
  const [selectedEpForSource, setSelectedEpForSource] = useState<AdminEpisodeItem | null>(null);
  const [sourceProvider, setSourceProvider] = useState('Vidmoly');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceQuality, setSourceQuality] = useState('1080p Native');

  // Comments Tab State
  const [commentsList, setCommentsList] = useState<AdminCommentRow[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Check role
  const isAdmin = user?.role === 'admin';

  // Check if any admin exists in database
  useEffect(() => {
    if (isAdmin) return;
    async function checkAdmins() {
      try {
        const { count } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin');
        setAdminCount(count || 0);
      } catch {
        setAdminCount(0);
      }
    }
    checkAdmins();
  }, [isAdmin]);

  // Load Initial Admin Data
  useEffect(() => {
    if (!isAdmin) return;

    async function loadInitial() {
      try {
        const [sRes, rRes, fRes, uCountRes, cCountRes] = await Promise.all([
          supabase.from('scraper_configs').select('*').order('id'),
          supabase
            .from('issue_reports')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(40),
          supabase
            .from('media')
            .select('*')
            .eq('is_featured', true)
            .order('featured_order', { ascending: true })
            .limit(16),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('comments').select('id', { count: 'exact', head: true }),
        ]);

        setScrapers((sRes.data as ScraperConfigRow[]) || []);
        setReports((rRes.data as IssueReportRow[]) || []);
        setFeaturedMedia((fRes.data as MediaItem[]) || []);
        setStats((prev) => ({
          ...prev,
          totalUsers: uCountRes.count || 0,
          totalComments: cCountRes.count || 0,
          openReports: (rRes.data || []).filter((r) => r.status !== 'resolved').length,
        }));
      } catch (err) {
        console.error('Admin initial load error:', err);
      }
    }
    loadInitial();
  }, [isAdmin]);

  // Load Users tab on demand
  useEffect(() => {
    if (!isAdmin || activeTab !== 'users') return;
    async function loadUsers() {
      setUserLoading(true);
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        setUsersList((data as UserProfileRow[]) || []);
        setStats((s) => ({ ...s, totalUsers: data?.length || s.totalUsers }));
      } finally {
        setUserLoading(false);
      }
    }
    loadUsers();
  }, [isAdmin, activeTab]);

  // Load Series tab on demand or search
  useEffect(() => {
    if (!isAdmin || (activeTab !== 'series' && activeTab !== 'episodes')) return;
    const timer = setTimeout(async () => {
      setSeriesLoading(true);
      try {
        let q = supabase.from('media').select('*').order('id', { ascending: false }).limit(60);
        if (seriesSearchQuery.trim()) {
          q = q.ilike('title', `%${seriesSearchQuery.trim()}%`);
        }
        if (seriesTypeFilter !== 'ALL') {
          q = q.eq('content_type', seriesTypeFilter);
        }
        if (seriesCountryFilter !== 'ALL') {
          q = q.eq('country_code', seriesCountryFilter);
        }
        const { data } = await q;
        setSeriesList((data as MediaItem[]) || []);
      } finally {
        setSeriesLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [isAdmin, activeTab, seriesSearchQuery, seriesTypeFilter, seriesCountryFilter]);

  // Load Episodes when a series is selected
  useEffect(() => {
    if (!isAdmin || !selectedMediaForEp) return;
    async function loadEpisodes() {
      setEpLoading(true);
      try {
        // Query both Supabase episodes and archive sources API
        const { data: supaEps } = await supabase
          .from('episodes')
          .select('*')
          .eq('media_id', selectedMediaForEp!.id)
          .order('season_number', { ascending: true })
          .order('episode_number', { ascending: true });

        // Also fetch from API endpoint to see any SQLite sources
        let combined: AdminEpisodeItem[] = (supaEps as AdminEpisodeItem[]) || [];

        try {
          const apiRes = await fetch(`/api/sources/${selectedMediaForEp!.id}`);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData?.episodes && apiData.episodes.length > 0) {
              const supaMap = new Map(
                combined.map((e) => [`${e.season_number}_${e.episode_number}`, e])
              );
              for (const ae of apiData.episodes) {
                const key = `${ae.season_number}_${ae.episode_number}`;
                const exist = supaMap.get(key);
                if (exist) {
                  exist.video_sources = [
                    ...(exist.video_sources || []),
                    ...(ae.sources || []),
                  ];
                } else {
                  combined.push({
                    id: ae.id,
                    media_id: selectedMediaForEp!.id,
                    season_number: ae.season_number,
                    episode_number: ae.episode_number,
                    episode_name: ae.episode_name,
                    episode_type: ae.episode_type || 'bolum',
                    status: ae.status || 'published',
                    video_sources: ae.sources || [],
                  });
                }
              }
            }
          }
        } catch {
          // ignore API fallback errors
        }

        combined.sort((a, b) =>
          a.season_number !== b.season_number
            ? a.season_number - b.season_number
            : a.episode_number - b.episode_number
        );
        setEpisodesList(combined);
      } finally {
        setEpLoading(false);
      }
    }
    loadEpisodes();
  }, [isAdmin, selectedMediaForEp]);

  // Load Comments tab on demand
  useEffect(() => {
    if (!isAdmin || activeTab !== 'comments') return;
    async function loadComments() {
      setCommentsLoading(true);
      try {
        const { data } = await supabase
          .from('comments')
          .select('*, profiles(username, display_name, avatar_url, role), media(title, slug)')
          .order('created_at', { ascending: false })
          .limit(60);
        setCommentsList((data as AdminCommentRow[]) || []);
      } finally {
        setCommentsLoading(false);
      }
    }
    loadComments();
  }, [isAdmin, activeTab]);

  // Scraper Actions
  const triggerScraperNow = async (scraperId: string, name: string) => {
    setRunningScraperId(scraperId);
    try {
      const resp = await fetch('/api/admin/scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraperId }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setScrapers((prev) =>
          prev.map((s) =>
            s.id === scraperId
              ? {
                  ...s,
                  items_synced: data.newTotal,
                  last_run_at: data.timestamp,
                  last_status: 'healthy',
                }
              : s
          )
        );
        pushNotification(
          'Scraper & Senkron Tamamlandı',
          `${name} tarandı (+${data.syncedDelta} yeni/güncel kayıt doğrulandı).`,
          'success'
        );
      }
    } finally {
      setRunningScraperId(null);
    }
  };

  const toggleScraperActive = async (bot: ScraperConfigRow) => {
    const nextState = !bot.is_enabled;
    setScrapers((prev) =>
      prev.map((s) => (s.id === bot.id ? { ...s, is_enabled: nextState } : s))
    );
    await supabase.rpc('toggle_scraper_enabled', {
      p_site_key: bot.id,
      p_enabled: nextState,
    });
    pushNotification(
      'Scraper Durumu Güncellendi',
      `${bot.name} ${nextState ? 'Aktif Edildi' : 'Devre Dışı Bırakıldı'}.`,
      nextState ? 'success' : 'info'
    );
  };

  // Broadcast
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return;
    await supabase.from('broadcast_events').insert({
      target_type: 'global',
      title: broadcastTitle.trim(),
      message: broadcastBody.trim(),
      link_url: '/',
    });
    pushNotification(broadcastTitle.trim(), broadcastBody.trim(), 'episode');
    setBroadcastTitle('');
    setBroadcastBody('');
  };

  // User Actions
  const handleSetUserRole = async (targetId: string, newRole: string) => {
    try {
      const { error } = await supabase.rpc('admin_set_user_role', {
        target_user_id: targetId,
        new_role: newRole,
      });
      if (error) {
        // Fallback direct update
        await supabase.from('profiles').update({ role: newRole }).eq('id', targetId);
      }
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetId ? { ...u, role: newRole } : u))
      );
      pushNotification('Rol Güncellendi', `Kullanıcı yetkisi ${newRole} olarak ayarlandı.`, 'success');
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Yetki güncellenemedi.', 'info');
    }
  };

  const handlePromoteAdminByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoteEmailInput.trim()) return;
    try {
      const { data, error } = await supabase.rpc('grant_admin_by_email', {
        target_email: promoteEmailInput.trim(),
      });
      if (error) throw error;
      pushNotification('Admin Yetkisi Verildi', `${promoteEmailInput} başarıyla yönetici yapıldı.`, 'success');
      setPromoteEmailInput('');
      // Reload users list
      const { data: uData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      setUsersList((uData as UserProfileRow[]) || []);
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Admin ataması başarısız oldu.', 'info');
    }
  };

  // Series Actions
  const handleToggleFeatured = async (media: MediaItem) => {
    const nextVal = !media.is_featured;
    setSeriesList((prev) =>
      prev.map((m) => (m.id === media.id ? { ...m, is_featured: nextVal } : m))
    );
    await supabase
      .from('media')
      .update({ is_featured: nextVal, featured_order: nextVal ? 1 : 99 })
      .eq('id', media.id);
    // Reload featured
    const { data: fRes } = await supabase
      .from('media')
      .select('*')
      .eq('is_featured', true)
      .order('featured_order', { ascending: true })
      .limit(16);
    setFeaturedMedia((fRes as MediaItem[]) || []);
    pushNotification(
      'Vitrin Güncellendi',
      `"${media.title}" ana sayfa dev slider'ına ${nextVal ? 'eklendi' : 'çıkarıldı'}.`,
      'success'
    );
  };

  const handleSaveSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSeries || !editingSeries.title) return;
    try {
      if (editingSeries.id) {
        // Update
        const { error } = await supabase
          .from('media')
          .update(editingSeries)
          .eq('id', editingSeries.id);
        if (error) throw error;
        setSeriesList((prev) =>
          prev.map((m) => (m.id === editingSeries.id ? ({ ...m, ...editingSeries } as MediaItem) : m))
        );
        pushNotification('Seri Güncellendi', `"${editingSeries.title}" başarıyla kaydedildi.`, 'success');
      } else {
        // Insert
        const slug =
          editingSeries.slug ||
          editingSeries.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        const newRecord = {
          ...editingSeries,
          slug,
          country_code: editingSeries.country_code || 'KR',
          content_type: editingSeries.content_type || 'kdrama',
          status_broadcast: editingSeries.status_broadcast || 'airing',
          views_total: 0,
          views_weekly: 0,
          favorites_count: 0,
          followers_count: 0,
        };
        const { data, error } = await supabase
          .from('media')
          .insert(newRecord)
          .select()
          .single();
        if (error) throw error;
        if (data) setSeriesList((prev) => [data as MediaItem, ...prev]);
        pushNotification('Yeni Seri Eklendi', `"${editingSeries.title}" kataloğa eklendi.`, 'success');
      }
      setSeriesModalOpen(false);
      setEditingSeries(null);
    } catch (err: any) {
      pushNotification('Kayıt Hatası', err.message, 'info');
    }
  };

  const handleDeleteSeries = async (mediaId: number, title: string) => {
    if (!confirm(`"${title}" serisini ve tüm bağlı verilerini silmek istediğinize emin misiniz?`)) return;
    try {
      await supabase.from('media').delete().eq('id', mediaId);
      setSeriesList((prev) => prev.filter((m) => m.id !== mediaId));
      pushNotification('Seri Silindi', `"${title}" katalogdan kaldırıldı.`, 'info');
    } catch (err: any) {
      pushNotification('Silme Hatası', err.message, 'info');
    }
  };

  // Episode & Source Actions
  const handleSaveEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMediaForEp || !editingEp) return;
    try {
      const payload = {
        media_id: selectedMediaForEp.id,
        season_number: Number(editingEp.season_number) || 1,
        episode_number: Number(editingEp.episode_number) || 1,
        episode_name: editingEp.episode_name || `${editingEp.episode_number}. Bölüm`,
        episode_type: editingEp.episode_type || 'bolum',
        status: editingEp.status || 'published',
        translation_note: editingEp.translation_note || null,
        scheduled_release_at: editingEp.scheduled_release_at || null,
        video_sources: editingEp.video_sources || [],
      };

      if (editingEp.id && editingEp.id < 10000000) {
        // Update existing Supabase row
        await supabase.from('episodes').update(payload).eq('id', editingEp.id);
      } else {
        // Upsert into Supabase
        await supabase.from('episodes').upsert(payload, {
          onConflict: 'media_id,season_number,episode_number',
        });
      }

      setEpisodesList((prev) => {
        const key = `${payload.season_number}_${payload.episode_number}`;
        const idx = prev.findIndex((e) => `${e.season_number}_${e.episode_number}` === key);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...payload };
          return next;
        }
        return [...prev, payload as AdminEpisodeItem];
      });

      setEpModalOpen(false);
      setEditingEp(null);
      pushNotification('Bölüm Kaydedildi', `${payload.season_number}. Sezon ${payload.episode_number}. Bölüm güncellendi.`, 'success');
    } catch (err: any) {
      pushNotification('Bölüm Kayıt Hatası', err.message, 'info');
    }
  };

  const handleAddSourceToEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEpForSource || !sourceUrl.trim()) return;
    try {
      const newSourceObj = {
        source_name: sourceProvider,
        provider: sourceProvider.toLowerCase(),
        direct_url: sourceUrl.trim(),
        embed_id: '',
        site: 'admin',
        fansub: null,
        stream_type: sourceUrl.includes('.m3u8') ? 'hls' : 'locked_iframe',
        quality_label: sourceQuality,
      };

      const updatedSources = [...(selectedEpForSource.video_sources || []), newSourceObj];

      await supabase.from('episodes').upsert(
        {
          media_id: selectedEpForSource.media_id,
          season_number: selectedEpForSource.season_number,
          episode_number: selectedEpForSource.episode_number,
          episode_name: selectedEpForSource.episode_name,
          episode_type: selectedEpForSource.episode_type || 'bolum',
          status: 'published',
          video_sources: updatedSources,
        },
        { onConflict: 'media_id,season_number,episode_number' }
      );

      setEpisodesList((prev) =>
        prev.map((ep) =>
          ep.season_number === selectedEpForSource.season_number &&
          ep.episode_number === selectedEpForSource.episode_number
            ? { ...ep, video_sources: updatedSources }
            : ep
        )
      );

      setNewSourceModalOpen(false);
      setSourceUrl('');
      pushNotification('Kaynak Eklendi', `${sourceProvider} akış kaynağı bölüme bağlandı.`, 'success');
    } catch (err: any) {
      pushNotification('Kaynak Hatası', err.message, 'info');
    }
  };

  const handleDeleteSource = async (ep: AdminEpisodeItem, sourceIndex: number) => {
    if (!confirm('Bu video kaynağını kaldırmak istediğinize emin misiniz?')) return;
    const filtered = (ep.video_sources || []).filter((_, i) => i !== sourceIndex);
    await supabase.from('episodes').upsert(
      {
        media_id: ep.media_id,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
        episode_name: ep.episode_name,
        episode_type: ep.episode_type || 'bolum',
        status: ep.status,
        video_sources: filtered,
      },
      { onConflict: 'media_id,season_number,episode_number' }
    );
    setEpisodesList((prev) =>
      prev.map((e) =>
        e.season_number === ep.season_number && e.episode_number === ep.episode_number
          ? { ...e, video_sources: filtered }
          : e
      )
    );
    pushNotification('Kaynak Kaldırıldı', 'Video kaynağı temizlendi.', 'info');
  };

  // Comment Actions
  const handleDeleteComment = async (commentId: string | number) => {
    if (!confirm('Bu yorumu kaldırmak istediğinize emin misiniz?')) return;
    await supabase.from('comments').delete().eq('id', commentId);
    setCommentsList((prev) => prev.filter((c) => c.id !== commentId));
    pushNotification('Yorum Silindi', 'Topluluk yorumu moderasyon tarafından silindi.', 'info');
  };

  const handleToggleSpoiler = async (comment: AdminCommentRow) => {
    const nextVal = !comment.has_spoiler;
    await supabase.from('comments').update({ has_spoiler: nextVal }).eq('id', comment.id);
    setCommentsList((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, has_spoiler: nextVal } : c))
    );
    pushNotification('Spoiler Durumu Değişti', nextVal ? 'Spoiler maskesi eklendi.' : 'Spoiler maskesi kaldırıldı.', 'info');
  };

  // Issue Reports
  const resolveIssue = async (reportId: number) => {
    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, status: 'resolved' } : r))
    );
    await supabase
      .from('issue_reports')
      .update({ status: 'resolved' })
      .eq('id', reportId);
    pushNotification(
      'Sorun Çözüldü İşaretlendi',
      `Bildirim #${reportId} onarıldı ve kapatıldı.`,
      'success'
    );
  };

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const matchSearch =
        !userSearchQuery.trim() ||
        u.username.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
        (u.display_name && u.display_name.toLowerCase().includes(userSearchQuery.toLowerCase()));
      const matchRole = userRoleFilter === 'ALL' || u.role === userRoleFilter;
      return matchSearch && matchRole;
    });
  }, [usersList, userSearchQuery, userRoleFilter]);

  // Filtered Series
  const filteredSeries = useMemo(() => {
    return seriesList.filter((m) => {
      const matchType = seriesTypeFilter === 'ALL' || m.content_type === seriesTypeFilter;
      const code = (m.country_code || (m as any).country || '').toUpperCase();
      const matchCountry = seriesCountryFilter === 'ALL' || code === seriesCountryFilter;
      return matchType && matchCountry;
    });
  }, [seriesList, seriesTypeFilter, seriesCountryFilter]);

  // 403 Inline Auth Handler
  const handleInlineAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (authMode === 'login') {
        const err = await loginWithEmail(authEmail.trim(), authPassword);
        if (err) {
          setAuthError(
            err.includes('Invalid login credentials')
              ? 'E-posta veya şifre hatalı. Lütfen kontrol ediniz.'
              : err
          );
        } else {
          pushNotification('Giriş Başarılı', 'Yönetici paneli yükleniyor...', 'success');
        }
      } else {
        if (!authUsername.trim() || authUsername.trim().length < 3) {
          setAuthError('Kullanıcı adı en az 3 karakter olmalıdır.');
          setAuthLoading(false);
          return;
        }
        if (authPassword.length < 6) {
          setAuthError('Şifre en az 6 karakter olmalıdır.');
          setAuthLoading(false);
          return;
        }
        const err = await registerWithEmail(authEmail.trim(), authPassword, authUsername.trim());
        if (err) {
          setAuthError(err);
        } else {
          pushNotification('Hesap Oluşturuldu', 'Yönetici hesabı tanımlandı.', 'success');
        }
      }
    } catch (err: any) {
      setAuthError(err.message || 'Giriş işlemi gerçekleştirilemedi.');
    } finally {
      setAuthLoading(false);
    }
  };

  // UNAUTHORIZED / SECURITY GATE
  if (!isAdmin) {
    return (
      <div className="w-full min-h-[calc(100vh-8rem)] pt-24 sm:pt-32 pb-24 max-w-2xl mx-auto px-4 sm:px-6 text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-rose-500/15 border border-rose-500/30 text-rose-400 mx-auto flex items-center justify-center shadow-[0_0_32px_rgba(244,63,94,0.3)]">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            403 · KoUp Yönetici Paneli Kilitli
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            Bu alana yalnızca sistem yöneticileri (admin) erişebilir. Ziyaretçiler ve normal üyeler için yönetim paneli tamamen izoledir.
          </p>
        </div>

        {/* Status / Notice Card */}
        <div className="p-6 rounded-3xl apple-glass border border-white/10 space-y-4 text-left">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-white/75 leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">
                İlk Hesap Otomatik Master Admin Yetkisi Alır
              </strong>
              Veritabanında henüz yönetici yoksa (Mevcut Yönetici Sayısı:{' '}
              <span className="font-mono text-emerald-400 font-bold">
                {adminCount !== null ? adminCount : 'Kontrol ediliyor...'}
              </span>
              ), kayıt oluşturduğunuz ilk hesap otomatik olarak <strong>Sistem Yöneticisi (Admin)</strong> yetkisini kazanır.
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-xs text-white/75 leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">
                Güvenlik & Rol Denetimi (PostgreSQL RLS)
              </strong>
              Kullanıcı rolleri veritabanı düzeyinde korunur; admin paneli yetkisiz çağrılardan izoledir.
            </div>
          </div>
        </div>

        {/* If user is already logged in with a non-admin role */}
        {user && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/25 flex items-center justify-between gap-3 text-left">
            <div>
              <div className="text-xs font-bold text-amber-300">
                Giriş Yapılmış Hesap: @{user.username}
              </div>
              <div className="text-[11px] text-white/60">
                Mevcut Rol: <span className="font-mono font-bold text-white uppercase">{user.role}</span> · Bu rol yönetim paneline erişemez.
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Çıkış Yap</span>
            </button>
          </div>
        )}

        {/* Primary Action Button (Triggers Global Auth Modal) */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-white text-black font-bold text-sm hover:bg-white/90 cursor-pointer shadow-2xl transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>{user ? 'Farklı Yönetici Hesabıyla Giriş Yap' : 'Yönetici Girişi Yap / Hesap Oluştur'}</span>
          </button>
        </div>

        {/* Direct Inline Login / Register Card (Zero-friction alternative) */}
        <div className="p-6 rounded-3xl apple-glass border border-white/15 space-y-4 text-left shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <span className="text-xs font-mono uppercase tracking-widest text-amber-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Hızlı Yönetici Girişi & Kayıt</span>
            </span>
            <div className="flex items-center p-1 rounded-xl bg-black/60 border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => { setAuthMode('login'); setAuthError(null); }}
                className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  authMode === 'login' ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode('register'); setAuthError(null); }}
                className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  authMode === 'register' ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                Kayıt Ol (İlk Hesap = Admin)
              </button>
            </div>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {authError}
            </div>
          )}

          <form onSubmit={handleInlineAuth} className="space-y-3">
            {authMode === 'register' && (
              <div>
                <label className="block text-[11px] font-medium text-white/70 mb-1">
                  Kullanıcı Adı
                </label>
                <input
                  type="text"
                  required
                  placeholder="admin_koup"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40"
                />
              </div>
            )}
            <div>
              <label className="block text-[11px] font-medium text-white/70 mb-1">
                E-posta Adresi
              </label>
              <input
                type="email"
                required
                placeholder="admin@koup.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-white/70 mb-1">
                Şifre
              </label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              {authLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Yetki Doğrulanıyor...</span>
                </>
              ) : authMode === 'login' ? (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Yönetici Olarak Giriş Yap</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Master Admin Hesabı Oluştur ve Giriş Yap</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen pt-28 pb-32 max-w-[1720px] mx-auto px-4 sm:px-8 lg:px-12 space-y-8 overflow-x-hidden">
      {/* 1. TOP HEADER & METRICS */}
      <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 flex flex-col xl:flex-row xl:items-center justify-between gap-6 shadow-2xl">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-amber-300">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>KoUp Master Yönetim & Denetim Merkezi · RLS Aktif</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Sistem Yönetim Paneli
          </h1>
          <p className="text-xs sm:text-sm text-white/65 max-w-3xl leading-relaxed">
            Kullanıcıları, 17.500+ yapımlık arşivi, bölümleri ve video akış linklerini, yorum moderasyonunu, otomatik scraper cron botlarını ve acil durum sorun bildirimlerini tek merkezden yönetin.
          </p>
        </div>

        {/* Live Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10">
            <div className="text-[10px] font-mono text-emerald-400">SERİ / YAPIM</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {stats.totalMedia.toLocaleString('tr-TR')}
            </div>
            <div className="text-[10px] text-white/45">Dizi, Film, Anime</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10">
            <div className="text-[10px] font-mono text-amber-300">KAYITLI ÜYE</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {stats.totalUsers} Üye
            </div>
            <div className="text-[10px] text-white/45">Supabase Auth</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10">
            <div className="text-[10px] font-mono text-sky-400">YORUMLAR</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {stats.totalComments} Adet
            </div>
            <div className="text-[10px] text-white/45">Topluluk Etkileşimi</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10">
            <div className="text-[10px] font-mono text-rose-400">AÇIK SORUN</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {stats.openReports} Bildirim
            </div>
            <div className="text-[10px] text-white/45">Watchdog Kuyruğu</div>
          </div>
        </div>
      </div>

      {/* 2. TAB NAVIGATION BAR (SMOOTH HORIZONTAL SCROLL) */}
      <div className="sticky top-20 z-40 p-1.5 rounded-2xl glass-pill-dark border border-white/10 shadow-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar overscroll-x-contain touch-pan-x touch-pan-y">
        {[
          { id: 'overview', label: 'Genel Bakış', icon: Layers },
          { id: 'users', label: 'Kullanıcılar', icon: Users, badge: stats.totalUsers },
          { id: 'series', label: 'Seri & Medya', icon: Film, badge: stats.totalMedia },
          { id: 'episodes', label: 'Bölümler & Kaynaklar', icon: Tv },
          { id: 'comments', label: 'Yorum Moderasyonu', icon: MessageSquare, badge: stats.totalComments },
          { id: 'scrapers', label: 'Scraper Botları & Cron', icon: Radio },
          { id: 'reports', label: 'Sorun Bildirimleri', icon: AlertTriangle, badge: stats.openReports },
          { id: 'broadcast', label: 'Toplu Bildirim', icon: Send },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                active
                  ? 'bg-white text-black shadow-lg font-bold'
                  : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    active ? 'bg-black/15 text-black' : 'bg-white/10 text-white/75'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ================= TAB 1: GENEL BAKIŞ (OVERVIEW) ================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-3xl apple-glass p-6 border border-white/15 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">
                  Hızlı İşlemler
                </span>
                <SlidersHorizontal className="w-4 h-4 text-white/40" />
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => setActiveTab('users')}
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-300" />
                    <span>Kullanıcı Yönetimine Git</span>
                  </span>
                  <span className="text-white/40 font-mono">→</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('series');
                    setEditingSeries({});
                    setSeriesModalOpen(true);
                  }}
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span>Yeni Dizi / Anime Ekle</span>
                  </span>
                  <span className="text-white/40 font-mono">+</span>
                </button>
                <button
                  onClick={() => setActiveTab('episodes')}
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Tv className="w-4 h-4 text-sky-400" />
                    <span>Bölüm & Kaynak Bağla</span>
                  </span>
                  <span className="text-white/40 font-mono">→</span>
                </button>
              </div>
            </div>

            <div className="rounded-3xl apple-glass p-6 border border-white/15 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-amber-300">
                  Acil Durum & Watchdog
                </span>
                <AlertTriangle className="w-4 h-4 text-amber-300" />
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                Kullanıcılardan gelen kırık video, kayık altyazı veya yanlış bölüm bildirimleri burada toplanır.
              </p>
              <div className="p-4 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">Bekleyen Bildirim:</span>
                <span className="text-sm font-bold font-mono text-amber-300">
                  {stats.openReports} Adet
                </span>
              </div>
              <button
                onClick={() => setActiveTab('reports')}
                className="w-full py-2.5 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-bold hover:bg-amber-400/30 cursor-pointer"
              >
                Bildirimleri İncele ({stats.openReports})
              </button>
            </div>

            <div className="rounded-3xl apple-glass p-6 border border-white/15 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-sky-400">
                  Bot Motorları
                </span>
                <Radio className="w-4 h-4 text-sky-400" />
              </div>
              <p className="text-xs text-white/60 leading-relaxed">
                WebDramaTurkey2, TRAnimeizle, DiziYou, DiziBox, AnimeciX ve AsyaMag canlı botları devrede.
              </p>
              <div className="p-4 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">Aktif Scraperlar:</span>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {scrapers.filter((s) => s.is_enabled).length} / {scrapers.length} Aktif
                </span>
              </div>
              <button
                onClick={() => setActiveTab('scrapers')}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer"
              >
                Scraper Kontrol Merkezine Git
              </button>
            </div>
          </div>

          {/* Featured Vitrin Slider Section */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Ana Sayfa Hero Slider Vitrini ({featuredMedia.length} Seçkin Yapım)
                </h3>
                <p className="text-xs text-white/55 mt-0.5">
                  Buradaki yapımlar ana sayfanın dev açılış sahnesinde yer alır.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('series')}
                className="text-xs text-white/70 hover:text-white flex items-center gap-1 font-semibold"
              >
                <span>Tüm Kataloğu Gör</span>
                <span>→</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {featuredMedia.map((m, i) => (
                <div
                  key={m.id}
                  className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/30 transition-all relative group"
                >
                  <div className="text-[10px] font-mono text-amber-300">
                    Vitrin #{i + 1}
                  </div>
                  <div className="text-xs font-bold text-white truncate mt-0.5">
                    {m.title}
                  </div>
                  <div className="text-[10px] font-mono text-white/50 flex items-center gap-1 mt-0.5">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span>{m.site_rating || m.rating || 9.0}</span>
                  </div>
                  <button
                    onClick={() => handleToggleFeatured(m)}
                    className="mt-2 text-[10px] text-rose-300 hover:text-rose-200 block underline cursor-pointer"
                  >
                    Vitrinden Çıkar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: KULLANICI YÖNETİMİ (USERS) ================= */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-300" />
                  <span>Kullanıcı & Üye Yönetimi</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  Kullanıcı rollerini güncelleyin (Admin, Moderatör, Çevirmen, Üye), hesapları denetleyin veya askıya alın.
                </p>
              </div>

              {/* Direct Promote Admin by Email */}
              <form
                onSubmit={handlePromoteAdminByEmail}
                className="flex items-center gap-2 p-1.5 rounded-2xl bg-black/50 border border-white/10 w-full md:w-auto"
              >
                <input
                  type="email"
                  required
                  placeholder="admin_yapilacak@eposta.com"
                  value={promoteEmailInput}
                  onChange={(e) => setPromoteEmailInput(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-56"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-amber-400 text-black text-xs font-bold hover:bg-amber-300 transition-all cursor-pointer whitespace-nowrap"
                >
                  Admin Yap
                </button>
              </form>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Kullanıcı adı veya isim ile ara..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {['ALL', 'admin', 'moderator', 'translator', 'editor', 'user', 'banned'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setUserRoleFilter(r)}
                    className={`px-3 py-2 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                      userRoleFilter === r
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Users Table */}
            {userLoading ? (
              <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Kullanıcılar yükleniyor...</span>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Kayıtlı kullanıcı bulunamadı.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50 font-mono uppercase tracking-wider">
                      <th className="pb-3 pl-3">Kullanıcı</th>
                      <th className="pb-3">Kayıt Tarihi</th>
                      <th className="pb-3">İzleme İstatistiği</th>
                      <th className="pb-3">Mevcut Rol</th>
                      <th className="pb-3 text-right pr-3">Rol Değiştir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 pl-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-white font-bold shrink-0">
                              {u.username.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-white">
                                {u.display_name || u.username}
                              </div>
                              <div className="text-[11px] font-mono text-white/45">
                                @{u.username}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 text-white/60 font-mono">
                          {new Date(u.created_at).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="py-3.5 text-white/60 font-mono">
                          {u.stats_episodes_watched || 0} Bölüm · {u.stats_series_completed || 0} Dizi
                        </td>
                        <td className="py-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
                              u.role === 'admin'
                                ? 'bg-amber-400/20 text-amber-300 border-amber-400/30'
                                : u.role === 'moderator'
                                ? 'bg-purple-400/20 text-purple-300 border-purple-400/30'
                                : u.role === 'translator'
                                ? 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30'
                                : u.role === 'editor'
                                ? 'bg-sky-400/20 text-sky-300 border-sky-400/30'
                                : u.role === 'banned'
                                ? 'bg-rose-500/20 text-rose-300 border-rose-400/30'
                                : 'bg-white/10 text-white/70 border-white/15'
                            }`}
                          >
                            {u.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3.5 text-right pr-3">
                          <select
                            value={u.role}
                            onChange={(e) => handleSetUserRole(u.id, e.target.value)}
                            className="px-3 py-1.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                          >
                            <option value="user">Üye (User)</option>
                            <option value="translator">Çevirmen (Translator)</option>
                            <option value="editor">Editör (Editor)</option>
                            <option value="moderator">Moderatör (Moderator)</option>
                            <option value="admin">Sistem Yöneticisi (Admin)</option>
                            <option value="banned">Askıya Al (Banned)</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: SERİ & MEDYA YÖNETİMİ (SERIES) ================= */}
      {activeTab === 'series' && (
        <div className="space-y-6">
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Film className="w-5 h-5 text-emerald-400" />
                  <span>Seri & Medya Kataloğu ({filteredSeries.length})</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  17.500+ Dizi, Anime, Asya Filmi ve TV Programı üst verilerini düzenleyin, vitrin sıralamasını belirleyin veya yeni yapım ekleyin.
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingSeries({});
                  setSeriesModalOpen(true);
                }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-lg shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Yeni Seri Ekle</span>
              </button>
            </div>

            {/* Search & Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Seri adı veya slug ile ara..."
                  value={seriesSearchQuery}
                  onChange={(e) => setSeriesSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {['ALL', 'kdrama', 'cdrama', 'anime', 'movie', 'variety'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSeriesTypeFilter(t)}
                    className={`px-3 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer ${
                      seriesTypeFilter === t
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {['ALL', 'KR', 'CN', 'JP', 'TH', 'TW', 'US'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setSeriesCountryFilter(c)}
                    className={`px-3 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer ${
                      seriesCountryFilter === c
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Series Table */}
            {seriesLoading ? (
              <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Seriler aranıyor...</span>
              </div>
            ) : filteredSeries.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Aramanızla eşleşen yapım bulunamadı.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50 font-mono uppercase tracking-wider">
                      <th className="pb-3 pl-3">Afiş & Başlık</th>
                      <th className="pb-3">Tür & Ülke</th>
                      <th className="pb-3">Yıl / Durum</th>
                      <th className="pb-3">Vitrin (Hero)</th>
                      <th className="pb-3 text-right pr-3">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredSeries.map((m) => (
                      <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 pl-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-14 rounded-xl overflow-hidden bg-black/60 border border-white/10 shrink-0">
                              {m.cover_image ? (
                                <img
                                  src={m.cover_image}
                                  alt={m.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-white/30 font-mono">
                                  Yok
                                </div>
                              )}
                            </div>
                            <div>
                              <Link
                                href={`/seri/${m.slug}`}
                                target="_blank"
                                className="font-bold text-white hover:underline flex items-center gap-1.5"
                              >
                                <span>{m.title}</span>
                                <ExternalLink className="w-3 h-3 text-white/40" />
                              </Link>
                              <div className="text-[11px] text-white/45">
                                {m.native_title || m.slug}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-white/70">
                          <div className="flex items-center gap-2">
                            <CountryFlag code={m.country_code || (m as any).country} />
                            <span>{formatContentTypeTR(m.content_type)}</span>
                          </div>
                        </td>
                        <td className="py-3 text-white/60 font-mono">
                          {m.release_year || '—'} · {m.status_broadcast || 'airing'}
                        </td>
                        <td className="py-3">
                          <button
                            onClick={() => handleToggleFeatured(m)}
                            className={`px-3 py-1 rounded-full text-[11px] font-mono font-semibold transition-all cursor-pointer border ${
                              m.is_featured
                                ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                                : 'bg-white/[0.04] text-white/40 border-white/10 hover:text-white'
                            }`}
                          >
                            {m.is_featured ? '★ Vitrinde' : 'Vitrinde Değil'}
                          </button>
                        </td>
                        <td className="py-3 text-right pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedMediaForEp(m);
                                setActiveTab('episodes');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-400/30 text-xs font-semibold cursor-pointer"
                            >
                              Bölümler
                            </button>
                            <button
                              onClick={() => {
                                setEditingSeries(m);
                                setSeriesModalOpen(true);
                              }}
                              className="p-1.5 rounded-xl bg-white/10 text-white/80 hover:text-white cursor-pointer"
                              title="Düzenle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSeries(m.id, m.title)}
                              className="p-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                              title="Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 4: BÖLÜMLER & KAYNAKLAR (EPISODES) ================= */}
      {activeTab === 'episodes' && (
        <div className="space-y-6">
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Tv className="w-5 h-5 text-sky-400" />
                  <span>Bölüm & Video Akış Kaynak Yönetimi</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  Bir dizi veya anime seçerek bölümlerini görüntüleyin, yeni bölüm ekleyin veya Vidmoly / DiziYou / Ok.ru akış linklerini yönetin.
                </p>
              </div>

              {selectedMediaForEp && (
                <button
                  onClick={() => {
                    setEditingEp({
                      media_id: selectedMediaForEp.id,
                      season_number: 1,
                      episode_number: (episodesList.length || 0) + 1,
                      status: 'published',
                    });
                    setEpModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-all cursor-pointer shadow-lg shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Yeni Bölüm Ekle</span>
                </button>
              )}
            </div>

            {/* Media Selector */}
            <div className="p-4 rounded-2xl bg-black/50 border border-white/10 flex flex-col sm:flex-row items-center gap-4">
              <div className="flex-1 w-full">
                <label className="block text-[11px] font-mono text-white/50 mb-1">
                  Yönetilecek Seriyi Seçin veya Arayın:
                </label>
                <input
                  type="text"
                  placeholder="Örn: Reply 1988, Queen of Tears, Solo Leveling..."
                  value={seriesSearchQuery}
                  onChange={(e) => setSeriesSearchQuery(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none"
                />
              </div>

              {seriesList.length > 0 && !selectedMediaForEp && (
                <div className="w-full sm:w-80">
                  <label className="block text-[11px] font-mono text-white/50 mb-1">
                    Arama Sonuçlarından Seç:
                  </label>
                  <select
                    onChange={(e) => {
                      const found = seriesList.find((m) => m.id === Number(e.target.value));
                      if (found) setSelectedMediaForEp(found);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-black border border-white/15 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value="">Seçiniz...</option>
                    {seriesList.slice(0, 15).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({m.country})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Selected Media Header */}
            {selectedMediaForEp ? (
              <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/15 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-16 rounded-xl overflow-hidden bg-black/60 border border-white/15 shrink-0">
                    {selectedMediaForEp.cover_image ? (
                      <img
                        src={selectedMediaForEp.cover_image}
                        alt={selectedMediaForEp.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Film className="w-6 h-6 text-white/30 m-auto mt-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {selectedMediaForEp.title}
                    </h3>
                    <div className="text-xs text-white/50 font-mono mt-0.5">
                      {episodesList.length} Bölüm Mevcut · {selectedMediaForEp.content_type}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedMediaForEp(null)}
                  className="text-xs text-white/50 hover:text-white cursor-pointer underline"
                >
                  Farklı Seri Seç
                </button>
              </div>
            ) : (
              <div className="py-16 text-center text-xs text-white/50">
                Lütfen bölümlerini ve kaynaklarını düzenlemek için yukarıdan bir seri seçin.
              </div>
            )}

            {/* Episodes & Sources List */}
            {selectedMediaForEp && (
              <div className="space-y-4">
                {epLoading ? (
                  <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Bölümler yükleniyor...</span>
                  </div>
                ) : episodesList.length === 0 ? (
                  <div className="py-16 text-center text-xs text-white/50">
                    Bu seri için henüz bölüm eklenmemiş. Yukarıdaki "Yeni Bölüm Ekle" butonuna basarak ilk bölümü oluşturabilirsiniz.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {episodesList.map((ep) => (
                      <div
                        key={`${ep.season_number}_${ep.episode_number}`}
                        className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="px-2.5 py-1 rounded-xl bg-white/10 text-white font-mono text-xs font-bold">
                              S{ep.season_number} : B{ep.episode_number}
                            </span>
                            <span className="text-xs font-bold text-white">
                              {ep.episode_name || `${ep.episode_number}. Bölüm`}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                ep.status === 'published'
                                  ? 'bg-emerald-400/20 text-emerald-300'
                                  : 'bg-amber-400/20 text-amber-300'
                              }`}
                            >
                              {ep.status === 'published' ? 'YAYINDA' : 'BEKLENİYOR'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedEpForSource(ep);
                                setNewSourceModalOpen(true);
                              }}
                              className="px-3 py-1 rounded-xl bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-bold border border-sky-400/30 cursor-pointer flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Kaynak Ekle</span>
                            </button>
                            <button
                              onClick={() => {
                                setEditingEp(ep);
                                setEpModalOpen(true);
                              }}
                              className="p-1.5 rounded-xl bg-white/10 text-white/80 hover:text-white cursor-pointer"
                              title="Bölümü Düzenle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Video Sources Sub-List */}
                        <div className="pt-2 border-t border-white/[0.06]">
                          <div className="text-[10px] font-mono text-white/45 uppercase mb-1.5">
                            Bağlı Video Akış Kaynakları ({(ep.video_sources || []).length} Kaynak):
                          </div>
                          {(ep.video_sources || []).length === 0 ? (
                            <div className="text-[11px] text-white/40 italic">
                              Henüz video kaynağı eklenmemiş. "Kaynak Ekle" butonunu kullanarak Vidmoly, DiziYou veya mp4 akış linki tanımlayın.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {ep.video_sources?.map((s, idx) => (
                                <div
                                  key={idx}
                                  className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-white truncate">
                                      {s.source_name || s.provider || 'Kaynak'}
                                    </div>
                                    <div className="text-[10px] font-mono text-white/40 truncate">
                                      {s.direct_url}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteSource(ep, idx)}
                                    className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 cursor-pointer shrink-0"
                                    title="Kaynağı Kaldır"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 5: YORUM DENETİMİ (COMMENTS) ================= */}
      {activeTab === 'comments' && (
        <div className="space-y-6">
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-sky-400" />
                  <span>Topluluk & Yorum Moderasyonu ({commentsList.length})</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  Kullanıcı yorumlarını denetleyin, spoiler etiketi ekleyin veya uygunsuz içerikleri kaldırın.
                </p>
              </div>
            </div>

            {commentsLoading ? (
              <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Yorumlar yükleniyor...</span>
              </div>
            ) : commentsList.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Henüz moderasyon bekleyen yorum bulunmuyor.
              </div>
            ) : (
              <div className="space-y-3">
                {commentsList.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">
                          @{c.profiles?.username || 'Kullanıcı'}
                        </span>
                        {c.media && (
                          <span className="px-2 py-0.5 rounded bg-white/10 text-white/70 text-[10px] font-mono">
                            {c.media.title}
                          </span>
                        )}
                        {c.has_spoiler && (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                            SPOILER
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-white/40">
                          {new Date(c.created_at).toLocaleDateString('tr-TR')}
                        </span>
                      </div>
                      <div className="text-xs text-white/75 leading-relaxed line-clamp-2">
                        {typeof c.content_json === 'string'
                          ? c.content_json
                          : c.content_json?.text || JSON.stringify(c.content_json)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggleSpoiler(c)}
                        className="px-3 py-1.5 rounded-xl bg-white/10 text-white/80 hover:text-white text-xs font-semibold cursor-pointer"
                      >
                        {c.has_spoiler ? 'Spoiler Kaldır' : 'Spoiler Yap'}
                      </button>
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-bold cursor-pointer"
                      >
                        Sil
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 6: SCRAPER BOTLARI & CRON ================= */}
      {activeTab === 'scrapers' && (
        <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Radio className="w-5 h-5 text-emerald-400" />
              <span>Otomatik Scraper Botları & Cron Saat Yönetimi</span>
            </h2>
            <p className="text-xs text-white/55 mt-0.5">
              GitHub Actions Cron + Cloudflare Edge Cron + 24 Saat Rolling Verification Watchdog
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scrapers.map((bot) => {
              const isRunning = runningScraperId === bot.id;
              return (
                <div
                  key={bot.id}
                  className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            bot.is_enabled ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        <h3 className="text-sm font-bold text-white">{bot.name}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleScraperActive(bot)}
                          className={`px-3 py-1 rounded-full text-[11px] font-mono font-semibold transition-all cursor-pointer border ${
                            bot.is_enabled
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border-rose-400/40 hover:bg-rose-500/30'
                          }`}
                        >
                          {bot.is_enabled ? 'Aktif' : 'Devre Dışı'}
                        </button>
                        <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-white/10 text-white/80">
                          {bot.items_synced.toLocaleString('tr-TR')} Senkron
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-white/55">{bot.notes}</p>
                  </div>

                  <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-white/50">Cron:</span>
                      <span className="px-2.5 py-1 rounded-lg bg-black/70 border border-white/15 text-xs font-mono text-amber-300">
                        {bot.cron_schedule}
                      </span>
                    </div>

                    <button
                      onClick={() => triggerScraperNow(bot.id, bot.name)}
                      disabled={isRunning}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`}
                      />
                      <span>{isRunning ? 'Taranıyor...' : 'Şimdi Tara'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= TAB 7: SORUN BİLDİRİMLERİ (REPORTS) ================= */}
      {activeTab === 'reports' && (
        <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-300" />
            <span>Bölüm & Seri Sorun Bildirimleri ({reports.length})</span>
          </h3>

          {reports.length === 0 ? (
            <div className="py-12 text-center text-xs text-white/50">
              Şu an bekleyen kırık bölüm bildirimi yok. Tüm kaynaklar sağlıklı!
            </div>
          ) : (
            <div className="space-y-2.5">
              {reports.map((rep) => (
                <div
                  key={rep.id}
                  className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <span className="px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 font-mono">
                        {rep.target_type.toUpperCase()} #{rep.media_id}
                      </span>
                      <span>{rep.issue_category}</span>
                    </div>
                    <p className="text-xs text-white/60 mt-1">{rep.details}</p>
                  </div>

                  {rep.status === 'resolved' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Çözüldü</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => resolveIssue(rep.id)}
                      className="px-3.5 py-1.5 rounded-full bg-emerald-400 text-black font-bold text-xs cursor-pointer"
                    >
                      Onar & Kapat
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 8: TOPLU BİLDİRİM (BROADCAST) ================= */}
      {activeTab === 'broadcast' && (
        <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6 max-w-2xl mx-auto">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-white/75" />
              <span>Tüm Kullanıcılara Sesli Bildirim Gönder</span>
            </h3>
            <p className="text-xs text-white/55 mt-1">
              Sitedeki tüm aktif üyelere Apple Glass Chime sesiyle canlı bildirim fırlatır.
            </p>
          </div>

          <form onSubmit={handleSendBroadcast} className="space-y-4">
            <div>
              <label className="block text-xs text-white/60 mb-1">Duyuru Başlığı</label>
              <input
                type="text"
                required
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="Örn: Reply 1988 Özel Bölüm Eklendi!"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Duyuru Mesajı</label>
              <textarea
                rows={4}
                required
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="1080p kesintisiz akışla hemen izleyebilirsiniz..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 rounded-full bg-white text-black font-bold text-xs cursor-pointer hover:bg-white/90 transition-all flex items-center justify-center gap-2"
            >
              <Volume2 className="w-4 h-4" />
              <span>Tüm Üyelere Sesli Bildirim Gönder</span>
            </button>
          </form>
        </div>
      )}

      {/* ================= MODAL: SERİ EKLE / DÜZENLE ================= */}
      <AnimatePresence>
        {seriesModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSeriesModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-2xl rounded-3xl bg-[#131317] border border-white/15 p-6 sm:p-8 shadow-2xl z-10 max-h-[90vh] overflow-y-auto my-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
                <h3 className="text-lg font-bold text-white">
                  {editingSeries?.id ? 'Seriyi Düzenle' : 'Yeni Seri & Medya Ekle'}
                </h3>
                <button
                  onClick={() => setSeriesModalOpen(false)}
                  className="p-1.5 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveSeries} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Türkçe Başlık *
                    </label>
                    <input
                      type="text"
                      required
                      value={editingSeries?.title || ''}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Orijinal Başlık
                    </label>
                    <input
                      type="text"
                      value={editingSeries?.native_title || ''}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, native_title: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      İçerik Türü
                    </label>
                    <select
                      value={editingSeries?.content_type || 'kdrama'}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, content_type: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white cursor-pointer"
                    >
                      <option value="kdrama">K-Drama (Kore)</option>
                      <option value="cdrama">C-Drama (Çin)</option>
                      <option value="anime">Anime</option>
                      <option value="movie">Film</option>
                      <option value="variety">TV Programı</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Ülke
                    </label>
                    <select
                      value={editingSeries?.country_code || 'KR'}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, country_code: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white cursor-pointer"
                    >
                      <option value="KR">Güney Kore (KR)</option>
                      <option value="CN">Çin (CN)</option>
                      <option value="JP">Japonya (JP)</option>
                      <option value="TH">Tayland (TH)</option>
                      <option value="TW">Tayvan (TW)</option>
                      <option value="US">ABD (US)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Yayın Yılı
                    </label>
                    <input
                      type="number"
                      value={editingSeries?.release_year || 2026}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({
                          ...prev,
                          release_year: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Özet / Sinopsis
                  </label>
                  <textarea
                    rows={3}
                    value={editingSeries?.overview || ''}
                    onChange={(e) =>
                      setEditingSeries((prev) => ({ ...prev, overview: e.target.value }))
                    }
                    className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Afiş URL (Poster)
                    </label>
                    <input
                      type="text"
                      placeholder="https://image.tmdb.org/..."
                      value={editingSeries?.cover_image || ''}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, cover_image: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Arka Plan URL (Backdrop)
                    </label>
                    <input
                      type="text"
                      placeholder="https://image.tmdb.org/..."
                      value={editingSeries?.backdrop_image || ''}
                      onChange={(e) =>
                        setEditingSeries((prev) => ({ ...prev, backdrop_image: e.target.value }))
                      }
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSeriesModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white/70 hover:text-white cursor-pointer"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: BÖLÜM EKLE / DÜZENLE ================= */}
      <AnimatePresence>
        {epModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEpModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-3xl bg-[#131317] border border-white/15 p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto my-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <h3 className="text-sm font-bold text-white">
                  {editingEp?.id ? 'Bölümü Düzenle' : 'Yeni Bölüm Ekle'}
                </h3>
                <button
                  onClick={() => setEpModalOpen(false)}
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEpisode} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Sezon No
                    </label>
                    <input
                      type="number"
                      required
                      value={editingEp?.season_number || 1}
                      onChange={(e) =>
                        setEditingEp((prev) => ({
                          ...prev,
                          season_number: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Bölüm No
                    </label>
                    <input
                      type="number"
                      required
                      value={editingEp?.episode_number || 1}
                      onChange={(e) =>
                        setEditingEp((prev) => ({
                          ...prev,
                          episode_number: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Bölüm Başlığı
                  </label>
                  <input
                    type="text"
                    value={editingEp?.episode_name || ''}
                    placeholder="Örn: 1. Bölüm"
                    onChange={(e) =>
                      setEditingEp((prev) => ({ ...prev, episode_name: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Yayın Durumu
                  </label>
                  <select
                    value={editingEp?.status || 'published'}
                    onChange={(e) =>
                      setEditingEp((prev) => ({ ...prev, status: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white cursor-pointer"
                  >
                    <option value="published">Yayında (İzlenebilir)</option>
                    <option value="scheduled">Bekleniyor (Geri Sayım Modu)</option>
                    <option value="broken">Kırık Kaynak (Onarım Kuyruğunda)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Çeviri / Takvim Notu
                  </label>
                  <input
                    type="text"
                    placeholder="Örn: Çeviri sürecindedir, gece yayına girecektir."
                    value={editingEp?.translation_note || ''}
                    onChange={(e) =>
                      setEditingEp((prev) => ({ ...prev, translation_note: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                  />
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEpModalOpen(false)}
                    className="px-3.5 py-1.5 text-xs text-white/70 hover:text-white cursor-pointer"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: KAYNAK EKLE ================= */}
      <AnimatePresence>
        {newSourceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNewSourceModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-3xl bg-[#131317] border border-white/15 p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto my-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <h3 className="text-sm font-bold text-white">
                  Bölüme Video Akış Kaynağı Ekle
                </h3>
                <button
                  onClick={() => setNewSourceModalOpen(false)}
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddSourceToEpisode} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Sağlayıcı / Kaynak Adı
                  </label>
                  <select
                    value={sourceProvider}
                    onChange={(e) => setSourceProvider(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white cursor-pointer"
                  >
                    <option value="Vidmoly">Vidmoly (1080p Embed)</option>
                    <option value="DiziYou">DiziYou (HLS .m3u8)</option>
                    <option value="Ok.ru">Ok.ru (Odnoklassniki)</option>
                    <option value="Sibnet">Sibnet</option>
                    <option value="Tau-Video">Tau-Video</option>
                    <option value="Mail.ru">Mail.ru</option>
                    <option value="GoogleDrive">Google Drive</option>
                    <option value="Direct-MP4">Doğrudan MP4</option>
                    <option value="DiziBox">DiziBox</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Doğrudan Akış URL'si / Embed Linki *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="https://vidmoly.biz/embed-... veya .m3u8"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Kalite Etiketi
                  </label>
                  <select
                    value={sourceQuality}
                    onChange={(e) => setSourceQuality(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white cursor-pointer"
                  >
                    <option value="1080p Native">1080p Native (HLS / MP4)</option>
                    <option value="720p Native">720p Native</option>
                    <option value="HD Embed">HD Embed (Buzlu Cam Dock)</option>
                    <option value="Alternatif">Alternatif Kaynak</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewSourceModalOpen(false)}
                    className="px-3.5 py-1.5 text-xs text-white/70 hover:text-white cursor-pointer"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer"
                  >
                    Kaynağı Bağla
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
