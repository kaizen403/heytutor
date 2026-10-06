import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateCircleSourceBinding } from "../../src/compile/circleGeometry";
import { attemptArchetypeScene } from "../../src/archetypes";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { extractCircleSource, findStatedCurves } from "../../src/synthesize/statedEquations";
import type { SceneDocument } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

interface FrozenCase {
  id: string;
  question: string;
  center: [number, number];
  radius: number;
  expected: "circle" | "point" | "reject";
  point: [number, number] | null;
  distanceSquared: number | null;
}

const out = resolve(process.argv[2] ?? `${process.env.HOME}/.capy/work/HEY83-parallel-topics/circle-standard-form`);
mkdirSync(out, { recursive: true });
const frozen = readFileSync(join(out, "checklist-frozen.json"));
assert.equal(createHash("sha256").update(frozen).digest("hex"), "f43c3f26184a0c98a091692a67cbbaa707fec4f2b3e99f9b2280857469f4e51c");
const cases: FrozenCase[] = JSON.parse(frozen.toString());
let checks = 0;
function close(actual: number, expected: number): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}
function documentFor(c: FrozenCase): SceneDocument {
  const ids = [...(c.expected === "point" ? [] : ["C"]), "locus", ...(c.expected === "circle" ? ["Q"] : []), ...(c.point ? ["P"] : [])];
  const point = (id: string, x: number, y: number) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Explicit-source primitive qualification only" },
    source: { question: c.question, offlineQualification: true, circleSourceBinding: { locusId: "locus" } },
    quantities: [],
    entities: ids.map((id) => ({ id, kind: id === "locus" && c.expected !== "point" ? "circle" : "point", role: "source locus or membership point", ...(id === "C" ? { label: `C(${c.center.join(",")})` } : id === "Q" ? { label: "Q" } : id === "locus" && c.expected === "point" ? { label: `Point(${c.center.join(",")}); r=0` } : id === "P" ? { label: `P(${c.point!.join(",")})` } : {}) })),
    constructions: [
      ...(c.expected === "point" ? [] : [point("C", ...c.center)]),
      c.expected === "point" ? point("locus", ...c.center) : { id: "make_locus", operator: "circle", inputs: { center: "C", radius: c.radius }, outputs: ["locus"] },
      ...(c.expected === "circle" ? [point("Q", c.center[0] + c.radius, c.center[1])] : []),
      ...(c.point ? [point("P", ...c.point)] : []),
    ],
    relations: [],
    assertions: [{ id: "exists_locus", predicate: "exists", entities: ["locus"], expected: true, severity: "fatal" }],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Reveal the source locus" }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Source locus" }],
  };
}

function matchesFrozenSource(c: FrozenCase, doc: SceneDocument): boolean {
  const center = doc.constructions.find((construction) => construction.outputs.includes("C"));
  const circle = doc.constructions.find((construction) => construction.operator === "circle");
  return doc.source.question === c.question && center?.inputs.x === c.center[0] && center.inputs.y === c.center[1] && center.inputs.coordinateSpace === "world" && circle?.inputs.radius === c.radius;
}

