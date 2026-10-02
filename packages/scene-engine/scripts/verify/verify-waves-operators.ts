import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import { WAVES_OPERATORS, evaluateWavesConstruction, wavesConstructionOutputLabels, validateWavesConstruction, type WavesEvaluationContext, type WavesGeometry } from "../../src/compile/wavesGeometry";
import { calculusAnchorResidual, evaluateCalculusConstruction } from "../../src/compile/calculusGeometry";
const geometries = new Map<string, unknown>();
const quantityValues = new Map<string, number>([["amplitude", 2], ["k", 1], ["omega", 3], ["phase", 0], ["clock", 0], ["probe", Math.PI / 2]]);
const context: WavesEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const resolved = typeof value === "string" && quantityValues.has(value) ? quantityValues.get(value)! : Number(value);
    if (!Number.isFinite(resolved)) throw new Error("not finite");
    return resolved;
  },
  point(value) {
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: context.number(value.x), y: context.number(value.y) };
    throw new Error("not a point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-10): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function closePoint(actual: RenderPoint, expected: RenderPoint, message: string): void { close(actual.x, expected.x, `${message} x`); close(actual.y, expected.y, `${message} y`); }
const specimen = evaluateWavesConstruction("harmonic_wave", {
  amplitude: 2, waveNumber: 1, angularFrequency: 3, phase: 0, phaseUnit: "rad", time: 0,
  xMin: 0, xMax: 2 * Math.PI,
}, context)[0]!;
check(specimen.kind === "path", "harmonic wave must be an analytic sampled path");
closePoint(specimen.sampledCurve.evaluate(Math.PI / 2), { x: Math.PI / 2, y: 2 }, "harmonic quarter-period oracle");
closePoint(specimen.sampledCurve.derivative(0), { x: 1, y: 2 }, "analytic spatial derivative");
check(specimen.points.length >= 33, "spatial oscillation sampling cannot alias into a flat path");
geometries.set("positive", specimen);
const negative = evaluateWavesConstruction("harmonic_wave", {
  amplitude: -2, waveNumber: 1, angularFrequency: 3, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 2 * Math.PI,
}, context)[0]!;
geometries.set("negative", negative);
const cancelled = evaluateWavesConstruction("wave_superposition", { waves: ["positive", "negative"] }, context)[0]!;
check(cancelled.kind === "path" && cancelled.waveDefinition.zeroCertified, "identical opposite-amplitude sources must certify a zero baseline");
closePoint(cancelled.sampledCurve.evaluate(0.7), { x: 0.7, y: 0 }, "certified cancellation oracle");
const sample = evaluateWavesConstruction("wave_sample", { wave: "positive", x: Math.PI / 2 }, context)[0]!;
check(sample.kind === "point", "wave_sample must be a computed point");
close(sample.waveSample.value, 2, "sample physical amplitude");
closePoint(sample.point, { x: Math.PI / 2, y: 2 }, "analytic sample position");
check(sample.calculusAnchor.curveId === "positive" && sample.calculusAnchor.parameter === Math.PI / 2, "sample carries exact parameter-pinned incidence");
function scene(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-defined harmonic wave" }, source: {}, quantities: [],
    entities: [{ id: "wave", kind: "polyline", role: "harmonic displacement" }, { id: "sample", kind: "point", role: "analytic sample" }],
    constructions: [
      { id: "make_wave", operator: "harmonic_wave", inputs: { amplitude: 2, waveNumber: 1, angularFrequency: 3, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 2 * Math.PI }, outputs: ["wave"] },
      { id: "make_sample", operator: "wave_sample", inputs: { wave: "wave", x: Math.PI / 2 }, outputs: ["sample"] },
    ],
    relations: [], assertions: [{ id: "sample_incidence", predicate: "on", entities: ["sample", "wave"], tolerance: 1e-10, severity: "fatal" }], annotations: [],
    requiredEntityIds: ["wave", "sample"], revealGroups: [{ id: "waves", entityIds: ["wave", "sample"], dependsOn: [], narrationCue: "harmonic wave" }], teachingTimeline: [],
  };
}
function validationIssues(document: SceneDocument, index = 0): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  validateWavesConstruction(document.constructions[index]!, index, document, byOutput, issues);
  return issues;
}
check(validationIssues(scene()).length === 0, "explicit harmonic source must validate");
const staleSample = scene(); staleSample.entities[1]!.label = "y=999";
check(validationIssues(staleSample, 1).some((issue) => issue.severity === "fatal"), "computed wave sample cannot pair with a stale numerical result label");

