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
 * it there, are admitted. Only surfaces the document declares refracting are
 * checked: a concave mirror's correct image, in a plan that also names a
 * glass index, is admitted.
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

/**
 * Review of #164: spherical_surface also draws mirrors. A concave mirror
 * (vertex 0, centre -30 cm) with its object at -20 cm and the image at -60 cm,
 * in a plan that also carries a glass index n = 1.5. Refraction would put the
 * image at -22.5 or -17.14 cm; the mirror's image is right and must stand.
 */
function concaveMirror(): { document: Doc; plan: TurnPlanV3 } {
  const question = "A glass block has refractive index 1.5. Separately, an object stands 20 cm in front of a concave mirror of radius of curvature 30 cm. Where is the image?";
  const point = (id: string, x: number) => ({ id: `make_${id}`, operator: "point", inputs: { x, y: 0, coordinateSpace: "world" }, outputs: [id] });
  const entities = [
    { id: "V", kind: "point", role: "pole", label: "P" },
    { id: "C", kind: "point", role: "centre of curvature", label: "C" },
    { id: "F", kind: "point", role: "principal focus", label: "F" },
    { id: "O", kind: "point", role: "object", label: "O" },
    { id: "I", kind: "point", role: "real image", label: "I" },
    { id: "axis", kind: "line", role: "principal axis" },
    { id: "mirror", kind: "arc", role: "concave mirror" },
  ];
  const ids = entities.map((entity) => entity.id);
  const document = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "The mirror, its axis, the object and the image have stated positions." },
    source: { question },
    quantities: [
      { id: "n", symbol: "n", value: 1.5 },
      { id: "R", symbol: "R", value: 30, unit: "cm" },
      { id: "u", symbol: "u", value: 20, unit: "cm" },
      { id: "f", symbol: "f", value: 15, unit: "cm" },
      { id: "v", symbol: "v", value: 60, unit: "cm" },
    ],
    entities,
    constructions: [
      point("V", 0), point("C", -30), point("F", -15), point("O", -20), point("I", -60),
      { id: "make_axis", operator: "line", inputs: { start: "V", direction: [1, 0] }, outputs: ["axis"] },
      { id: "make_mirror", operator: "spherical_surface", inputs: { vertex: "V", axis: "axis", center: "C", signedRadius: -30, halfHeight: 12, kind: "concave" }, outputs: ["mirror"] },
    ],
    relations: [],
    assertions: [
      { id: "objectOnAxis", predicate: "on", entities: ["O", "axis"], expected: true, severity: "fatal" },
      { id: "imageOnAxis", predicate: "on", entities: ["I", "axis"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids }],
    teachingTimeline: [{ action: "reveal", targetId: "setup" }],
  } as unknown as Doc;
  const quantity = (id: string, symbol: string, value: number, unit?: string) => ({ id, symbol, value, ...(unit ? { unit } : {}) });
  const plan = {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [
      { ...quantity("n", "n", 1.5), provenance: "given", sourceText: "refractive index 1.5" },
      { ...quantity("R", "R", 30, "cm"), provenance: "given", sourceText: "radius of curvature 30 cm" },
      { ...quantity("u", "u", 20, "cm"), provenance: "given", sourceText: "20 cm in front" },
    ],
    unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
    derived: [quantity("f", "f", 15, "cm"), quantity("v", "v", 60, "cm")],
    qualitativeClaims: [],
    lawIds: ["mirror equation"],
    assumptions: [],
    visualRequirement: "required",
  } as unknown as TurnPlanV3;
  return { document, plan };
}

check("control: a concave mirror's correct image at -60 cm is admitted beside a glass index", () => {
  const { document, plan } = concaveMirror();
  const { valid, codes } = validate(document, plan);
  return valid ? null : `declined with ${codes.join(", ")}`;
});

/**
 * Review of #164: a glass sphere seen through both faces (R = 10 cm, n = 1.5,
 * object 30 cm before the first vertex). The faces stand at x = 0 and x = 20
 * around the centre x = 10. The first face images the object 90 cm past its
 * vertex; that image is a virtual object 70 cm past the second vertex, whose
 * face puts the final image 14 cm past it (x = 34). Only the object sits at a
 * given distance, so the final image is right only through the first.
 */
