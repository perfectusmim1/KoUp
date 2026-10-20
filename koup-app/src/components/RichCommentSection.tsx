'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Bold,
  Italic,
  Heading2,
  EyeOff,
  Eye,
  Clock,
  Image as ImageIcon,
  Smile,
  Sparkles,
  Heart,
  HeartCrack,
  MessageSquare,
  Flag,
  Link2,
  Reply,
  Send,
  User,
  Pencil,
  Trash2,
  Check,
  X,
  Lock,
  ChevronDown,
  ShieldAlert,
  Search,
  Loader2,
} from 'lucide-react';
import { supabase, getProxiedImageUrl } from '@/lib/supabase';
import { invalidateCache } from '@/lib/cache';
import { useKoUp } from '@/context/KoUpContext';

interface CommentProfile {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  role?: string;
}

interface CommentRow {
  id: string;
  user_id: string;
  target_type: 'media' | 'episode' | 'person' | 'magazine';
  media_id?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  person_id?: number | null;
  magazine_id?: number | null;
  parent_id?: string | null;
  author_username?: string | null;
  author_avatar?: string | null;
  title?: string | null;
  content_json?: any;
  content_html: string;
  has_spoiler: boolean;
  timestamp_sec?: number | null;
  gif_url?: string | null;
  sticker_id?: string | null;
  image_url?: string | null;
  likes_count: number;
  dislikes_count?: number;
  created_at: string;
  is_hidden?: boolean;
  is_deleted?: boolean;
  status?: string;
  is_approved?: boolean;
  profiles?: CommentProfile | null;
}

const APPLE_DARK_PALETTE = [
  { name: 'Beyaz', hex: '#FFFFFF' },
  { name: 'Lumina Mavi', hex: '#38BDF8' },
  { name: 'Sinema Kehribar', hex: '#E5A93C' },
  { name: 'Kore Mercan', hex: '#FB7185' },
  { name: 'Zümrüt Yeşili', hex: '#34D399' },
  { name: 'Lavanta Mor', hex: '#C084FC' },
  { name: 'Turkuaz', hex: '#2DD4BF' },
  { name: 'Gümüş', hex: '#A1A1AA' },
];

const CURATED_GIFS = [
  {
    label: 'Alkış & Heyecan',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbW94cnh5N2ZxaG5mNndwZ2p3c3A2YnF1b21oN3l5b3R6eSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7abKhOpu0NwenH3O/giphy.gif',
  },
  {
    label: 'Gözyaşı / Duygusal',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2h6amR4bWp3Z2h1eHBrbXF5dG9pY3p5b2ZtcCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/OPU6wzx8JrHna/giphy.gif',
  },
  {
    label: 'Şok / Plot Twist',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnhydnF5dHBrbXF5dG9pY3p5b2ZtcCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0IypeKl9NJhPFMrK/giphy.gif',
  },
  {
    label: 'Kalp / Romantik',
    url: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnhydnF5dHBrbXF5dG9pY3p5b2ZtcCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/M90mJvfWfd5mbUuULX/giphy.gif',
  },
];

const KDRAMA_ANIME_STICKERS = [
  { id: 'finger-heart', badge: 'K-HEART', label: 'K-Heart' },
  { id: 'cinema-fire', badge: 'EFSANE', label: 'Efsane Sahne' },
  { id: 'crying-bowl', badge: 'DUYGUSAL', label: 'Mendil Bitti' },
  { id: 'crown-king', badge: 'BAŞYAPIT', label: 'Başyapıt' },
  { id: 'popcorn', badge: 'MARATON', label: 'Maraton' },
  { id: 'shock-twist', badge: 'TERS KÖŞE', label: 'Ters Köşe' },
];

const PAGE_SIZE = 20;

/**
 * XSS Sanitizer for user-provided HTML
 * Strips all dangerous tags, script/iframe/object/embed/form, on* handlers, and javascript: links.
 * Preserves safe styling (colors, font-weights, line-breaks).
 */
function sanitizeHtml(html: string): string {
  if (!html) return '';
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  clean = clean.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
  clean = clean.replace(/<link\b[^>]*>/gi, '');
  clean = clean.replace(/<meta\b[^>]*>/gi, '');

  clean = clean.replace(/\son\w+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '');
  clean = clean.replace(/(?:href|src)\s*=\s*["']?\s*(?:javascript|data):[^"'>\s]*/gi, '');

  // Convert font color tags to spans
  clean = clean.replace(/<font\s+color=["']?([^"'>]+)["']?>([\s\S]*?)<\/font>/gi, '<span style="color:$1;">$2</span>');

  // Convert legacy BBCode tags in case older comments or pasted text contain them
  clean = clean.replace(
    /\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9,\s.]+\))\]([\s\S]*?)\[\/color\]/gi,
    '<span style="color:$1;">$2</span>'
  );
  clean = clean.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  clean = clean.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  clean = clean.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h2>$1</h2>');

  clean = clean.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/gi, (match, tag, attrs) => {
    const lowerTag = tag.toLowerCase();
    const safeTags = [
      'div',
      'span',
      'strong',
      'em',
      'b',
      'i',
      'br',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'blockquote',
      'ul',
      'ol',
      'li',
      'font',
    ];
    if (!safeTags.includes(lowerTag)) return '';

    if (lowerTag === 'font') {
      const colorMatch = attrs.match(/color\s*=\s*["']([^"']*)["']/i);
      if (colorMatch) {
        const cVal = colorMatch[1].trim();
        if (/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9,\s.]+\))$/.test(cVal)) {
          return match.startsWith('</') ? '</span>' : `<span style="color:${cVal};">`;
        }
      }
      return match.startsWith('</') ? '</span>' : '<span>';
    }

    if (match.startsWith('</')) return `</${lowerTag}>`;
    if (lowerTag === 'br') return '<br/>';

    const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
    let safeStyleAttr = '';
    if (styleMatch) {
      const rawStyle = styleMatch[1];
      const safeStyles = rawStyle
        .split(';')
        .map((rule: string) => rule.trim())
        .filter((rule: string) => {
          const [prop, val] = rule.split(':').map((s) => s.trim().toLowerCase());
          if (!prop || !val) return false;
          if (
            prop === 'color' &&
            /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9,\s.]+\))$/.test(val)
          )
            return true;
          if (prop === 'font-weight' && /^(bold|normal|[1-9]00)$/.test(val)) return true;
          if (prop === 'font-style' && /^(italic|normal)$/.test(val)) return true;
          if (
            prop === 'font-size' &&
            /^([0-9.]+rem|[0-9]+px|large|x-large|inherit)$/.test(val)
          )
            return true;
          if (prop === 'line-height' && /^([0-9.]+|normal)$/.test(val)) return true;
          if (prop === 'display' && /^(inline-block|block|inline)$/.test(val)) return true;
          return false;
        });
      if (safeStyles.length > 0) {
        safeStyleAttr = ` style="${safeStyles.join(';')};"`;
      }
    }
    return `<${lowerTag}${safeStyleAttr}>`;
  });

  return clean;
}

function parseCommentTextToHtml(
  rawText: string,
  baseColor: string,
  isBold: boolean,
  isItalic: boolean,
  isHeading: boolean
): string {
  let escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  escaped = escaped.replace(
    /\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/color\]/g,
    '<span style="color:$1;font-weight:inherit;">$2</span>'
  );

  escaped = escaped.replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<em>$1</em>');
  escaped = escaped.replace(/\[h2\]([\s\S]*?)\[\/h2\]/g, '<h2>$1</h2>');
  escaped = escaped.replace(/\n/g, '<br/>');

  return `<div style="color:${baseColor};font-weight:${
    isBold || isHeading ? '700' : '400'
  };font-style:${isItalic ? 'italic' : 'normal'};font-size:${
    isHeading ? '1.1rem' : '0.92rem'
  };line-height:1.6;">${escaped}</div>`;
}

