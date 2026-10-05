import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { reconcileTurnPlanWithOpticsLaws } from "../../src/planners/opticsPlanAudit";

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

const mirrorAudit = reconcileTurnPlanWithOpticsLaws(mirrorPlan);
if (mirrorAudit.corrections.length !== 2) throw new Error("mirror law did not correct both requested results");
if (Math.abs((mirrorAudit.plan.derived.find((item) => item.id === "v")?.value ?? 0) - 60) > 1e-9) throw new Error("mirror image distance was not corrected");
if (Math.abs((mirrorAudit.plan.derived.find((item) => item.id === "m")?.value ?? 0) + 3) > 1e-9) throw new Error("mirror magnification was not corrected");

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
const ydseAudit = reconcileTurnPlanWithOpticsLaws(ydsePlan);
if (
  Math.abs((ydseAudit.plan.derived.find((item) => item.id === "lambda_m")?.value ?? 0) - 600e-9) > 1e-15 ||
  Math.abs((ydseAudit.plan.derived.find((item) => item.id === "beta_m")?.value ?? 0) - 0.0024) > 1e-12 ||
  Math.abs((ydseAudit.plan.derived.find((item) => item.id === "beta")?.value ?? 0) - 2.4) > 1e-9
) {
  throw new Error(`mixed-unit YDSE correction failed: ${JSON.stringify(ydseAudit.plan.derived)}`);
}

const liveYdsePlan = structuredClone(ydsePlan);
liveYdsePlan.lawIds = ["wave-optics:double-slit-interference"];
liveYdsePlan.derived = [
  { id: "beta", symbol: "beta", value: 2400, unit: "mm", provenance: "derived" },
];
const liveYdseAudit = reconcileTurnPlanWithOpticsLaws(liveYdsePlan);
if (
  liveYdseAudit.checkedLawIds[0] !== "ydse_fringe_width" ||
  Math.abs((liveYdseAudit.plan.derived[0]?.value ?? 0) - 2.4) > 1e-9
) {
  throw new Error(`live YDSE law alias correction failed: ${JSON.stringify(liveYdseAudit)}`);
}

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
const divergingLensAudit = reconcileTurnPlanWithOpticsLaws(divergingLensPlan);
if (Math.abs((divergingLensAudit.plan.derived.find((item) => item.id === "v")?.value ?? 0) + 20 / 3) > 1e-9) {
  throw new Error(`diverging lens image distance lost its sign: ${JSON.stringify(divergingLensAudit.plan.derived)}`);
}
if (Math.abs((divergingLensAudit.plan.derived.find((item) => item.id === "m")?.value ?? 0) - 1 / 3) > 1e-9) {
  throw new Error(`diverging lens magnification was not recomputed from signed distances: ${JSON.stringify(divergingLensAudit.plan.derived)}`);
}

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
const phaseAudit = reconcileTurnPlanWithOpticsLaws(phasePlan);
if (Math.abs((phaseAudit.plan.derived[0]?.value ?? 0) - 90) > 1e-9) {
  throw new Error(`phase difference was not converted to degrees: ${JSON.stringify(phaseAudit.plan.derived)}`);
}

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
const singleSlitAudit = reconcileTurnPlanWithOpticsLaws(singleSlitPlan);
if (Math.abs((singleSlitAudit.plan.derived[0]?.value ?? 0) - (0.005 * 180 / Math.PI)) > 1e-9) {
  throw new Error(`single-slit angular width was not converted to degrees: ${JSON.stringify(singleSlitAudit.plan.derived)}`);
}

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
const telescopeResolutionAudit = reconcileTurnPlanWithOpticsLaws(telescopeResolutionPlan);
if (Math.abs((telescopeResolutionAudit.plan.derived[0]?.value ?? 0) - (1.22 * 550e-9 / 0.1 * 180 / Math.PI)) > 1e-12) {
  throw new Error(`telescope resolution angle was not converted to degrees: ${JSON.stringify(telescopeResolutionAudit.plan.derived)}`);
}

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
const microscopeAudit = reconcileTurnPlanWithOpticsLaws(microscopePlan);
const microscopeTube = microscopeAudit.plan.derived.find((item) => item.id === "tube_length")?.value ?? 0;
const microscopePower = microscopeAudit.plan.derived.find((item) => item.id === "magnifying_power")?.value ?? 0;
const microscopeImageCm = microscopeAudit.plan.derived.find((item) => item.id === "v_o_cm")?.value ?? 0;
if (Math.abs(microscopeTube - (3.6 + 25 / 11)) > 1e-9) {
  throw new Error(`microscope tube length was not recomputed from object distance: ${JSON.stringify(microscopeAudit.plan.derived)}`);
}
if (Math.abs(microscopePower + 88) > 1e-9) {
  throw new Error(`microscope magnifying power was not signed from the two-lens chain: ${JSON.stringify(microscopeAudit.plan.derived)}`);
}
if (Math.abs(microscopeImageCm - 3.6) > 1e-9) {
  throw new Error(`microscope mixed-unit image distance was not corrected: ${JSON.stringify(microscopeAudit.plan.derived)}`);
}

