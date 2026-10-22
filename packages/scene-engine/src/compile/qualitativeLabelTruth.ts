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
type PathLike = { kind: string; points?: Point[]; sampledCurve?: unknown };

const FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "abs", "exp", "log", "ln", "pi", "e"]);
const CURVE_KINDS = new Set(["line", "segment", "ray", "polyline", "curve", "function_curve"]);

function equationOf(text: string): { lhs: string; rhs: string } | null {
  // Allow a leading element name ("L: y = 2x + 1", "L₁ : ...").
  const body = text.replace(/^\s*[A-Za-z][A-Za-z0-9₀-₉_′']{0,3}\s*:\s*/, "").replace(/−/g, "-").trim()
    // Function notation names the ordinate: "f(x) = x²" is y = x². A built-in
    // function ("sin(x) = 2y") is an expression, not a name.
    .replace(/^([A-Za-z][A-Za-z0-9₀-₉_]{0,2})\s*\(\s*x\s*\)\s*=/, (match, name: string) => FUNCTIONS.has(name.toLowerCase()) ? match : "y =");
  const sides = body.split("=");
  if (sides.length !== 2 || !sides[0]!.trim() || !sides[1]!.trim()) return null;
  if (!/(?<![A-Za-z])[xy](?![A-Za-z])/.test(body)) return null;
  return { lhs: sides[0]!.trim(), rhs: sides[1]!.trim() };
}

/** Split an implicit product of known names ("mx" = m·x, "kxy") into its factors, or null. */
function factorNames(name: string, bound: ReadonlySet<string>): string[] | null {
  const known = [...bound, "x", "y"].filter(Boolean).sort((a, b) => b.length - a.length);
  // Remember suffixes that cannot be split, so the search stays linear in the name.
  const failed = new Set<string>();
  const walk = (rest: string): string[] | null => {
    if (!rest) return [];
    if (failed.has(rest)) return null;
    for (const factor of known) {
      if (!rest.startsWith(factor)) continue;
      const tail = walk(rest.slice(factor.length));
      if (tail) return [factor, ...tail];
    }
    failed.add(rest);
    return null;
  };
  return walk(name);
}

function freeParameters(text: string, bound: ReadonlySet<string>): string[] {
  // Whole names, digits and subscripts included ("k1", "m₂"), so a bound quantity is recognised.
  // Numbers, scientific notation included ("0.75e0", "1e-3"), are not names.
  const names = text.replace(/(?<![A-Za-z_])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, " ").match(/[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*/g) ?? [];
  return [...new Set(names.filter((name) => {
    if (name === "x" || name === "y" || bound.has(name)) return false;
    if (FUNCTIONS.has(name.toLowerCase())) return false;
    // Implicit products of known names and x, y ("xy", "mx") are not new symbols.
    return factorNames(name, bound) === null;
  }))];
}

export function validateQualitativeLabelTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const frame = document.entities.some((entity) => entity.kind === "axes");
  // Quantities with numeric values may appear by symbol or id in an equation.
  const bound = new Set(document.quantities.filter((quantity) => typeof quantity.value === "number")
    .flatMap((quantity) => [quantity.id, typeof quantity.symbol === "string" ? quantity.symbol : ""]).filter(Boolean));
  const values: Array<[string, number]> = document.quantities.filter((quantity) => typeof quantity.value === "number")
    .flatMap((quantity) => [quantity.id, typeof quantity.symbol === "string" ? quantity.symbol : ""].filter((name) => name && name !== "x" && name !== "y").map((name): [string, number] => [name, quantity.value as number]))
    .sort((a, b) => b[0].length - a[0].length);
  const coordinateLabel = /^\s*\(\s*[+\-−]?\d+(?:\.\d+)?\s*,\s*[+\-−]?\d+(?:\.\d+)?\s*\)\s*$/;
  const pinnedPoints = (ownerId: string): number => {
    const value = geometry.get(ownerId) as PathLike | undefined;
    const path = value?.kind === "path" ? value.points ?? [] : [];
    if (path.length < 2) return 0;
    const near = (p: Point) => path.slice(1).some((b, i) => {
      const a = path[i]!; const dx = b.x - a.x, dy = b.y - a.y; const span = Math.hypot(dx, dy) || 1;
      return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / span <= 1e-6 * Math.max(1, span);
    });
    // Coordinates may be shown by the point's own label or by a label annotation on it.
    const shown = (entity: SceneDocument["entities"][number]) => (typeof entity.label === "string" && coordinateLabel.test(entity.label)) ||
      document.annotations.some((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.length === 1
        && annotation.targetIds[0] === entity.id && typeof annotation.text === "string" && coordinateLabel.test(annotation.text));
    return document.entities.filter((entity) => entity.kind === "point" && shown(entity))
      .map((entity) => (geometry.get(entity.id) as { kind?: string; point?: Point } | undefined))
      .filter((value) => value?.kind === "point" && value.point && near(value.point)).length;
  };
  const checkEquation = (ownerId: string, text: unknown, path: string) => {
    if (!frame || typeof text !== "string") return;
    // Only judge notation the checker reads: LaTeX and other markup is skipped, never refused.
    if (/[\\{}]/.test(text)) return;
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
      // Scientific notation ("1e-3") is a number, not a product with e.
      const product = (side: string) => side.replace(/(\d)\s*(?![eE][+-]?\d)([A-Za-z(])/g, "$1*$2").replace(/\)\s*([A-Za-z0-9(])/g, ")*$1").replace(/([xy])\s*\(/g, "$1*(");
      // Known quantities ("m = 2") are checked with their values, not skipped.
      // Spell implicit products of known names out ("mx" becomes "m*x") first.
      const factored = (side: string) => side.replace(/[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*/g, (name) => {
        if (FUNCTIONS.has(name.toLowerCase()) || bound.has(name)) return name;
        return factorNames(name, bound)?.join("*") ?? name;
      });
      const known = (side: string) => values.reduce((text, [name, value]) => text.replace(new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g"), `(${value})`), side);
      relation = parseMathExpression2D(`(${product(known(factored(equation.lhs)))})-(${product(known(factored(equation.rhs)))})`);
    } catch {
      return; // Notation the checker cannot read is not evidence of a false label.
    }
    const value = geometry.get(ownerId) as PathLike | undefined;
    // An implicit curve is drawn as several paths; every one must satisfy the label.
    const paths = value?.kind === "path" ? [value.points ?? []] : value?.kind === "multi_path" ? ((value as { paths?: Point[][] }).paths ?? []) : [];
    const vertices = paths.flat();
    if (vertices.length < 2) return;
    // A false equation can agree at the two ends of a straight piece ("y = x²"
    // on the segment from (0, 0) to (1, 1)); test inside every piece too.
    // A sampled curve's vertices are exact samples; only straight pieces are interpolated.
    const sampled = (value as { sampledCurve?: unknown }).sampledCurve !== undefined;
    const points = paths.flatMap((piece) => piece.flatMap((point, index) => {
      const next = piece[index + 1];
      if (!next || sampled || value?.kind === "multi_path") return [point];
      return [0, 0.25, 0.5, 0.75].map((t) => ({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t }));
    }));
    const scale = Math.max(1, ...points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));
    // An equation undefined at drawn points ("y = sqrt(x)" on x < 0) does not
    // describe them. One undefined boundary sample is tolerated.
    let undefinedAt = 0;
    const misses = points.some((point) => {
      try {
        // Compare distance from the labelled curve (|F| / |grad F|), so a scaled
        // equation is judged like the plain one. Contours allow their grid error.
        const f = relation.evaluate(point.x, point.y);
        const h = 1e-6 * scale;
        // Probes beside the point may leave the equation's domain (a semicircle's
        // ends); use a one-sided difference there, and only the point itself can
        // make the equation undefined.
        const at = (x: number, y: number) => { try { return relation.evaluate(x, y); } catch { return undefined; } };
        const slope = (plus: number | undefined, minus: number | undefined) =>
          plus !== undefined && minus !== undefined ? (plus - minus) / (2 * h) : plus !== undefined ? (plus - f) / h : minus !== undefined ? (f - minus) / h : 0;
        const gx = slope(at(point.x + h, point.y), at(point.x - h, point.y));
        const gy = slope(at(point.x, point.y + h), at(point.x, point.y - h));
        const gradient = Math.hypot(gx, gy);
        // Any non-zero gradient gives a scale-free distance; only an exactly flat
        // point falls back to the raw value.
        const distance = gradient > 0 ? Math.abs(f) / gradient : f === 0 ? 0 : Infinity;
        return distance > (value?.kind === "multi_path" ? 0.05 : 1e-4) * scale;
      } catch {
        undefinedAt += 1;
        return false;
      }
    }) || undefinedAt > 1;
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
  const fieldLabel = /^\s*(?:B|E|H|Φ)(?:_?[0-9₀-₉A-Za-z]{0,3})?(?:\s|⃗|$)/u;
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
