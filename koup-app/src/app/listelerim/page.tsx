'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  FolderHeart,
  Plus,
  Globe,
  Lock,
  Trash2,
  LogIn,
  Search,
  Layers,
  ChevronRight,
  X,
  Compass,
  Image as ImageIcon,
  Heart,
  ArrowUpDown,
  Clock,
  ArrowDownAZ,
} from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';
import { supabase, getProxiedImageUrl } from '@/lib/supabase';
import Pagination from '@/components/Pagination';
import CustomSelect, { SelectOption } from '@/components/CustomSelect';

interface UserCustomList {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  visibility: 'public' | 'private';
  media_ids: number[];
  likes_count: number;
  created_at: string;
  cover_image_url?: string | null;
  backdrop_image_url?: string | null;
  cover_posters?: string[];
}

type MyListSortBy = 'default' | 'newest' | 'oldest' | 'popular' | 'items' | 'title_asc';

const MY_LIST_SORT_OPTIONS: SelectOption[] = [
  {
    value: 'default',
    label: 'Varsayılan Sıralama',
    icon: <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    value: 'popular',
    label: 'En Çok Beğenilen',
    icon: <Heart className="w-3.5 h-3.5 text-rose-400" />,
  },
  {
    value: 'newest',
    label: 'En Yeni Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    value: 'oldest',
    label: 'En Eski Eklenen',
    icon: <Clock className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    value: 'items',
    label: 'En Çok İçerik',
    icon: <Layers className="w-3.5 h-3.5 text-indigo-400" />,
  },
  {
    value: 'title_asc',
    label: 'İsme Göre (A-Z)',
    icon: <ArrowDownAZ className="w-3.5 h-3.5 text-purple-400" />,
  },
];

