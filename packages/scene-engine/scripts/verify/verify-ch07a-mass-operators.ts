import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import {
  RigidMassInputError,
  evaluateRigidMassConstruction,
  rigidMassEntityKind,
  validateRigidMassConstruction,
  type RigidMassEvaluationContext,
  type RigidMassGeometry,
  type RigidMassRecord,
} from "../../src/compile/rigidMassGeometry";

/**
 * CH-07a gate. Closed forms below are the independent oracle.
 * The implementation integrates; it does not import these expressions.
 */
const rodCentreI = (mass: number, length: number) => mass * length * length / 12;
const rodEndI = (mass: number, length: number) => mass * length * length / 3;
const ringPerpI = (mass: number, radius: number) => mass * radius * radius;
const ringDiameterI = (mass: number, radius: number) => mass * radius * radius / 2;
const discPerpI = (mass: number, radius: number) => mass * radius * radius / 2;
const discDiameterI = (mass: number, radius: number) => mass * radius * radius / 4;
const cylinderSymmetryI = (mass: number, radius: number) => mass * radius * radius / 2;
const cylinderDiameterI = (mass: number, radius: number, height: number) => mass * (radius * radius / 4 + height * height / 12);
const solidSphereI = (mass: number, radius: number) => (2 / 5) * mass * radius * radius;
const thinShellI = (mass: number, radius: number) => (2 / 3) * mass * radius * radius;

const quantities = new Map<string, number>([["disc_mass", 2.2], ["rod_mass", 3.7]]);
const context: RigidMassEvaluationContext = {
  number(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("not finite");
      return value;
    }
    if (typeof value === "string" && quantities.has(value)) return quantities.get(value)!;
    const parsed = typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) throw new Error("not finite");
    return parsed;
  },
  point(value) {
    if (value === "origin_point") return { x: 0, y: 0 };
    throw new Error("not a point");
  },
  geometry(value) {
    if (value === "projected") return { space: { x: 1, y: 2, z: 9 }, spaceFrameId: "frame" };
    return undefined;
  },
};

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string): void {
  const absolute = Math.abs(actual - expected);
  const relative = absolute / Math.max(Math.abs(expected), 1e-12);
  check(Math.abs(expected) < 1e-8 ? absolute <= 1e-4 : relative <= 1e-4, `${message}: ${actual} vs ${expected} (rel ${relative})`);
}
function run(operator: string, inputs: Record<string, unknown>): RigidMassGeometry[] {
  return evaluateRigidMassConstruction(operator, inputs, context);
}
function meta(geometry: RigidMassGeometry): RigidMassRecord {
  return geometry.rigidMass;
}
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void {
  let threw = false;
  try {
    evaluateRigidMassConstruction(operator, inputs, context);
  } catch (error) {
    threw = error instanceof RigidMassInputError;
  }
  check(threw, message);
}
function pathLength(geometry: RigidMassGeometry): number {
  check(geometry.kind === "path" && geometry.points.length >= 2, "expected a drawn path");
  if (geometry.kind !== "path") return 0;
  const start = geometry.points[0]!;
  const end = geometry.points[geometry.points.length - 1]!;
  return Math.hypot(end.x - start.x, end.y - start.y);
}

const display = { displayLength: 1.5 };
const zAxis = { x: 0, y: 0, z: 1 };

// First example: two unequal point masses. Later composites are not this case.
const pair = run("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [
    { kind: "point", mass: 2, at: { x: 0, y: 0 } },
    { kind: "point", mass: 5, at: { x: 3, y: 1 } },
  ],
});
check(pair.length === 3, "two masses and their centre");
check(pair[0]!.kind === "point" && pair[1]!.kind === "point" && pair[2]!.kind === "point", "point masses and the centre are points");
check(pair[2]!.kind === "point" && pair[2]!.point.x === meta(pair[2]!).centre!.x, "the centre mark sits on the computed centre");
close(meta(pair[2]!).centre!.x, 15 / 7, "unequal point-mass centre x");
close(meta(pair[2]!).centre!.y, 5 / 7, "unequal point-mass centre y");
check(meta(pair[2]!).mass === 7, "total mass is the weighted sum");
check(meta(pair[2]!).reduction === "weighted_sum", "point masses use a weighted sum");
check(meta(pair[2]!).mark === "centre", "the last mark is the centre of mass");
const shiftedOrigin = run("centre_of_mass", {
  ...display,
  axis: { origin: { x: 1, y: -2 } },
  parts: [
    { kind: "point", mass: 2, at: { x: 0, y: 0 } },
    { kind: "point", mass: 5, at: { x: 3, y: 1 } },
  ],
});
check(shiftedOrigin[2]!.kind === "point" && pair[2]!.kind === "point", "source-axis change keeps a centre point");
if (shiftedOrigin[2]!.kind === "point" && pair[2]!.kind === "point") {
  check(shiftedOrigin[2]!.point.x === pair[2]!.point.x && shiftedOrigin[2]!.point.y === pair[2]!.point.y, "the world centre does not move when the source origin changes");
}
close(meta(shiftedOrigin[2]!).centreRelative!.x, 15 / 7 - 1, "centre relative to the source axis x");
close(meta(shiftedOrigin[2]!).centreRelative!.y, 5 / 7 + 2, "centre relative to the source axis y");

