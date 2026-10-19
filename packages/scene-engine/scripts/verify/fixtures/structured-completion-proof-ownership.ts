import type { SceneDocument } from "../../../src/types";
import type { TurnPlanV3 as Plan } from "../../../src/contracts/contractsV3";

export interface CompletionOwnershipFixture {
  id: string;
  document: SceneDocument;
  turnPlan: Plan;
  expectedAdditions: number;
  annotationOnly?: boolean;
  expectedText?: string;
}

function base(question: string, givens: Plan["givens"]): { document: SceneDocument; turnPlan: Plan } {
  return {
    turnPlan: { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" },
    document: { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "independent source-owned completion fixture" },
      quantities: structuredClone(givens), entities: [], constructions: [], annotations: [], relations: [], assertions: [], requiredEntityIds: [],
      revealGroups: [{ id: "given", entityIds: [], dependsOn: [], narrationCue: "Show the source givens." }], teachingTimeline: [] },
  };
}
function own(document: SceneDocument): void {
  for (const construction of document.constructions) construction.id = `construct_${construction.id}`;
  document.requiredEntityIds = document.entities.map(entity => entity.id);
  document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
}
export function coordinateFixture(id: string, options: { nonMetric?: boolean; wrapperUnit?: string; label?: string; partial?: boolean; oldText?: string; unit?: string } = {}): CompletionOwnershipFixture {
  const givens: Plan["givens"] = [{ id: "px", symbol: "x_P", value: 2, provenance: "given", ...(options.unit ? { unit: options.unit } : {}) },
    { id: "py", symbol: "y_P", value: -3, provenance: "given", ...(options.unit ? { unit: options.unit } : {}) }];
  const fixture = base(`Show point ${options.label ?? "P"} with given coordinates (2, -3).`, givens), doc = fixture.document;
  if (options.nonMetric) doc.source.nonMetric = true;
  doc.entities.push({ id: "L", kind: "point", role: "frame reference" }, { id: "R", kind: "point", role: "frame reference" },
    { id: "reference", kind: "segment", role: "reference" }, { id: "P", kind: "point", role: "source point", label: options.label ?? "P" });
  doc.constructions.push({ id: "L", operator: "point", inputs: { x: -5, y: -4 }, outputs: ["L"] },
    { id: "R", operator: "point", inputs: { x: 5, y: 4 }, outputs: ["R"] },
    { id: "reference", operator: "segment", inputs: { start: "L", end: "R" }, outputs: ["reference"] },
    { id: "P", operator: "point", inputs: { x: options.wrapperUnit ? { value: "px", unit: options.wrapperUnit } : "px", y: options.partial ? -3 : options.wrapperUnit ? { value: "py", unit: options.wrapperUnit } : "py", coordinateSpace: "world" }, outputs: ["P"] });
  if (options.oldText) {
    doc.entities.push({ id: "old", kind: "label", role: "existing exact tuple", label: options.oldText });
    doc.constructions.push({ id: "old", operator: "label", inputs: { target: "P", text: options.oldText }, outputs: ["old"] });
  }
  own(doc);
  return { id, ...fixture, expectedAdditions: options.nonMetric || options.wrapperUnit || options.label === "3i" || options.oldText ? 0 : 1 };
}
export function curveFixture(id: string, nonMetric: boolean): CompletionOwnershipFixture {
  const fixture = base("Show the source parameter t=0.5 on y=x^2.", [{ id: "t", symbol: "t", value: 0.5, provenance: "given" }]), doc = fixture.document;
  if (nonMetric) doc.source.nonMetric = true;
  doc.entities.push({ id: "curve", kind: "polyline", role: "source function" }, { id: "P", kind: "point", role: "parameter point", label: "P" });
  doc.constructions.push({ id: "curve", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2 }, outputs: ["curve"] },
    { id: "P", operator: "curve_anchor", inputs: { curve: "curve", at: "t" }, outputs: ["P"] });
  own(doc);
  return { id, ...fixture, expectedAdditions: nonMetric ? 0 : 1 };
}
export function attachmentFixture(id: string, target: "arc" | "arm" | "O" | "body", options: { length?: boolean; wrongAngle?: boolean; ownerLabel?: string; symbol?: string; oldText?: string; value?: number; unit?: string } = {}): CompletionOwnershipFixture {
  const angle = target !== "body" && !options.length;
  const symbol = options.symbol ?? (angle ? "θ" : options.length ? "AB" : "m");
  const value = options.value ?? (angle ? options.wrongAngle ? 30 : 45 : options.length ? 4 : 2);
  const unit = options.unit ?? (angle ? "deg" : options.length ? "cm" : "kg");
  const fixture = base(`Show the given ${symbol}=${value} ${unit}.`, [{ id: "q", symbol, value, unit, provenance: "given" }]), doc = fixture.document;
  doc.entities.push(...["O", "A", "B"].map(id => ({ id, kind: "point", role: "exact world point" })),
    { id: "arm", kind: "segment", role: "first arm" }, { id: "otherArm", kind: "segment", role: "second arm" },
    { id: "arc", kind: "angle_mark", role: "proved angle" }, { id: "body", kind: "rectangle", role: "body", label: options.ownerLabel ?? "B" });
  doc.constructions.push({ id: "O", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
    { id: "A", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["A"] },
    { id: "B", operator: "point", inputs: { x: 3, y: 3 }, outputs: ["B"] },
    { id: "arm", operator: "segment", inputs: { start: "O", end: "A" }, outputs: ["arm"] },
    { id: "otherArm", operator: "segment", inputs: { start: "O", end: "B" }, outputs: ["otherArm"] },
    { id: "arc", operator: "angle_mark", inputs: { vertex: "O", a: "arm", b: "otherArm" }, outputs: ["arc"] },
    { id: "body", operator: "rectangle", inputs: { center: "B", width: 1, height: 0.5 }, outputs: ["body"] });
  doc.assertions.push({ id: "angleProof", predicate: "angle_between", entities: ["arm", "otherArm"], expected: { value: 45, unit: "degree" }, severity: "fatal" });
  doc.annotations.push({ id: "binding", kind: "callout", quantityId: "q", targetIds: [target] });
  if (options.oldText) {
    doc.entities.push({ id: "old", kind: "label", role: "existing owner value", label: options.oldText });
    doc.constructions.push({ id: "old", operator: "label", inputs: { target, text: options.oldText }, outputs: ["old"] });
  }
  own(doc);
  const eligible = !options.oldText && (angle ? target === "arc" && !options.wrongAngle : !options.length && options.ownerLabel === symbol);
  return { id, ...fixture, expectedAdditions: eligible ? 1 : 0, ...(eligible && angle ? { annotationOnly: true } : {}) };
}

export function worldPointFixture(id: string): CompletionOwnershipFixture {
  const fixture = coordinateFixture(id), doc = fixture.document;
  const p = doc.constructions.find(construction => construction.outputs.includes("P"))!;
  p.operator = "space_point"; p.inputs = { frame: "frame", x: "px", y: "py", z: "pz" };
  const z: Plan["givens"][number] = { id: "pz", symbol: "z_P", value: 1, provenance: "given" };
  fixture.turnPlan.givens.push(z); doc.quantities.push(structuredClone(z));
  doc.entities.push({ id: "frame", kind: "polyline", role: "source world frame" });
  doc.constructions.splice(doc.constructions.length - 1, 0, { id: "construct_frame", operator: "space_frame", inputs: { origin: "L", scale: 0.6 }, outputs: ["frame"] });
  doc.requiredEntityIds.push("frame"); doc.revealGroups[0]!.entityIds.push("frame");
  return { ...fixture, annotationOnly: true };
}
export function threeWorldPointsFixture(id: string): CompletionOwnershipFixture {
  const fixture = worldPointFixture(id), doc = fixture.document;
  const question = "Show the source points A(2,-3,1), B(-2,2,-1), C(1,2,3) in the same world frame.";
  doc.source.question = question; fixture.turnPlan.question = question;
  doc.entities.find(entity => entity.id === "P")!.label = "A";
  for (const quantity of fixture.turnPlan.givens) quantity.symbol = quantity.symbol.replace("P", "A");
  for (const quantity of doc.quantities) quantity.symbol = quantity.symbol?.replace("P", "A");
  for (const [name, coordinates] of [["B", [-2, 2, -1]], ["C", [1, 2, 3]]] as const) {
    const givens = coordinates.map((value, index) => ({ id: `${name}${index}`, symbol: `${["x", "y", "z"][index]}_${name}`, value, provenance: "given" as const }));
    fixture.turnPlan.givens.push(...givens); doc.quantities.push(...structuredClone(givens));
    doc.entities.push({ id: name, kind: "point", role: "source world point", label: name });
    doc.constructions.push({ id: `construct_${name}`, operator: "space_point", inputs: { frame: "frame", x: givens[0]!.id, y: givens[1]!.id, z: givens[2]!.id }, outputs: [name] });
    doc.requiredEntityIds.push(name); doc.revealGroups[0]!.entityIds.push(name);
  }
  fixture.expectedAdditions = 3;
  return fixture;
}

export const completionOwnershipFixtures: CompletionOwnershipFixture[] = [
  coordinateFixture("native-world-coordinate-positive"),
  coordinateFixture("nonmetric-world-coordinate-refuses", { nonMetric: true }),
  coordinateFixture("native-valid-unit-wrapper-mismatch-refuses", { unit: "cm", wrapperUnit: "m" }),
  coordinateFixture("malformed-partial-point-identifier-refuses", { label: "3i", partial: true }),
  coordinateFixture("same-point-decimal-tuple-does-not-duplicate", { oldText: "P(2.00, -3.0)" }),
  curveFixture("metric-curve-parameter-positive", false), curveFixture("nonmetric-curve-parameter-refuses", true),
  attachmentFixture("native-angle-owner-positive", "arc"),
  attachmentFixture("angle-unit-on-segment-refuses", "arm"), attachmentFixture("angle-unit-on-point-refuses", "O"),
  attachmentFixture("wrong-angle-value-refuses", "arc", { wrongAngle: true }),
  attachmentFixture("absolute-length-without-native-length-proof-refuses", "arm", { length: true }),
  attachmentFixture("ambiguous-body-owner-refuses", "body"),
  attachmentFixture("exact-symbol-body-owner-positive", "body", { ownerLabel: "m" }),
  attachmentFixture("unicode-subscript-native-statement-does-not-duplicate", "arc", { symbol: "θ_1", oldText: "θ₁ = 45.00 °", value: 45, unit: "deg" }),
  attachmentFixture("component-designator-value-does-not-duplicate", "body", { symbol: "C_4", ownerLabel: "C_4", oldText: "C₄ 4μF", value: 4, unit: "μF" }),
  { ...attachmentFixture("board-scientific-number-format", "body", { symbol: "q", ownerLabel: "q", value: 1e-7, unit: "C" }), expectedText: "q = 1 × 10⁻⁷ C" },
  { ...attachmentFixture("board-unit-exponent-format", "body", { symbol: "a", ownerLabel: "a", value: 3, unit: "m/s^2" }), expectedText: "a = 3 m/s²" },
  worldPointFixture("space-tuple-native-append-preserves-point-name"),
];
const duplicatedOwner = attachmentFixture("same-symbol-two-native-owners-abstains", "body", { symbol: "m", ownerLabel: "m" });
duplicatedOwner.document.entities.find(entity => entity.id === "arm")!.label = "m";
duplicatedOwner.expectedAdditions = 0;
completionOwnershipFixtures.push(duplicatedOwner);
const sourceOnlyCurve = curveFixture("question-representation-curve-parameter-refuses", false);
sourceOnlyCurve.document.source.representationTier = "question_representation";
sourceOnlyCurve.expectedAdditions = 0;
completionOwnershipFixtures.push(sourceOnlyCurve);
for (const [label, symbol] of [["m01", "m1"], ["B+1", "B1"]]) {
  const fixture = attachmentFixture(`different-symbolic-owner-${label}-versus-${symbol}`, "body", { symbol, ownerLabel: label });
  fixture.expectedAdditions = 0;
  completionOwnershipFixtures.push(fixture);
}
const conflictingAlias = attachmentFixture("distinct-source-ids-conflicting-canonical-symbol-abstains", "body", { symbol: "m1", ownerLabel: "m1" });
conflictingAlias.document.quantities.push({ id: "different_source_id", symbol: "m_1", value: 3, unit: "g", provenance: "given" });
conflictingAlias.expectedAdditions = 0;
completionOwnershipFixtures.push(conflictingAlias);
const unicodeOwner = attachmentFixture("unicode-subscript-body-owner-positive", "body", { symbol: "m_1", ownerLabel: "m₁" });
unicodeOwner.expectedAdditions = 1;
completionOwnershipFixtures.push(unicodeOwner);

function geometricCarrierFixture(id: string, operator: string, kind: string, inputs: Record<string, unknown>, symbol: string, unit: string | undefined, value: number, expectedAdditions: number): CompletionOwnershipFixture {
  const fixture = attachmentFixture(id, "body", { symbol, ownerLabel: symbol, value, unit });
  fixture.document.entities.find(entity => entity.id === "body")!.kind = kind;
  const producer = fixture.document.constructions.find(construction => construction.outputs.includes("body"))!;
  producer.operator = operator; producer.inputs = inputs;
  if (unit === undefined) {
    delete fixture.document.quantities[0]!.unit;
    delete fixture.turnPlan.givens[0]!.unit;
    fixture.document.source.question = `Show body ${symbol} with its given scalar ${symbol}=${value}.`;
    fixture.turnPlan.question = String(fixture.document.source.question);
  }
  fixture.expectedAdditions = expectedAdditions;
  return fixture;
}
/** Appended cohort; the preceding 33 gate checks retain their exact inputs/oracles. */
export const geometricScalarOwnershipFixtures: CompletionOwnershipFixture[] = [
  geometricCarrierFixture("circle-radius-value-needs-native-proof", "circle", "circle", { center: "O", radius: 2 }, "r", "cm", 3, 0),
  geometricCarrierFixture("vector-magnitude-value-needs-native-proof", "vector", "vector", { start: "O", direction: [1, 0], length: 3 }, "v", "m/s", 4, 0),
  geometricCarrierFixture("rectangle-width-value-needs-native-proof", "rectangle", "rectangle", { center: "O", width: 2, height: 1 }, "w", "cm", 3, 0),
  ...["m^2", "cm³", "m^-1", "m^2/m", "cm/s^0", "dimensionless", "widgets", undefined, "L", "D"].map((unit, index) =>
    geometricCarrierFixture(`unproved-geometric-or-unknown-unit-${index}`, "rectangle", "rectangle", { center: "O", width: 2, height: 1 }, "u", unit, 3, 0)),
  geometricCarrierFixture("circle-body-mass-attribute-remains-supported", "circle", "circle", { center: "O", radius: 2 }, "m", "kg", 3, 1),
  geometricCarrierFixture("circle-body-charge-attribute-remains-supported", "circle", "circle", { center: "O", radius: 2 }, "q", "C", 3, 1),
  geometricCarrierFixture("native-component-attribute-remains-supported", "symbol", "component", { symbol: "capacitor", start: "O", end: "A" }, "χ", "μF", 4, 1),
  geometricCarrierFixture("vector-cannot-disguise-as-rectangle-carrier", "vector", "rectangle", { start: "O", direction: [1, 0], length: 3 }, "m", "kg", 4, 0),
];
completionOwnershipFixtures.push(...geometricScalarOwnershipFixtures);
