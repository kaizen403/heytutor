/**
 * Syllabus capability coverage harness.
 *
 * Reads the classified question-bank corpus (built locally via
 * tools/question-bank/importers/build_corpus.py + build_syllabus_index.py) and measures,
 * deterministically, whether the scene-engine capability manifest can express and
 * verify the geometry each question's syllabus unit demands.
 *
 * This is a capability-coverage report, NOT a runtime diagram selector. The corpus
 * is an oracle for capability growth only. No question text is routed into the live
 * turn, and no per-question or per-chapter templates are produced. Output is a
 * unit-by-unit pass/coverable/missing-capability matrix used to pick the next
 * reusable operator or proof predicate to implement.
 *
 * Tier A+ (compile_probe): for each diagram-led unit with a defined demand, the
 * `easy` scene-document/v2 candidate uses the unit's demanded operators, runs
 * validate + compile, and requires the demanded proof predicates to pass.
 * Additional depth levels (medium / hard / composite) live in the same registry
 * and are reported under `compile_probe_depth`; they never relax the easy gate.
 * Units whose probe would be vacuous or genuinely hard to author honestly are
 * marked compileProbe: "skip" and reported as probe_not_implemented instead of
 * being faked green.
 *
 * Usage:
 *   pnpm --filter @heytutor/scene-engine tsx scripts/verify/verify-syllabus-corpus.ts
 *   pnpm --filter @heytutor/scene-engine tsx scripts/verify/verify-syllabus-corpus.ts --report <path>
 *
 * Inputs (gitignored, local-only):
 *   data/question-bank/build/questions.all.jsonl
 *   data/question-bank/build/question-syllabus.jsonl
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExecutableSceneConstructionOperator,
  isExecutableSceneProofPredicate,
} from "../../src/capability/capabilityManifest";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
import { validateSceneDocument } from "../../src/document/validation";

// ---------------------------------------------------------------------------
// Corpus input types (subset of the question-bank schemas we actually read).
// ---------------------------------------------------------------------------

interface BankQuestion {
  question_id: string;
  text?: string;
  topic?: string | null;
  subtopic?: string | null;
  source_refs?: { document_id?: string }[];
}

interface SyllabusAssignment {
  question_id: string;
  status: string;
  subject?: string | null;
  primary_unit_id?: string | null;
  confidence?: string | null;
  syllabus_scope?: string | null;
}

/**
 * A unit's capability demand: the reusable operators and proof predicates a
 * verifiable diagram for a typical question in this unit must use.
 *
 * Only operators/predicates already named in the capability manifest may appear.
 * A unit with an empty demand is "not diagram-led" (text-only is honest there) and
 * is reported separately rather than failed.
 */
interface UnitCapabilityDemand {
  operators: readonly string[];
  predicates: readonly string[];
  /** True when the unit is fundamentally diagram-led (geometry/fields/circuits). */
  diagramLed: boolean;
  /**
   * "skip" records that no honest compile probe exists yet for this unit; it is
   * reported as probe_not_implemented and never counts as a failure.
   */
  compileProbe?: "skip";
}

// ---------------------------------------------------------------------------
// Unit -> capability demand inference.
//
// Conservative: only units that are unambiguously diagram-led carry a demand, and
// the demand names only the minimal reusable primitives a correct figure needs.
// Units that are primarily algebraic (sets, sequences, probability, complex
// arithmetic) are diagramLed=false so they never inflate the failure count.
// ---------------------------------------------------------------------------

const GEOMETRY_POINT_OPS = ["point", "segment", "label"] as const;
const CARTESIAN_OPS = ["axes", "function_curve", "label"] as const;

const UNIT_DEMAND: Record<string, UnitCapabilityDemand> = {
  // --- Mathematics ---
  "maths|7": {
    // limits/continuity/differentiability -> cartesian curve + tangent
    operators: [...CARTESIAN_OPS, "tangent_line"],
    predicates: ["function_value"],
    diagramLed: true,
  },
  "maths|8": {
    // integral calculus -> curve + region under/between curves
    operators: [...CARTESIAN_OPS, "function_region"],
    predicates: ["function_value"],
    diagramLed: true,
  },
  "maths|9": {
    // differential equations -> slope fields are not yet expressible; curve only
    operators: [...CARTESIAN_OPS],
    predicates: ["function_value"],
    diagramLed: true,
  },
  "maths|10": {
    // coordinate geometry -> points, lines, conics, tangents
    operators: [...GEOMETRY_POINT_OPS, "line", "circle", "tangent_line", "intersection"],
    predicates: ["collinear", "perpendicular", "parallel"],
    diagramLed: true,
  },
  "maths|11": {
    // 3D geometry -> isometric frame, lines, and planes
    operators: [...GEOMETRY_POINT_OPS, "vector", "space_frame", "space_point", "space_line", "plane"],
    predicates: ["perpendicular", "parallel"],
    diagramLed: true,
  },
  "maths|12": {
    // vector algebra -> vectors, components, projections
    operators: ["vector", "vector_components", "axes", "label"],
    predicates: ["perpendicular", "parallel", "equal_length"],
    diagramLed: true,
  },
  "maths|14": {
    // trigonometry -> angle marks, triangles
    operators: [...GEOMETRY_POINT_OPS, "angle_mark", "right_angle_mark"],
    predicates: ["equal_angle", "angle_between"],
    diagramLed: true,
  },

  // --- Physics ---
  "physics|2": {
    // kinematics -> motion diagram: vector, axes, trajectory
    operators: ["vector", "axes", "parametric_curve", "label"],
    predicates: ["function_value"],
    diagramLed: true,
  },
  "physics|3": {
    // laws of motion -> free-body: vectors + contact surfaces
    operators: ["vector", "surface_contact", "rectangle", "label"],
    predicates: ["perpendicular", "opposite_direction", "connected"],
    diagramLed: true,
  },
  "physics|4": {
    // work/energy -> force vectors + displacement
    operators: ["vector", "vector_components", "label"],
    predicates: ["parallel", "angle_between"],
    diagramLed: true,
  },
  "physics|5": {
    // rotational -> rigid body (circle), axis of rotation (point), torque vectors
    operators: ["vector", "circle", "point", "label"],
    predicates: ["angle_between", "perpendicular"],
    diagramLed: true,
  },
  "physics|11": {
    // electrostatics -> charges (points) + field/force vectors
    operators: ["point", "vector", "label"],
    predicates: ["opposite_direction", "equal_length", "parallel"],
    diagramLed: true,
  },
  "physics|12": {
    // current electricity -> circuit symbols + topology
    operators: ["symbol", "connect", "point", "label"],
    predicates: ["path", "sameTerminalPair", "degree"],
    diagramLed: true,
  },
  "physics|13": {
    // magnetic effects -> field lines around conductor, force on wire
    operators: ["point", "vector", "circle", "label"],
    predicates: ["perpendicular", "parallel"],
    diagramLed: true,
  },
  "physics|14": {
    // EMI/AC -> circuits + coils
    operators: ["symbol", "connect", "label"],
    predicates: ["path", "degree"],
    diagramLed: true,
  },
  "physics|16": {
    // optics -> rays, surfaces, refraction/reflection
    operators: ["ray", "refract_at", "reflect_at", "surface_contact", "normal_at", "label"],
    predicates: ["snells_law", "equal_angle", "angle_between"],
    diagramLed: true,
  },
  "physics|10": {
    // oscillations/waves -> wavefront family (equal_spacing) + transverse wave (wave_cycles)
    operators: ["wavefront_family", "transverse_field", "axes", "label"],
    predicates: ["wave_cycles", "equal_spacing"],
    diagramLed: true,
  },
};

// ---------------------------------------------------------------------------
// Tier A+ compile probes.
//
// For each diagram-led unit with a defined demand, build a minimal but real
// scene-document/v2 candidate that uses the unit's demanded operators, run the
// deterministic validate + compile pipeline, and require the demanded proof
// predicates to pass on the compiled geometry. Tier A proves a capability name
// exists; Tier A+ proves the pipeline can actually compile and verify a
// representative scene for the unit. The `easy` scene is the release gate;
// medium / hard / composite scenes add depth without replacing it. A probe is
// not a template: entities carry no labels (label placement is a layout concern,
// not an operator capability) and geometry is chosen so every demanded predicate
// holds exactly.
// ---------------------------------------------------------------------------

const PROBE_LEVELS = ["easy", "medium", "hard", "composite"] as const;
type ProbeLevel = (typeof PROBE_LEVELS)[number];
type ProbeLevels = { easy: Record<string, unknown> } & Partial<Record<ProbeLevel, Record<string, unknown>>>;

/** Highest-volume diagram-led units; they must carry medium + composite depth. */
const TOP_VOLUME_UNITS = [
  "physics|16",
  "physics|11",
  "maths|10",
  "physics|14",
  "physics|13",
  "maths|8",
  "physics|12",
] as const;

function expectedProbeLevels(unit: string): ProbeLevel[] {
  return (TOP_VOLUME_UNITS as readonly string[]).includes(unit)
    ? ["easy", "medium", "composite"]
    : ["easy"];
}

type ProbeSpec = Omit<SceneDocument, "schemaVersion" | "visualDecision" | "source" | "requiredEntityIds" | "revealGroups" | "teachingTimeline">;

/** Assemble the ownership boilerplate every valid scene document needs. */
function probeScene(unit: string, stem: string, spec: ProbeSpec): Record<string, unknown> {
  const entityIds = spec.entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: `${unit} capability probe` },
    source: { question: stem },
    ...spec,
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "probe", entityIds, dependsOn: [], narrationCue: "probe" }],
    teachingTimeline: [{ id: "reveal_probe", action: "reveal", targetId: "probe", dependsOn: [], narrationIntent: "probe" }],
  };
}

function pointEntity(id: string, role: string): SceneDocument["entities"][number] {
  return { id, kind: "point", role };
}

function pointConstruction(id: string, x: number, y: number): SceneDocument["constructions"][number] {
  return { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] };
}

interface CurveProbeInput {
  curveId: string;
  expression: string;
  xMin: number;
  xMax: number;
  assertions: SceneDocument["assertions"];
  extraAssertions?: SceneDocument["assertions"];
  extraEntities?: SceneDocument["entities"];
  extraConstructions?: SceneDocument["constructions"];
}

/** Cartesian axes + one function curve + function_value assertions. */
function cartesianProbeScene(unit: string, stem: string, input: CurveProbeInput): Record<string, unknown> {
  return probeScene(unit, stem, {
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id: input.curveId, kind: "curve", role: "function graph" },
      ...(input.extraEntities ?? []),
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: input.xMin, xMax: input.xMax, yMin: -0.5, yMax: 4.5 }, outputs: ["axes"] },
      {
        id: `make_${input.curveId}`,
        operator: "function_curve",
        inputs: { expression: input.expression, xMin: input.xMin, xMax: input.xMax, samples: 65 },
        outputs: [input.curveId],
      },
      ...(input.extraConstructions ?? []),
    ],
    relations: [],
    assertions: [...input.assertions, ...(input.extraAssertions ?? [])],
    annotations: [],
  });
}

/** Directed vectors out of a shared origin, plus the demanded assertions. */
function vectorProbeScene(
  unit: string,
  stem: string,
  options: {
    vectors: Array<{ id: string; role: string; start: [number, number]; end: [number, number] }>;
    assertions: SceneDocument["assertions"];
    extraEntities?: SceneDocument["entities"];
    extraConstructions?: SceneDocument["constructions"];
  },
): Record<string, unknown> {
  const pointIds = new Map<string, string>();
  const pointIdFor = (p: [number, number]): string => {
    const key = `${p[0]}:${p[1]}`;
    const existing = pointIds.get(key);
    if (existing) return existing;
    const id = `p${pointIds.size}`;
    pointIds.set(key, id);
    return id;
  };
  const constructions: SceneDocument["constructions"] = [];
  const entities: SceneDocument["entities"] = [];
  for (const vector of options.vectors) {
    const startId = pointIdFor(vector.start);
    const endId = pointIdFor(vector.end);
    constructions.push({
      id: `make_${vector.id}`,
      operator: "vector",
      inputs: { start: startId, end: endId },
      outputs: [vector.id],
    });
    entities.push({ id: vector.id, kind: "vector", role: vector.role });
  }
  for (const [key, id] of pointIds) {
    const [x, y] = key.split(":").map(Number) as [number, number];
    entities.unshift(pointEntity(id, "reference point"));
    constructions.unshift(pointConstruction(id, x, y));
  }
  return probeScene(unit, stem, {
    quantities: [],
    entities: [...entities, ...(options.extraEntities ?? [])],
    constructions: [...constructions, ...(options.extraConstructions ?? [])],
    relations: [],
    assertions: options.assertions,
    annotations: [],
  });
}

/** Circuit symbols + optional wires, with topology assertions. */
function circuitProbeScene(
  unit: string,
  stem: string,
  spec: {
    nodes: Array<{ id: string; x: number; y: number; role?: string }>;
    symbols: Array<{ id: string; symbol: string; start: string; end: string; role: string }>;
    connectors?: Array<{ id: string; start: string; end: string; role: string }>;
    assertions: SceneDocument["assertions"];
  },
): Record<string, unknown> {
  return probeScene(unit, stem, {
    quantities: [],
    entities: [
      ...spec.nodes.map((node) => pointEntity(node.id, node.role ?? "node")),
      ...spec.symbols.map((symbol) => ({ id: symbol.id, kind: "component" as const, role: symbol.role })),
      ...(spec.connectors ?? []).map((connector) => ({
        id: connector.id,
        kind: "connector" as const,
        role: connector.role,
      })),
    ],
    constructions: [
      ...spec.nodes.map((node) => pointConstruction(node.id, node.x, node.y)),
      ...spec.symbols.map((symbol) => ({
        id: `make_${symbol.id}`,
        operator: "symbol" as const,
        inputs: { symbol: symbol.symbol, start: symbol.start, end: symbol.end },
        outputs: [symbol.id],
      })),
      ...(spec.connectors ?? []).map((connector) => ({
        id: `make_${connector.id}`,
        operator: "connect" as const,
        inputs: { start: connector.start, end: connector.end },
        outputs: [connector.id],
      })),
    ],
    relations: [],
    assertions: spec.assertions,
    annotations: [],
  });
}

const ASSERTION_ISSUE_CODES = new Set([
  "assertion_failed",
  "unsupported_assertion",
  "assertion_entity_unconstructed",
]);

/** Every demanded predicate of a unit appears as an assertion in the probe scene. */
function probeAssertionCoverage(unit: string, candidate: Record<string, unknown>): string[] {
  const demand = UNIT_DEMAND[unit];
  if (!demand) return [];
  const assertions = Array.isArray(candidate.assertions) ? candidate.assertions : [];
  return demand.predicates.filter((predicate) =>
    !assertions.some((assertion) =>
      typeof assertion === "object" && assertion !== null &&
      (assertion as { predicate?: unknown }).predicate === predicate),
  );
}

