/**
 * A chemistry family figure the ProblemIR obligations refuse leaves the turn
 * text only for a named reason. Production lost the SF4 and XeF4 suggestion
 * with "no family operator program was available" and no issue code.
 *
 *   draws     "SF4 molecule" and "XeF4 molecule" bind the drawn species.
 *   recorded  an obligation for H2O, which the figure does not draw, refuses
 *             the figure and the attempt carries missing_named_body.
 *   mutation  without the recording the attempt carries no issue code.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROBLEM_IR_VERSION, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const STEM = "Use VSEPR to predict the shapes of SF4 and XeF4.";
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: STEM, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };

function problem(labels: string[]): ProblemIR {
  const start = STEM.indexOf("SF4");
  const entities = labels.map((label, index) => ({ id: `e${index}`, kind: "other" as const, label, evidenceFactIds: ["f0"] }));
  return {
    schemaVersion: PROBLEM_IR_VERSION, id: "miss", question: STEM,
    facts: [{ id: "f0", kind: "requested", statement: "shape of SF4", evidence: { source: "question", start, end: start + 3, quote: "SF4" } }],
    entities, expressions: [], constraints: [],
    representationIntents: [{ id: "i0", kind: "conceptual", entityIds: entities.map((entity) => entity.id), evidenceFactIds: ["f0"] }],
  } as unknown as ProblemIR;
}

type Select = typeof selectProductionScene;
const select = (run: Select, labels: string[]) => run({ question: STEM, turnPlan, problemIR: problem(labels), candidate: null, requiredRetryEnabled: true } as Parameters<Select>[0]);
const codes = (selection: ReturnType<Select>) => selection.attemptedRepresentation?.validationReport.issues.map((issue) => issue.code) ?? [];

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main(): Promise<void> {
  await check("draws", () => {
    const selection = select(selectProductionScene, ["SF4 molecule", "XeF4 molecule"]);
    assert.equal(selection.representation?.family, "chem_vsepr", selection.reason);
  });
  await check("recorded", () => {
    const selection = select(selectProductionScene, ["SF4 molecule", "XeF4 molecule", "H2O molecule"]);
    assert.equal(selection.representation, null, "a figure without H2O must not pass an H2O obligation");
    assert.ok(codes(selection).includes("missing_named_body"), codes(selection).join(","));
    assert.match(selection.reason, /H2O/);
  });

  // Mutant: the fallback without the recording, beside the original so its imports resolve.
  const source = fileURLToPath(new URL("../../features/tutor-session/lib/scene/representationFallback.ts", import.meta.url));
  const selectionSource = fileURLToPath(new URL("../../features/tutor-session/lib/scene/productionSceneSelection.ts", import.meta.url));
  const original = readFileSync(source, "utf8");
  const ANCHOR = "obligationMisses.length === 0 || selected.figureSource !== \"text_only\" ? selected : {";
  await check("mutation/no-recording", async () => {
    assert.ok(original.includes(ANCHOR), "mutation anchor is missing");
    const fallback = source.replace(/representationFallback\.ts$/, `representationFallback.mutant-${process.pid}.ts`);
    const selection = selectionSource.replace(/productionSceneSelection\.ts$/, `productionSceneSelection.mutant-${process.pid}.ts`);
    writeFileSync(fallback, original.replace(ANCHOR, "true ? selected : {"));
    writeFileSync(selection, readFileSync(selectionSource, "utf8").replace(/from "\.\/representationFallback"/g, `from "./representationFallback.mutant-${process.pid}"`));
    try {
      const mutant = (await import(selection)) as { selectProductionScene: Select };
      const result = select(mutant.selectProductionScene, ["SF4 molecule", "XeF4 molecule", "H2O molecule"]);
      assert.equal(result.representation, null);
      assert.ok(!codes(result).includes("missing_named_body"), "the mutant must lose the issue code");
    } finally {
      rmSync(fallback, { force: true });
      rmSync(selection, { force: true });
    }
  });

  console.log(`verify-chemistry-obligation-miss-recorded: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

void main();
