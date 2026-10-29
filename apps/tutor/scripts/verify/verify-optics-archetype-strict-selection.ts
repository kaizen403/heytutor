/**
 * The optics-figures branch owns this gate. No model or network calls.
 *
 * Strict drops a planner figure for a stem the lens or mirror archetype owns
 * (planner_optics_on_archetype_stem). It may then draw that archetype as
 * `optics_archetype`, only when it is exact, its u, f and kind are read from
 * the question, the question names one element, and the save check agrees.
 * OPTICS_ARCHETYPE_IN_STRICT=off turns it off. A planner cannot pass the
 * archetype rule by writing `source.archetype`.
 */
import assert from "node:assert/strict";
import {
  FIGURE_SOURCES, TURN_PLAN_V3_VERSION, attemptArchetypeScene, type SceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import {
  decideDiagramStrategy, diagramStrategyAllowsFigureSource, strictAdmitsOwningOpticsArchetype,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { resolveOpticsArchetypeInStrict } from "../../lib/scene/diagramStrategy.server";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { OPTICS_ARCHETYPE_FIXTURES } from "../../../../packages/scene-engine/scripts/verify/fixtures/optics-archetype-strict";

function turnPlan(question: string, rows: Array<[string, number, string | null]>): TurnPlanV3 {
  return {
    schemaVersion: TURN_PLAN_V3_VERSION, question,
    givens: rows.filter(([id]) => id !== "v").map(([id, value, unit]) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "given", sourceText: "stated" })),
    unknowns: [], derived: rows.filter(([id]) => id === "v").map(([id, value, unit]) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "derived" })),
    qualitativeClaims: [], lawIds: ["thin_lens_formula"], assumptions: [], visualRequirement: "required",
  } as unknown as TurnPlanV3;
}

/** A planner figure for the stem: the engine's geometry without its provenance, quantities or span values. */
function asPlannerDocument(engine: SceneDocument): Record<string, unknown> {
  const document = structuredClone(engine) as unknown as Record<string, unknown> & SceneDocument;
  const source = { ...(document.source as Record<string, unknown>) };
  delete source.archetype; delete source.slotSources; delete source.exactGrounding;
  document.source = source as SceneDocument["source"];
  document.quantities = [];
  document.entities = document.entities.map((entity) =>
    entity.kind === "vector" ? { ...entity, label: entity.id } : entity.kind === "dimension" ? { ...entity, label: entity.id.replace("dim_", "") } : entity);
  return document;
}
function plannerDocument(question: string): Record<string, unknown> {
  return asPlannerDocument(attemptArchetypeScene({ question })!.scene!.document);
}

