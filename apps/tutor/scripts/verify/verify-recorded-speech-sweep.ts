/**
 * What the voice was sent in the recorded YouTube lessons, sent again through
 * today's rules.
 *
 * The fixture holds every spoken line (the exact TTS request text) and every
 * teaching narration line from the v1, v2, v3 and projectile recordings whose
 * speech, on main 565cb1781, still carried a hazard:
 *
 *   "v_{A over B}" and "v_(zero)"     a brace or bracket group was read out
 *   "vₓ_zero", "v {x zero}"           a letter subscript had no reading
 *   "for jee from the basics"         the opening lowercased an acronym
 *
 * Each line goes through `mathToSpeech` and then `sarvamSpeechText`, the order
 * the client and the Hinglish route apply them in, and must come out with no
 * brace, underscore or caret and no lowercase jee. A bare m keeps main's
 * reading (PR #274 review): it is said as meters only where main's end of
 * quantity list says its quantity ends, because a bare m is a mass as often
 * as a meter ("Ab 3 m par lagne wale forces" was spoken "three meters par").
 * The bare m left in the recorded lines is listed exactly below: unclear as a
 * letter, never false. The opening is rebuilt from the recorded question,
 * because the recorded line is the old rule's output: it must keep acronyms and symbol
 * case, and its ask must never stop mid phrase.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isConceptLessonQuestion, lessonOpeningLine, mathToSpeech } from "@heytutor/tutor-core";
import { sarvamSpeechText } from "../../lib/tts/sarvamProtocol";

interface RecordedLesson {
  id: string;
  question: string;
  opening: string;
  language: "hinglish" | "english";
  lines: string[];
  raw: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const { lessons } = JSON.parse(
  readFileSync(resolve(here, "fixtures/recorded-speech-2026-10-20.json"), "utf8"),
) as { lessons: RecordedLesson[] };

const NUMBER = "(?:\\d|\\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand))";
const BARE_M = new RegExp(`${NUMBER} m(?![\\p{L}\\p{N}_])`, "gu");
/**
 * What may follow a bare m without it ending a quantity: a product's next
 * letter or operator word, or a verb of being ("block ka mass 2 m hai").
 */
const CONTINUES = /^\s+(?:[A-Za-z](?![\p{L}\p{N}_])|(?:times|squared|cubed|over|plus|minus|into|by|per|hai|hain|है|हैं|is|are|was|were|equals)(?![\p{L}\p{N}_]))/u;

/** Each bare m left ending a quantity, as "<number word> m <next word>". */
const leftBareM = new Set<string>();

function hazards(spoken: string, id: string): string[] {
  const found: string[] = [];
  if (/[{}_^]/.test(spoken)) found.push("a brace, underscore or caret");
  if (/\bjee\b/.test(spoken)) found.push("a lowercase jee");
  for (const match of spoken.matchAll(BARE_M)) {
    const rest = spoken.slice(match.index! + match[0].length);
    if (!CONTINUES.test(rest)) {
      const word = /^\s*(\S*)/u.exec(rest)?.[1] ?? "";
      const head = /(\S+)\s+m$/u.exec(spoken.slice(0, match.index! + match[0].length))?.[1] ?? "";
      leftBareM.add(`${id}: ${head} m ${word}`.trim());
    }
  }
  return found;
}

/** An ask that stops on a word waiting for the rest of its phrase. */
const DANGLING_ASK = /\basks(?:,| for| you to) [^.]*\b(?:just|and|or|but|the|a|an|of|to|at|how many \w+|the (?:instants|points|moments))\. /;

assert.ok(lessons.length >= 60, `the recorded speech fixture did not load (${lessons.length} lessons)`);

let lines = 0;
const failures: string[] = [];
for (const lesson of lessons) {
  for (const line of [...lesson.lines, ...lesson.raw]) {
    lines++;
    const spoken = sarvamSpeechText(mathToSpeech(line));
    for (const hazard of hazards(spoken, lesson.id)) failures.push(`${lesson.id}: ${hazard} in "${spoken}"`);
  }
  const kind = isConceptLessonQuestion(lesson.question) ? "concept" : "problem";
  for (const hasBoardOpening of [true, false]) {
    const opening = lessonOpeningLine({ question: lesson.question, kind, hasBoardOpening, language: lesson.language });
    const spoken = sarvamSpeechText(mathToSpeech(opening));
    for (const hazard of hazards(spoken, `${lesson.id} opening`)) failures.push(`${lesson.id} opening: ${hazard} in "${spoken}"`);
    if (DANGLING_ASK.test(opening)) failures.push(`${lesson.id} opening: the ask stops mid phrase in "${opening}"`);
  }
}
assert.equal(failures.length, 0, `${failures.length} recorded lines still reach the voice wrong:\n${failures.join("\n")}`);

