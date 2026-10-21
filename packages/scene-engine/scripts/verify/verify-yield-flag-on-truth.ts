/** #214 flag-on truth rules (19 Oct): each one omits a false mark only with the yield policy on. Offline. */
import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import { compactCalloutLabel } from "../../src/compile/pointLabelText";
import { validateLabelOwnerTruth } from "../../src/compile/labelOwnerTruth";
import { deferVerifiedAnswerLabels } from "../../src/compile/answerLabels";
import type { RenderPrimitive, SceneDocument } from "../../src/types";

const on = (document: SceneDocument) => prepareVerifiedParts(document, { enabled: true });
const off = (document: SceneDocument) => compileSceneDocument(document);
const texts = (primitives: RenderPrimitive[] | undefined) => (primitives ?? []).filter(p => p.kind === "label").map(p => p.text);

// 1. A callout cut short is a different statement (hyperbola "y =", "c_i = 2.05 kJ/").
assert.equal(compactCalloutLabel("y = (3/4)x; y = −(3/4)x"), "y =", "default-off compaction is unchanged");
for (const text of ["y = (3/4)x; y = −(3/4)x", "c_i = 2.05 kJ/(kg K)", "y − y₁ = m(x − x₁)"]) {
  assert.equal(compactCalloutLabel(text, true), undefined, `strict compaction never prints a truncated statement: ${text}`);
}
assert.equal(compactCalloutLabel("Normal reaction: perpendicular to the plane", true), "Normal reaction", "a complete head before a colon survives");
for (const text of ["g=9.8 m/s², vertically down", "Lyman series (UV region)", "Check: coplanar if zero"]) {
  assert.equal(compactCalloutLabel(text, true), compactCalloutLabel(text), `a true default cut is kept unchanged: ${text}`);
}
assert.equal(compactCalloutLabel("R = 5 Ω", true), "R = 5 Ω", "a short label is untouched");

function axesDocument(annotations: SceneDocument["annotations"]): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    source: { question: "Sketch the graph on labelled axes." },
    visualDecision: { mode: "scene", reason: "Graph." },
    quantities: [],
    entities: [{ id: "axes", kind: "axes", role: "axes" }, { id: "p", kind: "point", role: "point", label: "P" }],
    constructions: [
      { id: "axes_c", operator: "axes", inputs: { xMin: -1, xMax: 8, yMin: -1, yMax: 6 }, outputs: ["axes"] },
      { id: "p_c", operator: "point", inputs: { x: 4, y: 3, coordinateSpace: "world" }, outputs: ["p"] },
    ],
    relations: [], assertions: [], annotations, requiredEntityIds: ["axes", "p"],
    revealGroups: [{ id: "all", entityIds: ["axes", "p"], dependsOn: [], narrationCue: "Graph." }],
    teachingTimeline: [],
  };
}

// 2. One label at the origin cannot name one axis ("t (s)" read as the velocity axis).
{
  const document = axesDocument([
    { id: "t_name", kind: "label", targetIds: ["axes"], text: "t (s)" },
    { id: "v_name", kind: "label", targetIds: ["axes"], text: "v (m/s)" },
  ]);
  const prepared = on(document);
  assert(prepared.compiledScene?.ok, JSON.stringify(prepared.compiledScene?.report.issues));
  const shown = texts(prepared.compiledScene!.renderScene!.primitives);
  assert(!shown.includes("t (s)") && !shown.includes("v (m/s)"), "flag on omits axis titles it cannot bind to one axis");
  assert(prepared.issues.some(issue => issue.code === "yield_label_omitted"), "each omission is recorded");
  assert(texts(off(document).renderScene?.primitives).includes("t (s)"), "flag off is unchanged");
}
{
  // The standard axis names keep their existing placement (moving them displaced other labels).
  const document = axesDocument([{ id: "x_name", kind: "label", targetIds: ["axes"], text: "x" }]);
  assert.deepEqual(texts(on(document).compiledScene?.renderScene?.primitives), texts(off(document).renderScene?.primitives), "standard axis names are untouched");
}

