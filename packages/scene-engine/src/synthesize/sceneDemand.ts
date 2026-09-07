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
  | "curved_surface"
  | "connected_fluid"
  | "suspended_body"
  | "spring_block";

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
 *
 * Widened after a 342-probe sweep found the two-charge figure committed for the
 * cyclotron, a helical path, force on a moving charge, a current loop as a
 * magnetic dipole and Earth's magnetic elements. None of those named a solenoid,
 * a coil or a "current-carrying" anything, which was all this pattern knew.
 */
const MAGNETIC_SOURCE =
  /(?:solenoid|toroid|bar magnet|circular (?:coil|loop)|current loop|biot[- ]?savart|amp[eè]re'?s? (?:circuital )?law|current[- ]carrying (?:coil|loop|wire|conductor)|long straight (?:wire|conductor)|magnetic (?:field|dipole|element|moment|flux)|cyclotron|helical path|lorentz|moving charge|earth'?s magnetic)/i;

/**
 * Gravitation. The two-charge figure reached "acceleration due to gravity and
 * its variation with altitude" and the same with depth, because nothing
 * downstream reads a gravitational stem as excluding electrostatics.
 */
const GRAVITATIONAL_SUBJECT =
  /(?:gravitational (?:field|force|potential)|acceleration due to gravity|\bgravitation\b|escape velocity|orbital velocity|\bkepler)/i;

/**
 * Charge spread along a line or over a flat surface. It is genuinely
 * electrostatics, so the magnetic veto never applies, and it is still not two
 * dots: a Gauss's law stem for an infinitely long charged wire shipped the
 * two-point-charge picture.
 *
 * A sphere or a shell is deliberately absent. Outside a uniform shell the field
 * really is that of a point charge at the centre, and `verify-family-synthesis`
 * asserts that a numeric "field outside a shell" stem compiles the point field
 * for exactly that reason.
 */
const CONTINUOUS_CHARGE =
  /(?:charged (?:straight )?(?:wire|rod|line|sheet|plate|cylinder)|line charge|linear charge density|surface charge density|charge per unit (?:length|area)|infinite(?:ly long)? (?:line|wire|sheet|plane|cylinder))/i;

/**
 * Charge language that legitimately calls for the two-charge figure.
 *
 * "dipole moment" is guarded against "magnetic dipole moment": a current loop
 * as a magnetic dipole matched the exemption and cancelled its own veto.
 */
const ELECTROSTATIC_SUBJECT =
  /(?:point charges?|\bcoulomb|(?<!magnetic )dipole moment|electric dipole|charged (?:sphere|shell|ring|rod|particle))/i;

/**
 * Atomic-physics stems that are not about a transition between energy levels.
 *
 * The sweep found the Bohr two-level figure committed for fission, fusion,
 * nuclear composition, Q value, Rutherford scattering, Davisson-Germer and the
 * dual nature of radiation.
 */
const NON_LEVEL_ATOMIC =
  /(?:radioactiv|half.?life|decay constant|mass defect|nuclear (?:fission|fusion|reaction)|photo.?electric|stopping potential|work function|de broglie|x-ray|davisson|germer|dual nature|composition (?:and size )?of the nucleus|size of the nucleus|\bq[- ]?value\b|rutherford|alpha[- ]particle scattering|matter[- ]?wave)/i;

/**
 * A level subject strong enough to rescue an otherwise non-level stem.
 *
 * The bare phrase "energy level" is deliberately absent. Every unit 17 and 18
 * probe stem ends with an appended cue that contains it ("Show the n = 1 and
 * n = 2 energy levels"), so treating it as evidence let the cue satisfy the
 * rescue and this veto never fired on any of the ten stems it was written for.
 */
const STRONG_LEVEL_SUBJECT =
  /(?:\bbohr\b|hydrogen (?:atom|spectrum)|spectral series|excited state|ground state|lyman|balmer|paschen|binding energy per nucleon)/i;


/**
 * Elasticity. Two separate documents kept reaching it: the connected-vessel
 * fluid figure, because the fluid family's keyword list is broad, and the
 * Young's double slit rig, because the archetype detector reads "Young" in
 * "Young's modulus" and in the Young-Laplace equation. A stress-strain topic is
 * neither a tank nor a pair of slits.
 */
const ELASTIC_SUBJECT =
  /(?:young'?s modulus|bulk modulus|modulus of rigidity|poisson|stress.?strain|hooke'?s law|elastic (?:behaviour|behavior|limit|moduli)|breaking stress|elongation of a wire)/i;

/**
 * Heat that is not fluid flow. Calorimetry, latent heat, thermal expansion,
 * conduction, radiation and Newton's cooling were all being drawn as two tanks
 * joined by a pipe, and the lessons then narrated a temperature graph that was
 * not on the board.
 */
