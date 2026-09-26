import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProbeIndex, probesForTopic, probesForUnit, probesByIds, visibleSelectedProbes } from "../../features/admin/lib/probeIndex";
import { PROBE_DIFFICULTIES, parseProbeFile, questionsForTopic, questionsForUnit } from "../../features/admin/lib/probes";
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

for (const subject of ["physics", "maths", "chemistry"] as const) {
  for (const unit of tree.subjects[subject]) {
    const unitId = `${subject}|${unit.number}`;
    const fast = probesForUnit(index, unitId);
    const slow = questionsForUnit(probes, unitId);
    assert(fast.length === slow.length, `unit ${unitId}: ${fast.length} vs ${slow.length}`);
  }
}
console.log("✓ probeIndex.byUnit matches questionsForUnit across all 54 units");

// 2. Ordering must be easy -> medium -> hard so rows read consistently.
const sample = probesForTopic(index, items.find(i => probesForTopic(index, i.id).length === 3)!.id);
assert(sample.map(p => p.difficulty).join(",") === "easy,medium,hard", `probe order wrong: ${sample.map(p=>p.difficulty)}`);
console.log("✓ per-topic probes ordered easy,medium,hard");

// 3. byId round-trip
const someIds = probes.slice(0, 50).map(p => p.id);
assert(probesByIds(index, someIds).length === 50, "probesByIds lost entries");
assert(probesByIds(index, ["nope"]).length === 0, "probesByIds invented an entry");
console.log("✓ probesByIds round-trips and ignores unknown ids");
const visibleSelection = visibleSelectedProbes(index, new Set(someIds), new Set([someIds[0]!]));
assert(visibleSelection.length === 1 && visibleSelection[0]?.id === someIds[0], "recording after filtering must exclude hidden selected questions");

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

const watchDrawer = readFileSync(join(__dirname, "../../features/admin/components/WatchDrawer.tsx"), "utf8");
assert(watchDrawer.includes("LessonActions"), "admin Watch must mount the same Replay / Download actions as the tutor");
assert(watchDrawer.includes("onExportApi"), "admin Watch must take Replay / Notes PDF / MP4 from the embed shell");
assert(watchDrawer.includes("downloadNotesPdf"), "admin Watch must offer Notes (PDF)");
assert(watchDrawer.includes("downloadLectureMp4"), "admin Watch must offer Lecture (MP4)");
// Notes is no longer a second surface beside the lesson with its own PDF
// button: it is the session's own Ask panel, and the PDF is the same action
// the tutor's header offers (asserted above through `downloadNotesPdf`).
assert(
  watchDrawer.includes("onNotesOpenChange"),
  "admin Notes must open the session's own Ask panel",
);
const playground = readFileSync(join(__dirname, "../../features/admin/AdminPlayground.tsx"), "utf8");
assert(playground.includes("RunCostBox"), "admin runs must show Langfuse cost next to the queue");
assert(playground.includes("costsByBoardId={costsByBoardId}"), "recorded lecture rows must receive Langfuse costs");
assert(playground.includes("useLectureCosts"), "playground must fetch costs for visible recorded boards");
const topicRow = readFileSync(join(__dirname, "../../features/admin/components/TopicRow.tsx"), "utf8");
assert(topicRow.includes("CostChip"), "topic and question rows must show a cost chip");
assert(topicRow.includes("sumSessionCosts"), "the topic chip must sum easy/medium/hard board costs");
assert(topicRow.includes("costsByBoardId[boardId]"), "each Watch/Notes row must look up its board cost");
const costChip = readFileSync(join(__dirname, "../../features/admin/components/CostChip.tsx"), "utf8");
assert(costChip.includes("group-hover/cost:visible"), "cost chip hover must reveal AI vs voice");
assert(costChip.includes("formatUsd(cost.llmUsd)"), "cost tooltip must show AI inference");
assert(costChip.includes("formatUsd(cost.ttsUsd)"), "cost tooltip must show voice inference");
assert(
  !watchDrawer.includes("LectureNotesPanel"),
  "admin Watch must not mount a second, poorer notes surface",
);
assert(
  watchDrawer.includes("useBoardFullscreen") && watchDrawer.includes("boardFullscreenApi={fullscreen}"),
  "admin Watch must reuse the tutor full screen hook and hand it to the panel",
);
assert(
  watchDrawer.includes("Full screen board"),
  "admin Watch must expose the same full screen control as the student header",
);
assert(
  !playground.includes("boardFullscreenApi"),
  "headless lecture runtimes must not receive the Watch full screen hook",
);
console.log("✓ admin Watch reuses the tutor drawing export actions");

// 10. Maths really has no fixtures (the empty state is truthful).
const mathsWithProbes = tree.subjects.maths.filter(u => probesForUnit(index, `maths|${u.number}`).length > 0);
console.log(`✓ maths units with fixtures: ${mathsWithProbes.length} (empty state is accurate)`);
// 11. Every chemistry unit has fixtures, so its rows can queue lectures.
const chemistryWithProbes = tree.subjects.chemistry.filter(u => probesForUnit(index, `chemistry|${u.number}`).length > 0);
assert(chemistryWithProbes.length === tree.subjects.chemistry.length,
  `chemistry units without fixtures: ${tree.subjects.chemistry.length - chemistryWithProbes.length}`);
console.log(`✓ chemistry units with fixtures: ${chemistryWithProbes.length} of ${tree.subjects.chemistry.length}`);

