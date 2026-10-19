'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ListOrdered,
  Search,
  Plus,
  Heart,
  Film,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Clock,
  Layers,
  X,
  Lock,
  Globe,
  User,
} from 'lucide-react';
import { getProxiedImageUrl } from '@/lib/supabase';
import { useKoUp } from '@/context/KoUpContext';
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
  visibility: string;
  likes_count: number;
  follower_count: number;
  created_at: string;
  media_ids: number[];
  item_count: number;
  creator: ListCreator;
  preview_posters: PreviewPoster[];
}

export default function PublicListsPage() {
  const { user, triggerSound, pushNotification, setIsAuthModalOpen } = useKoUp();

  const [lists, setLists] = useState<CustomListRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'items' | 'newest'>('popular');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;

  // Create List Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
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
    }

    return result;
  }, [lists, searchQuery, sortBy]);

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
          <p className="text-sm sm:text-base text-white/55 max-w-2xl mt-2 leading-relaxed font-medium">
            KoUp topluluğu ve sinemaseverler tarafından derlenen en popüler Asya dizileri, animeler ve tematik başyapıt seçkileri.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {user && (
            <Link
              href="/listelerim"
              onClick={() => triggerSound('click')}
              className="flex items-center gap-2 px-5 py-3 rounded-full glass-pill text-white font-bold text-xs sm:text-sm hover:bg-white/15 cursor-pointer transition-all"
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
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-full glass-pill-dark focus-within:border-[var(--accent-blue)]/60 focus-within:ring-2 focus-within:ring-[var(--accent-blue)]/20 transition-all duration-300 shadow-xs focus-within:shadow-[0_0_16px_rgba(41,151,255,0.28)] flex-1 max-w-md">
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

        {/* Sort Controls */}
        <div className="flex items-center gap-1.5 p-1 rounded-full glass-pill-dark overflow-x-auto no-scrollbar">
          <span className="text-xs font-mono text-white/40 ml-3 mr-1 hidden sm:inline">Sırala:</span>
          {(
            [
              { id: 'popular', label: 'En Popüler', icon: TrendingUp },
              { id: 'items', label: 'En Çok İçerik', icon: Layers },
              { id: 'newest', label: 'En Yeni', icon: Clock },
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
                className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors duration-200 select-none ${
                  active ? 'text-black' : 'text-white/70 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="listeler-sort-pill"
                    transition={{
                      type: 'spring',
                      stiffness: 420,
                      damping: 32,
                    }}
                    className="absolute inset-0 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10 font-bold">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* LISTS GRID (2 COLUMNS MATCHING USER'S INSPIRATION SCREENSHOT) */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-3xl bg-[#0f0f13] border border-white/[0.08] p-6 flex items-center justify-between gap-5 animate-pulse min-h-[170px]"
            >
              <div className="space-y-3 flex-1">
                <div className="w-24 h-4 rounded-full bg-white/10" />
                <div className="w-48 h-6 rounded-lg bg-white/15" />
                <div className="w-32 h-3 rounded-full bg-white/5" />
              </div>
              <div className="flex gap-2 shrink-0">
                <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/10" />
                <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/10" />
                <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/10" />
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
            className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition-all cursor-pointer"
          >
            Liste Oluştur
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {paginatedLists.map((list) => {
            const posters = list.preview_posters || [];
            return (
              <Link
                key={list.id}
                href={`/listeler/${list.id}`}
                onClick={() => triggerSound('click')}
                className="group relative rounded-3xl bg-[#0e0e13]/90 backdrop-blur-xl border border-white/[0.08] hover:border-sky-500/40 p-5 sm:p-6 transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.65),0_0_30px_rgba(56,189,248,0.12)] flex flex-col justify-between overflow-hidden"
              >
                {/* Subtle Ambient Background Glow on Hover */}
                <div className="absolute -right-20 -bottom-20 w-64 h-64 rounded-full bg-sky-500/5 group-hover:bg-sky-500/15 blur-3xl pointer-events-none transition-all duration-500" />

                <div className="flex items-center justify-between gap-4 relative z-10">
                  {/* Left Column: Creator & Title & Meta */}
                  <div className="flex-1 min-w-0 pr-2">
                    {/* Creator Row */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
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
                      <span className="text-xs font-mono text-white/60 group-hover:text-white transition-colors truncate">
                        @{list.creator?.username || 'kullanici'}
                      </span>
                    </div>

                    {/* List Title */}
                    <h3 className="text-xl sm:text-2xl font-black text-white group-hover:text-sky-300 transition-colors tracking-tight line-clamp-1 leading-tight">
                      {list.title}
                    </h3>

                    {/* Description */}
                    {list.description && (
                      <p className="text-xs text-white/50 line-clamp-2 mt-1.5 leading-relaxed font-normal">
                        {list.description}
                      </p>
                    )}

                    {/* Stats & Badge */}
                    <div className="mt-4 flex flex-wrap items-center gap-2.5 text-xs font-mono">
                      <span className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10 text-white/75 flex items-center gap-1.5">
                        <Film className="w-3 h-3 text-sky-400" />
                        <span>{list.item_count} içerik</span>
                      </span>

                      {list.likes_count > 0 && (
                        <span className="px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-center gap-1">
                          <Heart className="w-3 h-3 fill-rose-500 text-rose-500" />
                          <span>{list.likes_count.toLocaleString('tr-TR')}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Column: 3-Poster Horizontal Collage (Triptych Layout) */}
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    {posters.length > 0 ? (
                      posters.slice(0, 3).map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl overflow-hidden border border-white/10 shadow-lg relative bg-[#181820]"
                        >
                          {item.cover_image ? (
                            <img
                              src={getProxiedImageUrl(item.cover_image, item.title)}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-1 text-center bg-[#181820]">
                              <Film className="w-5 h-5 text-white/30 mb-1" />
                              <span className="text-[9px] text-white/40 line-clamp-2 font-mono">
                                {item.title}
                              </span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      ))
                    ) : (
                      // Empty placeholder posters
                      <div className="flex gap-1.5">
                        <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/20">
                          <Film className="w-5 h-5" />
                        </div>
                        <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/20">
                          <Film className="w-5 h-5" />
                        </div>
                        <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/20">
                          <Film className="w-5 h-5" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom subtle bar on card */}
                <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/40">
                  <span>Listeyi İncele</span>
                  <span className="text-sky-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 font-semibold">
                    <span>Görüntüle</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </Link>
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
          onPageChange={setCurrentPage}
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
              className="fixed inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg rounded-3xl bg-[#0f0f13] border border-white/15 p-6 sm:p-8 shadow-2xl z-10 space-y-5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
                    <ListOrdered className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Yeni Liste Oluştur</h3>
                    <p className="text-xs text-white/50">Dilediğin yapımları toplayıp toplulukla paylaş</p>
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
                    value={newListTitle}
                    onChange={(e) => setNewListTitle(e.target.value)}
                    placeholder="Örn: 2024 Favori K-Dramalarım, Ağlatan Başyapıtlar..."
                    className="w-full px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-1.5">
                    Açıklama (Opsiyonel)
                  </label>
                  <textarea
                    rows={3}
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    placeholder="Listenin teması veya izleme önerileri hakkında kısa not..."
                    className="w-full px-4 py-2.5 rounded-2xl bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 text-xs text-white placeholder-white/35 focus:outline-none focus:border-[var(--accent-blue)]/60 focus:ring-2 focus:ring-[var(--accent-blue)]/20 focus:shadow-[0_0_16px_rgba(41,151,255,0.28)] transition-all resize-none font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/60 mb-2">
                    Görünürlük Durumu
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewListVisibility('public')}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        newListVisibility === 'public'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold mb-0.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        <span>Herkese Açık</span>
                      </div>
                      <div className="text-[11px] text-white/50">
                        Topluluk listeleri sayfasında ve profilinizde herkes görebilir.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setNewListVisibility('private')}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        newListVisibility === 'private'
                          ? 'bg-sky-500/15 border-sky-400/50 text-white'
                          : 'bg-white/[0.02] border-white/10 text-white/60 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-bold mb-0.5">
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                        <span>Gizli Liste</span>
                      </div>
                      <div className="text-[11px] text-white/50">
                        Yalnızca siz görebilir ve düzenleyebilirsiniz.
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
                    className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 disabled:opacity-50 cursor-pointer shadow-lg transition-all"
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
