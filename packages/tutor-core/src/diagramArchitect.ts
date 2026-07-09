import { tutorDebug } from "./tutorDebug";
import { DIAGRAM_ARCHITECT_PROMPT } from "./diagramArchitectPrompt";

/**
 * Build the user message for the planner. kimi-k2p6 prioritizes the user
 * message over the system prompt, so the full instructions + examples + the
 * question all go here to ensure the model plans a diagram instead of solving.
 */
function buildPlannerUserMessage(question: string): string {
  return `${DIAGRAM_ARCHITECT_PROMPT}

---

DIAGRAM PLAN REQUEST. Read the question below and output the JSON diagram plan with drawing commands in the "commands" array. You may put your solution in the "solution" field, but the "commands" array MUST contain drawing commands that illustrate the setup.

Question: ${question}

Output the JSON object now.`;
}

/** A single drawing command from the planner, matching the template protocol. */
export interface PlannerCommand {
  type: string;
  params: number[];
  text?: string;
}

/** A labeled anchor point for annotation snapping. */
export interface PlannerAnchor {
  id: string;
  labels: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The full diagram plan returned by the architect. */
export interface DiagramPlan {
  diagramType: string;
  commands: PlannerCommand[];
  introNarration: string;
  promptAddon: string;
  givens: string[];
  asks: string[];
  anchors: PlannerAnchor[];
  /** Optional — the model may put its solution here; it is ignored. */
  solution?: string;
}

/** Valid command types for diagram building (no teaching-phase commands). */
const VALID_DIAGRAM_COMMAND_TYPES = new Set([
  "DRAW_LINE",
  "DRAW_RECT",
  "DRAW_CIRCLE",
  "DRAW_CUBE",
  "DRAW_CUBOID",
  "LABEL",
  "ARROW",
]);

/** Param count expectations per command type. */
const PARAM_COUNTS: Record<string, [number, number]> = {
  DRAW_LINE: [4, 7],
  DRAW_RECT: [4, 4],
  DRAW_CIRCLE: [3, 3],
  DRAW_CUBE: [3, 3],
  DRAW_CUBOID: [5, 5],
  LABEL: [2, 2],
  ARROW: [4, 6],
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;

interface PlanDiagramOptions {
  proxyUrl: string;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Call the LLM diagram architect. Non-streaming, low reasoning, returns a
 * structured plan or null on failure/timeout. The caller falls back to regex
 * templates when this returns null.
 */
export async function planDiagram(
  question: string,
  options: PlanDiagramOptions,
): Promise<DiagramPlan | null> {
  const { proxyUrl, sessionId, signal, timeoutMs = 8000 } = options;
  const startedAt = Date.now();

  tutorDebug("planner", "starting diagram architect call", {
    question_chars: question.length,
    timeout_ms: timeoutMs,
  });

  // Combine the user-provided abort signal with our timeout.
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
          { role: "system", content: "You are a JSON diagram planner. Output only JSON." },
          { role: "user", content: buildPlannerUserMessage(question) },
        ],
      }),
    });

    if (!response.ok) {
      tutorDebug("planner", "architect request failed", {
        status: response.status,
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const data = await response.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    if (!content || content.trim().length === 0) {
      tutorDebug("planner", "architect returned empty content", {
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    const plan = parsePlanResponse(content);

    if (!plan) {
      tutorDebug("planner", "architect JSON parse failed", {
        elapsed_ms: Date.now() - startedAt,
        content_preview: content.slice(0, 200),
      });
      return null;
    }

    const validated = validatePlan(plan);
    if (!validated) {
      tutorDebug("planner", "architect plan validation failed", {
        diagram_type: plan.diagramType,
        command_count: plan.commands?.length ?? 0,
        elapsed_ms: Date.now() - startedAt,
      });
      return null;
    }

    tutorDebug("planner", "architect plan ready", {
      diagram_type: validated.diagramType,
      command_count: validated.commands.length,
      anchor_count: validated.anchors.length,
      givens: validated.givens.length,
      asks: validated.asks.length,
      elapsed_ms: Date.now() - startedAt,
    });

    return validated;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    tutorDebug("planner", "architect call failed", {
      reason: isAbort ? "timeout_or_cancelled" : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Parse JSON from the LLM response, handling markdown fences and partial output. */
function parsePlanResponse(content: string): DiagramPlan | null {
  let text = content.trim();

  // Strip markdown code fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find the first { and last } to extract the JSON object.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonText = text.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(jsonText);
    return parsed as DiagramPlan;
  } catch {
    // Try to fix common JSON issues: trailing commas.
    try {
      const fixed = jsonText.replace(/,\s*([}\]])/g, "$1");
      const parsed = JSON.parse(fixed);
      return parsed as DiagramPlan;
    } catch {
      return null;
    }
  }
}

/** Validate and sanitize the plan. Returns null if the plan is unusable. */
function validatePlan(plan: DiagramPlan): DiagramPlan | null {
  if (!plan || typeof plan !== "object") {
    return null;
  }

  const diagramType = typeof plan.diagramType === "string" ? plan.diagramType : "unknown";
  const commands = Array.isArray(plan.commands) ? plan.commands : [];
  const introNarration = typeof plan.introNarration === "string" ? plan.introNarration : "";
  const promptAddon = typeof plan.promptAddon === "string" ? plan.promptAddon : "";
  const givens = Array.isArray(plan.givens) ? plan.givens.filter((g) => typeof g === "string") : [];
  const asks = Array.isArray(plan.asks) ? plan.asks.filter((a) => typeof a === "string") : [];
  const anchors = Array.isArray(plan.anchors) ? plan.anchors : [];

  // Need at least 2 commands to be useful.
  if (commands.length < 2) {
    return null;
  }

  // Validate each command.
  const validCommands: PlannerCommand[] = [];
  for (const cmd of commands) {
    if (!cmd || typeof cmd.type !== "string" || !Array.isArray(cmd.params)) {
      continue;
    }

    if (!VALID_DIAGRAM_COMMAND_TYPES.has(cmd.type)) {
      continue;
    }

    const [minParams, maxParams] = PARAM_COUNTS[cmd.type] ?? [0, 99];
    if (cmd.params.length < minParams || cmd.params.length > maxParams) {
      continue;
    }

    // Check all params are finite numbers within canvas bounds (with tolerance).
    const validParams = cmd.params.every((p) => Number.isFinite(p) && Math.abs(p) <= CANVAS_WIDTH + 100);
    if (!validParams) {
      continue;
    }

    validCommands.push({
      type: cmd.type,
      params: cmd.params.map((p) => Math.round(p)),
      text: cmd.type === "LABEL" && typeof cmd.text === "string" ? cmd.text : undefined,
    });
  }

  if (validCommands.length < 2) {
    return null;
  }

  // Validate anchors.
  const validAnchors: PlannerAnchor[] = anchors
    .filter(
      (a) =>
        a &&
        typeof a.id === "string" &&
        Array.isArray(a.labels) &&
        Number.isFinite(a.x) &&
        Number.isFinite(a.y),
    )
    .map((a) => ({
      id: a.id,
      labels: a.labels.filter((l) => typeof l === "string"),
      x: Math.round(a.x),
      y: Math.round(a.y),
      width: a.width ?? 24,
      height: a.height ?? 24,
    }));

  // Need a non-empty promptAddon for the teaching model.
  if (promptAddon.trim().length === 0) {
    return null;
  }

  return {
    diagramType,
    commands: validCommands,
    introNarration: introNarration.trim(),
    promptAddon: promptAddon.trim(),
    givens,
    asks,
    anchors: validAnchors,
  };
}

/** Merge two abort signals into one that fires when either fires. */
function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
