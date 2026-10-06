/**
 * Section formula read from the question itself.
 *
 * A section-formula stem names its endpoints with coordinates and either a
 * ratio ("divides the join of A(2, -3) and B(5, 6) internally in the ratio
 * 1:2"), a midpoint request, or a third named point whose ratio is asked ("In
 * what ratio does P(-4, 6) divide the join of A(-6, 10) and B(3, -8)?"). This
 * module reads exactly that, solves it in exact rationals, and is the one
 * authority for three consumers: the scene (source endpoints, the segment,
 * the section point and any extension), the source check on a planner-made
 * `section_point`, and the turn plan's coordinates and ratio. A stem that is
 * ambiguous, or whose stated point is not where its stated ratio puts it,
 * yields no section at all.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { derivedLabelTargets, readDerivedCoordinateLabelClaim, validateEvaluatedDerivedValueLabels } from "../compile/derivedValueLabels";
import { validateProblemIR, type ProblemIR } from "./problemIR";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneIssue } from "../types";

type Rational = { n: bigint; d: bigint };
type ExactPoint = { x: Rational; y: Rational };
type PointNameEvidence = { name: string; start: number; end: number; quote: string };

export interface SectionPointValue {
  x: number;
  y: number;
  exact: { x: string; y: string };
}

export interface SectionFormulaSource {
  mode: "internal" | "external" | "midpoint";
  /** What the stem asks: the dividing point, or the ratio a stated point divides in. */
  asks: "point" | "ratio";
  /** `named` is false for a bare coordinate pair; its label then shows only the pair. */
  a: { name: string; named: boolean; x: number; y: number };
  b: { name: string; named: boolean; x: number; y: number };
  /** Unsigned AP:PB weights as stated, or solved for a ratio question (lowest terms). */
  m: number;
  n: number;
  point: { name: string } & SectionPointValue;
  /** Re-read from the actual question; absent only for an anonymous dividing point. */
  pointNameEvidence?: PointNameEvidence;
  /** AP/PB as a number (m/n); the requested value of a ratio question. */
  ratio: number;
}

export type SectionFormulaReading =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "inconsistent"; reason: string }
  | { status: "singular"; reason: string }
  | { status: "ok"; source: SectionFormulaSource };

const NUMBER = String.raw`[+\-−]?(?:\d+(?:\.\d+)?|\.\d+)`;
const NAMED_POINT = new RegExp(String.raw`(?<![A-Za-z0-9])([A-Z](?:_?\d)?'?)\s*(?:=\s*)?\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`, "g");
/** The shared compiled-label parser must bind every coordinate-like board claim. */
const ANNOTATION_PAIR = /[([{][\s\S]*,[\s\S]*[)\]}]/;
const ANY_PAIR = new RegExp(String.raw`\(\s*${NUMBER}\s*,\s*${NUMBER}\s*\)`, "g");
const PART = String.raw`${NUMBER}(?:\s*\/\s*\d+)?`;
const RATIO = new RegExp(String.raw`(?<![\d./])(${PART})\s*:\s*(${PART})(?![\d/]|\.\d)`, "g");
/** "in the ratio 1/2" states 1:2; only a whole-number fraction is read this way. */
const FRACTION_RATIO = /\bratio\s+(?:of\s+)?(\d+)\s*\/\s*(\d+)(?!\d|\.\d|\s*:)/i;
/** Used only when the stem names no point, so every pair is bare. */
const BARE_PAIR = new RegExp(String.raw`\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)`, "g");
const POINT_NAME = /^[A-Z](?:_?\d)?'?$/;
const POINT_IDENTITY_FAILURES = {
  conflicting: "the requested and stated dividing point names disagree",
  endpoint: "the requested dividing point is a named endpoint",
  unbound: "a source point name has no supported dividing-point role",
};

/** A name must occupy the requested-point or dividing-subject role in the source. */
function requestedPointNames(question: string): PointNameEvidence[] {
  const request = /\b(?:find|determine|calculate|locate)\s+(?:the\s+)?(?:coordinates\s+of\s+(?:the\s+)?(?:point\s+)?|point\s+|mid-?\s?point\s+)([A-Z](?:_?\d)?'?)(?=\s|[.(,;:?]|$)/gi;
  const subject = new RegExp(String.raw`(?<![A-Za-z0-9])([A-Z](?:_?\d)?'?)(?:\s*(?:=\s*)?\(\s*${NUMBER}\s*,\s*${NUMBER}\s*\))?\s+(?:(?:which|that)\s+)?(?:(?:internally|externally)\s+)?divid(?:e|es|ing)\b`, "gi");
  // Prose is case-insensitive; point identifiers retain the source's exact spelling.
  return [request, subject].flatMap((pattern) => [...question.matchAll(pattern)]
    .filter((match) => POINT_NAME.test(match[1]!))
    .map((match) => ({ name: match[1]!, start: match.index!, end: match.index! + match[0].length, quote: match[0] })));
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function rational(n: bigint, d = 1n): Rational {
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}
const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational): Rational => add(a, { n: -b.n, d: b.d });
const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational): Rational => rational(a.n * b.d, a.d * b.n);
const isZero = (a: Rational): boolean => a.n === 0n;
const same = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;
const num = (a: Rational): number => Number(a.n) / Number(a.d);
const text = (a: Rational): string => (a.d === 1n ? String(a.n) : `${a.n}/${a.d}`);

