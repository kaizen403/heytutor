import assert from "node:assert/strict";
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
  // Synthetic server record; no private question, identity, stored id or image.
  const record = parseReferencePictureRecord({
    ...pictureFixtures.cases[0]!.record,
    labels: ["Uterus", "Ovary"],
    shows: "A labelled view of the uterus and ovaries.",
    title: "Synthetic anatomy test record",
    parts: undefined,
  });
  assert(record);
  for (const ready of [false, true]) {
    const live = await scenario("ready", false, false, {
      plan,
      referencePictureTurn: {
        doubtTitle:
          "Doubt: Can you show me what the uterus and ovary look like?",
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
