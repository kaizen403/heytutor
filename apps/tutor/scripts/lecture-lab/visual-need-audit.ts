/** Ask only the live Jev route for a frozen sample. Never dispatch a figure/teaching request. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTutorQuestion } from "@heytutor/tutor-core";
import { resolveLlmEndpoint } from "../../lib/llm/llmProvider";
import { fetchVisualNeedAssessment } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { parseDiagramEvalJsonl } from "./diagramEval";
import { applyLectureLabHeaders } from "./labAuth";
import { LabSpendCap, labSampleFingerprint, restoredLabCharge, runBudgetedLabRows } from "./run";
import { LAB_VISUAL_NEED_POLICY, budgetedVisualNeedFetch, compareVisualNeedAudit, parseVisualNeedReplay,
  summarizeVisualNeedCalls, visualNeedQuestionHash, type HistoricalVisualNeedRow,
  type VisualNeedCallAccounting, type VisualNeedReplayRow } from "./labVisualNeed";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHistoricalRound(path: string): Map<string, HistoricalVisualNeedRow> {
  const rows = new Map<string, HistoricalVisualNeedRow>();
  for (const file of readdirSync(resolve(path, "runs")).filter((file) => file.endsWith(".json")).sort()) {
    const raw: unknown = JSON.parse(readFileSync(resolve(path, "runs", file), "utf8"));
    if (!record(raw) || !record(raw.evaluation) || !record(raw.diagram) || typeof raw.evaluation.id !== "string" ||
      typeof raw.evaluation.question !== "string") throw new Error(`invalid historical record: ${file}`);
    if (rows.has(raw.evaluation.id)) throw new Error(`duplicate historical id: ${file}`);
    const vote = record(raw.plan) ? raw.plan.visualRequirement : null;
    rows.set(raw.evaluation.id, { question: raw.evaluation.question, committed: raw.diagram.committed === true,
      requirement: vote === "required" || vote === "optional" || vote === "none" ? vote : null });
  }
  return rows;
}

async function main(): Promise<void> {
  const flags = new Map<string, string>();
  const roundArgs: string[] = [];
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) throw new Error("audit options must use --name value");
    if (token === "--round") { roundArgs.push(argv[++index] ?? ""); continue; }
    const key = token.slice(2);
    if (key === "yes" || key === "resume") flags.set(key, "true");
    else flags.set(key, argv[++index] ?? "");
  }
  const maxUsd = Number(flags.get("max-usd"));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || flags.get("yes") !== "true") throw new Error("Jev audit requires --max-usd <positive dollars> and --yes");
  const concurrency = Number(flags.get("concurrency") ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("audit concurrency must be 1..10");
  const evaluation = flags.get("eval"), output = flags.get("out");
  if (!evaluation || !output || roundArgs.length === 0) throw new Error("audit requires --eval, --out and --round arm=path");
  const rows = parseDiagramEvalJsonl(readFileSync(resolve(evaluation), "utf8"));
  const historical: Record<string, Map<string, HistoricalVisualNeedRow>> = {};
  for (const arg of roundArgs) {
    const separator = arg.indexOf("=");
    if (separator <= 0 || historical[arg.slice(0, separator)]) throw new Error("invalid or duplicate --round arm=path");
    historical[arg.slice(0, separator)] = readHistoricalRound(resolve(arg.slice(separator + 1)));
  }
  // Identity includes all source bytes, so resume cannot mix a changed historical vote/image admission.
  const identity = { sampleFingerprint: labSampleFingerprint(rows), policy: LAB_VISUAL_NEED_POLICY,
    minIntervalMs: 650, tracePolicy: "one-audit-job/v1",
    historicalFingerprint: labSampleFingerprint(Object.entries(historical).map(([arm, records]) => [arm, [...records]])) };
  const outDir = resolve(output), origin = flags.get("origin") ?? "http://127.0.0.1:3000";
  const replayPath = resolve(outDir, "visual-need.jsonl"), checkpointPath = resolve(outDir, "spend-checkpoint.json");
  const resume = flags.get("resume") === "true";
  if (!resume && (existsSync(replayPath) || existsSync(checkpointPath))) throw new Error("audit output has evidence/spend; use --resume");
  if (resume && !existsSync(checkpointPath)) throw new Error("audit resume requires its spend checkpoint");
  const previous = resume ? JSON.parse(readFileSync(checkpointPath, "utf8")) as {
    identity: typeof identity; chargedUsd: number; reservedUsd: number; calls: VisualNeedCallAccounting[];
  } : null;
  if (previous && JSON.stringify(previous.identity) !== JSON.stringify(identity)) throw new Error("audit resume identity changed");
  const saved: VisualNeedReplayRow[] = existsSync(replayPath)
    ? readFileSync(replayPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const priorMap = parseVisualNeedReplay(saved.map((row) => JSON.stringify(row)).join("\n"), rows.filter((row) => saved.some((prior) => prior.id === row.id)));
  if (saved.some((row) => !rows.some((input) => input.id === row.id))) throw new Error("audit has foreign saved rows");
  if (existsSync(resolve(process.cwd(), ".env.local"))) process.loadEnvFile(resolve(process.cwd(), ".env.local"));
  const endpoint = resolveLlmEndpoint();
  if (endpoint.provider !== "azure" || endpoint.fallbackReason || !endpoint.apiKey || !endpoint.deployment) {
    throw new Error("audit requires the configured Azure provider; Fireworks calls are disabled");
  }
  const labHeaders = new Headers(); applyLectureLabHeaders(labHeaders);
  const configResponse = await fetch(`${origin}/api/lecture-lab/config`, { headers: labHeaders });
  if (!configResponse.ok) throw new Error("authenticated audit preflight failed");
  const config: unknown = await configResponse.json();
  if (!record(config) || config.provider !== endpoint.provider || config.deployment !== endpoint.deployment || config.configured !== true ||
    !record(config.visualNeed) || config.visualNeed.configured !== true ||
    Object.entries(LAB_VISUAL_NEED_POLICY).some(([key, value]) => !record(config.visualNeed) || config.visualNeed[key] !== value)) {
    throw new Error("audit requires the expected Azure server and configured live Jev policy");
  }
  const landing = await fetch(`${origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  if (!cookie) throw new Error("audit server issued no anonymous session cookie");
  const cap = new LabSpendCap(maxUsd), calls: VisualNeedCallAccounting[] = [...(previous?.calls ?? [])];
  cap.recordCost(restoredLabCharge(calls.reduce((sum, call) => sum + call.chargedUsd, 0), previous, 0));
  mkdirSync(outDir, { recursive: true });
  const checkpoint = () => writeFileSync(checkpointPath, JSON.stringify({ ...cap.summary(saved.length, rows.length), identity, calls }) + "\n");
  checkpoint();
  const pending = rows.filter((row) => !priorMap.has(row.id));
  const nativeFetch = globalThis.fetch;
  let budgetDenied = false;
  let localHttpDenied = false;
  let nextDispatchAt = 0;
  const auditTraceId = crypto.randomUUID();
  await runBudgetedLabRows(pending, concurrency, cap, async (row) => {
    if (localHttpDenied) return;
    // Stay below production's 120 paid requests/minute; wait before the client's 3 s timer.
    const dispatchAt = Math.max(Date.now(), nextDispatchAt);
    nextDispatchAt = dispatchAt + 650;
    await new Promise((ready) => setTimeout(ready, Math.max(0, dispatchAt - Date.now())));
    if (localHttpDenied) return;
    const headers = new Headers(labHeaders); headers.set("cookie", cookie);
    let denied = false;
    const fetchImpl: typeof fetch = (input, init) => {
      if (String(input) !== `${origin}/api/visual-need`) throw new Error("Jev-only audit forbids other paid endpoints");
      const combined = new Headers(init?.headers); headers.forEach((value, key) => combined.set(key, value));
      return budgetedVisualNeedFetch(input, { ...init, headers: combined }, nativeFetch, {
        reserve: (usd) => cap.reserveCall(usd), beforeDispatch: checkpoint,
        settle: (reserved, charged) => cap.settleCall(reserved, charged),
        onAccounting: (call) => { calls.push(call); if (call.httpStatus !== null && call.httpStatus >= 400) localHttpDenied = true; checkpoint(); },
        onDenied: () => { denied = true; budgetDenied = true; },
      });
    };
    const assessment = await fetchVisualNeedAssessment({ url: `${origin}/api/visual-need`,
      question: normalizeTutorQuestion(row.question), traceId: auditTraceId, fetchImpl });
    if (denied) return; // Untested, not a service failure or a no-figure vote.
    saved.push({ id: row.id, questionHash: visualNeedQuestionHash(row.question), ...LAB_VISUAL_NEED_POLICY, assessment });
    writeFileSync(replayPath, saved.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    checkpoint();
    if (saved.length % 50 === 0) console.log(`Jev audit ${saved.length}/${rows.length}; $${cap.summary(0, 0).chargedUsd.toFixed(6)} conservative`);
  });
  const assessments = parseVisualNeedReplay(saved.map((row) => JSON.stringify(row)).join("\n"), rows.filter((row) => saved.some((prior) => prior.id === row.id)));
  const compared = compareVisualNeedAudit(rows, assessments, historical);
  writeFileSync(resolve(outDir, "comparison.jsonl"), compared.records.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(resolve(outDir, "changed-sample.jsonl"), compared.changedRows.map((row) => JSON.stringify(row)).join("\n") + (compared.changedRows.length ? "\n" : ""));
  const summary = { ...compared.summary, ...cap.summary(saved.length, rows.length),
    provider: "vercel_ai_gateway", model: LAB_VISUAL_NEED_POLICY.model, policy: LAB_VISUAL_NEED_POLICY,
    figureProvider: endpoint.provider, figureDeployment: endpoint.deployment, figureCalls: 0, scenePlannerLimitMs: 60_000,
    identity, visualNeed: summarizeVisualNeedCalls(calls), untestedRows: rows.length - saved.length, budgetDenied,
    localHttpDenied, auditTraceId, measurementValid: !localHttpDenied && saved.some((row) => row.assessment.source === "jev") };
  writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ completed: saved.length, planned: rows.length, actionChangedUnion: compared.changedRows.length,
    ...cap.summary(saved.length, rows.length), figureCalls: 0 }, null, 2));
  if (localHttpDenied) throw new Error("audit stopped on a local HTTP denial; remaining rows are untested, not Jev answers");
}

if (process.argv[1]?.endsWith("visual-need-audit.ts")) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "audit failed"); process.exitCode = 1; });
}
