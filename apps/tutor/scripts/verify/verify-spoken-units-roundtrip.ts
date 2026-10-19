/**
 * What the voice is sent for the lines recorded in the Accelute full lesson
 * videos on 19 Oct 2026, from the written text to the exact speech string.
 *
 * Every input below is copied from a recorded lesson (teaching.txt with its
 * commands removed, the figure step captions in chat.json, or the English
 * rain lesson). English speech is `mathToSpeech`; the Hinglish voice gets
 * `sarvamSpeechText(mathToSpeech(...))`, which is the order the client and
 * the TTS route apply them in. Before this gate:
 *
 *   "t (s)"          was spoken "t solid"
 *   "v (m/s)"        was spoken "v (m over s)"
 *   "(4, 20)"        reached the voice as a bracketed pair of numbers
 *   "t in s"         and "t = 4 s" kept a bare letter s ("four s")
 *   "½"              had no word at all
 *   "10 km/h"        reached the English voice raw ("kilometer by H")
 *   the figure tour  said "reaches 20 m s" and "t 4 s" for the roles
 *                    "reaches 20 m/s at t=4 s" and "t = 4 s on time axis"
 */
import assert from "node:assert/strict";
import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import { findSpokenToken, mathToSpeech } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { sarvamSpeechText } from "../../lib/tts/sarvamProtocol";

let passed = 0;
function check(name: string, run: () => void): void {
  run();
  passed++;
  console.log(`  ✓ ${name}`);
}

const hinglish = (text: string) => sarvamSpeechText(mathToSpeech(text));

