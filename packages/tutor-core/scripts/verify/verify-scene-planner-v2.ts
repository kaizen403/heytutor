import {
  normalizeSceneDocumentModelOutput,
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
} from "../../src/planners/scenePlannerV2";

const normalizedStringSource = normalizeSceneDocumentModelOutput(
  {
    schemaVersion: "scene-document/v2",
    source: "AUTHORITATIVE TURN PLAN V3",
  },
  "Sketch the exact region",
);
if (
  typeof normalizedStringSource.source !== "object" ||
  normalizedStringSource.source === null ||
  (normalizedStringSource.source as Record<string, unknown>).question !== "Sketch the exact region" ||
  (normalizedStringSource.source as Record<string, unknown>).sourceLabel !== "AUTHORITATIVE TURN PLAN V3"
) {
  throw new Error("planner string source was not bound to the authoritative question");
}
const conflictingSource = normalizeSceneDocumentModelOutput(
  { source: { question: "different question" } },
  "authoritative question",
);
if ((conflictingSource.source as Record<string, unknown>).question !== "different question") {
  throw new Error("planner normalization concealed an explicit source-question conflict");
}
const objectSourceWithoutQuestion = normalizeSceneDocumentModelOutput(
  { source: { questionId: "planner-local-id" } },
  "authoritative object-source question",
);
if ((objectSourceWithoutQuestion.source as Record<string, unknown>).question !== "authoritative object-source question") {
  throw new Error("planner object source omitted authoritative question provenance");
}

