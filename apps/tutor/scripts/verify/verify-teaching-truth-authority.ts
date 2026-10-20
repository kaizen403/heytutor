/** Actual fresh/resume/doubt prompt assembly; no model, scene or numeric admission. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import * as sourcePrompt from "../../../../packages/tutor-core/src/llm/systemPrompt";
import { buildSolverAuthorityProjection, type ProblemIR, type SolverResult, type TurnPlanV3 } from "@heytutor/scene-engine";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const assembly = path.join(app, "features/tutor-session/lib/turn/turnTeachingPrompt.ts");
const compiled = ts.transpileModule(readFileSync(process.env.TEACHING_TRUTH_PROMPT_SOURCE ?? assembly, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as Record<string, unknown> };
new Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "@heytutor/tutor-core") return { ...core, ...sourcePrompt };
  return requireApp(id.startsWith("@/") ? path.join(app, id.slice(2))
    : id.startsWith(".") ? path.resolve(path.dirname(assembly), id) : id);
}, mod, mod.exports);
const prompts = mod.exports as unknown as typeof import("../../features/tutor-session/lib/turn/turnTeachingPrompt");

const question = "A cart travels 12 m in 3 s. Find its speed.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question,
  givens: [{ id: "distance", symbol: "d", value: 12, unit: "m", provenance: "given", sourceText: "12 m" },
    { id: "time", symbol: "t", value: 3, unit: "s", provenance: "given", sourceText: "3 s" }],
  unknowns: [{ id: "speed", symbol: "v", unit: "m/s" }],
  derived: [{ id: "speed", symbol: "v", value: 4, unit: "m/s", provenance: "derived", sourceText: "12 / 3" },
    { id: "unproved_energy", symbol: "K", value: 999, unit: "J", provenance: "derived", sourceText: "unsupported planner working" }],
  qualitativeClaims: [{ id: "unproved_condition", claim: "The track is frictionless.", expected: "frictionless", relatedQuantityIds: [] }],
  lawIds: ["constant-speed"], assumptions: ["The cart travels at constant speed."], visualRequirement: "none",
};
// The actual existing producer defines the projection shape. This gate does
// not add an audit or turn this synthetic presentation fixture into admission.
const projection = buildSolverAuthorityProjection({ id: "synthetic-motion", expressions: [], constraints: [],
  representationIntents: [] } as unknown as ProblemIR,
{ providerId: "synthetic-deterministic" } as SolverResult,
{ status: "verified", issues: [], bindings: [{ requestId: "speed_request", quantityId: "speed", symbol: "v", unit: "m/s", approximate: 4, errorBound: 0 }] });
const base = { turnPlan: plan, solverProjection: projection, diagramPromptAddon: null,
  familiarity: "normal" as const, fastMode: true };

function assembled(solverProjection: unknown) {
  const common = { ...base, solverProjection };
  const lesson = prompts.buildTurnTeachingPrompt({ ...common, question, codeLesson: null, isDsa: false });
  const doubt = prompts.buildDoubtTeachingPrompt({ ...common, lessonQuestion: question,
    boardRows: [{ workId: "w1", text: "v = 12 / 3 = 4 m/s" }], rowsLeftOnPage: 3, nextRowY: 250, codePanelShowing: false });
  return [lesson, doubt, ...(["stop", "doubt"] as const).map(reason => prompts.buildResumeTeachingPrompt({ ...common,
    lessonQuestion: question, reason, boardRows: [{ workId: "w1", text: "d = 12 m" }],
    rowsLeftOnPage: 3, nextRowY: 250, codePanelShowing: false,
    interruptedStep: "Find the speed from distance and time.",
  }))].flatMap(built => [built.systemPrompt, built.continuationPrompt]);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("truth prompt gate forbids provider/network calls"); };
try {
  const partial = assembled(projection);
  for (const text of partial) {
    assert(!text.includes("Use these verified quantities and qualitative claims"), "one confirmed output cannot certify unrelated planner values or claims");
    assert(text.includes("TURN PLAN V3 (PLANNER WORKING; NOT A GLOBAL ANSWER KEY)"));
    assert(text.includes("only its own quantityId, symbol, unit and value"), "a partial solver projection cannot verify unrelated planner work");
    assert(text.includes("other derived quantities or qualitative claims"));
    assert(text.includes('"unproved_energy"') && text.includes('"unproved_condition"'), "preserve proposed working without laundering it into authority");
    assert(text.includes("INDEPENDENT SOLVER AUTHORITY V1 — EXPLICIT BINDINGS ONLY"));
    assert(text.includes(JSON.stringify(projection)), "the producer's binding value and formulation remain unchanged");
    assert(text.includes("Your own board working cannot override an explicitly solver-bound value"));
    assert(text.includes("check every adjacent equality"), "an unchecked chain cannot silently feed a dependent answer");
    assert(text.includes("spoken quantities agree with the [WRITE] row"));
    assert(text.includes("correct an unsupported planner value only after"), "unsupported planner arithmetic remains correctable after a check");
    assert(text.includes("state the unresolved discrepancy"), "do not invent a replacement answer when authority disagrees");
    assert(text.includes('say "under that assumption" in the SAME STEP'), "solver confirmation of another value cannot remove conditional answers");
    assert(!text.includes("AUTHORITATIVE TURN PLAN V3"));
    assert(!text.includes("Use these verified quantities and qualitative claims"));
    assert(!text.includes("trust the board"));
  }
  for (const approximate of [0, -4, [0, 4]]) {
    const valid = { ...projection, bindings: [{ requestId: "speed_request", quantityId: "speed", symbol: "v", unit: "m/s", approximate, errorBound: 0 }] };
    for (const text of assembled(valid)) {
      assert(text.includes("INDEPENDENT SOLVER AUTHORITY V1 — EXPLICIT BINDINGS ONLY"), "zero and vector bindings retain their existing presentation shape");
      assert(text.includes(JSON.stringify(valid)), "do not recalculate, coerce or replace an existing bound value");
    }
  }
  for (const unit of [undefined, ""]) {
    const dimensionless = { ...projection, bindings: [{ requestId: "ratio_request", quantityId: "ratio", symbol: "r", unit, approximate: 0.5, errorBound: 0 }] };
    for (const text of assembled(dimensionless)) assert(text.includes(JSON.stringify(dimensionless)), "the existing optional unit contract preserves dimensionless bindings");
  }
  const unconfirmed = [null, {}, { verified: true }, { ...projection, bindings: [] },
    { ...projection, status: "incomplete" }, { ...projection, bindings: [{}] },
    ...["four", Number.NaN, []].map(approximate => ({ ...projection,
      bindings: [{ requestId: "speed_request", quantityId: "speed", symbol: "v", unit: "m/s", approximate, errorBound: 0 }] }))];
  for (const candidate of unconfirmed) for (const text of assembled(candidate)) {
    assert(!text.includes("INDEPENDENT SOLVER AUTHORITY V1"), "empty/malformed context cannot acquire numeric authority");
    assert(text.includes("PLANNER WORKING; NOT A GLOBAL ANSWER KEY"));
    assert(text.includes("correct an unsupported planner value only after"));
    assert(!text.includes("trust the board"));
  }
  for (const text of [sourcePrompt.TUTOR_SYSTEM_PROMPT, sourcePrompt.TUTOR_CONTINUATION_PROMPT]) {
    assert(!text.includes("trust the board"), "the base prompt cannot undo runtime authority scope");
    assert(text.includes("solver-bound"));
    assert(text.includes("adjacent equality"));
    assert(text.includes("spoken quantities"));
  }
  console.log("verify-teaching-truth-authority: 8 actual fresh/resume/doubt prompt paths; partial solver, unconfirmed/malformed, conditional, arithmetic and narration/WRITE authority controls pass; zero providers");
} finally { globalThis.fetch = originalFetch; }
