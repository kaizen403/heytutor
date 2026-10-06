/** Bounded N1/N2 and parent quantity-binding regressions; offline, no READY claim. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { compileSceneDocument } from "../../src/compile/compiler";
import { certifiedPointLineProjection, evaluateAnalyticLineConstruction } from "../../src/compile/analyticLineGeometry";
import { pointLineSourceDocument, readPointLineProgram } from "../../src/ir/pointLineProgram";
import { parseLinearEquation, validatePointLineSourceInputs } from "../../src/ir/pointLineSource";
import { exactBinary64LineResidual, equalBinary64Products } from "../../src/math/exactBinary64";
import type { ProblemIR } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { renderSceneSvg } from "../lib/renderSceneSvg";

const out = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (out) mkdirSync(out, { recursive: true });
const receipts: unknown[] = [];
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string): void {
  check(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
const context = { number: (value: unknown) => { if (typeof value !== "number") throw new Error("number required"); return value; },
  point: () => { throw new Error("literal points only"); }, geometry: () => undefined };
const cores = [
  { id: "general-Q", question: "Find the Perpendicular Foot Q of P(0,0) from 3x+4y-25=0.", point: [0, 0], line: [3, 4, -25], foot: [3, 4], distance: 5, name: "Q" },
  { id: "slope-q", question: "Find the distance and PERPENDICULAR FOOT q of P(1,2) from y=2x+5.", point: [1, 2], line: [-2, 1, -5], foot: [-1, 3], distance: Math.sqrt(5), name: "q" },
  { id: "vertical", question: "Find the distance of A(2,-3) from x=7.", point: [2, -3], line: [1, 0, -7], foot: [7, -3], distance: 5, name: "H" },
  { id: "origin", question: "Find the distance of the origin from y-3=2(x-1).", point: [0, 0], line: [-2, 1, -1], foot: [-.4, .2], distance: 1 / Math.sqrt(5), name: "H" },
  { id: "incident", question: "Find the distance of P(3,4) from 3x+4y-25=0.", point: [3, 4], line: [3, 4, -25], foot: [3, 4], distance: 0, name: "H" },
];
for (const test of cores) {
  const reading = readPointLineProgram(test.question);
  check(reading.status === "ok", test.question);
  close(reading.distance, test.distance, "source distance");
  close(reading.foot.x, test.foot[0]!, "source foot x"); close(reading.foot.y, test.foot[1]!, "source foot y");
  const [a, b, c] = test.line;
  // Hand-specified foot oracles: substitution and normal direction, independent of helper.
  close(a! * test.foot[0]! + b! * test.foot[1]! + c!, 0, "hand incidence");
  close((test.point[0]! - test.foot[0]!) * b! - (test.point[1]! - test.foot[1]!) * a!, 0, "hand perpendicular");
  const document = pointLineSourceDocument(test.question);
  check(document, "complete source document");
  check(document.entities.find(row => row.id === "foot")?.label === test.name, "foot case retained");
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report));
  const scene = compiled.renderScene;
  check(synthesizeFamilyScene({ question: test.question }), "family admission");
  const connector = scene.primitives.find(row => row.entityId === "projection_distance" && row.kind !== "label");
  const point = scene.primitives.find(row => row.entityId === "source_point" && row.kind !== "label")?.points[0];
  const foot = scene.primitives.find(row => row.entityId === "foot" && row.kind !== "label")?.points[0];
  check(point && foot, "actual source/foot ink exists");
  if (test.distance === 0) check((!connector || connector.kind === "point") && point.x === foot.x && point.y === foot.y, "true incidence has no fake connector (coincident ink may be deduplicated)");
  else {
    check(connector && connector.points.length === 2, "distance is a two-ended connector");
    close(connector.points[0]!.x, point.x, "ink starts at source x"); close(connector.points[0]!.y, point.y, "ink starts at source y");
    close(connector.points[1]!.x, foot.x, "ink ends at foot x"); close(connector.points[1]!.y, foot.y, "ink ends at foot y");
  }
  check(scene.primitives.some(row => row.entityId === "foot" && row.kind === "label" && row.text === test.name), "actual foot label retains identity");
  check(scene.primitives.some(row => row.entityId === "projection_distance" && row.kind === "label" && row.text?.startsWith(test.distance === 0 ? "d=0" : "d")), "actual distance label");
  check(document.annotations.filter(row => row.targetIds.includes("projection_distance") && row.quantityId === "projection_d").length === 1, "source-only deterministic distance link");
  check(document.quantities.find(row => row.id === "projection_d")?.value === reading.distance, "source-only quantity recomputed");
  check(scene.primitives.every(row => row.points.every(p => p.x >= 400 && p.x <= 1160 && p.y >= 0 && p.y <= 700)), "actual geometry in board zone");
  if (out) { writeFileSync(join(out, `${test.id}.svg`), renderSceneSvg(scene, { title: test.id, subtitle: test.question })); writeFileSync(join(out, `${test.id}.json`), JSON.stringify({ document, scene }, null, 2)); }
  receipts.push({ id: test.id, distance: reading.distance, foot: reading.foot, footName: test.name, compiled: true });
}

// Exact binary64 bit oracles, including product cancellation and subnormal boundaries.
check(exactBinary64LineResidual({ a: 1, b: 1, c: -10 }, { x: 10, y: 1e-16 }) === 1e-16, "additive cancellation retains nonzero bits");
check(exactBinary64LineResidual({ a: 1, b: 1, c: -1e8 }, { x: 1e8, y: 1e-9 }) === 1e-9, "large additive cancellation");
// (1+2^-27)(1-2^-27)-1 = -2^-54, while the rounded product equals 1.
check(exactBinary64LineResidual({ a: 1 + 2 ** -27, b: 0, c: -1 }, { x: 1 - 2 ** -27, y: 0 }) === -(2 ** -54), "multiplication cancellation");
check(exactBinary64LineResidual({ a: 1, b: 0, c: 0 }, { x: Number.MIN_VALUE, y: 0 }) === Number.MIN_VALUE, "minimum subnormal remains nonzero");
assert.throws(() => exactBinary64LineResidual({ a: .5, b: 0, c: 0 }, { x: Number.MIN_VALUE, y: 0 })); checks++;
check(equalBinary64Products(3, -8, 4, -6), "extracted proportional authority");
check(!equalBinary64Products(1, 1e11, 1, 1e11 + .001), "proportional authority retains changed large intercept");

for (const [x, y, c] of [[10, 1e-16, -10], [1e8, 1e-9, -1e8], [0, 1e-8, 0], [10, -1e-16, -10]] as const) {
  const question = `Find the distance of P(${x},${y.toFixed(18)}) from x+y${c < 0 ? c : "+0"}=0.`;
  check(readPointLineProgram(question).status === "declined", "below precision source must decline whole");
  check(pointLineSourceDocument(question) === null, "no below precision document");
  check(synthesizeFamilyScene({ question }) === null, "no false family certification");
  assert.throws(() => evaluateAnalyticLineConstruction("point_line_distance", { point: [x, y], a: 1, b: 1, c }, context)); checks++;
  const forged = structuredClone(pointLineSourceDocument(cores[4]!.question)!);
  forged.source.question = question;
  forged.constructions.find(row => row.operator === "point")!.inputs = { x, y, coordinateSpace: "world" };
  for (const row of forged.constructions.filter(row => ["line_equation", "point_line_distance"].includes(row.operator))) Object.assign(row.inputs, { a: 1, b: 1, c });
  forged.annotations = []; forged.quantities = []; // no program annotations/provenance required by the generic guard
  const compiled = compileSceneDocument(forged);
  check(!compiled.ok && compiled.renderScene === null, "caller-forged incident d=0 rejects atomically");
  check(compiled.report.issues.some(row => row.severity === "fatal" && row.code.startsWith("invalid_point_line_distance_")), "generic distance guard independently rejects");
  // Remove the distance operator entirely: the generic project must still reject.
  const projectOnly = structuredClone(forged);
  projectOnly.constructions = projectOnly.constructions.filter(row => row.operator !== "point_line_distance");
  projectOnly.entities = projectOnly.entities.filter(row => row.id !== "projection_distance");
  projectOnly.requiredEntityIds = projectOnly.requiredEntityIds.filter(id => id !== "projection_distance");
  for (const group of projectOnly.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "projection_distance");
  projectOnly.assertions = [];
  const projection = compileSceneDocument(projectOnly);
  check(!projection.ok && projection.renderScene === null, "project-only candidate rejects atomically");
  check(projection.report.issues.some(row => row.code === "invalid_project_geometry"), "generic foot guard independent of distance/source-only program");
  receipts.push({ question, outcome: "declined_below_geometry_precision", genericDistance: "rejected", genericProject: "rejected" });
}
for (const question of [
  "Find the distance of P(10,0.0000000000000001) from x+y=10.",
  "Find the distance of P(100000000,0.000000001) from x+y=100000000.",
]) {
  check(readPointLineProgram(question).status === "declined" && pointLineSourceDocument(question) === null && synthesizeFamilyScene({ question }) === null, "exact N1 review wording declines, never d=0");
}
// Strict precision applies even when the scalar distance is drawable but the foot cannot be encoded.
assert.throws(() => certifiedPointLineProjection({ x: 1e12, y: 1e-5 }, { a: 1, b: 1, c: -1e12 })); checks++;
for (const question of [
  "Find the perpendicular foot Q of P(0,0) from 3x+4y-25=0.",
  "Find the PERPENDICULAR FOOT Q of P(0,0) from 3x+4y-25=0.",
  "Find the perpendicular foot q of P(0,0) from 3x+4y-25=0.",
  "Find the Foot of the Perpendicular Q of P(0,0) from 3x+4y-25=0.",
  "Find the PERPENDICULAR FOOT Q and distance of P(0,0) from 3x+4y-25=0.",
]) {
  const result = readPointLineProgram(question);
  check(result.status === "ok" && result.footName === (question.includes("foot q") ? "q" : "Q"), "one successful grammar capture preserves original case");
}
for (const name of ["p", "Q1", "q'", "Qa2'"]) {
  const question = `Find the Perpendicular Foot ${name} of P(0,0) from 3x+4y-25=0.`;
  const result = readPointLineProgram(question), document = pointLineSourceDocument(question);
  check(result.status === "ok" && result.footName === name && document?.entities.find(row => row.id === "foot")?.label === name, "supported identifier policy preserves the complete original name");
}
for (const keyword of ["perpendicular foot", "Perpendicular Foot", "PERPENDICULAR FOOT", "Foot of the Perpendicular"]) {
  const question = `Find the ${keyword} P of P(0,0) from 3x+4y-25=0.`;
  check(readPointLineProgram(question).status === "declined" && pointLineSourceDocument(question) === null, "case-independent keyword collision rejects");
}
for (const name of ["Q_1", "LongName", "1Q", "Q′", "Q11"]) {
  check(readPointLineProgram(`Find the Perpendicular Foot ${name} of P(0,0) from 3x+4y-25=0.`).status === "declined", "unsupported supplied name never silently becomes H");
}
check(pointLineSourceDocument("Find the Perpendicular Foot L of P(0,0) from 3x+4y-25=0.") === null, "foot-line label collision rejects");
for (const caption of ["q=(7,1)", "Q=(3,4)", "q(7,1)"]) {
  const lower = pointLineSourceDocument("Find the perpendicular foot q of P(0,0) from 3x+4y-25=0.")!;
  lower.annotations.push({ id: "wrongFootCaption", kind: "label", targetIds: ["foot"], text: caption });
  check(validatePointLineSourceInputs(lower, lower.source.question).some(row => row.severity === "fatal"), "lowercase foot captions retain case and coordinates");
}
const sourceQ = pointLineSourceDocument("Find the distance of Q(0,0) from 3x+4y-25=0.");
check(sourceQ && sourceQ.entities.find(row => row.id === "source_point")?.label === "Q" && compileSceneDocument(sourceQ).ok, "sourceNameQ normal positive retained");

// Old F1/F2/F3 exact reproductions, without weakening their independent old gate.
for (const suffix of [" Also draw a circle of radius 2 centred at P.", " Also mark Q(a,b).", " Also mark Q(1/0,2).", " Also mark Q(NaN,2).", " Also mark Q(1,2,3)."]) {
  check(pointLineSourceDocument(cores[2]!.question + suffix) === null, "F1 whole request retained");
}
for (const [question, operator, mutate] of [
  ["Find the distance of P(100000000000,1) from y=0.", "point", { y: 1.001 }],
  ["Find the distance of P(100000000001,0) from x=100000000000.", "line_equation", { c: -100000000000.001 }],
] as const) {
  const document = pointLineSourceDocument(question)!;
  check(document && compileSceneDocument(document).ok, "F2 unmodified large values compile");
  for (const row of document.constructions.filter(row => row.operator === operator || operator === "line_equation" && row.operator === "point_line_distance")) Object.assign(row.inputs, mutate);
  check(validatePointLineSourceInputs(document, question).some(row => row.severity === "fatal"), "F2 exact source binding");
  const result = compileSceneDocument(document); check(!result.ok && result.renderScene === null, "F2 mutation atomic rejection");
}
const tiny = `0.${"0".repeat(350)}1`;
check(readPointLineProgram(`Find the distance of P(${tiny},1) from x=0.`).status === "declined", "F3 tiny coordinate declines");
check(parseLinearEquation(`x=${tiny}`) === null, "F3 tiny coefficient declines");
check(readPointLineProgram("Find the distance of P(1.00000000000000001,1) from x=1.").status === "declined", "F3 lost digits decline");
assert.deepEqual(parseLinearEquation("x+(1000000000000+0.001-1000000000000)=0"), { a: 1, b: 0, c: .001 }); checks++;
check(pointLineSourceDocument("Find the distance of P(1/2,-3/2) from x/2+y/4=2."), "terminating coefficients and coordinates retained");
check(parseLinearEquation("x/3=1") === null, "nonterminating source conversion remains unsupported");

// Full-IR parent integration requirement: carry exactly the validated solver/plan id.
const fullQuestion = "Find the distance and Perpendicular Foot Q of P(0,0) from 3x+4y-25=0.";
const fact = (id: string, kind: "given" | "requested", quote: string): ProblemIR["facts"][number] => {
  const start = fullQuestion.indexOf(quote); assert.ok(start >= 0);
  return { id, kind, statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } };
};
const ir: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "projectionPrecision", question: fullQuestion,
  facts: [fact("pFact", "given", "P(0,0)"), fact("lFact", "given", "3x+4y-25=0"), fact("rFact", "requested", "distance and Perpendicular Foot Q")],
  entities: [{ id: "P", kind: "point", label: "P", evidenceFactIds: ["pFact"] }, { id: "line", kind: "line", label: "L", evidenceFactIds: ["lFact"] }, { id: "Q", kind: "point", label: "Q", evidenceFactIds: ["rFact"] }],
  expressions: [{ id: "distance", valueType: "scalar", root: { kind: "number", value: 5 }, evidenceFactIds: ["pFact", "lFact", "rFact"] }],
  constraints: [{ id: "footIncident", kind: "incident", entityIds: ["Q", "line"], evidenceFactIds: ["rFact"] }],
  representationIntents: [{ id: "whole", kind: "graph", entityIds: ["P", "line", "Q"], evidenceFactIds: ["pFact", "lFact", "rFact"] }],
  solveRequests: [{ id: "distanceRequest", kind: "evaluate", expressionId: "distance", resultBinding: { turnPlanQuantityId: "actualPlanDistance", symbol: "distance", unit: "units", evidenceFactIds: ["rFact"] } }],
};
const before = structuredClone(ir), bound = pointLineSourceDocument(fullQuestion, ir);
check(bound, "whole IR agreement retained");
assert.deepEqual(ir, before); checks++;
const links = bound.annotations.filter(row => row.targetIds.includes("projection_distance") && row.quantityId);
check(links.length === 1 && links[0]!.quantityId === "actualPlanDistance" && links[0]!.targetIds.length === 1, "exactly one true distance annotation");
const quantity = bound.quantities.find(row => row.id === "actualPlanDistance");
check(quantity?.value === 5 && quantity.symbol === "distance" && quantity.unit === "units", "source-computed value and validated binding symbol/unit");
assert.deepEqual(quantity?.evidenceFactIds, ["rFact"]); checks++;
check(!bound.quantities.some(row => row.id === "projection_d"), "no invented plan binding when caller supplied IR");
check(compileSceneDocument(bound).ok && synthesizeFamilyScene({ question: fullQuestion, problemIR: ir }), "full IR source compile and family admission");
for (const mutate of [
  (copy: ProblemIR) => { delete copy.solveRequests[0]!.resultBinding; },
  (copy: ProblemIR) => { copy.solveRequests[0]!.resultBinding!.turnPlanQuantityId = ""; },
  (copy: ProblemIR) => { copy.solveRequests[0]!.resultBinding!.unit = "m"; },
  (copy: ProblemIR) => { copy.solveRequests[0]!.resultBinding!.evidenceFactIds = ["pFact"]; },
  (copy: ProblemIR) => { copy.expressions[0]!.root = { kind: "number", value: 0 }; },
  (copy: ProblemIR) => { copy.solveRequests.push(structuredClone(copy.solveRequests[0]!)); copy.solveRequests[1]!.id = "secondDistance"; },
]) {
  const wrong = structuredClone(ir); mutate(wrong);
  check(pointLineSourceDocument(fullQuestion, wrong) === null, "unbound/contradictory/ambiguous claimed distance declines");
}
if (out) writeFileSync(join(out, "full-ir-distance-binding.json"), JSON.stringify({ problemIR: ir, document: bound }, null, 2));
if (out) writeFileSync(join(out, "receipts.json"), JSON.stringify({ checks, cores: receipts, studentRun: "unrun", persistence: "parent_integration_required" }, null, 2));
console.log(JSON.stringify({ gate: "w2-projection-precision", cores: cores.length, checks, studentRun: "not_claimed", parentBinding: "offline_source_document_only" }));
