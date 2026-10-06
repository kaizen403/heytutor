import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument, LocalDeterministicSolverProvider, type ProblemIR, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../packages/scene-engine/scripts/verify/fixtures/w2-incidence-body-fix/${name}.json`, import.meta.url), "utf8")) as { question: string; problem: ProblemIR; document: SceneDocument };
const planFor = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], assumptions: [], qualitativeClaims: [], lawIds: [], visualRequirement: "required" });
let checks = 0;
function check(condition: unknown, message: string): void { checks += 1; assert.ok(condition, message); }

async function main(): Promise<void> {
for (const [name, input] of [["object point", fixture("shared-object-point-input")], ["zero-vector marker", fixture("shared-zero-vector-input")]] as const) {
  const plan = planFor(input.question);
  const solver = await new LocalDeterministicSolverProvider().solve(input.problem);
  const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: input.problem, solverResult: solver, representationTier: "exact_verified", nonMetric: false, candidates: [], selectedCandidateId: null, selectionReason: "incidence compatibility regression", diagramResultStatus: "ready", proofObligations: [], budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 } };
  const turn = { id: "offline-incidence", question: input.question, rawResponse: "", orderIndex: 0, speedMultiplier: 1, traceId: null, segments: [], sceneDocument: input.document, sceneArtifacts: artifacts, visualStatus: "validated" as const, sceneEngineVersion: null, validationReport: null };
  check(compileSceneDocument(input.document).ok, `${name}: compiler accepts executable incidence`);
  check(liveSceneSaveFailure({ document: input.document, question: input.question, turnPlan: plan, problemIR: input.problem, tier: "exact_verified" }) === null, `${name}: offline live admission`);
  const saved = await canonicalizeTurnSceneMetadata({ question: input.question, sceneDocument: input.document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  check(saved.ok, `${name}: save canonicalization${saved.ok ? "" : `: ${saved.error}`}`);
  check(sourceCheckedStoredTurn(turn).visualStatus === "validated", `${name}: stored read`);
  check(restoreVerifiedPresentationFromTurn(turn) !== null, `${name}: restored presentation`);
}

const base = fixture("shared-object-point-input");
for (const [name, mutate] of [
  ["missing witness", (d: SceneDocument) => { d.assertions = []; }],
  ["nonfatal witness", (d: SceneDocument) => { d.assertions[0]!.severity = "warning"; }],
  ["negative witness", (d: SceneDocument) => { d.assertions[0]!.expected = false; }],
  ["moved point", (d: SceneDocument) => { d.constructions.find(c => c.outputs.includes("C"))!.inputs = { x: 0, y: 1 }; }],
  ["foreign support", (d: SceneDocument) => { d.assertions[0]!.entities[1] = "u"; }],
] as const) {
  const document = structuredClone(base.document);
  mutate(document);
  const plan = planFor(base.question);
  const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: base.problem, representationTier: "exact_verified", nonMetric: false, candidates: [], selectedCandidateId: null, selectionReason: "incidence mutation", diagramResultStatus: "ready", proofObligations: [], budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 } };
  const turn = { id: "offline-incidence-mutation", question: base.question, rawResponse: "", orderIndex: 0, speedMultiplier: 1, traceId: null, segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated" as const, sceneEngineVersion: null, validationReport: null };
  const liveAccepted = compileSceneDocument(document).ok
    && liveSceneSaveFailure({ document, question: base.question, turnPlan: plan, problemIR: base.problem, tier: "exact_verified" }) === null;
  check(!liveAccepted, `${name}: compiler plus offline live admission rejects`);
  const savedMutation = await canonicalizeTurnSceneMetadata({ question: base.question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  check(!compileSceneDocument(document).ok || !savedMutation.ok, `${name}: compiler plus save boundary rejects`);
  const stored = sourceCheckedStoredTurn(turn);
  const restored = restoreVerifiedPresentationFromTurn(turn);
  check(stored.visualStatus === "retry_required" || restored === null, `${name}: stored read and restore boundary rejects`);
}

const groupedProblem = structuredClone(base.problem);
groupedProblem.entities = ["A", "B", "C"].map(id => ({ id: id.toLowerCase(), kind: "point", label: id, evidenceFactIds: ["f"] }));
groupedProblem.entities.push({ id: "l", kind: "line", label: "L", evidenceFactIds: ["f"] });
groupedProblem.constraints = [{ id: "onLine", kind: "incident", entityIds: ["a", "b", "c", "l"], evidenceFactIds: ["f"] }];
groupedProblem.representationIntents[0]!.entityIds = ["a", "b", "c", "l"];
const groupedDocument = structuredClone(base.document);
groupedDocument.entities = ["A", "B", "C"].map(id => ({ id, kind: "point", role: "named marker", label: id }));
groupedDocument.entities.push({ id: "L", kind: "line", role: "support", label: "L" });
groupedDocument.constructions = [
  { id: "makeL", operator: "line", inputs: { start: [-2, 0], end: [2, 0] }, outputs: ["L"] },
  ...["A", "B", "C"].map((id, i) => ({ id: `make${id}`, operator: "point", inputs: { x: i - 1, y: 0, coordinateSpace: "world" }, outputs: [id] })),
];
groupedDocument.assertions = ["A", "B", "C"].map(id => ({ id: `on${id}`, predicate: "on", entities: [id, "L"], expected: true, severity: "fatal" }));
groupedDocument.requiredEntityIds = ["A", "B", "C", "L"];
groupedDocument.revealGroups[0]!.entityIds = [...groupedDocument.requiredEntityIds];

async function rejectAcrossLifecycle(name: string, problem: ProblemIR, document: SceneDocument): Promise<void> {
  const plan = planFor(problem.question);
  const artifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: problem, representationTier: "exact_verified", nonMetric: false, candidates: [], selectedCandidateId: null, selectionReason: "grouped incidence mutation", diagramResultStatus: "ready", proofObligations: [], budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 } };
  const turn = { id: `offline-${name}`, question: problem.question, rawResponse: "", orderIndex: 0, speedMultiplier: 1, traceId: null, segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated" as const, sceneEngineVersion: null, validationReport: null };
  const liveAccepted = compileSceneDocument(document).ok
    && liveSceneSaveFailure({ document, question: problem.question, turnPlan: plan, problemIR: problem, tier: "exact_verified" }) === null;
  check(!liveAccepted, `${name}: compiler plus offline live admission rejects`);
  const saved = await canonicalizeTurnSceneMetadata({ question: problem.question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  check(!compileSceneDocument(document).ok || !saved.ok, `${name}: compiler plus save boundary rejects`);
  const stored = sourceCheckedStoredTurn(turn);
  const restored = restoreVerifiedPresentationFromTurn(turn);
  check(stored.visualStatus === "retry_required" || restored === null, `${name}: stored read and restore boundary rejects`);
}

const broadGrouped = structuredClone(groupedDocument);
broadGrouped.assertions = [{ id: "broad", predicate: "on", entities: ["A", "L", "B", "C"], expected: true, severity: "fatal" }];
await rejectAcrossLifecycle("broad-third-operand-proof", groupedProblem, broadGrouped);
const twoSupportProblem = structuredClone(base.problem);
twoSupportProblem.entities = [{ id: "a", kind: "point", label: "A", evidenceFactIds: ["f"] }, { id: "l", kind: "line", label: "L", evidenceFactIds: ["f"] }, { id: "m", kind: "line", label: "M", evidenceFactIds: ["f"] }];
twoSupportProblem.constraints = [{ id: "onLine", kind: "incident", entityIds: ["a", "l", "m"], evidenceFactIds: ["f"] }];
twoSupportProblem.representationIntents[0]!.entityIds = ["a", "l", "m"];
const twoSupportDocument = structuredClone(groupedDocument);
twoSupportDocument.entities = [{ id: "A", kind: "point", role: "named marker", label: "A" }, { id: "L", kind: "line", role: "support", label: "L" }, { id: "M", kind: "line", role: "second support", label: "M" }];
twoSupportDocument.constructions = [
  { id: "makeL", operator: "line", inputs: { start: [-2, 0], end: [2, 0] }, outputs: ["L"] },
  { id: "makeM", operator: "line", inputs: { start: [0, -2], end: [0, 2] }, outputs: ["M"] },
  { id: "makeA", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
];
twoSupportDocument.assertions = [{ id: "onL", predicate: "on", entities: ["A", "L"], expected: true, severity: "fatal" }, { id: "onM", predicate: "on", entities: ["A", "M"], expected: true, severity: "fatal" }];
twoSupportDocument.requiredEntityIds = ["A", "L", "M"];
twoSupportDocument.revealGroups[0]!.entityIds = [...twoSupportDocument.requiredEntityIds];
await rejectAcrossLifecycle("two-support-group", twoSupportProblem, twoSupportDocument);

console.log(`${checks} incidence live/save/read/restore checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
