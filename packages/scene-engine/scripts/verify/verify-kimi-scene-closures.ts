/**
 * Two narrow readers found by replaying Kimi K3 Fast scene candidates (19 Oct 2026).
 *
 * F4. A capacitor drawn as two plate segments with a battery wired to them
 * (the apparatus view of the parallel_plates archetype) was refused as
 * source_loop_not_closed, because the closure walk only follows symbol and
 * connect edges. Exactly two plate segments now count as one two-terminal
 * component that a loop may cross once. A floating battery, a battery wired to
 * one plate, a battery shorted through one plate, joined plates, a third plate
 * and a plate role on a non-segment all stay refused.
 *
 * F3. A space_frame whose 2D anchor point gives no coordinates failed every
 * world derivation (invalid_space_*_x). The anchor only places the projected
 * frame on the page, so with exactly one frame and no other 2D construction it
 * is anchored at (0, 0). Two frames, a partly given anchor or any mixed 2D
 * construction are left for the validator.
 *
 * Fixtures: synthetic documents plus two recorded candidates stripped to what
 * the checks need (physics_11 from data/diagram-eval/v1/physics.jsonl and
 * q_2df5faa0a514 from data/question-bank). Both stems are public.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-kimi-scene-closures.ts
 */
import assert from "node:assert/strict";
import type { SceneDocument, TurnPlanV3 } from "../../src";

const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");
let checks = 0;
function check(value: unknown, message: string): asserts value { checks += 1; assert.ok(value, message); }

const CAPACITOR_STEM = "A parallel-plate capacitor has area 0.020 m^2 and separation 1.0 mm and remains connected to an ideal 100 V battery. A dielectric of relative permittivity 3.0 completely fills the gap. Neglect fringing. Find its capacitance and charge before and after insertion. Take ε₀ = 8.85 * 10⁻^1^2 F/m.";
const COSINE_STEM = "If a line makes angles of 90°, 135° and 45° with the x, y and z axes respectively, then its direction cosines are";

type Raw = Record<string, unknown>;
type Construction = { id: string; operator: string; inputs: Raw; outputs: string[] };
type Entity = { id: string; kind: string; role: string; label?: string };

function sceneDocument(question: string, entities: Entity[], constructions: Construction[], assertions: Raw[] = []): Raw {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify kimi scene closures" },
    source: { question },
    quantities: [], entities, constructions, relations: [], assertions, annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "figure", entityIds: ids, dependsOn: [], narrationCue: "figure" }],
    teachingTimeline: [],
  };
}

function plan(question: string): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  } as TurnPlanV3;
}

// ---------------------------------------------------------------- F4 fixtures
const point = (id: string, x: number, y: number, role = "node"): [Entity, Construction] => [
  { id, kind: "point", role },
  { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] },
];
const segment = (id: string, start: string, end: string, role: string, operator = "segment", kind = "segment"): [Entity, Construction] => [
  { id, kind, role },
  { id: `make_${id}`, operator, inputs: { start, end }, outputs: [id] },
];
const wire = (id: string, start: string, end: string): [Entity, Construction] => [
  { id, kind: "connector", role: "wire" },
  { id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] },
];
const battery: [Entity, Construction] = [
  { id: "bat", kind: "component", role: "battery" },
  { id: "make_bat", operator: "symbol", inputs: { symbol: "battery", start: "batP", end: "batN" }, outputs: ["bat"] },
];

/** Recorded physics_11 plan/primary candidate #0, stripped to its battery, wires and plates. */
function capacitor(options: { wires?: Array<[string, string, string]>; extra?: Array<[Entity, Construction]>; plates?: Array<[Entity, Construction]> } = {}): Raw {
  const parts: Array<[Entity, Construction]> = [
    point("p1a", -2, 1.1, "plate end"), point("p1b", 2, 1.1, "plate end"),
    point("p2a", -2, -1.1, "plate end"), point("p2b", 2, -1.1, "plate end"),
    point("batP", -2.8, 1.1, "battery terminal"), point("batN", -2.8, -1.1, "battery terminal"),
    ...(options.plates ?? [segment("plate1", "p1a", "p1b", "plate"), segment("plate2", "p2a", "p2b", "plate")]),
    battery,
    ...(options.wires ?? [["w1", "p1a", "batP"], ["w2", "p2a", "batN"]]).map(([id, start, end]) => wire(id, start, end)),
    ...(options.extra ?? []),
  ];
  return sceneDocument(CAPACITOR_STEM, parts.map(([entity]) => entity), parts.map(([, construction]) => construction));
}

function closureIssues(raw: Raw, label: string): string[] {
  const validation = engine.validateSceneDocument(raw);
  check(validation.document, `${label}: document must stay structurally valid so the closure check is what decides: ${JSON.stringify(validation.report.issues)}`);
  return engine.validateTurnPlanSceneProofs(validation.document as SceneDocument, plan(CAPACITOR_STEM))
    .filter((issue: { code: string }) => issue.code === "source_loop_not_closed")
    .map((issue: { message: string }) => issue.message);
}