export default function MyListsPage() {
  const user = useKoUpSelector((s) => s.user);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);

  const [lists, setLists] = useState<UserCustomList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<MyListSortBy>('default');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalCoverUrl, setModalCoverUrl] = useState('');
  const [modalBackdropUrl, setModalBackdropUrl] = useState('');
  const [modalVisibility, setModalVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Load user's lists
  useEffect(() => {
    let isMounted = true;
    async function loadLists() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('custom_lists')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (!error && data && isMounted) {
          // Batch fetch preview posters for media_ids across all lists
          const sampleMediaIds = Array.from(
            new Set(
              data.flatMap((l: any) =>
                Array.isArray(l.media_ids) ? l.media_ids.slice(0, 4) : []
              )
            )
          );

          let posterMap = new Map<number, string>();
          if (sampleMediaIds.length > 0) {
            const { data: mediaRows } = await supabase
              .from('media')
              .select('id, cover_image')
              .in('id', sampleMediaIds);
            if (mediaRows) {
              mediaRows.forEach((m: any) => {
                if (m.cover_image) posterMap.set(m.id, m.cover_image);
              });
            }
          }

          const listIds = data.map((l: any) => l.id).filter(Boolean);
          const realLikeCounts = new Map<number, number>();
          if (listIds.length > 0) {
            const { data: likesRows } = await supabase
              .from('custom_list_likes')
              .select('list_id')
              .in('list_id', listIds);
            if (Array.isArray(likesRows)) {
              for (const row of likesRows) {
                const lid = Number((row as any).list_id);
                realLikeCounts.set(lid, (realLikeCounts.get(lid) || 0) + 1);
              }
            }
          }

          const formattedLists: UserCustomList[] = data.map((l: any) => {
            const posters = Array.isArray(l.media_ids)
              ? (l.media_ids as number[])
                  .slice(0, 4)
                  .map((id) => posterMap.get(id))
                  .filter(Boolean) as string[]
              : [];
            const exactLikes = realLikeCounts.get(l.id) ?? 0;
            return {
              id: l.id,
              slug: l.slug,
              title: l.title,
              description: l.description,
              visibility: l.visibility || 'public',
              media_ids: Array.isArray(l.media_ids) ? l.media_ids : [],
              likes_count: Math.max(exactLikes, l.likes_count || 0),
              created_at: l.created_at,
              cover_image_url: l.cover_image_url || null,
              backdrop_image_url: l.backdrop_image_url || null,
              cover_posters: posters,
            };
          });

          if (isMounted) {
            setLists(formattedLists);
          }
        }
      } catch (err) {
        console.error('Failed to load user custom lists:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadLists();
    return () => {
      isMounted = false;
    };
  }, [user]);

  // Create List Handler
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!modalTitle.trim() || modalTitle.trim().length < 2) {
      setModalError('Liste başlığı en az 2 karakter olmalıdır.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);
    triggerSound('click');

    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: modalTitle.trim(),
          description: modalDesc.trim() || null,
          cover_image_url: modalCoverUrl.trim() || null,
          backdrop_image_url: modalBackdropUrl.trim() || null,
          visibility: modalVisibility,
          user_id: user.id,
          media_ids: [],
        }),
      });

      const d = await res.json();
      if (d.success && d.list) {
        triggerSound('success');
        pushNotification('Liste Oluşturuldu', `"${d.list.title}" listeniz başarıyla oluşturuldu.`, 'success');
        setLists((prev) => [
          {
            id: d.list.id,
            slug: d.list.slug,
            title: d.list.title,
            description: d.list.description,
            visibility: d.list.visibility,
            media_ids: [],
            likes_count: 0,
            created_at: d.list.created_at,
            cover_image_url: d.list.cover_image_url || modalCoverUrl.trim() || null,
            backdrop_image_url: d.list.backdrop_image_url || modalBackdropUrl.trim() || null,
            cover_posters: [],
          },
          ...prev,
        ]);
        setIsModalOpen(false);
        setModalTitle('');
        setModalDesc('');
        setModalCoverUrl('');
        setModalBackdropUrl('');
        setModalVisibility('public');
      } else {
        setModalError(d.error || 'Liste oluşturulamadı.');
      }
    } catch {
      setModalError('Bağlantı hatası oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete List Handler
  const handleDeleteList = async (id: number) => {
    if (!user) return;
    triggerSound('click');

    try {
      const res = await fetch(`/api/lists/${id}?user_id=${user.id}`, {
        method: 'DELETE',
      });
      const d = await res.json();
      if (d.success) {
        triggerSound('success');
        pushNotification('Liste Silindi', 'Özel listeniz başarıyla kaldırıldı.', 'info');
        setLists((prev) => prev.filter((l) => l.id !== id));
      } else {
        pushNotification('Hata', d.error || 'Liste silinemedi.', 'info');
      }
    } catch {
      pushNotification('Hata', 'Liste silinirken bir hata oluştu.', 'info');
    } finally {
      setDeletingId(null);
    }
  };

  // Filtered & sorted lists
  const filteredLists = useMemo(() => {
    let result = [...lists];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          (l.description && l.description.toLowerCase().includes(q))
      );
    }

    if (sortBy === 'newest') {
      result.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else if (sortBy === 'oldest') {
      result.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    } else if (sortBy === 'popular') {
      result.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (sortBy === 'items') {
      result.sort((a, b) => (b.media_ids?.length || 0) - (a.media_ids?.length || 0));
    } else if (sortBy === 'title_asc') {
      result.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'tr'));
    }

    return result;
  }, [lists, searchQuery, sortBy]);

  // Paginated slice
  const paginatedLists = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLists.slice(start, start + PAGE_SIZE);
  }, [filteredLists, currentPage]);

  // If user is not logged in
  if (!user) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center pt-28 pb-20 px-5">
        <div className="max-w-md w-full rounded-3xl bg-[#0f0f12]/95 border border-white/10 p-8 sm:p-10 text-center space-y-6 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.15)] backdrop-blur-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(41,151,255,0.25)]">
            <FolderHeart className="w-10 h-10 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Özel Listelerim
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-xs mx-auto">
              Kişisel koleksiyonlar oluşturmak ve yönetmek için lütfen giriş yapın.
            </p>
          </div>

          <button
            onClick={() => {
              triggerSound('click');
              setIsAuthModalOpen(true);
            }}
            className="w-full py-3 px-6 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-lg flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Giriş Yap veya Kayıt Ol</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Özel Listelerim
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/listeler"
            onClick={() => triggerSound('click')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span>Topluluk Listelerini Keşfet</span>
          </Link>

          <button
            onClick={() => {
              triggerSound('click');
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Liste Oluştur</span>
          </button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="rounded-3xl bg-[#0f0f11] p-4 sm:p-5 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xl">
        <div className="text-xs font-mono text-white/60">
          Toplam <strong className="text-white font-bold">{lists.length}</strong> özel koleksiyon
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/50 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 w-full sm:w-64 lg:w-72 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.25)]">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Listelerimde ara..."
              className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
            />
            {searchQuery ? (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="text-white/50 hover:text-white transition-colors cursor-pointer shrink-0"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          <div className="w-full sm:w-56">
            <CustomSelect
              value={sortBy}
              onChange={(val) => {
                triggerSound('click');
                setSortBy(val as MyListSortBy);
                setCurrentPage(1);
              }}
              options={MY_LIST_SORT_OPTIONS}
              size="sm"
              aria-label="Listelerim Sıralaması"
            />
          </div>
        </div>
      </div>

      {/* Lists Grid */}
      {isLoading ? (
        <div className="min-h-[40vh] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(56,189,248,0.4)]" />
            <p className="text-xs text-white/50 font-mono tracking-wider">Listeleriniz yükleniyor...</p>
          </div>
        </div>
      ) : filteredLists.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f11] p-16 text-center border border-white/10 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <FolderHeart className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-white">
              {searchQuery.trim()
                ? 'Aramanıza uygun bir liste bulunamadı'
                : 'Henüz özel bir liste oluşturmadınız'}
            </h3>
            <p className="text-xs text-white/50 max-w-sm mx-auto">
              {searchQuery.trim()
                ? 'Farklı bir anahtar kelime deneyebilirsiniz.'
                : 'Hemen ilk tematik Asya dizisi veya anime koleksiyonunuzu oluşturun.'}
            </p>
          </div>
          <button
            onClick={() => {
              triggerSound('click');
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Liste Oluştur</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedLists.map((l) => {
            const itemCount = l.media_ids.length;
            const isPublic = l.visibility === 'public';
            const bgImage = l.backdrop_image_url || l.cover_image_url || (l.cover_posters && l.cover_posters[0]) || null;

            return (
              <div
                key={l.id}
                className="group relative rounded-3xl overflow-hidden min-h-[270px] sm:min-h-[290px] border border-white/10 hover:border-sky-400/50 p-6 flex flex-col justify-between transition-all duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_35px_rgba(56,189,248,0.22)] [content-visibility:auto] [contain-intrinsic-size:auto_290px]"
              >
                {/* GPU Ambient Glow */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-sky-500/20 via-sky-400/10 to-indigo-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none -z-10" />

                {/* Full-bleed Immersive Background Artwork */}
                {bgImage ? (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <img
                      src={getProxiedImageUrl(bgImage, l.title)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-[#0e0e14] bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
                )}

                {/* Multi-layer Cinematic Shadow Gradients for Readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#09090d] via-[#09090d]/80 via-50% to-black/35 group-hover:via-[#09090d]/70 transition-colors duration-300 pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#09090d]/85 via-[#09090d]/40 to-transparent pointer-events-none" />

                {/* Top Bar: Glass Badges & Actions */}
                <div className="relative z-10 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isPublic ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-sky-400 text-[10px] font-mono font-semibold shadow-sm">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span>Herkese Açık</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-amber-300 text-[10px] font-mono font-semibold shadow-sm">
                        <Lock className="w-3 h-3 text-amber-400" />
                        <span>Gizli Liste</span>
                      </span>
                    )}
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/80 text-[10px] font-mono shadow-sm">
                      {itemCount} Yapım
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingId(l.id);
                    }}
                    className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md border border-white/15 hover:bg-rose-500/20 hover:border-rose-500/40 text-white/70 hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
                    aria-label="Listeyi Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bottom Content Area */}
                <div className="relative z-10 mt-6 pt-4 flex flex-col justify-end">
                  <div className="flex items-end gap-3.5">
                    {/* Front Cover Poster Card (if cover_image_url is set) */}
                    {l.cover_image_url && (
                      <Link
                        href={`/listeler/${l.slug || l.id}`}
                        onClick={() => triggerSound('click')}
                        className="w-16 h-24 sm:w-20 sm:h-28 rounded-2xl overflow-hidden shrink-0 border border-white/20 shadow-[0_10px_25px_rgba(0,0,0,0.85)] bg-black/60 relative group-hover:scale-105 transition-transform duration-300 block"
                      >
                        <img
                          src={getProxiedImageUrl(l.cover_image_url, l.title)}
                          alt={l.title}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </Link>
                    )}

                    {/* Title & Description */}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/listeler/${l.slug || l.id}`}
                        onClick={() => triggerSound('click')}
                        className="text-lg sm:text-xl font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1 drop-shadow-md break-words block"
                      >
                        {l.title}
                      </Link>
                      {l.description ? (
                        <p className="text-xs text-white/70 mt-1 line-clamp-2 leading-relaxed drop-shadow-sm break-words">
                          {l.description}
                        </p>
                      ) : (
                        <p className="text-xs text-white/40 italic mt-1">
                          Açıklama belirtilmemiş.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footer Bar */}
                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-white/50">
                      {new Date(l.created_at).toLocaleDateString('tr-TR')}
                    </span>
                    <Link
                      href={`/listeler/${l.slug || l.id}`}
                      onClick={() => triggerSound('click')}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 group-hover:text-sky-300 transition-colors cursor-pointer"
                    >
                      <span>Listeyi Görüntüle</span>
                      <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>

                {/* Delete Confirmation Overlay */}
                <AnimatePresence>
                  {deletingId === l.id && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-[#0d0d10]/95 backdrop-blur-md p-6 flex flex-col justify-center items-center text-center space-y-3 z-30"
                    >
                      <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                        <Trash2 className="w-5 h-5" />
                      </div>
                      <div className="text-xs font-bold text-white line-clamp-2 break-words">
                        &quot;{l.title}&quot; listesini silmek istiyor musunuz?
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs text-white font-medium cursor-pointer transition-colors"
                        >
                          Vazgeç
                        </button>
                        <button
                          onClick={() => handleDeleteList(l.id)}
                          className="px-4 py-1.5 rounded-full bg-rose-500 text-white text-xs font-bold hover:bg-rose-600 cursor-pointer shadow-md transition-colors"
                        >
                          Evet, Sil
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {!isLoading && filteredLists.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredLists.length}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="özel listeden"
          scrollToOffset={240}
        />
      )}

      {/* CREATE NEW LIST MODAL */}
      <AnimatePresence>
        {isModalOpen && (
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
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 cursor-pointer"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar rounded-3xl bg-[#0f0f13] border border-white/15 p-6 sm:p-7 shadow-2xl z-10 space-y-5"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-400/20 flex items-center justify-center text-sky-400">
                    <Plus className="w-4 h-4" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Yeni Liste Oluştur</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleCreateList} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/80">
                    Liste Başlığı <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={modalTitle}
                    onChange={(e) => setModalTitle(e.target.value)}
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
                    value={modalDesc}
                    onChange={(e) => setModalDesc(e.target.value)}
                    placeholder=""
                    className="koup-input text-xs py-2.5 px-4 font-medium resize-none"
                  />
                </div>

                {/* Two Image Inputs: Cover & Backdrop */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Front Cover Poster */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-white/80">
                      <span>Ön Kapak URL (İsteğe Bağlı)</span>
                      {modalCoverUrl && (
                        <button
                          type="button"
                          onClick={() => setModalCoverUrl('')}
                          className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                        >
                          Temizle
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="url"
                        value={modalCoverUrl}
                        onChange={(e) => setModalCoverUrl(e.target.value)}
                        placeholder="https://... (Ön afiş görseli)"
                        className="koup-input text-xs py-2.5 px-4 font-medium pr-10"
                      />
                      <ImageIcon className="w-4 h-4 text-white/30 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {modalCoverUrl.trim().length > 10 && (
                      <div className="mt-1.5 relative h-20 rounded-xl overflow-hidden border border-white/15 bg-black/40">
                        <img
                          src={getProxiedImageUrl(modalCoverUrl.trim(), 'Ön Kapak')}
                          alt="Ön Kapak Önizleme"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-1 left-2 text-[8px] font-mono text-white/80 bg-black/70 px-1.5 py-0.5 rounded backdrop-blur-sm">
                          Ön Kapak Önizleme
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Backdrop Banner */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-white/80">
                      <span>Arka Plan URL (İsteğe Bağlı)</span>
                      {modalBackdropUrl && (
                        <button
                          type="button"
                          onClick={() => setModalBackdropUrl('')}
                          className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                        >
                          Temizle
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="url"
                        value={modalBackdropUrl}
                        onChange={(e) => setModalBackdropUrl(e.target.value)}
                        placeholder="https://... (Banner görseli)"
                        className="koup-input text-xs py-2.5 px-4 font-medium pr-10"
                      />
                      <ImageIcon className="w-4 h-4 text-white/30 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {modalBackdropUrl.trim().length > 10 && (
                      <div className="mt-1.5 relative h-20 rounded-xl overflow-hidden border border-white/15 bg-black/40">
                        <img
                          src={getProxiedImageUrl(modalBackdropUrl.trim(), 'Arka Plan')}
                          alt="Arka Plan Önizleme"
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-1 left-2 text-[8px] font-mono text-white/80 bg-black/70 px-1.5 py-0.5 rounded backdrop-blur-sm">
                          Arka Plan Önizleme
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Visibility selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/80">
                    Gizlilik Ayarı
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        setModalVisibility('public');
                      }}
                      className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-colors ${
                        modalVisibility === 'public'
                          ? 'bg-sky-500/15 border-sky-400 text-white shadow-[0_0_18px_rgba(41,151,255,0.22)]'
                          : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Globe className={`w-3.5 h-3.5 ${modalVisibility === 'public' ? 'text-sky-400' : 'text-white/50'}`} />
                        <span>Herkese Açık</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        setModalVisibility('private');
                      }}
                      className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-colors ${
                        modalVisibility === 'private'
                          ? 'bg-amber-500/15 border-amber-400 text-white shadow-[0_0_18px_rgba(245,158,11,0.22)]'
                          : 'bg-white/[0.04] border-white/10 text-white/60 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <Lock className={`w-3.5 h-3.5 ${modalVisibility === 'private' ? 'text-amber-400' : 'text-white/50'}`} />
                        <span>Gizli Liste</span>
                      </div>
                    </button>
                  </div>
                </div>

                {modalError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 font-mono">
                    {modalError}
                  </div>
                )}

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-2.5 rounded-full glass-pill text-xs text-white/80 hover:text-white font-medium cursor-pointer transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-full bg-white text-black text-xs font-bold hover:bg-white/90 cursor-pointer shadow-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {isSubmitting ? 'Oluşturuluyor...' : 'Listeyi Oluştur'}
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
