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

/**
 * The label texts each role may carry; the first is the default, and an empty
 * default leaves the mark unnamed unless the planner names it. No numbers.
 */
const ROLE_LABELS: Readonly<Record<string, readonly string[]>> = {
  fluid: ["fluid", "liquid"],
  // The fluid outline already shows the surface; an always-on name crowds the top face labels.
  surface: ["", "surface", "free surface"],
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
  const k = inputs.forceScale === undefined ? 0.4 : displayLength(inputs.forceScale, "forceScale", context, document);
  // F_B starts at the centroid and ends well inside the body (k H <= 0.4 H <
  // H / 2), so its head never meets F_top's head at the top face; that also
  // keeps the top arrow's tail under the surface (k h1 < h1).
  if (!(k <= 0.4)) invalid("forceScale", "forceScale must be at most 0.4 so F_B ends inside the body");
  if (!(k >= 0.3)) invalid("forceScale", "forceScale must be at least 0.3 so every arrow stays readable");
  const h2 = h1 + height;
  // A body flatter than this crowds its three arrows and their labels.
  if (!(height >= width / 2 && height <= width * 2)) invalid("bodyHeight", "the body must be drawn between half and twice as tall as it is wide");
  // A top face at least one body height down keeps F_top (k h1 >= 0.3 H) readable.
  if (!(h1 >= height && h1 <= height * 2)) invalid("topDepth", "the top face must sit between one and two body heights below the surface");
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
  const markerGap = Math.max(width, height) * 0.7;
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
  /\b(?:class|chapter|ch|section|sec|unit|grade|std|standard|lesson|part|question|ques|q|exercise|ex|example|page|ncert|exemplar|fig|figure)\.?\s*[-–]?\s*(?:no\.?\s*)?\d+(?:\.\d+)*(?:st|nd|rd|th)?\b/gi,
  /\b\d+(?:st|nd|rd|th)\b/gi,
  /\b(?:session|syllabus|year|exam|board|batch|cbse|icse|jee|neet|paper)\s+(?:19|20)\d\d(?:\s*[-–]\s*\d{2,4})?\b/gi,
  /\b(?:19|20)\d\d(?=\s+(?:board|paper|exam|question))/gi,
  /\b(?:19|20)\d\d\s*[-–]\s*\d{2}\b/g,
  /(?:^|\n)\s*[1-9]\d*(?:\.\d+)+\s+(?=[A-Z][a-z])/g,
  /(?:^|\n)\s*[1-9]\d*\s*[.)]\s+(?=[A-Za-z])/g,
  /\(\s*\d+\s*marks?\s*\)/gi,
  /\b[23]D\b/g,
  /\b[AaFfHhPpDdRrVvWw]_?\{?[0-9]\}?(?!\d|\.\d)/g,
];
/** Multipliers that always state a ratio: "twice", "doubled", "tenfold", "das guna", "½". */
const MULTIPLIER = /\b(?:twice|thrice|doubl\w*|tripl\w*|quadrupl\w*|halv\w*|half|quarter\w*|\w+fold|times|percent|guna|gunaa|gune|aadha|adha|dugna|tigna)\b|\bone\s+(?:metre|meter|m|cm|mm|kg|gram|newton|litre|liter)\b|[%½¼¾⅓⅔]|गुना|दुगना|आधा|[०-९]/i;
/**
 * Every English cardinal and ordinal, so no spelled number is missed
 * ("sixteen", "ninety", "lakh"). "one", "first" and "second" are left out:
 * they name a face or a piston far more often than a value ("one face",
 * "the second piston"), and "one-eighth" is still read through its fraction.
 */
const UNITS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const LARGE = ["hundred", "thousand", "lakh", "lac", "crore", "million", "billion", "dozen", "score"];
const ORDINALS = ["third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
  ...UNITS.slice(11).map((word) => `${word}th`), ...TENS.map((word) => `${word.slice(0, -1)}ieth`), ...LARGE.map((word) => `${word}th`)];
// Romanised Hindi words that are also English words ("do", "teen", "char") are left out.
const HINDI = ["paanch", "chhe", "saat", "aath", "nau", "das", "bees", "pachaas", "sau", "hazaar", "दो", "तीन", "चार", "पाँच", "दस", "बीस", "सौ", "हज़ार", "हजार"];
const NUMBER_WORD = `(?:${[...UNITS, ...TENS, ...LARGE, ...ORDINALS, ...HINDI].join("|")})`;
/**
 * Counts that are not physical values: the figure's own parts ("two forces",
 * "two pistons") and the shape of the asked answer ("in three steps").
 */
const COUNTED_PART = "(?:forces|faces|pistons|cylinders|sides|arms|limbs|vessels|tubes|surfaces|arrows|steps|points|sentences|lines|words|paragraphs|examples|ways|reasons|methods|marks|minutes)";
/**
 * Any spelled number is a stated value ("sixteen times the area", "a twelfth
 * of a metre") unless it directly counts one of the figure's own parts.
 */
