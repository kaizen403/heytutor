import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { applyJudgments } from "../lecture-lab/judge-apply";
import { prepareJudgingRound } from "../lecture-lab/judge-prep";
import { correctedEmptyCauseForStoredRun } from "../lecture-lab/regrade-empty-causes";
import { regradeStrictSuppression } from "../lecture-lab/regrade-strict-suppression";
import { gradeLecture } from "../lecture-lab/grade";
import { summarize } from "../lecture-lab/summarize";
import { readGalleryEntries } from "../lecture-lab/gallery";
import { readRoundJudgments, ruleJudgmentForNoFigure, type DiagramJudgment } from "../lecture-lab/judging";
import type { LectureRun } from "../lecture-lab/lecturePipeline";
import type { DiagramEvalRow } from "../lecture-lab/diagramEval";

// Every question and image below is a generated synthetic fixture. Never read
// private rounds or anchors, and make any accidental remote request fail closed.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("judging regression verifier forbids model/network calls"); };
const directory = mkdtempSync(join(tmpdir(), "heytutor-lab-judging-"));
const failures: string[] = [];

function check(name: string, verify: () => void): void {
  try {
    verify();
    console.log(`PASS: ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${detail}`);
    console.error(`FAIL: ${name}: ${detail}`);
  }
}

