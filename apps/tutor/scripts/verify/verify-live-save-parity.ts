/**
 * Live versus save parity for verified figures.
 *
 * A figure that renders live must save: the lecture save runs the TurnPlan
 * quantity audit and the source-input checks on every tier, and a refusal
 * fails the whole turn. The live turn now runs the same function
 * (liveSceneSaveFailure) before drawing and declines what the save would
 * refuse. This gate selects each figure the way useQuestionHandler does,
 * asks the live check, then submits the same document and plan to the real
 * save canonicalizer, and requires the two to agree in both directions. It
 * also pins the repro: these stems drew live and then failed to save before
 * the live check existed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

type Given = { id: string; symbol: string; value: number; unit?: string; sourceText: string };
interface Case {
  id: string;
  question: string;
  givens: Given[];
  derived?: Given[];
  /** Expected: the live check declines (the save would refuse this figure). */
  declined: boolean;
}

const g = (id: string, value: number, unit: string, sourceText: string): Given => ({ id, symbol: id, value, unit, sourceText });

const CLIFF = "A ball is thrown horizontally at 10 m/s from a cliff 20 m high. Find the time to reach the ground.";
const CASES: Case[] = [
  // The ladder figure draws theta = 60 degrees, a display default: the engine's
  // own slot provenance has no source for it (the stem's foot distance 3 m
  // gives acos(3/5) = 53.13 degrees). The audit is right to refuse it.
  { id: "ladder-default-angle", question: "A ladder 5 m long rests against a vertical wall with its foot 3 m from the wall. Find the height the ladder reaches on the wall.", givens: [g("L", 5, "m", "5 m"), g("d", 3, "m", "3 m")], declined: true },
  // The plan omits a stated given; the engine reads 20 m and 30 degrees from
  // the stem and derives R = 10 sqrt(2*20/9.8) = 20.2 m itself: drawn and saved.
  { id: "cliff-plan-omits-height", question: CLIFF, givens: [g("u", 10, "m/s", "10 m/s")], declined: false },
  { id: "incline-plan-omits-angle", question: "A block of mass 2 kg rests on an incline of 30 degrees. Find the normal force.", givens: [g("m", 2, "kg", "2 kg")], declined: false },
  // A stale plan scalar (R = 25 m) must never pair with the engine's 20.2 m.
  { id: "cliff-stale-plan-range", question: CLIFF, givens: [g("u", 10, "m/s", "10 m/s"), g("h", 20, "m", "20 m")], derived: [g("R", 25, "m", "R")], declined: true },
  // Complete plans: drawn live and saved.
  { id: "incline-complete-plan", question: "A block of mass 2 kg rests on an incline of 30 degrees. Find the normal force.", givens: [g("m", 2, "kg", "2 kg"), g("theta", 30, "degree", "30 degrees")], declined: false },
  { id: "battery-resistor", question: "A 12 V battery is connected across a 4 Ω resistor. Find the current.", givens: [g("V", 12, "V", "12 V"), g("R", 4, "Ω", "4 Ω")], declined: false },
];

