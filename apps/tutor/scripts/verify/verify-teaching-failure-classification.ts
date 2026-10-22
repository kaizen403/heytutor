/** Real handler classification from real Fetch/SSE boundaries, with no providers. */
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { scenario, type FrozenStartupFixture } from "./verify-startup-turn";

const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: "Explain the relationship between force and acceleration.",
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none",
};

async function main() {
  const failures: NonNullable<FrozenStartupFixture["teachingFailure"]>[] = ["fetch", "read", "callback", "internal", "auth", "forbidden", "cancel"];
  for (const teachingFailure of failures) {
    const receipt = await scenario("ready", true, false, { plan, teachingFailure });
    console.log("actual teaching failure classification:", receipt);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
