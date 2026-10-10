/**
 * Physics operator classes for normalized representatives.
 *
 * 1. Numeric label guard: a document that declares a nonmetric representative
 *    (source.nonMetric or the qualitative tier) keeps role or symbol labels on
 *    physical operator ink. Metric documents keep today's labels exactly.
 * 2. Metre bridge unknown gap: X in the left gap obeys X/R = l/(L-l), in the
 *    right gap X/R = (L-l)/l, and a contradictory supplied pair still fails.
 * 3. Gauss surfaces: a cylinder on a line charge carries λL/ε0 through its
 *    curved surface and none through its caps; a pillbox on a sheet carries
 *    σA/ε0 through its caps and none through its side.
 *
 * Every oracle is an independent closed form; every positive case has a
 * negative twin that must fail closed.
 */
import assert from "node:assert/strict";
import { evaluateChapterInstrumentConstruction } from "../../src/compile/chapterInstrumentGeometry";
import { evaluateDistributedFieldsConstruction, distributedFieldsConstructionOutputLabels, type DistributedFieldsEvaluationContext } from "../../src/compile/distributedFieldsGeometry";
import { evaluateMagneticConstruction } from "../../src/compile/magneticGeometry";
import { withEvaluatedOutputLabels } from "../../src/compile/outputLabels";
import { declaresNormalizedRepresentative, NONMETRIC_VALUE_LABEL_CODE, representativeOutputLabels, statesPhysicalValue } from "../../src/compile/representativeLabels";
import type { SourceContext } from "../../src/compile/sourceScalars";
import { compileSceneDocument, validateSceneDocument, type CompileResult, type SceneDocument } from "../../src/index";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks += 1; assert.ok(condition, message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function reject(run: () => unknown, message: string, pattern?: RegExp): void {
  checks += 1;
  let thrown = "";
  try { run(); } catch (error) { thrown = error instanceof Error ? error.message : String(error); }
  assert.ok(thrown !== "" && (!pattern || pattern.test(thrown)), `${message}${thrown ? ` (threw: ${thrown})` : " (did not throw)"}`);
}

type Entity = { id: string; kind: string; label?: string };
function scene(source: Record<string, unknown>, entities: Entity[], constructions: SceneDocument["constructions"], extra: Partial<SceneDocument> = {}): SceneDocument {
  const ids = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "physics operator class gate" },
    source: { question: "gate", ...source },
    quantities: [],
    entities: entities.map((entity) => ({ ...entity, role: `${entity.kind} output` })),
    constructions,
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "all", entityIds: ids, dependsOn: [], narrationCue: "reveal" }],
    teachingTimeline: [],
    ...extra,
  } as SceneDocument;
}
const METRIC = {};
const NONMETRIC = { nonMetric: true };
const QUALITATIVE = { representationTier: "qualitative_verified" };
function guardCodes(result: CompileResult): string[] { return result.report.issues.filter((issue) => issue.code === NONMETRIC_VALUE_LABEL_CODE).map((issue) => issue.code); }
function labelOf(result: CompileResult, entityId: string): string | undefined {
  return result.renderScene?.primitives.find((primitive) => primitive.entityId === entityId && typeof primitive.text === "string" && primitive.text !== "")?.text;
}
function compiles(document: SceneDocument, message: string): CompileResult {
  const result = compileSceneDocument(document);
  check(result.ok && result.renderScene, `${message}: ${JSON.stringify(result.report.issues.filter((issue) => issue.severity === "fatal"))}`);
  return result;
}
function refusedByGuard(document: SceneDocument, message: string): void {
  const result = compileSceneDocument(document);
  check(!result.ok && result.renderScene === null, `${message}: compiled`);
  check(guardCodes(result).length > 0, `${message}: refused for another reason ${JSON.stringify(result.report.issues.map((issue) => issue.code))}`);
  const structural = validateSceneDocument(document);
  check(structural.report.issues.some((issue) => issue.code === NONMETRIC_VALUE_LABEL_CODE), `${message}: the structural validator must refuse it too`);
}

