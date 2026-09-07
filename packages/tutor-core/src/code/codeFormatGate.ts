import {
  MAX_CODE_LINE_CHARS,
  codeLessonIndentUnit,
  codeLessonSectionCode,
  type CodeLessonIssue,
  type CodeLessonLanguage,
  type CodeLessonPlan,
} from "./codeLessonPlan";

export interface CodeSyntaxCheckResult {
  ok: boolean;
  message?: string;
  /** Canonical formatting of the checked code, when the checker produces one. */
  formatted?: string;
}

export type CodeSyntaxChecker = (
  code: string,
  language: CodeLessonLanguage,
) => Promise<CodeSyntaxCheckResult>;

/**
 * Deterministic code-quality gate. A plan that fails here is never rendered;
 * the planner gets one repair attempt with these issues as feedback.
 */
export function codeFormatGateIssues(plan: CodeLessonPlan): CodeLessonIssue[] {
  const issues: CodeLessonIssue[] = [];
  const indentUnit = codeLessonIndentUnit(plan.language);
  for (const section of plan.sections) {
    const sectionCode = codeLessonSectionCode(section);
    const lines = sectionCode.split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      const where = `section "${section.id}" line ${lineIndex + 1}`;
      if (line.includes("\t")) {
        issues.push({ code: "tab_indent", message: `${where} uses a tab; indent with spaces.` });
      }
      if (line.length > MAX_CODE_LINE_CHARS) {
        issues.push({
          code: "line_too_wide",
          message: `${where} is ${line.length} chars; the maximum is ${MAX_CODE_LINE_CHARS}.`,
        });
      }
      if (/[ \u00a0]$/.test(line)) {
        issues.push({ code: "trailing_whitespace", message: `${where} has trailing whitespace.` });
      }
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (line.trim() !== "" && indent % indentUnit !== 0) {
        issues.push({
          code: "indent_step",
          message: `${where} indents ${indent} spaces; use multiples of ${indentUnit} for ${plan.language}.`,
        });
      }
    }
    const balance = scanDelimiterBalance(sectionCode, plan.language);
    if (balance) {
      issues.push({
        code: "unbalanced_delimiters",
        message: `Section "${section.id}" is not a self-contained unit: ${balance}.`,
      });
    }
  }
  return issues;
}

/** Run the optional per-language syntax checker over every section. */
export async function codeSyntaxIssues(
  plan: CodeLessonPlan,
  syntaxCheck: CodeSyntaxChecker | undefined,
): Promise<CodeLessonIssue[]> {
  if (!syntaxCheck) return [];
  const issues: CodeLessonIssue[] = [];
  for (const section of plan.sections) {
    try {
      const result = await syntaxCheck(codeLessonSectionCode(section), plan.language);
      if (!result.ok) {
        issues.push({
          code: "syntax",
          message: `Section "${section.id}" does not parse: ${result.message ?? "syntax error"}.`,
        });
      }
    } catch {
      // A broken checker must not reject an otherwise valid plan.
    }
  }
  return issues;
}

/**
 * Reports the first unbalanced bracket across a section, skipping string
 * literals and comments for the plan's language. Returns null when balanced.
 */
function scanDelimiterBalance(code: string, language: CodeLessonLanguage): string | null {
  const openers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: Array<{ char: string; line: number }> = [];
  const cLike = language !== "python";
  let mode: "code" | "line_comment" | "block_comment" | "string" = "code";
  let stringQuote = "";
  let tripleQuote = false;
  let line = 1;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    const next = code[index + 1] ?? "";
    if (char === "\n") {
      line += 1;
      if (mode === "line_comment") mode = "code";
      if (mode === "string" && !tripleQuote && stringQuote !== "`") mode = "code";
      continue;
    }
    if (mode === "line_comment") continue;
    if (mode === "block_comment") {
      if (char === "*" && next === "/") { mode = "code"; index += 1; }
      continue;
    }
    if (mode === "string") {
      if (char === "\\") { index += 1; continue; }
      if (tripleQuote) {
        if (char === stringQuote && next === stringQuote && code[index + 2] === stringQuote) {
          mode = "code";
          tripleQuote = false;
          index += 2;
        }
      } else if (char === stringQuote) {
        mode = "code";
      }
      continue;
    }
    if (!cLike && char === "#") { mode = "line_comment"; continue; }
    if (cLike && char === "/" && next === "/") { mode = "line_comment"; index += 1; continue; }
    if (cLike && char === "/" && next === "*") { mode = "block_comment"; index += 1; continue; }
    if (char === '"' || char === "'" || (cLike && char === "`")) {
      mode = "string";
      stringQuote = char;
      tripleQuote = !cLike && next === char && code[index + 2] === char;
      if (tripleQuote) index += 2;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ char, line });
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      const top = stack.pop();
      if (!top || top.char !== openers[char]) {
        return `unexpected "${char}" on line ${line}`;
      }
    }
  }
  const unclosed = stack[stack.length - 1];
  return unclosed ? `"${unclosed.char}" opened on line ${unclosed.line} never closes` : null;
}
