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
 *   draw nothing and record picture_demand_unmet. A rail circuit whose rod
 *   ends carry a lone "+" or "−" polarity note is refused earlier, at compile.
 *   The recorded P/Q cases may also be refused at compile when its parameter
 *   positions lack an original-source certificate. It still draws nothing.
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
const counts = { drawn: 0, laterDecline: 0, protected: 0, polarityRefused: 0, sourcePointRefused: 0 };

function refusesUnprovedRecordedPoints(row: Row, validation: ReturnType<typeof validateProductionSceneCandidate>): boolean {
  const recordedPointCase = (row.id === "pd32" && row.case === "conic_operator_exempt") ||
    (row.case === "parametric_curve" && ["pd35", "pd36", "pd37", "pd38", "pd39"].includes(row.id));
  return recordedPointCase && !validation.valid &&
    validation.errors.length === 2 && validation.errors.every(issue =>
      issue.code === "requested_point_source_missing" && issue.severity === "fatal" && issue.entityIds?.length === 1) &&
    validation.errors.flatMap(issue => issue.entityIds ?? []).sort().join(",") === "P,Q";
}

function currentFixture(row: Row): SceneDocument {
  const document = structuredClone(row.document);
  if (row.id === "pd01") {
    // Three disconnected Cartesian axes all use the same world origin.
    // This comparison asks for conic forms, not a shared Cartesian plot.
    // Keep every conic, focus, directrix, equation and proof; the engine's
    // shared schematic layout separates the three views horizontally; the
    // parabola's infinite vertical directrix stays in its own view.
    const axes = new Set(document.entities.filter(entity => entity.kind === "axes").map(entity => entity.id));
    document.entities = document.entities.filter(entity => !axes.has(entity.id));
    document.constructions = document.constructions.filter(construction => construction.operator !== "axes");
    document.requiredEntityIds = document.requiredEntityIds.filter(id => !axes.has(id));
    for (const group of document.revealGroups) group.entityIds = group.entityIds.filter(id => !axes.has(id));
    for (const [id, x] of [["parabola_origin", -16], ["ellipse_origin", 0], ["hyperbola_origin", 16]] as const) {
      document.constructions.find(construction => construction.outputs.includes(id))!.inputs.x = x;
    }
    document.revealGroups = [{ id: "comparison", entityIds: document.entities.map(entity => entity.id), dependsOn: [],
      narrationCue: document.revealGroups.map(group => group.narrationCue).join(" ") }];
  }
  if (row.id === "pd52") {
    // Both identical spheres have these forces. Repeating their names does
    // not infer a numeric answer or change any direction/angle proof.
    for (const [id, label] of [["right_repulsion", "F_e"], ["right_tension", "T"], ["right_weight", "mg"]]) {
      document.entities.find(entity => entity.id === id)!.label = label;
    }
  }
  return document;
}

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
  assert.equal(hash(row.document), row.docHash, `${label}: the original recording stays unchanged`);
  if (row.id === "pd01" || row.id === "pd52") {
    const unsafe = validateProductionSceneCandidate({ candidate: structuredClone(row.document) as unknown as Record<string, unknown>, question: row.question, turnPlan: row.turnPlan });
    const code = row.id === "pd01" ? "axes_frames_overlap" : "vector_without_label";
    assert(!unsafe.valid && unsafe.errors.some(issue => issue.code === code), `${label}: original unsafe recording stays refused (${JSON.stringify(unsafe.errors)})`);
    assert.equal(selectProductionScene({ question: row.question, turnPlan: row.turnPlan, problemIR: null,
      candidateValidation: unsafe, policy }).representation, null, `${label}: unsafe recording draws nothing`);
  }
  const document = currentFixture(row);
  assert.equal(document.source.question, row.question, `${label}: repair retains the original source`);
  assert.deepEqual(document.quantities, row.document.quantities, `${label}: repair changes no source values`);
  assert.deepEqual(document.assertions, row.document.assertions, `${label}: repair preserves every proof obligation`);
  const validation = validateProductionSceneCandidate({ candidate: document as unknown as Record<string, unknown>, question: row.question, turnPlan: row.turnPlan });
  // A lone "+" or "−" polarity note cannot bind a terminal, so the compiler
  // refuses it in both yield modes, before the picture demand is consulted.
  // Only a protected row may end here, and it still draws nothing.
  const polarityRefused = !validation.valid && validation.errors.some(issue => issue.code === "polarity_binding_ambiguous");
  const sourcePointRefused = refusesUnprovedRecordedPoints(row, validation);
  if (polarityRefused || sourcePointRefused) {
    assert(!DRAWN.has(row.case), `${label}: a drawn row cannot take an early-refusal path`);
    const refused = selectProductionScene({
      question: row.question, turnPlan: row.turnPlan, problemIR: null, candidateValidation: validation,
      fastRepresentation: null, exactFigureSource: "planner", solverAuthorityBlocked: row.solverBlocked,
      requiredRetryEnabled: true, policy,
    });
    assert.equal(refused.representation, null, `${label}: strict draws no stand in`);
    counts.protected += 1;
    counts.polarityRefused += Number(polarityRefused);
    counts.sourcePointRefused += Number(sourcePointRefused);
    continue;
  }
  assert(validation.valid && validation.value, `${label}: current fixture must validate: ${JSON.stringify(validation.errors)}`);
  assert.equal(hash(validation.value.document), hash(document), `${label}: revalidation keeps the current fixture`);
  if (row.id === "pd01") {
    for (const entity of row.document.entities.filter(entity => entity.label)) {
      assert(validation.value.renderScene.primitives.some(primitive => primitive.entityId === entity.id && primitive.kind === "label" && primitive.text === entity.label),
        `${label}: original verified label ${entity.label} remains compiled`);
    }
    const boxes = row.document.revealGroups.map(group => {
      const points = validation.value!.renderScene.primitives.filter(primitive => group.entityIds.includes(primitive.entityId) && primitive.kind !== "label").flatMap(primitive => primitive.points);
      assert(points.length, `${group.id}: actual panel ink`);
      return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      assert(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY, `conic comparison views remain separate: ${JSON.stringify(boxes)}`);
    }
  }
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
    assert.equal(hash(withoutTier(selection.representation?.sceneDocument)), hash(withoutTier(document)), `${label}: selection preserves the source-bound current fixture`);
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
 * source question set to that stem, and must still draw nothing. An admitted
 * candidate must record picture_demand_unmet. pd30 is the study's judged
 * wrong conic operator figure.
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
  const sourcePointRefused = refusesUnprovedRecordedPoints(row, validation);
  if (!sourcePointRefused) {
    assert(validation.valid && validation.value, `${label}: the reworded candidate must still validate`);
  }
  const selection = selectProductionScene({
    question, turnPlan, problemIR: null, candidateValidation: validation,
    fastRepresentation: null, exactFigureSource: "planner", solverAuthorityBlocked: row.solverBlocked,
    requiredRetryEnabled: true, policy,
  });
  if (!sourcePointRefused) {
    assert.equal(selection.droppedCandidate?.code, "picture_demand_unmet", `${label}: still dropped by the picture demand (${selection.reason})`);
  }
  assert.equal(selection.representation, null, `${label}: strict draws no stand in`);
  reworded += 1;
}
console.log(`verify-picture-demand-conic-rows: ok (drawn ${counts.drawn}, declined by a later check ${counts.laterDecline}, still drawing nothing ${counts.protected} (${counts.polarityRefused} refused earlier for a lone polarity sign, ${counts.sourcePointRefused} for unproved P/Q positions), reworded protected ${reworded})`);
