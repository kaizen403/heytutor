import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { reconcileTurnPlanWithOpticsLaws } from "../src/opticsPlanAudit";

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

const unrelated = structuredClone(mirrorPlan);
unrelated.lawIds = ["conservation_of_energy"];
const unrelatedAudit = reconcileTurnPlanWithOpticsLaws(unrelated);
if (unrelatedAudit.corrections.length !== 0 || unrelatedAudit.plan !== unrelated) {
  throw new Error("non-optics plan was modified");
}

console.log("verify-optics-plan-audit: ok");
console.log(`  mirror_corrections=${mirrorAudit.corrections.length} ydse_corrections=${ydseAudit.corrections.length}`);
