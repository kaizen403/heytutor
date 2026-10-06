import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, canonicalUnit, compactNumber, hypot2, invalid, isRecord, pair, placement, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, unit2, validationNumber,
  type SourceContext,
} from "./sourceScalars";

export const MECHANICS_DIAGRAM_OPERATORS = ["free_body", "coupled_bodies", "vertical_circle", "mechanical_energy_pair"] as const;
export type MechanicsDiagramOperator = (typeof MECHANICS_DIAGRAM_OPERATORS)[number];

export interface MechanicsMark {
  role: string;
  components: RenderPoint;
  magnitude: number;
  unit: string;
  displayScale: number;
  zero: boolean;
}
export type MechanicsGeometry =
  | { kind: "point"; point: RenderPoint; mechanics: MechanicsMark }
  | { kind: "path"; points: RenderPoint[]; directed?: true; closed?: true; mechanics: MechanicsMark }
  | { kind: "circle"; center: RenderPoint; radius: number; mechanics: MechanicsMark };

const FORCE: Readonly<Record<string, string>> = { N: "N", newton: "N", newtons: "N" };
const MASS: Readonly<Record<string, string>> = { kg: "kg", g: "g", gram: "g", grams: "g" };
const ACCEL: Readonly<Record<string, string>> = { "m/s^2": "m/s^2", "m/s²": "m/s^2" };
const LENGTH: Readonly<Record<string, string>> = { m: "m", metre: "m", meter: "m", cm: "cm", mm: "mm" };
const SPEED: Readonly<Record<string, string>> = { "m/s": "m/s" };
const GRAVITY: Readonly<Record<string, string>> = { "m/s^2": "m/s^2", "m/s²": "m/s^2" };
const JOULE: Readonly<Record<string, string>> = { J: "J", joule: "J", joules: "J" };

function isOperator(operator: string): operator is MechanicsDiagramOperator {
  return (MECHANICS_DIAGRAM_OPERATORS as readonly string[]).includes(operator);
}
function unitOf(inputs: Record<string, unknown>, key: string, aliases: Readonly<Record<string, string>>, expected: string): string {
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units[key], aliases) !== expected) invalid("units", `${key} must declare ${expected}`);
  return expected;
}
function mark(role: string, components: RenderPoint, unit: string, displayScale: number): MechanicsMark {
  return { role, components: { ...components }, magnitude: hypot2(components), unit, displayScale, zero: hypot2(components) === 0 };
}
function directed(origin: RenderPoint, components: RenderPoint, scale: number, metadata: MechanicsMark, lane = { x: 0, y: 0 }): MechanicsGeometry {
  const start = add2(origin, lane, "placement");
  if (metadata.zero) return { kind: "point", point: start, mechanics: metadata };
  const delta = scale2(components, scale, "display");
  if (!(hypot2(delta) > 1e-6)) invalid("precision", "a nonzero vector collapses at the stated display scale");
  return { kind: "path", points: [start, add2(start, delta, "display")], directed: true, mechanics: metadata };
}

