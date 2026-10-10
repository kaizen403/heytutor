/** Synthetic CLI/HTTP regression: no model calls, credentials or student data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { LAB_VISUAL_NEED_POLICY } from "../lecture-lab/labVisualNeed";
import { ensureBypassGrant, resetTurnGrantsForTests } from "../../lib/billing/grant";
import { calculateLlmCostDetails } from "../../lib/obs/usageCost";

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "heytutor-jev-audit-"));
  const calls: string[] = [];
  const questionCalls: string[] = [];
  let deniedQuestion: string | null = null;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/lecture-lab/config") {
      response.end(JSON.stringify({ provider: "azure", deployment: "synthetic-gpt-6-1-deployment", configured: true,
        visualNeed: { ...LAB_VISUAL_NEED_POLICY, configured: true } })); return;
    }
    if (request.url === "/") { response.setHeader("set-cookie", "htutor_uid=synthetic-audit"); response.end("{}"); return; }
    assert.equal(request.url, "/api/visual-need", "the audit cannot call a figure/teaching endpoint");
    const trace = String(request.headers["x-heytutor-trace-id"]);
    calls.push(trace);
    if (!ensureBypassGrant({ userId: "synthetic-audit", traceId: trace })) {
      response.statusCode = 429; response.end(JSON.stringify({ code: "concurrent_limit" })); return;
    }
    let body = ""; for await (const chunk of request) body += chunk;
    const question = JSON.parse(body).question as string;
    questionCalls.push(question);
    if (question === deniedQuestion) {
      response.statusCode = 429; response.end(JSON.stringify({ code: "synthetic_local_denial" })); return;
    }
    response.end(JSON.stringify({ decision: "none", source: "jev", unavailableReason: null,
      usage: { knownUsage: true, inputTokens: 100, outputTokens: 0, estimatedUsd: 0.0000042, reportedCostUsd: null },
      provenance: { model: LAB_VISUAL_NEED_POLICY.model, rubricVersion: LAB_VISUAL_NEED_POLICY.rubricVersion,
        policyVersion: LAB_VISUAL_NEED_POLICY.policyVersion, inputHash: createHash("sha256").update(question).digest("hex"),
        latencyMs: 1, gatewayModel: null, generationId: null } }));
  });
  try {
    resetTurnGrantsForTests();
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address(); assert(address && typeof address !== "string");
    const sample = Array.from({ length: 7 }, (_, index) => ({ id: `synthetic-${index}`, topic_id: `maths|test|${index}`,
      subject: "maths", difficulty: "easy", question: `Explain synthetic concept ${index}.`, source: { kind: "authored", ref: null },
      figure_need: "optional", figure_kind: "none", must_show: [], must_label: [], must_not_show: [], trap: null, notes: "Synthetic." }));
    const samplePath = join(directory, "sample.jsonl"), roundPath = join(directory, "historical"), output = join(directory, "audit");
    writeFileSync(samplePath, sample.map((row) => JSON.stringify(row)).join("\n")); mkdirSync(join(roundPath, "runs"), { recursive: true });
    for (const row of sample) writeFileSync(join(roundPath, "runs", `${row.id}.json`), JSON.stringify({ evaluation: row,
      plan: { visualRequirement: "optional" }, diagram: { committed: true } }));
    const args = ["--import", "tsx", "scripts/lecture-lab/visual-need-audit.ts", "--eval", samplePath, "--round", `current=${roundPath}`,
      "--yes", "--origin", `http://127.0.0.1:${address.port}`];
    const run = (options: { resume?: boolean; output?: string; maxUsd?: string; concurrency?: string } = {}) => new Promise<number | null>((done) => {
      const child = spawn(process.execPath, [...args, "--out", options.output ?? output, "--max-usd", options.maxUsd ?? "0.02",
        "--concurrency", options.concurrency ?? "4", ...(options.resume ? ["--resume"] : [])], { cwd: resolve(import.meta.dirname, "../.."),
        env: { ...process.env, LECTURE_LAB_TOKEN: "synthetic-token", LLM_PROVIDER: "azure",
          AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid/", AZURE_OPENAI_DEPLOYMENT: "synthetic-gpt-6-1-deployment",
          AZURE_OPENAI_API_KEY: "synthetic-key-never-sent", FIREWORKS_API_KEY: "", AI_GATEWAY_API_KEY: "" }, stdio: "pipe" });
      child.stdout.resume(); child.stderr.resume(); child.on("close", done);
    });
    assert.equal(await run(), 0);
    const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
    assert.equal(summary.visualNeed.knownUsageCalls, 7, "more than five Jev-only rows must not exhaust idle bypass trace slots");
    assert.equal(new Set(calls).size, 1, "one Jev-only audit job owns one stable trace, not a new idle lesson per row");
    assert.equal(summary.actionChangedUnion, 7);
    assert.equal(summary.figureCalls, 0);
    assert.equal(summary.figureDeployment, "synthetic-gpt-6-1-deployment", "record the configured deployment name, not a hard-coded model alias");
    assert(Math.abs(summary.visualNeed.chargedUsd - 7 * (calculateLlmCostDetails({ input: 100, output: 0 }, { model: LAB_VISUAL_NEED_POLICY.model }).total ?? NaN)) < 1e-12);
    assert.equal(await run({ resume: true }), 0);
    assert.equal(calls.length, 7, "resume skips completed answers and retains their charge");

    // A denied row is untested, not a frozen answer. A budget-blocked resume
    // must retain the denial until that exact question can actually be retried.
    resetTurnGrantsForTests(); calls.length = 0; questionCalls.length = 0;
    deniedQuestion = sample[1]!.question;
    const deniedOutput = join(directory, "denied-audit");
    assert.equal(await run({ output: deniedOutput, concurrency: "1" }), 1);
    const initial = JSON.parse(readFileSync(join(deniedOutput, "summary.json"), "utf8"));
    assert.equal(initial.measurementValid, false);
    const initialCharge = initial.chargedUsd;
    assert(initialCharge > 0, "even denied requests retain their conservative charge");
    assert.equal(await run({ output: deniedOutput, resume: true, maxUsd: "0.000001" }), 0);
    const blocked = JSON.parse(readFileSync(join(deniedOutput, "summary.json"), "utf8"));
    assert.equal(blocked.measurementValid, false, "resume cannot hide an unresolved local denial behind a saved Jev answer");
    assert.equal(blocked.untestedRows, 6);
    assert.deepEqual(blocked.unresolvedLocalDenials, [sample[1]!.id]);
    assert.equal(calls.length, 2, "an exhausted cap must not send a retry");
    assert.equal(blocked.chargedUsd, initialCharge, "resume retains the denied call's charge");

    // Migrate the pre-fix replay shape, which saved HTTP denials as unavailable.
    const replayPath = join(deniedOutput, "visual-need.jsonl");
    const saved = readFileSync(replayPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    saved.push({ ...saved[0], id: sample[1]!.id,
      questionHash: createHash("sha256").update(sample[1]!.question).digest("hex"),
      assessment: { decision: null, source: "unavailable", unavailableReason: "http_429" } });
    writeFileSync(replayPath, saved.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const checkpointPath = join(deniedOutput, "spend-checkpoint.json");
    const oldCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    delete oldCheckpoint.unresolvedLocalDenials;
    writeFileSync(checkpointPath, JSON.stringify(oldCheckpoint));
    assert.equal(await run({ output: deniedOutput, resume: true, maxUsd: "0.000001" }), 0);
    const legacyBlocked = JSON.parse(readFileSync(join(deniedOutput, "summary.json"), "utf8"));
    assert.equal(legacyBlocked.measurementValid, false, "legacy saved HTTP denials remain unresolved too");
    assert.equal(legacyBlocked.untestedRows, 6);
    deniedQuestion = null;
    assert.equal(await run({ output: deniedOutput, resume: true, concurrency: "1" }), 0);
    const recovered = JSON.parse(readFileSync(join(deniedOutput, "summary.json"), "utf8"));
    assert.equal(recovered.measurementValid, true);
    assert.equal(recovered.untestedRows, 0);
    assert.deepEqual(recovered.unresolvedLocalDenials, []);
    assert.equal(questionCalls.filter((question) => question === sample[0]!.question).length, 1, "completed answers are never paid twice");
    assert.equal(questionCalls.filter((question) => question === sample[1]!.question).length, 2, "only the locally denied question must be retried");
    assert.equal(recovered.visualNeed.knownUsageCalls, 7);
    assert.equal(recovered.visualNeed.unknownUsageCalls, 1, "successful retry does not erase the earlier denied reservation");
    assert(recovered.chargedUsd > initialCharge);
    assert.equal(readFileSync(replayPath, "utf8").trim().split("\n").length, 7, "legacy denied evidence is replaced without duplicate replay IDs");

    // Crash between saving the successful retry and clearing its denial in
    // the checkpoint: the retained answer is authoritative, even with no cap left.
    const staleCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    staleCheckpoint.unresolvedLocalDenials = [sample[1]!.id];
    writeFileSync(checkpointPath, JSON.stringify(staleCheckpoint));
    const recoveredCalls = calls.length;
    assert.equal(await run({ output: deniedOutput, resume: true, maxUsd: "0.000001" }), 0);
    const crashResumed = JSON.parse(readFileSync(join(deniedOutput, "summary.json"), "utf8"));
    assert.equal(crashResumed.measurementValid, true, "saved successful retry clears a stale checkpoint denial before choosing pending work");
    assert.equal(crashResumed.untestedRows, 0);
    assert.deepEqual(crashResumed.unresolvedLocalDenials, []);
    assert.equal(calls.length, recoveredCalls, "a checkpoint crash cannot pay for an already retained answer again");
    assert.equal(crashResumed.chargedUsd, recovered.chargedUsd, "crash recovery retains all charges, including the earlier denial");
  } finally { server.close(); resetTurnGrantsForTests(); rmSync(directory, { recursive: true, force: true }); }
  console.log("visual-need audit CLI: stable trace, configured deployment, metered answers, denied-row and legacy resumes pass");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
