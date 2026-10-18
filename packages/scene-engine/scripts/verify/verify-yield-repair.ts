import assert from "node:assert/strict";
import * as repair from "../../src/compile/repairSurvivorship";

type Document = Record<string, unknown>;
function scene(): Document {
  return {
    entities: [
      { id: "path", kind: "polyline", role: "projectile trajectory" },
      { id: "peak", kind: "point", role: "highest point" },
      { id: "velocity", kind: "vector", role: "velocity at highest point" },
    ],
    constructions: [
      {
        id: "motion",
        operator: "projectile_trajectory",
        inputs: {},
        outputs: ["path", "velocity"],
      },
      {
        id: "peak-state",
        operator: "curve_anchor",
        inputs: { curve: "path", at: 2 },
        outputs: ["peak"],
      },
    ],
    requiredEntityIds: ["path", "peak", "velocity"],
    revealGroups: [{ id: "setup", entityIds: ["path", "peak", "velocity"] }],
  };
}
const clone = <T>(value: T): T => structuredClone(value);
const seed = scene();
const rephrased = clone(seed);
(rephrased.entities as Document[])[0]!.role = "flight trajectory";
(rephrased.entities as Document[])[2]!.role =
  "horizontal velocity at the highest point";
assert.deepEqual(
  repair.validateRepairSurvivorship(seed, rephrased),
  [],
  "role prose is not geometry identity",
);
const analytic = clone(rephrased);
(analytic.constructions as Document[])[0] = {
  id: "curve",
  operator: "function_curve",
  inputs: {},
  outputs: ["path"],
};
(analytic.constructions as Document[]).push({
  id: "v",
  operator: "vector",
  inputs: {},
  outputs: ["velocity"],
});
assert.deepEqual(
  repair.validateRepairSurvivorship(seed, analytic),
  [],
  "analytic curve and independent vector preserve motion outputs",
);
for (const mutate of [
  (d: Document) => {
    (d.entities as Document[])[0]!.role = "ground";
  },
  (d: Document) => {
    (d.constructions as Document[])[0]!.operator = "polyline";
  },
  (d: Document) => {
    (d.entities as Document[])[1]!.role = "landing point";
  },
  (d: Document) => {
    (d.entities as Document[])[2]!.role = "acceleration at highest point";
  },
  (d: Document) => {
    d.entities = (d.entities as Document[]).filter((e) => e.id !== "peak");
  },
  (d: Document) => {
    d.revealGroups = [{ id: "setup", entityIds: ["peak", "velocity"] }];
  },
  (d: Document) => {
    d.revealGroups = [{ id: "setup", entityIds: ["path", "velocity"] }];
  },
]) {
  const bad = clone(seed);
  mutate(bad);
  assert(
    repair.validateRepairSurvivorship(seed, bad).length > 0,
    "same-ID substitutions, deleted named points, and hidden paths remain blocked",
  );
}
const endpointSeed: Document = {
  entities: [
    { id: "a", kind: "point", role: "wall base" },
    { id: "b", kind: "point" },
    { id: "wall", kind: "segment", role: "vertical wall" },
  ],
  constructions: [
    { operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { operator: "point", inputs: { x: 0, y: 1 }, outputs: ["b"] },
    {
      operator: "segment",
      inputs: { start: "a", end: "b" },
      outputs: ["wall"],
    },
  ],
  requiredEntityIds: ["a", "wall"],
  revealGroups: [{ entityIds: ["a", "wall"] }],
};
const endpointRepair = clone(endpointSeed);
endpointRepair.requiredEntityIds = ["wall"];
endpointRepair.revealGroups = [{ entityIds: ["wall"] }];
(endpointRepair.entities as Document[])[0]!.role = "wall foot";
assert.deepEqual(
  repair.validateRepairSurvivorship(endpointSeed, endpointRepair),
  [],
  "visible geometry retains its constructed endpoints",
);
const spanSeed = clone(endpointSeed);
(spanSeed.entities as Document[])[2]!.kind = "dimension";
(spanSeed.constructions as Document[])[2]!.operator = "dimension";
assert.deepEqual(
  repair.validateRepairSurvivorship(spanSeed, endpointRepair),
  [],
  "same endpoint span survives dimension-to-segment repair",
);
const wrongSpan = clone(endpointRepair);
(wrongSpan.constructions as Document[])[2]!.inputs = { start: "a", end: "a" };
assert(
  repair.validateRepairSurvivorship(spanSeed, wrongSpan).length > 0,
  "cross-kind spans must preserve endpoints",
);
const setCheck = repair.validateRepairCandidateSetSurvivorship;
assert.equal(typeof setCheck, "function");
assert.deepEqual(
  setCheck([seed, endpointSeed], analytic),
  [],
  "one trajectory survives either initial lane",
);
assert(
  setCheck([endpointSeed, seed], endpointRepair).length > 0,
  "trajectory-free selected lane cannot erase sibling motion requirement",
);
assert(
  setCheck([seed], {
    ...analytic,
    revealGroups: [{ entityIds: ["peak", "velocity"] }],
  }).length > 0,
  "hidden path does not satisfy cross-lane requirement",
);
assert.deepEqual(
  setCheck([endpointSeed], endpointRepair),
  [],
  "cross-lane check does not union helper entities",
);
assert.deepEqual(seed, scene(), "inputs unchanged");
console.log(
  "yield-repair: role rephrasing, construction semantics, endpoints, named-point and cross-lane trajectory guards passed",
);

const duplicateRoleSeed = clone(endpointSeed);
(duplicateRoleSeed.entities as Document[])[1]!.role = "wall base";
duplicateRoleSeed.requiredEntityIds = ["a", "b", "wall"];
const renamedPoint = clone(endpointRepair);
(renamedPoint.entities as Document[])[0]!.id = "renamed";
(renamedPoint.entities as Document[])[0]!.role = "wall base";
(renamedPoint.constructions as Document[])[0]!.outputs = ["renamed"];
(renamedPoint.constructions as Document[])[2]!.inputs = {
  start: "renamed",
  end: "b",
};
assert(
  repair.validateRepairSurvivorship(duplicateRoleSeed, renamedPoint).length > 0,
  "ambiguous renamed point cannot discharge multiple obligations",
);
const twoPaths = clone(seed);
(twoPaths.entities as Document[]).push({
  id: "other",
  kind: "curve",
  role: "other motion",
});
(twoPaths.constructions as Document[]).push({
  operator: "constant_acceleration_trajectory",
  inputs: {},
  outputs: ["other"],
});
(twoPaths.requiredEntityIds as string[]).push("other");
assert(
  setCheck([twoPaths, seed], analytic).length > 0,
  "cross-lane maximum path multiplicity is preserved",
);

const fakePath = clone(analytic);
(fakePath.entities as Document[])[0]!.role = "ground";
assert(
  setCheck([seed], fakePath).length > 0,
  "an analytic ground line is not a retained motion path",
);
