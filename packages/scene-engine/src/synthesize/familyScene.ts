/**
 * Compile a verified scene from the question, turn plan, and inferred visual
 * family. Geometry comes from operators and plan quantities — never from
 * planner-authored pixels.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { parseMathExpression, parseMathExpression2D } from "../math/expression";
import { evaluateOpticsLaw } from "../physics/opticsLaws";
import {
  applyStemFamilyOverrides,
  inferFamiliesFromQuestion,
  isCircleLocusStem,
  isFigureAbsentStem,
  isCurrentSegmentFieldStem,
  isHangingWiresLoadStem,
  isIvCharacteristicStem,
  isJunctionSpatialStem,
  isNamedVariationPlotStem,
  isParallelPlateStem,
  isPlanarConicStem,
  isRelatedRateCircleStem,
  isRelatedRateSolidStem,
  isRelatedRateTriangleStem,
  isRiverBoatStem,
  isSceneVisualFamily,
  isSemiconductorBandStem,
  isSpaceGeometryStem,
  isTwoLoopNetworkStem,
  familiesFromProblemStructure,
  type ProblemStructureView,
  normalizeStem,
  orderFamiliesByStemPreference,
  riverBoatVariant,
  type SceneVisualFamily,
} from "./familyClassification";
import { demandRejection, sceneDemand } from "./sceneDemand";
import { findStatedCurves, type StatedCurve } from "./statedEquations";
import { metricAssertions } from "../archetypes/contract";
import { synthesizeArchetypeScene } from "../archetypes";
import {
  SCENE_DOCUMENT_VERSION,
  type RenderScene,
  type SceneAnnotation,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type SceneRevealGroup,
  type SceneTeachingAction,
  type ValidationReport,
} from "../types";

export const SYNTHESIZED_REPRESENTATION_TIERS = [
  "exact_verified",
  "qualitative_verified",
  "question_representation",
] as const;

export type SynthesizedRepresentationTier = (typeof SYNTHESIZED_REPRESENTATION_TIERS)[number];

export interface FamilySceneInput {
  question: string;
  turnPlan?: unknown;
  families?: readonly string[];
  /**
   * Solved problem structure. When present it is the live catalog: it orders
   * the families and sharpens the picture demand, so the diagram follows the
   * solve instead of a second English reading of the stem.
   */
  problemIR?: ProblemStructureView | null;
}

export interface SynthesizedFamilyScene {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  tier: SynthesizedRepresentationTier;
  nonMetric: boolean;
  reason: string;
  family: string;
}

const FAMILY_PRIORITY: readonly SceneVisualFamily[] = [
  "instrument_chain",
  "interface",
  "axis_view",
  "ray_path",
  "circuit_network",
  "analytic_curve",
  "bounded_region",
  "state_plot",
  "contact_body",
  "vector_diagram",
  "aperture",
  "screen_pattern",
  "wavefront",
  "polarizer",
  "transverse_field",
  "coordinate_figure",
  "solid_figure",
  "point_field",
  "energy_level",
  "fluid_apparatus",
];

type FamilyBuilder = (
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
) => SceneDocument | null;

interface PlanQuantity {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
  sourceText?: string;
}

export function synthesizeFamilyScene(input: FamilySceneInput): SynthesizedFamilyScene | null {
  return synthesizeFromFamilies(input, false);
}

export function synthesizeLastResortScene(input: FamilySceneInput): SynthesizedFamilyScene | null {
  return synthesizeFromFamilies(input, true);
}

function synthesizeFromFamilies(
  input: FamilySceneInput,
  schematic: boolean,
): SynthesizedFamilyScene | null {
  const question = input.question.trim();
  if (!question) return null;
  // Figure-absent honesty (P0, mirrors verify-bank-family-compile): a stem that
  // refers to a figure we do not have and names no drawable apparatus gets no
  // fake circuit/network ink — the caller degrades to text-only.
  if (figureAbsentWithoutNamedApparatus(normalizeStem(question))) return null;
  // Parameterized archetypes run first: they compute geometry from typed slots
  // and have already faced the same picture demand. They return null for
  // anything they do not own, so the family builders below keep the rest.
  const archetype = synthesizeArchetypeScene({
    question,
    turnPlan: input.turnPlan,
    problemIR: input.problemIR ?? null,
    schematic,
  });
  if (archetype) {
    return {
      document: archetype.document,
      renderScene: archetype.renderScene,
      validationReport: archetype.validationReport,
      tier: archetype.tier,
      nonMetric: archetype.nonMetric,
      reason: archetype.reason,
      family: archetype.family,
    };
  }
  const quantities = collectPlanQuantities(input.turnPlan);
  const families = resolveRequestedFamilies(question, input.families, input.problemIR);
  // What this stem's picture must (and must not) contain, whichever family
  // ends up drawing it.
  const demand = sceneDemand(question, input.problemIR);
  for (const family of families) {
    const builder = FAMILY_BUILDERS[family];
    if (!builder) continue;
    const document = builder(question, quantities, schematic);
    const compiled = document ? tryCompile(document) : null;
    if (!compiled) continue;
    // Compiling proves the geometry is valid, not that it is this question's
    // geometry. A candidate that contradicts the stem loses its turn to the
    // next family; if none survives the caller teaches text-only.
    if (demandRejection(compiled.document, demand)) continue;
    // Tier honesty (P0): exact_verified needs a fatal plan-backed metric
    // assertion (a real refraction angle, a real image-distance ratio) — never
    // `exists`/`label_attached`/topology proofs alone. Display-scale families
    // are qualitative by construction.
    const metricProof = !schematic
      && !familyUsesDisplayScale(family)
      && hasPlanMetricProof(compiled.document);
    const nonMetric = schematic || !metricProof;
    return {
      ...compiled,
      tier: schematic
        ? "question_representation"
        : metricProof ? "exact_verified" : "qualitative_verified",
      nonMetric,
      reason: schematic
        ? `compiled a ${family} schematic after the exact operator program was unavailable`
        : metricProof
          ? `compiled ${family} from the turn plan and reusable operators`
          : `compiled ${family} grounded in the question wording; no plan-backed metric proof, so the geometry is qualitative`,
      family,
    };
  }
  return null;
}

/**
 * `exact_verified` needs a fatal assertion that checks a NUMBER, not a
 * relation that any plausible drawing would satisfy. One definition serves
 * every path (archetypes, family builders, and LLM candidates through
 * `tierForForeignDocument`) so the tiers cannot drift apart.
 *
 * The shared rule is stricter than the four-predicate list it replaced: the
 * assertion must carry a non-boolean `expected`, so `exists`-style proofs and
 * topology predicates can never earn the exact label. It is also wider —
 * `angle_between`, `vector_sum` and `root` are genuine numeric claims, and
 * excluding them meant a figure drawn from the question's own numbers could
 * not be labelled exact even when it was provably right.
 */
function hasPlanMetricProof(document: SceneDocument): boolean {
  return metricAssertions(document).length > 0;
}

/**
 * Apparatus a figure-absent stem must name before any schematic is honest.
 * Mirrors the apparatus list in verify-bank-family-compile.ts so live matches
 * the harness.
 */
const FIGURE_ABSENT_NAMED_APPARATUS =
  /(?:microscope|telescope|met(?:er|re) bridge|wheatstone|metal sheets|conducting walls|horizontal metal plates|parallel[- ]plate|upper wire|lens|mirror|prism|incline|pendulum)/i;

/**
 * Extra figure-reference phrasings beyond isFigureAbsentStem (OCR drops "the",
 * stems say "diagram"). Keep in sync with isFigureAbsentWithoutApparatus in
 * verify-bank-family-compile.ts.
 */
const FIGURE_ABSENT_EXTRA =
  /(?:\bin the given figure\b|\bas shown in (?:the )?(?:figure|diagram)\b|\bshown in (?:the )?(?:figure|diagram)\b|\bsee (?:the )?figures?\b|\bin the figure\b)/i;

function figureAbsentWithoutNamedApparatus(stem: string): boolean {
  const absent = isFigureAbsentStem(stem)
    || FIGURE_ABSENT_EXTRA.test(stem)
    || /(?:equivalent capacitance of the combination shown|effective capacitance of the network.{0,80}shown)/i.test(stem);
  if (!absent) return false;
  return !FIGURE_ABSENT_NAMED_APPARATUS.test(stem);
}

function familyUsesDisplayScale(family: string): boolean {
  return family === "analytic_curve" || family === "bounded_region" || family === "state_plot"
    || family === "energy_level" || family === "coordinate_figure";
}

function orderedFamilies(families: readonly SceneVisualFamily[]): SceneVisualFamily[] {
  const known = new Set<SceneVisualFamily>(families);
  return FAMILY_PRIORITY.filter((family) => known.has(family));
}

/** Family classification lives in ./familyClassification — the one family-program seam. */
function resolveRequestedFamilies(
  question: string,
  requested?: readonly string[],
  problemIR?: ProblemStructureView | null,
): SceneVisualFamily[] {
  const stem = normalizeStem(question);
  const structure = familiesFromProblemStructure(problemIR);
  const merged = new Set<SceneVisualFamily>([
    ...structure,
    ...(requested ?? []).filter(isSceneVisualFamily),
    ...inferFamiliesFromQuestion(question),
  ]);
  applyStemFamilyOverrides(stem, merged);
  // Structure is the live catalog when it exists: the English tables may add
  // coverage but may not revoke a solved family, and solved families keep the
  // leading positions. This mirrors inferSceneCapabilities so the planner and
  // the fallback cannot disagree about what the question is.
  if (structure.length > 0) {
    for (const family of structure) merged.add(family);
    const rest = orderFamiliesByStemPreference(stem, orderedFamilies([...merged]))
      .filter((family) => !structure.includes(family));
    return [...structure, ...rest];
  }
  const ordered = orderedFamilies([...merged]);
  return orderFamiliesByStemPreference(stem, ordered);
}

function isDiodeDeviceCircuit(question: string): boolean {
  const stem = normalizeStem(question);
  return /(?:zener|(?:p-n|pn) junction diode|rectifier|(?<!photo)diode)/i.test(stem)
    && !isSemiconductorBandStem(stem)
    && !/(?:depletion.{0,4}region|solar cell|photodiode|light emitting|\bled\b)/i.test(stem)
    && !isIvCharacteristicStem(stem);
}

function diodeBiasDocument(question: string): SceneDocument {
  const stem = normalizeStem(question);
  const zener = /zener/i.test(stem);
  const rectifier = /rectifier/i.test(stem);
  const sourceSymbol = rectifier ? "ac_source" : "battery";
  const deviceSymbol = zener ? "zener" : "diode";
  return baseDocument({
    question,
    reason: zener
      ? "Zener regulator as battery, series resistor, and Zener"
      : "biased diode with a source on shared terminals",
    quantities: [],
    entities: [
      { id: "n0", kind: "point", role: "node" },
      { id: "n1", kind: "point", role: "node" },
      { id: "n2", kind: "point", role: "node" },
      { id: "src", kind: "component", role: "source", label: rectifier ? "AC" : "battery" },
      { id: "device", kind: "component", role: "diode", label: zener ? "Zener" : "diode" },
      ...(zener
        ? [{ id: "rs", kind: "component" as const, role: "series resistor", label: "Rs" }]
        : []),
    ],
    constructions: [
      pointAt("n0", 0, 0),
      pointAt("n1", 2, 0),
      pointAt("n2", 4, 0),
      { id: "make_src", operator: "symbol", inputs: { symbol: sourceSymbol, start: "n0", end: "n1" }, outputs: ["src"] },
      ...(zener
        ? [
          { id: "make_rs", operator: "symbol" as const, inputs: { symbol: "resistor", start: "n1", end: "n2" }, outputs: ["rs"] },
          { id: "make_device", operator: "symbol" as const, inputs: { symbol: deviceSymbol, start: "n1", end: "n2" }, outputs: ["device"] },
        ]
        : [
          { id: "make_device", operator: "symbol" as const, inputs: { symbol: deviceSymbol, start: "n1", end: "n2" }, outputs: ["device"] },
        ]),
    ],
    annotations: rectifier
      ? []
      : [{ id: "src_polarity", kind: "polarity", targetIds: ["src"], text: "-+" }],
    assertions: zener
      ? [{
          id: "zener_load_pair",
          predicate: "sameTerminalPair",
          entities: ["rs", "device"],
          expected: true,
          severity: "fatal",
        }]
      : [{
          id: "diode_path",
          predicate: "path",
          entities: ["src", "device"],
          expected: true,
          severity: "fatal",
        }],
  });
}

const FAMILY_BUILDERS: Record<string, FamilyBuilder> = {
  instrument_chain: buildInstrumentChain,
  interface: buildInterfaceRays,
  ray_path: buildInterfaceRays,
  axis_view: buildAxisView,
  circuit_network: buildCircuit,
  analytic_curve: buildAnalyticCurve,
  bounded_region: buildBoundedRegion,
  state_plot: buildStatePlot,
  contact_body: buildContactBody,
  vector_diagram: buildVectorDiagram,
  aperture: buildAperturePattern,
  screen_pattern: buildAperturePattern,
  wavefront: buildWavefront,
  polarizer: buildPolarizer,
  transverse_field: buildTransverseField,
  coordinate_figure: buildCoordinateFigure,
  solid_figure: buildSolidFigure,
  point_field: buildPointField,
  energy_level: buildEnergyLevel,
  fluid_apparatus: buildFluidApparatus,
};

function buildInstrumentChain(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const stem = normalizeStem(question);
  // A schematic still requires the stem to name the instrument; never invent one.
  if (!/(?:microscope|telescope|objective|eyepiece)/i.test(stem)) return null;
  const fo = absQuantity(quantities, ["fo", "objectivefocallength", "focalobjective"]);
  const fe = absQuantity(quantities, ["fe", "eyepiecefocallength", "focaleyepiece"]);
  const uo = absQuantity(quantities, ["uo", "objectdistance", "uobjective"]);
  const nearPoint = absQuantity(quantities, ["d", "nearpoint", "leastdistance"]);
  if (!schematic && (fo === null || uo === null)) return null;
  // Only plan-sourced values are recorded; a schematic carries no invented numbers.
  const sceneQuantities = [
    fo !== null ? quantityRecord("f_o", "f_o", fo, unitOf(quantities, ["fo"]) ?? "m") : null,
    fe !== null ? quantityRecord("f_e", "f_e", fe, unitOf(quantities, ["fe"]) ?? "m") : null,
    uo !== null ? quantityRecord("u_o", "u_o", uo, unitOf(quantities, ["uo"]) ?? "m") : null,
    nearPoint !== null ? quantityRecord("D", "D", nearPoint, unitOf(quantities, ["d", "nearpoint"]) ?? "m") : null,
  ].filter((quantity): quantity is Record<string, unknown> & { id: string } => quantity !== null);
  return baseDocument({
    question,
    reason: "finite optical instrument chain from plan quantities",
    quantities: sceneQuantities,
    entities: [
      { id: "O", kind: "point", role: "object position", label: "O" },
      { id: "I", kind: "point", role: "intermediate real image", label: "I" },
      { id: "I_prime", kind: "point", role: "final virtual image", label: "I'" },
      { id: "L_o", kind: "point", role: "objective lens center" },
      { id: "L_e", kind: "point", role: "eyepiece lens center" },
      { id: "axis", kind: "line", role: "optical axis" },
      { id: "obj_lens", kind: "line", role: "objective lens", label: "L_o" },
      { id: "eye_lens", kind: "line", role: "eyepiece lens", label: "L_e" },
    ],
    constructions: [],
    assertions: [],
  });
}

function buildInterfaceRays(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (/(?:microscope|telescope)/i.test(question) && !schematic) return null;
  if (/\bprism\b/i.test(question)) return buildPrism(question, quantities, schematic);
  if (isSphericalInterface(question, quantities)) {
    return buildSphericalInterface(question, quantities, schematic);
  }
  if (isSphericalMirrorOrLens(question, quantities)) return null;
  const reflection = /(?:reflect|mirror|law of reflection)/i.test(question)
    && !/(?:refract|snell|glass|prism|water)/i.test(question);
  const incident = angleDegrees(quantities, question);
  const n2 = firstQuantity(quantities, ["n2", "nglass", "n", "mu", "refractiveindex"]);
  const n1 = firstQuantity(quantities, ["n1", "nair"]) ?? 1;
  if (!schematic && incident === null) return null;
  if (!schematic && !reflection && n2 === null) return null;
  // A schematic still requires the stem to name the optical phenomenon.
  if (
    schematic
    && !reflection
    && !/(?:refract|snell|glass|prism|water|interface|critical angle|optical fib|incident ray|surface[- ]normal|ray of light)/i.test(question)
  ) {
    return null;
  }
  const theta = incident ?? 30;
  const index2 = n2 ?? 1.5;
  if (reflection) {
    return surfaceRayDocument(question, {
      operator: "reflect_at",
      theta,
      n1: 1,
      n2: 1,
      outgoingId: "reflected",
      outgoingRole: "reflected ray",
    });
  }
  try {
    evaluateOpticsLaw("snell_law", { n1, n2: index2, incidentDeg: theta });
  } catch {
    if (!schematic) return null;
  }
  return surfaceRayDocument(question, {
    operator: "refract_at",
    theta,
    n1,
    n2: index2,
    outgoingId: "refracted",
    outgoingRole: "refracted ray",
  });
}

