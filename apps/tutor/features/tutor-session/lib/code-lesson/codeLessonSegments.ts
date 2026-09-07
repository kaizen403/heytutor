import { getSegmentCommands, type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { codeLessonBlockById, type CodeLessonPlan } from "@heytutor/tutor-core";

export interface ResolvedCodeLessonSegments {
  segments: TutorSegment[];
  blockedCommandCount: number;
  unknownBlockIds: string[];
  /** Blocks the model never asked for, in plan order. */
  missingBlockIds: string[];
  /** Tags naming an already-revealed block — the model lagging behind. */
  duplicateBlockIds: string[];
  /** Frame advances the conductor inserted, from either kind of beat. */
  insertedFrameCount: number;
  /** Frames of the walk-through still unseen when this batch ended. */
  unshownFrameCount: number;
}

export interface ConductorOptions {
  /** Total worked-example frames; frame 1 is already on the board. */
  frameCount?: number;
  /**
   * Frame ids in order, so a [FOCUS] naming the frame already on the board
   * holds it there. Without them every focus advanced the walk by one, and a
   * lesson that spent two steps on a frame ran a frame ahead of its own words
   * from the third step on.
   */
  frameIds?: string[];
  /**
   * Entities worth spotlighting per frame, indexed by frame. A figure beat
   * rewrites the model's FOCUS target to the frame it just advanced to, so
   * the spotlight always lands on geometry that is actually on the board.
   */
  frameFocusIds?: string[][];
  /**
   * Where the marker stands while a spoken step is about this frame. Falls
   * back to the frame's own geometry when nothing is spotlighted, because an
   * opening frame marks nothing and the pen still needs somewhere to be.
   */
  framePointIds?: string[][];
  /**
   * Where the marker goes when there is no walk-through to point at: the
   * anchors of the single static figure. Without it a lesson on a pattern the
   * catalog does not cover had nothing for the board to do on any spoken step,
   * and the pen stood still for half of it.
   */
  fallbackPointIds?: string[];
}

/**
 * The conductor for a DSA turn.
 *
 * The teaching model narrates; it does not decide the lesson's shape. The
 * committed plan already fixes the order of every code block, and the
 * walk-through already fixes the order of every figure, so this pass enforces
 * both:
 *
 *   - a step tagged `[FOCUS]` is a figure beat: the walk-through advances one
 *     frame and the spotlight is retargeted onto that frame's own entities.
 *     This is what keeps the board moving while the tutor talks about it —
 *     before, FOCUS only dimmed the figure, so a lesson that narrated the
 *     example before writing any code sat on frame 1 the whole time;
 *   - a step tagged `[TYPE]` is a code beat: it reveals the next block in plan
 *     order, whatever id the model named, so blocks can never arrive out of
 *     order or be skipped, and the number that appear is bounded by the tags
 *     the model emitted;
 *   - a code beat also carries a frame advance whenever the figure has fallen
 *     behind an even spread across the blocks. That is the safety net for a
 *     model that skips the figure walk entirely: the frames still all get
 *     shown, just alongside the code instead of before it;
 *   - anything that is not TYPE, FOCUS, PAUSE or FRAME is dropped, because a
 *     DSA turn owns no handwriting.
 *
 * A `[TYPE]` command's text is resolved to the exact block source here — the
 * character schedule and persistence both read it — while the block id stays
 * on `semanticRef.entityId`.
 */
export interface CodeLessonConductor {
  /** Resolve one batch of streamed segments, carrying state across calls. */
  resolve(segments: TutorSegment[]): ResolvedCodeLessonSegments;
  /**
   * Emit anything still held back. A tag written on its own line at the end of
   * a response has no narration to travel with, and dropping it would leave a
   * block counted as revealed and never typed.
   */
  finish(): ResolvedCodeLessonSegments;
  /** What the lesson still owes the student, for the continuation decision. */
  status(): CodeLessonProgress;
}

export interface CodeLessonProgress {
  /** Blocks still unrevealed, in plan order. */
  missingBlockIds: string[];
  /** Frames of the walk-through the student has not been shown. */
  unshownFrameCount: number;
}

/**
 * Live turns stream one segment at a time, so block order and frame placement
 * have to survive between calls. Create one conductor per turn and feed it.
 */
export function createCodeLessonConductor(
  plan: CodeLessonPlan,
  options: ConductorOptions = {},
): CodeLessonConductor {
  // The canonical order. Anything the model asks for is matched against this.
  const order = plan.sections.flatMap((section) => section.blocks.map((block) => block.id));
  const revealed = new Set<string>();
  const frameCount = Math.max(options.frameCount ?? 0, 0);
  const frameFocusIds = options.frameFocusIds ?? [];
  const frameIds = options.frameIds ?? [];
  const framePointIds = options.framePointIds ?? options.frameFocusIds ?? [];
  const fallbackPointIds = options.fallbackPointIds ?? [];

  // Frame 1 is drawn as the turn's intro, so the walk starts one frame in.
  const state: ConductorState = {
    order,
    revealed,
    nextBlock: 0,
    framesShown: frameCount > 0 ? 1 : 0,
    frameCount,
    frameFocusIds,
    framePointIds,
    fallbackPointIds,
    frameIds,
    // Even spread of the remaining advances across the code blocks, used only
    // as a catch-up when the figure beats have not moved the walk along.
    blocksPerAdvance:
      frameCount > 1 ? order.length / frameCount : Number.POSITIVE_INFINITY,
    insertedFrames: 0,
    figureBeats: 0,
    pending: [],
  };

  return {
    resolve(segments) {
      return runConductor(segments, plan, state);
    },
    finish() {
      const held = state.pending;
      state.pending = [];
      return {
        segments: held.length > 0
          ? [{ narration: "", command: held[0] ?? null, commands: held }]
          : [],
        blockedCommandCount: 0,
        unknownBlockIds: [],
        missingBlockIds: state.order.slice(state.nextBlock),
        duplicateBlockIds: [],
        insertedFrameCount: state.insertedFrames,
        unshownFrameCount: Math.max(state.frameCount - state.framesShown, 0),
      };
    },
    status() {
      return {
        missingBlockIds: order.slice(state.nextBlock),
        unshownFrameCount: Math.max(state.frameCount - state.framesShown, 0),
      };
    },
  };
}

/**
 * What to tell the model when its stream stopped with beats still owed.
 *
 * A lesson that ends early is not a short lesson: the code panel is left
 * half-written and the walk-through stops mid-example. Naming exactly what is
 * left, and forbidding a recap, is what makes the continuation finish the
 * lesson rather than start it again.
 */
export function codeLessonResumeNote(
  progress: CodeLessonProgress,
  plan: CodeLessonPlan,
): string {
  const parts: string[] = [];
  if (progress.unshownFrameCount > 0) {
    parts.push(
      `${progress.unshownFrameCount} figure frame${progress.unshownFrameCount === 1 ? "" : "s"} ` +
        "of the worked example are still unshown",
    );
  }
  if (progress.missingBlockIds.length > 0) {
    const next = codeLessonBlockById(plan, progress.missingBlockIds[0]!);
    parts.push(
      `${progress.missingBlockIds.length} code block${progress.missingBlockIds.length === 1 ? "" : "s"} ` +
        `are still unrevealed, starting with ${progress.missingBlockIds[0]}` +
        (next ? ` (${next.section.title})` : ""),
    );
  }
  if (parts.length === 0) return "";
  return `The lesson is not finished: ${parts.join(", and ")}. Pick up from exactly there and teach to the end. Do not restate anything you have already said, do not summarise what came before, and do not start again from the beginning.`;
}

/** One-shot convenience for batch turns and gates. */
export function resolveCodeLessonSegments(
  segments: TutorSegment[],
  plan: CodeLessonPlan,
  options: ConductorOptions = {},
): ResolvedCodeLessonSegments {
  return createCodeLessonConductor(plan, options).resolve(segments);
}

interface ConductorState {
  order: string[];
  revealed: Set<string>;
  nextBlock: number;
  /** Frames of the walk-through already on the board, including frame 1. */
  framesShown: number;
  frameCount: number;
  frameFocusIds: string[][];
  framePointIds: string[][];
  fallbackPointIds: string[];
  frameIds: string[];
  blocksPerAdvance: number;
  insertedFrames: number;
  /** Figure beats the model has narrated so far, one per FOCUS-tagged step. */
  figureBeats: number;
  /**
   * Commands from a step whose tag came before its words. The board would
   * otherwise swap the figure and spotlight it while the tutor is still
   * finishing the previous sentence, so they wait for the words they belong to.
   */
  pending: DrawCommand[];
}

function frameCommand(): DrawCommand {
  return { type: "FRAME", params: [], charPosition: 0, narrationBefore: "" };
}

/**
 * Send the marker to the part of the figure a spoken step is about.
 *
 * A lesson has steps that carry no tag on purpose: the opening, the approach,
 * the trace-through, the close. On those the board did nothing at all, so the
 * pen stood still through a minute of speech and the lesson looked as though
 * it had stalled. A teacher talking about a figure stands at it and points;
 * this is that, and it draws no ink.
 */
function pointCommand(entityIds: readonly string[]): DrawCommand | null {
  if (entityIds.length === 0) return null;
  // Every stop the frame offers, not the first few: the executor walks them
  // for as long as the step's words run, and three adjacent cells is not a
  // walk. The board itself decides where they are.
  const spec = entityIds.slice(0, 6).join(",");
  return {
    type: "POINT",
    params: [],
    text: spec,
    charPosition: 0,
    narrationBefore: "",
    semanticRef: { entityId: spec },
  };
}

/**
 * The frame a [FOCUS:frame_id|spotlight] names, or null when the id is not one
 * of the walk-through's frames.
 */
function frameIndexFromFocus(command: DrawCommand, frameIds: readonly string[]): number | null {
  const spec = (command.semanticRef?.entityId ?? command.text ?? "").split("|")[0] ?? "";
  for (const raw of spec.split(",")) {
    const id = raw.trim();
    if (!id) continue;
    const index = frameIds.indexOf(id);
    if (index >= 0) return index;
  }
  return null;
}

/** Point a focus command at the entities of the frame now on the board. */
function focusOnFrame(command: DrawCommand, entityIds: string[]): DrawCommand | null {
  if (entityIds.length === 0) return null;
  const spec = `${entityIds.join(",")}|spotlight`;
  return {
    ...command,
    text: spec,
    semanticRef: { ...command.semanticRef, entityId: spec },
  };
}

function runConductor(
  segments: TutorSegment[],
  plan: CodeLessonPlan,
  state: ConductorState,
): ResolvedCodeLessonSegments {
  const { order, revealed } = state;
  let blockedCommandCount = 0;
  const unknownBlockIds: string[] = [];
  const duplicateBlockIds: string[] = [];
  const resolved: TutorSegment[] = [];

  for (const segment of segments) {
    const commands: DrawCommand[] = [];
    const segmentCommands = getSegmentCommands(segment);
    // One beat per step. A step that reveals code is a code beat even if it
    // also carries a spotlight, so the figure does not move under a line the
    // previous beat was still explaining.
    const isCodeBeat = segmentCommands.some((command) => command.type === "TYPE");

    for (const command of segmentCommands) {
      if (command.type === "TYPE") {
        const requested = (command.semanticRef?.entityId ?? command.text ?? "").trim();
        if (requested && !codeLessonBlockById(plan, requested)) {
          unknownBlockIds.push(requested);
          blockedCommandCount += 1;
          continue;
        }
        // A tag naming an already-revealed block is the model lagging behind
        // the conductor, not a request to type it twice. Recorded, not dropped
        // — dropping it would under-reveal and leave the lesson unfinished.
        if (requested && revealed.has(requested)) duplicateBlockIds.push(requested);
        if (state.nextBlock >= order.length) {
          blockedCommandCount += 1;
          continue;
        }

        // Whatever the model asked for, the block that actually appears is the
        // next one in plan order. That is what makes skipping and dumping
        // impossible rather than merely discouraged.
        const blockId = order[state.nextBlock]!;
        const located = codeLessonBlockById(plan, blockId);
        if (!located) {
          blockedCommandCount += 1;
          continue;
        }

        // Has the figure fallen behind the even spread? Only true when the
        // model went straight to code without narrating the walk-through.
        if (
          state.framesShown < state.frameCount &&
          state.nextBlock >= Math.round(state.framesShown * state.blocksPerAdvance)
        ) {
          commands.push(frameCommand());
          state.framesShown += 1;
          state.insertedFrames += 1;
        }

        revealed.add(blockId);
        state.nextBlock += 1;
        commands.push({
          ...command,
          text: located.block.code,
          semanticRef: { ...command.semanticRef, entityId: blockId },
        });
        continue;
      }

      if (command.type === "FOCUS") {
        if (isCodeBeat) {
          blockedCommandCount += 1;
          continue;
        }
        if (state.frameCount === 0) {
          // No walk-through: the model's own spotlight stands. An id that is
          // not on the board resolves to nothing, which is the honest outcome
          // for a target that was never drawn.
          commands.push(command);
          continue;
        }
        // A figure beat. The frame the model names decides where the board
        // goes: naming the frame already up holds it there, naming a later
        // one advances to it. Counting focus tags instead meant a second step
        // about the same frame silently moved the picture on.
        state.figureBeats += 1;
        const named = frameIndexFromFocus(command, state.frameIds);
        const wantFrame = named !== null
          ? Math.max(named, state.framesShown - 1)
          : state.figureBeats - 1;
        while (state.framesShown - 1 < wantFrame && state.framesShown < state.frameCount) {
          commands.push(frameCommand());
          state.framesShown += 1;
          state.insertedFrames += 1;
        }
        const retargeted = focusOnFrame(
          command,
          state.frameFocusIds[state.framesShown - 1] ?? [],
        );
        if (retargeted) commands.push(retargeted);
        continue;
      }

      if (command.type === "PAUSE" || command.type === "FRAME") {
        commands.push(command);
        continue;
      }

      blockedCommandCount += 1;
    }

    // The prompt asks for the tag after the words, and the model often writes
    // it first: `[STEP]\n[FOCUS:...]\nthe words`. The parser then hands over a
    // command with no narration followed by narration with no command, so the
    // figure moved a whole sentence early. Carry the command forward to the
    // words it belongs to instead of asking again.
    const narrated = segment.narration.trim().length > 0;
    if (!narrated && commands.length > 0) {
      state.pending.push(...commands);
      continue;
    }
    if (commands.length === 0 && !narrated) continue;
    // A spoken step with nothing to do leaves the board still. Point the
    // marker at whatever the frame currently on the board is about.
    if (narrated && commands.length === 0 && state.pending.length === 0) {
      const at = Math.max(state.framesShown - 1, 0);
      // First non-empty wins: an opening frame can have no focus targets, and
      // `??` would stop at the empty array rather than reaching the fallback.
      const stops = [state.framePointIds[at], state.frameFocusIds[at], state.fallbackPointIds]
        .find((ids) => (ids?.length ?? 0) > 0) ?? [];
      const point = pointCommand(stops);
      if (point) commands.push(point);
    }
    const withPending = state.pending.length > 0 ? [...state.pending, ...commands] : commands;
    state.pending = [];
    resolved.push({
      ...segment,
      command: withPending[0] ?? null,
      commands: withPending.length > 0 ? withPending : undefined,
    });
  }

  return {
    segments: resolved,
    blockedCommandCount,
    unknownBlockIds,
    missingBlockIds: order.slice(state.nextBlock),
    duplicateBlockIds,
    insertedFrameCount: state.insertedFrames,
    unshownFrameCount: Math.max(state.frameCount - state.framesShown, 0),
  };
}
