/**
 * Recorded picture demand drops through the live final selection, strict.
 *
 * The scene-engine fixture `picture-demand-drops.json` holds planner
 * candidates that main (aeb3eb11e) rejected with picture_demand_unmet. Here
 * each one is revalidated as a production candidate and handed to
 * selectProductionScene under the live strict decision for its subject:
 *
 * - a conic drawn with the engine's conic operator, and charged spheres hung
 *   on threads, are drawn as the planner's figure with no recorded drop. A
 *   row whose own report carries a failed assertion now meets the demand and
 *   is still declined by that later check, so the demand is no bypass;
 * - a point placed by its parameter angle, a parametric or polar curve, a
 *   conic written x*x, a rail circuit and a photoelectric energy ladder still
 *   draw nothing and record picture_demand_unmet.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-picture-demand-conic-rows.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { FIGURE_SOURCES, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import {
  diagramStrategyAllowsFigureSource,
  liveDiagramStrategyDecision,
} from "../../features/tutor-session/lib/scene/diagramStrategy";

interface Row {
  id: string;
  case: string;
  topic: string;
  subject: string;
  question: string;
  turnPlan: TurnPlanV3;
  solverBlocked: boolean;
  docHash: string;
  document: SceneDocument;
}

const fixturePath = resolve(__dirname, "../../../../packages/scene-engine/scripts/verify/fixtures/picture-demand-drops.json");
const { rows } = JSON.parse(readFileSync(fixturePath, "utf8")) as { rows: Row[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
// The exact branch writes the earned tier into source; everything else is the planner's document.
const withoutTier = (document: SceneDocument | undefined) => {
  if (!document) return null;
  const source: Record<string, unknown> = { ...document.source };
  delete source.representationTier;
  delete source.nonMetric;
  return { ...document, source };
};

const DRAWN = new Set(["conic_operator", "thread_spheres"]);
const counts = { drawn: 0, laterDecline: 0, protected: 0 };

for (const row of rows) {
  const label = `${row.id} ${row.case} (${row.topic})`;
  const decision = liveDiagramStrategyDecision({
    assignedStrategy: "strict", subject: row.subject, strictSubjects: ["maths", "physics"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false,
  } as Parameters<typeof liveDiagramStrategyDecision>[0]);
  assert.equal(decision.strategy, "strict", `${label}: the live decision for ${row.subject} is strict`);
  const policy = {
    preferPlanner: true,
    allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)),
  };
  const validation = validateProductionSceneCandidate({ candidate: structuredClone(row.document) as unknown as Record<string, unknown>, question: row.question, turnPlan: row.turnPlan });
  assert(validation.valid && validation.value, `${label}: the recorded candidate must still validate`);
  assert.equal(hash(validation.value.document), row.docHash, `${label}: revalidation keeps the recorded document`);
  const selection = selectProductionScene({
    question: row.question, turnPlan: row.turnPlan, problemIR: null, candidateValidation: validation,
    fastRepresentation: null, exactFigureSource: "planner", solverAuthorityBlocked: row.solverBlocked,
    requiredRetryEnabled: true, policy,
  });
  const unproven = validation.value.report.issues.some((issue) => issue.severity === "fatal" || issue.code === "assertion_failed");
  if (DRAWN.has(row.case) && unproven) {
    assert.equal(selection.droppedCandidate?.code, "exact_assertion_unproven", `${label}: met the demand, declined by its failed assertion (${selection.reason})`);
    assert.equal(selection.representation, null, `${label}: strict draws no stand in`);
    counts.laterDecline += 1;
  } else if (DRAWN.has(row.case)) {
    assert.equal(selection.visualStatus, "validated", `${label}: drawn under strict (${selection.reason})`);
    assert.equal(selection.representation?.figureSource, "planner", `${label}: the planner's own figure is drawn`);
    assert.equal(hash(withoutTier(selection.representation?.sceneDocument)), hash(withoutTier(row.document)), `${label}: the drawn document is the recorded one`);
    assert.equal(selection.droppedCandidate, null, `${label}: a drawn candidate records no drop`);
    counts.drawn += 1;
  } else {
    assert.equal(selection.droppedCandidate?.code, "picture_demand_unmet", `${label}: still dropped by the picture demand (${selection.reason})`);
    assert.notEqual(selection.representation?.figureSource, "planner", `${label}: the dropped candidate is not drawn`);
    assert.equal(selection.representation, null, `${label}: strict draws no stand in`);
    counts.protected += 1;
  }
}
assert(counts.drawn >= 25 && counts.protected >= 10 && counts.laterDecline <= 2,
  `fixture coverage: drawn ${counts.drawn}, later decline ${counts.laterDecline}, protected ${counts.protected}`);

/*
 * The same protected documents asked in other words (PR #190 review). Each
 * recorded parameter angle document is paired with a reworded stem, its
 * source question set to that stem, and must still record
 * picture_demand_unmet: the wording, not the recorded phrase, keeps today's
 * rule. pd30 is the study's judged wrong conic operator figure.
 */
