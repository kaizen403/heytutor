import { solveMechanicsProgram } from "./mechanicsProgram";
import { readSourcePhysicalPointDeclarations, sourcePointBodyCoordinateSymbol } from "./sourcePhysicalPointDeclarations";
import type { ProblemIR, SolveResultBinding } from "./problemIR";
import type { TurnPlanV3 } from "../contracts/contractsV3";

export interface MechanicsRequestedOutputIssue {
  code: "mechanics_requested_output_missing";
  message: string;
}

function symbolKey(symbol: string): string {
  return symbol.normalize("NFKC").replace(/\\(?:mathrm|text|operatorname)\s*/gu, "").replace(/[{}\s]/gu, "");
}

function retainedQuantity(plan: TurnPlanV3, binding: SolveResultBinding): boolean {
  const derived = plan.derived.filter(quantity => quantity.id === binding.turnPlanQuantityId);
  const unknowns = plan.unknowns.filter(quantity => quantity.id === binding.turnPlanQuantityId);
  const sameMetadata = (quantity: { symbol: string; unit?: string }): boolean =>
    symbolKey(quantity.symbol) === symbolKey(binding.symbol) &&
    typeof quantity.unit === "string" && typeof binding.unit === "string" &&
    quantity.unit.replace(/\s+/gu, "") === binding.unit.replace(/\s+/gu, "");
  return derived.length === 1 && sameMetadata(derived[0]!) && unknowns.length <= 1 && unknowns.every(sameMetadata);
}

/**
 * Request-level source geometry can be true while a whole numeric answer is
 * incomplete. Compare original source demands with explicit, freshly replayed
 * native result bindings. Numeric value/error comparisons keep their existing
 * solver audit; geometry admission can retain its representation tier.
 */
export function mechanicsRequestedOutputIssues(
  problem: ProblemIR,
  plan: TurnPlanV3 | null | undefined,
): MechanicsRequestedOutputIssue[] {
  const source = readSourcePhysicalPointDeclarations(problem.question);
  if (!source) return [];
  const requested = source.centre.components.map(component => ({
    symbol: `${component}_CM`, description: `${component}-coordinate of the source centre ${source.centre.label}`,
  }));
  if (source.totalMassRequested) requested.push({ symbol: "M", description: "total mass of the source assembly" });
  const covered = new Set<string>();
  if (plan?.question === problem.question) for (const request of problem.solveRequests) {
    if (request.kind !== "mechanics" || !request.resultBinding || !retainedQuantity(plan, request.resultBinding)) continue;
    try {
      const replay = solveMechanicsProgram(problem, request.program, request.resultBinding);
      const output = replay.snapshots.get(request.program.output.stepId);
      const distribution = output?.step.operator === "mass_moments" ? output :
        output?.step.operator === "mass_property" && output.step.inputs.kind === "mass" && typeof output.step.inputs.distribution === "string"
          ? replay.snapshots.get(output.step.inputs.distribution) : undefined;
      if (!distribution || distribution.geometry.kind !== "point" || distribution.geometry.mechanicsModel?.kind !== "mass_moments") continue;
      // This source-derived coordinate selects provenance only. The ACTUAL
      // replayed output above proves the value, owner, axis and requested facts;
      // a coordinate probe cannot establish a missing mass output.
      const provenance = `${source.centre.components[0]}_${source.centre.label}`;
      if (!sourcePointBodyCoordinateSymbol(problem, distribution.step, provenance)) continue;
      const nativeSymbol = replay.claim.symbol;
      const bindingSymbol = request.resultBinding.symbol;
      if (nativeSymbol === "M") {
        if (replay.claim.dimension === "mass" && symbolKey(bindingSymbol) === "M") covered.add("M");
      } else if (replay.claim.dimension === "length" &&
        sourcePointBodyCoordinateSymbol(problem, distribution.step, bindingSymbol) === nativeSymbol) {
        covered.add(nativeSymbol);
      }
    } catch {
      // An unsupported or source-inconsistent request supplies no output.
    }
  }
  return requested.filter(output => !covered.has(output.symbol)).map(output => ({
    code: "mechanics_requested_output_missing",
    message: `The original source requests the ${output.description}, but no source-replayed native result binding retains that output's plan quantity id, symbol and unit.`,
  }));
}