// ---------- 1. Numeric label guard ----------
check(declaresNormalizedRepresentative({ source: NONMETRIC }) && declaresNormalizedRepresentative({ source: QUALITATIVE }), "both declarations mark a representative");
check(!declaresNormalizedRepresentative({ source: METRIC }) && !declaresNormalizedRepresentative({ source: { nonMetric: false, representationTier: "exact_verified" } }), "metric documents are not representatives");
for (const text of ["F", "F1", "F2", "I_1", "R_1", "h_o", "λ", "E schematic", "E=0 schematic", "Phi=0", "Fz ⊙", "|F|", "unknown", "x²"]) check(!statesPhysicalValue(text), `"${text}" states no value`);
for (const text of ["|F|=24 N", "F2=10 cm", "u=-20", "Fz=−2 N ⊙", "1.5e-3", "q=+1", "2F", "unknown=6", "θ=30°", ".5"]) check(statesPhysicalValue(text), `"${text}" states a value`);

// magnetic_force: q=2 C, v=3 x m/s, B=4 z T gives F = q v×B = -24 y N.
const lorentz = { charge: 2, velocity: [3, 0, 0], magneticField: [0, 0, 4], units: { charge: "C", velocity: "m/s", magneticField: "T" }, origin: [0, 0], displayLength: 2 };
const forceScene = (source: Record<string, unknown>, label?: string, extra: Partial<SceneDocument> = {}): SceneDocument => scene(source,
  [{ id: "F", kind: "vector", ...(label === undefined ? {} : { label }) }],
  [{ id: "make_F", operator: "magnetic_force", inputs: lorentz, outputs: ["F"] }], extra);
check(labelOf(compiles(forceScene(METRIC, "|F|=24 N"), "metric numeric force label compiles"), "F") === "|F|=24 N", "a metric document keeps the verified N label");
check(labelOf(compiles(forceScene(METRIC), "metric unlabelled force compiles"), "F") === "F", "a metric force defaults to its symbol");
refusedByGuard(forceScene(NONMETRIC, "|F|=24 N"), "a nonmetric representative refuses a numeric force label");
refusedByGuard(forceScene(QUALITATIVE, "|F|=24 N"), "the qualitative tier declaration refuses a numeric force label");
check(labelOf(compiles(forceScene(NONMETRIC, "F"), "nonmetric symbol force compiles"), "F") === "F", "a nonmetric representative keeps the symbol label");
const forceQuantity = { quantities: [{ id: "Fq", value: 24, unit: "N" }], annotations: [{ id: "a", kind: "label", targetIds: ["F"], quantityId: "Fq" }] } as Partial<SceneDocument>;
compiles(forceScene(METRIC, undefined, forceQuantity), "a metric force annotation bound to the matching N value compiles");
// A document that carries quantities states its values (and the planner's
// quantity agreement refuses invented ones), so the guard leaves it alone;
// engine-synthesized figures keep their own value labels too.
compiles(forceScene(NONMETRIC, undefined, forceQuantity), "a nonmetric document with stated quantities keeps its bound annotation");
check(labelOf(compiles(forceScene({ ...NONMETRIC, synthesizedFamily: true }, "|F|=24 N"), "an engine-synthesized figure keeps its value label"), "F") === "|F|=24 N", "engine families are outside the representative guard");
refusedByGuard(forceScene(NONMETRIC, undefined, { annotations: [{ id: "a", kind: "callout", targetIds: ["F"], text: "|F|=24 N" }] }), "a nonmetric representative refuses a numeric annotation text");

// The compile label step fails closed on its own: a value label that reached it
// without the structural validator (a direct engine caller) is still refused.
const labelContext = { number: (value: unknown) => Number(value), point: () => ({ x: 0, y: 0 }) };
const forceOutputs = evaluateMagneticConstruction("magnetic_force", lorentz, { ...labelContext, geometry: () => undefined });
for (const [source, refused] of [[METRIC, false], [NONMETRIC, true]] as const) {
  const document = forceScene(source, "|F|=24 N");
  const stepIssues: Parameters<typeof withEvaluatedOutputLabels>[6] = [];
  const labelled = withEvaluatedOutputLabels(document.constructions[0]!, 0, lorentz, forceOutputs, document, labelContext, stepIssues, new Set());
  check(stepIssues.some((issue) => issue.code === NONMETRIC_VALUE_LABEL_CODE) === refused, `the compile label step ${refused ? "refuses" : "keeps"} a value label (${JSON.stringify(stepIssues)})`);
  if (!refused) check(labelled.entities[0]!.label === "|F|=24 N", "the metric label step keeps the verified value");
}
check(representativeOutputLabels("optical_focus", ["F1=-10 cm", "F2=10 cm"]).labels.join("|") === "F1|F2", "value-by-default labels keep their symbol");
check(representativeOutputLabels("magnetic_force", ["|F|=24 N"]).leaked === "|F|=24 N", "a role-or-value operator never has its value silently rewritten");

