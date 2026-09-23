import { useCallback, useRef, type RefObject } from "react";
import {
  LETTERED_IN_HAND_MS_PER_CHAR,
  type WhiteboardHandle,
  type WriteSchedule,
  type AnnotationKind,
} from "@heytutor/whiteboard";
import {
  type DrawCommand,
  type VerifiedDiagram,
  type VerifiedDiagramAnchor,
  type VerifiedDiagramCommand,
  cuboidPath,
  cubePath,
  rectPath,
  circlePath,
  ellipsePath,
  arcPath,
  pointMarkPath,
  linePath,
  underlinePath,
  emphasisBoxPath,
  emphasisEllipsePath,
  arrowPath,
  curvedArrowPath,
  highlightRectPath,
  scribblePath,
  bezierSplinePath,
  polylinePath,
  dimensionPath,
  measureTextWidth,
  prefetchStrokePaths,
  isBlockedVerifiedDiagramCommand,
  resolveVerifiedDiagramFocusTargets,
  focusEmphasisOf,
  parseFocusSpec,
  parseWorkRowSelector,
  resolveWorkAreaRow,
  takeDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand,
  BOARD_TYPE_SCALE,
  snapToBoardTypeScale,
  WORK_CONTINUATION_INDENT,
} from "@heytutor/drawing";
import {
  getDrawingDuration,
  getFlightDuration,
  selectInkPace,
  effectiveWhiteboardInkSpeed,
  SCENE_MIN_MS,
  tutorDebug,
  type InkPace,
} from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { waitUntilDrawClock } from "@/lib/replay/replayAudio";
import { CODE_FOCUS_SPOTLIGHT_MS, DIAGRAM_ZONE, DSA_DIAGRAM_ZONE, TEXT_LAYOUT } from "../constants";
import type { CodeLessonController } from "../lib/code-lesson/codeLessonController";
import { frameAdvanceRole } from "../lib/code-lesson/codeLessonSegments";
import type { SpokenSegmentClock } from "../lib/code-lesson/codeSpokenSync";
import { runFrameWalkBeat, runTypedBlockBeat, walkSpokenStops, frameWalkPlan } from "../lib/code-lesson/spokenWalk";
import type { BoardTextRect, BoardLayoutState } from "../types";
import { isInDiagramZone, registerBoardAnchor, workColumnMaxWidth } from "../lib/board/boardLayout";
import { wrapWorkRow } from "./useBoardLayout";
import { resolveSnappedAnnotationParams } from "../lib/board/annotationSnap";
import { withSpotlight } from "../lib/board/spotlight";
import {
  runScheduledFocus,
  type FocusTargetSchedule,
  type FocusTracePath,
  type ScheduledFocusTarget,
} from "../lib/board/scheduledFocus";
import { markerTourStops, narrationTourMs, tourMarker } from "../lib/board/markerTour";
import { resultSpanOfRow } from "../lib/board/formulaEmphasis";

export interface UseCommandExecutionParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  speedRef: RefObject<number>;
  boardLayoutRef: RefObject<BoardLayoutState>;
  forceSequentialWorkLayoutRef: RefObject<boolean>;
  fbdPhaseMarkedRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  activeVerifiedDiagramRef: RefObject<VerifiedDiagram | null>;
  turnTelemetryRef: RefObject<TurnTelemetry | null>;
  notesEpochsRef: RefObject<NotesEpoch[]>;
  narrationSinceEpochRef: RefObject<string>;
  cancellableDelay: (duration: number) => Promise<void>;
  forgetErasedTextRects: (eraseRect: BoardTextRect) => void;
  resetBoardLayout: (keepHeading?: boolean, forceSequentialWorkLayout?: boolean) => void;
  resolveTextPlacement: (
    command: DrawCommand,
    x: number,
    y: number,
    applyLayout: boolean,
  ) => Promise<{ x: number; y: number }>;
  raceWithCancel: <T>(promise: Promise<T>) => Promise<T | undefined>;
  inkPaceRef: RefObject<InkPace>;
  adaptiveFactorRef: RefObject<number>;
  /** Set for DSA turns; TYPE commands reveal blocks through it. */
  codeLessonControllerRef?: RefObject<CodeLessonController | null>;
  /**
   * Publishes the diagram currently on the board to React. A worked-example
   * frame swap changes the figure, and the caption under it is rendered from
   * this state — without the setter the board kept frame 1's caption under
   * every later frame.
   */
  setActiveVerifiedDiagram?: (diagram: VerifiedDiagram | null) => void;
}

/** POINT at opening notes: work-row ids like `w1`, resolved from board layout. */
function pointWorkRowTargets(
  command: DrawCommand,
  rects: readonly BoardTextRect[],
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
  const wanted = spec.targetIds.length > 0
    ? spec.targetIds
    : [(command.semanticRef?.entityId ?? command.text ?? "").trim()].filter(Boolean);
  const targets: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  for (const raw of wanted) {
    const id = raw.trim();
    if (!id) continue;
    const row = resolveWorkAreaRow(parseWorkRowSelector(id), rects);
    if (!row) continue;
    targets.push({
      id: row.workId ?? id,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
    });
  }
  return targets;
}

export async function eraseWhiteboardRegionIfCurrent(
  whiteboard: Pick<WhiteboardHandle, "eraseRegion">,
  region: { x: number; y: number; width: number; height: number; duration: number },
  isCancelled: () => boolean,
): Promise<boolean> {
  if (isCancelled()) return false;
  await whiteboard.eraseRegion(
    region.x,
    region.y,
    region.width,
    region.height,
    region.duration,
    isCancelled,
  );
  return !isCancelled();
}

