import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalDeterministicSolverProvider,
  compileSceneDocument,
  synthesizeFamilyScene,
  validateSceneDocument,
  validateUniformCircularSourceInputs,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

// Adapted from the independent R4 source-repros.mts/findings.mts. Imports and
// fixtures resolve in this checkout; no pinned review implementation runs.
const capture = JSON.parse(readFileSync(
  new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w2-motion/w1-ucm-stone.json", import.meta.url),
  "utf8",
)) as { question: string; actualPlan: TurnPlanV3; savedIR: ProblemIR };
let checks = 0;
let failures = 0;

async function check(name: string, action: () => unknown) {
  checks++;
  try {
    await action();
    console.log(JSON.stringify({ name, pass: true }));
  } catch (error) {
    failures++;
    console.error(JSON.stringify({ name, pass: false, error: String(error).slice(0, 1000) }));
  }
}

function nextUp(value: number): number {
  assert.ok(value > 0 && Number.isFinite(value));
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  bytes.setBigUint64(0, bytes.getBigUint64(0) + 1n);
  return bytes.getFloat64(0);
}

// Simulate JSONB object key order without changing any array order or value.
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  }
  return value;
}

async function main() {
  const { question, actualPlan: turnPlan, savedIR: problemIR } = capture;
  const originalIR = structuredClone(problemIR);
  const scene = synthesizeFamilyScene({ question, turnPlan, problemIR });
  assert.ok(scene, "the actual captured full IR must select unchanged");
  const base = scene.document;
  const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR, {
    signal: new AbortController().signal, deadlineMs: Date.now() + 5_000,
  });
  assert.equal(solverResult.status, "solved");
  const artifacts: SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3", turnPlan, problemIR, solverResult,
    solverAuthority: verifyTurnPlanAgainstSolver(problemIR, solverResult, turnPlan, question),
    representationTier: scene.tier, nonMetric: scene.nonMetric, candidates: [], selectedCandidateId: null,
    selectionReason: scene.reason, diagramResultStatus: "ready", proofObligations: [],
    budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 },
  };
  const stored = (document: unknown, sceneArtifacts: unknown = artifacts): StoredTurn => ({
    id: "offline-r4", question, rawResponse: "", orderIndex: 0, speedMultiplier: 1, traceId: null,
    sceneDocument: document, sceneArtifacts, visualStatus: "validated", sceneEngineVersion: null, validationReport: null,
    segments: [{ id: "intro", orderIndex: 0, narration: "", spokenText: "", audioUrl: null, durationMs: null, timings: null,
      command: serializeSegmentCommands([{ type: "DRAW_LINE", params: [500, 200, 600, 200], charPosition: 0, narrationBefore: "" }],
        { trustedDiagramGeometry: true }) }],
  });
  const save = (document: unknown, sceneArtifacts: unknown = artifacts) => canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, sceneArtifacts, visualStatus: "validated", segments: [],
  });
  const compiled = (document: SceneDocument) => compileSceneDocument(document, { sourceAuthority: { question, problemIR } });

  for (const tier of ["exact_verified", "question_representation"] as const) {
    const document = structuredClone(base);
    document.source.representationTier = tier;
    document.source.nonMetric = tier !== "exact_verified";
    const tierArtifacts = { ...artifacts, representationTier: tier, nonMetric: tier !== "exact_verified" };
    await check(`${tier}: correct raw positive across seams`, async () => {
      assert.ok(compiled(document).ok);
      assert.equal(liveSceneSaveFailure({ document, question, turnPlan, problemIR, tier }), null);
      const saved = await save(document, tierArtifacts);
      assert.ok(saved.ok, saved.ok ? "" : saved.error);
      assert.deepEqual(saved.value.sceneArtifacts?.problemIR, originalIR);
      assert.equal(sourceCheckedStoredTurn(stored(document, tierArtifacts)).visualStatus, "validated");
      assert.ok(restoreVerifiedPresentationFromTurn(stored(document, tierArtifacts)));
    });
    await check(`${tier}: one ULP derived positive canonicalizes with JSONB key order`, async () => {
      const drift = structuredClone(document);
      const scalar = drift.quantities.find(row => row.id === "a_c")!;
      assert.equal(typeof scalar.value, "number");
      scalar.value = nextUp(scalar.value as number);
      assert.notEqual(scalar.value, document.quantities.find(row => row.id === "a_c")!.value);
      assert.deepEqual(validateUniformCircularSourceInputs(drift, question), []);
      assert.ok(compiled(drift).ok);
      assert.equal(liveSceneSaveFailure({ document: drift, question, turnPlan, problemIR, tier }), null);
      const jsonb = reverseKeys(drift);
      const jsonbArtifacts = reverseKeys(tierArtifacts);
      const before = JSON.stringify(jsonb);
      const saved = await save(jsonb, jsonbArtifacts);
      assert.ok(saved.ok, saved.ok ? "" : saved.error);
      assert.deepEqual(saved.value.sceneDocument?.quantities, base.quantities);
      assert.deepEqual(saved.value.sceneArtifacts?.problemIR, originalIR);
      const checked = sourceCheckedStoredTurn(stored(jsonb, jsonbArtifacts));
      assert.equal(checked.visualStatus, "validated");
      assert.deepEqual((checked.sceneDocument as SceneDocument).quantities, base.quantities);
      const restored = restoreVerifiedPresentationFromTurn(stored(jsonb, jsonbArtifacts));
      assert.ok(restored);
      assert.deepEqual(restored.diagram, restoreVerifiedPresentationFromTurn(stored(document, tierArtifacts))!.diagram);
      assert.equal(JSON.stringify(jsonb), before, "seams must not mutate the submitted document");
    });
    await check(`${tier}: exact positive tolerates JSONB key order`, async () => {
      const jsonb = reverseKeys(document);
      const jsonbArtifacts = reverseKeys(tierArtifacts);
      assert.ok((await save(jsonb, jsonbArtifacts)).ok);
      assert.equal(sourceCheckedStoredTurn(stored(jsonb, jsonbArtifacts)).visualStatus, "validated");
      assert.ok(restoreVerifiedPresentationFromTurn(stored(jsonb, jsonbArtifacts)));
    });

    const mutations: Array<[string, (document: SceneDocument) => void, string]> = [
      ["centre caption reveal omission", d => { assert.equal(d.revealGroups[0]!.entityIds.pop(), "source_name_O_0"); }, "revealGroups"],
      ["centre caption required omission", d => { assert.equal(d.requiredEntityIds.pop(), "source_name_O_0"); }, "requiredEntityIds"],
      ["centre caption reveal omission with derived ULP", d => {
        assert.equal(d.revealGroups[0]!.entityIds.pop(), "source_name_O_0");
        const a = d.quantities.find(row => row.id === "a_c")!; a.value = nextUp(a.value as number);
      }, "revealGroups"],
      ["centre caption required omission with derived ULP", d => {
        assert.equal(d.requiredEntityIds.pop(), "source_name_O_0");
        const a = d.quantities.find(row => row.id === "a_c")!; a.value = nextUp(a.value as number);
      }, "requiredEntityIds"],
      ["timeline forgery", d => { d.teachingTimeline[0]!.narrationIntent = "forged motion"; }, "teachingTimeline"],
      ["source radius one ULP", d => { const r = d.quantities.find(row => row.id === "r")!; r.value = nextUp(r.value as number); }, "quantities"],
      ["derived beyond gamma8", d => { const a = d.quantities.find(row => row.id === "a_c")!; a.value = (a.value as number) * (1 + 16 * Number.EPSILON); }, "quantities"],
      ["derived wrong unit", d => { d.quantities.find(row => row.id === "a_c")!.unit = "m"; }, "quantities"],
    ];
    for (const [name, mutate, path] of mutations) {
      for (const markers of ["retained", "removed"] as const) {
        const changed = structuredClone(document);
        mutate(changed);
        if (markers === "removed") {
          delete changed.source.archetype;
          delete changed.source.slotSources;
          changed.entities.forEach(entity => { delete entity.provenance; });
        }
        const prefix = `${tier}: ${name}, markers ${markers}`;
        await check(`${prefix}: raw guard/compiler/live decline`, () => {
          assert.ok(validateUniformCircularSourceInputs(changed, question).some(issue => issue.path === path));
          const result = compiled(changed);
          assert.equal(result.ok, false);
          assert.equal(result.renderScene, null);
          assert.ok(liveSceneSaveFailure({ document: changed, question, turnPlan, problemIR, tier }));
          if (name.includes("omission")) {
            const normalized = validateSceneDocument(changed).document;
            assert.ok(normalized);
            assert.deepEqual(validateUniformCircularSourceInputs(normalized, question), [], "the permissive normalizer still repairs the repro; seam must inspect raw");
          }
        });
        await check(`${prefix}: persistence declines raw payload`, async () => {
          const before = JSON.stringify(changed);
          assert.equal((await save(changed, tierArtifacts)).ok, false);
          assert.equal(JSON.stringify(changed), before);
        });
        await check(`${prefix}: stored read quarantines raw payload and trusted ink`, () => {
          const submitted = stored(changed, tierArtifacts);
          const checked = sourceCheckedStoredTurn(submitted);
          assert.equal(checked.visualStatus, "retry_required");
          assert.equal(checked.segments[0]!.command, null);
          assert.deepEqual(checked.sceneDocument, changed, "no repaired structure may replace the rejected raw payload");
          assert.equal(submitted.visualStatus, "validated");
        });
        await check(`${prefix}: restore declines raw payload`, () => {
          assert.equal(restoreVerifiedPresentationFromTurn(stored(changed, tierArtifacts)), null);
        });
      }
    }
  }
  for (const invalid of [{ ...base, constructions: [null] }, { ...base, entities: null }]) {
    await check("malformed raw structure fails closed at save/read/restore", async () => {
      assert.equal((await save(invalid)).ok, false);
      assert.equal(sourceCheckedStoredTurn(stored(invalid)).visualStatus, "retry_required");
      assert.equal(restoreVerifiedPresentationFromTurn(stored(invalid)), null);
    });
  }
  await check("full captured IR retained throughout", () => assert.deepEqual(problemIR, originalIR));
  console.log(JSON.stringify({ checks, failures, evidence: "offline raw source seams; READY 0; no DB/browser/provider/student lifecycle" }));
  process.exitCode = failures ? 1 : 0;
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
