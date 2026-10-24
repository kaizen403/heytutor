import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import {
  displayedSceneQuantityTexts, pruneUnverifiedSceneAnnotations, validateSceneQuantityAgreement, validateTurnPlanSceneProofs,
  type TurnPlanV3,
} from "../../src/contracts/contractsV3";
import { validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

// "boyle's law graph" (short-asks-chem-main, judged partial): every planner
// candidate named the axes with label constructions aimed at the axes entity
// (or at the curve). A label construction stands on its target's centre, and
// the centre of an axes object is the middle of the plot, so "P" and "V"
// floated inside the graph and named neither axis. Axes now take their own
// titles (xLabel, yLabel) drawn at the arrow tips, and a label aimed at axes
// is refused with a message that says how to name them.

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

// 3. The remedy compiles: each title sits at its own arrow tip, outside the plot.
const titled = boyle({ xLabel: "V", yLabel: "P" });
assert.deepEqual(fatal(titled), [], "axes titles validate");
const result = compileSceneDocument(titled);
assert.ok(result.ok && result.renderScene, `axes titles compile: ${JSON.stringify(result.report.issues)}`);
const primitives = result.renderScene.primitives;
const axes = primitives.find((primitive) => primitive.kind === "axes")!;
const [xStart, xTip, yStart, yTip] = axes.points as [typeof axes.points[number], typeof axes.points[number], typeof axes.points[number], typeof axes.points[number]];
const title = (key: string) => primitives.find((primitive) => primitive.id === `primitive_axes_${key}`);
const x = title("xLabel");
const y = title("yLabel");
assert.equal(x?.text, "V");
assert.equal(y?.text, "P");
const near = (point: { x: number; y: number }, tip: { x: number; y: number }) => Math.hypot(point.x - tip.x, point.y - tip.y);
assert.ok(near(x!.points[0]!, xTip) < near(x!.points[0]!, xStart) && near(x!.points[0]!, xTip) <= 56.1, "V sits at the x arrow tip");
assert.ok(near(y!.points[0]!, yTip) < near(y!.points[0]!, yStart) && near(y!.points[0]!, yTip) <= 56.1, "P sits at the y arrow tip");
assert.ok(near(x!.points[0]!, xTip) < near(x!.points[0]!, yTip), "V is nearer the x tip than the y tip");
assert.ok(near(y!.points[0]!, yTip) < near(y!.points[0]!, xTip), "P is nearer the y tip than the x tip");

// 4. Titles are compact labels; prose is refused.
assert.ok(fatal(boyle({ yLabel: "pressure of the trapped gas in the syringe" })).some((issue) => issue.code === "invalid_axes_title"), "long axis title refused");

// 5. Axes without titles compile exactly as before: no title primitives.
const plain = compileSceneDocument(boyle({}));
assert.ok(plain.ok && plain.renderScene);
assert.equal(plain.renderScene.primitives.some((primitive) => /^primitive_axes_[xy]Label$/.test(primitive.id)), false, "untitled axes draw no titles");

// 6. Equal titles on both axes ("T (K)" against "T (K)" for a before and after
// plot) are two titles, not a duplicate: both draw, each at its own tip.
const twin = compileSceneDocument(boyle({ xLabel: "T (K)", yLabel: "T (K)" }));
assert.ok(twin.ok && twin.renderScene, `equal axis titles compile: ${JSON.stringify(twin.report.issues.filter((issue) => issue.severity === "fatal"))}`);
const twinTitle = (key: string) => twin.renderScene!.primitives.find((primitive) => primitive.id === `primitive_axes_${key}`);
assert.equal(twinTitle("xLabel")?.text, "T (K)", "the x title draws");
assert.equal(twinTitle("yLabel")?.text, "T (K)", "the y title draws");
assert.ok(near(twinTitle("xLabel")!.points[0]!, xTip) < near(twinTitle("xLabel")!.points[0]!, yTip), "the x title sits at the x tip");
assert.ok(near(twinTitle("yLabel")!.points[0]!, yTip) < near(twinTitle("yLabel")!.points[0]!, xTip), "the y title sits at the y tip");

// Numeric authority and turn binding. A title is displayed text like any
// label, so the TurnPlanV3 audit reads it, and a title that names nothing in
// the turn is omitted (and recorded) rather than drawn.
function plan(question: string, claims: Array<{ claim: string; expected: string }>, givens: TurnPlanV3["givens"] = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [],
    qualitativeClaims: claims.map((claim, index) => ({ id: `c${index + 1}`, ...claim })),
    lawIds: [], assumptions: [], visualRequirement: "required",
  } as TurnPlanV3;
}
// The recorded Boyle plan's own claim (short-asks-chem-main): no quantities.
const boylePlan = plan("boyle's law graph", [
  { claim: "A graph of pressure P (y-axis) against volume V (x-axis) is a rectangular hyperbola.", expected: "P versus V: hyperbola in the first quadrant" },
  { claim: "A graph of pressure P against 1/V is a straight line through the origin.", expected: "P versus 1/V: straight line through origin" },
]);
const titleTexts = (document: SceneDocument) => {
  const inputs = document.constructions.find((construction) => construction.operator === "axes")?.inputs ?? {};
  return { x: inputs.xLabel, y: inputs.yLabel };
};
const omissions = (document: SceneDocument) => ((document.source as Record<string, unknown>).yieldDemotions as Array<{ code: string }> | undefined ?? [])
  .filter((issue) => issue.code === "axes_title_omitted");
