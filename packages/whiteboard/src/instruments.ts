/**
 * The kit the virtual hand reaches for.
 *
 * Each instrument is a real object — barrel, collar, nib, crown — with its own
 * palette, so the board can put a pen down and pick a pencil up instead of
 * recolouring one generic stick. Palettes are derived from the live ink colour
 * so a red board gets a red pen, a red-leaded pencil and a red highlighter
 * without hard-coding one variant per marker colour.
 */

export type InstrumentKind = "pen" | "pencil" | "highlighter" | "duster";

/** What the hand is doing right now — picks both the instrument and the tilt. */
export type PenActivity =
  | "write"
  | "draw"
  | "annotate"
  | "highlight"
  | "erase"
  | "idle";

/**
 * Writing is inked, construction geometry is sketched, emphasis is a chisel
 * highlighter. Erasing is the duster the board already renders.
 */
export function instrumentForActivity(activity: PenActivity): InstrumentKind {
  if (activity === "draw") return "pencil";
  if (activity === "highlight") return "highlighter";
  if (activity === "erase") return "duster";
  return "pen";
}

export interface InstrumentPalette {
  /** Barrel body plus its lit and shaded facets. */
  barrel: string;
  barrelLight: string;
  barrelShade: string;
  /** Tapered section under the barrel: steel cone, sharpened wood, or collar. */
  collar: string;
  collarLight: string;
  collarShade: string;
  /** Metal band — pen ring, pencil ferrule, highlighter sleeve. */
  ferrule: string;
  ferruleLight: string;
  ferruleShade: string;
  /** Ink-coloured accent: grip, brand band, highlighter window. */
  accent: string;
  accentLight: string;
  accentShade: string;
  /** The part that touches the board. */
  nib: string;
  nibLight: string;
  nibShade: string;
  /** Far end: pen crown, pencil eraser, highlighter cap. */
  cap: string;
  capLight: string;
  capShade: string;
  /** Silhouette line shared by every part. */
  outline: string;
}

