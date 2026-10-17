import assert from "node:assert/strict";
import { scenario } from "./verify-startup-turn";
import { buildLessonSegments, getSegmentCommands } from "@heytutor/drawing";
import { buildGivenValueSegments, mathToSpeech } from "@heytutor/tutor-core";
import { normalizeSegmentForAlignment } from "../../features/tutor-session/lib/turn/segmentPlanning";
import { ttsConfig } from "../../lib/tts/providerConfig";
import { createTtsRelay } from "../../lib/tts/ttsProvider";

// The original captures were hi-IN websocket requests. Their text tee precedes
// this provider boundary: raw digits there do not prove Hindi number audio.
const config = ttsConfig("hi-IN", false, { SARVAM_API_KEY: "test-only-no-network-key" });
assert.equal(config.provider, "sarvam");
const given = buildGivenValueSegments(
  "A ball is projected from level ground with a speed of 20 m/s at 60° above the horizontal. Take g = 10 m/s². Find the radius of curvature of its path at the highest point and at the point of projection.",
  { givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" }, { id: "g", symbol: "g", value: 10, unit: "m/s²", provenance: "given" }] },
  { language: "hinglish" },
);
assert(given.length > 0);
for (const [index, segment] of given.entries()) {
  const relay = createTtsRelay(config);
  const packets = relay.segment(`given-${index}`, mathToSpeech(segment.narration), { stability: 0.4, similarity_boost: 0.75, speed: 1 });
  const text = packets.map((packet) => (packet as { data?: { text?: string } }).data?.text ?? "").join("");
  assert(!/\d/.test(text), `the actual Sarvam producer must send English number words: ${text}`);
  assert.match(text, /\p{Script=Devanagari}/u, "#174 already localized the Given framing");
  if (segment.narration.includes("20")) assert.match(text, /twenty meters per second/);
  if (segment.narration.includes("10")) assert.match(text, /ten meters per second squared/);
  assert(getSegmentCommands(segment).some((command) => /\d/.test(command.text ?? "")), "normalizing provider words leaves notebook digits in place");
}
console.log("youtube speech boundary: captured bare Given digits were already English words at the real Sarvam producer");

export const CAPTURED_SPEED_SQUARE_STEP = "[STEP]अब substitute करें: v squared equals twenty meters per second squared plus two times ten meters per second squared times forty meters. [WRITE:v² = (20 m/s)² + 2(10 m/s²)(40 m),90,1597][/STEP]";
const captured = buildLessonSegments(CAPTURED_SPEED_SQUARE_STEP)[0]!;
const originalCommands = structuredClone(getSegmentCommands(captured));
const normalized = normalizeSegmentForAlignment(captured);
assert.match(normalized.narration, /the quantity twenty meters per second all squared/, "the actual enqueue normalization must clarify the captured sentence before prefetch and recording");
assert.deepEqual(getSegmentCommands(normalized), originalCommands, "clarification cannot edit or discard the notebook calculation");
console.log("youtube speech boundary: the live enqueue seam clarifies the captured squared speed and preserves every command");

async function verifyLiveQueue(): Promise<void> {
  const result = await scenario("hinglish-opening", false, false, {
    plan: {
      schemaVersion: "turn-plan/v3",
      question: "Derive the formula for the range of a projectile on level ground.",
      givens: [], unknowns: [{ id: "range", symbol: "R" }], derived: [],
      qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
      lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"], visualRequirement: "required",
    },
    voiceKey: "hi-IN", teachingTail: CAPTURED_SPEED_SQUARE_STEP,
  });
  const corrected = (text: string): boolean => text.includes("the quantity twenty meters per second all squared");
  assert("collected" in result && result.collected && "recorded" in result && result.recorded,
    "the frozen teaching replay must return its real queued and recorded rows");
  assert("prefetched" in result && Array.isArray(result.prefetched) && Array.isArray(result.playbacks),
    "the Hinglish replay must return real provider text observations");
  const correctedEntry = (entry: unknown): boolean => typeof entry === "object" && entry !== null &&
    "text" in entry && typeof entry.text === "string" && corrected(entry.text);
  const queued = result.collected.find((segment) => corrected(segment.narration));
  assert(queued, "the actual hook must collect the corrected captured sentence");
  assert(result.prefetched.some(correctedEntry), "actual lookahead must receive the same corrected sentence");
  assert(result.playbacks.some(correctedEntry), "the actual segment runner must speak the corrected sentence");
  assert(result.recorded.some((entry) => corrected(entry.narration)), "the real recording path must save the corrected sentence for replay");
  assert.deepEqual(getSegmentCommands(queued).filter((command) => command.type === "WRITE").map((command) => command.text),
    ["v^2 = (20 m/s)^2 + 2(10 m/s^2)(40 m)"], "the real queue must preserve every numeric value, unit and grouping in the WRITE");
  console.log("youtube speech boundary: early OFF real hook prefetch, playback, collected and recorded rows agree on the squared speed");
}
void verifyLiveQueue().catch((error) => { console.error(error); process.exitCode = 1; });
