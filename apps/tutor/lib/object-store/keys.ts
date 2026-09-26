/** Object keys for lecture audio and question photos. Safe to import from route handlers. */

const IMAGE_EXT = /^(jpg|jpeg|png|webp|gif)$/;

export type StoredObjectRef =
  | {
      kind: "lecture";
      boardId: string;
      turnId: string;
      segmentIndex: number;
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
    /^lectures\/([A-Za-z0-9._-]{1,128})\/([A-Za-z0-9._-]{1,128})\/(0|[1-9]\d{0,5})\.(mp3|wav)$/.exec(
      trimmed,
    );
  if (lecture?.[1] && lecture[2] && lecture[3]) {
    return {
      kind: "lecture",
      boardId: lecture[1],
      turnId: lecture[2],
      segmentIndex: Number(lecture[3]),
      ext: lecture[4] === "wav" ? "wav" : "mp3",
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