export function useCommandExecution({
  whiteboardRef,
  cancelRef,
  speedRef,
  boardLayoutRef,
  fbdPhaseMarkedRef,
  fbdPhaseStartedRef,
  activeVerifiedDiagramRef,
  turnTelemetryRef,
  cancellableDelay,
  forgetErasedTextRects,
  resetBoardLayout,
  resolveTextPlacement,
  raceWithCancel,
  inkPaceRef,
  adaptiveFactorRef,
  codeLessonControllerRef,
  setActiveVerifiedDiagram,
}: UseCommandExecutionParams) {
  // How many marker walks this board has run. It rotates the route so two
  // steps about the same frame do not repeat the same two moves.
  const pointBeatsRef = useRef(0);
  const resolveAnnotationTarget = useCallback(
    (
      command: DrawCommand,
      kind: DrawCommand["type"],
      narration?: string,
    ): { params: number[]; snapped: boolean; rect: BoardTextRect | null } =>
      resolveSnappedAnnotationParams(
        kind,
        [...command.params],
        boardLayoutRef.current.rects,
        narration,
      ),
    [boardLayoutRef],
  );

  const executeCommand = useCallback(
    async function executeCommand(
      rawCommand: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
        segmentNarration?: string;
        /**
         * This command's slice of the segment's spoken time. A ceiling for
         * anything that fills time rather than drawing ink, so two commands in
         * one segment cannot each claim the whole beat.
         */
        speechShareMs?: number;
        trustedDiagramGeometry?: boolean;
        segmentIndex?: number;
        isCancelled?: () => boolean;
        textPlacementReserved?: boolean;
        inkPace?: InkPace;
        /**
         * One spoken window per FOCUS target, in media ms from the segment's
         * audio start. With it the FOCUS runs its targets one at a time, each
         * lettered and traced when its name is spoken. Needs the audio clock.
         */
        focusSchedule?: FocusTargetSchedule;
        /** The segment's audio clock, media ms from its start. */
        getAudioPositionMs?: () => number;
        /** Media ms per wall ms; default 1. Only the waits need it. */
        getPlaybackRate?: () => number;
        /**
         * The sentence this command sits under, with its alignment and audio
         * clock. The code-lesson branches (TYPE, FRAME, FOCUS) follow its
         * words: measured 10 Sep 2026, the pen was parked 82% of spoken time
         * on a DSA lesson because none of them knew where the voice was.
         */
        spokenClock?: SpokenSegmentClock;
        /**
         * The command was placed on its spoken cue and given that window as
         * its time. A cued shape keeps the whole window instead of the scene
         * ceiling, so a figure is drawn at the pace of the words naming it.
         */
        cued?: boolean;
      } = {},
    ): Promise<void> {
      const wb = whiteboardRef.current;
      const commandCancelled = () => cancelRef.current || options.isCancelled?.() === true;
      if (!wb || commandCancelled()) return;
      const trustedDiagramGeometryEarly = options.trustedDiagramGeometry === true;
      // durationScale 0 is a seek catching the board up to a timestamp. Nothing
      // in that pass is being watched, so every pacing rule below is off.
      const isSeekCatchUp = options.durationScale === 0;
      const inkPace =
        options.inkPace ??
        selectInkPace(rawCommand, { verifiedDiagramIntro: trustedDiagramGeometryEarly });
      inkPaceRef.current = inkPace;
      if (!isSeekCatchUp) {
        // The board draws at the pace of the command in hand, in both
        // directions. Only the follow case was set, so a scene batch nested
        // inside a follow command — every shape of a worked-example frame
        // swap — kept drawing at handwriting speed and the figure landed
        // seconds after the sentence that introduced it.
        wb.setAnimationSpeed(
          effectiveWhiteboardInkSpeed(
            speedRef.current,
            adaptiveFactorRef.current,
            inkPace,
          ),
        );
      }
      const drawShape: WhiteboardHandle["drawShape"] = (path, duration, shapeOptions) => {
        const dsaInk = Boolean(codeLessonControllerRef?.current?.getActivePlan())
          || activeVerifiedDiagramRef.current?.layout === "code_lesson";
        if (rawCommand.visualStyle?.strokeRole === "trace") {
          if (dsaInk) return Promise.resolve();
          return wb.drawAnnotation("underline", path, duration, {
            strokeWidth: rawCommand.visualStyle.strokeWidth ?? 1.25,
            transient: true,
            shouldCancel: commandCancelled,
          });
        }
        if (dsaInk && rawCommand.visualStyle?.dashed && rawCommand.visualStyle?.strokeRole === "construction") {
          return Promise.resolve();
        }
        if (rawCommand.visualStyle?.fillRole === "region") {
          return Promise.all([
            wb.drawAnnotation("highlight", path, duration, {
              fillColor: "#9CCBFF",
              fillOpacity: 0.18,
              shouldCancel: commandCancelled,
            }),
            wb.drawShape(path, duration, {
              ...shapeOptions,
              pace: inkPace,
              cued: options.cued === true,
              strokeRole: shapeOptions?.strokeRole ?? rawCommand.visualStyle?.strokeRole,
              strokeWidth: shapeOptions?.strokeWidth ?? rawCommand.visualStyle?.strokeWidth,
              dashed: shapeOptions?.dashed ?? rawCommand.visualStyle?.dashed,
              shouldCancel: commandCancelled,
            }),
          ]).then(() => undefined);
        }
        return wb.drawShape(path, duration, {
          ...shapeOptions,
          pace: inkPace,
          cued: options.cued === true,
          // The figure and its scaffolding are both pencil. The compiler tags
          // which strokes are construction so a dashed guide can stay a guide.
          strokeRole: shapeOptions?.strokeRole ?? rawCommand.visualStyle?.strokeRole,
          strokeWidth: shapeOptions?.strokeWidth
            ?? rawCommand.visualStyle?.strokeWidth
            ?? (rawCommand.visualStyle?.correspondingFamily === 2 ? 2.9 : undefined),
          dashed: shapeOptions?.dashed
            ?? rawCommand.visualStyle?.dashed
            ?? rawCommand.visualStyle?.correspondingFamily === 3,
          shouldCancel: commandCancelled,
        });
      };
      const writeText = (
        text: string,
        x: number,
        y: number,
        duration: number,
        schedule?: WriteSchedule,
        fontSize?: number,
      ) => wb.writeText(text, x, y, duration, schedule, fontSize, commandCancelled);
      const drawAnnotation: WhiteboardHandle["drawAnnotation"] = (
        kind,
        path,
        duration,
        annotationOptions,
      ) => wb.drawAnnotation(kind, path, duration, {
        ...annotationOptions,
        shouldCancel: commandCancelled,
      });

      const command = rawCommand;
      const activeDiagram = activeVerifiedDiagramRef.current;
      const trustedDiagramGeometry = options.trustedDiagramGeometry === true;
      if (!activeDiagram && !trustedDiagramGeometry && isUnsafeUncompiledDiagramCommand(command)) {
        const blockMeta = {
          command_type: command.type,
          type: command.type,
          params: command.params,
          reason: "uncompiled-diagram-guard",
        };
        turnTelemetryRef.current?.mark("uncompiled-draw-blocked", blockMeta);
        tutorDebug("draw", "block uncompiled diagram draw", blockMeta);
        return;
      }
      if (
        activeDiagram &&
        !trustedDiagramGeometry &&
        isBlockedVerifiedDiagramCommand(command, activeDiagram)
      ) {
          const blockMeta = {
            diagram_id: activeDiagram.id,
            command_type: command.type,
            type: command.type,
            text: command.text?.slice(0, 40),
            params: command.params,
            reason: "verified-scene-ownership",
          };
          turnTelemetryRef.current?.mark("unverified-draw-blocked", blockMeta);
          tutorDebug("draw", "block unverified diagram command", blockMeta);
          return;
      }

      tutorDebug("draw", "executeCommand start", {
        type: command.type,
        text: command.text?.slice(0, 60),
        params: command.params,
        speech_duration_ms: options.speechDurationMs,
        duration_scale: options.durationScale,
        ink_pace: inkPace,
      });

      const durationScale = options.durationScale ?? 1;
      const speechDurationMs = options.speechDurationMs;
      const writeSchedule = options.writeSchedule;
      const segmentNarration = options.segmentNarration;

      const markFbdDiagramStart = (x: number, y: number) => {
        if (fbdPhaseStartedRef.current || !isInDiagramZone(x, y)) {
          return;
        }
        fbdPhaseStartedRef.current = true;
        turnTelemetryRef.current?.mark("fbd-phase-start", { x: Math.round(x), y: Math.round(y) });
      };

      // Durations are 1× media time. Whiteboard animationSpeed (user rate ×
      // adaptive catch-up) converts them to wall time, so a mid-lecture speed
      // change retimes the stroke in flight instead of being baked in twice.
      // A seek passes durationScale 0: it wants the finished mark, not a fast
      // animation of it. The 50ms floor below is there so a live command never
      // flashes past the eye — applied during a catch-up it would instead
      // replay every command as a visible 50ms tween, so scrubbing back one
      // step redraws the whole lecture from the beginning. Zero means zero.
      const scaledDuration = (duration: number) =>
        durationScale === 0
          ? 0
          : Math.max(Math.round(duration * durationScale), 50);

      const speechSplit = (command: DrawCommand) => {
        if (speechDurationMs === undefined) {
          return {
            flightMs: scaledDuration(getFlightDuration(command, inkPace)),
            drawMs: scaledDuration(getDrawingDuration(command, inkPace)),
          };
        }

        // speechDurationMs comes from real audio timings, which already reflect
        // the generated voice speed — no extra scaling or ink races ahead.
        const totalMs = Math.max(Math.round(speechDurationMs), 50);
        const flight = getFlightDuration(command, inkPace);
        const draw = getDrawingDuration(command, inkPace);
        const defaultTotal = flight + draw;

        if (defaultTotal <= 0) {
          return { flightMs: 0, drawMs: totalMs };
        }

        const flightMs = Math.round(totalMs * (flight / defaultTotal));
        return { flightMs, drawMs: Math.max(totalMs - flightMs, 50) };
      };

      switch (command.type) {
        case "DRAW_CUBOID": {
          const [x, y, w, h, d] = command.params;
          if ([x, y, w, h, d].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (commandCancelled()) return;
            await drawShape(cuboidPath(x, y, w, h, d), drawMs);
          }
          break;
        }
        case "DRAW_CUBE": {
          const [x, y, size] = command.params;
          if ([x, y, size].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (commandCancelled()) return;
            await drawShape(cubePath(x, y, size), drawMs);
          }
          break;
        }
        case "DRAW_RECT": {
          const [x, y, w, h] = command.params;
          if ([x, y, w, h].every(Number.isFinite)) {
            markFbdDiagramStart(x, y);
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (commandCancelled()) return;
            await drawShape(rectPath(x, y, w, h), drawMs);
          }
          break;
        }
        case "DRAW_CIRCLE": {
          const [cx, cy, radius, ry] = command.params;
          if (ry !== undefined && Number.isFinite(ry)) {
            // 4 params [cx, cy, rx, ry] → ellipse
            if ([cx, cy, radius, ry].every(Number.isFinite)) {
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(cx + radius, cy, flightMs);
              if (commandCancelled()) return;
              await drawShape(ellipsePath(cx, cy, radius, ry), drawMs);
            }
          } else if ([cx, cy, radius].every(Number.isFinite)) {
            // 3 params [cx, cy, r] → circle
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(cx + radius, cy, flightMs);
            if (commandCancelled()) return;
            await drawShape(circlePath(cx, cy, radius), drawMs);
          }
          break;
        }
        case "DRAW_ARC": {
          const [cx, cy, radius, startDeg, endDeg] = command.params;
          if ([cx, cy, radius, startDeg, endDeg].every(Number.isFinite)) {
            const startRad = (startDeg * Math.PI) / 180;
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(
              cx + radius * Math.cos(startRad),
              cy + radius * Math.sin(startRad),
              flightMs,
            );
            if (commandCancelled()) return;
            await drawShape(arcPath(cx, cy, radius, startDeg, endDeg), drawMs);
          }
          break;
        }
        case "DRAW_POINT": {
          const [x, y, radius = 2] = command.params;
          if ([x, y].every(Number.isFinite)) {
            markFbdDiagramStart(x, y);
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (commandCancelled()) return;
            await drawShape(pointMarkPath(x, y, radius), Math.min(drawMs, 280));
            if (isInDiagramZone(x, y)) {
              registerBoardAnchor(boardLayoutRef.current, {
                x: x - 8,
                y: y - 8,
                width: 16,
                height: 16,
                text: undefined,
              });
            }
          }
          break;
        }
        case "DRAW_LINE": {
          const params = command.params;
          const lastParam = params[params.length - 1];

          // Bezier spline: 6+ coordinate params with last param = 2
          // Points are all params except the last flag: [x1,y1,x2,y2,...,2]
          if (params.length >= 7 && lastParam === 2) {
            const splinePoints = params.slice(0, -1);
            const [sx1, sy1] = splinePoints;
            if (Number.isFinite(sx1) && Number.isFinite(sy1)) {
              markFbdDiagramStart(sx1, sy1);
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(sx1, sy1, flightMs);
              if (commandCancelled()) return;
              await drawShape(bezierSplinePath(splinePoints), drawMs);
              const midIdx = Math.floor(splinePoints.length / 2);
              const midX = splinePoints[midIdx - 1] ?? sx1;
              const midY = splinePoints[midIdx] ?? sy1;
              if (isInDiagramZone(midX, midY)) {
                registerBoardAnchor(boardLayoutRef.current, {
                  x: Math.min(...splinePoints.filter((_, i) => i % 2 === 0)),
                  y: Math.min(...splinePoints.filter((_, i) => i % 2 === 1)),
                  width: 100,
                  height: 100,
                  text: undefined,
                });
              }
            }
            break;
          }

          // Polyline: 3+ points with no style flag. Used for crisp circuit
          // symbols such as zigzag resistors without adding another command.
          if (params.length >= 6 && params.length % 2 === 0) {
            const [sx1, sy1] = params;
            if (params.every(Number.isFinite) && Number.isFinite(sx1) && Number.isFinite(sy1)) {
              markFbdDiagramStart(sx1, sy1);
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(sx1, sy1, flightMs);
              if (commandCancelled()) return;
              await drawShape(polylinePath(params), drawMs);
              if (params.some((value, index) => index % 2 === 0 && isInDiagramZone(value, params[index + 1] ?? 0))) {
                const xs = params.filter((_, i) => i % 2 === 0);
                const ys = params.filter((_, i) => i % 2 === 1);
                registerBoardAnchor(boardLayoutRef.current, {
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  width: Math.max(...xs) - Math.min(...xs) || 20,
                  height: Math.max(...ys) - Math.min(...ys) || 20,
                  text: undefined,
                });
              }
            }
            break;
          }

          const [x1, y1, x2, y2, dashedFlag] = params;
          if ([x1, y1, x2, y2].every(Number.isFinite)) {
            markFbdDiagramStart(x1, y1);
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x1, y1, flightMs);
            if (commandCancelled()) return;
            const lineLength = Math.hypot(x2 - x1, y2 - y1);
            const isDashed = dashedFlag === 1;
            if (isDashed) {
              await drawShape(linePath(x1, y1, x2, y2), drawMs, { dashed: true });
            } else {
              await drawShape(
                lineLength < 2 ? circlePath(x1, y1, 4) : linePath(x1, y1, x2, y2),
                drawMs,
              );
            }
            if (isInDiagramZone((x1 + x2) / 2, (y1 + y2) / 2)) {
              registerBoardAnchor(boardLayoutRef.current, {
                x: Math.min(x1, x2),
                y: Math.min(y1, y2),
                width: Math.abs(x2 - x1) || 20,
                height: Math.abs(y2 - y1) || 20,
                text: undefined,
              });
            }
          }
          break;
        }
        case "DIMENSION": {
          const [x1, y1, x2, y2, offset] = command.params;
          if ([x1, y1, x2, y2, offset].every(Number.isFinite)) {
            markFbdDiagramStart(x1, y1);
            const { path, labelCenterX, labelY } = dimensionPath(x1, y1, x2, y2, offset);
            const { flightMs, drawMs } = speechSplit(command);
            const barStartX = x1 + (-(y2 - y1) / (Math.hypot(x2 - x1, y2 - y1) || 1)) * offset;
            const barStartY = y1 + ((x2 - x1) / (Math.hypot(x2 - x1, y2 - y1) || 1)) * offset;
            await wb.flyCursorTo(barStartX, barStartY, flightMs);
            if (commandCancelled()) return;
            // Thin, dotted measurement bar — a light guide, never a boxed bracket.
            await drawShape(path, drawMs, { dashed: true, strokeWidth: 1.4 });
            if (command.text) {
              const labelDrawMs = scaledDuration(getDrawingDuration(command, inkPace));
              // A measurement is the quietest ink on the board: smaller than the
              // names on the figure, which are themselves smaller than the work.
              const dimensionSize = BOARD_TYPE_SCALE.annotation;
              const dimensionWidth = measureTextWidth(command.text, dimensionSize);
              const labelX = labelCenterX - dimensionWidth / 2;
              await wb.flyCursorTo(labelX, labelY, 80, -35);
              if (commandCancelled()) return;
              await writeText(command.text, labelX, labelY, labelDrawMs, undefined, dimensionSize);
              if (isInDiagramZone(labelX, labelY)) {
                registerBoardAnchor(boardLayoutRef.current, {
                  x: labelX,
                  y: labelY,
                  width: Math.max(dimensionWidth, 24),
                  height: 28,
                  text: command.text,
                });
              }
            }
          }
          break;
        }
        case "WRITE":
        case "LABEL": {
          const [x, y, maybeFontSize] = command.params;
          if (
            command.type === "WRITE" &&
            !options.textPlacementReserved &&
            command.text &&
            Number.isFinite(x) &&
            Number.isFinite(y)
          ) {
            const columnWidth = workColumnMaxWidth(
              boardLayoutRef.current,
              fbdPhaseStartedRef.current,
            );
            const { fontSize: wrappedSize, lines } = wrapWorkRow(command.text, columnWidth);
            if (lines.length > 1) {
              for (const [index, line] of lines.entries()) {
                if (commandCancelled()) return;
                const indent = index === 0 ? 0 : WORK_CONTINUATION_INDENT;
                await executeCommand(
                  {
                    ...command,
                    text: line,
                    params: [TEXT_LAYOUT.marginX + indent, y, wrappedSize],
                  },
                  { ...options, applyLayout: true, textPlacementReserved: false },
                );
              }
              break;
            }
          }
          if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
            // Every size that reaches the pen is a step on the board's scale.
            // A work row arrives with the size its wrap settled on; a figure
            // label without one letters at the label size, which reads clearly
            // under the working rather than competing with it.
            const fontSize =
              typeof maybeFontSize === "number" && Number.isFinite(maybeFontSize) && maybeFontSize > 0
                ? snapToBoardTypeScale(maybeFontSize)
                : BOARD_TYPE_SCALE.label;
            const placement = options.textPlacementReserved
              ? { x, y }
              : await resolveTextPlacement(
                  command,
                  x,
                  y,
                  command.type === "WRITE" || options.applyLayout !== false,
                );
            if (isInDiagramZone(placement.x, placement.y)) {
              const diagramLabels = boardLayoutRef.current.rects.filter(
                (r) => r.x >= DIAGRAM_ZONE.x,
              );
              const hasSurface = diagramLabels.length >= 2;
              const forceLabelCount = diagramLabels.filter((r) => {
                const t = (r.text ?? "").trim();
                return t === "F" || t === "f" || t === "N" || t === "mg";
              }).length;
              if (hasSurface && forceLabelCount >= 3 && !fbdPhaseMarkedRef.current) {
                turnTelemetryRef.current?.mark("fbd-phase-complete", {
                  force_labels: forceLabelCount,
                });
                fbdPhaseMarkedRef.current = true;
              }
            }
            // Build Tegaki paths during the cursor flight so the first spoken
            // character does not wait on handwriting setup.
            prefetchStrokePaths(command.text, placement.x, placement.y, fontSize);
            if (writeSchedule && writeSchedule.charStartOffsetsMs.length > 0) {
              // Scheduled writing: each character is held against the true audio clock so
              // the pen tracks the narration token by token. writeText flies to the first
              // glyph while waiting for that cue — a serial 60 ms hop here used to start
              // every row late.
              await writeText(
                command.text,
                placement.x,
                placement.y,
                0,
                writeSchedule,
                fontSize,
              );
            } else {
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(placement.x, placement.y, flightMs, -35);
              if (commandCancelled()) return;
              const penDrawMs =
                inkPace === "follow" && !isSeekCatchUp
                  ? Math.max(drawMs, getDrawingDuration(command, "follow"))
                  : drawMs;
              await writeText(
                command.text,
                placement.x,
                placement.y,
                penDrawMs,
                undefined,
                fontSize,
              );
            }
            // A WRITE row used to release withheld figure labels whose text it
            // contained. Single letters match any row: "Given: f = 15 cm"
            // lettered C, F, M and I silently under the row, before the
            // geometry they name existed. A label now waits for its spoken
            // name, through the FOCUS that carries its id.
          }
          break;
        }
        case "TYPE": {
          const controller = codeLessonControllerRef?.current;
          const blockId = command.semanticRef?.entityId?.trim() || command.text?.trim();
          if (!controller || !blockId) {
            tutorDebug("draw", "TYPE dropped", {
              block_id: blockId ?? null,
              has_controller: Boolean(controller),
            });
            break;
          }
          // The opening wrote the problem in the left column. The editor sits
          // on top of that column, so wipe the notes before the panel mounts.
          if (controller.getState().mode === "hidden") {
            const eraseWidth = Math.max(DIAGRAM_ZONE.x - TEXT_LAYOUT.eraseX - 10, 40);
            const eraseRect = {
              x: TEXT_LAYOUT.eraseX,
              y: TEXT_LAYOUT.eraseY,
              width: eraseWidth,
              height: TEXT_LAYOUT.eraseHeight,
            };
            if (durationScale > 0.05) {
              const wiped = await eraseWhiteboardRegionIfCurrent(
                wb,
                { ...eraseRect, duration: 420 },
                commandCancelled,
              );
              if (!wiped) return;
            }
            forgetErasedTextRects(eraseRect);
          }
          // Board restore (0.05) and replay seeks (0) want the finished block,
          // not a typing animation racing a clock that no longer exists.
          if (durationScale <= 0.05) {
            controller.revealBlockInstant(blockId);
            break;
          }
          // The block is typed at its natural pace on the sentence's audio
          // clock while the pen follows the caret; then, for the rest of the
          // sentence, the highlighted line and the pen move to whichever line
          // the voice is explaining. Measured before this: each block was
          // typed in the first 22 to 29% of a 20 s sentence and nothing on
          // the board moved for the remaining 15 s.
          const typed = await runTypedBlockBeat({
            host: wb,
            controller,
            blockId,
            clock: options.spokenClock ?? null,
            isCancelled: commandCancelled,
            delay: cancellableDelay,
          });
          if (typed.cancelled) return;
          tutorDebug("draw", "typed block beat", {
            block_id: blockId,
            typed_ms: Math.round(typed.typedMs),
            lines_visited: typed.linesVisited.join(","),
            anchor_count: typed.schedule?.anchors.length ?? 0,
            unspoken_lines: typed.schedule?.unspokenLines.join(",") ?? "",
            source: typed.schedule?.source ?? "none",
          });
          break;
        }
        case "POINT": {
          // Move the marker to the figure without drawing anything. This is
          // what the pen does while the tutor is talking rather than writing:
          // before, a spoken step with no tag left it wherever it happened to
          // be, for as long as the step ran.
          const diagramTargets = resolveVerifiedDiagramFocusTargets(
            { ...command, type: "FOCUS" },
            activeVerifiedDiagramRef.current,
          );
          const targets = diagramTargets.length > 0
            ? diagramTargets
            : pointWorkRowTargets(command, boardLayoutRef.current.rects);
          if (targets.length === 0) break;
          // A replay seek is catching the board up to a timestamp, and nothing
          // in that pass is being watched. Walking a whole spoken step per
          // pointing command would make scrubbing take as long as the lesson.
          if (isSeekCatchUp || durationScale <= 0.05) break;
          const cancelledTour = await tourMarker(
            wb,
            markerTourStops(targets, pointBeatsRef.current),
            {
              totalMs: narrationTourMs(
                options.segmentNarration,
                Math.max(speechDurationMs ?? 900, 700),
                options.speechShareMs,
              ),
              isCancelled: commandCancelled,
              delay: cancellableDelay,
              now: () => performance.now(),
            },
          );
          pointBeatsRef.current += 1;
          if (cancelledTour) return;
          wb.setCursorState("thinking");
          break;
        }
        case "FRAME": {
          // Advance the worked example. Each frame is its own compiled figure
          // fitted to the whole diagram zone, so the board wipes the zone and
          // redraws rather than accumulating frames on top of each other.
          const frames = codeLessonControllerRef?.current?.frames;
          if (!frames || !frames.hasNext()) break;

          // A replay seek wants the finished state, not a redraw per frame.
          if (durationScale <= 0.05) {
            const last = frames.jumpToEnd();
            if (last) {
              await eraseWhiteboardRegionIfCurrent(
                wb,
                { ...DSA_DIAGRAM_ZONE, duration: 0 },
                commandCancelled,
              );
              activeVerifiedDiagramRef.current = last.presentation.diagram;
              setActiveVerifiedDiagram?.(last.presentation.diagram);
              for (const next of last.presentation.diagram.commands) {
                if (commandCancelled()) return;
                await executeCommand(verifiedDiagramCommandToDrawCommand(next), {
                  trustedDiagramGeometry: true,
                  applyLayout: false,
                  isCancelled: commandCancelled,
                  inkPace: "scene",
                  durationScale,
                });
              }
            }
            break;
          }

          const next = frames.advance();
          if (!next) break;
          // The redraw has to land with the sentence that introduces it. Split
          // the spoken window across the figure's commands: each one can only
          // be made quicker than its natural scene pace, never slower, so a
          // long sentence still draws at a readable speed while a short one
          // stops the board running three seconds past the voice.
          const wipeMs = 420;
          const frameCommandCount = Math.max(next.presentation.diagram.commands.length, 1);
          const drawWindowMs = Math.max((speechDurationMs ?? 0) - wipeMs, 0);
          const evenShareMs = drawWindowMs > 0
            ? Math.max(Math.floor(drawWindowMs / frameCommandCount), SCENE_MIN_MS)
            : undefined;
          // A figure label is part of the sketch, so it is lettered with the
          // instrument already in hand. Handing it a generous share of the
          // sentence pushes it over the prose threshold and buys an instrument
          // swap on every label: fourteen labels spent six seconds swapping
          // pens while the sentence that introduced the frame ran out. Same
          // rule as the scene-text branch of `resolveCommandInkBudgetMs`,
          // applied here because a frame redraw budgets its own commands.
          const frameCommandBudgetMs = (command: { text?: string }): number | undefined => {
            if (evenShareMs === undefined) return undefined;
            const text = command.text?.replace(/\s+/g, "") ?? "";
            if (text.length === 0) return evenShareMs;
            return Math.min(evenShareMs, text.length * LETTERED_IN_HAND_MS_PER_CHAR);
          };
          const wiped = await eraseWhiteboardRegionIfCurrent(
            wb,
            { ...DSA_DIAGRAM_ZONE, duration: wipeMs },
            commandCancelled,
          );
          if (!wiped) return;
          // Point FOCUS at the new figure before drawing it, so a spotlight
          // in the same segment resolves against what is actually on screen.
          // The caption under the board reads from React state, so publish the
          // frame too: without this the board kept frame 1's caption while the
          // figure moved on, and the tutor described a line nobody could see.
          activeVerifiedDiagramRef.current = next.presentation.diagram;
          setActiveVerifiedDiagram?.(next.presentation.diagram);
          for (const drawCommand of next.presentation.diagram.commands) {
            if (commandCancelled()) return;
            const budgetMs = frameCommandBudgetMs(drawCommand);
            await executeCommand(verifiedDiagramCommandToDrawCommand(drawCommand), {
              trustedDiagramGeometry: true,
              applyLayout: false,
              isCancelled: commandCancelled,
              inkPace: "scene",
              ...(budgetMs === undefined ? {} : { speechDurationMs: budgetMs }),
            });
          }
          turnTelemetryRef.current?.mark("dsa-frame-advance", {
            frame_id: next.id,
            frame_index: frames.currentIndex(),
            frame_total: frames.total(),
          });
          // A figure beat owns its sentence: after the redraw the pen walks
          // the cells the voice names, in the order it names them, and halts
          // on the word that names the spotlight's target so the FOCUS after
          // it fires there. A catch-up frame beside a code block hands the
          // sentence straight back to the TYPE; a bare FRAME does nothing more.
          // Measured before this: 6 s of redraw, then 10 s parked.
          if (frameAdvanceRole(command) === "figure_beat" && options.spokenClock && !isSeekCatchUp) {
            const focusIds = (command.semanticRef?.entityId ?? "")
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean);
            const idleTargets = resolveVerifiedDiagramFocusTargets(
              { ...command, type: "FOCUS", text: next.pointEntityIds.join(","), semanticRef: { entityId: next.pointEntityIds.join(",") } },
              next.presentation.diagram,
            );
            const walked = await runFrameWalkBeat({
              host: wb,
              anchors: next.presentation.diagram.anchors,
              clock: options.spokenClock,
              isCancelled: commandCancelled,
              delay: cancellableDelay,
              idleStops: markerTourStops(idleTargets, pointBeatsRef.current),
              stopBeforeIds: focusIds,
            });
            if (walked.cancelled) return;
            tutorDebug("draw", "frame walk", {
              frame_id: next.id,
              stops: walked.stops,
              visited: walked.visited.join(","),
              halted_at: walked.haltedAt?.id ?? null,
              audio_pos_ms: Math.round(options.spokenClock.getAudioPositionMs()),
            });
            pointBeatsRef.current += 1;
          }
          break;
        }
        case "PAUSE": {
          const pauseMs =
            speechDurationMs !== undefined
              ? Math.max(Math.round(speechDurationMs), 50)
              : scaledDuration(command.params[0] ?? 500);
          await cancellableDelay(pauseMs);
          break;
        }
        case "CLEAR": {
          // Starting a fresh answer should not waste time showing the duster.
          await wb.clearBoard();
          resetBoardLayout(false, true);
          break;
        }
        case "ERASE": {
          const [x, y, rawW, h] = command.params;
          let w = rawW;
          if ([x, y, w, h].every(Number.isFinite)) {
            // A work-area erase that overreaches into the diagram zone would
            // wipe a diagram the lesson still needs. Clip it to the left
            // column; only rects that start inside the zone may erase it.
            if (
              fbdPhaseStartedRef.current &&
              x < DIAGRAM_ZONE.x &&
              x + w > DIAGRAM_ZONE.x &&
              y < DIAGRAM_ZONE.y + DIAGRAM_ZONE.height &&
              y + h > DIAGRAM_ZONE.y
            ) {
              const clippedW = Math.max(DIAGRAM_ZONE.x - x - 10, 40);
              tutorDebug("draw", "erase clipped to preserve diagram", {
                requested: [x, y, w, h],
                clipped_width: clippedW,
              });
              w = clippedW;
            }
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (commandCancelled()) return;
            const erased = await eraseWhiteboardRegionIfCurrent(
              wb,
              { x, y, width: w, height: h, duration: drawMs },
              commandCancelled,
            );
            if (!erased) return;
            forgetErasedTextRects({ x, y, width: w, height: h });
          }
          break;
        }
        case "FOCUS": {
          const targets = resolveVerifiedDiagramFocusTargets(command, activeDiagram);
          if (targets.length === 0 || !activeDiagram) break;
          const codeLessonActive = Boolean(codeLessonControllerRef?.current?.getActivePlan())
            || activeDiagram?.layout === "code_lesson";
          const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
          const focusSchedule = options.focusSchedule;
          const focusAudioClock = options.getAudioPositionMs;
          // With a schedule the pen follows the voice: each target is lettered
          // and traced inside its own spoken window, in spoken order. A code
          // lesson keeps its spotlight-only beat below, and a seek has no
          // audio clock to follow.
          if (
            !codeLessonActive &&
            !isSeekCatchUp &&
            focusSchedule &&
            focusSchedule.targets.length > 0 &&
            focusAudioClock
          ) {
            const emphasis = focusEmphasisOf(command);
            const focusFloorMs = inkPace === "scene" ? 120 : 420;
            const letterWithheld = async (
              entityIds: readonly string[],
            ): Promise<{ cancelled: boolean; penAt: { x: number; y: number } | null }> => {
              let penAt: { x: number; y: number } | null = null;
              for (const next of takeDeferredAnnotations(activeDiagram, { entityIds })) {
                if (commandCancelled()) return { cancelled: true, penAt };
                await executeCommand(
                  {
                    type: next.type,
                    params: [...next.params],
                    text: next.text,
                    charPosition: 0,
                    narrationBefore: "",
                    visualStyle: next.visualStyle,
                    semanticRef: next.semanticRef,
                  },
                  {
                    trustedDiagramGeometry: true,
                    applyLayout: false,
                    isCancelled: commandCancelled,
                    inkPace: "scene",
                  },
                );
                const [x, y, size] = next.params;
                if (Number.isFinite(x) && Number.isFinite(y)) {
                  // A label is written rightwards from its origin, so the pen
                  // ends past its last glyph.
                  const width = next.type === "LABEL" && next.text
                    ? measureTextWidth(next.text, typeof size === "number" && size > 0 ? size : BOARD_TYPE_SCALE.label)
                    : 0;
                  penAt = { x: x! + width, y: y! };
                }
              }
              return { cancelled: commandCancelled(), penAt };
            };
            const scheduled = scheduledFocusTargets(activeDiagram, targets, focusSchedule, focusFloorMs, (id, ids, window) => async () => {
              tutorDebug("draw", "focus target", {
                target_id: id,
                start_ms: Math.round(window.startMs),
                end_ms: Math.round(window.endMs),
                audio_pos_ms: Math.round(focusAudioClock()),
                anchor: window.anchor,
              });
              return letterWithheld(ids);
            });
            tutorDebug("draw", "focus schedule", {
              target_id: targets.map((target) => target.id).join(","),
              target_count: scheduled.length,
              matched_count: focusSchedule.matchedCount,
              source: focusSchedule.source,
              emphasis,
              audio_pos_ms: Math.round(focusAudioClock()),
              first_start_ms: Math.round(scheduled[0]?.startMs ?? 0),
            });
            const scheduleCancelled = await runScheduledFocus(
              {
                setSpotlight: (spotlight) => wb.setSpotlight(spotlight),
                flyCursorTo: (x, y, durationMs) => wb.flyCursorTo(x, y, durationMs),
                drawAnnotation: (kind, path, durationMs, annotationOptions) =>
                  drawAnnotation(kind, path, durationMs, annotationOptions),
              },
              scheduled,
              {
                emphasis,
                veil: DIAGRAM_ZONE,
                getAudioPositionMs: focusAudioClock,
                waitUntilAudioMs: (targetMs) =>
                  waitUntilDrawClock(focusAudioClock, targetMs, {
                    shouldCancel: commandCancelled,
                    getPlaybackRate: options.getPlaybackRate,
                  }),
                isCancelled: commandCancelled,
                floorMs: focusFloorMs,
              },
            );
            if (scheduleCancelled) return;
            wb.setCursorState("thinking");
            turnTelemetryRef.current?.mark("verified-focus-complete", {
              target_id: targets.map((target) => target.id).join(","),
              path_count: scheduled.length,
              emphasis,
              scheduled: true,
            });
            break;
          }
          const deferred = takeDeferredAnnotations(activeDiagram, {
            entityIds: [...spec.targetIds, ...targets.map((target) => target.id)],
          });
          for (const next of deferred) {
            if (commandCancelled()) return;
            await executeCommand(
              {
                type: next.type,
                params: [...next.params],
                text: next.text,
                charPosition: 0,
                narrationBefore: "",
                visualStyle: next.visualStyle,
                semanticRef: next.semanticRef,
              },
              {
                trustedDiagramGeometry: true,
                applyLayout: false,
                isCancelled: commandCancelled,
                inkPace: "scene",
              },
            );
          }
          // Tracing rectangle outlines with the marker looks like scribbling
          // on a DSA figure. Code lessons only dim everything except the named
          // cells — the figure itself stays the explanation.
          if (codeLessonActive) {
            // The sentence's named cells, from here to its end. The frame
            // walk before this FOCUS halted on the target's word; if the
            // FOCUS stands alone (a step holding the frame), the pen walks
            // to that word first, and the spotlight fires as it is said.
            const spokenClock = !isSeekCatchUp && durationScale > 0.05 ? options.spokenClock : undefined;
            const focusIds = new Set(targets.map((target) => target.id));
            if (spokenClock) {
              const plan = frameWalkPlan(activeDiagram.anchors, spokenClock);
              if (plan.stops.some((stop) => focusIds.has(stop.id))) {
                const approach = await walkSpokenStops(wb, plan.stops, spokenClock, {
                  untilMs: plan.totalMs,
                  isCancelled: commandCancelled,
                  delay: cancellableDelay,
                  stopBeforeIds: focusIds,
                });
                if (approach.cancelled) return;
              }
            }
            const hole = targets.reduce((union, target) => {
              const x = Math.min(union.x, target.x);
              const y = Math.min(union.y, target.y);
              const right = Math.max(union.x + union.width, target.x + target.width);
              const bottom = Math.max(union.y + union.height, target.y + target.height);
              return { x, y, width: right - x, height: bottom - y };
            }, { x: targets[0]!.x, y: targets[0]!.y, width: targets[0]!.width, height: targets[0]!.height });
            // Through withSpotlight so the veil comes off even when the turn
            // is cancelled mid-focus. Returning early between setting and
            // clearing it left the whole figure greyed out for the rest of
            // the lesson.
            const focusCancelled = await withSpotlight(
              wb,
              {
                veil: {
                  x: DSA_DIAGRAM_ZONE.x,
                  y: DSA_DIAGRAM_ZONE.y,
                  width: DSA_DIAGRAM_ZONE.width,
                  height: DSA_DIAGRAM_ZONE.height,
                },
                hole: { x: hole.x - 10, y: hole.y - 10, width: hole.width + 20, height: hole.height + 20 },
                opacity: 0.32,
              },
              async () => {
                // The pen walks the lit entities while the tutor names them.
                // It used to go `idle` here, which is opacity 0: the figure
                // was spotlit and the pen was nowhere on the board.
                return await tourMarker(wb, markerTourStops(targets, pointBeatsRef.current), {
                  totalMs: Math.min(Math.max(speechDurationMs ?? 600, 600), 1600),
                  isCancelled: commandCancelled,
                  delay: cancellableDelay,
                  now: () => performance.now(),
                });
              },
            );
            if (focusCancelled) return;
            if (spokenClock) {
              // The veil is up for a glance; the rest of the sentence still
              // names cells, and the pen keeps walking them.
              const rest = frameWalkPlan(activeDiagram.anchors, spokenClock);
              const walked = await walkSpokenStops(wb, rest.stops, spokenClock, {
                untilMs: rest.totalMs,
                isCancelled: commandCancelled,
                delay: cancellableDelay,
                idleStops: markerTourStops(targets, pointBeatsRef.current + 1),
              });
              if (walked.cancelled) return;
              pointBeatsRef.current += 1;
            }
            wb.setCursorState("thinking");
            turnTelemetryRef.current?.mark("verified-focus-complete", {
              target_id: targets.map((target) => target.id).join(","),
              path_count: 0,
              emphasis: "spotlight",
            });
            break;
          }
          const emphasis = focusEmphasisOf(command);
          const targetIds = new Set(targets.map((target) => target.id));
          const targetCommands = activeDiagram.commands.filter((candidate) =>
            candidate.semanticRef?.entityId &&
            targetIds.has(candidate.semanticRef.entityId) &&
            !candidate.semanticRef?.actionId &&
            candidate.visualStyle?.strokeRole !== "trace" &&
            candidate.type !== "LABEL" &&
            candidate.type !== "WRITE" &&
            candidate.type !== "DIMENSION",
          );
          const hole = targets.reduce((union, target) => {
            const x = Math.min(union.x, target.x);
            const y = Math.min(union.y, target.y);
            const right = Math.max(union.x + union.width, target.x + target.width);
            const bottom = Math.max(union.y + union.height, target.y + target.height);
            return { x, y, width: right - x, height: bottom - y };
          }, { x: targets[0]!.x, y: targets[0]!.y, width: targets[0]!.width, height: targets[0]!.height });
          const veil = codeLessonActive ? DSA_DIAGRAM_ZONE : DIAGRAM_ZONE;
          // Every focus path raises its veil through withSpotlight, so a cancel
          // or a throw between raising and lowering it cannot strand the veil and
          // leave the whole figure greyed out for the rest of the lesson.
          const focusCancelled = await withSpotlight(
            wb,
            emphasis === "spotlight"
              ? {
                  veil: { x: veil.x, y: veil.y, width: veil.width, height: veil.height },
                  hole: { x: hole.x - 10, y: hole.y - 10, width: hole.width + 20, height: hole.height + 20 },
                  opacity: 0.36,
                }
              : null,
            async () => {
            const focusFloorMs = inkPace === "scene" ? 120 : 420;
            const totalMs = Math.max(speechDurationMs ?? (inkPace === "scene" ? 220 : 900), focusFloorMs);
            if (!codeLessonActive) {
              const tracePaths = targetCommands
                .map(verifiedCommandTracePath)
                .filter((candidate): candidate is { path: string; x: number; y: number } => candidate !== null);
              const fallbacks = targets.map((target) => ({
                path: emphasisEllipsePath(target.x - 4, target.y - 4, target.width + 8, target.height + 8),
                x: target.x + target.width / 2,
                y: target.y,
              }));
              const paths = (tracePaths.length > 0 ? tracePaths : fallbacks).slice(0, 8);
              for (const candidate of paths) {
                await wb.flyCursorTo(candidate.x, candidate.y, Math.min(160, totalMs / paths.length));
                if (commandCancelled()) return true;
                await drawAnnotation(
                  "underline",
                  candidate.path,
                  Math.max(Math.round(totalMs / paths.length) - 160, 180),
                  { strokeWidth: 1.25, transient: true },
                );
              }
            } else {
              // Same rule as the branch above: the pen stays visible and
              // walks the lit entity instead of vanishing at opacity 0. Only
              // for as long as the veil is up, though — the rest of the step
              // is walked below, over an undimmed figure.
              const litTourCancelled = await tourMarker(
                wb,
                markerTourStops(targets, pointBeatsRef.current),
                {
                  totalMs: Math.min(Math.max(totalMs, 600), CODE_FOCUS_SPOTLIGHT_MS),
                  isCancelled: commandCancelled,
                  delay: cancellableDelay,
                  now: () => performance.now(),
                },
              );
              if (litTourCancelled) return true;
            }
            if (emphasis === "pulse") {
              for (const target of targets.slice(0, 3)) {
                if (commandCancelled()) return true;
                const pulse = compactPulseBox(target, targetCommands);
                await drawAnnotation(
                  "circle_around",
                  emphasisEllipsePath(pulse.x, pulse.y, pulse.width, pulse.height),
                  260,
                  { strokeWidth: 1.1, transient: true },
                );
              }
            }
            if (emphasis === "spotlight") {
              await cancellableDelay(220);
            }
            return false;
            },
          );
          if (focusCancelled) return;
          if (codeLessonActive && !isSeekCatchUp && durationScale > 0.05) {
            // The veil is down. A tagged step still runs a minute of speech
            // about the figure, and the pen used to spend all of it parked
            // where the spotlight left it, which is the stalled board the
            // owner reported. It keeps walking the same entities instead.
            const walkMs =
              narrationTourMs(options.segmentNarration, 0, options.speechShareMs) -
              CODE_FOCUS_SPOTLIGHT_MS;
            if (walkMs > 400) {
              const walkCancelled = await tourMarker(
                wb,
                markerTourStops(targets, pointBeatsRef.current + 1),
                {
                  totalMs: walkMs,
                  isCancelled: commandCancelled,
                  delay: cancellableDelay,
                  now: () => performance.now(),
                },
              );
              if (walkCancelled) return;
            }
            pointBeatsRef.current += 1;
          }
          wb.setCursorState("thinking");
          turnTelemetryRef.current?.mark("verified-focus-complete", {
            target_id: targets.map((target) => target.id).join(","),
            path_count: targets.length,
            emphasis,
          });
          break;
        }
        case "EMPHASIZE": {
          const row = resolveWorkAreaRow(
            parseWorkRowSelector(command.text),
            boardLayoutRef.current.rects,
          );
          if (!row) break;
          const { flightMs, drawMs } = speechSplit(command);

          // Box the formula. A full-weight underline under a line of algebra
          // reads as a correction; a frame reads as "hold on to this".
          await wb.flyCursorTo(row.x - 6, row.y - 5, flightMs);
          if (commandCancelled()) return;
          await drawAnnotation(
            "box",
            emphasisBoxPath(row.x, row.y, row.width, row.height),
            Math.min(drawMs, 460),
          );
          if (commandCancelled()) return;

          // Then run the highlighter over the part the student writes down.
          // The span is measured from the row's own text, so it lands on the
          // glyphs rather than near them.
          const result = resultSpanOfRow(row);
          if (result) {
            await wb.flyCursorTo(result.x, result.y + result.height / 2, Math.min(flightMs, 160));
            if (commandCancelled()) return;
            await drawAnnotation(
              "highlight",
              highlightRectPath(result.x - 2, result.y, result.width + 4, result.height),
              Math.min(drawMs, 320),
            );
          }
          break;
        }
        case "SUPERSEDE":
          break;
        case "ANNOTATE": {
          if (!activeDiagram) break;
          const targets = resolveVerifiedDiagramFocusTargets({ ...command, type: "FOCUS" }, activeDiagram);
          // The requested id itself as well as the anchors it resolves to: a
          // withheld dimension can be named by its own id without being an
          // anchor of the figure.
          const deferred = takeDeferredAnnotations(activeDiagram, {
            entityIds: [
              ...parseFocusSpec(command.semanticRef?.entityId ?? command.text).targetIds,
              ...targets.map((target) => target.id),
            ],
          });
          for (const next of deferred) {
            if (commandCancelled()) return;
            await executeCommand(
              {
                type: next.type,
                params: [...next.params],
                text: next.text,
                charPosition: 0,
                narrationBefore: "",
                visualStyle: next.visualStyle,
                semanticRef: next.semanticRef,
              },
              {
                trustedDiagramGeometry: true,
                applyLayout: false,
                isCancelled: commandCancelled,
                inkPace: "scene",
              },
            );
          }
          break;
        }
        case "UNDERLINE":
        case "CIRCLE_AROUND":
        case "ARROW":
        case "HIGHLIGHT":
        case "SCRIBBLE": {
          const dsaFigure = Boolean(codeLessonControllerRef?.current?.getActivePlan())
            || activeVerifiedDiagramRef.current?.layout === "code_lesson";
          if (dsaFigure && command.type !== "ARROW") {
            break;
          }
          const tel = turnTelemetryRef.current;
          tel?.mark("annotate-start", {
            type: command.type,
            params: command.params,
          });

          if (command.params.length >= 2) {
            const px = command.params[0];
            const py = command.params[1];
            if (command.type === "ARROW") {
              markFbdDiagramStart(px, py);
            }
            if (isInDiagramZone(px, py)) {
              tel?.mark("annotate-on-diagram", {
                type: command.type,
                x: px,
                y: py,
              });
            }
          }

          const { params, snapped, rect } = trustedDiagramGeometry || command.semanticRef
            ? { params: command.params, snapped: false, rect: null }
            : resolveAnnotationTarget(
            command,
            command.type,
            segmentNarration,
          );
          if (snapped) {
            tel?.mark("annotate-snap", {
              type: command.type,
              rect_text: rect?.text?.slice(0, 40),
              rect_x: rect?.x,
              rect_y: rect?.y,
            });
          }

          const { flightMs, drawMs } = speechSplit(command);
          const annotationKind = command.type.toLowerCase() as AnnotationKind;

          // Scene force vectors / axes / rays are figure ink (pencil + SHAPE_STROKE_WIDTH).
          // Transient FOCUS traces and ordinary teaching arrows stay annotations.
          const inkArrow = async (path: string) => {
            if (trustedDiagramGeometry && command.visualStyle?.strokeRole !== "trace") {
              await drawShape(path, drawMs);
              return;
            }
            if (command.visualStyle?.strokeRole === "trace") {
              await drawAnnotation(annotationKind, path, drawMs, {
                strokeWidth: command.visualStyle.strokeWidth ?? 1.25,
                transient: true,
              });
              return;
            }
            await drawAnnotation(annotationKind, path, drawMs);
          };

          if (command.type === "UNDERLINE" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (commandCancelled()) return;
              await drawAnnotation(
                annotationKind,
                underlinePath(x1, y1, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "CIRCLE_AROUND" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y, flightMs);
              if (commandCancelled()) return;
              await drawAnnotation(
                annotationKind,
                emphasisEllipsePath(x, y, w, h),
                drawMs,
              );
            }
          } else if (command.type === "ARROW" && params.length >= 6) {
            const [x1, y1, cx, cy, x2, y2] = params;
            if ([x1, y1, cx, cy, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (commandCancelled()) return;
              await inkArrow(curvedArrowPath(x1, y1, cx, cy, x2, y2));
            }
          } else if (command.type === "ARROW" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (commandCancelled()) return;
              await inkArrow(arrowPath(x1, y1, x2, y2));
            }
          } else if (command.type === "HIGHLIGHT" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y + h / 2, flightMs);
              if (commandCancelled()) return;
              // Shading a diagram region is geometry, not text markup: it keeps
              // the quiet region wash so it never buries the figure under it.
              // Highlighter yellow is reserved for marking up written work.
              const region = command.visualStyle?.fillRole === "region";
              await drawAnnotation(
                annotationKind,
                highlightRectPath(x, y, w, h),
                drawMs,
                region ? { fillColor: "#9CCBFF", fillOpacity: 0.18 } : undefined,
              );
            }
          } else if (command.type === "SCRIBBLE" && params.length >= 4) {
            if (params.every(Number.isFinite)) {
              const [x1, y1] = params;
              await wb.flyCursorTo(x1, y1, flightMs);
              if (commandCancelled()) return;
              // Cross-outs stay thin and compact so they do not bury the glyph.
              await drawAnnotation(
                annotationKind,
                scribblePath(params),
                Math.min(drawMs, 280),
                { strokeWidth: 1.55 },
              );
            }
          }

          tel?.mark("annotate-complete", { type: command.type, snapped });
          break;
        }
      }

      tutorDebug("draw", "executeCommand done", { type: command.type });
    },
    [
      activeVerifiedDiagramRef,
      boardLayoutRef,
      cancelRef,
      cancellableDelay,
      fbdPhaseMarkedRef,
      fbdPhaseStartedRef,
      forgetErasedTextRects,
      resetBoardLayout,
      resolveAnnotationTarget,
      resolveTextPlacement,
      speedRef,
      inkPaceRef,
      adaptiveFactorRef,
      turnTelemetryRef,
      whiteboardRef,
      codeLessonControllerRef,
    ],
  );

  const executeCommandWithCancel = useCallback(
    async (
      command: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
        segmentNarration?: string;
        speechShareMs?: number;
        trustedDiagramGeometry?: boolean;
        segmentIndex?: number;
        isCancelled?: () => boolean;
        textPlacementReserved?: boolean;
        inkPace?: InkPace;
      } = {},
    ): Promise<void> => {
      await raceWithCancel(executeCommand(command, options));
    },
    [executeCommand, raceWithCancel],
  );

  return { executeCommand, executeCommandWithCancel, resolveAnnotationTarget };
}