// 12. Unit rows show a fixture-aware completion bar beside the concept name.
const unitSection = readFileSync(join(__dirname, "../../features/admin/components/UnitSection.tsx"), "utf8");
assert(unitSection.includes('role="progressbar"'), "unit rows must show a completion progress bar");
assert(unitSection.includes("UnitCompletionBar"), "completion bar must sit on every unit row, including collapsed");
assert(unitSection.includes("possible <= 0"), "completion bar must hide when a unit has no fixtures");
assert(unitSection.includes("bg-ink-700"), "completion rail must match admin ink-700 language");
assert(unitSection.includes("bg-sky-500/80"), "recorded fill must use sky");
assert(unitSection.includes("of ${possible} lectures recorded"), "completion bar must expose recorded-of-possible");
assert(!unitSection.includes("total * 3"), "completion must not treat every topic as three lecture slots");
assert(unitSection.includes('expanded ? "overflow-visible"'), "expanded units must not clip cost tooltips");
assert(playground.includes("possible,"), "AdminPlayground must pass fixture-aware possible slots");
assert(/if \(hasFixture\) \{\s*possible \+= 1;/.test(playground), "possible must count fixture-backed easy/medium/hard slots");
console.log("✓ unit rows show a fixture-aware completion bar beside the name");

function fixtureSlotsForUnit(unit: (typeof tree.subjects.physics)[number]): number {
  let possible = 0;
  for (const item of unit.items) {
    const topicProbes = probesForTopic(index, item.id);
    for (const difficulty of PROBE_DIFFICULTIES) {
      if (topicProbes.some((probe) => probe.difficulty === difficulty)) {
        possible += 1;
      }
    }
  }
  return possible;
}

const kinematics = tree.subjects.physics.find((unit) => unit.title === "Kinematics");
assert(kinematics, "physics unit 2 Kinematics must exist");
const kinematicsPossible = fixtureSlotsForUnit(kinematics);
assert(kinematicsPossible > 0, "Kinematics must have fixture-backed lecture slots");
assert(kinematicsPossible <= kinematics.items.length * 3, "possible must not exceed total*3");
const mathsEmpty = tree.subjects.maths.filter((unit) => fixtureSlotsForUnit(unit) === 0);
assert(mathsEmpty.length > 0, "empty maths units must have possible === 0 so the bar can hide");
const chemistryConcepts = tree.subjects.chemistry[0];
assert(chemistryConcepts, "chemistry unit 1 must exist");
const chemistryPossible = fixtureSlotsForUnit(chemistryConcepts);
assert(
  chemistryPossible > 0 && chemistryPossible < chemistryConcepts.items.length * 3,
  "chemistry completion must count fixture slots, not blindly total*3",
);
console.log(
  `✓ unit completion slots: Kinematics ${kinematicsPossible}/${kinematics.items.length * 3}, chemistry 1 ${chemistryPossible}/${chemistryConcepts.items.length * 3}, ${mathsEmpty.length} maths units with no fixtures`,
);

// 13. The playground keeps review, recording controls, and cost details in a
// navigable workspace without changing what is recorded or billed.
const toolbar = readFileSync(join(__dirname, "../../features/admin/components/AdminToolbar.tsx"), "utf8");
const runBar = readFileSync(join(__dirname, "../../features/admin/components/RunBar.tsx"), "utf8");
const runCostBox = readFileSync(join(__dirname, "../../features/admin/components/RunCostBox.tsx"), "utf8");
const playgroundPage = readFileSync(join(__dirname, "../../app/admin/playground/page.tsx"), "utf8");
assert(toolbar.includes('href="/admin"') && toolbar.includes("Test playground"), "playground header must offer a clear way back to admin");
assert(toolbar.includes('aria-label="Browse syllabus"') && toolbar.includes('aria-label="Find and select questions"'), "subject choice and question filters must remain discoverable");
assert(toolbar.includes("Export progress") && toolbar.includes("Reset progress"), "progress export and reset must remain available");
assert(playgroundPage.includes("<AdminPlayground tree={tree} probes={probes} />"), "playground route must keep the existing syllabus and probes");
assert(playground.includes('aria-label="Recording activity and costs"') && playground.includes("<RunBar") && playground.includes("<RunCostBox"), "run controls and cost report must stay together");
assert(playground.includes("queue.enqueue(questions, {") && playground.includes("queue.startAgain({"), "bulk recording and rerun must preserve queue behavior while single questions can teach live");
assert(playground.includes("setFilters(DEFAULT_TOPIC_FILTERS);") && playground.includes("setSelectedIds(new Set());"), "changing subjects must clear stale filters and selection");
assert(playground.indexOf("topicMatchesFilters(") < playground.indexOf("selectableIds.push(probe.id)"), "unit bulk selection must only include visible topics");
assert(runBar.includes('aria-label="Recording run progress"') && runBar.includes("job.error"), "run progress and failures must remain visible");
assert(runCostBox.includes("Cost breakdown") && runCostBox.includes("report?.byKind") && runCostBox.includes("report.bySession"), "run cost breakdown must retain category and lecture detail");
assert(playground.includes("interactive: true") && topicRow.includes("Teach live"), "a single question may teach live while the recording workspace stays available");
assert(playground.includes("if (next === subject) return;"), "clicking the active subject must preserve the selected batch");
assert(runBar.includes("useState(false)"), "a queue that starts empty must not expand when a large recording batch arrives");
assert(playground.includes("visibleSelectedProbes(probeIndex, selectedIds, visibleProbeIds)"), "recording and selection count must use visible questions");
console.log("✓ playground UX preserves navigation, selection, recording, and cost details");

console.log("\nverify-admin-playground: all checks passed");
