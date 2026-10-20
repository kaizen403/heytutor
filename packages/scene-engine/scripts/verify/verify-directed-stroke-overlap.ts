/**
 * Directed ink drawn on other ink (Video 3 "Relative Velocity", 20 Oct 2026,
 * and the v1, v2 recordings): a shaft running past its head, stacked heads, a
 * vector that vanished, stray helper dots on an arrow, a badge on its own
 * target line carrying `u_p=0`, a velocity drawn 14 px long, point names
 * beside another mark, and triangle labels inside the triangle.
 *
 * 1. Recorded replay (fixtures/directed-stroke-overlap-recorded.json, written
 *    by scripts/extract-recorded-scene-documents.ts): every document that
 *    compiles draws every required vector, no directed stroke lies along
 *    other ink for 12 px or more (so no head sits inside another stroke and
 *    no helper runs past a head), no unnamed dot sits on a shaft, and no
 *    vector shaft is under 40 px except the operators listed below.
 * 2. The named recordings, checked one by one.
 * 3. Synthetic documents for each mechanism.
 *
 * Every failure is collected, so a run on the old engine lists each fix that
 * is missing.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-directed-stroke-overlap.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileSceneDocument, normalizeVerifiedPartsInputs, pruneDeadSceneEntities, validateSceneDocument,
  type RenderPoint, type RenderPrimitive, type SceneDocument, type SceneIssue,
} from "../../src/index";
import { validateLabelOwnerTruth } from "../../src/compile/labelOwnerTruth";
import { auditDirectedStrokes, collinearOverlap, READABLE_SHAFT_PX } from "./directedStrokeAudit";

const here = dirname(fileURLToPath(import.meta.url));
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void { checks += 1; if (!condition) failures.push(message); }

type Raw = Record<string, unknown>;
interface Recorded { id: string; question: string; document: Raw }
interface Replay { stage: "validate" | "compile" | "ok"; issues: SceneIssue[]; document: SceneDocument | null; primitives: RenderPrimitive[] }

function replay(recorded: Pick<Recorded, "question" | "document">): Replay {
  const raw = structuredClone(recorded.document);
  const source = typeof raw.source === "object" && raw.source !== null ? raw.source as Raw : {};
  raw.source = { ...source, question: typeof source.question === "string" ? source.question : recorded.question };
  const normalized = normalizeVerifiedPartsInputs(raw, false).candidate;
  const validated = validateSceneDocument(pruneDeadSceneEntities(normalized));
  if (!validated.document) return { stage: "validate", issues: validated.report.issues, document: null, primitives: [] };
  const compiled = compileSceneDocument(validated.document);
  const issues = [...validated.report.issues, ...compiled.report.issues];
  if (!compiled.ok || !compiled.renderScene) return { stage: "compile", issues, document: validated.document, primitives: [] };
  return { stage: "ok", issues, document: validated.document, primitives: compiled.renderScene.primitives };
}
function compileDocument(document: Raw): Replay { return replay({ question: "", document }); }
const fatal = (result: Replay) => result.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`);
const stroke = (result: Replay, entityId: string) => result.primitives.find((primitive) => primitive.entityId === entityId && (primitive.kind === "vector" || primitive.kind === "ray"));
const len = (a: RenderPoint, b: RenderPoint) => Math.hypot(b.x - a.x, b.y - a.y);

// ------------------------------------------------------------ 1. recorded replay
const recorded = JSON.parse(readFileSync(join(here, "fixtures/directed-stroke-overlap-recorded.json"), "utf8")) as Recorded[];
check(recorded.length >= 40, `expected the recorded fixtures, found ${recorded.length}`);
const byId = new Map(recorded.map((document) => [document.id, document]));
/** A sign badge carrying a body's value is refused with a repair, not drawn on the wrong body. */
const REFUSED_BADGE_VALUE = new Set(["v3/p1e2-t1#6"]);
/**
 * Short shafts the display scale does not reach yet: a component from
 * vector_components and a trajectory_state velocity follow their source
 * vector's scale. Listed so a new one fails.
 */
