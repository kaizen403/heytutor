import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/index";
import { evaluateMechanicsDiagramConstruction } from "../../src/compile/mechanicsDiagramGeometry";
import { evaluateChapterInstrumentConstruction } from "../../src/compile/chapterInstrumentGeometry";
import type { SourceContext } from "../../src/compile/sourceScalars";
import type { SceneDocument } from "../../src/types";

const context: SourceContext = {
  number: Number,
  point: () => { throw new Error("No inferred physical coordinates"); },
  geometry: () => undefined,
};
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}
function close(actual: number, expected: number, message: string): void {
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function test(name: string, run: () => void): void {
  try { run(); } catch (error) { check(false, `${name}: ${String(error)}`); }
}
function scene(operator: string, inputs: Record<string, unknown>, kinds: string[]): SceneDocument {
  const ids = kinds.map((_, index) => `output${index}`);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Source-defined mechanics state" },
    source: {}, quantities: [], entities: kinds.map((kind, index) => ({ id: ids[index]!, kind, role: kind })),
    constructions: [{ id: "make", operator, inputs, outputs: ids }], relations: [], assertions: [], annotations: [],
    requiredEntityIds: ids, revealGroups: [{ id: "states", entityIds: ids, dependsOn: [], narrationCue: "Compare the given states." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "states", dependsOn: [], narrationIntent: "Compare the given states." }],
  };
}
function compiled(document: SceneDocument, message: string): void {
  const result = compileSceneDocument(document);
  check(result.ok && result.renderScene !== null, `${message}: ${JSON.stringify(result.report.issues)}`);
  if (result.renderScene) check(document.requiredEntityIds.every((id) => result.renderScene!.primitives.some((p) => p.entityId === id)), `${message}: every required output reaches ink`);
}
function rejected(document: SceneDocument, message: string): void {
  const result = compileSceneDocument(document);
  check(!result.ok && result.renderScene === null && result.report.issues.some((issue) => issue.severity === "fatal"), message);
}
const energyBase = { mass: 2, gravity: 10, units: { mass: "kg", gravity: "m/s^2", height: "m", speed: "m/s", work: "J" }, heightScale: 0.3, speedScale: 0.1 };
const energyKinds = (speeds: number[]) => ["polyline", "point", speeds[0] === 0 ? "point" : "vector", "polyline", "point", speeds[1] === 0 ? "point" : "vector"];

// Independent oracle: choose both physical states first, then compute the work
// from E_final - E_initial. Neither oracle speed comes from the implementation.
for (const [h0, v0, h1, v1] of [[5, 0, 0, 10], [0, 10, 5, 0], [2, 3, 7, 9], [7, 9, 2, 3], [-2, 4, 3, 6], [3, 6, -2, 4], [0, 4, 0, 4]]) {
  const work = 0.5 * energyBase.mass * (v1! ** 2 - v0! ** 2) + energyBase.mass * energyBase.gravity * (h1! - h0!);
  for (const known of [0, 1, 2]) test(`energy h=${h0},${h1} v=${v0},${v1} known=${known}`, () => {
    const states = [{ height: h0, ...(known !== 1 ? { speed: v0 } : {}) }, { height: h1, ...(known !== 0 ? { speed: v1 } : {}) }];
    const inputs = { ...energyBase, states, workNonconservative: work };
    const outputs = evaluateMechanicsDiagramConstruction("mechanical_energy_pair", inputs, context);
    const initial = outputs[2]!.mechanics.magnitude;
    const final = outputs[5]!.mechanics.magnitude;
    close(initial, v0!, "initial speed");
    close(final, v1!, "final speed");
    close(0.5 * energyBase.mass * (final ** 2 - initial ** 2) + energyBase.mass * energyBase.gravity * (h1! - h0!), work, "signed energy balance");
    const document = scene("mechanical_energy_pair", inputs, energyKinds([v0!, v1!]));
    document.entities[2]!.label = `v=${v0} m/s`;
    document.entities[5]!.label = `v=${v1} m/s`;
    compiled(document, "both state directions compile with independently known speed labels");
  });
}
// A source at the exact turning boundary must survive the last-bit error in
// squaring sqrt(2gh); it must not turn a meaningful energy deficit into zero.
for (const gravity of [3.7, 9.81, 9.80665]) {
  for (const height of [0.3, 5, 12.3]) {
    const boundarySpeed = Math.sqrt(2 * gravity * height);
    for (const known of [0, 1]) test(`turning boundary g=${gravity} h=${height} known=${known}`, () => {
      const states = known === 0
        ? [{ height: 0, speed: boundarySpeed }, { height }]
        : [{ height }, { height: 0, speed: boundarySpeed }];
      const inputs = { ...energyBase, gravity, states };
      const missing = known === 0 ? 1 : 0;
      const outputs = evaluateMechanicsDiagramConstruction("mechanical_energy_pair", inputs, context);
      check(outputs[missing * 3 + 2]!.mechanics.magnitude === 0, "turning state must have exactly zero speed");
      const document = scene("mechanical_energy_pair", inputs, energyKinds(known === 0 ? [boundarySpeed, 0] : [0, boundarySpeed]));
      document.entities[missing * 3 + 2]!.label = "v=0 m/s";
      compiled(document, "turning boundary compiles with a zero-speed label");
      const deficient = structuredClone(inputs);
      deficient.states[known]!.speed = Math.sqrt(2 * gravity * height - 1e-8);
      rejected(scene("mechanical_energy_pair", deficient, energyKinds([1, 1])), "a meaningful negative squared speed still rejects");
      const above = structuredClone(inputs);
      above.states[known]!.speed = Math.sqrt(2 * gravity * height + 1e-8);
      const nonzero = evaluateMechanicsDiagramConstruction("mechanical_energy_pair", { ...above, speedScale: 1e6 }, context)[missing * 3 + 2]!;
      check(nonzero.kind === "path" && nonzero.mechanics.magnitude > 0, "a meaningful positive squared speed remains nonzero");
    });
  }
}