/** A ratio part: a decimal, or a decimal over a whole number ("3/2"). */
function part(raw: string): Rational {
  const [top, bottom] = raw.split("/");
  return bottom === undefined ? decimal(top!.trim()) : div(decimal(top!.trim()), decimal(bottom.trim()));
}

function decimal(raw: string): Rational {
  const clean = raw.replace("−", "-").replace(/^\+/, "");
  const [whole, fraction = ""] = clean.replace("-", "").split(".");
  const sign = clean.startsWith("-") ? -1n : 1n;
  return rational(sign * BigInt(`${whole || "0"}${fraction}`), 10n ** BigInt(fraction.length));
}

/** Integer weights in lowest terms for a positive ratio p/q. */
function lowestTerms(ratio: Rational): [number, number] {
  return [Number(ratio.n < 0n ? -ratio.n : ratio.n), Number(ratio.d)];
}

/**
 * Read a section-formula stem. `none` when the stem is not a section question
 * at all; `declined` when it is but cannot be read whole; `inconsistent` when
 * its own numbers disagree; `singular` when the stated division has no finite
 * point (external 1:1).
 */
export function readSectionFormulaSource(question: string): SectionFormulaReading {
  const stem = question.replace(/\s+/g, " ").trim();
  const asksRatio = /\bin what ratio\b|\bfind the ratio\b|\bratio in which\b|\bdetermine the ratio\b/i.test(stem);
  const midpoint = /\bmid-?\s?point\b|\bmiddle point\b/i.test(stem);
  const divides = /\bdivid(?:e|es|ed|ing)\b|\bsection\b/i.test(stem);
  if (!midpoint && !divides) return { status: "none" };
  // No coordinate pair at all: a current dividing between resistors, a
  // section of a solid. Several segments (a triangle's midpoints, a
  // centroid) belong to other families. Neither is this source.
  if (!/\(\s*[^(),]{1,12},\s*[^(),]{1,12}\)/.test(stem)) return { status: "none" };
  if (/\b(?:triangle|parallelogram|quadrilateral|rhombus|square|rectangle|centroid|incent(?:re|er)|circumcent(?:re|er)|vertices|trisect\w*|(?:three|four) equal parts)\b/i.test(stem)) return { status: "none" };
  if (/\b[xy]-?axis\b|\bline\s+[^.]*=/.test(stem) && /\bratio\b/i.test(stem)) return { status: "declined", reason: "a line or axis doing the dividing is not a two-point section" };
  if (/\bis the mid-?\s?point\b|\bmid-?\s?point (?:of [A-Z]{2} )?is\b/i.test(stem)) return { status: "declined", reason: "finding an endpoint from a stated midpoint is outside this reading" };
  let points = [...stem.matchAll(NAMED_POINT)].map((match) => ({
    name: match[1]!, named: true, x: decimal(match[2]!), y: decimal(match[3]!), at: match.index!,
  }));
  const pairCount = [...stem.matchAll(ANY_PAIR)].length;
  if (points.length === 0 && (pairCount === 2 || pairCount === 3)) {
    // Bare pairs: "the join of (-1, 7) and (4, -3)". Their ids need names;
    // labels keep the stem's bare coordinates.
    const bare = [...stem.matchAll(BARE_PAIR)];
    const lead = /\b(?:point|does)\s*\(/.exec(stem);
    let next = 0;
    points = bare.map((match) => {
      const isDivider = pairCount === 3 && lead !== null && match.index === lead.index + lead[0].length - 1;
      return { name: isDivider ? "P" : ["A", "B", "C"][next++]!, named: false, x: decimal(match[1]!), y: decimal(match[2]!), at: match.index! };
    });
  }
  if (pairCount !== points.length || points.some((point) => point.named) && [...stem.matchAll(/(?<![A-Za-z0-9])[A-Z](?:_?\d)?'?\s*(?:=\s*)?\(/g)].length !== points.length) {
    return { status: "declined", reason: "every point needs plain decimal coordinates" };
  }
  const names = new Set(points.map((point) => point.name));
  if (names.size !== points.length) return { status: "declined", reason: "a point name is stated twice" };
  // Ratios are read only where the stem states one; a coordinate pair is not a ratio.
  const ratios = [...stem.matchAll(RATIO)];
  if (ratios.length > 1) return { status: "declined", reason: "more than one ratio is stated" };
  const fraction = ratios.length === 0 ? FRACTION_RATIO.exec(stem) : null;
  const stated = ratios[0] ? { m: part(ratios[0][1]!), n: part(ratios[0][2]!) } : fraction ? { m: decimal(fraction[1]!), n: decimal(fraction[2]!) } : null;
  if (stated && (stated.m.n < 0n || stated.n.n < 0n)) return { status: "declined", reason: "signed ratios are outside this reading" };
  if (stated && (isZero(stated.m) !== isZero(stated.n))) return { status: "declined", reason: "a zero part names an endpoint, not a proper division" };
  const external = /\bexternal(?:ly)?\b/i.test(stem);
  if (/\bexternal(?:ly)?\b/i.test(stem) && /\binternal(?:ly)?\b/i.test(stem)) return { status: "declined", reason: "both internal and external are stated" };
  // Which named point divides: the one written after "point" or "does", or
  // a third point beside the two the stem joins.
  let divider: (typeof points)[number] | undefined;
  if (points.length === 3) {
    const lead = /\b(?:point|does)\s+([A-Z](?:_?\d)?'?)\s*(?:=\s*)?\(/.exec(stem)?.[1];
    divider = points.find((point) => point.name === lead) ?? points.find((point) => !point.named && point.name === "P");
    if (!divider) return { status: "declined", reason: "three points but no stated dividing point" };
  } else if (points.length !== 2) {
    return { status: "declined", reason: "a section needs exactly two named endpoints" };
  }
  const [a, b] = points.filter((point) => point !== divider) as [(typeof points)[number], (typeof points)[number]];
  if (same(a.x, b.x) && same(a.y, b.y)) return { status: "declined", reason: "coincident endpoints cannot certify a ratio" };
  const resultNames = requestedPointNames(question);
  const statedDivider = divider?.named ? [...question.matchAll(NAMED_POINT)].find((match) => match[1] === divider.name) : undefined;
  if (statedDivider) resultNames.push({ name: statedDivider[1]!, start: statedDivider.index!, end: statedDivider.index! + statedDivider[0].length, quote: statedDivider[0] });
  if (new Set(resultNames.map((evidence) => evidence.name)).size > 1) return { status: "declined", reason: POINT_IDENTITY_FAILURES.conflicting };
  const pointNameEvidence = resultNames[0];
  if (pointNameEvidence && [a.name, b.name].includes(pointNameEvidence.name)) return { status: "declined", reason: POINT_IDENTITY_FAILURES.endpoint };
  // A free point identifier is not evidence of its role. If its role was not
  // read above, decline rather than treating an explicitly named request as anonymous.
  const unboundName = [...question.matchAll(/(?<![A-Za-z0-9_])([A-Z](?:_?\d)?'?)(?![A-Za-z0-9_'])/g)]
    .find((match) => ![a.name, b.name, pointNameEvidence?.name].includes(match[1]!));
  if (unboundName) return { status: "declined", reason: POINT_IDENTITY_FAILURES.unbound };
  const mode: SectionFormulaSource["mode"] = midpoint && !stated && !asksRatio ? "midpoint" : external ? "external" : "internal";

  let m: Rational;
  let n: Rational;
  let point: ExactPoint;
  if (asksRatio && !stated) {
    if (!divider) return { status: "declined", reason: "a ratio question needs a stated dividing point" };
    // P = A + t (B - A), checked on both coordinates exactly.
    const dx = sub(b.x, a.x);
    const dy = sub(b.y, a.y);
    const t = isZero(dx) ? div(sub(divider.y, a.y), dy) : div(sub(divider.x, a.x), dx);
    const onLine = same(add(a.x, mul(t, dx)), divider.x) && same(add(a.y, mul(t, dy)), divider.y);
    if (!onLine) return { status: "inconsistent", reason: `${divider.name} is not on the line ${a.name}${b.name}` };
    const rest = sub({ n: 1n, d: 1n }, t);
    if (isZero(rest)) return { status: "singular", reason: `${divider.name} is ${b.name}; the ratio is undefined` };
    const signed = div(t, rest);
    if (signed.n < 0n && external === false && /\binternal(?:ly)?\b/i.test(stem)) return { status: "inconsistent", reason: `${divider.name} lies outside ${a.name}${b.name}, so it cannot divide internally` };
    const unsigned = signed.n < 0n ? { n: -signed.n, d: signed.d } : signed;
    [m, n] = lowestTerms(unsigned).map((value) => rational(BigInt(value))) as [Rational, Rational];
    point = { x: divider.x, y: divider.y };
    return {
      status: "ok",
      source: {
        mode: signed.n < 0n ? "external" : "internal", asks: "ratio",
        a: { name: a.name, named: a.named, x: num(a.x), y: num(a.y) }, b: { name: b.name, named: b.named, x: num(b.x), y: num(b.y) },
        m: num(m), n: num(n),
        point: { name: divider.name, x: num(point.x), y: num(point.y), exact: { x: text(point.x), y: text(point.y) } },
        ...(pointNameEvidence ? { pointNameEvidence } : {}),
        ratio: num(unsigned),
      },
    };
  }
  if (mode === "midpoint") {
    m = { n: 1n, d: 1n }; n = { n: 1n, d: 1n };
  } else {
    if (!stated) return { status: "declined", reason: "no ratio is stated" };
    ({ m, n } = stated);
    if (isZero(m) && isZero(n)) return { status: "singular", reason: "0:0 defines no point" };
  }
  const denominator = mode === "external" ? sub(m, n) : add(m, n);
  if (isZero(denominator)) return { status: "singular", reason: `${mode} division in the ratio ${text(m)}:${text(n)} has no finite point` };
  const sign = mode === "external" ? -1n : 1n;
  const weightA = div({ n: sign * n.n, d: n.d }, denominator);
  const weightB = div(m, denominator);
  point = { x: add(mul(weightA, a.x), mul(weightB, b.x)), y: add(mul(weightA, a.y), mul(weightB, b.y)) };
  if (divider && !(same(divider.x, point.x) && same(divider.y, point.y))) {
    return { status: "inconsistent", reason: `${divider.name}(${text(divider.x)}, ${text(divider.y)}) is not the point dividing ${a.name}${b.name} ${mode === "external" ? "externally" : "internally"} in ${text(m)}:${text(n)}` };
  }
  return {
    status: "ok",
    source: {
      mode, asks: "point",
      a: { name: a.name, named: a.named, x: num(a.x), y: num(a.y) }, b: { name: b.name, named: b.named, x: num(b.x), y: num(b.y) },
      m: num(m), n: num(n),
      point: {
        name: pointNameEvidence?.name ?? divider?.name ?? (mode === "midpoint" ? ["M", "P", "R"] : ["P", "R", "S"]).find((candidate) => candidate !== a.name && candidate !== b.name)!,
        x: num(point.x), y: num(point.y), exact: { x: text(point.x), y: text(point.y) },
      },
      ...(pointNameEvidence ? { pointNameEvidence } : {}),
      ratio: isZero(n) ? Infinity : num(div(m, n)),
    },
  };
}

/** Axes around the drawn points and the origin, so the coordinates read as coordinates. */
function frame(points: ReadonlyArray<{ x: number; y: number }>): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xs = [0, ...points.map((point) => point.x)];
  const ys = [0, ...points.map((point) => point.y)];
  const span = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const margin = Math.max(1, span * 0.15);
  return { xMin: Math.min(...xs) - margin, xMax: Math.max(...xs) + margin, yMin: Math.min(...ys) - margin, yMax: Math.max(...ys) + margin };
}

function coordinate(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * The section figure for a readable stem: both source endpoints at their
 * coordinates, the joining segment, the section point computed by the
 * engine's section_point operator, and for an external point the extension
 * from the nearer endpoint. A ratio question draws its stated point as a
 * section_point with the solved weights, so the operator certifies it.
 */
export function sectionFormulaScene(question: string, problemIR?: ProblemIR | null): SceneDocument | null {
  const reading = readSectionFormulaSource(question);
  if (reading.status !== "ok") return null;
  const { source } = reading;
  const label = (point: SectionFormulaSource["a"]): string => `${point.named ? point.name : ""}(${coordinate(point.x)},${coordinate(point.y)})`;
  const aLabel = label(source.a);
  const bLabel = label(source.b);
  // The section point carries its coordinates as a derived label the
  // compiler checks against the operator's point.
  // A repeating decimal (7/3) cannot be written exactly, so that point keeps
  // its name alone.
  const exactDecimal = (value: number): boolean => Number.isInteger(Math.round(value * 1e4)) && Math.abs(value * 1e4 - Math.round(value * 1e4)) < 1e-9;
  const pLabel = exactDecimal(source.point.x) && exactDecimal(source.point.y)
    ? `${source.point.name}=(${coordinate(source.point.x)},${coordinate(source.point.y)})`
    : source.point.name;
  if ([aLabel, bLabel, pLabel].some((value) => value.length > 16)) return null;
  const pId = source.point.name === source.a.name || source.point.name === source.b.name ? "P_section" : `pt_${source.point.name}`;
  const parameter = source.mode === "external" ? source.m / (source.m - source.n) : source.mode === "midpoint" ? 0.5 : source.m / (source.m + source.n);
  const document: SceneDocument = {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "Source endpoints, their join, and the section point at its exact coordinates." },
    source: { question, sectionFormula: "stated-endpoints/v1", mode: source.mode, asks: source.asks },
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      { id: `pt_${source.a.name}`, kind: "point", role: "source endpoint", label: aLabel },
      { id: `pt_${source.b.name}`, kind: "point", role: "source endpoint", label: bLabel },
      { id: "seg_join", kind: "segment", role: "source segment" },
      { id: pId, kind: "point", role: source.asks === "ratio" ? "stated dividing point" : "section point", label: pLabel },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: frame([source.a, source.b, source.point]), outputs: ["axes"] },
      { id: "place_a", operator: "point", inputs: { x: source.a.x, y: source.a.y, coordinateSpace: "world" }, outputs: [`pt_${source.a.name}`] },
      { id: "place_b", operator: "point", inputs: { x: source.b.x, y: source.b.y, coordinateSpace: "world" }, outputs: [`pt_${source.b.name}`] },
      { id: "join", operator: "segment", inputs: { start: `pt_${source.a.name}`, end: `pt_${source.b.name}` }, outputs: ["seg_join"] },
      {
        id: "divide", operator: "section_point",
        inputs: { a: `pt_${source.a.name}`, b: `pt_${source.b.name}`, mode: source.mode, ...(source.mode === "midpoint" ? {} : { m: source.m, n: source.n }) },
        outputs: [pId],
      },
    ],
    relations: [],
    assertions: [
      { id: "collinear", predicate: "collinear", entities: [`pt_${source.a.name}`, `pt_${source.b.name}`, pId], severity: "fatal" },
      ...(source.m > 0 && source.n > 0 ? [{ id: "section_ratio", predicate: "distance_ratio", entities: [`pt_${source.a.name}`, pId, pId, `pt_${source.b.name}`], expected: source.m / source.n, severity: "fatal" as const }] : []),
    ],
    annotations: [],
    requiredEntityIds: [`pt_${source.a.name}`, `pt_${source.b.name}`, "seg_join", pId],
    revealGroups: [
      { id: "endpoints", entityIds: ["axes", `pt_${source.a.name}`, `pt_${source.b.name}`, "seg_join"], dependsOn: [], narrationCue: "Plot the two stated endpoints and join them." },
      { id: "section", entityIds: [pId], dependsOn: ["endpoints"], narrationCue: source.asks === "ratio" ? "Mark the stated point on the line." : "Mark the point the ratio gives." },
    ],
    teachingTimeline: [
      { id: "show_endpoints", action: "reveal", targetId: "endpoints", dependsOn: [], narrationIntent: "Plot the endpoints and the segment." },
      { id: "show_section", action: "reveal", targetId: "section", dependsOn: ["show_endpoints"], narrationIntent: "Show the dividing point." },
    ],
  };
  if (parameter < 0 || parameter > 1) {
    document.entities.push({ id: "seg_extension", kind: "segment", role: "extension of the source line to the external point" });
    document.constructions.push({ id: "extend", operator: "segment", inputs: { start: parameter < 0 ? `pt_${source.a.name}` : `pt_${source.b.name}`, end: pId }, outputs: ["seg_extension"] });
    document.requiredEntityIds.push("seg_extension");
    document.revealGroups[1]!.entityIds.push("seg_extension");
  }
  if (problemIR && !bindSectionProblem(document, source, problemIR)) return null;
  return document;
}