const SHORT_SHAFT_ALLOWED = new Set(["v1/p3c-t1#5:downhill", "v2/p3e2-t2#7:landing_velocity"]);
let compiledCount = 0;
for (const document of recorded) {
  const result = replay(document);
  if (REFUSED_BADGE_VALUE.has(document.id)) {
    check(result.stage === "validate" && result.issues.some((issue) => issue.code === "sign_badge_binds_quantity" && issue.severity === "fatal"),
      `${document.id}: a sign badge labelled with a body's value must be refused with sign_badge_binds_quantity, got ${result.stage}: ${fatal(result).join(" | ")}`);
    continue;
  }
  check(result.stage === "ok", `${document.id}: must still compile, stopped at ${result.stage}: ${fatal(result).join(" | ")}`);
  if (result.stage !== "ok" || !result.document) continue;
  compiledCount += 1;
  const audit = auditDirectedStrokes(result.document, result.primitives);
  check(audit.missing.length === 0, `${document.id}: required vectors not drawn: ${audit.missing.join(", ")}`);
  for (const overlap of audit.overlaps) {
    check(false, `${document.id}: ${overlap.directed} lies along ${overlap.other} for ${overlap.overlapPx} px${overlap.runsPastHead ? " and the stroke runs past its head" : ""}`);
  }
  for (const dot of audit.dotsOnVector) check(false, `${document.id}: unnamed point ${dot.point} is drawn as a dot on ${dot.vector}`);
  for (const short of audit.shortShafts) {
    check(SHORT_SHAFT_ALLOWED.has(`${document.id}:${short.entity}`), `${document.id}: ${short.entity} is ${short.lengthPx} px long, under ${READABLE_SHAFT_PX} px`);
  }
}
check(compiledCount >= 40, `expected at least 40 recorded documents to compile, got ${compiledCount}`);

// ------------------------------------------------------------ 2. named recordings
function recordedResult(id: string): Replay {
  const document = byId.get(id);
  check(document, `fixture ${id} is missing`);
  return document ? replay(document) : { stage: "validate", issues: [], document: null, primitives: [] };
}
function insideTriangle(p: RenderPoint, [a, b, c]: RenderPoint[]): boolean {
  const side = (u: RenderPoint, v: RenderPoint) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const s1 = side(a!, b!); const s2 = side(b!, c!); const s3 = side(c!, a!);
  return (s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0);
}
function labelCenter(result: Replay, entityId: string): RenderPoint | undefined {
  const label = result.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === entityId);
  const box = label?.provenance?.labelBounds as { x: number; y: number; width: number; height: number } | undefined;
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : label?.points[0];
}

