import assert from "node:assert/strict";
import {
  certifyVseprSourceDocument, compileSceneDocument, deferVerifiedAnswerLabels,
  displayedSceneQuantityTexts, prepareVerifiedParts, synthesizeFamilyScene,
  validateTurnPlanV3, type SceneDocument, type TurnPlanQuantityV3, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVseprScene, isVseprStem, VSEPR_PROBES } from "../../../../packages/scene-engine/src/chemistry/vsepr";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function makePlan(question: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], derived: [], unknowns: [],
    qualitativeClaims: [], lawIds: ["VSEPR theory"], assumptions: [] };
}
function quantity(symbol: string, value: number, sourceText: string, unit?: string): TurnPlanQuantityV3 {
  return { id: `q_${symbol}`, symbol, value, sourceText, ...(unit ? { unit } : {}), provenance: "derived" };
}
function fixture(question = "Use VSEPR to compare the molecular shapes and bond angles of ClF3 and BrF5.") {
  const plan = makePlan(question);
  const fresh = synthesizeFamilyScene({ question, turnPlan: plan });
  check(fresh?.family === "chem_vsepr", "synthetic source must select native VSEPR");
  return { question, plan, document: fresh.document };
}
function admitted(document: SceneDocument, question: string, plan: TurnPlanV3): boolean {
  return sceneSaveAdmissionFailure({ document, question, turnPlan: plan, tier: "qualitative_verified" }) === null;
}
function setLabel(document: SceneDocument, id: string, label: string): void {
  document.entities.find((entity) => entity.id === id)!.label = label;
  for (const construction of document.constructions) {
    if (construction.operator === "label" && construction.outputs.includes(id)) construction.inputs.text = label;
  }
}
async function saved(question: string, plan: TurnPlanV3 | null, document: SceneDocument, options: { omitPlan?: boolean; rawPlan?: unknown } = {}) {
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene, "persistence fixture compiles");
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene, { ...(plan ? { turnPlan: plan } : {}) });
  const result = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", ...(!options.omitPlan ? { turnPlan: Object.hasOwn(options, "rawPlan") ? options.rawPlan : plan } : {}), representationTier: "qualitative_verified",
      nonMetric: true, candidates: [], diagramResultStatus: "ready", figureSource: "family" },
    segments: presentation.introSegments.map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
    })),
  });
  return result;
}

