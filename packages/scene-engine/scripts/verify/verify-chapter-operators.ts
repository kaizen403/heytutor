import assert from "node:assert/strict";
import { evaluateRelativeMotionConstruction } from "../../src/compile/relativeMotionGeometry";
import { evaluateNetworkConstruction } from "../../src/compile/networkGeometry";
import { evaluateMechanicsDiagramConstruction } from "../../src/compile/mechanicsDiagramGeometry";
import { evaluateCurrentFieldConstruction } from "../../src/compile/currentFieldGeometry";
import { evaluateChapterRemainderConstruction } from "../../src/compile/chapterRemainderGeometry";
import { evaluateChapterInstrumentConstruction } from "../../src/compile/chapterInstrumentGeometry";
import type { SourceContext } from "../../src/compile/sourceScalars";
import type { SceneDocument } from "../../src/types";

const context: SourceContext = {
  number: (value) => Number(value),
  point: () => { throw new Error("missing point"); },
  geometry: () => undefined,
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}
function close(actual: number, expected: number, message: string): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function reject(run: () => unknown, message: string): void {
  checks += 1;
  assert.throws(run, undefined, message);
}

const units = { velocity: "m/s" };
const triangle = evaluateRelativeMotionConstruction("velocity_triangle", {
  frameVelocity: [3, 0], bodyVelocity: [-1.5, 2.598076211353316], units, origin: [0, 0], displayScale: 0.4, headingDeg: 120,
}, context);
check(triangle.length === 3 && triangle[2]!.kind === "path", "heading triangle emits a resultant");
close(triangle[2]!.relativeMotion.components.x, 1.5, "resultant x is the velocity sum");
close(triangle[2]!.relativeMotion.components.y, 2.598076211353316, "resultant y is the velocity sum");
reject(() => evaluateRelativeMotionConstruction("velocity_triangle", {
  frameVelocity: [3, 0], bodyVelocity: [0, 3], units, displayScale: 0.4, headingDeg: 30,
}, context), "a wrong heading cannot certify the triangle");

const collinear = evaluateRelativeMotionConstruction("collinear_velocity_pair", {
  frameVelocity: [3, 0], bodySpeed: 5, units, origin: [0, 0], displayScale: 0.4,
}, context);
close(collinear[2]!.relativeMotion.components.x, 8, "downstream is boat plus current");
close(collinear[3]!.relativeMotion.components.x, -2, "upstream is current minus boat");
check(collinear.every((arrow) => arrow.kind === "path" && arrow.points[0]!.y !== arrow.points[1]!.y || arrow.relativeMotion.components.y === 0), "collinear arrows stay parallel to the current");
check(collinear[0]!.kind === "path" && collinear[1]!.kind === "path" && collinear[0]!.points[0]!.y !== collinear[1]!.points[0]!.y, "along-stream arrows are separated so they remain readable");

const crossing = evaluateRelativeMotionConstruction("crossing_strategies", {
  current: [3, 0], boatSpeed: 5, units, origin: [-1, 0], secondOrigin: [1, 0], displayScale: 0.4,
}, context);
close(crossing[1]!.relativeMotion.magnitude, 5, "straight-across heading preserves boat speed");
close(crossing[2]!.relativeMotion.components.x, 0, "straight-across resultant has no downstream component");
close(crossing[2]!.relativeMotion.components.y, 4, "straight-across speed is sqrt(b^2-c^2)");
close(crossing[4]!.relativeMotion.components.x, 0, "shortest-time heading is perpendicular to the current");
close(crossing[5]!.relativeMotion.components.x, 3, "shortest-time resultant keeps the current");
close(crossing[5]!.relativeMotion.components.y, 5, "shortest-time boat component is the full boat speed");
reject(() => evaluateRelativeMotionConstruction("crossing_strategies", {
  current: [5, 0], boatSpeed: 5, units, origin: [0, 0], secondOrigin: [1, 0], displayScale: 0.4,
}, context), "equal boat and current speeds cannot fabricate a straight-across triangle");

