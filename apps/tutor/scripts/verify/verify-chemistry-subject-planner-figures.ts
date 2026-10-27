/**
 * A turn the plan places in chemistry never takes a planner figure. A molecule
 * the scene planner draws is model-authored ink (docs/agent/chemistry-lessons.md),
 * and a chemistry plan whose question the lane classifier misses (thermodynamics
 * or gases framed as chemistry, a request to show angles on a diagram) went to
 * the planner, where strict subjects let only planner figures draw.
 *
 *   only removes  every decision (subject, lane, strategy, strict subjects,
 *                 turn kind) allows a subset of what main allowed, and every
 *                 difference is a planner or recovered planner figure refused
 *                 for a chemistry plan.
 *   stems         authored chemistry plan stems the lane misses keep text and
 *                 engine sources and lose only the planner figure.
 *   end to end    a valid planner candidate draws for a physics plan and draws
 *                 nothing for a chemistry plan.
 *   mutation      main's policy (without the chemistry check) turns rows red.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIGURE_SOURCES, type FigureSource, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { DiagramSubject } from "@heytutor/tutor-core";
import { capacitorCircuit, capacitorPlan, capacitorQuestion } from "../../../../packages/scene-engine/scripts/verify/fixtures/capacitor-circuit";
import * as policy from "../../features/tutor-session/lib/scene/diagramStrategy";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Policy = typeof policy;
const PLANNER_AUTHORED: readonly FigureSource[] = ["planner", "verified_recovery"];
const SUBJECTS: Array<DiagramSubject | undefined> = ["maths", "physics", "chemistry", "other", undefined];
const STRICT_SUBJECTS: DiagramSubject[][] = [[], ["maths"], ["maths", "physics"], ["maths", "physics", "chemistry"]];

/** Every decision the live hook and the lab can make. */
function decisions(module: Policy): Policy["decideDiagramStrategy"] extends (...args: never[]) => infer D ? D[] : never {
  const out = [];
  for (const subject of SUBJECTS) for (const strictSubjects of STRICT_SUBJECTS)
    for (const assignedStrategy of ["current", "strict"] as const) for (const chemistryLane of [false, true])
      for (const [codeLesson, dsa, doubt] of [[false, false, false], [true, false, false], [true, true, false], [false, false, true]] as const)
        out.push(module.liveDiagramStrategyDecision({ assignedStrategy, subject, strictSubjects, chemistryLane, codeLesson, dsa, doubt }));
  return out as never;
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function run(): Promise<void> {
  // Main's policy: the same module without the chemistry check.
  const source = fileURLToPath(new URL("../../features/tutor-session/lib/scene/diagramStrategy.ts", import.meta.url));
  const original = readFileSync(source, "utf8");
  const ANCHOR = "  if (chemistryRefusesPlannerFigure(decision, source)) return false;\n";
  async function mainPolicy(): Promise<Policy> {
    assert.ok(original.includes(ANCHOR), "mutation anchor is missing");
    const path = source.replace(/diagramStrategy\.ts$/, `diagramStrategy.main-${process.pid}.ts`);
    writeFileSync(path, original.replace(ANCHOR, ""));
    try { return (await import(path)) as Policy; }
    finally { rmSync(path, { force: true }); }
  }
  const main = await mainPolicy();

  /** Rows where `module` lets a chemistry plan take a planner-authored figure. */
  function plannerLeaks(module: Policy): string[] {
    const leaks: string[] = [];
    for (const decision of decisions(module)) {
      if (decision.subject !== "chemistry") continue;
      for (const figure of PLANNER_AUTHORED) {
        if (module.diagramStrategyAllowsFigureSource(decision, figure)) {
          leaks.push(`${figure} lane=${decision.chemistryLane} strategy=${decision.strategy} strict=${decision.strictSubjects?.join("+") || "none"} doubt=${decision.doubt} code=${decision.codeLesson}`);
        }
      }
    }
    return leaks;
  }

  await check("only-removes", () => {
    let removed = 0;
    for (const decision of decisions(policy)) {
      for (const figure of FIGURE_SOURCES) {
        const before = main.diagramStrategyAllowsFigureSource(decision, figure);
        const after = policy.diagramStrategyAllowsFigureSource(decision, figure);
        if (before === after) continue;
        assert.ok(before && !after, `${figure} was refused on main and is allowed now for ${JSON.stringify(decision)}`);
        assert.equal(decision.subject, "chemistry", `${figure} changed for a ${decision.subject} plan`);
        assert.ok(PLANNER_AUTHORED.includes(figure), `${figure} is not a planner figure`);
        removed++;
      }
    }
    assert.ok(removed > 0, "the change must refuse at least one figure main allowed");
    console.log(`only-removes: ${removed} decision and source pairs refused, none added`);
  });

  await check("no-planner-figure-for-chemistry", () => assert.deepEqual(plannerLeaks(policy), []));

  await check("selection-order-and-examples-unchanged", () => {
    const before = decisions(main), after = decisions(policy);
    assert.equal(before.length, after.length);
    before.forEach((decision, index) => assert.deepEqual(after[index], decision));
  });

  // Authored stems in the shape of the chemistry plans the lane missed. The plan
  // says chemistry; the question carries no species or family cue.
  const STEMS = [
    "I need the first law of thermodynamics for my chem class.",
    "Walk me through how ideal gases behave in a chem lesson.",
    "Sketch the angles between bonds and label each one.",
    "Explain dipole moment.",
    "Why are some substances paramagnetic?",
  ];
  function plan(question: string): TurnPlanV3 {
    return { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  }
  for (const question of STEMS) {
    await check(`stem/${question}`, () => {
      const gate = deriveSceneGate({ question, turnPlan: plan(question), problemIR: null });
      assert.equal(gate.chemistryLane, false, "guard: the lane classifier misses this stem, which is the leak");
      const decision = policy.liveDiagramStrategyDecision({ assignedStrategy: "current", subject: "chemistry", strictSubjects: ["maths", "physics"],
        chemistryLane: gate.chemistryLane, codeLesson: false, dsa: false, doubt: false });
      const allowed = FIGURE_SOURCES.filter((figure) => policy.diagramStrategyAllowsFigureSource(decision, figure));
      const before = FIGURE_SOURCES.filter((figure) => main.diagramStrategyAllowsFigureSource(decision, figure));
      assert.ok(before.includes("planner"), "guard: main let this plan take a planner figure");
      assert.deepEqual(allowed, before.filter((figure) => !PLANNER_AUTHORED.includes(figure)));
    });
  }

  // A valid planner candidate: it draws for the physics plan it was made for,
  // and draws nothing when the plan places the turn in chemistry.
  function drawnFor(module: Policy, subject: DiagramSubject): FigureSource | null {
    const decision = module.liveDiagramStrategyDecision({ assignedStrategy: "current", subject, strictSubjects: ["maths", "physics"],
      chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
    const selected = selectProductionScene({
      question: capacitorQuestion, turnPlan: capacitorPlan,
      problemIR: { entities: [{ kind: "component", label: "battery" }, { kind: "component", label: "capacitor" }], representationIntents: [{ kind: "network" }], constraints: [], solveRequests: [] },
      candidate: { ...capacitorCircuit() }, completionEnabled: false, requiredRetryEnabled: false,
      policy: { preferPlanner: decision.strategy === "strict", allowedFigureSources: FIGURE_SOURCES.filter((figure) => module.diagramStrategyAllowsFigureSource(decision, figure)) },
    } as Parameters<typeof selectProductionScene>[0]);
    return selected.representation?.figureSource ?? null;
  }
  await check("end-to-end/physics-keeps-planner", () => assert.equal(drawnFor(policy, "physics"), "planner"));
  await check("end-to-end/chemistry-refuses-planner", () => assert.equal(drawnFor(policy, "chemistry"), null));

  await check("mutation/main-policy", () => {
    const leaks = plannerLeaks(main);
    console.log(`mutation/main-policy: ${leaks.length} chemistry decisions take a planner figure`);
    assert.ok(leaks.some((row) => row.startsWith("planner lane=false strategy=current strict=maths+physics doubt=false")), leaks.slice(0, 5).join("; "));
    assert.ok(leaks.some((row) => row.startsWith("verified_recovery lane=false")), "a recovered planner figure leaks on main");
    assert.equal(drawnFor(main, "chemistry"), "planner", "main draws the planner candidate for a chemistry plan");
  });

  console.log(`verify-chemistry-subject-planner-figures: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

void run();
