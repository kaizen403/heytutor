/**
 * Which stated value belongs to which object, proved from ProblemIR structure.
 *
 * A value is bound to an object only through a shared evidence fact: the
 * ProblemIR expression that holds the number and the entity it describes
 * both cite the same question quote. The quote also gives the value's own
 * spelling and unit. One quote that states several values for several
 * objects ("a 6 Ω and a 3 Ω resistor") binds nothing: which value goes on
 * which part would be a guess. Text never chooses the owner.
 */
import { sameMeasuredQuantity, statedMeasurements } from "../contracts/contractsV3";
import type { ExpressionNodeIR, ProblemIR } from "../ir/problemIR";
import type { FloorFacts, FloorStatedValue } from "./facts";

export interface FloorBinding {
  expressionId: string;
  factId: string;
  /** Every entity the quote describes; one value shared by all of them ("two 4.7 kΩ resistors"). */
  entityIds: string[];
  value: number;
  /** Number and unit exactly as the quote writes them. */
  valueText: string;
  unitText: string;
  /** The plan quantity with the same value in the same unit, when the plan holds one. */
  quantity: FloorStatedValue | null;
}

function numberOf(root: ExpressionNodeIR): number | null {
  if (root.kind === "number") return root.value;
  if (root.kind === "unary" && root.operand.kind === "number") return root.operator === "-" ? -root.operand.value : root.operand.value;
  return null;
}

/** Stated measurements (and bare numbers) in a quote, with their exact spellings. */
function spellingsIn(quote: string): Array<{ text: string; value: number; unitText: string }> {
  const measured = statedMeasurements(quote).map((found) => ({ text: found.text.replace(/\s+/g, " "), value: found.value, unitText: found.unitText }));
  const bare = [...quote.matchAll(/(?<![\p{L}\p{N}_.^])[+\-−]?(?:\d+(?:\.\d+)?|\.\d+)(?![\p{N}.]|\s*[\p{L}°%Ω])/gu)]
    .map((match) => ({ text: match[0], value: Number(match[0].replace(/−/g, "-")), unitText: "" }));
  return [...measured, ...bare];
}

export function readFloorBindings(facts: FloorFacts): FloorBinding[] {
  const problem: ProblemIR | null = facts.problem;
  if (!problem) return [];
  const bindings: FloorBinding[] = [];
  for (const expression of problem.expressions) {
    if (expression.valueType !== "scalar") continue;
    const value = numberOf(expression.root);
    if (value === null || !Number.isFinite(value)) continue;
    const candidates = expression.evidenceFactIds.flatMap((factId) => {
      const fact = problem.facts.find((candidate) => candidate.id === factId && candidate.kind === "given");
      if (!fact) return [];
      const spelled = spellingsIn(fact.evidence.quote);
      const own = spelled.filter((found) => found.value === value);
      // A quote that states more than one value cannot say which part each belongs to.
      if (own.length !== 1 || new Set(spelled.map((found) => found.text)).size !== 1) return [];
      return [{ fact, spelling: own[0]! }];
    });
    if (candidates.length !== 1) continue;
    const { fact, spelling } = candidates[0]!;
    const entityIds = problem.entities.filter((entity) => entity.evidenceFactIds.includes(fact.id)).map((entity) => entity.id);
    if (entityIds.length === 0) continue;
    const quantity = facts.values.find((stated) => spelling.unitText
      ? sameMeasuredQuantity(spelling.value, spelling.unitText, stated.value, stated.unit)
      : (stated.unit === undefined || /^(?:|1|dimensionless|none)$/i.test(stated.unit.trim())) && stated.value === spelling.value) ?? null;
    bindings.push({
      expressionId: expression.id, factId: fact.id, entityIds, value: spelling.value,
      valueText: spelling.text, unitText: spelling.unitText, quantity,
    });
  }
  return bindings;
}

/** The single binding for one entity with a unit of the given dimension test, or null when none or several. */
export function bindingFor(bindings: readonly FloorBinding[], entityId: string): FloorBinding | null {
  const own = bindings.filter((binding) => binding.entityIds.includes(entityId));
  return own.length === 1 ? own[0]! : null;
}