const network = evaluateNetworkConstruction("kirchhoff_network", {
  nodes: [
    { id: "bl", at: [0, 0] }, { id: "bc", at: [3, 0] }, { id: "br", at: [6, 0] },
    { id: "tl", at: [0, 2] }, { id: "tc", at: [3, 2] }, { id: "tr", at: [6, 2] },
  ],
  branches: [
    { id: "V1", from: "bl", to: "tl", kind: "source", resistance: 1, emf: 10 },
    { id: "R1", from: "tl", to: "tc", kind: "resistor", resistance: 2 },
    { id: "R3", from: "tc", to: "bc", kind: "resistor", resistance: 4 },
    { id: "R2", from: "tc", to: "tr", kind: "resistor", resistance: 2 },
    { id: "V2", from: "br", to: "tr", kind: "source", resistance: 1, emf: 5 },
    { id: "wbl", from: "bl", to: "bc", kind: "wire" },
    { id: "wbr", from: "bc", to: "br", kind: "wire" },
  ],
  ground: "bc",
  units: { resistance: "ohm", emf: "V" },
  currentScale: 0.4,
}, context);
const branchCurrent = (id: string): number => network.find((item) => item.networkBranch?.id === id)!.networkBranch!.current;
close(branchCurrent("V1"), 1.5151515151515156, "left source current matches the independent nodal solution");
close(branchCurrent("R3"), 1.3636363636363638, "shared branch current matches the independent nodal solution");
close(branchCurrent("V2"), -0.15151515151515138, "right source current is signed from its from-to direction");
check(network.filter((item) => item.kind === "compound").length === 7, "every branch draws its own glyph, including both loops");
reject(() => evaluateNetworkConstruction("kirchhoff_network", {
  nodes: [{ id: "a", at: [0, 0] }, { id: "b", at: [1, 0] }, { id: "g", at: [0, 1] }],
  branches: [{ id: "open", from: "a", to: "b", kind: "resistor", resistance: 2 }],
  ground: "g", units: { resistance: "ohm", emf: "V" }, currentScale: 1,
}, context), "a floating resistor with an isolated reference is not certified");

const equilibrium = evaluateMechanicsDiagramConstruction("free_body", {
  origin: [0, 0],
  forces: [{ components: [3, 4] }, { components: [-3, -4] }],
  units: { force: "N" },
  displayScale: 1.2,
  equilibrium: true,
}, context);
check(equilibrium.length === 3, "free body keeps both supplied forces and does not invent a third");
reject(() => evaluateMechanicsDiagramConstruction("free_body", {
  origin: [0, 0], forces: [{ components: [1, 0] }], units: { force: "N" }, displayScale: 1, equilibrium: true,
}, context), "equilibrium rejects a nonzero force sum");
reject(() => evaluateMechanicsDiagramConstruction("free_body", {
  origin: [0, 0], forces: [{ components: [2, 0] }], units: { force: "N" }, displayScale: 1,
  mass: 2, massUnit: "kg", acceleration: [2, 0], accelerationUnit: "m/s^2",
}, context), "stale acceleration cannot pair with a different force sum");

const atwood = evaluateMechanicsDiagramConstruction("coupled_bodies", {
  link: "string",
  bodies: [
    { mass: 3, external: [0, -30], stringPull: [0, 1], at: [-1, 0] },
    { mass: 1, external: [0, -10], stringPull: [0, 1], at: [1, 0] },
  ],
  units: { mass: "kg", force: "N" },
  forceScale: 0.05,
  accelerationScale: 0.2,
}, context);
close(atwood[2]!.mechanics.magnitude, 15, "Atwood tension is 2 m1 m2 g / (m1+m2)");
close(atwood[4]!.mechanics.components.y, -5, "heavier mass accelerates against the string pull");
reject(() => evaluateMechanicsDiagramConstruction("coupled_bodies", {
  link: "string",
  bodies: [
    { mass: 1, external: [5, 0], stringPull: [1, 0], at: [0, 0] },
    { mass: 1, external: [5, 0], stringPull: [1, 0], at: [2, 0] },
  ],
  units: { mass: "kg", force: "N" }, forceScale: 0.2, accelerationScale: 0.2,
}, context), "a string does not certify compression");

