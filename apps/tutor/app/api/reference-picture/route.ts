import { requireLessonGrant } from "@/lib/billing/gate";
import { actualLlmCost, reservePaidUsage } from "@/lib/billing/paidUsage";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { usageDetailsFromParsed, parseProviderUsage } from "@/lib/obs/providerUsage";
// The pipeline (and sharp, a native module) loads inside the handler after the
// flag check, so with the tier off nothing native is loaded by this route.
import type { PictureSpend } from "@/lib/reference-picture/findReferencePicture";
import { resolvePictureJudgeModel } from "@/lib/reference-picture/pictureJudge";
import { resolveImageProvider } from "@/lib/reference-picture/pictureGenerator";
import { resolvePictureQueryModel } from "@/lib/reference-picture/pictureQuery";
import { resolveReferencePictureEnabled } from "@/lib/scene/diagramStrategy.server";
import { tutorDebug } from "@heytutor/tutor-core";

/** A generated picture has no token usage; price it as one medium image. */
const GENERATED_IMAGE_USD = 0.06;
const SUBJECTS = new Set(["maths", "physics", "chemistry", "biology", "other"]);

/**
 * Abort means stop. A turn that stops waiting at its 25 s cap does not abort
 * (the client lets the request run to its own timeout, so the topic is stored
 * and cached for the next ask); every abort is the client choosing to stop
 * paying (a verified figure won, a Stop, a replaced turn) and ends the work.
 */

/** Per-call ceilings: the reservation funds these, a call in flight at settle costs this. */
function ceilings() {
  return {
    query: actualLlmCost({ input: 2500, output: 300 }, resolvePictureQueryModel()) ?? 0.01,
    // Matches the judge's max_tokens (3,000: a 24 entry key adds a few hundred).
    judge: actualLlmCost({ input: 6000, output: 3000 }, resolvePictureJudgeModel()) ?? 0.15,
    generate: GENERATED_IMAGE_USD,
  };
}

/**
 * What a request owes: finished calls at their measured usage, calls still in
 * flight (an abort or a throw mid round) at their ceiling. Undispatched work
 * costs nothing.
 */
function owed(spend: PictureSpend, ceiling: ReturnType<typeof ceilings>): number {
  let total = 0;
  for (const entry of spend.usages) {
    total += entry.lane === "generate"
      ? GENERATED_IMAGE_USD
      : actualLlmCost(usageDetailsFromParsed(parseProviderUsage(entry.usage)), entry.model) ?? ceiling[entry.lane];
  }
  return total + spend.inFlight.query * ceiling.query + spend.inFlight.judge * ceiling.judge + spend.inFlight.generate * ceiling.generate;
}

/**
 * Find, judge, plan and store one reference picture for a question. Off unless
 * `DIAGRAM_REFERENCE_PICTURE=on`. A decline is a normal 200: the lesson then
 * teaches as text, exactly as before this tier existed.
 */
export async function POST(request: Request): Promise<Response> {
  if (!resolveReferencePictureEnabled()) return Response.json({ error: "disabled" }, { status: 404 });
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  let body: unknown;
  try {
    body = await readBoundedJson(request, 32 * 1024);
  } catch (error) {
    return Response.json({ error: "invalid_json" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const input = body as { question?: unknown; subject?: unknown };
  if (typeof body !== "object" || body === null || Array.isArray(body) || typeof input.question !== "string" || !input.question.trim() || input.question.length > 12_000) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const question = input.question;
  const subject = typeof input.subject === "string" && SUBJECTS.has(input.subject) ? input.subject : undefined;
  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) return Response.json({ status: "declined", reason: "missing_key" });
  const { CALLS_PER_CANDIDATE, createPictureSpend, findReferencePicture, JUDGED_CANDIDATES } = await import("@/lib/reference-picture/findReferencePicture");

  // Funded one round at a time: the query and the first three judges now,
  // the second round and a generation only if they run.
  const ceiling = ceilings();
  const provider = resolveImageProvider();
  // Each candidate is judged and fact checked side by side: two judge calls.
  let funded = ceiling.query + JUDGED_CANDIDATES * CALLS_PER_CANDIDATE * ceiling.judge;
  const reservation = await reservePaidUsage({
    actor: gated.actor,
    grant: gated.grant,
    kind: "picture",
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    usd: funded,
  });
  if (reservation instanceof Response) return reservation;
  if (request.signal.aborted) {
    await reservation.cancelBeforeDispatch();
    return Response.json({ status: "declined", reason: "aborted" });
  }
  const disconnected = new AbortController();
  const signal = AbortSignal.any([request.signal, disconnected.signal, AbortSignal.timeout(50_000)]);
  const beforeRound = async (round: number | "generate"): Promise<boolean> => {
    signal.throwIfAborted();
    if (round === 0) return true;
    funded += round === "generate" ? ceiling.generate + CALLS_PER_CANDIDATE * ceiling.judge : JUDGED_CANDIDATES * CALLS_PER_CANDIDATE * ceiling.judge;
    return (await reservation.ensureReserved(funded)) === null;
  };
  const startedAt = Date.now();
  const spend = createPictureSpend();
  // JSON remains the default for labs and older clients. Only opted-in callers
  // receive two bounded frames: semantic requirement, then the final outcome.
  let required = false;
  const run = async (onRequirement?: (required: boolean) => void) => {
    try {
      const outcome = await findReferencePicture(question, subject, {
        apiKey, spend, signal, imageProvider: provider, beforeRound,
        onRequirement: (value) => { required ||= value; onRequirement?.(required); },
      });
      tutorDebug("llm", "reference picture", { status: outcome.status, ms: Date.now() - startedAt, steps: outcome.steps, usd: owed(spend, ceiling) });
      const steps = outcome.steps.slice(0, 40).map((step) => step.slice(0, 400));
      const requirement = required || outcome.required === true ? { required: true } : {};
      if (outcome.status === "ready") return { status: "ready", picture: outcome.picture, cached: outcome.cached, steps, ...requirement };
      return { status: "declined", reason: outcome.reason, steps, ...requirement };
    } catch (error) {
      const reason = request.signal.aborted || disconnected.signal.aborted ? "aborted"
        : (signal.aborted && signal.reason?.name === "TimeoutError") || (error instanceof Error && error.name === "TimeoutError") ? "server_timeout" : "pipeline_error";
      if (reason === "pipeline_error") console.warn("[reference-picture] failed", error instanceof Error ? error.message : error);
      return { status: "declined", reason, ...(required ? { required: true } : {}) };
    } finally {
      await reservation.settle(owed(spend, ceiling));
    }
  };
  if (request.headers.get("accept") !== "application/x-ndjson") return Response.json(await run());
  const encoder = new TextEncoder();
  let completion: Promise<void> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: object) => {
        if (!disconnected.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(frame) + "\n"));
      };
      completion = (async () => {
        try {
          const result = await run((value) => send({ type: "requirement", required: value }));
          send({ type: "result", ...result });
          if (!disconnected.signal.aborted) controller.close();
        } catch (error) {
          if (!disconnected.signal.aborted) controller.error(error);
        }
      })();
    },
    cancel() { disconnected.abort(); return completion; },
  });
  return new Response(stream, { headers: {
    "content-type": "application/x-ndjson",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  } });
}
