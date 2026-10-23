import assert from "node:assert/strict";
import { compileSceneDocument, completeSceneDocument, type SceneDocument, type TurnPlanV3 } from "../../src/index";

interface Fixture { id: string; document: SceneDocument; turnPlan: TurnPlanV3; target: string; covered: boolean; quantities: string[] }
function plan(question: string, givens: TurnPlanV3["givens"]): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
}
function base(question: string, quantities: SceneDocument["quantities"]): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "authored native value ownership" }, quantities,
    entities: [], constructions: [], assertions: [], annotations: [], relations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
}
function finish(document: SceneDocument): void {
  document.requiredEntityIds = document.entities.map(e => e.id);
  document.revealGroups = [{ id: "setup", entityIds: document.requiredEntityIds, dependsOn: [], narrationCue: "Show the given structure." }];
}
function angle(id: string, value: number, text: string, path: "annotation" | "label" | "quantity" = "annotation"): Fixture {
  const question = `Show the given incidence angle i = ${value} degrees at a flat interface.`;
  const given = { id: "theta", symbol: "i", value, unit: "°", provenance: "given" as const };
  const document = base(question, [given]);
  document.entities = [{ id: "O", kind: "point", role: "contact" }, { id: "L", kind: "point", role: "surface anchor" },
    { id: "surface", kind: "line", role: "interface" }, { id: "incident", kind: "ray", role: "incident ray" },
    { id: "normal", kind: "vector", role: "surface normal" }, { id: "refracted", kind: "ray", role: "refracted ray" },
    { id: "arc", kind: "angle_mark", role: "incidence angle", label: "i" }];
  // A native quantity measure is emitted on an unnamed arc. A named arc
  // without visible numeric ink is a separate uncovered control below.
  if (path === "quantity") delete document.entities.find(entity => entity.id === "arc")!.label;
  document.constructions = [
    { id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "makeL", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["L"] },
    { id: "makeSurface", operator: "line", inputs: { start: "L", direction: [1, 0] }, outputs: ["surface"] },
    { id: "makeRays", operator: "refract_at", inputs: { point: "O", surface: "surface", incidentAngleDeg: "theta", n1: 1, n2: 1.5, span: 2 }, outputs: ["incident", "normal", "refracted"] },
    { id: "mark", operator: "angle_mark", inputs: { vertex: "O", a: "incident", b: "normal", radius: .55 }, outputs: ["arc"] },
  ];
  if (path === "label") {
    document.entities.push({ id: "value", kind: "label", role: "native bare value", label: text });
    document.constructions.push({ id: "makeValue", operator: "label", inputs: { target: "arc", text }, outputs: ["value"] });
  } else document.annotations.push({ id: "nativeValue", kind: "label", targetIds: ["arc"], ...(path === "quantity" ? { quantityId: "theta" } : { text }) });
  finish(document);
  return { id, document, turnPlan: plan(question, [given]), target: "arc", quantities: ["theta"], covered: true };
}
function distance(id: string, text = ".150 m"): Fixture {
  const question = "Show point A at its given vertical coordinate r = 0.15 m and its dimension from the origin.";
  const given = { id: "r", symbol: "r_A", value: .15, unit: "m", provenance: "given" as const };
  const document = base(question, [given]);
  document.entities = [{ id: "O", kind: "point", role: "origin" }, { id: "A", kind: "point", role: "given point", label: "A" },
    { id: "distance", kind: "dimension", role: "coordinate distance", label: text }];
  document.constructions = [
    { id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "makeA", operator: "point", inputs: { x: 0, y: "r", coordinateSpace: "world" }, outputs: ["A"] },
    { id: "measure", operator: "dimension", inputs: { start: "O", end: "A" }, outputs: ["distance"] },
  ];
  finish(document);
  return { id, document, turnPlan: plan(question, [given]), target: "A", quantities: ["r"], covered: true };
}
const fixtures: Fixture[] = [angle("incidence-22", 22, "22°"), angle("launch-31", 31, "31.0 degrees"), angle("native-measure-58", 58, "58 °", "quantity"),
  angle("explicit-label-output", 22, "22.00 deg", "label"), distance("distance-015"), distance("distance-045", "0.450 m")];
