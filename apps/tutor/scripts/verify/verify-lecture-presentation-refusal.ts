/**
 * Executes the actual lecture caller with real scene selection, validation and
 * presentation. Only HTTP and the presentation-error boundary are controlled.
 * This proves caller containment, NOT acceptance by the pending F2 producer,
 * persistence, or a paid model. --baseline-head runs the pre-bridge caller from
 * HEAD as a read-only regression control while this change is uncommitted.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type { RunLectureOptions } from "../lecture-lab/lecturePipeline";
import { NeutralPanelPresentationDeclined } from "./fixtures/frozen-neutral-panel-decline";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const relative = "scripts/lecture-lab/lecturePipeline.ts";
const filename = path.join(app, relative);
const source = process.argv.includes("--baseline-head")
  ? execFileSync("git", ["show", `HEAD:apps/tutor/${relative}`], { cwd: app, encoding: "utf8" })
  : readFileSync(filename, "utf8");
const QUESTION = "Derive the formula for the range of a projectile on level ground.";
const RAW = `  ${QUESTION}\u200B  `;
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: QUESTION, givens: [],
  unknowns: [{ id: "range", symbol: "R" }], derived: [],
  qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"], visualRequirement: "required",
};
type Presentation = Parameters<NonNullable<RunLectureOptions["onPresentation"]>>[0];
type Mode = "valid" | "typed_refusal" | "unrelated_error";
const typedError = new NeutralPanelPresentationDeclined([
  { code: "gate_source_mismatch", severity: "fatal", message: "Synthetic producer-boundary refusal control" },
]);

async function run(mode: Mode, figureOnly = false) {
  const presentationSources: unknown[] = [];
  const outputs: Presentation[] = [];
  const teachingBodies: string[] = [];
  let plannerRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(url, "http://offline.invalid/api/chat", "Unexpected network transport is forbidden");
    if (headers.get("x-turn-planner-version") === "3") {
      plannerRequests += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] });
    }
    assert.equal(headers.get("x-scene-planner-version"), null,
      "This real deterministic scene fixture must not silently replace scene planning with teaching");
    assert.equal(headers.get("x-heytutor-teaching-pass"), "planned", "Only the teaching transport may reach this response");
    teachingBodies.push(String(init?.body ?? ""));
    const content = Array.from({ length: 8 }, (_, index) =>
      `[STEP]Use the motion relation.[WRITE:x = u t,80,${150 + 40 * index}][/STEP]`).join("");
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } });
  };
  try {
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loadedModule = { exports: {} as Record<string, unknown> };
    const localRequire = (specifier: string) => {
      if (specifier === "@/features/tutor-session/lib/scene/verifiedScenePresentation") return {
        ...requireApp(path.join(app, "features/tutor-session/lib/scene/verifiedScenePresentation.ts")),
        buildVerifiedDiagramPresentation(...args: Parameters<typeof buildVerifiedDiagramPresentation>) {
          presentationSources.push(args[2]?.originalQuestion);
          if (mode === "typed_refusal") throw typedError;
          if (mode === "unrelated_error") throw new Error("Unrelated presentation failure control");
          return buildVerifiedDiagramPresentation(...args);
        },
      };
      return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : specifier);
    };
    new Function("require", "module", "exports", compiled)(localRequire, loadedModule, loadedModule.exports);
    const runLecture = loadedModule.exports.runLecture as typeof import("../lecture-lab/lecturePipeline").runLecture;
    const result = await runLecture(RAW, {
      origin: "http://offline.invalid", cookie: "", arm: "current", figureOnly, fastMode: true,
      visualNeedReplay: { decision: null, source: "unavailable", unavailableReason: "offline_gate", usage: null, provenance: null },
      onPresentation: (presentation) => { outputs.push(presentation); },
    });
    assert.ok(plannerRequests > 0, "Actual turn planner transport must execute");
    assert.equal(presentationSources.length, 1, "Actual real scene selection must reach the presentation boundary once");
    return { result, presentationSources, outputs, teachingBodies };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const results: Array<{ name: string; passed: boolean; error?: string }> = [];
async function test(name: string, check: () => Promise<void>) {
  try { await check(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

async function main() {
await test("real valid presentation carries original source and teaches", async () => {
  const f = await run("valid");
  assert.deepEqual(f.presentationSources, [RAW]);
  assert.equal(f.result.error, null);
  assert.equal(f.result.diagram.committed, true);
  assert.ok(f.result.diagram.svg?.includes("<svg"));
  assert.equal(f.outputs.length, 1);
  assert.ok(f.outputs[0].diagram);
  assert.ok(f.outputs[0].intro.length > 0);
  assert.ok(f.teachingBodies.length > 0);
  assert.ok(f.result.teaching.steps.length > 0);
});

await test("typed presentation refusal retains raw source and teaches text-only", async () => {
  const f = await run("typed_refusal");
  assert.equal(f.result.error, null);
  assert.deepEqual(f.presentationSources, [RAW]);
  assert.equal(f.result.diagram.committed, false);
  assert.equal(f.result.diagram.figureSource, "text_only");
  assert.equal(f.result.diagram.emptyCause, "presentation_refused");
  assert.equal(f.result.diagram.reason, "source_scoped_presentation_refused");
  assert.equal(f.result.diagram.tier, null);
  assert.equal(f.result.diagram.family, null);
  assert.equal(f.result.diagram.svg, null);
  assert.equal(f.result.timings.figureCommitMs, null);
  assert.deepEqual(f.result.diagram.focusableIds, []);
  assert.deepEqual(f.result.diagram.entityIds, []);
  assert.deepEqual(f.result.diagram.labelByEntity, {});
  assert.equal(f.outputs.length, 1);
  assert.equal(f.outputs[0].diagram, null);
  assert.deepEqual(f.outputs[0].intro, []);
  assert.ok(f.teachingBodies.length > 0);
  assert.ok(f.result.teaching.steps.length > 0);
});

await test("unrelated presentation error remains fatal and does not teach", async () => {
  const f = await run("unrelated_error");
  assert.deepEqual(f.presentationSources, [RAW]);
  assert.match(f.result.error ?? "", /Unrelated presentation failure control/);
  assert.equal(f.result.diagram.committed, false);
  assert.equal(f.result.diagram.svg, null);
  assert.deepEqual(f.teachingBodies, []);
  assert.deepEqual(f.outputs, []);
  assert.deepEqual(f.result.teaching.steps, []);
});

await test("figure-only typed refusal emits no diagram or intro and never teaches", async () => {
  const f = await run("typed_refusal", true);
  assert.equal(f.result.error, null);
  assert.deepEqual(f.presentationSources, [RAW]);
  assert.equal(f.result.diagram.emptyCause, "presentation_refused");
  assert.equal(f.result.diagram.svg, null);
  assert.deepEqual(f.teachingBodies, []);
  assert.deepEqual(f.outputs, [{ diagram: null, opening: null, givens: [], intro: [] }]);
});

console.log(JSON.stringify({
  scope: "actual lecture caller containment; not real F2 producer or save acceptance",
  baselineHead: process.argv.includes("--baseline-head"), paidCalls: 0,
  passed: results.filter((result) => result.passed).length, total: results.length, results,
}, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
}
void main();
