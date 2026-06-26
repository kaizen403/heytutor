export const DS = {
  Colors: {
    // Palette: #0077CC #DAE8FC #333333 #EAEAEA #FFFFFF

    // Light background — app shell, surfaces
    background: '#EAEAEA',
    surface1: '#FFFFFF',
    surface2: '#F5F5F5',
    surface3: '#EAEAEA',
    surface4: '#DAE8FC',
    borderSubtle: 'rgba(0,119,204,0.2)',
    borderStrong: '#0077CC',

    // Text — dark text on light background
    textPrimary: '#333333',
    textSecondary: '#666666',
    textTertiary: 'rgba(51,51,51,0.5)',

    // Accent — blue for interactive elements
    accentAmber: '#0077CC',
    accentAmberLight: '#0099E5',
    accentAmberDark: '#005599',

    // Paper tones — white for input and bubble
    paper: '#FFFFFF',
    paperInk: '#333333',
    paperBorder: 'rgba(0,119,204,0.3)',
    paperMuted: '#EAEAEA',
    paperPlaceholder: 'rgba(51,51,51,0.5)',

    // Status colors
    statusIdle: '#0077CC',
    statusThinking: '#0077CC',
    statusTeaching: '#333333',

    // Whiteboard — white surface with dark ink
    whiteboard: '#FFFFFF',
    ink: '#333333',
    whiteboardInk: '#333333',

    // Cursor — blue chalk
    overlayCursorBlue: '#0077CC',
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
