/**
 * Qualitative fluid apparatus operators (compile/fluidApparatusGeometry.ts).
 *
 * Production drew Archimedes with the face forces and the buoyant force stacked
 * on one line and the fluid's name inside the body, and a hydraulic press with
 * pressure drawn as unnamed arrows. Those figures are now refused (#277), and
 * the existing buoyancy operator needs numeric density, gravity and volume, so
 * a conceptual question had no right figure. These operators draw the law's
 * shape with no numbers, and this gate holds them to it:
 *
 * - submerged_body: face arrows proportional to face depth, F_B = F_bottom - F_top,
 *   arrow tails inside the fluid, no shared line between the face arrows and F_B.
 * - hydraulic_press: F2/F1 equals the ratio of the drawn piston areas, both pistons
 *   at one level, pressure is a point inside the fluid and never an arrow.
 * - Labels are symbols only; a number or a foreign name is refused.
 * - Display inputs refuse physical units (a unit would read as a measured claim).
 * - Complete planner documents built on them pass compile with figure consistency
 *   on, and a hand-added arrow on the buoyant force's line is still refused.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-fluid-apparatus.ts
 */
import assert from "node:assert/strict";
import { evaluateChapterInstrumentConstruction, chapterInstrumentOutputLabels } from "../../src/compile/chapterInstrumentGeometry";
import type { SourceContext } from "../../src/compile/sourceScalars";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";

