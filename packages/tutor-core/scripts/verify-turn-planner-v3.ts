import {
  auditTurnPlanV3,
  createFallbackTurnPlanV3,
  explicitDiagramRequest,
  planTurnV3,
  questionRequiresVisual,
  selectTurnPlanV3Consensus,
} from "../src/turnPlannerV3";

const originalFetch = globalThis.fetch;
let capturedHeaders = new Headers();
let capturedBody = "";
const capturedPlanLanes: string[] = [];
const question = "Three resistors in series. Draw the circuit.";

globalThis.fetch = async (_input, init) => {
  capturedHeaders = new Headers(init?.headers);
  capturedBody = String(init?.body ?? "");
  if (capturedHeaders.get("x-turn-plan-phase") === "plan") {
    capturedPlanLanes.push(capturedHeaders.get("x-turn-planner-lane") ?? "");
  }
  const audited = capturedHeaders.get("x-turn-plan-phase") === "audit";
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: "Three resistors   in series. Draw the circuit.",
      givens: [{ id: "r", symbol: "R", value: 12, unit: "ohm", sign: "negative", provenance: "given" }],
      unknowns: [{ id: "req", symbol: "R_eq", unit: "ohm" }],
      derived: [{
        id: "req_value",
        symbol: "R_eq",
        value: audited ? 40 : 36,
        unit: "ohm",
        provenance: "derived",
        dependsOn: ["r", "req"],
        sourceText: audited
          ? "R_eq = 12 ohm + 12 ohm + 12 ohm = 36 ohm"
          : "R_eq = R1 + R2 + R3",
      }],
      qualitativeClaims: [{ id: "series", claim: "series_path", expected: true, relatedQuantityIds: ["req"] }],
      lawIds: ["series_resistance"],
      assumptions: audited ? ["independently audited"] : [{ id: "ideal", text: "ideal resistors" }],
      visualRequirement: "none",
    }) } }],
  }), { status: 200, headers: { "x-heytutor-trace-id": "turn-plan-trace" } });
};

