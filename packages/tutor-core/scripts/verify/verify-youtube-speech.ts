import assert from "node:assert/strict";
import { mathToSpeech } from "../../src/tts/speechNotation";
import { clarifyGroupedQuantityNarration } from "../../src/tts/groupedQuantityNarration";
import { buildLessonSegments, getSegmentCommands } from "@heytutor/drawing";
import { normalizeForSpeechMatch } from "../../src/sync/audioSync";

// Actual figure-tour values from YouTube 001. `H` remains the electrical unit.
assert.equal(mathToSpeech("At 5 km/h east, the girl observes vertical rain."), "At 5 kilometers per hour east, the girl observes vertical rain.");
assert.equal(mathToSpeech("यहाँ speed ten km/h है."), "यहाँ speed ten kilometers per hour है.");
assert.equal(mathToSpeech("2 H/s"), "2 henries per second");
console.log("youtube speech: the captured rain velocities say kilometers per hour");

// Squaring a speed is not the same as acceleration. Parentheses are audible.
assert.equal(mathToSpeech("(20 m/s)²"), "the quantity 20 meters per second all squared");
assert.equal(mathToSpeech("(20 m/s)^2"), "the quantity 20 meters per second all squared");
assert.equal(mathToSpeech("20 m/s²"), "20 meters per second squared");
assert.notEqual(normalizeForSpeechMatch("(20 m/s)²"), normalizeForSpeechMatch("20 m/s²"));
console.log("youtube speech: grouped speed squares remain distinct from acceleration");

// Exact captured 003 sentence and its paired WRITE, replayed through the real
// lesson parser. The generated sentence itself had already lost the grouping.
const captured = buildLessonSegments("[STEP]अब substitute करें: v squared equals twenty meters per second squared plus two times ten meters per second squared times forty meters. [WRITE:v² = (20 m/s)² + 2(10 m/s²)(40 m),90,1597][/STEP]");
assert.equal(captured.length, 1);
const capturedSegment = captured[0]!;
const writes = getSegmentCommands(capturedSegment).filter((command) => command.type === "WRITE").map((command) => command.text ?? "");
const clarified = clarifyGroupedQuantityNarration(capturedSegment.narration, writes);
assert.match(clarified, /v squared equals the quantity twenty meters per second all squared plus/);
assert.match(clarified, /two times ten meters per second squared times forty meters/);
assert.deepEqual(writes, ["v^2 = (20 m/s)^2 + 2(10 m/s^2)(40 m)"], "clarifying speech never changes the written calculation");
const acceleration = "अब acceleration twenty meters per second squared है.";
assert.equal(clarifyGroupedQuantityNarration(acceleration, ["a = 20 m/s²"]), acceleration);
assert.equal(clarifyGroupedQuantityNarration(capturedSegment.narration, ["v² = (30 m/s)²"]), capturedSegment.narration, "an unrelated squared scalar cannot change this sentence");
assert.equal(clarifyGroupedQuantityNarration(acceleration, ["v² = (20 m)²"]), acceleration, "an unrelated unit cannot license a speed-square rewrite");
assert.equal(clarifyGroupedQuantityNarration("पहले the quantity twenty meters per second all squared लो.", writes), "पहले the quantity twenty meters per second all squared लो.", "already explicit grouping is stable");
assert.equal(clarifyGroupedQuantityNarration("पहले twenty meters per second squared, फिर twenty meters per second squared.", ["v² = (20 m/s)²; a = 20 m/s²"]), "पहले twenty meters per second squared, फिर twenty meters per second squared.", "ambiguous repeated units cannot silently change a valid acceleration");
console.log("youtube speech: the real captured 003 prose is clarified only with its exact paired scalar and unit");
for (const expression of ["(20 m/s)^20", "(x)^23", "(20 m/s)²³"]) {
  assert(!mathToSpeech(expression).includes("all squared"), `only a complete square exponent can trigger grouping: ${expression}`);
  assert.equal(clarifyGroupedQuantityNarration(capturedSegment.narration, [`v = ${expression}`]), capturedSegment.narration, `a longer exponent cannot license a speed-square correction: ${expression}`);
}
assert.equal(clarifyGroupedQuantityNarration(clarified, writes), clarified, "normalizing a queued segment twice cannot add another quantity wrapper");
assert.equal(mathToSpeech(mathToSpeech("(20 m/s)²")), mathToSpeech("(20 m/s)²"), "spoken grouped notation is idempotent");
for (const text of ["अब one hundred twenty meters per second squared लो.", "अब minus twenty meters per second squared लो.", "अब point twenty meters per second squared लो."]) {
  assert.equal(clarifyGroupedQuantityNarration(text, ["v² = (20 m/s)²"]), text, "a suffix of another signed/decimal scalar is not the paired twenty");
}
