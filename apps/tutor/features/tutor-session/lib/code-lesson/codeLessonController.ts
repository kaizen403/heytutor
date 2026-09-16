import {
  CODE_TYPE_MAX_BLOCK_MS,
  CODE_TYPE_MAX_VISIBLE_CHAR_MS,
  CODE_TYPE_MIN_VISIBLE_CHAR_MS,
  CODE_TYPE_MS_PER_CHAR,
  codeLessonBlockById,
  codeLessonSectionCode,
  tutorDebug,
  type CodeLessonPlan,
} from "@heytutor/tutor-core";
import { DSA_CODE_PANEL_RECT, DSA_EDITOR_METRICS } from "../../constants";
import { DsaFrameController } from "./dsaFrames";
import {
  createTypeAlongSection,
  typeAlongKey,
  type TypeAlongKey,
  type TypeAlongState,
} from "./typeAlong";

export type CodeLessonMode = "hidden" | "lesson" | "complete" | "type_along";

export interface CodeLessonState {
  plan: CodeLessonPlan | null;
  mode: CodeLessonMode;
  /** Section shown in the panel. Follows typing during the lesson. */
  activeSectionIndex: number;
  /** Characters revealed per block id. */
  revealedChars: Record<string, number>;
  /** Block currently being typed by the tutor, if any. */
  typingBlockId: string | null;
  /** Practice machine for the active section while mode is "type_along". */
  typeAlong: TypeAlongState | null;
  /**
   * The line the voice is explaining, once its block is typed. The panel
   * highlights it and parks the caret at its end; the pen stands on it.
   * Measured before this existed: a block typed in the first quarter of its
   * sentence and nothing on the board moved for the remaining fifteen seconds.
   */
  spokenLine: { blockId: string; lineIndex: number } | null;
}

export interface TypeBlockOptions {
  /** Spoken window for this block. Typing stays readable even if speech is short. */
  durationMs?: number;
  shouldCancel?: () => boolean;
  /**
   * Media clock to pace the characters on, the segment's audio position.
   * Without it the wall clock is used, which at playback 1.5 typed a block
   * half again slower than everything else on the board.
   */
  clock?: () => number;
  /** Media ms per wall ms, for the sleeps between characters. */
  getPlaybackRate?: () => number;
  /** Wall ms sleep between characters; gates inject a virtual clock. */
  delay?: (wallMs: number) => Promise<void>;
}

const EMPTY_STATE: CodeLessonState = {
  plan: null,
  mode: "hidden",
  activeSectionIndex: 0,
  revealedChars: {},
  typingBlockId: null,
  typeAlong: null,
  spokenLine: null,
};

const TYPE_POLL_MS = 12;

/** Indentation and newlines snap, the way a real editor jumps to a line. */
const WHITESPACE_CHAR_WEIGHT = 0.22;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-character appearance offsets for one typed block, in ms from the block's
 * start.
 *
 * Code is never spoken aloud, so — unlike handwriting — there is no token to
 * align each character to. Characters spread at a readable rate. A short
 * spoken cue must not compress the block: typing is allowed to outlast speech.
 *
 * Shared with MP4 export so a recording paces exactly like the live panel.
 */
