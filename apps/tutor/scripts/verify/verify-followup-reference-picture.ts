import assert from "node:assert/strict";
import { failedTurnWhere } from "../../lib/admin/turnFilters";
import { matches } from "./turnFailurePredicateFixture";
import { readFileSync } from "node:fs";
import { referencePictureAllowedForTurn } from "../../features/tutor-session/lib/scene/referencePicturePolicy";
import { classifyTurnFailure } from "../../lib/obs/turnFailureClassification";
import {
  parseReferencePictureRecord,
  requestReferencePicture,
} from "../../features/tutor-session/lib/scene/referencePictureClient";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { readReferencePictureOutcome } from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
} from "@heytutor/drawing";
import {
  pageFigureAfter,
  lessonFigureReturnAfter,
} from "../../lib/boards/pageFigure";
import { restoreReferencePictureFromTurn } from "../../features/tutor-session/lib/scene/restoreReferencePicture";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { scenario } from "./verify-startup-turn";
import pictureFixtures from "./fixtures/reference-picture-part-focus-off.json";

async function main() {
  const emptyDoubt = {
    granted: true,
    doubt: true,
    resume: false,
    dsa: false,
    codeBoard: false,
    emptyZone: true,
    zoneOccupied: false,
  };
  assert(
    referencePictureAllowedForTurn(emptyDoubt),
    "an empty-zone anatomy follow-up must reach the judged-picture fallback",
  );
  for (const override of [
    { granted: false },
    { resume: true },
    { dsa: true },
    { codeBoard: true },
    { emptyZone: false },
    { zoneOccupied: true },
  ]) {
    assert(
      !referencePictureAllowedForTurn({ ...emptyDoubt, ...override }),
      JSON.stringify(override),
    );
  }
  const answer = await requestReferencePicture({
    question: "Can you show me what the uterus and ovary look like?",
    fetchImpl: async () =>
      Response.json({
        status: "declined",
        reason: "no_candidate_accepted",
        required: true,
      }),
  });
  assert.equal(answer.status, "declined");
  assert(
    "required" in answer && answer.required === true,
    "a declined explicit picture requirement must survive transport",
  );
  // Exercise the real reader, including stalled bodies that ignore fetch's
  // signal. Discovery must survive all error exits and release the reader.
  for (const fault of ["client_timeout", "abort", "read", "malformed", "oversize", "frames", "eof", "server_timeout", "pipeline_error"]) {
    let cancelled = false;
    let body: ReadableStream<Uint8Array>;
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const keepAlive = setTimeout(() => {}, 1_000);
    try {
      const result = await requestReferencePicture({
        question: "Show the organs", signal: controller.signal, timeoutMs: 20,
        onRequirement: () => { if (fault === "abort") controller.abort(); },
        fetchImpl: async (_url, init) => {
          assert.equal(new Headers(init?.headers).get("accept"), "application/x-ndjson");
          body = new ReadableStream({
            start(stream) {
              stream.enqueue(encoder.encode('{"type":"requirement","required":true}\n'));
              if (fault === "read") queueMicrotask(() => queueMicrotask(() => stream.error(new Error("reset"))));
              if (fault === "malformed") stream.enqueue(encoder.encode('not json\n'));
              if (fault === "oversize") stream.enqueue(new Uint8Array(128 * 1024));
              if (fault === "frames") stream.enqueue(encoder.encode('{"type":"requirement","required":false}\n'));
              if (fault === "eof") stream.close();
              if (fault === "server_timeout" || fault === "pipeline_error") {
                stream.enqueue(encoder.encode(JSON.stringify({ type: "result", status: "declined", reason: fault }) + "\n"));
              }
            },
            cancel() { cancelled = true; },
          });
          return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
        },
      });
      assert.equal(result.required, true, `${fault}: semantic requirement retained`);
      assert.equal(result.status, fault === "server_timeout" || fault === "pipeline_error" ? "declined" : "unavailable");
      assert.equal(result.reason, fault === "client_timeout" ? "deadline" : fault === "abort" ? "aborted" : fault === "server_timeout" || fault === "pipeline_error" ? fault : "transport");
      assert.equal(body!.locked, false, `${fault}: reader released`);
      if (fault !== "read" && fault !== "eof") assert(cancelled, `${fault}: body cancelled`);
    } finally { clearTimeout(keepAlive); }
  }
  let httpCancelled = false;
  const http = await requestReferencePicture({ question: "Explain the organs", fetchImpl: async () => new Response(new ReadableStream({ cancel() { httpCancelled = true; } }), { status: 503 }) });
  assert.deepEqual(http, { status: "unavailable", reason: "http_503" }, "HTTP failure before semantic discovery must not guess a requirement");
  assert(httpCancelled);
  const beforeDiscovery = new AbortController(); beforeDiscovery.abort();
  assert.deepEqual(await requestReferencePicture({ question: "Show the organs", signal: beforeDiscovery.signal,
    fetchImpl: async () => { throw new Error("aborted request cannot dispatch"); },
  }), { status: "unavailable", reason: "aborted" });
  const splitFrames = new TextEncoder().encode('{"type":"requirement","required":true}\n{"type":"result","status":"declined","reason":"no_candidate_accepted","required":false}\n');
  const split = await requestReferencePicture({ question: "Show the organs", fetchImpl: async () => new Response(new ReadableStream({
    start(stream) { for (const byte of splitFrames) stream.enqueue(new Uint8Array([byte])); stream.close(); },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8" } }) });
  assert.deepEqual(split, { status: "declined", reason: "no_candidate_accepted", required: true }, "split frames retain true even if final payload omits/disagrees with discovery");
  const segments = [
    {
      orderIndex: 0,
      narration: "The uterus has a muscular wall.",
      spokenText: "The uterus has a muscular wall.",
      command: null,
    },
  ];
  const outcome = {
    attempted: true,
    status: "declined",
    reason: "no_candidate_accepted",
    required: true,
    ms: 20,
    speculative: false,
  };
  const sceneArtifacts = {
    schemaVersion: "scene-artifacts/v3",
    turnPlan: null,
    boardContinuation: {
      schemaVersion: "board-continuation/v1",
      lessonQuestion: "Explain the menstrual cycle",
    },
    referencePictureOutcome: outcome,
  };
  const saved = await canonicalizeTurnSceneMetadata({
    question: "Doubt: show me the organs",
    visualStatus: "text_only",
    sceneArtifacts,
    segments,
  });
  assert(saved.ok);
  assert.equal(
    readReferencePictureOutcome(saved.value.sceneArtifacts)?.required,
    true,
  );
  assert.equal(
    classifyTurnFailure({ ...saved.value, status: "stopped" }).classification,
    "failed",
    "required anatomy visuals cannot be classified healthy by continuation alone",
  );
  assert.equal(
    classifyTurnFailure({
      status: "stopped",
      visualStatus: "text_only",
      sceneArtifacts: {
        ...sceneArtifacts,
        referencePictureOutcome: { ...outcome, required: false },
      },
      segments,
    }).classification,
    "healthy",
    "legitimate text-only follow-ups remain healthy",
  );
  assert.equal(
    classifyTurnFailure({
      status: "stopped",
      visualStatus: "text_only",
      sceneArtifacts: {
        ...sceneArtifacts,
        referencePictureOutcome: {
          ...outcome,
          status: "skipped",
          reason: "aborted",
        },
      },
      segments: [],
    }).classification,
    "healthy",
    "expected cancellation is not a missing-picture failure",
  );
  const handler = readFileSync(
    new URL(
      "../../features/tutor-session/hooks/turn/useQuestionHandler.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert(
    handler.includes("referencePictureAllowedForTurn({"),
    "live hook uses the tested admission policy",
  );
  const plan = createFallbackTurnPlanV3(
    "Explain the menstrual cycle and its parts with a diagram",
  );
  for (const control of [
    { progressRequired: true, finalDelayMs: 30_000, expected: "failed", reason: "wait_deadline" },
    { progressRequired: false, finalDelayMs: 30_000, expected: "healthy", reason: "wait_deadline" },
    { progressRequired: true, progressDelayMs: 30_000, finalDelayMs: 31_000, expected: "healthy", reason: "wait_deadline" },
    { progressRequired: true, asLesson: true, finalDelayMs: 30_000, expected: "failed", reason: "wait_deadline" },
    { progressRequired: true, finalDelayMs: 100, expected: "failed", reason: "no_candidate_accepted" },
    { progressRequired: true, finalDelayMs: 100, readError: true, expected: "failed", reason: "transport" },
    { progressRequired: true, finalDelayMs: 100, serverTimeout: true, expected: "failed", reason: "server_timeout" },
    { progressRequired: true, finalDelayMs: 30_000, stopAtMs: 100, expected: "healthy", reason: "wait_in_progress" },
    { progressRequired: true, finalDelayMs: 30_000, supersedeAtMs: 100, expected: "healthy", reason: "wait_in_progress" },
  ]) {
    const live = await scenario("ready", false, false, {
      plan: { ...plan, visualRequirement: "optional" },
      referencePictureTurn: {
        ...control,
        doubtTitle: "Doubt: Can you show me what the uterus and ovary look like?",
        response: { status: "declined", reason: control.serverTimeout ? "server_timeout" : "no_candidate_accepted" },
      },
    });
    assert("pictureScene" in live && live.pictureScene && live.pictureRows);
    const status = control.stopAtMs || control.supersedeAtMs ? "stopped" : "complete";
    // Doubts have no turn plan of their own. Continuation/optional inherited
    // plans must never excuse this turn's independently required picture.
    const artifacts = live.pictureScene.sceneArtifacts;
    if (!control.asLesson) assert.equal(typeof artifacts === "object" && artifacts !== null && "turnPlan" in artifacts ? artifacts.turnPlan : null, null);
    const saved = await canonicalizeTurnSceneMetadata({
      ...live.pictureScene, question: "Doubt: show me the organs",
      segments: live.pictureRows.map((row, orderIndex) => ({ ...row, orderIndex, durationMs: row.durationMs ?? undefined })),
    }, { kind: control.asLesson ? "lesson" : "doubt" });
    assert(saved.ok, saved.ok ? "" : saved.error);
    const reopened = JSON.parse(JSON.stringify(saved.value));
    const outcome = readReferencePictureOutcome(reopened.sceneArtifacts);
    assert.equal(outcome?.reason, control.reason);
    assert.equal(outcome?.required === true, control.progressRequired && !control.progressDelayMs);
    assert.equal(classifyTurnFailure({ ...reopened, status }).classification, control.expected);
    assert.equal(matches({ ...reopened, status }, failedTurnWhere()), control.expected === "failed", "saved/reopened outcome and admin SQL predicate agree");
    assert.equal(live.pictureEvents.filter(event => event.name === "reference-picture-request").length, 1);
    if (control.reason === "wait_deadline") {
      const teachingAt = live.pictureEvents.find(event => event.name === "teaching-request")!.atMs;
      const finalAt = live.pictureEvents.find(event => event.name === "reference-picture-final")!.atMs;
      assert(teachingAt < finalAt, "real request stays in flight past UI deadline and teaching");
    }
  }
  // Synthetic server record; no private question, identity, stored id or image.
  const record = parseReferencePictureRecord({
    ...pictureFixtures.cases[0]!.record,
    labels: ["Uterus", "Ovary"],
    shows: "A labelled view of the uterus and ovaries.",
    title: "Synthetic anatomy test record",
    parts: undefined,
  });
  assert(record);
  for (const variant of ["declined", "shown_json", "shown_progress"] as const) {
    const ready = variant !== "declined";
    const live = await scenario("ready", false, false, {
      plan,
      referencePictureTurn: {
        doubtTitle:
          "Doubt: Can you show me what the uterus and ovary look like?",
        ...(variant === "shown_progress" ? { progressRequired: true, finalDelayMs: 100 } : {}),
        response: ready
          ? { status: "ready", picture: record, required: true }
          : {
              status: "declined",
              reason: "no_candidate_accepted",
              required: true,
            },
      },
    });
    assert(
      "pictureEvents" in live &&
        live.pictureEvents &&
        live.pictureScene &&
        live.pictureRows,
    );
    assert.equal(
      live.pictureEvents.filter(
        (event) => event.name === "reference-picture-request",
      ).length,
      1,
      "actual follow-up sends one bounded request",
    );
    const saved = await canonicalizeTurnSceneMetadata(
      {
        ...live.pictureScene,
        question: "Doubt: Can you show me what the uterus and ovary look like?",
        segments: live.pictureRows.map((row, orderIndex) => ({
          ...row,
          orderIndex,
          durationMs: row.durationMs ?? undefined,
        })),
      },
      {
        kind: "doubt",
        loadReferencePicture: async (id) => (id === record.id ? record : null),
      },
    );
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert.equal(saved.value.visualStatus, "text_only");
    assert.equal(saved.value.sceneArtifacts?.figureSource, "text_only");
    assert.equal(
      classifyTurnFailure({ ...saved.value, status: "complete" })
        .classification,
      ready ? "picture_shown" : "failed",
    );
    const pictureCommands = saved.value.segments
      .flatMap((row) => parseStoredSegmentCommands(row.command))
      .filter((command) => command.type === "DRAW_PICTURE");
    assert.equal(
      pictureCommands.length,
      ready ? 2 : 0,
      "saved picture ink is rebuilt from the server record",
    );
    const reopened = {
      ...saved.value,
      kind: "doubt" as const,
      question: "Doubt: show me the organs",
      segments: saved.value.segments.map((row, orderIndex) => ({
        ...row,
        id: `synthetic-${orderIndex}`,
        audioUrl: null,
        durationMs: row.durationMs ?? null,
        timings: null,
        command: serializeSegmentCommands(
          parseStoredSegmentCommands(row.command),
          {
            trustedDiagramGeometry: isStoredCommandTrustedGeometry(row.command),
          },
        ),
      })),
    };
    assert.equal(
      restoreVerifiedDiagramFromTurn(reopened),
      null,
      "picture never restores as verified geometry",
    );
    assert.equal(Boolean(restoreReferencePictureFromTurn(reopened)), ready);
    if (ready) {
      const opener = {
        kind: "lesson" as const,
        sceneArtifacts: null,
        sceneDocument: null,
        visualStatus: "text_only" as const,
        segments: [],
      };
      assert.equal(
        pageFigureAfter([opener, reopened]).sourceIndex,
        1,
        "reopen reads this doubt's picture as the visible zone",
      );
      assert.equal(
        lessonFigureReturnAfter([opener, reopened])?.sourceIndex,
        null,
        "Continue returns the lesson's empty zone",
      );
    }
  }
  const privatePath = process.argv[2];
  if (privatePath) {
    const saved: {
      question: string;
      status: string;
      visualStatus: string;
      sceneArtifacts: unknown;
      segments: Array<{
        narration: string;
        spokenText: string;
        command: unknown;
      }>;
    } = JSON.parse(readFileSync(privatePath, "utf8"));
    assert.equal(classifyTurnFailure(saved).classification, "picture_shown");
    const reopened = {
      ...saved,
      sceneDocument: null,
      segments: saved.segments.map((row, orderIndex) => ({
        ...row,
        orderIndex,
        id: `private-${orderIndex}`,
        durationMs: null,
        timings: null,
        audioUrl: null,
        command: serializeSegmentCommands(
          parseStoredSegmentCommands(row.command),
          {
            trustedDiagramGeometry: isStoredCommandTrustedGeometry(row.command),
          },
        ),
      })),
    };
    assert(restoreReferencePictureFromTurn(reopened));
    assert.equal(restoreVerifiedDiagramFromTurn(reopened), null);
    console.log(
      "private stored cell replay passed: judged picture shown; no verified geometry authority",
    );
  }
  console.log("follow-up reference picture verification passed");
}
void main();
