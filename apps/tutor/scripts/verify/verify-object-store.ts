import {
  boardAudioPrefix,
  isSafeObjectKey,
  lectureAudioKey,
  parseStoredObjectKey,
  questionImageKey,
  userImagePrefix,
} from "../../lib/object-store/keys";
import { mediaKeyFromUrl, mediaProxyUrl } from "../../lib/object-store/mediaUrl";
import { isAllowedLectureAudioSource, lectureAudioFetchUrl } from "../../lib/lecture-export/lectureAudioUrl";
import {
  contentDispositionForKey,
  contentTypeForStoredKey,
  isAllowedMediaContentType,
} from "../../lib/object-store/safeContentType";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const boardId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const imageId = "44444444-4444-4444-8444-444444444444";

const audioKey = lectureAudioKey(boardId, turnId, 0);
assert(audioKey === `lectures/${boardId}/${turnId}/0.mp3`, "lecture key shape");
assert(boardAudioPrefix(boardId) === `lectures/${boardId}/`, "board prefix");
assert(parseStoredObjectKey(audioKey)?.kind === "lecture", "parse lecture key");
assert(parseStoredObjectKey(lectureAudioKey(boardId, turnId, 12))?.kind === "lecture", "multi-digit segment");

const imageKey = questionImageKey(userId, imageId, "jpg");
assert(imageKey === `images/${userId}/${imageId}.jpg`, "image key shape");
assert(userImagePrefix(userId) === `images/${userId}/`, "image prefix");
assert(parseStoredObjectKey(imageKey)?.kind === "image", "parse image key");
assert(parseStoredObjectKey(questionImageKey(userId, imageId, "webp"))?.kind === "image", "webp image key");

assert(parseStoredObjectKey("lectures/../secret.mp3") === null, "reject parent segments");
assert(parseStoredObjectKey("/lectures/a/b/0.mp3") === null, "reject absolute keys");
assert(parseStoredObjectKey("lectures//b/0.mp3") === null, "reject empty segments");
assert(parseStoredObjectKey("lectures/a/b/0.mp3.exe") === null, "reject extra suffix");
assert(parseStoredObjectKey("notes/a/b/0.mp3") === null, "reject unknown prefixes");
assert(parseStoredObjectKey(`images/${userId}/${imageId}.pdf`) === null, "reject non-image ext");
assert(isSafeObjectKey(audioKey), "safe lecture key");
assert(!isSafeObjectKey("lectures/a/../../../etc/passwd"), "unsafe traversal");

const proxy = mediaProxyUrl(audioKey);
assert(proxy === `/api/media?key=${encodeURIComponent(audioKey)}`, "proxy url encodes the key");
assert(mediaKeyFromUrl(proxy) === audioKey, "round-trip proxy url");
assert(mediaKeyFromUrl(`/api/lecture-audio?key=${encodeURIComponent(audioKey)}`) === audioKey, "lecture-audio alias");
assert(mediaKeyFromUrl("https://app.accelute.co/api/media?key=" + encodeURIComponent(audioKey)) === audioKey, "absolute proxy url");
assert(mediaKeyFromUrl("/api/media?key=notes/x") === null, "reject unsafe proxy key");
assert(mediaKeyFromUrl("/api/chat") === null, "other API paths are not media");

assert(lectureAudioFetchUrl(proxy) === proxy, "same-origin media path is fetched directly");
assert(lectureAudioFetchUrl("blob:hello") === "blob:hello", "blob URLs stay direct");
assert(
  lectureAudioFetchUrl("https://pub.example/lectures/a.mp3", "http://localhost:3000") ===
    "/api/lecture-audio?src=https%3A%2F%2Fpub.example%2Flectures%2Fa.mp3",
  "legacy public hosts still go through the lecture-audio proxy",
);
assert(
  isAllowedLectureAudioSource("https://pub.example/lectures/a.mp3", "https://pub.example") === true,
  "legacy public host allowlist accepts the configured origin",
);
assert(
  isAllowedLectureAudioSource("https://evil.example/lectures/a.mp3", "https://pub.example") === false,
  "legacy public host allowlist rejects other origins",
);

assert(contentTypeForStoredKey(audioKey) === "audio/mpeg", "lecture objects serve as audio/mpeg");
assert(contentTypeForStoredKey(imageKey) === "image/jpeg", "jpg objects serve as image/jpeg");
assert(contentTypeForStoredKey("notes/x") === "application/octet-stream", "unknown keys do not inherit a stored type");
assert(isAllowedMediaContentType("audio/mpeg"), "mp3 is an allowed media type");
assert(!isAllowedMediaContentType("text/html"), "HTML must not be served as a media type");
assert(contentDispositionForKey(audioKey).includes("lecture.mp3"), "audio gets a filename");
assert(contentDispositionForKey(imageKey).includes("inline"), "images may render inline");

console.log("verify-object-store: key parse, proxy URLs, and audio fetch routing passed");
