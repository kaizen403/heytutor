"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBoardWithTitle, deleteBoardApi, fetchBoards } from "@/lib/boards/boardsClient";
import type { BoardEntry } from "@/lib/boards/types";
import type { TutorPhase } from "@/features/tutor-session/types";
import {
  drainLectureJobs,
  JOB_TIMEOUT_MS,
  makeLectureJobs,
  MAX_CONCURRENT_LECTURES,
  nextQueuedJobs,
  type LectureJob,
} from "../lib/lectureJobs";
import { playgroundBoardTitle } from "../lib/playgroundBoards";
import type { ProbeQuestion } from "../lib/probes";

export type HeadlessRuntime = {
  jobId: string;
  boardId: string;
  question: string;
};

type JobOutcome = { status: "complete" } | { status: "failed"; error: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useLectureQueue() {
  const [jobs, setJobs] = useState<LectureJob[]>([]);
  const [runtimes, setRuntimes] = useState<HeadlessRuntime[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [concurrency, setConcurrency] = useState(MAX_CONCURRENT_LECTURES);

  const jobsRef = useRef<LectureJob[]>([]);
  const stopRef = useRef(false);
  const pumpingRef = useRef(false);
  const settleByJobRef = useRef(new Map<string, (outcome: JobOutcome) => void>());
  const lastQuestionsRef = useRef<ProbeQuestion[]>([]);
  const [lastBatchCount, setLastBatchCount] = useState(0);
  const concurrencyRef = useRef(concurrency);
  const aliveRef = useRef(true);

  useEffect(() => {
    concurrencyRef.current = concurrency;
  }, [concurrency]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopRef.current = true;
      for (const finish of settleByJobRef.current.values()) {
        finish({ status: "failed", error: "stopped" });
      }
      settleByJobRef.current.clear();
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

  const refreshBoards = useCallback(async () => {
    const list = await fetchBoards();
    if (aliveRef.current) {
      setBoards(list);
    }
  }, []);

  useEffect(() => {
    void refreshBoards();
  }, [refreshBoards]);

  const isBusy = useMemo(
    () => jobs.some((job) => job.status === "queued" || job.status === "running"),
    [jobs],
  );

  useEffect(() => {
    if (!isBusy) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
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

  const runJob = useCallback(
    async (job: LectureJob) => {
      const startedAt = Date.now();
      patchJob(job.id, { status: "running", startedAt, phase: "idle", error: undefined });

      const board = await createBoardWithTitle(playgroundBoardTitle(job.topicId, job.difficulty));
      if (stopRef.current) {
        patchJob(job.id, { status: "failed", error: "stopped", endedAt: Date.now() });
        return;
      }
      if (!board) {
        patchJob(job.id, {
          status: "failed",
          error: "could not create board",
          endedAt: Date.now(),
        });
        return;
      }

      patchJob(job.id, { boardId: board.id });
      if (!aliveRef.current) {
        return;
      }
      const runtime: HeadlessRuntime = { jobId: job.id, boardId: board.id, question: job.question };
      setRuntimes((current) => [...current.filter((entry) => entry.jobId !== job.id), runtime]);

      const outcome = await waitForOutcome(job.id, JOB_TIMEOUT_MS);
      if (aliveRef.current) {
        setRuntimes((current) => current.filter((entry) => entry.jobId !== job.id));
      }
      await delay(100);
      if (!aliveRef.current) {
        return;
      }

      patchJob(job.id, {
        status: outcome.status,
        error: outcome.status === "failed" ? outcome.error : undefined,
        endedAt: Date.now(),
        boardId: board.id,
      });
      await refreshBoards();
    },
    [patchJob, refreshBoards, waitForOutcome],
  );

  const pump = useCallback(async () => {
    if (pumpingRef.current) {
      return;
    }
    pumpingRef.current = true;
    const inFlight = new Set<Promise<void>>();
    try {
      const launch = () => {
        if (stopRef.current) {
          return;
        }
        const batch = nextQueuedJobs(jobsRef.current, concurrencyRef.current);
        for (const job of batch) {
          const pending = runJob(job).finally(() => {
            inFlight.delete(pending);
          });
          inFlight.add(pending);
        }
      };

      launch();
      while (inFlight.size > 0) {
        await Promise.race(inFlight);
        if (stopRef.current) {
          break;
        }
        launch();
      }
    } finally {
      pumpingRef.current = false;
      if (!stopRef.current && jobsRef.current.some((job) => job.status === "queued")) {
        void pump();
      }
    }
  }, [runJob]);

  const enqueue = useCallback(
    (questions: ProbeQuestion[]) => {
      if (questions.length === 0) {
        return;
      }
      stopRef.current = false;
      lastQuestionsRef.current = questions;
      if (aliveRef.current) {
        setLastBatchCount(questions.length);
      }
      const created = makeLectureJobs(questions, Date.now());
      syncJobs([...jobsRef.current, ...created]);
      void pump();
    },
    [pump, syncJobs],
  );

  const startAgain = useCallback(() => {
    const questions = lastQuestionsRef.current;
    if (questions.length === 0) {
      return;
    }
    stopRef.current = true;
    for (const finish of settleByJobRef.current.values()) {
      finish({ status: "failed", error: "stopped" });
    }
    settleByJobRef.current.clear();
    if (aliveRef.current) {
      setRuntimes([]);
    }
    stopRef.current = false;
    const created = makeLectureJobs(questions, Date.now());
    syncJobs(created);
    void pump();
  }, [pump, syncJobs]);

  const clearJobs = useCallback(() => {
    if (jobsRef.current.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }
    syncJobs([]);
  }, [syncJobs]);

  const stopAll = useCallback(() => {
    stopRef.current = true;
    for (const finish of settleByJobRef.current.values()) {
      finish({ status: "failed", error: "stopped" });
    }
    settleByJobRef.current.clear();
    if (aliveRef.current) {
      setRuntimes([]);
    }
    syncJobs(drainLectureJobs(jobsRef.current, Date.now()));
  }, [syncJobs]);

  const handlePhase = useCallback(
    (jobId: string, next: TutorPhase) => {
      patchJob(jobId, { phase: next });
    },
    [patchJob],
  );

  const isRunningJob = useCallback((jobId: string) => {
    return jobsRef.current.some((job) => job.id === jobId && job.status === "running");
  }, []);

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
    handlePhase,
    handleComplete,
    handleError,
  };
}