fixtures[5]!.document.quantities[0]!.value = .45; fixtures[5]!.turnPlan.givens[0]!.value = .45;
function control(fixture: Fixture, mutate: (fixture: Fixture) => void): void { fixture.covered = false; mutate(fixture); fixtures.push(fixture); }
for (const text of ["22 rad", "-22°", "about 22°", "i: 22°", "22° / 31°", "122°"]) control(angle(`angle-uncovered-${text}`, 22, text), () => {});
control(angle("equal-number-other-owner", 22, "22°"), fixture => { fixture.document.annotations[0]!.targetIds = ["refracted"]; });
control(angle("missing-visible-native-value", 22, "22°"), fixture => { fixture.document.annotations = []; });
control(angle("named-angle-with-undrawn-quantity", 58, "58 °", "quantity"), fixture => {
  fixture.document.entities.find(entity => entity.id === "arc")!.label = "i";
});
control(angle("explicit-label-later-reveal", 22, "22°", "label"), fixture => {
  fixture.document.revealGroups[0]!.entityIds = fixture.document.revealGroups[0]!.entityIds.filter(id => id !== "value");
  fixture.document.revealGroups.push({ id: "later", entityIds: ["value"], dependsOn: ["setup"], narrationCue: "Show the later note." });
});
for (const text of [".150 cm", "-.150 m", "~ .15 m", ".15 m + .45 m", ".45 m"]) control(distance(`distance-uncovered-${text}`, text), () => {});
control(distance("translated-origin"), fixture => { fixture.document.constructions[0]!.inputs.y = -.1; });
control(distance("nonzero-second-coordinate"), fixture => { fixture.document.constructions[1]!.inputs.x = .2; });
control(distance("negative-signed-coordinate"), fixture => { fixture.document.quantities[0]!.value = -.15; fixture.turnPlan.givens[0]!.value = -.15; });
control(distance("equal-number-sibling-dimension"), fixture => {
  fixture.document.entities.push({ id: "B", kind: "point", role: "another point" });
  fixture.document.constructions.push({ id: "makeB", operator: "point", inputs: { x: .3, y: .15, coordinateSpace: "world" }, outputs: ["B"] });
  fixture.document.constructions[2]!.inputs.end = "B"; finish(fixture.document);
});
control(distance("dimension-later-reveal"), fixture => {
  fixture.document.revealGroups[0]!.entityIds = ["O", "A"];
  fixture.document.revealGroups.push({ id: "later", entityIds: ["distance"], dependsOn: ["setup"], narrationCue: "Show the later dimension." });
});
control(distance("partly-covered-tuple"), fixture => {
  const extra = { id: "x", symbol: "x_A", value: .2, unit: "m", provenance: "given" as const };
  fixture.document.quantities.push(extra); fixture.turnPlan.givens.push(extra); fixture.document.constructions[1]!.inputs.x = "x"; fixture.quantities.push("x");
});
control(distance("equal-valued-components-cannot-share-one-bare-label"), fixture => {
  const extra = { id: "x", symbol: "x_A", value: .15, unit: "m", provenance: "given" as const };
  fixture.document.quantities.push(extra); fixture.turnPlan.givens.push(extra);
  fixture.document.constructions[1]!.inputs.x = "x"; fixture.quantities.push("x");
  fixture.document.entities = fixture.document.entities.filter(entity => entity.id !== "distance");
  fixture.document.constructions = fixture.document.constructions.filter(construction => construction.id !== "measure");
  fixture.document.annotations.push({ id: "oneBareScalar", kind: "label", targetIds: ["A"], text: ".150 m" });
  fixture.document.source.question = "Show A with x_A = 0.15 m and r_A = 0.15 m; one scalar note does not specify both coordinates.";
  fixture.turnPlan.question = fixture.document.source.question;
  finish(fixture.document);
});
control(distance("same-given-on-two-axes-cannot-share-one-bare-label"), fixture => {
  fixture.document.constructions[1]!.inputs.x = "r";
  fixture.document.entities = fixture.document.entities.filter(entity => entity.id !== "distance");
  fixture.document.constructions = fixture.document.constructions.filter(construction => construction.id !== "measure");
  fixture.document.annotations.push({ id: "oneBareScalar", kind: "label", targetIds: ["A"], text: ".150 m" });
  fixture.document.source.question = "Show A with both coordinates equal to the given r = 0.15 m; one scalar note does not specify both coordinates.";
  fixture.turnPlan.question = fixture.document.source.question;
  finish(fixture.document);
});
let passed = 0, failed = 0;
for (const fixture of fixtures) {
  try {
    const original = structuredClone(fixture.document);
    const baseline = compileSceneDocument(fixture.document);
    assert(baseline.ok && baseline.renderScene, `native setup must admit: ${JSON.stringify(baseline.report.issues)}`);
    const result = completeSceneDocument(fixture.document, { enabled: true, turnPlan: fixture.turnPlan, baseRenderScene: baseline.renderScene });
    const additions = result.additions.filter(a => a.targetIds.includes(fixture.target));
    if (fixture.covered) {
      assert.equal(additions.length, 0, "exact native same-owner bare values already cover every proposed quantity");
      assert.equal(result.document, fixture.document, "abstention retains the original native document by identity");
      const reopened = compileSceneDocument(JSON.parse(JSON.stringify(result.document)) as SceneDocument);
      assert(reopened.ok && reopened.renderScene);
      assert.deepEqual(reopened.renderScene, baseline.renderScene, "native ink and all names round-trip unchanged");
      assert(result.skipped.some(s => s.code === "existing_quantity_native_value"));
    } else {
      assert.equal(additions.length, 1, "an unrelated, missing, partial or incompatible value cannot suppress a proved proposal");
      assert.deepEqual([...additions[0]!.quantityIds].sort(), [...fixture.quantities].sort(), "uncovered tuple components must survive together");
    }
    assert.deepEqual(fixture.document, original, "completion must preserve native source, geometry, labels and reveal groups");
    passed++;
  } catch (error) { failed++; console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
console.log(`completion-native-values: ${passed}/${fixtures.length} passed`);
if (failed) process.exitCode = 1;
// Retain the original overlong setup as an explicit native rejection, rather
// than counting an invalid document as a duplicate-suppression negative.
const verboseSetup = compileSceneDocument(distance("verbose-approximate-native-rejection", "approximately .15 m").document);
assert(!verboseSetup.ok && verboseSetup.report.issues.some(issue => issue.code === "dimension_overlap_unresolved"));
console.log("completion-native-values: verbose native setup correctly rejected (not a suppression case)");
