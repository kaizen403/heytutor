import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionTags } from "../../features/admin/components/QuestionTags";
import { TopicRow } from "../../features/admin/components/TopicRow";
import { UnitSection } from "../../features/admin/components/UnitSection";
import { LectureUsage } from "../../features/admin/components/LectureUsage";
import type { PlaygroundLecture } from "../../lib/admin/playgroundLecture";
import { emptyRunCostSession } from "../../lib/obs/runCost";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });
const lecture: PlaygroundLecture = { topicId: "physics|15|waves", difficulty: "easy", state: "complete", figure: "without-figure" };
const cost = { ...emptyRunCostSession("board"), observations: 2, inputTokens: 100, outputTokens: 50, characters: 1000, llmUsd: 0.02, ttsUsd: 0.05, totalUsd: 0.07 };
const tags = renderToStaticMarkup(<QuestionTags lecture={lecture} cost={cost} />);
assert(tags.includes("AI") && tags.includes("$0.02"));
assert(tags.includes("Voice") && tags.includes("$0.05"), "each lecture shows its voice usage alongside AI");
assert(tags.includes("150 tokens") && tags.includes("1,000 characters"), "both usage quantities are visible");
const missing = renderToStaticMarkup(<QuestionTags lecture={lecture} />);
assert(missing.includes("AI usage pending") && missing.includes("Voice usage pending"), "missing usage remains visible for both streams");
const aiOnly = renderToStaticMarkup(<QuestionTags lecture={lecture} cost={{ ...cost, characters: 0, ttsUsd: 0 }} />);
assert(aiOnly.includes("Voice usage pending"), "AI arriving first cannot make unreported voice look free");

const topicProps = {
  figures: 0, item: { id: lecture.topicId, text: "Waves", subject: "physics" as const, unitNumber: 15, unitTitle: "Electromagnetic Waves", tags: [] },
  probes: ["easy", "medium"].map(difficulty => ({ id: difficulty, topicId: lecture.topicId, difficulty: difficulty as "easy" | "medium", question: "Explain waves" })),
  states: { easy: "recorded" as const, medium: "recorded" as const, hard: "missing" as const },
  boardIds: { easy: "board", medium: "missing" }, costsByBoardId: { board: cost },
  checked: false, status: "pending" as const, selecting: false, selectedIds: new Set<string>(), expanded: false,
  onToggleSelected() {}, onToggleExpanded() {}, onOpenSheet() {}, onActivate() {}, onNotes() {}, onDelete() {},
};
const topic = renderToStaticMarkup(<TopicRow {...topicProps} />);
assert(topic.includes("AI") && topic.includes("Voice"), "collapsed topics expose the split without hovering");
assert(topic.includes("1/2"), "partial totals disclose missing lecture usage");
const noTopicCosts = renderToStaticMarkup(<TopicRow {...topicProps} costsByBoardId={{}} />);
assert(noTopicCosts.includes("usage pending"), "a recorded topic never silently drops its usage");
const chapter = renderToStaticMarkup(<UnitSection number={15} title="Electromagnetic Waves" tags={[]} summary={{ shown: 1, total: 8, possible: 24, recorded: 24, running: 0, accepted: 0 }} costs={[cost, cost]} expanded={false} onToggleExpanded={() => {}} selecting={false} allSelected={false} someSelected={false} selectableCount={0} onToggleSelected={() => {}} deletableCount={0} onDeleteLectures={() => {}}>hidden</UnitSection>);
assert(chapter.includes("AI $0.04") && chapter.includes("Voice $0.1"), "collapsed chapter totals sum both streams across lectures");
assert(!chapter.includes(">hidden<"));
const unavailable = renderToStaticMarkup(<LectureUsage costs={[undefined]} states={["unavailable"]} />);
assert(unavailable.includes("AI usage unavailable") && unavailable.includes("Voice usage unavailable"));
const unconfigured = renderToStaticMarkup(<LectureUsage costs={[undefined]} states={["unconfigured"]} />);
assert(unconfigured.includes("usage not configured"));
const zero = renderToStaticMarkup(<LectureUsage costs={[{ ...cost, llmUsd: 0, ttsUsd: 0, totalUsd: 0 }]} />);
assert(zero.includes("AI $0") && zero.includes("Voice $0"), "measured zero usage costs remain visible");
console.log("verify-playground-usage: lecture AI + voice, missing voice, partial topic totals passed");
