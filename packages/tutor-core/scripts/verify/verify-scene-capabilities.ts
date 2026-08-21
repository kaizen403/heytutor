import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertUniqueSceneCapabilityIds,
  EXECUTABLE_SCENE_PROOF_PREDICATES,
  GEOMETRY_SCENE_PROOF_PREDICATES,
  isPlannerVisibleSceneConstructionOperator,
  isPlannerVisibleSceneProofPredicate,
  isSupportedSceneOperator,
  PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS,
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES,
  SCENE_CAPABILITY_MANIFEST,
  SUPPORTED_SCENE_COMPONENT_SYMBOLS,
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
  TOPOLOGY_SCENE_PROOF_PREDICATES,
} from "@heytutor/scene-engine";
import {
  buildSceneDocumentPlannerPrompt,
  DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
  DEFAULT_SCENE_PROOF_PREDICATES,
} from "../../src/planners/scenePlannerV2Prompt";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";

const EXPECTED_CONSTRUCTION_OPERATORS = [
  "point",
  "segment",
  "ray",
  "line",
  "circle",
  "arc",
  "rectangle",
  "polygon",
  "polyline",
  "function_curve",
  "function_region",
  "parametric_curve",
  "polar_curve",
  "implicit_curve",
  "tangent_line",
  "normal_line",
  "representative_slice",
  "solid_of_revolution",
  "solid_projection",
  "solid_cross_section",
  "wavefront_family",
  "aperture",
  "screen_pattern",
  "transverse_field",
  "polarizer",
  "optical_train",
  "vector",
  "axes",
  "intersection",
  "surface_intersection",
  "surface_contact",
  "normal_at",
  "midpoint",
  "project",
  "translate",
  "rotate",
  "reflect_point",
  "reflect_direction",
  "refract_direction",
  "reflect_at",
  "refract_at",
  "parallel_through",
  "perpendicular_through",
  "angle_bisector",
  "angle_mark",
  "right_angle_mark",
  "tick_mark",
  "vector_components",
  "dimension",
  "connect",
  "symbol",
  "label",
] as const;

const EXPECTED_EXECUTABLE_PROOF_PREDICATES = [
  "exists",
  "entity_count",
  "connected",
  "incident",
  "on",
  "between",
  "parallel",
  "perpendicular",
  "collinear",
  "equal_length",
  "equal_angle",
  "angle_between",
  "converges",
  "label_attached",
  "distance_ratio",
  "same_side",
  "opposite_direction",
  "vector_sum",
  "inside",
  "ordered_along",
  "equal_spacing",
  "snells_law",
  "function_value",
  "root",
  "wave_cycles",
  "path",
  "pathCount",
  "sameTerminalPair",
  "degree",
] as const;

const EXPECTED_PLANNER_PROOF_PREDICATES = [
  "entity_count",
  "connected",
  "incident",
  "on",
  "between",
  "parallel",
  "perpendicular",
  "collinear",
  "equal_length",
  "equal_angle",
  "angle_between",
  "converges",
  "label_attached",
  "distance_ratio",
  "same_side",
  "opposite_direction",
  "inside",
  "ordered_along",
  "equal_spacing",
  "snells_law",
  "function_value",
  "root",
  "wave_cycles",
  "path",
  "pathCount",
  "sameTerminalPair",
  "degree",
] as const;

const EXPECTED_COMPONENT_SYMBOLS = [
  "galvanometer",
  "voltmeter",
  "ammeter",
  "capacitor",
  "inductor",
  "resistor",
  "ac_source",
  "battery",
  "zener",
  "diode",
  "switch",
  "lamp",
  "cell",
] as const;

const tuplePrecisePlannerPredicates: typeof EXPECTED_PLANNER_PROOF_PREDICATES =
  DEFAULT_SCENE_PROOF_PREDICATES;