// The bare m main's rule leaves: its quantity does not visibly end, so the
// letter stays. Each is unclear, none is false. A new entry here is a length
// the rule stopped reading; a missing one is a context it started reading.
const LEFT_BARE_M = [
  "v2/p1c-t1: +ten m divided",
  "v2/p1c-t1: +ten m net",
  "v2/p1c-t1: forty m turnaround",
  "v2/p1c-t1: seventy m divided",
  "v2/p1c-t1: seventy m पूरे",
  "v2/p1c-t1: ten m final",
  "v2/p1c-t1: zero m initial",
  "v2/p1c-t5: ten m ;",
  "v2/p1e2-t1: eighty m west",
  "v2/p1e2-t1: forty m east",
  "v2/p3e2-t1: five m above",
  "v2/p3e2-t2: five m above",
  "v2/p4c-t3: sixty m of",
  "v2/p4e1-t1: seventy m ;",
  "v2/p5e2-t1: thirty m displacement.",
  "v2/p5e2-t2: thirty m point,",
  "v2/p5e2-t2: thirty m आगे",
  "youtube/q05-t3: fifteen m वाली",
  "youtube/q06-t1: eighty m tower",
  "youtube/q06-t1: sixty m from",
  "youtube/q07-t1: forty m roof",
  "youtube/q08-t1: three m on",
  "youtube/q08-t3: two m less",
  "youtube/q10-t1: y(twenty m )",
  "youtube/q17-t2: one m :",
  "youtube/q19-t1: five m down",
];
assert.deepEqual([...leftBareM].sort(), [...LEFT_BARE_M].sort(), "the bare m left in the recorded lines");

// The exact readings, so a rewrite that only hides the hazard still fails.
const hinglish = (text: string) => sarvamSpeechText(mathToSpeech(text));
const EXACT: [string, string][] = [
  // v3/p1c-t2 teaching, steps 1 and 13.
  ["यहाँ v_A car A की velocity है और v_B car B की velocity है, और हमें निकालनी है v_{A/B} और v_{B/A}.",
    "यहाँ v A car A की velocity है और v B car B की velocity है, और हमें निकालनी है v A relative to B और v B relative to A."],
  ["check करो, relative velocities antisymmetric होती हैं, तो v_{A/B} equals minus v_{B/A}, और plus five equals minus of minus five.",
    "check करो, relative velocities antisymmetric होती हैं, तो v A relative to B equals minus v B relative to A, और plus five equals minus of minus five."],
  // The same line as recorded, after the old rules had already run once.
  ["तो v_{A over B} equals minus v_{B over A}.", "तो v A relative to B equals minus v B relative to A."],
  // v2/p3e2-t1 spoken lines 6 and 7.
  ["release के तुरंत बाद packet की velocity क्या होगी: v_(0) equals?.", "release के तुरंत बाद packet की velocity क्या होगी: v zero equals?."],
  ["ground पर height zero चुनेंगे, तो y_(ground) equals 0.", "ground पर height zero चुनेंगे, तो y ground equals zero."],
  // Projectile q05: the board's own Unicode subscript, and the givens row.
  ["figure में vₓ₀ equals 24 m/s", "figure में v x zero equals twenty four meters per second"],
  ["Given... v {x 0} equals 24 m/s.", "Given... v x zero equals twenty four meters per second."],
  // "over" after a number keeps main's reading (PR #274 review): "2 s over
  // g" is a formula, so no "over" pair is read as a unit ratio here.
  ["Given... g equals 10 m over s².", "Given... g equals ten m over s squared."],
  // A bare m keeps main's reading (PR #274 review): meters only where main's
  // end of quantity list says the quantity ends, otherwise the letter.
  ["अब x equals 40 m turnaround position है, इसलिए x B equals forty meters.",
    "अब x equals forty m turnaround position है, इसलिए x B equals forty meters."],
  ["The stone lands 160 m from the foot.", "The stone lands one hundred sixty m from the foot."],
  ["the distance up the incline is 21 m: the landing point.", "the distance up the incline is twenty one m: the landing point."],
  ["At release, the packet is 75 m above the ground.", "At release, the packet is seventy five m above the ground."],
  ["figure में 240 m east पहले walk की distance है", "figure में two hundred forty m east पहले walk की distance है"],
  ["अब 30 m आगे की position है", "अब thirty m आगे की position है"],
  ["देखो, h equals 40 m roof से ground तक", "देखो, h equals forty m roof से ground तक"],
  ["y(20 m) equals 15 m.", "y(twenty m) equals fifteen meters."],
  // A grouped number is one number, read by main's end of quantity rule.
  ["the track is 1,000 m.", "the track is one thousand meters."],
  ["block ka mass 2 m hai", "block ka mass two m hai"],
  ["Two blocks of masses 2 m and 3 m are joined", "Two blocks of masses two m and three m are joined"],
  ["Block A has mass 2 m and block B has mass m", "Block A has mass two m and block B has mass m"],
  ["Take a mass of 3 m on the incline; it slides 5 m down.", "Take a mass of three m on the incline; it slides five m down."],
];
for (const [written, expected] of EXACT) assert.equal(hinglish(written), expected, `speech for: ${written}`);

// A mass not named "mass" in its own clause (PR #274 review). The cut length
// rule said "meters" in each; main's reading keeps the letter.
const NO_METERS: [string, string][] = [
  ["Ab 3 m par lagne wale forces dekhte hain.", "Ab three m par lagne wale forces dekhte hain."],
  ["अब 3 m पर tension ऊपर की तरफ लगता है।", "अब three m पर tension ऊपर की तरफ लगता है."],
  ["Now draw the forces on 3 m on the incline.", "Now draw the forces on three m on the incline."],
  ["The tension acts on 2 m to the right.", "The tension acts on two m to the right."],
  ["Two blocks of masses 2 m and 3 m are joined. Now the string pulls 3 m up the incline.",
    "Two blocks of masses two m and three m are joined. Now the string pulls three m up the incline."],
];
for (const [written, expected] of NO_METERS) {
  const spoken = hinglish(written);
  assert.doesNotMatch(spoken, /\bmeters?\b/, `a mass was said as meters: ${written} -> ${spoken}`);
  assert.equal(spoken, expected, `speech for: ${written}`);
}

console.log(`recorded speech sweep: ${lines} recorded lines and ${lessons.length * 2} rebuilt openings reach the voice clean`);
