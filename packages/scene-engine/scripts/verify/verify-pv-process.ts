import assert from "node:assert/strict";
import { compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument, type SceneDocument } from "../../src/index";
import { conceptualPvDocument as conceptual, physicalPvDocument } from "./fixtures/pv-process-cases";
const validated = validateSceneDocument(pruneDeadSceneEntities(conceptual() as unknown as Record<string, unknown>));
assert.ok(validated.document, JSON.stringify(validated.report.issues));
const compiled = compileSceneDocument(validated.document);
assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
const process = compiled.renderScene.primitives.find((primitive) => primitive.provenance?.pvRole === "process");
assert.ok(process && process.points.length >= 2, "the declared process must produce directed plot ink");
assert.ok(process.points.every((point) => point.y === process.points[0]!.y), "an isobar is horizontal after production normalization and fitting");
console.log("P-V process: conceptual isobar passed");

const comparison = conceptual();
comparison.constructions[0]!.inputs.states = [
  { id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 1, volume: 2 },
  { id: "C", pressure: 2, volume: 1 }, { id: "D", pressure: 0.5, volume: 2 },
  { id: "E", pressure: 0.25, volume: 2 },
];
comparison.constructions[0]!.inputs.processes = [
  { kind: "isobar", from: "A", to: "B" }, { kind: "isochor", from: "A", to: "C" },
  { kind: "isotherm", from: "A", to: "D" }, { kind: "adiabat", from: "A", to: "E" },
];
const four = compileSceneDocument(comparison);
assert.ok(four.ok && four.renderScene, "all four conceptual process laws must compile without invented physical gas data");
const ink = four.renderScene.primitives;
const origin = ink.find((primitive) => primitive.id === "plot_axis_v")!.points[0]!;
const stateA = ink.find((primitive) => primitive.id === "plot_state_A")!.points[0]!;
const curves = ink.filter((primitive) => primitive.provenance?.pvRole === "process");
assert.equal(curves.length, 4);
assert.ok(curves[1]!.points.every((point) => point.x === stateA.x), "an isochor remains exactly vertical");
for (const [index, exponent] of [[2, 1], [3, 2]]) {
  assert.ok(curves[index!]!.points.length > 2, "a nonlinear process must retain its curve, not an endpoint chord");
  for (const point of curves[index!]!.points) {
    const volume = (point.x - origin.x) / (stateA.x - origin.x);
    const pressure = (origin.y - point.y) / (origin.y - stateA.y);
    assert.ok(Math.abs(pressure * volume ** exponent! - 1) < 0.001, "the rendered curve preserves the independently known normalized law");
  }
}
console.log("P-V process: four conceptual laws passed");

const physical = physicalPvDocument();
const physicalValidated = validateSceneDocument(pruneDeadSceneEntities(physical as unknown as Record<string, unknown>));
assert.ok(physicalValidated.document, JSON.stringify(physicalValidated.report.issues));
const physicalCompiled = compileSceneDocument(physicalValidated.document);
assert.ok(physicalCompiled.ok && physicalCompiled.renderScene, JSON.stringify(physicalCompiled.report.issues));
const physicalInk = physicalCompiled.renderScene.primitives;
assert.ok(physicalInk.some((primitive) => primitive.text === "P (kPa)") && physicalInk.some((primitive) => primitive.text === "V (L)"), "physical axes retain their explicit dimensions and units");
const adiabaticWork = physicalInk.find((primitive) => primitive.id === "plot_process_1")?.provenance?.pvWorkJ;
assert.ok(typeof adiabaticWork === "number" && Math.abs(adiabaticWork - 100) < 1e-10, "the explicit reversible adiabat does 100 J of expansion work");
const isothermalWork = physicalInk.find((primitive) => primitive.id === "plot_process_0")?.provenance?.pvWorkJ;
assert.ok(typeof isothermalWork === "number" && Math.abs(isothermalWork - 138.62943611198907) < 1e-10, "isothermal work is computed in joules rather than display area");
assert.ok(!JSON.stringify(four.renderScene).includes('"pvWorkJ"'), "concept plots carry no invented SI work authority");
assert.ok(four.renderScene.primitives.some((primitive) => primitive.text === "ideal gas sketch"), "representative isotherm/adiabat shape must declare its ideal-gas model");
console.log("P-V process: source-unit physical laws passed");

