import type { DrawCommand } from "@heytutor/drawing";
import {
  ESTIMATED_FIRST_CUE_MAX_FRACTION,
  SpeechRateEstimator,
  WRITE_INK_FLOOR_MS_PER_CHAR,
  catchUpWriteScheduleOffsets,
  createSpeechRateState,
  defaultSpeechMsPerChar,
  leadWriteScheduleToSpeech,
  getCommandSpeechWindow,
  getEstimatedWriteCharScheduleMs,
  getBestWriteCharScheduleMs,
  getFallbackWriteCharScheduleMs,
  getWriteCharScheduleMs,
  isWriteScheduleUsable,
  mathToSpeech,
  mergeAudioTimingChunk,
  hasPlayableSegmentAudio,
  observeSpeechRate,
  resolveLiveAudioPositionMs,
  shouldReleaseAudioPositionWait,
  simulateScheduledWriteWait,
  toSegmentRelativeAudioTimings,
} from "../../src/index";

interface Case {
  name: string;
  narration: string;
  text: string;
  /** The first board token is the first spoken word, so ink starts with the voice. */
  opensSentence: boolean;
}

/**
 * Rows a teacher writes while saying them. The first five are the original
 * cases; the rest are the spoken forms measured missing on 10 Sep 2026 over
 * 364 lessons: "=" said as "is" (2822 of 4267 rows unmatched), "/" as "over",
 * "≈" as "about", "->" as "so", ">" as "positive", units by name, "2x" as
 * "two x", a subscript as "sub", and a bare "x" as "times".
 */
