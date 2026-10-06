/** Bounded public-compiler N2 identity controls; source TS and own built ESM. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import * as sourceAPI from "../../src/index";
import type { SceneDocument } from "../../src/types";
import type { ProblemIR } from "../../src/ir/problemIR";

const built = process.argv.includes("--built");
const api: Pick<typeof sourceAPI, "pointLineSourceDocument" | "readPointLineProgram" | "compileSceneDocument" | "validatePointLineSourceInputs"> = built
  ? await import("../../dist/index.js") : sourceAPI;
const output = process.argv.find((argument, index) => index > 1 && !argument.startsWith("--"));
const receipts: Array<{ id: string; ok: boolean; [key: string]: unknown }> = [];
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
const question = "Find the Perpendicular Foot Q of P(0,0) from 3x+4y-25=0.";
function scene(q = question): SceneDocument {
  const document = api.pointLineSourceDocument(q);
  check(document, `whole source document: ${q}`);
  return document;
}
function setLabel(document: SceneDocument, id: string, label?: string): void {
  const entity = document.entities.find(row => row.id === id)!;
  if (label === undefined) delete entity.label; else entity.label = label;
}
function positive(id: string, document: SceneDocument, name = "Q"): void {
  check(!api.validatePointLineSourceInputs(document, document.source.question).some(issue => issue.severity === "fatal"), `${id}: source guard`);
  const result = api.compileSceneDocument(document);
  check(result.ok && result.renderScene, `${id}: ${JSON.stringify(result.report)}`);
  check(result.renderScene.primitives.some(row => row.kind === "label" && row.text === name), `${id}: actual requested label ink`);
  receipts.push({ id, ok: true, document, scene: result.renderScene });
}
function negative(id: string, document: SceneDocument): void {
  const sourceIssues = api.validatePointLineSourceInputs(document, document.source.question);
  check(sourceIssues.some(issue => issue.severity === "fatal"), `${id}: independently rejects at source guard`);
  const result = api.compileSceneDocument(document);
  check(!result.ok, `${id}: ${JSON.stringify(result.report)}`);
  check(result.renderScene === null, `${id}: rejects atomically`);
  receipts.push({ id, ok: false, sourceIssues, issues: result.report.issues });
}
function mutate(id: string, edit: (document: SceneDocument) => void, base = scene()): void {
  const document = structuredClone(base); edit(document); negative(id, document);
}
function projectOnly(document: SceneDocument): void {
  document.constructions = document.constructions.filter(row => row.operator !== "point_line_distance");
  document.entities = document.entities.filter(row => row.id !== "projection_distance");
  document.requiredEntityIds = document.requiredEntityIds.filter(id => id !== "projection_distance");
  for (const group of document.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "projection_distance");
  document.quantities = []; document.annotations = []; document.assertions = [];
  for (const entity of document.entities) entity.role = "caller supplied";
  document.visualDecision.reason = "Caller document without program markers";
}
function literalFoot(document: SceneDocument): void {
  const producer = document.constructions.find(row => row.operator === "project")!;
  producer.operator = "point"; producer.inputs = { x: 3, y: 4, coordinateSpace: "world" };
}
function renameId(document: SceneDocument, from: string, to: string): SceneDocument {
  // Deliberately change references and IDs while leaving visible labels alone.
  const visit = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return !["label", "text"].includes(key) && value === from ? to : value;
    if (Array.isArray(value)) return value.map(row => visit(row, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
    return value;
  };
  return visit(document) as SceneDocument;
}

// Independent oracle: 3*3+4*4=25, (3,4) is along the normal from P=(0,0), d=5.
for (const keyword of ["perpendicular foot", "Perpendicular Foot", "PERPENDICULAR FOOT", "Foot of the Perpendicular"])
  for (const name of ["Q", "q", "Qa2'", "q2'"]) {
    const q = `Find the ${keyword} ${name} of P(0,0) from 3x+4y-25=0.`;
    const reading = api.readPointLineProgram(q);
    check(reading.status === "ok" && reading.footName === name && reading.foot.x === 3 && reading.foot.y === 4 && reading.distance === 5, "source identity and independent geometry oracle");
    const document = scene(q); positive(`${keyword}-${name}`, document, name);
    for (const wrong of ["P", "H", name === "Q" ? "q" : "Q"]) mutate(`${keyword}-${name}-wrong-${wrong}`, doc => setLabel(doc, "foot", wrong), document);
  }
for (const q of [
  "Find the distance and PERPENDICULAR FOOT q of P(1,2) from y=2x+5.",
  "Calculate the Foot of the Perpendicular Q and distance from P(0,0) to 3x+4y-25=0.",
  "Determine the perpendicular foot Q of P(3,4) from 3x+4y-25=0.",
  "Find the perpendicular foot Q of the origin from 3x+4y-25=0.",
]) positive("complete-form-control", scene(q), q.includes("FOOT q") ? "q" : "Q");

const base = scene();
positive("original-Q", base);
for (const wrong of ["H", "q", "P", "R2'", "invented name", ""]) mutate(`entity-label-${wrong}`, doc => setLabel(doc, "foot", wrong), base);
mutate("missing-name", doc => setLabel(doc, "foot"), base);
for (const text of ["H=(3,4)", "q(3,4)", "P=(3,4)", "Q=(4,3)"])
  mutate(`entity-tuple-${text}`, doc => setLabel(doc, "foot", text), base);
for (const label of ["Q=(3,4)", "Q(3,4)"]) {
  const document = structuredClone(base); literalFoot(document); setLabel(document, "foot", label); positive("correct-literal-entity-tuple", document, label);
}
for (const text of ["H", "q", "P(3,4)", "H=(3,4)", "Q=(4,3)"])
  mutate(`annotation-${text}`, doc => doc.annotations.push({ id: "caller_caption", kind: "label", targetIds: ["foot"], text }), base);
mutate("correct-caption-cannot-cover-wrong-label", doc => {
  setLabel(doc, "foot", "P"); doc.annotations.push({ id: "correct_caption", kind: "label", targetIds: ["foot"], text: "Q=(3,4)" });
}, base);
mutate("correct-label-cannot-cover-source-point-caption", doc => doc.annotations.push({ id: "bad_P", kind: "label", targetIds: ["source_point"], text: "Q=(0,0)" }), base);
mutate("renamed-source-point", doc => setLabel(doc, "source_point", "Q"), base);
mutate("line-name-collision", doc => setLabel(doc, "source_line", "Q"), base);
mutate("source-name-collision", doc => { doc.source.question = question.replace("Foot Q", "Foot P"); setLabel(doc, "foot", "P"); }, base);
mutate("origin-name-collision", doc => { doc.source.question = "Find the perpendicular foot O of the origin from 3x+4y-25=0."; setLabel(doc, "source_point", "O"); setLabel(doc, "foot", "O"); }, base);
mutate("unnamed-given-caller-name-collision", doc => { doc.source.question = question.replace("P(0,0)", "(0,0)"); setLabel(doc, "source_point", "Q"); }, base);
for (const hide of ["required", "reveal", "both"]) mutate(`unnamed-hidden-${hide}`, doc => {
  setLabel(doc, "foot");
  if (hide !== "reveal") doc.requiredEntityIds = doc.requiredEntityIds.filter(id => id !== "foot");
  if (hide !== "required") for (const group of doc.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "foot");
}, base);
for (const hide of ["required", "reveal"]) mutate(`named-hidden-${hide}`, doc => {
  if (hide === "required") doc.requiredEntityIds = doc.requiredEntityIds.filter(id => id !== "foot");
  else for (const group of doc.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "foot");
}, base);

const stripped = structuredClone(base); projectOnly(stripped); positive("project-only-no-markers", stripped);
const literal = structuredClone(base); literalFoot(literal); positive("independent-literal-foot", literal);
const strippedLiteral = structuredClone(literal); projectOnly(strippedLiteral); positive("literal-only-no-markers", strippedLiteral);
for (const [id, document] of [["project-only", stripped], ["literal", literal], ["literal-only", strippedLiteral]] as const) {
  for (const name of ["H", "q", "P", undefined]) mutate(`${id}-wrong-name-${name}`, doc => setLabel(doc, "foot", name), document);
  mutate(`${id}-correct-caption-wrong-label`, doc => { setLabel(doc, "foot", "H"); doc.annotations.push({ id: "caption", kind: "label", targetIds: ["foot"], text: "Q=(3,4)" }); }, document);
}
mutate("literal-wrong-coordinates", doc => { literalFoot(doc); doc.constructions.find(row => row.outputs.includes("foot"))!.inputs.x = 4; }, base);
mutate("project-only-wrong-source", doc => { doc.constructions.find(row => row.operator === "point")!.inputs.x = 1; }, stripped);
mutate("project-only-wrong-line", doc => { doc.constructions.find(row => row.operator === "line_equation")!.inputs.c = 25; }, stripped);
mutate("no-foot-producer-or-marker", doc => {
  doc.constructions = doc.constructions.filter(row => !row.outputs.includes("foot")); doc.entities = doc.entities.filter(row => row.id !== "foot");
  doc.requiredEntityIds = doc.requiredEntityIds.filter(id => id !== "foot");
  for (const group of doc.revealGroups) group.entityIds = group.entityIds.filter(id => id !== "foot");
}, stripped);
const arbitraryIds = renameId(renameId(base, "source_point", "Q"), "foot", "P");
positive("IDs-are-not-source-names", arbitraryIds);
mutate("id-spoof-cannot-supply-missing-label", doc => setLabel(doc, "Q"), renameId(base, "foot", "Q"));
mutate("id-spoof-cannot-cover-wrong-label", doc => setLabel(doc, "Q", "P"), renameId(base, "foot", "Q"));

// Transitive label output text is a separate caller-controlled identity channel.
for (const text of ["H", "H=(3,4)", "q(3,4)"]) mutate(`label-construction-${text}`, doc => {
  doc.entities.push({ id: "foot_caption", kind: "label", role: "foot caption" });
  doc.constructions.push({ id: "label_foot", operator: "label", inputs: { target: "foot", text }, outputs: ["foot_caption"] });
}, stripped);
mutate("transitive-label-entity", doc => {
  doc.entities.push({ id: "foot_caption", kind: "label", role: "caption", label: "P=(3,4)" });
  doc.constructions.push({ id: "label_foot", operator: "label", inputs: { target: "foot", text: "Q=(3,4)" }, outputs: ["foot_caption"] });
}, stripped);

// Analytic composition remains a value-bound control, not a source-template lookup.
const composed = structuredClone(base);
const line = composed.constructions.find(row => row.operator === "line_equation")!;
line.operator = "line_relation"; line.inputs = { mode: "slope", line: { a: -6, b: -8, c: 50 } };
positive("composed-proportional-line", composed);
mutate("composed-wrong-intercept", doc => { doc.constructions.find(row => row.operator === "line_relation")!.inputs.line = { a: 3, b: 4, c: 25 }; }, composed);

const fact = (id: string, kind: "given" | "requested", quote: string): ProblemIR["facts"][number] => {
  const start = question.indexOf(quote);
  return { id, kind, statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } };
};
const footOnly: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "authoredFootOnly", question,
  facts: [fact("pFact", "given", "P(0,0)"), fact("lFact", "given", "3x+4y-25=0"), fact("rFact", "requested", "Perpendicular Foot Q")],
  entities: [
    { id: "actualPoint", kind: "point", label: "P", evidenceFactIds: ["pFact"] },
    { id: "actualLine", kind: "line", label: "L", evidenceFactIds: ["lFact"] },
    { id: "actualFoot", kind: "point", label: "Q", evidenceFactIds: ["rFact"] },
  ], expressions: [3, 4].map((value, index) => ({ id: index ? "yQ" : "xQ", valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: ["pFact", "lFact", "rFact"] })),
  constraints: [{ id: "footOnLine", kind: "incident", entityIds: ["actualFoot", "actualLine"], evidenceFactIds: ["rFact"] }],
  representationIntents: [{ id: "completeProjection", kind: "graph", entityIds: ["actualPoint", "actualLine", "actualFoot"], evidenceFactIds: ["pFact", "lFact", "rFact"] }],
  solveRequests: ["xQ", "yQ"].map(symbol => ({ id: `${symbol}Request`, kind: "evaluate", expressionId: symbol, resultBinding: { turnPlanQuantityId: `actual${symbol}`, symbol, unit: "1", evidenceFactIds: ["rFact"] } })),
};
const originalIR = JSON.stringify(footOnly);
const footOnlyDocument = api.pointLineSourceDocument(question, footOnly);
check(footOnlyDocument, "whole foot-only IR binds");
check(JSON.stringify(footOnly) === originalIR, "whole IR stays unchanged");
check(footOnlyDocument.quantities.length === 0 && footOnlyDocument.annotations.length === 0, "foot-only IR adds no substitute distance quantity/annotation");
positive("full-IR-foot-only", footOnlyDocument);
mutate("full-IR-wrong-foot-name", doc => setLabel(doc, "actualFoot", "P"), footOnlyDocument);

// Exact acceptance-review caller documents, if explicitly supplied as receipts.
const repro = process.argv.find(argument => argument.startsWith("--repros="))?.slice("--repros=".length);
if (repro) for (const file of ["forge-foot-renamed-H.json", "forge-foot-renamed-P.json", "forge-foot-renamed-lower-q.json"]) {
  const document = JSON.parse(readFileSync(join(repro, file), "utf8")) as SceneDocument;
  negative(`review-${file}`, document);
}
if (output) {
  mkdirSync(resolve(output), { recursive: true });
  writeFileSync(join(resolve(output), built ? "identities-built.json" : "identities-source.json"), JSON.stringify({ built, checks, receipts }, null, 2));
}
console.log(JSON.stringify({ gate: "W2 point-line public identities", mode: built ? "built ESM" : "source TS", checks, positives: receipts.filter(row => row.ok).length, negatives: receipts.filter(row => !row.ok).length, studentRun: "not_claimed", READY: 0, acceptedCountDelta: 0 }));
