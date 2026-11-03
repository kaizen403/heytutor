/**
 * Lane 4 phase 2, end to end: a mechanism ask that names no species ("Teach
 * me SN1 and SN2 reactions ...", production turn bcf546ce) draws the plan's
 * example reactions through the live selection, and the teaching prompt is
 * told the same equations. A plan without exampleReactions, a mismatched
 * figure and a malformed list keep today's behaviour.
 *
 * Run: pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-plan-example-reactions.ts
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { planExampleTeachingAddon } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const BCF = "Teach me SN1 and SN2 reactions from the very basics like a patient chemistry teacher. Draw the reaction mechanism on a whiteboard, show the structures of the molecules, use arrows to explain electron movement, and explain each step aloud in simple English. Compare SN1 and SN2 with examples and finish with a few viva questions.";
const SN2 = "CH3Br + OH- -> CH3OH + Br-";
const SN1 = "(CH3)3CBr + 2 H2O -> (CH3)3COH + H3O+ + Br-";

const plan = (exampleReactions?: TurnPlanV3["exampleReactions"]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question: BCF, subject: "chemistry", visualRequirement: "required",
  givens: [], unknowns: [], derived: [], assumptions: [],
  lawIds: ["SN2 kinetics: rate = k[substrate][nucleophile]", "SN1 kinetics: rate = k[substrate]", "Curved-arrow (electron-pushing) formalism"],
  qualitativeClaims: [
    { id: "c1", claim: "SN2 is a one-step concerted substitution with backside attack.", expected: "single transition state" },
    { id: "c4", claim: "SN1 is a two-step substitution through a planar carbocation.", expected: "carbocation intermediate" },
  ],
  ...(exampleReactions ? { exampleReactions } : {}),
} as TurnPlanV3);

const select = (turnPlan: TurnPlanV3) => selectProductionScene({ question: BCF, turnPlan, problemIR: null, candidate: null, requiredRetryEnabled: true });
const results: string[] = [];
const check = (id: string, body: () => void): void => {
  try { body(); results.push(`ok   ${id}`); } catch (error) { results.push(`FAIL ${id}: ${(error as Error).message.split("\n")[0]}`); process.exitCode = 1; }
};

const reactions = [{ mechanism: "SN2", equation: SN2 }, { mechanism: "SN1", equation: SN1 }] as TurnPlanV3["exampleReactions"];
const drawn = select(plan(reactions));

check("selection/draws-both-examples", () => {
  const rep = drawn.representation;
  assert.ok(rep, `no figure: ${drawn.reason}`);
  assert.equal(rep.family, "chem_organic");
  assert.equal(rep.tier, "qualitative_verified");
  assert.equal(rep.sceneDocument.source.figureProvenance, "plan_example");
  assert.equal(rep.sceneDocument.source.exampleSpecies, `${SN2}; ${SN1}`);
  const labels = (rep.renderScene?.primitives ?? []).filter((p: { kind: string }) => p.kind === "label").map((p: { text?: string }) => p.text);
  assert.ok(labels.includes("SN2 (example)") && labels.includes("SN1 (example)"), "both rows titled as examples");
});
check("selection/no-plan-example-stays-text", () => {
  assert.equal(select(plan()).representation, null, "today's behaviour without exampleReactions");
});
check("selection/one-water-sn1-declines", () => {
  assert.equal(select(plan([{ mechanism: "SN2", equation: SN2 }, { mechanism: "SN1", equation: "(CH3)3CBr + H2O -> (CH3)3COH + HBr" }])).representation, null,
    "the halide as the base is not drawn");
});
check("teaching/names-the-drawn-equations", () => {
  const addon = planExampleTeachingAddon(BCF, plan(reactions), `${SN2}; ${SN1}`);
  assert.match(addon, /^EXAMPLE REACTIONS TO TEACH WITH/);
  assert.ok(addon.includes(`SN2: ${SN2}`) && addon.includes(`SN1: ${SN1}`), "both equations named");
});
check("teaching/mismatched-figure-gets-nothing", () => {
  assert.equal(planExampleTeachingAddon(BCF, plan(reactions), SN2), "", "a figure that is not the plan's reactions");
  assert.equal(planExampleTeachingAddon(BCF, plan(reactions), null), "");
});
check("contract/malformed-list-is-dropped", () => {
  for (const exampleReactions of [[{ mechanism: "E1", equation: "x" }], [1, 2, 3], [{ mechanism: "SN2", equation: "a" }, { mechanism: "SN2", equation: "b" }]]) {
    const read = validateTurnPlanV3({ ...plan(), exampleReactions } as unknown as Record<string, unknown>);
    assert.equal(read.valid, true, "the plan stays valid");
    assert.equal(read.plan?.exampleReactions, undefined, "the list is dropped, not repaired");
  }
  const kept = validateTurnPlanV3(plan(reactions) as unknown as Record<string, unknown>);
  assert.deepEqual(kept.plan?.exampleReactions, reactions);
});

for (const line of results) console.log(line);
console.log(`verify-plan-example-reactions: ${results.filter((line) => line.startsWith("ok")).length}/${results.length} passed`);