function readFreeBody(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): MechanicsGeometry[] {
  rejectUnknownKeys(inputs, ["origin", "forces", "units", "displayScale", "equilibrium", "mass", "acceleration", "massUnit", "accelerationUnit"]);
  unitOf(inputs, "force", FORCE, "N");
  if (!Array.isArray(inputs.forces) || inputs.forces.length < 1 || inputs.forces.length > 8) invalid("forces", "free_body requires 1 to 8 explicit forces");
  const forces = inputs.forces.map((force, index) => {
    if (!isRecord(force)) invalid("forces", "each force needs components");
    rejectUnknownKeys(force, ["components"], "forces");
    requireUnits(force.components, "N", FORCE, document);
    const components = pair(force.components, `forces[${index}].components`, context);
    if (hypot2(components) === 0) invalid("forces", "omit a zero force instead of certifying an empty arrow");
    return components;
  });
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = scalar(inputs.displayScale, "displayScale", context);
  if (!(displayScale > 1e-6)) invalid("displayScale", "displayScale must exceed 1e-6");
  const total = forces.reduce((sum, force) => add2(sum, force, "net"), { x: 0, y: 0 });
  if (inputs.equilibrium === true) {
    if (inputs.mass !== undefined || inputs.acceleration !== undefined) invalid("equilibrium", "equilibrium cannot be combined with a supplied mass and acceleration");
    if (hypot2(total) !== 0) invalid("equilibrium", "supplied forces do not sum to zero");
  }
  if (inputs.mass !== undefined || inputs.acceleration !== undefined) {
    if (inputs.mass === undefined || inputs.acceleration === undefined) invalid("mass", "Newton's second law requires both mass and acceleration");
    if (canonicalUnit(inputs.massUnit, MASS) !== "kg" || canonicalUnit(inputs.accelerationUnit, ACCEL) !== "m/s^2") invalid("units", "mass must be kg and acceleration m/s^2");
    requireUnits(inputs.mass, "kg", MASS, document);
    requireUnits(inputs.acceleration, "m/s^2", ACCEL, document);
    const mass = scalar(inputs.mass, "mass", context);
    const acceleration = pair(inputs.acceleration, "acceleration", context);
    if (!(mass > 0)) invalid("mass", "mass must be positive");
    const expected = scale2(acceleration, mass, "ma");
    if (expected.x !== total.x || expected.y !== total.y) invalid("acceleration", "supplied forces do not equal mass times acceleration");
  }
  const largest = Math.max(...forces.map(hypot2));
  return [
    { kind: "point", point: origin, mechanics: mark("body", { x: 0, y: 0 }, "1", displayScale) },
    ...forces.map((components, index) => directed(origin, components, displayScale / largest, mark(`F${index + 1}`, components, "N", displayScale), { x: index * 1e-4, y: 0 })),
  ];
}

function readCoupled(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): MechanicsGeometry[] {
  rejectUnknownKeys(inputs, ["link", "bodies", "units", "forceScale", "accelerationScale"]);
  if (inputs.link !== "string" && inputs.link !== "rod") invalid("link", "link must be string or rod");
  unitOf(inputs, "mass", MASS, "kg");
  unitOf(inputs, "force", FORCE, "N");
  if (!Array.isArray(inputs.bodies) || inputs.bodies.length !== 2) invalid("bodies", "coupled_bodies requires exactly two bodies");
  const bodies = inputs.bodies.map((body, index) => {
    if (!isRecord(body)) invalid("bodies", "each body needs mass, external force, string pull, and placement");
    rejectUnknownKeys(body, ["mass", "external", "stringPull", "at"], "bodies");
    requireUnits(body.mass, "kg", MASS, document);
    requireUnits(body.external, "N", FORCE, document);
    const mass = scalar(body.mass, "mass", context);
    if (!(mass > 0)) invalid("mass", "mass must be positive");
    return {
      mass,
      external: pair(body.external, `bodies[${index}].external`, context),
      pull: unit2(pair(body.stringPull, `bodies[${index}].stringPull`, context), "stringPull"),
      at: pair(body.at, `bodies[${index}].at`, context),
    };
  });
  const [first, second] = bodies as [typeof bodies[0], typeof bodies[0]];
  const along = (body: typeof first): number => body.external.x * body.pull.x + body.external.y * body.pull.y;
  const tension = -(second.mass * along(first) + first.mass * along(second)) / (first.mass + second.mass);
  if (!Number.isFinite(tension)) invalid("precision", "constraint force is unresolved");
  if (inputs.link === "string" && tension < 0) invalid("link", "a string cannot carry compression; the constraint goes slack");
  const acceleration = (body: typeof first) => scale2(add2(body.external, scale2(body.pull, tension, "tension"), "net"), 1 / body.mass, "acceleration");
  const a1 = acceleration(first);
  const a2 = acceleration(second);
  const constraint = a1.x * first.pull.x + a1.y * first.pull.y + a2.x * second.pull.x + a2.y * second.pull.y;
  if (Math.abs(constraint) > 1e-8 * (hypot2(a1) + hypot2(a2) + 1)) invalid("precision", "solved accelerations do not keep the link length fixed");
  const forceScale = scalar(inputs.forceScale, "forceScale", context);
  const accelerationScale = scalar(inputs.accelerationScale, "accelerationScale", context);
  if (!(forceScale > 1e-6) || !(accelerationScale > 1e-6)) invalid("forceScale", "force and acceleration display scales must exceed 1e-6");
  if (first.at.x === second.at.x && first.at.y === second.at.y) invalid("bodies", "the two bodies need distinct placements");
  const lane = { x: 0.16, y: 0 };
  const tensionMark = mark("T", { x: tension, y: 0 }, "N", forceScale);
  return [
    { kind: "point", point: first.at, mechanics: mark("body", { x: 0, y: 0 }, "kg", 1) },
    { kind: "point", point: second.at, mechanics: mark("body", { x: 0, y: 0 }, "kg", 1) },
    directed(first.at, first.pull, tension * forceScale, tensionMark),
    directed(second.at, second.pull, tension * forceScale, tensionMark),
    directed(first.at, a1, accelerationScale, mark("a", a1, "m/s^2", accelerationScale), lane),
    directed(second.at, a2, accelerationScale, mark("a", a2, "m/s^2", accelerationScale), lane),
  ];
}

