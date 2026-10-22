import type { LectureExportResult } from "./exportLectureMp4";
import { LECTURE_RENDER_FINGERPRINT } from "./lectureRenderFingerprint";

export type CachedLectureExport = Pick<LectureExportResult, "blob" | "mimeType" | "extension" | "noVoice" | "missingAudioCues">;

const memory = new Map<string, CachedLectureExport>();
const DB_NAME = "heytutor-lecture-export";
const STORE = "videos";

function keyParts(key: string): { page: string; identity: string } | null {
  const match = /^(.*)@[^@]+@(render-[a-f0-9]{64}|video\d+)(?:\.(?:mp4|webm))?$/.exec(key);
  return match ? { page: match[1]!, identity: match[2]! } : null;
}
function currentKey(key: string): boolean {
  return LECTURE_RENDER_FINGERPRINT !== null && keyParts(key)?.identity === `render-${LECTURE_RENDER_FINGERPRINT}`;
}
function obsoleteForPage(candidate: unknown, key: string): boolean {
  if (typeof candidate !== "string") return false;
  const old = keyParts(candidate), current = keyParts(key);
  return old !== null && current !== null && old.page === current.page && old.identity !== current.identity;
}
function pruneMemory(key: string): void {
  for (const candidate of memory.keys()) if (obsoleteForPage(candidate, key)) memory.delete(candidate);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Rendering identity is NOT an IndexedDB schema version. Omitting the
    // version opens the existing schema, including released video10+ databases,
    // without a downgrade VersionError or an upgrade on every renderer build.
    const request = indexedDB.open(DB_NAME);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("lecture export cache schema upgrade blocked by another tab"));
    };
    request.onerror = () => reject(request.error ?? new Error("lecture export cache unavailable"));
  });
}

async function indexedDbEntry(key: string, value?: CachedLectureExport): Promise<CachedLectureExport | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        let found: CachedLectureExport | null = null;
        const request = value ? store.put(value, key) : store.get(key);
        if (!value) request.onsuccess = () => {
          const entry = request.result as CachedLectureExport | undefined;
          found = entry?.blob instanceof Blob && typeof entry.noVoice === "boolean" && Number.isFinite(entry.missingAudioCues) ? entry : null;
        };
        // Clean only this page's obsolete exports. Other pages retain their
        // cache until used, and same-build MP4/WebM files remain valid.
        const page = keyParts(key)!.page;
        // '@' is the page/revision separator; 'A' is its exclusive successor.
        // Unlike a '\uffff' suffix, this bounds every possible revision string.
        const cursor = store.openKeyCursor(IDBKeyRange.bound(`${page}@`, `${page}A`, false, true));
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (obsoleteForPage(row.key, key)) store.delete(row.primaryKey);
          row.continue();
        };
        transaction.oncomplete = () => resolve(found);
        transaction.onabort = () => reject(transaction.error ?? new Error("lecture export cache transaction aborted"));
        transaction.onerror = () => reject(transaction.error ?? new Error("lecture export cache transaction failed"));
      });
    } finally {
      db.close();
    }
  } catch {
    // Private mode, quota and schema failures must never block a download.
    return null;
  }
}

export async function getCachedLectureExport(key: string): Promise<CachedLectureExport | null> {
  if (!currentKey(key)) return null;
  pruneMemory(key);
  const hit = memory.get(key);
  if (hit) return hit;
  const stored = await indexedDbEntry(key);
  if (stored) memory.set(key, stored);
  return stored;
}

export function rememberLectureExport(key: string, value: CachedLectureExport): void {
  if (!currentKey(key)) return;
  pruneMemory(key);
  memory.set(key, value);
  void indexedDbEntry(key, value);
}
