/** Synthetic words from an offline replay failure; no recorded student text. */
import assert from "node:assert/strict";
import {
  buildLessonSegments,
  getSegmentCommands,
  prepareVerifiedLessonSegments,
  serializeSegmentCommands,
  textToStrokePaths,
  type DrawCommand,
} from "@heytutor/drawing";
import {
  getBestWriteCharScheduleMs,
  getEstimatedWriteCharScheduleMs,
  getWriteCharScheduleMs,
  mathToSpeech,
} from "@heytutor/tutor-core";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import { drawLectureTimeline, type ExportExecuteCommand } from "../../lib/lecture-export/drawLectureTimeline";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";

const words = ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"];

function command(text: string): DrawCommand {
  return { type: "WRITE", params: [90, 142, 27], text, charPosition: 0, narrationBefore: "" };
}

function timings(narration: string) {
  const spoken = mathToSpeech(narration);
  return {
    charStartTimes: Array.from(spoken, (_, index) => index * 0.065),
    charDurations: Array.from(spoken, () => 0.065),
    totalDuration: spoken.length * 0.065,
  };
}

async function checkSchedule(narration: string, text: string) {
  const write = command(text);
  const audio = timings(narration);
  const glyphs = await textToStrokePaths(text, 0, 0, 27);
  const best = getBestWriteCharScheduleMs(narration, write, audio, audio.totalDuration * 1_000, 0);
  assert(best, `${text}: narrated WRITE retains a usable estimated or fallback schedule`);
  for (const schedule of [
    getEstimatedWriteCharScheduleMs(narration, write),
    getWriteCharScheduleMs(narration, write, audio),
    best,
  ]) {
    // Script syntax can intentionally decline alignment; the public best-plan
    // consumer above must still supply one slot per rendered glyph.
    if (!schedule) continue;
    assert.equal(schedule.offsetsMs.length, glyphs.length, `${text}: every character retains a slot`);
    assert(schedule.offsetsMs.every(Number.isFinite), `${text}: offsets remain finite`);
    assert(schedule.offsetsMs.every((x, i, all) => x >= 0 && (i === 0 || x >= all[i - 1]!)), `${text}: offsets remain ordered`);
  }
}

async function consumer(text: string) {
  const response = `[STEP] Read the name ${text}. [WRITE:${text},90,142][/STEP]`;
  const prepared = prepareVerifiedLessonSegments(buildLessonSegments(response), null);
  const submitted = prepared.segments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment)), durationMs: 2_000, timings: null,
  }));
  const canonical = await canonicalizeTurnSceneMetadata({ question: "Explain a symbolic name.", visualStatus: "text_only", segments: submitted });
  assert(canonical.ok, `${text}: ordinary work remains saveable`);
  const turn: StoredTurn = {
    id: "synthetic-turn", orderIndex: 0, question: "Explain a symbolic name.", rawResponse: response,
    speedMultiplier: 1, traceId: null, ...canonical.value, status: "complete", kind: "lesson",
    segments: canonical.value.segments.map((segment, index) => ({
      id: `synthetic-${index}`, ...segment, audioUrl: null, durationMs: 2_000, timings: null,
    })),
  };
  // JSON storage/reopen must not rewrite, lose or duplicate a work row.
  const reopened: StoredTurn = JSON.parse(JSON.stringify(turn));
  assert.deepEqual(reopened, turn);
  const replay = buildReplayTimeline([reopened]);
  const player = buildLecturePlayerTimeline([reopened]);
  assert.deepEqual(player.cues, replay.cues, `${text}: player consumes the same reopened rows`);
  const expected = replay.cues.flatMap(cue => cue.commands);
  assert.equal(expected.filter(c => c.type === "WRITE" && c.text === text).length, 1, `${text}: exactly one WRITE reaches scheduling`);
  for (const draw of ["export", "replay"] as const) {
    let clock = 0;
    const emitted: DrawCommand[] = [];
    const options = {
      cues: replay.cues, getClockMs: () => clock,
      waitForAdvance: async () => { clock += 100; }, shouldCancel: () => false,
      executeCommand: async (ink: DrawCommand, settings?: Parameters<ExportExecuteCommand>[1]) => {
        emitted.push(ink);
        const offsets = settings?.writeSchedule?.charStartOffsetsMs;
        if (offsets) {
          assert.equal(offsets.length, (await textToStrokePaths(ink.text ?? "", 0, 0, 27)).length);
          assert(offsets.every(Number.isFinite));
          assert(offsets.every((x, i, all) => i === 0 || x >= all[i - 1]!));
        }
      },
    };
    if (draw === "export") await drawLectureTimeline(options);
    else await drawReplayDiagramTimeline({ ...options, getTurn: () => reopened, getDiagram: () => null });
    assert.deepEqual(emitted, expected, `${text}: ${draw} draws each exact saved command once`);
    assert(clock >= replay.totalMs - 10, `${text}: ${draw} reaches the cue boundary`);
  }
}

async function main() {
  for (const word of words) {
    await consumer(word);
    await checkSchedule(`Read the name ${word}.`, word);
    // Also reach the numeric-context unit lookup and function-parenthesis lookup.
    await checkSchedule(`Two ${word} names.`, `2 ${word}`);
    await checkSchedule(`${word} times x.`, `${word}(x)`);
  }
  for (const [narration, text] of [
    ["five x plus three", "5x + 3"],
    ["v equals sixty centimeters", "v = 60 cm"],
    ["sine theta equals y", "sin θ = y"],
    ["natural log x", "ln(x)"],
  ]) {
    await checkSchedule(narration!, text!);
    const schedule = getWriteCharScheduleMs(narration!, command(text!), timings(narration!));
    assert(schedule?.matched, `${text}: ordinary symbols/units/functions still match spoken notation`);
    assert(schedule.matchedCharFraction >= 0.9);
  }
  console.log("PASS recorded-lesson integrity: prototype names preserve schedules, saved WRITE rows, player/replay/export commands; ordinary notation unchanged");
}

void main();
