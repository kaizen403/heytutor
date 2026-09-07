import { cppLanguage } from "@codemirror/lang-cpp";
import { javaLanguage } from "@codemirror/lang-java";
import { javascriptLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";
import type { CodeLessonLanguage } from "@heytutor/tutor-core";
import {
  SOLARIZED,
  SOLARIZED_CHROME,
  SOLARIZED_DEFAULT_TEXT,
  SOLARIZED_EDITOR,
  SOLARIZED_FONT,
  SOLARIZED_TOKEN_COLORS,
  codeLessonLanguageLabel,
  codeLessonTabLabel,
  codeLessonCaretLineCol,
} from "@/features/tutor-session/lib/code-lesson/solarizedEditor";
import { DSA_EDITOR_METRICS } from "@/features/tutor-session/constants";

/**
 * Deterministic canvas renderer for lesson code. The live panel is DOM
 * CodeMirror, which Konva capture cannot see — notes snapshots and MP4
 * lecture frames composite this renderer instead. It mirrors the panel's
 * Sublime / Solarized Dark chrome and the same Lezer token stream CodeMirror
 * highlights with (see solarizedEditor.ts).
 */

export interface CodeTokenSpan {
  text: string;
  color: string;
}

export type CodeTokenLine = CodeTokenSpan[];

const TOKEN_COLORS: Record<string, string> = { ...SOLARIZED_TOKEN_COLORS };

const DEFAULT_TEXT = SOLARIZED_DEFAULT_TEXT;

/** Mirrors the HighlightStyle in codeMirrorSetup.ts, tag for tag. */
const canvasHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], class: "kw" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "fn" },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "type" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "num" },
  { tag: [tags.string, tags.special(tags.string), tags.character], class: "str" },
  { tag: [tags.comment, tags.docComment], class: "cmt" },
  { tag: [tags.operator, tags.compareOperator, tags.logicOperator], class: "op" },
  { tag: [tags.propertyName, tags.attributeName], class: "prop" },
  { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], class: "def" },
  { tag: [tags.self, tags.special(tags.variableName)], class: "self" },
  { tag: [tags.punctuation, tags.bracket], class: "punc" },
]);

function languageParser(language: CodeLessonLanguage) {
  switch (language) {
    case "python":
      return pythonLanguage.parser;
    case "javascript":
      return javascriptLanguage.parser;
    case "typescript":
      return typescriptLanguage.parser;
    case "java":
      return javaLanguage.parser;
    case "cpp":
      return cppLanguage.parser;
  }
}

/** Tokenize code into per-line colored spans via the Lezer token stream. */
export function tokenizeCodeLines(
  code: string,
  language: CodeLessonLanguage,
): CodeTokenLine[] {
  const lines: CodeTokenLine[] = [[]];
  const tree = languageParser(language).parse(code);
  highlightCode(
    code,
    tree,
    canvasHighlighter,
    (text, classes) => {
      const color = classes
        .split(" ")
        .map((cls) => TOKEN_COLORS[cls])
        .find((value) => value !== undefined) ?? DEFAULT_TEXT;
      // highlightCode does not split runs on newlines for unstyled stretches.
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part !== "") lines[lines.length - 1]!.push({ text: part, color });
      });
    },
    () => {
      lines.push([]);
    },
  );
  return lines;
}

export const CODE_RENDER_METRICS = {
  fontSize: DSA_EDITOR_METRICS.fontSize,
  lineHeight: DSA_EDITOR_METRICS.lineHeight,
  fontFamily: SOLARIZED_FONT,
  gutterWidth: DSA_EDITOR_METRICS.gutterWidth,
  codeLeftPadding: DSA_EDITOR_METRICS.codeLeftPadding,
  codeTopPadding: DSA_EDITOR_METRICS.codeTopPadding,
  sectionBarHeight: SOLARIZED_CHROME.titleBarHeight,
  statusBarHeight: SOLARIZED_CHROME.statusBarHeight,
} as const;

export interface CodePanelChrome {
  /** Window title, e.g. the plan title. */
  title: string;
  language: CodeLessonLanguage;
  sectionTitle: string;
  sectionIndex: number;
  sectionCount: number;
}

