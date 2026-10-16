---
name: Lumina Cinema
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353434'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c8'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c6c6c7'
  primary: '#ffffff'
  on-primary: '#2f3131'
  primary-container: '#e2e2e2'
  on-primary-container: '#636565'
  inverse-primary: '#5d5f5f'
  secondary: '#c7c6cb'
  on-secondary: '#2f3034'
  secondary-container: '#46464b'
  on-secondary-container: '#b5b4ba'
  tertiary: '#ffffff'
  on-tertiary: '#00315c'
  tertiary-container: '#d3e3ff'
  on-tertiary-container: '#0066b5'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c7'
  on-primary-fixed: '#1a1c1c'
  on-primary-fixed-variant: '#454747'
  secondary-fixed: '#e3e2e7'
  secondary-fixed-dim: '#c7c6cb'
  on-secondary-fixed: '#1a1b1f'
  on-secondary-fixed-variant: '#46464b'
  tertiary-fixed: '#d3e3ff'
  tertiary-fixed-dim: '#a3c9ff'
  on-tertiary-fixed: '#001c39'
  on-tertiary-fixed-variant: '#004882'
  background: '#141313'
  on-background: '#e5e2e1'
  surface-variant: '#353434'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 42px
    letterSpacing: -0.025em
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.025em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.01em
  badge-technical:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.06em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 3.5rem
  margin-tablet: 2rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system embodies an ultra-refined, cinematic visual language engineered for immersive entertainment. Drawing direct inspiration from modern Cupertino industrial aesthetics and premier theater environments, the interface recedes completely into deep, true-pitch darkness to let content, key art, and high-dynamic-range cinematography take center stage.

The style fuses **Minimalism** with tactile **Glassmorphism**:
- **Aesthetic Core:** Seamless OLED blacks layered with optically balanced translucent surfaces, ultra-fine specular highlights, and edge-lit structural rims.
- **Atmosphere:** Controlled, high-fidelity luxury. Interfaces feel weightless yet physically present through precise backdrop blurs, crisp micro-borders, and cinematic lighting accents.
- **User Emotion:** Effortless immersion, premium prestige, and distilled clarity free of cognitive clutter.

## Colors

The palette is anchored in an uncompromising deep-black spectrum engineered for high-contrast OLED displays, illuminated by pure white typographic hierarchies and an electric spectral blue accent:

- **Surface Foundations:**
  - `Canvas / True Black`: `#000000` — Zero-luminance baseline for full immersion and seamless hardware bezels.
  - `Surface Low`: `#0A0A0C` — Deep recessed container tone for backdrops and section breaks.
  - `Surface Mid`: `#141418` — Elevated container for card structures and secondary modules.
  - `Surface High / Glass Tint`: `rgba(28, 28, 34, 0.65)` — Semi-translucent material backing.

- **Metallic & Accent Tones:**
  - `Primary / Crisp White`: `#FFFFFF` — Hero titles, high-emphasis icons, and solid pill actions.
  - `Secondary / Muted Titanium`: `#86868B` — Secondary metadata, timestamps, and subtle UI strokes.
  - `Tertiary / Lumina Cinema Blue`: `#2997FF` — Interactive focus rings, dynamic scrubbers, and active states.
  - `Specular Stroke`: `rgba(255, 255, 255, 0.12)` — Micro-border across top edges simulating top-down ambient key lighting.

- **Functional Badging:**
  - Badges (4K Ultra HD, Dolby Vision, Dolby Atmos) utilize high-contrast translucent fills `rgba(255, 255, 255, 0.08)` bound by sharp `rgba(255, 255, 255, 0.2)` borders with crisp white text.

## Typography

The type system is powered by **Plus Jakarta Sans**, chosen for its optical geometric precision, razor-clean apertures, and nuanced letterforms that echo Apple's system font architecture (SF Pro Display and SF Pro Text).

- **Hierarchy & Tracking:** Display and headline levels require deliberate negative letter-spacing (`-0.03em` to `-0.015em`) to produce a tight, editorial presence across billboard art.
- **Body & Legibility:** Mid-range body text relaxes into natural tracking for reading cast overviews, synopsis copy, and metadata in dim lighting.
- **Technical Labels:** Badges for stream standards (HDR, 4K, ATMOS) enforce strict uppercase rendering with expanded tracking (`0.06em`) to ensure legibility at micro dimensions (11px).

