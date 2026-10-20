/**
 * Motion floor: a projectile launched from level ground and landing on the
 * same level. The setup is fixed by that statement alone: the ground, the
 * launch point, a parabola that leaves along the launch velocity and lands at
 * the range. Values are the question's (launch speed, launch angle) as
 * written; the range and height carry "?" when asked. A launch from a height,
 * a horizontal or vertical throw, an incline, a wall or a target changes the
 * picture and declines.
 */
import { projectileLaunchAngle } from "../../physics/projectileLaunchSource";
import type { FloorFacts, FloorStatedValue } from "../facts";
import type { FloorKindBuild } from "./index";
import { emptyParts, floorEntity, floorDocument, obligatedObjects, point, problemLabel, unitDimension, valueLabel } from "./shared";

const PROJECTILE = /\b(?:projectile|projected|launched|thrown|kicked|fired|hit)\b/i;
const LEVEL = /\b(?:level|horizontal|flat)\s+(?:ground|surface|plane|field|road)\b|\bsame\s+(?:level|height|horizontal)\b|\blevel ground\b/i;
/** A launch from a raised point: the top or edge of a stated structure, or "from a height". */
const ELEVATED = /\bfrom (?:the (?:top|edge|roof) of |the |a |an )(?:[\p{L}-]+\s+){0,2}(?:tower|cliff|building|table|roof|window|hill|bridge|platform|balcony)\b|\bfrom a height\b/iu;
const HORIZONTAL_THROW = /\b(?:thrown|projected|launched|fired|kicked|rolls? off)\s+horizontally\b/i;
/**
 * Setups the level launch must not draw: inclines, walls and targets, moving
 * frames, two bodies, vertical throws, and a velocity stated by components
 * (its direction would have to be computed).
 */
const NOT_LEVEL = /\b(?:incline[ds]?|inclined plane|slope|wall|target|jeep|train|trolley|truck|lift|elevator|river|pit|well|two balls|second ball|another ball|ball [ab]|particle [ab]|stone [ab])\b|\b(?:thrown|projected|launched)\s+(?:straight\s+)?(?:vertically|up|down)(?:ward)?\b|\brelative to the\b|[îĵ]|\bcomponents?\b/i;

export function motionSignals(facts: FloorFacts): boolean {
  return PROJECTILE.test(facts.question) && (LEVEL.test(facts.question) || (ELEVATED.test(facts.question) && HORIZONTAL_THROW.test(facts.question)));
}

