import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { resolveCheapFireworksModel } from "../../lib/llm/fireworksModels";
import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "../../lib/llm/llmProvider";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";
import { parseProviderUsage } from "../../lib/obs/providerUsage";
import {
  diagramPlanRetrievalText,
  retrieveDiagramExemplars,
  type DiagramExampleCatalogue,
  type DiagramExemplar,
} from "./diagramExamples";
import { estimateLabCallWorstCaseUsd } from "./diagramEval";

export const DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS = 15_000;

export interface DiagramExamplePickerRecord {
  method: "model" | "word_fallback";
  status: "picked" | "none" | "failed" | "timeout";
  model: string;
  elapsedMs: number;
  catalogueEntries: number;
  catalogueEstimatedTokens: number;
  ids: string[];
  attempts: number;
  usageKnown: boolean;
  usageKnownCalls: number;
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
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onModelCost?: (usd: number) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class PickerJsonError extends Error {}

function firstJsonObject(content: string): unknown {
  for (let start = content.indexOf("{"); start >= 0; start = content.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const character = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          return JSON.parse(content.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new PickerJsonError("picker did not return a JSON object");
}

function normalizedId(id: string): string {
  return id
    .toLowerCase()
    .replace(/^(?:curated|synthesized):/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function resolveCatalogueId(id: string, catalogue: DiagramExampleCatalogue): string | null {
  const exact = catalogue.entries.find((entry) => entry.id === id);
  if (exact) return exact.id;
  const wanted = normalizedId(id);
  if (!wanted) return null;
  const candidates = catalogue.entries.flatMap((entry) => {
    const known = normalizedId(entry.id);
    const aliasExact = known === wanted;
    const shortened = wanted.length >= 12 && (known.startsWith(wanted) || wanted.startsWith(known));
    const distance = editDistance(known, wanted);
    const near = distance <= (Math.max(known.length, wanted.length) >= 20 ? 2 : 1);
    return aliasExact || shortened || near ? [{ id: entry.id, distance }] : [];
  });
  if (candidates.length === 0) return null;
  const bestDistance = Math.min(...candidates.map((candidate) => candidate.distance));
  const best = candidates.filter((candidate) => candidate.distance === bestDistance);
  return best.length === 1 ? best[0]!.id : null;
}

/** Read the first JSON object and retain only exact or unambiguously recoverable ids. */
export function parseDiagramExamplePickerResponse(
  content: string,
  catalogue: DiagramExampleCatalogue,
): string[] {
  const parsed = firstJsonObject(content);
  if (!isRecord(parsed) || !Array.isArray(parsed.ids)) {
    throw new PickerJsonError("picker JSON object had no ids array");
  }
  if (parsed.ids.length > 3 || !parsed.ids.every((id) => typeof id === "string")) {
    throw new PickerJsonError("picker ids must contain at most three strings");
  }
  return [...new Set((parsed.ids as string[]).flatMap((id) => {
    const resolved = resolveCatalogueId(id, catalogue);
    return resolved ? [resolved] : [];
  }))].slice(0, 3);
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
  const endpoint = resolveLlmEndpoint(options.env);
  const model = resolveCheapFireworksModel({ env: options.env });
  const apiKey = options.apiKey?.trim() || endpoint.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DIAGRAM_EXAMPLE_PICKER_TIMEOUT_MS;
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let usageKnownCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  let pendingWorstCaseUsd = 0;
  let pendingCharged = true;
  const base = () => ({
    model,
    elapsedMs: Date.now() - startedAt,
    catalogueEntries: catalogue.entries.length,
    catalogueEstimatedTokens: catalogue.estimatedTokens,
    attempts,
    usageKnown: attempts > 0 && usageKnownCalls === attempts,
    usageKnownCalls,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
  });
  try {
    if (endpoint.fallbackReason) throw new Error("configured LLM provider is unavailable");
    if (!apiKey) throw new Error("missing configured LLM provider key");
    for (;;) {
      attempts += 1;
      const remainingMs = Math.max(1, deadline - Date.now());
      const pickerPrompt = prompt(options.question, options.plan, catalogue);
      const providerBody = providerChatBody({
        model,
        messages: [{ role: "user", content: pickerPrompt }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 60,
        reasoning_effort: "none",
        stream: false,
      }, endpoint);
      pendingWorstCaseUsd = estimateLabCallWorstCaseUsd({
        messages: providerBody.messages,
        maxTokens: completionTokenCap(providerBody),
        model,
      });
      pendingCharged = false;
      const response = await fetchImpl(endpoint.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(remainingMs),
        body: JSON.stringify(providerBody),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`picker upstream ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new PickerJsonError("picker response was not an object");
      const usage = parseProviderUsage(payload.usage);
      let callCostUsd = pendingWorstCaseUsd;
      if (usage.known) {
        usageKnownCalls += 1;
        inputTokens += usage.input ?? 0;
        outputTokens += usage.output ?? 0;
        totalTokens += usage.total ?? (usage.input ?? 0) + (usage.output ?? 0);
        callCostUsd = calculateLlmCostDetails(usage, { model }).total ?? 0;
      }
      estimatedCostUsd += callCostUsd;
      options.onModelCost?.(callCostUsd);
      pendingCharged = true;
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const first = isRecord(choices[0]) ? choices[0] : null;
      const message = first && isRecord(first.message) ? first.message : null;
      const content = message?.content;
      try {
        if (typeof content !== "string") throw new PickerJsonError("picker response had no text content");
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
        if (!(error instanceof PickerJsonError) || attempts >= 2 || Date.now() >= deadline) throw error;
      }
    }
  } catch (error) {
    if (attempts > 0 && !pendingCharged) {
      estimatedCostUsd += pendingWorstCaseUsd;
      options.onModelCost?.(pendingWorstCaseUsd);
      pendingCharged = true;
    }
    const timedOut = Date.now() >= deadline ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
    const examples = fallback(exemplars, options);
    return {
      examples,
      record: {
        method: "word_fallback",
        status: timedOut ? "timeout" : "failed",
        ids: examples.map((example) => example.id),
        fallbackReason: timedOut
          ? `picker timed out after ${timeoutMs} ms`
          : error instanceof Error ? error.message : String(error),
        ...base(),
      },
    };
  }
}