function twoFaceSphere(finalImageDistance: number): { document: Doc; plan: TurnPlanV3 } {
  const question = "A glass sphere of radius 10 cm has refractive index 1.5. An object on its axis stands 30 cm before the near surface. Find the image formed by each surface.";
  const point = (id: string, x: number) => ({ id: `make_${id}`, operator: "point", inputs: { x, y: 0, coordinateSpace: "world" }, outputs: [id] });
  const entities = [
    { id: "V1", kind: "point", role: "first vertex", label: "P1" },
    { id: "V2", kind: "point", role: "second vertex", label: "P2" },
    { id: "C", kind: "point", role: "centre", label: "C" },
    { id: "O", kind: "point", role: "object", label: "O" },
    { id: "I1", kind: "point", role: "first image", label: "I1" },
    { id: "I2", kind: "point", role: "final image", label: "I2" },
    { id: "axis", kind: "line", role: "principal axis" },
    { id: "s1", kind: "arc", role: "first face" },
    { id: "s2", kind: "arc", role: "second face" },
  ];
  const ids = entities.map((entity) => entity.id);
  const quantity = (id: string, symbol: string, value: number, unit?: string) => ({ id, symbol, value, ...(unit ? { unit } : {}) });
  const document = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "The sphere, its axis, the object and both images have stated positions." },
    source: { question },
    quantities: [
      quantity("R", "R", 10, "cm"), quantity("n", "n", 1.5), quantity("u", "u", 30, "cm"),
      quantity("v1", "v1", 90, "cm"), quantity("v2", "v2", finalImageDistance, "cm"),
    ],
    entities,
    constructions: [
      point("V1", 0), point("V2", 20), point("C", 10), point("O", -30), point("I1", 90), point("I2", 20 + finalImageDistance),
      { id: "make_axis", operator: "line", inputs: { start: "V1", direction: [1, 0] }, outputs: ["axis"] },
      { id: "make_s1", operator: "spherical_surface", inputs: { vertex: "V1", axis: "axis", center: "C", halfHeight: 8 }, outputs: ["s1"] },
      { id: "make_s2", operator: "spherical_surface", inputs: { vertex: "V2", axis: "axis", center: "C", halfHeight: 8 }, outputs: ["s2"] },
    ],
    relations: [],
    assertions: [
      { id: "objectOnAxis", predicate: "on", entities: ["O", "axis"], expected: true, severity: "fatal" },
      { id: "firstImageOnAxis", predicate: "on", entities: ["I1", "axis"], expected: true, severity: "fatal" },
      { id: "finalImageOnAxis", predicate: "on", entities: ["I2", "axis"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids }],
    teachingTimeline: [{ action: "reveal", targetId: "setup" }],
  } as unknown as Doc;
  const plan = {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [
      { ...quantity("R", "R", 10, "cm"), provenance: "given", sourceText: "radius 10 cm" },
      { ...quantity("n", "n", 1.5), provenance: "given", sourceText: "refractive index 1.5" },
      { ...quantity("u", "u", 30, "cm"), provenance: "given", sourceText: "30 cm before the near surface" },
    ],
    unknowns: [{ id: "v1", symbol: "v1", unit: "cm" }, { id: "v2", symbol: "v2", unit: "cm" }],
    derived: [quantity("v1", "v1", 90, "cm"), quantity("v2", "v2", finalImageDistance, "cm")],
    qualitativeClaims: [],
    lawIds: ["paraxial refraction at a spherical surface: n₂/v−n₁/u=(n₂−n₁)/R"],
    assumptions: [],
    visualRequirement: "required",
  } as unknown as TurnPlanV3;
  return { document, plan };
}

check("two face glass sphere: the first image (90 cm) is the second face's object, the final image at 14 cm is admitted", () => {
  const { document, plan } = twoFaceSphere(14);
  const { valid, codes } = validate(document, plan);
  return valid ? null : `declined with ${codes.join(", ")}`;
});

check("control: the same sphere with the final image at 20 cm, not 14, declines for that image", () => {
  const { document, plan } = twoFaceSphere(20);
  const { valid, codes } = validate(document, plan);
  if (valid) return "admitted with the final image 20 cm past the second face (the law gives 14 cm)";
  const count = codes.filter((code) => code === "spherical_refraction_image_disagrees").length;
  if (count !== 1) return `declined with ${codes.join(", ")}; expected spherical_refraction_image_disagrees once`;
  return null;
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