function verifiedCommandTracePath(
  command: VerifiedDiagramCommand,
): { path: string; x: number; y: number } | null {
  const params = command.params;
  switch (command.type) {
    case "DRAW_CUBOID": {
      const [x, y, width, height, depth] = params;
      return [x, y, width, height, depth].every(Number.isFinite)
        ? { path: cuboidPath(x!, y!, width!, height!, depth!), x: x!, y: y! }
        : null;
    }
    case "DRAW_CUBE": {
      const [x, y, size] = params;
      return [x, y, size].every(Number.isFinite)
        ? { path: cubePath(x!, y!, size!), x: x!, y: y! }
        : null;
    }
    case "DRAW_RECT": {
      const [x, y, width, height] = params;
      return [x, y, width, height].every(Number.isFinite)
        ? { path: rectPath(x!, y!, width!, height!), x: x!, y: y! }
        : null;
    }
    case "DRAW_CIRCLE": {
      const [x, y, radius, radiusY] = params;
      if (![x, y, radius].every(Number.isFinite)) return null;
      return {
        path: Number.isFinite(radiusY)
          ? ellipsePath(x!, y!, radius!, radiusY!)
          : circlePath(x!, y!, radius!),
        x: x! + radius!,
        y: y!,
      };
    }
    case "DRAW_ARC": {
      const [x, y, radius, startAngle, endAngle] = params;
      if (![x, y, radius, startAngle, endAngle].every(Number.isFinite)) return null;
      const startRadians = startAngle! * Math.PI / 180;
      return {
        path: arcPath(x!, y!, radius!, startAngle!, endAngle!),
        x: x! + radius! * Math.cos(startRadians),
        y: y! + radius! * Math.sin(startRadians),
      };
    }
    case "DRAW_POINT": {
      const [x, y, radius = 2] = params;
      if (![x, y].every(Number.isFinite)) return null;
      const mark = Math.max(radius, 10);
      return {
        path: emphasisEllipsePath(x! - mark, y! - mark, mark * 2, mark * 2),
        x: x!,
        y: y!,
      };
    }
    case "DRAW_LINE": {
      if (params.length >= 7 && params.at(-1) === 2) {
        const points = params.slice(0, -1);
        return points.every(Number.isFinite)
          ? { path: bezierSplinePath(points), x: points[0]!, y: points[1]! }
          : null;
      }
      if (params.length >= 6 && params.length % 2 === 0) {
        return params.every(Number.isFinite)
          ? { path: polylinePath(params), x: params[0]!, y: params[1]! }
          : null;
      }
      const [x1, y1, x2, y2] = params;
      return [x1, y1, x2, y2].every(Number.isFinite)
        ? { path: linePath(x1!, y1!, x2!, y2!), x: x1!, y: y1! }
        : null;
    }
    case "ARROW": {
      const [x1, y1, a, b, x2, y2] = params;
      if (params.length >= 6 && [x1, y1, a, b, x2, y2].every(Number.isFinite)) {
        return {
          path: curvedArrowPath(x1!, y1!, a!, b!, x2!, y2!),
          x: x1!,
          y: y1!,
        };
      }
      return [x1, y1, a, b].every(Number.isFinite)
        ? { path: arrowPath(x1!, y1!, a!, b!), x: x1!, y: y1! }
        : null;
    }
    default:
      return null;
  }
}

