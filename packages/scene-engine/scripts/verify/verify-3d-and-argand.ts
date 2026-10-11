/**
 * Harness 4 gate: Argand loop curves and 3D figure drawing.
 *
 * Argand: the planner draws |z| = r as a parametric circle and asks for dense odd sample counts
 * (193, 257, 361 in recorded turns). Those were fatal above 161, so the circle never drew.
 */
import { compileSceneDocument, validateSceneDocument } from "../../src/index";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) return;
  failures += 1;
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

function curveDocument(operator: string, inputs: Record<string, unknown>) {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "draw the locus |z| = 2 on the Argand plane" },
    source: { question: "If |z| = 2, find the greatest and least values of |z + 6 - 8i|" },
    quantities: [],
    entities: [{ id: "circle", kind: "polyline", role: "locus |z| = 2", label: "|z|=2" }],
    constructions: [{ id: "make_circle", operator, inputs, outputs: ["circle"] }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["circle"],
    revealGroups: [{ id: "locus", entityIds: ["circle"], dependsOn: [], narrationCue: "show the circle" }],
    teachingTimeline: [{ id: "show_locus", action: "reveal", targetId: "locus", dependsOn: [], narrationIntent: "draw the locus" }],
  };
}

function compiledCurve(operator: string, inputs: Record<string, unknown>) {
  const validation = validateSceneDocument(curveDocument(operator, inputs));
  const compiled = validation.document ? compileSceneDocument(validation.document) : null;
  const primitive = compiled?.renderScene?.primitives.find((entry) => entry.entityId === "circle");
  return {
    issues: (compiled?.report.issues ?? validation.report.issues).map((issue) => issue.code),
    ok: Boolean(compiled?.ok),
    points: primitive?.kind === "polyline" ? primitive.points : null,
  };
}

// Recorded planner requests for the Argand circle now draw a closed circle of radius 2.
for (const samples of [193, 257, 361]) {
  const circle = compiledCurve("parametric_curve", {
    xExpression: "2*cos(t)", yExpression: "2*sin(t)", parameter: "t", tMin: 0, tMax: 2 * Math.PI, samples,
  });
  check(`parametric circle with ${samples} samples compiles`, circle.ok && circle.points?.length === samples, circle.issues.join(","));
}
const polar = compiledCurve("polar_curve", { radiusExpression: "2", parameter: "theta", thetaMin: 0, thetaMax: 2 * Math.PI, samples: 257 });
check("polar circle with 257 samples compiles", polar.ok && polar.points?.length === 257, polar.issues.join(","));

// The contract stays strict: even counts, counts past 513, and other curve operators are unchanged.
for (const [operator, inputs, code] of [
  ["parametric_curve", { xExpression: "2*cos(t)", yExpression: "2*sin(t)", tMin: 0, tMax: 6.28, samples: 256 }, "invalid_parametric_curve_samples"],
  ["parametric_curve", { xExpression: "2*cos(t)", yExpression: "2*sin(t)", tMin: 0, tMax: 6.28, samples: 515 }, "invalid_parametric_curve_samples"],
  ["function_curve", { expression: "x^2", variable: "x", xMin: -2, xMax: 2, samples: 257 }, "invalid_function_samples"],
] as const) {
  const result = compiledCurve(operator, inputs);
  check(`${operator} samples ${String(inputs.samples)} still rejected`, !result.ok && result.issues.includes(code), result.issues.join(","));
}

if (failures > 0) {
  console.error(`verify-3d-and-argand: ${failures} failure(s)`);
  process.exit(1);
}
console.log("verify-3d-and-argand: ok");