function readCircle(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): MechanicsGeometry[] {
  rejectUnknownKeys(inputs, ["radius", "mass", "gravity", "angleDeg", "speed", "speedAtBottom", "constraint", "units", "center", "displayScale", "forceScale"]);
  for (const [key, aliases, expected] of [["length", LENGTH, "m"], ["mass", MASS, "kg"], ["speed", SPEED, "m/s"], ["gravity", GRAVITY, "m/s^2"]] as const) unitOf(inputs, key, aliases, expected);
  const radius = scalar(inputs.radius, "radius", context);
  const mass = scalar(inputs.mass, "mass", context);
  const gravity = scalar(inputs.gravity, "gravity", context);
  const angleDeg = scalar(inputs.angleDeg, "angleDeg", context, 1e6);
  if (!(radius > 0) || !(mass > 0) || !(gravity > 0)) invalid("radius", "radius, mass, and gravity must be positive");
  if (inputs.constraint !== "string" && inputs.constraint !== "rod" && inputs.constraint !== "track_inside") invalid("constraint", "constraint must be string, rod, or track_inside");
  requireUnits(inputs.radius, "m", LENGTH, document);
  requireUnits(inputs.mass, "kg", MASS, document);
  requireUnits(inputs.gravity, "m/s^2", GRAVITY, document);
  const supplied = [inputs.speed !== undefined, inputs.speedAtBottom !== undefined].filter(Boolean).length;
  if (supplied !== 1) invalid("speed", "supply exactly one of speed or speedAtBottom");
  const theta = angleDeg * Math.PI / 180;
  const cos = Math.cos(theta);
  const height = radius * (1 - cos);
  let speed: number;
  if (inputs.speedAtBottom !== undefined) {
    requireUnits(inputs.speedAtBottom, "m/s", SPEED, document);
    const bottom = scalar(inputs.speedAtBottom, "speedAtBottom", context);
    if (bottom < 0) invalid("speedAtBottom", "speed cannot be negative");
    const squared = bottom * bottom - 2 * gravity * height;
    if (squared < 0) invalid("speed", "the supplied bottom speed does not reach this angle");
    speed = Math.sqrt(squared);
  } else {
    requireUnits(inputs.speed, "m/s", SPEED, document);
    speed = scalar(inputs.speed, "speed", context);
    if (speed < 0) invalid("speed", "speed cannot be negative");
  }
  const tension = mass * speed * speed / radius + mass * gravity * cos;
  if (!Number.isFinite(tension)) invalid("precision", "constraint force is unresolved");
  if (inputs.constraint !== "rod" && tension < 0) invalid("constraint", "the constraint leaves the circle; tension or normal would be negative");
  const displayScale = scalar(inputs.displayScale, "displayScale", context);
  const forceScale = scalar(inputs.forceScale, "forceScale", context);
  if (!(displayScale > 1e-6) || !(forceScale > 1e-6)) invalid("displayScale", "display scales must exceed 1e-6");
  const center = placement(inputs.center, "center", context);
  const drawnRadius = radius * displayScale;
  const massPoint = add2(center, { x: drawnRadius * Math.sin(theta), y: -drawnRadius * cos }, "position");
  const towardCenter = { x: -Math.sin(theta), y: Math.cos(theta) };
  const weight = { x: 0, y: -mass * gravity };
  const constraint = scale2(towardCenter, tension, "constraint");
  const circle: MechanicsGeometry = { kind: "circle", center, radius: drawnRadius, mechanics: mark("circle", { x: radius, y: 0 }, "m", displayScale) };
  const massMark: MechanicsGeometry = { kind: "point", point: massPoint, mechanics: mark("m", { x: speed, y: 0 }, "m/s", displayScale) };
  const radiusArm: MechanicsGeometry = { kind: "path", points: [center, massPoint], mechanics: mark("radius", { x: radius, y: 0 }, "m", displayScale) };
  return [
    circle,
    massMark,
    radiusArm,
    directed(massPoint, weight, forceScale, mark("weight", weight, "N", forceScale), { x: 0.12, y: 0 }),
    directed(massPoint, constraint, forceScale, mark("constraint", constraint, "N", forceScale)),
  ];
}