{
  const positive = capacitor();
  check(closureIssues(positive, "two-plate capacitor").length === 0, "a battery wired to two plate segments closes its loop across the capacitor");
  const validation = engine.validateSceneDocument(positive);
  const compiled = engine.compileSceneDocument(validation.document!);
  check(compiled.ok && compiled.renderScene, `the two-plate capacitor compiles: ${JSON.stringify(compiled.report.issues)}`);
}

const refused: Array<[string, Raw]> = [
  ["a floating battery", capacitor({ wires: [] })],
  ["a battery wired to only one plate", capacitor({ wires: [["w1", "p1a", "batP"]] })],
  ["a battery shorted through one plate (both terminals on plate 1)", capacitor({ wires: [["w1", "p1a", "batP"], ["w2", "p1b", "batN"]] })],
  ["a battery shorted through one plate (plus terminal on both plates)", capacitor({ wires: [["w1", "p1a", "batP"], ["w3", "p2a", "batP"], ["w2", "p2b", "batN"]] })],
  ["plates joined at a shared end point", capacitor({
    plates: [segment("plate1", "p1a", "p1b", "plate"), segment("plate2", "p1b", "p2b", "plate")],
    wires: [["w1", "p1a", "batP"], ["w2", "p2b", "batN"]],
  })],
  ["three plate segments", capacitor({ extra: [point("p3a", -2, -3.3, "plate end"), point("p3b", 2, -3.3, "plate end"), segment("plate3", "p3a", "p3b", "plate")] })],
  ["a plate role on a non-segment", capacitor({ plates: [segment("plate1", "p1a", "p1b", "plate", "line", "line"), segment("plate2", "p2a", "p2b", "plate", "line", "line")] })],
];
for (const [label, raw] of refused) {
  check(closureIssues(raw, label).length > 0, `${label} must stay source_loop_not_closed`);
}

// ---------------------------------------------------------------- F3 fixtures
/** Recorded q_2df5faa0a514 plan/alternate candidate #1, labels and narration stripped. */
function directionCosines(mutate: (constructions: Construction[], entities: Entity[]) => void = () => {}): Raw {
  const entities: Entity[] = [
    { id: "f", kind: "point", role: "frame origin" }, { id: "ax", kind: "polyline", role: "3D axes" },
    { id: "O", kind: "point", role: "origin", label: "O" }, { id: "X", kind: "point", role: "x-axis tip" },
    { id: "Y", kind: "point", role: "y-axis tip" }, { id: "Z", kind: "point", role: "z-axis tip" },
    { id: "dT", kind: "point", role: "direction tip" }, { id: "d", kind: "vector", role: "line direction" },
    { id: "L", kind: "line", role: "given line", label: "L" },
    { id: "al", kind: "angle_mark", role: "angle with x-axis", label: "α" },
    { id: "be", kind: "angle_mark", role: "angle with y-axis", label: "β" },
    { id: "ga", kind: "angle_mark", role: "angle with z-axis", label: "γ" },
  ];
  const s = 2.1213203435596424;
  const constructions: Construction[] = [
    { id: "kf", operator: "point", inputs: { coordinateSpace: "world" }, outputs: ["f"] },
    { id: "kax", operator: "space_frame", inputs: { origin: "f", scale: 1, axisLength: 3 }, outputs: ["ax"] },
    { id: "kO", operator: "space_point", inputs: { frame: "ax", x: 0, y: 0, z: 0 }, outputs: ["O"] },
    { id: "kX", operator: "space_point", inputs: { frame: "ax", x: 3, y: 0, z: 0 }, outputs: ["X"] },
    { id: "kY", operator: "space_point", inputs: { frame: "ax", x: 0, y: 3, z: 0 }, outputs: ["Y"] },
    { id: "kZ", operator: "space_point", inputs: { frame: "ax", x: 0, y: 0, z: 3 }, outputs: ["Z"] },
    { id: "kdT", operator: "space_point", inputs: { frame: "ax", x: 0, y: -s, z: s }, outputs: ["dT"] },
    { id: "kd", operator: "space_vector", inputs: { frame: "ax", start: "O", end: "dT" }, outputs: ["d"] },
    { id: "kL", operator: "space_line", inputs: { frame: "ax", point: "O", direction: [0, -Math.SQRT1_2, Math.SQRT1_2], tMin: -1.6, tMax: 1.6 }, outputs: ["L"] },
    { id: "kal", operator: "space_angle_mark", inputs: { frame: "ax", vertex: "O", a: "X", b: "d", radius: 1.4 }, outputs: ["al"] },
    { id: "kbe", operator: "space_angle_mark", inputs: { frame: "ax", vertex: "O", a: "Y", b: "d", radius: 1.8 }, outputs: ["be"] },
    { id: "kga", operator: "space_angle_mark", inputs: { frame: "ax", vertex: "O", a: "Z", b: "d", radius: 1 }, outputs: ["ga"] },
  ];
  mutate(constructions, entities);
  return sceneDocument(COSINE_STEM, entities, constructions, [
    { id: "angle_alpha", predicate: "angle_between", entities: ["al"], expected: { value: 90, unit: "degree" }, severity: "fatal" },
    { id: "angle_beta", predicate: "angle_between", entities: ["be"], expected: { value: 135, unit: "degree" }, severity: "fatal" },
    { id: "angle_gamma", predicate: "angle_between", entities: ["ga"], expected: { value: 45, unit: "degree" }, severity: "fatal" },
    { id: "line_parallel_d", predicate: "parallel", entities: ["d", "L"], expected: true, severity: "fatal" },
  ]);
}

