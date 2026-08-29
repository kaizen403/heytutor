/**
 * What the stem demands of the picture — the "is this figure even about this
 * question?" seam.
 *
 * `synthesizeFromFamilies` commits the first family whose document compiles.
 * That is why a hyperbola stem could ship a horizontal line (the line compiled
 * first) and a solenoid stem could ship two point charges: compiling proves the
 * geometry is valid, never that it is *this* question's geometry.
 *
 * These rules only ever REJECT a candidate. They never select or build a
 * picture, so they are not a coverage mechanism and must not grow into one: a
 * new entry is warranted when a family is observed drawing something the stem
 * contradicts, and the fix of first resort is still to ground the builder.
 * When a rejection leaves no family standing the turn teaches text-only, which
 * is the honest outcome — a wrong figure is worse than none.
 *
 * The English patterns here have the same status as the rest of
 * `familyClassification`: the documented oracle and the no-ProblemIR fallback.
 * `problemIR` is threaded through so structure can supersede them.
 */
import type { SceneDocument } from "../types";
import {
  circuitTopologyFromProblemStructure,
  isPlanarConicStem,
  isRiverBoatProblemIR,
  isRiverBoatStem,
  normalizeStem,
  type ProblemStructureView,
} from "./familyClassification";

/** Observable properties of a compiled document, read from operators and entities. */
export type PictureFeature =
  | "conic"
  | "point_charges"
  | "bohr_levels"
  | "resistor_chain"
  | "river_banks"
  | "slit_pattern"
  | "instrument_train"
  | "curved_surface";

export interface SceneDemand {
  /** Every one of these must be present or the picture is not about the stem. */
  readonly requires: readonly PictureFeature[];
  /** Any one of these contradicts the stem outright. */
  readonly forbids: readonly PictureFeature[];
}

const EMPTY_DEMAND: SceneDemand = { requires: [], forbids: [] };

/**
 * A current-carrying conductor, coil or magnet — sources of a magnetic field,
 * which is not a pair of point charges and not a resistor chain.
 */
