/**
 * Truth checks for marks that the qualitative path used to draw unchecked.
 *
 * 1. An equation label in x and y on a drawn line or curve, in a coordinate
 *    frame, must be an equation of that element: no free parameter (the family
 *    "y - 3 = m(x - 2)" is not this line) and every drawn point satisfies it.
 *    Only real equations in the x, y frame are judged: prose callouts, notation
 *    the checker cannot read ("1/2x", LaTeX), a frame whose horizontal axis is
 *    not x, an engine-built chemistry display frame, and a picture drawn beside
 *    the graph are skipped, never refused.
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
/** A numeric coordinate pair anywhere in a label: "(2, 3)", "P(2, 3)", "A = (6, 0)". */
const COORDINATE_PAIR = /\(\s*[+\-−]?\d+(?:\.\d+)?\s*,\s*[+\-−]?\d+(?:\.\d+)?\s*\)/;
/** The display factor the archetype graphs write ("(0.25)*(x^2)"): the curve is drawn k times its true height. */
const DISPLAY_SCALED = /^\s*\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*\)\s*\*\s*\(.*\)\s*$/;

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
  const names = text.replace(/(?<![A-Za-z0-9_₀-₉α-ωΑ-Ω.])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_])/g, " ").match(/[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*/g) ?? [];
  return [...new Set(names.filter((name) => {
    if (name === "x" || name === "y" || bound.has(name)) return false;
    if (FUNCTIONS.has(name.toLowerCase())) return false;
    // Implicit products of known names and x, y ("xy", "mx") are not new symbols.
    return factorNames(name, bound) === null;
  }))];
}

/**
 * A division followed by an implicit product ("1/2x", "1/x(x+1)", "1/xy") reads
 * as 1/(2x) or as x/2. Such a label is unreadable, never evidence of a false one.
 */