// Independent midpoint rule for a uniform rod, not Simpson and not "return the centre".
function midpointRodCentre(center: RenderPoint, length: number, angle: number, intervals: number): RenderPoint {
  const step = length / intervals;
  const density = 1 / length;
  const along = Math.cos(angle);
  const across = Math.sin(angle);
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (let index = 0; index < intervals; index += 1) {
    const t = -length / 2 + (index + 0.5) * step;
    const dm = density * step;
    mass += dm;
    mx += (center.x + t * along) * dm;
    my += (center.y + t * across) * dm;
  }
  return { x: mx / mass, y: my / mass };
}
const rodCentre = { x: 5, y: 3 };
const rodAngle = 0.77;
const rodLength = 4;
const rodBody = run("centre_of_mass", {
  displayLength: 2,
  axis: { origin: { x: 0, y: 0 } },
  parts: [{ kind: "uniform_rod", mass: 4, length: rodLength, center: rodCentre, angle: rodAngle }],
});
check(rodBody[0]!.kind === "path", "a rod is a path");
close(pathLength(rodBody[0]!), rodLength, "rod path uses its length, not displayLength");
check(meta(rodBody[0]!).reduction === "mass_integral", "a uniform rod centre comes from a mass integral");
const rodOracle = midpointRodCentre(rodCentre, rodLength, rodAngle, 400);
close(meta(rodBody[1]!).centre!.x, rodOracle.x, "rod centre matches an independent midpoint integral x");
close(meta(rodBody[1]!).centre!.y, rodOracle.y, "rod centre matches an independent midpoint integral y");
close(meta(rodBody[1]!).centre!.x, rodCentre.x, "uniform rod centre is the geometric centre x");
close(meta(rodBody[1]!).centre!.y, rodCentre.y, "uniform rod centre is the geometric centre y");

function midpointDiscCentre(center: RenderPoint, radius: number, radial: number, angular: number): RenderPoint {
  const hr = radius / radial;
  const ht = (2 * Math.PI) / angular;
  const sigma = 1 / (Math.PI * radius * radius);
  let mass = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < radial; i += 1) {
    const r = (i + 0.5) * hr;
    for (let j = 0; j < angular; j += 1) {
      const theta = (j + 0.5) * ht;
      const dm = sigma * r * hr * ht;
      mass += dm;
      mx += (center.x + r * Math.cos(theta)) * dm;
      my += (center.y + r * Math.sin(theta)) * dm;
    }
  }
  return { x: mx / mass, y: my / mass };
}
const discCenter = { x: 2, y: -4 };
const discRadius = 1.35;
const discCom = run("centre_of_mass", {
  displayLength: 9,
  axis: { origin: { x: -3, y: 1 } },
  parts: [{ kind: "disc", mass: 2.2, radius: discRadius, center: discCenter }],
});
check(discCom[0]!.kind === "circle", "a disc outline is a circle");
if (discCom[0]!.kind === "circle") check(discCom[0]!.radius === discRadius, "displayLength does not resize the disc");
const discOracle = midpointDiscCentre(discCenter, discRadius, 80, 160);
close(meta(discCom[1]!).centre!.x, discOracle.x, "disc centre matches an independent polar midpoint integral x");
close(meta(discCom[1]!).centre!.y, discOracle.y, "disc centre matches an independent polar midpoint integral y");
close(meta(discCom[1]!).centre!.x, discCenter.x, "uniform disc centre x");
close(meta(discCom[1]!).centre!.y, discCenter.y, "uniform disc centre y");

const lightRod = { kind: "uniform_rod" as const, mass: 1, length: 2, center: { x: 1, y: 0 }, angle: 0 };
const heavyRod = { kind: "uniform_rod" as const, mass: 3, length: 2, center: { x: 3, y: 0 }, angle: 0 };
const rodComposite = run("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [lightRod, heavyRod],
});
close(meta(rodComposite[2]!).centre!.x, 2.5, "composite rod centre is mass-weighted");
check(Math.abs(meta(rodComposite[2]!).centre!.x - 2) > 0.1, "composite rod centre is not the span midpoint");

const plainDisc = run("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [{ kind: "disc", mass: 8, radius: 2, center: { x: 0, y: 0 } }],
});
const punched = run("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [
    { kind: "disc", mass: 8, radius: 2, center: { x: 0, y: 0 } },
    { kind: "disc", mass: -2, radius: 0.4, center: { x: 0.5, y: 0 }, hole: true },
  ],
});
check(meta(punched[2]!).mass === 6, "a hole subtracts mass");
check(meta(punched[2]!).mass < meta(plainDisc[1]!).mass, "a punched body is lighter than the solid disc");
check(meta(punched[2]!).holeMass === -2, "hole mass is negative");
check(meta(punched[1]!).mark === "hole", "the hole is marked as a hole rather than an added body");
close(meta(punched[2]!).centre!.x, -1 / 6, "an offset hole shifts the centre");
rejects("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [
    { kind: "disc", mass: 8, radius: 2, center: { x: 0, y: 0 } },
    { kind: "disc", mass: -8, radius: 0.4, center: { x: 0.2, y: 0 }, hole: true },
  ],
}, "a hole that cancels the remaining mass rejects");
rejects("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [
    { kind: "disc", mass: 8, radius: 2, center: { x: 0, y: 0 } },
    { kind: "disc", mass: -9, radius: 0.4, center: { x: 0.2, y: 0 }, hole: true },
  ],
}, "a hole larger than the remaining mass rejects");
rejects("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [{ kind: "disc", mass: -2, radius: 0.4, center: { x: 0, y: 0 }, hole: true }],
}, "a hole with no remaining body rejects");
rejects("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [{ kind: "point", mass: -1, at: { x: 1, y: 0 } }],
}, "negative mass without an explicit hole rejects");
rejects("centre_of_mass", {
  ...display,
  axis: { origin: { x: 0, y: 0 } },
  parts: [{ kind: "disc", mass: 2, radius: 1, center: { x: 0, y: 0 }, hole: true }],
}, "a hole with positive mass would add a body and rejects");
rejects("centre_of_mass", { ...display, axis: { origin: { x: 0, y: 0 } }, parts: [], rolling: true }, "unknown centre-of-mass keys reject");
rejects("centre_of_mass", { ...display, parts: [{ kind: "point", mass: 1, at: { x: 0, y: 0 } }] }, "a missing source axis rejects");

