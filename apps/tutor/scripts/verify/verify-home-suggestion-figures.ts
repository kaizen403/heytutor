/**
 * Every home screen card a student can click has a hand-written oracle row and
 * a judged recording, and today's engine still draws exactly what was judged.
 *
 * The recordings hold each card's accepted lab inputs (turn plan, ProblemIR,
 * the raw planner document). Replay revalidates the planner document and
 * rebuilds the family figure, so a regression in either path fails here. A
 * figure that changes at all (a moved or reversed shape, new or lost entities,
 * text on a different mark, a different source or tier) fails too: it has not
 * been judged. Refitting the whole figure and moving labels are layout and pass. Re-run the round and judge
 * it again with `scripts/lecture-lab/home-suggestions.ts`. $0, no network.
 *
 * Personalized cards written by the model per student are not covered: only
 * their shape is gated, in verify-landing-suggestions.
 *
 * `--allow-unjudged` reports cards with no recording instead of failing, for
 * use only until the first judged round lands. Everything else stays strict.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { labArtifactSlug } from "../lecture-lab/diagramEval";
import {
  HOME_SUGGESTION_RECORDING_VERSION,
  homeSuggestionEvalRows,
  loadOracle,
  marksOf,
  ORACLE_PATH,
  RECORDINGS_DIR,
  replayRecording,
  replaySelection,
  shownSuggestions,
  signatureDifferences,
  type FigureSignature,
  type HomeSuggestionRecording,
} from "../lecture-lab/homeSuggestionCheck";

const failures: string[] = [];
const unjudged: string[] = [];
const allowUnjudged = process.argv.includes("--allow-unjudged");
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
    (allowUnjudged ? unjudged : failures).push(`no judged recording for: ${row.question}`);
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
  const actual = replayRecording(sample);
  assert.deepEqual(signatureDifferences(sample.expected, actual), [], "the sample must match before it is mutated");
  const expectMutationCaught = (name: string, change: (signature: FigureSignature) => void) => {
    const mutatedSignature: FigureSignature = structuredClone(actual);
    change(mutatedSignature);
    assert.notDeepEqual(mutatedSignature, actual, `mutation must change the signature: ${name}`);
    assert(signatureDifferences(mutatedSignature, actual).length > 0, `mutation: ${name} must fail`);
  };
  const arrow = actual.marks.find((mark) => mark.points.length >= 2 && mark.kind !== "polyline");
  assert(arrow, "the sample needs a straight mark to reverse");
  const arrowIndex = actual.marks.indexOf(arrow);
  expectMutationCaught("a lost entity", (signature) => { signature.entityIds = signature.entityIds.slice(1); });
  expectMutationCaught("a reversed arrow", (signature) => { signature.marks[arrowIndex]!.points.reverse(); });
  expectMutationCaught("a moved point", (signature) => { signature.marks[arrowIndex]!.points[0]![1] += 40; });
  expectMutationCaught("a solid mark drawn dashed", (signature) => { signature.marks[arrowIndex]!.dashed = !signature.marks[arrowIndex]!.dashed; });
  expectMutationCaught("a lost mark", (signature) => { signature.marks.splice(arrowIndex, 1); });
  expectMutationCaught("a label on the wrong mark", (signature) => { signature.texts[0] = `other: ${signature.texts[0]!.split(": ").slice(1).join(": ")}`; });
  // Layout is not a change: moving and rescaling the whole figure must pass.
  const scene = replaySelection(sample).representation!.renderScene;
  const refit: typeof scene = structuredClone(scene);
  for (const primitive of refit.primitives) {
    primitive.points = primitive.points.map((point) => ({ x: point.x * 0.8 + 37, y: point.y * 0.8 - 11 }));
    if (typeof primitive.radius === "number") primitive.radius *= 0.8;
  }
  assert.notDeepEqual(refit.primitives, scene.primitives, "the refit must move the figure");
  assert.deepEqual(signatureDifferences(actual, { ...actual, marks: marksOf(refit) }), [], "layout: a figure refit must not read as a change");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`verify-home-suggestion-figures: ${failures.length} failure(s) over ${rows.length} cards`);
  process.exit(1);
}
const judged = recordings.size;
console.log(`verify-home-suggestion-figures: ok (${rows.length} cards, ${judged} judged: ${drawn} draw, ${judged - drawn} text only; ${unjudged.length} not judged yet)`);
