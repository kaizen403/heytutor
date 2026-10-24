import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import {
  displayedSceneQuantityTexts, pruneUnverifiedSceneAnnotations, validateTurnPlanSceneProofs,
  type TurnPlanV3,
} from "../../src/contracts/contractsV3";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

// "boyle's law graph" (short-asks-chem-main, judged partial): every planner
// candidate named the axes with label constructions aimed at the axes entity
// (or at the curve). A label construction stands on its target's centre, and
// the centre of an axes object is the middle of the plot, so "P" and "V"
// floated inside the graph and named neither axis. Axes now take their own
// titles (xLabel, yLabel) at the arrow tips, and a label aimed at axes is
// refused with a message that says how to name them.
//
// Fail closed (round 2 review): nothing proves a title names the quantity its
// own axis plots, and binding a title to any symbol the turn mentions drew
// false titles (T on the pressure axis, swapped P and V, 1/V, PV, k,
// "temperature", "Boyle", "s" through "boyle's"). So only x on the horizontal
// and y on the vertical draw, in a turn whose plan quantities are all x or y
// (or that has none). Every other title is omitted and recorded, and the
// figure still draws. Main drew no axis titles at all, so an omitted title
// never refuses a figure main drew.

const curve = { id: "make_curve", operator: "function_curve", inputs: { expression: "1/x", variable: "x", xMin: 0.25, xMax: 5, samples: 81 }, outputs: ["curve"] };
function boyle(axesInputs: Record<string, unknown>, labels: Array<{ id: string; text: string; target: string }> = []): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "qualitative P against V isotherm" },
    source: { question: "boyle's law graph", nonMetric: true, representationTier: "qualitative_verified" },
    teachingTimeline: [],
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      { id: "curve", kind: "polyline", role: "isotherm", label: "P = k/V" },
      ...labels.map((label) => ({ id: label.id, kind: "label", role: "axis label", label: label.text })),
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 5, yMin: 0, yMax: 4.5, ...axesInputs }, outputs: ["axes"] },
      curve,
      ...labels.map((label) => ({ id: `make_${label.id}`, operator: "label", inputs: { target: label.target, text: label.text }, outputs: [label.id] })),
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["axes", "curve"],
    revealGroups: [{ id: "setup", entityIds: ["axes", "curve", ...labels.map((label) => label.id)], dependsOn: [] }],
  } as unknown as SceneDocument;
}

const fatal = (document: SceneDocument) => validateSceneDocument(document).report.issues.filter((issue) => issue.severity === "fatal");

// 1. The recorded shape: labels aimed at axes are refused, with the remedy.
const recorded = boyle({}, [{ id: "label_x", text: "V", target: "axes" }, { id: "label_y", text: "P", target: "axes" }]);
const refused = fatal(recorded).filter((issue) => issue.code === "label_targets_axes");
assert.equal(refused.length, 2, "both labels aimed at axes are refused");
assert.match(refused[0]!.message, /xLabel and yLabel/, "the refusal says how to name the axes");

// 2. Mutation: aim the same label at the curve instead; the axes rule must not fire.
assert.equal(fatal(boyle({}, [{ id: "label_y", text: "P", target: "curve" }])).some((issue) => issue.code === "label_targets_axes"), false,
  "a label aimed at another entity is not refused by the axes rule");

const near = (point: { x: number; y: number }, tip: { x: number; y: number }) => Math.hypot(point.x - tip.x, point.y - tip.y);
const titlePrimitive = (compiled: ReturnType<typeof compileSceneDocument>, key: string) =>
  compiled.renderScene?.primitives.find((primitive) => primitive.id === `primitive_axes_${key}`);
const drawnTitles = (compiled: ReturnType<typeof compileSceneDocument>) =>
  (compiled.renderScene?.primitives ?? []).filter((primitive) => /^primitive_axes_[xy]Label$/.test(primitive.id)).map((primitive) => primitive.text);
const curveDrawn = (compiled: ReturnType<typeof compileSceneDocument>) =>
  (compiled.renderScene?.primitives ?? []).some((primitive) => primitive.kind !== "label" && primitive.kind !== "axes" && primitive.id.includes("curve"));