export function buildMotionFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!motionSignals(facts)) return null;
  if (NOT_LEVEL.test(facts.question)) return { declined: "the launch has a part the motion floor does not draw" };
  if (ELEVATED.test(facts.question)) return HORIZONTAL_THROW.test(facts.question) ? buildHeightLaunch(facts) : { declined: "an angled launch from a height" };
  const statedAngle = projectileLaunchAngle(facts.question);
  if (statedAngle !== null && !(statedAngle > 5 && statedAngle < 85)) return { declined: "the stated launch angle is outside a drawable level launch" };
  const angleValue = facts.values.find((value) => unitDimension(value.unit) === "angle" &&
    statedAngle !== null && Math.abs(value.value - statedAngle) < 1e-9);
  if (statedAngle !== null && !angleValue) return { declined: "the stated launch angle has no stated spelling" };
  const speeds = facts.values.filter((value) => /^(?:m\/s|km\/h|cm\/s)$/.test((value.unit ?? "").trim()));
  if (speeds.length > 1) return { declined: "more than one stated speed" };
  const speed: FloorStatedValue | null = speeds[0] ?? null;
  const theta = ((statedAngle ?? 50) * Math.PI) / 180;
  const range = 6;
  const slope = Math.tan(theta);

  // ProblemIR bodies must each find their place under their source names.
  const obligated = obligatedObjects(facts);
  const role = (id: string, name: string | null): "launch" | "path" | "ground" | null => {
    const text = `${name ?? ""} ${id}`.toLowerCase();
    if (/\b(?:ground|floor|level|surface)\b/.test(text)) return "ground";
    if (/\b(?:trajectory|path|parabola|curve)\b/.test(text)) return "path";
    if (/\b(?:projectile|ball|stone|particle|body|object|launch)\b/.test(text)) return "launch";
    return null;
  };
  const named: Record<"launch" | "path" | "ground", { id: string; name: string } | null> = { launch: null, path: null, ground: null };
  for (const object of obligated) {
    const label = problemLabel(facts, object.id);
    const which = role(object.id, label);
    if (!which || named[which] || (label && !object.name)) return { declined: `obligated ${object.id} has no place in a level launch` };
    named[which] = { id: object.id, name: object.name ?? object.id };
  }

  const built = emptyParts();
  const names: string[] = [];
  const ids = { launch: named.launch?.id ?? "launch", path: named.path?.id ?? "trajectory", ground: named.ground?.id ?? "ground" };
  const groundStart = "ground_start", groundEnd = "ground_end", landing = "landing";
  built.entities.push(
    floorEntity(groundStart, "point", "ground end", null, { stated: "level ground" }),
    floorEntity(groundEnd, "point", "ground end", null, { stated: "level ground" }),
    floorEntity(ids.ground, "segment", "stated level ground", named.ground?.name ?? null, { stated: "level ground", ...(named.ground ? { objectId: named.ground.id } : {}) }),
    floorEntity(ids.launch, "point", "launch point", named.launch?.name ?? "O", { stated: "launch point", ...(named.launch ? { objectId: named.launch.id } : {}) }),
    floorEntity(landing, "point", "landing point on the same level", null, { stated: "lands on the same level" }),
    floorEntity(ids.path, "polyline", "path of a level launch", named.path?.name ?? null, { stated: "projectile path", ...(named.path ? { objectId: named.path.id } : {}) }),
  );
  built.constructions.push(
    point(groundStart, -0.8, 0), point(groundEnd, range + 0.8, 0), point(ids.launch, 0, 0), point(landing, range, 0),
    { id: `draw_${ids.ground}`, operator: "segment", inputs: { start: groundStart, end: groundEnd }, outputs: [ids.ground] },
    { id: `draw_${ids.path}`, operator: "function_curve", inputs: {
      expression: `${slope}*x-${slope / range}*x^2`, variable: "x", xMin: 0, xMax: range, samples: 65,
    }, outputs: [ids.path] },
  );
  if (named.ground) names.push(named.ground.name);
  if (named.path) names.push(named.path.name);
  names.push(named.launch?.name ?? "O");
  const velocity = "launch_velocity", mark = "launch_angle", rangeMark = "range_mark";
  const speedLabel = speed ? valueLabel(speed) : "u";
  const angleLabel = angleValue ? valueLabel(angleValue) : "θ";
  if (!speed) names.push("u");
  if (!angleValue) names.push("θ");
  built.entities.push(
    floorEntity(velocity, "vector", "launch velocity along the start of the path", speedLabel,
      { stated: "launch velocity", ...(speed ? { quantityIds: [speed.quantityId] } : {}) }),
    floorEntity(mark, "angle_mark", "launch angle above the ground", angleLabel,
      { stated: "launch angle", ...(angleValue ? { quantityIds: [angleValue.quantityId] } : {}) }),
  );
  built.constructions.push(
    { id: `draw_${velocity}`, operator: "vector", inputs: { start: ids.launch, direction: [Math.cos(theta), Math.sin(theta)], length: 2.2 }, outputs: [velocity] },
    { id: `draw_${mark}`, operator: "angle_mark", inputs: { vertex: ids.launch, a: velocity, b: landing, radius: 0.8 }, outputs: [mark] },
  );
  // The asked range carries "?"; an unasked range is not drawn.
  const asked = facts.unknowns.find((unknown) => /^R(?:_?\w*)?$/.test(unknown.symbol) &&
    /\brange\b/i.test(facts.question) && unitDimension(facts.plan.unknowns.find((planned) => planned.id === unknown.quantityId)?.unit) !== "angle");
  if (asked) {
    built.entities.push(floorEntity(rangeMark, "dimension", "asked range", `${asked.symbol} = ?`, { stated: "range asked" }));
    built.constructions.push({ id: `draw_${rangeMark}`, operator: "dimension", inputs: { start: ids.launch, end: landing }, outputs: [rangeMark] });
  }
  built.assertions.push(
    { id: "floor_launch_on_path", predicate: "function_value", entities: [ids.path], expected: { x: 0, y: 0 }, severity: "fatal", reason: "the path starts at the launch point" },
    { id: "floor_lands_level", predicate: "function_value", entities: [ids.path], expected: { x: range, y: 0 }, severity: "fatal", reason: "the path lands on the same level" },
    { id: "floor_launch_angle", predicate: "angle_between", entities: [velocity, ids.ground], expected: { value: (theta * 180) / Math.PI, unit: "degree" },
      severity: "fatal", reason: "the launch velocity leaves along the path at the launch angle" },
    { id: "floor_launch_on_ground", predicate: "on", entities: [ids.launch, ids.ground], expected: true, severity: "fatal", reason: "launched from the ground" },
  );
  for (const constraint of facts.constraints) {
    if (constraint.kind !== "incident") continue;
    const sceneIds = constraint.entityIds.map((id) => [named.launch, named.path, named.ground].find((object) => object?.id === id)?.id);
    if (sceneIds.some((id) => !id)) return { declined: "a stated incidence names something the level launch does not draw" };
    if (sceneIds.includes(ids.path)) {
      // A curve meets a line at a point: the landing point lies on both.
      built.assertions.push(
        { id: `floor_incident_${constraint.id}_path`, predicate: "on", entities: [landing, ids.path], expected: true, severity: "fatal", reason: "the path reaches the ground" },
        { id: `floor_incident_${constraint.id}_ground`, predicate: "on", entities: [landing, ids.ground], expected: true, severity: "fatal", reason: "at a point of the ground" },
      );
    } else {
      built.assertions.push({ id: `floor_incident_${constraint.id}`, predicate: "on", entities: sceneIds as string[], expected: true, severity: "fatal",
        reason: "the stated incidence" });
    }
  }
  built.groups.push(
    { id: "floor_ground", entityIds: [groundStart, groundEnd, ids.ground, ids.launch, landing], cue: "Level ground and the launch point." },
    { id: "floor_launch", entityIds: [velocity, mark], cue: "The launch velocity and its angle above the ground." },
    { id: "floor_path", entityIds: [ids.path, ...(asked ? [rangeMark] : [])], cue: "The path back to the same level; the range is what we find." },
  );
  return {
    document: floorDocument(facts, "motion", built, "a level-ground projectile launch, as stated"),
    names,
    directedInk: true,
    reason: statedAngle !== null ? "level launch at the stated angle" : "level launch at a general angle θ",
  };
}