const base = { amplitude: 1, waveNumber: 1, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 2 * Math.PI };
function wave(inputs: Record<string, unknown> = {}): Extract<WavesGeometry, { kind: "path" }> {
  const result = evaluateWavesConstruction("harmonic_wave", { ...base, ...inputs }, context)[0]!;
  check(result.kind === "path", "harmonic output kind");
  return result;
}
function superposition(ids: string[], inputs: Record<string, unknown> = {}): Extract<WavesGeometry, { kind: "path" }> {
  const result = evaluateWavesConstruction("wave_superposition", { waves: ids, ...inputs }, context)[0]!;
  check(result.kind === "path", "superposition output kind");
  return result;
}
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void {
  let rejected = false;
  try { evaluateWavesConstruction(operator, inputs, context); } catch { rejected = true; }
  check(rejected, message);
}
const delayed = wave({ amplitude: 2, angularFrequency: 3, time: Math.PI / 6 });
closePoint(delayed.sampledCurve.evaluate(0), { x: 0, y: -2 }, "time phase shift oracle");
closePoint(delayed.sampledCurve.derivative(Math.PI / 2), { x: 1, y: 2 }, "time-shifted analytic derivative oracle");
const transformed = wave({ amplitude: 2, origin: { x: 5, y: 7 }, xScale: 2, yScale: 3 });
geometries.set("transformed", transformed);
const transformedSample = evaluateWavesConstruction("wave_sample", { wave: "transformed", x: Math.PI / 2 }, context)[0]!;
check(transformedSample.kind === "point", "transformed sample kind");
closePoint(transformedSample.point, { x: 5 + Math.PI, y: 13 }, "display transformation preserves physical parameter identity");
close(transformedSample.waveSample.value, 2, "display y is distinct from physical amplitude");
check(wavesConstructionOutputLabels("wave_sample", [transformedSample])[0] === "y=2", "sample label derives physical value rather than display offset");
close(calculusAnchorResidual(transformedSample, transformed, "transformed")!, 0, "transformed sample exact parameter-pinned incidence");
const derivative = evaluateCalculusConstruction("curve_derivative", { curve: "transformed", at: 0, parameterScale: 0.25 }, context)[0]!;
check(derivative.kind === "path" && derivative.directed, "calculus consumes analytic wave callbacks");
closePoint(derivative.points[1]!, { x: 5.5, y: 8.5 }, "display derivative chain rule");
const right = wave({ waveNumber: 2, angularFrequency: 3, time: 0.4, xMax: Math.PI });
const left = wave({ waveNumber: 2, angularFrequency: -3, time: 0.4, xMax: Math.PI });
geometries.set("right", right); geometries.set("left", left);
const standing = superposition(["right", "left"]);
close(standing.sampledCurve.evaluate(Math.PI / 4).y, 0.7247155089533472, "counter-propagating standing-wave displacement oracle");
close(standing.sampledCurve.derivative(0).y, 1.4494310179066945, "standing-wave slope oracle");
close(standing.sampledCurve.evaluate(0).y, 0, "standing-wave zero boundary is certified by opposite exact arguments");
geometries.set("left_negative", wave({ amplitude: -1, waveNumber: 2, angularFrequency: -3, time: 0.4, xMax: Math.PI }));
const standingDifference = superposition(["right", "left_negative"]);
close(standingDifference.sampledCurve.evaluate(0).y, -1.8640781719344526, "opposite temporal phases with opposite amplitudes use the cosine identity");
close(standingDifference.sampledCurve.derivative(Math.PI / 4).y, 3.728156343868905, "cosine identity retains the derivative sign");
const reversedWave = wave({ amplitude: 2, waveNumber: -1, angularFrequency: -3, time: 0 });
close(reversedWave.sampledCurve.evaluate(Math.PI / 2).y, -2, "negative spatial phase retains displacement sign");
close(reversedWave.sampledCurve.derivative(0).y, -2, "negative spatial phase retains derivative sign");
const beatA = wave({ waveNumber: 10, xMax: Math.PI });
const beatB = wave({ waveNumber: 12, xMax: Math.PI });
geometries.set("beat_a", beatA); geometries.set("beat_b", beatB);
const beat = superposition(["beat_a", "beat_b"]);
close(beat.sampledCurve.evaluate(Math.PI / 4).y, 1, "two-frequency spatial-beat quarter-domain oracle");
close(beat.sampledCurve.evaluate(Math.PI / 2).y, 0, "beat-envelope node oracle");
close(beat.sampledCurve.derivative(0).y, 22, "beat derivative adds source wave numbers");
const reversed = superposition(["beat_b", "beat_a"]);
check(JSON.stringify(beat.points) === JSON.stringify(reversed.points), "superposition is source-order deterministic");
check(JSON.stringify(beat.waveDefinition) === JSON.stringify(reversed.waveDefinition), "superposition source metadata is source-order deterministic");
const zeroAmplitude = wave({ amplitude: 0, waveNumber: 1e6 });
check(zeroAmplitude.waveDefinition.zeroCertified && zeroAmplitude.points.every((point) => point.y === 0), "zero amplitude produces a certified flat baseline without unnecessary high-frequency sampling");
geometries.set("one", wave()); geometries.set("almost_minus", wave({ amplitude: -1 - 2 ** -40 }));
const smallRemainder = superposition(["one", "almost_minus"]);
check(!smallRemainder.waveDefinition.zeroCertified && smallRemainder.sampledCurve.evaluate(Math.PI / 2).y < 0, "nearly opposite amplitudes cannot be labeled as exact zero");
close(smallRemainder.sampledCurve.evaluate(Math.PI / 2).y, -(2 ** -40), "exact amplitude remainder survives superposition", 1e-25);
const exactPhase = wave({ waveNumber: 1, angularFrequency: 1, phase: 1, time: 1, xMax: 1 });
close(exactPhase.sampledCurve.evaluate(1e-20).y, 1e-20, "phase cancellation retains a small exact nonzero remainder", 1e-30);
const referenced = wave({ amplitude: { value: "amplitude" }, waveNumber: "k", angularFrequency: "omega", phase: "phase", time: "clock" });
check(JSON.stringify(referenced.points) === JSON.stringify(specimen.points), "source quantity bindings must retain deterministic wave geometry");
check(WAVES_OPERATORS.length === 3, "wave public operator inventory");

