import assert from "node:assert/strict";
import {
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
} from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import {
  createPlannerEvidence,
  recordPlannerResponse,
  recordRejectedOperatorCalls,
} from "../lecture-lab/plannerEvidence";

const evidence = createPlannerEvidence();
assert.deepEqual(
  { ...evidence },
  {
    plannerDeclineReason: null,
    plannerDeclines: [],
    rejectedOperatorCalls: [],
  },
);
const raw = {
  schemaVersion: "scene-document/v2",
  visualDecision: {
    mode: "text_only",
    reason: "No symbolic geometry contract.",
  },
  constructions: [
    {
      id: "kit",
      operator: "chem_skeletal_molecule",
      inputs: { molecules: [{ name: "unresolved" }], note: "🧪".repeat(800) },
      outputs: ["molecule"],
    },
    { id: "point", operator: "point", inputs: { x: 1, y: 2 }, outputs: ["p"] },
  ],
};
const response = {
  document: { ...raw, constructions: [] },
  rawContent: JSON.stringify(raw),
  phase: "plan" as const,
  lane: "primary" as const,
  elapsedMs: 1,
};
const prefixed = createPlannerEvidence();
const prefixedResponse = {
  ...response,
  rawContent: `Here is the scene:\n${JSON.stringify(raw)}\nEnd of scene.`,
};
recordPlannerResponse(prefixed, prefixedResponse);
recordRejectedOperatorCalls(
  prefixed,
  prefixedResponse,
  { valid: false, errors: [] },
  "initial",
);
assert.equal(
  prefixed.plannerDeclineReason,
  raw.visualDecision.reason,
  "accepted JSON-envelope extraction retains stated reasons",
);
assert.equal(
  prefixed.rejectedOperatorCalls.length,
  2,
  "accepted prefixed envelopes retain original calls",
);
recordPlannerResponse(evidence, response);
assert.equal(evidence.plannerDeclines[0]?.reason, raw.visualDecision.reason);
recordRejectedOperatorCalls(
  evidence,
  response,
  {
    valid: false,
    errors: [
      {
        code: "invalid_chemistry_kit_input",
        message: "bad kit",
        severity: "fatal",
        path: "constructions[0].inputs",
      },
    ],
  },
  "initial",
);
assert.equal(
  evidence.rejectedOperatorCalls.length,
  2,
  "keep every call from the atomically rejected candidate",
);
const [kit, point] = evidence.rejectedOperatorCalls;
assert.equal(
  kit?.operator,
  "chem_skeletal_molecule",
  "original raw program, not normalized document",
);
assert.equal(kit?.attribution, "reported_path_or_entity");
assert.deepEqual(kit?.errorPaths, ["constructions[0].inputs"]);
assert.ok(kit?.rawArguments.includes("unresolved"));
assert.ok(kit?.truncated);
assert.ok(Buffer.byteLength(kit!.rawArguments, "utf8") <= 2048);
assert.ok(!kit?.rawArguments.includes("�"), "do not split a UTF-8 character");
assert.equal(
  point?.attribution,
  "candidate_rejected",
  "do not falsely blame a successful suboperator",
);
recordRejectedOperatorCalls(
  evidence,
  response,
  { valid: true, errors: [] },
  "initial",
);
assert.equal(
  evidence.rejectedOperatorCalls.length,
  2,
  "accepted candidates have no rejection evidence",
);
recordPlannerResponse(evidence, { ...response, rawContent: "invalid json" });
assert.equal(
  evidence.plannerDeclines.length,
  1,
  "malformed JSON never becomes an invented decline",
);
const boundaries = createPlannerEvidence();
const oversizedReason = "🧪".repeat(513);
recordPlannerResponse(boundaries, {
  ...response,
  rawContent: JSON.stringify({
    visualDecision: { mode: "text_only", reason: oversizedReason },
  }),
});
assert.equal(boundaries.plannerDeclineReason, "🧪".repeat(512));
assert.equal(boundaries.plannerDeclines[0]?.reasonBytes, 2052);
assert.equal(boundaries.plannerDeclines[0]?.truncated, true);
recordRejectedOperatorCalls(
  boundaries,
  {
    ...response,
    phase: "repair",
    rawContent: JSON.stringify({
      constructions: [
        { operator: "kit", inputs: "x".repeat(2046) },
        { operator: "point" },
      ],
    }),
  },
  { valid: false, errors: [] },
  "authority_revalidation",
);
assert.equal(
  Buffer.byteLength(boundaries.rejectedOperatorCalls[0]!.rawArguments, "utf8"),
  2048,
);
assert.equal(
  boundaries.rejectedOperatorCalls[0]?.truncated,
  false,
  "exactly 2 KiB needs no truncation",
);
assert.equal(
  boundaries.rejectedOperatorCalls[0]?.validationPass,
  "authority_revalidation",
);
assert.equal(boundaries.rejectedOperatorCalls[0]?.phase, "repair");
assert.equal(
  boundaries.rejectedOperatorCalls[1]?.argumentsPresent,
  false,
  "missing inputs are not confused with explicit null",
);

async function verifyObservers() {
  const originalFetch = globalThis.fetch;
  let observed = 0;
  let validated = 0;
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(raw) } }],
      });
    const result = await planSceneDocumentWithRepair(
      "fixture",
      () => ({ valid: true, errors: [] }),
      {
        proxyUrl: "http://evidence.test",
        timeoutMs: 50,
        onResponse: () => {
          observed++;
        },
        onCandidateValidation: () => {
          validated++;
        },
      },
    );
    assert.ok(result);
    assert.equal(observed, 2, "every parsed response reaches the observer");
    assert.equal(
      validated,
      2,
      "every evaluated response reaches the validation observer",
    );
    let revalidated = 0;
    await revalidateScenePlanWithRepairResult(
      result,
      () => ({ valid: false, errors: [] }),
      () => {
        revalidated++;
      },
    );
    assert.equal(revalidated, result.candidates.length);
    let releaseHeld!: (value: boolean) => void;
    let heldResponses = 0;
    const discarded = await planSceneDocumentWithRepair(
      "fixture",
      () => {
        throw new Error("discarded search must not validate");
      },
      {
        proxyUrl: "http://evidence.test",
        timeoutMs: 100,
        holdValidationUntil: new Promise<boolean>((resolve) => {
          releaseHeld = resolve;
        }),
        onResponse: () => {
          if (++heldResponses === 2) releaseHeld(false);
        },
      },
    );
    assert.equal(discarded, null);
    assert.equal(
      heldResponses,
      2,
      "discarding speculation does not discard its stated reasons",
    );
    const unaffected = await planSceneDocumentWithRepair(
      "fixture",
      () => ({ valid: true, errors: [] }),
      {
        proxyUrl: "http://evidence.test",
        timeoutMs: 50,
        onResponse: () => {
          throw new Error("observer failed");
        },
        onCandidateValidation: () => {
          throw new Error("observer failed");
        },
      },
    );
    assert.equal(
      unaffected?.validation.valid,
      true,
      "diagnostics cannot change authority/selection",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    "planner evidence verification passed (mocked, zero model calls)",
  );
}
void verifyObservers().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
