import { createHash } from "node:crypto";
import type { ProblemAuthorityV1Response } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

type SafeJson = null | boolean | number | string | SafeJson[] | { [key: string]: SafeJson };
type Shape = true | { [key: string]: Shape };
const MAX_ARRAY_ITEMS = 64;
const MAX_TREE_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_TRUNCATION_RECORDS = 64;

export interface SolverEvidenceTruncation {
  omittedArrayItems: number;
  shortenedStringFields: number;
  depthLimitedFields: number;
  nodeLimitedFields: number;
  unsupportedValueFields: number;
  omittedDetailRecords: number;
  details: Array<{
    path: string;
    kind: "array" | "string" | "depth" | "nodes" | "unsupported";
    originalCount?: number;
    retainedCount?: number;
    originalBytes?: number;
    retainedBytes?: number;
  }>;
}

export interface SolverEvidence {
  schemaVersion: "solver-evidence/v1";
  originalQuestionSha256: string;
  problemQuestionMatchesOriginal: boolean;
  audit: SafeJson;
  turnPlan: SafeJson;
  problemIR: SafeJson;
  solverResult: SafeJson;
  truncation: SolverEvidenceTruncation;
}

export interface RetainedSolverRecord {
  status: string;
  issueCodes: string[];
  hasProjection: boolean;
  projection: SafeJson;
  evidence: SolverEvidence;
}

const scalar: Shape = true;
const evidenceShape: Shape = { source: scalar, start: scalar, end: scalar, quote: scalar };
const expressionNodeShape: Exclude<Shape, true> = { kind: scalar, value: scalar, name: scalar, operator: scalar, function: scalar };
for (const field of ["left", "right", "operand", "argument"]) expressionNodeShape[field] = expressionNodeShape;
const expressionShape: Shape = { id: scalar, valueType: scalar, root: expressionNodeShape, evidenceFactIds: scalar };
const constraintShape: Shape = { id: scalar, kind: scalar, leftExpressionId: scalar, rightExpressionId: scalar, relation: scalar, entityIds: scalar, evidenceFactIds: scalar };
const intentShape: Shape = { id: scalar, kind: scalar, entityIds: scalar, evidenceFactIds: scalar };
const resultBindingShape: Shape = { turnPlanQuantityId: scalar, symbol: scalar, unit: scalar, evidenceFactIds: scalar };
const selectionShape: Shape = { kind: scalar, variable: scalar, equations: scalar, exact: scalar };
const exactShape: Shape = { kind: scalar, value: scalar };
const bindingShape: Shape = { requestId: scalar, quantityId: scalar, symbol: scalar, unit: scalar, approximate: scalar, exact: exactShape, errorBound: scalar, selection: selectionShape };
const auditIssueShape: Shape = { code: scalar, message: scalar, requestId: scalar, quantityId: scalar };
const auditShape: Shape = { status: scalar, issues: auditIssueShape, bindings: bindingShape };
const networkShape: Shape = {
  model: scalar, modelFactId: scalar, nodes: scalar, referenceNode: scalar, referenceFactId: scalar,
  branches: { id: scalar, kind: scalar, from: scalar, to: scalar, connectionConstraintId: scalar, lawFactId: scalar, quantityExpressionId: scalar, quantityFactId: scalar, unit: scalar },
};
const requestShape: Shape = {
  id: scalar, kind: scalar, expressionId: scalar, leftExpressionId: scalar, rightExpressionId: scalar,
  variable: scalar, domain: { min: scalar, max: scalar }, lower: scalar, upper: scalar,
  resultBinding: resultBindingShape, network: networkShape, output: { kind: scalar, id: scalar },
};
const problemShape: Shape = {
  schemaVersion: scalar, id: scalar, question: scalar,
  facts: { id: scalar, kind: scalar, statement: scalar, evidence: evidenceShape },
  entities: { id: scalar, kind: scalar, label: scalar, evidenceFactIds: scalar },
  expressions: expressionShape, constraints: constraintShape,
  representationIntents: intentShape, solveRequests: requestShape,
};
const quantityShape: Shape = { id: scalar, symbol: scalar, value: scalar, unit: scalar, sign: scalar, sourceText: scalar, provenance: scalar, dependsOn: scalar, uncertainty: scalar };
const planShape: Shape = {
  schemaVersion: scalar, question: scalar, visualRequirement: scalar, givens: quantityShape, unknowns: quantityShape, derived: quantityShape,
  qualitativeClaims: { id: scalar, claim: scalar, expected: scalar, relatedQuantityIds: scalar, relatedEntityHints: scalar },
  lawIds: scalar, assumptions: scalar, teachingSequenceHints: scalar,
};
const resultShape: Shape = {
  schemaVersion: scalar, problemId: scalar, providerId: scalar, status: scalar,
  values: { id: scalar, requestId: scalar, valueType: scalar, exact: exactShape, approximate: scalar, errorBound: scalar },
  proofs: { id: scalar, requestId: scalar, method: scalar, expressionIds: scalar, verified: scalar, residual: scalar, tolerance: scalar, detail: scalar },
  issues: { code: scalar, path: scalar, message: scalar, requestId: scalar },
};
const projectionShape: Shape = {
  schemaVersion: scalar, problemId: scalar, status: scalar, expressions: expressionShape, constraints: constraintShape,
  representationIntents: intentShape, bindings: bindingShape, solverProviderId: scalar,
};

