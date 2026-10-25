'use client';

import React, { useState, useRef, useEffect, useId, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface BaseCustomSelectProps {
  options: SelectOption[];
  placeholder?: string;
  triggerLabel?: React.ReactNode;
  leftIcon?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  variant?: 'pill' | 'glass' | 'white' | 'dark';
  size?: 'sm' | 'md';
  direction?: 'up' | 'down' | 'auto';
  searchable?: boolean;
  searchPlaceholder?: string;
  portal?: boolean;
  disabled?: boolean;
  allowDeselect?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

export interface SingleCustomSelectProps extends BaseCustomSelectProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

export interface MultiCustomSelectProps extends BaseCustomSelectProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

export type CustomSelectProps = SingleCustomSelectProps | MultiCustomSelectProps;

export default function CustomSelect(props: CustomSelectProps) {
  const {
    value,
    onChange,
    options,
    multiple = false,
    placeholder = 'Seçiniz...',
    triggerLabel,
    leftIcon,
    className = '',
    triggerClassName = '',
    menuClassName = '',
    variant = 'glass',
    size = 'md',
    direction = 'auto',
    searchable,
    searchPlaceholder = 'Seçenek ara...',
    portal = true,
    disabled = false,
    allowDeselect = false,
    id: explicitId,
    name,
    'aria-label': ariaLabel,
  } = props;
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(direction === 'up');
  const [alignRight, setAlignRight] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [portalCoords, setPortalCoords] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    width: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsListRef = useRef<HTMLDivElement>(null);

  const generatedId = useId();
  const selectId = explicitId || generatedId;
  const listboxId = `${selectId}-listbox`;

  const isSearchable = searchable ?? options.length >= 8;

  const isOptionSelected = useCallback(
    (optValue: string) => {
      if (multiple) {
        const arr = Array.isArray(value) ? value : [];
        if (optValue === 'ALL') {
          return arr.length === 0 || arr.includes('ALL');
        }
        return arr.includes(optValue);
      }
      return value === optValue;
    },
    [multiple, value]
  );

  const handleOptionSelect = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      if (multiple) {
        const arr = Array.isArray(value) ? [...value] : [];
        const multiOnChange = onChange as (val: string[]) => void;
        if (opt.value === 'ALL') {
          multiOnChange([]);
        } else {
          const withoutAll = arr.filter((v) => v !== 'ALL');
          const exists = withoutAll.includes(opt.value);
          let nextArr: string[];
          if (exists) {
            nextArr = withoutAll.filter((v) => v !== opt.value);
          } else {
            nextArr = [...withoutAll, opt.value];
          }
          multiOnChange(nextArr);
        }
        // Keep focus on search input or trigger without closing menu
        const isTouch = typeof window !== 'undefined' && (
          window.matchMedia('(pointer: coarse)').matches ||
          window.innerWidth < 768 ||
          navigator.maxTouchPoints > 0
        );
        if (searchInputRef.current && !isTouch) {
          searchInputRef.current.focus();
        } else {
          triggerRef.current?.focus();
        }
      } else {
        const singleOnChange = onChange as (val: string) => void;
        if (allowDeselect && opt.value === value) {
          singleOnChange('');
        } else {
          singleOnChange(opt.value);
        }
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    },
    [multiple, value, onChange, allowDeselect]
  );

  const selectedOption = useMemo(() => {
    if (multiple) return undefined;
    return options.find((o) => o.value === value);
  }, [multiple, options, value]);

  const displayLabel = useMemo(() => {
    if (triggerLabel !== undefined) return triggerLabel;
    if (multiple) {
      const arr = Array.isArray(value) ? value.filter((v) => v !== 'ALL') : [];
      if (arr.length === 0) {
        const allOpt = options.find((o) => o.value === 'ALL');
        return allOpt?.label || placeholder;
      }
      if (arr.length === 1) {
        const single = options.find((o) => o.value === arr[0]);
        return single?.label || arr[0];
      }
      if (arr.length === 2) {
        const o1 = options.find((o) => o.value === arr[0])?.label || arr[0];
        const o2 = options.find((o) => o.value === arr[1])?.label || arr[1];
        return `${o1}, ${o2}`;
      }
      const isYearSelect = placeholder.includes('Yıl') || options.some((o) => /^\d{4}$/.test(o.value));
      return isYearSelect ? `${arr.length} Yıl Seçildi` : `${arr.length} Seçildi`;
    }
    return selectedOption?.label || placeholder;
  }, [triggerLabel, multiple, value, options, placeholder, selectedOption]);

  const filteredOptions = useMemo(() => {
    if (!isSearchable || !searchQuery.trim()) return options;
    const q = searchQuery.trim().toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.description && opt.description.toLowerCase().includes(q)) ||
        opt.value.toLowerCase().includes(q)
    );
  }, [options, searchQuery, isSearchable]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute exact coordinates relative to window viewport
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let upwards = false;
    if (direction === 'up') {
      upwards = true;
    } else if (direction === 'down') {
      upwards = false;
    } else {
      // If space below is tight (< 280px) and space above has room (> 180px), open upwards
      upwards = spaceBelow < 280 && spaceAbove > 180;
    }

    const menuWidth = Math.round(Math.max(rect.width, 210));
    const triggerCenter = rect.left + rect.width / 2;
    const idealLeft = triggerCenter - menuWidth / 2;
    const clampedLeft = Math.round(Math.max(12, Math.min(idealLeft, window.innerWidth - menuWidth - 12)));

    const coords = {
      top: upwards ? undefined : Math.round(rect.bottom + 6),
      bottom: upwards ? Math.round(window.innerHeight - rect.top + 6) : undefined,
      left: clampedLeft,
      right: undefined,
      width: menuWidth,
    };

    return { upwards, alignRight: false, coords };
  }, [direction]);

  // Recalculate position on scroll or resize
  const updatePosition = useCallback(() => {
    const res = calculatePosition();
    if (res) {
      setOpenUpwards((prev) => (prev !== res.upwards ? res.upwards : prev));
      setAlignRight((prev) => (prev !== res.alignRight ? res.alignRight : prev));
      setPortalCoords((prev) => {
        if (
          prev &&
          prev.top === res.coords.top &&
          prev.bottom === res.coords.bottom &&
          prev.left === res.coords.left &&
          prev.right === res.coords.right &&
          prev.width === res.coords.width
        ) {
          return prev;
        }
        return res.coords;
      });
    }
  }, [calculatePosition]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      let rafId = 0;
      const handleScrollOrResize = () => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updatePosition);
      };
      window.addEventListener('resize', handleScrollOrResize, { passive: true });
      window.addEventListener('scroll', handleScrollOrResize, { passive: true, capture: true });
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', handleScrollOrResize);
        window.removeEventListener('scroll', handleScrollOrResize, true);
      };
    }
  }, [isOpen, updatePosition]);

  // Reset search and highlight ONLY when menu opens or closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setHighlightedIndex(-1);
      if (isSearchable) {
        // Do not auto-focus search input on mobile/touch devices to prevent popping the virtual keyboard
        const isTouch = typeof window !== 'undefined' && (
          window.matchMedia('(pointer: coarse)').matches ||
          window.innerWidth < 768 ||
          navigator.maxTouchPoints > 0
        );
        if (!isTouch) {
          setTimeout(() => searchInputRef.current?.focus(), 60);
        }
      }
    } else {
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  }, [isOpen, isSearchable]);

  // When search query changes while open, highlight first filtered option only when query is non-empty
  useEffect(() => {
    if (isOpen) {
      if (searchQuery.trim().length > 0) {
        setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1);
      } else {
        setHighlightedIndex(-1);
      }
    }
  }, [searchQuery, isOpen, filteredOptions.length]);

  // Outside click & touch handling
  useEffect(() => {
    const handleOutsideInteraction = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideInteraction);
      document.addEventListener('touchstart', handleOutsideInteraction, { passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideInteraction);
      document.removeEventListener('touchstart', handleOutsideInteraction);
    };
  }, [isOpen]);

  // Scroll active option into view inside dropdown
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && optionsListRef.current) {
      const items = optionsListRef.current.querySelectorAll('[role="option"]');
      const item = items[highlightedIndex] as HTMLElement | undefined;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          let next = prev < 0 ? 0 : prev + 1;
          while (next < filteredOptions.length && filteredOptions[next]?.disabled) {
            next++;
          }
          return next < filteredOptions.length ? next : prev;
        });
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setHighlightedIndex((prev) => {
          let next = prev < 0 ? filteredOptions.length - 1 : prev - 1;
          while (next >= 0 && filteredOptions[next]?.disabled) {
            next--;
          }
          return next >= 0 ? next : prev;
        });
        break;
      }
      case 'Home': {
        e.preventDefault();
        const first = filteredOptions.findIndex((o) => !o.disabled);
        if (first >= 0) setHighlightedIndex(first);
        break;
      }
      case 'End': {
        e.preventDefault();
        for (let i = filteredOptions.length - 1; i >= 0; i--) {
          if (!filteredOptions[i]?.disabled) {
            setHighlightedIndex(i);
            break;
          }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const targetOption = filteredOptions[highlightedIndex];
        if (targetOption && !targetOption.disabled) {
          handleOptionSelect(targetOption);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
      }
      case 'Tab': {
        setIsOpen(false);
        break;
      }
      default:
        break;
    }
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'white':
        return 'bg-white text-black font-bold hover:bg-white/95 border border-white/30 shadow-[0_4px_20px_rgba(255,255,255,0.25)]';
      case 'pill':
        return 'glass-pill-dark text-white font-semibold hover:border-white/30';
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
        return 'px-4 py-2 text-xs rounded-full gap-2.5';
    }
  };

  const highlightedOption = filteredOptions[highlightedIndex];

  // Menu Dropdown JSX
  const menuContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel || placeholder}
          initial={{ opacity: 0, y: openUpwards ? 6 : -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: openUpwards ? 4 : -4, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={
            portal && portalCoords
              ? {
                  position: 'fixed',
                  top: portalCoords.top !== undefined ? `${portalCoords.top}px` : undefined,
                  bottom: portalCoords.bottom !== undefined ? `${portalCoords.bottom}px` : undefined,
                  left: portalCoords.left !== undefined ? `${portalCoords.left}px` : undefined,
                  right: portalCoords.right !== undefined ? `${portalCoords.right}px` : undefined,
                  minWidth: `${portalCoords.width}px`,
                  zIndex: 999999,
                }
              : undefined
          }
          className={`${
            portal
              ? 'fixed z-[999999]'
              : `absolute left-1/2 -translate-x-1/2 ${
                  openUpwards ? 'bottom-full mb-2' : 'top-full mt-2'
                } z-[9999]`
          } min-w-[210px] max-w-[340px] w-max p-1.5 rounded-2xl bg-[#141418]/95 backdrop-blur-sm border border-white/20 shadow-[0_24px_60px_rgba(0,0,0,0.95),0_0_24px_-4px_rgba(41,151,255,0.18)] ring-1 ring-white/10 flex flex-col overflow-hidden ${menuClassName}`}
          onKeyDown={handleKeyDown}
        >
          {/* Optional Instant Search Filter */}
          {isSearchable && (
            <div
              className="p-1.5 pb-2 border-b border-white/[0.08]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 focus-within:border-sky-400/60 focus-within:ring-1 focus-within:ring-sky-400/30 transition-colors">
                <Search className="w-3.5 h-3.5 text-white/50 shrink-0 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setHighlightedIndex((prev) =>
                        prev < 0 ? 0 : Math.min(filteredOptions.length - 1, prev + 1)
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setHighlightedIndex((prev) =>
                        prev < 0 ? filteredOptions.length - 1 : Math.max(0, prev - 1)
                      );
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const targetOption = filteredOptions[highlightedIndex];
                      if (targetOption && !targetOption.disabled) {
                        handleOptionSelect(targetOption);
                      }
                    }
                  }}
                  placeholder={searchPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full"
                  aria-label={searchPlaceholder}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="text-white/40 hover:text-white shrink-0 cursor-pointer p-0.5"
                    aria-label="Temizle"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options List with sleek scrollbar */}
          <div
            ref={optionsListRef}
            onMouseLeave={() => setHighlightedIndex(-1)}
            className="max-h-60 overflow-y-auto space-y-0.5 py-1 no-scrollbar pr-0.5"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-5 px-3 text-center text-xs text-white/45">
                Eşleşen sonuç bulunamadı.
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isHighlighted = idx === highlightedIndex;
                const optionId = `${selectId}-opt-${opt.value}`;
                const selected = isOptionSelected(opt.value);

                return (
                  <button
                    key={opt.value}
                    id={optionId}
                    type="button"
                    role={multiple ? 'checkbox' : 'option'}
                    aria-selected={selected}
                    aria-checked={multiple ? selected : undefined}
                    aria-disabled={opt.disabled}
                    disabled={opt.disabled}
                    onClick={() => handleOptionSelect(opt)}
                    onMouseEnter={() => !opt.disabled && setHighlightedIndex(idx)}
                    className={`w-full flex items-center justify-between px-3.5 py-2 text-xs text-left rounded-xl transition-colors duration-150 cursor-pointer ${
                      opt.disabled
                        ? 'opacity-35 cursor-not-allowed text-white/40'
                        : selected
                        ? 'bg-gradient-to-r from-[var(--accent-blue)]/25 via-[var(--accent-blue)]/15 to-transparent text-white font-bold border-l-2 border-[var(--accent-blue)] shadow-xs'
                        : isHighlighted
                        ? 'bg-white/10 text-white'
                        : 'text-white/75 hover:bg-white/[0.07] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate min-w-0 pr-2">
                      {opt.icon && (
                        <span className="shrink-0 flex items-center justify-center text-white/70">
                          {opt.icon}
                        </span>
                      )}
                      <div className="flex flex-col truncate">
                        <span className="truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="text-[10px] text-white/45 truncate">
                            {opt.description}
                          </span>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <Check className="w-3.5 h-3.5 text-[var(--accent-blue)] shrink-0 ml-2" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Hidden input for HTML form submissions if name is supplied */}
      {name && <input type="hidden" name={name} value={Array.isArray(value) ? value.join(',') : value} />}

      {/* Trigger Button with Apple Spring Micro-Interaction & Lumina Focus Ring */}
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (!isOpen) {
            const res = calculatePosition();
            if (res) {
              setOpenUpwards(res.upwards);
              setAlignRight(res.alignRight);
              setPortalCoords(res.coords);
            }
            setIsOpen(true);
          } else {
            setIsOpen(false);
          }
        }}
        onKeyDown={handleKeyDown}
        className={`flex items-center justify-between cursor-pointer transition-colors duration-200 ease-out hover:brightness-110 active:scale-[0.98] select-none koup-focus-ring ${
          disabled ? 'opacity-40 cursor-not-allowed' : ''
        } ${getVariantStyles()} ${getSizeStyles()} ${triggerClassName}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && highlightedOption ? `${selectId}-opt-${highlightedOption.value}` : undefined
        }
        aria-disabled={disabled}
        aria-label={ariaLabel || placeholder}
      >
        <span className="flex items-center gap-2 truncate">
          {leftIcon ? (
            <span className="shrink-0 flex items-center justify-center">{leftIcon}</span>
          ) : (
            selectedOption?.icon
          )}
          <span className="font-semibold tracking-tight truncate">
            {displayLabel}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 opacity-70 ml-1.5 ${
            isOpen ? 'rotate-180 text-[var(--accent-blue)]' : ''
          }`}
        />
      </button>

      {/* Floating Glass Dropdown Menu (Portal or Absolute) */}
      {mounted && portal && typeof document !== 'undefined'
        ? createPortal(menuContent, document.body)
        : !portal
        ? menuContent
        : null}
    </div>
  );
}
