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
  /** Advances inserted beside code because the model skipped the figure. */
  codeCatchUpFrameCount: number;
  /** Frames of the walk-through still unseen when this batch ended. */
  unshownFrameCount: number;
}

export interface ConductorOptions {
  /** Keep an explanation-only lesson on its verified frames; no code blocks are owed. */
  includeCode?: boolean;
  /** Total worked-example frames; none are on the board until the first FOCUS. */
  frameCount?: number;
  /**
   * Blocks already typed on the panel, so a resume after a doubt does not
   * reveal them again. The conductor starts at the first block that is not
   * in this list.
   */
  alreadyRevealedBlockIds?: readonly string[];
  /**
   * Walk-through frames already on the board. A resume after a doubt must not
   * rewind the figure to frame 1.
   */
  framesAlreadyShown?: number;
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
  const order = options.includeCode === false
    ? []
    : plan.sections.flatMap((section) => section.blocks.map((block) => block.id));
  const revealed = new Set(options.alreadyRevealedBlockIds ?? []);
  let nextBlock = 0;
  while (nextBlock < order.length && revealed.has(order[nextBlock]!)) {
    nextBlock += 1;
  }
  const frameCount = Math.max(options.frameCount ?? 0, 0);
  const frameFocusIds = options.frameFocusIds ?? [];
  const frameIds = options.frameIds ?? [];
  const framePointIds = options.framePointIds ?? options.frameFocusIds ?? [];
  const fallbackPointIds = options.fallbackPointIds ?? [];
  const framesAlreadyShown = Math.min(
    Math.max(options.framesAlreadyShown ?? 0, 0),
    frameCount,
  );

