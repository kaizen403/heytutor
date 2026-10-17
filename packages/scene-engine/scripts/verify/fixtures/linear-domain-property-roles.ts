import type { SceneDocument } from "../../../src/types";

export type DomainPropertyShape = "number_line_set" | "linear_half_plane" | "linear_feasible_region" | "linear_system";
export interface DomainPropertyCase {
  id: string;
  question: string;
  shape: DomainPropertyShape;
  inputs?: Record<string, unknown>;
}
const requests: Record<DomainPropertyShape, string> = {
  number_line_set: "Graph x<4 on a number line",
  linear_half_plane: "Shade x+y<4",
  linear_feasible_region: "Draw the feasible region x>=-10, y>=-10, x+y<4",
  linear_system: "Graph x+y=6 and x-y=2",
};

/** Frozen before the repair: adjective and predicate domain forms, independent
 * of whether the rest of the request is within the native reader's grammar. */
export const unsupportedRationalCases: DomainPropertyCase[] = [];
for (const shape of Object.keys(requests) as DomainPropertyShape[]) for (const type of ["rational", "irrational"]) {
  const subjects = shape === "number_line_set" ? "x" : "x and y";
  const forms = [
    `for ${type} ${subjects}`, `for ${type} variables ${subjects}`, `for ${type} numbers ${subjects}`,
    `given ${type} values ${subjects}`, `where ${subjects} are ${type}`, `where ${subjects} take only ${type} values`,
    `for strictly positive ${type} ${subjects}`, `for ${type} nonzero variables ${subjects}`,
    `for ${type} strictly positive variables ${subjects}`, `for ${type}-valued ${subjects}`,
    `for ${type} u and x`, `for ${type} x, u, and y`,
    `for ${type} x values`, `for ${type} ${"positive ".repeat(12)}x`,
    `for ${type} ${Array.from({ length: 12 }, (_, index) => `u${index}`).join(", ")}, and x`,
    `for ${type} ${subjects}, excluding zero`, `for ${type} ${subjects} with an unfamiliar qualification`,
    `${subjects} must be ${type}`, `${subjects} have ${type} values`, `${subjects} are any ${type} numbers`,
    `${subjects} may only be ${type}`, `use ${type} solutions`, `an unfamiliar declaration requires ${type} ${subjects}`,
    `x must be a ${type} coefficient`, `x is a ${type} coefficient`, `for ${type} endpoint x`,
    `use ${type} arithmetic for x`, `find the ${type} optimal corner x`,
  ];
  for (const [index, form] of forms.entries()) for (const order of ["after", "before"] as const) {
    unsupportedRationalCases.push({ id: `typed-${shape}-${type}-${index}-${order}`, shape,
      question: order === "after" ? `${requests[shape]} ${form}.` : `${form}, ${requests[shape]}.` });
  }
}

export const coefficientPropertyCases: DomainPropertyCase[] = [];
const pluralPropertyCases: DomainPropertyCase[] = [];
for (const shape of ["number_line_set", "linear_half_plane"] as const) for (const type of ["rationals", "irrationals"]) {
  const subjects = shape === "number_line_set" ? "x" : "x and y";
  for (const suffix of [`Take ${subjects} to be one of the ${type}.`, `Restrict ${subjects} to ${type}.`,
    `Use only ${type} for ${subjects}.`, `The permitted values of ${subjects} are ${type}.`]) unsupportedRationalCases.push({
    id: `plural-domain-${shape}-${suffix}`, shape, question: `${requests[shape]}. ${suffix}`,
  });
  for (const suffix of [`The coefficients of x are ${type}.`, `Use ${type} as coefficients of x.`]) pluralPropertyCases.push({
    id: `plural-property-${shape}-${suffix}`, shape, question: `${requests[shape]}. ${suffix}`,
  });
}
coefficientPropertyCases.push(...pluralPropertyCases);
coefficientPropertyCases.push({ id: "coefficient-after-symbolic-affine-operand", shape: "linear_half_plane",
  question: "Shade y<2x and the coefficients of x may be rational.", inputs: { variables: ["x", "y"], inequality: "y<2x" } });