// optical_focus: lens f=10 cm puts F1 at -10 cm and F2 at +10 cm.
const focusScene = (source: Record<string, unknown>, labels: Record<string, string> = {}, extra: Partial<SceneDocument> = {}): SceneDocument => scene(source,
  ["F1", "F2"].map((id) => ({ id, kind: "point", ...(labels[id] === undefined ? {} : { label: labels[id] }) })),
  [{ id: "foci", operator: "optical_focus", inputs: { kind: "lens", center: [0, 0], axis: [1, 0], focalLength: 10, displayScale: 1, lengthUnit: "cm" }, outputs: ["F1", "F2"] }], extra);
const metricFocus = compiles(focusScene(METRIC), "metric foci compile");
check(labelOf(metricFocus, "F1") === "F1=-10 cm" && labelOf(metricFocus, "F2") === "F2=10 cm", `a metric document keeps the computed focal distances (${labelOf(metricFocus, "F1")}, ${labelOf(metricFocus, "F2")})`);
const representativeFocus = compiles(focusScene(NONMETRIC), "nonmetric foci compile");
check(labelOf(representativeFocus, "F1") === "F1" && labelOf(representativeFocus, "F2") === "F2", `a nonmetric representative prints focus symbols only (${labelOf(representativeFocus, "F1")}, ${labelOf(representativeFocus, "F2")})`);
const qualitativeFocus = compiles(focusScene(QUALITATIVE), "qualitative foci compile");
check(labelOf(qualitativeFocus, "F2") === "F2", "the qualitative tier declaration also prints symbols");
compiles(focusScene(METRIC, { F2: "F2=10 cm" }), "a metric document accepts the verified focal label");
refusedByGuard(focusScene(NONMETRIC, { F2: "F2=10 cm" }), "a nonmetric representative refuses a numeric focal label");
const focusQuantity = { quantities: [{ id: "f", value: 10, unit: "cm" }], annotations: [{ id: "a", kind: "label", targetIds: ["F2"], quantityId: "f" }] } as Partial<SceneDocument>;
compiles(focusScene(METRIC, {}, focusQuantity), "a metric focal quantity annotation compiles");
compiles(focusScene(NONMETRIC, {}, focusQuantity), "a nonmetric document with a stated focal quantity keeps its bound annotation");

// gaussian_image: u=-30, f=10 gives v=15, m=-0.5 in a metric document; symbols in a representative.
const imageScene = (source: Record<string, unknown>): SceneDocument => scene(source,
  ["ob", "ot", "ib", "it"].map((id) => ({ id, kind: "point" })),
  [{ id: "image", operator: "gaussian_image", inputs: { kind: "lens", center: [0, 0], axis: [1, 0], objectDistance: -30, focalLength: 10, objectHeight: 4, displayScale: 0.1, lengthUnit: "cm" }, outputs: ["ob", "ot", "ib", "it"] }]);
const metricImage = compiles(imageScene(METRIC), "metric image compiles");
check(labelOf(metricImage, "ib") === "v=15 cm" && labelOf(metricImage, "it") === "m=-0.5", `a metric image keeps v and m values (${labelOf(metricImage, "ib")}, ${labelOf(metricImage, "it")})`);
const representativeImage = compiles(imageScene(NONMETRIC), "nonmetric image compiles");
check(["ob", "ot", "ib", "it"].every((id) => !statesPhysicalValue(labelOf(representativeImage, id) ?? "")), "a representative image prints no computed distance");
check(labelOf(representativeImage, "ib") === "v", "the image base keeps its v symbol");