function ambiguousDivision(text: string): boolean {
  for (const match of text.matchAll(/\/\s*(\d+(?:\.\d+)?|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*)\s*([A-Za-z(0-9]?)/g)) {
    const operand = match[1]!;
    const next = match[2]!;
    if (/^\d/.test(operand)) { if (next && /[A-Za-z(]/.test(next)) return true; continue; }
    if (FUNCTIONS.has(operand.toLowerCase())) continue;
    if (operand.length > 1 || next) return true;
  }
  return false;
}

/**
 * Axis names read from the axes' label, else its role ("x-t", "v-t axes",
 * "displacement–time axes"), vertical first as the graph names are written.
 * A time axis, or a horizontal axis that is not x, is not the x, y frame the
 * equation is read in.
 */
function horizontalAxisIsNotX(document: SceneDocument): boolean {
  const pairOf = (text: unknown) => typeof text === "string"
    ? /^\s*([^\s\-–—(]+)(?:\s*\([^)]*\))?\s*(?:[-–—]|\s(?:vs\.?|versus|against)\s)\s*([^\s\-–—(]+)/i.exec(text)
    : null;
  return document.entities.filter((entity) => entity.kind === "axes").some((axes) => {
    if ([axes.label, axes.role].some((text) => typeof text === "string" && /\btime\b/i.test(text))) return true;
    const pair = pairOf(axes.label) ?? pairOf(axes.role);
    if (!pair) return false;
    const [vertical, horizontal] = [pair[1]!, pair[2]!];
    // Axis symbols are short ("v-t", "P-V", "B/A-A"); "xy-coordinate axes" names no pair.
    if (vertical.length > 3 || horizontal.length > 3) return false;
    if (["x", "y"].includes(vertical) && ["x", "y"].includes(horizontal)) return false; // "x-y axes" is the plane
    return horizontal !== "x";
  });
}

export function validateQualitativeLabelTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const frame = document.entities.some((entity) => entity.kind === "axes");
  // Quantities with numeric values may appear by symbol or id in an equation.
  // Only a plain name can stand in a label: a symbol written as an expression
  // ("sin x", "coefficient of x") or a function name is never substituted.
  const IDENTIFIER = /^[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*$/;
  const nameOf = (name: unknown): name is string => typeof name === "string" && IDENTIFIER.test(name) && !FUNCTIONS.has(name.toLowerCase());
  const bound = new Set(document.quantities.filter((quantity) => typeof quantity.value === "number")
    .flatMap((quantity) => [quantity.id, quantity.symbol]).filter(nameOf));
  const values: Array<[string, number]> = document.quantities.filter((quantity) => typeof quantity.value === "number")
    .flatMap((quantity) => [quantity.id, quantity.symbol].filter(nameOf).filter((name) => name !== "x" && name !== "y").map((name): [string, number] => [name, quantity.value as number]))
    .sort((a, b) => b[0].length - a[0].length);
  const pinnedPoints = (ownerId: string): number => {
    const value = geometry.get(ownerId) as PathLike | undefined;
    const path = value?.kind === "path" ? value.points ?? [] : [];
    if (path.length < 2) return 0;
    const near = (p: Point) => path.slice(1).some((b, i) => {
      const a = path[i]!; const dx = b.x - a.x, dy = b.y - a.y; const span = Math.hypot(dx, dy) || 1;
      return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / span <= 1e-6 * Math.max(1, span);
    });
    // Coordinates may be shown anywhere in the point's own label ("P(2, 3)",
    // "A = (6, 0)") or in any label or callout that points at it.
    const shown = (entity: SceneDocument["entities"][number]) => (typeof entity.label === "string" && COORDINATE_PAIR.test(entity.label)) ||
      document.annotations.some((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(entity.id)
        && typeof annotation.text === "string" && COORDINATE_PAIR.test(annotation.text));
    return document.entities.filter((entity) => entity.kind === "point" && shown(entity))
      .map((entity) => (geometry.get(entity.id) as { kind?: string; point?: Point } | undefined))
      .filter((value) => value?.kind === "point" && value.point && near(value.point)).length;
  };
  // The equation is read in the x, y frame of the axes. A frame whose
  // horizontal axis is t (or anything but x) is not that frame.
  // Engine-built chemistry graphs draw physical quantities in a normalised
  // display frame ("y=0" marks the physical zero, not world y = 0); their
  // labels are computed from the source law, not authored in x and y.
  const displayFrame = typeof document.source.chemistryFamily === "string" || document.source.sourceLawGraph !== undefined;
  const xyFrame = frame && !displayFrame && !horizontalAxisIsNotX(document);
  const boxes = [...geometry.values()].filter((value): value is { kind: "axes"; xMin: number; xMax: number; yMin: number; yMax: number } =>
    (value as { kind?: string } | undefined)?.kind === "axes");
  /** Whether any drawn piece of the element meets an axes box; a picture beside the graph does not. */
  const onGraph = (pieces: Point[][], infinite: boolean): boolean => boxes.some((box) => {
    const ex = 1e-6 * Math.max(1, box.xMax - box.xMin), ey = 1e-6 * Math.max(1, box.yMax - box.yMin);
    const [x0, x1, y0, y1] = [box.xMin - ex, box.xMax + ex, box.yMin - ey, box.yMax + ey];
    const far = 1e3 * Math.max(1, box.xMax - box.xMin, box.yMax - box.yMin);
    return pieces.some((piece) => piece.some((a, index) => {
      if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) return true;
      let b = piece[index + 1];
      if (!b) return false;
      let start = a;
      if (infinite) {
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        start = { x: a.x - ux * far, y: a.y - uy * far }; b = { x: a.x + ux * far, y: a.y + uy * far };
      }
      // Clip the straight piece against the box (Liang and Barsky).
      let lo = 0, hi = 1;
      const dx = b.x - start.x, dy = b.y - start.y;
      for (const [p, q] of [[-dx, start.x - x0], [dx, x1 - start.x], [-dy, start.y - y0], [dy, y1 - start.y]] as const) {
        if (p === 0) { if (q < 0) return false; continue; }
        const t = q / p;
        if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
        if (lo > hi) return false;
      }
      return true;
    }));
  });
  const checkEquation = (ownerId: string, text: unknown, path: string) => {
    if (!xyFrame || typeof text !== "string") return;
    // Only judge notation the checker reads: LaTeX and other markup is skipped, never refused.
    if (/[\\{}]/.test(text)) return;
    const equation = equationOf(text);
    if (!equation) return;
    const entity = document.entities.find((candidate) => candidate.id === ownerId);
    if (!entity || !CURVE_KINDS.has(entity.kind)) return;
    // Prose around an equation ("Retain the side below x + y = 6", "Boundary
    // 3x + 4y = 18") is a callout, not an equation label: a word of three or
    // more letters that is no function, known quantity or product of them.
    const words = `${equation.lhs} ${equation.rhs}`.match(/[A-Za-zα-ωΑ-Ω][A-Za-z0-9_₀-₉α-ωΑ-Ω]*/g) ?? [];
    if (words.some((word) => /[A-Za-z]{3,}/.test(word) && !FUNCTIONS.has(word.toLowerCase()) && !bound.has(word) && factorNames(word, bound) === null)) return;
    if (ambiguousDivision(`${equation.lhs} ${equation.rhs}`)) return;
    const owner = geometry.get(ownerId) as (PathLike & { infinite?: boolean; paths?: Point[][] }) | undefined;
    const pieces = owner?.kind === "path" ? [owner.points ?? []] : owner?.kind === "multi_path" ? owner.paths ?? [] : [];
    if (!onGraph(pieces, owner?.kind === "path" && owner.infinite === true)) return;
    const free = freeParameters(`${equation.lhs} ${equation.rhs}`, bound);
    // A representative curve may carry a symbolic standard form. The family
    // label is false only when the drawn element is a specific member: it
    // passes through two points labelled with numeric coordinates.
    // A companion label on the same element can fix a parameter ("Z = 10"
    // beside "Z = 2x + 2y"); the equation is then fully stated and is checked.
    const assigned = new Map<string, number | null>();
    const companions = [entity.label, ...document.annotations
      .filter((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(ownerId)).map((annotation) => annotation.text)];
    for (const companion of companions) {
      const match = typeof companion === "string" ? /^\s*([A-Za-z\u03b1-\u03c9\u0391-\u03a9][A-Za-z0-9_\u2080-\u2089\u03b1-\u03c9\u0391-\u03a9]*)\s*=\s*([+\-\u2212]?(?:\d+\.?\d*|\.\d+))\s*$/u.exec(companion) : null;
      if (!match || !free.includes(match[1]!)) continue;
      const number = Number(match[2]!.replace("\u2212", "-"));
      // Two different values for one name fix nothing.
      assigned.set(match[1]!, assigned.has(match[1]!) && assigned.get(match[1]!) !== number ? null : number);
    }
    const fixed = free.length > 0 && free.every((name) => typeof assigned.get(name) === "number");
    const substitutions: Array<[string, number]> = fixed
      ? [...values, ...free.map((name): [string, number] => [name, assigned.get(name) as number])].sort((a, b) => b[0].length - a[0].length)
      : values;
    if (free.length && !fixed && pinnedPoints(ownerId) >= 2) {
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
      const known = (side: string) => substitutions.reduce((text, [name, value]) => text.replace(new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g"), `(${value})`), side);
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
    const missesAt = (points: Point[]): boolean => {
      const scale = Math.max(1, ...points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))));
      // An equation undefined at drawn points ("y = sqrt(x)" on x < 0) does not
      // describe them. One undefined boundary sample is tolerated.
      let undefinedAt = 0;
      return points.some((point) => {
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
    };
    // A display scaled curve ("(0.25)*(x^2)", drawn a quarter of its true
    // height) is labelled with its true equation: read it with the factor
    // divided out. Its drawn equation is accepted too, as before.
    const construction = document.constructions.find((candidate) => candidate.outputs.includes(ownerId));
    const factor = construction?.operator === "function_curve" && typeof construction.inputs.expression === "string"
      ? Number(DISPLAY_SCALED.exec(construction.inputs.expression)?.[1]) : NaN;
    const misses = missesAt(points) && !(Number.isFinite(factor) && factor !== 0 && !missesAt(points.map((point) => ({ x: point.x, y: point.y / factor }))));
    if (misses) {
      issues.push({ code: "equation_label_contradicts_geometry", severity: "fatal", failureKind: "truth", entityIds: [ownerId], path,
        message: "The drawn element does not satisfy its equation label" });
    }
  };
  document.entities.forEach((entity, index) => checkEquation(entity.id, entity.label, `entities[${index}].label`));
  // A label or callout with several targets names every curve it points at
  // ("y - 3 = m(x - 2)" on the line and its point names the line).
  document.annotations.forEach((annotation, index) => {
    if (annotation.kind !== "label" && annotation.kind !== "callout") return;
    for (const target of new Set(annotation.targetIds)) checkEquation(target, annotation.text, `annotations[${index}].text`);
  });

  // A sense badge along a wire or arm can mark a current or a turning sense;
  // a field never lies along the conductor it acts on.
  const fieldRole = /\b(?:field|flux)\b|\bmagnetic induction\b|\belectric (?:field )?intensity\b/i;
  // A badge for a current or a moving charge marks a sense along the path even
  // when its role names the field or flux it responds to.
  const carrierRole = /\b(?:currents?|charges?|electrons?|protons?|ions?|e\.?m\.?f\.?)\b/i;
  // Along a field line, or round a loop or path about a source (Ampere's
  // circulation), a field badge is the field's own sense.
  const fieldPath = (role: string) => /\b(?:field lines?|lines? of (?:force|induction)|flux lines?|amperian|gaussian)\b/i.test(role)
    || (/\b(?:loop|path|circle)\b[^.]*\b(?:round|around|encircl\w*|enclos\w*)\b/i.test(role) && !/\b(?:rod|rail|conductor|conducting|circuit|coil)\b/i.test(role));
  const fieldName = (label: string): boolean => {
    // Mathematical bold or italic letters ("𝐁", "𝑩") are the plain letter in a vector font.
    let text = label.replace(/[\u{1D400}-\u{1D7FF}]/gu, (glyph) => glyph.normalize("NFKC")).trim();
    // "\vec{B}", "\mathbf{B}", "\vec B", "\overrightarrow{E}" name the vector.
    text = text.replace(/\\(?:vec|mathbf|boldsymbol|bm|overrightarrow|vv)\s*(?:\{\s*([^{}]*?)\s*\}|\s+(\S))/g, (_m, braced?: string, bare?: string) => braced ?? bare ?? "");
    // A bare field letter, an arrow, a subscript (digits, unicode subscripts, or
    // after "_"), or a bracketed qualifier; then the end or a separator ("B-field",
    // "B field", "B = 0.2 T"). "EMF" and "Edge" are words, not field names.
    return /^(?:B|E|H|Φ)\u20d7?(?:[0-9₀-₉ₐ-ₜ]+|_\{?[A-Za-z0-9]+\}?)?\u20d7?(?:\s*\([^)]*\))?(?:$|[\s\-–—:=,;])/u.test(text);
  };
  for (const construction of document.constructions) {
    if (construction.operator !== "sign_badge") continue;
    const target = document.entities.find((candidate) => candidate.id === construction.inputs.target);
    if (fieldPath(target?.role ?? "")) continue;
    for (const id of construction.outputs) {
      const entity = document.entities.find((candidate) => candidate.id === id);
      const role = entity?.role ?? "";
      const labels = [entity?.label, ...document.annotations.filter((annotation) => annotation.targetIds.includes(id)).map((annotation) => annotation.kind === "label" || annotation.kind === "callout" ? annotation.text : undefined)];
      if ((fieldRole.test(role) && !carrierRole.test(role)) || labels.some((label) => typeof label === "string" && fieldName(label))) {
        issues.push({ code: "sign_badge_names_vector", severity: "fatal", failureKind: "truth", entityIds: [id],
          message: "A sense badge cannot represent a field; it would be read as a field along the marked path" });
      }
    }
  }
  return issues;
}
