'use client';

import React, { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ListOrdered,
  Heart,
  Share2,
  Trash2,
  Plus,
  Play,
  Film,
  User,
  Globe,
  Lock,
  Search,
  X,
  Sparkles,
  ArrowLeft,
  Star,
  Check,
} from 'lucide-react';
import { MediaItem, getProxiedImageUrl, formatContentTypeTR } from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';

interface ListDetail {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  visibility: string;
  likes_count: number;
  follower_count: number;
  created_at: string;
  item_count: number;
  creator: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    bio: string | null;
  };
  items: MediaItem[];
}

export default function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const unwrappedParams = use(params);
  const router = useRouter();
  const { user, triggerSound, pushNotification, setIsAuthModalOpen } = useKoUp();

  const [list, setList] = useState<ListDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  // Add Item Omnibox State (Owner only)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchDramaQuery, setSearchDramaQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [isSearchingDramas, setIsSearchingDramas] = useState(false);

  // Edit list metadata
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVisibility, setEditVisibility] = useState<'public' | 'private'>('public');

  const isOwner = Boolean(user?.id && list?.creator?.id && user.id === list.creator.id);

  useEffect(() => {
    async function loadList() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/lists/${unwrappedParams.id}`);
        const data = await res.json();
        if (data.success && data.list) {
          setList(data.list);
          setLikesCount(data.list.likes_count || 0);
          setEditTitle(data.list.title || '');
          setEditDesc(data.list.description || '');
          setEditVisibility(data.list.visibility === 'private' ? 'private' : 'public');
        }
      } catch (err) {
        console.error('Failed to load list details:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadList();
  }, [unwrappedParams.id]);

  // Search dramas to add into list
  useEffect(() => {
    if (!searchDramaQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setIsSearchingDramas(true);
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data } = await supabase
          .from('media')
          .select('id, slug, title, content_type, cover_image, release_year, episode_count')
          .or(`title.ilike.%${searchDramaQuery}%,search_text.ilike.%${searchDramaQuery}%`)
          .limit(10);
        if (data) {
          setSearchResults(data as MediaItem[]);
        }
      } catch (err) {
        console.error('Error searching dramas:', err);
      } finally {
        setIsSearchingDramas(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [searchDramaQuery]);

  const handleToggleLike = () => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    triggerSound('click');
    setIsLiked((prev) => !prev);
    setLikesCount((prev) => (isLiked ? Math.max(0, prev - 1) : prev + 1));
    pushNotification(
      isLiked ? 'Beğeni Kaldırıldı' : 'Liste Beğenildi',
      isLiked ? 'Liste beğenilerinizden kaldırıldı.' : 'Bu liste beğenilerinize eklendi.',
      'info'
    );
  };

  const handleShare = () => {
    triggerSound('click');
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      pushNotification('Bağlantı Kopyalandı', 'Liste bağlantısı panoya kopyalandı.', 'success');
    }
  };

  const handleAddMedia = async (mediaItem: MediaItem) => {
    if (!list) return;
    triggerSound('click');

    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          media_id: mediaItem.id,
          user_id: user?.id,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setList((prev) => {
          if (!prev) return prev;
          const exists = prev.items.some((m) => m.id === mediaItem.id);
          if (exists) return prev;
          return {
            ...prev,
            items: [mediaItem, ...prev.items],
            item_count: prev.item_count + 1,
          };
        });
        pushNotification('Yapım Eklendi', `"${mediaItem.title}" listeye eklendi.`, 'success');
        setSearchDramaQuery('');
        setSearchResults([]);
        setIsAddModalOpen(false);
      }
    } catch (err) {
      console.error('Failed to add media to list:', err);
    }
  };

  const handleRemoveMedia = async (mediaId: number, mediaTitle: string) => {
    if (!list) return;
    triggerSound('click');

    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          media_id: mediaId,
          user_id: user?.id,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setList((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.filter((m) => m.id !== mediaId),
            item_count: Math.max(0, prev.item_count - 1),
          };
        });
        pushNotification('Çıkarıldı', `"${mediaTitle}" listeden kaldırıldı.`, 'info');
      }
    } catch (err) {
      console.error('Failed to remove media:', err);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!list || !editTitle.trim()) return;

    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDesc.trim() || null,
          visibility: editVisibility,
          user_id: user?.id,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setList((prev) => (prev ? { ...prev, title: editTitle, description: editDesc, visibility: editVisibility } : prev));
        pushNotification('Liste Güncellendi', 'Değişiklikleriniz kaydedildi.', 'success');
        setIsEditModalOpen(false);
      }
    } catch (err) {
      console.error('Failed to update list:', err);
    }
  };

  const handleDeleteList = async () => {
    if (!list || !confirm('Bu listeyi kalıcı olarak silmek istediğinizden emin misiniz?')) return;
    try {
      const res = await fetch(`/api/lists/${list.id}?user_id=${user?.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        pushNotification('Liste Silindi', 'Listeniz başarıyla kaldırıldı.', 'info');
        router.push('/listeler');
      }
    } catch (err) {
      console.error('Failed to delete list:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center pt-28">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-white/50 font-mono tracking-wider">Liste Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="pt-28 pb-24 max-w-xl mx-auto px-5 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
          <ListOrdered className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-white">Liste Bulunamadı</h2>
        <p className="text-xs text-white/50">
          Bu liste silinmiş veya yalnızca sahibine özel gizli bir liste olabilir.
        </p>
        <Link
          href="/listeler"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Tüm Listelere Dön</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-mono text-white/45">
        <Link href="/" className="hover:text-white transition-colors">
          Anasayfa
        </Link>
        <span>/</span>
        <Link href="/listeler" className="hover:text-white transition-colors">
          Listeler
        </Link>
        <span>/</span>
        <span className="text-sky-400 font-semibold truncate max-w-xs">{list.title}</span>
      </div>

      {/* HERO BANNER CARD */}
      <div className="rounded-3xl bg-[#0f0f13]/90 border border-white/[0.08] p-6 sm:p-10 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-sky-500/5 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-4 flex-1">
            {/* Header Tags */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-400 font-mono text-[11px] font-bold tracking-wider flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5" />
                <span>Özel Koleksiyon</span>
              </span>

              {list.visibility === 'public' ? (
                <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white/60 font-mono text-[11px] flex items-center gap-1">
                  <Globe className="w-3 h-3 text-sky-400" />
                  <span>Herkese Açık</span>
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-300 font-mono text-[11px] flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Gizli Liste</span>
                </span>
              )}
            </div>

            {/* List Title */}
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
              {list.title}
            </h1>

            {/* Description */}
            {list.description && (
              <p className="text-sm sm:text-base text-white/65 max-w-3xl leading-relaxed font-normal">
                {list.description}
              </p>
            )}

            {/* Creator Pill & Stats */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                href={`/profil/${encodeURIComponent(list.creator?.username || '')}`}
                className="inline-flex items-center gap-2.5 p-1.5 pr-4 rounded-full bg-white/[0.04] border border-white/10 hover:border-white/20 transition-all group"
              >
                <div className="w-7 h-7 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  {list.creator?.avatar_url ? (
                    <img
                      src={getProxiedImageUrl(list.creator.avatar_url, list.creator.username)}
                      alt={list.creator.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-3.5 h-3.5 text-white/70" />
                  )}
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors">
                    {list.creator?.display_name || list.creator?.username}
                  </span>
                  <span className="text-[10px] font-mono text-white/45">
                    @{list.creator?.username}
                  </span>
                </div>
              </Link>

              <div className="flex items-center gap-3 text-xs font-mono text-white/50">
                <span className="flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-sky-400" />
                  <strong className="text-white font-bold">{list.items.length}</strong> Yapım
                </span>
                <span>•</span>
                <span>
                  Oluşturulma:{' '}
                  {new Date(list.created_at).toLocaleDateString('tr-TR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 relative z-10 shrink-0">
            <button
              onClick={handleToggleLike}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-bold cursor-pointer transition-all ${
                isLiked
                  ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                  : 'glass-pill text-white/80 hover:text-white'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-white' : ''}`} />
              <span>{likesCount} Beğeni</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full glass-pill text-xs font-semibold text-white/80 hover:text-white cursor-pointer transition-all"
            >
              <Share2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Paylaş</span>
            </button>

            {isOwner && (
              <>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-all"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Dizi Ekle</span>
                </button>

                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-full glass-pill text-xs font-semibold text-white/80 hover:text-white cursor-pointer"
                >
                  <span>Düzenle</span>
                </button>

                <button
                  onClick={handleDeleteList}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/25 cursor-pointer"
                  title="Listeyi Sil"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* MEDIA GRID */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Listelenen Yapımlar</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/60">
              {list.items.length}
            </span>
          </h2>
        </div>

        {list.items.length === 0 ? (
          <div className="rounded-3xl bg-[#0f0f13] border border-white/[0.08] p-12 text-center space-y-4">
            <Film className="w-12 h-12 text-white/20 mx-auto" />
            <h3 className="text-lg font-bold text-white">Bu listede henüz yapım bulunmuyor</h3>
            {isOwner ? (
              <div>
                <p className="text-xs text-white/50 mb-4">
                  Yukarıdaki &quot;Dizi Ekle&quot; butonuna tıklayarak ilk dizinizi veya animenizi bu listeye ekleyebilirsiniz.
                </p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90"
                >
                  + Dizi Ekle
                </button>
              </div>
            ) : (
              <p className="text-xs text-white/50">Liste sahibi henüz bu listeye içerik eklememiş.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
            {list.items.map((item) => (
              <div
                key={item.id}
                className="group relative rounded-2xl overflow-hidden bg-[#121217] border border-white/[0.08] hover:border-sky-500/40 transition-all duration-300 flex flex-col justify-between"
              >
                <Link
                  href={`/seri/${item.slug}`}
                  onClick={() => triggerSound('click')}
                  className="block relative aspect-[2/3] w-full overflow-hidden bg-[#181820]"
                >
                  {item.cover_image ? (
                    <img
                      src={getProxiedImageUrl(item.cover_image, item.title)}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
                      <Film className="w-8 h-8 text-white/30 mb-2" />
                      <span className="text-xs text-white/50 font-bold">{item.title}</span>
                    </div>
                  )}

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-sky-500 text-white font-bold text-xs shadow-lg">
                      <Play className="w-3 h-3 fill-white" />
                      <span>İzle</span>
                    </span>
                  </div>

                  {/* Rating / Badges */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                    {item.content_type && (
                      <span className="px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md border border-white/10 text-[9px] font-mono font-bold text-white uppercase">
                        {formatContentTypeTR(item.content_type)}
                      </span>
                    )}
                  </div>

                  {item.site_rating && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md border border-white/10 text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1">
                      <Star className="w-2.5 h-2.5 fill-amber-300 text-amber-300" />
                      <span>{Number(item.site_rating).toFixed(1)}</span>
                    </div>
                  )}
                </Link>

                {/* Card Title & Meta */}
                <div className="p-3">
                  <Link
                    href={`/seri/${item.slug}`}
                    className="text-xs sm:text-sm font-bold text-white hover:text-sky-300 transition-colors line-clamp-1"
                  >
                    {item.title}
                  </Link>

                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-white/45">
                    <span>{item.release_year || '—'}</span>
                    <span>{item.episode_count ? `${item.episode_count} Bölüm` : '—'}</span>
                  </div>

                  {/* Owner Remove Button */}
                  {isOwner && (
                    <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex justify-end">
                      <button
                        onClick={() => handleRemoveMedia(item.id, item.title)}
                        className="text-[10px] font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Listeden Çıkar</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ADD DRAMA MODAL (OWNER ONLY) */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg rounded-3xl bg-[#0f0f13] border border-white/15 p-6 shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-sky-400" />
                  <span>Listeye Dizi Ekle</span>
                </h3>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchDramaQuery}
                  onChange={(e) => setSearchDramaQuery(e.target.value)}
                  placeholder="Eklemek istediğiniz diziyi veya animeyi arayın..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-400/60"
                />
              </div>

              {/* Results List */}
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {isSearchingDramas ? (
                  <div className="py-8 text-center text-xs font-mono text-white/40 animate-pulse">
                    Katalog taranıyor...
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((item) => {
                    const alreadyInList = list.items.some((m) => m.id === item.id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-14 rounded-lg overflow-hidden bg-black/40 shrink-0">
                            {item.cover_image ? (
                              <img
                                src={getProxiedImageUrl(item.cover_image, item.title)}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white line-clamp-1">{item.title}</div>
                            <div className="text-[10px] font-mono text-white/45">
                              {item.release_year || '—'} · {formatContentTypeTR(item.content_type)}
                            </div>
                          </div>
                        </div>

                        {alreadyInList ? (
                          <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 pr-2">
                            <Check className="w-3.5 h-3.5" />
                            <span>Listede</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAddMedia(item)}
                            className="px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer transition-all"
                          >
                            + Ekle
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : searchDramaQuery ? (
                  <div className="py-8 text-center text-xs text-white/40">
                    Eşleşen yapım bulunamadı.
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-white/40">
                    Arama kutusuna dizi veya anime adı yazın.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT MODAL (OWNER ONLY) */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg rounded-3xl bg-[#0f0f13] border border-white/15 p-6 shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Listeyi Düzenle</h3>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1.5">Liste Başlığı</label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1.5">Açıklama</label>
                  <textarea
                    rows={3}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-black/60 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-2">Görünürlük</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEditVisibility('public')}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        editVisibility === 'public'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5 mb-0.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>Herkese Açık</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditVisibility('private')}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        editVisibility === 'private'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5 mb-0.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Gizli</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 rounded-full text-xs text-white/60"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 rounded-full bg-white text-black font-bold text-xs"
                  >
                    Kaydet
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
