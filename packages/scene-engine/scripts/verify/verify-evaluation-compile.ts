/**
 * Every pinned math/physics eval question must compile.
 * Operator-name coverage is not enough: the demanded operators must compose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument } from "../../src/compile/compiler";
import { isExecutableSceneProofPredicate } from "../../src/capability/capabilityManifest";
import { validateSceneDocument } from "../../src/document/validation";
import { EVALUATION_COMPILE_PROBES } from "../probes/evaluationCompileProbes";
import { PHYSICS_EVALUATION_COMPILE_PROBES } from "../probes/evaluationPhysicsProbes";

const GENERIC_OPERATORS = new Set(["point", "label", "segment", "line"]);
const PROBES: Record<string, Record<string, unknown>> = {
  ...EVALUATION_COMPILE_PROBES,
  ...PHYSICS_EVALUATION_COMPILE_PROBES,
};

const here = dirname(fileURLToPath(import.meta.url));

interface EvalQuestion {
  id: string;
  question: string;
  capabilities: { operators: string[]; assertions: string[] };
}

function loadQuestions(relativePath: string, key: string): EvalQuestion[] {
  const raw = JSON.parse(readFileSync(join(here, relativePath), "utf8")) as Record<string, unknown>;
  const questions = raw[key];
  if (!Array.isArray(questions)) throw new Error(`${relativePath}: missing ${key}`);
  return questions as EvalQuestion[];
}

function constructionOperators(candidate: Record<string, unknown>): Set<string> {
  const constructions = Array.isArray(candidate.constructions) ? candidate.constructions : [];
  return new Set(
    constructions
      .map((item) => (typeof item === "object" && item !== null ? (item as { operator?: unknown }).operator : null))
      .filter((operator): operator is string => typeof operator === "string"),
  );
}

function assertionPredicates(candidate: Record<string, unknown>): Set<string> {
  const assertions = Array.isArray(candidate.assertions) ? candidate.assertions : [];
  return new Set(
    assertions
      .map((item) => (typeof item === "object" && item !== null ? (item as { predicate?: unknown }).predicate : null))
      .filter((predicate): predicate is string => typeof predicate === "string"),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const questions = [
  ...loadQuestions("../../fixtures/evaluation/math-visual-core-v1.json", "questions"),
  ...loadQuestions("../../fixtures/evaluation/jee-physics-core-v1.json", "questions"),
];

if (questions.length === 0) {
  throw new Error("verify-evaluation-compile: no fixture questions loaded; the gate would pass vacuously");
}

const failures: string[] = [];

for (const question of questions) {
  const probe = PROBES[question.id];
  if (!probe) {
    failures.push(`${question.id}: missing compile oracle`);
    continue;
  }
  const used = constructionOperators(probe);
  const missingOperators = question.capabilities.operators.filter(
    (operator) => !GENERIC_OPERATORS.has(operator) && !used.has(operator),
  );
  if (missingOperators.length > 0) {
    failures.push(`${question.id}: probe omits operators ${missingOperators.join(", ")}`);
  }
  const present = assertionPredicates(probe);
  const missingAssertions = question.capabilities.assertions.filter(
    (predicate) => isExecutableSceneProofPredicate(predicate) && !present.has(predicate),
  );
  if (missingAssertions.length > 0) {
    failures.push(`${question.id}: probe omits assertions ${missingAssertions.join(", ")}`);
  }
  const validated = validateSceneDocument(probe);
  if (!validated.document) {
    failures.push(`${question.id}: schema ${JSON.stringify(validated.report.issues)}`);
    continue;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene) {
    failures.push(`${question.id}: compile ${JSON.stringify(compiled.report.issues)}`);
    continue;
  }
  const marks = compiled.renderScene.primitives.filter((primitive) => primitive.kind !== "label");
  if (marks.length === 0) {
    failures.push(`${question.id}: compiled with no diagram marks`);
  }
  if (question.id === "solid-disk-sqrt") {
    const disk = compiled.renderScene.primitives.find((primitive) =>
      primitive.entityId === "disk" && (primitive.points?.length ?? 0) >= 8,
    );
    if (!disk) {
      failures.push(`${question.id}: representative disk is not a foreshortened face`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`verify-evaluation-compile failed:\n${failures.map((item) => `  - ${item}`).join("\n")}`);
}

assert(questions.length === Object.keys(PROBES).length, "probe registry drifted from eval corpora");

console.log("verify-evaluation-compile: ok");
console.log(`  questions=${questions.length}`);
