import React from 'react';

interface CountryFlagProps {
  code?: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const FLAG_MAP: Record<string, string> = {
  KR: '/flags/kr.svg',
  CN: '/flags/cn.svg',
  JP: '/flags/jp.svg',
  TH: '/flags/th.svg',
  TW: '/flags/tw.svg',
  US: '/flags/us.svg',
  TR: '/flags/tr.svg',
  GB: '/flags/gb.svg',
  HK: '/flags/hk.svg',
  PH: '/flags/ph.svg',
  BR: '/flags/br.svg',
};

function CountryFlag({
  code,
  className = '',
  size = 'md',
}: CountryFlagProps) {
  if (!code) return null;

  const raw = code.toUpperCase().trim();
  let normalizedCode = raw;

  if (FLAG_MAP[raw]) {
    normalizedCode = raw;
  } else if (raw.includes('KOR')) {
    normalizedCode = 'KR';
  } else if (raw.includes('ÇIN') || raw.includes('CIN') || raw.includes('CHINA')) {
    normalizedCode = 'CN';
  } else if (raw.includes('JAP')) {
    normalizedCode = 'JP';
  } else if (raw.includes('THAI') || raw.includes('TAYL')) {
    normalizedCode = 'TH';
  } else if (raw.includes('TAIW') || raw.includes('TAYV')) {
    normalizedCode = 'TW';
  } else if (raw.includes('POLON') || raw.includes('POLAND')) {
    normalizedCode = 'PL';
  } else if (raw.includes('FRANS') || raw.includes('FRANCE')) {
    normalizedCode = 'FR';
  } else if (raw.includes('ALMAN') || raw.includes('GERMAN')) {
    normalizedCode = 'DE';
  } else if (raw.includes('ISPAN') || raw.includes('İSPAN') || raw.includes('SPAIN')) {
    normalizedCode = 'ES';
  } else if (raw.includes('ITAL') || raw.includes('İTAL')) {
    normalizedCode = 'IT';
  } else if (raw.includes('HIND') || raw.includes('HİND') || raw.includes('INDIA')) {
    normalizedCode = 'IN';
  } else if (raw.includes('IRAN') || raw.includes('İRAN')) {
    normalizedCode = 'IR';
  } else if (raw.includes('RUS')) {
    normalizedCode = 'RU';
  } else if (raw.includes('KANAD') || raw.includes('CANAD')) {
    normalizedCode = 'CA';
  } else if (raw.includes('ABD') || raw.includes('USA') || raw.includes('AMERICA')) {
    normalizedCode = 'US';
  } else if (raw.includes('TURK') || raw.includes('TÜRK')) {
    normalizedCode = 'TR';
  } else if (raw.includes('UK') || raw.includes('BRIT') || raw.includes('INGIL') || raw.includes('İNGİL')) {
    normalizedCode = 'GB';
  } else if (raw.includes('HONG')) {
    normalizedCode = 'HK';
  } else if (raw.includes('PHILIP') || raw.includes('FILIP') || raw.includes('FİLİP')) {
    normalizedCode = 'PH';
  } else if (raw.includes('BREZ') || raw.includes('BRAZ')) {
    normalizedCode = 'BR';
  }

  const src =
    FLAG_MAP[normalizedCode] ||
    (/^[A-Z]{2}$/.test(normalizedCode) && normalizedCode !== 'GL'
      ? `https://flagcdn.com/${normalizedCode.toLowerCase()}.svg`
      : null);
  if (!src) return null;

  const sizeClasses = {
    sm: 'w-4 h-3',
    md: 'w-5 h-3.5',
    lg: 'w-6 h-4',
  }[size];

  const dimensions = {
    sm: { width: 16, height: 12 },
    md: { width: 20, height: 14 },
    lg: { width: 24, height: 16 },
  }[size];

  return (
    <img
      src={src}
      alt={`${normalizedCode} bayrağı`}
      width={dimensions.width}
      height={dimensions.height}
      loading="lazy"
      decoding="async"
      className={`inline-block object-cover rounded-xs shrink-0 shadow-xs border border-white/10 ${sizeClasses} ${className}`}
    />
  );
}

export default React.memo(CountryFlag);

