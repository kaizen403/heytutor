/**
 * Gate for what a turn does when its visuals die.
 *
 * The owner hit this live: a lesson stopped drawing 31 seconds in — timeline
 * frozen, one figure on the board, empty code panel — while the voice carried
 * on narrating the rest. The trigger was external (a concurrently-edited
 * module failed to compile and took the session's React tree down), but the
 * behaviour was wrong on its own terms: speech and ink are separate promises,
 * so a dead draw side left the audio running, and the per-segment catch logged
 * the failure and moved on to narrate the next segment too.
 *
 * Two rules, asserted here:
 *   1. a failed draw silences the voice that was narrating it;
 *   2. repeated failures end the turn instead of reading a lesson to a board
 *      that has stopped moving.
 */
import {
  MAX_CONSECUTIVE_SEGMENT_FAILURES,
  guardDrawWithSpeech,
  shouldAbandonTurn,
} from "../../features/tutor-session/lib/turn/turnFailurePolicy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  // --- A failing draw silences the narration and still reports the error. ---
  {
    let silenced = 0;
    const boom = new Error("whiteboard module went away");
    let caught: unknown = null;
    try {
      await guardDrawWithSpeech(Promise.reject(boom), () => {
        silenced += 1;
      });
    } catch (error) {
      caught = error;
    }
    assert(silenced === 1, `the voice must be silenced exactly once, was ${silenced}`);
    assert(caught === boom, "the original draw error must still propagate to the queue");
  }

  // --- A succeeding draw never silences anything. ---
  {
    let silenced = 0;
    const value = await guardDrawWithSpeech(Promise.resolve("drew"), () => {
      silenced += 1;
    });
    assert(value === "drew", "a successful draw must pass its value through");
    assert(silenced === 0, "a successful draw must not stop the narration");
  }

  // --- A throwing handler must not mask the draw error. ---
  {
    const boom = new Error("original");
    let caught: unknown = null;
    try {
      await guardDrawWithSpeech(Promise.reject(boom), () => {
        throw new Error("the silencer itself failed");
      });
    } catch (error) {
      caught = error;
    }
    assert(caught === boom, "a failure inside the handler must not replace the draw error");
  }

  // --- One failure is survivable; two in a row ends the turn. ---
  {
    assert(!shouldAbandonTurn(0), "a healthy turn must keep going");
    assert(
      !shouldAbandonTurn(1),
      "a single failure may be transient — the next segment should get a chance",
    );
    assert(
      shouldAbandonTurn(MAX_CONSECUTIVE_SEGMENT_FAILURES),
      "repeated failures must end the turn rather than narrate to a frozen board",
    );
    assert(
      shouldAbandonTurn(MAX_CONSECUTIVE_SEGMENT_FAILURES + 5),
      "the threshold must hold above the limit too",
    );
    assert(
      MAX_CONSECUTIVE_SEGMENT_FAILURES >= 2,
      "aborting on the very first failure would end turns on a single transient command",
    );
  }

  // --- The runner must actually use the guard, not the bare draw promise. ---
  {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url),
      "utf8",
    );
    assert(
      /guardDrawWithSpeech\(/.test(source),
      "useSegmentRunner must wrap its draw promise in guardDrawWithSpeech",
    );
    // The paired branch awaits Promise.all; passing the raw promise there is
    // exactly the bug this gate exists to prevent.
    assert(
      !/\n\s*drawPromise,\n\s*\]\);/.test(source),
      "the paired narration+draw branch must await the guarded draw, not the raw drawPromise",
    );
  }

  console.log(
    "verify-turn-failure-policy: a dead draw silences the voice, and repeated failures end the turn",
  );
}

void main();
