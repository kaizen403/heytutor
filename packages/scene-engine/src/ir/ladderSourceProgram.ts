/** Exact static contact triangle from independently read source sides. */
import { SceneBuilder, fmt } from "../archetypes/document";
import type { PlanQuantity } from "../archetypes/slots";
import { resolveLadderSource } from "./rightTriangleSource";

export function ladderSourceProgram(question: string, quantities: readonly PlanQuantity[] = []) {
  const resolved = resolveLadderSource(question, quantities);
  if (!resolved.ok) return null;
  const { state: { length, distance, height, theta }, side } = resolved;
  const scene = new SceneBuilder(question, "static right triangle from stated ladder dimensions", "ladder_wall");
  scene.quantity("length", "L", length, "m");
  scene.quantity("distance", "d", distance, "m");
  scene.quantity("height", "h", height, "m");
  scene.quantity("theta", "theta", theta, "degree");
  scene.point("corner", { x: 0, y: 0 }, "wall-floor intersection", "O");
  scene.point("A", { x: side * distance, y: 0 }, "ladder foot", "A");
  scene.point("B", { x: 0, y: height }, "ladder top", "B");
  scene.segment("floor", "corner", "A", "horizontal floor");
  scene.segment("wall", "corner", "B", "vertical wall");
  scene.segment("ladder", "A", "B", "ladder", `L=${fmt(length)} m`);
  scene.dimension("foot_distance", "corner", "A", "stated or computed foot distance", `d=${fmt(distance)} m`);
  scene.dimension("top_height", "corner", "B", "stated or computed top height", `h=${fmt(height)} m`);
  scene.angleMark("angle", "A", "ladder", "floor", `θ≈${fmt(theta)}°`);
  scene.rightAngle("right_angle", "corner", "wall", "floor");
  scene.assert("wall_floor_perpendicular", "perpendicular", ["wall", "floor"]);
  scene.assert("ladder_angle", "angle_between", ["ladder", "floor"], { value: theta, unit: "degree" });
  scene.assert("base_ratio", "distance_ratio", ["corner", "A", "A", "B"], distance / length);
  scene.assert("height_ratio", "distance_ratio", ["corner", "B", "A", "B"], height / length);
  scene.assert("foot_on_floor", "on", ["A", "floor"]);
  scene.assert("top_on_wall", "on", ["B", "wall"]);
  scene.labelled("A", "B", "ladder", "foot_distance", "top_height");
  scene.group("setup", ["corner", "floor", "wall", "A", "B", "ladder", "right_angle"], "the source contact triangle");
  scene.group("dimensions", ["foot_distance", "top_height", "angle"], "stated sides and deterministically computed height and angle", ["setup"]);
  const document = scene.build();
  document.source = { ...document.source, sourceSideEvidence: resolved.evidence, orientationStated: resolved.orientationStated, sourceSide: side };
  return document;
}
