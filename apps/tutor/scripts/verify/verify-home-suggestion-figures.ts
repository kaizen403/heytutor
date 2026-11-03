/**
 * Every home screen card a student can click has a hand-written oracle row and
 * a judged recording, and today's engine still draws exactly what was judged.
 *
 * The recordings hold each card's accepted lab inputs (turn plan, ProblemIR,
 * the raw planner document). Replay revalidates the planner document and
 * rebuilds the family figure, so a regression in either path fails here.
 *
 * It fails on a moved, reversed, added or lost shape, a solid mark gone dashed,
 * lost or added entities, text changed or moved to another mark, a different
 * source or tier, or no figure. It does NOT see label positions, the caption,
 * reveal order, stroke width or role, or a stray line flagged as a label leader,
 * so a green run is not "nothing a student sees changed". It says nothing about a
 * fresh planner run, or a reference picture a student may see instead. Each
 * verdict rests on one run.
 *
 * When it fails on a real engine change: render, look, and either rejudge ($0,
 * no planner call) or pull the card. See `failureHelp` below.
 *
 * Personalized cards written by the model per student are not covered: only
 * their shape is gated, in verify-landing-suggestions.
 *
 * `--allow-unjudged` exempts only the cards in PARTIAL_FIGURES, which drew a
 * figure judged partial: true, but missing something or hard to read. They have
 * no recording, so their figures can get worse with this gate green. Each needs a
 * right figure or to leave the home screen. Any other card without a judged
 * recording still fails, and the flag fails once the list is empty.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTutorQuestion } from "@heytutor/tutor-core";
import { labArtifactSlug } from "../lecture-lab/diagramEval";
import {
  HOME_SUGGESTION_RECORDING_VERSION,
  homeSuggestionEvalRows,
  isAcceptedVerdict,
  judgementProblem,
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

const PARTIAL_FIGURES: ReadonlyMap<string, string> = new Map([
  ["Explain how capacitance changes when a dielectric is inserted between parallel plates.", "the slab cannot be told apart from the plates, and its label sits by the gap arrow"],
  ["Derive the relation between wave speed, frequency, and wavelength using a traveling wave.", "no direction of travel, and a stray axis label reads as y minus x"],
  ["Explain what dy/dx means geometrically, then show how to differentiate y = x³ − 4x.", "the geometry is exact, but the curve's equation sits on the tangent line"],
  ["A 5 kg block on a smooth horizontal table is pulled by a horizontal force of 20 N. Find its acceleration and the normal force on it.", "N and mg are drawn exactly equal, so length reads as size, and the 20 N arrow at 163 px then reads as more than the 49 N arrow at 112 px, with nothing saying it is not to scale"],
]);

/** Lower this as entries leave. Raising it exempts another card, so a reviewer must catch that: this gate cannot stop an edit to itself. */
const PARTIAL_CEILING = 4;

const failureHelp = `
If you changed the engine on purpose and a judged figure moved:
  1. pnpm exec tsx scripts/lecture-lab/home-suggestions.ts render --out .lecture-lab/home-replay
  2. Look at that card's PNG. Do not judge from this message.
  3. Right: write judged.json and run home-suggestions.ts rejudge --judgements judged.json. No planner call, $0.
  4. Not right: fix the engine, or pull the card: delete its recording and add it to PARTIAL_FIGURES (the owner
     must raise PARTIAL_CEILING), or take it off the lists and add it to verify-home-suggestion-retired.
If you did not mean to change that figure, this is a regression. See docs/agent/lecture-lab.md.`;

const recordingAsksCard = (recording: HomeSuggestionRecording, cardQuestion: string) =>
  recording.question === cardQuestion && recording.selection.question === normalizeTutorQuestion(cardQuestion);

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
  homeSuggestionEvalRows(shown, [...oracle, { ...oracle[0]!, id: "removed-card", question: "A card that was removed." }])
    .problems.some((problem) => problem.includes("no longer shows")),
  "mutation: an oracle row for a removed card must fail",
);

// A partial or wrong figure cannot pass as judged.
for (const verdict of ["wrong", "partial", "", undefined]) {
  assert(!isAcceptedVerdict(verdict), `mutation: verdict ${String(verdict)} must be refused`);
}
for (const verdict of ["right", "text_only_honest"]) assert(isAcceptedVerdict(verdict), `verdict ${verdict} is accepted`);

