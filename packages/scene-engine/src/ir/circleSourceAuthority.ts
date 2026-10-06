/** Pure source-plan reconciliation. No compile, family selection or mutable cache. */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import {
  bindCircleSourceProblem, readCircleSourceProgram, circleCoefficientRole,
  circleResultRole, circleRoleUnit, circleRoleValue, circleCoefficientValues, type CircleValueRole, type CircleWholeSource,
} from "./circleSourceProgram";
import { numeric } from "./circleSourceMath";

export interface CircleAuthorityIssue { code: "circle_given_withdrawn" | "circle_value_withdrawn" | "circle_value_corrected" | "circle_unknown_withdrawn"; quantityId: string; message: string }
export interface CircleAuthorityResult { plan: TurnPlanV3; issues: CircleAuthorityIssue[]; source: CircleWholeSource }
const COEFFICIENTS = new Set<CircleValueRole>(["A", "B", "C", "D", "E", "F"]);
const dependencies: Record<string, readonly CircleValueRole[]> = {
  center_x: ["A", "D"], center_y: ["A", "C", "E"], radius_squared: ["A", "C", "D", "E", "F", "center_x", "center_y"],
  radius: ["A", "C", "D", "E", "F", "center_x", "center_y", "radius_squared"],
};
/** Unsupported source/full IR declines. Supported values are recomputed afresh;
 * metadata and scalar coincidences never bind an unknown coefficient/result role.
 */
export function applyCircleSourceAuthority(question: string, plan: TurnPlanV3, problemIR?: unknown): CircleAuthorityResult | null {
  const reading = readCircleSourceProgram(question);
  if (reading.status !== "ok" || plan.question !== question) return null;
  const binding = problemIR === undefined ? undefined : bindCircleSourceProblem(question, problemIR);
  if (problemIR !== undefined && !binding) return null;
  const source = reading.source, issues: CircleAuthorityIssue[] = [];
  const rows = [...plan.givens, ...plan.derived];
  const duplicate = new Set(rows.filter((r, i) => rows.findIndex(other => other.id === r.id) !== i).map(r => r.id));
  const byId = new Map(rows.map(row => [row.id, row]));
  const roles = new Map<string, CircleValueRole>();
  const retained = new Map<string, TurnPlanQuantityV3>();
  const changed = new Set<string>();
  const withdraw = (row: TurnPlanQuantityV3, given: boolean, message: string): void => {
    changed.add(row.id);
    issues.push({ code: given ? "circle_given_withdrawn" : "circle_value_withdrawn", quantityId: row.id, message });
  };
  for (const row of plan.givens) {
    const role = circleCoefficientRole(row.sourceText ?? "");
    // Coefficient evidence describes an actual algebra slot; the source equation
    // independently certifies its value. A letter by itself cannot bind a slot.
    if (!source.equations.length || duplicate.has(row.id) || !role || !COEFFICIENTS.has(role) || row.symbol !== role || row.provenance !== "given" || !circleRoleUnit(role, row.unit) || !circleCoefficientValues(source, role).some(value => row.value === numeric(value)) || row.dependsOn?.length) {
      withdraw(row, true, "given does not bind one source coefficient role/value/unit"); continue;
    }
    roles.set(row.id, role); retained.set(row.id, { ...row });
  }
  const visiting = new Set<string>(), evaluated = new Set<string>();
  const check = (id: string): boolean => {
    if (retained.has(id)) return true;
    if (evaluated.has(id) || visiting.has(id)) return false;
    const row = byId.get(id);
    if (!row || !plan.derived.includes(row)) return false;
    visiting.add(id);
    let role = circleResultRole(row.symbol);
    const request = binding?.requestBindings.find(r => r.quantityId === id);
    const requestIdentityConflict = role && binding?.requestBindings.some(r => r.role === role) && !request;
    if (request && (request.symbol !== row.symbol || request.unit !== row.unit)) role = null;
    const unknown = plan.unknowns.find(u => u.id === id);
    const unknownConflict = unknown && (circleResultRole(unknown.symbol) !== role || !role || !circleRoleUnit(role, unknown.unit));
    const deps = row.dependsOn ?? [];
    const valid = !duplicate.has(id) && role !== null && row.provenance === "derived" && circleRoleUnit(role, row.unit) && !unknownConflict && !requestIdentityConflict &&
      deps.every(dep => dep !== id && check(dep) && dependencies[role!]?.includes(roles.get(dep)!)) &&
      // Result evidence must name a supported source request (or an exact full-IR
      // request binding); unrelated g/coefficients cannot become result aliases.
      (source.asks.includes(role) || Boolean(request));
    visiting.delete(id); evaluated.add(id);
    if (!valid || !role) { withdraw(row, false, "result identity/unit/evidence/dependencies do not bind one source role"); return false; }
    const value = circleRoleValue(source, role);
    roles.set(id, role);
    retained.set(id, { ...row, value, sourceText: `Source-verified ${row.symbol}=${value}`, ...(row.sign ? { sign: value === 0 ? "zero" as const : value > 0 ? "positive" as const : "negative" as const } : {}) });
    if (row.value !== value) {
      changed.add(id); issues.push({ code: "circle_value_corrected", quantityId: id, message: `${row.symbol}: ${row.value} -> ${value}` });
    }
    return true;
  };
  for (const row of plan.derived) check(row.id);
  const conflictingUnknowns=new Set<string>();
  for(const unknown of plan.unknowns){
    const role=circleResultRole(unknown.symbol);
    if(!role || !source.asks.includes(role) || !circleRoleUnit(role,unknown.unit)){
      conflictingUnknowns.add(unknown.id);changed.add(unknown.id);
      issues.push({code:"circle_unknown_withdrawn",quantityId:unknown.id,message:"unknown identity or unit does not bind a requested source circle role"});
    }
  }
  // Claims linked to any changed or withdrawn premise cannot survive correction.
  const qualitativeClaims = plan.qualitativeClaims.filter(claim => (claim.relatedQuantityIds ?? []).every(id => retained.has(id) && !changed.has(id)));
  const unknowns = plan.unknowns.filter(unknown => {
    const role = circleResultRole(unknown.symbol);
    return !conflictingUnknowns.has(unknown.id) && role && source.asks.includes(role) && circleRoleUnit(role, unknown.unit) && !changed.has(unknown.id) && (!byId.has(unknown.id) || retained.has(unknown.id));
  });
  return { source, issues, plan: { ...plan, givens: plan.givens.filter(row => retained.has(row.id)).map(row => retained.get(row.id)!), derived: plan.derived.filter(row => retained.has(row.id)).map(row => retained.get(row.id)!), unknowns, qualitativeClaims } };
}
