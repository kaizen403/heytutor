/** Replays protocol shapes offline; optional private evidence is never printed or saved. */
import { readFileSync } from "node:fs";
import { scenario } from "./verify-startup-turn";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: "Derive the formula for the range of a projectile on level ground.",
  givens: [], unknowns: [{ id: "range", symbol: "R" }], derived: [],
  qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"], visualRequirement: "required",
};
const fixtures = [
  { name: "header-body", response: "[STEP]We need the exact question. [WRITE:y=475]need: exact question[/WRITE] Please supply it.[/STEP]", writes: 1 },
  { name: "named-coordinates", response: "[STEP]We need a class and subject. [WRITE:same number, different topic,x=60,y=475][/STEP]", writes: 0 },
  { name: "coordinate-less", response: "[STEP]The normal force is mg cos theta. [WRITE:N = mg cos θ][/STEP]", writes: 1 },
  { name: "one-coordinate", response: "[STEP]The normal force is mg cos theta. [WRITE:N = mg cos θ,277][/STEP]", writes: 1 },
];
const privateDirectory = process.env.HISTORICAL_LANGFUSE_DIR;
if (privateDirectory) {
  for (const issue of ["G", "Z"] as const) {
    const data = JSON.parse(readFileSync(`${privateDirectory}/HEYTUTOR-${issue}.json`, "utf8")) as {
      observations: Array<{ name: string; startTime: string; output: string }>;
    };
    const generations = data.observations.filter(o => o.name === "fireworks-llm").sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const [index, generation] of generations.entries()) fixtures.push({
      name: `HEYTUTOR-${issue}-attempt-${index + 1}`, response: generation.output,
      writes: { G: [2, 0], Z: [8, 9] }[issue][index]!,
    });
  }
}
async function main() {
  for (const fixture of fixtures) {
    await scenario("resume-no-ink", false, false, { plan, resumeTeaching: {
      responses: fixture.writes ? [fixture.response] : [fixture.response, fixture.response], expectedWrites: fixture.writes,
    } });
    console.log(`resume replay ${fixture.name}: ${fixture.writes} accepted writes, ${fixture.writes ? "one request" : "rejected without completion"}, no providers`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
