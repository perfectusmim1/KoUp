'use client';

import React, { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ListOrdered,
  Heart,
  Trash2,
  Plus,
  Film,
  User,
  Globe,
  Lock,
  Search,
  X,
  ArrowLeft,
  Check,
  CheckSquare,
} from 'lucide-react';
import { MediaItem, getProxiedImageUrl, formatContentTypeTR, supabase } from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import AccordionMediaCard from '@/components/AccordionMediaCard';
import { rankSearchResults } from '@/lib/searchRanking';

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
  const user = useKoUpSelector((s) => s.user);
  const authLoading = useKoUpSelector((s) => s.authLoading);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);

  const [list, setList] = useState<ListDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem('koup_liked_custom_lists_v1');
      if (!raw) return false;
      const ids: number[] = JSON.parse(raw);
      return Array.isArray(ids) && ids.includes(Number(unwrappedParams.id));
    } catch {
      return false;
    }
  });
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
    // If auth is still initializing, wait so we can authenticate private list ownership
    if (authLoading) return;

    async function loadList() {
      setIsLoading(true);
      try {
        const userParam = user?.id ? `?user_id=${encodeURIComponent(user.id)}` : '';
        const res = await fetch(`/api/lists/${unwrappedParams.id}${userParam}`);
        const data = await res.json();
        if (data.success && data.list) {
          setList(data.list);
          setLikesCount(data.list.likes_count || 0);
          setEditTitle(data.list.title || '');
          setEditDesc(data.list.description || '');
          setEditVisibility(data.list.visibility === 'private' ? 'private' : 'public');
        } else {
          setList(null);
        }
      } catch (err) {
        console.error('Failed to load list details:', err);
        setList(null);
      } finally {
        setIsLoading(false);
      }
    }
    loadList();
  }, [unwrappedParams.id, user?.id, authLoading]);

  // Reactive like status & exact like counter sync
  useEffect(() => {
    if (!list?.id) return;

    try {
      const raw = localStorage.getItem('koup_liked_custom_lists_v1');
      if (raw) {
        const ids: number[] = JSON.parse(raw);
        if (Array.isArray(ids) && ids.includes(list.id)) {
          setIsLiked(true);
        }
      }
    } catch {}

    let isMounted = true;
    async function syncListLikes() {
      try {
        const { count, error: countErr } = await supabase
          .from('custom_list_likes')
          .select('*', { count: 'exact', head: true })
          .eq('list_id', list!.id);

        if (isMounted && !countErr && typeof count === 'number') {
          setLikesCount(Math.max(count, list?.likes_count || 0));
        }

        if (user?.id) {
          const { data: lData } = await supabase
            .from('custom_list_likes')
            .select('list_id')
            .eq('user_id', user.id)
            .eq('list_id', list!.id)
            .maybeSingle();

          if (isMounted) {
            const userHasLiked = Boolean(lData);
            setIsLiked(userHasLiked);
            try {
              const raw = localStorage.getItem('koup_liked_custom_lists_v1');
              const ids: number[] = raw ? JSON.parse(raw) : [];
              const next = userHasLiked
                ? Array.from(new Set([...ids, list!.id]))
                : ids.filter((id) => id !== list!.id);
              localStorage.setItem('koup_liked_custom_lists_v1', JSON.stringify(next));
            } catch {}
          }
        } else if (!authLoading) {
          if (isMounted) setIsLiked(false);
        }
      } catch (err) {
        console.error('Failed to sync list likes info:', err);
      }
    }

    syncListLikes();
    return () => {
      isMounted = false;
    };
  }, [list?.id, user?.id, authLoading]);

  // Search dramas to add into list
  useEffect(() => {
    const query = searchDramaQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setIsSearchingDramas(true);
      try {
        let items: MediaItem[] = [];

        // 1. Try search_catalog RPC (ordered by fuzzy relevance)
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('search_catalog', {
            p_query: query,
            p_limit: 25,
          });
          if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
            items = rpcData as MediaItem[];
          }
        } catch {}

        // 2. Direct query fallback or enrichment
        if (items.length < 5) {
          const { data: directData } = await supabase
            .from('media')
            .select('id, slug, title, content_type, cover_image, release_year, episode_count, views_total, mdl_rating, imdb_rating, anilist_rating')
            .or(`title.ilike.%${query}%,search_text.ilike.%${query}%,slug.ilike.%${query}%`)
            .limit(30);

          if (directData && directData.length > 0) {
            const existingIds = new Set(items.map((m) => m.id));
            for (const d of directData) {
              if (!existingIds.has(d.id)) {
                items.push(d as MediaItem);
              }
            }
          }
        }

        // 3. Rank with high-accuracy relevance scoring
        const ranked = rankSearchResults(items, query);
        setSearchResults(ranked.slice(0, 15));
      } catch (err) {
        console.error('Error searching dramas:', err);
      } finally {
        setIsSearchingDramas(false);
      }
    }, 200);

    return () => clearTimeout(t);
  }, [searchDramaQuery]);

  // Multi-selection state (Owner only)
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  const toggleSelectItem = (id: number) => {
    triggerSound('click');
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    triggerSound('click');
    if (!list) return;
    if (selectedItemIds.length === list.items.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(list.items.map((i) => i.id));
    }
  };

  const handleDeleteSelected = async () => {
    if (!list || selectedItemIds.length === 0 || isDeletingSelected) return;

    const confirmed = await confirmDialog({
      title: 'Yapımları Listeden Kaldır',
      message: `Seçilen ${selectedItemIds.length} yapımı bu listeden kaldırmak istediğinize emin misiniz?`,
      confirmText: 'Kaldır',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!confirmed) return;

    setIsDeletingSelected(true);
    triggerSound('click');

    const remainingItems = list.items.filter((item) => !selectedItemIds.includes(item.id));
    const remainingIds = remainingItems.map((item) => item.id);

    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_ids: remainingIds,
          user_id: user?.id,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setList((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: remainingItems,
            item_count: remainingItems.length,
          };
        });
        triggerSound('success');
        pushNotification(
          'Yapımlar Kaldırıldı',
          `${selectedItemIds.length} yapım listeden başarıyla kaldırıldı.`,
          'info'
        );
        setSelectedItemIds([]);
        setIsSelectMode(false);
      } else {
        pushNotification('Hata', data.error || 'Yapımlar silinemedi.', 'info');
      }
    } catch {
      pushNotification('Hata', 'İşlem sırasında bağlantı hatası oluştu.', 'info');
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const handleToggleLike = async () => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!list) return;
    triggerSound('click');

    const willLike = !isLiked;
    setIsLiked(willLike);
    setLikesCount((prev) => (willLike ? prev + 1 : Math.max(0, prev - 1)));

    try {
      const raw = localStorage.getItem('koup_liked_custom_lists_v1');
      const ids: number[] = raw ? JSON.parse(raw) : [];
      const next = willLike
        ? Array.from(new Set([...ids, list.id]))
        : ids.filter((id) => id !== list.id);
      localStorage.setItem('koup_liked_custom_lists_v1', JSON.stringify(next));
    } catch {}

    pushNotification(
      willLike ? 'Liste Beğenildi' : 'Beğeni Kaldırıldı',
      willLike ? 'Bu liste beğenilerinize eklendi.' : 'Liste beğenilerinizden kaldırıldı.',
      'info'
    );

    try {
      if (willLike) {
        await supabase
          .from('custom_list_likes')
          .insert({ user_id: user.id, list_id: list.id });
      } else {
        await supabase
          .from('custom_list_likes')
          .delete()
          .eq('user_id', user.id)
          .eq('list_id', list.id);
      }
    } catch (err) {
      console.error('Failed to persist custom list like:', err);
      // Rollback on error
      setIsLiked(!willLike);
      setLikesCount((prev) => (willLike ? Math.max(0, prev - 1) : prev + 1));
      try {
        const raw = localStorage.getItem('koup_liked_custom_lists_v1');
        const ids: number[] = raw ? JSON.parse(raw) : [];
        const next = !willLike
          ? Array.from(new Set([...ids, list.id]))
          : ids.filter((id) => id !== list.id);
        localStorage.setItem('koup_liked_custom_lists_v1', JSON.stringify(next));
      } catch {}
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

    const confirmed = await confirmDialog({
      title: 'Yapımı Listeden Kaldır',
      message: `"${mediaTitle}" yapımını bu listeden çıkarmak istediğinize emin misiniz?`,
      confirmText: 'Çıkar',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!confirmed) return;

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
    if (!list) return;

    const confirmed = await confirmDialog({
      title: 'Listeyi Sil',
      message: `"${list.title}" listesini kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`,
      confirmText: 'Listeyi Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!confirmed) return;

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

  if (isLoading || authLoading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center pt-36 sm:pt-40">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-white/50 font-mono tracking-wider">Liste Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="pt-36 sm:pt-40 pb-24 max-w-xl mx-auto px-5 text-center space-y-4">
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
    <div className="pt-36 sm:pt-40 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
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
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
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
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight text-center md:text-left break-words">
              {list.title}
            </h1>

            {/* Description */}
            {list.description && (
              <p className="text-sm sm:text-base text-white/65 max-w-3xl leading-relaxed font-normal text-center md:text-left break-words">
                {list.description}
              </p>
            )}

            {/* Creator Pill & Stats */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-2">
              <Link
                href={`/profil/${encodeURIComponent(list.creator?.username || '')}`}
                className="inline-flex items-center gap-2.5 p-1.5 pr-4 rounded-full bg-white/[0.04] border border-white/10 hover:border-white/20 transition-colors group"
              >
                <div className="w-7 h-7 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  {list.creator?.avatar_url ? (
                    <img
                      src={getProxiedImageUrl(list.creator.avatar_url, list.creator.username)}
                      alt={list.creator.username}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-3.5 h-3.5 text-white/70" />
                  )}
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors truncate max-w-[140px] sm:max-w-none">
                    {list.creator?.display_name || list.creator?.username}
                  </span>
                  <span className="text-[10px] font-mono text-white/45 truncate max-w-[140px] sm:max-w-none">
                    @{list.creator?.username}
                  </span>
                </div>
              </Link>

              <div className="flex items-center gap-3 text-xs font-mono text-white/50 justify-center">
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
          <div className="flex flex-col md:flex-row items-center gap-2.5 relative z-10 shrink-0 w-full md:w-auto">
            <button
              onClick={handleToggleLike}
              className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-bold cursor-pointer transition-[color,background-color,box-shadow] w-full md:w-auto ${
                isLiked
                  ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                  : 'glass-pill text-white/80 hover:text-white'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-white' : ''}`} />
              <span>{likesCount} Beğeni</span>
            </button>

            {isOwner && (
              <div className="flex flex-col md:flex-row items-center gap-2.5 w-full md:w-auto">
                {/* On mobile: Dizi Ekle and Düzenle side by side */}
                <div className="flex items-center justify-center gap-2 w-full md:w-auto">
                  <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Dizi Ekle</span>
                  </button>

                  <button
                    onClick={() => setIsEditModalOpen(true)}
                    className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full glass-pill text-xs font-semibold text-white/80 hover:text-white cursor-pointer"
                  >
                    <span>Düzenle</span>
                  </button>
                </div>

                {/* On mobile: Sil button centered underneath them */}
                <div className="flex items-center justify-center w-full md:w-auto">
                  <button
                    onClick={handleDeleteList}
                    className="flex items-center justify-center gap-1.5 px-4 md:px-3 py-2 md:py-2.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/25 cursor-pointer transition-colors"
                    aria-label="Listeyi Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="md:hidden">Listeyi Sil</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MEDIA GRID */}
      <div>
        <div className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Listelenen Yapımlar</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/60">
              {list.items.length}
            </span>
          </h2>

          {isOwner && list.items.length > 0 && (
            <div className="flex items-center gap-2">
              {!isSelectMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsSelectMode(true);
                    setSelectedItemIds([]);
                    triggerSound('click');
                  }}
                  className="px-3.5 py-1.5 rounded-full glass-pill hover:bg-white/15 text-xs font-semibold text-white/80 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                  <span>Çoklu Seçim</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors cursor-pointer"
                  >
                    {selectedItemIds.length === list.items.length
                      ? 'Seçimi Kaldır'
                      : 'Tümünü Seç'}
                  </button>

                  {selectedItemIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={isDeletingSelected}
                      className="px-3.5 py-1.5 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-colors shadow-md cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Seçilenleri Sil ({selectedItemIds.length})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsSelectMode(false);
                      setSelectedItemIds([]);
                      triggerSound('click');
                    }}
                    className="px-3 py-1.5 rounded-full text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
                  >
                    Vazgeç
                  </button>
                </div>
              )}
            </div>
          )}
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
                  className="px-5 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-colors"
                >
                  + Dizi Ekle
                </button>
              </div>
            ) : (
              <p className="text-xs text-white/50">Liste sahibi henüz bu listeye içerik eklememiş.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5 pb-6">
            {list.items.map((item, idx) => {
              const isSelected = selectedItemIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  onClickCapture={(e) => {
                    if (isSelectMode) {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelectItem(item.id);
                    }
                  }}
                  className={`relative group ${isSelectMode ? 'cursor-pointer select-none' : ''} [content-visibility:auto] [contain-intrinsic-size:auto_340px]`}
                >
                  <div
                    className={`relative transition-all duration-200 rounded-2xl overflow-hidden ${
                      isSelectMode
                        ? isSelected
                          ? 'ring-4 ring-sky-400 shadow-[0_0_24px_rgba(56,189,248,0.5)] scale-[0.97]'
                          : 'opacity-85 hover:opacity-100 hover:ring-2 hover:ring-white/30'
                        : ''
                    }`}
                  >
                    <div className={isSelectMode ? 'pointer-events-none' : ''}>
                      <AccordionMediaCard item={item} priority={idx < 6} fluidWidth={true} />
                    </div>

                    {/* Integrated Selection Overlay & Checkmark */}
                    {isSelectMode && (
                      <div className="absolute inset-0 z-30 bg-black/15 flex items-start justify-end p-2.5 pointer-events-none">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-xl border ${
                            isSelected
                              ? 'bg-sky-500 border-white text-white scale-110 shadow-[0_0_15px_rgba(56,189,248,0.8)]'
                              : 'bg-black/75 border-white/40 text-transparent'
                          }`}
                        >
                          <Check className={`w-4 h-4 stroke-[3] ${isSelected ? 'text-white' : 'text-transparent'}`} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
              className="fixed inset-0 bg-black/80"
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
                        className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-14 rounded-lg overflow-hidden bg-black/40 shrink-0">
                            {item.cover_image ? (
                              <img
                                src={getProxiedImageUrl(item.cover_image, item.title)}
                                alt={item.title}
                                loading="lazy"
                                decoding="async"
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
                            className="px-3.5 py-1.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 cursor-pointer transition-colors"
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-black/80 cursor-pointer"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-lg rounded-3xl bg-[#0f0f13] border border-white/15 p-6 sm:p-8 shadow-2xl z-10 space-y-5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
                    <ListOrdered className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Listeyi Düzenle</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/80">
                    Liste Başlığı <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder=""
                    className="koup-input text-xs py-2.5 px-4 font-medium"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/80">
                    Açıklama (İsteğe Bağlı)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={250}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder=""
                    className="koup-input text-xs py-2.5 px-4 font-medium resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/80">
                    Görünürlük Durumu
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        triggerSound?.('click');
                        setEditVisibility('public');
                      }}
                      className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-colors ${
                        editVisibility === 'public'
                          ? 'bg-sky-500/15 border-sky-400 text-white shadow-[0_0_18px_rgba(41,151,255,0.22)]'
                          : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5 mb-1">
                        <Globe className={`w-3.5 h-3.5 ${editVisibility === 'public' ? 'text-sky-400' : 'text-white/50'}`} />
                        <span>Herkese Açık</span>
                      </div>
                      <p className="text-[11px] text-white/50">
                        Topluluk listeler sayfasında ve profilinizde herkes görebilir.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerSound?.('click');
                        setEditVisibility('private');
                      }}
                      className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-colors ${
                        editVisibility === 'private'
                          ? 'bg-amber-500/15 border-amber-400 text-white shadow-[0_0_18px_rgba(245,158,11,0.22)]'
                          : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5 mb-1">
                        <Lock className={`w-3.5 h-3.5 ${editVisibility === 'private' ? 'text-amber-400' : 'text-white/50'}`} />
                        <span>Gizli Liste</span>
                      </div>
                      <p className="text-[11px] text-white/50">
                        Yalnızca siz görebilir ve yönetebilirsiniz.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-5 py-2.5 rounded-full glass-pill text-xs text-white/80 hover:text-white font-medium cursor-pointer transition-colors"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg transition-colors"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
