import { FIREWORKS_CHAT_URL } from "@/lib/llm/llmProvider";
import { DEFAULT_CHEAP_FIREWORKS_MODEL } from "@/lib/llm/fireworksModels";
import { ProviderRefusedError } from "./providerErrors";

/**
 * One cheap call turns the student's question into what the picture must show
 * and a few Commons search phrases. It decides nothing about truth: the judge
 * still reads every candidate against the question.
 */

export function resolvePictureQueryModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.REFERENCE_PICTURE_QUERY_MODEL?.trim() || DEFAULT_CHEAP_FIREWORKS_MODEL;
}

export interface PictureQuery {
  /** Set when a deterministic guard, not the model, turned the picture down. */
  declineReason?: "question_specific_figure";
  /** False when no single real picture would help (a calculation, an essay ask). */
  wantsPicture: boolean;
  /** Plain English: the one structure, organism, process or apparatus to show. */
  mustShow: string;
  /** Short English Commons search phrases, best first. */
  queries: string[];
}

const QUERY_RULES = `A tutor wants one real textbook-style picture (a labelled diagram, an anatomy drawing, a life cycle, a piece of lab apparatus) to show beside a lesson.
Given the student's question, reply with only compact JSON:
{"wantsPicture":boolean,"mustShow":"the topic of the picture with the aspect the question asks about, in plain English, at most 10 words, e.g. 'structure of the human heart', 'stages of mitosis', 'apparatus for simple distillation', 'process of photosynthesis'; never a checklist of parts","queries":["2 to 4 short English search phrases for Wikimedia Commons, best first, each 2 to 5 words, ending with diagram when a diagram fits"]}
When the question compares two things, the topic is the first one alone (the tutor draws one picture).
Set wantsPicture false when the question is a numeric calculation, a proof, code, an essay or opinion, or when no single real picture would help.
Set wantsPicture false when the figure would have to carry the question's own numbers or data (a graph of given values, a circuit with given resistances, a ray diagram with given distances, a free body diagram with given forces): a stock picture would show different numbers.
Translate the topic to English if the question is in another language. Never include the student's numbers or names in the queries.`;

export function queryRequestBody(question: string, subject: string | undefined, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: 300,
    temperature: 0,
    reasoning_effort: "none",
    stream: false,
    messages: [
      { role: "system", content: QUERY_RULES },
      { role: "user", content: `${subject ? `Subject: ${subject}\n` : ""}Question: ${question.slice(0, 2000)}` },
    ],
  };
}

/**
 * A graph, circuit, ray or force diagram of a question that states numbers is
 * that question's own figure: a stock picture would carry other values, which
 * is a false figure. The verified engine draws those or the lesson is text.
 */
const QUESTION_SPECIFIC_TOPIC = /\b(graph|plot|curve|circuit|ray diagram|free[- ]body|force diagram|trajectory|number line|histogram|bar chart|pie chart)s?\b/i;

export function questionSpecificFigure(question: string, mustShow: string): boolean {
  return QUESTION_SPECIFIC_TOPIC.test(mustShow) && /\d/.test(question);
}

export function parsePictureQuery(text: string): PictureQuery | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    // The topic is the only model-written text the judge sees, so it is
    // reduced to plain words: no quotes, colons or sentences to steer it with.
    const mustShow = typeof raw.mustShow === "string"
      ? raw.mustShow.replace(/[^\p{L}\p{N}\s,'()-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ")
      : "";
    const queries = Array.isArray(raw.queries)
      ? raw.queries.filter((q): q is string => typeof q === "string").map((q) => q.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim()).filter((q) => q.length >= 3 && q.length <= 60).slice(0, 4)
      : [];
    const wantsPicture = raw.wantsPicture === true && mustShow.length > 0 && queries.length > 0;
    return { wantsPicture, mustShow, queries };
  } catch {
    return null;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function writePictureQuery(question: string, options: { apiKey: string; subject?: string; model?: string; signal?: AbortSignal; fetchImpl?: FetchLike }): Promise<{ query: PictureQuery | null; model: string; usage: unknown }> {
  const model = options.model ?? resolvePictureQueryModel();
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const response = await fetchImpl(FIREWORKS_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    signal,
    body: JSON.stringify(queryRequestBody(question, options.subject, model)),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderRefusedError(`Picture query upstream ${response.status} from ${model}`, response.status);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[]; usage?: unknown };
  const content = data.choices?.[0]?.message?.content;
  const query = parsePictureQuery(typeof content === "string" ? content : "");
  if (query?.wantsPicture && questionSpecificFigure(question, query.mustShow)) {
    return { query: { ...query, wantsPicture: false, declineReason: "question_specific_figure" }, model, usage: data.usage };
  }
  return { query, model, usage: data.usage };
}
