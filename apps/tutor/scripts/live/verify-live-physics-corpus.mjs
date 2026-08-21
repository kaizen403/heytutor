#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../../..");
const corpusPath = join(
  repoRoot,
  "packages/scene-engine/fixtures/evaluation/jee-physics-core-v1.json",
);
const singleQuestionScript = join(scriptDirectory, "verify-live-diagram-v3.mjs");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const options = parseArguments(process.argv.slice(2));
const selected = corpus.questions
  .filter((question) => !options.priority || question.priority === options.priority)
  .filter((question) => !options.domain || question.domain === options.domain)
  .filter((question) => !options.difficulty || question.difficulty === options.difficulty)
  .filter((question) => !options.id || question.id === options.id)
  .slice(0, options.limit ?? corpus.questions.length);

if (options.list) {
  for (const question of selected) {
    console.log(`${question.priority}\t${question.domain}\t${question.difficulty}\t${question.id}`);
  }
  process.exit(0);
}

if (selected.length === 0) {
  throw new Error("No corpus questions matched the supplied filters");
}

const results = [];
for (const [index, question] of selected.entries()) {
  console.error(`[${index + 1}/${selected.length}] ${question.id}`);
  const execution = await runQuestion(question.question);
  const plan = execution.records.find((record) => record.phase === "audited-turn-plan");
  const scene = execution.records.find((record) => record.phase === "scene");
  const quantityChecks = question.expected.quantities.map((expected) => {
    const candidates = Array.isArray(plan?.derived)
      ? plan.derived.filter((actual) => quantityMatches(actual, expected))
      : [];
    const expectedKeys = Array.isArray(expected.aliases)
      ? expected.aliases.map(normalizeQuantityKey)
      : [];
    const match = expectedKeys.length > 0
      ? candidates.find((actual) =>
          [actual.id, actual.symbol]
            .filter((value) => typeof value === "string")
            .map(normalizeQuantityKey)
            .some((key) => expectedKeys.includes(key))
        )
      : candidates[0];
    return {
      id: expected.id,
      expected: { value: expected.value, unit: expected.unit, tolerance: expected.tolerance },
      actual: match ? { id: match.id, value: match.value, unit: match.unit } : null,
      passed: Boolean(match),
    };
  });
  const result = {
    id: question.id,
    priority: question.priority,
    domain: question.domain,
    difficulty: question.difficulty,
    passed:
      execution.exitCode === 0 &&
      scene?.ready === true &&
      quantityChecks.every((check) => check.passed),
    diagramReady: scene?.ready === true,
    wallElapsedMs: execution.wallElapsedMs,
    reportedElapsedMs: scene?.elapsedMs ?? null,
    quantitiesPassed: quantityChecks.filter((check) => check.passed).length,
    quantitiesTotal: quantityChecks.length,
    quantityChecks,
    actualDerived: Array.isArray(plan?.derived) ? plan.derived : [],
    candidateErrors: Array.isArray(scene?.candidates)
      ? scene.candidates.flatMap((candidate) => candidate.errors ?? [])
      : [],
    selectedIssues: scene?.selectedIssues ?? [],
    processExitCode: execution.exitCode,
    stderrTail: execution.stderr.trim().split("\n").filter(Boolean).slice(-8),
  };
  results.push(result);
  console.log(JSON.stringify({ type: "physics-corpus-case", ...result }));
  if (options.failFast && !result.passed) break;
}

const summary = {
  type: "physics-corpus-summary",
  selected: selected.length,
  completed: results.length,
  passed: results.filter((result) => result.passed).length,
  failed: results.filter((result) => !result.passed).map((result) => result.id),
};
console.log(JSON.stringify(summary));
if (summary.failed.length > 0) process.exitCode = 2;

function runQuestion(question) {
  return new Promise((resolveExecution) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, [singleQuestionScript, question], {
      cwd: join(repoRoot, "apps/tutor"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      resolveExecution({
        exitCode: exitCode ?? 1,
        wallElapsedMs: Math.round(performance.now() - startedAt),
        records: stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("{"))
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          }),
        stderr,
      });
    });
  });
}

function parseArguments(args) {
  const options = {
    priority: null,
    domain: null,
    difficulty: null,
    id: null,
    limit: null,
    failFast: false,
    list: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--priority") options.priority = args[++index] ?? null;
    else if (argument === "--domain") options.domain = args[++index] ?? null;
    else if (argument === "--difficulty") options.difficulty = args[++index] ?? null;
    else if (argument === "--id") options.id = args[++index] ?? null;
    else if (argument === "--limit") options.limit = Number(args[++index]);
    else if (argument === "--fail-fast") options.failFast = true;
    else if (argument === "--list") options.list = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
}

function normalizeUnit(unit) {
  const normalized = String(unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/µ/g, "u")
    .replace(/μ/g, "u")
    .replace(/⁻/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "");
  if (normalized === "ω" || normalized === "ohms" || normalized === "ohm") return "ohm";
  if (normalized === "volts" || normalized === "volt") return "v";
  if (normalized === "amps" || normalized === "amp") return "a";
  if (normalized === "degrees" || normalized === "degree" || normalized === "deg" || normalized === "°") return "degree";
  if (normalized === "" || normalized === "none" || normalized === "dimensionless") return "1";
  return normalized;
}

function normalizeQuantityKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function quantityMatches(actual, expected) {
  if (typeof actual?.value !== "number" || !Number.isFinite(actual.value)) return false;
  const actualUnit = normalizeUnit(actual.unit);
  const expectedUnit = normalizeUnit(expected.unit);
  if (actualUnit === expectedUnit) {
    return Math.abs(actual.value - expected.value) <= expected.tolerance;
  }
  if (actualUnit === "rad" && expectedUnit === "degree") {
    return Math.abs(actual.value * 180 / Math.PI - expected.value) <= expected.tolerance;
  }
  if (actualUnit === "degree" && expectedUnit === "rad") {
    return Math.abs(actual.value * Math.PI / 180 - expected.value) <= expected.tolerance;
  }
  return false;
}