const bottom = evaluateMechanicsDiagramConstruction("vertical_circle", {
  radius: 0.5, mass: 2, gravity: 10, angleDeg: 0, speed: 4, constraint: "string",
  units: { length: "m", mass: "kg", speed: "m/s", gravity: "m/s^2" }, displayScale: 2, forceScale: 0.02,
}, context);
close(bottom[4]!.mechanics.magnitude, 84, "bottom tension is mv^2/R + mg");
const fromEnergy = evaluateMechanicsDiagramConstruction("vertical_circle", {
  radius: 0.5, mass: 2, gravity: 10, angleDeg: 180, speedAtBottom: 6, constraint: "string",
  units: { length: "m", mass: "kg", speed: "m/s", gravity: "m/s^2" }, displayScale: 2, forceScale: 0.02,
}, context);
close(fromEnergy[1]!.mechanics.magnitude, 4, "top speed comes from energy, not from the bottom speed");
close(fromEnergy[4]!.mechanics.magnitude, 44, "top tension is mv^2/R - mg");
reject(() => evaluateMechanicsDiagramConstruction("vertical_circle", {
  radius: 0.5, mass: 1, gravity: 10, angleDeg: 180, speed: 1, constraint: "string",
  units: { length: "m", mass: "kg", speed: "m/s", gravity: "m/s^2" }, displayScale: 1, forceScale: 0.1,
}, context), "a slack string is not drawn as taut");

const energy = evaluateMechanicsDiagramConstruction("mechanical_energy_pair", {
  mass: 2, gravity: 10, states: [{ height: 5, speed: 0 }, { height: 0 }],
  units: { mass: "kg", gravity: "m/s^2", height: "m", speed: "m/s" }, heightScale: 0.3, speedScale: 0.1,
}, context);
close(energy[5]!.mechanics.magnitude, 10, "dropped speed is sqrt(2gh)");
reject(() => evaluateMechanicsDiagramConstruction("mechanical_energy_pair", {
  mass: 2, gravity: 10, states: [{ height: 5, speed: 0 }, { height: 0, speed: 4 }],
  units: { mass: "kg", gravity: "m/s^2", height: "m", speed: "m/s" }, heightScale: 0.3, speedScale: 0.1,
}, context), "a stale landing speed cannot pair with the drop");

const mu0 = 4e-7 * Math.PI;
const wire = evaluateCurrentFieldConstruction("current_element_field", {
  shape: "infinite_wire", current: 8, mu0, units: { current: "A", length: "m", mu0: "N/A^2" },
  displayLength: 1.2, through: [0, 0], direction: [0, 1], at: [0.05, 0],
}, context);
close(wire[0]!.currentField.components.z, -mu0 * 8 / (2 * Math.PI * 0.05), "infinite wire uses the right-hand page-normal field");
const finite = evaluateCurrentFieldConstruction("current_element_field", {
  shape: "finite_wire", current: 4, mu0, units: { current: "A", length: "m", mu0: "N/A^2" },
  displayLength: 1, start: [-0.3, 0], end: [0.3, 0], at: [0, 0.4],
}, context);
const finiteExpected = mu0 * 4 / (4 * Math.PI * 0.4) * (2 * 0.3 / Math.hypot(0.3, 0.4));
close(finite[0]!.currentField.components.z, finiteExpected, "symmetric finite wire matches the textbook sine formula");
const loop = evaluateCurrentFieldConstruction("current_element_field", {
  shape: "arc", current: 3, mu0, units: { current: "A", length: "m", mu0: "N/A^2" },
  displayLength: 1, radius: 0.2, startAngle: 0, endAngle: 2 * Math.PI,
}, context);
close(loop[0]!.currentField.components.z, mu0 * 3 / (2 * 0.2), "a full turn is the loop-center field");
const axis = evaluateCurrentFieldConstruction("current_element_field", {
  shape: "loop_axis", current: 2, mu0, units: { current: "A", length: "m", mu0: "N/A^2" },
  displayLength: 1, radius: 0.1, distance: 0.1, axis: [1, 0],
}, context);
close(axis[0]!.currentField.components.x, mu0 * 2 * 0.01 / (2 * Math.pow(0.02, 1.5)), "axial loop field uses the closed form");

