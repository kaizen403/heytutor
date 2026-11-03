/**
 * Cards pulled from the home screen stay pulled. Each one failed a full lab
 * lesson judged from its render (round home-20261103b), or drew a wrong figure
 * for a student. A card returns only by being measured again and judged right,
 * and then being taken off this list. Matching is on the exact card text, so a
 * reworded card is not caught.
 * This does not stop a student typing the same question: the causes are in the
 * engine, the planner and the lesson, and are tracked separately.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANDING_SUGGESTIONS } from "../../features/tutor-session/constants";
import { fallbackHomeSuggestions, suggestionsForSubjects } from "../../lib/account/homeSuggestions";
import { AVAILABLE_SUBJECTS, type SubjectId } from "../../lib/account/types";

const RETIRED: ReadonlyArray<{ question: string; why: string }> = [
  {
    question: "Derive the formula for the range of a projectile on level ground, and show why 45° gives the maximum range.",
    why: "drew right once in the lab, then wrong for a student (turn 748d3adb): the landing point sat at about one sixth of R",
  },
  {
    question: "Explain how to draw a free-body diagram for a block on a rough incline, and show how friction enters Newton's second law.",
    why: "drew the block inside the wedge, under the surface",
  },
  {
    question: "Show how two point charges produce an electric field on the line joining them, and explain where that field can be zero.",
    why: "the farther of two identical unlabelled charges had the longer field arrow",
  },
  {
    question: "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
    why: "asks for a drawing and drew none; its plan held a false verified image distance",
  },
  {
    question: "Draw 3-methylbut-1-ene and give the major product when it reacts with HBr.",
    why: "asks for a drawing and drew none; the lesson taught the wrong major product",
  },
];

const cardSources = [
  new URL("../../features/tutor-session/constants.ts", import.meta.url),
  new URL("../../lib/account/homeSuggestions.ts", import.meta.url),
].map((url) => readFileSync(url, "utf8"));

const retiredInSource = (sources: readonly string[]) =>
  RETIRED.filter(({ question }) => sources.some((source) => source.includes(question)));

// Every profile the app can build, including none and a coming-soon-only one.
const profiles: SubjectId[][] = [[], ["dsa"], ...AVAILABLE_SUBJECTS.map((subject) => [subject])];
profiles.push([...AVAILABLE_SUBJECTS], [...AVAILABLE_SUBJECTS].reverse());
function retiredShown(): string[] {
  const shown = new Set(LANDING_SUGGESTIONS.map((card) => card.question));
  for (const subjects of profiles) {
    for (const card of suggestionsForSubjects(subjects)) shown.add(card.question);
    for (let cursor = 0; cursor < 60; cursor += 1) {
      for (const card of fallbackHomeSuggestions(subjects, cursor)) shown.add(card.question);
    }
  }
  return RETIRED.filter(({ question }) => shown.has(question)).map(({ question }) => question);
}

assert.deepEqual(retiredShown(), [], "no profile or rotation may show a retired card");
assert.deepEqual(retiredInSource(cardSources), [], "a retired card must not be in the card lists");

// The source check catches a card put back, whichever list it goes into.
for (const { question } of RETIRED) {
  for (const index of [0, 1]) {
    const mutated = [...cardSources];
    mutated[index] = `${mutated[index]}\n"${question}"\n`;
    assert.notEqual(mutated[index], cardSources[index], "the mutation must change the source");
    assert(retiredInSource(mutated).some((card) => card.question === question), `mutation: restoring a retired card must fail: ${question}`);
  }
}

// Removing cards must not empty a rotation or leave a subject short of a lesson or a problem.
for (const subject of AVAILABLE_SUBJECTS) {
  const cards = suggestionsForSubjects([subject]);
  assert.equal(new Set(cards.map((card) => card.question)).size, cards.length, `${subject}: cards must be unique`);
  assert(cards.length >= 4, `${subject}: the empty board must keep at least four cards`);
  for (let cursor = 0; cursor < 60; cursor += 1) {
    const rotation = fallbackHomeSuggestions([subject], cursor);
    assert.equal(new Set(rotation.map((card) => card.question)).size, rotation.length, `${subject} rotation ${cursor}: cards must be unique`);
    assert.equal(rotation.length, 5, `${subject} rotation ${cursor}: the route only renders a full set of 5`);
  }
}

console.log(`verify-home-suggestion-retired: ok (${RETIRED.length} cards stay out across ${profiles.length} profiles)`);