const REWORDED: [string, string][] = [
  ["pd30", "parametric form of a point on an ellipse"],
  ["pd30", "a point on an ellipse written as (a cos θ, b sin θ)"],
  ["pd30", "ellipse pe point ke coordinates (a cos θ, b sin θ) form mein samjhao"],
  ["pd33", "what is the angle θ in the point (a cos θ, b sin θ) of an ellipse"],
  ["pd33", "what is the point (a\\cos{\\theta}, b\\sin{\\theta}) of an ellipse"],
  ["pd32", "An ellipse is given by x = 6 cos θ, y = 2 sin θ. Find the points P and Q where θ = pi/6 and θ = -pi/6, and the length of the chord PQ."],
  ["pd32", "An ellipse is given by x = 6 cos θ, y = 2 sin θ. Find the points P and Q corresponding to θ = pi/6 and θ = -pi/6, and the length of the chord PQ."],
  ["pd32", "An ellipse is given by x = 6 cos \\theta, y = 2 sin \\theta. Find the points P and Q at \\theta = \\pi/6 and \\theta = -\\pi/6, and the length of the chord PQ."],
];
let reworded = 0;
for (const [id, question] of REWORDED) {
  const row = rows.find((candidate) => candidate.id === id);
  assert(row && row.case === "conic_operator_exempt", `${id}: a recorded parameter angle row`);
  const label = `${id} reworded "${question}"`;
  const document = structuredClone(row.document);
  (document.source as Record<string, unknown>).question = question;
  const turnPlan = { ...row.turnPlan, question };
  const decision = liveDiagramStrategyDecision({
    assignedStrategy: "strict", subject: row.subject, strictSubjects: ["maths", "physics"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false,
  } as Parameters<typeof liveDiagramStrategyDecision>[0]);
  const policy = {
    preferPlanner: true,
    allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)),
  };
  const validation = validateProductionSceneCandidate({ candidate: document as unknown as Record<string, unknown>, question, turnPlan });
  assert(validation.valid && validation.value, `${label}: the reworded candidate must still validate`);
  const selection = selectProductionScene({
    question, turnPlan, problemIR: null, candidateValidation: validation,
    fastRepresentation: null, exactFigureSource: "planner", solverAuthorityBlocked: row.solverBlocked,
    requiredRetryEnabled: true, policy,
  });
  assert.equal(selection.droppedCandidate?.code, "picture_demand_unmet", `${label}: still dropped by the picture demand (${selection.reason})`);
  assert.equal(selection.representation, null, `${label}: strict draws no stand in`);
  reworded += 1;
}
console.log(`verify-picture-demand-conic-rows: ok (drawn ${counts.drawn}, declined by a later check ${counts.laterDecline}, still picture_demand_unmet ${counts.protected}, reworded protected ${reworded})`);
