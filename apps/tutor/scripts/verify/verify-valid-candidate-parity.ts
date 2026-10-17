/**
 * A scene candidate that passes per-candidate validation must either be the
 * figure drawn or leave a recorded reason. Production (15 Oct 2026): the
 * planner restated a messy stem (a bullet, LaTeX) in source.question, final
 * selection required the exact asked text, and a valid figure vanished with
 * no issue code. The exact match stays (writing the asked question over a
 * restatement drew 9 wrong strict figures in a replay of 74 restated runs);
 * the drop now names itself.
 *
 * One fixture per decline path runs through selectProductionScene and
 * asserts the code, what was drawn instead and the degradation the turn
 * keeps. The live hook and the lab both settle that degradation through
 * settleSelectionDegradation, and this gate executes their own lines, so a
 * consumer that stops saving the drop turns it red. Synthetic stems only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { normalizeSceneDocumentModelOutput, inferSceneCapabilities } from "@heytutor/tutor-core";
import {
  FIGURE_SOURCES, validateTurnPlanV3, type FigureSource, type SceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { extractArtifactSummary } from "../../lib/admin/outcome";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import {
  selectVerifiedRepresentation, selectVerifiedRepresentationExplained, type SelectedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";
import {
  VALID_CANDIDATE_DROPPED,
  selectProductionScene,
  settleSelectionDegradation,
  validCandidateDropDegradation,
  validateProductionSceneCandidate,
  type DroppedSceneCandidate,
  type ProductionSceneSelection,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Policy = { preferPlanner: boolean; allowedFigureSources: FigureSource[] };
const strictPolicy: Policy = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] };
const currentPolicy: Policy = { preferPlanner: false, allowedFigureSources: [...FIGURE_SOURCES] };

// The production row's shape: a bullet and LaTeX in the stem, restated by the planner.
const asked = "• A 4 kg crate is dragged across a rough floor by a horizontal pull of 20 N. If the coefficient of " +
  "kinetic friction (\\mu _{k}) between the crate and the floor is 0.25, what is the acceleration of the crate? (Take g = 10 m/s^2)";
const reworded = "A 4 kg crate is pulled across a rough floor with a horizontal force of 20 N. The coefficient of kinetic " +
  "friction is 0.25 and g = 10 m/s². What is the acceleration of the crate?";
const otherQuestion = "A 6 kg box is pushed along a rough floor by a horizontal force of 30 N. The coefficient of kinetic " +
  "friction is 0.25 and g = 10 m/s². Find the acceleration of the box.";

const frictionPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: asked, visualRequirement: "required",
  givens: [
    { id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given", sourceText: "m = 4" },
    { id: "F", symbol: "F", value: 20, unit: "N", provenance: "given", sourceText: "F = 20" },
    { id: "mu", symbol: "μₖ", value: 0.25, provenance: "given", sourceText: "mu = 0.25" },
    { id: "g", symbol: "g", value: 10, unit: "m/s²", provenance: "given", sourceText: "g = 10" },
  ],
  unknowns: [{ id: "a", symbol: "a", unit: "m/s²" }],
  derived: [
    { id: "a", symbol: "a", value: 2.5, unit: "m/s²", provenance: "derived", dependsOn: ["F", "fr", "m"],
      sourceText: "a = (F − fₖ)/m = (20 − 10)/4 = 2.5 m/s²" },
    { id: "fr", symbol: "fₖ", value: 10, unit: "N", provenance: "derived", dependsOn: ["mu", "m", "g"],
      sourceText: "fₖ = μₖmg = 0.25 × 4 × 10 = 10 N" },
  ],
  qualitativeClaims: [], lawIds: ["kinetic-friction-law", "newtons-second-law"], assumptions: [],
};

/** The friction figure as the model wrote it, for whichever question it claims. */
const frictionOutput = (question: string): Record<string, unknown> => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "planner visual decision" },
  source: { question },
  quantities: [
    { id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given" },
    { id: "F", symbol: "F", value: 20, unit: "N", provenance: "given" },
    { id: "mu", symbol: "μₖ", value: 0.25, provenance: "given" },
    { id: "g", symbol: "g", value: 10, unit: "m/s²", provenance: "given" },
    { id: "a", symbol: "a", value: 2.5, unit: "m/s²", provenance: "derived", dependsOn: ["F", "fr", "m"] },
    { id: "fr", symbol: "fₖ", value: 10, unit: "N", provenance: "derived", dependsOn: ["mu", "m", "g"] },
  ],
  entities: [
    { id: "surfaceLeft", kind: "point", role: "helper point" },
    { id: "surfaceRight", kind: "point", role: "helper point" },
    { id: "surface", kind: "segment", role: "surface" },
    { id: "bodyCenter", kind: "point", role: "helper point" },
    { id: "body", kind: "rectangle", role: "body", label: "m = 4 kg" },
    { id: "forceTip", kind: "point", role: "helper point" },
    { id: "pull", kind: "vector", role: "applied force", label: "F = 20 N" },
  ],
  constructions: [
    { id: "c1", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["surfaceLeft"] },
    { id: "c2", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["surfaceRight"] },
    { id: "c3", operator: "segment", inputs: { start: "surfaceLeft", end: "surfaceRight" }, outputs: ["surface"] },
    { id: "c4", operator: "point", inputs: { x: 0, y: 0.5, coordinateSpace: "world" }, outputs: ["bodyCenter"] },
    { id: "c5", operator: "rectangle", inputs: { center: "bodyCenter", width: 2, height: 1 }, outputs: ["body"] },
    { id: "c6", operator: "point", inputs: { x: 2, y: 0.5, coordinateSpace: "world" }, outputs: ["forceTip"] },
    { id: "c7", operator: "vector", inputs: { start: "bodyCenter", end: "forceTip" }, outputs: ["pull"] },
  ],
  relations: [], assertions: [],
  annotations: [
    { id: "muLabel", kind: "label", targetIds: ["surface"], text: "μₖ = 0.25", quantityId: "mu" },
    { id: "gLabel", kind: "label", targetIds: ["body"], text: "g = 10 m/s²", quantityId: "g" },
  ],
  requiredEntityIds: ["body", "surface", "pull", "surfaceLeft", "surfaceRight", "bodyCenter", "forceTip"],
  revealGroups: [{ id: "setup", entityIds: ["surfaceLeft", "surfaceRight", "surface", "bodyCenter", "body", "forceTip", "pull"],
    dependsOn: [], narrationCue: "reveal scene" }],
  teachingTimeline: [],
});

