/** Complete organic atoms/names open together; no family-flag authority. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as engine from "@heytutor/scene-engine";
import type { SceneDocument } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import * as drawing from "@heytutor/drawing";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { completeStoredTurnDiagram } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";

interface RequiredLabel { entityId: string; text: string; kind: "atom" | "name" }
interface Fixture { id: string; question: string; expectedNames: string[]; requiredOpeningLabels: RequiredLabel[] }
const bytes = readFileSync(new URL("./fixtures/organic-neighbourhood-openings.json", import.meta.url));
const fixture = JSON.parse(bytes.toString()) as { provenance: { original94GateSha256: string }; cases: Fixture[]; parityControls: Array<{ id: string; family: engine.ChemistrySceneFamily; question: string; documentSha256: string; renderSha256: string; openingCommandsSha256: string; fullDiagramSha256: string }> };
const sha = (value: unknown): string => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rows: Array<{ name: string; pass: boolean; error?: string }> = [];
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); rows.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { rows.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); console.error(`FAIL ${name}: ${String(error)}`); }
}
function presentation(question: string) {
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  assert(engine.validateTurnPlanV3(turnPlan, question).valid);
  const selected = selectProductionScene({ question, turnPlan, problemIR: null });
  assert(selected.representation, selected.reason);
  assert.equal(selected.representation.family, "chem_organic");
  const r = selected.representation;
  return { turnPlan, r, p: buildVerifiedDiagramPresentation(r.sceneDocument, r.renderScene, { originalQuestion: question, figureFamily: r.family }) };
}
function witness(document: SceneDocument, question?: string) {
  assert.equal(typeof engine.verifiedOrganicNeighbourhoodStructure, "function", "source-recomputed witness export required");
  return engine.verifiedOrganicNeighbourhoodStructure(document, question);
}
async function main(): Promise<void> {
const selected = new Map<string, ReturnType<typeof presentation>>();
for (const f of fixture.cases) {
  await check(`opening-complete-atoms-and-name:${f.id}`, () => {
    const actual = presentation(f.question); selected.set(f.id, actual);
    const commands = actual.p.introSegments.flatMap(drawing.getSegmentCommands);
    for (const required of f.requiredOpeningLabels) {
      assert(actual.r.renderScene.primitives.some(p => p.kind === "label" && p.entityId === required.entityId && p.text === required.text), "frozen source oracle changed");
      assert(commands.some(c => c.type === "LABEL" && c.semanticRef?.entityId === required.entityId && c.text === required.text), `${required.kind} ${required.entityId}: ${required.text} absent from opening`);
    }
  });
  await check(`recomputed-structural-membership:${f.id}`, () => {
    const actual = selected.get(f.id) ?? presentation(f.question);
    const verified = witness(actual.r.sceneDocument, f.question); assert(verified);
    assert.equal(verified.structures.length, f.expectedNames.length);
    const ids = new Set(verified.structures.flatMap(s => [...s.atomIds, ...s.nameLabelIds]));
    const labelled = new Set(actual.r.renderScene.primitives.filter(p => p.kind === "label").map(p => p.entityId));
    assert.deepEqual([...ids].filter(id => labelled.has(id)).sort(), f.requiredOpeningLabels.map(label => label.entityId).sort(), "only actual atoms and full source-name lines are certified, never class/count captions");
  });
  await check(`canonical-completion-reopen:${f.id}`, async () => {
    const { r, p, turnPlan } = selected.get(f.id) ?? presentation(f.question);
    const completed = p.introSegments.flatMap(drawing.getSegmentCommands);
    await completeStoredTurnDiagram({ turn: { id: "organic-offline", orderIndex: 0, question: f.question, rawResponse: "", speedMultiplier: 1, traceId: null, sceneDocument: r.sceneDocument, sceneEngineVersion: null, validationReport: null, visualStatus: "validated", status: "complete", kind: "lesson", segments: [], sceneArtifacts: null }, diagram: p.diagram, executeCommand: async c => { completed.push(c); }, shouldCancel: () => false });
    const canonical = await canonicalizeTurnSceneMetadata({ question: f.question, sceneDocument: r.sceneDocument, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null, representationTier: r.tier, nonMetric: r.nonMetric, candidates: [], figureSource: r.figureSource, diagramResultStatus: "ready" }, segments: [] });
    assert(canonical.ok); const value = canonical.value;
    const stored = json({ id: "organic-offline", orderIndex: 0, question: f.question, rawResponse: "", speedMultiplier: 1, traceId: null, status: "complete" as const, kind: "lesson" as const, ...value, segments: value.segments.map(s => ({ ...s, command: drawing.serializeSegmentCommands(drawing.parseStoredSegmentCommands(s.command), { trustedDiagramGeometry: drawing.isStoredCommandTrustedGeometry(s.command) }), id: "s" + s.orderIndex, audioUrl: null, durationMs: s.durationMs ?? null, timings: null })) });
    const checked = sourceCheckedStoredTurn(stored); assert.equal(checked.visualStatus, "validated");
    const restored = restoreVerifiedPresentationFromTurn(checked); assert(restored);
    const reopened = buildReplayTimeline([checked]).cues.flatMap(cue => cue.commands);
    await completeStoredTurnDiagram({ turn: checked, diagram: restored.diagram, executeCommand: async c => { reopened.push(c); }, shouldCancel: () => false });
    assert.deepEqual(json(completed), json(reopened), "JSON drops undefined optional fields only");
    for (const required of f.requiredOpeningLabels) assert(reopened.some(c => c.type === "LABEL" && c.semanticRef?.entityId === required.entityId && c.text === required.text));
  });
}
const anchorFixture = fixture.cases[0]!;
const anchor = selected.get(anchorFixture.id) ?? presentation(anchorFixture.question);
for (const [name, mutate] of [
  ["changed-atom", (d: SceneDocument) => { d.entities.find(e => e.id === "m0_a0")!.label = "Br"; }],
  ["changed-name", (d: SceneDocument) => { d.entities.find(e => e.id === "m0_description0")!.label = "foreign molecule"; }],
  ["missing-member", (d: SceneDocument) => { d.entities = d.entities.filter(e => !e.id.startsWith("m1_")); }],
  ["foreign-bond-topology", (d: SceneDocument) => { const c = d.constructions.find(c => c.operator === "segment")!; c.inputs = { ...c.inputs, start: "foreign_physics_body" }; }],
  ["partial-reveal-group", (d: SceneDocument) => { d.revealGroups[0]!.entityIds.pop(); }],
  ["foreign-physics-label-with-family-flag", (d: SceneDocument) => { d.entities.find(e => e.id === "m0_a0")!.label = "q1 = +5 uC"; d.source.chemistryFamily = "chem_organic"; }],
] as const) await check(`witness-refusal:${name}`, () => {
  const changed = structuredClone(anchor.r.sceneDocument); mutate(changed);
  assert.equal(witness(changed, anchorFixture.question), null);
});
await check("witness-refusal:missing-external-source", () => assert.equal(witness(anchor.r.sceneDocument), null));
await check("witness-refusal:different-external-source", () => assert.equal(witness(anchor.r.sceneDocument, "Draw ethanol with its OH-bearing carbon marked."), null));
await check("witness-refusal:unsupported-extra-source-obligation", () => {
  const q = anchorFixture.question + " Show its boiling-point order.";
  const changed = structuredClone(anchor.r.sceneDocument); changed.source.question = q;
  assert.equal(witness(changed, q), null);
});
await check("source-metadata-cannot-author-membership", () => {
  const changed = structuredClone(anchor.r.sceneDocument); changed.source.organicComparison = { structures: [{ atomIds: ["foreign_physics_body"], nameLabelIds: ["foreign_caption"] }] };
  const checked = witness(changed, anchorFixture.question); assert(checked);
  assert(!checked.structures.flatMap(s => [...s.atomIds, ...s.nameLabelIds]).some(id => id.startsWith("foreign_")));
});
for (const mutation of ["missing-source", "shifted-render", "renamed-render"] as const) await check(`no-premature-label-trust:${mutation}`, () => {
  const render = structuredClone(anchor.r.renderScene);
  const atom = render.primitives.find(p => p.kind === "label" && p.entityId === anchorFixture.requiredOpeningLabels.find(l => l.kind === "atom")!.entityId)!;
  if (mutation === "shifted-render") atom.points[0]!.x += 1;
  if (mutation === "renamed-render") atom.text = "foreign";
  const p = buildVerifiedDiagramPresentation(anchor.r.sceneDocument, render, { ...(mutation === "missing-source" ? {} : { originalQuestion: anchorFixture.question }), figureFamily: "chem_organic" });
  const atoms = new Set(anchorFixture.requiredOpeningLabels.filter(l => l.kind === "atom").map(l => l.entityId));
  assert(!p.introSegments.flatMap(drawing.getSegmentCommands).some(c => c.type === "LABEL" && c.semanticRef?.entityId && atoms.has(c.semanticRef.entityId)));
});
for (const f of fixture.parityControls) await check(`unchanged-other-family:${f.id}`, () => {
  const raw = engine.chemistryFamilyBuilder(f.family)!(f.question, [], false); assert(raw);
  const normalized = engine.validateSceneDocument(engine.pruneDeadSceneEntities(Object.fromEntries(Object.entries(raw)))); assert(normalized.document);
  const compiled = engine.compileSceneDocument(normalized.document); assert(compiled.ok && compiled.renderScene);
  const p = buildVerifiedDiagramPresentation(normalized.document, compiled.renderScene, { originalQuestion: f.question, figureFamily: f.family });
  assert.equal(sha(normalized.document), f.documentSha256); assert.equal(sha(compiled.renderScene), f.renderSha256);
  assert.equal(sha(p.introSegments.flatMap(drawing.getSegmentCommands)), f.openingCommandsSha256); assert.equal(sha(p.diagram), f.fullDiagramSha256);
});
await check("carbonyl120-native-guard-not-waived", () => {
  const question = "Draw hexanal and hexan-2-one so that the three atoms directly attached to each carbonyl carbon are explicit. Mark the approximately trigonal-planar carbonyl centres and show which has a carbonyl-bound H and which has two carbon substituents.";
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const selected = selectProductionScene({ question, turnPlan, problemIR: null });
  assert.equal(selected.representation, null); assert.match(selected.reason, /quantity/i);
});
const result = { scope: "Synthetic validated conservative plans/nullIR, original8 frozen openings. Actual source-native presentation/canonical helpers; not paid/live/coverage/HTTPDB/pixels.", fixtureSha256: sha(bytes), passed: rows.filter(r => r.pass).length, failed: rows.filter(r => !r.pass).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n");
console.log(`verify-live-organic-structure-reveal: ${result.passed} passed, ${result.failed} failed`);
if (result.failed) process.exitCode = 1;

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
