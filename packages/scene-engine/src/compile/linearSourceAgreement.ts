import { validateTurnPlanV3 } from "../contracts/contractsV3";
import { readSourceLinearCoordinate } from "../ir/linearScalarBinding";
import { addRational, multiplyRational, compareRational, deserializeRational, divideRational, serializeRational, exactRationalText, exactRationalToNumber, type ExactRational } from "../math/exactRational";
import { parseLinearAffine, parseLinearConstraint, solveLinearFigure, type ExactAffine, type FeasibleRegionSolution } from "../math/linearRegion";
import type { SceneIssue } from "../types";
import { buildLinearSourceDocument, readLinearSourceReferencePoints, readLinearSourceSetRoles, type LinearSourceIntervalRole } from "./linearRegionSource";

const normalizeSymbol = (symbol: string): string => symbol.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}\s]/g, "");
const dimensionless = (unit: string | undefined): boolean => unit === undefined || unit.trim() === "" || unit.trim() === "1";
const sameAffine = (left: ExactAffine, right: ExactAffine): boolean => (["a", "b", "constant"] as const).every(key => compareRational(deserializeRational(left[key]), deserializeRational(right[key])) === 0);

/**
 * Bind source labels only after the complete original program was validated.
 * This reader does not establish math authority: its expression must equal
 * the independently reconstructed whole-source objective coefficient by
 * coefficient. Arbitrary planner aliases never join.
 */
