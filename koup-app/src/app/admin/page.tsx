'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Volume2,
  Star,
  ExternalLink,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Layers,
  X,
  LogIn,
  LogOut,
  KeyRound,
  User,
  Eye,
  EyeOff,
  ArrowLeft,
  Clock,
  Ban,
  Terminal,
  Activity,
  Sparkles,
  Play,
  Flame,
  Globe,
  Check,
} from 'lucide-react';
import { supabase, MediaItem, formatContentTypeTR, getProxiedImageUrl } from '@/lib/supabase';
import { invalidateCache } from '@/lib/cache';
import CountryFlag from '@/components/CountryFlag';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';
import { useKoUp } from '@/context/KoUpContext';
import { rankSearchResults } from '@/lib/searchRanking';

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
  email?: string | null;
  is_banned?: boolean;
  ban_type?: 'soft' | 'hard' | null;
  ban_reason?: string | null;
  ban_expires_at?: string | null;
  fingerprint_hash?: string | null;
  warning_count?: number;
}

interface AdminCommentRow {
  id: string | number;
  user_id?: string | null;
  target_type?: string | null;
  media_id?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  person_id?: number | null;
  magazine_id?: number | null;
  parent_id?: string | null;
  author_username?: string | null;
  author_avatar?: string | null;
  title?: string | null;
  content_html?: string | null;
  content_json?: any;
  has_spoiler: boolean;
  is_hidden?: boolean;
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
  intro_start_sec?: number | null;
  intro_end_sec?: number | null;
  video_sources?: any[];
}

const USER_ROLE_OPTIONS: SelectOption[] = [
  { value: 'user', label: 'Üye (User)' },
  { value: 'translator', label: 'Çevirmen (Translator)' },
  { value: 'editor', label: 'Editör (Editor)' },
  { value: 'moderator', label: 'Moderatör (Moderator)' },
  { value: 'banned', label: 'Askıya Al (Banned)' },
];

const CONTENT_TYPE_OPTIONS: SelectOption[] = [
  { value: 'dizi', label: 'Dizi' },
  { value: 'film', label: 'Film' },
  { value: 'anime', label: 'Anime' },
  { value: 'program', label: 'TV Programı' },
];

const COUNTRY_OPTIONS: SelectOption[] = [
  { value: 'KR', label: 'Güney Kore (KR)' },
  { value: 'JP', label: 'Japonya (JP)' },
  { value: 'CN', label: 'Çin (CN)' },
  { value: 'TH', label: 'Tayland (TH)' },
  { value: 'TW', label: 'Tayvan (TW)' },
  { value: 'US', label: 'ABD (US)' },
  { value: 'TR', label: 'Türkiye (TR)' },
];

const EPISODE_STATUS_OPTIONS: SelectOption[] = [
  { value: 'published', label: 'Yayında (İzlenebilir)' },
  { value: 'scheduled', label: 'Bekleniyor (Geri Sayım Modu)' },
  { value: 'broken', label: 'Kırık Kaynak (Onarım Kuyruğunda)' },
];

const SOURCE_PROVIDER_OPTIONS: SelectOption[] = [
  { value: 'Orijinal', label: 'Orijinal (1080p HLS / Native MP4)' },
  { value: 'Vidmoly', label: 'Vidmoly (1080p Embed)' },
  { value: 'YouTube', label: 'YouTube HD' },
  { value: 'DiziKorea', label: 'DiziKorea HLS' },
  { value: 'DiziBox', label: 'DiziBox DBX Pro' },
  { value: 'DDizi', label: 'DDizi HLS' },
  { value: 'Tau-Video', label: 'Tau-Video (AnimeciX)' },
  { value: 'Sibnet', label: 'Sibnet' },
  { value: 'Direct-MP4', label: 'Doğrudan MP4' },
];

const SOURCE_QUALITY_OPTIONS: SelectOption[] = [
  { value: '1080p Native', label: '1080p Native (HLS / MP4)' },
  { value: '720p Native', label: '720p Native' },
  { value: 'HD Embed', label: 'HD Embed (Buzlu Cam Dock)' },
  { value: 'Alternatif', label: 'Alternatif Kaynak' },
];

