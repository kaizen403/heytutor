import { parseMathExpression } from "../../src/math/expression";
import { evaluateCalculusConstruction, validateCalculusConstruction, validateAnalyticLineConstruction, calculusAnchorResidual, type CalculusEvaluationContext } from "../../src/compile/calculusGeometry";
import { evaluateWavesConstruction } from "../../src/compile/wavesGeometry";
import { evaluateThermodynamicsConstruction } from "../../src/compile/thermodynamicsGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const derivative = parseMathExpression("x^3+2*x").derivative(2);
if (derivative !== 14) throw new Error("analytic derivative must equal the worked polynomial oracle");
const expression = parseMathExpression("x^3");
const geometries = new Map<string, unknown>([["curve", { kind: "path", points: [{ x: -2, y: -8 }, { x: 2, y: 8 }], sampledCurve: { curveKind: "function", parameterMin: -2, parameterMax: 2, evaluate: (x: number) => ({ x, y: expression.evaluate(x) }), derivative: (x: number) => ({ x: 1, y: expression.derivative(x) }) } }]]);
const context: CalculusEvaluationContext = { number: Number, point() { return { x: 0, y: 0 }; }, geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; } };
const [anchor] = evaluateCalculusConstruction("curve_anchor", { curve: "curve", at: 1.5 }, context);
if (anchor?.kind !== "point" || anchor.point.x !== 1.5 || anchor.point.y !== 3.375) throw new Error("curve anchor must use the analytic expression rather than interpolated chords");
let checks = 2;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string): void { check(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`); }
const [secant] = evaluateCalculusConstruction("curve_secant", { curve: "curve", first: -1, second: 2 }, context);
check(secant?.kind === "path" && secant.infinite, "secant must retain infinite line identity");
close(secant.points[0]!.x, -1, "first secant endpoint x"); close(secant.points[0]!.y, -1, "first secant endpoint y");
close(secant.points[1]!.x, 2, "second secant endpoint x"); close(secant.points[1]!.y, 8, "second secant endpoint y");
close((secant.points[1]!.y - secant.points[0]!.y) / (secant.points[1]!.x - secant.points[0]!.x), 3, "worked secant slope");
const [velocity] = evaluateCalculusConstruction("curve_derivative", { curve: "curve", at: 1.5, parameterScale: 3 }, context);
check(velocity?.kind === "path" && velocity.directed && velocity.calculusDerivative, "exact curve derivative must preserve parameter and unscaled derivative metadata");
close(velocity.points[1]!.x, 4.5, "derivative vector x oracle"); close(velocity.points[1]!.y, 23.625, "derivative vector y oracle");
close(velocity.calculusDerivative.derivative.x, 1, "unscaled dx/dx"); close(velocity.calculusDerivative.derivative.y, 6.75, "unscaled dy/dx");
for (const [source, at, expected] of [
  ["x^4", -2, -32], ["-x^2", 3, -6], ["2^x", 3, 8 * Math.log(2)], ["x^x", 2, 4 * (1 + Math.log(2))],
  ["sin(2*x)", Math.PI / 6, 1], ["cos(x)", Math.PI / 2, -1], ["tan(x)", Math.PI / 4, 2],
  ["asin(x)", 0, 1], ["acos(x)", 0, -1], ["atan(x)", 1, 0.5], ["sqrt(x)", 4, 0.25], ["abs(x)", -2, -1],
  ["exp(x)", 0, 1], ["log(x)", Math.E, 1 / Math.E], ["ln(x)", 1, 1], ["sqrt(1+x^2)", Math.sqrt(3), Math.sqrt(3) / 2],
  ["x/(1+x^2)", 2, -3 / 25], ["x^0.5", 4, 0.25], ["sqrt(0)", 2, 0], ["abs(0)", 2, 0], ["x^0", 0, 0],
] as const) close(parseMathExpression(source).derivative(at), expected, `independent analytic derivative oracle ${source}`);
for (const [source, at] of [["abs(x)", 0], ["abs(x^2)", 0], ["sqrt(x)", 0], ["asin(x)", 1], ["acos(x)", -1], ["tan(x)", Math.PI / 2], ["1/x", 0], ["x^0.5", -1], ["(-2)^x", 3], ["log(x)", 0], ["x^x", 0], ["exp(x)", 1000], ["x", 1e12 + 1]] as const) {
  let threw = false; try { parseMathExpression(source).derivative(at); } catch { threw = true; }
  check(threw, `undefined, uncertifiable, or unbounded derivative must reject ${source} at ${at}`);
}
// abs(g)=0 remains conservatively unsupported even when g'(at)=0; no symbolic-zero certificate is fabricated.
const cosine = parseMathExpression("2*cos(x)"); const sine = parseMathExpression("2*sin(x)");
geometries.set("circle", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: 0, parameterMax: 2 * Math.PI, evaluate: (t: number) => ({ x: cosine.evaluate(t), y: sine.evaluate(t) }), derivative: (t: number) => ({ x: cosine.derivative(t), y: sine.derivative(t) }) } });
const [circleVelocity] = evaluateCalculusConstruction("curve_derivative", { curve: "circle", at: Math.PI / 2, parameterScale: 3 }, context);
check(circleVelocity?.kind === "path", "parametric circle derivative vector"); close(circleVelocity.points[1]!.x, -6, "parametric derivative x"); close(circleVelocity.points[1]!.y, 2, "parametric derivative y");
geometries.set("spiral", { kind: "path", sampledCurve: { curveKind: "polar", parameterMin: 0, parameterMax: Math.PI, evaluate: (theta: number) => ({ x: theta * Math.cos(theta), y: theta * Math.sin(theta) }), derivative: (theta: number) => ({ x: Math.cos(theta) - theta * Math.sin(theta), y: Math.sin(theta) + theta * Math.cos(theta) }) } });
const [spiralVelocity] = evaluateCalculusConstruction("curve_derivative", { curve: "spiral", at: Math.PI / 2, parameterScale: 2 }, context);
check(spiralVelocity?.kind === "path", "polar derivative vector"); close(spiralVelocity.points[1]!.x, -Math.PI, "polar derivative x"); close(spiralVelocity.points[1]!.y, Math.PI / 2 + 2, "polar derivative y");
const square = parseMathExpression("x^2"); const cube = parseMathExpression("x^3");
geometries.set("stationary-parameter", { kind: "path", sampledCurve: { curveKind: "parametric", parameterMin: -1, parameterMax: 1, evaluate: (t: number) => ({ x: square.evaluate(t), y: cube.evaluate(t) }), derivative: (t: number) => ({ x: square.derivative(t), y: cube.derivative(t) }) } });
const [zero] = evaluateCalculusConstruction("curve_derivative", { curve: "stationary-parameter", at: 0, parameterScale: 3 }, context);
check(zero?.kind === "point" && zero.calculusDerivative?.derivative.x === 0 && zero.calculusDerivative.derivative.y === 0, "proven zero derivative must produce a point without inventing a direction");
const [endpoint] = evaluateCalculusConstruction("curve_derivative", { curve: "curve", at: 2, parameterScale: 1 }, context);
check(endpoint?.kind === "path", "analytic derivative may use a valid domain endpoint"); close(endpoint.calculusDerivative!.derivative.y, 12, "exact derivative at endpoint");
close(calculusAnchorResidual(anchor, geometries.get("curve"), "curve")!, 0, "exact parameter-pinned anchor incidence");
close(calculusAnchorResidual({ ...anchor, point: { x: 1.5, y: 3.575 } }, geometries.get("curve"), "curve")!, 0.2, "off-curve anchor must fail analytic incidence");
check(calculusAnchorResidual(anchor, geometries.get("circle"), "circle") === null, "another curve does not inherit the anchor's parameter identity");
const [extended] = evaluateCalculusConstruction("curve_secant", { curve: "curve", first: -1, second: 2, span: 100 }, context);
check(extended?.kind === "path", "secant span path"); close(Math.hypot(extended.points[1]!.x - extended.points[0]!.x, extended.points[1]!.y - extended.points[0]!.y), 100, "explicit world secant span");
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void { let threw = false; try { evaluateCalculusConstruction(operator, inputs, context); } catch { threw = true; } check(threw, message); }
for (const [operator, inputs] of [
  ["curve_anchor", { at: 3 }], ["curve_anchor", { at: null }], ["curve_anchor", { at: false }], ["curve_anchor", { at: " " }], ["curve_anchor", { at: Infinity }], ["curve_anchor", { at: 1, extra: true }],
  ["curve_secant", { first: 1, second: 1 }], ["curve_secant", { first: 1, second: 1 + Number.EPSILON }], ["curve_secant", { first: -3, second: 2 }], ["curve_secant", { first: -1, second: 2, span: 1 }], ["curve_secant", { first: -1, second: 2, span: 1e9 + 1 }],
  ["curve_derivative", { at: 1, parameterScale: 0 }], ["curve_derivative", { at: 1, parameterScale: -1 }], ["curve_derivative", { at: 1, parameterScale: 1e9 + 1 }], ["curve_derivative", { at: 1, parameterScale: 1e-9 }],
] as const) rejects(operator, { curve: "curve", ...inputs }, "invalid calculus inputs must fail closed");
rejects("curve_secant", { curve: "circle", first: 0, second: 2 * Math.PI }, "distinct circle parameters with coincident endpoints do not determine a secant");
geometries.set("no-derivative", { kind: "path", sampledCurve: { curveKind: "function", parameterMin: -2, parameterMax: 2, evaluate: (x: number) => ({ x, y: x * x }) } });
rejects("curve_derivative", { curve: "no-derivative", at: 1, parameterScale: 1 }, "missing analytic callback cannot fall back to approximate derivatives");
for (const metadata of [{ spaceLine: {} }, { electricField: {} }, { markedAngleRadians: 1 }, { conic: {} }]) {
  geometries.set("protected", { kind: "path", sampledCurve: { curveKind: "function", parameterMin: -2, parameterMax: 2, evaluate: (x: number) => ({ x, y: x }) }, ...metadata });
  rejects("curve_anchor", { curve: "protected", at: 1 }, "protected metadata cannot be flattened into calculus points");
}
function scene(kind: "function" | "parametric" | "polar"): SceneDocument {
  const curveInputs = kind === "function" ? { expression: "x^3", xMin: -2, xMax: 2, samples: 17 }
    : kind === "parametric" ? { xExpression: "2*cos(t)", yExpression: "2*sin(t)", tMin: 0, tMax: Math.PI, samples: 17 }
      : { radiusExpression: "theta", thetaMin: 0, thetaMax: Math.PI, samples: 17 };
  const constructions = [
    { id: "make-curve", operator: `${kind === "function" ? "function" : kind === "parametric" ? "parametric" : "polar"}_curve`, inputs: curveInputs, outputs: ["curve"] },
    { id: "make-first", operator: "curve_anchor", inputs: { curve: "curve", at: kind === "function" ? -1 : 0 }, outputs: ["first"] },
    { id: "make-second", operator: "curve_anchor", inputs: { curve: "curve", at: kind === "function" ? 2 : Math.PI }, outputs: ["second"] },
    { id: "make-anchor", operator: "curve_anchor", inputs: { curve: "curve", at: { value: "at" } }, outputs: ["anchor"] },
    { id: "make-secant", operator: "curve_secant", inputs: { curve: "curve", first: kind === "function" ? -1 : 0, second: kind === "function" ? 2 : Math.PI }, outputs: ["secant"] },
    { id: "make-derivative", operator: "curve_derivative", inputs: { curve: "curve", at: "at", parameterScale: { value: "scale" } }, outputs: ["derivative"] },
    { id: "make-tangent", operator: "tangent_line", inputs: { curve: "curve", at: "at", span: 3 }, outputs: ["tangent"] },
    { id: "make-normal", operator: "normal_line", inputs: { curve: "curve", at: "at", span: 3 }, outputs: ["normal"] },
  ];
  const ids = constructions.flatMap((c) => c.outputs);
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "analytic anchors, secant, and exact derivative" }, source: {},
    quantities: [{ id: "at", value: kind === "function" ? 1.5 : Math.PI / 2, unit: kind === "polar" ? "rad" : "dimensionless" }, { id: "scale", value: 2, unit: kind === "polar" ? "rad" : "dimensionless" }],
    entities: ids.map((id) => ({ id, kind: id === "curve" ? "polyline" : ["first", "second", "anchor"].includes(id) ? "point" : id === "derivative" ? "vector" : "line", role: "analytic calculus geometry" })), constructions,
    relations: [], annotations: [], assertions: [
      { id: "first-on-curve", predicate: "incident", entities: ["first", "curve"], expected: true, severity: "fatal" },
      { id: "second-on-curve", predicate: "incident", entities: ["second", "curve"], expected: true, severity: "fatal" },
      { id: "anchor-on-curve", predicate: "incident", entities: ["anchor", "curve"], expected: true, severity: "fatal" },
      { id: "secant-through-first", predicate: "incident", entities: ["first", "secant"], expected: true, severity: "fatal" },
      { id: "secant-through-second", predicate: "incident", entities: ["second", "secant"], expected: true, severity: "fatal" },
      { id: "analytic-tangent-direction", predicate: "parallel", entities: ["derivative", "tangent"], expected: true, severity: "fatal" },
      { id: "analytic-normal-direction", predicate: "perpendicular", entities: ["tangent", "normal"], expected: true, severity: "fatal" },
    ], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show the verified calculus geometry" }], teachingTimeline: [],
  };
}
function structural(candidate: SceneDocument): SceneIssue[] {
  const map = new Map(candidate.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const))); const issues: SceneIssue[] = [];
  for (const [index, construction] of candidate.constructions.entries()) {
    if (["curve_anchor", "curve_secant", "curve_derivative"].includes(construction.operator)) validateCalculusConstruction(construction, index, candidate, map, issues);
    if (["tangent_line", "normal_line"].includes(construction.operator)) validateAnalyticLineConstruction(construction, index, candidate, map, issues);
  }
  return issues;
}
for (const kind of ["function", "parametric", "polar"] as const) check(structural(scene(kind)).length === 0, `valid ${kind} calculus must validate`);
const prefixScenes: SceneDocument[] = [];
for (const [kind, nativeUnit, incompatibleUnit] of [["function", "mm", "Mm"], ["parametric", "ms", "Ms"]] as const) {
  const candidate = scene(kind); const source = candidate.constructions[0]!;
  const names = kind === "function" ? ["xMin", "xMax"] : ["tMin", "tMax"];
  for (const name of names) source.inputs[name] = { value: source.inputs[name], unit: nativeUnit };
  if (kind === "function") (source.inputs.xMax as { unit: string }).unit = "Millimeters";
  for (const quantity of candidate.quantities) quantity.unit = nativeUnit;
  check(structural(candidate).length === 0, "canonical milli units remain valid calculus parameter scales");
  candidate.quantities.find((quantity) => quantity.id === "at")!.unit = incompatibleUnit;
  check(structural(candidate).some((issue) => issue.severity === "fatal"), "mega parameter units cannot alias milli source scales"); prefixScenes.push(candidate);
}
for (const mutate of [
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "at")!.unit = "m"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "scale")!.unit = "deg"; },
  (s: SceneDocument) => { s.quantities.find((q) => q.id === "at")!.value = "at"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-anchor")!.outputs = []; },
  (s: SceneDocument) => { s.entities.find((e) => e.id === "secant")!.kind = "vector"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-derivative")!.inputs.at = 3; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-anchor")!.inputs.at = { value: 1, unit: 42 }; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-anchor")!.inputs.at = { value: 1, guess: true }; },
] as const) { const candidate = scene("function"); mutate(candidate); check(structural(candidate).some((i) => i.severity === "fatal"), "invalid source values, units, kinds or arity must fail calculus validation"); }
function crossChapter(kind: "wave" | "sum" | "polytropic" | "isochoric"): SceneDocument {
  const candidate = scene("parametric"); const source = candidate.constructions[0]!;
  source.operator = kind === "isochoric" ? "isochoric_process" : kind === "polytropic" ? "polytropic_process" : "harmonic_wave";
  source.inputs = kind === "wave" || kind === "sum" ? { amplitude: 2, waveNumber: 1, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: Math.PI, origin: [3, 4], xScale: 2, yScale: 3, units: { position: "m", time: "s", amplitude: "m" } }
    : kind === "polytropic" ? { pressureStart: 8, volumeStart: 2, volumeEnd: 6, exponent: 1, pressureUnit: "kPa", volumeUnit: "L", origin: [3, 4], pressureScale: 3, volumeScale: 2, samples: 17 }
      : { pressureStart: 2, pressureEnd: 8, volume: 4, pressureUnit: "kPa", volumeUnit: "L", origin: [3, 4], pressureScale: 3, volumeScale: 2, samples: 17 };
  candidate.quantities.find((q) => q.id === "at")!.value = kind === "wave" || kind === "sum" ? Math.PI / 4 : 0.5;
  candidate.quantities.find((q) => q.id === "at")!.unit = kind === "wave" || kind === "sum" ? "m" : "dimensionless";
  candidate.quantities.find((q) => q.id === "scale")!.value = 0.25; candidate.quantities.find((q) => q.id === "scale")!.unit = candidate.quantities.find((q) => q.id === "at")!.unit;
  candidate.constructions.find((c) => c.id === "make-second")!.inputs.at = kind === "wave" || kind === "sum" ? Math.PI : 1;
  candidate.constructions.find((c) => c.id === "make-secant")!.inputs.second = kind === "wave" || kind === "sum" ? Math.PI : 1;
  if (kind === "sum") {
    source.outputs = ["wave-source"]; candidate.entities.push({ id: "wave-source", kind: "polyline", role: "verified source harmonic" }, { id: "wave-intermediate", kind: "polyline", role: "chained superposition" });
    candidate.constructions.splice(1, 0, { id: "make-wave-intermediate", operator: "wave_superposition", inputs: { waves: ["wave-source", "wave-source"] }, outputs: ["wave-intermediate"] }, { id: "make-wave-sum", operator: "wave_superposition", inputs: { waves: ["wave-intermediate", "wave-source"] }, outputs: ["curve"] });
    candidate.requiredEntityIds.push("wave-source", "wave-intermediate"); candidate.revealGroups[0]!.entityIds = candidate.requiredEntityIds;
  }
  return candidate;
}
for (const kind of ["wave", "sum", "polytropic", "isochoric"] as const) {
  const issues = structural(crossChapter(kind)); check(issues.length === 0, `cross-chapter ${kind} calculus must validate: ${JSON.stringify(issues)}`);
  const source = crossChapter(kind).constructions[0]!;
  let geometry: unknown;
  if (kind === "wave" || kind === "sum") {
    const harmonic = evaluateWavesConstruction("harmonic_wave", source.inputs, context)[0]!; geometries.set("cross-source", harmonic);
    const intermediate = evaluateWavesConstruction("wave_superposition", { waves: ["cross-source", "cross-source"] }, context)[0]!; geometries.set("cross-intermediate", intermediate);
    geometry = kind === "wave" ? harmonic : evaluateWavesConstruction("wave_superposition", { waves: ["cross-intermediate", "cross-source"] }, context)[0]!;
  } else geometry = evaluateThermodynamicsConstruction(source.operator, source.inputs, { ...context, point(value) { if (Array.isArray(value)) return { x: Number(value[0]), y: Number(value[1]) }; throw new Error("invalid inline origin"); } })[0]!;
  geometries.set("cross-curve", geometry);
  const at = kind === "wave" || kind === "sum" ? Math.PI / 4 : 0.5;
  const [anchor] = evaluateCalculusConstruction("curve_anchor", { curve: "cross-curve", at }, context);
  const [derivative] = evaluateCalculusConstruction("curve_derivative", { curve: "cross-curve", at, parameterScale: 0.25 }, context);
  check(anchor?.kind === "point" && derivative?.kind === "path", "cross-chapter exact anchor and derivative types");
  const expectedX = kind === "wave" || kind === "sum" ? 3 + Math.PI / 2 : 11;
  const expectedY = kind === "wave" ? 4 + 3 * Math.sqrt(2) : kind === "sum" ? 4 + 9 * Math.sqrt(2) : kind === "polytropic" ? 16 : 19;
  const dx = kind === "wave" || kind === "sum" ? 2 : kind === "polytropic" ? 8 : 0;
  const dy = kind === "wave" ? 3 * Math.sqrt(2) : kind === "sum" ? 9 * Math.sqrt(2) : kind === "polytropic" ? -12 : 18;
  close(anchor.point.x, expectedX, `${kind} independent anchor x`); close(anchor.point.y, expectedY, `${kind} independent anchor y`);
  close(derivative.calculusDerivative!.derivative.x, dx, `${kind} independent analytic dx`); close(derivative.calculusDerivative!.derivative.y, dy, `${kind} independent analytic dy`);
  close(derivative.points[1]!.x, expectedX + dx / 4, "cross-chapter exact scaled derivative x"); close(derivative.points[1]!.y, expectedY + dy / 4, "cross-chapter exact scaled derivative y");
  close(calculusAnchorResidual(anchor, geometry, "cross-curve")!, 0, "cross-chapter exact parameter-pinned incidence");
  const [secant] = evaluateCalculusConstruction("curve_secant", { curve: "cross-curve", first: 0, second: kind === "wave" || kind === "sum" ? Math.PI : 1 }, context);
  check(secant?.kind === "path" && secant.infinite, "cross-chapter secant retains line identity");
  const chordX = kind === "wave" || kind === "sum" ? 2 * Math.PI : kind === "polytropic" ? 8 : 0;
  const chordY = kind === "wave" || kind === "sum" ? 0 : kind === "polytropic" ? -16 : 18;
  close(secant.points[1]!.x - secant.points[0]!.x, chordX, "independent endpoint secant delta x"); close(secant.points[1]!.y - secant.points[0]!.y, chordY, "independent endpoint secant delta y");
  rejects("curve_anchor", { curve: "cross-curve", at: -1 }, "cross-chapter domain violations reject");
  rejects("curve_secant", { curve: "cross-curve", first: 0, second: 0 }, "cross-chapter coincident secants reject");
}
for (const kind of ["wave", "sum", "polytropic", "isochoric"] as const) for (const quantity of ["at", "scale"]) {
  const bad = crossChapter(kind); bad.quantities.find((q) => q.id === quantity)!.unit = kind === "wave" || kind === "sum" ? "cm" : "m";
  check(structural(bad).some((issue) => issue.severity === "fatal"), "cross-chapter parameter quantity unit mismatch must reject");
}
const cyclicWave = crossChapter("sum"); cyclicWave.constructions.find((c) => c.id === "make-wave-intermediate")!.inputs.waves = ["curve"];
check(structural(cyclicWave).some((issue) => issue.severity === "fatal"), "chained wave dependency cycle must reject boundedly");
const malformedSource = crossChapter("wave"); malformedSource.constructions[0]!.outputs.push("phantom"); malformedSource.entities.push({ id: "phantom", kind: "polyline", role: "invalid extra output" }); malformedSource.constructions.find((c) => c.id === "make-anchor")!.inputs.curve = "phantom";
check(structural(malformedSource).some((issue) => issue.severity === "fatal"), "referenced output index cannot borrow another source output geometry");
const deepWave = crossChapter("wave"); deepWave.constructions[0]!.outputs = ["deep-source"];
for (let i = 0; i < 33; i += 1) deepWave.constructions.push({ id: `make-deep-${i}`, operator: "wave_superposition", inputs: { waves: [i === 0 ? "deep-source" : `deep-${i - 1}`] }, outputs: [i === 32 ? "curve" : `deep-${i}`] });
check(structural(deepWave).some((issue) => issue.severity === "fatal"), "excessive analytic curve dependency depth must reject before recursive overflow");
for (const mutate of [
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-tangent")!.inputs.at = 0; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-normal")!.inputs.span = { value: 3, unit: "m" }; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-normal")!.inputs.span = Infinity; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-tangent")!.inputs.span = 0; },
  (s: SceneDocument) => { s.entities.find((e) => e.id === "normal")!.kind = "point"; },
  (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-tangent")!.inputs.approximate = true; },
] as const) { const bad = crossChapter("sum"); mutate(bad); check(structural(bad).some((issue) => issue.severity === "fatal"), "invalid cross-chapter analytic line domain, units, span or output must reject"); }
if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument, isSupportedSceneOperator } = await import("../../src/index");
  for (const candidate of prefixScenes) {
    const result = compileSceneDocument(candidate); check(!result.ok && result.renderScene === null, "SI prefix case mismatch must reject calculus atomically");
  }
  for (const kind of ["wave", "sum", "polytropic", "isochoric"] as const) {
    const candidate = crossChapter(kind); const result = compileSceneDocument(candidate);
    check(result.ok && result.renderScene, `cross-chapter ${kind} calculus failed live compile: ${JSON.stringify(result.report.issues)}`);
    const reverse = structuredClone(candidate); reverse.constructions.reverse(); check(compileSceneDocument(reverse).ok, "cross-chapter calculus dependencies compile in reverse order");
    const falseProof = structuredClone(candidate); falseProof.assertions.find((a) => a.id === "anchor-on-curve")!.expected = false;
    const rejected = compileSceneDocument(falseProof); check(!rejected.ok && rejected.renderScene === null, "false cross-chapter exact incidence must reject atomically");
    const mismatch = structuredClone(candidate); mismatch.quantities.find((q) => q.id === "at")!.unit = kind === "wave" || kind === "sum" ? "cm" : "m";
    const invalidUnits = compileSceneDocument(mismatch); check(!invalidUnits.ok && invalidUnits.renderScene === null, "cross-chapter unit mismatch must reject without partial ink");
  }
  const cycleRejected = compileSceneDocument(cyclicWave); check(!cycleRejected.ok && cycleRejected.renderScene === null, "cyclic superposition calculus must reject atomically");
  for (const operator of ["curve_anchor", "curve_secant", "curve_derivative"]) check(isSupportedSceneOperator(operator), "calculus operator must reach executable capability");
  for (const kind of ["function", "parametric", "polar"] as const) {
    const candidate = scene(kind); const compiled = compileSceneDocument(candidate);
    check(compiled.ok && compiled.renderScene, `${kind} calculus failed compile: ${JSON.stringify(compiled.report.issues)}`);
    check(compiled.renderScene.primitives.every((p) => p.points.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))), "calculus render coordinates must be finite");
    check(JSON.stringify(compiled.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "calculus compile must be deterministic");
    const reordered = structuredClone(candidate); reordered.constructions.reverse(); check(compileSceneDocument(reordered).ok, "calculus dependencies must compile regardless of construction order");
    const bad = structuredClone(candidate); bad.assertions.find((a) => a.id === "anchor-on-curve")!.expected = false;
    const failure = compileSceneDocument(bad); check(!failure.ok && failure.renderScene === null, "negated exact curve incidence must reject atomically");
  }
  for (const mutate of [
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-derivative")!.inputs.parameterScale = 0; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-secant")!.inputs.second = -1; },
    (s: SceneDocument) => { s.quantities.find((q) => q.id === "at")!.unit = "m"; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-anchor")!.inputs.at = Infinity; },
    (s: SceneDocument) => { s.constructions.find((c) => c.id === "make-anchor")!.operator = "curve_magic_anchor"; },
  ] as const) { const bad = scene("function"); mutate(bad); check(!validateSceneDocument(bad).document, "invalid calculus must fail structural validation"); const result = compileSceneDocument(bad); check(!result.ok && result.renderScene === null, "invalid calculus cannot emit partial primitives"); }
  const nearEndpoint = scene("function");
  nearEndpoint.constructions[0]!.inputs = { expression: "x^3", xMin: 0, xMax: 2, samples: 17 };
  nearEndpoint.constructions.find((c) => c.id === "make-first")!.inputs.at = 0;
  nearEndpoint.constructions.find((c) => c.id === "make-secant")!.inputs.first = 0;
  nearEndpoint.quantities.find((q) => q.id === "at")!.value = 1e-12;
  check(compileSceneDocument(nearEndpoint).ok, "existing tangent and normal must prefer exact callbacks near the endpoint where finite differences cannot verify");
  for (const operator of ["tangent_line", "normal_line", "curve_derivative"] as const) {
    const cusp = scene("function"); cusp.constructions[0]!.inputs.expression = "abs(x)"; cusp.quantities.find((q) => q.id === "at")!.value = 0;
    const selected = cusp.constructions.find((c) => c.operator === operator)!;
    cusp.constructions = [cusp.constructions[0]!, selected]; const ids = ["curve", ...selected.outputs];
    cusp.entities = cusp.entities.filter((e) => ids.includes(e.id)); cusp.requiredEntityIds = ids; cusp.revealGroups[0]!.entityIds = ids; cusp.assertions = [];
    const result = compileSceneDocument(cusp); check(!result.ok && result.renderScene === null, `${operator} must reject abs cusp without approximate fallback`);
  }
  const zeroCandidate = scene("parametric");
  zeroCandidate.constructions[0]!.inputs = { xExpression: "t^2", yExpression: "t^3", tMin: -1, tMax: 1, samples: 17 };
  zeroCandidate.quantities.find((q) => q.id === "at")!.value = 0;
  zeroCandidate.constructions = zeroCandidate.constructions.filter((c) => ["make-curve", "make-derivative"].includes(c.id));
  zeroCandidate.entities = zeroCandidate.entities.filter((e) => ["curve", "derivative"].includes(e.id)); zeroCandidate.entities.find((e) => e.id === "derivative")!.kind = "point";
  zeroCandidate.requiredEntityIds = ["curve", "derivative"]; zeroCandidate.revealGroups[0]!.entityIds = zeroCandidate.requiredEntityIds;
  zeroCandidate.assertions = [{ id: "zero-anchor", predicate: "incident", entities: ["derivative", "curve"], expected: true, severity: "fatal" }];
  check(compileSceneDocument(zeroCandidate).ok, "proven stationary parameter derivative must compile as a point with exact incidence");
  const motion = scene("parametric");
  motion.constructions[0]!.operator = "constant_acceleration_trajectory";
  motion.constructions[0]!.inputs = { initialPosition: [1, 2], initialVelocity: [3, 4], acceleration: [0, -2], tMin: 0, tMax: 3, samples: 17, units: { length: "m", time: "s" } };
  motion.quantities.find((q) => q.id === "at")!.value = 1; motion.quantities.find((q) => q.id === "at")!.unit = "s";
  motion.quantities.find((q) => q.id === "scale")!.unit = "s";
  motion.constructions.find((c) => c.id === "make-second")!.inputs.at = 3; motion.constructions.find((c) => c.id === "make-secant")!.inputs.second = 3;
  check(structural(motion).length === 0, "kinematic time and length units must reach exact calculus operators");
  const motionResult = compileSceneDocument(motion); check(motionResult.ok && motionResult.renderScene, `kinematic calculus composition failed: ${JSON.stringify(motionResult.report.issues)}`);
  check(!isSupportedSceneOperator("curve_magic_anchor"), "undeclared curve capability must reject");
}
console.log(`calculus operator verification passed (${checks} checks)`);
