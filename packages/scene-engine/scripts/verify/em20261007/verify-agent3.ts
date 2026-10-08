import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { electrostaticFieldModels, electrostaticFieldAdmissions } from "../../../src/physics/em20261007/agent3-electrostatic-fields";
import { consumePhysicalModel } from "../../../src/physics/em20261007/consume";
import { renderSceneSvg } from "../../lib/renderSceneSvg";

// Hand calculations fixed independently of builder outputs, before evaluation.
const oracle: Record<string, [Record<string, number>, Record<string, number>]> = {
  "ef.coulomb": [{ F: 1 }, { F: 3 }], "ef.point": [{ Ex: 0.24, Ey: 0.32, E: 0.4 }, { Ex: 0.12, Ey: 0.16, E: 0.2 }],
  "ef.superposition": [{ Ex: 0, Ey: 0 }, { Ex: 0.5, Ey: 0 }], "ef.dipole": [{ Ex: -3 / 16, Ey: 0 }, { Ex: -3 / 8, Ey: 0 }],
  "ef.torque": [{ tau: 2 }, { tau: -2 }], "ef.energy": [{ U: -12 }, { U: 0 }], "ef.equipotential": [{ radius: 2, V: 1 }, { radius: 2, V: 2 }], "ef.lines": [{}, {}],
  "ef.ring": [{ E: 8 / 125 }, { E: 0 }], "ef.gauss": [{ flux: 4 }, { flux: 0 }], "ef.shell_in": [{ flux: 0, E: 0 }, { flux: 0, E: 0 }], "ef.shell_out": [{ E: 1 }, { E: 2 }],
  "ef.line": [{ E: 3 }, { E: 4 }], "ef.sheet": [{ E: 1 }, { E: 1.5 }],
  "ef.finite_dipole": [{ Ex: 3 / 16, Ey: 0, E: 3 / 16 }, { Ex: -2 / 10 ** 1.5, Ey: 0, E: 2 / 10 ** 1.5 }], "ef.discrete": [{ Ex: 0, Ey: 2 }, { Ex: -2, Ey: -2 }],
  "ef.finite_line": [{ Ex: 0, Ey: Math.SQRT2 }, { Ex: -2 * Math.SQRT2, Ey: 0 }], "ef.disk": [{ E: 0.4 * Math.PI }, { E: 0.8 * Math.PI }],
  "ef.dipole_contour": [{ V: 0 }, { V: 2 }], "ef.dipole_lines": [{}, {}], "ef.shell": [{ E: 0 }, { E: 1 }], "ef.closed_flux": [{ Qenclosed: 4, flux: 2 }, { Qenclosed: -2, flux: 1 }],
  "ef.line_gaussian": [{ E: 0.5, Qenclosed: 6 * Math.PI, sideFlux: 6 * Math.PI, capFlux: 0, flux: 6 * Math.PI }, { E: -1, Qenclosed: -8 * Math.PI, sideFlux: -4 * Math.PI, capFlux: 0, flux: -4 * Math.PI }],
  "ef.sheet_gaussian": [{ Eabove: 1, Ebelow: -1, jump: 2, capFlux: 3, sideFlux: 0, flux: 6, Qenclosed: 12 }, { Eabove: -3, Ebelow: 3, jump: -6, capFlux: -6, sideFlux: 0, flux: -12, Qenclosed: -12 }],
};
interface Variant { model: string; name: string; inputs: Record<string, number>; expected: Record<string, number> }
const variants: Variant[] = [
  { model: "ef.coulomb", name: "unlike-holdout", inputs: { k: 2, q1: -3, q2: 2, r: 4 }, expected: { F: 0.75 } },
  { model: "ef.point", name: "negative-oblique-holdout", inputs: { k: 1, q: -25, x: -3, y: 4 }, expected: { Ex: 0.6, Ey: -0.8, E: 1 } },
  { model: "ef.point", name: "negative-axis", inputs: { k: 1, q: -10, x: 0, y: 2 }, expected: { Ex: 0, Ey: -2.5, E: 2.5 } },
  { model: "ef.lines", name: "negative-source", inputs: { k: 1, q: -1 }, expected: {} },
  { model: "ef.finite_dipole", name: "ideal-axial", inputs: { k: 1, q: 1, a: 1, angle: 0, x: 20, y: 0, ideal: 1 }, expected: { Ex: 1 / 2000, Ey: 0, E: 1 / 2000 } },
  { model: "ef.finite_dipole", name: "ideal-equatorial", inputs: { k: 1, q: 1, a: 1, angle: 0, x: 0, y: -20, ideal: 1 }, expected: { Ex: -1 / 4000, Ey: 0, E: 1 / 4000 } },
  { model: "ef.finite_dipole", name: "rotated-holdout", inputs: { k: 1, q: -2, a: 2, angle: Math.PI / 2, x: 0, y: 6, ideal: 0 }, expected: { Ex: 0, Ey: -3 / 32, E: 3 / 32 } },
  { model: "ef.finite_dipole", name: "off-axis-hard", inputs: { k: 1, q: 1, a: 1, angle: 0, x: 1, y: 2, ideal: 0 }, expected: { Ex: -2 / 8 ** 1.5, Ey: 1 / 4 - 2 / 8 ** 1.5 } },
  { model: "ef.torque", name: "parallel", inputs: { px: 2, py: 0, Ex: 3, Ey: 0 }, expected: { tau: 0 } }, { model: "ef.torque", name: "antiparallel", inputs: { px: -2, py: 0, Ex: 3, Ey: 0 }, expected: { tau: 0 } },
  { model: "ef.torque", name: "oblique-hard", inputs: { px: 3, py: 4, Ex: -2, Ey: 5 }, expected: { tau: 23 } },
  { model: "ef.energy", name: "unstable-antiparallel", inputs: { px: -2, py: 0, Ex: 3, Ey: 0 }, expected: { U: 6 } }, { model: "ef.energy", name: "rotated-oblique", inputs: { px: 3, py: 4, Ex: -2, Ey: 5 }, expected: { U: -14 } },
  { model: "ef.dipole_contour", name: "negative-contour", inputs: { k: 1, q: 2, a: 1, angle: 0, V: -3, extent: 4 }, expected: { V: -3 } }, { model: "ef.dipole_contour", name: "rotated-zero-contour", inputs: { k: 1, q: -1, a: 1, angle: Math.PI / 4, V: 0, extent: 3 }, expected: { V: 0 } },
  { model: "ef.ring", name: "negative-axis", inputs: { k: 1, Q: 2, R: 3, x: -4 }, expected: { E: -8 / 125 } }, { model: "ef.ring", name: "maximum", inputs: { k: 1, Q: 2, R: 3, x: 3 / Math.SQRT2 }, expected: { E: 4 / (27 * Math.sqrt(3)) } },
  { model: "ef.ring", name: "near-centre", inputs: { k: 1, Q: 2, R: 3, x: 0.003 }, expected: { E: 0.006 / 9.000009 ** 1.5 } }, { model: "ef.ring", name: "far-field-holdout", inputs: { k: 1, Q: -3, R: 1, x: 100 }, expected: { E: -300 / 10001 ** 1.5 } },
  { model: "ef.shell", name: "just-inside", inputs: { k: 1, Q: -8, R: 2, r: 2 - 1e-6, side: -1 }, expected: { E: 0 } }, { model: "ef.shell", name: "just-outside", inputs: { k: 1, Q: -8, R: 2, r: 2 + 1e-6, side: 1 }, expected: { E: -8 / (2 + 1e-6) ** 2 } },
  { model: "ef.line", name: "negative-density", inputs: { k: 1, lambda: -3, r: 2 }, expected: { E: -3 } }, { model: "ef.line", name: "zero-density", inputs: { k: 1, lambda: 0, r: 2 }, expected: { E: 0 } },
  { model: "ef.sheet", name: "negative-density", inputs: { sigma: -4, eps0: 2 }, expected: { E: -1 } }, { model: "ef.sheet", name: "zero-density", inputs: { sigma: 0, eps0: 2 }, expected: { E: 0 } },
  { model: "ef.finite_line", name: "axial-exterior", inputs: { k: 1, lambda: 2, x1: -1, y1: 0, x2: 1, y2: 0, x: 3, y: 0 }, expected: { Ex: 0.5, Ey: 0 } },
  { model: "ef.disk", name: "density-composite", inputs: { k: 2, sigma: -3, R: 4, z: 3 }, expected: { E: -4.8 * Math.PI } }, { model: "ef.closed_flux", name: "all-external-holdout", inputs: { eps0: 3, R: 1, q1: 4, x1: 2, y1: 0, q2: -6, x2: 0, y2: 2, orientation: 1 }, expected: { Qenclosed: 0, flux: 0 } },
];
const evidence = process.env.EVIDENCE_DIR ?? mkdtempSync(resolve(tmpdir(), "heytutor-electrostatics-fields-")); mkdirSync(evidence, { recursive: true });
const require = createRequire(import.meta.url);
const sharp = require(resolve(process.cwd(), "../../node_modules/.pnpm/sharp@0.35.4_@types+node@20.19.43/node_modules/sharp")) as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
const outcomes: Record<string, unknown>[] = []; let negativeCount = 0;
function close(actual: unknown, expected: number, name: string) { assert.equal(typeof actual, "number", name); assert.ok(Math.abs((actual as number) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${name}: ${actual} != ${expected}`); }
async function run(item: Variant) {
  const consumed = consumePhysicalModel(item.model, item.inputs); assert.equal(consumed.status, "scene", `${item.model}/${item.name}: ${JSON.stringify(consumed)}`); if (consumed.status !== "scene") return;
  const values = consumed.document.source.certified as Record<string, number>; for (const [key, value] of Object.entries(item.expected)) close(values[key], value, `${item.model}/${item.name}/${key}`);
  if (item.model === "ef.line_gaussian") close(values.sideFlux! + values.capFlux!, values.flux!, "closed cylinder flux partition");
  if (item.model === "ef.sheet_gaussian") { close(2 * values.capFlux! + values.sideFlux!, values.flux!, "closed pillbox flux partition"); close(values.Eabove! - values.Ebelow!, values.jump!, "sheet field jump"); }
  if (electrostaticFieldModels.find((m) => m.name === item.model)?.scope === "qualitative") assert.deepEqual(values, {}, "qualitative scalar prohibition");
  const valid = validateSceneDocument(consumed.document); assert.ok(valid.document, JSON.stringify(valid.report.issues)); const compiled = compileSceneDocument(valid.document!); assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues)); const scene = compiled.renderScene!;
  if (["ef.lines", "ef.dipole_lines"].includes(item.model)) { const lines = scene.primitives.filter((p) => p.entityId === "lines" && p.kind !== "label"); assert.ok(lines.length >= 4); assert.ok(lines.every((p) => p.kind === "vector"), "every field line retains its direction arrow"); }
  if (item.model === "ef.dipole_contour") { const curves = scene.primitives.filter((p) => p.entityId === "contour" && p.kind !== "label"); assert.ok(curves.length > 0); assert.ok(curves.every((p) => p.kind === "polyline"), "equipotential contours must remain undirected"); }
  if (item.model === "ef.coulomb") {
    const force = (id: string) => scene.primitives.find((p) => p.entityId === id && p.kind === "vector")!;
    const left = force("f1"); const right = force("f2");
    const dx1 = left.points.at(-1)!.x - left.points[0]!.x; const dx2 = right.points.at(-1)!.x - right.points[0]!.x;
    close(dx1 + dx2, 0, "pair forces equal/opposite display directions"); assert.equal(Math.sign(dx2), Math.sign(item.inputs.q1! * item.inputs.q2!), "attraction/repulsion must follow signs");
  }
  if (["ef.point", "ef.finite_dipole", "ef.discrete"].includes(item.model)) {
    const vector = scene.primitives.find((p) => p.entityId === "field" && p.kind === "vector");
    if (values.Ex !== 0 || values.Ey !== 0) { assert.ok(vector); const start = vector.points[0]!; const end = vector.points.at(-1)!; if (Math.abs(values.Ex!) > 1e-12) assert.equal(Math.sign(end.x - start.x), Math.sign(values.Ex!), "rendered horizontal field direction"); if (Math.abs(values.Ey!) > 1e-12) assert.equal(Math.sign(start.y - end.y), Math.sign(values.Ey!), "rendered vertical field direction"); }
  }
  for (const p of scene.primitives.flatMap((p) => p.points)) assert.ok(p.x >= 399 && p.x <= 1161 && p.y >= 0 && p.y <= 700, `${item.model} out of board: ${JSON.stringify(p)}`);
  const svg = renderSceneSvg(scene, { title: `${item.model}: ${item.name}`, subtitle: "offline 1200x700 frame; not a Konva capture" }); const base = `${item.model}-${item.name}`; writeFileSync(resolve(evidence, `${base}.svg`), svg); const png = await sharp(Buffer.from(svg)).png().toBuffer(); writeFileSync(resolve(evidence, `${base}.png`), png);
  outcomes.push({ ...item, certified: values, svg: `${base}.svg`, png: `${base}.png`, pngSha256: createHash("sha256").update(png).digest("hex"), requiredEntities: consumed.document.requiredEntityIds, primitiveCount: scene.primitives.length });
}
for (const model of electrostaticFieldModels) {
  assert.ok(oracle[model.name], `missing independent oracle ${model.name}`);
  for (const [i, name] of ["ordinary", "altered"].entries()) await run({ model: model.name, name, inputs: i === 0 ? model.ordinary : model.altered, expected: oracle[model.name]![i]! });
  for (const bad of [...model.rejections, { ...model.ordinary, unknownField: 1 }, { ...model.ordinary, testCharge: 4 }, Object.fromEntries(Object.entries(model.ordinary).slice(1))]) { assert.equal(consumePhysicalModel(model.name, bad).status, "rejected", `${model.name} invalid inputs must reject atomically`); negativeCount += 1; }
}
for (const item of variants) await run(item);
assert.equal(consumePhysicalModel("ef.unsupported", { q: 1 }).status, "rejected"); negativeCount += 1;
assert.equal(new Set(electrostaticFieldModels.flatMap((m) => m.topics.map((t) => t.topicId))).size, 13);
// Independent integration and gradient checks, not another call to the evaluator.
for (const z of [-4, 0, 4, 3 / Math.SQRT2]) {
  let axial = 0; let transverse = 0; const n = 4096;
  for (let i = 0; i < n; i += 1) { const angle = 2 * Math.PI * (i + 0.5) / n; const r = Math.hypot(z, 3); axial += 2 / n * z / r ** 3; transverse += -2 / n * 3 * Math.cos(angle) / r ** 3; }
  const consumed = consumePhysicalModel("ef.ring", { k: 1, Q: 2, R: 3, x: z }); assert.equal(consumed.status, "scene"); if (consumed.status === "scene") close((consumed.document.source.certified as Record<string, number>).E, axial, "independent ring charge-element integral"); close(transverse, 0, "transverse ring cancellation");
}
for (const sign of [-1, 1]) {
  let integral = 0; const n = 20000; const z = 4 * sign; const dr = 3 / n;
  for (let i = 0; i < n; i += 1) { const r = (i + 0.5) * dr; integral += 2 * Math.PI * r * z / Math.hypot(r, z) ** 3 * dr; }
  const consumed = consumePhysicalModel("ef.disk", { k: 1, sigma: 1, R: 3, z }); assert.equal(consumed.status, "scene"); if (consumed.status === "scene") close((consumed.document.source.certified as Record<string, number>).E, integral, "independent surface-density ring integral");
}
const ring = (x: number) => x / (9 + x * x) ** 1.5;
const maximum = 3 / Math.SQRT2; assert.ok(ring(maximum) > ring(maximum - 0.1) && ring(maximum) > ring(maximum + 0.1), "ring axial maximum");
const u = (theta: number) => -(3 * Math.cos(theta) - 4 * Math.sin(theta)) * -2 - (3 * Math.sin(theta) + 4 * Math.cos(theta)) * 5;
assert.ok(Math.abs(-(u(1e-5) - u(-1e-5)) / 2e-5 - 23) < 1e-7, "torque equals minus energy angular derivative");
writeFileSync(resolve(evidence, "field-report.json"), JSON.stringify({ models: electrostaticFieldModels.length, frames: outcomes.length, negativeCount, outcomes, sourceHash: createHash("sha256").update(readFileSync(resolve(process.cwd(), "src/physics/em20261007/agent3-electrostatic-fields.ts"))).digest("hex"), admissionSpecs: electrostaticFieldAdmissions().map(({ name, roles, assumptions }) => ({ name, roles, assumptions })) }, null, 2));
console.log(`agent3 PASS: ${electrostaticFieldModels.length} models, ${outcomes.length} full frames, ${negativeCount} atomic negatives; ${evidence}`);
