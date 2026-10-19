import assert from "node:assert/strict";
import { createProjectionMetrics, projectionMetrics, SPACE_PROJECTION_CANDIDATES, type SpaceViewConstraints } from "../../src/math/spaceCamera";

for (let sample = 1; sample <= 12; sample++) {
  const constraints: SpaceViewConstraints = {
    axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    directions: [{ x: sample, y: 2, z: -3 }, { x: -sample, y: -2, z: 3 }],
    meetings: [[{ x: sample, y: 2, z: -3 }, { x: 1, y: -sample, z: 2 }]],
    faces: [{ x: 1, y: sample, z: -1 }],
    points: [{ x: 0, y: 0, z: 0 }, { x: sample, y: 2, z: -1 }, { x: 2, y: 1, z: sample }],
    pointGroups: [[{ x: 1, y: 2, z: 3 }, { x: 3, y: 2, z: 1 }]],
    pointTolerance: 1e-8,
  };
  let reads = 0;
  const measured = { ...constraints, get axes() { reads++; return constraints.axes; } };
  const metricsFor = createProjectionMetrics(measured);
  assert.equal(reads, 1, "constraint preparation occurs once before scoring");
  for (const projection of SPACE_PROJECTION_CANDIDATES) {
    assert.deepEqual(metricsFor(projection), projectionMetrics(projection, constraints), "prepared scores, floors and diagnostic order are exact");
  }
  assert.equal(reads, 1, "candidate views reuse the prepared constraints");
  // No cross-call identity cache: changes are visible to the next preparation.
  const changed = { ...constraints, directions: [{ x: 1, y: 1, z: sample }] };
  const next = createProjectionMetrics(changed);
  for (const projection of SPACE_PROJECTION_CANDIDATES) assert.deepEqual(next(projection), projectionMetrics(projection, changed));
}
console.log("camera metrics: exact scores for all views; one preparation per scoring pass");

const neutralScore = createProjectionMetrics({
  axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
  directions: [], meetings: [], faces: [], points: [],
});
const originalFixed = Number.prototype.toFixed;
let formatted = 0;
try {
  Number.prototype.toFixed = function (digits?: number) { formatted++; return originalFixed.call(this, digits); };
  assert.equal(neutralScore(SPACE_PROJECTION_CANDIDATES[0]!).worst, "none");
  assert.equal(formatted, 0, "non-limiting constraints do not format unused diagnostics");
} finally {
  Number.prototype.toFixed = originalFixed;
}
