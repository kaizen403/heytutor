import sharp from "sharp";
import { referencePictureLayout, type ReferencePicturePlan, type ReferencePictureRecord } from "@heytutor/drawing";
import { acceptedLabels, factCheckPasses, factCheckPicture, judgePicture, verdictAccepts, type FactCheckResult, type PictureJudgeInput, type PictureVerdict } from "./pictureJudge";
import { generatePicture, resolveImageProvider, type ImageProviderConfig } from "./pictureGenerator";
import { writePictureQuery } from "./pictureQuery";
import { downloadPicture, rankCandidates, searchCommons, type PictureCandidate } from "./wikimediaSearch";
import { buildStrokePlan } from "./strokePlan";
import { locateReferencePictureParts } from "./partLocator";
import { resolveReferencePicturePartFocusEnabled } from "@/lib/scene/diagramStrategy.server";
import * as store from "./pictureStore";

/**
 * The reference picture pipeline: question → topic and search phrases →
 * Commons search → judge the top candidates in parallel → (generator, when
 * configured) → stroke plan → store. Every exit that is not an accepted
 * picture is a decline, and the lesson teaches as text, exactly as before.
 */

/** Candidates judged per round. Parallel, so a round costs one judge call of latency. */
export const JUDGED_CANDIDATES = 3;
/** A second round runs only when every first-round candidate was rejected. */
export const JUDGE_ROUNDS = 2;
/** The judge sees the picture at this width at most: labels stay legible. */
const JUDGE_WIDTH = 1024;
/** Decoding bound for anything handed to sharp here (the stroke plan sets its own). */
const MAX_INPUT_PIXELS = 40_000_000;

export type PictureUsage = { lane: "query" | "judge" | "generate"; model: string; usage: unknown };

/**
 * What the pipeline has spent, owned by the caller so a throw or an abort
 * still settles what was dispatched: finished calls by their usage, calls
 * still in flight at their ceiling.
 */
export interface PictureSpend {
  usages: PictureUsage[];
  inFlight: { query: number; judge: number; generate: number };
}

export function createPictureSpend(): PictureSpend {
  return { usages: [], inFlight: { query: 0, judge: 0, generate: 0 } };
}

/**
 * Count a provider call while it runs. A call cut off by an abort stays
 * counted: it was dispatched and may be billed. An upstream error response
 * (no completion) is not.
 */
async function tracked<T>(spend: PictureSpend, lane: PictureUsage["lane"], run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  spend.inFlight[lane]++;
  try {
    const result = await run();
    spend.inFlight[lane]--;
    return result;
  } catch (error) {
    if (!signal?.aborted) spend.inFlight[lane]--;
    throw error;
  }
}

export type FindPictureOutcome =
  | { status: "ready"; picture: ReferencePictureRecord; cached: boolean; steps: string[] }
  | { status: "declined"; reason: string; steps: string[] };

export interface FindPictureDeps {
  apiKey: string;
  spend?: PictureSpend;
  signal?: AbortSignal;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  imageProvider?: ImageProviderConfig | null;
  store?: Pick<typeof store, "readQueryCache" | "writeQueryCache" | "saveReferencePicture" | "findPictureBySourceKey">;
  strokePlan?: typeof buildStrokePlan;
  /** Where the picture's names are printed; any failure stores the picture without parts. */
  locateParts?: typeof locateReferencePictureParts;
  /**
   * Called before each judge round (0, 1) and before a generation, so the
   * caller can extend its reservation; false stops the search there.
   */
  beforeRound?: (round: number | "generate") => Promise<boolean>;
}

