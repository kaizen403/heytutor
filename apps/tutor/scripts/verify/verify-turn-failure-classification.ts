import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { failedTurnWhere } from "../../lib/admin/turnFilters";
import { FAILED_TURN_STAGES } from "../../lib/obs/failedTurnTelemetry";
import { classifyOutcome } from "../../lib/admin/outcome";
import { Prisma } from "@prisma/client";
import { classifyTurnFailure, CONFIRMED_TURN_FAILURE_CODES, countEngineRefusal, PICTURE_ANSWERED_FAILURE_CODES, type TurnFailureInput } from "../../lib/obs/turnFailureClassification";

type Fixture = TurnFailureInput & { name: string; expected: "failed" | "healthy" | "unverified" | "pending" | "picture_shown" };
const narrative = [{ narration: "Synthetic teaching." }];
const continuation = { boardContinuation: { schemaVersion: "board-continuation/v1" } };
const none = { turnPlan: { visualRequirement: "none" } };
const picture = { referencePicture: { id: "rp_0123456789abcdef01234567" }, referencePictureOutcome: { attempted: true, status: "shown", reason: null, ms: 9_600, speculative: true } };
const fixtures: Fixture[] = [
  { name: "legacy verified placeholder-only turn", expected: "unverified", visualStatus: "validated", status: "complete", segments: [{ command: { type: "CLEAR" } }] },
  { name: "expected no figure", expected: "healthy", visualStatus: "text_only", status: "complete", sceneArtifacts: none, segments: narrative },
  { name: "healthy same-page continuation", expected: "healthy", visualStatus: "text_only", status: "complete", sceneArtifacts: continuation, segments: narrative },
  { name: "legacy missing artifacts", expected: "unverified", visualStatus: "legacy", status: "complete", segments: narrative },
  { name: "null legacy status", expected: "unverified", visualStatus: null, status: "complete", segments: narrative },
  { name: "historical text-only without diagnostics", expected: "unverified", visualStatus: "text_only", status: "complete", sceneArtifacts: null, segments: narrative },
  { name: "missing family evidence", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { degradation: { reason: "missing_capability" } }, segments: narrative },
  { name: "required diagram absent", expected: "failed", visualStatus: "retry_required", status: "complete", segments: narrative },
  { name: "retry scene still teaching", expected: "failed", visualStatus: "retry_required", status: "live", segments: narrative },
  { name: "recovered diagram retains prior attempt diagnostics", expected: "healthy", visualStatus: "validated", status: "complete", sceneArtifacts: { degradation: { reason: "missing_capability" }, failureTelemetry: { code: "planner_declined" } }, segments: narrative },
  { name: "verified scene with teaching failure", expected: "failed", visualStatus: "validated", status: "complete", sceneArtifacts: { failureTelemetry: { failed: true, code: "teaching_segment_failed" } }, segments: narrative },
  { name: "failed continuation still fails", expected: "failed", visualStatus: "text_only", status: "stopped", sceneArtifacts: { ...continuation, failureTelemetry: { failed: true, code: "transport_error" } }, segments: narrative },
  { name: "expected none with explicit teaching failure", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...none, failureTelemetry: { failed: true, code: "lesson_not_taught" } }, segments: narrative },
  { name: "completed empty continuation integrity failure", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: continuation, segments: [] },
  { name: "completed verified scene with zero teaching rows", expected: "failed", visualStatus: "validated", status: "complete", segments: [] },
  { name: "live opening placeholder", expected: "pending", visualStatus: null, status: "live", segments: [] },
  { name: "manual stop before teaching", expected: "unverified", visualStatus: "text_only", status: "stopped", segments: [] },
  { name: "completed reset-only row is uncertain without telemetry", expected: "unverified", visualStatus: "text_only", status: "complete", sceneArtifacts: none, segments: [{ command: { type: "RESET_PAGE" } }] },
  { name: "completed whitespace is uncertain without telemetry", expected: "unverified", visualStatus: "text_only", status: "complete", segments: [{ narration: " \n\t " }] },
  { name: "muted command-only lesson", expected: "healthy", visualStatus: "text_only", status: "complete", sceneArtifacts: none, segments: [{ command: { commands: [{ type: "WRITE", text: "x = 7" }] } }] },
  { name: "legacy unknown code", expected: "unverified", visualStatus: "text_only", status: "complete", sceneArtifacts: { failureTelemetry: { code: "unknown" } }, segments: narrative },
  { name: "a dropped valid figure (#172) is a confirmed failure", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { degradation: { reason: "valid_candidate_dropped", issueCodes: ["valid_candidate_dropped", "source_question_mismatch"] } }, segments: narrative },
  { name: "legacy unrecorded code", expected: "unverified", visualStatus: "text_only", status: "complete", sceneArtifacts: { degradation: { reason: "unrecorded" } }, segments: narrative },
  { name: "content-free fail flag with unknown cause", expected: "failed", visualStatus: "text_only", status: "stopped", sceneArtifacts: { failureTelemetry: { failed: true, code: "unknown" } }, segments: narrative },
  { name: "shown picture over a refused figure", expected: "picture_shown", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, degradation: { reason: "candidate_invalid" } }, segments: narrative },
  { name: "shown picture over a required figure", expected: "picture_shown", visualStatus: "retry_required", status: "complete", sceneArtifacts: picture, segments: narrative },
  { name: "shown picture stopped by the student", expected: "picture_shown", visualStatus: "text_only", status: "stopped", sceneArtifacts: { ...picture, degradation: { reason: "required_visual_unavailable" } }, segments: narrative },
  { name: "shown picture with no engine reason", expected: "picture_shown", visualStatus: "text_only", status: "complete", sceneArtifacts: picture, segments: narrative },
  { name: "shown picture does not excuse a teaching failure", expected: "failed", visualStatus: "text_only", status: "stopped", sceneArtifacts: { ...picture, failureTelemetry: { failed: true, code: "lesson_not_taught" } }, segments: narrative },
  { name: "shown picture does not excuse a billing stop", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { code: "budget_limit" }, degradation: { reason: "candidate_invalid" } }, segments: narrative },
  { name: "shown picture does not excuse a solver contradiction", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, degradation: { reason: "solver_contradiction" } }, segments: narrative },
  { name: "shown picture does not excuse an empty lesson", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, degradation: { reason: "candidate_invalid" } }, segments: [] },
  { name: "the browser saying shown is not a picture", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { referencePictureOutcome: picture.referencePictureOutcome, degradation: { reason: "candidate_invalid" } }, segments: narrative },
  { name: "a declined picture leaves the failure", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { referencePictureOutcome: { attempted: true, status: "declined", reason: "no_match", ms: 4_000, speculative: true }, degradation: { reason: "candidate_invalid" } }, segments: narrative },
  { name: "an answered telemetry code does not hide an unanswered reason", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { code: "candidate_invalid" }, degradation: { reason: "solver_contradiction" } }, segments: narrative },
  { name: "a planner request lost under a shown picture", expected: "picture_shown", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { stage: "scene_planner", code: "provider_error" } }, segments: narrative },
  { name: "a plan request lost under a shown picture", expected: "picture_shown", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { stage: "turn_plan", code: "transport_error" } }, segments: narrative },
  { name: "a teaching transport code under a shown picture still fails", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { stage: "teaching", code: "transport_error" } }, segments: narrative },
  { name: "a transport code with no stage under a shown picture still fails", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { ...picture, failureTelemetry: { code: "provider_error" } }, segments: narrative },
  { name: "a planner request lost with no picture still fails", expected: "failed", visualStatus: "text_only", status: "complete", sceneArtifacts: { failureTelemetry: { stage: "scene_planner", code: "provider_error" } }, segments: narrative },
  { name: "a retry required figure with no picture still fails", expected: "failed", visualStatus: "retry_required", status: "complete", sceneArtifacts: { referencePictureOutcome: { attempted: true, status: "skipped", reason: "wait_in_progress", ms: 0, speculative: false } }, segments: narrative },
];