try {
  const response = await planTurnV3(question, {
    proxyUrl: "http://planner.test",
    timeoutMs: 1000,
  });
  if (!response) throw new Error("turn planner did not return a valid plan");
  if (response.turnPlan.question !== question) throw new Error("runtime question did not remain authoritative");
  if (response.turnPlan.visualRequirement !== "required") throw new Error("explicit visual request was downgraded by the model");
  if (response.turnPlan.assumptions[0] !== "ideal resistors") throw new Error("planner assumption normalization failed");
  if (response.turnPlan.givens[0]?.sign !== undefined) throw new Error("directional sign contradicted a positive scalar magnitude");
  if (response.turnPlan.derived[0]?.id !== "req") throw new Error("requested unknown and derived result did not receive one canonical id");
  if (response.turnPlan.derived[0]?.dependsOn?.join(",") !== "r") throw new Error("invalid planner dependency was not normalized");
  if (!response.turnPlan.assumptions.some((item) => item.includes("invalid planner dependency"))) throw new Error("dependency normalization was not audited");
  if (!response.turnPlan.assumptions.some((item) => item.includes("directional sign"))) throw new Error("directional sign normalization was not audited");
  if (response.traceId !== "turn-plan-trace") throw new Error("turn planner trace was not captured");
  if (capturedHeaders.get("x-turn-planner-version") !== "3") throw new Error("turn planner header missing");
  if (capturedHeaders.get("x-planner-deadline-ms") !== "1000") throw new Error("turn planner deadline header missing");
  if (capturedPlanLanes.join(",") !== "primary,alternate") {
    throw new Error(`independent turn-plan lanes were not started: ${capturedPlanLanes.join(",")}`);
  }

  const audited = await auditTurnPlanV3(question, response.turnPlan, {
    proxyUrl: "http://planner.test",
    timeoutMs: 1000,
  });
  if (!audited || audited.turnPlan.assumptions[0] !== "independently audited") {
    throw new Error("turn-plan audit did not return a validated replacement plan");
  }
  if (audited.turnPlan.derived[0]?.value !== 36) {
    throw new Error("turn-plan audit did not reconcile a value from explicit verified arithmetic");
  }
  const wrongAudit = structuredClone(audited.turnPlan);
  wrongAudit.derived[0]!.value = 40;
  const agreeingPeer = structuredClone(response.turnPlan);
  if (
    selectTurnPlanV3Consensus(wrongAudit, response.turnPlan, [agreeingPeer]) !== response.turnPlan
  ) {
    throw new Error("two agreeing numerical plans did not outvote a disagreeing audit");
  }
  const missingGreekResult = structuredClone(response.turnPlan);
  missingGreekResult.unknowns = [{ id: "phi", symbol: "φ", unit: "degree" }];
  missingGreekResult.derived = [{
    id: "omega",
    symbol: "ω",
    value: 100,
    unit: "rad/s",
    provenance: "derived",
  }];
  const completeGreekResult = structuredClone(missingGreekResult);
  completeGreekResult.derived.push({
    id: "phi",
    symbol: "φ",
    value: 30,
    unit: "degree",
    provenance: "derived",
  });
  if (
    selectTurnPlanV3Consensus(null, missingGreekResult, [completeGreekResult]) !== completeGreekResult
  ) {
    throw new Error("an empty normalized Greek symbol falsely counted as requested-result coverage");
  }
  if (capturedHeaders.get("x-turn-plan-phase") !== "audit") throw new Error("turn-plan audit phase header missing");
  if (capturedHeaders.get("x-turn-planner-lane") !== "alternate") throw new Error("turn-plan audit was not independently sampled");
  if (!capturedBody.includes("CANDIDATE TURN PLAN")) throw new Error("turn-plan audit did not receive the candidate plan");

  // Fireworks occasionally compresses object-shaped fields despite the array contract.
  // This is the exact shape returned for a bounded-curves area question.
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: "A curve y = x^2 and the line y = 4 enclose a region. Sketch the region, then find its area using integration.",
      givens: {
        curve: "y = x^2 (upward parabola)",
        line: "y = 4 (horizontal line)",
      },
      unknowns: { area: "enclosed area" },
      derived: {
        intersection: "Solving x^2 = 4 gives x = -2 and x = 2",
        finalArea: "32/3 square units",
      },
      qualitativeClaims: [
        "The region is bounded above by y = 4 and below by y = x^2",
      ],
      lawIds: ["integral-area-between-curves"],
      assumptions: ["Standard Cartesian coordinate system"],
      visualRequirement: { description: "Sketch the bounded region first" },
    }) } }],
  }), { status: 200 });
  const compactCalculusPlan = await planTurnV3(
    "A curve y = x^2 and the line y = 4 enclose a region. Sketch the region, then find its area using integration.",
    { proxyUrl: "http://planner.test", timeoutMs: 1000 },
  );
  if (!compactCalculusPlan || compactCalculusPlan.turnPlan.visualRequirement !== "required") {
    throw new Error("object-shaped calculus plan was not normalized as a required visual");
  }
  const area = compactCalculusPlan.turnPlan.derived.find((quantity) =>
    quantity.id.toLowerCase().includes("area") || quantity.symbol.toLowerCase().includes("area"),
  );
  if (!area || Math.abs(area.value - 32 / 3) > 1e-9) {
    throw new Error(`object-shaped calculus result was not recovered: ${JSON.stringify(compactCalculusPlan.turnPlan.derived)}`);
  }

  let repairAttempt = 0;
  const repairLanes: string[] = [];
  globalThis.fetch = async (_input, init) => {
    repairAttempt += 1;
    repairLanes.push(new Headers(init?.headers).get("x-turn-planner-lane") ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        schemaVersion: "turn-plan/v3",
        question,
        givens: [],
        unknowns: [{ id: "a", symbol: "a", unit: "m/s^2" }],
        derived: [{
          id: "a_value",
          symbol: "a",
          value: repairAttempt === 1 ? null : 2,
          unit: "m/s^2",
          provenance: "derived",
          sourceText: repairAttempt === 1 ? "equation not solved" : "a = 4 / 2 = 2 m/s^2",
        }],
        qualitativeClaims: [],
        lawIds: ["newton-second-law"],
        assumptions: [],
        visualRequirement: "optional",
      }) } }],
    }), { status: 200 });
  };
  const repaired = await planTurnV3(question, {
    proxyUrl: "http://planner.test",
    timeoutMs: 1000,
  });
  if (!repaired || repaired.turnPlan.derived[0]?.value !== 2 || repairAttempt !== 2) {
    throw new Error("an invalid primary turn plan did not yield to the independent valid lane");
  }
  if (repairLanes.join(",") !== "primary,alternate") {
    throw new Error(`turn-plan retry did not switch model lanes: ${repairLanes.join(",")}`);
  }

  if (!explicitDiagramRequest("plot y = x squared")) throw new Error("explicit plot request was not detected");
  if (!questionRequiresVisual("Find the image formed by a concave mirror")) throw new Error("inherently spatial apparatus was not detected");
  const fallback = createFallbackTurnPlanV3("Draw a ray diagram");
  if (fallback.visualRequirement !== "required" || fallback.assumptions.length === 0) {
    throw new Error("conservative fallback plan is not auditable");
  }
  console.log("turn planner V3 verification passed");
} finally {
  globalThis.fetch = originalFetch;
}