/** Scalar roles come from the named source point, never from value membership. */
function sectionDimension(source: SectionFormulaSource, id: string, question: string): { symbol: string; value: number } | null {
  const statedPoint = [...question.matchAll(NAMED_POINT)].some((match) => match[1] === source.point.name);
  const points = [source.a, source.b, ...(statedPoint ? [source.point] : [])];
  for (const point of points) {
    for (const axis of ["x", "y"] as const) {
      if ([`${point.name}${axis}`, `${point.name}_${axis}`, `${axis}${point.name}`, `${axis}_${point.name}`].includes(id)) {
        return { symbol: `${point.name}_${axis}`, value: point[axis] };
      }
    }
  }
  if (source.asks === "point" && source.mode !== "midpoint" && (id === "m" || id === "n")) {
    return { symbol: id, value: source[id] };
  }
  return null;
}

function dimensionEvidence(source: SectionFormulaSource, symbol: string, quote: string): boolean {
  if (symbol === "m" || symbol === "n") {
    const ratios = [...quote.matchAll(RATIO)];
    const fraction = ratios.length === 0 ? FRACTION_RATIO.exec(quote) : null;
    const stated = ratios.length === 1 ? [part(ratios[0]![1]!), part(ratios[0]![2]!)]
      : fraction ? [decimal(fraction[1]!), decimal(fraction[2]!)] : null;
    return Boolean(stated && num(stated[0]!) === source.m && num(stated[1]!) === source.n);
  }
  return [...quote.matchAll(NAMED_POINT)].some((match) => {
    const point = [source.a, source.b, source.point].find((candidate) => candidate.name === match[1]);
    return point && (symbol === `${point.name}_x` || symbol === `${point.name}_y`)
      && num(decimal(match[2]!)) === point.x && num(decimal(match[3]!)) === point.y;
  });
}