for (const suffix of [
  "Use rational arithmetic to explain the graph.", "The endpoint is rational.", "Its endpoint is rational.",
  "Polynomial coefficients in x are rational.", "The coefficient multiplying x is rational.",
  "If its coefficients are rational, explain the graph philosophically.",
  "Some coefficients of x are rational.", "All coefficients of x must be rational.", "The coefficient of x is always rational.",
  "The coefficient of x happens to be rational.", "Any coefficient multiplying x may be rational.", "Use some rational coefficients of x.",
  "Polynomial coefficients in x must be rational.", "The coefficient of x may be rational or irrational.",
  "A rational coefficient multiplies x.", "The rational coefficient attached to x is 1.",
  "Its rational endpoint is shown.", "Show the rational x-intercept.",
  "Use the rational x-intercept.", "The rational coefficient of x multiplies x.",
  "Use two rational coefficients of x.", "Both coefficients of x are rational.",
  "Several rational coefficients multiply x.",
  "The coefficients of x and y must be rational.", "The rational coefficients of x and y are given.",
  "The coefficient of the unknown is rational.", "The coefficients of the variables are rational.",
]) coefficientPropertyCases.push({ id: `typed-non-domain-${suffix}`, shape: "number_line_set", question: `${requests.number_line_set}. ${suffix}` });
for (const suffix of ["Its corner coordinates are rational.", "Find the rational optimal corner."]) coefficientPropertyCases.push({
  id: `typed-corner-query-${suffix}`, shape: "linear_feasible_region",
  question: `Maximize Z=2x+3y subject to x>=0,y>=0,x+y<=8 and x+2y<=11. ${suffix}`,
  inputs: { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "x+y<=8", "x+2y<=11"], objective: { expression: "2x+3y", sense: "max" } },
});
// Original stock reader positives: geometric field roles do not depend on a
// listed query verb or determiner. Keep their exact native candidate inputs.
const geometricFieldCases: DomainPropertyCase[] = [
  { id: "stock-rational-optimal-corner", shape: "linear_feasible_region",
    question: "Explain a graphical LPP with a rational optimal corner: maximize Z = 5x + 4y subject to x >= 0, y >= 0, 2x + 3y <= 12 and 4x + y <= 10. Keep the corner coordinates exact.",
    inputs: { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "2x+3y<=12", "4x+y<=10"], objective: { expression: "5x+4y", sense: "max" } } },
  { id: "stock-rational-endpoint", shape: "number_line_set",
    question: "Explain the number-line solution of -4x <= 6, including whether the rational endpoint is included.",
    inputs: { variable: "x", expression: { inequality: "-4x<=6" } } },
];
coefficientPropertyCases.push(...geometricFieldCases);
// These exact positions reproduce false x>0 authority in the original build;
// the sentence-final review example is an additional no-veto control.
for (const property of ["positive", "negative", "nonnegative", "nonpositive"]) {
  for (const subject of ["the coefficient of x is", "the coefficients of x are", "the coefficients of u and x are"]) {
    for (const [index, question] of [
      `Graph x<4 and ${subject} ${property} on a number line.`,
      `For ${subject} ${property}, graph x<4 on a number line.`,
      `${subject} ${property} and graph x<4 on a number line.`,
      `Graph x<4 subject to ${subject} ${property} on a number line.`,
    ].entries()) coefficientPropertyCases.push({ id: `coefficient-real-veto-${property}-${subject}-${index}`, shape: "number_line_set", question });
  }
}
for (const shape of ["number_line_set", "linear_half_plane"] as const) {
  const subjects = ["The coefficient of x is", "The coefficients of x are", "All coefficients of x and y are", "The coefficients of x, y, and u are",
    "The coefficient for x is", "The coefficients on x are", "The coefficients of x and the coefficients of y are",
    "The coefficient in x is", "The coefficients in x and y are", "Polynomial coefficients in x are", "The coefficient multiplying x is"];
  for (const property of ["positive", "negative", "non-negative", "nonpositive", "rational", "irrational"]) {
    for (const [index, subject] of subjects.entries()) coefficientPropertyCases.push({
      id: `coefficient-${shape}-${property}-${index}`, shape, question: `${requests[shape]}. ${subject} ${property}.`,
    });
  }
  for (const property of ["rational", "irrational"]) for (const noun of ["coefficient", "coefficients"]) {
    coefficientPropertyCases.push({ id: `prefix-coefficient-${shape}-${property}-${noun}`, shape,
      question: `${requests[shape]} with ${property} ${noun} of x.` });
  }
  for (const property of ["rational", "irrational"]) for (const noun of ["coefficients", "intercepts", "axis", "axes", "directions"]) {
    for (const subjects of ["x", "x and y"]) for (const separator of [" ", "-"]) {
      coefficientPropertyCases.push({ id: `whole-property-${shape}-${property}-${noun}-${subjects}-${separator}`, shape,
        question: `${requests[shape]} with ${property} ${subjects}${separator}${noun}.` });
    }
  }
}

