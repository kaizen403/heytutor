import { useCallback, type RefObject } from "react";
import type { WhiteboardHandle, WriteSchedule, AnnotationKind } from "@heytutor/whiteboard";
import {
  type DrawCommand,
  type VerifiedDiagram,
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
  resolveVerifiedDiagramFocusTarget,
} from "@heytutor/drawing";
import {
  getDrawingDuration,
  getFlightDuration,
  selectInkPace,
  effectiveWhiteboardInkSpeed,
  liveInkSpeedCap,
  tutorDebug,
  type InkPace,
} from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
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
      ),
    [boardLayoutRef],
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
        trustedDiagramGeometry?: boolean;
        segmentIndex?: number;
        isCancelled?: () => boolean;
        textPlacementReserved?: boolean;
        inkPace?: InkPace;
      } = {},
    ): Promise<void> => {
      const wb = whiteboardRef.current;
      const commandCancelled = () => cancelRef.current || options.isCancelled?.() === true;
      if (!wb || commandCancelled()) return;
      const trustedDiagramGeometryEarly = options.trustedDiagramGeometry === true;
      const inkPace =
        options.inkPace ??
        selectInkPace(rawCommand, { verifiedDiagramIntro: trustedDiagramGeometryEarly });
      inkPaceRef.current = inkPace;
      if (inkPace === "follow") {
        // Drop inherited scene catch-up so formula strokes stay readable.
        wb.setAnimationSpeed(
          effectiveWhiteboardInkSpeed(
            speedRef.current,
            adaptiveFactorRef.current,
            "follow",
          ),
        );
      }
      const drawShape: WhiteboardHandle["drawShape"] = (path, duration, shapeOptions) => {
        if (rawCommand.visualStyle?.strokeRole === "trace") {
          return wb.drawAnnotation("underline", path, duration, {
            strokeWidth: rawCommand.visualStyle.strokeWidth ?? 1.25,
            transient: true,
            shouldCancel: commandCancelled,
          });
        }
        if (rawCommand.visualStyle?.fillRole === "region") {
          return Promise.all([
            wb.drawAnnotation("highlight", path, duration, {
              fillColor: "#B8D4B8",
              fillOpacity: 0.18,
              shouldCancel: commandCancelled,
            }),
            wb.drawShape(path, duration, {
              ...shapeOptions,
              pace: inkPace,
              strokeWidth: shapeOptions?.strokeWidth ?? rawCommand.visualStyle?.strokeWidth,
              dashed: shapeOptions?.dashed ?? rawCommand.visualStyle?.dashed,
              shouldCancel: commandCancelled,
            }),
          ]).then(() => undefined);
        }
        return wb.drawShape(path, duration, {
          ...shapeOptions,
          pace: inkPace,
          strokeWidth: shapeOptions?.strokeWidth ?? rawCommand.visualStyle?.strokeWidth,
          dashed: shapeOptions?.dashed ?? rawCommand.visualStyle?.dashed,
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

      // Follow ink stays with live voice (ElevenLabs 1.2×). Scene setup may run
      // faster — catch-up still applies on top via useAdaptiveDrawSpeed.
      const effectiveSpeed = () =>
        Math.min(Math.max(speedRef.current, 0.7), liveInkSpeedCap(inkPace));
      const scaledDuration = (duration: number) =>
        Math.max(Math.round((duration / effectiveSpeed()) * durationScale), 50);

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
          const [x, y, radius = 5] = command.params;
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
              const labelX = labelCenterX - measureTextWidth(command.text) / 2;
              await wb.flyCursorTo(labelX, labelY, 80, -35);
              if (commandCancelled()) return;
              await writeText(command.text, labelX, labelY, labelDrawMs);
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
          const [x, y, maybeFontSize] = command.params;
          if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
            const fontSize =
              typeof maybeFontSize === "number" &&
              Number.isFinite(maybeFontSize) &&
              maybeFontSize >= 12 &&
              maybeFontSize <= 40
                ? maybeFontSize
                : 32;
            const placement = options.textPlacementReserved
              ? { x, y }
              : await resolveTextPlacement(
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
            // Build Tegaki paths during the cursor flight so the first spoken
            // character does not wait on handwriting setup.
            prefetchStrokePaths(command.text, placement.x, placement.y, fontSize);
            if (writeSchedule && writeSchedule.charStartOffsetsMs.length > 0) {
              // Scheduled writing: each character is held against the true audio clock so
              // the pen tracks the narration token by token. Keep the approach flight short
              // because the first character's offset already holds the pen until its cue.
              await wb.flyCursorTo(placement.x, placement.y, 60, -35);
              if (commandCancelled()) return;
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
              await writeText(
                command.text,
                placement.x,
                placement.y,
                drawMs,
                undefined,
                fontSize,
              );
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
          const target = resolveVerifiedDiagramFocusTarget(command, activeDiagram);
          if (!target || !activeDiagram) break;
          const targetCommands = activeDiagram.commands.filter((candidate) =>
            candidate.semanticRef?.entityId === target.id &&
            !candidate.semanticRef?.actionId
          );
          const tracePaths = targetCommands
            .map(verifiedCommandTracePath)
            .filter((candidate): candidate is { path: string; x: number; y: number } => candidate !== null);
          const fallback = {
            path: emphasisEllipsePath(target.x - 5, target.y - 5, target.width + 10, target.height + 10),
            x: target.x + target.width / 2,
            y: target.y,
          };
          const paths = tracePaths.length > 0 ? tracePaths.slice(0, 4) : [fallback];
          const focusFloorMs = inkPace === "scene" ? 120 : 420;
          const totalMs = Math.max(speechDurationMs ?? (inkPace === "scene" ? 220 : 900), focusFloorMs);
          for (const candidate of paths) {
            await wb.flyCursorTo(candidate.x, candidate.y, Math.min(160, totalMs / paths.length));
            if (commandCancelled()) return;
            await drawAnnotation(
              "underline",
              candidate.path,
              Math.max(Math.round(totalMs / paths.length) - 160, 220),
              { strokeWidth: 1.25, transient: true },
            );
          }
          turnTelemetryRef.current?.mark("verified-focus-complete", {
            target_id: target.id,
            path_count: paths.length,
          });
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
              await drawAnnotation(
                annotationKind,
                curvedArrowPath(x1, y1, cx, cy, x2, y2),
                drawMs,
              );
            }
          } else if (command.type === "ARROW" && params.length >= 4) {
            const [x1, y1, x2, y2] = params;
            if ([x1, y1, x2, y2].every(Number.isFinite)) {
              await wb.flyCursorTo(x1, y1, flightMs);
              if (commandCancelled()) return;
              await drawAnnotation(
                annotationKind,
                arrowPath(x1, y1, x2, y2),
                drawMs,
                command.visualStyle?.strokeRole === "trace"
                  ? { strokeWidth: command.visualStyle.strokeWidth ?? 1.25, transient: true }
                  : undefined,
              );
            }
          } else if (command.type === "HIGHLIGHT" && params.length >= 4) {
            const [x, y, w, h] = params;
            if ([x, y, w, h].every(Number.isFinite)) {
              await wb.flyCursorTo(x + w / 2, y + h / 2, flightMs);
              if (commandCancelled()) return;
              await drawAnnotation(
                annotationKind,
                highlightRectPath(x, y, w, h),
                drawMs,
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
      const [x, y, radius = 5] = params;
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
