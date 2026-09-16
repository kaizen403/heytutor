import type { AudioTimings } from "../../src/tts/elevenLabsClient";
import { mathToSpeech } from "../../src/tts/elevenLabsClient";
import { normalizeForSpeechMatch } from "../../src/sync/audioSync";
import {
  getFocusTargetSchedule,
  MIN_FOCUS_WINDOW_MS,
  type FocusScheduleTarget,
  type FocusTargetSchedule,
} from "../../src/sync/focusSchedule";

/**
 * The pen follows the voice to each FOCUS target. Measured 10 Sep 2026: the
 * runtime traced "mirror,C,F" at t=0 of a 7.2 s sentence that named M, C and
 * F in turn, and "f is the focal length" pulled the pen to the point F. These
 * fixtures pin the word anchor: whole tokens, case-sensitive for short names,
 * monotonic, clause-long windows, identical at 86 ms/char with and without a
 * character alignment.
 */

const MS_PER_CHAR = 86;
const LETTER_TOLERANCE_MS = 120;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function syntheticTimings(narration: string): AudioTimings {
  const spoken = mathToSpeech(narration.trim());
  const charStartTimes = Array.from({ length: spoken.length }, (_, index) => (index * MS_PER_CHAR) / 1000);
  const charDurations = Array.from({ length: spoken.length }, () => MS_PER_CHAR / 1000);
  return {
    charStartTimes,
    charDurations,
    totalDuration: (spoken.length * MS_PER_CHAR) / 1000,
  };
}

/** Media ms at which a whole raw token starts in the spoken text (nth occurrence). */
function spokenTokenStartMs(narration: string, token: string, occurrence = 0): number {
  const spoken = mathToSpeech(narration.trim());
  const pattern = new RegExp(`(^|\\s)(${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=[\\s,.;:!?]|$)`, "g");
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = pattern.exec(spoken)) !== null) {
    if (seen === occurrence) {
      return (match.index + match[1]!.length) * MS_PER_CHAR;
    }
    seen++;
  }
  throw new Error(`token "${token}" not found in spoken text "${spoken}"`);
}

/** Media ms at the end of the clause that contains the given spoken offset. */
function clauseEndMsAfter(narration: string, fromMs: number): number {
  const spoken = mathToSpeech(narration.trim());
  const fromOffset = Math.round(fromMs / MS_PER_CHAR);
  const pattern = /[,.;:!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(spoken)) !== null) {
    const end = match.index + match[0].length;
    if (end > fromOffset) return end * MS_PER_CHAR;
  }
  return spoken.length * MS_PER_CHAR;
}

function schedules(
  narration: string,
  spec: string,
  targets: FocusScheduleTarget[],
  narrationBefore = narration,
): Array<{ label: string; schedule: FocusTargetSchedule }> {
  const command = { text: spec, narrationBefore, charPosition: narrationBefore.length };
  return [
    {
      label: "tts",
      schedule: getFocusTargetSchedule({
        narration,
        command,
        targets,
        timings: syntheticTimings(narration),
        msPerChar: MS_PER_CHAR,
      }),
    },
    {
      label: "estimated",
      schedule: getFocusTargetSchedule({ narration, command, targets, timings: null, msPerChar: MS_PER_CHAR }),
    },
  ];
}

