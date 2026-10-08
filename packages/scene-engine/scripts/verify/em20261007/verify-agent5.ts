import { compileSceneDocument } from "../../../src/compile/compiler";
import { evaluateChapterRemainderConstruction } from "../../../src/compile/chapterRemainderGeometry";
import { validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel, standardCases } from "../../../src/physics/em20261007/consume";
import { numberContext } from "../../../src/physics/em20261007/sceneKit";
import type { RenderScene, SceneDocument } from "../../../src/types";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSceneSvg } from "../../lib/renderSceneSvg";

const renderDir = process.argv[2];
if (renderDir) mkdirSync(resolve(renderDir), { recursive: true });
let renderedFrames = 0;

const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) failures.push(message);
}
function near(actual: number, expected: number, tolerance: number, message: string): void {
  checks += 1;
  if (!(Math.abs(actual - expected) <= tolerance)) failures.push(`${message}: ${actual} != ${expected}`);
}

const MAGNET_FACE = 0.7;
const PACKET_MODELS = [
  "mf.wire", "mf.arc", "mf.loop", "mf.solenoid", "mf.toroid",
  "mm.lines", "mm.equivalent", "mm.dipole", "mm.earth", "mm.materials",
] as const;
type PacketModel = (typeof PACKET_MODELS)[number];

function lockOperatorMagnet(moment: [number, number], label: string): void {
  const drawn = evaluateChapterRemainderConstruction("bar_magnet", { moment, displayScale: 1 }, numberContext);
  check(drawn.length === 5, `${label}: bar_magnet drew ${drawn.length} marks, expected the bar and four field lines`);
  const [barMark, ...fieldLines] = drawn;
  if (!barMark || barMark.kind !== "path" || !barMark.closed) {
    failures.push(`${label}: the magnet bar is not a closed path`);
    return;
  }
  const length = Math.hypot(moment[0], moment[1]);
  const axis = { x: moment[0] / length, y: moment[1] / length };
  fieldLines.forEach((line, index) => {
    if (line.kind !== "path") {
      failures.push(`${label}: field line ${index} is not a path`);
      return;
    }
    const start = line.points[0];
    const end = line.points.at(-1);
    if (!start || !end) {
      failures.push(`${label}: field line ${index} has no endpoints`);
      return;
    }
    const startAlong = start.x * axis.x + start.y * axis.y;
    const endAlong = end.x * axis.x + end.y * axis.y;
    near(startAlong, MAGNET_FACE, 0.02, `${label}: field line ${index} leaves the north face`);
    near(endAlong, -MAGNET_FACE, 0.02, `${label}: field line ${index} enters the south face`);
    const inside = line.points.slice(1, -1).some((point) => {
      const along = point.x * axis.x + point.y * axis.y;
      const across = Math.abs(point.x * axis.y - point.y * axis.x);
      return Math.abs(along) < MAGNET_FACE - 0.02 && across < 0.18;
    });
    check(!inside, `${label}: field line ${index} crosses the bar`);
  });
}

