import assert from "node:assert/strict";
import { TraceTagRegistry } from "../../lib/obs/traceTags";

const registry = new TraceTagRegistry(2, 100);
assert.deepEqual(registry.remember("scoped-user-a", ["mock", "diagram-strategy-assigned:strict"], 0), ["mock", "diagram-strategy-assigned:strict"]);
assert.deepEqual(registry.appendKnown("scoped-user-a", ["diagram-strategy:current"], 1),
  ["mock", "diagram-strategy-assigned:strict", "diagram-strategy:current"]);
assert.deepEqual(registry.remember("scoped-user-a", ["diagram-strategy-assigned:strict"], 2),
  ["mock", "diagram-strategy-assigned:strict", "diagram-strategy:current"]);
assert.deepEqual(registry.appendKnown("scoped-user-a", ["diagram-strategy:strict"], 3),
  ["mock", "diagram-strategy-assigned:strict", "diagram-strategy:strict"],
  "a final effective strategy replaces its provisional label, preserving assignment and mock tags");
assert.deepEqual(registry.appendKnown("scoped-user-a", ["diagram-strategy:current"], 4),
  ["mock", "diagram-strategy-assigned:strict", "diagram-strategy:current"],
  "effective strategy replacement also works in the other direction");
assert.equal(registry.appendKnown("scoped-user-b", ["diagram-strategy:strict"], 2), undefined,
  "cold/other-actor updates must omit tags rather than replace unknown server tags");
assert.equal(registry.appendKnown("scoped-user-a", ["diagram-strategy:strict"], 105), undefined,
  "expired state must fail closed without erasing remote tags");
registry.remember("one", ["mock"], 110);
registry.remember("two", ["mock"], 111);
registry.remember("three", ["mock"], 112);
assert.equal(registry.appendKnown("one", ["outcome"], 113), undefined, "tag memory is bounded");
console.log("trace tags preserve assignment/mock and fail closed on cold state (offline)");
