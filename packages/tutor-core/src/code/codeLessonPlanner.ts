import { tutorDebug } from "../tutorDebug";
import { withFastModeHeader } from "../llm/fastMode";
import {
  CODE_LESSON_V1_VERSION,
  MAX_CODE_LINE_CHARS,
  normalizeCodeLessonPlan,
  validateCodeLessonPlan,
  type CodeLessonIssue,
  type CodeLessonPlan,
} from "./codeLessonPlan";
import {
  codeFormatGateIssues,
  codeSyntaxIssues,
  type CodeSyntaxChecker,
} from "./codeFormatGate";
import { codeTraceIssues, type CodeLessonPlanContext } from "./codeTraceGate";

export interface CodeLessonPlannerOptions {
  proxyUrl: string;
  /**
   * The walk-through the board is committed to drawing. Without it the
   * planner wrote whichever solution it liked and the figure walked another.
   */
  context?: CodeLessonPlanContext;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fastMode?: boolean;
  /** Optional per-language parser (e.g. prettier for js/ts). */
  syntaxCheck?: CodeSyntaxChecker;
  /**
   * Why a plan was refused. A rejection costs the student the whole code
   * panel, and the reason was thrown away with the plan, so nothing offline
   * could say which rule was doing it.
   */
  onRejected?: (phase: "plan" | "repair", issues: CodeLessonIssue[]) => void;
}

export interface CodeLessonPlanResponse {
  plan: CodeLessonPlan;
  rawContent: string;
  elapsedMs: number;
  traceId?: string;
}

/**
 * Plan a verified code lesson before narration starts. The teaching stream
 * only reveals blocks committed here via [TYPE:blockId]; it never writes code
 * inline, so a plan that fails the deterministic gate never reaches the board.
 */
/**
 * Share of the lane's budget the first attempt may spend, so a slow one cannot
 * starve the repair that follows it.
 */
export const FIRST_ATTEMPT_BUDGET_SHARE = 0.6;

/**
 * Issues about how the code looks rather than whether it is right. They are
 * worth a repair attempt, and never worth throwing the lesson away: a line a
 * few characters too wide wraps in the editor, while a rejected plan leaves
 * the student with no code panel and no worked example at all.
 */
const COSMETIC_ISSUE_CODES = new Set([
  "line_too_wide",
  "indent_step",
  "trailing_whitespace",
  "tab_indent",
]);

export async function planCodeLessonV1(
  question: string,
  options: CodeLessonPlannerOptions,
): Promise<CodeLessonPlanResponse | null> {
  const startedAt = Date.now();
  // The first attempt may not spend the whole budget. Measured live: a slow
  // plan ran 53 of its 60 seconds, the repair was cut off after 9, and the
  // turn lost its code panel and its worked example altogether. A rejected
  // plan is the normal case this lane is built around, so the repair has to
  // be affordable rather than whatever happens to be left.
  const firstAttemptMs = Math.max(
    Math.round(options.timeoutMs * FIRST_ATTEMPT_BUDGET_SHARE),
    1_000,
  );
  const first = await requestCodeLessonPlan(
    question,
    { ...options, timeoutMs: firstAttemptMs },
    CODE_LESSON_V1_PROMPT,
    `QUESTION\n${question}${boardContextBlock(options.context)}`,
    "plan",
  );
  if (options.signal?.aborted) return null;
  if (first?.plan) return { ...first, plan: first.plan };

  const feedback = first?.issues?.length
    ? `Deterministic validation rejected the previous plan:\n${first.issues
        .slice(0, 12)
        .map((issue) => `- [${issue.code}] ${issue.message}`)
        .join("\n")}`
    : "The previous response was not a parseable code-lesson/v1 JSON object.";
  const remainingMs = Math.max(0, options.timeoutMs - (Date.now() - startedAt));
  const repaired =
    remainingMs < 1_000
      ? null
      : await requestCodeLessonPlan(
          question,
          { ...options, timeoutMs: remainingMs },
          CODE_LESSON_V1_REPAIR_PROMPT,
          `QUESTION\n${question}${boardContextBlock(options.context)}\n\n${feedback}\n\nReturn one complete corrected plan.`,
          "repair",
        );
  if (repaired?.plan) return { ...repaired, plan: repaired.plan };
  // The repair produced nothing usable. If the first attempt was rejected only
  // for what the repair itself would have tolerated, teach from it rather than
  // dropping the code panel: a lesson with a slightly wide line still teaches,
  // and a lesson with no code does not.
  if (first?.salvageable) {
    tutorDebug("planner", "code lesson kept the first plan after the repair returned nothing", {
      issue_codes: first.issues.map((issue) => issue.code),
    });
    return { ...first, plan: first.salvageable };
  }
  return null;
}

