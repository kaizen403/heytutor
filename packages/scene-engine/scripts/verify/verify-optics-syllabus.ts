import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPTICS_VISUAL_FAMILIES,
  evaluateOpticsLaw,
  isOpticsLawId,
} from "../../src/physics/opticsLaws";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/evaluation/optics-syllabus-v1.json",
);
const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;

assert(isRecord(raw), "corpus must be an object");
assert(raw.schemaVersion === "optics-syllabus-evaluation/v1", "unexpected corpus schema");
assert(Array.isArray(raw.topics) && raw.topics.length === 15, "corpus must cover 15 syllabus topics");
assert(Array.isArray(raw.cases) && raw.cases.length === 45, "corpus must contain 45 cases");

const topicIds = new Set(raw.topics.map((topic, index) => {
  assert(isRecord(topic), `topics[${index}] must be an object`);
  assert(typeof topic.id === "string" && topic.id.length > 0, `topics[${index}].id`);
  assert(typeof topic.title === "string" && topic.title.length > 10, `topics[${index}].title`);
  return topic.id;
}));
const ids = new Set<string>();
const levelsByTopic = new Map<string, Set<string>>();

for (const [index, value] of raw.cases.entries()) {
  assert(isRecord(value), `cases[${index}] must be an object`);
  assert(typeof value.id === "string" && !ids.has(value.id), `invalid or duplicate id at cases[${index}]`);
  ids.add(value.id);
  assert(typeof value.topic === "string" && topicIds.has(value.topic), `${value.id}: unknown topic`);
  assert(["conceptual", "normal", "advanced"].includes(String(value.level)), `${value.id}: invalid level`);
  assert(["explain", "solve"].includes(String(value.mode)), `${value.id}: invalid mode`);
  assert(typeof value.question === "string" && value.question.length >= 70, `${value.id}: question is too short`);
  assert(Array.isArray(value.visualFamilies) && value.visualFamilies.length > 0, `${value.id}: visual families`);
  for (const family of value.visualFamilies) {
    assert(
      typeof family === "string" && OPTICS_VISUAL_FAMILIES.has(family),
      `${value.id}: unsupported visual family ${String(family)}`,
    );
  }
  const levels = levelsByTopic.get(value.topic) ?? new Set<string>();
  levels.add(String(value.level));
  levelsByTopic.set(value.topic, levels);

  if (value.level === "conceptual") {
    assert(value.mode === "explain", `${value.id}: conceptual case must explain`);
    continue;
  }
  assert(isRecord(value.law), `${value.id}: solve case requires a law oracle`);
  assert(isOpticsLawId(value.law.id), `${value.id}: unsupported law ${String(value.law.id)}`);
  assert(isRecord(value.law.inputs), `${value.id}: law inputs`);
  assert(isRecord(value.law.expected), `${value.id}: law expected outputs`);
  assert(typeof value.law.tolerance === "number" && value.law.tolerance >= 0, `${value.id}: law tolerance`);
  const actual = evaluateOpticsLaw(value.law.id, value.law.inputs);
  for (const [key, expected] of Object.entries(value.law.expected)) {
    assert(typeof expected === "number", `${value.id}: expected ${key} must be numeric`);
    const actualValue = actual[key];
    assert(typeof actualValue === "number" && Number.isFinite(actualValue), `${value.id}: missing finite ${key}`);
    assert(
      Math.abs(actualValue - expected) <= value.law.tolerance,
      `${value.id}: ${key} expected ${expected}, got ${actualValue}`,
    );
  }
}

for (const topic of topicIds) {
  const levels = levelsByTopic.get(topic);
  assert(levels?.size === 3, `${topic}: must include conceptual, normal, and advanced cases`);
  for (const level of ["conceptual", "normal", "advanced"]) {
    assert(levels.has(level), `${topic}: missing ${level}`);
  }
}

console.log("verify-optics-syllabus: ok");
console.log(`  topics=${topicIds.size} cases=${raw.cases.length} laws=${raw.cases.filter((item) => isRecord(item) && isRecord(item.law)).length}`);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
