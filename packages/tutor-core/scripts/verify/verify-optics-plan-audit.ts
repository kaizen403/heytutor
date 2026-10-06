import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { reconcileTurnPlanWithOpticsLaws, type OpticsPlanAuditResult } from "../../src/planners/opticsPlanAudit";

// The audit must never change a plan value. A plan value that disagrees with a
// law under an unambiguous convention is reported as an inconsistency carrying
// the law's value (turnPlannerV3 then rejects the lane); the plan comes back untouched.
const closeTo = (actual: number, expected: number) =>
  Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
function auditUnchanged(name: string, plan: TurnPlanV3): OpticsPlanAuditResult {
  const before = JSON.stringify(plan);
  const audit = reconcileTurnPlanWithOpticsLaws(plan);
  if (audit.plan !== plan || JSON.stringify(audit.plan) !== before || JSON.stringify(plan) !== before) {
    throw new Error(`${name}: the optics audit changed the plan: ${JSON.stringify(audit.plan.derived)}`);
  }
  return audit;
}
/** Every listed quantity is reported with the law's value, and nothing else is. */
function expectReported(name: string, audit: OpticsPlanAuditResult, plan: TurnPlanV3, lawValues: Record<string, number>): void {
  const detail = JSON.stringify({ inconsistencies: audit.inconsistencies, declined: audit.declined });
  const ids = Object.keys(lawValues);
  if (audit.inconsistencies.length !== ids.length) throw new Error(`${name}: expected ${ids.length} reported inconsistencies: ${detail}`);
  for (const id of ids) {
    const item = audit.inconsistencies.find((entry) => entry.quantityId === id);
    const planValue = plan.derived.find((quantity) => quantity.id === id)?.value;
    if (!item || !closeTo(item.lawValue, lawValues[id]!) || item.planValue !== planValue) {
      throw new Error(`${name}: ${id} should be reported as plan ${planValue} against law ${lawValues[id]}: ${detail}`);
    }
  }
}

const mirrorPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "A concave mirror has focal length 15 cm and an object is 20 cm away.",
  givens: [
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given" },
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
  ],
  unknowns: [
    { id: "v", symbol: "v", unit: "cm" },
    { id: "m", symbol: "m", unit: "1" },
  ],
  derived: [
    { id: "v", symbol: "v", value: 12, unit: "cm", provenance: "derived", dependsOn: ["u", "f"] },
    { id: "m", symbol: "m", value: 0.6, unit: "1", provenance: "derived", dependsOn: ["u", "v"] },
  ],
  qualitativeClaims: [],
  lawIds: ["mirror formula"],
  assumptions: [],
  visualRequirement: "required",
};

const mirrorAudit = auditUnchanged("mirror law", mirrorPlan);
expectReported("mirror law", mirrorAudit, mirrorPlan, { v: 60, m: -3 });

const ydsePlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "Find the fringe width in Young double-slit experiment.",
  givens: [
    { id: "lambda", symbol: "lambda", value: 600, unit: "nm", provenance: "given" },
    { id: "D", symbol: "D", value: 2, unit: "m", provenance: "given" },
    { id: "d", symbol: "d", value: 0.5, unit: "mm", provenance: "given" },
  ],
  unknowns: [{ id: "beta", symbol: "beta", unit: "mm" }],
  derived: [
    { id: "lambda_m", symbol: "λ", value: 600e-9, unit: "m", provenance: "derived" },
    { id: "beta_m", symbol: "beta_m", value: 0.0000024, unit: "m", provenance: "derived" },
    { id: "beta", symbol: "beta", value: 1, unit: "mm", provenance: "derived" },
  ],
  qualitativeClaims: [],
  lawIds: ["YDSE fringe width"],
  assumptions: [],
  visualRequirement: "required",
};
const ydseAudit = auditUnchanged("mixed-unit YDSE", ydsePlan);
expectReported("mixed-unit YDSE", ydseAudit, ydsePlan, { beta_m: 0.0024, beta: 2.4 });