/**
 * A horizontal throw from the top of a stated structure: the structure at its
 * stated height, the horizontal launch velocity, and a path that leaves
 * horizontally and reaches the ground. Nonmetric: the landing distance is what
 * the question asks, so it is drawn as "?" when asked and never as a number.
 */
function buildHeightLaunch(facts: FloorFacts): FloorKindBuild | { declined: string } {
  if (/\b(?:west(?:ward)?|leftward|to the left)\b/i.test(facts.question)) return { declined: "a westward throw is not drawn" };
  const heights = facts.values.filter((value) => unitDimension(value.unit) === "length" && /\b(?:high|height|tall|top of|above)\b/i.test(value.context));
  const speeds = facts.values.filter((value) => /^(?:m\/s|km\/h|cm\/s)$/.test((value.unit ?? "").trim()));
  if (heights.length !== 1 || speeds.length > 1) return { declined: "one stated height and at most one stated speed are needed" };
  if (obligatedObjects(facts).length > 0) return { declined: "a ProblemIR body has no place in the horizontal throw" };
  const structure = (facts.question.match(/\b(tower|cliff|building|table|roof|window|hill|bridge|platform|balcony)\b/i)?.[1] ?? "").toLowerCase();
  const height = heights[0]!, speed = speeds[0] ?? null;
  const top = 3.2, land = 5;
  const built = emptyParts();
  const names = [structure, "O"];
  built.entities.push(
    floorEntity("ground_start", "point", "ground end", null, { stated: "ground" }),
    floorEntity("ground_end", "point", "ground end", null, { stated: "ground" }),
    floorEntity("ground", "segment", "ground below", null, { stated: "ground" }),
    floorEntity("foot", "point", `foot of the ${structure}`, null, { stated: structure }),
    floorEntity("launch", "point", "launch point at the top", "O", { stated: "top of the structure" }),
    floorEntity("structure", "segment", `stated ${structure}`, structure, { stated: structure }),
    floorEntity("height_mark", "dimension", "stated height", valueLabel(height), { quantityIds: [height.quantityId] }),
    floorEntity("landing", "point", "where the path meets the ground", null, { stated: "reaches the ground" }),
    floorEntity("path", "polyline", "path of a horizontal throw", null, { stated: "projectile path" }),
    floorEntity("launch_velocity", "vector", "horizontal launch velocity", speed ? valueLabel(speed) : "u",
      { stated: "thrown horizontally", ...(speed ? { quantityIds: [speed.quantityId] } : {}) }),
  );
  if (!speed) names.push("u");
  built.constructions.push(
    point("ground_start", -0.8, 0), point("ground_end", land + 1, 0), point("foot", 0, 0), point("launch", 0, top), point("landing", land, 0),
    { id: "draw_ground", operator: "segment", inputs: { start: "ground_start", end: "ground_end" }, outputs: ["ground"] },
    { id: "draw_structure", operator: "segment", inputs: { start: "foot", end: "launch" }, outputs: ["structure"] },
    { id: "draw_height_mark", operator: "dimension", inputs: { start: "foot", end: "launch" }, outputs: ["height_mark"] },
    { id: "draw_path", operator: "function_curve", inputs: { expression: `${top}-${top / (land * land)}*x^2`, variable: "x", xMin: 0, xMax: land, samples: 65 }, outputs: ["path"] },
    { id: "draw_launch_velocity", operator: "vector", inputs: { start: "launch", direction: [1, 0], length: 1.8 }, outputs: ["launch_velocity"] },
  );
  const asked = facts.unknowns.find((unknown) => unitDimension(facts.plan.unknowns.find((planned) => planned.id === unknown.quantityId)?.unit) === "length" &&
    /\b(?:how far|distance|range|from the (?:foot|base))\b/i.test(facts.question));
  if (asked) {
    built.entities.push(floorEntity("distance_mark", "dimension", "asked horizontal distance", `${asked.symbol} = ?`, { stated: "distance asked" }));
    built.constructions.push({ id: "draw_distance_mark", operator: "dimension", inputs: { start: "foot", end: "landing" }, outputs: ["distance_mark"] });
  }
  built.assertions.push(
    { id: "floor_path_starts_at_top", predicate: "function_value", entities: ["path"], expected: { x: 0, y: top }, severity: "fatal", reason: "the path starts at the top" },
    { id: "floor_path_lands", predicate: "function_value", entities: ["path"], expected: { x: land, y: 0 }, severity: "fatal", reason: "the path reaches the ground" },
    { id: "floor_structure_upright", predicate: "perpendicular", entities: ["structure", "ground"], expected: true, severity: "fatal", reason: "the structure stands upright" },
    { id: "floor_throw_horizontal", predicate: "parallel", entities: ["launch_velocity", "ground"], expected: true, severity: "fatal", reason: "thrown horizontally" },
  );
  built.groups.push(
    { id: "floor_structure", entityIds: ["ground_start", "ground_end", "ground", "foot", "launch", "structure", "height_mark"], cue: `The ${structure} at its stated height.` },
    { id: "floor_throw", entityIds: ["launch_velocity", "landing", "path", ...(asked ? ["distance_mark"] : [])], cue: "Thrown horizontally from the top; where it lands is what we find." },
  );
  return {
    document: floorDocument(facts, "motion", built, `a horizontal throw from the stated ${structure}`),
    names,
    directedInk: true,
    reason: `horizontal throw from a stated ${structure} height`,
  };
}
