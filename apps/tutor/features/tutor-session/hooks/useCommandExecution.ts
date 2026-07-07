import { useCallback, type RefObject } from "react";
import type { WhiteboardHandle, WriteSchedule, AnnotationKind } from "@heytutor/whiteboard";
import {
  type DrawCommand,
  type DiagramTemplate,
  cuboidPath,
  cubePath,
  rectPath,
  circlePath,
  ellipsePath,
  linePath,
  underlinePath,
  emphasisEllipsePath,
  arrowPath,
  curvedArrowPath,
  highlightRectPath,
  scribblePath,
  bezierSplinePath,
  polylinePath,
  dimensionPath,
  measureTextWidth,
  repairDiagramCommand,
  snapLabelToTemplateAnchor,
  snapGeometryCommand,
  isBlockedTemplateDiagramDraw,
  isDuplicateTemplateDraw,
} from "@heytutor/drawing";
import { getDrawingDuration, getFlightDuration, tutorDebug } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/turnTelemetry";
import type { NotesEpoch } from "@/lib/exportNotesPdf";
import { DIAGRAM_ZONE } from "../constants";
import type { BoardTextRect, BoardLayoutState } from "../types";
import { isInDiagramZone, registerBoardAnchor } from "../lib/boardLayout";
import { resolveSnappedAnnotationParams } from "../lib/annotationSnap";

export interface UseCommandExecutionParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  speedRef: RefObject<number>;
  boardLayoutRef: RefObject<BoardLayoutState>;
  forceSequentialWorkLayoutRef: RefObject<boolean>;
  fbdPhaseMarkedRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  activeDiagramTemplateRef: RefObject<DiagramTemplate | null>;
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
}

