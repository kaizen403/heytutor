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
import { validateTurnPlanV3, type TurnPlanQuantityV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { derivedLabelTargets, readDerivedCoordinateLabelClaim, validateEvaluatedDerivedValueLabels } from "../compile/derivedValueLabels";
import { validateProblemIR, type ExpressionNodeIR, type ProblemIR, type ProblemFact } from "./problemIR";
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneIssue } from "../types";
import {pruneDeadSceneEntities,validateSceneDocument} from "../document/validation";
import {sameSceneValue} from "../document/valueEquality";

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
  if ([...stem.matchAll(/\b(?:external|internal)(?:ly)?\b/gi)].length > 1) return { status: "declined", reason: "more than one division mode is stated" };
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
  // Consume one complete supported request and its endpoint relationship.
  // A vocabulary match cannot account for another ask made of the same words.
  let clause = stem.replace(NAMED_POINT, (_match, name: string) =>
    name === a.name ? "ENDPOINT_A" : name === b.name ? "ENDPOINT_B" : "DIVIDER");
  if (!a.named && !b.named) {
    let index = 0;
    clause = clause.replace(BARE_PAIR, () => {
      const point = points[index++]!;
      return point === divider ? "DIVIDER" : point === a ? "ENDPOINT_A" : "ENDPOINT_B";
    });
  }
  clause = clause.replace(RATIO, "WEIGHTS").replace(FRACTION_RATIO, "ratio WEIGHTS");
  if (pointNameEvidence) clause = clause.replace(new RegExp(`(?<![A-Za-z0-9_])${pointNameEvidence.name}(?![A-Za-z0-9_'])`, "g"), "RESULT");
  clause = clause.trim().replace(/[.!?]$/, "").replace(/\s+/g, " ").toLowerCase();
  const join = "(?:(?:the )?(?:line )?segment joining endpoint_a and endpoint_b|(?:the )?(?:line )?segment from endpoint_a to endpoint_b|(?:the )?line joining endpoint_a and endpoint_b|(?:the )?join of endpoint_a and endpoint_b|endpoint_a and endpoint_b)";
  const command = "(?:find|calculate|determine) (?:the )?";
  const pointAsk = "(?:coordinates? of (?:the )?(?:point )?(?:result )?|point (?:result )?)";
  const division = `(?:(?:which|that) )?(?:internally |externally )?divid(?:es|ing) (?:internally |externally )?${join} (?:internally |externally )?in (?:the )?ratio weights(?: internally| externally)?`;
  const supported = [
    `${command}${pointAsk}${division}`,
    `${command}(?:mid-? ?point|middle point) (?:result )?of ${join}`,
    `in what ratio does (?:the point )?divider divide (?:internally |externally )?${join}`,
    // A stated divider followed by the same coordinate ask is one operation.
    `(?:the )?point divider divides ${join} (?:internally |externally )?in (?:the )?ratio weights[.] ${command}coordinates? of (?:the )?(?:point )?result`,
  ];
  if (!supported.some(pattern => new RegExp(`^${pattern}$`).test(clause))) {
    return { status: "declined", reason: "unconsumed section source clause or obligation" };
  }
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
    if (external && signed.n >= 0n) return { status: "inconsistent", reason: `${divider.name} lies inside ${a.name}${b.name}, so it cannot divide externally` };
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
  if (problemIR) {
    try { if (!bindSectionProblem(document, source, problemIR)) return null; }
    catch { return null; }
  }
  return document;
}

