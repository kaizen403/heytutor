import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { DEFAULT_CHEAP_FIREWORKS_MODEL } from "../../lib/llm/fireworksModels";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { parseProviderUsage } from "../../lib/obs/providerUsage";
import {
  diagramPlanRetrievalText,
  retrieveDiagramExemplars,
  type DiagramExampleCatalogue,
  type DiagramExemplar,
} from "./diagramExamples";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
export const DIAGRAM_EXAMPLE_PICKER_MODEL = DEFAULT_CHEAP_FIREWORKS_MODEL;
export const DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS = 2_000;

export interface DiagramExamplePickerRecord {
  method: "model" | "word_fallback";
  status: "picked" | "none" | "failed" | "timeout";
  model: string;
  elapsedMs: number;
  catalogueEntries: number;
  catalogueEstimatedTokens: number;
  ids: string[];
  usageKnown: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  fallbackReason: string | null;
}

export interface DiagramExamplePickerResult {
  examples: DiagramExemplar[];
  record: DiagramExamplePickerRecord;
}

export interface DiagramExamplePickerOptions {
  question: string;
  plan?: TurnPlanV3 | null;
  families: readonly string[];
  archetypeId: string | null;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse only the promised wire shape. Markdown fences and hallucinated ids are failures. */
export function parseDiagramExamplePickerResponse(
  content: string,
  catalogue: DiagramExampleCatalogue,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("picker did not return strict JSON");
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.ids)) {
    throw new Error("picker did not return strict JSON with one ids array");
  }
  if (parsed.ids.length > 3 || !parsed.ids.every((id) => typeof id === "string")) {
    throw new Error("picker ids must contain at most three strings");
  }
  const ids = parsed.ids as string[];
  if (new Set(ids).size !== ids.length) throw new Error("picker returned duplicate ids");
  const known = new Set(catalogue.entries.map((entry) => entry.id));
  const unknown = ids.find((id) => !known.has(id));
  if (unknown) throw new Error(`picker returned unknown exemplar ${unknown}`);
  return ids;
}

function fallback(
  exemplars: readonly DiagramExemplar[],
  options: DiagramExamplePickerOptions,
): DiagramExemplar[] {
  return retrieveDiagramExemplars(exemplars, {
    question: options.question,
    families: options.families,
    archetypeId: options.archetypeId,
    plan: options.plan,
    limit: 3,
  });
}

function prompt(question: string, plan: TurnPlanV3 | null | undefined, catalogue: DiagramExampleCatalogue) {
  const planSummary = diagramPlanRetrievalText(plan);
  return [
    "Pick up to 3 catalogue examples whose DRAWN FIGURE would best guide a diagram for the student question.",
    "Match meaning, not shared words. Return none when no figure fits.",
    'Return strict JSON only: {"ids":["catalogue-id"]} or {"ids":[]}.',
    `QUESTION\n${question}`,
    ...(planSummary ? [`TURN PLAN SUMMARY\n${planSummary}`] : []),
    `CATALOGUE\n${catalogue.text}`,
  ].join("\n\n");
}

/** One cheap semantic pick, with the bounded word scorer as an explicit failure fallback. */
export async function pickDiagramExamples(
  exemplars: readonly DiagramExemplar[],
  catalogue: DiagramExampleCatalogue,
  options: DiagramExamplePickerOptions,
): Promise<DiagramExamplePickerResult> {
  const startedAt = Date.now();
  const model = DIAGRAM_EXAMPLE_PICKER_MODEL;
  const apiKey = options.apiKey?.trim() || process.env.FIREWORKS_API_KEY?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS);
  let usage = parseProviderUsage(undefined);
  const base = () => ({
    model,
    elapsedMs: Date.now() - startedAt,
    catalogueEntries: catalogue.entries.length,
    catalogueEstimatedTokens: catalogue.estimatedTokens,
    usageKnown: usage.known,
    inputTokens: usage.input ?? 0,
    outputTokens: usage.output ?? 0,
    totalTokens: usage.total ?? (usage.input ?? 0) + (usage.output ?? 0),
    estimatedCostUsd: usage.known ? calculateLlmCostDetails(usage, { model }).total ?? 0 : 0,
  });
  try {
    if (!apiKey) throw new Error("missing FIREWORKS_API_KEY");
    const response = await fetchImpl(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: timeout,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt(options.question, options.plan, catalogue) }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 60,
        reasoning_effort: "none",
        stream: false,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`picker upstream ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)) throw new Error("picker response was not an object");
    usage = parseProviderUsage(payload.usage);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = first && isRecord(first.message) ? first.message : null;
    const content = message?.content;
    if (typeof content !== "string") throw new Error("picker response had no text content");
    const ids = parseDiagramExamplePickerResponse(content, catalogue);
    const byId = new Map(exemplars.map((example) => [example.id, example]));
    const examples = ids.flatMap((id) => {
      const exemplar = byId.get(id);
      return exemplar ? [exemplar] : [];
    });
    return {
      examples,
      record: {
        method: "model",
        status: examples.length > 0 ? "picked" : "none",
        ids,
        fallbackReason: null,
        ...base(),
      },
    };
  } catch (error) {
    const timedOut = timeout.aborted;
    const examples = fallback(exemplars, options);
    return {
      examples,
      record: {
        method: "word_fallback",
        status: timedOut ? "timeout" : "failed",
        ids: examples.map((example) => example.id),
        fallbackReason: timedOut
          ? `picker timed out after ${options.timeoutMs ?? DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS} ms`
          : error instanceof Error ? error.message : String(error),
        ...base(),
      },
    };
  }
}