type Quantity = { id: string; value: number; unit?: string };
function planFor(question: string, givens: Quantity[], derived: Quantity[] = []): TurnPlanV3 {
  const validated = validateTurnPlanV3({
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: givens.map((quantity) => ({ ...quantity, symbol: quantity.id, provenance: "given", sourceText: quantity.id })),
    derived: derived.map((quantity) => ({ ...quantity, symbol: quantity.id, provenance: "derived", sourceText: quantity.id })),
    unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  }, question);
  assert(validated.plan, `plan fixture must validate: ${JSON.stringify(validated.issues)}`);
  return validated.plan;
}

/** A small labelled planner scene: a segment between two points, plus optional quantity labels. */
function segmentOutput(question: string, label: string, shown: Quantity[] = []): Record<string, unknown> {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "planner visual decision" },
    source: { question },
    quantities: shown.map((quantity) => ({ ...quantity, symbol: quantity.id, provenance: "derived" })),
    entities: [
      { id: "A", kind: "point", role: "helper point", label: "A" },
      { id: "B", kind: "point", role: "helper point", label: "B" },
      { id: "AB", kind: "segment", role: "line", label },
    ],
    constructions: [
      { id: "c1", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
      { id: "c2", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["B"] },
      { id: "c3", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["AB"] },
    ],
    relations: [], assertions: [],
    annotations: shown.map((quantity) => ({ id: `${quantity.id}Label`, kind: "label", targetIds: ["AB"],
      text: `${quantity.id} = ${quantity.value} ${quantity.unit ?? ""}`.trim(), quantityId: quantity.id })),
    requiredEntityIds: ["A", "B", "AB"],
    revealGroups: [{ id: "setup", entityIds: ["A", "B", "AB"], dependsOn: [], narrationCue: "reveal scene" }],
    teachingTimeline: [],
  };
}