// Only "two" counts the figure's parts: it draws exactly two faces, two face forces, two pistons.
const NUMBER_VALUE = new RegExp(String.raw`(?:^|[^\p{L}])(?:one[-\s])?${NUMBER_WORD}s?(?![\p{L}])`, "iu");
const TWO_PARTS = new RegExp(String.raw`(?:^|[^\p{L}])two[-\s]+${COUNTED_PART}(?![\p{L}])`, "giu");

function statesValue(question: string): boolean {
  let text = question.replace(ANSWER_FORMAT, " ");
  for (const pattern of NON_VALUE_NUMBERS) text = text.replace(pattern, " ");
  return /\d/.test(text) || MULTIPLIER.test(text) || NUMBER_VALUE.test(text.replace(TWO_PARTS, " "));
}

/**
 * Situations the drawing cannot show. submerged_body draws one fully
 * submerged block with no weight, so a floating, partly immersed, resting or
 * round body is a different figure; hydraulic_press draws two pistons at one
 * level, so a level difference or a brake circuit is a different figure. The
 * principle's own wording ("wholly or partially immersed") is not a case.
 */
const PRINCIPLE_WORDING = /\b(?:(?:wholly|fully|completely|totally)\s+or\s+(?:partially|partly)|(?:partially|partly)\s+or\s+(?:wholly|fully|completely|totally))\b/gi;
const CONTAINER = "(?:tank|vessel|container|beaker|jar|sea|lake|pond|river|ocean|pool)";
const SUBMERGED_BODY_MISMATCH = new RegExp(String.raw`\b(?:manometer|u[-\s]?tube|syringe|connected vessels|communicating|barometer|float\w*|afloat|ships?|boats?|icebergs?|logs?|hydrometers?|balloons?|partly|partially|part of (?:its|the) volume|fraction of (?:its|the) volume|half(?:-|\s)(?:immersed|submerged)|(?:rests?|resting|lies|lying|sits?|sitting|placed|kept)\s+(?:on|at)\s+the\s+(?:bottom|floor|base)|(?:at|on|to)\s+the\s+bottom\s+of\s+the\s+${CONTAINER}|stuck|\w*spher\w*|balls?|cones?|sinks?\s+to\s+the\s+bottom|(?:above|out of|outside|on top of|on)\s+(?:the\s+)?(?:water|liquid|fluid|surface)|level with|flush with|at the surface|surface ke barabar|protrud\w*|stick\w* out|bob\w*|cork|ice|up to its|just (?:submerged|immersed|below|beneath|under)|barely|touch\w*|seabed|sea bed|river ?bed|bed of|interface|immiscible|layers?|two liquids|oil and water|density (?:increases|varies|changes)|air pressure|atmospher\w*|P_?0|P_?atm|irregular\w*|tilt\w*|inclined|at an angle|horizontal\w*|tair\w*)\b|तैर`, "i");
const HYDRAULIC_PRESS_MISMATCH = /\b(?:brakes?|braking|elevations?|elevated|(?:different|unequal|varying|uneven) (?:levels?|heights?|positions?)|not (?:at|on) the same (?:level|height)|(?:level|height) difference|raised (?:above|higher|to a height)|lowered (?:below|to)|(?:higher|lower) than the (?:small|large|other)\w*|(?:above|below) the (?:small|large|other)\w*|(?:equal|same|identical)\s+(?:\w+\s+){0,2}(?:areas?|sizes?|diameters?|radii|radius|cross[-\s]?sections?|pistons?)|higher|lower|heights|vertical\w*|at a (?:greater|higher|lower) (?:height|level)|manometer|u[-\s]?tube|syringe|connected vessels|communicating|barometer)\b/i;

/**
 * Positive evidence, the first line of the guard. A figure draws only for a
 * bare conceptual ask: every word of the stem (after curriculum references are
 * removed) is in that operator's closed vocabulary, and a topic word is
 * present. Any other word declines: a number word, "times", a Hindi word, a
 * shape, a second liquid, a height, a manometer. Widening a refusal list kept
 * leaving gaps; a closed vocabulary cannot, and the cost is a lost figure,
 * never a wrong one. The refusal lists below stay as a second line.
 */
