export const CODE_LESSON_V1_VERSION = "code-lesson/v1";

export const CODE_LESSON_LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "java",
  "cpp",
] as const;

export type CodeLessonLanguage = (typeof CODE_LESSON_LANGUAGES)[number];

export const CODE_LESSON_DIAGRAM_STRUCTURES = [
  "array",
  "linked_list",
  "tree",
  "graph",
  "table",
  "none",
] as const;

export type CodeLessonDiagramStructure =
  (typeof CODE_LESSON_DIAGRAM_STRUCTURES)[number];

/** Widest code line the board panel renders without horizontal scrolling. */
export const MAX_CODE_LINE_CHARS = 58;

/**
 * Visible code-panel typing. These are slow on purpose: a student has to read
 * each glyph, and a whole function must not compress into a few seconds of
 * speech. Shared by the live panel and duration estimates.
 */
export const CODE_TYPE_MS_PER_CHAR = 95;
export const CODE_TYPE_MIN_VISIBLE_CHAR_MS = 90;
export const CODE_TYPE_MAX_VISIBLE_CHAR_MS = 150;
export const CODE_TYPE_MAX_BLOCK_MS = 24_000;
/**
 * How long a worked-example frame holds the board when the walk-through
 * advances. Long enough to look at the new figure before the narration moves
 * on — the lessons this replaces changed picture faster than they could be
 * read, which was the owner's "I'm not able to catch up" complaint.
 */
export const FRAME_SWAP_MS = 2_800;

/**
 * How long a DSA lesson should run. The owner asked for 6-10 minutes: long
 * enough to walk a worked example frame by frame and then build the code
 * beside it.
 *
 * The length is NOT a step count handed to the model. It used to be — a flat
 * "teach this in 23 to 37 steps" — and against a lesson with eleven things in
 * it (five frames and six blocks) the only way to reach 23 steps is to say
 * the same thing twice, which is exactly what the tutor did. The lesson's
 * shape now comes from its material: one step per figure frame, one per code
 * block, plus an opening and a close. Familiarity sets how long a step is,
 * and that is what moves a lesson inside the band.
 */
export const CODE_LESSON_TARGET_MS = { min: 6 * 60_000, max: 10 * 60_000 } as const;
export const CODE_LESSON_SPOKEN_MS_PER_STEP = 23_000;

/**
 * Spoken length of one step, by familiarity. Measured, not guessed: across a
 * 104-lesson round the model hit the step count it was given almost exactly,
 * so the length of a lesson is the step count times the length of a step, and
 * both have to be stated. At the old 16 seconds a median lesson of fourteen
 * steps could not exceed 3.7 minutes however well it was taught.
 */
export const CODE_LESSON_STEP_MS = {
  new: 28_000,
  normal: CODE_LESSON_SPOKEN_MS_PER_STEP,
  revision: 16_000,
} as const;

/**
 * Spoken words per step. Sentences are the wrong unit: the model's sentences
 * ran ten to fourteen words, so "three to four sentences" bought about half
 * the intended time. The prompt quotes these and the lab measures them.
 */
export const CODE_LESSON_STEP_WORDS = {
  new: 65,
  normal: 50,
  revision: 35,
} as const;

/** The band a lesson should land in, by familiarity. */
export const CODE_LESSON_TARGET_BY_FAMILIARITY = {
  new: { min: 8 * 60_000, max: 11 * 60_000 },
  normal: { min: 6 * 60_000, max: 9 * 60_000 },
  revision: { min: 4 * 60_000, max: 7 * 60_000 },
} as const;

export type CodeLessonBeatKind =
  | "opening"
  | "concept"
  | "brute_force"
  | "idea"
  | "frame_show"
  | "frame_why"
  | "early_exit"
  | "block"
  | "invariant"
  | "trace_through"
  | "edge_cases"
  | "bugs"
  | "close";

export interface CodeLessonBeat {
  kind: CodeLessonBeatKind;
  /** The tag this step must carry, or none for a spoken-only beat. */
  tag?: string;
  frameId?: string;
  blockId?: string;
  /** What this beat is for, rendered into the prompt as the step's brief. */
  brief: string;
}

