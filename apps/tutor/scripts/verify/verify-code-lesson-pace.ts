/**
 * Pacing gate for DSA lessons.
 *
 * The owner's last complaint was that the lesson "is writing very fast" and
 * they could not keep up. Pacing was emergent — no budget, no cap that held,
 * and a leftover-block dump after the narration had stopped. This gate pins
 * the three things that made it unwatchable:
 *
 *   1. the per-block cap actually holds (it was nested inside the readability
 *      floor, so any block over ~267 characters silently exceeded it);
 *   2. characters never appear faster than the readable rate;
 *   3. a whole lesson lands in the 6-10 minute band the owner asked for.
 *
 * All of it is computed from the same pure functions the live panel and the
 * MP4 export use, so a change to pacing shows up here rather than in a
 * session someone has to sit through.
 */
import { readFileSync } from "node:fs";
import {
  CODE_LESSON_SPOKEN_MS_PER_STEP,
  CODE_LESSON_STEP_MS,
  CODE_LESSON_TARGET_MS,
  CODE_LESSON_TARGET_BY_FAMILIARITY,
  codeLessonBeatPlan,
  codeLessonStepCount,
  CODE_TYPE_MAX_BLOCK_MS,
  CODE_TYPE_MAX_VISIBLE_CHAR_MS,
  CODE_TYPE_MIN_VISIBLE_CHAR_MS,
  FRAME_SWAP_MS,
  codeLessonSectionCode,
  getMockCodeLessonPlan,
} from "@heytutor/tutor-core";
import {
  CodeLessonController,
  codeLessonLineBoardSpan,
  codeTypingCharOffsetsMs,
} from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import {
  codeBlockSpokenSchedule,
  codeLineAnchors,
  frameSpokenWalk,
  spokenTimeline,
  type FrameWalkStop,
} from "../../features/tutor-session/lib/code-lesson/codeSpokenSync";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import {
  SPOKEN_WALK_REST_MAX_MS,
  SPOKEN_WALK_TAIL_MS,
  runFrameWalkBeat,
  runTypedBlockBeat,
  walkSpokenStops,
} from "../../features/tutor-session/lib/code-lesson/spokenWalk";
import { adaptiveShapeBudget, resolveCommandInkBudgetMs } from "../../features/tutor-session/types";
import { detectAlgorithm } from "@heytutor/scene-engine";
import type { DrawCommand } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings, type CodeLessonPlan } from "@heytutor/tutor-core";
import { LETTERED_IN_HAND_MS_PER_CHAR } from "@heytutor/whiteboard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The window the controller computes for one block, given a spoken window. */
function windowMsFor(code: string, spokenMs: number): number {
  const readableMs = code.length * CODE_TYPE_MIN_VISIBLE_CHAR_MS;
  return Math.min(Math.max(spokenMs, readableMs), CODE_TYPE_MAX_BLOCK_MS);
}

/** How long the block actually takes to appear on screen. */
function typingMsFor(code: string, spokenMs: number): number {
  const offsets = codeTypingCharOffsetsMs(code, windowMsFor(code, spokenMs));
  return offsets.length > 0 ? offsets[offsets.length - 1]! : 0;
}

// --- 1. The cap holds, including for the block length that used to break it. ---
{
  // 300 characters: over the ~267 threshold where `length * MIN_VISIBLE`
  // (300 * 90 = 27s) used to beat the 24s cap because the min was nested
  // inside the max.
  const long = "x".repeat(300);
  const windowMs = windowMsFor(long, 1_000);
  assert(
    windowMs <= CODE_TYPE_MAX_BLOCK_MS,
    `a ${long.length}-char block sized its window to ${windowMs}ms, past the ${CODE_TYPE_MAX_BLOCK_MS}ms cap`,
  );
  assert(
    typingMsFor(long, 1_000) <= CODE_TYPE_MAX_BLOCK_MS + 1_000,
    "typing a long block must not run past the cap by more than a rounding tail",
  );

  // A very long spoken window must not drag typing past the cap either.
  assert(
    windowMsFor(long, 90_000) <= CODE_TYPE_MAX_BLOCK_MS,
    "a long narration must not stretch a block past the cap",
  );
}

