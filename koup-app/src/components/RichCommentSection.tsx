'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bold,
  Italic,
  Heading2,
  EyeOff,
  Clock,
  Image as ImageIcon,
  Smile,
  Sparkles,
  Heart,
  Reply,
  Send,
  AlertCircle,
  User,
} from 'lucide-react';
import { supabase, getProxiedImageUrl } from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

interface CommentRow {
  id: string;
  user_id?: string;
  target_type: 'media' | 'episode' | 'person' | 'magazine';
  media_id?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  person_id?: number | null;
  magazine_id?: number | null;
  parent_id?: string | null;
  author_username: string;
  author_avatar?: string | null;
  title?: string | null;
  content_html: string;
  has_spoiler: boolean;
  timestamp_sec?: number | null;
  gif_url?: string | null;
  sticker_id?: string | null;
  image_url?: string | null;
  likes_count: number;
  created_at: string;
}

const APPLE_DARK_PALETTE = [
  { name: 'Beyaz', hex: '#FFFFFF' },
  { name: 'Lumina Mavi', hex: '#38BDF8' },
  { name: 'Sinema Kehribar', hex: '#E5A93C' },
  { name: 'Kore Mercan', hex: '#FB7185' },
  { name: 'Zümrüt', hex: '#34D399' },
  { name: 'Lavanta', hex: '#C084FC' },
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
  const { user, pushNotification } = useKoUp();

  const [comments, setComments] = useState<CommentRow[]>([]);
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

  const storageKey = `koup_comments_${targetType}_${mediaId || personId || magazineId}_${seasonNumber || 0}_${episodeNumber || 0}`;

  const loadComments = useCallback(async () => {
    let query = supabase
      .from('comments')
      .select('*')
      .eq('target_type', targetType)
      .order('created_at', { ascending: false })
      .limit(50);

    if (mediaId) query = query.eq('media_id', mediaId);
    if (personId) query = query.eq('person_id', personId);
    if (magazineId) query = query.eq('magazine_id', magazineId);

    const { data } = await query;
    const localRaw = localStorage.getItem(storageKey);
    const localArr: CommentRow[] = localRaw ? JSON.parse(localRaw) : [];

    const combined = [...localArr, ...((data as CommentRow[]) || [])];
    const seen = new Set<string>();
    const deduped = combined.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    setComments(deduped);
  }, [targetType, mediaId, personId, magazineId, storageKey]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bodyText.trim() && !selectedGif && !selectedSticker) return;

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

    const formattedHtml = `<div style="color:${selectedColor};font-weight:${
      isBold || isHeading ? '700' : '400'
    };font-style:${isItalic ? 'italic' : 'normal'};font-size:${
      isHeading ? '1.1rem' : '0.92rem'
    }">${bodyText
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')}</div>`;

    const newComment: CommentRow = {
      id: `c-${Date.now()}`,
      target_type: targetType,
      media_id: mediaId || null,
      season_number: seasonNumber || null,
      episode_number: episodeNumber || null,
      person_id: personId || null,
      magazine_id: magazineId || null,
      parent_id: replyTo?.id || null,
      author_username: user?.display_name || user?.username || 'KoUp İzleyici',
      author_avatar: user?.avatar_url || null,
      title: title.trim() || null,
      content_html: formattedHtml,
      has_spoiler: hasSpoiler,
      timestamp_sec: tsSec,
      gif_url: selectedGif,
      sticker_id: selectedSticker,
      image_url: safeImageUrl,
      likes_count: 1,
      created_at: new Date().toISOString(),
    };

    const next = [newComment, ...comments];
    setComments(next);
    try {
      const localRaw = localStorage.getItem(storageKey);
      const localArr: CommentRow[] = localRaw ? JSON.parse(localRaw) : [];
      localStorage.setItem(storageKey, JSON.stringify([newComment, ...localArr]));
    } catch {
      // ignore
    }

    setTitle('');
    setBodyText('');
    setHasSpoiler(false);
    setTimestampInput('');
    setImageUrlInput('');
    setSelectedGif(null);
    setSelectedSticker(null);
    setReplyTo(null);

    pushNotification(
      replyTo ? 'Yanıtın Gönderildi' : 'Yorumun Yayınlandı',
      `${targetTitle} tartışmasına katkın eklendi.`,
      'reply'
    );
  };

  const toggleLike = (id: string) => {
    const already = likedIds[id];
    setLikedIds((prev) => ({ ...prev, [id]: !already }));
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, likes_count: Math.max(0, c.likes_count + (already ? -1 : 1)) }
          : c
      )
    );
  };

  return (
    <section className="mt-10 rounded-3xl apple-glass p-6 sm:p-8 border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 mb-6 border-b border-white/10">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-white/75" />
            <span>Topluluk Yorumları & Tartışma ({comments.length})</span>
          </h3>
          <p className="text-xs text-white/55 mt-0.5">
            {targetTitle} hakkında başlık, renkli yazı, GIF, etiket veya görsel URL ile yorum bırak
          </p>
        </div>
      </div>

      {/* RICH CUSTOMIZABLE COMMENT COMPOSER */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 sm:p-5 mb-8 space-y-3.5"
      >
        {replyTo && (
          <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs text-white/85">
            <span>@{replyTo.author_username} yorumuna yanıt veriyorsun</span>
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
            onClick={() => setIsBold((v) => !v)}
            className={`p-1.5 rounded-lg text-xs cursor-pointer ${
              isBold ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
            }`}
            title="Kalın Yazı"
          >
            <Bold className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsItalic((v) => !v)}
            className={`p-1.5 rounded-lg text-xs cursor-pointer ${
              isItalic ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'
            }`}
            title="İtalik Yazı"
          >
            <Italic className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/15 mx-1" />

          {/* 8-Color Apple Dark Theme Palette */}
          <div className="flex items-center gap-1">
            {APPLE_DARK_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setSelectedColor(c.hex)}
                title={`Yazı Rengi: ${c.name}`}
                style={{ backgroundColor: c.hex }}
                className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                  selectedColor === c.hex ? 'scale-125 ring-2 ring-white' : 'opacity-75 hover:opacity-100'
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
                ? 'bg-red-500/25 text-red-300 border border-red-400/40'
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
          <div className="flex items-center gap-1 ml-auto bg-white/[0.05] px-2 py-0.5 rounded-lg border border-white/10">
            <Clock className="w-3 h-3 text-white/60" />
            <input
              type="text"
              value={timestampInput}
              onChange={(e) => setTimestampInput(e.target.value)}
              placeholder="14:20"
              className="w-12 bg-transparent text-[11px] font-mono text-white placeholder-white/35 focus:outline-none"
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
            placeholder="https://... (Görsel URL'si yapıştırın — Cloudflare Proxy ile gösterilir)"
            className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/35"
          />
        )}

        {/* Main Textarea with Live Color & Style Preview */}
        <textarea
          rows={3}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          style={{
            color: selectedColor,
            fontWeight: isBold || isHeading ? 700 : 400,
            fontStyle: isItalic ? 'italic' : 'normal',
          }}
          placeholder="Düşüncelerini, teorilerini veya sahne analizini yaz..."
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
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white text-xs"
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
                  className="text-xs text-white/60"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-white/45 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-white/60" />
            DOMPurify XSS & SSRF Koruması Aktif
          </span>
          <button
            type="submit"
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:scale-105 transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Yorumu Gönder</span>
          </button>
        </div>
      </form>

      {/* COMMENTS LIST */}
      <div className="space-y-3.5">
        {comments.length === 0 ? (
          <div className="py-10 text-center text-sm text-white/45">
            Henüz yorum yapılmamış. İlk yorumu sen bırak!
          </div>
        ) : (
          comments.map((c) => {
            const isSpoilerHidden = c.has_spoiler && !revealedSpoilers[c.id];
            return (
              <div
                key={c.id}
                className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {c.author_avatar ? (
                      <img
                        src={getProxiedImageUrl(c.author_avatar)}
                        alt={c.author_username}
                        className="w-8 h-8 rounded-full object-cover border border-white/15"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/75">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{c.author_username}</span>
                        {c.timestamp_sec && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">
                            <Clock className="w-2.5 h-2.5" />
                            <span>
                              {Math.floor(c.timestamp_sec / 60)}:
                              {String(c.timestamp_sec % 60).padStart(2, '0')}
                            </span>
                          </span>
                        )}
                        {c.sticker_id && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-200 text-[10px] font-mono">
                            {c.sticker_id}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-white/40">
                        {new Date(c.created_at).toLocaleDateString('tr-TR')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleLike(c.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
                        likedIds[c.id]
                          ? 'bg-pink-500/20 border-pink-400 text-pink-300'
                          : 'bg-white/[0.05] border-white/10 text-white/70 hover:text-white'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${likedIds[c.id] ? 'fill-pink-400' : ''}`}
                      />
                      <span>{c.likes_count}</span>
                    </button>

                    <button
                      onClick={() => setReplyTo(c)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white cursor-pointer"
                    >
                      <Reply className="w-3.5 h-3.5" />
                      <span>Yanıtla</span>
                    </button>
                  </div>
                </div>

                {c.title && (
                  <h4 className="text-sm font-bold text-white pt-1">{c.title}</h4>
                )}

                {isSpoilerHidden ? (
                  <button
                    onClick={() =>
                      setRevealedSpoilers((prev) => ({ ...prev, [c.id]: true }))
                    }
                    className="w-full py-3 px-4 rounded-xl bg-red-950/30 border border-red-400/30 text-xs text-red-200 flex items-center justify-center gap-2 cursor-pointer hover:bg-red-950/50 transition-all"
                  >
                    <EyeOff className="w-4 h-4" />
                    <span>Bu yorum Spoiler içeriyor · Görmek için tıkla</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div
                      className="text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: c.content_html }}
                    />
                    {c.gif_url && (
                      <img
                        src={c.gif_url}
                        alt="Yorum GIF"
                        className="max-h-44 rounded-xl border border-white/10"
                      />
                    )}
                    {c.image_url && (
                      <img
                        src={getProxiedImageUrl(c.image_url)}
                        alt="Yorum Görseli"
                        className="max-h-60 rounded-xl border border-white/10"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
