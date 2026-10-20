'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useKoUpSelector } from '@/context/KoUpContext';

export interface PaginationProps {
  currentPage: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  scrollToTop?: boolean;
  scrollToOffset?: number;
  className?: string;
}

function Pagination({
  currentPage,
  totalCount,
  pageSize,
  onPageChange,
  itemLabel = 'yapımdan',
  scrollToTop = true,
  scrollToOffset = 180,
  className = '',
}: PaginationProps) {
  const triggerSound = useKoUpSelector((s) => s.triggerSound);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (totalPages <= 1) return null;

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    triggerSound?.('click');
    onPageChange(page);
    if (scrollToTop && typeof window !== 'undefined') {
      window.scrollTo({ top: scrollToOffset, behavior: 'smooth' });
    }
  };

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, '...', totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  };

  const fromIndex = (currentPage - 1) * pageSize + 1;
  const toIndex = Math.min(currentPage * pageSize, totalCount);

  return (
    <div
      className={`pt-8 pb-12 flex flex-col sm:flex-row items-center justify-between gap-5 border-t border-white/[0.08] ${className}`}
    >
      <div className="text-xs font-mono text-white/50">
        Toplam <span className="text-white font-bold">{totalCount.toLocaleString('tr-TR')}</span> {itemLabel}{' '}
        <span className="text-sky-400 font-bold">
          {fromIndex} - {toIndex}
        </span>{' '}
        arası gösteriliyor (Sayfa {currentPage} / {totalPages})
      </div>

      <div className="flex items-center gap-1.5">
        {/* First Page */}
        {currentPage > 2 && (
          <button
            onClick={() => goToPage(1)}
            aria-label="İlk Sayfa"
            className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/35 hover:bg-white/[0.14] text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer hidden md:flex shadow-xs hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}

        {/* Previous Page */}
        <button
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className={`px-3.5 h-9 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-colors ${
            currentPage <= 1
              ? 'bg-white/[0.02] border-white/5 text-white/20 cursor-not-allowed'
              : 'bg-white/[0.04] border-white/10 hover:border-white/35 hover:bg-white/[0.14] text-white/80 hover:text-white cursor-pointer hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]'
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Önceki</span>
        </button>

        {/* Numbered Page Buttons */}
        <div className="flex items-center gap-1">
          {getPageNumbers().map((p, idx) => {
            if (p === '...') {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="w-8 h-9 flex items-center justify-center text-xs text-white/40 font-mono"
                >
                  …
                </span>
              );
            }
            const pageNum = Number(p);
            const isActive = pageNum === currentPage;
            return (
              <button
                key={pageNum}
                onClick={() => goToPage(pageNum)}
                className={`w-9 h-9 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#2997ff] text-white glow-blue'
                    : 'bg-white/[0.04] border border-white/10 hover:border-white/35 text-white/70 hover:text-white hover:bg-white/[0.14] hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        {/* Next Page */}
        <button
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className={`px-3.5 h-9 rounded-xl border flex items-center gap-1.5 text-xs font-semibold transition-colors ${
            currentPage >= totalPages
              ? 'bg-white/[0.02] border-white/5 text-white/20 cursor-not-allowed'
              : 'bg-white/[0.04] border-white/10 hover:border-white/35 hover:bg-white/[0.14] text-white/80 hover:text-white cursor-pointer hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]'
          }`}
        >
          <span className="hidden sm:inline">Sonraki</span>
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Last Page */}
        {currentPage < totalPages - 1 && (
          <button
            onClick={() => goToPage(totalPages)}
            aria-label="Son Sayfa"
            className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/35 hover:bg-white/[0.14] text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer hidden md:flex shadow-xs hover:shadow-[0_0_14px_rgba(255,255,255,0.12)]"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default React.memo(Pagination);
