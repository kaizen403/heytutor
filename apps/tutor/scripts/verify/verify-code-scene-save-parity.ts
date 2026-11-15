import assert from "node:assert/strict";
import {
  createFallbackTurnPlanV3,
  getMockCodeLessonPlan,
} from "@heytutor/tutor-core";
import { getSegmentCommands, type TutorSegment } from "@heytutor/drawing";
import { scenario } from "./verify-startup-turn";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { storedCodeLessonPlan } from "../../lib/code-lesson/persistedCodeLesson";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import {
  DsaFrameController,
  restoreDsaFrames,
} from "../../features/tutor-session/lib/code-lesson/dsaFrames";

async function main() {
  for (const long of [true, false]) {
    const question =
      "Explain binary search in Python. " +
      (long ? "Discuss the algorithm carefully. ".repeat(140) : "");
    const plan = getMockCodeLessonPlan(question);
    const response = plan.sections
      .flatMap((section) =>
        section.blocks.map(
          (block) =>
            `[STEP]This block maintains the search interval.[TYPE:${block.id}][/STEP]`,
        ),
      )
      .join("\n");
    const live = await scenario("ready", false, false, {
      plan: createFallbackTurnPlanV3(question),
      recordedCodeLesson: { plan, response },
    });
    assert("recordedCodeEvents" in live && live.recordedCodeEvents);
    const intros = live.recordedCodeEvents.filter(
      (event) => event.name === "enqueue-intro",
    );
    assert.equal(
      intros.some((event) => (event.data as TutorSegment[]).length > 0),
      !long,
      "live code lesson draws exactly the scene save accepts",
    );
    const typed = live.recordedCodeEvents
      .flatMap((event) =>
        event.name === "enqueue"
          ? getSegmentCommands(event.data as TutorSegment)
          : [],
      )
      .filter((command) => command.type === "TYPE");
    assert(
      typed.length > 0,
      "a genuine long programming question keeps its code lesson",
    );
    assert(live.recordedCodeScene && live.recordedCodeRows);
    const saved = await canonicalizeTurnSceneMetadata({
      ...live.recordedCodeScene,
      question,
      segments: live.recordedCodeRows.map((row, orderIndex) => ({
        ...row,
        orderIndex,
        durationMs: row.durationMs ?? undefined,
      })),
    });
    assert(saved.ok, saved.ok ? "" : saved.error);
    assert.equal(
      saved.value.visualStatus,
      live.recordedCodeScene.visualStatus,
      "live/save statuses agree",
    );
    assert.equal(
      saved.value.sceneArtifacts?.figureSource,
      long ? "text_only" : "dsa_trace",
    );
    assert(
      storedCodeLessonPlan(saved.value.sceneArtifacts, question),
      "saved programming source restores its code plan",
    );
    assert.equal(
      Boolean(restoreVerifiedDiagramFromTurn({ ...saved.value, question })),
      !long,
      "reopened diagram authority agrees with live/save",
    );
    const restored = { frames: new DsaFrameController() };
    restoreDsaFrames(restored, { ...saved.value, question }, plan);
    assert.equal(
      restored.frames.total() > 0,
      !long,
      "a code plan alone cannot restore walk-through geometry after save removed the scene",
    );
    for (const sceneDocument of [
      null,
      { schemaVersion: "scene-document/v2", source: { question } },
    ]) {
      restoreDsaFrames(
        restored,
        { question, visualStatus: "validated", sceneDocument },
        plan,
      );
      assert.equal(
        restored.frames.total(),
        0,
        "an absent or invalid saved document cannot grant frame authority",
      );
    }
  }
  console.log("code scene live/save parity verification passed");
}
void main();
