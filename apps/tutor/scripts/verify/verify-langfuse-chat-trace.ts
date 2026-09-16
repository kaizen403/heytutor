import { readFileSync } from "node:fs";
import {
  chatGenerationName,
  resolveChatGenerationKind,
  resolveTurnTraceInput,
  shouldUpdateParentTraceOutput,
} from "../../lib/obs/chatTrace";
import { createTurnTelemetry } from "../../lib/obs/turnTelemetry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(chatGenerationName("teaching") === "fireworks-llm", "teaching generation name must keep the dashboard widget");
assert(chatGenerationName("turn-plan-v3") === "turn-plan-v3", "turn plan generation must be named for what it is");
assert(chatGenerationName("problem-ir-v1") === "problem-ir-v1", "problem IR generation must be named for what it is");
assert(chatGenerationName("scene-planner-v2") === "scene-planner-v2", "scene planner generation must be named for what it is");
assert(chatGenerationName("code-lesson-v1") === "code-lesson-v1", "code lesson generation must be named for what it is");

assert(
  resolveChatGenerationKind(new Headers({ "x-planner": "1", "x-turn-planner-version": "3" })) ===
    "turn-plan-v3",
  "turn-plan header was not classified",
);
assert(
  resolveChatGenerationKind(new Headers({ "x-planner": "1", "x-problem-ir-version": "1" })) ===
    "problem-ir-v1",
  "problem-ir header was not classified",
);
assert(
  resolveChatGenerationKind(new Headers({ "x-planner": "1", "x-scene-planner-version": "2" })) ===
    "scene-planner-v2",
  "scene planner header was not classified",
);
assert(
  resolveChatGenerationKind(new Headers({ "x-planner": "1", "x-code-lesson-version": "1" })) ===
    "code-lesson-v1",
  "code lesson header was not classified",
);
assert(resolveChatGenerationKind(new Headers()) === "teaching", "bare chat requests are teaching");

const question = "Draw the free-body diagram.";
assert(
  resolveTurnTraceInput({
    kind: "turn-plan-v3",
    attach: true,
    question,
    userInput: "QUESTION\n" + question,
  }) === question,
  "attached planner must not put its prompt on the parent trace",
);
assert(
  resolveTurnTraceInput({
    kind: "turn-plan-v3",
    attach: true,
    userInput: "QUESTION\n" + question,
  }) === undefined,
  "attached planner without a question header must leave parent input alone",
);
assert(
  resolveTurnTraceInput({
    kind: "teaching",
    attach: true,
    question,
    userInput: "continue",
  }) === question,
  "teaching continuation must keep the student question on the parent",
);
assert(
  resolveTurnTraceInput({
    kind: "teaching",
    attach: false,
    userInput: question,
  }) === question,
  "standalone teaching uses the user message",
);

assert(shouldUpdateParentTraceOutput("turn-plan-v3", question) === false, "planner must not overwrite parent output");
assert(shouldUpdateParentTraceOutput("teaching", question) === true, "first teaching stream owns parent output");
assert(shouldUpdateParentTraceOutput("teaching", "continue") === false, "continuations must not replace parent output");

async function main(): Promise<void> {
  const bodies: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    bodies.push(String(init && "body" in init ? init.body : ""));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const tel = createTurnTelemetry();
    tel.setTrace("turn-1", "board-1");
    tel.mark("thinking");
    tel.meta({ segment_count: 1 });
    await tel.flush();
    tel.mark("turn-cancelled");
    await tel.flush();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert(bodies.length === 2, `expected two flushes, got ${bodies.length}`);
  const first = JSON.parse(bodies[0] ?? "{}") as { events?: Array<{ name: string }> };
  const second = JSON.parse(bodies[1] ?? "{}") as { events?: Array<{ name: string }> };
  assert(first.events?.map((event) => event.name).join(",") === "thinking", "first flush must drain the thinking mark");
  assert(
    second.events?.map((event) => event.name).join(",") === "turn-cancelled",
    "second flush must not resend the first span",
  );

  const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");
  const anchors: Array<[string, string, string]> = [
    [
      "../../features/tutor-session/hooks/turn/useQuestionHandler.ts",
      "traceId: turnTraceId ?? undefined",
      "the live turn must send its Langfuse id on every planner and teaching call",
    ],
    [
      "../../app/api/chat/route.ts",
      "generationName: chatGenerationName(kind)",
      "the chat route must name planner generations separately from teaching",
    ],
    [
      "../../lib/obs/turnTelemetry.ts",
      "const pendingEvents = events.splice(0, events.length)",
      "client telemetry must drain on flush so cancel cannot duplicate spans",
    ],
  ];
  for (const [file, anchor, message] of anchors) {
    assert(read(file).includes(anchor), `${message}; repoint this gate at the control that replaced it`);
  }

  console.log("langfuse chat trace verification passed");
}

void main();