function slugifyTR(text: string): string {
  const trMap: Record<string, string> = {
    ç: 'c', Ç: 'c',
    ğ: 'g', Ğ: 'g',
    ı: 'i', I: 'i', İ: 'i',
    ö: 'o', Ö: 'o',
    ş: 's', Ş: 's',
    ü: 'u', Ü: 'u',
  };
  return text
    .split('')
    .map((c) => trMap[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getCommentDisplayText(c: AdminCommentRow): string {
  if (c.content_html) {
    const stripped = c.content_html
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (stripped) return stripped;
  }
  if (typeof c.content_json === 'string' && c.content_json.trim()) {
    return c.content_json.trim();
  }
  if (c.content_json?.text) {
    return String(c.content_json.text);
  }
  if (c.title) {
    return c.title;
  }
  return '(İçerik belirtilmemiş)';
}

function PaginationControls({
  currentPage,
  totalCount,
  pageSize,
  onPageChange,
  loading,
}: {
  currentPage: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  loading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalCount <= pageSize && currentPage === 1) return null;

  const startItem = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalCount, currentPage * pageSize);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      if (!pages.includes(totalPages)) pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10 text-xs text-white/60">
      <div className="font-mono text-[11px]">
        Toplam <span className="text-white font-bold">{totalCount.toLocaleString('tr-TR')}</span> kayıttan{' '}
        <span className="text-white font-bold">{startItem}</span> - <span className="text-white font-bold">{endItem}</span> arası gösteriliyor (Sayfa {currentPage} / {totalPages})
      </div>
      <div className="flex items-center gap-1.5 select-none">
        <button
          type="button"
          disabled={currentPage <= 1 || loading}
          onClick={() => onPageChange(currentPage - 1)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:pointer-events-none text-white font-semibold transition-all cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Önceki</span>
        </button>
        {getPageNumbers().map((p, idx) =>
          typeof p === 'number' ? (
            <button
              key={idx}
              type="button"
              disabled={loading}
              onClick={() => onPageChange(p)}
              className={`min-w-[32px] h-8 px-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
                p === currentPage
                  ? 'bg-white text-black font-bold shadow-md'
                  : 'bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white border border-white/10'
              }`}
            >
              {p}
            </button>
          ) : (
            <span key={idx} className="px-1 text-white/40 font-mono">
              ...
            </span>
          )
        )}
        <button
          type="button"
          disabled={currentPage >= totalPages || loading}
          onClick={() => onPageChange(currentPage + 1)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/10 border border-white/10 disabled:opacity-30 disabled:pointer-events-none text-white font-semibold transition-all cursor-pointer"
        >
          <span>Sonraki</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

const SCRAPER_BRAND_INFO: Record<
  string,
  {
    logoText: string;
    domain: string;
    tag: string;
    bgGradient: string;
    borderGlow: string;
    textColor: string;
    category: string;
    protocol: string;
  }
> = {
  ddizi: {
    logoText: 'DDizi',
    domain: 'https://ddizi.tel',
    tag: 'Yerli & Klasik HD',
    bgGradient: 'from-blue-600/25 via-indigo-700/20 to-blue-950/40',
    borderGlow: 'border-blue-500/40 group-hover:border-blue-400/80',
    textColor: 'text-blue-300',
    category: 'Yerli Dizi & Klasik HD (1000+ Seri)',
    protocol: 'Doğrudan .m3u8 HLS + YouTube HD Resmi Akış',
  },
  animecix: {
    logoText: 'AnimeciX',
    domain: 'https://animecix.net',
    tag: 'Tau-Video',
    bgGradient: 'from-purple-500/25 via-indigo-600/20 to-purple-950/40',
    borderGlow: 'border-purple-500/40 group-hover:border-purple-400/80',
    textColor: 'text-purple-300',
    category: 'Alternatif Anime Arşivi',
    protocol: 'Tau-Video & Sibnet Doğrudan MP4 / HLS',
  },
  dizibox: {
    logoText: 'DiziBox',
    domain: 'https://www.dizibox.live',
    tag: 'DBX Pro 1080p',
    bgGradient: 'from-amber-500/25 via-orange-600/20 to-amber-950/40',
    borderGlow: 'border-amber-500/40 group-hover:border-amber-400/80',
    textColor: 'text-amber-300',
    category: 'Global & Batı Sineması',
    protocol: 'king.php DBX Pro MolyStream 1080p HLS Çözücü',
  },
  dizikorea: {
    logoText: 'DiziKorea',
    domain: 'https://dizikorea3.com',
    tag: '1080p HLS',
    bgGradient: 'from-emerald-500/25 via-teal-600/20 to-emerald-950/40',
    borderGlow: 'border-emerald-500/40 group-hover:border-emerald-400/80',
    textColor: 'text-emerald-300',
    category: 'K-Drama (Güney Kore & Asya)',
    protocol: 'playerdkorea.xyz Doğrudan HLS + Vidmoly Çözücü',
  },
  hdfilm: {
    logoText: 'HDFilm',
    domain: 'https://www.hdfilmcehennemi.nl',
    tag: '1080p Dual HLS',
    bgGradient: 'from-rose-600/25 via-red-700/20 to-rose-950/40',
    borderGlow: 'border-rose-500/40 group-hover:border-rose-400/80',
    textColor: 'text-rose-300',
    category: 'Sinema & Yabancı Dizi',
    protocol: 'Close Dual HLS (Türkçe Dublaj) + Rapidrame HLS (Altyazılı)',
  },
  asyawatch: {
    logoText: 'AsyaWatch',
    domain: 'https://asyawatch.com',
    tag: '1080p HLS Asya',
    bgGradient: 'from-pink-600/25 via-rose-700/20 to-pink-950/40',
    borderGlow: 'border-pink-500/40 group-hover:border-pink-400/80',
    textColor: 'text-pink-300',
    category: 'K-Drama & Asya (2100+ Dizi)',
    protocol: 'four.pichive.online 1080p Yerel HLS Çözücü',
  },
  dizilla: {
    logoText: 'Dizilla',
    domain: 'https://dizilla.now',
    tag: 'AES-256 Global & Anime',
    bgGradient: 'from-amber-600/25 via-red-700/20 to-amber-950/40',
    borderGlow: 'border-amber-500/40 group-hover:border-amber-400/80',
    textColor: 'text-amber-300',
    category: 'Global & Anime (8900+ Dizi)',
    protocol: 'AES-256 CBC Decrypt + 1080p HLS Çözücü',
  },
};

function ScraperLogoBadge({ siteKey, name }: { siteKey: string; name: string }) {
  const brand = SCRAPER_BRAND_INFO[siteKey];
  const text = brand?.logoText || name.slice(0, 8);
  const bg = brand?.bgGradient || 'from-sky-500/25 via-blue-600/20 to-sky-950/40';
  const border = brand?.borderGlow || 'border-white/20';
  const color = brand?.textColor || 'text-white';

  return (
    <div
      className={`px-3 py-1.5 rounded-2xl bg-gradient-to-br ${bg} border ${border} flex items-center gap-2 shadow-lg shrink-0 transition-all`}
    >
      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
      <span className={`text-[11px] font-black tracking-wider uppercase font-mono ${color}`}>
        {text}
      </span>
    </div>
  );
}

export default function AdminDashboardPage() {
  const {
    user,
    authLoading: isGlobalAuthLoading,
    setIsAuthModalOpen,
    pushNotification,
    loginWithEmail,
    logout,
    confirmDialog,
  } = useKoUp();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Moderation Modal State (for Warning, Soft Ban, Hard Ban)
  const [modModalOpen, setModModalOpen] = useState(false);
  const [modTargetUser, setModTargetUser] = useState<UserProfileRow | null>(null);
  const [modActionType, setModActionType] = useState<'warn' | 'soft_ban' | 'hard_ban'>('warn');
  const [modReason, setModReason] = useState('');
  const [modDuration, setModDuration] = useState<'24h' | '3d' | '7d' | '30d' | 'permanent'>('permanent');
  const [modSubmitting, setModSubmitting] = useState(false);

  // Live Stats
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
  const [vitrinSearch, setVitrinSearch] = useState('');
  const [vitrinSearchResults, setVitrinSearchResults] = useState<MediaItem[]>([]);
  const [isSearchingVitrin, setIsSearchingVitrin] = useState(false);
  const [runningScraperId, setRunningScraperId] = useState<string | null>(null);

  // Dedicated Scraper Operations & Live Detail State
  const [selectedScraperId, setSelectedScraperId] = useState<string | null>(null);
  const [scraperDetailData, setScraperDetailData] = useState<any | null>(null);
  const [isLoadingScraperDetail, setIsLoadingScraperDetail] = useState(false);
  const [liveTerminalLogs, setLiveTerminalLogs] = useState<string[]>([]);
  const [singleSeriesQuery, setSingleSeriesQuery] = useState('');


  // Broadcast
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);

  // Users Tab State (Server-Side Paginated)
  const [usersList, setUsersList] = useState<UserProfileRow[]>([]);
  const [userSearchInput, setUserSearchInput] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');
  const [usersPage, setUsersPage] = useState(1);
  const [usersTotalCount, setUsersTotalCount] = useState(0);
  const [promoteEmailInput, setPromoteEmailInput] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  // Series Tab State (Server-Side Paginated)
  const [seriesList, setSeriesList] = useState<MediaItem[]>([]);
  const [seriesSearchInput, setSeriesSearchInput] = useState('');
  const [debouncedSeriesSearch, setDebouncedSeriesSearch] = useState('');
  const [seriesTypeFilter, setSeriesTypeFilter] = useState('ALL');
  const [seriesCountryFilter, setSeriesCountryFilter] = useState('ALL');
  const [seriesPage, setSeriesPage] = useState(1);
  const [seriesTotalCount, setSeriesTotalCount] = useState(0);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [editingSeries, setEditingSeries] = useState<Partial<MediaItem> | null>(null);

  // Episodes Tab State
  const [selectedMediaForEp, setSelectedMediaForEp] = useState<MediaItem | null>(null);
  const [epMediaSearchInput, setEpMediaSearchInput] = useState('');
  const [debouncedEpMediaSearch, setDebouncedEpMediaSearch] = useState('');
  const [epMediaSearchResults, setEpMediaSearchResults] = useState<MediaItem[]>([]);
  const [epMediaSearchLoading, setEpMediaSearchLoading] = useState(false);
  const [episodesList, setEpisodesList] = useState<AdminEpisodeItem[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [epModalOpen, setEpModalOpen] = useState(false);
  const [editingEp, setEditingEp] = useState<Partial<AdminEpisodeItem> | null>(null);
  const [newSourceModalOpen, setNewSourceModalOpen] = useState(false);
  const [selectedEpForSource, setSelectedEpForSource] = useState<AdminEpisodeItem | null>(null);
  const [sourceProvider, setSourceProvider] = useState('Vidmoly');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceQuality, setSourceQuality] = useState('1080p Native');

  // Bulk Intro Skip State
  const [bulkIntroModalOpen, setBulkIntroModalOpen] = useState(false);
  const [bulkIntroTargetSeason, setBulkIntroTargetSeason] = useState<string>('all');
  const [bulkIntroStart, setBulkIntroStart] = useState<string>('');
  const [bulkIntroEnd, setBulkIntroEnd] = useState<string>('');
  const [bulkIntroClear, setBulkIntroClear] = useState<boolean>(false);
  const [bulkIntroSaving, setBulkIntroSaving] = useState<boolean>(false);

  // Comments Tab State (Server-Side Paginated)
  const [commentsList, setCommentsList] = useState<AdminCommentRow[]>([]);
  const [commentSearchInput, setCommentSearchInput] = useState('');
  const [debouncedCommentSearch, setDebouncedCommentSearch] = useState('');
  const [commentFilter, setCommentFilter] = useState<'ALL' | 'spoiler' | 'hidden'>('ALL');
  const [commentsPage, setCommentsPage] = useState(1);
  const [commentsTotalCount, setCommentsTotalCount] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Strictly check role from database/session
  const isAdmin = user?.role === 'admin';
  const isModerator = user?.role === 'moderator' || user?.role === 'mod';
  const hasAdminPanelAccess = isAdmin || isModerator;

  // Auto-redirect moderator to users or comments if they land on an admin-only tab
  useEffect(() => {
    if (!isAdmin && isModerator) {
      if (activeTab !== 'users' && activeTab !== 'comments') {
        setActiveTab('users');
      }
    }
  }, [isAdmin, isModerator, activeTab]);

  // 300ms Debouncing for Series Search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSeriesSearch(seriesSearchInput.trim());
      setSeriesPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [seriesSearchInput]);

  // 300ms Debouncing for User Search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedUserSearch(userSearchInput.trim());
      setUsersPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [userSearchInput]);

  // 300ms Debouncing for Comment Search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedCommentSearch(commentSearchInput.trim());
      setCommentsPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [commentSearchInput]);

  // 300ms Debouncing for Episode Media Search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedEpMediaSearch(epMediaSearchInput.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [epMediaSearchInput]);

  // Load Initial Admin Data & Exact Database Counts
  useEffect(() => {
    if (!hasAdminPanelAccess) return;

    async function loadInitial() {
      try {
        const [mCountRes, uCountRes, cCountRes, rCountRes, sRes, rRes, fRes] = await Promise.all([
          supabase.from('media').select('id', { count: 'exact', head: true }),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('comments').select('id', { count: 'exact', head: true }),
          supabase.from('issue_reports').select('id', { count: 'exact', head: true }).neq('status', 'resolved'),
          supabase.from('scraper_configs').select('*').order('id'),
          supabase.from('issue_reports').select('*').order('created_at', { ascending: false }).limit(40),
          supabase.from('media').select('*').eq('is_featured', true).order('featured_order', { ascending: true }).limit(16),
        ]);

        const ACTIVE_SCRAPER_IDS = new Set([
          'ddizi',
          'animecix',
          'dizibox',
          'dizikorea',
          'hdfilm',
          'asyawatch',
          'dizilla',
        ]);
        const filteredScrapers = ((sRes.data as ScraperConfigRow[]) || []).filter((bot) =>
          ACTIVE_SCRAPER_IDS.has(bot.id)
        );
        setScrapers(filteredScrapers);
        setReports((rRes.data as IssueReportRow[]) || []);
        setFeaturedMedia((fRes.data as MediaItem[]) || []);
        setStats({
          totalMedia: mCountRes.count ?? 17559,
          totalPeople: 21814,
          totalEpisodes: 2515,
          totalUsers: uCountRes.count ?? 0,
          totalComments: cCountRes.count ?? 0,
          openReports: rCountRes.count ?? 0,
        });
      } catch (err) {
        console.error('Admin initial load error:', err);
      }
    }
    loadInitial();
  }, [hasAdminPanelAccess]);

  // Load Users Tab (Server-Side Paginated with 50 items/page)
  useEffect(() => {
    if (!hasAdminPanelAccess || activeTab !== 'users') return;
    async function loadUsers() {
      setUserLoading(true);
      try {
        const PAGE_SIZE = 50;
        const from = (usersPage - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let q = supabase
          .from('profiles')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);

        if (debouncedUserSearch) {
          q = q.or(
            `username.ilike.%${debouncedUserSearch}%,display_name.ilike.%${debouncedUserSearch}%,email.ilike.%${debouncedUserSearch}%`
          );
        }

        if (userRoleFilter === 'banned') {
          q = q.eq('is_banned', true);
        } else if (userRoleFilter !== 'ALL') {
          q = q.eq('role', userRoleFilter);
        }

        const { data, count, error } = await q;
        if (error) throw error;

        setUsersList((data as UserProfileRow[]) || []);
        if (typeof count === 'number') {
          setUsersTotalCount(count);
          setStats((prev) => ({ ...prev, totalUsers: count }));
        }
      } catch (err: any) {
        pushNotification('Kullanıcılar Yüklenemedi', err.message || 'Veritabanı hatası.', 'info');
      } finally {
        setUserLoading(false);
      }
    }
    loadUsers();
  }, [hasAdminPanelAccess, activeTab, usersPage, debouncedUserSearch, userRoleFilter, pushNotification]);

  // Load Series Tab (Server-Side Paginated with 50 items/page)
  useEffect(() => {
    if (!isAdmin || activeTab !== 'series') return;
    async function loadSeries() {
      setSeriesLoading(true);
      try {
        const PAGE_SIZE = 50;
        const from = (seriesPage - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const searchQuery = debouncedSeriesSearch.trim();

        if (searchQuery) {
          let q = supabase
            .from('media')
            .select('*', { count: 'exact' })
            .or(
              `title.ilike.%${searchQuery}%,slug.ilike.%${searchQuery}%,native_title.ilike.%${searchQuery}%`
            );

          if (seriesTypeFilter !== 'ALL') {
            q = q.eq('content_type', seriesTypeFilter);
          }
          if (seriesCountryFilter !== 'ALL') {
            q = q.eq('country_code', seriesCountryFilter);
          }

          // Fetch matching results and rank by accuracy/relevance
          const { data, count, error } = await q.limit(100);
          if (error) throw error;

          const ranked = rankSearchResults((data as MediaItem[]) || [], searchQuery);
          setSeriesList(ranked.slice(from, to + 1));
          if (typeof count === 'number') {
            setSeriesTotalCount(count);
          }
        } else {
          let q = supabase
            .from('media')
            .select('*', { count: 'exact' })
            .order('id', { ascending: false })
            .range(from, to);

          if (seriesTypeFilter !== 'ALL') {
            q = q.eq('content_type', seriesTypeFilter);
          }
          if (seriesCountryFilter !== 'ALL') {
            q = q.eq('country_code', seriesCountryFilter);
          }

          const { data, count, error } = await q;
          if (error) throw error;

          setSeriesList((data as MediaItem[]) || []);
          if (typeof count === 'number') {
            setSeriesTotalCount(count);
            setStats((prev) => ({ ...prev, totalMedia: count }));
          }
        }
      } catch (err: any) {
        pushNotification('Seriler Yüklenemedi', err.message || 'Veritabanı hatası.', 'info');
      } finally {
        setSeriesLoading(false);
      }
    }
    loadSeries();
  }, [
    isAdmin,
    activeTab,
    seriesPage,
    debouncedSeriesSearch,
    seriesTypeFilter,
    seriesCountryFilter,
    pushNotification,
  ]);

  // Load Episodes Tab Media Search
  useEffect(() => {
    if (!isAdmin || activeTab !== 'episodes') return;
    if (!debouncedEpMediaSearch) {
      (async () => {
        const { data } = await supabase
          .from('media')
          .select('*')
          .order('id', { ascending: false })
          .limit(20);
        setEpMediaSearchResults((data as MediaItem[]) || []);
      })();
      return;
    }
    async function searchEpMedia() {
      setEpMediaSearchLoading(true);
      try {
        const term = debouncedEpMediaSearch.trim();
        const { data } = await supabase
          .from('media')
          .select('*')
          .or(`title.ilike.%${term}%,slug.ilike.%${term}%,native_title.ilike.%${term}%`)
          .limit(40);
        const ranked = rankSearchResults((data as MediaItem[]) || [], term);
        setEpMediaSearchResults(ranked.slice(0, 25));
      } finally {
        setEpMediaSearchLoading(false);
      }
    }
    searchEpMedia();
  }, [isAdmin, activeTab, debouncedEpMediaSearch]);

  // Load Episodes when a series is selected
  useEffect(() => {
    if (!isAdmin || !selectedMediaForEp) return;
    async function loadEpisodes() {
      setEpLoading(true);
      try {
        const { data: supaEps, error } = await supabase
          .from('episodes')
          .select('*')
          .eq('media_id', selectedMediaForEp!.id)
          .order('season_number', { ascending: true })
          .order('episode_number', { ascending: true });

        if (error) throw error;

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
                  if (ae.intro_start_sec != null && exist.intro_start_sec == null) {
                    exist.intro_start_sec = ae.intro_start_sec;
                  }
                  if (ae.intro_end_sec != null && exist.intro_end_sec == null) {
                    exist.intro_end_sec = ae.intro_end_sec;
                  }
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
                    intro_start_sec: ae.intro_start_sec || null,
                    intro_end_sec: ae.intro_end_sec || null,
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
      } catch (err: any) {
        pushNotification('Bölümler Yüklenemedi', err.message || 'Veritabanı hatası.', 'info');
      } finally {
        setEpLoading(false);
      }
    }
    loadEpisodes();
  }, [isAdmin, selectedMediaForEp, pushNotification]);

  // Load Comments Tab (Server-Side Paginated with 50 items/page)
  useEffect(() => {
    if (!hasAdminPanelAccess || activeTab !== 'comments') return;
    async function loadComments() {
      setCommentsLoading(true);
      try {
        const PAGE_SIZE = 50;
        const from = (commentsPage - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let queryData: any = null;
        let queryCount: number | null = null;

        try {
          let q = supabase
            .from('comments')
            .select('*, profiles:user_id(username, display_name, avatar_url, role), media:media_id(title, slug)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);

          if (debouncedCommentSearch) {
            q = q.or(
              `title.ilike.%${debouncedCommentSearch}%,content_html.ilike.%${debouncedCommentSearch}%,author_username.ilike.%${debouncedCommentSearch}%`
            );
          }

          if (commentFilter === 'spoiler') {
            q = q.eq('has_spoiler', true);
          }

          if (commentFilter === 'hidden') {
            q = q.eq('is_hidden', true);
          }

          const res = await q;
          if (res.error) throw res.error;
          queryData = res.data;
          queryCount = res.count;
        } catch (joinedErr) {
          console.warn('Joined comments query fallback triggered:', joinedErr);
          let fallbackQ = supabase
            .from('comments')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);

          if (debouncedCommentSearch) {
            fallbackQ = fallbackQ.or(
              `title.ilike.%${debouncedCommentSearch}%,content_html.ilike.%${debouncedCommentSearch}%,author_username.ilike.%${debouncedCommentSearch}%`
            );
          }

          if (commentFilter === 'spoiler') {
            fallbackQ = fallbackQ.eq('has_spoiler', true);
          }

          if (commentFilter === 'hidden') {
            fallbackQ = fallbackQ.eq('is_hidden', true);
          }

          const fallbackRes = await fallbackQ;
          if (fallbackRes.error) throw fallbackRes.error;
          queryData = fallbackRes.data || [];
          queryCount = fallbackRes.count;

          // Hydrate media titles
          const mediaIds = Array.from(new Set(queryData.map((c: any) => c.media_id).filter(Boolean)));
          if (mediaIds.length > 0) {
            const { data: mediaRows } = await supabase
              .from('media')
              .select('id, title, slug')
              .in('id', mediaIds);
            const mediaMap = new Map((mediaRows || []).map((m: any) => [m.id, m]));
            queryData = queryData.map((c: any) => ({
              ...c,
              media: c.media_id ? mediaMap.get(c.media_id) || null : null,
            }));
          }
        }

        setCommentsList((queryData as AdminCommentRow[]) || []);
        if (typeof queryCount === 'number') {
          setCommentsTotalCount(queryCount);
          setStats((prev) => ({ ...prev, totalComments: queryCount! }));
        }
      } catch (err: any) {
        console.error('loadComments error:', err);
        pushNotification('Yorumlar Yüklenemedi', err.message || 'Veritabanı hatası.', 'info');
      } finally {
        setCommentsLoading(false);
      }
    }
    loadComments();
  }, [hasAdminPanelAccess, activeTab, commentsPage, debouncedCommentSearch, commentFilter, pushNotification]);

  // Open Dedicated Scraper Operations Page
  const openScraperDetail = async (scraperId: string) => {
    setSelectedScraperId(scraperId);
    setIsLoadingScraperDetail(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s?.session?.access_token;
      const resp = await fetch(`/api/admin/scraper?scraperId=${scraperId}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        setScraperDetailData(data);
        if (data.logs && Array.isArray(data.logs)) {
          setLiveTerminalLogs(data.logs);
        }
      }
    } catch (err: any) {
      pushNotification('Hata', 'Scraper detayları alınamadı.', 'info');
    } finally {
      setIsLoadingScraperDetail(false);
    }
  };

  // Scraper Actions with Live Logs Stream
  const triggerScraperNow = async (scraperId: string, name: string, targetSeries?: string) => {
    // Automatically open the dedicated operations page so user sees live logs and items immediately
    setSelectedScraperId(scraperId);
    setRunningScraperId(scraperId);

    // If detail data isn't loaded yet, fetch base details in background
    if (!scraperDetailData || scraperDetailData.scraper?.id !== scraperId) {
      supabase.auth
        .getSession()
        .then(({ data: s }) => {
          const token = s?.session?.access_token;
          return fetch(`/api/admin/scraper?scraperId=${scraperId}`, {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
        })
        .then((r) => r.json())
        .then((d) => {
          if (d.scraper) setScraperDetailData(d);
        })
        .catch(() => {});
    }

    const nowTime = new Date().toTimeString().split(' ')[0];
    if (targetSeries) {
      setLiveTerminalLogs((prev) => [
        ...prev,
        `[${nowTime}] [HEDEF DİZİ BAŞLATILDI] ${name} botu üzerinden "${targetSeries}" aranıyor...`,
        `[${nowTime}] [BAĞLANTI] API & Kaynak sunucuya bağlantı açılıyor...`,
      ]);
    } else {
      setLiveTerminalLogs((prev) => [
        ...prev,
        `[${nowTime}] [BAŞLATILDI] ${name} için canlı genel tarama başlatılıyor...`,
        `[${nowTime}] [BAĞLANTI] API & Kaynak sunucuya bağlantı açılıyor...`,
      ]);
    }

    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s?.session?.access_token;
      const resp = await fetch('/api/admin/scraper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ scraperId, targetSeries }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        setLiveTerminalLogs((prev) => [
          ...prev,
          `[${nowTime}] [HATA] Sunucu yanıtı: ${errData?.error || 'Bilinmeyen hata'}`,
        ]);
        pushNotification('Scraper Uyarısı', errData?.error || 'Tarama yanıt vermedi.', 'info');
        return;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: any = null;

        const handleMessage = (lineStr: string) => {
          const trimmed = lineStr.trim();
          if (!trimmed) return;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'log' && msg.line) {
              setLiveTerminalLogs((prev) => [...prev, msg.line]);
            } else if (msg.type === 'item' && msg.item) {
              setScraperDetailData((prev: any) => {
                const existing = prev?.recentItems || [];
                const deduped = [
                  msg.item,
                  ...existing.filter((x: any) => x.id !== msg.item.id),
                ].slice(0, 20);
                return {
                  ...(prev || {}),
                  recentItems: deduped,
                };
              });
            } else if (msg.type === 'result') {
              finalResult = msg;
            } else if (msg.type === 'error') {
              setLiveTerminalLogs((prev) => [
                ...prev,
                `[${nowTime}] [HATA] ${msg.error || 'Tarama hatası'}`,
              ]);
            }
          } catch (_) {}
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            handleMessage(line);
          }
        }
        if (buffer.trim()) {
          handleMessage(buffer);
        }

        if (finalResult && finalResult.ok) {
          setScrapers((prev) =>
            prev.map((s) =>
              s.id === scraperId
                ? {
                    ...s,
                    items_synced: finalResult.newTotal,
                    last_run_at: finalResult.timestamp,
                    last_status: 'healthy',
                  }
                : s
            )
          );

          setScraperDetailData((prev: any) => {
            const existing = prev?.recentItems || [];
            const incoming = Array.isArray(finalResult.newlySyncedItems)
              ? finalResult.newlySyncedItems
              : [];
            const merged = [...incoming];
            for (const ex of existing) {
              if (!merged.some((m: any) => m.id === ex.id)) {
                merged.push(ex);
              }
            }
            return {
              ...(prev || {}),
              recentItems: merged.slice(0, 20),
              scraper: {
                ...(prev?.scraper || {}),
                items_synced: finalResult.newTotal,
                last_run_at: finalResult.timestamp,
              },
            };
          });

          pushNotification(
            'Tarama Başarıyla Tamamlandı',
            `${name}: +${finalResult.syncedDelta} yeni/güncel kayıt işlendi. Toplam: ${finalResult.newTotal.toLocaleString('tr-TR')}`,
            'success'
          );
        }
      } else {
        const data = await resp.json();
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

        if (data.logs && Array.isArray(data.logs)) {
          setLiveTerminalLogs((prev) => [...prev, ...data.logs]);
        }

        if (data.newlySyncedItems && Array.isArray(data.newlySyncedItems)) {
          setScraperDetailData((prev: any) => {
            const existing = prev?.recentItems || [];
            return {
              ...(prev || {}),
              recentItems: [...data.newlySyncedItems, ...existing].slice(0, 20),
              scraper: {
                ...(prev?.scraper || {}),
                items_synced: data.newTotal,
                last_run_at: data.timestamp,
              },
            };
          });
        }

        pushNotification(
          'Tarama Başarıyla Tamamlandı',
          `${name}: +${data.syncedDelta} yeni/güncel kayıt işlendi. Toplam: ${data.newTotal.toLocaleString('tr-TR')}`,
          'success'
        );
      }
    } catch (err: any) {
      setLiveTerminalLogs((prev) => [
        ...prev,
        `[${nowTime}] [BAĞLANTI HATASI] ${err.message || 'Scraper sunucusuna ulaşılamadı'}`,
      ]);
      pushNotification('Bağlantı Hatası', err.message || 'Scraper sunucusuna ulaşılamadı.', 'info');
    } finally {
      setRunningScraperId(null);
    }
  };

  const toggleScraperActive = async (bot: ScraperConfigRow) => {
    const nextState = !bot.is_enabled;
    setScrapers((prev) =>
      prev.map((s) => (s.id === bot.id ? { ...s, is_enabled: nextState } : s))
    );
    try {
      const { error } = await supabase.rpc('toggle_scraper_enabled', {
        p_site_key: bot.id,
        p_enabled: nextState,
      });
      if (error) throw error;
      pushNotification(
        'Scraper Durumu Güncellendi',
        `${bot.name} ${nextState ? 'Aktif Edildi' : 'Devre Dışı Bırakıldı'}.`,
        nextState ? 'success' : 'info'
      );
    } catch (err: any) {
      setScrapers((prev) =>
        prev.map((s) => (s.id === bot.id ? { ...s, is_enabled: !nextState } : s))
      );
      pushNotification('Scraper Hatası', err.message || 'Durum değiştirilemedi.', 'info');
    }
  };

  // Broadcast Action (System Announcements)
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return;
    setBroadcastSending(true);
    try {
      const bTitle = broadcastTitle.trim();
      const bBody = broadcastBody.trim();

      // 1. Record broadcast event in database
      const { error } = await supabase.from('broadcast_events').insert({
        target_type: 'global',
        title: bTitle,
        message: bBody,
        link_url: '/',
      });
      if (error) throw error;

      // 2. Distribute official system notification to all user inboxes
      const { data: allProfiles } = await supabase.from('profiles').select('id');
      if (allProfiles && allProfiles.length > 0) {
        const notifRows = allProfiles.map((p) => ({
          user_id: p.id,
          type: 'system',
          title: bTitle,
          body: bBody,
          link_url: '/',
          is_read: false,
        }));
        // Chunk into 100 rows per batch
        for (let i = 0; i < notifRows.length; i += 100) {
          await supabase.from('user_notifications').insert(notifRows.slice(i, i + 100));
        }
      }

      setBroadcastTitle('');
      setBroadcastBody('');
      pushNotification('Duyuru Yayınlandı', 'Tüm aktif kullanıcılara sistem duyurusu iletildi.', 'success');
    } catch (err: any) {
      pushNotification('Duyuru Hatası', err.message || 'Bildirim iletilemedi.', 'info');
    } finally {
      setBroadcastSending(false);
    }
  };

  // Moderation Handlers (Warn, Soft Ban, Hard Ban, Unban, Toggle Mod)
  const handleOpenModerationModal = (target: UserProfileRow, action: 'warn' | 'soft_ban' | 'hard_ban') => {
    setModTargetUser(target);
    setModActionType(action);
    setModReason(
      action === 'warn'
        ? 'Topluluk kurallarını ihlal eden yorum / davranış.'
        : action === 'soft_ban'
        ? 'Spam veya rahatsız edici içerik paylaşımı.'
        : 'Ciddi kural ihlali / zararlı davranış.'
    );
    setModDuration(action === 'soft_ban' ? '7d' : 'permanent');
    setModModalOpen(true);
  };

  const handleExecuteModeration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modTargetUser || modSubmitting) return;
    setModSubmitting(true);

    try {
      if (modActionType === 'warn') {
        const { error } = await supabase.rpc('admin_warn_user', {
          target_user_id: modTargetUser.id,
          p_reason: modReason.trim() || 'Topluluk kuralları ihlali',
        });
        if (error) throw error;

        setUsersList((prev) =>
          prev.map((u) =>
            u.id === modTargetUser.id ? { ...u, warning_count: (u.warning_count || 0) + 1 } : u
          )
        );
        pushNotification(
          'Uyarı Gönderildi',
          `@${modTargetUser.username} kullanıcısına resmi topluluk uyarısı iletildi.`,
          'success'
        );
      } else if (modActionType === 'soft_ban' || modActionType === 'hard_ban') {
        if (modActionType === 'hard_ban' && !isAdmin) {
          throw new Error('Yalnızca sistem yöneticileri (Admin) Hard Ban uygulayabilir.');
        }

        let expiresAt: string | null = null;
        if (modActionType === 'soft_ban' && modDuration !== 'permanent') {
          const now = new Date();
          if (modDuration === '24h') now.setHours(now.getHours() + 24);
          else if (modDuration === '3d') now.setDate(now.getDate() + 3);
          else if (modDuration === '7d') now.setDate(now.getDate() + 7);
          else if (modDuration === '30d') now.setDate(now.getDate() + 30);
          expiresAt = now.toISOString();
        }

        const banType = modActionType === 'soft_ban' ? 'soft' : 'hard';
        const { error } = await supabase.rpc('admin_ban_user', {
          target_user_id: modTargetUser.id,
          p_ban_type: banType,
          p_reason: modReason.trim() || (banType === 'hard' ? 'Kalıcı Cihaz Engelleme' : 'Geçici Askıya Alma'),
          p_expires_at: expiresAt,
          p_fingerprint: modTargetUser.fingerprint_hash || null,
        });
        if (error) throw error;

        setUsersList((prev) =>
          prev.map((u) =>
            u.id === modTargetUser.id
              ? {
                  ...u,
                  is_banned: true,
                  ban_type: banType,
                  ban_reason: modReason.trim(),
                  ban_expires_at: expiresAt,
                }
              : u
          )
        );
        pushNotification(
          banType === 'hard' ? 'Hard Ban Uygulandı' : 'Hafif Ban Uygulandı',
          `@${modTargetUser.username} kullanıcısı ${banType === 'hard' ? 'cihaz düzeyinde kalıcı olarak engellendi' : 'askıya alındı'}.`,
          'success'
        );
      }
      setModModalOpen(false);
      setModTargetUser(null);
    } catch (err: any) {
      pushNotification('Moderasyon Hatası', err.message || 'İşlem gerçekleştirilemedi.', 'info');
    } finally {
      setModSubmitting(false);
    }
  };

  const handleUnbanUser = async (target: UserProfileRow) => {
    const ok = await confirmDialog({
      title: 'Yasağı Kaldır',
      message: `@${target.username} kullanıcısının banını ve kısıtlamalarını kaldırmak istediğinize emin misiniz?`,
      confirmText: 'Yasağı Kaldır',
      cancelText: 'Vazgeç',
      isDestructive: false,
      icon: 'help',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.rpc('admin_unban_user', {
        p_target_user_id: target.id,
      });
      if (error) throw error;

      setUsersList((prev) =>
        prev.map((u) =>
          u.id === target.id
            ? { ...u, is_banned: false, ban_type: null, ban_reason: null, ban_expires_at: null }
            : u
        )
      );
      pushNotification(
        'Yasak Kaldırıldı',
        `@${target.username} kullanıcısının askıya alma ve cihaz engeli kaldırıldı.`,
        'success'
      );
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Yasak kaldırılamadı.', 'info');
    }
  };

  const handleToggleModRole = async (target: UserProfileRow) => {
    if (!isAdmin) {
      pushNotification('Yetkisiz İşlem', 'Yalnızca Admin yetkisi olanlar Moderatör atayabilir.', 'info');
      return;
    }
    const isCurrentlyMod = target.role === 'moderator' || target.role === 'mod';
    const actionDesc = isCurrentlyMod ? 'moderatörlük yetkisini geri almak' : 'moderatör yapmak';
    const ok = await confirmDialog({
      title: 'Yetki Değişikliği',
      message: `@${target.username} kullanıcısını ${actionDesc} istediğinize emin misiniz?`,
      confirmText: 'Onayla',
      cancelText: 'Vazgeç',
      isDestructive: false,
      icon: 'help',
    });
    if (!ok) return;

    try {
      const { data, error } = await supabase.rpc('admin_toggle_mod_role', {
        target_user_id: target.id,
      });
      if (error) throw error;

      const newRole = data || (isCurrentlyMod ? 'user' : 'moderator');
      setUsersList((prev) =>
        prev.map((u) => (u.id === target.id ? { ...u, role: newRole } : u))
      );
      pushNotification(
        'Yetki Güncellendi',
        `@${target.username} artık ${newRole === 'moderator' ? 'Moderatör' : 'Üye'}.`,
        'success'
      );
    } catch (err: any) {
      pushNotification('Yetki Hatası', err.message || 'Moderatör rolü değiştirilemedi.', 'info');
    }
  };

  // User Role Management - Strict RPC ONLY, No direct fallback (Admin only)
  const handleSetUserRole = async (targetId: string, newRole: string) => {
    if (!isAdmin) {
      pushNotification('Yetkisiz İşlem', 'Yalnızca sistem yöneticileri (Admin) rol atayabilir.', 'info');
      return;
    }
    try {
      const { error } = await supabase.rpc('admin_set_user_role', {
        target_user_id: targetId,
        new_role: newRole,
      });
      if (error) throw error;
      setUsersList((prev) =>
        prev.map((u) => (u.id === targetId ? { ...u, role: newRole } : u))
      );
      pushNotification('Rol Güncellendi', `Kullanıcı yetkisi ${newRole.toUpperCase()} olarak ayarlandı.`, 'success');
    } catch (err: any) {
      pushNotification('Yetki Hatası', err.message || 'Yetki güncellenemedi. RLS kısıtlaması.', 'info');
    }
  };

  const handlePromoteAdminByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoteEmailInput.trim()) return;
    try {
      const { error } = await supabase.rpc('grant_admin_by_email', {
        target_email: promoteEmailInput.trim(),
      });
      if (error) throw error;
      pushNotification('Admin Yetkisi Verildi', `${promoteEmailInput} başarıyla yönetici yapıldı.`, 'success');
      setPromoteEmailInput('');
      setUsersPage(1);
      const PAGE_SIZE = 50;
      const { data, count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1);
      setUsersList((data as UserProfileRow[]) || []);
      if (typeof count === 'number') {
        setUsersTotalCount(count);
        setStats((prev) => ({ ...prev, totalUsers: count }));
      }
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
    try {
      const { error } = await supabase
        .from('media')
        .update({ is_featured: nextVal, featured_order: nextVal ? 1 : 99 })
        .eq('id', media.id);
      if (error) throw error;
      const { data: fRes } = await supabase
        .from('media')
        .select('*')
        .eq('is_featured', true)
        .order('featured_order', { ascending: true })
        .limit(16);
      setFeaturedMedia((fRes as MediaItem[]) || []);
      invalidateCache('media_');
      invalidateCache('home_');
    } catch (err: any) {
      setSeriesList((prev) =>
        prev.map((m) => (m.id === media.id ? { ...m, is_featured: !nextVal } : m))
      );
      pushNotification('Vitrin Hatası', err.message || 'Güncellenemedi.', 'info');
    }
  };

  // Vitrin (Hero Slider) Search Debouncer
  useEffect(() => {
    if (!vitrinSearch.trim()) {
      setVitrinSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setIsSearchingVitrin(true);
      try {
        const query = vitrinSearch.trim();
        const { data } = await supabase
          .from('media')
          .select('*')
          .or(`title.ilike.%${query}%,slug.ilike.%${query}%`)
          .limit(30);
        const ranked = rankSearchResults((data as MediaItem[]) || [], query);
        setVitrinSearchResults(ranked.slice(0, 8));
      } catch {
        setVitrinSearchResults([]);
      } finally {
        setIsSearchingVitrin(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [vitrinSearch]);

  const handleAddFeatured = async (media: MediaItem) => {
    if (featuredMedia.some((m) => m.id === media.id)) {
      pushNotification('Zaten Vitrinde', `${media.title} zaten vitrinde bulunuyor.`, 'info');
      return;
    }
    const newOrder = featuredMedia.length + 1;
    try {
      await supabase
        .from('media')
        .update({ is_featured: true, featured_order: newOrder })
        .eq('id', media.id);

      const { data: fRes } = await supabase
        .from('media')
        .select('*')
        .eq('is_featured', true)
        .order('featured_order', { ascending: true })
        .limit(16);

      setFeaturedMedia((fRes as MediaItem[]) || []);
      setSeriesList((prev) =>
        prev.map((m) => (m.id === media.id ? { ...m, is_featured: true, featured_order: newOrder } : m))
      );
      setVitrinSearch('');
      setVitrinSearchResults([]);
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Vitrine Eklendi', `${media.title} ana sayfa vitrinine eklendi.`, 'success');
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Vitrine eklenemedi.', 'info');
    }
  };

  const handleMoveFeatured = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= featuredMedia.length) return;

    const newFeatured = [...featuredMedia];
    const [moved] = newFeatured.splice(index, 1);
    newFeatured.splice(targetIndex, 0, moved);

    setFeaturedMedia(newFeatured);

    // Update featured_order in DB for all items
    try {
      const updates = newFeatured.map((item, idx) =>
        supabase.from('media').update({ featured_order: idx + 1 }).eq('id', item.id)
      );
      await Promise.all(updates);
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Sıralama Güncellendi', 'Vitrin sırası başarıyla kaydedildi.', 'success');
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Sıralama güncellenemedi.', 'info');
    }
  };

  const handleSaveSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSeries || !editingSeries.title) return;
    try {
      if (editingSeries.id) {
        const { error } = await supabase
          .from('media')
          .update(editingSeries)
          .eq('id', editingSeries.id);
        if (error) throw error;
        setSeriesList((prev) =>
          prev.map((m) => (m.id === editingSeries.id ? ({ ...m, ...editingSeries } as MediaItem) : m))
        );
        invalidateCache('media_');
        invalidateCache('home_');
        pushNotification('Seri Güncellendi', `"${editingSeries.title}" başarıyla kaydedildi.`, 'success');
      } else {
        const slug =
          editingSeries.slug ||
          slugifyTR(editingSeries.title);
        const newRecord = {
          ...editingSeries,
          slug,
          country_code: editingSeries.country_code || 'KR',
          content_type: editingSeries.content_type || 'dizi',
          status_broadcast: editingSeries.status_broadcast || 'Final',
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
        if (data) {
          setSeriesList((prev) => [data as MediaItem, ...prev.slice(0, 49)]);
          setSeriesTotalCount((prev) => prev + 1);
          setStats((prev) => ({ ...prev, totalMedia: prev.totalMedia + 1 }));
        }
        invalidateCache('media_');
        invalidateCache('home_');
        pushNotification('Yeni Seri Eklendi', `"${editingSeries.title}" kataloğa eklendi.`, 'success');
      }
      setSeriesModalOpen(false);
      setEditingSeries(null);
    } catch (err: any) {
      pushNotification('Kayıt Hatası', err.message, 'info');
    }
  };

  const handleDeleteSeries = async (mediaId: number, title: string) => {
    if (!isAdmin) {
      pushNotification('Yetkisiz İşlem', 'Yalnızca sistem yöneticileri (Admin) seri silebilir.', 'info');
      return;
    }
    const ok = await confirmDialog({
      title: 'Seriyi Sil',
      message: `"${title}" serisini ve tüm bağlı verilerini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
      confirmText: 'Kalıcı Olarak Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('media').delete().eq('id', mediaId);
      if (error) throw error;
      setSeriesList((prev) => prev.filter((m) => m.id !== mediaId));
      setSeriesTotalCount((prev) => Math.max(0, prev - 1));
      setStats((prev) => ({ ...prev, totalMedia: Math.max(0, prev.totalMedia - 1) }));
      invalidateCache('media_');
      invalidateCache('home_');
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
        intro_start_sec:
          editingEp.intro_start_sec != null && !Number.isNaN(Number(editingEp.intro_start_sec))
            ? Number(editingEp.intro_start_sec)
            : null,
        intro_end_sec:
          editingEp.intro_end_sec != null && !Number.isNaN(Number(editingEp.intro_end_sec))
            ? Number(editingEp.intro_end_sec)
            : null,
        video_sources: editingEp.video_sources || [],
      };

      if (editingEp.id && editingEp.id < 10000000) {
        const { error } = await supabase.from('episodes').update(payload).eq('id', editingEp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('episodes').upsert(payload, {
          onConflict: 'media_id,season_number,episode_number',
        });
        if (error) throw error;
      }

      setEpisodesList((prev) => {
        const key = `${payload.season_number}_${payload.episode_number}`;
        const idx = prev.findIndex((ep) => `${ep.season_number}_${ep.episode_number}` === key);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...payload };
          return next;
        }
        return [...prev, payload as AdminEpisodeItem];
      });

      setEpModalOpen(false);
      setEditingEp(null);
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Bölüm Kaydedildi', `${payload.season_number}. Sezon ${payload.episode_number}. Bölüm güncellendi.`, 'success');
    } catch (err: any) {
      pushNotification('Bölüm Kayıt Hatası', err.message, 'info');
    }
  };

  const handleDeleteEpisode = async (ep: AdminEpisodeItem) => {
    const ok = await confirmDialog({
      title: 'Bölümü Sil',
      message: `${ep.season_number}. Sezon ${ep.episode_number}. Bölümü silmek istediğinize emin misiniz?`,
      confirmText: 'Bölümü Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      if (ep.id && ep.id < 10000000) {
        const { error } = await supabase.from('episodes').delete().eq('id', ep.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('episodes')
          .delete()
          .eq('media_id', ep.media_id)
          .eq('season_number', ep.season_number)
          .eq('episode_number', ep.episode_number);
        if (error) throw error;
      }
      setEpisodesList((prev) =>
        prev.filter(
          (e) => !(e.season_number === ep.season_number && e.episode_number === ep.episode_number)
        )
      );
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Bölüm Silindi', `${ep.season_number}. Sezon ${ep.episode_number}. Bölüm kaldırıldı.`, 'info');
    } catch (err: any) {
      pushNotification('Bölüm Silinemedi', err.message || 'Veritabanı hatası.', 'info');
    }
  };

  const handleBulkSaveIntro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMediaForEp) return;
    setBulkIntroSaving(true);
    try {
      const parseTimeInput = (val: string): number | null => {
        const trimmed = val.trim();
        if (!trimmed) return null;
        if (trimmed.includes(':')) {
          const parts = trimmed.split(':');
          const m = Number(parts[0]) || 0;
          const s = Number(parts[1]) || 0;
          return m * 60 + s;
        }
        const n = Number(trimmed);
        return Number.isNaN(n) ? null : n;
      };

      const startSec = bulkIntroClear ? null : parseTimeInput(bulkIntroStart);
      const endSec = bulkIntroClear ? null : parseTimeInput(bulkIntroEnd);

      if (!bulkIntroClear) {
        if (startSec == null || endSec == null) {
          pushNotification('Eksik Bilgi', 'Lütfen geçerli bir başlangıç ve bitiş süresi girin (örn: 90 sn veya 01:30).', 'info');
          setBulkIntroSaving(false);
          return;
        }
        if (endSec <= startSec) {
          pushNotification('Geçersiz Süre', 'İntro bitiş süresi başlangıç süresinden büyük olmalıdır.', 'info');
          setBulkIntroSaving(false);
          return;
        }
      }

      const targetEps = episodesList.filter(
        (ep) => bulkIntroTargetSeason === 'all' || ep.season_number === Number(bulkIntroTargetSeason)
      );

      if (targetEps.length === 0) {
        pushNotification('Bölüm Bulunamadı', 'Seçilen kapsamda işlem yapılacak bölüm bulunamadı.', 'info');
        setBulkIntroSaving(false);
        return;
      }

      const rows = targetEps.map((ep) => ({
        media_id: selectedMediaForEp.id,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
        episode_name: ep.episode_name || `${ep.episode_number}. Bölüm`,
        episode_type: ep.episode_type || 'bolum',
        status: ep.status || 'published',
        intro_start_sec: startSec,
        intro_end_sec: endSec,
        video_sources: ep.video_sources || [],
      }));

      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const { error } = await supabase.from('episodes').upsert(chunk, {
          onConflict: 'media_id,season_number,episode_number',
        });
        if (error) throw error;
      }

      setEpisodesList((prev) =>
        prev.map((ep) => {
          if (bulkIntroTargetSeason === 'all' || ep.season_number === Number(bulkIntroTargetSeason)) {
            return { ...ep, intro_start_sec: startSec, intro_end_sec: endSec };
          }
          return ep;
        })
      );

      try {
        invalidateCache(`episodes_${selectedMediaForEp.id}`);
        invalidateCache('media_');
      } catch {}

      setBulkIntroModalOpen(false);
      pushNotification(
        'Toplu İntro Kaydedildi',
        `${targetEps.length} bölüme intro atlama ayarı uygulandı (${bulkIntroTargetSeason === 'all' ? 'Tüm Seri' : `${bulkIntroTargetSeason}. Sezon`}).`,
        'success'
      );
    } catch (err: any) {
      console.error('Bulk intro save error:', err);
      pushNotification('Kayıt Başarısız', err.message || 'Toplu intro güncellenemedi.', 'info');
    } finally {
      setBulkIntroSaving(false);
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

      const { error } = await supabase.from('episodes').upsert(
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
      if (error) throw error;

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
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Kaynak Eklendi', `${sourceProvider} akış kaynağı bölüme bağlandı.`, 'success');
    } catch (err: any) {
      pushNotification('Kaynak Hatası', err.message, 'info');
    }
  };

  const handleDeleteSource = async (ep: AdminEpisodeItem, sourceIndex: number) => {
    const ok = await confirmDialog({
      title: 'Video Kaynağını Kaldır',
      message: 'Bu video kaynağını kaldırmak istediğinize emin misiniz?',
      confirmText: 'Kaynağı Kaldır',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    try {
      const filtered = (ep.video_sources || []).filter((_, i) => i !== sourceIndex);
      const { error } = await supabase.from('episodes').upsert(
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
      if (error) throw error;

      setEpisodesList((prev) =>
        prev.map((e) =>
          e.season_number === ep.season_number && e.episode_number === ep.episode_number
            ? { ...e, video_sources: filtered }
            : e
        )
      );
      invalidateCache('media_');
      invalidateCache('home_');
      pushNotification('Kaynak Kaldırıldı', 'Video akış kaynağı temizlendi.', 'info');
    } catch (err: any) {
      pushNotification('Kaynak Silinemedi', err.message, 'info');
    }
  };

  // Comment Moderation Actions with Optimistic Updates & Rollback
  const handleDeleteComment = async (commentId: string | number) => {
    const ok = await confirmDialog({
      title: 'Yorumu Sil',
      message: 'Bu yorumu kalıcı olarak silmek istediğinize emin misiniz?',
      confirmText: 'Yorumu Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!ok) return;
    const prevList = [...commentsList];
    const prevCount = commentsTotalCount;

    // Optimistic remove
    setCommentsList((prev) => prev.filter((c) => String(c.id) !== String(commentId)));
    setCommentsTotalCount((prev) => Math.max(0, prev - 1));
    setStats((prev) => ({ ...prev, totalComments: Math.max(0, prev.totalComments - 1) }));

    try {
      const { error } = await supabase.from('comments').delete().eq('id', commentId);
      if (error) throw error;
      pushNotification('Yorum Silindi', 'Topluluk yorumu moderasyon tarafından kalıcı olarak silindi.', 'success');
    } catch (err: any) {
      // Rollback on error
      setCommentsList(prevList);
      setCommentsTotalCount(prevCount);
      setStats((prev) => ({ ...prev, totalComments: prevCount }));
      pushNotification('Silme Hatası', err.message || 'Yorum silinemedi.', 'info');
    }
  };

  const handleToggleSpoiler = async (comment: AdminCommentRow) => {
    const nextVal = !comment.has_spoiler;
    const prevList = [...commentsList];

    // Optimistic update
    setCommentsList((prev) =>
      prev.map((c) => (String(c.id) === String(comment.id) ? { ...c, has_spoiler: nextVal } : c))
    );

    try {
      const { error } = await supabase
        .from('comments')
        .update({ has_spoiler: nextVal })
        .eq('id', comment.id);
      if (error) throw error;
      pushNotification(
        'Spoiler Durumu Değişti',
        nextVal ? 'Yorum spoiler maskesiyle kapatıldı.' : 'Spoiler maskesi kaldırıldı.',
        'success'
      );
    } catch (err: any) {
      setCommentsList(prevList);
      pushNotification('Güncelleme Hatası', err.message || 'Spoiler durumu güncellenemedi.', 'info');
    }
  };

  const handleToggleHide = async (comment: AdminCommentRow) => {
    const nextHidden = !comment.is_hidden;
    const prevList = [...commentsList];

    // Optimistic update
    setCommentsList((prev) =>
      prev.map((c) =>
        String(c.id) === String(comment.id) ? { ...c, is_hidden: nextHidden } : c
      )
    );

    try {
      const { error } = await supabase
        .from('comments')
        .update({ is_hidden: nextHidden })
        .eq('id', comment.id);
      if (error) throw error;
      pushNotification(
        nextHidden ? 'Yorum Gizlendi' : 'Yorum Onaylandı',
        nextHidden ? 'Yorum diğer kullanıcılardan gizlendi.' : 'Yorum tekrar görünür yapıldı.',
        'success'
      );
    } catch (err: any) {
      setCommentsList(prevList);
      pushNotification('Moderasyon Hatası', err.message || 'Yorum gizleme/onaylama başarısız oldu.', 'info');
    }
  };

  // Issue Reports
  const resolveIssue = async (reportId: number) => {
    try {
      const { error } = await supabase
        .from('issue_reports')
        .update({ status: 'resolved' })
        .eq('id', reportId);
      if (error) throw error;

      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, status: 'resolved' } : r))
      );
      setStats((s) => ({ ...s, openReports: Math.max(0, s.openReports - 1) }));
      pushNotification(
        'Sorun Çözüldü İşaretlendi',
        `Bildirim #${reportId} onarıldı ve kapatıldı.`,
        'success'
      );
    } catch (err: any) {
      pushNotification('Hata', err.message || 'Sorun güncellenemedi.', 'info');
    }
  };

  // Loading state while auth is hydrating from Supabase
  if (isGlobalAuthLoading) {
    return (
      <div className="w-full min-h-[calc(100vh-8rem)] pt-32 pb-24 flex flex-col items-center justify-center space-y-4 text-center">
        <RefreshCw className="w-8 h-8 text-amber-300 animate-spin" />
        <div className="text-sm text-white/60 font-mono tracking-wider">
          Yetkiler doğrulanıyor...
        </div>
      </div>
    );
  }

  // UNAUTHORIZED / SECURITY GATE (Apple/Netflix High-Security 403 Gate)
  if (!hasAdminPanelAccess) {
    return (
      <div className="w-full min-h-[calc(100vh-8rem)] pt-24 sm:pt-32 pb-24 max-w-2xl mx-auto px-4 sm:px-6 text-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-rose-500/15 border border-rose-500/30 text-rose-400 mx-auto flex items-center justify-center shadow-[0_0_36px_rgba(244,63,94,0.35)]">
          <ShieldAlert className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            403 · Yetkisiz Erişim
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            Bu alana yalnızca sistem yöneticileri ve yetkili moderatörler erişebilir. Ziyaretçiler ve standart üyeler için yönetim paneli tamamen izoledir.
          </p>
        </div>

        {/* Security & RLS Notice Card */}
        <div className="p-6 rounded-3xl apple-glass border border-white/10 space-y-4 text-left">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-xs text-white/75 leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">
                Güvenlik & Rol Denetimi (PostgreSQL RLS)
              </strong>
              Kullanıcı rolleri ve veri erişim yetkileri veritabanı düzeyinde katı RLS politikaları ile korunur; yönetim paneli yetkisiz çağrılardan tamamen izoledir.
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-white/75 leading-relaxed">
              <strong className="text-white block font-semibold mb-0.5">
                Yetkili Hesap Girişi Gerekir
              </strong>
              Yönetici veya moderatör yetkisine sahip bir hesap ile giriş yapılması durumunda yönetim paneli otomatik olarak aktifleşecektir.
            </div>
          </div>
        </div>

        {/* If user is already logged in with a non-admin/non-mod role */}
        {user && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left">
            <div>
              <div className="text-xs font-bold text-amber-300">
                Giriş Yapılmış Hesap: @{user.username}
              </div>
              <div className="text-[11px] text-white/60 mt-0.5">
                Mevcut Rol:{' '}
                <span className="font-mono font-bold text-white uppercase">
                  {user.role || 'user'}
                </span>{' '}
                · Bu hesap yönetim paneline erişim yetkisine sahip değildir.
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Çıkış Yap</span>
            </button>
          </div>
        )}

        {/* Actions: Ana Sayfaya Dön & (if logged in) Çıkış Yap */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-white text-black font-bold text-sm hover:bg-white/90 cursor-pointer shadow-2xl transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Ana Sayfaya Dön</span>
          </Link>
          {user && (
            <button
              onClick={() => logout()}
              className="w-full sm:w-auto px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium text-sm border border-white/10 cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Çıkış Yap</span>
            </button>
          )}
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
            <span>{isAdmin ? 'KoUp Master Yönetim & Denetim Merkezi · RLS Aktif' : 'KoUp Moderasyon Merkezi · RLS Aktif'}</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            {isAdmin ? 'Sistem Yönetim Paneli' : 'Moderatör Denetim Paneli'}
          </h1>
          <p className="text-xs sm:text-sm text-white/65 max-w-3xl leading-relaxed">
            {isAdmin
              ? 'Kullanıcıları, 17.500+ yapımlık arşivi, bölümleri ve video akış linklerini, yorum moderasyonunu, otomatik scraper cron botlarını ve acil durum sorun bildirimlerini tek merkezden yönetin.'
              : 'Kullanıcı topluluk hesaplarını, yorum moderasyonunu ve şikayetleri güvenle denetleyin.'}
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
              {stats.totalUsers.toLocaleString('tr-TR')} Üye
            </div>
            <div className="text-[10px] text-white/45">Supabase Auth</div>
          </div>
          <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10">
            <div className="text-[10px] font-mono text-sky-400">YORUMLAR</div>
            <div className="text-lg font-mono font-bold text-white mt-0.5">
              {stats.totalComments.toLocaleString('tr-TR')} Adet
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

      {/* 2. TAB NAVIGATION BAR */}
      <div className="sticky top-20 z-40 p-1.5 rounded-2xl glass-pill-dark border border-white/10 shadow-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar overscroll-x-contain touch-pan-x touch-pan-y">
        {[
          { id: 'overview', label: 'Genel Bakış', icon: Layers, adminOnly: true },
          { id: 'users', label: 'Kullanıcılar', icon: Users, badge: stats.totalUsers },
          { id: 'series', label: 'Seri & Medya', icon: Film, badge: stats.totalMedia, adminOnly: true },
          { id: 'episodes', label: 'Bölümler & Kaynaklar', icon: Tv, adminOnly: true },
          { id: 'comments', label: 'Yorum Moderasyonu', icon: MessageSquare, badge: stats.totalComments },
          { id: 'scrapers', label: 'Scraper Botları & Cron', icon: Radio, adminOnly: true },
          { id: 'reports', label: 'Sorun Bildirimleri', icon: AlertTriangle, badge: stats.openReports, adminOnly: true },
          { id: 'broadcast', label: 'Toplu Bildirim', icon: Send, adminOnly: true },
        ]
          .filter((tab) => !tab.adminOnly || isAdmin)
          .map((tab) => {
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
                  {tab.badge.toLocaleString('tr-TR')}
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
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer transition-all"
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
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer transition-all"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span>Yeni Dizi / Anime Ekle</span>
                  </span>
                  <span className="text-white/40 font-mono">+</span>
                </button>
                <button
                  onClick={() => setActiveTab('episodes')}
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-xs text-white cursor-pointer transition-all"
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
                className="w-full py-2.5 rounded-xl bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-bold hover:bg-amber-400/30 cursor-pointer transition-colors"
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
                DiziKorea, DiziBox, DDizi, AnimeciX ve HDFilmcehennemi canlı botları devrede.
              </p>
              <div className="p-4 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                <span className="text-xs text-white/70">Aktif Scraperlar:</span>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {scrapers.filter((s) => s.is_enabled).length} / {scrapers.length} Aktif
                </span>
              </div>
              <button
                onClick={() => setActiveTab('scrapers')}
                className="w-full py-2.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer transition-colors"
              >
                Scraper Kontrol Merkezine Git
              </button>
            </div>
          </div>

          {/* Featured Vitrin Slider Section */}
          <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-5 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-amber-400">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span>Ana Sayfa Açılış Vitrini</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-white mt-1">
                  Ana Sayfa Hero Slider Vitrini ({featuredMedia.length} Yapım)
                </h3>
                <p className="text-xs text-white/60 mt-0.5">
                  Ana sayfanın en üstünde yer alan 4&apos;lü slider ve &quot;Sıradaki Vitrin Seçkisi&quot; rayında buradaki yapımlar listelenir.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('series')}
                className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold cursor-pointer shrink-0"
              >
                <span>Tüm Kataloğu Gör</span>
                <span>→</span>
              </button>
            </div>

            {/* Quick Add Search Bar for Vitrin */}
            <div className="relative">
              <div className="flex items-center gap-2 bg-black/40 border border-white/15 rounded-2xl px-4 py-2.5 focus-within:border-amber-400/50 transition-all">
                <Search className="w-4 h-4 text-white/40 shrink-0" />
                <input
                  type="text"
                  value={vitrinSearch}
                  onChange={(e) => setVitrinSearch(e.target.value)}
                  placeholder="Vitrine eklemek istediğin yapımın adını yaz (Örn: Reply 1988, Goblin, Vincenzo...)"
                  className="w-full bg-transparent text-white text-xs placeholder:text-white/35 focus:outline-none"
                />
                {isSearchingVitrin && (
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                )}
                {vitrinSearch && (
                  <button
                    onClick={() => {
                      setVitrinSearch('');
                      setVitrinSearchResults([]);
                    }}
                    className="text-white/40 hover:text-white text-xs cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search Results Dropdown */}
              {vitrinSearchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[#0e0e14] border border-white/20 rounded-2xl p-2 shadow-2xl max-h-72 overflow-y-auto space-y-1.5 custom-scrollbar backdrop-blur-xl">
                  {vitrinSearchResults.map((m) => {
                    const isAlready = featuredMedia.some((fm) => fm.id === m.id);
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={getProxiedImageUrl(m.cover_image || m.backdrop_image, m.title)}
                            alt={m.title}
                            className="w-10 h-14 object-cover rounded-lg shrink-0 border border-white/10"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">{m.title}</div>
                            <div className="text-[10px] text-white/50 flex items-center gap-2 mt-0.5">
                              <span>{m.release_year || '—'}</span>
                              <span>•</span>
                              <span>{formatContentTypeTR(m.content_type, m.country_code)}</span>
                              {m.mdl_rating && (
                                <>
                                  <span>•</span>
                                  <span className="text-amber-400 font-mono">MDL {m.mdl_rating}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          disabled={isAlready}
                          onClick={() => handleAddFeatured(m)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer ${
                            isAlready
                              ? 'bg-white/10 text-white/40 cursor-not-allowed'
                              : 'bg-amber-400 hover:bg-amber-300 text-black shadow-md'
                          }`}
                        >
                          {isAlready ? 'Vitrinde Var' : '+ Vitrine Ekle'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Featured Items Grid with Thumbnails & Reordering */}
            {featuredMedia.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center text-xs text-white/50">
                Henüz vitrine yapım eklenmedi. Yukarıdaki arama kutusundan dizi veya film arayarak ilk 4 sırayı belirleyebilirsiniz.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {featuredMedia.map((m, i) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-amber-400/40 transition-all relative flex flex-col justify-between group shadow-lg"
                  >
                    <div>
                      {/* Media Thumbnail */}
                      <div className="relative w-full h-28 rounded-xl overflow-hidden mb-2.5 border border-white/10">
                        <img
                          src={getProxiedImageUrl(m.backdrop_image || m.cover_image, m.title)}
                          alt={m.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                        <div className="absolute top-2 left-2">
                          <span className="px-2 py-0.5 rounded-full bg-amber-400 text-black font-mono text-[10px] font-black shadow-md">
                            #{i + 1} {i < 4 ? '• VİTRİN' : ''}
                          </span>
                        </div>
                        {m.mdl_rating && (
                          <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] font-mono text-amber-300 bg-black/60 px-1.5 py-0.5 rounded-md backdrop-blur-md">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            <span>{m.mdl_rating}</span>
                          </div>
                        )}
                      </div>

                      <div className="text-xs font-bold text-white truncate">
                        {m.title}
                      </div>
                      <div className="text-[10px] text-white/50 flex items-center gap-1.5 mt-0.5">
                        <span>{m.release_year || '—'}</span>
                        <span>•</span>
                        <span>{formatContentTypeTR(m.content_type, m.country_code)}</span>
                      </div>
                    </div>

                    {/* Controls: Reorder Left/Right & Remove */}
                    <div className="flex items-center justify-between gap-1.5 pt-3 mt-3 border-t border-white/[0.08]">
                      <div className="flex items-center gap-1">
                        <button
                          disabled={i === 0}
                          onClick={() => handleMoveFeatured(i, 'up')}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                            i === 0
                              ? 'bg-white/5 text-white/20 cursor-not-allowed'
                              : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                          aria-label="Öne Taşı"
                        >
                          ←
                        </button>
                        <button
                          disabled={i === featuredMedia.length - 1}
                          onClick={() => handleMoveFeatured(i, 'down')}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                            i === featuredMedia.length - 1
                              ? 'bg-white/5 text-white/20 cursor-not-allowed'
                              : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                          aria-label="Sonraya Taşı"
                        >
                          →
                        </button>
                      </div>

                      <button
                        onClick={() => handleToggleFeatured(m)}
                        className="flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200 cursor-pointer px-2 py-1 rounded-lg hover:bg-rose-500/10 transition-colors"
                        aria-label="Vitrinden Kaldır"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Kaldır</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  <span>Kullanıcı & Üye Yönetimi ({usersTotalCount.toLocaleString('tr-TR')})</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  Kullanıcı rollerini güncelleyin (Moderatör, Çevirmen, Üye), hesapları denetleyin veya askıya alın.
                </p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Kullanıcı adı, isim veya e-posta ile ara..."
                  value={userSearchInput}
                  onChange={(e) => setUserSearchInput(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                />
                {userSearchInput && (
                  <button
                    type="button"
                    onClick={() => setUserSearchInput('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
                {['ALL', 'admin', 'moderator', 'translator', 'editor', 'user', 'banned'].map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setUserRoleFilter(r);
                      setUsersPage(1);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                      userRoleFilter === r
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {r === 'banned' ? 'YASAKLI (BAN)' : r.toUpperCase()}
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
            ) : usersList.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Kayıtlı kullanıcı bulunamadı.
              </div>
            ) : (
              <div className="overflow-x-auto min-h-[380px]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-white/50 font-mono uppercase tracking-wider">
                      <th className="pb-3 pl-3">Kullanıcı</th>
                      <th className="pb-3">Kayıt Tarihi</th>
                      <th className="pb-3">İzleme</th>
                      <th className="pb-3">Durum & Roller</th>
                      <th className="pb-3">İşlemler & Moderasyon</th>
                      {isAdmin && <th className="pb-3 text-right pr-3">Rol Seç</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {usersList.map((u) => (
                      <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 pl-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-white font-bold shrink-0">
                              {u.username ? u.username.slice(0, 1).toUpperCase() : '?'}
                            </div>
                            <div>
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <span>{u.display_name || u.username}</span>
                              </div>
                              <div className="text-[11px] font-mono text-white/45">
                                @{u.username}
                              </div>
                              {u.email && (
                                <div className="text-[10px] text-white/35 font-mono truncate max-w-[180px]">
                                  {u.email}
                                </div>
                              )}
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
                          <div className="flex flex-col gap-1.5 items-start">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Role Pill */}
                              {u.role === 'admin' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                                  ADMIN
                                </span>
                              )}
                              {(u.role === 'moderator' || u.role === 'mod') && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-400/20 text-purple-300 border border-purple-400/30">
                                  MODERATÖR
                                </span>
                              )}
                              {u.role === 'translator' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                                  ÇEVİRMEN
                                </span>
                              )}
                              {u.role === 'editor' && (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-400/20 text-sky-300 border border-sky-400/30">
                                  EDİTÖR
                                </span>
                              )}

                              {/* Ban / Warning / Normal Status Pill */}
                              {u.is_banned && u.ban_type === 'hard' ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-red-600/25 text-red-300 border border-red-500/40 flex items-center gap-1 shadow-[0_0_12px_rgba(239,68,68,0.2)]">
                                  <ShieldAlert className="w-3 h-3" />
                                  <span>HARD BAN</span>
                                </span>
                              ) : u.is_banned && u.ban_type === 'soft' ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-400/30 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>HAFİF BAN</span>
                                </span>
                              ) : (u.warning_count || 0) > 0 ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-orange-500/20 text-orange-300 border border-orange-400/30">
                                  UYARI ({u.warning_count}/3)
                                </span>
                              ) : u.role !== 'admin' && u.role !== 'moderator' && u.role !== 'mod' ? (
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  NORMAL
                                </span>
                              ) : null}
                            </div>

                            {/* Ban reason or details */}
                            {u.is_banned && (
                              <div className="text-[10px] text-white/50 max-w-[220px] truncate">
                                <span className="text-white/30">Neden:</span> {u.ban_reason || 'Belirtilmedi'}
                                {u.ban_expires_at && (
                                  <span className="block text-white/40">
                                    Bitiş: {new Date(u.ban_expires_at).toLocaleDateString('tr-TR')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {u.is_banned ? (
                              <button
                                type="button"
                                onClick={() => handleUnbanUser(u)}
                                className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/35 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                aria-label="Banı ve Kısıtlamaları Kaldır"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Banı Kaldır</span>
                              </button>
                            ) : (
                              <>
                                {/* Uyarı Gönder */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenModerationModal(u, 'warn')}
                                  className="px-2.5 py-1.5 rounded-xl bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 border border-orange-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                                  aria-label="Resmi Topluluk Uyarısı Gönder"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>Uyarı Gönder</span>
                                </button>

                                {/* Hafif Ban */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenModerationModal(u, 'soft_ban')}
                                  className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                                  aria-label="Hesabı Askıya Al (Yorum/Beğeni/Kütüphane Engeli)"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Hafif Ban</span>
                                </button>

                                {/* Hard Ban (Admin Only) */}
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenModerationModal(u, 'hard_ban')}
                                    className="px-2.5 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/40 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                    aria-label="Cihaz Parmak İzi & IP Kısıtlaması"
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    <span>Hard Ban</span>
                                  </button>
                                )}
                              </>
                            )}

                            {/* Mod Yetkisi Ver / Geri Al (Admin Only) */}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleToggleModRole(u)}
                                className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                                  u.role === 'moderator' || u.role === 'mod'
                                    ? 'bg-purple-500/20 hover:bg-purple-500/35 text-purple-300 border-purple-400/40'
                                    : 'bg-white/[0.05] hover:bg-white/10 text-white/70 border-white/10'
                                }`}
                                aria-label={u.role === 'moderator' || u.role === 'mod' ? 'Moderatörlük Yetkisini Al' : 'Moderatör Yetkisi Ver'}
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>{u.role === 'moderator' || u.role === 'mod' ? 'Mod Yetkisini Al' : 'Mod Yetkisi Ver'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="py-3.5 text-right pr-3">
                            {u.role === 'admin' ? (
                              <span className="inline-block px-3 py-1.5 rounded-xl bg-amber-400/10 border border-amber-400/25 text-xs font-mono font-bold text-amber-300">
                                Sistem Sahibi
                              </span>
                            ) : (
                              <CustomSelect
                                value={u.role || 'user'}
                                onChange={(newVal) => handleSetUserRole(u.id, newVal)}
                                options={USER_ROLE_OPTIONS}
                                variant="dark"
                                size="sm"
                                triggerClassName="!rounded-xl bg-black/60 border-white/15 text-xs py-1.5 px-3 min-w-[130px]"
                                menuClassName="min-w-[170px] z-50"
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            <PaginationControls
              currentPage={usersPage}
              totalCount={usersTotalCount}
              pageSize={50}
              onPageChange={(p) => setUsersPage(p)}
              loading={userLoading}
            />
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
                  <span>Seri & Medya Kataloğu ({seriesTotalCount.toLocaleString('tr-TR')})</span>
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
                  value={seriesSearchInput}
                  onChange={(e) => setSeriesSearchInput(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none"
                />
                {seriesSearchInput && (
                  <button
                    type="button"
                    onClick={() => setSeriesSearchInput('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {[
                  { id: 'ALL', label: 'TÜMÜ' },
                  { id: 'dizi', label: 'DİZİ' },
                  { id: 'anime', label: 'ANİME' },
                  { id: 'film', label: 'FİLM' },
                  { id: 'program', label: 'PROGRAM' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSeriesTypeFilter(t.id);
                      setSeriesPage(1);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer ${
                      seriesTypeFilter === t.id
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {['ALL', 'KR', 'JP', 'CN', 'TH', 'TW', 'US', 'TR'].map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setSeriesCountryFilter(c);
                      setSeriesPage(1);
                    }}
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
            ) : seriesList.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Aramanızla eşleşen yapım bulunamadı.
              </div>
            ) : (
              <div className="overflow-x-auto min-h-[380px]">
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
                    {seriesList.map((m) => (
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
                            <span>{formatContentTypeTR(m.content_type, m.country_code)}</span>
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
                            {m.is_featured ? (
                              <span className="flex items-center gap-1">
                                <Star className="w-3 h-3 fill-amber-300" />
                                <span>Vitrinde</span>
                              </span>
                            ) : (
                              'Vitrinde Değil'
                            )}
                          </button>
                        </td>
                        <td className="py-3 text-right pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setSelectedMediaForEp(m);
                                setActiveTab('episodes');
                              }}
                              className="px-3 py-1.5 rounded-xl bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-400/30 text-xs font-semibold cursor-pointer transition-colors"
                            >
                              Bölümler
                            </button>
                            <button
                              onClick={() => {
                                setEditingSeries(m);
                                setSeriesModalOpen(true);
                              }}
                              className="p-1.5 rounded-xl bg-white/10 text-white/80 hover:text-white cursor-pointer transition-colors"
                              aria-label="Düzenle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteSeries(m.id, m.title)}
                                className="p-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 cursor-pointer transition-colors"
                                aria-label="Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            <PaginationControls
              currentPage={seriesPage}
              totalCount={seriesTotalCount}
              pageSize={50}
              onPageChange={(p) => setSeriesPage(p)}
              loading={seriesLoading}
            />
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
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => {
                      setBulkIntroModalOpen(true);
                      setBulkIntroTargetSeason('all');
                      setBulkIntroStart('');
                      setBulkIntroEnd('');
                      setBulkIntroClear(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-xs font-bold hover:bg-amber-400/25 transition-all cursor-pointer shadow-lg shrink-0"
                  >
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Toplu İntro Ekle</span>
                  </button>

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
                </div>
              )}
            </div>

            {/* Direct Series Search Bar & Results Cards */}
            {!selectedMediaForEp ? (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    placeholder="Yönetmek istediğiniz diziyi, animeyi veya filmi arayın (Örn: Solo Leveling, Reply 1988, Horimiya)..."
                    value={epMediaSearchInput}
                    onChange={(e) => setEpMediaSearchInput(e.target.value)}
                    className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-black/60 border border-white/15 text-sm text-white placeholder-white/40 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50 shadow-inner"
                  />
                  {epMediaSearchInput ? (
                    <button
                      type="button"
                      onClick={() => setEpMediaSearchInput('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : epMediaSearchLoading ? (
                    <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 animate-spin" />
                  ) : null}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3 text-xs font-mono text-white/50">
                    <span>
                      {epMediaSearchInput
                        ? `"${epMediaSearchInput}" için bulunan seriler (${epMediaSearchResults.length}):`
                        : `Hızlı Seçim / Son Eklenen Seriler (${epMediaSearchResults.length}):`}
                    </span>
                    <span className="text-[11px] text-sky-400">Yönetmek için serinin üzerine tıklayın</span>
                  </div>

                  {epMediaSearchLoading ? (
                    <div className="py-12 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                      <span>Seriler aranıyor...</span>
                    </div>
                  ) : epMediaSearchResults.length === 0 ? (
                    <div className="py-12 rounded-2xl bg-white/[0.02] border border-white/10 text-center text-xs text-white/50">
                      Aramanızla eşleşen seri bulunamadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[460px] overflow-y-auto pr-1">
                      {epMediaSearchResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedMediaForEp(m);
                          }}
                          className="p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-sky-400/50 text-left flex items-center gap-3 transition-all cursor-pointer group hover:shadow-[0_4px_20px_rgba(41,151,255,0.15)]"
                        >
                          <div className="w-12 h-16 rounded-xl overflow-hidden bg-black/60 border border-white/10 shrink-0 relative">
                            {m.cover_image ? (
                              <img
                                src={getProxiedImageUrl(m.cover_image, m.title)}
                                alt={m.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Film className="w-5 h-5 text-white/30 m-auto mt-5" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-white truncate group-hover:text-sky-300 transition-colors">
                              {m.title}
                            </h4>
                            {m.native_title && (
                              <div className="text-[10px] text-white/40 truncate font-mono">
                                {m.native_title}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-white/10 text-white/80">
                                {m.content_type || 'Dizi'}
                              </span>
                              {m.country_code && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300">
                                  {m.country_code}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-white/45">
                                {m.release_year || (m as any).year || ''}
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Selected Media Header */
              <div className="p-4 rounded-2xl bg-white/[0.04] border border-sky-400/30 flex items-center justify-between gap-4 shadow-[0_0_24px_rgba(41,151,255,0.08)]">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-14 h-20 rounded-xl overflow-hidden bg-black/60 border border-white/15 shrink-0 shadow-md">
                    {selectedMediaForEp.cover_image ? (
                      <img
                        src={getProxiedImageUrl(selectedMediaForEp.cover_image, selectedMediaForEp.title)}
                        alt={selectedMediaForEp.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Film className="w-6 h-6 text-white/30 m-auto mt-7" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-white truncate">
                        {selectedMediaForEp.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30 uppercase">
                        {formatContentTypeTR(selectedMediaForEp.content_type, selectedMediaForEp.country_code)}
                      </span>
                    </div>
                    {selectedMediaForEp.native_title && (
                      <div className="text-xs text-white/50 font-mono mt-0.5 truncate">
                        {selectedMediaForEp.native_title}
                      </div>
                    )}
                    <div className="text-xs text-sky-300 font-mono mt-1 flex items-center gap-2">
                      <span className="font-bold text-white">{episodesList.length} Bölüm Mevcut</span>
                      <span>·</span>
                      <span>{selectedMediaForEp.release_year || (selectedMediaForEp as any).year || ''}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedMediaForEp(null)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Farklı Seri Seç</span>
                </button>
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
                                  : ep.status === 'broken'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-amber-400/20 text-amber-300'
                              }`}
                            >
                              {ep.status === 'published' ? 'YAYINDA' : ep.status === 'broken' ? 'KIRIK' : 'BEKLENİYOR'}
                            </span>
                            {ep.intro_start_sec != null && ep.intro_end_sec != null && ep.intro_end_sec > ep.intro_start_sec && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-400/15 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                                <span>⏩ İntro: {Math.floor(ep.intro_start_sec / 60)}:{String(ep.intro_start_sec % 60).padStart(2, '0')} - {Math.floor(ep.intro_end_sec / 60)}:{String(ep.intro_end_sec % 60).padStart(2, '0')}</span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedEpForSource(ep);
                                setNewSourceModalOpen(true);
                              }}
                              className="px-3 py-1 rounded-xl bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-bold border border-sky-400/30 cursor-pointer flex items-center gap-1 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Kaynak Ekle</span>
                            </button>
                            <button
                              onClick={() => {
                                setEditingEp(ep);
                                setEpModalOpen(true);
                              }}
                              className="p-1.5 rounded-xl bg-white/10 text-white/80 hover:text-white cursor-pointer transition-colors"
                              aria-label="Bölümü Düzenle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteEpisode(ep)}
                              className="p-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 cursor-pointer transition-colors"
                              aria-label="Bölümü Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
                                    <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                      <span>{s.source_name || s.provider || 'Kaynak'}</span>
                                      {s.quality_label && (
                                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-white/60">
                                          {s.quality_label}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] font-mono text-white/40 truncate">
                                      {s.direct_url}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteSource(ep, idx)}
                                    className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 cursor-pointer shrink-0 transition-colors"
                                    aria-label="Kaynağı Kaldır"
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-sky-400" />
                  <span>Topluluk & Yorum Moderasyonu ({commentsTotalCount.toLocaleString('tr-TR')})</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  Kullanıcı yorumlarını denetleyin, spoiler etiketi ekleyin, uygunsuz yorumları gizleyin veya kaldırın.
                </p>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {[
                  { id: 'ALL', label: 'TÜMÜ' },
                  { id: 'spoiler', label: 'SPOILER' },
                  { id: 'hidden', label: 'GİZLENENLER' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setCommentFilter(f.id as any);
                      setCommentsPage(1);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer ${
                      commentFilter === f.id
                        ? 'bg-white text-black font-bold'
                        : 'bg-white/[0.05] text-white/70 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Yorum içeriği, başlık veya yazar adı ile ara..."
                value={commentSearchInput}
                onChange={(e) => setCommentSearchInput(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/30"
              />
              {commentSearchInput && (
                <button
                  type="button"
                  onClick={() => setCommentSearchInput('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {commentsLoading ? (
              <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Yorumlar yükleniyor...</span>
              </div>
            ) : commentsList.length === 0 ? (
              <div className="py-16 text-center text-xs text-white/50">
                Aramanızla eşleşen moderasyon yorumu bulunamadı.
              </div>
            ) : (
              <div className="space-y-3 min-h-[380px]">
                {commentsList.map((c) => {
                  const isHidden = Boolean(c.is_hidden);
                  const author = c.profiles?.display_name || c.profiles?.username || c.author_username || 'Kullanıcı';
                  const avatar = c.profiles?.avatar_url || c.author_avatar;

                  return (
                    <div
                      key={c.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                        isHidden
                          ? 'bg-rose-500/[0.04] border-rose-500/25'
                          : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="space-y-2 flex-1 min-w-0">
                        {/* Meta Line */}
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                            {avatar ? (
                              <img src={avatar} alt={author} className="w-full h-full object-cover" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-white/50" />
                            )}
                          </div>
                          <span className="font-bold text-white text-xs">
                            @{author}
                          </span>
                          {c.profiles?.role && c.profiles.role !== 'user' && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 text-[9px] font-mono font-bold uppercase">
                              {c.profiles.role}
                            </span>
                          )}
                          {c.media && (
                            <Link
                              href={`/seri/${c.media.slug}`}
                              target="_blank"
                              className="px-2 py-0.5 rounded bg-white/10 text-white/70 hover:text-white text-[10px] font-mono flex items-center gap-1"
                            >
                              <span>{c.media.title}</span>
                              {c.episode_number && <span>· {c.episode_number}. Bölüm</span>}
                              <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                            </Link>
                          )}
                          {(c.person_id || c.target_type === 'person') && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono flex items-center gap-1">
                              <span>Oyuncu Yorumu {c.person_id ? `(#${c.person_id})` : ''}</span>
                            </span>
                          )}
                          {c.has_spoiler && (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                              SPOILER
                            </span>
                          )}
                          {isHidden && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                              GİZLENDİ
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-white/40">
                            {new Date(c.created_at).toLocaleDateString('tr-TR', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Title & Body */}
                        {c.title && (
                          <div className="text-xs font-bold text-white">
                            {c.title}
                          </div>
                        )}
                        <div className="text-xs text-white/75 leading-relaxed line-clamp-3 whitespace-pre-wrap font-sans">
                          {getCommentDisplayText(c)}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleSpoiler(c)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                            c.has_spoiler
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                              : 'bg-white/10 text-white/80 hover:text-white hover:bg-white/15'
                          }`}
                        >
                          {c.has_spoiler ? 'Spoiler Kaldır' : 'Spoiler Yap'}
                        </button>
                        <button
                          onClick={() => handleToggleHide(c)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                            isHidden
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                          }`}
                        >
                          {isHidden ? 'Onayla (Yayınla)' : 'Gizle'}
                        </button>
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-bold cursor-pointer transition-colors"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            <PaginationControls
              currentPage={commentsPage}
              totalCount={commentsTotalCount}
              pageSize={50}
              onPageChange={(p) => setCommentsPage(p)}
              loading={commentsLoading}
            />
          </div>
        </div>
      )}

      {/* ================= TAB 6: SCRAPER BOTLARI & CRON ================= */}
      {activeTab === 'scrapers' && (() => {
        const currentBot = selectedScraperId ? scrapers.find((b) => b.id === selectedScraperId) : null;
        const currentBrand = selectedScraperId ? SCRAPER_BRAND_INFO[selectedScraperId] : null;
        const currentMeta = scraperDetailData?.meta || currentBrand;
        const currentRecentItems = (scraperDetailData?.recentItems || []) as any[];
        const isSelectedRunning = runningScraperId === selectedScraperId;

        if (selectedScraperId && currentBot) {
          return (
            <div className="space-y-6">
              {/* Top Navigation & Back Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-3xl apple-glass border border-white/10">
                <button
                  type="button"
                  onClick={() => setSelectedScraperId(null)}
                  className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all cursor-pointer shadow"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Tüm Scraper Botlarına Dön</span>
                </button>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-mono text-white/60">
                    <Clock className="w-3.5 h-3.5 text-white/40" />
                    <span>
                      Son Tarama:{' '}
                      {currentBot.last_run_at
                        ? new Date(currentBot.last_run_at).toLocaleTimeString('tr-TR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : 'Beklemede'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleScraperActive(currentBot)}
                    className={`px-3 py-1.5 rounded-full text-xs font-mono font-bold transition-all cursor-pointer border ${
                      currentBot.is_enabled
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-400/40 hover:bg-rose-500/30'
                    }`}
                  >
                    {currentBot.is_enabled ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Bot Aktif & Dinliyor</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        <span>Bot Devre Dışı</span>
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Hero Header with Brand Identity */}
              <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 relative overflow-hidden">
                <div
                  className={`absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none bg-gradient-to-br ${
                    currentBrand?.bgGradient || 'from-sky-500 to-blue-700'
                  }`}
                />

                <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-start sm:items-center gap-4">
                    <div className="w-16 h-16 rounded-3xl bg-black/60 border border-white/15 p-2 flex items-center justify-center shrink-0 shadow-2xl">
                      <ScraperLogoBadge siteKey={currentBot.id} name={currentBot.name} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="text-2xl font-black text-white tracking-tight">
                          {currentBot.name}
                        </h1>
                        {currentBrand && (
                          <span className={`px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-mono font-semibold ${currentBrand.textColor}`}>
                            {currentBrand.category}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-white/60 max-w-2xl leading-relaxed">
                        {currentBot.notes || currentBrand?.protocol || 'Otomatik kaynak senkronizasyon botu.'}
                      </p>

                      {currentBrand?.domain && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <a
                            href={currentBrand.domain}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            <Globe className="w-3.5 h-3.5" />
                            <span>{currentBrand.domain.replace('https://', '')}</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                          <span className="text-white/20">·</span>
                          <span className="text-[11px] font-mono text-white/40">
                            Protokol: {currentBrand.protocol}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Trigger Buttons */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => triggerScraperNow(currentBot.id, currentBot.name)}
                      disabled={isSelectedRunning}
                      className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-xs tracking-wide transition-all shadow-xl cursor-pointer disabled:opacity-50 ${
                        isSelectedRunning
                          ? 'bg-amber-400 text-black'
                          : 'bg-white text-black hover:bg-white/90 active:scale-95'
                      }`}
                    >
                      <RefreshCw className={`w-4 h-4 ${isSelectedRunning ? 'animate-spin' : ''}`} />
                      <span>{isSelectedRunning ? 'Canlı Taranıyor & İşleniyor...' : 'Şimdi Tara (Canlı Senkronize Et)'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setLiveTerminalLogs([])}
                      className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white/80 hover:text-white font-mono text-xs border border-white/10 transition-all cursor-pointer"
                    >
                      Konsolu Temizle
                    </button>
                  </div>
                </div>
              </div>

              {/* ================= SINGLE SERIES TARGETED SYNC ================= */}
              <div className="p-5 sm:p-6 rounded-3xl apple-glass border border-sky-400/20 bg-sky-500/[0.03] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400">
                      <Search className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white tracking-wide">
                        Tek Dizi Ara & Doğrudan Senkronize Et
                      </h3>
                      <p className="text-[11px] text-white/50">
                        {currentBot.name} üzerinden belirli bir diziyi aratıp yalnızca onun bölümlerini ve video akışlarını sisteme çekin.
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-sky-300 bg-sky-500/10 px-2.5 py-1 rounded-full border border-sky-400/20">
                    Birebir Hedef Senkronu
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                  <div className="relative flex-1 w-full">
                    <input
                      type="text"
                      value={singleSeriesQuery}
                      onChange={(e) => setSingleSeriesQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && singleSeriesQuery.trim() && !isSelectedRunning) {
                          triggerScraperNow(currentBot.id, currentBot.name, singleSeriesQuery.trim());
                        }
                      }}
                      placeholder={`Örn: Itaewon Class, Horimiya, Breaking Bad veya ${currentBrand?.domain?.replace('https://', '')}/dizi-adi...`}
                      className="w-full px-4 py-3 rounded-2xl bg-black/60 border border-white/15 text-white text-xs placeholder:text-white/35 focus:outline-none focus:border-sky-400 transition-colors font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (singleSeriesQuery.trim()) {
                        triggerScraperNow(currentBot.id, currentBot.name, singleSeriesQuery.trim());
                      }
                    }}
                    disabled={!singleSeriesQuery.trim() || isSelectedRunning}
                    className="w-full sm:w-auto px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs tracking-wide transition-all glow-sky disabled:opacity-40 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2 shrink-0 active:scale-95"
                  >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span>{isSelectedRunning ? 'Senkronize Ediliyor...' : 'Diziyi Çek & Senkron Et'}</span>
                  </button>
                </div>
              </div>

              {/* 4-Card Metrics Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl apple-glass border border-white/10 space-y-1">
                  <div className="text-[11px] font-mono text-white/50 uppercase tracking-wider">Toplam Senkronize</div>
                  <div className="text-2xl font-black text-white font-mono">
                    {currentBot.items_synced.toLocaleString('tr-TR')}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Veritabanı ile eşleşti</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl apple-glass border border-white/10 space-y-1">
                  <div className="text-[11px] font-mono text-white/50 uppercase tracking-wider">Cron Zamanlaması</div>
                  <div className="text-lg font-black text-amber-300 font-mono pt-0.5">
                    {currentBot.cron_schedule}
                  </div>
                  <div className="text-[10px] text-white/40 font-mono">
                    GitHub Actions / Cloudflare
                  </div>
                </div>

                <div className="p-4 rounded-2xl apple-glass border border-white/10 space-y-1">
                  <div className="text-[11px] font-mono text-white/50 uppercase tracking-wider">Sağlık & Başarı</div>
                  <div className="text-2xl font-black text-emerald-300 font-mono">
                    %100.0
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono">
                    0 Hata · Sağlıklı Yanıt
                  </div>
                </div>

                <div className="p-4 rounded-2xl apple-glass border border-white/10 space-y-1">
                  <div className="text-[11px] font-mono text-white/50 uppercase tracking-wider">Hedef Kategori</div>
                  <div className="text-lg font-black text-sky-300 font-mono pt-0.5 truncate">
                    {currentBrand?.category || 'K-Drama / Dizi'}
                  </div>
                  <div className="text-[10px] text-white/40 font-mono truncate">
                    {currentBrand?.tag || 'Otomatik Parser'}
                  </div>
                </div>
              </div>

              {/* Live Terminal Console (Realtime execution stream) */}
              <div className="rounded-3xl border border-white/15 bg-[#07090e] shadow-2xl overflow-hidden space-y-0">
                {/* Terminal Header */}
                <div className="px-5 py-3.5 bg-black/70 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                      <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                      <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-white/70">
                      <Terminal className="w-3.5 h-3.5 text-sky-400" />
                      <span className="font-semibold text-white/90">
                        koup-scraper-engine :: {currentBot.id} --live-stream
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-mono">
                    <div className="flex items-center gap-1.5 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>CANLI İZLEME AKTİF</span>
                    </div>
                    <span className="text-white/20">|</span>
                    <span className="text-white/50">{liveTerminalLogs.length} satır log</span>
                  </div>
                </div>

                {/* Terminal Body */}
                <div className="p-5 font-mono text-xs max-h-[360px] min-h-[220px] overflow-y-auto space-y-1.5 scrollbar-thin">
                  {liveTerminalLogs.length === 0 ? (
                    <div className="py-12 text-center text-white/40 space-y-2">
                      <Activity className="w-6 h-6 mx-auto opacity-30 animate-pulse" />
                      <p>Terminal dinlemede. Canlı log akışı için yukarıdaki &quot;Şimdi Tara&quot; butonuna basınız.</p>
                    </div>
                  ) : (
                    liveTerminalLogs.map((line, idx) => {
                      let colorClass = 'text-white/80';
                      if (line.includes('[BAŞLATILDI]')) colorClass = 'text-sky-300 font-bold';
                      else if (line.includes('[BAĞLANTI]')) colorClass = 'text-blue-400';
                      else if (line.includes('[TARAMA]')) colorClass = 'text-amber-300';
                      else if (line.includes('[ÇÖZÜCÜ]')) colorClass = 'text-purple-300';
                      else if (line.includes('[SENKRON]')) colorClass = 'text-teal-300';
                      else if (line.includes('[TAMAMLANDI]')) colorClass = 'text-emerald-300 font-bold bg-emerald-500/10 px-2 py-0.5 rounded inline-block';
                      else if (line.includes('[HATA]')) colorClass = 'text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded inline-block';
                      else if (line.includes('[BEKLEMEDE]')) colorClass = 'text-white/50';

                      return (
                        <div key={idx} className={`leading-relaxed break-all ${colorClass}`}>
                          {line}
                        </div>
                      );
                    })
                  )}

                  {isSelectedRunning && (
                    <div className="flex items-center gap-2 text-sky-400 pt-2 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
                      <span>&gt; Paket ayrıştırılıyor, hedef sunucudan güncel bölümler çekiliyor...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Son Eklenen & Senkronize Edilen Yapımlar (Recently added items) */}
              <div className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-amber-400" />
                      <span>Son Eklenen & Senkronize Edilen İçerikler</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-xs font-mono text-white/70">
                        {currentRecentItems.length} Yapım
                      </span>
                    </h3>
                    <p className="text-xs text-white/50 mt-0.5">
                      Bu bot tarafından sisteme kaydedilen son bölümler ve medya kaynakları. Tıklayarak doğrudan sayfasına gidebilirsiniz.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => openScraperDetail(currentBot.id)}
                    disabled={isLoadingScraperDetail}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold cursor-pointer transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingScraperDetail ? 'animate-spin' : ''}`} />
                    <span>Yenile</span>
                  </button>
                </div>

                {isLoadingScraperDetail ? (
                  <div className="py-16 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                    <span>Eklenen yapımlar yükleniyor...</span>
                  </div>
                ) : currentRecentItems.length === 0 ? (
                  <div className="py-16 text-center text-xs text-white/40 space-y-2">
                    <p>Bu bot için henüz listelenmiş ekleme kaydı bulunamadı.</p>
                    <p className="text-[11px] text-white/30">Canlı veri çekmek için &quot;Şimdi Tara&quot; butonunu kullanabilirsiniz.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {currentRecentItems.map((item: any, idx: number) => (
                      <Link
                        key={item.id || idx}
                        href={item.link || '#'}
                        target="_blank"
                        className="group p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-sky-500/40 transition-all flex flex-col justify-between gap-3 shadow-lg"
                      >
                        <div className="space-y-2.5">
                          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black/60 relative border border-white/10">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-white/30 font-mono">
                                Görsel Yok
                              </div>
                            )}
                            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono font-bold text-emerald-300 border border-emerald-400/30">
                              {item.status || 'Yayında'}
                            </div>
                          </div>

                          <div>
                            <h4 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
                              {item.title}
                            </h4>
                            <p className="text-xs text-white/60 line-clamp-1 mt-0.5">
                              {item.subtitle || 'Bölüm'}
                            </p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/50">
                          <span className="text-sky-400 truncate max-w-[130px]">
                            {item.sourceName || '1080p Kaynak'}
                          </span>
                          <div className="flex items-center gap-1 text-white/60 group-hover:text-white transition-colors">
                            <span>Aç</span>
                            <ExternalLink className="w-3 h-3" />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          /* SCRAPER CARDS LIST VIEW WITH BRAND BADGES & DIRECT ACTIONS */
          <section className="rounded-3xl apple-glass p-6 sm:p-8 border border-white/15 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Radio className="w-5 h-5 text-emerald-400" />
                  <span>Otomatik Scraper Botları & Cron Saat Yönetimi</span>
                </h2>
                <p className="text-xs text-white/55 mt-0.5">
                  GitHub Actions Cron + Cloudflare Edge Cron + 24 Saat Rolling Verification Watchdog
                </p>
              </div>

              <div className="text-xs font-mono text-white/60 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 shrink-0">
                Toplam <span className="text-white font-bold">{scrapers.length}</span> Aktif Bot Motoru
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scrapers.map((bot) => {
                const isRunning = runningScraperId === bot.id;
                const brand = SCRAPER_BRAND_INFO[bot.id];

                return (
                  <div
                    key={bot.id}
                    className="p-5 rounded-3xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between gap-5 group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <ScraperLogoBadge siteKey={bot.id} name={bot.name} />
                          <div>
                            <h3 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
                              {bot.name}
                            </h3>
                            {brand?.category && (
                              <span className="text-[10px] font-mono text-white/50 block">
                                {brand.category}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleScraperActive(bot)}
                            className={`px-3 py-1 rounded-full text-[11px] font-mono font-semibold transition-all cursor-pointer border ${
                              bot.is_enabled
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/30'
                                : 'bg-rose-500/20 text-rose-300 border-rose-400/40 hover:bg-rose-500/30'
                            }`}
                          >
                            {bot.is_enabled ? 'Aktif' : 'Devre Dışı'}
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-white/60 leading-relaxed">
                        {bot.notes || brand?.protocol}
                      </p>

                      {brand?.domain && (
                        <div className="flex items-center gap-2">
                          <a
                            href={brand.domain}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                          >
                            <Globe className="w-3 h-3" />
                            <span>{brand.domain.replace('https://', '')}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-white/50">Cron:</span>
                        <span className="px-2 py-0.5 rounded-lg bg-black/70 border border-white/15 text-xs font-mono text-amber-300">
                          {bot.cron_schedule}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-white/80">
                          {bot.items_synced.toLocaleString('tr-TR')} Senkron
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openScraperDetail(bot.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-all cursor-pointer"
                        >
                          <Terminal className="w-3.5 h-3.5 text-sky-400" />
                          <span>Detay & Canlı Konsol</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => triggerScraperNow(bot.id, bot.name)}
                          disabled={isRunning}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer disabled:opacity-50 shadow-md"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                          <span>{isRunning ? 'Taranıyor...' : 'Şimdi Tara'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

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
                      className="px-3.5 py-1.5 rounded-full bg-emerald-400 text-black font-bold text-xs cursor-pointer hover:bg-emerald-300 transition-colors"
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
              <label className="block text-xs text-white/60 mb-1.5 font-medium">Duyuru Başlığı</label>
              <input
                type="text"
                required
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="Örn: Planlı Sunucu Bakımı & Yeni Güncelleme"
                className="w-full px-4 py-2.5 rounded-2xl bg-black/60 border border-white/12 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/30 transition-all font-medium"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1.5 font-medium">Duyuru Mesajı</label>
              <textarea
                rows={4}
                required
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Sitemiz yarın 13:00–14:00 saatleri arasında performans optimizasyonu çalışmasına alınacaktır..."
                className="w-full p-3.5 rounded-2xl bg-black/60 border border-white/12 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/30 transition-all font-medium resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={broadcastSending}
              className="w-full py-3 rounded-full bg-white text-black font-bold text-xs cursor-pointer hover:bg-white/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {broadcastSending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
              <span>{broadcastSending ? 'Gönderiliyor...' : 'Tüm Üyelere Sesli Bildirim Gönder'}</span>
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
                  className="p-1.5 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer transition-colors"
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
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      İçerik Türü
                    </label>
                    <CustomSelect
                      value={editingSeries?.content_type || 'dizi'}
                      onChange={(val) =>
                        setEditingSeries((prev) => ({ ...prev, content_type: val }))
                      }
                      options={CONTENT_TYPE_OPTIONS}
                      variant="dark"
                      size="sm"
                      className="w-full"
                      triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2"
                      menuClassName="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Ülke
                    </label>
                    <CustomSelect
                      value={editingSeries?.country_code || 'KR'}
                      onChange={(val) =>
                        setEditingSeries((prev) => ({ ...prev, country_code: val }))
                      }
                      options={COUNTRY_OPTIONS}
                      variant="dark"
                      size="sm"
                      className="w-full"
                      triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2"
                      menuClassName="w-full"
                    />
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
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                    className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSeriesModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-white/70 hover:text-white cursor-pointer transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-all"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: TOPLU İNTRO AYARLA ================= */}
      <AnimatePresence>
        {bulkIntroModalOpen && selectedMediaForEp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !bulkIntroSaving && setBulkIntroModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md rounded-3xl bg-[#131317] border border-amber-400/25 p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto my-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Toplu İntro Süresi Ayarla</h3>
                    <p className="text-[11px] text-white/50 truncate max-w-[260px]">{selectedMediaForEp.title}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !bulkIntroSaving && setBulkIntroModalOpen(false)}
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleBulkSaveIntro} className="space-y-4">
                {/* Target Scope Selection */}
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1.5">
                    Uygulanacak Kapsam
                  </label>
                  <CustomSelect
                    value={bulkIntroTargetSeason}
                    onChange={(val) => setBulkIntroTargetSeason(val)}
                    options={[
                      {
                        value: 'all',
                        label: `Tüm Sezonlar & Bölümler (${episodesList.length} Bölüm)`,
                      },
                      ...Array.from(new Set(episodesList.map((e) => e.season_number || 1)))
                        .sort((a, b) => a - b)
                        .map((s) => ({
                          value: String(s),
                          label: `${s}. Sezon (${episodesList.filter((e) => (e.season_number || 1) === s).length} Bölüm)`,
                        })),
                    ]}
                    variant="dark"
                    size="sm"
                    className="w-full"
                    triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2 text-xs"
                    menuClassName="w-full"
                  />
                  <p className="text-[10px] text-white/40 mt-1">
                    Seçilen kapsama giren tüm bölümlerin intro süreleri tek seferde senkronize edilir.
                  </p>
                </div>

                {/* Option to clear */}
                <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-white">İntroları Kaldır / Temizle</div>
                    <div className="text-[10px] text-white/45">Seçilen kapsamdaki bölümlerin intro atlama sürelerini sıfırlar.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={bulkIntroClear}
                    onChange={(e) => setBulkIntroClear(e.target.checked)}
                    className="w-4 h-4 rounded accent-amber-400 cursor-pointer"
                  />
                </div>

                {/* Inputs if not clearing */}
                {!bulkIntroClear && (
                  <div className="space-y-3 p-3.5 rounded-2xl bg-black/40 border border-white/10">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-amber-300 mb-1">
                          İntro Başlangıç
                        </label>
                        <input
                          type="text"
                          required={!bulkIntroClear}
                          placeholder="Örn: 90 veya 01:30"
                          value={bulkIntroStart}
                          onChange={(e) => setBulkIntroStart(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400/50"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-amber-300 mb-1">
                          İntro Bitiş / Atla
                        </label>
                        <input
                          type="text"
                          required={!bulkIntroClear}
                          placeholder="Örn: 180 veya 03:00"
                          value={bulkIntroEnd}
                          onChange={(e) => setBulkIntroEnd(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400/50"
                        />
                      </div>
                    </div>

                    {/* Preview Badge */}
                    {(() => {
                      const parseT = (val: string) => {
                        const t = val.trim();
                        if (!t) return null;
                        if (t.includes(':')) {
                          const p = t.split(':');
                          return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
                        }
                        const n = Number(t);
                        return Number.isNaN(n) ? null : n;
                      };
                      const s = parseT(bulkIntroStart);
                      const en = parseT(bulkIntroEnd);
                      if (s != null && en != null && en > s) {
                        return (
                          <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {en - s} saniye atlar ({Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} → {Math.floor(en / 60)}:{String(en % 60).padStart(2, '0')})
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    disabled={bulkIntroSaving}
                    onClick={() => setBulkIntroModalOpen(false)}
                    className="px-4 py-2 text-xs text-white/70 hover:text-white cursor-pointer transition-colors"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={bulkIntroSaving}
                    className="px-5 py-2 rounded-xl bg-amber-400 text-black text-xs font-bold hover:bg-amber-300 transition-all cursor-pointer shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {bulkIntroSaving ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Kaydediliyor...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{bulkIntroClear ? 'İntroları Sıfırla' : 'Toplu Uygula'}</span>
                      </>
                    )}
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
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer transition-colors"
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
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                      className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
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
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Yayın Durumu
                  </label>
                  <CustomSelect
                    value={editingEp?.status || 'published'}
                    onChange={(val) =>
                      setEditingEp((prev) => ({ ...prev, status: val }))
                    }
                    options={EPISODE_STATUS_OPTIONS}
                    variant="dark"
                    size="sm"
                    className="w-full"
                    triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2"
                    menuClassName="w-full"
                  />
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
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>

                {/* Intro Skip Range (Start & End) */}
                <div className="p-3.5 rounded-2xl bg-amber-500/[0.05] border border-amber-400/20 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                      <span>⏩ İntro Atlama Zamanı</span>
                      <span className="text-[10px] text-white/40 font-normal">(İsteğe Bağlı)</span>
                    </span>
                    {editingEp?.intro_start_sec != null &&
                      editingEp?.intro_end_sec != null &&
                      editingEp.intro_end_sec > editingEp.intro_start_sec && (
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          {editingEp.intro_end_sec - editingEp.intro_start_sec} sn atlar
                        </span>
                      )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-medium text-white/60 mb-1">
                        Başlangıç (sn veya 01:30)
                      </label>
                      <input
                        type="text"
                        placeholder="Örn: 90 veya 01:30"
                        value={
                          editingEp?.intro_start_sec != null
                            ? `${Math.floor(editingEp.intro_start_sec / 60)}:${String(
                                editingEp.intro_start_sec % 60
                              ).padStart(2, '0')}`
                            : ''
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            setEditingEp((prev) => ({ ...prev, intro_start_sec: null }));
                            return;
                          }
                          let sec: number | null = null;
                          if (raw.includes(':')) {
                            const p = raw.split(':').map(Number);
                            if (p.length === 2 && !Number.isNaN(p[0]) && !Number.isNaN(p[1])) {
                              sec = p[0] * 60 + p[1];
                            }
                          } else {
                            const n = Number(raw);
                            if (!Number.isNaN(n)) sec = n;
                          }
                          setEditingEp((prev) => ({ ...prev, intro_start_sec: sec }));
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400/50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-white/60 mb-1">
                        Bitiş (sn veya 03:00)
                      </label>
                      <input
                        type="text"
                        placeholder="Örn: 180 veya 03:00"
                        value={
                          editingEp?.intro_end_sec != null
                            ? `${Math.floor(editingEp.intro_end_sec / 60)}:${String(
                                editingEp.intro_end_sec % 60
                              ).padStart(2, '0')}`
                            : ''
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (!raw) {
                            setEditingEp((prev) => ({ ...prev, intro_end_sec: null }));
                            return;
                          }
                          let sec: number | null = null;
                          if (raw.includes(':')) {
                            const p = raw.split(':').map(Number);
                            if (p.length === 2 && !Number.isNaN(p[0]) && !Number.isNaN(p[1])) {
                              sec = p[0] * 60 + p[1];
                            }
                          } else {
                            const n = Number(raw);
                            if (!Number.isNaN(n)) sec = n;
                          }
                          setEditingEp((prev) => ({ ...prev, intro_end_sec: sec }));
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-amber-400/50"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEpModalOpen(false)}
                    className="px-3.5 py-1.5 text-xs text-white/70 hover:text-white cursor-pointer transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer transition-all shadow-md"
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
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddSourceToEpisode} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Sağlayıcı / Kaynak Adı
                  </label>
                  <CustomSelect
                    value={sourceProvider}
                    onChange={(val) => setSourceProvider(val)}
                    options={SOURCE_PROVIDER_OPTIONS}
                    variant="dark"
                    size="sm"
                    className="w-full"
                    triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2"
                    menuClassName="w-full max-h-60 overflow-y-auto"
                  />
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
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Kalite Etiketi
                  </label>
                  <CustomSelect
                    value={sourceQuality}
                    onChange={(val) => setSourceQuality(val)}
                    options={SOURCE_QUALITY_OPTIONS}
                    variant="dark"
                    size="sm"
                    className="w-full"
                    triggerClassName="w-full !rounded-xl justify-between bg-black/60 border-white/15 py-2"
                    menuClassName="w-full"
                  />
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewSourceModalOpen(false)}
                    className="px-3.5 py-1.5 text-xs text-white/70 hover:text-white cursor-pointer transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer transition-all shadow-md"
                  >
                    Kaynağı Bağla
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ================= MODAL: MODERASYON İŞLEMİ (UYARI / HAFİF BAN / HARD BAN) ================= */}
      <AnimatePresence>
        {modModalOpen && modTargetUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!modSubmitting) {
                  setModModalOpen(false);
                  setModTargetUser(null);
                }
              }}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg rounded-3xl bg-[#131317] border border-white/15 p-6 sm:p-7 shadow-2xl z-10 max-h-[90vh] overflow-y-auto my-auto space-y-5"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-9 h-9 rounded-2xl flex items-center justify-center border ${
                      modActionType === 'hard_ban'
                        ? 'bg-red-500/15 text-red-400 border-red-500/30'
                        : modActionType === 'soft_ban'
                        ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        : 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                    }`}
                  >
                    {modActionType === 'hard_ban' ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : modActionType === 'soft_ban' ? (
                      <Lock className="w-5 h-5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {modActionType === 'hard_ban'
                        ? 'Hard Ban · Cihaz & IP Engelleme'
                        : modActionType === 'soft_ban'
                        ? 'Hafif Ban · Hesabı Askıya Al'
                        : 'Resmi Topluluk Uyarısı Gönder'}
                    </h3>
                    <p className="text-[11px] text-white/50">
                      Hedef: @{modTargetUser.username} ({modTargetUser.display_name || 'İsimsiz'})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={modSubmitting}
                  onClick={() => {
                    setModModalOpen(false);
                    setModTargetUser(null);
                  }}
                  className="p-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action Description Banner */}
              <div
                className={`p-3.5 rounded-2xl border text-xs leading-relaxed ${
                  modActionType === 'hard_ban'
                    ? 'bg-red-500/10 border-red-500/25 text-red-200'
                    : modActionType === 'soft_ban'
                    ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                    : 'bg-orange-500/10 border-orange-500/25 text-orange-200'
                }`}
              >
                {modActionType === 'hard_ban' && (
                  <div>
                    <strong className="flex items-center gap-1.5 font-bold text-red-100 mb-0.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Kritik Sistem Güvenlik Müdahalesi (Admin Yetkisi)</span>
                    </strong>
                    Kullanıcının tarayıcı/donanım parmak izi (fingerprint) kalıcı kara listeye alınır. Kullanıcı ve cihazındaki tüm oturumlar anında 403 Banned ekranına kilitlenir.
                  </div>
                )}
                {modActionType === 'soft_ban' && (
                  <div>
                    <strong className="block font-bold text-rose-100 mb-0.5">
                      Hesap İşlem Kısıtlaması (Hafif Ban)
                    </strong>
                    Kullanıcı sitedeki yapımları ve bölümleri izlemeye devam edebilir ancak yorum yapamaz, beğeni atamaz, takip/favori ekleyemez ve izleme listelerini güncelleyemez. Sayfa üstünde kalıcı uyarı şeridi görür.
                  </div>
                )}
                {modActionType === 'warn' && (
                  <div>
                    <strong className="block font-bold text-orange-100 mb-0.5">
                      Resmi İhlal Uyarısı
                    </strong>
                    Kullanıcıya bildirim gönderilir ve profil uyarı sayacı (1-3) artırılır. 3 uyarı alan kullanıcılar moderasyon listesinde öncelikli olarak işaretlenir.
                  </div>
                )}
              </div>

              {/* Form */}
              <form onSubmit={handleExecuteModeration} className="space-y-4">
                {/* Duration (only for soft ban) */}
                {modActionType === 'soft_ban' && (
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1.5">
                      Askıya Alma Süresi
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {[
                        { id: '24h', label: '24 Saat' },
                        { id: '3d', label: '3 Gün' },
                        { id: '7d', label: '7 Gün' },
                        { id: '30d', label: '30 Gün' },
                        { id: 'permanent', label: 'Kalıcı' },
                      ].map((dur) => (
                        <button
                          key={dur.id}
                          type="button"
                          onClick={() => setModDuration(dur.id as any)}
                          className={`py-2 rounded-xl text-xs font-mono font-medium border transition-all cursor-pointer ${
                            modDuration === dur.id
                              ? 'bg-rose-500/25 text-rose-200 border-rose-400 font-bold'
                              : 'bg-black/40 text-white/60 border-white/10 hover:text-white'
                          }`}
                        >
                          {dur.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reason Presets */}
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1.5">
                    Hızlı Şablonlar
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Spam veya reklam içerikli yorumlar',
                      'Küfür, hakaret ve nefret söylemi',
                      'Uyarıya rağmen spoiler etiketsiz paylaşım',
                      'Telif hakkı veya izinsiz kaynak dağıtımı',
                      'Çoklu hesap ve sistem istismarı',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setModReason(preset)}
                        className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/10 text-[10px] text-white/70 hover:text-white cursor-pointer transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reason Text */}
                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Gerekçe / Açıklama *
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="İhlal gerekçesini detaylıca belirtiniz..."
                    value={modReason}
                    onChange={(e) => setModReason(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-2xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/35 resize-none"
                  />
                </div>

                {/* Target User Metadata */}
                <div className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between text-[11px] text-white/50 font-mono">
                  <span>Mevcut Uyarı: <strong className="text-white">{modTargetUser.warning_count || 0} / 3</strong></span>
                  <span>Rol: <strong className="text-white uppercase">{modTargetUser.role || 'user'}</strong></span>
                  <span>Fingerprint: <strong className="text-white flex items-center gap-1">{modTargetUser.fingerprint_hash ? <><Check className="w-3 h-3 text-emerald-400" /> Kayıtlı</> : 'Yok'}</strong></span>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    disabled={modSubmitting}
                    onClick={() => {
                      setModModalOpen(false);
                      setModTargetUser(null);
                    }}
                    className="px-4 py-2 text-xs text-white/70 hover:text-white cursor-pointer transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    disabled={modSubmitting || !modReason.trim()}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer shadow-lg transition-all disabled:opacity-50 ${
                      modActionType === 'hard_ban'
                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30'
                        : modActionType === 'soft_ban'
                        ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/30'
                        : 'bg-orange-500 hover:bg-orange-400 text-white shadow-orange-500/30'
                    }`}
                  >
                    {modSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>İşleniyor...</span>
                      </>
                    ) : (
                      <>
                        {modActionType === 'hard_ban' ? (
                          <ShieldAlert className="w-3.5 h-3.5" />
                        ) : modActionType === 'soft_ban' ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {modActionType === 'hard_ban'
                            ? 'Hard Banı Onayla'
                            : modActionType === 'soft_ban'
                            ? 'Hafif Banı Uygula'
                            : 'Uyarıyı Gönder'}
                        </span>
                      </>
                    )}
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
