import type { RenderPoint, SceneDocument, SceneIssue } from "../types";
import { invalid, placement, rejectUnknownKeys, scalar, sourceUnits, type SourceContext } from "./sourceScalars";
import type { InstrumentGeometry, InstrumentMark } from "./chapterInstrumentGeometry";

/**
 * Qualitative fluid apparatus: figures that teach a law with no stated
 * numbers. Every length is a display length, every label is a symbol, and no
 * output certifies a physical value. What each figure does prove is the law's
 * shape inside its own drawing:
 *
 * - submerged_body: gauge pressure grows linearly with depth, so the arrow on
 *   each horizontal face is proportional to that face's depth, and the net
 *   upward force is their difference, proportional to the body's height
 *   (F_B = F_bottom - F_top = rho g A H = rho g V).
 * - hydraulic_press: one pressure acts on both pistons at the same level, so
 *   the force arrows are in the ratio of the drawn piston areas (circular
 *   pistons: the square of the drawn widths). Pressure is a word on the fluid,
 *   never an arrow.
 */
export const FLUID_APPARATUS_OPERATORS = ["submerged_body", "hydraulic_press"] as const;
export type FluidApparatusOperator = (typeof FLUID_APPARATUS_OPERATORS)[number];

export const FLUID_APPARATUS_OUTPUT_COUNTS: Readonly<Record<FluidApparatusOperator, number>> = {
  submerged_body: 8,
  hydraulic_press: 7,
};

/** The label texts each role may carry; the first is the default. No numbers. */
const ROLE_LABELS: Readonly<Record<string, readonly string[]>> = {
  fluid: ["fluid", "liquid"],
  surface: ["surface", "free surface"],
  body: ["body", "object", "block"],
  F_top: ["F_top", "F1", "F₁"],
  F_bottom: ["F_bottom", "F2", "F₂"],
  F_B: ["F_B", "F_b", "U", "upthrust", "buoyant force"],
  h1: ["h1", "h₁"],
  h2: ["h2", "h₂"],
  vessel: ["vessel", "container"],
  small_piston: ["A1", "A₁"],
  large_piston: ["A2", "A₂"],
  F1: ["F1", "F₁"],
  F2: ["F2", "F₂"],
  pressure: ["P", "p"],
};

export function fluidApparatusRoleLabels(role: string): readonly string[] | undefined {
  return ROLE_LABELS[role];
}

const MAX_DISPLAY = 1e6;

function mark(role: string, components: RenderPoint, displayScale: number): InstrumentMark {
  const magnitude = Math.hypot(components.x, components.y);
  // unit "1": a display length, never a physical magnitude.
  return { role, components: { ...components }, magnitude, unit: "1", displayScale, zero: magnitude === 0, pageNormal: null };
}

/** Display inputs are bare numbers; a declared physical unit would read as a measured claim. */
function displayLength(value: unknown, key: string, context: SourceContext, document?: SceneDocument): number {
  for (const declared of sourceUnits(value, document)) {
    if (!["1", "unit", "units", "dimensionless"].includes(declared.trim())) invalid(key, `${key} is a display length; it cannot carry the physical unit ${declared}`);
  }
  const number = scalar(value, key, context, MAX_DISPLAY);
  if (!(number > 0)) invalid(key, `${key} must be positive`);
  return number;
}

function rectangle(left: number, bottom: number, right: number, top: number): RenderPoint[] {
  return [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }];
}

function arrow(start: RenderPoint, end: RenderPoint, metadata: InstrumentMark): InstrumentGeometry {
  if (!(Math.hypot(end.x - start.x, end.y - start.y) > 1e-6)) invalid("precision", "a force arrow collapses at this display size");
  return { kind: "path", points: [start, end], directed: true, instrument: metadata };
}

/**
 * Outputs [fluid, surface, body, F_top, F_bottom, F_B, h1, h2]. The origin is
 * the left end of the free surface; y grows upward, so depths go down.
 */
