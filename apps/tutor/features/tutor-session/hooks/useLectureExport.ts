"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  createVirtualWhiteboardClock,
  type VirtualWhiteboardClock,
  type WhiteboardHandle,
} from "@heytutor/whiteboard";
import type { VerifiedDiagram } from "@heytutor/drawing";
import type { InkPace } from "@heytutor/tutor-core";
import type { TurnTelemetry } from "@/lib/obs/turnTelemetry";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { storedTurnPageQuestion } from "@/lib/boards/boardContinuation";
import {
  latestLecturePage,
  lectureDownloadFilename,
  lecturePageCacheKey,
  pageHasExportableAudio,
  shouldCancelLectureExport,
} from "@/lib/lecture-export/canExportLectureMp4";
import { downloadBlob } from "@/lib/lecture-export/downloadBlob";
import { getCachedLectureExport, rememberLectureExport } from "@/lib/lecture-export/lectureExportCache";
import {
  exportLectureMp4,
  supportsLectureMp4Encode,
  type LectureExportProgress,
} from "@/lib/lecture-export/exportLectureMp4";
import {
  DEFAULT_LECTURE_FILE_TYPE,
  type LectureFileType,
} from "@/lib/account/lessonSettings";
import type { TutorPhase } from "../types";
import { waitForWhiteboard } from "../lib/board/whiteboardReady";
import { useBoardLayout } from "./useBoardLayout";
import { useCancelControl } from "./useCancelControl";
import { useCommandExecution } from "./useCommandExecution";

const UNSUPPORTED_BROWSER =
  "This browser cannot encode lecture video.";
const NO_AUDIO = "This lecture has no recorded audio to export.";
const BOARD_NOT_READY = "The lecture board is not ready to export yet.";

export type LectureExportApi = {
  exportBoardRef: RefObject<WhiteboardHandle | null>;
  exportBoardMounted: boolean;
  isExportingLecture: boolean;
  lectureExportProgress: LectureExportProgress | null;
  lectureExportError: string | null;
  canDownloadLecture: boolean;
  lectureFileType: LectureFileType;
  downloadLectureMp4: () => void;
  cancelLectureExport: () => void;
};

