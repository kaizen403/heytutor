import assert from "node:assert/strict";
import {
  planSceneDocumentWithRepair,
  revalidateScenePlanWithRepairResult,
  type SceneCandidateValidation,
  type ScenePlannerResponse,
} from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import {
  createPlannerEvidence,
  recordRejectedOperatorCalls,
} from "../lecture-lab/plannerEvidence";

async function main() {
  const errors: SceneCandidateValidation["errors"] = [
    {
      code: "linear_source_mismatch",
      severity: "fatal",
      message:
        "Constraint 2 has a different strict boundary from the authoritative source.",
      path: "constructions[0].inputs.constraints[1]",
      entityIds: ["region"],
    },
    {
      code: "display_label_collision",
      severity: "warning",
      message: "The source constraint label intersects the axis title.",
      path: "entities[0]",
      entityIds: ["region", "axis"],
    },
  ];
  const document = {
    constructions: [
      {
        id: "build",
        operator: "linear_feasible_region",
        outputs: ["region"],
        inputs: {
          variables: ["x", "y"],
          constraints: ["x >= 0", "2x + y <= 11"],
        },
      },
      {
        id: "anchor",
        operator: "point",
        outputs: ["axis"],
        inputs: { x: 0, y: 0 },
      },
    ],
  };
  const response: ScenePlannerResponse = {
    document,
    rawContent: JSON.stringify(document),
    phase: "plan",
    lane: "primary",
    elapsedMs: 1,
  };
  const evidence = createPlannerEvidence();
  recordRejectedOperatorCalls(
    evidence,
    response,
    { valid: false, errors },
    "initial",
  );
  assert.equal(
    evidence.candidateRejections.length,
    1,
    "retain candidate validation independently of representation fallback",
  );
  assert.deepEqual(
    evidence.candidateRejections[0]?.errors,
    errors,
    "preserve messages, severity, path and entity IDs",
  );
  assert.equal(evidence.rejectedOperatorCalls[0]?.validationRecordIndex, 0);
  assert.deepEqual(evidence.rejectedOperatorCalls[0]?.errorIndices, [0, 1]);
  assert.deepEqual(evidence.rejectedOperatorCalls[1]?.errorIndices, [1]);
  recordRejectedOperatorCalls(
    evidence,
    { ...response, phase: "repair", lane: "alternate" },
    {
      valid: false,
      errors: [
        {
          ...errors[0]!,
          message: "A repaired candidate changed the source domain.",
        },
      ],
    },
    "authority_revalidation",
  );
  assert.equal(
    evidence.candidateRejections.length,
    2,
    "revalidation appends, never overwrites initial evidence",
  );
  assert.equal(
    evidence.candidateRejections[1]?.validationPass,
    "authority_revalidation",
  );
  assert.equal(evidence.candidateRejections[1]?.phase, "repair");
  recordRejectedOperatorCalls(
    evidence,
    { ...response, rawContent: "not JSON" },
    { valid: false, errors },
    "initial",
  );
  assert.equal(
    evidence.candidateRejections.length,
    3,
    "rejected malformed programs still retain validation diagnostics",
  );

  const bounded = createPlannerEvidence();
  recordRejectedOperatorCalls(
    bounded,
    response,
    {
      valid: false,
      errors: Array.from({ length: 200 }, (_, index) => ({
        code: `issue_${index}`,
        severity: "fatal" as const,
        message: "🙂".repeat(900),
        path: "p".repeat(900),
        entityIds: Array.from({ length: 200 }, () => "q".repeat(500)),
        details: { authorization: "DO_NOT_SERIALIZE_PROVIDER_DETAILS" },
      })),
    },
    "initial",
  );
  const retained = bounded.candidateRejections[0]!;
  assert.equal(retained.issueCount, 200);
  assert.equal(retained.errors.length + retained.omittedIssueCount, 200);
  assert.ok(
    retained.omittedIssueCount > 0,
    "bounded omission must be explicit",
  );
  assert.ok(retained.errors[0]?.truncated?.messageBytes);
  assert.ok(retained.errors[0]?.truncated?.omittedEntityIds);
  assert.ok(
    !JSON.stringify(bounded).includes("DO_NOT_SERIALIZE_PROVIDER_DETAILS"),
    "retain a safe field whitelist, not provider objects",
  );
  assert.ok(
    !retained.errors[0]?.message.includes("�"),
    "UTF-8 truncation keeps whole characters",
  );
  for (let index = 0; index < 200; index++)
    recordRejectedOperatorCalls(
      bounded,
      response,
      { valid: false, errors },
      "initial",
    );
  assert.ok(bounded.rejectionEvidenceTruncation.candidateRecords > 0);
  assert.equal(
    bounded.rejectionEvidenceTruncation.candidateIssues,
    bounded.rejectionEvidenceTruncation.candidateRecords * errors.length,
    "issues belonging to omitted candidate records are explicitly counted",
  );
  assert.ok(bounded.rejectionEvidenceTruncation.operatorRecords > 0);
  assert.ok(
    Buffer.byteLength(JSON.stringify(bounded), "utf8") < 2_000_000,
    "all evidence remains bounded",
  );

  const originalFetch = globalThis.fetch;
  const observed = createPlannerEvidence();
  let requests = 0;
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ ...document, repaired: ++requests > 2 }),
          },
        },
      ],
    });
  try {
    const result = await planSceneDocumentWithRepair(
      "source diagnostics fixture",
      (candidate) => ({
        valid: candidate.repaired === true,
        errors: candidate.repaired === true ? [] : errors,
      }),
      {
        proxyUrl: "http://diagnostics.test",
        timeoutMs: 1000,
        onCandidateValidation: (candidate, validation) =>
          recordRejectedOperatorCalls(
            observed,
            candidate,
            validation,
            "initial",
          ),
      },
    );
    assert.ok(result?.validation.valid);
    assert.equal(
      observed.candidateRejections.length,
      2,
      "retain both rejected initial lanes even when repair is selected",
    );
    await revalidateScenePlanWithRepairResult(
      result,
      () => ({ valid: false, errors }),
      (candidate, validation) =>
        recordRejectedOperatorCalls(
          observed,
          candidate,
          validation,
          "authority_revalidation",
        ),
    );
    assert.equal(
      observed.candidateRejections.length,
      2 + result.candidates.length,
    );
    assert.ok(
      observed.candidateRejections
        .slice(2)
        .every(
          (candidate) => candidate.validationPass === "authority_revalidation",
        ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    "scene rejection evidence: complete candidate/operator diagnostics survive selection, repair and revalidation; bounded with explicit omissions; zero model calls",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
