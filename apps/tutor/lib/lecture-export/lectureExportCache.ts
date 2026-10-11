import type { LectureExportResult } from "./exportLectureMp4";
import { LECTURE_PAGE_CACHE_REVISION } from "./canExportLectureMp4";

export type CachedLectureExport = Pick<LectureExportResult, "blob" | "mimeType" | "extension" | "noVoice" | "missingAudioCues">;

const memory = new Map<string, CachedLectureExport>();
const DB_NAME = "heytutor-lecture-export";
const STORE = "videos";
const DB_VERSION = Number(LECTURE_PAGE_CACHE_REVISION.slice("video".length));

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // A revision change also frees obsolete blobs already stored on the device.
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
      const cursor = request.transaction!.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const revision = typeof row.key === "string" ? /@video(\d+)(?:\.(?:mp4|webm))?$/.exec(row.key)?.[1] : undefined;
        if (revision !== undefined && Number(revision) < DB_VERSION) row.delete();
        row.continue();
      };
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("lecture export cache upgrade blocked by another tab"));
    };
    request.onerror = () => reject(request.error ?? new Error("lecture export cache unavailable"));
  });
}

async function readIndexedDb(key: string): Promise<CachedLectureExport | null> {
  if (!canUseIndexedDb()) {
    return null;
  }
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        request.onsuccess = () => {
          const value = request.result as CachedLectureExport | undefined;
          resolve(value?.blob instanceof Blob && typeof value.noVoice === "boolean" && Number.isFinite(value.missingAudioCues) ? value : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
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
    try {
      await new Promise<void>((resolve, reject) => {
        const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
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
