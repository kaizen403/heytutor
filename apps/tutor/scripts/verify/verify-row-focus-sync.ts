import assert from "node:assert/strict";
import { countWrittenGlyphs, getSegmentCommands, IncrementalTagParser, type DrawCommand, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import {
  getBestWriteCharScheduleMs,
  mathToSpeech,
  type AudioTimings,
} from "@heytutor/tutor-core";
import { drawSegmentInk, planSegmentInk } from "../../features/tutor-session/lib/turn/segmentInk";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";

function timingsFor(narration: string, rate = 86): AudioTimings {
  const spoken = mathToSpeech(narration);
  return {
    charStartTimes: Array.from(spoken, (_, index) => index * rate / 1000),
    charDurations: Array.from(spoken, () => rate / 1000),
    totalDuration: spoken.length * rate / 1000,
  };
}

function write(text: string, narration: string): DrawCommand {
  return { type: "WRITE", text, params: [90, 211], charPosition: narration.length, narrationBefore: narration };
}

async function delivered(narration: string, command: DrawCommand, timings: AudioTimings | null) {
  const calls: ExecuteCommandOptions[] = [];
  // Runtime explanation motion (#202) is not an authored row: keep it apart,
  // and hold it to its own contract below.
  const tails: Array<{ command: DrawCommand; options: ExecuteCommandOptions }> = [];
  await drawSegmentInk({
    plan: planSegmentInk({ commands: [command], verifiedDiagramIntro: false, hasNarration: true }),
    verifiedDiagramIntro: false,
    clock: {
      narration, getTimings: () => timings,
      totalSpeechMs: timingsFor(narration).totalDuration * 1000,
      estimatedSpeechMs: timingsFor(narration).totalDuration * 1000,
      getAudioPositionMs: () => 0, getPlaybackRate: () => 1,
    },
    getDiagram: () => null, isCancelled: () => false,
    waitWhilePaused: async () => true, commandOptions: () => ({}),
    execute: async (command, options) => {
      if (options.explanationPointing === true) tails.push({ command, options });
      else calls.push(options);
    },
  });
  assert(tails.length <= 1, "runtime explanation pointing adds at most one transient call per sentence");
  for (const tail of tails) {
    assert.equal(tail.command.type, "POINT", "runtime explanation motion is only ever a POINT");
    assert.equal(tail.options.writeSchedule, undefined, "runtime explanation motion never carries a write schedule");
    assert.notEqual(tail.options.verifiedPointingOnly, true, "a work tail is never also a verified continuation");
  }
  assert.equal(calls.length, 1, "the same spoken row reaches the real shared ink consumer once");
  assert(calls[0]!.writeSchedule, "speech receives an immediate write schedule");
  return calls[0]!.writeSchedule;
}

async function main() {
  const narration = "Before substituting we check that the signs refer to the same direction and retain the stated unit. Now z equals nine.";
  const command = write("z = 9", narration);
  for (const timings of [null, timingsFor(narration)]) {
    const schedule = getBestWriteCharScheduleMs(narration, command, timings);
    assert(schedule?.matched, "the recorded class has a real late spoken formula cue");
    assert(schedule.offsetsMs[0]! > timingsFor(narration).totalDuration * 1000 * 0.6,
      "control: the actual formula starts after the old estimate cap");
    const actual = await delivered(narration, command, timings);
    assert.deepEqual(actual.charStartOffsetsMs, schedule.offsetsMs,
      "live/replay/export's shared consumer must preserve the late spoken cue, including estimates");
    assert.equal(actual.charStartOffsetsMs.length, countWrittenGlyphs(command.text!));
  }
  const ordinary = "z equals nine, because it is the next value.";
  const early = getBestWriteCharScheduleMs(ordinary, write("z = 9", ordinary), null)!;
  assert.deepEqual((await delivered(ordinary, write("z = 9", ordinary), null)).charStartOffsetsMs, early.offsetsMs,
    "ordinary row-first speech keeps its existing cue");

  const callSpeech = "we write c of n comma r, the count of selections.";
  const call = write("C(n,r)", callSpeech);
  for (const timings of [null, timingsFor(callSpeech)]) {
    const schedule = getBestWriteCharScheduleMs(callSpeech, call, timings);
    assert(schedule?.matched, "a generic named application may be spoken with of and comma");
    assert.equal(schedule.matchedCharFraction, 1, "the complete application, rather than a partial letter, anchors it");
    assert.equal(schedule.offsetsMs.length, countWrittenGlyphs(call.text!));
    assert.equal((await delivered(callSpeech, call, timings)).charStartOffsetsMs.length,
      countWrittenGlyphs(call.text!), "the real shared consumer retains every notation glyph");
  }
  for (const narration of ["we write ocean of n comma r", "we write c of nn comma r", "we write c of n comma river"]) {
    assert.equal(getBestWriteCharScheduleMs(narration, write("C(n,r)", narration), null)?.matched, false,
      "partial words cannot masquerade as the exact application cue");
  }
  for (const [text, narration] of [
    ["m(g+h)", "m times g plus h"],
    ["v = 60 cm", "v equals sixty centimeters"],
    ["x^2", "x squared"],
  ]) {
    assert(getBestWriteCharScheduleMs(narration!, write(text!, narration!), null)?.matched,
      "ordinary multiplication, units and powers keep their existing spoken forms");
  }
  // A FOCUS tag can follow the name while the rest of its sentence explains
  // the part. The live parser retains that full sentence and the shared ink
  // consumer schedules the verified name, rather than the tag's end offset.
  const focusNarration = "If the direction is fixed, A points along the upper ray and B points along the lower ray.";
  const raw = "[STEP]If the direction is fixed, A [FOCUS:upper] points along the upper ray and B [FOCUS:lower] points along the lower ray.[/STEP]";
  const segments: TutorSegment[] = [];
  const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: (segment) => segments.push(segment) });
  for (let cursor = 0; cursor < raw.length; cursor += 7) parser.push(raw.slice(cursor, cursor + 7));
  parser.flush();
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.narration, focusNarration, "conditional speech is retained verbatim and in order");
  const diagram: VerifiedDiagram = {
    id: "verified_scene", name: "owned geometry", commands: [], reveals: [], promptAddon: "",
    anchors: [
      { id: "upper", labels: ["upper", "A", "upper ray"], x: 500, y: 200, width: 100, height: 20 },
      { id: "lower", labels: ["lower", "B", "lower ray"], x: 500, y: 300, width: 100, height: 20 },
    ],
  };
  for (const timings of [null, timingsFor(focusNarration)]) {
    const calls: Array<{ command: DrawCommand; options: ExecuteCommandOptions }> = [];
    const continuations: Array<{ command: DrawCommand; options: ExecuteCommandOptions }> = [];
    await drawSegmentInk({
      plan: planSegmentInk({ commands: getSegmentCommands(segments[0]!), verifiedDiagramIntro: false, hasNarration: true }),
      verifiedDiagramIntro: false,
      clock: { narration: focusNarration, getTimings: () => timings,
        totalSpeechMs: timingsFor(focusNarration).totalDuration * 1000,
        estimatedSpeechMs: timingsFor(focusNarration).totalDuration * 1000,
        getAudioPositionMs: () => 0, getPlaybackRate: () => 1 },
      getDiagram: () => diagram, isCancelled: () => false, waitWhilePaused: async () => true,
      commandOptions: () => ({}), execute: async (command, options) => {
        if (options.verifiedPointingOnly === true) continuations.push({ command, options });
        else calls.push({ command, options });
      },
    });
    // A sentence with an authored FOCUS never starts a work tour; the only
    // runtime motion allowed is the tail continuing the last completed target.
    assert(calls.every((call) => call.options.explanationPointing !== true),
      "an authored gesture sentence never adds a runtime work tour");
    assert(continuations.length <= 1, "at most one verified continuation per sentence");
    for (const continuation of continuations) {
      assert.equal(continuation.command.type, "POINT", "a verified continuation is only ever a POINT");
      assert.equal(continuation.options.focusSchedule, undefined, "a verified continuation never carries a focus schedule");
      assert.notEqual(continuation.options.explanationPointing, true, "a verified continuation never comes from explanation pointing");
    }
    assert.deepEqual(continuations.map((call) => call.command.text), ["lower"],
      "the continuation stays on the last completed verified target");
    assert.deepEqual(calls.map((call) => call.command.text), ["upper", "lower"], "only the authored verified targets are scheduled");
    for (const [index, label] of ["A", "B"].entries()) {
      const schedule = calls[index]!.options.focusSchedule;
      assert.equal(schedule?.matchedCount, 1);
      assert.equal(schedule?.targets[0]?.anchor, "label");
      assert.equal(schedule?.targets[0]?.startMs, mathToSpeech(focusNarration).indexOf(label) * 86,
        "estimated and exact consumer schedules begin at the spoken verified name");
    }
  }
  console.log("Row/focus sync: late formula clocks and complete spoken application cues preserved.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
