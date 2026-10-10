/** Recorded cue time must govern estimated ink, including notation expanded for speech. */
import assert from "node:assert/strict";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { drawLectureTimeline } from "../../lib/lecture-export/drawLectureTimeline";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import { pumpExportClock } from "../../lib/lecture-export/lectureExportTail";

async function main() {
  const narration = "Carry the result onto the fresh page. The speed is 10 m/s after 5 s. The distance is 25 m.";
  const commands = ["s = 25 m", "v = 10 m/s", "area = 25 m"].map(text => ({
    type: "WRITE" as const, text, params: [90, 145, 32], charPosition: 0, narrationBefore: "",
  }));
  for (const durationMs of [null, 6_000]) {
    const turn: StoredTurn = { id: "cue-clock", orderIndex: 0, question: "Recorded notation", rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null,
      visualStatus: "text_only", sceneArtifacts: null,
      segments: [{ id: "row", orderIndex: 0, narration, spokenText: narration,
        command: { commands }, audioUrl: null, durationMs, timings: null }] };
    assert.ok(!lecturePageCacheKey([turn]).endsWith("@video3"), "older files whose speech clock truncated ink are invalidated");
    const timeline = buildReplayTimeline([turn]);
    const clock = createVirtualWhiteboardClock(0);
    const schedules: { text?: string; finalMs: number }[] = [];
    let settled = false;
    const work = drawLectureTimeline({ cues: timeline.cues, getClockMs: clock.now,
      waitForAdvance: clock.waitForAdvance, shouldCancel: () => false,
      executeCommand: async (command, options) => {
        const schedule = options?.writeSchedule;
        assert.ok(schedule, "estimated speech still supplies a schedule");
        schedules.push({ text: command.text, finalMs: schedule.charStartOffsetsMs.at(-1)! });
      },
    }).finally(() => { settled = true; });
    for (let ms = 0; !settled && ms <= timeline.totalMs + 8_000; ms += 50) {
      clock.setNow(ms); await pumpExportClock(clock);
    }
    await work;
    assert.equal(schedules.length, commands.length);
    for (const schedule of schedules) assert.ok(schedule.finalMs <= timeline.totalMs * 1.12,
      `${durationMs ?? "estimated"}ms cue: ${schedule.text} waits until ${schedule.finalMs}ms outside the existing 12% ink allowance for its ${timeline.totalMs}ms speech window`);
  }
  console.log("verify-lecture-export-speech-clock: persisted and estimated cue windows govern expanded-notation writing");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
