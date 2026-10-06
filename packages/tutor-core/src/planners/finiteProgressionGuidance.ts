import { readFiniteProgressionSource } from "@heytutor/scene-engine";

/** Complete discrete source roles guide the protocol; returned IR stays untrusted. */
export function finiteProgressionPlanningGuidance(question: string): string {
  const reading = readFiniteProgressionSource(question);
  if (reading.status !== "ok") return "";
  const { sequence, cumulative, roles, asks } = reading.source;
  return `\nFINITE DISCRETE SOURCE DATA\n${JSON.stringify({sequence,cumulative,roles,asks:asks.map((ask,index)=>({...ask,quantityId:`progression_result_${index}`,unit:"1"}))})}\n
The complete original source has been parsed into exact finite discrete roles and asks. Preserve QUESTION and every role/ask quote verbatim. A discrete nonmetric term/sum table helps explain the results: visualRequirement=optional. Do not assume an infinite series or draw a continuous interpolating curve. Use no assumptions or qualitative claims. For each ask use its supplied quantityId and symbol for both the unknown and derived row, unit 1, and its independently computed value. Numeric givens may be omitted from TurnPlan because the original source premises remain in full IR; never invent a scalar for the sequence.
ProblemIR must carry every complete given role and requested ask as source facts, with statement exactly its quote. One fact per role/ask avoids clipped premises and mixed evidence. Model entities are other, labelled exactly the original sequence with _n, grounded in their given model fact. Use conceptual representation intents, not graph intents. Preserve every complete source AST exactly, including operator order and grouping. Each requested scalar uses the ask.root and only its requested fact as evidence, and one evaluate request bound to the actual Plan ID/symbol/unit. Model function expressions use the corresponding given model role AST and only its given evidence. Do not add unused numeric expressions, simplified answer-only expressions, unsupported constraints or facts. The full returned IR and actual Plan are independently audited; guidance is not permission to discard any actual obligation.\n`;
}
