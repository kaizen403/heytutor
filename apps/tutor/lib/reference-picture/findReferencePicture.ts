import sharp from "sharp";
import type { ReferencePicturePlan, ReferencePictureRecord } from "@heytutor/drawing";
import { judgePicture, verdictAccepts, type PictureJudgeInput, type PictureVerdict } from "./pictureJudge";
import { generatePicture, resolveImageProvider, type ImageProviderConfig } from "./pictureGenerator";
import { writePictureQuery } from "./pictureQuery";
import { downloadPicture, rankCandidates, searchCommons, type PictureCandidate } from "./wikimediaSearch";
import { buildStrokePlan } from "./strokePlan";
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

interface Judged { candidate: PictureCandidate | null; bytes: Buffer; verdict: PictureVerdict; origin: PictureJudgeInput["origin"]; order: number }

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
  if (!query.wantsPicture) return decline("no_picture_wanted");

  const queryKey = store.queryKeyFor(query.mustShow);
  const cached = queryKey ? await db.readQueryCache(queryKey) : null;
  if (cached?.status === "ready") return { status: "ready", picture: cached.picture, cached: true, steps: [...steps, "cache: hit"] };
  if (cached?.status === "declined") return decline(`cached_${cached.reason}`);
  const remember = async (outcome: { pictureId: string } | { reason: string }) => {
    if (queryKey) await db.writeQueryCache(queryKey, outcome).catch(() => undefined);
  };

  const context: Context = { deps, spend, steps, mustShow: query.mustShow };
  const { judged, searched } = await judgeCommons(query.queries, context);
  let accepted = judged.filter((j) => verdictAccepts(j.verdict, j.origin)).sort((a, b) => b.verdict.confidence - a.verdict.confidence || a.order - b.order)[0];
  const provider = deps.imageProvider === undefined ? resolveImageProvider() : deps.imageProvider;
  if (!accepted && provider && (await deps.beforeRound?.("generate")) !== false) {
    const generated = await judgeGenerated(provider, context);
    if (generated && verdictAccepts(generated.verdict, "generated")) accepted = generated;
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
    const results = await Promise.all(batch.map((candidate, i) => judgeCandidate(candidate, round * JUDGED_CANDIDATES + i, context)));
    judged.push(...results.filter((r): r is Judged => r !== null));
    if (judged.some((j) => verdictAccepts(j.verdict, j.origin))) break;
  }
  return { judged, searched: offered };
}

async function judgeCandidate(candidate: PictureCandidate, order: number, context: Context): Promise<Judged | null> {
  const { deps, spend, steps, mustShow } = context;
  try {
    const { bytes } = await downloadPicture(candidate.imageUrl, { signal: deps.signal, fetchImpl: deps.fetchImpl });
    const imageDataUrl = await judgeDataUrl(bytes);
    const result = await tracked(spend, "judge", () => judgePicture({ mustShow, origin: "wikimedia", title: candidate.title, description: candidate.description, imageDataUrl }, { apiKey: deps.apiKey, signal: deps.signal, fetchImpl: deps.fetchImpl }), deps.signal);
    spend.usages.push({ lane: "judge", model: result.model, usage: result.usage });
    steps.push(`judge ${candidate.title}: ${verdictAccepts(result.verdict, "wikimedia") ? "accept" : "reject"} (${result.verdict.confidence}) ${result.verdict.problems.join("; ")}`);
    return { candidate, bytes, verdict: result.verdict, origin: "wikimedia", order };
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    steps.push(`judge ${candidate.title}: error ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function judgeGenerated(provider: ImageProviderConfig, context: Context): Promise<Judged | null> {
  const { deps, spend, steps, mustShow } = context;
  try {
    const { bytes } = await tracked(spend, "generate", () => generatePicture(mustShow, provider, { signal: deps.signal, fetchImpl: deps.fetchImpl }), deps.signal);
    spend.usages.push({ lane: "generate", model: provider.model, usage: null });
    const imageDataUrl = await judgeDataUrl(bytes);
    const result = await tracked(spend, "judge", () => judgePicture({ mustShow, origin: "generated", imageDataUrl }, { apiKey: deps.apiKey, signal: deps.signal, fetchImpl: deps.fetchImpl }), deps.signal);
    spend.usages.push({ lane: "judge", model: result.model, usage: result.usage });
    steps.push(`judge generated: ${verdictAccepts(result.verdict, "generated") ? "accept" : "reject"} ${result.verdict.problems.join("; ")}`);
    return { candidate: null, bytes, verdict: result.verdict, origin: "generated", order: JUDGED_CANDIDATES * JUDGE_ROUNDS };
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
  if (existing) { steps.push("store: existing"); return existing; }
  const built = await (deps.strokePlan ?? buildStrokePlan)(accepted.bytes);
  const plan: ReferencePicturePlan = built.plan;
  steps.push(`plan: ${built.stats.outlineStrokes} outline, ${built.stats.fillStrokes} fill, ${built.stats.planBytes} B, ${built.stats.ms} ms`);
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
      labels: accepted.verdict.labels,
      plan: { width: plan.width, height: plan.height, outlineLengthPx: plan.outline.lengthPx, fillLengthPx: plan.fill.lengthPx },
    },
  });
}
