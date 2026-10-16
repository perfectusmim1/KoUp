'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

  clean = clean.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/gi, (match, tag, attrs) => {
    const lowerTag = tag.toLowerCase();
    const safeTags = ['div', 'span', 'strong', 'em', 'b', 'i', 'br', 'p'];
    if (!safeTags.includes(lowerTag)) return '';

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
          if (prop === 'color' && /^([#0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(val)) return true;
          if (prop === 'font-weight' && /^(bold|normal|[1-9]00)$/.test(val)) return true;
          if (prop === 'font-style' && /^(italic|normal)$/.test(val)) return true;
          if (prop === 'font-size' && /^([0-9.]+rem|[0-9]+px)$/.test(val)) return true;
          if (prop === 'line-height' && /^([0-9.]+|normal)$/.test(val)) return true;
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
  } = useKoUp();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoadingComments, setIsLoadingComments] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

  // Form State
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
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
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Record<string, boolean>>({});
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({});
  const [likingId, setLikingId] = useState<string | null>(null);
  const [dislikedIds, setDislikedIds] = useState<Record<string, boolean>>({});

  // Inline Reply state (render reply box directly beneath comment)
  const [inlineReplyId, setInlineReplyId] = useState<string | null>(null);
  const [inlineReplyText, setInlineReplyText] = useState('');
  const [inlineReplySpoiler, setInlineReplySpoiler] = useState(false);
  const [isSubmittingInline, setIsSubmittingInline] = useState(false);

  // Anti-spam / Cooldown / Double Click Protection
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownSec, setCooldownSec] = useState<number>(0);

  // 10-Minute Edit Window State
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBodyText, setEditBodyText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Rate-limiting cooldown countdown
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownSec]);

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

  const handleColorSelect = (hex: string) => {
    const el = textareaRef.current;
    if (!el) {
      setSelectedColor(hex);
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;

    if (start !== end) {
      const before = bodyText.substring(0, start);
      const selected = bodyText.substring(start, end);
      const after = bodyText.substring(end);
      const wrapped = `[color=${hex}]${selected}[/color]`;
      setBodyText(before + wrapped + after);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + wrapped.length);
      }, 10);
      pushNotification('Metin Rengi Uygulandı', 'Seçili metin renklendirildi.', 'info');
    } else {
      setSelectedColor(hex);
    }
  };

  const handleBoldToggle = () => {
    const el = textareaRef.current;
    if (el && el.selectionStart !== el.selectionEnd) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = bodyText.substring(0, start);
      const selected = bodyText.substring(start, end);
      const after = bodyText.substring(end);
      const wrapped = `[b]${selected}[/b]`;
      setBodyText(before + wrapped + after);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + wrapped.length);
      }, 10);
    } else {
      setIsBold((v) => !v);
    }
  };

  const handleItalicToggle = () => {
    const el = textareaRef.current;
    if (el && el.selectionStart !== el.selectionEnd) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const before = bodyText.substring(0, start);
      const selected = bodyText.substring(start, end);
      const after = bodyText.substring(end);
      const wrapped = `[i]${selected}[/i]`;
      setBodyText(before + wrapped + after);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + wrapped.length);
      }, 10);
    } else {
      setIsItalic((v) => !v);
    }
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

    if (!bodyText.trim() && !selectedGif && !selectedSticker) return;
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

    const formattedHtml = parseCommentTextToHtml(
      bodyText,
      selectedColor,
      isBold,
      isItalic,
      isHeading
    );

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
        title: title.trim() || null,
        content_html: formattedHtml,
        content_json: {
          raw: bodyText,
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
      setComments((prev) => [freshComment, ...prev]);
      setTotalCount((c) => c + 1);
      invalidateCache('comments');

      // Start anti-spam cooldown
      setCooldownSec(15);

      // Reset form fields
      setTitle('');
      setBodyText('');
      setHasSpoiler(false);
      setTimestampInput('');
      setImageUrlInput('');
      setSelectedGif(null);
      setSelectedSticker(null);
      setReplyTo(null);
      setShowImageInput(false);
      setShowGifPicker(false);
      setShowStickerPicker(false);

      pushNotification(
        replyTo ? 'Yanıtın Gönderildi' : 'Yorumun Yayınlandı',
        `${targetTitle} tartışmasına katkın kaydedildi.`,
        'reply'
      );
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

  const handleStartEdit = (c: CommentRow) => {
    const isAuthor = user?.id && c.user_id === user.id;
    const isAdmin = user?.role === 'admin' || user?.role === 'editor';
    if (!isAuthor && !isAdmin) {
      pushNotification('Yetkisiz İşlem', 'Yalnızca kendi yorumunuzu düzenleyebilirsiniz.', 'info');
      return;
    }

    const ageMs = Date.now() - new Date(c.created_at).getTime();
    if (!isAdmin && ageMs > 10 * 60 * 1000) {
      pushNotification(
        'Düzenleme Süresi Doldu',
        'Yorumlar yalnızca gönderildikten sonraki ilk 10 dakika içinde düzenlenebilir.',
        'info'
      );
      return;
    }

    setEditingCommentId(c.id);
    setEditTitle(c.title || '');

    // Extract raw text from content_json or parse from HTML
    if (c.content_json?.raw) {
      setEditBodyText(c.content_json.raw);
    } else {
      const plain = c.content_html
        .replace(/<br\s*[\/]?>/gi, '\n')
        .replace(/<span style="color:(#[0-9a-fA-F]{3,8}|[a-zA-Z]+);[^"]*">([\s\S]*?)<\/span>/gi, '[color=$1]$2[/color]')
        .replace(/<strong>([\s\S]*?)<\/strong>/gi, '[b]$1[/b]')
        .replace(/<em>([\s\S]*?)<\/em>/gi, '[i]$1[/i]')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
      setEditBodyText(plain);
    }
  };

  const handleSaveEdit = async (commentId: string) => {
    const target = comments.find((c) => c.id === commentId);
    if (!target) return;

    const isAuthor = user?.id && target.user_id === user.id;
    const isAdmin = user?.role === 'admin' || user?.role === 'editor';
    if (!isAuthor && !isAdmin) return;

    const ageMs = Date.now() - new Date(target.created_at).getTime();
    if (!isAdmin && ageMs > 10 * 60 * 1000) {
      pushNotification(
        'Düzenleme İzni Kapandı',
        '10 dakikalık düzenleme penceresi aşıldı. Yorum sabitlendi.',
        'info'
      );
      setEditingCommentId(null);
      return;
    }

    setIsSavingEdit(true);

    try {
      const updatedHtml = parseCommentTextToHtml(
        editBodyText,
        selectedColor,
        isBold,
        isItalic,
        isHeading
      );

      const updatePayload = {
        title: editTitle.trim() || null,
        content_html: updatedHtml,
        content_json: {
          ...(target.content_json || {}),
          raw: editBodyText,
          is_edited: true,
          edited_at: new Date().toISOString(),
        },
      };

      const { error } = await supabase
        .from('comments')
        .update(updatePayload)
        .eq('id', commentId);

      if (error) {
        pushNotification(
          'Güncelleme Hatası',
          error.message || 'Yorum güncellenemedi.',
          'info'
        );
        return;
      }

      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                title: editTitle.trim() || null,
                content_html: updatedHtml,
                content_json: updatePayload.content_json,
              }
            : c
        )
      );

      setEditingCommentId(null);
      invalidateCache('comments');
      pushNotification('Yorum Güncellendi', 'Değişikliklerin kaydedildi.', 'success');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteComment = async (c: CommentRow) => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }

    const isAuthor = c.user_id === user.id;
    const isAdmin = user.role === 'admin' || user.role === 'editor';
    if (!isAuthor && !isAdmin) {
      pushNotification('Yetkisiz İşlem', 'Bu yorumu silme yetkiniz bulunmuyor.', 'info');
      return;
    }

    if (!window.confirm('Bu yorumu kalıcı olarak silmek istediğinize emin misiniz?')) {
      return;
    }

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

    // Optimistic UI update
    setLikedIds((prev) => ({ ...prev, [c.id]: !wasLiked }));
    setComments((prev) =>
      prev.map((item) =>
        item.id === c.id
          ? { ...item, likes_count: Math.max(0, item.likes_count + delta) }
          : item
      )
    );

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

  const handleDislike = (c: CommentRow) => {
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
    setDislikedIds((prev) => {
      const wasDisliked = Boolean(prev[c.id]);
      return { ...prev, [c.id]: !wasDisliked };
    });
    if (likedIds[c.id]) {
      toggleLike(c);
    }
  };

  const handleReportComment = async (c: CommentRow) => {
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
    const reason = window.prompt(
      'Bu yorumla ilgili sorunu belirtin (Spoiler, Spam, Hakaret, vb.):',
      'Spoiler / Kural İhlali'
    );
    if (!reason || !reason.trim()) return;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id || user.id;

      await supabase.from('issue_reports').insert({
        reporter_id: uid,
        target_type: 'comment',
        media_id: mediaId || null,
        season_number: seasonNumber || null,
        episode_number: episodeNumber || null,
        issue_category: 'Topluluk Yorum Bildirimi',
        details: `Yorum ID: ${c.id} - Yazar: ${c.author_username || 'Bilinmiyor'} - Gerekçe: ${reason.trim()}`,
        status: 'open',
      });
      pushNotification('Bildirim Alındı', 'Yorum incelenmek üzere moderatör ekibine iletildi.', 'info');
    } catch {
      pushNotification('Bildirim Alındı', 'Bildiriminiz kaydedildi.', 'info');
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
      setInlineReplyText(`@${targetUsername} `);
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
    if (!inlineReplyText.trim()) return;
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
      setComments((prev) => [freshComment, ...prev]);
      setTotalCount((c) => c + 1);
      invalidateCache('comments');
      setInlineReplyId(null);
      setInlineReplyText('');
      setInlineReplySpoiler(false);

      pushNotification(
        'Yanıtınız Gönderildi',
        `@${parentComment.author_username || 'Kullanıcı'} yorumuna yanıtınız eklendi.`,
        'reply'
      );
    } catch (err: any) {
      pushNotification('Hata', err?.message || 'Yanıt iletilemedi', 'info');
    } finally {
      setIsSubmittingInline(false);
    }
  };

  return (
    <section className="mt-10 rounded-3xl apple-glass p-4 sm:p-8 border border-white/10 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-5 border-b border-white/10">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-400" />
            <span>Topluluk Yorumları & Tartışma ({totalCount})</span>
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
          Aşırı küfür, hakaret ve nefret söylemi yasaktır. Tartışmalar saygı çerçevesinde yürütülmelidir. Kural ihlali durumunda hesap veya cihaz düzeyinde kısıtlama uygulanır.
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
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs shadow-[0_0_20px_rgba(41,151,255,0.4)] transition-all cursor-pointer active:scale-95"
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

          {/* Title Input */}
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Yorum Başlığı (Opsiyonel — örn: 4. Bölümün Son Sahnesi Efsaneydi!)"
            className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-sm font-semibold text-white placeholder-white/35 focus:outline-none focus:border-white/35"
          />

          {/* Formatting Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 py-1.5 px-2 rounded-xl bg-black/40 border border-white/[0.07] max-w-full overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setIsHeading((v) => !v)}
              className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                isHeading ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
              }`}
              title="Büyük Başlık Stili"
            >
              <Heading2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleBoldToggle}
              className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                isBold ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
              }`}
              title="Kalın Yazı (Seçili metne veya tümüne)"
            >
              <Bold className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleItalicToggle}
              className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                isItalic ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
              }`}
              title="İtalik Yazı (Seçili metne veya tümüne)"
            >
              <Italic className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-white/15 mx-1" />

            {/* Apple Dark Theme Palette with Selection Support */}
            <div
              className="flex items-center gap-1.5"
              title="Metin seçip tıklarsan sadece o kısım, seçmeden tıklarsan tüm yazı bu renkte olur"
            >
              {APPLE_DARK_PALETTE.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => handleColorSelect(c.hex)}
                  title={`Renk: ${c.name} (Seçili kelimeyi veya tümünü renklendir)`}
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
              onClick={() => setHasSpoiler((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                hasSpoiler
                  ? 'bg-rose-500/25 text-rose-300 border border-rose-400/40'
                  : 'text-white/70 hover:bg-white/10'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Spoiler</span>
            </button>

            {/* GIF Picker Toggle */}
            <button
              type="button"
              onClick={() => {
                setShowGifPicker((v) => !v);
                setShowStickerPicker(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                showGifPicker ? 'bg-white text-black font-bold' : 'text-white/70 hover:bg-white/10'
              }`}
            >
              <span>GIF</span>
            </button>

            {/* Sticker Picker Toggle */}
            <button
              type="button"
              onClick={() => {
                setShowStickerPicker((v) => !v);
                setShowGifPicker(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                showStickerPicker
                  ? 'bg-white text-black font-bold'
                  : 'text-white/70 hover:bg-white/10'
              }`}
            >
              <Smile className="w-3.5 h-3.5" />
              <span>Etiket</span>
            </button>

            {/* External Image URL Toggle */}
            <button
              type="button"
              onClick={() => setShowImageInput((v) => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                showImageInput ? 'bg-white text-black font-bold' : 'text-white/70 hover:bg-white/10'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Görsel URL</span>
            </button>

            {/* Timestamp Input */}
            <div
              className="flex items-center gap-1.5 ml-auto bg-white/[0.06] hover:bg-white/10 px-2.5 py-1 rounded-lg border border-white/15 transition-all"
              title="Bahsettiğin sahnenin dakikasını yaz (örn: 14:20). Yorumuna tıklayanlar doğrudan o saniyeye atlar!"
            >
              <Clock className="w-3 h-3 text-sky-400" />
              <input
                type="text"
                value={timestampInput}
                onChange={(e) => setTimestampInput(e.target.value)}
                placeholder="14:20"
                className="w-12 bg-transparent text-[11px] font-mono text-white placeholder-white/40 focus:outline-none"
              />
            </div>
          </div>

          {/* GIF Picker Drawer */}
          {showGifPicker && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-xl bg-black/60 border border-white/10">
              {CURATED_GIFS.map((g) => (
                <button
                  key={g.url}
                  type="button"
                  onClick={() => {
                    setSelectedGif(g.url);
                    setShowGifPicker(false);
                  }}
                  className="relative rounded-lg overflow-hidden border border-white/10 hover:border-white/40 cursor-pointer group"
                >
                  <img src={g.url} alt={g.label} className="w-full h-20 object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[10px] text-white py-0.5">
                    {g.label}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Sticker Picker Drawer */}
          {showStickerPicker && (
            <div className="flex flex-wrap gap-2 p-2.5 rounded-xl bg-black/60 border border-white/10">
              {KDRAMA_ANIME_STICKERS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setSelectedSticker(`${st.badge} · ${st.label}`);
                    setShowStickerPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-white cursor-pointer"
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
              className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/35"
            />
          )}

          {/* Main Textarea */}
          <textarea
            ref={textareaRef}
            rows={3}
            maxLength={2000}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            style={{
              color: selectedColor,
              fontWeight: isBold || isHeading ? 700 : 400,
              fontStyle: isItalic ? 'italic' : 'normal',
            }}
            placeholder="Düşüncelerini, teorilerini veya sahne analizini yaz... (İpucu: Bir kelimeyi fareyle seçip yukarıdaki renk paletine basarak renklendirebilirsin!)"
            className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-sm placeholder-white/35 focus:outline-none focus:border-white/35"
          />

          {/* Selected Attachments Preview */}
          {(selectedGif || selectedSticker) && (
            <div className="flex items-center gap-3">
              {selectedGif && (
                <div className="relative">
                  <img src={selectedGif} alt="GIF" className="h-20 rounded-xl border border-white/15" />
                  <button
                    type="button"
                    onClick={() => setSelectedGif(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white text-xs cursor-pointer flex items-center justify-center border border-white/30"
                  >
                    ×
                  </button>
                </div>
              )}
              {selectedSticker && (
                <div className="px-3 py-1.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-xs text-amber-200 flex items-center gap-2">
                  <span>{selectedSticker}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSticker(null)}
                    className="text-xs text-white/60 hover:text-white cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Send Button with Cooldown & Spinner */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-white/40">
              {user.display_name || user.username} olarak paylaşıyorsun
            </span>
            <button
              type="submit"
              disabled={isSubmitting || cooldownSec > 0 || (!bodyText.trim() && !selectedGif && !selectedSticker)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
                isSubmitting || cooldownSec > 0 || (!bodyText.trim() && !selectedGif && !selectedSticker)
                  ? 'bg-white/20 text-white/50 cursor-not-allowed'
                  : 'bg-[#2997ff] hover:bg-sky-400 text-white hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(41,151,255,0.35)] cursor-pointer'
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
        ) : comments.length === 0 ? (
          <div className="py-12 text-center text-sm text-white/45">
            Henüz yorum yapılmamış. İlk yorumu sen bırak!
          </div>
        ) : (
          comments.map((c) => {
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

            // 10-Minute Edit Window
            const createdTime = new Date(c.created_at).getTime();
            const ageMs = Date.now() - createdTime;
            const isWithin10Min = ageMs <= 10 * 60 * 1000;
            const canEdit = (isAuthor && isWithin10Min) || isAdmin;
            const canDelete = isAuthor || isAdmin;
            const remainingMins = Math.max(1, Math.ceil((10 * 60 * 1000 - ageMs) / 60000));

            const isEditingThis = editingCommentId === c.id;
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

            return (
              <div
                key={c.id}
                id={`comment-${c.id}`}
                className={`p-3.5 sm:p-5 rounded-2xl border transition-all max-w-full overflow-hidden break-words ${
                  isHiddenByModeration
                    ? 'bg-rose-950/20 border-rose-500/30'
                    : 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.14]'
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
                <div className="flex items-start gap-3.5">
                  {/* Author Avatar (Clickable Link to User Profile) */}
                  <Link
                    href={profileUrl}
                    className="shrink-0 group block mt-0.5"
                    title={`${authorName} Profilini Görüntüle`}
                  >
                    {authorAvatar ? (
                      <img
                        src={getProxiedImageUrl(authorAvatar)}
                        alt={authorName}
                        className="w-10 h-10 rounded-full object-cover border border-white/15 group-hover:border-sky-400 group-hover:scale-105 transition-all shadow-md"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75 group-hover:border-sky-400 group-hover:scale-105 transition-all shadow-md">
                        <User className="w-5 h-5" />
                      </div>
                    )}
                  </Link>

                  {/* Right Column: Header, Body, Action Bar */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* Top Header Row: Username + Mini Badges + Relative Time */}
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                      <Link
                        href={profileUrl}
                        className="text-white font-bold text-sm hover:underline hover:text-sky-300 transition-colors"
                      >
                        {authorName}
                      </Link>

                      {/* Cute Mini Supporter & Rank Badges */}
                      <div className="inline-flex items-center gap-1">
                        {isAuthorAdmin && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-[9px] font-mono font-bold text-sky-300 uppercase">
                            Yönetici
                          </span>
                        )}
                        <span
                          className="w-5 h-5 rounded-full bg-pink-500/15 border border-pink-400/30 flex items-center justify-center text-[11px] select-none shadow-sm hover:scale-110 transition-transform"
                          title="KoUp Çilekli Süt Rozeti"
                        >
                          🍓
                        </span>
                        <span
                          className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px] select-none shadow-sm hover:scale-110 transition-transform"
                          title="KoUp Destekçisi"
                        >
                          🥛
                        </span>
                      </div>

                      {/* Functional Timestamp Badge (Seek to Video) */}
                      {c.timestamp_sec !== undefined && c.timestamp_sec !== null && (
                        <button
                          type="button"
                          onClick={() => handleSeekScene(c.timestamp_sec!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/20 hover:bg-sky-500/35 text-sky-300 border border-sky-400/35 font-mono text-[10px] cursor-pointer transition-all hover:scale-105 active:scale-95"
                          title="Tıklayarak doğrudan bu sahneye atla"
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

                    {/* Editing Form (if editing this comment) */}
                    {isEditingThis ? (
                      <div className="p-3.5 rounded-xl bg-black/60 border border-amber-400/30 space-y-2.5 my-2">
                        <input
                          type="text"
                          value={editTitle}
                          maxLength={120}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="Başlık (Opsiyonel)"
                          className="w-full px-3 py-1.5 rounded-lg bg-black border border-white/15 text-xs text-white focus:outline-none"
                        />
                        <textarea
                          rows={3}
                          maxLength={2000}
                          value={editBodyText}
                          onChange={(e) => setEditBodyText(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-black border border-white/15 text-xs text-white focus:outline-none"
                        />
                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-[11px] text-amber-300/80">
                            {isAdmin
                              ? 'Yönetici düzenleme modu'
                              : `⏱ Kalan düzenleme süresi: ~${remainingMins} dakika`}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingCommentId(null)}
                              className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 text-white/70 hover:text-white cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                              <span>Vazgeç</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSavingEdit}
                              onClick={() => handleSaveEdit(c.id)}
                              className="flex items-center gap-1 px-3 py-1 rounded-full bg-amber-400 text-black font-bold hover:scale-105 transition-all cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>{isSavingEdit ? 'Kaydediliyor...' : 'Kaydet'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Comment Body */
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
                              className="text-sm text-white/90 leading-relaxed font-normal break-words"
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.content_html) }}
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
                    )}

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
                        title="Beğen"
                      >
                        <Heart
                          className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
                            likedIds[c.id] ? 'fill-rose-500 text-rose-500' : ''
                          }`}
                        />
                        <span className="font-mono text-xs">{c.likes_count || 0}</span>
                      </button>

                      {/* Broken Heart / Dislike Button */}
                      <button
                        type="button"
                        onClick={() => handleDislike(c)}
                        className={`p-1 rounded-lg transition-colors cursor-pointer ${
                          dislikedIds[c.id]
                            ? 'text-pink-400 font-bold'
                            : 'text-white/40 hover:text-white/70'
                        }`}
                        title="Beğenmedim"
                      >
                        <HeartCrack className="w-3.5 h-3.5" />
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

                      {/* Report Button */}
                      <button
                        type="button"
                        onClick={() => handleReportComment(c)}
                        className="flex items-center gap-1 text-xs text-white/40 hover:text-amber-300 transition-colors cursor-pointer py-1 px-1.5 rounded-lg hover:bg-white/[0.04]"
                        title="Sorun Bildir"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        <span>Bildir</span>
                      </button>

                      {/* Copy Link Button */}
                      <button
                        type="button"
                        onClick={() => handleCopyLink(c.id)}
                        className="p-1 rounded-lg text-white/40 hover:text-sky-300 transition-colors cursor-pointer hover:bg-white/[0.04]"
                        title="Yorum Bağlantısını Kopyala"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Edit Button (if within 10 min or admin) */}
                      {canEdit && !isEditingThis && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(c)}
                          className="flex items-center gap-1 text-xs text-amber-300/80 hover:text-amber-200 transition-colors cursor-pointer py-1 px-1.5 rounded-lg hover:bg-white/[0.04]"
                          title={
                            isAdmin
                              ? 'Admin Düzenleme Yetkisi'
                              : `Yorumu düzenle (Kalan: ${remainingMins} dk)`
                          }
                        >
                          <Pencil className="w-3 h-3" />
                          <span className="hidden sm:inline">
                            Düzenle ({remainingMins} dk)
                          </span>
                        </button>
                      )}

                      {/* Delete Button (if author or admin) */}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(c)}
                          className="p-1 rounded-lg text-white/35 hover:text-rose-400 transition-colors cursor-pointer hover:bg-white/[0.04]"
                          title="Yorumu Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Inline Reply Box (Image 2) */}
                    {inlineReplyId === c.id && (
                      <div className="mt-3.5 pt-3 border-t border-white/[0.08] flex items-start gap-3">
                        {/* Current user's avatar */}
                        <div className="shrink-0 pt-0.5">
                          {user?.avatar_url ? (
                            <img
                              src={getProxiedImageUrl(user.avatar_url)}
                              alt={user.display_name || user.username || 'Ben'}
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
                          <div className="bg-[#121216] border border-white/10 rounded-2xl p-3 focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/30 transition-all">
                            <textarea
                              rows={2}
                              value={inlineReplyText}
                              onChange={(e) => setInlineReplyText(e.target.value)}
                              placeholder={`@${authorUsername} kullanıcısına yanıt yaz...`}
                              className="w-full bg-transparent text-white text-sm focus:outline-none resize-none placeholder-white/30"
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
                                  : 'bg-[#2997ff] hover:bg-sky-400 text-white shadow-blue-500/25 active:scale-95'
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
    </section>
  );
}
