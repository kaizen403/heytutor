/** Lab artifacts only. These helpers cannot save, recover or select geometry. */
import { createHash } from "node:crypto";
import { acceptParallelPrefix, parallelPrefixRendererSignature, type AcceptedParallelPrefix, type SetupAction } from "./parallelTeachingPrefix";

export interface PendingFigureIdentity {
  /** Exact original input, before question normalization. Private local evidence. */
  question: string;
  language: "english" | "hinglish";
  arm: string;
  familiarity: string;
  fastMode: boolean;
  productionStrictSubjects: readonly string[] | null;
  scenePlannerDeadlineMs: number;
  sceneDeclinePolicy: string;
  selectionVersion: string;
  rendererSHA256: string;
}

export interface PendingFigureCheckpoint {
  schemaVersion: "lab-pending-figure/v1";
  identity: PendingFigureIdentity;
  /** Lab admission/callback receipt, NOT proof the student heard this setup. */
  setup: { v: 1; actions: SetupAction[] } | null;
}

export const MAX_PENDING_FIGURE_BYTES = 16 * 1024;
export const MAX_PENDING_QUESTION_BYTES = 8 * 1024;
const bytes = (text: string): number => new TextEncoder().encode(text).length;
const invalid = (): Error => new Error("Invalid or mismatched lab pending-figure checkpoint");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function pendingFigureIdentity(input: Omit<PendingFigureIdentity, "rendererSHA256">): PendingFigureIdentity {
  if (!input.question.trim() || bytes(input.question) > MAX_PENDING_QUESTION_BYTES) throw invalid();
  const renderer = parallelPrefixRendererSignature();
  const identity = {
    ...input,
    productionStrictSubjects: input.productionStrictSubjects ? [...input.productionStrictSubjects] : null,
    rendererSHA256: createHash("sha256").update(renderer).digest("hex"),
  };
  // Raw UTF-8 size does not bound JSON escaping. Reserve the largest legal
  // two-action receipt before any provider IO so Stop can always serialize it.
  const actions = Object.keys(JSON.parse(renderer)).sort((a, b) =>
    bytes(JSON.stringify(b)) - bytes(JSON.stringify(a)),
  ).slice(0, 2);
  const largestCheckpoint = { schemaVersion: "lab-pending-figure/v1", identity, setup: { v: 1, actions } };
  if (bytes(JSON.stringify(largestCheckpoint)) > MAX_PENDING_FIGURE_BYTES) throw invalid();
  return identity;
}

/** Only actions that reconstruct the exact admitted host STEP may be saved. */
export function createPendingFigureCheckpoint(identity: PendingFigureIdentity, prefix: AcceptedParallelPrefix | null): PendingFigureCheckpoint {
  const setup = prefix ? { v: 1 as const, actions: [...prefix.actions] } : null;
  const canonical = setup ? acceptParallelPrefix(JSON.stringify(setup), identity.question, identity.language) : null;
  if (prefix && (!canonical?.accepted || canonical.raw !== prefix.raw)) throw invalid();
  const checkpoint: PendingFigureCheckpoint = { schemaVersion: "lab-pending-figure/v1", identity: structuredClone(identity), setup };
  if (bytes(JSON.stringify(checkpoint)) > MAX_PENDING_FIGURE_BYTES) throw invalid();
  return checkpoint;
}

/** Unknown JSON crosses this boundary before any provider IO. Never truncate
 * identity or hydrate saved plans/IR/scene/ink. All authority is rebuilt. */
export function restorePendingFigureCheckpoint(value: unknown, identity: PendingFigureIdentity): AcceptedParallelPrefix | null {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw invalid(); }
  if (!serialized || bytes(serialized) > MAX_PENDING_FIGURE_BYTES ||
      !record(value) || !exactKeys(value, ["schemaVersion", "identity", "setup"]) ||
      value.schemaVersion !== "lab-pending-figure/v1" || !record(value.identity) ||
      !exactKeys(value.identity, Object.keys(identity))) throw invalid();
  for (const key of Object.keys(identity) as (keyof PendingFigureIdentity)[]) {
    if (JSON.stringify(value.identity[key]) !== JSON.stringify(identity[key])) throw invalid();
  }
  if (value.setup === null) return null;
  if (!record(value.setup) || !exactKeys(value.setup, ["v", "actions"])) throw invalid();
  const accepted = acceptParallelPrefix(JSON.stringify(value.setup), identity.question, identity.language);
  if (!accepted.accepted) throw invalid();
  return accepted;
}

/** Glue for the existing overlap guard. Prompt Stop even when a port ignores
 * abort; abandoned work remains observed and its costs are not erased. */
export function awaitUnstopped<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      signal.removeEventListener("abort", stop);
      reject(new DOMException("Lab lecture stopped", "AbortError"));
    };
    operation.then(value => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) stop(); else resolve(value);
    }, error => {
      signal.removeEventListener("abort", stop);
      reject(error);
    });
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  });
}
