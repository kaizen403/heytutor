import assert from "node:assert/strict";
import { textToStrokePaths, type DrawCommand } from "@heytutor/drawing";
import { getEstimatedWriteCharScheduleMs, getFallbackWriteCharScheduleMs, getWriteCharScheduleMs } from "../../src/sync/audioSync";
import { mathToSpeech } from "../../src/tts/elevenLabsClient";

const narration = "v equals x.";
const spoken = mathToSpeech(narration);
const timings = {
  charStartTimes: Array.from({ length: spoken.length }, (_, index) => index * 0.1),
  charDurations: new Array(spoken.length).fill(0.1), totalDuration: spoken.length * 0.1,
};
const command = (text: string): DrawCommand => ({ type: "WRITE", text, params: [] });
for (const text of ["v̄ = x", "v⃗ = x", "v̈ = x", "v̄_1 = x", "v̄⃗ = x"]) {
  const paths = await textToStrokePaths(text, 0, 0, 32);
  const base = text.replace(/\p{M}/gu, "");
  const basePaths = await textToStrokePaths(base, 0, 0, 32);
  for (const getSchedule of [
    (row: string) => getWriteCharScheduleMs(narration, command(row), timings),
    (row: string) => getEstimatedWriteCharScheduleMs(narration, command(row)),
  ]) {
    const schedule = getSchedule(text);
    const plain = getSchedule(base);
    assert(schedule && plain, "narrated accented row must have a schedule");
    assert.equal(schedule.offsetsMs.length, paths.length, "one cue per rendered glyph, including scripts");
    assert.equal(schedule.charDurationsMs.length, paths.length);
    assert.equal(basePaths.length, paths.length);
    for (const sign of ["=", "x"]) {
      const index = paths.findIndex(path => path.char === sign);
      const baseIndex = basePaths.findIndex(path => path.char === sign);
      assert.equal(schedule.offsetsMs[index], plain.offsetsMs[baseIndex], `${sign} uses its spoken cue`);
      assert.equal(schedule.charDurationsMs[index], plain.charDurationsMs[baseIndex]);
    }
  }
}
for (const text of ["v̄ = x", "v̄_(1 2) = x", "â = x", "ẋ = x", "ẍ = x"]) {
  const paths = await textToStrokePaths(text, 0, 0, 32);
  const fallback = getFallbackWriteCharScheduleMs(narration, command(text));
  assert.equal(fallback?.offsetsMs.length, paths.length, "fallback schedule uses the whole row's visible glyphs");
}
console.log("accent writing schedules: attached marks share a glyph cue; later signs track their spoken words");