const unrelated = structuredClone(mirrorPlan);
unrelated.lawIds = ["conservation_of_energy"];
const unrelatedAudit = reconcileTurnPlanWithOpticsLaws(unrelated);
if (unrelatedAudit.corrections.length !== 0 || unrelatedAudit.plan !== unrelated) {
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
  expected: { v?: number; m?: number; corrections: number; declined?: RegExp },
): void {
  const audit = reconcileTurnPlanWithOpticsLaws(plan);
  const value = (id: string) => audit.plan.derived.find((item) => item.id === id)?.value;
  const detail = JSON.stringify({ derived: audit.plan.derived, corrections: audit.corrections, declined: audit.declined });
  if (audit.corrections.length !== expected.corrections) throw new Error(`${name}: expected ${expected.corrections} corrections: ${detail}`);
  if (expected.v !== undefined && Math.abs((value("v") ?? Number.NaN) - expected.v) > 1e-9) throw new Error(`${name}: v should be ${expected.v}: ${detail}`);
  if (expected.m !== undefined && Math.abs((value("m") ?? Number.NaN) - expected.m) > 1e-9) throw new Error(`${name}: m should be ${expected.m}: ${detail}`);
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
}), { v: -15, m: -0.5, corrections: 0 });

// Concave mirror, Cartesian, virtual image, with a genuine slip (the plan added
// 1/12 + 1/6 = 1/4). u = -6, f = -12: 1/v = -1/12 + 1/6 = 1/12, v = +12 (virtual,
// behind); m = -v/u = -12/(-6) = +2. The plan's v = 4 and m = 2/3 must be corrected.
expectAudit("cartesian concave mirror virtual image slip", opticsPlan({
  question: "An object is 6 cm in front of a concave mirror of focal length 12 cm.",
  lawIds: ["mirror equation"],
  givens: { u: { value: -6, sign: "negative" }, f: { value: -12, sign: "negative" } },
  derived: { v: { value: 4 }, m: { value: 2 / 3 } },
}), { v: 12, m: 2, corrections: 2 });

// Convex mirror, Cartesian (the mixed convention bug shape). u = -40, f = +10:
// 1/v = 1/10 + 1/40 = 1/8, v = +8 (virtual, behind); m = -8/(-40) = +0.2.
// Taking |u| with a signed f would give v = 10*40/30 = 13.3 and overwrite a right plan.
expectAudit("cartesian convex mirror stays correct", opticsPlan({
  question: "An object is 40 cm in front of a convex mirror of focal length 10 cm. Where is the image?",
  lawIds: ["mirror_formula"],
  givens: { u: { value: -40 }, f: { value: 10 } },
  derived: { v: { value: 8 }, m: { value: 0.2 } },
}), { v: 8, m: 0.2, corrections: 0 });

// Convex mirror, real-is-positive, with a slip (the plan dropped the sign of f).
// u = 40, f = -10: v = fu/(u - f) = -400/50 = -8 (virtual); m = -v/u = 8/40 = 0.2.
// The plan's v = -40/3 and m = 1/3 come from f = +10 and must be corrected.
expectAudit("real-is-positive convex mirror slip", opticsPlan({
  question: "An object is 40 cm in front of a convex mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 40 }, f: { value: -10 } },
  derived: { v: { value: -40 / 3 }, m: { value: 1 / 3 } },
  assumptions: ["real-is-positive sign convention"],
}), { v: -8, m: 0.2, corrections: 2 });

// Converging lens, Cartesian, real image, with a slip (the plan used 1/v = 1/f + 1/|u|).
// u = -30, f = +20: 1/v = 1/f + 1/u = 1/20 - 1/30 = 1/60, v = +60 (real); m = v/u = 60/(-30) = -2.
expectAudit("cartesian converging lens slip", opticsPlan({
  question: "An object is 30 cm from a converging lens of focal length 20 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -30 }, f: { value: 20 } },
  derived: { v: { value: 12 }, m: { value: -0.4 } },
}), { v: 60, m: -2, corrections: 2 });

// Diverging lens, Cartesian, virtual image. u = -20, f = -20:
// 1/v = -1/20 - 1/20 = -1/10, v = -10 (virtual, object side); m = v/u = -10/(-20) = 0.5.
expectAudit("cartesian diverging lens virtual image", opticsPlan({
  question: "An object is 20 cm from a diverging lens of focal length 20 cm.",
  lawIds: ["lens equation"],
  givens: { u: { value: -20 }, f: { value: -20 } },
  derived: { v: { value: -10 }, m: { value: 0.5 } },
}), { v: -10, m: 0.5, corrections: 0 });