const THERMAL_SUBJECT =
  /(?:thermal expansion|calorimetry|specific heat|latent heat|change of state|heat transfer|conduction|convection|radiation|newton'?s law of cooling|stefan|thermal conductivity|method of mixtures)/i;

/** Words that mean the picture really is a body of connected fluid. */
const FLUID_APPARATUS_SUBJECT =
  /(?:hydraulic|pascal'?s law|venturi|bernoulli|piston|buoyanc|archimedes|fluid column|equation of continuity|streamline|turbulent|pipe|reservoir|manometer|barometer|vessel)/i;

/**
 * A body on a string or a track, drawn with its weight or its tension. It is a
 * mechanics figure, and the archetype detector was handing it to Biot-Savart
 * because the stem says "circular loop": the lesson then called the velocity
 * arrows "the current arrows v_A and v_B".
 *
 * Either role is enough. The archetype's entity set is not stable enough to key
 * on both, and within the subjects that forbid this feature neither a weight nor
 * a tension belongs on the board at all.
 */
const SUSPENDED_BODY_ROLE = /\b(?:tension|weight|vertical circle)\b/i;

/**
 * An electrical oscillation or an AC circuit. The spring-block document was
 * being drawn for LC oscillations, because the family layer reads "oscillation",
 * and the lesson then taught the whole thing off the spring analogy with the
 * marker on a block and a wall.
 */
const ELECTRICAL_CIRCUIT_SUBJECT =
  /(?:\blc\b\s*oscillation|l-c oscillation|alternating current|\bac circuit|reactance|impedance|\blcr\b|inductance|transformer)/i;

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

  // Gravitation is not electrostatics, whatever the appended drawing cue says.
  if (GRAVITATIONAL_SUBJECT.test(stem) && !ELECTROSTATIC_SUBJECT.test(stem)) {
    if (!forbids.includes("point_charges")) forbids.push("point_charges");
  }

  // A charge spread along a wire or over a shell cannot be drawn as two dots.
  if (CONTINUOUS_CHARGE.test(stem) && !/\bpoint charges?\b/i.test(stem)) {
    if (!forbids.includes("point_charges")) forbids.push("point_charges");
  }

  // A non-level stem is only rescued by a real level subject. The generic
  // phrase "energy levels" arrives in the drawing cue of every one of these
  // stems, so accepting it as evidence disabled the rule completely.
  if (NON_LEVEL_ATOMIC.test(stem) && !STRONG_LEVEL_SUBJECT.test(stem)) {
    forbids.push("bohr_levels");
  }

  if (NON_CHAIN_NETWORK.test(stem)) forbids.push("resistor_chain");

  if (CAPACITOR_NETWORK.test(stem) && !/\bresist/i.test(stem)) {
    forbids.push("resistor_chain");
  }

  if (INSTRUMENT.test(stem) && !/\bslits?\b/i.test(stem)) forbids.push("slit_pattern");

  // An elasticity stem is not a slit rig and not a tank. "Young" is the whole
  // problem: it names the modulus, the Laplace equation and the double slit.
  if (ELASTIC_SUBJECT.test(stem) && !/\bslits?\b|interference|fringe/i.test(stem)) {
    if (!forbids.includes("slit_pattern")) forbids.push("slit_pattern");
    forbids.push("connected_fluid");
  }

  // An LC circuit is not a block on a spring, however alike the mathematics is.
  if (ELECTRICAL_CIRCUIT_SUBJECT.test(stem) && !/\bspring\b/i.test(stem)) {
    forbids.push("spring_block");
  }

  // A field question is not a mass on a string. Nothing in electromagnetism or
  // atomic physics is drawn with a tension and a weight.
  if (
    MAGNETIC_SOURCE.test(stem) ||
    (ELECTROSTATIC_SUBJECT.test(stem) && !/\bpendulum|\bhanging|suspended/i.test(stem)) ||
    NON_LEVEL_ATOMIC.test(stem)
  ) {
    if (!forbids.includes("suspended_body")) forbids.push("suspended_body");
  }

  // Heat that is not flow. The canned two-tank document is not a calorimeter,
  // a bimetallic strip, a conducting rod or a cooling curve.
  if (THERMAL_SUBJECT.test(stem) && !FLUID_APPARATUS_SUBJECT.test(stem)) {
    if (!forbids.includes("connected_fluid")) forbids.push("connected_fluid");
  }

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
  if (document.entities.some((entity) => SUSPENDED_BODY_ROLE.test(entity.role ?? ""))) {
    features.add("suspended_body");
  }
  if (document.entities.some((entity) => /\bspring\b/i.test(entity.role ?? ""))) {
    features.add("spring_block");
  }
  // The connected-vessel document draws two tanks joined by a pipe. The ids are
  // `tank1` and `tank2`, so a trailing word boundary never matches them.
  if (/\btank\d*\b/i.test(entityText) && /\bpipe\b/i.test(entityText)) {
    features.add("connected_fluid");
  }
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
