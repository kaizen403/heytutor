/**
 * Our own figure generators never draw a body across or inside its surface.
 *
 * The contact truth rules refuse planner candidates at admission and are off for
 * every other compile, so that saved boards still reopen. Generators are code we
 * own, so they are held here instead: a bounded sample of questions goes through
 * the archetype, family and last resort paths, and each document is compiled
 * with the admission rules on. Any contact code is red.
 *
 *   npx tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-contact-generators.ts   (from packages/scene-engine)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attemptArchetypeScene } from "../../src/archetypes";
import { compileSceneDocument } from "../../src/index";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities.ts";
import { ARCHETYPE_PROBES } from "../probes/archetypeProbes";

const CODES = new Set(["body_straddles_surface", "body_inside_surface", "string_through_surface"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const stems = (file: string, every: number): string[] => readFileSync(resolve(root, `data/diagram-eval/v1/${file}`), "utf8")
  .split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { question: string }).question).filter((_, index) => index % every === 0);
// Every physics stem, where bodies and surfaces live, and a sample of the other two.
// One stem hid what `pulley_incline` draws at other angles, so its angle is swept to the top of its range.
const inclineStem = (degrees: number) => `A 2 kg block on a ${degrees}° rough incline is connected by a light string over a smooth pulley to a hanging 3 kg block.`;
const angles = [...Array.from({ length: 17 }, (_, index) => 5 + index * 5), 88, 89].map(inclineStem);
const questions = [...new Set([...ARCHETYPE_PROBES.map((probe) => probe.question), ...angles, ...stems("physics.jsonl", 1), ...stems("maths.jsonl", 4), ...stems("chemistry.jsonl", 4)])];
const plan = (question: string) => ({
  schemaVersion: "turn-plan/v3" as const, question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" as const,
});
const started = Date.now();
const failures: string[] = [];
let documents = 0, withSurface = 0;
const check = (route: string, question: string, document: unknown) => {
  if (!document) return;
  documents += 1;
  if (JSON.stringify(document).match(/"role":"[^"]*\b(?:incline|inclined|ramp|slope|wedge|ground|floor|table|road|surface|wall)\b/i)) withSurface += 1;
  const report = compileSceneDocument(document as never, { figureConsistency: true }).report;
  const hits = report.issues.filter((issue) => CODES.has(issue.code));
  if (hits.length) failures.push(`${route}: ${[...new Set(hits.map((issue) => issue.code))].join(",")} on "${question.slice(0, 70)}": ${hits[0]!.message.slice(0, 120)}`);
};
for (const question of questions) {
  const turnPlan = plan(question);
  const families = inferSceneCapabilities(question, { lawIds: [], turnPlan: turnPlan as never } as never).families;
  check("archetype", question, attemptArchetypeScene({ question, turnPlan: turnPlan as never }).scene?.document);
  check("family", question, synthesizeFamilyScene({ question, families, turnPlan: turnPlan as never })?.document);
  check("last resort", question, synthesizeLastResortScene({ question, families, turnPlan: turnPlan as never })?.document);
}
// An incline must not lose its figure at these angles: an unbounded pulley position once shrank it until the compiler refused
// it, and rounding the pulley and its tangent point separately once put the point off the pulley at the fractional ones here.
for (const degrees of [5.4, 30, 45, 48.3, 59.6, 60, 60.3, 61, 75, 85, 88, 89]) {
  const question = inclineStem(degrees);
  if (!attemptArchetypeScene({ question, turnPlan: plan(question) as never }).scene) failures.push(`pulley_incline draws nothing at ${degrees} degrees`);
}
// A sample that draws nothing proves nothing.
if (documents < 1500 || withSurface < 300) failures.push(`the sample is too thin: ${documents} documents, ${withSurface} with a surface`);
for (const failure of failures) console.error(failure);
console.log(`verify-contact-generators: ${questions.length} questions, ${documents} documents, ${withSurface} with a surface, ${failures.length} refused, ${Math.round((Date.now() - started) / 1000)} s`);
if (failures.length) process.exit(1);