// 3. x on the horizontal and y on the vertical compile at their own arrow
// tips, outside the plot.
const titled = boyle({ xLabel: "x", yLabel: "y" });
assert.deepEqual(fatal(titled), [], "axes titles validate");
const result = compileSceneDocument(titled);
assert.ok(result.ok && result.renderScene, `axes titles compile: ${JSON.stringify(result.report.issues)}`);
const axes = result.renderScene.primitives.find((primitive) => primitive.kind === "axes")!;
const [xStart, xTip, yStart, yTip] = axes.points as [typeof axes.points[number], typeof axes.points[number], typeof axes.points[number], typeof axes.points[number]];
const x = titlePrimitive(result, "xLabel");
const y = titlePrimitive(result, "yLabel");
assert.equal(x?.text, "x");
assert.equal(y?.text, "y");
assert.ok(near(x!.points[0]!, xTip) < near(x!.points[0]!, xStart) && near(x!.points[0]!, xTip) <= 56.1, "x sits at the x arrow tip");
assert.ok(near(y!.points[0]!, yTip) < near(y!.points[0]!, yStart) && near(y!.points[0]!, yTip) <= 56.1, "y sits at the y arrow tip");
assert.ok(near(x!.points[0]!, xTip) < near(x!.points[0]!, yTip), "x is nearer the x tip than the y tip");
assert.ok(near(y!.points[0]!, yTip) < near(y!.points[0]!, xTip), "y is nearer the y tip than the x tip");

// 4. The compiler draws nothing but x on the horizontal and y on the vertical,
// even for a stored or replayed document that never passed the prune. Every
// such document still validates and compiles; the title is simply not drawn.
for (const inputs of [
  { xLabel: "V", yLabel: "P" },
  { xLabel: "y", yLabel: "x" },
  { xLabel: "T (K)", yLabel: "T (K)" },
  { xLabel: "x (m)", yLabel: "y = 3" },
  { yLabel: "pressure of the trapped gas in the syringe" },
  { xLabel: "V = 2 L", yLabel: "P = 300 kPa" },
]) {
  assert.deepEqual(fatal(boyle(inputs)), [], `${JSON.stringify(inputs)} is not refused`);
  const compiled = compileSceneDocument(boyle(inputs));
  assert.ok(compiled.ok && compiled.renderScene && curveDrawn(compiled), `${JSON.stringify(inputs)} still compiles and draws: ${JSON.stringify(compiled.report.issues.filter((issue) => issue.severity === "fatal"))}`);
  assert.deepEqual(drawnTitles(compiled), [], `${JSON.stringify(inputs)} draws no title`);
}

// 5. Axes without titles compile exactly as before: no title primitives.
const plain = compileSceneDocument(boyle({}));
assert.ok(plain.ok && plain.renderScene);
assert.deepEqual(drawnTitles(plain), [], "untitled axes draw no titles");

function plan(question: string, claims: Array<{ claim: string; expected: string }>, quantities: {
  givens?: TurnPlanV3["givens"]; unknowns?: TurnPlanV3["unknowns"]; derived?: TurnPlanV3["derived"];
} = {}): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens: quantities.givens ?? [], unknowns: quantities.unknowns ?? [], derived: quantities.derived ?? [],
    qualitativeClaims: claims.map((claim, index) => ({ id: `c${index + 1}`, ...claim })),
    lawIds: [], assumptions: [], visualRequirement: "required",
  } as TurnPlanV3;
}
// The recorded Boyle plan's claims (short-asks-chem-main): no quantities.
const boylePlan = plan("boyle's law graph", [
  { claim: "Boyle's law: at constant temperature, P = k/V for a fixed mass of gas.", expected: "P = k/V" },
  { claim: "A graph of pressure P (y-axis) against volume V (x-axis) is a rectangular hyperbola.", expected: "P versus V: hyperbola in the first quadrant" },
  { claim: "A graph of pressure P against 1/V is a straight line through the origin.", expected: "P versus 1/V: straight line through origin" },
  { claim: "A graph of PV against P is a horizontal line.", expected: "PV constant" },
  { claim: "At higher T the hyperbola lies further from the axes.", expected: "higher isotherm" },
]);
const titleTexts = (document: SceneDocument) => {
  const inputs = document.constructions.find((construction) => construction.operator === "axes")?.inputs ?? {};
  return { x: inputs.xLabel, y: inputs.yLabel };
};
const omissions = (document: SceneDocument) => ((document.source as Record<string, unknown>).yieldDemotions as Array<{ code: string; path: string }> | undefined ?? [])
  .filter((issue) => issue.code === "axes_title_omitted");