function readSubmergedBody(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["origin", "topDepth", "bodyHeight", "bodyWidth", "forceScale"]);
  const origin = placement(inputs.origin, "origin", context);
  const h1 = displayLength(inputs.topDepth, "topDepth", context, document);
  const height = displayLength(inputs.bodyHeight, "bodyHeight", context, document);
  const width = displayLength(inputs.bodyWidth, "bodyWidth", context, document);
  const k = inputs.forceScale === undefined ? 0.45 : displayLength(inputs.forceScale, "forceScale", context, document);
  // F_B starts at the centroid and must end inside the body (k H <= H / 2), so
  // it never reads as a third force beside F_top; that also keeps the top
  // arrow's tail under the surface (k h1 < h1).
  if (!(k <= 0.5)) invalid("forceScale", "forceScale must be at most 0.5 so F_B stays inside the body");
  if (!(k >= 0.3)) invalid("forceScale", "forceScale must be at least 0.3 so every arrow stays readable");
  const h2 = h1 + height;
  // A body flatter than this crowds its three arrows and their labels.
  if (!(height >= width / 2 && height <= width * 2)) invalid("bodyHeight", "the body must be drawn between half and twice as tall as it is wide");
  if (!(h1 >= height / 2 && h1 <= height * 2)) invalid("topDepth", "the top face must sit between half and twice the body height below the surface");
  // Room for the depth markers and labels either side, even for a tall narrow body.
  const fluidWidth = Math.max(width, height) * 3.4;
  const fluidDepth = h2 + k * h2 + height * 0.35;
  const left = origin.x;
  const right = origin.x + fluidWidth;
  const surfaceY = origin.y;
  const floorY = origin.y - fluidDepth;
  const cx = origin.x + fluidWidth * 0.42;
  const bodyLeft = cx - width / 2;
  const bodyRight = cx + width / 2;
  const topY = surfaceY - h1;
  const bottomY = surfaceY - h2;
  // Face forces act over the whole face; each is drawn at one quarter of the
  // face so it never shares a line with the buoyant force at the centroid.
  const faceX = cx - width / 4;
  const topForce = { x: 0, y: -k * h1 };
  const bottomForce = { x: 0, y: k * h2 };
  const buoyant = { x: 0, y: k * height };
  const centroid = { x: cx, y: (topY + bottomY) / 2 };
  // h1 left of the body and h2 right of it, so neither label sits beside the other's marker.
  const markerGap = Math.max(width, height) * 0.45;
  const markerX1 = bodyLeft - markerGap;
  const markerX2 = bodyRight + markerGap;
  return [
    { kind: "path", points: rectangle(left, floorY, right, surfaceY), closed: true, instrument: mark("fluid", { x: fluidWidth, y: fluidDepth }, 1) },
    { kind: "path", points: [{ x: left, y: surfaceY }, { x: right, y: surfaceY }], instrument: mark("surface", { x: fluidWidth, y: 0 }, 1) },
    { kind: "path", points: rectangle(bodyLeft, bottomY, bodyRight, topY), closed: true, instrument: mark("body", { x: width, y: height }, 1) },
    arrow({ x: faceX, y: topY - topForce.y }, { x: faceX, y: topY }, mark("F_top", topForce, k)),
    arrow({ x: faceX, y: bottomY - bottomForce.y }, { x: faceX, y: bottomY }, mark("F_bottom", bottomForce, k)),
    arrow(centroid, { x: centroid.x, y: centroid.y + buoyant.y }, mark("F_B", buoyant, k)),
    { kind: "dimension", a: { x: markerX1, y: surfaceY }, b: { x: markerX1, y: topY }, instrument: mark("h1", { x: 0, y: -h1 }, 1) },
    { kind: "dimension", a: { x: markerX2, y: surfaceY }, b: { x: markerX2, y: bottomY }, instrument: mark("h2", { x: 0, y: -h2 }, 1) },
  ];
}

/**
 * Outputs [vessel, fluid, small_piston, large_piston, F1, F2, pressure]. The
 * origin is the bottom left corner of the vessel; both pistons rest at one
 * level, so the fluid under them is at one pressure.
 */
