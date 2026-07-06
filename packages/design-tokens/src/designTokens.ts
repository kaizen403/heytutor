export const DS = {
  Colors: {
    // Palette: #659287 #88BDA4 #B1D3B9 #E6F2DD #FFFFFF
    // Sage green — darkest sage as primary accent, pale sage as background

    // Light background — app shell, surfaces
    background: '#E6F2DD',
    surface1: '#FFFFFF',
    surface2: '#F0F7E8',
    surface3: '#E6F2DD',
    surface4: '#B1D3B9',
    borderSubtle: 'rgba(101,146,135,0.2)',
    borderStrong: '#659287',

    // Text — dark text on light background
    textPrimary: '#333333',
    textSecondary: '#5A6B62',
    textTertiary: 'rgba(51,51,51,0.5)',

    // Accent — sage for interactive elements
    accentAmber: '#659287',
    accentAmberLight: '#88BDA4',
    accentAmberDark: '#4F7468',

    // Paper tones — white for input and bubble
    paper: '#FFFFFF',
    paperInk: '#333333',
    paperBorder: 'rgba(101,146,135,0.3)',
    paperMuted: '#E6F2DD',
    paperPlaceholder: 'rgba(51,51,51,0.5)',

    // Status colors
    statusIdle: '#659287',
    statusThinking: '#88BDA4',
    statusTeaching: '#659287',

    // Whiteboard — cream surface with dark ink (physical board metaphor)
    whiteboard: '#F8F6F0',
    ink: '#333333',
    whiteboardInk: '#333333',

    // Cursor — sage chalk
    overlayCursorBlue: '#659287',
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
