import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import {
  evaluateConicConstruction,
  conicPointResidual,
  validateConicConstruction,
  type ConicGeometry,
  type ConicEvaluationContext,
} from "../../src/compile/conicGeometry";

const quantityValues = new Map<string, number>([["major", 5], ["minor", 3], ["angle", 37], ["p", -2], ["extent", 2]]);
const geometries = new Map<string, ConicGeometry>();
const context: ConicEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const number = typeof value === "string" && quantityValues.has(value) ? quantityValues.get(value)! : Number(value);
    if (!Number.isFinite(number)) throw new Error("non-finite number");
    return number;
  },
  point(value) {
    if (value === "origin") return { x: 7, y: -4 };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      return { x: Number(value.x), y: Number(value.y) };
    }
    throw new Error("missing point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function evaluate(operator: string, inputs: Record<string, unknown>): ConicGeometry {
  const result = evaluateConicConstruction(operator, inputs, context);
  check(result.length === 1, `${operator} must have one output`);
  return result[0]!;
}
function point(inputs: Record<string, unknown>): RenderPoint {
  const value = evaluate("conic_anchor", { conic: "specimen", ...inputs });
  check(value.kind === "point", "anchor must be a point");
  return value.point;
}
function local(point: RenderPoint, angleDeg = 37): RenderPoint {
  const cosine = Math.cos(angleDeg * Math.PI / 180);
  const sine = Math.sin(angleDeg * Math.PI / 180);
  const dx = point.x - 7;
  const dy = point.y + 4;
  return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine };
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointToLine(point: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  return Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / distance(a, b);
}

