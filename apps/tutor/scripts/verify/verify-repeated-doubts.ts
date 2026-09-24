import assert from "node:assert/strict";
import { getSegmentCommands, type TutorSegment } from "@heytutor/drawing";
import { doubtSegment } from "../../features/tutor-session/lib/turn/doubtTurn";
import { commitWorkRowInk, resolveVisibleEmphasisRow, workColumnRows } from "../../features/tutor-session/lib/board/boardLayout";
import { collectMarkCandidates } from "../../features/tutor-session/lib/board/boardMarking";
import { attachTraceToGrant, createLessonGrant, resetTurnGrantsForTests } from "../../lib/billing/grant";

// The second doubt in the 24 Sep cone lesson called the integral the "last row"
// while asking to emphasize w5, which held an earlier sum-of-slices line.
const mistakenPoint: TutorSegment = {
  narration: "look at the last row on the board, v equals the integral from zero to h of a of z d z.",
  command: { type: "EMPHASIZE", text: "w5", params: [], charPosition: 0, narrationBefore: "" },
};
const rows = [
  { workId: "w5", text: "V = sum of slice areas" },
  { workId: "w6", text: "V = ∫_(0)^(h) A(z) dz" },
];
const safePoint = doubtSegment(mistakenPoint, { codePanelShowing: false, boardRows: rows });
assert(safePoint, "the answer must keep its explanation when a gesture is unsafe");
assert.equal(getSegmentCommands(safePoint).length, 0, "a doubt must not highlight a row it did not identify correctly");
const groundedPoint = doubtSegment({
  ...mistakenPoint,
  command: { ...mistakenPoint.command!, text: "w6|V = ∫_(0)^(h) A(z) dz" },
}, { codePanelShowing: false, boardRows: rows });
assert.equal(getSegmentCommands(groundedPoint!).length, 1, "the exact visible row may still be boxed");

// A pending WRITE reserves layout before its animation. The next doubt must
// not be told that reservation is visible ink.
const layout = { nextY: 500, rects: [
  { x: 90, y: 145, width: 250, height: 36, text: "V = sum of slice areas", workId: "w5", workIndex: 5 },
  { x: 90, y: 211, width: 250, height: 36, text: "V = ∫_(0)^(h) A(z) dz", workId: "w6", workIndex: 6, pendingInk: true },
] };
assert.deepEqual(workColumnRows(layout).map((row) => row.workId), ["w5"], "unwritten reservations stay out of doubt context");
assert.deepEqual(collectMarkCandidates(layout.rects, null).map((row) => row.workId), ["w5"], "a mark cannot select unwritten ink");
assert.equal(resolveVisibleEmphasisRow("w6|V = ∫_(0)^(h) A(z) dz", layout.rects), null, "pending ink cannot be highlighted");
commitWorkRowInk(layout, "V = ∫_(0)^(h) A(z) dz", 90, 211);
assert.deepEqual(workColumnRows(layout).map((row) => row.workId), ["w5", "w6"], "finished ink enters doubt context");
assert.equal(resolveVisibleEmphasisRow("w6|V = ∫_(0)^(h) A(z) dz", layout.rects)?.workId, "w6");
assert.equal(resolveVisibleEmphasisRow("w5|V = ∫_(0)^(h) A(z) dz", layout.rects), null, "a reused or mismatched id cannot box another row");

resetTurnGrantsForTests();
const lesson = createLessonGrant({ userId: "many-doubts", traceId: "lesson" });
assert(lesson.ok, "the lesson grant starts");
for (let index = 0; index < 12; index++) {
  assert(attachTraceToGrant("many-doubts", `doubt-${index}`).ok, `doubt ${index + 1} should remain available`);
}
resetTurnGrantsForTests();

console.log("repeated doubt regression passed");