const cases: Case[] = [
  {
    name: "linear expression",
    narration: "five x plus three. five x is the variable term, and three is the constant.",
    text: "5x + 3",
    opensSentence: true,
  },
  {
    name: "power expression",
    narration: "x cubed. that means x times x times x.",
    text: "x^3",
    opensSentence: true,
  },
  {
    name: "circle equation",
    narration: "r squared equals x minus h squared plus y minus k squared. this is the circle equation.",
    text: "r^2 = (x-h)^2 + (y-k)^2",
    opensSentence: true,
  },
  {
    name: "trig ratio",
    narration: "sine theta equals y. cosine theta equals x. tangent theta equals y over x.",
    text: "sin θ = y",
    opensSentence: true,
  },
  {
    name: "chord half-angle",
    narration: "D equals 2 R cosine theta over 2",
    text: "D = 2R cos θ/2",
    opensSentence: true,
  },
  {
    name: "mirror formula, slash said as over",
    narration: "one over v equals one over f minus one over u",
    text: "1/v = 1/f - 1/u",
    opensSentence: true,
  },
  {
    name: "equals said as is, unit by name",
    narration: "so v is sixty centimeters",
    text: "v = 60 cm",
    opensSentence: false,
  },
  {
    name: "approximately said as about",
    narration: "m is about zero point four three",
    text: "m ≈ 0.43",
    opensSentence: true,
  },
  {
    name: "inequality and arrow in prose",
    narration: "v came out positive, so the image is real",
    text: "v > 0 -> real image",
    opensSentence: true,
  },
  {
    name: "subscript and x as times",
    narration: "v sub s times r two over r one plus r two",
    text: "V_s x R2/(R1 + R2)",
    opensSentence: true,
  },
  {
    name: "coefficient and equals as is",
    narration: "two x plus three is eleven",
    text: "2x + 3 = 11",
    opensSentence: true,
  },
  {
    name: "slash said as divided by",
    narration: "so x divided by y is the ratio we need.",
    text: "x / y",
    opensSentence: false,
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

const SYNTH_MS_PER_CHAR = 65;

function syntheticTimings(narration: string) {
  const spoken = mathToSpeech(narration);
  return {
    charStartTimes: Array.from({ length: spoken.length }, (_, index) => index * (SYNTH_MS_PER_CHAR / 1000)),
    charDurations: new Array(spoken.length).fill(SYNTH_MS_PER_CHAR / 1000),
    totalDuration: spoken.length * (SYNTH_MS_PER_CHAR / 1000),
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const MIN_MATCHED_CHAR_FRACTION = 0.9;

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
    assert(
      schedule.matchedCharFraction >= MIN_MATCHED_CHAR_FRACTION,
      `${testCase.name}: ${source} schedule located ${(schedule.matchedCharFraction * 100).toFixed(0)}% of the row's characters, need ${MIN_MATCHED_CHAR_FRACTION * 100}%`,
    );
    assert(schedule.offsetsMs.length === testCase.text.replace(/\s/g, "").length, `${testCase.name}: wrong char count`);
    assert(
      schedule.charDurationsMs.length === schedule.offsetsMs.length,
      `${testCase.name}: char duration count mismatch`,
    );
    if (testCase.opensSentence) {
      assert((schedule.offsetsMs[0] ?? 999) <= 100, `${testCase.name}: first character starts too late`);
    }
    for (let i = 1; i < schedule.offsetsMs.length; i++) {
      assert(schedule.offsetsMs[i] >= schedule.offsetsMs[i - 1], `${testCase.name}: offsets are not monotonic`);
    }
    // Every character of a spoken token owns a real slice of its word: no
    // token in a fully matched row is written at a zero slot, and no slot
    // is the old 24 ms floor artefact of a window that mapped to one index.
    if (schedule.matchedCharFraction === 1) {
      for (const duration of schedule.charDurationsMs) {
        assert(duration > 24, `${testCase.name}: ${source} char slot ${duration} ms is not a spoken slot`);
      }
    }
  }
}

// Slots are the word's span divided across the token: "five x" is six timed
// characters for two board characters, "plus" four for one.
{
  const schedule = getWriteCharScheduleMs(
    cases[0]!.narration,
    command(cases[0]!.text),
    syntheticTimings(cases[0]!.narration),
  );
  assert(schedule, "linear expression schedule missing");
  const fiveX = Math.round((6 * SYNTH_MS_PER_CHAR) / 2);
  assert(
    Math.abs(schedule.charDurationsMs[0]! - fiveX) <= 1 && Math.abs(schedule.charDurationsMs[1]! - fiveX) <= 1,
    `"5x" chars must split the "five x" span (${fiveX} ms each), got ${schedule.charDurationsMs.slice(0, 2).join(",")}`,
  );
  assert(
    schedule.charDurationsMs[2] === 4 * SYNTH_MS_PER_CHAR,
    `"+" must own the whole "plus" span (${4 * SYNTH_MS_PER_CHAR} ms), got ${schedule.charDurationsMs[2]}`,
  );
  assert(
    schedule.offsetsMs[2] === 7 * SYNTH_MS_PER_CHAR,
    `"+" must start when "plus" starts (${7 * SYNTH_MS_PER_CHAR} ms), got ${schedule.offsetsMs[2]}`,
  );
}

// Whole words only: "v" anchors at "we want v", never inside "concave"; the
// unspoken "=" and the silent "?" ride after it at floor pace.
{
  const narration =
    "f is the focal length of the concave mirror, and u is the object distance. we want v";
  const spoken = mathToSpeech(narration);
  const schedule = getWriteCharScheduleMs(narration, command("v = ?"), syntheticTimings(narration));
  assert(schedule, "v = ? schedule missing");
  const finalV = spoken.lastIndexOf("v") * SYNTH_MS_PER_CHAR;
  const concaveV = spoken.indexOf("concave") * SYNTH_MS_PER_CHAR;
  assert(
    schedule.offsetsMs[0] === finalV,
    `"v" must anchor at the spoken "v" (${finalV} ms), got ${schedule.offsetsMs[0]}`,
  );
  assert(schedule.offsetsMs[0]! > concaveV + 7 * SYNTH_MS_PER_CHAR, "\"v\" anchored inside \"concave\"");
  assert(
    schedule.offsetsMs[1] === finalV + SYNTH_MS_PER_CHAR &&
      schedule.charDurationsMs[1] === WRITE_INK_FLOOR_MS_PER_CHAR,
    `unspoken "=" must follow "v" at floor pace, got offset ${schedule.offsetsMs[1]} slot ${schedule.charDurationsMs[1]}`,
  );
  assert(
    schedule.offsetsMs[2] === schedule.offsetsMs[1]! + WRITE_INK_FLOOR_MS_PER_CHAR,
    "silent \"?\" must follow \"=\" at floor pace",
  );
  assert(
    Math.abs(schedule.matchedCharFraction - 0.5) < 1e-9,
    `"?" is outside the fraction: expected 0.5, got ${schedule.matchedCharFraction}`,
  );

  // An exact schedule whose cue sits at 98% of the sentence is the truth: it
  // is usable and it is not shifted to the top of the sentence.
  const totalMs = spoken.length * SYNTH_MS_PER_CHAR;
  assert(schedule.offsetsMs[0]! > totalMs * 0.7, "test setup: the cue must sit past 70% of the sentence");
  assert(isWriteScheduleUsable(schedule, narration, totalMs), "a late exact cue must stay usable");
  assert(
    leadWriteScheduleToSpeech(schedule.offsetsMs, 0, schedule.maxInitialWaitMs).join(",") ===
      schedule.offsetsMs.join(","),
    "an exact schedule must not be shifted toward the start of the sentence",
  );
  assert(
    leadWriteScheduleToSpeech(schedule.offsetsMs, 0).join(",") === schedule.offsetsMs.join(","),
    "without a cap the schedule must not be shifted",
  );
  const best = getBestWriteCharScheduleMs(narration, command("v = ?"), syntheticTimings(narration), totalMs);
  assert(best?.source === "tts", `a late exact cue must not be demoted to an estimate (got ${best?.source})`);
}

// A row said out of order: "solution:" comes after the maths in the voice,
// so it is lettered just before "x" and the maths lands on its words.
{
  const narration = "so x equals four. that is the solution.";
  const spoken = mathToSpeech(narration);
  const schedule = getWriteCharScheduleMs(narration, command("solution: x = 4"), syntheticTimings(narration));
  assert(schedule, "out of order schedule missing");
  const xAt = spoken.indexOf(" x ") * SYNTH_MS_PER_CHAR + SYNTH_MS_PER_CHAR;
  assert(schedule.offsetsMs[9] === xAt, `"x" must land on its word (${xAt} ms), got ${schedule.offsetsMs[9]}`);
  assert(schedule.offsetsMs[0]! < xAt, "\"solution:\" must be lettered before the maths, not after the sentence");
  assert(schedule.matchedCharFraction === 1, "every token of the row was said, so the fraction is 1");
}

const unsyncable = getEstimatedWriteCharScheduleMs(
  "this formula comes from rearranging the original equation.",
  command("5x + 3"),
);
assert(unsyncable === null, "unsyncable board text should not get a character schedule");

const beforeAudioStart = getBestWriteCharScheduleMs(
  "write five x plus three on the board.",
  command("5x + 3"),
  null,
);
assert(beforeAudioStart, "text must receive an estimated schedule before audio starts");
assert(
  beforeAudioStart.source === "estimated",
  "pre-audio text scheduling must use the deterministic estimate",
);

// One speech rate everywhere: the estimate runs at a constant msPerChar (no
// velocity hump), the default is the measured 86, and a session rate threads
// through the estimated and fallback schedules.
{
  assert(defaultSpeechMsPerChar === 86, `default speech rate must be the measured 86 ms per char, got ${defaultSpeechMsPerChar}`);
  const narration = "so v is sixty centimeters";
  const estimated = getEstimatedWriteCharScheduleMs(narration, command("v = 60 cm"));
  assert(estimated, "estimated schedule missing");
  assert(
    estimated.offsetsMs[0] === 3 * defaultSpeechMsPerChar,
    `estimated cue must sit at index x rate (${3 * defaultSpeechMsPerChar}), got ${estimated.offsetsMs[0]}`,
  );
  const slower = getEstimatedWriteCharScheduleMs(narration, command("v = 60 cm"), 0, 120);
  assert(slower && slower.offsetsMs[0] === 3 * 120, "estimated schedule must use the session rate");
  assert(
    estimated.maxInitialWaitMs ===
      Math.round(mathToSpeech(narration).length * defaultSpeechMsPerChar * ESTIMATED_FIRST_CUE_MAX_FRACTION),
    "an estimated schedule may wait for 60% of the estimated sentence",
  );
  const fallbackDefault = getFallbackWriteCharScheduleMs("no board words here at all.", command("5x + 3"));
  const fallbackSlow = getFallbackWriteCharScheduleMs("no board words here at all.", command("5x + 3"), 120);
  assert(
    fallbackDefault && fallbackSlow && fallbackSlow.offsetsMs[0]! > fallbackDefault.offsetsMs[0]!,
    "fallback spread must scale with the session rate",
  );
  assert(fallbackDefault.matchedCharFraction === 0 && !fallbackDefault.matched, "a spread matches nothing");
}

// The estimator: seed 86, EMA over sentences of at least 20 characters,
// clamped to a real voice's range. Fed the 19 aligned sentences of the mirror
// run (narration chars, total_duration_ms) it settles within 15 ms of 86.
{
  const mirrorRun: Array<[number, number]> = [
    [33, 3111], [118, 10263], [105, 10449], [89, 7245], [40, 3019], [68, 6177],
    [64, 6177], [95, 8731], [46, 3344], [93, 7523], [47, 3855], [91, 8824],
    [9, 1068], [75, 5248], [45, 3529], [80, 6827], [64, 5248], [107, 9520],
    [100, 7848],
  ];
  const estimator = new SpeechRateEstimator();
  assert(estimator.msPerChar === 86, "estimator must seed at 86");
  for (const [chars, ms] of mirrorRun) {
    estimator.observe(chars, ms);
  }
  assert(
    Math.abs(estimator.msPerChar - 86) <= 15,
    `estimator settled at ${estimator.msPerChar.toFixed(1)} ms per char, expected 86 +/- 15`,
  );
  assert(estimator.samples === 18, `the 9 char beat must not move the average (samples ${estimator.samples})`);
  const seeded = createSpeechRateState();
  assert(observeSpeechRate(seeded, 19, 5000) === seeded, "short samples leave the state untouched");
  const fast = observeSpeechRate(seeded, 100, 1000);
  assert(fast.msPerChar >= 60 && fast.msPerChar < 86, "a fast sample moves the rate down inside the clamp");
  let pinned = seeded;
  for (let i = 0; i < 40; i++) {
    pinned = observeSpeechRate(pinned, 100, 100_000);
  }
  assert(
    pinned.msPerChar <= 130 && pinned.msPerChar > 129,
    `rate must settle at the 130 clamp, got ${pinned.msPerChar}`,
  );
}

assert(
  !hasPlayableSegmentAudio({
    receivedAudio: false,
    decodedAudio: false,
    capturedChunkCount: 0,
  }),
  "a finalized websocket segment without audio must be rejected",
);
assert(
  !hasPlayableSegmentAudio({
    receivedAudio: true,
    decodedAudio: false,
    capturedChunkCount: 1,
  }),
  "undecodable websocket bytes must not count as playable audio",
);
assert(
  hasPlayableSegmentAudio({
    receivedAudio: true,
    decodedAudio: true,
    capturedChunkCount: 1,
  }),
  "a finalized websocket segment with captured audio must be playable",
);

const fallback = getFallbackWriteCharScheduleMs(
  "this formula comes from rearranging the original equation.",
  command("5x + 3"),
);
assert(fallback, "fallback schedule must exist when board text is not spoken");
assert(fallback.offsetsMs.length === 4, "fallback schedule must cover non-space characters");
assert((fallback.offsetsMs[0] ?? 0) > 200, "fallback writing must start mid-speech, not at t=0");
assert(
  (fallback.offsetsMs[fallback.offsetsMs.length - 1] ?? 0) <
    Math.max("this formula comes from rearranging the original equation.".length * defaultSpeechMsPerChar, 700),
  "fallback writing must finish during speech",
);

const caughtUp = catchUpWriteScheduleOffsets([100, 300, 500, 700], 450);
assert(caughtUp[0] === 450 && caughtUp[1] === 450, "overdue characters must catch up to now");
assert(caughtUp[2] === 500 && caughtUp[3] === 700, "future character cues must stay anchored");
assert(
  catchUpWriteScheduleOffsets([100, 300], 50).join(",") === "100,300",
  "on-time schedules must not be rewritten",
);

const connectionRelative = {
  charStartTimes: [] as number[],
  charDurations: [] as number[],
  totalDuration: 0,
};
let connectionOffset = mergeAudioTimingChunk(connectionRelative, {
  startTimesMs: [39_000, 39_100],
  durationsMs: [100, 100],
});
connectionOffset = mergeAudioTimingChunk(connectionRelative, {
  startTimesMs: [39_200, 39_300],
  durationsMs: [100, 100],
}, connectionOffset);
const relative = toSegmentRelativeAudioTimings(connectionRelative);
assert(relative.charStartTimes.map((value) => value.toFixed(1)).join(",") === "0.0,0.1,0.2,0.3", "connection-relative timings were not rebased");
assert(Math.abs(relative.totalDuration - 0.4) < 1e-9, "rebased timing duration is wrong");

const firstLiveSegment = toSegmentRelativeAudioTimings({
  charStartTimes: [0, 4.404],
  charDurations: [0.1, 0.1],
  totalDuration: 4.504,
});
const secondLiveSegment = toSegmentRelativeAudioTimings({
  charStartTimes: [4.504, 8.073],
  charDurations: [0.1, 0.1],
  totalDuration: 8.173,
});
assert(Math.abs(firstLiveSegment.totalDuration - 4.504) < 1e-9, "first live segment changed unexpectedly");
assert(Math.abs(secondLiveSegment.totalDuration - 3.669) < 1e-9, "later live segment retained its connection origin");

// The usable test keeps one rule: a last cue past 1.12 x the sentence is a
// misaligned stream. A late first cue on its own is no longer a fault.
{
  const narration = "let's use a real example. center at two comma three, r equals five.";
  const lateSchedule = getWriteCharScheduleMs(narration, command("center (2,3), r = 5"), syntheticTimings(narration));
  assert(lateSchedule && lateSchedule.matchedCharFraction === 1, "example schedule missing");
  const pastEnd = {
    ...lateSchedule,
    offsetsMs: lateSchedule.offsetsMs.map((offset) => offset + 12_400),
  };
  assert(!isWriteScheduleUsable(pastEnd, narration, 11_000), "a schedule ending after the sentence must be rejected");
  const lateFirst = {
    ...lateSchedule,
    offsetsMs: lateSchedule.offsetsMs.map((_offset, index) => 7_700 + index * 60),
  };
  assert(isWriteScheduleUsable(lateFirst, narration, 11_000), "a first cue at 70% of the sentence must be usable");
}

const delayedHttpStart = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: null,
  nowMs: 800,
  maxAudioPositionMs: Number.NEGATIVE_INFINITY,
});
assert(delayedHttpStart.positionMs >= 0, "late HTTP/WS audio must not leave the write clock at -1");
assert(delayedHttpStart.positionMs < 200, "before audio starts, writing should use t=0 not the sentence end");