const conductor = evaluateCurrentFieldConstruction("conductor_force", {
  current: 2, length: [0.4, 0, 0], magneticField: [0, 0, 0.5],
  units: { current: "A", length: "m", magneticField: "T" }, displayLength: 1,
}, context);
close(conductor[0]!.currentField.components.y, -0.4, "I L cross B follows the right-hand rule and ignores display length");
const wires = evaluateCurrentFieldConstruction("parallel_wire_force", {
  currents: [3, 3], separation: 0.1, mu0, length: 1, units: { current: "A", length: "m", mu0: "N/A^2" },
  displayScale: 8, forceScale: 1,
}, context);
close(wires[2]!.currentField.components.x, mu0 * 9 / (2 * Math.PI * 0.1), "same-direction currents attract");
check(wires[3]!.currentField.components.x < 0, "the partner force points back toward the first wire");
const dipole = evaluateCurrentFieldConstruction("magnetic_dipole_field", {
  moment: [0.2, 0], at: [0.4, 0], mu0, units: { moment: "A m^2", length: "m", mu0: "N/A^2" }, displayLength: 1,
}, context);
close(dipole[0]!.currentField.components.x, mu0 / (4 * Math.PI) * 2 * 0.2 / 0.4 ** 3, "axial dipole field is the standard 2m/r^3 term");
const outside = evaluateCurrentFieldConstruction("solenoid_field", {
  turnsPerLength: 400, current: 2, mu0, region: "exterior", axis: [1, 0],
  units: { turnsPerLength: "1/m", current: "A", mu0: "N/A^2" }, displayLength: 1,
}, context);
check(outside[0]!.kind === "point" && outside[0]!.currentField.zero, "ideal exterior solenoid field is a certified zero, not a guessed arrow");

const relative = evaluateChapterRemainderConstruction("relative_velocity", {
  velocityA: [4, 1], velocityB: [1, 1], units: { velocity: "m/s" }, displayScale: 1,
}, context);
check(relative[2]!.kind === "path" && relative[2]!.remainder.components.x === 3 && relative[2]!.remainder.components.y === 0, "relative velocity is vA minus vB in one frame");
reject(() => evaluateChapterRemainderConstruction("relative_velocity", {
  velocityA: [1, 0], velocityB: [0, 1], displayScale: 1,
}, context), "relative velocity without a shared unit is not certified");

const graph = evaluateChapterRemainderConstruction("motion_graph", {
  quantity: "position", points: [{ t: 0, value: 0 }, { t: 2, value: 6 }], timeScale: 1, ordinateScale: 1,
}, context);
check(graph[0]!.kind === "path" && graph[0]!.points[1]!.x === 2 && graph[0]!.points[1]!.y === 6, "motion graph uses the supplied samples");
reject(() => evaluateChapterRemainderConstruction("motion_graph", {
  quantity: "velocity", points: [{ t: 1, value: 0 }, { t: 1, value: 2 }], timeScale: 1, ordinateScale: 1,
}, context), "a repeated sample time is not a motion graph");

const circular = evaluateChapterRemainderConstruction("uniform_circular_motion", {
  radius: 0.5, speed: 2, displayScale: 1, vectorScale: 1,
}, context);
close(circular[4]!.remainder.magnitude, 8, "centripetal acceleration is v^2/R");
check(circular[3]!.kind === "path" && circular[4]!.kind === "path", "circular motion draws tangent velocity and inward acceleration");

const level = evaluateChapterRemainderConstruction("projectile_trajectory", {
  speed: 10, launchAngleDeg: 30, gravity: 10, displayScale: 1,
}, context);
check(level[0]!.kind === "path", "level projectile emits a trajectory");
close(level[0]!.points.at(-1)!.y, 0, "level landing height is the ground");
close(level[0]!.points.at(-1)!.x, 5 * Math.sqrt(3), "level range is u^2 sin(2theta)/g");
const inclineShot = evaluateChapterRemainderConstruction("projectile_trajectory", {
  speed: 20, launchAngleDeg: 60, gravity: 10, inclineAngleDeg: 30, direction: "up", displayScale: 1,
}, context);
const landing = inclineShot[0]!.kind === "path" ? inclineShot[0]!.points.at(-1)! : { x: 0, y: 0 };
close(landing.y, landing.x / Math.sqrt(3), "incline landing lies on the supplied incline");
reject(() => evaluateChapterRemainderConstruction("projectile_trajectory", {
  speed: 5, launchAngleDeg: -30, gravity: 10, inclineAngleDeg: 45, direction: "up", displayScale: 1,
}, context), "a launch that never meets the incline emits nothing");

const work = evaluateChapterRemainderConstruction("work_interval", {
  force: [3, 4], displacement: [2, -1], displayScale: 1,
}, context);
close(work[1]!.remainder.certified ?? NaN, 2, "work is the source dot product");

const spring = evaluateChapterRemainderConstruction("spring_energy", {
  stiffness: 200, extension: 0.1, displayScale: 1,
}, context);
close(spring[0]!.remainder.components.y, 1, "spring energy is one half k x squared");
reject(() => evaluateChapterRemainderConstruction("spring_energy", {
  stiffness: 200, extension: 0, displayScale: 1,
}, context), "a zero extension is not stored spring energy");

