import { validateTurnPlanV3 } from "../contracts/contractsV3";
import { readSourceLinearCoordinate } from "../ir/linearScalarBinding";
import { compareRational, deserializeRational, exactRationalText, exactRationalToNumber, type ExactRational } from "../math/exactRational";
import { parseLinearAffine, solveLinearFigure, type ExactAffine, type FeasibleRegionSolution } from "../math/linearRegion";
import type { SceneIssue } from "../types";
import { buildLinearSourceDocument } from "./linearRegionSource";

const normalizeSymbol = (symbol: string): string => symbol.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}\s]/g, "");
const dimensionless = (unit: string | undefined): boolean => unit === undefined || unit.trim() === "" || unit.trim() === "1";
const sameAffine = (left: ExactAffine, right: ExactAffine): boolean => (["a", "b", "constant"] as const).every(key => compareRational(deserializeRational(left[key]), deserializeRational(right[key])) === 0);

/**
 * Bind source labels only after the complete original program was validated.
 * This reader does not establish math authority: its expression must equal
 * the independently reconstructed whole-source objective coefficient by
 * coefficient. Arbitrary planner aliases and per-corner labels never join.
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

/** A finite limit/optimal edge cannot authorize one arbitrary x/y point. */
function requestedUniqueOptimum(question: string, constraints: string[], expression: string, solution: FeasibleRegionSolution): { x: ExactRational; y: ExactRational } | null {
  if (!/\b(?:find|determine|calculate|give|state|report|mark|show)\s+(?:(?:the|an)\s+)?(?:optimal|maximizing|minimizing)\s+(?:point|solution|coordinates?|values?)\b/i.test(question)) return null;
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

/** Checks native affine source roles without changing the planner or audit. */
export function validateLinearSourcePlan(question: string, rawPlan: unknown): SceneIssue[] {
  if (rawPlan === undefined || rawPlan === null) return [];
  const document = buildLinearSourceDocument(question);
  const construction = document?.constructions[0];
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
      for (const quantity of quantities) {
        const symbol = normalizeSymbol(quantity.symbol);
        const declared = plan.unknowns.find(unknown => unknown.id === quantity.id);
        const role = readSourceLinearCoordinate(question, quantity.symbol, { requireRequestedVariable: false });
        if (quantity.path.startsWith("derived[") && declared) {
          const declaredRole = readSourceLinearCoordinate(question, declared.symbol, { requireRequestedVariable: false });
          if (!declaredRole || !role || declaredRole.variable !== role.variable) {
            issues.push(fatal("linear_source_plan_binding_mismatch", `Finite requested answer '${quantity.id}' ('${declared.symbol}' -> '${symbol}') does not preserve the same proved original-source coordinate role`, quantity.path));
          }
        }
        if (!/^[xy](?:_[A-Za-z][A-Za-z0-9_]*)?$/.test(symbol)) continue;
        check(symbol, quantity.unit, quantity.value, quantity.path, role?.coordinate ?? null, "unique source intersection coordinate");
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
      const semanticSense = (symbol: string): "max" | "min" | null => /^(?:maximum|max)$/i.test(symbol) ? "max" : /^(?:minimum|min)$/i.test(symbol) ? "min" : null;
      const objectiveRole = (symbol: string): boolean => aliases.has(symbol) || semanticSense(symbol) === objective.sense;
      for (const quantity of quantities) {
        const symbol = normalizeSymbol(quantity.symbol);
        const declared = plan.unknowns.find(unknown => unknown.id === quantity.id);
        if (quantity.value !== undefined && declared && objectiveRole(normalizeSymbol(declared.symbol)) && !objectiveRole(symbol)) {
          issues.push(fatal("linear_source_plan_binding_mismatch", `Quantity '${quantity.id}' replaces original objective alias '${declared.symbol}' with '${symbol}'`, quantity.path));
        }
        if (quantity.path.startsWith("derived[") && declared && /^[xy]$/.test(normalizeSymbol(declared.symbol)) && symbol !== normalizeSymbol(declared.symbol)) {
          issues.push(fatal("linear_source_plan_binding_mismatch", `Quantity '${quantity.id}' replaces requested optimal coordinate '${declared.symbol}' with '${symbol}'`, quantity.path));
        }
        if (objectiveRole(symbol) || semanticSense(symbol)) check(symbol, quantity.unit, quantity.value, quantity.path, objectiveRole(symbol) ? exact : null, `${objective.sense} attained source objective`);
        if ((symbol === "x" || symbol === "y") && quantity.path.startsWith("derived[")) {
          check(symbol, quantity.unit, quantity.value, quantity.path, optimum?.[symbol] ?? null, "requested unique attained optimal coordinate");
        }
        if (quantity.path.startsWith("derived[") && declared) {
          const declaredSymbol = normalizeSymbol(declared.symbol);
          const provedRole = (candidate: string) => objectiveRole(candidate) || ((candidate === "x" || candidate === "y") && optimum !== null);
          if (!provedRole(declaredSymbol) || !provedRole(symbol)) issues.push(fatal("linear_source_plan_role_unproved", `Finite requested answer '${quantity.id}' ('${declaredSymbol}' -> '${symbol}') has no original-source objective or unique optimal-coordinate role`, quantity.path));
        }
      }
    }
  } catch (error) {
    issues.push(fatal("linear_source_plan_proof_failed", `Independent native source recomputation failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  return issues;
}