/**
 * Bind a validated full ProblemIR to the source program. Entity identity stays
 * the plain source name; the compiler presents the coordinate tuple through a
 * label annotation anchored on that same point. Only an anonymously requested
 * result may take its name from the section intent's single requested point.
 * No facts, intents, or additional obligations are discarded.
 */
function bindSectionProblem(document: SceneDocument, source: SectionFormulaSource, raw: ProblemIR): boolean {
  const validation = validateProblemIR(raw, String(document.source.question));
  if (!validation.valid || !validation.problem) return false;
  const problem = validation.problem;
  const facts = new Map(problem.facts.map((fact) => [fact.id, fact]));
  const endpoints = [source.a, source.b].map((point) => problem.entities.find((entity) =>
    entity.kind === "point" && entity.label === point.name));
  if (!source.a.named || !source.b.named || endpoints.some((entity) => !entity)) return false;
  const endpointIds = endpoints.map((entity) => entity!.id);
  const intent = problem.representationIntents.find((candidate) => ["section", "graph", "conceptual"].includes(candidate.kind)
    && candidate.entityIds.length === 3 && endpointIds.every((id) => candidate.entityIds.includes(id)));
  if (!intent) return false;
  const result = problem.entities.find((entity) => intent.entityIds.includes(entity.id) && !endpointIds.includes(entity.id));
  if (!result || result.kind !== "point" || !result.label || !/^[A-Z](?:_?\d)?'?$/.test(result.label)
    || !result.evidenceFactIds.some((id) => facts.get(id)?.kind === "requested")
    || [source.a.name, source.b.name].includes(result.label)) return false;
  const question = String(document.source.question);
  if (source.pointNameEvidence && result.label !== source.pointNameEvidence.name) return false;

  const section = document.constructions.find((construction) => construction.operator === "section_point")!;
  const resultId = section.outputs[0]!;
  for (const [id, name] of [[`pt_${source.a.name}`, source.a.name], [`pt_${source.b.name}`, source.b.name], [resultId, result.label]]) {
    const entity = document.entities.find((candidate) => candidate.id === id)!;
    const text = entity.label!;
    entity.label = name;
    document.annotations.push({ id: `coordinates_${id}`, kind: "label", targetIds: [id], text: id === resultId ? text.replace(source.point.name, name!) : text });
  }
  for (const expression of problem.expressions) {
    if (expression.valueType !== "scalar" || !expression.evidenceFactIds.some((id) => facts.get(id)?.kind === "given")) continue;
    // This bounded source contract admits literal coordinate roles only.
    // An opaque id or compound given is a declared gap, never an ignored fact.
    const dimension = sectionDimension(source, expression.id, question);
    if (!dimension || expression.root.kind !== "number" || expression.root.value !== dimension.value
      || !expression.evidenceFactIds.some((id) => facts.get(id)?.kind === "given"
        && dimensionEvidence(source, dimension.symbol, facts.get(id)!.evidence.quote))) return false;
    document.quantities.push({
      id: expression.id, symbol: dimension.symbol, value: dimension.value, provenance: "given",
      evidenceFactIds: [...expression.evidenceFactIds],
      sourceText: expression.evidenceFactIds.map((id) => facts.get(id)!.evidence.quote).join("\n"),
    });
  }
  return true;
}

