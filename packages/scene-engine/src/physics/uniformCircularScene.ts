/**
 * Uniform circular motion figure from the source authority.
 *
 * A stated rotation sense draws the full certified state through the
 * rotational kernel: the signed tangent velocity and the inward acceleration
 * are recomputed from source r and ω and their labels are checked against
 * that computation. Without a stated sense the figure still shows the inward
 * acceleration, but the velocity is an undirected tangent, so the board never
 * implies a direction the question did not give. Symbolic sources (R, v, θ)
 * draw a qualitative polar relation with symbolic labels and no numbers.
 *
 * The drawn radius is a display length: physical r, v and a stay in labels.
 */
import { SceneBuilder } from "../archetypes/document";
import { evaluateRotationConstruction } from "../compile/rotationGeometry";
import type { SceneDocument } from "../types";
import type { UniformCircularNumeric, UniformCircularSymbolic } from "./uniformCircularSource";

export const UNIFORM_CIRCULAR_ARCHETYPE = "uniform_circular_motion_source";

const DISPLAY_RADIUS = 2.4;
const VELOCITY_LENGTH = 1.4;
const ACCELERATION_LENGTH = 1.1;
/** Display position when the source states none: the top of the circle. */
const DEFAULT_BODY_ANGLE = Math.PI / 2;
/** The labelled radius is drawn 120° clockwise of the body, clear of its arrows. */
const RADIUS_MARK_OFFSET = -2 * Math.PI / 3;
const SYMBOLIC_ANGLE = 50 * Math.PI / 180;

/** Same compact form the rotational kernel accepts for a verified label. */
function claim(symbol: string, value: number, unit: string): string {
  return `${symbol}=${Number(value.toPrecision(4))} ${unit}`;
}

function onCircle(angle: number): { x: number; y: number } {
  return { x: DISPLAY_RADIUS * Math.cos(angle), y: DISPLAY_RADIUS * Math.sin(angle) };
}

function radiusLabel(source: UniformCircularNumeric): string {
  return claim("r", source.radius, source.radiusUnit);
}

function numericDocument(scene: SceneBuilder): SceneDocument {
  const document = scene.build();
  // All numeric state values are recomputed from the bound source; the shared
  // save audit regenerates them instead of trusting this submitted metadata.
  document.source.slotSources = Object.fromEntries(document.quantities.map(({ id }) => [id, "stem"]));
  return document;
}