interface Selecting {
  question: string;
  turnPlan: TurnPlanV3;
  /** The model's output; it passes the planner parse step as in the live turn. */
  output: Record<string, unknown>;
  policy: Policy;
  /** The plan the candidate was validated against, when the final plan was corrected after it. */
  validatedAgainst?: TurnPlanV3;
  exactFigureSource?: "planner" | "verified_recovery";
  fastRepresentation?: SelectedRepresentation;
}

function select(input: Selecting): ProductionSceneSelection {
  const parsed = normalizeSceneDocumentModelOutput(structuredClone(input.output), input.question) as Record<string, unknown>;
  const candidateValidation = validateProductionSceneCandidate({
    candidate: parsed, question: input.question, turnPlan: input.validatedAgainst ?? input.turnPlan,
  });
  assert(candidateValidation.valid, `fixture candidate must validate: ${JSON.stringify(candidateValidation.errors.slice(0, 3))}`);
  return selectProductionScene({
    question: input.question, turnPlan: input.turnPlan, problemIR: null,
    sceneCapabilities: inferSceneCapabilities(input.question, { lawIds: input.turnPlan.lawIds, problemIR: null, turnPlan: input.turnPlan }),
    candidateValidation, exactFigureSource: input.exactFigureSource ?? "planner", requiredRetryEnabled: true,
    policy: input.policy, fastRepresentation: input.fastRepresentation,
  });
}

