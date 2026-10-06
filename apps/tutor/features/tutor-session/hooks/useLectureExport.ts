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
import { lecturePageCacheKey } from "@/lib/lecture-export/canExportLectureMp4";
import {
  buildLectureExportSource,
  lectureExportCueBytes,
  lectureExportHasContent,
  lessonDownloadFilename,
  type LiveExportTurn,
} from "@/lib/lecture-export/lectureExportSource";
import { notesPdfBlob } from "@/lib/client/exportNotesPdf";
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
import {
  IDLE_DOWNLOAD,
  downloadIsBusy,
  type DownloadNote,
  type DownloadState,
} from "../lib/download/downloadState";
import {
  INITIAL_DOWNLOAD_MACHINE,
  downloadAutoDismissMs,
  downloadReducer,
  type DownloadEvent,
  type DownloadMachine,
} from "../lib/download/downloadReducer";
import { useBoardLayout } from "./useBoardLayout";
import { useCancelControl } from "./useCancelControl";
import { useCommandExecution } from "./useCommandExecution";

const UNSUPPORTED_BROWSER = "This browser cannot make a video. Try Chrome or Edge.";
const BOARD_NOT_READY = "The video board did not get ready. Try again.";
const NOTHING_YET = "Nothing is on the board yet.";
const VIDEO_FAILED = "The video could not be made. Try again.";
const NOTES_FAILED = "The notes could not be made. Try again.";

export type LectureExportApi = {
  /** What the Download control shows. */
  downloadState: DownloadState;
  /** Video of the whole board from its start to now. */
  downloadVideo: () => void;
  /** Notes PDF of every board page so far. */
  downloadNotesPdf: () => void;
  /** Stops a running video at once; the control is free again immediately. */
  cancelDownload: () => void;
  /** Clears a finished, failed or cancelled state. */
  dismissDownload: () => void;
  /** Something is on the board, so a notes PDF can be made. */
  canDownloadNotes: boolean;

  exportBoardRef: RefObject<WhiteboardHandle | null>;
  exportBoardMounted: boolean;
  /** Legacy: a video export is running. */
  isExportingLecture: boolean;
  /** Legacy: the running video's progress. */
  lectureExportProgress: LectureExportProgress | null;
  /** Legacy: the last video error. */
  lectureExportError: string | null;
  canDownloadLecture: boolean;
  lectureFileType: LectureFileType;
  /** Legacy alias of `downloadVideo`. */
  downloadLectureMp4: () => void;
  /** Legacy alias of `cancelDownload`. */
  cancelLectureExport: () => void;
};

const nextPaint = (): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => window.setTimeout(resolve, 0));
    } else {
      window.setTimeout(resolve, 0);
    }
  });

function videoNote(
  result: { noVoice: boolean; missingAudioCues: number },
  partial: boolean,
): DownloadNote {
  if (result.noVoice) return "no-voice";
  if (result.missingAudioCues > 0) return "some-voice-missing";
  return partial ? "partial" : null;
}

