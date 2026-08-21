import assert from "node:assert/strict";
import { eraseWhiteboardRegionIfCurrent } from "../../features/tutor-session/hooks/useCommandExecution";
import {
  awaitCurrentTurn,
  canContinueTurnAfterAsync,
  shouldFlushPendingQuestion,
} from "../../features/tutor-session/hooks/turn/useQuestionHandler";
import { isReplayGenerationCurrent } from "../../features/tutor-session/hooks/useReplay";

async function main(): Promise<void> {
  const readyQuestion = {
    pendingQuestion: "solve 2x + 3 = 7",
    boardLoaded: true,
    hasWhiteboard: true,
    phase: "idle" as const,
    turnActive: false,
    pendingSegmentCount: 0,
  };

  assert.equal(shouldFlushPendingQuestion(readyQuestion), true);
  assert.equal(shouldFlushPendingQuestion({ ...readyQuestion, boardLoaded: false }), false);
  assert.equal(shouldFlushPendingQuestion({ ...readyQuestion, hasWhiteboard: false }), false);
  assert.equal(shouldFlushPendingQuestion({ ...readyQuestion, phase: "planning" }), false);

  assert.equal(canContinueTurnAfterAsync({
    turnGeneration: 4,
    activeTurnGeneration: 4,
    cancelled: false,
    aborted: false,
  }), true);
  assert.equal(canContinueTurnAfterAsync({
    turnGeneration: 4,
    activeTurnGeneration: 5,
    cancelled: false,
    aborted: false,
  }), false);
  assert.equal(canContinueTurnAfterAsync({
    turnGeneration: 4,
    activeTurnGeneration: 4,
    cancelled: true,
    aborted: true,
  }), false);

  let plannerIsCurrent = true;
  const plannerResult = Promise.resolve().then(() => {
    plannerIsCurrent = false;
    return "stale plan";
  });
  await assert.rejects(
    awaitCurrentTurn(plannerResult, () => plannerIsCurrent),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(
    await awaitCurrentTurn(Promise.resolve("current plan"), () => true),
    "current plan",
  );

  assert.equal(isReplayGenerationCurrent({
    generation: 8,
    activeGeneration: 8,
    cancelled: false,
  }), true);
  assert.equal(isReplayGenerationCurrent({
    generation: 8,
    activeGeneration: 9,
    cancelled: false,
  }), false);
  assert.equal(isReplayGenerationCurrent({
    generation: 8,
    activeGeneration: 8,
    cancelled: true,
  }), false);

  let eraseGeneration = 12;
  let staleEraseMutatedBoard = false;
  const fakeWhiteboard = {
    async eraseRegion(
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      _duration: number,
      shouldCancel?: () => boolean,
    ): Promise<void> {
      eraseGeneration += 1;
      if (!shouldCancel?.()) staleEraseMutatedBoard = true;
    },
  };
  const eraseCompleted = await eraseWhiteboardRegionIfCurrent(
    fakeWhiteboard,
    { x: 0, y: 0, width: 100, height: 100, duration: 500 },
    () => eraseGeneration !== 12,
  );
  assert.equal(eraseCompleted, false);
  assert.equal(staleEraseMutatedBoard, false);

  console.log("turn async guard verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