function surfaceRayDocument(
  question: string,
  options: {
    operator: "reflect_at" | "refract_at";
    theta: number;
    n1: number;
    n2: number;
    outgoingId: string;
    outgoingRole: string;
  },
): SceneDocument {
  const outgoingId = options.outgoingId;
  return baseDocument({
    question,
    reason: `atomic ${options.operator} from plan incidence and indices`,
    quantities: [
      { id: "theta", symbol: "theta", value: options.theta, unit: "degree" },
      { id: "n1", symbol: "n1", value: options.n1, unit: "1" },
      { id: "n2", symbol: "n2", value: options.n2, unit: "1" },
    ],
    entities: [
      { id: "left", kind: "point", role: "interface endpoint" },
      { id: "right", kind: "point", role: "interface endpoint" },
      { id: "contact", kind: "point", role: "point of incidence" },
      { id: "interface", kind: "segment", role: "optical interface" },
      { id: "incident", kind: "ray", role: "incident ray" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: outgoingId, kind: "ray", role: options.outgoingRole },
    ],
    constructions: [
      pointAt("left", -3, 0),
      pointAt("right", 3, 0),
      pointAt("contact", 0, 0),
      { id: "make_interface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["interface"] },
      {
        id: "make_bundle",
        operator: options.operator,
        inputs: options.operator === "refract_at"
          ? { point: "contact", surface: "interface", incidentAngleDeg: "theta", n1: "n1", n2: "n2", span: 2 }
          : { point: "contact", surface: "interface", incidentAngleDeg: "theta", span: 2 },
        outputs: ["incident", "normal", outgoingId],
      },
    ],
    assertions: [
      { id: "contact_on_surface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "normal_perpendicular", predicate: "perpendicular", entities: ["normal", "interface"], expected: true, severity: "fatal" },
      options.operator === "refract_at"
        ? {
            id: "snell",
            predicate: "snells_law",
            entities: ["incident", "normal", outgoingId],
            expected: { n1: options.n1, n2: options.n2 },
            tolerance: 1e-6,
            severity: "fatal",
          }
        : {
            id: "reflection_angles",
            predicate: "equal_angle",
            entities: ["incident", "normal", outgoingId, "normal"],
            expected: true,
            tolerance: 1e-6,
            severity: "fatal",
          },
    ],
  });
}

function isSphericalInterface(question: string, quantities: PlanQuantity[]): boolean {
  const hasRadius = absQuantity(quantities, ["r", "radius"]) !== null
    || /\bradius\b/i.test(question);
  const hasObject = absQuantity(quantities, ["u", "s", "objectdistance"]) !== null
    || /\b(?:point object|object is|from a spherical)\b/i.test(question);
  return hasRadius && hasObject &&
    /(?:spherical|interface|paraxial image|center of curvature|surface[- ]normal)/i.test(question);
}

function buildSphericalInterface(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const objectDistance = absQuantity(quantities, ["u", "s", "objectdistance"])
    ?? questionNumber(question, /(\d+(?:\.\d+)?)\s*(?:cm|mm|m)\s+from/i);
  const radius = absQuantity(quantities, ["r", "radius"])
    ?? questionNumber(question, /radius\s+(?:of\s+)?(\d+(?:\.\d+)?)/i);
  const n2 = firstQuantity(quantities, ["n2", "n", "nglass", "mu", "refractiveindex"])
    ?? questionNumber(question, /(?:index|n)\s*(?:=|is)?\s*(\d+(?:\.\d+)?)/i);
  const n1 = firstQuantity(quantities, ["n1", "nair"]) ?? 1;
  if (!schematic && (objectDistance === null || radius === null || n2 === null)) return null;
  const u = objectDistance ?? 0.3;
  const R = radius ?? 0.1;
  const index2 = n2 ?? 1.5;
  let imageDistance = u * 3;
  try {
    imageDistance = evaluateOpticsLaw("spherical_refraction", {
      n1,
      n2: index2,
      objectDistance: u,
      radius: R,
    }).imageDistance;
  } catch {
    if (!schematic) return null;
  }
  const xs = displayAxis([-u, 0, R, imageDistance]);
  const objectX = xs[0]!;
  const vertexX = xs[1]!;
  const centerX = xs[2]!;
  const imageX = xs[3]!;
  const radiusDisplay = Math.abs(centerX - vertexX);
  return baseDocument({
    question,
    reason: "spherical refracting surface from the paraxial imaging law",
    quantities: [
      quantityRecord("u", "u", u, unitOf(quantities, ["u", "s", "objectdistance"]) ?? "m"),
      quantityRecord("R", "R", R, unitOf(quantities, ["r", "radius"]) ?? "m"),
      quantityRecord("n1", "n1", n1, "1"),
      quantityRecord("n2", "n2", index2, "1"),
      quantityRecord("v", "v", imageDistance, unitOf(quantities, ["v", "imagedistance"]) ?? "m"),
    ],
    entities: [
      { id: "O", kind: "point", role: "object position", label: "O" },
      { id: "V", kind: "point", role: "surface vertex", label: "V" },
      { id: "C", kind: "point", role: "center of curvature", label: "C" },
      { id: "I", kind: "point", role: "paraxial image", label: "I" },
      { id: "contact", kind: "point", role: "point of incidence", label: "P" },
      { id: "axis", kind: "line", role: "optical axis" },
      { id: "interface", kind: "arc", role: "spherical interface" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: "radius", kind: "segment", role: "radius", label: "R" },
    ],
    constructions: [
      pointAt("O", objectX, 0),
      pointAt("V", vertexX, 0),
      pointAt("C", centerX, 0),
      pointAt("I", imageX, 0),
      pointAt("contact", vertexX + radiusDisplay * (1 - Math.cos(Math.PI / 8)), radiusDisplay * Math.sin(Math.PI / 8)),
      { id: "make_axis", operator: "line", inputs: { start: "O", end: "I" }, outputs: ["axis"] },
      {
        id: "make_interface",
        operator: "spherical_surface",
        inputs: {
          vertex: "V",
          center: "C",
          axis: "axis",
          halfHeight: radiusDisplay * 0.55,
        },
        outputs: ["interface"],
      },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "interface" }, outputs: ["normal"] },
      { id: "make_radius", operator: "segment", inputs: { start: "C", end: "V" }, outputs: ["radius"] },
    ],
    assertions: [
      { id: "O_on_axis", predicate: "on", entities: ["O", "axis"], expected: true, severity: "fatal" },
      { id: "V_on_axis", predicate: "on", entities: ["V", "axis"], expected: true, severity: "fatal" },
      { id: "C_on_axis", predicate: "on", entities: ["C", "axis"], expected: true, severity: "fatal" },
      { id: "I_on_axis", predicate: "on", entities: ["I", "axis"], expected: true, severity: "fatal" },
      { id: "V_on_surface", predicate: "on", entities: ["V", "interface"], expected: true, severity: "fatal" },
      { id: "P_on_surface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "label_O", predicate: "label_attached", entities: ["O"], expected: true, severity: "fatal" },
      { id: "label_C", predicate: "label_attached", entities: ["C"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["I"], expected: true, severity: "fatal" },
      { id: "label_V", predicate: "label_attached", entities: ["V"], expected: true, severity: "fatal" },
      {
        id: "image_distance_ratio",
        predicate: "distance_ratio",
        entities: ["I", "V", "O", "V"],
        expected: Math.abs(imageDistance / u),
        tolerance: 0.0001,
        severity: "fatal",
      },
    ],
    teachingTimeline: [
      {
        id: "reveal_setup",
        action: "reveal",
        targetId: "setup",
        dependsOn: [],
        narrationIntent: "Begin with the spherical surface and the points O, V, C, and I on the axis.",
      },
    ],
  });
}

function questionNumber(question: string, pattern: RegExp): number | null {
  const match = pattern.exec(question);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildPrism(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const apex = firstQuantity(quantities, ["a", "apex", "apexangle", "angle"])
    ?? angleDegrees(quantities, question);
  if (!schematic && apex === null) return null;
  const A = apex ?? 60;
  const half = (A / 2) * Math.PI / 180;
  const size = 3;
  const leftX = -Math.sin(half) * size;
  const rightX = Math.sin(half) * size;
  const apexY = Math.cos(half) * size;
  return baseDocument({
    question,
    reason: "prism cross-section from the named apex angle",
    quantities: [{ id: "A", symbol: "A", value: A, unit: "degree" }],
    entities: [
      { id: "apex", kind: "point", role: "prism apex", label: "A" },
      { id: "left", kind: "point", role: "prism base", label: "B" },
      { id: "right", kind: "point", role: "prism base", label: "C" },
      { id: "prism", kind: "polygon", role: "prism" },
    ],
    constructions: [
      pointAt("apex", 0, apexY),
      pointAt("left", leftX, 0),
      pointAt("right", rightX, 0),
      { id: "make_prism", operator: "polygon", inputs: { points: ["apex", "left", "right"] }, outputs: ["prism"] },
    ],
    assertions: [
      { id: "prism_exists", predicate: "exists", entities: ["prism"], expected: true, severity: "fatal" },
    ],
  });
}

function isSphericalMirrorOrLens(question: string, quantities: PlanQuantity[]): boolean {
  if (isSphericalInterface(question, quantities)) return false;
  if (/(?:microscope|telescope)/i.test(question)) return false;
  const focal = absQuantity(quantities, ["f", "focallength"]);
  const objectDistance = absQuantity(quantities, ["u", "objectdistance"]);
  return /(?:concave|convex)\s+(?:mirror|lens)/i.test(question)
    || (/\b(?:mirror|lens)\b/i.test(question) && focal !== null && objectDistance !== null);
}

function buildAxisView(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (/(?:microscope|telescope)/i.test(question)) return null;
  if (isSphericalInterface(question, quantities)) {
    return buildSphericalInterface(question, quantities, schematic);
  }
  // A schematic still requires the stem to name a mirror or lens.
  if (schematic && !/\b(?:mirror|lens)(?:es)?\b/i.test(question)) return null;
  const focalMagnitude = absQuantity(quantities, ["f", "focallength"]);
  const objectDistance = absQuantity(quantities, ["u", "objectdistance"]);
  const imageDistanceGiven = firstQuantity(quantities, ["v", "imagedistance"]);
  const mirror = /\bmirror\b/i.test(question);
  if (!schematic && (focalMagnitude === null || (objectDistance === null && imageDistanceGiven === null))) {
    return null;
  }
  const convex = /\bconvex\s+(?:mirror|lens)\b/i.test(question)
    || ((firstQuantity(quantities, ["f", "focallength"]) ?? 0) < 0 && mirror);
  let u = objectDistance ?? focalMagnitude ?? 1;
  const f = (focalMagnitude ?? u / 2) * (convex ? -1 : 1);
  if (Math.abs(u - Math.abs(f)) < 1e-9) {
    if (!schematic) return null;
    u = Math.abs(f) * 1.5;
  }
  let imageDistance = imageDistanceGiven;
  let magnification = -1;
  try {
    const solved = evaluateOpticsLaw(mirror ? "mirror_formula" : "thin_lens_formula", {
      objectDistance: u,
      focalLength: f,
    });
    imageDistance = solved.imageDistance;
    magnification = solved.magnification;
  } catch {
    if (!schematic) return null;
  }
  const v = imageDistance ?? (mirror && convex ? -u / 2 : u * 2);
  if (mirror) return buildParaxialMirror(question, quantities, { u, f, v, magnification });
  return buildThinLens(question, quantities, { u, f, v, magnification });
}

function buildParaxialMirror(
  question: string,
  quantities: PlanQuantity[],
  values: { u: number; f: number; v: number; magnification: number },
): SceneDocument {
  const { u, f, v, magnification } = values;
  const poleX = 0;
  const objectX = -u;
  const focusX = -f;
  const centerX = -2 * f;
  const imageX = -v;
  const objectHeight = Math.abs(f) * 0.08;
  const imageHeight = objectHeight * magnification;
  const xs = [objectX, poleX, focusX, centerX, imageX];
  const pad = Math.abs(f) * 0.4;
  const leftX = Math.min(...xs) - pad;
  const rightX = Math.max(...xs) + pad;
  const vertexAngle = Math.atan2(0, poleX - centerX) * 180 / Math.PI;
  const sweep = 40;
  const radius = Math.abs(2 * f);
  const unit = unitOf(quantities, ["f", "focallength", "u", "objectdistance"]) ?? "cm";
  const realImage = v > 0;
  return baseDocument({
    question,
    reason: "paraxial mirror construction from the mirror formula",
    quantities: [
      quantityRecord("f", "f", f, unit),
      quantityRecord("u", "u", u, unit),
      quantityRecord("v", "v", v, unit),
      quantityRecord("m", "m", magnification, "1"),
    ],
    entities: [
      { id: "left_axis", kind: "point", role: "axis endpoint" },
      { id: "right_axis", kind: "point", role: "axis endpoint" },
      { id: "P", kind: "point", role: "pole", label: "P" },
      { id: "F", kind: "point", role: "focal point", label: "F" },
      { id: "C", kind: "point", role: "center of curvature", label: "C" },
      { id: "object_base", kind: "point", role: "object position", label: "O" },
      { id: "object_tip", kind: "point", role: "object tip" },
      { id: "image_base", kind: "point", role: "image position", label: "I" },
      { id: "image_tip", kind: "point", role: "image tip" },
      { id: "axis", kind: "segment", role: "principal axis" },
      { id: "mirror", kind: "arc", role: "spherical mirror", label: "M" },
      { id: "object", kind: "vector", role: "object" },
      { id: "image", kind: "vector", role: "image" },
      { id: "hit_parallel", kind: "point", role: "surface intersection" },
      { id: "incident_parallel", kind: "vector", role: "incident ray" },
      { id: "normal_parallel", kind: "vector", role: "surface normal" },
      { id: "reflected_parallel", kind: "ray", role: "reflected ray" },
      { id: "hit_focus", kind: "point", role: "surface intersection" },
      { id: "incident_focus", kind: "vector", role: "incident ray" },
      { id: "normal_focus", kind: "vector", role: "surface normal" },
      { id: "reflected_focus", kind: "ray", role: "reflected ray" },
    ],
    constructions: [
      pointAt("left_axis", leftX, 0),
      pointAt("right_axis", rightX, 0),
      pointAt("P", poleX, 0),
      pointAt("F", focusX, 0),
      pointAt("C", centerX, 0),
      pointAt("object_base", objectX, 0),
      pointAt("object_tip", objectX, objectHeight),
      pointAt("image_base", imageX, 0),
      pointAt("image_tip", imageX, imageHeight),
      { id: "make_axis", operator: "segment", inputs: { start: "left_axis", end: "right_axis" }, outputs: ["axis"] },
      {
        id: "make_mirror",
        operator: "arc",
        inputs: {
          center: "C",
          radius,
          startAngle: vertexAngle - sweep,
          endAngle: vertexAngle + sweep,
          angleUnit: "degrees",
        },
        outputs: ["mirror"],
      },
      { id: "make_object", operator: "vector", inputs: { start: "object_base", end: "object_tip" }, outputs: ["object"] },
      { id: "make_image", operator: "vector", inputs: { start: "image_base", end: "image_tip" }, outputs: ["image"] },
      {
        id: "make_parallel_contact",
        operator: "surface_contact",
        inputs: { origin: "object_tip", direction: [1, 0], surface: "mirror" },
        outputs: ["hit_parallel", "incident_parallel"],
      },
      { id: "make_parallel_normal", operator: "normal_at", inputs: { point: "hit_parallel", surface: "mirror" }, outputs: ["normal_parallel"] },
      {
        id: "make_parallel_reflection",
        operator: "reflect_direction",
        inputs: { origin: "hit_parallel", incoming: "incident_parallel", normal: "normal_parallel" },
        outputs: ["reflected_parallel"],
      },
      {
        id: "make_focus_contact",
        operator: "surface_contact",
        inputs: { origin: "object_tip", through: "F", surface: "mirror" },
        outputs: ["hit_focus", "incident_focus"],
      },
      { id: "make_focus_normal", operator: "normal_at", inputs: { point: "hit_focus", surface: "mirror" }, outputs: ["normal_focus"] },
      {
        id: "make_focus_reflection",
        operator: "reflect_direction",
        inputs: { origin: "hit_focus", incoming: "incident_focus", normal: "normal_focus" },
        outputs: ["reflected_focus"],
      },
    ],
    assertions: [
      { id: "P_on_axis", predicate: "on", entities: ["P", "axis"], expected: true, severity: "fatal" },
      { id: "F_on_axis", predicate: "on", entities: ["F", "axis"], expected: true, severity: "fatal" },
      { id: "C_on_axis", predicate: "on", entities: ["C", "axis"], expected: true, severity: "fatal" },
      { id: "object_on_axis", predicate: "on", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
      { id: "image_on_axis", predicate: "on", entities: ["image_base", "axis"], expected: true, severity: "fatal" },
      { id: "P_on_mirror", predicate: "on", entities: ["P", "mirror"], expected: true, severity: "fatal" },
      { id: "focus_between", predicate: "between", entities: ["F", "C", "P"], expected: true, severity: "fatal" },
      {
        id: "image_distance_ratio",
        predicate: "distance_ratio",
        entities: ["image_base", "P", "object_base", "P"],
        expected: Math.abs(v / u),
        tolerance: 0.0001,
        severity: "fatal",
      },
      { id: "label_O", predicate: "label_attached", entities: ["object_base"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["image_base"], expected: true, severity: "fatal" },
      { id: "label_F", predicate: "label_attached", entities: ["F"], expected: true, severity: "fatal" },
      { id: "label_C", predicate: "label_attached", entities: ["C"], expected: true, severity: "fatal" },
      { id: "label_P", predicate: "label_attached", entities: ["P"], expected: true, severity: "fatal" },
      ...(realImage
        ? [{
            id: "rays_meet_image",
            predicate: "converges" as const,
            entities: ["reflected_parallel", "reflected_focus", "image_tip"],
            expected: true,
            tolerance: 0.2,
            severity: "fatal" as const,
          }]
        : []),
    ],
    annotations: realImage
      ? []
      : [
          { id: "virtual_image", kind: "endpoint", targetIds: ["image_base"], style: { pointStyle: "open" as const } },
          { id: "virtual_ray", kind: "extend", targetIds: ["reflected_parallel"] },
        ],
    revealGroups: [
      {
        id: "mirror_setup",
        entityIds: ["left_axis", "right_axis", "axis", "P", "F", "C", "mirror"],
        dependsOn: [],
        narrationCue: "Begin with the spherical mirror and the points P, F, and C on the principal axis.",
      },
      {
        id: "object_image",
        entityIds: ["object_base", "object_tip", "object", "image_base", "image_tip", "image"],
        dependsOn: ["mirror_setup"],
        narrationCue: "O is the object in front of the mirror, and I is the image.",
      },
      {
        id: "principal_rays",
        entityIds: [
          "hit_parallel", "incident_parallel", "normal_parallel", "reflected_parallel",
          "hit_focus", "incident_focus", "normal_focus", "reflected_focus",
        ],
        dependsOn: ["object_image"],
        narrationCue: "Follow the principal rays from the object to the image.",
      },
    ],
    teachingTimeline: [
      {
        id: "reveal_mirror_setup",
        action: "reveal",
        targetId: "mirror_setup",
        dependsOn: [],
        narrationIntent: "Begin with the spherical mirror and the points P, F, and C on the principal axis.",
      },
      {
        id: "reveal_object_image",
        action: "reveal",
        targetId: "object_image",
        dependsOn: ["reveal_mirror_setup"],
        narrationIntent: "O is the object in front of the mirror, and I is the image.",
      },
      {
        id: "reveal_principal_rays",
        action: "reveal",
        targetId: "principal_rays",
        dependsOn: ["reveal_object_image"],
        narrationIntent: "Follow the principal rays from the object to the image.",
      },
    ],
  });
}

function buildThinLens(
  question: string,
  quantities: PlanQuantity[],
  values: { u: number; f: number; v: number; magnification: number },
): SceneDocument {
  const { u, f, v, magnification } = values;
  const objectHeight = Math.abs(f) * 0.08;
  const imageHeight = objectHeight * magnification;
  const objectX = 0;
  const lensX = u;
  const focusX = u + f;
  const imageX = u + v;
  const pad = Math.abs(f) * 0.4;
  const leftX = Math.min(objectX, lensX, focusX, imageX) - pad;
  const rightX = Math.max(objectX, lensX, focusX, imageX) + pad;
  const unit = unitOf(quantities, ["f", "focallength", "u", "objectdistance"]) ?? "m";
  return baseDocument({
    question,
    reason: "paraxial thin-lens construction from the lens formula",
    quantities: [
      quantityRecord("f", "f", f, unit),
      quantityRecord("u", "u", u, unit),
      quantityRecord("v", "v", v, unit),
    ],
    entities: [
      { id: "left_axis", kind: "point", role: "axis endpoint" },
      { id: "right_axis", kind: "point", role: "axis endpoint" },
      { id: "object_base", kind: "point", role: "object position", label: "O" },
      { id: "object_tip", kind: "point", role: "object tip" },
      { id: "lens_center", kind: "point", role: "surface vertex", label: "V" },
      { id: "focus", kind: "point", role: "focal point", label: "F" },
      { id: "image_base", kind: "point", role: "image position", label: "I" },
      { id: "image_tip", kind: "point", role: "image tip" },
      { id: "axis", kind: "segment", role: "principal axis" },
      { id: "lens", kind: "polygon", role: "thin lens", label: "L" },
      { id: "object", kind: "vector", role: "object" },
      { id: "image", kind: "vector", role: "image" },
    ],
    constructions: [
      pointAt("left_axis", leftX, 0),
      pointAt("right_axis", rightX, 0),
      pointAt("object_base", objectX, 0),
      pointAt("object_tip", objectX, objectHeight),
      pointAt("lens_center", lensX, 0),
      pointAt("focus", focusX, 0),
      pointAt("image_base", imageX, 0),
      pointAt("image_tip", imageX, imageHeight),
      { id: "make_axis", operator: "segment", inputs: { start: "left_axis", end: "right_axis" }, outputs: ["axis"] },
      {
        id: "make_lens",
        operator: "lens_section",
        inputs: {
          center: "lens_center",
          axis: "axis",
          radius1: (!/\b(?:concave|diverging)\b/i.test(question) ? 1 : -1) * Math.max(Math.abs(values.f) * 0.8, 1),
          radius2: (!/\b(?:concave|diverging)\b/i.test(question) ? -1 : 1) * Math.max(Math.abs(values.f) * 0.8, 1),
          halfHeight: Math.max(Math.abs(objectHeight) * 2, Math.abs(values.f) * 0.16),
        },
        outputs: ["lens"],
      },
      { id: "make_object", operator: "vector", inputs: { start: "object_base", end: "object_tip" }, outputs: ["object"] },
      { id: "make_image", operator: "vector", inputs: { start: "image_base", end: "image_tip" }, outputs: ["image"] },
    ],
    assertions: [
      { id: "object_on_axis", predicate: "on", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
      { id: "image_on_axis", predicate: "on", entities: ["image_base", "axis"], expected: true, severity: "fatal" },
      { id: "centre_on_axis", predicate: "on", entities: ["lens_center", "axis"], expected: true, severity: "fatal" },
      {
        id: "image_distance_ratio",
        predicate: "distance_ratio",
        entities: ["image_base", "lens_center", "object_base", "lens_center"],
        expected: Math.abs(v / u),
        tolerance: 0.0001,
        severity: "fatal",
      },
      { id: "label_O", predicate: "label_attached", entities: ["object_base"], expected: true, severity: "fatal" },
      { id: "label_I", predicate: "label_attached", entities: ["image_base"], expected: true, severity: "fatal" },
    ],
    revealGroups: [
      {
        id: "lens_setup",
        entityIds: ["left_axis", "right_axis", "axis", "lens_center", "focus", "lens"],
        dependsOn: [],
        narrationCue: "Begin with the thin lens, its optical centre, and the focus on the principal axis.",
      },
      {
        id: "object_image",
        entityIds: ["object_base", "object_tip", "object", "image_base", "image_tip", "image"],
        dependsOn: ["lens_setup"],
        narrationCue: "O is the object, and I is the image.",
      },
    ],
    teachingTimeline: [
      {
        id: "reveal_lens_setup",
        action: "reveal",
        targetId: "lens_setup",
        dependsOn: [],
        narrationIntent: "Begin with the thin lens, its optical centre, and the focus on the principal axis.",
      },
      {
        id: "reveal_object_image",
        action: "reveal",
        targetId: "object_image",
        dependsOn: ["reveal_lens_setup"],
        narrationIntent: "O is the object, and I is the image.",
      },
    ],
  });
}

function buildCircuit(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (
    /(?:lens maker|spherical (?:surface|interface|mirror)|thin lens|principal axis|radius of curvature)/i.test(question)
    && !/(?:resistor|ohm|circuit|battery|galvanometer)/i.test(question)
  ) {
    return null;
  }
  const resistors = extractResistors(question, quantities);
  if (isDiodeDeviceCircuit(question) && resistors.length < 2) {
    return diodeBiasDocument(question);
  }
  const namedNetwork = /(?:wheatstone|met(?:er|re) bridge|potentiometer|kirchhoff|galvanometer|transformer|\bLCR\b|\bRLC\b)/i.test(normalizeStem(question));
  if (resistors.length < 2 && !schematic && !namedNetwork) return null;
  // A schematic still requires the stem to name circuit apparatus; never invent a network.
  if (
    schematic
    && resistors.length < 2
    && !namedNetwork
    && !/(?:resist|circuit|battery|\bcells?\b|\bemf\b|capacitor|inductor|diode|zener|galvanometer|ammeter|voltmeter|\bohm|series|parallel|bulb|lamp)/i.test(question)
  ) {
    return null;
  }
  const count = Math.max(2, Math.min(resistors.length || (namedNetwork ? 4 : 3), 4));
  const wantsParallel = /\bparallel\b/i.test(question) && !/\bin series except\b/i.test(question);
  const wantsSeries = /\bseries\b/i.test(question) || (namedNetwork && !wantsParallel);
  if (!schematic && !wantsParallel && !wantsSeries && resistors.length < 2) return null;
  if (wantsSeries && wantsParallel) {
    return buildSeparatedCircuitViews(question, resistors, count);
  }
  if (isTwoLoopNetworkStem(question)) {
    return buildTwoLoopCircuit(question, resistors);
  }
  const topology = wantsParallel || (!wantsSeries && schematic) ? "parallel" : "series";
  return buildSingleCircuitView(question, resistors, count, topology, 0, "");
}

function buildSingleCircuitView(
  question: string,
  resistors: Array<{ symbol: string; value: number; unit?: string }>,
  count: number,
  topology: "series" | "parallel",
  originY: number,
  idPrefix: string,
): SceneDocument {
  const nodes = topology === "parallel"
    ? [`${idPrefix}n0`, `${idPrefix}n1`]
    : Array.from({ length: count + 1 }, (_, index) => `${idPrefix}n${index}`);
  const nodePoints = topology === "parallel"
    ? [pointAt(nodes[0]!, 0, originY), pointAt(nodes[1]!, count * 2, originY)]
    : nodes.map((id, index) => pointAt(id, index * 2, originY));
  const resistorIds = Array.from({ length: count }, (_, index) => `${idPrefix}r${index + 1}`);
  const symbols = resistorIds.map((id, index) => ({
    id: `make_${id}`,
    operator: "symbol" as const,
    inputs: topology === "parallel"
      ? { symbol: "resistor", start: nodes[0]!, end: nodes[1]! }
      : { symbol: "resistor", start: nodes[index]!, end: nodes[index + 1]! },
    outputs: [id],
  }));
  return baseDocument({
    question,
    reason: `${topology} resistor network from the question wording`,
    quantities: resistors.slice(0, count).map((resistor, index) =>
      quantityRecord(`R${index + 1}`, resistor.symbol, resistor.value, resistor.unit ?? "ohm")),
    entities: [
      ...nodes.map((id) => ({ id, kind: "point" as const, role: "node" })),
      ...resistorIds.map((id, index) => ({
        id,
        kind: "component" as const,
        role: "resistor",
        label: compactLabel(resistors[index]?.symbol ?? `R${index + 1}`),
      })),
    ],
    constructions: [...nodePoints, ...symbols],
    annotations: [{
      id: `${idPrefix}current_sense`,
      kind: "sense",
      targetIds: [resistorIds[0]!],
    }],
    assertions: topology === "parallel"
      ? [{
          id: "same_pair",
          predicate: "sameTerminalPair",
          entities: resistorIds,
          expected: true,
          severity: "fatal" as const,
        }]
      : [{
          id: "series_path",
          predicate: "path",
          entities: resistorIds,
          expected: true,
          severity: "fatal" as const,
        }],
    revealGroups: [{
      id: `${topology}_group`,
      entityIds: [...nodes, ...resistorIds],
      dependsOn: [],
      narrationCue: `${topology} circuit`,
    }],
  });
}

function buildTwoLoopCircuit(
  question: string,
  resistors: Array<{ symbol: string; value: number; unit?: string }>,
): SceneDocument {
  const r1 = resistors[0]?.symbol ?? "R1";
  const r2 = resistors[1]?.symbol ?? "R2";
  const r3 = resistors[2]?.symbol ?? "R3";
  return baseDocument({
    question,
    reason: "two-loop network from the question wording",
    quantities: resistors.slice(0, 3).map((resistor, index) =>
      quantityRecord(`R${index + 1}`, resistor.symbol, resistor.value, resistor.unit ?? "ohm")),
    entities: [
      { id: "n_tl", kind: "point", role: "node" },
      { id: "n_tc", kind: "point", role: "node", label: "A" },
      { id: "n_tr", kind: "point", role: "node" },
      { id: "n_bl", kind: "point", role: "node" },
      { id: "n_bc", kind: "point", role: "node" },
      { id: "n_br", kind: "point", role: "node" },
      { id: "r1", kind: "component", role: "resistor", label: compactLabel(r1) },
      { id: "r2", kind: "component", role: "resistor", label: compactLabel(r2) },
      { id: "r3", kind: "component", role: "resistor", label: compactLabel(r3) },
      { id: "v1", kind: "component", role: "source", label: "V1" },
      { id: "v2", kind: "component", role: "source", label: "V2" },
      { id: "w_bl", kind: "connector", role: "return path" },
      { id: "w_br", kind: "connector", role: "return path" },
    ],
    constructions: [
      pointAt("n_tl", 0, 2),
      pointAt("n_tc", 3, 2),
      pointAt("n_tr", 6, 2),
      pointAt("n_bl", 0, 0),
      pointAt("n_bc", 3, 0),
      pointAt("n_br", 6, 0),
      { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "n_tl", end: "n_tc" }, outputs: ["r1"] },
      { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "n_tc", end: "n_tr" }, outputs: ["r2"] },
      { id: "make_r3", operator: "symbol", inputs: { symbol: "resistor", start: "n_tc", end: "n_bc" }, outputs: ["r3"] },
      { id: "make_v1", operator: "symbol", inputs: { symbol: "battery", start: "n_bl", end: "n_tl" }, outputs: ["v1"] },
      { id: "make_v2", operator: "symbol", inputs: { symbol: "battery", start: "n_br", end: "n_tr" }, outputs: ["v2"] },
      { id: "make_w_bl", operator: "connect", inputs: { start: "n_bl", end: "n_bc" }, outputs: ["w_bl"] },
      { id: "make_w_br", operator: "connect", inputs: { start: "n_bc", end: "n_br" }, outputs: ["w_br"] },
    ],
    assertions: [
      {
        id: "left_loop",
        predicate: "path",
        entities: ["v1", "r1", "r3", "w_bl"],
        expected: true,
        severity: "fatal",
      },
      {
        id: "right_loop",
        predicate: "path",
        entities: ["v2", "r2", "r3", "w_br"],
        expected: true,
        severity: "fatal",
      },
    ],
    revealGroups: [{
      id: "two_loop_group",
      entityIds: ["n_tl", "n_tc", "n_tr", "n_bl", "n_bc", "n_br", "r1", "r2", "r3", "v1", "v2", "w_bl", "w_br"],
      dependsOn: [],
      narrationCue: "two-loop circuit",
    }],
  });
}

function buildSeparatedCircuitViews(
  question: string,
  resistors: Array<{ symbol: string; value: number; unit?: string }>,
  count: number,
): SceneDocument {
  const series = buildSingleCircuitView(question, resistors, count, "series", 3, "series_");
  const parallel = buildSingleCircuitView(question, resistors, count, "parallel", -3, "parallel_");
  return baseDocument({
    question,
    reason: "series and parallel resistor networks from the question wording",
    quantities: series.quantities,
    entities: [...series.entities, ...parallel.entities],
    constructions: [...series.constructions, ...parallel.constructions],
    assertions: [...series.assertions, ...parallel.assertions],
    revealGroups: [
      { id: "series_group", entityIds: series.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "series circuit" },
      { id: "parallel_group", entityIds: parallel.entities.map((entity) => entity.id), dependsOn: [], narrationCue: "parallel circuit" },
    ],
  });
}


/**
 * Draw the curves the stem actually states.
 *
 * The conic builders below fall back to a canonical `x^2/4 - y^2 = 1`, so a
 * question about one hyperbola was taught with a different hyperbola. When the
 * stem's own equation is readable it wins; when it is not, nothing here fires
 * and the caller degrades honestly.
 */
const STATED_CURVE_SAMPLE_LADDER = [97, 89, 113, 129, 65] as const;

function buildStatedCurveScene(question: string): SceneDocument | null {
  const curves = findStatedCurves(question);
  // A line on its own is not the subject of a question; it is a tangent, a
  // chord or an axis belonging to a curve we could not read.
  if (!curves.some((curve) => curve.kind !== "line")) return null;
  const framed = curves.filter((curve) => curve.kind !== "line");
  if (framed.length === 0 || framed.length > 3) return null;
  // An explicit y = f(x) parabola belongs to function_curve: the sampled curve
  // is what tangent_line, normal_line and function_value proofs attach to.
  // Only a curve that cannot be written as one function needs implicit_curve.
  if (
    framed.every((curve) => curve.kind === "parabola")
    && extractExplicitFunctions(question).length > 0
  ) {
    return null;
  }

  let xMin = Infinity; let xMax = -Infinity; let yMin = Infinity; let yMax = -Infinity;
  for (const curve of framed) {
    if (!curve.anchor || !curve.extent) return null;
    xMin = Math.min(xMin, curve.anchor.x - curve.extent.x);
    xMax = Math.max(xMax, curve.anchor.x + curve.extent.x);
    yMin = Math.min(yMin, curve.anchor.y - curve.extent.y);
    yMax = Math.max(yMax, curve.anchor.y + curve.extent.y);
  }
  // Keep the origin in frame so the axes read as axes.
  xMin = Math.min(0, xMin); xMax = Math.max(0, xMax);
  yMin = Math.min(0, yMin); yMax = Math.max(0, yMax);
  if (!(xMin < xMax) || !(yMin < yMax)) return null;
  if (!Number.isFinite(xMin + xMax + yMin + yMax)) return null;

  const drawn = [...framed, ...curves.filter((curve) => curve.kind === "line")].slice(0, 4);
  for (const samples of STATED_CURVE_SAMPLE_LADDER) {
    const document = statedCurveDocument(question, drawn, { xMin, xMax, yMin, yMax }, samples);
    if (document && tryCompile(document)) return document;
  }
  return null;
}

function statedCurveDocument(
  question: string,
  curves: StatedCurve[],
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  samples: number,
): SceneDocument | null {
  const entities: SceneEntity[] = [{ id: "axes", kind: "axes", role: "display axes" }];
  const constructions: SceneConstruction[] = [{
    id: "make_axes",
    operator: "axes",
    inputs: { ...bounds },
    outputs: ["axes"],
  }];
  const assertions: SceneAssertion[] = [];

  curves.forEach((curve, index) => {
    const id = `curve_${index + 1}`;
    entities.push({
      id,
      kind: curve.kind === "line" ? "line" : "polyline",
      role: `${curve.kind} stated by the question`,
      label: compactLabel(statedCurveLabel(curve)),
    });
    if (curve.kind === "circle" && curve.anchor && curve.radius) {
      constructions.push({
        id: `make_${id}`,
        operator: "circle",
        inputs: { center: [curve.anchor.x, curve.anchor.y], radius: curve.radius },
        outputs: [id],
      });
    } else if (curve.kind === "line") {
      const points = lineEndpointsInBounds(curve, bounds);
      if (!points) return;
      constructions.push({
        id: `make_${id}`,
        operator: "segment",
        inputs: { start: points[0], end: points[1] },
        outputs: [id],
      });
    } else {
      constructions.push({
        id: `make_${id}`,
        operator: "implicit_curve",
        inputs: { expression: curve.expression, ...bounds, xSamples: samples, ySamples: samples },
        outputs: [id],
      });
    }
    assertions.push({
      id: `exists_${id}`,
      predicate: "exists",
      entities: [id],
      expected: true,
      severity: "fatal",
    });
  });

  if (assertions.length === 0) return null;
  return baseDocument({
    question,
    reason: "curves stated by the question, drawn from their own equations",
    quantities: [],
    entities: entities.filter((entity) =>
      entity.id === "axes" || constructions.some((c) => c.outputs.includes(entity.id))),
    constructions,
    assertions,
  });
}

/** A readable equation for the label, rebuilt from the fitted coefficients. */
function statedCurveLabel(curve: StatedCurve): string {
  if (curve.kind === "circle" && curve.anchor && curve.radius) {
    const squared = Number((curve.radius * curve.radius).toFixed(2));
    const xPart = Math.abs(curve.anchor.x) < 1e-9 ? "x^2" : `(x${curve.anchor.x > 0 ? "-" : "+"}${Math.abs(curve.anchor.x)})^2`;
    const yPart = Math.abs(curve.anchor.y) < 1e-9 ? "y^2" : `(y${curve.anchor.y > 0 ? "-" : "+"}${Math.abs(curve.anchor.y)})^2`;
    return `${xPart}+${yPart}=${squared}`;
  }
  return curve.kind;
}

/** Where a stated line crosses the framed box. */
function lineEndpointsInBounds(
  curve: StatedCurve,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
): [[number, number], [number, number]] | null {
  const [, , , d, e] = curve.coefficients;
  const f = curve.coefficients[5];
  const hits: Array<[number, number]> = [];
  const push = (x: number, y: number): void => {
    if (x < bounds.xMin - 1e-6 || x > bounds.xMax + 1e-6) return;
    if (y < bounds.yMin - 1e-6 || y > bounds.yMax + 1e-6) return;
    if (hits.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 1e-6)) return;
    hits.push([x, y]);
  };
  if (Math.abs(e) > 1e-9) {
    push(bounds.xMin, -(d * bounds.xMin + f) / e);
    push(bounds.xMax, -(d * bounds.xMax + f) / e);
  }
  if (Math.abs(d) > 1e-9) {
    push(-(e * bounds.yMin + f) / d, bounds.yMin);
    push(-(e * bounds.yMax + f) / d, bounds.yMax);
  }
  if (hits.length < 2) return null;
  return [hits[0]!, hits[1]!];
}

function buildAnalyticCurve(
  question: string,
  _quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  // Family order puts analytic_curve ahead of bounded_region on some stems; an
  // inequality system is still a region, not a bare curve. Two explicit curves
  // stay with the richer function_region picture.
  if (extractExplicitFunctions(question).length < 2) {
    const constrained = buildConstraintRegionScene(question);
    if (constrained) return constrained;
  }
  // A stated conic outranks anything read out of the prose: it is the curve the
  // question is about, at its own scale and position.
  const stated = buildStatedCurveScene(question);
  if (stated) return stated;
  const parametric = extractParametric(question);
  if (parametric) return buildParametricCurve(question, parametric);
  const expressions = extractExplicitFunctions(question);
  const named = extractNamedPlotExpressions(question);
  const plots = expressions.length > 0 ? expressions : named;
  const domain = extractXInterval(question)
    ?? extractTimeInterval(question)
    ?? (named.includes("1/x^12-1/x^6") ? [0.8, 2.5] as [number, number] : [-2, 2] as [number, number]);
  if (plots.length === 0) {
    if (isProjectileStem(question) || isMotionGraphStem(question)) return null;
    if (/(?:U\(x\) graph|stable and unstable equilibrium|F versus x|graph of F)/i.test(question) && !schematic) {
      const well = /U\(x\)|equilibrium/i.test(question) ? "x^4/4-x^2/2" : "x";
      return plotExpressions(question, [well], domain);
    }
    // Last-resort draws bare axes only when the stem actually asks for a graph;
    // it never paints a canned curve the stem did not name.
    if (schematic) {
      return /(?:graph|curve|plot|sketch|versus|against)/i.test(question)
        ? axesOnly(question, "analytic display axes")
        : null;
    }
    return null;
  }
  return plotExpressions(question, plots, domain);
}

function buildBoundedRegion(
  question: string,
  _quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  const expressions = extractExplicitFunctions(question);
  // Two explicit curves already bound a region, and function_region also draws
  // both boundaries beyond it. Only reach for the inequality system when that
  // pair does not exist: a conic, an axis, or a quadrant clip has no y = f(x).
  if (expressions.length < 2) {
    const constrained = buildConstraintRegionScene(question);
    if (constrained) return constrained;
  }
  if (expressions.length === 0) {
    // No canned 4-x^2: with no curve named by the stem there is nothing honest
    // to bound; the caller falls through to another family or text-only.
    return schematic ? null : buildAnalyticCurve(question, _quantities, schematic);
  }
  const domain = extractBoundX(question) ?? extractXInterval(question) ?? [-2, 2] as [number, number];
  const withAxis = /x-axis|coordinate axes|y\s*=\s*0/i.test(question);
  const curves = expressions.slice(0, 2);
  if (curves.length === 1 && withAxis) curves.push("0");
  if (curves.length < 2) return plotExpressions(question, expressions, domain);
  const ordered = orderRegionCurves(curves, domain);
  if (!ordered) return plotExpressions(question, expressions, domain);
  const clipped = shrinkRegionDomain(ordered.upper, ordered.lower, domain) ?? domain;
  return regionDocument(question, ordered.upper, ordered.lower, clipped);
}

/**
 * Regions stated as an inequality system — the standard "Using integration,
 * find the area of the region {(x, y) : ...}" form, and its prose twin
 * ("bounded by the circle ... and the line ...", which the planar-conic path
 * cannot fill). The constraints are read from the stem and handed to the
 * `constraint_region` operator; nothing here knows which question it is.
 */
interface RegionInequality {
  expression: string;
  relation: "le" | "ge";
}

const REGION_VIEW_RADII = [4, 6, 10, 16, 26] as const;
const REGION_SEARCH_GRID_STEPS = 48;
const REGION_FINAL_GRID_STEPS = 96;
const REGION_MAX_PROSE_CURVES = 3;

function buildConstraintRegionScene(question: string): SceneDocument | null {
  const stated = extractRegionConstraints(question);
  if (stated) {
    const bounds = feasibleRegionBounds(stated, REGION_FINAL_GRID_STEPS);
    if (!bounds) return null;
    const document = constraintRegionDocument(question, stated, bounds);
    return tryCompile(document) ? document : null;
  }
  return buildProseRegionScene(question);
}

/**
 * "Find the area of the region in the first quadrant enclosed by the y-axis,
 * the line y = x and the circle x^2 + y^2 = 32."
 *
 * Prose names the boundaries but never says which side of each one the region
 * lies on. Rather than guess, every side assignment is tried and kept only if
 * the result is a single bounded region in which **every named boundary
 * actually bounds it** — dropping that curve would change the area. Exactly one
 * assignment must survive; a stem that stays ambiguous gets no picture.
 */
function buildProseRegionScene(question: string): SceneDocument | null {
  const named = extractProseRegionCurves(question);
  if (!named) return null;
  const { curves, filters } = named;
  const candidates: SceneDocument[] = [];
  for (let mask = 0; mask < 1 << curves.length; mask += 1) {
    const sided: RegionInequality[] = curves.map((expression, index) => ({
      expression,
      relation: (mask >> index) & 1 ? "ge" : "le",
    }));
    const constraints = [...sided, ...filters];
    const bounds = feasibleRegionBounds(constraints, REGION_SEARCH_GRID_STEPS);
    if (!bounds) continue;
    if (!sided.every((_, index) => constraintIsBinding(constraints, index, bounds))) continue;
    const finalBounds = feasibleRegionBounds(constraints, REGION_FINAL_GRID_STEPS);
    if (!finalBounds) continue;
    const document = constraintRegionDocument(question, constraints, finalBounds);
    if (tryCompile(document)) candidates.push(document);
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

/** A boundary earns its place only if removing it changes the feasible area. */
function constraintIsBinding(
  constraints: RegionInequality[],
  index: number,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
): boolean {
  const withConstraint = feasibleCellCount(constraints, bounds);
  if (withConstraint === 0) return false;
  const without = feasibleCellCount(constraints.filter((_, at) => at !== index), bounds);
  return without > withConstraint * 1.05;
}

function feasibleCellCount(
  constraints: RegionInequality[],
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
): number {
  const satisfied = regionPredicate(constraints);
  if (!satisfied) return 0;
  const steps = REGION_SEARCH_GRID_STEPS;
  let count = 0;
  for (let xIndex = 0; xIndex <= steps; xIndex += 1) {
    const x = bounds.xMin + ((bounds.xMax - bounds.xMin) * xIndex) / steps;
    for (let yIndex = 0; yIndex <= steps; yIndex += 1) {
      const y = bounds.yMin + ((bounds.yMax - bounds.yMin) * yIndex) / steps;
      if (satisfied(x, y)) count += 1;
    }
  }
  return count;
}

/**
 * Boundary curves named in prose, plus the quadrant filter. A named axis is the
 * quadrant's own edge, so the redundant half-plane is dropped — otherwise every
 * axis would test as non-binding and no assignment could ever be chosen.
 */
function extractProseRegionCurves(
  question: string,
): { curves: string[]; filters: RegionInequality[] } | null {
  const stem = question.replace(/[−–—]/g, "-");
  if (!/area of the (?:shaded )?region/i.test(stem)) return null;
  if (!/(?:bounded by|enclosed by|enclosed between|bounded between)/i.test(stem)) return null;
  const curves: string[] = [];
  const push = (expression: string | null): void => {
    if (expression && !curves.includes(expression)) curves.push(expression);
  };
  const namesYAxis = /\by[-\s]?axis\b/i.test(stem);
  const namesXAxis = /\bx[-\s]?axis\b/i.test(stem);
  if (namesYAxis) push("x");
  if (namesXAxis) push("y");
  // Only expression characters, so the match cannot swallow the prose that
  // introduces the curve ("the line y = x" must yield `y`, not `the line y`).
  // Whitespace is part of the class because exam text wraps mid-equation.
  for (const match of stem.matchAll(/([0-9xy^+\-*/().\s]{1,40})=([0-9xy^+\-*/().\s]{1,40}?)(?=[,;.]|\s*\band\b|$)/gi)) {
    const left = normalizeRegionExpression(match[1] ?? "", null);
    const right = normalizeRegionExpression(match[2] ?? "", null);
    if (!left || !right) continue;
    if (!/[xy]/.test(left) && !/[xy]/.test(right)) continue;
    const expression = `(${left})-(${right})`;
    try { parseMathExpression2D(expression); } catch { continue; }
    push(expression);
  }
  if (curves.length < 2 || curves.length > REGION_MAX_PROSE_CURVES) return null;
  const filters: RegionInequality[] = [];
  if (/\b(?:first|1st|i)\s*quadrant\b/i.test(stem)) {
    if (!namesYAxis) filters.push({ expression: "x", relation: "ge" });
    if (!namesXAxis) filters.push({ expression: "y", relation: "ge" });
  }
  if (curves.length + filters.length > 6) return null;
  return { curves, filters };
}

function regionPredicate(
  constraints: RegionInequality[],
): ((x: number, y: number) => boolean) | null {
  const parsed: Array<{ evaluate: (x: number, y: number) => number; sign: number }> = [];
  for (const constraint of constraints) {
    try {
      const expression = parseMathExpression2D(constraint.expression);
      parsed.push({
        evaluate: (x, y) => expression.evaluate(x, y),
        sign: constraint.relation === "le" ? -1 : 1,
      });
    } catch {
      return null;
    }
  }
  return (x: number, y: number): boolean => {
    for (const constraint of parsed) {
      let value: number;
      try { value = constraint.sign * constraint.evaluate(x, y); } catch { return false; }
      if (!(value >= 0)) return false;
    }
    return true;
  };
}

function constraintRegionDocument(
  question: string,
  constraints: RegionInequality[],
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
): SceneDocument {
  return baseDocument({
    question,
    reason: "region satisfying the inequalities stated in the question",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      {
        id: "region",
        kind: "polygon",
        role: "region satisfying the stated inequalities",
        label: compactLabel(regionLabel(constraints)),
      },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { ...bounds }, outputs: ["axes"] },
      {
        id: "make_region",
        operator: "constraint_region",
        inputs: { constraints, ...bounds, samples: 65 },
        outputs: ["region"],
      },
    ],
    assertions: [
      { id: "region_exists", predicate: "exists", entities: ["region"], expected: true, severity: "fatal" },
    ],
  });
}

function regionLabel(constraints: RegionInequality[]): string {
  const first = constraints[0];
  if (!first) return "region";
  const rendered = `${first.expression}${first.relation === "le" ? "<=0" : ">=0"}`;
  return constraints.length > 1 ? `${rendered}, ...` : rendered;
}

/**
 * Coarse feasibility grid at growing view radii. The first radius that contains
 * the whole feasible set with clearance wins; a set still touching the widest
 * frame is unbounded and gets no picture.
 */
function feasibleRegionBounds(
  constraints: RegionInequality[],
  steps: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const satisfied = regionPredicate(constraints);
  if (!satisfied) return null;
  for (const radius of REGION_VIEW_RADII) {
    let xLow = Infinity; let xHigh = -Infinity; let yLow = Infinity; let yHigh = -Infinity;
    let hits = 0;
    for (let xIndex = 0; xIndex <= steps; xIndex += 1) {
      const x = -radius + (2 * radius * xIndex) / steps;
      for (let yIndex = 0; yIndex <= steps; yIndex += 1) {
        const y = -radius + (2 * radius * yIndex) / steps;
        if (!satisfied(x, y)) continue;
        hits += 1;
        xLow = Math.min(xLow, x); xHigh = Math.max(xHigh, x);
        yLow = Math.min(yLow, y); yHigh = Math.max(yHigh, y);
      }
    }
    if (hits < 12) continue;
    const margin = (2 * radius) / steps;
    const clear = xLow > -radius + margin && xHigh < radius - margin
      && yLow > -radius + margin && yHigh < radius - margin;
    if (!clear) continue;
    // Pad outward, and keep the origin in frame so the axes read as axes.
    const padX = Math.max((xHigh - xLow) * 0.18, radius * 0.05);
    const padY = Math.max((yHigh - yLow) * 0.18, radius * 0.05);
    return {
      xMin: Math.min(0, xLow - padX),
      xMax: Math.max(0, xHigh + padX),
      yMin: Math.min(0, yLow - padY),
      yMax: Math.max(0, yHigh + padY),
    };
  }
  return null;
}

/** Read an inequality system out of a stem, or null when there is not one. */
function extractRegionConstraints(question: string): RegionInequality[] | null {
  if (!/(?:area|region)/i.test(question)) return null;
  const body = regionSetBuilderBody(question);
  if (!body) return null;
  const parameter = singleRegionParameter(question, body);
  const constraints: RegionInequality[] = [];
  for (const clause of body.split(",")) {
    for (const inequality of splitChainedInequality(clause)) {
      const parsedInequality = parseRegionInequality(inequality, parameter);
      // A clause we cannot read (a stray OCR fragment, an unsupported symbol)
      // could be the one that bounds the set; drawing the rest would be a
      // different region.
      if (parsedInequality === "unreadable") return null;
      if (parsedInequality) constraints.push(parsedInequality);
    }
  }
  if (constraints.length < 2 || constraints.length > 6) return null;
  return constraints;
}

/** The `...` inside `{(x, y) : ...}`. */
function regionSetBuilderBody(question: string): string | null {
  const match = /\{\s*\(\s*x\s*,\s*y\s*\)\s*[:|]([^}]{4,240})\}/i.exec(
    question.replace(/[−–—]/g, "-"),
  );
  return match?.[1] ?? null;
}

/**
 * A single declared-positive symbolic scale (`a > 0`). Such a region is similar
 * for every positive value, so drawing it at 1 is the honest qualitative
 * picture rather than a guess.
 */
function singleRegionParameter(question: string, body: string): string | null {
  const declared = /\b([a-z])\s*>\s*0\b/i.exec(question);
  const letters = new Set(
    [...body.matchAll(/[a-z]/gi)].map((match) => match[0]!.toLowerCase()),
  );
  letters.delete("x");
  letters.delete("y");
  if (letters.size !== 1) return null;
  const [only] = [...letters];
  if (!only || !declared || declared[1]?.toLowerCase() !== only) return null;
  return only;
}

/** `a <= b <= c` becomes `a <= b` and `b <= c`. */
function splitChainedInequality(clause: string): string[] {
  const parts = clause.split(/(<=|>=|≤|≥|<|>)/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3 || parts.length % 2 === 0) return [clause];
  const pieces: string[] = [];
  for (let index = 0; index + 2 < parts.length + 1; index += 2) {
    const left = parts[index];
    const operator = parts[index + 1];
    const right = parts[index + 2];
    if (!left || !operator || !right) break;
    pieces.push(`${left}${operator}${right}`);
  }
  return pieces.length > 0 ? pieces : [clause];
}

function parseRegionInequality(
  clause: string,
  parameter: string | null,
): RegionInequality | null | "unreadable" {
  const trimmed = clause.trim();
  if (!trimmed) return null;
  const match = /^(.+?)(<=|>=|≤|≥|<|>)(.+)$/.exec(trimmed);
  // A clause with no comparison at all is a qualifier such as "a > 0" already
  // consumed as the scale, or plain prose; it constrains nothing to draw.
  if (!match) return /[<>=]/.test(trimmed) ? "unreadable" : null;
  const [, leftRaw, operatorRaw, rightRaw] = match;
  const left = normalizeRegionExpression(leftRaw ?? "", parameter);
  const right = normalizeRegionExpression(rightRaw ?? "", parameter);
  if (!left || !right) return "unreadable";
  // The scale qualifier itself ("a > 0" -> "1 > 0") carries no geometry.
  if (!/[xy]/.test(left) && !/[xy]/.test(right)) return null;
  const expression = `(${left})-(${right})`;
  try {
    parseMathExpression2D(expression);
  } catch {
    return "unreadable";
  }
  const relation = operatorRaw === "<=" || operatorRaw === "≤" || operatorRaw === "<" ? "le" : "ge";
  return { expression, relation };
}

/** OCR-tolerant normalisation into the bounded 2-D expression language. */
function normalizeRegionExpression(raw: string, parameter: string | null): string | null {
  let source = raw
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "");
  if (!source) return null;
  if (parameter) {
    source = source.replace(new RegExp(parameter, "gi"), "1");
  }
  // Exam OCR drops the caret: x2 and y2 are squares, never products.
  source = source.replace(/([xy])(\d)\b/g, "$1^$2");
  // Implicit multiplication: 2y, 3x, 2(x+1), )(, x y.
  source = source.replace(/(\d)([xy(])/g, "$1*$2");
  source = source.replace(/([xy)])(\()/g, "$1*$2");
  source = source.replace(/([xy])([xy])/g, "$1*$2");
  source = source.replace(/(\))(\d)/g, "$1*$2");
  if (!/^[0-9xy+\-*/^().]+$/.test(source)) return null;
  return source;
}

function shrinkRegionDomain(
  upper: string,
  lower: string,
  domain: [number, number],
): [number, number] | null {
  try {
    const u = parseMathExpression(upper);
    const l = parseMathExpression(lower);
    const samples = Array.from({ length: 65 }, (_, index) => domain[0] + (domain[1] - domain[0]) * index / 64);
    const good = samples.filter((x) => u.evaluate(x) + 1e-9 >= l.evaluate(x));
    if (good.length < 8) return null;
    const start = good[0]!;
    const end = good[good.length - 1]!;
    if (!(start < end)) return null;
    return [start, end];
  } catch {
    return null;
  }
}

function orderRegionCurves(
  expressions: string[],
  domain: [number, number],
): { upper: string; lower: string } | null {
  const [first, second] = expressions;
  if (!first || !second) return null;
  try {
    const a = parseMathExpression(first);
    const b = parseMathExpression(second);
    const samples = [0.25, 0.5, 0.75].map((t) => domain[0] + t * (domain[1] - domain[0]));
    const aAbove = samples.filter((x) => a.evaluate(x) + 1e-9 >= b.evaluate(x)).length;
    if (aAbove >= 2) return { upper: first, lower: second };
    return { upper: second, lower: first };
  } catch {
    return null;
  }
}

function regionDocument(
  question: string,
  upper: string,
  lower: string,
  domain: [number, number],
): SceneDocument {
  return baseDocument({
    question,
    reason: "region bounded by function curves",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      { id: "upper", kind: "polyline", role: "upper boundary", label: compactLabel(`y=${upper}`) },
      { id: "lower", kind: "polyline", role: "lower boundary", label: compactLabel(`y=${lower}`) },
      { id: "region", kind: "polygon", role: "bounded region" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: domain[0], xMax: domain[1], yMin: -2, yMax: 4 }, outputs: ["axes"] },
      {
        id: "make_upper",
        operator: "function_curve",
        inputs: { expression: upper, variable: "x", xMin: domain[0], xMax: domain[1], samples: 65 },
        outputs: ["upper"],
      },
      {
        id: "make_lower",
        operator: "function_curve",
        inputs: { expression: lower, variable: "x", xMin: domain[0], xMax: domain[1], samples: 65 },
        outputs: ["lower"],
      },
      {
        id: "make_region",
        operator: "function_region",
        inputs: { upper: "upper", lower: "lower", xMin: domain[0], xMax: domain[1], samples: 65 },
        outputs: ["region"],
      },
    ],
    assertions: [
      { id: "region_exists", predicate: "exists", entities: ["region"], expected: true, severity: "fatal" },
    ],
  });
}

