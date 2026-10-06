import { readCircleSourceProgram, circleSourceResultFormula, circleRoleValue } from "@heytutor/scene-engine";

/** Source operator data for planners. Does not create, replace or repair their returned Plan/IR. */
export function circleSourcePlanningGuidance(question: string): string {
  const read = readCircleSourceProgram(question);
  if (read.status !== "ok" || !read.source.equations.length) return "";
  const source = read.source;
  const coefficientNames = {A:"coefficient of x^2 and y^2",D:"coefficient of x",E:"coefficient of y",F:"constant term"} as const;
  const roles = Object.entries(coefficientNames).map(([symbol, statement]) => ({symbol, statement, value: circleRoleValue(source, symbol as keyof typeof coefficientNames), unit:"1", sourceText: statement}));
  const symbols = {center_x:"h", center_y:"k", radius:"r", radius_squared:"r_squared"} as const;
  const results = source.asks.map(role => ({role, symbol:symbols[role as keyof typeof symbols], value:circleRoleValue(source,role), unit:"1", root:circleSourceResultFormula(source,role as keyof typeof symbols)}));
  const data = {question, sourceEquations: source.equations.map(row => row.evidence), circleLabel:source.name, coefficients:roles, requestedResults:results, sourcePoints:source.points.map(point => ({name:point.name, x:point.x, y:point.y,evidence:point.evidence}))};
  return `
CARTESIAN LOCUS SOURCE OPERATOR DATA
${JSON.stringify(data)}
Return the original question unchanged. Give each requested coordinate and radius its own scalar unknown and derived row, with identical id, symbol and unit 1. A centre is two scalar requests h and k, never a scalar unknown named centre or a zero placeholder for the equation. Use source coefficient roles A,D,E,F with the supplied exact values and sourceText; h depends on A,D, k on A,E, and r/r_squared on A,D,E,F and any declared coordinate intermediates. Use the complete unsimplified requested root AST above, not a literal answer.
The original ProblemIR must retain each complete source equation with given statement equal to its exact quote, one curve/body entity labelled with the actual circleLabel, and a graph intent referencing it. Each source point remains its own evidenced point entity; never drop other original source obligations. For every numeric ask use requested facts quoting the full unchanged request clause containing its command verb and centre/radius wording; statement equals quote. Retain one scalar evaluate expression per requested role with the supplied typed root AST (omit compact expr), with source equation and request evidence, and resultBinding exactly matching that actual returned Plan id/symbol/unit 1. Do not create a point entity for an unstated centre name. Coefficient expressions are optional; if supplied, each must cite a fact stating that exact coefficient role and quoting the full source equation. Do not emit unused expressions or guessed circle constraints.
The whole original returned graph, Plan and all optional assertions are independently checked. This is planning data, not permission to substitute a generated Plan or IR. Do not add unsupported law tags, assumptions, prose claims or display hints. Decline unsupported extra conditions instead of omitting them.
`;
}
