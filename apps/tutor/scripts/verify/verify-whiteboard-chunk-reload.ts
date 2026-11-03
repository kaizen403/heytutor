/**
 * A tab opened before a deploy asks for the whiteboard chunk under a name the
 * new build deleted, and the board sat on "loading the board" (production,
 * 28 Oct 2026). The whiteboard loader now reloads once into the current build
 * when its chunk is missing, and shows the error if the reload did not help.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMissingChunkError, reloadOnceForMissingChunk } from "../../lib/client/staleBuild";

const app = fileURLToPath(new URL("../../", import.meta.url));
const chunkError = Object.assign(new Error("Loading chunk 9619 failed.\n(error: https://app.accelute.co/_next/static/chunks/ea178396.69608d224ea64b42.js)"), { name: "ChunkLoadError" });

// Which errors count as a missing chunk.
assert.equal(isMissingChunkError(chunkError), true, "webpack's ChunkLoadError");
assert.equal(isMissingChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js")), true, "Chrome's dynamic import failure");
assert.equal(isMissingChunkError(new TypeError("error loading dynamically imported module")), true, "Firefox's dynamic import failure");
assert.equal(isMissingChunkError(new TypeError("Importing a module script failed.")), true, "Safari's dynamic import failure");
assert.equal(isMissingChunkError(new TypeError("Cannot read properties of undefined (reading 'x')")), false, "an ordinary bug is not a missing chunk");
assert.equal(isMissingChunkError(null), false);
assert.equal(isMissingChunkError("Loading chunk 1 failed"), false, "only error objects");

// Reload once per page build, never in a loop.
const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
let reloads = 0;
const location = { reload: () => { reloads++; } };
assert.equal(reloadOnceForMissingChunk(chunkError, { clientBuildId: "aaa", location, storage }), true, "a missing chunk reloads");
assert.equal(reloads, 1);
assert.equal(reloadOnceForMissingChunk(chunkError, { clientBuildId: "aaa", location, storage }), false, "the same build that still fails shows the error");
assert.equal(reloads, 1, "no reload loop");
assert.equal(reloadOnceForMissingChunk(chunkError, { clientBuildId: "bbb", location, storage }), true, "a new build gets its own one reload");
assert.equal(reloads, 2);
assert.equal(reloadOnceForMissingChunk(new Error("boom"), { clientBuildId: "ccc", location, storage }), false, "other errors are not swallowed");
assert.equal(reloads, 2);
const noStore = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
assert.equal(reloadOnceForMissingChunk(chunkError, { clientBuildId: "ddd", location, storage: noStore }), false, "without storage it shows the error rather than risk a loop");
assert.equal(reloads, 2);

// Wiring: the whiteboard's dynamic import routes a rejection through the reload.
const loader = readFileSync(path.join(app, "features/tutor-session/components/WhiteboardLoader.tsx"), "utf8");
assert.match(loader, /import\("@heytutor\/whiteboard"\)[\s\S]*?\.catch\(\(error: unknown\) => \{[\s\S]*?if \(reloadOnceForMissingChunk\(error\)\) return new Promise<never>\(\(\) => \{\}\);\s*throw error;/,
  "the whiteboard loader reloads once on a missing chunk and rethrows anything else");

console.log("whiteboard chunk reload: missing chunks reload once per build, other errors surface, the loader is wired");
