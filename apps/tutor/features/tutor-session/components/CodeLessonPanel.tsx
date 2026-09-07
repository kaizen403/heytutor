"use client";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronDown, ChevronUp, Keyboard } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { DSA_CODE_PANEL_RECT } from "../constants";
import {
  fullSectionText,
  revealedSectionText,
  sectionFullyRevealed,
  type CodeLessonController,
} from "../lib/code-lesson/codeLessonController";
import {
  baseCodeLessonExtensions,
  setTypingCaretMode,
  typingCaretExtensions,
  type TypingCaretMode,
} from "../lib/code-lesson/codeMirrorSetup";
import {
  setTypeAlongState,
  typeAlongExtensions,
} from "../lib/code-lesson/typeAlongCodeMirror";
import { typeAlongProgress } from "../lib/code-lesson/typeAlong";
import {
  SOLARIZED,
  SOLARIZED_CHROME,
  SOLARIZED_EDITOR,
  SOLARIZED_FONT,
  codeLessonCaretLineCol,
  codeLessonLanguageLabel,
  codeLessonTabLabel,
} from "../lib/code-lesson/solarizedEditor";

export interface CodeLessonPanelProps {
  controller: CodeLessonController;
}

/**
 * Sublime-like Solarized Dark editor for DSA turns: a DOM overlay in board
 * coordinates over the left column. The controller owns all lesson state;
 * this component only paints it — the CodeMirror doc mirrors the revealed
 * characters and scrolls to follow the caret while the tutor types.
 */
/**
 * Where the panel is mounted.
 *
 * "board" sits inside the whiteboard's CSS transform at board coordinates.
 * That transform is `containerWidth / 1200`, so on a 390px phone the scale is
 * about 0.29 and a 576-board-pixel panel renders at ~168 CSS pixels with 4px
 * code — unreadable, and unfixable from inside the transform because a media
 * query there sees the real viewport while an ancestor shrinks the element.
 *
 * "below" mounts outside the transform, under the board, at natural scale.
 */
export type CodeLessonPanelVariant = "board" | "below";

