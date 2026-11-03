/**
 * Figure consistency issues reach production admission and telemetry.
 *
 * A synthetic loop whose current mark runs against the cell must be refused by
 * validateProductionSceneCandidate with current_against_source_polarity, the
 * same loop with the mark the right way must be admitted, and every figure
 * consistency code must be a named failed turn issue, not unknown_issue.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-figure-consistency-admission.ts
 */
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { FAILED_TURN_ISSUE_CODES } from "../../lib/obs/failedTurnTelemetry";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const CODES = ["component_glyph_overlap", "current_against_source_polarity", "vector_collinear_overlap", "vector_without_label", "region_label_in_nested_body", "axes_frames_overlap"];
const question = "Draw a cell driving a current through a resistor.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
function loop(sense: string): Record<string, unknown> {
  const ids = ["P", "Q", "R", "S", "cell", "top", "load", "bottom", "flow"];
  return {
    schemaVersion: "scene-document/v2", source: { nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "synthetic loop" },
    entities: [
      ...["P", "Q", "R", "S"].map((id) => ({ id, kind: "point", role: "node" })),
      { id: "cell", kind: "component", role: "source", label: "E" }, { id: "top", kind: "connector", role: "wire" },
      { id: "load", kind: "component", role: "resistor", label: "R" }, { id: "bottom", kind: "connector", role: "wire" },
      { id: "flow", kind: "sign_badge", role: "current direction", label: "I" },
    ],
    constructions: [
      { id: "mP", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["P"] },
      { id: "mQ", operator: "point", inputs: { x: 5, y: 0, coordinateSpace: "layout" }, outputs: ["Q"] },
      { id: "mR", operator: "point", inputs: { x: 5, y: 3, coordinateSpace: "layout" }, outputs: ["R"] },
      { id: "mS", operator: "point", inputs: { x: 0, y: 3, coordinateSpace: "layout" }, outputs: ["S"] },
      { id: "mcell", operator: "symbol", inputs: { start: "P", end: "S", symbol: "cell" }, outputs: ["cell"] },
      { id: "mtop", operator: "connect", inputs: { start: "S", end: "R" }, outputs: ["top"] },
      { id: "mload", operator: "symbol", inputs: { start: "R", end: "Q", symbol: "resistor" }, outputs: ["load"] },
      { id: "mbottom", operator: "connect", inputs: { start: "P", end: "Q" }, outputs: ["bottom"] },
      { id: "mflow", operator: "sign_badge", inputs: { target: "bottom", at: 0.5, sense }, outputs: ["flow"] },
    ],
    relations: [], assertions: [], quantities: [], annotations: [], teachingTimeline: [],
    revealGroups: [{ id: "setup", dependsOn: [], entityIds: ids, narrationCue: "setup" }], requiredEntityIds: ids,
  };
}
const failures: string[] = [];
const known = new Set<string>(FAILED_TURN_ISSUE_CODES);
for (const code of CODES) if (!known.has(code)) failures.push(`${code} is not a named failed turn issue`);
for (const policy of ["off", "verified_parts"] as const) {
  const right = validateProductionSceneCandidate({ candidate: loop("positive"), question, turnPlan: plan, yieldPolicy: policy });
  if (!right.valid) failures.push(`${policy}: the mark leaving the positive plate was refused: ${right.errors.map((issue) => issue.code).join(", ")}`);
  const reversed = validateProductionSceneCandidate({ candidate: loop("negative"), question, turnPlan: plan, yieldPolicy: policy });
  if (reversed.valid || !reversed.errors.some((issue) => issue.code === "current_against_source_polarity")) {
    failures.push(`${policy}: the reversed mark was not refused with current_against_source_polarity`);
  }
}
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(failures.length ? `${failures.length} failed` : "pass: figure consistency codes reach admission and telemetry");
if (failures.length) process.exit(1);