/** Scalar roles come from the named source point, never from value membership. */
function sectionDimension(source: SectionFormulaSource, id: string, question: string): { symbol: string; value: number } | null {
  // The captured IR prefixes expression roles with e (eAx, eM). This is a
  // spelling of the role, not a numeric-membership or arbitrary-id fallback.
  if (/^e(?:[A-Z](?:_?\d)?'?_?[xy]|[MN])$/.test(id)) id = id.slice(1);
  if (id === "M" || id === "N") id = id.toLowerCase();
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

/** Indexed endpoint spellings require the matching named-point source quote. */
function sectionGivenDimension(source:SectionFormulaSource,row:TurnPlanQuantityV3,question:string):{symbol:string;value:number}|null{
 const named=sectionDimension(source,row.symbol,question);if(named)return named;
 const indexed=/^([xy])_?([12])$/.exec(row.symbol);
 if(!indexed || typeof row.sourceText!=="string")return null;
 const point=indexed[2]==="1"?source.a:source.b,axis=indexed[1] as "x"|"y";
 if(!dimensionEvidence(source,`${point.name}_${axis}`,row.sourceText))return null;
 return {symbol:`${point.name}_${axis}`,value:point[axis]};
}
function sectionPointLabelMatches(label:string|undefined,point:SectionFormulaSource["a"]):boolean{
 if(label===point.name)return true;
 if(typeof label!=="string")return false;
 const matches=[...label.matchAll(NAMED_POINT)];
 return matches.length===1 && matches[0]![0]===label.trim() && matches[0]![1]===point.name && num(decimal(matches[0]![2]!))===point.x && num(decimal(matches[0]![3]!))===point.y;
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
/** Preserve operand order for subtraction/division. Signed numeric literals
 * have one canonical form; only addition/multiplication commute and associate. */
function sectionExpressionKey(root:ExpressionNodeIR):string {
 if(root.kind==="number") return `number:${Object.is(root.value,-0)?0:root.value}`;
 if(root.kind==="unary" && root.operand.kind==="number") return sectionExpressionKey({kind:"number",value:root.operator==="-"?-root.operand.value:root.operand.value});
 if(root.kind==="binary") {
  const flatten=(node:ExpressionNodeIR):ExpressionNodeIR[]=>["+","*"].includes(root.operator) && node.kind==="binary" && node.operator===root.operator?[...flatten(node.left),...flatten(node.right)]:[node];
  const parts=[...flatten(root.left),...flatten(root.right)].map(sectionExpressionKey);
  return `${root.operator}(${(["+","*"].includes(root.operator)?parts.sort():parts).join(",")})`;
 }
 if(root.kind==="unary") return `${root.operator}(${sectionExpressionKey(root.operand)})`;
 if(root.kind==="call") return `${root.function}(${sectionExpressionKey(root.argument)})`;
 return root.kind==="variable"?`variable:${root.name}`:`constant:${root.name}`;
}
function sectionRootBindsFormula(source:SectionFormulaSource,axis:"x"|"y",root:ExpressionNodeIR):boolean {
 const n=(value:number):ExpressionNodeIR=>({kind:"number",value});
 const b=(operator:"+"|"-"|"*"|"/",left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:"binary",operator,left,right});
 const a=n(source.a[axis]),end=n(source.b[axis]),m=n(source.m),weight=n(source.n),sign=source.mode==="external"?"-":"+";
 const denominator=b(sign,m,weight);
 const forms=[b("/",b(sign,b("*",m,end),b("*",weight,a)),denominator),b("+",a,b("*",b("/",m,denominator),b("-",end,a)))];
 if(source.mode==="midpoint") forms.push(b("/",b("+",a,end),n(2)),b("*",n(.5),b("+",a,end)));
 return forms.some(form=>sectionExpressionKey(form)===sectionExpressionKey(root));
}

/** A requested midpoint clause can source the line only when the complete
 * clause states the midpoint role, join and both exact named endpoints.
 * Endpoint tuples alone do not prove a request or joining relationship. */
function midpointJoinEvidence(source: SectionFormulaSource, quote: string): boolean {
  if (source.mode !== "midpoint") return false;
  const points = [...quote.matchAll(NAMED_POINT)];
  if (points.length !== 2 || !points.every((match, index) => {
    const point = [source.a, source.b][index]!;
    return match[1] === point.name && num(decimal(match[2]!)) === point.x
      && num(decimal(match[3]!)) === point.y;
  })) return false;
  const clause = quote.replace(NAMED_POINT, "ENDPOINT").trim().replace(/[.!?]$/, "").replace(/\s+/g, " ");
  return new RegExp(`^(?:(?:find|calculate|determine) (?:the )?)?midpoint ${source.point.name} of (?:the )?(?:line )?segment joining ENDPOINT and ENDPOINT$`, "i").test(clause);
}

function sectionJoinEvidence(source:SectionFormulaSource,quote:string):boolean {
 if(source.mode==="midpoint")return midpointJoinEvidence(source,quote);
 const points=[...quote.matchAll(NAMED_POINT)];
 if(points.length!==2 || !points.every((match,index)=>{
  const point=[source.a,source.b][index]!;
  return match[1]===point.name && num(decimal(match[2]!))===point.x && num(decimal(match[3]!))===point.y;
 }))return false;
 const clause=quote.replace(NAMED_POINT,"ENDPOINT").trim().replace(/[.!?]$/,"").replace(/\s+/g," ");
 const request=`(?:find|calculate|determine) (?:the )?(?:coordinates? of (?:the )?(?:point )?${source.point.name}|point ${source.point.name})`;
 const relation=`(?:which divides|dividing) (?:the )?(?:line )?segment joining ENDPOINT and ENDPOINT`;
 const matched=new RegExp(`^${request} ${relation}(?: (${source.mode}ly))?(?: in (?:the )?ratio (${PART})\\s*:\\s*(${PART}))?$`,"i").exec(clause);
 return !!matched && (!matched[2] || num(part(matched[2]))===source.m && num(part(matched[3]!))===source.n);
}

function sectionFactIsBound(source:SectionFormulaSource,question:string,fact:ProblemFact):boolean {
 if(fact.kind==="assumption") return false;
 const norm=(value:string)=>value.trim().replace(/[.!?]$/,"").replace(/\s+/g," ").toLowerCase();
 const statement=norm(fact.statement),quote=fact.evidence.quote;
 if(fact.kind==="requested") {
  // The full source was already consumed as one operation by the reader.
  if(statement===norm(question) && norm(quote)===norm(question)) return true;
  const name=source.point.name.toLowerCase(),join=`${source.a.name.toLowerCase()}${source.b.name.toLowerCase()}`;
  if(source.mode==="midpoint") {
   const request=new RegExp(`^(?:(find|calculate|determine) (?:the )?)?midpoint ${name} of (?:the )?(?:line )?segment ${join}$`).exec(statement);
   if(request) return midpointJoinEvidence(source,quote) || Boolean(request[1] && norm(quote)===`find the midpoint ${name} of the line segment joining`);
   return midpointJoinEvidence(source,fact.statement) && midpointJoinEvidence(source,quote);
  }
  if(source.asks!=="point") return false;
  // An anonymous coordinate ask can cite just its command word. The whole
  // source independently establishes the single dividing-point operation;
  // this spelling cannot assert a new name, mode, ratio or extra ask.
  const anonymous=/^(find|calculate|determine) (?:the )?coordinates? of (?:the )?dividing point$/.exec(statement);
  if(!source.pointNameEvidence && anonymous && norm(quote)===anonymous[1]
    && fact.evidence.start===0) return true;
  const request=new RegExp(`^(?:find|calculate|determine) (?:the )?(?:coordinates? of (?:the )?(?:point )?${name}|(?:dividing )?point ${name})(?: (?:which divides|dividing) (?:the )?(?:line )?segment(?: ${join})?(?: (internally|externally))?(?: in (?:the )?ratio (${PART})\\s*:\\s*(${PART}))?)?$`).exec(statement);
  if(!request || request[1] && request[1]!==`${source.mode}ly`
    || request[2] && (num(part(request[2]))!==source.m || num(part(request[3]!))!==source.n)) return false;
  if(request[1] && !new RegExp(`\\b${source.mode}ly\\b`,"i").test(quote)) return false;
  if(request[2] && !dimensionEvidence(source,"m",quote)) return false;
  // Retain captured request prefixes, but require their complete named role.
  const prefix=`(?:find|calculate|determine) (?:the )?(?:coordinates? of (?:the )?(?:point )?${name}|point ${name})`;
  if(new RegExp(`^${prefix}(?: (?:which divides|dividing) (?:the )?(?:line )?segment)?$`).test(norm(quote))) return true;
  const points=[...quote.matchAll(NAMED_POINT)];
  if(points.length!==2 || !points.every((match,index)=>{
   const point=[source.a,source.b][index]!;
   return match[1]===point.name && num(decimal(match[2]!))===point.x && num(decimal(match[3]!))===point.y;
  })) return false;
  const clause=norm(quote.replace(NAMED_POINT,"ENDPOINT"));
  return new RegExp(`^${prefix} (?:which divides|dividing) (?:the )?(?:line )?segment joining endpoint and endpoint(?: ${source.mode}ly)?(?: in (?:the )?ratio (${PART})\\s*:\\s*(${PART}))?$`).test(clause)
    && (!/\bratio\b/.test(clause) || dimensionEvidence(source,"m",quote));
 }
 if(statement===norm(quote) || statement===norm(question)) return true;
 for(const point of [source.a,source.b]){
  const name=point.name.toLowerCase();
  const pair=new RegExp(`^(?:point )?${name} (?:has|is at|is given with) (?:the )?coordinates?\\s*\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)$`).exec(statement);
  if(pair && num(decimal(pair[1]!))===point.x && num(decimal(pair[2]!))===point.y && dimensionEvidence(source,`${point.name}_x`,quote)) return true;
  const axis=new RegExp(`^(?:point )?${name} has ([xy])[- ]coordinate (${NUMBER})$`).exec(statement);
  if(axis && num(decimal(axis[2]!))===point[axis[1] as "x"|"y"] && dimensionEvidence(source,`${point.name}_${axis[1]}`,quote)) return true;
  const coordinateOf=new RegExp(`^([xy])[- ]coordinate of ${name} is (${NUMBER})$`).exec(statement);
  if(fact.kind==="given" && coordinateOf && num(decimal(coordinateOf[2]!))===point[coordinateOf[1] as "x"|"y"]
    && dimensionEvidence(source,`${point.name}_${coordinateOf[1]}`,quote)) return true;
 }
 const division=new RegExp(`^${source.point.name.toLowerCase()} divides (?:the )?(?:segment|line segment|join|${source.a.name.toLowerCase()}${source.b.name.toLowerCase()}) ${source.mode}ly in (?:the )?ratio (${PART})\\s*:\\s*(${PART})$`).exec(statement);
 if(source.mode!=="midpoint" && division && num(part(division[1]!))===source.m && num(part(division[2]!))===source.n && dimensionEvidence(source,"m",quote) && new RegExp(`\\b${source.mode}ly\\b`,"i").test(quote))return true;
 const ratio=new RegExp(`^(?:the )?(?:(?:external|internal) )?division ratio (?:is |equals )?(${PART})\\s*:\\s*(${PART})$`).exec(statement);
 if(ratio && num(part(ratio[1]!))===source.m && num(part(ratio[2]!))===source.n && dimensionEvidence(source,"m",quote)) return true;
 if(source.mode!=="midpoint" && new RegExp(`^(?:the point|${source.point.name.toLowerCase()}) divides (?:the join|${source.a.name.toLowerCase()}${source.b.name.toLowerCase()}) ${source.mode}ly(?: in (?:the )?ratio ${source.m}:${source.n})?$`).test(statement)) return new RegExp(`\\b${source.mode}(?:ly)?\\b`,"i").test(quote);
 return false;
}

function bindSectionProblem(document: SceneDocument, source: SectionFormulaSource, raw: ProblemIR): boolean {
  const validation = validateProblemIR(raw, String(document.source.question));
  if (!validation.valid || !validation.problem) return false;
  const problem = validation.problem;
  const facts = new Map(problem.facts.map((fact) => [fact.id, fact]));
  if(problem.facts.some(fact=>!sectionFactIsBound(source,String(document.source.question),fact))) return false;
  const endpoints = [source.a, source.b].map((point) => problem.entities.find((entity) =>
    entity.kind === "point" && sectionPointLabelMatches(entity.label,point)));
  if (!source.a.named || !source.b.named || endpoints.some((entity) => !entity)) return false;
  const endpointIds = endpoints.map((entity) => entity!.id);
  const intent = problem.representationIntents.find((candidate) => ["section", "graph", "conceptual"].includes(candidate.kind)
    && endpointIds.every((id) => candidate.entityIds.includes(id)));
  if (!intent) return false;
  const results = problem.entities.filter((entity) => intent.entityIds.includes(entity.id)
    && !endpointIds.includes(entity.id) && entity.kind === "point");
  if (results.length !== 1) return false;
  const result = results[0];
  if (!result || result.kind !== "point" || !result.label || !/^[A-Z](?:_?\d)?'?$/.test(result.label)
    || !result.evidenceFactIds.some((id) => facts.get(id)?.kind === "requested")
    || [source.a.name, source.b.name].includes(result.label)) return false;
  const question = String(document.source.question);
  if (source.pointNameEvidence && result.label !== source.pointNameEvidence.name) return false;

  const hasPointEvidence = (ids: string[], point: SectionFormulaSource["a"], wholeQuestionRequest=false): boolean => ids.some((id) =>
    (facts.get(id)?.kind === "given" || wholeQuestionRequest && facts.get(id)?.kind==="requested" && (sectionJoinEvidence(source,facts.get(id)!.evidence.quote) || facts.get(id)!.evidence.quote.trim()===question.trim())) && dimensionEvidence(source, `${point.name}_x`, facts.get(id)!.evidence.quote));
  if (!endpoints.every((entity, i) => hasPointEvidence(entity!.evidenceFactIds, [source.a, source.b][i]!))) return false;
  const lines = problem.entities.filter((entity) => entity.kind === "line");
  if (lines.length > 1 || lines.some((line) => ![`${source.a.name}${source.b.name}`,`segment ${source.a.name}${source.b.name}`,`line ${source.a.name}${source.b.name}`,`line segment ${source.a.name}${source.b.name}`,`line through ${source.a.name} and ${source.b.name}`,`line through ${source.b.name} and ${source.a.name}`].includes(line.label ?? "")
    || !hasPointEvidence(line.evidenceFactIds, source.a,true) || !hasPointEvidence(line.evidenceFactIds, source.b,true))) return false;
  const admittedIds = [...endpointIds, result.id, ...lines.map((line) => line.id)];
  if (problem.entities.some((entity) => !admittedIds.includes(entity.id))
    || problem.representationIntents.some((candidate) => !["section", "graph", "conceptual"].includes(candidate.kind)
      || candidate.entityIds.some((id) => !admittedIds.includes(id)))) return false;
  for(const constraint of problem.constraints){
    const ids="entityIds" in constraint?constraint.entityIds:[];
    const line=lines[0];
    const incident=constraint.kind==="incident" && line && ids.length>=2 && ids.length<=4 && new Set(ids).size===ids.length && ids.includes(line.id) && ids.filter(id=>id!==line.id).every(id=>[result.id,...endpointIds].includes(id));
    const joined=constraint.kind==="connected" && line && ids.length===3 && ids.includes(line.id) && endpointIds.every(id=>ids.includes(id));
    if((!incident && !joined) || !constraint.evidenceFactIds.length) return false;
  }
  // A line intent gets a real joining segment, not a text-only obligation
  // witness. Its lineage records the original entity and both source points.
  if (lines[0]) {
    const join = document.entities.find((entity) => entity.id === "seg_join")!;
    // ProblemIR's line is unbounded. An external section point is incident
    // on the line through A/B, not on the finite segment between them.
    join.kind="line";join.role="underlying line through source endpoints";
    document.constructions.find(row=>row.id==="join")!.operator="line";
    join.label = `${source.a.name}${source.b.name}`;
    join.provenance = { problemEntityId: lines[0].id, sourceLabel: lines[0].label, evidenceFactIds: [...lines[0].evidenceFactIds] };
    document.assertions.push({id:"section_on_source_line",predicate:"on",entities:[`pt_${source.point.name}`,"seg_join"],severity:"fatal"});
    for(const constraint of problem.constraints){
      if(constraint.kind!=="incident")continue;
      const pointIds=constraint.entityIds.filter(id=>id!==lines[0]!.id);
      for(const pointId of pointIds){
       const name=pointId===result.id?source.point.name:pointId===endpointIds[0]?source.a.name:source.b.name;
       document.assertions.push({id:`source_incidence_${constraint.id}${pointIds.length===1?"":`_${pointId}`}`,predicate:"on",entities:[`pt_${name}`,"seg_join"],severity:"fatal"});
      }
    }

  }

  const section = document.constructions.find((construction) => construction.operator === "section_point")!;
  const resultId = section.outputs[0]!;
  for (const [id, name] of [[`pt_${source.a.name}`, source.a.name], [`pt_${source.b.name}`, source.b.name], [resultId, result.label]]) {
    const entity = document.entities.find((candidate) => candidate.id === id)!;
    const text = entity.label!;
    const endpoint=id===`pt_${source.a.name}`?endpoints[0]:id===`pt_${source.b.name}`?endpoints[1]:undefined;
    entity.label = endpoint?.label ?? name;
    if(entity.label!==name)continue; // exact source tuple already carries both name and coordinates
    document.annotations.push({ id: `coordinates_${id}`, kind: "label", targetIds: [id], text: id === resultId ? text.replace(source.point.name, name!) : text });
  }
  for (const expression of problem.expressions) {
    if (expression.valueType !== "scalar") return false;
    const axis = ["x", "y"].find((axis) => [`${result.label}${axis}`, `e${result.label}${axis}`].includes(expression.id)) as "x" | "y" | undefined;
    if (axis && expression.root.kind !== "number") {
      const expected = source.point.exact[axis];
      const permitted = [source.a[axis], source.b[axis], source.m, source.n,...(source.mode==="midpoint"?[2,.5]:[])];
      const evaluate = (root: ExpressionNodeIR): Rational | null => {
        if (root.kind === "number") return permitted.includes(root.value) ? decimal(String(root.value)) : null;
        if (root.kind === "unary" && root.operand.kind === "number") {
          const signed=root.operator==="-"?-root.operand.value:root.operand.value;
          return permitted.includes(signed)?decimal(String(signed)):null;
        }
        if (root.kind !== "binary" || !["+", "-", "*", "/"].includes(root.operator)) return null;
        const a = evaluate(root.left), b = evaluate(root.right);
        if (!a || !b || root.operator === "/" && isZero(b)) return null;
        return root.operator === "+" ? add(a, b) : root.operator === "-" ? sub(a, b) : root.operator === "*" ? mul(a, b) : div(a, b);
      };
      const value = evaluate(expression.root);
      if (!value || text(value) !== expected || !sectionRootBindsFormula(source,axis,expression.root) || !hasPointEvidence(expression.evidenceFactIds, source.a)
        || !hasPointEvidence(expression.evidenceFactIds, source.b)
        || source.mode !== "midpoint" && !expression.evidenceFactIds.some((id) => dimensionEvidence(source, "m", facts.get(id)!.evidence.quote))
        || source.mode === "external" && !expression.evidenceFactIds.some((id) => /\bexternally?\b/i.test(facts.get(id)!.evidence.quote))) return false;
      continue;
    }
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
  const usedFacts=new Set([...problem.entities.flatMap(row=>row.evidenceFactIds),...problem.expressions.flatMap(row=>row.evidenceFactIds),...problem.constraints.flatMap(row=>row.evidenceFactIds),...problem.representationIntents.flatMap(row=>row.evidenceFactIds),...problem.solveRequests.flatMap(row=>row.resultBinding?.evidenceFactIds ?? [])]);
  if(problem.facts.some(row=>!usedFacts.has(row.id))) return false;
  const requestedAxes=new Set<string>(),boundIds=new Set<string>();
  for(const request of problem.solveRequests){
    if(request.kind!=="evaluate") return false;
    const expression=problem.expressions.find(row=>row.id===request.expressionId);
    const axis=["x","y"].find(axis=>[`${result.label}${axis}`,`e${result.label}${axis}`].includes(expression?.id ?? "")) as "x"|"y"|undefined;
    if(!axis || !expression || !sectionRootBindsFormula(source,axis,expression.root) || requestedAxes.has(axis)) return false;
    requestedAxes.add(axis);
    const binding=request.resultBinding;
    if(!binding) continue; // legacy source geometry can prove an unbound evaluate ask
    const symbol=binding.symbol.replace(/_/g,"");
    if(![`${result.label}${axis}`,`${axis}${result.label}`,axis].includes(symbol) || binding.unit && !["1","coordinate","unit","units"].includes(binding.unit)
      || boundIds.has(binding.turnPlanQuantityId) || !binding.evidenceFactIds.length || !binding.evidenceFactIds.every(id=>facts.get(id)?.kind==="requested")) return false;
    boundIds.add(binding.turnPlanQuantityId);
    document.quantities.push({id:binding.turnPlanQuantityId,symbol:binding.symbol,value:source.point[axis],...(binding.unit?{unit:binding.unit}:{}),provenance:"derived",evidenceFactIds:[...binding.evidenceFactIds],sourceText:binding.evidenceFactIds.map(id=>facts.get(id)!.evidence.quote).join("\n")});
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

/** A requested coordinate is carried by the independently bound section
 * construction. Given-fact evidence does not turn its formula into a new given. */
export function sectionFormulaRequestedDimensionIsCarried(document:SceneDocument,problem:ProblemIR,expressionId:string,value:number):boolean|null {
  const reading=readSectionFormulaSource(problem.question);
  if (reading.status!=="ok") return null;
  const request=problem.solveRequests.filter(row=>row.kind==="evaluate" && row.expressionId===expressionId && row.resultBinding);
  if (request.length!==1) return null;
  const binding=request[0]!.resultBinding!;
  if (!binding.evidenceFactIds.length || !binding.evidenceFactIds.every(id=>problem.facts.some(row=>row.id===id && row.kind==="requested"))) return null;
  const symbol=binding.symbol.replace(/_/g,""),name=reading.source.point.name;
  const axis=["x","y"].find(axis=>[`${axis}${name}`,`${name}${axis}`,axis].includes(symbol)) as "x"|"y"|undefined;
  if (!axis) return null;
  if (binding.unit && !["1","unit","units","coordinate"].includes(binding.unit)) return false;
  return value===reading.source.point[axis] && sectionFormulaSourceProgramIsBound(document,problem);
}

function sectionFormulaSourceProgramIsBound(document:SceneDocument,problem:ProblemIR):boolean {
  const expected=sectionFormulaScene(problem.question,problem);
  if (!expected) return false;
  const canonical=validateSceneDocument(pruneDeadSceneEntities(expected as unknown as Record<string,unknown>)).document;
  if (!canonical) return false;
  const shape=(scene:SceneDocument)=>({entities:scene.entities.map(({provenance:_provenance,...row})=>row),quantities:scene.quantities,constructions:scene.constructions,annotations:scene.annotations.map(row=>{
    const oracle=canonical.annotations.find(candidate=>candidate.id===row.id && sameSceneValue(candidate.targetIds,row.targetIds));
    if(!oracle || !["label","callout","badge"].includes(row.kind))return row;
    try{
      const claim=readDerivedCoordinateLabelClaim(row.text ?? ""),expectedClaim=readDerivedCoordinateLabelClaim(oracle.text ?? "");
      if(claim && expectedClaim && claim.name===expectedClaim.name && claim.unit===expectedClaim.unit && sameSceneValue(claim.values,expectedClaim.values))return {...row,kind:oracle.kind,text:oracle.text};
    }catch{ /* unparsed claims remain unequal and decline */ }
    return row;
  }),assertions:scene.assertions,relations:scene.relations,requiredEntityIds:scene.requiredEntityIds,revealGroups:scene.revealGroups,teachingTimeline:scene.teachingTimeline});
  return document.source.question===problem.question && sameSceneValue(shape(document),shape(canonical));
}

/** A compact board identifier may carry a longer caller line name only when
 * the entire source program independently regenerates with the actual IR. */
export function sectionFormulaProblemLineSceneId(document:SceneDocument,problem:ProblemIR,entityId:string):string|null {
 const line=problem.entities.find(row=>row.id===entityId && row.kind==="line");
 if(!line || !sectionFormulaSourceProgramIsBound(document,problem))return null;
 const join=document.entities.find(row=>row.id==="seg_join" && row.kind==="line");
 return join?.provenance?.problemEntityId===line.id && join.provenance.sourceLabel===line.label?join.id:null;
}

export function validateSectionFormulaProblemSource(document:SceneDocument,question:string,rawProblem?:unknown):SceneIssue[] {
  if (rawProblem==null || readSectionFormulaSource(question).status!=="ok") return [];
  const checked=validateProblemIR(rawProblem,question);
  if (checked.valid && checked.problem && sectionFormulaSourceProgramIsBound(document,checked.problem)) return [];
  return [{code:"section_source_program",severity:"fatal",message:"The complete section source roles, caller line, requested coordinates and scene proofs must independently regenerate",path:"sourceAuthority.problemIR"}];
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
  if (reading.status === "declined") {
    return [{ code: "section_source_unsupported", severity: "fatal", path: "source.question", message: `the stem's complete section request is unsupported (${reading.reason})` }];
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
  // AB is a sourced geometric join. A forged lineage flag or matching caption
  // cannot stand in for the actual endpoints, including on restored documents.
  for (const [index, entity] of document.entities.entries()) {
    if (entity.label !== `${source.a.name}${source.b.name}` || !["line", "segment"].includes(entity.kind)) continue;
    const producer = document.constructions.filter((item) => item.outputs.includes(entity.id));
    const inputs = producer[0]?.inputs;
    const ends = inputs ? [pointAt(inputs.start ?? inputs.a), pointAt(inputs.end ?? inputs.b)] : [];
    const matches = (a: { x: number; y: number } | null | undefined, b: { x: number; y: number }): boolean => Boolean(a && a.x === b.x && a.y === b.y);
    if (producer.length !== 1 || !["segment", "line"].includes(producer[0]!.operator)
      || !(matches(ends[0], source.a) && matches(ends[1], source.b) || matches(ends[0], source.b) && matches(ends[1], source.a))) {
      issues.push({ code: "section_source_mismatch", severity: "fatal", path: `entities[${index}]`, message: "The sourced joining line must have both source endpoints" });
    }
  }
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
      analyticLine: { section: { m, n, parameter: inputs.mode === "midpoint" ? 0.5 : m / (inputs.mode === "external" ? m - n : m + n) } },
    })), issues);
    } catch (error) {
      issues.push({ code: "section_source_unsupported", severity: "fatal", path: `constructions[${index}].outputs`, message: error instanceof Error ? error.message : "Section label provenance is unsupported" });
    }
  }
  return issues;
}

type Role = "x" | "y" | "ratio";


function sectionResultRole(source:SectionFormulaSource,symbol:string):Role|null{
 const key=symbol.replace(/_/g,"");
 for(const axis of ["x","y"] as const) if([`${axis}${source.point.name}`,`${source.point.name}${axis}`,axis].includes(key))return axis;
 if(source.asks==="ratio" && ["k","λ","lambda","r","ratio","m/n","m:n",`${source.a.name}${source.point.name}/${source.point.name}${source.b.name}`,`${source.a.name}${source.point.name}:${source.point.name}${source.b.name}`].includes(key))return "ratio";
 return null;
}
const sectionUnitIsCoordinate=(unit:unknown)=>unit===undefined || ["1","coordinate","unit","units"].includes(String(unit));

/** Recheck every supplied plan row against a named source role. Numeric
 * coincidence, persisted solver values and quantity IDs do not grant a role. */
export function sectionFormulaPlanIssues(question:string,rawPlan:unknown,problemIR?:unknown):SceneIssue[]{
 const reading=readSectionFormulaSource(question);
 if(reading.status!=="ok") return [];
 const checked=validateTurnPlanV3(rawPlan,question);
 if(!checked.valid || !checked.plan) return [{code:"section_source_plan",severity:"fatal",path:"turnPlan",message:"Section caller plan must remain structurally valid"}];
 const plan=checked.plan;
 const {source}=reading;
 const unitOk=sectionUnitIsCoordinate;
 const resultRole=(symbol:string)=>sectionResultRole(source,symbol);
 const issues:SceneIssue[]=[];
 const fail=(id:string,message:string)=>issues.push({code:"section_source_plan",severity:"fatal",path:`turnPlan.${id}`,message});
 const close=(actual:number,expected:number)=>Math.abs(actual-expected)<=1e-9*Math.max(1,Math.abs(expected));
 for(const row of plan.givens){
  const dimension=sectionGivenDimension(source,row,question);
  if(!dimension || !unitOk(row.unit) || !close(row.value,dimension.value)) fail(row.id,"Section givens must bind the named source coordinate or stated ratio component, with its actual value and unit");
 }
 for(const row of plan.derived){
  const role=resultRole(row.symbol),dimension=sectionDimension(source,row.symbol,question);
  const expected=role==="ratio"?source.ratio:role?source.point[role]:dimension?.value;
  if(expected===undefined || !unitOk(row.unit) || role==="ratio" && row.unit!==undefined && row.unit!=="1" || !close(row.value,expected)) fail(row.id,"Section derived rows must bind a named source/result role, value and unit");
 }
 for(const row of plan.unknowns){
  const role=resultRole(row.symbol);
  if(!role || !unitOk(row.unit) || role==="ratio" && row.unit!==undefined && row.unit!=="1") fail(row.id,"Section unknowns must bind the requested source point or dimensionless ratio");
 }
 if(problemIR!=null){
  const problem=validateProblemIR(problemIR,question).problem;
  if(!problem) fail("problemIR","Section caller IR must remain structurally valid");
  else for(const request of problem.solveRequests){
   const binding=request.resultBinding;
   if(!binding) continue;
   const rows=[...plan.derived,...plan.unknowns].filter(row=>row.id===binding.turnPlanQuantityId);
   if(!rows.length || rows.some(row=>row.symbol!==binding.symbol || row.unit!==binding.unit)) fail(binding.turnPlanQuantityId,"Section request bindings must address the actual caller plan identity, symbol and unit");
  }
 }
 return issues;
}

/**
 * Hold the turn plan to the stem's section. Coordinates of the section point
 * and the ratio a ratio question asks for are corrected to the exact values;
 * givens must bind their named source roles and units; unrelated numerical
 * rows and claims are withdrawn. The solved coordinates (and ratio) are
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
    return { plan: { ...plan, derived: [], unknowns: [],qualitativeClaims:[] }, reading, issues };
  }
  const { source } = reading;
  const solved: Record<Role, number> = { x: source.point.x, y: source.point.y, ratio: source.ratio };
  const agrees = (expected: number, value: number): boolean => {
    if (Math.abs(expected - value) <= 1e-9 * Math.max(1, Math.abs(expected))) return true;
    const decimals = (String(value).split(".")[1] ?? "").length;
    const significant = String(Math.abs(value)).replace(".", "").replace(/^0+/, "").length;
    return significant >= 2 && Number(expected.toFixed(decimals)) === value;
  };
  const givens = plan.givens.filter((quantity) => {
    const dimension=sectionGivenDimension(source,quantity,question);
    if(dimension && sectionUnitIsCoordinate(quantity.unit) && agrees(dimension.value,quantity.value))return true;
    issues.push({ code: "section_given_conflict", quantityId: quantity.id, message: `given ${quantity.symbol}=${quantity.value} does not bind its stated source role, value and unit` });
    return false;
  });
  const derived: TurnPlanQuantityV3[] = [];
  for (const quantity of plan.derived) {
    const role = sectionResultRole(source,quantity.symbol);
    if (role && Number.isFinite(solved[role]) && sectionUnitIsCoordinate(quantity.unit) && (role!=="ratio" || quantity.unit===undefined || quantity.unit==="1")) {
      if (agrees(solved[role], quantity.value)) derived.push(quantity);
      else {
        const value = Number(solved[role].toPrecision(10));
        issues.push({ code: "section_value_corrected", quantityId: quantity.id, message: `${quantity.symbol}: ${quantity.value} -> ${value}` });
        derived.push({ ...quantity, value, sourceText: `Section-verified ${quantity.symbol} = ${value}` });
      }
    } else if (!role && sectionDimension(source,quantity.symbol,question) && sectionUnitIsCoordinate(quantity.unit) && agrees(sectionDimension(source,quantity.symbol,question)!.value,quantity.value)) {
      derived.push(quantity);
    } else {
      issues.push({ code: "section_value_withdrawn", quantityId: quantity.id, message: `${quantity.symbol}=${quantity.value} is neither stated nor solved` });
    }
  }
  // A named result coordinate has a dimensionless coordinate unit. Bind a
  // missing derived unit to its explicitly matched unknown before IR planning;
  // never infer metric units or convert a stated conflicting unit.
  for(let i=0;i<derived.length;i++){
    const row=derived[i]!,unknown=plan.unknowns.find(candidate=>candidate.id===row.id && candidate.symbol===row.symbol);
    const role=sectionResultRole(source,row.symbol);
    if(row.unit===undefined && unknown?.unit==="coordinate" && (role==="x" || role==="y")) derived[i]={...row,unit:"coordinate"};
  }
  const present = (value: number): boolean => [...givens, ...derived].some((quantity) => agrees(value, quantity.value) && sectionResultRole(source,quantity.symbol) !== null);
  const name = source.point.name;
  const additions: Array<[string, string, number]> = source.asks === "ratio"
    ? [["section_ratio", "k", source.ratio]]
    : [["section_x", `x_${name}`, source.point.x], ["section_y", `y_${name}`, source.point.y]];
  for (const [id, symbol, value] of additions) {
    if (present(value) && derived.some((quantity) => sectionResultRole(source,quantity.symbol) === sectionResultRole(source,symbol))) continue;
    const rounded = Number(value.toPrecision(10));
    derived.push({ id, symbol, value: rounded, provenance: "derived", sourceText: `Section-verified ${symbol} = ${rounded}` });
    issues.push({ code: "section_value_added", quantityId: id, message: `${symbol} = ${rounded}` });
  }
  const kept = new Set([...givens, ...derived].map((quantity) => quantity.id));
  const unknowns = plan.unknowns.filter(unknown=>{
    const role=sectionResultRole(source,unknown.symbol);
    const valid=kept.has(unknown.id) && role!==null && sectionUnitIsCoordinate(unknown.unit) && (role!=="ratio" || unknown.unit===undefined || unknown.unit==="1");
    if(!valid)issues.push({code:"section_unknown_withdrawn",quantityId:unknown.id,message:"Unknown does not bind the requested source role and unit"});
    return valid;
  });
  const changed=new Set(issues.filter(issue=>issue.code!=="section_value_added").map(issue=>issue.quantityId));
  const cleanDerived=derived.map(row=>row.dependsOn?{...row,dependsOn:row.dependsOn.filter(id=>kept.has(id))}:row);
  const qualitativeClaims=plan.qualitativeClaims.filter(claim=>!(claim.relatedQuantityIds ?? []).some(id=>changed.has(id) || !kept.has(id) && !unknowns.some(row=>row.id===id)));
  return { plan: { ...plan, givens, derived:cleanDerived, unknowns,qualitativeClaims }, reading, issues };
}