// Instruments: metre bridge role labels in a representative, verified values only in metric documents.
const bridgeInputs = { knownResistance: 2, unknownResistance: 6, wireLength: 100, origin: [0, 0], displayLength: 4, units: { resistance: "ohm", length: "cm" } };
const bridgeEntities = (label?: string): Entity[] => [{ id: "wire", kind: "polyline" }, { id: "jockey", kind: "point" }, { id: "left", kind: "polyline" }, { id: "right", kind: "polyline", ...(label === undefined ? {} : { label }) }];
const bridgeScene = (source: Record<string, unknown>, inputs: Record<string, unknown>, label?: string): SceneDocument => scene(source, bridgeEntities(label),
  [{ id: "bridge", operator: "metre_bridge", inputs, outputs: ["wire", "jockey", "left", "right"] }]);
check(labelOf(compiles(bridgeScene(METRIC, bridgeInputs, "unknown=6"), "metric bridge value label compiles"), "right") === "unknown=6", "a metric bridge keeps the verified unknown");
refusedByGuard(bridgeScene(NONMETRIC, bridgeInputs, "unknown=6"), "a nonmetric representative refuses an instrument value label");
check(labelOf(compiles(bridgeScene(NONMETRIC, bridgeInputs), "nonmetric bridge compiles"), "right") === "unknown", "a representative bridge prints the role");

// Remainder: bar magnet field lines keep role labels in a representative.
const magnetScene = (source: Record<string, unknown>, label?: string): SceneDocument => scene(source,
  [{ id: "bar", kind: "polygon", ...(label === undefined ? {} : { label }) }, ...[1, 2, 3, 4].map((n) => ({ id: `line${n}`, kind: "polyline" }))],
  [{ id: "magnet", operator: "bar_magnet", inputs: { moment: [1, 0], origin: [0, 0], displayScale: 1 }, outputs: ["bar", "line1", "line2", "line3", "line4"] }]);
compiles(magnetScene(METRIC, "bar=1"), "a metric magnet accepts its verified moment label");
refusedByGuard(magnetScene(NONMETRIC, "bar=1"), "a nonmetric representative refuses a moment value on the magnet");
compiles(magnetScene(NONMETRIC), "a representative magnet compiles with role labels");

// ---------- 2. Metre bridge unknown gap ----------
const context: SourceContext = { number: (value) => Number(value), point: () => { throw new Error("missing point"); }, geometry: () => undefined };
const bridge = (inputs: Record<string, unknown>) => evaluateChapterInstrumentConstruction("metre_bridge", { ...bridgeInputs, ...inputs }, context);
// Right gap (default): R/X = l/(L-l), so l = L R/(R+X) = 25 for R=2, X=6.
const right = bridge({});
close(right[1]!.instrument.components.x, 100 * 2 / 8, "right gap jockey l = L R/(R+X)");
check(right[2]!.instrument.role === "known" && right[3]!.instrument.role === "unknown", "the default keeps X in the right gap");
check(right[2]!.kind === "path" && right[2]!.points[0]!.x === 0 && right[3]!.kind === "path" && right[3]!.points[0]!.x === 4, "outputs stay in spatial order left gap, right gap");
check(JSON.stringify(bridge({ unknownGap: "right" })) === JSON.stringify(right), "unknownGap right is today's behaviour exactly");
// Left gap: X/R = l/(L-l), so l = L X/(R+X) = 75.
const left = bridge({ unknownGap: "left" });
close(left[1]!.instrument.components.x, 100 * 6 / 8, "left gap jockey l = L X/(R+X)");
check(left[2]!.instrument.role === "unknown" && left[3]!.instrument.role === "known", "unknownGap left puts X in the left gap");
close(left[2]!.instrument.certified ?? NaN, 6, "the left gap certifies the unknown");
close(left[3]!.instrument.certified ?? NaN, 2, "the right gap certifies the known");
check(left[2]!.kind === "path" && left[2]!.points[0]!.x === 0 && left[1]!.kind === "point", "the unknown gap sits at the left end");
close(left[1]!.kind === "point" ? left[1]!.point.x : NaN, 4 * 0.75, "the jockey is drawn at l/L of the display length");
// Balance only: R=2, l=40, L=100.
close(bridge({ unknownResistance: undefined, balanceFromLeft: 40, unknownGap: "left" })[2]!.instrument.certified ?? NaN, 2 * 40 / 60, "left gap X = R l/(L-l)");
close(bridge({ unknownResistance: undefined, balanceFromLeft: 40 })[3]!.instrument.certified ?? NaN, 2 * 60 / 40, "right gap X = R (L-l)/l");
// The same supplied pair is consistent in one convention only.
reject(() => bridge({ balanceFromLeft: 25, unknownGap: "left" }), "a left gap pair that fits only the right convention is a contradiction", /contradicts the balance law/);
reject(() => bridge({ balanceFromLeft: 75 }), "a right gap pair that fits only the left convention is a contradiction", /contradicts the balance law/);
check(bridge({ balanceFromLeft: 75, unknownGap: "left" })[2]!.instrument.certified === 6, "the agreeing left pair is accepted");
reject(() => bridge({ unknownGap: "middle" }), "an unknown gap other than left or right fails", /unknownGap/);
reject(() => bridge({ unknownGap: "left", unknownResistance: undefined, balanceFromLeft: 100 }), "a left gap jockey at the wire end fails", /strictly between/);
compiles(bridgeScene(METRIC, { ...bridgeInputs, unknownGap: "left" }), "a left gap bridge compiles");
check(!compileSceneDocument(bridgeScene(METRIC, { ...bridgeInputs, unknownGap: "left", balanceFromLeft: 25 })).ok, "a contradictory left gap bridge emits no scene");
check(labelOf(compiles(bridgeScene(METRIC, { ...bridgeInputs, unknownGap: "left" }, "known=2"), "left gap known value compiles"), "right") === "known=2", "the right gap carries the known value when X is on the left");

