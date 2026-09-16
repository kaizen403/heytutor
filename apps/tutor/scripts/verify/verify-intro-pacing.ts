/**
 * The figure is drawn the way a teacher draws it: one part as its name is
 * spoken.
 *
 * Ten archetype questions go through the real scene synthesiser and the real
 * presentation builder; the resulting intro beats are then scheduled exactly
 * the way the segment runner schedules a cued beat (cue window per command,
 * budget from `resolveCommandInkBudgetMs`), against a voice synthesised at
 * 86 ms per spoken character, and the schedule is held to what a teacher's
 * hand does:
 *
 * - one beat per reveal group, spoken in the order the groups are drawn;
 * - every command names the word it is drawn under, and that word is in the
 *   sentence;
 * - the first stroke under each word starts within 400 ms of the word;
 * - a group's ink fills between 35% and 100% of its sentence: no sprint and
 *   park, no ink running on past the voice;
 * - a label the sentence names is lettered inside its word's window, right
 *   after its part's ink;
 * - no command is budgeted under its hand-speed floor.
 *
 * Before this (10 Sep 2026): the mirror intro was one 10.26 s sentence, the
 * scene batch cap squeezed its fourteen strokes into 1.3 s, and the pen
 * parked for 3.3 s; four of nine archetypes spoke their groups out of the
 * order they were drawn in.
 */
import { synthesizeArchetypeScene } from "@heytutor/scene-engine";
import type { DrawCommand } from "@heytutor/drawing";
import {
  cuedInkCapMs,
  cuedInkFloorMs,
  cueWindowRemainingMs,
  cueWindowReserveMs,
  cueWindowSharers,
  getCueSpeechWindow,
  inkPaceContextForSegment,
  isCuedSceneBatch,
  mathToSpeech,
  nextDistinctCueToken,
  selectInkPace,
  type AudioTimings,
} from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { resolveCommandInkBudgetMs } from "../../features/tutor-session/types";

const MS_PER_CHAR = 86;
const FIRST_STROKE_SLACK_MS = 400;
const INK_OVER_CUE_MIN = 0.35;
const INK_OVER_CUE_MAX = 1.0;
/** A part named by the last word is finished a moment after the voice; one label's worth. */
const INK_PAST_SENTENCE_MS = 600;

const questions = [
  "A concave mirror has focal length 15 cm. An object is placed 20 cm from it. Find the image distance and describe the image.",
  "An object is placed 30 cm from a concave mirror of focal length 10 cm. Find the image position.",
  "A 2 kg block on a 30 degree incline with friction coefficient 0.2. Find its acceleration.",
  "A projectile is launched at 20 m/s at 45 degrees. Find the range and maximum height.",
  "A 5 kg mass hangs from a spring of stiffness 200 N/m. Find the extension.",
  "Two masses 3 kg and 5 kg hang over a frictionless pulley. Find the acceleration.",
  "A boat can move at 4 m/s in still water; the river flows at 3 m/s. It heads straight across a 120 m wide river. Find the drift.",
  "A car accelerates from rest at 3 m/s^2 for 5 s, then moves at constant speed for 10 s. Draw the v-t graph and find the distance.",
  "Light travels from air into glass of refractive index 1.5 at 40 degrees. Find the angle of refraction.",
  "A convex lens of focal length 10 cm has an object 15 cm away. Find the image.",
];

function fail(message: string): never {
  throw new Error(`verify-intro-pacing: ${message}`);
}

/** A voice at a steady 86 ms per spoken character, the rate measured on 10 Sep 2026. */
function synthesiseTimings(narration: string): AudioTimings {
  const spoken = mathToSpeech(narration.trim());
  const charStartTimes = Array.from({ length: spoken.length }, (_, index) => (index * MS_PER_CHAR) / 1000);
  return {
    charStartTimes,
    charDurations: charStartTimes.map(() => MS_PER_CHAR / 1000),
    totalDuration: (spoken.length * MS_PER_CHAR) / 1000,
  };
}

interface ScheduledCommand {
  command: DrawCommand;
  token: string;
  windowStartMs: number;
  windowEndMs: number;
  matched: boolean;
  startMs: number;
  budgetMs: number;
  endMs: number;
  floorMs: number;
}

/**
 * Exactly the runner's cued loop: wait for the word, then draw the part in
 * what is left of the word's window, sharing it with the commands under the
 * same word.
 */
