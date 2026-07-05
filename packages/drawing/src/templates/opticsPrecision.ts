import type { DrawCommand, TutorSegment } from "../drawingProtocol";
import type { DiagramTemplate } from "./types";

// The concave-mirror skeleton (see opticsRay.ts) has its pole (vertex) where the
// principal axis meets the arc: the mirror bezier passes through (610, 300). All
// precision markings are anchored to that exact point so labels/points land on
// the real geometry instead of a guessed grid.
const AXIS_Y = 300;
const POLE_X = 610;
// Usable axis span to the left of the pole for C, F, object and image.
const AXIS_LEFT = 442;
const AVAILABLE_PX = POLE_X - AXIS_LEFT;

// A point tick straddles the axis so a label can point at the exact spot.
const TICK_HALF = 7;
// Labels sit a clear gap above the axis so the text never traces the line.
const LABEL_TOP_Y = 252;

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

function extractOpticsNumbers(question: string): { objectCm: number | null; focalCm: number | null } {
  const objectCm = firstNumber(
    question.match(/object\s+(?:is\s+)?(?:placed\s+)?(?:at\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/(\d+(?:\.\d+)?)\s*cm\s+in\s+front\s+of/i),
    question.match(/object\s+distance\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bu\s*=?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );
  const focalCm = firstNumber(
    question.match(/focal\s+length\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*cm/i),
    question.match(/\bf\s*=?\s*(\d+(?:\.\d+)?)\s*cm/i),
  );
  return { objectCm, focalCm };
}

function formatCm(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function imageDistanceCm(objectCm: number | null, focalCm: number | null): number | null {
  if (!objectCm || !focalCm || objectCm <= focalCm) {
    return null;
  }
  const v = (objectCm * focalCm) / (objectCm - focalCm);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * A shared cm→px scale that keeps the largest measured distance inside the
 * usable axis span, so C, F, object and image stay to scale and on-screen.
 */
function computeScale(objectCm: number | null, focalCm: number | null, vCm: number | null): number {
  const maxCm = Math.max(objectCm ?? 0, (focalCm ?? 0) * 2, vCm ?? 0);
  if (maxCm <= 0) {
    return 4;
  }
  return clamp(AVAILABLE_PX / maxCm, 1.5, 4);
}

function axisX(distanceCm: number, scale: number): number {
  return clamp(Math.round(POLE_X - distanceCm * scale), AXIS_LEFT, POLE_X - 20);
}

/**
 * Tick + label that points at an exact axis point. The letter sits a clear gap
 * above the line so it never traces the geometry. When the point coincides with
 * the upright object arrow (e.g. object exactly at C), the letter is nudged to
 * the upper-left so it clears the arrow while the tick still marks the spot.
 */
function pointMark(x: number, label: string, avoidX: number | null): DrawCommand[] {
  const collidesWithObjectArrow = avoidX !== null && Math.abs(x - avoidX) < 22;
  const labelX = collidesWithObjectArrow ? x - 34 : x - 8;
  return [
    command("DRAW_LINE", [x, AXIS_Y - TICK_HALF, x, AXIS_Y + TICK_HALF]),
    command("LABEL", [labelX, LABEL_TOP_Y], label),
  ];
}

/**
 * Deterministic core markings for optics. The LLM can still explain and solve,
 * but these spatial facts (which point is C/F/O, and the u/f/v distances) should
 * never depend on guessed coordinates. Points are ticked and labelled above the
 * axis; distances are shown as thin dotted bars stacked below it.
 */
export function buildOpticsPrecisionSegments(
  template: DiagramTemplate,
  question: string | undefined,
): TutorSegment[] {
  if (template.id !== "optics_ray" || !question) {
    return [];
  }

  const { objectCm, focalCm } = extractOpticsNumbers(question);
  const vCm = imageDistanceCm(objectCm, focalCm);
  const scale = computeScale(objectCm, focalCm, vCm);

  const focalPx = focalCm ? focalCm * scale : 60;
  const focusX = clamp(Math.round(POLE_X - focalPx), AXIS_LEFT, POLE_X - 20);
  const curvatureX = clamp(Math.round(POLE_X - 2 * focalPx), AXIS_LEFT, POLE_X - 20);
  const objectX = objectCm ? axisX(objectCm, scale) : curvatureX;
  const imageX = vCm ? axisX(vCm, scale) : null;

  const segments: TutorSegment[] = [
    segment("C is the centre of curvature — this exact point, two focal lengths from the pole.", [
      ...pointMark(curvatureX, "C", objectX),
    ]),
    segment("F is the focus, one focal length from the pole — I'll mark it right here.", [
      ...pointMark(focusX, "F", objectX),
    ]),
    segment("O is the pole, where the principal axis meets the mirror surface.", [
      ...pointMark(POLE_X, "O", objectX),
    ]),
    segment("the object stands upright on the axis at this point.", [
      command("ARROW", [objectX, AXIS_Y, objectX, 240]),
      command("LABEL", [objectX - 30, 206], "object"),
    ]),
  ];

  // The real (inverted) image, drawn before the distance bars so its short arrow
  // and label sit clear of the measurement staircase below.
  if (vCm && imageX !== null) {
    segments.push(
      segment("the real image is inverted, forming on the same side as the object.", [
        command("ARROW", [imageX, AXIS_Y, imageX, 344]),
        command("LABEL", [imageX - 26, 348], "image"),
      ]),
    );
  }

  // Distances live below the axis as a clean staircase of thin dotted bars, so
  // no measurement ever boxes-in or touches the diagram.
  if (objectCm) {
    segments.push(
      segment(`u is the object distance, ${formatCm(objectCm)} centimetres from the object to the pole.`, [
        command("DIMENSION", [objectX, AXIS_Y, POLE_X, AXIS_Y, 88], `u = ${formatCm(objectCm)} cm`),
      ]),
    );
  }

  if (focalCm) {
    segments.push(
      segment(`f is the focal length, ${formatCm(focalCm)} centimetres from F to the pole.`, [
        command("DIMENSION", [focusX, AXIS_Y, POLE_X, AXIS_Y, 116], `f = ${formatCm(focalCm)} cm`),
      ]),
    );
  }

  if (vCm && imageX !== null) {
    segments.push(
      segment(`v is the image distance, ${formatCm(vCm)} centimetres from the image to the pole.`, [
        command("DIMENSION", [imageX, AXIS_Y, POLE_X, AXIS_Y, 144], `v = ${formatCm(vCm)} cm`),
      ]),
    );
  }

  return segments;
}
