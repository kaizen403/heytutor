import type { LectureExportResult } from "./exportLectureMp4";

export type CachedLectureExport = Pick<LectureExportResult, "blob" | "mimeType" | "extension">;

const memory = new Map<string, CachedLectureExport>();
const DB_NAME = "heytutor-lecture-export";
const STORE = "videos";

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("lecture export cache unavailable"));
  });
}

async function readIndexedDb(key: string): Promise<CachedLectureExport | null> {
  if (!canUseIndexedDb()) {
    return null;
  }
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as CachedLectureExport | undefined;
        resolve(value?.blob instanceof Blob ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeIndexedDb(key: string, value: CachedLectureExport): Promise<void> {
  if (!canUseIndexedDb()) {
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Private mode and quota errors must not block the download.
  }
}

export async function getCachedLectureExport(key: string): Promise<CachedLectureExport | null> {
  const hit = memory.get(key);
  if (hit) {
    return hit;
  }
  const stored = await readIndexedDb(key);
  if (stored) {
    memory.set(key, stored);
  }
  return stored;
}

export function rememberLectureExport(key: string, value: CachedLectureExport): void {
  memory.set(key, value);
  void writeIndexedDb(key, value);
}