// v2 p1c-t3: the A to B arrow was aliased to the track through A and B and never drawn.
{
  const result = recordedResult("v2/p1c-t3#5");
  const outbound = stroke(result, "outbound"); const back = stroke(result, "return"); const track = result.primitives.find((primitive) => primitive.entityId === "track");
  check(outbound && back, "v2 p1c-t3: both the A to B and the B to C arrows are drawn");
  if (outbound && back && track) {
    const sideOf = (p: RenderPoint) => Math.sign(p.y - track.points[0]!.y);
    check(sideOf(outbound.points[0]!) !== 0 && sideOf(back.points[0]!) !== 0 && sideOf(outbound.points[0]!) !== sideOf(back.points[0]!),
      "v2 p1c-t3: the outbound and return legs sit in lanes on either side of the track");
    const at = (id: string) => result.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === id)?.points[0];
    const [a, b] = [at("A"), at("B")];
    check(a && b && Math.abs(len(outbound.points[0]!, outbound.points[1]!) - len(a, b)) < 0.5, "v2 p1c-t3: the A to B arrow keeps the full length A to B");
  }
}
// v3 p3e2-t1: the north reference ran past the closing side; the triangle's labels sat inside it.
{
  const result = recordedResult("v3/p3e2-t1#4");
  const ground = stroke(result, "v_ground"); const air = stroke(result, "v_air"); const wind = stroke(result, "v_wind"); const north = stroke(result, "north_ref");
  check(ground && air && wind && north, "v3 p3e2-t1: the triangle and the north reference are drawn");
  if (ground && air && wind && north) {
    check(len(ground.points[1]!, wind.points[1]!) < 1 && len(ground.points[0]!, air.points[0]!) < 1, "v3 p3e2-t1: v_ground still closes the triangle (tail at the plane, head at the apex)");
    const overlap = collinearOverlap({ a: ground.points[0]!, b: ground.points[1]! }, { a: north.points[0]!, b: north.points[1]! });
    check(!overlap || overlap.overlap < 12, "v3 p3e2-t1: the north reference does not run along v_ground past its head");
    const triangle = [air.points[0]!, air.points[1]!, wind.points[1]!];
    for (const id of ["v_air", "v_wind", "v_ground"]) {
      const at = labelCenter(result, id);
      check(at && !insideTriangle(at, triangle), `v3 p3e2-t1: the ${id} label sits outside the vector triangle, got ${JSON.stringify(at)}`);
    }
  }
}
// v3 p3c-t2: vert_line ran 230 px along v_rain and past its head; the umbrella's ends were dots on v_rel.
{
  const result = recordedResult("v3/p3c-t2#4");
  check(!result.primitives.some((primitive) => primitive.kind === "point" && (primitive.entityId === "umbrella_top" || primitive.entityId === "umbrella_bottom")),
    "v3 p3c-t2: the umbrella's unnamed end points are not drawn as dots on v_rel");
  const rain = stroke(result, "v_rain"); const vertical = result.primitives.find((primitive) => primitive.entityId === "vert_line");
  if (rain && vertical) {
    const overlap = collinearOverlap({ a: rain.points[0]!, b: rain.points[1]! }, { a: vertical.points[0]!, b: vertical.points[1]! });
    check(!overlap || overlap.overlap < 12, "v3 p3c-t2: v_rain is not drawn along the vertical reference");
    check(Math.abs(len(rain.points[0]!, rain.points[1]!) - 230) < 1, "v3 p3c-t2: v_rain keeps its full length in its lane");
  }
}
// v3 p4c-t1: 4 m/s and 3 m/s in a 60 m frame were 14 and 11 px; "A" sat beside the head of v_A.
{
  const result = recordedResult("v3/p4c-t1#6");
  const vA = stroke(result, "vA"); const vB = stroke(result, "vB");
  check(vA && vB, "v3 p4c-t1: both velocities are drawn");
  if (vA && vB) {
    const a = len(vA.points[0]!, vA.points[1]!); const b = len(vB.points[0]!, vB.points[1]!);
    check(Math.min(a, b) >= READABLE_SHAFT_PX, `v3 p4c-t1: velocity shafts are readable (${a.toFixed(1)}, ${b.toFixed(1)} px)`);
    check(Math.abs(a / b - 4 / 3) < 0.02, `v3 p4c-t1: v_A and v_B stay proportional 4:3, got ${(a / b).toFixed(3)}`);
    check(Math.abs(vA.points[1]!.y - vA.points[0]!.y) < 0.01 && vA.points[1]!.x > vA.points[0]!.x, "v3 p4c-t1: v_A points exactly east");
    check(Math.abs(vB.points[1]!.x - vB.points[0]!.x) < 0.01 && vB.points[1]!.y > vB.points[0]!.y, "v3 p4c-t1: v_B points exactly south");
    check(vA.provenance?.displayLengthScale !== undefined, "v3 p4c-t1: the display scale is recorded on the vector");
  }
}
// Point names beside the wrong mark (p4c-t1, p4e1-t2) are gated in verify-label-owner-placement.
// v3 p2e2-t1 and p4e1-t2: vectors drawn on the crossing line, the bank and the separation.
{
  const result = recordedResult("v3/p2e2-t1#5");
  for (const id of ["v_boat", "v_current"]) {
    const vector = stroke(result, id);
    check(vector?.provenance?.directedLane, `v3 p2e2-t1: ${id} is drawn in a lane beside the line it ran along`);
  }
}
// v1 p2c-t1: -B shares B's segment in the opposite sense and was dropped.
{
  const result = recordedResult("v1/p2c-t1#3");
  check(stroke(result, "negB") && stroke(result, "B"), "v1 p2c-t1: B and -B are both drawn");
}