function readEnergy(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): MechanicsGeometry[] {
  rejectUnknownKeys(inputs, ["mass", "gravity", "states", "workNonconservative", "units", "origin", "heightScale", "speedScale"]);
  for (const [key, aliases, expected] of [["mass", MASS, "kg"], ["gravity", GRAVITY, "m/s^2"], ["height", LENGTH, "m"], ["speed", SPEED, "m/s"]] as const) unitOf(inputs, key, aliases, expected);
  if (!Array.isArray(inputs.states) || inputs.states.length !== 2) invalid("states", "mechanical_energy_pair requires exactly two states");
  const mass = scalar(inputs.mass, "mass", context);
  const gravity = scalar(inputs.gravity, "gravity", context);
  if (!(mass > 0) || !(gravity > 0)) invalid("mass", "mass and gravity must be positive");
  const work = inputs.workNonconservative === undefined ? 0 : scalar(inputs.workNonconservative, "workNonconservative", context);
  if (inputs.workNonconservative !== undefined) {
    if (!isRecord(inputs.units) || canonicalUnit(inputs.units.work, JOULE) !== "J") invalid("units", "nonconservative work must declare J");
    requireUnits(inputs.workNonconservative, "J", JOULE, document);
  }
  const states = inputs.states.map((state) => {
    if (!isRecord(state)) invalid("states", "each state needs a height");
    rejectUnknownKeys(state, ["height", "speed"], "states");
    requireUnits(state.height, "m", LENGTH, document);
    if (state.speed !== undefined) requireUnits(state.speed, "m/s", SPEED, document);
    return { height: scalar(state.height, "height", context), speed: state.speed === undefined ? undefined : scalar(state.speed, "speed", context) };
  });
  const known = states.filter((state) => state.speed !== undefined).length;
  if (known === 0) invalid("speed", "at least one state speed is required");
  const energy = (state: { height: number; speed: number }): number => 0.5 * mass * state.speed * state.speed + mass * gravity * state.height;
  if (states[0]!.speed !== undefined && states[1]!.speed !== undefined) {
    const difference = energy({ height: states[1]!.height, speed: states[1]!.speed! }) - energy({ height: states[0]!.height, speed: states[0]!.speed! }) - work;
    if (Math.abs(difference) > 1e-8 * (Math.abs(work) + mass * gravity * (Math.abs(states[0]!.height) + Math.abs(states[1]!.height)) + 1)) invalid("states", "the two states do not satisfy mechanical energy with the supplied work");
  } else {
    const knownIndex = states[0]!.speed === undefined ? 1 : 0;
    const missing = 1 - knownIndex;
    const knownState = states[knownIndex]!;
    const missingState = states[missing]!;
    const signed = knownIndex === 0 ? 1 : -1;
    const squared = knownState.speed! * knownState.speed! + signed * 2 * gravity * (knownState.height - missingState.height) + signed * 2 * work / mass;
    if (squared < 0) invalid("speed", "energy conservation does not yield a real speed");
    missingState.speed = Math.sqrt(squared);
  }
  const origin = placement(inputs.origin, "origin", context);
  const heightScale = scalar(inputs.heightScale, "heightScale", context);
  const speedScale = scalar(inputs.speedScale, "speedScale", context);
  if (!(heightScale > 1e-6) || !(speedScale > 1e-6)) invalid("heightScale", "height and speed display scales must exceed 1e-6");
  return states.flatMap((state, index) => {
    const y = origin.y + state.height * heightScale;
    const x = origin.x + index * 2.4;
    const level: MechanicsGeometry = { kind: "path", points: [{ x: x - 0.8, y }, { x: x + 0.8, y }], mechanics: mark("level", { x: 0, y: state.height }, "m", heightScale) };
    const point: MechanicsGeometry = { kind: "point", point: { x, y }, mechanics: mark("state", { x: state.speed!, y: 0 }, "m/s", speedScale) };
    const velocity = directed({ x, y }, { x: state.speed!, y: 0 }, speedScale, mark("speed", { x: state.speed!, y: 0 }, "m/s", speedScale), { x: 0, y: 0.2 });
    return [level, point, velocity];
  });
}

export function evaluateMechanicsDiagramConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): MechanicsGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported mechanics operator ${operator}`);
  if (operator === "free_body") return readFreeBody(inputs, context, document);
  if (operator === "coupled_bodies") return readCoupled(inputs, context, document);
  if (operator === "vertical_circle") return readCircle(inputs, context, document);
  return readEnergy(inputs, context, document);
}

const OUTPUT_COUNTS = { free_body: -1, coupled_bodies: 6, vertical_circle: 5, mechanical_energy_pair: 6 } as const;

function allowed(metadata: MechanicsMark): string[] {
  const symbol = metadata.role === "weight" ? "mg" : metadata.role === "constraint" ? "T" : metadata.role === "speed" ? "v" : metadata.role;
  return [symbol, `${symbol}=${compactNumber(metadata.magnitude)} ${metadata.unit}`];
}

export function mechanicsOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  if (!isOperator(operator)) invalid("operator", "unsupported mechanics operator");
  return outputs.map((output, index) => {
    if (!isRecord(output) || !isRecord(output.mechanics)) invalid("outputs", "mechanics geometry is missing source metadata");
    const metadata = output.mechanics as unknown as MechanicsMark;
    const requestedText = requested?.[index];
    if (requestedText !== undefined && !allowed(metadata).includes(String(requestedText))) invalid("label", "mechanics labels must be the role symbol or the verified value");
    return requestedText === allowed(metadata)[1] ? allowed(metadata)[1]! : allowed(metadata)[0]!;
  });
}

export function validateMechanicsDiagramConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  if (!isOperator(operator)) return;
  const add = (key: string, message: string): void => {
    issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].inputs.${key}` });
  };
  if (!isRecord(construction.inputs)) { add("inputs", "inputs must be an object"); return; }
  const expected = operator === "free_body" && Array.isArray(construction.inputs.forces) ? construction.inputs.forces.length + 1 : OUTPUT_COUNTS[operator];
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (expected > 0 && (outputs.length !== expected || new Set(outputs).size !== outputs.length)) {
    issues.push({ code: `invalid_${operator}_outputs`, severity: "fatal", message: `${operator} requires ${expected} distinct outputs`, path: `constructions[${index}].outputs` });
  }
  const context: SourceContext = {
    number: (value) => validationNumber(value, document),
    point: (value) => {
      if (typeof value !== "string") return placement(value, "origin", context);
      const producer = constructionByOutput.get(value);
      if (producer?.operator !== "point") invalid("origin", "placement must reference a point construction");
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry: () => undefined,
  };
  try {
    evaluateMechanicsDiagramConstruction(operator, construction.inputs, context, document);
  } catch (error) {
    add(error instanceof SourceInputError ? error.key : "inputs", error instanceof Error ? error.message : "mechanics inputs are invalid");
  }
}
