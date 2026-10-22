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
  const prepared = prepareVerifiedParts(lineDocument("y - 3 = m(x - 2)"), { enabled: true });
  assert(prepared.compiledScene?.ok, JSON.stringify(prepared.compiledScene?.report.issues));
  assert(!prepared.compiledScene!.renderScene!.primitives.some((p) => p.text?.includes("m(")), "flag on keeps the line and omits the family label");
}
assert(compileSceneDocument(lineDocument("4y = 18 - 3x")).ok, "the member's own equation passes");
assert(codes(lineDocument("y = 2*x")).includes("equation_label_contradicts_geometry"), "an equation the drawn line does not satisfy is refused");
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
for (const [label, role] of [["I₁", "source-current reference"], ["τ", "torque into the page"], [undefined, "resistor current"]] as const) {
  assert(!codes(badgeDocument(label, role)).includes("sign_badge_names_vector"), `a current or turning sense along a path passes: ${label ?? role}`);
}
assert(!codes(badgeDocument("+", "polarity")).includes("sign_badge_names_vector"), "an ordinary + polarity badge passes");
console.log("qualitative label truth: family equations, contradicted equations, and field badges refused");