// --- 2. Characters never appear faster than a person can read them. ---
// The floor is asserted on blocks the format gate would actually accept; a
// pathologically long block is deliberately compressed to honour the cap.
{
  const samples = [
    "def reverse(head):",
    "    while curr:\n        nxt = curr.next\n        curr.next = prev",
    "for i in range(len(nums)):\n    seen[nums[i]] = i",
  ];
  for (const code of samples) {
    const offsets = codeTypingCharOffsetsMs(code, 200);
    let worstGap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < offsets.length; i += 1) {
      const gap = offsets[i]! - offsets[i - 1]!;
      // Whitespace deliberately snaps, so only visible glyphs are rated.
      if (/\s/.test(code[i - 1]!)) continue;
      worstGap = Math.min(worstGap, gap);
    }
    assert(
      worstGap >= CODE_TYPE_MIN_VISIBLE_CHAR_MS - 1,
      `a visible character appeared after ${worstGap}ms, under the ${CODE_TYPE_MIN_VISIBLE_CHAR_MS}ms floor`,
    );
  }

  // A generous window must not slow typing to a crawl either.
  const slow = codeTypingCharOffsetsMs("abcdefghij", 600_000);
  const span = slow[slow.length - 1]! - slow[0]!;
  assert(
    span <= 10 * CODE_TYPE_MAX_VISIBLE_CHAR_MS,
    `typing stretched to ${span}ms; the per-character ceiling should bound it`,
  );
}

// --- 3. A frame swap is a real dwell, not a flicker. ---
assert(FRAME_SWAP_MS >= 2_000, `a frame swap of ${FRAME_SWAP_MS}ms is too brief to read`);

// --- 4. Lesson length follows the material, and familiarity moves it. ---
{
  // Length is no longer a step count handed to the model. A lesson has one
  // step per figure frame, one per code block, an opening and a close, and
  // familiarity decides how long a step is. Two things therefore have to
  // hold: a real program reaches the owner's 6-10 minute band, and a thin one
  // is still a lesson rather than a summary.
  // Read the walk-through length from a real simulator rather than a magic
  // number. An exchange sort now draws one frame per comparison and per swap,
  // so the figure carries roughly twice the beats it used to, and a hardcoded
  // count here would have gone on passing while testing a lesson shape that no
  // longer exists.
  const bubbleWalk = detectAlgorithm("explain bubble sort");
  assert(bubbleWalk, "bubble sort must still route to a simulator for this gate to mean anything");
  const FRAMES = bubbleWalk.trace.frames.length;
  assert(
    FRAMES >= 8,
    `a ${FRAMES}-frame bubble sort is back to one frame per pass, which hides every comparison and swap`,
  );

  // A section may run to 40 lines at 2-4 lines per block, so a two-section
  // program carries roughly this many blocks. That is the shape the live
  // planner returns, and it is what has to land in the band.
  const REALISTIC_BLOCKS = 16;
  const lessonMs = (frames: number, blocks: number, familiarity: "new" | "normal" | "revision") => {
    const beats = codeLessonBeatPlan({
      frames: Array.from({ length: frames }, (_, index) => ({ id: `f${index}`, caption: "x" })),
      blockIds: Array.from({ length: blocks }, (_, index) => `b${index}`),
      familiarity,
    });
    // What the student sits through: the spoken beats plus the pause on each
    // figure swap.
    return beats.length * CODE_LESSON_STEP_MS[familiarity] + Math.max(frames - 1, 0) * FRAME_SWAP_MS;
  };

  const fullMs = lessonMs(FRAMES, REALISTIC_BLOCKS, "normal");
  const band = CODE_LESSON_TARGET_BY_FAMILIARITY.normal;
  assert(
    fullMs >= band.min,
    `a ${REALISTIC_BLOCKS}-block program runs ${(fullMs / 60_000).toFixed(1)} min, under the ` +
      `${band.min / 60_000} min floor`,
  );

  // The shape that actually occurs. Measured over 104 lessons the median plan
  // had three frames and nine blocks; under the old contract that shape could
  // not exceed 3.7 minutes however well it was taught, and no gate noticed
  // because both gates only ever checked the widest imaginable program.
  const medianMs = lessonMs(3, 7, "normal");
  assert(
    medianMs >= band.min,
    `a typical plan of three frames and seven blocks runs ${(medianMs / 60_000).toFixed(1)} min, ` +
      `under the ${band.min / 60_000} min floor`,
  );

  // The ceiling. A lesson nobody sits through teaches nothing, so the widest
  // walk-through any family may emit, against the longest program the format
  // gate allows, must still be watchable.
  const widestMs = lessonMs(16, REALISTIC_BLOCKS, "new");
  assert(
    widestMs <= CODE_LESSON_TARGET_BY_FAMILIARITY.new.max * 2,
    `the widest allowed walk-through runs ${(widestMs / 60_000).toFixed(1)} min, past what a ` +
      "student will sit through",
  );

  for (const question of ["explain binary search", "reverse a linked list", "two sum with a hash map"]) {
    const plan = getMockCodeLessonPlan(question);
    const blocks = plan.sections.flatMap((section) => section.blocks);
    const steps = codeLessonBeatPlan({
      frames: Array.from({ length: FRAMES }, (_, index) => ({ id: `f${index}`, caption: "x" })),
      blockIds: blocks.map((block) => block.id),
      familiarity: "normal",
    }).length;
    const normalMs = steps * CODE_LESSON_STEP_MS.normal;

    // The floor: even the thinnest committed plan is a taught lesson.
    assert(
      normalMs >= 5 * 60_000,
      `"${question}" runs ${(normalMs / 60_000).toFixed(1)} min on Normal, which is a summary ` +
        `(${steps} steps from ${FRAMES} frames and ${blocks.length} blocks)`,
    );

    // Familiarity has to move the lesson, and in the right direction: New
    // teaches the most, Revision the least. A control that changes nothing is
    // the bug this replaces — a code lesson used to ignore familiarity
    // entirely, so all three settings gave the identical lesson.
    const newMs = steps * CODE_LESSON_STEP_MS.new;
    const revisionMs = steps * CODE_LESSON_STEP_MS.revision;
    assert(
      revisionMs < normalMs && normalMs < newMs,
      `"${question}": familiarity must order the lesson lengths, got ` +
        `${revisionMs}/${normalMs}/${newMs} ms`,
    );

    // Typing must not outrun the narration it belongs to: a block that takes
    // longer to type than its beat is spoken leaves silent typing on screen.
    // Revision is the tightest beat, so it is the one that has to hold.
    for (const block of blocks) {
      const typingMs = typingMsFor(block.code, CODE_LESSON_STEP_MS.revision);
      assert(
        typingMs <= CODE_LESSON_STEP_MS.revision * 2,
        `${plan.title}: block ${block.id} types for ${(typingMs / 1000).toFixed(1)}s against a ` +
          `${CODE_LESSON_STEP_MS.revision / 1000}s beat`,
      );
    }

    // Every section must actually carry code, or a "lesson" could hit the
    // band on narration alone.
    for (const section of plan.sections) {
      assert(
        codeLessonSectionCode(section).trim().length > 0,
        `${plan.title}: section ${section.id} has no code to type`,
      );
    }
  }
}

