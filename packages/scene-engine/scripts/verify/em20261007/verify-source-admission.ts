import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { evaluateChapterRemainderConstruction } from "../../../src/compile/chapterRemainderGeometry";
import { LocalDeterministicSolverProvider } from "../../../src/ir/solver";
import { validateProblemIR, type ExpressionNodeIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { consumePhysicalModel } from "../../../src/physics/em20261007/consume";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const wheatstone = consumePhysicalModel("dc.wheatstone", { emf: 12, r: 1, P: 2, Q: 4, Rg: 5 });
assert.equal(wheatstone.status, "scene");
if (wheatstone.status === "scene") {
  const branches = wheatstone.document.constructions.flatMap((construction) => {
    const value = construction.inputs.branches;
    return Array.isArray(value) ? value : [];
  });
  const detector = branches.find((branch) => branch && typeof branch === "object" && "id" in branch && branch.id === "G");
  check(detector && typeof detector === "object" && "kind" in detector && detector.kind === "detector", "Wheatstone detector must not be a wire");
  const compiled = compileSceneDocument(validateSceneDocument(wheatstone.document).document ?? wheatstone.document);
  check(compiled.ok && compiled.renderScene, "Wheatstone must compile");
  const detectorPrimitives = compiled.renderScene?.primitives.filter((primitive) => primitive.entityId.endsWith("G") || primitive.entityId.includes("G")) ?? [];
  check(detectorPrimitives.some((primitive) => primitive.points.length >= 12), "Wheatstone detector glyph must include a ring, not only a lead");
}

const magnet = evaluateChapterRemainderConstruction("bar_magnet", { moment: [2, 0], displayScale: 1 }, {
  number(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("number");
    return value;
  },
  point() { throw new Error("point"); },
  geometry() { return undefined; },
});
const lobes = magnet.slice(1).filter((item) => item.kind === "path");
check(lobes.length === 4, "bar magnet keeps four field lines");
check(lobes.every((lobe) => lobe.kind === "path" && lobe.directed === true), "bar-magnet field lines are directed");
check(lobes.every((lobe) => {
  if (lobe.kind !== "path") return false;
  const start = lobe.points[0];
  const end = lobe.points[lobe.points.length - 1];
  const mid = lobe.points[Math.floor(lobe.points.length / 2)];
  return Boolean(start && end && mid && Math.abs(start.x - 0.7) < 0.02 && Math.abs(end.x + 0.7) < 0.02 && Math.abs(mid.y) > 0.3);
}), "bar-magnet field lines leave the north face, stay outside the bar, and enter the south face");

const triad = consumePhysicalModel("emw.triad", { crossed: 1 });
assert.equal(triad.status, "scene");
if (triad.status === "scene") {
  const compiled = compileSceneDocument(validateSceneDocument(triad.document).document ?? triad.document);
  const labels = compiled.renderScene?.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text) ?? [];
  check(labels.includes("E") && labels.includes("B") && labels.includes("k"), `triad labels missing: ${labels.join(",")}`);
  const ring = compiled.renderScene?.primitives.some((primitive) => primitive.entityId === "magnetic" && primitive.kind === "circle");
  const dot = compiled.renderScene?.primitives.find((primitive) => primitive.entityId === "magnetic-dot" && primitive.kind === "circle");
  check(ring && dot && dot.provenance?.inkRole === "opaque_dot", "out-of-page B needs a ring and an opaque foreground centre dot");
}

const bare = "Use the explicit model for this source.";
const bareIr = {
  schemaVersion: "problem-ir/v1",
  id: "auditFixture",
  question: bare,
  facts: [{ id: "fact", kind: "given", statement: "The explicit model is the source.", evidence: { source: "question", start: 8, end: 23, quote: "explicit model" } }],
  entities: [],
  expressions: [],
  constraints: [],
  representationIntents: [],
  solveRequests: [{ id: "explicitModel", kind: "explicit_physical_model", model: "dc.wheatstone", inputs: { emf: 999, P: 2, Q: 4 }, evidenceFactIds: ["fact"] }],
};
const bareValidated = validateProblemIR(bareIr, bare);
check(!bareValidated.problem, "a generic explicit-model quote must not validate");
check(synthesizeFamilyScene({ question: bare, problemIR: bareIr }) === null, "ungrounded wheatstone must not emit a scene or fall through");