/** [written, English speech, Hinglish speech]. */
const RECORDED: [string, string, string][] = [
  // v2/p4c-t5 teaching step 2.
  ["देखो यह velocity-time graph है, जहाँ vertical axis v (m/s) और horizontal axis t (s) है.",
    "देखो यह velocity-time graph है, जहाँ vertical axis v in meters per second और horizontal axis t in seconds है.",
    "देखो यह velocity-time graph है, जहाँ vertical axis v in meters per second और horizontal axis t in seconds है."],
  // v2/p4e2-t1 teaching step 2.
  ["figure में t (s); a (m/s²) के horizontal axis पर time है और vertical axis पर acceleration है.",
    "figure में t in seconds; a in meters per second squared के horizontal axis पर time है और vertical axis पर acceleration है.",
    "figure में t in seconds; a in meters per second squared के horizontal axis पर time है और vertical axis पर acceleration है."],
  // v2/p4e1-t1 teaching step 2.
  ["t (s) horizontal time axis है; velocity vertical axis पर है.",
    "t in seconds horizontal time axis है; velocity vertical axis पर है.",
    "t in seconds horizontal time axis है; velocity vertical axis पर है."],
  // v2/p4c-t5 teaching step 3.
  ["graph पर यह point \"0\" है जहाँ car rest में है t equals zero पर, और यह point \"(4, 20)\" है जहाँ car twenty meters per second पर पहुँचती है t equals four seconds पर.",
    "graph पर यह point \"0\" है जहाँ car rest में है t equals zero पर, और यह point \"4 comma 20\" है जहाँ car twenty meters per second पर पहुँचती है t equals four seconds पर.",
    "graph पर यह point \"zero\" है जहाँ car rest में है t equals zero पर, और यह point \"four comma twenty\" है जहाँ car twenty meters per second पर पहुँचती है t equals four seconds पर."],
  // v2/p4c-t5 teaching step 4.
  ["अब यहाँ t = 4 s से t = 10 s तक graph horizontal है, मतलब velocity constant twenty meters per second है.",
    "अब यहाँ t equals 4 s से t equals 10 s तक graph horizontal है, मतलब velocity constant twenty meters per second है.",
    "अब यहाँ t equals four seconds से t equals ten seconds तक graph horizontal है, मतलब velocity constant twenty meters per second है."],
  // v2/p4e1-t1 teaching steps 3, 4 and 6.
  ["notice (0,0), यहाँ particle zero time पर rest में है.",
    "notice 0 comma 0, यहाँ particle zero time पर rest में है.",
    "notice zero comma zero, यहाँ particle zero time पर rest में है."],
  ["notice (2,10), two seconds पर velocity positive ten meters per second हो गई.",
    "notice 2 comma 10, two seconds पर velocity positive ten meters per second हो गई.",
    "notice two comma ten, two seconds पर velocity positive ten meters per second हो गई."],
  ["notice (10,-10), ten seconds पर velocity negative x direction में है.",
    "notice 10 comma minus 10, ten seconds पर velocity negative x direction में है.",
    "notice ten comma minus ten, ten seconds पर velocity negative x direction में है."],
  // v2/p4c-t5 runtime figure step captions.
  ["ध्यान दो: Set up the velocity-time axes: v in m/s vertically, t in s horizontally.",
    "ध्यान दो: Set up the velocity-time axes: v in meters per second vertically, t in seconds horizontally.",
    "ध्यान दो: Set up the velocity-time axes: v in meters per second vertically, t in seconds horizontally."],
  ["ध्यान दो: Plot the motion: straight line from (0, 0) to (4, 20) while the car speeds up, then horizontal at v = 20 m/s until t = 10 s.",
    "ध्यान दो: Plot the motion: straight line from 0 comma 0 to 4 comma 20 while the car speeds up, then horizontal at v equals 20 meters per second until t equals 10 s.",
    "ध्यान दो: Plot the motion: straight line from zero comma zero to four comma twenty while the car speeds up, then horizontal at v equals twenty meters per second until t equals ten seconds."],
  ["ध्यान दो: Area under the graph equals distance: triangle d₁ = ½ × 4 × 20 = 40 m, rectangle d₂ = 6 × 20 = 120 m, total 160 m.",
    "ध्यान दो: Area under the graph equals distance: triangle d 1 equals half times 4 times 20 equals 40 m, rectangle d 2 equals 6 times 20 equals 120 m, total 160 m.",
    "ध्यान दो: Area under the graph equals distance: triangle d one equals half times four times twenty equals forty meters, rectangle d two equals six times twenty equals one hundred twenty meters, total one hundred sixty meters."],
  ["ध्यान दो: Area under the graph equals distance: triangle ½×4×20 = 40 m, rectangle 6×20 = 120 m, total 160 m.",
    "ध्यान दो: Area under the graph equals distance: triangle half times 4 times 20 equals 40 m, rectangle 6 times 20 equals 120 m, total 160 m.",
    "ध्यान दो: Area under the graph equals distance: triangle half times four times twenty equals forty meters, rectangle six times twenty equals one hundred twenty meters, total one hundred sixty meters."],
  // Motion in a Plane q02, the English rain lesson.
  ["At 5 km/h east, the girl observes vertical rain.",
    "At 5 kilometers per hour east, the girl observes vertical rain.",
    "At five kilometers per hour east, the girl observes vertical rain."],
  ["The unchanged true rain velocity is 10 km/h, downward and eastward at 30 degrees to the vertical.",
    "The unchanged true rain velocity is 10 kilometers per hour, downward and eastward at 30 degrees to the vertical.",
    "The unchanged true rain velocity is ten kilometers per hour, downward and eastward at thirty degrees to the vertical."],
];

console.log("Recorded lines, written to spoken\n");
check(`${RECORDED.length} recorded lines speak their units, points and fractions as words`, () => {
  for (const [written, english, hindi] of RECORDED) {
    assert.equal(mathToSpeech(written), english, `English speech for: ${written}`);
    assert.equal(hinglish(written), hindi, `Hinglish speech for: ${written}`);
    for (const spoken of [english, hindi]) {
      assert.doesNotMatch(spoken, /\bsolid\b|\(\s*[-\d]|km\s*\/|\bover s\b|½/, `raw notation left for the voice: ${spoken}`);
    }
    // The Hinglish voice reads a digit as a Hindi numeral and a bare unit as a letter.
    assert.doesNotMatch(hindi, /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twenty|forty|sixty) (?:s|m)\b/, `bare digit or unit letter in Hinglish speech: ${hindi}`);
  }
});