function fatalAssertion(
  id: string,
  predicate: string,
  entities: string[],
  expected: unknown,
  reason: string,
  extra?: { tolerance?: number },
): SceneDocument["assertions"][number] {
  return {
    id,
    predicate,
    entities,
    expected,
    severity: "fatal",
    reason,
    ...(extra?.tolerance !== undefined ? { tolerance: extra.tolerance } : {}),
  };
}

/** Two parallel interfaces: air→glass then glass→air, plus a reflection on the first face. */
function physics16MediumSlab(): Record<string, unknown> {
  return probeScene(
    "physics|16",
    "A ray hits a glass slab at 45 degrees, refracts at both faces, and partially reflects at the first interface",
    {
      quantities: [],
      entities: [
        pointEntity("top_start", "first interface start"),
        pointEntity("top_end", "first interface end"),
        pointEntity("bottom_start", "second interface start"),
        pointEntity("bottom_end", "second interface end"),
        pointEntity("hit1", "first point of incidence"),
        pointEntity("hit2", "second point of incidence"),
        pointEntity("reflect_hit", "reflection point on the first face"),
        { id: "interface1", kind: "segment", role: "air-glass interface" },
        { id: "interface2", kind: "segment", role: "glass-air interface" },
        { id: "incident1", kind: "ray", role: "incident ray at first face" },
        { id: "normal1", kind: "vector", role: "normal at first face" },
        { id: "refracted1", kind: "ray", role: "refracted ray in glass" },
        { id: "reflected", kind: "ray", role: "reflected ray at first face" },
        { id: "reflect_incident", kind: "ray", role: "incident bundle for reflection" },
        { id: "reflect_normal", kind: "vector", role: "normal used by reflection" },
        { id: "incident2", kind: "ray", role: "incident ray at second face" },
        { id: "normal2", kind: "vector", role: "normal at second face" },
        { id: "refracted2", kind: "ray", role: "exit ray into air" },
      ],
      constructions: [
        pointConstruction("top_start", -2, 0),
        pointConstruction("top_end", 2, 0),
        pointConstruction("bottom_start", -2, -1.5),
        pointConstruction("bottom_end", 2, -1.5),
        pointConstruction("hit1", 0, 0),
        pointConstruction("hit2", 0, -1.5),
        pointConstruction("reflect_hit", 1, 0),
        { id: "make_interface1", operator: "segment", inputs: { start: "top_start", end: "top_end" }, outputs: ["interface1"] },
        { id: "make_interface2", operator: "segment", inputs: { start: "bottom_start", end: "bottom_end" }, outputs: ["interface2"] },
        {
          id: "make_refraction1",
          operator: "refract_at",
          inputs: { point: "hit1", surface: "interface1", incidentAngleDeg: 45, n1: 1, n2: 1.5 },
          outputs: ["incident1", "normal1", "refracted1"],
        },
        {
          id: "make_reflection",
          operator: "reflect_at",
          inputs: { point: "reflect_hit", surface: "interface1", incidentAngleDeg: 30 },
          outputs: ["reflect_incident", "reflect_normal", "reflected"],
        },
        {
          id: "make_refraction2",
          operator: "refract_at",
          inputs: { point: "hit2", surface: "interface2", incidentAngleDeg: 28.1255, n1: 1.5, n2: 1 },
          outputs: ["incident2", "normal2", "refracted2"],
        },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_snells_law", "snells_law", ["incident1", "normal1", "refracted1"], { n1: 1, n2: 1.5 }, "n1 sin(i) = n2 sin(r) at the first face", { tolerance: 1e-3 }),
        fatalAssertion("probe_snells_law_exit", "snells_law", ["incident2", "normal2", "refracted2"], { n1: 1.5, n2: 1 }, "n1 sin(i) = n2 sin(r) at the second face", { tolerance: 1e-3 }),
        fatalAssertion("probe_equal_angle", "equal_angle", ["reflect_incident", "reflect_normal", "reflected", "reflect_normal"], true, "incidence equals reflection at the first face", { tolerance: 1e-3 }),
        fatalAssertion("probe_angle_between", "angle_between", ["incident1", "normal1"], { value: 45, unit: "degree" }, "the incident ray meets the first normal at 45 degrees", { tolerance: 1e-3 }),
      ],
      annotations: [],
    },
  );
}

/** Shared axis: refracting face + focusing rays + a mirror reflection. */
function physics16CompositeAxis(): Record<string, unknown> {
  return probeScene(
    "physics|16",
    "On one optical axis a ray refracts at a glass face, two rays converge at the focus, and a mirror reflects",
    {
      quantities: [],
      entities: [
        pointEntity("axis_left", "axis endpoint"),
        pointEntity("axis_right", "axis endpoint"),
        pointEntity("glass_top", "glass face endpoint"),
        pointEntity("glass_bottom", "glass face endpoint"),
        pointEntity("glass_hit", "point of incidence on the glass"),
        pointEntity("mirror_top", "mirror endpoint"),
        pointEntity("mirror_bottom", "mirror endpoint"),
        pointEntity("mirror_hit", "point of incidence on the mirror"),
        pointEntity("focus", "common focus"),
        pointEntity("ray1_start", "upper converging ray start"),
        pointEntity("ray2_start", "lower converging ray start"),
        { id: "axis", kind: "line", role: "optical axis" },
        { id: "glass", kind: "segment", role: "air-glass interface" },
        { id: "mirror", kind: "segment", role: "reflecting face" },
        { id: "incident", kind: "ray", role: "incident ray at glass" },
        { id: "normal", kind: "vector", role: "normal at glass" },
        { id: "refracted", kind: "ray", role: "refracted ray" },
        { id: "mirror_incident", kind: "ray", role: "incident ray at mirror" },
        { id: "mirror_normal", kind: "vector", role: "normal at mirror" },
        { id: "reflected", kind: "ray", role: "reflected ray" },
        { id: "ray1", kind: "ray", role: "upper ray through the focus" },
        { id: "ray2", kind: "ray", role: "lower ray through the focus" },
      ],
      constructions: [
        pointConstruction("axis_left", -6, 0),
        pointConstruction("axis_right", 6, 0),
        pointConstruction("glass_top", -2, 2),
        pointConstruction("glass_bottom", -2, -2),
        pointConstruction("glass_hit", -2, 0),
        pointConstruction("mirror_top", 4, 1),
        pointConstruction("mirror_bottom", 4, -1),
        pointConstruction("mirror_hit", 4, 0),
        pointConstruction("focus", 2, 0),
        pointConstruction("ray1_start", 0, 1),
        pointConstruction("ray2_start", 0, -1),
        { id: "make_axis", operator: "line", inputs: { start: "axis_left", end: "axis_right" }, outputs: ["axis"] },
        { id: "make_glass", operator: "segment", inputs: { start: "glass_top", end: "glass_bottom" }, outputs: ["glass"] },
        { id: "make_mirror", operator: "segment", inputs: { start: "mirror_top", end: "mirror_bottom" }, outputs: ["mirror"] },
        {
          id: "make_refraction",
          operator: "refract_at",
          inputs: { point: "glass_hit", surface: "glass", incidentAngleDeg: 45, n1: 1, n2: 1.5 },
          outputs: ["incident", "normal", "refracted"],
        },
        {
          id: "make_reflection",
          operator: "reflect_at",
          inputs: { point: "mirror_hit", surface: "mirror", incidentAngleDeg: 30 },
          outputs: ["mirror_incident", "mirror_normal", "reflected"],
        },
        { id: "make_ray1", operator: "ray", inputs: { start: "ray1_start", end: "focus" }, outputs: ["ray1"] },
        { id: "make_ray2", operator: "ray", inputs: { start: "ray2_start", end: "focus" }, outputs: ["ray2"] },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_snells_law", "snells_law", ["incident", "normal", "refracted"], { n1: 1, n2: 1.5 }, "Snell holds at the glass face", { tolerance: 1e-3 }),
        fatalAssertion("probe_equal_angle", "equal_angle", ["mirror_incident", "mirror_normal", "reflected", "mirror_normal"], true, "incidence equals reflection at the mirror", { tolerance: 1e-3 }),
        fatalAssertion("probe_angle_between", "angle_between", ["incident", "normal"], { value: 45, unit: "degree" }, "the glass incident ray meets the normal at 45 degrees", { tolerance: 1e-3 }),
        fatalAssertion("probe_converges", "converges", ["ray1", "ray2", "focus"], true, "the two rays meet at the constructed focus"),
      ],
      annotations: [],
    },
  );
}

/** Three collinear charges with two Newton-third-law force pairs. */
function physics11MediumCharges(): Record<string, unknown> {
  return vectorProbeScene(
    "physics|11",
    "Three collinear charges; neighbouring pairs feel equal and opposite Coulomb forces",
    {
      vectors: [
        { id: "force_ab", role: "force on A from B", start: [-2, 0], end: [-3, 0] },
        { id: "force_ba", role: "force on B from A", start: [0, 0], end: [1, 0] },
        { id: "force_bc", role: "force on B from C", start: [0, 0], end: [-1, 0] },
        { id: "force_cb", role: "force on C from B", start: [2, 0], end: [3, 0] },
      ],
      assertions: [
        fatalAssertion("probe_opposite_direction", "opposite_direction", ["force_ab", "force_ba"], true, "A and B exert opposite forces"),
        fatalAssertion("probe_equal_length", "equal_length", ["force_ab", "force_ba"], true, "the A-B pair has equal magnitude"),
        fatalAssertion("probe_parallel", "parallel", ["force_ab", "force_cb"], true, "all three charges lie on one line of force"),
      ],
    },
  );
}

/** Newton-third-law pair on an axis plus a test charge with a non-collinear vector sum. */
function physics11CompositeForces(): Record<string, unknown> {
  return probeScene(
    "physics|11",
    "Two charges on an axis feel equal opposite forces while a test charge feels two non-collinear forces that sum",
    {
      quantities: [],
      entities: [
        pointEntity("a", "charge A"),
        pointEntity("b", "charge B"),
        pointEntity("test", "test charge"),
        pointEntity("axis_start", "axis endpoint"),
        pointEntity("axis_end", "axis endpoint"),
        pointEntity("force_on_a_tip", "tip of force on A"),
        pointEntity("force_on_b_tip", "tip of force on B"),
        pointEntity("force_from_a_tip", "tip of force from A on the test charge"),
        pointEntity("force_from_b_tip", "tip of force from B on the test charge"),
        pointEntity("resultant_tip", "tip of the resultant on the test charge"),
        { id: "axis", kind: "segment", role: "line of charges" },
        { id: "force_on_a", kind: "vector", role: "force on A" },
        { id: "force_on_b", kind: "vector", role: "force on B" },
        { id: "force_from_a", kind: "vector", role: "force on the test charge from A" },
        { id: "force_from_b", kind: "vector", role: "force on the test charge from B" },
        { id: "resultant", kind: "vector", role: "resultant on the test charge" },
      ],
      constructions: [
        pointConstruction("a", -2, 0),
        pointConstruction("b", 2, 0),
        pointConstruction("test", 0, 2),
        pointConstruction("axis_start", -3, 0),
        pointConstruction("axis_end", 3, 0),
        pointConstruction("force_on_a_tip", -3, 0),
        pointConstruction("force_on_b_tip", 3, 0),
        pointConstruction("force_from_a_tip", 1, 3),
        pointConstruction("force_from_b_tip", -1, 3),
        pointConstruction("resultant_tip", 0, 4),
        { id: "make_axis", operator: "segment", inputs: { start: "axis_start", end: "axis_end" }, outputs: ["axis"] },
        { id: "make_force_on_a", operator: "vector", inputs: { start: "a", end: "force_on_a_tip" }, outputs: ["force_on_a"] },
        { id: "make_force_on_b", operator: "vector", inputs: { start: "b", end: "force_on_b_tip" }, outputs: ["force_on_b"] },
        { id: "make_force_from_a", operator: "vector", inputs: { start: "test", end: "force_from_a_tip" }, outputs: ["force_from_a"] },
        { id: "make_force_from_b", operator: "vector", inputs: { start: "test", end: "force_from_b_tip" }, outputs: ["force_from_b"] },
        { id: "make_resultant", operator: "vector", inputs: { start: "test", end: "resultant_tip" }, outputs: ["resultant"] },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_opposite_direction", "opposite_direction", ["force_on_a", "force_on_b"], true, "Newton's third law on the axis pair"),
        fatalAssertion("probe_equal_length", "equal_length", ["force_on_a", "force_on_b"], true, "the axis pair has equal magnitude"),
        fatalAssertion("probe_parallel", "parallel", ["force_on_a", "force_on_b"], true, "the axis pair is collinear with the axis"),
        fatalAssertion("probe_on_a", "on", ["a", "axis"], true, "charge A lies on the constructed axis"),
        fatalAssertion("probe_vector_sum", "vector_sum", ["force_from_a", "force_from_b", "resultant"], true, "the two non-collinear forces close a parallelogram"),
        fatalAssertion("probe_angle_between", "angle_between", ["force_from_a", "force_from_b"], { value: 90, unit: "degree" }, "the forces on the test charge are perpendicular", { tolerance: 1e-3 }),
      ],
      annotations: [],
    },
  );
}

/** Circle, radius, tangent, and a parallel companion line. */
function maths10MediumCircle(): Record<string, unknown> {
  return probeScene(
    "maths|10",
    "Radius OB of the circle x^2+y^2=4 is perpendicular to the tangent at B, and a companion line is parallel to that tangent",
    {
      quantities: [],
      entities: [
        pointEntity("o", "centre"),
        pointEntity("b", "point of tangency"),
        pointEntity("d", "second point on the circle"),
        pointEntity("companion_tip", "direction point for the companion line"),
        pointEntity("diagonal_tip", "direction point for a secant"),
        { id: "circle", kind: "circle", role: "circle centred at O" },
        { id: "ob", kind: "segment", role: "radius OB" },
        { id: "tangent", kind: "line", role: "tangent at B" },
        { id: "companion", kind: "line", role: "line parallel to the tangent" },
        { id: "contact", kind: "point", role: "intersection of the tangent with the secant" },
        { id: "secant", kind: "line", role: "secant from O" },
      ],
      constructions: [
        pointConstruction("o", 0, 0),
        pointConstruction("b", 2, 0),
        pointConstruction("d", 0, 2),
        pointConstruction("companion_tip", 0, 1),
        pointConstruction("diagonal_tip", 2, 2),
        { id: "make_circle", operator: "circle", inputs: { center: "o", radius: 2 }, outputs: ["circle"] },
        { id: "make_ob", operator: "segment", inputs: { start: "o", end: "b" }, outputs: ["ob"] },
        { id: "make_tangent", operator: "line", inputs: { start: "b", direction: [0, 1] }, outputs: ["tangent"] },
        { id: "make_companion", operator: "line", inputs: { start: "o", end: "companion_tip" }, outputs: ["companion"] },
        { id: "make_secant", operator: "line", inputs: { start: "o", end: "diagonal_tip" }, outputs: ["secant"] },
        { id: "make_contact", operator: "intersection", inputs: { first: "tangent", second: "secant" }, outputs: ["contact"] },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_collinear", "collinear", ["o", "b", "d"], false, "O, B, D form a right triangle, not a line"),
        fatalAssertion("probe_perpendicular", "perpendicular", ["ob", "tangent"], true, "the radius is perpendicular to the tangent"),
        fatalAssertion("probe_parallel", "parallel", ["tangent", "companion"], true, "the companion line is vertical like the tangent"),
      ],
      annotations: [],
    },
  );
}