export interface CodeLessonBeatPlanInput {
  frames: ReadonlyArray<{ id: string; caption: string }>;
  blockIds: readonly string[];
  familiarity: "new" | "normal" | "revision";
  /** The simulator returned before it reached the end of the input. */
  earlyExit?: boolean;
  /** Words this family introduces; at most two are taught to a new student. */
  terms?: readonly string[];
  /** The answer the walk-through ends on, so the close can state it. */
  resultText?: string;
}

/**
 * The lesson as a list of beats.
 *
 * A step count on its own gave the model no idea what the extra steps were
 * for, so it padded or stopped early. This is the running order a teacher
 * would use, and every beat says what it is for; the conductor can then
 * account for beats that carry no tag, which the old contract could not.
 */
export function codeLessonBeatPlan(input: CodeLessonBeatPlanInput): CodeLessonBeat[] {
  const { familiarity } = input;
  const beats: CodeLessonBeat[] = [];
  const frames = input.frames;

  beats.push({
    kind: "opening",
    brief: "the problem in plain words, the concrete values on the board, and exactly what is being asked for",
  });

  if (familiarity === "new") {
    for (const term of (input.terms ?? []).slice(0, 2)) {
      beats.push({
        kind: "concept",
        brief: `what a ${term} is in plain words, what it is good at, and what it costs`,
      });
    }
  }
  if (familiarity !== "revision") {
    beats.push({
      kind: "brute_force",
      brief: "the obvious slow way, and why it is too slow on a long input",
    });
  }
  if (familiarity === "new") {
    beats.push({ kind: "idea", brief: "the idea behind the fast approach, in one or two sentences" });
  }

  // A second beat on each frame is where the reasoning goes, but a long walk
  // cannot afford one on every frame: an exchange sort draws eleven frames,
  // and two beats each would push the lesson past anything a student sits
  // through. Spend the budget the band leaves after everything mandatory.
  const mandatory = beats.length
    + frames.length
    + input.blockIds.length
    + (input.earlyExit && familiarity !== "revision" ? 1 : 0)
    + (familiarity === "revision" ? 3 : 0)
    + 2;
  const room = Math.floor(CODE_LESSON_TARGET_BY_FAMILIARITY[familiarity].max / CODE_LESSON_STEP_MS[familiarity]);
  let whyBudget = familiarity === "revision" ? 0 : Math.max(0, room - mandatory);

  frames.forEach((frame, index) => {
    // A long walk-through is taught briskly: eleven frames at a full beat each
    // is a quarter of an hour before the code starts.
    const brisk = frames.length > 6 && index > 0;
    beats.push({
      kind: "frame_show",
      tag: `[FOCUS:${frame.id}|spotlight]`,
      frameId: frame.id,
      brief: index === 0
        ? `what the figure shows and what the algorithm is about to do with it`
        : brisk
          ? `what changed on the figure, with the actual values, in two sentences`
          : `what changed on the figure, with the actual values`,
    });
    if (index > 0 && whyBudget > 0) {
      whyBudget -= 1;
      beats.push({
        kind: "frame_why",
        tag: `[FOCUS:${frame.id}|spotlight]`,
        frameId: frame.id,
        brief: "same frame: why the algorithm made that move, and what it does next",
      });
    }
  });

  if (input.earlyExit && familiarity !== "revision") {
    beats.push({
      kind: "early_exit",
      brief: "the walk stopped because the answer was found: what would have happened to the values it never reached",
    });
  }

  for (const blockId of input.blockIds) {
    beats.push({
      kind: "block",
      tag: `[TYPE:${blockId}]`,
      blockId,
      brief: "what these lines do and which move on the figure they carry out",
    });
  }

  if (familiarity === "revision") {
    beats.push({ kind: "invariant", brief: "the invariant the loop keeps, and the exact loop bounds and update order" });
  }
  beats.push({
    kind: "trace_through",
    brief: `the finished code run on the example in words, one step at a time, ending on the answer${input.resultText ? ` (${input.resultText})` : ""}`,
  });
  if (familiarity === "revision") {
    beats.push({ kind: "edge_cases", brief: "the edge cases: empty input, one element, no answer, duplicates" });
    beats.push({ kind: "bugs", brief: "the two mistakes people actually make writing this, and how the code avoids them" });
  }
  beats.push({ kind: "close", brief: "the time and space complexity, with the reason for each, in terms of this example" });
  return beats;
}