// Evaluate the concrete positive Prisma predicate on deterministic fixtures.
// JSON path absence is false; it is never treated as NOT(true) or a failure.
function matches(row: TurnFailureInput, where: unknown): boolean {
  const condition = where as Record<string, unknown>;
  if (Array.isArray(condition.AND) && !condition.AND.every((child) => matches(row, child))) return false;
  if (Array.isArray(condition.OR) && !condition.OR.some((child) => matches(row, child))) return false;
  for (const [key, value] of Object.entries(condition)) {
    if (key === "AND" || key === "OR") continue;
    if (key === "sceneArtifacts") {
      const json = value as { path: string[]; equals: unknown };
      let actual: unknown = row.sceneArtifacts;
      for (const part of json.path) actual = actual !== null && typeof actual === "object" ? (actual as Record<string, unknown>)[part] : undefined;
      if (json.equals === Prisma.AnyNull ? actual !== undefined && actual !== null : actual !== json.equals) return false;
    } else if (key === "segments") {
      if ((row.segments?.length ?? row.segmentCount) !== 0) return false;
    } else if (key === "visualStatus" || key === "status") {
      const actual = row[key] ?? null;
      if (value !== null && typeof value === "object" && "in" in value) {
        if (!(value as { in: unknown[] }).in.includes(actual)) return false;
      } else if (actual !== value) return false;
    } else throw new Error(`unsupported predicate fixture field ${key}`);
  }
  return true;
}

