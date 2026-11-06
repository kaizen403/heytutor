/**
 * Three false marks on calculus figures are declined, by geometry alone:
 * - a point labelled f(a) drawn at another abscissa is refused;
 * - a secant along a straight stretch of a curve that bends elsewhere (drawn
 *   edge to edge it reads as more of the curve) is refused;
 * - a straight line's name that hugs another stroke, nearer it than its own
 *   line, is omitted by live validation, and the figure still draws.
 * The last runs only in live validation (figure consistency): a saved figure
 * resumes and reopens as it was saved.
 */
import assert from "node:assert/strict";
import { SCENE_DOCUMENT_VERSION, compileSceneDocument, prepareVerifiedParts, validateSceneDocument, type RenderPrimitive, type SceneDocument } from "@heytutor/scene-engine";
import { validateStraightLineNames } from "../../../../packages/scene-engine/src/compile/labelOwnerTruth";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
console.warn = () => {};

const base = (question: string, entities: Row[], constructions: Row[], extra: Row = {}): Row => ({
  schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
  source: { question, nonMetric: true, representationTier: "qualitative_verified", diagramYieldPolicy: "verified_parts" },
  entities, constructions, requiredEntityIds: entities.map((e) => e.id),
  revealGroups: [{ id: "g", entityIds: entities.map((e) => e.id), dependsOn: [], narrationCue: "The figure." }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [], ...extra,
});
const fatal = (result: { report: { issues: Array<{ severity: string; code: string }> } }) => result.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
const valid = (document: Row): SceneDocument => {
  const validated = validateSceneDocument(document);
  assert(validated.document, `the fixture is valid: ${JSON.stringify(fatal(validated)).slice(0, 160)}`);
  return validated.document;
};

// 1. A point labelled f(a) is drawn at x = a.
const semicircle = (at: number, label: { entity?: string; annotation?: string }) => base("Sketch f(x) = sqrt(4 - x^2) and mark f(0).",
  [{ id: "curve", kind: "polyline", role: "curve", label: "y=√(4−x²)" }, { id: "point", kind: "point", role: "point", ...(label.entity ? { label: label.entity } : {}) }],
  [{ id: "c1", operator: "function_curve", inputs: { expression: "sqrt(4-x^2)", xMin: -2, xMax: 2 }, outputs: ["curve"] },
    { id: "c2", operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: ["point"] }],
  { quantities: [{ id: "f0", symbol: "f(0)", value: 2 }], ...(label.annotation ? { annotations: [{ id: "name", kind: "label", text: label.annotation, targetIds: ["point"] }] } : {}) });
const anchorCompile = (at: number, label: { entity?: string; annotation?: string }) => compileSceneDocument(valid(semicircle(at, label)));
assert.deepEqual(fatal(anchorCompile(0.5, { entity: "f(0)=2" })), ["geometry_claim_contradiction"], "f(0)=2 drawn at x 0.5 is refused");
assert(anchorCompile(0, { entity: "f(0)=2" }).ok, "f(0)=2 drawn at x 0 is kept");
assert.deepEqual(fatal(anchorCompile(0.5, { annotation: "f(0)" })), ["geometry_claim_contradiction"], "a label annotation f(0) at x 0.5 is refused too");
assert(anchorCompile(-1, { entity: "f(−1)" }).ok, "a unicode minus reads as the same number");
assert.deepEqual(fatal(anchorCompile(1, { entity: "f(−1)" })), ["geometry_claim_contradiction"], "f(−1) with a unicode minus drawn at x 1 is refused");
// Two or more decimals are a rounding of the drawn abscissa; an integer or one decimal is exact.
const markOn = (expression: string, xMin: number, xMax: number, at: number, label: string) => compileSceneDocument(valid(base("Sketch the curve and mark the point.",
  [{ id: "curve", kind: "polyline", role: "curve" }, { id: "point", kind: "point", role: "point", label }],
  [{ id: "c1", operator: "function_curve", inputs: { expression, xMin, xMax }, outputs: ["curve"] }, { id: "c2", operator: "curve_anchor", inputs: { curve: "curve", at }, outputs: ["point"] }])));
assert(markOn("x^3-6*x", -3, 3, Math.SQRT2, "f(1.41)").ok, "f(1.41) on a dot at x = √2 is kept");
assert(markOn("sin(x)", 0, 4, Math.PI, "f(3.14)").ok, "f(3.14) on a dot at x = π is kept");
assert.deepEqual(fatal(markOn("x^3-6*x", -3, 3, 1.42, "f(1.41)")), ["geometry_claim_contradiction"], "f(1.41) on a dot at 1.42 is refused");
assert.deepEqual(fatal(markOn("x^3-6*x", -3, 3, 0.46, "f(0.5)")), ["geometry_claim_contradiction"], "f(0.5) on a dot at 0.46 is refused: one decimal is exact");
assert.deepEqual(fatal(markOn("x^3-6*x", -3, 3, 0.25, "x(0.10)")), ["geometry_claim_contradiction"], "x(0.10) on a dot at 0.25 is refused");
assert(anchorCompile(0.5, { entity: "f(a)" }).ok, "a symbolic argument states no abscissa");
assert(anchorCompile(0.5, { entity: "P" }).ok, "a plain name is not this check");
console.log("PASS f(a): a labelled point must sit at its stated abscissa");

// 2. A secant on a straight stretch of a curve that bends elsewhere.
const lineOn = (expression: string, construction: Row, xMin = -2, xMax = 2) => base("Draw the line on the curve.",
  [{ id: "curve", kind: "polyline", role: "curve" }, { id: "line", kind: "line", role: "line" }],
  [{ id: "c1", operator: "function_curve", inputs: { expression, xMin, xMax }, outputs: ["curve"] }, { id: "c2", ...construction, outputs: ["line"] }]);
const lineIssues = (expression: string, construction: Row, xMin = -2, xMax = 2) => fatal(validateSceneDocument(lineOn(expression, construction, xMin, xMax)));
assert(lineIssues("abs(x)", { operator: "curve_secant", inputs: { curve: "curve", first: 0, second: 1 } }).includes("invalid_curve_secant_geometry"), "a secant along one arm of |x| is refused");
assert.deepEqual(lineIssues("x^2", { operator: "curve_secant", inputs: { curve: "curve", first: 0, second: 1 } }), [], "a secant of a parabola is kept");
assert.deepEqual(lineIssues("2*x+1", { operator: "curve_secant", inputs: { curve: "curve", first: 0, second: 1 } }), [], "a secant of a straight line that never bends is kept");
const secant01 = { operator: "curve_secant", inputs: { curve: "curve", first: 0, second: 1 } };
// Straightness comes from the expression, never from samples that happen to agree.
assert.deepEqual(lineIssues("cos(48*pi*x)", secant01, -1, 1), [], "a secant of a fast cosine whose samples all agree is kept");
assert(lineIssues("x + abs(x-1.51) + abs(x-1.53) - 2*abs(x-1.52)", secant01).includes("invalid_curve_secant_geometry"), "a bend narrower than any sample spacing, outside the secant, still counts");
assert.deepEqual(lineIssues("x + abs(x-0.51) + abs(x-0.53) - 2*abs(x-0.52)", secant01), [], "and one inside the secant means the stretch is not straight");
assert(lineIssues("abs(x-0.5) + abs(x+0.5)", { operator: "curve_secant", inputs: { curve: "curve", first: -0.25, second: 0.25 } }).includes("invalid_curve_secant_geometry"), "a secant on the flat floor between two corners is refused");
assert.deepEqual(lineIssues("abs(x-0.5) + abs(x+0.5)", secant01), [], "one across a corner is kept");
for (const curved of ["x*abs(x)", "1/(x+3)", "sin(x)"]) assert.deepEqual(lineIssues(curved, secant01), [], `a secant of ${curved}, which is not built from straight pieces, is kept`);
console.log("PASS straight stretch: a secant drawn along a bending curve's straight piece is refused");

// 3. A straight line's name that hugs another stroke is omitted in live validation; the figure draws.
const tangents = () => base("Find the points on y = x^3 - 3x + 1 where the tangent is parallel to y = 9x - 4.",
  [{ id: "curve", kind: "polyline", role: "curve", label: "y=x³−3x+1" }, { id: "given_line", kind: "polyline", role: "given line", label: "y=9x−4" },
    { id: "p1", kind: "point", role: "point" }, { id: "t1", kind: "line", role: "tangent", label: "y=9x+17" },
    { id: "p2", kind: "point", role: "point" }, { id: "t2", kind: "line", role: "tangent", label: "y=9x−15" }],
  [{ id: "c1", operator: "function_curve", inputs: { expression: "x^3-3*x+1", xMin: -3, xMax: 3, samples: 97 }, outputs: ["curve"] },
    { id: "c2", operator: "function_curve", inputs: { expression: "9*x-4", xMin: -3, xMax: 3, samples: 25 }, outputs: ["given_line"] },
    { id: "c3", operator: "curve_anchor", inputs: { curve: "curve", at: -2 }, outputs: ["p1"] }, { id: "c4", operator: "tangent_line", inputs: { curve: "curve", at: -2, span: 2 }, outputs: ["t1"] },
    { id: "c5", operator: "curve_anchor", inputs: { curve: "curve", at: 2 }, outputs: ["p2"] }, { id: "c6", operator: "tangent_line", inputs: { curve: "curve", at: 2, span: 2 }, outputs: ["t2"] }]);
const tangentFigure = valid(tangents());
const live = compileSceneDocument(tangentFigure, { figureConsistency: true });
assert(live.report.issues.some((issue) => issue.code === "label_owner_ambiguous" && /straight line's name/.test(issue.message)), "live validation finds the line's name nearer a tangent");
const prepared = prepareVerifiedParts(tangentFigure, { enabled: true, figureConsistency: true });
const drawn = prepared.compiledScene ?? compileSceneDocument(prepared.document, { figureConsistency: true });
assert(drawn.ok && drawn.renderScene, "the figure still draws");
assert(prepared.issues.some((issue) => issue.code === "yield_label_omitted" && issue.expected === "label_owner_ambiguous"), "with that name omitted");
assert(!drawn.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "y=9x−4"), "it is not drawn");
assert(drawn.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "y=9x+17"), "the tangents keep theirs");
console.log("PASS straight line names: live validation omits a name that hugs another stroke; the figure draws");

// The rule itself, on primitives: only a name boxed close to another stroke and nearer it than its own straight line.
const straight = (id: string, from: Row, to: Row): RenderPrimitive => ({ id: `${id}_stroke`, entityId: id, kind: "polyline", points: Array.from({ length: 9 }, (_, k) => ({ x: from.x + (to.x - from.x) * k / 8, y: from.y + (to.y - from.y) * k / 8 })) } as unknown as RenderPrimitive);
const curved = (id: string): RenderPrimitive => ({ id: `${id}_stroke`, entityId: id, kind: "polyline", points: Array.from({ length: 9 }, (_, k) => ({ x: 400 + k * 20, y: 100 + (k - 4) ** 2 * 6 })) } as unknown as RenderPrimitive);
const name = (owner: string, x: number, y: number): RenderPrimitive => ({ id: `${owner}_label`, entityId: owner, kind: "label", text: "y=2x", points: [{ x: x + 30, y: y + 12 }], provenance: { labelBounds: { x, y, width: 60, height: 24 } } } as unknown as RenderPrimitive);
const doc = { entities: [{ id: "own" }, { id: "rival" }], annotations: [] } as unknown as SceneDocument;
const own = straight("own", { x: 500, y: 100 }, { x: 500, y: 500 });
const rival = straight("rival", { x: 640, y: 100 }, { x: 640, y: 500 });
assert.equal(validateStraightLineNames(doc, [own, rival, name("own", 570, 300)]).length, 1, "a name 10 px from another line and 70 from its own is flagged");
assert.equal(validateStraightLineNames(doc, [own, rival, name("own", 510, 300)]).length, 0, "a name beside its own line is not");
const near = straight("rival", { x: 580, y: 100 }, { x: 580, y: 500 });
assert.equal(validateStraightLineNames(doc, [own, near, name("own", 510, 300)]).length, 0, "a name as near its own line as another is not");
const far = straight("rival", { x: 900, y: 100 }, { x: 900, y: 500 });
assert.equal(validateStraightLineNames(doc, [own, far, name("own", 700, 300)]).length, 0, "a name floating clear of every stroke is read by elimination");
assert.equal(validateStraightLineNames(doc, [curved("own"), rival, name("own", 570, 300)]).length, 0, "a curve's name, however far, is not this rule");
// An axis is not a rival owner: a name 10 px from the y-axis and far from its own line is read as a line's name.
const axes = { id: "rival_axes", entityId: "rival", kind: "axes", points: [{ x: 560, y: 500 }, { x: 900, y: 500 }, { x: 640, y: 500 }, { x: 640, y: 100 }] } as unknown as RenderPrimitive;
assert.equal(validateStraightLineNames(doc, [own, axes, name("own", 570, 300)]).length, 0, "a name beside an axis is not taken from its line");
assert.equal(validateStraightLineNames(doc, [own, axes, rival, name("own", 570, 300)]).length, 1, "a stroke beside it still is a rival");
// Measured to the ink another stroke draws: a ring by its circumference, a closed shape by every edge.
const ring = (cx: number, cy: number, radius: number, kind = "circle", extra: Row = {}): RenderPrimitive => ({ id: "rival_ring", entityId: "rival", kind, points: [{ x: cx, y: cy }], radius, ...extra } as unknown as RenderPrimitive);
assert.equal(validateStraightLineNames(doc, [own, ring(600, 312, 150), name("own", 570, 300)]).length, 0, "a name near the centre of a wide ring is far from its ink");
assert.equal(validateStraightLineNames(doc, [own, ring(720, 312, 80), name("own", 570, 300)]).length, 1, "a name 10 px from a ring's circumference is flagged");
assert.equal(validateStraightLineNames(doc, [own, ring(720, 312, 80, "arc", { startAngle: Math.PI / 2, endAngle: 3 * Math.PI / 2 }), name("own", 570, 300)]).length, 1, "and 10 px from an arc's");
assert.equal(validateStraightLineNames(doc, [own, ring(720, 312, 80, "arc", { startAngle: -Math.PI / 2, endAngle: Math.PI / 2 }), name("own", 570, 300)]).length, 0, "but not when the arc's ink is on the far side");
const closed = (kind: string, points: Row[]): RenderPrimitive => ({ id: "rival_shape", entityId: "rival", kind, points } as unknown as RenderPrimitive);
assert.equal(validateStraightLineNames(doc, [own, closed("polygon", [{ x: 640, y: 100 }, { x: 900, y: 300 }, { x: 640, y: 500 }]), name("own", 570, 300)]).length, 1, "a name beside a triangle's closing edge is flagged");
assert.equal(validateStraightLineNames(doc, [own, closed("rectangle", [{ x: 640, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 500 }, { x: 640, y: 500 }]), name("own", 570, 300)]).length, 1, "and beside a rectangle's last side");
assert.equal(validateStraightLineNames(doc, [own, closed("rectangle", [{ x: 900, y: 500 }, { x: 640, y: 100 }]), name("own", 570, 300)]).length, 1, "and beside a rectangle given by two corners");
console.log("PASS rule: flagged only when the name's box hugs another stroke and sits nearer it than its own straight line");

// Rule 3: a saved figure is judged by the save path, where the name rule does not run.
const admitted = admitStoredScene({ sceneDocument: tangentFigure, sceneQuestion: tangentFigure.source.question as string, turnPlan: null, submittedTier: "qualitative_verified" });
assert(admitted.ok, `a figure saved with that name passes its next resume save: ${admitted.ok ? "" : admitted.code}`);
assert(restoreVerifiedPresentationFromTurn({ question: tangentFigure.source.question as string, sceneDocument: tangentFigure, sceneArtifacts: null } as never), "and reopens");
// A saved false figure is refused at its next save, and on reopen keeps its stored rows but loses its pointing.
const falseAnchor = valid(semicircle(0.5, { entity: "f(0)=2" }));
const refused = admitStoredScene({ sceneDocument: falseAnchor, sceneQuestion: falseAnchor.source.question as string, turnPlan: null, submittedTier: "qualitative_verified" });
assert(!refused.ok && refused.code === "scene_compile_failed", "a saved false anchor is refused at its next save");
const storedAnchor = { question: falseAnchor.source.question, sceneDocument: falseAnchor, sceneArtifacts: null, visualStatus: "validated", segments: [] } as never;
assert.equal(restoreVerifiedPresentationFromTurn(storedAnchor), null, "reopen rebuilds no figure to point at");
assert.equal(sourceCheckedStoredTurn(storedAnchor).visualStatus, "validated", "but the stored rows stay as saved");
// A saved secant along |x| is no longer a valid document, so reopen marks the turn and drops its figure ink.
const storedSecant = { question: "Draw the line on the curve.", sceneDocument: lineOn("abs(x)", { operator: "curve_secant", inputs: { curve: "curve", first: 0, second: 1 } }), sceneArtifacts: null, visualStatus: "validated", segments: [] } as never;
assert.equal(sourceCheckedStoredTurn(storedSecant).visualStatus, "retry_required", "a saved |x| secant reopens without its figure");
console.log("PASS rule 3: a saved figure with such a name resumes and reopens; a saved false figure is refused at its next save");
console.log("PASS continuity false marks: 6 groups");