const motionMass = 3.5;
const motionCom = { x: 1, y: 2 };
const motionBase = {
  mass: motionMass,
  com: motionCom,
  externalForces: [{ id: "push", fx: 7, fy: -3.5 }],
  internalPairs: [{ id: "spring", members: [{ id: "a", fx: 4, fy: 1 }, { id: "b", fx: -4, fy: -1 }] }],
};
const motion = run("com_motion", { ...motionBase, displayLength: 2.5 })[0]!;
check(motion.kind === "path" && motion.directed === true, "nonzero centre acceleration is a directed path");
check(meta(motion).acceleration!.x === 2 && meta(motion).acceleration!.y === -1, "M a_com equals the external force sum");
check(meta(motion).examScope.main === "application" && meta(motion).examScope.advanced === "listed" && meta(motion).examScope.neet === "application", "centre-of-mass motion keeps the Main/Advanced/NEET tag");
check(Math.abs(pathLength(motion) - 2.5) < 1e-9, "displayLength scales only the acceleration marker");
if (motion.kind === "path") {
  check(motion.points[0]!.x === motionCom.x && motion.points[0]!.y === motionCom.y, "acceleration is drawn from the centre");
  check(motion.points[1]!.x > motion.points[0]!.x && motion.points[1]!.y < motion.points[0]!.y, "the marker follows the acceleration direction");
}
const longerMarker = run("com_motion", { ...motionBase, displayLength: 6 })[0]!;
check(meta(longerMarker).acceleration!.x === meta(motion).acceleration!.x && meta(longerMarker).acceleration!.y === meta(motion).acceleration!.y, "displayLength does not change a_com");
check(Math.abs(pathLength(longerMarker) - 6) < 1e-9, "a longer marker stays on the same acceleration");
const isolated = run("com_motion", {
  mass: 4,
  com: motionCom,
  displayLength: 2,
  externalForces: [],
  internalPairs: [{ id: "pair", members: [{ id: "left", fx: 5, fy: -2 }, { id: "right", fx: -5, fy: 2 }] }],
})[0]!;
check(isolated.kind === "point", "an isolated internal pair draws a point, not an invented direction");
check(meta(isolated).acceleration!.x === 0 && meta(isolated).acceleration!.y === 0, "internal forces do not accelerate an isolated centre");
const cancelledExternal = run("com_motion", {
  mass: 2,
  com: { x: 0, y: 0 },
  displayLength: 1,
  externalForces: [{ id: "east", fx: 4, fy: 0 }, { id: "west", fx: -4, fy: 0 }],
  internalPairs: [],
})[0]!;
check(cancelledExternal.kind === "point" && meta(cancelledExternal).acceleration!.x === 0, "opposite external forces can sum to zero without being relabelled internal");
rejects("com_motion", {
  ...motionBase,
  displayLength: 1,
  externalForces: [{ id: "a", fx: 4, fy: 1, internal: true }],
}, "a force marked internal cannot be added to the external sum");
rejects("com_motion", {
  ...motionBase,
  displayLength: 1,
  externalForces: [{ id: "a", fx: 4, fy: 1 }, { id: "push", fx: 7, fy: -3.5 }],
}, "an internal member id repeated in the external list rejects");
rejects("com_motion", {
  mass: 2,
  com: motionCom,
  displayLength: 1,
  externalForces: [],
  internalPairs: [{ id: "bad", members: [{ id: "p", fx: 3, fy: 0 }, { id: "q", fx: -1, fy: 0 }] }],
}, "an internal pair that does not cancel rejects");
rejects("com_motion", { ...motionBase, displayLength: 0 }, "a non-positive acceleration marker rejects");
rejects("com_motion", { ...motionBase, mass: 0, displayLength: 1 }, "zero mass rejects");
rejects("com_motion", { ...motionBase, displayLength: 1, friction: true }, "unknown motion keys reject");

