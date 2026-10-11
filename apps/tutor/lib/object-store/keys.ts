/** Object keys for lecture audio and question photos. Safe to import from route handlers. */

const IMAGE_EXT = /^(jpg|jpeg|png|webp|gif)$/;

export type StoredObjectRef =
  | {
      kind: "lecture";
      boardId: string;
      turnId: string;
      segmentIndex: number;
      /** Per upload attempt folder of a checkpoint save; absent on legacy keys. */
      attemptDir?: string;
      ext: "mp3" | "wav";
    }
  | {
      kind: "image";
      userId: string;
      imageId: string;
      ext: string;
    };

export function lectureAudioKey(
  boardId: string,
  turnId: string,
  segmentIndex: number,
  contentType = "audio/mpeg",
): string {
  return `lectures/${boardId}/${turnId}/${segmentIndex}.${contentType === "audio/wav" ? "wav" : "mp3"}`;
}

/** A checkpoint upload attempt's folder name: 12 lowercase letters or digits. */
export const UPLOAD_ATTEMPT_DIR = /^[a-z0-9]{12}$/;

/**
 * Audio of a progressively saved turn. Each upload attempt writes under its
 * own folder, so the cleanup of an abandoned attempt can never delete a clip
 * an earlier checkpoint already committed. `submittedIndex` is the stable
 * submitted row index, not the canonical one, which can move.
 */
export function checkpointAudioKey(
  boardId: string,
  turnId: string,
  attemptDir: string,
  submittedIndex: number,
  contentType = "audio/mpeg",
): string {
  if (!UPLOAD_ATTEMPT_DIR.test(attemptDir)) throw new Error("invalid upload attempt folder");
  return `${checkpointAttemptPrefix(boardId, turnId, attemptDir)}${submittedIndex}.${contentType === "audio/wav" ? "wav" : "mp3"}`;
}

/** The prefix an upload attempt's cleanup intent may delete: that attempt only. */
export function checkpointAttemptPrefix(boardId: string, turnId: string, attemptDir: string): string {
  if (!UPLOAD_ATTEMPT_DIR.test(attemptDir)) throw new Error("invalid upload attempt folder");
  return `lectures/${boardId}/${turnId}/${attemptDir}/`;
}

export function boardAudioPrefix(boardId: string): string {
  return `lectures/${boardId}/`;
}

export function questionImageKey(userId: string, imageId: string, ext: string): string {
  return `images/${userId}/${imageId}.${ext}`;
}

export function userImagePrefix(userId: string): string {
  return `images/${userId}/`;
}

export function parseStoredObjectKey(key: string): StoredObjectRef | null {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 512) return null;
  if (
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/") ||
    trimmed.includes("//")
  ) {
    return null;
  }

  const lecture =
    /^lectures\/([A-Za-z0-9._-]{1,128})\/([A-Za-z0-9._-]{1,128})\/(?:([a-z0-9]{12})\/)?(0|[1-9]\d{0,5})\.(mp3|wav)$/.exec(
      trimmed,
    );
  if (lecture?.[1] && lecture[2] && lecture[4]) {
    return {
      kind: "lecture",
      boardId: lecture[1],
      turnId: lecture[2],
      segmentIndex: Number(lecture[4]),
      ...(lecture[3] ? { attemptDir: lecture[3] } : {}),
      ext: lecture[5] === "wav" ? "wav" : "mp3",
    };
  }

  const image =
    /^images\/([A-Za-z0-9._-]{1,128})\/([A-Za-z0-9._-]{1,128})\.(jpg|jpeg|png|webp|gif)$/.exec(
      trimmed,
    );
  if (image?.[1] && image[2] && image[3] && IMAGE_EXT.test(image[3])) {
    return {
      kind: "image",
      userId: image[1],
      imageId: image[2],
      ext: image[3],
    };
  }

  return null;
}

export function isSafeObjectKey(key: string): boolean {
  return parseStoredObjectKey(key) !== null;
}

/**
 * Measurement may retain bytes of auxiliary objects a complete LIST proves
 * stored under an owned turn. This does not authorize serving, uploading or
 * individually deleting those objects through the audio/image API parser.
 */
export function isOwnedTurnStorageObjectKey(
  key: string,
  owner: { boardId: string; turnId: string },
): boolean {
  const prefix = `lectures/${owner.boardId}/${owner.turnId}/`;
  if (!isSafeObjectDeletionPrefix(prefix) || !key.startsWith(prefix) || key.length > 1024 ||
    key.includes("..") || key.includes("\\") || key.includes("//")) return false;
  const suffix = key.slice(prefix.length);
  // A provider may store a folder marker; its actual LIST size is still
  // charged, rather than treating the marker as proof of an empty prefix.
  if (suffix === "") return true;
  return suffix.replace(/\/$/, "").split("/").every((part) => /^[A-Za-z0-9._-]{1,255}$/.test(part) && part !== ".");
}

/** Deletion is bounded to a board, turn, validated upload attempt, or user image. */
export function isSafeObjectDeletionPrefix(prefix: string): boolean {
  if (prefix.includes("..") || prefix.trim() !== prefix) return false;
  if (/^(?:lectures|images)\/[A-Za-z0-9._-]{1,128}\/$/.test(prefix)) return true;
  // The object parser already owns both the legacy turn folder and the exact
  // 12-character attempt grammar. A sentinel file validates only that folder.
  if (prefix.startsWith("lectures/") && prefix.endsWith("/")) {
    return isSafeObjectKey(`${prefix}0.mp3`);
  }
  return prefix.startsWith("images/") && !prefix.endsWith("/") && isSafeObjectKey(prefix);
}
