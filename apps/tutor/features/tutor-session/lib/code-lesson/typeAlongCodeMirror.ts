/**
 * CodeMirror surface for type-along practice. The document always holds the
 * full section source; these decorations are the only thing that moves:
 * unconfirmed practice characters render as Copilot-style ghost text, locked
 * scaffold lines dim, and a blinking caret sits on the next expected
 * character. Keystrokes never reach the editor — the panel feeds them
 * through the pure state machine and re-dispatches decorations.
 */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  typeAlongCaretOffset,
  typeAlongGhostRanges,
  typeAlongLockedRanges,
  type TypeAlongState,
} from "./typeAlong";

class PracticeCaretWidget extends WidgetType {
  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-typing-caret";
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }

  override eq(): boolean {
    return true;
  }
}

const practiceCaret = new PracticeCaretWidget();
const ghostMark = Decoration.mark({ class: "cm-ghost-text" });
const lockedLine = Decoration.line({ class: "cm-locked-line" });

export const setTypeAlongState = StateEffect.define<TypeAlongState | null>();

const typeAlongField = StateField.define<TypeAlongState | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setTypeAlongState)) return effect.value;
    }
    return value;
  },
});

const typeAlongDecorations = EditorView.decorations.compute(
  [typeAlongField, "doc"],
  (state): DecorationSet => {
    const practice = state.field(typeAlongField);
    if (!practice) return Decoration.none;
    const docLength = state.doc.length;
    const clamp = (value: number) => Math.max(0, Math.min(value, docLength));
    const ranges = [];

    for (const { from, to } of typeAlongLockedRanges(practice)) {
      let position = clamp(from);
      const end = clamp(to);
      while (position < end) {
        const line = state.doc.lineAt(position);
        ranges.push(lockedLine.range(line.from));
        position = line.to + 1;
      }
    }
    if (!practice.complete) {
      ranges.push(
        Decoration.widget({ widget: practiceCaret, side: -1 })
          .range(clamp(typeAlongCaretOffset(practice))),
      );
    }
    for (const { from, to } of typeAlongGhostRanges(practice)) {
      if (clamp(from) < clamp(to)) ranges.push(ghostMark.range(clamp(from), clamp(to)));
    }
    return Decoration.set(ranges, true);
  },
);

const typeAlongTheme = EditorView.theme({
  ".cm-ghost-text": {
    opacity: "0.32",
  },
  ".cm-locked-line": {
    opacity: "0.55",
  },
});

export function typeAlongExtensions(): Extension {
  return [typeAlongField, typeAlongDecorations, typeAlongTheme];
}
