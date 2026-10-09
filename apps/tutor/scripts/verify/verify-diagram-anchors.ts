import assert from "node:assert/strict";
import { anchorAgreement } from "../lecture-lab/anchors";

const result = anchorAgreement([
  { id: "a", verdict: "right" },
  { id: "b", verdict: "partial" },
  { id: "c", verdict: "wrong" },
], [
  { id: "a", verdict: "right" },
  { id: "b", verdict: "wrong" },
]);
assert.equal(result.total, 3);
assert.equal(result.compared, 2);
assert.equal(result.agreed, 1);
assert.equal(result.agreement, 0.5);
assert.deepEqual(result.missing, ["c"]);
assert.deepEqual(result.confusion, { "right->right": 1, "partial->wrong": 1 });
console.log("diagram anchor agreement verification passed");
