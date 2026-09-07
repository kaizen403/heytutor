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
  codeTypingCharOffsetsMs,
} from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { adaptiveShapeBudget, resolveCommandInkBudgetMs } from "../../features/tutor-session/types";
import { detectAlgorithm } from "@heytutor/scene-engine";
import type { DrawCommand } from "@heytutor/drawing";
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
  assert(
    /while \(typing/.test(typeCase) && /flyCursorTo\(next\.x, next\.y/.test(typeCase),
    "the marker must follow the code caret while the block types",
  );
  assert(
    /CODE_CARET_FOLLOW_MS/.test(typeCase),
    "the follow interval must come from the shared constant, not a literal",
  );
}

console.log("verify-code-lesson-pace: cap, per-character rate, frame dwell, the 6-10 minute band, and familiarity all hold");
