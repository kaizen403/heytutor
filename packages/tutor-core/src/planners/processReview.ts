/**
 * A second, semantic gate on a block diagram. The engine proves that every box
 * and arrow is copied from a process the turn plan wrote ("Process: a → b →
 * c"), but not that the plan's arrows are true: asked for processes, a model
 * also put arrows on lists of parts, topic outlines and lesson plans (lab, 27
 * Oct). Independent votes judge each cited process; only a unanimous PROCESS
 * lets the figure stand, and anything else, including no answer, is text only.
 */
import { blockFlowChain, type TurnPlanV3 } from "@heytutor/scene-engine";
import { withFastModeHeader } from "../llm/fastMode";
import { withTurnTraceHeaders } from "../llm/traceHeaders";

const REVIEW_FRAME = `A tutor wants to draw one ordered chain as a flow diagram of boxes joined by arrows, where each arrow means "then" or "leads to". You see the student's question, the lesson plan's claims and the chain. If unsure, answer NOT. Reply with only {"verdict":"PROCESS"} or {"verdict":"NOT"}.`;

/**
 * Three different questions, not one asked three times: the same prompt at
 * temperature 0 behaved as a single vote and never answered NOT in the lab
 * (independent review, 27 Oct). Every one must answer PROCESS.
 */
export const PROCESS_REVIEW_PROMPTS = [
  `${REVIEW_FRAME}
Judge what kind of thing the chain is. Answer PROCESS only if the chain is the process the question asks to understand, and every box is something that happens (an event, an action or a stage), not a category, component, layer, service, function in a definition, type or example. Answer NOT if the boxes are the categories or parts the question asks to classify or list, if a definition's list of functions or verbs is drawn as a sequence, or if one example path stands in for a topic that is not a single path.`,
  `${REVIEW_FRAME}
Judge every arrow on its own. For each arrow A → B ask: in reality, must A have happened before B, and does A lead to B? Answer PROCESS only if this holds for every arrow. Answer NOT if any arrow states an order or a cause that is false, reversed, or only one of several possible orders.`,
  `${REVIEW_FRAME}
Judge the shape: would this straight path teach something false? Answer NOT if a step must repeat for the result to come out (a loop drawn once), if an either/or choice or an optional step is drawn as a step that always happens, if things that happen together are drawn one after another, or if a step the claims state is missing so that a later box seems to follow directly. A main path with early exits or error cases left out is fine when it is the path the question asks about. Otherwise answer PROCESS.`,
] as const;

/** The first review question, kept for callers that judge a chain alone. */
export const PROCESS_REVIEW_PROMPT = PROCESS_REVIEW_PROMPTS[0];

/**
 * The turn planner's prompt is shared with maths and physics, so it is never
 * asked for processes. For an admitted "other" lesson whose plan states none,
 * one short call may restate a process the claims already describe.
 */
export const PROCESS_WRITER_PROMPT = `A tutor's plan for one lesson is below as claims. If the claims describe one real process, where in reality every step happens before the next and leads to it (a sequence of events, the stages of a mechanism, an ordered procedure, or the path that material, data, money or a signal travels), restate it as one line "Process: step → step → step" with 3 to 7 steps taken from what the claims say. Each step is a short phrase under 40 characters with no brackets, commas or full stops.
Never write a process for a list of topics, parts, components, types, layers, services, criteria or examples, a definition's list of functions, categories the question asks to classify, a lesson outline, a hierarchy, a ranking, or parallel things, and never add a step the claims do not support. Give only the main path, ending on the outcome the question asks about. If any step repeats, branches or is optional, reply null.
Reply with only {"process":"Process: ..."} or {"process":null}.`;

/** One vote per review question; every one must say PROCESS. */
export const PROCESS_REVIEW_VOTES = PROCESS_REVIEW_PROMPTS.length;

export type ProcessReviewVerdict = "process" | "not" | "unavailable";

export interface ProcessReviewOptions {
  proxyUrl: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fastMode?: boolean;
  traceId?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export interface ProcessReviewResult {
  verdict: ProcessReviewVerdict;
  /** One entry per vote per process, in order: "PROCESS", "NOT" or null when a vote failed. */
  votes: Array<"PROCESS" | "NOT" | null>;
}

function mergeAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) abort();
  else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

