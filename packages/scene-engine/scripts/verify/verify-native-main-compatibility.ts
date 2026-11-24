import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { certifyVseprSourceDocument, deferVerifiedAnswerLabels, compileSceneDocument, validateSceneDocument, validateSceneQuantityAgreement, type SceneDocument, type TurnPlanV3 } from "../../src/index";
import { energyDiagram, scene, pt } from "../probes/evaluationCompileProbes";
import { auditOriginalMassSourceGivens } from "../../src/physics/atomicMassSource";
import { validateSourceEnergyLevelTruth } from "../../src/physics/sourceEnergyLevelTruth";
import { buildNeutralDecayScene } from "../../src/physics/neutralDecaySource";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { sourceDocumentMatchesRebuiltSource } from "../../src/physics/independentSourceScene";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { partitionTransformViews } from "../../src/compile/transformViewOwnership";
import { buildSourceCertifiedScientificScene } from "../../src/synthesize/sourceCertifiedScientificScene";
import { demandRejection, pictureFeatures, sceneDemand } from "../../src/synthesize/sceneDemand";
import { SceneBuilder } from "../../src/archetypes/document";

const question = "An electron in hydrogen falls from n = 3 to n = 2.";
const document = validateSceneDocument(energyDiagram(question,
  [{ id: "n3", y: 3, label: "n=3" }, { id: "n2", y: 2, label: "n=2" }], { from: "n3", to: "n2" })).document;