// ------------------------------------------------------------ 3. synthetic mechanisms
const DEG = Math.PI / 180;
function scene(parts: { entities: Raw[]; constructions: Raw[]; annotations?: Raw[]; assertions?: Raw[]; quantities?: Raw[] }, question = "Draw the figure."): Raw {
  const ids = parts.entities.map((entity) => entity.id as string);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "directed ink" }, source: { question },
    quantities: parts.quantities ?? [], entities: parts.entities, constructions: parts.constructions, relations: [],
    assertions: parts.assertions ?? [], annotations: parts.annotations ?? [], requiredEntityIds: ids,
    revealGroups: [{ id: "figure", entityIds: ids, dependsOn: [], narrationCue: "figure" }], teachingTimeline: [],
  };
}
const point = (id: string, x: number, y: number, label?: string) => ({
  entity: { id, kind: "point", role: "point", ...(label ? { label } : {}) },
  construction: { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] },
});
function withPoints(points: ReturnType<typeof point>[], entities: Raw[], constructions: Raw[], extra: Partial<Parameters<typeof scene>[0]> = {}): Raw {
  return scene({ entities: [...points.map((p) => p.entity), ...entities], constructions: [...points.map((p) => p.construction), ...constructions], ...extra });
}

// 3a. A vector A to B on the infinite line through A and B is drawn, beside the line.
{
  const result = compileDocument(withPoints([point("A", 0, 0, "A"), point("B", 10, 0, "B")],
    [{ id: "track", kind: "line", role: "track" }, { id: "AB", kind: "vector", role: "path A to B" }],
    [{ id: "make_track", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["track"] }, { id: "make_AB", operator: "vector", inputs: { start: "A", end: "B" }, outputs: ["AB"] }]));
  const vector = stroke(result, "AB");
  check(result.stage === "ok" && vector, `synthetic: a vector on its supporting line is drawn: ${fatal(result).join(" | ")}`);
  if (result.stage === "ok" && result.document) check(auditDirectedStrokes(result.document, result.primitives).overlaps.length === 0, "synthetic: the vector on its line sits in its own lane");
}
// 3b. A reference segment longer than a vector from the same tail never runs past the head.
for (const angle of [0, 90, 37]) {
  const ux = Math.cos(angle * DEG); const uy = Math.sin(angle * DEG);
  const result = compileDocument(withPoints([point("O", 0, 0, "O"), point("R", 10 * ux, 10 * uy), point("T", 6 * ux, 6 * uy)],
    [{ id: "ref", kind: "segment", role: "reference line" }, { id: "v", kind: "vector", role: "velocity", label: "v" }],
    [{ id: "make_ref", operator: "segment", inputs: { start: "O", end: "R" }, outputs: ["ref"] }, { id: "make_v", operator: "vector", inputs: { start: "O", end: "T" }, outputs: ["v"] }]));
  check(result.stage === "ok", `synthetic ${angle}°: compiles: ${fatal(result).join(" | ")}`);
  if (result.stage === "ok" && result.document) {
    const audit = auditDirectedStrokes(result.document, result.primitives);
    check(audit.overlaps.length === 0 && audit.runPast.length === 0, `synthetic ${angle}°: the reference does not run along the vector or past its head: ${JSON.stringify(audit.overlaps)}`);
    const vector = stroke(result, "v")!;
    const ref = result.primitives.find((primitive) => primitive.entityId === "ref")!;
    const refLength = len(ref.points[0]!, ref.points[1]!);
    check(Math.abs(len(vector.points[0]!, vector.points[1]!) / refLength - 0.6) < 0.01, `synthetic ${angle}°: the vector keeps its full length`);
    const cross = (vector.points[1]!.x - vector.points[0]!.x) * (ref.points[1]!.y - ref.points[0]!.y) - (vector.points[1]!.y - vector.points[0]!.y) * (ref.points[1]!.x - ref.points[0]!.x);
    check(Math.abs(cross) / (refLength * len(vector.points[0]!, vector.points[1]!)) < 1e-3, `synthetic ${angle}°: the vector keeps its exact direction`);
  }
}
// 3c. B and -B on one segment are two marks.
{
  const result = compileDocument(withPoints([point("O", 0, 0, "O"), point("S", 3, 4)],
    [{ id: "B", kind: "vector", role: "vector", label: "B" }, { id: "negB", kind: "vector", role: "vector", label: "-B" }],
    [{ id: "make_B", operator: "vector", inputs: { start: "O", end: "S" }, outputs: ["B"] }, { id: "make_negB", operator: "vector", inputs: { start: "S", end: "O" }, outputs: ["negB"] }]));
  check(result.stage === "ok" && stroke(result, "B") && stroke(result, "negB"), `synthetic: B and -B are both drawn: ${fatal(result).join(" | ")}`);
}
// 3d. A sign badge sits beside its target line, not on it.
{
  const result = compileDocument(withPoints([point("a", 0, 0), point("b", 10, 0)],
    [{ id: "axis", kind: "segment", role: "reference" }, { id: "badge", kind: "sign_badge", role: "positive direction", label: "+x" }],
    [{ id: "make_axis", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["axis"] }, { id: "make_badge", operator: "sign_badge", inputs: { target: "axis", sense: "positive", at: 0.5 }, outputs: ["badge"] }]));
  check(result.stage === "ok", `synthetic badge compiles: ${fatal(result).join(" | ")}`);
  const axis = result.primitives.find((primitive) => primitive.entityId === "axis");
  const shaft = result.primitives.find((primitive) => primitive.entityId === "badge");
  if (axis && shaft) check(Math.abs(shaft.points[0]!.y - axis.points[0]!.y) >= 10, `synthetic: the badge shaft sits beside its axis, ${Math.abs(shaft.points[0]!.y - axis.points[0]!.y).toFixed(1)} px off it`);
}
// 3e. A badge carrying a body's value is refused with a repair that names a label on the body.
for (const [label, annotation] of [["u_p=0", undefined], ["0", undefined], [undefined, "u = 0 m/s"]] as const) {
  const document = withPoints([point("a", 0, 0), point("b", 10, 0)],
    [{ id: "axis", kind: "segment", role: "road" }, { id: "badge", kind: "sign_badge", role: "starts from rest", ...(label ? { label } : {}) }],
    [{ id: "make_axis", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["axis"] }, { id: "make_badge", operator: "sign_badge", inputs: { target: "axis", sense: "positive" }, outputs: ["badge"] }],
    annotation ? { annotations: [{ id: "ann", kind: "label", targetIds: ["badge"], text: annotation }] } : {});
  const issue = validateSceneDocument(document).report.issues.find((candidate) => candidate.code === "sign_badge_binds_quantity");
  check(issue?.severity === "fatal" && /"kind":"label"/.test(issue.message) && /body/.test(issue.message), `synthetic: a badge with ${label ?? annotation} is refused with a repair naming a label on the body: ${issue?.message}`);
}
for (const label of ["+", "+x", "east +"]) {
  const document = withPoints([point("a", 0, 0), point("b", 10, 0)],
    [{ id: "axis", kind: "segment", role: "road" }, { id: "badge", kind: "sign_badge", role: "positive direction", label }],
    [{ id: "make_axis", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["axis"] }, { id: "make_badge", operator: "sign_badge", inputs: { target: "axis", sense: "positive" }, outputs: ["badge"] }]);
  check(!validateSceneDocument(document).report.issues.some((issue) => issue.code === "sign_badge_binds_quantity"), `synthetic: a direction badge "${label}" stays valid`);
}
// 3f. A velocity in a length frame gets a readable display length; a displacement does not.
function frame(length: number, unit: string, extra: Partial<{ usedElsewhere: boolean }> = {}): Replay {
  return compileDocument(withPoints([point("O", 0, 0, "O"), point("P", 0, 60, "P"), point("F", 60, 0)],
    [{ id: "sep", kind: "segment", role: "separation" }, { id: "ground", kind: "segment", role: "ground" }, { id: "v", kind: "vector", role: "motion" },
      ...(extra.usedElsewhere ? [{ id: "w", kind: "vector", role: "scaled copy" }] : [])],
    [{ id: "make_sep", operator: "segment", inputs: { start: "O", end: "P" }, outputs: ["sep"] }, { id: "make_ground", operator: "segment", inputs: { start: "O", end: "F" }, outputs: ["ground"] },
      { id: "make_v", operator: "vector", inputs: { start: "P", direction: [1, 0], length }, outputs: ["v"] },
      ...(extra.usedElsewhere ? [{ id: "make_w", operator: "vector_scale", inputs: { vector: "v", factor: 2, origin: "O" }, outputs: ["w"] }] : [])],
    { annotations: [{ id: "v_label", kind: "label", targetIds: ["v"], text: `v = ${length} ${unit}` }] }));
}
{
  const velocity = frame(4, "m/s");
  const v = stroke(velocity, "v");
  check(velocity.stage === "ok" && v && len(v.points[0]!, v.points[1]!) >= READABLE_SHAFT_PX, `synthetic: 4 m/s in a 60 m frame is readable, got ${v ? len(v.points[0]!, v.points[1]!).toFixed(1) : "none"} px: ${fatal(velocity).join(" | ")}`);
  if (v) check(Math.abs(v.points[1]!.y - v.points[0]!.y) < 0.01 && v.points[1]!.x > v.points[0]!.x, "synthetic: the rescaled velocity keeps its exact direction");
  const displacement = frame(4, "m");
  const d = stroke(displacement, "v");
  check(d && d.provenance?.displayLengthScale === undefined, "synthetic: a 4 m displacement in a 60 m frame keeps its true length");
}

