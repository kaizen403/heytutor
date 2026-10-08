/**
 * Agent 6 magnetic-force figure verification. Every model's ordinary and
 * altered standard case must consume, certify the frozen oracle numbers,
 * reject its declared rejections, and compile; a scene-mode figure must be
 * non-empty. mf.ampere stays text-only and must render zero primitives.
 * The compiled ordinary figure must carry its required glyphs and labels.
 * The page-normal cyclotron field must be a ring plus a dot (field out of
 * the page) or a ring plus a cross (field into the page), with a label.
 */
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel, standardCases } from "../../../src/physics/em20261007/consume";
import type { RenderPoint, RenderPrimitive, RenderPrimitiveKind, RenderScene, SceneDocument } from "../../../src/types";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSceneSvg } from "../../lib/renderSceneSvg";

const renderDir = process.argv[2];
if (renderDir) mkdirSync(resolve(renderDir), { recursive: true });
const frameCounts = new Map<string, number>();

const modelFailures = new Map<string, string[]>();
let obligationChecks = 0;
function fail(model: string, reason: string): void {
  const existing = modelFailures.get(model) ?? [];
  existing.push(reason);
  modelFailures.set(model, existing);
}

/** Frozen numeric authority, identical to the em-five oracle rows for these models. */
const oracle: Readonly<Record<string, { ordinary: Record<string, number>; altered: Record<string, number> }>> = {
  "mf.lorentz": { ordinary: { Fx: 0, Fy: -24, Fz: 0, F: 24 }, altered: { Fx: 0, Fy: 0, Fz: 0, F: 0 } },
  "mf.selector": { ordinary: { v: 3 }, altered: { v: 4 } },
  "mf.cyclotron": { ordinary: { radius: 3 }, altered: { radius: 3 } },
  "mf.helix": { ordinary: { radius: 3, pitch: 8 * Math.PI }, altered: { radius: 4, pitch: 4 * Math.PI } },
  "mf.conductor": { ordinary: { Fx: 0, Fy: -24, Fz: 0 }, altered: { Fx: 0, Fy: -12, Fz: 0 } },
  "mf.parallel": { ordinary: { perLength: 4, attract: 1 }, altered: { perLength: -4, attract: 0 } },
  "mf.ampere": { ordinary: {}, altered: {} },
  "mf.loop_torque": { ordinary: { taux: -24, tauy: 0, tauz: 0, tau: 24 }, altered: { taux: -12, tauy: 0, tauz: 0, tau: 12 } },
  "mf.dipole_moment": { ordinary: { m: 10 }, altered: { m: 12 } },
  "mf.revolving": { ordinary: { m: 12 }, altered: { m: 16 } },
  "mf.galvanometer": { ordinary: { theta: 0.2 }, altered: { theta: 0.4 } },
  "mf.shunt": { ordinary: { S: 10 }, altered: { S: 5 } },
  "mf.voltmeter": { ordinary: { R: 1900 }, altered: { R: 2900 } },
  "mf.dipole_torque": { ordinary: { taux: -12, tauy: 0, tauz: 0 }, altered: { taux: -8, tauy: 0, tauz: 0 } },
};

/** Required compiled glyphs and label texts for each ordinary figure. */
const figures: Readonly<Record<string, { primitives: readonly { entityId: string; kind: RenderPrimitiveKind }[]; labels: readonly string[] }>> = {
  "mf.lorentz": { primitives: [{ entityId: "force", kind: "vector" }], labels: ["F"] },
  "mf.selector": { primitives: [{ entityId: "electric", kind: "vector" }, { entityId: "velocity", kind: "vector" }], labels: [] },
  "mf.cyclotron": {
    primitives: [
      { entityId: "orbit", kind: "circle" }, { entityId: "dee1", kind: "polygon" }, { entityId: "dee2", kind: "polygon" },
      { entityId: "velocity", kind: "vector" }, { entityId: "field", kind: "polyline" }, { entityId: "fieldDot", kind: "circle" },
    ],
    labels: ["orbit", "dee", "velocity", "field", "⊙"],
  },
  "mf.helix": { primitives: [{ entityId: "projection", kind: "circle" }, { entityId: "pitch", kind: "line" }, { entityId: "helix0", kind: "line" }], labels: ["helix", "pitch", "xy"] },
  "mf.conductor": { primitives: [{ entityId: "force", kind: "vector" }], labels: ["F"] },
  "mf.parallel": {
    primitives: [{ entityId: "w1", kind: "line" }, { entityId: "w2", kind: "line" }, { entityId: "f1", kind: "vector" }, { entityId: "f2", kind: "vector" }],
    labels: ["I1", "I2", "F"],
  },
  "mf.ampere": { primitives: [], labels: [] },
  "mf.loop_torque": { primitives: [{ entityId: "torque", kind: "vector" }], labels: ["torque"] },
  "mf.dipole_moment": { primitives: [{ entityId: "loop", kind: "circle" }, { entityId: "moment", kind: "vector" }], labels: [] },
  "mf.revolving": { primitives: [{ entityId: "orbit", kind: "circle" }, { entityId: "charge", kind: "point" }], labels: [] },
  "mf.galvanometer": { primitives: [{ entityId: "coil", kind: "circle" }, { entityId: "needle", kind: "vector" }], labels: ["coil", "needle"] },
  "mf.shunt": { primitives: [{ entityId: "meter", kind: "polyline" }, { entityId: "shunt", kind: "polyline" }], labels: ["G", "S", "V"] },
  "mf.voltmeter": { primitives: [{ entityId: "meter", kind: "polyline" }, { entityId: "series", kind: "polyline" }], labels: ["G", "R", "V"] },
  "mf.dipole_torque": { primitives: [{ entityId: "torque", kind: "vector" }], labels: ["torque"] },
};

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
}