  // The first frame is not dumped at the start of the turn: the opening
  // writes the problem, then the first FOCUS draws frame 1 as intro ink.
  const state: ConductorState = {
    order,
    revealed,
    nextBlock,
    framesShown: framesAlreadyShown,
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
    codeCatchUpFrames: 0,
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
        codeCatchUpFrameCount: state.codeCatchUpFrames,
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
/** Block ids whose full source is already on the panel. */
export function fullyRevealedBlockIds(
  plan: CodeLessonPlan,
  revealedChars: Readonly<Record<string, number>>,
): string[] {
  return plan.sections.flatMap((section) =>
    section.blocks
      .filter((block) => (revealedChars[block.id] ?? 0) >= block.code.length)
      .map((block) => block.id),
  );
}

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
  /** Frames of the walk-through already on the board. 0 until the first FOCUS. */
  framesShown: number;
  frameCount: number;
  frameFocusIds: string[][];
  framePointIds: string[][];
  fallbackPointIds: string[];
  frameIds: string[];
  blocksPerAdvance: number;
  insertedFrames: number;
  codeCatchUpFrames: number;
  /** Figure beats the model has narrated so far, one per FOCUS-tagged step. */
  figureBeats: number;
  /**
   * Commands from a step whose tag came before its words. The board would
   * otherwise swap the figure and spotlight it while the tutor is still
   * finishing the previous sentence, so they wait for the words they belong to.
   */
  pending: DrawCommand[];
}

/**
 * How a frame advance should spend the sentence it sits under.
 *
 * `figure_beat`: the step is about this frame. The board redraws at hand
 * speed and then the pen walks the cells the voice names for the rest of the
 * sentence, halting when it names the spotlight's target so the FOCUS after
 * it fires on that word rather than at the end. `catch_up`: the frame was
 * inserted beside a code block; it redraws and hands the sentence straight
 * back to the TYPE that owns it. A FRAME with neither (a persisted recording
 * from before this existed) redraws and does nothing more.
 */
export type FrameAdvanceRole = "figure_beat" | "catch_up";

function frameCommand(role: FrameAdvanceRole, focusIds: readonly string[] = []): DrawCommand {
  return {
    type: "FRAME",
    params: [],
    charPosition: 0,
    narrationBefore: "",
    semanticRef: { entityId: focusIds.join(","), actionId: role },
  };
}

/** The role the conductor gave a frame advance, or null for a bare FRAME. */
export function frameAdvanceRole(command: DrawCommand): FrameAdvanceRole | null {
  const role = command.semanticRef?.actionId;
  return role === "figure_beat" || role === "catch_up" ? role : null;
}

/**
 * Where the marker stands on a spoken-only beat.
 *
 * Before any frame is on the board the opening notes are the only ink, so
 * those ids win. After a frame is up, the frame's own stops win and the
 * opening notes are not a fallback: pointing at the title while walking the
 * example reads as a stalled figure.
 */
function spokenPointStops(state: ConductorState): readonly string[] {
  if (state.frameCount === 0 || state.framesShown <= 0) {
    return state.fallbackPointIds.slice(0, 1);
  }
  const at = state.framesShown - 1;
  return ([state.framePointIds[at], state.frameFocusIds[at]]
    .find((ids) => (ids?.length ?? 0) > 0) ?? []).slice(0, 1);
}

const FIGURE_INTRO_TRIGGERS = new Set(["FOCUS", "FRAME", "TYPE"]);

/**
 * Place the delayed frame-1 intro just before the first figure or code beat.
 *
 * Opening WRITE rows stay first. If the teaching stream never names a frame
 * or a block, the intro still appends so the student is not left with notes
 * and no example.
 */
export function placeDsaFigureIntro(
  given: TutorSegment[],
  intro: TutorSegment[],
  teaching: TutorSegment[],
): TutorSegment[] {
  if (intro.length === 0) return [...given, ...teaching];
  const index = teaching.findIndex((segment) =>
    getSegmentCommands(segment).some((command) => FIGURE_INTRO_TRIGGERS.has(command.type)),
  );
  if (index < 0) return [...given, ...teaching, ...intro];
  return [...given, ...teaching.slice(0, index), ...intro, ...teaching.slice(index)];
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
  // Spoken-only beats hold at one stable anchor. Frame and code beats have
  // their own word-linked tours; wandering across unrelated cells here made
  // untagged explanation sound detached from what the student was reading.
  const spec = entityIds[0]!;
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
        // Frame 1 is the delayed intro, not a FRAME command, so count it
        // shown before spreading the remaining advances.
        if (state.framesShown === 0 && state.frameCount > 0) {
          state.framesShown = 1;
        }
        if (
          state.framesShown < state.frameCount &&
          state.nextBlock >= Math.round(state.framesShown * state.blocksPerAdvance)
        ) {
          commands.push(frameCommand("catch_up"));
          state.framesShown += 1;
          state.insertedFrames += 1;
          state.codeCatchUpFrames += 1;
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
        // The runtime draws frame 1 as delayed intro ink on this first FOCUS.
        // Counting it shown here, without a FRAME, keeps later advances on
        // frames 2..n the way persisted recordings already expect.
        if (state.framesShown === 0 && state.frameCount > 0) {
          state.framesShown = 1;
        }
        const named = frameIndexFromFocus(command, state.frameIds);
        const wantFrame = named !== null
          ? Math.max(named, state.framesShown - 1)
          : state.figureBeats - 1;
        const advances: DrawCommand[] = [];
        while (state.framesShown - 1 < wantFrame && state.framesShown < state.frameCount) {
          advances.push(frameCommand("catch_up"));
          state.framesShown += 1;
          state.insertedFrames += 1;
        }
        const focusIds = state.frameFocusIds[state.framesShown - 1] ?? [];
        // Only the frame the step lands on is the figure beat; frames skipped
        // over on the way are redrawn and left behind.
        if (advances.length > 0) advances[advances.length - 1] = frameCommand("figure_beat", focusIds);
        commands.push(...advances);
        const retargeted = focusOnFrame(command, focusIds);
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
    // A spoken step with nothing to do leaves the board still. Before the
    // figure is up, that is the opening notes; afterwards it is the frame.
    if (narrated && commands.length === 0 && state.pending.length === 0) {
      const stops = spokenPointStops(state);
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
    codeCatchUpFrameCount: state.codeCatchUpFrames,
    unshownFrameCount: Math.max(state.frameCount - state.framesShown, 0),
  };
}