function readHydraulicPress(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["origin", "smallWidth", "largeWidth", "forceLength"]);
  const origin = placement(inputs.origin, "origin", context);
  const w1 = displayLength(inputs.smallWidth, "smallWidth", context, document);
  const w2 = displayLength(inputs.largeWidth, "largeWidth", context, document);
  const l1 = displayLength(inputs.forceLength, "forceLength", context, document);
  const ratio = w2 / w1;
  // Arrow lengths follow the drawn areas, so the ratio must stay drawable.
  if (!(ratio >= 1.25 && ratio <= 2.5)) invalid("largeWidth", "the large piston must be drawn 1.25 to 2.5 times as wide as the small one");
  const areaRatio = ratio * ratio;
  const l2 = l1 * areaRatio;
  if (!(l1 >= w1 * 0.4 && l2 <= w2 * 6)) invalid("forceLength", "forceLength must keep both arrows readable beside their pistons");
  const channel = w1 * 0.6;
  const gap = w2 * 0.9;
  const pistonLevel = w2 * 1.3;
  const thickness = w1 * 0.18;
  const wallTop = pistonLevel + thickness + l1 * 0.6;
  const x0 = origin.x;
  const x1 = x0 + w1;
  const x2 = x1 + gap;
  const x3 = x2 + w2;
  const y0 = origin.y;
  const yc = y0 + channel;
  const yp = y0 + pistonLevel;
  const smallCentre = (x0 + x1) / 2;
  const largeCentre = (x2 + x3) / 2;
  const pistonTop = yp + thickness;
  return [
    {
      kind: "multi_path",
      paths: [
        [{ x: x0, y: y0 + wallTop }, { x: x0, y: y0 }, { x: x3, y: y0 }, { x: x3, y: y0 + wallTop }],
        [{ x: x1, y: y0 + wallTop }, { x: x1, y: yc }, { x: x2, y: yc }, { x: x2, y: y0 + wallTop }],
      ],
      instrument: mark("vessel", { x: x3 - x0, y: wallTop }, 1),
    },
    {
      kind: "path",
      points: [{ x: x0, y: yp }, { x: x0, y: y0 }, { x: x3, y: y0 }, { x: x3, y: yp }, { x: x2, y: yp }, { x: x2, y: yc }, { x: x1, y: yc }, { x: x1, y: yp }],
      closed: true,
      instrument: mark("fluid", { x: x3 - x0, y: pistonLevel }, 1),
    },
    { kind: "path", points: rectangle(x0, yp, x1, pistonTop), closed: true, instrument: mark("small_piston", { x: w1, y: 0 }, 1) },
    { kind: "path", points: rectangle(x2, yp, x3, pistonTop), closed: true, instrument: mark("large_piston", { x: w2, y: 0 }, 1) },
    arrow({ x: smallCentre, y: pistonTop + l1 }, { x: smallCentre, y: pistonTop }, mark("F1", { x: 0, y: -l1 }, 1)),
    arrow({ x: largeCentre, y: pistonTop }, { x: largeCentre, y: pistonTop + l2 }, mark("F2", { x: 0, y: l2 }, areaRatio)),
    // Inside the widest body of fluid, so its label has room to stay in the fluid.
    { kind: "point", point: { x: x2 + w2 * 0.3, y: (yc + yp) / 2 }, instrument: mark("pressure", { x: 0, y: 0 }, 1) },
  ];
}

export function evaluateFluidApparatusConstruction(operator: FluidApparatusOperator, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): InstrumentGeometry[] {
  return operator === "submerged_body" ? readSubmergedBody(inputs, context, document) : readHydraulicPress(inputs, context, document);
}

/** The only stated value these figures never contradict: the gravitational field strength. */
const GRAVITY_UNIT = /^(?:m\/s\^?2|m\/s²|ms\^?-2|cm\/s\^?2|cm\/s²|n\/kg)$/i;
/**
 * References that are not stated values: "class 11", "chapter 7", "Fig 10.6",
 * "NCERT Exemplar 10.5", "2.3 Position", "session 2026-27", "(5 marks)", a
 * leading "1." question number, and the subscripts of fluid symbols (A1, F_2,
 * h1). Anything else that is a digit counts as a stated value.
 */