function plotExpressions(
  question: string,
  expressions: string[],
  domain: [number, number],
): SceneDocument {
  const yMin = -2;
  const yMax = 4;
  const entities: SceneEntity[] = [{ id: "axes", kind: "axes", role: "display axes" }];
  const constructions: SceneConstruction[] = [{
    id: "make_axes",
    operator: "axes",
    inputs: { xMin: domain[0], xMax: domain[1], yMin, yMax },
    outputs: ["axes"],
  }];
  expressions.forEach((expression, index) => {
    const id = `curve_${index + 1}`;
    entities.push({
      id,
      kind: "polyline",
      role: "explicit function graph",
      label: compactLabel(`y=${expression}`),
    });
    constructions.push({
      id: `make_${id}`,
      operator: "function_curve",
      inputs: { expression, variable: "x", xMin: domain[0], xMax: domain[1], samples: 65 },
      outputs: [id],
    });
  });
  return baseDocument({
    question,
    reason: "function curves copied from the submitted question",
    quantities: [],
    entities,
    constructions,
    assertions: entities.map((entity, index) => ({
      id: `exists_${index + 1}`,
      predicate: "exists",
      entities: [entity.id],
      expected: true,
      severity: "fatal" as const,
    })),
  });
}

function buildStatePlot(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (isKinematicsVtStem(question)) {
    return kinematicsVtDocument(question);
  }
  if (isIvCharacteristicStem(normalizeStem(question))) {
    return ivCharacteristicDocument(question);
  }
  if (isNamedVariationPlotStem(normalizeStem(question))) {
    return variationLineDocument(question);
  }
  const pressures = quantities.filter((quantity) => /^p\d*$/i.test(normalizeKey(quantity.symbol))
    || /^p\d*$/i.test(normalizeKey(quantity.id)));
  const volumes = quantities.filter((quantity) => /^v\d*$/i.test(normalizeKey(quantity.symbol))
    || /^v\d*$/i.test(normalizeKey(quantity.id)));
  const closed = /(?:cycle|clockwise|rectangular)/i.test(question);
  if (!schematic && pressures.length < 2 && volumes.length < 2 && !closed) return null;
  const namedCycle = closed
    || /(?:cyclic|thermodynamic|isothermal|adiabatic|isobaric|isochoric|carnot|indicator diagram|p\s*[-–]?\s*[vt]\s*(?:diagram|graph)|pressure.{0,40}volume|volume.{0,40}pressure)/i.test(question);
  if (schematic && pressures.length < 2 && volumes.length < 2 && !namedCycle) return null;
  const axisLabel = /p\s*[-–]?\s*t\s*(?:diagram|graph)/i.test(question) ? "P-T" : "P-V";
  const corners = [
    { id: "A", x: -2, y: -1.5 },
    { id: "B", x: 2, y: -1.5 },
    { id: "C", x: 2, y: 1.5 },
    { id: "D", x: -2, y: 1.5 },
  ];
  return baseDocument({
    question,
    reason: "display-scaled thermodynamic state plot",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "PV axes", label: axisLabel },
      ...corners.map((corner) => ({ id: corner.id, kind: "point", role: "named state", label: corner.id })),
      { id: "cycle", kind: "polygon", role: "process cycle" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -2.5, yMax: 2.5 }, outputs: ["axes"] },
      ...corners.map((corner) => pointAt(corner.id, corner.x, corner.y)),
      {
        id: "make_cycle",
        operator: "polygon",
        inputs: { points: corners.map((corner) => corner.id) },
        outputs: ["cycle"],
      },
    ],
    annotations: [
      { id: "cycle_fill", kind: "highlight", targetIds: ["cycle"], style: { transient: false } },
      { id: "drop_A", kind: "drop", targetIds: ["A", "axes"] },
    ],
    assertions: [
      { id: "A_exists", predicate: "exists", entities: ["A"], expected: true, severity: "fatal" },
      { id: "cycle_exists", predicate: "exists", entities: ["cycle"], expected: true, severity: "fatal" },
    ],
  });
}

