/**
 * Truth checks for marks that the qualitative path used to draw unchecked.
 *
 * 1. An equation label in x and y on a drawn line or curve, in a coordinate
 *    frame, must be an equation of that element: no free parameter (the family
 *    "y - 3 = m(x - 2)" is not this line) and every drawn point satisfies it.
 * 2. A sign badge marks a sense along a path (polarity, a current, a turning
 *    sense). It cannot stand for a field: "B" on a rod reads as a field along
 *    the rod.
 */
import { parseMathExpression2D } from "../math/expression";
import type { SceneDocument, SceneIssue } from "../types";

type Point = { x: number; y: number };
type PathLike = { kind: string; points?: Point[] };

const FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "abs", "exp", "log", "ln", "pi", "e"]);
const CURVE_KINDS = new Set(["line", "segment", "ray", "polyline", "curve", "function_curve"]);

function equationOf(text: string): { lhs: string; rhs: string } | null {
  // Allow a leading element name ("L: y = 2x + 1", "L₁ : ...").
  const body = text.replace(/^\s*[A-Za-z][A-Za-z0-9₀-₉_′']{0,3}\s*:\s*/, "").replace(/−/g, "-").trim()
    // Function notation names the ordinate: "f(x) = x²" is y = x².
    .replace(/^[A-Za-z][A-Za-z0-9₀-₉_]{0,2}\s*\(\s*x\s*\)\s*=/, "y =");
  const sides = body.split("=");
  if (sides.length !== 2 || !sides[0]!.trim() || !sides[1]!.trim()) return null;
  if (!/(?<![A-Za-z])[xy](?![A-Za-z])/.test(body)) return null;
  return { lhs: sides[0]!.trim(), rhs: sides[1]!.trim() };
}

function freeParameters(text: string, bound: ReadonlySet<string>): string[] {
  const names = text.match(/[A-Za-zα-ωΑ-Ω]+/g) ?? [];
  return [...new Set(names.filter((name) => {
    if (name === "x" || name === "y" || bound.has(name)) return false;
    if (FUNCTIONS.has(name.toLowerCase())) return false;
    // Implicit products of x and y ("xy", "yx") are not new symbols.
    return !/^[xy]+$/.test(name);
  }))];
}

export function validateQualitativeLabelTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const frame = document.entities.some((entity) => entity.kind === "axes");
  // Quantities with numeric values may appear by symbol or id in an equation.
  const bound = new Set(document.quantities.filter((quantity) => typeof quantity.value === "number")
    .flatMap((quantity) => [quantity.id, typeof quantity.symbol === "string" ? quantity.symbol : ""]).filter(Boolean));
  const coordinateLabel = /^\s*\(\s*[+\-−]?\d+(?:\.\d+)?\s*,\s*[+\-−]?\d+(?:\.\d+)?\s*\)\s*$/;
  const pinnedPoints = (ownerId: string): number => {
    const value = geometry.get(ownerId) as PathLike | undefined;
    const path = value?.kind === "path" ? value.points ?? [] : [];
    if (path.length < 2) return 0;
    const near = (p: Point) => path.slice(1).some((b, i) => {
      const a = path[i]!; const dx = b.x - a.x, dy = b.y - a.y; const span = Math.hypot(dx, dy) || 1;
      return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / span <= 1e-6 * Math.max(1, span);
    });
    return document.entities.filter((entity) => entity.kind === "point" && typeof entity.label === "string" && coordinateLabel.test(entity.label))
      .map((entity) => (geometry.get(entity.id) as { kind?: string; point?: Point } | undefined))
      .filter((value) => value?.kind === "point" && value.point && near(value.point)).length;
  };
  const checkEquation = (ownerId: string, text: unknown, path: string) => {
    if (!frame || typeof text !== "string") return;
    const equation = equationOf(text);
    if (!equation) return;
    const entity = document.entities.find((candidate) => candidate.id === ownerId);
    if (!entity || !CURVE_KINDS.has(entity.kind)) return;
    const free = freeParameters(`${equation.lhs} ${equation.rhs}`, bound);
    // A representative curve may carry a symbolic standard form. The family
    // label is false only when the drawn element is a specific member: it
    // passes through two points labelled with numeric coordinates.
    if (free.length && pinnedPoints(ownerId) >= 2) {
      issues.push({ code: "equation_label_unbound_parameter", severity: "fatal", failureKind: "proof", entityIds: [ownerId], path,
        message: `The equation label leaves ${free.join(", ")} undetermined, so it names a family, not the drawn element` });
      return;
    }
    let relation: ReturnType<typeof parseMathExpression2D>;
    try {
      // Written labels use implicit products ("2x", "3(x - 2)", "(x+1)(x-1)").
      const product = (side: string) => side.replace(/(\d)\s*([A-Za-z(])/g, "$1*$2").replace(/\)\s*([A-Za-z0-9(])/g, ")*$1").replace(/([xy])\s*\(/g, "$1*(");
      relation = parseMathExpression2D(`(${product(equation.lhs)})-(${product(equation.rhs)})`);
    } catch {
      return; // Notation the checker cannot read is not evidence of a false label.
    }
    const value = geometry.get(ownerId) as PathLike | undefined;
    const points = value?.kind === "path" ? value.points ?? [] : [];
    if (points.length < 2) return;
    const scale = Math.max(1, ...points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));
    const misses = points.some((point) => {
      try {
        return Math.abs(relation.evaluate(point.x, point.y)) > 1e-4 * scale;
      } catch {
        return false;
      }
    });
    if (misses) {
      issues.push({ code: "equation_label_contradicts_geometry", severity: "fatal", failureKind: "truth", entityIds: [ownerId], path,
        message: "The drawn element does not satisfy its equation label" });
    }
  };
  document.entities.forEach((entity, index) => checkEquation(entity.id, entity.label, `entities[${index}].label`));
  document.annotations.forEach((annotation, index) => {
    if ((annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.length === 1) {
      checkEquation(annotation.targetIds[0]!, annotation.text, `annotations[${index}].text`);
    }
  });

  // A sense badge along a wire or arm can mark a current or a turning sense;
  // a field never lies along the conductor it acts on.
  const vectorName = /\b(?:field|flux)\b/i;
  const fieldLabel = /^\s*(?:B|E|H|Φ|Φ_?B)(?:\s|_|⃗|$)/u;
  for (const construction of document.constructions) {
    if (construction.operator !== "sign_badge") continue;
    for (const id of construction.outputs) {
      const entity = document.entities.find((candidate) => candidate.id === id);
      const labels = [entity?.label, ...document.annotations.filter((annotation) => annotation.targetIds.includes(id)).map((annotation) => annotation.kind === "label" || annotation.kind === "callout" ? annotation.text : undefined)];
      if (vectorName.test(entity?.role ?? "") || labels.some((label) => typeof label === "string" && fieldLabel.test(label))) {
        issues.push({ code: "sign_badge_names_vector", severity: "fatal", failureKind: "truth", entityIds: [id],
          message: "A sense badge cannot represent a field; it would be read as a field along the marked path" });
      }
    }
  }
  return issues;
}
