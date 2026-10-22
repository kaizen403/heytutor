import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument } from "../../src/index";

// A malformed extra point must not escape the ownership refusal by crashing
// helper-role classification. Exercise the public compiler with raw role data.
const base = buildLinearSourceDocument("Represent x < 0 on a number line.");
assert(base);
assert(compileSceneDocument(base).ok);

for (const role of [undefined, null, 42]) {
  const candidate = structuredClone(base);
  const point = { id: "extra", kind: "point" as const, role: "point" };
  if (role === undefined) Reflect.deleteProperty(point, "role");
  else Reflect.set(point, "role", role);
  candidate.entities.push(point);
  candidate.constructions.push({
    id: "make_extra", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["extra"],
  });
  candidate.requiredEntityIds.push("extra");
  const before = JSON.stringify(candidate);
  const result = compileSceneDocument(candidate);
  assert.equal(result.ok, false, "an unowned extra point must remain invalid");
  assert.equal(result.renderScene, null, "refusal must emit no partial ink");
  assert(result.report.issues.some(issue => issue.severity === "fatal"));
  assert.equal(JSON.stringify(candidate), before, "validation must not repair or mutate the input");
}

console.log("linear invalid point roles: 3 malformed candidates refuse atomically without mutation");
