import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as source from "../../src/index";
import type { ProblemIR, SceneDocument } from "../../src/index";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/w2-incidence-body-fix/${name}.json`, import.meta.url), "utf8")) as { question: string; problem: ProblemIR; document: SceneDocument };
const api = process.env.INCIDENCE_PUBLIC_ESM === "1" ? await import("../../dist/index.js") : source;
let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  assert.ok(condition, message);
}
function admitted(problem: ProblemIR, document: SceneDocument): boolean {
  const validation = api.validateSceneDocument(document);
  if (!validation.document) return false;
  const compiled = api.compileSceneDocument(validation.document, { sourceAuthority: { question: problem.question, problemIR: problem } });
  return compiled.ok && compiled.renderScene !== null
    && api.checkVisualObligations(api.deriveVisualObligations(problem), validation.document, problem).satisfied;
}
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const objectInput = fixture("shared-object-point-input");
const zeroInput = fixture("shared-zero-vector-input");
for (const [name, input] of [["object point", objectInput], ["zero-vector marker", zeroInput]] as const) {
  check(api.validateProblemIR(input.problem, input.question).valid, `${name}: ProblemIR remains valid`);
  check(admitted(input.problem, input.document), `${name}: compiler and offline obligation admission`);
  check(admitted(input.problem, roundTrip(input.document)), `${name}: saved JSON read and restore admission`);
}

for (const [name, mutate] of [
  ["missing witness", (d: SceneDocument) => { d.assertions = []; }],
  ["nonfatal witness", (d: SceneDocument) => { d.assertions[0]!.severity = "warning"; }],
  ["negative witness", (d: SceneDocument) => { d.assertions[0]!.expected = false; }],
  ["moved point", (d: SceneDocument) => { d.constructions.find(c => c.outputs.includes("C"))!.inputs = { x: 0, y: 1 }; }],
  ["foreign support", (d: SceneDocument) => { d.assertions[0]!.entities[1] = "u"; }],
] as const) {
  for (const boundary of ["compiler/offline", "saved JSON restore"] as const) {
    const document = structuredClone(objectInput.document);
    mutate(document);
    const candidate = boundary === "saved JSON restore" ? roundTrip(document) : document;
    check(!admitted(objectInput.problem, candidate), `${name}: rejected at ${boundary}`);
  }
}

function groupedFixture(): { problem: ProblemIR; document: SceneDocument } {
  const problem = structuredClone(objectInput.problem);
  problem.entities = ["A", "B", "C"].map(id => ({ id: id.toLowerCase(), kind: "point", label: id, evidenceFactIds: ["f"] }));
  problem.entities.push({ id: "l", kind: "line", label: "L", evidenceFactIds: ["f"] });
  problem.constraints[0]!.entityIds = ["a", "b", "c", "l"];
  problem.representationIntents[0]!.entityIds = ["a", "b", "c", "l"];
  const document = structuredClone(objectInput.document);
  document.entities = ["A", "B", "C"].map(id => ({ id, kind: "point", role: "named marker", label: id }));
  document.entities.push({ id: "L", kind: "line", role: "support", label: "L" });
  document.constructions = [
    { id: "makeL", operator: "line", inputs: { start: [-2, 0], end: [2, 0] }, outputs: ["L"] },
    ...["A", "B", "C"].map((id, i) => ({ id: `make${id}`, operator: "point", inputs: { x: i - 1, y: 0, coordinateSpace: "world" }, outputs: [id] })),
  ];
  document.assertions = ["A", "B", "C"].map(id => ({ id: `on${id}`, predicate: "on", entities: [id, "L"], expected: true, severity: "fatal" }));
  document.requiredEntityIds = ["A", "B", "C", "L"];
  document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
  return { problem, document };
}

const grouped = groupedFixture();
check(admitted(grouped.problem, grouped.document), "three points retain one positive fatal support proof apiece");
const broad = structuredClone(grouped.document);
broad.assertions = [{ id: "broad", predicate: "on", entities: ["A", "L", "B", "C"], expected: true, severity: "fatal" }];
check(!api.checkVisualObligations(api.deriveVisualObligations(grouped.problem), broad, grouped.problem).satisfied, "one broad third-operand assertion cannot witness grouped incidence");
const twoSupports = structuredClone(grouped);
twoSupports.document.entities = twoSupports.document.entities.map(entity => entity.id === "L" ? { ...entity, kind: "line" } : entity);
twoSupports.document.entities.push({ id: "M", kind: "line", role: "second support", label: "M" });
twoSupports.document.constructions.push({ id: "makeM", operator: "line", inputs: { start: [0, -2], end: [0, 2] }, outputs: ["M"] });
twoSupports.document.assertions = [
  { id: "onA", predicate: "on", entities: ["A", "L"], expected: true, severity: "fatal" },
  { id: "onAM", predicate: "on", entities: ["A", "M"], expected: true, severity: "fatal" },
];
twoSupports.problem.entities = [{ id: "a", kind: "point", label: "A", evidenceFactIds: ["f"] }, { id: "l", kind: "line", label: "L", evidenceFactIds: ["f"] }, { id: "m", kind: "line", label: "M", evidenceFactIds: ["f"] }];
twoSupports.problem.constraints[0]!.entityIds = ["a", "l", "m"];
twoSupports.problem.representationIntents[0]!.entityIds = ["a", "l", "m"];
check(!api.checkVisualObligations(api.deriveVisualObligations(twoSupports.problem), twoSupports.document, twoSupports.problem).satisfied, "grouped incidence with two supports is rejected");

console.log(`${checks} shared incidence compatibility checks passed (${process.env.INCIDENCE_PUBLIC_ESM === "1" ? "public ESM" : "source TS"}).`);