async function main(): Promise<void> {
  const sample = fixture();
  const selected = selectProductionScene({ question: sample.question, turnPlan: sample.plan, problemIR: null, requiredRetryEnabled: true });
  check(selected.visualStatus === "validated", "formula-derived two-species VSEPR must draw without planner-supplied angles (RED on prior main)");
  check(selected.saveFailure === null && selected.hasReadableInk, "actual live/save admission accepts readable source figure");
  check(selected.representation?.sceneDocument.revealGroups.length === 2, "both source species survive admission");
  check(sample.document.source.slotSources === undefined, "certificate does not fabricate stem/plan slotSources");
  const labels = displayedSceneQuantityTexts(sample.document);
  check(labels.includes("87.5°") && labels.includes("<90°"), "known measured value and strict inequality remain distinct");
  check(labels.includes("quoted") && labels.includes("inequality"), "existing angle evidence labels are retained");
  check(certifyVseprSourceDocument(sample.document, sample.question, sample.plan).status === "certified", "native source graph earns a certificate");

  const carbonChain = "State the hybridisation of each carbon atom in CH3-CH=CH-C≡N and in CH2=C=O.";
  const ketene = "What is the hybridization of each carbon in CH2=C=O?";
  const nitrile = "Assign hybridization at each carbon of CH2=CH-C≡N.";
  for (const question of [carbonChain, ketene, nitrile]) {
    check(isVseprStem(question) === false, "a closed carbon bond line is not a VSEPR species list");
    check(buildVseprScene(question, [], false) === null, "a carbon bond line does not draw a split fragment");
    const selectedChain = selectProductionScene({ question, turnPlan: makePlan(question), problemIR: null, requiredRetryEnabled: true });
    check(selectedChain.representation?.sceneDocument?.source.chemistryFamily !== "chem_vsepr", "production selection does not admit the fragment figure");
  }
  const separateIons = "Compare the shapes of CH3- and CH2.";
  check(isVseprStem(separateIons) && buildVseprScene(separateIons, [], false) !== null, "separate CH3- and CH2 formulas remain drawable");
  const fragment = buildVseprScene(separateIons, [], false);
  check(fragment !== null && certifyVseprSourceDocument(fragment, ketene, makePlan(ketene)).status === "rejected", "a fragment graph cannot be certified against the intact carbon chain");

  const facts = structuredClone(sample.plan);
  facts.givens = [
    { ...quantity("valenceCl", 7, "Chlorine has seven outer-shell electrons.", "electrons"), provenance: "given" },
    { ...quantity("valenceBr", 7, "Bromine has seven outer-shell electrons.", "electrons"), provenance: "given" },
    { ...quantity("valenceF", 7, "Fluorine has seven outer-shell electrons.", "electrons"), provenance: "given" },
  ];
  facts.derived = [
    quantity("stericClF3", 5, "ClF3 has three bonded atoms and two lone pairs."),
    quantity("stericBrF5", 6, "BrF5 has five bonded atoms and one lone pair."),
    quantity("lonePairsClF3", 2, "Lone pairs on the central atom of ClF3.", "pairs"),
    quantity("bondPairsBrF5", 5, "Bond pairs around the central atom of BrF5.", "pairs"),
  ];
  check(validateTurnPlanV3(facts, sample.question).plan, "source-role plan is accepted by the actual plan validator");
  check(admitted(sample.document, sample.question, facts), "element/ligand valence and per-species domain facts are checked independently");
  const contextualValence = structuredClone(facts);
  contextualValence.givens[2]!.sourceText = "Fluorine in ClF3 has seven valence electrons.";
  check(admitted(sample.document, sample.question, contextualValence), "an explicitly named ligand atom keeps its valence role within molecular context");
  const unrelatedGiven = structuredClone(sample.plan);
  unrelatedGiven.givens.push({ ...quantity("mass", 12, "An unrelated mass.", "g"), provenance: "given" });
  check(admitted(sample.document, sample.question, unrelatedGiven), "unused unrelated givens keep the ordinary generic audit");

  const exact = fixture("Use VSEPR to compare the molecular shapes and bond angles of ClF3 and XeF4.");
  exact.plan.derived = [
    quantity("angleClF3", 87.5, "Bond angle of ClF3 is 87.5 degrees.", "degrees"),
    quantity("angleXeF4", 90, "Bond angle of XeF4 is 90 degrees.", "degrees"),
  ];
  check(admitted(exact.document, exact.question, exact.plan), "different source-proved values with the same unit are not cross-compared across species");
  const radical = fixture("Show the molecular shape of NO2 using VSEPR.");
  radical.plan.derived = [quantity("lonePairsNO2", 0, "NO2 has an odd electron rather than a lone pair.", "pairs")];
  check(admitted(radical.document, radical.question, radical.plan), "a radical's single-electron domain is not certified as a lone pair");

  const planMutations: Array<[string, (plan: TurnPlanV3) => void]> = [
    ["stale valence", (plan) => { plan.givens[0]!.value = 6; }],
    ["stale steric count", (plan) => { plan.derived[0]!.value = 4; }],
    ["stale lone pairs", (plan) => { plan.derived[2]!.value = 1; }],
    ["wrong dimensional unit", (plan) => { plan.derived[0]!.unit = "degrees"; }],
    ["reassigned species symbol", (plan) => { plan.derived[0]!.symbol = "stericBrF5"; }],
    ["foreign species target", (plan) => { plan.derived[0]!.symbol = "stericSF6"; }],
    ["contradictory source target", (plan) => { plan.derived[0]!.sourceText = "Steric number of BrF5."; }],
    ["contradictory source role", (plan) => { plan.derived[0]!.sourceText = "Bond angle of ClF3."; }],
    ["foreign element target", (plan) => { plan.givens[0]!.symbol = "valenceNa"; }],
    ["ambiguous unitless given", (plan) => { plan.givens.push({ ...quantity("stericClF3", 5, "Bond angle of ClF3."), provenance: "given" }); }],
    ["ambiguous species", (plan) => { plan.derived[0]!.sourceText = "Steric numbers of ClF3 and BrF5."; }],
    ["unbound derived role", (plan) => { plan.derived.push(quantity("result", 5, "The calculation gives five.")); }],
    ["unknown derived role", (plan) => { plan.derived.push(quantity("massClF3", 92, "Molar mass of ClF3.", "g/mol")); }],
    ["layout angle is not measured", (plan) => { plan.derived.push(quantity("angleBrF5", 90, "Bond angle of BrF5 is 90 degrees.", "degrees")); }],
    ["inequality is not exact", (plan) => { plan.derived.push(quantity("angleBrF5", 89, "Bond angle of BrF5 is 89 degrees.", "degrees")); }],
  ];
  for (const [name, mutate] of planMutations) {
    const altered = structuredClone(facts); mutate(altered);
    check(!admitted(sample.document, sample.question, altered), `${name}: source certificate refuses stale or unbound scalar`);
  }
  const staleAngles = structuredClone(exact.plan);
  staleAngles.derived[0]!.symbol = "angleXeF4";
  staleAngles.derived[0]!.sourceText = "Bond angle of XeF4.";
  check(!admitted(exact.document, exact.question, staleAngles), "reassigned plan role cannot borrow another species' correct angle");
  const stripped = structuredClone(exact.document);
  delete stripped.source.chemistryFamily; delete stripped.source.archetype;
  setLabel(stripped, "m1_ang_val", "90°"); setLabel(stripped, "m2_ang_val", "87.5°");
  check(!admitted(stripped, exact.question, exact.plan), "stripping both candidate tags cannot bypass species-bound angle ownership even with correct global plan scalars");
  const ordinaryPhysics = structuredClone(sample.document);
  const physicsQuestion = "Find the equivalent resistance of three 6 ohm resistors in parallel.";
  ordinaryPhysics.source = { question: physicsQuestion };
  check(certifyVseprSourceDocument(ordinaryPhysics, physicsQuestion, makePlan(physicsQuestion)).status === "not_applicable", "source-driven activation does not turn an ordinary physics question into VSEPR");
  const ambiguousCentral = fixture("Compare the molecular shapes of NH3 and NH4+ using VSEPR.");
  ambiguousCentral.plan.derived.push(quantity("stericN", 4, "Steric number of nitrogen."));
  check(!admitted(ambiguousCentral.document, ambiguousCentral.question, ambiguousCentral.plan), "one element shared by multiple species is not a bound species role");
  const sameCentral = fixture("Compare the molecular shapes of XeF2, XeF4 and XeF6 using VSEPR.");
  sameCentral.plan.derived = [
    quantity("stericXeF2", 5, "Steric number of XeF2."),
    quantity("stericXeF4", 6, "Steric number of XeF4."),
    quantity("stericXeF6", 7, "Steric number of XeF6."),
    quantity("angleXeF4", 90, "Bond angle of XeF4 is 90 degrees.", "degrees"),
  ];
  check(admitted(sameCentral.document, sameCentral.question, sameCentral.plan), "camel-case scalar roles preserve formula tokens and disambiguate species sharing a central atom");
  const sameCentralStale = structuredClone(sameCentral.plan);
  sameCentralStale.derived[0]!.symbol = "stericXeF4"; sameCentralStale.derived[0]!.sourceText = "Steric number of XeF4.";
  check(!admitted(sameCentral.document, sameCentral.question, sameCentralStale), "reassigned same-central species target retains independent scalar checks");

  const graphMutations: Array<[string, (document: SceneDocument) => void]> = [
    ["angle", (doc) => { setLabel(doc, "m1_ang_val", "88°"); }],
    ["swapped angle owners", (doc) => { setLabel(doc, "m1_ang_val", "<90°"); setLabel(doc, "m2_ang_val", "87.5°"); }],
    ["species", (doc) => { setLabel(doc, "m1_title", "BrF_3"); }],
    ["source question", (doc) => { doc.source.question = "Compare the molecular shapes of BrF3 and BrF5."; }],
    ["central atom", (doc) => { setLabel(doc, "m1_A", "Br"); }],
    ["geometry", (doc) => { doc.constructions.find((item) => item.id === "make_m1_ang")!.inputs.radius = 0.45; }],
    ["label owner", (doc) => { doc.constructions.find((item) => item.id === "make_m1_title")!.inputs.target = "m2_title_p"; }],
    ["required entity", (doc) => { doc.requiredEntityIds = doc.requiredEntityIds.filter((id) => id !== "m1_ang"); }],
    ["reveal owner", (doc) => { doc.revealGroups[0]!.entityIds = doc.revealGroups[0]!.entityIds.filter((id) => id !== "m1_ang"); doc.revealGroups[1]!.entityIds.push("m1_ang"); }],
    ["extra plan-id quantity", (doc) => { doc.quantities.push({ id: facts.derived[0]!.id, value: 5 }); }],
    ["reassigned plan-id quantity", (doc) => { doc.quantities.push({ id: facts.derived[1]!.id, value: 5 }); }],
    ["extra annotation", (doc) => { doc.annotations.push({ id: "extra_angle", kind: "label", targetIds: ["m2_A"], text: "87.5°" }); }],
    ["forged source slots", (doc) => { doc.source.slotSources = { angle: "stem" }; }],
    ["forged staging", (doc) => { doc.source.answerLabelEntityIds = ["m1_A"]; }],
    ["forged metric tier", (doc) => { doc.source.representationTier = "exact_verified"; doc.source.nonMetric = false; }],
  ];
  for (const [name, mutate] of graphMutations) {
    const altered = structuredClone(sample.document); mutate(altered);
    check(!admitted(altered, sample.question, facts), `${name}: complete graph certificate refuses tampering`);
  }
  for (const index of [0, 1, 2, 3]) {
    for (let wrong = 0; wrong <= 9; wrong++) {
      if (wrong === facts.derived[index]!.value) continue;
      const altered = structuredClone(facts); altered.derived[index]!.value = wrong;
      check(!admitted(sample.document, sample.question, altered), "a wrong count cannot borrow a different species' or role's true count");
    }
  }
  for (let wrong = 80; wrong <= 95; wrong += 0.5) {
    if (wrong === 87.5) continue;
    const altered = structuredClone(exact.document); setLabel(altered, "m1_ang_val", `${wrong}°`);
    check(!admitted(altered, exact.question, exact.plan), "altered angle labels never inherit a native source certificate");
  }
  check(!admitted(sample.document, "Compare the VSEPR shapes of BrF3 and BrF5.", facts), "a new actual question cannot inherit another source graph");

  const persisted = await saved(sample.question, facts, sample.document);
  check(persisted.ok, `actual presentation/server canonicalization saves the formula-derived scene: ${persisted.ok ? "" : persisted.error}`);
  check(persisted.value.sceneDocument && admitted(persisted.value.sceneDocument, sample.question, facts), "canonical persisted scene re-establishes the same certificate");
  const restored = restoreVerifiedPresentationFromTurn({ question: sample.question, sceneDocument: persisted.value.sceneDocument, sceneArtifacts: persisted.value.sceneArtifacts });
  check(restored?.diagram.commands.some((command) => command.type === "LABEL" && command.text === "87.5°"), "saved restoration retains the measured angle");
  check(restored?.diagram.commands.some((command) => command.type === "LABEL" && command.text === "<90°"), "saved restoration retains the inequality without making it an exact value");
  check((await saved(sample.question, exact.plan, exact.document)).ok === false, "mismatched question/plan fails actual canonicalization");
  for (const yieldEnabled of [false, true]) {
    const prepared = prepareVerifiedParts(exact.document, { enabled: yieldEnabled });
    const compiled = compileSceneDocument(prepared.document);
    check(compiled.ok && compiled.renderScene, "source diagram compiles before normal answer staging");
    const staged = deferVerifiedAnswerLabels(prepared.document, exact.plan, compiled.renderScene);
    check(Array.isArray(staged.source.answerLabelEntityIds) && staged.source.answerLabelEntityIds.includes("m1_ang_val"), "engine's answer staging is actually exercised");
    check(admitted(staged, exact.question, exact.plan), "known, regenerated presentation annotations preserve source evidence");
    const result = await saved(exact.question, exact.plan, staged);
    check(result.ok, `staged/yield=${yieldEnabled} scene passes actual canonicalization: ${result.ok ? "" : result.error}`);
    if (result.ok && result.value.sceneDocument) {
      check(admitted(result.value.sceneDocument, exact.question, exact.plan), "staged canonical document can be reopened under the same admission guard");
    }
  }
  const alteredForSave = structuredClone(sample.document); setLabel(alteredForSave, "m1_ang_val", "88°");
  check(!(await saved(sample.question, facts, alteredForSave)).ok, "server cannot persist an altered label even when its geometry compiles");
  check((await saved(sample.question, null, sample.document)).ok, "a fresh native graph remains saveable without a retained optional plan");
  check((await saved(sample.question, null, sample.document, { omitPlan: true })).ok, "a fresh native graph remains saveable when the optional plan property is absent");
  check(!(await saved(sample.question, null, alteredForSave)).ok, "removing the plan cannot let a wrong measured angle cross the actual server boundary");
  check(!(await saved(sample.question, null, alteredForSave, { omitPlan: true })).ok, "omitting the plan property cannot let a wrong measured angle save");
  const noPlanGeometry = structuredClone(sample.document);
  noPlanGeometry.constructions.find((item) => item.id === "make_m1_ang")!.inputs.radius = 0.45;
  check(!(await saved(sample.question, null, noPlanGeometry)).ok, "missing plan cannot let altered native geometry save");
  const noPlanStaging = structuredClone(sample.document); noPlanStaging.source.answerLabelEntityIds = ["m1_A"];
  check(!(await saved(sample.question, null, noPlanStaging)).ok, "missing plan cannot bless submitted answer staging");
  const invalidPlan = { schemaVersion: "turn-plan/v3", question: sample.question, givens: "invalid" };
  check(!(await saved(sample.question, null, sample.document, { rawPlan: invalidPlan })).ok, "an explicitly invalid retained plan is rejected rather than silently treated as an absent plan");
  let nativeShapeProbes = 0;
  for (const probe of VSEPR_PROBES.filter((probe) => probe.expect === "draw")) {
    const plan = makePlan(probe.question);
    const fresh = synthesizeFamilyScene({ question: probe.question, turnPlan: plan });
    check(fresh?.family === "chem_vsepr", "existing native VSEPR draw probe retains its source family");
    const certified = certifyVseprSourceDocument(fresh.document, probe.question, plan);
    check(certified.status === "certified", "an existing native VSEPR shape probe retains source authority");
    check(admitted(fresh.document, probe.question, plan), "an existing native shape probe passes the shared live/save guard");
    nativeShapeProbes++;
  }
  check(nativeShapeProbes === VSEPR_PROBES.filter((probe) => probe.expect === "draw").length, "all existing native draw probes have source/live-save regression evidence");
  console.log(`VSEPR source evidence: ${checks} controls passed (${nativeShapeProbes} existing native shape probes); no provider, database, coverage counts or production writes`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
