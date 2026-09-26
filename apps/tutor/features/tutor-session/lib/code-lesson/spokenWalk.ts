/**
 * The pen on a DSA board, moving on the words.
 *
 * `codeSpokenSync` says where the voice is; this module takes the pen there
 * at that moment. Two beats use it:
 *
 *   - a typed block: the block is typed at its natural pace from the start
 *     of its sentence, then the caret and the pen move line by line as the
 *     voice explains each one (`runTypedBlockBeat`);
 *   - a figure frame: after the redraw, the pen walks the cells the voice
 *     names, in the order it names them (`walkSpokenStops`).
 *
 * Both run on the segment's audio clock (media ms). Waits are converted to
 * wall ms by the playback rate; hops are media ms, the whiteboard scales them.
 * Injected `now` and `delay` keep the whole thing gateable on a fake clock.
 */
import { codeLessonCaretBoardPoint } from "../../constants";
import { MARKER_HOP_MS, tourMarker, type MarkerTourCursorState, type TourStop } from "../board/markerTour";
import {
  codeBlockSpokenSchedule,
  frameSpokenWalk,
  spokenTimeline,
  type CodeBlockSpokenSchedule,
  type FrameAnchor,
  type FrameWalkStop,
  type SpokenSegmentClock,
} from "./codeSpokenSync";
import {
  codeLessonLineBoardSpan,
  revealedSectionText,
  type CodeLessonController,
} from "./codeLessonController";

export interface SpokenWalkHost {
  flyCursorTo: (x: number, y: number, durationMs: number) => Promise<void> | void;
  setCursorState?: (state: MarkerTourCursorState | "drawing") => void;
}

export interface SpokenWalkClock {
  /** Media ms since the segment's audio started. */
  getAudioPositionMs: () => number;
  /** Media ms per wall ms. */
  getPlaybackRate: () => number;
}

/** Left unspent at the end of a sentence so the next segment is not late. */
export const SPOKEN_WALK_TAIL_MS = 140;
/**
 * A pen resting on a named part is honest for a while; past this the voice
 * has moved on without naming anything and the pen wanders the figure.
 */
export const SPOKEN_WALK_REST_MAX_MS = 4_000;
/** Reading along one code line takes about this long, media ms. */
const CODE_LINE_TRACE_MS = 2_200;
/** How long the pen takes to catch up with a caret that moved, media ms. */
const CARET_FOLLOW_MS = 160;
/** How often the pen looks at a caret that has not moved, wall ms. */
const CARET_POLL_MS = 48;

export interface SpokenWalkOptions {
  /** Media ms by which the walk must be over: the end of the sentence. */
  untilMs: number;
  isCancelled: () => boolean;
  /** Wall ms sleep. */
  delay: (wallMs: number) => Promise<void>;
  /** Wall ms clock. */
  now?: () => number;
  /** Where the pen may wander when the voice names nothing for a while. */
  idleStops?: readonly TourStop[];
  /**
   * Halt before the first stop naming one of these ids, leaving the clock at
   * that stop's moment: a spotlight in the same beat takes over there.
   */
  stopBeforeIds?: ReadonlySet<string>;
}

export interface SpokenWalkResult {
  cancelled: boolean;
  /** Stop ids the pen reached, in order. */
  visited: string[];
  /** The stop the walk halted before, when `stopBeforeIds` matched. */
  haltedAt: FrameWalkStop | null;
}

/**
 * Wait until the audio clock reaches `targetMs`. Returns true on cancel.
 * A clock that stops advancing (audio stalled, tab hidden) releases the
 * wait after the wall time the target would have taken plus four seconds.
 */
async function waitForAudioMs(
  clock: SpokenWalkClock,
  targetMs: number,
  options: { isCancelled: () => boolean; delay: (wallMs: number) => Promise<void>; now: () => number },
): Promise<boolean> {
  const startWall = options.now();
  const startMedia = clock.getAudioPositionMs();
  const rate = () => Math.max(clock.getPlaybackRate(), 0.1);
  const guardWallMs = Math.max(targetMs - startMedia, 0) / rate() + 4_000;
  while (clock.getAudioPositionMs() + 10 < targetMs) {
    if (options.isCancelled()) return true;
    if (options.now() - startWall > guardWallMs) return false;
    const remaining = (targetMs - clock.getAudioPositionMs()) / rate();
    await options.delay(Math.min(Math.max(remaining, 8), 40));
  }
  return options.isCancelled();
}

