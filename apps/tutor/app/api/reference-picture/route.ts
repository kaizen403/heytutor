import { requireLessonGrant } from "@/lib/billing/gate";
import { actualLlmCost, reservePaidUsage } from "@/lib/billing/paidUsage";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import { usageDetailsFromParsed, parseProviderUsage } from "@/lib/obs/providerUsage";
import { createPictureSpend, findReferencePicture, JUDGED_CANDIDATES, type PictureSpend } from "@/lib/reference-picture/findReferencePicture";
import { resolvePictureJudgeModel } from "@/lib/reference-picture/pictureJudge";
import { resolveImageProvider } from "@/lib/reference-picture/pictureGenerator";
import { resolvePictureQueryModel } from "@/lib/reference-picture/pictureQuery";
import { resolveReferencePictureEnabled } from "@/lib/scene/diagramStrategy.server";
import { tutorDebug } from "@heytutor/tutor-core";

/** A generated picture has no token usage; price it as one medium image. */
const GENERATED_IMAGE_USD = 0.06;
const SUBJECTS = new Set(["maths", "physics", "chemistry", "biology", "other"]);

/** Per-call ceilings: the reservation funds these, a call in flight at settle costs this. */
function ceilings() {
  return {
    query: actualLlmCost({ input: 2500, output: 300 }, resolvePictureQueryModel()) ?? 0.01,
    judge: actualLlmCost({ input: 6000, output: 2000 }, resolvePictureJudgeModel()) ?? 0.15,
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
  const subject = typeof input.subject === "string" && SUBJECTS.has(input.subject) ? input.subject : undefined;
  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) return Response.json({ status: "declined", reason: "missing_key" });

  // Funded one round at a time: the query and the first three judges now,
  // the second round and a generation only if they run.
  const ceiling = ceilings();
  const provider = resolveImageProvider();
  let funded = ceiling.query + JUDGED_CANDIDATES * ceiling.judge;
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
  const beforeRound = async (round: number | "generate"): Promise<boolean> => {
    if (round === 0) return true;
    funded += round === "generate" ? ceiling.generate + ceiling.judge : JUDGED_CANDIDATES * ceiling.judge;
    return (await reservation.ensureReserved(funded)) === null;
  };
  const startedAt = Date.now();
  const spend = createPictureSpend();
  try {
    const outcome = await findReferencePicture(input.question, subject, { apiKey, spend, signal: request.signal, imageProvider: provider, beforeRound });
    tutorDebug("llm", "reference picture", { status: outcome.status, ms: Date.now() - startedAt, steps: outcome.steps, usd: owed(spend, ceiling) });
    if (outcome.status === "ready") return Response.json({ status: "ready", picture: outcome.picture, cached: outcome.cached });
    return Response.json({ status: "declined", reason: outcome.reason });
  } catch (error) {
    if (request.signal.aborted) return Response.json({ status: "declined", reason: "aborted" });
    console.warn("[reference-picture] failed", error instanceof Error ? error.message : error);
    return Response.json({ status: "declined", reason: "pipeline_error" });
  } finally {
    await reservation.settle(owed(spend, ceiling));
  }
}
