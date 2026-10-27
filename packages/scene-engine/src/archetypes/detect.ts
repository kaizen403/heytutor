/**
 * Archetype detection — which parameterized figure a question calls for, and
 * with what slot values.
 *
 * This is a *scored* decision over one catalog, not a first-match ladder:
 * every archetype's cues are weighed, structure from the turn plan and the
 * problem IR adds evidence, vetoes remove figures the stem rules out, and the
 * winner must clear a margin. Slots are filled from plan givens first and
 * stem numbers second, and every slot remembers its source.
 *
 * The English cues are still lexical. What makes this honest is that (a) the
 * generators compute geometry from the slots instead of stamping a fixture,
 * (b) a stem the detector cannot place returns null (the caller falls back
 * or teaches text-only), and (c) the cue tables are exercised as a test
 * oracle by the archetype picture gate rather than grown per question.
 */
import { readRadiationSource, requestedPhotoelectricResult } from "../physics/radiationSource";
import { riverCrossingSpeeds } from "../physics/riverCrossingSource";
import { projectileStatedConditions } from "../physics/projectileLaunchSource";
import { riverBoatVariant } from "../synthesize/familyClassification";
import { levelRelationSource } from "../physics/levelRelationSource";
import { extractFreeFallSlots, extractSuvatSlots } from "./generators/constantAcceleration";
import { ARCHETYPES, isArchetypeId, type ArchetypeId, type Slots } from "./catalog";
import { formatResistorTree, readResistorTree } from "./resistorTree";
import {
  UNIT,
  STEM_NUMBER,
  planGivenNumber,
  parseStemNumber,
  lengthAfterInMetres,
  readEnergyAfterInEv,
  wavelengthAfterInNm,
  lengthAfterInCm,
  lengthBeforeInCm,
  symbolLengthInCm,
  allAngles,
  collectPlanQuantities,
  coordinateTuples,
  emptyBag,
  explicitFunctions,
  firstAngle,
  firstNumberWithUnit,
  frictionCoefficient,
  numberAfter,
  numberBefore,
  numbersWithUnit,
  planNumber,
  pointOfInterestX,
  positionOfTime,
  prepareStem,
  refractiveIndex,
  setSlot,
  xInterval,
  type PlanQuantity,
  type SlotBag,
  type SlotSource,
} from "./slots";

/** Bridge quantities require an adjacent length unit and an explicit role.
 * Stop at prose instead of borrowing a wire length or a cell voltage. */
function bridgeLengthValueInCm(match: RegExpMatchArray): number | null {
  const value = parseStemNumber(match[1]!);
  return value === null ? null : value * (match[2]!.toLowerCase() === "mm" ? 0.1 : match[2]!.toLowerCase() === "cm" ? 1 : 100);
}
function bridgeLengthInCm(stem: string, role: RegExp): number | null {
  const pattern = new RegExp(`(?:${role.source})\\s*(?:(?:is|of|at|equals|found|obtained)\\s*)*(?:[=:]\\s*)?${STEM_NUMBER}\\s*(cm|mm|metres?|meters?|m)\\b(?!\\s*[/²³^])`, "gi");
  const values = [...stem.matchAll(pattern)].map(bridgeLengthValueInCm).filter((value): value is number => value !== null);
  return values.length && values.every(value => Math.abs(value - values[0]!) < 1e-8) ? values[0]! : null;
}
function bridgeWireLengthInCm(stem: string): number | null {
  const after = bridgeLengthInCm(stem, /\bwire\s+(?:of\s+)?length|\blength\s+of\s+(?:the\s+)?wire|\bwire(?=\s+is\b)/);
  const pattern = new RegExp(`${STEM_NUMBER}\\s*(cm|mm|metres?|meters?|m)\\s+wire\\b`, "gi");
  const before = [...stem.matchAll(pattern)].map(bridgeLengthValueInCm).filter((value): value is number => value !== null);
  const values = [...(after === null ? [] : [after]), ...before];
  return values.length && values.every(value => Math.abs(value - values[0]!) < 1e-8) ? values[0]! : null;
}

/**
 * Where the object sits, in every phrasing a ray-optics stem uses for it.
 *
 * Shared by the mirror and the lens because they are the same sentence with a
 * different noun. Missing a phrasing here is not a missing number: the
 * generator falls back to a stock distance and draws a *different optical
 * case* than the one asked about, which the tier only marks as qualitative.
 * "object at 20 cm" and "placed 15 cm away" both used to land there.
 */
const OBJECT_PLACEMENT = /object distance(?: of| is| =)?|(?:the )?object(?: is)?(?:\s+(?:placed|kept|located|positioned))?\s+at|placed at(?: a distance of)?|distance of/;
const AWAY_FROM = /(?:from|in front of|away(?:\s+from)?|before)/;
const FOCAL_LENGTH = /focal length(?: of| is| =)?/;
const RADIUS_OF_CURVATURE = /radius of curvature(?: of| is| =)?/;

function objectDistanceFromStem(stem: string): number | null {
  return lengthBeforeInCm(stem, AWAY_FROM)
    ?? lengthAfterInCm(stem, OBJECT_PLACEMENT)
    ?? symbolLengthInCm(stem, /u/)
    // A stem that gives the distance with no unit at all means centimetres.
    ?? numberAfter(stem, OBJECT_PLACEMENT, UNIT.centimetre);
}

/**
 * Facts only a lens or mirror stem gives: a focal length, the radius or centre
 * of curvature, the pole, the principal axis, a magnification, a ray diagram,
 * an object between F and C, an object distance ("the object is at 30 cm") or
 * u, v or f set to a number. "Real" is not one ("let a, b be real numbers").
 */
