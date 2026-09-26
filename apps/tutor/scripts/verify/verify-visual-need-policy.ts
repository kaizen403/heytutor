import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessVisualNeed, visualNeedFromAssessment } from "../../lib/llm/visualNeedPolicy";
import { fetchVisualNeed } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { resolveSelectedVisualStatus, resolveVisualRequirement } from "../../features/tutor-session/lib/scene/visualRequirement";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main(): Promise<void> {
  const question = "Explain how two reservoirs exchange energy through an engine.";
  const capture: { body?: Record<string, unknown> } = {};
  const assessed = await assessVisualNeed({
    question,
    options: {
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        capture.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          answers: { visual_need: { type: "choice", choice: "required" } },
          usage: { inputTokens: 100, outputTokens: 0 },
        });
      },
    },
  });
  assert(assessed.assessment.status === "assessed", "Jev answer must be accepted");
  assert(assessed.decision === "required", "Jev can require a figure on a concept question");
  assert(capture.body?.model === "typesafe-ai/jev", "visual decision uses Jev");
  assert((capture.body?.questions as Record<string, unknown>)?.visual_need !== undefined,
    "the visual rubric must be sent as a typed question");
  const longCapture: { body?: { state?: { question?: string } } } = {};
  await assessVisualNeed({
    question: `${"setup ".repeat(900)}Sketch the resulting graph.`,
    options: {
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        longCapture.body = JSON.parse(String(init?.body)) as { state?: { question?: string } };
        return Response.json({ answers: { visual_need: { type: "choice", choice: "required" } } });
      },
    },
  });
  assert(longCapture.body?.state?.question?.includes("Sketch the resulting graph."),
    "the visual request at the end of a long question must reach Jev");
  const followUp = "How do those forces combine?";
  const recentConversation = "User: Show the two forces on the block.\nTutor: Gravity acts downward and the normal force acts upward.";
  const contextCapture: { body?: { state?: { question?: string; conversationContext?: string } } } = {};
  await assessVisualNeed({
    question: followUp,
    conversationContext: recentConversation,
    options: {
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        contextCapture.body = JSON.parse(String(init?.body)) as typeof contextCapture.body;
        return Response.json({ answers: { visual_need: { type: "choice", choice: "optional" } } });
      },
    },
  });
  assert(contextCapture.body?.state?.question === followUp &&
    contextCapture.body.state.conversationContext === recentConversation,
  "a contextual follow-up must reach Jev with the same recent conversation as the planner");
  await assessVisualNeed({
    question: followUp,
    conversationContext: `${"old context ".repeat(500)}${recentConversation}`,
    options: {
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        contextCapture.body = JSON.parse(String(init?.body)) as typeof contextCapture.body;
        return Response.json({ answers: { visual_need: { type: "choice", choice: "optional" } } });
      },
    },
  });
  assert((contextCapture.body?.state?.conversationContext?.length ?? 0) <= 4_000 &&
    contextCapture.body?.state?.conversationContext?.endsWith(recentConversation),
    "Jev context must stay bounded while preserving the latest exchange");

  const unavailable = await assessVisualNeed({ question, options: { apiKey: null } });
  assert(unavailable.decision === null, "unavailable Jev must leave existing decisions in control");
  assert(visualNeedFromAssessment({ status: "unavailable", job: "visual_need", reason: "deadline" }) === null,
    "deadline is not a no-draw vote");
  const malformed = await assessVisualNeed({
    question,
    options: {
      apiKey: "test-key",
      fetchImpl: async () => Response.json({ answers: { visual_need: { type: "choice", choice: "invented" } } }),
    },
  });
  assert(malformed.decision === null, "unknown Jev choices must not change the plan");
  assert(resolveVisualRequirement("none", "required", false) === "required",
    "Jev must rescue a planner no-draw call");
  assert(resolveVisualRequirement("optional", null, true) === "required",
    "the deterministic requirement must survive Jev failure");
  assert(resolveVisualRequirement("required", "none", false) === "required",
    "Jev must not veto a required visual");
  assert(resolveVisualRequirement("none", "optional", false) === "optional",
    "a helpful Jev drawing decision must run scene planning");
  assert(resolveVisualRequirement("optional", "none", false) === "none",
    "a no-draw Jev decision must avoid optional unrelated scenes");
  const requiredFailureStatus = process.env.NEXT_PUBLIC_SCENE_ENGINE_V3_REQUIRED_RETRY === "0"
    ? "text_only" : "retry_required";
  assert(resolveSelectedVisualStatus("required", false) === requiredFailureStatus,
    "an empty required figure must honor the required-retry flag");
  assert(resolveSelectedVisualStatus("optional", false) === "text_only",
    "an empty optional figure can be taught in text");
  assert(resolveSelectedVisualStatus("required", true) === "validated",
    "a readable required figure is validated");

  const clientRequest: { question?: string; conversationContext?: string; traceId?: string } = {};
  const client = await fetchVisualNeed({
    url: "/api/visual-need",
    question: followUp,
    conversationContext: recentConversation,
    traceId: "visual-policy-test",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { question?: string; conversationContext?: string };
      clientRequest.question = body.question;
      clientRequest.conversationContext = body.conversationContext;
      clientRequest.traceId = new Headers(init?.headers).get("x-heytutor-trace-id") ?? undefined;
      return Response.json({ decision: "required" });
    },
  });
  assert(client === "required", "the client must carry the typed decision");
  assert(clientRequest.question === followUp && clientRequest.conversationContext === recentConversation &&
    clientRequest.traceId === "visual-policy-test",
    "the client must send the question, recent conversation, and turn trace to the API");
  const invalid = await fetchVisualNeed({
    url: "/api/visual-need",
    question,
    fetchImpl: async () => Response.json({ decision: "invented" }),
  });
  assert(invalid === null, "invalid server decisions must be ignored");
  const failed = await fetchVisualNeed({
    url: "/api/visual-need",
    question,
    fetchImpl: async () => Response.json({ error: "unavailable" }, { status: 503 }),
  });
  assert(failed === null, "an unavailable API response must not become a no-draw decision");

  const handler = readFileSync(join(process.cwd(), "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
  assert(handler.includes("fetchVisualNeed({"), "live questions must ask Jev for a visual decision");
  assert(/fetchVisualNeed\(\{[\s\S]*?conversationContext: recentConversation,[\s\S]*?\}\)/.test(handler),
    "the live turn must give Jev the planner's recent conversation");
  const route = readFileSync(join(process.cwd(), "app/api/visual-need/route.ts"), "utf8");
  assert(/assessVisualNeed\(\{[\s\S]*?conversationContext:/.test(route),
    "the visual-need API must forward conversation context to Jev");
  assert(handler.includes("resolveVisualRequirement("), "the visual decision must reach the live turn plan");
  assert(handler.includes("resolveSelectedVisualStatus("), "the final ink guard must respect required visuals");
  assert(handler.includes('diagramSource === "none" && sceneVisualStatus === "validated"'),
    "a validated scene with no board commands must be downgraded after presentation");
  console.log("Visual need policy verified");
}

void main();
