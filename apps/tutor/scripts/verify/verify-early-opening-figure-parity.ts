import assert from "node:assert/strict";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { scenario, type FrozenStartupFixture } from "./verify-startup-turn";
import { EARLY_OPENING_PARITY_QUESTIONS } from "./fixtures/early-opening-parity";

const planFor = (question: string, visualRequirement: TurnPlanV3["visualRequirement"] = "required"): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
const fixtures: Array<{ id: string; subject: string; plan: TurnPlanV3 }> = EARLY_OPENING_PARITY_QUESTIONS
  .map(({ id, subject, question }) => ({ id, subject, plan: planFor(question) }));
fixtures.push({ id: "positive-physics", subject: "physics", plan: {
  ...planFor("Derive the formula for the range of a projectile on level ground."),
  unknowns: [{ id: "range", symbol: "R" }],
  qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"],
} });
fixtures.push({ id: "positive-maths", subject: "maths",
  plan: planFor("A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.") });
fixtures.push({ id: "positive-chemistry", subject: "chemistry", plan: planFor("Draw the Lewis structure of CO2.") });
fixtures.push({ id: "no-figure", subject: "chemistry", plan: planFor("Explain the meaning of a chemical element.", "none") });

async function main() {
  const mutation = process.argv.includes("--mutate-opening-figure");
  const positiveSubjects = new Set<string>();
  let drawn = 0;
  let textOnly = 0;
  for (const fixture of fixtures) {
    const frozen: FrozenStartupFixture = { plan: fixture.plan, dropSelectedFigureWhenEarly: mutation };
    const before = JSON.stringify(frozen.plan);
    const off = await scenario("early-parity", false, false, frozen);
    const on = await scenario("early-parity", false, true, frozen);
    assert("drawing" in off && "drawing" in on && "sceneDocument" in off && "sceneDocument" in on);
    const { mode: offMode, early: offEarly, ...offDecision } = off;
    const { mode: onMode, early: onEarly, ...onDecision } = on;
    assert.equal(offMode, onMode);
    assert.equal(offEarly, false);
    assert.equal(onEarly, true);
    assert.equal(JSON.stringify(frozen.plan), before, `${fixture.id}: planning must not mutate its frozen authority`);
    // Avoid dumping question text or geometry on failure. The actual hook
    // reports both its selected document and committed board DRAW commands.
    assert(JSON.stringify(onDecision) === JSON.stringify(offDecision),
      `${fixture.id}: early opening changed figure decision or committed geometry`);
    if (off.figureDrawn) { drawn++; positiveSubjects.add(fixture.subject); }
    if (off.visualStatus === "text_only" && !off.figureDrawn) textOnly++;
  }
  for (const subject of ["maths", "physics", "chemistry"]) {
    assert(positiveSubjects.has(subject), `${subject}: the gate must include a genuinely drawn figure`);
  }
  assert(textOnly > 0, "the gate must include a genuinely text-only turn");
  console.log(`verify-early-opening-figure-parity: ${fixtures.length} frozen OFF/ON pairs, ${drawn} figures; real selector, presentation and runner unchanged`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