## Layout & Spacing

The layout employs a responsive 12-column grid system paired with horizontal scroll rails that intentionally bleed off-canvas to encourage lateral navigation:

- **Breakpoints:**
  - **Desktop (≥ 1280px):** 12 columns, 56px (`3.5rem`) outer margin, 24px (`1.5rem`) gutter. Full-bleed edge carousels snap dynamically to layout margins.
  - **Tablet (768px – 1279px):** 8 columns, 32px (`2rem`) outer margin, 20px gutter.
  - **Mobile (≤ 767px):** 4 columns, 20px (`1.25rem`) outer margin, 12px (`0.75rem`) gutter. Single-card hero banners reflow vertically into 16:9 or 9:16 aspect containers.

- **Rhythm:**
  - Billboard modules maintain a fixed bottom safe zone (`space-xl`) for metadata and action clusters.
  - Carousel rows maintain a constant `space-xl` stack separation, while cards within horizontal carousels adhere strictly to `space-md` gaps.

## Elevation & Depth

Visual hierarchy is constructed through optical translucency, layered lighting, and physical depth rather than harsh cast shadows:

- **Frosted Glass Materiality:**
  - Navigation bars, overlays, and floating media controls use `backdrop-filter: blur(28px) saturate(180%)` over `rgba(10, 10, 12, 0.72)`.
  - Border treatments employ an ultra-fine 1px perimeter stroke tinted `rgba(255, 255, 255, 0.12)`, augmented by an internal top highlight `inset 0 1px 0 rgba(255, 255, 255, 0.18)` simulating edge refraction.

- **Ambient Volumetric Shadowing:**
  - Floating focus items and hovered poster cards utilize wide, dark, diffused ambient falls: `box-shadow: 0 20px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.15)`.
  - Focused interactive elements display an energetic, soft cinematic halo: `0 0 30px -4px rgba(41, 151, 255, 0.3)`.

## Shapes

The interface embraces organic curvature characterized by full pill geometry for controls and soft, continuous-curve squircle envelopes for content containers:

- **Pills (`roundedness: 3`):** Primary action buttons, media filter chips, player timeline thumbs, and search fields are fully pill-shaped.
- **Card Envelopes:** Media posters and preview cards utilize continuous corners (`16px` on desktop, `12px` on mobile) to maintain structural softness against the dark backdrop.
- **Player & Modals:** Overlay panels and video interface drawers use `24px` continuous radii to echo glass slate hardware designs.

## Components

### Buttons
- **Primary Pill:** Solid pure white (`#FFFFFF`) surface with deep obsidian text (`#000000`), bold tracking, and no external border. Hover adds an intense specular bloom (`box-shadow: 0 0 20px rgba(255, 255, 255, 0.35)`).
- **Glass / Secondary Pill:** Translucent surface `rgba(255, 255, 255, 0.12)` with `backdrop-filter: blur(16px)`, crisp white text, and a 1px border `rgba(255, 255, 255, 0.16)`.
- **Icon Actions:** Circular glass buttons (44px × 44px) housing centered 18px iconography for play, plus-to-watchlist, and audio selection.

### Chips & Badges
- **Technical Specification Badges:** Rectangular badges with a micro radius (`4px`), padding `2px 6px`, border `1px solid rgba(255, 255, 255, 0.25)`, display typography `badge-technical`. Applied to "4K", "HDR", "VISION", and "ATMOS".
- **Category Filter Chips:** Floating translucent pill tabs; active states transition from frosted tint to solid white fill with inverted dark typography.

### Horizontal Card Carousels
- **Poster Ratio:** Standard vertical `2:3` and cinematic landscape `16:9` thumbnails with subtle overflow perspective scale (`scale(1.03)`) upon hover/focus.
- **Scrub Previews:** Progress bars integrate seamlessly into the bottom 4px border of cards, tinted `#2997FF` with a glowing playhead indicator.

### Minimalist Navigation Bar
- **App-Style Top Bar:** Floating island or fixed full-width shelf with deep blur (`backdrop-filter: blur(32px)`). Contains an unobtrusive logo mark, centralized category anchors with pill highlight underlines, and an integrated glass search pill on the trailing edge.

### Input Fields
- Darkened pill inputs (`rgba(255, 255, 255, 0.08)`) with recessed search iconography, subtle placeholder text in `#86868B`, and a crisp tertiary focus ring (`#2997FF`).