/**
 * Walk the named parts of a figure as the voice names them.
 *
 * Each stop is reached at its word; the pen rests on it until the next word
 * or, after SPOKEN_WALK_REST_MAX_MS of silence about the figure, wanders the
 * idle stops until the next named part. The walk ends SPOKEN_WALK_TAIL_MS
 * before the sentence does.
 */
export async function walkSpokenStops(
  host: SpokenWalkHost,
  stops: readonly FrameWalkStop[],
  clock: SpokenWalkClock,
  options: SpokenWalkOptions,
): Promise<SpokenWalkResult> {
  const now = options.now ?? (() => performance.now());
  const wait = (targetMs: number) =>
    waitForAudioMs(clock, targetMs, { isCancelled: options.isCancelled, delay: options.delay, now });
  const visited: string[] = [];
  const deadline = options.untilMs - SPOKEN_WALK_TAIL_MS;
  const rate = () => Math.max(clock.getPlaybackRate(), 0.1);
  host.setCursorState?.("speaking");

  const wander = async (untilMediaMs: number): Promise<boolean> => {
    const gapMs = untilMediaMs - clock.getAudioPositionMs();
    if (gapMs <= SPOKEN_WALK_REST_MAX_MS || !options.idleStops || options.idleStops.length === 0) {
      return wait(untilMediaMs);
    }
    // tourMarker measures its total on the wall clock; the gap is media.
    const cancelled = await tourMarker(host, options.idleStops, {
      totalMs: (gapMs - MARKER_HOP_MS) / rate(),
      isCancelled: options.isCancelled,
      delay: options.delay,
      now,
    });
    if (cancelled) return true;
    return wait(untilMediaMs);
  };

  for (const stop of stops) {
    if (options.isCancelled()) return { cancelled: true, visited, haltedAt: null };
    if (stop.startMs >= deadline) break;
    const at = Math.max(stop.startMs, clock.getAudioPositionMs());
    if (options.stopBeforeIds?.has(stop.id)) {
      if (await wander(at)) return { cancelled: true, visited, haltedAt: null };
      return { cancelled: false, visited, haltedAt: stop };
    }
    if (await wander(at)) return { cancelled: true, visited, haltedAt: null };
    const window = Math.max(stop.endMs - at, 200);
    await host.flyCursorTo(
      stop.x + stop.width / 2,
      // The top edge, as markerTour does: the pen graphic hangs below its
      // tip and would cover the value the voice is naming.
      stop.y,
      Math.min(MARKER_HOP_MS, window),
    );
    visited.push(stop.id);
  }
  if (options.isCancelled()) return { cancelled: true, visited, haltedAt: null };
  if (clock.getAudioPositionMs() < deadline) {
    if (await wander(deadline)) return { cancelled: true, visited, haltedAt: null };
  }
  return { cancelled: options.isCancelled(), visited, haltedAt: null };
}

export interface TypedBlockBeatInput {
  host: SpokenWalkHost;
  controller: CodeLessonController;
  blockId: string;
  /** The sentence this block sits under; null when there is no audio to follow. */
  clock: SpokenSegmentClock | null;
  isCancelled: () => boolean;
  delay: (wallMs: number) => Promise<void>;
  now?: () => number;
}

export interface TypedBlockBeatResult {
  cancelled: boolean;
  /** Media ms when the last character landed. */
  typedMs: number;
  /** Lines the voice named after typing, in order. */
  linesVisited: number[];
  schedule: CodeBlockSpokenSchedule | null;
}

/**
 * One code beat: type the block, then follow the voice through it.
 *
 * Typing runs at its natural pace on the audio clock, and the pen follows the
 * caret. When the block is complete the sentence is usually not (measured:
 * typing ended at 22 to 29% of a 20 s sentence), so for the rest of it the
 * highlighted line and the pen move to whichever line the voice is on, and
 * the pen reads along that line. The beat ends a tail before the sentence.
 */
