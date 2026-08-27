import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  auditTurnPlanV3,
  planAndSolveProblemV1,
  planSceneDocumentWithRepair,
  planTurnV3,
  revalidateScenePlanWithRepairResult,
  selectTurnPlanV3Consensus,
  inferSceneCapabilities,
} from "@heytutor/tutor-core";
import {
  compileSceneDocument,
  normalizeClaimedClosedRouteGeometry,
  normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities,
  pruneUnverifiedSceneAnnotations,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  reconcileTurnPlanWithSolver,
} from "@heytutor/scene-engine";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  throw new Error("Usage: node scripts/live/verify-live-diagram-v3.mjs <question>");
}

const origin = process.env.TUTOR_ORIGIN ?? "http://localhost:3000";
const turnPlanBudgetMs = 20_000;
const problemAuthorityBudgetMs = 18_000;
const home = await fetch(`${origin}/`);
const cookie = (home.headers.get("set-cookie") ?? "").split(";", 1)[0];
if (!cookie) throw new Error("Tutor did not issue an anonymous session cookie");

const proxy = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const headers = { "content-type": "application/json", cookie };
    for (const name of [
      "x-planner",
      "x-turn-planner-version",
      "x-turn-plan-phase",
      "x-turn-planner-lane",
      "x-scene-planner-version",
      "x-scene-planner-phase",
      "x-scene-planner-lane",
      "x-planner-deadline-ms",
      "x-session-id",
    ]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
    });
    response.statusCode = upstream.status;
    for (const name of ["content-type", "x-heytutor-trace-id"]) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});

await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const address = proxy.address();
if (!address || typeof address === "string") throw new Error("Unable to start planner proxy");
const proxyUrl = `http://127.0.0.1:${address.port}/api/chat`;
const startedAt = Date.now();