export const signDomainCases = ["positive", "negative", "nonnegative", "nonpositive"].flatMap((sign, signIndex) =>
  ["The coefficients of x are positive", "The coefficient of x is negative", "The coefficients of x and y are non-negative", "The coefficients of x are rational"].flatMap((property, propertyIndex) =>
    [". x is", "; x is", " and x is"].map((connector, connectorIndex) => ({
      id: `sign-collision-${signIndex}-${propertyIndex}-${connectorIndex}`,
      question: `${requests.number_line_set}. ${property}${connector} ${sign}.`,
      shape: "number_line_set" as const, sign,
      inequality: `x${[">", "<", ">=", "<="][signIndex]}0`,
    }))));

for (const row of coefficientPropertyCases) for (const type of ["rational", "irrational"]) {
  unsupportedRationalCases.push({ ...row, id: `property-then-domain-${row.id}-${type}`,
    question: `${row.question} Now use ${type} x.` });
}
for (const row of pluralPropertyCases) for (const type of ["rationals", "irrationals"]) unsupportedRationalCases.push({
  ...row, id: `plural-property-then-domain-${row.id}-${type}`, question: `${row.question} Now use only ${type} for x.`,
});
for (const row of geometricFieldCases) for (const subject of ["x must be a", "The result is a"]) unsupportedRationalCases.push({
  ...row, id: `geometric-field-identity-${row.id}-${subject}`,
  question: `${row.question} ${subject} rational ${row.shape === "number_line_set" ? "endpoint" : "optimal corner"}.`,
});
for (const cue of ["integer", "integers", "prime", "domain"]) unsupportedRationalCases.push({
  id: `property-preserves-other-cue-${cue}`, shape: "number_line_set",
  question: `${requests.number_line_set}. The coefficients of ${cue} are rational.`,
});
for (const identity of ["equals x", "becomes x", "is x", "is x+1", "equals x<4"]) unsupportedRationalCases.push({
  id: `coefficient-value-identity-${identity}`, shape: "number_line_set",
  question: `${requests.number_line_set}. The rational coefficient ${identity}.`,
});
for (const identity of ["The unknown must be a rational coefficient.", "The variable is one of several rational coefficients.",
  "The unknowns must be rational coefficients.", "The variables are rational coefficients.",
  "The solution must be a rational coefficient.", "The result is one of several rational coefficients.",
  "The rational coefficient of x and x must be rational.", "The coefficient of x and x must be rational.",
  "The coefficient of x and y must be rational.", "The coefficient of x and x is rational.",
  "The coefficients of x and x are rational."]) unsupportedRationalCases.push({
  id: `unproved-reference-role-${identity}`, shape: "number_line_set", question: `${requests.number_line_set}. ${identity}`,
});
unsupportedRationalCases.push({ id: "identity-after-symbolic-affine-operand", shape: "linear_half_plane",
  question: "Shade y<2x and x must be a rational coefficient.", inputs: { variables: ["x", "y"], inequality: "y<2x" } });

export function domainPropertyCandidate(row: DomainPropertyCase, includeSign?: string): SceneDocument {
  const inputs: Record<DomainPropertyShape, Record<string, unknown>> = {
    number_line_set: { variable: "x", expression: includeSign ? { intersection: [{ inequality: "x<4" }, { inequality: includeSign }] } : { inequality: "x<4" } },
    linear_half_plane: { variables: ["x", "y"], inequality: "x+y<4" },
    linear_feasible_region: { variables: ["x", "y"], constraints: ["x>=-10", "y>=-10", "x+y<4"] },
    linear_system: { variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] },
  };
  return { schemaVersion: "scene-document/v2", source: { question: row.question }, visualDecision: { mode: "scene", reason: "Show the complete source solution." }, quantities: [],
    entities: [{ id: "region", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct", operator: row.shape, inputs: row.inputs ?? inputs[row.shape], outputs: ["region"] }],
    assertions: [], relations: [], annotations: [], requiredEntityIds: ["region"],
    revealGroups: [{ id: "setup", entityIds: ["region"], dependsOn: [], narrationCue: "Explain the solution." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Explain the solution." }] };
}