export async function runTypedBlockBeat(input: TypedBlockBeatInput): Promise<TypedBlockBeatResult> {
  const { host, controller, blockId, clock, isCancelled, delay } = input;
  const now = input.now ?? (() => performance.now());
  const plan = controller.getActivePlan();
  const state = () => controller.getState();
  const caretNow = () => codeLessonCaretBoardPoint(revealedSectionText(state(), state().activeSectionIndex));
  // The media clock stops when speech ends. A long or short code block must
  // still finish typing after that point, or its queued segment never settles
  // and the whole lesson (including Replay) stays locked. Keep the real audio
  // clock while it runs, then finish the bounded typing tail at playback rate.
  let typingMediaMs = clock?.getAudioPositionMs() ?? 0;
  let typingWallMs = now();
  const typingClock = clock ? {
    getAudioPositionMs: () => {
      const wallNow = now();
      typingMediaMs = Math.max(typingMediaMs, clock.getAudioPositionMs());
      if (clock.isSpeechComplete?.() && clock.canAdvanceAfterSpeech?.() !== false) {
        typingMediaMs += Math.max(wallNow - typingWallMs, 0) * clock.getPlaybackRate();
      }
      typingWallMs = wallNow;
      return typingMediaMs;
    },
    getPlaybackRate: clock.getPlaybackRate,
  } : null;
  const start = caretNow();
  // The first code block crosses from the worked example to the editor.
  // A 240 ms flight covered most of the board and looked like a teleport.
  const firstCodeBlock = !Object.values(state().revealedChars).some((count) => count > 0);
  await host.flyCursorTo(start.x, start.y, firstCodeBlock ? MARKER_HOP_MS : 240);
  if (isCancelled()) return { cancelled: true, typedMs: 0, linesVisited: [], schedule: null };
  host.setCursorState?.("drawing");

  let typing = true;
  const followCaret = (async () => {
    let last = start;
    while (typing && !isCancelled()) {
      const next = caretNow();
      // Only fly when the caret has actually moved; a still pen is right
      // while a character is being drawn, a jittering one is not.
      if (Math.abs(next.x - last.x) > 1 || Math.abs(next.y - last.y) > 1) {
        last = next;
        await host.flyCursorTo(next.x, next.y, CARET_FOLLOW_MS);
      } else {
        await delay(CARET_POLL_MS);
      }
    }
  })();
  // The moment the last character lands, on the audio clock: the pen's
  // catch-up hop after it is not typing.
  let typedMs = 0;
  const blockLength = plan
    ? plan.sections.flatMap((section) => section.blocks).find((candidate) => candidate.id === blockId)?.code.length ?? 0
    : 0;
  const unsubscribe = controller.subscribe(() => {
    if (typedMs === 0 && clock && (controller.getState().revealedChars[blockId] ?? 0) >= blockLength) {
      typedMs = clock.getAudioPositionMs();
    }
  });
  try {
    await controller.typeBlock(blockId, {
      shouldCancel: isCancelled,
      delay,
      ...(typingClock
        ? { clock: typingClock.getAudioPositionMs, getPlaybackRate: typingClock.getPlaybackRate }
        : {}),
    });
  } finally {
    typing = false;
    unsubscribe();
    await followCaret;
  }
  if (typedMs === 0 && clock) typedMs = clock.getAudioPositionMs();
  if (isCancelled()) return { cancelled: true, typedMs, linesVisited: [], schedule: null };

  if (!clock || !plan) {
    host.setCursorState?.("thinking");
    return { cancelled: false, typedMs, linesVisited: [], schedule: null };
  }

  const block = plan.sections.flatMap((section) => section.blocks).find((candidate) => candidate.id === blockId);
  if (!block) {
    host.setCursorState?.("thinking");
    return { cancelled: false, typedMs, linesVisited: [], schedule: null };
  }
  // Read the alignment now, not at the start of the beat: the first
  // sentence's arrives while it plays, and by the end of typing it is there.
  const schedule = codeBlockSpokenSchedule(block.code, clock.narration, clock.getTimings(), {
    estimatedTotalMs: clock.estimatedTotalMs,
    msPerChar: clock.msPerChar,
  });
  const walkClock: SpokenWalkClock = {
    getAudioPositionMs: clock.getAudioPositionMs,
    getPlaybackRate: clock.getPlaybackRate,
  };
  const wait = (targetMs: number) => waitForAudioMs(walkClock, targetMs, { isCancelled, delay, now });
  const deadline = schedule.totalMs - SPOKEN_WALK_TAIL_MS;
  const linesVisited: number[] = [];
  host.setCursorState?.("speaking");
  // Anchors the typing already ran past are stale; the voice has moved on.
  const pending = schedule.anchors.filter((anchor) => anchor.endMs > clock.getAudioPositionMs());
  for (const anchor of pending) {
    if (isCancelled()) return { cancelled: true, typedMs, linesVisited, schedule };
    if (anchor.startMs >= deadline) break;
    const at = Math.max(anchor.startMs, clock.getAudioPositionMs());
    if (await wait(at)) return { cancelled: true, typedMs, linesVisited, schedule };
    controller.setSpokenLine(blockId, anchor.lineIndex);
    linesVisited.push(anchor.lineIndex);
    const span = codeLessonLineBoardSpan(state(), blockId, anchor.lineIndex);
    if (span) {
      // Reading along the line: to its first glyph, then across its text
      // over the anchor's window, capped so a long clause still reads as
      // one pass rather than a crawl.
      const window = Math.min(Math.max(anchor.endMs - at, 400), CODE_LINE_TRACE_MS);
      await host.flyCursorTo(span.x0, span.y, Math.min(MARKER_HOP_MS, window * 0.4));
      if (isCancelled()) return { cancelled: true, typedMs, linesVisited, schedule };
      await host.flyCursorTo(span.x1, span.y, window * 0.6);
    }
  }
  if (!isCancelled() && clock.getAudioPositionMs() < deadline) {
    await wait(deadline);
  }
  controller.clearSpokenLine();
  host.setCursorState?.("thinking");
  return { cancelled: isCancelled(), typedMs, linesVisited, schedule };
}

