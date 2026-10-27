/**
 * Every home screen card a student can click has a hand-written oracle row and
 * a judged recording, and today's engine still draws exactly what was judged.
 *
 * The recordings hold each card's accepted lab inputs (turn plan, ProblemIR,
 * the raw planner document). Replay revalidates the planner document and
 * rebuilds the family figure, so a regression in either path fails here. A
 * figure that changes at all (new or lost entities, different text, different
 * source or tier) fails too: it has not been judged. Re-run the round and judge
 * it again with `scripts/lecture-lab/home-suggestions.ts`. $0, no network.
 *
 * Personalized cards written by the model per student are not covered: only
 * their shape is gated, in verify-landing-suggestions.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { labArtifactSlug } from "../lecture-lab/diagramEval";
import {
  HOME_SUGGESTION_RECORDING_VERSION,
  homeSuggestionEvalRows,
  loadOracle,
  ORACLE_PATH,
  RECORDINGS_DIR,
  replayRecording,
  shownSuggestions,
  signatureDifferences,
  type HomeSuggestionRecording,
} from "../lecture-lab/homeSuggestionCheck";

const failures: string[] = [];
const shown = shownSuggestions();
const oracle = loadOracle(ORACLE_PATH);

// 1. Every card that can show has an oracle row, and no row is stale.
const { rows, problems } = homeSuggestionEvalRows(shown, oracle);
failures.push(...problems);

// The join fails closed in both directions.
const extraCard = { subject: "physics" as const, topic: "New", kind: "lecture", question: "Explain a card nobody measured." };
assert(
  homeSuggestionEvalRows([...shown, extraCard], oracle).problems.some((problem) => problem.includes(extraCard.question)),
  "mutation: a new card without an oracle row must fail",
);
assert(
  homeSuggestionEvalRows(shown.slice(1), oracle).problems.some((problem) => problem.includes("no longer shows")),
  "mutation: an oracle row for a removed card must fail",
);

// 2. Every card has a judged recording that fits its figure need.
const recordings = new Map<string, HomeSuggestionRecording>();
for (const row of rows) {
  const path = join(RECORDINGS_DIR, `${labArtifactSlug(row.id)}.json`);
  if (!existsSync(path)) {
    failures.push(`no judged recording for: ${row.question}`);
    continue;
  }
  const recording = JSON.parse(readFileSync(path, "utf8")) as HomeSuggestionRecording;
  if (recording.schemaVersion !== HOME_SUGGESTION_RECORDING_VERSION) failures.push(`stale recording schema: ${path}`);
  if (recording.question !== row.question || recording.selection.question !== row.question) {
    failures.push(`recording question differs from the card: ${path}`);
  }
  const { verdict } = recording.judged;
  if (verdict === "right" && !recording.expected.drawn) failures.push(`judged right but records no figure: ${row.question}`);
  if (verdict === "text_only_honest" && recording.expected.drawn) failures.push(`judged text only but records a figure: ${row.question}`);
  if (row.figure_need === "required" && verdict !== "right") {
    failures.push(`a card that needs a figure must draw a judged right one: ${row.question}`);
  }
  recordings.set(row.question, recording);
}
const known = new Set(rows.map((row) => `${labArtifactSlug(row.id)}.json`));
for (const file of existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR) : []) {
  if (file.endsWith(".json") && !known.has(file)) failures.push(`recording for a card that no longer shows: ${file}`);
}

// 3. Today's engine draws exactly what was judged.
let drawn = 0;
for (const [question, recording] of recordings) {
  const actual = replayRecording(recording);
  const differences = signatureDifferences(recording.expected, actual);
  if (differences.length > 0) failures.push(`figure changed since it was judged: ${question}: ${differences.join("; ")}`);
  if (actual.drawn) drawn += 1;
}

// The replay is live, not a saved verdict: a recording whose stem no longer
// grounds its figure must stop matching.
const sample = [...recordings.values()].find((recording) => recording.expected.drawn);
if (sample) {
  const unrelated = "What is 2 + 2?";
  const mutated: HomeSuggestionRecording = structuredClone(sample);
  mutated.question = unrelated;
  mutated.selection.question = unrelated;
  mutated.selection.turnPlan = { ...mutated.selection.turnPlan, question: unrelated, visualRequirement: "none" } as typeof mutated.selection.turnPlan;
  assert(
    signatureDifferences(sample.expected, replayRecording(mutated)).length > 0,
    "mutation: a recording replayed against an unrelated stem must not reproduce its figure",
  );
  const dropped: HomeSuggestionRecording = structuredClone(sample);
  dropped.expected = { ...dropped.expected, entityIds: dropped.expected.entityIds.slice(1) };
  assert(signatureDifferences(dropped.expected, replayRecording(sample)).length > 0, "mutation: a lost entity must fail");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`verify-home-suggestion-figures: ${failures.length} failure(s) over ${rows.length} cards`);
  process.exit(1);
}
console.log(`verify-home-suggestion-figures: ok (${rows.length} cards, ${drawn} draw a judged figure, ${rows.length - drawn} judged text only)`);
