/**
 * Contract check for the C-08/C-09 provider-text fixtures.
 * Plans and problem statements only. No scene document is loaded from the fixture.
 */
import { readFileSync } from "node:fs";
import { validateTurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateProblemIR } from "../../src/ir/problemIR";

const raw = JSON.parse(readFileSync(
  new URL("../../../../.context/c08-c09/controlled-provider-v2/fixtures.json", import.meta.url),
  "utf8",
)) as Record<string, { plan: unknown }>;

const failures: string[] = [];
for (const [id, fixture] of Object.entries(raw)) {
  const plan = validateTurnPlanV3(fixture.plan);
  if (!plan.valid || !plan.plan) {
    failures.push(`${id} plan: ${plan.issues.map((issue) => issue.message).join("; ")}`);
    continue;
  }
  const question = plan.plan.question;
  const again = validateTurnPlanV3(fixture.plan, question);
  if (!again.valid) failures.push(`${id} question mismatch`);
  const problem = validateProblemIR({
    schemaVersion: "problem-ir/v1",
    id: "pilotFixture",
    question,
    facts: [{
      id: "stem",
      kind: "given",
      statement: question,
      evidence: { source: "question", start: 0, end: question.length, quote: question },
    }],
    entities: [],
    expressions: [],
    constraints: [],
    representationIntents: [],
    solveRequests: [],
  }, question);
  if (!problem.problem) {
    failures.push(`${id} problem IR: ${problem.issues.map((issue) => issue.message).join("; ")}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("verify-c08-c09-fixtures: ok");
