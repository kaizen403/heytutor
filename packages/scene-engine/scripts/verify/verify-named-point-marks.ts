/**
 * Named-point ink: balls and open circles only for student-facing names,
 * and labels must sit on (or lead to) the geometry they name.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-named-point-marks.ts
 */
import {
  compileSceneDocument,
  pruneDeadSceneEntities,
  synthesizeFamilyScene,
  validateSceneDocument,
  type RenderPrimitive,
  type SceneDocument,
} from "../../src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function compile(raw: unknown): { document: SceneDocument; primitives: RenderPrimitive[] } {
  const pruned = pruneDeadSceneEntities(raw as Record<string, unknown>);
  const validated = validateSceneDocument(pruned);
  assert(Boolean(validated.document), `validate failed: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document!);
  assert(Boolean(compiled.ok && compiled.renderScene), `compile failed: ${JSON.stringify(compiled.report.issues)}`);
  return { document: validated.document!, primitives: compiled.renderScene!.primitives };
}

function pointMarks(primitives: RenderPrimitive[], entityId?: string): RenderPrimitive[] {
  return primitives.filter((primitive) =>
    primitive.kind === "point" && (entityId === undefined || primitive.entityId === entityId));
}

function circles(primitives: RenderPrimitive[], entityId?: string): RenderPrimitive[] {
  return primitives.filter((primitive) =>
    primitive.kind === "circle" && (entityId === undefined || primitive.entityId === entityId));
}

function labelsFor(primitives: RenderPrimitive[], entityId: string): RenderPrimitive[] {
  return primitives.filter((primitive) => primitive.kind === "label" && primitive.entityId === entityId);
}

function ownerInk(primitives: RenderPrimitive[], entityId: string): RenderPrimitive[] {
  return primitives.filter((primitive) =>
    primitive.entityId === entityId && primitive.kind !== "label");
}

function distanceToSegment(
  at: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = dx * dx + dy * dy;
  if (span < 1e-6) return Math.hypot(at.x - start.x, at.y - start.y);
  const t = Math.min(1, Math.max(0, ((at.x - start.x) * dx + (at.y - start.y) * dy) / span));
  return Math.hypot(at.x - (start.x + dx * t), at.y - (start.y + dy * t));
}

function nearestLabelDistance(label: RenderPrimitive, ink: RenderPrimitive[]): number {
  const at = label.points[0];
  if (!at) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const primitive of ink) {
    for (const point of primitive.points) {
      best = Math.min(best, Math.hypot(at.x - point.x, at.y - point.y));
    }
    for (let index = 0; index < primitive.points.length - 1; index += 1) {
      const start = primitive.points[index];
      const end = primitive.points[index + 1];
      if (start && end) best = Math.min(best, distanceToSegment(at, start, end));
    }
    if (primitive.kind === "circle" || primitive.kind === "arc") {
      const center = primitive.points[0];
      if (center && typeof primitive.radius === "number") {
        best = Math.min(best, Math.abs(Math.hypot(at.x - center.x, at.y - center.y) - primitive.radius));
      }
    }
  }
  return best;
}

function labelAttached(primitives: RenderPrimitive[], entityId: string, maxPx = 72): void {
  const labels = labelsFor(primitives, entityId);
  assert(labels.length > 0, `${entityId} must keep its label`);
  const ink = ownerInk(primitives, entityId);
  assert(ink.length > 0, `${entityId} must render owner geometry`);
  const attached = labels.some((label) =>
    label.provenance?.usesLeader === true || nearestLabelDistance(label, ink) <= maxPx);
  assert(attached, `${entityId} label must sit on or lead to its geometry (got ${
    labels.map((label) => JSON.stringify(label.points[0])).join(", ")
  })`);
}

const coilFixture = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "spring coil vertices must not draw balls" },
  source: { question: "A block on a spring of stiffness k1 oscillates on a frictionless surface." },
  quantities: [],
  entities: [
    { id: "sp0", kind: "point", role: "spring coil point" },
    { id: "sp1", kind: "point", role: "spring coil point" },
    { id: "sp2", kind: "point", role: "spring coil point" },
    { id: "spring", kind: "polyline", role: "spring", label: "k1" },
    { id: "G", kind: "point", role: "body centre" },
    { id: "body", kind: "rectangle", role: "body", label: "m" },
  ],
  constructions: [
    { id: "make_sp0", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["sp0"] },
    { id: "make_sp1", operator: "point", inputs: { x: 1, y: 0.4, coordinateSpace: "world" }, outputs: ["sp1"] },
    { id: "make_sp2", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["sp2"] },
    { id: "make_spring", operator: "polyline", inputs: { points: ["sp0", "sp1", "sp2"] }, outputs: ["spring"] },
    { id: "make_G", operator: "point", inputs: { x: 2.6, y: 0, coordinateSpace: "world" }, outputs: ["G"] },
    { id: "make_body", operator: "rectangle", inputs: { center: "G", width: 0.8, height: 0.7 }, outputs: ["body"] },
  ],
  relations: [],
  assertions: [{ id: "spring_exists", predicate: "exists", entities: ["spring"], expected: true, severity: "fatal" }],
  annotations: [],
  requiredEntityIds: ["sp0", "sp1", "sp2", "spring", "G", "body"],
  revealGroups: [
    { id: "setup", entityIds: ["sp0", "sp1", "sp2", "spring", "G", "body"], dependsOn: [], narrationCue: "spring" },
  ],
  teachingTimeline: [],
};

const coil = compile(coilFixture);
assert(pointMarks(coil.primitives, "sp0").length === 0, "spring coil vertices must not draw balls");
assert(pointMarks(coil.primitives, "sp1").length === 0, "spring coil vertices must not draw balls");
assert(pointMarks(coil.primitives, "sp2").length === 0, "spring coil vertices must not draw balls");
assert(pointMarks(coil.primitives, "G").length === 0, "unasked body-centre id G must not become a named point");
assert(!coil.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "G"), "G must not be inferred from the id alone");
assert(circles(coil.primitives).length === 0, "coil fixture must not grow open circles");
labelAttached(coil.primitives, "spring");
labelAttached(coil.primitives, "body");

const askedTriangle = compile({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "asked vertices stay marked" },
  source: { question: "Draw triangle ABC and mark the vertices." },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "vertex" },
    { id: "b", kind: "point", role: "vertex" },
    { id: "c", kind: "point", role: "vertex" },
    { id: "ab", kind: "segment", role: "side" },
    { id: "bc", kind: "segment", role: "side" },
    { id: "ca", kind: "segment", role: "side" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "world" }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["c"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    { id: "make_bc", operator: "segment", inputs: { start: "b", end: "c" }, outputs: ["bc"] },
    { id: "make_ca", operator: "segment", inputs: { start: "c", end: "a" }, outputs: ["ca"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["a", "b", "c", "ab", "bc", "ca"],
  revealGroups: [
    { id: "setup", entityIds: ["a", "b", "c", "ab", "bc", "ca"], dependsOn: [], narrationCue: "triangle" },
  ],
  teachingTimeline: [],
});
for (const [id, letter] of [["a", "A"], ["b", "B"], ["c", "C"]] as const) {
  assert(pointMarks(askedTriangle.primitives, id).length === 1, `asked vertex ${letter} must receive a point mark`);
  assert(
    labelsFor(askedTriangle.primitives, id).some((primitive) => primitive.text === letter),
    `asked vertex ${id} must be labeled ${letter}`,
  );
  labelAttached(askedTriangle.primitives, id);
}

const opticsRoles = compile({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "conventional optics points stay marked" },
  source: { question: "A concave mirror forms an image of an object on the principal axis." },
  quantities: [],
  entities: [
    { id: "axis_l", kind: "point", role: "axis end" },
    { id: "axis_r", kind: "point", role: "axis end" },
    { id: "axis", kind: "segment", role: "principal axis" },
    { id: "F", kind: "point", role: "focal point" },
    { id: "C", kind: "point", role: "centre of curvature" },
    { id: "O", kind: "point", role: "object position" },
  ],
  constructions: [
    { id: "make_axis_l", operator: "point", inputs: { x: -4, y: 0, coordinateSpace: "world" }, outputs: ["axis_l"] },
    { id: "make_axis_r", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "world" }, outputs: ["axis_r"] },
    { id: "make_axis", operator: "segment", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] },
    { id: "make_F", operator: "point", inputs: { x: -1, y: 0, coordinateSpace: "world" }, outputs: ["F"] },
    { id: "make_C", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["C"] },
    { id: "make_O", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["axis_l", "axis_r", "axis", "F", "C", "O"],
  revealGroups: [
    { id: "setup", entityIds: ["axis_l", "axis_r", "axis", "F", "C", "O"], dependsOn: [], narrationCue: "axis" },
  ],
  teachingTimeline: [],
});
assert(pointMarks(opticsRoles.primitives, "axis_l").length === 0, "axis ends are construction helpers");
assert(pointMarks(opticsRoles.primitives, "axis_r").length === 0, "axis ends are construction helpers");
for (const [id, letter] of [["F", "F"], ["C", "C"], ["O", "O"]] as const) {
  assert(pointMarks(opticsRoles.primitives, id).length === 1, `${letter} must stay a visible point`);
  assert(
    labelsFor(opticsRoles.primitives, id).some((primitive) => primitive.text === letter),
    `${id} must keep label ${letter}`,
  );
}

const springLive = synthesizeFamilyScene({
  question: "A block of mass 2 kg attached to a spring of force constant 200 N/m oscillates with amplitude 0.1 m. Draw the setup.",
});
assert(Boolean(springLive?.renderScene), "spring_mass live path must compile");
const springPoints = pointMarks(springLive!.renderScene.primitives);
assert(
  springPoints.every((primitive) => !/^sp\d+$/.test(primitive.entityId)),
  `spring coil vertices leaked: ${springPoints.map((primitive) => primitive.entityId).join(",")}`,
);
assert(
  !springPoints.some((primitive) => /^(wall_|surface_|eq_)/.test(primitive.entityId)),
  `spring construction ends leaked: ${springPoints.map((primitive) => primitive.entityId).join(",")}`,
);
assert(
  !springLive!.renderScene.primitives.some((primitive) =>
    primitive.kind === "circle" && primitive.provenance && (primitive.provenance as { annotation?: string }).annotation === "endpoint"),
  "spring live path must not grow open endpoint circles",
);

const seriesLive = synthesizeFamilyScene({
  question: "Two resistors R1 and R2 in series with a junction between them. Draw the circuit.",
});
assert(Boolean(seriesLive?.renderScene), "series resistor live path must compile");
assert(
  !pointMarks(seriesLive!.renderScene.primitives).some((primitive) => /^n\d+$/.test(primitive.entityId)),
  "unnamed circuit nodes must not draw balls",
);
labelAttached(seriesLive!.renderScene.primitives, "R1");
labelAttached(seriesLive!.renderScene.primitives, "R2");

const alkene = synthesizeFamilyScene({
  question: "Draw the skeletal structure of trans-hex-3-ene.",
});
assert(Boolean(alkene?.renderScene), "trans-hex-3-ene must compile");
assert(pointMarks(alkene!.renderScene.primitives).length === 0, "skeletal carbons must stay unmarked");
assert(circles(alkene!.renderScene.primitives).length === 0, "trans-alkene must not grow stray circles");

console.log("verify-named-point-marks: ok");
