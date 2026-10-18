'use client';

import React, { forwardRef } from 'react';

export interface KoupInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightAction?: React.ReactNode;
  containerClassName?: string;
  glowColor?: 'blue' | 'amber' | 'emerald';
}

const KoupInput = forwardRef<HTMLInputElement, KoupInputProps>(
  (
    {
      leftIcon,
      rightAction,
      containerClassName = '',
      className = '',
      glowColor = 'blue',
      ...inputProps
    },
    ref
  ) => {
    const glowClasses =
      glowColor === 'amber'
        ? 'focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/20 focus-within:shadow-[0_0_16px_rgba(251,191,36,0.25)]'
        : glowColor === 'emerald'
        ? 'focus-within:border-emerald-400/50 focus-within:ring-2 focus-within:ring-emerald-400/20 focus-within:shadow-[0_0_16px_rgba(16,185,129,0.25)]'
        : 'focus-within:border-[#2997ff]/60 focus-within:ring-2 focus-within:ring-[#2997ff]/20 focus-within:shadow-[0_0_18px_rgba(41,151,255,0.28)]';

    return (
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#0e0e12]/80 backdrop-blur-2xl border border-white/12 hover:border-white/25 transition-all duration-300 shadow-sm ${glowClasses} ${containerClassName}`}
      >
        {leftIcon && <div className="shrink-0 text-white/55 flex items-center">{leftIcon}</div>}
        <input
          ref={ref}
          className={`bg-transparent text-xs text-white placeholder-white/40 focus:outline-none w-full font-medium ${className}`}
          {...inputProps}
        />
        {rightAction && <div className="shrink-0 flex items-center">{rightAction}</div>}
      </div>
    );
  }
);

KoupInput.displayName = 'KoupInput';

export default KoupInput;
