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
// Main's answer-hold presentation changed after these scientific controls froze.
// Keep their document/render/opening golds; the whole-diagram hashes below were
// independently replayed against this PR's actual updated base, without edits.
const currentBaseDiagrams = JSON.parse(readFileSync(new URL("./fixtures/organic-neighbourhood-current-base-parity.json", import.meta.url), "utf8")) as { diagrams: Array<{ id: string; fullDiagramSha256: string }> };
// The203 source-affine Arrhenius operator intentionally replaces one older
// generic curve. Keep both historical fixtures intact; this independently
// reviewed one-case oracle includes physical scale/law checks below.
const arrhenius203 = JSON.parse(readFileSync(new URL("./fixtures/organic-neighbourhood-pr203-arrhenius-parity.json", import.meta.url), "utf8")) as { schema: string; cases: typeof fixture.parityControls };
assert.equal(arrhenius203.schema,"organic-neighbourhood-parity-pr203-arrhenius/v1");
assert.equal(arrhenius203.cases.length,1);
assert.equal(arrhenius203.cases[0]!.id,"kinetics-ln");
assert.equal(arrhenius203.cases[0]!.question,"ln k = 5 - 2000/T. Draw the Arrhenius plot.");
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
for (const f of fixture.parityControls) await check(`${arrhenius203.cases.some(row=>row.id===f.id&&row.question===f.question)?"source-law-composition-203":"unchanged-other-family"}:${f.id}`, () => {
  const raw = engine.chemistryFamilyBuilder(f.family)!(f.question, [], false); assert(raw);
  const normalized = engine.validateSceneDocument(engine.pruneDeadSceneEntities(Object.fromEntries(Object.entries(raw)))); assert(normalized.document);
  const compiled = engine.compileSceneDocument(normalized.document); assert(compiled.ok && compiled.renderScene);
  const p = buildVerifiedDiagramPresentation(normalized.document, compiled.renderScene, { originalQuestion: f.question, figureFamily: f.family });
  const sourceAffine = arrhenius203.cases.find(row=>row.id===f.id&&row.question===f.question);
  const oracle = sourceAffine ?? f;
  assert.equal(sha(normalized.document), oracle.documentSha256); assert.equal(sha(compiled.renderScene), oracle.renderSha256);
  assert.equal(sha(p.introSegments.flatMap(drawing.getSegmentCommands)), oracle.openingCommandsSha256);
  const baseDiagram = currentBaseDiagrams.diagrams.find(row => row.id === f.id); assert(baseDiagram);
  assert.equal(sha(p.diagram), sourceAffine?.fullDiagramSha256 ?? baseDiagram.fullDiagramSha256);
  if(sourceAffine){
    const document=normalized.document;
    for(const[id,value,unit]of [["arrhenius_C",5,"1"],["arrhenius_B",2000,"K"],["Ea",16628,"J/mol"]]as const){const quantity=document.quantities.find(q=>q.id===id);assert.equal(quantity?.value,value);assert.equal(quantity?.unit,unit);}
    assert.equal(document.quantities.find(q=>q.id==="Ea")!.value,8.314*2000,"Ea follows the source B, never a new given");
    const line=document.constructions.find(c=>c.operator==="function_curve");assert.ok(line);
    assert.deepEqual(line.inputs,{expression:"6 - 0.6*x",variable:"x",xMin:0,xMax:10,samples:33});
    const input=(id:string)=>document.constructions.find(c=>c.id===id)!.inputs;
    assert.equal(input("make_ar_xtick_p").x,10);assert.equal(input("make_ar_xtick").text,"0.005");
    assert.equal(input("make_ar_ytick_p").y,0);assert.equal(input("make_ar_ytick").text,"-5");
    assert.equal(input("make_ar_xaxis_t").y,3);assert.equal(input("make_ar_xaxis_h").y,3);assert.equal(input("make_ar_zero").text,"0");
    const samples=document.assertions.filter(a=>a.predicate==="function_value").map(a=>a.expected as {x:number;y:number});
    assert.deepEqual(samples,[{x:0,y:6},{x:5,y:3},{x:10,y:0}]);
    for(const point of samples){const inverseTemperature=point.x*0.005/10;const lnK=-5+point.y*10/6;assert.ok(Math.abs(lnK-(5-2000*inverseTemperature))<1e-12);}
    assert.equal(1/(5/2000),400,"source zero crossing T=400K");
    const labels=compiled.renderScene.primitives.flatMap(mark=>mark.text?[mark.text]:[]);for(const label of["1/T (K^-1)","ln k","m=-2000K","lnA=5"])assert.ok(labels.includes(label));
  }
});
await check("carbonyl-qualitative-complete-without-numeric-angle", () => {
  const question = "Draw hexanal and hexan-2-one so that the three atoms directly attached to each carbonyl carbon are explicit. Mark the approximately trigonal-planar carbonyl centres and show which has a carbonyl-bound H and which has two carbon substituents.";
  const { r, p } = presentation(question);
  assert.equal(r.tier, "qualitative_verified");
  const verified = witness(r.sceneDocument, question); assert(verified);
  assert.equal(verified.structures.length, 2);
  const commands = p.introSegments.flatMap(drawing.getSegmentCommands);
  for (const structure of verified.structures) {
    const ids = new Set([...structure.atomIds, ...structure.nameLabelIds]);
    const labels = r.renderScene.primitives.filter(primitive => primitive.kind === "label" && ids.has(primitive.entityId));
    assert(labels.length > 0);
    for (const label of labels) assert(commands.some(command => command.type === "LABEL" && command.semanticRef?.entityId === label.entityId && command.text === label.text), `missing carbonyl opening label ${label.entityId}`);
  }
  assert(!/\d+(?:\.\d+)?\s*(?:deg(?:ree)?s?\b|°)/iu.test(JSON.stringify({ document: r.sceneDocument, render: r.renderScene, presentation: p })), "qualitative carbonyl structures add no displayed numeric angle");
});
for (const angle of [120, 150]) await check(`carbonyl-explicit-${angle}-still-declines`, () => {
  const question = `Draw hexanal and hexan-2-one with the carbonyl centres marked and show a measured carbonyl angle of ${angle} degrees.`;
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const selected = selectProductionScene({ question, turnPlan, problemIR: null });
  assert.equal(selected.representation, null);
});
const result = { scope: "Synthetic validated conservative plans/nullIR, original8 frozen openings. Actual source-native presentation/canonical helpers; not paid/live/coverage/HTTPDB/pixels.", fixtureSha256: sha(bytes), passed: rows.filter(r => r.pass).length, failed: rows.filter(r => !r.pass).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n");
console.log(`verify-live-organic-structure-reveal: ${result.passed} passed, ${result.failed} failed`);
if (result.failed) process.exitCode = 1;

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
