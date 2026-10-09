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
      "--out", output, "--max-usd", "0.02", "--yes", "--origin", `http://127.0.0.1:${address.port}`, "--concurrency", "4"];
    const run = (resume = false) => new Promise<number | null>((done) => {
      const child = spawn(process.execPath, [...args, ...(resume ? ["--resume"] : [])], { cwd: resolve(import.meta.dirname, "../.."),
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
    assert.equal(await run(true), 0);
    assert.equal(calls.length, 7, "resume skips completed answers and retains their charge");
  } finally { server.close(); resetTurnGrantsForTests(); rmSync(directory, { recursive: true, force: true }); }
  console.log("visual-need audit CLI: seven synthetic rows, stable trace, metered answers and free resume pass");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
