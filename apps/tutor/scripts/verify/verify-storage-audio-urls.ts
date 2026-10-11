/** Historical public audio URL normalization is measurement-only and owner-bound. */
import assert from "node:assert/strict";
import * as media from "../../lib/object-store/mediaUrl";
import * as keys from "../../lib/object-store/keys";

const owner = { boardId: "owned-board", turnId: "owned-turn" };
const key = `lectures/${owner.boardId}/${owner.turnId}/0.mp3`;
const policy = {
  bucket: "owned-media-bucket", publicBaseUrls: ["https://pub-0123456789abcdef0123456789abcdef.r2.dev", "https://legacy-media.example/archive"],
  mediaOrigins: ["https://app.accelute.co"],
};
type Owner = typeof owner;
type Policy = typeof policy;
// Namespace lookup lets the first RED prove the missing historical resolver,
// while keeping the API ownership parser's current contract untouched.
const normalize = (media as typeof media & { lectureKeyForStorageMeasurement?: (url: string, owner: Owner, policy?: Policy) => string | null }).lectureKeyForStorageMeasurement;
assert.equal(typeof normalize, "function", "storage measurement needs a historical URL resolver");

const positives = [
  `/api/media?key=${encodeURIComponent(key)}`,
  `/api/lecture-audio?key=${encodeURIComponent(key)}`,
  `https://app.accelute.co/api/media?key=${encodeURIComponent(key)}`,
  `https://pub-0123456789abcdef0123456789abcdef.r2.dev/${key}`,
  `https://legacy-media.example/archive/${key}`,
  `/api/lecture-audio?src=${encodeURIComponent(`https://legacy-media.example/archive/${key}`)}`,
  `https://app.accelute.co/api/lecture-audio?src=${encodeURIComponent(`https://pub-0123456789abcdef0123456789abcdef.r2.dev/${key}`)}`,
  `https://owned-media-bucket.s3.amazonaws.com/${key}`,
  `https://owned-media-bucket.s3.ap-south-2.amazonaws.com/${key}`,
  `https://owned-media-bucket.s3-ap-south-2.amazonaws.com/${key}`,
  `https://s3.ap-south-2.amazonaws.com/owned-media-bucket/${key}`,
  `https://s3.amazonaws.com/owned-media-bucket/${key}`,
  `https://owned-media-bucket.s3.ap-south-2.amazonaws.com/${key}?X-Amz-Signature=fixture`,
];
for (const url of positives) assert.equal(normalize!(url, owner, policy), key, `supported historical/current reference: ${url}`);
console.log("PASS: historical R2 writer, src proxy, current proxy and owned S3 bucket URL shapes");

const negatives = [
  `https://unapproved.example/${key}`,
  `https://unapproved.example/api/media?key=${encodeURIComponent(key)}`,
  `https://pub-deadbeefdeadbeefdeadbeefdeadbeef.r2.dev/${key}`,
  `https://legacy-media.example/archives/${key}`,
  `https://other-bucket.s3.ap-south-2.amazonaws.com/${key}`,
  `https://s3.ap-south-2.amazonaws.com/other-bucket/${key}`,
  `https://owned-media-bucket.s3.ap-south-2.amazonaws.com.evil.example/${key}`,
  `https://user:password@legacy-media.example/archive/${key}`,
  `http://legacy-media.example/archive/${key}`,
  `//legacy-media.example/archive/${key}`,
  `/api/media?key=${encodeURIComponent("lectures/another-board/owned-turn/0.mp3")}`,
  `/api/media?key=${encodeURIComponent("lectures/owned-board/another-turn/0.mp3")}`,
  `/api/media?key=${encodeURIComponent("images/owned-board/photo.jpg")}`,
  `/api/media?key=${encodeURIComponent(` ${key} `)}`,
  `https://legacy-media.example/archive/lectures/owned-board/another-turn/../owned-turn/0.mp3`,
  `https://legacy-media.example/archive/lectures/owned-board/%2e%2e/owned-board/owned-turn/0.mp3`,
  `https://legacy-media.example/archive/lectures%2Fowned-board%2Fowned-turn%2F0.mp3`,
  `/api/lecture-audio?src=${encodeURIComponent(`https://unapproved.example/${key}`)}`,
  `/api/lecture-audio?src=${encodeURIComponent(`/api/lecture-audio?src=${encodeURIComponent(positives[3]!)}`)}`,
  `/api/media?key=${encodeURIComponent(key)}&key=${encodeURIComponent("lectures/another-board/another-turn/0.mp3")}`,
  `/api/lecture-audio?src=${encodeURIComponent(positives[3]!)}&src=${encodeURIComponent(positives[4]!)}`,
  "blob:external-audio", "data:audio/mpeg;base64,AQID", "not a URL",
];
for (const url of negatives) assert.equal(normalize!(url, owner, policy), null, `unsafe or unowned reference must remain unknown: ${url}`);
console.log("PASS: external hosts, bucket spoofing, credentials, traversal and cross-board/turn references rejected");

