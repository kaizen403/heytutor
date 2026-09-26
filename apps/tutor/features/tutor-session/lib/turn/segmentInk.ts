import {
  resolveVerifiedDiagramFocusTargets,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  capSceneBatchDurations,
  catchUpWriteScheduleOffsets,
  classifyTtsScheduleUse,
  cuedInkCapMs,
  cuedInkFloorMs,
  cueWindowRemainingMs,
  cueWindowReserveMs,
  cueWindowSharers,
  getBestWriteCharScheduleMs,
  getCommandDrawDurationMs,
  getCommandSpeechWindow,
  getCueSpeechWindow,
  getFocusTargetSchedule,
  inkPaceContextForSegment,
  isCuedSceneBatch,
  leadWriteScheduleToSpeech,
  nextDistinctCueToken,
  selectInkPace,
  validateAudioTimingsForNarration,
  type AudioTimings,
  type InkPace,
} from "@heytutor/tutor-core";
import { waitUntilDrawClock } from "@/lib/replay/replayAudio";
import { resolveCommandInkBudgetMs } from "../../types";
import type { ExecuteCommandOptions } from "../../hooks/turn/types";
import { orderCommandsBySpokenAnchor } from "./segmentPlanning";

/**
 * How one sentence's ink is paced against its voice.
 *
 * The live lesson and a replay of it draw the same sentence the same way, so
 * this is the one place that decides it: which command waits for which word,
 * how long each gets, and in what order they run. Only the voice differs — the
 * live runner hands in the streaming speech clock, replay the recorded clip —
 * and that arrives through `SegmentInkClock`.
 */

export type SegmentInkPlan = {
  commands: DrawCommand[];
  paces: InkPace[];
  pacedDurations: number[];
  totalDrawWeight: number;
  multiShapeSegment: boolean;
  /** Every command names the word it is drawn under (a figure intro). */
  cuedIntro: boolean;
  sceneBatchDurations: number[] | null;
  cuedFloors: number[] | null;
  cuedCaps: number[] | null;
};

export function planSegmentInk(input: {
  commands: DrawCommand[];
  verifiedDiagramIntro: boolean;
  hasNarration: boolean;
  sceneText?: boolean;
}): SegmentInkPlan {
  const { commands, verifiedDiagramIntro } = input;
  const paceContext = inkPaceContextForSegment({
    verifiedDiagramIntro,
    commandCount: commands.length,
    hasNarration: input.hasNarration,
    sceneText: input.sceneText === true,
  });
  const paces = commands.map((command) => selectInkPace(command, paceContext));
  const pacedDurations = commands.map((command, commandIndex) =>
    getCommandDrawDurationMs(command, paces[commandIndex]),
  );
  // A cued intro (every command names the word it is drawn under) is
  // paced by the voice, one part per word. The batch cap is what
  // squeezed a 10 s mirror intro into 1.3 s of ink and a 3.3 s parked
  // pen; a DSA frame carries no cues and keeps it.
  const cuedIntro = verifiedDiagramIntro && isCuedSceneBatch(commands);
  const cuedFloors = cuedIntro ? commands.map((command) => cuedInkFloorMs(command)) : null;
  return {
    commands,
    paces,
    pacedDurations,
    totalDrawWeight: pacedDurations.reduce((sum, ms) => sum + ms, 0),
    multiShapeSegment:
      commands.filter((command) =>
        ["DRAW_CIRCLE", "DRAW_LINE", "DRAW_RECT", "DRAW_CUBE", "DRAW_CUBOID"].includes(command.type),
      ).length > 1,
    cuedIntro,
    sceneBatchDurations: verifiedDiagramIntro && !cuedIntro ? capSceneBatchDurations(pacedDurations) : null,
    cuedFloors,
    cuedCaps: cuedFloors
      ? commands.map((command, commandIndex) => cuedInkCapMs(command, cuedFloors[commandIndex]))
      : null,
  };
}

/** The voice a sentence's ink follows: live TTS or the recorded clip. */
export type SegmentInkClock = {
  narration: string;
  /** The sentence's alignment once it exists. Read at every use: live alignment arrives while it plays. */
  getTimings: () => AudioTimings | null;
  /** A window source for pointing and shapes before `getTimings` has one. */
  fallbackTimings?: AudioTimings | null;
  /** The sentence's length in media ms when there is no alignment. */
  totalSpeechMs: number;
  /** The runner's estimate of the sentence, media ms, for the code panel. */
  estimatedSpeechMs: number;
  msPerChar?: number;
  /** Media ms since this sentence's audio started. */
  getAudioPositionMs: () => number;
  /** Media ms per wall ms. */
  getPlaybackRate: () => number;
  /** Holds a word wait without spending its deadline while the lesson is paused. */
  isPaused?: () => boolean;
  nowMs?: () => number;
  /** The voice has ended; a code block still typing finishes on the wall clock. */
  isSpeechComplete?: () => boolean;
  canAdvanceAfterSpeech?: () => boolean;
};

