"use client";

import { useCallback, useEffect, useState } from "react";
import {
  exportProgressJson,
  getProgressEntry,
  PROGRESS_STORAGE_KEY,
  readProgressMap,
  resetProgressMap,
  upsertProgressEntry,
  writeProgressMap,
  type ItemStatus,
  type ProgressEntry,
  type ProgressMap,
} from "./progressStorage";

export function useSyllabusProgress() {
  const [progress, setProgress] = useState<ProgressMap>(() => readProgressMap());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PROGRESS_STORAGE_KEY) {
        setProgress(readProgressMap());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: ProgressMap) => {
    writeProgressMap(next);
    setProgress(next);
  }, []);

  const get = useCallback(
    (id: string): ProgressEntry => getProgressEntry(progress, id),
    [progress],
  );

  const setChecked = useCallback(
    (id: string, checked: boolean) => {
      commit(upsertProgressEntry(progress, id, { checked }));
    },
    [commit, progress],
  );

  const setStatus = useCallback(
    (id: string, status: ItemStatus) => {
      commit(upsertProgressEntry(progress, id, { status }));
    },
    [commit, progress],
  );

  const setNotes = useCallback(
    (id: string, notes: string) => {
      commit(upsertProgressEntry(progress, id, { notes }));
    },
    [commit, progress],
  );

  const setBoardId = useCallback(
    (id: string, boardId: string) => {
      commit(upsertProgressEntry(progress, id, { boardId }));
    },
    [commit, progress],
  );

  const resetAll = useCallback(() => {
    commit(resetProgressMap());
  }, [commit]);

  const exportJson = useCallback(() => exportProgressJson(progress), [progress]);

  return {
    progress,
    get,
    setChecked,
    setStatus,
    setNotes,
    setBoardId,
    resetAll,
    exportJson,
  };
}