/** Three collinear points with a perpendicular bisector and a parallel companion. */
function maths10CompositeBisector(): Record<string, unknown> {
  return probeScene(
    "maths|10",
    "A, M, B are collinear, the perpendicular bisector at M meets AB at right angles, and a companion is parallel to AB",
    {
      quantities: [],
      entities: [
        pointEntity("a", "endpoint A"),
        pointEntity("b", "endpoint B"),
        pointEntity("m", "midpoint"),
        pointEntity("companion_start", "companion line start"),
        pointEntity("companion_end", "companion line end"),
        { id: "ab", kind: "segment", role: "segment AB" },
        { id: "am", kind: "segment", role: "half AM" },
        { id: "mb", kind: "segment", role: "half MB" },
        { id: "bisector", kind: "line", role: "perpendicular bisector" },
        { id: "companion", kind: "line", role: "line parallel to AB" },
      ],
      constructions: [
        pointConstruction("a", 0, 0),
        pointConstruction("b", 4, 0),
        { id: "make_m", operator: "midpoint", inputs: { a: "a", b: "b" }, outputs: ["m"] },
        pointConstruction("companion_start", 0, 1),
        pointConstruction("companion_end", 4, 1),
        { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
        { id: "make_am", operator: "segment", inputs: { start: "a", end: "m" }, outputs: ["am"] },
        { id: "make_mb", operator: "segment", inputs: { start: "m", end: "b" }, outputs: ["mb"] },
        { id: "make_bisector", operator: "perpendicular_through", inputs: { through: "m", line: "ab" }, outputs: ["bisector"] },
        { id: "make_companion", operator: "line", inputs: { start: "companion_start", end: "companion_end" }, outputs: ["companion"] },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_collinear", "collinear", ["a", "m", "b"], true, "A, M, B lie on one line"),
        fatalAssertion("probe_perpendicular", "perpendicular", ["ab", "bisector"], true, "the bisector is perpendicular to AB"),
        fatalAssertion("probe_parallel", "parallel", ["ab", "companion"], true, "the companion line is parallel to AB"),
        fatalAssertion("probe_equal_length", "equal_length", ["am", "mb"], true, "M is the midpoint so AM = MB"),
      ],
      annotations: [],
    },
  );
}

function physics14MediumLrc(): Record<string, unknown> {
  return circuitProbeScene(
    "physics|14",
    "An inductor, resistor, and capacitor in series across an AC source",
    {
      nodes: [
        { id: "n0", x: 0, y: 0 },
        { id: "n1", x: 1, y: 0 },
        { id: "n2", x: 2, y: 0 },
        { id: "n3", x: 3, y: 0 },
        { id: "n4", x: 4, y: 1, role: "spare node used by adversarial mutations" },
      ],
      symbols: [
        { id: "inductor", symbol: "inductor", start: "n0", end: "n1", role: "inductor" },
        { id: "resistor", symbol: "resistor", start: "n1", end: "n2", role: "resistor" },
        { id: "capacitor", symbol: "capacitor", start: "n2", end: "n3", role: "capacitor" },
      ],
      assertions: [
        fatalAssertion("probe_path", "path", ["inductor", "resistor", "capacitor"], true, "L, R, and C form one ordered series path"),
        fatalAssertion("probe_degree", "degree", ["n1"], 2, "the first interior node joins exactly two components"),
      ],
    },
  );
}

function physics14CompositeParallelBranch(): Record<string, unknown> {
  return circuitProbeScene(
    "physics|14",
    "An AC source and inductor in series feed a parallel resistor pair",
    {
      nodes: [
        { id: "n0", x: 0, y: 0 },
        { id: "n1", x: 1, y: 0 },
        { id: "n2", x: 2, y: 0 },
        { id: "n3", x: 3, y: 0 },
        { id: "n4", x: 4, y: 1, role: "spare node used by adversarial mutations" },
      ],
      symbols: [
        { id: "source", symbol: "ac_source", start: "n0", end: "n1", role: "AC source" },
        { id: "inductor", symbol: "inductor", start: "n1", end: "n2", role: "inductor" },
        { id: "p1", symbol: "resistor", start: "n2", end: "n3", role: "parallel resistor" },
        { id: "p2", symbol: "resistor", start: "n2", end: "n3", role: "parallel resistor" },
      ],
      assertions: [
        fatalAssertion("probe_path", "path", ["source", "inductor"], true, "the source and inductor form the series part of the loop"),
        fatalAssertion("probe_degree", "degree", ["n2"], 3, "the junction joins the inductor and two parallel branches"),
        fatalAssertion("probe_path_count", "pathCount", ["n2", "n3"], 2, "exactly two simple paths run across the parallel pair"),
        fatalAssertion("probe_same_terminal_pair", "sameTerminalPair", ["p1", "p2"], true, "the parallel resistors share both terminals"),
      ],
    },
  );
}

function physics13MediumComponents(): Record<string, unknown> {
  return probeScene(
    "physics|13",
    "Resolve a current at 45 degrees into components parallel and perpendicular to a magnetic-field axis",
    {
      quantities: [],
      entities: [
        pointEntity("origin", "origin"),
        pointEntity("axis_tip", "field-axis tip"),
        pointEntity("current_tip", "current vector tip"),
        { id: "axis", kind: "segment", role: "magnetic-field axis" },
        { id: "current", kind: "vector", role: "current" },
        { id: "i_parallel", kind: "vector", role: "component of I parallel to B" },
        { id: "i_perp", kind: "vector", role: "component of I perpendicular to B" },
      ],
      constructions: [
        pointConstruction("origin", 0, 0),
        pointConstruction("axis_tip", 2, 0),
        pointConstruction("current_tip", 2, 2),
        { id: "make_axis", operator: "segment", inputs: { start: "origin", end: "axis_tip" }, outputs: ["axis"] },
        { id: "make_current", operator: "vector", inputs: { start: "origin", end: "current_tip" }, outputs: ["current"] },
        {
          id: "make_components",
          operator: "vector_components",
          inputs: { origin: "origin", vector: [2, 2], basis: "axis" },
          outputs: ["i_parallel", "i_perp"],
        },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_perpendicular", "perpendicular", ["i_perp", "axis"], true, "the perpendicular component is orthogonal to the field axis"),
        fatalAssertion("probe_parallel", "parallel", ["i_parallel", "axis"], true, "the parallel component runs along the field axis"),
      ],
      annotations: [],
    },
  );
}

function physics13CompositeLoop(): Record<string, unknown> {
  return probeScene(
    "physics|13",
    "A current loop in a field: the field is perpendicular to a radial spoke, a companion spoke is parallel, and the field is resolved on the axis",
    {
      quantities: [],
      entities: [
        pointEntity("center", "loop centre"),
        pointEntity("rim", "point on the loop"),
        pointEntity("field_tip", "field vector tip"),
        pointEntity("spoke_tip", "parallel spoke tip"),
        { id: "loop", kind: "circle", role: "current loop" },
        { id: "field", kind: "vector", role: "magnetic field at the centre" },
        { id: "spoke", kind: "vector", role: "radial spoke" },
        { id: "spoke_parallel", kind: "vector", role: "spoke parallel to the first" },
        { id: "field_x", kind: "vector", role: "field component along the spoke" },
        { id: "field_y", kind: "vector", role: "field component perpendicular to the spoke" },
      ],
      constructions: [
        pointConstruction("center", 0, 0),
        pointConstruction("rim", 1, 0),
        pointConstruction("field_tip", 0, 1.5),
        pointConstruction("spoke_tip", 2, 0),
        { id: "make_loop", operator: "circle", inputs: { center: "center", radius: 1 }, outputs: ["loop"] },
        { id: "make_field", operator: "vector", inputs: { start: "center", end: "field_tip" }, outputs: ["field"] },
        { id: "make_spoke", operator: "vector", inputs: { start: "center", end: "rim" }, outputs: ["spoke"] },
        { id: "make_spoke_parallel", operator: "vector", inputs: { start: "rim", end: "spoke_tip" }, outputs: ["spoke_parallel"] },
        {
          id: "make_field_components",
          operator: "vector_components",
          inputs: { origin: "center", vector: [0.5, 1], basis: "spoke" },
          outputs: ["field_x", "field_y"],
        },
      ],
      relations: [],
      assertions: [
        fatalAssertion("probe_perpendicular", "perpendicular", ["field", "spoke"], true, "the field at the centre is perpendicular to the radial spoke"),
        fatalAssertion("probe_parallel", "parallel", ["spoke", "spoke_parallel"], true, "both spokes point radially outward"),
      ],
      annotations: [],
    },
  );
}

function maths8MediumTwoCurves(): Record<string, unknown> {
  return cartesianProbeScene(
    "maths|8",
    "Find the area between y=x^2 and y=x+2",
    {
      curveId: "lower",
      expression: "x^2",
      xMin: -0.5,
      xMax: 2.5,
      assertions: [
        fatalAssertion("probe_function_value", "function_value", ["lower"], { x: 1, y: 1 }, "y=x^2 passes through (1,1)"),
      ],
      extraAssertions: [
        fatalAssertion("probe_function_value_upper", "function_value", ["upper"], { x: 1, y: 3 }, "y=x+2 passes through (1,3)"),
      ],
      extraEntities: [
        { id: "upper", kind: "curve", role: "upper curve y=x+2" },
        { id: "region", kind: "function_region", role: "region between the curves" },
      ],
      extraConstructions: [
        { id: "make_upper", operator: "function_curve", inputs: { expression: "x+2", variable: "x", xMin: -0.5, xMax: 2.5, samples: 65 }, outputs: ["upper"] },
        { id: "make_region", operator: "function_region", inputs: { upper: "upper", lower: "lower", xMin: 0, xMax: 2, samples: 65 }, outputs: ["region"] },
      ],
    },
  );
}

function maths8CompositeRoot(): Record<string, unknown> {
  return cartesianProbeScene(
    "maths|8",
    "Sketch y=x^2-4, mark two points on the curve, and show the positive root",
    {
      curveId: "curve",
      expression: "x^2 - 4",
      xMin: -3,
      xMax: 3,
      assertions: [
        fatalAssertion("probe_function_value", "function_value", ["curve"], { x: 0, y: -4 }, "the parabola meets the y-axis at (0,-4)"),
      ],
      extraAssertions: [
        fatalAssertion("probe_function_value_second", "function_value", ["curve"], { x: 3, y: 5 }, "the parabola passes through (3,5)"),
        fatalAssertion("probe_root", "root", ["curve"], { x: 2 }, "x=2 is a root of x^2-4"),
      ],
      extraEntities: [
        { id: "ceiling", kind: "curve", role: "x-axis y=0" },
        { id: "region", kind: "function_region", role: "region between the curve and the x-axis" },
      ],
      extraConstructions: [
        { id: "make_ceiling", operator: "function_curve", inputs: { expression: "0", variable: "x", xMin: -3, xMax: 3, samples: 65 }, outputs: ["ceiling"] },
        { id: "make_region", operator: "function_region", inputs: { upper: "ceiling", lower: "curve", xMin: -2, xMax: 2, samples: 65 }, outputs: ["region"] },
      ],
    },
  );
}

function physics12MediumParallel(): Record<string, unknown> {
  return circuitProbeScene(
    "physics|12",
    "Three resistors in parallel share both terminals; a two-resistor series chain feeds the bank",
    {
      nodes: [
        { id: "n0", x: 0, y: 0 },
        { id: "n1", x: 1, y: 0 },
        { id: "a", x: 2, y: 0, role: "parallel terminal" },
        { id: "b", x: 4, y: 0, role: "parallel terminal" },
        { id: "n3", x: 5, y: 1, role: "spare node used by adversarial mutations" },
      ],
      symbols: [
        { id: "s1", symbol: "resistor", start: "n0", end: "n1", role: "series resistor" },
        { id: "s2", symbol: "resistor", start: "n1", end: "a", role: "series resistor" },
        { id: "p1", symbol: "resistor", start: "a", end: "b", role: "parallel branch" },
        { id: "p2", symbol: "resistor", start: "a", end: "b", role: "parallel branch" },
        { id: "p3", symbol: "resistor", start: "a", end: "b", role: "parallel branch" },
      ],
      assertions: [
        fatalAssertion("probe_path", "path", ["s1", "s2"], true, "the two series resistors form one ordered path"),
        fatalAssertion("probe_same_terminal_pair", "sameTerminalPair", ["p1", "p2", "p3"], true, "the three parallel branches share both terminals"),
        fatalAssertion("probe_degree", "degree", ["a"], 4, "the shared terminal joins the series feed and three branches"),
        fatalAssertion("probe_path_count", "pathCount", ["a", "b"], 3, "exactly three simple paths run between the parallel terminals"),
      ],
    },
  );
}

function physics12CompositeSeriesParallel(): Record<string, unknown> {
  return circuitProbeScene(
    "physics|12",
    "A series resistor feeds a parallel pair, then another series resistor continues the loop",
    {
      nodes: [
        { id: "n0", x: 0, y: 0 },
        { id: "n1", x: 1, y: 0 },
        { id: "n2", x: 2, y: 0 },
        { id: "n3", x: 3, y: 0 },
        { id: "n4", x: 4, y: 1, role: "spare node used by adversarial mutations" },
      ],
      symbols: [
        { id: "s1", symbol: "resistor", start: "n0", end: "n1", role: "series resistor" },
        { id: "p1", symbol: "resistor", start: "n1", end: "n2", role: "parallel branch" },
        { id: "p2", symbol: "resistor", start: "n1", end: "n2", role: "parallel branch" },
        { id: "s2", symbol: "resistor", start: "n2", end: "n3", role: "series resistor" },
      ],
      assertions: [
        fatalAssertion("probe_path", "path", ["s1", "p1", "s2"], true, "one ordered path runs through a single parallel branch"),
        fatalAssertion("probe_same_terminal_pair", "sameTerminalPair", ["p1", "p2"], true, "the parallel branches share both terminals"),
        fatalAssertion("probe_degree", "degree", ["n1"], 3, "the junction joins the series feed and two parallel branches"),
        fatalAssertion("probe_path_count", "pathCount", ["n1", "n2"], 2, "exactly two simple paths run across the parallel pair"),
      ],
    },
  );
}

// One representative, minimal, real `easy` scene per diagram-led unit. Each probe
// uses every demanded operator and asserts every demanded predicate with expected
// values chosen so the proof holds exactly on the compiled geometry.
const PROBE_SCENE_EASY: Record<string, Record<string, unknown>> = {
  // --- Mathematics ---
  "maths|7": cartesianProbeScene(
    "maths|7",
    "Sketch y=x^2 and draw the tangent at x=1",
    {
      curveId: "curve",
      expression: "x^2",
      xMin: -2,
      xMax: 2,
      assertions: [{
        id: "probe_function_value",
        predicate: "function_value",
        entities: ["curve"],
        expected: { x: 1, y: 1 },
        severity: "fatal",
        reason: "y=x^2 passes through (1,1)",
      }],
      extraEntities: [{ id: "tangent", kind: "line", role: "tangent line at x=1" }],
      extraConstructions: [{
        id: "make_tangent",
        operator: "tangent_line",
        inputs: { curve: "curve", at: 1 },
        outputs: ["tangent"],
      }],
    },
  ),
  "maths|8": cartesianProbeScene(
    "maths|8",
    "Find the area bounded by y=x^2 and the line y=4",
    {
      curveId: "curve",
      expression: "x^2",
      xMin: -2.5,
      xMax: 2.5,
      assertions: [{
        id: "probe_function_value",
        predicate: "function_value",
        entities: ["curve"],
        expected: { x: 2, y: 4 },
        severity: "fatal",
        reason: "the parabola meets the line y=4 at (2,4)",
      }],
      // SECOND function_value point so a point-mutation can target only one of
      // them (adversarial tier needs a break that keeps the geometry sane).
      extraAssertions: [{
        id: "probe_function_value_second",
        predicate: "function_value",
        entities: ["curve"],
        expected: { x: 1, y: 1 },
        severity: "fatal",
        reason: "the parabola passes through (1,1)",
      }],
      extraEntities: [
        { id: "ceiling", kind: "curve", role: "upper boundary y=4" },
        { id: "region", kind: "function_region", role: "region under y=4 above y=x^2" },
      ],
      extraConstructions: [
        { id: "make_ceiling", operator: "function_curve", inputs: { expression: "4", variable: "x", xMin: -2.5, xMax: 2.5, samples: 65 }, outputs: ["ceiling"] },
        { id: "make_region", operator: "function_region", inputs: { upper: "ceiling", lower: "curve", xMin: -2, xMax: 2, samples: 65 }, outputs: ["region"] },
      ],
    },
  ),
  "maths|9": cartesianProbeScene(
    "maths|9",
    "Sketch the solution curve y=x^2",
    {
      curveId: "curve",
      expression: "x^2",
      xMin: -2,
      xMax: 2,
      assertions: [{
        id: "probe_function_value",
        predicate: "function_value",
        entities: ["curve"],
        expected: { x: 2, y: 4 },
        severity: "fatal",
        reason: "y=x^2 passes through (2,4)",
      }],
    },
  ),
  "maths|10": probeScene(
    "maths|10",
    "Show that A, B, C are collinear, that AB is perpendicular to BC, and that the tangent to the circle x^2+y^2=4 at (2,0) is parallel to BC",
    {
      quantities: [],
      entities: [
        pointEntity("a", "vertex"),
        pointEntity("b", "vertex"),
        pointEntity("c", "vertex"),
        pointEntity("secant_tip", "direction point for the secant"),
        pointEntity("center", "circle centre (coincides with A)"),
        { id: "ab", kind: "segment", role: "leg AB" },
        { id: "circle", kind: "circle", role: "circle centred at A through B" },
        { id: "bc_line", kind: "line", role: "line BC" },
        { id: "tangent", kind: "line", role: "tangent to the circle at B" },
        { id: "secant", kind: "line", role: "horizontal secant through A" },
        { id: "contact", kind: "point", role: "intersection of the tangent with the secant" },
      ],
      constructions: [
        pointConstruction("a", 0, 0),
        pointConstruction("b", 2, 0),
        pointConstruction("c", 2, 2),
        pointConstruction("secant_tip", 1, 0),
        pointConstruction("center", 0, 0),
        { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
        { id: "make_circle", operator: "circle", inputs: { center: "center", radius: 2 }, outputs: ["circle"] },
        { id: "make_bc_line", operator: "line", inputs: { start: "b", end: "c" }, outputs: ["bc_line"] },
        { id: "make_tangent", operator: "line", inputs: { start: "b", direction: [0, 1] }, outputs: ["tangent"] },
        { id: "make_secant", operator: "line", inputs: { start: "a", end: "secant_tip" }, outputs: ["secant"] },
        { id: "make_contact", operator: "intersection", inputs: { first: "tangent", second: "secant" }, outputs: ["contact"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_collinear", predicate: "collinear", entities: ["a", "b", "c"], expected: false, severity: "fatal", reason: "A, B, C form a right triangle, not a line" },
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["ab", "bc_line"], expected: true, severity: "fatal", reason: "AB is horizontal and BC is vertical" },
        { id: "probe_parallel", predicate: "parallel", entities: ["tangent", "bc_line"], expected: true, severity: "fatal", reason: "the tangent at (2,0) is vertical like BC" },
      ],
      annotations: [],
    },
  ),
  "maths|11": vectorProbeScene(
    "maths|11",
    "Show the vectors (1,0,0) and (0,1,0) are perpendicular",
    {
      vectors: [
        { id: "u", role: "direction vector", start: [0, 0], end: [2, 0] },
        { id: "v", role: "direction vector", start: [0, 0], end: [0, 2] },
      ],
      assertions: [
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["u", "v"], expected: true, severity: "fatal", reason: "u and v are perpendicular" },
        { id: "probe_parallel", predicate: "parallel", entities: ["u", "u"], expected: true, severity: "fatal", reason: "a vector is parallel to itself" },
      ],
    },
  ),
  "maths|12": probeScene(
    "maths|12",
    "Resolve the vector (1,2) into components and show (1,2) is perpendicular to (2,-1)",
    {
      quantities: [],
      entities: [
        pointEntity("origin", "common tail"),
        pointEntity("v_tip", "tip of v"),
        pointEntity("w_tip", "tip of w"),
        pointEntity("basis_tip", "tip of the horizontal basis"),
        { id: "v", kind: "vector", role: "given vector" },
        { id: "w", kind: "vector", role: "perpendicular vector" },
        { id: "basis", kind: "segment", role: "horizontal basis direction" },
        { id: "vx", kind: "vector", role: "component of v along the basis" },
        { id: "vy", kind: "vector", role: "component of v perpendicular to the basis" },
      ],
      constructions: [
        pointConstruction("origin", 0, 0),
        pointConstruction("v_tip", 1, 2),
        pointConstruction("w_tip", 2, -1),
        pointConstruction("basis_tip", 1, 0),
        { id: "make_v", operator: "vector", inputs: { start: "origin", end: "v_tip" }, outputs: ["v"] },
        { id: "make_w", operator: "vector", inputs: { start: "origin", end: "w_tip" }, outputs: ["w"] },
        { id: "make_basis", operator: "segment", inputs: { start: "origin", end: "basis_tip" }, outputs: ["basis"] },
        { id: "make_components", operator: "vector_components", inputs: { origin: "origin", vector: [1, 2], basis: "basis" }, outputs: ["vx", "vy"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["v", "w"], expected: true, severity: "fatal", reason: "(1,2) dot (2,-1) = 0" },
        { id: "probe_parallel", predicate: "parallel", entities: ["v", "v"], expected: true, severity: "fatal", reason: "a vector is parallel to itself" },
        { id: "probe_equal_length", predicate: "equal_length", entities: ["v", "w"], expected: true, severity: "fatal", reason: "both vectors have magnitude sqrt(5)" },
      ],
      annotations: [],
    },
  ),
  "maths|14": probeScene(
    "maths|14",
    "In the right triangle mark the 45 degree angle at A and the right angle at B",
    {
      quantities: [],
      entities: [
        pointEntity("a", "vertex A"),
        pointEntity("b", "vertex B"),
        pointEntity("c", "vertex C"),
        { id: "ab", kind: "segment", role: "leg AB" },
        { id: "ac", kind: "segment", role: "leg AC" },
        { id: "bc", kind: "segment", role: "leg BC" },
        { id: "angle_a", kind: "angle_mark", role: "angle at A" },
        { id: "right_b", kind: "right_angle_mark", role: "right angle at B" },
      ],
      constructions: [
        pointConstruction("a", 0, 0),
        pointConstruction("b", 1, 0),
        pointConstruction("c", 0, 1),
        { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
        { id: "make_ac", operator: "segment", inputs: { start: "a", end: "c" }, outputs: ["ac"] },
        { id: "make_bc", operator: "segment", inputs: { start: "b", end: "c" }, outputs: ["bc"] },
        { id: "make_angle_a", operator: "angle_mark", inputs: { vertex: "a", a: "ab", b: "ac" }, outputs: ["angle_a"] },
        { id: "make_right_b", operator: "right_angle_mark", inputs: { vertex: "b", a: "a", b: "c" }, outputs: ["right_b"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_equal_angle", predicate: "equal_angle", entities: ["angle_a", "angle_a"], expected: true, severity: "fatal", reason: "a marked angle equals itself" },
        { id: "probe_angle_between", predicate: "angle_between", entities: ["ab", "ac"], expected: { value: 90, unit: "degree" }, severity: "fatal", reason: "AB and AC are perpendicular" },
      ],
      annotations: [],
    },
  ),

  // --- Physics ---
  "physics|2": probeScene(
    "physics|2",
    "A projectile's height follows y=x-x^2/2 (range 2) while the timed trajectory overlay flies to range 3; draw both with the launch velocity vector",
    {
      quantities: [],
      entities: [
        { id: "axes", kind: "axes", role: "coordinate axes" },
        { id: "height", kind: "curve", role: "height as a function of x" },
        { id: "path", kind: "curve", role: "timed trajectory overlay" },
        pointEntity("launch", "launch point"),
        pointEntity("velocity_tip", "velocity vector tip"),
        { id: "v0", kind: "vector", role: "initial velocity" },
      ],
      constructions: [
        { id: "make_axes", operator: "axes", inputs: { xMin: -0.5, xMax: 2.5, yMin: -0.5, yMax: 1.5 }, outputs: ["axes"] },
        {
          id: "make_height",
          operator: "function_curve",
          inputs: { expression: "x - 0.5*x^2", xMin: 0, xMax: 2, samples: 65 },
          outputs: ["height"],
        },
        {
          id: "make_path",
          operator: "parametric_curve",
          inputs: { xExpression: "t", yExpression: "t - t^2/6", tMin: 0, tMax: 3, samples: 65 },
          outputs: ["path"],
        },
        pointConstruction("launch", 0, 0),
        pointConstruction("velocity_tip", 0.5, 0.5),
        { id: "make_v0", operator: "vector", inputs: { start: "launch", end: "velocity_tip" }, outputs: ["v0"] },
      ],
      relations: [],
      assertions: [{
        id: "probe_function_value",
        predicate: "function_value",
        entities: ["height"],
        expected: { x: 1, y: 0.5 },
        severity: "fatal",
        reason: "the height curve passes through (1, 0.5)",
      }],
      annotations: [],
    },
  ),
  "physics|3": probeScene(
    "physics|3",
    "Draw the free-body diagram of a block resting on a horizontal surface",
    {
      quantities: [],
      entities: [
        pointEntity("body", "block center"),
        pointEntity("ground_start", "surface start"),
        pointEntity("ground_end", "surface end"),
        pointEntity("weight_tip", "weight vector tip"),
        pointEntity("normal_tip", "normal vector tip"),
        { id: "block", kind: "polygon", role: "block" },
        { id: "surface", kind: "segment", role: "horizontal surface" },
        { id: "contact", kind: "point", role: "surface contact point" },
        { id: "contact_path", kind: "vector", role: "contact direction" },
        { id: "weight", kind: "vector", role: "weight (gravity)" },
        { id: "normal", kind: "vector", role: "normal force" },
      ],
      constructions: [
        pointConstruction("body", 0, 1),
        pointConstruction("ground_start", -2, 0.6),
        pointConstruction("ground_end", 2, 0.6),
        pointConstruction("weight_tip", 0, 0),
        pointConstruction("normal_tip", 0, 2),
        { id: "make_block", operator: "rectangle", inputs: { center: "body", width: 0.6, height: 0.6 }, outputs: ["block"] },
        { id: "make_surface", operator: "segment", inputs: { start: "ground_start", end: "ground_end" }, outputs: ["surface"] },
        { id: "make_contact", operator: "surface_contact", inputs: { origin: "body", through: "weight_tip", surface: "surface" }, outputs: ["contact", "contact_path"] },
        { id: "make_weight", operator: "vector", inputs: { start: "body", end: "weight_tip" }, outputs: ["weight"] },
        { id: "make_normal", operator: "vector", inputs: { start: "body", end: "normal_tip" }, outputs: ["normal"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["normal", "surface"], expected: true, severity: "fatal", reason: "the normal force is perpendicular to the surface" },
        { id: "probe_opposite_direction", predicate: "opposite_direction", entities: ["weight", "normal"], expected: true, severity: "fatal", reason: "weight and normal force are opposite" },
        { id: "probe_connected", predicate: "connected", entities: ["block", "contact"], expected: true, severity: "fatal", reason: "the contact point lies on the block" },
      ],
      annotations: [],
    },
  ),
  "physics|4": vectorProbeScene(
    "physics|4",
    "A force (2,1) acts through a displacement (2,0); resolve the force along the displacement",
    {
      vectors: [
        { id: "force", role: "applied force", start: [0, 0], end: [2, 1] },
        { id: "displacement", role: "displacement", start: [0, 0], end: [2, 0] },
      ],
      assertions: [
        { id: "probe_parallel", predicate: "parallel", entities: ["displacement", "force_x"], expected: true, severity: "fatal", reason: "the parallel component of F runs along the displacement" },
        { id: "probe_angle_between", predicate: "angle_between", entities: ["force", "displacement"], expected: { value: 26.565, unit: "degree" }, tolerance: 1e-3, severity: "fatal", reason: "F makes 26.565 degrees with the displacement" },
      ],
      extraEntities: [
        { id: "force_x", kind: "vector", role: "component of F parallel to displacement" },
        { id: "force_y", kind: "vector", role: "component of F perpendicular to displacement" },
      ],
      extraConstructions: [{
        id: "make_force_components",
        operator: "vector_components",
        inputs: { origin: "p0", vector: [2, 1], basis: "displacement" },
        outputs: ["force_x", "force_y"],
      }],
    },
  ),
  "physics|5": probeScene(
    "physics|5",
    "A tangential force acts at the rim of a spinning disk; the torque arm is perpendicular to the force",
    {
      quantities: [],
      entities: [
        pointEntity("hub", "rotation axis"),
        pointEntity("force_tip", "force vector tip"),
        { id: "disk", kind: "circle", role: "rotating disk" },
        { id: "radius_arm", kind: "vector", role: "radius to the point of application" },
        { id: "force", kind: "vector", role: "tangential force" },
      ],
      constructions: [
        pointConstruction("hub", 0, 0),
        pointConstruction("force_tip", 1, 1),
        { id: "make_disk", operator: "circle", inputs: { center: "hub", radius: 1 }, outputs: ["disk"] },
        { id: "make_radius_arm", operator: "vector", inputs: { start: "hub", end: [1, 0] }, outputs: ["radius_arm"] },
        { id: "make_force", operator: "vector", inputs: { start: [1, 0], end: "force_tip" }, outputs: ["force"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["radius_arm", "force"], expected: true, severity: "fatal", reason: "a tangential force is perpendicular to the radius" },
        { id: "probe_angle_between", predicate: "angle_between", entities: ["radius_arm", "force"], expected: { value: 90, unit: "degree" }, severity: "fatal", reason: "the torque angle is 90 degrees" },
      ],
      annotations: [],
    },
  ),
  "physics|11": vectorProbeScene(
    "physics|11",
    "Two charges feel equal and opposite Coulomb forces along the line joining them",
    {
      vectors: [
        { id: "force_on_a", role: "force on charge A", start: [-1, 0], end: [-2, 0] },
        { id: "force_on_b", role: "force on charge B", start: [1, 0], end: [2, 0] },
      ],
      assertions: [
        { id: "probe_opposite_direction", predicate: "opposite_direction", entities: ["force_on_a", "force_on_b"], expected: true, severity: "fatal", reason: "Newton's third law: the forces are opposite" },
        { id: "probe_equal_length", predicate: "equal_length", entities: ["force_on_a", "force_on_b"], expected: true, severity: "fatal", reason: "the forces have equal magnitude" },
        { id: "probe_parallel", predicate: "parallel", entities: ["force_on_a", "force_on_b"], expected: true, severity: "fatal", reason: "both forces lie on the line joining the charges" },
      ],
    },
  ),
  "physics|12": probeScene(
    "physics|12",
    "Two resistors in series; then two resistors in parallel share the same terminal pair",
    {
      quantities: [],
      entities: [
        pointEntity("n0", "node"),
        pointEntity("n1", "node"),
        pointEntity("n2", "node"),
        pointEntity("n3", "spare node used by adversarial mutations"),
        pointEntity("a", "parallel terminal"),
        pointEntity("b", "parallel terminal"),
        { id: "s1", kind: "component", role: "resistor (series)" },
        { id: "s2", kind: "component", role: "resistor (series)" },
        { id: "p1", kind: "component", role: "resistor (parallel branch)" },
        { id: "p2", kind: "component", role: "resistor (parallel branch)" },
        { id: "lead", kind: "connector", role: "wire between series chain and parallel bank" },
      ],
      constructions: [
        pointConstruction("n0", 0, 0),
        pointConstruction("n1", 1, 0),
        pointConstruction("n2", 2, 0),
        pointConstruction("n3", 3, 1),
        pointConstruction("a", 3, 0),
        pointConstruction("b", 5, 0),
        { id: "make_s1", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1" }, outputs: ["s1"] },
        { id: "make_s2", operator: "symbol", inputs: { symbol: "resistor", start: "n1", end: "n2" }, outputs: ["s2"] },
        { id: "make_p1", operator: "symbol", inputs: { symbol: "resistor", start: "a", end: "b" }, outputs: ["p1"] },
        { id: "make_p2", operator: "symbol", inputs: { symbol: "resistor", start: "a", end: "b" }, outputs: ["p2"] },
        { id: "make_lead", operator: "connect", inputs: { start: "n2", end: "a" }, outputs: ["lead"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_path", predicate: "path", entities: ["s1", "s2"], expected: true, severity: "fatal", reason: "the two series resistors form one ordered path" },
        { id: "probe_same_terminal_pair", predicate: "sameTerminalPair", entities: ["p1", "p2"], expected: true, severity: "fatal", reason: "the parallel branches share both terminals" },
        { id: "probe_degree", predicate: "degree", entities: ["a"], expected: 3, severity: "fatal", reason: "the shared terminal joins two branches and the series lead" },
      ],
      annotations: [],
    },
  ),
  "physics|13": probeScene(
    "physics|13",
    "A current loop sits in a magnetic field; the field at the centre is perpendicular to a radial spoke",
    {
      quantities: [],
      entities: [
        pointEntity("center", "loop centre"),
        pointEntity("rim", "point on the loop"),
        pointEntity("field_tip", "field vector tip"),
        pointEntity("spoke_tip", "parallel spoke tip"),
        { id: "loop", kind: "circle", role: "current loop" },
        { id: "field", kind: "vector", role: "magnetic field at the centre" },
        { id: "spoke", kind: "vector", role: "radial spoke" },
        { id: "spoke_parallel", kind: "vector", role: "spoke parallel to the first" },
      ],
      constructions: [
        pointConstruction("center", 0, 0),
        pointConstruction("rim", 1, 0),
        pointConstruction("field_tip", 0, 1.5),
        pointConstruction("spoke_tip", 2, 0),
        { id: "make_loop", operator: "circle", inputs: { center: "center", radius: 1 }, outputs: ["loop"] },
        { id: "make_field", operator: "vector", inputs: { start: "center", end: "field_tip" }, outputs: ["field"] },
        { id: "make_spoke", operator: "vector", inputs: { start: "center", end: "rim" }, outputs: ["spoke"] },
        { id: "make_spoke_parallel", operator: "vector", inputs: { start: "rim", end: "spoke_tip" }, outputs: ["spoke_parallel"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_perpendicular", predicate: "perpendicular", entities: ["field", "spoke"], expected: true, severity: "fatal", reason: "the field at the centre is perpendicular to the radial spoke" },
        { id: "probe_parallel", predicate: "parallel", entities: ["spoke", "spoke_parallel"], expected: true, severity: "fatal", reason: "both spokes point radially outward" },
      ],
      annotations: [],
    },
  ),
  "physics|14": probeScene(
    "physics|14",
    "An inductor and a resistor in series across an AC source",
    {
      quantities: [],
      entities: [
        pointEntity("n0", "node"),
        pointEntity("n1", "node"),
        pointEntity("n2", "node"),
        { id: "inductor", kind: "component", role: "inductor coil" },
        { id: "resistor", kind: "component", role: "resistor" },
      ],
      constructions: [
        pointConstruction("n0", 0, 0),
        pointConstruction("n1", 1, 0),
        pointConstruction("n2", 2, 0),
        { id: "make_inductor", operator: "symbol", inputs: { symbol: "inductor", start: "n0", end: "n1" }, outputs: ["inductor"] },
        { id: "make_resistor", operator: "symbol", inputs: { symbol: "resistor", start: "n1", end: "n2" }, outputs: ["resistor"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_path", predicate: "path", entities: ["inductor", "resistor"], expected: true, severity: "fatal", reason: "the inductor and resistor form one ordered series path" },
        { id: "probe_degree", predicate: "degree", entities: ["n1"], expected: 2, severity: "fatal", reason: "the middle node joins exactly the two components" },
      ],
      annotations: [],
    },
  ),
  "physics|10": probeScene(
    "physics|10",
    "Plane wavefronts spaced half a metre apart travel through a ripple tank while a string fixed at both ends carries a transverse wave completing 3 cycles",
    {
      quantities: [
        { id: "front_count", value: 4, unit: "count" },
        { id: "front_spacing", value: 0.5, unit: "m" },
        { id: "front_span", value: 2, unit: "m" },
        { id: "wave_amplitude", value: 0.3, unit: "m" },
        { id: "wave_cycles", value: 3, unit: "count" },
      ],
      entities: [
        pointEntity("wave_origin", "source point"),
        pointEntity("string_start", "fixed end of the string"),
        pointEntity("string_end", "fixed end of the string"),
        { id: "fronts", kind: "polyline", role: "plane wavefronts" },
        { id: "string_wave", kind: "polyline", role: "transverse wave on the string" },
        { id: "frame", kind: "axes", role: "reference axes" },
        { id: "wave_label", kind: "label", role: "wave label", label: "3 cycles" },
      ],
      constructions: [
        pointConstruction("wave_origin", 0, 0),
        pointConstruction("string_start", 0, 1.5),
        pointConstruction("string_end", 3, 1.5),
        { id: "make_fronts", operator: "wavefront_family", inputs: { origin: "wave_origin", direction: [1, 0], shape: "plane", count: "front_count", spacing: "front_spacing", span: "front_span" }, outputs: ["fronts"] },
        { id: "make_string_wave", operator: "transverse_field", inputs: { start: "string_start", end: "string_end", amplitude: "wave_amplitude", cycles: "wave_cycles", orientationDeg: 90 }, outputs: ["string_wave"] },
        { id: "make_frame", operator: "axes", inputs: { xMin: -0.5, xMax: 3.5, yMin: -1.5, yMax: 2.5 }, outputs: ["frame"] },
        { id: "make_wave_label", operator: "label", inputs: { text: "3 cycles", target: "string_wave" }, outputs: ["wave_label"] },
      ],
      relations: [],
      assertions: [
        { id: "probe_equal_spacing", predicate: "equal_spacing", entities: ["fronts"], expected: true, tolerance: 1e-3, severity: "fatal", reason: "plane wavefronts are evenly spaced by half a metre" },
        { id: "probe_wave_cycles", predicate: "wave_cycles", entities: ["string_wave"], expected: { cycles: 3 }, tolerance: 0.25, severity: "fatal", reason: "the string wave completes exactly 3 cycles between its fixed ends" },
      ],
      annotations: [],
    },
  ),
  "physics|16": probeScene(
    "physics|16",
    "A ray in air hits a horizontal air-glass interface at 45 degrees; it refracts into the glass (n=1.5) and partially reflects",
    {
      quantities: [],
      entities: [
        pointEntity("surface_start", "interface start"),
        pointEntity("surface_end", "interface end"),
        { id: "interface", kind: "segment", role: "air-glass interface" },
        { id: "hit", kind: "point", role: "point of incidence" },
        { id: "incident_ray", kind: "ray", role: "incident ray" },
        { id: "normal", kind: "vector", role: "normal at the point of incidence" },
        { id: "refracted", kind: "ray", role: "refracted ray" },
        { id: "reflected", kind: "ray", role: "reflected ray" },
      ],
      constructions: [
        pointConstruction("surface_start", -2, 0),
        pointConstruction("surface_end", 2, 0),
        { id: "make_interface", operator: "segment", inputs: { start: "surface_start", end: "surface_end" }, outputs: ["interface"] },
        { id: "make_hit", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["hit"] },
        {
          id: "make_refraction",
          operator: "refract_at",
          inputs: { point: "hit", surface: "interface", incidentAngleDeg: 45, n1: 1, n2: 1.5 },
          outputs: ["incident_ray", "normal", "refracted"],
        },
        {
          id: "make_reflection",
          operator: "reflect_direction",
          inputs: { origin: "hit", incoming: "incident_ray", normal: "normal" },
          outputs: ["reflected"],
        },
      ],
      relations: [],
      assertions: [
        { id: "probe_snells_law", predicate: "snells_law", entities: ["incident_ray", "normal", "refracted"], expected: { n1: 1, n2: 1.5 }, tolerance: 1e-3, severity: "fatal", reason: "n1 sin(i) = n2 sin(r) at the interface" },
        { id: "probe_equal_angle", predicate: "equal_angle", entities: ["incident_ray", "normal", "reflected", "normal"], expected: true, tolerance: 1e-3, severity: "fatal", reason: "the angle of incidence equals the angle of reflection" },
        { id: "probe_angle_between", predicate: "angle_between", entities: ["incident_ray", "normal"], expected: { value: 45, unit: "degree" }, tolerance: 1e-3, severity: "fatal", reason: "the incident ray meets the normal at 45 degrees" },
      ],
      annotations: [],
    },
  ),
};

const PROBE_SCENE_DEPTH: Record<string, Partial<Record<ProbeLevel, Record<string, unknown>>>> = {
  "physics|16": { medium: physics16MediumSlab(), composite: physics16CompositeAxis() },
  "physics|11": { medium: physics11MediumCharges(), composite: physics11CompositeForces() },
  "maths|10": { medium: maths10MediumCircle(), composite: maths10CompositeBisector() },
  "physics|14": { medium: physics14MediumLrc(), composite: physics14CompositeParallelBranch() },
  "physics|13": { medium: physics13MediumComponents(), composite: physics13CompositeLoop() },
  "maths|8": { medium: maths8MediumTwoCurves(), composite: maths8CompositeRoot() },
  "physics|12": { medium: physics12MediumParallel(), composite: physics12CompositeSeriesParallel() },
};

const PROBE_SCENE: Record<string, ProbeLevels> = Object.fromEntries(
  Object.entries(PROBE_SCENE_EASY).map(([unit, easy]) => [
    unit,
    { easy, ...PROBE_SCENE_DEPTH[unit] },
  ]),
) as Record<string, ProbeLevels>;

type CompileProbeOutcome = "probe_passed" | "probe_failed" | "probe_not_implemented";

interface CompileProbeResult {
  outcome: CompileProbeOutcome;
  fatalIssues: string[];
}

/** Run one unit's probe scene through validation + compilation. */
function runCompileProbe(unit: string, candidate: Record<string, unknown>): CompileProbeResult {
  const uncovered = probeAssertionCoverage(unit, candidate);
  if (uncovered.length > 0) {
    return { outcome: "probe_failed", fatalIssues: [`probe omits demanded predicates: ${uncovered.join(", ")}`] };
  }
  const validation = validateSceneDocument(candidate);
  if (!validation.document) {
    return {
      outcome: "probe_failed",
      fatalIssues: validation.report.issues
        .filter((issue) => issue.severity === "fatal")
        .map((issue) => `${issue.code}: ${issue.message}`),
    };
  }
  const compiled = compileSceneDocument(validation.document);
  const fatalIssues = compiled.report.issues
    .filter((issue) => issue.severity === "fatal")
    .map((issue) => `${issue.code}: ${issue.message}`);
  if (!compiled.ok) return { outcome: "probe_failed", fatalIssues };
  if (!compiled.renderScene || compiled.renderScene.primitives.length === 0) {
    return { outcome: "probe_failed", fatalIssues: ["compiled scene produced zero render primitives"] };
  }
  const assertionFatalities = compiled.report.issues.filter(
    (issue) => issue.severity === "fatal" && ASSERTION_ISSUE_CODES.has(issue.code),
  );
  if (assertionFatalities.length > 0) {
    return {
      outcome: "probe_failed",
      fatalIssues: assertionFatalities.map((issue) => `${issue.code}: ${issue.message}`),
    };
  }
  return { outcome: "probe_passed", fatalIssues: [] };
}

// ---------------------------------------------------------------------------
// Tier A++ adversarial mutations.
//
// Tier A+ proves each demanded predicate PASSES on a correct scene. Tier A++
// proves each demanded predicate GUARDS the geometry: take the passing probe,
// mutate one geometric quantity so the asserted relation no longer holds, and
// require validate + compile to reject it with a fatal `assertion_failed` (or
// `unsupported_assertion`) issue. A mutation that still compiles green means
// the predicate is not guarding — a real capability gap surfaced in the
// `adversarial` section. Mutations are authored per predicate family, not per
// question, and are reusable geometry breaks.
// ---------------------------------------------------------------------------

/** Geometry-breaking mutation applied to a structuredClone of the probe. */
interface AdversarialMutation {
  /** Short human-readable description of what was broken. */
  description: string;
  /** The predicate family this mutation is meant to exercise. */
  predicate: string;
  apply(candidate: Record<string, unknown>): void;
}

/** Reusable geometry breaks keyed by demanded predicate. */
function functionValueOffCurve(): AdversarialMutation {
  return {
    description: "moved asserted point off the curve (+0.5 y)",
    predicate: "function_value",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "function_value",
      );
      if (assertion && typeof assertion.expected === "object" && assertion.expected !== null) {
        (assertion.expected as Record<string, unknown>).y =
          (assertion.expected as Record<string, unknown>).y as number + 0.5;
      }
    },
  };
}

function angleBetweenChanged(): AdversarialMutation {
  return {
    description: "shifted asserted angle by +20 degrees",
    predicate: "angle_between",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "angle_between",
      );
      if (assertion && typeof assertion.expected === "object" && assertion.expected !== null) {
        const expected = assertion.expected as Record<string, unknown>;
        if (typeof expected.value === "number") expected.value = expected.value + 20;
      }
    },
  };
}

function equalAngleBroken(): AdversarialMutation {
  return {
    description: "broke equality by asserting angle with a wrong pair",
    predicate: "equal_angle",
    apply(candidate) {
      const assertions = candidate.assertions as Array<Record<string, unknown>>;
      const assertion = assertions.find((item) => item.predicate === "equal_angle");
      if (assertion && Array.isArray(assertion.entities)) {
        // maths|14 asserts equal_angle(angle_a, angle_a) — change one side to
        // the right angle mark so the two arcs no longer match.
        if (assertion.entities.length === 2 && assertion.entities[0] === assertion.entities[1]) {
          assertion.entities = [assertion.entities[0] as string, "right_b"];
        }
      }
    },
  };
}

/** Rotate the incident ray so the angle of incidence no longer equals reflection. */
function equalAngleRayRotated(): AdversarialMutation {
  return {
    description: "rotated the incident ray by +20 degrees so incidence ≠ reflection",
    predicate: "equal_angle",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const refraction = constructions.find((item) => item.operator === "refract_at");
      if (refraction && typeof refraction.inputs === "object" && refraction.inputs !== null) {
        const inputs = refraction.inputs as Record<string, unknown>;
        if (typeof inputs.incidentAngleDeg === "number") inputs.incidentAngleDeg = inputs.incidentAngleDeg + 20;
      }
    },
  };
}

function snellsLawN2Changed(): AdversarialMutation {
  return {
    description: "changed n2 from 1.5 to 2.5",
    predicate: "snells_law",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "snells_law",
      );
      if (assertion && typeof assertion.expected === "object" && assertion.expected !== null) {
        (assertion.expected as Record<string, unknown>).n2 = 2.5;
      }
    },
  };
}

/** Rotate a point construction's (x,y) by the given angle around the origin. */
function rotatePointConstruction(
  constructions: Array<Record<string, unknown>>,
  entityId: string,
  angleRad: number,
): void {
  const pointConstruction = constructions.find((item) =>
    item.operator === "point" && Array.isArray(item.outputs) &&
    (item.outputs as string[]).includes(entityId),
  );
  if (!pointConstruction || typeof pointConstruction.inputs !== "object" || pointConstruction.inputs === null) return;
  const inputs = pointConstruction.inputs as Record<string, unknown>;
  if (typeof inputs.x !== "number" || typeof inputs.y !== "number") return;
  const x = inputs.x;
  const y = inputs.y;
  inputs.x = x * Math.cos(angleRad) - y * Math.sin(angleRad);
  inputs.y = x * Math.sin(angleRad) + y * Math.cos(angleRad);
}

/** Rotate the end of the first vector construction that outputs `entityId`. */
function rotateVectorEnd(
  constructions: Array<Record<string, unknown>>,
  entityId: string,
  angleRad: number,
): void {
  const vectorConstruction = constructions.find((item) =>
    item.operator === "vector" && Array.isArray(item.outputs) &&
    (item.outputs as string[]).includes(entityId),
  );
  if (!vectorConstruction || typeof vectorConstruction.inputs !== "object" || vectorConstruction.inputs === null) return;
  const endId = (vectorConstruction.inputs as Record<string, unknown>).end as string;
  rotatePointConstruction(constructions, endId, angleRad);
}

/** Rotate the end of the first line/segment construction that outputs `entityId`. */
function rotateLineEnd(
  constructions: Array<Record<string, unknown>>,
  entityId: string,
  angleRad: number,
): void {
  const lineConstruction = constructions.find((item) =>
    (item.operator === "line" || item.operator === "segment") && Array.isArray(item.outputs) &&
    (item.outputs as string[]).includes(entityId),
  );
  if (!lineConstruction || typeof lineConstruction.inputs !== "object" || lineConstruction.inputs === null) return;
  const inputs = lineConstruction.inputs as Record<string, unknown>;
  const endId = inputs.end as string | undefined;
  if (endId) rotatePointConstruction(constructions, endId, angleRad);
}

function perpendicularBroken(): AdversarialMutation {
  return {
    description: "rotated one asserted vector/segment so it is no longer perpendicular",
    predicate: "perpendicular",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "perpendicular",
      );
      if (!assertion || !Array.isArray(assertion.entities)) return;
      rotateVectorEnd(candidate.constructions as Array<Record<string, unknown>>, assertion.entities[1] as string, Math.PI / 9);
      rotateLineEnd(candidate.constructions as Array<Record<string, unknown>>, assertion.entities[1] as string, Math.PI / 9);
    },
  };
}

function parallelBroken(): AdversarialMutation {
  return {
    description: "rotated one asserted vector/segment so it is no longer parallel",
    predicate: "parallel",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "parallel",
      );
      if (!assertion || !Array.isArray(assertion.entities)) return;
      rotateVectorEnd(candidate.constructions as Array<Record<string, unknown>>, assertion.entities[1] as string, Math.PI / 9);
      rotateLineEnd(candidate.constructions as Array<Record<string, unknown>>, assertion.entities[1] as string, Math.PI / 9);
    },
  };
}

function collinearBroken(): AdversarialMutation {
  return {
    description: "moved the middle point off the line",
    predicate: "collinear",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const pointConstruction = constructions.find((item) =>
        Array.isArray(item.outputs) && (item.outputs as string[]).includes("b") && item.operator === "point",
      );
      if (pointConstruction && typeof pointConstruction.inputs === "object" && pointConstruction.inputs !== null) {
        const inputs = pointConstruction.inputs as Record<string, unknown>;
        if (typeof inputs.y === "number") inputs.y = inputs.y + 1;
      }
    },
  };
}

function equalLengthBroken(): AdversarialMutation {
  return {
    description: "changed one vector endpoint so lengths differ",
    predicate: "equal_length",
    apply(candidate) {
      const assertions = candidate.assertions as Array<Record<string, unknown>>;
      const assertion = assertions.find((item) => item.predicate === "equal_length");
      if (!assertion || !Array.isArray(assertion.entities)) return;
      const entityId = assertion.entities[1] as string;
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const vectorConstruction = constructions.find((item) =>
        Array.isArray(item.outputs) && (item.outputs as string[]).includes(entityId) && item.operator === "vector",
      );
      if (vectorConstruction && typeof vectorConstruction.inputs === "object" && vectorConstruction.inputs !== null) {
        const inputs = vectorConstruction.inputs as Record<string, unknown>;
        const endId = inputs.end as string;
        const pointConstruction = constructions.find((item) =>
          Array.isArray(item.outputs) && (item.outputs as string[]).includes(endId),
        );
        if (pointConstruction && typeof pointConstruction.inputs === "object" && pointConstruction.inputs !== null) {
          const pInputs = pointConstruction.inputs as Record<string, unknown>;
          if (typeof pInputs.x === "number") pInputs.x = pInputs.x + 1;
        }
      }
    },
  };
}

function equalSpacingBroken(): AdversarialMutation {
  return {
    description: "changed expected equal_spacing to a point set that is unevenly spaced",
    predicate: "equal_spacing",
    apply(candidate) {
      // The probe asserts equal_spacing on the wavefront family, which is
      // evenly spaced by construction. Re-point the assertion at three
      // hand-placed uneven points so the guard must measure actual spacing.
      const assertions = candidate.assertions as Array<Record<string, unknown>>;
      const assertion = assertions.find((item) => item.predicate === "equal_spacing");
      if (assertion) assertion.entities = ["wave_origin", "string_start", "string_end"];
    },
  };
}

function waveCyclesBroken(): AdversarialMutation {
  return {
    description: "changed expected wave cycles from 3 to 4",
    predicate: "wave_cycles",
    apply(candidate) {
      const assertions = candidate.assertions as Array<Record<string, unknown>>;
      const assertion = assertions.find((item) => item.predicate === "wave_cycles");
      if (assertion && typeof assertion.expected === "object" && assertion.expected !== null) {
        (assertion.expected as Record<string, unknown>).cycles = 4;
      }
    },
  };
}

function circuitPathBroken(): AdversarialMutation {
  return {
    description: "rewired the second series resistor off the chain so the path breaks",
    predicate: "path",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      // s2 currently runs n1 -> n2. Rewire its start from n1 to the dangling
      // spare node n3 so s1 and s2 no longer form an ordered series path.
      const symbolConstruction = constructions.find((item) =>
        item.operator === "symbol" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("s2"),
      );
      if (symbolConstruction && typeof symbolConstruction.inputs === "object" && symbolConstruction.inputs !== null) {
        (symbolConstruction.inputs as Record<string, unknown>).start = "n3";
      }
    },
  };
}

function circuitSameTerminalPairBroken(): AdversarialMutation {
  return {
    description: "moved one parallel branch so the two branches no longer share both terminals",
    predicate: "sameTerminalPair",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      // p2 currently runs a -> b (same as p1). Rewire its start from a to the
      // dangling spare node n3 so p1 and p2 no longer share a terminal pair.
      const symbolConstruction = constructions.find((item) =>
        item.operator === "symbol" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("p2"),
      );
      if (symbolConstruction && typeof symbolConstruction.inputs === "object" && symbolConstruction.inputs !== null) {
        (symbolConstruction.inputs as Record<string, unknown>).start = "n3";
      }
    },
  };
}

function circuitDegreeBroken(): AdversarialMutation {
  return {
    description: "rewired a terminal so node degree no longer matches",
    predicate: "degree",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const leadConstruction = constructions.find((item) =>
        item.operator === "connect" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("lead"),
      );
      if (leadConstruction && typeof leadConstruction.inputs === "object" && leadConstruction.inputs !== null) {
        (leadConstruction.inputs as Record<string, unknown>).end = "b";
      }
    },
  };
}

