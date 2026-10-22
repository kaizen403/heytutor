/**
 * Video 3 lane 1 (20 Oct 2026), replayed from recorded /api/chat responses
 * (fixtures/v3-planner-selection.json; no model calls).
 *
 * 1. Exact source first. v3 p1e1-t1: two valid candidates, the restated one
 *    arrived first and won, then final selection dropped it as
 *    source_question_mismatch and the lesson drew nothing. Through the real
 *    planner search and production selection the exact one is now drawn.
 * 2. Coverage first. The old quality score added primitives, entities and
 *    constructions, lower wins, so the sparser of two valid figures always
 *    won. Recorded sibling pairs now pick the one that shows more of the
 *    plan's given and asked quantities (then more values, fewer warnings,
 *    more bound labels). A figure judged fully right keeps winning, and no
 *    winner shows fewer quantities or values than the loser.
 * 3. Salvage. v3 p3c-t1 and p3e1-t1: every turn plan lane was rejected and
 *    the empty fallback plan ran no scene planning (p3c-t1 drew the bare
 *    qualitative family instead). The salvaged plan keeps only the givens the
 *    question states, and for p3c-t1 the scene planner is then attempted.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareSceneCandidates,
  createFallbackTurnPlanV3,
  normalizeSceneDocumentModelOutput,
  parseTurnPlanV3Content,
  planSceneDocumentWithRepair,
  salvageRejectedTurnPlanV3,
  type RejectedTurnPlanV3,
  type TurnPlanV3ParseTrace,
} from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import {
  deriveSceneGate,
  isLabelOwnerWarning,
  sceneCandidateQualityScore,
  sceneQuantityCoverage,
  selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

interface SelectionCase {
  id: string;
  question: string;
  turnPlan: TurnPlanV3;
  candidates: Array<{ chatIndex: number; phase: "plan" | "repair"; arrivedMs: number; document: Record<string, unknown> }>;
  expectedWinner: number;
  verdict: string;
}
const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures/v3-planner-selection.json"), "utf8")) as {
  selection: SelectionCase[];
  salvage: Array<{ id: string; question: string; planContents: string[] }>;
};

const validateCase = (entry: SelectionCase) => entry.candidates.map((candidate) => {
  const document = normalizeSceneDocumentModelOutput(structuredClone(candidate.document), entry.question);
  const validation = validateProductionSceneCandidate({ candidate: document, question: entry.question, turnPlan: entry.turnPlan });
  assert.ok(validation.valid && validation.value, `${entry.id} #${candidate.chatIndex} replays valid`);
  const coverage = sceneQuantityCoverage(validation.value.document, validation.value.renderScene, entry.turnPlan);
  return { candidate, response: { document }, validation, coverage };
});

async function main(): Promise<void> {
// --- 2. coverage-first selection over recorded siblings ----------------------
let changedFromSparser = 0;
for (const entry of fixture.selection) {
  const ranked = validateCase(entry).sort((first, second) => compareSceneCandidates(entry.question, first, second));
  const winner = ranked[0]!;
  assert.equal(winner.candidate.chatIndex, entry.expectedWinner,
    `${entry.id}: expected #${entry.expectedWinner} (${entry.verdict}), got #${winner.candidate.chatIndex}`);
  for (const loser of ranked.slice(1)) {
    const sameSource = compareSceneCandidates(entry.question,
      { ...winner, validation: { valid: true, errors: [], qualityScore: 0 } },
      { ...loser, validation: { valid: true, errors: [], qualityScore: 0 } }) === 0;
    if (!sameSource) continue;
    assert.ok(winner.coverage.covered >= loser.coverage.covered, `${entry.id}: the winner shows no fewer quantities`);
    assert.ok(winner.coverage.valued >= loser.coverage.valued, `${entry.id}: the winner shows no fewer values`);
    const stats = (value: typeof winner) => value.validation.value!.report.stats;
    if (stats(winner).primitiveCount > stats(loser).primitiveCount) changedFromSparser += 1;
  }
  console.log(`  ${entry.id}: #${winner.candidate.chatIndex} wins (${entry.verdict}); covered ${ranked.map((item) => `#${item.candidate.chatIndex}=${item.coverage.covered}/${item.coverage.total} values ${item.coverage.valued}`).join(", ")}`);
}
assert.ok(changedFromSparser >= 3, "the richer figure now wins where the old score preferred the sparser one");

// Clutter is never rewarded: a duplicated label or unlabelled extra ink
// scores no better than the figure without it.
{
  const entry = fixture.selection.find((item) => item.id === "v3/p1c-t2")!;
  const base = validateCase(entry).find((item) => item.candidate.chatIndex === 5)!;
  const score = (extra: { primitives?: number; labels?: string[] }) => sceneCandidateQualityScore({
    textOnly: false, visualRequirement: entry.turnPlan.visualRequirement, warningCount: 0, omittedLabelCount: 0,
    coverage: sceneQuantityCoverage(base.validation.value!.document, {
      primitives: [...base.validation.value!.renderScene.primitives,
        ...(extra.labels ?? []).map((text, index) => ({ id: `dup_${index}`, kind: "label", text, entityId: "x", points: [] }) as never)],
    }, entry.turnPlan),
    structuralCost: base.validation.value!.report.stats.primitiveCount * 2 + base.validation.value!.report.stats.entityCount +
      base.validation.value!.report.stats.constructionCount + ((extra.primitives ?? 0) + (extra.labels?.length ?? 0)) * 2,
  });
  const plain = score({});
  assert.ok(score({ labels: ["v_A = 20 m/s"] }) >= plain, "a repeated label adds no coverage");
  assert.ok(score({ primitives: 12 }) > plain, "unlabelled extra ink is not a reason to win");
  assert.equal(plain, base.validation.qualityScore, "the replay scores the candidate exactly as validation does");
}

// A label that reads as naming another mark outranks coverage: a richer
// candidate with a misowned label loses to a clean, sparser one.
{
  const score = (covered: number, labelOwnerWarningCount: number) => sceneCandidateQualityScore({
    textOnly: false, visualRequirement: "required", warningCount: labelOwnerWarningCount, labelOwnerWarningCount, omittedLabelCount: 0,
    coverage: { total: 4, covered, valued: covered, bound: covered }, structuralCost: 40,
  });
  assert.ok(score(1, 0) < score(4, 1), "a clean figure showing 1 of 4 quantities beats one showing 4 of 4 with a misowned label");
  assert.ok(score(4, 1) < sceneCandidateQualityScore({
    textOnly: true, visualRequirement: "required", warningCount: 0, omittedLabelCount: 0,
    coverage: { total: 4, covered: 0, valued: 0, bound: 0 }, structuralCost: 0,
  }), "a misowned label still beats declining a required figure");
  assert.ok(isLabelOwnerWarning({ code: "point_name_nearer_foreign", severity: "warning" }) && !isLabelOwnerWarning({ code: "label_collision", severity: "warning" }),
    "the scene engine's label owner finding is the one ranked");
}

// A shown number counts for a quantity only with evidence it is that
// quantity's value (PR #249 review): v = 5 m/s and t = 5 s share the number
// 5, so "5 m/s" alone shows the speed, never the time too.
{
  type Label = { id: string; text: string; entityId?: string };
  const plan = (quantities: Array<[string, number, string?]>) => ({
    givens: quantities.map(([symbol, value, unit]) => ({ id: symbol, symbol, value, ...(unit ? { unit } : {}), provenance: "given" as const })),
    derived: [], unknowns: [],
  });
  const coverage = (labels: Label[], quantities: Array<[string, number, string?]>,
    annotations: Array<{ id: string; quantityId: string; targetIds: string[] }> = []) => sceneQuantityCoverage(
    { annotations: annotations.map((annotation) => ({ kind: "label", ...annotation })) },
    { primitives: labels.map((label) => ({ id: label.id, kind: "label", text: label.text, entityId: label.entityId ?? "mark", points: [] }) as never) },
    plan(quantities));
  const speedAndTime: Array<[string, number, string?]> = [["v", 5, "m/s"], ["t", 5, "s"]];
  const speedOnly = coverage([{ id: "l1", text: "5 m/s" }], speedAndTime);
  const both = coverage([{ id: "l1", text: "5 m/s" }, { id: "l2", text: "5 s" }], speedAndTime);
  assert.deepEqual([speedOnly.covered, speedOnly.valued], [1, 1], "a speed label shows the speed only, not the time that shares its number");
  assert.deepEqual([both.covered, both.valued], [2, 2], "each unit shows its own quantity");
  const rank = (shown: typeof both, structuralCost: number) => sceneCandidateQualityScore({
    textOnly: false, visualRequirement: "required", warningCount: 0, omittedLabelCount: 0, coverage: shown, structuralCost,
  });
  assert.ok(rank(both, 30) < rank(speedOnly, 10), "the figure showing both quantities beats a smaller one showing the speed");
  assert.equal(coverage([{ id: "l1", text: "5" }], speedAndTime).valued, 0, "a bare number two quantities share shows neither");
  assert.equal(coverage([{ id: "l1", text: "5" }], [["v", 5, "m/s"]]).valued, 1, "a bare number one quantity holds shows it");
  assert.equal(coverage([{ id: "l1", text: "5 s" }], [["v", 5, "m/s"]]).valued, 0, "a value printed in another dimension never shows the quantity");
  assert.deepEqual(coverage([{ id: "l1", text: "v = 5 m/s, t = 5 s" }], speedAndTime).valued, 2, "each clause's symbol owns its value");
  const boundTime = coverage([{ id: "l1", text: "5" }], speedAndTime, [{ id: "l1", quantityId: "t", targetIds: ["clock"] }]);
  assert.deepEqual([boundTime.valued, boundTime.bound], [1, 1], "a label bound to the time shows the time only");
  const owned = coverage([{ id: "l1", text: "v", entityId: "arrow" }, { id: "l2", text: "5", entityId: "arrow" }], speedAndTime,
    [{ id: "l1", quantityId: "v", targetIds: ["arrow"] }]);
  assert.deepEqual([owned.covered, owned.valued], [1, 1], "a value on the mark the speed's bound label names shows the speed");
  // Recorded v3 p1e1-t1 #6: "v_B = 10 m/s" also counted the 10 s crossing time.
  const entry = fixture.selection.find((item) => item.id === "v3/p1e1-t1")!;
  const recorded = validateCase(entry).find((item) => item.candidate.chatIndex === 6)!.coverage;
  assert.deepEqual([recorded.covered, recorded.valued], [4, 3], `v_B = 10 m/s shows v_B only, not t_a = 10 s: ${JSON.stringify(recorded)}`);
  console.log("  equal values: a shown number counts only for the quantity it belongs to");
}

// --- 1. exact source first, end to end through the planner search ------------
{
  const entry = fixture.selection.find((item) => item.id === "v3/p1e1-t1")!;
  const [restated, exact] = [...entry.candidates].sort((first, second) => first.arrivedMs - second.arrivedMs);
  assert.ok(restated && exact && restated.chatIndex === 5 && exact.chatIndex === 6, "the restated candidate arrived first");
  const nativeFetch = globalThis.fetch;
  // The recorded gap was 538 ms. Replay it wider than the 750 ms grace window
  // so the exact candidate only survives if a restatement does not open it.
  globalThis.fetch = async (_input, init) => {
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    const candidate = lane === "primary" ? restated : exact;
    if (lane !== "primary") {
      await new Promise<void>((resolveWait, reject) => {
        const timer = setTimeout(resolveWait, 1_200);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate.document) } }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await planSceneDocumentWithRepair(entry.question,
      (candidate) => validateProductionSceneCandidate({ candidate, question: entry.question, turnPlan: entry.turnPlan }),
      { proxyUrl: "http://planner.test", timeoutMs: 10_000 });
    assert.ok(result?.validation.valid);
    assert.equal(result.candidates.length, 2, "the restated candidate does not cancel the exact lane");
    const selection = selectProductionScene({
      question: entry.question, turnPlan: entry.turnPlan, problemIR: null,
      candidateValidation: result.validation as never, visualNeedDecision: null,
    });
    assert.notEqual(selection.droppedCandidate?.code, "source_question_mismatch", "the selected candidate is not dropped for its source");
    assert.ok(selection.representation, `the exact candidate is drawn: ${selection.reason}`);
    assert.equal(selection.representation.figureSource, "planner");
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

// --- 3. salvage from the recorded rejected turn plans -----------------------
for (const entry of fixture.salvage) {
  const rejections: RejectedTurnPlanV3[] = [];
  for (const content of entry.planContents) {
    const trace: TurnPlanV3ParseTrace = {};
    assert.equal(parseTurnPlanV3Content(content, entry.question, trace), null, `${entry.id}: the recorded lane is still rejected`);
    assert.ok(trace.arithmetic && trace.issues?.length);
    rejections.push({ lane: "primary", requestKind: "initial", plan: trace.arithmetic.plan, issues: trace.issues });
  }
  const salvaged = salvageRejectedTurnPlanV3(entry.question, rejections);
  assert.ok(salvaged, `${entry.id}: question-stated givens are salvaged`);
  assert.deepEqual(salvaged.derived, [], `${entry.id}: no derived value survives`);
  assert.deepEqual(salvaged.qualitativeClaims, [], `${entry.id}: no claim survives`);
  assert.deepEqual(salvaged.unknowns, []);
  assert.ok(salvaged.lawIds.length > 0, `${entry.id}: law ids are kept`);
  const expected = entry.id === "v3/p3c-t1"
    ? [["vr", 6, "m/s"], ["vm", 8, "m/s"]]
    : [["v1", 5, "km/h"], ["v2", 20, "km/h"], ["a2", 60, "deg"]];
  assert.deepEqual(salvaged.givens.map((given) => [given.id, given.value, given.unit]), expected, `${entry.id}: salvaged givens`);

  // Mutations on the recorded plans: a value the question does not state and
  // a derived value relabelled as given are both dropped.
  const mutated = rejections.map((rejection) => {
    const plan = structuredClone(rejection.plan) as { givens: Array<Record<string, unknown>>; derived: Array<Record<string, unknown>> };
    plan.givens = [
      ...plan.givens.map((given) => ({ ...given, value: (given.value as number) + 1 })),
      ...plan.derived.map((derived) => ({ ...derived, provenance: "given" })),
    ];
    return { ...rejection, plan };
  });
  const leaked = salvageRejectedTurnPlanV3(entry.question, mutated);
  const statedDerived = rejections.flatMap((rejection) => (rejection.plan as { derived: Array<{ value: number; unit?: string }> }).derived)
    .filter((derived) => entry.question.includes(String(derived.value)));
  assert.ok(leaked === null || leaked.givens.every((given) => statedDerived.some((derived) => derived.value === given.value)),
    `${entry.id}: shifted values and derived values never become givens`);

  const fallback = createFallbackTurnPlanV3(entry.question);
  const attempted = (plan: TurnPlanV3) => {
    const gate = deriveSceneGate({ question: entry.question, turnPlan: plan, problemIR: null, visualNeedDecision: null });
    // planningOverlap runs the scene planner only when no fast figure was selected.
    const fast = selectFastVerifiedRepresentation({ question: entry.question, turnPlan: gate.turnPlan, problemIR: null, families: gate.families });
    return gate.shouldPlanExactScene && gate.shouldAttemptLlmScene && fast === null;
  };
  if (entry.id === "v3/p3c-t1") {
    assert.equal(attempted(fallback), false, "p3c-t1 as recorded: the empty fallback drew the bare family and never planned");
    assert.equal(attempted(salvaged), true, "p3c-t1: with the salvaged givens the scene planner is attempted");
  }
  console.log(`  ${entry.id}: salvaged ${salvaged.givens.map((given) => `${given.symbol}=${given.value} ${given.unit}`).join(", ")}; planner attempted ${attempted(fallback)} -> ${attempted(salvaged)}`);
}

console.log("verify-v3-candidate-selection: exact source first, coverage-first selection, and question-stated salvage hold on the recorded turns");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
