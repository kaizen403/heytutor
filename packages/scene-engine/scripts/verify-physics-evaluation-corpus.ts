import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSupportedSceneOperator } from "../src/validation";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/evaluation/jee-physics-core-v1.json",
);
const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isRecord(raw), "corpus must be an object");
assert(raw.schemaVersion === "jee-physics-evaluation/v1", "unexpected corpus schema");
assert(Array.isArray(raw.domains), "domains must be an array");
assert(Array.isArray(raw.questions), "questions must be an array");
assert(raw.questions.length >= 18 && raw.questions.length <= 30, "corpus must contain 18-30 questions");

const domains = new Set(raw.domains);
const ids = new Set<string>();
const counts = new Map<string, Map<string, number>>();

for (const [index, value] of raw.questions.entries()) {
  assert(isRecord(value), `questions[${index}] must be an object`);
  assert(typeof value.id === "string" && value.id.length > 0, `questions[${index}].id`);
  assert(!ids.has(value.id), `duplicate question id ${value.id}`);
  ids.add(value.id);
  assert(typeof value.domain === "string" && domains.has(value.domain), `${value.id}: unknown domain`);
  assert(["easy", "medium", "hard"].includes(String(value.difficulty)), `${value.id}: invalid difficulty`);
  assert(["p0", "p1", "p2"].includes(String(value.priority)), `${value.id}: invalid priority`);
  assert(typeof value.question === "string" && value.question.length >= 40, `${value.id}: question is too short`);
  assert(value.visualRequirement === "required", `${value.id}: core corpus must require a visual`);
  assert(Array.isArray(value.representations) && value.representations.length > 0, `${value.id}: representations`);
  assert(isRecord(value.expected) && Array.isArray(value.expected.quantities), `${value.id}: expected quantities`);
  assert(isRecord(value.capabilities), `${value.id}: capabilities`);
  assert(Array.isArray(value.capabilities.operators), `${value.id}: operators`);
  for (const operator of value.capabilities.operators) {
    assert(
      typeof operator === "string" && isSupportedSceneOperator(operator),
      `${value.id}: capability corpus names unsupported operator ${String(operator)}`,
    );
  }
  assert(Array.isArray(value.capabilities.assertions), `${value.id}: assertions`);
  assert(Array.isArray(value.capabilities.missingProofs), `${value.id}: missing proofs`);

  for (const [quantityIndex, quantity] of value.expected.quantities.entries()) {
    assert(isRecord(quantity), `${value.id}: quantity ${quantityIndex}`);
    assert(typeof quantity.id === "string" && quantity.id.length > 0, `${value.id}: quantity id`);
    assert(typeof quantity.value === "number" && Number.isFinite(quantity.value), `${value.id}: quantity value`);
    assert(typeof quantity.unit === "string" && quantity.unit.length > 0, `${value.id}: quantity unit`);
    assert(typeof quantity.tolerance === "number" && quantity.tolerance >= 0, `${value.id}: quantity tolerance`);
  }

  const byDifficulty = counts.get(value.domain) ?? new Map<string, number>();
  byDifficulty.set(String(value.difficulty), (byDifficulty.get(String(value.difficulty)) ?? 0) + 1);
  counts.set(value.domain, byDifficulty);
}

for (const domain of domains) {
  const byDifficulty = counts.get(String(domain));
  assert(byDifficulty, `domain ${String(domain)} has no questions`);
  for (const difficulty of ["easy", "medium", "hard"]) {
    assert(byDifficulty.get(difficulty) === 1, `${String(domain)} must have exactly one ${difficulty} question`);
  }
}

const priorityCounts = raw.questions.reduce<Record<string, number>>((result, value) => {
  assert(isRecord(value), "question must remain an object");
  const priority = String(value.priority);
  result[priority] = (result[priority] ?? 0) + 1;
  return result;
}, {});

console.log("verify-physics-evaluation-corpus: ok");
console.log(`  questions=${raw.questions.length} domains=${domains.size} priorities=${JSON.stringify(priorityCounts)}`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