/** physics|4: force_x is a projection, so structurally always parallel to the
 * displacement. Break the claim instead: assert force is parallel to its own
 * perpendicular component (false whenever the force is not axis-aligned). */
/** Re-assert the first opposite_direction pair in the same direction (false). */
function oppositeDirectionBroken(): AdversarialMutation {
  return {
    description: "re-asserted a vector opposite to itself (false)",
    predicate: "opposite_direction",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "opposite_direction",
      );
      if (assertion && Array.isArray(assertion.entities) && assertion.entities.length === 2) {
        assertion.entities = [assertion.entities[0] as string, assertion.entities[0] as string];
      }
    },
  };
}

/** Break a `connected` claim by moving the contact target off the asserted subject. */
function connectedBroken(): AdversarialMutation {
  return {
    description: "moved the contact target so the block no longer touches it",
    predicate: "connected",
    apply(candidate) {
      // physics|3 asserts connected(block, contact). Move the block centre far
      // from the contact point so the assertion must fail.
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const blockConstruction = constructions.find((item) =>
        item.operator === "rectangle" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("block"),
      );
      if (blockConstruction && typeof blockConstruction.inputs === "object" && blockConstruction.inputs !== null) {
        const inputs = blockConstruction.inputs as Record<string, unknown>;
        const centerId = inputs.center as string;
        const pointConstruction = constructions.find((item) =>
          item.operator === "point" && Array.isArray(item.outputs) &&
          (item.outputs as string[]).includes(centerId),
        );
        if (pointConstruction && typeof pointConstruction.inputs === "object" && pointConstruction.inputs !== null) {
          const pInputs = pointConstruction.inputs as Record<string, unknown>;
          if (typeof pInputs.y === "number") pInputs.y = pInputs.y + 10;
        }
      }
    },
  };
}