async function judgeDataUrl(bytes: Buffer): Promise<string> {
  const png = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: "#ffffff" }).resize({ width: JUDGE_WIDTH, withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

interface Judged { candidate: PictureCandidate | null; bytes: Buffer; verdict: PictureVerdict; factCheck: FactCheckResult; origin: PictureJudgeInput["origin"]; order: number }

/** Every candidate costs two judge-model calls: the judge and the fact check, run side by side. */
export const CALLS_PER_CANDIDATE = 2;

const UNREAD_FACT_CHECK: FactCheckResult = { claims: [], readable: false };

/**
 * A verdict the board can show: the judge accepted it, and a numbered
 * picture's key fits beside it at the label size with the picture still large
 * enough to find its numbers. A key that cannot be written is a rejection: a
 * numbered picture is never shown without its key.
 */
function usable(judged: Pick<Judged, "candidate" | "verdict" | "factCheck" | "origin">): boolean {
  if (!verdictAccepts(judged.verdict, judged.origin) || !factCheckPasses(judged.factCheck)) return false;
  // A picture with labels or a key states things; a check that listed none checked nothing.
  if (judged.factCheck.claims.length === 0 && judged.verdict.labelLanguage !== "none") return false;
  const { legend } = acceptedLabels(judged.verdict);
  if (!legend) return true;
  const size = judged.candidate ? { width: judged.candidate.width, height: judged.candidate.height } : null;
  return size !== null && referencePictureLayout({ plan: size, legend }) !== null;
}

function verdictStep(judged: Pick<Judged, "candidate" | "verdict" | "factCheck" | "origin">): string {
  const { legend } = acceptedLabels(judged.verdict);
  const accepted = usable(judged);
  const key = judged.verdict.labelLanguage === "numbers"
    ? legend ? ` key ${legend.length}${accepted ? "" : " does not fit beside the picture"}` : ` key incomplete (${judged.verdict.marks.length} marks, ${judged.verdict.numberKey.length} entries, ${judged.verdict.keySource}, ${judged.verdict.keyLanguage})`
    : "";
  const wrong = judged.factCheck.readable
    ? judged.factCheck.claims.filter((claim) => !claim.correct).map((claim) => `fact check: ${claim.text}: ${claim.why}`)
    : ["fact check unreadable or failed"];
  return `${accepted ? "accept" : "reject"} (${judged.verdict.confidence})${key} ${[...judged.verdict.problems, ...wrong].join("; ")}`;
}

interface Context { deps: FindPictureDeps; spend: PictureSpend; steps: string[]; mustShow: string }

export async function findReferencePicture(question: string, subject: string | undefined, deps: FindPictureDeps): Promise<FindPictureOutcome> {
  const spend = deps.spend ?? createPictureSpend();
  const steps: string[] = [];
  const db = deps.store ?? store;
  const decline = (reason: string): FindPictureOutcome => ({ status: "declined", reason, steps });

  const written = await tracked(spend, "query", () => writePictureQuery(question, { apiKey: deps.apiKey, subject, signal: deps.signal, fetchImpl: deps.fetchImpl }), deps.signal);
  spend.usages.push({ lane: "query", model: written.model, usage: written.usage });
  const query = written.query;
  if (!query) return decline("query_unreadable");
  steps.push(`query: ${query.mustShow} | ${query.queries.join(" ; ")}`);
  if (!query.wantsPicture) return decline(query.declineReason ?? "no_picture_wanted");

  const queryKey = store.queryKeyFor(query.mustShow);
  const cached = queryKey ? await db.readQueryCache(queryKey) : null;
  if (cached?.status === "ready") return { status: "ready", picture: cached.picture, cached: true, steps: [...steps, "cache: hit"] };
  if (cached?.status === "declined") return decline(`cached_${cached.reason}`);
  const remember = async (outcome: { pictureId: string } | { reason: string }) => {
    if (queryKey) await db.writeQueryCache(queryKey, outcome).catch(() => undefined);
  };

  const context: Context = { deps, spend, steps, mustShow: query.mustShow };
  const { judged, searched } = await judgeCommons(query.queries, context);
  // A picture labelled in words beats a numbered one: it is drawn larger and
  // the student reads each name where it sits instead of in a key.
  const numbered = (j: Judged) => (j.verdict.labelLanguage === "numbers" ? 1 : 0);
  let accepted = judged.filter(usable).sort((a, b) => numbered(a) - numbered(b) || b.verdict.confidence - a.verdict.confidence || a.order - b.order)[0];
  const provider = deps.imageProvider === undefined ? resolveImageProvider() : deps.imageProvider;
  if (!accepted && provider && (await deps.beforeRound?.("generate")) !== false) {
    const generated = await judgeGenerated(provider, context);
    if (generated && usable(generated)) accepted = generated;
  }
  if (!accepted) {
    const reason = judged.length ? "no_candidate_accepted" : searched ? "no_candidates" : "search_failed";
    // Only a verdict is worth remembering: a timeout or upstream error is retried next time.
    if (searched && judged.length === searched) await remember({ reason });
    return decline(reason);
  }
  let picture: ReferencePictureRecord;
  try {
    picture = await storeAccepted(accepted, context, db);
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    // A picture the planner or the store cannot take fails the same way next
    // time; remembering it stops paying the judge again for a known failure.
    steps.push(`store: error ${error instanceof Error ? error.message : String(error)}`);
    await remember({ reason: "plan_failed" });
    return decline("plan_failed");
  }
  await remember({ pictureId: picture.id });
  return { status: "ready", picture, cached: false, steps };
}

async function judgeCommons(queries: string[], context: Context): Promise<{ judged: Judged[]; searched: number }> {
  const { deps, steps } = context;
  const found = rankCandidates(await searchCommons(queries, { limit: JUDGED_CANDIDATES * JUDGE_ROUNDS + 4, signal: deps.signal, fetchImpl: deps.fetchImpl }));
  const judged: Judged[] = [];
  let offered = 0;
  for (let round = 0; round < JUDGE_ROUNDS; round++) {
    const batch = found.slice(round * JUDGED_CANDIDATES, (round + 1) * JUDGED_CANDIDATES);
    if (!batch.length) break;
    if ((await deps.beforeRound?.(round)) === false) { steps.push(`round ${round + 1}: not funded`); break; }
    offered += batch.length;
    steps.push(`search round ${round + 1}: ${batch.map((c) => c.title).join(" | ")}`);
    const results = await judgeRound(batch, round * JUDGED_CANDIDATES, context);
    judged.push(...results.filter((r): r is Judged => r !== null));
    if (judged.some(usable)) break;
  }
  return { judged, searched: offered };
}

/**
 * After the first usable verdict in a round, how long the other judges may
 * still answer before they are cut off. A round used to wait for its slowest
 * call: on 27 Oct 2026 one Ember-1 call ran to its timeout and a cold mitosis
 * request missed the turn's 25 s wait. A better ranked picture that answers
 * inside the grace still wins.
 */
export const ROUND_GRACE_MS = 1500;

async function judgeRound(batch: readonly PictureCandidate[], firstOrder: number, context: Context): Promise<Array<Judged | null>> {
  const outer = context.deps.signal;
  const cut = new AbortController();
  const signal = outer ? AbortSignal.any([outer, cut.signal]) : cut.signal;
  const roundContext: Context = { ...context, deps: { ...context.deps, signal } };
  const results: Array<Judged | null> = batch.map(() => null);
  await new Promise<void>((resolve) => {
    let pending = batch.length;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearTimeout(grace); resolve(); };
    batch.forEach((candidate, i) => {
      judgeCandidate(candidate, firstOrder + i, roundContext).then(
        (judged) => { results[i] = judged; },
        () => { results[i] = null; },
      ).finally(() => {
        pending--;
        if (pending === 0) return done();
        let ready = false;
        try { ready = results[i] !== null && usable(results[i]!); } catch { ready = false; }
        if (ready && !grace) grace = setTimeout(done, ROUND_GRACE_MS);
      });
    });
  });
  if (outer?.aborted) throw outer.reason ?? new Error("aborted");
  // Judges still running are cut off; a call cut this way stays counted as dispatched.
  cut.abort();
  return results;
}

async function judgeCandidate(candidate: PictureCandidate, order: number, context: Context): Promise<Judged | null> {
  const { deps, spend, steps, mustShow } = context;
  try {
    const { bytes } = await downloadPicture(candidate.imageUrl, { signal: deps.signal, fetchImpl: deps.fetchImpl });
    const imageDataUrl = await judgeDataUrl(bytes);
    const options = { apiKey: deps.apiKey, signal: deps.signal, fetchImpl: deps.fetchImpl };
    const [result, fact] = await Promise.all([
      // Usage is recorded the moment the call returns, so a judge that finished
      // while its fact check was cut off by the round's grace is still billed.
      tracked(spend, "judge", async () => {
        const judged = await judgePicture({ mustShow, origin: "wikimedia", title: candidate.title, description: candidate.description, imageDataUrl }, options);
        spend.usages.push({ lane: "judge", model: judged.model, usage: judged.usage });
        return judged;
      }, deps.signal),
      factCheck(mustShow, imageDataUrl, context, candidate.description),
    ]);
    const judged: Judged = { candidate, bytes, verdict: result.verdict, factCheck: fact, origin: "wikimedia", order };
    steps.push(`judge ${candidate.title}: ${verdictStep(judged)}`);
    return judged;
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    steps.push(`judge ${candidate.title}: error ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The fact check for one picture; a failed or unreadable check rejects it. */
async function factCheck(mustShow: string, imageDataUrl: string, context: Context, description?: string): Promise<FactCheckResult> {
  const { deps, spend } = context;
  try {
    const checked = await tracked(spend, "judge", async () => {
      const result = await factCheckPicture({ mustShow, imageDataUrl, ...(description ? { description } : {}) }, { apiKey: deps.apiKey, signal: deps.signal, fetchImpl: deps.fetchImpl });
      spend.usages.push({ lane: "judge", model: result.model, usage: result.usage });
      return result;
    }, deps.signal);
    return checked.result;
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    return UNREAD_FACT_CHECK;
  }
}

async function judgeGenerated(provider: ImageProviderConfig, context: Context): Promise<Judged | null> {
  const { deps, spend, steps, mustShow } = context;
  try {
    const { bytes } = await tracked(spend, "generate", () => generatePicture(mustShow, provider, { signal: deps.signal, fetchImpl: deps.fetchImpl }), deps.signal);
    spend.usages.push({ lane: "generate", model: provider.model, usage: null });
    const imageDataUrl = await judgeDataUrl(bytes);
    const [result, fact] = await Promise.all([
      tracked(spend, "judge", async () => {
        const judged = await judgePicture({ mustShow, origin: "generated", imageDataUrl }, { apiKey: deps.apiKey, signal: deps.signal, fetchImpl: deps.fetchImpl });
        spend.usages.push({ lane: "judge", model: judged.model, usage: judged.usage });
        return judged;
      }, deps.signal),
      factCheck(mustShow, imageDataUrl, context),
    ]);
    const judged: Judged = { candidate: null, bytes, verdict: result.verdict, factCheck: fact, origin: "generated", order: JUDGED_CANDIDATES * JUDGE_ROUNDS };
    steps.push(`judge generated: ${verdictStep(judged)}`);
    return judged;
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    steps.push(`generate: error ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function storeAccepted(accepted: Judged, context: Context, db: NonNullable<FindPictureDeps["store"]>): Promise<ReferencePictureRecord> {
  const { deps, steps, mustShow } = context;
  const candidate = accepted.candidate;
  const sourceKey = candidate ? `wikimedia:${candidate.title}` : `generated:${store.queryKeyFor(mustShow) ?? mustShow.toLowerCase()}`;
  const existing = await db.findPictureBySourceKey(sourceKey);
  if (existing) {
    // The same file read the other way this time (named labels then, a
    // numbered key now, or the reverse) is not the picture that was checked.
    if (Boolean(existing.legend?.length) !== Boolean(acceptedLabels(accepted.verdict).legend?.length)) throw new Error("stored record disagrees with this verdict on the key");
    steps.push("store: existing");
    return existing;
  }
  const built = await (deps.strokePlan ?? buildStrokePlan)(accepted.bytes);
  const plan: ReferencePicturePlan = built.plan;
  steps.push(`plan: ${built.stats.outlineStrokes} outline, ${built.stats.fillStrokes} fill, ${built.stats.planBytes} B, ${built.stats.ms} ms`);
  const { labels, legend } = acceptedLabels(accepted.verdict);
  // Checked on the thumbnail's size before acceptance; the plan keeps its
  // aspect, so this holds unless the planner changed shape.
  if (legend && !referencePictureLayout({ plan, legend })) throw new Error("the key does not fit beside the planned picture");
  // Parts are located and stored whatever the flag says, so turning part
  // focus on needs no re-judging; the store serves them only with it on.
  const located = await (deps.locateParts ?? locateReferencePictureParts)({
    candidate: candidate ? { mime: candidate.mime, ...(candidate.originalUrl ? { originalUrl: candidate.originalUrl } : {}) } : null,
    plan,
    picturePng: built.picturePng,
    labels,
    legend,
    signal: deps.signal,
    fetchImpl: deps.fetchImpl,
  });
  if (resolveReferencePicturePartFocusEnabled()) steps.push(`parts: ${located.step}`);
  const id = store.pictureIdFor(sourceKey);
  return db.saveReferencePicture({
    sourceKey,
    image: built.picturePng,
    imageType: "image/png",
    plan,
    record: {
      id,
      source: candidate ? "wikimedia" : "generated",
      title: candidate ? candidate.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "") : mustShow,
      pageUrl: candidate?.pageUrl ?? null,
      license: candidate?.license ?? "Generated",
      licenseUrl: candidate?.licenseUrl ?? null,
      artist: candidate?.artist ?? "Generated illustration",
      width: plan.width,
      height: plan.height,
      shows: accepted.verdict.shows,
      labels,
      ...(legend ? { legend } : {}),
      ...(located.parts.length ? { parts: located.parts } : {}),
      plan: { width: plan.width, height: plan.height, outlineLengthPx: plan.outline.lengthPx, fillLengthPx: plan.fill.lengthPx },
    },
  });
}