const predicate = failedTurnWhere();
assert(!JSON.stringify(predicate).includes('"NOT"'), "JSON-null safety requires positive evidence branches");
for (const fixture of fixtures) {
  const classification = classifyTurnFailure(fixture);
  assert.equal(classification.classification, fixture.expected, fixture.name);
  assert.equal(matches(fixture, predicate), fixture.expected === "failed", `${fixture.name}: query and shared classifier must agree`);
  const outcome = classifyOutcome(fixture.visualStatus, fixture);
  if (fixture.expected === "unverified" || fixture.expected === "pending") assert.equal(outcome, "unverified", `${fixture.name}: unknown remains visible in All logs`);
  if (fixture.expected === "failed") assert(outcome === "failed" || outcome === "retry_required", `${fixture.name}: confirmed failure has a failure pill`);
  if (fixture.expected === "picture_shown") {
    assert.equal(outcome, "picture_shown", `${fixture.name}: a shown picture has its own pill`);
    assert.equal(classifyOutcome(fixture.visualStatus), fixture.visualStatus, `${fixture.name}: by status alone the engine still counts it as it did`);
  }
}
assert.equal(classifyTurnFailure(fixtures.find((fixture) => fixture.name === "muted command-only lesson")!).taught, true);
assert.equal(classifyTurnFailure(fixtures.find((fixture) => fixture.name === "completed reset-only row is uncertain without telemetry")!).taught, false);
assert.equal(classifyTurnFailure(fixtures.find((fixture) => fixture.name === "content-free fail flag with unknown cause")!).code, "unknown", "an explicit failure flag does not invent a cause");
for (const code of CONFIRMED_TURN_FAILURE_CODES) {
  const fixture = { visualStatus: "text_only", status: "complete", segments: narrative, sceneArtifacts: { degradation: { reason: code } } };
  assert.equal(classifyTurnFailure(fixture).classification, "failed", `approved ${code} stays actionable`);
  assert.equal(matches(fixture, predicate), true);
  assert.equal(classifyTurnFailure({ ...fixture, visualStatus: "validated" }).classification, "healthy", `recovered diagram clears prior ${code}`);
  assert.equal(matches({ ...fixture, visualStatus: "validated" }, predicate), false);
}
for (const code of CONFIRMED_TURN_FAILURE_CODES) {
  const fixture = { visualStatus: "text_only", status: "complete", segments: narrative, sceneArtifacts: { ...picture, degradation: { reason: code } } };
  const answered = (PICTURE_ANSWERED_FAILURE_CODES as readonly string[]).includes(code);
  assert.equal(classifyTurnFailure(fixture).classification, answered ? "picture_shown" : "failed", `${code} under a shown picture`);
  assert.equal(matches(fixture, predicate), !answered, `${code} under a shown picture: query and classifier agree`);
  if (answered) assert.equal(classifyTurnFailure(fixture).code, code, `${code}: the engine's reason survives for its own report`);
}
// The engine's reason counts stay as they were, with or without a picture.
const engineCounts = new Map<string, number>();
for (const sceneArtifacts of [
  { ...picture, degradation: { reason: "candidate_invalid" } },
  { degradation: { reason: "candidate_invalid" } },
  picture,
]) countEngineRefusal(engineCounts, classifyTurnFailure({ visualStatus: "text_only", status: "complete", segments: narrative, sceneArtifacts }));
countEngineRefusal(engineCounts, classifyTurnFailure({ visualStatus: "text_only", status: "complete", segments: narrative, sceneArtifacts: { failureTelemetry: { failed: true, code: "unknown" } } }));
assert.deepEqual([...engineCounts.entries()], [["candidate_invalid", 2], ["unknown", 1]], "a refusal counts the same with or without a picture, and a picture with no refusal adds nothing");
const overview = readFileSync(new URL("../../lib/admin/overviewDistributions.ts", import.meta.url), "utf8");
const scanLoop = overview.indexOf("for (const row of scannedRows) {");
const scanEnd = overview.indexOf("const reasons: DegradationReasonCount[]", scanLoop);
assert(scanLoop > 0 && scanEnd > scanLoop, "the overview still scans its rows, then sorts its reasons");
assert(/\n {4}countEngineRefusal\(reasonCounts, failure\);\n/.test(overview.slice(scanLoop, scanEnd)), "the overview counts every scanned row through the same rule");
assert(!overview.slice(scanLoop, scanEnd).includes("reasonCounts.set("), "the overview has no second way to count a reason");
// Every combination of code, stage and reason: the query and the classifier agree.
assert.equal(classifyTurnFailure({ visualStatus: "retry_required", status: "complete", sceneArtifacts: picture, segments: narrative }).code, "required_visual_unavailable", "a required figure keeps its code in the picture report");
let grid = 0;
for (const telemetryCode of [undefined, ...CONFIRMED_TURN_FAILURE_CODES]) {
  for (const stage of [undefined, ...FAILED_TURN_STAGES]) {
    for (const reason of [undefined, ...CONFIRMED_TURN_FAILURE_CODES]) {
      for (const shown of [false, true]) {
        for (const visualStatus of ["text_only", "retry_required"]) {
          const sceneArtifacts = {
            ...(shown ? { referencePicture: picture.referencePicture } : {}),
            ...(telemetryCode || stage ? { failureTelemetry: { ...(telemetryCode ? { code: telemetryCode } : {}), ...(stage ? { stage } : {}) } } : {}),
            ...(reason ? { degradation: { reason } } : {}),
          };
          const row = { visualStatus, status: "complete", segments: narrative, sceneArtifacts };
          assert.equal(matches(row, predicate), classifyTurnFailure(row).classification === "failed", `query and classifier: ${JSON.stringify(sceneArtifacts)} ${visualStatus}`);
          grid++;
        }
      }
    }
  }
}
assert(grid > 10_000, "the grid really ran");
for (const code of ["not_needed", "continuation", "unrecorded", "unknown"]) assert(!(CONFIRMED_TURN_FAILURE_CODES as readonly string[]).includes(code));
const windowed = failedTurnWhere(new Date("2026-10-01T00:00:00.000Z"));
assert(Array.isArray(windowed.AND) && windowed.AND.length === 2, "the time window cannot replace the failure predicate");
console.log(`turn failure classification: ${fixtures.length} scenarios and ${CONFIRMED_TURN_FAILURE_CODES.length} approved-code recovery pairs pass; unknown outcomes remain visible; no DB/network calls`);