/** Ink the pen may trace for a focus: the entity's own strokes, never its text or scaffolding. */
function focusTraceCommands(diagram: VerifiedDiagram, entityIds: ReadonlySet<string>): VerifiedDiagramCommand[] {
  return diagram.commands.filter((candidate) =>
    candidate.semanticRef?.entityId &&
    entityIds.has(candidate.semanticRef.entityId) &&
    !candidate.semanticRef?.actionId &&
    candidate.visualStyle?.strokeRole !== "trace" &&
    candidate.type !== "LABEL" &&
    candidate.type !== "WRITE" &&
    candidate.type !== "DIMENSION",
  );
}

function anchorRingPath(anchor: VerifiedDiagramAnchor): FocusTracePath {
  return {
    path: emphasisEllipsePath(anchor.x - 4, anchor.y - 4, anchor.width + 8, anchor.height + 8),
    x: anchor.x + anchor.width / 2,
    y: anchor.y,
  };
}

/**
 * One scheduled target per spoken window, in the schedule's order. Every
 * anchor a window names gets its own trace: the strokes it owns, or a ring
 * round it when it owns none, which is how a withheld dimension or a bare
 * point still gets a gesture instead of nothing. Anchors the tag asked for
 * that the schedule never placed run last, after the final window, so
 * nothing the tag named is left unlettered.
 */
