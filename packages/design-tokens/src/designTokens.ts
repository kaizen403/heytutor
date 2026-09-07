/**
 * ACCELUTE — "Night Blueprint"
 *
 * The palette as TypeScript, for the places that cannot read a CSS variable:
 * canvas and Konva fills, SVG props, Satori/OG images, PDF export.
 *
 * The CSS side of the same theme is `apps/tutor/app/globals.css` (Tailwind v4
 * `@theme`) and `apps/landing/src/index.css` + `tailwind.config.js` (v3). A
 * colour must exist in all three or in none — see the layer comment at the top
 * of globals.css for what each group is for.
 */
export const DS = {
  Colors: {
    /* ── Ink: the deep navy canvas ─────────────────────────────────── */
    ink950: '#06121C',
    ink900: '#0A1B27',
    ink850: '#0D2231',
    ink800: '#122A39',
    ink750: '#182D47',
    ink700: '#1B3242',
    ink600: '#2C3C4A',
    ink500: '#3B5362',
    ink400: '#5D6C7B',
    ink300: '#758696',

    /* ── Sky: the accent light ─────────────────────────────────────── */
    sky700: '#2E7CA3',
    sky600: '#3E8FB4',
    sky500: '#59AFD4',
    sky400: '#7FC4E2',
    sky300: '#A5D6EC',
    sky200: '#CCE6F1',

    steel: '#608B9D',
    mist: '#ABC9D5',
    frost: '#F0F5F7',
    blue: '#5FA4F9',
    blueDeep: '#2563EB',

    /* ── Semantics: what a colour is for ───────────────────────────── */
    background: '#06121C',
    surface1: '#0D2231',
    surface2: '#122A39',
    surface3: '#1B3242',
    surface4: '#2C3C4A',
    borderSubtle: 'rgba(202,229,241,0.13)',
    borderStrong: 'rgba(202,229,241,0.26)',

    textPrimary: '#F0F5F7',
    textSecondary: 'rgba(240,245,247,0.68)',
    textTertiary: 'rgba(240,245,247,0.42)',

    accent: '#59AFD4',
    accentLight: '#7FC4E2',
    accentDark: '#3E8FB4',

    /* ── Status: the only hues off the blue axis ───────────────────── */
    danger: '#E06858',
    warning: '#E8913A',
    success: '#4CAF7D',

    statusIdle: 'rgba(93,108,123,0.7)',
    statusThinking: '#59AFD4',
    statusTeaching: '#59AFD4',

    /* ── Whiteboard: paper stays white so marker ink has its contrast ─ */
    whiteboard: '#FFFFFF',
    paper: '#FFFFFF',
    paperInk: '#06121C',
    paperBorder: 'rgba(202,229,241,0.13)',
    paperMuted: '#F4F7FA',
    paperPlaceholder: 'rgba(6,18,28,0.45)',

    /** Default marker ink — dark navy, legible on the white surface. */
    ink: '#1B2A4A',
    whiteboardInk: '#1B2A4A',

    /** The tutor's cursor, drawn over the board. */
    overlayCursorBlue: '#59AFD4',
  },
  CornerRadius: {
    small: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    medium: 8,
    large: 10,
  },
  Animation: {
    fast: 0.15,
    normal: 0.25,
    slow: 0.4,
  },
  Cursor: {
    size: 16,
    glowRadius: 8,
    flightScalePeak: 1.3,
    rotationDefault: -35,
  },
  Canvas: {
    width: 1200,
    height: 700,
  },
} as const;