const liveYdsePlan = structuredClone(ydsePlan);
liveYdsePlan.lawIds = ["wave-optics:double-slit-interference"];
liveYdsePlan.derived = [
  { id: "beta", symbol: "beta", value: 2400, unit: "mm", provenance: "derived" },
];
const liveYdseAudit = auditUnchanged("live YDSE law alias", liveYdsePlan);
if (liveYdseAudit.checkedLawIds[0] !== "ydse_fringe_width") {
  throw new Error(`live YDSE law alias was not recognized: ${JSON.stringify(liveYdseAudit)}`);
}
expectReported("live YDSE law alias", liveYdseAudit, liveYdsePlan, { beta: 2.4 });

const divergingLensPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "An object is 20 cm from a diverging lens of focal length -10 cm.",
  givens: [
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given" },
    { id: "f", symbol: "f", value: -10, unit: "cm", provenance: "given" },
  ],
  unknowns: [
    { id: "v", symbol: "v", unit: "cm" },
    { id: "m", symbol: "m", unit: "1" },
  ],
  derived: [
    { id: "v", symbol: "v", value: 20, unit: "cm", provenance: "derived" },
    { id: "m", symbol: "m", value: -1, unit: "1", provenance: "derived" },
  ],
  qualitativeClaims: [],
  lawIds: ["thin lens formula"],
  assumptions: [],
  visualRequirement: "required",
};
// The law values keep their signs: v = -20/3 and m = +1/3 from signed distances.
const divergingLensAudit = auditUnchanged("diverging lens", divergingLensPlan);
expectReported("diverging lens", divergingLensAudit, divergingLensPlan, { v: -20 / 3, m: 1 / 3 });

const phasePlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "Find the phase difference in degrees.",
  givens: [
    { id: "delta_x", symbol: "Δx", value: 0.25, unit: "um", provenance: "given" },
    { id: "lambda", symbol: "λ", value: 1, unit: "um", provenance: "given" },
  ],
  unknowns: [{ id: "phi", symbol: "φ", unit: "degree" }],
  derived: [{ id: "phi", symbol: "φ", value: 0, unit: "degree", provenance: "derived" }],
  qualitativeClaims: [],
  lawIds: ["phase difference"],
  assumptions: [],
  visualRequirement: "optional",
};
const phaseAudit = auditUnchanged("phase difference in degrees", phasePlan);
expectReported("phase difference in degrees", phaseAudit, phasePlan, { phi: 90 });

const singleSlitPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "Find the angular width of the central maximum in degrees.",
  givens: [
    { id: "lambda", symbol: "λ", value: 500, unit: "nm", provenance: "given" },
    { id: "a", symbol: "a", value: 0.2, unit: "mm", provenance: "given" },
    { id: "D", symbol: "D", value: 2, unit: "m", provenance: "given" },
  ],
  unknowns: [{ id: "angular_width", symbol: "theta", unit: "degree" }],
  derived: [{ id: "angular_width", symbol: "theta", value: 0, unit: "degree", provenance: "derived" }],
  qualitativeClaims: [],
  lawIds: ["single slit diffraction"],
  assumptions: [],
  visualRequirement: "optional",
};
const singleSlitAudit = auditUnchanged("single-slit angular width in degrees", singleSlitPlan);
expectReported("single-slit angular width in degrees", singleSlitAudit, singleSlitPlan, { angular_width: 0.005 * 180 / Math.PI });

const telescopeResolutionPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "Find the diffraction-limited angular resolution in degrees.",
  givens: [
    { id: "lambda", symbol: "λ", value: 550, unit: "nm", provenance: "given" },
    { id: "D", symbol: "D", value: 10, unit: "cm", provenance: "given" },
  ],
  unknowns: [{ id: "theta_min", symbol: "theta_min", unit: "degree" }],
  derived: [{ id: "theta_min", symbol: "theta_min", value: 0, unit: "degree", provenance: "derived" }],
  qualitativeClaims: [],
  lawIds: ["telescope resolution"],
  assumptions: [],
  visualRequirement: "optional",
};
const telescopeResolutionAudit = auditUnchanged("telescope resolution in degrees", telescopeResolutionPlan);
expectReported("telescope resolution in degrees", telescopeResolutionAudit, telescopeResolutionPlan, { theta_min: 1.22 * 550e-9 / 0.1 * 180 / Math.PI });

const microscopePlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: "A compound microscope has objective 4 mm and eyepiece 2.5 cm. An object is 4.5 mm from the objective. The final image is at the near point 25 cm from the eyepiece. Find the tube length and magnifying power.",
  givens: [
    { id: "f_o", symbol: "f_o", value: 4, unit: "mm", provenance: "given" },
    { id: "f_e", symbol: "f_e", value: 2.5, unit: "cm", provenance: "given" },
    { id: "u_o", symbol: "u_o", value: 4.5, unit: "mm", provenance: "given" },
    { id: "D", symbol: "D", value: 25, unit: "cm", provenance: "given" },
  ],
  unknowns: [
    { id: "tube_length", symbol: "L", unit: "cm" },
    { id: "magnifying_power", symbol: "M", unit: "dimensionless" },
  ],
  derived: [
    { id: "tube_length", symbol: "L", value: 1.327, unit: "cm", provenance: "derived", dependsOn: ["f_o", "u_o", "f_e", "D"] },
    { id: "magnifying_power", symbol: "M", value: 88, unit: "dimensionless", provenance: "derived", dependsOn: ["tube_length"] },
    { id: "v_o", symbol: "v_o", value: 36, unit: "mm", provenance: "derived", dependsOn: ["f_o", "u_o"] },
    { id: "v_o_cm", symbol: "v_o", value: 36, unit: "cm", provenance: "derived", dependsOn: ["v_o"] },
  ],
  qualitativeClaims: [],
  lawIds: ["compound_microscope_formula", "lens_formula"],
  assumptions: [],
  visualRequirement: "required",
};
// Tube length from the object distance, a signed two-lens magnifying power, and
// the mixed-unit image distance (36 mm written as 36 cm) are all reported.
const microscopeAudit = auditUnchanged("compound microscope", microscopePlan);
expectReported("compound microscope", microscopeAudit, microscopePlan, { tube_length: 3.6 + 25 / 11, magnifying_power: -88, v_o_cm: 3.6 });

const unrelated = structuredClone(mirrorPlan);
unrelated.lawIds = ["conservation_of_energy"];
const unrelatedAudit = auditUnchanged("non-optics plan", unrelated);
if (unrelatedAudit.inconsistencies.length !== 0 || unrelatedAudit.checkedLawIds.length !== 0) {
  throw new Error("non-optics plan was modified");
}

// Sign conventions. Each plan states its distances in one convention; the audit must
// read that convention from the plan and never mix it with another. Expected values
// are derived by hand in the comments; numbers are chosen apart from the replay fixtures.
type Sign = TurnPlanV3["givens"][number]["sign"];
interface SignedInput { value: number; sign?: Sign }
function opticsPlan(options: {
  question: string;
  lawIds: string[];
  givens: Record<string, SignedInput>;
  derived: Record<string, SignedInput>;
  claims?: string[];
  assumptions?: string[];
}): TurnPlanV3 {
  const quantity = (id: string, input: SignedInput, provenance: "given" | "derived") => ({
    id,
    symbol: id,
    value: input.value,
    unit: id === "m" ? "1" : "cm",
    ...(input.sign ? { sign: input.sign } : {}),
    provenance,
  });
  return {
    schemaVersion: "turn-plan/v3",
    question: options.question,
    givens: Object.entries(options.givens).map(([id, input]) => quantity(id, input, "given")),
    unknowns: Object.keys(options.derived).map((id) => ({ id, symbol: id, unit: id === "m" ? "1" : "cm" })),
    derived: Object.entries(options.derived).map(([id, input]) => quantity(id, input, "derived")),
    qualitativeClaims: (options.claims ?? []).map((claim, index) => ({ id: `c${index}`, claim, expected: true })),
    lawIds: options.lawIds,
    assumptions: options.assumptions ?? [],
    visualRequirement: "required",
  };
}
function expectAudit(
  name: string,
  plan: TurnPlanV3,
  expected: { reported?: Record<string, number>; declined?: RegExp },
): void {
  const audit = auditUnchanged(name, plan);
  expectReported(name, audit, plan, expected.reported ?? {});
  const detail = JSON.stringify({ derived: audit.plan.derived, inconsistencies: audit.inconsistencies, declined: audit.declined });
  if (expected.declined && !audit.declined.some((item) => expected.declined!.test(item.reason))) {
    throw new Error(`${name}: expected a decline matching ${expected.declined}: ${detail}`);
  }
  if (!expected.declined && audit.declined.length > 0) throw new Error(`${name}: unexpected decline: ${detail}`);
}