const proofFatal = (document: SceneDocument, turnPlan: TurnPlanV3 | null) => validateTurnPlanSceneProofs(document, turnPlan)
  .filter((issue) => issue.severity === "fatal").map((issue) => issue.code);

/** Prune, revalidate and compile, as the live path does; assert which titles survive and that the figure draws. */
function expectTitles(name: string, inputs: Record<string, string>, turnPlan: TurnPlanV3, expected: { x?: string; y?: string }): void {
  const pruned = pruneUnverifiedSceneAnnotations(boyle(inputs), turnPlan);
  assert.deepEqual(titleTexts(pruned), { x: expected.x, y: expected.y }, `${name}: kept titles`);
  const omittedKeys = Object.keys(inputs).filter((key) => (key === "xLabel" ? expected.x : expected.y) === undefined);
  assert.deepEqual(omissions(pruned).map((issue) => issue.path.split(".").pop()).sort(), omittedKeys.sort(), `${name}: each omitted title is recorded`);
  const revalidated = validateSceneDocument(pruned);
  assert.ok(revalidated.document, `${name}: the pruned figure validates: ${JSON.stringify(revalidated.report.issues.filter((issue) => issue.severity === "fatal"))}`);
  assert.deepEqual(proofFatal(revalidated.document!, turnPlan), [], `${name}: no proof refusal`);
  const compiled = compileSceneDocument(revalidated.document!);
  assert.ok(compiled.ok && compiled.renderScene && curveDrawn(compiled), `${name}: the figure still compiles and draws`);
  assert.deepEqual(drawnTitles(compiled), [expected.x, expected.y].filter((text) => text !== undefined), `${name}: drawn titles`);
}

// 6. The round 2 review probe on the Boyle turn (the curve plots P against V).
// Every title here bound through a claim or question token and drew; each is
// now omitted, and the figure still draws.
expectTitles("T on the P axis (claim 'higher T')", { xLabel: "V", yLabel: "T" }, boylePlan, {});
expectTitles("swapped P and V", { xLabel: "P", yLabel: "V" }, boylePlan, {});
expectTitles("1/V on the V axis of a hyperbola", { xLabel: "1/V", yLabel: "P" }, boylePlan, {});
expectTitles("PV on the P axis", { xLabel: "V", yLabel: "PV" }, boylePlan, {});
expectTitles("k on the P axis", { xLabel: "V", yLabel: "k" }, boylePlan, {});
expectTitles("word: temperature", { xLabel: "V", yLabel: "temperature" }, boylePlan, {});
expectTitles("word: volume and pressure", { xLabel: "volume", yLabel: "pressure" }, boylePlan, {});
expectTitles("name: Boyle", { xLabel: "V", yLabel: "Boyle" }, boylePlan, {});
expectTitles("s through boyle's, and t", { xLabel: "t", yLabel: "s" }, boylePlan, {});
// Changed rows: these drew before the cut and are now omitted, because a
// claim token or a declared symbol does not prove which axis a title names.
expectTitles("V and P on the Boyle turn (was drawn)", { xLabel: "V", yLabel: "P" }, boylePlan, {});
expectTitles("V and P (kPa) on the Boyle turn (was drawn)", { xLabel: "V", yLabel: "P (kPa)" }, boylePlan, {});
const volumePlan = plan("a gas at 2 L is compressed", [{ claim: "pressure P against volume V", expected: "hyperbola" }],
  { givens: [{ id: "V0", symbol: "V", value: 2, unit: "L", provenance: "given" } as TurnPlanV3["givens"][number]] });
expectTitles("plan quantity V (L) (was drawn)", { xLabel: "V (L)", yLabel: "P" }, volumePlan, {});
const motion = plan("distance time graph of a car moving at constant speed", [
  { claim: "Distance d against time t is a straight line whose gradient is the speed.", expected: "straight line through the origin" },
]);
expectTitles("motion t (s) and d (m) (was drawn)", { xLabel: "t (s)", yLabel: "d (m)" }, motion, {});
expectTitles("motion V and P", { xLabel: "V", yLabel: "P" }, motion, {});
const functionPlan = plan("sketch the graph of the given function", [{ claim: "the curve rises", expected: "increasing" }],
  { unknowns: [{ id: "fx", symbol: "f(x)" } as TurnPlanV3["unknowns"][number]] });