function channels(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Blend two colours; `amount` is how much of `target` lands in the result. */
export function mix(hex: string, target: string, amount: number): string {
  const from = channels(hex);
  const to = channels(target);
  if (!from || !to) return hex;
  const t = Math.max(0, Math.min(1, amount));
  return toHex(
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  );
}

/** Darken toward black — the shaded facet of a barrel. */
export function shade(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

/** Lighten toward white — the specular stripe down a barrel. */
export function tint(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}

const STEEL = "#C4CAD2";
const STEEL_LIGHT = "#F1F4F8";
const STEEL_SHADE = "#7C838D";

const PENCIL_YELLOW = "#EFAF25";
const WOOD = "#E6C79B";
const BRASS = "#C7A02C";
const ERASER_PINK = "#E78A94";

function penPalette(ink: string): InstrumentPalette {
  return {
    barrel: "#262B35",
    barrelLight: "#5C6573",
    barrelShade: "#0C0F15",
    collar: STEEL,
    collarLight: STEEL_LIGHT,
    collarShade: STEEL_SHADE,
    ferrule: STEEL,
    ferruleLight: STEEL_LIGHT,
    ferruleShade: STEEL_SHADE,
    accent: ink,
    accentLight: tint(ink, 0.4),
    accentShade: shade(ink, 0.42),
    nib: shade(ink, 0.12),
    nibLight: tint(ink, 0.3),
    nibShade: shade(ink, 0.5),
    cap: "#191D25",
    capLight: "#3C434F",
    capShade: "#070A0E",
    outline: "#06080C",
  };
}

function pencilPalette(ink: string): InstrumentPalette {
  // A dark ink keeps an honest graphite lead; a coloured ink turns the same
  // pencil into a colour pencil rather than lying about what it lays down.
  const lead = mix("#33353D", ink, 0.46);
  return {
    barrel: PENCIL_YELLOW,
    barrelLight: tint(PENCIL_YELLOW, 0.36),
    barrelShade: shade(PENCIL_YELLOW, 0.32),
    collar: WOOD,
    collarLight: tint(WOOD, 0.34),
    collarShade: shade(WOOD, 0.26),
    ferrule: BRASS,
    ferruleLight: tint(BRASS, 0.45),
    ferruleShade: shade(BRASS, 0.38),
    accent: ink,
    accentLight: tint(ink, 0.36),
    accentShade: shade(ink, 0.4),
    nib: lead,
    nibLight: tint(lead, 0.28),
    nibShade: shade(lead, 0.45),
    cap: ERASER_PINK,
    capLight: tint(ERASER_PINK, 0.32),
    capShade: shade(ERASER_PINK, 0.3),
    outline: "#3A2E18",
  };
}

function highlighterPalette(ink: string): InstrumentPalette {
  // A highlighter is a translucent body of fluorescent fluid with a saturated
  // cap and felt tip. The barrel has to stay pale enough to read as
  // see-through, but not so pale it vanishes against a cream board — so the
  // silhouette is carried by a dark outline and a strongly coloured cap.
  return {
    barrel: tint(ink, 0.52),
    barrelLight: tint(ink, 0.82),
    barrelShade: tint(ink, 0.2),
    collar: "#F5F3EC",
    collarLight: "#FFFFFF",
    collarShade: "#C3BFB2",
    ferrule: "#EAE6DC",
    ferruleLight: "#FFFFFF",
    ferruleShade: "#B4AFA1",
    // The fluid window shows the undiluted colour it lays down.
    accent: ink,
    accentLight: tint(ink, 0.3),
    accentShade: shade(ink, 0.32),
    nib: ink,
    nibLight: tint(ink, 0.22),
    nibShade: shade(ink, 0.42),
    cap: shade(ink, 0.08),
    capLight: tint(ink, 0.3),
    capShade: shade(ink, 0.38),
    outline: shade(ink, 0.58),
  };
}

function dusterPalette(): InstrumentPalette {
  return {
    barrel: "#D4CDBE",
    barrelLight: "#EFEADF",
    barrelShade: "#A79E8B",
    collar: "#B8B0A0",
    collarLight: "#D8D2C4",
    collarShade: "#8C8474",
    ferrule: "#B8B0A0",
    ferruleLight: "#D8D2C4",
    ferruleShade: "#8C8474",
    accent: "#8C8474",
    accentLight: "#B8B0A0",
    accentShade: "#6B6455",
    nib: "#4A4A4A",
    nibLight: "#7A7A7A",
    nibShade: "#2C2C2C",
    cap: "#B8B0A0",
    capLight: "#D8D2C4",
    capShade: "#8C8474",
    outline: "#6B6455",
  };
}

export function instrumentPalette(kind: InstrumentKind, inkColor: string): InstrumentPalette {
  const ink = channels(inkColor) ? inkColor : "#1B2A4A";
  if (kind === "pencil") return pencilPalette(ink);
  if (kind === "highlighter") return highlighterPalette(ink);
  if (kind === "duster") return dusterPalette();
  return penPalette(ink);
}

/**
 * Instrument art as data, not JSX.
 *
 * Konva renders it on the board and `preview-instruments` renders the exact
 * same list to SVG, so what a designer looks at and what the tutor holds can
 * never drift apart. Local space: nib at (0,0), barrel running up -Y.
 */
export type PaletteKey = keyof InstrumentPalette;

interface ShapeBase {
  fill?: PaletteKey;
  stroke?: PaletteKey;
  strokeWidth?: number;
  opacity?: number;
  /** The one shape per instrument that casts the drop shadow. */
  shadow?: boolean;
}

export type InstrumentShape =
  | (ShapeBase & { kind: "poly"; points: number[] })
  | (ShapeBase & { kind: "stroke"; points: number[] })
  | (ShapeBase & {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius?: number;
    })
  | (ShapeBase & { kind: "circle"; x: number; y: number; radius: number });

/** Slim rollerball: steel cone, rubber grip in the ink colour, graphite barrel. */
const PEN_SHAPES: InstrumentShape[] = [
  // Nib — the ink colour shows at the point that touches the board.
  { kind: "poly", points: [0, 0, -1.35, -5.2, 1.35, -5.2], fill: "nib", stroke: "nibShade", strokeWidth: 0.32 },
  { kind: "poly", points: [0, -0.4, -1.05, -5.2, -0.15, -5.2], fill: "nibLight", opacity: 0.45 },
  // Brushed steel cone.
  { kind: "poly", points: [-1.35, -5.2, -3, -11, 3, -11, 1.35, -5.2], fill: "collar", stroke: "outline", strokeWidth: 0.27 },
  { kind: "poly", points: [-1.35, -5.2, -3, -11, -1.15, -11, -0.5, -5.2], fill: "collarLight", opacity: 0.8 },
  { kind: "poly", points: [1.35, -5.2, 1.4, -11, 3, -11], fill: "collarShade", opacity: 0.65 },
  // Moulded rubber grip.
  { kind: "rect", x: -3.3, y: -21.5, width: 6.6, height: 10.6, radius: 1.1, fill: "accent", stroke: "accentShade", strokeWidth: 0.45 },
  { kind: "rect", x: -2.5, y: -20.7, width: 1.3, height: 9, radius: 0.6, fill: "accentLight", opacity: 0.55 },
  { kind: "rect", x: -3.3, y: -18.4, width: 6.6, height: 0.7, fill: "accentShade", opacity: 0.45 },
  { kind: "rect", x: -3.3, y: -16.2, width: 6.6, height: 0.7, fill: "accentShade", opacity: 0.45 },
  { kind: "rect", x: -3.3, y: -14, width: 6.6, height: 0.7, fill: "accentShade", opacity: 0.45 },
  // Chrome ring between grip and barrel.
  { kind: "rect", x: -3.6, y: -23.3, width: 7.2, height: 2, radius: 0.5, fill: "ferrule", stroke: "ferruleShade", strokeWidth: 0.32 },
  // Graphite barrel with a specular stripe and a shaded edge.
  { kind: "rect", x: -3.5, y: -37.6, width: 7, height: 14.5, radius: 1.5, fill: "barrel", stroke: "outline", strokeWidth: 0.45, shadow: true },
  { kind: "rect", x: -2.6, y: -36.7, width: 1.5, height: 12.7, radius: 0.7, fill: "barrelLight", opacity: 0.5 },
  { kind: "rect", x: 1.4, y: -36.7, width: 1.7, height: 12.7, radius: 0.7, fill: "barrelShade", opacity: 0.55 },
  // Pocket clip.
  { kind: "rect", x: 2.9, y: -36.4, width: 1.5, height: 9.2, radius: 0.7, fill: "ferrule", stroke: "ferruleShade", strokeWidth: 0.27 },
  // Crown with an ink-colour dot, the way a pen tells you what it writes in.
  { kind: "rect", x: -3.5, y: -41, width: 7, height: 4, radius: 1.8, fill: "cap", stroke: "outline", strokeWidth: 0.45 },
  { kind: "circle", x: 0, y: -39.2, radius: 1.1, fill: "accent" },
];

/** Hex HB: sharpened wood cone, faceted barrel, brass ferrule, eraser. */
const PENCIL_SHAPES: InstrumentShape[] = [
  // Exposed lead.
  { kind: "poly", points: [0, 0, -1.9, -5.4, 1.9, -5.4], fill: "nib", stroke: "nibShade", strokeWidth: 0.32 },
  { kind: "poly", points: [0, -0.5, -1.5, -5.4, -0.2, -5.4], fill: "nibLight", opacity: 0.4 },
  // Sharpened wood, with the facets a blade leaves.
  { kind: "poly", points: [-1.9, -5.4, -3.9, -13.6, 3.9, -13.6, 1.9, -5.4], fill: "collar", stroke: "outline", strokeWidth: 0.32 },
  { kind: "poly", points: [-1.9, -5.4, -3.9, -13.6, -1.4, -13.6, -0.7, -5.4], fill: "collarLight", opacity: 0.85 },
  { kind: "poly", points: [1.9, -5.4, 1.5, -13.6, 3.9, -13.6], fill: "collarShade", opacity: 0.6 },
  // Hexagonal barrel: three visible facets and the seams between them.
  { kind: "rect", x: -3.9, y: -37, width: 7.8, height: 23.4, radius: 0.4, fill: "barrel", stroke: "outline", strokeWidth: 0.36, shadow: true },
  { kind: "rect", x: -3.9, y: -37, width: 2.1, height: 23.4, fill: "barrelLight", opacity: 0.7 },
  { kind: "rect", x: 1.9, y: -37, width: 2, height: 23.4, fill: "barrelShade", opacity: 0.55 },
  { kind: "stroke", points: [-1.8, -37, -1.8, -13.6], stroke: "barrelShade", strokeWidth: 0.3, opacity: 0.5 },
  { kind: "stroke", points: [1.9, -37, 1.9, -13.6], stroke: "barrelShade", strokeWidth: 0.3, opacity: 0.5 },
  // Printed band in the ink colour.
  { kind: "rect", x: -3.9, y: -36.2, width: 7.8, height: 2.2, fill: "accent", opacity: 0.92 },
  // Ribbed brass ferrule.
  { kind: "rect", x: -4.05, y: -42.6, width: 8.1, height: 5.6, radius: 0.4, fill: "ferrule", stroke: "ferruleShade", strokeWidth: 0.32 },
  { kind: "rect", x: -4.05, y: -42.6, width: 1.7, height: 5.6, fill: "ferruleLight", opacity: 0.55 },
  { kind: "rect", x: -4.05, y: -41.3, width: 8.1, height: 0.5, fill: "ferruleShade", opacity: 0.5 },
  { kind: "rect", x: -4.05, y: -39.8, width: 8.1, height: 0.5, fill: "ferruleShade", opacity: 0.5 },
  { kind: "rect", x: -4.05, y: -38.3, width: 8.1, height: 0.5, fill: "ferruleShade", opacity: 0.5 },
  // Eraser.
  { kind: "rect", x: -3.6, y: -46.6, width: 7.2, height: 4.4, radius: 1.8, fill: "cap", stroke: "capShade", strokeWidth: 0.32 },
  { kind: "rect", x: -2.9, y: -45.9, width: 1.6, height: 2.8, radius: 0.8, fill: "capLight", opacity: 0.6 },
];

/** Chisel highlighter: felt wedge, white collar, translucent barrel and window. */
const HIGHLIGHTER_SHAPES: InstrumentShape[] = [
  { kind: "poly", points: [0, 0, -3.4, -3.2, -3.4, -7, 3.4, -7, 3.4, -3.2], fill: "nib", stroke: "nibShade", strokeWidth: 0.32 },
  { kind: "poly", points: [0, -0.6, -2.8, -3.4, -2.8, -6.6, -0.6, -6.6], fill: "nibLight", opacity: 0.45 },
  { kind: "rect", x: -4.4, y: -9.8, width: 8.8, height: 3, radius: 0.6, fill: "collar", stroke: "collarShade", strokeWidth: 0.32 },
  { kind: "rect", x: -5.2, y: -33.2, width: 10.4, height: 23.6, radius: 2.4, fill: "barrel", stroke: "outline", strokeWidth: 0.45, opacity: 0.96, shadow: true },
  // The ink window — how much colour is left in the barrel.
  { kind: "rect", x: -3.4, y: -29.4, width: 6.8, height: 13.4, radius: 1.2, fill: "accent", opacity: 0.5 },
  { kind: "rect", x: -4.3, y: -32.2, width: 2.2, height: 21.6, radius: 1.1, fill: "barrelLight", opacity: 0.7 },
  { kind: "rect", x: 2.1, y: -32.2, width: 2.3, height: 21.6, radius: 1.1, fill: "barrelShade", opacity: 0.5 },
  { kind: "rect", x: -5.2, y: -38.4, width: 10.4, height: 5.8, radius: 2.2, fill: "cap", stroke: "outline", strokeWidth: 0.45 },
  { kind: "rect", x: -4.2, y: -37.6, width: 2, height: 4, radius: 1, fill: "capLight", opacity: 0.55 },
];

/** Felt block — only reached when a caller asks for the duster explicitly. */
const DUSTER_SHAPES: InstrumentShape[] = [
  { kind: "rect", x: -14, y: -14, width: 28, height: 14, radius: 3, fill: "barrel", stroke: "collarShade", strokeWidth: 1, shadow: true },
  { kind: "rect", x: -14, y: -4.5, width: 28, height: 4.5, radius: 2, fill: "nib", opacity: 0.75 },
];

const SHAPES: Record<InstrumentKind, InstrumentShape[]> = {
  pen: PEN_SHAPES,
  pencil: PENCIL_SHAPES,
  highlighter: HIGHLIGHTER_SHAPES,
  duster: DUSTER_SHAPES,
};

export function instrumentShapes(kind: InstrumentKind): readonly InstrumentShape[] {
  return SHAPES[kind];
}

/**
 * Barrel outline, nib first and up the left side. Motion-blur ghosts are drawn
 * from this rather than from the full shape table: a smear only needs the
 * silhouette, and one polygon per ghost instead of twenty keeps a four-deep
 * trail cheap enough to redraw every frame.
 */
const SILHOUETTES: Record<InstrumentKind, number[]> = {
  pen: [
    0, 0, -1.35, -5.2, -3, -11, -3.3, -21.5, -3.6, -23.3, -3.5, -37.6, -3.5, -41,
    3.5, -41, 3.5, -37.6, 3.6, -23.3, 3.3, -21.5, 3, -11, 1.35, -5.2,
  ],
  pencil: [
    0, 0, -1.9, -5.4, -3.9, -13.6, -3.9, -37, -4.05, -42.6, -3.6, -46.6,
    3.6, -46.6, 4.05, -42.6, 3.9, -37, 3.9, -13.6, 1.9, -5.4,
  ],
  highlighter: [
    0, 0, -3.4, -3.2, -3.4, -7, -4.4, -9.8, -5.2, -33.2, -5.2, -38.4,
    5.2, -38.4, 5.2, -33.2, 4.4, -9.8, 3.4, -7, 3.4, -3.2,
  ],
  duster: [-14, 0, -14, -14, 14, -14, 14, 0],
};

export function instrumentSilhouette(kind: InstrumentKind): readonly number[] {
  return SILHOUETTES[kind];
}

export interface InstrumentMetrics {
  /** Barrel length from nib to crown, in local units. */
  height: number;
  /** Y of the barrel mid-point — the finger twirls the instrument about this. */
  pivotY: number;
}

const METRICS: Record<InstrumentKind, InstrumentMetrics> = {
  pen: { height: 41, pivotY: -21 },
  pencil: { height: 46.5, pivotY: -23 },
  highlighter: { height: 38.4, pivotY: -20 },
  duster: { height: 14, pivotY: -7 },
};

export function instrumentMetrics(kind: InstrumentKind): InstrumentMetrics {
  return METRICS[kind];
}