const hit = evaluateChapterRemainderConstruction("collision", {
  mass1: 2, mass2: 1, velocity1: 3, velocity2: 0, restitution: 1, displayScale: 1,
}, context);
close(hit[2]!.remainder.components.x, 1, "elastic collision leaves the heavier body at 1 m/s");
close(hit[3]!.remainder.components.x, 4, "elastic collision sends the lighter body at 4 m/s");
reject(() => evaluateChapterRemainderConstruction("collision", {
  mass1: 1, mass2: 1, velocity1: 1, velocity2: 2, restitution: 1, displayScale: 1,
}, context), "separating bodies are not drawn as a collision");

const torque = evaluateChapterRemainderConstruction("loop_torque", {
  current: 2, area: [0, 0, 0.5], magneticField: [0.4, 0, 0], displayLength: 1,
}, context);
close(torque[0]!.remainder.components.y, 0.4, "loop torque is I(A cross B)");
const pageTorque = evaluateChapterRemainderConstruction("loop_torque", {
  current: 1, area: [0.2, 0, 0], magneticField: [0, 0.5, 0], displayLength: 1,
}, context);
check(pageTorque[0]!.kind === "multi_path" && pageTorque[0]!.remainder.pageNormal === "out", "page-normal torque is a glyph, not a projected arrow");

const meter = evaluateChapterRemainderConstruction("galvanometer", {
  current: 0.01, turns: 100, area: 1e-3, field: 0.2, springConstant: 1e-3, displayScale: 1,
}, context);
close(meter[1]!.remainder.components.x, 0.2, "radial-field deflection is NIBA/k");
reject(() => evaluateChapterRemainderConstruction("galvanometer", {
  current: 2, turns: 100, area: 1, field: 1, springConstant: 1, displayScale: 1,
}, context), "a deflection past a right angle is not drawn as a needle");

const magnet = evaluateChapterRemainderConstruction("bar_magnet", {
  moment: [1, 0], displayScale: 1,
}, context);
check(magnet.length === 5 && magnet[1]!.kind === "path" && magnet[2]!.kind === "path", "a bar magnet draws the bar and both dipole lobes");
check(magnet[1]!.kind === "path" && magnet[2]!.kind === "path" && magnet[1]!.points.some((point) => point.y < 0) && magnet[2]!.points.some((point) => point.y > 0), "dipole lobes lie on opposite sides of the moment");

const bridge = evaluateChapterInstrumentConstruction("metre_bridge", {
  knownResistance: 2, unknownResistance: 6, wireLength: 100, origin: [0, 0], displayLength: 4,
  units: { resistance: "ohm", length: "cm" },
}, context);
close(bridge[1]!.instrument.components.x, 25, "metre-bridge jockey is at L R/(R+X)");
close(bridge[3]!.instrument.certified ?? NaN, 6, "right-gap unknown follows X/R=(L-l)/l");
reject(() => evaluateChapterInstrumentConstruction("metre_bridge", {
  knownResistance: 2, unknownResistance: 6, balanceFromLeft: 40, wireLength: 100, displayLength: 4,
  units: { resistance: "ohm", length: "cm" },
}, context), "a stale jockey position cannot pair with the balance law");

const nullPoint = evaluateChapterInstrumentConstruction("potentiometer", {
  driverEmf: 2, cellEmf: 0.5, wireLength: 100, displayLength: 4, units: { emf: "V", length: "cm" },
}, context);
close(nullPoint[1]!.instrument.components.x, 25, "potentiometer null point is L times the emf ratio");
reject(() => evaluateChapterInstrumentConstruction("potentiometer", {
  driverEmf: 1, cellEmf: 2, wireLength: 100, displayLength: 4, units: { emf: "V", length: "cm" },
}, context), "a cell above the driver has no null point");

const held = evaluateChapterInstrumentConstruction("incline_friction", {
  mass: 2, gravity: 10, angleDeg: 30, mu: 1, motion: "rest", displayScale: 2, forceScale: 0.05, accelScale: 0.2,
  units: { mass: "kg", gravity: "m/s^2" },
}, context);
close(held[4]!.instrument.magnitude, 10, "static friction equals the downhill component when the block rests");
close(held[3]!.instrument.magnitude, 10 * Math.sqrt(3), "normal is mg cos theta");
reject(() => evaluateChapterInstrumentConstruction("incline_friction", {
  mass: 2, gravity: 10, angleDeg: 30, mu: 1, motion: "down", displayScale: 2, forceScale: 0.05, accelScale: 0.2,
  units: { mass: "kg", gravity: "m/s^2" },
}, context), "downhill motion is rejected when friction would accelerate the block up the plane");