function planFor(c: Case): TurnPlanV3 {
  const raw = {
    schemaVersion: "turn-plan/v3", question: c.question,
    givens: c.givens.map((given) => ({ ...given, provenance: "given" })),
    unknowns: [], derived: (c.derived ?? []).map((quantity) => ({ ...quantity, provenance: "derived" })), qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
  const validated = validateTurnPlanV3(raw, c.question);
  assert(validated.plan, `${c.id}: plan fixture must validate: ${JSON.stringify(validated.issues)}`);
  return validated.plan;
}

async function main(): Promise<void> {
  let checks = 0;
  for (const c of CASES) {
    const turnPlan = planFor(c);
    const capabilities = inferSceneCapabilities(c.question, { lawIds: [], problemIR: null, turnPlan });
    const selected = selectVerifiedRepresentation({ question: c.question, turnPlan, families: capabilities.families, problemIR: null });
    assert.equal(selected.sceneDocument.visualDecision.mode, "scene", `${c.id}: the selector draws a figure (${selected.reason})`);
    const liveFailure = liveSceneSaveFailure({ document: selected.sceneDocument, question: c.question, turnPlan, tier: selected.tier });
    const saved = await canonicalizeTurnSceneMetadata({
      question: c.question,
      sceneDocument: selected.sceneDocument,
      visualStatus: "validated",
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: selected.tier, nonMetric: selected.nonMetric, diagramResultStatus: "ready", turnPlan },
      segments: [],
    } as unknown as SubmittedTurnSceneMetadata);
    // Parity, both directions: declined live exactly when the save refuses.
    assert.equal(liveFailure !== null, !saved.ok, `${c.id}: live ${liveFailure ?? "accepts"} vs save ${saved.ok ? "accepts" : (saved as { error: string }).error}`);
    if (!saved.ok) assert.equal(liveFailure, (saved as { error: string }).error, `${c.id}: live and save give the same reason`);
    assert.equal(liveFailure !== null, c.declined, `${c.id}: expected ${c.declined ? "a decline" : "a drawn, saved figure"}; live said ${liveFailure ?? "accept"}`);
    checks += 3;
  }
  // Engine-derived values are recomputed, never trusted from the document: a
  // submitted figure whose stem-read height or derived range was edited is
  // refused live and by the save.
  const cliffPlan = planFor(CASES.find((c) => c.id === "cliff-plan-omits-height")!);
  const cliff = selectVerifiedRepresentation({ question: CLIFF, turnPlan: cliffPlan, families: inferSceneCapabilities(CLIFF, { lawIds: [], problemIR: null, turnPlan: cliffPlan }).families, problemIR: null });
  const forgeries: Array<[string, (doc: typeof cliff.sceneDocument) => void]> = [
    ["stem height edited", (doc) => { const h = doc.quantities.find((quantity) => quantity.id === "h0")!; h.value = 25; }],
    ["derived range label edited", (doc) => { const entity = doc.entities.find((candidate) => candidate.label?.startsWith("R="))!; entity.label = "R=30 m"; }],
  ];
  for (const [name, mutate] of forgeries) {
    const document = structuredClone(cliff.sceneDocument);
    mutate(document);
    const liveFailure = liveSceneSaveFailure({ document, question: CLIFF, turnPlan: cliffPlan, tier: cliff.tier });
    const saved = await canonicalizeTurnSceneMetadata({
      question: CLIFF, sceneDocument: document, visualStatus: "validated",
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: cliff.tier, nonMetric: cliff.nonMetric, diagramResultStatus: "ready", turnPlan: cliffPlan },
      segments: [],
    } as unknown as SubmittedTurnSceneMetadata);
    assert(liveFailure !== null && !saved.ok, `forgery "${name}": live ${liveFailure ?? "accepted"}, save ${saved.ok ? "accepted" : "refused"}`);
    checks += 1;
  }

  // The live hook must actually consult the check before it commits a figure.
  const hook = readFileSync(join(__dirname, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  const call = hook.indexOf("liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan, tier: selected.tier })");
  const gate = hook.indexOf("const selectedIsDrawable = selectedHasInk && !saveFailure &&");
  const commit = hook.indexOf("sceneV2Document = selectedIsDrawable ? selected.sceneDocument : null;");
  assert(call > 0 && gate > call && commit > gate, "useQuestionHandler runs liveSceneSaveFailure before deciding the figure is drawable");
  const persistence = readFileSync(join(__dirname, "../../lib/scene/turnScenePersistence.ts"), "utf8");
  assert(persistence.includes("sceneSaveAdmissionFailure({ document, question, turnPlan, tier })"), "the save runs the shared check");
  checks += 2;
  console.log(`live/save parity verified: ${CASES.length} figures, ${checks} checks`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