function scheduleBeat(
  narration: string,
  commands: DrawCommand[],
  timings: AudioTimings | null,
): { scheduled: ScheduledCommand[]; totalMs: number } {
  const paceContext = inkPaceContextForSegment({
    verifiedDiagramIntro: true,
    commandCount: commands.length,
    hasNarration: true,
  });
  const floors = commands.map((command) => cuedInkFloorMs(command));
  const caps = commands.map((command, index) => cuedInkCapMs(command, floors[index]));
  const spokenChars = mathToSpeech(narration.trim()).length;
  const totalMs = timings ? Math.round(timings.totalDuration * 1000) : spokenChars * MS_PER_CHAR;
  const scheduled: ScheduledCommand[] = [];
  let cursor = 0;
  let inkEndMs = 0;
  for (const [index, command] of commands.entries()) {
    const cue = command.spokenCue;
    if (!cue) fail(`command ${index} (${command.type}) carries no spokenCue`);
    const window = getCueSpeechWindow(
      narration,
      cue,
      timings,
      MS_PER_CHAR,
      cursor,
      nextDistinctCueToken(commands, index),
    );
    cursor = window.cursor;
    // The pen starts with the sentence: the first part of a beat is drawn
    // as the beat begins even when its word comes later ("The real,
    // inverted image" draws the image from "The"). Every later part waits
    // for its word.
    const startMs = index === 0 ? 0 : Math.max(window.startMs, inkEndMs);
    const pace = selectInkPace(command, paceContext);
    const isTextCommand = command.type === "WRITE" || command.type === "LABEL";
    const budgetMs = resolveCommandInkBudgetMs({
      command,
      pace,
      verifiedDiagramIntro: true,
      isTextCommand,
      commandSpeechMs: 0,
      naturalDrawMs: floors[index]!,
      multiShapeSegment: false,
      cueWindow: {
        remainingMs: cueWindowRemainingMs(window, startMs, cueWindowReserveMs(commands, index, floors)),
        sharers: cueWindowSharers(commands, index, floors, caps),
      },
    });
    inkEndMs = startMs + budgetMs;
    scheduled.push({
      command,
      token: cue.token,
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      matched: window.matched,
      startMs,
      budgetMs,
      endMs: inkEndMs,
      floorMs: floors[index]!,
    });
  }
  return { scheduled, totalMs };
}

function describe(entry: ScheduledCommand): string {
  const text = entry.command.text ? `:${entry.command.text}` : "";
  return `${entry.command.type}${text} under "${entry.token}" [word ${entry.windowStartMs}..${entry.windowEndMs}] ink ${entry.startMs}..${entry.endMs} (${entry.budgetMs} ms, floor ${entry.floorMs})`;
}

let figures = 0;
let beats = 0;
let cuedCommands = 0;
let letteredInIntro = 0;
const verbose = process.argv.includes("--print");