const orbit = evaluateChapterInstrumentConstruction("cyclotron", {
  charge: 1.6e-19, mass: 1.67e-27, field: 0.5, speed: 1e6, displayScale: 1e5,
  units: { charge: "C", mass: "kg", field: "T", speed: "m/s" },
}, context);
close(orbit[0]!.instrument.certified ?? NaN, 1.67e-27 * 1e6 / (1.6e-19 * 0.5), "cyclotron radius is mv/(|q|B)");
check(orbit[1]!.kind === "path" && orbit[2]!.kind === "path" && orbit[4]!.instrument.pageNormal === "out", "cyclotron draws both dees and the page-normal field");

function scene(operator: string, inputs: Record<string, unknown>, entities: Array<[string, string]>): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: operator },
    source: {},
    quantities: [],
    entities: entities.map(([id, kind]) => ({ id, kind, role: kind })),
    constructions: [{ id: "make", operator, inputs, outputs: entities.map(([id]) => id) }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: entities.map(([id]) => id),
    revealGroups: [{ id: "g", entityIds: entities.map(([id]) => id), dependsOn: [], narrationCue: operator }],
    teachingTimeline: [],
  };
}

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument } = await import("../../src/index");
  const valid = scene("collinear_velocity_pair", {
    frameVelocity: [3, 0], bodySpeed: 5, units, origin: [0, 0], displayScale: 0.4,
  }, [["vc", "vector"], ["vb", "vector"], ["vd", "vector"], ["vu", "vector"]]);
  const compiled = compileSceneDocument(valid);
  check(compiled.ok && compiled.renderScene, `live relative-motion compile: ${JSON.stringify(compiled.report.issues)}`);
  check(compiled.renderScene.primitives.some((primitive) => primitive.entityId === "vd" && primitive.kind === "vector"), "downstream arrow reaches ink");
  const invalid = scene("crossing_strategies", {
    current: [5, 0], boatSpeed: 4, units, origin: [0, 0], secondOrigin: [1, 0], displayScale: 0.4,
  }, [["a", "vector"], ["b", "vector"], ["c", "vector"], ["d", "vector"], ["e", "vector"], ["f", "vector"]]);
  const rejected = compileSceneDocument(invalid);
  check(!rejected.ok && rejected.renderScene === null, "an impossible crossing emits no partial scene");
  const loopScene = scene("kirchhoff_network", {
    nodes: [{ id: "a", at: [0, 0] }, { id: "b", at: [2, 0] }],
    branches: [
      { id: "E", from: "a", to: "b", kind: "source", resistance: 1, emf: 6 },
      { id: "R", from: "b", to: "a", kind: "resistor", resistance: 2 },
    ],
    ground: "a", units: { resistance: "ohm", emf: "V" }, currentScale: 0.3,
  }, [["a", "point"], ["b", "point"], ["E", "polyline"], ["R", "polyline"], ["Ie", "vector"], ["Ir", "vector"]]);
  const solved = compileSceneDocument(loopScene);
  check(solved.ok && solved.renderScene, `live Kirchhoff compile: ${JSON.stringify(solved.report.issues)}`);
  check(solved.renderScene.primitives.filter((primitive) => primitive.entityId === "E" || primitive.entityId === "R").length >= 2, "both loop branches reach ink");
  const shot = scene("projectile_trajectory", {
    speed: 10, launchAngleDeg: 30, gravity: 10, displayScale: 0.2,
  }, [["path", "polyline"], ["launch", "vector"]]);
  const drawnShot = compileSceneDocument(shot);
  check(drawnShot.ok && drawnShot.renderScene, `live projectile compile: ${JSON.stringify(drawnShot.report.issues)}`);
  const badBridge = scene("metre_bridge", {
    knownResistance: 2, unknownResistance: 6, balanceFromLeft: 40, wireLength: 100, displayLength: 4,
    units: { resistance: "ohm", length: "cm" },
  }, [["wire", "polyline"], ["jockey", "point"], ["left", "polyline"], ["right", "polyline"]]);
  const rejectedBridge = compileSceneDocument(badBridge);
  check(!rejectedBridge.ok && rejectedBridge.renderScene === null, "a contradictory metre bridge emits no partial scene");
}
console.log(`chapter operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