const context: SourceContext = {
  number: (value) => Number(value),
  point: () => { throw new Error("missing point"); },
  geometry: () => undefined,
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}
function close(actual: number, expected: number, message: string): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function reject(run: () => unknown, message: string): void {
  checks += 1;
  assert.throws(run, undefined, message);
}
type P = { x: number; y: number };
type G = { kind: string; points?: P[]; point?: P; a?: P; b?: P; paths?: P[][]; directed?: boolean; instrument: { role: string } };
const ends = (g: G): [P, P] => { check(g.kind === "path" && g.points?.length === 2 && g.directed, `${g.instrument.role} is a directed arrow`); return [g.points![0]!, g.points![1]!]; };
const length = ([a, b]: [P, P]): number => Math.hypot(b.x - a.x, b.y - a.y);
function inside(point: P, polygon: P[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// --- submerged_body: the law's shape ------------------------------------------------
const body = evaluateChapterInstrumentConstruction("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4, forceScale: 0.5 }, context) as unknown as G[];
check(body.length === 8, "submerged_body has 8 outputs");
check(body.map((g) => g.instrument.role).join(",") === "fluid,surface,body,F_top,F_bottom,F_B,h1,h2", "submerged_body output order");
const [fluid, , block, top, bottom, buoyant] = body as [G, G, G, G, G, G, G, G];
const topArrow = ends(top), bottomArrow = ends(bottom), buoyantArrow = ends(buoyant);
const surfaceY = fluid.points!.reduce((max, p) => Math.max(max, p.y), -Infinity);
const topFaceY = block.points!.reduce((max, p) => Math.max(max, p.y), -Infinity);
const bottomFaceY = block.points!.reduce((min, p) => Math.min(min, p.y), Infinity);
close(surfaceY - topFaceY, 2, "top face sits at topDepth");
close(surfaceY - bottomFaceY, 4, "bottom face sits at topDepth + bodyHeight");
close(length(topArrow) / (surfaceY - topFaceY), length(bottomArrow) / (surfaceY - bottomFaceY), "face arrows are proportional to face depth (p grows linearly with depth)");
close(length(bottomArrow) - length(topArrow), length(buoyantArrow), "F_B equals F_bottom minus F_top");
check(topArrow[1].y === topFaceY && topArrow[0].y > topArrow[1].y, "F_top points down onto the top face");
check(bottomArrow[1].y === bottomFaceY && bottomArrow[0].y < bottomArrow[1].y, "F_bottom points up onto the bottom face");
check(buoyantArrow[1].y > buoyantArrow[0].y, "F_B points up");
check(inside(topArrow[0], fluid.points!) && inside(bottomArrow[0], fluid.points!), "both face arrow tails are inside the fluid");
check(Math.abs(buoyantArrow[0].x - topArrow[0].x) > 1e-6, "F_B never shares a line with the face arrows");
check(buoyantArrow[1].y <= topFaceY, "F_B ends inside the body, so it never reads as a third force beside F_top");
reject(() => evaluateChapterInstrumentConstruction("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4, forceScale: 0.6 }, context), "a buoyant arrow longer than half the body would leave the body");
reject(() => evaluateChapterInstrumentConstruction("submerged_body", { topDepth: 0.1, bodyHeight: 2, bodyWidth: 2.4 }, context), "a body touching the surface is not drawn as submerged");
reject(() => evaluateChapterInstrumentConstruction("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4, density: 1000 }, context), "unknown physical inputs are refused");

// --- hydraulic_press: one pressure, forces in the ratio of the drawn areas -----------
const press = evaluateChapterInstrumentConstruction("hydraulic_press", { smallWidth: 1, largeWidth: 2, forceLength: 0.8 }, context) as unknown as G[];
check(press.map((g) => g.instrument.role).join(",") === "vessel,fluid,small_piston,large_piston,F1,F2,pressure", "hydraulic_press output order");
const [, pressFluid, small, large, f1, f2, pressure] = press as [G, G, G, G, G, G, G];
const f1Arrow = ends(f1), f2Arrow = ends(f2);
const width = (g: G) => Math.max(...g.points!.map((p) => p.x)) - Math.min(...g.points!.map((p) => p.x));
close(length(f2Arrow) / length(f1Arrow), (width(large) / width(small)) ** 2, "F2/F1 equals A2/A1 of the drawn circular pistons");
close(Math.min(...small.points!.map((p) => p.y)), Math.min(...large.points!.map((p) => p.y)), "both pistons rest at one level");
check(f1Arrow[1].y < f1Arrow[0].y && f2Arrow[1].y > f2Arrow[0].y, "F1 pushes down on the small piston, F2 pushes up on the large one");
check(pressure.kind === "point" && inside(pressure.point!, pressFluid.points!), "pressure is a point inside the fluid, never an arrow");
reject(() => evaluateChapterInstrumentConstruction("hydraulic_press", { smallWidth: 1, largeWidth: 1, forceLength: 0.8 }, context), "equal pistons teach no multiplication");
reject(() => evaluateChapterInstrumentConstruction("hydraulic_press", { smallWidth: 1, largeWidth: 3, forceLength: 0.8 }, context), "an area ratio beyond the drawable band is refused");

// --- labels: symbols only ---------------------------------------------------------------
check(chapterInstrumentOutputLabels("submerged_body", body)[5] === "F_B", "F_B is the default buoyant label");
check(chapterInstrumentOutputLabels("hydraulic_press", press, [undefined, undefined, "A1", "A2", "F1", "F2", "P"]).join(",") === "vessel,fluid,A1,A2,F1,F2,P", "hydraulic symbols are accepted");
reject(() => chapterInstrumentOutputLabels("submerged_body", body, [undefined, undefined, undefined, undefined, undefined, "F_B=5 N"]), "a numeric buoyant label is refused");
reject(() => chapterInstrumentOutputLabels("hydraulic_press", press, [undefined, undefined, undefined, undefined, undefined, undefined, "F3"]), "a pressure point cannot carry a force name");
reject(() => chapterInstrumentOutputLabels("submerged_body", body, ["water"]), "the fluid is never named water: the stem may name another liquid");

// --- documents: units, figure consistency -------------------------------------------------
type Entity = { id: string; kind: string; role: string; label?: string };
function document(operator: string, inputs: Record<string, unknown>, entities: Entity[], extra: { constructions?: unknown[]; entities?: Entity[]; quantities?: unknown[] } = {}): Record<string, unknown> {
  const all = [...entities, ...(extra.entities ?? [])];
  return {
    schemaVersion: "scene-document/v2",
    source: { nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "fluid apparatus fixture" },
    entities: all, relations: [], assertions: [], quantities: extra.quantities ?? [], annotations: [], teachingTimeline: [],
    revealGroups: [{ id: "setup", dependsOn: [], entityIds: all.map((entity) => entity.id), narrationCue: "setup" }],
    constructions: [{ id: "make", operator, inputs, outputs: entities.map((entity) => entity.id) }, ...(extra.constructions ?? [])],
    requiredEntityIds: all.map((entity) => entity.id),
  };
}
function fatal(raw: Record<string, unknown>): string[] {
  const validated = validateSceneDocument(structuredClone(raw));
  if (!validated.document) return validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
  const compiled = compileSceneDocument(validated.document, { figureConsistency: true });
  return [...compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code), ...(compiled.ok ? [] : ["not_ok"])];
}
const archimedesEntities: Entity[] = [
  { id: "fluid", kind: "polygon", role: "fluid", label: "fluid" }, { id: "surface", kind: "segment", role: "surface" },
  { id: "body", kind: "polygon", role: "body", label: "body" }, { id: "fTop", kind: "vector", role: "force", label: "F1" },
  { id: "fBottom", kind: "vector", role: "force", label: "F2" }, { id: "fB", kind: "vector", role: "force", label: "F_B" },
  { id: "h1", kind: "dimension", role: "depth", label: "h1" }, { id: "h2", kind: "dimension", role: "depth", label: "h2" },
];
const archimedes = document("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4 }, archimedesEntities);
const archimedesCodes = fatal(archimedes);
check(archimedesCodes.length === 0, `an Archimedes figure on submerged_body compiles clean with figure consistency on: ${archimedesCodes.join(",")}`);
const pressEntities: Entity[] = [
  { id: "vessel", kind: "polyline", role: "vessel" }, { id: "liquid", kind: "polygon", role: "fluid", label: "liquid" },
  { id: "small", kind: "polygon", role: "piston", label: "A1" }, { id: "large", kind: "polygon", role: "piston", label: "A2" },
  { id: "f1", kind: "vector", role: "force", label: "F1" }, { id: "f2", kind: "vector", role: "force", label: "F2" },
  { id: "p", kind: "point", role: "pressure", label: "P" },
];
const pressCodes = fatal(document("hydraulic_press", { smallWidth: 1, largeWidth: 2, forceLength: 0.8 }, pressEntities));
check(pressCodes.length === 0, `a hydraulic press on hydraulic_press compiles clean with figure consistency on: ${pressCodes.join(",")}`);
const numericLabel = fatal(document("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4 },
  archimedesEntities.map((entity) => entity.id === "fB" ? { ...entity, label: "F_B = 12 N" } : entity)));
check(numericLabel.length > 0, "a document labelling F_B with a number is refused");
const unitInput = fatal(document("submerged_body", { topDepth: "depth", bodyHeight: 2, bodyWidth: 2.4 }, archimedesEntities,
  { quantities: [{ id: "depth", symbol: "h", value: 2, unit: "m" }] }));
check(unitInput.length > 0, "a display input carrying a physical unit is refused");
// A planner that adds its own upthrust arrow from the body's centroid stacks it
// on F_B, as production did: the existing collinear rule still refuses that.
const stacked = fatal(document("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4 }, archimedesEntities, {
  entities: [{ id: "c", kind: "point", role: "centre" }, { id: "c2", kind: "point", role: "tip" }, { id: "w", kind: "vector", role: "force", label: "U" }],
  constructions: [
    { id: "mc", operator: "point", inputs: { x: 0.42 * 2.4 * 3.4, y: -3 }, outputs: ["c"] },
    { id: "mc2", operator: "point", inputs: { x: 0.42 * 2.4 * 3.4, y: -1.6 }, outputs: ["c2"] },
    { id: "mw", operator: "vector", inputs: { start: "c", end: "c2" }, outputs: ["w"] },
  ],
}));
check(stacked.includes("vector_collinear_overlap"), `a hand-added arrow on F_B's line is still refused: ${stacked.join(",")}`);

console.log(`verify-fluid-apparatus: ${checks} checks passed`);
