import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Firefox often skips React unmount when the tab or window goes away
 * (pagehide + bfcache). Stop can also no-op once the UI looks idle, while
 * leftover TTS is still talking. The session has to halt audio on pagehide
 * and Stop must always kill TTS.
 */

const root = resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const hook = read("features/tutor-session/hooks/useLecturePageHalt.ts");
assert.match(hook, /pagehide/, "useLecturePageHalt must listen for pagehide");
assert.match(hook, /beforeunload/, "useLecturePageHalt must listen for beforeunload");
assert.match(
  hook,
  /haltAllLectureAudio/,
  "page close must close every lecture AudioContext, not only the live TTS client",
);

const shell = read("features/tutor-session/TutorSessionShell.tsx");
assert.match(shell, /useLecturePageHalt/, "the session shell must halt audio when the page dies");

const turn = read("features/tutor-session/hooks/turn/useTurnControl.ts");
const stopTurnStart = turn.indexOf("const stopTurn = useCallback(() => {");
assert.notEqual(stopTurnStart, -1, "stopTurn is gone");
const stopTurnBody = turn.slice(stopTurnStart, turn.indexOf("}, [", stopTurnStart));
const idleGuard = stopTurnBody.indexOf('phase === "idle"');
const ttsStop = stopTurnBody.indexOf("ttsClientRef.current?.stop()");
assert.notEqual(ttsStop, -1, "stopTurn must stop TTS");
assert.ok(
  idleGuard === -1 || ttsStop < idleGuard,
  "stopTurn must stop TTS even when the UI already looks idle — leftover speech is why the lecture keeps talking after Stop",
);

console.log("verify-lecture-page-halt: Firefox close and idle Stop both halt lecture audio");