/**
 * For a readable source section, a dimension must carry its own coordinate
 * role and fact lineage. Equal-valued coordinates cannot cover each other.
 * Null leaves other scene programs under the existing obligation contract.
 */
export function sectionFormulaDimensionIsCarried(
  document: SceneDocument, expressionId: string, value: number, factIds: readonly string[],
): boolean | null {
  if (!document.constructions.some((construction) => construction.operator === "section_point")
    || typeof document.source.question !== "string") return null;
  const reading = readSectionFormulaSource(document.source.question);
  if (reading.status !== "ok") return null;
  const dimension = sectionDimension(reading.source, expressionId, document.source.question);
  if (!dimension || dimension.value !== value) return false;
  return document.quantities.some((quantity) => {
    const role = sectionDimension(reading.source, typeof quantity.symbol === "string" ? quantity.symbol : quantity.id, document.source.question as string);
    return quantity.id === expressionId && role?.symbol === dimension.symbol && quantity.value === dimension.value
      && (quantity.unit === undefined || quantity.unit === "")
      && Array.isArray(quantity.evidenceFactIds) && quantity.evidenceFactIds.length === factIds.length
      && factIds.every((id) => (quantity.evidenceFactIds as unknown[]).includes(id));
  });
}

/**
 * Source check for any section_point a scene carries (a planner-made scene
 * included): its endpoints must be the stem's named endpoints at their stated
 * coordinates and its mode and weights the stem's division. A section_point
 * with no readable section source is unsupported.
 */