for (const kind of ["ellipse", "hyperbola", "parabola"] as const) {
  const specimen = evaluate("conic", {
    kind, ...(kind === "parabola" ? { vertex: "origin", p: { value: "p" } } : { center: "origin", a: "major", b: "minor" }),
    rotationDeg: "angle", ...(kind === "ellipse" ? {} : { tMin: -2, tMax: "extent" }), samples: 129,
  });
  check(specimen.kind === "compound", "conic must preserve defining metadata");
  check(specimen.conic?.kind === kind, "typed conic identity missing");
  geometries.set("specimen", specimen);
  check(specimen.paths.length === (kind === "hyperbola" ? 2 : 1), `${kind} wrong branch count`);
  const positiveFocus = point(kind === "parabola" ? { feature: "focus" } : { feature: "focus", side: 1 });
  const negativeFocus = kind === "parabola" ? null : point({ feature: "focus", side: -1 });
  for (const [branchIndex, path] of specimen.paths.entries()) {
    check(path.length === 129, "conic sample count changed");
    for (const world of path) {
      const p = local(world);
      const equation = kind === "ellipse" ? p.x ** 2 / 25 + p.y ** 2 / 9 : kind === "hyperbola" ? p.x ** 2 / 25 - p.y ** 2 / 9 : p.y ** 2 + 8 * p.x;
      close(equation, kind === "parabola" ? 0 : 1, `${kind} point violates defining equation`);
      if (kind === "ellipse") close(distance(world, positiveFocus) + distance(world, negativeFocus!), 10, "ellipse focus sum");
      if (kind === "hyperbola") {
        close(Math.abs(distance(world, positiveFocus) - distance(world, negativeFocus!)), 10, "hyperbola focus difference");
        check(branchIndex === 0 ? p.x >= 5 - 1e-9 : p.x <= -5 + 1e-9, "hyperbola branches were bridged");
      }
    }
  }
  if (kind === "ellipse") close(distance(specimen.paths[0]![0]!, specimen.paths[0]!.at(-1)!), 0, "ellipse must close exactly");
  for (const side of kind === "parabola" ? [undefined] : [1, -1]) {
    const directrix = evaluate("conic_directrix", { conic: "specimen", ...(side === undefined ? {} : { side }), span: 20 });
    check(directrix.kind === "path" && directrix.infinite, "directrix must retain line identity");
    const focus = side === undefined ? positiveFocus : side === 1 ? positiveFocus : negativeFocus!;
    const eccentricity = kind === "ellipse" ? 4 / 5 : kind === "hyperbola" ? Math.sqrt(34) / 5 : 1;
    for (const path of specimen.paths) for (const world of [path[13]!, path[53]!, path[91]!]) {
      close(distance(world, focus), eccentricity * pointToLine(world, directrix.points[0]!, directrix.points[1]!), `${kind} focus/directrix definition`);
    }
  }
  for (const side of kind === "parabola" ? [undefined] : [1, -1]) {
    for (const transverseSide of [1, -1]) {
      const end = local(point({ feature: "latus_rectum_endpoint", ...(side === undefined ? {} : { side }), transverseSide }));
      close(kind === "parabola" ? end.y ** 2 + 8 * end.x : end.x ** 2 / 25 + (kind === "ellipse" ? 1 : -1) * end.y ** 2 / 9, kind === "parabola" ? 0 : 1, "latus endpoint equation");
      check(Math.sign(end.y) === transverseSide, "latus endpoint transverse side was reversed");
    }
  }
  for (const at of kind === "ellipse" ? [0, Math.PI / 2, 1.2] : [-1.1, 0, 1.1]) {
    for (const branch of kind === "hyperbola" ? [1, -1] : [undefined]) {
      const branchInput = branch === undefined ? {} : { branch };
      const anchor = point({ feature: "curve_point", at, ...branchInput });
      close(conicPointResidual(specimen.conic!, anchor), 0, "arbitrary parameter exact conic incidence");
      check(conicPointResidual(specimen.conic!, { x: anchor.x + 0.2, y: anchor.y + 0.17 }) > 1e-4, "off-curve point passed analytic incidence");
      const tangent = evaluate("conic_tangent", { conic: "specimen", at, ...branchInput, span: 8 });
      check(tangent.kind === "path", "tangent must be a path");
      close(pointToLine(anchor, tangent.points[0]!, tangent.points[1]!), 0, "tangent must pass through curve point");
      const a = local(anchor);
      const start = local(tangent.points[0]!);
      const end = local(tangent.points[1]!);
      const gradient = kind === "ellipse" ? { x: 2 * a.x / 25, y: 2 * a.y / 9 } : kind === "hyperbola" ? { x: 2 * a.x / 25, y: -2 * a.y / 9 } : { x: 8, y: 2 * a.y };
      close((end.x - start.x) * gradient.x + (end.y - start.y) * gradient.y, 0, "analytic tangent must be perpendicular to equation gradient");
    }
  }
  if (kind === "hyperbola") {
    const asymptotes = evaluate("conic_asymptotes", { conic: "specimen", span: 20 });
    check(asymptotes.kind === "compound" && asymptotes.paths.length === 2, "asymptotes must be separate lines");
    for (const [index, path] of asymptotes.paths.entries()) for (const p of path.map((p) => local(p))) close(p.y, (index === 0 ? 3 / 5 : -3 / 5) * p.x, "asymptote exact slope");
  }
  check(JSON.stringify(evaluate("conic", { kind, ...(kind === "parabola" ? { vertex: "origin", p: -2 } : { center: "origin", a: 5, b: 3 }), rotationDeg: 37, ...(kind === "ellipse" ? {} : { tMin: -2, tMax: 2 }), samples: 129 })) === JSON.stringify(specimen), "conic quantity resolution and determinism");
}

const rejected = [
  { kind: "ellipse", a: 0 }, { kind: "ellipse", a: 2, b: 3 }, { kind: "ellipse", b: Infinity },
  { kind: "ellipse", samples: 514 }, { kind: "ellipse", samples: 16 }, { kind: "ellipse", samples: 32.5 },
  { kind: "ellipse", samples: NaN }, { kind: "ellipse", rotationDeg: Infinity }, { kind: "circle" },
  { kind: "ellipse", center: { x: Infinity, y: 0 } }, { kind: "ellipse", a: 1e-9 },
  { kind: "hyperbola", tMin: 2, tMax: 2 }, { kind: "hyperbola", tMin: -1000, tMax: 1000 },
  { kind: "parabola", p: 0 }, { kind: "parabola", p: Infinity },
  { kind: "ellipse", p: 1 }, { kind: "parabola", a: 5 },
  { kind: "ellipse", tMin: 0 }, { kind: "hyperbola", branch: 1 },
];
for (const mutation of rejected) {
  let threw = false;
  const kind = mutation.kind;
  try { evaluate("conic", { ...(kind === "parabola" ? { vertex: "origin", p: -2 } : { center: "origin", a: 5, b: 3 }), ...(kind === "ellipse" ? {} : { tMin: -2, tMax: 2 }), ...mutation }); } catch { threw = true; }
  check(threw, `malformed conic accepted: ${JSON.stringify(mutation)}`);
}
geometries.set("specimen", evaluate("conic", { kind: "ellipse", center: "origin", a: 5, b: 5 }));
for (const [operator, inputs] of [
  ["conic_directrix", { side: 1, span: 4 }],
  ["conic_asymptotes", { span: 4 }],
  ["conic_anchor", { feature: "not_a_feature" }],
  ["conic_anchor", { feature: "focus", side: 0 }],
  ["conic_anchor", { feature: "curve_point", at: 7 }],
  ["conic_tangent", { at: 0, span: 0 }],
  ["conic_anchor", { feature: "center", side: 1 }],
  ["conic_anchor", { feature: "focus", side: 1, at: 0 }],
  ["conic_tangent", { at: 0, span: 4, branch: 1 }],
] as const) {
  let threw = false;
  try { evaluate(operator, { conic: "specimen", ...inputs }); } catch { threw = true; }
  check(threw, `${operator} accepted unsupported geometry`);
}

