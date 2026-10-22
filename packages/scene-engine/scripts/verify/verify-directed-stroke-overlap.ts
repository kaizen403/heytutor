/**
 * Directed ink drawn on other ink (Video 3 "Relative Velocity", 20 Oct 2026,
 * and the v1, v2 recordings): a shaft running past its head, stacked heads, a
 * vector that vanished, stray helper dots on an arrow, a badge on its own
 * target line carrying `u_p=0`, a velocity drawn 14 px long, point names
 * beside another mark, and triangle labels inside the triangle.
 *
 * 1. Recorded replay (fixtures/directed-stroke-overlap-recorded.json, written
 *    by scripts/extract-recorded-scene-documents.ts): every document that
 *    compiles draws every required vector, a lane never detaches a vector end
 *    from another vector end it met, a directed stroke lies along other ink
 *    for 12 px or more only where a vector is pinned by such a junction (the
 *    count is printed), no unnamed dot sits on a shaft, the display
 *    scale lifts exactly the listed vectors, and every shaft under 40 px is
 *    listed with the reason its unit group keeps its true length.
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
import { canonicalVectorUnit } from "../../src/compile/vectorDisplayScale";
import { auditDirectedStrokes, collinearOverlap, READABLE_SHAFT_PX } from "./directedStrokeAudit";

const here = dirname(fileURLToPath(import.meta.url));
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void { checks += 1; if (!condition) failures.push(message); }

type Raw = Record<string, unknown>;
interface Recorded { id: string; question: string; document: Raw }
interface Replay { stage: "validate" | "compile" | "ok"; issues: SceneIssue[]; document: SceneDocument | null; primitives: RenderPrimitive[] }

function replay(recorded: Pick<Recorded, "question" | "document">, lanes = true): Replay {
  const raw = structuredClone(recorded.document);
  const source = typeof raw.source === "object" && raw.source !== null ? raw.source as Raw : {};
  raw.source = { ...source, question: typeof source.question === "string" ? source.question : recorded.question };
  const normalized = normalizeVerifiedPartsInputs(raw, false).candidate;
  const validated = validateSceneDocument(pruneDeadSceneEntities(normalized));
  if (!validated.document) return { stage: "validate", issues: validated.report.issues, document: null, primitives: [] };
  const compiled = compileSceneDocument(validated.document, lanes ? {} : { directedLanes: false } as Parameters<typeof compileSceneDocument>[1]);
  const issues = [...validated.report.issues, ...compiled.report.issues];
  if (!compiled.ok || !compiled.renderScene) return { stage: "compile", issues, document: validated.document, primitives: [] };
  return { stage: "ok", issues, document: validated.document, primitives: compiled.renderScene.primitives };
}
function compileDocument(document: Raw): Replay { return replay({ question: "", document }); }
const fatal = (result: Replay) => result.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`);
const stroke = (result: Replay, entityId: string) => result.primitives.find((primitive) => primitive.entityId === entityId && (primitive.kind === "vector" || primitive.kind === "ray"));
const len = (a: RenderPoint, b: RenderPoint) => Math.hypot(b.x - a.x, b.y - a.y);

const JUNCTION_PX = 1.5;
/** Each vector's drawn [tail, head]. */
function vectorEnds(document: SceneDocument, primitives: RenderPrimitive[]): Map<string, [RenderPoint, RenderPoint]> {
  const vectors = new Set(document.entities.filter((entity) => entity.kind === "vector").map((entity) => entity.id));
  return new Map(primitives
    .filter((primitive) => primitive.kind === "vector" && primitive.points.length === 2 && primitive.id === `primitive_${primitive.entityId}` && vectors.has(primitive.entityId))
    .map((primitive) => [primitive.entityId, [primitive.points[0]!, primitive.points[1]!]]));
}
/** Pairs of vector ends drawn at one point. */
function vectorJunctions(document: SceneDocument, primitives: RenderPrimitive[]): Array<{ a: string; aEnd: 0 | 1; b: string; bEnd: 0 | 1 }> {
  const ends = [...vectorEnds(document, primitives)];
  const out: Array<{ a: string; aEnd: 0 | 1; b: string; bEnd: 0 | 1 }> = [];
  for (const [i, [a, aPoints]] of ends.entries()) {
    for (const [b, bPoints] of ends.slice(i + 1)) {
      for (const aEnd of [0, 1] as const) for (const bEnd of [0, 1] as const) {
        if (len(aPoints[aEnd], bPoints[bEnd]) <= JUNCTION_PX) out.push({ a, aEnd, b, bEnd });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ 1. recorded replay
const recorded = JSON.parse(readFileSync(join(here, "fixtures/directed-stroke-overlap-recorded.json"), "utf8")) as Recorded[];
check(recorded.length >= 40, `expected the recorded fixtures, found ${recorded.length}`);
const byId = new Map(recorded.map((document) => [document.id, document]));
/** A sign badge carrying a body's value is refused with a repair, not drawn on the wrong body. */
const REFUSED_BADGE_VALUE = new Set(["v3/p1e2-t1#6"]);
/**
 * Vectors the display scale lifts. A unit group is scaled whole or not at
 * all, so a vector that loses its factor (or a new one that gains it) fails.
 */
const DISPLAY_SCALED = new Set([
  "v2/p3e2-t1#6:up_velocity", "v2/p3e2-t1#6:gravity", "v2/p3e2-t2#7:gravity", "v2/p5e2-t1#4:initial_velocity",
]);
/**
 * Short shafts kept at their true length, reported rather than hidden. Each is
 * in a unit group the display scale declines: a component that follows its
 * source vector, a velocity group with a trajectory_state velocity in it
 * (v2 p3e2-t2), velocities drawn on axes (v3 p4c-t1), and velocities beside
 * a vector whose unit cannot be read (v3 p1e1-t1: the "+x east" arrow could be
 * a velocity for all the engine can tell, so nothing is enlarged).
 */
const SHORT_TRUE_LENGTH = new Map([
  ["v1/p3c-t1#5:downhill", "a vector_components component follows its source vector"],
  ["v2/p3e2-t2#7:initial_velocity", "its m/s group holds the trajectory_state landing velocity"],
  ["v2/p3e2-t2#7:landing_velocity", "a trajectory_state velocity, not free"],
  ["v3/p4c-t1#6:vA", "the figure has axes"],
  ["v3/p4c-t1#6:vB", "the figure has axes"],
  ["v3/p1e1-t1#6:vB", "the \"+x east\" vector has no readable unit, so no vector is rescaled"],
  ["yt/q14-t2#5:west", "a direction reference with no unit, drawn at its true 1 m in a 75 m frame"],
]);
const scaledSeen = new Set<string>();
const shortSeen: string[] = [];
const overlapsSeen: string[] = [];
let overlapsUnlaned = 0;
let junctionCount = 0;
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
  // A named stroke is never trimmed: its name ("50 km", "w = 240 m") would
  // sit on a stub that no longer spans what it names, beside the vector.
  for (const primitive of result.primitives) {
    if (primitive.provenance?.trimmedOffVector === undefined) continue;
    const named = Boolean(result.document.entities.find((entity) => entity.id === primitive.entityId)?.label?.trim()) ||
      result.document.annotations.some((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(primitive.entityId));
    check(!named, `${document.id}: the named stroke ${primitive.entityId} is trimmed off ${primitive.provenance.trimmedOffVector}, so its name no longer owns the piece it names`);
  }
  // A lane never detaches a vector from another vector it met (a tip to tail
  // sum, a triangle, components from one tail).
  const unlaned = replay(document, false);
  const junctions = vectorJunctions(result.document, unlaned.primitives);
  const laned = vectorEnds(result.document, result.primitives);
  for (const junction of junctions) {
    const [a, b] = [laned.get(junction.a)?.[junction.aEnd], laned.get(junction.b)?.[junction.bEnd]];
    check(a && b && len(a, b) <= JUNCTION_PX, `${document.id}: ${junction.a} ${junction.aEnd ? "head" : "tail"} lost its junction with ${junction.b} ${junction.bEnd ? "head" : "tail"} (${a && b ? len(a, b).toFixed(1) : "missing"} px apart)`);
  }
  junctionCount += junctions.length;
  // Directed ink left on other ink only where a vector is pinned by a junction.
  const pinnedVectors = new Set(junctions.flatMap((junction) => [junction.a, junction.b]));
  // A trace annotation is drawn along its target vector and follows it.
  const pinned = (id: string) => pinnedVectors.has(id) ||
    result.document!.annotations.some((annotation) => annotation.id === id && annotation.targetIds.some((target) => pinnedVectors.has(target)));
  for (const overlap of audit.overlaps) {
    overlapsSeen.push(`${document.id}:${overlap.directed}~${overlap.other}`);
    check(pinned(overlap.directed) || pinned(overlap.other), `${document.id}: ${overlap.directed} lies along ${overlap.other} for ${overlap.overlapPx} px${overlap.runsPastHead ? " and the stroke runs past its head" : ""}, and neither is pinned by a junction`);
  }
  overlapsUnlaned += auditDirectedStrokes(result.document, unlaned.primitives).overlaps.length;
  for (const dot of audit.dotsOnVector) check(false, `${document.id}: unnamed point ${dot.point} is drawn as a dot on ${dot.vector}`);
  for (const primitive of result.primitives) {
    if (primitive.kind === "vector" && primitive.provenance?.displayLengthScale !== undefined) scaledSeen.add(`${document.id}:${primitive.entityId}`);
  }
  for (const short of audit.shortShafts) {
    const key = `${document.id}:${short.entity}`;
    shortSeen.push(`${key} ${short.lengthPx} px`);
    check(SHORT_TRUE_LENGTH.has(key) && !scaledSeen.has(key), `${document.id}: ${short.entity} is ${short.lengthPx} px long, under ${READABLE_SHAFT_PX} px${scaledSeen.has(key) ? " after its display scale" : ", and no listed reason keeps it at its true length"}`);
  }
}
check(compiledCount >= 40, `expected at least 40 recorded documents to compile, got ${compiledCount}`);
for (const key of DISPLAY_SCALED) check(scaledSeen.has(key), `${key}: lost its display scale`);
for (const key of scaledSeen) check(DISPLAY_SCALED.has(key), `${key}: gained a display scale`);
for (const key of SHORT_TRUE_LENGTH.keys()) check(shortSeen.some((entry) => entry.startsWith(`${key} `)), `${key}: listed as a short true length shaft but is no longer short`);

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
// The B to C leg starts at its head, so neither leg moves off that junction.
{
  const result = recordedResult("v2/p1c-t3#5");
  const outbound = stroke(result, "outbound"); const back = stroke(result, "return");
  check(outbound && back, "v2 p1c-t3: both the A to B and the B to C arrows are drawn");
  if (outbound && back) {
    check(len(outbound.points[1]!, back.points[0]!) <= 1.5, "v2 p1c-t3: the return leg still starts at the outbound leg's head");
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
// v3 p4c-t1: 4 m/s and 3 m/s in a 60 m frame are 14 and 11 px. The figure has
// axes, which give the vectors a scale, so they keep their true length.
{
  const result = recordedResult("v3/p4c-t1#6");
  const vA = stroke(result, "vA"); const vB = stroke(result, "vB");
  check(vA && vB, "v3 p4c-t1: both velocities are drawn");
  if (vA && vB) {
    const a = len(vA.points[0]!, vA.points[1]!); const b = len(vB.points[0]!, vB.points[1]!);
    check(Math.abs(a / b - 4 / 3) < 0.02, `v3 p4c-t1: v_A and v_B stay proportional 4:3, got ${(a / b).toFixed(3)}`);
    check(Math.abs(vA.points[1]!.y - vA.points[0]!.y) < 0.01 && vA.points[1]!.x > vA.points[0]!.x, "v3 p4c-t1: v_A points exactly east");
    check(Math.abs(vB.points[1]!.x - vB.points[0]!.x) < 0.01 && vB.points[1]!.y > vB.points[0]!.y, "v3 p4c-t1: v_B points exactly south");
    check(vA.provenance?.displayLengthScale === undefined && vB.provenance?.displayLengthScale === undefined, "v3 p4c-t1: velocities on axes carry no display scale");
  }
}
// Point names beside the wrong mark (p4c-t1, p4e1-t2) are gated in verify-label-owner-placement.
// v3 p2e2-t1: v_boat ran along the crossing line, v_current along the bank.
// Both start at the boat with v_ground, so they stay; the crossing line is
// trimmed off v_boat, and the bank (running on past both ends) stays.
{
  const result = recordedResult("v3/p2e2-t1#5");
  const [boat, current, ground] = ["v_boat", "v_current", "v_ground"].map((id) => stroke(result, id));
  check(boat && current && ground && !boat.provenance?.directedLane && !current.provenance?.directedLane, "v3 p2e2-t1: the velocity triangle is drawn and not moved");
  if (boat && current && ground) check(len(boat.points[0]!, current.points[0]!) <= 1.5 && len(boat.points[0]!, ground.points[0]!) <= 1.5, "v3 p2e2-t1: the three velocities still share the boat's tail");
  const cross = result.primitives.find((primitive) => primitive.entityId === "cross_line" && primitive.kind === "line");
  if (boat && cross) {
    const overlap = collinearOverlap({ a: boat.points[0]!, b: boat.points[1]! }, { a: cross.points[0]!, b: cross.points[1]! });
    check(cross.provenance?.trimmedOffVector === "v_boat" && (!overlap || overlap.overlap < 12), "v3 p2e2-t1: the crossing line is trimmed off v_boat, not drawn under it");
  }
}
// A moved vector never loses a junction: v3 p2e1-t1 (resultant from the boat), yt q03 (the wind triangle).
for (const id of ["v3/p2e1-t1#7", "yt/q03-t1#5", "yt/q03-t2#4"]) {
  const result = recordedResult(id);
  check(result.stage === "ok" && result.document && vectorJunctions(result.document, result.primitives).length > 0, `${id}: the vector triangle keeps its junctions`);
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
// 3b'. A named reference under a pinned vector keeps its full length and its
// name; the same reference unnamed is trimmed off the vector.
for (const named of [true, false]) {
  const result = compileDocument(withPoints([point("O", 0, 0, "O"), point("R", 10, 0), point("T", 6, 0), point("U", 6, 4)],
    [{ id: "ref", kind: "segment", role: "reference line", ...(named ? { label: "road" } : {}) }, { id: "v", kind: "vector", role: "velocity", label: "v" }, { id: "w", kind: "vector", role: "velocity", label: "w" }],
    [{ id: "make_ref", operator: "segment", inputs: { start: "O", end: "R" }, outputs: ["ref"] }, { id: "make_v", operator: "vector", inputs: { start: "O", end: "T" }, outputs: ["v"] },
      { id: "make_w", operator: "vector", inputs: { start: "T", end: "U" }, outputs: ["w"] }]));
  const ref = result.primitives.find((primitive) => primitive.entityId === "ref" && primitive.kind === "line");
  const vector = stroke(result, "v");
  check(result.stage === "ok" && ref && vector, `synthetic trim ${named ? "named" : "unnamed"}: compiles: ${fatal(result).join(" | ")}`);
  if (ref && vector) {
    const full = Math.abs(len(ref.points[0]!, ref.points[1]!) - len(vector.points[0]!, vector.points[1]!) / 0.6) < 1;
    check(named ? full && ref.provenance?.trimmedOffVector === undefined : !full && ref.provenance?.trimmedOffVector === "v",
      `synthetic trim: the ${named ? "named reference keeps its full length" : "unnamed reference is trimmed off v"}`);
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
// 3f'. The display scale never breaks a vector sum or a proportion of one unit.
{
  // Tip to tail in a 60 m river: vc starts at its own point placed at vb's tip, vr = vb + vc.
  const result = compileDocument(withPoints([point("O", 0, 0, "O"), point("Q", 0, 5), point("R", 3, 5), point("bankL", -10, 60), point("bankR", 50, 60)],
    [{ id: "far_bank", kind: "segment", role: "far bank" }, { id: "vb", kind: "vector", role: "boat" }, { id: "vc", kind: "vector", role: "current" }, { id: "vr", kind: "vector", role: "resultant" }],
    [{ id: "make_far_bank", operator: "segment", inputs: { start: "bankL", end: "bankR" }, outputs: ["far_bank"] },
      { id: "make_vb", operator: "vector", inputs: { start: "O", direction: [0, 1], length: 5 }, outputs: ["vb"] },
      { id: "make_vc", operator: "vector", inputs: { start: "Q", direction: [1, 0], length: 3 }, outputs: ["vc"] },
      { id: "make_vr", operator: "vector", inputs: { start: "O", end: "R" }, outputs: ["vr"] }],
    { annotations: [{ id: "vb_label", kind: "label", targetIds: ["vb"], text: "v_b = 5 m/s" }, { id: "vc_label", kind: "label", targetIds: ["vc"], text: "v_c = 3 m s⁻¹" }, { id: "vr_label", kind: "label", targetIds: ["vr"], text: "v_r = 5.83 ms^-1" }] }));
  const [vb, vc, vr] = ["vb", "vc", "vr"].map((id) => stroke(result, id));
  check(result.stage === "ok" && vb && vc && vr, `synthetic river sum compiles: ${fatal(result).join(" | ")}`);
  if (vb && vc && vr) {
    check(len(vb.points[1]!, vc.points[0]!) < 0.5, `synthetic river sum: vc still starts at vb's tip (${len(vb.points[1]!, vc.points[0]!).toFixed(1)} px apart)`);
    check(len(vr.points[0]!, vb.points[0]!) < 0.5 && len(vr.points[1]!, vc.points[1]!) < 0.5, `synthetic river sum: vr = vb + vc is drawn exactly (head ${len(vr.points[1]!, vc.points[1]!).toFixed(1)} px off vc's tip)`);
  }
}
{
  // A parallelogram of forces keeps its diagonal and its sides.
  const result = compileDocument(withPoints([point("O", 0, 0, "O"), point("P1", 4, 0), point("P2", 0, 3), point("R", 4, 3), point("G1", -10, -60), point("G2", 50, -60)],
    [{ id: "ground", kind: "segment", role: "frame" }, { id: "F1", kind: "vector", role: "force" }, { id: "F2", kind: "vector", role: "force" }, { id: "F", kind: "vector", role: "resultant" },
      { id: "side1", kind: "segment", role: "parallelogram side" }, { id: "side2", kind: "segment", role: "parallelogram side" }],
    [{ id: "make_ground", operator: "segment", inputs: { start: "G1", end: "G2" }, outputs: ["ground"] },
      { id: "make_F1", operator: "vector", inputs: { start: "O", direction: [1, 0], length: 4 }, outputs: ["F1"] },
      { id: "make_F2", operator: "vector", inputs: { start: "O", direction: [0, 1], length: 3 }, outputs: ["F2"] },
      { id: "make_F", operator: "vector", inputs: { start: "O", end: "R" }, outputs: ["F"] },
      { id: "make_side1", operator: "segment", inputs: { start: "P1", end: "R" }, outputs: ["side1"] },
      { id: "make_side2", operator: "segment", inputs: { start: "P2", end: "R" }, outputs: ["side2"] }],
    { annotations: [{ id: "F1_label", kind: "label", targetIds: ["F1"], text: "F_1 = 4 N" }, { id: "F2_label", kind: "label", targetIds: ["F2"], text: "F_2 = 3 N" }, { id: "F_label", kind: "label", targetIds: ["F"], text: "F = 5 N" }] }));
  const [f1, f2, f] = ["F1", "F2", "F"].map((id) => stroke(result, id));
  check(result.stage === "ok" && f1 && f2 && f, `synthetic parallelogram compiles: ${fatal(result).join(" | ")}`);
  if (f1 && f2 && f) {
    const sum = { x: f1.points[1]!.x + f2.points[1]!.x - f1.points[0]!.x, y: f1.points[1]!.y + f2.points[1]!.y - f1.points[0]!.y };
    check(len(sum, f.points[1]!) < 0.5, `synthetic parallelogram: the diagonal is F1 + F2 (${len(sum, f.points[1]!).toFixed(1)} px off)`);
    const side1 = result.primitives.find((primitive) => primitive.entityId === "side1");
    check(side1 && len(side1.points[0]!, f1.points[1]!) < 0.5, "synthetic parallelogram: the side starts at F1's tip");
  }
}
{
  // One unit in three spellings is one group: 4 m/s and 3 ms⁻¹ stay 4:3.
  const result = compileDocument(withPoints([point("A", 0, 0, "A"), point("B", 0, 60, "B"), point("F", 60, 0)],
    [{ id: "sep", kind: "segment", role: "separation" }, { id: "ground", kind: "segment", role: "ground" }, { id: "vA", kind: "vector", role: "velocity" }, { id: "vB", kind: "vector", role: "velocity" }],
    [{ id: "make_sep", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["sep"] }, { id: "make_ground", operator: "segment", inputs: { start: "A", end: "F" }, outputs: ["ground"] },
      { id: "make_vA", operator: "vector", inputs: { start: "A", direction: [1, 1], length: 4 }, outputs: ["vA"] },
      { id: "make_vB", operator: "vector", inputs: { start: "B", direction: [1, -1], length: 3 }, outputs: ["vB"] }],
    { annotations: [{ id: "vA_label", kind: "label", targetIds: ["vA"], text: "v_A = 4 m/s" }, { id: "vB_label", kind: "label", targetIds: ["vB"], text: "v_B = 3 ms⁻¹" }] }));
  const [vA, vB] = ["vA", "vB"].map((id) => stroke(result, id));
  if (vA && vB) {
    const ratio = len(vA.points[0]!, vA.points[1]!) / len(vB.points[0]!, vB.points[1]!);
    check(Math.abs(ratio - 4 / 3) < 0.02 && vA.provenance?.displayLengthScale !== undefined, `synthetic spellings: 4 m/s and 3 ms⁻¹ share one display factor, ratio ${ratio.toFixed(3)}`);
  } else check(false, `synthetic spellings compiles: ${fatal(result).join(" | ")}`);
  for (const spelling of ["m/s", "ms⁻¹", "m s^-1", "m·s⁻¹", "m s⁻¹", "m/sec"]) check(canonicalVectorUnit(spelling) === "m/s", `canonicalVectorUnit(${spelling}) is m/s, got ${canonicalVectorUnit(spelling)}`);
  for (const spelling of ["m/s²", "m s⁻²", "ms^-2"]) check(canonicalVectorUnit(spelling) === "m/s²", `canonicalVectorUnit(${spelling}) is m/s², got ${canonicalVectorUnit(spelling)}`);
}
{
  // A vector whose unit cannot be read may share the other's unit, so the
  // group scales whole or not at all: v_A = 4 m/s beside 3 m/s or a bare v_B
  // stays 4:3 (it was drawn 2.248:1 when only v_A was enlarged).
  const pair = (vBLabel: string) => compileDocument(withPoints([point("A", 0, 0, "A"), point("B", 0, 60, "B"), point("F", 60, 0)],
    [{ id: "sep", kind: "segment", role: "separation" }, { id: "ground", kind: "segment", role: "ground" }, { id: "vA", kind: "vector", role: "velocity" }, { id: "vB", kind: "vector", role: "velocity" }],
    [{ id: "make_sep", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["sep"] }, { id: "make_ground", operator: "segment", inputs: { start: "A", end: "F" }, outputs: ["ground"] },
      { id: "make_vA", operator: "vector", inputs: { start: "A", direction: [1, 0], length: 4 }, outputs: ["vA"] },
      { id: "make_vB", operator: "vector", inputs: { start: "B", direction: [1, 0], length: 3 }, outputs: ["vB"] }],
    { annotations: [{ id: "vA_label", kind: "label", targetIds: ["vA"], text: "v_A = 4 m/s" }, { id: "vB_label", kind: "label", targetIds: ["vB"], text: vBLabel }] }));
  for (const [vBLabel, scaled] of [["3 m/s", true], ["v_B", false]] as const) {
    const result = pair(vBLabel);
    const [vA, vB] = ["vA", "vB"].map((id) => stroke(result, id));
    if (result.stage === "ok" && vA && vB) {
      const ratio = len(vA.points[0]!, vA.points[1]!) / len(vB.points[0]!, vB.points[1]!);
      check(Math.abs(ratio - 4 / 3) < 0.02, `synthetic unreadable unit: v_A = 4 m/s beside "${vBLabel}" stays 4:3, got ${ratio.toFixed(3)}`);
      const both = vA.provenance?.displayLengthScale !== undefined && vB.provenance?.displayLengthScale !== undefined;
      const neither = vA.provenance?.displayLengthScale === undefined && vB.provenance?.displayLengthScale === undefined;
      check(scaled ? both : neither, `synthetic unreadable unit: beside "${vBLabel}" ${scaled ? "both velocities share one display factor" : "neither velocity is rescaled"}`);
    } else check(false, `synthetic unreadable unit "${vBLabel}" compiles: ${fatal(result).join(" | ")}`);
  }
}
{
  // Axes give vectors a scale of their own: no display factor.
  const result = compileDocument(withPoints([point("O", 0, 0, "O")], [{ id: "ax", kind: "axes", role: "frame" }, { id: "v", kind: "vector", role: "velocity" }],
    [{ id: "make_ax", operator: "axes", inputs: { xMin: -10, xMax: 60, yMin: -10, yMax: 60 }, outputs: ["ax"] },
      { id: "make_v", operator: "vector", inputs: { start: "O", direction: [1, 0], length: 4 }, outputs: ["v"] }],
    { annotations: [{ id: "v_label", kind: "label", targetIds: ["v"], text: "v = 4 m/s" }] }));
  const v = stroke(result, "v");
  check(result.stage === "ok" && v && v.provenance?.displayLengthScale === undefined, `synthetic axes: a velocity on axes keeps its true length: ${fatal(result).join(" | ")}`);
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
console.log(`verify-directed-stroke-overlap: ${junctionCount} vector junctions kept; directed overlaps ${overlapsSeen.length} with lanes (${overlapsUnlaned} without): ${overlapsSeen.join(", ")}`);
console.log(`verify-directed-stroke-overlap: short shafts kept at true length (${shortSeen.length}): ${shortSeen.join(", ")}`);
console.log(`verify-directed-stroke-overlap: ${recorded.length} recorded documents (${compiledCount} compiled), ${scaledSeen.size} vectors display scaled, ${checks} checks passed`);