function anchorInputs(document: SceneDocument | null): Raw | undefined {
  return document?.constructions.find((construction) => construction.id === "kf")?.inputs;
}

{
  const validation = engine.validateSceneDocument(directionCosines());
  check(validation.document, `a bare frame anchor validates: ${JSON.stringify(validation.report.issues)}`);
  const anchor = anchorInputs(validation.document);
  check(anchor?.x === 0 && anchor?.y === 0, `the bare frame anchor is placed at (0, 0): ${JSON.stringify(anchor)}`);
  const compiled = engine.compileSceneDocument(validation.document!);
  check(compiled.ok && compiled.renderScene, `the direction cosine figure compiles with every angle proved: ${JSON.stringify(compiled.report.issues)}`);
  check(!compiled.report.issues.some((issue: { code: string }) => issue.code === "assertion_failed"), "90, 135 and 45 degree marks hold against the directed vector");
}
{
  // Synthetic minimum: one frame, a bare anchor and two world points.
  const raw = sceneDocument(COSINE_STEM,
    [{ id: "f", kind: "point", role: "frame origin" }, { id: "ax", kind: "polyline", role: "3D axes" }, { id: "P", kind: "point", role: "point" }],
    [
      { id: "kf", operator: "point", inputs: {}, outputs: ["f"] },
      { id: "kax", operator: "space_frame", inputs: { origin: "f" }, outputs: ["ax"] },
      { id: "kP", operator: "space_point", inputs: { frame: "ax", x: 1, y: 2, z: 1 }, outputs: ["P"] },
    ]);
  const validation = engine.validateSceneDocument(raw);
  check(validation.document && anchorInputs(validation.document)?.x === 0 && anchorInputs(validation.document)?.y === 0,
    `a minimal bare anchor is placed at (0, 0): ${JSON.stringify(validation.report.issues)}`);
}

const notDefaulted: Array<[string, Raw]> = [
  ["two space_frames on one anchor", directionCosines((constructions, entities) => {
    entities.push({ id: "ax2", kind: "polyline", role: "second axes" });
    constructions.push({ id: "kax2", operator: "space_frame", inputs: { origin: "f", scale: 1, axisLength: 2 }, outputs: ["ax2"] });
  })],
  ["two space_frames with two anchors", directionCosines((constructions, entities) => {
    entities.push({ id: "f2", kind: "point", role: "second frame origin" }, { id: "ax2", kind: "polyline", role: "second axes" });
    constructions.push(
      { id: "kf2", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["f2"] },
      { id: "kax2", operator: "space_frame", inputs: { origin: "f2", scale: 1, axisLength: 2 }, outputs: ["ax2"] },
    );
  })],
  ["an anchor with x set", directionCosines((constructions) => { constructions[0]!.inputs = { x: 1, coordinateSpace: "world" }; })],
  ["a 2D point mixed in", directionCosines((constructions, entities) => {
    entities.push({ id: "Q", kind: "point", role: "page point" });
    constructions.push({ id: "kQ", operator: "point", inputs: { x: 5, y: 5, coordinateSpace: "world" }, outputs: ["Q"] });
  })],
  ["a 2D segment mixed in", directionCosines((constructions, entities) => {
    entities.push({ id: "Q", kind: "point", role: "page point" }, { id: "R", kind: "point", role: "page point" }, { id: "QR", kind: "segment", role: "page segment" });
    constructions.push(
      { id: "kQ", operator: "point", inputs: { x: 5, y: 5, coordinateSpace: "world" }, outputs: ["Q"] },
      { id: "kR", operator: "point", inputs: { x: 7, y: 5, coordinateSpace: "world" }, outputs: ["R"] },
      { id: "kQR", operator: "segment", inputs: { start: "Q", end: "R" }, outputs: ["QR"] },
    );
  })],
];
for (const [label, raw] of notDefaulted) {
  const validation = engine.validateSceneDocument(raw);
  check(validation.document === null && validation.report.issues.some((issue: { message: string }) => /\b[xy] must\b/.test(issue.message)),
    `${label}: the missing anchor coordinate must still be refused: ${JSON.stringify(validation.report.issues.map((issue: { code: string }) => issue.code))}`);
}

console.log(`verify-kimi-scene-closures: ${checks} checks passed`);