const pointMasses = [
  { mass: 1.5, at: { x: 1, y: 0 } },
  { mass: 2.5, at: { x: 0, y: 2 } },
];
const pointInertia = run("point_mass_inertia", {
  ...display,
  masses: pointMasses,
  axis: { through: { x: 0, y: 0 }, orientation: "perpendicular_to_plane" },
})[0]!;
check(pointInertia.kind === "point", "a point mass is a point");
check(meta(pointInertia).inertia === 11.5, "point-mass inertia is the sum of m r^2");
check(meta(pointInertia).kSquared === 11.5 / 4, "k^2 = I/M");
check(Math.abs(meta(pointInertia).radiusOfGyration! - 2) > 1e-6, "radius of gyration is not the outer radius");
const movedAxis = run("point_mass_inertia", {
  ...display,
  masses: pointMasses,
  axis: { through: { x: 1, y: 0 }, orientation: "perpendicular_to_plane" },
})[0]!;
check(meta(movedAxis).inertia === 12.5, "moving the axis changes I");
check(meta(movedAxis).inertia !== meta(pointInertia).inertia, "the moved axis is not the original inertia");
const flipped = run("point_mass_inertia", {
  ...display,
  masses: [{ mass: -1.5, at: { x: 1, y: 0 }, hole: true }, { mass: 2.5, at: { x: 0, y: 2 } }],
  axis: { through: { x: 0, y: 0 }, orientation: "perpendicular_to_plane" },
})[0]!;
check(meta(flipped).inertia === 8.5, "flipping a mass sign to an explicit hole changes I");
check(meta(flipped).inertia !== meta(pointInertia).inertia, "the sign flip does not leave I unchanged");
check(meta(flipped).mass === 1, "the hole reduces the point-mass total");
rejects("point_mass_inertia", {
  ...display,
  masses: [{ mass: -1.5, at: { x: 1, y: 0 } }, { mass: 2.5, at: { x: 0, y: 2 } }],
  axis: { through: { x: 0, y: 0 }, orientation: "perpendicular_to_plane" },
}, "a negative point mass without a hole rejects");
rejects("point_mass_inertia", { ...display, masses: pointMasses }, "a missing inertia axis rejects");
rejects("point_mass_inertia", {
  ...display,
  masses: pointMasses,
  axis: { through: { x: 0, y: 0 }, orientation: "diameter" },
}, "an unspecified point-mass axis orientation rejects");
rejects("point_mass_inertia", {
  ...display,
  masses: [{ mass: 1, at: "projected" }],
  axis: { through: { x: 0, y: 0 }, orientation: "perpendicular_to_plane" },
}, "a projected 3D point is not a planar mass position");

function simple(inputs: Record<string, unknown>): RigidMassGeometry {
  const [geometry] = run("simple_body_inertia", inputs);
  check(geometry, "simple body returns a mark");
  return geometry!;
}
const awkwardRod = { mass: 3.7, length: 2.5, center: { x: 4.2, y: -1.3 }, angle: 0.77, displayLength: 4 };
const centreRod = simple({
  kind: "uniform_rod",
  ...awkwardRod,
  axis: { orientation: "perpendicular_to_length", place: "centre" },
});
close(meta(centreRod).inertia!, rodCentreI(3.7, 2.5), "rod about its centre");
check(centreRod.kind === "path", "rod inertia still draws a path");
close(pathLength(centreRod), 2.5, "rod length is the metric length");
const endRod = simple({
  kind: "uniform_rod",
  ...awkwardRod,
  axis: { orientation: "perpendicular_to_length", place: "end", end: "negative" },
});
close(meta(endRod).inertia!, rodEndI(3.7, 2.5), "rod about an end");
const otherEnd = simple({
  kind: "uniform_rod",
  ...awkwardRod,
  axis: { orientation: "perpendicular_to_length", place: "end", end: "positive" },
});
close(meta(otherEnd).inertia!, meta(endRod).inertia!, "either end of a uniform rod has the same inertia");
const secondRod = simple({
  kind: "uniform_rod",
  mass: 1.1,
  length: 7.3,
  center: { x: -2, y: 0.4 },
  angle: -0.3,
  displayLength: 1,
  axis: { orientation: "perpendicular_to_length", place: "centre" },
});
close(meta(secondRod).inertia!, rodCentreI(1.1, 7.3), "a second rod length is not a special-cased constant");

const ring = { mass: 0.8, radius: 2.4, center: { x: 1, y: -2 }, displayLength: 3 };
const ringPerp = simple({ kind: "thin_ring", ...ring, axis: { orientation: "perpendicular_to_plane", place: "centre" } });
const ringDiameter = simple({ kind: "thin_ring", ...ring, axis: { orientation: "diameter", place: "centre" } });
close(meta(ringPerp).inertia!, ringPerpI(0.8, 2.4), "thin ring about the centre perpendicular to its plane");
close(meta(ringDiameter).inertia!, ringDiameterI(0.8, 2.4), "thin ring about a diameter");
check(ringPerp.kind === "circle" && ringPerp.radius === 2.4, "a ring outline uses its radius");
const hoop = simple({
  kind: "hoop",
  mass: 1.25,
  radius: 0.6,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
});
close(meta(hoop).inertia!, ringPerpI(1.25, 0.6), "an explicit hoop is a thin ring");
check(meta(hoop).requestedKind === "hoop" && meta(hoop).bodyKind === "thin_ring", "hoop stays an explicit thin ring");