const NON_VALUE_NUMBERS = [
  /\b(?:class|chapter|ch|section|sec|unit|grade|std|standard|lesson|part|question|q|exercise|ex|example|page|ncert|exemplar|fig|figure)\.?\s*[-–]?\s*(?:no\.?\s*)?\d+(?:\.\d+)*(?:st|nd|rd|th)?\b/gi,
  /\b\d+(?:st|nd|rd|th)\b/gi,
  /\b(?:session|syllabus|year|exam|board|batch)\s+(?:19|20)\d\d(?:\s*[-–]\s*\d{2,4})?\b/gi,
  /\b(?:19|20)\d\d\s*[-–]\s*\d{2}\b/g,
  /(?:^|\n)\s*[1-9]\d*(?:\.\d+)+\s+(?=[A-Z][a-z])/g,
  /(?:^|\n)\s*[1-9]\d*\s*[.)]\s+(?=[A-Za-z])/g,
  /\(\s*\d+\s*marks?\s*\)/gi,
  /\b[23]D\b/g,
  /\b[AaFfHhPpDdRrVv]_?\{?[0-9]\}?(?![\d.])/g,
];
/** Spelled values a display proportion would contradict ("ten times the area", "das guna", "half the depth"). */
const VALUE_WORDS = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|twice|thrice|double|triple|half|quarter|third|fourth|fifth|tenth|hundredth|times|fold|percent|guna|gunaa|gune|aadha|adha|dugna|tigna)\b|[%½¼¾⅓⅔×]/i;

function statesValue(question: string): boolean {
  let text = question;
  for (const pattern of NON_VALUE_NUMBERS) text = text.replace(pattern, " ");
  return /\d/.test(text) || VALUE_WORDS.test(text);
}

/**
 * Situations the drawing cannot show. submerged_body draws one fully
 * submerged block with no weight, so a floating, partly immersed, resting or
 * round body is a different figure; hydraulic_press draws two pistons at one
 * level, so a level difference or a brake circuit is a different figure.
 */
const SUBMERGED_BODY_MISMATCH = /\b(?:floats?|floating|flotation|afloat|ships?|boats?|icebergs?|hydrometers?|balloons?|partly|partially|part of (?:its|the) volume|fraction of (?:its|the) volume|half(?:-|\s)(?:immersed|submerged)|rests? on|resting on|lies on|stuck|bottom of the|spheres?|spherical|balls?|cones?|sinks? to the bottom)\b/i;
const HYDRAULIC_PRESS_MISMATCH = /\b(?:brakes?|braking|different (?:levels?|heights?)|level difference|height difference|raised|lowered|above the (?:small|large|other)|below the (?:small|large|other))\b/i;

/**
 * The qualitative fluid figures draw display proportions. They may only draw
 * when the source states no value they could contradict: a depth, height,
 * area, diameter, radius, force, density, pressure, volume, mass or ratio in
 * the question, or any given or derived plan quantity except gravity. A
 * stated value belongs to a numeric figure (buoyancy, hydrostatic_profile) or
 * to text, never to a display proportion that silently replaces it.
 */
export function validateFluidApparatusSourceInputs(
  document: SceneDocument,
  question: string,
  plan: { givens?: readonly { symbol?: string; unit?: string }[]; derived?: readonly { symbol?: string; unit?: string }[] } | null,
): SceneIssue[] {
  const constructions = document.constructions.filter((construction) => (FLUID_APPARATUS_OPERATORS as readonly string[]).includes(construction.operator));
  if (constructions.length === 0) return [];
  const stated = [...(plan?.givens ?? []), ...(plan?.derived ?? [])]
    .filter((quantity) => !GRAVITY_UNIT.test(String(quantity.unit ?? "").trim().replaceAll(" ", "")));
  const mismatch = constructions.some((construction) => (construction.operator === "submerged_body" ? SUBMERGED_BODY_MISMATCH : HYDRAULIC_PRESS_MISMATCH).test(question));
  const reasons = [
    ...(statesValue(question) ? ["the question states a value"] : []),
    ...(mismatch ? ["the question describes a situation the figure cannot show"] : []),
    ...(stated.length > 0 ? [`the plan states ${stated.map((quantity) => quantity.symbol ?? "a quantity").join(", ")}`] : []),
  ];
  if (reasons.length === 0) return [];
  return constructions.map((construction) => ({
    code: `${construction.operator}_source_has_values`,
    message: `${construction.operator} draws one conceptual case with display proportions only, so it cannot draw this source (${reasons.join("; ")}). Use the numeric fluid operators or text only.`,
    severity: "fatal" as const,
    entityIds: construction.outputs,
  }));
}
