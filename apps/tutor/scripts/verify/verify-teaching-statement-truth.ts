/** Generic statement provenance through actual lesson/resume/doubt prompts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import * as sourcePrompt from "../../../../packages/tutor-core/src/llm/systemPrompt";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const assembly = path.join(app, "features/tutor-session/lib/turn/turnTeachingPrompt.ts");
const compiled = ts.transpileModule(readFileSync(process.env.TEACHING_STATEMENT_PROMPT_SOURCE ?? assembly, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as Record<string, unknown> };
new Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "@heytutor/tutor-core") return { ...core, ...sourcePrompt };
  return requireApp(id.startsWith("@/") ? path.join(app, id.slice(2))
    : id.startsWith(".") ? path.resolve(path.dirname(assembly), id) : id);
}, mod, mod.exports);
const prompts = mod.exports as unknown as typeof import("../../features/tutor-session/lib/turn/turnTeachingPrompt");

interface Fixture {
  kind: "constant" | "direction" | "attainment";
  question: string;
  plan: TurnPlanV3;
  solverProjection?: unknown;
  diagramPromptAddon?: string | null;
}
const emptyPlan = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", question,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" });
const constantQuestion = "Use the declared vacuum permittivity ε₀ = 8.85 × 10⁻¹² F/m to compare capacitances at fixed voltage.";
const constant: Fixture = { kind: "constant", question: constantQuestion, plan: {
  ...emptyPlan(constantQuestion), givens: [{ id: "permittivity", symbol: "ε₀", value: 8.85e-12, unit: "F/m", provenance: "given", sourceText: "ε₀ = 8.85 × 10⁻¹² F/m" },
    { id: "illustrative_length", symbol: "L_example", value: 7.123, unit: "m", provenance: "given", sourceText: "planner example only" }],
  assumptions: ["Quasi-static history is needed for the final state relation."],
} };
const directionQuestion = "Explain what a moving conductor does in a magnetic field.";
const direction: Fixture = { kind: "direction", question: directionQuestion, plan: {
  ...emptyPlan(directionQuestion), assumptions: ["The conductor, velocity and field are mutually perpendicular."],
}, diagramPromptAddon: "An intentionally non-metric verified figure is visible. Readable labels: conductor, u, B. Their roles are conductor, velocity, magnetic field; no orientation, rails or circuit connection is certified." };
const attainmentQuestion = "For 0 < y < 2, describe the greatest possible value of y/2.";
const attainment: Fixture = { kind: "attainment", question: attainmentQuestion, plan: {
  ...emptyPlan(attainmentQuestion), assumptions: ["Interpret maximum as a supremum over the open domain."],
  derived: [{ id: "proposed_bound", symbol: "M", value: 1, provenance: "derived", sourceText: "planner limiting value" }],
} };

function assembled(fixture: Fixture) {
  const common = { turnPlan: fixture.plan, solverProjection: fixture.solverProjection ?? null,
    diagramPromptAddon: fixture.diagramPromptAddon ?? null, familiarity: "normal" as const, fastMode: true };
  const lesson = prompts.buildTurnTeachingPrompt({ ...common, question: fixture.question, codeLesson: null, isDsa: false });
  const doubt = prompts.buildDoubtTeachingPrompt({ ...common, lessonQuestion: fixture.question,
    boardRows: [{ workId: "w1", text: "previous symbolic relation" }], rowsLeftOnPage: 3, nextRowY: 250, codePanelShowing: false });
  return [lesson, doubt, ...(["stop", "doubt"] as const).map(reason => prompts.buildResumeTeachingPrompt({ ...common,
    lessonQuestion: fixture.question, reason, boardRows: [{ workId: "w1", text: "previous symbolic relation" }],
    rowsLeftOnPage: 3, nextRowY: 250, codePanelShowing: false,
  }))].flatMap(built => [built.systemPrompt, built.continuationPrompt]);
}
function absentSymbols(prompt: string) {
  return (/NOT STATED BY THE QUESTION: ([^.]*)\./.exec(prompt)?.[1] ?? "").split(",").map(value => value.trim());
}
function check(fixture: Fixture) {
  for (const prompt of assembled(fixture)) {
    if (fixture.kind === "constant") {
      assert(!absentSymbols(prompt).some(symbol => symbol.normalize("NFKC") === "ε0"), "a declared Unicode-subscript physical constant cannot be falsely labelled missing");
    }
    assert(prompt.includes("a label or semantic role alone does not certify a direction"), "roles cannot manufacture a direction or hidden apparatus");
    assert(prompt.includes("state it as an illustrative assumption, separate from what the figure shows"));
    assert(prompt.includes("use the stated vector order and sign convention"));
    assert(prompt.includes("balancing forces must sum to zero"));
    assert(prompt.includes("a planner assumption is proposed, not an established fact or an automatic prerequisite"));
    assert(prompt.includes("do not make a result fixed by the givens indeterminate because of an incidental process assumption"));
    assert(prompt.includes("a maximum or minimum must be attained at an allowed input"));
    assert(prompt.includes("call an unattained limiting bound a supremum or infimum"));
    assert(prompt.includes("never silently reinterpret the requested maximum as a supremum"));
    assert(prompt.includes("check the exact question and its stated givens before calling a value or constant missing"));
    if (fixture.diagramPromptAddon) {
      const figures = fixture.diagramPromptAddon.split("\n").filter(line => line.startsWith("Parts the student can read") || line.startsWith("Verified meaning"));
      for (const fact of figures.length ? figures : [fixture.diagramPromptAddon]) assert(prompt.includes(fact), "retain actual verified figure context without replacing its geometry");
    }
    assert(prompt.includes("Your own board working cannot override an explicitly solver-bound value"), "preserve the prior solver-bound authority fence");
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("statement truth gate forbids all providers/network"); };
try {
  if (process.env.TEACHING_STATEMENT_PAYLOAD_FILE) {
    const recorded = JSON.parse(readFileSync(process.env.TEACHING_STATEMENT_PAYLOAD_FILE, "utf8")) as Fixture[];
    for (const fixture of recorded) check(fixture);
    console.log(`Recorded private statement payloads: ${recorded.length}; all8 prompt paths pass; no question or identifiers logged`);
  }
  for (const fixture of [constant, direction, attainment]) check(fixture);
  for (const prompt of assembled(constant)) assert(absentSymbols(prompt).includes("L_example"), "the Unicode correction cannot bless an invented planner value");
  const incorrect = { ...constant, plan: { ...constant.plan, givens: [
    { ...constant.plan.givens[0]!, value: 4.2, sourceText: "unsupported value" },
  ] } };
  for (const prompt of assembled(incorrect)) assert(absentSymbols(prompt).includes("ε₀"), "normalization alone cannot bless the wrong magnitude");
  const explicit = { ...direction, diagramPromptAddon: "Verified property: vector u points toward the positive horizontal axis. No field orientation or circuit connection is certified." };
  check(explicit);
  console.log("verify-teaching-statement-truth: Unicode stated-constant, figure-bound direction, force balance, necessary assumptions and attained extrema contracts pass through all8 actual prompt paths; zero providers");
} finally { globalThis.fetch = originalFetch; }