check("chemistry state symbols after a formula are still states", () => {
  assert.equal(mathToSpeech("NaCl(s) and CO_2 (g) and Fe (s)"), "NaCl solid and CO 2 gas and Fe solid");
  // Function notation and a grouped number are not units or points.
  assert.equal(mathToSpeech("v(8) and (1,000) and λ = h/p"), "v(8) and (1,000) and lambda equals h over p");
  // A spaced product keeps its letters for the Hinglish voice.
  assert.equal(hinglish("so 2 m g sinθ and 4 m squared"), "so two m g sine theta and four m squared");
});

check("a spaced variable after a number is not read as a unit", () => {
  // g, m and h name a quantity as often as a unit: "2 g" is twice the
  // acceleration of free fall, "2 m" twice a mass, "2 h" twice a height.
  const VARIABLES: [string, string, string][] = [
    ["acceleration 2 g hai", "acceleration 2 g hai", "acceleration two g hai"],
    ["block ka mass 2 m hai", "block ka mass 2 m hai", "block ka mass two m hai"],
    ["masses m aur 2 m hain", "masses m aur 2 m hain", "masses m aur two m hain"],
    ["height 2 h hai", "height 2 h hai", "height two h hai"],
  ];
  for (const [written, english, hindi] of VARIABLES) {
    assert.equal(mathToSpeech(written), english, `English speech for: ${written}`);
    assert.equal(hinglish(written), hindi, `Hinglish speech for: ${written}`);
  }
  // A bare h is never an hour outside a speed.
  assert.equal(mathToSpeech("y (h)"), "y (h)");
  assert.equal(mathToSpeech("plug x in h"), "plug x in h");
  assert.equal(mathToSpeech("10 km/h and 60 km/hr"), "10 kilometers per hour and 60 kilometers per hour");
});

check("a spaced meter or second that ends its quantity is still a unit", () => {
  const UNITS: [string, string][] = [
    ["t equals 4 s se", "t equals four seconds se"],
    ["4 s", "four seconds"],
    ["40 m, rectangle", "forty meters, rectangle"],
    ["total 160 m.", "total one hundred sixty meters."],
    ["total 160 m", "total one hundred sixty meters"],
    ["40 m se", "forty meters se"],
    ["40 m me", "forty meters me"],
    ["40 m ka", "forty meters ka"],
    ["40 m ki", "forty meters ki"],
    ["40 m ko", "forty meters ko"],
    ["40 m से", "forty meters से"],
    ["कुल 160 m।", "कुल one hundred sixty meters."],
  ];
  for (const [written, hindi] of UNITS) assert.equal(hinglish(written), hindi, `Hinglish speech for: ${written}`);
});

console.log("\nThe pen still finds each board label inside its spoken sentence\n");
const CUES: [string, string][] = [
  ["t (s)", "देखो यह velocity-time graph है, जहाँ vertical axis v (m/s) और horizontal axis t (s) है."],
  ["v (m/s)", "देखो यह velocity-time graph है, जहाँ vertical axis v (m/s) और horizontal axis t (s) है."],
  ["(4, 20)", "और यह point \"(4, 20)\" है जहाँ car twenty meters per second पर पहुँचती है."],
  ["(2,10)", "notice (2,10), two seconds पर velocity positive ten meters per second हो गई."],
  ["t = 4 s", "अब यहाँ t = 4 s से t = 10 s तक graph horizontal है."],
];
check(`${CUES.length} recorded focus labels are found in their sentence after speech rewriting`, () => {
  for (const [label, sentence] of CUES) {
    assert(findSpokenToken(mathToSpeech(sentence), mathToSpeech(label).trim()) >= 0,
      `label "${label}" (spoken "${mathToSpeech(label)}") lost in: ${mathToSpeech(sentence)}`);
  }
});