// 3g. The owner truth check judges point names strictly: "A" beside the head
// of a vector drawn from A is recorded (a warning; placement ranks it last).
{
  const document = withPoints([point("A", 0, 0, "A"), point("T", 4, 0)], [{ id: "v", kind: "vector", role: "velocity" }],
    [{ id: "make_v", operator: "vector", inputs: { start: "A", end: "T" }, outputs: ["v"] }]) as unknown as SceneDocument;
  const label = (x: number, y: number): RenderPrimitive => ({ id: "primitive_A_label", entityId: "A", groupId: "figure", kind: "label", text: "A", points: [{ x, y }],
    provenance: { labelBounds: { x: x - 6, y: y - 8, width: 12, height: 16 } } });
  const ink: RenderPrimitive[] = [
    { id: "primitive_A", entityId: "A", groupId: "figure", kind: "point", points: [{ x: 500, y: 400 }] },
    { id: "primitive_v", entityId: "v", groupId: "figure", kind: "vector", points: [{ x: 500, y: 400 }, { x: 540, y: 400 }] },
  ];
  const nearHead = validateLabelOwnerTruth(document, [...ink, label(548, 376)]);
  check(nearHead.some((issue) => issue.code === "point_name_nearer_foreign" && issue.severity === "warning"), `owner truth: "A" beside v's head is recorded: ${JSON.stringify(nearHead)}`);
  const besidePoint = validateLabelOwnerTruth(document, [...ink, label(484, 384)]);
  check(!besidePoint.some((issue) => issue.code === "point_name_nearer_foreign"), "owner truth: \"A\" beside its point and the vector's tail passes");
}

// ------------------------------------------------------------ report
if (failures.length) {
  console.error(`verify-directed-stroke-overlap: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`verify-directed-stroke-overlap: ${recorded.length} recorded documents (${compiledCount} compiled), ${checks} checks passed`);
