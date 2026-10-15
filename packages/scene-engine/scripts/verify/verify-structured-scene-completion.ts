import assert from "node:assert/strict";
import {
  compileSceneDocument, completeSceneDocument, validateSceneDocument, validateTurnPlanV3,
  type RenderScene, type SceneCompletionResult, type SceneDocument, type TurnPlanV3,
} from "../../src/index";

interface BindingOracle {
  targetId: string;
  quantityIds: string[];
  numbers: number[];
  identifier?: string;
  unit?: string;
  kind?: SceneCompletionResult["additions"][number]["kind"];
  text?: string;
}
interface Fixture {
  id: string;
  document: SceneDocument;
  turnPlan: TurnPlanV3;
  expected: BindingOracle[];
  planValid: boolean;
  enabled?: boolean;
  solverAuthority?: unknown;
}
const clone = <T>(value: T): T => structuredClone(value);
const given = (id: string, symbol: string, value: number, unit?: string): TurnPlanV3["givens"][number] =>
  ({ id, symbol, value, ...(unit === undefined ? {} : { unit }), provenance: "given" });
const plan = (question: string, givens: TurnPlanV3["givens"]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
});
function document(question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit given structure" },
    source: { question }, quantities: [],
    entities: [{ id: "L", kind: "point", role: "reference point" }, { id: "R", kind: "point", role: "reference point" },
      { id: "reference", kind: "segment", role: "reference segment" }],
    constructions: [
      { id: "makeL", operator: "point", inputs: { x: -6, y: -4, coordinateSpace: "world" }, outputs: ["L"] },
      { id: "makeR", operator: "point", inputs: { x: 7, y: 5, coordinateSpace: "world" }, outputs: ["R"] },
      { id: "makeReference", operator: "segment", inputs: { start: "L", end: "R" }, outputs: ["reference"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["reference"],
    revealGroups: [{ id: "setup", entityIds: ["L", "R", "reference"], dependsOn: [], narrationCue: "Show the given structure." }],
    teachingTimeline: [],
  };
}
function pointFixture(id: string): Fixture {
  const question = "Show point A with its given coordinates (2, -3).";
  const quantities = [given("xA", "x_A", 2), given("yA", "y_A", -3)];
  const doc = document(question);
  doc.quantities = clone(quantities);
  doc.entities.push({ id: "A", kind: "point", role: "given point", label: "A" });
  doc.constructions.push({ id: "makeA", operator: "point", inputs: { x: "xA", y: "yA", coordinateSpace: "world" }, outputs: ["A"] });
  doc.requiredEntityIds.push("A"); doc.revealGroups[0]!.entityIds.push("A");
  return { id, document: doc, turnPlan: plan(question, quantities), expected: [
    { targetId: "A", quantityIds: ["xA", "yA"], numbers: [2, -3], identifier: "A" },
  ], planValid: true, enabled: true };
}
function scalarFixture(id: string, unit: string | null = "kg"): Fixture {
  const question = "Show the given body B and its stated scalar m = 7.5.";
  const quantity = given("mass", "m", 7.5, unit ?? undefined);
  const doc = document(question);
  doc.quantities = [clone(quantity)];
  doc.entities.push({ id: "center", kind: "point", role: "body center" }, { id: "body", kind: "rectangle", role: "body", label: "B" });
  doc.constructions.push(
    { id: "makeCenter", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "makeBody", operator: "rectangle", inputs: { center: "center", width: 2, height: 1 }, outputs: ["body"] },
  );
  doc.annotations.push({ id: "givenAttachment", kind: "callout", targetIds: ["body"], quantityId: "mass" });
  doc.requiredEntityIds.push("body"); doc.revealGroups[0]!.entityIds.push("center", "body");
  return { id, document: doc, turnPlan: plan(question, [quantity]), expected: [
    { targetId: "body", quantityIds: ["mass"], numbers: [7.5], identifier: "m", ...(unit ? { unit } : {}) },
  ], planValid: true, enabled: true };
}
function angleFixture(id: string): Fixture {
  const question = "Show the given angle θ = 45 degrees between OV and OH.";
  const quantity = given("theta", "θ", 45, "deg");
  const doc = document(question); doc.quantities = [clone(quantity)];
  doc.entities.push(...["O", "H", "V"].map(id => ({ id, kind: "point", role: "angle arm point" })),
    { id: "OH", kind: "segment", role: "angle arm" }, { id: "OV", kind: "segment", role: "angle arm" },
    { id: "arc", kind: "angle_mark", role: "given angle", label: "θ" });
  doc.constructions.push(
    ...[["O", 0, 0], ["H", 3, 0], ["V", 2, 2]].map(([id, x, y]) =>
      ({ id: `make${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [String(id)] })),
    { id: "makeOH", operator: "segment", inputs: { start: "O", end: "H" }, outputs: ["OH"] },
    { id: "makeOV", operator: "segment", inputs: { start: "O", end: "V" }, outputs: ["OV"] },
    { id: "makeArc", operator: "angle_mark", inputs: { vertex: "O", a: "OH", b: "OV" }, outputs: ["arc"] },
  );
  doc.annotations.push({ id: "angleAttachment", kind: "callout", targetIds: ["arc"], quantityId: "theta" });
  doc.assertions.push({ id: "sameArmProof", predicate: "angle_between", entities: ["OH", "OV"], expected: { value: 45, unit: "degree" }, severity: "fatal" });
  doc.requiredEntityIds.push("OH", "OV", "arc"); doc.revealGroups[0]!.entityIds.push("O", "H", "V", "OH", "OV", "arc");
  return { id, document: doc, turnPlan: plan(question, [quantity]), expected: [
    { targetId: "arc", quantityIds: ["theta"], numbers: [45], identifier: "θ", unit: "deg" },
  ], planValid: true, enabled: true };
}
function spaceFixture(id: string): Fixture {
  const question = "Show the given space point P(2, -1, 3) in its world frame.";
  const quantities = [given("px", "P_x", 2), given("py", "P_y", -1), given("pz", "P_z", 3)];
  const doc = document(question); doc.quantities = clone(quantities);
  doc.entities.push({ id: "O", kind: "point", role: "frame origin" }, { id: "frame", kind: "polyline", role: "world frame" },
    { id: "P", kind: "point", role: "given space point", label: "P" });
  doc.constructions.push(
    { id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "makeFrame", operator: "space_frame", inputs: { origin: "O", scale: 1 }, outputs: ["frame"] },
    { id: "makeP", operator: "space_point", inputs: { frame: "frame", x: "px", y: "py", z: "pz" }, outputs: ["P"] },
  );
  doc.requiredEntityIds.push("frame", "P"); doc.revealGroups[0]!.entityIds.push("O", "frame", "P");
  return { id, document: doc, turnPlan: plan(question, quantities), expected: [
    { targetId: "P", quantityIds: ["px", "py", "pz"], numbers: [2, -1, 3], identifier: "P" },
  ], planValid: true, enabled: true };
}
function parameterFixture(id: string): Fixture {
  const question = "Show the given parameter t = 0.5 on the curve y=x^2.";
  const quantity = given("parameter", "t", 0.5);
  const doc = document(question); doc.quantities = [clone(quantity)];
  doc.entities.push({ id: "curve", kind: "polyline", role: "given analytic curve" },
    { id: "anchor", kind: "point", role: "given parameter anchor", label: "P" });
  doc.constructions.push(
    { id: "makeCurve", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2, samples: 65 }, outputs: ["curve"] },
    { id: "makeAnchor", operator: "curve_anchor", inputs: { curve: "curve", at: "parameter" }, outputs: ["anchor"] },
  );
  doc.requiredEntityIds.push("curve", "anchor"); doc.revealGroups[0]!.entityIds.push("curve", "anchor");
  return { id, document: doc, turnPlan: plan(question, [quantity]), expected: [
    { targetId: "anchor", quantityIds: ["parameter"], numbers: [0.5], identifier: "t" },
  ], planValid: true, enabled: true };
}
const fixtures: Fixture[] = [];
const add = (fixture: Fixture) => { fixtures.push(fixture); return fixture; };
add(pointFixture("exact-world-coordinate-ids"));
const off = add(pointFixture("explicit-flag-off-reference-parity")); off.enabled = false; off.expected = [];
const omitted = add(pointFixture("omitted-flag-reference-parity")); delete omitted.enabled; omitted.expected = [];
const wrapped = add(pointFixture("bounded-coordinate-value-wrappers"));
wrapped.document.constructions.at(-1)!.inputs = { x: { value: "xA" }, y: { value: "yA" }, coordinateSpace: "world" };
const literal = add(pointFixture("equal-numbers-without-source-ids"));
literal.document.constructions.at(-1)!.inputs = { x: 2, y: -3, coordinateSpace: "world" }; literal.expected = [];
const otherId = add(pointFixture("equal-value-symbol-different-id"));
otherId.document.quantities = otherId.document.quantities.map(q => ({ ...q, id: `${q.id}_other` }));
otherId.document.constructions.at(-1)!.inputs = { x: "xA_other", y: "yA_other", coordinateSpace: "world" }; otherId.expected = [];
const swapped = add(pointFixture("equal-coordinate-values-distinct-owners"));
const xb = given("xB", "x_B", 2), yb = given("yB", "y_B", -3);
swapped.turnPlan.givens.push(xb, yb); swapped.document.quantities.push(clone(xb), clone(yb));
swapped.document.entities.push({ id: "B", kind: "point", role: "second given point", label: "B" });
// Equal coordinates are intentional. Ownership must remain with each exact ID pair.
swapped.document.constructions.push({ id: "makeB", operator: "point", inputs: { x: "xB", y: "yB", coordinateSpace: "world" }, outputs: ["B"] });
swapped.document.requiredEntityIds.push("B"); swapped.document.revealGroups[0]!.entityIds.push("B");
swapped.expected.push({ targetId: "B", quantityIds: ["xB", "yB"], numbers: [2, -3], identifier: "B" });
const layout = add(pointFixture("layout-coordinates-have-no-world-authority"));
layout.document.constructions.at(-1)!.inputs.coordinateSpace = "layout";
layout.document.source.question = "Show a layout marker A.";
layout.turnPlan.question = String(layout.document.source.question);
layout.document.quantities[0]!.value = 600; layout.turnPlan.givens[0]!.value = 600;
layout.document.quantities[1]!.value = 300; layout.turnPlan.givens[1]!.value = 300;
layout.expected = [];
add(scalarFixture("unique-inherited-given-attachment"));
add(scalarFixture("missing-unit-stays-missing", null));
add(spaceFixture("space-tuple-keeps-source-components-and-frame"));
const scaledFrame = add(spaceFixture("space-frame-display-scale-does-not-scale-tuple"));
scaledFrame.document.constructions.find(item => item.id === "makeFrame")!.inputs.scale = 0.4;
add(parameterFixture("curve-anchor-restates-parameter-not-derived-height"));
const primeOwner = add(scalarFixture("old-prime-label-text-and-owner-survive"));
primeOwner.document.entities.find(entity => entity.id === "body")!.label = "f′";
const membershipOwner = add(scalarFixture("old-membership-label-text-and-owner-survive"));
membershipOwner.document.entities.find(entity => entity.id === "body")!.label = "x,y ∈ ℕ";
const complete = add(scalarFixture("already-rendered-given-label-does-not-duplicate"));
complete.document.entities.push({ id: "existingGiven", kind: "label", role: "given statement", label: "m = 7.5 kg" });
complete.document.constructions.push({ id: "makeExistingGiven", operator: "label", inputs: { target: "body", text: "m = 7.5 kg" }, outputs: ["existingGiven"] });
complete.document.requiredEntityIds.push("existingGiven"); complete.document.revealGroups[0]!.entityIds.push("existingGiven"); complete.expected = [];
for (const [id, field, value] of [
  ["same-id-wrong-value", "value", 8.5], ["same-id-wrong-sign", "value", -7.5],
  ["same-id-wrong-unit", "unit", "g"], ["unit-prefix-case-is-significant", "unit", "Kg"],
  ["same-id-wrong-symbol", "symbol", "M"], ["scene-missing-declared-unit", "unit", undefined],
] as const) {
  const mismatch = add(scalarFixture(id)); mismatch.document.quantities[0]![field] = value; mismatch.expected = [];
}
const noSceneUnit = add(scalarFixture("plan-missing-scene-unit", null));
noSceneUnit.document.quantities[0]!.unit = "kg"; noSceneUnit.expected = [];
const ambiguous = add(scalarFixture("multi-target-attachment-is-ambiguous"));
ambiguous.document.annotations[0]!.targetIds.push("reference"); ambiguous.expected = [];
const conflict = add(scalarFixture("conflicting-single-target-attachments"));
conflict.document.annotations.push({ id: "otherAttachment", kind: "callout", targetIds: ["reference"], quantityId: "mass" }); conflict.expected = [];
const textOnly = add(scalarFixture("symbol-and-prose-do-not-bind-owner"));
textOnly.document.annotations = []; textOnly.document.entities.find(entity => entity.id === "body")!.label = "m"; textOnly.expected = [];
const repeated = add(scalarFixture("duplicate-compatible-attachment-is-one-label"));
repeated.document.annotations.push({ ...clone(repeated.document.annotations[0]!), id: "repeatedAttachment" });
const duplicate = add(scalarFixture("duplicate-plan-id-is-invalid"));
duplicate.turnPlan.givens.push(clone(duplicate.turnPlan.givens[0]!)); duplicate.planValid = false; duplicate.expected = [];
const invalidProvenance = add(scalarFixture("derived-entry-in-givens-is-invalid"));
invalidProvenance.turnPlan.givens[0]!.provenance = "derived"; invalidProvenance.planValid = false; invalidProvenance.expected = [];
const wrongQuestion = add(scalarFixture("different-plan-question-is-invalid"));
wrongQuestion.turnPlan.question = "A different source question."; wrongQuestion.planValid = false; wrongQuestion.expected = [];
const unresolved = add(scalarFixture("unresolved-numeric-unknown-plan-skips"));
unresolved.turnPlan.givens = []; unresolved.turnPlan.unknowns = [{ id: "mass", symbol: "m", unit: "kg" }];
unresolved.planValid = false; unresolved.expected = [];
const resolved = add(scalarFixture("resolved-unknown-is-not-question-mark-authority"));
resolved.turnPlan.unknowns = [{ id: "mass", symbol: "m", unit: "kg" }];
resolved.turnPlan.derived = [{ ...resolved.turnPlan.givens[0]!, provenance: "derived", dependsOn: [] }];
resolved.turnPlan.givens = []; resolved.expected = [];
const projection = add(scalarFixture("projection-does-not-authorize-derived-label-or-force"));
projection.turnPlan.derived = [{ ...projection.turnPlan.givens[0]!, provenance: "derived", dependsOn: [] }];
projection.turnPlan.givens = []; projection.expected = [];
projection.solverAuthority = { status: "verified", quantities: [{ id: "mass", value: 7.5, unit: "kg" }], lawIds: ["newton_second_law"] };
add(angleFixture("given-angle-with-existing-same-arm-proof"));
const noProof = add(angleFixture("angle-attachment-without-measurement-proof")); noProof.document.assertions = []; noProof.expected = [];
const wrongArms = add(angleFixture("angle-proof-for-other-arms-does-not-transfer"));
wrongArms.document.assertions[0]!.entities = ["OH", "reference"]; wrongArms.document.assertions[0]!.expected = { value: Math.atan2(9, 13) * 180 / Math.PI, unit: "degree" };
wrongArms.expected = [];
const wrongAngleUnit = add(angleFixture("degree-slot-cannot-borrow-radian-unit"));
wrongAngleUnit.turnPlan.givens[0]!.unit = "rad"; wrongAngleUnit.document.quantities[0]!.unit = "rad"; wrongAngleUnit.expected = [];

// Reduced native incidence structure: the complete source IDs own the
// existing incident/normal mark. Fixtures are oracles, never runtime routing.
function incidenceFixture(id: string, duplicateArm: boolean): Fixture {
  const question = "Draw the given flat-boundary incidence setup for n_g = 1.52, n_w = 1.33 and i = 37 degrees.";
  const quantities = [given("n_g", "n_g", 1.52), given("n_w", "n_w", 1.33), given("i", "i", 37, "°")];
  const doc: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question },
    visualDecision: { mode: "scene", reason: "source-given native incidence setup" }, quantities: clone(quantities),
    entities: [
      { id: "interface", kind: "line", role: "interface" },
      { id: "O", kind: "point", role: "point of incidence", label: "O" },
      { id: "incident", kind: "ray", role: "incident" },
      { id: "normal", kind: "vector", role: "normal" },
      { id: "refracted", kind: "ray", role: "refracted" },
      { id: "incidenceAngle", kind: "angle_mark", role: "angle of incidence", label: "i" },
      { id: "L", kind: "point", role: "construction helper" },
    ],
    constructions: [
      { id: "makeL", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["L"] },
      { id: "makeInterface", operator: "line", inputs: { start: "L", direction: [1, 0] }, outputs: ["interface"] },
      { id: "makeO", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "makeRays", operator: "refract_at", inputs: { point: "O", surface: "interface", incidentAngleDeg: "i", n1: "n_g", n2: "n_w", span: 2 }, outputs: ["incident", "normal", "refracted"] },
      { id: "markIncidence", operator: "angle_mark", inputs: { vertex: "O", a: "incident", b: duplicateArm ? "incident" : "normal", radius: 0.55 }, outputs: ["incidenceAngle"] },
    ], relations: [], assertions: [
      { id: "contact", predicate: "on", entities: ["O", "interface"], expected: true, severity: "fatal" },
      { id: "surfaceNormal", predicate: "perpendicular", entities: ["normal", "interface"], expected: true, severity: "fatal" },
      { id: "refractionLaw", predicate: "snells_law", entities: ["incident", "normal", "refracted"], expected: { n1: 1.52, n2: 1.33 }, severity: "fatal" },
    ], annotations: [], requiredEntityIds: ["interface", "O", "incident", "normal", "refracted", "incidenceAngle"],
    revealGroups: [{ id: "setup", entityIds: ["interface", "O", "incident", "normal", "refracted", "incidenceAngle"], dependsOn: [], narrationCue: "Show the given interface and incidence mark." }],
    teachingTimeline: [],
  };
  return { id, document: doc, turnPlan: plan(question, quantities), enabled: true, planValid: true,
    expected: duplicateArm ? [] : [{ targetId: "incidenceAngle", quantityIds: ["i"], numbers: [37], identifier: "i", unit: "°" }] };
}
const incidenceFixtures = [
  incidenceFixture("native-incidence-distinct-arm-given-label", false),
  incidenceFixture("native-incidence-duplicate-arm-cannot-borrow-distinct-pair-proof", true),
];
fixtures.push(...incidenceFixtures);

// A validated qualitative unknown stays eligible without inventing a number.
// Existing resolved target-owned text, including native anchor aliases, blocks
// a contradictory new question-mark statement on the same referent.
function unknownFixture(id: string, oldBodyText: string, nativeAnchor?: "target" | "at" | "point", givenHasUnknownSymbol = false): Fixture {
  const question = givenHasUnknownSymbol
    ? "A known body has mass m = 5 kg. The mass m of the other body is undetermined. Draw the other body."
    : "A known body has mass M = 5 kg. The mass m of the other body is undetermined. Draw the other body.";
  const turnPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question,
    givens: [given("knownMass", givenHasUnknownSymbol ? "m" : "M", 5, "kg")],
    unknowns: [{ id: "mass", symbol: "m", unit: "kg" }], derived: [],
    qualitativeClaims: [{ id: "undeterminedMass", claim: "The mass m is undetermined", expected: "undetermined", relatedQuantityIds: ["mass"] }],
    lawIds: [], assumptions: [], visualRequirement: "required",
  };
  const doc: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "The other body with its inherited unresolved mass attachment" },
    source: { question, nonMetric: true, representationTier: "qualitative" },
    quantities: [{ id: "mass", symbol: "m", unit: "kg" }],
    entities: [{ id: "center", kind: "point", role: "schematic center" },
      { id: "body", kind: "rectangle", role: "other body", label: oldBodyText }],
    constructions: [
      { id: "makeCenter", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
      { id: "makeBody", operator: "rectangle", inputs: { center: "center", width: 2, height: 1 }, outputs: ["body"] },
    ], relations: [], assertions: [{ id: "bodyExists", predicate: "exists", entities: ["body"], expected: true, severity: "fatal" }],
    annotations: [{ id: "unknownEdge", kind: "callout", targetIds: ["body"], quantityId: "mass" }], requiredEntityIds: ["body"],
    revealGroups: [{ id: "setup", entityIds: ["center", "body"], dependsOn: [], narrationCue: "Show the body." }], teachingTimeline: [],
  };
  if (nativeAnchor) {
    doc.entities.push({ id: "existingValue", kind: "label", role: "inherited resolved statement", label: "m=5kg" });
    doc.constructions.push({ id: "makeExistingValue", operator: "label", inputs: { [nativeAnchor]: "body", text: "m=5kg" }, outputs: ["existingValue"] });
    doc.requiredEntityIds.push("existingValue"); doc.revealGroups[0]!.entityIds.push("existingValue");
  }
  const eligible = oldBodyText === "B" && !nativeAnchor && !givenHasUnknownSymbol;
  return { id, document: doc, turnPlan, enabled: true, planValid: true,
    expected: eligible ? [{ targetId: "body", quantityIds: ["mass"], numbers: [], identifier: "m", unit: "kg", kind: "unknown_label", text: "m = ? kg" }] : [] };
}
const unknownOwnershipFixtures = [
  unknownFixture("qualitative-unresolved-unknown-body-identifier-positive", "B"),
  unknownFixture("unknown-does-not-contradict-existing-numeric-body-text", "m=5kg"),
  unknownFixture("unknown-does-not-contradict-native-target-label-text", "B", "target"),
  unknownFixture("unknown-does-not-contradict-native-at-label-text", "B", "at"),
  unknownFixture("unknown-does-not-contradict-native-point-label-text", "B", "point"),
  unknownFixture("unknown-symbol-already-given-under-different-id-skips", "B", undefined, true),
];
fixtures.push(...unknownOwnershipFixtures);

interface NativeLabelFixture {
  id: string;
  base: SceneDocument;
  proposal: SceneDocument;
  expectedValid: boolean;
}
function nativeLabelFixture(id: string, vector: boolean, frame: "correct" | "missing" | "wrong", planarConsumer = false): NativeLabelFixture {
  const base = clone(spaceFixture(id).document);
  base.entities.push({ id: "Z", kind: "point", role: "world origin point" });
  base.constructions.push({ id: "makeZ", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["Z"] });
  base.requiredEntityIds.push("Z"); base.revealGroups[0]!.entityIds.push("Z");
  if (vector) {
    base.entities.push({ id: "v", kind: "vector", role: "given world vector" }, { id: "M", kind: "point", role: "known world midpoint" });
    base.constructions.push(
      { id: "makeV", operator: "space_vector", inputs: { frame: "frame", start: "Z", end: "P" }, outputs: ["v"] },
      { id: "makeM", operator: "space_point", inputs: { frame: "frame", x: 1, y: -0.5, z: 1.5 }, outputs: ["M"] },
    );
    base.requiredEntityIds.push("v", "M"); base.revealGroups[0]!.entityIds.push("v", "M");
  }
  if (frame === "wrong") {
    base.entities.push({ id: "otherFrame", kind: "polyline", role: "different world frame" });
    base.constructions.push({ id: "makeOtherFrame", operator: "space_frame", inputs: { origin: "R", scale: 0.7 }, outputs: ["otherFrame"] });
    base.requiredEntityIds.push("otherFrame"); base.revealGroups[0]!.entityIds.push("otherFrame");
  }
  const proposal = clone(base), target = vector ? "v" : "P", text = vector ? "given v" : "given P";
  proposal.entities.push({ id: "worldLabel", kind: "label", role: "native anchored world label", label: text });
  proposal.constructions.push({ id: "makeWorldLabel", operator: "label", inputs: {
    target, text, ...(frame === "missing" ? {} : { frame: frame === "correct" ? "frame" : "otherFrame" }),
  }, outputs: ["worldLabel"] });
  proposal.requiredEntityIds.push("worldLabel"); proposal.revealGroups[0]!.entityIds.push("worldLabel");
  // A zero numerator over a nonzero same-world denominator proves the actual
  // 3D anchor, not the projected screen point. Dropping .space/frame metadata
  // must make this fatal native assertion invalid through mixed-world operands.
  const exactAnchor = vector ? "M" : "P";
  proposal.assertions.push({ id: "worldAnchorDistanceZero", predicate: "distance_ratio",
    entities: ["worldLabel", exactAnchor, exactAnchor, "Z"], expected: 0, severity: "fatal" });
  if (planarConsumer) {
    proposal.entities.push({ id: "illegalPlanar", kind: "segment", role: "unpermitted flattened world descendant" });
    proposal.constructions.push({ id: "makeIllegalPlanar", operator: "segment", inputs: { start: "worldLabel", end: "R" }, outputs: ["illegalPlanar"] });
    proposal.requiredEntityIds.push("illegalPlanar"); proposal.revealGroups[0]!.entityIds.push("illegalPlanar");
  }
  return { id, base, proposal, expectedValid: frame === "correct" && !planarConsumer };
}
const nativeLabelFixtures: NativeLabelFixture[] = [
  nativeLabelFixture("native-world-point-label-explicit-frame-and-distance-proof", false, "correct"),
  nativeLabelFixture("native-world-vector-label-explicit-frame-and-midpoint-proof", true, "correct"),
  nativeLabelFixture("native-world-point-label-missing-frame-still-rejects", false, "missing"),
  nativeLabelFixture("native-world-vector-label-missing-frame-still-rejects", true, "missing"),
  nativeLabelFixture("native-world-point-label-wrong-frame-rejects", false, "wrong"),
  nativeLabelFixture("native-world-vector-label-wrong-frame-rejects", true, "wrong"),
  nativeLabelFixture("native-world-label-cannot-flatten-into-planar-segment", false, "correct", true),
];

// Export complete literal inputs/oracles before any compiler/completion calls.
if (process.argv.includes("--print-unknown-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "unknown-owned-text-completion-fixtures/v1", fixtures: unknownOwnershipFixtures }, null, 2));
} else if (process.argv.includes("--print-prior-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-public-fixtures/v1", fixtures: fixtures.slice(0, 39) }, null, 2));
} else if (process.argv.includes("--print-incidence-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "native-incidence-completion-fixtures/v1", fixtures: incidenceFixtures }, null, 2));
} else if (process.argv.includes("--print-original-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-public-fixtures/v1", fixtures: fixtures.slice(0, 37) }, null, 2));
} else if (process.argv.includes("--print-native-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "native-world-label-fixtures/v1", fixtures: nativeLabelFixtures }, null, 2));
} else if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify({ schemaVersion: "structured-completion-public-fixtures/v1", fixtures }, null, 2));
} else {
  let checks = 0, failed = 0;
  const run = (name: string, body: () => void) => {
    checks += 1;
    try { body(); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  function retained(base: SceneDocument, next: SceneDocument): void {
    for (const key of ["entities", "constructions", "annotations", "assertions", "requiredEntityIds"] as const)
      assert.deepEqual(next[key].slice(0, base[key].length), base[key], `changed existing ${key}`);
    for (const key of ["source", "quantities", "visualDecision", "relations", "teachingTimeline"] as const)
      assert.deepEqual(next[key], base[key], `changed existing ${key}`);
    const oldIds = new Set(base.entities.map(entity => entity.id));
    base.revealGroups.forEach((group, index) => {
      const proposed = next.revealGroups[index]!;
      assert.deepEqual({ ...proposed, entityIds: group.entityIds }, group, "changed old reveal metadata");
      assert.deepEqual(proposed.entityIds.slice(0, group.entityIds.length), group.entityIds, "changed old reveal membership");
      assert.ok(proposed.entityIds.slice(group.entityIds.length).every(id => !oldIds.has(id)), "re-owned an old entity through reveal suffix");
    });
    for (const group of next.revealGroups.slice(base.revealGroups.length)) assert.ok(group.entityIds.every(id => !oldIds.has(id)), "new group re-owned old entity");
  }
  function nativeInk(base: RenderScene, result: SceneCompletionResult): RenderScene {
    const normalized = validateSceneDocument(result.document);
    assert.ok(normalized.document, JSON.stringify(normalized.report.issues));
    const compiled = compileSceneDocument(normalized.document);
    assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    for (const old of base.primitives) {
      if (old.kind === "label") assert.ok(compiled.renderScene.primitives.some(next => next.kind === "label" &&
        next.entityId === old.entityId && next.text === old.text && next.groupId === old.groupId), `old label lost or re-owned: ${old.text}`);
      else if (old.provenance?.labelLeader !== true) assert.deepEqual(compiled.renderScene.primitives.find(next => next.id === old.id), old, `old geometry changed: ${old.id}`);
    }
    for (const addition of result.additions) {
      assert.ok(result.addedEntityIds.includes(addition.id), "addition missing declared new entity ID");
      const constructors = normalized.document.constructions.filter(item => item.outputs.includes(addition.id));
      assert.equal(constructors.length, 1); assert.equal(constructors[0]!.operator, "label");
      assert.equal(addition.targetIds.length, 1); assert.equal(constructors[0]!.inputs.target, addition.targetIds[0]);
      assert.equal(constructors[0]!.inputs.text, addition.text);
      assert.ok(compiled.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.entityId === addition.id && primitive.text === addition.text), "metadata addition did not survive as its own native ink");
    }
    return compiled.renderScene;
  }
  for (const fixture of process.argv.includes("--native-only") ? [] : fixtures) run(fixture.id, () => {
    const doc = clone(fixture.document), turnPlan = clone(fixture.turnPlan);
    assert.equal(validateTurnPlanV3(turnPlan, String(doc.source.question)).valid, fixture.planValid, "fixture plan validity differs from independently frozen expectation");
    const validated = validateSceneDocument(doc); assert.ok(validated.document, JSON.stringify(validated.report.issues));
    const compiled = compileSceneDocument(validated.document); assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    const before = clone({ document: validated.document, turnPlan, render: compiled.renderScene });
    const result = completeSceneDocument(validated.document, { enabled: fixture.enabled, turnPlan, baseRenderScene: compiled.renderScene, solverAuthority: fixture.solverAuthority });
    assert.deepEqual({ document: validated.document, turnPlan, render: compiled.renderScene }, before, "mutated caller inputs");
    retained(before.document, result.document);
    if (fixture.enabled !== true) {
      assert.equal(result.document, validated.document, "off must preserve reference identity");
      assert.deepEqual(result.addedEntityIds, []); assert.deepEqual(result.addedAnnotationIds, []);
      assert.deepEqual(result.additions, []); assert.deepEqual(result.skipped, []); return;
    }
    if (!fixture.expected.length) {
      assert.deepEqual(result.document, validated.document, "ambiguous/unavailable authority changed document");
      assert.deepEqual(result.additions, []); assert.deepEqual(result.addedEntityIds, []); assert.deepEqual(result.addedAnnotationIds, []); return;
    }
    for (const expected of fixture.expected) {
      const matches = result.additions.filter(addition => addition.targetIds.length === 1 && addition.targetIds[0] === expected.targetId &&
        expected.quantityIds.every(id => addition.quantityIds.includes(id)));
      assert.equal(matches.length, 1, `missing unique legitimate given label for ${expected.targetId}/${expected.quantityIds.join(",")}`);
      const addition = matches[0]!; assert.deepEqual([...addition.quantityIds].sort(), [...expected.quantityIds].sort(), "borrowed another source quantity ID");
      if (expected.kind) assert.equal(addition.kind, expected.kind, "wrong source statement kind");
      if (expected.text) assert.equal(addition.text, expected.text, "unknown statement changed its source symbol/unit/meaning");
      assert.equal(typeof addition.text, "string");
      const text = addition.text!.replace(/−/g, "-");
      const numbers = (text.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
      let matched = 0;
      for (const number of numbers) if (number === expected.numbers[matched]) matched += 1;
      assert.equal(matched, expected.numbers.length, `source values/signs missing or out of tuple order: ${expected.numbers.join(",")}`);
      if (expected.identifier) assert.ok(text.includes(expected.identifier), `original identifier missing: ${expected.identifier}`);
      if (expected.unit) assert.ok(text.includes(expected.unit), `source unit missing or case changed: ${expected.unit}`);
    }
    assert.equal(result.additions.length, fixture.expected.length, "unrequested/derived/force addition");
    const nextRender = nativeInk(compiled.renderScene, result);
    const second = completeSceneDocument(result.document, { enabled: true, turnPlan, baseRenderScene: nextRender });
    assert.deepEqual(second.document, result.document, "completion not idempotent");
    assert.deepEqual(second.additions, []); assert.deepEqual(second.addedEntityIds, []); assert.deepEqual(second.addedAnnotationIds, []);
  });
  for (const fixture of nativeLabelFixtures) run(fixture.id, () => {
    const base = compileSceneDocument(fixture.base);
    assert.ok(base.ok && base.renderScene, `native fixture baseline: ${JSON.stringify(base.report.issues)}`);
    const before = clone(fixture.proposal);
    const proposed = compileSceneDocument(fixture.proposal);
    assert.deepEqual(fixture.proposal, before, "native label compilation mutated input document");
    assert.equal(proposed.ok, fixture.expectedValid, JSON.stringify(proposed.report.issues));
    if (!fixture.expectedValid) { assert.equal(proposed.renderScene, null, "invalid world label leaked partial ink"); return; }
    assert.ok(proposed.renderScene);
    assert.ok(proposed.renderScene.primitives.some(primitive => primitive.entityId === "worldLabel" && primitive.kind === "label"), "framed world label did not produce its own native ink");
    assert.ok(!proposed.report.issues.some(issue => issue.severity === "fatal"), "world anchor distance proof failed");
    for (const old of base.renderScene.primitives.filter(primitive => primitive.kind !== "label" && primitive.provenance?.labelLeader !== true))
      assert.deepEqual(proposed.renderScene.primitives.find(primitive => primitive.id === old.id), old, `world label changed owner geometry: ${old.id}`);
  });
  console.log(`structured-scene completion: ${checks - failed}/${checks} fixtures passed`);
  if (failed) process.exitCode = 1;
}
