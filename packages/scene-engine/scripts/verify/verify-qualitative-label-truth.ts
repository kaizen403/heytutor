/** Fireworks check, 19 Oct: two wrong qualitative figures. Each rule refuses its false mark. Offline. */
import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import type { SceneDocument } from "../../src/types";

function lineDocument(lineLabel: string, pointLabels: [string | undefined, string | undefined] = ["(2, 3)", "(6, 0)"]): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    source: { question: "Draw the member of a family of lines through a fixed point that has a stated x-intercept.", representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "line" }, quantities: [],
    entities: [
      { id: "ax", kind: "axes", role: "axes" },
      { id: "P", kind: "point", role: "fixed point", ...(pointLabels[0] ? { label: pointLabels[0] } : {}) },
      { id: "A", kind: "point", role: "x-intercept", ...(pointLabels[1] ? { label: pointLabels[1] } : {}) },
      { id: "L", kind: "line", role: "the line", label: lineLabel },
    ],
    constructions: [
      { id: "make_ax", operator: "axes", inputs: { xMin: -1, xMax: 8, yMin: -1, yMax: 5 }, outputs: ["ax"] },
      { id: "make_P", operator: "point", inputs: { x: 2, y: 3, coordinateSpace: "world" }, outputs: ["P"] },
      { id: "make_A", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
      { id: "make_L", operator: "line", inputs: { start: "P", end: "A" }, outputs: ["L"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["ax", "P", "A", "L"],
    revealGroups: [{ id: "all", entityIds: ["ax", "P", "A", "L"], dependsOn: [], narrationCue: "The line." }], teachingTimeline: [],
  };
}
const codes = (document: SceneDocument) => compileSceneDocument(document).report.issues.map((issue) => issue.code);

// 1. A specific member (two numerically labelled points) labelled only with the family equation.
assert(codes(lineDocument("y - 3 = m(x - 2)")).includes("equation_label_unbound_parameter"), "the family equation cannot label one member");
assert(!compileSceneDocument(lineDocument("y - 3 = m(x - 2)")).ok, "flag off refuses the false figure");
{
  // Verified parts never omits a family label to draw the member without it:
  // the omission could also hide another fatal on the same text.
  const prepared = prepareVerifiedParts(lineDocument("y - 3 = m(x - 2)"), { enabled: true });
  assert(!prepared.compiledScene?.ok, "flag on also refuses the family figure rather than drawing it without its label");
  // The line through (5, 0) and (0, 5) with two identical family callouts:
  // main refuses it (label_duplicate), and so must verified parts.
  const duplicate = lineDocument("AB", ["(5,0)", "(0,5)"]);
  duplicate.constructions.find(({ id }) => id === "make_P")!.inputs = { x: 5, y: 0, coordinateSpace: "world" };
  duplicate.constructions.find(({ id }) => id === "make_A")!.inputs = { x: 0, y: 5, coordinateSpace: "world" };
  duplicate.annotations.push({ id: "z1", kind: "callout", targetIds: ["L"], text: "Z = 2x + 2y" }, { id: "z2", kind: "callout", targetIds: ["L"], text: "Z = 2x + 2y" });
  assert(!compileSceneDocument(structuredClone(duplicate)).ok, "flag off refuses the duplicate family callout figure");
  assert(!prepareVerifiedParts(duplicate, { enabled: true }).compiledScene?.ok, "flag on cannot draw a duplicate family callout figure main refuses");
}
assert(compileSceneDocument(lineDocument("4y = 18 - 3x")).ok, "the member's own equation passes");
assert(codes(lineDocument("y = 2*x")).includes("equation_label_contradicts_geometry"), "an equation the drawn line does not satisfy is refused");
assert(codes(lineDocument("1e-13*(y-2*x)=0")).includes("equation_label_contradicts_geometry"), "a tiny scale factor does not hide a false equation");
{ const multi = lineDocument("y=4.5+k12*x"); multi.quantities = [{ id: "k12", symbol: "k12", value: -0.75 }];
  assert(!codes(multi).some((code) => code.startsWith("equation_label")), "a multi-digit quantity name stays whole"); }
assert(!codes(lineDocument("y=4.5-0.75e0*x")).some((code) => code.startsWith("equation_label")), "an unsigned exponent is part of a number, not a name");
assert(!codes(lineDocument("y - 3 = m(x - 2)", [undefined, undefined])).includes("equation_label_unbound_parameter"), "a representative line may carry its symbolic form");
assert(compileSceneDocument(lineDocument("f(x)=4.5-0.75x")).ok, "function notation names the ordinate, not a free parameter");
assert(codes(lineDocument("f(x) = 2x")).includes("equation_label_contradicts_geometry"), "a false function-notation label is still refused");

// Greptile #235 threads: each case below failed before its fix.
assert(!codes(lineDocument("y=4.5-7.5e-1x")).includes("equation_label_contradicts_geometry"), "scientific notation is a number, not a product with e");
assert(codes(lineDocument("y=4.5-.75x+(x-2)(x-6)")).includes("equation_label_contradicts_geometry"), "a false equation that agrees only at both ends is refused");
{
  const annotated = lineDocument("y - 3 = m(x - 2)", [undefined, undefined]);
  annotated.annotations.push({ id: "pc", kind: "label", targetIds: ["P"], text: "(2, 3)" }, { id: "ac", kind: "label", targetIds: ["A"], text: "(6, 0)" });
  assert(codes(annotated).includes("equation_label_unbound_parameter"), "coordinates shown by label annotations also pin the member");
}
{
  const withSlope = (value: number) => { const d = lineDocument("y - 3 = m(x - 2)"); d.quantities = [{ id: "m", symbol: "m", value }]; return d; };
  assert(!codes(withSlope(-0.75)).some((code) => code.startsWith("equation_label")), "a known slope that matches passes");
  assert(codes(withSlope(2)).includes("equation_label_contradicts_geometry"), "a known slope that does not match is refused");
  const coordinateNamed = lineDocument("y=4.5-0.75*x"); coordinateNamed.quantities = [{ id: "dx", symbol: "x", value: -1 }, { id: "dy", symbol: "y", value: 5 }];
  assert(!codes(coordinateNamed).some((code) => code.startsWith("equation_label")), "a quantity named x or y never replaces a coordinate");
}
{
  const curve: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question: "Sketch y = sin(x)/2." }, visualDecision: { mode: "scene", reason: "curve" }, quantities: [],
    entities: [{ id: "ax", kind: "axes", role: "axes" }, { id: "c", kind: "polyline", role: "curve", label: "sin(x)=2y" }],
    constructions: [{ id: "make_ax", operator: "axes", inputs: { xMin: -1, xMax: 7, yMin: -1, yMax: 1 }, outputs: ["ax"] },
      { id: "make_c", operator: "function_curve", inputs: { expression: "sin(x)/2", xMin: 0, xMax: 6 }, outputs: ["c"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["ax", "c"],
    revealGroups: [{ id: "all", entityIds: ["ax", "c"], dependsOn: [], narrationCue: "Curve." }], teachingTimeline: [],
  };
  assert(!codes(curve).some((code) => code.startsWith("equation_label")), "a built-in function on the left is not function notation");
}

// Greptile #235 round 2.
{
  const numbered = lineDocument("y=4.5+k1*x"); numbered.quantities = [{ id: "k1", symbol: "k1", value: -0.75 }];
  assert(!codes(numbered).some((code) => code.startsWith("equation_label")), "a numbered bound quantity is read as one name");
  assert(!codes(lineDocument("y=\\frac{18-3x}{4}")).some((code) => code.startsWith("equation_label")), "LaTeX the checker cannot read is skipped, never refused");
  const negative: SceneDocument = structuredClone(lineDocument("y=sqrt(x)", [undefined, undefined]));
  negative.constructions.find((c) => c.id === "make_P")!.inputs = { x: -4, y: 0, coordinateSpace: "world" };
  negative.constructions.find((c) => c.id === "make_A")!.inputs = { x: -1, y: 0, coordinateSpace: "world" };
  assert(codes(negative).includes("equation_label_contradicts_geometry"), "an equation undefined at the drawn points is refused");
}
// Greptile #235 round 3.
{
  const implicitProduct = lineDocument("y=4.5+mx"); implicitProduct.quantities = [{ id: "m", symbol: "m", value: -0.75 }];
  assert(!codes(implicitProduct).some((code) => code.startsWith("equation_label")), "an implicit product with a known quantity is read");
  const circle = (label: string): SceneDocument => ({
    schemaVersion: "scene-document/v2", source: { question: "Plot x^2 + y^2 = 4." }, visualDecision: { mode: "scene", reason: "circle" }, quantities: [],
    entities: [{ id: "ax", kind: "axes", role: "axes" }, { id: "c", kind: "polyline", role: "implicit curve", label }],
    constructions: [{ id: "make_ax", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, outputs: ["ax"] },
      { id: "make_c", operator: "implicit_curve", inputs: { expression: "x^2+y^2-4", xMin: -3, xMax: 3, yMin: -3, yMax: 3, xSamples: 65, ySamples: 65 }, outputs: ["c"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["ax", "c"],
    revealGroups: [{ id: "all", entityIds: ["ax", "c"], dependsOn: [], narrationCue: "Circle." }], teachingTimeline: [] });
  assert(codes(circle("y=2*x")).includes("equation_label_contradicts_geometry"), "a false label on an implicit curve is refused");
  assert(!codes(circle("x^2+y^2=4")).some((code) => code.startsWith("equation_label")), "the implicit curve's own equation passes");
  const semicircle: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question: "Sketch the upper semicircle." }, visualDecision: { mode: "scene", reason: "semicircle" }, quantities: [],
    entities: [{ id: "ax", kind: "axes", role: "axes" }, { id: "c", kind: "polyline", role: "curve", label: "y=sqrt(1-x^2)" }],
    constructions: [{ id: "make_ax", operator: "axes", inputs: { xMin: -1.5, xMax: 1.5, yMin: -0.5, yMax: 1.5 }, outputs: ["ax"] },
      { id: "make_c", operator: "function_curve", inputs: { expression: "sqrt(1-x^2)", xMin: -1, xMax: 1 }, outputs: ["c"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["ax", "c"],
    revealGroups: [{ id: "all", entityIds: ["ax", "c"], dependsOn: [], narrationCue: "Semicircle." }], teachingTimeline: [] };
  assert(!codes(semicircle).some((code) => code.startsWith("equation_label")), "a curve whose ends sit at its domain boundary passes");
  assert(!codes(circle("1000*(x^2+y^2-4)=0")).some((code) => code.startsWith("equation_label")), "a scaled equation of the same curve passes");
  const slow = lineDocument(`y=${"x".repeat(50)}z`); slow.quantities = [{ id: "xx", symbol: "xx", value: 1 }];
  const started = Date.now(); codes(slow);
  assert(Date.now() - started < 2000, "splitting a long name into known factors stays fast");
}
// 2. A polarity badge named as a field (B on a rod reads as a field along the rod).
function badgeDocument(label: string | undefined, role: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question: "Show a conducting rod moving through a magnetic field.", representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "rod" }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "rod end" }, { id: "b", kind: "point", role: "rod end" },
      { id: "rod", kind: "segment", role: "rod", label: "rod" },
      { id: "badge", kind: "sign_badge", role, ...(label ? { label } : {}) },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "world" }, outputs: ["b"] },
      { id: "make_rod", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["rod"] },
      { id: "make_badge", operator: "sign_badge", inputs: { target: "rod", sense: "positive", at: 0.5 }, outputs: ["badge"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["a", "b", "rod", "badge"],
    revealGroups: [{ id: "all", entityIds: ["a", "b", "rod", "badge"], dependsOn: [], narrationCue: "Rod." }], teachingTimeline: [],
  };
}
assert(codes(badgeDocument("B", "magnetic field")).includes("sign_badge_names_vector"), "a polarity badge cannot stand for B");
assert(!prepareVerifiedParts(badgeDocument("B", "magnetic field"), { enabled: true }).compiledScene?.ok, "flag on refuses it too (a truth failure)");
assert(codes(badgeDocument(undefined, "magnetic field direction")).includes("sign_badge_names_vector"), "a badge whose role is a field is refused");
for (const label of ["B₁", "E2", "B_1"]) assert(codes(badgeDocument(label, "direction")).includes("sign_badge_names_vector"), `a numbered field name is refused: ${label}`);
for (const [label, role] of [["I₁", "source-current reference"], ["τ", "torque into the page"], [undefined, "resistor current"]] as const) {
  assert(!codes(badgeDocument(label, role)).includes("sign_badge_names_vector"), `a current or turning sense along a path passes: ${label ?? role}`);
}
assert(!codes(badgeDocument("+", "polarity")).includes("sign_badge_names_vector"), "an ordinary + polarity badge passes");

// Harness 5 review of #235 (df2d0bdf7). Each row below was red before its fix.
const fatal = (document: SceneDocument) => compileSceneDocument(structuredClone(document)).report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
const FAMILY = "y - 3 = m(x - 2)";
function placed(lineLabel: string | undefined, pointLabels: [string | undefined, string | undefined], P: [number, number], A: [number, number], axes: Record<string, number>, axesNames: { label?: string; role?: string } = {}): SceneDocument {
  const document = lineDocument(lineLabel ?? "", pointLabels);
  if (lineLabel === undefined) delete document.entities.find((entity) => entity.id === "L")!.label;
  Object.assign(document.entities.find((entity) => entity.id === "ax")!, axesNames);
  document.constructions.find((c) => c.id === "make_ax")!.inputs = axes;
  document.constructions.find((c) => c.id === "make_P")!.inputs = { x: P[0], y: P[1], coordinateSpace: "world" };
  document.constructions.find((c) => c.id === "make_A")!.inputs = { x: A[0], y: A[1], coordinateSpace: "world" };
  return document;
}
const withAnnotations = (document: SceneDocument, ...annotations: SceneDocument["annotations"]) => { document.annotations.push(...annotations); return document; };
// Fix 1: a numeric pair anywhere in a point's label or in a label aimed at it pins the point.
for (const pair of [["P(2, 3)", "A(6, 0)"], ["P = (2, 3)", "A = (6, 0)"]] as const) {
  assert(fatal(lineDocument(FAMILY, [...pair])).includes("equation_label_unbound_parameter"), `named coordinates pin the member: ${pair.join(", ")}`);
}
assert(fatal(withAnnotations(lineDocument(FAMILY, ["P", "A"]), { id: "pc", kind: "label", targetIds: ["P"], text: "P(2, 3)" }, { id: "ac", kind: "label", targetIds: ["A"], text: "A(6, 0)" }))
  .includes("equation_label_unbound_parameter"), "named coordinate annotations pin the member");
// Fix 2: a label or callout with several targets is checked on each curve target.
for (const targets of [["L", "P"], ["P", "L"]]) {
  assert(fatal(withAnnotations(lineDocument("L"), { id: "fc", kind: "callout", targetIds: targets, text: FAMILY })).includes("equation_label_unbound_parameter"), `a family callout on ${targets.join(", ")} is refused`);
}
assert(fatal(withAnnotations(lineDocument("L"), { id: "fc", kind: "label", targetIds: ["L", "A"], text: FAMILY })).includes("equation_label_unbound_parameter"), "a family label on L and A is refused");
assert(fatal(withAnnotations(lineDocument("L"), { id: "fc", kind: "callout", targetIds: ["L", "P"], text: "y = 2x" })).includes("equation_label_contradicts_geometry"), "a false equation callout on L and P is refused");
assert(compileSceneDocument(withAnnotations(lineDocument("L"), { id: "fc", kind: "callout", targetIds: ["L", "P"], text: "4y = 18 - 3x" })).ok, "the member's own equation on L and P passes");
// Fix 4: prose around an equation is a callout, not an equation label (main draws these).
{
  const feasible = (labels: [string | undefined, string | undefined]) => withAnnotations(placed(undefined, labels, [0, 6], [6, 0], { xMin: -1, xMax: 8, yMin: -1, yMax: 8 }),
    { id: "rc", kind: "callout", targetIds: ["L"], text: "Retain the side below x + y = 6; include the line." });
  assert(compileSceneDocument(feasible(["(0, 6)", "(6, 0)"])).ok, JSON.stringify(fatal(feasible(["(0, 6)", "(6, 0)"]))));
  const boundary = withAnnotations(lineDocument("L"), { id: "bc", kind: "callout", targetIds: ["L"], text: "Boundary 3x + 4y = 18" });
  assert(compileSceneDocument(boundary).ok, `a boundary callout keeps main's figure: ${JSON.stringify(fatal(boundary))}`);
  assert(fatal(withAnnotations(lineDocument("L"), { id: "bc", kind: "callout", targetIds: ["L"], text: "3x + 4y = 18 + k" })).includes("equation_label_unbound_parameter"), "a short free name is still a parameter");
}
// Fix 5: a picture beside the graph is not read in the graph's frame.
{
  const beside = placed("x = 0", [undefined, undefined], [-6, 0], [-6, 3], { xMin: 0, xMax: 6, yMin: 0, yMax: 5 });
  assert(!fatal(beside).some((code) => code.startsWith("equation_label")), `a marker beside the graph is skipped: ${JSON.stringify(fatal(beside))}`);
  const crossing = placed("x = 0", [undefined, undefined], [3, -2], [3, 9], { xMin: 0, xMax: 6, yMin: 0, yMax: 5 });
  assert(fatal(crossing).includes("equation_label_contradicts_geometry"), "a line crossing the graph is still checked, even with both ends outside");
}
// Fix 6: a frame whose horizontal axis is not x.
{
  const along = (names: { label?: string; role?: string }) => placed("x = 0", [undefined, undefined], [0, 0], [10, 0], { xMin: 0, xMax: 10, yMin: -2, yMax: 2 }, names);
  for (const names of [{ label: "x-t" }, { role: "displacement–time axes" }, { label: "x (m) vs t (s)" }]) {
    assert(!fatal(along(names)).some((code) => code.startsWith("equation_label")), `the t axis is not x: ${JSON.stringify(names)}`);
  }
  for (const names of [{}, { label: "y-x" }, { label: "x-y axes" }, { role: "coordinate axes" }]) {
    assert(fatal(along(names)).includes("equation_label_contradicts_geometry"), `an x, y frame is still checked: ${JSON.stringify(names)}`);
  }
}
// Fix 7: "1/2x" reads as 1/(2x) or x/2; it is skipped, never refused.
function curveDocument(label: string, expression: string, xMin: number, xMax: number, axes: Record<string, number>): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", source: { question: "Sketch the curve." }, visualDecision: { mode: "scene", reason: "curve" }, quantities: [],
    entities: [{ id: "ax", kind: "axes", role: "axes" }, { id: "c", kind: "polyline", role: "curve", label }],
    constructions: [{ id: "make_ax", operator: "axes", inputs: axes, outputs: ["ax"] },
      { id: "make_c", operator: "function_curve", inputs: { expression, xMin, xMax }, outputs: ["c"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["ax", "c"],
    revealGroups: [{ id: "all", entityIds: ["ax", "c"], dependsOn: [], narrationCue: "Curve." }], teachingTimeline: [],
  };
}
for (const expression of ["1/(2*x)", "x/2"]) {
  assert(!fatal(curveDocument("y = 1/2x", expression, 0.5, 6, { xMin: 0, xMax: 7, yMin: 0, yMax: 4 })).some((code) => code.startsWith("equation_label")), `y = 1/2x is unreadable on ${expression}`);
}
assert(fatal(curveDocument("y = 1/(2x)", "x/2", 0.5, 6, { xMin: 0, xMax: 7, yMin: 0, yMax: 4 })).includes("equation_label_contradicts_geometry"), "a bracketed reciprocal is read and checked");
// Fix 3: a display scaled curve carries its true equation; a false one is still refused.
{
  const archetype = (document: SceneDocument): SceneDocument => ({ ...document, source: { ...document.source, synthesizedFamily: true, archetype: "cubic-shape" } });
  const scaled = (label: string) => archetype(curveDocument(label, "(0.25)*(x^3-2*x+1)", -1, 3, { xMin: -2, xMax: 4, yMin: -2, yMax: 6 }));
  // Only an engine built archetype is read with its display factor divided out.
  assert(fatal(curveDocument("y=x", "(2)*(x)", -1, 2, { xMin: -2, xMax: 3, yMin: -3, yMax: 5 })).includes("equation_label_contradicts_geometry"), "a planner curve (2)*(x) labelled y = x is refused");
  assert(fatal(curveDocument("y=x^2", "(0.5)*(x^2)", -1, 2, { xMin: -2, xMax: 3, yMin: -3, yMax: 5 })).includes("equation_label_contradicts_geometry"), "a planner curve (0.5)*(x^2) labelled y = x^2 is refused");
  assert(!fatal(scaled("y=x^3-2x+1")).some((code) => code.startsWith("equation_label")), "the true equation of a display scaled curve passes");
  assert(fatal(scaled("y=x^2")).includes("equation_label_contradicts_geometry"), "a false label on a display scaled curve is refused");
}
// Fix 8: rewordings of a field badge on a rod.
for (const [label, role] of [["B-field", "B direction"], ["B field", "direction"], ["𝐁", "direction"], ["𝑩", "direction"], ["\\vec{B}", "direction"], ["\\mathbf{B}", "direction"], ["E⃗", "direction"], ["B₀", "direction"], ["B_ext", "direction"], ["B (ext)", "direction"], [undefined, "magnetic induction along rod"], [undefined, "electric intensity"]] as const) {
  assert(fatal(badgeDocument(label, role)).includes("sign_badge_names_vector"), `a field badge is refused: ${label ?? role}`);
}
// Fix 9: correct sense badges keep main's figure.
for (const [label, role] of [["I", "induced current opposing the change in flux"], ["I", "current in the field coil"], ["q", "charge moving in the field"], ["EMF", "polarity"], ["Edge", "polarity"], ["emf", "motional emf polarity"]] as const) {
  assert(!fatal(badgeDocument(label, role)).includes("sign_badge_names_vector"), `a current, charge or emf badge passes: ${label} (${role})`);
}
{
  const along = (label: string, role: string, targetRole: string) => { const document = badgeDocument(label, role); document.entities.find((entity) => entity.id === "rod")!.role = targetRole; return document; };
  for (const [label, role, targetRole] of [["B", "B circulation along the Amperian loop", "side of the Amperian loop"], ["E", "field direction along the field line", "electric field line"], ["B", "direction of B along the field line", "magnetic field line"], ["B", "circulation sense", "circular path round the wire"]] as const) {
    assert(!fatal(along(label, role, targetRole)).includes("sign_badge_names_vector"), `a field badge on its own field path passes: ${targetRole}`);
  }
  assert(fatal(along("B", "direction", "rod sliding on the rails of the circuit loop")).includes("sign_badge_names_vector"), "a rod in a circuit loop is still a conductor");
}
// Recorded planner documents (Oct 2026 replay of 8,542 valid documents): figures main draws.
{
  // A quantity whose symbol is an expression ("sin x" = 1/2) is not substituted into "y = sin x".
  const sine = curveDocument("y = sin x", "sin(x)", -1.5, 1.5, { xMin: -1.7, xMax: 1.7, yMin: -1.1, yMax: 1.1 });
  sine.quantities = [{ id: "g1", symbol: "sin x", value: 0.5 }];
  assert(!fatal(sine).some((code) => code.startsWith("equation_label")), `a quantity written as an expression is not a name: ${JSON.stringify(fatal(sine))}`);
  // "xy-coordinate axes" is the x, y frame, not a pair of axis names.
  const xyRole = placed("x = 0", [undefined, undefined], [0, 0], [10, 0], { xMin: 0, xMax: 10, yMin: -2, yMax: 2 }, { role: "xy-coordinate axes" });
  assert(fatal(xyRole).includes("equation_label_contradicts_geometry"), "an xy-coordinate role keeps the check");
  // The objective "Z = 2x + 2y" on the optimal edge with its value "Z = 10" states the edge's equation.
  const edge = (texts: string[], P: [number, number] = [5, 0], A: [number, number] = [0, 5]) =>
    withAnnotations(placed("AB", ["(5,0)", "(0,5)"], P, A, { xMin: -0.5, xMax: 6, yMin: -0.5, yMax: 6 }), ...texts.map((text, index) => ({ id: `t${index}`, kind: "callout", targetIds: ["L"], text })));
  assert(compileSceneDocument(edge(["Z = 2x + 2y", "Z = 10"])).ok, JSON.stringify(fatal(edge(["Z = 2x + 2y", "Z = 10"]))));
  assert(fatal(edge(["Z = 2x + 2y", "Z = 12"])).includes("equation_label_contradicts_geometry"), "a wrong companion value is refused");
  assert(fatal(edge(["Z = 2x + 2y", "Z = 10", "Z = 12"])).includes("equation_label_unbound_parameter"), "two companion values fix nothing");
  assert(fatal(edge(["Z = 2x + 2y"])).includes("equation_label_unbound_parameter"), "the objective alone on the optimal edge names a family");
}
{
  // verify-chemistry-law-point-roundoff: a Gibbs law graph marks the physical zero "y=0" in its normalised display frame.
  const zero = () => placed("y=0", [undefined, undefined], [0, 2.4], [8, 2.4], { xMin: -0.25, xMax: 8.35, yMin: -0.25, yMax: 5.4 });
  const chemistry = zero(); chemistry.source.chemistryFamily = "chem_thermo";
  assert(!fatal(chemistry).some((code) => code.startsWith("equation_label")), "an engine-built chemistry graph keeps its physical zero label");
  assert(fatal(zero()).includes("equation_label_contradicts_geometry"), "the same label in a plain x, y frame is refused");
}
console.log("qualitative label truth: family equations, contradicted equations, and field badges refused");