const physicalLinear = structuredClone(physical);
physicalLinear.quantities.push({ id: "p400", value: 400, unit: "kPa" });
physicalLinear.constructions[0]!.inputs.states = [{ id: "A", pressure: "pa", volume: "va" }, { id: "B", pressure: "pa", volume: "vend" }, { id: "C", pressure: "p400", volume: "va" }];
physicalLinear.constructions[0]!.inputs.processes = [{ kind: "isobar", from: "A", to: "B" }, { kind: "isochor", from: "A", to: "C" }];
const linearResult = compileSceneDocument(physicalLinear);
assert.ok(linearResult.ok && linearResult.renderScene, "all four physical process families are supported");
assert.equal(linearResult.renderScene.primitives.find((primitive) => primitive.id === "plot_process_0")?.provenance?.pvWorkJ, 200, "constant pressure expansion does P delta V in SI");
assert.equal(linearResult.renderScene.primitives.find((primitive) => primitive.id === "plot_process_1")?.provenance?.pvWorkJ, 0, "an isochor has exactly zero work");

let refusals = 0;
function refuses(document: SceneDocument, reason: string): void {
  assert.equal(compileSceneDocument(document).ok, false, `direct compilation must refuse ${reason}`);
  assert.equal(compileSceneDocument(document, { yieldPolicy: "verified_parts" }).ok, false, `yield policy cannot waive ${reason}`);
  const normalized = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  assert.ok(!normalized.document || !compileSceneDocument(normalized.document).ok, `production normalization must refuse ${reason}`);
  refusals += 3;
}
const claimed = conceptual();
claimed.entities[0]!.label = "gamma=1.4";
refuses(claimed, "unowned labels on the sealed plot");
for (const kind of ["label", "callout", "sense", "polarity", "highlight"]) {
  const annotated = conceptual();
  annotated.annotations = [{ id: "claim", kind, targetIds: ["plot"], text: "P = 50 Pa", quantityId: "invented" }];
  refuses(annotated, `${kind} annotations on a sealed plot`);
}
const wrongOutput = conceptual(); wrongOutput.entities[0]!.kind = "point";
refuses(wrongOutput, "the wrong output kind");
const forgedMetadata = conceptual(); forgedMetadata.entities[0]!.provenance = { physicalProcess: { workJ: 20 }, pvWorkJ: 20 };
refuses(forgedMetadata, "caller-authored physical metadata");
const secondPlot = conceptual();
secondPlot.entities.push({ id: "plot2", kind: "polyline", role: "second plot" });
secondPlot.constructions.push({ ...structuredClone(secondPlot.constructions[0]!), id: "make_plot2", outputs: ["plot2"] });
secondPlot.requiredEntityIds.push("plot2"); secondPlot.revealGroups[0]!.entityIds.push("plot2");
refuses(secondPlot, "independently fitted duplicate P-V frames");
console.log(`P-V process: ${refusals} sealed-output refusals passed`);