const badHarmonics: Array<Record<string, unknown>> = [
  { amplitude: NaN }, { amplitude: Infinity }, { amplitude: null }, { waveNumber: true }, { angularFrequency: 1e10 },
  { phaseUnit: undefined }, { phaseUnit: "deg" }, { phase: { value: 90, unit: "deg" } }, { phase: 1e7 },
  { time: "" }, { time: 1e7, angularFrequency: 1 }, { xMin: 2, xMax: 2 }, { xMin: 3, xMax: 2 },
  { samples: 16 }, { samples: 32 }, { samples: 2049.5 }, { samples: 2050 }, { waveNumber: 65, samples: 2049 },
  { xScale: 0 }, { xScale: -1 }, { yScale: Infinity }, { yScale: { value: 2, unit: "m" } },
  { origin: { x: 1e13, y: 0 } }, { origin: { x: 0, y: 0, z: 1 } }, { origin: { x: 1e12, y: 0 }, xScale: 1e-9 },
  { amplitude: 1e-200, waveNumber: 1e-200 }, { amplitude: 1e9, yScale: 1e9 }, { extra: 1 },
  { units: { position: "m", time: "s" } }, { units: { position: "s", time: "s", amplitude: "m" } },
];
for (const mutation of badHarmonics) rejects("harmonic_wave", { ...base, ...mutation }, `malformed or aliased harmonic input must fail: ${JSON.stringify(mutation)}`);
rejects("wave_sample", { wave: "positive", x: -0.1 }, "sample cannot escape the physical domain");
rejects("wave_sample", { wave: "missing", x: 0 }, "sample requires a typed verified wave source");
rejects("wave_superposition", { waves: [] }, "superposition requires explicit sources");
rejects("wave_superposition", { waves: Array(17).fill("positive") }, "superposition source count bounded");
rejects("wave_superposition", { waves: ["positive"], samples: { value: 65, unit: "s" } }, "sampling counts cannot carry physical dimensions");
let nested = specimen;
for (let depth = 2; depth <= 16; depth += 1) {
  geometries.set("nested", nested);
  nested = superposition(["nested"]);
}
geometries.set("nested", nested);
rejects("wave_superposition", { waves: ["nested"] }, "superposition composition depth is bounded");
geometries.set("sixteen", superposition(Array(16).fill("positive")));
geometries.set("thirty_two", superposition(["sixteen", "sixteen"]));
rejects("wave_superposition", { waves: ["thirty_two", "positive"] }, "total retained harmonic count is bounded independently of source count");
for (const mutation of [{ time: 1 }, { origin: { x: 1, y: 0 } }, { xScale: 2 }, { yScale: 2 }, { xMax: Math.PI }, { units: { position: "m", time: "s", amplitude: "m" } }]) {
  geometries.set("incompatible", wave({ amplitude: 2, angularFrequency: 3, ...mutation }));
  rejects("wave_superposition", { waves: ["positive", "incompatible"] }, "superposition cannot combine different snapshots, domains, frames, scales, or units");
}
for (const bad of [
  { kind: "path", points: specimen.points, sampledCurve: specimen.sampledCurve },
  { ...specimen, electricField: {} }, { ...specimen, vectorDefinition: {} },
  { ...specimen, waveDefinition: { ...specimen.waveDefinition, zeroCertified: true } },
  { ...specimen, waveDefinition: { ...specimen.waveDefinition, samples: 17 } },
]) {
  geometries.set("bad", bad);
  rejects("wave_sample", { wave: "bad", x: 0 }, "malformed or protected source metadata must reject");
}
const sourceUnits = scene();
sourceUnits.quantities = [
  { id: "A", value: 2, unit: "Pa" }, { id: "k", value: 1, unit: "rad/m" }, { id: "omega", value: 3, unit: "rad/s" },
  { id: "phi", value: 0, unit: "rad" }, { id: "time", value: 0, unit: "second" }, { id: "probe", value: Math.PI / 2, unit: "metre" },
];
Object.assign(sourceUnits.constructions[0]!.inputs, { amplitude: "A", waveNumber: "k", angularFrequency: "omega", phase: "phi", time: "time", units: { position: "m", time: "s", amplitude: "Pa" } });
sourceUnits.constructions[1]!.inputs.x = "probe";
check(validationIssues(sourceUnits).length === 0 && validationIssues(sourceUnits, 1).length === 0, "compatible pressure-wave source quantities and physical sample coordinate units must validate");
for (const [id, unit] of [["A", "m"], ["k", "rad/cm"], ["omega", "Hz"], ["phi", "deg"], ["time", "ms"], ["probe", "cm"]]) {
  const candidate = structuredClone(sourceUnits); candidate.quantities.find((quantity) => quantity.id === id)!.unit = unit;
  check(validationIssues(candidate, id === "probe" ? 1 : 0).some((issue) => issue.severity === "fatal"), "known source-unit mismatch cannot be silently reinterpreted");
}
const annotation = scene(); annotation.annotations.push({ id: "false_result", kind: "label", targetIds: ["sample"], text: "y=999" });
check(validationIssues(annotation, 1).some((issue) => issue.severity === "fatal"), "independent numerical annotations cannot override computed samples");
const cycle = scene(); cycle.constructions[0] = { id: "self_sum", operator: "wave_superposition", inputs: { waves: ["wave"] }, outputs: ["wave"] };
check(validationIssues(cycle).some((issue) => issue.severity === "fatal"), "wave reference cycles fail closed");
const derivedOrigin = scene();
derivedOrigin.entities.push({ id: "origin", kind: "point", role: "constructed 2D placement" });
derivedOrigin.constructions.unshift({ id: "derived_origin", operator: "midpoint", inputs: { a: "left", b: "right" }, outputs: ["origin"] });
derivedOrigin.constructions[1]!.inputs.origin = "origin";
check(validationIssues(derivedOrigin, 1).length === 0, "structural wave validation defers genuinely derived 2D origin coordinates");
for (const mutation of [{ samples: 32 }, { samples: "bad" }, { amplitude: 1e9, yScale: 1e9 }, { angularFrequency: 1, time: 1e7 }]) {
  const candidate = structuredClone(derivedOrigin); Object.assign(candidate.constructions[1]!.inputs, mutation);
  check(validationIssues(candidate, 1).some((issue) => issue.severity === "fatal"), "derived origins cannot defer invalid scalar, sampling, or physical envelope checks");
}
const derivedUnits = structuredClone(sourceUnits);
derivedUnits.entities.push({ id: "origin", kind: "point", role: "derived placement" });
derivedUnits.requiredEntityIds.push("origin"); derivedUnits.revealGroups[0]!.entityIds.push("origin");
derivedUnits.constructions.unshift({ id: "derived_origin", operator: "triangle_center", inputs: { a: { x: 0, y: 0 }, b: { x: 9, y: 0 }, c: { x: 0, y: 12 }, kind: "centroid" }, outputs: ["origin"] });
derivedUnits.constructions[1]!.inputs.origin = "origin";
check(validationIssues(derivedUnits, 2).length === 0, "compatible sample units remain valid with derived wave origins");
const wrongDerivedSampleUnits = structuredClone(derivedUnits);
wrongDerivedSampleUnits.quantities.find((quantity) => quantity.id === "probe")!.unit = "cm";
check(validationIssues(wrongDerivedSampleUnits, 2).some((issue) => issue.severity === "fatal"), "derived origins cannot defer incompatible sample-coordinate units");

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), sourceUnits]) {
    const before = JSON.stringify(candidate);
    const validated = validateSceneDocument(candidate);
    check(validated.document, `waves scene invalid: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(candidate);
    check(result.ok && result.renderScene, `waves scene compile failure: ${JSON.stringify(result.report.issues)}`);
    check(result.renderScene.primitives.some((primitive) => primitive.entityId === "wave" && primitive.kind === "polyline"), "verified wave graph renders a sampled curve");
    check(result.renderScene.primitives.some((primitive) => primitive.entityId === "sample" && primitive.kind === "label" && primitive.text === "y=2"), "physical sample label is derived by the engine");
    check(JSON.stringify(candidate) === before, "wave compile must not mutate its input document");
    check(JSON.stringify(result.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "wave compile is deterministic");
  }
  const scaledScene = scene(); Object.assign(scaledScene.constructions[0]!.inputs, { origin: { x: 5, y: 7 }, xScale: 2, yScale: 3 });
  const scaledResult = compileSceneDocument(scaledScene);
  check(scaledResult.ok && scaledResult.renderScene, `scaled wave exact sample incidence: ${JSON.stringify(scaledResult.report.issues)}`);
  const derivedResult = compileSceneDocument(derivedUnits);
  check(derivedResult.ok && derivedResult.renderScene, `constructed 2D origin composes with unit-checked waves: ${JSON.stringify(derivedResult.report.issues)}`);
  for (const mutation of badHarmonics) {
    const candidate = scene(); Object.assign(candidate.constructions[0]!.inputs, base, mutation);
    const result = compileSceneDocument(candidate);
    check(!result.ok && result.renderScene === null, `malformed wave cannot emit partial geometry: ${JSON.stringify(mutation)}`);
  }
  for (const candidate of [staleSample, annotation, cycle, wrongDerivedSampleUnits]) {
    const result = compileSceneDocument(candidate);
    check(!result.ok && result.renderScene === null, "invalid wave result authority cannot render a partial scene");
  }
}
console.log(`waves operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
