export const DS = {
  Colors: {
    // Palette: #003C43 #135D66 #77B0AA #E3FEF7 (colorhunt.co)

    // Deep dark teal — app shell, sidebar, darkest surfaces
    background: '#003C43',
    surface1: '#135D66',
    surface2: '#0d4a52',
    surface3: '#0a3a40',
    surface4: '#062a30',
    borderSubtle: 'rgba(119,176,170,0.2)',
    borderStrong: '#77B0AA',

    // Text — mint and sage on dark teal
    textPrimary: '#E3FEF7',
    textSecondary: '#77B0AA',
    textTertiary: 'rgba(119,176,170,0.5)',

    // Accent — sage for interactive elements
    accentAmber: '#77B0AA',
    accentAmberLight: '#9BC4BE',
    accentAmberDark: '#5a8a85',

    // Paper tones — mint-based for input and bubble
    paper: '#135D66',
    paperInk: '#E3FEF7',
    paperBorder: 'rgba(119,176,170,0.3)',
    paperMuted: '#0d4a52',
    paperPlaceholder: 'rgba(119,176,170,0.5)',

    // Status colors
    statusIdle: '#77B0AA',
    statusThinking: '#77B0AA',
    statusTeaching: '#E3FEF7',

    // Whiteboard — dry-erase cream surface with dark ink
    whiteboard: '#F8F6F0',
    ink: '#222222',
    whiteboardInk: '#222222',

    // Cursor — sage chalk
    overlayCursorBlue: '#77B0AA',
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
