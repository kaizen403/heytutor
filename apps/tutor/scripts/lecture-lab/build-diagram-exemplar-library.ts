import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  compileSceneDocument,
  detectArchetype,
  synthesizeFamilyScene,
  validateSceneDocument,
  type SceneDocument,
} from "@heytutor/scene-engine";
import type { DiagramExemplar } from "./diagramExamples";

interface Stem {
  id: string;
  question: string;
}

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

function readableValidatedDocument(value: unknown): SceneDocument | null {
  const validated = validateSceneDocument(value);
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document);
  const fatals = compiled.report.issues.filter((issue) => issue.severity === "fatal");
  if (!compiled.ok || !compiled.renderScene || fatals.length > 0) {
    return null;
  }
  const readable = compiled.renderScene.primitives.some((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") &&
    typeof primitive.text === "string" &&
    primitive.text.trim().length > 0);
  return readable ? validated.document : null;
}

function curatedExemplars(root: string): DiagramExemplar[] {
  return filesBelow(root)
    .filter((path) => path.endsWith(".json"))
    .sort()
    .map((path) => {
      const value = JSON.parse(readFileSync(path, "utf8")) as {
        question?: unknown;
        sceneDocument?: unknown;
      };
      const id = `curated:${relative(root, path).replace(/\.json$/, "").replaceAll("\\", "/")}`;
      if (typeof value.question !== "string") throw new Error(`${id}: missing question`);
      const document = readableValidatedDocument(value.sceneDocument);
      if (!document) throw new Error(`${id}: curated exemplar must validate, compile, and carry readable labels`);
      const source = typeof document.source === "object" && document.source !== null
        ? document.source as Record<string, unknown>
        : {};
      return {
        id,
        question: value.question,
        family: typeof source.chemistryFamily === "string"
          ? source.chemistryFamily
          : typeof source.family === "string" ? source.family : null,
        archetype: typeof source.archetype === "string" ? source.archetype : null,
        document: document as unknown as Record<string, unknown>,
      };
    });
}

function probeStems(probesRoot: string): Stem[] {
  return readdirSync(probesRoot)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      const value = JSON.parse(readFileSync(join(probesRoot, name), "utf8")) as {
        questions?: Array<{ id?: unknown; question?: unknown }>;
      };
      return (value.questions ?? []).flatMap((entry, index) =>
        typeof entry.question === "string"
          ? [{ id: `probe:${basename(name, ".json")}:${typeof entry.id === "string" ? entry.id : index + 1}`, question: entry.question }]
          : []);
    });
}

function bankStems(bankPath: string): Stem[] {
  return readFileSync(bankPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line, index) => {
      const value = JSON.parse(line) as { question_id?: unknown; text?: unknown };
      return typeof value.text === "string" && value.text.trim()
        ? [{ id: `bank:${typeof value.question_id === "string" ? value.question_id : index + 1}`, question: value.text }]
        : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function stableSynthesizedId(group: string, question: string): string {
  const digest = createHash("sha256").update(question).digest("hex").slice(0, 12);
  return `synthesized:${group.replace(/[^a-z0-9_-]+/gi, "-")}:${digest}`;
}

export function buildDiagramExemplarLibrary(repoRoot: string): DiagramExemplar[] {
  const exemplarsRoot = resolve(repoRoot, "data/diagram-eval/v1/exemplars");
  const exemplars = curatedExemplars(exemplarsRoot);
  const seenQuestions = new Set(exemplars.map((entry) => entry.question.toLowerCase().replace(/\s+/g, " ").trim()));
  const groupCounts = new Map<string, number>();
  for (const exemplar of exemplars) {
    const group = exemplar.archetype ? `archetype:${exemplar.archetype}` : `family:${exemplar.family ?? "unknown"}`;
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  const stems = [
    ...probeStems(resolve(repoRoot, "data/syllabus-probes")),
    ...bankStems(resolve(repoRoot, "data/question-bank/questions.jsonl")),
  ];
  for (const stem of stems) {
    const normalizedQuestion = stem.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenQuestions.has(normalizedQuestion)) continue;
    const synthesized = synthesizeFamilyScene({ question: stem.question });
    if (!synthesized) continue;
    const document = readableValidatedDocument(synthesized.document);
    if (!document) continue;
    const archetype = detectArchetype(stem.question)?.id ?? null;
    const group = archetype ? `archetype:${archetype}` : `family:${synthesized.family}`;
    if ((groupCounts.get(group) ?? 0) >= 2) continue;
    exemplars.push({
      id: stableSynthesizedId(group, stem.question),
      question: stem.question,
      family: synthesized.family,
      archetype,
      document: document as unknown as Record<string, unknown>,
    });
    seenQuestions.add(normalizedQuestion);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  return exemplars.sort((left, right) => left.id.localeCompare(right.id));
}

if (process.argv[1]?.endsWith("build-diagram-exemplar-library.ts")) {
  const repoRoot = resolve(process.cwd(), "../..");
  const output = resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl");
  const exemplars = buildDiagramExemplarLibrary(repoRoot);
  writeFileSync(output, `${exemplars.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const groups = new Set(exemplars.map((entry) => entry.archetype
    ? `archetype:${entry.archetype}`
    : `family:${entry.family ?? "unknown"}`));
  console.log(JSON.stringify({ output, exemplars: exemplars.length, groups: groups.size }, null, 2));
}