/** Steps a lesson takes. Kept for callers that only need the count. */
export function codeLessonStepCount(frameCount: number, blockCount: number): number {
  return Math.max(frameCount, 1) + blockCount + 2;
}

/** Structures that teach a concrete worked example, so steps are required. */
export const CODE_LESSON_STEPPED_STRUCTURES: readonly CodeLessonDiagramStructure[] = [
  "array",
  "linked_list",
  "tree",
  "graph",
  "table",
];

export function diagramHintRequiresSteps(
  structure: CodeLessonDiagramStructure,
): boolean {
  return CODE_LESSON_STEPPED_STRUCTURES.includes(structure);
}

/** Blocks per section; one block is revealed per [TYPE] narration step. */
export const MAX_SECTION_BLOCKS = 10;

/** Lines per block, so one reveal stays inside a single spoken step. */
export const MAX_BLOCK_LINES = 8;

/**
 * Lines a block aims for. One block is one spoken beat, so this is the grain
 * of the whole lesson: too coarse and the tutor narrates a page of code in one
 * breath, too fine and it reads the program out line by line.
 */
export const TARGET_BLOCK_LINES = 3;

export interface CodeLessonBlock {
  /** Unique across the whole plan; referenced by teaching [TYPE:id] tags. */
  id: string;
  /** 1-6 consecutive source lines, newline-joined, no trailing newline. */
  code: string;
}

export interface CodeLessonLineRange {
  /** 1-based inclusive, over the section's joined code. */
  startLine: number;
  endLine: number;
}

export interface CodeLessonSection {
  id: string;
  title: string;
  /** Student-facing summary shown after the section is typed. */
  explanation: string;
  blocks: CodeLessonBlock[];
  /** Core algorithm lines the student practices in type-along mode. */
  typeAlongRanges: CodeLessonLineRange[];
  diagramCue?: string;
}

export interface CodeLessonDiagramPointer {
  name: string;
  /** 0-based cell index into `values`. */
  index: number;
}

export interface CodeLessonDiagramNode {
  id: string;
  label: string;
}

export interface CodeLessonDiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface CodeLessonDiagramGroup {
  values?: Array<string | number>;
  pointers?: CodeLessonDiagramPointer[];
  nodes?: CodeLessonDiagramNode[];
  edges?: CodeLessonDiagramEdge[];
}

/** One frame of a worked example, revealed after the previous frame. */
export interface CodeLessonDiagramStep {
  id: string;
  caption?: string;
  values?: Array<string | number>;
  pointers?: CodeLessonDiagramPointer[];
  nodes?: CodeLessonDiagramNode[];
  edges?: CodeLessonDiagramEdge[];
  /** Side-by-side structures in this frame (e.g. the two halves of a split). */
  groups?: CodeLessonDiagramGroup[];
}

export interface CodeLessonDiagramHint {
  structure: CodeLessonDiagramStructure;
  caption?: string;
  values?: Array<string | number>;
  pointers?: CodeLessonDiagramPointer[];
  nodes?: CodeLessonDiagramNode[];
  edges?: CodeLessonDiagramEdge[];
  rowLabels?: string[];
  colLabels?: string[];
  cells?: string[][];
  /**
   * Worked-example frames, revealed in order. The first frame is the full
   * input; later frames are the same example after a split, a pointer move,
   * or a reversed link. Omit when a single structure is enough.
   */
  steps?: CodeLessonDiagramStep[];
}