for (const reverse of [false, true]) {
  const steep = conceptual();
  steep.constructions[0]!.inputs.states = [{ id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 0.05, volume: 20 }];
  steep.constructions[0]!.inputs.processes = [{ kind: "isotherm", from: reverse ? "B" : "A", to: reverse ? "A" : "B" }];
  const result = compileSceneDocument(steep);
  assert.ok(result.ok && result.renderScene, "a readable steep isotherm must compile in either direction");
  const primitives = result.renderScene.primitives;
  const zero = primitives.find((primitive) => primitive.id === "plot_axis_v")!.points[0]!;
  const start = primitives.find((primitive) => primitive.id === "plot_state_A")!.points[0]!;
  const points = primitives.find((primitive) => primitive.provenance?.pvRole === "process")!.points;
  assert.ok(points.length <= 513 && points.length > 2, "curves have bounded analytic vertices");
  assert.equal(Math.sign(points.at(-1)!.x - points[0]!.x), reverse ? -1 : 1, "process direction follows the named endpoints");
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!; const b = points[i]!;
    const x = (a.x + b.x) / 2;
    const volume = (x - zero.x) / (start.x - zero.x);
    const y = zero.y - (zero.y - start.y) / volume;
    const cross = Math.abs((b.y - a.y) * (x - a.x) - (b.x - a.x) * (y - a.y));
    assert.ok(cross / Math.hypot(b.x - a.x, b.y - a.y) < 0.25, "each final-screen chord follows the analytic curve within a quarter pixel");
  }
}
console.log("P-V process: adaptive analytic direction passed");

const literalPhysical = structuredClone(physical);
(literalPhysical.constructions[0]!.inputs.states as Record<string, unknown>[])[0]!.pressure = 200;
refuses(literalPhysical, "source-unbound physical literal coordinates");
const literalGamma = structuredClone(physical);
(literalGamma.constructions[0]!.inputs.processes as Record<string, unknown>[])[1]!.gamma = 2;
refuses(literalGamma, "source-unbound physical gamma");
const missingNestedUnit = structuredClone(physical);
missingNestedUnit.quantities[0]!.value = "unitless";
missingNestedUnit.quantities.push({ id: "unitless", value: 200 });
refuses(missingNestedUnit, "an outer reference laundering a unitless inner quantity");
const labels = four.renderScene.primitives.filter((primitive) => primitive.kind === "label");
assert.ok(labels.every((label) => label.labelPlacement === "absolute" && label.provenance?.labelBounds), "every engine-owned plot label must pass native screen-space placement");

const ambiguousName = conceptual();
ambiguousName.constructions[0]!.inputs.states = [{ id: "A1", pressure: 1, volume: 1 }, { id: "A_1", pressure: 2, volume: 1 }];
ambiguousName.constructions[0]!.inputs.processes = [{ kind: "isochor", from: "A1", to: "A_1" }];
refuses(ambiguousName, "mathematically identical subscript state names");
const overlapping = conceptual();
overlapping.constructions[0]!.inputs.states = [{ id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 1, volume: 2 }, { id: "C", pressure: 1, volume: 3 }];
overlapping.constructions[0]!.inputs.processes = [{ kind: "isobar", from: "A", to: "B" }, { kind: "isobar", from: "A", to: "C" }];
refuses(overlapping, "partially duplicated process geometry");

