import Konva from "konva";
import { BOARD_TYPE_SCALE, MAX_BOARD_FONT_SIZE, MIN_BOARD_FONT_SIZE, snapToBoardTypeScale, textToStrokePathsSync } from "@heytutor/drawing";
import { instrumentInkStyle } from "@heytutor/whiteboard";
import type { ReplayCue } from "./replayTimeline";
import type { BoardLayoutState } from "@/features/tutor-session/types";
import { DIAGRAM_ZONE, TEXT_LAYOUT, WORK_ROW_FONT_SIZE } from "@/features/tutor-session/constants";
import {
  estimateBoardTextWidthAtSize,
  isInDiagramZone,
  textRectsOverlap,
  recordedWorkWriteNeedsPageTurn,
} from "@/features/tutor-session/lib/board/boardLayout";

/** A recorded work frame, never an inferred answer or generated summary. */
export interface LectureWorkPage {
  index: number;
  startMs: number;
  endMs: number;
  endCueIndex: number;
  endCommandCount: number;
}

/**
 * Use the replay layout's own overlap rule to find stored work-page erases.
 * `pageTurnByTurn` (`storedPageTurnAt`): a doubt's fresh page ends the work
 * page and starts a blank one; the lesson's resume ends the doubt page and
 * puts the lesson page's layout back, as the board does.
 */
export function recordedLectureWorkPages(
  cues: readonly ReplayCue[],
  pageStartTurnIndex: readonly number[],
  installedDiagramByTurn: ReadonlyMap<number, boolean> = new Map(),
  pageTurnByTurn: ReadonlyMap<number, "hold" | "return"> = new Map(),
): LectureWorkPage[] {
  const pages: LectureWorkPage[] = [];
  let layout: BoardLayoutState = { rects: [], nextY: TEXT_LAYOUT.topY };
  // Only ERASE timelines need node visibility. Ordinary discovery keeps its
  // existing cheap row-only path. Layout anchors and actual stroke nodes have
  // different erasure semantics: one partial stroke can survive a forgotten row.
  const tracksVisibility = cues.some((cue) => cue.commands.some((command) => command.type === "ERASE"));
  let visibleWorkBounds: Array<InkBounds> = [];
  let fbdStarted = false;
  let openingTurn = -1;
  let startMs = 0;
  let hasWork = false;
  let previous = { endMs: 0, endCueIndex: 0, endCommandCount: 0 };
  let currentTurn = -1;
  // The lesson page a doubt's fresh page holds (one level).
  let held: { layout: BoardLayoutState; visibleWorkBounds: InkBounds[]; fbdStarted: boolean; hasWork: boolean } | null = null;
  const finish = () => {
    if (hasWork) pages.push({ index: pages.length, startMs, ...previous });
    hasWork = false;
    visibleWorkBounds = [];
  };
  cues.forEach((cue, cueIndex) => {
    const opening = pageStartTurnIndex[cue.turnIndex] ?? cue.turnIndex;
    if (opening !== openingTurn) {
      finish();
      layout = { rects: [], nextY: TEXT_LAYOUT.topY };
      fbdStarted = installedDiagramByTurn.get(cue.turnIndex) === true;
      openingTurn = opening;
      startMs = cue.startMs;
      held = null;
    } else if (cue.turnIndex !== currentTurn) {
      const pageTurn = pageTurnByTurn.get(cue.turnIndex);
      if (pageTurn === "hold") {
        held ??= { layout, visibleWorkBounds, fbdStarted, hasWork };
        finish();
        layout = { rects: [], nextY: TEXT_LAYOUT.topY };
        fbdStarted = installedDiagramByTurn.get(cue.turnIndex) === true;
        startMs = cue.startMs;
      } else if (pageTurn === "return" && held) {
        finish();
        ({ layout, visibleWorkBounds, fbdStarted, hasWork } = held);
        held = null;
        startMs = cue.startMs;
      }
    }
    currentTurn = cue.turnIndex;
    cue.commands.forEach((command, commandIndex) => {
      const installedDiagram = installedDiagramByTurn.get(cue.turnIndex) === true;
      if (cue.trustedDiagramGeometry && !fbdStarted && trustedCommandStartsDiagram(command))
        fbdStarted = true;
      if (command.type === "ERASE" && !(installedDiagram && !cue.trustedDiagramGeometry)) {
        const [x, y, rawWidth, height] = command.params;
        if ([x, y, rawWidth, height].every(Number.isFinite)) {
          let width = rawWidth!;
          // Same effective work-region clip as the actual executor.
          if (fbdStarted && x! < DIAGRAM_ZONE.x && x! + width > DIAGRAM_ZONE.x &&
              y! < DIAGRAM_ZONE.y + DIAGRAM_ZONE.height && y! + height! > DIAGRAM_ZONE.y)
            width = Math.max(DIAGRAM_ZONE.x - x! - 10, 40);
          const erased = { x: x!, y: y!, width, height: height! };
          layout.rects = layout.rects.filter((row) => !textRectsOverlap(row, erased, 0));
          visibleWorkBounds = visibleWorkBounds.filter((ink) => ink.exact
            ? !textRectsOverlap(ink, erased, 0)
            : !fullyCovers(erased, ink));
          hasWork = visibleWorkBounds.length > 0;
        }
      } else if (command.type === "CLEAR") {
        finish();
        layout = { rects: [], nextY: TEXT_LAYOUT.topY };
        startMs = cue.startMs;
      } else if (
        command.type === "WRITE" &&
        command.text &&
        Number.isFinite(command.params[0]) &&
        Number.isFinite(command.params[1])
      ) {
        const requested = command.params[2];
        const fontSize = Number.isFinite(requested) && requested! > 0
          ? snapToBoardTypeScale(requested!) : WORK_ROW_FONT_SIZE;
        const rect = {
          x: command.params[0]!,
          y: command.params[1]!,
          text: command.text,
          width: estimateBoardTextWidthAtSize(
            command.text,
            fontSize,
          ),
          height: TEXT_LAYOUT.textHeight,
        };
        if (recordedWorkWriteNeedsPageTurn(layout, rect, false)) {
          // The previous page ends before this erase/WRITE, including earlier
          // commands in this same cue. The renderer uses the command boundary,
          // not an invented time window in which all ink supposedly finished.
          finish();
          layout.rects = layout.rects.filter(
            (row) => row.y < TEXT_LAYOUT.headingBottomY,
          );
          startMs = cue.startMs;
        }
        layout.rects.push(rect);
        if (rect.x < 400) {
          const inkFontSize = Number.isFinite(requested) && requested! > 0
            ? snapToBoardTypeScale(requested!) : BOARD_TYPE_SCALE.label;
          if (tracksVisibility) visibleWorkBounds.push(...recordedWriteNodeBounds(command, inkFontSize));
          hasWork = tracksVisibility ? visibleWorkBounds.length > 0 : true;
        }
      }
      previous = {
        endMs: cue.endMs,
        endCueIndex: cueIndex,
        endCommandCount: commandIndex + 1,
      };
    });
    if (!cue.commands.length)
      previous = {
        endMs: cue.endMs,
        endCueIndex: cueIndex,
        endCommandCount: 0,
      };
  });
  finish();
  return pages;
}