function assertExactCapabilityList(
  name: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  const duplicateIds = actual.filter((id, index) => actual.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`${name} contains duplicate IDs: ${[...new Set(duplicateIds)].join(", ")}`);
  }
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    throw new Error(
      `${name} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

assertExactCapabilityList(
  "construction operator manifest",
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
  EXPECTED_CONSTRUCTION_OPERATORS,
);
assertExactCapabilityList(
  "planner-visible construction operator manifest",
  PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS,
  EXPECTED_CONSTRUCTION_OPERATORS,
);
assertExactCapabilityList(
  "executable proof predicate manifest",
  EXECUTABLE_SCENE_PROOF_PREDICATES,
  EXPECTED_EXECUTABLE_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "planner-visible proof predicate manifest",
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES,
  EXPECTED_PLANNER_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "component symbol manifest",
  SUPPORTED_SCENE_COMPONENT_SYMBOLS,
  EXPECTED_COMPONENT_SYMBOLS,
);

assertExactCapabilityList(
  "manifest construction derivation",
  SCENE_CAPABILITY_MANIFEST.constructionOperators,
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
);
assertExactCapabilityList(
  "manifest proof derivation",
  SCENE_CAPABILITY_MANIFEST.proofPredicates.map(({ id }) => id),
  EXECUTABLE_SCENE_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "manifest planner proof derivation",
  SCENE_CAPABILITY_MANIFEST.proofPredicates
    .filter(({ plannerVisible }) => plannerVisible)
    .map(({ id }) => id),
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "manifest geometry proof derivation",
  SCENE_CAPABILITY_MANIFEST.proofPredicates
    .filter(({ evaluator }) => evaluator === "geometry")
    .map(({ id }) => id),
  GEOMETRY_SCENE_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "manifest topology proof derivation",
  SCENE_CAPABILITY_MANIFEST.proofPredicates
    .filter(({ evaluator }) => evaluator === "topology")
    .map(({ id }) => id),
  TOPOLOGY_SCENE_PROOF_PREDICATES,
);
assertExactCapabilityList(
  "proof evaluator partition",
  [...GEOMETRY_SCENE_PROOF_PREDICATES, ...TOPOLOGY_SCENE_PROOF_PREDICATES].sort(),
  [...EXECUTABLE_SCENE_PROOF_PREDICATES].sort(),
);
assertExactCapabilityList(
  "manifest component derivation",
  SCENE_CAPABILITY_MANIFEST.componentSymbols,
  SUPPORTED_SCENE_COMPONENT_SYMBOLS,
);

if (DEFAULT_SCENE_CONSTRUCTION_OPERATORS !== PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS) {
  throw new Error("planner defaults must re-export the canonical construction operator array");
}
if (DEFAULT_SCENE_PROOF_PREDICATES !== PLANNER_VISIBLE_SCENE_PROOF_PREDICATES) {
  throw new Error("planner defaults must re-export the planner-visible proof predicate array");
}

function promptCapabilitySection(prompt: string, heading: string): string[] {
  const section = prompt.split(`${heading}\n`, 2)[1]?.split("\n\n", 1)[0];
  if (!section) throw new Error(`prompt omitted ${heading}`);
  // Operators are listed one per line ("- op"); predicates are a single
  // comma-separated line to keep the serialized prompt under its size budget.
  return section
    .split(/\n|,\s*/)
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line.length > 0);
}

const defaultCapabilityPrompt = buildSceneDocumentPlannerPrompt("capability drift check");
assertExactCapabilityList(
  "prompt construction operators",
  promptCapabilitySection(defaultCapabilityPrompt, "AVAILABLE CONSTRUCTION OPERATORS"),
  PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS,
);
assertExactCapabilityList(
  "prompt proof predicates",
  promptCapabilitySection(defaultCapabilityPrompt, "AVAILABLE PROOF PREDICATES"),
  tuplePrecisePlannerPredicates,
);

const filteredCapabilityPrompt = buildSceneDocumentPlannerPrompt("capability filtering check", {
  constructionOperators: ["ray", "__unknown_operator__", "point"],
  proofPredicates: ["converges", "exists", "__unknown_predicate__", "on"],
});
assertExactCapabilityList(
  "filtered prompt construction operators",
  promptCapabilitySection(filteredCapabilityPrompt, "AVAILABLE CONSTRUCTION OPERATORS"),
  ["ray", "point"],
);
assertExactCapabilityList(
  "filtered prompt proof predicates",
  promptCapabilitySection(filteredCapabilityPrompt, "AVAILABLE PROOF PREDICATES"),
  ["converges", "on"],
);

const validatorProbe = [
  ...new Set([
    ...EXPECTED_CONSTRUCTION_OPERATORS,
    ...SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
    "__unsupported_scene_operator__",
  ]),
].filter(isSupportedSceneOperator);
assertExactCapabilityList(
  "validator construction operators",
  validatorProbe,
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
);

let duplicateIdsRejected = false;
try {
  assertUniqueSceneCapabilityIds("verification", ["duplicate", "duplicate"]);
} catch (error) {
  duplicateIdsRejected = error instanceof Error && error.message.includes("duplicate");
}
if (!duplicateIdsRejected) throw new Error("duplicate capability IDs were not rejected");

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scene-engine/fixtures/evaluation/optics-syllabus-v1.json",
);
const corpus = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: Array<{
    id: string;
    question: string;
    visualFamilies: string[];
    law?: { id?: string };
  }>;
};

const operatorByFamily: Record<string, string[]> = {
  ray_path: ["ray", "surface_contact", "normal_at", "reflect_at", "refract_at"],
  axis_view: ["line", "dimension"],
  interface: ["line", "surface_intersection"],
  instrument_chain: ["line", "ray", "optical_train"],
  wavefront: ["wavefront_family"],
  aperture: ["aperture"],
  screen_pattern: ["screen_pattern"],
  transverse_field: ["transverse_field"],
  polarizer: ["polarizer"],
};

for (const testCase of corpus.cases) {
  const capabilities = inferSceneCapabilities(
    testCase.question,
    testCase.law?.id ? [testCase.law.id] : [],
  );
  if (!capabilities.visualRequired) throw new Error(`${testCase.id}: optics visual was not required`);
  if (capabilities.planningGuidance.length === 0) throw new Error(`${testCase.id}: visual invariants were omitted`);
  for (const family of testCase.visualFamilies) {
    for (const operator of operatorByFamily[family] ?? []) {
      if (!capabilities.constructionOperators.includes(operator)) {
        throw new Error(`${testCase.id}: ${family} did not select ${operator}`);
      }
    }
  }
}

const ydse = corpus.cases.find((item) => item.id === "ydse-advanced");
if (!ydse) throw new Error("missing YDSE test case");
const ydseCapabilities = inferSceneCapabilities(ydse.question, [ydse.law?.id ?? ""]);
const compactPrompt = buildSceneDocumentPlannerPrompt(ydse.question, {
  constructionOperators: ydseCapabilities.constructionOperators,
  proofPredicates: ydseCapabilities.proofPredicates,
  planningGuidance: ydseCapabilities.planningGuidance,
});
if (!ydseCapabilities.proofPredicates.includes("exists")) {
  throw new Error("compact capability test no longer exercises internal predicate filtering");
}
assertExactCapabilityList(
  "inferred compact prompt construction operators",
  promptCapabilitySection(compactPrompt, "AVAILABLE CONSTRUCTION OPERATORS"),
  ydseCapabilities.constructionOperators.filter(isPlannerVisibleSceneConstructionOperator),
);
assertExactCapabilityList(
  "inferred compact prompt proof predicates",
  promptCapabilitySection(compactPrompt, "AVAILABLE PROOF PREDICATES"),
  ydseCapabilities.proofPredicates.filter(isPlannerVisibleSceneProofPredicate),
);
const fullPrompt = buildSceneDocumentPlannerPrompt(ydse.question, {
  constructionOperators: DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
});
if (!compactPrompt.includes("- aperture:") || !compactPrompt.includes("- screen_pattern:")) {
  throw new Error("compact YDSE prompt omitted required operator contracts");
}
if (compactPrompt.includes("- solid_projection:") || compactPrompt.includes("- implicit_curve:")) {
  throw new Error("compact YDSE prompt retained unrelated capability contracts");
}
if (!(compactPrompt.length < fullPrompt.length * 0.72)) {
  throw new Error(`compact prompt did not materially reduce context: ${compactPrompt.length}/${fullPrompt.length}`);
}

const instrument = corpus.cases.find((item) => item.id === "instruments-advanced");
if (!instrument) throw new Error("missing advanced optical-instrument case");
const instrumentCapabilities = inferSceneCapabilities(instrument.question, [instrument.law?.id ?? ""]);
const instrumentPrompt = buildSceneDocumentPlannerPrompt(instrument.question, {
  constructionOperators: instrumentCapabilities.constructionOperators,
  proofPredicates: instrumentCapabilities.proofPredicates,
  planningGuidance: instrumentCapabilities.planningGuidance,
});
if (
  !instrumentPrompt.includes("SELECTED VISUAL INVARIANTS") ||
  !instrumentPrompt.includes("use optical_train for the six rays") ||
  instrumentPrompt.includes("Use aperture for the physical opening")
) {
  throw new Error("instrument prompt did not receive only its selected compact invariants");
}

const physicsEvalPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scene-engine/fixtures/evaluation/jee-physics-core-v1.json",
);
const mathEvalPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scene-engine/fixtures/evaluation/math-visual-core-v1.json",
);
const physicsEval = JSON.parse(readFileSync(physicsEvalPath, "utf8")) as {
  questions: Array<{ id: string; question: string; capabilities: { operators: string[] } }>;
};
const mathEval = JSON.parse(readFileSync(mathEvalPath, "utf8")) as {
  questions: Array<{ id: string; question: string; capabilities: { operators: string[] } }>;
};

function evalQuestion(
  corpus: { questions: Array<{ id: string; question: string; capabilities: { operators: string[] } }> },
  id: string,
): { id: string; question: string; capabilities: { operators: string[] } } {
  const match = corpus.questions.find((item) => item.id === id);
  if (!match) throw new Error(`missing evaluation question ${id}`);
  return match;
}

function assertCompactFamily(
  id: string,
  question: string,
  family: string,
  requiredOperators: readonly string[],
  omittedContracts: readonly string[],
): void {
  const capabilities = inferSceneCapabilities(question);
  if (!capabilities.families.includes(family as typeof capabilities.families[number])) {
    throw new Error(`${id}: expected family ${family}, got ${JSON.stringify(capabilities.families)}`);
  }
  if (capabilities.planningGuidance.length === 0) {
    throw new Error(`${id}: compact invariants were omitted`);
  }
  for (const operator of requiredOperators) {
    if (!capabilities.constructionOperators.includes(operator)) {
      throw new Error(`${id}: family ${family} did not select ${operator}`);
    }
  }
  const prompt = buildSceneDocumentPlannerPrompt(question, {
    constructionOperators: capabilities.constructionOperators,
    proofPredicates: capabilities.proofPredicates,
    planningGuidance: capabilities.planningGuidance,
  });
  if (!prompt.includes("SELECTED VISUAL INVARIANTS")) {
    throw new Error(`${id}: compact prompt omitted selected invariants`);
  }
  for (const operator of omittedContracts) {
    if (prompt.includes(`- ${operator}:`)) {
      throw new Error(`${id}: compact prompt retained unrelated contract ${operator}`);
    }
  }
}

const pulley = evalQuestion(physicsEval, "mechanics-hard-pulley-incline");
assertCompactFamily(
  pulley.id,
  pulley.question,
  "contact_body",
  ["rectangle", "vector", "vector_components", "circle", "surface_contact"],
  ["optical_train", "refract_at", "solid_projection"],
);
const inclineForce = evalQuestion(physicsEval, "mechanics-easy-incline-force");
assertCompactFamily(
  inclineForce.id,
  inclineForce.question,
  "contact_body",
  ["rectangle", "vector", "vector_components"],
  ["optical_train", "refract_at"],
);
const lcr = evalQuestion(physicsEval, "ac-hard-series-lcr");
assertCompactFamily(
  lcr.id,
  lcr.question,
  "circuit_network",
  ["symbol", "connect", "vector", "vector_components"],
  ["optical_train", "refract_at", "solid_projection"],
);
const seriesParallel = evalQuestion(physicsEval, "current-medium-series-parallel-source");
assertCompactFamily(
  seriesParallel.id,
  seriesParallel.question,
  "circuit_network",
  ["symbol", "connect"],
  ["optical_train", "function_curve"],
);
const pvCycle = evalQuestion(physicsEval, "thermal-hard-pv-cycle");
assertCompactFamily(
  pvCycle.id,
  pvCycle.question,
  "state_plot",
  ["axes", "point", "polygon", "polyline"],
  ["optical_train", "refract_at", "symbol"],
);
const parametric = evalQuestion(mathEval, "function-parametric-tangent");
assertCompactFamily(
  parametric.id,
  parametric.question,
  "analytic_curve",
  ["axes", "parametric_curve", "tangent_line"],
  ["optical_train", "symbol", "refract_at"],
);
const parabolaCircle = evalQuestion(mathEval, "coordinate-parabola-circle");
assertCompactFamily(
  parabolaCircle.id,
  parabolaCircle.question,
  "analytic_curve",
  ["axes", "function_curve", "implicit_curve"],
  ["optical_train", "symbol"],
);
const compositeSolid = evalQuestion(mathEval, "mensuration-composite-cap");
assertCompactFamily(
  compositeSolid.id,
  compositeSolid.question,
  "solid_figure",
  ["solid_projection", "dimension"],
  ["optical_train", "refract_at", "symbol"],
);
const prism = evalQuestion(physicsEval, "optics-hard-prism-minimum-deviation");
const prismCapabilities = inferSceneCapabilities(prism.question);
if (!prismCapabilities.families.includes("interface") || !prismCapabilities.families.includes("ray_path")) {
  throw new Error(`prism lost optics families: ${JSON.stringify(prismCapabilities.families)}`);
}
if (prismCapabilities.families.includes("contact_body") || prismCapabilities.families.includes("circuit_network")) {
  throw new Error(`prism was routed to a non-optics family: ${JSON.stringify(prismCapabilities.families)}`);
}

const hydraulic = evalQuestion(physicsEval, "fluids-easy-hydraulic-lift");
assertCompactFamily(
  hydraulic.id,
  hydraulic.question,
  "fluid_apparatus",
  ["rectangle", "connect", "dimension"],
  ["optical_train", "refract_at", "function_curve"],
);
const venturi = evalQuestion(physicsEval, "fluids-medium-venturi");
assertCompactFamily(
  venturi.id,
  venturi.question,
  "fluid_apparatus",
  ["polygon", "polyline", "dimension"],
  ["optical_train", "refract_at"],
);
const pendulum = evalQuestion(physicsEval, "shm-medium-pendulum");
assertCompactFamily(
  pendulum.id,
  pendulum.question,
  "contact_body",
  ["rotate", "arc", "vector"],
  ["optical_train", "refract_at", "symbol"],
);
const standingWave = evalQuestion(physicsEval, "waves-hard-third-harmonic");
assertCompactFamily(
  standingWave.id,
  standingWave.question,
  "analytic_curve",
  ["axes", "function_curve"],
  ["optical_train", "symbol", "refract_at"],
);
const nullPoint = evalQuestion(physicsEval, "electrostatics-easy-null-point");
assertCompactFamily(
  nullPoint.id,
  nullPoint.question,
  "point_field",
  ["point", "vector", "dimension"],
  ["optical_train", "symbol", "refract_at"],
);
const photoelectric = evalQuestion(physicsEval, "modern-easy-photoelectric");
assertCompactFamily(
  photoelectric.id,
  photoelectric.question,
  "energy_level",
  ["axes", "segment", "vector"],
  ["optical_train", "refract_at", "symbol"],
);
const triangle = evalQuestion(mathEval, "coordinate-right-triangle");
assertCompactFamily(
  triangle.id,
  triangle.question,
  "coordinate_figure",
  ["axes", "point", "polygon", "right_angle_mark"],
  ["optical_train", "symbol", "refract_at"],
);
const areaRegion = evalQuestion(mathEval, "function-area-parabola-line");
assertCompactFamily(
  areaRegion.id,
  areaRegion.question,
  "bounded_region",
  ["function_curve", "function_region", "representative_slice"],
  ["optical_train", "symbol"],
);
assertCompactFamily(
  "3d-line-vector-equation",
  "Find the vector equation of the line passing through the point A(1, 2, -1) and parallel to a given line.",
  "coordinate_figure",
  ["axes", "point", "line"],
  ["optical_train", "symbol", "refract_at"],
);

const HINGED_ROD =
  "A thin uniform rod of mass 2 kg and length 1.0 m is hinged at one end and held horizontal. It is released from rest. Draw the rod in the horizontal and vertical positions, mark the hinge and the weight, and find the angular speed of the rod and the magnitude of the hinge reaction when the rod is vertical. Take g = 10 m/s^2.";
assertCompactFamily(
  "hinged-rod-two-positions",
  HINGED_ROD,
  "contact_body",
  ["rotate", "segment", "vector"],
  ["optical_train", "refract_at", "function_curve"],
);
assertCompactFamily(
  "disc-fixed-axis",
  "A uniform disc rotates about a fixed axis through its centre. Draw the disc, the axis, and the torque, then find the angular acceleration.",
  "contact_body",
  ["circle", "vector"],
  ["optical_train", "refract_at"],
);
const telescopeMagnification = inferSceneCapabilities(
  "An astronomical telescope in normal adjustment has objective focal length 1.2 m. Find the angular magnification.",
);
if (telescopeMagnification.families.includes("contact_body")) {
  throw new Error(`angular magnification was routed to contact_body: ${JSON.stringify(telescopeMagnification.families)}`);
}

const GENERIC_EVAL_OPERATORS = new Set(["point", "label", "segment", "line"]);
for (const question of [...physicsEval.questions, ...mathEval.questions]) {
  const capabilities = inferSceneCapabilities(question.question);
  if (capabilities.families.length === 0) {
    throw new Error(`${question.id}: evaluation stem inferred no visual family`);
  }
  const demanded = question.capabilities.operators.filter((operator) => !GENERIC_EVAL_OPERATORS.has(operator));
  const missed = demanded.filter((operator) => !capabilities.constructionOperators.includes(operator));
  if (missed.length > 0) {
    throw new Error(`${question.id}: compact family ${JSON.stringify(capabilities.families)} omitted ${missed.join(", ")}`);
  }
}

console.log("verify-scene-capabilities: ok");
console.log(
  `  cases=${corpus.cases.length} operators=${SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.length} executable_predicates=${EXECUTABLE_SCENE_PROOF_PREDICATES.length} planner_predicates=${PLANNER_VISIBLE_SCENE_PROOF_PREDICATES.length} component_symbols=${SUPPORTED_SCENE_COMPONENT_SYMBOLS.length}`,
);
console.log(`  compact_chars=${compactPrompt.length} full_chars=${fullPrompt.length}`);
