/**
 * Offline gate for the lab's `--reference-picture` step: live parity of the
 * start, wait and abandon rules, the per-request reservation against the
 * route's own ceilings, settlement, the runner wiring and a mocked end to end
 * lab turn. Zero network or model calls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REFERENCE_PICTURE_PLAN_VERSION, type ReferencePictureRecord } from "@heytutor/drawing";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { actualLlmCost } from "../../lib/billing/paidUsage";
import { resolvePictureJudgeModel } from "../../lib/reference-picture/pictureJudge";
import { resolvePictureQueryModel } from "../../lib/reference-picture/pictureQuery";
import {
  budgetedReferencePictureFetch,
  LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD,
  LAB_REFERENCE_PICTURE_GENERATION_RESERVATION_USD,
  LAB_REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS,
  LAB_REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS,
  LabReferencePictureStep,
  labReferencePictureReservationUsd,
  referencePictureTextOnlyAction,
  startsReferencePictureEarly,
  summarizeReferencePictures,
  type ReferencePictureCallAccounting,
} from "../lecture-lab/labReferencePicture";
import type { LabUsageObservation } from "../lecture-lab/labSpend";
import { runLecture } from "../lecture-lab/lecturePipeline";
import { parseOptions, referencePictureTranscript } from "../lecture-lab/run";

const appRoot = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(appRoot, path), "utf8");
const failures: string[] = [];
async function check(name: string, verify: () => void | Promise<void>): Promise<void> {
  try {
    await verify();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberIn(source: string, pattern: RegExp, what: string): number {
  const match = source.match(pattern);
  assert(match, `${what} not found; update the lab copy and this gate together`);
  return Number(match[1]!.replace(/_/g, ""));
}

const ORIGIN = "http://lab.test";
const ID = "rp_0123456789abcdef01234567";
const RECORD: ReferencePictureRecord = {
  id: ID, source: "wikimedia", title: "File:Heart diagram-en.svg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Heart_diagram-en.svg",
  license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", artist: "Wapcaplet",
  imageUrl: `/api/reference-picture/${ID}/image`, planUrl: `/api/reference-picture/${ID}/plan`,
  width: 1200, height: 900, shows: "A labelled diagram of the human heart showing its four chambers.",
  labels: ["Right atrium", "Left ventricle", "Aorta"],
  plan: { width: 600, height: 450, outlineLengthPx: 4_000, fillLengthPx: 9_000 },
};
const PLAN = {
  version: REFERENCE_PICTURE_PLAN_VERSION, width: 600, height: 450, paper: "#ffffff",
  inkMask: "data:image/png;base64,iVBORw0KGgo=",
  outline: { brushPx: 6, strokes: [[0, 0, 10, 10]], lengthPx: 14 },
  fill: { brushPx: 20, strokes: [[0, 0, 20, 0]], lengthPx: 20 },
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** A dev server double: the picture route, its assets, and (optionally) a hanging route. */
function fakeServer(options: { route?: "ready" | "declined" | "hang"; image?: "ok" | "missing"; seen?: string[] } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    options.seen?.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/reference-picture") {
      assert.equal(url.origin, ORIGIN, "the picture request is pinned to the lab origin");
      assert(new Headers(init?.headers).get("x-heytutor-trace-id"), "the route needs the turn's trace id");
      if (options.route === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (options.route === "declined") return Response.json({ status: "declined", reason: "no_candidate" });
      return Response.json({ status: "ready", picture: { ...RECORD, legend: [{ mark: "1", label: "Aorta" }] }, cached: false,
        steps: ["search round 1: File:Heart diagram-en.svg", "judge File:Heart diagram-en.svg: accept"] });
    }
    if (url.pathname.endsWith("/image")) {
      return options.image === "missing" ? Response.json({ error: "not_found" }, { status: 404 })
        : new Response(PNG, { headers: { "content-type": "image/png" } });
    }
    if (url.pathname.endsWith("/plan")) return Response.json(PLAN);
    throw new Error(`unexpected request ${url.pathname}`);
  }) as typeof fetch;
}

const step = (fetchImpl: typeof fetch, waitMs?: number, clientTimeoutMs?: number) =>
  new LabReferencePictureStep({ origin: ORIGIN, question: "Explain the structure of the human heart.", traceId: "trace-1",
    turnStartedAt: Date.now(), fetchImpl, waitMs, ...(clientTimeoutMs !== undefined ? { clientTimeoutMs } : {}) });