// ---------- 3. Gauss cylinder and pillbox ----------
const quantities = new Map<string, number>();
const fieldContext: DistributedFieldsEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return fieldContext.number((value as { value: unknown }).value);
    return typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
  },
  point: () => ({ x: 0, y: 0 }),
  geometry: () => undefined,
};
const gauss = (inputs: Record<string, unknown>) => evaluateDistributedFieldsConstruction("gauss_flux", inputs, fieldContext);
type GaussMeta = { model: string; flux: number; curvedFlux?: number; capFlux?: number; enclosedCharge: number; capRadius?: number };
const meta = (outputs: ReturnType<typeof gauss>): GaussMeta => (outputs[0] as unknown as { gaussFlux: GaussMeta }).gaussFlux;
const EPS0 = 8.85e-12;
const cylinderBase = { model: "cylindrical", center: [1, 2], radius: 1, length: 3, chargeDensity: 2, epsilon0: 1, mode: "schematic" };
const cylinder = gauss(cylinderBase);
check(cylinder.length === 3 && cylinder[0]!.kind === "path" && cylinder[1]!.kind === "point" && cylinder[2]!.kind === "path", "a cylinder draws surface, flux anchor and line charge");
close(meta(cylinder).flux, 2 * 3, "cylinder flux is λL/ε0");
close(meta(cylinder).curvedFlux ?? NaN, 6, "all of it crosses the curved surface");
check(meta(cylinder).capFlux === 0, "none crosses the caps");
const box = cylinder[0]!.kind === "path" ? cylinder[0]!.points : [];
const xs = box.map((point) => point.x); const ys = box.map((point) => point.y);
close(Math.max(...xs) - Math.min(...xs), 3, "the side view is L long on the axis");
close(Math.max(...ys) - Math.min(...ys), 2, "and 2r across it");
check(cylinder[2]!.kind === "path" && cylinder[2]!.points.every((point) => Math.abs(point.y - 2) < 1e-12) && Math.min(...cylinder[2]!.points.map((point) => point.x)) < Math.min(...xs), "the line charge lies on the axis and crosses both caps");
const tilted = gauss({ ...cylinderBase, axis: [3, 4] });
check(tilted[2]!.kind === "path" && tilted[2]!.points.every((point) => Math.abs(4 * (point.x - 1) - 3 * (point.y - 2)) < 1e-9), "a tilted cylinder keeps the source on its axis");
close(meta(tilted).flux, 6, "flux does not depend on the drawn orientation");
const cylinderSI = gauss({ ...cylinderBase, mode: "si", chargeDensity: 5, length: 20, epsilon0: EPS0, densityUnit: "nC/m", lengthUnit: "cm", epsilonUnit: "F/m" });
close(meta(cylinderSI).flux, 5e-9 * 0.2 / EPS0, "SI cylinder converts λ and L before dividing by ε0", 1e-12);
close(meta(cylinderSI).enclosedCharge, 1e-9, "SI enclosed charge is λL in coulombs", 1e-12);
const pillboxBase = { model: "pillbox", center: [0, 0], capArea: 2, height: 1, chargeDensity: 3, epsilon0: 1, mode: "schematic" };
const pillbox = gauss(pillboxBase);
close(meta(pillbox).flux, 3 * 2, "pillbox flux is σA/ε0");
close(meta(pillbox).capFlux ?? NaN, 6, "all of it crosses the two caps");
check(meta(pillbox).curvedFlux === 0, "none crosses the curved side");
close(meta(pillbox).capRadius ?? NaN, Math.sqrt(2 / Math.PI), "cap radius is √(A/π)");
const pill = pillbox[0]!.kind === "path" ? pillbox[0]!.points : [];
close(Math.max(...pill.map((point) => point.x)) - Math.min(...pill.map((point) => point.x)), 1, "the pillbox is h thick across the sheet");
check(pillbox[2]!.kind === "path" && pillbox[2]!.points.every((point) => Math.abs(point.x) < 1e-12) && Math.max(...pillbox[2]!.points.map((point) => point.y)) > Math.max(...pill.map((point) => point.y)), "the sheet is the mid plane and runs past the side");
const pillboxSI = gauss({ ...pillboxBase, mode: "si", chargeDensity: 4, capArea: 50, epsilon0: EPS0, densityUnit: "μC/m^2", lengthUnit: "cm", epsilonUnit: "F/m" });
close(meta(pillboxSI).flux, 4e-6 * 50e-4 / EPS0, "SI pillbox converts the area with the square of the length unit", 1e-12);
const sphere = gauss({ model: "spherical", center: [1, 2], radius: 3, enclosedCharge: 4, epsilon0: 1, mode: "schematic" });
check(sphere.length === 2 && sphere[0]!.kind === "circle" && meta(sphere).flux === 4, "the spherical model is unchanged");
for (const [bad, message] of [
  [{ ...cylinderBase, model: "cubic" }, "an unknown surface model"],
  [{ ...cylinderBase, enclosedCharge: 4 }, "an enclosed charge on a cylinder (it is derived from λL)"],
  [{ ...cylinderBase, radius: 0 }, "a zero radius"],
  [{ ...cylinderBase, length: -1 }, "a negative length"],
  [{ ...cylinderBase, epsilon0: 2 }, "a schematic ε0 other than 1"],
  [{ ...cylinderBase, lengthUnit: "m" }, "a schematic length unit"],
  [{ ...cylinderBase, axis: [0, 0] }, "a zero axis"],
  [{ ...cylinderBase, axis: [1, 0, 0] }, "a 3D axis"],
  [{ ...cylinderBase, mode: "si", epsilon0: EPS0, lengthUnit: "m", epsilonUnit: "F/m" }, "an SI cylinder without a density unit"],
  [{ ...cylinderBase, mode: "si", epsilon0: EPS0, densityUnit: "C/m^2", lengthUnit: "m", epsilonUnit: "F/m" }, "a surface density on a line charge"],
  [{ ...cylinderBase, mode: "si", chargeDensity: 1e-300, length: 1e-300, epsilon0: EPS0, densityUnit: "pC/m", lengthUnit: "mm", epsilonUnit: "F/m" }, "a nonzero density that underflows to zero flux"],
  [{ ...pillboxBase, capArea: 0 }, "a zero cap area"],
  [{ ...pillboxBase, height: 0 }, "a zero pillbox height"],
  [{ ...pillboxBase, radius: 1 }, "a radius on a pillbox"],
  [{ ...pillboxBase, mode: "si", epsilon0: EPS0, densityUnit: "C/m", lengthUnit: "m", epsilonUnit: "F/m" }, "a line density on a sheet"],
] as const) reject(() => gauss(bad), `gauss_flux refuses ${message}`);
// Labels: surface S, flux Phi with its verified SI value, source symbol only.
const cylinderLabels = distributedFieldsConstructionOutputLabels("gauss_flux", cylinderSI);
check(cylinderLabels.join("|") === "S|Phi|λ", `cylinder default labels are symbols (${cylinderLabels.join("|")})`);
const fluxText = `Phi=${Number((5e-9 * 0.2 / EPS0).toPrecision(3))} V*m`;
check(distributedFieldsConstructionOutputLabels("gauss_flux", cylinderSI, [undefined, fluxText, "λ"])[1] === fluxText, "the verified SI flux label is accepted");
reject(() => distributedFieldsConstructionOutputLabels("gauss_flux", cylinderSI, [undefined, "Phi=1 V*m", undefined]), "a wrong flux value is refused");
reject(() => distributedFieldsConstructionOutputLabels("gauss_flux", cylinderSI, [undefined, undefined, "λ=5"]), "a value on the source line is refused");
check(distributedFieldsConstructionOutputLabels("gauss_flux", pillbox).join("|") === "S|Phi schematic|σ", "pillbox schematic labels are symbols");
// Documents: kinds, units and compile.
const gaussScene = (source: Record<string, unknown>, inputs: Record<string, unknown>, kinds = ["polygon", "label", "segment"], fluxLabel?: string, quantityList: SceneDocument["quantities"] = []): SceneDocument => scene(source,
  ["surface", "flux", "charge"].slice(0, kinds.length).map((id, index) => ({ id, kind: kinds[index]!, ...(index === 1 && fluxLabel !== undefined ? { label: fluxLabel } : {}) })),
  [{ id: "gauss", operator: "gauss_flux", inputs, outputs: ["surface", "flux", "charge"].slice(0, kinds.length) }], { quantities: quantityList });