export function CodeLessonPanel({
  controller,
  variant = "board",
}: CodeLessonPanelProps & { variant?: CodeLessonPanelVariant }) {
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );

  const hostRef = useRef<HTMLDivElement | null>(null);
  const keyCaptureRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastDocRef = useRef("");

  const { plan, mode, activeSectionIndex, typingBlockId, typeAlong } = state;
  const visible = Boolean(plan) && mode !== "hidden";
  const section = plan?.sections[activeSectionIndex] ?? null;
  const sectionCount = plan?.sections.length ?? 0;
  const planKey = plan ? `${plan.language}:${plan.title}:${plan.question}` : null;

  const displayText = useMemo(() => {
    if (!plan) return "";
    // Practice needs the finished source for ghost text. Lesson and the
    // just-finished complete state both show only what has been typed, so a
    // missed [TYPE] cannot dump a whole section in one frame.
    return mode === "type_along"
      ? fullSectionText(state, activeSectionIndex)
      : revealedSectionText(state, activeSectionIndex);
  }, [plan, mode, state, activeSectionIndex]);

  // One editor per committed plan; language and theme are fixed at creation.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !plan || !visible) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          ...baseCodeLessonExtensions(plan.language),
          typingCaretExtensions(),
          typeAlongExtensions(),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    lastDocRef.current = "";
    return () => {
      view.destroy();
      viewRef.current = null;
      lastDocRef.current = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, visible]);

  // Mirror revealed text into the editor. Typing only appends, so most
  // updates are a tail insert; section switches replace the whole doc.
  // Practice mode owns its own caret, so the lesson caret stands down.
  const caretMode: TypingCaretMode =
    mode === "type_along" || displayText.length === 0
      ? "hidden"
      : typingBlockId !== null
        ? "typing"
        : "idle";

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const previous = lastDocRef.current;
    if (displayText !== previous) {
      const changes = displayText.startsWith(previous)
        ? { from: previous.length, insert: displayText.slice(previous.length) }
        : { from: 0, to: previous.length, insert: displayText };
      view.dispatch({
        changes,
        effects: [
          setTypingCaretMode.of(caretMode),
          EditorView.scrollIntoView(displayText.length, { y: "end" }),
        ],
      });
      lastDocRef.current = displayText;
    } else {
      view.dispatch({ effects: setTypingCaretMode.of(caretMode) });
    }
  }, [displayText, caretMode]);

  // Mirror the practice machine into ghost/caret/locked decorations, and
  // keep the caret in view as it advances.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const practice = mode === "type_along" ? typeAlong : null;
    view.dispatch({ effects: setTypeAlongState.of(practice) });
    if (practice && !practice.complete) {
      let caretOffset = 0;
      for (let index = 0; index < practice.lineIndex; index += 1) {
        caretOffset += practice.lines[index]!.text.length + 1;
      }
      caretOffset += practice.lines[practice.lineIndex]?.confirmed ?? 0;
      view.dispatch({
        effects: EditorView.scrollIntoView(
          Math.min(caretOffset, view.state.doc.length),
          { y: "nearest" },
        ),
      });
    }
  }, [mode, typeAlong]);

  // Practice keys go to the capture surface, never into the editor.
  useEffect(() => {
    if (mode === "type_along") keyCaptureRef.current?.focus();
  }, [mode, activeSectionIndex]);

  // Wrong keys flash the panel border briefly. The flash is pure DOM styling
  // (no React state): setting the properties overrides the inline shorthand,
  // and clearing them falls back to it.
  const rejectFlash = typeAlong?.rejectFlash ?? 0;
  useEffect(() => {
    const panel = panelRef.current;
    if (rejectFlash === 0 || !panel) return;
    panel.style.borderColor = SOLARIZED.red;
    panel.style.boxShadow =
      `0 0 0 2px rgba(220, 50, 47, 0.35), 0 18px 40px -12px rgba(0, 20, 28, 0.65)`;
    const timeout = setTimeout(() => {
      panel.style.borderColor = "";
      panel.style.boxShadow = "";
    }, 220);
    return () => clearTimeout(timeout);
  }, [rejectFlash]);

  if (!plan || !visible || !section) return null;

  const sectionDone = sectionFullyRevealed(state, activeSectionIndex);
  const canNavigate = mode !== "lesson" || sectionDone;
  const hasNext = activeSectionIndex < sectionCount - 1;
  const hasPrev = activeSectionIndex > 0;
  const practicing = mode === "type_along";
  const practiceProgress = practicing && typeAlong ? typeAlongProgress(typeAlong) : null;
  const practiceComplete = practicing && (typeAlong?.complete ?? true);
  const practiceHasTargets = (practiceProgress?.totalChars ?? 0) > 0;
  const tabLabel = codeLessonTabLabel(section.title, plan.language);
  const languageLabel = codeLessonLanguageLabel(plan.language);
  const caretPos = codeLessonCaretLineCol(
    mode === "type_along" ? fullSectionText(state, activeSectionIndex) : displayText,
  );

  const handlePracticeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!practicing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Tab") {
      event.preventDefault();
      controller.typeAlongInput({ kind: "tab" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      controller.typeAlongInput({ kind: "enter" });
    } else if (event.key === "Escape") {
      event.preventDefault();
      controller.exitTypeAlong();
    } else if (event.key.length === 1) {
      event.preventDefault();
      controller.typeAlongInput({ kind: "char", char: event.key });
    }
  };

  return (
    <div
        ref={panelRef}
        data-testid="code-lesson-panel"
        data-editor-theme="solarized-dark"
        style={{
          ...(variant === "board"
            ? {
                position: "absolute" as const,
                left: DSA_CODE_PANEL_RECT.x,
                top: DSA_CODE_PANEL_RECT.y,
                width: DSA_CODE_PANEL_RECT.width,
                height: DSA_CODE_PANEL_RECT.height,
              }
            : {
                position: "relative" as const,
                width: "100%",
                // A fixed, viewport-relative height: the slot sits inside the
                // element useBoardViewport measures, so a content-derived
                // height would feed back into the board's own scale and
                // oscillate. Same space whether the panel is empty or full.
                height: "min(42vh, 340px)",
                marginTop: 12,
              }),
          display: "flex",
          flexDirection: "column",
          backgroundColor: SOLARIZED_EDITOR.background,
          border: `1px solid ${SOLARIZED_EDITOR.border}`,
          borderRadius: 8,
          boxShadow: "0 18px 44px -14px rgba(0, 20, 28, 0.72)",
          transition: "border-color 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          zIndex: 4,
          fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: SOLARIZED_CHROME.titleBarHeight,
            padding: "0 12px",
            borderBottom: `1px solid ${SOLARIZED.base02}`,
            flexShrink: 0,
            backgroundColor: SOLARIZED_EDITOR.titleBar,
            userSelect: "none",
          }}
        >
          <TrafficLights />
          <span
            title={tabLabel}
            style={{
              color: SOLARIZED_EDITOR.bright,
              fontFamily: SOLARIZED_FONT,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {tabLabel}
          </span>
          <span style={{ color: SOLARIZED_EDITOR.muted, fontSize: 10, flexShrink: 0 }}>
            {activeSectionIndex + 1}/{sectionCount}
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
          {practicing ? (
            <>
              <span style={{ color: SOLARIZED.cyan, fontSize: 10, fontWeight: 700 }}>
                {practiceComplete
                  ? "practiced"
                  : practiceProgress
                    ? `${practiceProgress.typedChars}/${practiceProgress.totalChars}`
                    : ""}
              </span>
              <button
                type="button"
                onClick={() => controller.exitTypeAlong()}
                style={{
                  border: `1px solid ${SOLARIZED.base01}`,
                  borderRadius: 999,
                  backgroundColor: "transparent",
                  color: SOLARIZED_EDITOR.muted,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  cursor: "pointer",
                }}
              >
                Exit
              </button>
            </>
          ) : null}
          {canNavigate && (hasPrev || hasNext) ? (
            <>
              <SectionNavButton
                label="Previous section"
                glyph="up"
                disabled={!hasPrev}
                onClick={() => controller.setActiveSection(activeSectionIndex - 1)}
              />
              <SectionNavButton
                label="Next section"
                glyph="down"
                disabled={!hasNext}
                onClick={() => controller.setActiveSection(activeSectionIndex + 1)}
              />
            </>
          ) : null}
          </span>
        </div>

        <div
          ref={keyCaptureRef}
          tabIndex={practicing ? 0 : -1}
          onKeyDown={handlePracticeKey}
          onMouseDown={(event) => {
            if (!practicing) return;
            event.preventDefault();
            keyCaptureRef.current?.focus();
          }}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            outline: "none",
          }}
          aria-label={
            practicing ? `Practice typing ${section.title}` : `Code for ${section.title}`
          }
        >
          <div ref={hostRef} style={{ height: "100%", cursor: "text" }} />

          {mode === "complete" && sectionDone ? (
            <button
              type="button"
              onClick={() => controller.startTypeAlong()}
              style={{
                position: "absolute",
                left: "50%",
                bottom: 14,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                border: `1px solid ${SOLARIZED.cyan}55`,
                borderRadius: 999,
                backgroundColor: SOLARIZED_EDITOR.titleBar,
                color: SOLARIZED.base2,
                fontSize: 12,
                fontWeight: 600,
                padding: "8px 16px",
                cursor: "pointer",
                boxShadow: "0 8px 22px -6px rgba(3, 11, 18, 0.6)",
              }}
            >
              <Keyboard size={14} aria-hidden="true" />
              Type along
            </button>
          ) : null}

          {practicing && practiceComplete ? (
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: 14,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: `1px solid ${SOLARIZED.green}55`,
                borderRadius: 999,
                backgroundColor: SOLARIZED_EDITOR.titleBar,
                color: SOLARIZED.green,
                fontSize: 12,
                fontWeight: 600,
                padding: "8px 16px",
                boxShadow: "0 8px 22px -6px rgba(3, 11, 18, 0.6)",
                pointerEvents: "none",
              }}
            >
              {practiceHasTargets
                ? hasNext ? "Section practiced — ↓ for the next one" : "All sections practiced"
                : "Nothing to practice here — use ↓ / ↑"}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: SOLARIZED_CHROME.statusBarHeight,
            padding: "0 12px",
            borderTop: `1px solid ${SOLARIZED.base03}`,
            backgroundColor: SOLARIZED_EDITOR.statusBar,
            flexShrink: 0,
            userSelect: "none",
            fontSize: 10,
          }}
        >
          <span style={{ color: SOLARIZED_EDITOR.bright, fontWeight: 600 }}>
            {languageLabel}
          </span>
          <span style={{ marginLeft: "auto", color: SOLARIZED_EDITOR.muted }}>
            UTF-8  ·  Ln {caretPos.line}, Col {caretPos.column}
          </span>
        </div>

    </div>
  );
}

function TrafficLights() {
  const size = SOLARIZED_CHROME.trafficLightSize;
  const gap = SOLARIZED_CHROME.trafficLightGap;
  const colors = [
    SOLARIZED_EDITOR.trafficClose,
    SOLARIZED_EDITOR.trafficMin,
    SOLARIZED_EDITOR.trafficMax,
  ] as const;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        flexShrink: 0,
      }}
    >
      {colors.map((color) => (
        <span
          key={color}
          style={{
            width: size,
            height: size,
            borderRadius: 999,
            backgroundColor: color,
            boxShadow: "inset 0 0 0 0.5px rgba(0, 0, 0, 0.18)",
          }}
        />
      ))}
    </span>
  );
}

function SectionNavButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="wb-code-navi"
      style={{
        width: 22,
        height: 22,
        // 999 and 12 are the only radii this app uses on controls.
        borderRadius: 999,
        border: `1px solid ${SOLARIZED.base01}`,
        backgroundColor: disabled ? "transparent" : "rgba(131, 148, 150, 0.08)",
        color: disabled ? SOLARIZED.base01 : SOLARIZED_EDITOR.bright,
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background-color 200ms ease, border-color 200ms ease, color 200ms ease",
      }}
    >
      {glyph === "up" ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  );
}
