'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ListOrdered,
  Search,
  Plus,
  Heart,
  Film,
  ArrowRight,
  TrendingUp,
  Clock,
  Layers,
  X,
  Lock,
  Globe,
  User,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/supabase';
import { useKoUpSelector } from '@/context/KoUpContext';
import Pagination from '@/components/Pagination';

interface ListCreator {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

interface PreviewPoster {
  id: number;
  slug: string;
  title: string;
  cover_image: string | null;
}

interface CustomListRecord {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  cover_image_url?: string | null;
  backdrop_image_url?: string | null;
  visibility: string;
  likes_count: number;
  follower_count: number;
  created_at: string;
  media_ids: number[];
  item_count: number;
  creator: ListCreator;
  preview_posters: PreviewPoster[];
}

type ListSortBy = 'popular' | 'newest' | 'items' | 'default' | 'oldest';

export default function PublicListsPage() {
  const user = useKoUpSelector((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'mod';
  const confirmDialog = useKoUpSelector((s) => s.confirmDialog);
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const pushNotification = useKoUpSelector((s) => s.pushNotification);
  const setIsAuthModalOpen = useKoUpSelector((s) => s.setIsAuthModalOpen);

  const [lists, setLists] = useState<CustomListRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<ListSortBy>('popular');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Create List Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [newListCover, setNewListCover] = useState('');
  const [newListBackdrop, setNewListBackdrop] = useState('');
  const [newListVisibility, setNewListVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initial load
  useEffect(() => {
    async function fetchLists() {
      setIsLoading(true);
      try {
        const res = await fetch('/api/lists');
        const data = await res.json();
        if (data.success && Array.isArray(data.lists)) {
          setLists(data.lists);
        }
      } catch (err) {
        console.error('Failed to load public lists:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchLists();
  }, []);

  // Instant Client-side filtering & sorting
  const filteredLists = useMemo(() => {
    let result = [...lists];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        const t = (item.title || '').toLowerCase();
        const d = (item.description || '').toLowerCase();
        const u = (item.creator?.username || '').toLowerCase();
        const dn = (item.creator?.display_name || '').toLowerCase();
        return t.includes(q) || d.includes(q) || u.includes(q) || dn.includes(q);
      });
    }

    if (sortBy === 'popular') {
      result.sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
    } else if (sortBy === 'items') {
      result.sort((a, b) => (b.item_count || 0) - (a.item_count || 0));
    } else if (sortBy === 'newest') {
      result.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else if (sortBy === 'oldest') {
      result.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }

    return result;
  }, [lists, searchQuery, sortBy]);

  const handleDeleteListFromCard = async (e: React.MouseEvent, targetList: CustomListRecord) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.id) return;

    const confirmed = await confirmDialog({
      title: 'Listeyi Sil',
      message: `"${targetList.title}" listesini kalıcı olarak silmek istediğinize emin misiniz?`,
      confirmText: 'Listeyi Sil',
      cancelText: 'Vazgeç',
      isDestructive: true,
      icon: 'trash',
    });
    if (!confirmed) return;

    triggerSound('click');
    try {
      const res = await fetch(`/api/lists/${targetList.id}?user_id=${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (data.success || res.status === 404) {
        triggerSound('success');
        pushNotification('Liste Silindi', `"${targetList.title}" listesi kaldırıldı.`, 'info');
        setLists((prev) => prev.filter((l) => l.id !== targetList.id));
      } else {
        pushNotification('Hata', data.error || 'Liste silinemedi.', 'info');
      }
    } catch {
      pushNotification('Hata', 'Silme işlemi sırasında hata oluştu.', 'info');
    }
  };

  // Paginated slice for current page
  const paginatedLists = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLists.slice(start, start + PAGE_SIZE);
  }, [filteredLists, currentPage]);

  const handleOpenCreateModal = () => {
    if (!user) {
      setIsAuthModalOpen(true);
      return;
    }
    triggerSound('click');
    setIsCreateModalOpen(true);
  };

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) {
      pushNotification('Eksik Bilgi', 'Lütfen liste için bir başlık girin.', 'info');
      return;
    }
    if (!user?.id) {
      setIsAuthModalOpen(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newListTitle.trim(),
          description: newListDesc.trim() || null,
          cover_image_url: newListCover.trim() || null,
          backdrop_image_url: newListBackdrop.trim() || null,
          visibility: newListVisibility,
          user_id: user.id,
          media_ids: [],
        }),
      });

      const data = await res.json();
      if (data.success && data.list) {
        triggerSound('click');
        pushNotification(
          'Liste Oluşturuldu',
          `"${newListTitle.trim()}" listesi başarıyla kaydedildi.`,
          'success'
        );

        // Optimistically prepend to list
        const newListRecord: CustomListRecord = {
          id: data.list.id,
          slug: data.list.slug,
          title: data.list.title,
          description: data.list.description,
          cover_image_url: data.list.cover_image_url || newListCover.trim() || null,
          backdrop_image_url: data.list.backdrop_image_url || newListBackdrop.trim() || null,
          visibility: data.list.visibility,
          likes_count: 0,
          follower_count: 0,
          created_at: data.list.created_at,
          media_ids: [],
          item_count: 0,
          creator: {
            id: user.id,
            username: user.username,
            display_name: user.display_name || user.username,
            avatar_url: user.avatar_url || null,
          },
          preview_posters: [],
        };

        setLists((prev) => [newListRecord, ...prev]);
        setNewListTitle('');
        setNewListDesc('');
        setNewListCover('');
        setNewListBackdrop('');
        setIsCreateModalOpen(false);
      } else {
        pushNotification('Hata', data.error || 'Liste oluşturulamadı', 'info');
      }
    } catch (err: any) {
      pushNotification('Bağlantı Hatası', err?.message || 'Bir hata meydana geldi', 'info');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pt-36 sm:pt-40 pb-24 max-w-[1680px] mx-auto px-5 sm:px-8 lg:px-14 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-mono text-white/45">
        <Link href="/" className="hover:text-white transition-colors">
          Anasayfa
        </Link>
        <span>/</span>
        <span className="text-sky-400 font-semibold">Listeler</span>
      </div>

      {/* HEADER HERO */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
            Listeler
          </h1>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {user && (
            <Link
              href="/listelerim"
              onClick={() => triggerSound('click')}
              className="flex items-center gap-2 px-5 py-3 rounded-full glass-pill text-white font-bold text-xs sm:text-sm hover:bg-white/15 cursor-pointer transition-colors"
            >
              <ListOrdered className="w-4 h-4 text-sky-400" />
              <span>Listelerim</span>
            </Link>
          )}

          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black font-extrabold text-xs sm:text-sm hover:bg-white/85 active:bg-white/75 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-colors duration-200"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Yeni Liste Oluştur</span>
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search bar */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-colors duration-200 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] flex-1 max-w-md">
          <Search className="w-4 h-4 text-white/60 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="İçerik, liste veya kullanıcı ara..."
            className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="text-white/40 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Sort Pill Buttons */}
        <div className="flex items-center gap-1.5 p-1 rounded-full glass-pill-dark border border-white/10 overflow-x-auto no-scrollbar shrink-0">
          {(
            [
              {
                id: 'popular',
                label: 'En Popüler',
                icon: TrendingUp,
                activePillClass: 'bg-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.45)]',
                activeTextClass: 'text-white font-extrabold',
              },
              {
                id: 'items',
                label: 'En Çok İçerik',
                icon: Layers,
                activePillClass: 'bg-sky-500 shadow-[0_0_20px_rgba(56,189,248,0.45)]',
                activeTextClass: 'text-white font-extrabold',
              },
              {
                id: 'newest',
                label: 'En Yeni',
                icon: Clock,
                activePillClass: 'bg-emerald-500 shadow-[0_0_20px_rgba(52,211,153,0.45)]',
                activeTextClass: 'text-white font-extrabold',
              },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  triggerSound('click');
                  setSortBy(opt.id);
                  setCurrentPage(1);
                }}
                className={`relative shrink-0 flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors duration-200 select-none ${
                  active ? opt.activeTextClass : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="listeler-sort-pill"
                    initial={false}
                    transition={{
                      type: 'spring',
                      stiffness: 480,
                      damping: 34,
                      mass: 0.6,
                    }}
                    className={`absolute inset-0 rounded-full ${opt.activePillClass}`}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* LISTS GRID (2 COLUMNS MATCHING LIVE CARD LAYOUT) */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-3xl bg-[#0e0e14] border border-white/10 p-6 flex flex-col justify-between min-h-[270px] sm:min-h-[290px] animate-pulse relative overflow-hidden"
            >
              {/* Top Bar Skeleton: Creator Info & Badges */}
              <div className="flex items-center justify-between gap-3">
                <div className="h-8 w-28 rounded-full bg-white/[0.06] border border-white/10" />
                <div className="flex items-center gap-2">
                  <div className="h-7 w-20 rounded-full bg-white/[0.06] border border-white/10" />
                  <div className="h-7 w-12 rounded-full bg-white/[0.06] border border-white/10" />
                </div>
              </div>

              {/* Bottom Content Skeleton: Cover Poster + Title/Description + Footer */}
              <div className="mt-6 pt-4 flex flex-col justify-end">
                <div className="flex items-end gap-4">
                  {/* Poster Thumbnail */}
                  <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-2xl bg-white/[0.08] border border-white/15 shrink-0" />
                  {/* Title & Description */}
                  <div className="flex-1 space-y-2 pb-1">
                    <div className="h-6 w-3/4 max-w-xs rounded-lg bg-white/15" />
                    <div className="h-3.5 w-1/2 max-w-[220px] rounded bg-white/[0.05]" />
                  </div>
                </div>

                {/* Bottom Footer Line */}
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                  <div className="h-3 w-20 rounded bg-white/[0.05]" />
                  <div className="h-3 w-16 rounded bg-sky-400/20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredLists.length === 0 ? (
        <div className="rounded-3xl bg-[#0f0f13] border border-white/[0.08] p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-sky-500/10 border border-sky-400/30 flex items-center justify-center mx-auto text-sky-400">
            <ListOrdered className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white">Sonuç Bulunamadı</h3>
          <p className="text-xs text-white/50 max-w-sm mx-auto">
            Arama kriterlerinize uygun herkese açık liste bulunamadı. İlk listeyi siz oluşturabilirsiniz!
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-colors cursor-pointer"
          >
            Liste Oluştur
          </button>
        </div>
      ) : (
        <motion.div
          key={`listeler-grid-${sortBy}-${searchQuery}-${currentPage}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {paginatedLists.map((list, idx) => {
            const posters = list.preview_posters || [];
            const bgImage = list.backdrop_image_url || list.cover_image_url || (posters[0]?.cover_image) || null;

            return (
              <motion.div
                key={list.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.22,
                  delay: Math.min(idx * 0.02, 0.18),
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <Link
                  href={`/listeler/${list.slug || list.id}`}
                  onClick={() => triggerSound('click')}
                  className="group relative rounded-3xl overflow-hidden min-h-[270px] sm:min-h-[290px] border border-white/10 hover:border-sky-400/50 p-6 flex flex-col justify-between transition-all duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_35px_rgba(56,189,248,0.22)] w-full h-full"
                >
                {/* GPU Ambient Glow */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-sky-500/20 via-sky-400/10 to-indigo-500/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none -z-10" />

                {/* Full-bleed Immersive Background Artwork */}
                {bgImage ? (
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <img
                      src={getProxiedImageUrl(bgImage, list.title)}
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

                {/* Top Bar: Creator Info & Stats */}
                <div className="relative z-10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 shadow-sm">
                    <div className="w-5 h-5 rounded-full overflow-hidden bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                      {list.creator?.avatar_url ? (
                        <img
                          src={getProxiedImageUrl(list.creator.avatar_url, list.creator.username)}
                          alt={list.creator.username}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-3 h-3 text-white/70" />
                      )}
                    </div>
                    <span className="text-xs font-mono text-white/80 group-hover:text-white transition-colors truncate">
                      @{list.creator?.username || 'kullanici'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white/80 text-[10px] font-mono shadow-sm flex items-center gap-1.5">
                      <Film className="w-3 h-3 text-sky-400" />
                      <span>{list.item_count} içerik</span>
                    </span>

                    {list.likes_count > 0 && (
                      <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-rose-300 text-[10px] font-mono shadow-sm flex items-center gap-1">
                        <Heart className="w-3 h-3 fill-rose-500 text-rose-500" />
                        <span>{list.likes_count.toLocaleString('tr-TR')}</span>
                      </span>
                    )}

                    {(isAdmin || (user?.id && list.creator?.id === user.id)) && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteListFromCard(e, list)}
                        className="w-7 h-7 rounded-full bg-black/60 backdrop-blur-md border border-white/15 hover:bg-rose-500/20 hover:border-rose-500/40 text-white/70 hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
                        title="Listeyi Sil"
                        aria-label="Listeyi Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Bottom Content Area */}
                <div className="relative z-10 mt-6 pt-4 flex flex-col justify-end">
                  <div className="flex items-end gap-4">
                    {/* Front Cover Poster (if cover_image_url exists) */}
                    {list.cover_image_url && (
                      <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-2xl overflow-hidden shrink-0 border border-white/20 shadow-[0_10px_25px_rgba(0,0,0,0.85)] bg-black/60 relative group-hover:scale-105 transition-transform duration-300">
                        <img
                          src={getProxiedImageUrl(list.cover_image_url, list.title)}
                          alt={list.title}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* Title & Description */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl sm:text-2xl font-black text-white group-hover:text-sky-300 transition-colors tracking-tight line-clamp-1 leading-tight drop-shadow-md break-words">
                        {list.title}
                      </h3>
                      {list.description ? (
                        <p className="text-xs text-white/70 line-clamp-2 mt-1.5 leading-relaxed drop-shadow-sm font-normal break-words">
                          {list.description}
                        </p>
                      ) : (
                        <p className="text-xs text-white/40 italic mt-1.5">
                          Açıklama belirtilmemiş.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Bottom bar */}
                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-white/50">
                    <span>Listeyi İncele</span>
                    <span className="text-sky-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 font-semibold">
                      <span>Görüntüle</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
      )}

      {/* PAGINATION DECK (Apple TV+ Cinema Glass Design) */}
      {!isLoading && filteredLists.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalCount={filteredLists.length}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          itemLabel="topluluk listesinden"
          scrollToOffset={260}
        />
      )}

      {/* CREATE NEW LIST MODAL */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="fixed inset-0 bg-black/80"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto custom-scrollbar rounded-3xl bg-[#0f0f13] border border-white/15 p-6 sm:p-7 shadow-2xl z-10 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
                    <ListOrdered className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Yeni Liste Oluştur</h3>
                  </div>
                </div>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="w-8 h-8 rounded-full glass-pill flex items-center justify-center text-white/60 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateList} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1.5">
                    Liste Başlığı <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e.target.value)}
                    placeholder=""
                    className="w-full px-4 py-2.5 rounded-full bg-[#141419] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1.5">
                    Açıklama (Opsiyonel)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={250}
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    placeholder=""
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#141419] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors resize-none font-medium"
                  />
                </div>

                {/* Two Image Inputs: Cover & Backdrop */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Front Cover Poster */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono text-white/60 mb-1.5">
                      <span>Ön Kapak URL (Opsiyonel)</span>
                      {newListCover && (
                        <button
                          type="button"
                          onClick={() => setNewListCover('')}
                          className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                        >
                          Temizle
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="url"
                        value={newListCover}
                        onChange={(e) => setNewListCover(e.target.value)}
                        placeholder="https://... (Ön afiş görseli)"
                        className="w-full px-4 py-2.5 rounded-full bg-[#141419] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors font-medium pr-10"
                      />
                      <ImageIcon className="w-4 h-4 text-white/30 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {newListCover.trim().length > 10 && (
                      <div className="mt-1.5 relative h-20 rounded-xl overflow-hidden border border-white/15 bg-black/40">
                        <img
                          src={getProxiedImageUrl(newListCover.trim(), 'Ön Kapak')}
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
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono text-white/60 mb-1.5">
                      <span>Arka Plan URL (Opsiyonel)</span>
                      {newListBackdrop && (
                        <button
                          type="button"
                          onClick={() => setNewListBackdrop('')}
                          className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                        >
                          Temizle
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="url"
                        value={newListBackdrop}
                        onChange={(e) => setNewListBackdrop(e.target.value)}
                        placeholder="https://... (Banner görseli)"
                        className="w-full px-4 py-2.5 rounded-full bg-[#141419] border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-colors font-medium pr-10"
                      />
                      <ImageIcon className="w-4 h-4 text-white/30 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    {newListBackdrop.trim().length > 10 && (
                      <div className="mt-1.5 relative h-20 rounded-xl overflow-hidden border border-white/15 bg-black/40">
                        <img
                          src={getProxiedImageUrl(newListBackdrop.trim(), 'Arka Plan')}
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

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-2">
                    Görünürlük Durumu
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewListVisibility('public')}
                      className={`p-3 rounded-2xl border text-left transition-colors cursor-pointer ${
                        newListVisibility === 'public'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>Herkese Açık</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewListVisibility('private')}
                      className={`p-3 rounded-2xl border text-left transition-colors cursor-pointer ${
                        newListVisibility === 'private'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Gizli Liste</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2.5 rounded-full text-xs font-semibold text-white/70 hover:text-white"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 disabled:opacity-50 cursor-pointer shadow-lg transition-colors"
                  >
                    {isSubmitting ? 'Kaydediliyor...' : 'Listeyi Oluştur'}
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
