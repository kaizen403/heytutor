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

const beatRegistry = new DrawTransactionRegistry<MockNode>();
const work = new MockNode();
beatRegistry.track(work);
const introId = beatRegistry.begin();
const previousBeat = new MockNode();
beatRegistry.track(previousBeat);
const beatOrigin = beatRegistry.savepoint(introId);
const partialBeat = new MockNode();
beatRegistry.track(partialBeat);
const removed = beatRegistry.rollback(introId, beatOrigin);
assert(removed.has(partialBeat) && partialBeat.destroyed, "rollback removes interrupted beat ink");
assert(!previousBeat.destroyed && !work.destroyed, "savepoint preserves completed beats and work");
assert(!beatRegistry.track(partialBeat), "late re-tracking cannot revive a removed generation");
const restartedBeat = new MockNode();
assert(beatRegistry.track(restartedBeat), "restarted execution owns new nodes");
beatRegistry.rollback(introId, beatOrigin);
assert(restartedBeat.destroyed, "repeated Pause rolls back the replay, not an earlier beat");
const finalBeat = new MockNode();
beatRegistry.track(finalBeat);
const nextOrigin = beatRegistry.savepoint(introId);
let staleRejected = false;
try { beatRegistry.rollback(introId, beatOrigin); } catch { staleRejected = true; }
assert(staleRejected && !finalBeat.destroyed, "stale beat cannot roll back its successor");
beatRegistry.rollback(introId, nextOrigin);
beatRegistry.commit(introId);
assert(!previousBeat.destroyed && !finalBeat.destroyed, "atomic commit keeps completed beat nodes");

const scopedRegistry = new DrawTransactionRegistry<MockNode>();
const scopedRoot = scopedRegistry.begin();
const firstScope = scopedRegistry.savepoint(scopedRoot);
const priorOwnership = scopedRegistry.capture();
const priorInk = new MockNode(); scopedRegistry.track(priorInk, priorOwnership);
const nextScope = scopedRegistry.savepoint(scopedRoot);
assert(scopedRegistry.status(priorOwnership) === "retired", "a new beat checkpoint retires old command capabilities without deleting completed prior ink");
assert(!priorInk.destroyed, "new beat checkpoint preserves earlier beat nodes");
let oldCancelRejected = false;
try { scopedRegistry.cancel(scopedRoot, firstScope); } catch { oldCancelRejected = true; }
assert(oldCancelRejected, "a stale beat cannot cancel a successor scope");
const nextOwnership = scopedRegistry.capture(); scopedRegistry.cancel(scopedRoot, nextScope);
assert(scopedRegistry.status(nextOwnership) === "retired", "scoped cancel retires captured current commands");
scopedRegistry.rollback(scopedRoot, nextScope);
assert(!priorInk.destroyed, "rollback of the next beat preserves earlier ink");
scopedRegistry.commit(scopedRoot);

console.log("draw transaction verification passed");
