import type { DrawCommand } from "@heytutor/drawing";
import {
  getEstimatedWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  mathToSpeech,
} from "../src/index";

interface Case {
  name: string;
  narration: string;
  text: string;
}

const cases: Case[] = [
  {
    name: "linear expression",
    narration: "five x plus three. five x is the variable term, and three is the constant.",
    text: "5x + 3",
  },
  {
    name: "power expression",
    narration: "x cubed. that means x times x times x.",
    text: "x^3",
  },
  {
    name: "circle equation",
    narration: "r squared equals x minus h squared plus y minus k squared. this is the circle equation.",
    text: "r^2 = (x-h)^2 + (y-k)^2",
  },
  {
    name: "trig ratio",
    narration: "sine theta equals y. cosine theta equals x. tangent theta equals y over x.",
    text: "sin θ = y",
  },
];

function command(text: string): DrawCommand {
  return {
    type: "WRITE",
    text,
    params: [100, 100],
    charPosition: 0,
    narrationBefore: "",
  };
}

function syntheticTimings(narration: string) {
  const spoken = mathToSpeech(narration);
  return {
    charStartTimes: Array.from({ length: spoken.length }, (_, index) => index * 0.065),
    charDurations: new Array(spoken.length).fill(0.065),
    totalDuration: spoken.length * 0.065,
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

for (const testCase of cases) {
  const estimated = getEstimatedWriteCharScheduleMs(testCase.narration, command(testCase.text));
  const timed = getWriteCharScheduleMs(
    testCase.narration,
    command(testCase.text),
    syntheticTimings(testCase.narration),
  );

  for (const [source, schedule] of [
    ["estimated", estimated],
    ["tts", timed],
  ] as const) {
    assert(schedule, `${testCase.name}: ${source} schedule was not created`);
    assert(schedule.matched, `${testCase.name}: ${source} schedule did not match spoken text`);
    assert(schedule.offsetsMs.length === testCase.text.replace(/\s/g, "").length, `${testCase.name}: wrong char count`);
    assert(
      schedule.charDurationsMs.length === schedule.offsetsMs.length,
      `${testCase.name}: char duration count mismatch`,
    );
    assert((schedule.offsetsMs[0] ?? 999) <= 100, `${testCase.name}: first character starts too late`);
    for (let i = 1; i < schedule.offsetsMs.length; i++) {
      assert(schedule.offsetsMs[i] >= schedule.offsetsMs[i - 1], `${testCase.name}: offsets are not monotonic`);
    }
    for (const duration of schedule.charDurationsMs) {
      assert(duration >= 24, `${testCase.name}: char duration too short`);
    }
  }
}

const unsyncable = getEstimatedWriteCharScheduleMs(
  "this formula comes from rearranging the original equation.",
  command("5x + 3"),
);
assert(unsyncable === null, "unsyncable board text should not get a character schedule");

const lateSchedule = getWriteCharScheduleMs(
  "let's use a real example. center at two comma three, radius five.",
  command("ex: (2,3), r=5"),
  syntheticTimings(
    "let's use a real example. center at two comma three, radius five.",
  ),
);
if (lateSchedule) {
  // Force an implausibly late first offset like bad streaming alignment can produce.
  lateSchedule.offsetsMs[0] = 9996;
  assert(
    !isWriteScheduleUsable(
      lateSchedule,
      "let's use a real example. center at two comma three, radius five.",
      11000,
    ),
    "late first offset schedule should be rejected",
  );
}

console.log(`verified ${cases.length} sync schedule cases and one unsyncable fallback case`);
