import {
  exactPolynomialNumber,
  exactPolynomialText,
  finitePolynomialCoefficient,
  readFiniteBinomialProgram,
} from "@heytutor/scene-engine";

/** Source data for planning, never a substitute for the complete returned IR. */
export function finitePolynomialPlanningGuidance(question: string): string {
  const reading = readFiniteBinomialProgram(question);
  if (reading.status !== "ok") return "";
  const source = reading.source;
  const coefficient = source.request.kind === "coefficient"
    ? finitePolynomialCoefficient(source.expansion, source.request.exponent) : null;
  const role = source.request.kind === "coefficient" ? `c_${source.request.exponent}` : null;
  const sourceData = {
    expressionQuote: source.expressionSource,
    requestQuote: source.requestSource,
    completeExpressionAST: source.root,
    request: source.request,
    ...(coefficient ? { coefficientExact: exactPolynomialText(coefficient), coefficientNumber: exactPolynomialNumber(coefficient), quantityId: role, symbol: role, unit: "1" } : {}),
  };
  return `\nFINITE ALGEBRA SOURCE DATA\n${JSON.stringify(sourceData)}\n
These fields are recomputed from the complete submitted source by exact finite rational arithmetic; options and answer markers supply no numeric authority. Preserve the original QUESTION verbatim, including its OCR glyphs. Do not encode a polynomial as a scalar given such as P(x)=1, or invent numeric givens. Use givens=[], qualitativeClaims=[], assumptions=[] when no other source-supported numeric premise is needed. A nonmetric coefficient table helps explain this finite arithmetic, so visualRequirement=optional.
For a coefficient TurnPlan, use exactly the source-data quantityId and symbol for BOTH the unknown and derived result, with unit 1. Use coefficientNumber as its derived value. Do not invent term enumerations, decomposition sums, unrelated intermediate scalars or claims. For full expansion use no scalar unknowns or derived rows; the full expression carries every coefficient.
For ProblemIR, retain the complete function AST and exactly quoted original expression/request facts. Statements may say "full source expression" and "full source request" without rewriting OCR. Retain one other entity P(x) with given evidence and a conceptual intent covering both facts. For a coefficient, retain a separate scalar expression for coefficientExact and one evaluate request bound to the actual TurnPlan unknown with the same ID, symbol and unit 1. Its evidence is the requested fact. Full expansion has no scalar solve requests. Never replace the full function expression with the scalar coefficient. Return all actual obligations; unsupported extra premises, facts, fields or requests must remain unresolved. Every returned field is independently audited before teaching or drawing.\n`;
}
