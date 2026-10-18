/**
 * Utilities for normalizing and preparing user search input across KoUp.
 * 
 * Handles:
 * 1. Collapsing multiple spaces and stripping leading/trailing whitespace.
 * 2. Normalizing Turkish specific casing and diacritics (ı -> i, ğ -> g, ü -> u, ş -> s, ö -> o, ç -> c, İ -> i).
 * 3. Stripping non-alphanumeric punctuation (while preserving Korean, Japanese, Chinese, Cyrillic).
 * 4. Generating both tokenized word arrays and condensed no-space strings (e.g. "doctorx" for "doctor x").
 */

export interface NormalizedSearch {
  raw: string;
  normalized: string;
  condensed: string;
  tokens: string[];
}

export function normalizeSearchQuery(input: string): NormalizedSearch {
  const raw = (input || '').trim();
  if (!raw) {
    return { raw: '', normalized: '', condensed: '', tokens: [] };
  }

  const lower = raw.toLowerCase();

  // Turkish character mapping
  const trNormalized = lower
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

  // Replace punctuation and symbols with space (keeping CJK, Cyrillic, and alphanumeric)
  const cleaned = trNormalized
    .replace(/[^a-z0-9\u0400-\u04ff\u1100-\u11ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const condensed = cleaned.replace(/\s+/g, '');
  const tokens = cleaned.split(' ').filter((t) => t.length > 0);

  return {
    raw,
    normalized: cleaned,
    condensed,
    tokens,
  };
}
