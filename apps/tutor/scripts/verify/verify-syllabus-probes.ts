import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SYLLABUS_SUBJECTS,
  countItems,
  flattenItems,
  syllabusTreeFromTaxonomy,
} from "../../features/admin/lib/parseSyllabus";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const REQUIRED_PHYSICS_UNITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
const REQUIRED_CHEMISTRY_UNITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
const REQUIRED_UNIT_IDS = [
  ...REQUIRED_PHYSICS_UNITS.map((unitNumber) => `physics|${unitNumber}`),
  ...REQUIRED_CHEMISTRY_UNITS.map((unitNumber) => `chemistry|${unitNumber}`),
];
const INDEX_STYLE_ID = /^(physics|maths|chemistry)\|\d+\|\d+$/;
/** Regular-unit topics per subject; supplemental units never reach the admin tree. */
const EXPECTED_TOPIC_COUNTS = { physics: 342, maths: 179, chemistry: 132 } as const;
/** Chemistry units carry a curated set of probes, not a full topic by difficulty grid. */
const CHEMISTRY_PROBES_PER_UNIT = { min: 6, max: 12 } as const;
const BANK_QUESTION_ID = /^q_[0-9a-f]{64}$/;
/** The physics generator appended a final "Draw ..." sentence; a chemistry stem must end on the question itself. */
const APPENDED_DRAWING_CUE = /(?:^|[.?!]\s+)(?:Draw|Sketch)\b[^.?!]*[.?!]?\s*$/;

interface ProbeQuestion {
  id: string;
  topicId: string;
  difficulty: string;
  question: string;
  notes?: string;
  source?: { questionId: string | null; exam: string; year: number; documentId: string };
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
assert(
  tree.subjects.chemistry.length === REQUIRED_CHEMISTRY_UNITS.length,
  `admin tree has ${tree.subjects.chemistry.length} chemistry units, expected ${REQUIRED_CHEMISTRY_UNITS.length}`,
);

for (const item of flattenItems(tree)) {
  assert(!INDEX_STYLE_ID.test(item.id), `index-style syllabus id leaked into admin tree: ${item.id}`);
  assert(!item.id.includes("|supplemental|"), `supplemental topic leaked into admin tree: ${item.id}`);
}

for (const subject of SYLLABUS_SUBJECTS) {
  const topics = tree.subjects[subject].reduce((sum, unit) => sum + unit.items.length, 0);
  assert(topics === EXPECTED_TOPIC_COUNTS[subject], `admin ${subject} topic count drifted: ${topics}`);
}
// Every regular-unit topic across the three subjects: 342 physics + 179 maths + 132 chemistry.
assert(countItems(tree) === 653, `admin physics+maths+chemistry topic count drifted: ${countItems(tree)}`);

const topicsByUnitId = new Map<string, string[]>();
for (const subject of SYLLABUS_SUBJECTS) {
  for (const unit of tree.subjects[subject]) {
    topicsByUnitId.set(`${subject}|${unit.number}`, unit.items.map((item) => item.id));
  }
}

for (const unitId of REQUIRED_UNIT_IDS) {
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

for (const unitId of REQUIRED_UNIT_IDS) {
  const required = `${unitId.replace("|", "-unit-")}.json`;
  assert(probeFiles.includes(required), `missing syllabus probe file ${required}`);
}

const seenIds = new Set<string>();
const PROBE_FILE_NAME = /^(physics|maths|chemistry)-unit-(\d+)\.json$/;

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
  const isChemistry = fileMatch[1] === "chemistry";
  if (isChemistry) {
    assert(
      probes.questions.length >= CHEMISTRY_PROBES_PER_UNIT.min && probes.questions.length <= CHEMISTRY_PROBES_PER_UNIT.max,
      `${file}: expected ${CHEMISTRY_PROBES_PER_UNIT.min} to ${CHEMISTRY_PROBES_PER_UNIT.max} chemistry probes, got ${probes.questions.length}`,
    );
  } else {
    assert(
      probes.questions.length === topicIds.length * DIFFICULTIES.length,
      `${file}: expected 3 questions per topic in ${expectedUnitId} (${topicIds.length * DIFFICULTIES.length}), got ${probes.questions.length}`,
    );
  }

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
    if (isChemistry) {
      const source = probe.source;
      assert(source && typeof source === "object", `${file}: ${probe.id} is missing source`);
      assert(typeof source.exam === "string" && source.exam.length > 0, `${file}: ${probe.id} source.exam is missing`);
      assert(Number.isInteger(source.year), `${file}: ${probe.id} source.year is not an integer`);
      assert(typeof source.documentId === "string" && source.documentId.length > 0, `${file}: ${probe.id} source.documentId is missing`);
      if (source.questionId === null) {
        assert(
          source.exam === "authored" && source.documentId === "chemistry-probe-authoring",
          `${file}: ${probe.id} has no bank questionId, so it must be marked authored`,
        );
      } else {
        assert(BANK_QUESTION_ID.test(source.questionId), `${file}: ${probe.id} has a malformed bank questionId`);
      }
      assert(!APPENDED_DRAWING_CUE.test(probe.question.trim()), `${file}: ${probe.id} ends with a drawing cue`);
    }

    const difficulties = byTopic.get(probe.topicId) ?? new Set<string>();
    difficulties.add(probe.difficulty);
    byTopic.set(probe.topicId, difficulties);
  }

  if (isChemistry) {
    const covered = byTopic.size;
    assert(covered >= Math.min(topicIds.length, 4), `${file}: probes cover only ${covered} of ${topicIds.length} topics`);
  }
  for (const topicId of isChemistry ? [] : topicIds) {
    const difficulties = byTopic.get(topicId);
    assert(difficulties, `${file}: missing probes for ${topicId}`);
    for (const difficulty of DIFFICULTIES) {
      assert(difficulties.has(difficulty), `${file}: missing ${difficulty} probe for ${topicId}`);
    }
  }
}

console.log(`verify-syllabus-probes: all checks passed (${probeFiles.length} files, ${seenIds.size} questions)`);
