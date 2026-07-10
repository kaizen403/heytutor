export type ItemStatus = "pending" | "accepted" | "rejected" | "needs-improvement";

export interface ProgressEntry {
  checked: boolean;
  status: ItemStatus;
  notes: string;
  boardId?: string;
  updatedAt: string;
}

export type ProgressMap = Record<string, ProgressEntry>;

export const PROGRESS_STORAGE_KEY = "heytutor:admin:syllabus-progress:v1";

export const DEFAULT_PROGRESS_ENTRY: ProgressEntry = {
  checked: false,
  status: "pending",
  notes: "",
  updatedAt: new Date(0).toISOString(),
};

export function readProgressMap(): ProgressMap {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as ProgressMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

export function writeProgressMap(map: ProgressMap): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(map));
}

export function getProgressEntry(map: ProgressMap, id: string): ProgressEntry {
  return map[id] ?? { ...DEFAULT_PROGRESS_ENTRY };
}

export function upsertProgressEntry(
  map: ProgressMap,
  id: string,
  patch: Partial<Omit<ProgressEntry, "updatedAt">>,
): ProgressMap {
  const current = getProgressEntry(map, id);
  return {
    ...map,
    [id]: {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function resetProgressMap(): ProgressMap {
  writeProgressMap({});
  return {};
}

export function exportProgressJson(map: ProgressMap): string {
  return JSON.stringify(map, null, 2);
}