interface CodeLessonAttempt extends Omit<CodeLessonPlanResponse, "plan"> {
  plan: CodeLessonPlan | null;
  issues: CodeLessonIssue[];
  /**
   * A plan this attempt rejected, but only for the reasons the repair pass is
   * already willing to live with: a line a few characters wide, an indent
   * step, a different example from the board.
   *
   * The repair is a second call to a language model and it can come back with
   * nothing at all. Measured on Network Delay Time: the repair returned an
   * empty object, both attempts were discarded, and the student got a DSA
   * lesson with no code panel. A slightly wide line is not worth that.
   */
  salvageable: CodeLessonPlan | null;
}

async function requestCodeLessonPlan(
  question: string,
  options: CodeLessonPlannerOptions,
  systemPrompt: string,
  userContent: string,
  phase: "plan" | "repair",
): Promise<CodeLessonAttempt | null> {
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), Math.max(1, options.timeoutMs));
  const signal = options.signal
    ? mergeAbortSignals(options.signal, timeoutController.signal)
    : timeoutController.signal;

  tutorDebug("planner", `starting code lesson v1 ${phase}`, {
    timeout_ms: options.timeoutMs,
    schema_version: CODE_LESSON_V1_VERSION,
  });

  try {
    const response = await fetch(options.proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-planner": "1",
        "x-code-lesson-version": "1",
        "x-planner-deadline-ms": String(options.timeoutMs),
        ...(options.sessionId ? { "x-session-id": options.sessionId } : {}),
        ...withFastModeHeader({}, options.fastMode),
      },
      signal,
      body: JSON.stringify({
        model: "server",
        max_tokens: 5000,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = parseCodeLessonJson(content);
    if (!parsed) {
      return {
        plan: null,
        issues: [{ code: "parse", message: "Response was not a JSON object." }],
        salvageable: null,
        rawContent: content,
        elapsedMs: Date.now() - startedAt,
        traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
      };
    }
    const normalized = normalizeCodeLessonPlan(parsed, question);
    const validated = validateCodeLessonPlan(normalized);
    const issues = [...validated.issues];
    let plan = validated.plan;
    let salvageable: CodeLessonPlan | null = null;
    if (plan) {
      issues.push(...codeFormatGateIssues(plan));
      issues.push(...await codeSyntaxIssues(plan, options.syntaxCheck));
      // The code has to be the algorithm the board is drawing, on the same
      // example. On the first attempt a mismatch is worth a repair; on the
      // repair it is not worth the whole code panel, because a lesson with a
      // slightly different example still teaches and no lesson does not.
      const traceIssues = options.context ? codeTraceIssues(plan, options.context) : [];
      if (phase === "plan") issues.push(...traceIssues);
      else if (traceIssues.length > 0) {
        tutorDebug("planner", "code lesson repair still disagrees with the board", {
          issue_codes: traceIssues.map((issue) => issue.code),
        });
      }
      // On the repair, a cosmetic slip is not worth the whole code panel.
      // Measured: two lessons in a thirty-problem round were lost to a line
      // five characters too wide and an indent step, and the student got no
      // code at all. Structure still has to be right; width does not.
      const blocking = phase === "plan" ? issues : issues.filter((issue) => !COSMETIC_ISSUE_CODES.has(issue.code));
      if (phase === "repair" && issues.length > blocking.length) {
        tutorDebug("planner", "code lesson repair accepted with cosmetic issues", {
          issue_codes: issues.filter((issue) => COSMETIC_ISSUE_CODES.has(issue.code)).map((issue) => issue.code),
        });
      }
      if (blocking.length > 0) plan = null;
      if (!plan) {
        const tolerated = new Set<string>([
          ...COSMETIC_ISSUE_CODES,
          ...traceIssues.map((issue) => issue.code),
        ]);
        if (issues.every((issue) => tolerated.has(issue.code))) salvageable = validated.plan;
      }
    }
    if (!plan) {
      tutorDebug("planner", `code lesson v1 ${phase} rejected`, {
        issue_codes: issues.map((issue) => issue.code),
      });
      options.onRejected?.(phase, issues);
    }
    return {
      plan,
      issues,
      salvageable,
      rawContent: content,
      elapsedMs: Date.now() - startedAt,
      traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
    };
  } catch (error) {
    tutorDebug("planner", `code lesson v1 ${phase} failed`, {
      reason: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * What the board will be drawing while this code is typed.
 *
 * The planner is otherwise blind to it: it sees the question, writes a
 * correct-but-different solution, and the lesson then narrates a figure of one
 * algorithm over the code of another.
 */
function boardContextBlock(context: CodeLessonPlanContext | undefined): string {
  if (!context) return "";
  const frames = context.frameCaptions?.length
    ? `\nThe student watches these frames before any code is typed:\n${context.frameCaptions
        .map((caption, index) => `${index + 1}. ${caption}`)
        .join("\n")}`
    : "";
  return `\n\nALREADY DRAWN ON THE BOARD
Technique: ${context.familyTitle}.
How it works, in one line: ${context.mechanism}
Worked example: ${renderExampleInput(context.input)}${context.resultText ? `\nAnswer: ${context.resultText}` : ""}${frames}

The program must implement exactly this technique, doing the same operations in the same order, and its driver must run exactly this example and print that answer. Do not add a preprocessing pass, a sort, or a helper that builds the whole structure before the scan, and do not solve it by a different technique that happens to give the same answer.`;
}

function renderExampleInput(input: Record<string, unknown> | null | undefined): string {
  const parts: string[] = [];
  // A context assembled without an input is a caller bug, but throwing here
  // takes the whole code panel down with it, and a lesson with no code is a
  // worse outcome than a lesson whose prompt names no example.
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue;
    parts.push(`${key} = ${JSON.stringify(value)}`);
    if (parts.length >= 4) break;
  }
  return parts.join(", ") || JSON.stringify(input ?? {});
}

function parseCodeLessonJson(content: string): unknown {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function mergeAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) abort();
  else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export const CODE_LESSON_V1_PROMPT = `Return only one complete code-lesson/v1 JSON object. Do not emit prose, markdown fences, drawing commands, or pixels. This is a worked-example lesson, not a compact summary.

Required keys: schemaVersion:"code-lesson/v1", question, title, language, sections, diagramHint.

language: one of "python","javascript","typescript","java","cpp". Use the language the question asks for; otherwise "python".
title: at most 48 characters.

sections: 1-4 items {id,title,explanation,blocks,typeAlongRanges}. A section is one self-contained unit of code shown on its own page, and every section must be syntactically complete on its own. Order them the way you would explain them at a board: the function that IS the algorithm first, then any helper it genuinely calls, then a short driver that runs the worked example and prints its result. Do not invent a helper: a one-pass algorithm is one function, and a class with several short methods is one section rather than one section per method. Never redefine a function that an earlier section already defined.
- id: compact slug like "s1".
- title: at most 40 characters.
- explanation: 3-5 plain sentences that say what this section does on the concrete example, not a one-line summary. No markdown.
- blocks: {id,code} items. A block is one thing a teacher points at while saying one thing about it: a signature with its setup lines, a loop header together with the first lines of its body, a condition with what it does, a return with the lines that compute it. A block must never end on a line that opens a body (a line ending in a colon or an opening brace). 3 to 5 lines each, never more than 6, and concatenating a section's blocks in order must reproduce the section exactly. Block ids look like "s1b1".
- typeAlongRanges: {startLine,endLine} 1-based inclusive ranges over the complete section source marking only the core algorithm lines a student should practice typing. Exclude imports, signatures, and boilerplate. Ranges must be ordered and must not overlap. Use [] when a section is pure boilerplate.

Code style is mandatory: at most ${MAX_CODE_LINE_CHARS} characters per line; spaces only, never tabs; indent in steps of 4 spaces (2 for javascript/typescript); no trailing whitespace; short descriptive names; no comments that restate the code.

diagramHint drives one deterministic worked-example diagram beside the code: {structure,caption?,values?,pointers?,nodes?,edges?,rowLabels?,colLabels?,cells?,steps}.
- structure: "array" | "linked_list" | "tree" | "graph" | "table" | "none".
- array: values = 4-9 short example values; pointers = up to 3 {name,index} markers (0-based) such as lo/mid/hi.
- linked_list: nodes = 3-6 {id,label} in list order; edges = {from,to} next-links.
- tree: nodes = 3-9 {id,label}; edges = {from,to} from parent to child.
- graph: nodes = 4-7 {id,label}; edges = {from,to,label?} with numeric weights on the labels for MST / shortest-path algorithms.
- table: rowLabels and colLabels are headers only. cells is a rows×columns grid of short strings (at most 6×8). cells[r][c] is the value at row r, column c — never put header names inside cells. A 3 that belongs in the first data column is cells[row][0], not a later index.
- steps: REQUIRED whenever structure is array, linked_list, tree, graph, or table. 2-4 frames of the SAME concrete example, revealed in order. Frame 1 is the full input. Later frames show that example after one algorithm move — a halved search range, two split subarrays (use groups: [{values:[...]},{values:[...]}]), flipped next-links, a growing MST (only the accepted edges), or a table cell that just updated. Do not invent a second unrelated example. Do not omit steps for graphs, arrays, or tables. Only structure "none" may omit steps.
Use one small concrete example that matches the code and explanations. Every label at most 12 characters. caption at most 60 characters. step.id is a compact slug like "input", "take_1_3", "split", "k1".

The question field must contain the user's exact question.`;

export const CODE_LESSON_V1_REPAIR_PROMPT = `${CODE_LESSON_V1_PROMPT}

This is a repair attempt after deterministic validation rejected the first result. Fix every reported issue: keep each code line at or under ${MAX_CODE_LINE_CHARS} characters (split long expressions across lines), keep every section self-contained and balanced, split any section longer than 40 lines into more sections, keep typeAlongRanges inside each section's line count, and if diagram_steps was reported add 2-4 frames of the same worked example (do not drop the figure to "none" to dodge that).`;
