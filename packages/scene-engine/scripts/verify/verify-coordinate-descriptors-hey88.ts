import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SceneDocument } from "../../src/index";

const compiled = process.argv.includes("--compiled-boundary");
const engine = compiled ? await import("../../dist/index.js") : await import("../../src/index");
const question = "In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB.";
function document(a: unknown = { x: 0, y: 0 }, b: unknown = { x: 3, y: 4 }): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "descriptor input control" },
    source: { question }, quantities: [], entities: [{ id: "distance", kind: "segment", role: "distance AB" }],
    constructions: [{ id: "makeDistance", operator: "coordinate_distance", inputs: { a, b }, outputs: ["distance"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["distance"],
    revealGroups: [{ id: "distanceGroup", entityIds: ["distance"], dependsOn: [], narrationCue: "distance" }], teachingTimeline: [],
  };
}

if (!process.argv.includes("--prototype-child")) {
  const result = spawnSync(process.execPath, [
    ...process.execArgv, fileURLToPath(import.meta.url), "--prototype-child", ...(compiled ? ["--compiled-boundary"] : []),
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
} else {
  const positive = [
    document(), document([0, 0], [3, 4]),
    document(Object.assign(Object.create(null), { x: 0, y: 0 }), Object.assign(Object.create(null), { x: 3, y: 4 })),
    document({ x: 0, y: 0 }, Object.create(null, { x: { value: 3 }, y: { value: 4 } })),
    document(Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 3, y: 4 })),
    JSON.parse(JSON.stringify(document())),
  ];
  const cases: Array<{ name: string; doc: SceneDocument; inherited: unknown; reads: () => number }> = [];
  for (const endpoint of ["a", "b"] as const) {
    for (const axis of ["x", "y"] as const) {
      const coordinates = endpoint === "a" ? { x: 0, y: 0 } : { x: 3, y: 4 };
      let reads = 0;
      const point = Object.defineProperty({ ...coordinates }, axis, { enumerable: true, get() { reads++; return 6; } });
      const doc = document();
      doc.constructions[0]!.inputs[endpoint] = point;
      cases.push({ name: `${endpoint}.${axis} getter`, doc, inherited: coordinates[axis], reads: () => reads });
    }
  }
  for (const index of [0, 1]) {
    let reads = 0;
    const point = Object.defineProperty([3, 4], String(index), { get() { reads++; return 6; } });
    cases.push({ name: `array[${index}] getter`, doc: document([0, 0], point), inherited: index === 0 ? 3 : 4, reads: () => reads });
  }
  for (const axis of ["x", "y"] as const) {
    let reads = 0;
    const wrapper = Object.defineProperty({}, "value", { enumerable: true, get() { reads++; return 6; } });
    const point: Record<string, unknown> = { x: 3, y: 4 };
    point[axis] = wrapper;
    cases.push({ name: `scalar ${axis} getter`, doc: document({ x: 0, y: 0 }, point), inherited: axis === "x" ? 3 : 4, reads: () => reads });
  }
  for (const key of ["id", "value", "unit"] as const) {
    let reads = 0;
    const values = { id: "bx", value: 3, unit: "1" };
    const quantity = Object.defineProperty({ ...values }, key, { enumerable: true, get() { reads++; return key === "value" ? 6 : "wrong"; } });
    const doc = document({ x: 0, y: 0 }, { x: "bx", y: 4 });
    doc.quantities = [quantity];
    cases.push({ name: `quantity ${key} getter`, doc, inherited: values[key], reads: () => reads });
  }
  let reads = 0;
  const frame = Object.defineProperty({ x: 3, y: 4 }, "coordinateSpace", { enumerable: true, get() { reads++; return "canvas"; } });
  cases.push({ name: "point frame getter", doc: document({ x: 0, y: 0 }, frame), inherited: "world", reads: () => reads });
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  const outcomes: Array<{ name: string; ordinaryDeclined: boolean; pollutedDeclined: boolean; reads: number; positivesAccepted: number }> = [];
  for (const row of cases) {
    const ordinary = engine.validateCoordinateDistanceSourceInputs(row.doc, question);
    let polluted: ReturnType<typeof engine.validateCoordinateDistanceSourceInputs> = [];
    let positivesAccepted = 0;
    try {
      Object.defineProperty(Object.prototype, "value", { value: row.inherited, writable: true, configurable: true });
      polluted = engine.validateCoordinateDistanceSourceInputs(row.doc, question);
      for (const control of positive) {
        if (engine.validateCoordinateDistanceSourceInputs(control, question).length === 0) positivesAccepted++;
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
      if (original) Object.defineProperty(Object.prototype, "value", original);
    }
    outcomes.push({ name: row.name, ordinaryDeclined: ordinary.length > 0, pollutedDeclined: polluted.length > 0, reads: row.reads(), positivesAccepted });
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, "value"), original, "prototype is restored exactly");
  for (const row of outcomes) {
    assert.ok(row.ordinaryDeclined, `${row.name}: ordinary accessor declined`);
    assert.ok(row.pollutedDeclined, `${row.name}: inherited descriptor.value never grants data authority`);
    assert.equal(row.reads, 0, `${row.name}: guard never executes source getter`);
    assert.equal(row.positivesAccepted, positive.length, `${row.name}: own plain/null/nonenumerable/frozen/JSON controls accepted`);
  }
  console.log(JSON.stringify({ gate: "HEY88-coordinate-own-descriptors", boundary: compiled ? "compiled" : "source", accessorCases: outcomes.length, positiveControlsPerCase: positive.length, getterCalls: 0, prototypeRestored: true, scope: "isolated in-memory precondition only; no live pollution/DB/student/source-cohort acceptance" }));
}