try {
  const planned = await planTurnV3(question, { proxyUrl, timeoutMs: turnPlanBudgetMs });
  if (!planned) throw new Error("Live turn plan failed");
  const authorityPromise = planAndSolveProblemV1(question, planned.turnPlan, {
    proxyUrl,
    timeoutMs: problemAuthorityBudgetMs,
  });
  const auditRemainingMs = Math.max(1, turnPlanBudgetMs - (Date.now() - startedAt));
  const audited = await auditTurnPlanV3(question, planned.turnPlan, {
    proxyUrl,
    timeoutMs: auditRemainingMs,
  });
  let turnPlan = selectTurnPlanV3Consensus(
    audited?.turnPlan,
    planned.turnPlan,
    planned.peerTurnPlans,
  ) ?? selectCompleteTurnPlan(audited?.turnPlan, planned.turnPlan);
  const planningTurnPlan = turnPlan;
  const sceneCapabilities = inferSceneCapabilities(question, {
    lawIds: planningTurnPlan.lawIds,
    turnPlan: planningTurnPlan,
  });

  const validateAgainstPlan = (candidate, authoritativePlan) => {
    let validated = validateSceneDocument(pruneDeadSceneEntities(candidate));
    if (!validated.document) return { valid: false, errors: validated.report.issues };

    const routeNormalized = normalizeClaimedClosedRouteGeometry(
      validated.document,
      authoritativePlan,
    );
    const constraintNormalized = normalizeClaimedParaxialReflectionGeometry(
      routeNormalized,
      authoritativePlan,
    );
    if (constraintNormalized !== validated.document) {
      validated = validateSceneDocument(pruneDeadSceneEntities(constraintNormalized));
      if (!validated.document) return { valid: false, errors: validated.report.issues };
    }

    const annotationPruned = pruneUnverifiedSceneAnnotations(validated.document, authoritativePlan);
    if (annotationPruned !== validated.document) {
      validated = validateSceneDocument(pruneDeadSceneEntities(annotationPruned));
      if (!validated.document) return { valid: false, errors: validated.report.issues };
    }

    const displayedTexts = [
      ...validated.document.entities.map((entity) => entity.label),
      ...validated.document.annotations.map((annotation) => annotation.text),
    ].filter((value) => typeof value === "string");
    const agreement = validateSceneQuantityAgreement(
      validated.document.quantities,
      authoritativePlan,
      displayedTexts,
    );
    const proofs = validateTurnPlanSceneProofs(validated.document, authoritativePlan);
    const compiled = compileSceneDocument(validated.document);
    const fatalIssues = [
      ...agreement.map((issue) => ({ ...issue, severity: "fatal" })),
      ...proofs,
      ...compiled.report.issues,
    ].filter((issue) => issue.severity === "fatal");
    if (fatalIssues.length > 0 || !compiled.ok || !compiled.renderScene) {
      return {
        valid: false,
        errors: fatalIssues.length > 0 ? fatalIssues : compiled.report.issues,
      };
    }
    return {
      valid: true,
      errors: compiled.report.issues,
      qualityScore:
        compiled.report.issues.filter((issue) => issue.severity === "warning").length * 1_000 +
        compiled.report.stats.primitiveCount,
      value: {
        document: validated.document,
        renderScene: compiled.renderScene,
        report: compiled.report,
      },
    };
  };
  const validate = (candidate) => validateAgainstPlan(candidate, planningTurnPlan);

  const remainingMs = Math.max(1, 60_000 - (Date.now() - startedAt));
  const scenePromise = planSceneDocumentWithRepair(question, validate, {
    proxyUrl,
    timeoutMs: remainingMs,
    conversationContext: `AUTHORITATIVE TURN PLAN V3\n${JSON.stringify(planningTurnPlan)}\nDo not contradict these quantities or claims.`,
    ...(sceneCapabilities.families.length > 0
      ? {
          constructionOperators: sceneCapabilities.constructionOperators,
          proofPredicates: sceneCapabilities.proofPredicates,
          planningGuidance: sceneCapabilities.planningGuidance,
        }
      : {}),
  });
  const authority = await authorityPromise;
  if (authority) {
    turnPlan = reconcileTurnPlanWithSolver(
      turnPlan,
      authority.problemIR,
      authority.solverResult,
    );
  }
  const initialResult = await scenePromise;
  const result = initialResult
    ? await revalidateScenePlanWithRepairResult(
        initialResult,
        (candidate) => validateAgainstPlan(candidate, turnPlan),
      )
    : null;
  const dumpDirectory = process.env.LIVE_DIAGRAM_DUMP_DIR?.trim();
  if (dumpDirectory) {
    mkdirSync(dumpDirectory, { recursive: true });
    writeFileSync(
      `${dumpDirectory}/turn-plan.json`,
      `${JSON.stringify({
        selected: turnPlan,
        audited: audited?.turnPlan ?? null,
        planned: planned.turnPlan,
        peers: planned.peerTurnPlans ?? [],
      }, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify({
    phase: "audited-turn-plan",
    elapsedMs: Date.now() - startedAt,
    solverAuthority: authority?.audit.status ?? "unavailable",
    derived: turnPlan.derived.map(({ id, value, unit }) => ({ id, value, unit })),
    claims: turnPlan.qualitativeClaims.map(({ id, expected }) => ({ id, expected })),
  }));
  if (dumpDirectory && result) {
    mkdirSync(dumpDirectory, { recursive: true });
    result.candidates.forEach((candidate, index) => {
      writeFileSync(
        `${dumpDirectory}/candidate-${index + 1}-${candidate.response.phase}-${candidate.response.lane}.json`,
        `${JSON.stringify(candidate.response.document, null, 2)}\n`,
      );
    });
  }
  const summary = {
    phase: "scene",
    elapsedMs: Date.now() - startedAt,
    ready: result?.validation.valid ?? false,
    repaired: result?.repaired ?? false,
    candidates: result?.candidates.map((candidate) => ({
      id: candidate.candidateId,
      phase: candidate.response.phase,
      lane: candidate.response.lane,
      valid: candidate.validation.valid,
      errors: candidate.validation.errors.map((error) => error.code),
      errorDetails: candidate.validation.errors.map((error) => ({
        code: error.code,
        message: error.message,
        entityIds: error.entityIds,
        residual: error.residual,
      })),
    })) ?? [],
    primitives: result?.validation.value?.report.stats.primitiveCount ?? 0,
    selectedIssues: result?.validation.errors.map((error) => error.code) ?? ["no_result"],
  };
  console.log(JSON.stringify(summary));
  if (!summary.ready) process.exitCode = 2;
} finally {
  await new Promise((resolve) => proxy.close(resolve));
}

function selectCompleteTurnPlan(audited, planned) {
  if (!audited) return planned;
  return requestedUnknownCoverage(audited) < requestedUnknownCoverage(planned)
    ? planned
    : audited;
}

function requestedUnknownCoverage(plan) {
  if (!Array.isArray(plan?.unknowns) || !Array.isArray(plan?.derived)) return 0;
  const derivedKeys = plan.derived.flatMap((quantity) => {
    if (typeof quantity?.value !== "number" || !Number.isFinite(quantity.value)) return [];
    return [quantity.id, quantity.symbol]
      .filter((value) => typeof value === "string")
      .map(normalizeQuantityKey);
  });
  return plan.unknowns.filter((unknown) =>
    [unknown?.id, unknown?.symbol]
      .filter((value) => typeof value === "string")
      .map(normalizeQuantityKey)
      .some((key) => derivedKeys.includes(key))
  ).length;
}

function normalizeQuantityKey(value) {
  return value
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(?:computed|calculated|calculation|calc|result|answer|value|val)$/, "");
}