// 3. An open endpoint is hollow: the point's own filled dot does not sit inside the ring.
{
  const document = axesDocument([{ id: "open_p", kind: "endpoint", targetIds: ["p"], style: { pointStyle: "open" } }]);
  const onPrimitives = on(document).compiledScene!.renderScene!.primitives;
  assert(!onPrimitives.some(p => p.entityId === "p" && p.kind === "point"), "flag on draws no filled dot for an open endpoint");
  assert(onPrimitives.some(p => p.entityId === "p" && p.kind === "circle" && (p.radius ?? 0) >= 5), "the point stays as a visible hollow ring");
  assert(off(document).renderScene!.primitives.some(p => p.entityId === "p" && p.kind === "point"), "flag off is unchanged");
}

// 4. Crossed point names: each is nearer the other's point (latent heat "−8°C" and "0°C"),
// while both stay within the ordinary 40 px owner distance.
{
  const document = axesDocument([]);
  document.entities.push({ id: "q", kind: "point", role: "point", label: "Q" });
  const point = (entityId: string, x: number, y: number): RenderPrimitive => ({ id: `pt_${entityId}`, entityId, groupId: "all", kind: "point", points: [{ x, y }] });
  const name = (entityId: string, text: string, x: number, y: number): RenderPrimitive => ({ id: `label_${entityId}`, entityId, groupId: "all", kind: "label", points: [{ x, y }], text });
  const crossed = validateLabelOwnerTruth(document, [point("p", 500, 400), point("q", 500, 370), name("p", "P", 500, 374), name("q", "Q", 500, 396)]);
  assert.equal(crossed.filter(issue => issue.code === "label_owner_ambiguous").length, 2, "both crossed names are refused");
  const straight = validateLabelOwnerTruth(document, [point("p", 500, 400), point("q", 500, 370), name("p", "P", 500, 404), name("q", "Q", 500, 366)]);
  assert.equal(straight.length, 0, "names beside their own points pass");
}
// 5. Greptile #214 (answerLabels.ts:48): a stated matrix's entries are givens; only a
// computed matrix is held until the end. Asking for a determinant must not empty the brackets.
{
  const ids = ["given", "computed"];
  const document: SceneDocument = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "matrix" }, source: { question: "Find the determinant of A and the product A·B." },
    quantities: [], entities: [...ids, "b"].map((id) => ({ id, kind: "matrix_array" as const, role: "matrix" })),
    constructions: [
      { id: "make_given", operator: "matrix_array", inputs: { entries: [[2, 1], [3, 4]], origin: [0, 0], displayScale: 1 }, outputs: ["given"] },
      { id: "make_b", operator: "matrix_array", inputs: { entries: [[1, 0], [0, 2]], origin: [10, 0], displayScale: 1 }, outputs: ["b"] },
      { id: "make_computed", operator: "matrix_product", inputs: { left: "given", right: "b", origin: [20, 0], displayScale: 1 }, outputs: ["computed"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: [...ids, "b"], revealGroups: [{ id: "m", entityIds: [...ids, "b"], dependsOn: [], narrationCue: "Matrices." }], teachingTimeline: [] };
  const cell = (entityId: string, row: number, text: string): RenderPrimitive => ({ id: `${entityId}_${row}_0`, entityId, groupId: "m", kind: "label", points: [{ x: 500 + row, y: 300 }], text,
    provenance: { matrixNonmetric: true, matrixCell: { row, column: 0, exactValue: { numerator: text, denominator: "1" }, displayAccuracy: "exact" } } } as RenderPrimitive);
  const compiled = { renderScene: { engineVersion: "scene-engine/2.0.0", primitives: [cell("given", 0, "2"), cell("b", 0, "1"), cell("computed", 0, "2")], revealGroups: document.revealGroups, timeline: [], entityBounds: {} } as unknown as NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]> };
  const plan = { unknowns: [{ id: "det", symbol: "D" }], derived: [], givens: [] } as unknown as Parameters<typeof deferVerifiedAnswerLabels>[1];
  const staged = deferVerifiedAnswerLabels(document, plan, compiled.renderScene).source.answerLabelEntityIds ?? [];
  assert(!staged.includes("given") && !staged.includes("b"), "stated matrix entries stay visible");
  assert(staged.includes("computed"), "a computed matrix is still held until the end");
}
console.log("yield flag-on truth: strict callouts, axis names, hollow open endpoints, crossed point names");