function parallelComponentClaimBroken(): AdversarialMutation {
  return {
    description: "re-asserted force parallel to its perpendicular component (false)",
    predicate: "parallel",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "parallel",
      );
      if (assertion && Array.isArray(assertion.entities)) {
        assertion.entities = ["force", "force_y"];
      }
    },
  };
}

function inductorPathBroken(): AdversarialMutation {
  return {
    description: "disconnected the resistor from the series chain",
    predicate: "path",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const resistorConstruction = constructions.find((item) =>
        item.operator === "symbol" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("resistor"),
      );
      if (resistorConstruction && typeof resistorConstruction.inputs === "object" && resistorConstruction.inputs !== null) {
        (resistorConstruction.inputs as Record<string, unknown>).start = "n0";
      }
    },
  };
}

function inductorDegreeBroken(): AdversarialMutation {
  return {
    description: "rewired the resistor so middle-node degree is no longer 2",
    predicate: "degree",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const resistorConstruction = constructions.find((item) =>
        item.operator === "symbol" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("resistor"),
      );
      if (resistorConstruction && typeof resistorConstruction.inputs === "object" && resistorConstruction.inputs !== null) {
        (resistorConstruction.inputs as Record<string, unknown>).start = "n0";
      }
    },
  };
}

function assertionEntitiesChanged(
  predicate: string,
  entities: string[],
  description: string,
): AdversarialMutation {
  return {
    description,
    predicate,
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === predicate,
      );
      if (assertion) assertion.entities = entities;
    },
  };
}