const originalFetch = globalThis.fetch;
const requests: string[] = [];
const phases: string[] = [];
const lanes: string[] = [];
globalThis.fetch = async (_input, init) => {
  requests.push(String(init?.body));
  const headers = new Headers(init?.headers);
  phases.push(headers.get("x-scene-planner-phase") ?? "");
  const lane = headers.get("x-scene-planner-lane") ?? "";
  lanes.push(lane);
  const repaired = requests.length >= 5;
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          schemaVersion: "scene-document/v2",
          repaired,
          seed: lane,
          verbosePayload: "do-not-resend-".repeat(1_000),
        }),
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const result = await planSceneDocumentWithRepair(
    "construct a test scene",
    (candidate) => candidate.repaired === true
      ? { valid: true, errors: [], value: candidate }
      : {
          valid: false,
          errors: candidate.seed === "primary"
            ? [
                { code: "assertion_failed", message: "repair this connected path", severity: "fatal" },
                {
                  code: "turnplan_loop_member_not_proven",
                  message: "claimed route members do not form a closed path",
                  severity: "fatal",
                  entityIds: ["rod", "top_rail", "resistor", "bottom_rail"],
                },
                {
                  code: "derived_role_operator_mismatch",
                  message: "refracted wavefront must be derived with wavefront_family, not guessed with segment",
                  severity: "fatal",
                  entityIds: ["refracted_wavefront"],
                },
                {
                  code: "normal_adjustment_focal_plane_split",
                  message: "normal adjustment used separate focal points",
                  severity: "fatal",
                  entityIds: ["objective_focus", "eyepiece_focus"],
                },
              ]
            : [
                { code: "assertion_failed", message: "repair this connected path", severity: "fatal" },
                { code: "extra_failure", message: "worse candidate", severity: "fatal" },
                { code: "third_failure", message: "still worse", severity: "fatal" },
                { code: "fourth_failure", message: "still worse", severity: "fatal" },
                { code: "fifth_failure", message: "still worse", severity: "fatal" },
              ],
        },
    {
      proxyUrl: "http://planner.test",
      timeoutMs: 2000,
      conversationContext: "Current flows counterclockwise: up through rod, left through top rail, down through resistor, right through bottom rail.",
    },
  );
  if (!result?.validation.valid || !result.repaired) throw new Error("plan/repair flow did not recover");
  if (result.candidates.length !== 6) throw new Error(`expected six audited candidates, got ${result.candidates.length}`);
  if (result.candidates.filter((candidate) => candidate.selected).length !== 1) throw new Error("selected candidate was not recorded exactly once");
  if (result.candidates.some((candidate) => !Number.isFinite(candidate.score))) throw new Error("candidate scores were not recorded");
  if (requests.length !== 6) throw new Error(`expected two plans plus two parallel repair rounds, got ${requests.length} requests`);
  if (!requests[2]?.includes("STRUCTURED VALIDATION ERRORS")) throw new Error("repair request lacks structured failures");
  if (!requests[3]?.includes("STRUCTURED VALIDATION ERRORS")) throw new Error("second repair request lacks structured failures");
  if (!requests[4]?.includes("STRUCTURED VALIDATION ERRORS")) throw new Error("third repair request lacks structured failures");
  if (!requests[5]?.includes("STRUCTURED VALIDATION ERRORS")) throw new Error("fourth repair request lacks structured failures");
  const requestPrompt = (body: string | undefined): string => {
    const parsed = JSON.parse(body ?? "{}") as {
      messages?: Array<{ content?: string }>;
    };
    return parsed.messages?.at(-1)?.content ?? "";
  };
  if (!requestPrompt(requests[2]).includes('"seed":"primary"') ||
      !requestPrompt(requests[3]).includes('"seed":"primary"')) {
    throw new Error("independent first-round repairs did not share the best validated source candidate");
  }
  if (requestPrompt(requests[2]).includes("do-not-resend")) {
    throw new Error("repair request resent the full invalid candidate payload");
  }
  if (requestPrompt(requests[2]).length > 23_000) {
    throw new Error(`repair request exceeded the compact context budget: ${requestPrompt(requests[2]).length}`);
  }
  if (!requestPrompt(requests[2]).includes("Visual proximity is not connectivity")) {
    throw new Error("connectivity repair did not receive exact-endpoint guidance");
  }
  if (!requestPrompt(requests[2]).includes("WAVE-OPTICS REBUILD") ||
      !requestPrompt(requests[2]).includes("n1/n2 = v2/v1")) {
    throw new Error("wave-optics repair did not receive the atomic reconstruction rule");
  }
  if (!requestPrompt(requests[2]).includes("OPTICAL-INSTRUMENT REBUILD") ||
      !requestPrompt(requests[2]).includes("one shared point ID")) {
    throw new Error("optical-instrument repair did not receive the shared-axis/focus reconstruction rule");
  }
  if (
    !requestPrompt(requests[2]).includes("ORDERED CYCLIC ROUTE") ||
    !requestPrompt(requests[2]).includes("rod: p0 -> p1 (up)") ||
    !requestPrompt(requests[2]).includes("bottom rail: p3 -> p0 (right)")
  ) {
    throw new Error("cardinal route language was not compiled into ordered repair constraints");
  }
  const initialSystemPrompt = (
    JSON.parse(requests[0] ?? "{}") as { messages?: Array<{ content?: string }> }
  ).messages?.[0]?.content ?? "";
  const initialMessages = (
    JSON.parse(requests[0] ?? "{}") as { messages?: Array<{ content?: string }> }
  ).messages ?? [];
  const serializedPromptChars = initialMessages.reduce(
    (total, message) => total + (message.content?.length ?? 0),
    0,
  );
  if (
    initialSystemPrompt.length > 800 ||
    serializedPromptChars > 19_000
  ) {
    throw new Error(
      `scene planner duplicated its capability contract: ${JSON.stringify({
        systemChars: initialSystemPrompt.length,
        serializedPromptChars,
      })}`,
    );
  }
  const initialUserPrompt = initialMessages[1]?.content ?? "";
  if (
    !initialUserPrompt.includes("problem setup, not a solved answer sheet") ||
    !initialUserPrompt.includes("Do not place derived scalar answers") ||
    !initialUserPrompt.includes("Do not output a direction helper or wrap the result")
  ) {
    throw new Error("scene planner user contract lost the solved-answer safeguards");
  }
  // Request metadata is exercised through the captured phase/lane arrays; the
  // serialized request budget must also remain bounded by the caller.
  if (!requests[0]?.includes('"max_tokens":4000')) {
    throw new Error("scene planner request body unexpectedly changed its client output cap");
  }
  if (phases.slice(0, 2).some((phase) => phase !== "plan") || phases.slice(2).some((phase) => phase !== "repair")) {
    throw new Error(`planner phase headers are incorrect: ${phases.join(",")}`);
  }
  if (lanes.join(",") !== "primary,alternate,primary,alternate,primary,alternate") {
    throw new Error(`planner model lanes are not diversified: ${lanes.join(",")}`);
  }

  requests.length = 0;
  phases.length = 0;
  lanes.length = 0;
  let transportAttempt = 0;
  globalThis.fetch = async (_input, init) => {
    requests.push(String(init?.body));
    transportAttempt += 1;
    if (transportAttempt === 1) return new Response("temporary failure", { status: 500 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", ready: true }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const recovered = await planSceneDocumentWithRepair(
    "recover a planner request",
    (candidate) => candidate.ready === true
      ? { valid: true, errors: [], value: candidate }
      : { valid: false, errors: [{ code: "not_ready", message: "not ready", severity: "fatal" }] },
    { proxyUrl: "http://planner.test", timeoutMs: 2000 },
  );
  if (!recovered?.validation.valid || requests.length !== 2) {
    throw new Error("planner transport retry did not recover within the shared budget");
  }

  requests.length = 0;
  phases.length = 0;
  lanes.length = 0;
  globalThis.fetch = async (_input, init) => {
    requests.push(String(init?.body));
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    if (lane === "primary") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "scene-document/v2",
          candidate: "verified-primary",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("cancelled slow alternate", "AbortError"));
      }, { once: true });
    });
  };
  const earlyAcceptStartedAt = Date.now();
  const earlyAccepted = await planSceneDocumentWithRepair(
    "accept the verified candidate without waiting for a straggler",
    (candidate) => candidate.candidate === "verified-primary"
      ? { valid: true, errors: [], value: candidate }
      : { valid: false, errors: [{ code: "not_ready", message: "not ready", severity: "fatal" }] },
    { proxyUrl: "http://planner.test", timeoutMs: 4000 },
  );
  const earlyAcceptElapsedMs = Date.now() - earlyAcceptStartedAt;
  if (
    !earlyAccepted?.validation.valid ||
    earlyAccepted.candidates.length !== 1 ||
    earlyAcceptElapsedMs >= 2000
  ) {
    throw new Error(
      `verified primary waited for a slow alternate: ${JSON.stringify({
        elapsedMs: earlyAcceptElapsedMs,
        candidates: earlyAccepted?.candidates.length,
      })}`,
    );
  }

  requests.length = 0;
  phases.length = 0;
  lanes.length = 0;
  let repairRequestCount = 0;
  globalThis.fetch = async (_input, init) => {
    requests.push(String(init?.body));
    const phase = new Headers(init?.headers).get("x-scene-planner-phase");
    const lane = new Headers(init?.headers).get("x-scene-planner-lane");
    if (phase === "plan") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "scene-document/v2",
          candidate: "needs-repair",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    repairRequestCount += 1;
    if (lane === "primary") {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "scene-document/v2",
          candidate: "repaired-primary",
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("cancelled slow repair alternate", "AbortError"));
      }, { once: true });
    });
  };
  const repairAcceptStartedAt = Date.now();
  const repairAccepted = await planSceneDocumentWithRepair(
    "accept a verified repair without waiting for its alternate",
    (candidate) => candidate.candidate === "repaired-primary"
      ? { valid: true, errors: [], value: candidate }
      : { valid: false, errors: [{ code: "repair_needed", message: "repair this", severity: "fatal" }] },
    { proxyUrl: "http://planner.test", timeoutMs: 4000 },
  );
  const repairAcceptElapsedMs = Date.now() - repairAcceptStartedAt;
  if (
    !repairAccepted?.validation.valid ||
    repairRequestCount !== 2 ||
    repairAcceptElapsedMs >= 2000
  ) {
    throw new Error(
      `verified repair waited for a slow alternate: ${JSON.stringify({
        elapsedMs: repairAcceptElapsedMs,
        repairRequestCount,
      })}`,
    );
  }

  requests.length = 0;
  let qualityCandidate = 0;
  globalThis.fetch = async () => {
    qualityCandidate += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        schemaVersion: "scene-document/v2",
        candidate: qualityCandidate === 1 ? "cluttered" : "minimal",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const qualitySelected = await planSceneDocumentWithRepair(
    "choose the cleaner valid scene",
    (candidate) => ({
      valid: true,
      errors: [],
      value: candidate,
      qualityScore: candidate.candidate === "minimal" ? 5 : 50,
    }),
    { proxyUrl: "http://planner.test", timeoutMs: 2000 },
  );
  if (qualitySelected?.response.document.candidate !== "minimal") {
    throw new Error("valid candidate selection ignored deterministic quality score");
  }

  requests.length = 0;
  let validityCandidate = 0;
  globalThis.fetch = async (_input, init) => {
    requests.push(String(init?.body));
    validityCandidate += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        schemaVersion: "scene-document/v2",
        candidate: validityCandidate === 1 ? "invalid-but-cheap" : "valid-with-warnings",
      }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const validitySelected = await planSceneDocumentWithRepair(
    "validity must outrank quality cost",
    (candidate) => candidate.candidate === "valid-with-warnings"
      ? {
          valid: true,
          errors: [
            { code: "approximation", message: "audited warning", severity: "warning" },
            { code: "approximation", message: "second audited warning", severity: "warning" },
          ],
          value: candidate,
          qualityScore: 5_000,
        }
      : {
          valid: false,
          errors: [{ code: "fatal_geometry", message: "invalid scene", severity: "fatal" }],
        },
    { proxyUrl: "http://planner.test", timeoutMs: 2000 },
  );
  if (validitySelected?.response.document.candidate !== "valid-with-warnings" || requests.length !== 2) {
    throw new Error("invalid candidate outranked a valid candidate with warning cost");
  }
  const initiallySelectedId = validitySelected.candidates.find((candidate) =>
    candidate.selected)?.candidateId;
  const authorityRevalidated = await revalidateScenePlanWithRepairResult(
    validitySelected,
    (candidate) => candidate.candidate === "invalid-but-cheap"
      ? { valid: true, errors: [], value: candidate, qualityScore: 1 }
      : {
          valid: false,
          errors: [{ code: "authority_mismatch", message: "stale candidate", severity: "fatal" }],
        },
  );
  const reselectedId = authorityRevalidated.candidates.find((candidate) =>
    candidate.selected)?.candidateId;
  if (
    !authorityRevalidated.validation.valid ||
    authorityRevalidated.response.document.candidate !== "invalid-but-cheap" ||
    reselectedId === initiallySelectedId ||
    authorityRevalidated.candidates.filter((candidate) => candidate.selected).length !== 1
  ) {
    throw new Error("final authority revalidation did not reselect the best candidate");
  }
  console.log("scene planner V2 verification passed");
} finally {
  globalThis.fetch = originalFetch;
}