function scene(kind: "ellipse" | "hyperbola" | "parabola"): SceneDocument {
  const ids = ["conic", "focus", "vertex", "probe", "directrix", "tangent", ...(kind === "hyperbola" ? ["asymptotes"] : [])];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-parameter conic and exact derived landmarks" }, source: {},
    quantities: [{ id: "a", value: 5 }, { id: "b", value: 3 }, { id: "p", value: -2 }, { id: "angle", value: 37 }],
    entities: [
      { id: "origin", kind: "point", role: "construction helper point" },
      ...ids.map((id) => ({ id, kind: id === "focus" || id === "vertex" || id === "probe" ? "point" : id === "directrix" || id === "tangent" ? "line" : "polyline", role: "conic geometry" })),
    ],
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 7, y: -4 }, outputs: ["origin"] },
      { id: "make_conic", operator: "conic", inputs: { kind, ...(kind === "parabola" ? { vertex: "origin", p: "p" } : { center: "origin", a: "a", b: "b" }), rotationDeg: "angle", ...(kind === "ellipse" ? {} : { tMin: -2, tMax: 2 }) }, outputs: ["conic"] },
      ...["focus", "vertex"].map((feature) => ({ id: `make_${feature}`, operator: "conic_anchor", inputs: { conic: "conic", feature, ...(kind === "parabola" ? {} : { side: 1 }) }, outputs: [feature] })),
      { id: "make_probe", operator: "conic_anchor", inputs: { conic: "conic", feature: "curve_point", at: 0.371, ...(kind === "hyperbola" ? { branch: 1 } : {}) }, outputs: ["probe"] },
      { id: "make_directrix", operator: "conic_directrix", inputs: { conic: "conic", ...(kind === "parabola" ? {} : { side: 1 }), span: 12 }, outputs: ["directrix"] },
      { id: "make_tangent", operator: "conic_tangent", inputs: { conic: "conic", at: 0, span: 8, ...(kind === "hyperbola" ? { branch: 1 } : {}) }, outputs: ["tangent"] },
      ...(kind === "hyperbola" ? [{ id: "make_asymptotes", operator: "conic_asymptotes", inputs: { conic: "conic", span: 15 }, outputs: ["asymptotes"] }] : []),
    ],
    relations: [], assertions: [{ id: "probe_on_conic", predicate: "on", entities: ["probe", "conic"], tolerance: 1e-8, severity: "fatal" }], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show conic and exact landmarks" }], teachingTimeline: [],
  };
}

for (const kind of ["ellipse", "hyperbola", "parabola"] as const) {
  const specimen = scene(kind);
  const byOutput = new Map(specimen.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const)));
  const issues: SceneIssue[] = [];
  for (const [index, construction] of specimen.constructions.entries()) {
    if (construction.operator.startsWith("conic")) validateConicConstruction(construction, index, specimen, byOutput, issues);
  }
  check(issues.length === 0, `valid ${kind} structurally rejected: ${JSON.stringify(issues)}`);
}

