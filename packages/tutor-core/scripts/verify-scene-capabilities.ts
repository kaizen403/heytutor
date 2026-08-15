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
} from "../src/scenePlannerV2Prompt";
import { inferSceneCapabilities } from "../src/sceneCapabilities";

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
  return section.split("\n").map((line) => line.replace(/^- /, ""));
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
  "../../scene-engine/fixtures/evaluation/optics-syllabus-v1.json",
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

console.log("verify-scene-capabilities: ok");
console.log(
  `  cases=${corpus.cases.length} operators=${SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.length} executable_predicates=${EXECUTABLE_SCENE_PROOF_PREDICATES.length} planner_predicates=${PLANNER_VISIBLE_SCENE_PROOF_PREDICATES.length} component_symbols=${SUPPORTED_SCENE_COMPONENT_SYMBOLS.length}`,
);
console.log(`  compact_chars=${compactPrompt.length} full_chars=${fullPrompt.length}`);
