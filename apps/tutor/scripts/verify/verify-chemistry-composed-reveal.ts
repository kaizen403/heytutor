/** Actual production/save presentation and FOCUS execution for composed chemistry answers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { compileSceneDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands, remainingDeferredAnnotations, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const ref = <T>(current: T) => ({ current });
const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
function loadHook<T>(relative: string): T {
  const file = path.join(app, relative);
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (name === "react") return { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {}, useState: (value: unknown) => [value, () => {}] };
    const target = name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
    if (target?.startsWith(path.join(app, "features/tutor-session/hooks"))) return loadHook(path.relative(app, `${target}.ts`));
    return requireApp(target ?? name);
  }, loaded, loaded.exports);
  return loaded.exports as T;
}
const executorHook = loadHook<typeof import("../../features/tutor-session/hooks/useCommandExecution")>("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution;
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); await new Promise<void>(resolve => setTimeout(resolve, 0)); };

async function assertReveal(document: SceneDocument) {
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const answers = new Set(document.source.answerLabelEntityIds as string[]);
  const answerCommand = (command: { semanticRef?: { entityId?: string } }) => answers.has(command.semanticRef?.entityId ?? "");
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  assert(presentation.diagram.commands.some(answerCommand), "the verified answer must remain drawable");
  assert(!presentation.introSegments.flatMap(getSegmentCommands).some(answerCommand), "setup must not write a solved answer");
  for (const mode of ["entity", "group", "annotate"] as const) {
    const { diagram } = buildVerifiedDiagramPresentation(document, compiled.renderScene);
    const answer = diagram.deferredAnnotations?.find(entry => entry.commands.some(answerCommand));
    assert(answer, "the actual numeric answer must be deferred, not merely listed in source metadata");
    assert.equal(answer.revealAfter, "teaching_complete", "computed values cannot acquire given-label reveal policy");
    assert.equal(answer.revealAfterLesson, true);
    const answerId = [...answers][0]!;
    const groupId = diagram.groups!.find(group => group.entityIds.includes(answerId))!.id;
    const command: DrawCommand = { type: mode === "annotate" ? "ANNOTATE" : "FOCUS", params: [], text: mode === "group" ? groupId : answerId, charPosition: 0, narrationBefore: "" };
    const board = mountTestWhiteboard();
    const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
    const executor = executorHook({
      whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: ref<VerifiedDiagram | null>(diagram),
      fbdPhaseStartedRef: ref(true), fbdPhaseMarkedRef: ref(false), boardLayoutRef: ref({ rects: [], nextY: 100 }),
      inkPaceRef: ref("follow"), speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
      turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
      raceWithCancel: async promise => promise, resolveTextPlacement: async (_command, x, y) => ({ x, y }),
      cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {}, nowMs: clock.source.now,
    });
    try {
      let done = false;
      const job = executor.executeCommandWithCancel(command, { durationScale: 0 }).then(() => { done = true; });
      for (let elapsed = 0; !done && elapsed < 60_000; elapsed += 1000) { clock.advance(1000); clock.pump(); await flush(); }
      assert(done, `${mode}: actual executor must settle in a bounded clock`); await job;
      assert(diagram.deferredAnnotations!.includes(answer), `${mode}: focusing an answer or its setup group cannot release it`);
      const completed = remainingDeferredAnnotations(diagram).filter(answerCommand);
      assert.equal(completed.length, answer.commands.length, "completion retains every withheld answer command");
      assert.equal(remainingDeferredAnnotations(diagram).length, 0, "completion releases answers only once");
    } finally { board.cancelAnimations(); unmountTestWhiteboard(board); }
  }
}

const context = "At the same temperature and pressure, gases A and B effuse through the same porous membrane. The molar mass of A is 4 g/mol. ";
const questions = [
  "Find the molarity of a solution containing 5.85 g of NaCl in 500 mL of solution.",
  "Find the molarity of a solution containing 3.6458 g of HCl in 1 L of solution.",
  context + "The effusion rate ratio r_A/r_B = 2. Calculate the molar mass of B.",
  context + "For equal gas volumes, the effusion time ratio t_A/t_B = 2. Calculate the molar mass of B.",
  context + "A 1.5 L sample of A takes 290 s to effuse. A 1.5 dm^3 sample of B takes 1085 s to effuse. Calculate the molar mass of B.",
];
async function main() {
  for (const question of questions) {
    const empty: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
    const initial = selectProductionScene({ question, turnPlan: empty, problemIR: null, requiredRetryEnabled: true });
    assert.equal(initial.visualStatus, "validated", initial.reason);
    const document = initial.attemptedRepresentation!.sceneDocument;
    const answerId = (document.source.answerQuantityIds as string[])[0]!;
    const answer = document.quantities.find(quantity => quantity.id === answerId)!;
    assert(typeof answer.value === "number" && typeof answer.symbol === "string" && typeof answer.unit === "string");
    const { symbol, unit } = answer;
    for (const value of [null, answer.value, Number(answer.value.toPrecision(3))]) {
      const plan: TurnPlanV3 = value === null ? empty : { ...empty, unknowns: [{ id: answerId, symbol, unit }], derived: [{ id: answerId, symbol, unit, value, provenance: "derived", sourceText: "Deterministic source composition" }] };
      const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, requiredRetryEnabled: true });
      assert.equal(selected.visualStatus, "validated", selected.reason);
      const attempted = selected.attemptedRepresentation!;
      await assertReveal(attempted.sceneDocument);
      const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: attempted.sceneDocument, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: attempted.tier, nonMetric: attempted.nonMetric, diagramResultStatus: "ready", turnPlan: plan }, segments: [] });
      assert(saved.ok, saved.ok ? "" : saved.error);
      assert(saved.value.sceneDocument);
      await assertReveal(JSON.parse(JSON.stringify(saved.value.sceneDocument)));
    }
  }
  console.log("composed chemistry: 15 production/save/JSON-reopen cases and 90 real entity/group/ANNOTATE executions keep answers withheld until completion");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