function scheduledFocusTargets(
  diagram: VerifiedDiagram,
  requested: readonly VerifiedDiagramAnchor[],
  schedule: FocusTargetSchedule,
  floorMs: number,
  letterFor: (
    id: string,
    entityIds: readonly string[],
    window: FocusTargetSchedule["targets"][number],
  ) => ScheduledFocusTarget["letter"],
): ScheduledFocusTarget[] {
  const covered = new Set<string>();
  const build = (
    window: FocusTargetSchedule["targets"][number],
    anchors: readonly VerifiedDiagramAnchor[],
  ): ScheduledFocusTarget => {
    const ids = new Set(anchors.map((anchor) => anchor.id));
    const ink = focusTraceCommands(diagram, ids);
    const paths = anchors
      .flatMap((anchor) => {
        const own = ink
          .filter((candidate) => candidate.semanticRef?.entityId === anchor.id)
          .map(verifiedCommandTracePath)
          .filter((candidate): candidate is FocusTracePath => candidate !== null);
        return own.length > 0 ? own : [anchorRingPath(anchor)];
      })
      .slice(0, 8);
    const pulse = compactPulseBox(anchors[0]!, ink);
    return {
      id: window.id,
      startMs: window.startMs,
      endMs: window.endMs,
      rects: anchors.map(({ x, y, width, height }) => ({ x, y, width, height })),
      paths,
      pulse: {
        path: emphasisEllipsePath(pulse.x, pulse.y, pulse.width, pulse.height),
        x: pulse.x + pulse.width / 2,
        y: pulse.y,
      },
      letter: letterFor(window.id, [window.id, ...anchors.map((anchor) => anchor.id)], window),
    };
  };
  const targets: ScheduledFocusTarget[] = [];
  for (const window of schedule.targets) {
    const anchors = resolveVerifiedDiagramFocusTargets(
      { type: "FOCUS", params: [], text: window.id, charPosition: 0, narrationBefore: "", semanticRef: { entityId: window.id } },
      diagram,
    );
    if (anchors.length === 0) continue;
    for (const anchor of anchors) covered.add(anchor.id);
    targets.push(build(window, anchors));
  }
  const uncovered = requested.filter((anchor) => !covered.has(anchor.id));
  if (uncovered.length > 0) {
    const lastEndMs = targets.at(-1)?.endMs ?? 0;
    targets.push(build(
      {
        id: uncovered.map((anchor) => anchor.id).join(","),
        startMs: lastEndMs,
        endMs: lastEndMs + floorMs,
        anchor: "proportional",
      },
      uncovered,
    ));
  }
  return targets;
}