export interface FrameWalkBeatInput {
  host: SpokenWalkHost;
  /** The anchors of the frame now on the board. */
  anchors: readonly FrameAnchor[];
  clock: SpokenSegmentClock;
  isCancelled: () => boolean;
  delay: (wallMs: number) => Promise<void>;
  now?: () => number;
  /** Where the pen wanders when the voice names nothing for a while. */
  idleStops?: readonly TourStop[];
  /** Halt before the first of these is named; the spotlight fires there. */
  stopBeforeIds?: readonly string[];
}

/** The named stops of a frame under its sentence, from the clock's own position on. */
export function frameWalkPlan(
  anchors: readonly FrameAnchor[],
  clock: SpokenSegmentClock,
  fromMs = clock.getAudioPositionMs(),
): { stops: FrameWalkStop[]; totalMs: number; source: "tts" | "estimated" } {
  const timeline = spokenTimeline(clock.narration, clock.getTimings(), {
    estimatedTotalMs: clock.estimatedTotalMs,
    msPerChar: clock.msPerChar,
  });
  return { stops: frameSpokenWalk(anchors, timeline, { fromMs }), totalMs: timeline.totalMs, source: timeline.source };
}

/**
 * Walk the frame the voice is describing until the sentence ends, or until
 * it names one of `stopBeforeIds`. Returns what the walk did, so the caller
 * can fire a spotlight on the word it halted at.
 */
export async function runFrameWalkBeat(input: FrameWalkBeatInput): Promise<SpokenWalkResult & { stops: number }> {
  const plan = frameWalkPlan(input.anchors, input.clock);
  const result = await walkSpokenStops(
    input.host,
    plan.stops,
    { getAudioPositionMs: input.clock.getAudioPositionMs, getPlaybackRate: input.clock.getPlaybackRate },
    {
      untilMs: plan.totalMs,
      isCancelled: input.isCancelled,
      delay: input.delay,
      now: input.now,
      idleStops: input.idleStops,
      stopBeforeIds: input.stopBeforeIds ? new Set(input.stopBeforeIds) : undefined,
    },
  );
  return { ...result, stops: plan.stops.length };
}