// --- 4b. The figure lands with the sentence that introduces it. ---
{
  // Measured live before this held: a frame swap redrew a 29-command figure at
  // its natural scene pace, about 11 seconds, under 6 seconds of narration.
  // The runner waits for the ink before the next segment speaks, so every beat
  // ended with about three seconds of silence. That pause after every small
  // thing is what the lesson sounded like.
  const frame: DrawCommand = { type: "FRAME", params: [], charPosition: 0, narrationBefore: "" };
  const spokenMs = 6_000;
  const budget = resolveCommandInkBudgetMs({
    command: frame,
    pace: "scene",
    verifiedDiagramIntro: false,
    isTextCommand: false,
    speechWindowMs: spokenMs,
    commandSpeechMs: spokenMs,
    naturalDrawMs: 800,
    multiShapeSegment: false,
  });
  assert(
    budget >= spokenMs * 0.9,
    `a frame swap must be budgeted its whole spoken window, got ${budget}ms of ${spokenMs}ms`,
  );

  // That budget is then split across the figure's own commands, and each one
  // may only be made quicker than its natural pace, never slower.
  const commandCount = 29;
  const wipeMs = 420;
  const perCommandMs = Math.max(Math.floor((budget - wipeMs) / commandCount), 70);
  const drawnMs = commandCount * adaptiveShapeBudget("DRAW_RECT", perCommandMs, 1, "scene");
  assert(
    drawnMs + wipeMs <= spokenMs,
    `a ${commandCount}-command redraw takes ${drawnMs + wipeMs}ms against a ${spokenMs}ms sentence`,
  );

  // A figure label is lettered with the instrument already in hand. Handing it
  // a generous share of the sentence pushes it over the prose threshold and
  // buys an instrument swap per label: measured live, fourteen labels took
  // 441ms each against a 237ms budget, six seconds of a seven second sentence
  // spent swapping pens.
  {
    const labelText = "11";
    const inHandCeilingMs = labelText.length * LETTERED_IN_HAND_MS_PER_CHAR;
    const evenShareMs = 237;
    const labelBudgetMs = Math.min(evenShareMs, inHandCeilingMs);
    assert(
      labelBudgetMs <= inHandCeilingMs,
      `a "${labelText}" label budgeted ${labelBudgetMs}ms crosses the ${inHandCeilingMs}ms swap threshold`,
    );
    // Geometry has no text, so it keeps the whole share.
    assert(evenShareMs > inHandCeilingMs, "the fixture must exercise the clamp");
  }

  // Scene-paced figure text takes the same in-hand budget wherever it is
  // drawn, so the opening figure does not pay a pen swap per cell value.
  {
    const label: DrawCommand = {
      type: "LABEL",
      params: [700, 300],
      text: "11",
      charPosition: 0,
      narrationBefore: "",
    };
    const sceneBudget = resolveCommandInkBudgetMs({
      command: label,
      pace: "scene",
      verifiedDiagramIntro: true,
      isTextCommand: true,
      commandSpeechMs: 4_000,
      naturalDrawMs: 200,
      multiShapeSegment: false,
      sceneBatchDurationMs: 200,
    });
    assert(
      sceneBudget <= 2 * LETTERED_IN_HAND_MS_PER_CHAR,
      `a two-character cell value budgeted ${sceneBudget}ms crosses the swap threshold`,
    );
    // Handwriting is untouched: prose is still written at a followable pace.
    const proseBudget = resolveCommandInkBudgetMs({
      command: { ...label, type: "WRITE", text: "F = ma" },
      pace: "follow",
      verifiedDiagramIntro: false,
      isTextCommand: true,
      speechWindowMs: 2_000,
      commandSpeechMs: 2_000,
      naturalDrawMs: 900,
      multiShapeSegment: false,
    });
    assert(
      proseBudget >= 900,
      `work-column prose must keep its handwriting budget, got ${proseBudget}ms`,
    );
  }

  // A small window must still leave every shape visible rather than flashing.
  const tight = adaptiveShapeBudget("DRAW_RECT", 45, 1, "scene");
  assert(tight >= 70, `a shape may not be drawn in ${tight}ms`);

  // …and a batch cap below that guard must actually reach the shapes. The
  // budget used to be ignored unless it exceeded 100ms, which is precisely the
  // range a capped batch produces, so the cap did nothing at all.
  assert(
    adaptiveShapeBudget("DRAW_RECT", 80, 1, "scene") < adaptiveShapeBudget("DRAW_RECT", undefined, 1, "scene"),
    "a sub-100ms budget must still make a shape quicker than its natural pace",
  );
}