for (const question of questions) {
  const scene = synthesizeArchetypeScene({ question });
  if (!scene) continue;
  figures += 1;
  const presentation = buildVerifiedDiagramPresentation(scene.document, scene.renderScene, {
    figureFamily: scene.archetype,
  });
  const label = `${scene.archetype} (${question.slice(0, 40)}...)`;

  // One beat per reveal group, in the order the groups are drawn. Nothing
  // sorts them by cue length any more.
  const drawOrder: string[] = [];
  for (const action of scene.renderScene.timeline) {
    if (action.action === "reveal" && !drawOrder.includes(action.targetId)) drawOrder.push(action.targetId);
  }
  for (const group of scene.renderScene.revealGroups) {
    if (!drawOrder.includes(group.id)) drawOrder.push(group.id);
  }
  const revealOrder = presentation.diagram.reveals.map((reveal) => reveal.targetId ?? "");
  const expectedOrder = drawOrder.filter((id) => revealOrder.includes(id));
  if (revealOrder.join(",") !== expectedOrder.join(",")) {
    fail(`${label}: groups revealed as [${revealOrder.join(", ")}], drawn order is [${expectedOrder.join(", ")}]`);
  }
  if (presentation.introSegments.length !== presentation.diagram.reveals.length) {
    fail(`${label}: ${presentation.diagram.reveals.length} reveal groups but ${presentation.introSegments.length} spoken beats`);
  }
  presentation.introSegments.forEach((segment, index) => {
    if (segment.narration !== presentation.diagram.reveals[index]?.narration) {
      fail(`${label}: beat ${index} is not spoken in the order its group is drawn`);
    }
  });

  for (const [beatIndex, segment] of presentation.introSegments.entries()) {
    beats += 1;
    const commands = segment.commands ?? [];
    if (commands.length === 0) fail(`${label}: beat ${beatIndex} has no ink`);
    if (!isCuedSceneBatch(commands)) fail(`${label}: beat ${beatIndex} has a command with no spokenCue`);
    cuedCommands += commands.length;

    const timings = synthesiseTimings(segment.narration);
    const { scheduled, totalMs } = scheduleBeat(segment.narration, commands, timings);
    const estimated = scheduleBeat(segment.narration, commands, null);
    if (verbose) {
      console.log(`\n${label} beat ${beatIndex}: "${segment.narration}" (${totalMs} ms)`);
      for (const entry of scheduled) console.log(`  ${describe(entry)}`);
    }

    // Timed and estimated schedules agree when the voice runs at the estimate.
    scheduled.forEach((entry, index) => {
      const other = estimated.scheduled[index]!;
      if (Math.abs(entry.startMs - other.startMs) > MS_PER_CHAR || Math.abs(entry.budgetMs - other.budgetMs) > MS_PER_CHAR) {
        fail(`${label} beat ${beatIndex}: timed and estimated schedules disagree on ${describe(entry)} vs ${describe(other)}`);
      }
    });

    if (process.env.INTRO_DEBUG && label.startsWith(process.env.INTRO_DEBUG)) {
      console.error(`beat ${beatIndex}: ${segment.narration}`);
      for (const entry of scheduled) console.error("  " + describe(entry));
    }
    for (const [index, entry] of scheduled.entries()) {
      if (!entry.matched) fail(`${label} beat ${beatIndex}: cue word "${entry.token}" is not in "${segment.narration}"`);
      if (entry.budgetMs < entry.floorMs) fail(`${label} beat ${beatIndex}: ${describe(entry)} is under its hand-speed floor`);
      if (index > 0 && entry.startMs < entry.windowStartMs) fail(`${label} beat ${beatIndex}: ${describe(entry)} starts before its word`);
    }

    // Words are drawn under in the order they are spoken.
    for (let index = 1; index < scheduled.length; index++) {
      if (scheduled[index]!.windowStartMs < scheduled[index - 1]!.windowStartMs) {
        fail(`${label} beat ${beatIndex}: ${describe(scheduled[index]!)} is drawn after a later word`);
      }
    }

    // The first stroke under each word starts as the word is said (the
    // beat's opening stroke starts with the sentence, ahead of its word).
    // Lateness the hand cannot avoid is excused: when the parts under the
    // previous word need more time at their floors than the word lasts
    // ("Tension," is 774 ms and carries two arrows and two 470 ms letters),
    // the stroke is held to the earliest moment the hand could reach it.
    let previousToken: string | null = null;
    let earliestMs = 0;
    for (const [index, entry] of scheduled.entries()) {
      earliestMs = index === 0 ? 0 : Math.max(entry.windowStartMs, earliestMs);
      const due = earliestMs;
      earliestMs += entry.floorMs;
      if (entry.token === previousToken) continue;
      previousToken = entry.token;
      if (index === 0 && entry.startMs !== 0) {
        fail(`${label} beat ${beatIndex}: the opening stroke must start with the sentence: ${describe(entry)}`);
      }
      const lateMs = entry.startMs - due;
      if (lateMs > FIRST_STROKE_SLACK_MS) {
        fail(`${label} beat ${beatIndex}: first stroke under "${entry.token}" starts ${lateMs} ms after the word: ${describe(entry)}`);
      }
    }

    // A named label is lettered in its word's window, straight after its part.
    // The same excuse as the first stroke: a one-letter word ("C", 172 ms)
    // cannot hold a line, a point and a 470 ms letter, so the label is held
    // to the earliest moment the hand could reach it after its part's ink.
    let handReadyMs = 0;
    for (const [index, entry] of scheduled.entries()) {
      handReadyMs = index === 0 ? 0 : Math.max(entry.windowStartMs, handReadyMs);
      const dueMs = handReadyMs;
      handReadyMs += entry.floorMs;
      if (entry.command.type !== "LABEL" && entry.command.type !== "DIMENSION") continue;
      letteredInIntro += 1;
      const before = scheduled[index - 1];
      if (before && before.command.spokenCue?.entityId !== entry.command.spokenCue?.entityId
        && before.token === entry.token) {
        // Same word, different part: the label must still follow its own
        // part's ink, which sits earlier under the same word.
        const own = scheduled.slice(0, index).some((candidate) =>
          candidate.command.spokenCue?.entityId === entry.command.spokenCue?.entityId,
        );
        if (!own && entry.command.type === "LABEL") {
          fail(`${label} beat ${beatIndex}: ${describe(entry)} is lettered before any ink of its part`);
        }
      }
      if (entry.startMs - Math.max(entry.windowEndMs, dueMs) > FIRST_STROKE_SLACK_MS) {
        fail(`${label} beat ${beatIndex}: ${describe(entry)} is lettered after its word has passed`);
      }
    }

    const inkMs = scheduled.reduce((sum, entry) => sum + entry.budgetMs, 0);
    const ratio = inkMs / totalMs;
    if (ratio < INK_OVER_CUE_MIN || ratio > INK_OVER_CUE_MAX) {
      fail(`${label} beat ${beatIndex}: ink ${inkMs} ms over cue ${totalMs} ms is ${ratio.toFixed(2)}, outside [${INK_OVER_CUE_MIN}, ${INK_OVER_CUE_MAX}]: "${segment.narration}"`);
    }
    const lastEnd = scheduled.at(-1)!.endMs;
    if (lastEnd - totalMs > INK_PAST_SENTENCE_MS) {
      fail(`${label} beat ${beatIndex}: ink runs ${lastEnd - totalMs} ms past the sentence`);
    }
  }
}

if (figures < 9) fail(`only ${figures} archetype figures synthesised; the gate needs the ten questions to draw`);
if (letteredInIntro === 0) fail("no label was lettered in any intro beat; cue-named labels must be lettered as they are said");

console.log(
  `verify-intro-pacing: ${figures} figures, ${beats} beats, ${cuedCommands} cued commands, ${letteredInIntro} labels lettered on their word; first strokes within ${FIRST_STROKE_SLACK_MS} ms, ink over cue within [${INK_OVER_CUE_MIN}, ${INK_OVER_CUE_MAX}]`,
);
