import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedSceneOperator } from "../../src/document/validation";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/evaluation/math-visual-core-v1.json",
);
const corpus = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

assert(isRecord(corpus), "math visual corpus must be an object");
assert(corpus.schemaVersion === "math-visual-evaluation/v1", "unexpected math visual corpus version");
assert(Array.isArray(corpus.families) && corpus.families.length >= 5, "corpus must cover at least five capability families");
assert(Array.isArray(corpus.questions) && corpus.questions.length >= 12, "corpus must contain at least twelve questions");

const families = new Set(corpus.families.filter((value): value is string => typeof value === "string"));
const ids = new Set<string>();
const difficultyCounts = new Map<string, number>();
const requiredMutationKinds = new Set([
  "wrong_root_sign",
  "swapped_region_boundaries",
  "detached_tangent",
  "wrong_axis",
  "dimension_collision",
  "internal_join_counted_exposed",
]);
const observedMutationKinds = new Set<string>();

for (const [index, question] of corpus.questions.entries()) {
  assert(isRecord(question), `questions[${index}] must be an object`);
  assert(typeof question.id === "string" && question.id.length > 0, `questions[${index}] requires an id`);
  assert(!ids.has(question.id), `duplicate question id ${question.id}`);
  ids.add(question.id);
  assert(typeof question.family === "string" && families.has(question.family), `${question.id}: unknown family`);
  assert(["easy", "medium", "hard"].includes(String(question.difficulty)), `${question.id}: invalid difficulty`);
  difficultyCounts.set(String(question.difficulty), (difficultyCounts.get(String(question.difficulty)) ?? 0) + 1);
  assert(typeof question.question === "string" && question.question.length >= 50, `${question.id}: question is too short`);
  assert(Array.isArray(question.representations) && question.representations.length > 0, `${question.id}: representations required`);
  assert(isRecord(question.expected) && Array.isArray(question.expected.quantities), `${question.id}: expected quantities required`);
  assert(isRecord(question.capabilities), `${question.id}: capabilities required`);
  assert(Array.isArray(question.capabilities.operators) && question.capabilities.operators.length > 0, `${question.id}: operators required`);
  for (const operator of question.capabilities.operators) {
    assert(
      typeof operator === "string" && isSupportedSceneOperator(operator),
      `${question.id}: capability corpus names unsupported operator ${String(operator)}`,
    );
  }
  assert(Array.isArray(question.capabilities.assertions), `${question.id}: assertions required`);
  assert(Array.isArray(question.mutations) && question.mutations.length >= 3, `${question.id}: at least three mutations required`);

  for (const mutation of question.mutations) {
    assert(typeof mutation === "string" && mutation.length > 0, `${question.id}: invalid mutation`);
    observedMutationKinds.add(mutation);
  }
  for (const [quantityIndex, quantity] of question.expected.quantities.entries()) {
    assert(isRecord(quantity), `${question.id}: quantity ${quantityIndex} must be an object`);
    assert(typeof quantity.id === "string" && quantity.id.length > 0, `${question.id}: quantity id required`);
    assert(typeof quantity.value === "number" && Number.isFinite(quantity.value), `${question.id}: quantity value must be finite`);
    assert(typeof quantity.unit === "string" && quantity.unit.length > 0, `${question.id}: quantity unit required`);
  }
}

for (const difficulty of ["easy", "medium", "hard"]) {
  assert((difficultyCounts.get(difficulty) ?? 0) >= 3, `corpus requires at least three ${difficulty} questions`);
}
for (const mutation of requiredMutationKinds) {
  assert(observedMutationKinds.has(mutation), `missing release-critical mutation ${mutation}`);
}

console.log("verify-math-evaluation-corpus: ok");
console.log(`  questions=${ids.size} families=${families.size} mutations=${observedMutationKinds.size}`);
