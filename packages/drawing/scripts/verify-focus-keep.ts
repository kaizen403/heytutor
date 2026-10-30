import assert from "node:assert/strict";
import { focusEmphasisOf, focusKeepsMark, parseFocusSpec, withoutFocusKeep } from "../src/protocol/semanticGesture";
import type { DrawCommand } from "../src/protocol/drawingProtocol";

// The FOCUS grammar: `[FOCUS:<id>(,<id>)*(|<modifier>)*]`, modifiers in any
// order and case, first emphasis wins, `keep` combines with any emphasis.

assert.deepEqual(parseFocusSpec("block|pulse|keep"), { targetIds: ["block"], emphasis: "pulse", keep: true },
  "id|pulse|keep must keep both modifiers");
assert.deepEqual(parseFocusSpec("block|keep|pulse"), { targetIds: ["block"], emphasis: "pulse", keep: true },
  "modifier order must not matter");
assert.deepEqual(parseFocusSpec("block|KEEP"), { targetIds: ["block"], emphasis: "trace", keep: true },
  "id|keep is a trace followed by a kept ring; modifiers are case free");
assert.deepEqual(parseFocusSpec("a,b|spotlight|pulse"), { targetIds: ["a", "b"], emphasis: "spotlight", keep: false },
  "the first emphasis modifier wins");
assert.deepEqual(parseFocusSpec("a|wobble|dim|keep"), { targetIds: ["a"], emphasis: "spotlight", keep: true },
  "an unknown modifier is ignored and the next emphasis still counts");
assert.deepEqual(parseFocusSpec("a| Pulse "), { targetIds: ["a"], emphasis: "pulse", keep: false });
assert.deepEqual(parseFocusSpec("a"), { targetIds: ["a"], emphasis: "trace", keep: false });
assert.deepEqual(parseFocusSpec(""), { targetIds: [], emphasis: "trace", keep: false });
assert.deepEqual(parseFocusSpec("a|group|keep"), { targetIds: ["a"], emphasis: "trace", keep: true });

const kept: DrawCommand = { type: "FOCUS", params: [], text: "block|pulse|keep", semanticRef: { entityId: "block|keep|pulse" } };
assert.equal(focusKeepsMark(kept), true);
assert.equal(focusEmphasisOf(kept), "pulse", "semanticRef text decodes with the list parse too");
assert.equal(focusKeepsMark({ type: "FOCUS", params: [], text: "block|pulse" }), false);
assert.equal(focusKeepsMark({ type: "ANNOTATE", params: [], text: "block|keep" }), false, "keep belongs to FOCUS only");

const stripped = withoutFocusKeep(kept);
assert.equal(stripped.text, "block|pulse");
assert.equal(stripped.semanticRef?.entityId, "block|pulse");
assert.equal(focusKeepsMark(stripped), false);
assert.equal(focusEmphasisOf(stripped), "pulse", "stripping keep must not change the emphasis");
assert.equal(kept.text, "block|pulse|keep", "withoutFocusKeep must not mutate its input");
const plain: DrawCommand = { type: "FOCUS", params: [], text: "a|spotlight" };
assert.equal(withoutFocusKeep(plain), plain, "a command without keep is returned as is");
assert.equal(withoutFocusKeep({ type: "FOCUS", params: [], text: "a,b|keep" }).text, "a,b");

console.log("verified FOCUS modifier list: order free, first emphasis wins, keep combines, unknown ignored");