const afterSpeech = resolveLiveAudioPositionMs({
  speechComplete: true,
  capturedDurationMs: 8200,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: null,
  nowMs: 8200,
  maxAudioPositionMs: 0,
});
assert(afterSpeech.positionMs >= 8200, "completed speech should release leftover ink");

const wallClock = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: 1000,
  nowMs: 2500,
  maxAudioPositionMs: 0,
});
assert(wallClock.positionMs === 1500, "once audio starts, the write clock must follow wall time");

const pinnedZeroPlayback = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 0,
  audioStartedAtMs: 1000,
  nowMs: 2800,
  maxAudioPositionMs: 0,
});
assert(
  pinnedZeroPlayback.positionMs === 1800,
  "a zero TTS playback position must not pin writing at t=0",
);

// Lead rule. Exact: the pen goes to the row and waits for its word, however
// late. Estimated: the guess may be wrong, so the first cue waits for at
// most 60% of the estimated sentence and the rest shift with it.
{
  const exact = leadWriteScheduleToSpeech([4081, 4300, 4600, 5000], 0);
  assert(exact.join(",") === "4081,4300,4600,5000", "an exact cue at 4 s must keep its place");
  const estimatedCap = Math.round(5000 * ESTIMATED_FIRST_CUE_MAX_FRACTION);
  const led = leadWriteScheduleToSpeech([4081, 4300, 4600, 5000], 0, estimatedCap);
  assert((led[0] ?? 999) <= estimatedCap, "an estimated cue past 60% of the sentence starts at 60%");
  assert((led[3] ?? 0) < 5000 && led[3]! - led[0]! === 5000 - 4081, "later characters shift with the first");
  assert(
    leadWriteScheduleToSpeech([120, 240], 0, estimatedCap).join(",") === "120,240",
    "on-time schedules must keep their spoken cues",
  );
}

