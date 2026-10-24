import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
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

console.log("verify-axes-titles: labels aimed at axes refused with the remedy; xLabel and yLabel sit at their arrow tips");