export function useLectureExport({
  storedTurnsRef,
  storedTurnsCount,
  phase,
  isReplaying,
  sessionId,
  enabled = true,
  lectureFileType = DEFAULT_LECTURE_FILE_TYPE,
}: {
  storedTurnsRef: RefObject<StoredTurn[]>;
  storedTurnsCount: number;
  phase: TutorPhase;
  isReplaying: boolean;
  sessionId: string;
  enabled?: boolean;
  lectureFileType?: LectureFileType;
}): LectureExportApi {
  const exportBoardRef = useRef<WhiteboardHandle | null>(null);
  const exportCancelRef = useRef(false);
  const exportGenerationRef = useRef(0);
  const clockRef = useRef<VirtualWhiteboardClock | null>(null);
  const exportQuestionRef = useRef("");
  const fbdMarkedRef = useRef(false);
  const fbdStartedRef = useRef(false);
  const diagramRef = useRef<VerifiedDiagram | null>(null);
  const telemetryRef = useRef<TurnTelemetry | null>(null);
  const inkPaceRef = useRef<InkPace>("follow");
  const adaptiveFactorRef = useRef(1);
  const speedRef = useRef(1);

  const [exportBoardMounted, setExportBoardMounted] = useState(false);
  const [isExportingLecture, setIsExportingLecture] = useState(false);
  const [lectureExportProgress, setLectureExportProgress] =
    useState<LectureExportProgress | null>(null);
  const [lectureExportError, setLectureExportError] = useState<string | null>(null);

  const canDownloadLecture =
    enabled &&
    phase === "idle" &&
    !isReplaying &&
    !isExportingLecture &&
    storedTurnsCount > 0;

  const { raceWithCancel, clearCancelTimers } = useCancelControl(exportCancelRef);

  const cancellableDelay = useCallback(async (duration: number): Promise<void> => {
    if (exportCancelRef.current) {
      return;
    }
    const clock = clockRef.current;
    if (!clock) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, duration);
      });
      return;
    }
    const start = clock.now();
    while (!exportCancelRef.current && clock.now() - start < duration) {
      await clock.waitForAdvance();
    }
  }, []);

  const {
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    forgetErasedTextRects,
    resolveTextPlacement,
  } = useBoardLayout({
    whiteboardRef: exportBoardRef,
    cancelRef: exportCancelRef,
    fbdPhaseStartedRef: fbdStartedRef,
    liveQuestionRef: exportQuestionRef,
    viewportMode: "fixed",
  });

  const { executeCommandWithCancel } = useCommandExecution({
    whiteboardRef: exportBoardRef,
    cancelRef: exportCancelRef,
    speedRef,
    boardLayoutRef,
    forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef: fbdMarkedRef,
    fbdPhaseStartedRef: fbdStartedRef,
    activeVerifiedDiagramRef: diagramRef,
    turnTelemetryRef: telemetryRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    cancellableDelay,
    forgetErasedTextRects,
    resetBoardLayout,
    resolveTextPlacement,
    raceWithCancel,
    inkPaceRef,
    adaptiveFactorRef,
  });

  const cancelLectureExport = useCallback(() => {
    exportGenerationRef.current += 1;
    exportCancelRef.current = true;
    clearCancelTimers();
    exportBoardRef.current?.cancelAnimations();
  }, [clearCancelTimers]);

  useEffect(() => {
    if (
      shouldCancelLectureExport({
        cancelled: false,
        phase,
        isReplaying,
      })
    ) {
      cancelLectureExport();
    }
  }, [cancelLectureExport, isReplaying, phase]);

  useEffect(() => {
    cancelLectureExport();
  }, [cancelLectureExport, sessionId]);

  const downloadLectureMp4 = useCallback(() => {
    if (!enabled || isExportingLecture) {
      return;
    }
    // The latest page, not the latest turn: a doubt answered under the lesson
    // is recorded on the lesson's page, with its figure and rows above it.
    const pageTurns = latestLecturePage(storedTurnsRef.current);
    const turn = pageTurns[pageTurns.length - 1];
    if (!turn || !pageHasExportableAudio(pageTurns)) {
      setLectureExportError(NO_AUDIO);
      return;
    }
    const pageQuestion = storedTurnPageQuestion(turn);

    const generation = exportGenerationRef.current + 1;
    exportGenerationRef.current = generation;
    exportCancelRef.current = false;
    exportQuestionRef.current = pageQuestion;
    const cacheKey = lecturePageCacheKey(pageTurns, lectureFileType);
    resetBoardLayout(false, false);
    setLectureExportError(null);
    setLectureExportProgress({ currentMs: 0, totalMs: 0, phase: "audio" });
    setIsExportingLecture(true);

    void (async () => {
      try {
        const cached = await getCachedLectureExport(cacheKey);
        if (cached) {
          if (generation !== exportGenerationRef.current) {
            return;
          }
          downloadBlob(cached.blob, lectureDownloadFilename(pageQuestion, cached.extension));
          return;
        }

        setExportBoardMounted(true);

        if (!(await supportsLectureMp4Encode())) {
          setLectureExportError(UNSUPPORTED_BROWSER);
          return;
        }
        if (generation !== exportGenerationRef.current) {
          return;
        }

        const ready = await waitForWhiteboard(exportBoardRef, 12_000);
        if (!ready || generation !== exportGenerationRef.current) {
          if (generation === exportGenerationRef.current) {
            setLectureExportError(BOARD_NOT_READY);
          }
          return;
        }

        const clock = createVirtualWhiteboardClock(0);
        clockRef.current = clock;
        const shouldCancel = () =>
          exportCancelRef.current || generation !== exportGenerationRef.current;

        const result = await exportLectureMp4({
          turn,
          pageTurns,
          whiteboard: exportBoardRef.current!,
          executeCommand: executeCommandWithCancel,
          clock,
          shouldCancel,
          onProgress: setLectureExportProgress,
          preferredContainer: lectureFileType,
        });

        if (shouldCancel()) {
          return;
        }

        rememberLectureExport(cacheKey, {
          blob: result.blob,
          mimeType: result.mimeType,
          extension: result.extension,
        });
        downloadBlob(result.blob, lectureDownloadFilename(pageQuestion, result.extension));
        if (result.missingAudioCues > 0) {
          setLectureExportError("Some audio was missing and was exported as silence.");
        }
      } catch (error) {
        if (generation !== exportGenerationRef.current) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setLectureExportError(
          error instanceof Error ? error.message : "Lecture export failed.",
        );
      } finally {
        clockRef.current = null;
        if (generation === exportGenerationRef.current) {
          setIsExportingLecture(false);
          setLectureExportProgress(null);
          setExportBoardMounted(false);
        }
      }
    })();
  }, [enabled, executeCommandWithCancel, isExportingLecture, lectureFileType, resetBoardLayout, storedTurnsRef]);

  return {
    exportBoardRef,
    exportBoardMounted,
    isExportingLecture,
    lectureExportProgress,
    lectureExportError,
    canDownloadLecture,
    lectureFileType,
    downloadLectureMp4,
    cancelLectureExport,
  };
}