export function codeTypingCharOffsetsMs(code: string, windowMs: number): number[] {
  const weights = [...code].map((char) => (/\s/.test(char) ? WHITESPACE_CHAR_WEIGHT : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return code.split("").map(() => 0);

  // Readable typing wins over a short spoken cue: a brief line of narration
  // must not compress a function into a few seconds.
  const readableMs = Math.max(windowMs, totalWeight * CODE_TYPE_MIN_VISIBLE_CHAR_MS);
  let perWeightMs = Math.max(
    CODE_TYPE_MIN_VISIBLE_CHAR_MS,
    Math.min(readableMs / totalWeight || CODE_TYPE_MIN_VISIBLE_CHAR_MS, CODE_TYPE_MAX_VISIBLE_CHAR_MS),
  );
  // …but the cap wins over readability. Applying the readable floor after the
  // cap is what let a long block run 27 seconds against a 24 second limit,
  // stranding typing well past the end of its narration. Blocks the format
  // gate allows all fit comfortably; only a pathologically long one is
  // compressed here, and being slightly quick beats being silently unbounded.
  if (totalWeight * perWeightMs > CODE_TYPE_MAX_BLOCK_MS) {
    perWeightMs = CODE_TYPE_MAX_BLOCK_MS / totalWeight;
  }

  const offsets = new Array<number>(code.length);
  let elapsed = 0;
  for (let index = 0; index < code.length; index += 1) {
    offsets[index] = Math.round(elapsed);
    elapsed += weights[index]! * perWeightMs;
  }
  return offsets;
}

/**
 * Owns the typed-code surface of a DSA turn, outside the React render cycle
 * (mirroring how the whiteboard owns ink). The segment runner drives
 * `typeBlock` against the live audio clock; the panel subscribes for paint.
 */
export class CodeLessonController {
  /**
   * The worked-example walk-through for this turn. It lives here rather than
   * in its own ref because the code-lesson controller is already threaded
   * through every hook a DSA turn touches, and a frame swap is part of the
   * same lesson as the code it sits beside.
   */
  readonly frames = new DsaFrameController();
  private state: CodeLessonState = EMPTY_STATE;
  private listeners = new Set<() => void>();
  /** Increments on commit/reset so stale typeBlock loops go quiet. */
  private generation = 0;

  getState(): CodeLessonState {
    return this.state;
  }

  getActivePlan(): CodeLessonPlan | null {
    return this.state.plan;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: Partial<CodeLessonState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Commit a validated plan before narration starts. The panel stays hidden until the first typed block. */
  commit(plan: CodeLessonPlan): void {
    this.generation += 1;
    this.setState({
      plan,
      mode: "hidden",
      activeSectionIndex: 0,
      revealedChars: {},
      typingBlockId: null,
      typeAlong: null,
      spokenLine: null,
    });
  }

  /** Mount the editor. Hidden through the opening so the left column is a notebook. */
  revealPanel(): void {
    if (!this.state.plan || this.state.mode !== "hidden") return;
    this.setState({ mode: "lesson" });
  }

  reset(): void {
    this.generation += 1;
    this.frames.reset();
    if (this.state.mode === "hidden" && !this.state.plan) return;
    this.setState(EMPTY_STATE);
  }

  /** The turn finished; the panel stays up and type-along becomes available. */
  markLessonComplete(): void {
    if (!this.state.plan || this.state.mode !== "lesson") return;
    this.setState({ mode: "complete", typingBlockId: null, spokenLine: null });
    // An unrevealed block used to be typed here, after the turn's telemetry
    // had flushed and the narration had stopped — several seconds of code
    // appearing in silence, which reads as a bug rather than as teaching.
    // The conductor now reveals blocks in plan order, so a leftover means the
    // model ended the lesson early; that is worth reporting, not papering over.
    const missing = this.unrevealedBlockIds();
    if (missing.length > 0) {
      tutorDebug("draw", "code lesson ended with unrevealed blocks", {
        missing_block_ids: missing,
        missing_count: missing.length,
      });
    }
  }

  /** Blocks the teaching stream never revealed, in plan order. */
  unrevealedBlockIds(): string[] {
    const plan = this.state.plan;
    if (!plan) return [];
    return plan.sections.flatMap((section) =>
      section.blocks
        .filter((block) => (this.state.revealedChars[block.id] ?? 0) <= 0)
        .map((block) => block.id),
    );
  }

  setMode(mode: CodeLessonMode): void {
    if (!this.state.plan) return;
    this.setState({ mode });
  }

  setActiveSection(index: number): void {
    const plan = this.state.plan;
    if (!plan || index < 0 || index >= plan.sections.length) return;
    // Switching sections mid-practice starts that section's machine fresh.
    const typeAlong = this.state.mode === "type_along"
      ? this.buildTypeAlong(plan, index)
      : this.state.typeAlong;
    this.setState({ activeSectionIndex: index, typeAlong });
  }

  private buildTypeAlong(plan: CodeLessonPlan, sectionIndex: number): TypeAlongState | null {
    const section = plan.sections[sectionIndex];
    if (!section) return null;
    return createTypeAlongSection(codeLessonSectionCode(section), section.typeAlongRanges);
  }

  /** Enter practice mode on the current section (from the overlay button). */
  startTypeAlong(): void {
    const plan = this.state.plan;
    if (!plan || this.state.mode === "lesson" || this.state.mode === "hidden") return;
    this.setState({
      mode: "type_along",
      typingBlockId: null,
      typeAlong: this.buildTypeAlong(plan, this.state.activeSectionIndex),
    });
  }

  exitTypeAlong(): void {
    if (this.state.mode !== "type_along") return;
    this.setState({ mode: "complete", typeAlong: null });
  }

  /** Feed one intercepted key through the practice machine. */
  typeAlongInput(key: TypeAlongKey): void {
    const practice = this.state.typeAlong;
    if (this.state.mode !== "type_along" || !practice) return;
    const next = typeAlongKey(practice, key);
    if (next !== practice) this.setState({ typeAlong: next });
  }

  /** Restore a persisted lesson with every block already revealed. */
  restoreCompleted(plan: CodeLessonPlan): void {
    this.generation += 1;
    const revealedChars: Record<string, number> = {};
    for (const section of plan.sections) {
      for (const block of section.blocks) {
        revealedChars[block.id] = block.code.length;
      }
    }
    this.setState({
      plan,
      mode: "complete",
      activeSectionIndex: 0,
      revealedChars,
      typingBlockId: null,
      typeAlong: null,
      spokenLine: null,
    });
  }

  /** The voice is on this line of a typed block; the panel and the pen follow. */
  setSpokenLine(blockId: string, lineIndex: number): void {
    const plan = this.state.plan;
    if (!plan || !codeLessonBlockById(plan, blockId)) return;
    const current = this.state.spokenLine;
    if (current && current.blockId === blockId && current.lineIndex === lineIndex) return;
    this.setState({ spokenLine: { blockId, lineIndex } });
  }

  clearSpokenLine(): void {
    if (this.state.spokenLine === null) return;
    this.setState({ spokenLine: null });
  }

  revealBlockInstant(blockId: string): void {
    const plan = this.state.plan;
    if (!plan) return;
    const located = codeLessonBlockById(plan, blockId);
    if (!located) return;
    this.revealPanel();
    this.setState({
      activeSectionIndex: plan.sections.indexOf(located.section),
      revealedChars: {
        ...this.state.revealedChars,
        [blockId]: located.block.code.length,
      },
    });
  }

  /**
   * Type one committed block character by character. With a schedule, each
   * character waits for its offset on the live audio clock (the same contract
   * as whiteboard handwriting); otherwise characters spread over durationMs.
   */
  async typeBlock(blockId: string, options: TypeBlockOptions = {}): Promise<void> {
    const plan = this.state.plan;
    if (!plan) return;
    const located = codeLessonBlockById(plan, blockId);
    if (!located) return;
    const generation = this.generation;
    const isStale = () =>
      generation !== this.generation || options.shouldCancel?.() === true;

    const { section, block } = located;
    const code = block.code;
    const sectionIndex = plan.sections.indexOf(section);
    this.revealPanel();
    this.setState({
      activeSectionIndex: sectionIndex,
      typingBlockId: blockId,
      revealedChars: { ...this.state.revealedChars, [blockId]: 0 },
      spokenLine: null,
    });

    // Speech may be shorter than a readable type-along, so readability is the
    // floor. The cap has to be applied *outside* that max, not inside it: with
    // the min nested in the max, any block over ~267 characters made
    // `length * MIN_VISIBLE` the winner and silently blew past the 24s cap,
    // stranding a quarter-minute of typing after the narration had finished.
    const requestedMs = options.durationMs ?? code.length * CODE_TYPE_MS_PER_CHAR;
    const readableMs = code.length * CODE_TYPE_MIN_VISIBLE_CHAR_MS;
    const windowMs = Math.min(Math.max(requestedMs, readableMs), CODE_TYPE_MAX_BLOCK_MS);
    const charOffsetsMs = codeTypingCharOffsetsMs(code, windowMs);
    // Offsets are media ms. On the audio clock a character lands at its
    // offset in the sentence whatever the playback rate; on the wall clock
    // (no segment audio, or a headless run) media and wall coincide.
    const clock = options.clock ?? (() => performance.now());
    const rate = () => {
      const value = options.getPlaybackRate?.() ?? 1;
      return Number.isFinite(value) && value > 0 ? value : 1;
    };
    const startedAt = clock();

    let revealed = 0;
    while (revealed < code.length) {
      if (isStale()) break;
      const elapsedMs = clock() - startedAt;
      // Catch up in one tick if the frame budget slipped, so typing stays on
      // pace without ever jumping straight to the end of the block.
      let next = revealed;
      while (next < code.length && (charOffsetsMs[next] ?? 0) <= elapsedMs) {
        next += 1;
      }
      if (next === revealed) {
        const waitMs = ((charOffsetsMs[revealed] ?? 0) - elapsedMs) / rate();
        await (options.delay ?? sleep)(Math.min(Math.max(waitMs, TYPE_POLL_MS), 120));
        continue;
      }
      revealed = next;
      this.setState({
        revealedChars: { ...this.state.revealedChars, [blockId]: revealed },
      });
    }

    if (generation === this.generation) {
      // A block left half-typed is not a teachable artifact: type-along,
      // notes, and export all read whole blocks. Completing here only matters
      // when the turn was cancelled, since normal pacing finishes in-window.
      this.setState({
        revealedChars: { ...this.state.revealedChars, [blockId]: code.length },
        typingBlockId: null,
      });
    }
  }
}

/** Lines of the blocks before `blockId` in its section, as the section doc counts them. */
export function sectionLineOffset(state: CodeLessonState, blockId: string): number | null {
  const plan = state.plan;
  if (!plan) return null;
  const located = codeLessonBlockById(plan, blockId);
  if (!located) return null;
  let offset = 0;
  for (const block of located.section.blocks) {
    if (block.id === blockId) return offset;
    offset += block.code.split("\n").length;
  }
  return null;
}

/**
 * Where one line of a typed block sits on the board: the span its text
 * covers, so the pen can read along it. Same arithmetic as the caret point
 * in constants.ts, which is what the live editor, the export renderer and the
 * pen already share.
 */
export function codeLessonLineBoardSpan(
  state: CodeLessonState,
  blockId: string,
  lineIndex: number,
): { x0: number; x1: number; y: number } | null {
  const plan = state.plan;
  if (!plan) return null;
  const located = codeLessonBlockById(plan, blockId);
  const offset = sectionLineOffset(state, blockId);
  if (!located || offset === null) return null;
  const lines = located.block.code.split("\n");
  const text = lines[lineIndex];
  if (text === undefined) return null;
  const indent = text.length - text.trimStart().length;
  const left =
    DSA_CODE_PANEL_RECT.x + DSA_EDITOR_METRICS.gutterWidth + DSA_EDITOR_METRICS.codeLeftPadding + 1;
  const line = offset + lineIndex;
  return {
    x0: left + indent * DSA_EDITOR_METRICS.charWidth,
    x1: left + Math.max(text.trimEnd().length, indent + 1) * DSA_EDITOR_METRICS.charWidth,
    y:
      DSA_CODE_PANEL_RECT.y +
      DSA_EDITOR_METRICS.tabHeight +
      DSA_EDITOR_METRICS.codeTopPadding +
      line * DSA_EDITOR_METRICS.lineHeight +
      DSA_EDITOR_METRICS.lineHeight * 0.45,
  };
}

/** Revealed text of one section, in block order. */
export function revealedSectionText(
  state: CodeLessonState,
  sectionIndex: number,
): string {
  const section = state.plan?.sections[sectionIndex];
  if (!section) return "";
  const parts: string[] = [];
  for (const block of section.blocks) {
    const revealed = state.revealedChars[block.id] ?? 0;
    if (revealed <= 0) break;
    parts.push(block.code.slice(0, revealed));
    if (revealed < block.code.length) break;
  }
  return parts.join("\n");
}

export function sectionFullyRevealed(
  state: CodeLessonState,
  sectionIndex: number,
): boolean {
  const section = state.plan?.sections[sectionIndex];
  if (!section) return false;
  return section.blocks.every(
    (block) => (state.revealedChars[block.id] ?? 0) >= block.code.length,
  );
}

export function fullSectionText(state: CodeLessonState, sectionIndex: number): string {
  const section = state.plan?.sections[sectionIndex];
  return section ? codeLessonSectionCode(section) : "";
}