function buildContactBody(
  question: string,
  quantities: PlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  const stem = normalizeStem(question);
  if (/(?:pulley|blocks? connected|hanging (?:mass|block))/i.test(stem)
    && !/(?:hanging over|hanging from the table)/i.test(stem)) {
    return pulleyDocument(question);
  }
  if (/(?:hinged|hinge|uniform (?:rod|bar)|physical pendulum)/i.test(stem)
    && !/(?:simple pendulum|pendulum of length|conical pendulum|pendulum hangs)/i.test(stem)) {
    return hingedRodDocument(question, quantities);
  }
  if (/(?:vertical circl|whirled|circular loop|circular path of constant radius|completes a (?:full )?vertical)/i.test(stem)) {
    return verticalCircleDocument(question, quantities);
  }
  if (/(?:conical pendulum|string now makes|bob has mass)/i.test(stem)
    || (/(?:string|bob).{0,80}with the vertical/i.test(stem) && !/(?:concurrent|two strings)/i.test(stem))) {
    return conicalPendulumDocument(question, quantities);
  }
  if (/(?:simple pendulum|pendulum of length|bob of mass|pendulum hangs)/i.test(stem)) {
    return pendulumDocument(question, quantities);
  }
  if (/(?:incline|inclined plane|slope|banked|frictionless bank|up the bank)/i.test(stem)) {
    return inclineDocument(question, angleDegrees(quantities, question) ?? 30);
  }
  if (isCircularMotionStem(stem)) {
    return circularMotionDocument(question);
  }
  if (/(?:spring of stiffness|spring of force constant|force constant|spring-block|unstretched springs|springs S1|elastic potential)/i.test(stem)) {
    return springDocument(question);
  }
  if (isProjectileStem(stem)) {
    return projectileDocument(question, quantities);
  }
  if (isFallingStem(stem)) {
    return fallingBodyDocument(question);
  }
  if (/(?:collid(?:e|es|ing|ed)|collision|head-on|sticks to|embeds in|ballistic pendulum|glancing collision|coefficient of restitution|impulse|batsman|recoil|on ice)/i.test(stem)) {
    return collisionDocument(question);
  }
  if (isHangingWiresLoadStem(stem)) {
    return hangingWiresLoadDocument(question);
  }
  if (/(?:hanging over|hanging from the table)/i.test(stem)) {
    return hangingChainDocument(question);
  }
  if (/(?:leans against a wall|ladder of mass)/i.test(stem)) {
    return ladderDocument(question, quantities);
  }
  if (/(?:rolling friction|coefficient of rolling friction|wheel on a horizontal)/i.test(stem)) {
    return wheelOnRoadDocument(question);
  }
  if (/(?:moved slowly around a closed|closed \d+(?:\.\d+)?\s*m\s*[×x])/i.test(stem)) {
    return squarePathDocument(question);
  }
  if (/circular park/i.test(stem)) {
    return circularParkDocument(question);
  }
  if (isRelativeVelocityStem(stem)) {
    return relativeVelocityDocument(question);
  }
  if (isKinematicsMotionStem(stem)) {
    return particleMotionDocument(question);
  }
  if (/(?:pushes a (?:box|block)|force (?:pushes|pulls|acts through)|towed at|frictionless horizontal|work done by (?:a |the )?(?:constant |unknown )?force)/i.test(stem)) {
    return appliedForceBlockDocument(question);
  }
  if (/(?:\d+(?:\.\d+)?\s*kg (?:particle|block|mass|cart|wad)|particle of mass|body of mass|block of mass|box of mass|particle moves|moves along a straight line)/i.test(stem)) {
    return particleMotionDocument(question);
  }
  if (
    /(?:moment of inertia|rotational|rotating|rotates|rotated|rotation|angular (?:speed|velocity|momentum|acceleration)|spinning|spun|spins)/i.test(stem)
  ) {
    return rigidBodyAxisDocument(question);
  }
  if (
    !/(?:free[- ]body|friction|normal reaction|pseudo force|\blift\b|\belevator\b|rests on a table|truck that accelerates)/i.test(stem)
  ) {
    return null;
  }
  return blockOnSurfaceDocument(question);
}

function rigidBodyAxisDocument(question: string): SceneDocument {
  const twoBodies = /(?:\btwo\b|\bboth\b|face to face|brought into contact|assembly)/i.test(question);
  const rodLike = /(?:\brod\b|\bbars?\b)/i.test(question)
    && !/(?:disc|disk|sphere|shell|ring|cylinder|roller)/i.test(question);
  if (twoBodies) {
    return baseDocument({
      question,
      reason: "two rotating rigid bodies on a shared rotation axis",
      quantities: [],
      entities: [
        { id: "c1", kind: "point", role: "first body center" },
        { id: "c2", kind: "point", role: "second body center" },
        { id: "axis_l", kind: "point", role: "axis end" },
        { id: "axis_r", kind: "point", role: "axis end" },
        { id: "body1", kind: "circle", role: "rotating body", label: "1" },
        { id: "body2", kind: "circle", role: "rotating body", label: "2" },
        { id: "axis", kind: "segment", role: "rotation axis", label: "axis" },
      ],
      constructions: [
        pointAt("c1", -1.7, 0),
        pointAt("c2", 1.7, 0),
        pointAt("axis_l", -3.4, 0),
        pointAt("axis_r", 3.4, 0),
        { id: "make_body1", operator: "circle", inputs: { center: "c1", radius: 1.1 }, outputs: ["body1"] },
        { id: "make_body2", operator: "circle", inputs: { center: "c2", radius: 1.1 }, outputs: ["body2"] },
        { id: "make_axis", operator: "segment", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] },
      ],
      assertions: [
        { id: "bodies_exist", predicate: "exists", entities: ["body1", "body2"], expected: true, severity: "fatal" },
        { id: "c1_on_axis", predicate: "on", entities: ["c1", "axis"], expected: true, severity: "fatal" },
        { id: "c2_on_axis", predicate: "on", entities: ["c2", "axis"], expected: true, severity: "fatal" },
      ],
    });
  }
  if (rodLike) {
    return baseDocument({
      question,
      reason: "rigid rod with the rotation axis through its centre",
      quantities: [],
      entities: [
        { id: "rod_l", kind: "point", role: "rod end" },
        { id: "rod_r", kind: "point", role: "rod end" },
        { id: "center", kind: "point", role: "rod centre", label: "C" },
        { id: "axis_t", kind: "point", role: "axis end" },
        { id: "axis_b", kind: "point", role: "axis end" },
        { id: "rod", kind: "segment", role: "rigid rod", label: "rod" },
        { id: "axis", kind: "segment", role: "rotation axis", label: "axis" },
      ],
      constructions: [
        pointAt("rod_l", -2.4, 0),
        pointAt("rod_r", 2.4, 0),
        pointAt("center", 0, 0),
        pointAt("axis_t", 0, 1.8),
        pointAt("axis_b", 0, -1.8),
        { id: "make_rod", operator: "segment", inputs: { start: "rod_l", end: "rod_r" }, outputs: ["rod"] },
        { id: "make_axis", operator: "segment", inputs: { start: "axis_b", end: "axis_t" }, outputs: ["axis"] },
      ],
      assertions: [
        { id: "rod_exists", predicate: "exists", entities: ["rod"], expected: true, severity: "fatal" },
        { id: "center_on_rod", predicate: "on", entities: ["center", "rod"], expected: true, severity: "fatal" },
        { id: "axis_perp_rod", predicate: "perpendicular", entities: ["axis", "rod"], expected: true, severity: "fatal" },
      ],
    });
  }
  return baseDocument({
    question,
    reason: "rigid body with the rotation axis through its centre",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "body centre", label: "C" },
      { id: "axis_t", kind: "point", role: "axis end" },
      { id: "axis_b", kind: "point", role: "axis end" },
      { id: "body", kind: "circle", role: "rotating body", label: "m" },
      { id: "axis", kind: "segment", role: "rotation axis", label: "axis" },
    ],
    constructions: [
      pointAt("center", 0, 0),
      pointAt("axis_t", 0, 2.2),
      pointAt("axis_b", 0, -2.2),
      { id: "make_body", operator: "circle", inputs: { center: "center", radius: 1.4 }, outputs: ["body"] },
      { id: "make_axis", operator: "segment", inputs: { start: "axis_b", end: "axis_t" }, outputs: ["axis"] },
    ],
    assertions: [
      { id: "body_exists", predicate: "exists", entities: ["body"], expected: true, severity: "fatal" },
      { id: "center_on_axis", predicate: "on", entities: ["center", "axis"], expected: true, severity: "fatal" },
    ],
  });
}

function pulleyDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "two-mass pulley apparatus from the contact-body family",
    quantities: [],
    entities: [
      { id: "axle", kind: "point", role: "pulley center" },
      { id: "left_mass", kind: "point", role: "left mass center" },
      { id: "right_mass", kind: "point", role: "right mass center" },
      { id: "pulley", kind: "circle", role: "pulley" },
      { id: "left_block", kind: "rectangle", role: "hanging block", label: "m1" },
      { id: "right_block", kind: "rectangle", role: "hanging block", label: "m2" },
      { id: "left_string", kind: "segment", role: "string" },
      { id: "right_string", kind: "segment", role: "string" },
    ],
    constructions: [
      pointAt("axle", 0, 2),
      pointAt("left_mass", -1.2, -1),
      pointAt("right_mass", 1.2, 0),
      { id: "make_pulley", operator: "circle", inputs: { center: "axle", radius: 0.6 }, outputs: ["pulley"] },
      { id: "make_left_block", operator: "rectangle", inputs: { center: "left_mass", width: 0.8, height: 0.6 }, outputs: ["left_block"] },
      { id: "make_right_block", operator: "rectangle", inputs: { center: "right_mass", width: 0.8, height: 0.6 }, outputs: ["right_block"] },
      { id: "make_left_string", operator: "segment", inputs: { start: "left_mass", end: "axle" }, outputs: ["left_string"] },
      { id: "make_right_string", operator: "segment", inputs: { start: "right_mass", end: "axle" }, outputs: ["right_string"] },
    ],
    assertions: [
      { id: "pulley_exists", predicate: "exists", entities: ["pulley"], expected: true, severity: "fatal" },
      { id: "strings_exist", predicate: "exists", entities: ["left_string", "right_string"], expected: true, severity: "fatal" },
    ],
  });
}

function hingedRodDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 30;
  return baseDocument({
    question,
    reason: "hinged rod from a shared hinge and rotate",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "hinge", kind: "point", role: "hinge", label: "H" },
      { id: "free_h", kind: "point", role: "horizontal rod end" },
      { id: "free_v", kind: "point", role: "rotated rod end" },
      { id: "mid", kind: "point", role: "centre of mass" },
      { id: "rod", kind: "segment", role: "uniform rod", label: "rod" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
    ],
    constructions: [
      pointAt("hinge", 0, 0),
      pointAt("free_h", 3, 0),
      {
        id: "make_free_v",
        operator: "rotate",
        inputs: { point: "free_h", center: "hinge", angle: -theta, angleUnit: "degrees" },
        outputs: ["free_v"],
      },
      { id: "make_mid", operator: "midpoint", inputs: { a: "hinge", b: "free_v" }, outputs: ["mid"] },
      { id: "make_rod", operator: "segment", inputs: { start: "hinge", end: "free_v" }, outputs: ["rod"] },
      { id: "make_weight", operator: "vector", inputs: { start: "mid", direction: [0, -1], length: 1 }, outputs: ["weight"] },
    ],
    assertions: [
      { id: "equal_length", predicate: "equal_length", entities: ["hinge", "free_h", "hinge", "free_v"], expected: true, severity: "fatal" },
      { id: "mid_on_rod", predicate: "on", entities: ["mid", "rod"], expected: true, severity: "fatal" },
    ],
  });
}

function inclineDocument(question: string, theta: number): SceneDocument {
  const radians = theta * Math.PI / 180;
  const endX = 4 * Math.cos(radians);
  const endY = 4 * Math.sin(radians);
  const contactX = endX * 0.45;
  const contactY = endY * 0.45;
  const rollingBody = /(?:roll(?:s|ing)?(?:\s+without\s+slipping)?|solid cylinder|\bdisc\b|\bdisk\b|\bsphere\b)/i.test(question);
  const bodyRadius = 0.55;
  const bodyCenterX = contactX + (-Math.sin(radians)) * bodyRadius;
  const bodyCenterY = contactY + Math.cos(radians) * bodyRadius;
  const weightStart = rollingBody ? "body_center" : "contact";
  return baseDocument({
    question,
    reason: rollingBody
      ? "inclined-plane contact body with a circular rolling section and derived normal"
      : "inclined-plane contact body with derived normal",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "base", kind: "point", role: "incline foot" },
      { id: "top", kind: "point", role: "incline top" },
      { id: "contact", kind: "point", role: "contact point" },
      { id: "incline", kind: "segment", role: "inclined plane" },
      { id: "normal", kind: "vector", role: "normal reaction", label: "N" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      ...(rollingBody
        ? [
            { id: "body_center", kind: "point" as const, role: "rolling body center" },
            { id: "body", kind: "circle" as const, role: "rolling body", label: "m" },
          ]
        : []),
    ],
    constructions: [
      pointAt("base", 0, 0),
      pointAt("top", endX, endY),
      pointAt("contact", contactX, contactY),
      { id: "make_incline", operator: "segment", inputs: { start: "base", end: "top" }, outputs: ["incline"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "incline" }, outputs: ["normal"] },
      { id: "make_weight", operator: "vector", inputs: { start: weightStart, direction: [0, -1], length: 1.2 }, outputs: ["weight"] },
      ...(rollingBody
        ? [
            pointAt("body_center", bodyCenterX, bodyCenterY),
            {
              id: "make_body",
              operator: "circle" as const,
              inputs: { center: "body_center", radius: bodyRadius },
              outputs: ["body"],
            },
          ]
        : []),
    ],
    annotations: [
      { id: "incline_hatch", kind: "hatch", targetIds: ["incline"] },
      { id: "contact_frame", kind: "frame", targetIds: ["contact", "incline"] },
    ],
    assertions: [
      { id: "contact_on_incline", predicate: "on", entities: ["contact", "incline"], expected: true, severity: "fatal" },
      { id: "normal_perp", predicate: "perpendicular", entities: ["normal", "incline"], expected: true, severity: "fatal" },
      ...(rollingBody
        ? [{ id: "body_exists", predicate: "exists" as const, entities: ["body"], expected: true, severity: "fatal" as const }]
        : []),
    ],
  });
}