function compactPulseBox(
  target: { x: number; y: number; width: number; height: number },
  commands: VerifiedDiagramCommand[],
): { x: number; y: number; width: number; height: number } {
  const point = commands.find((command) => command.type === "DRAW_POINT");
  if (point && [point.params[0], point.params[1]].every(Number.isFinite)) {
    return { x: point.params[0]! - 12, y: point.params[1]! - 12, width: 24, height: 24 };
  }
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const width = Math.min(Math.max(target.width + 10, 22), 56);
  const height = Math.min(Math.max(target.height + 10, 22), 56);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

const UNCOMPILED_STRUCTURAL_TYPES = new Set<DrawCommand["type"]>([
  "DRAW_CUBOID",
  "DRAW_CUBE",
  "DRAW_RECT",
  "DRAW_CIRCLE",
  "DRAW_ARC",
  "DRAW_POINT",
  "DRAW_LINE",
  "LABEL",
  "UNDERLINE",
  "CIRCLE_AROUND",
  "ARROW",
  "HIGHLIGHT",
  "SCRIBBLE",
  "DIMENSION",
]);

function isUnsafeUncompiledDiagramCommand(command: DrawCommand): boolean {
  if (!UNCOMPILED_STRUCTURAL_TYPES.has(command.type)) return false;
  const [x = 0, y = 0, a = 0, b = 0] = command.params;
  let bounds = { left: x, top: y, right: x, bottom: y };

  if (command.type === "DRAW_RECT") {
    bounds = { left: x, top: y, right: x + Math.abs(a), bottom: y + Math.abs(b) };
  } else if (
    command.type === "DRAW_CIRCLE" ||
    command.type === "DRAW_ARC" ||
    command.type === "DRAW_POINT"
  ) {
    bounds = { left: x - Math.abs(a), top: y - Math.abs(a), right: x + Math.abs(a), bottom: y + Math.abs(a) };
  } else if (command.type === "DRAW_CUBE" || command.type === "DRAW_CUBOID") {
    bounds = { left: x, top: y - Math.abs(b || a), right: x + Math.abs(a), bottom: y };
  } else if (command.type === "DRAW_LINE" || command.type === "ARROW" || command.type === "DIMENSION") {
    const coordinateCount = command.type === "DIMENSION" ? 4 : command.params.length % 2 === 1 ? command.params.length - 1 : command.params.length;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let index = 0; index + 1 < coordinateCount; index += 2) {
      xs.push(command.params[index]!);
      ys.push(command.params[index + 1]!);
    }
    bounds = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }

  const zoneRight = DIAGRAM_ZONE.x + DIAGRAM_ZONE.width;
  const zoneBottom = DIAGRAM_ZONE.y + DIAGRAM_ZONE.height;
  return (
    bounds.right >= DIAGRAM_ZONE.x &&
    bounds.left <= zoneRight &&
    bounds.bottom >= DIAGRAM_ZONE.y &&
    bounds.top <= zoneBottom
  );
}