const cylinderSIInputs = { ...cylinderBase, mode: "si", chargeDensity: 5, length: 20, epsilon0: EPS0, densityUnit: "nC/m", lengthUnit: "cm", epsilonUnit: "F/m" };
const cylinderCompiled = compiles(gaussScene(METRIC, cylinderSIInputs, undefined, fluxText), "an SI cylinder compiles");
check(cylinderCompiled.renderScene!.primitives.some((primitive) => primitive.entityId === "surface" && ["rectangle", "polygon"].includes(primitive.kind)), "the cylinder side view reaches ink as a closed shape");
check(cylinderCompiled.renderScene!.primitives.some((primitive) => primitive.entityId === "charge" && primitive.kind === "line"), "the line charge reaches ink");
check(labelOf(cylinderCompiled, "flux") === fluxText, "the metric cylinder keeps its verified flux label");
compiles(gaussScene(METRIC, pillboxBase), "a schematic pillbox compiles");
check(!compileSceneDocument(gaussScene(METRIC, cylinderBase, ["circle", "label", "segment"])).ok, "a cylinder surface declared as a circle is refused");
check(!compileSceneDocument(gaussScene(METRIC, cylinderBase, ["polygon", "label"])).ok, "a cylinder without its source output is refused");
check(!compileSceneDocument(gaussScene(METRIC, { model: "spherical", center: [0, 0], radius: 1, enclosedCharge: 1, epsilon0: 1, mode: "schematic" }, ["polygon", "label", "segment"])).ok, "a sphere declared with cylinder outputs is refused");
compiles(gaussScene(METRIC, { model: "spherical", center: [0, 0], radius: 1, enclosedCharge: 1, epsilon0: 1, mode: "schematic" }, ["circle", "label"]), "a spherical surface still compiles");
const areaInputs = { ...pillboxBase, mode: "si", chargeDensity: 4, capArea: "A", epsilon0: EPS0, densityUnit: "μC/m^2", lengthUnit: "cm", epsilonUnit: "F/m" };
compiles(gaussScene(METRIC, areaInputs, undefined, undefined, [{ id: "A", value: 50, unit: "cm^2" }]), "a cap area in the square of the length unit compiles");
check(!compileSceneDocument(gaussScene(METRIC, areaInputs, undefined, undefined, [{ id: "A", value: 50, unit: "m^2" }])).ok, "a cap area in another scale is refused");
check(!compileSceneDocument(gaussScene(METRIC, { ...cylinderSIInputs, length: "L" }, undefined, undefined, [{ id: "L", value: 20, unit: "m" }])).ok, "a cylinder length in another scale is refused");
refusedByGuard(gaussScene(NONMETRIC, cylinderSIInputs, undefined, fluxText), "a nonmetric representative refuses a numeric flux label");
compiles(gaussScene(NONMETRIC, cylinderBase), "a representative cylinder compiles with symbols");

console.log(`physics operator class verification passed (${checks} checks)`);