function expectedNegated(predicate: string): AdversarialMutation {
  return {
    description: `negated the ${predicate} claim`,
    predicate,
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === predicate,
      );
      if (assertion) assertion.expected = false;
    },
  };
}

function vectorSumBroken(): AdversarialMutation {
  return {
    description: "moved the resultant tip so the parallelogram no longer closes",
    predicate: "vector_sum",
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const pointConstruction = constructions.find((item) =>
        item.operator === "point" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes("resultant_tip"),
      );
      if (pointConstruction && typeof pointConstruction.inputs === "object" && pointConstruction.inputs !== null) {
        const inputs = pointConstruction.inputs as Record<string, unknown>;
        if (typeof inputs.x === "number") inputs.x = inputs.x + 1;
      }
    },
  };
}

function rootOffCurve(): AdversarialMutation {
  return {
    description: "shifted the asserted root x by +0.5",
    predicate: "root",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "root",
      );
      if (!assertion) return;
      if (typeof assertion.expected === "number") {
        assertion.expected = assertion.expected + 0.5;
        return;
      }
      if (typeof assertion.expected === "object" && assertion.expected !== null) {
        const expected = assertion.expected as Record<string, unknown>;
        if (typeof expected.x === "number") expected.x = expected.x + 0.5;
      }
    },
  };
}

