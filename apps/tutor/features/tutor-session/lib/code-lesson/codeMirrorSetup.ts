import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { CodeLessonLanguage } from "@heytutor/tutor-core";
import { DSA_EDITOR_METRICS } from "../../constants";
import {
  SOLARIZED,
  SOLARIZED_EDITOR,
  SOLARIZED_FONT,
  SOLARIZED_TOKEN_COLORS,
} from "./solarizedEditor";

export function codeLessonLanguageExtension(language: CodeLessonLanguage): Extension {
  switch (language) {
    case "python":
      return python();
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "java":
      return java();
    case "cpp":
      return cpp();
  }
}

/**
 * Solarized Dark syntax — the same token colours the canvas renderer paints.
 * Keywords are green, strings cyan, functions blue: the Sublime mapping.
 */
const codeLessonHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: SOLARIZED_TOKEN_COLORS.kw },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: SOLARIZED_TOKEN_COLORS.fn },
  { tag: [tags.typeName, tags.className, tags.namespace], color: SOLARIZED_TOKEN_COLORS.type },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: SOLARIZED_TOKEN_COLORS.num },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: SOLARIZED_TOKEN_COLORS.str },
  { tag: [tags.comment, tags.docComment], color: SOLARIZED_TOKEN_COLORS.cmt, fontStyle: "italic" },
  { tag: [tags.operator, tags.compareOperator, tags.logicOperator], color: SOLARIZED_TOKEN_COLORS.op },
  { tag: [tags.propertyName, tags.attributeName], color: SOLARIZED_TOKEN_COLORS.prop },
  { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], color: SOLARIZED_TOKEN_COLORS.def },
  { tag: [tags.self, tags.special(tags.variableName)], color: SOLARIZED_TOKEN_COLORS.self },
  { tag: [tags.punctuation, tags.bracket], color: SOLARIZED_TOKEN_COLORS.punc },
]);

export const codeLessonTheme: Extension = [
  EditorView.theme(
    {
      "&": {
        backgroundColor: SOLARIZED_EDITOR.background,
        color: SOLARIZED_EDITOR.text,
        fontSize: `${DSA_EDITOR_METRICS.fontSize}px`,
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: SOLARIZED_FONT,
        lineHeight: `${DSA_EDITOR_METRICS.lineHeight}px`,
        overflow: "auto",
        paddingBottom: "8px",
      },
      ".cm-content": {
        caretColor: "transparent",
        padding: `${DSA_EDITOR_METRICS.codeTopPadding}px 0`,
      },
      "&.cm-focused": { outline: "none" },
      ".cm-line": { padding: `0 14px 0 ${DSA_EDITOR_METRICS.codeLeftPadding}px` },
      ".cm-gutters": {
        backgroundColor: SOLARIZED_EDITOR.gutter,
        border: "none",
        borderRight: `1px solid ${SOLARIZED.base03}`,
        color: SOLARIZED_EDITOR.muted,
        paddingLeft: "8px",
        minWidth: `${DSA_EDITOR_METRICS.gutterWidth}px`,
        userSelect: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 0",
        minWidth: `${DSA_EDITOR_METRICS.gutterWidth - 10}px`,
      },
      ".cm-activeLine": { backgroundColor: SOLARIZED_EDITOR.activeLine },
      ".cm-activeLineGutter": {
        backgroundColor: SOLARIZED_EDITOR.activeLine,
        color: SOLARIZED_EDITOR.bright,
      },
      ".cm-matchingBracket": {
        backgroundColor: SOLARIZED_EDITOR.matchingBracket,
        outline: "none",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: SOLARIZED_EDITOR.selection,
      },
      // Thin I-beam, the Sublime/TextMate caret — not a block glyph.
      ".cm-typing-caret": {
        display: "inline-block",
        position: "relative",
        width: "0",
        height: "1.15em",
        verticalAlign: "middle",
        borderLeft: `2px solid ${SOLARIZED_EDITOR.caret}`,
      },
      // Editors hold the caret solid while keys are landing and only blink it
      // once typing stops, so a blinking caret mid-word reads as fake.
      ".cm-typing-caret-idle": {
        animation: "wb-code-caret-blink 1.06s steps(2, start) infinite",
      },
      // Every other animation in this app is gated on prefers-reduced-motion;
      // a blinking caret is exactly the kind of thing that setting is for.
      "@media (prefers-reduced-motion: reduce)": {
        ".cm-typing-caret-idle": { animation: "none", opacity: "0.55" },
      },
      "@keyframes wb-code-caret-blink": {
        "0%": { opacity: "1" },
        "50%": { opacity: "0" },
        "100%": { opacity: "1" },
      },
    },
    { dark: true },
  ),
  syntaxHighlighting(codeLessonHighlight),
];

export type TypingCaretMode = "hidden" | "typing" | "idle";

class TypingCaretWidget extends WidgetType {
  constructor(private readonly idle: boolean) {
    super();
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = this.idle
      ? "cm-typing-caret cm-typing-caret-idle"
      : "cm-typing-caret";
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }

  override eq(other: TypingCaretWidget): boolean {
    return other.idle === this.idle;
  }
}

export const setTypingCaretMode = StateEffect.define<TypingCaretMode>();

const typingCaretField = StateField.define<TypingCaretMode>({
  create: () => "hidden",
  update(mode, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTypingCaretMode)) return effect.value;
    }
    return mode;
  },
});

const typingCaret = new TypingCaretWidget(false);
const idleCaret = new TypingCaretWidget(true);

/** IDE caret pinned to the end of the revealed code. */
const typingCaretDecorations = EditorView.decorations.compute(
  [typingCaretField, "doc"],
  (state): DecorationSet => {
    const mode = state.field(typingCaretField);
    if (mode === "hidden") return Decoration.none;
    const widget = mode === "typing" ? typingCaret : idleCaret;
    return Decoration.set([
      Decoration.widget({ widget, side: 1 }).range(state.doc.length),
    ]);
  },
);

export function typingCaretExtensions(): Extension {
  return [typingCaretField, typingCaretDecorations];
}

export function baseCodeLessonExtensions(language: CodeLessonLanguage): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    bracketMatching(),
    codeLessonLanguageExtension(language),
    codeLessonTheme,
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ spellcheck: "false" }),
    EditorView.lineWrapping,
  ];
}