// Concave mirror, Cartesian, real image. u = -30, f = -10:
// 1/v = 1/f - 1/u = -1/10 + 1/30 = -1/15, v = -15 (real, in front); m = -v/u = -(-15)/(-30) = -0.5.
expectAudit("cartesian concave mirror real image", opticsPlan({
  question: "An object stands 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: -30 }, f: { value: -10 } },
  derived: { v: { value: -15 }, m: { value: -0.5 } },
}), {});

// Concave mirror, Cartesian, virtual image, with a genuine slip (the plan added
// 1/12 + 1/6 = 1/4). u = -6, f = -12: 1/v = -1/12 + 1/6 = 1/12, v = +12 (virtual,
// behind); m = -v/u = -12/(-6) = +2. The plan's v = 4 and m = 2/3 must be reported, and left unchanged.
expectAudit("cartesian concave mirror virtual image slip", opticsPlan({
  question: "An object is 6 cm in front of a concave mirror of focal length 12 cm.",
  lawIds: ["mirror equation"],
  givens: { u: { value: -6, sign: "negative" }, f: { value: -12, sign: "negative" } },
  derived: { v: { value: 4 }, m: { value: 2 / 3 } },
}), { reported: { v: 12, m: 2 } });

// Convex mirror, Cartesian (the mixed convention bug shape). u = -40, f = +10:
// 1/v = 1/10 + 1/40 = 1/8, v = +8 (virtual, behind); m = -8/(-40) = +0.2.
// Taking |u| with a signed f would give v = 10*40/30 = 13.3 and overwrite a right plan.
expectAudit("cartesian convex mirror stays correct", opticsPlan({
  question: "An object is 40 cm in front of a convex mirror of focal length 10 cm. Where is the image?",
  lawIds: ["mirror_formula"],
  givens: { u: { value: -40 }, f: { value: 10 } },
  derived: { v: { value: 8 }, m: { value: 0.2 } },
}), {});

// Convex mirror, real-is-positive, with a slip (the plan dropped the sign of f).
// u = 40, f = -10: v = fu/(u - f) = -400/50 = -8 (virtual); m = -v/u = 8/40 = 0.2.
// The plan's v = -40/3 and m = 1/3 come from f = +10 and must be reported, and left unchanged.
expectAudit("real-is-positive convex mirror slip", opticsPlan({
  question: "An object is 40 cm in front of a convex mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 40 }, f: { value: -10 } },
  derived: { v: { value: -40 / 3 }, m: { value: 1 / 3 } },
  assumptions: ["real-is-positive sign convention"],
}), { reported: { v: -8, m: 0.2 } });

// Converging lens, Cartesian, real image, with a slip (the plan used 1/v = 1/f + 1/|u|).
// u = -30, f = +20: 1/v = 1/f + 1/u = 1/20 - 1/30 = 1/60, v = +60 (real); m = v/u = 60/(-30) = -2.
expectAudit("cartesian converging lens slip", opticsPlan({
  question: "An object is 30 cm from a converging lens of focal length 20 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -30 }, f: { value: 20 } },
  derived: { v: { value: 12 }, m: { value: -0.4 } },
}), { reported: { v: 60, m: -2 } });

// Diverging lens, Cartesian, virtual image. u = -20, f = -20:
// 1/v = -1/20 - 1/20 = -1/10, v = -10 (virtual, object side); m = v/u = -10/(-20) = 0.5.
expectAudit("cartesian diverging lens virtual image", opticsPlan({
  question: "An object is 20 cm from a diverging lens of focal length 20 cm.",
  lawIds: ["lens equation"],
  givens: { u: { value: -20 }, f: { value: -20 } },
  derived: { v: { value: -10 }, m: { value: 0.5 } },
}), {});