function stringLimit(path: string): number {
  if (/\.question$/.test(path)) return 8192;
  if (/\.(?:message|detail|sourceText|quote|statement|claim|expected)$/.test(path)) return 2048;
  if (/\.(?:equations|assumptions|lawIds)\[\d+\]$/.test(path)) return 2048;
  return 128;
}

/** Whitelisted math data only: raw model content, transport/env/auth fields are never copied. */
export function retainSolverEvidence(
  authority: Pick<ProblemAuthorityV1Response, "audit" | "problemIR" | "solverResult" | "projection">,
  originalQuestion: string,
  turnPlan: TurnPlanV3,
): RetainedSolverRecord {
  const truncation: SolverEvidenceTruncation = {
    omittedArrayItems: 0, shortenedStringFields: 0, depthLimitedFields: 0, nodeLimitedFields: 0,
    unsupportedValueFields: 0, omittedDetailRecords: 0, details: [],
  };
  const detail = (entry: SolverEvidenceTruncation["details"][number]) => {
    if (truncation.details.length < MAX_TRUNCATION_RECORDS) truncation.details.push(entry);
    else truncation.omittedDetailRecords++;
  };
  let nodes = 0;
  const retain = (value: unknown, shape: Shape, path: string, depth = 0): SafeJson => {
    if (depth > MAX_DEPTH) {
      truncation.depthLimitedFields++; detail({ path, kind: "depth" }); return null;
    }
    if (++nodes > MAX_TREE_NODES) {
      truncation.nodeLimitedFields++; detail({ path, kind: "nodes" }); return null;
    }
    if (value === null) return null;
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        truncation.omittedArrayItems += value.length - MAX_ARRAY_ITEMS;
        detail({ path, kind: "array", originalCount: value.length, retainedCount: MAX_ARRAY_ITEMS });
      }
      return value.slice(0, MAX_ARRAY_ITEMS).map((item, index) => retain(item, shape, `${path}[${index}]`, depth + 1));
    }
    if (shape !== true && typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>, result: { [key: string]: SafeJson } = {};
      for (const [key, fieldShape] of Object.entries(shape)) if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
        result[key] = retain(record[key], fieldShape, `${path}.${key}`, depth + 1);
      }
      return result;
    }
    if (shape === true && typeof value === "string") {
      const bytes = Buffer.from(value, "utf8"), limit = stringLimit(path);
      let end = Math.min(limit, bytes.length);
      while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
      if (end < bytes.length) {
        truncation.shortenedStringFields++;
        detail({ path, kind: "string", originalBytes: bytes.length, retainedBytes: end });
      }
      return bytes.subarray(0, end).toString("utf8");
    }
    if (shape === true && (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) return value;
    truncation.unsupportedValueFields++; detail({ path, kind: "unsupported" }); return null;
  };
  const retainedCodes = retain(authority.audit.issues.map((issue) => issue.code), scalar, "issueCodes");
  const issueCodes = Array.isArray(retainedCodes) ? retainedCodes.filter((code): code is string => typeof code === "string") : [];
  const audit = retain(authority.audit, auditShape, "audit");
  const plan = retain(turnPlan, planShape, "turnPlan");
  const problem = retain(authority.problemIR, problemShape, "problemIR");
  const result = retain(authority.solverResult, resultShape, "solverResult");
  const projection = authority.projection ? retain(authority.projection, projectionShape, "projection") : null;
  // Summary fields preserve the actual authority verdict. Diagnostic caps
  // cannot turn a contradiction into an absent or verified second opinion.
  return {
    status: authority.audit.status,
    issueCodes,
    hasProjection: Boolean(authority.projection), projection,
    evidence: {
      schemaVersion: "solver-evidence/v1",
      originalQuestionSha256: createHash("sha256").update(originalQuestion, "utf8").digest("hex"),
      problemQuestionMatchesOriginal: authority.problemIR.question === originalQuestion,
      audit, turnPlan: plan, problemIR: problem, solverResult: result, truncation,
    },
  };
}