export function useCommandExecution({
  whiteboardRef,
  cancelRef,
  speedRef,
  boardLayoutRef,
  fbdPhaseMarkedRef,
  fbdPhaseStartedRef,
  activeDiagramTemplateRef,
  turnTelemetryRef,
  cancellableDelay,
  forgetErasedTextRects,
  resetBoardLayout,
  resolveTextPlacement,
  raceWithCancel,
}: UseCommandExecutionParams) {
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
        activeDiagramTemplateRef.current?.anchors ?? [],
      ),
    [],
  );

  const executeCommand = useCallback(
    async (
      rawCommand: DrawCommand,
      options: {
        durationScale?: number;
        speechDurationMs?: number;
        writeSchedule?: WriteSchedule;
        applyLayout?: boolean;
        segmentNarration?: string;
        skipTemplateDuplicateCheck?: boolean;
        skipGeometrySnap?: boolean;
      } = {},
    ): Promise<void> => {
      const wb = whiteboardRef.current;
      if (!wb || cancelRef.current) return;

      let command = rawCommand;
      const activeTemplate = activeDiagramTemplateRef.current;
      if (activeTemplate) {
        command = repairDiagramCommand(command);
        if (
          !options.skipTemplateDuplicateCheck &&
          isBlockedTemplateDiagramDraw(command, activeTemplate)
        ) {
          turnTelemetryRef.current?.mark("template-draw-blocked", {
            template: activeTemplate.id,
            type: command.type,
            params: command.params,
          });
          tutorDebug("draw", "block llm template diagram draw", {
            template: activeTemplate.id,
            type: command.type,
            params: command.params,
          });
          return;
        }
        if (command.type === "LABEL") {
          command = snapLabelToTemplateAnchor(command, activeTemplate.anchors);
        }
        const beforeGeometrySnap = command;
        // Deterministic template-intro geometry is already exact; only snap
        // LLM-emitted commands so we don't drag precise points off their marks.
        if (!options.skipGeometrySnap) {
          command = snapGeometryCommand(command, activeTemplate);
        }
        if (command.params.join(",") !== beforeGeometrySnap.params.join(",")) {
          const metadata = {
            template: activeTemplate.id,
            type: command.type,
            before: beforeGeometrySnap.params,
            after: command.params,
          };
          turnTelemetryRef.current?.mark("geometry-snap", metadata);
          tutorDebug("draw", "geometry snap applied", metadata);
        }
        if (
          !options.skipTemplateDuplicateCheck &&
          isDuplicateTemplateDraw(command, activeTemplate)
        ) {
          tutorDebug("draw", "skip duplicate template skeleton draw", {
            type: command.type,
            params: command.params,
          });
          return;
        }
      }

      tutorDebug("draw", "executeCommand start", {
        type: command.type,
        text: command.text?.slice(0, 60),
        params: command.params,
        speech_duration_ms: options.speechDurationMs,
        duration_scale: options.durationScale,
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

      // Live voice speed is capped at ElevenLabs' natural 1.2x, so ink pace
      // uses the same cap — otherwise drawing sprints ahead of the narration.
      const effectiveSpeed = () => Math.min(Math.max(speedRef.current, 0.7), 1.2);
      const scaledDuration = (duration: number) =>
        Math.max(Math.round((duration / effectiveSpeed()) * durationScale), 50);

      const speechSplit = (command: DrawCommand) => {
        if (speechDurationMs === undefined) {
          return {
            flightMs: scaledDuration(getFlightDuration(command)),
            drawMs: scaledDuration(getDrawingDuration(command)),
          };
        }

        // speechDurationMs comes from real audio timings, which already reflect
        // the generated voice speed — no extra scaling or ink races ahead.
        const totalMs = Math.max(Math.round(speechDurationMs), 50);
        const flight = getFlightDuration(command);
        const draw = getDrawingDuration(command);
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
            if (cancelRef.current) return;
            await wb.drawShape(cuboidPath(x, y, w, h, d), drawMs);
          }
          break;
        }
        case "DRAW_CUBE": {
          const [x, y, size] = command.params;
          if ([x, y, size].every(Number.isFinite)) {
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(cubePath(x, y, size), drawMs);
          }
          break;
        }
        case "DRAW_RECT": {
          const [x, y, w, h] = command.params;
          if ([x, y, w, h].every(Number.isFinite)) {
            markFbdDiagramStart(x, y);
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(x, y, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(rectPath(x, y, w, h), drawMs);
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
              if (cancelRef.current) return;
              await wb.drawShape(ellipsePath(cx, cy, radius, ry), drawMs);
            }
          } else if ([cx, cy, radius].every(Number.isFinite)) {
            // 3 params [cx, cy, r] → circle
            const { flightMs, drawMs } = speechSplit(command);
            await wb.flyCursorTo(cx + radius, cy, flightMs);
            if (cancelRef.current) return;
            await wb.drawShape(circlePath(cx, cy, radius), drawMs);
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
              if (cancelRef.current) return;
              await wb.drawShape(bezierSplinePath(splinePoints), drawMs);
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
              if (cancelRef.current) return;
              await wb.drawShape(polylinePath(params), drawMs);
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
            if (cancelRef.current) return;
            const lineLength = Math.hypot(x2 - x1, y2 - y1);
            const isDashed = dashedFlag === 1;
            if (isDashed) {
              await wb.drawShape(linePath(x1, y1, x2, y2), drawMs, { dashed: true });
            } else {
              await wb.drawShape(
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
            if (cancelRef.current) return;
            // Thin, dotted measurement bar — a light guide, never a boxed bracket.
            await wb.drawShape(path, drawMs, { dashed: true, strokeWidth: 1.4 });
            if (command.text) {
              const labelDrawMs = scaledDuration(Math.min(Math.max(command.text.length * 38, 420), 1200));
              const labelX = labelCenterX - measureTextWidth(command.text) / 2;
              await wb.flyCursorTo(labelX, labelY, 80, -35);
              if (cancelRef.current) return;
              await wb.writeText(command.text, labelX, labelY, labelDrawMs);
              if (isInDiagramZone(labelX, labelY)) {
                registerBoardAnchor(boardLayoutRef.current, {
                  x: labelX,
                  y: labelY,
                  width: Math.max(measureTextWidth(command.text), 24),
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
          const [x, y] = command.params;
          if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
            const placement = await resolveTextPlacement(
              command,
              x,
              y,
              options.applyLayout !== false,
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
            if (writeSchedule && writeSchedule.charStartOffsetsMs.length > 0) {
              // Scheduled writing: each character is held against the true audio clock so
              // the pen tracks the narration token by token. Keep the approach flight short
              // because the first character's offset already holds the pen until its cue.
              await wb.flyCursorTo(placement.x, placement.y, 60, -35);
              if (cancelRef.current) return;
              await wb.writeText(command.text, placement.x, placement.y, 0, writeSchedule);
            } else {
              const { flightMs, drawMs } = speechSplit(command);
              await wb.flyCursorTo(placement.x, placement.y, flightMs, -35);
              if (cancelRef.current) return;
              await wb.writeText(command.text, placement.x, placement.y, drawMs);
            }
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
            if (cancelRef.current) return;
            await wb.eraseRegion(x, y, w, h, drawMs);
            forgetErasedTextRects({ x, y, width: w, height: h });
          }
          break;
        }
        case "UNDERLINE":
        case "CIRCLE_AROUND":
        case "ARROW":
        case "HIGHLIGHT":
        case "SCRIBBLE": {
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

          const { params, snapped, rect } = resolveAnnotationTarget(
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

          if (command.type === "UNDERLINE" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                underlinePath(x1, y1, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "CIRCLE_AROUND" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                emphasisEllipsePath(x, y, w, h),
                drawMs,
              );
            }
          } else if (command.type === "ARROW" && params.length >= 6) {
            const [x1, y1, cx, cy, x2, y2] = params;
            if ([x1, y1, cx, cy, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                curvedArrowPath(x1, y1, cx, cy, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "ARROW" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                arrowPath(x1, y1, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "HIGHLIGHT" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y + h / 2, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                highlightRectPath(x, y, w, h),
                drawMs,
              );
            }
          } else if (command.type === "SCRIBBLE" && params.length >= 4) {
            if (params.every(Number.isFinite)) {
              const [x1, y1] = params;
              await wb.flyCursorTo(x1, y1, flightMs);
              if (cancelRef.current) return;
              await wb.drawAnnotation(
                annotationKind,
                scribblePath(params),
                drawMs,
              );
            }
          }

          tel?.mark("annotate-complete", { type: command.type, snapped });
          break;
        }
      }

      tutorDebug("draw", "executeCommand done", { type: command.type });
    },
    [cancellableDelay, forgetErasedTextRects, resetBoardLayout, resolveAnnotationTarget, resolveTextPlacement],
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
        skipTemplateDuplicateCheck?: boolean;
        skipGeometrySnap?: boolean;
      } = {},
    ): Promise<void> => {
      await raceWithCancel(executeCommand(command, options));
    },
    [executeCommand, raceWithCancel],
  );

  return { executeCommand, executeCommandWithCancel, resolveAnnotationTarget };
}
