import {
  DrawTransactionRegistry,
  type DrawTransactionNode,
} from "../src/drawTransactionRegistry";

class MockNode implements DrawTransactionNode {
  readonly attrs = new Map<string, unknown>();
  destroyed = false;

  getAttr(name: string): unknown {
    return this.attrs.get(name);
  }

  setAttr(name: string, value: unknown): void {
    if (value === undefined) this.attrs.delete(name);
    else this.attrs.set(name, value);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const committedRegistry = new DrawTransactionRegistry();
const committedId = committedRegistry.begin();
const committedNode = new MockNode();
assert(committedRegistry.track(committedNode), "active transaction must accept a node");
assert(committedNode.getAttr("htDrawTransactionId") === committedId, "node ownership was not stamped");
committedRegistry.commit(committedId);
assert(!committedNode.destroyed, "commit must preserve owned ink");
assert(committedNode.getAttr("htDrawTransactionId") === undefined, "commit must release node ownership");

const abortedRegistry = new DrawTransactionRegistry();
const abortedId = abortedRegistry.begin();
const first = new MockNode();
const unrelated = new MockNode();
assert(abortedRegistry.track(first), "active transaction must accept first node");
const destroyed = abortedRegistry.abort(abortedId);
assert(first.destroyed && destroyed.has(first), "abort must destroy every owned node");
assert(!unrelated.destroyed, "abort must not touch nodes outside the transaction");

const lateNode = new MockNode();
lateNode.setAttr("htDrawTransactionId", abortedId);
assert(!abortedRegistry.track(lateNode), "late callback must not resurrect aborted ink");
assert(lateNode.destroyed, "late callback node must be destroyed immediately");
abortedRegistry.finishAborted(abortedId);

const nestedRegistry = new DrawTransactionRegistry();
nestedRegistry.begin();
let nestedRejected = false;
try {
  nestedRegistry.begin();
} catch {
  nestedRejected = true;
}
assert(nestedRejected, "overlapping canvas transactions must be rejected");

console.log("draw transaction verification passed");