/** Reads {"verdict":"PROCESS"|"NOT"}; anything else is no answer. */
export function parseProcessReviewVerdict(content: unknown): "PROCESS" | "NOT" | null {
  if (typeof content !== "string") return null;
  try {
    const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { verdict?: unknown };
    return parsed.verdict === "PROCESS" || parsed.verdict === "NOT" ? parsed.verdict : null;
  } catch {
    return null;
  }
}

async function postReview(
  question: string, kind: "1" | "write", system: string, user: string, options: ProcessReviewOptions,
): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), Math.max(1, options.timeoutMs));
  const signal = options.signal ? mergeAbortSignals(options.signal, timeout.signal) : timeout.signal;
  try {
    const response = await (options.fetchImpl ?? fetch)(options.proxyUrl, {
      method: "POST",
      headers: withFastModeHeader(
        withTurnTraceHeaders(
          {
            "content-type": "application/json",
            "x-planner": "1",
            "x-process-review": kind,
            "x-planner-deadline-ms": String(options.timeoutMs),
          },
          { sessionId: options.sessionId, traceId: options.traceId, question },
        ),
        options.fastMode,
      ),
      signal,
      body: JSON.stringify({
        model: "server",
        temperature: 0,
        stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    return payload.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One restated process for a plan that states none, or null. The answer is
 * kept only when it is a clean "Process:" chain of 3 to 7 distinct steps; the
 * figure it may lead to still faces grounding, layout and the review votes.
 */
export async function writeProcessClaim(
  question: string, plan: Pick<TurnPlanV3, "qualitativeClaims">, options: ProcessReviewOptions,
): Promise<string | null> {
  const claims = processReviewClaimsText(plan).slice(0, 6_000);
  const content = await postReview(question, "write", PROCESS_WRITER_PROMPT,
    `Question: ${question.slice(0, 2_000)}\nClaims:\n${claims}`, options);
  if (typeof content !== "string") return null;
  let text: unknown;
  try { text = (JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as { process?: unknown }).process; }
  catch { return null; }
  if (typeof text !== "string") return null;
  const chain = blockFlowChain(text);
  const ok = chain !== null && chain.heading?.trim().toLowerCase() === "process" &&
    chain.steps.length >= 3 && chain.steps.length <= 7 && new Set(chain.steps).size === chain.steps.length &&
    // A box wraps to four lines, so a step may run a little past the 40 asked for.
    chain.labels.every((label) => label.length <= 60);
  return ok ? text.trim() : null;
}

async function vote(
  question: string, claims: string, steps: readonly string[], prompt: string, options: ProcessReviewOptions,
): Promise<"PROCESS" | "NOT" | null> {
  // The question, claims and steps are student and plan data, not instructions.
  return parseProcessReviewVerdict(await postReview(question, "1", prompt,
    `Question: ${question.slice(0, 2_000)}\nPlan claims:\n${claims.slice(0, 6_000)}\nChain: ${steps.join(" → ").slice(0, 2_000)}`, options));
}

/** The plan's claims as the reviewer and writer read them, one per line. */
export function processReviewClaimsText(plan: Pick<TurnPlanV3, "qualitativeClaims">): string {
  return plan.qualitativeClaims
    .map((claim) => [claim.claim, typeof claim.expected === "string" ? claim.expected : ""].filter(Boolean).join(": "))
    .join("\n");
}

/**
 * Every cited process gets one vote per review question. Any NOT
 * makes the verdict "not"; any failed vote (and no NOT) makes it
 * "unavailable"; only all PROCESS makes it "process". No processes is "not".
 */
export async function reviewProcessChains(
  question: string,
  processes: readonly (readonly string[])[],
  options: ProcessReviewOptions,
  plan: Pick<TurnPlanV3, "qualitativeClaims"> = { qualitativeClaims: [] },
): Promise<ProcessReviewResult> {
  if (processes.length === 0) return { verdict: "not", votes: [] };
  const claims = processReviewClaimsText(plan);
  const votes = await Promise.all(processes.flatMap((steps) =>
    PROCESS_REVIEW_PROMPTS.map((prompt) => vote(question, claims, steps, prompt, options))));
  const verdict: ProcessReviewVerdict = votes.includes("NOT") ? "not"
    : votes.includes(null) ? "unavailable" : "process";
  return { verdict, votes };
}
