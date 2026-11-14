import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inspectPlaygroundLecture, parsePlaygroundReview, figureCount, type PlaygroundLecture } from "../../lib/admin/playgroundLecture";
import { indexPlaygroundRecordings, mergePlaygroundRecordings } from "../../features/admin/lib/playgroundBoards";
import { QuestionTags } from "../../features/admin/components/QuestionTags";
import { TopicRow } from "../../features/admin/components/TopicRow";
import { UnitSection } from "../../features/admin/components/UnitSection";
Object.defineProperty(globalThis, "React", { value: React, configurable: true });

const segment = { narration: "Work equals force times distance.", spokenText: "Work equals force times distance.", audioUrl: "/api/audio/clip", durationMs: 2000, command: { type: "WRITE", text: "W = Fd", params: [], charPosition: 0, narrationBefore: "" } };
const turn = { status: "complete", kind: "lesson", rawResponse: "A complete worked explanation.", visualStatus: "text_only", segments: [segment] };
assert.equal(inspectPlaygroundLecture([]).complete, false);
for (const status of ["live", "stopped", undefined]) assert.equal(inspectPlaygroundLecture([{ ...turn, status }]).complete, false);
for (const bad of [{ ...segment, audioUrl: null }, { ...segment, durationMs: 0 }, { ...segment, command: null }]) {
  assert.equal(inspectPlaygroundLecture([{ ...turn, segments: [bad] }]).complete, false, "missing audio/timing/notes must not complete");
}
assert.equal(inspectPlaygroundLecture([{ ...turn, segments: [segment, { ...segment, audioUrl: null }] }]).complete, false, "one saved clip cannot stand for full narration");
assert.deepEqual(inspectPlaygroundLecture([turn]), { complete: true, figure: "without-figure" });
const figure = { ...segment, command: { trustedDiagramGeometry: true, commands: [{ ...segment.command, type: "DRAW_LINE" }] } };
assert.deepEqual(inspectPlaygroundLecture([{ ...turn, visualStatus: "validated", segments: [segment, figure] }]), { complete: true, figure: "with-figure" });
assert.deepEqual(inspectPlaygroundLecture([{ ...turn, segments: [segment, { ...figure, command: { ...figure.command, trustedDiagramGeometry: false } }] }]), { complete: true, figure: "without-figure" }, "untrusted ink is not engine coverage");
assert.deepEqual(inspectPlaygroundLecture([{ ...turn, visualStatus: "retry_required", segments: [segment, figure] }]), { complete: true, figure: "without-figure" });
assert.deepEqual(inspectPlaygroundLecture([{ ...turn, segments: [segment, { ...figure, command: { ...figure.command, commands: [{ ...segment.command, type: "DRAW_PICTURE" }] } }] }]), { complete: true, figure: "reference-picture" });

const lecture: PlaygroundLecture = { topicId: "physics|1|work", difficulty: "easy", state: "complete", figure: "with-figure" };
const good = { id: "good", title: "Work", preview: "Question", createdAt: 1, playground: lecture };
const partial = { ...good, id: "partial", createdAt: 2, playground: { ...lecture, state: "discarded" as const } };
assert.equal(indexPlaygroundRecordings([partial, good]).get("physics|1|work::easy")?.id, "good", "newer partial cannot replace complete recording");
assert.equal(indexPlaygroundRecordings([{ ...good, playground: null }]).size, 0, "preview without completion evidence is hidden");
assert.equal(mergePlaygroundRecordings([partial, good], [{ ...lecture, boardId: "partial", status: "failed", question: "Question" }], new Set()).get("physics|1|work::easy")?.id, "good");
assert.equal(figureCount([lecture, { ...lecture, figure: "without-figure" }, { ...lecture, figure: "reference-picture" }, partial.playground, undefined]), 1);

const review = { stars: null, figure: "not-drawn", tags: [], feedback: "No diagram visible", skipped: false };
assert.deepEqual(parsePlaygroundReview(review), review, "diagram feedback does not require stars");
assert.equal(parsePlaygroundReview({ ...review, stars: 6 }), null);
assert.equal(parsePlaygroundReview({ ...review, tags: ["arbitrary"] }), null);
assert.equal(parsePlaygroundReview({ ...review, feedback: "x".repeat(1001) }), null);
assert.equal(parsePlaygroundReview({ ...review, figure: "__proto__" }), null);
assert.equal(parsePlaygroundReview({ ...review, stars: 5, skipped: true })?.skipped, true);

const html = renderToStaticMarkup(<QuestionTags lecture={{ ...lecture, review: { ...review, figure: "not-drawn" } }} cost={{ llmUsd: 0.02, ttsUsd: 0.01, totalUsd: 0.03, inputTokens: 100, outputTokens: 50, observations: 1 }} />);
assert(html.includes("With figure") && html.includes("Manual: ") && html.includes("Diagram not drawn"), "automatic detection and manual feedback stay distinct");
assert(html.includes("150 tokens") && html.includes("Video + notes ready"));
const noCost = renderToStaticMarkup(<QuestionTags lecture={lecture} />);
assert(noCost.includes("AI usage pending") && !noCost.includes("$0"), "unknown AI usage must not appear free");
const item = { id: lecture.topicId, text: "Work", subject: "physics" as const, unitNumber: 1, unitTitle: "Mechanics", tags: [] };
const row = renderToStaticMarkup(<TopicRow item={item} probes={[{ id: "q", topicId: item.id, difficulty: "easy", question: "Find the work" }]} states={{ easy: "recorded", medium: "missing", hard: "missing" }} boardIds={{ easy: "good" }} lecturesByBoardId={new Map([["good", lecture]])} costsByBoardId={{}} checked={false} status="pending" selecting={false} selectedIds={new Set()} expanded onToggleSelected={() => {}} onToggleExpanded={() => {}} onOpenSheet={() => {}} onActivate={() => {}} onNotes={() => {}} onDelete={() => {}} />);
assert(row.includes("Review") && row.includes("Figures drawn: 1 of 1") && row.includes("With figure"));
const chapter = renderToStaticMarkup(<UnitSection number={1} title="Mechanics" tags={[]} summary={{ shown: 1, total: 1, possible: 3, recorded: 1, running: 0, accepted: 0, figures: 1 }} expanded={false} onToggleExpanded={() => {}} selecting={false} allSelected={false} someSelected={false} selectableCount={3} onToggleSelected={() => {}} deletableCount={0} onDeleteLectures={() => {}}>hidden questions</UnitSection>);
assert(chapter.includes("Figures drawn: 1 of 3") && !chapter.includes("hidden questions"), "collapsed chapters expose the full denominator");
console.log("verify-playground-recordings: complete audio + notes, partial exclusion, figure evidence, optional reviews and collapsed counts passed");