const OPTICS_FACT = /\b(?:focal(?![\s-]*chords?\b)|radius of curvature|pole|principal axis|magnif\w*|cent(?:re|er) of curvature|ray diagram|between F and C|(?:in front of|before|behind) (?:an?|the) mirror)\b|\b[uvf]\s*=\s*[-+−]?\s*\d+(?:\.\d+)?(?:\s*(?:cm|mm|m)\b|(?![\d.]*(?:[a-z]|\s*(?:[a-z](?![a-z])|[(^]))))|\b(?:objects?|sources?)\b[^.?!\d]{0,40}?\d+(?:\.\d+)?\s*(?:cm|mm|m)\b|\b(?:objects?|sources?)\b[^.?!]{0,40}?\b(?:at|beyond|between|near|inside|within)\s+(?:the\s+)?(?:2F|F|C|P|focus|pole|infinity)\b|\bobjects?\s+(?:2F|F|C)\s+(?:par|pe)\b/i;

/** A line equation: `4x + 7y + 13 = 0`, `x+y=1`, `y = x`. */
const LINE_EQUATION = String.raw`[-+−(\d\s.]*[xy]\b[\s\dxy+\-−*/().]*=\s*[-+−]?\s*[\dxy(]`;

/** "the line y = x acts as a", before "mirror". */
const LINE_ACTS_AS = String.raw`\bline\s*:?\s*(?:${LINE_EQUATION})[^.?!]{0,30}?\bacts?\s+as\s+(?:an?\s+)?`;

/**
 * A line given as the mirror ("the line mirror 4x + 7y + 13 = 0", "the mirror
 * line y = x", "the line y = x acts as a mirror"): the reflection line of
 * coordinate geometry, never an optical element.
 */
const LINE_AS_MIRROR = new RegExp(String.raw`\b(?:line[\s-]+mirror|mirror[\s-]+line)s?\b\s*:?\s*(?:${LINE_EQUATION})|${LINE_ACTS_AS}mirror\b`, "i");

/** A concave, convex, spherical, parabolic, curved or plane mirror. */
const QUALIFIED_MIRROR = /\b(?:concave|convex|spherical|parabolic|curved|plane)[\s-]+mirrors?\b/i;

/**
 * A bare mirror that may be an element: not a "mirror image" (or the typed
 * "mirror imag"), not a "line mirror" or a "mirror line", and not a line that
 * acts as a mirror.
 */
const BARE_MIRROR = new RegExp(String.raw`\bmirrors?\b(?<!(?:\bline[\s-]+|${LINE_ACTS_AS})mirrors?)(?![\s-]*(?:imag(?:es?)?|lines?)\b)`, "i");

/**
 * A stem names an optical element when it names a lens or a qualified mirror
 * (even in "concave mirror image formation"), or a bare mirror and an optics
 * fact ("a mirror of focal length 15 cm", "an object 20 cm in front of a
 * mirror"). A lookahead body, read from the start of the stem.
 */
const NAMES_OPTICAL_ELEMENT = String.raw`[\s\S]*(?:\blens(?:es)?\b|${QUALIFIED_MIRROR.source})|(?=[\s\S]*(?:${BARE_MIRROR.source}))[\s\S]*(?:${OPTICS_FACT.source})`;

/** A stem that gives an optics fact. A lookahead body, read from the start of the stem. */
const GIVES_OPTICS_FACT = String.raw`[\s\S]*(?:${OPTICS_FACT.source})`;

/**
 * `pattern`, in a stem where no `absent` lookahead body holds. A stem that
 * names a lens or a mirror element is optics whatever else it says ("a convex
 * lens forms the image of a point P in a plane perpendicular to its axis").
 */
function inStemWithout(pattern: RegExp, ...absent: readonly string[]): RegExp {
  return new RegExp(`^${absent.map((body) => `(?!${body})`).join("")}[\\s\\S]*?(?:${pattern.source})`, "i");
}

/**
 * Positive evidence of reflection geometry: a coordinate point ("(2, 3)", "A(-1, 8, 2)"), the plane or line
 * the reflection is taken in ("in the plane", "in a line", "with respect to the plane"), the x, y or z axis,
 * a vector, or a line equation.
 */
const REFLECTION_GEOMETRY = new RegExp(String.raw`\(\s*[-+−]?\d+(?:\.\d+)?\s*,|\b(?:in|about|across|with\s+respect\s+to|w\.?r\.?t\.?)\s+(?:(?:the|a|given)\s+)*(?:plane|line)s?\b|\b[xyz][\s-]*axis\b|\b(?:about|through|in|across)\s+the\s+origin\b|\bvectors?\b|${LINE_EQUATION}`, "i");

/**
 * A "mirror image" is coordinate geometry or symmetry ("B is the mirror image of A in a plane") only when the
 * stem shows reflection geometry, names no optical element and gives no optics fact. Otherwise the stem is read
 * exactly as before: "the mirror image of an object placed beyond C" stays a mirror stem, and so does "an object
 * on the x-axis at u = -30 cm, f = -20 cm", and so does any other wording.
 */
const MIRROR_IMAGE_IN_GEOMETRY = new RegExp(
  `^(?=[\\s\\S]*(?:${REFLECTION_GEOMETRY.source}))${inStemWithout(/\bmirror[\s-]*imag(?:es?)?\b/i, NAMES_OPTICAL_ELEMENT, GIVES_OPTICS_FACT).source.slice(1)}`, "i");

/**
 * The image or reflection of a point (named, or given by coordinates, which
 * may be decimals) in a plane or a line, the line mirror included, in a stem
 * that names no optical element: the reflection of coordinate geometry. A
 * point object or source is optics, and so is the image in a plane mirror.
 */
const COORDINATE_POINT_REFLECTION = inStemWithout(
  /\b(?:imag(?:es?)?|reflections?)\s+of\s+(?:(?:the|a)\s+)?(?:points?\b(?!\s+(?:object|source)s?\b)|[A-Z]\s*\(\s*[-+]?\d|\(\s*[-+]?\d)(?:[^.?!]|\.(?=\d))*?\b(?:in|about|across|with respect to)\s+(?:(?:the|a|given)\s+)*(?:plane|line)\b/i,
  NAMES_OPTICAL_ELEMENT,
);

/** A line given as the mirror, in a stem that names no optical element. */
const LINE_GIVEN_AS_MIRROR = inStemWithout(LINE_AS_MIRROR, NAMES_OPTICAL_ELEMENT);

/** Focal length, named or written as `f = 15 cm`. */
function focalLengthFromStem(stem: string): number | null {
  return lengthAfterInCm(stem, FOCAL_LENGTH)
    ?? symbolLengthInCm(stem, /f/)
    ?? numberAfter(stem, FOCAL_LENGTH, UNIT.centimetre);
}

/** Radius of curvature, named or written as `R = 30 cm`. */
function radiusOfCurvatureFromStem(stem: string): number | null {
  return lengthAfterInCm(stem, RADIUS_OF_CURVATURE)
    ?? symbolLengthInCm(stem, /R/)
    ?? numberAfter(stem, RADIUS_OF_CURVATURE, UNIT.centimetre);
}

export interface DetectionHints {
  turnPlan?: unknown;
  problemIR?: {
    entities?: ReadonlyArray<{ kind?: string; label?: string }>;
    representationIntents?: ReadonlyArray<{ kind?: string }>;
    constraints?: ReadonlyArray<{ kind?: string; entityIds?: readonly string[] }>;
    facts?: ReadonlyArray<{ kind?: string; statement?: string }>;
  } | null;
  /** An archetype the planner named explicitly; wins when its required slots resolve. */
  plannerArchetype?: string | null;
  /**
   * Keep main's choice even for a law only lead. Only the planner request
   * gate uses this, so the prompt and the decision to call the planner stay
   * exactly as on main; the figure itself still declines downstream.
   */
  keepLawOnlyLead?: boolean;
}

export interface ArchetypeMatch {
  id: ArchetypeId;
  slots: Slots;
  sources: Record<string, SlotSource>;
  score: number;
  runnerUp: { id: ArchetypeId; score: number } | null;
  evidence: string[];
}

type Cue = readonly [RegExp, number, string?];

interface CueSet {
  id: ArchetypeId;
  cues: readonly Cue[];
  vetoes?: readonly RegExp[];
  /** Every one of these must match for the figure to be eligible at all. */
  requires?: readonly RegExp[];
  /** Minimum score to be eligible. Default 2. */
  minScore?: number;
  /** Fill slots from the plan and stem. */
  extract?: (stem: string, plan: readonly PlanQuantity[], bag: SlotBag) => void;
}

const DEG = UNIT.degree;

const massesOf = (stem: string): number[] => numbersWithUnit(stem, UNIT.kilogram);
const speedsOf = (stem: string): number[] => numbersWithUnit(stem, UNIT.speed);

// Ω is not a word character, so a trailing \b never matched "6 Ω resistor":
// every Ω value was dropped and the network fell back to stock resistors.
// Case-insensitive matching folds Ω onto ω; an angular frequency is never an ohm.
function ohms(stem: string): number[] {
  return [...stem.matchAll(new RegExp(`${STEM_NUMBER}\\s*(kΩ|MΩ|k\\s*ohms?|M\\s*ohms?|Ω|ohms?)(?![A-Za-z0-9]|\\s*[·*]?\\s*(?:m|metres?|meters?)\\b)`, "gi"))].filter((match) => !(match[2] ?? "").includes("ω")).map((match) => {
    const value = parseStemNumber(match[1]!) ?? Number.NaN;
    const prefix = (match[2] ?? "")[0];
    return prefix === "k" || prefix === "K" ? value * 1000 : prefix === "M" ? value * 1e6 : prefix === "m" ? value / 1000 : value;
  }).filter(Number.isFinite);
}

/**
 * Words that group resistors before arranging them ("this combination", "end
 * to end", "which is in parallel with"). A stem with one of them, or with both
 * arrangement words, is read only by the structural reader; the one-word fast
 * path below is for stems with no grouping at all.
 */
const GROUPING_CUE = /\b(?:combination|arrangement|group|pair|end[- ]to[- ]end|joined|together|this|which|that|these|it)\b/i;

function needsStructuralReader(stem: string): boolean {
  const bothKinds = /\bseries\b/i.test(stem) && /\bparallel\b/i.test(stem);
  // "In this circuit", "in this case": deictic words that point at the
  // question, not at a group of resistors, are not grouping cues.
  const cues = stem.replace(/\b(?:this|these|that)\s+(?:circuits?|cases?|questions?|problems?|figures?|diagrams?|situations?|experiments?|setups?)\b/gi, " ");
  return bothKinds || (ohms(stem).length >= 2 && GROUPING_CUE.test(cues));
}

/**
 * The resistor arrangement only where the stem fixes it. A stem with no
 * grouping word and one arrangement word is read directly; every other stem
 * with several resistances goes through the bounded structural reader, which
 * returns an explicit tree or nothing. Anything it cannot bind, or two
 * resistors with no arrangement word, is ambiguous and draws nothing.
 */
function resistorTopology(stem: string, bag: SlotBag): string {
  const series = /\bseries\b/i.test(stem);
  const parallel = /\bparallel\b/i.test(stem);
  // "in series and then in parallel" asks for two figures.
  const twoFigures = /\bin series and (?:then )?(?:in )?parallel\b(?!\s+with)|\bin parallel and (?:then )?(?:in )?series\b(?!\s+with)|\b(?:both|each|two) (?:equivalent resistances|circuits?|combinations?|cases|arrangements)\b|\bseparately\b/i.test(stem);
  // A stem that states no resistances asks for the idea, not one network:
  // "series and parallel combinations" are drawn as two separate views and a
  // "mixed series-parallel network" as one generic mix, unlabelled, valueless.
  if (series && parallel && ohms(stem).length === 0) {
    if (/\bmixed\b|\bseries[- ]parallel\b|\bcombined\b/i.test(stem)) {
      setSlot(bag, "tree", "S(0,P(1,2))", "default");
      return "tree";
    }
    return "both";
  }
  if (needsStructuralReader(stem)) {
    const tree = readResistorTree(stem);
    if (tree?.kind === "series" || tree?.kind === "parallel") {
      // One level of one kind is the plain series or parallel figure.
      if (tree.children.every((child) => child.kind === "leaf")) return tree.kind;
      setSlot(bag, "tree", formatResistorTree(tree), "stem");
      return "tree";
    }
    return twoFigures && series && parallel ? "both" : "ambiguous";
  }
  if (parallel) return "parallel";
  const count = typeof bag.values.resistorCount === "number" ? bag.values.resistorCount : ohms(stem).length;
  if (series || count <= 1) return "series";
  return "ambiguous";
}

/**
 * Remove "the X Ω resistor" after "across", "through", "in" or "of" when X was
 * already stated earlier: it refers back to that resistor. A value used by
 * two earlier resistors still reads as a back reference; the authority then
 * cannot tell which one is meant and binds nothing.
 */
function withoutResistorBackReferences(stem: string): string {
  const pattern = /\b(?:across|through|in|of|by)\s+the\s+(\d+(?:\.\d+)?)\s*(kΩ|MΩ|k\s*ohms?|M\s*ohms?|Ω|ohms?)(?![A-Za-z0-9])\s+resistor\b/gi;
  return stem.replace(pattern, (match, raw: string, unit: string, offset: number) => {
    const earlier = ohms(stem.slice(0, offset));
    const value = ohms(`${raw} ${unit}`)[0];
    return value !== undefined && earlier.includes(value) ? match.replace(/\d+(?:\.\d+)?\s*(?:kΩ|MΩ|k\s*ohms?|M\s*ohms?|Ω|ohms?)/i, "stated") : match;
  });
}

const COUNT_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

/** "three resistors", "two identical resistors": the count the stem states, if any. */
function statedResistorCount(stem: string): number | null {
  const match = /\b(one|a|an|single|two|three|four|five|six|[1-6])\s+(?:(?:identical|equal|similar|ohmic)\s+)?resistors?\b/i.exec(stem);
  return match ? COUNT_WORDS[match[1]!.toLowerCase()] ?? null : null;
}

/**
 * Resistances the stem itself states. "each of 6 Ω" with a stated count
 * repeats the one value; a stated count that disagrees with the listed values
 * is unreadable, so nothing is returned and the figure declines.
 */
function stemResistances(stem: string): number[] | null {
  const values = ohms(stem);
  const stated = statedResistorCount(stem);
  if (stated === null || stated === values.length) return values;
  if (values.length === 1 && stated > 1 && /\beach\b|\bidentical\b|\bequal\b/i.test(stem)) return Array.from({ length: stated }, () => values[0]!);
  return values.length === 0 ? Array.from({ length: stated }, () => Number.NaN) : null;
}

function farads(stem: string): number[] {
  return [...stem.matchAll(/(\d+(?:\.\d+)?)\s*(μF|uF|microfarad|pF|nF|mF|F)\b/gi)].map((match) => {
    const value = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    const scale = unit.startsWith("p") ? 1e-6 : unit.startsWith("n") ? 1e-3 : unit === "f" ? 1e6 : unit.startsWith("m") && unit !== "microfarad" ? 1e3 : 1;
    return value * scale;
  }).filter(Number.isFinite);
}

function volts(stem: string): number[] {
  return numbersWithUnit(stem, UNIT.volt);
}

/* ------------------------------------------------------------------------- */
/* Cue sets                                                                   */
/* ------------------------------------------------------------------------- */

const CUE_SETS: readonly CueSet[] = [
  {
    id: "projectile",
    cues: [
      [/\bprojectile\b/i, 3, "projectile"],
      [/\b(?:thrown|projected|launched|fired|kicked|hit|struck|shot)\b[^.]{0,60}\b(?:angle|degrees?|°|horizontal|elevation)\b/i, 3, "launch at angle"],
      [/\b(?:thrown|projected|launched|fired)\s+horizontally\b/i, 3, "horizontal launch"],
      [/\b(?:range|maximum height|time of flight|trajectory|highest point)\b/i, 2, "projectile quantity"],
      [/\b(?:angle of projection|projection angle|initial velocity|velocity of projection)\b/i, 2],
      [/\b(?:ground|tower|cliff|building)\b/i, 1],
    ],
    vetoes: [
      /\bincline|inclined plane|pulley|spring|pendulum|circuit|lens|mirror|charge\b/i,
      /\bvertically\s+(?:up|down)/i,
      // Straight-line speeding up or braking is not a launch.
      /\b(?:accelerat(?:es|ing)|decelerat\w*|retard(?:s|ing|ation)|brak(?:es|ing))\b/i,
    ],
    extract: (stem, plan, bag) => {
      setSlot(bag, "u", planNumber(plan, ["u", "v0", "u0", "speed", "initialspeed", "initialvelocity", "velocity", "v"]), "plan");
      setSlot(bag, "u", speedsOf(stem)[0] ?? null, "stem");
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle", "alpha", "angleofprojection"]), "plan");
      setSlot(bag, "theta", /horizontally/i.test(stem) ? 0 : firstAngle(stem), "stem");
      // One reader for the launch height and g, shared with the generator.
      // Only a plan given is a launch height: a derived "H" is the apex.
      const stated = projectileStatedConditions(stem);
      setSlot(bag, "h0", planGivenNumber(plan, ["h0", "h", "height", "towerheight", "launchheight"]), "plan");
      setSlot(bag, "h0", stated.height.status === "read" ? stated.height.value : null, "stem");
      setSlot(bag, "g", planGivenNumber(plan, ["g", "gravity"]), "plan");
      setSlot(bag, "g", stated.g.status === "read" ? stated.g.value : null, "stem");
    },
  },
  {
    id: "free_fall",
    cues: [
      [/\b(?:dropped|released|falls freely|free fall|freely falling|let fall)\b/i, 3, "drop"],
      [/\bthrown vertically\b/i, 3, "vertical throw"],
      [/\b(?:top of a|from a height|height of|tower|cliff|building|reach(?:es)? the ground|hits the ground)\b/i, 2],
      [/\b(?:balloon|helicopter)\b/i, 1],
    ],
    // "Released" alone does not mean a body falling under gravity: charges,
    // plasmas, oscillators and dimension questions are other physics.
    vetoes: [/\bincline|pulley|spring|projectile|angle\b/i, /\bhorizontally\b/i, /\b(?:plasma|electrons?|protons?|ions?|charged?|electric field|magnetic field|permittivity|oscillat\w*|dimensional analysis|dimensionally)\b/i,
      // A body turning about a pivot falls as a rotation, not a free fall.
      /\b(?:pivot\w*|hinged?|about (?:one|its|an?) end|rotat\w*|swing\w*|pendulum)\b/i],
    extract: (stem, plan, bag) => extractFreeFallSlots(stem, plan, bag, setSlot),
  },
  {
    id: "incline_body",
    cues: [
      [/\b(?:inclined plane|incline|inclination|slope)\b/i, 3, "incline"],
      [/\bramp\b/i, 2],
      [/\b(?:coefficient of friction|rough|frictionless|smooth)\b/i, 1],
      [/\b(?:block|body|box|mass|particle|cylinder|sphere|disc|disk)\b/i, 1],
    ],
    vetoes: [/\b(?:pulley|hanging|connected by a (?:light )?string)\b/i, /\bbanked\b/i, /\bprojectile\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle", "inclination", "alpha"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
      setSlot(bag, "mu", planNumber(plan, ["mu", "coefficientoffriction", "muk", "mus"]), "plan");
      setSlot(bag, "mu", frictionCoefficient(stem), "stem");
      setSlot(bag, "mass", planNumber(plan, ["m", "mass"]), "plan");
      setSlot(bag, "mass", massesOf(stem)[0] ?? null, "stem");
      setSlot(bag, "applied", planNumber(plan, ["f", "force", "appliedforce", "p"]), "plan");
      setSlot(bag, "applied", /\b(?:force|pushed|pulled|applied)\b/i.test(stem) ? firstNumberWithUnit(stem, UNIT.newton) : null, "stem");
      setSlot(bag, "rolling", /\b(?:rolls?|rolling|cylinder|sphere|disc|disk|ring)\b/i.test(stem) ? "yes" : "no", "stem");
    },
  },
  {
    id: "atwood",
    cues: [
      [/\batwood\b/i, 3],
      [/\bpulley\b/i, 3, "pulley"],
      [/\b(?:two (?:masses|blocks|bodies)|masses? .{0,20}and .{0,20}kg)\b/i, 2],
      [/\b(?:connected|joined|attached)\b[^.]{0,40}\bstring\b/i, 2],
      [/\b(?:hang|hanging|suspended)\b/i, 1],
    ],
    vetoes: [/\b(?:incline|inclined|table|horizontal (?:surface|table))\b/i],
    extract: (stem, plan, bag) => {
      const masses = massesOf(stem);
      setSlot(bag, "m1", planNumber(plan, ["m1", "ma", "mass1"]), "plan");
      setSlot(bag, "m2", planNumber(plan, ["m2", "mb", "mass2"]), "plan");
      setSlot(bag, "m1", masses[0] ?? null, "stem");
      setSlot(bag, "m2", masses[1] ?? null, "stem");
    },
  },
  {
    id: "pulley_incline",
    cues: [
      [/\bpulley\b/i, 3],
      [/\b(?:incline|inclined plane|inclination)\b/i, 3],
      [/\b(?:hanging|hangs|suspended)\b/i, 1],
      [/\bstring\b/i, 1],
    ],
    minScore: 6,
    extract: (stem, plan, bag) => {
      const masses = massesOf(stem);
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle", "inclination"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
      setSlot(bag, "m1", masses[0] ?? null, "stem");
      setSlot(bag, "m2", masses[1] ?? null, "stem");
      setSlot(bag, "mu", frictionCoefficient(stem), "stem");
    },
  },
  {
    id: "blocks_contact",
    cues: [
      [/\b(?:in contact|contact force|pushes|pushed|pulls|pulled)\b/i, 2],
      [/\b(?:two|three) blocks\b/i, 3],
      [/\b(?:constant|horizontal|applied) force\b|\bforce of \d|\b\d+(?:\.\d+)?\s*N force\b/i, 2],
      [/\b(?:box|block|crate|trolley|cart)\b/i, 1],
      [/\bblocks?\b[^.]{0,30}\b(?:connected|joined|tied)\b[^.]{0,30}\bstring\b/i, 2],
      [/\b(?:horizontal (?:surface|table|floor|track)|frictionless (?:surface|floor|table|track))\b/i, 2],
      [/\bforce of \d/i, 1],
    ],
    vetoes: [/\b(?:incline|pulley|hang|spring|lift|elevator)\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "masses", massesOf(stem), "stem");
      setSlot(bag, "force", planNumber(plan, ["f", "force", "appliedforce"]), "plan");
      setSlot(bag, "force", firstNumberWithUnit(stem, UNIT.newton), "stem");
      setSlot(bag, "mu", frictionCoefficient(stem), "stem");
      setSlot(bag, "connection", /\bstring\b/i.test(stem) ? "string" : "contact", "stem");
    },
  },
  {
    id: "lift_body",
    cues: [
      [/\b(?:lift|elevator)\b/i, 3],
      [/\b(?:apparent weight|weighing machine|normal reaction|floor)\b/i, 1],
      [/\baccelerat/i, 1],
    ],
    extract: (stem, plan, bag) => {
      setSlot(bag, "a", planNumber(plan, ["a", "acceleration"]), "plan");
      setSlot(bag, "a", firstNumberWithUnit(stem, UNIT.accel), "stem");
      setSlot(bag, "mass", massesOf(stem)[0] ?? null, "stem");
      setSlot(bag, "direction", /\b(?:down(?:ward)?s?|descend)/i.test(stem) ? "down" : "up", "stem");
    },
  },
  {
    id: "spring_mass",
    cues: [
      [/\bspring\b/i, 3],
      [/\bsimple harmonic motion\b|\bSHM\b/i, 3, "SHM"],
      [/\b(?:force constant|spring constant|stiffness|N\/m)\b/i, 2],
      [/\b(?:amplitude|oscillat|extension|compress|stretched)\b/i, 1],
    ],
    vetoes: [/\bpendulum\b/i, /\b(?:displacement|position)[- ]time\b|\bgraph\b|\bphase\b|\benerg(?:y|ies)\b|\bsuperposition\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "k", planNumber(plan, ["k", "springconstant", "forceconstant"]), "plan");
      setSlot(bag, "k", firstNumberWithUnit(stem, UNIT.springConstant), "stem");
      setSlot(bag, "mass", massesOf(stem)[0] ?? null, "stem");
      setSlot(bag, "amplitude", planNumber(plan, ["a", "amplitude"]), "plan");
      setSlot(bag, "amplitude", numberAfter(stem, /amplitude(?: of)?/, UNIT.metre), "stem");
      setSlot(bag, "orientation", /\b(?:vertical|hangs|suspended|ceiling)\b/i.test(stem) ? "vertical" : "horizontal", "stem");
    },
  },
  {
    id: "simple_pendulum",
    cues: [
      [/\bsimple pendulum\b/i, 3],
      [/\bpendulum\b/i, 2],
      [/\bbob\b/i, 2],
      [/\b(?:string|thread)\b[^.]{0,30}\b(?:length|long)\b/i, 1],
    ],
    vetoes: [/\bconical\b/i, /\bphysical pendulum|compound pendulum|hinged|rod\b/i, /\bwhirled|vertical circle\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "length", planNumber(plan, ["l", "length"]), "plan");
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
    },
  },
  {
    id: "conical_pendulum",
    cues: [[/\bconical pendulum\b/i, 4], [/\bhorizontal circle\b[^.]{0,40}\bstring\b/i, 3]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
    },
  },
  {
    id: "vertical_circle",
    cues: [
      [/\bvertical circle\b/i, 4],
      [/\bvertical circular (?:loop|track)\b/i, 4, "vertical loop"],
      [/\bloop[- ]the[- ]loop\b/i, 3, "loop-the-loop"],
      [/\bwhirled\b/i, 3],
      [/\b(?:circular loop|lowest point|highest point|top of the circle)\b/i, 2],
    ],
    // A current loop is electromagnetism, not mechanics: Biot-Savart reached
    // this figure through the bare "circular loop" cue and the lesson then
    // narrated velocity arrows as current arrows. A wire loop without a stated
    // current is still a wire apparatus, never a whirled string or an
    // energy track; the apparatus-neutral family document stays available.
    vetoes: [/\bcurrent\b/i, /\bmagnetic\b/i, /\bbiot\b/i, /\bcoil\b/i, /\bsolenoid\b/i, /\bcyclotron\b/i, /\bwire\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "radius", planNumber(plan, ["r", "radius", "l", "length"]), "plan");
      setSlot(bag, "radius", numberAfter(stem, /radius(?: of)?|loop of radius|track of radius/i, UNIT.metre), "stem");
      setSlot(bag, "radius", firstNumberWithUnit(stem, UNIT.metre), "stem");
      // A track loop is held by a normal reaction, a string loop by a tension.
      // The words that name the apparatus decide; a bare "vertical circle"
      // keeps the string figure it always drew.
      const namesTrack = /\btrack\b|\brail\b|\bloop\b/i.test(stem);
      const namesString = /\bstring\b|\bthread\b|\bwhirled\b/i.test(stem);
      setSlot(bag, "variant", namesTrack && !namesString ? "track" : "string", "stem");
      setSlot(bag, "releaseHeight", planNumber(plan, ["h", "height", "releaseheight", "h0"]), "plan");
      setSlot(bag, "releaseHeight", numberAfter(stem, /released from(?: a)? height(?: of)?|height of/i, UNIT.metre), "stem");
      setSlot(bag, "approach", /\bincline\b|\bramp\b|\bslope\b/i.test(stem) ? "incline" : "none", "stem");
    },
  },
  {
    id: "circular_motion_level",
    cues: [
      [/\b(?:level (?:circular )?(?:road|track|turn)|circular (?:road|track|turn|path)|curve on a level road|uniform circular motion|centripetal)\b/i, 3],
      [/\b(?:car|cyclist|vehicle|particle|stone)\b/i, 1],
      [/\bradius\b/i, 1],
    ],
    vetoes: [/\bbanked\b/i, /\bvertical\b/i, /\bmagnetic\b/i, /\bsatellite|orbit\b/i],
    // The figure is a body going round a circle. A car moving along a level
    // road names no circle, so the stem must say it turns.
    requires: [/\b(?:circular|circles?|curved?|curves|turns?|turning|bends?|radius|centripetal|roundabout)\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "radius", planNumber(plan, ["r", "radius"]), "plan");
      setSlot(bag, "radius", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "speed", speedsOf(stem)[0] ?? null, "stem");
      setSlot(bag, "mu", frictionCoefficient(stem), "stem");
    },
  },
  {
    id: "banked_road",
    cues: [[/\bbanked\b/i, 4], [/\bbanking\b/i, 3], [/\b(?:angle of banking|road|track|curve)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle", "bankingangle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
      setSlot(bag, "radius", firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "hinged_rod",
    cues: [
      [/\bhinge/i, 3],
      [/\b(?:uniform|thin) (?:rod|bar|beam)\b/i, 2],
      [/\b(?:pivoted|pivot|torque|moment of (?:a )?force|angular acceleration)\b/i, 1],
    ],
    vetoes: [/\bpendulum\b/i, /\bladder\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "length", planNumber(plan, ["l", "length"]), "plan");
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "mass", massesOf(stem)[0] ?? null, "stem");
      setSlot(bag, "theta", firstAngle(stem), "stem");
      setSlot(bag, "orientation", /\bhorizontal/i.test(stem) ? "horizontal" : /\bvertical/i.test(stem) ? "vertical" : "angled", "stem");
    },
  },
  {
    id: "ladder_wall",
    cues: [[/\bladder\b/i, 4], [/\b(?:leans?|leaning) against\b/i, 3], [/\bwall\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "relative_motion_line",
    cues: [
      [/\b(?:two (?:cars|trains|buses|cyclists|bodies|particles|objects)|cars? [AB]\b|trains? [AB]\b)\b/i, 3],
      [/\b(?:relative velocity|relative to|catch(?:es)? up|overtake|ahead of|behind|same direction|opposite direction)\b/i, 2],
      [/\b(?:straight (?:road|line|track)|along a line)\b/i, 1],
    ],
    // Relative motion is a two-body figure; "same direction" alone is not evidence.
    requires: [/\b(?:two (?:cars|trains|buses|cyclists|bodies|particles|objects)|cars? [AB]\b|trains? [AB]\b|[AB] relative to [AB]|relative to (?:the )?(?:other|car|train|ground|[AB])\b|ahead of|behind|catch(?:es)? up|overtake)\b/i],
    vetoes: [/\briver|boat|rain\b/i, /\bcollid|collision\b/i],
    extract: (stem, plan, bag) => {
      const speeds = speedsOf(stem);
      setSlot(bag, "vA", planNumber(plan, ["va", "v1", "ua"]), "plan");
      setSlot(bag, "vB", planNumber(plan, ["vb", "v2", "ub"]), "plan");
      setSlot(bag, "vA", speeds[0] ?? null, "stem");
      setSlot(bag, "vB", speeds[1] ?? null, "stem");
      setSlot(bag, "gap", numberBefore(stem, /(?:m|metres?|km)\s+(?:ahead|behind|apart)/, undefined) ?? firstNumberWithUnit(stem, /m\s+(?:ahead|behind|apart)/), "stem");
      // Direction is read, never assumed: head-on wording is "no", explicit
      // same-direction wording is "yes", and anything else stays unset.
      const compass = new Set((stem.match(/\b(?:east|west|north|south)(?:wards?)?\b/gi) ?? []).map((word) => word.toLowerCase().replace(/wards?$/, "")));
      const opposite = /\b(?:opposite|towards? each other|approach\w* each other|head[- ]on)\b/i.test(stem)
        || (compass.has("east") && compass.has("west")) || (compass.has("north") && compass.has("south"));
      const same = /\b(?:same direction|overtak\w*|catch(?:es)? up|chas\w*)\b/i.test(stem) || compass.size === 1;
      // A signed negative velocity fixes direction on an unstated axis; leave it unread.
      const signedNegative = /(?:^|[^\w.])-\s*\d+(?:\.\d+)?\s*(?:m\/s|km\/h)/i.test(stem);
      setSlot(bag, "sameDirection", opposite === same || signedNegative ? null : opposite ? "no" : "yes", "stem");
    },
  },
  {
    id: "river_boat",
    cues: [[/\bboat\b/i, 3], [/\b(?:river|stream|current)\b/i, 2], [/\bstill water\b/i, 2], [/\b(?:cross|opposite bank|downstream|upstream|drift)\b/i, 1]],
    vetoes: [/\brain\b/i],
    minScore: 5,
    extract: (stem, plan, bag) => {
      // Speeds bind by role words, never by mention order; unbound roles stay unset.
      const speeds = riverCrossingSpeeds(stem);
      if (speeds.status === "bound") {
        setSlot(bag, "vb", speeds.vb, "stem");
        setSlot(bag, "vc", speeds.vc, "stem");
      }
      // One oracle for the river variant, shared with the family layer.
      setSlot(bag, "variant", riverBoatVariant(stem), "stem");
    },
  },
  {
    id: "uniform_acceleration_vt",
    cues: [
      [/\b(?:uniform(?:ly)?\s+accelerat\w*|constant\s+(?:acceleration|deceleration|retardation)|accelerat(?:es|ing|ed)\b|decelerat\w*|retard\w*|brak(?:es|ing|ed)\b|speeds? up|slows? down)/i, 3, "constant acceleration"],
      [/\b(?:velocity[- ]time|v[- –]t) (?:graph|curve|plot)\b/i, 4, "v-t graph"],
      [/\b(?:straight (?:line|road|track|path)|along a (?:straight |level )?(?:road|track|runway|line))\b/i, 1],
      [/\b(?:starts? from rest|comes? to (?:a )?(?:rest|stop)|stopping distance)\b/i, 1],
    ],
    vetoes: [
      /\b(?:vertical(?:ly)?|upwards?|downwards?|thrown|dropped|falls?|freely|free fall|projectile|projected|incline|inclined|slope|circular|circle|orbit|relative to|angle)\b/i,
      /\b(?:then|after that|afterwards|for the next|finally|thereafter)\b/i,
      /\bg\s*=|\b(?:x|s)\s*=\s*[^,.;]*\d\s*\*?\s*t\b|\b(?:x|s)\s*=\s*t\b/i,
    ],
    minScore: 3,
    extract: (stem, plan, bag) => extractSuvatSlots(stem, plan, bag, setSlot),
  },
  {
    id: "vt_graph",
    cues: [
      [/\b(?:velocity[- ]time|v[- –]t) (?:graph|curve|plot)\b/i, 4],
      [/\b(?:accelerates uniformly|uniform acceleration|constant speed|decelerates|retard|comes to rest|brakes)\b/i, 1],
      [/\bthen\b/i, 1],
    ],
    vetoes: [/\bposition[- ]time|x[- ]t graph|displacement[- ]time\b/i],
    minScore: 4,
    extract: (stem, _plan, bag) => {
      setSlot(bag, "phases", stem, "stem");
    },
  },
  {
    id: "xt_graph",
    cues: [
      [/\b(?:position[- ]time|displacement[- ]time|x[- –]t) (?:graph|curve|plot)\b/i, 4],
      [/\b(?:x|s)\s*=\s*[^,.;]*\bt\b/i, 3, "x(t)"],
      [/\bphase\b[^.]{0,30}\bsimple harmonic\b|\bsimple harmonic motion\b[^.]{0,30}\bphase\b/i, 4, "SHM phase"],
      [/\bposition\b[^.]{0,40}\bt\b/i, 1],
    ],
    vetoes: [/\by\s*=\s*[^,;]*\bt\b/i, /\benerg(?:y|ies)\b|\bsuperposition\b/i],
    minScore: 3,
    extract: (stem, plan, bag) => {
      setSlot(bag, "expression", positionOfTime(stem), "stem");
      if (/\b(?:simple harmonic|SHM)\b/i.test(stem)) {
        const amplitude = planNumber(plan, ["a", "amplitude"]) ?? numberAfter(stem, /amplitude(?: of| is| =)?/, /cm|m|mm/) ?? 1;
        const period = planNumber(plan, ["t", "period", "timeperiod"]) ?? numberAfter(stem, /(?:time )?period(?: of| is| =)?/, UNIT.second) ?? 2;
        setSlot(bag, "expression", `${amplitude}*sin(2*pi*x/${period})`, "stem");
        setSlot(bag, "tMax", 2 * period, "stem");
      }
      setSlot(bag, "tMax", numberAfter(stem, /(?:for|from) 0 to|to t\s*=|t\s*=\s*0 to/, UNIT.second) ?? numbersWithUnit(stem, UNIT.second).at(-1) ?? null, "stem");
    },
  },
  {
    id: "fx_graph_area",
    cues: [
      [/\bF\s*=\s*[^,.;]*x\b/, 3, "F(x)"],
      [/\b(?:F|force)\s*(?:versus|vs\.?|against)\s*x\b/i, 3],
      [/\bwork done\b/i, 2],
      [/\b(?:variable force|force varies)\b/i, 2],
    ],
    minScore: 4,
    extract: (stem, _plan, bag) => {
      const expressions = explicitFunctions(stem, /\bF(?:\s*\(\s*x\s*\))?\s*=\s*/g);
      setSlot(bag, "expression", expressions[0] ?? null, "stem");
      const interval = xInterval(stem);
      if (interval) { setSlot(bag, "from", interval[0], "stem"); setSlot(bag, "to", interval[1], "stem"); }
    },
  },
  {
    id: "collision_line",
    cues: [[/\bcollid|collision\b/i, 3], [/\b(?:head[- ]on|sticks? to|embed|coalesce|elastic|inelastic|restitution)\b/i, 2], [/\b(?:two|balls?|bodies|blocks|particles)\b/i, 1]],
    vetoes: [/\bpendulum\b/i],
    extract: (stem, plan, bag) => {
      const masses = massesOf(stem);
      const speeds = speedsOf(stem);
      setSlot(bag, "m1", planNumber(plan, ["m1"]), "plan");
      setSlot(bag, "m2", planNumber(plan, ["m2"]), "plan");
      setSlot(bag, "m1", masses[0] ?? null, "stem");
      setSlot(bag, "m2", masses[1] ?? null, "stem");
      setSlot(bag, "u1", speeds[0] ?? null, "stem");
      setSlot(bag, "u2", speeds[1] ?? 0, speeds[1] !== undefined ? "stem" : "default");
    },
  },
  {
    id: "vectors_resultant",
    cues: [
      [/\b(?:two vectors|two forces|resultant|parallelogram law|triangle law|vector (?:addition|sum))\b/i, 3],
      [/\b(?:at an angle|angle between|inclined at)\b/i, 2],
      [/\b(?:magnitude|units?)\b/i, 1],
    ],
    vetoes: [/\briver|boat|charge|field|current|projectile\b/i],
    extract: (stem, plan, bag) => {
      const magnitudes = [...stem.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:units?|N\b|newtons?|m\/s)/gi)].map((match) => Number(match[1]));
      const bare = magnitudes.length >= 2 ? magnitudes : [...stem.matchAll(/\b(?:magnitudes?|of)\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/gi)].flatMap((match) => [Number(match[1]), Number(match[2])]);
      setSlot(bag, "a", planNumber(plan, ["a", "p", "f1", "a1"]), "plan");
      setSlot(bag, "b", planNumber(plan, ["b", "q", "f2", "a2"]), "plan");
      setSlot(bag, "a", bare[0] ?? null, "stem");
      setSlot(bag, "b", bare[1] ?? null, "stem");
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
    },
  },
  {
    id: "two_point_charges",
    cues: [
      [/\b(?:two|2) (?:point )?charges\b/i, 4],
      [/\bpoint charges?\b/i, 2],
      [/\b(?:μC|uC|nC|microcoulomb|nanocoulomb|coulomb)\b/i, 2],
      [/\b(?:apart|separated|distance between|null point|field is zero|neutral point|midpoint)\b/i, 1],
    ],
    vetoes: [/\bdipole\b/i, /\bmagnetic\b/i, /\bplate|capacitor\b/i],
    extract: (stem, plan, bag) => {
      const charges = [...stem.matchAll(/([+-]?\s*\d+(?:\.\d+)?)\s*(?:μC|uC|nC|C\b|microcoulomb|nanocoulomb)/gi)].map((match) => Number(match[1]!.replace(/\s+/g, "")));
      setSlot(bag, "q1", charges[0] ?? null, "stem");
      setSlot(bag, "q2", charges[1] ?? null, "stem");
      setSlot(bag, "d", planNumber(plan, ["d", "r", "distance", "separation"]), "plan");
      setSlot(bag, "d", firstNumberWithUnit(stem, UNIT.centimetre) ?? firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "fieldPoint", /\b(?:zero|null|neutral)\b/i.test(stem) ? "between" : /\b(?:midpoint|mid-?point|centre|center)\b/i.test(stem) ? "between" : "none", "stem");
    },
  },
  {
    id: "dipole_in_field",
    cues: [[/\bdipole\b/i, 4], [/\b(?:uniform (?:electric )?field|torque|dipole moment)\b/i, 1]],
    vetoes: [/\bmagnetic dipole\b|\bbar magnet\b|\bmagnetic moment\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
    },
  },
  {
    id: "straight_wire_field",
    cues: [
      [/\b(?:long|infinite|straight)\b[^.]{0,20}\b(?:wire|conductor)\b/i, 3],
      [/\bmagnetic field\b/i, 2],
      [/\b(?:perpendicular distance|distance of|at a distance)\b/i, 1],
      [/\bcurrent\b/i, 1],
    ],
    vetoes: [/\b(?:two|parallel) (?:wires|conductors)\b/i, /\bsolenoid|toroid|coil|loop\b/i, /\bmoves|moving|velocity|emf\b/i],
    minScore: 5,
    extract: (stem, plan, bag) => {
      setSlot(bag, "current", planNumber(plan, ["i", "current"]), "plan");
      setSlot(bag, "current", firstNumberWithUnit(stem, UNIT.ampere), "stem");
      setSlot(bag, "r", planNumber(plan, ["r", "d", "distance"]), "plan");
      setSlot(bag, "r", firstNumberWithUnit(stem, UNIT.centimetre) ?? firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "charge_in_magnetic_field",
    cues: [
      [/\b(?:electron|proton|alpha particle|charged particle|ion|particle of charge)\b/i, 3],
      [/\bmagnetic field\b/i, 2],
      [/\b(?:circular path|radius of (?:the|its) (?:path|circle|orbit)|perpendicular to (?:the|a) (?:magnetic )?field|enters)\b/i, 2],
    ],
    minScore: 6,
    extract: (stem, plan, bag) => {
      setSlot(bag, "B", planNumber(plan, ["b", "magneticfield"]), "plan");
      setSlot(bag, "B", firstNumberWithUnit(stem, UNIT.tesla), "stem");
      setSlot(bag, "v", planNumber(plan, ["v", "speed", "velocity"]), "plan");
      setSlot(bag, "v", speedsOf(stem)[0] ?? null, "stem");
      setSlot(bag, "radius", planNumber(plan, ["r", "radius"]), "plan");
    },
  },
  {
    id: "solenoid_field",
    cues: [[/\bsolenoid\b/i, 4], [/\btoroid\b/i, 4], [/\b(?:turns per|turns\/|number of turns)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "turns", planNumber(plan, ["n", "turns", "turnspermetre"]), "plan");
      setSlot(bag, "turns", numberBefore(stem, /turns/), "stem");
      setSlot(bag, "current", firstNumberWithUnit(stem, UNIT.ampere), "stem");
    },
  },
  {
    id: "parallel_wires",
    cues: [[/\b(?:two|parallel) (?:long |straight |infinite |current[- ]carrying )*(?:wires|conductors)\b/i, 4], [/\bforce per unit length\b|\bdefinition of (?:the )?ampere\b/i, 3], [/\bcurrents?\b/i, 1]],
    extract: (stem, plan, bag) => {
      const currents = numbersWithUnit(stem, UNIT.ampere);
      setSlot(bag, "i1", currents[0] ?? null, "stem");
      setSlot(bag, "i2", currents[1] ?? currents[0] ?? null, "stem");
      setSlot(bag, "d", planNumber(plan, ["d", "r", "distance", "separation"]), "plan");
      setSlot(bag, "d", firstNumberWithUnit(stem, UNIT.centimetre) ?? firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "parallel_plates",
    cues: [[/\bparallel[- ]plate\b/i, 4], [/\b(?:two (?:metal |conducting )?(?:plates|sheets)|between the plates)\b/i, 3], [/\bcapacitor\b/i, 1]],
    vetoes: [/\b(?:in series|in parallel|combination|equivalent capacitance)\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "d", planNumber(plan, ["d", "separation", "plateseparation"]), "plan");
      setSlot(bag, "d", firstNumberWithUnit(stem, UNIT.millimetre) ?? firstNumberWithUnit(stem, UNIT.centimetre), "stem");
    },
  },
  {
    id: "satellite_orbit",
    cues: [[/\bsatellite\b/i, 4], [/\b(?:orbit|orbital|revolves? around|geostationary)\b/i, 2], [/\b(?:earth|planet|moon)\b/i, 1]],
    extract: (stem, _plan, bag) => {
      // A planet radius and an orbital radius have the same dimension, but
      // different roles. Require the orbit role and the stated length unit.
      setSlot(bag, "radius", lengthAfterInMetres(stem, /\borbital radius|\bradius of (?:the |its )?orbit|\borbit(?: of| with| has| has a| with a)? radius/), "stem");
      setSlot(bag, "height", lengthAfterInMetres(stem, /\b(?:height|altitude)(?: above (?:the )?(?:surface|planet|earth|moon))?/), "stem");
      setSlot(bag, "planetRadius", lengthAfterInMetres(stem, /\b(?:planet|earth|moon)(?:'s)? radius|\bradius of (?:the )?(?:planet|earth|moon)|\b(?:planet|earth|moon) (?:of|with)(?: a)? radius/), "stem");
    },
  },
  {
    id: "motional_emf_rod",
    cues: [[/\b(?:conducting|metal|metallic) (?:rod|bar|wire)\b/i, 3], [/\b(?:motional emf|induced emf|emf induced)\b/i, 3], [/\b(?:moves|moving|velocity|rails?)\b/i, 1], [/\bmagnetic field\b/i, 1]],
    minScore: 5,
    extract: (stem, plan, bag) => {
      setSlot(bag, "length", planNumber(plan, ["l", "length"]), "plan");
      const rodMetres = firstNumberWithUnit(stem, UNIT.metre);
      const rodCentimetres = firstNumberWithUnit(stem, UNIT.centimetre);
      setSlot(bag, "length", rodMetres ?? (rodCentimetres === null ? null : rodCentimetres / 100), "stem");
      setSlot(bag, "v", speedsOf(stem)[0] ?? null, "stem");
      setSlot(bag, "B", firstNumberWithUnit(stem, UNIT.tesla), "stem");
    },
  },
  {
    id: "resistor_network",
    cues: [
      [/\bresistors?\b/i, 2],
      // No i flag on Ω: it would fold onto the angular frequency ω.
      [/[ΩΩ]|\b[Oo][Hh][Mm][Ss]?\b/, 2],
      [/\b(?:in series|in parallel|series combination|parallel combination|equivalent resistance|effective resistance|total current|current drawn)\b/i, 2],
      [/\b(?:battery|cell|emf|volt)\b/i, 1],
      [/\binternal resistance\b/i, 2],
    ],
    vetoes: [/\b(?:kirchhoff|two loops?|loop rule|junction rule|wheatstone|met(?:er|re) bridge|potentiometer|capacitor|galvanometer)\b/i],
    extract: (fullStem, plan, bag) => {
      // "Find the potential difference across the 6 Ω resistor" names a
      // resistor already stated; it is not one more resistor.
      const stem = withoutResistorBackReferences(fullStem);
      // Only resistances the stem states may become resistors. The plan's
      // quantity list mixes givens with derived values (an equivalent
      // resistance in ohms would otherwise be drawn as one more resistor), so a
      // plan list is used only when every value is a literal of the stem.
      // In a bound mixed tree a count word ("two resistors of 6 Ω and 3 Ω ...
      // in series with a 2 Ω resistor") counts one group, and the tree's
      // leaves are the stem's resistances in order, so the plan cannot reorder them.
      const mixedTree = needsStructuralReader(stem) ? readResistorTree(stem) : null;
      const values = mixedTree ? ohms(stem) : stemResistances(stem);
      if (values === null) {
        setSlot(bag, "resistorCountConflict", 1, "stem");
      } else {
        const literals = new Set([...stem.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])));
        const planValues = plan
          .filter((quantity) => /^R_?\d+$/i.test(quantity.symbol) || (quantity.unit !== undefined && /^(?:ohms?|Ω)$/i.test(quantity.unit.trim()) && !/eq|tot|net|eff|ext/i.test(`${quantity.id} ${quantity.symbol}`)))
          .map((quantity) => quantity.value);
        const planGrounded = planValues.length >= 2 && planValues.length >= values.length && planValues.every((value) => literals.has(value));
        setSlot(bag, "resistors", !mixedTree && planGrounded && !values.some(Number.isNaN) ? planValues : null, "plan");
        const known = values.filter((value) => !Number.isNaN(value));
        setSlot(bag, "resistors", known.length === values.length && known.length >= 1 ? known : null, "stem");
        setSlot(bag, "resistorCount", values.length >= 1 ? values.length : null, "stem");
      }
      setSlot(bag, "topology", resistorTopology(stem, bag), "stem");
      // A source with internal resistance is a different circuit (terminal
      // voltage, lost volts); it is not drawn as one more external resistor.
      if (/\binternal resistance\b/i.test(stem)) setSlot(bag, "internalResistance", 1, "stem");
      // A source label must be the stem's one stated voltage. Several distinct
      // voltages (a meter reading, a rating) leave the source unlabelled, and a
      // plan voltage counts only when the stem states it.
      const stemVolts = [...new Set(volts(stem))];
      const planEmf = planNumber(plan, ["v", "e", "emf", "voltage"]);
      setSlot(bag, "emf", planEmf !== null && stemVolts.length === 1 && stemVolts[0] === planEmf ? planEmf : null, "plan");
      setSlot(bag, "emf", stemVolts.length === 1 ? stemVolts[0]! : null, "stem");
    },
  },
  {
    id: "two_loop_network",
    cues: [[/\bkirchhoff\b/i, 4], [/\b(?:two loops?|loop (?:rule|law)|junction (?:rule|law)|KVL|KCL|each branch|mesh)\b/i, 3], [/\b(?:two (?:batteries|cells|sources)|batter(?:y|ies))\b/i, 1]],
    vetoes: [/\bwheatstone|met(?:er|re) bridge|potentiometer\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "resistors", ohms(stem), "stem");
      setSlot(bag, "emfs", volts(stem), "stem");
      void plan;
    },
  },
  {
    id: "wheatstone_bridge",
    cues: [[/\bwheatstone\b/i, 5], [/\bbridge\b/i, 2], [/\b(?:galvanometer|balanced|no deflection|null)\b/i, 1]],
    vetoes: [/\bmet(?:er|re) bridge\b/i],
    extract: (stem, plan, bag) => {
      const values = ohms(stem);
      setSlot(bag, "resistors", values.length ? values : null, "stem");
      void plan;
    },
  },
  {
    id: "meter_bridge",
    cues: [[/\bmet(?:er|re) bridge\b/i, 5], [/\b(?:balance point|balancing length|null point|jockey)\b/i, 2], [/\b(?:left gap|right gap)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "balance", planNumber(plan, ["l", "l1", "balancinglength", "balancepoint"]), "plan");
      setSlot(bag, "balance", bridgeLengthInCm(stem, /\b(?:balance|balancing|null) (?:point|length)\b/), "stem");
      setSlot(bag, "known", ohms(stem)[0] ?? null, "stem");
    },
  },
  {
    id: "capacitor_network",
    cues: [[/\bcapacitors\b/i, 4], [/\b(?:μF|uF|microfarad|pF|nF)\b/i, 2], [/\b(?:in series|in parallel|combination|equivalent capacitance|effective capacitance)\b/i, 2]],
    vetoes: [/\bparallel[- ]plate\b/i, /\bresistor/i],
    extract: (stem, plan, bag) => {
      const values = farads(stem);
      setSlot(bag, "capacitors", values.length ? values : null, "stem");
      const series = /\bseries\b/i.test(stem);
      const parallel = /\bparallel\b/i.test(stem);
      setSlot(bag, "topology", series && parallel ? "series_parallel" : parallel ? "parallel" : "series", "stem");
      setSlot(bag, "emf", planNumber(plan, ["v", "emf", "voltage"]), "plan");
      setSlot(bag, "emf", volts(stem)[0] ?? null, "stem");
    },
  },
  {
    id: "potentiometer",
    cues: [[/\bpotentiometer\b/i, 5], [/\b(?:balancing length|balance point|null point|driver cell|jockey)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "balance", planNumber(plan, ["l", "l1", "balancinglength"]), "plan");
      setSlot(bag, "balance", bridgeLengthInCm(stem, /\b(?:balance|balancing|null) (?:point|length)\b/), "stem");
      setSlot(bag, "wireLength", bridgeWireLengthInCm(stem), "stem");
    },
  },
  {
    id: "spherical_mirror",
    cues: [[/\b(?:concave|convex) mirror\b/i, 5], [/\bmirror\b/i, 3], [/\b(?:focal length|radius of curvature|image|object)\b/i, 1]],
    // A lens or mirror stem names the element; a mirror image, the
    // reflection of a coordinate point and a line given as the mirror are not one.
    vetoes: [/\bplane mirror\b/i, /\blens\b/i, MIRROR_IMAGE_IN_GEOMETRY, COORDINATE_POINT_REFLECTION, LINE_GIVEN_AS_MIRROR],
    extract: (stem, plan, bag) => {
      setSlot(bag, "kind", /\bconvex\b/i.test(stem) ? "convex" : "concave", "stem");
      setSlot(bag, "u", planNumber(plan, ["u", "objectdistance", "do"]), "plan");
      setSlot(bag, "u", objectDistanceFromStem(stem), "stem");
      setSlot(bag, "f", planNumber(plan, ["f", "focallength"]), "plan");
      const focal = focalLengthFromStem(stem);
      const curvature = radiusOfCurvatureFromStem(stem);
      setSlot(bag, "f", focal ?? (curvature === null ? null : curvature / 2), "stem");
      setSlot(bag, "v", planNumber(plan, ["v", "imagedistance", "di"]), "plan");
    },
  },
  {
    id: "thin_lens",
    cues: [[/\b(?:convex|concave|converging|diverging|biconvex|thin) lens\b/i, 5], [/\blens\b/i, 3], [/\b(?:focal length|power|image|object|magnification)\b/i, 1]],
    vetoes: [/\bmirror\b/i, /\b(?:microscope|telescope|eyepiece|objective)\b/i, /\blens maker/i, /\bradii\b/i, COORDINATE_POINT_REFLECTION],
    extract: (stem, plan, bag) => {
      setSlot(bag, "kind", /\b(?:concave|diverging)\b/i.test(stem) ? "concave" : "convex", "stem");
      setSlot(bag, "u", planNumber(plan, ["u", "objectdistance", "do"]), "plan");
      setSlot(bag, "u", objectDistanceFromStem(stem), "stem");
      setSlot(bag, "f", planNumber(plan, ["f", "focallength"]), "plan");
      setSlot(bag, "f", focalLengthFromStem(stem), "stem");
      setSlot(bag, "v", planNumber(plan, ["v", "imagedistance", "di"]), "plan");
    },
  },
  {
    id: "lens_maker",
    cues: [
      [/\blens[- ]?maker/i, 5],
      [/\b(?:biconvex|biconcave|plano[- ]convex|plano[- ]concave)\b/i, 3],
      [/\bradii\b/i, 3],
      [/\b(?:R\s*1|R1|radius of curvature)\b/i, 2],
    ],
    // "R1" in a circuit names a resistance, not a lens face.
    vetoes: [/\b(?:microscope|telescope|eyepiece|objective)\b/i, /\bmirror\b/i, COORDINATE_POINT_REFLECTION, /\b(?:LCR|LR|RC|resistors?|resistances?|circuits?|capacitors?|inductors?|a\.c\.)/i],
    extract: (stem, plan, bag) => {
      const kind = /\bbiconcave\b/i.test(stem) || /\bplano[- ]concave\b/i.test(stem)
        ? (/\bplano\b/i.test(stem) ? "plano-concave" : "biconcave")
        : /\bplano[- ]convex\b/i.test(stem)
          ? "plano-convex"
          : "biconvex";
      setSlot(bag, "kind", kind, "stem");
      setSlot(bag, "n", planNumber(plan, ["n", "nlens", "mu", "lensindex"]), "plan");
      setSlot(bag, "n", refractiveIndex(stem), "stem");
      const indexValue = numberAfter(stem, /\b(?:refractive )?index\b(?: of (?:the )?(?:glass|lens|material))?(?: is| of| =|:)?/);
      if (indexValue !== null && indexValue >= 1 && indexValue < 4) setSlot(bag, "n", indexValue, "stem");
      setSlot(bag, "n0", planNumber(plan, ["n0", "nmedium", "nair"]), "plan");
      setSlot(bag, "n0", 1, "default");
      setSlot(bag, "R1", planNumber(plan, ["r1", "radius1"]), "plan");
      setSlot(bag, "R2", planNumber(plan, ["r2", "radius2"]), "plan");
      const radii = numbersWithUnit(stem, UNIT.centimetre);
      if (radii.length >= 2) {
        const plusMinus = /plus\s+(\d+(?:\.\d+)?)\s*cm\s+and\s+minus\s+(\d+(?:\.\d+)?)/i.exec(stem);
        if (plusMinus) {
          setSlot(bag, "R1", Number(plusMinus[1]), "stem");
          setSlot(bag, "R2", -Number(plusMinus[2]), "stem");
        } else {
          setSlot(bag, "R1", radii[0], "stem");
          setSlot(bag, "R2", radii[1], "stem");
        }
      }
      setSlot(bag, "R1", numberAfter(stem, /R\s*1(?: is| =|:)?/, UNIT.centimetre), "stem");
      setSlot(bag, "R2", numberAfter(stem, /R\s*2(?: is| =|:)?/, UNIT.centimetre), "stem");
    },
  },
  {
    id: "spherical_refraction",
    cues: [
      [/\bspherical (?:air[- ]glass |refracting |)?(?:surface|interface)\b/i, 5],
      [/\b(?:center of curvature|centre of curvature|paraxial image|surface[- ]normal)\b/i, 2],
      [/\brefraction at a spherical\b/i, 5],
    ],
    vetoes: [/\b(?:lens|mirror|prism)\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "kind", /\bconcave\b/i.test(stem) ? "concave" : "convex", "stem");
      setSlot(bag, "u", planNumber(plan, ["u", "objectdistance", "s"]), "plan");
      setSlot(bag, "u", numberBefore(stem, /(?:cm|m)\s+from/) ?? numberAfter(stem, /(?:object distance(?: of| is| =)?|placed at(?: a distance of)?)/, UNIT.centimetre), "stem");
      setSlot(bag, "R", planNumber(plan, ["r", "radius", "radiusofcurvature"]), "plan");
      setSlot(bag, "R", numberAfter(stem, /radius(?: of curvature)?(?: of| is| =)?/, UNIT.centimetre), "stem");
      setSlot(bag, "n1", planNumber(plan, ["n1", "nair"]), "plan");
      setSlot(bag, "n1", 1, "default");
      setSlot(bag, "n2", planNumber(plan, ["n2", "n", "nglass", "mu", "refractiveindex"]), "plan");
      setSlot(bag, "n2", refractiveIndex(stem), "stem");
      const glassIndex = numberAfter(stem, /\b(?:glass |refractive )?index\b(?: of (?:the )?(?:glass|material))?(?: is| of| =|:)?/);
      if (glassIndex !== null && glassIndex >= 1 && glassIndex < 4) setSlot(bag, "n2", glassIndex, "stem");
    },
  },
  {
    id: "plane_refraction",
    cues: [
      [/\b(?:refract|refraction|enters (?:a |the )?(?:glass|water|medium)|air[- ](?:glass|water) (?:interface|surface|boundary)|passes from)\b/i, 3],
      [/\b(?:angle of incidence|incident at|incidence|angle of refraction|refracted ray|both rays)\b/i, 2],
      [/\bn\s*=\s*\d\.\d+/i, 1],
      [/\brefractive index\b/i, 2],
      [/\bsnell/i, 2],
    ],
    vetoes: [/\bprism\b/i, /\b(?:lens|mirror|slab|fibre|fiber|critical angle|total internal)\b/i, /\bspherical\b/i],
    minScore: 4,
    extract: (stem, plan, bag) => {
      setSlot(bag, "i", planNumber(plan, ["i", "theta1", "thetai", "angleofincidence", "incidentangle"]), "plan");
      setSlot(bag, "i", firstAngle(stem), "stem");
      setSlot(bag, "n1", planNumber(plan, ["n1", "nair", "mu1"]), "plan");
      setSlot(bag, "n2", planNumber(plan, ["n2", "n", "nglass", "mu", "mu2", "refractiveindex"]), "plan");
      const index = refractiveIndex(stem);
      setSlot(bag, "n1", 1, "default");
      setSlot(bag, "n2", index, "stem");
    },
  },
  {
    id: "total_internal_reflection",
    cues: [[/\b(?:critical angle|total internal reflection|TIR)\b/i, 5], [/\b(?:denser|rarer|optical fibre|optical fiber)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "n1", planNumber(plan, ["n1", "n", "mu", "refractiveindex"]), "plan");
      setSlot(bag, "n1", refractiveIndex(stem), "stem");
      setSlot(bag, "n2", 1, "default");
      setSlot(bag, "i", firstAngle(stem), "stem");
    },
  },
  {
    id: "prism",
    cues: [[/\bprism\b/i, 5], [/\b(?:deviation|emergent|apex|refracting angle|minimum deviation)\b/i, 1]],
    extract: (stem, plan, bag) => {
      const angles = allAngles(stem);
      setSlot(bag, "A", planNumber(plan, ["a", "apexangle", "prismangle", "refractingangle"]), "plan");
      setSlot(bag, "A", /\bequilateral\b/i.test(stem) ? 60 : numberAfter(stem, /(?:apex|refracting|prism) angle(?: of| is| =)?|angle of (?:the )?prism(?: is| =)?/, DEG), "stem");
      setSlot(bag, "i", planNumber(plan, ["i", "angleofincidence", "incidentangle", "i1"]), "plan");
      setSlot(bag, "i", numberAfter(stem, /(?:incident at|angle of incidence(?: of| is| =)?|incidence(?: of| is| =)?)/, DEG) ?? (angles.length > 1 ? angles.find((angle) => angle !== 60) ?? null : null), "stem");
      setSlot(bag, "n", planNumber(plan, ["n", "mu", "refractiveindex"]), "plan");
      setSlot(bag, "n", refractiveIndex(stem), "stem");
    },
  },
  {
    id: "double_slit",
    cues: [[/\b(?:young|double[- ]slit|two slits|YDSE)\b/i, 5], [/\b(?:fringe|interference|slit separation)\b/i, 2]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "d", planNumber(plan, ["d", "slitseparation"]), "plan");
      setSlot(bag, "d", numberAfter(stem, /(?:slit separation|separation between the slits|distance between the slits|slits (?:are )?separated by)(?: is| of| =)?/, UNIT.millimetre), "stem");
      setSlot(bag, "D", planNumber(plan, ["dscreen", "screendistance", "l"]), "plan");
      setSlot(bag, "D", numberAfter(stem, /(?:screen (?:is )?(?:placed |kept )?(?:at (?:a distance of )?)?|distance (?:of|to) the screen(?: is| of)?)/, UNIT.metre), "stem");
      setSlot(bag, "lambda", numberAfter(stem, /wavelength(?: of| is| =)?/, UNIT.nm), "stem");
    },
  },
  {
    id: "single_slit",
    cues: [[/\bsingle[- ]slit\b/i, 5], [/\bdiffraction\b/i, 3], [/\b(?:central maximum|first minimum|slit width)\b/i, 1]],
    vetoes: [/\bdouble|two slits|young\b/i, /\bgrating\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "a", numberAfter(stem, /(?:slit (?:of )?width|width of the slit)(?: is| of| =)?/, UNIT.millimetre), "stem");
      setSlot(bag, "D", numberAfter(stem, /screen[^0-9]{0,30}/, UNIT.metre), "stem");
      setSlot(bag, "lambda", numberAfter(stem, /wavelength(?: of| is| =)?/, UNIT.nm), "stem");
      void plan;
    },
  },
  {
    id: "compound_microscope",
    cues: [[/\bcompound microscope\b/i, 5], [/\bmicroscope\b/i, 4], [/\b(?:objective|eyepiece)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "fo", planNumber(plan, ["fo", "f0", "objectivefocallength", "focalobjective"]), "plan");
      setSlot(bag, "fe", planNumber(plan, ["fe", "eyepiecefocallength", "focaleyepiece"]), "plan");
      const lengths = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm)\b/gi)].map((match) => Number(match[1]) * (match[2]!.toLowerCase() === "mm" ? 0.1 : 1));
      setSlot(bag, "fo", lengths[0] ?? null, "stem");
      setSlot(bag, "fe", lengths[1] ?? null, "stem");
      setSlot(bag, "uo", planNumber(plan, ["uo", "u", "objectdistance"]), "plan");
    },
  },
  {
    id: "telescope",
    cues: [[/\btelescope\b/i, 5], [/\b(?:normal adjustment|magnifying power|objective|eyepiece)\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "fo", planNumber(plan, ["fo", "f0", "objectivefocallength"]), "plan");
      setSlot(bag, "fe", planNumber(plan, ["fe", "eyepiecefocallength"]), "plan");
      const lengths = numbersWithUnit(stem, UNIT.centimetre);
      setSlot(bag, "fo", lengths[0] ?? null, "stem");
      setSlot(bag, "fe", lengths[1] ?? null, "stem");
    },
  },
  {
    id: "photoelectric",
    cues: [[/\b(?:photoelectric|photo-electric|photoelectron|work function|stopping potential|threshold (?:frequency|wavelength))\b/i, 5], [/\b(?:einstein|photon)\b/i, 1]],
    extract: (stem, _plan, bag) => {
      // A planner's derived value is a claim, not a solver result. Bind energy
      // roles to the question and convert units before publishing numeric ink.
      setSlot(bag, "workFunction", readEnergyAfterInEv(stem, /work function(?: of (?:a |the )?(?:metal|surface))?(?: is| of| =)?|(?:φ|phi)\s*=/).value, "stem");
      // The cutoff (including bounded modifiers such as "maximum allowed")
      // describes the surface, not the incident photon. A clause boundary
      // stops the prefix; a later incident wavelength remains eligible. Conflicting
      // remaining wavelengths are ambiguous and the reader returns no value.
      setSlot(bag, "lambda", wavelengthAfterInNm(stem, /(?<!\b(?:threshold|cut[- ]?off|maximum|longest)(?:\s+(?!(?:and|or|but|while|whereas)\b)[a-z-]+){0,4}\s+)(?:\bwavelength(?!\s+(?:threshold|cut[- ]?off|maximum|longest))(?: of| is| =)?|(?:λ|lambda)\s*=)/), "stem");
      const photon = readEnergyAfterInEv(stem, /photon energy(?: of| is| =)?|energy of (?:the |a )?photon(?: is| of| =)?|(?:hν|hv|hf)\s*=/);
      setSlot(bag, "photonEnergy", photon.value, "stem");
      // Distinguish contradictory source values from an absent photon energy:
      // an independent wavelength cannot silently settle the contradiction.
      setSlot(bag, "photonEnergyUnresolved", photon.conflicting ? "conflicting" : null, "stem");
    },
  },
  {
    id: "bohr_transition",
    cues: [[/\b(?:bohr|hydrogen atom|energy levels?|transition|lyman|balmer|paschen|excited state|ground state)\b/i, 4], [/\bn\s*=\s*[1-7]\b(?!\.)/, 2]],
    vetoes: [/\b(?:photoelectric|work function|stopping potential|de broglie|x-ray|radioactiv|half-life|binding energy)\b/i],
    extract: (stem, plan, bag) => {
      const relation = levelRelationSource(stem);
      setSlot(bag, "from", relation?.from ?? null, "stem");
      setSlot(bag, "to", relation?.to ?? null, "stem");
      void plan;
    },
  },
  {
    id: "pv_cycle",
    cues: [
      [/\b(?:P[-–]?V (?:diagram|graph|curve|cycle)|indicator diagram|pressure[- ]volume)\b/i, 4],
      [/\b(?:isothermal|isobaric|isochoric|adiabatic|isovolumetric)\b/i, 2],
      [/\b(?:cycle|cyclic process|carnot|engine)\b/i, 2],
      [/\bideal gas\b/i, 1],
    ],
    minScore: 4,
    extract: (stem, _plan, bag) => {
      setSlot(bag, "processes", stem, "stem");
    },
  },
  {
    id: "wave_profile",
    cues: [
      [/\b(?:transverse|progressive|travelling|traveling|harmonic|sinusoidal) waves?\b/i, 4],
      [/\bwave motion\b|\bwaves? on a string\b|\btypes of waves\b/i, 3],
      [/\by\s*=\s*[^,.;]*sin/i, 3, "wave equation"],
      [/\b(?:wavelength|amplitude|crest|trough)\b/i, 1],
    ],
    vetoes: [/\b(?:standing|stationary) waves?|node|antinode|harmonic\b|organ pipe|string fixed/i],
    minScore: 4,
    extract: (stem, plan, bag) => {
      setSlot(bag, "amplitude", planNumber(plan, ["a", "amplitude"]), "plan");
      setSlot(bag, "amplitude", numberAfter(stem, /amplitude(?: of| is| =)?/, /cm|m|mm/), "stem");
      setSlot(bag, "wavelength", planNumber(plan, ["lambda", "wavelength"]), "plan");
      setSlot(bag, "wavelength", numberAfter(stem, /wavelength(?: of| is| =)?/, /cm|m|mm/), "stem");
      const equation = /y\s*=\s*([^,;]*?(?:sin|cos)\s*\(?[^,;)]*\)?)/i.exec(prepareStem(stem))?.[1] ?? null;
      setSlot(bag, "expression", equation, "stem");
    },
  },
  {
    id: "standing_wave",
    cues: [[/\b(?:standing|stationary) waves?\b/i, 5], [/\b(?:node|antinode|harmonic|overtone|organ pipes?|fundamental|resonance tube|closed pipe|open pipe)\b/i, 2], [/\b(?:string|pipe|tube)\b[^.]{0,30}\b(?:fixed|closed|open)\b/i, 2]],
    vetoes: [/\bsimple harmonic\b|\bSHM\b/i],
    extract: (stem, _plan, bag) => {
      const closed = /\b(?:closed (?:organ )?pipes?|closed at one end|one end (?:is )?closed|closed end)\b/i.test(stem);
      const open = /\b(?:open (?:organ )?pipes?|open at both ends|both ends (?:are )?open)\b/i.test(stem);
      const pipe = /\b(?:pipes?|tubes?)\b/i.test(stem);
      const bothClosed = /\b(?:(?:both|two) ends (?:are )?closed|closed at (?:both|two) ends)\b/i.test(stem);
      const ends = bothClosed || (closed && open) ? "unknown" : closed ? "closed_open" : open ? "open" : pipe ? "unknown" : "fixed";
      const namedNumbers: Record<string, number> = {
        first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      const ordinals = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th)";
      const separator = "[\\s\\u2010-\\u2015-]+";
      // A suffix of "1/2", "2^3", or "2 + 3" is not an independent mode number.
      const modeTokenStart = "(?<![\\w.−-])(?<![+/*^×÷⁄·⋅∙∗∕−-]\\s*)(?<!\\bx\\s+)\\b";
      const harmonics: number[] = [];
      // Consume every understood specification; an unread or conflicting one is
      // a requested physical state, never permission to use a display default.
      // Unwrap only a complete named-mode explanation. Its value still joins
      // the conflict check; numeric/algebraic parentheses remain expressions.
      let remaining = stem.replace(new RegExp(`\\(\\s*(?:the\\s+)?((?:${ordinals})${separator}(?:harmonic|mode|overtone))\\s*\\)`, "gi"), " $1 ");
      remaining = remaining.replace(new RegExp(`${modeTokenStart}(${ordinals})${separator}(harmonic|mode|overtone)\\b`, "gi"), (_match, ordinal: string, kind: string) => {
        const value = namedNumbers[ordinal.toLowerCase()] ?? Number.parseInt(ordinal, 10);
        const role = kind.toLowerCase();
        harmonics.push(role === "overtone" ? (closed ? 2 * value + 1 : value + 1)
          : role === "mode" && closed ? 2 * value - 1 : value);
        return "";
      });
      // Consume a complete integer only; Unicode operators and superscripts
      // must leave the requested expression unresolved, not select its prefix.
      remaining = remaining.replace(/\bn\s*=\s*(\d+)\b(?!\.\d|\s*(?:[\p{Sm}\p{N}/*^⁄·(-]|\bx\b))/giu, (_match, value: string) => {
        harmonics.push(Number(value));
        return "";
      });
      remaining = remaining.replace(new RegExp(`${modeTokenStart}(one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+loops?\\b`, "gi"), (match, value: string) => {
        if (ends !== "fixed") return match; // A pipe's half-loop is not a string loop.
        harmonics.push(namedNumbers[value.toLowerCase()] ?? Number(value));
        return "";
      });
      // Giving the fundamental frequency does not select the displayed mode.
      remaining = remaining.replace(/\bfundamental\s+frequency\b/gi, "");
      remaining = remaining.replace(/\bfundamental(?:\s+(?:harmonic|mode))?\b/gi, () => { harmonics.push(1); return ""; });
      // A leftover mode word cancels a read mode only when it carries its own
      // number: an ordinal or count ("third and fourth harmonics"), a trailing
      // index ("mode 3"), a relative step ("the next harmonic"), or an unread
      // "n =". A back reference ("in that mode") or a topic word ("harmonics")
      // names the mode already read. With nothing read, any mode word stays
      // unread rather than defaulting to the fundamental.
      const modeWord = "(?:harmonics?|overtones?|modes?|loops?)";
      const counted = `(?:${ordinals}|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)`;
      const numberedMode = new RegExp([
        `\\b${counted}(?:\\s*(?:,|&|\\band\\b|\\bor\\b|\\bto\\b)\\s*(?:the\\s+)?${counted})*${separator}${modeWord}\\b`,
        `\\b${modeWord}\\s*(?:(?:number|no\\.?|index|order|#)\\s*)?(?:of\\s+order\\s*)?[:=]?\\s*\\d+\\b(?!\\s*(?:\\.\\d|[\\p{L}µ°%]))`,
        `\\b${modeWord}\\s*[:=]?\\s*[jkmnp]\\b`,
        // Relative and indefinite phrases introduce another mode, not this one.
        `\\b(?:next|higher|lower|highest|lowest|successive|consecutive|subsequent|following|previous|preceding|adjacent|another|other|a|an|some|any|several|various|all)\\s+(?:[\\p{L}-]+\\s+)?${modeWord}\\b`,
      ].join("|"), "iu");
      const unresolved = /\bn\s*=/i.test(remaining)
        || numberedMode.test(remaining)
        || (harmonics.length === 0 && new RegExp(`\\b${modeWord}\\b`, "i").test(remaining))
        || new Set(harmonics).size > 1;
      setSlot(bag, "harmonic", unresolved ? null : harmonics[0] ?? null, "stem");
      setSlot(bag, "harmonicUnresolved", unresolved ? "unread" : null, "stem");
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "ends", ends, "stem");
    },
  },
  {
    id: "tangent_to_curve",
    cues: [[/\btangent\b/i, 3], [/\b(?:normal to the curve|slope of the (?:tangent|curve))\b/i, 2], [/\b(?:y|f\s*\(\s*x\s*\))\s*=/i, 2], [/\bat (?:the point )?(?:where )?x\s*=/i, 2]],
    vetoes: [/\bcircle\b/i, /\bparabola|ellipse|hyperbola\b/i, /\bx\s*=\s*[^,;]*\bt\b/i],
    minScore: 5,
    extract: (stem, _plan, bag) => {
      setSlot(bag, "expression", explicitFunctions(stem)[0] ?? null, "stem");
      setSlot(bag, "x0", pointOfInterestX(stem), "stem");
    },
  },
  {
    id: "area_between_curves",
    cues: [[/\barea\b/i, 3], [/\b(?:bounded by|enclosed by|between the curves?|region)\b/i, 3], [/\b(?:y|f\s*\(\s*x\s*\))\s*=/i, 1]],
    minScore: 6,
    extract: (stem, _plan, bag) => {
      setSlot(bag, "expressions", explicitFunctions(stem), "stem");
      const interval = xInterval(stem);
      if (interval) { setSlot(bag, "xMin", interval[0], "stem"); setSlot(bag, "xMax", interval[1], "stem"); }
    },
  },
  {
    id: "function_graph",
    cues: [[/\b(?:sketch|plot|draw|graph)\b/i, 2], [/\b(?:y|f\s*\(\s*x\s*\))\s*=/i, 3], [/\b(?:maximum|minimum|extrem|increasing|decreasing|rolle|mean value)\b/i, 1]],
    vetoes: [/\btangent\b/i, /\barea\b/i, /\bparabola|ellipse|hyperbola|circle\b/i, /\b(?:wave|sin\s*\()\b/i, /\bx\s*=\s*[^,;]*\bt\b/i],
    minScore: 4,
    extract: (stem, _plan, bag) => {
      setSlot(bag, "expressions", explicitFunctions(stem), "stem");
      const interval = xInterval(stem);
      if (interval) { setSlot(bag, "xMin", interval[0], "stem"); setSlot(bag, "xMax", interval[1], "stem"); }
    },
  },
  {
    id: "conic",
    cues: [[/\b(?:parabola|ellipse|hyperbola)\b/i, 4], [/\b(?:focus|foci|directrix|latus rectum|eccentricity|vertex|vertices)\b/i, 2]],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "kind", /\bparabola\b/i.test(stem) ? "parabola" : /\bellipse\b/i.test(stem) ? "ellipse" : "hyperbola", "stem");
      const equation = /((?:x|y)\s*\^?2?[^,;]*=\s*[^,;]+)/i.exec(prepareStem(stem))?.[1] ?? null;
      setSlot(bag, "equation", equation, "stem");
    },
  },
  {
    id: "circle_and_point",
    cues: [[/\bcircle\b/i, 3], [/\bx\s*\^?2\s*\+\s*y\s*\^?2/i, 3, "circle equation"], [/\b(?:tangent|chord|centre|center|radius)\b/i, 1], [/\bfrom the point\b/i, 1]],
    vetoes: [/\b(?:charge|current|orbit|satellite|magnetic|whirl|pendulum|road|track|coil)\b/i],
    minScore: 5,
    extract: (stem, _plan, bag) => {
      const prepared = prepareStem(stem);
      const general = /x\^2\s*\+\s*y\^2\s*([+-]\s*\d+(?:\.\d+)?\s*x)?\s*([+-]\s*\d+(?:\.\d+)?\s*y)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(prepared);
      if (general) {
        const g = general[1] ? Number(general[1].replace(/\s+/g, "").replace(/x$/, "")) / 2 : 0;
        const f = general[2] ? Number(general[2].replace(/\s+/g, "").replace(/y$/, "")) / 2 : 0;
        const c = (general[3] ? Number(general[3].replace(/\s+/g, "")) : 0) - Number(general[4]);
        const radiusSquared = g * g + f * f - c;
        if (radiusSquared > 0) {
          setSlot(bag, "cx", -g, "stem");
          setSlot(bag, "cy", -f, "stem");
          setSlot(bag, "r", Math.sqrt(radiusSquared), "stem");
        }
      }
      const tuples = coordinateTuples(stem).filter((tuple) => tuple.length === 2);
      if (tuples[0]) { setSlot(bag, "px", tuples[0][0]!, "stem"); setSlot(bag, "py", tuples[0][1]!, "stem"); }
    },
  },
  {
    id: "triangle_sides",
    cues: [[/\btriangle\b/i, 3], [/\b(?:AB|BC|CA|AC)\s*=\s*\d/i, 3, "named sides"], [/\bsides\b[^.]{0,20}\b\d/i, 2], [/\b(?:area|circumcircle|incircle|centroid|orthocentre|median|altitude)\b/i, 1]],
    vetoes: [/\b(?:forces|vectors|velocity|law of triangle)\b/i, /\bequilateral triangle[^.]{0,60}(?:increas|rate)/i],
    minScore: 5,
    extract: (stem, _plan, bag) => {
      const named = [...stem.matchAll(/\b(AB|BC|CA|AC)\s*=\s*(\d+(?:\.\d+)?)/gi)];
      const sides: Record<string, number> = {};
      for (const match of named) sides[match[1]!.toUpperCase()] = Number(match[2]);
      const bare = named.length ? [] : [...stem.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:cm|m|units?)?\b/gi)].map((match) => Number(match[1])).slice(0, 3);
      setSlot(bag, "c", sides.AB ?? bare[0] ?? null, "stem");
      setSlot(bag, "a", sides.BC ?? bare[1] ?? null, "stem");
      setSlot(bag, "b", sides.CA ?? sides.AC ?? bare[2] ?? null, "stem");
    },
  },
  {
    id: "space_point_plane",
    cues: [[/\bplane\b[^.]{0,40}\b(?:x|y|z)\b/i, 3], [/\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\)/, 3, "3D point"], [/\b(?:distance of the point|foot of the perpendicular|image of the point)\b/i, 2]],
    vetoes: [/\bskew|shortest distance between (?:the )?lines\b/i, /\binclined plane\b/i],
    minScore: 6,
    extract: (stem, _plan, bag) => {
      const prepared = prepareStem(stem);
      const point = coordinateTuples(stem).find((tuple) => tuple.length === 3) ?? null;
      setSlot(bag, "point", point, "stem");
      const plane = /(-?\d*)\s*x\s*([+-]\s*\d*)\s*y\s*([+-]\s*\d*)\s*z\s*([+-]\s*\d+(?:\.\d+)?)?\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(prepared);
      if (plane) {
        const coefficient = (raw: string | undefined): number => {
          const cleaned = (raw ?? "").replace(/\s+/g, "");
          if (cleaned === "" || cleaned === "+") return 1;
          if (cleaned === "-") return -1;
          return Number(cleaned);
        };
        const constant = plane[4] ? Number(plane[4].replace(/\s+/g, "")) : 0;
        setSlot(bag, "plane", [coefficient(plane[1]), coefficient(plane[2]), coefficient(plane[3]), Number(plane[5]) - constant], "stem");
      }
    },
  },
  {
    id: "space_lines",
    cues: [[/\b(?:skew lines|shortest distance between (?:the )?(?:two )?lines|angle between (?:the )?lines)\b/i, 5], [/\b(?:vector equation|direction ratios|direction cosines)\b/i, 2]],
    extract: () => undefined,
  },
  // Topic figures
  {
    id: "shm_energy",
    cues: [[/\b(?:kinetic|potential|total) energ(?:y|ies)\b[^.]{0,60}\bsimple harmonic\b|\bsimple harmonic\b[^.]{0,60}\benerg(?:y|ies)\b|\benergy in shm\b/i, 5]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "amplitude", planNumber(plan, ["a", "amplitude"]), "plan");
      setSlot(bag, "amplitude", numberAfter(stem, /amplitude(?: of| is| =)?/, /cm|m|mm/), "stem");
      setSlot(bag, "k", planNumber(plan, ["k", "forceconstant", "springconstant"]), "plan");
    },
  },
  {
    id: "shm_superposition",
    cues: [[/\bsuperposition\b[^.]{0,60}\b(?:simple harmonic|shm)/i, 5], [/\btwo (?:simple harmonic motions|shms?)\b/i, 4]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "phase", planNumber(plan, ["phi", "phase", "phasedifference"]), "plan");
      setSlot(bag, "phase", firstAngle(stem), "stem");
    },
  },
  {
    id: "wave_types",
    cues: [[/\b(?:longitudinal and transverse|transverse and longitudinal)\b/i, 5], [/\btypes of waves?\b|\bwave motion\b/i, 3], [/\blongitudinal waves?\b/i, 3]],
    vetoes: [/\by\s*=\s*[^,.;]*sin/i, /\bstanding|stationary\b/i],
    extract: () => undefined,
  },
  {
    id: "force_on_conductor",
    cues: [[/\bforce on (?:a |the )?(?:straight )?current[- ]carrying (?:conductor|wire)\b/i, 5], [/\b(?:conductor|wire)\b[^.]{0,40}\buniform magnetic field\b/i, 3], [/\bBIL\b|\bIlB\b/i, 3]],
    vetoes: [/\b(?:two|parallel) (?:long |straight |current[- ]carrying )*(?:wires|conductors)\b/i, /\bloop\b|\bcoil\b/i, /\bmoves|moving|velocity|emf\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "length", planNumber(plan, ["l", "length"]), "plan");
      setSlot(bag, "length", firstNumberWithUnit(stem, UNIT.metre), "stem");
      setSlot(bag, "current", firstNumberWithUnit(stem, UNIT.ampere), "stem");
      setSlot(bag, "B", firstNumberWithUnit(stem, UNIT.tesla), "stem");
    },
  },
  {
    id: "current_loop_torque",
    cues: [[/\b(?:current[- ]carrying |rectangular |circular )?(?:loop|coil)\b[^.]{0,60}\b(?:torque|uniform magnetic field|magnetic field)\b/i, 4], [/\btorque\b[^.]{0,40}\b(?:loop|coil)\b/i, 4], [/\bmoving coil galvanometer\b/i, 3]],
    vetoes: [/\bsolenoid\b|\btoroid\b/i, /\binduc/i, /\bbar magnet\b|\bmagnetic dipole\b/i],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "current", firstNumberWithUnit(stem, UNIT.ampere), "stem");
      setSlot(bag, "B", firstNumberWithUnit(stem, UNIT.tesla), "stem");
    },
  },
  {
    id: "revolving_charge",
    cues: [[/\b(?:revolving|orbiting|circulating) (?:charge|electron)\b/i, 5], [/\bmagnetic moment\b[^.]{0,40}\b(?:electron|charge|orbit)\b/i, 4], [/\bbohr magneton\b/i, 3]],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "radius", firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "bar_magnet",
    cues: [[/\bbar magnet\b/i, 4], [/\bmagnetic (?:field )?lines?\b/i, 2], [/\bmagnetic dipole\b[^.]{0,40}\b(?:axis|axial|equatorial|field (?:due to|at))\b/i, 3], [/\b(?:axial|equatorial) (?:line|point|field)\b/i, 2]],
    vetoes: [/\buniform (?:magnetic )?field\b|\btorque\b|\bpotential energy\b/i],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "d", firstNumberWithUnit(stem, UNIT.centimetre) ?? firstNumberWithUnit(stem, UNIT.metre), "stem");
    },
  },
  {
    id: "bar_magnet_in_field",
    cues: [[/\b(?:magnetic dipole|bar magnet)\b[^.]{0,60}\buniform (?:magnetic )?field\b/i, 5], [/\btorque on (?:a )?(?:magnetic dipole|bar magnet)\b/i, 5], [/\b(?:magnetic dipole|bar magnet)\b[^.]{0,40}\btorque\b/i, 4]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "theta", planNumber(plan, ["theta", "angle"]), "plan");
      setSlot(bag, "theta", firstAngle(stem), "stem");
    },
  },
  {
    id: "faraday_induction",
    cues: [[/\bfaraday\b/i, 4], [/\belectromagnetic induction\b/i, 4], [/\b(?:magnet|coil)\b[^.]{0,40}\b(?:moved|moving|pushed|pulled|brought|withdrawn)\b/i, 3], [/\binduced (?:current|emf)\b/i, 2], [/\blenz\b/i, 2]],
    vetoes: [/\bself[- ]?inductance\b|\bmutual[- ]?inductance\b/i, /\bmotional emf\b/i, /\btransformer\b/i],
    extract: () => undefined,
  },
  {
    id: "inductance_coils",
    cues: [[/\bself[- ]?inductance\b/i, 5], [/\bmutual[- ]?inductance\b/i, 5], [/\binductor\b|\bcoil\b/i, 1]],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "kind", /\bmutual\b/i.test(stem) ? "mutual" : "self", "stem");
    },
  },
  {
    id: "radioactive_decay",
    cues: [[/\bradioactiv/i, 4], [/\bhalf[- ]life\b/i, 3], [/\bdecay (?:law|constant|curve)\b|\bactivity\b/i, 2]],
    vetoes: [/\bbinding energy|mass defect|fission|fusion\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "halfLife", planNumber(plan, ["t", "thalf", "halflife", "t12"]), "plan");
      setSlot(bag, "halfLife", numberAfter(stem, /half[- ]life(?: of| is| =)?/, /s|min(?:utes?)?|h(?:ours?)?|days?|years?|yr/), "stem");
    },
  },
  {
    id: "cooling_curve",
    cues: [[/\b(?:newton'?s )?law of cooling\b/i, 5], [/\bcools? (?:from|to)\b/i, 3], [/\bsurroundings?\b|\bambient\b|\broom temperature\b/i, 1]],
    extract: (stem, plan, bag) => {
      const temperatures = [...stem.matchAll(/(\d+(?:\.\d+)?)\s*(?:°\s*C|degrees? celsius|deg ?C|°)/gi)].map((match) => Number(match[1]));
      setSlot(bag, "initial", planNumber(plan, ["t0", "t1", "initialtemperature"]), "plan");
      setSlot(bag, "ambient", planNumber(plan, ["ts", "tsurr", "ambient", "roomtemperature"]), "plan");
      setSlot(bag, "initial", temperatures[0] ?? null, "stem");
      setSlot(bag, "ambient", temperatures.length >= 2 ? Math.min(...temperatures) : null, "stem");
    },
  },
  {
    id: "logic_gates",
    cues: [[/\blogic gates?\b/i, 5], [/\b(?:NAND|NOR|XOR)\b/, 4], [/\b(?:AND|OR|NOT) gate\b/, 4], [/\btruth table\b/i, 2], [/\buniversal gates?\b/i, 3]],
    extract: (stem, _plan, bag) => {
      const gates = [...stem.matchAll(/\b(NAND|NOR|XOR|XNOR|AND|OR|NOT)\b/g)].map((match) => match[1]!.toUpperCase());
      setSlot(bag, "gates", gates.length ? [...new Set(gates)].join(",") : "AND,OR,NOT,NAND,NOR", "stem");
    },
  },
  {
    id: "centre_of_mass",
    cues: [[/\b(?:centre|center) of mass\b/i, 5], [/\b(?:two|three) (?:particles|masses|bodies)\b/i, 1]],
    vetoes: [/\brod\b[^.]{0,40}\bhinge/i, /\bcollid|collision\b/i],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "masses", massesOf(stem), "stem");
      const positions = [...stem.matchAll(/(?:at|x\s*=)\s*(-?\d+(?:\.\d+)?)\s*m\b/gi)].map((match) => Number(match[1]));
      setSlot(bag, "positions", positions.length >= 2 ? positions : null, "stem");
    },
  },
  {
    id: "escape_velocity",
    cues: [[/\bescape (?:velocity|speed)\b/i, 5], [/\bescap(?:e|es|ing) (?:from )?(?:the )?(?:earth|planet|gravitational)\b/i, 3]],
    vetoes: [/\bsatellite\b|\borbit\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "planetRadius", planNumber(plan, ["r", "re", "radius"]), "plan");
      setSlot(bag, "planetRadius", numberAfter(stem, /radius(?: of (?:the )?(?:earth|planet))?(?: is| =)?/, UNIT.kilometre), "stem");
    },
  },
  {
    id: "magnetic_susceptibility",
    cues: [[/\b(?:para|dia|ferro)[- ]?magneti/i, 4], [/\bcurie\b|\bsusceptibility\b/i, 3], [/\bmagnetic (?:materials|properties|substances)\b/i, 2], [/\beffect of temperature\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "curieTemperature", planNumber(plan, ["tc", "curietemperature"]), "plan");
      setSlot(bag, "curieTemperature", numberAfter(stem, /curie (?:temperature|point)(?: of| is| =)?/, /K\b|°C/), "stem");
    },
  },
  {
    id: "binding_energy_curve",
    cues: [[/\bbinding energy\b/i, 4], [/\bmass defect\b|\bmass[- ]energy\b/i, 4], [/\bper nucleon\b/i, 2], [/\bnucleon|nuclear|nucleus|nuclei\b/i, 1]],
    vetoes: [/\bradioactiv|half[- ]life|decay\b/i],
    extract: (stem, _plan, bag) => {
      const mass = /\b(?:A|mass number)\s*=\s*(\d{1,3})\b/.exec(stem);
      setSlot(bag, "massNumber", mass ? Number(mass[1]) : null, "stem");
    },
  },
  {
    id: "vernier_calliper",
    cues: [[/\bvernier\b/i, 5], [/\bcallipers?\b|\bcalipers?\b/i, 2], [/\bleast count\b|\bzero error\b|\bmain scale\b/i, 1]],
    vetoes: [/\bscrew gauge\b|\bmicrometer\b/i],
    extract: (stem, plan, bag) => {
      setSlot(bag, "mainScaleReading", planNumber(plan, ["msr", "mainscalereading"]), "plan");
      setSlot(bag, "vernierDivision", planNumber(plan, ["vsd", "vernierdivision", "vernierscaledivision"]), "plan");
      const mainCm = lengthAfterInCm(stem, /main scale reading(?: is| of| =)?/);
      setSlot(bag, "mainScaleReading", mainCm === null ? null : 10 * mainCm, "stem");
      const lcCm = lengthAfterInCm(stem, /least count(?: is| of| =)?|LC\s*=/);
      setSlot(bag, "leastCount", lcCm === null ? null : 10 * lcCm, "stem");
      const ordinal = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:vernier|division)/i.exec(stem) ?? /\bvernier (?:scale )?(?:division|reading)\s*(?:is|=|of)?\s*(\d{1,2})\b/i.exec(stem) ?? /\bVSD\s*(?:is|=)?\s*(\d{1,2})\b/.exec(stem);
      setSlot(bag, "vernierDivision", ordinal ? Number(ordinal[1]) : null, "stem");
      setSlot(bag, "zeroError", /\bzero error\b/i.test(stem) ? (/\bnegative\b/i.test(stem) ? "negative" : "positive") : "none", "stem");
    },
  },
  {
    id: "screw_gauge",
    cues: [[/\bscrew gauge\b|\bmicrometer(?: screw gauge)?\b/i, 5], [/\bpitch\b|\bcircular scale\b|\bthimble\b|\bleast count\b/i, 1]],
    extract: (stem, plan, bag) => {
      setSlot(bag, "pitch", planNumber(plan, ["pitch", "p"]), "plan");
      const pitchCm = lengthAfterInCm(stem, /pitch(?: of the screw)?(?: is| of| =)?/);
      setSlot(bag, "pitch", pitchCm === null ? null : 10 * pitchCm, "stem");
      setSlot(bag, "divisions", planNumber(plan, ["n", "divisions", "circularscaledivisions"]), "plan");
      setSlot(bag, "divisions", numberBefore(stem, /(?:divisions|circular scale divisions)/), "stem");
      setSlot(bag, "zeroError", /\bzero error\b/i.test(stem) ? (/\bnegative\b/i.test(stem) ? "negative" : "positive") : "none", "stem");
    },
  },
  {
    id: "velocity_selector",
    cues: [[/\bvelocity selector\b/i, 5], [/\bcrossed (?:electric and magnetic )?fields?\b/i, 4], [/\bundeflected\b|\bundeviated\b/i, 3]],
    extract: (stem, _plan, bag) => {
      setSlot(bag, "B", firstNumberWithUnit(stem, UNIT.tesla), "stem");
      setSlot(bag, "E", numberAfter(stem, /electric field(?: of| is| =)?/, /N\s*\/\s*C|V\s*\/\s*m/), "stem");
    },
  },
];

const CUE_SET_BY_ID: ReadonlyMap<ArchetypeId, CueSet> = new Map(CUE_SETS.map((set) => [set.id, set]));

/* ------------------------------------------------------------------------- */
/* Structure hints                                                            */
/* ------------------------------------------------------------------------- */

const LAW_HINTS: ReadonlyArray<readonly [RegExp, readonly ArchetypeId[], number]> = [
  [/projectile/i, ["projectile"], 3],
  [/snell|refraction/i, ["plane_refraction", "prism", "spherical_refraction"], 2],
  [/mirror/i, ["spherical_mirror"], 3],
  [/lens.?maker/i, ["lens_maker"], 5],
  [/lens/i, ["thin_lens", "lens_maker"], 3],
  [/spherical.?refraction|spherical (?:air|surface|interface)/i, ["spherical_refraction"], 4],
  [/kirchhoff|kvl|kcl/i, ["two_loop_network"], 3],
  [/wheatstone/i, ["wheatstone_bridge"], 3],
  [/ohm|series|parallel/i, ["resistor_network"], 1],
  [/coulomb/i, ["two_point_charges"], 2],
  [/biot|ampere/i, ["straight_wire_field", "solenoid_field"], 1],
  [/lorentz/i, ["charge_in_magnetic_field"], 2],
  [/faraday|motional/i, ["motional_emf_rod"], 2],
  [/photoelectric|einstein/i, ["photoelectric"], 3],
  [/bohr/i, ["bohr_transition"], 3],
  [/hooke|shm|harmonic/i, ["spring_mass"], 1],
  [/friction|newton/i, ["incline_body", "blocks_contact"], 1],
  [/torque/i, ["hinged_rod"], 1],
  [/kepler|orbital|gravitation/i, ["satellite_orbit"], 2],
  [/young|interference/i, ["double_slit"], 3],
  [/diffraction/i, ["single_slit"], 2],
  [/first.?law|thermodynamic|isothermal|adiabatic/i, ["pv_cycle"], 2],
  [/relative/i, ["relative_motion_line", "river_boat"], 1],
];

const INTENT_HINTS: Readonly<Record<string, readonly ArchetypeId[]>> = {
  network: ["resistor_network", "two_loop_network", "wheatstone_bridge", "meter_bridge", "capacitor_network"],
  free_body: ["incline_body", "atwood", "blocks_contact", "lift_body", "pulley_incline"],
  field: ["two_point_charges", "straight_wire_field", "charge_in_magnetic_field", "solenoid_field", "dipole_in_field"],
  graph: ["vt_graph", "xt_graph", "fx_graph_area", "function_graph"],
  bounded_region: ["area_between_curves"],
};

function structureBonus(hints: DetectionHints | undefined): Map<ArchetypeId, { score: number; evidence: string }> {
  const bonus = new Map<ArchetypeId, { score: number; evidence: string }>();
  const add = (id: ArchetypeId, score: number, evidence: string): void => {
    const current = bonus.get(id);
    bonus.set(id, { score: (current?.score ?? 0) + score, evidence: current ? `${current.evidence}; ${evidence}` : evidence });
  };
  const plan = hints?.turnPlan;
  if (plan && typeof plan === "object" && Array.isArray((plan as { lawIds?: unknown }).lawIds)) {
    const lawText = ((plan as { lawIds: unknown[] }).lawIds).map(String).join(" ");
    for (const [pattern, ids, score] of LAW_HINTS) {
      if (!pattern.test(lawText)) continue;
      for (const id of ids) add(id, score, `law:${pattern.source}`);
    }
  }
  for (const intent of hints?.problemIR?.representationIntents ?? []) {
    for (const id of INTENT_HINTS[intent.kind ?? ""] ?? []) add(id, 1, `intent:${intent.kind}`);
  }
  return bonus;
}

/* ------------------------------------------------------------------------- */
/* Detection                                                                  */
/* ------------------------------------------------------------------------- */

interface Scored {
  set: CueSet;
  score: number;
  strongest: number;
  evidence: string[];
}

function scoreCueSet(set: CueSet, stem: string, bonus: Map<ArchetypeId, { score: number; evidence: string }>): Scored | null {
  if (set.vetoes?.some((veto) => veto.test(stem))) return null;
  if (set.requires?.some((requirement) => !requirement.test(stem))) return null;
  let score = 0;
  let strongest = 0;
  const evidence: string[] = [];
  for (const [pattern, weight, name] of set.cues) {
    if (!pattern.test(stem)) continue;
    score += weight;
    strongest = Math.max(strongest, weight);
    evidence.push(name ?? pattern.source.slice(0, 32));
  }
  const structural = bonus.get(set.id);
  if (structural) {
    score += structural.score;
    evidence.push(structural.evidence);
  }
  if (score <= 0) return null;
  return { set, score, strongest, evidence };
}

function fillSlots(set: CueSet, stem: string, plan: readonly PlanQuantity[]): SlotBag {
  const bag = emptyBag();
  set.extract?.(stem, plan, bag);
  return bag;
}

function requiredSlotsPresent(id: ArchetypeId, bag: SlotBag): boolean {
  const spec = ARCHETYPES[id];
  return Object.entries(spec.slots).every(([key, slot]) => !slot.required || bag.values[key] !== undefined);
}

/**
 * True when the archetype main's scoring would pick (law and intent bonuses
 * counted alone) has no cue in the stem. Such a stem was matched only through
 * its plan's laws; refusing that match must not hand the turn to the next
 * archetype or to a family, which drew a spring for an air bubble and a bare
 * sphere for glass sphere stems. The whole deterministic figure declines; the
 * planner path is unaffected.
 */
export function lawOnlyArchetypeLead(question: string, hints?: DetectionHints): boolean {
  const stem = prepareStem(question);
  if (!stem) return false;
  const plan = collectPlanQuantities(hints?.turnPlan);
  const bonus = structureBonus(hints);
  if (bonus.size === 0) return false;
  const scored = CUE_SETS
    .map((set) => scoreCueSet(set, stem, bonus))
    .filter((item): item is Scored => item !== null)
    .filter((item) => item.score >= (item.set.minScore ?? 2))
    .sort((a, b) => b.score - a.score || b.strongest - a.strongest);
  for (const [index, candidate] of scored.entries()) {
    if (!requiredSlotsPresent(candidate.set.id, fillSlots(candidate.set, stem, plan))) continue;
    const next = scored[index + 1] ?? null;
    if (next && next.score === candidate.score && candidate.strongest < 4 && next.strongest >= candidate.strongest) return false;
    return candidate.strongest === 0;
  }
  return false;
}

/**
 * Decide the archetype for a question. Returns null when no figure clears the
 * evidence bar — callers then fall back or teach text-only, which is the
 * honest outcome for a stem the catalog does not describe.
 */
export function detectArchetype(question: string, hints?: DetectionHints): ArchetypeMatch | null {
  const stem = prepareStem(question);
  if (!stem) return null;
  const plan = collectPlanQuantities(hints?.turnPlan);
  const bonus = structureBonus(hints);

  if (hints?.plannerArchetype && isArchetypeId(hints.plannerArchetype)) {
    const set = CUE_SET_BY_ID.get(hints.plannerArchetype);
    if (set && !set.vetoes?.some((veto) => veto.test(stem)) && !set.requires?.some((requirement) => !requirement.test(stem))) {
      const bag = fillSlots(set, stem, plan);
      if (requiredSlotsPresent(set.id, bag)) {
        return { id: set.id, slots: bag.values, sources: bag.sources, score: 99, runnerUp: null, evidence: ["planner archetype"] };
      }
    }
  }

  // Fresh source truth can break a lexical tie only for its requested result.
  // Real planner/IR geometry and the ordinary catalog requirements stay prior.
  const radiation = readRadiationSource(question);
  if (bonus.size === 0 && radiation.status === "source" && radiation.model.kind === "photoelectric"
    && requestedPhotoelectricResult(question)) {
    const set = CUE_SET_BY_ID.get("photoelectric");
    const candidate = set ? scoreCueSet(set, stem, bonus) : null;
    if (candidate && candidate.score >= (candidate.set.minScore ?? 2)) {
      const bag = fillSlots(candidate.set, stem, plan);
      if (requiredSlotsPresent(candidate.set.id, bag)) return {
        id: candidate.set.id, slots: bag.values, sources: bag.sources, score: candidate.score,
        runnerUp: null, evidence: [...candidate.evidence, "complete source photoelectric state"],
      };
    }
  }

  // A stem main matched only through its plan's laws matches nothing now,
  // so the refusal never hands the turn to the next archetype.
  if (!hints?.keepLawOnlyLead && lawOnlyArchetypeLead(question, hints)) return null;
  const scored = CUE_SETS
    .map((set) => scoreCueSet(set, stem, bonus))
    .filter((item): item is Scored => item !== null)
    .filter((item) => item.score >= (item.set.minScore ?? 2))
    .sort((a, b) => b.score - a.score || b.strongest - a.strongest);

  for (const [index, candidate] of scored.entries()) {
    const bag = fillSlots(candidate.set, stem, plan);
    if (!requiredSlotsPresent(candidate.set.id, bag)) continue;
    const next = scored[index + 1] ?? null;
    // A tie between weak candidates is ambiguity, not a choice: decline so the
    // caller falls back honestly instead of taking whichever sorted first.
    if (next && next.score === candidate.score && candidate.strongest < 4 && next.strongest >= candidate.strongest) {
      return null;
    }
    return {
      id: candidate.set.id,
      slots: bag.values,
      sources: bag.sources,
      score: candidate.score,
      runnerUp: next ? { id: next.set.id, score: next.score } : null,
      evidence: candidate.evidence,
    };
  }
  return null;
}

/** Every archetype the cues would accept, best first; for gates and debugging. */
export function rankArchetypes(question: string, hints?: DetectionHints): Array<{ id: ArchetypeId; score: number; evidence: string[] }> {
  const stem = prepareStem(question);
  const bonus = structureBonus(hints);
  return CUE_SETS
    .map((set) => scoreCueSet(set, stem, bonus))
    .filter((item): item is Scored => item !== null)
    .sort((a, b) => b.score - a.score || b.strongest - a.strongest)
    .map((item) => ({ id: item.set.id, score: item.score, evidence: item.evidence }));
}
