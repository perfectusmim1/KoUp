'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const { user, setIsAuthModalOpen, pushNotification } = useKoUp();

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
      pushNotification(
        'Giriş Yapmalısınız',
        'Yorum gönderebilmek için lütfen oturum açın.',
        'info'
      );
      setIsAuthModalOpen(true);
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
      pushNotification('Yorum Silindi', 'Topluluk yorumunuz kaldırıldı.', 'info');
    } catch (err: any) {
      pushNotification('Hata', err?.message || 'İşlem gerçekleştirilemedi.', 'info');
    }
  };

  const toggleLike = async (c: CommentRow) => {
    if (!user) {
      pushNotification(
        'Giriş Yapmalısınız',
        'Yorumları beğenmek için lütfen KoUp hesabınıza giriş yapın.',
        'info'
      );
      setIsAuthModalOpen(true);
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

  return (
    <section className="mt-10 rounded-3xl apple-glass p-6 sm:p-8 border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-6 border-b border-white/10">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <span>Topluluk Yorumları & Tartışma ({totalCount})</span>
          </h3>
          <p className="text-xs text-white/55 mt-0.5">
            {targetTitle} hakkında düşüncelerini, teorilerini ve sahne analizlerini paylaş.
          </p>
        </div>
      </div>

      {/* REQUIRE AUTHENTICATION GATE */}
      {!user ? (
        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 sm:p-8 text-center space-y-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 flex items-center justify-center mx-auto text-emerald-400">
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
            onClick={() => setIsAuthModalOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all cursor-pointer active:scale-95"
          >
            <User className="w-3.5 h-3.5" />
            <span>Giriş Yap / Ücretsiz Kayıt Ol</span>
          </button>
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
          <div className="flex flex-wrap items-center gap-1.5 py-1.5 px-2 rounded-xl bg-black/40 border border-white/[0.07]">
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
              <Clock className="w-3 h-3 text-emerald-400" />
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
                  : 'bg-emerald-500 hover:bg-emerald-400 text-black hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.35)] cursor-pointer'
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
          <div className="py-12 text-center text-sm font-mono text-emerald-400 animate-pulse">
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
            const authorAvatar = c.profiles?.avatar_url || c.author_avatar;
            const isAuthorAdmin = c.profiles?.role === 'admin' || c.profiles?.role === 'editor';

            return (
              <div
                key={c.id}
                className={`p-4 sm:p-5 rounded-2xl border transition-all space-y-3 ${
                  isHiddenByModeration
                    ? 'bg-rose-950/20 border-rose-500/30'
                    : 'bg-white/[0.03] border-white/[0.08]'
                }`}
              >
                {/* Moderation Alert Banner for Owner/Admin */}
                {isHiddenByModeration && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-400/30 text-[11px] text-rose-300">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Bu yorum moderasyon tarafından gizlendi. Sadece siz görebiliyorsunuz.</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {authorAvatar ? (
                      <img
                        src={getProxiedImageUrl(authorAvatar)}
                        alt={authorName}
                        className="w-8 h-8 rounded-full object-cover border border-white/15"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                        <span>{authorName}</span>

                        {isAuthorAdmin && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/30 text-[9px] font-mono font-bold text-emerald-300 uppercase">
                            Yönetici
                          </span>
                        )}

                        {/* Functional Timestamp Badge: Clickable Seek to Video */}
                        {c.timestamp_sec !== undefined && c.timestamp_sec !== null && (
                          <button
                            type="button"
                            onClick={() => handleSeekScene(c.timestamp_sec!)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-400/35 font-mono text-[10px] cursor-pointer transition-all hover:scale-105 active:scale-95"
                            title="Tıklayarak doğrudan bu sahneye atla"
                          >
                            <Clock className="w-2.5 h-2.5 text-emerald-400" />
                            <span>
                              {Math.floor(c.timestamp_sec / 60)}:
                              {String(c.timestamp_sec % 60).padStart(2, '0')} (Sahneye Git)
                            </span>
                          </button>
                        )}

                        {c.sticker_id && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-200 text-[10px] font-mono">
                            {c.sticker_id}
                          </span>
                        )}

                        {isEditedFlag && (
                          <span className="text-[10px] text-white/40 italic">
                            (düzenlendi)
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-white/40">
                        {new Date(c.created_at).toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Actions: Edit (10 min), Delete, Like, Reply */}
                  <div className="flex items-center gap-2">
                    {canEdit && !isEditingThis && (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(c)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/15 border border-white/10 text-xs text-amber-300 hover:text-amber-200 cursor-pointer transition-all"
                        title={
                          isAdmin
                            ? 'Admin Düzenleme Yetkisi'
                            : `Yorumu düzenle (Kalan: ${remainingMins} dk)`
                        }
                      >
                        <Pencil className="w-3 h-3" />
                        <span className="hidden sm:inline">
                          Düzenle {isAdmin ? '(Admin)' : `(${remainingMins} dk)`}
                        </span>
                      </button>
                    )}

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteComment(c)}
                        className="p-1.5 rounded-full bg-white/[0.05] hover:bg-rose-500/20 border border-white/10 text-white/60 hover:text-rose-300 cursor-pointer transition-all"
                        title="Yorumu Sil"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}

                    <button
                      onClick={() => toggleLike(c)}
                      disabled={likingId === c.id}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
                        likedIds[c.id]
                          ? 'bg-rose-500/20 border-rose-400 text-rose-300'
                          : 'bg-white/[0.05] border-white/10 text-white/70 hover:text-white'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${likedIds[c.id] ? 'fill-rose-400 text-rose-400' : ''}`}
                      />
                      <span>{c.likes_count}</span>
                    </button>

                    <button
                      onClick={() => {
                        if (!user) {
                          pushNotification('Giriş Yapmalısınız', 'Yanıt vermek için lütfen giriş yapın.', 'info');
                          setIsAuthModalOpen(true);
                          return;
                        }
                        setReplyTo(c);
                        textareaRef.current?.focus();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white cursor-pointer"
                    >
                      <Reply className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Yanıtla</span>
                    </button>
                  </div>
                </div>

                {/* Inline Editing Form */}
                {isEditingThis ? (
                  <div className="p-3.5 rounded-xl bg-black/60 border border-amber-400/30 space-y-2.5">
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
                  <>
                    {c.title && (
                      <h4 className="text-sm font-bold text-white pt-1">{c.title}</h4>
                    )}

                    {isSpoilerHidden ? (
                      <button
                        onClick={() =>
                          setRevealedSpoilers((prev) => ({ ...prev, [c.id]: true }))
                        }
                        className="w-full py-3 px-4 rounded-xl bg-rose-950/30 border border-rose-400/30 text-xs text-rose-200 flex items-center justify-center gap-2 cursor-pointer hover:bg-rose-950/50 transition-all"
                      >
                        <EyeOff className="w-4 h-4" />
                        <span>Bu yorum Spoiler içeriyor · Görmek için tıkla</span>
                      </button>
                    ) : (
                      <div className="space-y-2">
                        {/* XSS Sanitized HTML Body */}
                        <div
                          className="text-sm leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.content_html) }}
                        />

                        {c.has_spoiler && (
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedSpoilers((prev) => ({ ...prev, [c.id]: false }))
                            }
                            className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70 cursor-pointer pt-1"
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
                            className="max-h-44 rounded-xl border border-white/10 object-contain"
                          />
                        )}

                        {c.image_url && c.image_url.startsWith('https://') && (
                          <img
                            src={getProxiedImageUrl(c.image_url)}
                            alt="Yorum Görseli"
                            loading="lazy"
                            className="max-h-60 rounded-xl border border-white/10 object-contain"
                          />
                        )}
                      </div>
                    )}
                  </>
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
    </section>
  );
}