function assertWellFormed(name: string, schedule: FocusTargetSchedule, targetCount: number): void {
  assert(schedule.targets.length === targetCount, `${name}: expected ${targetCount} windows, got ${schedule.targets.length}`);
  let previousStart = -1;
  for (const window of schedule.targets) {
    assert(window.startMs >= previousStart, `${name}: startMs not monotonic at ${window.id} (${window.startMs} after ${previousStart})`);
    assert(
      window.endMs >= window.startMs + MIN_FOCUS_WINDOW_MS,
      `${name}: ${window.id} window ${window.startMs}..${window.endMs} is shorter than ${MIN_FOCUS_WINDOW_MS} ms`,
    );
    previousStart = window.startMs;
  }
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const MIRROR: FocusScheduleTarget = { id: "mirror", labels: ["mirror", "M", "mirror", "mirror"] };
const CENTRE: FocusScheduleTarget = { id: "C", labels: ["C", "C", "centre of curvature", "center"] };
const FOCUS: FocusScheduleTarget = { id: "F", labels: ["F", "F", "focus", "focal_point"] };
const OBJECT: FocusScheduleTarget = { id: "O_base", labels: ["O_base", "O", "object", "object"] };
const IMAGE: FocusScheduleTarget = { id: "I_base", labels: ["I_base", "I", "image", "image"] };
const RESISTOR: FocusScheduleTarget = { id: "R1", labels: ["R1", "R1", "resistor 1", "resistor"] };

// 1. Three names in one sentence: three windows, letter-anchored, in spoken order.
{
  const narration = "on the figure, M is the concave mirror, C is its center of curvature, and F is the focal point";
  for (const { label, schedule } of schedules(narration, "mirror,C,F", [MIRROR, CENTRE, FOCUS])) {
    const name = `fixture 1 (${label})`;
    assertWellFormed(name, schedule, 3);
    assert(schedule.source === label, `${name}: source ${schedule.source}`);
    assert(schedule.matchedCount === 3, `${name}: matchedCount ${schedule.matchedCount}, expected 3`);
    const ids = schedule.targets.map((window) => window.id).join(",");
    assert(ids === "mirror,C,F", `${name}: spoken order ${ids}, expected mirror,C,F`);
    const letters: Array<[string, string]> = [["mirror", "M"], ["C", "C"], ["F", "F"]];
    for (const [id, letter] of letters) {
      const window = schedule.targets.find((entry) => entry.id === id)!;
      const spokenAt = spokenTokenStartMs(narration, letter);
      assert(window.anchor === "label", `${name}: ${id} anchored by ${window.anchor}, expected label`);
      assert(
        near(window.startMs, spokenAt, LETTER_TOLERANCE_MS),
        `${name}: ${id} starts at ${window.startMs} ms, letter ${letter} spoken at ${spokenAt} ms`,
      );
      const clauseEnd = clauseEndMsAfter(narration, spokenAt);
      assert(
        near(window.endMs, clauseEnd, MS_PER_CHAR),
        `${name}: ${id} ends at ${window.endMs} ms, clause ends at ${clauseEnd} ms`,
      );
    }
  }
}

// 2. The name opens the sentence: the window starts at 0 ms.
{
  const narration = "O is the object, placed between F and C.";
  for (const { label, schedule } of schedules(narration, "O_base", [OBJECT])) {
    const name = `fixture 2 (${label})`;
    assertWellFormed(name, schedule, 1);
    const [window] = schedule.targets;
    assert(window!.anchor === "label", `${name}: anchored by ${window!.anchor}, expected label`);
    assert(window!.startMs === 0, `${name}: O starts at ${window!.startMs} ms, expected 0`);
    assert(
      near(window!.endMs, clauseEndMsAfter(narration, 0), MS_PER_CHAR),
      `${name}: O ends at ${window!.endMs} ms, expected the first clause end`,
    );
  }
}

// 3. A lowercase "f" is the focal length, not the point F: no label anchor.
{
  const narration = "f is the focal length of the concave mirror, and u is the object distance";
  for (const { label, schedule } of schedules(narration, "F", [FOCUS])) {
    const name = `fixture 3 (${label})`;
    assertWellFormed(name, schedule, 1);
    const [window] = schedule.targets;
    assert(
      window!.anchor === "clause" || window!.anchor === "proportional",
      `${name}: lowercase f anchored the point F (anchor ${window!.anchor} at ${window!.startMs} ms)`,
    );
    assert(schedule.matchedCount === 0, `${name}: matchedCount ${schedule.matchedCount}, expected 0`);
    assert(window!.startMs > 0, `${name}: the fallback window must not start on the lowercase f at 0 ms`);
    const lastClauseAt = spokenTokenStartMs(narration, "and");
    assert(
      window!.anchor === "clause" && near(window!.startMs, lastClauseAt, LETTER_TOLERANCE_MS),
      `${name}: expected the last clause before the tag (${lastClauseAt} ms), got ${window!.anchor} at ${window!.startMs} ms`,
    );
  }
}

// 4. Whole tokens only: "I" is not the i inside "notice" or "image".
{
  const narration = "so v equals sixty centimeters. notice the image I.";
  for (const { label, schedule } of schedules(narration, "I_base", [IMAGE])) {
    const name = `fixture 4 (${label})`;
    assertWellFormed(name, schedule, 1);
    const [window] = schedule.targets;
    const letterAt = spokenTokenStartMs(narration, "I");
    const imageAt = spokenTokenStartMs(narration, "image");
    assert(window!.anchor === "label", `${name}: anchored by ${window!.anchor}, expected label`);
    assert(
      near(window!.startMs, letterAt, LETTER_TOLERANCE_MS),
      `${name}: I starts at ${window!.startMs} ms, the letter is spoken at ${letterAt} ms`,
    );
    assert(window!.startMs > imageAt, `${name}: window ${window!.startMs} ms sits inside "image" (${imageAt} ms)`);
  }
}

// 5. An indexed label: the voice says "R one" for R1 and the label still anchors.
{
  const narration = "notice the current through R1";
  const normalized = normalizeForSpeechMatch(mathToSpeech(narration));
  assert(normalized.endsWith("r one"), `fixture 5: the voice form is "${normalized}", expected it to end in "r one"`);
  for (const { label, schedule } of schedules(narration, "R1", [RESISTOR])) {
    const name = `fixture 5 (${label})`;
    assertWellFormed(name, schedule, 1);
    const [window] = schedule.targets;
    const spokenAt = spokenTokenStartMs(narration, "R1");
    assert(window!.anchor === "label", `${name}: anchored by ${window!.anchor}, expected label`);
    assert(
      near(window!.startMs, spokenAt, LETTER_TOLERANCE_MS),
      `${name}: R1 starts at ${window!.startMs} ms, spoken at ${spokenAt} ms`,
    );
  }
  for (const spelling of ["notice the current through R one", "notice the current through R_1"]) {
    const [{ schedule }] = schedules(spelling, "R1", [RESISTOR]);
    assert(
      schedule.targets[0]!.anchor === "label",
      `fixture 5: "${spelling}" anchored by ${schedule.targets[0]!.anchor}, expected label`,
    );
  }
}

// 6. Spec order is not spoken order, and a late letter must not lose the
// earlier names: all three still match, in the order the voice names them.
{
  const narration = "the image forms between F and C, so I is real";
  for (const { label, schedule } of schedules(narration, "I_base,F,C", [IMAGE, FOCUS, CENTRE])) {
    const name = `fixture 6 (${label})`;
    assertWellFormed(name, schedule, 3);
    assert(schedule.matchedCount === 3, `${name}: matchedCount ${schedule.matchedCount}, expected 3`);
    const ids = schedule.targets.map((window) => window.id).join(",");
    assert(ids === "I_base,F,C", `${name}: spoken order ${ids}, expected I_base,F,C`);
    assert(schedule.targets[0]!.anchor === "role", `${name}: I_base anchored by ${schedule.targets[0]!.anchor}, expected role (the word image)`);
  }
}

// 7. Nothing named and nothing before the tag: proportional across the second half.
{
  const narration = "look here at this part";
  const totalMs = mathToSpeech(narration).length * MS_PER_CHAR;
  for (const { label, schedule } of schedules(narration, "F,C", [FOCUS, CENTRE], "")) {
    const name = `fixture 7 (${label})`;
    assertWellFormed(name, schedule, 2);
    assert(schedule.matchedCount === 0, `${name}: matchedCount ${schedule.matchedCount}, expected 0`);
    for (const window of schedule.targets) {
      assert(window.anchor === "proportional", `${name}: ${window.id} anchored by ${window.anchor}, expected proportional`);
      assert(window.startMs >= totalMs / 2, `${name}: ${window.id} starts at ${window.startMs} ms, before the second half (${totalMs / 2})`);
    }
    assert(schedule.targets[0]!.id === "F" && schedule.targets[1]!.id === "C", `${name}: proportional targets keep spec order`);
  }
}

console.log("verify-focus-schedule: ok (7 fixtures, timed and estimated)");