// Speech windows for other commands use whole words, and a gesture after a
// WRITE looks for the first occurrence, not the second.
{
  const narration =
    "f is the focal length of the concave mirror, and u is the object distance. we want v";
  const spoken = mathToSpeech(narration);
  const timings = syntheticTimings(narration);
  const focus: DrawCommand = {
    type: "FOCUS",
    text: "v",
    params: [],
    charPosition: 0,
    narrationBefore: "",
  };
  const afterWrite = getCommandSpeechWindow(narration, focus, timings, 1);
  assert(afterWrite.matched, "a FOCUS after a WRITE must still find its single spoken name");
  assert(
    afterWrite.startMs === spoken.lastIndexOf("v") * SYNTH_MS_PER_CHAR,
    `FOCUS "v" must start at the spoken "v", got ${afterWrite.startMs}`,
  );
  const secondWrite = getCommandSpeechWindow(narration, command("is"), timings, 1);
  assert(
    secondWrite.matched && secondWrite.startMs === spoken.indexOf("u is") * SYNTH_MS_PER_CHAR + 2 * SYNTH_MS_PER_CHAR,
    `a second WRITE looks for the second occurrence, got ${secondWrite.startMs}`,
  );
  const slow = getCommandSpeechWindow("nothing on the board is said here", focus, null, 0, 120);
  const quick = getCommandSpeechWindow("nothing on the board is said here", focus, null, 0, 60);
  assert(
    !slow.matched && slow.durationMs >= quick.durationMs,
    "the fallback window must follow the session rate",
  );
}