const statesOf = (document: SceneDocument) => document.constructions[0]!.inputs.states as Record<string, unknown>[];
const edgesOf = (document: SceneDocument) => document.constructions[0]!.inputs.processes as Record<string, unknown>[];
const negativeCases: Array<[string, (document: SceneDocument) => void]> = [
  ["sloped isobar", (d) => { statesOf(d)[1]!.pressure = 1.01; }],
  ["quantity reference in a conceptual state", (d) => { statesOf(d)[0]!.pressure = "pa"; }],
  ["missing conceptual source provenance", (d) => { delete d.source.nonMetric; }],
  ["conceptual exact-tier promotion", (d) => { d.source.representationTier = "exact_verified"; }],
  ["unused state", (d) => { statesOf(d).push({ id: "C", pressure: 3, volume: 3 }); }],
  ["coincident different states", (d) => { statesOf(d)[1]!.volume = 1; }],
  ["unknown process endpoint", (d) => { edgesOf(d)[0]!.to = "Z"; }],
  ["loop to the same identity", (d) => { edgesOf(d)[0]!.to = "A"; }],
  ["reverse duplicate process", (d) => { edgesOf(d).push({ kind: "isobar", from: "B", to: "A" }); }],
  ["unknown process law", (d) => { edgesOf(d)[0]!.kind = "polytrope"; }],
  ["missing endpoint coordinate", (d) => { delete statesOf(d)[1]!.volume; }],
  ["value-bearing state name", (d) => { statesOf(d)[1]!.id = "B=2Pa"; }],
  ["too few states", (d) => { statesOf(d).pop(); }],
  ["too many states", (d) => { d.constructions[0]!.inputs.states = Array.from({ length: 9 }, (_, i) => ({ id: `A${i}`, pressure: 1, volume: i + 1 })); }],
  ["too many processes", (d) => { d.constructions[0]!.inputs.processes = Array.from({ length: 9 }, () => ({ kind: "isobar", from: "A", to: "B" })); }],
  ["empty processes", (d) => { d.constructions[0]!.inputs.processes = []; }],
  ["collapsed final display change", (d) => { statesOf(d)[1]!.volume = 1 + 1e-10; }],
];
for (const [reason, change] of negativeCases) { const document = conceptual(); change(document); refuses(document, reason); }
for (const coordinate of [0, -1, NaN, Infinity, 1e13, "1", { value: 1 }]) {
  const document = conceptual(); statesOf(document)[0]!.pressure = coordinate; refuses(document, `nonpositive/nonliteral/unbounded state ${JSON.stringify(coordinate)}`);
}
for (const key of ["pressureUnit", "volumeUnit", "gamma", "origin", "axes", "xLabel", "samples", "expression", "work", "points", "arrow"]) {
  const document = conceptual(); document.constructions[0]!.inputs[key] = "unsupported"; refuses(document, `unsupported ${key} input`);
}
for (const gamma of [undefined, 0, 1, -2, 64.1, NaN, Infinity]) {
  const document = physicalPvDocument(); document.quantities.find((quantity) => quantity.id === "gamma")!.value = gamma; refuses(document, `invalid explicit physical gamma ${gamma}`);
}
for (const [key, value] of [["value", { value: 200, unit: "kPa" }], ["value", "200"], ["value", "pb"], ["unit", undefined], ["unit", "Pa"], ["unit", "L"]]) {
  const document = physicalPvDocument(); document.quantities[0]![key as "value" | "unit"] = value; refuses(document, `unproved reference ${key} ${JSON.stringify(value)}`);
}
for (const kind of ["isochor", "isotherm", "adiabat"]) {
  const document = conceptual(); edgesOf(document)[0]!.kind = kind; refuses(document, `endpoints inconsistent with ${kind}`);
}
for (const operator of ["label", "translate", "process_state", "curve_anchor", "tangent_line", "affine_path"]) {
  const document = conceptual(); document.entities.push({ id: "derived", kind: operator === "label" ? "label" : "point", role: "unsupported sealed-plot consumer", ...(operator === "label" ? { label: "P=3 Pa" } : {}) });
  document.constructions.push({ id: "consume", operator, inputs: { target: "plot", source: "plot", point: "plot", process: "plot", curve: "plot", path: "plot", at: 0.5, vector: [1, 0], text: "P=3 Pa" }, outputs: ["derived"] });
  document.requiredEntityIds.push("derived"); document.revealGroups[0]!.entityIds.push("derived"); refuses(document, `${operator} erasing plot authority`);
}
const reversed = physicalPvDocument(); edgesOf(reversed).forEach((edge) => { [edge.from, edge.to] = [edge.to, edge.from]; });
const reverseResult = compileSceneDocument(reversed); assert.ok(reverseResult.ok && reverseResult.renderScene);
assert.ok(Number(reverseResult.renderScene.primitives.find((primitive) => primitive.id === "plot_process_0")?.provenance?.pvWorkJ) < 0 && Number(reverseResult.renderScene.primitives.find((primitive) => primitive.id === "plot_process_1")?.provenance?.pvWorkJ) < 0, "compression preserves signed physical work");
const si = physicalPvDocument(); si.constructions[0]!.inputs.pressureUnit = "Pa"; si.constructions[0]!.inputs.volumeUnit = "m^3";
for (const quantity of si.quantities) { if (quantity.unit === "kPa") { quantity.value = Number(quantity.value) * 1000; quantity.unit = "Pa"; } else if (quantity.unit === "L") { quantity.value = Number(quantity.value) / 1000; quantity.unit = "m^3"; } }
const siResult = compileSceneDocument(si); assert.ok(siResult.ok && siResult.renderScene);
for (const primitive of physicalInk.filter((primitive) => primitive.kind !== "label")) {
  const equivalent = siResult.renderScene.primitives.find((candidate) => candidate.id === primitive.id)!;
  assert.deepEqual(equivalent.points, primitive.points, "whole-plot unit conversion preserves shared geometry");
  if (primitive.provenance?.pvWorkJ !== undefined) assert.ok(Math.abs(Number(equivalent.provenance?.pvWorkJ) - Number(primitive.provenance.pvWorkJ)) < 1e-10, "unit conversion preserves SI work");
}
const scaled = compileSceneDocument(physical, { viewport: { x: 450, y: 30, width: 650, height: 600 } }); assert.ok(scaled.ok && scaled.renderScene);
assert.equal(scaled.renderScene.primitives.find((primitive) => primitive.id === "plot_process_0")?.provenance?.pvWorkJ, isothermalWork, "fitting never changes SI work");
console.log(`P-V process: ${refusals} strict refusals; physical direction/unit/fitting controls passed`);