function blockOnSurfaceDocument(question: string): SceneDocument {
  const stem = normalizeStem(question);
  const pseudo = /(?:pseudo force|truck that accelerates|floor of a truck)/i.test(stem);
  const lift = /\blift\b|\belevator\b/i.test(stem);
  return baseDocument({
    question,
    reason: pseudo
      ? "block in a non-inertial frame with weight, normal, and pseudo force"
      : lift
        ? "body in a lift with weight and acceleration"
        : "block on a horizontal surface with weight and normal",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "block center" },
      { id: "contact", kind: "point", role: "contact point" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      { id: "normal", kind: "vector", role: "normal reaction", label: "N" },
      ...(pseudo
        ? [{ id: "pseudo", kind: "vector" as const, role: "pseudo force", label: "ma" }]
        : []),
      ...(lift
        ? [{ id: "accel", kind: "vector" as const, role: "lift acceleration", label: "a" }]
        : []),
    ],
    constructions: [
      pointAt("center", 0, 0.4),
      pointAt("contact", 0, 0),
      pointAt("left", -2, 0),
      pointAt("right", 2, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.2, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      { id: "make_weight", operator: "vector", inputs: { start: "center", direction: [0, -1], length: 1 }, outputs: ["weight"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "surface" }, outputs: ["normal"] },
      ...(pseudo
        ? [{
            id: "make_pseudo",
            operator: "vector" as const,
            inputs: { start: "center", direction: [-1, 0], length: 1.2 },
            outputs: ["pseudo"],
          }]
        : []),
      ...(lift
        ? [{
            id: "make_accel",
            operator: "vector" as const,
            inputs: { start: "center", direction: [0, 1], length: 0.9 },
            outputs: ["accel"],
          }]
        : []),
    ],
    assertions: [
      { id: "surface_exists", predicate: "exists", entities: ["surface"], expected: true, severity: "fatal" },
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
      { id: "contact_on_surface", predicate: "on", entities: ["contact", "surface"], expected: true, severity: "fatal" },
    ],
  });
}

function appliedForceBlockDocument(question: string): SceneDocument {
  const perpendicular = /perpendicular to (?:the )?(?:\d+(?:\.\d+)?\s*m )?displacement/i.test(question);
  return baseDocument({
    question,
    reason: perpendicular
      ? "block, applied force, and perpendicular displacement"
      : "block with applied force along the displacement",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "block center" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "force", kind: "vector", role: "applied force", label: "F" },
      { id: "displacement", kind: "vector", role: "displacement", label: "d" },
    ],
    constructions: [
      pointAt("center", 0, 0.4),
      pointAt("left", -2.4, 0),
      pointAt("right", 2.8, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.2, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      {
        id: "make_force",
        operator: "vector",
        inputs: perpendicular
          ? { start: "center", direction: [0, 1], length: 1.4 }
          : { start: "center", direction: [1, 0], length: 1.6 },
        outputs: ["force"],
      },
      { id: "make_displacement", operator: "vector", inputs: { start: "center", direction: [1, 0], length: 2.2 }, outputs: ["displacement"] },
    ],
    assertions: [
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
      { id: "force_exists", predicate: "exists", entities: ["force"], expected: true, severity: "fatal" },
      { id: "displacement_exists", predicate: "exists", entities: ["displacement"], expected: true, severity: "fatal" },
    ],
  });
}

function fallingBodyDocument(question: string): SceneDocument {
  const resistive = /(?:resistive|air (?:drag|resistance)|unknown resistive)/i.test(question);
  return baseDocument({
    question,
    reason: resistive
      ? "vertical drop with weight and a resistive force"
      : "vertical drop from a stated height",
    quantities: [],
    entities: [
      { id: "ground_left", kind: "point", role: "ground end" },
      { id: "ground_right", kind: "point", role: "ground end" },
      { id: "start", kind: "point", role: "release point", label: "h" },
      { id: "particle", kind: "point", role: "falling body" },
      { id: "ground", kind: "segment", role: "ground" },
      { id: "path", kind: "segment", role: "drop" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      ...(resistive
        ? [{ id: "resist", kind: "vector" as const, role: "resistive force", label: "R" }]
        : []),
    ],
    constructions: [
      pointAt("ground_left", -1.6, 0),
      pointAt("ground_right", 1.6, 0),
      pointAt("start", 0, 3.2),
      pointAt("particle", 0, 2.4),
      { id: "make_ground", operator: "segment", inputs: { start: "ground_left", end: "ground_right" }, outputs: ["ground"] },
      { id: "make_path", operator: "segment", inputs: { start: "start", end: "particle" }, outputs: ["path"] },
      { id: "make_weight", operator: "vector", inputs: { start: "particle", direction: [0, -1], length: 1.1 }, outputs: ["weight"] },
      ...(resistive
        ? [{
            id: "make_resist",
            operator: "vector" as const,
            inputs: { start: "particle", direction: [0, 1], length: 0.8 },
            outputs: ["resist"],
          }]
        : []),
    ],
    assertions: [
      { id: "ground_exists", predicate: "exists", entities: ["ground"], expected: true, severity: "fatal" },
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "weight_exists", predicate: "exists", entities: ["weight"], expected: true, severity: "fatal" },
    ],
  });
}

function springDocument(question: string): SceneDocument {
  const twoSprings = /(?:two unstretched springs|springs S1)/i.test(question);
  if (twoSprings) {
    return baseDocument({
      question,
      reason: "block between two springs from shared attachment points",
      quantities: [],
      entities: [
        { id: "wall1", kind: "point", role: "left support" },
        { id: "wall2", kind: "point", role: "right support" },
        { id: "center", kind: "point", role: "block center" },
        { id: "block", kind: "rectangle", role: "block", label: "B" },
        { id: "s1", kind: "segment", role: "spring", label: "S1" },
        { id: "s2", kind: "segment", role: "spring", label: "S2" },
      ],
      constructions: [
        pointAt("wall1", -3, 0.4),
        pointAt("wall2", 3, 0.4),
        pointAt("center", 0, 0.4),
        { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 0.9, height: 0.8 }, outputs: ["block"] },
        { id: "make_s1", operator: "segment", inputs: { start: "wall1", end: "center" }, outputs: ["s1"] },
        { id: "make_s2", operator: "segment", inputs: { start: "center", end: "wall2" }, outputs: ["s2"] },
      ],
      assertions: [
        { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
        { id: "springs_exist", predicate: "exists", entities: ["s1", "s2"], expected: true, severity: "fatal" },
      ],
    });
  }
  return baseDocument({
    question,
    reason: "spring-block on a horizontal surface",
    quantities: [],
    entities: [
      { id: "wall", kind: "point", role: "fixed wall" },
      { id: "center", kind: "point", role: "block center" },
      { id: "left", kind: "point", role: "surface end" },
      { id: "right", kind: "point", role: "surface end" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
      { id: "surface", kind: "segment", role: "contact surface" },
      { id: "spring", kind: "segment", role: "spring", label: "k" },
    ],
    constructions: [
      pointAt("wall", -2.6, 0.4),
      pointAt("center", 0.4, 0.4),
      pointAt("left", -2.8, 0),
      pointAt("right", 2.4, 0),
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 1.0, height: 0.8 }, outputs: ["block"] },
      { id: "make_surface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["surface"] },
      { id: "make_spring", operator: "segment", inputs: { start: "wall", end: "center" }, outputs: ["spring"] },
    ],
    assertions: [
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
      { id: "spring_exists", predicate: "exists", entities: ["spring"], expected: true, severity: "fatal" },
    ],
  });
}

function pendulumDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 30;
  const pseudo = /(?:pseudo force|accelerating horizontally)/i.test(normalizeStem(question));
  return baseDocument({
    question,
    reason: pseudo
      ? "pendulum in an accelerating frame with weight and pseudo force"
      : "simple pendulum displaced from the vertical",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "hinge", kind: "point", role: "support", label: "O" },
      { id: "rest", kind: "point", role: "lowest point" },
      { id: "bob", kind: "point", role: "bob", label: "m" },
      { id: "string", kind: "segment", role: "string" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
      ...(pseudo
        ? [{ id: "pseudo", kind: "vector" as const, role: "pseudo force", label: "ma" }]
        : []),
    ],
    constructions: [
      pointAt("hinge", 0, 2.4),
      pointAt("rest", 0, 0),
      {
        id: "make_bob",
        operator: "rotate",
        inputs: { point: "rest", center: "hinge", angle: -theta, angleUnit: "degrees" },
        outputs: ["bob"],
      },
      { id: "make_string", operator: "segment", inputs: { start: "hinge", end: "bob" }, outputs: ["string"] },
      { id: "make_weight", operator: "vector", inputs: { start: "bob", direction: [0, -1], length: 0.8 }, outputs: ["weight"] },
      ...(pseudo
        ? [{
            id: "make_pseudo",
            operator: "vector" as const,
            inputs: { start: "bob", direction: [-1, 0], length: 0.9 },
            outputs: ["pseudo"],
          }]
        : []),
    ],
    assertions: [
      { id: "equal_length", predicate: "equal_length", entities: ["hinge", "rest", "hinge", "bob"], expected: true, severity: "fatal" },
      { id: "string_exists", predicate: "exists", entities: ["string"], expected: true, severity: "fatal" },
    ],
  });
}

function conicalPendulumDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 30;
  return baseDocument({
    question,
    reason: "conical pendulum with tension, weight, and the horizontal radius",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "hinge", kind: "point", role: "support", label: "O" },
      { id: "rest", kind: "point", role: "lowest point" },
      { id: "bob", kind: "point", role: "bob", label: "m" },
      { id: "string", kind: "segment", role: "string" },
      { id: "tension", kind: "vector", role: "tension", label: "T" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
    ],
    constructions: [
      pointAt("hinge", 0, 2.4),
      pointAt("rest", 0, 0),
      {
        id: "make_bob",
        operator: "rotate",
        inputs: { point: "rest", center: "hinge", angle: -theta, angleUnit: "degrees" },
        outputs: ["bob"],
      },
      { id: "make_string", operator: "segment", inputs: { start: "hinge", end: "bob" }, outputs: ["string"] },
      { id: "make_tension", operator: "vector", inputs: { start: "bob", end: "hinge" }, outputs: ["tension"] },
      { id: "make_weight", operator: "vector", inputs: { start: "bob", direction: [0, -1], length: 0.8 }, outputs: ["weight"] },
    ],
    assertions: [
      { id: "equal_length", predicate: "equal_length", entities: ["hinge", "rest", "hinge", "bob"], expected: true, severity: "fatal" },
      { id: "string_exists", predicate: "exists", entities: ["string"], expected: true, severity: "fatal" },
    ],
  });
}

function verticalCircleDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const withIncline = /(?:incline|inclined plane)/i.test(question);
  const radius = 1.6;
  const loopCenterX = withIncline ? 3.2 : 0;
  const loopCenterY = radius;
  const entities: SceneEntity[] = [
    { id: "center", kind: "point", role: "circle center" },
    { id: "bottom", kind: "point", role: "lowest point" },
    { id: "top", kind: "point", role: "highest point" },
    { id: "mass", kind: "point", role: "particle", label: "m" },
    { id: "loop", kind: "circle", role: "vertical circle" },
    { id: "radius_arm", kind: "segment", role: "string or track radius" },
    { id: "weight", kind: "vector", role: "weight", label: "mg" },
  ];
  const constructions: SceneConstruction[] = [
    pointAt("center", loopCenterX, loopCenterY),
    pointAt("bottom", loopCenterX, loopCenterY - radius),
    pointAt("top", loopCenterX, loopCenterY + radius),
    pointAt("mass", loopCenterX, loopCenterY - radius),
    { id: "make_loop", operator: "circle", inputs: { center: "center", radius }, outputs: ["loop"] },
    { id: "make_radius", operator: "segment", inputs: { start: "center", end: "mass" }, outputs: ["radius_arm"] },
    { id: "make_weight", operator: "vector", inputs: { start: "mass", direction: [0, -1], length: 0.9 }, outputs: ["weight"] },
  ];
  if (withIncline) {
    const theta = angleDegrees(quantities, question) ?? 30;
    const radians = theta * Math.PI / 180;
    const run = 3.2;
    entities.push(
      { id: "base", kind: "point", role: "incline foot" },
      { id: "incline", kind: "segment", role: "approach incline" },
    );
    constructions.push(
      pointAt("base", loopCenterX - run, (loopCenterY - radius) + run * Math.tan(radians)),
      { id: "make_incline", operator: "segment", inputs: { start: "base", end: "bottom" }, outputs: ["incline"] },
    );
  }
  return baseDocument({
    question,
    reason: withIncline
      ? "incline feeding a vertical circular loop"
      : "particle on a vertical circle with weight at the lowest point",
    quantities: [],
    entities,
    constructions,
    assertions: [
      { id: "loop_exists", predicate: "exists", entities: ["loop"], expected: true, severity: "fatal" },
      { id: "mass_exists", predicate: "exists", entities: ["mass"], expected: true, severity: "fatal" },
    ],
  });
}

function collisionDocument(question: string): SceneDocument {
  const glancing = /(?:glancing|two dimensions|oblique|30° to its original|perpendicular)/i.test(question);
  return baseDocument({
    question,
    reason: glancing
      ? "two-body collision with outgoing velocity vectors"
      : "one-dimensional two-body collision on a line",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "track end" },
      { id: "right", kind: "point", role: "track end" },
      { id: "a", kind: "point", role: "incoming center" },
      { id: "b", kind: "point", role: "target center" },
      { id: "track", kind: "segment", role: "line of impact" },
      { id: "block_a", kind: "rectangle", role: "incoming body", label: "A" },
      { id: "block_b", kind: "rectangle", role: "target body", label: "B" },
      { id: "va", kind: "vector", role: "velocity", label: "v" },
      { id: "vb", kind: "vector", role: "velocity", label: "u" },
    ],
    constructions: [
      pointAt("left", -3.2, 0),
      pointAt("right", 3.2, 0),
      pointAt("a", -1.4, 0.45),
      pointAt("b", 1.1, 0.45),
      { id: "make_track", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["track"] },
      { id: "make_a", operator: "rectangle", inputs: { center: "a", width: 1.0, height: 0.8 }, outputs: ["block_a"] },
      { id: "make_b", operator: "rectangle", inputs: { center: "b", width: 1.0, height: 0.8 }, outputs: ["block_b"] },
      { id: "make_va", operator: "vector", inputs: { start: "a", direction: [1, 0], length: 1.3 }, outputs: ["va"] },
      {
        id: "make_vb",
        operator: "vector",
        inputs: glancing
          ? { start: "b", direction: [0.6, 0.8], length: 1.3 }
          : { start: "b", direction: [1, 0], length: 0.9 },
        outputs: ["vb"],
      },
    ],
    assertions: [
      { id: "track_exists", predicate: "exists", entities: ["track"], expected: true, severity: "fatal" },
      { id: "bodies_exist", predicate: "exists", entities: ["block_a", "block_b"], expected: true, severity: "fatal" },
    ],
  });
}

function squarePathDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "closed square path of a block on a horizontal floor",
    quantities: [],
    entities: [
      { id: "A", kind: "point", role: "corner", label: "A" },
      { id: "B", kind: "point", role: "corner", label: "B" },
      { id: "C", kind: "point", role: "corner", label: "C" },
      { id: "D", kind: "point", role: "corner", label: "D" },
      { id: "path", kind: "polygon", role: "closed path" },
      { id: "center", kind: "point", role: "block center" },
      { id: "block", kind: "rectangle", role: "block", label: "m" },
    ],
    constructions: [
      pointAt("A", -2, -2),
      pointAt("B", 2, -2),
      pointAt("C", 2, 2),
      pointAt("D", -2, 2),
      pointAt("center", -2, -2),
      { id: "make_path", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["path"] },
      { id: "make_block", operator: "rectangle", inputs: { center: "center", width: 0.7, height: 0.7 }, outputs: ["block"] },
    ],
    assertions: [
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "block_exists", predicate: "exists", entities: ["block"], expected: true, severity: "fatal" },
    ],
  });
}

function particleMotionDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "particle with a velocity vector on a line",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "axis end" },
      { id: "right", kind: "point", role: "axis end" },
      { id: "particle", kind: "point", role: "particle", label: "m" },
      { id: "axis", kind: "segment", role: "path" },
      { id: "velocity", kind: "vector", role: "velocity", label: "v" },
    ],
    constructions: [
      pointAt("left", -2.5, 0),
      pointAt("right", 2.5, 0),
      pointAt("particle", -0.4, 0),
      { id: "make_axis", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["axis"] },
      { id: "make_velocity", operator: "vector", inputs: { start: "particle", direction: [1, 0], length: 1.6 }, outputs: ["velocity"] },
    ],
    assertions: [
      { id: "axis_exists", predicate: "exists", entities: ["axis"], expected: true, severity: "fatal" },
      { id: "velocity_exists", predicate: "exists", entities: ["velocity"], expected: true, severity: "fatal" },
    ],
  });
}

function isKinematicsMotionStem(question: string): boolean {
  return /(?:average (?:speed|velocity)|instantaneous velocity|starts from rest|constant acceleration|accelerates uniformly|round trip|circular park|motion in a straight.?line|straight-line trip|position along a line|train starting|covers half the distance)/i.test(normalizeStem(question));
}

function isRelativeVelocityStem(question: string): boolean {
  return /(?:two cars|car [AB] travels|velocity of [AB] relative to [AB]|relative to [AB]|catches? [AB]|100 m ahead of [AB])/i.test(normalizeStem(question));
}

function isProjectileStem(question: string): boolean {
  const stem = normalizeStem(question);
  if (/\bnot a projectile\b/i.test(stem)) return false;
  return /(?:\bprojectile\b|projected from|thrown horizontally|maximum height of)/i.test(stem);
}

function isFallingStem(question: string): boolean {
  return /(?:raindrop|dropped from|dropped onto|starts from rest at height|hits the ground|raised vertically|rebounds? to|released on the slide|thrown vertically|from the top of a (?:tower|building)|released from rest)/i.test(normalizeStem(question));
}

function isCircularMotionStem(question: string): boolean {
  return /(?:uniform circular motion|horizontal circle|centripetal|circular turn|level circular|circular road|curve on a level road)/i.test(normalizeStem(question));
}

function isMotionGraphStem(question: string): boolean {
  return /(?:velocity-?time|position-?time|displacement-?time|v-t graph|s-t graph|x-t graph)/i.test(normalizeStem(question));
}

function projectileDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const stem = normalizeStem(question);
  const fromHeight = /(?:thrown horizontally|from a \d+(?:\.\d+)?\s*m tower|from a tower)/i.test(stem);
  const theta = fromHeight ? 0 : (angleDegrees(quantities, question) ?? 45);
  return baseDocument({
    question,
    reason: fromHeight
      ? "horizontal projection from a tower onto level ground"
      : "projectile launched from level ground with the initial velocity",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "O", kind: "point", role: "launch point", label: "O" },
      { id: "ground_left", kind: "point", role: "ground end" },
      { id: "ground_right", kind: "point", role: "ground end" },
      { id: "aim", kind: "point", role: "launch direction" },
      { id: "ground", kind: "segment", role: "ground" },
      { id: "velocity", kind: "vector", role: "launch velocity", label: "u" },
      ...(fromHeight
        ? [
            { id: "foot", kind: "point" as const, role: "tower foot" },
            { id: "tower", kind: "segment" as const, role: "tower" },
          ]
        : [{ id: "aim_h", kind: "point" as const, role: "horizontal launch reference" }]),
    ],
    constructions: [
      pointAt("O", fromHeight ? -2.2 : -2.4, fromHeight ? 2.4 : 0),
      pointAt("ground_left", -3.2, 0),
      pointAt("ground_right", 3.2, 0),
      { id: "make_ground", operator: "segment", inputs: { start: "ground_left", end: "ground_right" }, outputs: ["ground"] },
      ...(fromHeight
        ? [
            pointAt("foot", -2.2, 0),
            pointAt("aim", -0.4, 2.4),
            { id: "make_tower", operator: "segment" as const, inputs: { start: "foot", end: "O" }, outputs: ["tower"] },
            { id: "make_velocity", operator: "vector" as const, inputs: { start: "O", end: "aim" }, outputs: ["velocity"] },
          ]
        : [
            pointAt("aim_h", -0.6, 0),
            {
              id: "make_aim",
              operator: "rotate" as const,
              inputs: { point: "aim_h", center: "O", angle: theta, angleUnit: "degrees" },
              outputs: ["aim"],
            },
            { id: "make_velocity", operator: "vector" as const, inputs: { start: "O", end: "aim" }, outputs: ["velocity"] },
          ]),
    ],
    assertions: [
      { id: "ground_exists", predicate: "exists", entities: ["ground"], expected: true, severity: "fatal" },
      { id: "velocity_exists", predicate: "exists", entities: ["velocity"], expected: true, severity: "fatal" },
    ],
  });
}

function hangingChainDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "chain on a table with a hanging length over the edge",
    quantities: [],
    entities: [
      { id: "table_left", kind: "point", role: "table end" },
      { id: "edge", kind: "point", role: "table edge" },
      { id: "hang", kind: "point", role: "hanging end" },
      { id: "table", kind: "segment", role: "table" },
      { id: "chain", kind: "segment", role: "hanging chain" },
    ],
    constructions: [
      pointAt("table_left", -2.8, 0),
      pointAt("edge", 0.6, 0),
      pointAt("hang", 0.6, -1.8),
      { id: "make_table", operator: "segment", inputs: { start: "table_left", end: "edge" }, outputs: ["table"] },
      { id: "make_chain", operator: "segment", inputs: { start: "edge", end: "hang" }, outputs: ["chain"] },
    ],
    assertions: [
      { id: "table_exists", predicate: "exists", entities: ["table"], expected: true, severity: "fatal" },
      { id: "chain_exists", predicate: "exists", entities: ["chain"], expected: true, severity: "fatal" },
    ],
  });
}

function hangingWiresLoadDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "two wires in series supporting a pan",
    quantities: [],
    entities: [
      { id: "ceiling", kind: "point", role: "support" },
      { id: "join", kind: "point", role: "wire joint" },
      { id: "load", kind: "point", role: "pan centre" },
      { id: "upper", kind: "segment", role: "upper wire", label: "upper" },
      { id: "lower", kind: "segment", role: "lower wire", label: "lower" },
      { id: "pan", kind: "rectangle", role: "pan" },
    ],
    constructions: [
      pointAt("ceiling", 0, 2.4),
      pointAt("join", 0, 0.6),
      pointAt("load", 0, -1.4),
      { id: "make_upper", operator: "segment", inputs: { start: "ceiling", end: "join" }, outputs: ["upper"] },
      { id: "make_lower", operator: "segment", inputs: { start: "join", end: "load" }, outputs: ["lower"] },
      { id: "make_pan", operator: "rectangle", inputs: { center: "load", width: 1.4, height: 0.4 }, outputs: ["pan"] },
    ],
    assertions: [
      { id: "wires_exist", predicate: "exists", entities: ["upper", "lower"], expected: true, severity: "fatal" },
      { id: "pan_exists", predicate: "exists", entities: ["pan"], expected: true, severity: "fatal" },
    ],
  });
}

function ladderDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const theta = angleDegrees(quantities, question) ?? 60;
  const floorSpan = 2.4;
  const wallSpan = floorSpan * Math.tan(theta * Math.PI / 180);
  return baseDocument({
    question,
    reason: "ladder leaning on a floor and a wall",
    quantities: [{ id: "theta", symbol: "theta", value: theta, unit: "degree" }],
    entities: [
      { id: "corner", kind: "point", role: "wall-floor corner" },
      { id: "floor_end", kind: "point", role: "floor contact" },
      { id: "wall_end", kind: "point", role: "wall contact" },
      { id: "floor", kind: "segment", role: "floor" },
      { id: "wall", kind: "segment", role: "wall" },
      { id: "ladder", kind: "segment", role: "ladder" },
    ],
    constructions: [
      pointAt("corner", 0, 0),
      pointAt("floor_end", floorSpan, 0),
      pointAt("wall_end", 0, Math.min(4.2, Math.max(1.2, wallSpan))),
      { id: "make_floor", operator: "segment", inputs: { start: "corner", end: "floor_end" }, outputs: ["floor"] },
      { id: "make_wall", operator: "segment", inputs: { start: "corner", end: "wall_end" }, outputs: ["wall"] },
      { id: "make_ladder", operator: "segment", inputs: { start: "floor_end", end: "wall_end" }, outputs: ["ladder"] },
    ],
    assertions: [
      { id: "ladder_exists", predicate: "exists", entities: ["ladder"], expected: true, severity: "fatal" },
      { id: "floor_exists", predicate: "exists", entities: ["floor"], expected: true, severity: "fatal" },
    ],
  });
}

function wheelOnRoadDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "wheel on a road with rolling-resistance along the surface",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "wheel center" },
      { id: "contact", kind: "point", role: "contact point" },
      { id: "left", kind: "point", role: "road end" },
      { id: "right", kind: "point", role: "road end" },
      { id: "wheel", kind: "circle", role: "wheel" },
      { id: "road", kind: "segment", role: "road" },
      { id: "friction", kind: "vector", role: "rolling friction", label: "fr" },
    ],
    constructions: [
      pointAt("center", 0, 0.9),
      pointAt("contact", 0, 0),
      pointAt("left", -2.4, 0),
      pointAt("right", 2.4, 0),
      { id: "make_wheel", operator: "circle", inputs: { center: "center", radius: 0.9 }, outputs: ["wheel"] },
      { id: "make_road", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["road"] },
      { id: "make_friction", operator: "vector", inputs: { start: "contact", direction: [-1, 0], length: 1.1 }, outputs: ["friction"] },
    ],
    assertions: [
      { id: "wheel_exists", predicate: "exists", entities: ["wheel"], expected: true, severity: "fatal" },
      { id: "contact_on_road", predicate: "on", entities: ["contact", "road"], expected: true, severity: "fatal" },
    ],
  });
}

function circularMotionDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "uniform circular motion with tangential velocity and inward acceleration",
    quantities: [],
    entities: [
      { id: "O", kind: "point", role: "centre", label: "O" },
      { id: "P", kind: "point", role: "particle", label: "P" },
      { id: "path", kind: "circle", role: "circular path" },
      { id: "radius", kind: "segment", role: "radius" },
      { id: "velocity", kind: "vector", role: "tangential velocity", label: "v" },
      { id: "accel", kind: "vector", role: "centripetal acceleration", label: "a" },
    ],
    constructions: [
      pointAt("O", 0, 0),
      pointAt("P", 2, 0),
      { id: "make_path", operator: "circle", inputs: { center: "O", radius: 2 }, outputs: ["path"] },
      { id: "make_radius", operator: "segment", inputs: { start: "O", end: "P" }, outputs: ["radius"] },
      { id: "make_velocity", operator: "vector", inputs: { start: "P", direction: [0, 1], length: 1.3 }, outputs: ["velocity"] },
      { id: "make_accel", operator: "vector", inputs: { start: "P", end: "O" }, outputs: ["accel"] },
    ],
    assertions: [
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "velocity_exists", predicate: "exists", entities: ["velocity"], expected: true, severity: "fatal" },
    ],
  });
}

function relativeVelocityDocument(question: string): SceneDocument {
  const catching = /(?:catches? [AB]|ahead of [AB]|100 m ahead)/i.test(question);
  return baseDocument({
    question,
    reason: catching
      ? "two cars on a line with a gap, chasing in the same direction"
      : "two cars on a line with velocity vectors in the same direction",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "road end" },
      { id: "right", kind: "point", role: "road end" },
      { id: "a", kind: "point", role: "car A center" },
      { id: "b", kind: "point", role: "car B center" },
      { id: "road", kind: "segment", role: "road" },
      { id: "car_a", kind: "rectangle", role: "car", label: "A" },
      { id: "car_b", kind: "rectangle", role: "car", label: "B" },
      { id: "va", kind: "vector", role: "velocity", label: "vA" },
      { id: "vb", kind: "vector", role: "velocity", label: "vB" },
    ],
    constructions: [
      pointAt("left", -3.2, 0),
      pointAt("right", 3.2, 0),
      pointAt("a", catching ? -1.8 : -1.2, 0.45),
      pointAt("b", catching ? 1.6 : 1.2, 0.45),
      { id: "make_road", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["road"] },
      { id: "make_a", operator: "rectangle", inputs: { center: "a", width: 1.1, height: 0.7 }, outputs: ["car_a"] },
      { id: "make_b", operator: "rectangle", inputs: { center: "b", width: 1.1, height: 0.7 }, outputs: ["car_b"] },
      { id: "make_va", operator: "vector", inputs: { start: "a", direction: [1, 0], length: catching ? 1.8 : 1.6 }, outputs: ["va"] },
      { id: "make_vb", operator: "vector", inputs: { start: "b", direction: [1, 0], length: catching ? 1.1 : 0.9 }, outputs: ["vb"] },
    ],
    assertions: [
      { id: "road_exists", predicate: "exists", entities: ["road"], expected: true, severity: "fatal" },
      { id: "cars_exist", predicate: "exists", entities: ["car_a", "car_b"], expected: true, severity: "fatal" },
      { id: "velocities_exist", predicate: "exists", entities: ["va", "vb"], expected: true, severity: "fatal" },
    ],
  });
}

function isKinematicsVtStem(question: string): boolean {
  return /(?:accelerates uniformly|train starting from rest|average speed for the whole)/i.test(normalizeStem(question))
    || isMotionGraphStem(question);
}

function kinematicsVtDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "velocity-time graph for piecewise constant acceleration",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "v-t axes", label: "v-t" },
      { id: "rest", kind: "point", role: "start", label: "0" },
      { id: "peak", kind: "point", role: "end of boost" },
      { id: "end", kind: "point", role: "end of cruise" },
      { id: "graph", kind: "polyline", role: "v(t)" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -0.5, xMax: 4.5, yMin: -0.5, yMax: 3 }, outputs: ["axes"] },
      pointAt("rest", 0, 0),
      pointAt("peak", 1.2, 2.2),
      pointAt("end", 4, 2.2),
      {
        id: "make_graph",
        operator: "polyline",
        inputs: { points: ["rest", "peak", "end"] },
        outputs: ["graph"],
      },
    ],
    annotations: [
      { id: "peak_drop", kind: "drop", targetIds: ["peak", "axes"] },
      { id: "boost_slope", kind: "slope_triangle", targetIds: ["graph"] },
    ],
    assertions: [
      { id: "axes_exist", predicate: "exists", entities: ["axes"], expected: true, severity: "fatal" },
      { id: "graph_exists", predicate: "exists", entities: ["graph"], expected: true, severity: "fatal" },
    ],
  });
}

function circularParkDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "circular path with radial legs from the centre",
    quantities: [],
    entities: [
      { id: "O", kind: "point", role: "centre", label: "O" },
      { id: "P", kind: "point", role: "rim", label: "P" },
      { id: "Q", kind: "point", role: "rim", label: "Q" },
      { id: "park", kind: "circle", role: "circular park" },
      { id: "OP", kind: "segment", role: "radius" },
      { id: "QO", kind: "segment", role: "radius" },
    ],
    constructions: [
      pointAt("O", 0, 0),
      pointAt("P", 2, 0),
      pointAt("Q", 0, -2),
      { id: "make_park", operator: "circle", inputs: { center: "O", radius: 2 }, outputs: ["park"] },
      { id: "make_OP", operator: "segment", inputs: { start: "O", end: "P" }, outputs: ["OP"] },
      { id: "make_QO", operator: "segment", inputs: { start: "Q", end: "O" }, outputs: ["QO"] },
    ],
    assertions: [
      { id: "park_exists", predicate: "exists", entities: ["park"], expected: true, severity: "fatal" },
      { id: "radii_exist", predicate: "exists", entities: ["OP", "QO"], expected: true, severity: "fatal" },
    ],
  });
}

function riverBoatDocument(question: string, quantities: PlanQuantity[]): SceneDocument {
  const stem = normalizeStem(question);
  const variant = riverBoatVariant(stem);
  const vb = firstQuantity(quantities, ["vb", "vboat", "boat", "gboatspeed", "boatspeed"]);
  const vc = firstQuantity(quantities, ["vc", "vcurrent", "current", "vriver", "vr", "gcurrentspeed", "currentspeed"]);
  const ratio = vb !== null && vc !== null && vb > 0 ? Math.min(0.92, Math.max(0.25, vc / vb)) : 0.45;
  const vbLen = 2.2;
  const vcLen = vbLen * ratio;
  const heading = angleDegrees(quantities, question);
  const banks: SceneEntity[] = [
    { id: "south_w", kind: "point", role: "south bank west" },
    { id: "south_e", kind: "point", role: "south bank east" },
    { id: "north_w", kind: "point", role: "north bank west" },
    { id: "north_e", kind: "point", role: "north bank east" },
    { id: "south_bank", kind: "segment", role: "river bank" },
    { id: "north_bank", kind: "segment", role: "river bank" },
  ];
  const bankConstructions: SceneConstruction[] = [
    pointAt("south_w", -3.3, -1.8),
    pointAt("south_e", 3.3, -1.8),
    pointAt("north_w", -3.3, 1.8),
    pointAt("north_e", 3.3, 1.8),
    { id: "make_south_bank", operator: "segment", inputs: { start: "south_w", end: "south_e" }, outputs: ["south_bank"] },
    { id: "make_north_bank", operator: "segment", inputs: { start: "north_w", end: "north_e" }, outputs: ["north_bank"] },
  ];

  if (variant === "along_stream") {
    return baseDocument({
      question,
      reason: "river banks with downstream and upstream velocities along the current",
      quantities: [],
      entities: [
        ...banks,
        { id: "origin", kind: "point", role: "boat", label: "boat" },
        { id: "vb_end", kind: "point", role: "boat-speed tip" },
        { id: "vc_end", kind: "point", role: "current tip" },
        { id: "vd_end", kind: "point", role: "downstream tip" },
        { id: "vu_end", kind: "point", role: "upstream tip" },
        { id: "vb", kind: "vector", role: "boat speed", label: "vb" },
        { id: "vc", kind: "vector", role: "current", label: "vc" },
        { id: "vd", kind: "vector", role: "downstream", label: "down" },
        { id: "vu", kind: "vector", role: "upstream", label: "up" },
      ],
      constructions: [
        ...bankConstructions,
        pointAt("origin", -1.4, 0),
        pointAt("vb_end", -1.4 + vbLen, 0.55),
        pointAt("vc_end", -1.4 + vcLen, -0.55),
        pointAt("vd_end", -1.4 + vbLen + vcLen, 0),
        pointAt("vu_end", -1.4 - Math.max(0.6, vbLen - vcLen), 0),
        { id: "make_vb", operator: "vector", inputs: { start: "origin", end: "vb_end" }, outputs: ["vb"] },
        { id: "make_vc", operator: "vector", inputs: { start: "origin", end: "vc_end" }, outputs: ["vc"] },
        { id: "make_vd", operator: "vector", inputs: { start: "origin", end: "vd_end" }, outputs: ["vd"] },
        { id: "make_vu", operator: "vector", inputs: { start: "origin", end: "vu_end" }, outputs: ["vu"] },
      ],
      assertions: [
        { id: "banks_exist", predicate: "exists", entities: ["south_bank", "north_bank"], expected: true, severity: "fatal" },
        { id: "vb_exists", predicate: "exists", entities: ["vb"], expected: true, severity: "fatal" },
        { id: "current_exists", predicate: "exists", entities: ["vc"], expected: true, severity: "fatal" },
      ],
    });
  }

  if (variant === "two_triangles") {
    const acrossY = Math.sqrt(Math.max(0.2, 1 - ratio * ratio)) * vbLen;
    return baseDocument({
      question,
      reason: "two river-crossing velocity triangles: straight across and shortest time",
      quantities: [],
      entities: [
        ...banks,
        { id: "across_origin", kind: "point", role: "straight-across origin", label: "across" },
        { id: "across_vc_end", kind: "point", role: "straight-across current tip" },
        { id: "across_vb_end", kind: "point", role: "straight-across heading tip" },
        { id: "across_vr_end", kind: "point", role: "straight-across resultant tip" },
        { id: "across_vc", kind: "vector", role: "current", label: "vc" },
        { id: "across_vb", kind: "vector", role: "heading", label: "vb" },
        { id: "across_vr", kind: "vector", role: "resultant", label: "vr" },
        { id: "short_origin", kind: "point", role: "shortest-time origin", label: "short" },
        { id: "short_vc_end", kind: "point", role: "shortest-time current tip" },
        { id: "short_vb_end", kind: "point", role: "shortest-time heading tip" },
        { id: "short_vr_end", kind: "point", role: "shortest-time resultant tip" },
        { id: "short_vc", kind: "vector", role: "current", label: "vc" },
        { id: "short_vb", kind: "vector", role: "heading", label: "vb" },
        { id: "short_vr", kind: "vector", role: "resultant", label: "vr" },
      ],
      constructions: [
        ...bankConstructions,
        pointAt("across_origin", -1.7, -0.6),
        pointAt("across_vc_end", -1.7 + vcLen, -0.6),
        pointAt("across_vb_end", -1.7 - vcLen, -0.6 + acrossY),
        pointAt("across_vr_end", -1.7, -0.6 + acrossY),
        { id: "make_across_vc", operator: "vector", inputs: { start: "across_origin", end: "across_vc_end" }, outputs: ["across_vc"] },
        { id: "make_across_vb", operator: "vector", inputs: { start: "across_origin", end: "across_vb_end" }, outputs: ["across_vb"] },
        { id: "make_across_vr", operator: "vector", inputs: { start: "across_origin", end: "across_vr_end" }, outputs: ["across_vr"] },
        pointAt("short_origin", 1.1, -0.6),
        pointAt("short_vc_end", 1.1 + vcLen, -0.6),
        pointAt("short_vb_end", 1.1, -0.6 + vbLen),
        pointAt("short_vr_end", 1.1 + vcLen, -0.6 + vbLen),
        { id: "make_short_vc", operator: "vector", inputs: { start: "short_origin", end: "short_vc_end" }, outputs: ["short_vc"] },
        { id: "make_short_vb", operator: "vector", inputs: { start: "short_origin", end: "short_vb_end" }, outputs: ["short_vb"] },
        { id: "make_short_vr", operator: "vector", inputs: { start: "short_origin", end: "short_vr_end" }, outputs: ["short_vr"] },
      ],
      assertions: [
        { id: "banks_exist", predicate: "exists", entities: ["south_bank", "north_bank"], expected: true, severity: "fatal" },
        { id: "across_exists", predicate: "exists", entities: ["across_vr"], expected: true, severity: "fatal" },
        { id: "short_exists", predicate: "exists", entities: ["short_vr"], expected: true, severity: "fatal" },
      ],
    });
  }

  const headingDeg = heading ?? 90;
  const rad = headingDeg * Math.PI / 180;
  const originX = 0;
  const originY = -0.5;
  const vbEnd = { x: originX + vbLen * Math.cos(rad), y: originY + vbLen * Math.sin(rad) };
  const vcEnd = { x: originX + vcLen, y: originY };
  const vrEnd = { x: vbEnd.x + vcLen, y: vbEnd.y };
  return baseDocument({
    question,
    reason: "river banks with a heading-and-current velocity triangle",
    quantities: heading !== null
      ? [{ id: "theta", symbol: "theta", value: heading, unit: "degree" }]
      : [],
    entities: [
      ...banks,
      { id: "origin", kind: "point", role: "boat", label: "boat" },
      { id: "vb_end", kind: "point", role: "heading tip" },
      { id: "vc_end", kind: "point", role: "current tip" },
      { id: "vr_end", kind: "point", role: "resultant tip" },
      { id: "vb", kind: "vector", role: "heading", label: "vb" },
      { id: "vc", kind: "vector", role: "current", label: "vc" },
      { id: "vr", kind: "vector", role: "resultant", label: "vr" },
      ...(heading !== null
        ? [{ id: "heading_mark", kind: "arc" as const, role: "heading angle" }]
        : []),
    ],
    constructions: [
      ...bankConstructions,
      pointAt("origin", originX, originY),
      pointAt("vb_end", vbEnd.x, vbEnd.y),
      pointAt("vc_end", vcEnd.x, vcEnd.y),
      pointAt("vr_end", vrEnd.x, vrEnd.y),
      { id: "make_vb", operator: "vector", inputs: { start: "origin", end: "vb_end" }, outputs: ["vb"] },
      { id: "make_vc", operator: "vector", inputs: { start: "origin", end: "vc_end" }, outputs: ["vc"] },
      { id: "make_vr", operator: "vector", inputs: { start: "origin", end: "vr_end" }, outputs: ["vr"] },
      ...(heading !== null
        ? [{
            id: "make_heading_mark",
            operator: "angle_mark" as const,
            inputs: { vertex: "origin", a: "vc", b: "vb", radius: 0.45 },
            outputs: ["heading_mark"],
          }]
        : []),
    ],
    assertions: [
      { id: "banks_exist", predicate: "exists", entities: ["south_bank", "north_bank"], expected: true, severity: "fatal" },
      { id: "heading_exists", predicate: "exists", entities: ["vb"], expected: true, severity: "fatal" },
      { id: "current_exists", predicate: "exists", entities: ["vc"], expected: true, severity: "fatal" },
    ],
  });
}

function buildVectorDiagram(
  question: string,
  quantities: PlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  const stem = normalizeStem(question);
  if (isRiverBoatStem(stem)) return riverBoatDocument(question, quantities);
  const magnitudes = quantities.filter((quantity) =>
    /(?:magnitude|vec|a|b)/i.test(`${quantity.id} ${quantity.symbol}`));
  const vectorEvidence = /(?:resultant|two vectors|vector|velocity vectors|velocity triangles?|rain falls|concurrent forces|triangle of forces|[îĵ]|makes with the x-axis)/i.test(stem);
  if (!vectorEvidence && magnitudes.length < 1) return null;
  const three = /(?:three concurrent|triangle of forces|two strings|held by two strings)/i.test(stem);
  const rain = /rain falls/i.test(stem);
  return baseDocument({
    question,
    reason: rain
      ? "relative-velocity triangle for rain and a walking observer"
      : three
        ? "concurrent forces from a shared origin"
        : "shared-origin vector diagram",
    quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "origin", label: "O" },
      { id: "a_end", kind: "point", role: "vector A tip" },
      { id: "b_end", kind: "point", role: "vector B tip" },
      { id: "a", kind: "vector", role: "vector", label: rain ? "vrain" : "A" },
      { id: "b", kind: "vector", role: "vector", label: rain ? "vwalk" : "B" },
      ...(three
        ? [
            { id: "c_end", kind: "point" as const, role: "vector C tip" },
            { id: "c", kind: "vector" as const, role: "vector", label: "C" },
          ]
        : []),
    ],
    constructions: [
      pointAt("origin", 0, 0),
      pointAt("a_end", rain ? 0 : 3, rain ? -2.4 : 0),
      pointAt("b_end", rain ? 1.8 : 1.5, rain ? 0 : 2),
      { id: "make_a", operator: "vector", inputs: { start: "origin", end: "a_end" }, outputs: ["a"] },
      { id: "make_b", operator: "vector", inputs: { start: "origin", end: "b_end" }, outputs: ["b"] },
      ...(three
        ? [
            pointAt("c_end", -0.8, 2.2),
            { id: "make_c", operator: "vector" as const, inputs: { start: "origin", end: "c_end" }, outputs: ["c"] },
          ]
        : []),
    ],
    assertions: [
      { id: "a_exists", predicate: "exists", entities: ["a"], expected: true, severity: "fatal" },
      { id: "b_exists", predicate: "exists", entities: ["b"], expected: true, severity: "fatal" },
    ],
  });
}

function buildAperturePattern(
  question: string,
  _quantities: PlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!/(?:slit|interference|diffraction|aperture|fringe|central maximum|resolving power|limit of resolution|rayleigh|phase difference)/i.test(question)) return null;
  const slits = /single/i.test(question) ? 1 : 2;
  return baseDocument({
    question,
    reason: "aperture and screen pattern from the wave-optics family",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "aperture center" },
      { id: "screen_a", kind: "point", role: "screen end" },
      { id: "screen_b", kind: "point", role: "screen end" },
      { id: "aperture", kind: "polyline", role: "aperture" },
      { id: "pattern", kind: "polyline", role: "screen pattern" },
    ],
    constructions: [
      pointAt("center", -2, 0),
      pointAt("screen_a", 3, -3),
      pointAt("screen_b", 3, 3),
      {
        id: "make_aperture",
        operator: "aperture",
        inputs: {
          center: "center",
          orientation: "vertical",
          length: 4,
          slitCount: slits,
          slitWidth: 0.25,
          slitSeparation: 1.1,
        },
        outputs: ["aperture"],
      },
      {
        id: "make_pattern",
        operator: "screen_pattern",
        inputs: { start: "screen_a", end: "screen_b", pattern: "interference", count: 7, spacing: 0.45, centralWidth: 0.7 },
        outputs: ["pattern"],
      },
    ],
    assertions: [
      { id: "aperture_exists", predicate: "exists", entities: ["aperture"], expected: true, severity: "fatal" },
      { id: "pattern_exists", predicate: "exists", entities: ["pattern"], expected: true, severity: "fatal" },
    ],
  });
}

function buildWavefront(question: string, _quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!/(?:wavefront|huygens|secondary wavelet)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "plane wavefront family",
    quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "wave origin" },
      { id: "fronts", kind: "polyline", role: "wavefront family" },
    ],
    constructions: [
      pointAt("origin", 0, 0),
      {
        id: "make_fronts",
        operator: "wavefront_family",
        inputs: { origin: "origin", direction: [1, 0], shape: "plane", count: 4, spacing: 0.7, span: 4 },
        outputs: ["fronts"],
      },
    ],
    assertions: [{ id: "fronts_exist", predicate: "exists", entities: ["fronts"], expected: true, severity: "fatal" }],
  });
}

function buildPolarizer(question: string, quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!/(?:polari[sz]|malus|polaroid|analy[sz]er|brewster)/i.test(question)) return null;
  const angle = angleDegrees(quantities, question) ?? 35;
  return baseDocument({
    question,
    reason: "polarizer transmission axis",
    quantities: [{ id: "theta", symbol: "theta", value: angle, unit: "degree" }],
    entities: [
      { id: "center", kind: "point", role: "polarizer center" },
      { id: "polarizer", kind: "polyline", role: "polarizer" },
    ],
    constructions: [
      pointAt("center", 0, 0),
      {
        id: "make_polarizer",
        operator: "polarizer",
        inputs: { center: "center", radius: 2, axisAngleDeg: angle },
        outputs: ["polarizer"],
      },
    ],
    assertions: [{ id: "polarizer_exists", predicate: "exists", entities: ["polarizer"], expected: true, severity: "fatal" }],
  });
}

function buildTransverseField(question: string, _quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!/(?:unpolari[sz]|plane.?polari[sz]|electric field direction|electromagnetic wave|em wave|electromagnetic spectrum|displacement current)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "transverse field along a propagation axis",
    quantities: [],
    entities: [
      { id: "start", kind: "point", role: "propagation start" },
      { id: "end", kind: "point", role: "propagation end" },
      { id: "field", kind: "polyline", role: "transverse field" },
    ],
    constructions: [
      pointAt("start", -3, 0),
      pointAt("end", 3, 0),
      {
        id: "make_field",
        operator: "transverse_field",
        inputs: { start: "start", end: "end", amplitude: 0.6, cycles: 3, orientationDeg: 90 },
        outputs: ["field"],
      },
    ],
    assertions: [{ id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" }],
  });
}

