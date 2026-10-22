/**
 * Prompt line check for the trajectory operator contracts (Motion in a Plane, lane T).
 *
 * Recorded YouTube tries lost figures because the planner wrote what these
 * lines told it or omitted what compaction dropped:
 * - projectile_trajectory: the detailed "Full shape" listed a units block the
 *   operator rejects (invalid_projectile_trajectory_fields, 5 candidates);
 * - constant_acceleration_trajectory: compact `units?` read as optional while a
 *   time named a quantity in s (invalid_*_units, 3 candidates);
 * - curve_anchor / curve_derivative on a projectile path, or at as a domain
 *   fraction (invalid_curve_anchor_curve, 3 candidates; _units, 1).
 * Each contract must now say so in both the detailed and the compact form, and
 * every key the projectile line offers must be one the operator accepts.
 * Reads the built scene-engine dist (run after `pnpm build`).
 */
import assert from "node:assert/strict";
import { SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, validateSceneDocument } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  checks++;
}
const lineOf = (contracts: string, operator: string): string => {
  const line = contracts.split("\n").find((candidate) => candidate.startsWith(`- ${operator}: {`));
  assert(line, `${operator} contract line is present`);
  return line;
};

// Detailed lines (repairs and scoped requests).
const projectile = lineOf(selectConstructionInputContracts(["projectile_trajectory"]), "projectile_trajectory");
check(!/units\s*:/.test(projectile), `projectile_trajectory must not offer a units key: ${projectile}`);
check(projectile.includes("no units key"), "projectile_trajectory says it takes no units key");
check(projectile.includes("The path is not a sampled curve") && projectile.includes("use constant_acceleration_trajectory and trajectory_state"),
  "projectile_trajectory points instants to constant_acceleration_trajectory and trajectory_state");
const trajectory = lineOf(selectConstructionInputContracts(["constant_acceleration_trajectory"]), "constant_acceleration_trajectory");
check(trajectory.includes("units is required, and must match, when an input or a trajectory_state time names a quantity with a unit"),
  "constant_acceleration_trajectory says when units is required");
const anchor = lineOf(selectConstructionInputContracts(["curve_anchor"]), "curve_anchor");
check(anchor.includes("in the curve's parameter unit,not a domain fraction; a quantity in s needs a domain in s"), "curve_anchor states the parameter unit rule");

// Compact lines (initial lanes and repairs for operators the candidate did not use).
const compact = selectConstructionInputContracts(["projectile_trajectory", "constant_acceleration_trajectory", "curve_anchor", "curve_derivative", "trajectory_state"], []);
const compactProjectile = lineOf(compact, "projectile_trajectory");
check(compactProjectile.includes("Outputs [trajectory,launch velocity]; no units key; the path is not a sampled curve."), `compact projectile keeps both rules: ${compactProjectile}`);
const compactTrajectory = lineOf(compact, "constant_acceleration_trajectory");
check(compactTrajectory.includes("Output 1 polyline. units is required when an input or a trajectory_state time names a quantity with a unit."), `compact trajectory keeps the units rule: ${compactTrajectory}`);
const compactAnchor = lineOf(compact, "curve_anchor");
check(compactAnchor.includes("Output 1 point. at is actual x/t/theta in the curve's parameter unit, not a domain fraction."), `compact curve_anchor keeps the at rule: ${compactAnchor}`);
check(lineOf(compact, "curve_anchor").includes("{curve:@sampled_curve,at}") && lineOf(compact, "curve_derivative").includes("{curve:@sampled_curve,"),
  "compact curve operators still name @sampled_curve, which the projectile line rules out");

// Every key the projectile "Full shape" offers is accepted by the built operator.
const fullShape = projectile.match(/Full shape: \{(.*?)\}, no units key/)?.[1];
assert(fullShape, "projectile_trajectory keeps a Full shape");
const offered = fullShape.split(",").map((key) => key.split(/[?:]/, 1)[0]!.trim()).filter(Boolean);
check(offered.length >= 9, `projectile Full shape lists its optional keys: ${offered.join(",")}`);
const values: Record<string, unknown> = { speed: 20, launchAngleDeg: 30, gravity: 10, inclineAngleDeg: 0, initialHeight: 5, direction: "up", origin: [0, 0], displayScale: 1, samples: 49 };
for (const key of offered) check(key in values, `the gate has a sample value for offered key ${key}`);
const offeredInputs = Object.fromEntries(offered.map((key) => [key, values[key]]));
const validated = validateSceneDocument({
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "contract" }, source: {}, quantities: [],
  entities: [{ id: "path", kind: "polyline", role: "polyline" }, { id: "launch", kind: "vector", role: "vector" }],
  constructions: [{ id: "make", operator: "projectile_trajectory", inputs: offeredInputs, outputs: ["path", "launch"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["path", "launch"],
  revealGroups: [{ id: "reveal", entityIds: ["path", "launch"], dependsOn: [], narrationCue: "contract" }], teachingTimeline: [],
});
const projectileIssues = validated.report.issues.filter((issue) => issue.severity === "fatal" && issue.code.startsWith("invalid_projectile_trajectory_"));
check(projectileIssues.length === 0, `every offered projectile key is accepted: ${JSON.stringify(projectileIssues)}`);

// The universal catalog on current main already exceeds the older 24_500
// initial budget. This clarification adds the sampled-curve sentence (48
// characters) and must stay inside the same room main now uses.
const question = "Draw the supplied conditional outcomes and mark every joint leaf probability.";
const prompt = buildSceneDocumentPlannerPrompt(question, { ...inferSceneCapabilities(question), constructionOperators: SUPPORTED_SCENE_CONSTRUCTION_OPERATORS });
check(prompt.length + 800 <= 25_000, `full catalog fits the initial transport budget: ${prompt.length}`);

console.log(`verify-trajectory-operator-contracts: ok (${checks} checks, full catalog ${prompt.length} chars)`);
