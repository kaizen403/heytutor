"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveApiUrl } from "@heytutor/tutor-core";
import { BoardCreationError, createBoardWithTitle, deleteBoardApi, fetchBoardDetail, fetchBoards, requestBoardTitle, updateBoard } from "@/lib/boards/boardsClient";
import type { BoardEntry } from "@/lib/boards/types";
import type { TutorPhase } from "@/features/tutor-session/types";
import {
  drainLectureJobs,
  DEFAULT_CONCURRENT_LECTURES,
  JOB_TIMEOUT_MS,
  makeLectureJobs,
  nextQueuedJobs,
  shouldKeepHeadlessRuntime,
  type LectureJob,
} from "../lib/lectureJobs";
import {
  attachLectureRuntime,
  detachLectureRuntime,
  type HeadlessRuntime,
} from "../lib/lectureIsolation";
import {
  forgetLectureBoard,
  parsePlaygroundBoardTitle,
  rememberLectureBoard,
  readLectureBoardIndex,
} from "../lib/playgroundBoards";
import type { ProbeQuestion } from "../lib/probes";
import { updatePlaygroundLecture } from "../lib/playgroundClient";

type JobOutcome = { status: "complete" } | { status: "failed"; error: string };


async function adoptLegacyPlaygroundBoards(boards: BoardEntry[]): Promise<BoardEntry[]> {
  const remembered = readLectureBoardIndex();
  const adopted: BoardEntry[] = [];
  // Bounded work: ordinary student boards are never inspected or discarded.
  for (const board of boards) {
    const meta = board.playground ?? parsePlaygroundBoardTitle(board.title) ?? remembered.get(board.id);
    if (!meta) { adopted.push(board); continue; }
    let playground = board.playground;
    try {
      if (!playground || (playground.state === "complete" && playground.checkedUpdatedAt !== board.updatedAt) || (playground.state === "running" && Date.now() - board.createdAt > JOB_TIMEOUT_MS)) {
        playground = (await updatePlaygroundLecture(board.id, {
          action: "inspect", meta: { ...meta, state: "running" },
        })).playground;
      }
      if (playground.state === "discarded") {
        if (await deleteBoardApi(board.id)) forgetLectureBoard(board.id);
        continue;
      }
      rememberLectureBoard(board.id, meta);
      adopted.push({ ...board, playground });
    } catch {
      // Unknown is not complete. Retry on the next refresh without deleting it.
      if (playground?.state === "complete" && playground.checkedUpdatedAt === board.updatedAt) adopted.push(board);
    }
  }
  return adopted;
}