function getRelativeTime(dateString: string): string {
  try {
    const now = Date.now();
    const past = new Date(dateString).getTime();
    if (Number.isNaN(past)) return '';
    const diffSec = Math.floor((now - past) / 1000);

    if (diffSec < 60) return 'az önce';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} saat önce`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay} gün önce`;
    const diffWeek = Math.floor(diffDay / 7);
    if (diffWeek < 4) return `${diffWeek} hafta önce`;
    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth} ay önce`;
    return `${Math.floor(diffDay / 365)} yıl önce`;
  } catch {
    return '';
  }
}

interface RichCommentSectionProps {
  targetType: 'media' | 'episode' | 'person' | 'magazine';
  mediaId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  personId?: number;
  magazineId?: number;
  targetTitle: string;
}

export default function RichCommentSection({
  targetType,
  mediaId,
  seasonNumber,
  episodeNumber,
  personId,
  magazineId,
  targetTitle,
}: RichCommentSectionProps) {
  const {
    user,
    setIsAuthModalOpen,
    openAuthModal,
    pushNotification,
    isSoftBanned,
    isUserBlocked,
    isBlockedBy,
    confirmDialog,
  } = useKoUp();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingComments, setIsLoadingComments] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  // Form State
  const [selectedColor, setSelectedColor] = useState('#FFFFFF');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isHeading, setIsHeading] = useState(false);
  const [hasSpoiler, setHasSpoiler] = useState(false);
  const [timestampInput, setTimestampInput] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [showImageInput, setShowImageInput] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [selectedGif, setSelectedGif] = useState<string | null>(null);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifSearchResults, setGifSearchResults] = useState<
    Array<{ id: string; title: string; url: string; previewUrl: string }>
  >([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  // Dynamic Giphy search effect with debouncing & cache
  useEffect(() => {
    if (!showGifPicker) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearchingGifs(true);
      try {
        const q = gifSearchQuery.trim();
        const endpoint = `/api/gifs/search?q=${encodeURIComponent(q || 'trending')}&limit=16`;
        const res = await fetch(endpoint);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data?.gifs)) {
            setGifSearchResults(data.gifs);
          }
        }
      } catch {
      } finally {
        if (!cancelled) setIsSearchingGifs(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showGifPicker, gifSearchQuery]);

  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});
  const [likingId, setLikingId] = useState<string | null>(null);

  // Dislike tracking with Supabase persistence
  const [dislikedIds, setDislikedIds] = useState<Record<string, boolean>>({});

  const getDislikeCount = useCallback(
    (c: CommentRow) => c.dislikes_count ?? c.content_json?.dislikes_count ?? 0,
    []
  );

  // Custom Report Modal State (No window.prompt)
  const [reportingComment, setReportingComment] = useState<CommentRow | null>(null);
  const [reportCategory, setReportCategory] = useState<string>('Spoiler / İpuçları İçeriyor');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportCooldownSec, setReportCooldownSec] = useState<number>(0);

  // Issue report rate-limit cooldown tracker
  useEffect(() => {
    try {
      const lastReport = Number(localStorage.getItem('koup_last_issue_report_time') || 0);
      const diff = Math.ceil((60_000 - (Date.now() - lastReport)) / 1000);
      if (diff > 0) setReportCooldownSec(diff);
    } catch {}
  }, []);

  useEffect(() => {
    if (reportCooldownSec <= 0) return;
    const timer = setInterval(() => {
      setReportCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [reportCooldownSec]);

  // Inline Reply state (render reply box directly beneath comment)
  const [inlineReplyId, setInlineReplyId] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [inlineReplySpoiler, setInlineReplySpoiler] = useState(false);
  const [isSubmittingInline, setIsSubmittingInline] = useState(false);

  // Anti-spam / Cooldown / Double Click Protection
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownSec, setCooldownSec] = useState<number>(0);
  const lastCommentTextRef = useRef<string>('');

  const editorRef = useRef<HTMLDivElement>(null);
  const [hasText, setHasText] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const savedSelectionRef = useRef<Range | null>(null);

  // Rate-limiting cooldown countdown
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownSec]);

  // Anti-abuse & Rate Limit validator
  const checkCommentRateLimit = useCallback(
    (text: string): string | null => {
      const clean = text.trim();
      if (clean.length < 2) return 'Yorumunuz çok kısa (en az 2 karakter olmalıdır).';
      if (clean.length > 1200) return 'Yorumunuz çok uzun (en fazla 1200 karakter olabilir).';
      if (lastCommentTextRef.current && clean === lastCommentTextRef.current) {
        return 'Aynı yorumu arka arkaya gönderemezsiniz.';
      }

      const now = Date.now();
      try {
        const raw = localStorage.getItem('koup_comment_history_v1');
        const history: number[] = raw ? JSON.parse(raw) : [];
        const valid = history.filter((timestamp: number) => now - timestamp < 3600_000);
        if (valid.length >= 15) {
          return 'Saatlik yorum sınırına ulaştınız (15 yorum/saat). Lütfen daha sonra tekrar deneyin.';
        }
      } catch {}
      return null;
    },
    []
  );

  const recordCommentPost = useCallback((text: string) => {
    lastCommentTextRef.current = text.trim();
    setCooldownSec(30);
    const now = Date.now();
    try {
      const raw = localStorage.getItem('koup_comment_history_v1');
      const history: number[] = raw ? JSON.parse(raw) : [];
      const valid = history.filter((timestamp: number) => now - timestamp < 3600_000);
      valid.push(now);
      localStorage.setItem('koup_comment_history_v1', JSON.stringify(valid));
    } catch {}
  }, []);

  // Load user's likes from DB
  useEffect(() => {
    if (!user?.id) {
      setLikedIds({});
      return;
    }
    async function loadLikes() {
      try {
        const { data } = await supabase
          .from('comment_likes')
          .select('comment_id')
          .eq('user_id', user!.id);
        if (data) {
          const map: Record<string, boolean> = {};
          data.forEach((r) => {
            map[r.comment_id] = true;
          });
          setLikedIds(map);
        }
      } catch {}
    }
    loadLikes();
  }, [user?.id]);

  // Load user's dislikes from DB
  useEffect(() => {
    if (!user?.id) {
      setDislikedIds({});
      return;
    }
    async function loadDislikes() {
      try {
        const { data } = await supabase
          .from('comment_dislikes')
          .select('comment_id')
          .eq('user_id', user!.id);
        if (data) {
          const map: Record<string, boolean> = {};
          data.forEach((r) => {
            map[r.comment_id] = true;
          });
          setDislikedIds(map);
        }
      } catch {}
    }
    loadDislikes();
  }, [user?.id]);

  // Load comments with pagination
  const loadComments = useCallback(
    async (pageToLoad = 1) => {
      if (pageToLoad === 1) setIsLoadingComments(true);
      else setIsLoadingMore(true);

      try {
        let query = supabase
          .from('comments')
          .select('*, profiles:user_id(id, username, display_name, avatar_url, role)', {
            count: 'exact',
          })
          .eq('target_type', targetType)
          .order('created_at', { ascending: false })
          .range((pageToLoad - 1) * PAGE_SIZE, pageToLoad * PAGE_SIZE - 1);

        if (mediaId) {
          query = query.eq('media_id', mediaId);
          if (targetType === 'episode') {
            if (seasonNumber !== undefined && seasonNumber !== null) {
              query = query.eq('season_number', seasonNumber);
            }
            if (episodeNumber !== undefined && episodeNumber !== null) {
              query = query.eq('episode_number', episodeNumber);
            }
          }
        }
        if (personId) query = query.eq('person_id', personId);
        if (magazineId) query = query.eq('magazine_id', magazineId);

        const { data, count, error } = await query;
        if (error) {
          console.error('Error fetching comments:', error);
          return;
        }

        const rows = (data as CommentRow[]) || [];
        setTotalCount(count || 0);
        setHasMore(Boolean(count && pageToLoad * PAGE_SIZE < count));
        setCurrentPage(pageToLoad);

        if (pageToLoad === 1) {
          setComments(rows);
        } else {
          setComments((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            const fresh = rows.filter((r) => !seen.has(r.id));
            return [...prev, ...fresh];
          });
        }
      } finally {
        setIsLoadingComments(false);
        setIsLoadingMore(false);
      }
    },
    [targetType, mediaId, seasonNumber, episodeNumber, personId, magazineId]
  );

  useEffect(() => {
    loadComments(1);
  }, [loadComments]);

  // Auto-scroll to target comment if URL hash (#comment-XYZ) or search param (?comment_id=XYZ) is present
  useEffect(() => {
    if (isLoadingComments || comments.length === 0) return;
    if (typeof window === 'undefined') return;

    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    const targetCommentId =
      urlParams.get('comment_id') ||
      urlParams.get('comment') ||
      (hash.startsWith('#comment-') ? hash.replace('#comment-', '') : null);

    if (targetCommentId) {
      const scrollTimer = setTimeout(() => {
        const el = document.getElementById(`comment-${targetCommentId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-sky-400', 'shadow-[0_0_25px_rgba(56,189,248,0.5)]');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-sky-400', 'shadow-[0_0_25px_rgba(56,189,248,0.5)]');
          }, 3500);
        }
      }, 350);
      return () => clearTimeout(scrollTimer);
    }
  }, [isLoadingComments, comments]);

  const saveSelection = useCallback(() => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const editor = editorRef.current;
      if (
        editor &&
        (editor === range.commonAncestorContainer || editor.contains(range.commonAncestorContainer))
      ) {
        savedSelectionRef.current = range.cloneRange();
        return;
      }
    }
  }, []);

  const restoreSelection = useCallback(() => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (!sel) return;

    const editor = editorRef.current;
    if (!editor) return;

    // If there is already an active non-collapsed selection inside the editor, keep it
    if (sel.rangeCount > 0 && !sel.isCollapsed) {
      const activeRange = sel.getRangeAt(0);
      if (
        editor === activeRange.commonAncestorContainer ||
        editor.contains(activeRange.commonAncestorContainer)
      ) {
        return;
      }
    }

    if (savedSelectionRef.current) {
      try {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      } catch {}
    }
  }, []);

  const updateActiveFormats = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.anchorNode;
        let inH2 = false;
        let inExplicitBold = false;
        let inExplicitItalic = false;

        while (node && node !== editorRef.current) {
          const tag = node.nodeName;
          if (tag === 'H2') {
            inH2 = true;
          } else if (tag === 'B' || tag === 'STRONG') {
            inExplicitBold = true;
          } else if (tag === 'I' || tag === 'EM') {
            inExplicitItalic = true;
          } else if (node instanceof HTMLElement) {
            const fw = node.style?.fontWeight;
            if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900') {
              inExplicitBold = true;
            }
            if (node.style?.fontStyle === 'italic') {
              inExplicitItalic = true;
            }
          }
          node = node.parentNode;
        }

        setIsHeading(inH2);
        // Only use queryCommandState('bold') when NOT inside H2 (since browsers report H2 as bold!)
        setIsBold(inH2 ? inExplicitBold : (inExplicitBold || document.queryCommandState('bold')));
        setIsItalic(inExplicitItalic || document.queryCommandState('italic'));
      }
    } catch {}
  }, []);

  const handleEditorInput = useCallback(() => {
    if (!editorRef.current) return;
    const text =
      editorRef.current.innerText ||
      editorRef.current.textContent ||
      editorRef.current.innerHTML?.replace(/<[^>]*>/g, '') ||
      '';
    const clean = text.replace(/[\u200B\u00A0\r\n\t ]/g, '');
    setHasText(clean.length > 0);
    setCharCount(text.trim().length);
    saveSelection();
    updateActiveFormats();
  }, [saveSelection, updateActiveFormats]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.anchorNode;
        let inH2 = false;
        let h2Node: HTMLElement | null = null;
        while (node && node !== editorRef.current) {
          if (node.nodeName === 'H2') {
            inH2 = true;
            h2Node = node as HTMLElement;
            break;
          }
          node = node.parentNode;
        }

        if (inH2 && h2Node) {
          e.preventDefault();
          const newDiv = document.createElement('div');
          newDiv.innerHTML = '<br>';
          if (h2Node.nextSibling) {
            h2Node.parentNode?.insertBefore(newDiv, h2Node.nextSibling);
          } else {
            h2Node.parentNode?.appendChild(newDiv);
          }
          const newRange = document.createRange();
          newRange.setStart(newDiv, 0);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          setIsHeading(false);
          saveSelection();
          handleEditorInput();
          return;
        }
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleEditorInput();
  };

  const handleColorSelect = (hex: string) => {
    setSelectedColor(hex);
    const editor = editorRef.current;
    if (!editor) return;

    if (typeof document !== 'undefined' && document.activeElement !== editor) {
      editor.focus();
    }
    restoreSelection();

    const sel = window.getSelection();
    const hasSelection = Boolean(
      sel &&
        sel.rangeCount > 0 &&
        !sel.isCollapsed &&
        (editor === sel.getRangeAt(0).commonAncestorContainer ||
          editor.contains(sel.getRangeAt(0).commonAncestorContainer))
    );

    if (hasSelection && sel) {
      const range = sel.getRangeAt(0);
      try {
        // Direct DOM Range wrapping: guarantees exact selection is colored without touching other text
        const span = document.createElement('span');
        span.style.color = hex;

        const fragment = range.extractContents();
        // Remove nested colors inside the extracted slice so the chosen color cleanly takes precedence
        if (fragment.querySelectorAll) {
          fragment.querySelectorAll('[style*="color"]').forEach((el) => {
            (el as HTMLElement).style.color = '';
          });
        }

        span.appendChild(fragment);
        range.insertNode(span);

        // Keep selection around the newly colored text
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(newRange);
        savedSelectionRef.current = newRange.cloneRange();
      } catch {
        // Fallback to execCommand if range manipulation fails
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('foreColor', false, hex);
      }

      handleEditorInput();
      updateActiveFormats();
      pushNotification('Metin Rengi Uygulandı', 'Seçili metin renklendirildi.', 'info');
    } else {
      // No text selected: set foreColor for subsequent typing at cursor
      editor.focus();
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, hex);
    }
  };

  const handleBoldToggle = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document !== 'undefined' && document.activeElement !== editor) {
      editor.focus();
    }
    restoreSelection();

    const nextBold = !isBold;
    try {
      document.execCommand('bold', false);
    } catch {}
    setIsBold(nextBold);
    saveSelection();
    const text = editor.innerText || '';
    const clean = text.replace(/[\u200B\r\n\t ]/g, '');
    setHasText(clean.length > 0);
    setCharCount(text.trim().length);
  };

  const handleItalicToggle = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document !== 'undefined' && document.activeElement !== editor) {
      editor.focus();
    }
    restoreSelection();

    const nextItalic = !isItalic;
    try {
      document.execCommand('italic', false);
    } catch {}
    setIsItalic(nextItalic);
    saveSelection();
    const text = editor.innerText || '';
    const clean = text.replace(/[\u200B\r\n\t ]/g, '');
    setHasText(clean.length > 0);
    setCharCount(text.trim().length);
  };

  const handleHeadingToggle = () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document !== 'undefined' && document.activeElement !== editor) {
      editor.focus();
    }
    restoreSelection();

    const sel = window.getSelection();
    let inH2 = isHeading;
    let h2Node: HTMLElement | null = null;
    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.anchorNode;
      while (node && node !== editor) {
        if (node.nodeName === 'H2') {
          inH2 = true;
          h2Node = node as HTMLElement;
          break;
        }
        node = node.parentNode;
      }
    }

    if (inH2) {
      try {
        document.execCommand('formatBlock', false, '<div>');
      } catch {
        if (h2Node) {
          const div = document.createElement('div');
          div.innerHTML = h2Node.innerHTML;
          h2Node.parentNode?.replaceChild(div, h2Node);
        }
      }
      setIsHeading(false);
    } else {
      try {
        document.execCommand('formatBlock', false, '<h2>');
      } catch {
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const h2 = document.createElement('h2');
          h2.appendChild(range.extractContents());
          range.insertNode(h2);
        }
      }
      setIsHeading(true);
    }

    saveSelection();
    const text = editor.innerText || '';
    const clean = text.replace(/[\u200B\r\n\t ]/g, '');
    setHasText(clean.length > 0);
    setCharCount(text.trim().length);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    if (cooldownSec > 0) {
      pushNotification(
        'Hızlı İşlem Engellendi',
        `Yeni bir yorum göndermek için lütfen ${cooldownSec} saniye bekleyin.`,
        'info'
      );
      return;
    }

    const rawText = (
      editorRef.current?.innerText ||
      editorRef.current?.textContent ||
      editorRef.current?.innerHTML?.replace(/<[^>]*>/g, '') ||
      ''
    )
      .replace(/[\u200B\u00A0]/g, ' ')
      .trim();

    if (!rawText && !selectedGif && !selectedSticker) {
      pushNotification('Eksik Bilgi', 'Lütfen bir yorum yazın.', 'info');
      editorRef.current?.focus();
      return;
    }

    if (rawText) {
      const limitErr = checkCommentRateLimit(rawText);
      if (limitErr) {
        pushNotification('İşlem Sınırlandırıldı', limitErr, 'info');
        return;
      }
    }

    if (isSubmitting) return;

    let safeImageUrl: string | null = null;
    if (imageUrlInput.trim()) {
      if (!imageUrlInput.trim().startsWith('https://')) {
        pushNotification(
          'Güvenlik Uyarısı',
          'Yalnızca güvenli HTTPS görsel bağlantıları kabul edilir.',
          'info'
        );
        return;
      }
      safeImageUrl = imageUrlInput.trim();
    }

    let tsSec: number | null = null;
    if (timestampInput.trim()) {
      const parts = timestampInput.trim().split(':').map(Number);
      if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
        tsSec = parts[0] * 60 + parts[1];
      }
    }

    const rawHtml = editorRef.current?.innerHTML || '';
    let formattedHtml = sanitizeHtml(rawHtml);
    if (selectedColor && selectedColor !== '#FFFFFF' && !formattedHtml.includes('style="color:')) {
      formattedHtml = `<div style="color:${selectedColor};line-height:1.6;">${formattedHtml}</div>`;
    }

    // Validate real Supabase session
    const { data: sessionData } = await supabase.auth.getSession();
    const realUid = sessionData?.session?.user?.id || user.id;

    if (!realUid) {
      pushNotification(
        'Oturum Hatası',
        'Kullanıcı kimliği doğrulanamadı. Lütfen tekrar giriş yapın.',
        'info'
      );
      setIsAuthModalOpen(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const insertPayload = {
        user_id: realUid,
        target_type: targetType,
        media_id: mediaId || null,
        season_number: seasonNumber || null,
        episode_number: episodeNumber || null,
        person_id: personId || null,
        magazine_id: magazineId || null,
        parent_id: replyTo?.id || null,
        author_username: user.display_name || user.username || 'KoUp Üyesi',
        author_avatar: user.avatar_url || null,
        title: null,
        content_html: formattedHtml,
        content_json: {
          raw: rawText,
          html: formattedHtml,
          color: selectedColor,
          isBold,
          isItalic,
          isHeading,
        },
        has_spoiler: hasSpoiler,
        timestamp_sec: tsSec,
        gif_url: selectedGif || null,
        sticker_id: selectedSticker || null,
        image_url: safeImageUrl || null,
      };

      const { data: createdRow, error } = await supabase
        .from('comments')
        .insert(insertPayload)
        .select('*, profiles:user_id(id, username, display_name, avatar_url, role)')
        .single();

      if (error) {
        pushNotification(
          'Yorum Gönderilemedi',
          error.message || 'Yetkilendirme veya sunucu hatası oluştu.',
          'info'
        );
        return;
      }

      const freshComment = createdRow as CommentRow;
      if (replyTo) {
        setComments((prev) => [...prev, freshComment]);
      } else {
        setComments((prev) => [freshComment, ...prev]);
      }
      setTotalCount((c) => c + 1);
      invalidateCache('comments');

      // Start anti-abuse 30s cooldown and update rate limit history
      recordCommentPost(rawText || 'medya');

      // Reset form fields
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      setHasText(false);
      setCharCount(0);
      setSelectedColor('#FFFFFF');
      setIsBold(false);
      setIsItalic(false);
      setIsHeading(false);
      setHasSpoiler(false);
      setTimestampInput('');
      setImageUrlInput('');
      setSelectedGif(null);
      setSelectedSticker(null);
      setReplyTo(null);
      setShowImageInput(false);
      setShowGifPicker(false);
      setShowStickerPicker(false);
    } catch (err: any) {
      pushNotification(
        'Bağlantı Hatası',
        err?.message || 'Yorum iletilirken bir sorun meydana geldi.',
        'info'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (c: CommentRow) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    const isAdmin = user.role === 'admin' || user.role === 'editor';
    if (!isAdmin) {
      pushNotification(
        'Topluluk Kuralı',
        'Topluluk kuralları gereği gönderilen yorumlar silinemez veya düzenlenemez.',
        'info'
      );
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Yorumu Sil (Yönetici)',
      message: 'Bu yorumu yönetici yetkisiyle kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.',
      confirmText: 'Yorumu Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('comments').delete().eq('id', c.id);
      if (error) {
        pushNotification('Silme Hatası', error.message || 'Yorum silinemedi.', 'info');
        return;
      }

      setComments((prev) => prev.filter((item) => item.id !== c.id));
      setTotalCount((n) => Math.max(0, n - 1));
      invalidateCache('comments');
      pushNotification('Yorum Silindi', 'Topluluk yorumunuz kaldırıldı.', 'info');
    } catch (err: any) {
      pushNotification('Hata', err?.message || 'İşlem gerçekleştirilemedi.', 'info');
    }
  };

  const toggleLike = async (c: CommentRow) => {
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

    if (likingId === c.id) return;
    setLikingId(c.id);

    const wasLiked = Boolean(likedIds[c.id]);
    const delta = wasLiked ? -1 : 1;

    // Optimistic UI update for Like
    setLikedIds((prev) => ({ ...prev, [c.id]: !wasLiked }));
    setComments((prev) =>
      prev.map((item) =>
        item.id === c.id
          ? { ...item, likes_count: Math.max(0, item.likes_count + delta) }
          : item
      )
    );

    // Mutual exclusivity: If turning like ON, clear dislike if active
    if (!wasLiked && dislikedIds[c.id]) {
      setDislikedIds((prev) => ({ ...prev, [c.id]: false }));
      setComments((prev) =>
        prev.map((item) =>
          item.id === c.id
            ? { ...item, dislikes_count: Math.max(0, (item.dislikes_count || 0) - 1) }
            : item
        )
      );
      void supabase
        .from('comment_dislikes')
        .delete()
        .match({ user_id: user.id, comment_id: c.id });
    }

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from('comment_likes')
          .delete()
          .match({ user_id: user.id, comment_id: c.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('comment_likes')
          .insert({ user_id: user.id, comment_id: c.id });
        if (error) throw error;
      }
    } catch (err: any) {
      // Rollback on error
      setLikedIds((prev) => ({ ...prev, [c.id]: wasLiked }));
      setComments((prev) =>
        prev.map((item) =>
          item.id === c.id
            ? { ...item, likes_count: Math.max(0, item.likes_count - delta) }
            : item
        )
      );
      pushNotification('Beğeni İletilemedi', err?.message || 'Lütfen tekrar deneyin.', 'info');
    } finally {
      setLikingId(null);
    }
  };

  const handleSeekScene = (sec: number) => {
    window.dispatchEvent(
      new CustomEvent('koup-seek-player', {
        detail: { time: sec },
      })
    );
    pushNotification(
      'Sahneye Atlandı',
      `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} sahnesine gidildi.`,
      'info'
    );
  };

  const handleDislike = async (c: CommentRow) => {
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

    const wasDisliked = Boolean(dislikedIds[c.id]);
    const delta = wasDisliked ? -1 : 1;

    // Toggle dislike in local state and optimistically update comment count
    setDislikedIds((prev) => ({ ...prev, [c.id]: !wasDisliked }));
    setComments((prev) =>
      prev.map((item) =>
        item.id === c.id
          ? { ...item, dislikes_count: Math.max(0, (item.dislikes_count || 0) + delta) }
          : item
      )
    );

    // Mutual exclusivity: If turning dislike ON and comment was liked, remove like
    if (!wasDisliked && likedIds[c.id]) {
      setLikedIds((prev) => ({ ...prev, [c.id]: false }));
      setComments((prev) =>
        prev.map((item) =>
          item.id === c.id
            ? { ...item, likes_count: Math.max(0, item.likes_count - 1) }
            : item
        )
      );
      void supabase
        .from('comment_likes')
        .delete()
        .match({ user_id: user.id, comment_id: c.id });
    }

    try {
      if (wasDisliked) {
        const { error } = await supabase
          .from('comment_dislikes')
          .delete()
          .match({ user_id: user.id, comment_id: c.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('comment_dislikes')
          .insert({ user_id: user.id, comment_id: c.id });
        if (error) throw error;
      }
    } catch (err: any) {
      // Rollback on error
      setDislikedIds((prev) => ({ ...prev, [c.id]: wasDisliked }));
      setComments((prev) =>
        prev.map((item) =>
          item.id === c.id
            ? { ...item, dislikes_count: Math.max(0, (item.dislikes_count || 0) - delta) }
            : item
        )
      );
      pushNotification('Hata', err?.message || 'İşlem gerçekleştirilemedi.', 'info');
    }
  };

  // Custom in-app Report Modal handlers (Replaces window.prompt)
  const handleOpenReportModal = (c: CommentRow) => {
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
    setReportingComment(c);
    setReportCategory('Spoiler / İpuçları İçeriyor');
    setReportDetails('');
  };

  const handleSubmitReport = async () => {
    if (!reportingComment || !user) return;

    if (reportCooldownSec > 0) {
      pushNotification(
        'İşlem Sınırı',
        `Peş peşe bildirim gönderemezsiniz. Lütfen ${reportCooldownSec} saniye bekleyin.`,
        'info'
      );
      return;
    }

    setIsSubmittingReport(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id || user.id;

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporter_id: uid,
          target_type: 'comment',
          media_id: mediaId || null,
          season_number: seasonNumber || null,
          episode_number: episodeNumber || null,
          issue_category: reportCategory,
          details: `Yorum ID: ${reportingComment.id} - Yazar: ${reportingComment.author_username || 'Bilinmiyor'} - Kategori: ${reportCategory}${reportDetails ? ` - Detay: ${reportDetails.trim()}` : ''}`,
        }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) {
          const cd = Number(payload.cooldownRemaining) || 60;
          setReportCooldownSec(cd);
          try {
            localStorage.setItem('koup_last_issue_report_time', String(Date.now() - (60 - cd) * 1000));
          } catch {}
          pushNotification('Bildirim Limiti', payload.error || 'Lütfen bekleyin.', 'info');
        } else {
          pushNotification('Hata', payload.error || 'Bildirim kaydedilemedi.', 'info');
        }
        return;
      }

      // Success: Save cooldown
      try {
        localStorage.setItem('koup_last_issue_report_time', String(Date.now()));
      } catch {}
      setReportCooldownSec(60);

      pushNotification('Bildirim Alındı', 'Yorum incelenmek üzere moderatör ekibine iletildi.', 'info');
      setReportingComment(null);
      setReportDetails('');
    } catch {
      pushNotification('Bildirim', 'Sunucuya ulaşılamadı, lütfen daha sonra tekrar deneyin.', 'info');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleCopyLink = (commentId: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const link = `${origin}${pathname}#comment-${commentId}`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        pushNotification('Bağlantı Kopyalandı', 'Yorum bağlantısı panoya kopyalandı.', 'success');
      }).catch(() => {
        pushNotification('Bağlantı', link, 'info');
      });
    } else {
      pushNotification('Bağlantı', link, 'info');
    }
  };

  const handleOpenInlineReply = (c: CommentRow) => {
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
    const targetUsername = c.profiles?.username || c.author_username || 'kullanici';
    if (inlineReplyId === c.id) {
      setInlineReplyId(null);
      setInlineReplyText('');
      setInlineReplySpoiler(false);
    } else {
      setInlineReplyId(c.id);
      setInlineReplyText('');
      setInlineReplySpoiler(false);
    }
  };

  const handleSubmitInlineReply = async (parentComment: CommentRow) => {
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
    if (cooldownSec > 0) {
      pushNotification(
        'Hızlı İşlem Engellendi',
        `Yeni bir yanıt göndermek için lütfen ${cooldownSec} saniye bekleyin.`,
        'info'
      );
      return;
    }
    if (!inlineReplyText.trim()) return;

    const limitErr = checkCommentRateLimit(inlineReplyText);
    if (limitErr) {
      pushNotification('İşlem Sınırlandırıldı', limitErr, 'info');
      return;
    }

    if (isSubmittingInline) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const realUid = sessionData?.session?.user?.id || user.id;

    setIsSubmittingInline(true);
    try {
      const formattedHtml = parseCommentTextToHtml(
        inlineReplyText,
        '#FFFFFF',
        false,
        false,
        false
      );

      const insertPayload = {
        user_id: realUid,
        target_type: targetType,
        media_id: mediaId || null,
        season_number: seasonNumber || null,
        episode_number: episodeNumber || null,
        person_id: personId || null,
        magazine_id: magazineId || null,
        parent_id: parentComment.id,
        author_username: user.display_name || user.username || 'KoUp Üyesi',
        author_avatar: user.avatar_url || null,
        title: null,
        content_html: formattedHtml,
        content_json: {
          raw: inlineReplyText,
          color: '#FFFFFF',
          isBold: false,
          isItalic: false,
          isHeading: false,
        },
        has_spoiler: inlineReplySpoiler,
        likes_count: 0,
      };

      const { data: createdRow, error } = await supabase
        .from('comments')
        .insert(insertPayload)
        .select('*, profiles:user_id(id, username, display_name, avatar_url, role)')
        .single();

      if (error) {
        pushNotification('Yanıt Gönderilemedi', error.message || 'Hata oluştu', 'info');
        return;
      }

      const freshComment = createdRow as CommentRow;
      setComments((prev) => [...prev, freshComment]);
      setTotalCount((c) => c + 1);
      invalidateCache('comments');
      setInlineReplyId(null);
      setInlineReplyText('');
      setInlineReplySpoiler(false);
      recordCommentPost(inlineReplyText);
    } catch (err: any) {
      pushNotification('Hata', err?.message || 'Yanıt iletilemedi', 'info');
    } finally {
      setIsSubmittingInline(false);
    }
  };

  // Build comments map
  const commentMap = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);

  // Recursively find top-level root comment ID for replies
  const getRootCommentId = useCallback(
    (commentId: string): string => {
      let curr = commentMap.get(commentId);
      const visited = new Set<string>();
      while (curr && curr.parent_id && !visited.has(curr.id)) {
        visited.add(curr.id);
        const parent = commentMap.get(curr.parent_id);
        if (!parent) break;
        curr = parent;
      }
      return curr ? curr.id : commentId;
    },
    [commentMap]
  );

  // Separate roots from replies and group replies under their respective root
  const { rootComments, repliesByRoot } = useMemo(() => {
    const roots: CommentRow[] = [];
    const repliesMap: Record<string, CommentRow[]> = {};

    comments.forEach((c) => {
      if (!c.parent_id) {
        roots.push(c);
      } else {
        const rootId = getRootCommentId(c.parent_id);
        if (commentMap.has(rootId)) {
          if (!repliesMap[rootId]) repliesMap[rootId] = [];
          repliesMap[rootId].push(c);
        } else {
          // If parent is not found (e.g. deleted or outside page), promote to root
          roots.push(c);
        }
      }
    });

    // Sort replies chronologically (oldest first) so conversational flow is natural
    Object.keys(repliesMap).forEach((rId) => {
      repliesMap[rId].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });

    return { rootComments: roots, repliesByRoot: repliesMap };
  }, [comments, getRootCommentId, commentMap]);

  const renderCommentCard = (c: CommentRow, isReply: boolean = false) => {
    // Moderation Check
    const isHiddenByModeration =
      c.is_hidden === true ||
      c.is_deleted === true ||
      c.status === 'hidden' ||
      c.status === 'deleted' ||
      c.status === 'rejected' ||
      (c.is_approved !== undefined && c.is_approved === false);

    const isAuthor = Boolean(user?.id && c.user_id === user.id);
    const isAdmin = Boolean(user?.role === 'admin' || user?.role === 'editor');

    // If comment is moderated and viewer is neither owner nor admin, do not render
    if (isHiddenByModeration && !isAuthor && !isAdmin) {
      return null;
    }

    // Bidirectional Block Filter:
    // 1. If the viewer has blocked this comment's author -> hide
    // 2. If this comment's author has blocked the viewer -> hide
    if (isUserBlocked(c.user_id) || isBlockedBy(c.user_id)) {
      return null;
    }

    const isSpoilerHidden = c.has_spoiler && !revealedSpoilers[c.id];

    const canDelete = isAdmin;
    const isEditedFlag = c.content_json?.is_edited;

    const authorName =
      c.profiles?.display_name ||
      c.profiles?.username ||
      c.author_username ||
      'KoUp Üyesi';
    const authorUsername =
      c.profiles?.username ||
      c.author_username ||
      authorName;
    const authorAvatar = c.profiles?.avatar_url || c.author_avatar;
    const isAuthorAdmin = c.profiles?.role === 'admin' || c.profiles?.role === 'editor';
    const profileUrl = `/profil/${encodeURIComponent(authorUsername)}`;
    const parentComment = c.parent_id ? commentMap.get(c.parent_id) : null;
    const parentAuthorName = parentComment
      ? parentComment.profiles?.display_name ||
        parentComment.profiles?.username ||
        parentComment.author_username ||
        'Kullanıcı'
      : null;

    return (
      <div
        key={c.id}
        id={`comment-${c.id}`}
        className={`rounded-2xl border transition-all max-w-full overflow-hidden break-words ${
          isReply
            ? 'p-3 sm:p-4 bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
            : 'p-3.5 sm:p-5 bg-white/[0.03] border-white/[0.08] hover:border-white/[0.14]'
        } ${
          isHiddenByModeration ? 'bg-rose-950/20 border-rose-500/30' : ''
        }`}
      >
        {/* Moderation Alert Banner for Owner/Admin */}
        {isHiddenByModeration && (
          <div className="flex items-center gap-1.5 px-3 py-1 mb-3 rounded-lg bg-rose-500/15 border border-rose-400/30 text-[11px] text-rose-300">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Bu yorum moderasyon tarafından gizlendi. Sadece siz görebiliyorsunuz.</span>
          </div>
        )}

        {/* Main Comment Row: Left Avatar, Right Content */}
        <div className="flex items-start gap-3 sm:gap-3.5">
          {/* Author Avatar (Clickable Link to User Profile) */}
          <Link
            href={profileUrl}
            className="shrink-0 group block mt-0.5"
            aria-label={`${authorName} Profilini Görüntüle`}
          >
            {authorAvatar ? (
              <img
                src={getProxiedImageUrl(authorAvatar, authorName, null, 'w185', 'person')}
                alt={authorName}
                loading="lazy"
                decoding="async"
                className={`${
                  isReply ? 'w-8 h-8' : 'w-10 h-10'
                } rounded-full object-cover border border-white/15 group-hover:border-sky-400 transition-all shadow-md`}
              />
            ) : (
              <div
                className={`${
                  isReply ? 'w-8 h-8' : 'w-10 h-10'
                } rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75 group-hover:border-sky-400 transition-all shadow-md`}
              >
                <User className={isReply ? 'w-4 h-4' : 'w-5 h-5'} />
              </div>
            )}
          </Link>

          {/* Right Column: Header, Body, Action Bar */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Top Header Row: Username + Admin Tag + Relative Time (Strawberry & Milk badges removed) */}
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
              <Link
                href={profileUrl}
                className="text-white font-bold text-sm hover:underline hover:text-sky-300 transition-colors"
              >
                {authorName}
              </Link>

              {/* Admin Badge Only (No emojis) */}
              {isAuthorAdmin && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-[9px] font-mono font-bold text-sky-300 uppercase">
                  Yönetici
                </span>
              )}

              {/* Reply indicator */}
              {isReply && (
                <span className="inline-flex items-center gap-1 text-[11px] text-white/50 font-normal">
                  <Reply className="w-3 h-3 text-sky-400 rotate-180 shrink-0" />
                  <span className="text-white/40">yanıtlanan:</span>
                  <span className="text-sky-300 font-medium">@{parentAuthorName || 'kullanıcı'}</span>
                </span>
              )}

              {/* Functional Timestamp Badge (Seek to Video) */}
              {c.timestamp_sec !== undefined && c.timestamp_sec !== null && (
                <button
                  type="button"
                  onClick={() => handleSeekScene(c.timestamp_sec!)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 hover:bg-sky-500/35 text-sky-300 border border-sky-400/35 font-mono text-[10px] cursor-pointer transition-all hover:border-sky-400/60"
                  aria-label="Tıklayarak doğrudan bu sahneye atla"
                >
                  <Clock className="w-2.5 h-2.5 text-sky-400" />
                  <span>
                    {Math.floor(c.timestamp_sec / 60)}:
                    {String(c.timestamp_sec % 60).padStart(2, '0')}
                  </span>
                </button>
              )}

              {c.sticker_id && (
                <span className="px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-200 text-[10px] font-mono">
                  {c.sticker_id}
                </span>
              )}

              {isEditedFlag && (
                <span className="text-[10px] text-white/40 italic">
                  (düzenlendi)
                </span>
              )}

              {c.is_hidden && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30 text-[10px] font-mono font-bold">
                  Gizlendi
                </span>
              )}

              {/* Relative time */}
              <span className="text-xs text-white/40 select-none">
                {getRelativeTime(c.created_at)}
              </span>
            </div>

            {/* Comment Body */}
            <div className="space-y-2 pt-0.5">
                {c.title && (
                  <h4 className="text-sm font-bold text-white">{c.title}</h4>
                )}

                {isSpoilerHidden ? (
                  <button
                    onClick={() =>
                      setRevealedSpoilers((prev) => ({ ...prev, [c.id]: true }))
                    }
                    className="w-full py-2.5 px-4 rounded-xl bg-rose-950/30 border border-rose-400/30 text-xs text-rose-200 flex items-center justify-center gap-2 cursor-pointer hover:bg-rose-950/50 transition-all"
                  >
                    <EyeOff className="w-4 h-4" />
                    <span>Bu yorum Spoiler içeriyor · Görmek için tıkla</span>
                  </button>
                ) : (
                  <>
                    <div
                      className="text-sm text-white/90 leading-relaxed font-normal break-words comment-content"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtml(c.content_html).replace(
                          /^(\s*<p[^>]*>\s*)?(?:<span[^>]*>)?(@[a-zA-Z0-9_\.\-]+)(?:<\/span>)?(?::|\s|&nbsp;|<br\s*\/?>)*/i,
                          '$1'
                        ),
                      }}
                    />

                    {c.has_spoiler && (
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedSpoilers((prev) => ({ ...prev, [c.id]: false }))
                        }
                        className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 cursor-pointer pt-0.5"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Spoiler içeriği tekrar gizle</span>
                      </button>
                    )}

                    {c.gif_url && (
                      <img
                        src={c.gif_url}
                        alt="Yorum GIF"
                        loading="lazy"
                        className="max-h-44 rounded-xl border border-white/10 object-contain mt-2"
                      />
                    )}

                    {c.image_url && c.image_url.startsWith('https://') && (
                      <img
                        src={getProxiedImageUrl(c.image_url)}
                        alt="Yorum Görseli"
                        loading="lazy"
                        className="max-h-60 rounded-xl border border-white/10 object-contain mt-2"
                      />
                    )}
                  </>
                )}
              </div>

            {/* Action Toolbar Row */}
            <div className="flex items-center flex-wrap gap-1.5 sm:gap-2.5 pt-1 text-white/60 max-w-full">
              {/* Like Button */}
              <button
                type="button"
                onClick={() => toggleLike(c)}
                disabled={likingId === c.id}
                className={`flex items-center gap-1.5 text-xs py-1 px-1.5 rounded-lg transition-colors cursor-pointer ${
                  likedIds[c.id]
                    ? 'text-rose-400 font-bold'
                    : 'hover:text-rose-400'
                }`}
                aria-label="Beğen"
              >
                <Heart
                  className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
                    likedIds[c.id] ? 'fill-rose-500 text-rose-500' : ''
                  }`}
                />
                <span className="font-mono text-xs">{c.likes_count || 0}</span>
              </button>

              {/* Broken Heart / Dislike Button with Counter & Mutual Exclusivity */}
              <button
                type="button"
                onClick={() => handleDislike(c)}
                className={`flex items-center gap-1.5 text-xs py-1 px-1.5 rounded-lg transition-colors cursor-pointer ${
                  dislikedIds[c.id]
                    ? 'text-pink-400 font-bold bg-pink-500/10'
                    : 'text-white/40 hover:text-white/70'
                }`}
                aria-label="Beğenmedim"
              >
                <HeartCrack
                  className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
                    dislikedIds[c.id] ? 'fill-pink-500/20 text-pink-400' : ''
                  }`}
                />
                <span className="font-mono text-xs">{getDislikeCount(c)}</span>
              </button>

              {/* Reply Button */}
              <button
                type="button"
                onClick={() => handleOpenInlineReply(c)}
                className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors cursor-pointer py-1 px-1.5 rounded-lg hover:bg-white/[0.04]"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Yanıt</span>
              </button>

              {/* Custom Report Button (No window.prompt) */}
              <button
                type="button"
                onClick={() => handleOpenReportModal(c)}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-amber-300 transition-colors cursor-pointer py-1 px-1.5 rounded-lg hover:bg-white/[0.04]"
                aria-label="Sorun Bildir"
              >
                <Flag className="w-3.5 h-3.5" />
                <span>Bildir</span>
              </button>

              {/* Copy Link Button */}
              <button
                type="button"
                onClick={() => handleCopyLink(c.id)}
                className="p-1 rounded-lg text-white/40 hover:text-sky-300 transition-colors cursor-pointer hover:bg-white/[0.04]"
                aria-label="Yorum Bağlantısını Kopyala"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>

              {/* Delete Button (if author or admin) */}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDeleteComment(c)}
                  className="p-1 rounded-lg text-white/35 hover:text-rose-400 transition-colors cursor-pointer hover:bg-white/[0.04]"
                  aria-label="Yorumu Sil"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Inline Reply Box */}
            {inlineReplyId === c.id && (
              <div className="mt-3.5 pt-3 border-t border-white/[0.08] flex items-start gap-3">
                {/* Current user's avatar */}
                <div className="shrink-0 pt-0.5">
                  {user?.avatar_url ? (
                    <img
                      src={getProxiedImageUrl(user.avatar_url, user.display_name || user.username, null, 'w185', 'person')}
                      alt={user.display_name || user.username || 'Ben'}
                      loading="lazy"
                      decoding="async"
                      className="w-9 h-9 rounded-full object-cover border border-white/15"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/70">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>

                {/* Right: Textarea container, spoiler checkbox, Send button */}
                <div className="flex-1 space-y-2.5">
                  <div className="bg-[#0b0b0e]/90 backdrop-blur-xl border border-white/12 hover:border-white/25 rounded-2xl p-3.5 focus-within:border-sky-400/60 focus-within:ring-2 focus-within:ring-sky-400/20 focus-within:shadow-[0_0_16px_rgba(56,189,248,0.20)] transition-all">
                    <textarea
                      rows={2}
                      value={inlineReplyText}
                      onChange={(e) => setInlineReplyText(e.target.value)}
                      placeholder={`@${authorUsername} kullanıcısına yanıt yaz...`}
                      className="w-full bg-transparent text-white text-sm focus:outline-none resize-none placeholder-white/35 leading-relaxed"
                      autoFocus
                    />
                  </div>

                  {/* Spoiler Notice Checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-white/60 hover:text-white/80 select-none">
                    <input
                      type="checkbox"
                      checked={inlineReplySpoiler}
                      onChange={(e) => setInlineReplySpoiler(e.target.checked)}
                      className="rounded border-white/20 bg-white/5 text-sky-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer accent-[#2997ff]"
                    />
                    <span>Yorumunuz spoiler içeriyorsa mutlaka işaretleyin aksi halde kısıtlanabilirsiniz.</span>
                  </label>

                  {/* Send & Cancel buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isSubmittingInline || !inlineReplyText.trim()}
                      onClick={() => handleSubmitInlineReply(c)}
                      className={`inline-flex items-center gap-2 px-5 py-2 rounded-2xl text-xs font-bold transition-all shadow-md cursor-pointer ${
                        isSubmittingInline || !inlineReplyText.trim()
                          ? 'bg-white/10 text-white/40 cursor-not-allowed'
                          : 'bg-[#2997ff] hover:bg-sky-400 text-white glow-blue'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSubmittingInline ? 'Gönderiliyor...' : 'Gönder'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInlineReplyId(null)}
                      className="px-4 py-2 rounded-2xl text-xs text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      Vazgeç
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="mt-10 rounded-3xl apple-glass p-4 sm:p-8 border border-white/10 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-5 border-b border-white/10">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-white">
            <span>Yorumlar ({totalCount})</span>
          </h3>
          <p className="text-xs text-white/55 mt-0.5">
            {targetTitle} hakkında düşüncelerini, teorilerini ve sahne analizlerini paylaş.
          </p>
        </div>
      </div>

      {/* KoUp Community Rules Warning Banner */}
      <div className="mb-6 p-3.5 sm:p-4 rounded-2xl bg-amber-500/10 border border-amber-400/25 flex items-start gap-3 text-amber-200/90 text-xs leading-relaxed">
        <ShieldAlert className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0 mt-0.5" />
        <p>
          <strong className="font-semibold text-amber-300">KoUp Topluluk Kuralları:</strong>{' '}
          Aşırı küfür, hakaret ve nefret söylemi kesinlikle yasaktır. Tartışmalar saygı çerçevesinde yürütülmelidir. 
          Gönderilen yorumlar sonradan düzenlenemez veya silinemez; lütfen paylaşmadan önce içeriğinizi kontrol ediniz. 
          Kural ihlali durumunda hesap veya cihaz düzeyinde kalıcı kısıtlama uygulanır.
        </p>
      </div>

      {/* REQUIRE AUTHENTICATION GATE */}
      {!user ? (
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 sm:p-8 text-center space-y-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-400/25 flex items-center justify-center mx-auto text-sky-400">
            <Lock className="w-5 h-5" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-base font-bold text-white">
              Tartışmaya Katılmak İçin Giriş Yapın
            </h4>
            <p className="text-xs text-white/60 leading-relaxed">
              Yorum yazmak, sahne zamanı etiketlemek, yanıtlara katılmak ve beğenmek için lütfen KoUp hesabınıza giriş yapın.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAuthModal('İşlem yapabilmek için lütfen giriş yapın.')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(41,151,255,0.4)] transition-all cursor-pointer"
          >
            <User className="w-3.5 h-3.5" />
            <span>Giriş Yap / Ücretsiz Kayıt Ol</span>
          </button>
        </div>
      ) : isSoftBanned ? (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-6 text-center space-y-2 mb-8">
          <div className="flex items-center justify-center gap-2 text-rose-300 font-bold text-sm">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <span>Hesabınız Askıya Alınmıştır (Hafif Ban)</span>
          </div>
          <p className="text-xs text-white/70 max-w-md mx-auto">
            Topluluk kuralları ihlali nedeniyle hesabınız askıya alınmıştır. Yorum yapma, beğenme ve etkileşim özellikleri devre dışıdır.
          </p>
        </div>
      ) : (
        /* RICH CUSTOMIZABLE COMMENT COMPOSER FOR LOGGED-IN USERS */
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 sm:p-5 mb-8 space-y-3.5"
        >
          {replyTo && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs text-white/85">
              <span>@{replyTo.author_username || 'Kullanıcı'} yorumuna yanıt veriyorsun</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-white/60 hover:text-white cursor-pointer"
              >
                İptal
              </button>
            </div>
          )}

          {/* Formatting Toolbar */}
          {/* Mobile Toolbar (< sm) */}
          <div className="sm:hidden flex flex-col gap-2 p-2 rounded-xl bg-black/40 border border-white/[0.07] max-w-full">
            {/* Top Row: H2/B/I on Left, Görsel & Spoiler on the Right */}
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleHeadingToggle();
                  }}
                  className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                    isHeading ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="Başlık Yap (H2)"
                  title="Başlık Yap (H2)"
                >
                  <Heading2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleBoldToggle();
                  }}
                  className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                    isBold ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="Kalın Yazı (B)"
                  title="Kalın Yazı (B)"
                >
                  <Bold className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleItalicToggle();
                  }}
                  className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                    isItalic ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  aria-label="İtalik Yazı (I)"
                  title="İtalik Yazı (I)"
                >
                  <Italic className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowImageInput((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                    showImageInput
                      ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                      : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>Görsel</span>
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setHasSpoiler((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                    hasSpoiler
                      ? 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-300 border-rose-400/40 hover:border-rose-300'
                      : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5 shrink-0" />
                  <span>Spoiler</span>
                </button>
              </div>
            </div>

            {/* Middle Row: Centered GIF & Etiket */}
            <div className="flex items-center justify-center gap-2.5 w-full">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowGifPicker((v) => !v);
                  setShowStickerPicker(false);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                  showGifPicker
                    ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                    : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <span>GIF</span>
              </button>

              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setShowStickerPicker((v) => !v);
                  setShowGifPicker(false);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                  showStickerPicker
                    ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                    : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                <Smile className="w-3.5 h-3.5 shrink-0" />
                <span>Etiket</span>
              </button>
            </div>

            {/* Bottom Row: Colors on Left, Timestamp (Süre) on Right */}
            <div className="flex items-center justify-between w-full gap-2 pt-0.5">
              <div className="flex items-center gap-1.5 shrink-0">
                {APPLE_DARK_PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleColorSelect(c.hex);
                    }}
                    aria-label={`Renk: ${c.name}`}
                    title={`Renk: ${c.name}`}
                    style={{ backgroundColor: c.hex }}
                    className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                      selectedColor === c.hex
                        ? 'scale-125 ring-2 ring-white shadow-sm'
                        : 'opacity-75 hover:opacity-100 hover:scale-110'
                    }`}
                  />
                ))}
              </div>

              <div
                title="Sahne Dakikası (Örn: 14:20)"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#121217] hover:bg-[#181820] border border-white/15 hover:border-white/25 focus-within:border-sky-400/60 focus-within:ring-2 focus-within:ring-sky-400/20 focus-within:shadow-[0_0_12px_rgba(56,189,248,0.25)] transition-all cursor-text group shrink-0"
              >
                <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0 group-focus-within:scale-110 transition-transform" />
                <input
                  type="text"
                  value={timestampInput}
                  onChange={(e) => setTimestampInput(e.target.value)}
                  placeholder="14:20"
                  maxLength={8}
                  className="w-11 bg-transparent text-xs font-mono font-medium text-white placeholder-white/35 focus:outline-none text-center"
                />
              </div>
            </div>
          </div>

          {/* Desktop Toolbar (sm:) */}
          <div className="hidden sm:flex items-center gap-1.5 py-1.5 px-2 rounded-xl bg-black/40 border border-white/[0.07] max-w-full overflow-x-auto no-scrollbar">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleHeadingToggle();
              }}
              className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                isHeading ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Başlık Yap (H2)"
              title="Başlık Yap (H2)"
            >
              <Heading2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleBoldToggle();
              }}
              className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                isBold ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              aria-label="Kalın Yazı (B)"
              title="Kalın Yazı (B)"
            >
              <Bold className="w-4 h-4" />
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleItalicToggle();
              }}
              className={`p-1.5 rounded-lg text-xs cursor-pointer transition-colors duration-120 ease-out ${
                isItalic ? 'bg-white hover:bg-[#e8e8ed] text-black font-bold shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              aria-label="İtalik Yazı (I)"
              title="İtalik Yazı (I)"
            >
              <Italic className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-white/15 mx-1" />

            {/* Apple Dark Theme Palette with Selection Support */}
            <div className="flex items-center gap-1.5">
              {APPLE_DARK_PALETTE.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleColorSelect(c.hex);
                  }}
                  aria-label={`Renk: ${c.name}`}
                  title={`Renk: ${c.name}`}
                  style={{ backgroundColor: c.hex }}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    selectedColor === c.hex
                      ? 'scale-125 ring-2 ring-white shadow-sm'
                      : 'opacity-75 hover:opacity-100 hover:scale-110'
                  }`}
                />
              ))}
            </div>

            <div className="h-4 w-px bg-white/15 mx-1" />

            {/* Spoiler Mask Toggle */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHasSpoiler((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                hasSpoiler
                  ? 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-300 border-rose-400/40 hover:border-rose-300'
                  : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5 shrink-0" />
              <span>Spoiler</span>
            </button>

            {/* GIF Picker Toggle */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowGifPicker((v) => !v);
                setShowStickerPicker(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                showGifPicker
                  ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                  : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
                }`}
            >
              <span>GIF</span>
            </button>

            {/* Sticker Picker Toggle */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowStickerPicker((v) => !v);
                setShowGifPicker(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                showStickerPicker
                  ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                  : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <Smile className="w-3.5 h-3.5 shrink-0" />
              <span>Etiket</span>
            </button>

            {/* External Image Toggle */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowImageInput((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors duration-120 ease-out cursor-pointer select-none ${
                showImageInput
                  ? 'bg-white hover:bg-[#e8e8ed] text-black border-white'
                  : 'bg-transparent border-transparent text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Görsel</span>
            </button>

            {/* Timestamp / Scene Duration Pill Input */}
            <div
              title="Sahne Dakikası (Örn: 14:20)"
              className="flex items-center gap-1.5 ml-auto px-3 py-1.5 rounded-full bg-[#121217] hover:bg-[#181820] border border-white/15 hover:border-white/25 focus-within:border-sky-400/60 focus-within:ring-2 focus-within:ring-sky-400/20 focus-within:shadow-[0_0_12px_rgba(56,189,248,0.25)] transition-all cursor-text group"
            >
              <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0 group-focus-within:scale-110 transition-transform" />
              <input
                type="text"
                value={timestampInput}
                onChange={(e) => setTimestampInput(e.target.value)}
                placeholder="14:20"
                maxLength={8}
                className="w-12 bg-transparent text-xs font-mono font-medium text-white placeholder-white/35 focus:outline-none text-center"
              />
            </div>
          </div>

                    {/* GIF Picker Drawer with Dynamic Search */}
          {showGifPicker && (
            <div className="space-y-3 p-3.5 rounded-2xl bg-[#0b0b0f]/95 border border-white/12 backdrop-blur-xl shadow-2xl">
              {/* Search Bar + Quick Category Pills */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-[#121217] border border-white/12 hover:border-white/25 focus-within:border-sky-400/60 focus-within:ring-2 focus-within:ring-sky-400/20 transition-colors duration-120 shadow-xs">
                  <Search className="w-4 h-4 text-white/60 shrink-0" />
                  <input
                    type="text"
                    value={gifSearchQuery}
                    onChange={(e) => setGifSearchQuery(e.target.value)}
                    placeholder="GIF Ara... (örn: kdrama, anime, dance, shock, wow)"
                    className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
                  />
                  {gifSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setGifSearchQuery('')}
                      className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors duration-120"
                    >
                      <X className="w-3 h-3 stroke-[2.5]" />
                    </button>
                  )}
                </div>

                {/* Quick Search Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5 text-[11px]">
                  {['Trendler', 'K-Drama', 'Anime', 'Tepki / Reaction', 'Kalp / Aşk', 'Ağlama', 'Şok'].map((chip) => {
                    const query = chip === 'Trendler' ? '' : chip;
                    const isActive = (query === '' && gifSearchQuery === '') || gifSearchQuery.toLowerCase() === query.toLowerCase();
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setGifSearchQuery(query)}
                        className={`px-3 py-1.5 rounded-full font-semibold border whitespace-nowrap transition-colors duration-120 ease-out cursor-pointer select-none ${
                          isActive
                            ? 'bg-[#2997ff] hover:bg-sky-400 border-sky-400/60 hover:border-sky-300 text-white shadow-[0_0_12px_rgba(41,151,255,0.35)]'
                            : 'bg-white/[0.06] hover:bg-white/[0.14] border-white/10 hover:border-white/25 text-white/75 hover:text-white'
                        }`}
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* GIF Results Grid */}
              <div className="max-h-56 overflow-y-auto pr-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {isSearchingGifs ? (
                  <div className="col-span-full py-8 flex flex-col items-center justify-center gap-2 text-white/50 text-xs">
                    <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                    <span>GIF'ler taranıyor...</span>
                  </div>
                ) : gifSearchResults.length > 0 ? (
                  gifSearchResults.map((g) => (
                    <button
                      key={g.id || g.url}
                      type="button"
                      onClick={() => {
                        setSelectedGif(g.url);
                        setShowGifPicker(false);
                      }}
                      className="relative rounded-xl overflow-hidden border border-white/10 hover:border-white/35 transition-colors duration-120 cursor-pointer group bg-black/40 aspect-[4/3]"
                    >
                      <img
                        src={g.previewUrl || g.url}
                        alt={g.title}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent text-[10px] text-white px-1.5 py-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity duration-120">
                        {g.title}
                      </span>
                    </button>
                  ))
                ) : (
                  CURATED_GIFS.map((g) => (
                    <button
                      key={g.url}
                      type="button"
                      onClick={() => {
                        setSelectedGif(g.url);
                        setShowGifPicker(false);
                      }}
                      className="relative rounded-xl overflow-hidden border border-white/10 hover:border-white/35 transition-colors duration-120 cursor-pointer group bg-black/40 aspect-[4/3]"
                    >
                      <img src={g.url} alt={g.label} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white py-0.5 truncate px-1">
                        {g.label}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Sticker Picker Drawer */}
          {showStickerPicker && (
            <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-[#0b0b0f]/95 border border-white/12">
              {KDRAMA_ANIME_STICKERS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setSelectedSticker(`${st.badge} · ${st.label}`);
                    setShowStickerPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 hover:border-white/25 text-xs font-medium text-white/85 hover:text-white transition-colors duration-120 ease-out cursor-pointer"
                >
                  <span className="text-[10px] font-mono font-bold text-amber-300">
                    {st.badge}
                  </span>
                  <span>{st.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Image URL Input */}
          {showImageInput && (
            <input
              type="url"
              value={imageUrlInput}
              onChange={(e) => setImageUrlInput(e.target.value)}
              placeholder="https://... (Görsel URL'si yapıştırın — Cloudflare Proxy ile güvenle gösterilir)"
              className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
            />
          )}

          {/* Main Rich ContentEditable Editor */}
          <div className="relative min-h-[110px] w-full rounded-2xl bg-[#0b0b0e]/90 backdrop-blur-xl border border-white/12 hover:border-white/25 focus-within:border-sky-400/60 focus-within:ring-2 focus-within:ring-sky-400/20 focus-within:shadow-[0_0_20px_rgba(56,189,248,0.20)] transition-all">
            {!hasText && (
              <div
                onClick={() => editorRef.current?.focus()}
                className="absolute top-3.5 left-4 right-4 text-sm text-white/35 pointer-events-none select-none font-normal"
              >
                Yorum yaz...
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="Yorum İçeriği"
              onInput={handleEditorInput}
              onCompositionEnd={handleEditorInput}
              onTouchEnd={handleEditorInput}
              onKeyUp={() => {
                saveSelection();
                updateActiveFormats();
              }}
              onMouseUp={() => {
                saveSelection();
                updateActiveFormats();
              }}
              onSelect={() => {
                saveSelection();
                updateActiveFormats();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              style={{
                color: '#FFFFFF',
              }}
              className="comment-rich-editor w-full min-h-[110px] max-h-[360px] overflow-y-auto px-4 py-3.5 text-sm text-white/95 leading-relaxed font-normal focus:outline-none whitespace-pre-wrap break-words"
            />
          </div>

          {/* Selected Attachments Preview */}
          {(selectedGif || selectedSticker) && (
            <div className="flex items-center gap-3 pt-1">
              {selectedGif && (
                <div className="relative inline-block">
                  <img
                    src={selectedGif}
                    alt="GIF"
                    className="h-24 rounded-2xl border border-white/15 object-cover block shadow-md"
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedGif(null)}
                    aria-label="GIF'i Kaldır"
                    className="absolute -top-2 -right-2 w-6 h-6 p-0 rounded-full bg-[#121216] hover:bg-rose-500 text-white/90 hover:text-white border border-white/25 hover:border-rose-400 shadow-lg flex items-center justify-center transition-colors duration-120 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                  </button>
                </div>
              )}
              {selectedSticker && (
                <div className="pl-3.5 pr-2 py-1.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-xs font-medium text-amber-200 flex items-center gap-2">
                  <span>{selectedSticker}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSticker(null)}
                    aria-label="Etiketi Kaldır"
                    className="w-5 h-5 p-0 rounded-full bg-black/40 hover:bg-rose-500 text-white/80 hover:text-white flex items-center justify-center transition-colors duration-120 cursor-pointer"
                  >
                    <X className="w-3 h-3 stroke-[2.5] shrink-0" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Send Button with Cooldown & Spinner */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-white/40">
              {user.display_name || user.username} olarak paylaşıyorsun {charCount > 0 ? `· ${charCount}/1200` : ''}
            </span>
            <button
              type="submit"
              disabled={isSubmitting || cooldownSec > 0}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
                isSubmitting || cooldownSec > 0
                  ? 'bg-white/20 text-white/50 cursor-not-allowed'
                  : 'bg-[#2997ff] hover:bg-sky-400 text-white shadow-[0_0_20px_rgba(41,151,255,0.45)] hover:shadow-[0_0_28px_rgba(41,151,255,0.7)] cursor-pointer'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? 'Gönderiliyor...'
                  : cooldownSec > 0
                  ? `Bekleyin (${cooldownSec}s)`
                  : 'Yorumu Gönder'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* COMMENTS LIST */}
      <div className="space-y-4">
        {isLoadingComments ? (
          <div className="py-12 text-center text-sm font-mono text-sky-400 animate-pulse">
            Topluluk yorumları yükleniyor...
          </div>
        ) : rootComments.length === 0 ? (
          <div className="py-12 text-center text-sm text-white/45">
            Henüz yorum yapılmamış. İlk yorumu sen bırak!
          </div>
        ) : (
          rootComments.map((root) => {
            const replies = repliesByRoot[root.id] || [];
            return (
              <div key={root.id} className="space-y-2.5">
                {renderCommentCard(root, false)}
                {replies.length > 0 && (
                  <div className="ml-4 sm:ml-10 pl-3 sm:pl-5 border-l-2 border-white/10 space-y-2.5 mt-2">
                    {replies.map((reply) => renderCommentCard(reply, true))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* PAGINATION / LOAD MORE */}
        {hasMore && (
          <div className="pt-4 text-center">
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => loadComments(currentPage + 1)}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-xs font-semibold text-white transition-all cursor-pointer"
            >
              <ChevronDown className={`w-3.5 h-3.5 ${isLoadingMore ? 'animate-spin' : ''}`} />
              <span>{isLoadingMore ? 'Yükleniyor...' : 'Daha Fazla Yorum Göster'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Custom Comment Report Modal (Replaces window.prompt) */}
      {reportingComment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#0e0e14] border border-white/15 rounded-3xl p-6 shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 text-rose-400">
                <Flag className="w-5 h-5" />
                <h3 className="font-bold text-white text-base">Yorumu Bildir</h3>
              </div>
              <button
                type="button"
                onClick={() => setReportingComment(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-white/60">
              <span className="font-semibold text-white/90">
                @{reportingComment.author_username || 'Kullanıcı'}
              </span>{' '}
              tarafından paylaşılan yorumla ilgili bir sorun mu fark ettiniz? Bildiriminiz moderasyon ekibimizce titizlikle incelenecektir.
            </div>

            {/* Reason category chips */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                Bildirim Nedeni
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  'Spoiler / İpuçları İçeriyor',
                  'Hakaret / Nefret Söylemi',
                  'Spam / Reklam',
                  'Kural İhlali',
                  'Telif / Uygunsuz İçerik',
                  'Diğer',
                ].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setReportCategory(cat)}
                    className={`p-2.5 rounded-xl text-xs text-left transition-all cursor-pointer border ${
                      reportCategory === cat
                        ? 'bg-rose-500/20 border-rose-400/50 text-rose-300 font-semibold shadow-sm'
                        : 'bg-white/[0.03] border-white/[0.08] text-white/70 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional details textarea */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase text-white/40 tracking-wider">
                Açıklama / Detay (İsteğe Bağlı)
              </label>
              <textarea
                rows={3}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Moderatörlere iletmek istediğiniz ek notlar..."
                className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 text-xs text-white focus:outline-none focus:border-rose-400/50 resize-none placeholder-white/30"
              />
            </div>

            {/* Cooldown Warning Banner */}
            {reportCooldownSec > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-medium">
                <Clock className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />
                <span>Peş peşe bildirim limiti aktif: <strong>{reportCooldownSec}</strong>s bekleyin.</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReportingComment(null)}
                className="px-4 py-2 rounded-xl text-xs text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={isSubmittingReport || reportCooldownSec > 0}
                onClick={handleSubmitReport}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs glow-rose transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Flag className="w-3.5 h-3.5" />
                <span>
                  {isSubmittingReport
                    ? 'Gönderiliyor...'
                    : reportCooldownSec > 0
                    ? `Bekleyin (${reportCooldownSec}s)`
                    : 'Bildir'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