assert(document);
assert.equal(validateSourceEnergyLevelTruth(document).length, 0, "legal inline world points, axes, dimensions and target-owned transition labels retain source proof");
assert(compileSceneDocument(document, { figureConsistency: true }).ok);
for (const variant of ["state", "direction", "unsupported_frame", "nonfinite", "axes", "dimension"] as const) {
  const bad = structuredClone(document);
  const photon = bad.constructions.find(construction => construction.outputs.includes("photon"))!;
  if (variant === "state") bad.entities.find(entity => entity.id === "n3")!.label = "n=4";
  if (variant === "direction") [photon.inputs.start, photon.inputs.end] = [photon.inputs.end, photon.inputs.start];
  if (variant === "unsupported_frame") photon.inputs.start = { x: 1.5, y: 3, coordinateSpace: "layout" };
  if (variant === "nonfinite") photon.inputs.start = { x: NaN, y: 3 };
  if (variant === "axes") bad.constructions.find(construction => construction.operator === "axes")!.inputs.xMax = -2;
  if (variant === "dimension") bad.constructions.find(construction => construction.operator === "dimension")!.inputs.start = "missing";
  assert(validateSourceEnergyLevelTruth(bad).some(issue => issue.severity === "fatal"), variant);
}
const quantities = JSON.parse(readFileSync(new URL("./fixtures/native-source-lecture.json", import.meta.url), "utf8")) as Array<{ turnPlan: TurnPlanV3 }>;
const p = pt("crate", 0, 0, "crate");
for (const sourceText of ["m = 4", "m=4kg", "m"]) {
  const massQuestion = "A 4 kg crate rests on a table.";
  const plan: TurnPlanV3 = { ...quantities[0]!.turnPlan, question: massQuestion,
    givens: [{ id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given", sourceText }], derived: [], unknowns: [] };
  const mass = validateSceneDocument({ ...scene(massQuestion, [p.entity], [p.construction]),
    quantities: [{ id: "m", symbol: "m", value: 4, unit: "kg", provenance: "given" }],
    annotations: [{ id: "mass_label", kind: "label", targetIds: ["crate"], quantityId: "m", text: "m=4 kg" }] }).document;
  assert(mass);
  assert.deepEqual(auditOriginalMassSourceGivens(mass, plan).issues, [], sourceText);
  for (const variant of ["wrong_value", "wrong_unit", "candidate", "owner"] as const) {
    const badPlan = structuredClone(plan), badMass = structuredClone(mass);
    if (variant === "wrong_value") badPlan.givens[0]!.value = 5;
    if (variant === "wrong_unit") badPlan.givens[0]!.unit = "g";
    if (variant === "candidate") badMass.quantities[0]!.value = 5;
    if (variant === "owner") {
      badPlan.question = "A 4 kg crate and a 5 kg block rest on a table.";
      badMass.source.question = badPlan.question;
      badMass.entities[0]!.role = "block";
    }
    assert(auditOriginalMassSourceGivens(badMass, badPlan).issues.some(issue => issue.severity === "fatal"), `${sourceText}/${variant}`);
  }
}
const a = pt("a", 0, 0), b = pt("b", 2, 0);
const views = validateSceneDocument(scene("Two marked points.", [a.entity, b.entity], [a.construction, b.construction])).document!;
views.revealGroups = [{ id: "left", entityIds: ["a"], dependsOn: [], narrationCue: "left" },
  { id: "right", entityIds: ["b"], dependsOn: [], narrationCue: "right" }];
const kinds = new Map([["a", { kind: "point" }], ["b", { kind: "point" }]]);
const groups = new Map([["a", "left"], ["b", "right"]]);
const packs = (value: SceneDocument) => partitionTransformViews(value, kinds, new Set(), groups).canPack;
assert(packs(views));
views.assertions = [{ id: "apart", predicate: "connected", entities: ["a", "b"], expected: false, severity: "fatal" }];
assert(packs(views), "main legacy policy does not join components for a negated connection");
views.source.diagramYieldPolicy = "verified_parts";
assert(!packs(views), "verified-parts assertions retain the common main transform");
views.source.diagramYieldPolicy = "off";
views.assertions[0]!.expected = true;
assert(!packs(views), "positive connection preserves shared transform in both policies");

// Unused nonphysical planner context retains main's audit without authorizing ink.
{
  const question = "Show the molecular shape.";
  const plan: TurnPlanV3 = { ...quantities[0]!.turnPlan, question,
    givens: [{ id: "mass", symbol: "m", value: 12, unit: "g", provenance: "given", sourceText: "An unrelated mass." }], derived: [], unknowns: [] };
  const generic = validateSceneDocument(scene(question, [p.entity], [p.construction])).document!;
  assert.equal(auditOriginalMassSourceGivens(generic, plan).issues.length, 0);
  const ink = structuredClone(generic); ink.entities[0]!.label = "m=12 g";
  assert(auditOriginalMassSourceGivens(ink, plan).issues.some(issue => issue.severity === "fatal"));
  const operand = structuredClone(generic); operand.quantities.push({ id: "mass", value: 12, unit: "g" });
  assert(auditOriginalMassSourceGivens(operand, plan).issues.some(issue => issue.severity === "fatal"));
}

// Full independent legacy source reconstruction preserves existing calibrated
// views while refusing altered scientific data or additional submitted ink.
for (const rebuilt of [
  buildNeutralDecayScene("A first-order process has half life 15 min. Plot fraction remaining after 45 min."),
  buildAtomicRadiationScene("Calculate the energy and Bohr radius of the n = 2 orbit of hydrogen. The drawing is the Bohr model, not an electron trajectory.", [], false),
]) {
  assert(rebuilt && typeof rebuilt.source.question === "string");
  const question = rebuilt.source.question;
  assert(sourceDocumentMatchesRebuiltSource(rebuilt, question, rebuilt));
  assert(compileSceneDocument(rebuilt).ok);
  for (const variant of ["label", "geometry", "value", "source", "extra"] as const) {
    const bad = structuredClone(rebuilt);
    if (variant === "label") bad.entities.find(entity => entity.label)!.label = "invented numeric answer 999";
    if (variant === "geometry") bad.constructions.find(construction => construction.operator === "point")!.inputs.x = 999;
    if (variant === "value") {
      if (bad.quantities.length) bad.quantities[0]!.value = 999;
      else bad.quantities.push({ id: "invented_value", value: 999, unit: "eV" });
    }
    if (variant === "source") bad.source.question = "A different original question.";
    if (variant === "extra") bad.annotations.push({ id: "extra", kind: "callout", targetIds: [bad.requiredEntityIds[0]!], text: "false claim 999" });
    assert(!sourceDocumentMatchesRebuiltSource(bad, question, rebuilt), variant);
  }
}
for (const question of [
  "Draw the energy levels of hydrogen for the n=4 to n=2 transition.",
  "Show the hydrogen energy-level diagram for an n=4 to n=2 transition.",
  "Draw the energy levels of hydrogen for a transition from n=4 to n=2.",
]) for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene]) {
  const result = lower({ question }); assert(result);
  assert.deepEqual(result.document.entities.filter(entity => /^n=/.test(entity.label ?? "")).map(entity => entity.label).sort(), ["n=2", "n=4"]);
  assert.equal(result.document.entities.filter(entity => entity.kind === "vector").length, 1, "a closed ordered pair cannot add unrelated transitions");
}

// A legacy chemistry certificate regenerates the new primitive timing field;
// the field cannot change source geometry or smuggle an arbitrary answer ID.
{
  const question = "Use VSEPR to compare the molecular shapes and bond angles of ClF3 and XeF4.";
  const plan: TurnPlanV3 = { ...quantities[0]!.turnPlan, question, givens: [], unknowns: [],
    derived: [{ id: "angleClF3", symbol: "angleClF3", value: 87.5, unit: "degrees", provenance: "derived", sourceText: "Bond angle of ClF3 is 87.5 degrees." }],
    qualitativeClaims: [], lawIds: ["VSEPR theory"], assumptions: [] };
  const scene = synthesizeFamilyScene({ question, turnPlan: plan }); assert(scene);
  const compiled = compileSceneDocument(scene.document); assert(compiled.ok && compiled.renderScene);
  const staged = deferVerifiedAnswerLabels(scene.document, plan, compiled.renderScene);
  assert.equal(certifyVseprSourceDocument(staged, question, plan).status, "certified");
  const forged = structuredClone(staged); forged.source.answerLabelPrimitiveIds = ["invented_answer_id"];
  assert.equal(certifyVseprSourceDocument(forged, question, plan).status, "rejected");
}
// Exact legacy regeneration owns side captions, while actual source scope,
// axis direction and every requested event still have independent obligations.
{
  const base = "Draw the Bohr model for the transition from n=3 to n=2 in hydrogen.";
  const rows: Array<[string, boolean]> = [
    [base, true], [base + " Energy increases upward.", true],
    [base + ' The earlier example said "Energy increases downward.".', true],
    ["Calculate the energy and Bohr radius of the n = 2 orbit of hydrogen. The drawing is the Bohr model, not an electron trajectory.", true],
    ["How many spectral lines are emitted when a hydrogen electron falls from n = 4 to lower levels in the Bohr model?", true],
    ["In the Bohr model an electron in He+ rises from n = 1 to n = 2. Find the photon energy. This is not an electron path.", true],
    [base.replace(" in hydrogen.", " in hydrogen with nuclear charge Z=2."), false],
    [base.replace(" in hydrogen.", " in a hydrogen-like ion with nuclear charge Z=2."), false],
    [base.replace(".", " using 14 eV as the ground-state binding energy."), false],
    [base + " Energy increases downward.", false], [base + " Energy increases to the right.", false],
    [base.replace(" in hydrogen.", " in hydrogen and the transition from n=2 to n=1."), false],
    [base + " Mark n=1.", false], [base + " Do not label its energy or wavelength.", false],
    [base.replace(".", " without wavelength labels."), false],
    [base + " Do not show this transition.", false], [base + " Do not draw the transition from n=3 to n=2.", false],
  ];
  for (const [question, expected] of rows) {
    const document = buildAtomicRadiationScene(question, [], false);
    assert(document);
    assert.equal(compileSceneDocument(document).ok, expected, question);
    if (!expected) for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene])
      assert.notEqual(lower({ question })?.document.source.chemistryFamily, "chem_orbital", `${question}: actual lowering cannot admit the legacy source mismatch`);
  }
}
// Finite bound-state operators cannot add an unproved continuum mark. Verbal
// work joined to the draw request does not require that mark on the diagram.
{
  const base = "A hydrogen atom emits a photon during the transition from n = 4 to n = 2. ";
  for (const [ask, required] of [
    ["Draw the energy level diagram and mark the ionization limit.", true],
    ["Draw the energy level diagram with the ionization limit and explain the diagram.", true],
    ["Draw the energy level diagram and calculate the ionization limit.", false],
    ["Draw the energy level diagram, then explain the continuum threshold.", false],
    ["Draw the energy level diagram and also determine the ionization limit.", false],
    ["Draw the energy level diagram. Explain the ionization limit.", false],
    ["Draw the energy level diagram without the ionization limit.", false],
    ["Draw the energy level diagram. A note says 'mark the ionization limit'.", false],
    ["Draw the energy level diagram.", false],
  ] as const) {
    const question = base + ask, candidate = buildSourceCertifiedScientificScene(question);
    assert(candidate);
    assert.equal(validateSourceEnergyLevelTruth(candidate.document).some(issue => issue.code === "energy_level_continuum_unproved"), required, ask);
    for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene])
      assert.equal(lower({ question })?.family ?? null, required ? null : "energy_level", ask);
  }
}
// An electron's requested orbit is a spatial obligation. A finite energy
// ladder cannot replace it, while joined verbal orbit work keeps its scope.
{
  const orbit = "Draw an electron in a circular Bohr orbit with radius r and tangential velocity v.";
  const levels = "A hydrogen atom emits a photon during the transition from n = 4 to n = 2. ";
  for (const [question, required] of [
    [orbit, true],
    ["Draw an electron in a circular Bohr orbit of hydrogen at n=2, and mark the radius and tangential velocity.", true],
    ["Draw a circular Bohr orbit for n = 2 in hydrogen and a separate energy-level ladder.", true],
    [levels + "Draw the energy level diagram and calculate the radius and speed of an electron in a Bohr orbit.", false],
    [levels + "Draw the energy level diagram and explain the circular Bohr orbit.", false],
    [levels + "Draw the energy level diagram. Do not draw the Bohr orbit.", false],
    [levels + 'Draw the energy level diagram. The old exercise said "Draw an electron in a circular Bohr orbit".', false],
  ] as const) {
    assert.equal(sceneDemand(question).requires.includes("bohr_orbit"), required, question);
    for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene])
      assert.equal(lower({ question })?.family ?? null, required ? null : "energy_level", question);
  }
  const satellite = "Draw a satellite in a classical circular orbit around Earth, with inward gravitational force and tangential velocity.";
  assert(!sceneDemand(satellite).requires.includes("bohr_orbit"));
  for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene]) assert(lower({ question: satellite }));
  for (const variant of ["on", "off", "wrong_nucleus", "unrelated_ring", "wrong_particle"] as const) {
    const builder = new SceneBuilder(orbit, "owned orbit incidence control", "energy_level");
    builder.point("centre", { x: 0, y: 0 }, variant === "wrong_nucleus" ? "unrelated centre" : "nucleus");
    if (variant === "wrong_nucleus") builder.point("nucleus", { x: 0, y: 1 }, "nucleus");
    builder.point("electron", { x: variant === "off" ? 3 : 2, y: 0 }, variant === "wrong_particle" ? "particle" : "electron", "e");
    builder.circle("ring", "centre", 2, variant === "unrelated_ring" ? "unrelated circle" : "electron path");
    const document = builder.build();
    assert.equal(pictureFeatures(document).has("bohr_orbit"), variant === "on", variant);
    assert.equal(demandRejection(document, sceneDemand(orbit)) === null, variant === "on", variant);
    if (variant === "on") assert(compileSceneDocument(document).ok, "actual centered electron orbit geometry still compiles");
  }
}
// Existing quantity-audit callers can supply a minimal inventory without a
// source question. Its absence grants no observable-conversion authority.
{
  const plan = { givens: [], derived: [], unknowns: [], qualitativeClaims: [] };
  for (const label of ["(CH_3)_3C", "(CH_3)_3COH", "q = 3 C", "λ_500 nm", "x_2 m", "x_2m", "T_300K", "F_10N", "m_25kg", "q_2C"]) {
    const issues = Reflect.apply(validateSceneQuantityAgreement, undefined, [[], plan, [label]]);
    assert.deepEqual(issues.map((issue: { code: string }) => issue.code), label.startsWith("(CH_3)") ? [] : ["displayed_quantity_unverified"], label);
  }
}
console.log("native main compatibility: source/owner/value negatives, scoped legacy Bohr replay, ordered hydrogen transitions, VSEPR timing, minimal quantity-audit API and current-main transform partition pass");
