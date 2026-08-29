export type SceneProofPredicateEvaluator = "geometry" | "topology";

export interface SceneProofPredicateCapability<Id extends string = string> {
  readonly id: Id;
  readonly plannerVisible: boolean;
  readonly evaluator: SceneProofPredicateEvaluator;
}

export interface SceneCapabilityManifestDefinition {
  readonly constructionOperators: readonly string[];
  readonly proofPredicates: readonly SceneProofPredicateCapability[];
  readonly componentSymbols: readonly string[];
}

/** Fail fast when a capability namespace contains the same identifier twice. */
export function assertUniqueSceneCapabilityIds(
  capabilityKind: string,
  ids: readonly string[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate ${capabilityKind} capability id${duplicates.size === 1 ? "" : "s"}: ${[...duplicates].join(", ")}`,
    );
  }
}

function defineSceneCapabilityManifest<
  const Definition extends SceneCapabilityManifestDefinition,
>(definition: Definition): Readonly<Definition> {
  assertUniqueSceneCapabilityIds(
    "construction operator",
    definition.constructionOperators,
  );
  assertUniqueSceneCapabilityIds(
    "proof predicate",
    definition.proofPredicates.map((predicate) => predicate.id),
  );
  assertUniqueSceneCapabilityIds("component symbol", definition.componentSymbols);

  for (const predicate of definition.proofPredicates) Object.freeze(predicate);
  Object.freeze(definition.constructionOperators);
  Object.freeze(definition.proofPredicates);
  Object.freeze(definition.componentSymbols);
  return Object.freeze(definition);
}

type CapabilityIds<Entries extends readonly { readonly id: string }[]> = {
  readonly [Index in keyof Entries]: Entries[Index] extends {
    readonly id: infer Id extends string;
  } ? Id : never;
};

type FilteredProofPredicateIds<
  Entries extends readonly SceneProofPredicateCapability[],
  Match extends Partial<SceneProofPredicateCapability>,
> = Entries extends readonly [
  infer Head extends SceneProofPredicateCapability,
  ...infer Tail extends readonly SceneProofPredicateCapability[],
]
  ? Head extends Match
    ? readonly [Head["id"], ...FilteredProofPredicateIds<Tail, Match>]
    : FilteredProofPredicateIds<Tail, Match>
  : readonly [];

function capabilityIds<
  const Entries extends readonly { readonly id: string }[],
>(entries: Entries): CapabilityIds<Entries> {
  return Object.freeze(entries.map(({ id }) => id)) as unknown as CapabilityIds<Entries>;
}

function plannerVisibleProofPredicateIds<
  const Entries extends readonly SceneProofPredicateCapability[],
>(entries: Entries): FilteredProofPredicateIds<Entries, { readonly plannerVisible: true }> {
  return Object.freeze(
    entries.filter(({ plannerVisible }) => plannerVisible).map(({ id }) => id),
  ) as unknown as FilteredProofPredicateIds<Entries, { readonly plannerVisible: true }>;
}

function proofPredicateIdsForEvaluator<
  const Entries extends readonly SceneProofPredicateCapability[],
  const Evaluator extends SceneProofPredicateEvaluator,
>(
  entries: Entries,
  evaluator: Evaluator,
): FilteredProofPredicateIds<Entries, { readonly evaluator: Evaluator }> {
  return Object.freeze(
    entries.filter((predicate) => predicate.evaluator === evaluator).map(({ id }) => id),
  ) as unknown as FilteredProofPredicateIds<Entries, { readonly evaluator: Evaluator }>;
}

/** Canonical executable capabilities for scene-document/v2. */
export const SCENE_CAPABILITY_MANIFEST = defineSceneCapabilityManifest({
  constructionOperators: [
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
    "constraint_region",
    "parametric_curve",
    "polar_curve",
    "implicit_curve",
    "tangent_line",
    "normal_line",
    "representative_slice",
    "solid_of_revolution",
    "solid_projection",
    "solid_cross_section",
    "space_frame",
    "space_point",
    "space_line",
    "plane",
    "wavefront_family",
    "aperture",
    "screen_pattern",
    "transverse_field",
    "polarizer",
    "optical_train",
    "spherical_surface",
    "lens_section",
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
    "sign_badge",
    "vector_components",
    "dimension",
    "connect",
    "symbol",
    "label",
  ],
  proofPredicates: [
    // Existence is already enforced by requiredEntityIds, not requested from planners.
    { id: "exists", plannerVisible: false, evaluator: "geometry" },
    { id: "entity_count", plannerVisible: true, evaluator: "geometry" },
    { id: "connected", plannerVisible: true, evaluator: "geometry" },
    { id: "incident", plannerVisible: true, evaluator: "geometry" },
    { id: "on", plannerVisible: true, evaluator: "geometry" },
    { id: "between", plannerVisible: true, evaluator: "geometry" },
    { id: "parallel", plannerVisible: true, evaluator: "geometry" },
    { id: "perpendicular", plannerVisible: true, evaluator: "geometry" },
    { id: "collinear", plannerVisible: true, evaluator: "geometry" },
    { id: "equal_length", plannerVisible: true, evaluator: "geometry" },
    { id: "equal_angle", plannerVisible: true, evaluator: "geometry" },
    { id: "angle_between", plannerVisible: true, evaluator: "geometry" },
    { id: "converges", plannerVisible: true, evaluator: "geometry" },
    { id: "label_attached", plannerVisible: true, evaluator: "geometry" },
    { id: "distance_ratio", plannerVisible: true, evaluator: "geometry" },
    { id: "same_side", plannerVisible: true, evaluator: "geometry" },
    { id: "opposite_direction", plannerVisible: true, evaluator: "geometry" },
    // Kept executable for validated internal documents; it is not in the planner contract.
    { id: "vector_sum", plannerVisible: false, evaluator: "geometry" },
    { id: "inside", plannerVisible: true, evaluator: "geometry" },
    { id: "ordered_along", plannerVisible: true, evaluator: "geometry" },
    { id: "equal_spacing", plannerVisible: true, evaluator: "geometry" },
    { id: "snells_law", plannerVisible: true, evaluator: "geometry" },
    { id: "function_value", plannerVisible: true, evaluator: "geometry" },
    { id: "root", plannerVisible: true, evaluator: "geometry" },
    { id: "wave_cycles", plannerVisible: true, evaluator: "geometry" },
    { id: "path", plannerVisible: true, evaluator: "topology" },
    { id: "pathCount", plannerVisible: true, evaluator: "topology" },
    { id: "sameTerminalPair", plannerVisible: true, evaluator: "topology" },
    { id: "degree", plannerVisible: true, evaluator: "topology" },
  ],
  componentSymbols: [
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
  ],
} as const);

export const SUPPORTED_SCENE_CONSTRUCTION_OPERATORS =
  SCENE_CAPABILITY_MANIFEST.constructionOperators;

export const PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS =
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS;

export type SupportedSceneConstructionOperator =
  (typeof SUPPORTED_SCENE_CONSTRUCTION_OPERATORS)[number];

export type PlannerVisibleSceneConstructionOperator =
  (typeof PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS)[number];

const EXECUTABLE_SCENE_CONSTRUCTION_OPERATOR_SET = new Set<string>(
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
);

export function isExecutableSceneConstructionOperator(
  operator: string,
): operator is SupportedSceneConstructionOperator {
  return EXECUTABLE_SCENE_CONSTRUCTION_OPERATOR_SET.has(operator);
}

export function isPlannerVisibleSceneConstructionOperator(
  operator: string,
): operator is PlannerVisibleSceneConstructionOperator {
  return EXECUTABLE_SCENE_CONSTRUCTION_OPERATOR_SET.has(operator);
}

export const EXECUTABLE_SCENE_PROOF_PREDICATES = capabilityIds(
  SCENE_CAPABILITY_MANIFEST.proofPredicates,
);

export type ExecutableSceneProofPredicate =
  (typeof EXECUTABLE_SCENE_PROOF_PREDICATES)[number];

export const PLANNER_VISIBLE_SCENE_PROOF_PREDICATES =
  plannerVisibleProofPredicateIds(SCENE_CAPABILITY_MANIFEST.proofPredicates);

export type PlannerVisibleSceneProofPredicate =
  (typeof PLANNER_VISIBLE_SCENE_PROOF_PREDICATES)[number];

export const GEOMETRY_SCENE_PROOF_PREDICATES = proofPredicateIdsForEvaluator(
  SCENE_CAPABILITY_MANIFEST.proofPredicates,
  "geometry",
);

export type GeometrySceneProofPredicate =
  (typeof GEOMETRY_SCENE_PROOF_PREDICATES)[number];

export const TOPOLOGY_SCENE_PROOF_PREDICATES = proofPredicateIdsForEvaluator(
  SCENE_CAPABILITY_MANIFEST.proofPredicates,
  "topology",
);

export type TopologySceneProofPredicate =
  (typeof TOPOLOGY_SCENE_PROOF_PREDICATES)[number];

const EXECUTABLE_SCENE_PROOF_PREDICATE_SET = new Set<string>(
  EXECUTABLE_SCENE_PROOF_PREDICATES,
);
const PLANNER_VISIBLE_SCENE_PROOF_PREDICATE_SET = new Set<string>(
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES,
);
const TOPOLOGY_SCENE_PROOF_PREDICATE_SET = new Set<string>(
  TOPOLOGY_SCENE_PROOF_PREDICATES,
);

export function isExecutableSceneProofPredicate(
  predicate: string,
): predicate is ExecutableSceneProofPredicate {
  return EXECUTABLE_SCENE_PROOF_PREDICATE_SET.has(predicate);
}

export function isPlannerVisibleSceneProofPredicate(
  predicate: string,
): predicate is PlannerVisibleSceneProofPredicate {
  return PLANNER_VISIBLE_SCENE_PROOF_PREDICATE_SET.has(predicate);
}

export function isTopologySceneProofPredicate(
  predicate: string,
): predicate is TopologySceneProofPredicate {
  return TOPOLOGY_SCENE_PROOF_PREDICATE_SET.has(predicate);
}

export const SUPPORTED_SCENE_COMPONENT_SYMBOLS =
  SCENE_CAPABILITY_MANIFEST.componentSymbols;

export type SupportedSceneComponentSymbol =
  (typeof SUPPORTED_SCENE_COMPONENT_SYMBOLS)[number];