// 2. Every card has a judged recording that fits its figure need.
const recordings = new Map<string, HomeSuggestionRecording>();
for (const row of rows) {
  const path = join(RECORDINGS_DIR, `${labArtifactSlug(row.id)}.json`);
  if (!existsSync(path)) {
    (allowUnjudged && PARTIAL_FIGURES.has(row.question) ? unjudged : failures).push(`no judged recording for: ${row.question}`);
    continue;
  }
  const recording = JSON.parse(readFileSync(path, "utf8")) as HomeSuggestionRecording;
  if (recording.schemaVersion !== HOME_SUGGESTION_RECORDING_VERSION) failures.push(`stale recording schema: ${path}`);
  // The lab normalizes what it asks (x² becomes x^2), so a replay must ask the normalized card.
  if (!recordingAsksCard(recording, row.question)) failures.push(`recording question differs from the card: ${path}`);
  if (!recording.judged) {
    failures.push(`recording has no verdict: ${row.question}`);
    continue;
  }
  const { verdict } = recording.judged;
  const problem = judgementProblem(recording.judged, recording.expected);
  if (problem) failures.push(`${problem}: ${row.question}`);
  if (row.figure_need === "required" && verdict !== "right") {
    failures.push(`a card that needs a figure must draw a judged right one: ${row.question}`);
  }
  recordings.set(row.question, recording);
}
const known = new Set(rows.map((row) => `${labArtifactSlug(row.id)}.json`));
for (const file of existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR) : []) {
  if (file.endsWith(".json") && !known.has(file)) failures.push(`recording for a card that no longer shows: ${file}`);
}

// The partial list ends: every entry is a live card still without a judged figure, the
// ceiling stops a new entry slipping in, and the flag must go once the list is empty.
if (PARTIAL_FIGURES.size !== PARTIAL_CEILING) failures.push(`PARTIAL_FIGURES has ${PARTIAL_FIGURES.size} cards and the ceiling is ${PARTIAL_CEILING}: lower the ceiling as entries leave; raising it needs the owner`);
if (allowUnjudged && PARTIAL_FIGURES.size === 0) failures.push("no card is exempt any more: remove --allow-unjudged from the gate's registration");
const shownQuestions = new Set(shown.map((card) => card.question));
for (const question of PARTIAL_FIGURES.keys()) {
  if (!shownQuestions.has(question)) failures.push(`partial list names a card that no longer shows: ${question}`);
  if (recordings.has(question)) failures.push(`partial list names a card that now has a judged recording: ${question}`);
}

// 3. Today's engine draws exactly what was judged.
let drawn = 0;
const matching: HomeSuggestionRecording[] = [];
for (const [question, recording] of recordings) {
  let actual: FigureSignature;
  try {
    actual = replayRecording(recording);
  } catch (error) {
    failures.push(`replay threw: ${question}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const differences = signatureDifferences(recording.expected, actual);
  if (differences.length === 0) matching.push(recording);
  if (differences.length > 0) failures.push(`figure changed since it was judged: ${question}: ${differences.join("; ")}`);
  if (actual.drawn) drawn += 1;
}

// The replay is live, not a saved verdict: a recording whose stem no longer
// grounds its figure must stop matching.
// Self-tests use a card that still matches, so one regression cannot hide the others.
const sample = matching.find((recording) => recording.expected.drawn);
const plannerRecording = matching.find((recording) => recording.expected.figureSource === "planner");
if (recordings.size > 0 && !plannerRecording) failures.push("no matching planner figure: the replay self-tests did not run");
// A self-test that fails is one more failure on the list, never an assert that hides the list.
if (sample && plannerRecording) try {
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
  // A run recorded for an older wording cannot stand in for a changed card.
  assert(recordingAsksCard(sample, sample.question), "the sample must ask its own card");
  const reworded = `${sample.question} Show every step.`;
  assert(!recordingAsksCard({ ...sample, question: reworded }, reworded), "mutation: an old run stamped with a changed card must fail");

  // Replay normalizes a raw response as the lab does: a string source still binds to the question.
  assert(plannerRecording.selection.candidate, "a planner recording is needed to test normalization");
  const stringSource: HomeSuggestionRecording = structuredClone(plannerRecording);
  stringSource.selection.candidate = { ...stringSource.selection.candidate!, source: "the student's question" };
  // The tier may rise on a non metric figure, because only the plain source marks it so. The figure itself must not change.
  assert.deepEqual(signatureDifferences(plannerRecording.expected, replayRecording(stringSource)).filter((difference) => !difference.startsWith("tier ")), [], "a string source must replay to the same figure");

  // Layout is not a change: moving and rescaling the whole figure must pass.
  const scene = replaySelection(sample).representation!.renderScene;
  const refit: typeof scene = structuredClone(scene);
  for (const primitive of refit.primitives) {
    primitive.points = primitive.points.map((point) => ({ x: point.x * 0.8 + 37, y: point.y * 0.8 - 11 }));
    if (typeof primitive.radius === "number") primitive.radius *= 0.8;
  }
  assert.notDeepEqual(refit.primitives, scene.primitives, "the refit must move the figure");
  assert.deepEqual(signatureDifferences(actual, { ...actual, marks: marksOf(refit) }), [], "layout: a figure refit must not read as a change");
} catch (error) {
  failures.push(`a replay self-test failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(failureHelp);
  console.error(`verify-home-suggestion-figures: ${failures.length} failure(s) over ${rows.length} cards`);
  process.exit(1);
}
const judged = recordings.size;
for (const line of unjudged) console.log(`  exempt, ${line}`);
console.log(`verify-home-suggestion-figures: ok (${rows.length} cards, ${judged} judged: ${drawn} draw, ${judged - drawn} text only; ${unjudged.length} not judged yet)`);
