import React from 'react';

/**
 * Top 10 High-Precision SVG Numerals (Netflix Style)
 * 100% condensed vector geometry, hardware-accelerated, single-contour strokes.
 * Pure SVG vectors: 0 layout shift, crisp outline stroke, cinematic dark fill, zero device artifacts.
 */

interface GlyphDef {
  path: string;
  width: number;
}

const GLYPHS: Record<string, GlyphDef> = {
  "1": {
    width: 34,
    path: "M32 0 H18 L2 20 H18 V100 H32 V0 Z",
  },
  "2": {
    width: 54,
    path: "M2 24 C2 10 12 0 28 0 C44 0 52 10 52 26 C52 42 42 56 26 72 L16 84 H52 V100 H0 V86 L24 60 C36 46 40 38 40 26 C40 18 36 14 28 14 C20 14 15 18 14 24 Z",
  },
  "3": {
    width: 54,
    path: "M2 0 H48 C51 0 52 2 52 6 V34 C52 44 44 48 34 50 C45 52 52 58 52 70 V78 C52 92 42 100 28 100 C12 100 2 92 0 78 L14 74 C15 82 20 86 28 86 C34 86 38 82 38 74 V68 C38 60 32 56 24 56 H18 V44 H24 C32 44 38 40 38 32 V26 C38 19 34 14 28 14 C20 14 16 18 15 24 L2 20 Z",
  },
  "4": {
    width: 56,
    path: "M34 0 H50 V68 H54 V82 H50 V100 H34 V82 H0 V68 L34 0 Z M34 22 L11 68 H34 V22 Z",
  },
  "5": {
    width: 54,
    path: "M4 0 H50 V14 H18 V40 C22 37 28 36 34 36 C45 36 52 44 52 58 V74 C52 90 42 100 28 100 C12 100 2 92 0 76 L14 72 C15 80 20 86 28 86 C34 86 38 81 38 72 V60 C38 51 34 46 26 46 C20 46 16 49 14 52 L2 48 L4 0 Z",
  },
  "6": {
    width: 54,
    path: "M42 0 H48 L22 36 C26 34 31 34 36 34 C46 34 52 42 52 56 V76 C52 90 43 100 30 100 C13 100 0 88 0 68 V32 C0 14 16 0 42 0 Z M15 62 C15 54 20 48 28 48 C34 48 38 53 38 62 V72 C38 80 34 86 28 86 C21 86 15 80 15 72 Z",
  },
  "7": {
    width: 52,
    path: "M0 0 H50 V14 L20 100 H2 L32 14 H0 V0 Z",
  },
  "8": {
    width: 54,
    path: "M18 0 H34 C44 0 50 6 50 18 V28 C50 38 43 45 34 47 C45 49 52 57 52 68 V80 C52 92 44 100 32 100 H20 C8 100 0 92 0 80 V68 C0 57 7 49 18 47 C9 45 2 38 2 28 V18 C2 6 8 0 18 0 Z M16 14 C15 14 14 16 14 20 V26 C14 30 16 34 20 34 H32 C36 34 38 30 38 26 V20 C38 16 36 14 32 14 Z M18 60 C15 60 13 63 13 68 V78 C13 83 15 86 20 86 H32 C37 86 39 83 39 78 V68 C39 63 37 60 32 60 Z",
  },
  "9": {
    width: 54,
    path: "M10 100 H4 L30 64 C26 66 21 66 16 66 C6 66 0 58 0 44 V24 C0 10 9 0 22 0 C39 0 52 12 52 32 V68 C52 86 36 100 10 100 Z M37 38 C37 46 32 52 24 52 C18 52 14 47 14 38 V28 C14 20 18 14 24 14 C31 14 37 20 37 28 Z",
  },
  "0": {
    width: 52,
    path: "M16 0 H34 C43 0 50 7 50 18 V82 C50 93 43 100 34 100 H16 C7 100 0 93 0 82 V18 C0 7 7 0 16 0 Z M20 16 C16 16 13 20 13 25 V75 C13 80 16 84 20 84 H30 C34 84 37 80 37 75 V25 C37 20 34 16 30 16 Z",
  },
};

interface Top10NumeralProps {
  rank: number;
  className?: string;
}

export default function Top10Numeral({ rank, className = '' }: Top10NumeralProps) {
  const rankStr = String(rank);
  const is10 = rank === 10 || rankStr === '10';

  // Sizing & ViewBox based on exact glyph width
  const glyph = GLYPHS[rankStr] || GLYPHS['1'];
  const viewBox = is10 ? '0 0 76 100' : `0 0 ${glyph.width} 100`;

  return (
    <svg
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        {/* Crisp vector stroke style matching Netflix aesthetic */}
        <style>{`
          .top10-num-path {
            fill: #0c0d12;
            stroke: rgba(255, 255, 255, 0.52);
            stroke-width: 2.2px;
            stroke-linejoin: round;
            stroke-linecap: round;
            paint-order: stroke fill;
            transition: all 260ms cubic-bezier(0.16, 1, 0.3, 1);
          }
          .group:hover .top10-num-path {
            fill: #161822;
            stroke: #ffffff;
            stroke-width: 2.8px;
          }
        `}</style>
      </defs>

      {!is10 ? (
        <path d={glyph.path} className="top10-num-path" />
      ) : (
        <g>
          {/* Digit 1 */}
          <path d={GLYPHS['1'].path} className="top10-num-path" />
          {/* Digit 0 with Netflix optical overlap */}
          <g transform="translate(26, 0)">
            <path d={GLYPHS['0'].path} className="top10-num-path" />
          </g>
        </g>
      )}
    </svg>
  );
}
