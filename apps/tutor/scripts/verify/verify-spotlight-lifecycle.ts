/**
 * Spotlight gate.
 *
 * A spotlight dims the whole diagram zone except one hole. Left up, the figure
 * sits under a grey wash and the lesson reads as frozen — which is what the
 * owner saw on a bubble-sort turn: the array drawn, one cell lit, everything
 * else greyed, nothing further happening.
 *
 * The cause was an early `return` for cancellation sitting between raising the
 * veil and lowering it. These checks pin the invariant rather than that one
 * path: the veil comes down on completion, on cancellation, and on a throw,
 * and the turn teardown clears it regardless.
 */
import { clearSpotlight, withSpotlight, type SpotlightSpec } from "../../features/tutor-session/lib/board/spotlight";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SPEC: SpotlightSpec = {
  veil: { x: 620, y: 90, width: 540, height: 460 },
  hole: { x: 700, y: 200, width: 80, height: 80 },
  opacity: 0.32,
};

function recorder() {
  const calls: Array<SpotlightSpec | null> = [];
  return {
    calls,
    host: { setSpotlight: (spec: SpotlightSpec | null) => void calls.push(spec) },
  };
}

async function main(): Promise<void> {
  // --- Normal completion raises then lowers the veil. ---
  {
    const { calls, host } = recorder();
    const cancelled = await withSpotlight(host, SPEC, async () => false);
    assert(cancelled === false, "the body's result must pass through");
    assert(calls.length === 2, `expected raise + lower, got ${calls.length} calls`);
    assert(calls[0] === SPEC, "the veil must be raised with the given spec");
    assert(calls[1] === null, "the veil must be lowered on completion");
  }

  // --- Cancellation mid-focus still lowers it. This is the reported bug. ---
  {
    const { calls, host } = recorder();
    const cancelled = await withSpotlight(host, SPEC, async () => true);
    assert(cancelled === true, "a cancelled body must report cancellation to the caller");
    assert(
      calls[calls.length - 1] === null,
      "a cancelled focus must still lower the veil — leaving it up greys out the whole figure",
    );
  }

  // --- A throw inside the body still lowers it, and still propagates. ---
  {
    const { calls, host } = recorder();
    const boom = new Error("whiteboard went away mid-focus");
    let caught: unknown = null;
    try {
      await withSpotlight(host, SPEC, async () => {
        throw boom;
      });
    } catch (error) {
      caught = error;
    }
    assert(caught === boom, "the original error must propagate");
    assert(calls[calls.length - 1] === null, "a thrown focus must still lower the veil");
  }

  // --- Teardown is unconditional and tolerates a missing board. ---
  {
    const { calls, host } = recorder();
    clearSpotlight(host);
    assert(calls.length === 1 && calls[0] === null, "teardown must lower the veil");
    clearSpotlight(null);
    clearSpotlight(undefined);
    clearSpotlight({});
  }

  // --- No caller may raise a veil outside the guarded helper. ---
  {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url),
      "utf8",
    );
    // Raising the veil directly is what allows an early return to strand it.
    const raises = source.match(/setSpotlight\?\.\(\s*\{/g) ?? [];
    assert(
      raises.length === 0,
      `${raises.length} direct setSpotlight({…}) call(s) remain; raise the veil through withSpotlight so it cannot be stranded`,
    );
    assert(
      /withSpotlight\(/.test(source),
      "the focus handler must raise its veil through withSpotlight",
    );
  }

  // --- Ending a turn always clears, even if a focus leaked somehow. ---
  {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../features/tutor-session/hooks/turn/useTurnControl.ts", import.meta.url),
      "utf8",
    );
    assert(
      /clearSpotlight\(whiteboardRef\.current\)/.test(source),
      "finishLectureUi must clear the spotlight so no veil survives a turn",
    );
  }

  console.log("verify-spotlight-lifecycle: the veil comes down on completion, cancel, throw, and teardown");
}

void main();