export interface CodeLessonPlan {
  schemaVersion: typeof CODE_LESSON_V1_VERSION;
  question: string;
  title: string;
  language: CodeLessonLanguage;
  sections: CodeLessonSection[];
  diagramHint: CodeLessonDiagramHint;
}

export interface CodeLessonIssue {
  code: string;
  message: string;
}

export function isCodeLessonLanguage(value: unknown): value is CodeLessonLanguage {
  return CODE_LESSON_LANGUAGES.includes(value as CodeLessonLanguage);
}

/** Full source of a section: its blocks joined in order. */
export function codeLessonSectionCode(section: CodeLessonSection): string {
  return section.blocks.map((block) => block.code).join("\n");
}

export function codeLessonBlockById(
  plan: CodeLessonPlan,
  blockId: string,
): { section: CodeLessonSection; block: CodeLessonBlock } | null {
  for (const section of plan.sections) {
    const block = section.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { section, block };
  }
  return null;
}

export function codeLessonIndentUnit(language: CodeLessonLanguage): number {
  return language === "javascript" || language === "typescript" ? 2 : 4;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCodeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n")
    .map((line) => line.replace(/[ \u00a0]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function normalizeLineRange(value: unknown): CodeLessonLineRange | null {
  if (Array.isArray(value) && value.length === 2) {
    const [startLine, endLine] = value;
    if (typeof startLine === "number" && typeof endLine === "number") {
      return { startLine, endLine };
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const startLine = value.startLine ?? value.start ?? value.from;
  const endLine = value.endLine ?? value.end ?? value.to;
  if (typeof startLine !== "number" || typeof endLine !== "number") return null;
  return { startLine, endLine };
}

/**
 * Regroup a section's blocks so every block is a reveal-sized run of lines.
 *
 * Block boundaries are presentation only — concatenating them in order always
 * rebuilds the same section source — so planner granularity (one block per
 * line is common) is repacked here rather than bounced back as a validation
 * failure. Splitting oversized blocks runs before merging so a single huge
 * block cannot survive as one reveal.
 */
function repackSectionBlocks(
  blocks: CodeLessonBlock[],
  sectionId: string,
): CodeLessonBlock[] {
  const totalLines = blocks.reduce(
    (sum, block) => sum + block.code.split("\n").length,
    0,
  );
  if (totalLines === 0) return [];

  // A block is one narrated beat, so its size sets the lesson's grain. Left at
  // the 8-line ceiling, a planner that returned one block per function gave a
  // three-beat lesson: three paragraphs of speech against a whole program
  // typing itself. Aim for a few lines, and only coarsen when a long section
  // would otherwise blow past the block cap.
  const targetLines = Math.min(
    MAX_BLOCK_LINES,
    Math.max(TARGET_BLOCK_LINES, Math.ceil(totalLines / MAX_SECTION_BLOCKS)),
  );

  // Model boundaries are kept when they are already fine enough; only an
  // oversized block is cut, into near-equal pieces rather than a long head and
  // a one-line tail.
  const runs: string[][] = [];
  for (const block of blocks) {
    const lines = block.code.split("\n");
    if (lines.length <= targetLines) {
      runs.push(lines);
      continue;
    }
    const pieces = Math.ceil(lines.length / targetLines);
    const per = Math.ceil(lines.length / pieces);
    for (let start = 0; start < lines.length; start += per) {
      runs.push(lines.slice(start, start + per));
    }
  }
  if (runs.length === 0) return [];
  const packed: string[][] = [];
  for (const run of runs) {
    const current = packed[packed.length - 1];
    if (current && current.length + run.length <= targetLines) {
      current.push(...run);
      continue;
    }
    packed.push([...run]);
  }
  // A block is one thing a teacher points at, so it never ends on a line that
  // opens a body: cutting purely by line count put a loop header in one beat
  // and its body in the next, and left one-line tails like `return False`
  // that the tutor then read out verbatim. The header takes the first line of
  // its body across rather than swallowing the whole next block, so the grain
  // of the lesson stays what it was.
  const opensBody = (line: string): boolean => /[:{([]\s*$/.test(line.trimEnd());
  const ceiling = Math.min(MAX_BLOCK_LINES, targetLines + 2);
  for (let index = 0; index < packed.length - 1; ) {
    const current = packed[index]!;
    const next = packed[index + 1]!;
    const lastLine = current[current.length - 1] ?? "";
    if (opensBody(lastLine) && current.length < ceiling) {
      if (next.length === 1) {
        current.push(...next);
        packed.splice(index + 1, 1);
      } else {
        current.push(next.shift()!);
      }
      continue;
    }
    // A single line on its own is a beat with nothing to say about it.
    if (next.length === 1 && current.length + 1 <= ceiling) {
      current.push(...next);
      packed.splice(index + 1, 1);
      continue;
    }
    index += 1;
  }
  return packed.map((lines, index) => ({
    id: `${sectionId}b${index + 1}`,
    code: lines.join("\n"),
  }));
}

/**
 * Coerce common planner-output slop (object maps instead of arrays, missing
 * ids, tab indentation, per-line block splits) into the canonical shape
 * before validation.
 */
export function normalizeCodeLessonPlan(value: unknown, question: string): unknown {
  if (!isRecord(value)) return value;
  const rawSections = Array.isArray(value.sections)
    ? value.sections
    : isRecord(value.sections)
      ? Object.entries(value.sections).map(([id, section]) =>
          isRecord(section) ? { id, ...section } : section)
      : [];
  // Section ids name the page and prefix every block id, so a repeated id
  // would cascade into duplicate block ids the [TYPE] tags cannot resolve.
  const usedSectionIds = new Set<string>();
  const sections = rawSections.flatMap((rawSection, sectionIndex) => {
    if (!isRecord(rawSection)) return [];
    const requestedId = typeof rawSection.id === "string" && rawSection.id.trim() !== ""
      ? rawSection.id.trim()
      : `s${sectionIndex + 1}`;
    let sectionId = requestedId;
    for (let suffix = 2; usedSectionIds.has(sectionId); suffix += 1) {
      sectionId = `${requestedId}_${suffix}`;
    }
    usedSectionIds.add(sectionId);
    const rawBlocks = Array.isArray(rawSection.blocks)
      ? rawSection.blocks
      : typeof rawSection.code === "string"
        ? [{ code: rawSection.code }]
        : [];
    const parsedBlocks = rawBlocks.flatMap((rawBlock, blockIndex) => {
      const code = isRecord(rawBlock)
        ? rawBlock.code
        : typeof rawBlock === "string"
          ? rawBlock
          : null;
      if (typeof code !== "string") return [];
      const normalizedCode = normalizeCodeText(code);
      if (normalizedCode.trim() === "") return [];
      const blockId = isRecord(rawBlock) &&
        typeof rawBlock.id === "string" && rawBlock.id.trim() !== ""
        ? rawBlock.id.trim()
        : `${sectionId}b${blockIndex + 1}`;
      return [{ id: blockId, code: normalizedCode }];
    });
    const blocks = repackSectionBlocks(parsedBlocks, sectionId);
    // Type-along ranges pick the lines a student practises. A range that runs
    // past the end of the section, or overlaps the one before it, is a slip in
    // a practice aid — and rejecting the plan for it threw away the whole
    // lesson: a validated program, its worked example, and the code panel,
    // replaced by a handwriting fallback. Measured live on "implement a queue
    // using two stacks", where both the plan and the repair were rejected for
    // exactly this. Clamp what can be clamped and drop what cannot; a missing
    // practice range is invisible, a missing lesson is not.
    const sectionLineCount = blocks.reduce(
      (total, block) => total + block.code.split("\n").length,
      0,
    );
    // Sorted before clamping, or a pair given out of order would clamp the
    // second one against the first one's end and lose it entirely.
    const requestedRanges = (Array.isArray(rawSection.typeAlongRanges)
      ? rawSection.typeAlongRanges
      : []
    )
      .flatMap((range) => {
        const normalized = normalizeLineRange(range);
        return normalized ? [normalized] : [];
      })
      .sort((first, second) => first.startLine - second.startLine);
    const typeAlongRanges: CodeLessonLineRange[] = [];
    let previousEnd = 0;
    for (const range of requestedRanges) {
      const startLine = Math.max(range.startLine, previousEnd + 1, 1);
      const endLine = Math.min(range.endLine, sectionLineCount);
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) continue;
      if (endLine < startLine) continue;
      typeAlongRanges.push({ startLine, endLine });
      previousEnd = endLine;
    }
    return [{
      ...rawSection,
      id: sectionId,
      title: typeof rawSection.title === "string" ? rawSection.title.trim() : "",
      explanation: typeof rawSection.explanation === "string"
        ? rawSection.explanation.trim()
        : "",
      blocks,
      typeAlongRanges,
      ...(typeof rawSection.diagramCue === "string"
        ? { diagramCue: rawSection.diagramCue }
        : {}),
    }];
  });
  const rawHint = isRecord(value.diagramHint) ? value.diagramHint : {};
  const structure = CODE_LESSON_DIAGRAM_STRUCTURES.includes(
    rawHint.structure as CodeLessonDiagramStructure,
  )
    ? rawHint.structure
    : "none";
  return {
    ...value,
    schemaVersion: CODE_LESSON_V1_VERSION,
    question,
    title: typeof value.title === "string" ? value.title.trim() : "",
    language: isCodeLessonLanguage(value.language) ? value.language : "python",
    sections,
    diagramHint: { ...rawHint, structure },
  };
}

/** Shape validation. Code-quality rules live in `codeFormatGate`. */
export function validateCodeLessonPlan(value: unknown): {
  plan: CodeLessonPlan | null;
  issues: CodeLessonIssue[];
} {
  const issues: CodeLessonIssue[] = [];
  if (!isRecord(value)) {
    return { plan: null, issues: [{ code: "not_object", message: "Plan is not an object." }] };
  }
  if (value.schemaVersion !== CODE_LESSON_V1_VERSION) {
    issues.push({ code: "schema_version", message: `schemaVersion must be "${CODE_LESSON_V1_VERSION}".` });
  }
  if (typeof value.question !== "string" || value.question.trim() === "") {
    issues.push({ code: "question", message: "question must be a non-empty string." });
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    issues.push({ code: "title", message: "title must be a non-empty string." });
  }
  if (!isCodeLessonLanguage(value.language)) {
    issues.push({ code: "language", message: `language must be one of ${CODE_LESSON_LANGUAGES.join(", ")}.` });
  }
  const sections = Array.isArray(value.sections) ? value.sections : null;
  if (!sections || sections.length === 0 || sections.length > 6) {
    issues.push({ code: "sections", message: "sections must contain 1-6 items." });
  }
  const seenSectionIds = new Set<string>();
  const seenBlockIds = new Set<string>();
  for (const [sectionIndex, section] of (sections ?? []).entries()) {
    const where = `sections[${sectionIndex}]`;
    if (!isRecord(section)) {
      issues.push({ code: "section_shape", message: `${where} is not an object.` });
      continue;
    }
    if (typeof section.id !== "string" || section.id.trim() === "") {
      issues.push({ code: "section_id", message: `${where}.id must be a non-empty string.` });
    } else if (seenSectionIds.has(section.id)) {
      issues.push({ code: "section_id_duplicate", message: `${where}.id "${section.id}" repeats.` });
    } else {
      seenSectionIds.add(section.id);
    }
    if (typeof section.title !== "string" || section.title.trim() === "") {
      issues.push({ code: "section_title", message: `${where}.title must be a non-empty string.` });
    }
    if (typeof section.explanation !== "string" || section.explanation.trim() === "") {
      issues.push({ code: "section_explanation", message: `${where}.explanation must be a non-empty string.` });
    }
    const blocks = Array.isArray(section.blocks) ? section.blocks : null;
    if (!blocks || blocks.length === 0) {
      issues.push({ code: "section_blocks", message: `${where}.blocks must contain code.` });
      continue;
    }
    // Blocks arrive repacked, so an overflow here means the section source is
    // genuinely too long to teach as one page — not a grouping slip.
    if (blocks.length > MAX_SECTION_BLOCKS) {
      issues.push({
        code: "section_too_long",
        message: `${where} is too long for one page; split it into more sections.`,
      });
      continue;
    }
    for (const [blockIndex, block] of blocks.entries()) {
      if (!isRecord(block) || typeof block.id !== "string" || block.id.trim() === "" ||
          typeof block.code !== "string" || block.code.trim() === "") {
        issues.push({
          code: "block_shape",
          message: `${where}.blocks[${blockIndex}] must have a non-empty id and code.`,
        });
        continue;
      }
      if (seenBlockIds.has(block.id)) {
        issues.push({ code: "block_id_duplicate", message: `Block id "${block.id}" repeats.` });
      } else {
        seenBlockIds.add(block.id);
      }
      if (block.code.split("\n").length > MAX_BLOCK_LINES) {
        issues.push({
          code: "block_too_long",
          message: `Block "${block.id}" exceeds ${MAX_BLOCK_LINES} lines; split it.`,
        });
      }
    }
    const sectionLineCount = blocks
      .filter((block): block is { id: string; code: string } =>
        isRecord(block) && typeof block.code === "string")
      .map((block) => block.code.split("\n").length)
      .reduce((total, count) => total + count, 0);
    const ranges = Array.isArray(section.typeAlongRanges) ? section.typeAlongRanges : null;
    if (!ranges) {
      issues.push({ code: "type_along_shape", message: `${where}.typeAlongRanges must be an array.` });
      continue;
    }
    let previousEnd = 0;
    for (const [rangeIndex, range] of ranges.entries()) {
      const normalized = normalizeLineRange(range);
      if (!normalized ||
          !Number.isInteger(normalized.startLine) || !Number.isInteger(normalized.endLine) ||
          normalized.startLine < 1 || normalized.endLine < normalized.startLine ||
          normalized.endLine > sectionLineCount) {
        issues.push({
          code: "type_along_range",
          message: `${where}.typeAlongRanges[${rangeIndex}] must be 1-based, ordered, and within ${sectionLineCount} lines.`,
        });
        continue;
      }
      if (normalized.startLine <= previousEnd) {
        issues.push({
          code: "type_along_overlap",
          message: `${where}.typeAlongRanges[${rangeIndex}] overlaps the previous range.`,
        });
      }
      previousEnd = Math.max(previousEnd, normalized.endLine);
    }
  }
  const hint = value.diagramHint;
  if (!isRecord(hint) || !CODE_LESSON_DIAGRAM_STRUCTURES.includes(hint.structure as CodeLessonDiagramStructure)) {
    issues.push({ code: "diagram_hint", message: "diagramHint.structure must name a supported structure." });
  } else if (diagramHintRequiresSteps(hint.structure as CodeLessonDiagramStructure)) {
    const steps = Array.isArray(hint.steps) ? hint.steps : [];
    if (steps.length < 2 || steps.length > 4) {
      issues.push({
        code: "diagram_steps",
        message: "diagramHint.steps must contain 2-4 frames of the same worked example.",
      });
    } else {
      const seenStepIds = new Set<string>();
      for (const [stepIndex, step] of steps.entries()) {
        if (!isRecord(step) || typeof step.id !== "string" || step.id.trim() === "") {
          issues.push({
            code: "diagram_step_id",
            message: `diagramHint.steps[${stepIndex}].id must be a non-empty string.`,
          });
          continue;
        }
        if (seenStepIds.has(step.id)) {
          issues.push({
            code: "diagram_step_id",
            message: `diagramHint.steps[${stepIndex}].id "${step.id}" repeats.`,
          });
        }
        seenStepIds.add(step.id);
      }
    }
  }
  if (issues.length > 0) return { plan: null, issues };
  return { plan: value as unknown as CodeLessonPlan, issues };
}
