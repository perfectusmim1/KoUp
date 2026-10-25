'use client';

import React, { forwardRef } from 'react';

export interface KoupInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightAction?: React.ReactNode;
  rightSlot?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
  containerClassName?: string;
  inputClassName?: string;
  glowColor?: 'blue' | 'amber' | 'emerald';
}

export const KoupInput = forwardRef<HTMLInputElement, KoupInputProps>(
  (
    {
      label,
      hint,
      error,
      size = 'md',
      leftIcon,
      rightAction,
      rightSlot,
      clearable,
      onClear,
      containerClassName = '',
      inputClassName = '',
      className = '',
      glowColor = 'blue',
      ...inputProps
    },
    ref
  ) => {
    const glowClasses =
      glowColor === 'amber'
        ? 'focus-within:border-amber-400/50 focus-within:ring-1 focus-within:ring-amber-400/20'
        : glowColor === 'emerald'
        ? 'focus-within:border-emerald-400/50 focus-within:ring-1 focus-within:ring-emerald-400/20'
        : 'focus-within:border-white/35 focus-within:ring-1 focus-within:ring-white/15';

    const sizeClasses =
      size === 'sm'
        ? 'px-3 py-1.5 rounded-xl text-xs'
        : size === 'lg'
        ? 'px-4 py-3 rounded-2xl text-sm'
        : 'px-3.5 py-2.5 rounded-2xl text-xs';

    const showClear = Boolean(clearable && onClear && inputProps.value);

    const inputBox = (
      <div
        className={`flex items-center gap-2.5 ${sizeClasses} bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 transition-all duration-300 shadow-sm ${glowClasses} ${containerClassName}`}
      >
        {leftIcon && <div className="shrink-0 text-white/55 flex items-center">{leftIcon}</div>}
        <input
          ref={ref}
          className={`bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium ${className} ${inputClassName}`}
          {...inputProps}
        />
        {showClear && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-white/40 hover:text-white/80 text-xs px-1 transition-colors cursor-pointer"
            aria-label="Temizle"
          >
            ✕
          </button>
        )}
        {(rightAction || rightSlot) && (
          <div className="shrink-0 flex items-center">{rightAction || rightSlot}</div>
        )}
      </div>
    );

    if (!label && !hint && !error) {
      return inputBox;
    }

    return (
      <div className="space-y-1 w-full">
        {label && (
          <label className="block text-[11px] font-medium text-white/70">
            {label}
          </label>
        )}
        {inputBox}
        {error ? (
          <p className="text-[10px] text-rose-400 font-medium">{error}</p>
        ) : hint ? (
          <p className="text-[10px] text-white/45">{hint}</p>
        ) : null}
      </div>
    );
  }
);

KoupInput.displayName = 'KoupInput';

export interface KoupTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
  glowColor?: 'blue' | 'amber' | 'emerald';
}

export const KoupTextarea = forwardRef<HTMLTextAreaElement, KoupTextareaProps>(
  (
    {
      label,
      hint,
      error,
      containerClassName = '',
      className = '',
      glowColor = 'blue',
      ...textareaProps
    },
    ref
  ) => {
    const glowClasses =
      glowColor === 'amber'
        ? 'focus-within:border-amber-400/50 focus-within:ring-1 focus-within:ring-amber-400/20'
        : glowColor === 'emerald'
        ? 'focus-within:border-emerald-400/50 focus-within:ring-1 focus-within:ring-emerald-400/20'
        : 'focus-within:border-white/35 focus-within:ring-1 focus-within:ring-white/15';

    const box = (
      <div
        className={`px-3.5 py-2.5 rounded-2xl bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 transition-all duration-300 shadow-sm ${glowClasses} ${containerClassName}`}
      >
        <textarea
          ref={ref}
          className={`bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium resize-none ${className}`}
          {...textareaProps}
        />
      </div>
    );

    if (!label && !hint && !error) {
      return box;
    }

    return (
      <div className="space-y-1 w-full">
        {label && (
          <label className="block text-[11px] font-medium text-white/70">
            {label}
          </label>
        )}
        {box}
        {error ? (
          <p className="text-[10px] text-rose-400 font-medium">{error}</p>
        ) : hint ? (
          <p className="text-[10px] text-white/45">{hint}</p>
        ) : null}
      </div>
    );
  }
);

KoupTextarea.displayName = 'KoupTextarea';

export default KoupInput;