assert(
  shouldReleaseAudioPositionWait({
    positionMs: -1,
    targetMs: 2400,
    elapsedMs: 400,
    clockEverStarted: false,
    stalledFrames: 0,
  }),
  "writeText must not hang a full sentence waiting for a clock that never starts",
);
assert(
  !shouldReleaseAudioPositionWait({
    positionMs: 200,
    targetMs: 2400,
    elapsedMs: 200,
    clockEverStarted: true,
    stalledFrames: 0,
  }),
  "an advancing clock must still wait for its spoken cue",
);
assert(
  !shouldReleaseAudioPositionWait({
    positionMs: 5_000,
    targetMs: 9_265,
    elapsedMs: 8_100,
    clockEverStarted: true,
    stalledFrames: 0,
  }),
  "an advancing clock must wait for a cue past 8 s, not start the row early",
);

const parkedPenOffsets = [80, 160, 240, 320, 400];
const nullClockWrite = simulateScheduledWriteWait({
  offsetsMs: parkedPenOffsets,
  getRawPositionMs: () => null,
});
assert(nullClockWrite.completed, "a WRITE+speech segment must not hang when getAudioPositionMs is null");
assert(
  nullClockWrite.elapsedMs <= parkedPenOffsets[parkedPenOffsets.length - 1]! + 64,
  `null getAudioPositionMs parked the pen for ${nullClockWrite.elapsedMs}ms`,
);
const stuckClockWrite = simulateScheduledWriteWait({
  offsetsMs: parkedPenOffsets,
  getRawPositionMs: () => 16,
  maxElapsedMs: 3_000,
});
assert(stuckClockWrite.completed, "a WRITE+speech segment must not hang when the audio clock is stuck");
assert(
  stuckClockWrite.elapsedMs < 2_000,
  `stuck getAudioPositionMs parked the pen for ${stuckClockWrite.elapsedMs}ms`,
);