// Converging lens, real-is-positive, virtual image (object inside F). u = 10, f = 15:
// v = fu/(u - f) = 150/(-5) = -30 (virtual); m = -v/u = 30/10 = 3.
expectAudit("real-is-positive converging lens virtual image", opticsPlan({
  question: "An object is 10 cm from a convex lens of focal length 15 cm.",
  lawIds: ["thin_lens_formula"],
  givens: { u: { value: 10 }, f: { value: 15 } },
  derived: { v: { value: -30 }, m: { value: 3 } },
}), { v: -30, m: 3, corrections: 0 });

// Magnitudes under a stated Cartesian convention, with a slip. Convex mirror,
// |u| = 60, |f| = 20, so u = -60 and f = +20: 1/v = 1/20 + 1/60 = 1/15, v = +15;
// m = -15/(-60) = 0.25. The plan's v = 30 must be corrected.
expectAudit("declared cartesian with magnitudes", opticsPlan({
  question: "An object is 60 cm in front of a convex mirror of focal length 20 cm.",
  lawIds: ["mirror formula", "Cartesian sign convention"],
  givens: { u: { value: 60, sign: "unsigned" }, f: { value: 20, sign: "unsigned" } },
  derived: { v: { value: 30 }, m: { value: 0.25 } },
}), { v: 15, m: 0.25, corrections: 1 });

// Ambiguous: u = 25 is real-is-positive, f = -10 for a concave mirror is Cartesian.
// Cartesian reading gives v = -50/3, real-is-positive with f = -10 gives v = -250/35.
// The plan's v must stand untouched.
expectAudit("mixed conventions decline", opticsPlan({
  question: "An object is 25 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 25 }, f: { value: -10 } },
  derived: { v: { value: -50 / 3 }, m: { value: -2 / 3 } },
}), { v: -50 / 3, m: -2 / 3, corrections: 0, declined: /mixes Cartesian/ });

// Ambiguous: magnitudes only, no stated convention, element type unstated.
expectAudit("unsigned givens decline", opticsPlan({
  question: "A spherical mirror forms an image of an object 20 cm away; the focal length is 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 20, sign: "unsigned" }, f: { value: 10, sign: "unsigned" } },
  derived: { v: { value: 7 } },
}), { v: 7, corrections: 0, declined: /no signed distance/ });

// Givens read real-is-positive (concave, u = 30, f = 10, so v = 300/20 = +15), but the
// plan wrote v = -15: same size, Cartesian sign. That is a convention clash, not a slip.
// m = -v/u = -0.5 in either convention, so the plan's m agrees.
expectAudit("sign-only clash declines", opticsPlan({
  question: "An object is 30 cm in front of a concave mirror of focal length 10 cm.",
  lawIds: ["mirror formula"],
  givens: { u: { value: 30 }, f: { value: 10 } },
  derived: { v: { value: -15 }, m: { value: -0.5 } },
}), { v: -15, m: -0.5, corrections: 0, declined: /different convention/ });

// A diverging lens has negative f in both conventions; f = +20 is a magnitude.
expectAudit("lens type contradiction declines", opticsPlan({
  question: "An object is 10 cm from a diverging lens of focal length 20 cm.",
  lawIds: ["thin lens formula"],
  givens: { u: { value: -10 }, f: { value: 20 } },
  derived: { v: { value: 20 / 3 } },
}), { v: 20 / 3, corrections: 0, declined: /contradicts the stated lens type/ });

// Linear magnification from signed Cartesian distances, concave mirror.
// u = -30, v = -15: m = -v/u = -(-15)/(-30) = -0.5 (inverted). The plan's +0.5 is wrong.
expectAudit("signed linear magnification", opticsPlan({
  question: "A concave mirror forms an image 15 cm in front of it for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: -30 }, v: { value: -15 } },
  derived: { m: { value: 0.5 } },
}), { m: -0.5, corrections: 1 });

// Unsigned distances and no orientation claim: the sign of m is unknown, so decline.
expectAudit("unsigned linear magnification declines", opticsPlan({
  question: "A mirror forms an image 15 cm away for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: 30, sign: "unsigned" }, v: { value: 15, sign: "unsigned" } },
  derived: { m: { value: 0.4 } },
}), { m: 0.4, corrections: 0, declined: /orientation/ });

// Unsigned distances with an erect claim: m = +v/u = 15/30 = 0.5.
expectAudit("claimed erect linear magnification", opticsPlan({
  question: "A mirror forms an image 15 cm away for an object 30 cm away.",
  lawIds: ["linear magnification"],
  givens: { u: { value: 30, sign: "unsigned" }, v: { value: 15, sign: "unsigned" } },
  derived: { m: { value: 0.4 } },
  claims: ["The image is virtual and erect"],
}), { m: 0.5, corrections: 1 });

console.log("verify-optics-plan-audit: ok");
console.log(`  mirror_corrections=${mirrorAudit.corrections.length} ydse_corrections=${ydseAudit.corrections.length}`);