function objectiveAliases(question: string, expression: string): Set<string> {
  const text = question.replace(/\\(?:left|right)/g, "").replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}/g, "($1/$2)")
    .replace(/[−–]/g, "-").replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/\$/g, "");
  const expected = parseLinearAffine(expression, ["x", "y"]);
  const labels: string[] = [];
  for (const definition of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
    if (definition[1] === "x" || definition[1] === "y") continue;
    const tail = text.slice(definition.index! + definition[0].length);
    const tokens = [...tail.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
    let end = 0;
    for (const token of tokens) {
      if (!/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|x|y|[()+*/-])$/.test(token[0])) break;
      end = token.index! + token[0].length;
    }
    try {
      if (end && sameAffine(parseLinearAffine(tail.slice(0, end), ["x", "y"]), expected)) labels.push(definition[1]!);
    } catch { /* A reference tuple or unrelated scalar is not an objective alias. */ }
  }
  if (labels.length !== 1) return new Set();
  const label = labels[0]!;
  const aliases = new Set([label]);
  for (const alias of text.matchAll(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\s+(?:is|=)\\s+${label}\\s*=`, "g"))) {
    aliases.add(alias[1]!);
    aliases.add(alias[1]!.toLowerCase());
  }
  return aliases;
}

function numericAgreement(value: number, exact: ExactRational): boolean {
  const expected = exactRationalToNumber(exact);
  if (!Number.isFinite(expected) || (expected === 0 && deserializeRational(exact).n !== 0n)) return false;
  if (expected === 0 || value === 0) return expected === value;
  return Math.abs(value - expected) <= 64 * Number.EPSILON * Math.max(Math.abs(expected), Math.abs(value));
}

function requestsOptimalPoint(question: string): boolean {
  return /\b(?:find|determine|calculate|give|state|report|mark|show)\s+(?:(?:the|an)\s+)?(?:optimal|maximizing|minimizing)\s+(?:point|solution|coordinates?|values?)\b/i.test(question);
}

/** A finite limit/optimal edge cannot authorize one arbitrary x/y point. */
function requestedUniqueOptimum(question: string, constraints: string[], expression: string, solution: FeasibleRegionSolution, explicitRole = false): { x: ExactRational; y: ExactRational } | null {
  if (!explicitRole && !requestsOptimalPoint(question)) return null;
  if (/\b[xy][- ]coordinates?\b|\b(?:twice|square|negative|centimeters?|metres?|meters?)\b/i.test(question)) return null;
  const extremum = solution.objective?.extremum;
  if (!extremum || extremum.status !== "attained") return null;
  const value = exactRationalText(extremum.value);
  const face = solveLinearFigure({ kind: "linear_feasible_region", variables: ["x", "y"], constraints: [...constraints, `(${expression})<=(${value})`, `(${expression})>=(${value})`] });
  return face.kind === "linear_feasible_region" && face.feasibility.feasible && face.dimension === 0 ? face.feasibility.witness : null;
}

function fatal(code: string, message: string, path?: string): SceneIssue {
  return { code, message, severity: "fatal", ...(path === undefined ? {} : { path }) };
}

interface NumericRole { key: string; exact: ExactRational | null }

/** An original interval quote plus an explicit endpoint role, not a scalar set claim. */
function explicitGivenIntervalEndpoint(quantity: { symbol: string; value: number; sourceText?: unknown; unit?: unknown }, role: LinearSourceIntervalRole | undefined): boolean {
  if (!role || typeof quantity.sourceText !== "string" || quantity.unit !== undefined && (typeof quantity.unit !== "string" || !dimensionless(quantity.unit))) return false;
  const compact = (text: string) => text.normalize("NFKC").replace(/[−–]/g, "-").replace(/\s/g, "");
  const definition = compact(role.definition), source = compact(quantity.sourceText);
  if (!source.startsWith(definition)) return false;
  const descriptor = /^[;,]\s*(left|right|lower|upper)(?:endpoint|boundary|bound)(.+?)(?:is(included|excluded))?[.]?$/.exec(source.slice(definition.length));
  if (!descriptor) return false;
  const lower = descriptor[1] === "left" || descriptor[1] === "lower";
  const endpoint = lower ? role.lower : role.upper;
  const included = lower ? role.lowerIncluded : role.upperIncluded;
  if (!endpoint || descriptor[3] !== undefined && (descriptor[3] === "included") !== included) return false;
  try {
    const declared = parseLinearAffine(descriptor[2]!, ["x"]);
    return deserializeRational(declared.a).n === 0n && deserializeRational(declared.b).n === 0n
      && compareRational(deserializeRational(declared.constant), deserializeRational(endpoint)) === 0
      && numericAgreement(quantity.value, endpoint);
  } catch { return false; }
}

/** Only an original line label immediately preceding a complete source equation joins an intercept. */
function labelledEquations(question: string, equations: string[]): Map<string, string> {
  const source = question.replace(/[−–]/g, "-");
  const labels = new Map<string, string>();
  for (const equation of equations) {
    const escaped = [...equation.replace(/\s/g, "")].map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    const matches = [...source.matchAll(new RegExp(escaped, "g"))];
    if (matches.length !== 1) continue;
    const prefix = source.slice(0, matches[0]!.index);
    const label = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/.exec(prefix)?.[1];
    if (label && !labels.has(label)) labels.set(label, equation);
  }
  return labels;
}

/** Checks native affine source roles without changing the planner or audit. */
export function validateLinearSourcePlan(question: string, rawPlan: unknown): SceneIssue[] {
  if (rawPlan === undefined || rawPlan === null) return [];
  const document = buildLinearSourceDocument(question);
  const construction = document?.constructions[0];
  if (construction?.operator === "number_line_set") {
    const { aliases, intervals } = readLinearSourceSetRoles(question);
    if (!aliases.size || typeof rawPlan !== "object") return [];
    // Check this one source-proved type before schema normalization can drop
    // an unknown's value or reject unrelated fields. No other number-line
    // role gains a new admission requirement here.
    return Object.entries(rawPlan).filter(([field]) => ["givens", "derived", "unknowns"].includes(field))
      .flatMap(([field, values]) => Array.isArray(values) ? values.flatMap((quantity: unknown, index) => {
        if (!quantity || typeof quantity !== "object" || !("symbol" in quantity) || typeof quantity.symbol !== "string"
          || !("value" in quantity) || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)
          || !aliases.has(normalizeSymbol(quantity.symbol))) return [];
        if (field === "givens" && explicitGivenIntervalEndpoint({ symbol: quantity.symbol, value: quantity.value,
          sourceText: "sourceText" in quantity ? quantity.sourceText : undefined, unit: "unit" in quantity ? quantity.unit : undefined }, intervals.get(normalizeSymbol(quantity.symbol)))) return [];
        return [fatal("linear_source_plan_set_scalar", `Original source '${quantity.symbol}' denotes a whole real solution set, not a finite scalar '${quantity.value}'`, `${field}[${index}]`)];
      }) : []);
  }
  if (!construction || (construction.operator !== "linear_feasible_region" && construction.operator !== "linear_system")) return [];
  const validation = validateTurnPlanV3(rawPlan, question);
  if (!validation.valid || !validation.plan) return validation.issues.map(issue => fatal("linear_source_plan_invalid", issue.message, issue.path));
  const plan = validation.plan;
  const issues: SceneIssue[] = [];
  const check = (symbol: string, unit: string | undefined, value: number | undefined, path: string, expected: ExactRational | null, role: string) => {
    if (!dimensionless(unit)) { issues.push(fatal("linear_source_plan_unit_unproved", `Original affine source has no dimensional unit for ${role} '${symbol}' (declared '${unit}')`, path)); return; }
    if (value === undefined) return;
    if (!expected) { issues.push(fatal("linear_source_plan_role_unproved", `Complete original source cannot prove a finite ${role} value for '${symbol}'`, path)); return; }
    if (!numericAgreement(value, expected)) issues.push({ ...fatal("linear_source_plan_value_mismatch", `Planner '${symbol}' value ${value} contradicts source-certified ${role} ${exactRationalText(expected)}`, path), expected: exactRationalText(expected), actual: value });
  };
  const quantities = [
    ...plan.givens.map((quantity, index) => ({ ...quantity, path: `givens[${index}]` })),
    ...plan.derived.map((quantity, index) => ({ ...quantity, path: `derived[${index}]` })),
    ...plan.unknowns.map((quantity, index) => ({ ...quantity, value: undefined, path: `unknowns[${index}]` })),
  ];
  try {
    if (construction.operator === "linear_system") {
      const equations = construction.inputs.equations as [string, string];
      const system = solveLinearFigure({ kind: "linear_system", equations });
      if (system.kind !== "linear_system") throw new Error("Native source solver returned a different figure kind");
      const labels = labelledEquations(question, equations);
      const sourceRole = (rawSymbol: string): NumericRole | null => {
        const symbol = normalizeSymbol(rawSymbol);
        const countQuery = /\b(?:how many solutions|number of solutions)\b/i.test(question)
          && !/\b(?:twice|squared?|double|half|negative|centimeters?|metres?|meters?)\b/i.test(question);
        if (/^numberofsolutions$/i.test(symbol) && countQuery) {
          return { key: "solution_cardinality", exact: system.relation === "coincident" ? null : { numerator: system.relation === "unique" ? "1" : "0", denominator: "1" } };
        }
        const forward = /^([A-Za-z][A-Za-z0-9_]*)([xy])-intercept(?:coordinate)?$/.exec(symbol);
        const reverse = /^([xy])-intercept(?:coordinate)?of([A-Za-z][A-Za-z0-9_]*)$/.exec(symbol);
        const intercept = forward ? { label: forward[1]!, variable: forward[2]! }
          : reverse ? { label: reverse[2]!, variable: reverse[1]! } : null;
        const requestedIntercept = intercept && (/\btheir\s+intercepts?\b/i.test(question)
          || new RegExp(`\\b${intercept.label}\\s+${intercept.variable}[- ]intercepts?\\b|\\b${intercept.variable}[- ]intercepts?\\s+of\\s+${intercept.label}\\b`, "i").test(question));
        if (intercept && requestedIntercept) {
          const equation = labels.get(intercept.label);
          if (!equation) return null;
          const row = parseLinearConstraint(equation, ["x", "y"], true)[0]!;
          const coefficient = deserializeRational(intercept.variable === "x" ? row.a : row.b);
          return { key: `intercept:${intercept.label}:${intercept.variable}`, exact: coefficient.n === 0n ? null : serializeRational(divideRational(deserializeRational(row.rhs), coefficient)) };
        }
        const role = readSourceLinearCoordinate(question, rawSymbol, { requireRequestedVariable: false, allowFixedCoordinate: true });
        if (role) return { key: `coordinate:${role.variable}`, exact: role.coordinate };
        // The complete native two-equation program itself gives canonical
        // x/y their coordinate identity. A direct intersection request need
        // not use the scalar-request reader's narrower "find x and y" prose.
        // Arbitrary aliases and transformed requests obtain no such join.
        return /^[xy]$/.test(symbol) && system.relation === "unique" && system.intersection
          ? { key: `coordinate:${symbol}`, exact: system.intersection[symbol as "x" | "y"] }
          : null;
      };
      for (const quantity of quantities) {
        const symbol = normalizeSymbol(quantity.symbol);
        const declared = plan.unknowns.find(unknown => unknown.id === quantity.id);
        const role = sourceRole(quantity.symbol);
        if (quantity.path.startsWith("derived[") && declared) {
          const declaredRole = sourceRole(declared.symbol);
          if ((declaredRole || role) && (!declaredRole || !role || declaredRole.key !== role.key)) {
            issues.push(fatal("linear_source_plan_binding_mismatch", `Finite requested answer '${quantity.id}' ('${declared.symbol}' -> '${symbol}') does not preserve the same proved original-source coordinate role`, quantity.path));
          }
        }
        if (role) check(symbol, quantity.unit, quantity.value, quantity.path, role.exact, role.key);
        // A source-proved empty or non-singleton solution is not a finite
        // intersection. This is different from an unsupported query/alias,
        // which remains owned by the existing planner and solver checks.
        else if (system.relation !== "unique" && /^[xy]$/.test(symbol)) {
          check(symbol, quantity.unit, quantity.value, quantity.path, null, "non-unique source system coordinate");
        }
      }
    } else {
      const { constraints, objective } = construction.inputs;
      if (!Array.isArray(constraints) || !constraints.every(row => typeof row === "string") || !objective || typeof objective !== "object") return [];
      if (!("expression" in objective) || typeof objective.expression !== "string" || !("sense" in objective) || (objective.sense !== "max" && objective.sense !== "min")) return [];
      const aliases = objectiveAliases(question, objective.expression);
      const solution = solveLinearFigure({ kind: "linear_feasible_region", variables: ["x", "y"], constraints, objective: { expression: objective.expression, sense: objective.sense } });
      if (solution.kind !== "linear_feasible_region") throw new Error("Native source solver returned a different figure kind");
      const extremum = solution.objective?.extremum;
      // A finite closure bound is not an attained maximum/minimum. The
      // native scalar role is the source's requested extremum, not an
      // invented supremum/infimum alias.
      const exact = extremum?.status === "attained" ? extremum.value : null;
      const optimum = requestedUniqueOptimum(question, constraints, objective.expression, solution);
      const explicitOptimum = requestedUniqueOptimum(question, constraints, objective.expression, solution, true);
      const references = readLinearSourceReferencePoints(question, ["x", "y"]).points;
      const semanticSense = (symbol: string): "max" | "min" | null => /^(?:maximum|max)$/i.test(symbol) ? "max" : /^(?:minimum|min)$/i.test(symbol) ? "min" : null;
      const sourceRole = (symbol: string): NumericRole | null => {
        if (aliases.has(symbol)) return { key: `objective:${objective.sense}`, exact };
        const prefix = /^(maximum|minimum|max|min)([A-Za-z][A-Za-z0-9_]*)$/i.exec(symbol);
        const suffix = /^([A-Za-z][A-Za-z0-9_]*?)_?(maximum|minimum|max|min)$/i.exec(symbol);
        const sense = semanticSense(symbol) ?? semanticSense(prefix?.[1] ?? suffix?.[2] ?? "");
        const alias = prefix?.[2] ?? suffix?.[1];
        if (semanticSense(symbol) || alias && aliases.has(alias)) return { key: `objective:${sense ?? objective.sense}`, exact: !sense || sense === objective.sense ? exact : null };
        // An objective call can only name an exact original source point or
        // an independently computed closure corner, never a planner location.
        const evaluation = /^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/.exec(symbol);
        if (evaluation && aliases.has(evaluation[1]!)) {
          const target = evaluation[2]!;
          let point = references.find(reference => reference.label === target);
          if (!point && target.split(",").length === 2) {
            const tuple = target.split(",").map(coordinate => parseLinearAffine(coordinate, ["x", "y"]));
            if (tuple.every(coordinate => deserializeRational(coordinate.a).n === 0n && deserializeRational(coordinate.b).n === 0n)) {
              const [x, y] = tuple.map(coordinate => coordinate.constant) as [ExactRational, ExactRational];
              if ([...references, ...solution.closureVertices.map(vertex => vertex.point)].some(candidate =>
                compareRational(deserializeRational(candidate.x), deserializeRational(x)) === 0
                && compareRational(deserializeRational(candidate.y), deserializeRational(y)) === 0)) point = { label: "", x, y };
            }
          }
          if (!point) return null;
          const coefficients = solution.objective!.coefficients;
          const value = serializeRational(addRational(addRational(
            multiplyRational(deserializeRational(coefficients.a), deserializeRational(point.x)),
            multiplyRational(deserializeRational(coefficients.b), deserializeRational(point.y))), deserializeRational(coefficients.constant)));
          return { key: `objective_at:${exactRationalText(point.x)},${exactRationalText(point.y)}`, exact: value };
        }
        const direct = /^([xy])$/.exec(symbol);
        const explicit = /^(?:optimal([xy])|([xy])at(optimum|maximum|minimum)|([xy])\*|(maximizing|minimizing)([xy]))$/i.exec(symbol);
        const variable = (direct?.[1] ?? explicit?.[1] ?? explicit?.[2] ?? explicit?.[4] ?? explicit?.[6]) as "x" | "y" | undefined;
        if (!variable) return null;
        // Bare x/y can be intermediate graph coordinates. An absent point
        // request supplies no optimum role and no contradiction to veto.
        if (direct && !requestsOptimalPoint(question)) return null;
        const coordinateSense = semanticSense(explicit?.[3] ?? "") ?? (explicit?.[5]?.toLowerCase() === "maximizing" ? "max" : explicit?.[5]?.toLowerCase() === "minimizing" ? "min" : null);
        return { key: `optimal_coordinate:${variable}`, exact: coordinateSense && coordinateSense !== objective.sense ? null : (explicit ? explicitOptimum : optimum)?.[variable] ?? null };
      };
      for (const quantity of quantities) {
        const symbol = normalizeSymbol(quantity.symbol);
        const declared = plan.unknowns.find(unknown => unknown.id === quantity.id);
        const role = sourceRole(symbol);
        // A given may name the objective while explicitly describing one
        // coefficient. Its complete definition must equal the source objective;
        // provenance or the word "coefficient" alone cannot bypass agreement.
        const coefficient = quantity.path.startsWith("givens[") && "sourceText" in quantity ? /^coefficient\s+of\s+([xy])\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/i.exec(quantity.sourceText ?? "") : null;
        const coefficientRole = coefficient && aliases.has(coefficient[2]!) && sameAffine(parseLinearAffine(coefficient[3]!, ["x", "y"]), solution.objective!.coefficients)
          ? solution.objective!.coefficients[coefficient[1]!.toLowerCase() === "x" ? "a" : "b"] : null;
        if (coefficientRole) check(symbol, quantity.unit, quantity.value, quantity.path, coefficientRole, "original source objective coefficient");
        else if (role) check(symbol, quantity.unit, quantity.value, quantity.path, role.exact, role.key);
        if (quantity.path.startsWith("derived[") && declared) {
          const declaredSymbol = normalizeSymbol(declared.symbol);
          const declaredRole = sourceRole(declaredSymbol);
          if ((declaredRole || role) && (!declaredRole || !role)) issues.push(fatal("linear_source_plan_binding_mismatch", `Finite requested answer '${quantity.id}' ('${declaredSymbol}' -> '${symbol}') changes a proved original-source numeric role`, quantity.path));
          else if (declaredRole && role && declaredRole.key !== role.key) issues.push(fatal("linear_source_plan_binding_mismatch", `Finite requested answer '${quantity.id}' changes original-source numeric role '${declaredSymbol}' to '${symbol}'`, quantity.path));
        }
      }
    }
  } catch (error) {
    issues.push(fatal("linear_source_plan_proof_failed", `Independent native source recomputation failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  return issues;
}