export function useLectureQueue() {
  const [jobs, setJobs] = useState<LectureJob[]>([]);
  const [runtimes, setRuntimes] = useState<HeadlessRuntime[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENT_LECTURES);

  const jobsRef = useRef<LectureJob[]>([]);
  const boardReadRevisionRef = useRef(0);
  const stopRef = useRef(false);
  const generationRef = useRef(0);
  const pumpingRef = useRef<number | null>(null);
  const settleByJobRef = useRef(new Map<string, (outcome: JobOutcome) => void>());
  const readyByJobRef = useRef(new Map<string, (boardId: string, question: string) => void>());
  const lastQuestionsRef = useRef<ProbeQuestion[]>([]);
  const lastInteractiveRef = useRef(false);
  const heldBoardIdRef = useRef<string | null>(null);
  const [lastBatchCount, setLastBatchCount] = useState(0);
  const concurrencyRef = useRef(concurrency);
  const aliveRef = useRef(true);

  useEffect(() => {
    concurrencyRef.current = concurrency;
  }, [concurrency]);

  useEffect(() => {
    aliveRef.current = true;
    // Hold the map itself: by cleanup time the ref may point elsewhere, and
    // the pending jobs that need settling are the ones captured here.
    const settleByJob = settleByJobRef.current;
    const readyByJob = readyByJobRef.current;
    return () => {
      aliveRef.current = false;
      stopRef.current = true;
      generationRef.current += 1;
      for (const finish of settleByJob.values()) {
        finish({ status: "failed", error: "stopped" });
      }
      settleByJob.clear();
      readyByJob.clear();
    };
  }, []);

  const syncJobs = useCallback((next: LectureJob[]) => {
    jobsRef.current = next;
    if (aliveRef.current) {
      setJobs(next);
    }
  }, []);

  const patchJob = useCallback((id: string, patch: Partial<LectureJob>) => {
    syncJobs(jobsRef.current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }, [syncJobs]);

  const refreshBoards = useCallback(async (generation?: number) => {
    const revision = ++boardReadRevisionRef.current;
    const list = await fetchBoards();
    const adopted = await adoptLegacyPlaygroundBoards(list);
    if (aliveRef.current && revision === boardReadRevisionRef.current && (generation === undefined || generation === generationRef.current)) {
      setBoards(adopted);
      const recovered = new Set(adopted.filter(board => board.playground?.state === "complete").map(board => board.id));
      syncJobs(jobsRef.current.map(job => job.status === "failed" && job.boardId && recovered.has(job.boardId)
        ? { ...job, status: "complete", error: undefined }
        : job));
    }
  }, [syncJobs]);

  useEffect(() => {
    void refreshBoards().catch(() => {});
    const timer = window.setInterval(() => { void refreshBoards().catch(() => {}); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshBoards]);

  const isBusy = useMemo(
    () => jobs.some((job) => job.status === "queued" || job.status === "running"),
    [jobs],
  );

  useEffect(() => {
    if (!isBusy) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    try {
      const source = "setInterval(() => postMessage(Date.now()), 250)";
      workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = () => {
        if (aliveRef.current) {
          setNow(Date.now());
        }
      };
    } catch {
      // Workers are unavailable in some test environments; the interval still ticks.
    }
    return () => {
      window.clearInterval(timer);
      worker?.terminate();
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
    };
  }, [isBusy]);

  const waitForOutcome = useCallback((jobId: string, timeoutMs: number) => {
    return new Promise<JobOutcome>((resolve) => {
      let done = false;
      const finish = (outcome: JobOutcome) => {
        if (done) {
          return;
        }
        done = true;
        window.clearTimeout(timer);
        settleByJobRef.current.delete(jobId);
        resolve(outcome);
      };
      const timer = window.setTimeout(() => {
        finish({ status: "failed", error: "timed out" });
      }, timeoutMs);
      settleByJobRef.current.set(jobId, finish);
    });
  }, []);

  const nameLectureBoard = useCallback(
    (jobId: string, boardId: string, question: string, currentTitle: string, generation: number) => {
      void requestBoardTitle(question).then(async (named) => {
        if (!aliveRef.current || generation !== generationRef.current || stopRef.current || !named || named === currentTitle) {
          return;
        }
        patchJob(jobId, { title: named });
        await updateBoard(boardId, { title: named });
        if (generation === generationRef.current && !stopRef.current) {
          await refreshBoards(generation);
        }
      });
    },
    [patchJob, refreshBoards],
  );

  const discardUnusedBoard = useCallback(async (board: BoardEntry, job: LectureJob) => {
    const inUse = () => heldBoardIdRef.current === board.id || jobsRef.current.some((entry) => entry.boardId === board.id);
    const preserve = () => {
      rememberLectureBoard(board.id, { topicId: job.topicId, difficulty: job.difficulty });
      if (aliveRef.current) void refreshBoards().catch(() => {});
    };
    if (inUse()) return;
    try {
      // A saved turn or preview makes this a recording, not an empty orphan.
      const detail = await fetchBoardDetail(board.id);
      if (inUse()) return;
      if (!detail || detail.turns.length > 0 || detail.board.preview.trim()) {
        preserve();
        return;
      }
      // Only orphan cleanup is conditional; explicit removal remains unconditional.
      const deleted = await fetch(resolveApiUrl(`/api/boards/${board.id}?ifEmpty=1`), { method: "DELETE" });
      if (!deleted.ok) preserve();
    } catch {
      // Uncertain inspection or deletion must never cause us to forget a board.
      preserve();
    }
  }, [refreshBoards]);

  const discardPartialBoard = useCallback(async (boardId: string) => {
    boardReadRevisionRef.current++;
    if (aliveRef.current) {
      setRuntimes(current => detachLectureRuntime(current, { boardId }));
      setBoards(current => current.filter(board => board.id !== boardId));
    }
    try {
      // Persist the exclusion first so a failed DELETE cannot revive a partial run.
      await updatePlaygroundLecture(boardId, { action: "discard" });
      if (await deleteBoardApi(boardId)) forgetLectureBoard(boardId);
    } catch {
      // Running/unverified records are excluded too. A later refresh retries cleanup.
    }
  }, []);

  const runJob = useCallback(
    async (job: LectureJob, generation: number) => {
      const isCurrent = () => aliveRef.current && generation === generationRef.current && !stopRef.current;
      const startedAt = Date.now();
      patchJob(job.id, { status: "running", startedAt, phase: "idle", error: undefined });

      // Begin the deadline before POST; stop/timeout releases the pump even
      // when board creation has not returned.
      const settled = { outcome: null as JobOutcome | null };
      const outcomePromise = waitForOutcome(job.id, JOB_TIMEOUT_MS).then((outcome) => {
        settled.outcome = outcome;
        return outcome;
      });
      let creationError = "could not create board";
      const boardPromise = createBoardWithTitle(job.title, {
        topicId: job.topicId, difficulty: job.difficulty, probeId: job.probeId, state: "running",
      }).catch((error: unknown) => {
        if (error instanceof BoardCreationError) creationError = error.message;
        return null;
      });
      const first = await Promise.race([
        boardPromise.then((board) => ({ kind: "board" as const, board })),
        outcomePromise.then((outcome) => ({ kind: "outcome" as const, outcome })),
      ]);
      if (first.kind === "outcome") {
        // A late response still needs safe disposal after the pump moves on.
        void boardPromise.then((board) => { if (board) void discardUnusedBoard(board, job); });
      }
      if (!isCurrent()) {
        if (first.kind === "board" && first.board) void discardUnusedBoard(first.board, job);
        return;
      }
      if (first.kind === "outcome") {
        readyByJobRef.current.delete(job.id);
        patchJob(job.id, { status: first.outcome.status, error: first.outcome.status === "failed" ? first.outcome.error : undefined, endedAt: Date.now() });
        return;
      }
      const board = first.board;
      if (!board) {
        settleByJobRef.current.get(job.id)?.({ status: "failed", error: creationError });
        readyByJobRef.current.delete(job.id);
        patchJob(job.id, {
          status: "failed",
          error: creationError,
          endedAt: Date.now(),
        });
        return;
      }
      if (settled.outcome) {
        void discardUnusedBoard(board, job);
        readyByJobRef.current.delete(job.id);
        patchJob(job.id, { status: settled.outcome.status, error: settled.outcome.status === "failed" ? settled.outcome.error : undefined, endedAt: Date.now() });
        return;
      }

      rememberLectureBoard(board.id, { topicId: job.topicId, difficulty: job.difficulty });
      void nameLectureBoard(job.id, board.id, job.question, job.title, generation);
      patchJob(job.id, { boardId: board.id });
      const runtime: HeadlessRuntime = {
        jobId: job.id,
        boardId: board.id,
        question: job.question,
        interactive: job.interactive,
      };
      setRuntimes((current) => isCurrent() ? attachLectureRuntime(current, runtime) : current);
      readyByJobRef.current.get(job.id)?.(board.id, job.question);
      readyByJobRef.current.delete(job.id);
      if (!isCurrent()) return;

      let outcome = await outcomePromise;
      if (!isCurrent() || outcome.status === "failed") {
        await discardPartialBoard(board.id);
        if (isCurrent()) patchJob(job.id, {
          status: "failed", error: outcome.status === "failed" ? outcome.error : "stopped",
          endedAt: Date.now(),
        });
        return;
      }
      // The callback says playback ended. Only the persisted full recording can
      // promote a job to complete; previews and in-memory audio cannot do so.
      try {
        const result = await updatePlaygroundLecture(board.id, { action: "complete" });
        if (result.playground.state !== "complete") {
          outcome = { status: "failed", error: result.reason ?? "Incomplete recording discarded" };
        } else if (isCurrent()) {
          boardReadRevisionRef.current++;
          setBoards(current => [...current.filter(entry => entry.id !== board.id), { ...board, playground: result.playground }]);
        }
      } catch (error) {
        // A failed inspection is not proof that saved media is partial. Keep it
        // unlisted for a later inspection, rather than deleting a possible full lesson.
        if (!isCurrent()) { await discardPartialBoard(board.id); return; }
        setRuntimes(current => detachLectureRuntime(current, { boardId: board.id }));
        patchJob(job.id, { status: "failed", error: error instanceof Error ? error.message : "Could not verify recording", endedAt: Date.now() });
        return;
      }
      if (!isCurrent() || outcome.status === "failed") {
        await discardPartialBoard(board.id);
        if (isCurrent()) patchJob(job.id, { status: "failed", error: outcome.status === "failed" ? outcome.error : "stopped", endedAt: Date.now() });
        return;
      }
      const held = shouldKeepHeadlessRuntime(board.id, heldBoardIdRef.current);
      if (!held) setRuntimes(current => detachLectureRuntime(current, { jobId: job.id, boardId: board.id }));
      patchJob(job.id, { status: "complete", error: undefined, endedAt: Date.now(), boardId: board.id });
      await refreshBoards(generation).catch(() => {});

    },
    [discardPartialBoard, discardUnusedBoard, nameLectureBoard, patchJob, refreshBoards, waitForOutcome],
  );

  const pump = useCallback(async (generation: number) => {
    if (pumpingRef.current === generation || generation !== generationRef.current || stopRef.current) {
      return;
    }
    pumpingRef.current = generation;
    const inFlight = new Set<Promise<void>>();
    try {
      const launch = () => {
        if (stopRef.current || generation !== generationRef.current) {
          return;
        }
        const batch = nextQueuedJobs(jobsRef.current, concurrencyRef.current);
        for (const job of batch) {
          const pending = runJob(job, generation).finally(() => {
            inFlight.delete(pending);
          });
          inFlight.add(pending);
        }
      };

      launch();
      while (inFlight.size > 0) {
        await Promise.race(inFlight);
        if (stopRef.current || generation !== generationRef.current) {
          break;
        }
        launch();
      }
    } finally {
      if (pumpingRef.current === generation) {
        pumpingRef.current = null;
      }
      if (generation === generationRef.current && !stopRef.current && jobsRef.current.some((job) => job.status === "queued")) {
        void pump(generation);
      }
    }
  }, [runJob]);

  const enqueue = useCallback(
    (questions: ProbeQuestion[], options?: { interactive?: boolean; onReady?: (boardId: string, question: string) => void }) => {
      if (questions.length === 0) {
        return;
      }
      if (stopRef.current) generationRef.current += 1;
      stopRef.current = false;
      lastQuestionsRef.current = questions;
      lastInteractiveRef.current = options?.interactive === true;
      if (aliveRef.current) {
        setLastBatchCount(questions.length);
      }
      const created = makeLectureJobs(questions, Date.now(), options);
      if (created.length === 1 && options?.onReady) {
        readyByJobRef.current.set(created[0]!.id, options.onReady);
      }
      syncJobs([...jobsRef.current, ...created]);
      void pump(generationRef.current);
    },
    [pump, syncJobs],
  );

  const dropRuntimeIfIdle = useCallback((boardId: string) => {
    const job = jobsRef.current.find((entry) => entry.boardId === boardId);
    if (job?.status === "running") {
      return;
    }
    if (aliveRef.current) {
      setRuntimes((current) => detachLectureRuntime(current, { boardId }));
    }
  }, []);

  const setHeldBoardId = useCallback(
    (boardId: string | null) => {
      const previous = heldBoardIdRef.current;
      heldBoardIdRef.current = boardId;
      if (previous && previous !== boardId) {
        dropRuntimeIfIdle(previous);
      }
    },
    [dropRuntimeIfIdle],
  );

  const startAgain = useCallback((options?: { onReady?: (boardId: string, question: string) => void }) => {
    const questions = lastQuestionsRef.current;
    if (questions.length === 0) {
      return;
    }
    stopRef.current = true;
    generationRef.current += 1;
    readyByJobRef.current.clear();
    heldBoardIdRef.current = null;
    for (const finish of settleByJobRef.current.values()) {
      finish({ status: "failed", error: "stopped" });
    }
    settleByJobRef.current.clear();
    if (aliveRef.current) {
      setRuntimes([]);
    }
    stopRef.current = false;
    const created = makeLectureJobs(questions, Date.now(), { interactive: lastInteractiveRef.current });
    if (created.length === 1 && options?.onReady) {
      readyByJobRef.current.set(created[0]!.id, options.onReady);
    }
    syncJobs(created);
    void pump(generationRef.current);
  }, [pump, syncJobs]);

  const clearJobs = useCallback(() => {
    if (jobsRef.current.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }
    syncJobs([]);
  }, [syncJobs]);

  const stopAll = useCallback(() => {
    stopRef.current = true;
    generationRef.current += 1;
    readyByJobRef.current.clear();
    heldBoardIdRef.current = null;
    for (const finish of settleByJobRef.current.values()) {
      finish({ status: "failed", error: "stopped" });
    }
    settleByJobRef.current.clear();
    if (aliveRef.current) {
      setRuntimes([]);
    }
    syncJobs(drainLectureJobs(jobsRef.current, Date.now()));
  }, [syncJobs]);

  const isRunningJob = useCallback((jobId: string) => {
    return jobsRef.current.some((job) => job.id === jobId && job.status === "running" && !!job.boardId);
  }, []);

  const handlePhase = useCallback(
    (jobId: string, next: TutorPhase) => {
      if (isRunningJob(jobId)) {
        patchJob(jobId, { phase: next });
      }
    },
    [isRunningJob, patchJob],
  );

  const handleComplete = useCallback(
    (jobId: string) => {
      if (!isRunningJob(jobId)) {
        return;
      }
      settleByJobRef.current.get(jobId)?.({ status: "complete" });
    },
    [isRunningJob],
  );

  const handleError = useCallback(
    (jobId: string, error: { message: string }) => {
      if (!isRunningJob(jobId)) {
        return;
      }
      settleByJobRef.current.get(jobId)?.({ status: "failed", error: error.message });
    },
    [isRunningJob],
  );

  const removeRecording = useCallback(async (boardId: string): Promise<boolean> => {
    const recording = jobsRef.current.some(
      (job) => job.boardId === boardId && job.status === "running",
    );
    if (recording) {
      return false;
    }
    const ok = await deleteBoardApi(boardId);
    if (!ok) {
      return false;
    }
    forgetLectureBoard(boardId);
    if (aliveRef.current) {
      setRuntimes((current) => detachLectureRuntime(current, { boardId }));
    }
    syncJobs(
      jobsRef.current.map((job) =>
        job.boardId === boardId ? { ...job, boardId: undefined } : job,
      ),
    );
    if (aliveRef.current) {
      setBoards((current) => current.filter((board) => board.id !== boardId));
    }
    await refreshBoards();
    return true;
  }, [refreshBoards, syncJobs]);

  const removeRecordings = useCallback(async (boardIds: readonly string[]): Promise<{
    deleted: number;
    failed: number;
  }> => {
    let deleted = 0;
    let failed = 0;
    for (const boardId of boardIds) {
      const ok = await removeRecording(boardId);
      if (ok) {
        deleted += 1;
      } else {
        failed += 1;
      }
    }
    return { deleted, failed };
  }, [removeRecording]);

  return {
    jobs,
    runtimes,
    now,
    boards,
    isBusy,
    concurrency,
    setConcurrency,
    lastBatchCount,
    enqueue,
    startAgain,
    clearJobs,
    stopAll,
    refreshBoards,
    removeRecording,
    removeRecordings,
    setHeldBoardId,
    handlePhase,
    handleComplete,
    handleError,
  };
}