function syntheticBoardPng(): Buffer {
  const chunk = (type: string, payload: Buffer): Buffer => {
    const data = Buffer.concat([Buffer.from(type), payload]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(payload.length);
    const suffix = Buffer.alloc(4);
    suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, data, suffix]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1200, 0);
  header.writeUInt32BE(700, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((1200 * 3 + 1) * 700, 255);
  for (let y = 0; y < 700; y += 1) pixels[y * (1200 * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fixture(id: string, drawn: boolean, need: DiagramEvalRow["figure_need"] = "required"): LectureRun & { evaluation: DiagramEvalRow } {
  const question = `Explain the synthetic labeled segment ${id}.`;
  const speech = "The segment connects A to B. Its length is one unit.";
  const rawText = `[STEP]${speech} [WRITE: L = 1] [/STEP]`;
  return {
    probeId: id, topicId: "authored|1|synthetic", unitId: "authored|1", difficulty: "easy", question,
    familiarity: "normal", arm: "planner_examples_strict", figureOnly: false,
    startedAt: "2000-01-01T00:00:00.000Z", error: null, isDsa: false,
    timings: { planMs: 10, teachMs: 10, totalMs: 20, figureCommitMs: drawn ? 10 : null },
    plan: {
      visualRequirement: need, requiresVisualByStem: need === "required", givens: [], unknowns: [],
      derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
    },
    solver: null,
    diagram: {
      plannerDeclineReason: null, plannerDeclines: [], rejectedOperatorCalls: [],
      committed: drawn, declinedUnreadable: false, emptyCause: drawn ? null : "planner_no_output",
      tier: drawn ? "qualitative_verified" : null, nonMetric: true,
      figureSource: drawn ? "source_grounded" : "text_only", reason: null,
      archetypeId: null, family: "synthetic_segment", entityIds: drawn ? ["A", "B", "segment"] : [],
      focusableIds: [], labels: [], annotations: [], renderedLabels: drawn ? ["A", "B"] : [],
      labelByEntity: drawn ? { A: "A", B: "B" } : {}, primitiveCount: drawn ? 3 : 0, assertionCount: 1,
      candidateErrorCodes: [], validationIssues: [], degradationReason: null,
      svg: drawn ? "frames/synthetic.svg" : null, png: drawn ? "frames/synthetic.png" : null,
    },
    lessonBudget: { scope: "short", minSteps: 1, maxSteps: 4, boardPages: 1 }, givenRows: [],
    teaching: {
      rawText, usedStepMarkers: true, unresolvedFocusIds: [],
      steps: [{ index: 1, speech, tags: [{ type: "WRITE", text: "L = 1", params: [] }] }],
      writes: [{ text: "L = 1", x: null, y: null }], focusIds: [], emphasizeTargets: [], annotateTargets: [],
      forbiddenTags: [], continuations: 0, incomplete: false, contentChars: rawText.length,
      reasoningChars: 0, ttftMs: 1,
    },
    promptChars: 0,
    evaluation: {
      id, topic_id: "authored|1|synthetic", subject: "maths", difficulty: "easy", question,
      source: { kind: "authored", ref: null }, figure_need: need, figure_kind: "segment",
      must_show: ["segment"], must_label: ["A", "B"], must_not_show: [], trap: null, notes: "Synthetic test only.",
    },
  };
}

function judgment(id: string): DiagramJudgment {
  return { id, verdict: "right", missing: [], wrong_items: [], confidence: 1, reason: "Synthetic segment is correct.", by: "codex-test" };
}

function jsonl(path: string, rows: readonly unknown[]): void {
  writeFileSync(path, rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");
}

function round(name: string, runs: readonly (LectureRun & { evaluation: DiagramEvalRow })[], verdicts: readonly DiagramJudgment[]): string {
  const path = join(directory, name);
  mkdirSync(join(path, "runs"), { recursive: true });
  mkdirSync(join(path, "frames"));
  for (const [index, run] of runs.entries()) writeFileSync(join(path, "runs", `${index}.json`), JSON.stringify(run));
  writeFileSync(join(path, "frames", "synthetic.png"), syntheticBoardPng());
  writeFileSync(join(path, "summary.json"), JSON.stringify(summarize(runs.map(gradeLecture), runs)));
  jsonl(join(path, "judgments.jsonl"), verdicts);
  jsonl(join(path, "judge-queue.jsonl"), runs.filter((run) => run.diagram.committed).map((run) => ({
    id: run.evaluation.id, cropped_png: join(path, "frames", "synthetic.png"), question: run.question,
    figure_need: run.evaluation.figure_need, must_show: [], must_not_show: [], missing_labels: [],
  })));
  return path;
}

try {
  check("applying all judgments completes a resumed round's judging status", () => {
    const path = round("completed-status", [fixture("drawn", true)], [judgment("drawn")]);
    const summaryPath = join(path, "summary.json");
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    summary.judgingStatus = { reviewedRows: 0, unreviewedRows: 1 };
    writeFileSync(summaryPath, JSON.stringify(summary));
    applyJudgments(path);
    assert.equal(JSON.parse(readFileSync(summaryPath, "utf8")).judgingStatus.unreviewedRows, 0);
  });
  check("preparing a judged round preserves completed figure verdicts", () => {
    const completed = judgment("drawn");
    const path = round("prepare", [fixture("drawn", true), fixture("absent", false)], [completed]);
    prepareJudgingRound(path);
    const verdicts = readRoundJudgments(path);
    assert.deepEqual(verdicts.find((entry) => entry.id === "drawn"), completed);
    assert.deepEqual(verdicts.find((entry) => entry.id === "absent"), ruleJudgmentForNoFigure("required", "absent"));
  });

  check("foreign judgment IDs are rejected without rewriting round outputs", () => {
    const path = round("foreign", [fixture("drawn", true)], [judgment("drawn"), judgment("another-round")]);
    const summary = readFileSync(join(path, "summary.json"), "utf8");
    assert.throws(() => applyJudgments(path), /foreign|unknown|unexpected|unmatched|not.*run|not.*round/i);
    assert.equal(readFileSync(join(path, "summary.json"), "utf8"), summary);
  });

  check("missing no-figure judgments are rejected even when every queue row was judged", () => {
    const path = round("missing-empty", [fixture("drawn", true), fixture("absent", false)], [judgment("drawn")]);
    const summary = readFileSync(join(path, "summary.json"), "utf8");
    assert.throws(() => applyJudgments(path), /missing.*absent/i);
    assert.equal(readFileSync(join(path, "summary.json"), "utf8"), summary);
  });

  check("historical candidate errors prove an attempted planner when call count is unknown", () => {
    const old = fixture("historical", false);
    old.diagram.candidateErrorCodes = ["construction.invalid_inputs"];
    // Old records have timings but omit stages.plannerCalls entirely.
    assert.equal(correctedEmptyCauseForStoredRun(old), "candidates_invalid");
  });

  check("a selected validated text-only result is a planner decline, not an earlier candidate failure", () => {
    const run = fixture("validated-decline", false);
    run.diagram = {
      ...run.diagram,
      plannerDeclined: true,
      candidateCount: 2,
      candidateErrorCodes: ["construction.invalid_inputs"],
    };
    assert.equal(correctedEmptyCauseForStoredRun(run), "planner_declined");
    assert.deepEqual(run.diagram.candidateErrorCodes, ["construction.invalid_inputs"]);
  });

  check("known zero-call runs remain not attempted", () => {
    assert.equal(correctedEmptyCauseForStoredRun({
      plan: { visualRequirement: "required" }, diagram: { committed: false, primitiveCount: 0, candidateErrorCodes: [] },
      timings: { planMs: 10, stages: { plannerCalls: 0, deadlineRemainingMs: 10_000 } },
    }), "not_attempted");
  });

  check("historical synthetic-only markers do not invent a decline for a dropped unlabelled scene", () => {
    const old = fixture("historical-ambiguous-empty", false);
    old.diagram.candidateErrorCodes = ["planner_declined_required_scene"];
    assert.equal(correctedEmptyCauseForStoredRun(old), "planner_no_output");
    assert.deepEqual(old.diagram.candidateErrorCodes, []);
    assert.equal(old.diagram.plannerDeclined, false);
    assert.equal(ruleJudgmentForNoFigure("required", old.evaluation.id).verdict, "empty_bad");
  });

  check("an invalid text-only response is not a validated planner decline", () => {
    const run = fixture("invalid-decline", false);
    run.diagram.plannerDeclines = [{
      phase: "initial", lane: "operator", reason: "Cannot draw this figure.",
      reasonBytes: 24, truncated: false,
    }];
    run.diagram.candidateErrorCodes = ["invalid_id"];
    assert.equal(correctedEmptyCauseForStoredRun(run), "candidates_invalid");
    assert.equal(run.diagram.plannerDeclined, false);
  });

  check("mixed historical decline markers preserve genuine unreadable-label failures", () => {
    const old = fixture("mixed-decline", false);
    old.diagram.candidateErrorCodes = ["planner_declined_required_scene", "scene_without_readable_label"];
    assert.equal(correctedEmptyCauseForStoredRun(old), "candidates_invalid");
    assert.deepEqual(old.diagram.candidateErrorCodes, ["scene_without_readable_label"]);
    assert.equal(old.diagram.plannerDeclined, false);
  });

  check("strict suppression replaces removed-figure verdicts and refreshes judge exports", () => {
    const path = round("strict-judgment", [fixture("suppressed", true)], [judgment("suppressed")]);
    applyJudgments(path);
    assert.equal(regradeStrictSuppression(path).suppressed, 1);
    assert.deepEqual(readRoundJudgments(path), [ruleJudgmentForNoFigure("required", "suppressed")]);
    const summary = JSON.parse(readFileSync(join(path, "summary.json"), "utf8"));
    assert.deepEqual(summary.judge.counts, { empty_bad: 1 });
    assert.match(readFileSync(join(path, "verdicts.csv"), "utf8"), /"suppressed","empty_bad"/);
    assert.equal(readGalleryEntries(path)[0]?.judgment?.verdict, "empty_bad");
  });

  check("strict suppression preserves an exempt chemistry figure and its existing judgment", () => {
    const run = fixture("chemistry-exempt", true);
    run.question = "Draw the Lewis structure of H2O, including the two O-H bonds and two lone pairs on oxygen.";
    run.topicId = "chemistry|1|synthetic-lewis";
    run.unitId = "chemistry|1";
    run.evaluation = {
      ...run.evaluation, question: run.question, topic_id: run.topicId, subject: "chemistry",
      figure_kind: "lewis", must_show: ["two O-H bonds", "two oxygen lone pairs"], must_label: ["O", "H"],
    };
    run.diagram.figureSource = "chemistry_family";
    run.diagram.family = "chem_lewis";
    const completed = judgment(run.evaluation.id);
    const path = round("strict-chemistry-exempt", [run], [completed]);
    applyJudgments(path);
    const originalDiagram = structuredClone(run.diagram);

    assert.equal(regradeStrictSuppression(path).suppressed, 0);
    const updated = JSON.parse(readFileSync(join(path, "runs", "0.json"), "utf8"));
    assert.deepEqual(updated.diagram, originalDiagram);
    assert.deepEqual(readRoundJudgments(path), [completed]);
    const summary = JSON.parse(readFileSync(join(path, "summary.json"), "utf8"));
    assert.deepEqual(summary.judge.counts, { right: 1 });
    assert.equal(readGalleryEntries(path)[0]?.judgment?.verdict, "right");
  });

  check("strict suppression regrades lesson score after changing the committed figure", () => {
    const run = fixture("scored", true);
    const path = round("strict-score", [run], [judgment("scored")]);
    const originalScore = gradeLecture(run).score;
    regradeStrictSuppression(path);
    const updated = JSON.parse(readFileSync(join(path, "runs", "0.json"), "utf8"));
    const expected = gradeLecture(updated);
    assert.notEqual(expected.score, originalScore, "fixture must expose a real score change");
    const summary = JSON.parse(readFileSync(join(path, "summary.json"), "utf8"));
    assert.equal(summary.meanScore, expected.score);
    assert.deepEqual(summary.grades, [expected]);
  });
} finally {
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
}

assert.deepEqual(failures, [], "lab judging regression failures");
console.log("lab judging regressions: offline generated fixtures pass; no model calls");