const current = `/api/media?key=${encodeURIComponent(key)}`;
assert.equal(media.mediaKeyFromUrl(current), key);
assert.equal(media.mediaKeyFromUrl(positives[3]!), null, "historical normalization must not broaden the authenticated API parser");
assert.equal(media.mediaKeyFromUrl(`/api/lecture-audio?src=${encodeURIComponent(positives[3]!)}`), null);
console.log("PASS: serving parser remains unchanged and historical normalization performs no I/O");

const ownedObject = (keys as typeof keys & { isOwnedTurnStorageObjectKey?: (key: string, owner: Owner) => boolean }).isOwnedTurnStorageObjectKey;
assert.equal(typeof ownedObject, "function", "owned auxiliary storage objects need measurement without loosening audio serving");
for (const path of [key, `lectures/${owner.boardId}/${owner.turnId}/metadata.json`, `lectures/${owner.boardId}/${owner.turnId}/attempt/scene.bin`, `lectures/${owner.boardId}/${owner.turnId}/`]) {
  assert.equal(ownedObject!(path, owner), true, "all safe owned turn objects retain their measured LIST bytes");
}
for (const path of [
  "lectures/another-board/owned-turn/metadata.json", "lectures/owned-board/another-turn/metadata.json",
  "lectures/owned-board/owned-turn/../another-turn/metadata.json", "lectures/owned-board/owned-turn//metadata.json",
  "lectures/owned-board/owned-turn/%2e%2e/metadata.json", "lectures/owned-board/owned-turn/back\\slash.bin",
  "images/owned-board/metadata.json", "lectures/owned-board/owned-turn/./metadata.json",
]) assert.equal(ownedObject!(path, owner), false, "unknown scope or unsafe suffix cannot be treated as owned inventory");
assert.equal(keys.parseStoredObjectKey(`lectures/${owner.boardId}/${owner.turnId}/metadata.json`), null, "measurement of auxiliary bytes must not broaden serving/deletion keys");
console.log("PASS: safe owned auxiliary objects are measurable; serving keys and ownership remain strict");

const environmentKeys = ["S3_BUCKET", "R2_BUCKET", "S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL", "AUTH_URL"] as const;
const beforeEnvironment = Object.fromEntries(environmentKeys.map(name => [name, process.env[name]]));
try {
  process.env.S3_BUCKET = policy.bucket;
  process.env.S3_PUBLIC_BASE_URL = "https://current-media.example";
  process.env.R2_PUBLIC_BASE_URL = "https://legacy-media.example/archive";
  process.env.AUTH_URL = "https://custom-tutor.example";
  assert.equal(normalize!(`https://current-media.example/${key}`, owner), key);
  assert.equal(normalize!(positives[4]!, owner), key, "both historical and current configured bases are retained");
  assert.equal(normalize!(`https://custom-tutor.example/api/media?key=${encodeURIComponent(key)}`, owner), key);
  assert.equal(normalize!(positives[8]!, owner), key);
  process.env.S3_PUBLIC_BASE_URL = "https://legacy-media.example";
  assert.equal(normalize!(positives[4]!, owner), key, "overlapping configured bases must still find the owned historical prefix");
  delete process.env.S3_PUBLIC_BASE_URL;
  delete process.env.R2_PUBLIC_BASE_URL;
  assert.equal(normalize!(positives[4]!, owner), null, "an unconfigured historical host stays unresolved for conservative quota fallback");
  assert.equal(normalize!(current, owner), key, "current relative proxies do not need public-host configuration");
} finally {
  for (const name of environmentKeys) {
    const before = beforeEnvironment[name];
    if (before === undefined) delete process.env[name]; else process.env[name] = before;
  }
}
console.log("PASS: actual environment defaults retain both public bases and configured tutor origins; unknown hosts remain unresolved");
console.log("verify-storage-audio-urls: 5 groups, 13 supported shapes and 24 URL ownership/security negatives");