function compileModel(name: string, inputs: Record<string, number>, label: string): RenderScene | null {
  const consumed = consumePhysicalModel(name, inputs);
  if (consumed.status !== "scene") {
    failures.push(`${label}: ${consumed.status === "rejected" ? `rejected (${consumed.reason})` : "unclaimed"}`);
    return null;
  }
  const validated = validateSceneDocument(consumed.document);
  if (!validated.document) {
    failures.push(`${label}: validation ${validated.report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    return null;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.report.issues.some((issue) => issue.severity === "fatal")) {
    failures.push(`${label}: compile ${compiled.report.issues.map((issue) => issue.message).join("; ")}`);
    return null;
  }
  check(compiled.renderScene.primitives.every((p) => p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y) && q.x - (p.radius ?? 0) >= 400 && q.x + (p.radius ?? 0) <= 1160 && q.y - (p.radius ?? 0) >= 55 && q.y + (p.radius ?? 0) <= 645)), `${label}: every complete-board primitive stays finite and inside the diagram zone`);
  if (renderDir) {
    renderedFrames += 1;
    writeFileSync(resolve(renderDir, `${String(renderedFrames).padStart(3, "0")}-${label.replace(/[^a-zA-Z0-9._-]+/g, "_")}.svg`), renderSceneSvg(compiled.renderScene, { title: label, subtitle: "Source-defined magnetism; full 1200 x 700 board. Offline compile evidence." }));
  }
  return compiled.renderScene;
}

function labelTexts(scene: RenderScene): string[] {
  return scene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text ?? "");
}

const cases = new Map(standardCases().map((item) => [item.modelName, item] as const));
function sampleOf(name: PacketModel, sample: "ordinary" | "altered"): Record<string, number> {
  const item = cases.get(name);
  if (!item) {
    failures.push(`${name} ${sample}: missing standard case`);
    return {};
  }
  return sample === "ordinary" ? item.ordinary : item.altered;
}

lockOperatorMagnet([2, 0], "mm.lines ordinary operator");
lockOperatorMagnet([0, 2], "mm.lines altered operator");

const rendered = new Map<string, RenderScene>();
for (const name of PACKET_MODELS) {
  const scene = compileModel(name, sampleOf(name, "ordinary"), `${name} ordinary`);
  if (!scene) continue;
  rendered.set(name, scene);
  check(scene.primitives.length > 0, `${name} ordinary: the render is empty`);
  check(labelTexts(scene).some(Boolean), `${name} ordinary: the figure renders without a label`);
}

const lines = rendered.get("mm.lines");
if (lines) {
  const bar = lines.primitives.find((primitive) => primitive.entityId === "bar");
  const fieldLines = lines.primitives.filter((primitive) => primitive.kind !== "label" && /^lobe[1-4]$/.test(primitive.entityId));
  check(Boolean(bar), "mm.lines ordinary: the bar primitive is missing");
  check(fieldLines.length === 4, `mm.lines ordinary: ${fieldLines.length} field lines rendered, expected 4`);
  const texts = labelTexts(lines);
  check(texts.includes("N"), "mm.lines ordinary: the N pole label is missing");
  check(texts.includes("S"), "mm.lines ordinary: the S pole label is missing");
  check(!texts.includes("field"), "mm.lines ordinary: field lines must not be labeled field");
  if (bar && fieldLines.length === 4) {
    const xs = bar.points.map((point) => point.x);
    const northX = Math.max(...xs);
    const southX = Math.min(...xs);
    const centreX = (northX + southX) / 2;
    const halfSpan = northX - centreX;
    fieldLines.forEach((line, index) => {
      const start = line.points[0];
      const end = line.points.at(-1);
      if (!start || !end) {
        failures.push(`mm.lines ordinary: rendered field line ${index} has no endpoints`);
        return;
      }
      near(start.x, northX, 0.5, `mm.lines ordinary: rendered field line ${index} leaves at the north-face x`);
      near(end.x, southX, 0.5, `mm.lines ordinary: rendered field line ${index} enters at the south-face x`);
      check(Math.abs(start.x - centreX) > halfSpan / 2, `mm.lines ordinary: rendered field line ${index} starts at the bar centre, not the north face`);
      check(Math.abs(end.x - centreX) > halfSpan / 2, `mm.lines ordinary: rendered field line ${index} ends at the bar centre, not the south face`);
    });
  }
}

const linesAltered = compileModel("mm.lines", sampleOf("mm.lines", "altered"), "mm.lines altered");
if (linesAltered) {
  check(labelTexts(linesAltered).includes("N") && labelTexts(linesAltered).includes("S"), "mm.lines altered: separate N and S labels are missing");
}

const expectedLabels: Array<[PacketModel, string[]]> = [
  ["mf.toroid", ["B"]],
  ["mm.equivalent", ["solenoid", "m"]],
  ["mm.earth", ["Bh", "Bv"]],
  ["mm.materials", ["sample"]],
];
for (const [name, labels] of expectedLabels) {
  for (const sample of ["ordinary", "altered"] as const) {
    const scene = sample === "ordinary" ? rendered.get(name) : compileModel(name, sampleOf(name, sample), `${name} ${sample}`);
    if (!scene) continue;
    const texts = labelTexts(scene);
    for (const text of labels) check(texts.includes(text), `${name} ${sample}: the ${text} label is missing`);
  }
}

check(consumePhysicalModel("mm.lines", { mx: 0, my: 0 }).status === "rejected", "mm.lines rejection: a zero moment was accepted");

// Finite 6 m wire at its perpendicular bisector, 3 m away: both end
// angles are 45 degrees, so its field is 1/sqrt(2) of the infinite limit.
{
  const input = { mu0: 2 * Math.PI, I: 3, d: 3, start: -3, end: 3 };
  const finite = consumePhysicalModel("mf.wire", input);
  check(finite.status === "scene", "mf.wire finite endpoints must be supported");
  if (finite.status === "scene") {
    near(Number((finite.document.source.certified as Record<string, number>).B), Math.SQRT1_2, 1e-10, "mf.wire finite independent oracle");
    check(finite.document.entities.some((e) => e.id === "wire"), "mf.wire finite source conductor is required");
    compileModel("mf.wire", input, "mf.wire finite compile");
  }
  const below = consumePhysicalModel("mf.wire", { mu0: 2 * Math.PI, I: 3, d: -3 });
  check(below.status === "scene", "mf.wire observation on the other side must be supported");
  if (below.status === "scene") near(Number((below.document.source.certified as Record<string, number>).B), -1, 1e-10, "mf.wire right-hand reversal");
}

{
  const input = { mu0: 4 * Math.PI, I: -2, delta: Math.PI, R: 2, startAngle: Math.PI / 2, startLead: 4, endLead: 4 };
  const arc = consumePhysicalModel("mf.arc", input);
  check(arc.status === "scene", "mf.arc semicircle with connected radial leads must consume");
  if (arc.status === "scene") {
    near(Number((arc.document.source.certified as Record<string, number>).B), -Math.PI, 1e-10, "mf.arc radial leads contribute zero field at centre");
    for (const id of ["arc", "startLead", "endLead"]) check(arc.document.entities.some((e) => e.id === id), `mf.arc ${id} is required`);
    compileModel("mf.arc", input, "mf.arc semicircle composite compile");
  }
  const full = consumePhysicalModel("mf.arc", { mu0: 4 * Math.PI, I: 1, delta: 2 * Math.PI, R: 2 });
  if (full.status === "scene") near(Number((full.document.source.certified as Record<string, number>).B), Math.PI, 1e-10, "mf.arc full loop limit");
  else check(false, "mf.arc full loop limit must consume");
}

{
  const input = { mu0: 2, I: -3, R: 2, x: -2, N: 4, axisAngle: Math.PI / 2 };
  const loop = consumePhysicalModel("mf.loop", input);
  check(loop.status === "scene", "mf.loop signed multi-turn rotated axial field must consume");
  if (loop.status === "scene") {
    near(Number((loop.document.source.certified as Record<string, number>).B), -3 * Math.SQRT1_2, 1e-10, "mf.loop axis independent oracle");
    check(loop.document.entities.some((e) => e.id === "loop"), "mf.loop source loop is required");
    const field = compileModel("mf.loop", input, "mf.loop hard rotated compile")?.primitives.find((p) => p.kind === "vector" && p.entityId === "field");
    check(field && field.points.at(-1)!.y > field.points[0].y, "mf.loop negative physical y field points down on the board");
  }
}

{
  const end = consumePhysicalModel("mf.solenoid", { mu0: 2, n: 3, I: -4, interior: 2 });
  check(end.status === "scene", "mf.solenoid semi-infinite end limit must consume");
  if (end.status === "scene") near(Number((end.document.source.certified as Record<string, number>).B), -12, 1e-10, "mf.solenoid end is half the long interior field");
  for (const r of [2, 8]) {
    const input = { mu0: 2 * Math.PI, N: 5, I: -2, a: 3, b: 7, r, ideal: 1 };
    const exterior = consumePhysicalModel("mf.toroid", input);
    check(exterior.status === "scene", "mf.toroid explicit ideal exterior must consume");
    if (exterior.status === "scene") near(Number((exterior.document.source.certified as Record<string, number>).B), 0, 0, "mf.toroid ideal exterior field is zero");
    compileModel("mf.toroid", input, "mf.toroid ideal exterior compile");
  }
  check(consumePhysicalModel("mf.toroid", { mu0: 2, N: 5, I: 1, a: 3, b: 7, r: 7, ideal: 1 }).status === "rejected", "mf.toroid winding boundary has no supplied limiting side");
}

{
  const input = { Bh: 3, Bv: -4, declination: Math.PI / 2, northX: 1, northY: 0 };
  const earth = consumePhysicalModel("mm.earth", input);
  check(earth.status === "scene", "mm.earth explicit geographic reference and southern inclination must consume");
  if (earth.status === "scene") {
    const values = earth.document.source.certified as Record<string, number>;
    near(values.B, 5, 1e-10, "mm.earth local field magnitude");
    near(values.dip, -0.9272952180016122, 1e-10, "mm.earth signed inclination");
    near(values.declination, Math.PI / 2, 1e-10, "mm.earth explicit declination");
    check(earth.document.entities.some((e) => e.id === "trueNorth"), "mm.earth geographic meridian is required");
    compileModel("mm.earth", input, "mm.earth hard declination compile");
  }
  check(consumePhysicalModel("mm.earth", { Bh: 3, Bv: 4, declination: 1 }).status === "rejected", "mm.earth declination without reference rejects");
}

{
  const input = { shown: 1, kind: 1, T1: 100, chi1: 0.006, T2: 200, chi2: 0.003, T3: 300, chi3: 0.002, Tc: 80 };
  const material = consumePhysicalModel("mm.materials", input);
  check(material.status === "scene", "mm.materials supplied susceptibility versus temperature and Curie marker must consume");
  if (material.status === "scene") {
    check(Array.isArray(material.document.source.suppliedMaterialData), "mm.materials preserve supplied observations instead of inventing a curve");
    compileModel("mm.materials", input, "mm.materials supplied-data compile");
  }
  check(consumePhysicalModel("mm.materials", { shown: 1, kind: -1, T1: 100, chi1: 0.006, T2: 200, chi2: 0.003 }).status === "rejected", "mm.materials positive susceptibility is not diamagnetic");
}

{
  const finite = consumePhysicalModel("mm.dipole", { mu0: 4 * Math.PI, m: 2, r: 2, axial: 1, poleHalfSeparation: 1 });
  check(finite.status === "scene", "mm.dipole declared finite two-pole model must consume");
  if (finite.status === "scene") near(Number((finite.document.source.certified as Record<string, number>).B), 8 / 9, 1e-10, "mm.dipole finite axial independent oracle");
  const eq = consumePhysicalModel("mm.dipole", { mu0: 4 * Math.PI, m: 2, r: 2, axial: 0, poleHalfSeparation: 1 });
  if (eq.status === "scene") near(Number((eq.document.source.certified as Record<string, number>).B), -0.17888543819998318, 1e-10, "mm.dipole finite equatorial independent oracle");
  else check(false, "mm.dipole finite equatorial source must consume");
  const lines = consumePhysicalModel("mm.lines", { mx: -2, my: 0 });
  if (lines.status === "scene") check(lines.document.entities.filter((e) => e.role === "internal return field").length === 4, "mm.lines four return paths close the external lobes");
  const equivalent = consumePhysicalModel("mm.equivalent", { N: 10, I: -2, A: 3 });
  if (equivalent.status === "scene") {
    check(equivalent.document.entities.some((e) => e.id === "bar"), "mm.equivalent compare bar magnet with solenoid");
    const moment = equivalent.document.constructions.find((c) => c.outputs.includes("moment"));
    const end = moment?.inputs.end as number[] | undefined;
    check(end && end[0] < 0, "mm.equivalent reversed current reverses equivalent moment");
  }
}

{
  const input = { mu0: 2 * Math.PI, I: 3, d: 2, amperian: 1, externalI: 5, externalRadius: 6 };
  const ampere = consumePhysicalModel("mf.wire", input);
  check(ampere.status === "scene", "mf.wire circular Amperian path and exterior current must consume");
  if (ampere.status === "scene") {
    const values = ampere.document.source.certified as Record<string, number>;
    near(values.circulation, 6 * Math.PI, 1e-10, "mf.wire exterior current contributes zero circulation");
    near(values.B, 0.25, 1e-10, "mf.wire exterior current changes local field despite zero enclosed contribution");
    check(ampere.document.entities.some((e) => e.id === "amperianPath"), "mf.wire required circular path");
    compileModel("mf.wire", input, "mf.wire Ampere composite compile");
  }
}

let failed = false;
for (const name of ["mf.wire", "mf.arc"] as const) {
  const scene = rendered.get(name)!;
  const ring = scene.primitives.find((p) => p.kind === "polyline" && p.entityId === "field" && p.points.length > 30);
  const width = ring ? Math.max(...ring.points.map((p) => p.x)) - Math.min(...ring.points.map((p) => p.x)) : Infinity;
  check(width < 70, `${name} page-normal field is a compact symbol, not a second source loop`);
}
const signedWire = consumePhysicalModel("mf.wire", { mu0: 1, I: -2, d: -3, start: 1, end: 4, atX: 6 });
if (signedWire.status === "scene") {
  const current = signedWire.document.constructions.find((c) => c.outputs.includes("current"));
  const start = current?.inputs.start as number[] | undefined, end = current?.inputs.end as number[] | undefined;
  check(Boolean(start && end && end[0] < start[0]), "mf.wire signed source current arrow is explicit at the finite conductor");
}
function numeric(name: PacketModel, input: Record<string, number>, key = "B"): number {
  const result = consumePhysicalModel(name, input);
  check(result.status === "scene", `${name} independent sweep consumes ${JSON.stringify(input)}`);
  return result.status === "scene" ? Number((result.document.source.certified as Record<string, number>)[key]) : NaN;
}

/** Independent midpoint Biot–Savart quadrature of a supplied polyline, not
 * the implementation's analytic end-angle/axis formula. */
function integrate(points: number[][], at: number[], current: number, mu0: number): number[] {
  const sum = [0, 0, 0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const dl = b.map((x, j) => x - a[j]);
    const r = at.map((x, j) => x - (a[j] + b[j]) / 2);
    const distance = Math.hypot(...r);
    const cross = [dl[1] * r[2] - dl[2] * r[1], dl[2] * r[0] - dl[0] * r[2], dl[0] * r[1] - dl[1] * r[0]];
    cross.forEach((value, j) => { sum[j] += mu0 * current * value / (4 * Math.PI * distance ** 3); });
  }
  return sum;
}
for (const I of [-2, 0, 3]) for (const x of [-8, 0, 2, 20]) {
  const R = 2, N = 3, mu0 = 4 * Math.PI;
  const points = Array.from({ length: 4097 }, (_, i) => [0, R * Math.cos(i * Math.PI / 2048), R * Math.sin(i * Math.PI / 2048)]);
  const expected = integrate(points, [x, 0, 0], N * I, mu0)[0];
  near(numeric("mf.loop", { mu0, I, R, x, N }), expected, 3e-6 * Math.max(1, Math.abs(expected)), "mf.loop independent Biot-Savart integration sweep");
}
const axialFar = numeric("mf.loop", { mu0: 4 * Math.PI, I: 2, R: 3, x: 300 });
near(axialFar * 300 ** 3, 36 * Math.PI, 0.018, "mf.loop far-axis dipole limit");
for (const d of [-3, 3]) for (const I of [-2, 0, 4]) {
  const finite = { mu0: 4 * Math.PI, I, d, start: -2, end: 5, atX: 1 };
  const points = Array.from({ length: 4097 }, (_, i) => [-2 + 7 * i / 4096, 0, 0]);
  near(numeric("mf.wire", finite), integrate(points, [1, d, 0], I, 4 * Math.PI)[2], 1e-7, "mf.wire independent finite source quadrature");
  const long = numeric("mf.wire", { mu0: 4 * Math.PI, I, d, start: -30000, end: 30000 });
  near(long, numeric("mf.wire", { mu0: 4 * Math.PI, I, d }), 2e-8, "mf.wire finite-to-infinite limit");
}
for (const delta of [-2 * Math.PI, -Math.PI, Math.PI / 3, Math.PI, 2 * Math.PI]) {
  const points = Array.from({ length: 4097 }, (_, i) => [2 * Math.cos(0.6 + delta * i / 4096), 2 * Math.sin(0.6 + delta * i / 4096), 0]);
  near(numeric("mf.arc", { mu0: 4 * Math.PI, I: -3, R: 2, delta, startAngle: 0.6 }), integrate(points, [0, 0, 0], -3, 4 * Math.PI)[2], 5e-6, "mf.arc independent signed-angle integration");
}
compileModel("mf.arc", { mu0: 4 * Math.PI, I: -3, R: 2, delta: 2 * Math.PI }, "mf.arc full loop holdout");
compileModel("mf.wire", { mu0: 4 * Math.PI, I: 3, d: -2, start: -3, end: 4, atX: 1 }, "mf.wire lower-side finite holdout");
// Radial dl is parallel to r, so the independently integrated cross product
// vanishes even for asymmetric lead lengths.
near(integrate([[4, 0, 0], [2, 0, 0]], [0, 0, 0], 5, 4 * Math.PI)[2], 0, 0, "mf.arc independent radial contribution zero");
for (const I of [-3, 0, 4]) {
  near(numeric("mf.solenoid", { mu0: 2, n: 5, I, interior: 1 }), 10 * I, 0, "mf.solenoid signed interior sweep");
  near(numeric("mf.solenoid", { mu0: 2, n: 5, I, interior: 2 }), 5 * I, 0, "mf.solenoid end-limit sweep");
  near(numeric("mf.solenoid", { mu0: 2, n: 5, I, interior: 0 }), 0, 0, "mf.solenoid exterior sweep");
}
compileModel("mf.solenoid", { mu0: 2, n: 5, I: -3, interior: 2 }, "mf.solenoid negative end holdout");
for (const r of [0, 1, 4, 6, 10]) {
  const input = { mu0: 2 * Math.PI, N: 9, I: -2, a: 3, b: 7, r, ideal: 1 };
  near(numeric("mf.toroid", input), r > 3 && r < 7 ? -18 / r : 0, 1e-12, "mf.toroid ideal inside/outside sweep");
  compileModel("mf.toroid", input, `mf.toroid observation r ${r}`);
}
// Integrate both sources around the path: an exterior source has nonzero
// local B but zero signed circulation.
for (const exteriorI of [-5, 0, 7]) {
  const input = { mu0: 4 * Math.PI, I: -2, d: 2, amperian: 1, externalI: exteriorI, externalRadius: 6 };
  let circulation = 0;
  for (let i = 0; i < 4096; i += 1) {
    const t = 2 * Math.PI * (i + 0.5) / 4096;
    const x = 2 * Math.cos(t), y = 2 * Math.sin(t);
    for (const [sourceX, I] of [[0, -2], [6, exteriorI]]) {
      const dx = x - sourceX, dy = y;
      const Bx = -2 * I * dy / (dx * dx + dy * dy), By = 2 * I * dx / (dx * dx + dy * dy);
      circulation += (Bx * -2 * Math.sin(t) + By * 2 * Math.cos(t)) * 2 * Math.PI / 4096;
    }
  }
  near(numeric("mf.wire", input, "circulation"), circulation, 1e-10, "mf.wire independent Ampere closed-path integral");
}
for (const axial of [0, 1]) for (const m of [-2, 3]) {
  const far = { mu0: 4 * Math.PI, m, r: 100, axial };
  const ideal = numeric("mm.dipole", far);
  near(numeric("mm.dipole", { ...far, poleHalfSeparation: 1 }) / ideal, 1, 0.00021, "mm.dipole finite-source far-field convergence");
  near(numeric("mm.dipole", { ...far, r: 200 }) / ideal, 0.125, 1e-12, "mm.dipole inverse-cube distance law");
  compileModel("mm.dipole", { mu0: 4 * Math.PI, m, r: 2, axial, poleHalfSeparation: 0.5 }, `mm.dipole finite axis ${axial} moment ${m}`);
}
for (const I of [-2, 2]) {
  const m = numeric("mm.equivalent", { N: 5, I, A: Math.PI * 4 }, "m");
  const loopB = numeric("mf.loop", { mu0: 4 * Math.PI, N: 5, I, R: 2, x: 200 });
  const barB = numeric("mm.dipole", { mu0: 4 * Math.PI, m, r: 200, axial: 1 });
  near(loopB / barB, 1, 0.00016, "mm.equivalent independently compiled equal-moment external-field limit");
}
for (const [mx, my] of [[2, 0], [-2, 0], [0, -3], [3, 4]]) {
  const result = consumePhysicalModel("mm.lines", { mx, my });
  check(result.status === "scene", "mm.lines orientation sweep consumes");
  if (result.status !== "scene") continue;
  const ext = evaluateChapterRemainderConstruction("bar_magnet", { moment: [mx, my], displayScale: 1 }, numberContext).slice(1);
  for (let i = 0; i < 4; i += 1) {
    const path = ext[i];
    if (path.kind !== "path") { check(false, "mm.lines external path absent"); continue; }
    const ret = result.document.constructions.find((c) => c.outputs.includes(`return${i + 1}`))?.inputs.points as number[][];
    near(Math.hypot(ret[0][0] - path.points.at(-1)!.x, ret[0][1] - path.points.at(-1)!.y), 0, 1e-12, "mm.lines return joins south endpoint");
    near(Math.hypot(ret[1][0] - path.points[0].x, ret[1][1] - path.points[0].y), 0, 1e-12, "mm.lines return closes north endpoint");
    check((ret[1][0] - ret[0][0]) * mx + (ret[1][1] - ret[0][1]) * my > 0, "mm.lines return directed S to N");
    const a = path.points[0], b = path.points[1], z = path.points.at(-1)!, y = path.points.at(-2)!;
    check((b.x - a.x) * mx + (b.y - a.y) * my > 0 && (z.x - y.x) * mx + (z.y - y.y) * my > 0, "mm.lines external tangents leave N and enter S");
  }
  compileModel("mm.lines", { mx, my }, `mm.lines closed topology ${mx} ${my}`);
}
for (const Bv of [-4, 0, 4]) for (const [northX, northY] of [[1, 0], [0, 2], [-3, 4]]) {
  const input = { Bh: 3, Bv, northX, northY, declination: -Math.PI / 3 };
  const dip = numeric("mm.earth", input, "dip"), magnitude = numeric("mm.earth", input);
  near(magnitude * Math.cos(dip), 3, 1e-12, "mm.earth horizontal projection independent identity");
  near(magnitude * Math.sin(dip), Bv, 1e-12, "mm.earth signed down component identity");
}
compileModel("mm.earth", { Bh: 3, Bv: 0, northX: -3, northY: 4, declination: -Math.PI / 3 }, "mm.earth reversed geographic reference holdout");
compileModel("mm.earth", { Bh: 0, Bv: -4 }, "mm.earth vertical-only holdout");
compileModel("mm.earth", { Bh: 3, Bv: 4, northX: 1, northY: 0, declination: 0 }, "mm.earth zero declination holdout");
for (const kind of [-1, 1, 2]) {
  const input = { shown: 1, kind, T1: 100, chi1: kind === -1 ? -0.004 : 0.004, T2: 200, chi2: kind === -1 ? -0.003 : 0.002, ...(kind === 2 ? { Tc: 150 } : {}) };
  const result = consumePhysicalModel("mm.materials", input);
  check(result.status === "scene", "mm.materials supplied three response kinds consume");
  if (result.status === "scene") {
    const response = result.document.constructions.find((c) => c.outputs.includes("response"));
    const end = response?.inputs.end as number[];
    check(kind === -1 ? end[0] < 0 : end[0] > 0, "mm.materials susceptibility sign agrees with magnetization direction");
    check(JSON.stringify(result.document.source.suppliedMaterialData) === JSON.stringify([[input.T1, input.chi1], [input.T2, input.chi2]]), "mm.materials observations preserved exactly without fitted curve");
    check(Object.keys(result.document.source.certified as object).length === 0, "mm.materials observed plot is not numeric law authority");
  }
  compileModel("mm.materials", input, `mm.materials supplied kind ${kind}`);
}
// Public omission/nonfinite/cross-family inputs and document mutations. The
// latter are independent gate oracles, not a claim of shared runtime admission.
function packetDocument(name: PacketModel, doc: SceneDocument): boolean {
  const item = cases.get(name)!;
  return doc.source.explicitPhysicalModel === name && doc.source.family === item.family && doc.visualDecision.mode === "scene" && doc.requiredEntityIds.every((id) => doc.entities.some((e) => e.id === id)) && doc.constructions.every((c) => c.outputs.every((id) => doc.entities.some((e) => e.id === id)));
}
for (const name of PACKET_MODELS) {
  const item = cases.get(name)!;
  compileModel(name, item.altered, `${name} complete altered matrix`);
  for (const key of Object.keys(item.ordinary)) {
    const omitted: Record<string, unknown> = { ...item.ordinary }; delete omitted[key];
    check(consumePhysicalModel(name, omitted).status === "rejected", `${name} omitted source ${key} rejects`);
    check(consumePhysicalModel(name, { ...item.ordinary, [key]: NaN }).status === "rejected", `${name} nonfinite source ${key} rejects`);
  }
  check(consumePhysicalModel(name, { ...item.ordinary, unknownSource: 1 }).status === "rejected", `${name} undeclared source rejects`);
  for (const input of item.rejections) check(consumePhysicalModel(name, input).status === "rejected", `${name} singular/invalid frozen input rejects`);
  const result = consumePhysicalModel(name, item.ordinary);
  if (result.status === "scene") {
    check(packetDocument(name, result.document), `${name} emitted family/source completeness`);
    check(!packetDocument(name, { ...result.document, source: { ...result.document.source, family: "circuit_network" } }), `${name} wrong-family gate mutation rejects`);
    const id = result.document.requiredEntityIds[0];
    const partial = { ...result.document, entities: result.document.entities.filter((e) => e.id !== id) };
    check(!packetDocument(name, partial), `${name} omitted required source gate mutation rejects`);
    check(!compileSceneDocument(partial).ok, `${name} partial candidate never compiles`);
  }
}
for (const [name, input] of [
  ["mf.wire", { mu0: 1, I: 1, d: 1, start: -1 }], ["mf.arc", { mu0: 1, I: 1, R: 1, delta: 360 }],
  ["mf.loop", { mu0: 1, I: 1, R: 1, x: 0, N: 1.5 }], ["mf.toroid", { mu0: 1, N: 2, I: 1, a: 1, b: 3, r: 1, ideal: 1 }],
  ["mm.dipole", { mu0: 1, m: 1, r: 1, axial: 1, poleHalfSeparation: 1 }], ["mm.earth", { Bh: 0, Bv: 1, declination: 0, northX: 1, northY: 0 }],
  ["mm.materials", { shown: 1, kind: 2, T1: 200, chi1: 0.2, T2: 100, chi2: 0.1 }],
] as Array<[PacketModel, Record<string, number>]>) check(consumePhysicalModel(name, input).status === "rejected", `${name} optional-domain adversary rejects`);
for (const I of [-2, 2]) {
  const equivalent = consumePhysicalModel("mm.equivalent", { N: 7, I, A: 3 });
  check(equivalent.status === "scene", "mm.equivalent comparison consumes");
  if (equivalent.status !== "scene") continue;
  for (const prefix of ["solenoidExternal", "barExternal"]) check(equivalent.document.entities.some((e) => e.id.startsWith(prefix)), "mm.equivalent both sources must show the same external dipole topology");
  compileModel("mm.equivalent", { N: 7, I, A: 3 }, `mm.equivalent current ${I}`);
}
// World source orientation must explain the projected coil and current.
for (const angle of [0, Math.PI / 2, -Math.PI / 3]) {
  const coil = consumePhysicalModel("mf.loop", { mu0: 1, I: -2, R: 3, x: 4, N: 2, axisAngle: angle });
  check(coil.status === "scene", "mf.loop oriented world source consumes");
  if (coil.status !== "scene") continue;
  const source = coil.document.source.worldCircularCoil as { normal: number[]; samples: number[][]; projection: number[][] } | undefined;
  check(Boolean(source), "mf.loop source world orientation and projection must be explicit");
  if (!source) continue;
  const a = source.samples[0], b = source.samples[1];
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  check(cross.reduce((sum, x, i) => sum + x * source.normal[i], 0) > 0, "mf.loop positive source path obeys the right-hand normal");
  const current = coil.document.constructions.find((c) => c.outputs.includes("current"));
  const start = current?.inputs.start as number[], end = current?.inputs.end as number[];
  const tangent = source.projection.map((row) => row.reduce((sum, x, i) => sum + x * (b[i] - a[i]), 0));
  check((end[0] - start[0]) * tangent[0] + (end[1] - start[1]) * tangent[1] < 0, "mf.loop negative current reverses the world positive tangent");
  compileModel("mf.loop", { mu0: 1, I: -2, R: 3, x: 4, N: 2, axisAngle: angle }, `mf.loop orientation ${angle}`);
}
for (const name of PACKET_MODELS) {
  const mine = failures.filter((message) => message.startsWith(name));
  if (mine.length > 0) {
    failed = true;
    console.log(`FAIL ${name}`);
    for (const message of mine) console.log(`  - ${message}`);
  } else {
    console.log(`pass ${name}`);
  }
}
const orphans = failures.filter((message) => !PACKET_MODELS.some((name) => message.startsWith(name)));
if (orphans.length > 0) {
  failed = true;
  console.log("FAIL packet");
  for (const message of orphans) console.log(`  - ${message}`);
}
if (failed) throw new Error("agent5 magnetic-source verification failed");
console.log("agent5 magnetic-source verification passed (10 models)");
console.log(`${checks} independent numeric, semantic and mutation assertions`);
if (renderDir) console.log(`rendered ${renderedFrames} complete board frames to ${resolve(renderDir)}`);