const ASK_WORDS = [
  "derive", "derivation", "state", "statement", "explain", "explanation", "explaination", "prove", "proof", "show", "describe",
  "discuss", "illustrate", "draw", "sketch", "give", "define", "definition", "understand", "teach", "learn", "help",
  "what", "why", "how", "is", "are", "does", "do", "can", "the", "a", "an", "of", "and", "also", "it", "its", "this", "that",
  "these", "easily", "simply", "simple", "easy", "briefly", "brief", "detail", "detailed", "in", "on", "with", "using", "by",
  "from", "for", "to", "me", "please", "us", "diagram", "figure", "neat", "labelled", "labeled", "meaning", "principle", "law",
  "class", "chapter", "section", "ncert", "cbse", "icse", "new", "syllabus", "physics", "science", "basis", "basics", "concept",
];
const SUBMERGED_BODY_WORDS = new Set([...ASK_WORDS,
  "archimedes", "upthrust", "buoyancy", "buoyant", "force", "forces", "acting", "acts", "act", "experienced", "experiences",
  "experience", "felt", "feels", "feel", "body", "block", "object", "cube", "solid", "fully", "completely", "wholly", "totally",
  "submerged", "immersed", "held", "under", "underwater", "water", "liquid", "fluid", "top", "bottom", "face", "faces", "upper",
  "lower", "greater", "larger", "more", "bigger", "than", "exceeds", "exceed", "equals", "equal", "difference", "differ", "net",
  "pressure", "depth", "deeper", "at", "compare", "comparison", "two",
  "f", "f1", "f2", "w", "w1", "w2", "u", "v", "rho", "g", "h", "h1", "h2",
]);
const HYDRAULIC_PRESS_WORDS = new Set([...ASK_WORDS,
  "hydraulic", "press", "lift", "jack", "elevator", "pascal", "pascals", "transmission", "transmitted", "transmits", "pressure",
  "piston", "pistons", "small", "smaller", "large", "larger", "big", "bigger", "first", "second", "force", "forces", "area",
  "areas", "multiplied", "multiplication", "multiply", "multiplies", "output", "input", "effort", "load", "fluid", "liquid",
  "oil", "incompressible", "enclosed", "equally", "all", "directions", "every", "direction", "works", "work", "working",
  "car", "raised", "raise", "raises", "lifts", "lifting", "heavy", "two", "cylinder", "cylinders", "different", "consists",
  "connected", "feel", "feels", "acting", "acts", "f", "f1", "f2", "a", "a1", "a2", "p",
]);
const SUBMERGED_TOPIC = /^(?:archimedes|upthrust|buoyancy|buoyant|submerged|immersed|underwater)$/;
const HYDRAULIC_PRESS_TOPIC = /^(?:hydraulic|pascal|pascals|piston|pistons)$/;
/** A concrete body must be named as wholly under the liquid; the principle's generic "body" need not be. */
const CONCRETE_BODY = /^(?:block|cube|object|solid)$/;
const SUBMERSION = /^(?:submerged|immersed|underwater)$/;
/** "in three steps": the shape of the asked answer, removed before the words are read. */
const ANSWER_FORMAT = /\bin\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:steps|points|sentences|lines|words|paragraphs)\b/gi;

function stemWords(question: string): string[] {
  let text = question.replace(PRINCIPLE_WORDING, " wholly ").replace(ANSWER_FORMAT, " ");
  for (const pattern of NON_VALUE_NUMBERS.slice(0, -1)) text = text.replace(pattern, " ");
  return text.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Null when the stem is a bare conceptual ask this operator can draw; otherwise why it is not. */
export function fluidApparatusAskMismatch(operator: FluidApparatusOperator, question: string): string | null {
  const words = stemWords(question);
  const vocabulary = operator === "submerged_body" ? SUBMERGED_BODY_WORDS : HYDRAULIC_PRESS_WORDS;
  const outside = [...new Set(words.filter((word) => !vocabulary.has(word)))];
  if (outside.length > 0) return `the question says more than a bare conceptual ask (${outside.slice(0, 6).join(", ")})`;
  // "Why is the force on the bottom face greater than on the top?" asks for this figure without naming the law.
  const facePair = operator === "submerged_body" && words.includes("top") && words.includes("bottom") &&
    words.some((word) => /^(?:force|forces|face|faces|pressure)$/.test(word));
  if (!facePair && !words.some((word) => (operator === "submerged_body" ? SUBMERGED_TOPIC : HYDRAULIC_PRESS_TOPIC).test(word))) return "the question does not name the law this figure draws";
  if (operator === "submerged_body" && words.some((word) => CONCRETE_BODY.test(word)) && !words.some((word) => SUBMERSION.test(word))) return "the question names a body without saying it is wholly under the liquid";
  return null;
}

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
  const situation = question.replace(PRINCIPLE_WORDING, " ");
  const mismatch = constructions.some((construction) => (construction.operator === "submerged_body" ? SUBMERGED_BODY_MISMATCH : HYDRAULIC_PRESS_MISMATCH).test(situation));
  const askMismatches = constructions.map((construction) => fluidApparatusAskMismatch(construction.operator as FluidApparatusOperator, question)).filter((reason): reason is string => reason !== null);
  const reasons = [
    ...askMismatches,
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
