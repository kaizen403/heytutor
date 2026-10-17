/**
 * Production admission regressions from the frozen 80-stem chemistry baseline.
 * Recorded run.plan is a lossy projection, not a TurnPlanV3: reconstruct and
 * validate its omitted schema/provenance/claim fields explicitly. Original
 * questions, values, expected claims and selected scene responses are retained.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isChemistryStem, validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Fixture = {
  id: string; round: number; question: string;
  plan: Omit<TurnPlanV3, "schemaVersion" | "question" | "derived" | "qualitativeClaims"> & {
    derived: Array<Omit<TurnPlanV3["derived"][number], "provenance">>;
    qualitativeClaims: Array<Pick<TurnPlanV3["qualitativeClaims"][number], "id" | "expected">>;
  };
  candidate: Record<string, unknown> | null;
};
const fixtures: Fixture[] = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/chemistry-launch-wrong.json", import.meta.url)), "utf8"));
const evidence: unknown[] = [];
const failures: string[] = [];
let passed = 0;
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function reconstruct(row: Fixture): TurnPlanV3 {
  const raw = {
    ...createFallbackTurnPlanV3(row.question), ...row.plan,
    derived: row.plan.derived.map((value) => ({ ...value, provenance: "derived" })),
    qualitativeClaims: row.plan.qualitativeClaims.map((value) => ({ ...value, claim: String(value.expected) })),
  };
  const valid = validateTurnPlanV3(raw, row.question);
  assert(valid.plan && valid.valid, `reconstructed plan is invalid: ${JSON.stringify(valid.issues)}`);
  return valid.plan;
}
for (const row of fixtures) check(`recorded-${row.id}-round-${row.round}`, () => {
  const plan = reconstruct(row);
  const gate = deriveSceneGate({ question: row.question, turnPlan: plan, problemIR: null });
  const selected = selectProductionScene({ question: row.question, turnPlan: plan, problemIR: null, candidate: row.candidate });
  evidence.push({ id: row.id, round: row.round, reconstructedPlanValid: true,
    chemistryLane: gate.chemistryLane, shouldAttemptLlmScene: gate.shouldAttemptLlmScene,
    selected: selected.representation !== null, family: selected.representation?.family ?? null,
    source: selected.representation?.figureSource ?? null, reason: selected.reason,
    labels: selected.representation?.renderScene.primitives.filter((p) => p.kind === "label" || p.kind === "dimension").map((p) => p.text) ?? [] });
  assert(gate.chemistryLane, "the full chemistry wording must reach the deterministic chemistry lane");
  assert.equal(gate.shouldAttemptLlmScene, false, "an unsupported chemistry ask cannot acquire model-authored geometry");
  assert.equal(gate.shouldPlanExactScene, false);
  assert.equal(selected.representation === null, true, "these unsupported multi-transition/scattering/corrosion asks must decline instead of drawing a wrong figure");
  assert.doesNotMatch(selected.reason, /undefined|matchAll|is not a function/i, "a caught runtime error is not a valid decline");
});

const paraphrases = [
  "Draw the energy-level diagram for hydrogen atoms emitting at n = 5 to 2 and n = 4 to 2, labelling each wavelength.",
  "A hydrogen atom makes transitions n = 6 to 3 and n = 5 to 3. Sketch the levels and compare photon wavelengths.",
  "Hydrogen atoms emit photons in transitions n = 4 to 1 and n = 3 to 1. Draw a common level diagram and label wavelengths.",
  "Draw the source, thin foil and detector of Rutherford scattering, including the rare backscattered particles.",
  "A beam of alpha particles hits a thin gold foil. Sketch the apparatus and the deflected trajectories near a nucleus.",
  "Alpha particles scatter from a thin metal foil. Draw the source, foil and detector, and the enlarged nucleus.",
  "Sketch iron corrosion under an aerated water drop, showing anodic and cathodic regions.",
  "Explain rusting of iron under a neutral water droplet with a diagram of oxygen reduction and electron flow.",
  "Draw the local corrosion cell beneath a droplet on iron; show the central anode and peripheral cathode.",
];
for (const [index, question] of paraphrases.entries()) check(`chemistry-paraphrase-${index + 1}`, () => {
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const gate = deriveSceneGate({ question, turnPlan, problemIR: null });
  assert(gate.chemistryLane, question);
  assert.equal(gate.shouldAttemptLlmScene, false);
  const selected = selectProductionScene({ question, turnPlan, problemIR: null });
  assert.equal(selected.representation === null, true, "an unsupported ask must not fall through to unrelated physics geometry");
  assert.doesNotMatch(selected.reason, /undefined|matchAll|is not a function/i);
});
for (const question of [
  "A hydrogen atom makes a Bohr transition fromn=2 to n=1. Using En=-13.6/n² eV and hc=1240 eV nm, find photon energy and wavelength.",
  "An alpha particle of energy 5 MeV scatters from a gold foil. Find the distance of closest approach.",
  "Two point charges +2 microcoulomb and -3 microcoulomb are separated by 2 m. Sketch the electric field.",
  "An alpha particle of mass 6.64e-27 kg moves at a velocity of 2e6 m/s in a magnetic field. Find the force.",
  "A radioactive alpha source emits particles of kinetic energy 4 MeV. Find their speed.",
  "A thin metal foil is used as a capacitor plate. Find the electric field between the plates.",
]) check(`physics-neighbor-${question.slice(0, 35)}`, () => {
  const turnPlan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  assert.equal(deriveSceneGate({ question, turnPlan, problemIR: null }).chemistryLane, false, question);
});

check("closest-approach-is-not-new-chemistry-evidence", () => {
  const question = "An alpha particle with kinetic energy 5 MeV approaches a gold nucleus head-on. Find the distance of closest approach.";
  // The existing Lewis cue independently matches "head-on" as overlap. This
  // change must not add atomic-experiment subject evidence to that old route.
  assert.equal(isChemistryStem(question), false);
});

// Both a compact complete product and the original overlong parenthesised
// reaction must be refused through production admission, rather than judged
// safe because a shortened callout still contains some readable characters.
const corrosion = fixtures.find((row) => row.id === "CHEM_H80_XII_010" && row.round === 2)!;
for (const text of ["Fe(OH)₂", "Fe²⁺ + 2OH⁻ → Fe(OH)₂; further oxidation can form rust"]) check(`corrosion-callout-${text.length}-characters`, () => {
  const candidate = structuredClone(corrosion.candidate)!;
  const annotations = candidate.annotations as Array<{ id: string; text?: string }>;
  annotations.find((annotation) => annotation.id === "productFormation")!.text = text;
  const selected = selectProductionScene({ question: corrosion.question, turnPlan: reconstruct(corrosion), problemIR: null, candidate });
  assert.equal(selected.representation === null, true, "neither short nor overlong callouts confer chemistry figure authority");
  assert.doesNotMatch(selected.reason, /undefined|matchAll|is not a function/i);
});
const out = process.argv.indexOf("--out");
if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify({ fixtureCount: fixtures.length, passed, failures, planCaveat: "Recorded run.plan projections are reconstructed and validated; omitted claim hints cannot be recovered.", evidence }, null, 2) + "\n");
console.log(`verify-chemistry-launch-wrong: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