export function uniformCircularNumericDocument(question: string, source: UniformCircularNumeric): SceneDocument {
  const directed = source.signedAngularVelocity !== null;
  const bodyAngle = source.phase ?? DEFAULT_BODY_ANGLE;
  const bodyLabel = source.positionName ?? "P";
  const scene = new SceneBuilder(
    question,
    directed
      ? `body in uniform circular motion, moving ${source.sense}, with its tangent velocity and inward acceleration recomputed from the source radius and rate`
      : "body in uniform circular motion with its inward acceleration; the source states no direction of travel, so the velocity is shown only as the tangent line",
    UNIFORM_CIRCULAR_ARCHETYPE,
  );
  // Preserve the source solver's precision through compilation and admission.
  // Rounding belongs in the display labels, never in numeric authority.
  scene.quantities.push(
    { id: "r", symbol: "r", value: source.radius, unit: source.radiusUnit },
    { id: "v", symbol: "v", value: source.speed, unit: "m/s" },
    { id: "omega", symbol: "omega", value: source.angularSpeed, unit: "rad/s" },
    { id: "a_c", symbol: "a_c", value: source.centripetalAcceleration, unit: "m/s^2" },
  );
  scene.point("O", { x: 0, y: 0 }, "centre", "O");
  scene.circle("path", "O", DISPLAY_RADIUS, "circular path");
  scene.helper("Q", onCircle(bodyAngle + RADIUS_MARK_OFFSET), "radius mark end");
  scene.segment("radius", "O", "Q", "radius", radiusLabel(source));
  scene.assert("radius_end_on_path", "on", ["Q", "path"]);

  if (directed) {
    const inputs = {
      radius: "r",
      angle: bodyAngle,
      angleUnit: "rad",
      angularVelocity: source.signedAngularVelocity!,
      angularAcceleration: 0,
      units: { length: source.radiusUnit, time: "s" },
      angularVelocityUnit: "rad/s",
      angularAccelerationUnit: "rad/s^2",
      origin: [0, 0],
      displayScale: DISPLAY_RADIUS / source.radius,
    };
    // Evaluate once here so the labels quote the kernel's own SI values and
    // cross-check them against the independent source authority.
    const numberOf = (value: unknown): number => (value === "r" ? source.radius : Number(value));
    const motion = evaluateRotationConstruction("rotational_motion", inputs, { number: numberOf, point: () => ({ x: 0, y: 0 }), geometry: () => null })[0]!;
    const context = { number: numberOf, point: () => ({ x: 0, y: 0 }), geometry: () => motion };
    const velocity = evaluateRotationConstruction("rotational_state", { motion: "body", kind: "velocity", displayLength: VELOCITY_LENGTH }, context)[0]!;
    const acceleration = evaluateRotationConstruction("rotational_state", { motion: "body", kind: "acceleration", displayLength: ACCELERATION_LENGTH }, context)[0]!;
    if (!("rotationalVector" in velocity) || !("rotationalVector" in acceleration)) throw new Error("uniform circular state must keep its vectors");
    const speed = velocity.rotationalVector.magnitudeSI;
    const inward = acceleration.rotationalVector.magnitudeSI;
    if (Math.abs(speed - source.speed) > 1e-9 * source.speed || Math.abs(inward - source.centripetalAcceleration) > 1e-9 * source.centripetalAcceleration) {
      throw new Error("kernel state disagrees with the source authority");
    }
    scene.entities.push(
      { id: "body", kind: "point", role: "body in uniform circular motion", label: bodyLabel },
      { id: "velocity", kind: "vector", role: "tangential velocity", label: claim("v", speed, "m/s") },
      { id: "accel", kind: "vector", role: "centripetal acceleration", label: claim("a", inward, "m/s^2") },
    );
    scene.constructions.push(
      { id: "make_body", operator: "rotational_motion", inputs, outputs: ["body"] },
      { id: "make_velocity", operator: "rotational_state", inputs: { motion: "body", kind: "velocity", displayLength: VELOCITY_LENGTH }, outputs: ["velocity"] },
      { id: "make_accel", operator: "rotational_state", inputs: { motion: "body", kind: "acceleration", displayLength: ACCELERATION_LENGTH }, outputs: ["accel"] },
    );
    scene.assert("body_on_path", "on", ["body", "path"]);
    scene.assert("velocity_perpendicular_to_acceleration", "perpendicular", ["velocity", "accel"]);
    scene.labelled("body", "velocity", "accel");
    scene.group("setup", ["O", "path", "radius"], "the circular path, its centre and the radius");
    scene.group("motion", ["body", "velocity"], `the body and its velocity along the tangent, moving ${source.sense}`, ["setup"]);
    scene.group("acceleration", ["accel"], "the acceleration pointing to the centre", ["motion"]);
    return numericDocument(scene);
  }

  const body = onCircle(bodyAngle);
  const tangent = { x: -Math.sin(bodyAngle), y: Math.cos(bodyAngle) };
  scene.point("P", body, "body in uniform circular motion", bodyLabel);
  scene.helper("T1", { x: body.x - tangent.x * VELOCITY_LENGTH * 0.75, y: body.y - tangent.y * VELOCITY_LENGTH * 0.75 }, "tangent end");
  scene.helper("T2", { x: body.x + tangent.x * VELOCITY_LENGTH * 0.75, y: body.y + tangent.y * VELOCITY_LENGTH * 0.75 }, "tangent end");
  scene.segment("tangent", "T1", "T2", "velocity direction line (sense not stated)", claim("v", source.speed, "m/s"));
  scene.vector("accel", "P", { direction: { x: -Math.cos(bodyAngle), y: -Math.sin(bodyAngle) }, length: ACCELERATION_LENGTH }, "centripetal acceleration", claim("a", source.centripetalAcceleration, "m/s^2"));
  scene.assert("body_on_path", "on", ["P", "path"]);
  scene.assert("tangent_through_body", "on", ["P", "tangent"]);
  scene.assert("tangent_perpendicular_to_acceleration", "perpendicular", ["tangent", "accel"]);
  scene.labelled("tangent", "accel");
  scene.group("setup", ["O", "path", "radius"], "the circular path, its centre and the radius");
  scene.group("motion", ["P", "tangent"], "the body and the tangent line its velocity lies along", ["setup"]);
  scene.group("acceleration", ["accel"], "the acceleration pointing to the centre", ["motion"]);
  return numericDocument(scene);
}

