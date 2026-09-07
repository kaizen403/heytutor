/**
 * Solarized Dark for the DSA code panel.
 *
 * The panel is a Sublime-like editor sitting on the whiteboard, not another
 * Night Blueprint card. Ethan Schoonover's palette is the one Sublime shipped
 * with for years; live CodeMirror, notes PDFs, and lecture MP4s all read
 * these values so the three surfaces cannot drift.
 *
 * https://ethanschoonover.com/solarized/
 */
import type { CodeLessonLanguage } from "@heytutor/tutor-core";

export const SOLARIZED = {
  base03: "#002b36",
  base02: "#073642",
  base01: "#586e75",
  base00: "#657b83",
  base0: "#839496",
  base1: "#93a1a1",
  base2: "#eee8d5",
  base3: "#fdf6e3",
  yellow: "#b58900",
  orange: "#cb4b16",
  red: "#dc322f",
  magenta: "#d33682",
  violet: "#6c71c4",
  blue: "#268bd2",
  cyan: "#2aa198",
  green: "#859900",
} as const;

export const SOLARIZED_EDITOR = {
  background: SOLARIZED.base03,
  gutter: SOLARIZED.base02,
  titleBar: "#001e26",
  statusBar: SOLARIZED.base02,
  text: SOLARIZED.base0,
  muted: SOLARIZED.base01,
  bright: SOLARIZED.base1,
  caret: SOLARIZED.base1,
  selection: "rgba(7, 54, 66, 0.92)",
  activeLine: SOLARIZED.base02,
  matchingBracket: "rgba(42, 161, 152, 0.35)",
  border: "#00141c",
  tab: SOLARIZED.base03,
  trafficClose: "#ff5f56",
  trafficMin: "#ffbd2e",
  trafficMax: "#27c93f",
} as const;

/** Lezer token classes shared by CodeMirror HighlightStyle and the canvas renderer. */
export const SOLARIZED_TOKEN_COLORS = {
  kw: SOLARIZED.green,
  fn: SOLARIZED.blue,
  type: SOLARIZED.yellow,
  num: SOLARIZED.magenta,
  str: SOLARIZED.cyan,
  cmt: SOLARIZED.base01,
  op: SOLARIZED.yellow,
  prop: SOLARIZED.base0,
  def: SOLARIZED.base0,
  self: SOLARIZED.orange,
  punc: SOLARIZED.base01,
} as const;

export const SOLARIZED_DEFAULT_TEXT = SOLARIZED.base0;

export const SOLARIZED_FONT =
  "'Menlo', 'Consolas', 'Source Code Pro', 'SF Mono', ui-monospace, monospace";

export const SOLARIZED_CHROME = {
  titleBarHeight: 32,
  statusBarHeight: 22,
  trafficLightSize: 10,
  trafficLightGap: 7,
} as const;

const LANGUAGE_META: Record<
  CodeLessonLanguage,
  { extension: string; label: string }
> = {
  python: { extension: ".py", label: "Python" },
  javascript: { extension: ".js", label: "JavaScript" },
  typescript: { extension: ".ts", label: "TypeScript" },
  java: { extension: ".java", label: "Java" },
  cpp: { extension: ".cpp", label: "C++" },
};

export function codeLessonLanguageLabel(language: CodeLessonLanguage): string {
  return LANGUAGE_META[language].label;
}

export function codeLessonFileExtension(language: CodeLessonLanguage): string {
  return LANGUAGE_META[language].extension;
}

/** Sublime-style tab title: the section name with the language's file suffix. */
export function codeLessonTabLabel(
  sectionTitle: string,
  language: CodeLessonLanguage,
): string {
  const title = sectionTitle.trim() || "untitled";
  return `${title}${codeLessonFileExtension(language)}`;
}

export function codeLessonCaretLineCol(text: string): { line: number; column: number } {
  if (text.length === 0) {
    return { line: 1, column: 1 };
  }
  const lines = text.split("\n");
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
}
