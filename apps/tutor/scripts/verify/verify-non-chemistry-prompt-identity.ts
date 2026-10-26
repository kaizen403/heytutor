/**
 * Maths and physics turns get byte-identical planner and teaching prompts.
 *
 * The chemistry example-species addon is shown only on chemistry turns. This
 * gate renders every planner request body (primary, alternate, retry, audit)
 * and the teaching system and continuation prompts for fixed maths and physics
 * turns, hashes each, and compares with hashes recorded on main 0dbb799b0
 * before the addon existed. One case carries an `exampleSpecies` field on a
 * physics plan: it must not reach either prompt.
 *
 * Record again (only for an intended prompt change): `--write`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTurnPlanV3, planTurnV3, TURN_PLAN_V3_CHEMISTRY_EXAMPLE_ADDON } from "@heytutor/tutor-core";
import { questionNamesSpecies } from "@heytutor/scene-engine";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "non-chemistry-prompt-identity.json");

const plan = (question: string, extra: Record<string, unknown> = {}): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [{ id: "c1", claim: "the idea holds", expected: true }], lawIds: ["law"], assumptions: [],
  visualRequirement: "optional", ...extra,
} as TurnPlanV3);

const CASES: Array<{ id: string; question: string; plan: TurnPlanV3 }> = [
  { id: "maths-parabola", question: "sketch the graph of y = x^2 - 4", plan: plan("sketch the graph of y = x^2 - 4") },
  { id: "maths-topic", question: "explain the unit circle", plan: plan("explain the unit circle") },
  { id: "physics-projectile", question: "A ball is thrown at 20 m/s at 30 degrees. Find the range.",
    plan: plan("A ball is thrown at 20 m/s at 30 degrees. Find the range.", {
      givens: [{ id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" }] }) },
  { id: "physics-topic-example-field", question: "explain newton's third law",
    plan: plan("explain newton's third law", { exampleSpecies: [{ formula: "BF3", claim: "BF3 is sp2" }] }) },
];

async function plannerBodies(question: string, candidate: TurnPlanV3): Promise<string[]> {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ""));
    return new Response("{}", { status: 500 });
  }) as typeof fetch;
  try {
    for (const classifySubject of [false, true]) {
      await planTurnV3(question, { proxyUrl: "http://gate.invalid/api/chat", timeoutMs: 60_000, classifySubject });
      await auditTurnPlanV3(question, candidate, { proxyUrl: "http://gate.invalid/api/chat", timeoutMs: 60_000, classifySubject });
    }
  } finally {
    globalThis.fetch = original;
  }
  // Lane order is a race; the set of request bodies is the identity.
  return bodies.sort();
}

function teachingPrompts(question: string, turnPlan: TurnPlanV3, figureExampleSpecies?: string | null, figures: ReadonlyArray<string | null> = [null, "FIGURE ON THE BOARD\n(gate figure addon)"]): string[] {
  return figures.flatMap((diagramPromptAddon) => {
    const prompt = buildTurnTeachingPrompt({
      question, diagramPromptAddon, turnPlan, solverProjection: null, codeLesson: null,
      ...(figureExampleSpecies === undefined ? {} : { figureExampleSpecies }),
      isDsa: false, familiarity: "normal", fastMode: true, narrationLanguage: "english",
    } as Parameters<typeof buildTurnTeachingPrompt>[0]);
    return [prompt.systemPrompt, prompt.continuationPrompt];
  });
}

const FIGURE = "FIGURE ON THE BOARD\n(gate figure addon)";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function main(): Promise<void> {
const rendered: Record<string, { planner: string; teaching: string }> = {};
for (const entry of CASES) {
  rendered[entry.id] = {
    planner: hash((await plannerBodies(entry.question, entry.plan)).join("\n\u0000\n")),
    teaching: hash(teachingPrompts(entry.question, entry.plan).join("\n\u0000\n")),
  };
}

// The other side of the identity: chemistry turns do get the addon, the
// addon names no species, and the teaching is told the accepted example.
const chemistryQuestion = "what is sp2 hybridisation";
const chemistryPlan = plan(chemistryQuestion, { exampleSpecies: [{ formula: "BF3", claim: "BF3 is sp2 and trigonal planar" }] });
const chemistryBodies = await plannerBodies(chemistryQuestion, chemistryPlan);
const chemistryProblems = [
  chemistryBodies.every((body) => body.includes(JSON.stringify(TURN_PLAN_V3_CHEMISTRY_EXAMPLE_ADDON).slice(1, -1))) ? "" : "a chemistry planner request lacks the example addon",
  questionNamesSpecies(TURN_PLAN_V3_CHEMISTRY_EXAMPLE_ADDON) ? "the planner addon names a species" : "",
  teachingPrompts(chemistryQuestion, chemistryPlan, "BF3", [FIGURE]).every((prompt) => prompt.includes("EXAMPLE TO TEACH WITH") && prompt.includes("BF3")) ? "" : "the chemistry teaching prompt lacks the plan example",
  // The lesson names the example only when the board shows it: no figure, a
  // figure that is not the example (its checks refused it), or another species.
  teachingPrompts(chemistryQuestion, chemistryPlan, "BF3", [null]).some((prompt) => prompt.includes("EXAMPLE TO TEACH WITH")) ? "a turn with no figure was told the example is on the board" : "",
  teachingPrompts(chemistryQuestion, chemistryPlan, null, [FIGURE]).some((prompt) => prompt.includes("EXAMPLE TO TEACH WITH")) ? "a figure that is not the plan example was described as the example" : "",
  teachingPrompts(chemistryQuestion, chemistryPlan, "NH3", [FIGURE]).some((prompt) => prompt.includes("EXAMPLE TO TEACH WITH")) ? "a figure of another species was described as the plan example" : "",
  teachingPrompts(chemistryQuestion, plan(chemistryQuestion, { exampleSpecies: [{ formula: "CH4", claim: "CH4 is sp3 and tetrahedral" }] }), null, [FIGURE])
    .some((prompt) => prompt.includes("EXAMPLE TO TEACH WITH")) ? "a refused example was taught as the board's species" : "",
  teachingPrompts("why is water bent", plan("why is water bent", { exampleSpecies: [{ formula: "NH3", claim: "NH3 is sp3" }] }), "NH3")
    .some((prompt) => prompt.includes("EXAMPLE TO TEACH WITH")) ? "a question naming its species was given a plan example" : "",
].filter(Boolean);
if (chemistryProblems.length) {
  console.error(chemistryProblems.join("; "));
  process.exit(1);
}

if (process.argv.includes("--write")) {
  writeFileSync(FIXTURE, `${JSON.stringify(rendered, null, 2)}\n`);
  console.log(`wrote ${FIXTURE}`);
} else {
  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof rendered;
  const failures = Object.keys({ ...expected, ...rendered }).flatMap((id) =>
    (["planner", "teaching"] as const).filter((kind) => expected[id]?.[kind] !== rendered[id]?.[kind]).map((kind) => `${id} ${kind}`));
  if (failures.length) {
    console.error(`non-chemistry prompts changed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`verify-non-chemistry-prompt-identity: ${CASES.length} maths and physics turns, planner and teaching prompts byte-identical to main`);
}
}

void main();