// Converging lens, real-is-positive, virtual image (object inside F). u = 10, f = 15:
// v = fu/(u - f) = 150/(-5) = -30 (virtual); m = -v/u = 30/10 = 3.
expectAudit("real-is-positive converging lens virtual image", opticsPlan({
  question: "An object is 10 cm from a convex lens of focal length 15 cm.",
  lawIds: ["thin_lens_formula"],
  givens: { u: { value: 10 }, f: { value: 15 } },
  derived: { v: { value: -30 }, m: { value: 3 } },
}), {});

// Magnitudes under a stated Cartesian convention, with a slip. Convex mirror,
// |u| = 60, |f| = 20, so u = -60 and f = +20: 1/v = 1/20 + 1/60 = 1/15, v = +15;
// m = -15/(-60) = 0.25. The plan's v = 30 must be reported, and left unchanged.
expectAudit("declared cartesian with magnitudes", opticsPlan({
  question: "An object is 60 cm in front of a convex mirror of focal length 20 cm.",
  lawIds: ["mirror formula", "Cartesian sign convention"],
  givens: { u: { value: 60, sign: "unsigned" }, f: { value: 20, sign: "unsigned" } },
  derived: { v: { value: 30 }, m: { value: 0.25 } },
}), { reported: { v: 15 } });

// Ambiguous: u = 25 is real-is-positive, f = -10 for a concave mirror is Cartesian.
// Cartesian reading gives v = -50/3, real-is-positive with f = -10 gives v = -250/35.
// The plan's v must stand untouched.
expectAudit("mixed conventions decline", opticsPlan({
  question: "An object is 25 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 25 }, f: { value: -10 } },
  derived: { v: { value: -50 / 3 }, m: { value: -2 / 3 } },
}), { declined: /mixes Cartesian/ });

// Ambiguous: magnitudes only, no stated convention, element type unstated.
expectAudit("unsigned givens decline", opticsPlan({
  question: "A spherical mirror forms an image of an object 20 cm away; the focal length is 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 20, sign: "unsigned" }, f: { value: 10, sign: "unsigned" } },
  derived: { v: { value: 7 } },
}), { declined: /no signed distance/ });

// Givens read real-is-positive (concave, u = 30, f = 10, so v = 300/20 = +15), but the
// plan wrote v = -15: same size, Cartesian sign. That is a convention clash, not a slip.
// m = -v/u = -0.5 in either convention, so the plan's m agrees.
expectAudit("sign-only clash declines", opticsPlan({
  question: "An object is 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 30 }, f: { value: 10 } },
  derived: { v: { value: -15 }, m: { value: -0.5 } },
}), { declined: /different convention/ });

// Givens fix the convention: u = -30 and f = -10 are Cartesian signs no magnitude
// carries. 1/v = 1/f - 1/u = -1/10 + 1/30 = -1/15, v = -15. The plan's v = +15 is
// not another convention, it is a sign slip, and is reported like any slip.
expectAudit("sign slip under a convention the givens fix is reported", opticsPlan({
  question: "An object stands 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: -30 }, f: { value: -10 } },
  derived: { v: { value: 15 }, m: { value: -0.5 } },
}), { reported: { v: -15 } });

// Declared signs fix it too: u = +30 declared positive, concave f = +10 declared positive
// is real-is-positive, v = +15; the plan's v = -15 is a slip.
expectAudit("declared signs fix the convention", opticsPlan({
  question: "An object stands 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 30, sign: "positive" }, f: { value: 10, sign: "positive" } },
  derived: { v: { value: -15 }, m: { value: -0.5 } },
}), { reported: { v: 15 } });

// A diverging lens has negative f in both conventions; f = +20 is a magnitude.
expectAudit("lens type contradiction declines", opticsPlan({
  question: "An object is 10 cm from a diverging lens of focal length 20 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -10 }, f: { value: 20 } },
  derived: { v: { value: 20 / 3 } },
}), { declined: /contradicts the stated lens type/ });

// Linear magnification from signed Cartesian distances, concave mirror.
// u = -30, v = -15: m = -v/u = -(-15)/(-30) = -0.5 (inverted). The plan's +0.5 is wrong.
expectAudit("signed linear magnification", opticsPlan({
  question: "A concave mirror forms an image 15 cm in front of it for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: -30 }, v: { value: -15 } },
  derived: { m: { value: 0.5 } },
}), { reported: { m: -0.5 } });

