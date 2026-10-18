'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, AlertTriangle, HelpCircle, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  icon?: 'trash' | 'alert' | 'help';
  isLoading?: boolean;
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText = 'Vazgeç',
  isDestructive = true,
  icon,
  isLoading = false,
}: ConfirmModalProps) {
  // Determine effective icon
  const effectiveIcon = icon || (isDestructive ? 'trash' : 'help');
  const defaultConfirmText = isDestructive ? 'Kaldır / Sil' : 'Onayla';
  const effectiveConfirmText = confirmText || defaultConfirmText;

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => {
              if (!isLoading) onClose();
            }}
          />

          {/* Modal Dialog Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="relative w-full max-w-sm sm:max-w-md rounded-3xl bg-[#111116]/95 border border-white/15 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.9),0_0_50px_rgba(244,63,94,0.12)] backdrop-blur-2xl text-center flex flex-col items-center z-10"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            aria-describedby="confirm-modal-desc"
          >
            {/* Top Close Button */}
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="absolute top-4 right-4 p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Icon Glow Badge */}
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-transform ${
                isDestructive
                  ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400 shadow-[0_0_24px_rgba(244,63,94,0.3)]'
                  : 'bg-sky-500/15 border border-sky-500/30 text-sky-400 shadow-[0_0_24px_rgba(14,165,233,0.3)]'
              }`}
            >
              {effectiveIcon === 'trash' ? (
                <Trash2 className="w-7 h-7" />
              ) : effectiveIcon === 'alert' ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <HelpCircle className="w-7 h-7" />
              )}
            </div>

            {/* Title */}
            <h3
              id="confirm-modal-title"
              className="text-lg sm:text-xl font-black text-white tracking-tight mb-2 max-w-xs sm:max-w-sm leading-snug"
            >
              {title}
            </h3>

            {/* Message Body */}
            <div
              id="confirm-modal-desc"
              className="text-xs sm:text-sm text-white/70 leading-relaxed mb-6 font-normal max-w-sm px-2"
            >
              {message}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 w-full justify-center">
              <button
                type="button"
                disabled={isLoading}
                onClick={onClose}
                className="flex-1 py-3 px-4 rounded-xl bg-white/[0.07] hover:bg-white/12 text-white/80 hover:text-white text-xs sm:text-sm font-semibold transition-all border border-white/10 active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {cancelText}
              </button>

              <button
                type="button"
                disabled={isLoading}
                onClick={onConfirm}
                className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 ${
                  isDestructive
                    ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-[0_0_24px_rgba(244,63,94,0.4)] hover:shadow-[0_0_30px_rgba(244,63,94,0.6)]'
                    : 'bg-[#2997ff] hover:bg-sky-400 text-white shadow-[0_0_24px_rgba(41,151,255,0.4)]'
                }`}
              >
                {isLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  effectiveConfirmText
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