export function validateSectionPointSourceInputs(document: SceneDocument, question: unknown): SceneIssue[] {
  const sections = document.constructions.flatMap((construction, index) => construction.operator === "section_point" ? [{ construction, index }] : []);
  if (sections.length === 0 || document.visualDecision.mode !== "scene") return [];
  if (typeof question !== "string" || !question.trim()) {
    return [{ code: "section_source_unsupported", severity: "fatal", path: "source.question", message: "section_point requires the source question" }];
  }
  const reading = readSectionFormulaSource(question);
  if (reading.status === "declined" && Object.values(POINT_IDENTITY_FAILURES).includes(reading.reason)) {
    return [{ code: "section_source_unsupported", severity: "fatal", path: "source.question", message: `the stem's dividing-point identity is unsupported (${reading.reason})` }];
  }
  if (reading.status === "inconsistent" || reading.status === "singular") {
    return [{ code: "section_source_unsupported", severity: "fatal", path: "source.question", message: `the stem's section has no consistent finite point (${reading.reason})` }];
  }
  const pointAt = (input: unknown): { x: number; y: number } | null => {
    if (Array.isArray(input) && input.length === 2 && input.every((value) => typeof value === "number")) return { x: input[0], y: input[1] };
    if (typeof input !== "string") return null;
    const producers = document.constructions.filter((construction) => construction.outputs.includes(input));
    if (producers.length !== 1 || producers[0]!.operator !== "point") return null;
    const inputs = producers[0]!.inputs as Record<string, unknown>;
    if (inputs.coordinateSpace !== undefined && inputs.coordinateSpace !== "world") return null;
    return typeof inputs.x === "number" && typeof inputs.y === "number" ? { x: inputs.x, y: inputs.y } : null;
  };
  if (reading.status !== "ok") {
    // Not a section stem read whole (a median, a centroid, a figure built
    // from several points): any endpoint placed at plain coordinates must be
    // a point the stem names at those coordinates.
    const stated = [...question.replace(/\s+/g, " ").matchAll(NAMED_POINT)].map((match) => ({ x: num(decimal(match[2]!)), y: num(decimal(match[3]!)) }));
    if (stated.length === 0) return [];
    return sections.flatMap(({ construction, index }) => {
      const inputs = construction.inputs as Record<string, unknown>;
      const placed = [inputs.a, inputs.b].map(pointAt).filter((point): point is { x: number; y: number } => point !== null);
      return placed.every((point) => stated.some((candidate) => candidate.x === point.x && candidate.y === point.y)) ? [] : [{
        code: "section_source_mismatch", severity: "fatal" as const, path: `constructions[${index}].inputs`,
        message: "section_point endpoints placed at coordinates must be points the stem states",
      }];
    });
  }
  const { source } = reading;
  const issues: SceneIssue[] = [];
  const constructedLabelTexts = (id: string): Array<string | undefined> => {
    const targets = derivedLabelTargets(document, id);
    return [
      ...document.constructions.filter((construction) => construction.operator === "label" && targets.has(String(construction.inputs.target ?? construction.inputs.at ?? construction.inputs.point)))
        .map((construction) => typeof construction.inputs.text === "string" ? construction.inputs.text : undefined),
      ...document.entities.filter((entity) => entity.id !== id && targets.has(entity.id)).map((entity) => entity.label),
      ...document.annotations.filter((annotation) => annotation.targetIds.some((target) => target !== id && targets.has(target))).map((annotation) => annotation.text),
    ];
  };
  const coordinateLabelAgrees = (value: string, point: { name?: string; x: number; y: number }): boolean => {
    const label = value.trim();
    // Plain A(1,2) remains the legacy endpoint spelling; source syntax is unchanged.
    const legacy = [...label.matchAll(NAMED_POINT)];
    if (legacy.length === 1 && legacy[0]!.index === 0 && legacy[0]![0].length === label.length) {
      return (!point.name || legacy[0]![1] === point.name)
        && num(decimal(legacy[0]![2]!)) === point.x && num(decimal(legacy[0]![3]!)) === point.y;
    }
    try {
      const claim = readDerivedCoordinateLabelClaim(label);
      return Boolean(claim && (!point.name || claim.name === point.name) && claim.unit === ""
        && claim.values[0] === point.x && claim.values[1] === point.y);
    } catch {
      return false;
    }
  };
  const endpointLabelAgrees = (id: unknown, endpoint: SectionFormulaSource["a"]): boolean => {
    if (typeof id !== "string") return true;
    const entity = document.entities.find((candidate) => candidate.id === id);
    const texts = [entity?.label, ...document.annotations.filter((annotation) => annotation.targetIds.includes(id)).map((annotation) => annotation.text), ...constructedLabelTexts(id)];
    return texts.every((value) => {
      if (!value) return true;
      if (endpoint.named && /^[A-Z](?:_?\d)?'?$/.test(value) && value !== endpoint.name) return false;
      return !ANNOTATION_PAIR.test(value) || coordinateLabelAgrees(value, { ...endpoint, name: endpoint.named ? endpoint.name : undefined });
    });
  };
  const resultLabelAgrees = (id: string): boolean => {
    const name = source.pointNameEvidence?.name;
    if (!name) return true;
    const identityAgrees = (value: string | undefined): boolean => {
      if (!value) return false;
      const label = value.trim();
      if (label === name) return true;
      return coordinateLabelAgrees(label, { name, x: source.point.x, y: source.point.y });
    };
    const entity = document.entities.find((candidate) => candidate.id === id);
    if (!identityAgrees(entity?.label)) return false;
    if (!constructedLabelTexts(id).every((value) => {
      const label = value?.trim();
      return !label || !POINT_NAME.test(label) && !ANNOTATION_PAIR.test(label) || identityAgrees(label);
    })) return false;
    return document.annotations.filter((annotation) => annotation.targetIds.includes(id)).every((annotation) => {
      const label = annotation.text?.trim();
      if (annotation.kind === "label" || label && POINT_NAME.test(label)) return identityAgrees(label);
      return !ANNOTATION_PAIR.test(label ?? "") || identityAgrees(label);
    });
  };
  document.quantities.forEach((quantity, index) => {
    const dimension = sectionDimension(source, quantity.id, question);
    const role = sectionDimension(source, typeof quantity.symbol === "string" ? quantity.symbol : quantity.id, question);
    if (dimension && (quantity.value !== dimension.value || role?.symbol !== dimension.symbol
      || (quantity.unit !== undefined && quantity.unit !== ""))) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `quantities[${index}]`, message: "section source scalars must retain their stated coordinate or ratio role, value and unit" });
    }
  });
  for (const { construction, index } of sections) {
    try {
    const inputs = construction.inputs as Record<string, unknown>;
    const a = pointAt(inputs.a);
    const b = pointAt(inputs.b);
    const matches = (p: { x: number; y: number } | null, q: { x: number; y: number }): boolean => Boolean(p && p.x === q.x && p.y === q.y);
    const forward = matches(a, source.a) && matches(b, source.b);
    const reversed = matches(a, source.b) && matches(b, source.a);
    const m = Number(inputs.m ?? 1);
    const n = Number(inputs.n ?? 1);
    // A reversed segment with swapped weights is the same division.
    const weights = source.mode === "midpoint"
      ? inputs.mode === "midpoint" || (inputs.mode === "internal" && m === n && m > 0)
      : inputs.mode === source.mode && (forward ? m * source.n === n * source.m : n * source.n === m * source.m) && m * source.m >= 0 && n * source.n >= 0;
    if (!(forward || reversed)) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `constructions[${index}].inputs`, message: "section_point endpoints must be the stem's named endpoints at their stated coordinates" });
    } else if (!endpointLabelAgrees(inputs.a, forward ? source.a : source.b)
      || !endpointLabelAgrees(inputs.b, forward ? source.b : source.a)) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `constructions[${index}].inputs`, message: "section endpoint names and coordinate annotations must agree with their source point" });
    } else if (!weights) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `constructions[${index}].inputs`, message: "section_point mode and weights must be the stem's division" });
    }
    if (!construction.outputs.every(resultLabelAgrees)) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `constructions[${index}].outputs`, message: "section result names and coordinate annotations must agree with the explicitly named source point" });
    }
    // Replay reads stored documents without trusting a previous compile. Bind
    // every result label/quantity channel to freshly read source coordinates.
    validateEvaluatedDerivedValueLabels(construction, index, document, construction.outputs.map(() => ({
      kind: "point", point: source.point,
      analyticLine: { section: { m, n, parameter: source.mode === "midpoint" ? 0.5 : source.m / (source.mode === "external" ? source.m - source.n : source.m + source.n) } },
    })), issues);
    } catch (error) {
      issues.push({ code: "section_source_unsupported", severity: "fatal", path: `constructions[${index}].outputs`, message: error instanceof Error ? error.message : "Section label provenance is unsupported" });
    }
  }
  return issues;
}