const MAGNETIC_SOURCE =
  /(?:solenoid|toroid|bar magnet|circular (?:coil|loop)|biot[- ]?savart|amp[eè]re'?s? (?:circuital )?law|current[- ]carrying (?:coil|loop|wire|conductor)|long straight (?:wire|conductor))/i;

/** Charge language that legitimately calls for the two-charge figure. */
const ELECTROSTATIC_SUBJECT =
  /(?:point charges?|\bcoulomb|dipole moment|electric dipole|charged (?:sphere|shell|ring|rod|particle))/i;

/** Atomic-physics stems that are not about a transition between energy levels. */
const NON_LEVEL_ATOMIC =
  /(?:radioactiv|half.?life|decay constant|mass defect|nuclear (?:fission|fusion)|photo.?electric|stopping potential|work function|de broglie|x-ray)/i;

const LEVEL_SUBJECT =
  /(?:energy level|\bbohr\b|hydrogen atom|transition|\borbit\b|excited state|ground state|lyman|balmer|paschen|binding energy per nucleon)/i;

/** Networks whose whole point is that they are not a series chain. */
const NON_CHAIN_NETWORK =
  /(?:potentiometer|met(?:er|re)\s*bridge|wheatstone|post office box)/i;

/** A capacitor-only combination must not be drawn with resistors. */
const CAPACITOR_NETWORK =
  /(?:capacitors?\b(?=[\s\S]{0,80}(?:in series|in parallel|combination|connected))|equivalent capacitance|effective capacitance)/i;

const INSTRUMENT = /(?:microscope|telescope)/i;

const OPTICS_CURVED_SURFACE =
  /(?:lens maker|thin lens formula|spherical (?:surface|interface|mirror)|refraction at a spherical|(?:convex|concave) (?:lens|mirror))/i;

/** Read the stem (and, when available, the solved structure) for its demands. */
export function sceneDemand(
  question: string,
  problemIR?: ProblemStructureView | null,
): SceneDemand {
  const stem = normalizeStem(question);
  if (!stem) return EMPTY_DEMAND;
  const requires: PictureFeature[] = [];
  const forbids: PictureFeature[] = [];

  // A stem that names a conic must show one. Without this a tangent line, or a
  // constant lifted out of "2x + y = 1", satisfies the compile and wins.
  if (isPlanarConicStem(stem)) requires.push("conic");

  if (isRiverBoatStem(stem)) requires.push("river_banks");

  if (MAGNETIC_SOURCE.test(stem) && !ELECTROSTATIC_SUBJECT.test(stem)) {
    forbids.push("point_charges", "resistor_chain");
  }

  if (NON_LEVEL_ATOMIC.test(stem) && !LEVEL_SUBJECT.test(stem)) {
    forbids.push("bohr_levels");
  }

  if (NON_CHAIN_NETWORK.test(stem)) forbids.push("resistor_chain");

  if (CAPACITOR_NETWORK.test(stem) && !/\bresist/i.test(stem)) {
    forbids.push("resistor_chain");
  }

  if (INSTRUMENT.test(stem) && !/\bslits?\b/i.test(stem)) forbids.push("slit_pattern");

  if (OPTICS_CURVED_SURFACE.test(stem) && !/\b(?:resistor|ohm)\b/i.test(stem)) {
    forbids.push("resistor_chain");
  }

  // Solved structure outranks the English reading. A network the solver found
  // to carry two loops is never a single-path chain, whatever the stem calls
  // it, and a solved river crossing must show its banks.
  const topology = circuitTopologyFromProblemStructure(problemIR);
  if (topology?.twoLoop && !forbids.includes("resistor_chain")) forbids.push("resistor_chain");
  if (isRiverBoatProblemIR(problemIR) && !requires.includes("river_banks")) {
    requires.push("river_banks");
  }
  return { requires, forbids };
}

/**
 * Which features a compiled document exhibits. The bank harness classifies
 * pictures from this same reader so an offline gate cannot drift from the
 * runtime check.
 */
export function pictureFeatures(document: SceneDocument): Set<PictureFeature> {
  const features = new Set<PictureFeature>();
  const operators = new Set(document.constructions.map((construction) => construction.operator));
  const symbols = new Set(
    document.constructions
      .filter((construction) => construction.operator === "symbol")
      .map((construction) => String(construction.inputs.symbol ?? "")),
  );
  const describe = (entity: SceneDocument["entities"][number]): string =>
    `${entity.id} ${entity.role} ${entity.label ?? ""}`;
  const entityText = document.entities.map(describe).join(" | ");

  if (
    operators.has("implicit_curve")
    || operators.has("circle")
    || document.constructions.some((construction) =>
      construction.operator === "function_curve"
      && /x\s*\^\s*2/.test(String(construction.inputs.expression ?? "")))
  ) {
    features.add("conic");
  }

  if (/\bpoint charge\b/i.test(entityText) || /\bcharge q[12]\b/i.test(entityText)) {
    features.add("point_charges");
  }
  if (
    document.entities.filter((entity) => /energy level|\bn\s*=\s*[12]\b/i.test(describe(entity)))
      .length >= 2
  ) {
    features.add("bohr_levels");
  }
  if (symbols.has("resistor") && isSeriesChain(document)) features.add("resistor_chain");
  if (/\bbank\b/i.test(entityText)) features.add("river_banks");
  if (operators.has("aperture") || operators.has("screen_pattern")) features.add("slit_pattern");
  if (operators.has("optical_train")) features.add("instrument_train");
  if (
    operators.has("spherical_surface")
    || operators.has("lens_section")
    || operators.has("arc")
  ) {
    features.add("curved_surface");
  }

  return features;
}


/**
 * A chain is a topology, not a component list: every terminal carries at most
 * two edges, so the current has one path through it. A bridge, a two-loop
 * network or a parallel bundle has junctions of degree three or more and is a
 * different picture entirely — defining this by "contains a resistor" would
 * reject the very networks these stems are asking for.
 *
 * Edges are read the way `topology.ts` reads them, so the two agree.
 */
function isSeriesChain(document: SceneDocument): boolean {
  const degree = new Map<string, number>();
  const terminal = (inputs: Record<string, unknown>, names: string[]): string | null => {
    for (const name of names) {
      const value = inputs[name];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  };
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    const start = terminal(construction.inputs, ["start", "from", "a"]);
    const end = terminal(construction.inputs, ["end", "to", "b"]);
    if (!start || !end || start === end) continue;
    degree.set(start, (degree.get(start) ?? 0) + 1);
    degree.set(end, (degree.get(end) ?? 0) + 1);
  }
  if (degree.size === 0) return false;
  return [...degree.values()].every((count) => count <= 2);
}

/** Null when the picture is about the stem; otherwise why it is not. */
export function demandRejection(
  document: SceneDocument,
  demand: SceneDemand,
): string | null {
  if (demand.requires.length === 0 && demand.forbids.length === 0) return null;
  const features = pictureFeatures(document);
  const missing = demand.requires.filter((feature) => !features.has(feature));
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  const contradicted = demand.forbids.filter((feature) => features.has(feature));
  if (contradicted.length > 0) return `contradicted by ${contradicted.join(", ")}`;
  return null;
}
