/** Real live SF4 authority; native selection through presentation and JSON restore. No external I/O. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  validateTurnPlanV3, validateProblemIR, validateSolverResult, compileSceneDocument,
  type TurnPlanV3, type SceneDocument, type RenderScene, type ProblemIR, type SolverResult,
} from "@heytutor/scene-engine";
import { getSegmentCommands, parseStoredSegmentCommands, serializeSegmentCommands, isStoredCommandTrustedGeometry, type DrawCommand } from "@heytutor/drawing";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { completeStoredTurnDiagram } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import type { StoredTurn } from "../../lib/boards/boardsClient";

const fixtureBytes = readFileSync(new URL("./fixtures/live-molecule-sf4.json", import.meta.url));
const fixture = JSON.parse(fixtureBytes.toString()) as { question: string; turnPlan: TurnPlanV3; problemIR: null; IRProvenance: string; sourceArtifactSha256: string };
const evidence: unknown[] = [];
const failures: Array<{ name: string; message: string }> = [];
const blocked: string[] = [];
let passed = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); failures.push({ name, message }); console.error(`FAIL ${name}: ${message}`); }
}
interface MolecularCase { id: string; question: string; central: string; ligand: string; bonds: number; lonePairs: number; plan?: TurnPlanV3; problemIR?: ProblemIR }
const planFor = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] });
const cases: MolecularCase[] = [
  { id: "recorded-live-SF4", question: fixture.question, central: "S", ligand: "F", bonds: 4, lonePairs: 1, plan: fixture.turnPlan },
  { id: "SF4-short-shape", question: "What shape is SF4? Show where the lone pair sits.", central: "S", ligand: "F", bonds: 4, lonePairs: 1 },
  { id: "SF4-structure", question: "Draw the molecular structure of SF4 and mark its lone pair.", central: "S", ligand: "F", bonds: 4, lonePairs: 1 },
  { id: "NH3-pyramidal", question: "What is the shape of NH3? Show its bonds and lone pair.", central: "N", ligand: "H", bonds: 3, lonePairs: 1 },
  { id: "H2O-bent", question: "Draw the shape of H2O, including its lone pairs.", central: "O", ligand: "H", bonds: 2, lonePairs: 2 },
  { id: "CO2-linear", question: "What is the molecular shape of CO2? Show the atoms and bonds.", central: "C", ligand: "O", bonds: 2, lonePairs: 0 },
  { id: "CH4-tetrahedral", question: "Draw the molecular structure and shape of CH4.", central: "C", ligand: "H", bonds: 4, lonePairs: 0 },
  { id: "XeF4-square-planar", question: "What is the shape of XeF4? Include its lone pairs.", central: "Xe", ligand: "F", bonds: 4, lonePairs: 2 },
];
// Representative synthetic IR, never described as the lost original live IR.
const sf4At = fixture.question.indexOf("SF4");
const syntheticIR: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "synthetic_sf4_shape_intent", question: fixture.question,
  facts: [{ id: "shape_request", kind: "requested", statement: fixture.question, evidence: { source: "question", start: 0, end: fixture.question.length, quote: fixture.question } }],
  entities: [{ id: "sf4_molecule", kind: "body", label: fixture.question.slice(sf4At, sf4At + 3), evidenceFactIds: ["shape_request"] }],
  expressions: [], constraints: [], representationIntents: [{ id: "molecule_shape", kind: "conceptual", entityIds: ["sf4_molecule"], evidenceFactIds: ["shape_request"] }], solveRequests: [],
};
cases.push({ ...cases[0]!, id: "synthetic-IR-SF4-independent-control", problemIR: syntheticIR });
const connectivityIR: ProblemIR = {
  ...syntheticIR, id: "synthetic_sf4_atom_connectivity",
  entities: [{ id: "sulfur", kind: "component", label: "S", evidenceFactIds: ["shape_request"] },
    ...Array.from({ length: 4 }, (_, index) => ({ id: `fluorine${index + 1}`, kind: "component" as const, label: "F", evidenceFactIds: ["shape_request"] })),
    { id: "equatorial_lone_pair", kind: "component", label: "lone pair", evidenceFactIds: ["shape_request"] }],
  constraints: Array.from({ length: 4 }, (_, index) => ({ id: `bond${index + 1}`, kind: "connected" as const, entityIds: ["sulfur", `fluorine${index + 1}`], evidenceFactIds: ["shape_request"] })),
  representationIntents: [{ id: "atom_connectivity", kind: "conceptual", entityIds: ["sulfur", "fluorine1", "fluorine2", "fluorine3", "fluorine4", "equatorial_lone_pair"], evidenceFactIds: ["shape_request"] }],
};
cases.push({ ...cases[0]!, id: "synthetic-IR-SF4-connectivity-control", problemIR: connectivityIR });
// Empty solve requests have a valid empty deterministic result. Persistence
// independently recomputes it locally; there is no model/network provider.
const emptyResultFor = (problem: ProblemIR): SolverResult => ({ schemaVersion: "solver-result/v1", problemId: problem.id, providerId: "local-deterministic/v1", status: "solved", values: [], proofs: [], issues: [] });

const roleIds = (document: SceneDocument, role: RegExp): Set<string> => new Set(document.entities.filter(entity => role.test(entity.role ?? "")).map(entity => entity.id));
function moleculeInCommands(row: MolecularCase, document: SceneDocument, commands: DrawCommand[], stage: string): void {
  const atomText = commands.filter(command => command.type === "LABEL").map(command => command.text);
  assert.equal(atomText.filter(text => text === row.central).length, 1, `${stage}: central atom label must be visible`);
  assert.equal(atomText.filter(text => text === row.ligand).length, row.bonds, `${stage}: all ligand labels must be visible`);
  const bonds = roleIds(document, new RegExp(`^${row.central} to ${row.ligand} bond`));
  const primaryBonds = [...bonds].filter(id => !document.entities.find(entity => entity.id === id)?.role?.endsWith(" stroke"));
  assert.equal(primaryBonds.length, row.bonds, `${stage}: complete central-ligand connectivity`);
  for (const id of bonds) assert(commands.some(command => command.semanticRef?.entityId === id && ["DRAW_LINE", "DRAW_POLYGON", "ARROW"].includes(command.type)), `${stage}: missing bond ink ${id}`);
  const lonePairDots = roleIds(document, /^lone pair electron$/);
  assert.equal(lonePairDots.size, 2 * row.lonePairs, `${stage}: source lone-pair electron count`);
  for (const id of lonePairDots) assert(commands.some(command => command.semanticRef?.entityId === id && command.type === "DRAW_POINT"), `${stage}: missing lone-pair dot ${id}`);
}
function equatorialSF4(document: SceneDocument, scene: RenderScene): void {
  const labels = scene.primitives.filter(primitive => primitive.kind === "label");
  const center = labels.find(primitive => primitive.text === "S")?.points[0];
  const ligands = labels.filter(primitive => primitive.text === "F").map(primitive => primitive.points[0]!);
  assert(center && ligands.length === 4);
  let pair: [typeof center, typeof center] | null = null; let widest = 0;
  for (const a of ligands) for (const b of ligands) { const distance = Math.hypot(a.x - b.x, a.y - b.y); if (distance > widest) { widest = distance; pair = [a,b]; } }
  const ids = roleIds(document, /^lone pair electron$/);
  const dots = scene.primitives.filter(primitive => ids.has(primitive.entityId) && primitive.kind === "point").map(primitive => primitive.points[0]!);
  assert(pair && dots.length === 2);
  const direction = { x: pair[0].x - pair[1].x, y: pair[0].y - pair[1].y };
  const lp = { x: (dots[0]!.x + dots[1]!.x) / 2 - center.x, y: (dots[0]!.y + dots[1]!.y) / 2 - center.y };
  assert(Math.hypot(lp.x,lp.y) > 1, "equatorial LP cannot lie on the central atom");
  const normalizedDot = Math.abs(direction.x * lp.x + direction.y * lp.y) / (Math.hypot(direction.x,direction.y) * Math.hypot(lp.x,lp.y));
  assert(normalizedDot < .25, "SF4 lone-pair projection must lie in the equatorial direction, away from the axial pair");
}

async function main(): Promise<void> {
  await check("recorded-full-plan-valid-without-reconstruction", () => { assert(validateTurnPlanV3(fixture.turnPlan, fixture.question).valid); assert.equal(fixture.problemIR, null); });
  await check("synthetic-IR-valid-separately-labelled", () => { assert(validateProblemIR(syntheticIR, fixture.question).valid); });
  await check("synthetic-connectivity-IR-valid-separately-labelled", () => { assert(validateProblemIR(connectivityIR, fixture.question).valid); });
  await check("synthetic-empty-solver-evidence-valid", () => { for (const problem of [syntheticIR, connectivityIR]) assert(validateSolverResult(emptyResultFor(problem), problem).valid); });
  for (const row of cases) {
    const plan = row.plan ?? planFor(row.question);
    const selected = selectProductionScene({ question: row.question, turnPlan: plan, problemIR: row.problemIR ?? null });
    evidence.push({ id: row.id, question: row.question, nativeSelected: !!selected.representation, family: selected.representation?.family, reason: selected.reason, IR: row.problemIR ? "synthetic representative" : "null persisted/fresh control" });
    await check(`${row.id}/native-availability`, () => { assert(selected.representation, selected.reason); assert.match(selected.representation.family ?? "", /^chem_/); });
    // Still inspect transport on the compiled attempted source candidate when
    // admission is RED; this is diagnostic and is never a passing live draw.
    const candidate = selected.representation ?? selected.attemptedRepresentation;
    if (!candidate) { blocked.push(`${row.id}/presentation-save-reopen: no candidate`); continue; }
    const document = candidate.sceneDocument;
    const presentationOptions = { figureFamily: candidate.family, originalQuestion: row.question };
    const presentation = buildVerifiedDiagramPresentation(document, candidate.renderScene, presentationOptions);
    const opening = presentation.introSegments.flatMap(getSegmentCommands);
    await check(`${row.id}/opening-atoms-bonds-lone-pairs`, () => moleculeInCommands(row, document, opening, "opening"));
    if (row.lonePairs > 0) await check(`${row.id}/lone-pair-opens-with-molecular-bonds`, () => {
      const bondIds = roleIds(document, new RegExp(`^${row.central} to ${row.ligand} bond`));
      const firstMoleculeBeat = presentation.introSegments.map(getSegmentCommands).find(commands => commands.some(command => bondIds.has(command.semanticRef?.entityId ?? "")));
      assert(firstMoleculeBeat, "molecular opening beat is missing");
      for (const id of roleIds(document, /^lone pair electron$/)) assert(firstMoleculeBeat.some(command => command.type === "DRAW_POINT" && command.semanticRef?.entityId === id), `lone pair ${id} must open with its molecular bonds`);
    });
    if (row.central === "S") await check(`${row.id}/equatorial-lone-pair-projection`, () => equatorialSF4(document, candidate.renderScene));
    const complete = [...opening];
    const completedTurn = { id: row.id, question: row.question, status: "complete", kind: "lesson", segments: [], sceneArtifacts: null } as unknown as StoredTurn;
    await completeStoredTurnDiagram({ turn: completedTurn, diagram: presentation.diagram, executeCommand: async command => { complete.push(command); }, shouldCancel: () => false });
    await check(`${row.id}/completed-atoms-bonds-lone-pairs`, () => moleculeInCommands(row, document, complete, "completed"));
    const failure = sceneSaveAdmissionFailure({ document, question: row.question, turnPlan: plan, tier: candidate.tier });
    await check(`${row.id}/live-source-save-admission`, () => assert.equal(failure, null));
    const canonical = await canonicalizeTurnSceneMetadata({ question: row.question, sceneDocument: document, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: row.problemIR ?? null, solverResult: row.problemIR ? emptyResultFor(row.problemIR) : null, representationTier: candidate.tier, nonMetric: candidate.nonMetric, candidates: [], figureSource: candidate.figureSource, diagramResultStatus: "ready" }, segments: [] });
    await check(`${row.id}/server-persistence`, () => assert(canonical.ok, canonical.ok ? "" : canonical.error));
    if (!canonical.ok) { blocked.push(`${row.id}/JSON-reopen: persistence refused`); continue; }
    const value = canonical.value;
    const stored: StoredTurn = JSON.parse(JSON.stringify({ id: row.id, orderIndex: 0, question: row.question, rawResponse: "", speedMultiplier: 1, traceId: null, status: "complete", kind: "lesson", ...value, segments: value.segments.map(segment => ({ ...segment, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), id: `${row.id}-${segment.orderIndex}`, audioUrl: null, durationMs: segment.durationMs ?? null, timings: null })) }));
    await check(`${row.id}/JSON-reopen-source-and-ink`, async () => {
      const checked = sourceCheckedStoredTurn(stored); assert.equal(checked.visualStatus, "validated");
      const restored = restoreVerifiedPresentationFromTurn(checked); assert(restored);
      const replay = buildReplayTimeline([checked]).cues.flatMap(cue => cue.commands);
      await completeStoredTurnDiagram({ turn: checked, diagram: restored.diagram, executeCommand: async command => { replay.push(command); }, shouldCancel: () => false });
      moleculeInCommands(row, document, replay, "reopened completed board");
      // Compare the persisted JSON domain on both sides: JSON legitimately
      // omits undefined object fields and serializes -0 as 0. Geometry, labels,
      // quantities and source evidence must otherwise survive unchanged.
      assert.deepEqual(checked.sceneDocument, JSON.parse(JSON.stringify(value.sceneDocument)));
      const artifacts = checked.sceneArtifacts;
      assert(artifacts && typeof artifacts === "object" && "problemIR" in artifacts);
      assert.deepEqual(artifacts.problemIR ?? null, row.problemIR ?? null, "full supplied IR must survive canonical save/reopen");
      const recompiled = compileSceneDocument(value.sceneDocument!); assert(recompiled.ok && recompiled.renderScene);
      if (row.central === "S") equatorialSF4(value.sceneDocument!, recompiled.renderScene);
    });
  }
  const plan = fixture.turnPlan;
  const result = selectProductionScene({ question: fixture.question, turnPlan: plan, problemIR: null });
  const candidate = result.representation ?? result.attemptedRepresentation;
  assert(candidate, "controls need a compiled source candidate");
  await check("unsafe-physical-number-mixed-caption-still-refused", () => {
    const document = structuredClone(candidate.sceneDocument);
    document.annotations.push({ id: "unsafeForce", kind: "callout", targetIds: [], text: "SF4; F = 5 N" });
    // Since #258 (548fa9521) a native VSEPR figure is regenerated from the
    // formula before any other audit, so any added mark is refused as a graph
    // mismatch first. Still refused; the reason is the earlier, stricter guard.
    assert.match(sceneSaveAdmissionFailure({ document, question: fixture.question, turnPlan: plan, tier: candidate.tier }) ?? "", /vsepr_source_graph_mismatch/);
  });
  await check("stale-shared-physical-quantity-still-refused", () => {
    const document = structuredClone(candidate.sceneDocument);
    document.quantities.push({ id: "external_force", symbol: "F", value: 6, unit: "N" });
    const stalePlan: TurnPlanV3 = { ...plan, givens: [{ id: "external_force", symbol: "F", value: 5, unit: "N", sourceText: "F=5 N", provenance: "given" }] };
    // Was /external_force disagrees/: #256 reworded the plan audit message,
    // then #258 put the VSEPR graph check in front of it. Still refused.
    assert.match(sceneSaveAdmissionFailure({ document, question: fixture.question, turnPlan: stalePlan, tier: candidate.tier }) ?? "", /vsepr_source_graph_mismatch/);
  });
  await check("explicit-angle-without-authority-not-silently-dropped", () => {
    // Since #258 the engine letters SF4's equatorial angle with the true bound
    // <120°, so the obligation is met by a bound, never dropped and never
    // turned into an exact number. Since the arc-clearance fix the bound is a
    // caption naming the atoms, "eq. F-S-F <120°", not a bare arc label.
    const question = "Draw the shape of SF4 and label its bond angle.";
    const explicit = selectProductionScene({ question, turnPlan: planFor(question), problemIR: null });
    assert(explicit.representation, explicit.reason);
    const texts = explicit.representation.renderScene.primitives.map(primitive => primitive.text ?? "");
    assert(texts.includes("eq. F-S-F <120°"), `the angle obligation is met by the source bound caption: ${texts.join(" | ")}`);
    assert(!texts.some(text => /^\d+(?:\.\d+)?°$/.test(text)), "no exact SF4 angle is drawn");
  });
  for (const expected of [
    "SF4 has square planar molecular shape with two lone pairs on sulfur.",
    "The molecular shape is tetrahedral.",
    "The hybridisation of sulfur is sp3.",
    "The lone pair is axial.",
    "The molecular shape is not seesaw.",
  ]) await check(`stale-plan-refused/${expected}`, () => {
    const stalePlan: TurnPlanV3 = { ...plan, qualitativeClaims: [{ id: "stale", claim: "SF4 structure", expected, relatedEntityHints: ["SF4"] }] };
    const selected = selectProductionScene({ question: fixture.question, turnPlan: stalePlan, problemIR: null });
    assert.equal(selected.representation, null);
    assert.match(selected.reason, /VSEPR plan claim/);
  });
  for (const expected of ["The lone pair is not axial.", "There are no axial lone pairs.", "The molecular shape is not tetrahedral."])
    await check(`correct-negative-claim-kept/${expected}`, () => {
      const correctPlan: TurnPlanV3 = { ...plan, qualitativeClaims: [{ id: "correct", claim: "SF4 structure", expected, relatedEntityHints: ["SF4"] }] };
      const selected = selectProductionScene({ question: fixture.question, turnPlan: correctPlan, problemIR: null });
      assert(selected.representation, selected.reason);
    });
  // A stated angle given that names neither its role nor its species is not
  // certified: the source certificate (#258) requires both in the given. On a
  // charged stem the one parsed species can be the neutral molecule the reader
  // fell back to (NO2 minus read as NO2), so certifying it would draw a false
  // angle. These stay declined until a reader proves the stem is uncharged.
  const anglePlanFor = (question: string, value: number, kind: "givens" | "derived"): TurnPlanV3 => ({
    ...planFor(question), [kind]: [{ id: "angle", symbol: "theta", value, unit: "degree", sourceText: `${value} degrees`, provenance: kind === "givens" ? "given" : "derived" }],
  });
  for (const [question, value, kind] of [
    ["Show the shape of H2O with its stated bond angle of 104.5 degrees.", 104.5, "givens"],
    ["Show the shape of H2O with its stated bond angle of 104.5 degrees.", 109.5, "givens"],
    ["Show the shapes of H2O and NH3 with the bond angle of 104.5 degrees.", 104.5, "givens"],
    ["Draw the shape of NO2 minus and label its bond angle.", 134, "derived"],
    ["Draw the shape of NO2 plus and label its bond angle.", 134, "derived"],
    ["Draw the shape of SO3 2- and label its bond angle.", 120, "derived"],
    ["Draw the shape of NO2 - with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 - with its bond angle.", 134, "givens"],
    ["Draw the shape of NO2 minus with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of the NO2 negative ion with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of the NO2 anion with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 with a negative charge and its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 with a charge of -1 and its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 plus with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 + with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of the NO2 positive ion with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of the nitronium ion NO2 with its bond angle of 134 degrees.", 134, "givens"],
    ["Draw the shape of SO3 2- with its bond angle of 120 degrees.", 120, "givens"],
    ["Draw the shape of SO3 2 minus with its bond angle of 120 degrees.", 120, "givens"],
    ["Draw the shape of SO3 with a 2- charge and its bond angle of 120 degrees.", 120, "givens"],
    ["Draw the shape of the SO3 ion with its bond angle of 120 degrees.", 120, "givens"],
    ["Draw the shape of the SO3 dianion with its bond angle of 120 degrees.", 120, "givens"],
    ["The NO2 minus ion: draw its shape with the bond angle 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 in nitrogen(III) form with bond angle 134 degrees.", 134, "givens"],
    ["Draw the shape of NO2 (N in +3 state) with bond angle 134 degrees.", 134, "givens"],
  ] as const) await check(`unnamed-angle-declined/${kind}/${value}/${question}`, () => {
    const selected = selectProductionScene({ question, turnPlan: anglePlanFor(question, value, kind), problemIR: null });
    assert.equal(selected.representation, null, "an angle naming neither role nor species is not certified");
    // Since #304 (speciesChargeGuard) a charge the VSEPR reader did not read
    // declines the figure before the certificate audit runs, so a charged stem
    // may be refused by either guard. The neutral H2O rows must still reach
    // the certificate audit.
    assert.match(selected.reason, question.includes("H2O") ? /vsepr_plan_fact_unverified/ : /vsepr_plan_fact_unverified|no family operator program was available/);
  });
  const load = createRequire(import.meta.url); const enginePath = realpathSync(load.resolve("@heytutor/scene-engine"));
  const output = process.argv.indexOf("--out");
  const summary = { passed, failures, blocked, fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"), sourceArtifactSha256: fixture.sourceArtifactSha256, enginePath, engineEntrySha256: createHash("sha256").update(readFileSync(enginePath)).digest("hex"), scope: "Actual native selector, presentation, completion, source admission, canonical persistence and source-checked JSON reopen. No HTTP/DB/provider/browser claim. Original persisted IR null; synthetic representative IR is a separate control.", evidence };
  if (output >= 0) writeFileSync(process.argv[output + 1]!, JSON.stringify(summary, null, 2) + "\n");
  console.log(`verify-live-molecule-availability: ${passed} passed, ${failures.length} failed, ${blocked.length} blocked`);
  if (failures.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
