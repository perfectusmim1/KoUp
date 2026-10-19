'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ListPlus,
  Plus,
  Check,
  Globe,
  Lock,
  Loader2,
  FolderHeart,
  Sparkles,
} from 'lucide-react';
import { useKoUp } from '@/context/KoUpContext';
import { supabase, MediaItem, getProxiedImageUrl } from '@/lib/supabase';

interface AddToListModalProps {
  isOpen: boolean;
  onClose: () => void;
  media: MediaItem;
}

interface CustomListRecord {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  visibility: 'public' | 'private';
  media_ids: number[];
  likes_count: number;
  created_at: string;
}

export default function AddToListModal({
  isOpen,
  onClose,
  media,
}: AddToListModalProps) {
  const { user, pushNotification, triggerSound, openAuthModal } = useKoUp();
  const [mounted, setMounted] = useState(false);
  const [lists, setLists] = useState<CustomListRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // New list form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newVisibility, setNewVisibility] = useState<'public' | 'private'>('public');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;

    let isCancelled = false;
    async function fetchUserLists() {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('custom_lists')
          .select('*')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false });

        if (!isCancelled && data && !error) {
          const formatted = data.map((l: any) => ({
            ...l,
            media_ids: Array.isArray(l.media_ids) ? l.media_ids.map(Number) : [],
          }));
          setLists(formatted);
          if (formatted.length === 0) {
            setShowCreateForm(true);
          }
        }
      } catch (e) {
        console.error('Failed to load user lists:', e);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    fetchUserLists();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  if (isOpen && !user) {
    onClose();
    openAuthModal('Listelerinizi yönetebilmek için lütfen giriş yapın.');
    return null;
  }

  const mediaIdNum = Number(media.id);

  const handleToggle = async (list: CustomListRecord) => {
    if (!user || togglingId !== null) return;
    setTogglingId(list.id);
    triggerSound('click');

    const isCurrentlyIn = list.media_ids.includes(mediaIdNum);
    const action = isCurrentlyIn ? 'remove' : 'add';

    // Optimistic UI update
    setLists((prev) =>
      prev.map((l) => {
        if (l.id === list.id) {
          const nextIds = isCurrentlyIn
            ? l.media_ids.filter((id) => id !== mediaIdNum)
            : [...l.media_ids, mediaIdNum];
          return { ...l, media_ids: nextIds };
        }
        return l;
      })
    );

    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          media_id: mediaIdNum,
          user_id: user?.id,
        }),
      });

      const d = await res.json();
      if (d.success) {
        triggerSound('success');
        if (action === 'add') {
          pushNotification(
            'Listeye Eklendi',
            `"${media.title}" "${list.title}" listenize eklendi.`,
            'success'
          );
        } else {
          pushNotification(
            'Listeden Çıkarıldı',
            `"${media.title}" "${list.title}" listenizden çıkarıldı.`,
            'info'
          );
        }
      } else {
        // Revert on error
        setLists((prev) =>
          prev.map((l) => (l.id === list.id ? list : l))
        );
        pushNotification('Hata', d.error || 'İşlem gerçekleştirilemedi.', 'info');
      }
    } catch {
      // Revert on exception
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? list : l))
      );
      pushNotification('Hata', 'Bağlantı hatası oluştu.', 'info');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTitle.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    triggerSound('click');

    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          visibility: newVisibility,
          user_id: user?.id,
          media_ids: [mediaIdNum],
        }),
      });

      const d = await res.json();
      if (d.success && d.list) {
        triggerSound('success');
        pushNotification(
          'Yeni Liste Oluşturuldu',
          `"${d.list.title}" listeniz oluşturuldu ve "${media.title}" eklendi!`,
          'success'
        );
        const newListRecord: CustomListRecord = {
          id: d.list.id,
          slug: d.list.slug,
          title: d.list.title,
          description: d.list.description,
          visibility: d.list.visibility || 'public',
          media_ids: [mediaIdNum],
          likes_count: 0,
          created_at: d.list.created_at,
        };
        setLists((prev) => [newListRecord, ...prev]);
        setNewTitle('');
        setShowCreateForm(false);
      } else {
        setCreateError(d.error || 'Liste oluşturulamadı.');
      }
    } catch {
      setCreateError('Bağlantı hatası oluştu.');
    } finally {
      setIsCreating(false);
    }
  };

  const posterSrc = getProxiedImageUrl(media.cover_image, media.title);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label={`${media.title} listeye ekle`}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md cursor-pointer"
          />

          {/* Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md rounded-3xl bg-[#121216]/95 border border-white/10 p-6 sm:p-7 shadow-[0_28px_64px_rgba(0,0,0,0.92),0_0_24px_-4px_rgba(41,151,255,0.2)] backdrop-blur-2xl text-white"
          >
          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="absolute top-5 right-5 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Header with Series Info */}
          <div className="flex items-center gap-3.5 pb-5 border-b border-white/10 pr-8">
            <div className="w-12 h-16 rounded-xl overflow-hidden shrink-0 border border-white/15 shadow-md bg-black">
              <img
                src={posterSrc}
                alt={media.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-sky-400 font-semibold uppercase tracking-wider">
                <ListPlus className="w-3.5 h-3.5" />
                <span>Listeye Ekle</span>
              </div>
              <h3 className="text-base font-bold text-white truncate mt-0.5">
                {media.title}
              </h3>
              <p className="text-xs text-white/50 truncate">
                Eklemek istediğiniz listenin üzerine tıklayın.
              </p>
            </div>
          </div>

          {/* List Options */}
          <div className="py-4 space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
            {isLoading ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-white/50 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                <span>Listeleriniz yükleniyor...</span>
              </div>
            ) : lists.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/50 space-y-2">
                <FolderHeart className="w-8 h-8 text-white/30 mx-auto" />
                <p>Henüz özel bir liste oluşturmadınız.</p>
              </div>
            ) : (
              lists.map((l) => {
                const isAdded = l.media_ids.includes(mediaIdNum);
                const isThisToggling = togglingId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleToggle(l)}
                    disabled={isThisToggling}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left cursor-pointer group ${
                      isAdded
                        ? 'bg-sky-500/15 border-sky-400/40 text-white shadow-[0_0_15px_rgba(41,151,255,0.15)]'
                        : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.07] hover:border-white/20 text-white/90'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-all ${
                          isAdded
                            ? 'bg-sky-500 text-white border-sky-400 shadow-[0_0_10px_rgba(41,151,255,0.5)]'
                            : 'bg-white/5 text-white/50 border-white/10 group-hover:border-white/25'
                        }`}
                      >
                        {isThisToggling ? (
                          <Loader2 className="w-4 h-4 animate-spin text-sky-300" />
                        ) : isAdded ? (
                          <Check className="w-4 h-4 stroke-[3]" />
                        ) : (
                          <FolderHeart className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate group-hover:text-white flex items-center gap-1.5">
                          <span>{l.title}</span>
                          {l.visibility === 'private' ? (
                            <span aria-label="Gizli Liste">
                              <Lock className="w-3 h-3 text-white/40 shrink-0" />
                            </span>
                          ) : (
                            <span aria-label="Herkese Açık">
                              <Globe className="w-3 h-3 text-white/40 shrink-0" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/50">
                          {l.media_ids.length} Yapım {isAdded && '• Listede Mevcut'}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`px-3 py-1 rounded-full text-xs font-semibold shrink-0 transition-all ${
                        isAdded
                          ? 'bg-sky-400 text-black'
                          : 'bg-white/5 text-white/60 group-hover:bg-white/10 group-hover:text-white border border-white/10'
                      }`}
                    >
                      {isAdded ? 'Eklendi' : 'Ekle'}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Create New List Button / Form */}
          <div className="pt-3 border-t border-white/10">
            {!showCreateForm ? (
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(true);
                  triggerSound('click');
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl apple-glass-pill hover:bg-white/15 text-xs font-bold text-white border border-white/15 transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4 text-sky-400" />
                <span>Yeni Liste Oluştur</span>
              </button>
            ) : (
              <form onSubmit={handleCreateList} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white/80 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Yeni Liste Oluştur
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="text-xs text-white/50 hover:text-white cursor-pointer"
                  >
                    Vazgeç
                  </button>
                </div>

                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Liste Adı (Örn: En İyi Romantikler)..."
                  maxLength={60}
                  className="koup-input text-xs py-2.5 px-4 font-medium"
                  autoFocus
                />

                <div className="flex items-center justify-between gap-3 pt-1">
                  {/* Sliding Pill Visibility Selector */}
                  <div className="relative flex items-center p-1 rounded-full bg-white/[0.06] border border-white/10 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        setNewVisibility('public');
                      }}
                      className={`relative z-10 px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                        newVisibility === 'public'
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {newVisibility === 'public' && (
                        <motion.div
                          layoutId="addToListVisPill"
                          className="absolute inset-0 rounded-full bg-sky-500 shadow-[0_0_14px_rgba(14,165,233,0.5)]"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5" />
                        <span>Herkese Açık</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        triggerSound('click');
                        setNewVisibility('private');
                      }}
                      className={`relative z-10 px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                        newVisibility === 'private'
                          ? 'text-white'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {newVisibility === 'private' && (
                        <motion.div
                          layoutId="addToListVisPill"
                          className="absolute inset-0 rounded-full bg-sky-500 shadow-[0_0_14px_rgba(14,165,233,0.5)]"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Gizli</span>
                      </span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={isCreating || !newTitle.trim()}
                    className="flex-1 py-2 px-4 rounded-full bg-[#2997ff] hover:bg-sky-400 text-white font-bold text-xs transition-all shadow-[0_0_18px_rgba(41,151,255,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Ekleniyor...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Oluştur ve Ekle</span>
                      </>
                    )}
                  </button>
                </div>

                {createError && (
                  <p className="text-xs text-rose-400">{createError}</p>
                )}
              </form>
            )}
          </div>
        </motion.div>
      </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