for (const states of [
  [{ height: 0, speed: -3 }, { height: 0 }],
  [{ height: 0 }, { height: 0, speed: -3 }],
  [{ height: 0, speed: -3 }, { height: 0, speed: -3 }],
  [{ height: 0, speed: 0 }, { height: 5 }],
  [{ height: 5 }, { height: 0, speed: 0 }],
  [{ height: 0, speed: 0 }, { height: 5, speed: 0 }],
]) test("invalid energy states", () => rejected(scene("mechanical_energy_pair", { ...energyBase, states }, energyKinds([1, 1])), "negative speeds, unreachable or contradictory energy states fail atomically"));

test("nonfinite energy arithmetic", () => rejected(scene("mechanical_energy_pair", {
  ...energyBase, mass: Number.MIN_VALUE, workNonconservative: 1,
  states: [{ height: 0, speed: 0 }, { height: 0 }],
}, energyKinds([0, 1])), "roundoff cancellation cannot convert overflow into zero speed"));

const inclineBase = { mass: 2, gravity: 10, origin: [0, 0], displayScale: 3, forceScale: 0.05, accelScale: 0.17, units: { mass: "kg", gravity: "m/s^2" } };
for (const angle of [15, 30, 45, 60]) {
  const radians = angle * Math.PI / 180;
  const up = { x: Math.cos(radians), y: Math.sin(radians) };
  for (const mu of [0, 0.2, Math.tan(radians), 2]) {
    for (const motion of ["down", "up"] as const) test(`incline angle=${angle} mu=${mu} motion=${motion}`, () => {
      // Newton's law projected uphill; motion specifies velocity, not acceleration.
      const expected = mu === Math.tan(radians) && motion === "down" ? 0
        : -inclineBase.gravity * Math.sin(radians) + (motion === "down" ? 1 : -1) * mu * inclineBase.gravity * Math.cos(radians);
      const inputs = { ...inclineBase, angleDeg: angle, mu, motion };
      const outputs = evaluateChapterInstrumentConstruction("incline_friction", inputs, context);
      const acceleration = outputs[5]!.instrument.components;
      close(acceleration.x * up.x + acceleration.y * up.y, expected, "signed uphill acceleration");
      close(acceleration.x * -up.y + acceleration.y * up.x, 0, "no surface-normal acceleration");
      const friction = outputs[4]!.instrument.components;
      close(friction.x * up.x + friction.y * up.y, (motion === "down" ? 1 : -1) * mu * inclineBase.mass * inclineBase.gravity * Math.cos(radians), "friction opposes instantaneous slip");
      const total = outputs.slice(2, 5).reduce((sum, output) => ({ x: sum.x + output.instrument.components.x, y: sum.y + output.instrument.components.y }), { x: 0, y: 0 });
      close(total.x, inclineBase.mass * acceleration.x, "sum Fx=ma_x");
      close(total.y, inclineBase.mass * acceleration.y, "sum Fy=ma_y");
      if (expected === 0) check(outputs[5]!.kind === "point", "balanced sliding has a zero acceleration marker");
      compiled(scene("incline_friction", inputs, ["polyline", "point", "vector", "vector", mu === 0 ? "point" : "vector", expected === 0 ? "point" : "vector"]), "sliding instant compiles");
    });
  }
  test("valid static contact", () => compiled(scene("incline_friction", { ...inclineBase, angleDeg: angle, mu: 2, motion: "rest" }, ["polyline", "point", "vector", "vector", "vector", "point"]), "static equilibrium compiles"));
  test("impossible static contact", () => rejected(scene("incline_friction", { ...inclineBase, angleDeg: angle, mu: 0, motion: "rest" }, ["polyline", "point", "vector", "vector", "vector", "point"]), "insufficient static friction rejects"));
}
for (const delta of [-1e-8, 1e-8]) test("small physical acceleration retained", () => {
  const theta = Math.PI / 6;
  const output = evaluateChapterInstrumentConstruction("incline_friction", { ...inclineBase, angleDeg: 30, mu: Math.tan(theta) + delta, motion: "down", accelScale: 1e8 }, context)[5]!;
  check(output.kind === "path", "a resolvable nonzero acceleration must not be clamped to a point");
  check(Math.sign(output.instrument.components.x) === Math.sign(delta), "small acceleration keeps its physical direction");
});

assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Mechanics state consistency passed (${checks} independent equation, compile and atomic rejection checks).`);