expectTitles("declared f(x) (was drawn)", { xLabel: "x", yLabel: "f(x)" }, functionPlan, {});
const battery = plan("current through a lamp on a 12 V battery", [{ claim: "current I against time t stays constant", expected: "horizontal line" }]);
expectTitles("I (A) on a battery turn (was drawn)", { xLabel: "V", yLabel: "I (A)" }, battery, {});

// 7. Numbers on titles: titles are not displayed quantity text (main's audit
// is unchanged), and a title with a value is omitted, never a refusal.
assert.deepEqual(displayedSceneQuantityTexts(boyle({ xLabel: "V = 2 L", yLabel: "P = 300 kPa" })), ["P = k/V"], "the audit reads labels only, as on main");
for (const inputs of [{ xLabel: "V = 2", yLabel: "P (x10^5 Pa)" }, { xLabel: "V = 2 L", yLabel: "P = 300 kPa" }, { xLabel: "x = 3", yLabel: "y (m s-1)" }]) {
  expectTitles(`values ${JSON.stringify(inputs)}`, inputs, boylePlan, {});
  assert.deepEqual(proofFatal(boyle(inputs), null), [], `${JSON.stringify(inputs)} with no plan is not refused`);
  assert.deepEqual(proofFatal(boyle(inputs), boylePlan), [], `${JSON.stringify(inputs)} unpruned is not refused`);
}

// 8. Controls. x on the horizontal and y on the vertical draw in an x and y
// turn, or a turn with no quantities. Either on the wrong axis, or in a turn
// that also has another quantity, is omitted.
const xyPlan = plan("sketch y = x^2", [{ claim: "the curve y = x^2 is a parabola", expected: "parabola" }],
  { unknowns: [{ id: "y", symbol: "y" } as TurnPlanV3["unknowns"][number]], givens: [{ id: "x", symbol: "x", value: 2, unit: "", provenance: "given" } as TurnPlanV3["givens"][number]] });
expectTitles("x and y in an x and y turn", { xLabel: "x", yLabel: "y" }, xyPlan, { x: "x", y: "y" });
expectTitles("x and y in a turn with no quantities", { xLabel: "x", yLabel: "y" }, boylePlan, { x: "x", y: "y" });
expectTitles("y on the horizontal, x on the vertical", { xLabel: "y", yLabel: "x" }, xyPlan, {});
expectTitles("x only in an x and y turn", { xLabel: "x" }, xyPlan, { x: "x" });
const withPressure = plan("sketch y = x^2 and a pressure P", [{ claim: "parabola", expected: "parabola" }],
  { unknowns: [{ id: "y", symbol: "y" }, { id: "P", symbol: "P" }] as TurnPlanV3["unknowns"] });
expectTitles("x and y in a turn that also has P", { xLabel: "x", yLabel: "y" }, withPressure, {});
expectTitles("x with a unit", { xLabel: "x (m)", yLabel: "y (m)" }, xyPlan, {});
const momentum = plan("momentum p of a ball against time", [{ claim: "p against t is a straight line", expected: "line" }]);
expectTitles("P on a momentum turn", { yLabel: "P" }, momentum, {});

// 9. The prompt's own example cannot draw on any turn.
const prompt = readFileSync(new URL("../../../tutor-core/src/planners/scenePlannerV2Prompt.ts", import.meta.url), "utf8");
const example = /xLabel:"([^"]+)", yLabel:"([^"]+)"/.exec(prompt);
assert.ok(example, "the axes contract line carries its example");
assert.doesNotMatch(prompt, /xLabel and yLabel are compact axis titles drawn/, "the prompt does not promise that any title draws");
expectTitles(`the prompt example (${example[1]}, ${example[2]}) on an unrelated turn`, { xLabel: example[1]!, yLabel: example[2]! }, motion, {});
expectTitles(`the prompt example (${example[1]}, ${example[2]}) on the Boyle turn`, { xLabel: example[1]!, yLabel: example[2]! }, boylePlan, {});

console.log("verify-axes-titles: labels aimed at axes refused with the remedy; only x on the horizontal and y on the vertical of an x and y turn draw, at their arrow tips; every other title is omitted, recorded, and the figure still draws");