async function main(): Promise<void> {
  await check("lab copies of the live wait and preload bounds match their sources", () => {
    assert.equal(LAB_REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS, numberIn(read("features/tutor-session/hooks/turn/useQuestionHandler.ts"),
      /export const REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS = ([\d_]+);/, "REFERENCE_PICTURE_TEXT_ONLY_WAIT_MS"));
    assert.equal(LAB_REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS, numberIn(read("features/tutor-session/lib/scene/referencePicturePreload.ts"),
      /export const REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS = ([\d_]+);/, "REFERENCE_PICTURE_PRELOAD_TIMEOUT_MS"));
  });

  await check("the live hook still starts, waits and abandons the way the lab replays it", () => {
    const hook = read("features/tutor-session/hooks/turn/useQuestionHandler.ts");
    for (const line of [
      'if (!earlyChemistryLane && turnPlan.visualRequirement !== "none") {\n            startReferencePicture(true);',
      '// The text only point:',
      'if (!referencePicturePending) startReferencePicture(false);',
      'abandonReferencePicture("solver_contradiction");',
      'if (diagramSource !== "none") {\n        abandonReferencePicture("verified_figure");',
      'turnPlan && turnPlan.visualRequirement !== "none"',
      'abandonReferencePicture("not_waited");',
      'resolve({ status: "unavailable", reason: "wait_deadline" })',
      'failure = { status: "unavailable", reason: "preload_failed" }',
      '} else if (answer.status === "unavailable" && answer.reason === "wait_deadline") {',
      'diagramPromptAddon: activeDiagram?.promptAddon ?? null,',
    ]) assert(hook.includes(line), `live hook changed: ${line.split("\n")[0]}`);
    assert(startsReferencePictureEarly({ chemistryLane: false, visualRequirement: "required" }), "every subject starts early");
    assert(startsReferencePictureEarly({ chemistryLane: false, visualRequirement: "optional" }));
    assert(!startsReferencePictureEarly({ chemistryLane: true, visualRequirement: "required" }), "the chemistry lane draws deterministically");
    assert(!startsReferencePictureEarly({ chemistryLane: false, visualRequirement: "none" }));
    assert.deepEqual(referencePictureTextOnlyAction({ solverContradiction: true, figureDrawn: false, visualRequirement: "required" }),
      { action: "abandon", reason: "solver_contradiction" });
    assert.deepEqual(referencePictureTextOnlyAction({ solverContradiction: false, figureDrawn: true, visualRequirement: "required" }),
      { action: "abandon", reason: "verified_figure" });
    assert.deepEqual(referencePictureTextOnlyAction({ solverContradiction: false, figureDrawn: false, visualRequirement: "optional" }), { action: "wait" });
    assert.deepEqual(referencePictureTextOnlyAction({ solverContradiction: false, figureDrawn: false, visualRequirement: "none" }),
      { action: "abandon", reason: "not_waited" });
  });

  await check("the per request reservation covers the route's two judge rounds at its own ceilings", () => {
    const route = read("app/api/reference-picture/route.ts");
    const find = read("lib/reference-picture/findReferencePicture.ts");
    const query = actualLlmCost({ input: numberIn(route, /query: actualLlmCost\(\{ input: (\d+),/, "query input ceiling"),
      output: numberIn(route, /query: actualLlmCost\(\{ input: \d+, output: (\d+) \}/, "query output ceiling") }, resolvePictureQueryModel()) ?? 0.01;
    const judge = actualLlmCost({ input: numberIn(route, /judge: actualLlmCost\(\{ input: (\d+),/, "judge input ceiling"),
      output: numberIn(route, /judge: actualLlmCost\(\{ input: \d+, output: (\d+) \}/, "judge output ceiling") }, resolvePictureJudgeModel()) ?? 0.15;
    const perCandidate = numberIn(find, /export const CALLS_PER_CANDIDATE = (\d+);/, "CALLS_PER_CANDIDATE");
    const judged = numberIn(find, /export const JUDGED_CANDIDATES = (\d+);/, "JUDGED_CANDIDATES") *
      numberIn(find, /export const JUDGE_ROUNDS = (\d+);/, "JUDGE_ROUNDS") * perCandidate;
    const generated = numberIn(route, /const GENERATED_IMAGE_USD = ([\d.]+);/, "GENERATED_IMAGE_USD");
    assert(LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD + 1e-9 >= query + judged * judge,
      `reservation $${LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD} is below the route's $${(query + judged * judge).toFixed(4)}`);
    assert(LAB_REFERENCE_PICTURE_GENERATION_RESERVATION_USD + 1e-9 >= generated + perCandidate * judge, "a generated picture adds an image, a judge and a fact check");
    assert.equal(labReferencePictureReservationUsd({} as NodeJS.ProcessEnv), LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD);
    assert.equal(labReferencePictureReservationUsd({ REFERENCE_PICTURE_IMAGE_URL: "https://images.test", REFERENCE_PICTURE_IMAGE_KEY: "k",
      REFERENCE_PICTURE_IMAGE_MODEL: "m" } as unknown as NodeJS.ProcessEnv), LAB_REFERENCE_PICTURE_BASE_RESERVATION_USD + LAB_REFERENCE_PICTURE_GENERATION_RESERVATION_USD);
  });

  type Settled = { reserved: number; charged: number; observation: LabUsageObservation };
  async function settleOnce(respond: () => Promise<Response>, spendMode: "conservative" | "response_usage" = "conservative") {
    const settled: Settled[] = [];
    const accounting: ReferencePictureCallAccounting[] = [];
    let dispatched = 0;
    let error: unknown = null;
    try {
      await budgetedReferencePictureFetch(`${ORIGIN}/api/reference-picture`, { method: "POST", body: "{}" },
        (async () => { dispatched += 1; return respond(); }) as typeof fetch, {
          reserve: () => true, spendMode, reservationUsd: 0.29, traceId: "t", beforeDispatch: () => {},
          settle: (reserved, charged, observation) => settled.push({ reserved, charged, observation }),
          onAccounting: (call) => accounting.push(call), onDenied: () => {},
        });
    } catch (caught) { error = caught; }
    assert.equal(dispatched, 1);
    assert.equal(settled.length, 1, "every dispatched request settles exactly once");
    return { settled: settled[0]!, accounting: accounting[0]!, error };
  }

  await check("settlement: unknown usage consumes the ceiling, only pre-reservation refusals are zero", async () => {
    const ready = await settleOnce(async () => Response.json({ status: "ready", picture: RECORD }));
    assert.equal(ready.settled.charged, 0.29);
    assert.equal(ready.settled.observation.measuredUsd, null, "the route returns no usage: unknown, never measured zero");
    assert.equal(ready.settled.observation.unresolvedAttempts, 1);
    const declined = await settleOnce(async () => Response.json({ status: "declined", reason: "no_candidate" }));
    assert.equal(declined.settled.charged, 0.29, "a decline after judging still paid the judges");
    const missingKey = await settleOnce(async () => Response.json({ status: "declined", reason: "missing_key" }));
    assert.equal(missingKey.settled.charged, 0);
    assert.equal(missingKey.accounting.provedNoDispatch, true);
    const disabled = await settleOnce(async () => Response.json({ error: "disabled" }, { status: 404 }));
    assert.equal(disabled.settled.charged, 0);
    assert.equal(disabled.accounting.httpStatus, 404);
    const crashed = await settleOnce(async () => new Response("boom", { status: 500 }));
    assert.equal(crashed.settled.charged, 0.29, "a 5xx can come after dispatch");
    const dropped = await settleOnce(async () => { throw new TypeError("fetch failed"); });
    assert.equal(dropped.settled.charged, 0.29);
    assert(dropped.error instanceof TypeError, "transport errors still reach the client, which teaches as text");
    const metered = await settleOnce(async () => Response.json({ status: "ready", picture: RECORD }), "response_usage");
    assert.equal(metered.settled.charged, 0, "response_usage never books unknown usage as measured");
    assert.equal(metered.settled.observation.unresolvedAllowanceUsd, 0.29);
  });

  await check("a denied reservation never dispatches and marks the row untested", async () => {
    let dispatched = 0;
    let denied = 0;
    await assert.rejects(budgetedReferencePictureFetch(`${ORIGIN}/api/reference-picture`, { method: "POST", body: "{}" },
      (async () => { dispatched += 1; return Response.json({}); }) as typeof fetch, {
        reserve: () => false, spendMode: "conservative", beforeDispatch: () => {}, settle: () => {}, onAccounting: () => {},
        onDenied: () => { denied += 1; },
      }), /max-usd/);
    assert.equal(dispatched, 0);
    assert.equal(denied, 1);
  });

  await check("speculative start, then shown at the text only point with the picture's prompt addon and PNG", async () => {
    const seen: string[] = [];
    const picture = step(fakeServer({ seen }));
    picture.start("other", true);
    const presentation = await picture.atTextOnlyPoint("other");
    assert(presentation, "a ready, preloaded picture is shown");
    assert(presentation.diagram.promptAddon.length > 0 && presentation.diagram.promptAddon.includes("Right atrium"),
      "the teaching prompt gets the judge's labels, not the text only addon");
    const { record, image } = await picture.finish();
    assert.equal(record.status, "shown");
    assert.equal(record.speculative, true);
    assert.equal(record.pictureId, ID);
    assert.deepEqual(record.labels, RECORD.labels);
    assert.equal(record.answer?.cached, false);
    assert.deepEqual(record.steps, ["search round 1: File:Heart diagram-en.svg", "judge File:Heart diagram-en.svg: accept"], "the judge trail is kept");
    assert.deepEqual(record.legend, [{ mark: "1", label: "Aorta" }], "a numbered picture's key is kept");
    assert(record.requestMs !== null && record.waitMs >= 0);
    assert.deepEqual(image?.bytes, PNG);
    assert.deepEqual(seen.sort(), ["GET /api/reference-picture/" + ID + "/image", "GET /api/reference-picture/" + ID + "/plan", "POST /api/reference-picture"].sort());
  });

  await check("the bounded wait ends a slow route as wait_deadline but lets it finish (only the client timeout ends it)", async () => {
    // AbortSignal.timeout does not hold the event loop open; without this the
    // process would exit mid check with code 0 and the gate would pass silently.
    const hold = setInterval(() => {}, 25);
    try {
      const picture = step(fakeServer({ route: "hang" }), 30, 120);
      assert.equal(await picture.atTextOnlyPoint("physics"), null);
      const { record, image } = await picture.finish();
      assert.equal(record.status, "unavailable");
      assert.equal(record.reason, "wait_deadline");
      assert.equal(record.speculative, false);
      assert.notEqual(record.answer?.reason, "aborted", "a deadline does not abort the request, as live does not");
      assert.equal(image, null);
    } finally {
      clearInterval(hold);
    }
  });

  await check("a verified figure abandons the early request; unloadable pixels are text", async () => {
    const abandoned = step(fakeServer({ route: "hang" }));
    abandoned.start("other", true);
    abandoned.abandon("verified_figure");
    const { record } = await abandoned.finish();
    assert.equal(record.status, "skipped");
    assert.equal(record.reason, "verified_figure");
    assert.equal(record.attempted, true);
    const unloaded = step(fakeServer({ image: "missing" }));
    assert.equal(await unloaded.atTextOnlyPoint("chemistry"), null);
    const unloadedRecord = (await unloaded.finish()).record;
    assert.equal(unloadedRecord.status, "unavailable");
    assert.equal(unloadedRecord.reason, "preload_failed");
    const never = step(fakeServer());
    never.abandon("verified_figure");
    assert.equal((await never.finish()).record.status, "not_attempted");
    const dsa = step(fakeServer());
    dsa.exclude("dsa");
    dsa.start("other", true);
    assert.equal(await dsa.atTextOnlyPoint("other"), null);
    assert.equal((await dsa.finish()).record.reason, "dsa");
  });

  await check("options: off by default, a boolean flag, and --ask may run production's strict subjects", () => {
    assert.equal(parseOptions(["--max-usd", "1"]).referencePicture, false);
    const on = parseOptions(["--reference-picture", "--ask", "questions.txt", "--max-usd", "1"]);
    assert.equal(on.referencePicture, true);
    assert.equal(on.ask, "questions.txt", "the flag does not eat the next argument");
    assert.deepEqual(parseOptions(["--ask", "q.txt", "--arm", "planner_examples_strict", "--production-strict-subjects", "maths,physics",
      "--max-usd", "1"]).productionStrictSubjects, ["maths", "physics"]);
    assert.throws(() => parseOptions(["--ask", "q.txt", "--production-strict-subjects", "maths", "--max-usd", "1"]), /strict maths evaluation/);
  });

  await check("the runner budgets the picture route before the chat decision can pass it through", () => {
    const runner = read("scripts/lecture-lab/run.ts");
    const branch = runner.indexOf("if (url === `${options.origin}/api/reference-picture`) {");
    const decision = runner.indexOf("const budget = labRequestBudgetDecision(");
    assert(branch > 0 && decision > branch, "the picture branch precedes the chat budget decision");
    assert(runner.slice(branch, decision).includes("return budgetedReferencePictureFetch("), "the branch returns the budgeted fetch");
    assert(!runner.slice(branch, decision).includes("options.referencePicture &&"), "the route is budgeted whatever the flag says");
    assert.equal((runner.match(/reserveLabRequest\(/g) ?? []).length, 2, "main keeps one reserveLabRequest boundary (plus its definition)");
  });

  await check("summary and transcript report the picture, and stay absent without the flag", () => {
    assert.equal(summarizeReferencePictures([{ diagram: { committed: true } }]), null);
    const base = { attempted: true, speculative: false, subject: "physics" as const, startedAtMs: 40_000, ms: 9_000, answer: null,
      pictureId: null, title: null, source: null, license: null, artist: null, pageUrl: null, shows: null, labels: [], image: null };
    const summary = summarizeReferencePictures([
      { diagram: { committed: false }, referencePicture: { ...base, status: "shown", reason: null, requestMs: 9_000, waitMs: 4_000 } },
      { diagram: { committed: false }, referencePicture: { ...base, status: "declined", reason: "no_candidate", requestMs: 12_000, waitMs: 12_000 } },
      { diagram: { committed: true }, referencePicture: { ...base, attempted: false, status: "not_attempted", reason: "verified_figure",
        requestMs: null, waitMs: 0, startedAtMs: null, ms: null } },
    ]);
    assert(summary);
    assert.equal(summary.engineFailures, 2);
    assert.equal(summary.shownOnEngineFailures, 1);
    assert.equal(summary.verifiedFigures, 1);
    assert.equal(summary.waitMs.max, 12_000);
    const lines = referencePictureTranscript({ timings: { planMs: 30_000, teachMs: 0, totalMs: 70_000, firstTeachingTokenMs: 48_000,
      stages: { turnPlanMs: 9_000, problemIrMs: 0, deterministicFigureMs: 0, scenePlannerMs: 21_000, revalidateMs: 0, speculative: false,
        restarted: false, speculationAbort: null } } } as never, { ...base, status: "shown", reason: null, requestMs: 9_000, waitMs: 4_000 });
    assert(lines.some((line) => line.startsWith("status shown")));
    const trail = referencePictureTranscript({ timings: { planMs: 0, teachMs: 0, totalMs: 0 } } as never,
      { ...base, status: "declined", reason: "no_candidate", requestMs: 1, waitMs: 1, steps: ["judge File:X.svg: reject, numbers only"] });
    assert(trail.includes("### Search and judge trail") && trail.includes("- judge File:X.svg: reject, numbers only"));
    assert(lines.some((line) => line.includes("picture wait 4s") && line.includes("first teaching token 48s") && line.includes("scene planning 21s")));
  });

  for (const subject of ["other", "physics"] as const) await check(`a mocked ${subject} lab turn asks early and shows the picture while the engine stays text only`, async () => {
    const question = "Explain the structure of the human heart.";
    const plan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
    const server = fakeServer();
    const nativeFetch = globalThis.fetch;
    const order: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/api/chat") {
        order.push(new Headers(init?.headers).get("x-turn-planner-version") === "3" ? "turn_plan" : "chat");
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ...plan, subject }) } }] });
      }
      if (url.pathname === "/api/reference-picture") order.push("picture");
      return server(input, init);
    }) as typeof fetch;
    try {
      let intro = 0;
      let saved: Uint8Array | null = null;
      const run = await runLecture(question, {
        origin: ORIGIN, cookie: "", figureOnly: true, scenePlannerDeadlineMs: 2_000, referencePicture: true,
        productionStrictSubjects: ["maths", "physics"], arm: "planner_examples_strict",
        visualNeedReplay: { decision: "required", source: "jev", unavailableReason: null, usage: null, provenance: null },
        onPresentation: (presentation) => { intro = presentation.intro.length; },
        onReferencePictureImage: (image) => { saved = image.bytes; },
      });
      assert.equal(run.error, null, run.error ?? "");
      assert.equal(run.productionStrategy?.classifiedSubject, subject, "the picture request carries the planner's subject");
      assert.equal(run.referencePicture?.subject, subject);
      assert.equal(run.referencePicture?.status, "shown");
      assert.equal(run.referencePicture?.speculative, true);
      assert(order.indexOf("picture") > order.indexOf("turn_plan"), "asked after the turn plan, beside scene planning");
      assert.equal(run.diagram.committed, false, "engine metrics still read the turn as text only");
      assert.equal(run.diagram.figureSource, "text_only");
      assert.equal(intro, 3, "outline, fill and the numbered key's beat introduce it");
      assert.deepEqual(saved, PNG);
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });

  if (failures.length > 0) {
    console.error(`lab reference picture: ${failures.length} failure(s)`);
    process.exitCode = 1;
  } else {
    console.log("lab reference picture: live parity, reservation, settlement, wiring and a mocked turn pass (zero network or model calls)");
  }
}

// A main that never settles (a hung check) must fail, not exit 0 when the event loop drains.
let settled = false;
process.on("exit", (code) => {
  if (!settled && code === 0) { console.error("lab reference picture: exited before every check ran"); process.exitCode = 1; }
});
void main().then(() => { settled = true; }, (error) => { settled = true; console.error(error); process.exitCode = 1; });
