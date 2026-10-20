/** Synthetic prompt/transport regressions; no student text or provider calls. */
import assert from "node:assert/strict";
import { buildSceneDocumentPlannerPrompt } from "../../../../packages/tutor-core/src/planners/scenePlannerV2Prompt";
import { repairSceneDocument } from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import { scenePlannerRepairFeedback } from "../../../../packages/tutor-core/src/planners/scenePlannerRepairFeedback";
import { pruneDeadSceneEntities, validateSceneDocument } from "@heytutor/scene-engine";

const prompt = buildSceneDocumentPlannerPrompt("Explain a source-grounded diagram.");
assert.match(prompt, /pathCount[^\n]*source branch/i,
  "parallel pathCount must explain that the source branch is counted, not just the load branches");
assert.match(prompt, /direction cosines[^\n]*directed/i,
  "the universal compact request must preserve directed obtuse angle semantics");
assert.match(prompt, /plots:[^\n]*units\/ratios[^\n]*curves,bounds,points,proofs/i,
  "display-unit conversion must be consistent and explicitly labelled");
assert.match(prompt, /polytropic_process: \{[^\n]*pressureUnit,volumeUnit,pressureScale,volumeScale/,
  "a replacement process keeps its required units and scales even in a compact catalogue");
assert.match(prompt, /n=0 horizontal,n=1 isothermal/);
assert.match(prompt, /isochoric_process:[^\n]*vertical P-V/);
assert.match(prompt, /pathCount:\[terminal1,terminal2\]/, "path counts take terminal IDs, not one component ID");
const examplePrompt = buildSceneDocumentPlannerPrompt("Draw a source-grounded graph.", { workedExamples: [{
  id: "synthetic-points", depicts: "two endpoints", sourceKind: "synthesized", question: null,
  document: { schemaVersion: "scene-document/v2", entities: [], constructions: [{ id: "p_call", operator: "point", inputs: { x: 1, y: 2 }, outputs: ["p"] }] },
}] });
assert.match(examplePrompt, /non-executable[^\n]*point[^\n]*x,y/i, "coordinate-stripped examples must not teach bare point inputs");

async function verifyRepair(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const seed = {
    schemaVersion: "scene-document/v2",
    quantities: [],
    entities: [{ id: "plot_axes", kind: "axes" }],
    constructions: [{ id: "axes_call", operator: "axes", inputs: { xMin: 0, xMax: 8, yMin: 0, yMax: 0.004 }, outputs: ["plot_axes"] }],
    assertions: [{ id: "parallel_claim", predicate: "pathCount", entities: ["rail_a", "rail_b"], expected: 2, severity: "fatal" }],
    requiredEntityIds: ["plot_axes"],
  };
  const indexedClaim = { id: "value_claim", predicate: "function_value", entities: ["curve"], expected: { x: 2, y: 4 }, severity: "fatal" };
  const indexedSeed = { ...seed,
    assertions: [indexedClaim],
    constructions: [...seed.constructions, { id: "curve_call", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3 }, outputs: ["curve"] }],
  };
  const prunedSeed = { ...seed,
    visualDecision: { mode: "scene", reason: "synthetic error-index regression" }, source: { question: "Mark a graph value." },
    entities: [{ id: "p", kind: "point" }],
    constructions: [{ id: "point_call", operator: "point", inputs: { x: 1, y: 2 }, outputs: ["p"] }],
    assertions: [
      { id: "unused_warning", predicate: "on", entities: ["missing", "p"], expected: true, severity: "warning" },
      { ...indexedClaim, entities: ["p"] },
    ], requiredEntityIds: ["p"], relations: [], annotations: [], revealGroups: [], teachingTimeline: [],
  };
  const realValidation = validateSceneDocument(pruneDeadSceneEntities(prunedSeed));
  assert(realValidation.report.issues.some(issue => issue.code === "invalid_function_assertion" && issue.path === "assertions[0]"),
    "the real reader removes the preceding unconstructed warning before reporting indexes");
  const afterPruning = scenePlannerRepairFeedback(prunedSeed, realValidation.report.issues);
  assert.deepEqual(afterPruning.failedAssertions.map(claim => claim.id), [indexedClaim.id],
    "repair indexes must address the reader's pruned document, never an assertion removed before validation");
  assert(afterPruning.repairInputs.some(call => call.id === "point_call"));
  const anglePrunedSeed = { ...prunedSeed, entities: [...prunedSeed.entities, { id: "axes", kind: "axes" }],
    constructions: [...prunedSeed.constructions, { id: "axes_call", operator: "axes", inputs: { xMin: 0, xMax: 3, yMin: 0, yMax: 3 }, outputs: ["axes"] }],
    assertions: [{ id: "discarded_angle", predicate: "angle_between", entities: ["axes", "p"], expected: 90, severity: "fatal" }, prunedSeed.assertions[1]],
  };
  const normalizedIssues = validateSceneDocument(pruneDeadSceneEntities(anglePrunedSeed)).report.issues;
  assert(normalizedIssues.some(issue => issue.code === "invalid_function_assertion" && issue.path === "assertions[0]"));
  assert.deepEqual(scenePlannerRepairFeedback(anglePrunedSeed, normalizedIssues).failedAssertions.map(claim => claim.id), [indexedClaim.id],
    "error identity must survive assertion removal inside validation, not only pruning");
  const rectangleCall = { id: "make_slab", operator: "rectangle", inputs: { center: [0, 0], width: 4, height: 2.2 }, outputs: ["slab"] };
  const inlineSeed = { ...prunedSeed, entities: [{ id: "slab", kind: "rectangle" }], constructions: [rectangleCall], assertions: [], requiredEntityIds: ["slab"] };
  const inlineReader = pruneDeadSceneEntities(inlineSeed);
  assert.notDeepEqual(inlineReader.constructions, inlineSeed.constructions, "the real reader adds a center anchor to this inline input");
  const inlineFeedback = scenePlannerRepairFeedback(inlineSeed, [{ code: "construction_failed", message: "Failed construction", severity: "fatal", entityIds: ["slab"] }]);
  assert.deepEqual(inlineFeedback.repairInputs.find(call => call.id === rectangleCall.id)?.inputs, rectangleCall.inputs,
    "stable-ID mapping retains original inputs, not reader-added defaults or derived anchors");
  assert(!inlineFeedback.repairInputs.some(call => call.id === "construct_slab_center_anchor"));
  const holeSeed = { ...indexedSeed, assertions: [null, indexedClaim], constructions: [null, indexedSeed.constructions[1]] };
  const holeFeedback = scenePlannerRepairFeedback(holeSeed, [
    { code: "invalid_function_assertion", message: "Invalid function value", path: "assertions[1]", severity: "fatal" },
    { code: "invalid_function_samples", message: "Invalid samples", path: "constructions[1]", severity: "fatal" },
  ]);
  assert.deepEqual(holeFeedback.failedAssertions, [indexedClaim], "error paths refer to original indexes, even after malformed entries");
  assert(holeFeedback.repairInputs.some(call => call.id === "curve_call"), "construction paths also use original indexes");
  const scoped = scenePlannerRepairFeedback({ ...seed, assertions: [
    { ...indexedClaim, id: "a", entities: ["unrelated_segment"] },
    { ...indexedClaim, id: "target", entities: ["actual_angle"] },
  ] }, [{ code: "assertion_failed", message: "failed", entityIds: ["actual_angle"], severity: "fatal" }]);
  assert.deepEqual(scoped.failedAssertions.map(claim => claim.id), ["target"], "an ID substring in prose must not implicate unrelated claims");
  for (const message of ["Assertion target failed", "Assertion target: expected 2"]) for (const shared of [false, true]) {
    const named = scenePlannerRepairFeedback({ ...seed, assertions: [
      { ...indexedClaim, id: "first", entities: [shared ? "shared" : "unrelated"] },
      { ...indexedClaim, id: "target", entities: ["shared"] },
    ] }, [{ code: "assertion_failed", message, ...(shared ? { entityIds: ["shared"] } : {}), severity: "fatal" }]);
    assert.deepEqual(named.failedAssertions.map(claim => claim.id), ["target"], "an exact named assertion takes precedence over shared operands or unscoped fallback");
  }
  const caseSensitive = scenePlannerRepairFeedback({ ...seed, assertions: [
    { ...indexedClaim, id: "a", entities: ["shared"] }, { ...indexedClaim, id: "A", entities: ["shared"] },
  ] }, [{ code: "assertion_failed", message: "Assertion A: expected 2", severity: "fatal" }]);
  assert.deepEqual(caseSensitive.failedAssertions.map(claim => claim.id), ["A"], "assertion IDs are case-sensitive, even in plain feedback");
  const hugeSeed = { ...seed, assertions: [{ ...indexedClaim, expected: { extra: "x".repeat(40_000) }, entities: Array.from({ length: 3000 }, (_, i) => `operand_${i}`) }] };
  const originalHugeSeed = JSON.stringify(hugeSeed);
  const hugeFeedback = scenePlannerRepairFeedback(hugeSeed, [{ code: "assertion_failed", message: "Assertion value_claim failed", severity: "fatal", path: "assertions[0]" }]);
  assert(JSON.stringify(hugeFeedback).length < 4_500, "all new repair context, not just construction inputs, must be bounded");
  assert.match(JSON.stringify(hugeFeedback), /omitted/i, "oversized claims are explicitly omitted, never truncated into different facts");
  assert.equal(JSON.stringify(hugeSeed), originalHugeSeed, "diagnostic generation must not mutate candidates");
  const pointCalls = ["lt", "lb", "rt", "rb"].map((id, index) => ({ id: `make_${id}`, operator: "point", inputs: { x: index % 2, y: Math.floor(index / 2) }, outputs: [id] }));
  const edgeCalls = [
    { id: "battery_call", operator: "symbol", inputs: { symbol: "battery", start: "lt", end: "lb" }, outputs: ["source"] },
    { id: "top_call", operator: "connect", inputs: { start: "lt", end: "rt" }, outputs: ["top"] },
    { id: "bottom_call", operator: "connect", inputs: { start: "lb", end: "rb" }, outputs: ["bottom"] },
    { id: "load_a_call", operator: "symbol", inputs: { symbol: "resistor", start: "rt", end: "rb" }, outputs: ["load_a"] },
    { id: "load_b_call", operator: "symbol", inputs: { symbol: "resistor", start: "rt", end: "rb" }, outputs: ["load_b"] },
  ];
  const arrows = Array.from({ length: 12 }, (_, i) => ({ id: `current_call_${i}`, operator: "vector", inputs: { start: "lt", end: "lb" }, outputs: [`current_${i}`] }));
  const graphFeedback = scenePlannerRepairFeedback({ ...seed, assertions: [{ ...seed.assertions[0], entities: ["lt", "lb"] }], constructions: [...pointCalls, ...arrows, ...edgeCalls] },
    [{ code: "assertion_failed", message: "Assertion parallel_claim: expected 2", entityIds: ["lt", "lb"], severity: "fatal" }]);
  for (const call of edgeCalls) assert.deepEqual(graphFeedback.repairInputs.find(input => input.id === call.id)?.inputs, call.inputs,
    "repair must see incident component/wire endpoints, including loads reached through rails, not only the terminal points");
  assert.match(graphFeedback.guidance, /candidate-authored/);
  assert(!graphFeedback.repairInputs.some(call => call.operator === "vector"), "decorative current arrows must not consume topology context headroom");
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)).messages.at(-1).content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(seed) } }] }));
  };
  try {
    await repairSceneDocument("Explain a synthetic setup.", seed,
      [{ code: "assertion_failed", message: "parallel_claim failed", severity: "fatal", entityIds: ["rail_a", "rail_b"], expected: 2, actual: 3 }],
      { proxyUrl: "http://offline.invalid", constructionOperators: ["axes", "point", "symbol", "connect"] });
    await repairSceneDocument("Explain a synthetic graph.", indexedSeed,
      [{ code: "invalid_function_assertion", message: "function_value requires a sampled curve", path: "assertions[0]", severity: "fatal" }],
      { proxyUrl: "http://offline.invalid", constructionOperators: ["axes", "point", "function_curve"] });
    await repairSceneDocument("Explain a directed spatial angle.", { ...seed,
      assertions: [{ id: "angle_claim", predicate: "angle_between", entities: ["v", "positive_axis"], expected: { value: 120, unit: "degree" }, severity: "fatal" }],
      constructions: [{ id: "v_call", operator: "space_vector", inputs: { from: [0, 0, 0], to: [-1, 1, 0] }, outputs: ["v"] }],
    }, [{ code: "assertion_failed", message: "Assertion angle_claim failed", severity: "fatal" }],
    { proxyUrl: "http://offline.invalid", constructionOperators: ["space_vector", "space_line", "space_angle_mark"] });
    await repairSceneDocument("Explain a synthetic P-V process.", { ...seed,
      entities: [{ id: "constant_volume", kind: "segment", role: "isochor" }], assertions: [],
    }, [{ code: "duplicate_geometry", message: "Repeated path", severity: "fatal", entityIds: ["constant_volume"] }],
    { proxyUrl: "http://offline.invalid", constructionOperators: ["polytropic_process", "isochoric_process", "process_state"] });
  } finally { globalThis.fetch = originalFetch; }
  const repair = requests[0];
  assert(repair, "the real repair transport must dispatch to the fetch mock");
  const previous = JSON.parse(repair.split("PREVIOUS STRUCTURE\n")[1]!.split("\n\nSTRUCTURED VALIDATION ERRORS")[0]!);
  assert.deepEqual(previous.failedAssertions, seed.assertions,
    "a failed claim must retain its predicate, operands and expected value, not just an ID");
  assert.deepEqual(previous.repairInputs[0]?.inputs, seed.constructions[0]!.inputs,
    "repair must see the exact failing axis bounds, not only construction IDs");
  assert(repair.includes("parallel_claim") && repair.includes("Claim "), "plain repair feedback names the failing claim");
  assert(repair.includes("Axis plot_axes") && repair.includes("0.004"), "plain repair feedback names the collapsed axis and range");
  assert.match(repair, /authoritative[^\n]*expected|expected[^\n]*authoritative/i,
    "observed values never become an instruction to weaken authoritative expected values");
  const indexedPrevious = JSON.parse(requests[1]!.split("PREVIOUS STRUCTURE\n")[1]!.split("\n\nSTRUCTURED VALIDATION ERRORS")[0]!);
  assert.deepEqual(indexedPrevious.failedAssertions, [indexedClaim], "a path-only assertion index must retain its actual claim");
  assert(indexedPrevious.repairInputs.some((call: { id: string }) => call.id === "curve_call"), "indexed claim operands retain their producer inputs");
  assert.match(repair, /Correct a planner-authored total-path count[^\n]*required load-parallel proofs/,
    "extra model-authored counts can be corrected without dropping authoritative load proofs");
  assert.match(requests[2]!, /Direction cosine angles need directed space_vector[^\n]*undirected space_line[^\n]*acute/);
  assert.match(requests[2]!, /Claim angle_claim[^\n]*120/);
  assert.match(requests[3]!, /P-V paths:[^\n]*horizontal[^\n]*vertical[^\n]*intermediate state[^\n]*pressureUnit,volumeUnit,origin,pressureScale,volumeScale/);
}

void verifyRepair().then(() => console.log("scene planner failure contract passed (offline)"));