const disc = { mass: 2.2, radius: 1.35, center: discCenter, displayLength: 0.4 };
const discPerp = simple({ kind: "disc", ...disc, axis: { orientation: "perpendicular_to_plane", place: "centre" } });
const discDiameter = simple({ kind: "disc", ...disc, displayLength: 8, axis: { orientation: "diameter", place: "centre" } });
close(meta(discPerp).inertia!, discPerpI(2.2, 1.35), "disc about the centre perpendicular to its plane");
close(meta(discDiameter).inertia!, discDiameterI(2.2, 1.35), "disc about a diameter");
check(Number.isFinite(meta(discPerp).inertia) && Number.isFinite(meta(discDiameter).inertia), "disc moments are finite");
check(meta(discPerp).kSquared === meta(discPerp).inertia! / meta(discPerp).mass, "disc k^2 = I/M");
check(Math.abs(meta(discPerp).radiusOfGyration! - 1.35) / 1.35 > 1e-3, "disc radius of gyration is not the outer radius");
check(meta(discPerp).inertia === simple({ kind: "disc", ...disc, displayLength: 8, axis: { orientation: "perpendicular_to_plane", place: "centre" } }).rigidMass.inertia, "displayLength does not change I");
check(discPerp.kind === "circle" && discDiameter.kind === "circle" && discPerp.radius === discDiameter.radius, "displayLength does not change the disc radius");
check(meta(discPerp).quadrature?.method === "composite_simpson" && meta(discPerp).quadrature.step > 0 && meta(discPerp).quadrature.tolerance > 0 && meta(discPerp).quadrature.tolerance <= 1e-4, "quadrature declares its step and tolerance");
check(meta(discPerp).quadrature.intervals % 2 === 0, "Simpson intervals are even");
const secondDisc = simple({
  kind: "disc",
  mass: 0.4,
  radius: 3.1,
  center: { x: -1, y: 0.5 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
});
close(meta(secondDisc).inertia!, discPerpI(0.4, 3.1), "a second disc radius is not a special-cased constant");

const cylinder = { mass: 1.7, radius: 0.75, height: 2.2, center: { x: 1, y: 2 }, displayLength: 9 };
const cylinderSymmetry = simple({ kind: "solid_cylinder", ...cylinder, axis: { orientation: "symmetry", place: "centre" } });
const cylinderDiameter = simple({ kind: "solid_cylinder", ...cylinder, axis: { orientation: "diameter", place: "centre" } });
close(meta(cylinderSymmetry).inertia!, cylinderSymmetryI(1.7, 0.75), "solid cylinder about its symmetry axis");
close(meta(cylinderDiameter).inertia!, cylinderDiameterI(1.7, 0.75, 2.2), "solid cylinder about a diameter");
check(cylinderSymmetry.kind === "multi_path", "a cylinder is a projected rectangle plus a circular end");
if (cylinderSymmetry.kind === "multi_path") {
  const side = cylinderSymmetry.paths[0]!;
  const ys = side.map((point) => point.y);
  const xs = side.map((point) => point.x);
  close(Math.max(...ys) - Math.min(...ys), 2.2, "cylinder height is the declared height");
  close(Math.max(...xs) - Math.min(...xs), 1.5, "cylinder width is the diameter");
  const cap = cylinderSymmetry.paths[1]![0]!;
  close(Math.hypot(cap.x - 1, cap.y - (2 + 1.1)), 0.75, "the cylinder end cap uses the body radius");
}
close(meta(cylinderSymmetry).centre!.x, 1, "cylinder centre x");
close(meta(cylinderSymmetry).centre!.y, 2, "cylinder centre y");
const secondCylinder = simple({
  kind: "solid_cylinder",
  mass: 0.9,
  radius: 1.2,
  height: 0.5,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "diameter", place: "centre" },
});
close(meta(secondCylinder).inertia!, cylinderDiameterI(0.9, 1.2, 0.5), "a second cylinder is integrated, not a stored constant");

const sphere = { mass: 4.4, radius: 1.1, center: { x: 0.3, y: -0.2 }, displayLength: 2 };
const solid = simple({ kind: "solid_sphere", ...sphere, axis: { orientation: "diameter", place: "centre" } });
const shell = simple({ kind: "thin_spherical_shell", ...sphere, axis: { orientation: "diameter", place: "centre" } });
close(meta(solid).inertia!, solidSphereI(4.4, 1.1), "solid sphere about a diameter");
close(meta(shell).inertia!, thinShellI(4.4, 1.1), "thin spherical shell about a diameter");
check(meta(solid).bodyKind === "solid_sphere" && meta(shell).bodyKind === "thin_spherical_shell", "sphere and shell keep distinct kinds");
check(Math.abs(meta(solid).inertia! - thinShellI(4.4, 1.1)) / thinShellI(4.4, 1.1) > 1e-3, "a solid sphere does not satisfy the shell formula");
check(Math.abs(meta(shell).inertia! - solidSphereI(4.4, 1.1)) / solidSphereI(4.4, 1.1) > 1e-3, "a thin shell does not satisfy a solid-sphere request");
check(solid.kind === "circle" && shell.kind === "circle" && solid.radius === 1.1 && shell.radius === 1.1, "sphere and shell outlines use the body radius");
const secondSphere = simple({
  kind: "solid_sphere",
  mass: 1.3,
  radius: 2.05,
  center: { x: -0.4, y: 0.7 },
  displayLength: 1,
  axis: { orientation: "diameter", place: "centre" },
});
close(meta(secondSphere).inertia!, solidSphereI(1.3, 2.05), "a second sphere radius is not a special-cased constant");