function pathCountBroken(): AdversarialMutation {
  return {
    description: "added a bypass wire so pathCount no longer matches",
    predicate: "pathCount",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "pathCount",
      );
      if (!assertion || !Array.isArray(assertion.entities) || assertion.entities.length < 2) return;
      const [from, to] = assertion.entities as [string, string];
      const entities = candidate.entities as Array<Record<string, unknown>>;
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      entities.push({ id: "bypass", kind: "connector", role: "bypass wire" });
      constructions.push({
        id: "make_bypass",
        operator: "connect",
        inputs: { start: from, end: to },
        outputs: ["bypass"],
      });
    },
  };
}

function rewireSymbolStart(
  outputId: string,
  newStart: string,
  predicate: string,
  description: string,
): AdversarialMutation {
  return {
    description,
    predicate,
    apply(candidate) {
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const symbolConstruction = constructions.find((item) =>
        item.operator === "symbol" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes(outputId),
      );
      if (symbolConstruction && typeof symbolConstruction.inputs === "object" && symbolConstruction.inputs !== null) {
        (symbolConstruction.inputs as Record<string, unknown>).start = newStart;
      }
    },
  };
}

function onPointMoved(): AdversarialMutation {
  return {
    description: "moved the asserted point off the supporting geometry",
    predicate: "on",
    apply(candidate) {
      const assertion = (candidate.assertions as Array<Record<string, unknown>>).find(
        (item) => item.predicate === "on",
      );
      if (!assertion || !Array.isArray(assertion.entities)) return;
      const pointId = assertion.entities[0] as string;
      const constructions = candidate.constructions as Array<Record<string, unknown>>;
      const pointConstruction = constructions.find((item) =>
        item.operator === "point" && Array.isArray(item.outputs) &&
        (item.outputs as string[]).includes(pointId),
      );
      if (pointConstruction && typeof pointConstruction.inputs === "object" && pointConstruction.inputs !== null) {
        const inputs = pointConstruction.inputs as Record<string, unknown>;
        if (typeof inputs.y === "number") inputs.y = inputs.y + 1;
      }
    },
  };
}

/** Adversarial mutation set per unit and depth level. Absent levels are reported as `missing`. */
const ADVERSARIAL_MUTATIONS: Record<string, Partial<Record<ProbeLevel, AdversarialMutation[]>>> = {
  "maths|7": { easy: [functionValueOffCurve()] },
  "maths|8": {
    easy: [functionValueOffCurve()],
    medium: [functionValueOffCurve()],
    composite: [functionValueOffCurve(), rootOffCurve()],
  },
  "maths|9": { easy: [functionValueOffCurve()] },
  "maths|10": {
    easy: [collinearBroken(), perpendicularBroken(), parallelBroken()],
    medium: [
      collinearBroken(),
      assertionEntitiesChanged("perpendicular", ["tangent", "companion"], "re-asserted two parallel vertical lines as perpendicular"),
      parallelBroken(),
    ],
    composite: [
      assertionEntitiesChanged("collinear", ["a", "m", "companion_start"], "re-asserted collinearity including a point off the line"),
      assertionEntitiesChanged("perpendicular", ["ab", "companion"], "re-asserted AB perpendicular to a parallel companion"),
      parallelBroken(),
      expectedNegated("equal_length"),
    ],
  },
  "maths|11": { easy: [perpendicularBroken(), parallelBroken()] },
  "maths|12": { easy: [perpendicularBroken(), parallelBroken(), equalLengthBroken()] },
  "maths|14": { easy: [equalAngleBroken(), angleBetweenChanged()] },
  "physics|2": { easy: [functionValueOffCurve()] },
  "physics|3": { easy: [perpendicularBroken(), oppositeDirectionBroken(), connectedBroken()] },
  "physics|4": { easy: [angleBetweenChanged(), parallelComponentClaimBroken()] },
  "physics|5": { easy: [perpendicularBroken(), angleBetweenChanged()] },
  "physics|10": { easy: [equalSpacingBroken(), waveCyclesBroken()] },
  "physics|11": {
    easy: [equalLengthBroken(), parallelBroken(), oppositeDirectionBroken()],
    medium: [equalLengthBroken(), parallelBroken(), oppositeDirectionBroken()],
    composite: [
      equalLengthBroken(),
      parallelBroken(),
      oppositeDirectionBroken(),
      onPointMoved(),
      vectorSumBroken(),
      angleBetweenChanged(),
    ],
  },
  "physics|12": {
    easy: [circuitPathBroken(), circuitSameTerminalPairBroken(), circuitDegreeBroken()],
    medium: [
      circuitPathBroken(),
      circuitSameTerminalPairBroken(),
      rewireSymbolStart("s2", "n3", "degree", "rewired the series feed so terminal degree no longer matches"),
      pathCountBroken(),
    ],
    composite: [
      rewireSymbolStart("s2", "n4", "path", "rewired the outgoing series resistor off the chain"),
      rewireSymbolStart("p2", "n4", "sameTerminalPair", "moved one parallel branch off the shared terminals"),
      rewireSymbolStart("p1", "n4", "degree", "rewired a parallel branch so junction degree no longer matches"),
      pathCountBroken(),
    ],
  },
  "physics|13": {
    easy: [perpendicularBroken(), parallelBroken()],
    medium: [
      assertionEntitiesChanged("perpendicular", ["i_parallel", "axis"], "re-asserted the parallel component perpendicular to the axis"),
      assertionEntitiesChanged("parallel", ["i_perp", "axis"], "re-asserted the perpendicular component parallel to the axis"),
    ],
    composite: [perpendicularBroken(), parallelBroken()],
  },
  "physics|14": {
    easy: [inductorPathBroken(), inductorDegreeBroken()],
    medium: [
      inductorPathBroken(),
      inductorDegreeBroken(),
    ],
    composite: [
      rewireSymbolStart("inductor", "n4", "path", "rewired the inductor off the series chain"),
      rewireSymbolStart("p1", "n4", "degree", "rewired a parallel branch so junction degree no longer matches"),
      pathCountBroken(),
      rewireSymbolStart("p2", "n4", "sameTerminalPair", "moved one parallel branch off the shared terminals"),
    ],
  },
  "physics|16": {
    easy: [snellsLawN2Changed(), equalAngleRayRotated(), angleBetweenChanged()],
    medium: [snellsLawN2Changed(), equalAngleRayRotated(), angleBetweenChanged()],
    composite: [
      snellsLawN2Changed(),
      expectedNegated("equal_angle"),
      angleBetweenChanged(),
      assertionEntitiesChanged("converges", ["ray1", "ray2", "glass_hit"], "re-asserted convergence at a point the rays do not meet"),
    ],
  },
};

interface AdversarialUnitResult {
  passed: string[];
  failed: string[];
  missing: string[];
}

function assertedPredicates(candidate: Record<string, unknown>): string[] {
  const assertions = Array.isArray(candidate.assertions) ? candidate.assertions : [];
  const predicates: string[] = [];
  for (const assertion of assertions) {
    if (typeof assertion !== "object" || assertion === null) continue;
    const predicate = (assertion as { predicate?: unknown }).predicate;
    if (typeof predicate === "string" && !predicates.includes(predicate)) predicates.push(predicate);
  }
  return predicates;
}

/** Run all authored mutations for one unit/level against its passing probe. */
function runAdversarialMutations(unit: string, level: ProbeLevel): AdversarialUnitResult {
  const candidate = PROBE_SCENE[unit]?.[level];
  const demand = UNIT_DEMAND[unit];
  if (!candidate || !demand) return { passed: [], failed: [], missing: demand?.predicates ?? [] };

  const mutations = ADVERSARIAL_MUTATIONS[unit]?.[level] ?? [];
  const coveredPredicates = new Set(mutations.map((mutation) => mutation.predicate));
  const requiredPredicates = [
    ...new Set([...demand.predicates, ...assertedPredicates(candidate)]),
  ];
  const missing = requiredPredicates.filter((predicate) => !coveredPredicates.has(predicate));

  const result: AdversarialUnitResult = { passed: [], failed: [], missing };
  for (const mutation of mutations) {
    const mutated = structuredClone(candidate);
    mutation.apply(mutated);
    const validation = validateSceneDocument(mutated);
    if (!validation.document) {
      // Validation rejected it before compile — still counts as guarded.
      result.passed.push(`${mutation.predicate}: ${mutation.description} (validation)`);
      continue;
    }
    const compiled = compileSceneDocument(validation.document);
    const fatalAssertion = compiled.report.issues.find(
      (issue) =>
        issue.severity === "fatal" &&
        (issue.code === "assertion_failed" || issue.code === "unsupported_assertion"),
    );
    if (!compiled.ok && fatalAssertion) {
      result.passed.push(`${mutation.predicate}: ${mutation.description}`);
    } else {
      result.failed.push(`${mutation.predicate}: ${mutation.description}`);
    }
  }
  return result;
}



const NON_ASCII_HEAVY = /[^\x00-\x7F]/g;

function isEnglishEnough(text: string): boolean {
  if (text.length < 30) return false;
  const nonAscii = text.match(NON_ASCII_HEAVY)?.length ?? 0;
  // Allow math symbols; reject Devanagari-mojibake / OCR garbage dominated rows.
  return nonAscii / text.length < 0.25;
}

const DIAGRAM_CUE =
  /\b(figure|diagram|graph|curve|plot|shown|shown in|circuit|ray|lens|mirror|prism|incline|slope|tangent|normal to|parabola|ellipse|hyperbola|circle|triangle|vector|field|trajectory|projectile|pendulum|wave|interference|diffraction)\b/i;

function isDiagramWorthy(text: string, demand: UnitCapabilityDemand): boolean {
  if (!demand.diagramLed) return false;
  return DIAGRAM_CUE.test(text);
}

// ---------------------------------------------------------------------------
// Planner-readiness (WS3).
//
// Capability coverage only proves the engine CAN render a unit. The planner still
// has to decide, from wording alone, whether a given stem wants a scene. These
// regexes are an OFFLINE diagnostic classifier only — they are never used at
// runtime to select or gate a diagram (AGENTS.md rule 6 forbids regex routing).
// ---------------------------------------------------------------------------

/** Explicit instruction to produce or use a construction. */
const CONSTRUCTIVE_CUE =
  /\b(draw|sketch|construct|plot|trace|find the (value|area|length|radius|focal|angle|distance|equation)|calculate|determine the|show that|compute the)\b/i;

/** Pure-concept markers where a text-only explanation is the honest answer. */
const QUALITATIVE_CUE =
  /\b(assertion|reason|which of the following|which of these|correct statement|statement(s)? (is|are)|not true|does not occur|true about)\b/i;

type PlannerReadiness = "constructive" | "qualitative" | "ambiguous";

function classifyPlannerReadiness(text: string): PlannerReadiness {
  const constructive = CONSTRUCTIVE_CUE.test(text);
  const qualitative = QUALITATIVE_CUE.test(text);
  if (constructive && !qualitative) return "constructive";
  if (qualitative && !constructive) return "qualitative";
  if (constructive && qualitative) return "constructive"; // explicit verb wins
  return "ambiguous";
}

// ---------------------------------------------------------------------------
// Coverage evaluation.
// ---------------------------------------------------------------------------

type CoverageOutcome =
  | "covered" // every demanded operator + predicate exists in the manifest
  | "missing_operator"
  | "missing_predicate"
  | "not_diagram_led"
  | "filtered_low_quality";

interface QuestionCoverage {
  question_id: string;
  subject: string;
  unit: string;
  confidence: string | null;
  outcome: CoverageOutcome;
  missingOperators: string[];
  missingPredicates: string[];
  /** Offline diagnostic only; never used to gate a live render. */
  plannerReadiness?: PlannerReadiness;
}

