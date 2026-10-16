'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  leftIcon?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  variant?: 'pill' | 'glass' | 'white' | 'dark';
  size?: 'sm' | 'md';
  direction?: 'up' | 'down' | 'auto';
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Seçiniz...',
  leftIcon,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  variant = 'glass',
  size = 'md',
  direction = 'auto',
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(direction === 'up');
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    if (isOpen && containerRef.current && typeof window !== 'undefined') {
      const rect = containerRef.current.getBoundingClientRect();
      if (direction === 'up') {
        setOpenUpwards(true);
      } else if (direction === 'down') {
        setOpenUpwards(false);
      } else {
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUpwards(spaceBelow < 260 && rect.top > 200);
      }
      setAlignRight(rect.right + 220 > window.innerWidth);
    }
  }, [isOpen, direction]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const getVariantStyles = () => {
    switch (variant) {
      case 'white':
        return 'bg-white text-black font-bold hover:bg-white/95 border border-white/30 shadow-[0_4px_20px_rgba(255,255,255,0.25)]';
      case 'pill':
        return 'glass-pill-dark text-white font-semibold hover:border-white/25';
      case 'dark':
        return 'bg-[#0f0f11] text-white border border-white/10 hover:border-white/25';
      case 'glass':
      default:
        return 'apple-glass text-white font-semibold hover:bg-white/10 border border-white/15';
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-xs rounded-full gap-2';
      case 'md':
      default:
        return 'px-4 py-2.5 text-xs rounded-full gap-2.5';
    }
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button with Apple Spring Micro-Interaction */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center justify-between cursor-pointer transition-all duration-200 ease-out hover:brightness-110 active:scale-[0.98] transform-gpu backface-hidden select-none ${getVariantStyles()} ${getSizeStyles()} ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 truncate">
          {leftIcon ? (
            <span className="shrink-0 flex items-center justify-center">{leftIcon}</span>
          ) : (
            selectedOption?.icon
          )}
          <span className="font-semibold tracking-tight">{selectedOption?.label || placeholder}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 opacity-70 ml-1.5 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Floating Glass Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: openUpwards ? 6 : -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: openUpwards ? 6 : -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute ${alignRight ? 'right-0' : 'left-0'} ${
              openUpwards ? 'bottom-full mb-2' : 'top-full mt-2'
            } z-50 min-w-[200px] max-w-[290px] w-max p-0 rounded-2xl bg-[#141418]/95 backdrop-blur-3xl border border-white/20 shadow-[0_25px_60px_rgba(0,0,0,0.95)] ring-1 ring-white/10 flex flex-col overflow-hidden ${menuClassName}`}
            role="listbox"
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-all duration-150 cursor-pointer first:rounded-t-2xl last:rounded-b-2xl border-b border-white/[0.04] last:border-b-0 ${
                    isSelected
                      ? 'bg-white/20 text-white font-bold shadow-sm'
                      : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    {opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0 ml-2" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