const labels = (selection: ProductionSceneSelection) => selection.representation?.renderScene.primitives.flatMap((primitive) =>
  (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []) ?? [];

// 1. The parse step keeps the model's own question (main's rule), so the
// restated production row reaches selection with its restatement.
const parsed = normalizeSceneDocumentModelOutput(frictionOutput(reworded), asked) as { source: SceneDocument["source"] };
assert.equal(parsed.source.question, reworded, "the planner parse step must keep an explicit model source.question");

// 2. Controls: each fixture's candidate is drawn when its decline does not apply.
const conicQuestion = "Sketch the ellipse x^2/9 + y^2/4 = 1 and mark its foci.";
const opticsQuestion = "An object is placed 30 cm in front of a concave mirror of focal length 10 cm. Find the position of the image.";
const cliffQuestion = "A ball is thrown horizontally at 10 m/s from a cliff 20 m high. Find the time to reach the ground.";
const batteryQuestion = "A 12 V battery is connected across a 4 Ω resistor. Find the current.";
const blockQuestion = "A 2 kg block is pulled along a smooth floor by a horizontal force of 8 N. Find its acceleration.";
const batteryPlan = planFor(batteryQuestion, [{ id: "V", value: 12, unit: "V" }, { id: "R", value: 4, unit: "Ω" }]);
const blockGivens: Quantity[] = [{ id: "m", value: 2, unit: "kg" }, { id: "F", value: 8, unit: "N" }];
const blockPlan = planFor(blockQuestion, blockGivens, [{ id: "a", value: 4, unit: "m/s²" }]);
const stalePlan = planFor(blockQuestion, blockGivens, [{ id: "a", value: 5, unit: "m/s²" }]);
const controls: Array<[string, Selecting]> = [
  ["friction, exact question", { question: asked, turnPlan: frictionPlan, output: frictionOutput(asked), policy: strictPolicy }],
  ["friction, exact question", { question: asked, turnPlan: frictionPlan, output: frictionOutput(asked), policy: currentPolicy }],
  ["battery", { question: batteryQuestion, turnPlan: batteryPlan, output: segmentOutput(batteryQuestion, "wire"), policy: strictPolicy }],
  ["block, current plan", { question: blockQuestion, turnPlan: blockPlan, output: segmentOutput(blockQuestion, "floor", [{ id: "a", value: 4, unit: "m/s²" }]), policy: strictPolicy }],
];
for (const [name, input] of controls) {
  const drawn = select(input);
  assert.equal(drawn.representation?.figureSource, "planner", `control ${name}: the valid planner figure is drawn (${drawn.reason})`);
  assert.equal(drawn.visualStatus, "validated");
  assert.equal(drawn.droppedCandidate, null, `control ${name}: a drawn candidate records no drop`);
  assert.equal(settleSelectionDegradation({ earlier: null, selection: drawn, candidateCount: 1 }).degradation, null);
}
assert(labels(select(controls[0]![1])).includes("F = 20 N"), "the drawn friction figure keeps its labels");

// 3. One fixture per decline path. `drawn` is what the turn shows instead
// (null: nothing); `saved` says whether the turn keeps a degradation.
const cliffFresh = planFor(cliffQuestion, [{ id: "u", value: 10, unit: "m/s" }, { id: "h", value: 20, unit: "m" }]);
const cliffStaleRange = planFor(cliffQuestion, [{ id: "u", value: 10, unit: "m/s" }, { id: "h", value: 20, unit: "m" }],
  [{ id: "R", value: 25, unit: "m" }]);
const batteryFast = selectVerifiedRepresentation({ question: batteryQuestion, turnPlan: batteryPlan, problemIR: null,
  families: inferSceneCapabilities(batteryQuestion, { lawIds: [], problemIR: null, turnPlan: batteryPlan }).families });
assert.notEqual(batteryFast.figureSource, "planner", "the fast fixture needs a non-planner figure");
const noFigureQuestion = "What is the SI unit of force?";
const chemistryQuestion = "Draw the Lewis structure of water, H2O.";

interface DeclineFixture {
  name: string;
  input: Selecting;
  code: string;
  preferred: boolean;
  drawn: FigureSource | null;
  saved: boolean;
}
const fixtures: DeclineFixture[] = [
  // The production row: strict draws nothing, current draws a fallback; both keep the reason.
  { name: "restated question, strict", code: "source_question_mismatch", preferred: false, drawn: null, saved: true,
    input: { question: asked, turnPlan: frictionPlan, output: frictionOutput(reworded), policy: strictPolicy } },
  { name: "restated question, current", code: "source_question_mismatch", preferred: false, drawn: "family", saved: true,
    input: { question: asked, turnPlan: frictionPlan, output: frictionOutput(reworded), policy: currentPolicy } },
  { name: "recovered from another question, strict", code: "source_question_mismatch", preferred: false, drawn: null, saved: true,
    input: { question: asked, turnPlan: frictionPlan, output: frictionOutput(otherQuestion), policy: strictPolicy, exactFigureSource: "verified_recovery" } },
  { name: "recovered from another question, current", code: "source_question_mismatch", preferred: false, drawn: "family", saved: true,
    input: { question: asked, turnPlan: frictionPlan, output: frictionOutput(otherQuestion), policy: currentPolicy, exactFigureSource: "verified_recovery" } },
  { name: "picture demand, strict", code: "picture_demand_unmet", preferred: false, drawn: null, saved: true,
    input: { question: conicQuestion, turnPlan: planFor(conicQuestion, []), output: segmentOutput(conicQuestion, "major axis"), policy: strictPolicy } },
  { name: "picture demand, current", code: "picture_demand_unmet", preferred: false, drawn: "family", saved: true,
    input: { question: conicQuestion, turnPlan: planFor(conicQuestion, []), output: segmentOutput(conicQuestion, "major axis"), policy: currentPolicy } },
  { name: "optics rule, strict", code: "planner_optics_on_archetype_stem", preferred: false, drawn: null, saved: true,
    input: { question: opticsQuestion, turnPlan: planFor(opticsQuestion, [{ id: "u", value: 30, unit: "cm" }, { id: "f", value: 10, unit: "cm" }]),
      output: segmentOutput(opticsQuestion, "principal axis"), policy: strictPolicy } },
  { name: "optics rule, current", code: "planner_optics_on_archetype_stem", preferred: false, drawn: null, saved: true,
    input: { question: opticsQuestion, turnPlan: planFor(opticsQuestion, [{ id: "u", value: 30, unit: "cm" }, { id: "f", value: 10, unit: "cm" }]),
      output: segmentOutput(opticsQuestion, "principal axis"), policy: currentPolicy } },
  { name: "source figure preferred and drawn", code: "source_figure_preferred", preferred: true, drawn: "archetype", saved: false,
    input: { question: cliffQuestion, turnPlan: cliffFresh, output: segmentOutput(cliffQuestion, "cliff"), policy: currentPolicy } },
  // The source figure carries a range the stale plan contradicts, so its save fails and nothing is drawn.
  { name: "source figure preferred but not drawable", code: "source_figure_preferred", preferred: true, drawn: null, saved: true,
    input: { question: cliffQuestion, turnPlan: cliffStaleRange, output: segmentOutput(cliffQuestion, "cliff"), policy: currentPolicy } },
  // Both live strategies allow the planner; a policy that refuses the candidate's own source must still say so.
  { name: "strict policy suppressed", code: "source_policy_suppressed", preferred: false, drawn: null, saved: true,
    input: { question: batteryQuestion, turnPlan: batteryPlan, output: segmentOutput(batteryQuestion, "wire"),
      policy: { preferPlanner: true, allowedFigureSources: ["verified_recovery", "text_only"] } } },
  // Validated against the planning plan; the corrected final plan disagrees with its value, so the save refuses it.
  { name: "save admission refused, strict", code: "save_admission_refused", preferred: false, drawn: null, saved: true,
    input: { question: blockQuestion, turnPlan: blockPlan, validatedAgainst: stalePlan,
      output: segmentOutput(blockQuestion, "floor", [{ id: "a", value: 5, unit: "m/s²" }]), policy: strictPolicy } },
  { name: "save admission refused, current", code: "save_admission_refused", preferred: false, drawn: null, saved: true,
    input: { question: blockQuestion, turnPlan: blockPlan, validatedAgainst: stalePlan,
      output: segmentOutput(blockQuestion, "floor", [{ id: "a", value: 5, unit: "m/s²" }]), policy: currentPolicy } },
  { name: "fast figure preferred and drawn", code: "fast_figure_preferred", preferred: true, drawn: batteryFast.figureSource, saved: false,
    input: { question: batteryQuestion, turnPlan: batteryPlan, output: segmentOutput(batteryQuestion, "wire"), policy: currentPolicy, fastRepresentation: batteryFast } },
  // Strict suppresses the fast family figure, so the turn draws nothing and keeps the reason.
  { name: "fast figure preferred but suppressed", code: "fast_figure_preferred", preferred: true, drawn: null, saved: true,
    input: { question: batteryQuestion, turnPlan: batteryPlan, output: segmentOutput(batteryQuestion, "wire"), policy: strictPolicy, fastRepresentation: batteryFast } },
  { name: "no figure asked", code: "no_figure_asked", preferred: true, drawn: null, saved: true,
    input: { question: noFigureQuestion, turnPlan: { ...planFor(noFigureQuestion, []), visualRequirement: "none" },
      output: segmentOutput(noFigureQuestion, "newton"), policy: currentPolicy } },
  { name: "exact scene not admitted (chemistry lane)", code: "exact_scene_not_admitted", preferred: false, drawn: null, saved: true,
    input: { question: chemistryQuestion, turnPlan: planFor(chemistryQuestion, []), output: segmentOutput(chemistryQuestion, "H2O"), policy: currentPolicy } },
];

const covered = new Set<string>();
for (const fixture of fixtures) {
  const selection = select(fixture.input);
  const dropped = selection.droppedCandidate;
  assert(dropped, `${fixture.name}: a valid candidate that is not drawn must name its drop (${selection.reason})`);
  assert.equal(dropped.code, fixture.code, `${fixture.name}: drop code`);
  assert.equal(dropped.preferred, fixture.preferred, `${fixture.name}: preferred`);
  assert.equal(selection.representation?.figureSource ?? null, fixture.drawn, `${fixture.name}: figure drawn instead (${selection.reason})`);
  assert.equal(dropped.replacedBy, fixture.drawn, `${fixture.name}: replacedBy names the figure drawn instead`);
  assert.notEqual(selection.representation?.figureSource, fixture.input.exactFigureSource ?? "planner",
    `${fixture.name}: the declined candidate must not be the figure drawn`);
  const expected = fixture.saved
    ? { attemptedTier: "exact_verified", reason: VALID_CANDIDATE_DROPPED, issueCodes: [VALID_CANDIDATE_DROPPED, fixture.code], candidateCount: 3 }
    : null;
  assert.deepEqual(validCandidateDropDegradation(selection, 3), expected, `${fixture.name}: degradation`);
  const settled = settleSelectionDegradation({ earlier: undefined, selection, candidateCount: 3 });
  assert.deepEqual(settled.degradation, expected, `${fixture.name}: settled degradation`);
  assert.equal(settled.reportedDrop, fixture.saved ? dropped : null, `${fixture.name}: the reported drop is the saved one`);
  covered.add(fixture.code);
}
for (const code of ["source_question_mismatch", "picture_demand_unmet", "planner_optics_on_archetype_stem", "source_figure_preferred",
  "source_policy_suppressed", "save_admission_refused", "fast_figure_preferred"]) {
  assert(covered.has(code), `the decline path ${code} needs a fixture`);
}

// The recovered guard holds on the explained selector directly as well.
const recovered = validateProductionSceneCandidate({ candidate: frictionOutput(otherQuestion), question: asked, turnPlan: frictionPlan });
assert(recovered.valid && recovered.value);
const direct = selectVerifiedRepresentationExplained({ question: asked, turnPlan: frictionPlan, preferPlanner: true,
  exact: { sceneDocument: recovered.value.document, renderScene: recovered.value.renderScene, validationReport: recovered.value.report },
  exactFigureSource: "verified_recovery" });
assert.notEqual(direct.selected.figureSource, "verified_recovery");
assert.equal(direct.exactDecline?.code, "source_question_mismatch");

// 4. The shared step keeps an earlier degradation and reports no drop over it.
const productionRow = select(fixtures[0]!.input);
const earlier = { attemptedTier: "exact_verified" as const, reason: "candidate_invalid" as const, issueCodes: ["x"], candidateCount: 2 };
assert.deepEqual(settleSelectionDegradation({ earlier, selection: productionRow, candidateCount: 2 }),
  { degradation: earlier, reportedDrop: null }, "an earlier degradation stands and the drop is not reported over it");

// 5. Both consumers run their own lines through the shared step. The lines
// between the markers are executed here, so disabling the save in either
// consumer turns this gate red.
function markedLines(file: string, after: string, before: string | null): string {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const begin = "// settle-selection-degradation:begin";
  const end = "// settle-selection-degradation:end";
  const beginAt = source.indexOf(begin);
  const endAt = source.indexOf(end);
  assert(beginAt > 0 && source.indexOf(begin, beginAt + 1) === -1, `${file}: exactly one begin marker`);
  assert(endAt > beginAt && source.indexOf(end, endAt + 1) === -1, `${file}: exactly one end marker after the begin marker`);
  const afterAt = source.indexOf(after);
  assert(afterAt > 0 && afterAt < beginAt, `${file}: the step runs after final selection`);
  if (before !== null) {
    const beforeAt = source.indexOf(before, endAt);
    assert(beforeAt > endAt, `${file}: the settled degradation is the one saved`);
  }
  const lines = source.slice(beginAt + begin.length, endAt);
  assert(lines.includes("settleSelectionDegradation("), `${file}: the marked lines call the shared step`);
  return ts.transpileModule(lines, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const hookFile = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
const hookLines = markedLines(hookFile, "const sceneSelection = measureSceneSelection(tel, \"final\"", "degradation: exactDegradation,");
{
  // Nothing between the step and the saved artifacts may overwrite its result.
  const source = readFileSync(resolve(process.cwd(), hookFile), "utf8");
  const tail = source.slice(source.indexOf("// settle-selection-degradation:end"), source.indexOf("degradation: exactDegradation,"));
  assert(!/\bexactDegradation\s*=[^=]/.test(tail), "the live hook must not overwrite the settled degradation before saving it");
}
type Degradation = NonNullable<ReturnType<typeof validCandidateDropDegradation>> | typeof earlier;
const runHook = new Function("settleSelectionDegradation", "sceneSelection", "result", "tel", "console", "diagramStrategyDecision",
  "exactDegradation", `${hookLines}\nreturn exactDegradation;`) as (
  settle: typeof settleSelectionDegradation, selection: ProductionSceneSelection, result: { candidates: unknown[] },
  tel: { mark: (name: string, detail: Record<string, unknown>) => void }, console: { warn: (...args: unknown[]) => void },
  strategy: { strategy: string }, exactDegradation: Degradation | undefined,
) => Degradation | undefined;

function hookRun(selection: ProductionSceneSelection, prior: Degradation | undefined) {
  const marks: Array<[string, Record<string, unknown>]> = [];
  const warnings: unknown[][] = [];
  const saved = runHook(settleSelectionDegradation, selection, { candidates: [{}, {}] },
    { mark: (name, detail) => { marks.push([name, detail]); } }, { warn: (...args) => { warnings.push(args); } },
    { strategy: "strict" }, prior);
  return { saved, marks, warnings };
}
{
  const dropped = hookRun(productionRow, undefined);
  assert.deepEqual(dropped.saved, {
    attemptedTier: "exact_verified", reason: VALID_CANDIDATE_DROPPED,
    issueCodes: [VALID_CANDIDATE_DROPPED, "source_question_mismatch"], candidateCount: 2,
  }, "the live hook must save the dropped candidate's degradation");
  assert.equal(dropped.marks.length, 1, "the live hook must trace the drop");
  assert.equal(dropped.marks[0]![0], "verified-scene-candidate-dropped");
  assert.equal(dropped.marks[0]![1].code, "source_question_mismatch");
  assert.equal(dropped.warnings.length, 1, "the live hook must report the drop to Sentry");
  assert.equal(dropped.warnings[0]![0], "[diagram] a valid figure candidate was dropped at selection");
  const kept = hookRun(productionRow, earlier);
  assert.equal(kept.saved, earlier, "the live hook keeps an earlier degradation");
  assert.equal(kept.marks.length + kept.warnings.length, 0);
  const replaced = hookRun(select(fixtures.find((fixture) => fixture.name === "source figure preferred and drawn")!.input), undefined);
  assert.equal(replaced.saved, undefined, "a preferred figure drawn instead saves nothing");
  assert.equal(replaced.marks.length + replaced.warnings.length, 0);
}

const labFile = "scripts/lecture-lab/lecturePipeline.ts";
const labLines = markedLines(labFile, "const sceneSelection = selectProductionScene({", null);
{
  const source = readFileSync(resolve(process.cwd(), labFile), "utf8");
  const tail = source.slice(source.indexOf("// settle-selection-degradation:end"));
  assert(!/run\.diagram\.degradationReason\s*=[^=]/.test(tail), "the lab must not overwrite the settled degradation");
}
type LabRun = { diagram: { degradationReason: string | null; droppedCandidate?: DroppedSceneCandidate | null } };
const runLab = new Function("settleSelectionDegradation", "sceneSelection", "result", "run", `${labLines}\nreturn run;`) as (
  settle: typeof settleSelectionDegradation, selection: ProductionSceneSelection, result: { candidates: unknown[] }, run: LabRun,
) => LabRun;
{
  const dropped = runLab(settleSelectionDegradation, productionRow, { candidates: [{}] }, { diagram: { degradationReason: null } });
  assert.equal(dropped.diagram.degradationReason, VALID_CANDIDATE_DROPPED, "the lab must record the same drop as the live hook");
  assert.equal(dropped.diagram.droppedCandidate?.code, "source_question_mismatch", "the lab keeps the drop's code");
  const kept = runLab(settleSelectionDegradation, productionRow, { candidates: [{}] }, { diagram: { degradationReason: "planner_unavailable" } });
  assert.equal(kept.diagram.degradationReason, "planner_unavailable", "the lab keeps an earlier degradation");
}

// 6. The reason is saved and read by the admin fails page.
async function verifyPersistence(): Promise<void> {
  const degradation = validCandidateDropDegradation(productionRow, 2)!;
  const saved = await canonicalizeTurnSceneMetadata({
    question: asked, visualStatus: "retry_required",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan: frictionPlan, candidates: [], diagramResultStatus: "retry_required",
      degradation,
    },
    segments: [],
  });
  assert(saved.ok, "a dropped-candidate degradation must persist");
  assert.equal(saved.value.sceneArtifacts?.degradation?.reason, VALID_CANDIDATE_DROPPED);
  assert.deepEqual(saved.value.sceneArtifacts?.degradation?.issueCodes, [VALID_CANDIDATE_DROPPED, "source_question_mismatch"]);
  const summary = extractArtifactSummary(saved.value.sceneArtifacts);
  assert.equal(summary?.degradationReason, VALID_CANDIDATE_DROPPED, "the admin fails page must read the new reason");
  assert(summary?.issueCodes.includes("source_question_mismatch"));
}

void verifyPersistence().then(() => {
  console.log(`valid candidate parity: ${controls.length} controls drawn, ${fixtures.length} decline fixtures over ${covered.size} codes, ` +
    "hook and lab lines executed, persistence and admin read pass");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
