/** Production selection and persistence must agree on source-computed kinetics. */
import assert from "node:assert/strict";
import { PROBLEM_IR_VERSION, validateTurnPlanV3, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

type Scalar = { id: string; symbol: string; value: number; unit: string };
interface Example { question: string; initial: number; minutes: number; requested: number }
const examples: Example[] = [
  { question: "A first order reaction is 50% complete in 120 minutes. How long does 90% decomposition take?", initial: 50, minutes: 120, requested: 90 },
  { question: "A first order reaction is 40% complete in 50 minutes. Calculate the time for 80% completion.", initial: 40, minutes: 50, requested: 80 },
];
const round = (value: number) => Number(value.toFixed(4));
function planFor(example: Example, minutes: number, unit = "min", extra: Scalar[] = []): TurnPlanV3 {
  const givens: Scalar[] = [
    { id: "g1", symbol: "x₁", value: example.initial, unit: "%" },
    { id: "g2", symbol: "t₁", value: example.minutes, unit: "min" },
    { id: "g3", symbol: "x₂", value: example.requested, unit: "%" },
  ];
  const derived: Scalar[] = [{ id: "answer", symbol: "t_2", value: round(minutes), unit }, ...extra];
  const checked = validateTurnPlanV3({
    schemaVersion: "turn-plan/v3", subject: "chemistry", question: example.question,
    givens: givens.map(quantity => ({ ...quantity, provenance: "given", sourceText: `${quantity.symbol} = ${quantity.value}` })),
    // The unknown and derived answer share a symbol, not an id.
    unknowns: [{ id: "requested_time", symbol: "t₂", unit: "min" }],
    derived: derived.map(quantity => ({ ...quantity, provenance: "derived", dependsOn: ["g1", "g2", "g3"], sourceText: `${quantity.symbol} ≈ ${quantity.value} ${quantity.unit}` })),
    qualitativeClaims: [], lawIds: ["First-order integrated rate law"], assumptions: [], visualRequirement: "required",
  }, example.question);
  assert(checked.plan, JSON.stringify(checked.issues));
  return checked.plan;
}
function problemFor(question: string): ProblemIR {
  const quote = "first order reaction";
  const start = question.indexOf(quote);
  return {
    schemaVersion: PROBLEM_IR_VERSION, id: "reaction_progress", question,
    facts: [{ id: "f0", kind: "given", statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } }],
    entities: [{ id: "reaction", kind: "state", evidenceFactIds: ["f0"] }],
    expressions: [], constraints: [], solveRequests: [],
    representationIntents: [{ id: "iProgress", kind: "conceptual", entityIds: ["reaction"], evidenceFactIds: ["f0"] }],
  };
}
async function verify(example: Example, turnPlan: TurnPlanV3, expected: "validated" | "retry_required"): Promise<void> {
  const selected = selectProductionScene({ question: example.question, turnPlan, problemIR: problemFor(example.question), requiredRetryEnabled: true });
  assert.equal(selected.visualStatus, expected, `${selected.reason}; derived: ${JSON.stringify(turnPlan.derived.map(({ symbol, value, unit }) => ({ symbol, value, unit })))}`);
  const attempted = selected.attemptedRepresentation;
  assert(attempted, "the family must construct a kinetics candidate");
  assert.equal(attempted.family, "chem_kinetics");
  const saved = await canonicalizeTurnSceneMetadata({
    question: example.question, sceneDocument: attempted.sceneDocument, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: attempted.tier, nonMetric: attempted.nonMetric, diagramResultStatus: "ready", turnPlan },
    segments: [],
  } as unknown as SubmittedTurnSceneMetadata);
  assert.equal(saved.ok, expected === "validated", saved.ok ? "stale plan saved" : saved.error);
  assert.equal(selected.representation !== null, saved.ok, "live selection and persistence must agree");
  if (saved.ok) {
    assert.equal(selected.saveFailure, null);
    assert(attempted.sceneDocument.quantities.some(quantity => quantity.id === "k"));
    assert(attempted.sceneDocument.quantities.some(quantity => quantity.id === "t_completion_1"));
    // Submitted metadata cannot authorize changed values.
    const forged = structuredClone(attempted.sceneDocument);
    forged.quantities.find(quantity => quantity.id === "k")!.value = 999;
    assert(sceneSaveAdmissionFailure({ document: forged, question: example.question, turnPlan, tier: attempted.tier }), "forged k must fail recomputation");
  } else assert.match(selected.saveFailure ?? "", /scene_quantity_unverified|disagree/);
}
async function main(): Promise<void> {
  let checks = 0;
  for (const example of examples) {
    const rate = -Math.log(1 - example.initial / 100) / example.minutes;
    const answer = -Math.log(1 - example.requested / 100) / rate;
    const half = Math.LN2 / rate;
    const sourceOnly = { ...planFor(example, answer), unknowns: [], derived: [] };
    await verify(example, sourceOnly, "validated");
    checks++;
    for (const [value, unit, expected, extra] of [
      [answer, "min", "validated", []],
      [answer / 60, "h", "validated", []],
      [answer, "min", "validated", [{ id: "half", symbol: "t_1/2", value: round(half), unit: "min" }]],
      [answer, "min", "validated", [{ id: "rate", symbol: "k", value: Number(rate.toPrecision(3)), unit: "1/min" }]],
      [500, "min", "retry_required", []],
      [500 / 60, "h", "retry_required", []],
      [round(answer * 1.002), "min", "retry_required", []],
      [answer, "kg", "retry_required", []],
      [answer, "fortnights", "retry_required", []],
      [half, "min", "retry_required", []],
      [answer, "min", "retry_required", [{ id: "half", symbol: "t_1/2", value: 90, unit: "min" }]],
      [answer, "min", "retry_required", [{ id: "half", symbol: "t_1/2", value: round(answer), unit: "min" }]],
      [answer, "min", "retry_required", [{ id: "rate", symbol: "k", value: 0.02, unit: "1/min" }]],
      [answer, "min", "retry_required", [{ id: "rate", symbol: "k", value: Number((rate * 1.002).toPrecision(8)), unit: "1/min" }]],
    ] as const) {
      await verify(example, planFor(example, value, unit, [...extra]), expected);
      checks++;
    }
    for (const requested of ["rate", "half", "both"] as const) {
      const rateRequest = requested !== "half" ? " Calculate the rate constant." : "";
      const halfRequest = requested !== "rate" ? " Calculate the half-life." : "";
      const compound = { ...example, question: example.question + rateRequest + halfRequest };
      const extra: Scalar[] = [];
      const unknowns: TurnPlanV3["unknowns"] = [];
      if (requested !== "half") {
        extra.push({ id: "rate", symbol: "k", value: Number(rate.toPrecision(3)), unit: "1/min" });
        unknowns.push({ id: "requested_rate", symbol: "k", unit: "1/min" });
      }
      if (requested !== "rate") {
        extra.push({ id: "half", symbol: "t_1/2", value: Number(half.toFixed(2)), unit: "min" });
        unknowns.push({ id: "requested_half", symbol: "t_1/2", unit: "min" });
      }
      const compoundPlan = planFor(compound, answer, "min", extra);
      compoundPlan.unknowns.push(...unknowns);
      await verify(compound, compoundPlan, "validated");
      const converted = structuredClone(compoundPlan);
      converted.derived[0]!.value = Number((answer / 60).toFixed(4));
      converted.derived[0]!.unit = "h";
      for (const quantity of converted.derived.slice(1)) {
        if (quantity.id === "half") {
          quantity.value = Number((half / 60).toFixed(4));
          quantity.unit = "h";
        }
      }
      for (const quantity of converted.derived) quantity.sourceText = `${quantity.symbol} ≈ ${quantity.value} ${quantity.unit}`;
      await verify(compound, converted, "validated");
      checks++;
      for (const id of extra.map(quantity => quantity.id)) {
        const stale = structuredClone(compoundPlan);
        stale.derived.find(quantity => quantity.id === id)!.value = id === "rate" ? 0.02 : 90;
        await verify(compound, stale, "retry_required");
        checks++;
      }
      if (requested !== "rate") {
        const aliased = structuredClone(compoundPlan);
        aliased.unknowns.find(unknown => unknown.id === "requested_half")!.symbol = "t_half";
        aliased.derived.find(quantity => quantity.id === "half")!.symbol = "t_half";
        await verify(compound, aliased, "validated");
        checks++;
        const wrongRole = structuredClone(compoundPlan);
        wrongRole.derived.find(quantity => quantity.id === "half")!.value = round(answer);
        await verify(compound, wrongRole, "retry_required");
        checks++;
      }
      checks++;
    }
    for (const symbol of ["t₂", `t_${example.requested}`]) {
      const misbound = planFor(example, half);
      misbound.unknowns[0]!.symbol = symbol;
      misbound.derived[0]!.id = misbound.unknowns[0]!.id;
      misbound.derived[0]!.symbol = "t_1/2";
      await verify(example, misbound, "retry_required");
      checks++;
    }
  }
  const multiple = { ...examples[0]!, question: "A first order reaction is 50% complete in 120 minutes. Calculate the time for 90% completion and the time for 99% completion." };
  const rate = Math.LN2 / 120;
  const t90 = -Math.log(0.1) / rate;
  const t99 = -Math.log(0.01) / rate;
  const multiPlan = planFor(multiple, t90, "min", [{ id: "answer99", symbol: "t_99", value: round(t99), unit: "min" }]);
  multiPlan.unknowns = [{ id: "time90", symbol: "t_90", unit: "min" }, { id: "time99", symbol: "t_99", unit: "min" }];
  multiPlan.derived[0]!.symbol = "t_90";
  await verify(multiple, multiPlan, "validated");
  const swapped = structuredClone(multiPlan);
  swapped.derived[0]!.value = round(t99);
  swapped.derived[1]!.value = round(t90);
  await verify(multiple, swapped, "retry_required");
  const ambiguous = structuredClone(multiPlan);
  ambiguous.unknowns[0]!.symbol = ambiguous.derived[0]!.symbol = "t_x";
  await verify(multiple, ambiguous, "retry_required");
  checks += 3;
  console.log(`verify-kinetics-save: ${checks} production/save cases passed`);
}
void main();
