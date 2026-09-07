import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eraseWhiteboardRegionIfCurrent } from "../../features/tutor-session/hooks/useCommandExecution";
import {
  awaitCurrentTurn,
  canContinueTurnAfterAsync,
  shouldFlushPendingQuestion,
} from "../../features/tutor-session/hooks/turn/useQuestionHandler";
import { isReplayGenerationCurrent } from "../../features/tutor-session/hooks/useReplay";

/**
 * A worked-example frame swap has to publish the new frame, not just point the
 * ref at it.
 *
 * The caption under the board renders from React state, and the deferred
 * annotations a FOCUS reveals are read off the published diagram. When the
 * FRAME handler only updated the ref, the board kept frame 1's caption under
 * every later figure — the picture said one thing and the line under it said
 * another, for the whole lesson.
 */
function assertFrameSwapPublishesDiagram(): void {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../features/tutor-session/hooks/useCommandExecution.ts"),
    "utf8",
  );
  const frameCase = source.indexOf('case "FRAME": {');
  assert.notEqual(frameCase, -1, "the FRAME command handler is gone");
  const nextCase = source.indexOf('case "PAUSE": {', frameCase);
  assert.notEqual(nextCase, -1, "could not find the end of the FRAME handler");
  const body = source.slice(frameCase, nextCase);
  const refWrites = body.split("activeVerifiedDiagramRef.current =").length - 1;
  const publishes = body.split("setActiveVerifiedDiagram?.(").length - 1;
  assert.ok(refWrites > 0, "the FRAME handler must point the active diagram at the new frame");
  assert.equal(
    publishes,
    refWrites,
    `every frame swap must publish the frame it points at: ${refWrites} ref writes, ${publishes} publishes`,
  );
}

async function main(): Promise<void> {
  const readyQuestion = {
    pendingQuestion: "solve 2x + 3 = 7",
    boardLoaded: true,
    hasWhiteboard: true,
    phase: "idle" as const,
    turnActive: false,
    pendingSegmentCount: 0,
  };

  assertFrameSwapPublishesDiagram();

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

  await assertCancelSettlesPendingDelays();

  console.log("turn async guard verification passed");
}

/**
 * Cancelling a turn must settle every delay it is waiting on.
 *
 * `clearCancelTimers` used to call `clearTimeout` and drop the id. The promise
 * a caller was awaiting was then never settled: the command executor never
 * returned, the segment runner's draw promise never resolved, and the next
 * turn's `await drawChainRef.current` waited on a lesson that had already been
 * cancelled. The board never moved again, which is indistinguishable from the
 * tutor having died. A DSA lesson leans on these delays for every pause the
 * pen takes, so the window is not small.
 */
async function assertCancelSettlesPendingDelays(): Promise<void> {
  const source = readFileSync(
    resolve(import.meta.dirname, "../../features/tutor-session/hooks/useCancelControl.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // Both halves matter: the resolver has to be kept, and it has to be called.
  assert.match(
    source,
    /delayTimersRef\.current\.push\(\{\s*id:\s*timeoutId,\s*resolve\s*\}\)/,
    "a pending delay must keep its resolver, or cancelling cannot settle it",
  );
  const clear = source.slice(source.indexOf("clearCancelTimers"));
  assert.match(
    clear,
    /entry\.resolve\(\)/,
    "clearCancelTimers must resolve each pending delay, not just clear its timer",
  );
  assert.ok(
    clear.indexOf("clearTimeout(entry.id)") < clear.indexOf("entry.resolve()"),
    "clear the timer before resolving so a resolved delay cannot fire twice",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