export interface CodePanelFrameSpec {
  chrome: CodePanelChrome;
  /** Full code of the active section. */
  code: string;
  /** Characters of `code` currently revealed. */
  revealedChars: number;
  /** Draw the typing caret after the last revealed character. */
  showCaret: boolean;
  /** Drives the deterministic caret blink; frame time works well. */
  caretClockMs?: number;
}

export function codePanelChromeHeight(): number {
  return CODE_RENDER_METRICS.sectionBarHeight;
}

/** Panel height that fits every line of `code` without scrolling. */
export function codePanelContentHeight(code: string): number {
  const lineCount = code === "" ? 1 : code.split("\n").length;
  return (
    codePanelChromeHeight() +
    CODE_RENDER_METRICS.statusBarHeight +
    CODE_RENDER_METRICS.codeTopPadding * 2 +
    lineCount * CODE_RENDER_METRICS.lineHeight
  );
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawTrafficLights(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const size = SOLARIZED_CHROME.trafficLightSize;
  const gap = SOLARIZED_CHROME.trafficLightGap;
  const colors = [
    SOLARIZED_EDITOR.trafficClose,
    SOLARIZED_EDITOR.trafficMin,
    SOLARIZED_EDITOR.trafficMax,
  ];
  colors.forEach((color, index) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x + index * (size + gap) + size / 2, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawChrome(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  chrome: CodePanelChrome,
  caret: { line: number; column: number },
): void {
  const { sectionBarHeight, statusBarHeight } = CODE_RENDER_METRICS;
  const uiFont = "ui-sans-serif, system-ui, sans-serif";
  const barCenterY = rect.y + sectionBarHeight / 2;
  const lightX = rect.x + 12;
  const lightSpan =
    3 * SOLARIZED_CHROME.trafficLightSize + 2 * SOLARIZED_CHROME.trafficLightGap;

  ctx.fillStyle = SOLARIZED_EDITOR.titleBar;
  ctx.fillRect(rect.x, rect.y, rect.width, sectionBarHeight);
  drawTrafficLights(ctx, lightX, barCenterY);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `500 11px ${SOLARIZED_FONT}`;
  ctx.fillStyle = SOLARIZED_EDITOR.bright;
  const tab = codeLessonTabLabel(chrome.sectionTitle, chrome.language);
  ctx.fillText(tab, lightX + lightSpan + 12, barCenterY, rect.width - lightSpan - 72);

  ctx.font = `500 10px ${uiFont}`;
  ctx.fillStyle = SOLARIZED_EDITOR.muted;
  ctx.textAlign = "right";
  ctx.fillText(
    `${chrome.sectionIndex + 1}/${chrome.sectionCount}`,
    rect.x + rect.width - 12,
    barCenterY,
  );

  ctx.strokeStyle = SOLARIZED.base02;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y + sectionBarHeight);
  ctx.lineTo(rect.x + rect.width, rect.y + sectionBarHeight);
  ctx.stroke();

  const statusY = rect.y + rect.height - statusBarHeight;
  ctx.fillStyle = SOLARIZED_EDITOR.statusBar;
  ctx.fillRect(rect.x, statusY, rect.width, statusBarHeight);
  ctx.beginPath();
  ctx.moveTo(rect.x, statusY);
  ctx.lineTo(rect.x + rect.width, statusY);
  ctx.stroke();

  const statusCenter = statusY + statusBarHeight / 2;
  ctx.textAlign = "left";
  ctx.font = `500 10px ${uiFont}`;
  ctx.fillStyle = SOLARIZED_EDITOR.bright;
  ctx.fillText(codeLessonLanguageLabel(chrome.language), rect.x + 12, statusCenter);
  ctx.textAlign = "right";
  ctx.fillStyle = SOLARIZED_EDITOR.muted;
  ctx.fillText(
    `UTF-8  ·  Ln ${caret.line}, Col ${caret.column}`,
    rect.x + rect.width - 12,
    statusCenter,
  );
}

/**
 * Draw the code panel into `rect` on any 2D context in board coordinates.
 * When the revealed code outgrows the rect, the view scrolls so the caret
 * line stays visible — the same follow-typing behaviour as the live panel.
 */
export function renderCodePanelFrame(
  ctx: CanvasRenderingContext2D,
  spec: CodePanelFrameSpec,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const metrics = CODE_RENDER_METRICS;
  ctx.save();
  drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fillStyle = SOLARIZED_EDITOR.background;
  ctx.fill();
  ctx.strokeStyle = SOLARIZED_EDITOR.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.clip();

  const lines = tokenizeCodeLines(spec.code, spec.chrome.language);
  const revealed = Math.max(0, Math.min(spec.revealedChars, spec.code.length));
  const revealedText = spec.code.slice(0, revealed);
  const caretPos = codeLessonCaretLineCol(revealedText);
  const caretLine = caretPos.line - 1;
  const caretColumn = caretPos.column - 1;

  drawChrome(ctx, rect, spec.chrome, caretPos);

  const codeTop = rect.y + codePanelChromeHeight() + metrics.codeTopPadding;
  const codeViewHeight =
    rect.height -
    codePanelChromeHeight() -
    metrics.statusBarHeight -
    metrics.codeTopPadding * 2;
  const caretBottom = (caretLine + 1) * metrics.lineHeight;
  const scrollY = Math.max(0, caretBottom - codeViewHeight);

  ctx.fillStyle = SOLARIZED_EDITOR.gutter;
  ctx.fillRect(
    rect.x,
    rect.y + codePanelChromeHeight(),
    metrics.gutterWidth,
    rect.height - codePanelChromeHeight() - metrics.statusBarHeight,
  );

  ctx.beginPath();
  ctx.rect(
    rect.x,
    rect.y + codePanelChromeHeight(),
    rect.width,
    rect.height - codePanelChromeHeight() - metrics.statusBarHeight,
  );
  ctx.clip();

  ctx.font = `${metrics.fontSize}px ${metrics.fontFamily}`;
  ctx.textBaseline = "middle";

  let charsBefore = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const lineText = line.map((span) => span.text).join("");
    const lineStart = charsBefore;
    charsBefore += lineText.length + 1;

    const y = codeTop + lineIndex * metrics.lineHeight + metrics.lineHeight / 2 - scrollY;
    if (y < rect.y + codePanelChromeHeight() - metrics.lineHeight) continue;
    if (y > rect.y + rect.height + metrics.lineHeight) break;
    if (lineStart > revealed) break;

    if (lineIndex === caretLine) {
      ctx.fillStyle = SOLARIZED_EDITOR.activeLine;
      ctx.fillRect(
        rect.x + metrics.gutterWidth,
        y - metrics.lineHeight / 2,
        rect.width - metrics.gutterWidth,
        metrics.lineHeight,
      );
    }

    const revealedInLine = Math.max(0, Math.min(revealed - lineStart, lineText.length));
    if (revealedInLine === 0 && !(spec.showCaret && lineIndex === caretLine)) {
      if (lineStart + lineText.length >= revealed && lineIndex > caretLine) break;
      continue;
    }

    ctx.textAlign = "right";
    ctx.fillStyle =
      spec.showCaret && lineIndex === caretLine
        ? SOLARIZED_EDITOR.bright
        : SOLARIZED_EDITOR.muted;
    ctx.fillText(String(lineIndex + 1), rect.x + metrics.gutterWidth - 6, y);

    ctx.textAlign = "left";
    let x = rect.x + metrics.gutterWidth + metrics.codeLeftPadding;
    let drawn = 0;
    for (const span of line) {
      if (drawn >= revealedInLine) break;
      const visible = span.text.slice(0, revealedInLine - drawn);
      ctx.fillStyle = span.color;
      ctx.fillText(visible, x, y);
      x += ctx.measureText(visible).width;
      drawn += visible.length;
    }

    if (spec.showCaret && lineIndex === caretLine) {
      const blinkOn = Math.floor((spec.caretClockMs ?? 0) / 500) % 2 === 0;
      if (blinkOn && caretColumn === revealedInLine) {
        ctx.fillStyle = SOLARIZED_EDITOR.caret;
        ctx.fillRect(x + 1, y - metrics.fontSize * 0.55, 2, metrics.fontSize * 1.15);
      }
    }
  }

  ctx.restore();
}
