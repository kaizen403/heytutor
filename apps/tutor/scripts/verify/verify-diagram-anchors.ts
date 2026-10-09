import assert from "node:assert/strict";
import {
  anchorAgreement,
  anchorReferenceDescription,
  parseDiagramAnchors,
} from "../lecture-lab/anchors";

const result = anchorAgreement([
  { id: "a", verdict: "right", markedBy: "codex-reference" },
  { id: "b", verdict: "partial", markedBy: "codex-reference" },
  { id: "c", verdict: "wrong", markedBy: "codex-reference" },
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
assert.deepEqual(result.markedBy, ["codex-reference"]);
assert.equal(
  anchorReferenceDescription(result.markedBy),
  "agreement with Codex reference anchors (judge consistency between sessions, not human accuracy)",
);

const common = {
  rowId: "row",
  arm: "current",
  subject: "physics",
  question: "private fixture question",
  figureNeed: "required",
  figureKind: "vectors_fbd",
  mustShow: [],
  mustLabel: [],
  mustNotShow: [],
  figurePath: "anchor-images/a.png",
  figureSha256: "a".repeat(64),
  note: "",
};
assert.deepEqual(
  parseDiagramAnchors([
    JSON.stringify({ ...common, id: "owner", verdict: "right", markedBy: "owner" }),
    JSON.stringify({ ...common, id: "codex", verdict: "partial", markedBy: "codex-reference" }),
  ].join("\n")).map((anchor) => anchor.markedBy),
  ["owner", "codex-reference"],
);
assert.throws(
  () => parseDiagramAnchors(JSON.stringify({
    ...common,
    id: "unknown",
    verdict: "wrong",
    markedBy: "unreviewed",
  })),
  /markedBy must be owner or codex-reference/,
);
console.log("diagram anchor agreement verification passed");