type TraceMetadata = Record<string, unknown>;

export type SegmentInkTrace = {
  reordered?: (order: string) => void;
  writeScheduleReady?: (metadata: TraceMetadata) => void;
  writeCharStart?: (metadata: TraceMetadata) => void;
  focusScheduleReady?: (metadata: TraceMetadata) => void;
  cueWindowReady?: (metadata: TraceMetadata) => void;
};

export async function drawSegmentInk(input: {
  plan: SegmentInkPlan;
  verifiedDiagramIntro: boolean;
  clock: SegmentInkClock;
  /** The committed figure FOCUS resolves against, read per command. */
  getDiagram: () => VerifiedDiagram | null;
  isCancelled: () => boolean;
  waitWhilePaused: () => Promise<boolean>;
  execute: (command: DrawCommand, options: ExecuteCommandOptions) => Promise<void>;
  /** Ownership, layout and cancellation every command of this sentence carries. */
  commandOptions: (command: DrawCommand) => ExecuteCommandOptions;
  beforeCommand?: () => void;
  /** Written rows before `plan.commands[0]` in this sentence (a replay resumed inside it). */
  initialTextCommandIndex?: number;
  /**
   * False when `plan.commands` is the tail of a sentence: its first command is
   * not the beat's opening stroke, and it keeps the stored order the resume
   * point was counted in.
   */
  opensSentence?: boolean;
  segmentIndex?: number;
  spokenChars?: number;
  /** Runner-only fields for the write schedule log. */
  describeTiming?: () => TraceMetadata;
  trace?: SegmentInkTrace;
}): Promise<void> {
  const { plan, clock, isCancelled } = input;
  const {
    commands: segmentCommands,
    paces: commandPaces,
    pacedDurations,
    totalDrawWeight,
    multiShapeSegment,
    cuedIntro,
    sceneBatchDurations,
    cuedFloors,
    cuedCaps,
  } = plan;
  const narration = clock.narration;
  const hasNarration = narration.length > 0;
  const speechMsPerChar = clock.msPerChar;
  const totalSpeechMs = clock.totalSpeechMs;
  const opensSentence = input.opensSentence !== false;
  const index = input.segmentIndex;

  let textCommandIndex = input.initialTextCommandIndex ?? 0;
  // Where the last cue word was found: matching walks forward through
  // the sentence and a run of parts under one word shares it.
  let cueCursor = 0;
  // A sentence's commands run in the order their words are spoken. A
  // cued intro is already in spoken order; anything else with more
  // than one command (a row plus the pointing gestures inferred from
  // the names the sentence speaks) is sorted by its first word.
  const anchorDiagram = input.getDiagram();
  const anchorTimings = clock.getTimings();
  const spokenAnchorsMs: Array<number | null> =
    input.verifiedDiagramIntro || !opensSentence || segmentCommands.length < 2 || !hasNarration
      ? segmentCommands.map(() => null)
      : segmentCommands.map((command, commandIndex) => {
          const pace = commandPaces[commandIndex]!;
          const isText = command.type === "WRITE" || command.type === "LABEL";
          if (isText && pace !== "scene") {
            const textIndex = segmentCommands
              .slice(0, commandIndex)
              .filter((earlier) => earlier.type === "WRITE" || earlier.type === "LABEL" || earlier.type === "TYPE")
              .length;
            const schedule = getBestWriteCharScheduleMs(
              narration,
              command,
              anchorTimings,
              anchorTimings?.totalDuration ? Math.round(anchorTimings.totalDuration * 1000) : totalSpeechMs,
              textIndex,
              speechMsPerChar,
            );
            return schedule?.offsetsMs[0] ?? null;
          }
          if (
            command.type === "FOCUS" &&
            anchorDiagram &&
            anchorDiagram.layout !== "code_lesson"
          ) {
            const targets = resolveVerifiedDiagramFocusTargets(command, anchorDiagram);
            if (targets.length === 0) return null;
            const schedule = getFocusTargetSchedule({
              narration,
              command,
              targets,
              timings: anchorTimings,
              msPerChar: speechMsPerChar,
            });
            return schedule.targets[0]?.startMs ?? null;
          }
          return null;
        });
  const commandOrder = orderCommandsBySpokenAnchor(spokenAnchorsMs);
  if (commandOrder.some((commandIndex, position) => commandIndex !== position)) {
    input.trace?.reordered?.(
      commandOrder.map((commandIndex) => `${segmentCommands[commandIndex]!.type}@${spokenAnchorsMs[commandIndex] ?? "-"}`).join(" "),
    );
  }
  for (const commandIndex of commandOrder) {
    const command = segmentCommands[commandIndex]!;
    const pace = commandPaces[commandIndex]!;
    if (isCancelled()) {
      return;
    }
    if (!(await input.waitWhilePaused())) {
      return;
    }
    input.beforeCommand?.();

    const isTextCommand =
      command.type === "WRITE" ||
      command.type === "LABEL" ||
      // TYPE is text for pacing: it earns the same spoken window a
      // written line would.
      command.type === "TYPE";
    // Handwriting aligns each character to the word being spoken. Code
    // is not read aloud, so there is nothing to align to — a matched
    // schedule would stretch past the segment and strand the tail. The
    // code panel paces itself inside the window instead.
    //
    // Nor is figure text: a cell value or an index header is part of
    // the sketch, and it has no spoken token to track. Scheduling them
    // as handwriting cost half a second each, so a fourteen-label
    // figure took ten seconds to appear under a four second sentence.
    //
    // Nor a cued figure label: "P" is lettered as "pole" is said, in
    // the window of its cue word, and a one-letter text match against
    // the sentence would only send it to the wrong place.
    const spokenCue = cuedIntro ? command.spokenCue ?? null : null;
    const needsCharSchedule =
      isTextCommand && command.type !== "TYPE" && pace !== "scene" && !spokenCue;
    const elapsedAtCommandStart = clock.getAudioPositionMs();

    const scheduleTimings = clock.getTimings();
    const timingValidation =
      needsCharSchedule && hasNarration && scheduleTimings
        ? validateAudioTimingsForNarration(narration, scheduleTimings)
        : null;
    const segmentDurationMs =
      timingValidation?.totalDurationMs ??
      (scheduleTimings?.totalDuration
        ? Math.round(scheduleTimings.totalDuration * 1000)
        : totalSpeechMs);
    const writeSchedule =
      needsCharSchedule && hasNarration
        ? getBestWriteCharScheduleMs(
            narration,
            command,
            scheduleTimings,
            segmentDurationMs,
            textCommandIndex,
            speechMsPerChar,
          )
        : null;

    if (writeSchedule && writeSchedule.offsetsMs.length > 0) {
      const audioPosAtScheduleMs = Math.round(clock.getAudioPositionMs());
      const firstOffsetMs = writeSchedule.offsetsMs[0] ?? 0;
      const effectiveOffsets = catchUpWriteScheduleOffsets(
        leadWriteScheduleToSpeech(
          writeSchedule.offsetsMs,
          audioPosAtScheduleMs,
          writeSchedule.maxInitialWaitMs,
        ),
        audioPosAtScheduleMs,
      );

      if (input.trace?.writeScheduleReady) {
        // Why this row is, or is not, on the exact clock.
        // `schedule_source` alone hid the cause.
        const timingChars = scheduleTimings?.charStartTimes.length ?? 0;
        input.trace.writeScheduleReady({
          segment_index: index,
          text: command.text?.slice(0, 60),
          schedule_source: writeSchedule.source,
          tts_schedule: classifyTtsScheduleUse({
            scheduleSource: writeSchedule.source,
            scheduleReason: writeSchedule.reason ?? null,
            timingChars,
            timingValid: timingValidation?.valid ?? false,
          }),
          timing_chars: timingChars,
          spoken_chars: input.spokenChars,
          timing_total_ms: scheduleTimings
            ? Math.round(scheduleTimings.totalDuration * 1000)
            : 0,
          timing_valid: timingValidation?.valid ?? false,
          timing_reason: timingValidation?.reason ?? null,
          ...input.describeTiming?.(),
          first_offset_ms: firstOffsetMs,
          audio_pos_ms: audioPosAtScheduleMs,
          start_lag_ms: audioPosAtScheduleMs - firstOffsetMs,
          matched: writeSchedule.matched,
          matched_char_fraction: writeSchedule.matchedCharFraction,
          syncable: writeSchedule.matched,
          valid_timing: writeSchedule.validTiming,
          reason:
            writeSchedule.reason ??
            timingValidation?.reason ??
            null,
        });
      }

      let loggedChars = 0;
      await input.execute(command, {
        segmentNarration: narration,
        writeSchedule: {
          charStartOffsetsMs: effectiveOffsets,
          charDurationsMs: writeSchedule.charDurationsMs,
          getAudioPositionMs: clock.getAudioPositionMs,
          // The slots are media ms; the glyph tween runs in wall time.
          getPlaybackRate: clock.getPlaybackRate,
          onCharacterStart: input.trace?.writeCharStart
            ? ({ char, index: charIndex, targetMs, audioPositionMs }) => {
                if (loggedChars >= 8) {
                  return;
                }
                loggedChars++;
                input.trace?.writeCharStart?.({
                  segment_index: index,
                  char,
                  char_index: charIndex,
                  target_ms: Math.round(targetMs),
                  audio_pos_ms: Math.round(audioPositionMs),
                  lag_ms: Math.round(audioPositionMs - targetMs),
                });
              }
            : undefined,
        },
        ...input.commandOptions(command),
        inkPace: pace,
      });
      if (isTextCommand) {
        textCommandIndex++;
      }
      continue;
    }

    const commandWeight = pacedDurations[commandIndex] ?? getCommandDrawDurationMs(command, pace);
    const naturalDrawMs = commandWeight;
    const commandSpeechMs =
      totalDrawWeight > 0
        ? Math.max(Math.round(totalSpeechMs * (commandWeight / totalDrawWeight)), 50)
        : Math.max(Math.round(totalSpeechMs / segmentCommands.length), 50);
    // One trace per named part, each on its spoken word. The schedule
    // is built here because only the runner holds the sentence's
    // alignment; the FOCUS branch then waits per target itself. A
    // combined tag used to fire once at the top of the sentence for a
    // fixed 900 ms and the pen parked for the rest (136 s of it across
    // six measured lessons).
    const focusDiagram = input.getDiagram();
    const focusTargets =
      command.type === "FOCUS" &&
      hasNarration &&
      !input.verifiedDiagramIntro &&
      focusDiagram &&
      focusDiagram.layout !== "code_lesson"
        ? resolveVerifiedDiagramFocusTargets(command, focusDiagram)
        : [];
    const focusSchedule =
      focusTargets.length > 0
        ? getFocusTargetSchedule({
            narration,
            command,
            targets: focusTargets,
            timings: clock.getTimings(),
            msPerChar: speechMsPerChar,
          })
        : null;
    if (focusSchedule) {
      input.trace?.focusScheduleReady?.({
        segment_index: index,
        spec: command.text?.slice(0, 60),
        source: focusSchedule.source,
        matched: focusSchedule.matchedCount,
        targets: focusSchedule.targets.map((target) => `${target.id}@${target.startMs}-${target.endMs}:${target.anchor}`).join(" "),
      });
    }
    // A written row's index picks the n-th spoken occurrence of its
    // text. A FOCUS after a row is not a second occurrence of anything,
    // and passing the row count here made it look for one, miss, and
    // fall to a window at the top of the sentence.
    // A cued figure part waits for its word. The window runs from the
    // word to the next part's word (or the end of the sentence), exact
    // when the alignment is in hand and estimated at the session's rate
    // otherwise. The beat's opening stroke starts with the sentence
    // even when its word comes later: "The real, inverted image" draws
    // the image from "The".
    const cueWindow =
      spokenCue && hasNarration
        ? getCueSpeechWindow(
            narration,
            spokenCue,
            clock.getTimings(),
            speechMsPerChar,
            cueCursor,
            nextDistinctCueToken(segmentCommands, commandIndex),
          )
        : null;
    if (cueWindow) {
      cueCursor = cueWindow.cursor;
    }
    const cueStartMs = cueWindow ? (commandIndex === 0 && opensSentence ? 0 : cueWindow.startMs) : null;
    const windowTimings = clock.getTimings() ?? clock.fallbackTimings ?? null;
    const speechWindow =
      !cueWindow && hasNarration && windowTimings
        ? getCommandSpeechWindow(
            narration,
            command,
            windowTimings,
            isTextCommand ? textCommandIndex : 0,
            speechMsPerChar,
          )
        : null;
    const startDelayMs = cueStartMs !== null
      ? Math.max(Math.round(cueStartMs - elapsedAtCommandStart), 0)
      : speechWindow && !input.verifiedDiagramIntro && !focusSchedule
        ? Math.min(
            Math.max(Math.round(speechWindow.startMs - elapsedAtCommandStart), 0),
            // Allow waiting for the spoken cue; a 400ms cap made shapes appear
            // long before the words they belong to.
            6_000,
          )
        : 0;

    if (startDelayMs > 0 && (cueStartMs !== null || speechWindow)) {
      await waitUntilDrawClock(clock.getAudioPositionMs, cueStartMs ?? speechWindow!.startMs, {
        shouldCancel: isCancelled,
        getPlaybackRate: clock.getPlaybackRate,
        ...(clock.isPaused ? { isPaused: clock.isPaused } : {}),
        ...(clock.nowMs ? { nowMs: clock.nowMs } : {}),
      });
      if (isCancelled()) {
        return;
      }
    }
    if (cueWindow) {
      input.trace?.cueWindowReady?.({
        segment_index: index,
        command_type: command.type,
        text: command.text?.slice(0, 40),
        token: spokenCue?.token,
        entity_id: spokenCue?.entityId,
        matched: cueWindow.matched,
        source: clock.getTimings() ? "tts" : "estimated",
        word_start_ms: cueWindow.startMs,
        word_end_ms: cueWindow.endMs,
        audio_pos_ms: Math.round(clock.getAudioPositionMs()),
      });
    }

    // Ink budget. A cued part gets what is left of its word's window
    // after the wait, less the hand time the later words' parts still
    // need, shared with the parts under the same word; floored at
    // hand speed and capped at an unhurried pace, so the pen holds on
    // the finished part until the next word rather than crawling.
    const cueRemainingMs =
      cueWindow && cuedFloors
        ? cueWindowRemainingMs(
            cueWindow,
            Math.max(clock.getAudioPositionMs(), cueStartMs ?? 0),
            cueWindowReserveMs(segmentCommands, commandIndex, cuedFloors),
          )
        : null;
    const commandBudgetMs = resolveCommandInkBudgetMs({
      command,
      pace,
      verifiedDiagramIntro: input.verifiedDiagramIntro,
      isTextCommand,
      speechWindowMs: speechWindow?.durationMs,
      commandSpeechMs,
      naturalDrawMs,
      multiShapeSegment,
      sceneBatchDurationMs: sceneBatchDurations?.[commandIndex],
      ...(cueRemainingMs !== null && cuedFloors && cuedCaps
        ? {
            cueWindow: {
              remainingMs: cueRemainingMs,
              sharers: cueWindowSharers(segmentCommands, commandIndex, cuedFloors, cuedCaps),
            },
          }
        : {}),
    });

    const shareTimings = clock.getTimings();
    await input.execute(command, {
      segmentNarration: narration,
      speechDurationMs: commandBudgetMs,
      // What this command may spend of the segment's spoken time.
      // Anything that fills time rather than drawing ink is capped by
      // it, so two commands in one beat cannot each take the whole
      // beat and leave the board running behind its own narration.
      speechShareMs: cueWindow
        ? Math.max(cueWindow.endMs - (cueStartMs ?? 0), commandBudgetMs)
        : command.type === "POINT"
          // A pointing walk has no word of its own to be matched on,
          // so the fallback window handed it 300 ms of a 20 s DSA
          // sentence and the pen stood still for the rest. It walks
          // for what is left of the sentence.
          ? Math.max(
              (shareTimings?.totalDuration
                ? Math.round(shareTimings.totalDuration * 1000)
                : totalSpeechMs) - Math.round(clock.getAudioPositionMs()),
              commandSpeechMs,
              speechWindow?.durationMs ?? 0,
            )
          : speechWindow?.durationMs || commandSpeechMs,
      ...input.commandOptions(command),
      inkPace: pace,
      // The voice is on this part: the whiteboard honours the requested
      // time instead of clipping it to the 320 ms scene ceiling.
      ...(cueWindow ? { cued: true } : {}),
      ...(focusSchedule ? { focusSchedule } : {}),
      getAudioPositionMs: clock.getAudioPositionMs,
      getPlaybackRate: clock.getPlaybackRate,
      // The sentence's own clock for the code lesson. TYPE, FRAME and
      // the code-lesson FOCUS follow its words with it (see
      // lib/code-lesson/codeSpokenSync.ts, SpokenSegmentClock). The
      // alignment is read through a getter: the first sentence's
      // arrives while it plays, and a typed block reads it after
      // typing, when it is there.
      spokenClock: {
        narration,
        getTimings: clock.getTimings,
        estimatedTotalMs: clock.estimatedSpeechMs,
        getAudioPositionMs: clock.getAudioPositionMs,
        getPlaybackRate: clock.getPlaybackRate,
        isSpeechComplete: clock.isSpeechComplete,
        canAdvanceAfterSpeech: clock.canAdvanceAfterSpeech,
        msPerChar: speechMsPerChar,
      },
    });
    if (isTextCommand) {
      textCommandIndex++;
    }
  }
}
