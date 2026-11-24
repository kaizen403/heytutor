import type { SceneDocument } from "../types";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { MECHANICS_OPERATORS, mechanicsUnitFactor, mechanicsPhysicalClaims } from "../compile/mechanicsGeometry";
import { validateProblemIR } from "../ir/problemIR";
import { solveMechanicsProgram } from "../ir/mechanicsProgram";
import { solverAuthoritySymbolsAgree } from "../ir/solverAuthority";
import { validateMechanicsSceneSourceBinding } from "./mechanicsSceneAuthority";

export interface MechanicsTeachingAuthority {
  models: Array<{ requestId: string; stepId: string; operator: string; ownerId: string; axisId: string }>;
  bindings: Array<{ resultId: string; symbol: string; value: number; unit: string; errorBound: number; ownerId: string; axisId: string }>;
  conditions: string[];
}

/** Recompute original-question outputs before giving the teaching stream any
 * physical answer authority. Stored selectors and planner scalars are not proof. */
export function buildMechanicsTeachingAuthority(document: SceneDocument, plan: TurnPlanV3): MechanicsTeachingAuthority | null {
  if (!document.constructions.some(construction => (MECHANICS_OPERATORS as readonly string[]).includes(construction.operator)) ||
      document.source.question !== plan.question || validateMechanicsSceneSourceBinding(document, undefined, plan.question, plan).length) return null;
  const validation = validateProblemIR(document.source.mechanicsProblemIR, plan.question);
  if (!validation.valid || !validation.problem) return null;
  const problem = validation.problem;
  const projection: MechanicsTeachingAuthority = { models: [], bindings: [], conditions: [] };
  const conditions = new Set<string>();
  const modelKeys = new Set<string>();
  const resultIds = new Set<string>();
  const nativeMasses = new Map<string, { valueSI: number; errorSI: number; ownerId: string; axisId: string }>();
  try {
    for (const request of problem.solveRequests) {
      if (request.kind !== "mechanics" || !request.resultBinding) continue;
      const binding = request.resultBinding;
      const quantity = [...plan.derived, ...plan.unknowns].find(value => value.id === binding.turnPlanQuantityId);
      if (!quantity || !solverAuthoritySymbolsAgree(quantity.symbol, binding.symbol)) continue;
      const solution = solveMechanicsProgram(problem, request.program, binding);
      const factor = mechanicsUnitFactor(quantity.unit ?? request.program.output.unit, solution.claim.dimension);
      if ("value" in quantity) {
        if (typeof quantity.value !== "number" || Math.abs(quantity.value * factor - solution.claim.scalarSI) >
            (solution.claim.errorBoundSI ?? 0) + 64 * Number.EPSILON * Math.max(Math.abs(quantity.value * factor), Math.abs(solution.claim.scalarSI))) return null;
      }
      if (resultIds.has(binding.turnPlanQuantityId)) return null;
      resultIds.add(binding.turnPlanQuantityId);
      projection.bindings.push({ resultId: binding.turnPlanQuantityId, symbol: binding.symbol,
        value: solution.approximate, unit: request.program.output.unit, errorBound: solution.errorBound,
        ownerId: request.program.output.ownerId, axisId: request.program.output.axisId });
      if (projection.bindings.length > 64) return null;
      for (const [stepId, snapshot] of solution.snapshots) {
        const key = JSON.stringify([snapshot.step.operator, snapshot.step.ownerId, snapshot.step.axisId, snapshot.physicalInputs]);
        if (snapshot.step.operator === "mass_moments" && "mechanicsModel" in snapshot.geometry && snapshot.geometry.mechanicsModel?.kind === "mass_moments") {
          const mass = mechanicsPhysicalClaims(snapshot.geometry).find(claim => claim.symbol === "M" && claim.dimension === "mass");
          if (mass) nativeMasses.set(key, { valueSI: mass.scalarSI, errorSI: mass.errorBoundSI ?? 0,
            ownerId: snapshot.step.ownerId, axisId: snapshot.step.axisId });
        }
        if (modelKeys.has(key)) continue;
        modelKeys.add(key);
        projection.models.push({ requestId: request.id, stepId, operator: snapshot.step.operator,
          ownerId: snapshot.step.ownerId, axisId: snapshot.step.axisId });
        if (projection.models.length > 256) return null;
      }
      for (const factId of solution.factIds) {
        const fact = problem.facts.find(value => value.id === factId);
        if (fact && fact.kind !== "requested") conditions.add(fact.evidence.quote);
      }
    }
    // A complete source-verified mass model already computes total M while
    // solving its requested centre. Forward that existing claim to an exact
    // retained intermediate; do not invent a source request or scalar proof.
    if (nativeMasses.size === 1) {
      const mass = [...nativeMasses.values()][0]!;
      if (!Number.isFinite(mass.valueSI) || !(mass.valueSI > 0) || !Number.isFinite(mass.errorSI) || mass.errorSI < 0) return null;
      const intermediates = plan.derived.filter(quantity => !resultIds.has(quantity.id) && solverAuthoritySymbolsAgree(quantity.symbol, "M"));
      if (intermediates.length > 1) return null;
      for (const quantity of intermediates) {
        if (plan.givens.some(given => given.id === quantity.id) || plan.unknowns.some(unknown => unknown.id === quantity.id)
          || plan.derived.filter(derived => derived.id === quantity.id).length !== 1) return null;
        if (typeof quantity.unit !== "string" || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return null;
        const factor = mechanicsUnitFactor(quantity.unit, "mass"), value = mass.valueSI / factor, errorBound = mass.errorSI / factor;
        const agrees = (candidate: number): boolean => Number.isFinite(candidate) && (candidate === value || candidate !== 0 && value !== 0
          && Math.abs(candidate - value) <= errorBound + 64 * Number.EPSILON * Math.max(Math.abs(candidate), Math.abs(value)));
        const displayed = document.quantities.filter(candidate => candidate.id === quantity.id);
        if (!agrees(quantity.value) || !Number.isFinite(value) || !Number.isFinite(errorBound) || quantity.value !== 0 && quantity.value * factor === 0
          || displayed.length > 1 || displayed.length === 1 && (displayed[0]!.symbol !== quantity.symbol || displayed[0]!.unit !== quantity.unit
            || typeof displayed[0]!.value !== "number" || !agrees(displayed[0]!.value))) return null;
        resultIds.add(quantity.id);
        projection.bindings.push({ resultId: quantity.id, symbol: quantity.symbol, value, unit: quantity.unit, errorBound,
          ownerId: mass.ownerId, axisId: mass.axisId });
        if (projection.bindings.length > 64) return null;
      }
    }
  } catch { return null; }
  projection.conditions = [...conditions];
  if (projection.conditions.length > 64 || projection.conditions.join("\n").length > 16384) return null;
  return projection.bindings.length ? projection : null;
}