function buildCoordinateFigure(
  question: string,
  quantities: PlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  // Before any canonical conic: if the stem states its own equation, draw that.
  const statedFigure = buildStatedCurveScene(question);
  if (statedFigure) return statedFigure;
  const stem = normalizeStem(question);
  const displacement = extractCoordinateDisplacement(question);
  if (displacement) return coordinateDisplacementDocument(question, displacement);
  if (isSpaceGeometryStem(stem) || isRelatedRateSolidStem(stem)) {
    return spaceGeometryDocument(question, stem);
  }
  if (isRelatedRateTriangleStem(stem)) return equilateralTriangleDocument(question);
  if (isPlanarConicStem(stem)) return coordinateConicDocument(question, stem);
  if (
    isRelatedRateCircleStem(stem)
    || isCircleLocusStem(stem)
    || /(?:circle)/i.test(stem)
    || /(?:\btriangle [A-Z]{3}\b|equilateral triangle|right.?angled triangle)/i.test(stem)
  ) {
    return coordinateCircleDocument(question, quantities, stem);
  }
  if (!schematic) return null;
  const expressions = extractExplicitFunctions(question);
  if (expressions.length > 0) {
    return plotExpressions(question, expressions, extractXInterval(question) ?? [-3, 3]);
  }
  return axesOnly(question, "coordinate display axes");
}

function coordinateConicDocument(question: string, stem: string): SceneDocument {
  const kind = /\bhyperbola\b/i.test(stem) ? "hyperbola"
    : /\bellipse\b/i.test(stem) ? "ellipse"
      : /\bparabola\b/i.test(stem) ? "parabola"
        : "hyperbola";
  if (kind === "parabola") {
    return plotExpressions(question, ["x^2/4"], [-3, 3]);
  }
  const expression = kind === "ellipse" ? "x^2/4 + y^2 - 1" : "x^2/4 - y^2 - 1";
  const yBound = kind === "ellipse" ? 2 : 3;
  return baseDocument({
    question,
    reason: kind === "ellipse"
      ? "standard ellipse on display axes"
      : "standard hyperbola on display axes",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: "conic", kind: "polyline", role: kind, label: compactLabel(kind) },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -4, xMax: 4, yMin: -yBound, yMax: yBound }, outputs: ["axes"] },
      {
        id: "make_conic",
        operator: "implicit_curve",
        inputs: {
          expression,
          xMin: -4,
          xMax: 4,
          yMin: -yBound,
          yMax: yBound,
          xSamples: 65,
          ySamples: 65,
        },
        outputs: ["conic"],
      },
    ],
    assertions: [{ id: "conic_exists", predicate: "exists", entities: ["conic"], expected: true, severity: "fatal" }],
  });
}

function coordinateCircleDocument(
  question: string,
  quantities: PlanQuantity[],
  stem: string,
): SceneDocument {
  const radius = firstQuantity(quantities, ["r", "radius"]) ?? 2;
  const inscribed = /rectangles inscribed/i.test(stem);
  return baseDocument({
    question,
    reason: inscribed
      ? "circle with an inscribed rectangle on display axes"
      : "circle on display axes for a related-rate or coordinate figure",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: "origin", kind: "point", role: "origin" },
      { id: "circle", kind: "circle", role: "named circle" },
      ...(inscribed
        ? [
            { id: "r1", kind: "point" as const, role: "rectangle vertex" },
            { id: "r2", kind: "point" as const, role: "rectangle vertex" },
            { id: "r3", kind: "point" as const, role: "rectangle vertex" },
            { id: "r4", kind: "point" as const, role: "rectangle vertex" },
            { id: "rect", kind: "polygon" as const, role: "inscribed rectangle" },
          ]
        : []),
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, outputs: ["axes"] },
      pointAt("origin", 0, 0),
      { id: "make_circle", operator: "circle", inputs: { center: "origin", radius }, outputs: ["circle"] },
      ...(inscribed
        ? [
            pointAt("r1", radius * 0.7, radius * 0.7),
            pointAt("r2", -radius * 0.7, radius * 0.7),
            pointAt("r3", -radius * 0.7, -radius * 0.7),
            pointAt("r4", radius * 0.7, -radius * 0.7),
            {
              id: "make_rect",
              operator: "polygon" as const,
              inputs: { points: ["r1", "r2", "r3", "r4"] },
              outputs: ["rect"],
            },
          ]
        : []),
    ],
    assertions: [{ id: "circle_exists", predicate: "exists", entities: ["circle"], expected: true, severity: "fatal" }],
  });
}

function equilateralTriangleDocument(question: string): SceneDocument {
  const height = Math.sqrt(3);
  return baseDocument({
    question,
    reason: "equilateral triangle and a median for the related-rate setup",
    quantities: [],
    entities: [
      { id: "A", kind: "point", role: "vertex", label: "A" },
      { id: "B", kind: "point", role: "vertex", label: "B" },
      { id: "C", kind: "point", role: "vertex", label: "C" },
      { id: "M", kind: "point", role: "median foot", label: "M" },
      { id: "triangle", kind: "polygon", role: "equilateral triangle" },
      { id: "median", kind: "segment", role: "median" },
    ],
    constructions: [
      pointAt("A", 0, 0),
      pointAt("B", 2, 0),
      pointAt("C", 1, height),
      pointAt("M", 1, 0),
      { id: "make_triangle", operator: "polygon", inputs: { points: ["A", "B", "C"] }, outputs: ["triangle"] },
      { id: "make_median", operator: "segment", inputs: { start: "C", end: "M" }, outputs: ["median"] },
    ],
    assertions: [
      { id: "triangle_exists", predicate: "exists", entities: ["triangle"], expected: true, severity: "fatal" },
      { id: "median_exists", predicate: "exists", entities: ["median"], expected: true, severity: "fatal" },
    ],
  });
}

function spaceGeometryDocument(question: string, stem: string): SceneDocument {
  const cube = isRelatedRateSolidStem(stem);
  const wantsPlane = /\bplane\b/i.test(stem) && !cube;
  const origin2d = { x: 0, y: 0 };
  const a = extractSpacePoint(stem, 0) ?? { x: 1, y: 2, z: 3 };
  const b = extractSpacePoint(stem, 1) ?? { x: 5, y: 3, z: 4 };
  const dirA = extractSpaceDirection(stem, 0) ?? { x: 2, y: 3, z: 6 };
  const dirB = extractSpaceDirection(stem, 1) ?? { x: 2, y: 3, z: 8 };
  const cubeCorners = cube ? cubeCornerCoords(2) : [];
  const cubeEntities = cubeCorners.flatMap((corner) => [
    { id: corner.id, kind: "point" as const, role: "cube vertex", label: corner.id.toUpperCase() },
  ]);
  const cubeEdges = cube ? cubeEdgePairs() : [];
  return baseDocument({
    question,
    reason: cube
      ? "cube in a shared isometric frame for a related-rate solid"
      : wantsPlane
        ? "plane patch and a line in a shared isometric frame"
        : "two lines in a shared isometric frame",
    quantities: [],
    entities: [
      { id: "origin2d", kind: "point", role: "frame origin" },
      { id: "frame", kind: "polyline", role: "space frame" },
      ...(cube
        ? [
            ...cubeEntities,
            ...cubeEdges.map((edge) => ({ id: edge.id, kind: "segment" as const, role: "cube edge" })),
          ]
        : [
            { id: "A", kind: "point", role: "space point", label: "A" },
            { id: "B", kind: "point", role: "space point", label: "B" },
            { id: "l1", kind: "line", role: "space line" },
            { id: "l2", kind: "line", role: "space line" },
            ...(wantsPlane ? [{ id: "pi", kind: "polygon" as const, role: "plane patch" }] : []),
          ]),
    ],
    constructions: [
      pointAt("origin2d", origin2d.x, origin2d.y),
      { id: "make_frame", operator: "space_frame", inputs: { origin: "origin2d", scale: 1, axisLength: 2 }, outputs: ["frame"] },
      ...(cube
        ? [
            ...cubeCorners.map((corner) => ({
              id: `make_${corner.id}`,
              operator: "space_point" as const,
              inputs: { frame: "frame", x: corner.x, y: corner.y, z: corner.z },
              outputs: [corner.id],
            })),
            ...cubeEdges.map((edge) => ({
              id: `make_${edge.id}`,
              operator: "segment" as const,
              inputs: { start: edge.start, end: edge.end },
              outputs: [edge.id],
            })),
          ]
        : [
            { id: "make_A", operator: "space_point" as const, inputs: { frame: "frame", x: a.x, y: a.y, z: a.z }, outputs: ["A"] },
            { id: "make_B", operator: "space_point" as const, inputs: { frame: "frame", x: b.x, y: b.y, z: b.z }, outputs: ["B"] },
            {
              id: "make_l1",
              operator: "space_line" as const,
              inputs: { frame: "frame", point: "A", direction: [dirA.x, dirA.y, dirA.z], tMin: -1.2, tMax: 1.2 },
              outputs: ["l1"],
            },
            {
              id: "make_l2",
              operator: "space_line" as const,
              inputs: { frame: "frame", point: "B", direction: [dirB.x, dirB.y, dirB.z], tMin: -1.2, tMax: 1.2 },
              outputs: ["l2"],
            },
            ...(wantsPlane
              ? [{
                  id: "make_plane",
                  operator: "plane" as const,
                  inputs: { frame: "frame", a: 1, b: 0, c: 1, d: 2, span: 2.2 },
                  outputs: ["pi"],
                }]
              : []),
          ]),
    ],
    assertions: cube
      ? [{ id: "frame_exists", predicate: "exists", entities: ["frame"], expected: true, severity: "fatal" }]
      : [
          { id: "l1_exists", predicate: "exists", entities: ["l1"], expected: true, severity: "fatal" },
          { id: "l2_exists", predicate: "exists", entities: ["l2"], expected: true, severity: "fatal" },
        ],
  });
}

function cubeCornerCoords(side: number): Array<{ id: string; x: number; y: number; z: number }> {
  const bits = [0, side];
  const corners: Array<{ id: string; x: number; y: number; z: number }> = [];
  let index = 0;
  for (const x of bits) {
    for (const y of bits) {
      for (const z of bits) {
        corners.push({ id: `c${index}`, x, y, z });
        index += 1;
      }
    }
  }
  return corners;
}

function cubeEdgePairs(): Array<{ id: string; start: string; end: string }> {
  return [
    { id: "e01", start: "c0", end: "c1" },
    { id: "e02", start: "c0", end: "c2" },
    { id: "e04", start: "c0", end: "c4" },
    { id: "e13", start: "c1", end: "c3" },
    { id: "e15", start: "c1", end: "c5" },
    { id: "e23", start: "c2", end: "c3" },
    { id: "e26", start: "c2", end: "c6" },
    { id: "e37", start: "c3", end: "c7" },
    { id: "e45", start: "c4", end: "c5" },
    { id: "e46", start: "c4", end: "c6" },
    { id: "e57", start: "c5", end: "c7" },
    { id: "e67", start: "c6", end: "c7" },
  ];
}

function extractSpacePoint(
  stem: string,
  index: number,
): { x: number; y: number; z: number } | null {
  const matches = [...stem.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)];
  const match = matches[index];
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function extractSpaceDirection(
  stem: string,
  index: number,
): { x: number; y: number; z: number } | null {
  const matches = [...stem.matchAll(
    /(-?\d+(?:\.\d+)?)\s*\^?i\b[^\n]{0,12}(-?\d+(?:\.\d+)?)\s*\^?j\b[^\n]{0,12}(-?\d+(?:\.\d+)?)\s*\^?k\b/gi,
  )];
  const match = matches[index];
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function buildSolidFigure(question: string, quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  const radius = firstQuantity(quantities, ["r", "radius"]) ?? 1.2;
  const height = firstQuantity(quantities, ["h", "height"]) ?? 2.4;
  const kind = /\bcone\b/i.test(question) ? "cone"
    : /\bfrustum\b/i.test(question) ? "frustum"
      : /\bhemisphere\b/i.test(question) ? "hemisphere"
        : /\bsphere\b/i.test(question) ? "sphere"
          : "cylinder";
  if (!/(?:cylinder|cone|frustum|hemisphere|sphere)/i.test(question)) return null;
  return baseDocument({
    question,
    reason: "solid projection from named mensuration family",
    quantities: [],
    entities: [
      { id: "center", kind: "point", role: "solid center" },
      { id: "solid", kind: "polyline", role: "solid projection" },
    ],
    constructions: [
      pointAt("center", 0, 0),
      {
        id: "make_solid",
        operator: "solid_projection",
        inputs: kind === "frustum"
          ? { kind, center: "center", radius, height, topRadius: radius * 0.55, axis: "vertical" }
          : { kind, center: "center", radius, height, axis: "vertical" },
        outputs: ["solid"],
      },
    ],
    assertions: [{ id: "solid_exists", predicate: "exists", entities: ["solid"], expected: true, severity: "fatal" }],
  });
}

function buildPointField(question: string, _quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  const stem = normalizeStem(question);
  if (
    !/(?:point charge|electric[- ]field|magnetic field|current-carrying|gauss|dipole|coulomb|microcoulomb|\bμC\b|solenoid|toroid|kepler|satellite|equipotential|parallel (?:wires|conductors)|wires carry|electric charges?|conservation of charge|electric potential|acceleration due to gravity|weightlessness)/i.test(stem)
    && !isParallelPlateStem(stem)
    && !isCurrentSegmentFieldStem(stem)
  ) {
    return null;
  }
  if (isParallelPlateStem(stem)) return parallelPlateDocument(question);
  if (isCurrentSegmentFieldStem(stem)) return currentSegmentFieldDocument(question);
  return baseDocument({
    question,
    reason: "two source points and the joining field line",
    quantities: [],
    entities: [
      { id: "q1", kind: "point", role: "point charge", label: "q1" },
      { id: "q2", kind: "point", role: "point charge", label: "q2" },
      { id: "field", kind: "vector", role: "field" },
    ],
    constructions: [
      pointAt("q1", -2, 0),
      pointAt("q2", 2, 0),
      { id: "make_field", operator: "vector", inputs: { start: "q1", end: "q2" }, outputs: ["field"] },
    ],
    assertions: [{ id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" }],
  });
}

function parallelPlateDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "two parallel conducting plates and the field between them",
    quantities: [],
    entities: [
      { id: "p1a", kind: "point", role: "plate end" },
      { id: "p1b", kind: "point", role: "plate end" },
      { id: "p2a", kind: "point", role: "plate end" },
      { id: "p2b", kind: "point", role: "plate end" },
      { id: "plate1", kind: "segment", role: "conducting plate", label: "P1" },
      { id: "plate2", kind: "segment", role: "conducting plate", label: "P2" },
      { id: "field", kind: "vector", role: "field between plates", label: "E" },
    ],
    constructions: [
      pointAt("p1a", -2.2, 1.2),
      pointAt("p1b", 2.2, 1.2),
      pointAt("p2a", -2.2, -1.2),
      pointAt("p2b", 2.2, -1.2),
      { id: "make_plate1", operator: "segment", inputs: { start: "p1a", end: "p1b" }, outputs: ["plate1"] },
      { id: "make_plate2", operator: "segment", inputs: { start: "p2a", end: "p2b" }, outputs: ["plate2"] },
      { id: "make_field", operator: "vector", inputs: { start: "p1a", end: "p2a" }, outputs: ["field"] },
    ],
    assertions: [
      { id: "plates_exist", predicate: "exists", entities: ["plate1", "plate2"], expected: true, severity: "fatal" },
      { id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" },
    ],
  });
}

function currentSegmentFieldDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "current element and the magnetic field at a named point",
    quantities: [],
    entities: [
      { id: "a", kind: "point", role: "wire end" },
      { id: "b", kind: "point", role: "wire end" },
      { id: "P", kind: "point", role: "field point", label: "P" },
      { id: "wire", kind: "segment", role: "current element" },
      { id: "field", kind: "vector", role: "magnetic field", label: "B" },
    ],
    constructions: [
      pointAt("a", -1.6, 0),
      pointAt("b", 1.6, 0),
      pointAt("P", 1.6, 1.8),
      { id: "make_wire", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["wire"] },
      { id: "make_field", operator: "vector", inputs: { start: "P", end: "b" }, outputs: ["field"] },
    ],
    assertions: [
      { id: "wire_exists", predicate: "exists", entities: ["wire"], expected: true, severity: "fatal" },
      { id: "field_exists", predicate: "exists", entities: ["field"], expected: true, severity: "fatal" },
    ],
  });
}

function buildEnergyLevel(question: string, _quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  const stem = normalizeStem(question);
  if (isJunctionSpatialStem(stem) && !isSemiconductorBandStem(stem)) {
    return semiconductorJunctionDocument(question);
  }
  if (isSemiconductorBandStem(stem)) {
    return semiconductorBandDocument(question);
  }
  // Only a stem actually about levels gets a level diagram. The wider list this
  // replaced sent photoelectric, de Broglie, X-ray, fission, decay and half-life
  // stems to the same canned n=1 -> n=2 transition, which is a picture of a
  // different phenomenon; those teach text-only until their own figures exist
  // (photocell I-V, stopping potential vs frequency, binding-energy curve).
  if (!/(?:energy level|\bbohr\b|rydberg|hydrogen (?:atom|spectrum)|excited state|ground state|ionisation energy|ionization energy|lyman|balmer|paschen|brackett|pfund|spectral series|\btransition\b|\borbit\b)/i.test(stem)) {
    return null;
  }
  return bohrLevelDocument(question);
}

function bohrLevelDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "stacked energy levels on a display axis",
    quantities: [],
    entities: [
      { id: "n1_a", kind: "point", role: "level end" },
      { id: "n1_b", kind: "point", role: "level end" },
      { id: "n2_a", kind: "point", role: "level end" },
      { id: "n2_b", kind: "point", role: "level end" },
      { id: "level1", kind: "segment", role: "energy level", label: "n=1" },
      { id: "level2", kind: "segment", role: "energy level", label: "n=2" },
      { id: "transition", kind: "vector", role: "transition" },
    ],
    constructions: [
      pointAt("n1_a", -2, -1),
      pointAt("n1_b", 2, -1),
      pointAt("n2_a", -2, 1),
      pointAt("n2_b", 2, 1),
      { id: "make_level1", operator: "segment", inputs: { start: "n1_a", end: "n1_b" }, outputs: ["level1"] },
      { id: "make_level2", operator: "segment", inputs: { start: "n2_a", end: "n2_b" }, outputs: ["level2"] },
      { id: "make_transition", operator: "vector", inputs: { start: "n2_a", end: "n1_a" }, outputs: ["transition"] },
    ],
    assertions: [{ id: "levels_exist", predicate: "exists", entities: ["level1", "level2"], expected: true, severity: "fatal" }],
  });
}

function semiconductorBandDocument(question: string): SceneDocument {
  const stem = normalizeStem(question);
  const bothTypes = /n-type/i.test(stem) && /p-type/i.test(stem);
  const nType = /n-type/i.test(stem);
  const pType = /p-type/i.test(stem);
  const conductorSplit = /conductor/i.test(stem) && /(?:semiconductor|insulator)/i.test(stem);
  const columns: Array<{
    prefix: string;
    x0: number;
    x1: number;
    extra: "donor" | "acceptor" | "narrow" | null;
    caption: string;
  }> = bothTypes
    ? [
      { prefix: "n", x0: -3.2, x1: -0.6, extra: "donor", caption: "n-type" },
      { prefix: "p", x0: 0.6, x1: 3.2, extra: "acceptor", caption: "p-type" },
    ]
    : conductorSplit
      ? [
        { prefix: "cond", x0: -3.2, x1: -0.6, extra: "narrow", caption: "conductor" },
        { prefix: "semi", x0: 0.6, x1: 3.2, extra: null, caption: "semiconductor" },
      ]
      : [{
        prefix: "band",
        x0: -2.4,
        x1: 2.4,
        extra: nType ? "donor" : pType ? "acceptor" : null,
        caption: nType ? "n-type" : pType ? "p-type" : "intrinsic",
      }];

  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const levelIds: string[] = [];
  for (const column of columns) {
    const evY = column.extra === "narrow" ? -0.25 : -1.2;
    const ecY = column.extra === "narrow" ? 0.25 : 1.2;
    const evL = `${column.prefix}_ev_l`;
    const evR = `${column.prefix}_ev_r`;
    const ecL = `${column.prefix}_ec_l`;
    const ecR = `${column.prefix}_ec_r`;
    const ev = `${column.prefix}_ev`;
    const ec = `${column.prefix}_ec`;
    entities.push(
      { id: evL, kind: "point", role: "band end" },
      { id: evR, kind: "point", role: "band end" },
      { id: ecL, kind: "point", role: "band end" },
      { id: ecR, kind: "point", role: "band end" },
      { id: ev, kind: "segment", role: "valence band", label: "Ev" },
      { id: ec, kind: "segment", role: "conduction band", label: "Ec" },
    );
    constructions.push(
      pointAt(evL, column.x0, evY),
      pointAt(evR, column.x1, evY),
      pointAt(ecL, column.x0, ecY),
      pointAt(ecR, column.x1, ecY),
      { id: `make_${ev}`, operator: "segment", inputs: { start: evL, end: evR }, outputs: [ev] },
      { id: `make_${ec}`, operator: "segment", inputs: { start: ecL, end: ecR }, outputs: [ec] },
      { id: `label_${ev}`, operator: "label", inputs: { target: ev, text: "Ev" }, outputs: [`${ev}_label`] },
      { id: `label_${ec}`, operator: "label", inputs: { target: ec, text: "Ec" }, outputs: [`${ec}_label`] },
    );
    entities.push(
      { id: `${ev}_label`, kind: "label", role: "band label" },
      { id: `${ec}_label`, kind: "label", role: "band label" },
    );
    levelIds.push(ev, ec);
    if (column.extra === "donor" || column.extra === "acceptor") {
      const extraY = column.extra === "donor" ? 0.7 : -0.7;
      const extraText = column.extra === "donor" ? "Ed" : "Ea";
      const a = `${column.prefix}_imp_l`;
      const b = `${column.prefix}_imp_r`;
      const seg = `${column.prefix}_imp`;
      entities.push(
        { id: a, kind: "point", role: "impurity end" },
        { id: b, kind: "point", role: "impurity end" },
        { id: seg, kind: "segment", role: "impurity level", label: extraText },
        { id: `${seg}_label`, kind: "label", role: "band label" },
      );
      constructions.push(
        pointAt(a, column.x0, extraY),
        pointAt(b, column.x1, extraY),
        { id: `make_${seg}`, operator: "segment", inputs: { start: a, end: b }, outputs: [seg] },
        { id: `label_${seg}`, operator: "label", inputs: { target: seg, text: extraText }, outputs: [`${seg}_label`] },
      );
      levelIds.push(seg);
    }
    const cap = `${column.prefix}_caption`;
    const capPt = `${column.prefix}_caption_pt`;
    entities.push(
      { id: capPt, kind: "point", role: "column caption" },
      { id: cap, kind: "label", role: "column caption" },
    );
    constructions.push(
      pointAt(capPt, (column.x0 + column.x1) / 2, -1.85),
      { id: `label_${cap}`, operator: "label", inputs: { target: capPt, text: column.caption }, outputs: [cap] },
    );
  }

  return baseDocument({
    question,
    reason: "semiconductor energy bands as stacked levels",
    quantities: [],
    entities,
    constructions,
    assertions: [{
      id: "bands_exist",
      predicate: "exists",
      entities: levelIds.slice(0, 2),
      expected: true,
      severity: "fatal",
    }],
  });
}