export function uniformCircularSymbolicDocument(question: string, source: UniformCircularSymbolic): SceneDocument {
  const radiusText = source.radiusText ? `r = ${source.radiusText}` : source.radiusSymbol ?? "r";
  const speedText = source.speedSymbol ?? "v";
  const radiusSymbol = source.radiusSymbol ?? "r";
  const scene = new SceneBuilder(
    question,
    "qualitative uniform circular motion: radius, tangent velocity line and inward acceleration with the source's own symbols; no numeric state is assumed",
    UNIFORM_CIRCULAR_ARCHETYPE,
  );
  const body = onCircle(SYMBOLIC_ANGLE);
  scene.point("O", { x: 0, y: 0 }, "centre", "O");
  scene.circle("path", "O", DISPLAY_RADIUS, "circular path");
  scene.point("P", body, "particle on the path", "P");
  scene.segment("radius", "O", "P", "radius", radiusText);
  if (source.angleSymbol) {
    scene.helper("X", { x: DISPLAY_RADIUS + 0.9, y: 0 }, "positive x direction");
    scene.segment("x_axis", "O", "X", "positive x-axis reference", "x");
    scene.angleMark("theta", "O", "X", "P", source.angleSymbol, 0.7);
  }
  const tangent = { x: -Math.sin(SYMBOLIC_ANGLE), y: Math.cos(SYMBOLIC_ANGLE) };
  if (source.sense) {
    const sign = source.sense === "anticlockwise" ? 1 : -1;
    scene.vector("velocity", "P", { direction: { x: sign * tangent.x, y: sign * tangent.y }, length: VELOCITY_LENGTH }, "tangential velocity", speedText);
  } else {
    scene.helper("T1", { x: body.x - tangent.x * VELOCITY_LENGTH * 0.75, y: body.y - tangent.y * VELOCITY_LENGTH * 0.75 }, "tangent end");
    scene.helper("T2", { x: body.x + tangent.x * VELOCITY_LENGTH * 0.75, y: body.y + tangent.y * VELOCITY_LENGTH * 0.75 }, "tangent end");
    scene.segment("velocity", "T1", "T2", "velocity direction line (sense not stated)", speedText);
  }
  const inward = { x: -Math.cos(SYMBOLIC_ANGLE), y: -Math.sin(SYMBOLIC_ANGLE) };
  scene.vector("accel", "P", { direction: inward, length: ACCELERATION_LENGTH }, "centripetal acceleration", `a = ${speedText}²/${radiusSymbol}`);
  scene.assert("body_on_path", "on", ["P", "path"]);
  scene.assert("velocity_perpendicular_to_radius", "perpendicular", ["velocity", "radius"]);
  scene.assert("acceleration_along_radius", "parallel", ["accel", "radius"]);
  scene.labelled("radius", "accel");
  scene.group("setup", ["O", "path", "P", "radius", ...(source.angleSymbol ? ["x_axis", "theta"] : [])], "the circular path, the particle and its radius");
  scene.group("motion", ["velocity"], "the velocity along the tangent", ["setup"]);
  scene.group("acceleration", ["accel"], "the acceleration pointing to the centre", ["motion"]);
  return scene.build();
}