const stuckPlayback = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 16,
  audioStartedAtMs: 1000,
  nowMs: 2800,
  maxAudioPositionMs: 16,
});
assert(
  stuckPlayback.positionMs === 16,
  `a frozen playback position is reported honestly (got ${stuckPlayback.positionMs}); the write wait unsticks the pen`,
);

const racedThenAudible = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 80,
  audioStartedAtMs: 0,
  nowMs: 1000,
  maxAudioPositionMs: 1500,
  playbackRate: 1.5,
});
assert(
  Math.abs(racedThenAudible.positionMs - 80) <= 1,
  `real playback must replace a raced wall max (got ${racedThenAudible.positionMs})`,
);

const halfSpeedLive = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: 500,
  audioStartedAtMs: 0,
  nowMs: 1000,
  maxAudioPositionMs: 500,
  playbackRate: 0.5,
});
assert(
  halfSpeedLive.positionMs === 500,
  "half-speed media time must not look stuck against 1× wall time",
);

const doubleSpeedWall = resolveLiveAudioPositionMs({
  speechComplete: false,
  capturedDurationMs: null,
  estimateSpeechMs: 8000,
  playbackPositionMs: null,
  audioStartedAtMs: 0,
  nowMs: 1000,
  maxAudioPositionMs: 0,
  playbackRate: 2,
});
assert(
  doubleSpeedWall.positionMs === 2000,
  "wall-clock fallback must run in media time at the live playback rate",
);

console.log(
  `verified ${cases.length} sync schedule cases (matched char fraction >= ${MIN_MATCHED_CHAR_FRACTION}), whole-word anchors, the late-cue rule, the speech-rate estimator, fallback mid-speech writing, and catch-up offsets`,
);
