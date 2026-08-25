import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countItems, flattenItems, syllabusTreeFromTaxonomy } from "../../features/admin/lib/parseSyllabus";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const REQUIRED_PHYSICS_UNITS = [1, 2, 3, 4] as const;
const INDEX_STYLE_ID = /^(physics|maths)\|\d+\|\d+$/;

interface ProbeQuestion {
  id: string;
  topicId: string;
  difficulty: string;
  question: string;
  notes?: string;
}

interface ProbeFile {
  schemaVersion: string;
  unitId: string;
  questions: ProbeQuestion[];
}

const repoRoot = resolve(process.cwd(), "../..");
const taxonomy = JSON.parse(
  readFileSync(resolve(repoRoot, "data/question-bank/syllabus-taxonomy.json"), "utf8"),
) as unknown;
const tree = syllabusTreeFromTaxonomy(taxonomy);

assert(tree.subjects.physics.length > 0, "admin tree is missing physics units");
assert(tree.subjects.maths.length > 0, "admin tree is missing maths units");

for (const item of flattenItems(tree)) {
  assert(!INDEX_STYLE_ID.test(item.id), `index-style syllabus id leaked into admin tree: ${item.id}`);
  assert(!item.id.includes("|supplemental|"), `supplemental topic leaked into admin tree: ${item.id}`);
}

assert(countItems(tree) === 521, `admin physics+maths topic count drifted: ${countItems(tree)}`);

const topicsByUnitId = new Map<string, string[]>();
for (const subject of ["physics", "maths"] as const) {
  for (const unit of tree.subjects[subject]) {
    topicsByUnitId.set(`${subject}|${unit.number}`, unit.items.map((item) => item.id));
  }
}

for (const unitNumber of REQUIRED_PHYSICS_UNITS) {
  const unitId = `physics|${unitNumber}`;
  const topicIds = topicsByUnitId.get(unitId);
  assert(topicIds && topicIds.length > 0, `taxonomy is missing exam-grain topics for ${unitId}`);
  assert(
    topicIds.every((topicId) => !INDEX_STYLE_ID.test(topicId)),
    `${unitId} still has index-style topic ids`,
  );
}

const probesDir = resolve(repoRoot, "data/syllabus-probes");
const probeFiles = readdirSync(probesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const unitNumber of REQUIRED_PHYSICS_UNITS) {
  const required = `physics-unit-${unitNumber}.json`;
  assert(probeFiles.includes(required), `missing syllabus probe file ${required}`);
}

const seenIds = new Set<string>();
const PROBE_FILE_NAME = /^(physics|maths)-unit-(\d+)\.json$/;

for (const file of probeFiles) {
  const fileMatch = PROBE_FILE_NAME.exec(file);
  assert(fileMatch, `unexpected syllabus probe filename ${file}`);

  const probes = JSON.parse(readFileSync(resolve(probesDir, file), "utf8")) as ProbeFile;
  const expectedUnitId = `${fileMatch[1]}|${fileMatch[2]}`;
  const topicIds = topicsByUnitId.get(expectedUnitId);

  assert(probes.schemaVersion === "syllabus-probes/v1", `${file}: unexpected schemaVersion`);
  assert(probes.unitId === expectedUnitId, `${file}: unitId must be ${expectedUnitId}`);
  assert(Array.isArray(probes.questions), `${file}: missing questions`);
  assert(topicIds, `${file}: ${expectedUnitId} is not in the taxonomy`);
  assert(
    probes.questions.length === topicIds.length * DIFFICULTIES.length,
    `${file}: expected 3 questions per topic in ${expectedUnitId} (${topicIds.length * DIFFICULTIES.length}), got ${probes.questions.length}`,
  );

  const byTopic = new Map<string, Set<string>>();
  for (const probe of probes.questions) {
    assert(typeof probe.id === "string" && probe.id.length > 0, `${file}: probe is missing id`);
    assert(typeof probe.topicId === "string" && probe.topicId.length > 0, `${file}: ${probe.id} is missing topicId`);
    assert(
      typeof probe.question === "string" && probe.question.trim().length > 0,
      `${file}: ${probe.id} is missing question text`,
    );
    assert(!seenIds.has(probe.id), `${file}: duplicate probe id ${probe.id}`);
    seenIds.add(probe.id);
    assert(topicIds.includes(probe.topicId), `${file}: ${probe.id} topicId is not in ${expectedUnitId}: ${probe.topicId}`);
    assert(
      (DIFFICULTIES as readonly string[]).includes(probe.difficulty),
      `${file}: ${probe.id} has invalid difficulty ${probe.difficulty}`,
    );
    assert(probe.id === `${probe.topicId}|${probe.difficulty}`, `${file}: ${probe.id} must be topicId|difficulty`);

    const difficulties = byTopic.get(probe.topicId) ?? new Set<string>();
    difficulties.add(probe.difficulty);
    byTopic.set(probe.topicId, difficulties);
  }

  for (const topicId of topicIds) {
    const difficulties = byTopic.get(topicId);
    assert(difficulties, `${file}: missing probes for ${topicId}`);
    for (const difficulty of DIFFICULTIES) {
      assert(difficulties.has(difficulty), `${file}: missing ${difficulty} probe for ${topicId}`);
    }
  }
}

console.log(`verify-syllabus-probes: all checks passed (${probeFiles.length} files, ${seenIds.size} questions)`);