export function useLectureExport({
  storedTurnsRef,
  storedTurnsCount,
  phase,
  sessionId,
  enabled = true,
  lectureFileType = DEFAULT_LECTURE_FILE_TYPE,
  getLiveTurn,
  hasLiveTurn,
  collectNotesSlides,
  title,
}: {
  storedTurnsRef: RefObject<StoredTurn[]>;
  storedTurnsCount: number;
  phase: TutorPhase;
  /** Kept for callers; a replay no longer cancels a download. */
  isReplaying?: boolean;
  sessionId: string;
  enabled?: boolean;
  lectureFileType?: LectureFileType;
  /**
   * The live or just stopped turn: its finished steps, with each clip's bytes
   * in memory. Read once per click.
   */
  getLiveTurn?: () => LiveExportTurn | null;
  /** A live or stopped turn has at least one finished step on the board. */
  hasLiveTurn?: boolean;
  /** Board pages in teaching order, the page on screen last (`useReplay`). */
  collectNotesSlides?: () => Promise<string[]>;
  /** Board title for the file name. Defaults to the first lesson's question. */
  title?: string;
}): LectureExportApi {
  const exportBoardRef = useRef<WhiteboardHandle | null>(null);
  const exportCancelRef = useRef(false);
  const clockRef = useRef<VirtualWhiteboardClock | null>(null);
  const exportQuestionRef = useRef("");
  const fbdMarkedRef = useRef(false);
  const fbdStartedRef = useRef(false);
  const diagramRef = useRef<VerifiedDiagram | null>(null);
  const telemetryRef = useRef<TurnTelemetry | null>(null);
  const inkPaceRef = useRef<InkPace>("follow");
  const adaptiveFactorRef = useRef(1);
  const speedRef = useRef(1);
  const phaseRef = useRef<TutorPhase>(phase);
  const machineRef = useRef<DownloadMachine>(INITIAL_DOWNLOAD_MACHINE);

  const [downloadState, setDownloadState] = useState<DownloadState>(IDLE_DOWNLOAD);
  const [exportBoardMounted, setExportBoardMounted] = useState(false);
  const [lectureExportProgress, setLectureExportProgress] =
    useState<LectureExportProgress | null>(null);
  const [lectureExportError, setLectureExportError] = useState<string | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const dispatch = useCallback((event: DownloadEvent): DownloadMachine => {
    const next = downloadReducer(machineRef.current, event);
    if (next !== machineRef.current) {
      machineRef.current = next;
      setDownloadState(next.view);
    }
    return next;
  }, []);

  const busy = downloadIsBusy(downloadState);
  const isExportingLecture = downloadState.kind === "video";
  const boardHasLesson =
    storedTurnsCount > 0 || hasLiveTurn === true || (getLiveTurn != null && phase !== "idle");
  const canDownloadLecture = enabled && !busy && boardHasLesson;
  const canDownloadNotes = collectNotesSlides != null && !busy && boardHasLesson;

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

  const exportNowMs = useCallback(
    () => clockRef.current?.now() ?? performance.now(),
    [],
  );

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
    nowMs: exportNowMs,
  });

  /** Stops the pipeline: every wait on the export clock re-checks and returns. */
  const stopPipeline = useCallback(() => {
    exportCancelRef.current = true;
    clearCancelTimers();
    exportBoardRef.current?.cancelAnimations();
    clockRef.current?.pump();
  }, [clearCancelTimers]);

  const releaseControl = useCallback(() => {
    setLectureExportProgress(null);
    setExportBoardMounted(false);
  }, []);

  const cancelDownload = useCallback(() => {
    const before = machineRef.current;
    dispatch({ type: "cancel" });
    if (before.view.kind === "video") {
      stopPipeline();
      releaseControl();
    }
  }, [dispatch, releaseControl, stopPipeline]);

  const dismissDownload = useCallback(() => {
    dispatch({ type: "dismiss" });
    setLectureExportError(null);
  }, [dispatch]);

  // Leaving the board ends any run on it. A lesson starting or stopping does not.
  useEffect(() => {
    return () => {
      dispatch({ type: "reset" });
      stopPipeline();
      releaseControl();
      setLectureExportError(null);
    };
  }, [dispatch, releaseControl, sessionId, stopPipeline]);

  useEffect(() => {
    const ms = downloadAutoDismissMs(downloadState);
    if (ms == null) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "dismiss" });
    }, ms);
    return () => window.clearTimeout(timer);
  }, [dispatch, downloadState]);

  const snapshotSource = useCallback(
    () =>
      buildLectureExportSource({
        storedTurns: storedTurnsRef.current ?? [],
        liveTurn: getLiveTurn?.() ?? null,
      }),
    [getLiveTurn, storedTurnsRef],
  );

  const fileTitle = useCallback(
    (turns: readonly StoredTurn[]): string => {
      const named = title?.trim();
      if (named) return named;
      const first = turns[0];
      return first ? storedTurnPageQuestion(first) : "Lesson";
    },
    [title],
  );

  const downloadVideo = useCallback(() => {
    if (!enabled || downloadIsBusy(machineRef.current.view)) {
      return;
    }
    // A snapshot at the click: rows the live lesson adds later, or a clip it
    // releases, cannot change or starve this file.
    const source = snapshotSource();
    const turns = source.turns;
    const partial = source.partial || phaseRef.current !== "idle";
    const started = dispatch({ type: "start", file: "video", partial });
    const generation = started.generation;
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn || !lectureExportHasContent(source)) {
      dispatch({ type: "error", generation, message: NOTHING_YET });
      return;
    }
    const name = fileTitle(turns);

    exportCancelRef.current = false;
    exportQuestionRef.current = storedTurnPageQuestion(lastTurn);
    const cacheKey = lecturePageCacheKey(turns, lectureFileType);
    const current = () => machineRef.current.generation === generation;
    const shouldCancel = () => exportCancelRef.current || !current();
    resetBoardLayout(false, false);
    setLectureExportError(null);
    setLectureExportProgress({ currentMs: 0, totalMs: 0, phase: "audio" });

    const fail = (message: string) => {
      if (!current()) return;
      setLectureExportError(message);
      dispatch({ type: "error", generation, message });
    };

    void (async () => {
      try {
        const cached = partial ? null : await getCachedLectureExport(cacheKey);
        if (cached) {
          if (!current()) return;
          downloadBlob(cached.blob, lessonDownloadFilename(name, cached.extension, false));
          dispatch({ type: "done", generation, note: null });
          return;
        }

        setExportBoardMounted(true);

        if (!(await supportsLectureMp4Encode())) {
          fail(UNSUPPORTED_BROWSER);
          return;
        }
        if (!current()) return;

        const ready = await waitForWhiteboard(exportBoardRef, 12_000);
        if (!current()) return;
        if (!ready || !exportBoardRef.current) {
          fail(BOARD_NOT_READY);
          return;
        }

        const clock = createVirtualWhiteboardClock(0);
        clockRef.current = clock;

        const result = await exportLectureMp4({
          turn: lastTurn,
          pageTurns: turns,
          whiteboard: exportBoardRef.current,
          executeCommand: executeCommandWithCancel,
          clock,
          shouldCancel,
          cueBytes: lectureExportCueBytes(source),
          shouldYield: () => phaseRef.current !== "idle",
          onProgress: (progress) => {
            if (!current()) return;
            setLectureExportProgress(progress);
            dispatch({ type: "progress", generation, progress });
          },
          preferredContainer: lectureFileType,
        });

        if (shouldCancel()) return;
        if (result.tailTruncated) {
          console.warn("Lecture export: the drawing ran past the tail limit; the file ends there.");
        }

        if (!partial) {
          rememberLectureExport(cacheKey, {
            blob: result.blob,
            mimeType: result.mimeType,
            extension: result.extension,
          });
        }
        downloadBlob(result.blob, lessonDownloadFilename(name, result.extension, partial));
        dispatch({ type: "done", generation, note: videoNote(result, partial) });
      } catch (error) {
        if (!current()) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Lecture export failed:", error);
        fail(VIDEO_FAILED);
      } finally {
        if (current()) {
          clockRef.current = null;
          releaseControl();
        }
      }
    })();
  }, [
    dispatch,
    enabled,
    executeCommandWithCancel,
    fileTitle,
    lectureFileType,
    releaseControl,
    resetBoardLayout,
    snapshotSource,
  ]);

  const downloadNotesPdf = useCallback(() => {
    if (!collectNotesSlides || downloadIsBusy(machineRef.current.view)) {
      return;
    }
    const source = snapshotSource();
    const partial = source.partial || phaseRef.current !== "idle";
    const generation = dispatch({ type: "start", file: "pdf", partial }).generation;
    const current = () => machineRef.current.generation === generation;
    const name = fileTitle(source.turns);

    void (async () => {
      try {
        // Let the control paint before the capture and jsPDF hold the thread.
        await nextPaint();
        const images = await collectNotesSlides();
        if (!current()) return;
        if (images.length === 0) {
          dispatch({ type: "error", generation, message: NOTHING_YET });
          return;
        }
        dispatch({ type: "pdf-stage", generation, stage: "writing" });
        await nextPaint();
        if (!current()) return;
        const blob = notesPdfBlob(images);
        if (!blob) {
          dispatch({ type: "error", generation, message: NOTHING_YET });
          return;
        }
        downloadBlob(blob, lessonDownloadFilename(name, "pdf", partial));
        dispatch({ type: "done", generation, note: partial ? "partial" : null });
      } catch (error) {
        console.error("Notes PDF export failed:", error);
        if (current()) {
          dispatch({ type: "error", generation, message: NOTES_FAILED });
        }
      }
    })();
  }, [collectNotesSlides, dispatch, fileTitle, snapshotSource]);

  return {
    downloadState,
    downloadVideo,
    downloadNotesPdf,
    cancelDownload,
    dismissDownload,
    canDownloadNotes,
    exportBoardRef,
    exportBoardMounted,
    isExportingLecture,
    lectureExportProgress,
    lectureExportError,
    canDownloadLecture,
    lectureFileType,
    downloadLectureMp4: downloadVideo,
    cancelLectureExport: cancelDownload,
  };
}