const cmRod = { lengthUnit: "cm" as const, mass: 2, length: 12, center: { x: 0, y: 0 }, angle: 0, displayLength: 5 };
const centimetreRod = simple({
  kind: "uniform_rod",
  ...cmRod,
  axis: { orientation: "perpendicular_to_length", place: "centre" },
});
close(meta(centimetreRod).inertia!, 24, "a declared centimetre metric is not converted inside I");
check(meta(centimetreRod).lengthUnit === "cm", "the declared length unit is recorded");
rejects("simple_body_inertia", {
  kind: "uniform_rod",
  mass: { value: 2, unit: "mm" },
  length: 12,
  center: { x: 0, y: 0 },
  displayLength: 1,
  lengthUnit: "cm",
  axis: { orientation: "perpendicular_to_length", place: "centre" },
}, "mixed length units reject");
rejects("simple_body_inertia", { kind: "sphere", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "diameter", place: "centre" } }, "an unspecified sphere rejects");
rejects("simple_body_inertia", { kind: "shell", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "diameter", place: "centre" } }, "an unspecified shell rejects");
rejects("simple_body_inertia", { kind: "ring", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_plane", place: "centre" } }, "an unspecified ring rejects");
rejects("simple_body_inertia", { mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "diameter", place: "centre" } }, "a missing mass distribution rejects");
rejects("simple_body_inertia", { kind: "disc", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1 }, "a missing simple-body axis rejects");
rejects("simple_body_inertia", { kind: "solid_cylinder", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "symmetry", place: "centre" } }, "a cylinder without height rejects");
rejects("simple_body_inertia", { kind: "disc", mass: -1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_plane", place: "centre" } }, "negative simple-body mass rejects");
rejects("simple_body_inertia", { kind: "disc", mass: 0, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_plane", place: "centre" } }, "zero simple-body mass rejects");
rejects("simple_body_inertia", { kind: "uniform_rod", mass: 1, length: 0, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_length", place: "centre" } }, "zero length rejects");
rejects("simple_body_inertia", { kind: "disc", mass: 1, radius: Number.POSITIVE_INFINITY, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_plane", place: "centre" } }, "a non-finite radius rejects");
rejects("simple_body_inertia", { kind: "disc", mass: 1, radius: 1, center: { x: 0, y: 0 }, displayLength: 1, axis: { orientation: "perpendicular_to_plane", place: "centre" }, density: "variable" }, "an extra distribution key rejects");
rejects("simple_body_inertia", { displayLength: 1 }, "a simple body without a mass distribution rejects");
rejects("bogus", { displayLength: 1 }, "an unknown operator rejects");

const punchedInertia = run("simple_body_inertia", {
  kind: "composite",
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", through: { x: 0, y: 0 } },
  parts: [
    { kind: "disc", mass: 8, radius: 2, center: { x: 0, y: 0 } },
    { kind: "disc", mass: -2, radius: 0.4, center: { x: 0.5, y: 0 }, hole: true },
  ],
});
check(meta(punchedInertia[0]!).mass === 6, "hole inertia uses the reduced mass");
check(meta(punchedInertia[0]!).inertia! < discPerpI(8, 2), "a hole reduces inertia about the same axis");
close(meta(punchedInertia[0]!).centre!.x, -1 / 6, "hole inertia and centre share the same parts");
const offsetRods = run("simple_body_inertia", {
  kind: "composite",
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", through: { x: 0, y: 0 } },
  parts: [
    { kind: "uniform_rod", mass: 2, length: 2, center: { x: 0, y: 0 }, angle: 0 },
    { kind: "uniform_rod", mass: 2, length: 2, center: { x: 3, y: 0 }, angle: 0 },
  ],
});
close(meta(offsetRods[0]!).inertia!, 58 / 3, "an offset rod is integrated about the stated axis");

const parallelBase = {
  theorem: "parallel" as const,
  mass: 2,
  iCom: 5,
  axisDirection: zAxis,
  shiftedDirection: zAxis,
  displayLength: 1.25,
};
const zeroOffset = run("axes_theorem", { ...parallelBase, parallel: true, offset: { x: 0, y: 0, z: 0 } })[0]!;
check(zeroOffset.kind === "point", "a zero parallel offset draws a point");
check(meta(zeroOffset).inertia === 5 && meta(zeroOffset).offsetDistance === 0, "zero offset leaves I_com unchanged");
const parallelShift = run("axes_theorem", { ...parallelBase, parallel: true, offset: { x: 3, y: 0, z: 0 } })[0]!;
check(parallelShift.kind === "path" && parallelShift.directed === true, "a parallel offset draws a marker");
check(meta(parallelShift).inertia === 23, "I = I_com + M d^2");
check(Math.abs(pathLength(parallelShift) - 1.25) < 1e-9, "the offset marker uses displayLength and not the physical distance as its only scale");
const tallMarker = run("axes_theorem", { ...parallelBase, parallel: true, offset: { x: 3, y: 0, z: 0 }, displayLength: 4 })[0]!;
check(meta(tallMarker).inertia === meta(parallelShift).inertia, "displayLength does not change parallel-axis inertia");
rejects("axes_theorem", { ...parallelBase, parallel: false, offset: { x: 3, y: 0, z: 0 } }, "a non-parallel offset cannot use the parallel-axis theorem");
rejects("axes_theorem", {
  ...parallelBase,
  parallel: true,
  shiftedDirection: { x: 1, y: 0, z: 0 },
  offset: { x: 0, y: 1, z: 0 },
}, "a non-parallel direction labelled parallel rejects");
const lamina = run("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "planar_lamina",
  ix: 2,
  iy: 5,
  displayLength: 3,
})[0]!;
check(lamina.kind === "path" && lamina.closed === true, "a planar lamina is a closed path");
check(meta(lamina).inertia === 7, "Iz = Ix + Iy for a declared planar lamina");
if (lamina.kind === "path") {
  const side = Math.hypot(lamina.points[1]!.x - lamina.points[0]!.x, lamina.points[1]!.y - lamina.points[0]!.y);
  check(Math.abs(side - 3) < 1e-9, "the lamina marker side follows displayLength");
}
const laminaMarker = run("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "disc",
  ix: 2,
  iy: 5,
  displayLength: 6,
})[0]!;
check(meta(laminaMarker).inertia === 7, "displayLength does not change the perpendicular-axis sum");
rejects("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "solid_sphere",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, "perpendicular-axis theorem rejects a solid sphere");
rejects("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "solid_cylinder",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, "perpendicular-axis theorem rejects a solid cylinder");
rejects("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "thin_spherical_shell",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, "perpendicular-axis theorem rejects a thin spherical shell");
rejects("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: false,
  bodyKind: "planar_lamina",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, "a body that is not declared a planar lamina rejects");
rejects("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  bodyKind: "disc",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, "a missing lamina declaration rejects");

// Holdout composite, not the first example: offset circular hole in a disc.
const holdoutMass = 6.5;
const holdoutRadius = 1.8;
const holeMass = -1.2;
const holeRadius = 0.45;
const holeOffset = 0.7;
const holdout = run("simple_body_inertia", {
  kind: "composite",
  displayLength: 2,
  axis: { orientation: "perpendicular_to_plane", through: { x: 0, y: 0 } },
  parts: [
    { kind: "disc", mass: holdoutMass, radius: holdoutRadius, center: { x: 0, y: 0 } },
    { kind: "disc", mass: holeMass, radius: holeRadius, center: { x: holeOffset, y: 0 }, hole: true },
  ],
});
const holdoutOracleI = discPerpI(holdoutMass, holdoutRadius) + discPerpI(holeMass, holeRadius) + holeMass * holeOffset * holeOffset;
const holdoutOracleMass = holdoutMass + holeMass;
const holdoutOracleX = (holeMass * holeOffset) / holdoutOracleMass;
close(meta(holdout[0]!).inertia!, holdoutOracleI, "holdout disc-and-hole inertia matches an independent parallel-axis oracle");
close(meta(holdout[0]!).centre!.x, holdoutOracleX, "holdout centre matches the independent mass weighting");
close(meta(holdout[0]!).centre!.y, 0, "holdout centre y");
check(meta(holdout[0]!).mass === holdoutOracleMass && holdoutOracleMass < holdoutMass, "the holdout hole reduces mass");
check(holdout[1]!.kind === "circle" && holdout[1]!.rigidMass.mark === "hole", "the holdout hole is drawn as a hole");
check(meta(holdout[0]!).quadrature?.method === "composite_simpson", "the holdout inertia was integrated");

function massDocument(operator: string, inputs: Record<string, unknown>, kinds: string[], quantities: SceneDocument["quantities"] = []): SceneDocument {
  const outputs = kinds.map((_, index) => `mark_${index}`);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "rigid mass operators" },
    source: { packet: "CH-07a" },
    quantities,
    entities: outputs.map((id, index) => ({ id, kind: kinds[index]!, role: "rigid mass mark" })),
    constructions: [{ id: "mass_law", operator, inputs, outputs }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: outputs,
    revealGroups: [{ id: "show", entityIds: outputs, dependsOn: [], narrationCue: "show the mass diagram" }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "show", dependsOn: [], narrationIntent: "show the mass diagram" }],
  };
}
function issuesFor(document: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map<string, SceneDocument["constructions"][number]>();
  for (const construction of document.constructions) {
    if (!Array.isArray(construction.outputs)) continue;
    for (const id of construction.outputs) byOutput.set(id, construction);
  }
  document.constructions.forEach((construction, index) => validateRigidMassConstruction(construction, index, document, byOutput, issues));
  return issues;
}
const goodDisc = simple({
  kind: "disc",
  mass: 2.2,
  radius: 1.35,
  center: { x: 0, y: 0 },
  displayLength: 1.5,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
});
const goodDocument = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: 2.2,
  radius: 1.35,
  center: { x: 0, y: 0 },
  displayLength: 1.5,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, [rigidMassEntityKind(goodDisc)]);
const goodBefore = JSON.stringify(goodDocument);
const goodIssues = issuesFor(goodDocument);
check(goodIssues.length === 0, `a good rigid-mass document has zero issues: ${JSON.stringify(goodIssues)}`);
check(JSON.stringify(goodDocument) === goodBefore, "validation does not mutate a good document");
const quantityDocument = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: "disc_mass",
  radius: 1.35,
  center: { x: 0, y: 0 },
  displayLength: 1.5,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, ["circle"], [{ id: "disc_mass", value: 2.2 }]);
check(issuesFor(quantityDocument).length === 0, "a quantity-backed disc validates");
const cyclic = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: "loop",
  radius: 1,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, ["circle"], [{ id: "loop", value: "loop" }]);
check(issuesFor(cyclic).some((issue) => issue.severity === "fatal"), "a cyclic quantity is fatal");
const negativeDocument = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: -2,
  radius: 1,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, ["circle"]);
let negativeThrew = false;
let negativeIssues: SceneIssue[] = [];
try {
  negativeIssues = issuesFor(negativeDocument);
} catch {
  negativeThrew = true;
}
check(!negativeThrew && negativeIssues.length > 0 && negativeIssues.every((issue) => issue.severity === "fatal"), "negative mass is fatal and does not leave the document clean");
check(negativeIssues.some((issue) => issue.code === "invalid_simple_body_inertia_mass"), "negative mass names the mass input");
const sphereDocument = massDocument("axes_theorem", {
  theorem: "perpendicular",
  mass: 4,
  lamina: true,
  bodyKind: "solid_sphere",
  ix: 2,
  iy: 5,
  displayLength: 1,
}, ["polygon"]);
const sphereIssues = issuesFor(sphereDocument);
check(sphereIssues.length > 0 && sphereIssues.every((issue) => issue.severity === "fatal"), "perpendicular-axis on a solid sphere is fatal");
check(sphereIssues.some((issue) => issue.code === "invalid_axes_theorem_bodyKind"), "the sphere rejection names the body kind");
const missingOutputs = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: 1,
  radius: 1,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, ["circle"]);
Reflect.deleteProperty(missingOutputs.constructions[0]!, "outputs");
let missingThrew = false;
let missingIssues: SceneIssue[] = [];
try {
  missingIssues = issuesFor(missingOutputs);
} catch {
  missingThrew = true;
}
check(!missingThrew && missingIssues.some((issue) => issue.code === "invalid_simple_body_inertia_outputs" && issue.severity === "fatal"), "missing outputs are fatal without throwing");
const wrongKind = massDocument("simple_body_inertia", {
  kind: "disc",
  mass: 1,
  radius: 1,
  center: { x: 0, y: 0 },
  displayLength: 1,
  axis: { orientation: "perpendicular_to_plane", place: "centre" },
}, ["segment"]);
check(issuesFor(wrongKind).some((issue) => issue.code === "invalid_simple_body_inertia_output_kind" && issue.severity === "fatal"), "the wrong entity kind is fatal");

const drawnDisc = discPerp.kind === "circle" ? discPerp : goodDisc;
const drawnMotion = motion.kind === "path" ? motion : isolated;
const structural: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "rigid mass marks drawn with supported operators" },
  source: { question: "Show the centre of mass." },
  quantities: [],
  entities: [
    { id: "disc", kind: "circle", role: "uniform disc outline" },
    { id: "centre", kind: "point", role: "centre of mass" },
    { id: "rod", kind: "segment", role: "uniform rod" },
    { id: "acceleration", kind: "vector", role: "centre acceleration" },
  ],
  constructions: [
    { id: "draw_disc", operator: "circle", inputs: { center: drawnDisc.kind === "circle" ? [drawnDisc.center.x, drawnDisc.center.y] : [0, 0], radius: drawnDisc.kind === "circle" ? drawnDisc.radius : 1 }, outputs: ["disc"] },
    { id: "draw_centre", operator: "point", inputs: { x: meta(discCom[1]!).centre!.x, y: meta(discCom[1]!).centre!.y }, outputs: ["centre"] },
    { id: "draw_rod", operator: "segment", inputs: { start: rodBody[0]!.kind === "path" ? [rodBody[0]!.points[0]!.x, rodBody[0]!.points[0]!.y] : [0, 0], end: rodBody[0]!.kind === "path" ? [rodBody[0]!.points[1]!.x, rodBody[0]!.points[1]!.y] : [1, 0] }, outputs: ["rod"] },
    { id: "draw_acceleration", operator: "vector", inputs: { start: drawnMotion.kind === "path" ? [drawnMotion.points[0]!.x, drawnMotion.points[0]!.y] : [0, 0], end: drawnMotion.kind === "path" ? [drawnMotion.points[1]!.x, drawnMotion.points[1]!.y] : [1, 0] }, outputs: ["acceleration"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["disc", "centre", "rod", "acceleration"],
  revealGroups: [{ id: "show", entityIds: ["disc", "centre", "rod", "acceleration"], dependsOn: [], narrationCue: "show the mass diagram" }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "show", dependsOn: [], narrationIntent: "show the mass diagram" }],
};

const { validateSceneDocument } = await import("../../src/document/validation.ts");
const structuralResult = validateSceneDocument(structural);
check(structural.schemaVersion === "scene-document/v2", "the drawing document is scene-document/v2");
check(structuralResult.report.issues.length === 0, `supported rigid-mass drawing has zero scene issues: ${JSON.stringify(structuralResult.report.issues)}`);
check(structuralResult.document !== null, "a clean scene document is returned");

console.log(`CH-07a rigid mass operators passed (${checks} checks)`);