const proofFatal = (document: SceneDocument, turnPlan: TurnPlanV3) => validateTurnPlanSceneProofs(document, turnPlan)
  .filter((issue) => issue.severity === "fatal").map((issue) => issue.code);

// 7. The audit reads axis titles. "P = 300 kPa" is refused as a title exactly
// as it is refused as a label; the plan holds no such value.
const valued = boyle({ xLabel: "V = 2 L", yLabel: "P = 300 kPa" });
assert.ok(displayedSceneQuantityTexts(valued).includes("P = 300 kPa"), "the audit reads the y title");
assert.ok(displayedSceneQuantityTexts(valued).includes("V = 2 L"), "the audit reads the x title");
const valuedIssues = validateSceneQuantityAgreement([], boylePlan, displayedSceneQuantityTexts(valued)).map((issue) => issue.code);
assert.equal(valuedIssues.filter((code) => code === "displayed_quantity_unverified").length, 2, `unverified title values refused: ${valuedIssues}`);
// Control: the value the plan holds is certified on a title.
const volumePlan = plan("a gas at 2 L is compressed", [{ claim: "pressure P against volume V", expected: "hyperbola" }],
  [{ id: "V0", symbol: "V", value: 2, unit: "L", provenance: "given" } as TurnPlanV3["givens"][number]]);
const certified = boyle({ xLabel: "V (L)", yLabel: "P" });
assert.deepEqual(validateSceneQuantityAgreement([], volumePlan, displayedSceneQuantityTexts(boyle({ xLabel: "V = 2 L" }))), [], "a planned value on a title is certified");
assert.deepEqual(proofFatal(boyle({ xLabel: "V = 2 L" }), volumePlan), [], "a certified title number is not refused");

// 8. A title that carries a number the audit does not certify is refused,
// even when no unit makes it a measured value.
assert.ok(proofFatal(boyle({ xLabel: "V = 2" }), boylePlan).includes("axes_title_number_unverified"), "a bare number on a title is refused");
assert.ok(proofFatal(boyle({ yLabel: "P (x10^5 Pa)" }), boylePlan).includes("axes_title_number_unverified"), "a scale factor the plan does not hold is refused");
assert.ok(proofFatal(boyle({ yLabel: "P = 300 kPa" }), boylePlan).includes("axes_title_number_unverified"), "an unverified measured value on a title is refused");
assert.ok(proofFatal(boyle({ yLabel: "P = 300 kPa" }), null).includes("axes_title_number_unverified"), "with no plan, nothing certifies a title number");
// Controls: symbols and units with digits copied from the turn are not numbers.
assert.deepEqual(proofFatal(boyle({ xLabel: "1/V", yLabel: "P (kPa)" }), boylePlan), [], "1/V named by the plan and a bare unit pass");
assert.deepEqual(proofFatal(boyle({ xLabel: "V₂ (cm³)", yLabel: "P2" }), boylePlan).filter((code) => code === "axes_title_number_unverified"), [], "subscripts and unit powers are not numbers");