// Unsigned distances and no orientation claim: the sign of m is unknown, so decline.
expectAudit("unsigned linear magnification declines", opticsPlan({
  question: "A mirror forms an image 15 cm away for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: 30, sign: "unsigned" }, v: { value: 15, sign: "unsigned" } },
  derived: { m: { value: 0.4 } },
}), { declined: /orientation/ });

// Unsigned distances with an erect claim: m = +v/u = 15/30 = 0.5.
expectAudit("claimed erect linear magnification", opticsPlan({
  question: "A mirror forms an image 15 cm away for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: 30, sign: "unsigned" }, v: { value: 15, sign: "unsigned" } },
  derived: { m: { value: 0.4 } },
  claims: ["The image is virtual and erect"],
}), { reported: { m: 0.5 } });

// A virtual object flips the object distance sign, and the evaluator takes a
// real object, so any configuration that could hold a virtual object must
// decline, never report. Cartesian truth for each: u = +10 (object right of
// the lens), f = +20, 1/v = 1/f + 1/u = 3/20, v = 20/3. Reading u = +10 as a
// real object would report v as -20.
const virtualLens = (question: string) => opticsPlan({
  question,
  lawIds: ["thin lens formula"],
  givens: { u: { value: 10 }, f: { value: 20 } },
  derived: { v: { value: 20 / 3 } },
});
for (const [name, question, reason] of [
  ["rays that would meet beyond the lens", "Rays incident on a convex lens of focal length 20 cm would meet at a point 10 cm beyond the lens if the lens were removed. Where do they focus?", /virtual/],
  ["light directed at a point", "Light is directed at a point 10 cm to the right of a convex lens of focal length 20 cm. Find the image.", /virtual/],
  ["light that converges", "Light that would converge 10 cm past a convex lens of focal length 20 cm falls on it. Locate the image.", /virtual/],
  ["image used as the object", "The image formed by the first lens acts as the object for a convex lens of focal length 20 cm placed 10 cm before it.", /virtual/],
  ["two elements", "A convex lens of focal length 20 cm is placed 10 cm in front of a plane mirror. Find the final image.", /more than one optical element/],
  ["no real object in the stem", "For a convex lens of focal length 20 cm, take u = 10 cm. Find v.", /real object/],
] as const) {
  expectAudit(`possible virtual object declines: ${name}`, virtualLens(question), { declined: reason });
}

// Converging or meeting wording about light after the element, or about the
// image, describes a real object's image and must not stop the audit. Concave
// mirror, Cartesian: u = -30, f = -10, 1/v = -1/10 + 1/30 = -1/15, v = -15.
// The plan's v = -20 is a slip the audit must report, and leave unchanged.
const realMirror = (question: string, claims: string[] = []) => opticsPlan({
  question,
  lawIds: ["mirror formula"],
  givens: { u: { value: -30 }, f: { value: -10 } },
  derived: { v: { value: -20 } },
  claims,
});
for (const [name, question, claims] of [
  ["reflected rays meet", "An object stands 30 cm in front of a concave mirror of focal length 10 cm. Where do the reflected rays meet?", []],
  ["rays converge to form the image", "An object is 30 cm from a concave mirror of focal length 10 cm. Where do the rays converge to form the image?", []],
  ["converge after reflection", "A candle is 30 cm in front of a concave mirror of focal length 10 cm. Find where the rays converge after reflection.", []],
  ["claim about reflected rays", "An object stands 30 cm in front of a concave mirror of focal length 10 cm. Locate the image.", ["The reflected rays converge in front of the mirror, so the image is real."]],
  ["converging mirror names the element", "An object is 30 cm in front of a converging mirror of focal length 10 cm. Find the image.", []],
] as const) {
  expectAudit(`real object image wording audits: ${name}`, realMirror(question, [...claims]), { reported: { v: -15 } });
}
for (const [name, question] of [
  ["converging beam incident", "A converging beam is incident on a concave mirror of focal length 10 cm, its object distance 30 cm. Find the image."],
  ["converging towards a point behind", "Light converging towards a point 30 cm behind a concave mirror of focal length 10 cm falls on it. Find the image of this object."],
  ["rays which would meet behind", "An object is formed by rays which would meet at a point 30 cm behind a concave mirror of focal length 10 cm. Find the image."],
  ["meet with no direction", "An object is 30 cm from a concave mirror of focal length 10 cm and the rays meet at a point. Find the image."],
  ["reflected and incident in one clause", "An object is 30 cm from a concave mirror of focal length 10 cm; the reflected rays would meet behind the mirror. Find the image."],
] as const) {
  expectAudit(`incident or ambiguous convergence declines: ${name}`, realMirror(question), { declined: /virtual/ });
}