function semiconductorJunctionDocument(question: string): SceneDocument {
  const stem = normalizeStem(question);
  const photon = /(?:solar cell|photodiode|photon|light emitting|\bled\b)/i.test(stem);
  const emit = /(?:light emitting|\bled\b)/i.test(stem);
  const entities: SceneEntity[] = [
    { id: "p_center", kind: "point", role: "p-region center" },
    { id: "n_center", kind: "point", role: "n-region center" },
    { id: "dep_center", kind: "point", role: "depletion center" },
    { id: "p_region", kind: "rectangle", role: "p-side", label: "p" },
    { id: "n_region", kind: "rectangle", role: "n-side", label: "n" },
    { id: "depletion", kind: "rectangle", role: "depletion region", label: "depletion" },
    { id: "p_label", kind: "label", role: "region label" },
    { id: "n_label", kind: "label", role: "region label" },
    { id: "dep_label", kind: "label", role: "region label" },
    { id: "e_start", kind: "point", role: "field start" },
    { id: "e_end", kind: "point", role: "field end" },
    { id: "field", kind: "vector", role: "built-in field", label: "E" },
  ];
  const constructions: SceneConstruction[] = [
    pointAt("p_center", -1.8, 0),
    pointAt("n_center", 1.8, 0),
    pointAt("dep_center", 0, 0),
    { id: "make_p", operator: "rectangle", inputs: { center: "p_center", width: 2.4, height: 1.8 }, outputs: ["p_region"] },
    { id: "make_n", operator: "rectangle", inputs: { center: "n_center", width: 2.4, height: 1.8 }, outputs: ["n_region"] },
    { id: "make_dep", operator: "rectangle", inputs: { center: "dep_center", width: 1.2, height: 1.8 }, outputs: ["depletion"] },
    { id: "label_p", operator: "label", inputs: { target: "p_region", text: "p" }, outputs: ["p_label"] },
    { id: "label_n", operator: "label", inputs: { target: "n_region", text: "n" }, outputs: ["n_label"] },
    { id: "label_dep", operator: "label", inputs: { target: "depletion", text: "depletion" }, outputs: ["dep_label"] },
    pointAt("e_start", 0.45, -1.15),
    pointAt("e_end", -0.45, -1.15),
    { id: "make_field", operator: "vector", inputs: { start: "e_start", end: "e_end" }, outputs: ["field"] },
  ];
  if (photon) {
    entities.push(
      { id: "photon_start", kind: "point", role: emit ? "emitted photon" : "incident photon" },
      { id: "photon_end", kind: "point", role: emit ? "outgoing photon" : "absorbed photon" },
      { id: "photon", kind: "vector", role: emit ? "emitted photon" : "incident photon", label: "hν" },
    );
    constructions.push(
      pointAt("photon_start", 0, emit ? 1.05 : 2.4),
      pointAt("photon_end", 0, emit ? 2.4 : 1.05),
      { id: "make_photon", operator: "vector", inputs: { start: "photon_start", end: "photon_end" }, outputs: ["photon"] },
    );
  }
  return baseDocument({
    question,
    reason: photon
      ? "p-n junction with depletion region and incident photon"
      : "p-n junction with p-side, n-side, and depletion region",
    quantities: [],
    entities,
    constructions,
    assertions: [{
      id: "junction_exists",
      predicate: "exists",
      entities: ["p_region", "n_region", "depletion"],
      expected: true,
      severity: "fatal",
    }],
  });
}

function ivCharacteristicDocument(question: string): SceneDocument {
  const points = [
    { id: "iv0", x: -1.6, y: -0.15 },
    { id: "iv1", x: -0.4, y: -0.05 },
    { id: "iv2", x: 0.2, y: 0.08 },
    { id: "iv3", x: 0.9, y: 0.45 },
    { id: "iv4", x: 1.6, y: 1.7 },
  ];
  return baseDocument({
    question,
    reason: "qualitative device I-V characteristic on labelled axes",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "IV axes", label: "I-V" },
      ...points.map((point) => ({ id: point.id, kind: "point" as const, role: "curve sample" })),
      { id: "curve", kind: "polyline", role: "characteristic curve" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -2.2, xMax: 2.2, yMin: -1.2, yMax: 2.2 }, outputs: ["axes"] },
      ...points.map((point) => pointAt(point.id, point.x, point.y)),
      {
        id: "make_curve",
        operator: "polyline",
        inputs: { points: points.map((point) => point.id) },
        outputs: ["curve"],
      },
    ],
    assertions: [
      { id: "axes_exist", predicate: "exists", entities: ["axes"], expected: true, severity: "fatal" },
      { id: "curve_exists", predicate: "exists", entities: ["curve"], expected: true, severity: "fatal" },
    ],
  });
}

function variationLineDocument(question: string): SceneDocument {
  return baseDocument({
    question,
    reason: "named quantity versus named quantity on labelled axes",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "plot axes" },
      { id: "origin", kind: "point", role: "origin" },
      { id: "end", kind: "point", role: "sample" },
      { id: "graph", kind: "polyline", role: "variation graph" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -0.4, xMax: 3.4, yMin: -0.4, yMax: 3.2 }, outputs: ["axes"] },
      pointAt("origin", 0, 0),
      pointAt("end", 2.8, 2.4),
      { id: "make_graph", operator: "polyline", inputs: { points: ["origin", "end"] }, outputs: ["graph"] },
    ],
    assertions: [
      { id: "axes_exist", predicate: "exists", entities: ["axes"], expected: true, severity: "fatal" },
      { id: "graph_exists", predicate: "exists", entities: ["graph"], expected: true, severity: "fatal" },
    ],
  });
}

function buildFluidApparatus(question: string, _quantities: PlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!/(?:hydraulic|piston|venturi|pipe|cylindrical vessels|connected at the bottom|bernoulli|capillary|young['’]?s modulus|stress[- ]strain|surface tension|connected fluid|buoyancy|archimedes|thermal expansion|heat transfer|fluid column|viscosity|method of mixtures|resonance tube)/i.test(normalizeStem(question))) {
    return null;
  }
  return baseDocument({
    question,
    reason: "connected vessels for a fluid apparatus",
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "vessel center" },
      { id: "right", kind: "point", role: "vessel center" },
      { id: "tank1", kind: "rectangle", role: "vessel" },
      { id: "tank2", kind: "rectangle", role: "vessel" },
      { id: "pipe", kind: "segment", role: "connecting pipe" },
    ],
    constructions: [
      pointAt("left", -2, 0),
      pointAt("right", 2, 0),
      { id: "make_tank1", operator: "rectangle", inputs: { center: "left", width: 1.4, height: 2 }, outputs: ["tank1"] },
      { id: "make_tank2", operator: "rectangle", inputs: { center: "right", width: 1, height: 1.4 }, outputs: ["tank2"] },
      { id: "make_pipe", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["pipe"] },
    ],
    assertions: [{ id: "vessels_exist", predicate: "exists", entities: ["tank1", "tank2", "pipe"], expected: true, severity: "fatal" }],
  });
}

function axesOnly(question: string, reason: string): SceneDocument {
  return baseDocument({
    question,
    reason,
    quantities: [],
    entities: [{ id: "axes", kind: "axes", role: "display axes" }],
    constructions: [{
      id: "make_axes",
      operator: "axes",
      inputs: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
      outputs: ["axes"],
    }],
    assertions: [{ id: "axes_exist", predicate: "exists", entities: ["axes"], expected: true, severity: "fatal" }],
  });
}

function tryCompile(document: SceneDocument): {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
} | null {
  const pruned = pruneDeadSceneEntities(document as unknown as Record<string, unknown>);
  const validated = validateSceneDocument(pruned);
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  if (
    !compiled.ok
    || !compiled.renderScene
    || compiled.renderScene.primitives.length === 0
    || compiled.report.issues.some((issue) => issue.severity === "fatal")
  ) {
    return null;
  }
  return {
    document: validated.document,
    renderScene: compiled.renderScene,
    validationReport: compiled.report,
  };
}

function baseDocument(options: {
  question: string;
  reason: string;
  quantities: Array<Record<string, unknown> & { id: string }>;
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  assertions: SceneAssertion[];
  annotations?: SceneAnnotation[];
  revealGroups?: SceneRevealGroup[];
  teachingTimeline?: SceneTeachingAction[];
}): SceneDocument {
  const requiredEntityIds = options.entities.map((entity) => entity.id);
  const revealGroups = options.revealGroups ?? [{
    id: "setup",
    entityIds: requiredEntityIds,
    dependsOn: [],
    narrationCue: options.reason,
  }];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: options.reason },
    source: {
      question: options.question,
      synthesizedFamily: true,
    },
    quantities: options.quantities,
    entities: options.entities,
    constructions: options.constructions,
    relations: [],
    assertions: options.assertions,
    annotations: options.annotations ?? [],
    requiredEntityIds,
    revealGroups,
    teachingTimeline: options.teachingTimeline ?? revealGroups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
      narrationIntent: group.narrationCue,
    })),
  };
}

function pointAt(id: string, x: number, y: number): SceneConstruction {
  return {
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "world" },
    outputs: [id],
  };
}

function quantityRecord(
  id: string,
  symbol: string,
  value: number,
  unit: string,
): Record<string, unknown> & { id: string } {
  return { id, symbol, value, unit };
}

function collectPlanQuantities(turnPlan: unknown): PlanQuantity[] {
  if (!isRecord(turnPlan)) return [];
  const rows = [...(Array.isArray(turnPlan.givens) ? turnPlan.givens : []),
    ...(Array.isArray(turnPlan.derived) ? turnPlan.derived : [])];
  return rows.flatMap((row, index) => {
    if (!isRecord(row) || typeof row.value !== "number" || !Number.isFinite(row.value)) return [];
    const id = typeof row.id === "string" && row.id.trim() ? row.id : `q${index + 1}`;
    const symbol = typeof row.symbol === "string" && row.symbol.trim() ? row.symbol : id;
    return [{
      id,
      symbol,
      value: row.value,
      unit: typeof row.unit === "string" ? row.unit : undefined,
      sourceText: typeof row.sourceText === "string" ? row.sourceText : undefined,
    }];
  });
}

function firstQuantity(quantities: PlanQuantity[], aliases: readonly string[]): number | null {
  const match = quantities.find((quantity) => aliases.some((alias) =>
    normalizeKey(quantity.id) === alias || normalizeKey(quantity.symbol) === alias));
  return match ? match.value : null;
}

function absQuantity(quantities: PlanQuantity[], aliases: readonly string[]): number | null {
  const value = firstQuantity(quantities, aliases);
  return value === null ? null : Math.abs(value);
}

function unitOf(quantities: PlanQuantity[], aliases: readonly string[]): string | undefined {
  return quantities.find((quantity) => aliases.some((alias) =>
    normalizeKey(quantity.id) === alias || normalizeKey(quantity.symbol) === alias))?.unit;
}

function angleDegrees(quantities: PlanQuantity[], question: string): number | null {
  const fromPlan = firstQuantity(quantities, [
    "theta", "thetai", "theta1", "i", "incident", "incidentangle", "angle", "alpha",
  ]);
  if (fromPlan !== null && Number.isFinite(fromPlan)) return fromPlan;
  const match = question.match(/(\d+(?:\.\d+)?)\s*(?:°|deg(?:ree)?s?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractResistors(
  question: string,
  quantities: PlanQuantity[],
): Array<{ symbol: string; value: number; unit?: string }> {
  const fromQuestion: Array<{ symbol: string; value: number; unit?: string }> = [];
  for (const match of question.matchAll(/\b(R[_-]?\d+)\s*=\s*(\d+(?:\.\d+)?)\s*(k?Ω|ohm|ohms)?/gi)) {
    fromQuestion.push({
      symbol: match[1]!.replace(/[_-]/g, ""),
      value: Number(match[2]),
      unit: match[3] ?? "ohm",
    });
  }
  if (fromQuestion.length >= 2) return fromQuestion;
  const repeated = question.match(
    /\b(two|three|four|2|3|4)\s+(\d+(?:\.\d+)?)\s*(k?Ω|ohm|ohms)\s+resistors?\b/i,
  );
  if (repeated) {
    const spoken = { two: 2, three: 3, four: 4 } as const;
    const word = repeated[1]!.toLowerCase();
    const count = word in spoken ? spoken[word as keyof typeof spoken] : Number(word);
    const value = Number(repeated[2]);
    if (Number.isFinite(count) && count >= 2 && Number.isFinite(value)) {
      return Array.from({ length: count }, (_, index) => ({
        symbol: `R${index + 1}`,
        value,
        unit: repeated[3] ?? "ohm",
      }));
    }
  }
  const fromPlan = quantities.filter((quantity) => {
    if (/eq|equiv|equivalent|total/i.test(`${quantity.id} ${quantity.symbol}`)) return false;
    const blob = `${quantity.id} ${quantity.symbol} ${quantity.unit ?? ""}`;
    return /resistance|ohm|Ω/.test(blob);
  });
  return fromPlan.map((quantity) => ({
    symbol: quantity.symbol,
    value: quantity.value,
    unit: quantity.unit,
  }));
}

function buildParametricCurve(
  question: string,
  parametric: { xExpression: string; yExpression: string; t: number | null },
): SceneDocument | null {
  const t = parametric.t ?? 1;
  const pad = 1.5;
  let pointX: number;
  let pointY: number;
  try {
    pointX = evaluateInT(parametric.xExpression, t);
    pointY = evaluateInT(parametric.yExpression, t);
  } catch {
    return null;
  }
  const entities: SceneEntity[] = [
    { id: "axes", kind: "axes", role: "display axes" },
    { id: "curve", kind: "polyline", role: "parametric curve" },
    { id: "P", kind: "point", role: "marked point", label: "P" },
  ];
  const constructions: SceneConstruction[] = [
    {
      id: "make_axes",
      operator: "axes",
      inputs: {
        xMin: Math.min(-2, pointX - 2),
        xMax: Math.max(4, pointX + 2),
        yMin: Math.min(-2, pointY - 2),
        yMax: Math.max(4, pointY + 2),
      },
      outputs: ["axes"],
    },
    {
      id: "make_curve",
      operator: "parametric_curve",
      inputs: {
        xExpression: parametric.xExpression,
        yExpression: parametric.yExpression,
        parameter: "t",
        tMin: t - pad,
        tMax: t + pad,
        samples: 65,
      },
      outputs: ["curve"],
    },
    pointAt("P", pointX, pointY),
  ];
  const assertions: SceneAssertion[] = [
    {
      id: "point_on_curve",
      predicate: "function_value",
      entities: ["curve"],
      expected: { x: pointX, y: pointY, t },
      severity: "fatal",
    },
    { id: "label_P", predicate: "label_attached", entities: ["P"], expected: true, severity: "fatal" },
  ];
  if (/\btangent\b/i.test(question)) {
    entities.push({ id: "tangent", kind: "line", role: "tangent line" });
    constructions.push({
      id: "make_tangent",
      operator: "tangent_line",
      inputs: { curve: "curve", at: t, span: 2 },
      outputs: ["tangent"],
    });
    assertions.push({
      id: "tangent_exists",
      predicate: "exists",
      entities: ["tangent"],
      expected: true,
      severity: "fatal",
    });
  }
  return baseDocument({
    question,
    reason: "parametric curve with the asked parameter marked",
    quantities: [],
    entities,
    constructions,
    assertions,
  });
}

function extractParametric(question: string): { xExpression: string; yExpression: string; t: number | null } | null {
  const normalized = question
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
  const xMatch = /(?:^|[^\w])x\s*=\s*([0-9t+\-*/^().\s]+)/i.exec(normalized);
  const yMatch = /(?:^|[^\w])y\s*=\s*([0-9t+\-*/^().\s]+)/i.exec(normalized);
  if (!xMatch || !yMatch) return null;
  const xExpression = normalizeParametricExpression(xMatch[1]!);
  const yExpression = normalizeParametricExpression(yMatch[1]!);
  if (!/\bt\b/.test(xExpression) && !/\bt\b/.test(yExpression)) return null;
  const tMatch = /(?:^|[^\w])t\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(normalized)
    ?? /near t\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(normalized);
  const t = tMatch ? Number(tMatch[1]) : null;
  return { xExpression, yExpression, t: t !== null && Number.isFinite(t) ? t : null };
}

function normalizeParametricExpression(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/(\d)t/g, "$1*t")
    .replace(/t(?=\()/g, "t*");
}

function evaluateInT(expression: string, t: number): number {
  return parseMathExpression(expression.replace(/\bt\b/g, "x")).evaluate(t);
}

function extractExplicitFunctions(question: string): string[] {
  const facts: string[] = [];
  const normalized = prepareExpressionSource(question);
  for (const match of normalized.matchAll(/\by\s*=\s*/gi)) {
    // `y =` has to be the whole left side. In "2x + y = 1" it is one term of a
    // line, and lifting the "1" plots a horizontal line the stem never names —
    // which then beat the real conic, because it compiled first.
    const preceding = normalized.slice(0, match.index ?? 0).replace(/\s+$/, "").slice(-1);
    if (preceding && /[-+*/^)0-9x]/i.test(preceding)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const expression = readExpression(repairExamExpression(normalized.slice(start, start + 80)));
    if (!expression || /\bt\b/.test(expression)) continue;
    if (isUsablePlotExpression(expression) && !facts.includes(expression)) facts.push(expression);
  }
  for (const match of normalized.matchAll(/([0-9x^+\-*/().absincotq]+)\s*=\s*y\b/gi)) {
    const expression = readExpression(repairExamExpression(match[1] ?? ""));
    if (expression && isUsablePlotExpression(expression) && !facts.includes(expression)) facts.push(expression);
  }
  for (const match of normalized.matchAll(/\bx\s*=\s*/gi)) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = normalized.slice(start, start + 80);
    if (!/^t\b/i.test(rest)) continue;
    const withT = readExpression(rest);
    const expression = withT.replace(/\bt\b/g, "x");
    if (expression && isUsablePlotExpression(expression) && !facts.includes(expression)) facts.push(expression);
  }
  const fx = /\bf\s*\(\s*x\s*\)\s*=\s*/i.exec(normalized);
  if (fx) {
    const expression = readExpression(repairExamExpression(normalized.slice((fx.index ?? 0) + fx[0].length, (fx.index ?? 0) + fx[0].length + 80)));
    if (expression && isUsablePlotExpression(expression) && !facts.includes(expression)) facts.push(expression);
  }
  // A horizontal line on its own is not a picture of anything: these constants
  // are initial conditions ("y = 0 when x = pi/2") and answer options far more
  // often than curves. They stay only alongside a real curve, where they are a
  // genuine boundary of a region.
  if (!facts.some((expression) => !isConstantPlotExpression(expression))) return [];
  return facts.slice(0, 3);
}

function isConstantPlotExpression(expression: string): boolean {
  try {
    const parsed = parseMathExpression(expression);
    return Math.abs(parsed.evaluate(0.5) - parsed.evaluate(1.5)) < 1e-9;
  } catch {
    return true;
  }
}

function prepareExpressionSource(question: string): string {
  return question
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi");
}

function repairExamExpression(raw: string): string {
  let source = raw.trim();
  source = source.replace(/\|([^|]+)\|/g, (_all, inner: string) => `abs(${String(inner).replace(/\s+/g, "")})`);
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)\s+(\d+(?:\.\d+)?)\s*x\b/gi, (_, fn: string, n: string) => `${fn.toLowerCase()}(${n}*x)`);
  source = source.replace(/\b(sin|cos|tan|sqrt|ln|log|exp)\s+x\b/gi, (_, fn: string) => `${fn.toLowerCase()}(x)`);
  source = source.replace(/\bx(\d+)\b/g, "x^$1");
  source = source.replace(/(\d)\s*x\b/g, "$1*x");
  return source.replace(/\s+/g, "");
}

function isUsablePlotExpression(expression: string): boolean {
  try {
    parseMathExpression(expression).evaluate(0.5);
    return true;
  } catch {
    return false;
  }
}

function extractBoundX(question: string): [number, number] | null {
  const normalized = question.replace(/[−–—]/g, "-");
  const match = normalized.match(/x\s*=\s*(-?\d+(?:\.\d+)?).{0,48}x\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function extractNamedPlotExpressions(question: string): string[] {
  const normalized = question.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3");
  const facts: string[] = [];
  const fx = /\bF\s*=\s*5x\b/i.exec(normalized);
  if (fx) facts.push("5*x");
  const fxPoly = /\bF_x\s*=\s*\(([^)]+)\)/i.exec(normalized);
  if (fxPoly) {
    const expression = normalizePlotExpression(fxPoly[1]!);
    if (expression) facts.push(expression);
  }
  const uxyz = /\bU\s*=\s*\(2x\^2/i.exec(normalized) || /\bU\s*=\s*\(2x²/i.exec(question);
  if (uxyz) facts.push("2*x^2");
  const ur = /\bU\(r\)\s*=/i.exec(normalized);
  if (ur) facts.push("1/x^12-1/x^6");
  const kt = /\bK\s*=\s*c\s*t\b/i.exec(normalized);
  if (kt) facts.push("x");
  if (/amplitude modulat|carrier wave|modulating signal/i.test(normalized)) {
    facts.push("(1+0.5*sin(x))*sin(8*x)");
  }
  if (/binding energy per nucleon/i.test(normalized)) {
    facts.push("8*x/(x+12)-x/40");
  }
  return facts.slice(0, 2);
}

function extractXInterval(question: string): [number, number] | null {
  const match = question.match(
    /from x\s*=\s*(\d+(?:\.\d+)?)\s*m to x\s*=\s*(\d+(?:\.\d+)?)/i,
  );
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;
  return start < end ? [start, end] : [end, start];
}

function extractTimeInterval(question: string): [number, number] | null {
  const match = question.match(/t\s*=\s*(\d+(?:\.\d+)?)\s*s/i);
  if (!match) return null;
  const end = Number(match[1]);
  if (!Number.isFinite(end) || end <= 0) return null;
  return [0, end];
}

function normalizePlotExpression(value: string): string {
  return value
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/(\d)x/g, "$1*x")
    .replace(/x(?=\()/g, "x*");
}

function extractCoordinateDisplacement(
  question: string,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const match = question.match(
    /from\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*to\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i,
  );
  if (!match) return null;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return { x1, y1, x2, y2 };
}

function coordinateDisplacementDocument(
  question: string,
  points: { x1: number; y1: number; x2: number; y2: number },
): SceneDocument {
  const pad = 1;
  const xMin = Math.min(points.x1, points.x2) - pad;
  const xMax = Math.max(points.x1, points.x2) + pad;
  const yMin = Math.min(points.y1, points.y2) - pad;
  const yMax = Math.max(points.y1, points.y2) + pad;
  return baseDocument({
    question,
    reason: "displacement in the plane from the named endpoints",
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: "start", kind: "point", role: "start", label: "A" },
      { id: "end", kind: "point", role: "end", label: "B" },
      { id: "path", kind: "vector", role: "displacement" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin, xMax, yMin, yMax }, outputs: ["axes"] },
      pointAt("start", points.x1, points.y1),
      pointAt("end", points.x2, points.y2),
      { id: "make_path", operator: "vector", inputs: { start: "start", end: "end" }, outputs: ["path"] },
    ],
    assertions: [
      { id: "path_exists", predicate: "exists", entities: ["path"], expected: true, severity: "fatal" },
      { id: "label_A", predicate: "label_attached", entities: ["start"], expected: true, severity: "fatal" },
      { id: "label_B", predicate: "label_attached", entities: ["end"], expected: true, severity: "fatal" },
    ],
  });
}

function readExpression(source: string): string {
  const allowed = new Set(["x", "t", "pi", "e", "sin", "cos", "tan", "sqrt", "abs", "ln", "log"]);
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character) || /[0-9.+\-*/^()]/.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";
      if (!allowed.has(identifier.toLowerCase())) break;
      index += identifier.length;
      continue;
    }
    break;
  }
  return source.slice(0, index).replace(/\s+/g, "");
}

function displayAxis(values: number[]): number[] {
  const min = Math.min(...values);
  const span = Math.max(Math.max(...values) - min, 1e-9);
  return values.map((value) => (value - min) / span * 8);
}

function compactLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= 16 ? trimmed : trimmed.slice(0, 16);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[^a-z0-9]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