// 9. A title is drawn only when the turn names its symbol: a plan symbol, a
// whole token of the question or the claims, or x or y.
const bound = pruneUnverifiedSceneAnnotations(boyle({ xLabel: "V", yLabel: "P (kPa)" }), boylePlan);
assert.deepEqual(titleTexts(bound), { x: "V", y: "P (kPa)" }, "Boyle keeps its titles: claim c2 names P and V");
assert.deepEqual(omissions(bound), [], "nothing is omitted on the Boyle turn");
assert.deepEqual(titleTexts(pruneUnverifiedSceneAnnotations(certified, volumePlan)), { x: "V (L)", y: "P" }, "a plan quantity symbol binds");
const motion = plan("distance time graph of a car moving at constant speed", [
  { claim: "Distance d against time t is a straight line whose gradient is the speed.", expected: "straight line through the origin" },
]);
const strayed = pruneUnverifiedSceneAnnotations(boyle({ xLabel: "V", yLabel: "P" }), motion);
assert.deepEqual(titleTexts(strayed), { x: undefined, y: undefined }, "titles the turn never names are omitted");
assert.equal(omissions(strayed).length, 2, "each omitted title is recorded");
const strayedCompiled = compileSceneDocument(strayed);
assert.ok(strayedCompiled.ok && strayedCompiled.renderScene, "the figure still draws without the omitted titles");
assert.equal(strayedCompiled.renderScene.primitives.some((primitive) => /^primitive_axes_[xy]Label$/.test(primitive.id)), false, "no omitted title is drawn");
const motionTitled = pruneUnverifiedSceneAnnotations(boyle({ xLabel: "t (s)", yLabel: "d (m)" }), motion);
assert.deepEqual(titleTexts(motionTitled), { x: "t (s)", y: "d (m)" }, "the motion turn keeps its own symbols");
assert.deepEqual(titleTexts(pruneUnverifiedSceneAnnotations(boyle({ xLabel: "x", yLabel: "y" }), motion)), { x: "x", y: "y" }, "x and y always bind");
// A unit after a number is not the symbol: "a 12 V battery" does not name V.
const battery = plan("current through a lamp on a 12 V battery", [{ claim: "current I against time t stays constant", expected: "horizontal line" }]);
assert.deepEqual(titleTexts(pruneUnverifiedSceneAnnotations(boyle({ xLabel: "V", yLabel: "I (A)" }), battery)), { x: undefined, y: "I (A)" }, "a unit token does not bind a title");
// Case matters for one letter symbols: p (momentum) does not name P.
const momentum = plan("momentum p of a ball against time", [{ claim: "p against t is a straight line", expected: "line" }]);
assert.equal(titleTexts(pruneUnverifiedSceneAnnotations(boyle({ yLabel: "P" }), momentum)).y, undefined, "p does not bind P");

// 10. The prompt's own example cannot leak into an unrelated turn.
const prompt = readFileSync(new URL("../../../tutor-core/src/planners/scenePlannerV2Prompt.ts", import.meta.url), "utf8");
const example = /xLabel:"([^"]+)", yLabel:"([^"]+)"/.exec(prompt);
assert.ok(example, "the axes contract line carries its example");
const leaked = pruneUnverifiedSceneAnnotations(boyle({ xLabel: example[1], yLabel: example[2] }), motion);
assert.deepEqual(titleTexts(leaked), { x: undefined, y: undefined }, `the prompt example (${example[1]}, ${example[2]}) is omitted on an unrelated turn`);

console.log("verify-axes-titles: labels aimed at axes refused with the remedy; xLabel and yLabel sit at their arrow tips; titles pass the numeric audit and bind to the turn");