function blankEvidence(question: string): SceneDocument {
  return { ...documentFor(cases[0]!), visualDecision: { mode: "text_only", reason: "Offline decline evidence; no scene credit" }, source: { question }, entities: [], constructions: [], assertions: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
}

const results: unknown[] = [];
for (const c of cases) {
  const doc = documentFor(c);
  if (c.expected === "circle") assert.equal(matchesFrozenSource(c, doc), true);
  const compiled = compileSceneDocument(doc);
  const curves = findStatedCurves(c.question).filter((curve) => curve.kind === "circle");
  if (c.expected === "circle") {
    assert.equal(curves.length, 1, c.id);
    close(curves[0]!.anchor!.x, c.center[0]);
    close(curves[0]!.anchor!.y, c.center[1]);
    close(curves[0]!.radius!, c.radius);
    const [a, b, d, e, f, g] = curves[0]!.coefficients;
    for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.8, 0.6]]) {
      const x = c.center[0] + c.radius * u!;
      const y = c.center[1] + c.radius * v!;
      close((x - c.center[0]) ** 2 + (y - c.center[1]) ** 2, c.radius ** 2);
      close(Math.hypot(x - c.center[0], y - c.center[1]), c.radius);
      close(a * x * x + b * x * y + d * y * y + e * x + f * y + g, 0);
    }
  } else assert.equal(curves.length, 0, c.id);
  if (c.expected === "reject") {
    assert.equal(compiled.ok, false);
    assert.equal(compiled.renderScene, null);
    const blank = compileSceneDocument(blankEvidence(c.question));
    assert.ok(blank.renderScene);
    assert.equal(blank.renderScene.primitives.length, 0);
    writeFileSync(join(out, `${c.id}-primitive.svg`), renderSceneSvg(blank.renderScene, { title: c.question, subtitle: "OFFLINE negative-radius rejection: renderScene=null; no partial ink" }));
  } else {
    assert.equal(compiled.ok, true, JSON.stringify(compiled.report));
    assert.ok(compiled.renderScene);
    const primitive = compiled.renderScene.primitives.find((p) => p.entityId === "locus" && p.kind === c.expected);
    assert.ok(primitive, c.id);
    if (c.expected === "circle") {
      const center = compiled.renderScene.primitives.find((p) => p.entityId === "C" && p.kind === "point")!;
      const radial = compiled.renderScene.primitives.find((p) => p.entityId === "Q" && p.kind === "point")!;
      close(primitive.points[0]!.x, center.points[0]!.x);
      close(primitive.points[0]!.y, center.points[0]!.y);
      close(primitive.radius!, Math.hypot(radial.points[0]!.x - center.points[0]!.x, radial.points[0]!.y - center.points[0]!.y));
    }
    if (c.expected === "point") assert.equal(compiled.renderScene.primitives.some((p) => p.kind === "circle"), false);
    writeFileSync(join(out, `${c.id}-primitive.svg`), renderSceneSvg(compiled.renderScene, { title: c.question, subtitle: "OFFLINE explicit-source primitive qualification; not live verified" }));
    writeFileSync(join(out, `${c.id}-compiled.json`), JSON.stringify(compiled, null, 2));
  }
  if (c.point) close((c.point[0] - c.center[0]) ** 2 + (c.point[1] - c.center[1]) ** 2, c.distanceSquared!);
  const archetype = attemptArchetypeScene({ question: c.question });
  const family = synthesizeFamilyScene({ question: c.question, families: ["coordinate_figure"] });
  const source = extractCircleSource(c.question);
  assert.ok(source);
  if (c.expected === "reject") {
    assert.equal(source.kind, "invalid");
    assert.equal(family, null);
    assert.equal(synthesizeLastResortScene({ question: c.question, families: ["coordinate_figure"] }), null);
  } else {
    assert.ok(family, c.id);
    assert.equal(source.kind, c.expected);
    const labels = family.renderScene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text);
    if (c.expected === "circle") assert.ok(labels.includes(source.equation.replace(/\^2/g, "²")), `${c.id}: complete equation label required`);
    else assert.equal(family.renderScene.primitives.filter((primitive) => primitive.kind === "point").length, 1);
    if (c.point) assert.ok(labels.includes(`P(${c.point.join(",")})`), `${c.id}: named membership point required`);
    if (c.expected === "point") assert.equal(family.renderScene.primitives.some((primitive) => primitive.kind === "circle"), false);
  }
  for (const [lane, scene] of [["archetype", archetype.scene], ["family", family]] as const) {
    if (scene) {
      writeFileSync(join(out, `${c.id}-${lane}.svg`), renderSceneSvg(scene.renderScene, { title: c.question, subtitle: `OFFLINE existing ${lane}; ${scene.tier}; requires source audit` }));
      writeFileSync(join(out, `${c.id}-${lane}.json`), JSON.stringify(scene, null, 2));
    } else {
      const blank = compileSceneDocument(blankEvidence(c.question));
      assert.ok(blank.renderScene);
      writeFileSync(join(out, `${c.id}-${lane}.svg`), renderSceneSvg(blank.renderScene, { title: c.question, subtitle: `OFFLINE ${lane} declined; no scene credit` }));
      writeFileSync(join(out, `${c.id}-${lane}.json`), JSON.stringify({ scene: null, declined: true }, null, 2));
    }
  }
  const familyCircle = family?.document.constructions.find((construction) => construction.operator === "circle");
  const familyCenter = family?.document.constructions.find((construction) => construction.outputs.includes(String(familyCircle?.inputs.center)));
  const familyGeometry = familyCircle ? { center: [familyCenter?.inputs.x, familyCenter?.inputs.y], radius: familyCircle.inputs.radius } : null;
  const membershipPointPresent = c.point === null ? null : family?.document.constructions.some((construction) => construction.operator === "point" && construction.inputs.x === c.point![0] && construction.inputs.y === c.point![1] && family.document.entities.some((entity) => construction.outputs.includes(entity.id) && (entity.role === "named point" || entity.label?.startsWith("P(")))) ?? false;
  results.push({ id: c.id, primitiveOk: compiled.ok, parserCircleCount: curves.length, archetype: archetype.scene?.tier ?? archetype.declined, family: family?.tier ?? null, familyGeometry, familyGeometryMatchesSource: c.expected === "circle" && familyGeometry?.center[0] === c.center[0] && familyGeometry.center[1] === c.center[1] && familyGeometry.radius === c.radius, membershipPointPresent, familyLabels: family?.document.entities.filter((entity) => entity.label).map((entity) => entity.label) ?? [] });
}

