'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Film, X, RefreshCw, Check } from 'lucide-react';
import { supabase, MediaItem, getProxiedImageUrl } from '@/lib/supabase';
import { rankSearchResults } from '@/lib/searchRanking';
import KoupInput from '@/components/KoupInput';

export interface AdminMediaPickerValue {
  id: number;
  title: string;
  slug?: string;
  poster?: string | null;
  content_type?: string;
  release_year?: number;
}

export interface AdminMediaPickerProps {
  value: AdminMediaPickerValue | null;
  onChange: (value: AdminMediaPickerValue | null) => void;
  label?: string;
  placeholder?: string;
  allowEmptyLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
  initialQuery?: string;
  disabled?: boolean;
}

export default function AdminMediaPicker({
  value,
  onChange,
  label,
  placeholder = 'Dizi adı veya ID ile ara...',
  allowEmptyLabel,
  size = 'md',
  className = '',
  initialQuery,
  disabled = false,
}: AdminMediaPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminMediaPickerValue[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(0);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, []);

  // Debounced search logic with race-condition prevention
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const currentSeq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const isNumeric = /^\d+$/.test(term);
        let idMatch: AdminMediaPickerValue | null = null;

        // 1. If pure numeric ID, try direct ID lookup
        if (isNumeric) {
          const { data: directData } = await supabase
            .from('media')
            .select('id, slug, title, cover_image, release_year, content_type')
            .eq('id', Number(term))
            .maybeSingle();

          if (directData && currentSeq === searchSeqRef.current) {
            idMatch = {
              id: directData.id,
              title: directData.title,
              slug: directData.slug,
              poster: directData.cover_image,
              content_type: directData.content_type,
              release_year: directData.release_year,
            };
          }
        }

        // 2. Fast catalog RPC search
        let catalogItems: AdminMediaPickerValue[] = [];
        try {
          const { data: rpcData, error: rpcErr } = await supabase.rpc('search_catalog', {
            p_query: term,
            p_limit: 20,
          });

          if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
            const ranked = rankSearchResults(rpcData as MediaItem[], term);
            catalogItems = ranked.slice(0, 10).map((m) => ({
              id: m.id,
              title: m.title,
              slug: m.slug,
              poster: m.cover_image,
              content_type: m.content_type,
              release_year: m.release_year,
            }));
          }
        } catch {
          // RPC fallback below
        }

        // 3. Fallback to direct media table search if RPC returned empty
        if (catalogItems.length === 0) {
          const { data: fallbackData } = await supabase
            .from('media')
            .select('id, slug, title, native_title, cover_image, release_year, content_type')
            .or(`title.ilike.%${term}%,slug.ilike.%${term}%,native_title.ilike.%${term}%`)
            .limit(20);

          if (fallbackData && fallbackData.length > 0) {
            const ranked = rankSearchResults(fallbackData as MediaItem[], term);
            catalogItems = ranked.slice(0, 10).map((m) => ({
              id: m.id,
              title: m.title,
              slug: m.slug,
              poster: m.cover_image,
              content_type: m.content_type,
              release_year: m.release_year,
            }));
          }
        }

        // Combine direct ID match with catalog results without duplicates
        if (currentSeq === searchSeqRef.current) {
          const merged: AdminMediaPickerValue[] = [];
          if (idMatch) merged.push(idMatch);
          for (const item of catalogItems) {
            if (!merged.some((m) => m.id === item.id)) {
              merged.push(item);
            }
          }
          setResults(merged.slice(0, 8));
          setIsOpen(true);
          setActiveIndex(-1);
        }
      } finally {
        if (currentSeq === searchSeqRef.current) {
          setIsSearching(false);
        }
      }
    }, 280);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const handleSelect = useCallback(
    (item: AdminMediaPickerValue) => {
      onChange(item);
      setIsOpen(false);
      setQuery('');
      setResults([]);
      setActiveIndex(-1);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setActiveIndex(-1);
  }, [onChange]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) {
        handleSelect(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const isSmall = size === 'sm';

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {label && (
        <label className="text-[10px] font-mono text-white/50 block mb-1 uppercase tracking-wider">
          {label}
        </label>
      )}

      {/* Selected Chip View */}
      {value ? (
        <div
          className={`w-full flex items-center justify-between gap-2.5 rounded-2xl bg-white/[0.04] border border-sky-400/30 hover:border-sky-400/50 transition-all ${
            isSmall ? 'p-1.5 min-h-[40px]' : 'p-2 min-h-[48px]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={`rounded-lg overflow-hidden bg-black/60 border border-white/10 shrink-0 flex items-center justify-center ${
                isSmall ? 'w-6 h-8' : 'w-8 h-11'
              }`}
            >
              {value.poster ? (
                <img
                  src={getProxiedImageUrl(value.poster, value.title)}
                  alt={value.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <Film className="w-3.5 h-3.5 text-white/30" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div
                className={`font-bold text-white truncate ${
                  isSmall ? 'text-xs' : 'text-xs sm:text-sm'
                }`}
              >
                {value.title}
              </div>
              <div className="text-[10px] text-white/40 font-mono truncate flex items-center gap-1.5">
                <span className="text-sky-400 font-semibold">#{value.id}</span>
                {value.content_type && <span>• {value.content_type}</span>}
                {value.release_year && <span>• {value.release_year}</span>}
                {value.slug && <span className="opacity-70">/seri/{value.slug}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              title="Seçimi Kaldır"
              aria-label="Seçimi Kaldır"
              className="p-1.5 rounded-xl hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* Empty / Search Input View */
        <div className="relative">
          <KoupInput
            type="text"
            size={size}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (results.length > 0) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            leftIcon={<Search className="w-3.5 h-3.5 text-white/40" />}
            clearable={!!query}
            onClear={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            rightSlot={
              isSearching ? (
                <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0 mr-2" />
              ) : null
            }
          />

          {/* Quick query recommendation chip (if initialQuery provided and input empty) */}
          {initialQuery && !query && (
            <button
              type="button"
              onClick={() => {
                setQuery(initialQuery);
                setIsOpen(true);
              }}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-400/80 hover:text-sky-300 transition-colors cursor-pointer"
            >
              <span>Öneriyle ara:</span>
              <span className="underline font-semibold max-w-[200px] truncate">&ldquo;{initialQuery}&rdquo;</span>
            </button>
          )}

          {/* Fallback info when allowEmptyLabel is set */}
          {allowEmptyLabel && !query && (
            <div className="text-[10px] text-white/35 font-mono mt-0.5 px-1 truncate">
              {allowEmptyLabel}
            </div>
          )}

          {/* Dropdown Menu */}
          <AnimatePresence>
            {isOpen && query.trim().length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-1.5 z-50 p-1.5 rounded-2xl bg-[#0e0e12] border border-white/15 shadow-2xl max-h-72 overflow-y-auto space-y-1 backdrop-blur-xl"
              >
                {results.length > 0 ? (
                  results.map((item, idx) => {
                    const isFocused = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`w-full p-2 rounded-xl text-left flex items-center gap-3 transition-colors cursor-pointer min-h-[44px] ${
                          isFocused ? 'bg-white/10 text-white' : 'hover:bg-white/[0.06] text-white/90'
                        }`}
                      >
                        <div className="w-7 h-10 rounded-md overflow-hidden bg-black/60 border border-white/10 shrink-0 flex items-center justify-center">
                          {item.poster ? (
                            <img
                              src={getProxiedImageUrl(item.poster, item.title)}
                              alt={item.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <Film className="w-3 h-3 text-white/30" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {item.title}
                          </div>
                          <div className="text-[10px] text-white/40 truncate font-mono flex items-center gap-1.5">
                            <span className="text-sky-400 font-semibold">#{item.id}</span>
                            {item.content_type && <span>• {item.content_type}</span>}
                            {item.release_year && <span>• {item.release_year}</span>}
                            {item.slug && <span className="opacity-70">/seri/{item.slug}</span>}
                          </div>
                        </div>

                        <div className="shrink-0 text-white/40 group-hover:text-sky-400">
                          <Check className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                    );
                  })
                ) : !isSearching ? (
                  <div className="p-3 text-center text-xs text-white/40 font-mono">
                    Sonuç bulunamadı
                  </div>
                ) : (
                  <div className="p-3 text-center text-xs text-white/40 font-mono flex items-center justify-center gap-2">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Aranıyor...</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