// --- 5. Nothing types after the narration ends. ---
{
  // markLessonComplete used to type every unrevealed block after the turn's
  // telemetry had flushed. The controller now reports them instead, so the
  // method must not be reachable any more.
  assert(
    !("typeRemainingBlocks" in CodeLessonController.prototype),
    "typeRemainingBlocks is back — unrevealed blocks must be reported, never typed in silence",
  );
  assert(
    typeof CodeLessonController.prototype.unrevealedBlockIds === "function",
    "the controller must be able to report which blocks were never revealed",
  );
}

// --- The marker keeps working while a block types. ---
{
  // Reported live on a bubble sort lesson: the board drew, then stopped, and
  // the pen sat at one point while the tutor kept talking. The TYPE handler
  // flew the marker to the caret once and then set the cursor to "idle",
  // which is opacity 0, so for the whole code half of a DSA lesson there was
  // nothing moving on the board at all.
  const source = readFileSync(
    new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf('case "TYPE": {');
  const end = source.indexOf('case "POINT": {', start);
  assert(start > 0, "the TYPE handler moved; repoint this gate at the case that replaced it");
  assert(end > start, "the POINT handler moved; repoint this gate at the case that follows TYPE");
  // Comments in this file quote the old behaviour, so strip them: the gate is
  // about what the handler does, not about what it says it used to do.
  const typeCase = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert(
    !/setCursorState\("idle"\)/.test(typeCase),
    "typing must not hide the marker: idle is opacity 0, so the board looks stopped",
  );
  // Two shapes are accepted: the beat runner, which types the block and then
  // follows the voice line by line (gated on a virtual clock below), or the
  // older inline caret-follow loop until the runner is wired in.
  const usesBeatRunner = /runTypedBlockBeat\(/.test(typeCase);
  if (!usesBeatRunner) {
    assert(
      /while \(typing/.test(typeCase) && /flyCursorTo\(next\.x, next\.y/.test(typeCase),
      "the marker must follow the code caret while the block types",
    );
    assert(
      /CODE_CARET_FOLLOW_MS/.test(typeCase),
      "the follow interval must come from the shared constant, not a literal",
    );
  }
}

// ---------------------------------------------------------------------------
// The board follows the voice.
//
// Measured 10 Sep 2026 on "Explain binary search on the array [1, 3, 5, 7, 9,
// 11] for target 7" at playback 1.5: pen parked 82% of spoken time. Each TYPE
// block was typed in the first 22 to 29% of a 19 to 20 s sentence and then
// nothing moved for 15 s; each FRAME advance drew for 6 s and parked 10 s;
// the FOCUS spotlight fired at +15 s. The sections below pin the replacement:
// a block types within the first 6 s, then the caret and the pen move to each
// line as the voice names it; a frame's pen walks the cells in spoken order.
// ---------------------------------------------------------------------------

/** Alignment at a warped rate: 70 ms per char for the first third, 100 after. */
function warpedTimings(narration: string): AudioTimings {
  const spoken = mathToSpeech(narration.trim());
  const charStartTimes: number[] = [];
  const charDurations: number[] = [];
  let t = 0;
  for (let index = 0; index < spoken.length; index += 1) {
    const step = index < spoken.length / 3 ? 0.07 : 0.1;
    charStartTimes.push(t);
    charDurations.push(step);
    t += step;
  }
  return { charStartTimes, charDurations, totalDuration: t };
}

/** Exact media ms at which `word` (nth occurrence) starts, from the alignment. */
function wordStartMs(narration: string, timings: AudioTimings, word: string, nth = 0): number {
  const spoken = mathToSpeech(narration.trim()).toLowerCase();
  const pattern = new RegExp(`\\b${word}\\b`, "g");
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = pattern.exec(spoken)) !== null) {
    if (seen === nth) return Math.round(timings.charStartTimes[match.index]! * 1000);
    seen += 1;
  }
  throw new Error(`"${word}" is not in the fixture narration`);
}

const SEARCH_BLOCK = "def binary_search(a, target):\n    lo = 0\n    hi = len(a) - 1";
const SEARCH_NARRATION =
  "this first part of the code sets up the search. it defines a function that takes the sorted list and " +
  "the target we are hunting for. then it sets lo to zero, the first index, and hi to the length minus one, " +
  "the last index, so the whole list is in play.";
const LOOP_BLOCK = "    while lo <= hi:\n        mid = (lo + hi) // 2";
const LOOP_NARRATION =
  "this next part is the main engine of the search. it starts a loop that continues while lo is still at " +
  "or below hi, which means there is still something to check. inside, it computes mid by averaging lo and " +
  "hi and rounding down, the middle index of the current range.";
const CHECK_BLOCK = "        if a[mid] == target:\n            return mid";
const CHECK_NARRATION =
  "this block is the first check inside the loop. after finding the middle index, it checks whether the " +
  "value at the middle equals the target. if it does, we return mid right away, that is the index where we found it.";

// --- 6. A three-line block under a 20 s sentence types within the first 6 s. ---
{
  const timings = warpedTimings(SEARCH_NARRATION);
  const sentenceMs = Math.round(timings.totalDuration * 1000);
  assert(sentenceMs >= 18_000 && sentenceMs <= 24_000, `fixture sentence runs ${sentenceMs}ms, not about 20 s`);
  const offsets = codeTypingCharOffsetsMs(SEARCH_BLOCK, SEARCH_BLOCK.length * 95);
  const typedMs = offsets[offsets.length - 1]!;
  assert(
    typedMs <= 6_000,
    `a ${SEARCH_BLOCK.split("\n").length}-line block must be typed within the first 6 s of its sentence, took ${typedMs}ms`,
  );
}

// --- 7. After typing, the caret moves to each line at the spoken identifier. ---
{
  const cases: Array<{ code: string; narration: string; expect: Array<{ line: number; word: string; nth?: number }> }> = [
    {
      code: SEARCH_BLOCK,
      narration: SEARCH_NARRATION,
      expect: [{ line: 0, word: "defines" }, { line: 1, word: "lo" }, { line: 2, word: "hi" }],
    },
    {
      code: LOOP_BLOCK,
      narration: LOOP_NARRATION,
      expect: [{ line: 0, word: "loop" }, { line: 1, word: "mid" }],
    },
    {
      code: CHECK_BLOCK,
      narration: CHECK_NARRATION,
      expect: [{ line: 0, word: "middle" }, { line: 1, word: "return" }],
    },
  ];
  for (const { code, narration, expect } of cases) {
    const timings = warpedTimings(narration);
    const exact = codeLineAnchors(code, spokenTimeline(narration, timings));
    const first = code.split("\n")[0]!.trim();
    assert(exact.length >= expect.length, `"${first}": expected ${expect.length} line anchors, got ${exact.length}`);
    const lines = exact.map((anchor) => anchor.lineIndex);
    for (let index = 1; index < exact.length; index += 1) {
      assert(exact[index]!.startMs >= exact[index - 1]!.startMs, `"${first}": anchors must be in spoken order`);
      assert(exact[index - 1]!.endMs === exact[index]!.startMs, `"${first}": an anchor lasts until the next one`);
    }
    for (const want of expect) {
      const anchor = exact.find((candidate) => candidate.lineIndex === want.line);
      assert(anchor, `"${first}": line ${want.line} was never anchored (anchored lines: ${lines.join(",")})`);
      const spokenAt = wordStartMs(narration, timings, want.word, want.nth ?? 0);
      const drift = Math.abs(anchor.startMs - spokenAt);
      assert(
        drift <= 300,
        `"${first}": line ${want.line} anchored at ${anchor.startMs}ms, "${want.word}" is spoken at ${spokenAt}ms (${drift}ms off)`,
      );
    }
    // The same lines, in the same order, when the alignment has not arrived:
    // the estimate stands in, at the measured 86 ms per character.
    const estimated = codeLineAnchors(code, spokenTimeline(narration, null));
    assert(
      expect.every((want) => estimated.some((anchor) => anchor.lineIndex === want.line)),
      `"${first}": the estimated fallback must anchor the same lines`,
    );
    const order = (anchors: typeof exact) => anchors.map((anchor) => anchor.lineIndex).join(">");
    assert(order(estimated) === order(exact), `"${first}": estimated order ${order(estimated)} differs from exact ${order(exact)}`);
    const schedule = codeBlockSpokenSchedule(code, narration, timings);
    assert(schedule.source === "tts" && schedule.unspokenLines.length === 0, `"${first}": every line of the block is named`);
  }

  // A clause that names nothing moves nothing: "if" alone is not a line.
  const idle = codeLineAnchors(CHECK_BLOCK, spokenTimeline("if you look at the figure, nothing has changed yet.", null));
  assert(idle.length === 0, `an aside about the figure must not move the caret, got ${idle.length} anchors`);
}

// --- 8. A frame walk covers every named cell, in spoken order. ---
const FRAME_NARRATION =
  "the algorithm has made its first move. it calculated the middle index of the current range, which is 3, " +
  "and looked at the value there, which is 12. since 12 is less than 16, our target, the answer cannot be at " +
  "index 3 or anywhere to its left, so lo moves up to index 4 and everything from index 0 through 3 is dropped from the range.";
const walkFrames = resolveDsaFrames("Explain binary search on the array [1, 3, 5, 7, 9, 11] for target 7");
assert(walkFrames && walkFrames.frames.length >= 3, "binary search must still compile a walk-through for this gate to mean anything");
const probeFrame = walkFrames.frames[1]!;
{
  const anchors = probeFrame.presentation.diagram.anchors;
  const midPointer = anchors.find((anchor) => /^ptr\d+$/.test(anchor.id) && /\bmid\b/.test(anchor.labels[1] ?? ""));
  assert(midPointer, "the second frame must carry a mid pointer");
  const timings = warpedTimings(FRAME_NARRATION);
  const stops = frameSpokenWalk(anchors, spokenTimeline(FRAME_NARRATION, timings));
  const ids = stops.map((stop) => stop.id);
  // The parts the voice names, as it names them.
  const spokenOrder: Array<{ id: string; word: string; nth?: number }> = [
    { id: midPointer.id, word: "middle" },
    { id: "idx3", word: "3", nth: 0 },
    { id: "cell3", word: "12", nth: 0 },
    { id: "note0", word: "16" },
    { id: "idx4", word: "4" },
    { id: "idx0", word: "0" },
  ];
  let cursor = -1;
  for (const want of spokenOrder) {
    const at = ids.indexOf(want.id, cursor + 1);
    assert(at > cursor, `the walk must reach ${want.id} for "${want.word}" after ${cursor < 0 ? "the start" : ids[cursor]} (walk: ${ids.join(" ")})`);
    const spokenAt = wordStartMs(FRAME_NARRATION, timings, want.word, want.nth ?? 0);
    const drift = Math.abs(stops[at]!.startMs - spokenAt);
    assert(drift <= 300, `${want.id} is reached at ${stops[at]!.startMs}ms, "${want.word}" is spoken at ${spokenAt}ms`);
    cursor = at;
  }
  for (let index = 1; index < stops.length; index += 1) {
    assert(stops[index]!.startMs >= stops[index - 1]!.startMs, "stops must be in spoken order");
  }
  // "dropped" sweeps the excluded cells on the frame that has them.
  const droppedFrame = walkFrames.frames[2]!;
  const sweep = frameSpokenWalk(
    droppedFrame.presentation.diagram.anchors,
    spokenTimeline("everything to the left of mid is dropped.", null),
  );
  const excluded = droppedFrame.presentation.diagram.anchors
    .filter((anchor) => /excluded/.test(anchor.labels[1] ?? ""))
    .map((anchor) => (/cell\d+/.exec(anchor.labels[1] ?? "") ?? [""])[0]);
  assert(excluded.length >= 3, "the third frame must mark excluded cells");
  for (const cell of excluded) {
    assert(sweep.some((stop) => stop.id === cell), `"dropped" must sweep ${cell} (walk: ${sweep.map((stop) => stop.id).join(" ")})`);
  }
}

/**
 * A pen and a clock. Rests and flights are timers on a virtual wall clock
 * that advances to the earliest pending wake, so two loops sleeping at once
 * overlap the way they do in real time rather than adding up. Media time
 * runs at `rate`, as the live lecture does.
 */
function fakeBoard(rate: number) {
  let wall = 0;
  const timers: Array<{ at: number; resolve: () => void }> = [];
  let drainScheduled = false;
  const drain = () => {
    drainScheduled = false;
    if (timers.length === 0) return;
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift()!;
    wall = Math.max(wall, next.at);
    next.resolve();
    scheduleDrain();
  };
  const scheduleDrain = () => {
    if (drainScheduled) return;
    drainScheduled = true;
    // A macrotask, so every loop woken by the last timer has re-armed its
    // own timer before the clock moves again.
    setImmediate(drain);
  };
  const delay = (ms: number): Promise<void> => {
    assert(ms >= 0 && Number.isFinite(ms), `a rest must not be negative, got ${ms}`);
    return new Promise((resolve) => {
      timers.push({ at: wall + ms, resolve });
      scheduleDrain();
    });
  };
  const moves: Array<{ x: number; y: number; atMediaMs: number }> = [];
  const states: string[] = [];
  const media = () => wall * rate;
  const host = {
    flyCursorTo: async (x: number, y: number, durationMs: number) => {
      assert(durationMs > 0 && Number.isFinite(durationMs), `a flight must have a positive duration, got ${durationMs}`);
      // Hops are media ms; the whiteboard scales them by the playback rate.
      await delay(durationMs / rate);
      moves.push({ x, y, atMediaMs: media() });
    },
    setCursorState: (state: string) => void states.push(state),
  };
  return {
    host,
    moves,
    states,
    media,
    clock: { getAudioPositionMs: media, getPlaybackRate: () => rate },
    now: () => wall,
    delay,
  };
}

// --- 9. The pen reaches each named cell at its word, never rests past the limit, and halts for a spotlight. ---
async function spokenBoardGates(): Promise<void> {
{
  const rate = 1.5;
  const stops: FrameWalkStop[] = [
    { id: "a", x: 100, y: 100, width: 50, height: 50, token: "a", startMs: 1_000, endMs: 3_000 },
    { id: "b", x: 300, y: 100, width: 50, height: 50, token: "b", startMs: 3_000, endMs: 12_000 },
    { id: "c", x: 500, y: 100, width: 50, height: 50, token: "c", startMs: 12_000, endMs: 20_000 },
  ];
  const board = fakeBoard(rate);
  const idleStops = [{ x: 700, y: 300 }, { x: 900, y: 300 }];
  const result = await walkSpokenStops(board.host, stops, board.clock, {
    untilMs: 20_000,
    isCancelled: () => false,
    delay: board.delay,
    now: board.now,
    idleStops,
  });
  assert(!result.cancelled && result.visited.join(",") === "a,b,c", `visited ${result.visited.join(",")}`);
  for (const stop of stops) {
    const arrival = board.moves.find((move) => move.x === stop.x + stop.width / 2 && move.y === stop.y);
    assert(arrival, `the pen never reached ${stop.id}`);
    const late = arrival.atMediaMs - stop.startMs;
    assert(late >= 0 && late <= 700, `${stop.id} reached ${late}ms after its word (hop is 620 media ms at most)`);
  }
  // Nine seconds without a named part: the pen wanders rather than parks.
  let longestRest = 0;
  for (let index = 1; index < board.moves.length; index += 1) {
    longestRest = Math.max(longestRest, board.moves[index]!.atMediaMs - board.moves[index - 1]!.atMediaMs);
  }
  assert(
    longestRest <= SPOKEN_WALK_REST_MAX_MS + 700,
    `the pen rested ${longestRest}ms between moves inside a 20 s sentence`,
  );
  const wandered = board.moves.some((move) => idleStops.some((idle) => idle.x === move.x && idle.y === move.y));
  assert(wandered, "a long silence about the figure must send the pen over the idle stops");
  assert(board.media() <= 20_000 - SPOKEN_WALK_TAIL_MS + 60, `the walk ran to ${board.media()}ms of a 20 s sentence`);
  assert(board.media() >= 20_000 - SPOKEN_WALK_TAIL_MS - 700, `the walk gave up at ${board.media()}ms, leaving the pen parked`);
  assert(!board.states.includes("idle"), "the walk must never set the pen to idle (opacity 0)");

  // The spotlight's target halts the walk on its word, with the pen still on b.
  const halting = fakeBoard(rate);
  const halted = await walkSpokenStops(halting.host, stops, halting.clock, {
    untilMs: 20_000,
    isCancelled: () => false,
    delay: halting.delay,
    now: halting.now,
    stopBeforeIds: new Set(["c"]),
  });
  assert(halted.haltedAt?.id === "c", "the walk must halt before the spotlight target");
  assert(Math.abs(halting.media() - 12_000) <= 60, `halted at ${halting.media()}ms, the target is named at 12000ms`);
  assert(halted.visited.join(",") === "a,b", "everything before the target is still visited");
}

// --- 10. The typed beat end to end on a virtual clock: typed by 6 s, then line by line on the words. ---
{
  const rate = 1.5;
  const plan: CodeLessonPlan = {
    schemaVersion: "code-lesson/v1",
    question: "explain binary search",
    title: "Binary search",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "Search",
        explanation: "The search.",
        blocks: [
          { id: "s1b1", code: SEARCH_BLOCK },
          { id: "s1b2", code: LOOP_BLOCK },
        ],
        typeAlongRanges: [],
      },
    ],
    diagramHint: null,
  } as unknown as CodeLessonPlan;
  const controller = new CodeLessonController();
  controller.commit(plan);
  const board = fakeBoard(rate);
  const timings = warpedTimings(SEARCH_NARRATION);
  const spokenLines: Array<{ line: number; atMediaMs: number }> = [];
  controller.subscribe(() => {
    const spoken = controller.getState().spokenLine;
    const last = spokenLines[spokenLines.length - 1];
    if (spoken && (!last || last.line !== spoken.lineIndex)) spokenLines.push({ line: spoken.lineIndex, atMediaMs: board.media() });
  });
  const result = await runTypedBlockBeat({
    host: board.host,
    controller,
    blockId: "s1b1",
    clock: {
      narration: SEARCH_NARRATION,
      getTimings: () => timings,
      estimatedTotalMs: SEARCH_NARRATION.length * 86,
      getAudioPositionMs: board.clock.getAudioPositionMs,
      getPlaybackRate: board.clock.getPlaybackRate,
    },
    isCancelled: () => false,
    delay: board.delay,
    now: board.now,
  });
  assert(!result.cancelled, "the beat must run to the end");
  assert(result.typedMs <= 6_000, `the block was typed by ${result.typedMs}ms; it must land within the first 6 s`);
  assert(controller.getState().revealedChars.s1b1 === SEARCH_BLOCK.length, "the whole block is revealed");
  assert(result.linesVisited.join(",") === "0,1,2", `lines visited ${result.linesVisited.join(",")}`);
  for (const [line, word] of [[1, "lo"], [2, "hi"]] as const) {
    const shown = spokenLines.find((entry) => entry.line === line);
    assert(shown, `line ${line} was never highlighted`);
    const spokenAt = wordStartMs(SEARCH_NARRATION, timings, word);
    assert(
      Math.abs(shown.atMediaMs - spokenAt) <= 300,
      `line ${line} highlighted at ${shown.atMediaMs}ms, "${word}" spoken at ${spokenAt}ms`,
    );
    const span = codeLessonLineBoardSpan(controller.getState(), "s1b1", line)!;
    const read = board.moves.find((move) => move.y === span.y && move.x === span.x1);
    assert(read, `the pen never read along line ${line}`);
  }
  const sentenceMs = Math.round(timings.totalDuration * 1000);
  const movesAfterTyping = board.moves.filter((move) => move.atMediaMs > result.typedMs);
  assert(movesAfterTyping.length >= 4, `the pen moved ${movesAfterTyping.length} times after typing; it should read each line`);
  assert(board.media() >= sentenceMs - SPOKEN_WALK_TAIL_MS - 700 && board.media() <= sentenceMs, `the beat ended at ${board.media()}ms of a ${sentenceMs}ms sentence`);
  assert(controller.getState().spokenLine === null, "the spoken line is cleared when the sentence ends");
  assert(board.states[board.states.length - 1] === "thinking" && !board.states.includes("idle"), "the pen ends thinking, never idle");

  // The frame beat wrapper on the real frame: every named part visited, and
  // the spotlight's target halts it on its word.
  const frameBoard = fakeBoard(rate);
  const frameTimings = warpedTimings(FRAME_NARRATION);
  const frameResult = await runFrameWalkBeat({
    host: frameBoard.host,
    anchors: probeFrame.presentation.diagram.anchors,
    clock: {
      narration: FRAME_NARRATION,
      getTimings: () => frameTimings,
      estimatedTotalMs: FRAME_NARRATION.length * 86,
      getAudioPositionMs: frameBoard.clock.getAudioPositionMs,
      getPlaybackRate: frameBoard.clock.getPlaybackRate,
    },
    isCancelled: () => false,
    delay: frameBoard.delay,
    now: frameBoard.now,
    stopBeforeIds: probeFrame.focusEntityIds,
  });
  assert(frameResult.haltedAt?.id === "cell3", `the walk must halt at the spotlight target cell3, got ${frameResult.haltedAt?.id ?? "nothing"}`);
  const twelveAt = wordStartMs(FRAME_NARRATION, frameTimings, "12");
  assert(Math.abs(frameBoard.media() - twelveAt) <= 60, `halted at ${frameBoard.media()}ms; "12" is spoken at ${twelveAt}ms`);
  assert(frameResult.visited.includes("idx3"), "the parts named before the target are visited on the way");
}
}

spokenBoardGates()
  .then(() => {
    console.log(
      "verify-code-lesson-pace: cap, per-character rate, frame dwell, the 6-10 minute band, familiarity, " +
        "a block typed within 6 s then read line by line on the words, and a frame walked in spoken order all hold",
    );
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
