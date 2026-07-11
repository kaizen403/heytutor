import { tutorDebug } from "./tutorDebug";
import { SCENE_ARCHITECT_PROMPT } from "./sceneArchitectPrompt";
import {
  parseSceneSpecJson,
  type SceneSpec,
} from "@heytutor/drawing";

function buildScenePlannerUserMessage(question: string): string {
  return `${SCENE_ARCHITECT_PROMPT}

---

SCENE PLAN REQUEST. Read the question below and output the JSON SceneSpec. Do not invent pixel coordinates.

Question: ${question}

Output the JSON object now.`;
}

interface PlanSceneOptions {
  proxyUrl: string;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Call the LLM scene autoformalizer. Returns a validated SceneSpec or null.
 * Same HTTP path as the old pixel planner (`x-planner: 1`).
 */
export async function planScene(
  question: string,
  options: PlanSceneOptions,
): Promise<SceneSpec | null> {
  const { proxyUrl, sessionId, signal, timeoutMs = 8000 } = options;
  const startedAt = Date.now();

  tutorDebug("planner", "starting scene architect call", {
    question_chars: question.length,
    timeout_ms: timeoutMs,
  });

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const combinedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-planner": "1",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      signal: combinedSignal,
      body: JSON.stringify({
        model: "accounts/fireworks/models/kimi-k2p6",
        max_tokens: 4000,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are a JSON scene autoformalizer. Output only SceneSpec JSON. No pixels.",
          },
          { role: "user", content: buildScenePlannerUserMessage(question) },
        ],
      }),
    });

    if (!response.ok) {
      tutorDebug("planner", "scene architect request failed", {
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    if (!content || content.trim().length === 0) {
      tutorDebug("planner", "scene architect returned empty content", {
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const scene = parseSceneSpecJson(content);
    if (!scene) {
      tutorDebug("planner", "scene architect validation failed", {
        elapsed_ms: Date.now() - startedAt,
        content_preview: content.slice(0, 200),
      });
      return null;
    }

    tutorDebug("planner", "scene architect ready", {
      kind: scene.kind,
      diagram_type: scene.diagramType,
      entity_count: scene.entities.length,
      constraint_count: scene.constraints.length,
      elapsed_ms: Date.now() - startedAt,
    });

    return scene;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    tutorDebug("planner", "scene architect call failed", {
      reason: isAbort ? "timeout_or_cancelled" : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
