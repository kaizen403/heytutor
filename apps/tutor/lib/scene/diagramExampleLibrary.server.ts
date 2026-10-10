import { resolve } from "node:path";
import { compactSceneExampleDocument } from "@heytutor/tutor-core";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildDiagramExampleCatalogue,
  diagramPlanRetrievalText,
  filterDiagramExemplarsForEvaluation,
  loadDiagramExemplarLibrary,
  type DiagramExemplar,
} from "../../scripts/lecture-lab/diagramExamples";

export type LiveDiagramExample = DiagramExemplar;

let cachedLibrary: DiagramExemplar[] | null = null;

function libraryPath(): string {
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith("/apps/tutor") ? resolve(cwd, "../..") : cwd;
  return resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl");
}

function liveLibrary(question: string): DiagramExemplar[] {
  cachedLibrary ??= loadDiagramExemplarLibrary(libraryPath(), []);
  // This is the production form of the evaluation leak guard. A curated
  // exemplar whose source question matches the live question is unavailable
  // both to the picker catalogue and to id resolution.
  return filterDiagramExemplarsForEvaluation(cachedLibrary, [question]);
}

export function filterLiveDiagramExamples(
  exemplars: readonly DiagramExemplar[],
  question: string,
  ids: readonly string[],
): DiagramExemplar[] {
  const permitted = new Map(
    filterDiagramExemplarsForEvaluation(exemplars, [question]).map((example) => [example.id, example]),
  );
  return [...new Set(ids)].slice(0, 3).flatMap((id) => {
    const example = permitted.get(id);
    return example ? [example] : [];
  });
}

export function resolveLiveDiagramExamples(question: string, ids: readonly string[]): DiagramExemplar[] {
  return filterLiveDiagramExamples(liveLibrary(question), question, ids);
}

export function injectLiveDiagramExamples(rawBody: string, examples: readonly DiagramExemplar[]): string {
  if (examples.length === 0) return rawBody;
  const parsed = JSON.parse(rawBody) as { messages?: Array<{ role?: unknown; content?: unknown }> };
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return rawBody;
  const userIndex = parsed.messages.findLastIndex((message) =>
    message.role === "user" && typeof message.content === "string");
  if (userIndex < 0) return rawBody;
  const user = parsed.messages[userIndex]!;
  const workedExamples = examples.map((example, index) => [
    `EXAMPLE ${index + 1} (${example.id})`,
    `Figure: ${example.depicts}`,
    `SCENE\n${JSON.stringify(compactSceneExampleDocument(example.document))}`,
  ].join("\n")).join("\n\n");
  parsed.messages[userIndex] = {
    ...user,
    content: `${String(user.content)}\n\nWORKED SCENE EXAMPLES\nUse only their structural ideas; never copy quantities, labels, or facts.\n\n${workedExamples}`,
  };
  return JSON.stringify(parsed);
}

function pickerInput(rawBody: string, question: string): { plan: TurnPlanV3 | null } {
  try {
    const body = JSON.parse(rawBody) as { messages?: Array<{ content?: unknown }> };
    const content = body.messages?.find((message) => typeof message.content === "string")?.content;
    const submitted = typeof content === "string" ? JSON.parse(content) as { plan?: unknown } : {};
    return { plan: validateTurnPlanV3(submitted.plan, question).plan };
  } catch {
    return { plan: null };
  }
}

export function buildLiveDiagramPickerBody(rawBody: string, question: string): string {
  const { plan } = pickerInput(rawBody, question);
  const catalogue = buildDiagramExampleCatalogue(liveLibrary(question));
  const planSummary = diagramPlanRetrievalText(plan);
  const prompt = [
    "Pick up to 3 catalogue examples whose DRAWN FIGURE would best guide a diagram for the student question.",
    "Match meaning, not shared words. Return none when no figure fits.",
    'Return strict JSON only: {"ids":["catalogue-id"]} or {"ids":[]}.',
    `QUESTION\n${question}`,
    ...(planSummary ? [`TURN PLAN SUMMARY\n${planSummary}`] : []),
    `CATALOGUE\n${catalogue.text}`,
  ].join("\n\n");
  return JSON.stringify({
    model: "server-selected",
    max_tokens: 60,
    temperature: 0,
    stream: false,
    messages: [{ role: "user", content: prompt }],
  });
}

export function parseLiveDiagramExampleIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter((id) =>
    /^[a-z0-9][a-z0-9:/_-]{0,127}$/i.test(id)))].slice(0, 3);
}