function certifiedOf(model: string, document: SceneDocument): Record<string, number> {
  const certified = document.source.certified;
  if (typeof certified !== "object" || certified === null) {
    fail(model, "the emitted document has no certified record");
    return {};
  }
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(certified)) {
    if (typeof value !== "number") {
      fail(model, `certified ${key} is not a number`);
      continue;
    }
    values[key] = value;
  }
  return values;
}

function matchesOracle(model: string, sample: string, actual: Record<string, number>, wanted: Record<string, number>): void {
  for (const key of [...new Set([...Object.keys(actual), ...Object.keys(wanted)])].sort()) {
    if (!(key in actual) || !(key in wanted)) {
      fail(model, `${sample} certified keys ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
    } else if (!close(actual[key], wanted[key])) {
      fail(model, `${sample} certified ${key} must be ${wanted[key]}, got ${actual[key]}`);
    }
  }
}

function compileConsumed(model: string, document: SceneDocument): RenderScene | null {
  const validated = validateSceneDocument(document);
  const compiled = compileSceneDocument(validated.document ?? document);
  if (!compiled.ok || !compiled.renderScene) {
    fail(model, `the scene did not compile: ${compiled.report.issues.map((issue) => issue.message).join("; ")}`);
    return null;
  }
  assertion(model, compiled.renderScene.primitives.every((p) => p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y) && q.x - (p.radius ?? 0) >= 400 && q.x + (p.radius ?? 0) <= 1160 && q.y - (p.radius ?? 0) >= 55 && q.y + (p.radius ?? 0) <= 645)), "every complete-board primitive stays finite and inside the diagram zone");
  if (renderDir) {
    const index = (frameCounts.get(model) ?? 0) + 1;
    frameCounts.set(model, index);
    writeFileSync(resolve(renderDir, `${model}.${index}.svg`), renderSceneSvg(compiled.renderScene, { title: `${model} case ${index}`, subtitle: "Source-defined magnetism; full 1200 x 700 board. Offline compile evidence." }));
  }
  return compiled.renderScene;
}

function compiledScene(model: string, inputs: Readonly<Record<string, number>>): RenderScene | null {
  const consumed = consumePhysicalModel(model, inputs);
  if (consumed.status !== "scene") {
    fail(model, `inputs ${JSON.stringify(inputs)} were rejected: ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
    return null;
  }
  return compileConsumed(model, consumed.document);
}

function requirePrimitive(model: string, scene: RenderScene, entityId: string, kind: RenderPrimitiveKind): RenderPrimitive | null {
  const found = scene.primitives.find((primitive) => primitive.entityId === entityId && primitive.kind === kind);
  if (!found) fail(model, `the compiled figure is missing the ${kind} primitive of entity ${entityId}`);
  return found ?? null;
}

function requireLabels(model: string, scene: RenderScene, wanted: readonly string[]): void {
  const present = scene.primitives
    .filter((primitive) => primitive.kind === "label")
    .map((primitive) => primitive.text ?? "")
    .filter((text) => text.length > 0);
  for (const text of wanted) {
    if (!present.includes(text)) fail(model, `compiled labels must include "${text}"; got [${present.join(", ")}]`);
  }
}

function boundsOf(points: readonly RenderPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const cases = standardCases().filter((item) => item.modelName in oracle);
if (cases.length !== Object.keys(oracle).length) {
  throw new Error(`the agent6 model registry changed: ${cases.length} standard cases != ${Object.keys(oracle).length} oracle rows`);
}

for (const item of cases) {
  const model = item.modelName;
  const wanted = oracle[model];
  if (!wanted) throw new Error(`missing oracle row for ${model}`);
  for (const sample of ["ordinary", "altered"] as const) {
    const consumed = consumePhysicalModel(model, sample === "ordinary" ? item.ordinary : item.altered);
    if (consumed.status !== "scene") {
      fail(model, `${sample} inputs were rejected: ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
      continue;
    }
    matchesOracle(model, sample, certifiedOf(model, consumed.document), wanted[sample]);
    const rendered = compileConsumed(model, consumed.document);
    if (!rendered) continue;
    const textOnly = consumed.document.visualDecision.mode === "text_only";
    if (textOnly) {
      if (rendered.primitives.length !== 0) fail(model, `${sample} text_only render must have zero primitives, got ${rendered.primitives.length}`);
    } else if (rendered.primitives.length === 0) {
      fail(model, `${sample} scene render is empty`);
    }
    if (sample === "ordinary" && !textOnly) {
      const figure = figures[model];
      if (!figure) throw new Error(`missing figure requirement for ${model}`);
      for (const required of figure.primitives) requirePrimitive(model, rendered, required.entityId, required.kind);
      requireLabels(model, rendered, figure.labels);
    }
  }
  for (const rejection of item.rejections) {
    const consumed = consumePhysicalModel(model, rejection);
    if (consumed.status !== "rejected") fail(model, `rejected inputs ${JSON.stringify(rejection)} were accepted`);
  }
}

// mf.ampere is the definition of the ampere: text only, zero diagram ink.
{
  const ampere = compiledScene("mf.ampere", { stated: 1 });
  if (ampere && ampere.primitives.length !== 0) {
    fail("mf.ampere", `the ampere definition must stay text-only with zero primitives, got ${ampere.primitives.length}`);
  }
}

// The page-normal cyclotron field: a ring plus a dot when the field points
// out of the page, a ring plus a cross when it points into the page, with a
// label. The marker is composed from the existing circle and polyline
// operators and sits inside the operator-drawn ring.
{
  const outOfPage = compiledScene("mf.cyclotron", { q: 1, m: 2, B: 2, v: 3 });
  if (outOfPage) {
    const circles = outOfPage.primitives.filter((primitive) => primitive.kind === "circle");
    if (circles.length !== 2) {
      fail("mf.cyclotron", `the page-normal figure needs two circles (the orbit and the field dot), got ${circles.length}`);
    }
    const ring = requirePrimitive("mf.cyclotron", outOfPage, "field", "polyline");
    const dot = requirePrimitive("mf.cyclotron", outOfPage, "fieldDot", "circle");
    if (ring && dot) {
      if (ring.points.length < 8) fail("mf.cyclotron", "the field ring must be a sampled circle, not a stray segment");
      const bounds = boundsOf(ring.points);
      const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      const ringRadius = (bounds.maxX - bounds.minX) / 2;
      const dotCenter = dot.points[0];
      const dotRadius = dot.radius;
      if (!dotCenter || dotRadius === undefined || !(ringRadius > 0)) {
        fail("mf.cyclotron", "the field ring and dot must carry centre and radius geometry");
      } else if (Math.hypot(dotCenter.x - center.x, dotCenter.y - center.y) + dotRadius > ringRadius * 1.001) {
        fail("mf.cyclotron", "the field dot must sit inside the field ring");
      }
    }
    if (outOfPage.primitives.some((primitive) => primitive.entityId.startsWith("fieldCross"))) {
      fail("mf.cyclotron", "an out-of-page field must draw a dot, never a cross");
    }
    requireLabels("mf.cyclotron", outOfPage, ["field", "⊙"]);
  }

  const intoPageConsumed = consumePhysicalModel("mf.cyclotron", { q: 1, m: 2, B: -2, v: 3 });
  const intoPage = intoPageConsumed.status === "scene" ? compileConsumed("mf.cyclotron", intoPageConsumed.document) : null;
  if (intoPageConsumed.status !== "scene") {
    fail("mf.cyclotron", `the into-page probe inputs were rejected: ${intoPageConsumed.status === "rejected" ? intoPageConsumed.reason : intoPageConsumed.status}`);
  }
  if (intoPage) {
    const ring = requirePrimitive("mf.cyclotron", intoPage, "field", "polyline");
    const armA = requirePrimitive("mf.cyclotron", intoPage, "fieldCrossA", "line");
    const armB = requirePrimitive("mf.cyclotron", intoPage, "fieldCrossB", "line");
    if (ring && armA && armB) {
      const bounds = boundsOf(ring.points);
      const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      const ringRadius = (bounds.maxX - bounds.minX) / 2;
      const mid = (primitive: RenderPrimitive): RenderPoint | null => {
        const a = primitive.points[0];
        const b = primitive.points[primitive.points.length - 1];
        return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
      };
      const midA = mid(armA);
      const midB = mid(armB);
      if (!midA || !midB || !(ringRadius > 0)) {
        fail("mf.cyclotron", "the into-page cross arms must carry endpoint geometry");
      } else {
        // Per-entity transform plans shift entities by sub-pixel amounts, so centrality allows a small share of the ring.
        const centrality = ringRadius * 0.05;
        if (Math.hypot(midA.x - center.x, midA.y - center.y) > centrality || Math.hypot(midB.x - center.x, midB.y - center.y) > centrality) {
          fail("mf.cyclotron", "the cross arms must cross at the field ring centre");
        }
        const dirA = { x: armA.points[0].x - armA.points[armA.points.length - 1].x, y: armA.points[0].y - armA.points[armA.points.length - 1].y };
        const dirB = { x: armB.points[0].x - armB.points[armB.points.length - 1].x, y: armB.points[0].y - armB.points[armB.points.length - 1].y };
        if (Math.abs(dirA.x * dirB.y - dirA.y * dirB.x) <= 1e-6) {
          fail("mf.cyclotron", "the cross arms must not be parallel; a cross needs two crossing strokes");
        }
        for (const arm of [armA, armB]) {
          for (const endpoint of [arm.points[0], arm.points[arm.points.length - 1]]) {
            if (!endpoint || Math.hypot(endpoint.x - center.x, endpoint.y - center.y) > ringRadius * 1.001) {
              fail("mf.cyclotron", "the cross arms must stay inside the field ring");
            }
          }
        }
      }
    }
    if (intoPage.primitives.some((primitive) => primitive.entityId === "fieldDot")) {
      fail("mf.cyclotron", "an into-page field must draw a cross, never a dot");
    }
    requireLabels("mf.cyclotron", intoPage, ["field", "⊗"]);
  }
  if (intoPageConsumed.status === "scene") {
    const certified = certifiedOf("mf.cyclotron", intoPageConsumed.document);
    if (!close(certified.radius, 3)) fail("mf.cyclotron", "the into-page field keeps the same certified radius 3");
  }
}

const report: string[] = [];
for (const [model, inputs, id] of [
  ["mf.lorentz", { q: 1, vx: 1, vy: 0, vz: 0, Bx: 0, By: 2, Bz: 0 }, "force"],
  ["mf.conductor", { I: 2, Lx: 2, Ly: 0, Lz: 0, Bx: 0, By: 3, Bz: 0 }, "force"],
] as Array<[string, Record<string, number>, string]>) {
  const scene = compiledScene(model, inputs);
  const marks = scene?.primitives.filter((p) => p.entityId === id && p.kind !== "label") ?? [];
  const width = Math.max(...marks.flatMap((p) => p.points.map((q) => q.x + (p.radius ?? 0)))) - Math.min(...marks.flatMap((p) => p.points.map((q) => q.x - (p.radius ?? 0))));
  assertion(model, width < 70, "page-normal force is a compact glyph, never an invented planar orbit");
}
function assertion(model: string, condition: unknown, message: string): void {
  obligationChecks += 1;
  if (!condition) fail(model, message);
}
function verifyCase(model: string, inputs: Record<string, number>, expected: Record<string, number>): SceneDocument | null {
  const result = consumePhysicalModel(model, inputs);
  assertion(model, result.status === "scene", `independent holdout must consume ${JSON.stringify(inputs)}`);
  if (result.status !== "scene") return null;
  const actual = certifiedOf(model, result.document);
  for (const [key, value] of Object.entries(expected)) assertion(model, close(actual[key], value), `independent holdout ${key}: ${actual[key]} != ${value}`);
  compileConsumed(model, result.document);
  return result.document;
}
for (const q of [-2, 0, 2]) {
  verifyCase("mf.lorentz", { q, vx: 3, vy: 4, vz: 0, Bx: 6, By: 8, Bz: 0 }, { Fx: 0, Fy: 0, Fz: 0, F: 0 });
  verifyCase("mf.lorentz", { q, vx: 3, vy: 4, vz: 0, Bx: 0, By: 0, Bz: 2 }, { Fx: 8 * q, Fy: -6 * q, Fz: 0, F: 10 * Math.abs(q) });
  verifyCase("mf.lorentz", { q, vx: 1, vy: 0, vz: 0, Bx: 0, By: 2, Bz: 0 }, { Fx: 0, Fy: 0, Fz: 2 * q, F: 2 * Math.abs(q) });
}
for (const I of [-2, 0, 2]) {
  verifyCase("mf.conductor", { I, Lx: 3, Ly: 4, Lz: 0, Bx: 6, By: 8, Bz: 0 }, { Fx: 0, Fy: 0, Fz: 0 });
  verifyCase("mf.conductor", { I, Lx: 3, Ly: 4, Lz: 0, Bx: 0, By: 0, Bz: 2 }, { Fx: 8 * I, Fy: -6 * I, Fz: 0 });
  verifyCase("mf.conductor", { I, Lx: 2, Ly: 0, Lz: 0, Bx: 0, By: 3, Bz: 0 }, { Fx: 0, Fy: 0, Fz: 6 * I });
}
// Distributed-force cancellation in a supplied closed planar path in uniform
// B: evaluate each source segment rather than replacing the path by a chord.
const cancellation = [[2, 0, 0], [0, 3, 0], [-2, 0, 0], [0, -3, 0]].map(([Lx, Ly, Lz]) => {
  const result = consumePhysicalModel("mf.conductor", { I: 2, Lx, Ly, Lz, Bx: 0, By: 0, Bz: 4 });
  assertion("mf.conductor", result.status === "scene", "distributed source segment consumes");
  return result.status === "scene" ? certifiedOf("mf.conductor", result.document) : { Fx: NaN, Fy: NaN, Fz: NaN };
});
for (const key of ["Fx", "Fy", "Fz"]) assertion("mf.conductor", close(cancellation.reduce((sum, f) => sum + f[key], 0), 0), "uniform-field closed-path distributed cancellation");
for (const [I1, I2, d, perLength, attract] of [[2, 2, 2, 2, 1], [-2, -2, 2, 2, 1], [2, -2, 2, -2, 0], [-3, 4, 6, -2, 0], [0, 4, 2, 0, 1]]) {
  const doc = verifyCase("mf.parallel", { mu0: 2 * Math.PI, I1, I2, d, length: 2 }, { perLength, attract });
  if (!doc) continue;
  const rendered = compileConsumed("mf.parallel", doc);
  const a = rendered?.primitives.find((p) => p.entityId === "f1" && p.kind === "vector"), b = rendered?.primitives.find((p) => p.entityId === "f2" && p.kind === "vector");
  if (perLength !== 0) {
    assertion("mf.parallel", Boolean(a && b), "reciprocal wire-force vectors exist");
    if (a && b) assertion("mf.parallel", Math.abs((a.points.at(-1)!.x - a.points[0].x) + (b.points.at(-1)!.x - b.points[0].x)) < 0.5, "reciprocal rendered forces agree within half-pixel layout tolerance");
  }
  const components = doc.source.parallelForces as Array<{ x: number; y: number; z: number }>;
  assertion("mf.parallel", close(components[0].x, perLength) && close(components[1].x, -perLength), "independent signed reciprocal physical-force components");
  assertion("mf.parallel", !rendered?.primitives.some((p) => p.kind === "label" && ["w1", "w2"].includes(p.entityId) && p.text === "B"), "source wires must never be mislabeled as B");
}
for (const q of [-1, 1]) for (const E of [-6, 6]) for (const B of [-2, 2]) {
  const doc = verifyCase("mf.selector", { q, E, B, crossed: 1, vx: E / B }, { v: E / B });
  if (!doc) continue;
  const rendered = compileConsumed("mf.selector", doc);
  const electric = rendered?.primitives.find((p) => p.entityId === "electricForce" && p.kind === "vector"), magnetic = rendered?.primitives.find((p) => p.entityId === "magneticForce" && p.kind === "vector");
  assertion("mf.selector", Boolean(electric && magnetic), "both selector forces exist for both charge signs");
  if (electric && magnetic) assertion("mf.selector", close((electric.points.at(-1)!.y - electric.points[0].y) + (magnetic.points.at(-1)!.y - magnetic.points[0].y), 0), "signed selector force vectors cancel");
}
for (const q of [-1, 1]) for (const B of [-2, 2]) {
  const doc = verifyCase("mf.cyclotron", { q, m: 2, B, v: 3, timing: 1, gapVoltage: 7, crossing: 2, rfSign: q }, { radius: 3, period: 2 * Math.PI, frequency: 1 / (2 * Math.PI), gapEnergy: 7 });
  if (!doc) continue;
  const rendered = compileConsumed("mf.cyclotron", doc);
  const velocity = rendered?.primitives.find((p) => p.entityId === "velocity" && p.kind === "vector");
  assertion("mf.cyclotron", Boolean(velocity && Math.sign(velocity.points.at(-1)!.y - velocity.points[0].y) === Math.sign(q * B)), "cyclotron velocity at +x yields inward Lorentz acceleration for every q/B sign");
}
for (const q of [-1, 1]) for (const B of [-2, 2]) for (const vPar of [-4, 0, 4]) {
  const doc = verifyCase("mf.helix", { m: 2, q, B, vPerp: 3, vPar }, { radius: 3, pitch: vPar * 2 * Math.PI });
  if (!doc) continue;
  const source = doc.source.worldHelix as { samples: Array<{ x: number; y: number; z: number; t: number }>; omega: number; period: number; pitch: number };
  assertion("mf.helix", source.samples.length === 65, "world helix samples retain two complete turns");
  for (let i = 1; i < source.samples.length - 1; i += 1) {
    const a = source.samples[i - 1], p = source.samples[i], b = source.samples[i + 1], dt = b.t - p.t;
    assertion("mf.helix", Math.abs(Math.hypot(p.x, p.y) - 3) < 1e-10 && Math.abs(p.z - vPar * p.t) < 1e-10, "world helix radial and axial residuals");
    const vx = (b.x - a.x) / (2 * dt), vy = (b.y - a.y) / (2 * dt), ax = (b.x - 2 * p.x + a.x) / dt ** 2, ay = (b.y - 2 * p.y + a.y) / dt ** 2;
    // Central finite differences, with the O(dt²) discretization error bounded
    // independently: m*a=q*v cross B, never inferred from a screen corkscrew.
    assertion("mf.helix", Math.abs(2 * ax - q * vy * B) < 0.022 && Math.abs(2 * ay + q * vx * B) < 0.022, "world helix independent Lorentz residual");
  }
  assertion("mf.helix", close(source.samples[32].z - source.samples[0].z, source.pitch), "world one-turn displacement equals signed pitch");
}
for (const Bz of [-4, 0, 4]) {
  verifyCase("mf.loop_torque", { I: -2, N: 3, Ax: 0, Ay: 0, Az: 5, Bx: 0, By: 0, Bz }, { taux: 0, tauy: 0, tauz: 0, tau: 0 });
  verifyCase("mf.dipole_torque", { mx: 0, my: 0, mz: 5, Bx: 0, By: 0, Bz, energy: 1 }, { taux: 0, tauy: 0, tauz: 0, U: -5 * Bz });
}
const worldArea = verifyCase("mf.loop_torque", { I: 2, N: 4, Ax: 1, Ay: 2, Az: 3, Bx: 0, By: 0, Bz: 0 }, { taux: 0, tauy: 0, tauz: 0, tau: 0 });
if (worldArea) {
  const loop = worldArea.source.worldLoop as { corners: number[][]; areaVector: number[] };
  const area = [0, 0, 0];
  loop.corners.forEach((a, i) => {
    const b = loop.corners[(i + 1) % loop.corners.length];
    area[0] += (a[1] * b[2] - a[2] * b[1]) / 2; area[1] += (a[2] * b[0] - a[0] * b[2]) / 2; area[2] += (a[0] * b[1] - a[1] * b[0]) / 2;
  });
  for (let i = 0; i < 3; i += 1) assertion("mf.loop_torque", close(area[i], [1, 2, 3][i]), "independently integrated world polygon area vector");
}
for (const [nx, ny, nz] of [[1, 0, 0], [0, -1, 0], [0, 0, 1], [0.6, 0.8, 0]]) for (const I of [-2, 0, 2]) verifyCase("mf.dipole_moment", { I, A: 5, N: 3, nx, ny, nz }, { m: I * 15, mx: I * 15 * nx, my: I * 15 * ny, mz: I * 15 * nz });
for (const q of [-2, 2]) for (const direction of [-1, 1]) verifyCase("mf.revolving", { q, v: 3, r: 4, period: 8 * Math.PI / 3, mass: 5, direction }, { m: direction * q * 6, I: direction * q * 3 / (8 * Math.PI), L: direction * 60 });
verifyCase("mf.revolving", { q: 2, v: 0, r: 4 }, { m: 0 });
for (const I of [-0.01, 0, 0.01]) verifyCase("mf.galvanometer", { N: 5, I, A: 2, B: 3, k: 2, G: 50 }, { theta: 15 * I, currentSensitivity: 15, voltageSensitivity: 0.3 });
function topologyIs(doc: SceneDocument, kind: "ammeter" | "voltmeter"): boolean {
  const c = doc.constructions.find((c) => c.operator === "kirchhoff_network");
  const branches = c?.inputs.branches as Array<{ id: string; from: string; to: string }> | undefined;
  const meter = branches?.find((b) => b.id === "meter"), resistor = branches?.find((b) => b.id === (kind === "ammeter" ? "shunt" : "series"));
  if (!meter || !resistor) return false;
  return kind === "ammeter" ? new Set([meter.from, meter.to, resistor.from, resistor.to]).size === 2 : meter.to === resistor.from && meter.from !== resistor.to;
}
for (const [model, input, expected, kind] of [
  ["mf.shunt", { G: 60, Ig: 0.002, I: 0.012 }, { S: 12 }, "ammeter"],
  ["mf.voltmeter", { G: 60, Ig: 0.002, V: 4 }, { R: 1940 }, "voltmeter"],
] as Array<[string, Record<string, number>, Record<string, number>, "ammeter" | "voltmeter"]>) {
  const doc = verifyCase(model, input, expected);
  if (!doc) continue;
  assertion(model, topologyIs(doc, kind), "actual construction terminals implement declared conversion");
  const rendered = compileConsumed(model, doc);
  const topology = doc.source.conversionTopology as { branches: Array<{ id: string; from: string; to: string }> };
  for (const branch of topology.branches) for (const node of [branch.from, branch.to]) {
    const terminal = rendered?.primitives.find((p) => p.entityId === node && p.kind === "point")?.points[0];
    const ink = rendered?.primitives.filter((p) => p.entityId === branch.id && p.kind !== "label").flatMap((p) => p.points) ?? [];
    assertion(model, Boolean(terminal && ink.some((p) => Math.hypot(p.x - terminal.x, p.y - terminal.y) <= 1)), `rendered branch ${branch.id} must meet electrical terminal ${node}, not a disconnected parallel lane`);
  }
  const swapped: SceneDocument = { ...doc, constructions: doc.constructions.map((c) => c.operator !== "kirchhoff_network" ? c : { ...c, inputs: { ...c.inputs, branches: (c.inputs.branches as Array<{ id: string; from: string; to: string }>).map((b) => b.id === (kind === "ammeter" ? "shunt" : "series") ? { ...b, from: kind === "ammeter" ? "missingJunction" : "terminalB", to: kind === "ammeter" ? "terminalA" : "seriesJunction" } : b) } }) };
  assertion(model, !topologyIs(swapped, kind), "swapped parallel/series conversion terminal mutation rejected by independent topology oracle");
  assertion(model, consumePhysicalModel(model, kind === "ammeter" ? { V: 4, G: 60, Ig: 0.002 } : { I: 0.012, G: 60, Ig: 0.002 }).status === "rejected", "wrong conversion-family source contract rejects");
}
for (const item of cases) {
  for (const key of Object.keys(item.ordinary)) {
    const omitted: Record<string, unknown> = { ...item.ordinary }; delete omitted[key];
    assertion(item.modelName, consumePhysicalModel(item.modelName, omitted).status === "rejected", `omitted source ${key} rejects`);
    assertion(item.modelName, consumePhysicalModel(item.modelName, { ...item.ordinary, [key]: Infinity }).status === "rejected", `nonfinite source ${key} rejects`);
  }
  assertion(item.modelName, consumePhysicalModel(item.modelName, { ...item.ordinary, unknownSource: 1 }).status === "rejected", "undeclared source rejects");
  const result = consumePhysicalModel(item.modelName, item.ordinary);
  if (result.status !== "scene") continue;
  const complete = (doc: SceneDocument) => doc.source.family === item.family && doc.source.explicitPhysicalModel === item.modelName && doc.requiredEntityIds.every((id) => doc.entities.some((e) => e.id === id));
  assertion(item.modelName, complete(result.document), "emitted document owns correct family and complete required sources");
  assertion(item.modelName, !complete({ ...result.document, source: { ...result.document.source, family: "wrong_family" } }), "wrong-family document mutation rejected by gate oracle");
  if (item.modelName !== "mf.ampere") {
    const id = result.document.requiredEntityIds[0];
    const partial = { ...result.document, entities: result.document.entities.filter((e) => e.id !== id) };
    assertion(item.modelName, !complete(partial), "omitted required entity declaration fails independent completeness oracle");
    const entityValidation = validateSceneDocument(partial);
    assertion(item.modelName, !entityValidation.document || entityValidation.report.issues.some((i) => i.severity === "fatal") || !compileSceneDocument(entityValidation.document).ok, "required entity deletion cannot be silently rehydrated");
    // Independently remove the source producer, not just its entity record.
    const missingSource = { ...result.document, constructions: result.document.constructions.filter((c) => !c.outputs.includes(id)) };
    const validation = validateSceneDocument(missingSource);
    assertion(item.modelName, !validation.document || validation.report.issues.some((i) => i.severity === "fatal") || !compileSceneDocument(validation.document).ok, "omitted source producer fails validation/atomic compilation");
  }
}
for (const [model, inputs] of [
  ["mf.lorentz", { q: 1, vx: 1, vy: 0, vz: 0, Bx: 0, By: 0, Bz: 1, Ex: 2 }],
  ["mf.selector", { E: 6, B: 2, crossed: 1, q: 0 }], ["mf.cyclotron", { q: 1, m: 2, B: 2, v: 3, rfSign: 1 }],
  ["mf.helix", { q: 1, m: 2, B: 0, vPerp: 3, vPar: 2 }], ["mf.conductor", { I: 2, Lx: 0, Ly: 0, Lz: 0, Bx: 0, By: 0, Bz: 1 }],
  ["mf.loop_torque", { I: 2, Ax: 1, Ay: 0, Az: 0, Bx: 0, By: 1, Bz: 0, N: 0 }],
  ["mf.dipole_moment", { I: 2, A: 3, nx: 1, ny: 1, nz: 0 }], ["mf.revolving", { q: 2, v: 3, r: 4, direction: 0 }],
  ["mf.galvanometer", { N: 5, I: 0.01, A: 2, B: 1, k: 0 }], ["mf.dipole_torque", { mx: 1, my: 0, mz: 0, Bx: 1, By: 0, Bz: 0, energy: 0 }],
] as Array<[string, Record<string, number>]>) assertion(model, consumePhysicalModel(model, inputs).status === "rejected", "optional-domain/invalid/singular holdout rejects");
// Signed source directions are part of the figure, not narration-only facts.
for (const sign of [-1, 1]) {
  const conductor = consumePhysicalModel("mf.conductor", { I: sign * 2, Lx: 3, Ly: 4, Lz: 0, Bx: 0, By: 0, Bz: 5 });
  if (conductor.status !== "scene") fail("mf.conductor", "oblique signed source must consume");
  else {
    const current = conductor.document.constructions.find((c) => c.outputs.includes("current"));
    const end = current?.inputs.end as number[] | undefined;
    const start = current?.inputs.start as number[] | undefined;
    if (!start || !end || sign * ((end[0] - start[0]) * 3 + (end[1] - start[1]) * 4) <= 0) fail("mf.conductor", "current arrow must follow signed I along source L");
    compileConsumed("mf.conductor", conductor.document);
  }
  const wires = consumePhysicalModel("mf.parallel", { mu0: 2 * Math.PI, I1: sign * 2, I2: -sign * 3, d: 2, length: 1 });
  if (wires.status !== "scene") fail("mf.parallel", "signed wires must consume");
  else for (const id of ["current1", "current2"]) {
    if (!wires.document.entities.some((e) => e.id === id && e.label === (id === "current1" ? "I1" : "I2"))) fail("mf.parallel", "distinct signed source-current identities must be drawn");
  }
}
{
  for (const [model, inputs] of [["mf.shunt", { G: 100, Ig: 0.001, I: 0.011 }], ["mf.voltmeter", { V: 2, Ig: 0.001, G: 100 }]] as const) {
    const converted = consumePhysicalModel(model, inputs);
    if (converted.status !== "scene") { fail(model, "conversion must consume"); continue; }
    const topology = converted.document.source.conversionTopology as { branches?: Array<{ id: string; from: string; to: string }> } | undefined;
    if (!topology?.branches) { fail(model, "conversion requires electrical terminal topology, not disconnected strokes"); continue; }
    const meter = topology.branches.find((b) => b.id === "meter");
    const resistor = topology.branches.find((b) => b.id === (model === "mf.shunt" ? "shunt" : "series"));
    if (!meter || !resistor) fail(model, "conversion source branches are missing");
    else if (model === "mf.shunt" && new Set([meter.from, meter.to, resistor.from, resistor.to]).size !== 2) fail(model, "shunt and galvanometer must share both terminals");
    else if (model === "mf.voltmeter" && meter.to !== resistor.from) fail(model, "voltmeter multiplier must be electrically in series with the galvanometer");
  }
}
{
  const orbit = consumePhysicalModel("mf.revolving", { q: -2, v: 3, r: 4, period: 8 * Math.PI / 3, direction: -1, mass: 5 });
  if (orbit.status !== "scene") fail("mf.revolving", "signed orbit direction and declared period must consume");
  else {
    const v = certifiedOf("mf.revolving", orbit.document);
    if (!close(v.m, 12) || !close(v.I, 3 / (4 * Math.PI)) || !close(v.L, -60)) fail("mf.revolving", "independent current, moment, angular-momentum oracle");
    compileConsumed("mf.revolving", orbit.document);
  }
  if (consumePhysicalModel("mf.revolving", { q: 2, v: 3, r: 4, period: 1 }).status !== "rejected") fail("mf.revolving", "incompatible supplied period and speed must reject");
  const galv = consumePhysicalModel("mf.galvanometer", { N: 10, I: -0.01, A: 2, B: 1, k: 1, G: 100 });
  if (galv.status !== "scene") fail("mf.galvanometer", "signed deflection and both sensitivities must consume");
  else {
    const v = certifiedOf("mf.galvanometer", galv.document);
    if (!close(v.theta, -0.2) || !close(v.currentSensitivity, 20) || !close(v.voltageSensitivity, 0.2)) fail("mf.galvanometer", "sensitivity independent oracle rad/A and rad/V");
    for (const id of ["spring", "radialField", "core"]) if (!galv.document.entities.some((e) => e.id === id)) fail("mf.galvanometer", `required apparatus ${id} is missing`);
    compileConsumed("mf.galvanometer", galv.document);
  }
  const ampere = consumePhysicalModel("mf.ampere", { stated: 1, currentSI: 1 });
  if (ampere.status !== "scene") fail("mf.ampere", "contemporary elementary-charge definition must stay supported text-only");
  else if (ampere.document.visualDecision.mode !== "text_only" || ampere.document.entities.length || !ampere.document.source.assumptions?.toString().includes("1.602176634")) fail("mf.ampere", "modern SI definition must be explicit and carry zero diagram ink");
}
{
  const input = { I: -2, Ax: 1, Ay: 2, Az: 3, Bx: 4, By: -1, Bz: 2, N: 3 };
  const loop = consumePhysicalModel("mf.loop_torque", input);
  if (loop.status !== "scene") fail("mf.loop_torque", "arbitrary area normal and multiple turns must consume");
  else {
    const v = certifiedOf("mf.loop_torque", loop.document);
    if (!close(v.taux, -42) || !close(v.tauy, -60) || !close(v.tauz, 54)) fail("mf.loop_torque", "independent multi-turn loop torque oracle");
    if (!loop.document.entities.some((e) => e.id === "loopEdge0")) fail("mf.loop_torque", "world loop geometry is required");
    compileConsumed("mf.loop_torque", loop.document);
  }
  const moment = consumePhysicalModel("mf.dipole_moment", { I: -2, A: 5, N: 3, nx: 0, ny: 0, nz: -1 });
  if (moment.status !== "scene") fail("mf.dipole_moment", "source turns and oriented area must consume");
  else {
    const m = certifiedOf("mf.dipole_moment", moment.document);
    if (!close(m.m, -30) || !close(m.mz, 30)) fail("mf.dipole_moment", "independent current reversal and area-normal oracle");
    compileConsumed("mf.dipole_moment", moment.document);
  }
}
{
  const cyclotron = consumePhysicalModel("mf.cyclotron", { q: -1, m: 2, B: -2, v: 3, timing: 1, gapVoltage: 5, crossing: 1, rfSign: 1 });
  if (cyclotron.status !== "scene") fail("mf.cyclotron", "signed cyclotron period and alternating-gap accelerator must consume");
  else {
    const v = certifiedOf("mf.cyclotron", cyclotron.document);
    if (!close(v.period, 2 * Math.PI) || !close(v.frequency, 1 / (2 * Math.PI)) || !close(v.gapEnergy, 5)) fail("mf.cyclotron", "independent resonance/gap-energy oracle");
    if (!cyclotron.document.entities.some((e) => e.id === "gapField")) fail("mf.cyclotron", "alternating RF gap field is required");
    compileConsumed("mf.cyclotron", cyclotron.document);
  }
  if (consumePhysicalModel("mf.cyclotron", { q: -1, m: 2, B: 2, v: 3, gapVoltage: 5, crossing: 1, rfSign: -1 }).status !== "rejected") fail("mf.cyclotron", "RF field opposing the crossing's acceleration must reject");
}
{
  const cyclotron = compiledScene("mf.cyclotron", { q: 1, m: 2, B: 2, v: 3 });
  const velocity = cyclotron?.primitives.find((p) => p.entityId === "velocity" && p.kind === "vector");
  if (!velocity || velocity.points.at(-1)!.y <= velocity.points[0].y) fail("mf.cyclotron", "positive qB at +x requires physical -y velocity for an inward Lorentz force");
  const repel = compiledScene("mf.parallel", { mu0: 2 * Math.PI, I1: 3, I2: -4, d: 3, length: 2 });
  const force = repel?.primitives.find((p) => p.entityId === "f1" && p.kind === "vector");
  if (!force || force.points.at(-1)!.x >= force.points[0].x) fail("mf.parallel", "antiparallel left-wire force must point left (repulsion)");
}
{
  const input = { mx: 1, my: 2, mz: 3, Bx: 4, By: -1, Bz: 2, energy: 1 };
  const dipole = consumePhysicalModel("mf.dipole_torque", input);
  if (dipole.status !== "scene") fail("mf.dipole_torque", "arbitrary supplied magnetic moment must consume without inventing a current loop");
  else {
    const value = certifiedOf("mf.dipole_torque", dipole.document);
    if (!close(value.taux, 7) || !close(value.tauy, 10) || !close(value.tauz, -9) || !close(value.U, -8)) fail("mf.dipole_torque", "arbitrary moment independent cross product/energy oracle");
    if (!dipole.document.entities.some((e) => e.id === "moment")) fail("mf.dipole_torque", "explicit moment direction is required");
    compileConsumed("mf.dipole_torque", dipole.document);
  }
}
{
  const input = { q: -2, vx: 3, vy: 0, vz: 0, Bx: 0, By: 0, Bz: 4, Ex: 1, Ey: 2, Ez: 0 };
  const lorentz = consumePhysicalModel("mf.lorentz", input);
  if (lorentz.status !== "scene") fail("mf.lorentz", "electric plus magnetic force must consume");
  else {
    const values = certifiedOf("mf.lorentz", lorentz.document);
    if (!close(values.Fx, -2) || !close(values.Fy, 20) || !close(values.Fz, 0)) fail("mf.lorentz", "q(E+v cross B) independent force must be (-2,20,0)");
    for (const id of ["velocity", "magnetic", "charge", "electric"]) if (!lorentz.document.entities.some((e) => e.id === id)) fail("mf.lorentz", `source ${id} must be present`);
    compileConsumed("mf.lorentz", lorentz.document);
  }
  const conductor = consumePhysicalModel("mf.conductor", { I: -2, Lx: 3, Ly: 0, Lz: 0, Bx: 0, By: 0, Bz: 4 });
  if (conductor.status === "scene" && !conductor.document.entities.some((e) => e.id === "conductor")) fail("mf.conductor", "source conductor must accompany its force");
}
{
  const input = { E: -6, B: 2, crossed: 1, q: -2, vx: -3 };
  const selector = consumePhysicalModel("mf.selector", input);
  if (selector.status !== "scene") fail("mf.selector", "signed selected negative-charge beam must consume");
  else {
    const certified = certifiedOf("mf.selector", selector.document);
    if (!close(certified.v, -3)) fail("mf.selector", "signed E/B velocity must be -3");
    for (const id of ["magnetic", "electricForce", "magneticForce", "platePositive", "plateNegative"]) if (!selector.document.entities.some((e) => e.id === id)) fail("mf.selector", `source/force ${id} must be present`);
    compileConsumed("mf.selector", selector.document);
  }
  if (consumePhysicalModel("mf.selector", { E: 6, B: 2, crossed: 1, q: 1, vx: -3 }).status !== "rejected") fail("mf.selector", "reversed beam that fails E+v cross B=0 must reject");
}
// Real world-space samples at one quarter-turn: start=(r,0,0), initial
// velocity=(0,-vPerp,vPar) for positive qB, and Lorentz acceleration is inward.
{
  const input = { m: 2, q: -1, B: 2, vPerp: 3, vPar: -4 };
  const helix = consumePhysicalModel("mf.helix", input);
  if (helix.status !== "scene") fail("mf.helix", "signed 3D helix must consume");
  else {
    const source = helix.document.source.worldHelix as { samples?: Array<{ x: number; y: number; z: number; t: number }> } | undefined;
    if (!source?.samples?.length) fail("mf.helix", "helix must expose world-coordinate samples, not just a circular projection");
    else {
      const quarter = source.samples[8];
      if (!quarter || !close(quarter.x, 0) || !close(quarter.y, 3) || !close(quarter.z, -2 * Math.PI)) fail("mf.helix", "world quarter-turn must be (0,3,-2pi) for this independent orbit");
    }
    compileConsumed("mf.helix", helix.document);
  }
}
for (const item of cases) {
  const reasons = modelFailures.get(item.modelName) ?? [];
  report.push(reasons.length === 0 ? `${item.modelName}: PASS` : `${item.modelName}: FAIL — ${reasons.join("; ")}`);
}
console.log(report.join("\n"));
if (modelFailures.size > 0) {
  throw new Error(`agent6 verification failed for ${modelFailures.size} model(s)`);
}
console.log("agent6 verification passed (14 magnetic-force models, mf.ampere text-only, page-normal field glyph verified)");
console.log(`${obligationChecks} additional independent obligation assertions`);
if (renderDir) console.log(`rendered ${[...frameCounts.values()].reduce((sum, n) => sum + n, 0)} complete board frames to ${resolve(renderDir)}`);
