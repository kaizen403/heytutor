import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { potentialCapacitorModels, potentialCapacitorAdmissions } from "../../../src/physics/em20261007/agent4-potential-capacitors";
import { consumePhysicalModel } from "../../../src/physics/em20261007/consume";
import { renderSceneSvg } from "../../lib/renderSceneSvg";

const oracle: Record<string, [Record<string, number>, Record<string, number>]> = {
  "ep.conservation": [{}, {}], "ep.potential": [{ V: 2 }, { V: 4 }], "ep.dipole_potential": [{ V: 2 }, { V: 0 }], "ep.pair_energy": [{ U: 6 }, { U: -6 }], "ep.conductor": [{}, {}], "ep.polarization": [{}, {}],
  "ep.sharing": [{ V: 1, Q1: 2, Q2: 4, total: 6 }, { V: 1, Q1: 2, Q2: 2, total: 4 }], "ep.series": [{ Ceq: 1 }, { Ceq: 4 / 3 }], "ep.parallel": [{ Ceq: 4 }, { Ceq: 4 }], "ep.plate": [{ C: 4 }, { C: 6 }], "ep.dielectric": [{ C: 12 }, { C: 4 }], "ep.slab": [{ C: 4 }, { C: 3 }], "ep.stored": [{ U: 9 }, { U: 8 }],
  "ep.paths": [{ VA: 3, VB: -1, deltaV: -4, integral1: 4, integral2: 4 }, { VA: 0, VB: 1.5, deltaV: 1.5, integral1: -1.5, integral2: -1.5 }],
  "ep.system": [{ V: -0.3, U: -77 / 60, W1: 0, W2: 2 / 3, W3: -39 / 20 }, { V: -0.3, U: -77 / 60, W1: 0, W2: -6 / 5, W3: -1 / 12 }],
  "ep.transfer": [{ Q1: 1, Q2: 1, total: 2, earthChange: 0 }, { Q1: 0, Q2: -1, total: -1, earthChange: 3 }], "ep.materials": [{}, {}],
  "ep.linear_polarization": [{ E: 2, P: 8, sigmaBoundUpper: -8, sigmaBoundLower: 8 }, { E: -2, P: 0, sigmaBoundUpper: 0, sigmaBoundLower: 0 }],
  "ep.spheres": [{ V: 2, Q1: 2, Q2: 4, reservoirCharge: 0 }, { V: 0, Q1: 0, Q2: 0, reservoirCharge: 6 }],
  "ep.mixed": [{ Ceq: 4, Qseries: 4, Q3: 12, V1: 2, V2: 2, Qsource: 16, middleCharge: 0 }, { Ceq: 7 / 3, Qseries: -4, Q3: -3, V1: -2, V2: -1, Qsource: -7, middleCharge: 0 }],
  "ep.insertion": [{ C0: 4, C: 8, Q: 16, V: 2, U0: 8, U: 16, batteryWork: 16, externalWork: -8 }, { C0: 4, C: 8, Q: 8, V: 1, U0: 8, U: 4, batteryWork: 0, externalWork: -4 }],
  "ep.floating_slab": [{ C: 4, V: 3, Q: 12, Eslab: 0, Eair: 1, Vlower: 1, Vupper: 2, U: 18, batteryWork: 9, externalWork: -4.5 }, { C: 4, V: 2.25, Q: 9, Eslab: 0, Eair: 0.75, Vlower: 1.5, Vupper: 0.75, U: 10.125, batteryWork: 0, externalWork: -3.375 }],
  "ep.charge_discharge": [{ Q: 6, U: 9, sourceWork: 18, chargingHeat: 9, dischargeHeat: 9 }, { Q: -8, U: 8, sourceWork: 16, chargingHeat: 8, dischargeHeat: 8 }],
  "ep.pair_voltage": [{ Ceq: 4 / 3, Qsource: 8, Q1: 8, Q2: 8, V1: 4, V2: 2, middleCharge: 0 }, { Ceq: 6, Qsource: -18, Q1: -6, Q2: -12, V1: -3, V2: -3 }],
};
interface Variant { model: string; name: string; inputs: Record<string, number>; expected: Record<string, number> }
const variants: Variant[] = [
  { model: "ep.potential", name: "negative-holdout", inputs: { k: 2, q: -3, r: 4 }, expected: { V: -1.5 } },
  { model: "ep.pair_energy", name: "unlike-large-distance", inputs: { k: 2, q1: -3, q2: 5, r: 10 }, expected: { U: -3 } },
  { model: "ep.dipole_potential", name: "negative-axis", inputs: { k: 1, p: -8, r: 2, axial: 1 }, expected: { V: -2 } },
  { model: "ep.paths", name: "arbitrary-endpoints-holdout", inputs: { k: 1, q: 5, ax: 3, ay: 4, bx: -3, by: -4, r0: 10 }, expected: { VA: 0.5, VB: 0.5, deltaV: 0, integral1: 0, integral2: 0 } },
  { model: "ep.system", name: "finite-dipole-with-zero-third", inputs: { k: 1, q1: 1, x1: 1, y1: 0, q2: -1, x2: -1, y2: 0, q3: 0, x3: 0, y3: 1, x: 3, y: 0, assemblyOrder: 0 }, expected: { V: 0.25, U: -0.5, W1: 0, W2: -0.5, W3: 0 } },
  { model: "ep.system", name: "equatorial-finite-dipole", inputs: { k: 1, q1: 1, x1: 1, y1: 0, q2: -1, x2: -1, y2: 0, q3: 0, x3: 0, y3: 1, x: 0, y: 3, assemblyOrder: 1 }, expected: { V: 0, U: -0.5 } },
  { model: "ep.transfer", name: "negative-carriers-holdout", inputs: { Q1: -5, Q2: 3, transfer: 2, reservoir: 0, grounded: 0 }, expected: { Q1: -3, Q2: 1, total: -2, earthChange: 0 } },
  { model: "ep.materials", name: "isolated-reversed", inputs: { grounded: 0, direction: -1 }, expected: {} },
  { model: "ep.linear_polarization", name: "negative-polarization", inputs: { eps0: 1, K: 4, sigmaFree: -8 }, expected: { E: -2, P: -6, sigmaBoundUpper: 6, sigmaBoundLower: -6 } },
  { model: "ep.spheres", name: "unequal-radii-separated", inputs: { k: 2, R1: 2, R2: 3, Q1: -8, Q2: 3, grounded: 0, separated: 1 }, expected: { V: -2, Q1: -2, Q2: -3, reservoirCharge: 0 } },
  { model: "ep.spheres", name: "grounded-connected", inputs: { k: 1, R1: 1, R2: 2, Q1: -5, Q2: 1, grounded: 1, separated: 0 }, expected: { V: 0, Q1: 0, Q2: 0, reservoirCharge: -4 } },
  { model: "ep.spheres", name: "reversed-radius-order", inputs: { k: 1, R1: 3, R2: 1, Q1: 8, Q2: 0, grounded: 0, separated: 0 }, expected: { V: 2, Q1: 6, Q2: 2, reservoirCharge: 0 } },
  { model: "ep.mixed", name: "composite-holdout", inputs: { C1: 3, C2: 6, C3: 2, V: 5 }, expected: { Ceq: 4, Qseries: 10, Q3: 10, V1: 10 / 3, V2: 5 / 3, Qsource: 20, middleCharge: 0 } },
  { model: "ep.insertion", name: "empty-fill", inputs: { eps0: 1, A: 8, d: 2, K: 4, t: 2, fraction: 0, V: 3, battery: 1 }, expected: { C0: 4, C: 4, Q: 12, V: 3, U: 18, batteryWork: 0, externalWork: 0 } },
  { model: "ep.insertion", name: "full-fill-connected", inputs: { eps0: 1, A: 8, d: 2, K: 4, t: 2, fraction: 1, V: 3, battery: 1 }, expected: { C: 16, Q: 48, V: 3, U: 72, batteryWork: 108, externalWork: -54 } },
  { model: "ep.insertion", name: "full-fill-isolated", inputs: { eps0: 1, A: 8, d: 2, K: 4, t: 2, fraction: 1, V: 3, battery: 0 }, expected: { C: 16, Q: 12, V: 0.75, U: 4.5, batteryWork: 0, externalWork: -13.5 } },
  { model: "ep.insertion", name: "thickness-partial-holdout", inputs: { eps0: 1, A: 8, d: 2, K: 3, t: 1, fraction: 1, V: 2, battery: 1 }, expected: { C0: 4, C: 6, Q: 12, V: 2, U: 12, batteryWork: 8, externalWork: -4 } },
  { model: "ep.insertion", name: "area-thickness-composite", inputs: { eps0: 1, A: 8, d: 2, K: 3, t: 1, fraction: 0.5, V: -2, battery: 0 }, expected: { C0: 4, C: 5, Q: -8, V: -1.6, U: 6.4, batteryWork: 0, externalWork: -1.6 } },
  { model: "ep.floating_slab", name: "offset-invariant-holdout", inputs: { eps0: 1, A: 12, d: 5, t: 2, g: 0.5, V: -6, battery: 1 }, expected: { C: 4, V: -6, Q: -24, Eslab: 0, Eair: -2, Vlower: -1, Vupper: -5, U: 72, batteryWork: 57.6, externalWork: -28.8 } },
  { model: "ep.floating_slab", name: "zero-thickness", inputs: { eps0: 1, A: 12, d: 5, t: 0, g: 2, V: 5, battery: 0 }, expected: { C: 2.4, V: 5, Q: 12, Eslab: 0, Eair: 1, U: 30, batteryWork: 0, externalWork: 0 } },
  { model: "ep.charge_discharge", name: "zero-voltage", inputs: { C: 2, V: 0 }, expected: { Q: 0, U: 0, sourceWork: 0, chargingHeat: 0, dischargeHeat: 0 } },
  { model: "ep.pair_voltage", name: "series-reversed-holdout", inputs: { C1: 3, C2: 6, V: -9, connection: 0 }, expected: { Ceq: 2, Qsource: -18, Q1: -18, Q2: -18, V1: -6, V2: -3, middleCharge: 0 } },
  { model: "ep.pair_voltage", name: "parallel-positive-holdout", inputs: { C1: 3, C2: 6, V: 9, connection: 1 }, expected: { Ceq: 9, Qsource: 81, Q1: 27, Q2: 54, V1: 9, V2: 9 } },
];
const evidence = process.env.EVIDENCE_DIR ?? mkdtempSync(resolve(tmpdir(), "heytutor-electrostatics-capacitors-")); mkdirSync(evidence, { recursive: true });
const require = createRequire(import.meta.url); const sharp = require(resolve(process.cwd(), "../../node_modules/.pnpm/sharp@0.35.4_@types+node@20.19.43/node_modules/sharp")) as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
const outcomes: Record<string, unknown>[] = []; let negativeCount = 0;
function close(actual: unknown, expected: number, name: string) { assert.equal(typeof actual, "number", name); assert.ok(Math.abs((actual as number) - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${name}: ${actual} != ${expected}`); }
async function run(item: Variant) {
  const consumed = consumePhysicalModel(item.model, item.inputs); assert.equal(consumed.status, "scene", `${item.model}/${item.name}: ${JSON.stringify(consumed)}`); if (consumed.status !== "scene") return;
  const values = consumed.document.source.certified as Record<string, number>; for (const [key, value] of Object.entries(item.expected)) close(values[key], value, `${item.model}/${item.name}/${key}`);
  if (potentialCapacitorModels.find((m) => m.name === item.model)?.scope === "qualitative") assert.deepEqual(values, {});
  if (item.model === "ep.system") close(values.W1! + values.W2! + values.W3!, values.U!, "assembly work sum");
  if (item.model === "ep.paths") {
    for (const id of ["path1", "path2"]) {
      const path = consumed.document.constructions.find((c) => c.outputs[0] === id)!.inputs.points as { x: number; y: number }[];
      let integral = 0;
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i]!; const b = path[i + 1]!; const dx = b.x - a.x; const dy = b.y - a.y; const n = 64;
        let sum = 0;
        for (let j = 0; j <= n; j += 1) { const t = j / n; const x = a.x + t * dx; const y = a.y + t * dy; const f = item.inputs.k! * item.inputs.q! * (x * dx + y * dy) / Math.hypot(x, y) ** 3; sum += (j === 0 || j === n ? 1 : j % 2 === 1 ? 4 : 2) * f; }
        integral += sum / (3 * n);
      }
      close(integral, -values.deltaV!, "independent Simpson integral along actual rendered path");
    }
  }
  if (item.model === "ep.insertion") close(values.U! - values.U0!, values.batteryWork! + values.externalWork!, "first-law insertion accounting");
  if (item.model === "ep.mixed") { close(values.V1! + values.V2!, item.inputs.V!, "series voltage sum"); close(values.Qsource!, values.Qseries! + values.Q3!, "node/source charge accounting"); }
  if (item.model === "ep.floating_slab") close(values.Vlower! + values.Vupper!, values.V!, "slab voltage drop");
  if (["ep.insertion", "ep.floating_slab"].includes(item.model) && values.V !== 0) { assert.equal(consumed.document.entities.find((e) => e.id === "upper")?.label, values.V! > 0 ? "+ plate" : "− plate", "plate polarity follows the source voltage"); }
  const valid = validateSceneDocument(consumed.document); assert.ok(valid.document, `${item.model}/${item.name}: ${JSON.stringify(valid.report.issues)}`); const compiled = compileSceneDocument(valid.document!); assert.ok(compiled.ok && compiled.renderScene, `${item.model}/${item.name}: ${JSON.stringify(compiled.report.issues)}`); const scene = compiled.renderScene!;
  for (const p of scene.primitives.flatMap((p) => p.points)) assert.ok(p.x >= 399 && p.x <= 1161 && p.y >= 0 && p.y <= 700, `${item.model} out of board`);
  const svg = renderSceneSvg(scene, { title: `${item.model}: ${item.name}`, subtitle: "offline 1200x700 frame; not a Konva capture" }); const base = `${item.model}-${item.name}`; writeFileSync(resolve(evidence, `${base}.svg`), svg); const png = await sharp(Buffer.from(svg)).png().toBuffer(); writeFileSync(resolve(evidence, `${base}.png`), png);
  outcomes.push({ ...item, certified: values, svg: `${base}.svg`, png: `${base}.png`, pngSha256: createHash("sha256").update(png).digest("hex"), requiredEntities: consumed.document.requiredEntityIds, primitiveCount: scene.primitives.length });
}
for (const model of potentialCapacitorModels) {
  assert.ok(oracle[model.name], `missing independent oracle ${model.name}`); for (const [i, name] of ["ordinary", "altered"].entries()) await run({ model: model.name, name, inputs: i === 0 ? model.ordinary : model.altered, expected: oracle[model.name]![i]! });
  for (const bad of [...model.rejections, { ...model.ordinary, unknownField: 1 }, { ...model.ordinary, wiredSlab: 1 }, Object.fromEntries(Object.entries(model.ordinary).slice(1))]) { assert.equal(consumePhysicalModel(model.name, bad).status, "rejected", `${model.name} invalid inputs must reject atomically`); negativeCount += 1; }
}
for (const item of variants) await run(item);
assert.equal(consumePhysicalModel("ep.unsupported", { V: 1 }).status, "rejected"); negativeCount += 1;
for (const [model, inputs] of [["ep.plate", { eps0: Number.MIN_VALUE, A: 1, d: 2 }], ["ep.potential", { k: Number.MIN_VALUE, q: 1, r: 2 }], ["ep.charge_discharge", { C: 1, V: Number.MIN_VALUE }]] as const) { assert.equal(consumePhysicalModel(model, inputs).status, "rejected", "nonzero physical products cannot certify underflow zero"); negativeCount += 1; }
assert.equal(new Set(potentialCapacitorModels.flatMap((m) => m.topics.map((t) => t.topicId))).size, 11);
writeFileSync(resolve(evidence, "capacitor-report.json"), JSON.stringify({ models: potentialCapacitorModels.length, frames: outcomes.length, negativeCount, outcomes, sourceHash: createHash("sha256").update(readFileSync(resolve(process.cwd(), "src/physics/em20261007/agent4-potential-capacitors.ts"))).digest("hex"), admissionSpecs: potentialCapacitorAdmissions().map(({ name, roles, assumptions }) => ({ name, roles, assumptions })) }, null, 2));
console.log(`agent4 PASS: ${potentialCapacitorModels.length} models, ${outcomes.length} full frames, ${negativeCount} atomic negatives; ${evidence}`);
