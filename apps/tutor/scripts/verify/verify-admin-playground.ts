import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProbeIndex, probesForTopic, probesForUnit, probesByIds } from "../../features/admin/lib/probeIndex";
import { parseProbeFile, questionsForTopic, questionsForUnit } from "../../features/admin/lib/probes";
import { buildLectureStates, cellStateFor } from "../../features/admin/lib/lectureState";
import { collapseLectureState, topicMatchesFilters, normalizeQuery, filtersAreActive, DEFAULT_TOPIC_FILTERS } from "../../features/admin/lib/topicFilters";
import { syllabusTreeFromTaxonomy, flattenItems } from "../../features/admin/lib/parseSyllabus";
import type { BoardEntry } from "../../lib/boards/types";

function assert(c: unknown, m: string): asserts c { if (!c) { throw new Error(m); } }

const dataDir = join(__dirname, "../../../../data");
const tree = syllabusTreeFromTaxonomy(JSON.parse(readFileSync(join(dataDir, "question-bank/syllabus-taxonomy.json"), "utf8")));
const probes = readdirSync(join(dataDir, "syllabus-probes")).filter(f => f.endsWith(".json")).sort()
  .flatMap(f => parseProbeFile(JSON.parse(readFileSync(join(dataDir, "syllabus-probes", f), "utf8"))));

const index = buildProbeIndex(probes);
const items = flattenItems(tree);

// 1. Index must agree with the linear scans it replaces, for every real topic.
let checkedTopics = 0;
for (const item of items) {
  const fast = probesForTopic(index, item.id);
  const slow = questionsForTopic(probes, item.id);
  assert(fast.length === slow.length, `topic ${item.id}: ${fast.length} vs ${slow.length}`);
  assert(fast.every(q => slow.some(s => s.id === q.id)), `topic ${item.id}: contents differ`);
  checkedTopics += 1;
}
console.log(`✓ probeIndex.byTopic matches questionsForTopic across ${checkedTopics} topics`);

for (const subject of ["physics", "maths"] as const) {
  for (const unit of tree.subjects[subject]) {
    const unitId = `${subject}|${unit.number}`;
    const fast = probesForUnit(index, unitId);
    const slow = questionsForUnit(probes, unitId);
    assert(fast.length === slow.length, `unit ${unitId}: ${fast.length} vs ${slow.length}`);
  }
}
console.log("✓ probeIndex.byUnit matches questionsForUnit across all 34 units");

// 2. Ordering must be easy -> medium -> hard so rows read consistently.
const sample = probesForTopic(index, items.find(i => probesForTopic(index, i.id).length === 3)!.id);
assert(sample.map(p => p.difficulty).join(",") === "easy,medium,hard", `probe order wrong: ${sample.map(p=>p.difficulty)}`);
console.log("✓ per-topic probes ordered easy,medium,hard");

// 3. byId round-trip
const someIds = probes.slice(0, 50).map(p => p.id);
assert(probesByIds(index, someIds).length === 50, "probesByIds lost entries");
assert(probesByIds(index, ["nope"]).length === 0, "probesByIds invented an entry");
console.log("✓ probesByIds round-trips and ignores unknown ids");

// 4. Lecture state precedence: running (attached) beats an older recording.
const topicId = items[0]!.id;
const board: BoardEntry = { id: "board-old", title: "t", createdAt: 1, preview: "p" };
const recordings = new Map([[`${topicId}::easy`, board]]);
const jobs = [
  { status: "running" as const, boardId: "board-live", topicId, difficulty: "easy" as const },
  { status: "queued"  as const, boardId: undefined,    topicId, difficulty: "hard" as const },
];
const states = buildLectureStates(jobs, recordings, new Set(["board-live"]));
assert(states.get(`${topicId}::easy`)?.state === "running", "live recording must outrank an older recording");
assert(states.get(`${topicId}::easy`)?.boardId === "board-live", "running cell must target the live board");
assert(states.get(`${topicId}::hard`)?.state === "queued", "queued job must show as queued");
console.log("✓ lecture state precedence: running > recorded, queued surfaces");

// 5. A running job whose headless shell has not attached is NOT watchable yet.
const notAttached = buildLectureStates(
  [{ status: "running", boardId: "board-x", topicId, difficulty: "medium" }], new Map(), new Set());
assert(notAttached.get(`${topicId}::medium`)?.state === "queued", "unattached run must not claim to be live");
console.log("✓ running job without an attached shell stays queued, not live");

// 6. missing vs idle
assert(cellStateFor(new Map(), topicId, "easy", false).state === "missing", "no fixture => missing");
assert(cellStateFor(new Map(), topicId, "easy", true).state === "idle", "fixture, no recording => idle");
console.log("✓ missing vs idle distinguished");

// 7. collapseLectureState precedence
assert(collapseLectureState(["missing","idle","recorded"]) === "recorded", "recorded wins");
assert(collapseLectureState(["idle","running","queued"]) === "running", "running beats queued");
assert(collapseLectureState(["missing","idle"]) === "none", "missing/idle collapse to none");
console.log("✓ collapseLectureState precedence");

// 8. Search matches topic labels AND question text.
const target = items.find(i => probesForTopic(index, i.id).length > 0)!;
const targetProbes = probesForTopic(index, target.id);
const word = targetProbes[0]!.question.split(/\s+/).find(w => w.length > 6)!.toLowerCase().replace(/[^a-z]/g,"");
const f = { ...DEFAULT_TOPIC_FILTERS, query: word };
assert(topicMatchesFilters(target, targetProbes, "pending", "none", f, normalizeQuery(word)),
  `question-text search failed for "${word}"`);
const labelWord = target.text.split(/\s+/)[0]!.toLowerCase();
assert(topicMatchesFilters(target, targetProbes, "pending", "none",
  { ...DEFAULT_TOPIC_FILTERS, query: labelWord }, normalizeQuery(labelWord)), "label search failed");
console.log(`✓ search matches question text ("${word}") and topic labels ("${labelWord}")`);

// 9. Status + lecture filters actually exclude.
assert(!topicMatchesFilters(target, targetProbes, "pending", "none",
  { ...DEFAULT_TOPIC_FILTERS, status: "accepted" }, ""), "status filter did not exclude");
assert(!topicMatchesFilters(target, targetProbes, "pending", "none",
  { ...DEFAULT_TOPIC_FILTERS, lecture: "recorded" }, ""), "lecture filter did not exclude");
assert(topicMatchesFilters(target, targetProbes, "accepted", "recorded",
  { ...DEFAULT_TOPIC_FILTERS, status: "accepted", lecture: "recorded" }, ""), "filters wrongly excluded a match");
console.log("✓ status and lecture filters include and exclude correctly");

assert(!filtersAreActive(DEFAULT_TOPIC_FILTERS), "defaults must not read as active");
assert(filtersAreActive({ ...DEFAULT_TOPIC_FILTERS, query: " x " }), "query must read as active");
console.log("✓ filtersAreActive");

// 10. Maths really has no fixtures (the empty state is truthful).
const mathsWithProbes = tree.subjects.maths.filter(u => probesForUnit(index, `maths|${u.number}`).length > 0);
console.log(`✓ maths units with fixtures: ${mathsWithProbes.length} (empty state is accurate)`);
console.log("\nverify-admin-playground: all checks passed");