function evaluateUnitDemand(demand: UnitCapabilityDemand): {
  missingOperators: string[];
  missingPredicates: string[];
} {
  const missingOperators = demand.operators.filter(
    (operator) => !isExecutableSceneConstructionOperator(operator),
  );
  const missingPredicates = demand.predicates.filter(
    (predicate) => !isExecutableSceneProofPredicate(predicate),
  );
  return { missingOperators, missingPredicates };
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const questionsPath = resolve(repoRoot, "data/question-bank/build/questions.all.jsonl");
  const syllabusPath = resolve(repoRoot, "data/question-bank/build/question-syllabus.jsonl");

  // The question-bank corpus is gitignored (local-only). On a fresh clone or CI
  // without a local build, Tier A corpus coverage is skipped while the
  // deterministic Tier A+ compile probes still run — those need no corpus and are
  // the release-gating part.
  const corpusAvailable = existsSync(questionsPath) && existsSync(syllabusPath);
  if (!corpusAvailable) {
    console.log(
      "verify-syllabus-corpus: corpus not built locally; skipping Tier A name-check " +
        "(run build_corpus.py + build_syllabus_index.py to enable). Running compile probes only.",
    );
  }

  const assignmentById = new Map<string, SyllabusAssignment>();
  if (corpusAvailable) {
    for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const assignment = JSON.parse(line) as SyllabusAssignment;
      assignmentById.set(assignment.question_id, assignment);
    }
  }

  const results: QuestionCoverage[] = [];
  if (corpusAvailable) {
    for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const question = JSON.parse(line) as BankQuestion;
      const assignment = assignmentById.get(question.question_id);
      if (!assignment || assignment.status !== "classified") continue;
      const subject = assignment.subject ?? "";
      const unit = assignment.primary_unit_id ?? "";
      const demand = UNIT_DEMAND[unit];
      const text = question.text ?? "";

      const base = {
        question_id: question.question_id,
        subject,
        unit,
        confidence: assignment.confidence ?? null,
      };

      if (!demand) {
        results.push({ ...base, outcome: "not_diagram_led", missingOperators: [], missingPredicates: [] });
        continue;
      }
      if (!isEnglishEnough(text) || !isDiagramWorthy(text, demand)) {
        results.push({ ...base, outcome: "filtered_low_quality", missingOperators: [], missingPredicates: [] });
        continue;
      }

      const { missingOperators, missingPredicates } = evaluateUnitDemand(demand);
      const outcome: CoverageOutcome =
        missingOperators.length > 0
          ? "missing_operator"
          : missingPredicates.length > 0
            ? "missing_predicate"
            : "covered";
      results.push({
        ...base,
        outcome,
        missingOperators,
        missingPredicates,
        plannerReadiness: classifyPlannerReadiness(text),
      });
    }
  }

  // Aggregate.
  const outcomeCounts = new Map<CoverageOutcome, number>();
  const byUnit = new Map<string, Map<CoverageOutcome, number>>();
  const missingOperatorCounts = new Map<string, number>();
  const missingPredicateCounts = new Map<string, number>();
  for (const result of results) {
    outcomeCounts.set(result.outcome, (outcomeCounts.get(result.outcome) ?? 0) + 1);
    if (result.outcome === "not_diagram_led" || result.outcome === "filtered_low_quality") continue;
    const unitCounts = byUnit.get(result.unit) ?? new Map<CoverageOutcome, number>();
    unitCounts.set(result.outcome, (unitCounts.get(result.outcome) ?? 0) + 1);
    byUnit.set(result.unit, unitCounts);
    for (const operator of result.missingOperators) {
      missingOperatorCounts.set(operator, (missingOperatorCounts.get(operator) ?? 0) + 1);
    }
    for (const predicate of result.missingPredicates) {
      missingPredicateCounts.set(predicate, (missingPredicateCounts.get(predicate) ?? 0) + 1);
    }
  }

  const total = results.length;
  const measured = results.filter(
    (r) => r.outcome === "covered" || r.outcome === "missing_operator" || r.outcome === "missing_predicate",
  );
  const covered = measured.filter((r) => r.outcome === "covered").length;

  // Planner-readiness split over measured diagram-worthy rows (offline diagnostic).
  const plannerReadinessCounts = new Map<PlannerReadiness, number>();
  for (const result of measured) {
    if (!result.plannerReadiness) continue;
    plannerReadinessCounts.set(
      result.plannerReadiness,
      (plannerReadinessCounts.get(result.plannerReadiness) ?? 0) + 1,
    );
  }

  const sortByCount = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]);

  // Tier A+ compile probes: the easy scene is the release gate.
  const compileProbeResults = new Map<string, CompileProbeResult>();
  for (const [unit, demand] of Object.entries(UNIT_DEMAND)) {
    if (!demand.diagramLed) continue;
    if (demand.compileProbe === "skip") {
      compileProbeResults.set(unit, { outcome: "probe_not_implemented", fatalIssues: [] });
      continue;
    }
    const candidate = PROBE_SCENE[unit]?.easy;
    if (!candidate) {
      compileProbeResults.set(unit, { outcome: "probe_not_implemented", fatalIssues: [] });
      continue;
    }
    compileProbeResults.set(unit, runCompileProbe(unit, candidate));
  }
  const probeTotals = {
    passed: [...compileProbeResults.values()].filter((result) => result.outcome === "probe_passed").length,
    failed: [...compileProbeResults.values()].filter((result) => result.outcome === "probe_failed").length,
    not_implemented: [...compileProbeResults.values()].filter((result) => result.outcome === "probe_not_implemented").length,
  };

  // Depth probes: every expected level plus any extra authored level (e.g. hard).
  type DepthKey = `${string}/${ProbeLevel}`;
  const compileProbeDepthResults = new Map<DepthKey, CompileProbeResult>();
  const depthGaps: string[] = [];
  for (const [unit, demand] of Object.entries(UNIT_DEMAND)) {
    if (!demand.diagramLed) continue;
    const authored = new Set(
      PROBE_LEVELS.filter((level) => PROBE_SCENE[unit]?.[level] !== undefined),
    );
    const levels = new Set<ProbeLevel>([...expectedProbeLevels(unit), ...authored]);
    for (const level of PROBE_LEVELS) {
      if (!levels.has(level)) continue;
      const key: DepthKey = `${unit}/${level}`;
      if (demand.compileProbe === "skip") {
        compileProbeDepthResults.set(key, { outcome: "probe_not_implemented", fatalIssues: [] });
        if (expectedProbeLevels(unit).includes(level)) depthGaps.push(key);
        continue;
      }
      const candidate = PROBE_SCENE[unit]?.[level];
      if (!candidate) {
        compileProbeDepthResults.set(key, { outcome: "probe_not_implemented", fatalIssues: [] });
        if (expectedProbeLevels(unit).includes(level)) depthGaps.push(key);
        continue;
      }
      const result = runCompileProbe(unit, candidate);
      compileProbeDepthResults.set(key, result);
      if (result.outcome === "probe_not_implemented" && expectedProbeLevels(unit).includes(level)) {
        depthGaps.push(key);
      }
    }
  }
  const depthTotals = {
    levels: compileProbeDepthResults.size,
    passed: [...compileProbeDepthResults.values()].filter((result) => result.outcome === "probe_passed").length,
    failed: [...compileProbeDepthResults.values()].filter((result) => result.outcome === "probe_failed").length,
    not_implemented: [...compileProbeDepthResults.values()].filter((result) => result.outcome === "probe_not_implemented").length,
  };

  // Tier A++ adversarial mutations across every authored depth level.
  const adversarialByLevel = new Map<string, Partial<Record<ProbeLevel, AdversarialUnitResult>>>();
  for (const [unit, demand] of Object.entries(UNIT_DEMAND)) {
    if (!demand.diagramLed) continue;
    if (demand.compileProbe === "skip") continue;
    if (!PROBE_SCENE[unit]) continue;
    const byLevel: Partial<Record<ProbeLevel, AdversarialUnitResult>> = {};
    for (const level of PROBE_LEVELS) {
      if (!PROBE_SCENE[unit]?.[level]) continue;
      byLevel[level] = runAdversarialMutations(unit, level);
    }
    adversarialByLevel.set(unit, byLevel);
  }
  const adversarialTotals = {
    mutations: 0,
    rejected: 0,
    not_rejected: 0,
    no_mutation: 0,
  };
  const rollupAdversarial = (byLevel: Partial<Record<ProbeLevel, AdversarialUnitResult>>): AdversarialUnitResult => {
    const rollup: AdversarialUnitResult = { passed: [], failed: [], missing: [] };
    for (const level of PROBE_LEVELS) {
      const result = byLevel[level];
      if (!result) continue;
      rollup.passed.push(...result.passed.map((item) => `${level}: ${item}`));
      rollup.failed.push(...result.failed.map((item) => `${level}: ${item}`));
      rollup.missing.push(...result.missing.map((item) => `${level}: ${item}`));
    }
    return rollup;
  };
  for (const byLevel of adversarialByLevel.values()) {
    const rollup = rollupAdversarial(byLevel);
    adversarialTotals.mutations += rollup.passed.length + rollup.failed.length;
    adversarialTotals.rejected += rollup.passed.length;
    adversarialTotals.not_rejected += rollup.failed.length;
    adversarialTotals.no_mutation += rollup.missing.length;
  }

  const depthByUnit: Record<string, Partial<Record<ProbeLevel, { outcome: CompileProbeOutcome; fatalIssues: string[] }>>> = {};
  for (const [key, result] of compileProbeDepthResults) {
    const [unit, level] = key.split("/") as [string, ProbeLevel];
    const entry = depthByUnit[unit] ?? {};
    entry[level] = { outcome: result.outcome, fatalIssues: result.fatalIssues };
    depthByUnit[unit] = entry;
  }

  const report = {
    schema: "syllabus-capability-coverage/v1",
    generated: new Date().toISOString(),
    inputs: { questions: questionsPath, syllabus: syllabusPath },
    totals: {
      classified_rows: total,
      measured_diagram_worthy: measured.length,
      covered,
      not_diagram_led: outcomeCounts.get("not_diagram_led") ?? 0,
      filtered_low_quality: outcomeCounts.get("filtered_low_quality") ?? 0,
      missing_operator: outcomeCounts.get("missing_operator") ?? 0,
      missing_predicate: outcomeCounts.get("missing_predicate") ?? 0,
      coverage_pct: measured.length > 0 ? Math.round((covered / measured.length) * 1000) / 10 : 0,
    },
    by_unit: Object.fromEntries(
      [...byUnit.entries()]
        .sort((a, b) => {
          const sumA = [...a[1].values()].reduce((x, y) => x + y, 0);
          const sumB = [...b[1].values()].reduce((x, y) => x + y, 0);
          return sumB - sumA;
        })
        .map(([unit, counts]) => [
          unit,
          {
            total: [...counts.values()].reduce((x, y) => x + y, 0),
            covered: counts.get("covered") ?? 0,
            missing_operator: counts.get("missing_operator") ?? 0,
            missing_predicate: counts.get("missing_predicate") ?? 0,
          },
        ]),
    ),
    missing_operators: Object.fromEntries(sortByCount(missingOperatorCounts)),
    missing_predicates: Object.fromEntries(sortByCount(missingPredicateCounts)),
    planner_readiness: Object.fromEntries(
      [...plannerReadinessCounts.entries()].sort((a, b) => b[1] - a[1]),
    ),
    compile_probe: {
      totals: probeTotals,
      by_unit: Object.fromEntries(
        [...compileProbeResults.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([unit, result]) => [
            unit,
            { outcome: result.outcome, fatalIssues: result.fatalIssues },
          ]),
      ),
    },
    compile_probe_depth: {
      totals: depthTotals,
      by_unit: Object.fromEntries(
        Object.entries(depthByUnit).sort((a, b) => a[0].localeCompare(b[0])),
      ),
    },
    adversarial: {
      totals: adversarialTotals,
      by_unit: Object.fromEntries(
        [...adversarialByLevel.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([unit, byLevel]) => {
            const rollup = rollupAdversarial(byLevel);
            return [
              unit,
              {
                passed: rollup.passed,
                failed: rollup.failed,
                missing: rollup.missing,
                by_level: Object.fromEntries(
                  PROBE_LEVELS.flatMap((level) => {
                    const result = byLevel[level];
                    return result
                      ? [[level, { passed: result.passed, failed: result.failed, missing: result.missing }]]
                      : [];
                  }),
                ),
              },
            ];
          }),
      ),
    },
  };

  // Print summary.
  console.log("verify-syllabus-corpus: capability coverage");
  console.log(
    `  classified=${total} measured=${measured.length} covered=${covered} (${report.totals.coverage_pct}%)`,
  );
  console.log(
    `  not_diagram_led=${report.totals.not_diagram_led} filtered_low_quality=${report.totals.filtered_low_quality}`,
  );
  console.log(`  missing_operator=${report.totals.missing_operator} missing_predicate=${report.totals.missing_predicate}`);
  if (Object.keys(report.planner_readiness).length > 0) {
    console.log("  planner readiness:", JSON.stringify(report.planner_readiness));
  }
  if (Object.keys(report.missing_operators).length > 0) {
    console.log("  missing operators:", JSON.stringify(report.missing_operators));
  }
  if (Object.keys(report.missing_predicates).length > 0) {
    console.log("  missing predicates:", JSON.stringify(report.missing_predicates));
  }

  // Tier A+ compile-and-prove summary (easy only).
  console.log("verify-syllabus-corpus: compile probes (Tier A+)");
  for (const [unit, result] of [...compileProbeResults.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (result.outcome === "probe_passed") {
      console.log(`  ${unit}: probe_passed`);
    } else if (result.outcome === "probe_not_implemented") {
      console.log(`  ${unit}: probe_not_implemented`);
    } else {
      console.log(`  ${unit}: probe_failed`);
      for (const issue of result.fatalIssues) console.log(`    - ${issue}`);
    }
  }
  console.log(
    `  probes passed=${probeTotals.passed} failed=${probeTotals.failed} not_implemented=${probeTotals.not_implemented}`,
  );
  if (probeTotals.not_implemented > 0) {
    console.log("  note: probe_not_implemented units are capability gaps, not failures");
  }

  console.log("verify-syllabus-corpus: compile probe depth");
  for (const [key, result] of [...compileProbeDepthResults.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (result.outcome === "probe_passed") {
      console.log(`  ${key}: probe_passed`);
    } else if (result.outcome === "probe_not_implemented") {
      console.log(`  ${key}: probe_not_implemented`);
    } else {
      console.log(`  ${key}: probe_failed`);
      for (const issue of result.fatalIssues) console.log(`    - ${issue}`);
    }
  }
  console.log(
    `  levels=${depthTotals.levels} passed=${depthTotals.passed} failed=${depthTotals.failed} not_implemented=${depthTotals.not_implemented}`,
  );
  if (depthGaps.length > 0) {
    console.log(`  GAPS: ${depthGaps.join(", ")}`);
  }

  // Tier A++ adversarial summary.
  console.log("verify-syllabus-corpus: adversarial mutations (Tier A++)");
  for (const [unit, byLevel] of [...adversarialByLevel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rollup = rollupAdversarial(byLevel);
    console.log(
      `  ${unit}: rejected=${rollup.passed.length} not_rejected=${rollup.failed.length} no_mutation=${rollup.missing.length}`,
    );
    for (const failure of rollup.failed) {
      console.log(`    - NOT guarding: ${failure}`);
    }
    for (const missingPredicate of rollup.missing) {
      console.log(`    - no mutation authored for demanded predicate: ${missingPredicate}`);
    }
  }
  console.log(
    `  mutations=${adversarialTotals.mutations} rejected=${adversarialTotals.rejected} ` +
      `not_rejected=${adversarialTotals.not_rejected} no_mutation=${adversarialTotals.no_mutation}`,
  );
  if (adversarialTotals.not_rejected > 0) {
    console.log(`  GAPS: ${adversarialTotals.not_rejected} mutation(s) were NOT rejected — demanded predicates are not guarding geometry`);
  }

  // Optional report file.
  const reportFlagIndex = process.argv.indexOf("--report");
  if (reportFlagIndex !== -1 && process.argv[reportFlagIndex + 1]) {
    const reportPath = resolve(process.argv[reportFlagIndex + 1]);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`  report=${reportPath}`);
  }

  // Release gate: any implemented probe that fails must fail the run.
  if (probeTotals.failed > 0 || depthTotals.failed > 0) {
    process.exitCode = 1;
  }
}

main();
