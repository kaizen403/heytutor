/**
 * The optics-figures branch owns this gate. No model or network calls.
 *
 * Strict drops a planner figure for a stem the lens or mirror archetype owns
 * (planner_optics_on_archetype_stem). It may then draw that archetype as
 * `optics_archetype`, only when it is exact, its u, f and kind are read from
 * the question, the question names one element, and the save check agrees.
 * Off by default: only OPTICS_ARCHETYPE_IN_STRICT=on turns it on, and with it
 * off strict selects exactly as main did. A planner cannot pass the
 * archetype rule by writing `source.archetype`.
 */
import assert from "node:assert/strict";
import {
  FIGURE_SOURCES, TURN_PLAN_V3_VERSION, attemptArchetypeScene, type SceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import {
  decideDiagramStrategy, diagramStrategyAllowsFigureSource, strictAdmitsOwningOpticsArchetype,
} from "../../features/tutor-session/lib/scene/diagramStrategy";
import { resolveOpticsArchetypeInStrict } from "../../lib/scene/diagramStrategy.server";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { OPTICS_ARCHETYPE_FIXTURES, REVIEW2_FIXTURES } from "../../../../packages/scene-engine/scripts/verify/fixtures/optics-archetype-strict";

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

const strictContext = { assignedStrategy: "strict", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics" } as const;
const strictDefault = decideDiagramStrategy(strictContext);
const strict = decideDiagramStrategy({ ...strictContext, opticsArchetypeInStrict: true });
const strictOff = decideDiagramStrategy({ ...strictContext, opticsArchetypeInStrict: false });
const current = decideDiagramStrategy({ assignedStrategy: "current", chemistryLane: false, codeLesson: false, dsa: false, doubt: false, subject: "physics", opticsArchetypeInStrict: true });
assert.equal(strictAdmitsOwningOpticsArchetype(strictDefault), false, "strict does not admit by default (an older server sends nothing)");
assert.equal(strictAdmitsOwningOpticsArchetype(strict), true, "an explicit on admits");
assert.equal(strictAdmitsOwningOpticsArchetype(strictOff), false, "an explicit off does not");
assert.equal(strictAdmitsOwningOpticsArchetype(current), false, "the current lane already draws archetypes");
// The server switch: off unless the env says exactly on.
assert.equal(resolveOpticsArchetypeInStrict(undefined), false, "unset is off");
assert.equal(resolveOpticsArchetypeInStrict(""), false, "empty is off");
assert.equal(resolveOpticsArchetypeInStrict(" OFF "), false, "off is off");
assert.equal(resolveOpticsArchetypeInStrict("1"), false, "anything but on is off");
assert.equal(resolveOpticsArchetypeInStrict("on"), true, "on is on");
assert.equal(resolveOpticsArchetypeInStrict(" ON "), true, "on is read case blind");
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

// Default off and explicit off select as main did; the current lane is unchanged.
assert.equal(select(q36, q36Plan, strictDefault).representation, null, "with the switch unset strict draws nothing");
assert.equal(select(q36, q36Plan, strictOff).representation, null, "OPTICS_ARCHETYPE_IN_STRICT=off draws nothing");
assert.notEqual(select(q36, q36Plan, current).representation?.figureSource, "optics_archetype");

// The save check still refuses a plan that disagrees: a converging-lens v of +150 cm.
const wrongPlan = turnPlan(q36, [["P", -2, "D"], ["u", -75, "cm"], ["v", 150, "cm"]]);
const refused = select(q36, wrongPlan);
assert.equal(refused.representation, null, "a plan image distance that disagrees refuses");
// Strict's role binding refuses it first; the save check refuses the same figure on its own.
assert.match(refused.strictOpticsAdmission?.reason ?? "", /is not the figure's v/);
assert.match(sceneSaveAdmissionFailure({ document: drawn.representation!.sceneDocument, question: q36, turnPlan: wrongPlan, tier: "exact_verified" }) ?? "", /optics_plan_disagreement/);

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
// The bench moves the image pin, so the engine declines the stem outright now.
assert.equal(attemptArchetypeScene({ question: q49, turnPlan: turnPlan(q49, [["u", 36, "cm"], ["f", 20, "cm"]]) }).scene, null, "q49: no one-position figure for a bench search");
const benchCandidate = asPlannerDocument(attemptArchetypeScene({ question: q36 }).scene!.document);
const bench = select(q49, turnPlan(q49, [["u", 36, "cm"], ["f", 20, "cm"], ["v", 45, "cm"]]), strict, benchCandidate);
assert.notEqual(bench.representation?.figureSource, "optics_archetype", "q49: optical bench marks are not stated distances");

// One plain configuration only, read from the question: strict never draws these.
for (const question of [
  "A converging lens of focal length 20 cm is immersed in water. An object is placed 30 cm from the lens. Find the image.",
  "An object is 30 cm from a convex lens of focal length 20 cm. A glass slab 3 cm thick is placed between the lens and the image. Find the final image.",
  "An object is placed 30 cm from a convex lens of focal length 20 cm. The object is then moved to 15 cm from the lens. Find both images.",
  "A screen is placed 90 cm from an object. A converging lens of focal length 20 cm forms a sharp image on the screen. Find the position of the lens.",
  "A convex lens of focal length 10 forms an image of an object 30 cm from the lens. Find the image distance.",
  "A concave mirror of focal length 20 cm forms an image at a distance of 60 cm from the mirror. Find the object distance.",
]) {
  const scene = attemptArchetypeScene({ question, turnPlan: turnPlan(question, [["u", 30, "cm"], ["f", 20, "cm"]]) }).scene;
  if (!scene) continue;
  const chosen = select(question, turnPlan(question, [["u", 30, "cm"], ["f", 20, "cm"]]), strict, asPlannerDocument(scene.document));
  assert.notEqual(chosen.representation?.figureSource, "optics_archetype", `strict does not draw: ${question}`);
}
// A mirror called converging is concave: strict draws it concave (v = -15 cm for u = 30 cm, f = 10 cm).
const converging = "An object is placed 30 cm in front of a converging mirror of focal length 10 cm. Find the image.";
const convergingDrawn = select(converging, turnPlan(converging, [["u", 30, "cm"], ["f", 10, "cm"]]));
assert.equal(convergingDrawn.representation?.figureSource, "optics_archetype", convergingDrawn.reason);
assert.deepEqual(quantities(convergingDrawn.representation!.sceneDocument), { u: "-30 cm", f: "-10 cm", v: "-15 cm" });
// A plan length the check cannot assign (d_obj is aliased; x1 and D are not) refuses the figure.
assert.equal(sceneSaveAdmissionFailure({ document: convergingDrawn.representation!.sceneDocument, question: converging, turnPlan: turnPlan(converging, [["d_obj", 30, "cm"], ["f", 10, "cm"]]), tier: "exact_verified" }), null, "d_obj is the object distance");
for (const id of ["x1", "D", "u_1", "d_img"]) {
  const failure = sceneSaveAdmissionFailure({ document: convergingDrawn.representation!.sceneDocument, question: converging, turnPlan: turnPlan(converging, [["u", 30, "cm"], ["f", 10, "cm"], [id, 45, "cm"]]), tier: "exact_verified" });
  assert.match(failure ?? "", /optics_plan_disagreement/, `a plan row ${id} = 45 cm is never left unchecked`);
}

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

// Review 2: every input that drew a wrong figure with strict on, through the production selection,
// strict on and the current lane (its fast figure first, as live). Strict never draws the lens or
// mirror archetype for them; any lens or mirror figure either lane draws is exactly the hand truth.
const lensOrMirror = (document: SceneDocument | undefined) => ["thin_lens", "spherical_mirror"].includes(String(document?.source.archetype));
let review2Plans = 0;
for (const fixture of REVIEW2_FIXTURES) {
  for (const rows of fixture.plans) {
    review2Plans++;
    const plan = turnPlan(fixture.question, rows);
    const engine = attemptArchetypeScene({ question: fixture.question, turnPlan: plan }).scene?.document ?? attemptArchetypeScene({ question: fixture.question }).scene?.document;
    const candidate = engine ? asPlannerDocument(engine) : plannerDocument(q36);
    const strictChoice = select(fixture.question, plan, strict, candidate);
    assert.notEqual(strictChoice.representation?.figureSource, "optics_archetype", `${fixture.id} ${JSON.stringify(rows)}: strict does not draw the archetype (${strictChoice.strictOpticsAdmission?.reason ?? strictChoice.reason})`);
    const gate = deriveSceneGate({ question: fixture.question, turnPlan: plan, problemIR: null, blockFlowEligible: false });
    const fast = gate.shouldPlanExactScene ? selectFastVerifiedRepresentation({ question: fixture.question, turnPlan: plan, problemIR: null, families: gate.sceneCapabilities.families }) : null;
    const currentChoice = selectProductionScene({
      question: fixture.question, turnPlan: plan, problemIR: null, sceneCapabilities: gate.sceneCapabilities, blockFlowEligible: false,
      ...(fast ? { fastRepresentation: fast } : { candidate }), exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: false,
      policy: { preferPlanner: false, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(current, source)), admitOwningOpticsArchetype: false },
    });
    for (const [lane, choice] of [["strict", strictChoice], ["current", currentChoice]] as const) {
      const document = choice.representation?.sceneDocument;
      if (!document || !lensOrMirror(document)) continue;
      const truth = fixture.truth;
      assert.ok(truth, `${fixture.id} ${lane}: no lens or mirror figure for ${JSON.stringify(rows)} (${choice.reason})`);
      const lens = truth.archetype === "thin_lens";
      const f = lens ? (truth.kind === "convex" ? truth.f : -truth.f) : (truth.kind === "concave" ? -truth.f : truth.f);
      const v = lens ? (truth.real ? truth.v : -truth.v) : (truth.real ? -truth.v : truth.v);
      assert.deepEqual(quantities(document), { u: `${-truth.u} cm`, f: `${f} cm`, v: `${v} cm` }, `${fixture.id} ${lane}: the figure drawn is the truth`);
    }
  }
}
// Strict binds by role: the converging mirror plan with a role-free length (x1 = 15 cm = |v|) or without its focal row declines.
for (const rows of [[["u", 30, "cm"], ["f", 10, "cm"], ["x1", 15, "cm"]], [["u", 30, "cm"], ["v", 15, "cm"]]] as Array<Array<[string, number, string | null]>>) {
  assert.notEqual(select(converging, turnPlan(converging, rows)).representation?.figureSource, "optics_archetype", `strict declines for ${JSON.stringify(rows)}`);
}

// Save and reopen: a lesson whose figure source is optics_archetype keeps that source and restores.
async function saveAndReopen(): Promise<void> {
  const representation = convergingDrawn.representation!;
  const presentation = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene);
  const submitted: SubmittedTurnSceneMetadata = {
    question: converging,
    sceneDocument: representation.sceneDocument,
    validationReport: representation.validationReport,
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan: turnPlan(converging, [["u", 30, "cm"], ["f", 10, "cm"]]), representationTier: representation.tier, nonMetric: representation.nonMetric,
      figureSource: "optics_archetype", candidates: [], diagramResultStatus: "ready",
    } as never,
    segments: presentation.introSegments.map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
    })),
  };
  const saved = await canonicalizeTurnSceneMetadata(submitted);
  assert.ok(saved.ok, `an optics_archetype turn saves: ${saved.ok ? "" : saved.error}`);
  assert.equal((saved.value.sceneArtifacts as { figureSource?: string } | null)?.figureSource, "optics_archetype", "the figure source survives the save");
  assert.ok(restoreVerifiedPresentationFromTurn({ question: converging, sceneDocument: saved.value.sceneDocument, sceneArtifacts: saved.value.sceneArtifacts }), "the saved figure reopens");
}

void saveAndReopen().then(() => console.log(`verify-optics-archetype-strict-selection: strict draws the owning optics archetype only under the narrow rule and only when switched on; role binding, ${review2Plans} review 2 input plans in strict and current, save check, configuration declines, self-label hole and save and reopen hold`), (error) => {
  console.error(error);
  process.exitCode = 1;
});
