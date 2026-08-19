import {
  auditTurnPlanV3,
  createFallbackTurnPlanV3,
  explicitDiagramRequest,
  planTurnV3,
  questionRequiresVisual,
  selectTurnPlanV3Consensus,
  TURN_PLAN_V3_PROMPT,
  TURN_PLAN_V3_PROMPT_BASELINE_CHARS,
  TURN_PLAN_V3_VISUAL_GROUNDING,
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
  const firstPlanRequestBody = capturedBody;

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

  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: "Find the area of a circle of radius 2 cm.",
      givens: { r: "2 cm" },
      unknowns: { area: "area" },
      derived: { area: "4*pi cm^2" },
      qualitativeClaims: [],
      lawIds: ["area-formula"],
      assumptions: [],
      visualRequirement: "optional",
    }) } }],
  }), { status: 200 });
  const symbolicResultPlan = await planTurnV3(
    "Find the area of a circle of radius 2 cm.",
    { proxyUrl: "http://planner.test", timeoutMs: 1000 },
  );
  if (!symbolicResultPlan) {
    throw new Error("symbolic planner result was not normalized into a valid plan");
  }
  if (Math.abs((symbolicResultPlan.turnPlan.derived[0]?.value ?? 0) - 4 * Math.PI) > 1e-9) {
    throw new Error(`symbolic planner value was truncated instead of evaluated: ${JSON.stringify(symbolicResultPlan.turnPlan.derived)}`);
  }

  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: "Find the result.",
      givens: {},
      unknowns: { answer: "answer" },
      derived: { answer: "4*x" },
      qualitativeClaims: [],
      lawIds: [],
      assumptions: [],
      visualRequirement: "optional",
    }) } }],
  }), { status: 200 });
  const freeVariableResultPlan = await planTurnV3(
    "Find the result.",
    { proxyUrl: "http://planner.test", timeoutMs: 1000 },
  );
  if (freeVariableResultPlan?.turnPlan.derived.some((quantity) => quantity.value === 0)) {
    throw new Error(`free-variable planner value was evaluated authoritatively at x=0: ${JSON.stringify(freeVariableResultPlan.turnPlan.derived)}`);
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
  // Figure reference without an explicit draw verb still requires a diagram.
  if (!questionRequiresVisual("Two blocks are connected by a wire over a smooth pulley as shown in the figure. Find the acceleration.")) {
    throw new Error("an explicit figure reference was not detected");
  }
  // Conic-section geometry is inherently a figure even with no figure keyword.
  if (!questionRequiresVisual("Let P be the parabola whose focus is (-2, 1) and directrix is 2x + y + 2 = 0.")) {
    throw new Error("conic-section geometry was not detected");
  }
  // A qualitative concept question mentioning a circuit stays text-only.
  if (questionRequiresVisual("Which of the following statements is true about the electromagnetic wave in a circuit?")) {
    throw new Error("a qualitative concept question was force-marked as requiring a visual");
  }
  const fallback = createFallbackTurnPlanV3("Draw a ray diagram");
  if (fallback.visualRequirement !== "required" || fallback.assumptions.length === 0) {
    throw new Error("conservative fallback plan is not auditable");
  }

  if (TURN_PLAN_V3_VISUAL_GROUNDING.length > 120) {
    throw new Error(`visualRequirement grounding line is too long: ${TURN_PLAN_V3_VISUAL_GROUNDING.length}`);
  }
  if (TURN_PLAN_V3_PROMPT.length > TURN_PLAN_V3_PROMPT_BASELINE_CHARS + 150) {
    throw new Error(
      `TurnPlanV3 prompt grew too much: ${TURN_PLAN_V3_PROMPT.length} vs baseline ${TURN_PLAN_V3_PROMPT_BASELINE_CHARS}`,
    );
  }
  if (!TURN_PLAN_V3_PROMPT.includes(TURN_PLAN_V3_VISUAL_GROUNDING)) {
    throw new Error("TurnPlanV3 prompt omitted the visualRequirement grounding line");
  }
  if (
    !TURN_PLAN_V3_PROMPT.includes('"required"') ||
    !TURN_PLAN_V3_PROMPT.includes('"optional"') ||
    !TURN_PLAN_V3_PROMPT.includes('"none"')
  ) {
    throw new Error("TurnPlanV3 prompt lost the required/optional/none rubric");
  }
  const firstRequest = JSON.parse(firstPlanRequestBody) as { messages?: Array<{ content?: string }> };
  if (!firstRequest.messages?.[0]?.content?.includes(TURN_PLAN_V3_VISUAL_GROUNDING)) {
    throw new Error("live plan request did not send the visualRequirement grounding line");
  }

  const bareNounStem =
    "Two point charges +q and -q rest 2 cm apart. The force on +q equals what value?";
  if (questionRequiresVisual(bareNounStem)) {
    throw new Error("bare-noun spatial stem was force-marked required by the pre-filter");
  }

  const planBareNoun = async (visualRequirement: "required" | "optional") => {
    globalThis.fetch = async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "turn-plan/v3",
          question: bareNounStem,
          givens: [{ id: "q", symbol: "q", value: 1e-6, unit: "C", provenance: "given" }],
          unknowns: [{ id: "f", symbol: "F", unit: "N" }],
          derived: [{
            id: "f",
            symbol: "F",
            value: 9,
            unit: "N",
            provenance: "derived",
            sourceText: "F = 9 N",
          }],
          qualitativeClaims: [{ id: "opposite", claim: "charges_opposite", expected: true }],
          lawIds: ["coulomb"],
          assumptions: [],
          visualRequirement,
        }) } }],
      }), { status: 200 });
    };
    return planTurnV3(bareNounStem, { proxyUrl: "http://planner.test", timeoutMs: 1000 });
  };

  const requiredBare = await planBareNoun("required");
  if (!requiredBare || requiredBare.turnPlan.visualRequirement !== "required") {
    throw new Error("LLM visualRequirement=required on a bare-noun spatial stem was not retained");
  }
  const optionalBare = await planBareNoun("optional");
  if (!optionalBare || optionalBare.turnPlan.visualRequirement !== "optional") {
    throw new Error("pre-filter force-upgraded a bare-noun stem the model marked optional");
  }

  const qualitativeStem = "Which of the following statements is true about the electromagnetic wave in a circuit?";
  if (questionRequiresVisual(qualitativeStem)) {
    throw new Error("a qualitative concept question was force-marked as requiring a visual");
  }
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      schemaVersion: "turn-plan/v3",
      question: qualitativeStem,
      givens: [],
      unknowns: [],
      derived: [],
      qualitativeClaims: [{ id: "concept", claim: "wave_is_transverse", expected: true }],
      lawIds: [],
      assumptions: [],
      visualRequirement: "optional",
    }) } }],
  }), { status: 200 });
  const qualitativePlan = await planTurnV3(qualitativeStem, { proxyUrl: "http://planner.test", timeoutMs: 1000 });
  if (!qualitativePlan || qualitativePlan.turnPlan.visualRequirement !== "optional") {
    throw new Error("qualitative stem did not remain visualRequirement=optional");
  }

  console.log("turn planner V3 verification passed");
} finally {
  globalThis.fetch = originalFetch;
}