for (const gamma of [1 + 1e-6, 2, 64]) {
  const document = conceptual(); statesOf(document)[1]!.volume = gamma === 64 ? 1.02 : 2;
  statesOf(document)[1]!.pressure = Number(statesOf(document)[1]!.volume) ** -gamma;
  edgesOf(document)[0]!.kind = "adiabat";
  const result = compileSceneDocument(document); assert.ok(result.ok && result.renderScene, `representative endpoint exponent ${gamma} has no default gamma`);
  assert.ok(!/pressureSI|volumeSI|physicalProcess|pvWorkJ|workJ|gamma/.test(JSON.stringify(result.renderScene)), "conceptual render carries no physical authority or gas-constant claim");
}
const adjacent = conceptual();
adjacent.constructions[0]!.inputs.states = [{ id: "A", pressure: 1, volume: 1 }, { id: "B", pressure: 1, volume: 2 }, { id: "C", pressure: 1, volume: 3 }];
adjacent.constructions[0]!.inputs.processes = [{ kind: "isobar", from: "A", to: "B" }, { kind: "isobar", from: "B", to: "C" }];
assert.ok(compileSceneDocument(adjacent).ok, "adjacent law segments may share their coherent endpoint without overlapping");
const externalInk = conceptual();
externalInk.entities.push({ id: "anchor", kind: "point", role: "unrelated annotation anchor" }, { id: "claim", kind: "label", role: "unrelated claim", label: "gamma=1.4" });
externalInk.constructions.push({ id: "make_anchor", operator: "point", inputs: { x: 6, y: 3 }, outputs: ["anchor"] }, { id: "make_claim", operator: "label", inputs: { at: "anchor", text: "gamma=1.4" }, outputs: ["claim"] });
externalInk.requiredEntityIds.push("anchor", "claim"); externalInk.revealGroups[0]!.entityIds.push("anchor", "claim");
refuses(externalInk, "unrelated geometry smuggling physical claims into a conceptual plot");
const narrated = conceptual(); narrated.annotations.push({ id: "spoken", kind: "narration", targetIds: ["plot"], text: "Follow the representative process" });
assert.ok(compileSceneDocument(narrated).ok, "narration-only annotations add no plot ink");
console.log(`P-V process complete: ${refusals} direct/yield/normalized refusals; all native law/model/display controls passed`);
