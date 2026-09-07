/**
 * Does the committed program teach the algorithm the board is drawing?
 *
 * The planner writes the code and the simulator draws the figure, and until
 * now nothing compared them. Measured over 104 lessons: fourteen taught a
 * program whose technique or example differed from the walk-through beside
 * it, and the tutor narrated both. Two Sum is the clearest case — the figure
 * walks a one-pass map while the panel builds the whole index first, so the
 * student hears "one lookup, no second loop" over a second loop.
 *
 * These checks are deterministic and cheap, and they run before the plan is
 * accepted, so a mismatch becomes a repair rather than a lesson.
 */
import type { CodeLessonPlan } from "./codeLessonPlan";
import { codeLessonSectionCode } from "./codeLessonPlan";

export interface CodeShapeContract {
  require?: RegExp[];
  forbid?: RegExp[];
  maxLoopsInMain?: number;
  helpers?: "none" | "allowed";
}

/** What the board is walking, handed to the planner and checked here. */
export interface CodeLessonPlanContext {
  familyId: string;
  familyTitle: string;
  /** One line: what the algorithm does, in order. */
  mechanism: string;
  /** The concrete input the figure walks. */
  input: Record<string, unknown>;
  /** The answer that input produces. */
  resultText?: string;
  /** Captions of the frames the student will watch, in order. */
  frameCaptions?: readonly string[];
  forbidTitles?: readonly RegExp[];
  codeShape?: CodeShapeContract;
}

export interface CodeTraceIssue {
  code: string;
  message: string;
}

/** Numeric literals in the order they appear, so `[2, 7, 11, 15]` is checked as a run. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function containsRun(haystack: readonly number[], needle: readonly number[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Every array of numbers, and every scalar, the traced example used. */
function exampleValues(input: Record<string, unknown>): { arrays: number[][]; scalars: number[]; strings: string[] } {
  const arrays: number[][] = [];
  const scalars: number[] = [];
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      scalars.push(value);
      return;
    }
    if (typeof value === "string") {
      if (/^[A-Za-z]{2,20}$/.test(value)) strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
      if (numbers.length === value.length && numbers.length >= 3) arrays.push(numbers);
      else for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };
  walk(input);
  return { arrays, scalars, strings };
}

function loopCount(code: string): number {
  return code.split("\n").filter((line) => /^\s*(?:for|while)\b/.test(line)).length;
}

/**
 * Functions that carry an algorithm, which is what "one function" means. A
 * node class, a builder, or a printer is scaffolding a linked-list or tree
 * problem cannot do without, and counting those rejected correct plans.
 */
function algorithmFunctionCount(code: string): number {
  const lines = code.split("\n");
  let count = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*(?:def|function)\s+(\w+)/.exec(line);
    if (!match) continue;
    const name = match[1]!;
    if (/^(?:__init__|build|make|to_list|from_list|print|show|main|display)/i.test(name)) continue;
    const indent = line.search(/\S/);
    let hasLoop = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const body = lines[cursor]!;
      if (body.trim().length === 0) continue;
      if (body.search(/\S/) <= indent) break;
      if (/^\s*(?:for|while)\b/.test(body)) hasLoop = true;
    }
    if (hasLoop) count += 1;
  }
  return count;
}

/**
 * The section that returns the answer. A program's shape claim is about its
 * algorithm, not about a driver that happens to loop while printing.
 */
function mainSection(plan: CodeLessonPlan): string {
  const sources = plan.sections.map((section) => codeLessonSectionCode(section));
  const returning = sources.filter((code) => /\breturn\b/.test(code));
  if (returning.length === 0) return sources.join("\n");
  return returning.reduce((longest, code) => (code.length > longest.length ? code : longest));
}

/**
 * Check a plan against the walk-through the board is committed to drawing.
 * An empty list means the program teaches the same algorithm on the same
 * example, which is the only case where the lesson can be coherent.
 */
export function codeTraceIssues(plan: CodeLessonPlan, context: CodeLessonPlanContext): CodeTraceIssue[] {
  const issues: CodeTraceIssue[] = [];
  const whole = plan.sections.map((section) => codeLessonSectionCode(section)).join("\n");
  const driver = plan.sections.length > 0 ? codeLessonSectionCode(plan.sections[plan.sections.length - 1]!) : "";
  const main = mainSection(plan);

  // 1. The program must run the example the board walks.
  const { arrays, scalars, strings } = exampleValues(context.input);
  const wholeNumbers = numbersIn(whole);
  for (const array of arrays.slice(0, 2)) {
    if (!containsRun(wholeNumbers, array)) {
      issues.push({
        code: "example_missing",
        message: `The worked example on the board uses ${JSON.stringify(array)}; the program must run on exactly those values, in that order.`,
      });
      break;
    }
  }
  for (const word of strings.slice(0, 2)) {
    if (!whole.includes(word)) {
      issues.push({
        code: "example_missing",
        message: `The worked example on the board uses "${word}"; the program must run on exactly that input.`,
      });
      break;
    }
  }
  const missingScalar = scalars.slice(0, 3).find((value) => !wholeNumbers.includes(value));
  if (arrays.length > 0 && missingScalar !== undefined) {
    issues.push({
      code: "example_missing",
      message: `The worked example uses ${missingScalar} as one of its inputs; the program must use the same value.`,
    });
  }

  // 2. It must print the answer the board ends on. The print may sit in any
  // section: rejecting a plan that printed from the section above its last
  // one cost the whole lesson over where a line was.
  if (!/\bprint\b|console\.log|System\.out|std::cout/.test(driver) && !/\bprint\b|console\.log|System\.out|std::cout/.test(whole)) {
    issues.push({
      code: "driver_missing",
      message: "The last section must be a short driver that runs the worked example and prints its result.",
    });
  }

  // 3. It must be the technique the figure is walking.
  const titles = [plan.title, ...plan.sections.map((section) => section.title)].join(" | ");
  for (const pattern of context.forbidTitles ?? []) {
    if (pattern.test(titles)) {
      issues.push({
        code: "wrong_technique",
        message: `The board walks ${context.familyTitle}. A section titled "${titles}" names a different technique; use the one being drawn.`,
      });
      break;
    }
  }
  const shape = context.codeShape;
  if (shape) {
    for (const pattern of shape.require ?? []) {
      if (!pattern.test(whole)) {
        issues.push({
          code: "shape_missing",
          message: `${context.familyTitle} works like this: ${context.mechanism} The program is missing the structure that does it.`,
        });
        break;
      }
    }
    for (const pattern of shape.forbid ?? []) {
      if (pattern.test(main)) {
        issues.push({
          code: "shape_forbidden",
          message: `${context.familyTitle} does not sort or index the whole input first. Write the algorithm the board is drawing: ${context.mechanism}`,
        });
        break;
      }
    }
    if (shape.maxLoopsInMain !== undefined && loopCount(main) > shape.maxLoopsInMain) {
      issues.push({
        code: "too_many_passes",
        message: `The board walks a single pass. The main function has ${loopCount(main)} loops; ${context.mechanism}`,
      });
    }
    if (shape.helpers === "none") {
      const defs = algorithmFunctionCount(whole);
      if (defs > 1) {
        issues.push({
          code: "invented_helper",
          message: `This is a one-pass algorithm, and the plan splits it across ${defs} functions with loops in them. Put the whole algorithm in one function and keep any setup or printing separate.`,
        });
      }
    }
  }

  return issues;
}
