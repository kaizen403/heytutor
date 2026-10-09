import assert from "node:assert/strict";
import {
  buildTopicCoverageReport,
  type TopicCoverageRow,
} from "../lecture-lab/topicCoverageReport";

const rows: TopicCoverageRow[] = [
  {
    id: "physics|10|wave|q1",
    topicId: "physics|10|wave",
    subject: "physics",
    chapter: "physics|10",
    figureNeed: "required",
    figureKind: "wave",
    verdict: "right",
    emptyCause: null,
    candidateErrorCodes: [],
    suppressedSource: null,
  },
  {
    id: "physics|10|spring|q1",
    topicId: "physics|10|spring",
    subject: "physics",
    chapter: "physics|10",
    figureNeed: "required",
    figureKind: "vectors_fbd",
    verdict: "partial",
    emptyCause: null,
    candidateErrorCodes: [],
    suppressedSource: null,
  },
  {
    id: "maths|3|matrix|q1",
    topicId: "maths|3|matrix",
    subject: "maths",
    chapter: "maths|3",
    figureNeed: "required",
    figureKind: "chart_table",
    verdict: "empty_bad",
    emptyCause: "candidates_invalid",
    candidateErrorCodes: ["invalid_id", "invalid_id"],
    suppressedSource: null,
  },
  {
    id: "maths|3|relation|q1",
    topicId: "maths|3|relation",
    subject: "maths",
    chapter: "maths|3",
    figureNeed: "optional",
    figureKind: "geometry",
    verdict: "empty_ok",
    emptyCause: "planner_no_output",
    candidateErrorCodes: [],
    suppressedSource: null,
  },
];

const report = buildTopicCoverageReport(rows);
assert.deepEqual(report.chapters, [
  { chapter: "maths|3", topicsTested: 2, right: 0, partial: 0, wrong: 0, empty: 2, usefulShare: 0 },
  { chapter: "physics|10", topicsTested: 2, right: 1, partial: 1, wrong: 0, empty: 0, usefulShare: 1 },
]);
assert.equal(report.failureGroups.wrongStructureExample.count, 1);
assert.equal(report.failureGroups.plannerDeclinedOrInvalid.count, 1);
assert.deepEqual(report.failureGroups.plannerDeclinedOrInvalid.topErrorCodes, { invalid_id: 1 });
assert.deepEqual(report.failureGroups.plannerDeclinedOrInvalid.missingDrawingKinds, { chart_table: 1 });
assert.equal(report.failureGroups.nothingHonestToDraw.count, 1);

console.log("topic coverage report verification passed");