const origin = cases.find((c) => c.id === "origin")!;
for (const radius of [0, -5, NaN, Infinity]) {
  const doc = documentFor({ ...origin, radius });
  const compiled = compileSceneDocument(doc);
  checks++;
  assert.equal(compiled.ok, false);
  assert.equal(compiled.renderScene, null);
}
const mutations = ["radius", "center", "source", "layout_space"] as const;
const sourceGuardGaps: string[] = [];
for (const mutation of mutations) {
  const doc = documentFor(origin);
  if (mutation === "radius") doc.constructions.find((c) => c.operator === "circle")!.inputs.radius = 7;
  if (mutation === "center") doc.constructions[0]!.inputs.x = 9;
  if (mutation === "source") doc.source.question = "The circle x^2+y^2=49 has center and radius to be determined.";
  if (mutation === "layout_space") doc.constructions[0]!.inputs.coordinateSpace = "layout";
  checks++;
  assert.equal(matchesFrozenSource(origin, doc), false, `${mutation} must fail the independent frozen-source oracle`);
  const compiled = compileSceneDocument(doc);
  assert.equal(compiled.ok, false, `${mutation}: source mutation must be refused`);
  assert.equal(compiled.renderScene, null);
  if (compiled.ok) sourceGuardGaps.push(mutation);
}
const sourceBoundFamily = synthesizeFamilyScene({ question: cases.find((c) => c.id === "on")!.question, families: ["coordinate_figure"] })!;
for (const mutation of ["missing_member", "missing_source", "singleton_substitution"] as const) {
  const doc: SceneDocument = JSON.parse(JSON.stringify(sourceBoundFamily.document));
  if (mutation === "missing_member") {
    doc.entities.find((entity) => entity.id === "source_member")!.role = "helper";
    delete doc.entities.find((entity) => entity.id === "source_member")!.label;
  }
  if (mutation === "missing_source") doc.source.question = "No supported circle equation is available.";
  if (mutation === "singleton_substitution") doc.source.question = cases.find((c) => c.id === "zero")!.question;
  const compiled = compileSceneDocument(doc);
  checks++;
  assert.equal(compiled.ok, false, mutation);
  assert.equal(compiled.renderScene, null, mutation);
}
assert.equal(extractCircleSource("A circle has center (3,-2) and radius −5.")?.kind, "invalid");
assert.equal(extractCircleSource("A circle has center (3,-2) and radius 0.")?.kind, "invalid");
assert.equal(extractCircleSource("The circle x^2+y^2+0.0000000001*x^3=25 is claimed exact.")?.kind, "invalid");
const declared = synthesizeFamilyScene({ question: "A circle has center (3,-2) and radius 5.", families: ["coordinate_figure"] });
assert.ok(declared);
assert.ok(declared.renderScene.primitives.some((primitive) => primitive.text === "(x-3)²+(y+2)²=25"));
const unrelated = documentFor(origin);
unrelated.source.question = "A particle moves in a horizontal circle of radius 2 m with period 2 s.";
delete unrelated.source.circleSourceBinding;
assert.equal(extractCircleSource(String(unrelated.source.question)), null);
assert.equal(compileSceneDocument(unrelated).ok, true, "This guard must not reinterpret an unrelated physics/helper circle");
const derivedHelper = documentFor({ ...origin, question: "The circle x^2+y^2=25 has external point (10,0); construct the helper circumcircle through its center and its two tangency contacts.", point: [10, 0], distanceSquared: 100 });
derivedHelper.entities.push({ id: "T1", kind: "point", role: "derived tangency contact", label: "T1" }, { id: "T2", kind: "point", role: "derived tangency contact", label: "T2" }, { id: "H", kind: "circle", role: "derived circumcircle", label: "H" });
derivedHelper.constructions.push({ id: "contacts", operator: "circle_tangency_points", inputs: { circle: "locus", externalPoint: "P" }, outputs: ["T1", "T2"] }, { id: "helper", operator: "circle_from_three_points", inputs: { a: "C", b: "T1", c: "T2" }, outputs: ["H"] });
derivedHelper.requiredEntityIds.push("T1", "T2", "H");
derivedHelper.revealGroups[0]!.entityIds = [...derivedHelper.requiredEntityIds];
const helperResult = compileSceneDocument(derivedHelper);
assert.equal(helperResult.ok, true, JSON.stringify(helperResult.report));
assert.ok(helperResult.renderScene);
const sourceInk = helperResult.renderScene.primitives.find((primitive) => primitive.entityId === "locus" && primitive.kind === "circle")!;
const helperInk = helperResult.renderScene.primitives.find((primitive) => primitive.entityId === "H" && primitive.kind === "circle")!;
const radialInk = helperResult.renderScene.primitives.find((primitive) => primitive.entityId === "Q" && primitive.kind === "point")!;
close(helperInk.points[0]!.x, radialInk.points[0]!.x);
close(helperInk.points[0]!.y, radialInk.points[0]!.y);
close(helperInk.radius!, sourceInk.radius!);
writeFileSync(join(out, "derived-helper.svg"), renderSceneSvg(helperResult.renderScene, { title: String(derivedHelper.source.question), subtitle: "OFFLINE source C=(0,0), r=5; deterministic derived H=(5,0), r=5" }));
const reviewControls: Array<{ id: string; ok: boolean; guardHeld: boolean; nullScene?: boolean }> = [];
for (const unit of ["kg", "m", "cm"]) {
  for (const field of ["radius", "center"] as const) {
    const doc = documentFor(origin);
    doc.quantities.push({ id: "mutated_quantity", value: field === "radius" ? 5 : 0, unit });
    if (field === "radius") doc.constructions.find((construction) => construction.operator === "circle")!.inputs.radius = "mutated_quantity";
    else doc.constructions[0]!.inputs.x = "mutated_quantity";
    reviewControls.push({ id: `${field}_${unit}`, ok: compileSceneDocument(doc).ok, guardHeld: validateCircleSourceBinding(doc).some((issue) => issue.severity === "fatal") });
  }
  for (const axis of ["x", "y"] as const) {
    const doc = documentFor(cases.find((c) => c.id === "on")!);
    doc.quantities.push({ id: "mutated_member_quantity", value: axis === "x" ? 6 : 2, unit });
    doc.constructions.find((construction) => construction.outputs.includes("P"))!.inputs[axis] = "mutated_member_quantity";
    const compiled = compileSceneDocument(doc);
    reviewControls.push({ id: `member_${axis}_${unit}`, ok: compiled.ok, guardHeld: validateCircleSourceBinding(doc).some((issue) => issue.severity === "fatal"), nullScene: compiled.renderScene === null });
  }
}
const extraPrimitive = documentFor(origin);
extraPrimitive.entities.push({ id: "extra", kind: "circle", role: "helper" });
extraPrimitive.constructions.push({ id: "make_extra", operator: "circle", inputs: { center: "C", radius: 5 }, outputs: ["extra"] });
extraPrimitive.requiredEntityIds.push("extra");
extraPrimitive.revealGroups[0]!.entityIds = [...extraPrimitive.requiredEntityIds];
reviewControls.push({ id: "unowned_extra_primitive", ok: compileSceneDocument(extraPrimitive).ok, guardHeld: validateCircleSourceBinding(extraPrimitive).some((issue) => issue.severity === "fatal") });
delete extraPrimitive.source.circleSourceBinding;
reviewControls.push({ id: "ambiguous_extra_primitive", ok: compileSceneDocument(extraPrimitive).ok, guardHeld: validateCircleSourceBinding(extraPrimitive).some((issue) => issue.severity === "fatal") });
const inventedDerived: SceneDocument = JSON.parse(JSON.stringify(derivedHelper));
inventedDerived.constructions.find((construction) => construction.id === "helper")!.inputs = { a: [10, 0], b: [11, 0], c: [10, 1] };
reviewControls.push({ id: "unsourced_derived_circle", ok: compileSceneDocument(inventedDerived).ok, guardHeld: validateCircleSourceBinding(inventedDerived).some((issue) => issue.severity === "fatal") });
const falseOwner: SceneDocument = JSON.parse(JSON.stringify(derivedHelper));
falseOwner.source.circleSourceBinding = { locusId: "H" };
reviewControls.push({ id: "derived_helper_claimed_as_source_owner", ok: compileSceneDocument(falseOwner).ok, guardHeld: validateCircleSourceBinding(falseOwner).some((issue) => issue.severity === "fatal") });
writeFileSync(join(out, "ownership-unit-controls.json"), JSON.stringify(reviewControls, null, 2));
for (const control of reviewControls) {
  checks++;
  assert.equal(control.ok, false, `${control.id}: must hold rather than silently reinterpret or ignore units`);
  assert.equal(control.guardHeld, true, `${control.id}: source guard must hold independently of structural/render failures`);
  if (control.id.startsWith("member_")) assert.equal(control.nullScene, true, `${control.id}: no partial membership scene may render`);
}
for (const independent of [
  { question: "The circle (x-2)^2+(y+1)^2=25 has a point (5,3).", center: [2, -1], radius: 5, point: [5, 3] },
  { question: "The circle x^2+y^2-6x+8y=0 has a point (6,0).", center: [3, -4], radius: 5, point: [6, 0] },
]) {
  const curve = findStatedCurves(independent.question).find((candidate) => candidate.kind === "circle");
  assert.ok(curve);
  close(curve.anchor!.x, independent.center[0]!);
  close(curve.anchor!.y, independent.center[1]!);
  close(curve.radius!, independent.radius);
  close((independent.point[0]! - independent.center[0]!) ** 2 + (independent.point[1]! - independent.center[1]!) ** 2, 25);
}
close((3 - 3) ** 2 + (-2 + 2) ** 2, 0);
assert.notEqual((4 - 3) ** 2 + (-2 + 2) ** 2, 0);
writeFileSync(join(out, "results.json"), JSON.stringify({ state: "OFFLINE_QUALIFICATION_NOT_ACCEPTED", checks, cases: results, sourceGuardGaps, remaining: ["source binding integration", "explicit zero-radius source representation", "S0/S3/CH-06a prerequisite acceptance", "independent integration", "actual student save/reopen/replay"] }, null, 2));
console.log(JSON.stringify({ checks, cases: results, sourceGuardGaps, acceptedCountChange: 0 }, null, 2));