const strict = decideDiagramStrategy({ assignedStrategy: "strict", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics" });
const strictOff = decideDiagramStrategy({ assignedStrategy: "strict", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics", opticsArchetypeInStrict: false });
const current = decideDiagramStrategy({ assignedStrategy: "current", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics" });
assert.equal(strictAdmitsOwningOpticsArchetype(strict), true, "strict admits by default");
assert.equal(strictAdmitsOwningOpticsArchetype(strictOff), false, "the kill switch turns it off");
assert.equal(strictAdmitsOwningOpticsArchetype(current), false, "the current lane already draws archetypes");
assert.equal(resolveOpticsArchetypeInStrict(undefined), true);
assert.equal(resolveOpticsArchetypeInStrict(" OFF "), false);
assert.equal(resolveOpticsArchetypeInStrict("on"), true);
assert.ok((FIGURE_SOURCES as readonly string[]).includes("optics_archetype"));
assert.equal(diagramStrategyAllowsFigureSource(strict, "archetype"), false, "strict still suppresses every other archetype");

function select(question: string, plan: TurnPlanV3, decision = strict, candidate = plannerDocument(question)) {
  return selectProductionScene({
    question, turnPlan: plan, problemIR: null, blockFlowEligible: false, candidate,
    exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: false,
    policy: {
      preferPlanner: decision.strategy === "strict",
      allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)),
      admitOwningOpticsArchetype: strictAdmitsOwningOpticsArchetype(decision),
    },
  });
}

const fixture = (id: string) => OPTICS_ARCHETYPE_FIXTURES.find((row) => row.id === id)!;
const quantities = (document: SceneDocument) => Object.fromEntries(document.quantities.map((row) => [row.id, `${row.value} ${row.unit}`]));

// q36: −2.0 D is a diverging lens; the image is 30 cm on the object side.
const q36 = fixture("q36").question;
const q36Plan = turnPlan(q36, [["P", -2, "D"], ["u", -75, "cm"], ["v", -30, "cm"]]);
const drawn = select(q36, q36Plan);
assert.equal(drawn.droppedCandidate?.code, "planner_optics_on_archetype_stem", "the planner figure is still dropped");
assert.equal(drawn.representation?.figureSource, "optics_archetype", `q36 draws the owning archetype (${drawn.reason})`);
assert.equal(drawn.representation?.tier, "exact_verified");
assert.equal(drawn.strictOpticsAdmission?.admitted, true);
assert.match(drawn.reason, /strict_optics_archetype_owner/);
assert.deepEqual(quantities(drawn.representation!.sceneDocument), { u: "-75 cm", f: "-50 cm", v: "-30 cm" });
assert.equal(drawn.droppedCandidate?.replacedBy, "optics_archetype");

// The kill switch, and the current lane, are unchanged.
assert.equal(select(q36, q36Plan, strictOff).representation, null, "OPTICS_ARCHETYPE_IN_STRICT=off draws nothing");
assert.notEqual(select(q36, q36Plan, current).representation?.figureSource, "optics_archetype");

// The save check still refuses a plan that disagrees: a converging-lens v of +150 cm.
const wrongPlan = turnPlan(q36, [["P", -2, "D"], ["u", -75, "cm"], ["v", 150, "cm"]]);
const refused = select(q36, wrongPlan);
assert.equal(refused.representation, null, "a plan image distance that disagrees refuses");
assert.match(refused.saveFailure ?? "", /optics_plan_disagreement/);

// q107 and a metre stem: unit and kind from the question.
const q107 = fixture("q107").question;
const q107Drawn = select(q107, turnPlan(q107, [["P", -6.25, "D"], ["u", 112, "cm"], ["v", -14, "cm"]]));
assert.equal(q107Drawn.representation?.figureSource, "optics_archetype", q107Drawn.reason);
assert.deepEqual(quantities(q107Drawn.representation!.sceneDocument), { u: "-112 cm", f: "-16 cm", v: "-14 cm" });
const q11 = fixture("q11").question;
const q11Drawn = select(q11, turnPlan(q11, [["u", 60, "cm"], ["R", 80, "cm"], ["v", -24, "cm"]]));
assert.equal(q11Drawn.representation?.figureSource, "optics_archetype", q11Drawn.reason);
assert.deepEqual(quantities(q11Drawn.representation!.sceneDocument), { u: "-0.6 m", f: "0.4 m", v: "0.24 m" });

// Two elements, and values the question does not state, never draw in strict.
for (const id of ["q23", "q24", "q116", "q84"]) {
  const question = fixture(id).question;
  const scene = attemptArchetypeScene({ question, turnPlan: turnPlan(question, [["u", 26, "cm"], ["f", 13, "cm"]]) });
  assert.equal(scene.scene, null, `${id}: no one-lens figure for two lenses`);
}
const q49 = fixture("q49").question;
const bench = select(q49, turnPlan(q49, [["u", 36, "cm"], ["f", 20, "cm"], ["v", 45, "cm"]]), strict, asPlannerDocument(attemptArchetypeScene({ question: q49, turnPlan: turnPlan(q49, [["u", 36, "cm"], ["f", 20, "cm"]]) }).scene!.document));
assert.equal(bench.droppedCandidate?.code, "planner_optics_on_archetype_stem");
assert.notEqual(bench.representation?.figureSource, "optics_archetype", "q49: optical bench marks are not stated distances");

// The save check by itself: honest plans in other units and conventions agree.
const engine = drawn.representation!.sceneDocument;
for (const rows of [
  [["u", 0.75, "m"], ["f", -0.5, "m"], ["v", -0.3, "m"]],
  [["d_o", 75, "cm"], ["d_i", -30, "cm"], ["f", -50, "cm"]],
  [["u", 75, "cm"], ["f", 50, "cm"], ["v", 30, "cm"]],
] as Array<Array<[string, number, string | null]>>) {
  assert.equal(sceneSaveAdmissionFailure({ document: engine, question: q36, turnPlan: turnPlan(q36, rows), tier: "exact_verified" }), null, JSON.stringify(rows));
}
assert.notEqual(sceneSaveAdmissionFailure({ document: engine, question: q36, turnPlan: turnPlan(q36, [["u", 75, "mm"], ["f", -50, "cm"]]), tier: "exact_verified" }), null, "a plan u in the wrong unit refuses");
// The plan-led figure for that plan (u = 7.5 cm) disagrees with the question's 75 cm and refuses too.
const misread = attemptArchetypeScene({ question: q36, turnPlan: turnPlan(q36, [["u", 75, "mm"], ["f", -50, "cm"]]) }).scene!.document;
assert.match(sceneSaveAdmissionFailure({ document: misread, question: q36, turnPlan: turnPlan(q36, [["u", 75, "mm"], ["f", -50, "cm"]]), tier: "exact_verified" }) ?? "", /optics_plan_disagreement: .*not the question's/);
// A submitted document that only names the archetype is audited as before.
const forged = structuredClone(engine);
forged.quantities = forged.quantities.map((row) => row.id === "v" ? { ...row, value: 150 } : row);
assert.notEqual(sceneSaveAdmissionFailure({ document: forged, question: q36, turnPlan: q36Plan, tier: "exact_verified" }), null, "a forged archetype figure is refused");

// A planner cannot self-label to pass the archetype rule.
const labelled = normalizeSceneDocumentModelOutput({ ...plannerDocument(q36), source: { question: q36, archetype: "thin_lens", slotSources: { u: "stem" }, exactGrounding: "stem" } } as never, q36) as { source: Record<string, unknown> };
assert.equal("archetype" in labelled.source, false);
assert.equal("slotSources" in labelled.source, false);
assert.equal("exactGrounding" in labelled.source, false);
const selfLabelled = select(q36, q36Plan, strict, labelled as unknown as Record<string, unknown>);
assert.equal(selfLabelled.droppedCandidate?.code, "planner_optics_on_archetype_stem", "a self-labelled planner figure is still dropped");

console.log("verify-optics-archetype-strict-selection: strict draws the owning optics archetype only under the narrow rule; kill switch, save check and self-label hole hold");