for (const [id, unit] of [["b", "mm"], ["angle", "rad"], ["a", "s"]] as const) {
  const specimen = scene("ellipse");
  specimen.quantities.find((q) => q.id === "a")!.unit = "cm";
  specimen.quantities.find((q) => q.id === "b")!.unit = "cm";
  specimen.quantities.find((q) => q.id === id)!.unit = unit;
  const issues: SceneIssue[] = [];
  const byOutput = new Map(specimen.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const)));
  validateConicConstruction(specimen.constructions[1]!, 1, specimen, byOutput, issues);
  check(issues.some((issue) => issue.code.endsWith("_unit")), `incompatible ${id} unit ${unit} accepted`);
}
{
  const specimen = scene("ellipse");
  specimen.quantities.find((q) => q.id === "a")!.unit = "cm";
  specimen.quantities.find((q) => q.id === "b")!.unit = "Centimeters";
  const issues: SceneIssue[] = [];
  const byOutput = new Map(specimen.constructions.flatMap((c) => c.outputs.map((id) => [id, c] as const)));
  validateConicConstruction(specimen.constructions[1]!, 1, specimen, byOutput, issues);
  check(issues.length === 0, "equivalent length unit aliases were rejected");
}
const prefixConic = scene("ellipse"); prefixConic.quantities.find((quantity) => quantity.id === "a")!.unit = "Mm"; prefixConic.quantities.find((quantity) => quantity.id === "b")!.unit = "mm";
const prefixIssues: SceneIssue[] = []; validateConicConstruction(prefixConic.constructions[1]!, 1, prefixConic, new Map(prefixConic.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const))), prefixIssues);
check(prefixIssues.some((issue) => issue.severity === "fatal"), "megameter and millimeter axes cannot certify a raw aspect ratio");
{
  const specimen = scene("ellipse");
  const construction = specimen.constructions[1]!;
  Reflect.deleteProperty(construction, "outputs");
  const issues: SceneIssue[] = [];
  const byOutput = new Map([["origin", specimen.constructions[0]!]]);
  validateConicConstruction(construction, 1, specimen, byOutput, issues);
  check(issues.some((issue) => issue.code === "invalid_conic_outputs"), "missing outputs must fail without throwing");
}

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
  const rejectedPrefix = compileSceneDocument(prefixConic); check(!rejectedPrefix.ok && rejectedPrefix.renderScene === null, "mixed-prefix conic sources reject atomically");
  for (const kind of ["ellipse", "hyperbola", "parabola"] as const) {
    const candidate = scene(kind);
    const validated = validateSceneDocument(candidate);
    check(validated.document, `${kind} scene rejected: ${JSON.stringify(validated.report.issues)}`);
    const compiled = compileSceneDocument(validated.document);
    check(compiled.ok && compiled.renderScene, `${kind} scene failed compile: ${JSON.stringify(compiled.report.issues)}`);
    const paths = compiled.renderScene.primitives.filter((p) => p.entityId === "conic" && p.kind === "polyline");
    check(paths.length === (kind === "hyperbola" ? 2 : 1), `${kind} rendered branch count`);
    check(paths.every((p) => p.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), "rendered conic non-finite");
    check(JSON.stringify(compiled.renderScene) === JSON.stringify(compileSceneDocument(validated.document).renderScene), "scene conic deterministic compile");
    const falseIncidence = scene(kind);
    const probe = falseIncidence.constructions.find((c) => c.id === "make_probe")!;
    probe.operator = "point";
    probe.inputs = { x: 100, y: 100 };
    const failed = compileSceneDocument(falseIncidence);
    check(!failed.ok && failed.renderScene === null && failed.report.issues.some((issue) => issue.code === "assertion_failed"), "off-curve incidence must fail closed at the same strict tolerance");
  }
  for (const [operator, mutation] of [
    ["conic", { a: 0 }], ["conic", { samples: 514 }], ["conic", { center: "conic" }],
    ["conic_anchor", { conic: "origin" }], ["conic_anchor", { feature: "focus", side: 0 }],
    ["conic_directrix", { span: -1 }], ["conic_tangent", { at: 8 }],
  ] as const) {
    const candidate = scene("ellipse");
    const construction = candidate.constructions.find((c) => c.operator === operator)!;
    Object.assign(construction.inputs, mutation);
    const validated = validateSceneDocument(candidate);
    check(!validated.document, `invalid ${operator} escaped structural validation`);
    const compiled = compileSceneDocument(candidate);
    check(!compiled.ok && compiled.renderScene === null, `invalid ${operator} emitted partial geometry`);
  }
}
console.log(`conic operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
