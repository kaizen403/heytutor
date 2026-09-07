/**
 * Persistence trust boundary for DSA code lessons:
 * - the CodeLessonPlan rides sceneArtifacts.codeLesson and is re-validated
 *   server-side; a tampered plan rejects the save,
 * - TYPE segments persist only alongside a valid plan, with their text
 *   rebuilt from the plan (never trusted from the client),
 * - an unknown blockId is filtered like a stale FOCUS — narration survives,
 * - validated DSA scenes recompile into the DSA viewport so replayed intro
 *   ink stays clear of the code panel,
 * - the canonical artifacts round-trip through the restore-side reader,
 * - a restored turn rebuilds its worked-example frames, so replayed FRAME
 *   cues have something to advance.
 */
import { synthesizeDsaScene } from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
} from "@heytutor/drawing";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { DSA_DIAGRAM_ZONE } from "../../features/tutor-session/constants";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { storedCodeLessonPlan } from "../../lib/code-lesson/persistedCodeLesson";
import {
  DsaFrameController,
  resolveCodeLessonBoardContext,
  resolveDsaFrames,
  restoreDsaFrames,
} from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../lib/scene/turnScenePersistence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const question = "Explain binary search on a sorted array.";
  const plan = getMockCodeLessonPlan(question);
  const firstBlock = plan.sections[0]!.blocks[0]!;

  const typeSegment = (blockId: string, text: string, orderIndex: number) => ({
    orderIndex,
    narration: "Here is the next part of the algorithm.",
    spokenText: "Here is the next part of the algorithm.",
    command: {
      type: "TYPE",
      params: [],
      text,
      charPosition: 0,
      narrationBefore: "Here is the next part of the algorithm.",
      semanticRef: { entityId: blockId },
    },
  });

  const textOnlyMetadata: SubmittedTurnSceneMetadata = {
    question,
    visualStatus: "text_only",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: null,
      candidates: [],
      diagramResultStatus: "text_only",
      codeLesson: plan,
    },
    segments: [
      {
        orderIndex: 0,
        narration: "Binary search halves the range each step.",
        spokenText: "Binary search halves the range each step.",
        command: null,
      },
      typeSegment(firstBlock.id, firstBlock.code, 1),
    ],
  };

  const textOnly = await canonicalizeTurnSceneMetadata(clone(textOnlyMetadata));
  assert(textOnly.ok, `text-only code lesson should persist: ${textOnly.ok ? "" : textOnly.error}`);
  const persistedPlan = storedCodeLessonPlan(textOnly.value.sceneArtifacts);
  assert(persistedPlan, "canonical artifacts must carry the validated CodeLessonPlan");
  assert(
    persistedPlan.sections.length === plan.sections.length &&
      persistedPlan.sections[0]!.blocks[0]!.id === firstBlock.id,
    "the persisted plan must round-trip through the restore-side reader",
  );
  const persistedType = parseStoredSegmentCommands(textOnly.value.segments.at(-1)?.command)
    .find((command) => command.type === "TYPE");
  assert(persistedType, "the TYPE command must survive persistence");
  assert(
    persistedType.text === firstBlock.code &&
      persistedType.semanticRef?.entityId === firstBlock.id,
    "persisted TYPE must carry the plan's block code and block id",
  );

  // A worked-example turn records a frame advance beside its code. FRAME was
  // missing from the persistence allowlist, so the server rejected the whole
  // turn with "teaching command FRAME is not allowed for persistence": every
  // DSA lesson that walked an example failed to save, taking replay, notes,
  // board history and export with it. It carries no coordinates, no text and
  // no id, so there is nothing in it to distrust.
  {
    const walked = clone(textOnlyMetadata);
    walked.segments.push({
      orderIndex: 2,
      narration: "Now the window has halved.",
      spokenText: "Now the window has halved.",
      command: {
        type: "FRAME",
        params: [],
        charPosition: 0,
        narrationBefore: "Now the window has halved.",
      },
    } as (typeof walked.segments)[number]);
    const walkedResult = await canonicalizeTurnSceneMetadata(walked);
    assert(
      walkedResult.ok,
      `a frame advance must persist: ${walkedResult.ok ? "" : walkedResult.error}`,
    );
    const frame = parseStoredSegmentCommands(walkedResult.value.segments.at(-1)?.command)
      .find((command) => command.type === "FRAME");
    assert(frame, "the FRAME command must survive persistence so replay can walk the example");
    assert(
      frame.params.length === 0 && frame.text === undefined,
      "a persisted frame advance carries no payload",
    );

    // It is runtime-owned, so a submission that dresses one up with
    // coordinates is not a frame advance and must not be stored as one.
    const forged = clone(walked);
    (forged.segments[2]!.command as Record<string, unknown>).params = [10, 20];
    const forgedResult = await canonicalizeTurnSceneMetadata(forged);
    assert(
      !forgedResult.ok,
      "a FRAME carrying coordinates must be rejected, not stored",
    );
  }

  // Client-submitted code text is never trusted: the canonical text is
  // rebuilt from the validated plan.
  const tamperedText = clone(textOnlyMetadata);
  (tamperedText.segments[1]!.command as Record<string, unknown>).text =
    "os.system('rm -rf /')";
  const tamperedTextResult = await canonicalizeTurnSceneMetadata(tamperedText);
  assert(tamperedTextResult.ok, "a tampered TYPE text must not fail the save");
  const rebuilt = parseStoredSegmentCommands(tamperedTextResult.value.segments.at(-1)?.command)
    .find((command) => command.type === "TYPE");
  assert(
    rebuilt?.text === firstBlock.code,
    "TYPE text must be rebuilt from the plan, not taken from the submission",
  );

  // Unknown block ids are filtered like stale FOCUS targets: nothing
  // untrusted renders, but the narration and the recording survive.
  const unknownBlock = clone(textOnlyMetadata);
  (unknownBlock.segments[1]!.command as Record<string, unknown>).semanticRef = {
    entityId: "no-such-block",
  };
  const unknownBlockResult = await canonicalizeTurnSceneMetadata(unknownBlock);
  assert(unknownBlockResult.ok, "an unknown TYPE block id must not drop the recording");
  const unknownSegment = unknownBlockResult.value.segments.at(-1);
  assert(
    unknownSegment?.narration === "Here is the next part of the algorithm." &&
      parseStoredSegmentCommands(unknownSegment.command).every((command) => command.type !== "TYPE"),
    "the unresolved TYPE is filtered while its narration persists",
  );

  // TYPE without a plan reveals nothing at replay and must fail closed.
  const noPlan = clone(textOnlyMetadata);
  assert(isRecord(noPlan.sceneArtifacts), "fixture needs artifacts");
  delete noPlan.sceneArtifacts.codeLesson;
  const noPlanResult = await canonicalizeTurnSceneMetadata(noPlan);
  assert(
    !noPlanResult.ok && /TYPE commands require a persisted code lesson plan/.test(noPlanResult.error),
    "TYPE segments without a persisted plan must be rejected",
  );

  // A plan failing validation rejects the save instead of being dropped.
  const tamperedPlan = clone(textOnlyMetadata);
  assert(isRecord(tamperedPlan.sceneArtifacts), "fixture needs artifacts");
  tamperedPlan.sceneArtifacts.codeLesson = {
    ...plan,
    question: "a completely different question",
  };
  const tamperedPlanResult = await canonicalizeTurnSceneMetadata(tamperedPlan);
  assert(
    !tamperedPlanResult.ok && /code lesson plan is invalid/.test(tamperedPlanResult.error),
    "a plan that does not match the turn question must be rejected",
  );

  // Validated DSA turn: the scene recompiles into the DSA viewport so replay
  // intro ink never lands under the code panel.
  const dsaScene = synthesizeDsaScene(plan.diagramHint, {
    question,
    compile: { viewport: DSA_DIAGRAM_ZONE },
  });
  assert(dsaScene, "the mock plan's diagram hint must synthesize a DSA scene");
  const stampedDocument = {
    ...dsaScene.document,
    source: {
      ...dsaScene.document.source,
      nonMetric: true,
      representationTier: dsaScene.tier,
    },
  };
  const presentation = buildVerifiedDiagramPresentation(
    stampedDocument,
    dsaScene.renderScene,
    { layout: "code_lesson" },
  );
  const focusTarget = presentation.diagram.anchors[0]?.id;
  assert(focusTarget, "the DSA presentation must expose focus anchors");

  const validatedMetadata: SubmittedTurnSceneMetadata = {
    question,
    sceneDocument: stampedDocument,
    sceneEngineVersion: "forged-client-version",
    validationReport: { valid: true, issues: [] },
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: null,
      representationTier: dsaScene.tier,
      nonMetric: true,
      candidates: [],
      diagramResultStatus: "ready",
      codeLesson: plan,
    },
    segments: [
      ...presentation.introSegments.map((segment, index) => ({
        orderIndex: index,
        narration: segment.narration,
        spokenText: segment.narration,
        command: serializeSegmentCommands(getSegmentCommands(segment), {
          trustedDiagramGeometry: true,
        }),
      })),
      {
        orderIndex: presentation.introSegments.length,
        narration: "Notice the verified structure.",
        spokenText: "Notice the verified structure.",
        command: {
          type: "FOCUS",
          params: [],
          text: focusTarget,
          charPosition: 0,
          narrationBefore: "Notice the verified structure.",
        },
      },
      typeSegment(firstBlock.id, firstBlock.code, presentation.introSegments.length + 1),
    ],
  };

  const validated = await canonicalizeTurnSceneMetadata(clone(validatedMetadata));
  assert(validated.ok, `validated DSA turn should persist: ${validated.ok ? "" : validated.error}`);
  assert(
    storedCodeLessonPlan(validated.value.sceneArtifacts) !== null,
    "the validated turn's canonical artifacts must carry the plan",
  );
  assert(
    parseStoredSegmentCommands(validated.value.segments.at(-1)?.command)
      .some((command) => command.type === "TYPE" && command.semanticRef?.entityId === firstBlock.id),
    "the validated turn's TYPE segment must survive persistence",
  );

  // The server-reconstructed intro must sit in the DSA diagram zone. A
  // default-viewport recompile would start placing geometry around x 410,
  // underneath the code panel.
  const coordinateTypes = new Set(["DRAW_RECT", "DRAW_CIRCLE", "DRAW_LINE", "LABEL", "ARROW"]);
  let trustedCoordinateCommands = 0;
  for (const segment of validated.value.segments) {
    if (!isRecord(segment.command) || segment.command.trustedDiagramGeometry !== true) continue;
    for (const command of parseStoredSegmentCommands(segment.command)) {
      if (!coordinateTypes.has(command.type)) continue;
      trustedCoordinateCommands += 1;
      assert(
        (command.params[0] ?? 0) >= 500,
        `server intro ink must stay in the DSA zone, got ${command.type} at x=${command.params[0]}`,
      );
    }
  }
  assert(trustedCoordinateCommands > 0, "the validated turn must persist server intro ink");

  // A persisted lesson has to come back as a walk-through, not just a code
  // panel. Only the plan used to be restored, so `frames` stayed empty and
  // every replayed FRAME cue found nothing to advance: the board held frame 1
  // while the narration walked the whole example. `resolveDsaFrames` is pure,
  // so the frames rebuild from the question and the plan that were saved.
  {
    const sortQuestion = "Explain bubble sort with a worked example.";
    const sortPlan = getMockCodeLessonPlan(sortQuestion);
    const live = resolveDsaFrames(sortQuestion, sortPlan.diagramHint, sortPlan);
    assert(live, "bubble sort must resolve a walk-through for this check to mean anything");
    assert(
      live!.frames.length >= 8,
      `a ${live!.frames.length}-frame bubble sort is back to one frame per pass`,
    );

    const controller = { frames: new DsaFrameController() };
    restoreDsaFrames(controller, { question: sortQuestion }, sortPlan);
    assert(
      controller.frames.total() === live!.frames.length,
      `restore rebuilt ${controller.frames.total()} frames against the live turn's ${live!.frames.length}`,
    );
    assert(
      controller.frames.hasNext(),
      "a restored walk-through must be able to advance, or the replayed figure is frozen",
    );

    // A turn with no plan must clear the frames rather than leave the previous
    // turn's walk on the controller.
    restoreDsaFrames(controller, { question: sortQuestion }, null);
    assert(controller.frames.total() === 0, "a turn without a plan must clear the walk-through");
  }

  // --- A dense example falls back to the family's, rather than to no figure. ---
  //
  // `compileTraceScenes` fails closed, which is right: a frame that would draw
  // a value outside its own cell should take the whole walk down rather than
  // teach one bad picture. But that used to end the matter. Min Cost to
  // Connect All Points states five points, which is ten weighted edges, and
  // the board went blank on a question the engine had routed to Kruskal
  // correctly and could draw perfectly well on four. A smaller correct example
  // of the right algorithm teaches; nothing does not.
  {
    const dense = [
      "You are given an array points representing integer coordinates of some points on a 2D-plane,",
      "where points[i] = [xi, yi]. The cost of connecting two points is the manhattan distance between them.",
      "Return the minimum cost to make all points connected.",
      "",
      "Example 1:",
      "Input: points = [[0,0],[2,2],[3,10],[5,2],[7,0]]",
      "Output: 20",
    ].join("\n");

    const frames = resolveDsaFrames(dense);
    assert(frames !== null, "a routed question must not lose its figure because its own example is too dense");
    assert(
      frames.frameSource === "trace",
      `expected a simulated walk, got ${frames.frameSource}: a hint figure is a weaker lesson than the family's own example`,
    );
    assert(
      frames.exampleSource === "default",
      "the walk must say it is the family's example rather than claim the student's own",
    );
    assert(frames.frames.length >= 2, "a fallback walk is still a walk, not one static picture");

    // The planner has to be told the example the board settled on. Told the
    // other one, the code panel runs different numbers from the figure beside
    // it, which is the mismatch this whole layer exists to prevent.
    const context = resolveCodeLessonBoardContext(dense);
    assert(context !== null, "the planner must still get board context");
    const closing = frames.frames[frames.frames.length - 1]!.caption.toLowerCase();
    const answer = String(context.context.resultText ?? "").toLowerCase();
    const tokens = answer.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
    assert(
      tokens.length > 0 && tokens.some((token) => closing.includes(token)),
      `the planner was told "${context.context.resultText}" but the board closes on "${closing}"`,
    );
  }

  console.log("code lesson persistence verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
