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

console.log("verify-optics-plan-audit: ok");
console.log(`  mirror_corrections=${mirrorAudit.corrections.length} ydse_corrections=${ydseAudit.corrections.length}`);