const question = "A balanced Wheatstone bridge has source emf 12 V, source internal resistance 1 ohm, left arm resistance 2 ohm, right arm resistance 4 ohm, and galvanometer resistance 5 ohm. Find the source current.";
function evidence(quote: string): QuestionSourceEvidence {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`missing quote ${quote}`);
  return { source: "question", start, end: start + quote.length, quote };
}
function number(id: string, value: number): { id: string; valueType: "scalar"; root: ExpressionNodeIR; evidenceFactIds: string[] } {
  return { id, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [id] };
}
function grounded(overrides?: { readonly emf?: number; readonly swapRole?: boolean; readonly dropBalanced?: boolean }) {
  const facts = [
    { id: "balanced", kind: "assumption", statement: "The bridge is balanced.", evidence: evidence("balanced") },
    { id: "emf", kind: "given", statement: "The source emf is stated in V.", evidence: evidence("12 V") },
    { id: "r", kind: "given", statement: "The source internal resistance is stated in ohm.", evidence: evidence("1 ohm") },
    { id: "P", kind: "given", statement: "The left arm resistance is stated in ohm.", evidence: evidence("2 ohm") },
    { id: "Q", kind: "given", statement: "The right arm resistance is stated in ohm.", evidence: evidence("4 ohm") },
    { id: "Rg", kind: "given", statement: "The galvanometer resistance is stated in ohm.", evidence: evidence("5 ohm") },
    { id: "asked", kind: "requested", statement: "Find the source current.", evidence: evidence("source current") },
  ];
  const bindings = [
    { key: "emf", role: "source emf", unit: "V", expressionId: "emf", evidenceFactId: overrides?.swapRole ? "P" : "emf" },
    { key: "r", role: "source internal resistance", unit: "ohm", expressionId: "r", evidenceFactId: "r" },
    { key: "P", role: "left arm resistance", unit: "ohm", expressionId: "P", evidenceFactId: "P" },
    { key: "Q", role: "right arm resistance", unit: "ohm", expressionId: "Q", evidenceFactId: "Q" },
    { key: "Rg", role: "galvanometer resistance", unit: "ohm", expressionId: "Rg", evidenceFactId: "Rg" },
  ];
  return {
    schemaVersion: "problem-ir/v1",
    id: "wheatstoneQuestion",
    question,
    facts: overrides?.dropBalanced ? facts.filter((fact) => fact.id !== "balanced") : facts,
    entities: [],
    expressions: [
      number("emf", overrides?.emf ?? 12),
      number("r", 1),
      number("P", 2),
      number("Q", 4),
      number("Rg", 5),
    ],
    constraints: [],
    representationIntents: [],
    solveRequests: [{
      id: "explicitModel",
      kind: "explicit_physical_model",
      model: "dc.wheatstone",
      bindings,
      evidenceFactIds: ["asked"],
      resultBinding: { turnPlanQuantityId: "sourceCurrent", symbol: "I_S", unit: "A", evidenceFactIds: ["asked"] },
    }],
  };
}

const admitted = validateProblemIR(grounded(), question);
check(Boolean(admitted.problem), `grounded wheatstone should validate: ${admitted.issues.map((issue) => issue.message).join("; ")}`);
const scene = admitted.problem ? synthesizeFamilyScene({ question, problemIR: admitted.problem }) : null;
check(scene?.document.source.explicitPhysicalModel === "dc.wheatstone", "grounded wheatstone should emit its own scene");
check(scene?.document.source.question === question, "grounded physical-model scene must retain the exact source question for save/replay");
const certified = scene?.document.source.certified;
const sourceCurrent = certified && typeof certified === "object" && "I_S" in certified ? certified.I_S : undefined;
check(sourceCurrent === 3, "grounded source current is 3 A");
const changed = validateProblemIR(grounded({ emf: 999 }), question);
check(!changed.problem, "changing emf without changing the quote must fail");
const swapped = validateProblemIR(grounded({ swapRole: true }), question);
check(!swapped.problem, "a coincidentally unrelated fact must not bind the source emf");
const unbalanced = validateProblemIR(grounded({ dropBalanced: true }), question);
check(!unbalanced.problem, "a missing balanced assumption must fail");

const solver = new LocalDeterministicSolverProvider();
const solved = await solver.solve(grounded());
check(solved.status === "solved" && solved.values[0]?.approximate === 3, `solver should recompute I_S, got ${solved.status} ${solved.issues.map((issue) => issue.message).join("; ")}`);

if (failures.length > 0) throw new Error(failures.join("\n"));
console.log("source admission checks passed");