console.log("\nThe figure tour names a part by its written role\n");
// The graph group of v2/p4c-t5, with the roles the scene planner wrote.
const ROLES: [string, string][] = [
  ["graph", "velocity-time graph of the car"],
  ["drop1", "ordinate at t = 4 s"],
  ["p1", "reaches 20 m/s at t=4 s"],
  ["p2", "steady until t=10 s"],
  ["f1", "t = 4 s on time axis"],
  ["f2", "t = 10 s on time axis"],
];
const tourDocument: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: "A car accelerates uniformly from rest to 20 m/s in 4 s, then moves at constant speed until t = 10 s." },
  visualDecision: { mode: "scene", reason: "recorded roles" }, quantities: [],
  entities: ROLES.map(([id, role]) => ({ id, kind: id === "graph" ? "polyline" : id === "drop1" ? "segment" : "point", role })),
  constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: ROLES.map(([id]) => id),
  revealGroups: [{ id: "graph_group", entityIds: ROLES.map(([id]) => id), dependsOn: [], narrationCue: "show scene" }],
  teachingTimeline: [],
};
const tourScene: RenderScene = {
  engineVersion: "scene-engine/2.0.0", revealGroups: tourDocument.revealGroups, timeline: [], entityBounds: {},
  primitives: [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `graph_${index}`, entityId: "graph", groupId: "graph_group", kind: "line" as const,
      points: [{ x: 450, y: 600 - index * 2 }, { x: 650, y: 300 - index * 2 }, { x: 1100, y: 300 - index * 2 }],
    })),
    { id: "drop1_line", entityId: "drop1", groupId: "graph_group", kind: "line", points: [{ x: 650, y: 300 }, { x: 650, y: 600 }] },
    { id: "p1_point", entityId: "p1", groupId: "graph_group", kind: "point", points: [{ x: 650, y: 300 }] },
    { id: "p2_point", entityId: "p2", groupId: "graph_group", kind: "point", points: [{ x: 1100, y: 300 }] },
    { id: "f1_point", entityId: "f1", groupId: "graph_group", kind: "point", points: [{ x: 650, y: 600 }] },
    { id: "f2_point", entityId: "f2", groupId: "graph_group", kind: "point", points: [{ x: 1100, y: 600 }] },
  ],
};
for (const language of ["hinglish", "english"] as const) {
  check(`the ${language} tour speaks "20 m/s" and "t = 4 s", not "20 m s" and "t 4 s"`, () => {
    const presentation = buildVerifiedDiagramPresentation(tourDocument, tourScene, { narrationLanguage: language });
    const tour = presentation.introSegments.map((segment) => segment.narration).join(" ");
    assert.match(tour, /reaches 20 m\/s/, `the tour must name the role as written: ${tour}`);
    assert.match(tour, /\bt = 4 s\b/, `the tour must name the role as written: ${tour}`);
    assert.doesNotMatch(tour, /\b20 m s\b|\bt 4 s\b|\bt 10 s\b/, `punctuation stripped from a role: ${tour}`);
    const spoken = language === "hinglish" ? hinglish(tour) : mathToSpeech(tour);
    assert.match(spoken, language === "hinglish" ? /reaches twenty meters per second/ : /reaches 20 meters per second/, spoken);
    assert.match(spoken, language === "hinglish" ? /t equals four seconds/ : /t equals 4 s/, spoken);
    for (const segment of presentation.introSegments) {
      for (const command of segment.commands ?? []) {
        if (!command.spokenCue?.token) continue;
        assert(findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0,
          `the scheduler must still find "${command.spokenCue.token}" in: ${segment.narration}`);
      }
    }
  });
}

console.log(`\nAll ${passed} spoken unit checks passed`);