interface InkBounds { x: number; y: number; width: number; height: number; exact: boolean }

/** Match permanent WRITE nodes, including the captured pen's stroke width. */
function recordedWriteNodeBounds(command: ReplayCue["commands"][number], fontSize: number): InkBounds[] {
  const size = snapToBoardTypeScale(Math.min(Math.max(fontSize, MIN_BOARD_FONT_SIZE), MAX_BOARD_FONT_SIZE));
  // Legacy commands without captured dials use the minimum allowed pen width.
  // Intersection then guarantees removal at every supported current thickness;
  // edge-only ambiguous legacy erasures conservatively retain visibility.
  const style = instrumentInkStyle("pen", command.inkSettings?.markerColor ?? "#1B2A4A",
    command.inkSettings ?? { markerThickness: 0.6 });
  const bounds: InkBounds[] = [];
  for (const glyph of textToStrokePathsSync(command.text!, command.params[0]!, command.params[1]!, size)) {
    // Whiteboard does not report whitespace fallback nodes as visible ink.
    if (!glyph.char.trim()) continue;
    if (glyph.strokes.length) {
      for (const stroke of glyph.strokes) {
        const node = new Konva.Path({ data: stroke.pathData, strokeWidth: stroke.width * style.widthScale,
          stroke: style.color, fillEnabled: false, lineCap: "round", lineJoin: "round",
          shadowForStrokeEnabled: false, hitStrokeWidth: 0 });
        bounds.push({ ...node.getClientRect(), exact: true });
        node.destroy();
      }
    } else if (typeof document !== "undefined") {
      // The client uses the same browser-font fallback node as Whiteboard.
      // No Canvas implementation is loaded on the server.
      const node = new Konva.Text({ text: glyph.char, x: glyph.x, y: glyph.y,
        fontFamily: "Caveat, cursive", fontSize: glyph.fontSize ?? size,
        fill: style.color, listening: false });
      bounds.push({ ...node.getClientRect(), exact: true });
      node.destroy();
    } else {
      // SSR cannot measure a browser fallback font. Keep unknown glyph ink
      // conservatively; the client rebuilds this index with exact Text bounds.
      bounds.push({ x: glyph.x, y: glyph.y, width: glyph.width,
        height: glyph.fontSize ?? size, exact: false });
    }
  }
  return bounds;
}

function fullyCovers(erase: { x: number; y: number; width: number; height: number }, ink: InkBounds): boolean {
  return erase.x <= ink.x && erase.y <= ink.y && erase.x + erase.width >= ink.x + ink.width &&
    erase.y + erase.height >= ink.y + ink.height;
}

/** The existing executor's permitted trusted mark-start commands. */
function trustedCommandStartsDiagram(command: ReplayCue["commands"][number]): boolean {
  const p = command.params;
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !isInDiagramZone(p[0]!, p[1]!)) return false;
  switch (command.type) {
    case "DRAW_RECT": return p.slice(0, 4).length === 4 && p.slice(0, 4).every(Number.isFinite);
    case "DRAW_POINT": case "ARROW": return true;
    case "DIMENSION": return p.slice(0, 5).length === 5 && p.slice(0, 5).every(Number.isFinite);
    case "DRAW_LINE":
      if (p.length >= 7 && p.at(-1) === 2) return true;
      if (p.length >= 6 && p.length % 2 === 0) return p.every(Number.isFinite);
      return p.slice(0, 4).length === 4 && p.slice(0, 4).every(Number.isFinite);
    default: return false;
  }
}
