import type { DrawCommand, TutorSegment } from "../drawingProtocol";
import type { DiagramTemplate } from "./types";
import { isOpticsTemplateId, type OpticsTemplateId } from "./opticsFamily";
import {
  AXIS_Y as SHARED_AXIS_Y,
  LENS_O_X as SHARED_LENS_O_X,
  MIRROR_POLE_X as SHARED_MIRROR_POLE_X,
} from "../geometrySnap";

export type OpticsKind =
  | "mirror"
  | "lens"
  | "prism"
  | "tir"
  | "combo"
  | "instrument"
  | "slab";

export interface OpticsParsedNumbers {
  u: number | null;
  v: number | null;
  f: number | null;
  f1: number | null;
  f2: number | null;
  R: number | null;
  mu: number | null;
  A: number | null;
  i: number | null;
  ic: number | null;
  L: number | null;
  D: number | null;
  fo: number | null;
  fe: number | null;
}

export interface OpticsClassifyResult {
  optics_kind: OpticsKind;
  matched_template_id: string;
  parsed_numbers: OpticsParsedNumbers;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface OpticsCommandSummary {
  type: string;
  params_preview: string;
  text?: string;
}

export interface OpticsIntroBuildResult {
  segments: TutorSegment[];
  optics_kind: OpticsKind;
  parsed_numbers: OpticsParsedNumbers;
  intro_segment_count: number;
  intro_command_types: string[];
  command_summary: OpticsCommandSummary[];
  classify: OpticsClassifyResult;
}

// Mirror geometry (optics_mirror): pole at (610, 300) — shared with geometrySnap.
const AXIS_Y = SHARED_AXIS_Y;
const MIRROR_POLE_X = SHARED_MIRROR_POLE_X;
const MIRROR_AXIS_LEFT = 442;
const MIRROR_AVAILABLE_PX = MIRROR_POLE_X - MIRROR_AXIS_LEFT;

// Lens geometry (optics_lens): optical centre at (650, 300).
const LENS_O_X = SHARED_LENS_O_X;
const LENS_AXIS_LEFT = 460;
const LENS_AXIS_RIGHT = 880;
const LENS_AVAILABLE_PX = Math.min(LENS_O_X - LENS_AXIS_LEFT, LENS_AXIS_RIGHT - LENS_O_X);

const TICK_HALF = 7;
/**
 * Label text *top* (handwriting y). Modest air gap above the axis so C/F/O
 * never touch the line they mark — close enough to read as "this point",
 * far enough that the glyph does not sit on the ink.
 * font ~32 → baseline ≈ y+31; with y=245, baseline≈276 → ~24px clear of y=300.
 */
const LABEL_ABOVE_Y = 245;
/** Alternate label band below the axis — same clear gap, never kissing the line. */
const LABEL_BELOW_Y = 355;
/** Object/image arrow tip (above axis) — label sits further above this tip. */
const ARROW_TIP_ABOVE_Y = 215;
/** Object/image arrow tip (below axis, inverted image). */
const ARROW_TIP_BELOW_Y = 390;

function command(
  type: DrawCommand["type"],
  params: number[],
  text?: string,
): DrawCommand {
  return {
    type,
    params,
    text,
    charPosition: 0,
    narrationBefore: "",
    syncable: type === "LABEL" || type === "WRITE" || type === "DIMENSION",
    syncReason: type === "DIMENSION" ? "template-precision-dimension" : undefined,
  };
}

function segment(narration: string, commands: DrawCommand[]): TutorSegment {
  return {
    narration,
    command: commands[0] ?? null,
    commands,
    templateIntro: true,
  };
}

function firstNumber(...matches: Array<RegExpMatchArray | null>): number | null {
  for (const match of matches) {
    const raw = match?.slice(1).find((value) => value !== undefined);
    if (!raw) {
      continue;
    }
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function formatCm(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;
}

function formatNum(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function emptyNumbers(): OpticsParsedNumbers {
  return {
    u: null,
    v: null,
    f: null,
    f1: null,
    f2: null,
    R: null,
    mu: null,
    A: null,
    i: null,
    ic: null,
    L: null,
    D: null,
    fo: null,
    fe: null,
  };
}

/** Parse common Ray Optics quantities from the question text. */
export function parseOpticsNumbers(question: string): OpticsParsedNumbers {
  const numbers = emptyNumbers();

  numbers.u = firstNumber(
    question.match(/object\s+(?:is\s+)?(?:placed\s+)?(?:at\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/(\d+(?:\.\d+)?)\s*cm\s+in\s+front\s+of/i),
    question.match(/(\d+(?:\.\d+)?)\s*cm\s+to\s+the\s+left/i),
    question.match(/object\s+distance\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bu\s*=?\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.f = firstNumber(
    question.match(/focal\s+length\s+(?:of\s+)?(?:the\s+)?(?:mirror|lens)?\s*(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/focal\s+length\s+(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bf\s*=?\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.v = firstNumber(
    question.match(/image\s+distance\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bv\s*=?\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.R = firstNumber(
    question.match(/radius\s+of\s+curvature\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bR\s*=?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.mu = firstNumber(
    question.match(/refractive\s+index\s+(?:is\s+)?(?:μ\s*=\s*|n\s*=\s*)?(\d+(?:\.\d+)?)/i),
    question.match(/(?:μ|mu|n)\s*=\s*(\d+(?:\.\d+)?)/i),
  );

  numbers.A = firstNumber(
    question.match(/(?:prism\s+)?angle\s+(?:of\s+(?:the\s+)?prism\s+)?(?:is\s+)?(?:A\s*=\s*)?(\d+(?:\.\d+)?)\s*°/i),
    question.match(/\bA\s*=\s*(\d+(?:\.\d+)?)\s*°?/i),
  );

  numbers.i = firstNumber(
    question.match(/angle\s+of\s+incidence\s+(?:is\s+)?(?:i\s*=\s*)?(\d+(?:\.\d+)?)\s*°/i),
    question.match(/\bi\s*=\s*(\d+(?:\.\d+)?)\s*°/i),
  );

  numbers.ic = firstNumber(
    question.match(/critical\s+angle\s+(?:is\s+)?(?:i_?c\s*=\s*)?(\d+(?:\.\d+)?)\s*°/i),
    question.match(/i_?c\s*=\s*(\d+(?:\.\d+)?)\s*°/i),
  );

  numbers.L = firstNumber(
    question.match(/tube\s+length\s+(?:is\s+)?(?:L\s*=\s*)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bL\s*=\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.D = firstNumber(
    question.match(/near\s+point\s+(?:is\s+)?(?:D\s*=\s*)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bD\s*=\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.fo = firstNumber(
    question.match(/focal\s+length\s+of\s+(?:the\s+)?objective\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/f_?o\s*=\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.fe = firstNumber(
    question.match(/focal\s+length\s+of\s+(?:the\s+)?eyepiece\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/f_?e\s*=\s*(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.f1 = firstNumber(
    question.match(/f_?1\s*=\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/first\s+lens[^.]*focal\s+length\s+(\d+(?:\.\d+)?)\s*cm/i),
  );

  numbers.f2 = firstNumber(
    question.match(/f_?2\s*=\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/second\s+lens[^.]*focal\s+length\s+(\d+(?:\.\d+)?)\s*cm/i),
  );

  if (!numbers.f1 || !numbers.f2) {
    const pair = question.match(
      /f_?1\s*=\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm[^.]{0,40}f_?2\s*=\s*[-−]?\s*(\d+(?:\.\d+)?)\s*cm/i,
    );
    if (pair) {
      numbers.f1 = numbers.f1 ?? Number(pair[1]);
      numbers.f2 = numbers.f2 ?? Number(pair[2]);
    }
  }

  if (numbers.f1 == null || numbers.f2 == null) {
    const lensFocals = [
      ...question.matchAll(
        /(convex|concave)\s+lens\s+of\s+focal\s+length\s+(\d+(?:\.\d+)?)\s*cm/gi,
      ),
    ];
    if (lensFocals.length >= 2) {
      const signed = lensFocals.map((match) => {
        const magnitude = Number(match[2]);
        return String(match[1]).toLowerCase() === "concave" ? -magnitude : magnitude;
      });
      numbers.f1 = numbers.f1 ?? signed[0] ?? null;
      numbers.f2 = numbers.f2 ?? signed[1] ?? null;
    }
  }

  if (!numbers.f && numbers.R) {
    numbers.f = numbers.R / 2;
  }

  return numbers;
}

const TEMPLATE_KIND: Record<OpticsTemplateId, OpticsKind> = {
  optics_prism: "prism",
  optics_tir: "tir",
  optics_instrument: "instrument",
  optics_lens_combo: "combo",
  optics_lens: "lens",
  optics_mirror: "mirror",
  optics_refraction_plane: "slab",
};

/**
 * Classify the optics problem from the matched template + question text.
 * Template id is authoritative when it is an optics family id.
 */
export function classifyOptics(
  template: DiagramTemplate,
  question: string,
): OpticsClassifyResult {
  const parsed_numbers = parseOpticsNumbers(question);
  const templateId = template.id;

  if (isOpticsTemplateId(templateId)) {
    const optics_kind = TEMPLATE_KIND[templateId as OpticsTemplateId];
    const hasKeyNumber =
      ((optics_kind === "mirror" || optics_kind === "lens") &&
        (parsed_numbers.u !== null || parsed_numbers.f !== null)) ||
      (optics_kind === "prism" && (parsed_numbers.A !== null || parsed_numbers.mu !== null)) ||
      (optics_kind === "tir" && (parsed_numbers.mu !== null || parsed_numbers.ic !== null)) ||
      (optics_kind === "combo" && (parsed_numbers.f1 !== null || parsed_numbers.f2 !== null)) ||
      (optics_kind === "instrument" &&
        (parsed_numbers.fo !== null || parsed_numbers.fe !== null || parsed_numbers.L !== null)) ||
      optics_kind === "slab";

    return {
      optics_kind,
      matched_template_id: templateId,
      parsed_numbers,
      confidence: hasKeyNumber ? "high" : "medium",
      reason: hasKeyNumber
        ? `template ${templateId} with parsed numbers`
        : `template ${templateId}; numbers sparse — skeleton only`,
    };
  }

  if (templateId === "optics_ray") {
    return {
      optics_kind: "mirror",
      matched_template_id: templateId,
      parsed_numbers,
      confidence: "medium",
      reason: "legacy optics_ray id — treating as mirror",
    };
  }

  return {
    optics_kind: "mirror",
    matched_template_id: templateId,
    parsed_numbers,
    confidence: "low",
    reason: `non-optics template ${templateId}`,
  };
}

function imageDistanceCm(objectCm: number | null, focalCm: number | null): number | null {
  if (!objectCm || !focalCm || objectCm <= focalCm) {
    return null;
  }
  const v = (objectCm * focalCm) / (objectCm - focalCm);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function lensImageDistanceCm(objectCm: number | null, focalCm: number | null): number | null {
  if (!objectCm || !focalCm) {
    return null;
  }
  const v = (objectCm * focalCm) / (objectCm - focalCm);
  return Number.isFinite(v) ? v : null;
}

function computeScale(
  distances: Array<number | null>,
  availablePx: number,
): number {
  const maxCm = Math.max(0, ...distances.map((d) => (d !== null ? Math.abs(d) : 0)));
  if (maxCm <= 0) {
    return 4;
  }
  return clamp(availablePx / maxCm, 1.5, 4);
}

/**
 * Tick on the axis + letter clearly ABOVE and slightly beside the tick so the
 * glyph never sits on the principal axis or on top of the tick mark.
 */
function pointMark(
  x: number,
  label: string,
  avoidX: number | null,
): DrawCommand[] {
  const collidesWithObjectArrow = avoidX !== null && Math.abs(x - avoidX) < 28;
  // Sit left of the tick (not centered on it) so the letter is a callout, not ink on the point.
  const labelX = collidesWithObjectArrow ? x - 36 : x - 22;
  return [
    command("DRAW_LINE", [x, AXIS_Y - TICK_HALF, x, AXIS_Y + TICK_HALF]),
    command("LABEL", [labelX, LABEL_ABOVE_Y], label),
  ];
}

/** True when the question is about a convex (diverging) mirror. */
function isConvexMirrorQuestion(question: string | undefined): boolean {
  if (!question) {
    return false;
  }
  return /\bconvex\s+mirror\b/i.test(question);
}

/**
 * Convex-mirror image distance (Cartesian): u > 0 in front, f < 0 behind.
 * Returns signed v (negative = virtual, behind mirror) or null.
 */
function convexMirrorImageDistanceCm(
  objectCm: number | null,
  focalCm: number | null,
): number | null {
  if (!objectCm || !focalCm) {
    return null;
  }
  // 1/v + 1/u = 1/f with f = -|f|
  const f = -Math.abs(focalCm);
  const u = Math.abs(objectCm);
  const invV = 1 / f - 1 / u;
  if (!Number.isFinite(invV) || Math.abs(invV) < 1e-9) {
    return null;
  }
  const v = 1 / invV;
  return Number.isFinite(v) ? v : null;
}

function summarizeCommands(segments: TutorSegment[]): OpticsCommandSummary[] {
  return segments.flatMap((seg) =>
    (seg.commands ?? []).map((cmd) => ({
      type: cmd.type,
      params_preview: cmd.params.slice(0, 6).map((n) => Math.round(n)).join(","),
      ...(cmd.text ? { text: cmd.text.slice(0, 40) } : {}),
    })),
  );
}

function buildMirrorPrecision(
  numbers: OpticsParsedNumbers,
  question?: string,
): TutorSegment[] {
  const convex = isConvexMirrorQuestion(question);
  const objectCm = numbers.u;
  const focalCm = numbers.f;

  // Concave: real image when u > f (positive v in front). Convex: always virtual (v < 0 behind).
  const vSigned = convex
    ? (numbers.v !== null ? -Math.abs(numbers.v) : convexMirrorImageDistanceCm(objectCm, focalCm))
    : (numbers.v ?? imageDistanceCm(objectCm, focalCm));
  const vAbs = vSigned !== null ? Math.abs(vSigned) : null;
  const virtualBehind = convex || (vSigned !== null && vSigned < 0);

  // For convex, C and F sit BEHIND the mirror (right of pole). Object stays in front (left).
  const behindAvailable = 900 - MIRROR_POLE_X;
  const frontAvailable = MIRROR_AVAILABLE_PX;
  const scale = computeScale(
    [
      objectCm,
      focalCm,
      vAbs,
      focalCm ? focalCm * 2 : null,
    ],
    Math.min(frontAvailable, behindAvailable),
  );

  const focalPx = focalCm ? focalCm * scale : 60;
  const objectX = objectCm
    ? clamp(Math.round(MIRROR_POLE_X - objectCm * scale), MIRROR_AXIS_LEFT, MIRROR_POLE_X - 24)
    : MIRROR_POLE_X - Math.round(2 * focalPx);

  let focusX: number;
  let curvatureX: number;
  if (convex) {
    focusX = clamp(Math.round(MIRROR_POLE_X + focalPx), MIRROR_POLE_X + 24, 880);
    curvatureX = clamp(Math.round(MIRROR_POLE_X + 2 * focalPx), MIRROR_POLE_X + 40, 900);
  } else {
    focusX = clamp(Math.round(MIRROR_POLE_X - focalPx), MIRROR_AXIS_LEFT, MIRROR_POLE_X - 20);
    curvatureX = clamp(Math.round(MIRROR_POLE_X - 2 * focalPx), MIRROR_AXIS_LEFT, MIRROR_POLE_X - 20);
  }

  const imageX =
    vAbs !== null
      ? virtualBehind
        ? clamp(Math.round(MIRROR_POLE_X + vAbs * scale), MIRROR_POLE_X + 20, 900)
        : clamp(Math.round(MIRROR_POLE_X - vAbs * scale), MIRROR_AXIS_LEFT, MIRROR_POLE_X - 20)
      : null;

  const segments: TutorSegment[] = [
    segment(
      convex
        ? "C, F, and O mark the centre of curvature, focus, and pole — for a convex mirror, C and F lie behind the reflecting surface."
        : "C, F, and O mark the centre of curvature, the focus, and the pole on the principal axis.",
      [
        ...pointMark(curvatureX, "C", objectX),
        ...pointMark(focusX, "F", objectX),
        ...pointMark(MIRROR_POLE_X, "O", objectX),
      ],
    ),
    segment("the object stands upright on the axis in front of the mirror.", [
      command("ARROW", [objectX, AXIS_Y, objectX, ARROW_TIP_ABOVE_Y]),
      command("LABEL", [objectX - 52, LABEL_ABOVE_Y - 18], "object"),
    ]),
  ];

  if (imageX !== null && vAbs !== null) {
    if (virtualBehind) {
      segments.push(
        segment("the virtual image is erect and diminished, forming behind the mirror.", [
          command("ARROW", [imageX, AXIS_Y, imageX, ARROW_TIP_ABOVE_Y]),
          command("LABEL", [imageX - 44, LABEL_ABOVE_Y - 18], "image"),
        ]),
      );
    } else {
      segments.push(
        segment("the real image is inverted, forming on the same side as the object.", [
          command("ARROW", [imageX, AXIS_Y, imageX, ARROW_TIP_BELOW_Y]),
          command("LABEL", [imageX - 40, LABEL_BELOW_Y + 24], "image"),
        ]),
      );
    }
  }

  // Distance bars: pack u/f/v into one segment to cut chain depth.
  const dimCommands: ReturnType<typeof command>[] = [];
  const dimParts: string[] = [];
  if (objectCm) {
    dimCommands.push(
      command(
        "DIMENSION",
        [objectX, AXIS_Y, MIRROR_POLE_X, AXIS_Y, 92],
        `u = ${formatCm(objectCm)} cm`,
      ),
    );
    dimParts.push(`u is ${formatCm(objectCm)} centimetres from the object to the pole`);
  }
  if (focalCm) {
    dimCommands.push(
      command(
        "DIMENSION",
        [focusX, AXIS_Y, MIRROR_POLE_X, AXIS_Y, 124],
        convex ? `f = −${formatCm(focalCm)} cm` : `f = ${formatCm(focalCm)} cm`,
      ),
    );
    dimParts.push(
      convex
        ? `f is ${formatCm(focalCm)} centimetres behind the pole`
        : `f is ${formatCm(focalCm)} centimetres from F to the pole`,
    );
  }
  if (imageX !== null && vAbs !== null) {
    dimCommands.push(
      command(
        "DIMENSION",
        [imageX, AXIS_Y, MIRROR_POLE_X, AXIS_Y, 156],
        virtualBehind ? `v = −${formatCm(vAbs)} cm` : `v = ${formatCm(vAbs)} cm`,
      ),
    );
    dimParts.push(
      virtualBehind
        ? `v is ${formatCm(vAbs)} centimetres behind the pole`
        : `v is ${formatCm(vAbs)} centimetres from the image to the pole`,
    );
  }
  if (dimCommands.length > 0) {
    segments.push(segment(`${dimParts.join("; ")}.`, dimCommands));
  }

  return segments;
}

function buildLensPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const objectCm = numbers.u;
  const focalCm = numbers.f;
  const vRaw = numbers.v ?? lensImageDistanceCm(objectCm, focalCm);
  const vCm = vRaw !== null ? Math.abs(vRaw) : null;
  const virtualImage = vRaw !== null && vRaw < 0;
  const scale = computeScale([objectCm, focalCm, vCm], LENS_AVAILABLE_PX);

  const focusLeftX = focalCm
    ? clamp(Math.round(LENS_O_X - focalCm * scale), LENS_AXIS_LEFT, LENS_O_X - 20)
    : LENS_O_X - 80;
  const focusRightX = focalCm
    ? clamp(Math.round(LENS_O_X + focalCm * scale), LENS_O_X + 20, LENS_AXIS_RIGHT)
    : LENS_O_X + 80;
  const objectX = objectCm
    ? clamp(Math.round(LENS_O_X - objectCm * scale), LENS_AXIS_LEFT, LENS_O_X - 20)
    : focusLeftX - 40;
  const imageX =
    vCm !== null
      ? virtualImage
        ? clamp(Math.round(LENS_O_X - vCm * scale), LENS_AXIS_LEFT, LENS_O_X - 20)
        : clamp(Math.round(LENS_O_X + vCm * scale), LENS_O_X + 20, LENS_AXIS_RIGHT)
      : null;

  const segments: TutorSegment[] = [
    segment("O, F, and F prime mark the optical centre and the two foci of the thin lens.", [
      ...pointMark(LENS_O_X, "O", objectX),
      ...pointMark(focusLeftX, "F", objectX),
      ...pointMark(focusRightX, "F'", null),
    ]),
  ];

  if (objectCm) {
    segments.push(
      segment("the object stands upright on the axis at this point.", [
        command("ARROW", [objectX, AXIS_Y, objectX, ARROW_TIP_ABOVE_Y]),
        command("LABEL", [objectX - 52, LABEL_ABOVE_Y - 18], "object"),
      ]),
    );
  }

  if (imageX !== null && vCm !== null) {
    if (virtualImage) {
      segments.push(
        segment("the virtual image is erect, on the same side as the object.", [
          command("ARROW", [imageX, AXIS_Y, imageX, ARROW_TIP_ABOVE_Y]),
          command("LABEL", [imageX - 44, LABEL_ABOVE_Y - 18], "image"),
        ]),
      );
    } else {
      segments.push(
        segment("the real image is inverted, on the other side of the lens.", [
          command("ARROW", [imageX, AXIS_Y, imageX, ARROW_TIP_BELOW_Y]),
          command("LABEL", [imageX - 40, LABEL_BELOW_Y + 24], "image"),
        ]),
      );
    }
  }

  const dimCommands: ReturnType<typeof command>[] = [];
  const dimParts: string[] = [];
  if (objectCm) {
    dimCommands.push(
      command("DIMENSION", [objectX, AXIS_Y, LENS_O_X, AXIS_Y, 92], `u = ${formatCm(objectCm)} cm`),
    );
    dimParts.push(`u is ${formatCm(objectCm)} centimetres from the object to O`);
  }
  if (focalCm) {
    dimCommands.push(
      command("DIMENSION", [focusLeftX, AXIS_Y, LENS_O_X, AXIS_Y, 124], `f = ${formatCm(focalCm)} cm`),
    );
    dimParts.push(`f is ${formatCm(focalCm)} centimetres from F to O`);
  }
  if (imageX !== null && vCm !== null) {
    dimCommands.push(
      command(
        "DIMENSION",
        [imageX, AXIS_Y, LENS_O_X, AXIS_Y, 156],
        virtualImage ? `v = −${formatCm(vCm)} cm` : `v = ${formatCm(vCm)} cm`,
      ),
    );
    dimParts.push(`v is ${formatCm(vCm)} centimetres from the image to O`);
  }
  if (dimCommands.length > 0) {
    segments.push(segment(`${dimParts.join("; ")}.`, dimCommands));
  }

  return segments;
}

function buildPrismPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const segments: TutorSegment[] = [];
  if (numbers.A !== null) {
    segments.push(
      segment(`A is the refracting angle of the prism, ${formatNum(numbers.A)} degrees.`, [
        command("LABEL", [688, 150], "A"),
        command("LABEL", [720, 150], `${formatNum(numbers.A)}°`),
      ]),
    );
  } else {
    segments.push(
      segment("A is the refracting angle at the apex of the prism.", [
        command("LABEL", [688, 150], "A"),
      ]),
    );
  }

  if (numbers.mu !== null) {
    segments.push(
      segment(`μ is the refractive index of the prism material, ${formatNum(numbers.mu)}.`, [
        // Inside the prism body, clear of the base / axis line.
        command("LABEL", [640, 240], `μ = ${formatNum(numbers.mu)}`),
      ]),
    );
  }

  if (numbers.i !== null) {
    segments.push(
      segment(`i is the angle of incidence on the first face, ${formatNum(numbers.i)} degrees.`, [
        command("LABEL", [480, 220], `i = ${formatNum(numbers.i)}°`),
      ]),
    );
  }

  segments.push(
    segment("δ is the angle of deviation between the incident and emergent directions.", [
      command("LABEL", [760, 180], "δ"),
    ]),
  );

  return segments;
}

function buildTirPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const segments: TutorSegment[] = [
    segment("the normal is perpendicular to the interface at the point of incidence.", [
      command("LABEL", [690, 170], "N"),
    ]),
  ];

  if (numbers.ic !== null) {
    segments.push(
      segment(`i_c is the critical angle, ${formatNum(numbers.ic)} degrees — beyond this, light reflects totally.`, [
        command("LABEL", [700, LABEL_BELOW_Y], `i_c = ${formatNum(numbers.ic)}°`),
      ]),
    );
  } else if (numbers.mu !== null) {
    const icApprox = Math.round((Math.asin(1 / numbers.mu) * 180) / Math.PI);
    segments.push(
      segment(`with μ = ${formatNum(numbers.mu)}, the critical angle is about ${icApprox} degrees.`, [
        command("LABEL", [500, LABEL_ABOVE_Y], `μ = ${formatNum(numbers.mu)}`),
        command("LABEL", [700, LABEL_BELOW_Y], `i_c ≈ ${icApprox}°`),
      ]),
    );
  } else {
    segments.push(
      segment("i_c is the critical angle — when incidence exceeds it, total internal reflection occurs.", [
        command("LABEL", [700, LABEL_BELOW_Y], "i_c"),
      ]),
    );
  }

  return segments;
}

function buildComboPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const segments: TutorSegment[] = [
    segment("two thin lenses sit in contact — their optical centres coincide on the axis.", [
      command("LABEL", [640, LABEL_ABOVE_Y], "O"),
    ]),
  ];

  if (numbers.f1 !== null) {
    segments.push(
      segment(`f₁ is the focal length of the first lens, ${formatCm(numbers.f1)} centimetres.`, [
        command("LABEL", [540, LABEL_ABOVE_Y - 10], `f₁ = ${formatCm(numbers.f1)} cm`),
      ]),
    );
  }

  if (numbers.f2 !== null) {
    segments.push(
      segment(`f₂ is the focal length of the second lens, ${formatCm(numbers.f2)} centimetres.`, [
        command("LABEL", [720, LABEL_ABOVE_Y - 10], `f₂ = ${formatCm(numbers.f2)} cm`),
      ]),
    );
  }

  if (numbers.f1 !== null && numbers.f2 !== null) {
    const F = (numbers.f1 * numbers.f2) / (numbers.f1 + numbers.f2);
    if (Number.isFinite(F) && F > 0) {
      segments.push(
        segment(`the equivalent focal length F is ${formatCm(F)} centimetres from 1/F = 1/f₁ + 1/f₂.`, [
          command("LABEL", [640, LABEL_ABOVE_Y - 36], `F = ${formatCm(F)} cm`),
        ]),
      );
    }
  }

  return segments;
}

function buildInstrumentPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const segments: TutorSegment[] = [
    segment("the objective faces the object and forms the first image.", [
      command("LABEL", [500, LABEL_ABOVE_Y], "O"),
    ]),
    segment("the eyepiece is near the eye and magnifies that intermediate image.", [
      command("LABEL", [800, LABEL_ABOVE_Y], "E"),
    ]),
  ];

  if (numbers.fo !== null) {
    segments.push(
      segment(`f_o is the focal length of the objective, ${formatCm(numbers.fo)} centimetres.`, [
        command("LABEL", [520, LABEL_BELOW_Y], `f_o = ${formatCm(numbers.fo)} cm`),
      ]),
    );
  }

  if (numbers.fe !== null) {
    segments.push(
      segment(`f_e is the focal length of the eyepiece, ${formatCm(numbers.fe)} centimetres.`, [
        command("LABEL", [740, LABEL_BELOW_Y], `f_e = ${formatCm(numbers.fe)} cm`),
      ]),
    );
  }

  if (numbers.L !== null) {
    segments.push(
      segment(`L is the tube length, ${formatCm(numbers.L)} centimetres between the lenses.`, [
        command("DIMENSION", [520, AXIS_Y, 820, AXIS_Y, 88], `L = ${formatCm(numbers.L)} cm`),
      ]),
    );
  }

  if (numbers.D !== null) {
    segments.push(
      segment(`D is the near point, ${formatCm(numbers.D)} centimetres — usually 25 cm for a normal eye.`, [
        command("LABEL", [860, LABEL_BELOW_Y + 28], `D = ${formatCm(numbers.D)} cm`),
      ]),
    );
  }

  return segments;
}

function buildSlabPrecision(numbers: OpticsParsedNumbers): TutorSegment[] {
  const segments: TutorSegment[] = [
    segment("the slab has two parallel faces — the ray shifts sideways but does not deviate in direction.", [
      command("LABEL", [640, LABEL_ABOVE_Y], "slab"),
    ]),
  ];

  if (numbers.mu !== null) {
    segments.push(
      segment(`μ is the refractive index of the slab, ${formatNum(numbers.mu)}.`, [
        // Inside the slab body, clear of the horizontal faces / axis.
        command("LABEL", [640, 240], `μ = ${formatNum(numbers.mu)}`),
      ]),
    );
  }

  if (numbers.i !== null) {
    segments.push(
      segment(`i is the angle of incidence on the first face, ${formatNum(numbers.i)} degrees.`, [
        command("LABEL", [460, 160], `i = ${formatNum(numbers.i)}°`),
      ]),
    );
  }

  return segments;
}

function buildPrecisionForKind(
  kind: OpticsKind,
  numbers: OpticsParsedNumbers,
  question?: string,
): TutorSegment[] {
  switch (kind) {
    case "mirror":
      return buildMirrorPrecision(numbers, question);
    case "lens":
      return buildLensPrecision(numbers);
    case "prism":
      return buildPrismPrecision(numbers);
    case "tir":
      return buildTirPrecision(numbers);
    case "combo":
      return buildComboPrecision(numbers);
    case "instrument":
      return buildInstrumentPrecision(numbers);
    case "slab":
      return buildSlabPrecision(numbers);
    default:
      return [];
  }
}

/**
 * Build deterministic precision intro segments for any optics family template.
 * Returns segments plus a structured debug payload for Langfuse / tutorDebug.
 *
 * ## Optics debug playbook (Langfuse + console)
 * 1. Open the Langfuse turn by `traceId` (board turn stores `traceId`).
 * 2. Read metadata: wrong `matched_template_id` / `optics_kind` → matching/classifier bug.
 * 3. Read `optics-intro-built` command_summary → bad coordinates / missing labels.
 * 4. Read `geometry-snap` before/after → snap target wrong.
 * 5. Read `template-draw-blocked` → LLM tried to redraw skeleton.
 * 6. Read `segment-*` + `tts-timing-*` + `optics-sync-lag` → sync/pacing bug.
 * 7. Cross-check console `[tutor:optics]` / `[tutor:draw]` / `[tutor:segment]` with the same fields.
 * Contract: no silent diagram decisions — every match → classify → intro → snap/block → sync is an event.
 */
export function buildOpticsPrecisionIntro(
  template: DiagramTemplate,
  question: string | undefined,
): OpticsIntroBuildResult | null {
  if (!question) {
    return null;
  }

  const isOptics =
    isOpticsTemplateId(template.id) || template.id === "optics_ray";
  if (!isOptics) {
    return null;
  }

  const classify = classifyOptics(template, question);
  const segments = buildPrecisionForKind(classify.optics_kind, classify.parsed_numbers, question);
  const command_summary = summarizeCommands(segments);
  const intro_command_types = [...new Set(command_summary.map((c) => c.type))];

  return {
    segments,
    optics_kind: classify.optics_kind,
    parsed_numbers: classify.parsed_numbers,
    intro_segment_count: segments.length,
    intro_command_types,
    command_summary,
    classify,
  };
}

/**
 * Deterministic core markings for optics. The LLM can still explain and solve,
 * but spatial facts (C/F/O, u/f/v, prism angles, etc.) should never depend on
 * guessed coordinates.
 */
export function buildOpticsPrecisionSegments(
  template: DiagramTemplate,
  question: string | undefined,
): TutorSegment[] {
  return buildOpticsPrecisionIntro(template, question)?.segments ?? [];
}

/**
 * Compact metadata for Langfuse turn.meta once classification resolves.
 */
export function opticsDecisionMetadata(
  result: OpticsIntroBuildResult,
  extras?: {
    diagram_source?: string;
    allow_llm_draw?: boolean;
    planner_overridden?: boolean;
  },
): Record<string, unknown> {
  return {
    optics_kind: result.optics_kind,
    matched_template_id: result.classify.matched_template_id,
    diagram_source: extras?.diagram_source ?? "template",
    parsed_numbers: result.parsed_numbers,
    intro_segment_count: result.intro_segment_count,
    intro_command_types: result.intro_command_types,
    allow_llm_draw: extras?.allow_llm_draw ?? false,
    planner_overridden: extras?.planner_overridden ?? false,
    classify_confidence: result.classify.confidence,
    classify_reason: result.classify.reason,
  };
}
