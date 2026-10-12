/**
 * Production selection holds a placed refraction image to the law (Harness 4, R5).
 *
 * Round 7 (m1, glass sphere h8a): a bubble 4 cm from the near surface of a
 * glass sphere (n = 1.5, R = 8 cm). The planner put the near and far images
 * at literal points 2.29 and 5.33 cm from the surfaces, numbers from a
 * ProblemIR expression with the sign of (n2 - n1)/R flipped; the law gives
 * 3.2 cm, and 16 cm (at the near surface). The figure was admitted.
 *
 * A literal image point at a plan-derived distance from a declared
 * spherical_surface's vertex must be the law's image of a declared object,
 * or the candidate declines with `spherical_refraction_image_disagrees`. The
 * same document with the correct 3.2 cm image, and the b1 figure that placed
 * it there, are admitted.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-spherical-refraction-selection.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Doc = Record<string, unknown> & {
  entities: Array<{ id: string }>;
  constructions: Array<{ id: string; outputs: string[]; inputs: Record<string, unknown> }>;
  assertions: Array<{ entities: string[] }>;
  annotations: Array<{ targetIds?: string[] }>;
  requiredEntityIds: string[];
  revealGroups: Array<{ entityIds: string[] }>;
};

const fixture = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../../../../packages/scene-engine/scripts/verify/fixtures/ray-optics-instruments.json"),
  "utf8",
)) as { documents: Record<string, Doc>; plans: Record<string, TurnPlanV3> };

const failures: string[] = [];
let passed = 0;
function check(name: string, run: () => string | null): void {
  let problem: string | null;
  try { problem = run(); } catch (error) { problem = `threw: ${error instanceof Error ? error.message : String(error)}`; }
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else { passed += 1; console.log(`pass ${name}`); }
}

function validate(document: Doc, plan: TurnPlanV3) {
  const result = validateProductionSceneCandidate({ candidate: structuredClone(document), question: plan.question, turnPlan: plan });
  return { valid: result.valid, codes: (result.errors ?? []).filter((issue) => issue.severity === "fatal").map((issue) => issue.code) };
}

check("recorded sphere: images at 2.29 and 5.33 cm decline", () => {
  const { valid, codes } = validate(fixture.documents.sphere!, fixture.plans.sphere!);
  if (valid) return "admitted with both images off the law (3.2 cm and 16 cm)";
  const count = codes.filter((code) => code === "spherical_refraction_image_disagrees").length;
  if (count !== 2) return `declined with ${codes.join(", ")}; expected spherical_refraction_image_disagrees for both images`;
  return null;
});

/** The same recorded document with the near image where the law puts it, the far image (on the near vertex) removed. */
function correctedSphere(): { document: Doc; plan: TurnPlanV3 } {
  const document = structuredClone(fixture.documents.sphere!);
  const dropped = new Set(["farImage", "farImageDim"]);
  const keep = (ids: string[] | undefined) => !(ids ?? []).some((id) => dropped.has(id));
  document.entities = document.entities.filter((entity) => !dropped.has(entity.id));
  document.constructions = document.constructions
    .filter((construction) => keep(construction.outputs))
    .map((construction) => construction.outputs.includes("nearImage")
      ? { ...construction, inputs: { ...construction.inputs, x: 3.2 } }
      : construction);
  document.assertions = document.assertions.filter((assertion) => keep(assertion.entities));
  document.annotations = document.annotations.filter((annotation) => keep(annotation.targetIds));
  document.requiredEntityIds = document.requiredEntityIds.filter((id) => !dropped.has(id));
  document.revealGroups = document.revealGroups.map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => !dropped.has(id)) }));
  const values: Record<string, number> = { vn: 3.2, mn: 1.2, vf: 16, mf: 2 };
  document.quantities = (document.quantities as Array<{ id: string; value: number }>).map((quantity) =>
    quantity.id in values ? { ...quantity, value: values[quantity.id]! } : quantity);
  const plan = structuredClone(fixture.plans.sphere!);
  plan.derived = plan.derived.map((quantity) => quantity.id in values ? { ...quantity, value: values[quantity.id]! } : quantity);
  return { document, plan };
}

check("control: the same figure with the near image at 3.2 cm is admitted", () => {
  const { document, plan } = correctedSphere();
  const { valid, codes } = validate(document, plan);
  return valid ? null : `declined with ${codes.join(", ")}`;
});

check("control: recorded b1 sphere with its image at 3.2 cm is admitted", () => {
  const { valid, codes } = validate(fixture.documents.sphereCorrect!, fixture.plans.sphereCorrect!);
  return valid ? null : `declined with ${codes.join(", ")}`;
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