// The wording that review found overwriting a right value: the object lies
// behind the lens and the beam converging on it is refracted, so the object is
// virtual. Cartesian: u = +10, f = +20, v = 20/3 (about 6.67 cm). Reading the
// object as real gives -20. A reported mismatch now rejects the planner lane,
// so this wording must decline and the plan's v must stand.
const behindLens = virtualLens("An object lies 10 cm behind a convex lens of focal length 20 cm, with a converging beam refracted by it. Find the image.");
expectAudit("virtual object behind the lens", behindLens, { declined: /virtual/ });
// An image behind the element is still a real object's image and stays audited.
expectAudit("image behind the lens keeps the audit", virtualLens(
  "An object stands 10 cm in front of a convex lens of focal length 20 cm; the image forms behind the lens. Find v.",
), { reported: { v: -20 } });

// A reported mismatch rejects the lane, so a value rounded to the precision it
// states must match. Concave mirror, Cartesian: u = -30, f = -20, v = -60.
// Convex lens, Cartesian: u = -60, f = +20, v = 30. Thin lens, u = -25, f = 15:
// 1/v = 1/15 - 1/25 = 2/75, v = 37.5. Real-is-positive mirror u = 30, f = 20
// with an unsigned v compares by size.
const precisionLens = (v: number, sign?: "unsigned") => opticsPlan({
  question: "An object stands 25 cm in front of a convex lens of focal length 15 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -25 }, f: { value: 15 } },
  derived: { v: { value: v, ...(sign ? { sign } : {}) } },
});
expectAudit("rounded to stated precision matches: 37.5", precisionLens(37.5), {});
expectAudit("rounded to stated precision matches: 37.50", precisionLens(37.50), {});
expectAudit("rounded to stated precision matches: 38 within 2%", precisionLens(38), {});
// Diverging lens, Cartesian: u = -20, f = -20, v = -10. An unsigned 10.0 is the size.
expectAudit("unsigned magnitude compares by size", opticsPlan({
  question: "An object stands 20 cm in front of a diverging lens of focal length 20 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -20 }, f: { value: -20 } },
  derived: { v: { value: 10.0, sign: "unsigned" } },
}), {});
expectAudit("unsigned magnitude still reports a wrong size", precisionLens(40, "unsigned"), { reported: { v: 37.5 } });
expectAudit("beyond stated precision reports: 36", precisionLens(36), { reported: { v: 37.5 } });
expectAudit("beyond stated precision reports: 37.2", precisionLens(37.2), { reported: { v: 37.5 } });
const thirdLens = (v: number) => opticsPlan({
  question: "An object stands 15 cm in front of a convex lens of focal length 10 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -15 }, f: { value: 10 } },
  derived: { v: { value: v } },
});
// u = -15, f = 10: 1/v = 1/10 - 1/15 = 1/30, v = 30. Integer answers stay exact.
expectAudit("integer answer matches", thirdLens(30), {});
expectAudit("integer answer 30.0 matches", thirdLens(30.0), {});
expectAudit("integer slip reports", thirdLens(29), { reported: { v: 30 } });

// Report only, in every configuration above: a plan with every value wrong
// still comes back as the same object with the same values.
const allWrong = opticsPlan({
  question: "An object stands 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: -30 }, f: { value: -10 } },
  derived: { v: { value: 99 }, m: { value: 99 } },
});
expectReported("every value wrong", auditUnchanged("every value wrong", allWrong), allWrong, { v: -15, m: -0.5 });

console.log("verify-optics-plan-audit: ok");
console.log(`  mirror_reported=${mirrorAudit.inconsistencies.length} ydse_reported=${ydseAudit.inconsistencies.length}`);