type Role = "x" | "y" | "ratio";

function roleOf(symbol: string): Role | null {
  const key = symbol.normalize("NFKC").replace(/\\(?:mathrm|text|operatorname)\s*/g, "").replace(/[{}\\\s]/g, "");
  if (/^(?:x|x_?[A-Z]|[A-Z]_?x|x_?(?:P|M|section|point))$/i.test(key) && !/^x_?[12]$/i.test(key)) return "x";
  if (/^(?:y|y_?[A-Z]|[A-Z]_?y|y_?(?:P|M|section|point))$/i.test(key) && !/^y_?[12]$/i.test(key)) return "y";
  if (/^(?:k|λ|lambda|r|ratio|m\/n|m:n|AP\/PB|AP:PB)$/i.test(key)) return "ratio";
  return null;
}

/**
 * Hold the turn plan to the stem's section. Coordinates of the section point
 * and the ratio a ratio question asks for are corrected to the exact values;
 * givens must be numbers the stem states; any other number that is not a
 * stated or solved value is withdrawn. The solved coordinates (and ratio) are
 * added when missing. An inconsistent or singular stem withdraws every derived
 * number, because no finite answer agrees with the stem.
 */
export function applySectionFormulaAuthority(question: string, plan: TurnPlanV3): {
  plan: TurnPlanV3;
  reading: SectionFormulaReading;
  issues: Array<{ code: string; quantityId: string; message: string }>;
} | null {
  const reading = readSectionFormulaSource(question);
  if (reading.status === "none" || reading.status === "declined") return null;
  const issues: Array<{ code: string; quantityId: string; message: string }> = [];
  if (reading.status !== "ok") {
    for (const quantity of plan.derived) issues.push({ code: "section_value_withdrawn", quantityId: quantity.id, message: `${reading.status}: ${reading.reason}` });
    return { plan: { ...plan, derived: [], unknowns: [] }, reading, issues };
  }
  const { source } = reading;
  const statedNumbers = [...question.replace(/−/g, "-").matchAll(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g)].map((match) => Number(match[0]));
  const solved: Record<Role, number> = { x: source.point.x, y: source.point.y, ratio: source.ratio };
  const known = [...statedNumbers, source.point.x, source.point.y, source.ratio, source.m, source.n];
  const agrees = (expected: number, value: number): boolean => {
    if (Math.abs(expected - value) <= 1e-9 * Math.max(1, Math.abs(expected))) return true;
    const decimals = (String(value).split(".")[1] ?? "").length;
    const significant = String(Math.abs(value)).replace(".", "").replace(/^0+/, "").length;
    return significant >= 2 && Number(expected.toFixed(decimals)) === value;
  };
  const givens = plan.givens.filter((quantity) => {
    if (statedNumbers.some((value) => agrees(value, quantity.value))) return true;
    issues.push({ code: "section_given_conflict", quantityId: quantity.id, message: `given ${quantity.symbol}=${quantity.value} is not a number the stem states` });
    return false;
  });
  const derived: TurnPlanQuantityV3[] = [];
  for (const quantity of plan.derived) {
    const role = roleOf(quantity.symbol);
    if (role && Number.isFinite(solved[role])) {
      if (agrees(solved[role], quantity.value)) derived.push(quantity);
      else {
        const value = Number(solved[role].toPrecision(10));
        issues.push({ code: "section_value_corrected", quantityId: quantity.id, message: `${quantity.symbol}: ${quantity.value} -> ${value}` });
        derived.push({ ...quantity, value, sourceText: `Section-verified ${quantity.symbol} = ${value}` });
      }
    } else if (known.some((value) => agrees(value, quantity.value))) {
      derived.push(quantity);
    } else {
      issues.push({ code: "section_value_withdrawn", quantityId: quantity.id, message: `${quantity.symbol}=${quantity.value} is neither stated nor solved` });
    }
  }
  const present = (value: number): boolean => [...givens, ...derived].some((quantity) => agrees(value, quantity.value) && roleOf(quantity.symbol) !== null);
  const name = source.point.name;
  const additions: Array<[string, string, number]> = source.asks === "ratio"
    ? [["section_ratio", "k", source.ratio]]
    : [["section_x", `x_${name}`, source.point.x], ["section_y", `y_${name}`, source.point.y]];
  for (const [id, symbol, value] of additions) {
    if (present(value) && derived.some((quantity) => roleOf(quantity.symbol) === roleOf(symbol))) continue;
    const rounded = Number(value.toPrecision(10));
    derived.push({ id, symbol, value: rounded, provenance: "derived", sourceText: `Section-verified ${symbol} = ${rounded}` });
    issues.push({ code: "section_value_added", quantityId: id, message: `${symbol} = ${rounded}` });
  }
  const kept = new Set([...givens, ...derived].map((quantity) => quantity.id));
  const unknowns = plan.unknowns.filter((unknown) => kept.has(unknown.id));
  return { plan: { ...plan, givens, derived, unknowns }, reading, issues };
}
