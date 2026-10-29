/**
 * Two checks for the engine's own lens and mirror figure.
 *
 * `opticsArchetypePlanAgreement` is the save check for that figure: the
 * figure's u, f and v (and its span texts) are compared with the plan's
 * object distance, focal length or power, radius, image distance and
 * magnification by magnitude after exact unit conversion, and the side of
 * the image (real or virtual) and the element's kind must mean the same in
 * the plan's own sign convention. Plans write unsigned lengths, real-is-
 * positive lengths or Cartesian lengths; the engine writes Cartesian. Any
 * disagreement refuses, and so does a plan whose units or convention cannot
 * be read.
 *
 * `opticsArchetypeStrictEligibility` says whether the strict policy may draw
 * that figure when it dropped the planner's: one optical element, and u, f
 * and the kind read from the question itself (never a stock value), matching
 * the figure's own values.
 */
import type { SceneDocument } from "../types";
import { detectArchetype } from "./detect";
import {
  CM_PER_UNIT,
  FOCAL_LENGTH_ALIASES,
  IMAGE_DISTANCE_ALIASES,
  OBJECT_DISTANCE_ALIASES,
  RADIUS_ALIASES,
  lengthUnitKey,
  namesSeveralOpticalElements,
  opticsConfigurationIssue,
} from "./opticsSource";
import { collectPlanQuantities, type PlanQuantity } from "./slots";

export const OPTICS_ARCHETYPES = ["thin_lens", "spherical_mirror"] as const;
export type OpticsArchetype = (typeof OPTICS_ARCHETYPES)[number];

export function opticsArchetypeOf(document: Pick<SceneDocument, "source">): OpticsArchetype | null {
  const archetype = (document.source as { archetype?: unknown } | undefined)?.archetype;
  return archetype === "thin_lens" || archetype === "spherical_mirror" ? archetype : null;
}

interface FigureValues {
  archetype: OpticsArchetype;
  unit: "cm" | "mm" | "m";
  /** Signed Cartesian values in centimetres. */
  u: number | null;
  f: number | null;
  v: number | null;
  concave: boolean | null;
  real: boolean | null;
}

function figureValues(document: SceneDocument): FigureValues | null {
  const archetype = opticsArchetypeOf(document);
  if (!archetype) return null;
  let unit: FigureValues["unit"] | null = null;
  const read = (id: string): number | null => {
    const quantity = document.quantities.find((item) => item.id === id);
    if (!quantity || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return null;
    const key = lengthUnitKey(quantity.unit);
    if (!key || (unit !== null && unit !== key)) return Number.NaN;
    unit = key;
    return quantity.value * CM_PER_UNIT[key];
  };
  const u = read("u");
  const f = read("f");
  const v = read("v");
  if ([u, f, v].some((value) => Number.isNaN(value))) return null;
  // The generator writes Cartesian values: a concave mirror and a diverging lens have f < 0.
  const concave = f === null ? null : f < 0;
  const real = v === null ? null : archetype === "thin_lens" ? v > 0 : v < 0;
  return { archetype, unit: unit ?? "cm", u, f, v, concave, real };
}

const agree = (first: number, second: number): boolean =>
  Math.abs(Math.abs(first) - Math.abs(second)) <= 5e-3 * Math.max(Math.abs(first), Math.abs(second)) + 1e-9;

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[_{}\\^\s-]/g, "").replace(/[^a-z0-9]/g, "");
}

function rowsFor(rows: readonly PlanQuantity[], aliases: readonly string[]): PlanQuantity[] {
  return rows.filter((row) => aliases.includes(normalizeKey(row.id)) || aliases.includes(normalizeKey(row.symbol)));
}

interface PlanLength { id: string; cm: number; given: boolean }

const MAGNIFICATION_ALIASES = ["m", "magnification", "mag"] as const;
/** Object and image heights: the figure draws no height value, so they are read and set aside. */
const HEIGHT_ALIASES = [
  "h", "ho", "hi", "h1", "h2", "hobj", "himg", "hobject", "himage", "objectheight", "imageheight", "height",
  "objectsize", "imagesize", "y", "y1", "y2", "yo", "yi",
] as const;
const DIOPTRE_UNIT = /^(?:d|dioptres?|diopters?|m\^?-1|1\/m)$/i;
/** Units of length the plan may write that the figure cannot convert. */
const OTHER_LENGTH_UNIT = /^(?:km|nm|µm|um|micrometres?|micrometers?|in|inch(?:es)?|ft|feet|foot)$/i;
/** Ids that name a distance on the axis: short symbols (d, d_obj, u_1, x1, D, s) and distance words. */
const DISTANCE_ID = /^(?:[udvxsl]|d[\s_-]?[a-z0-9]{1,6}|[uvxs][\s_-]?\d{1,2})$|distance|position|separation|spacing|gap|displacement|length|radius|near\s*point|far\s*point/i;
const SPAN = /^([ufv])\s*=\s*(-?\d+(?:\.\d+)?)\s*(cm|mm|m)$/;

export interface OpticsPlanAgreement {
  /** False when the document is not the engine's lens or mirror figure. */
  applies: boolean;
  issues: string[];
  /** Quantity ids and displayed texts this check certified (or refused). */
  quantityIds: string[];
  texts: string[];
}

/**
 * The plan agreement of a lens or mirror archetype figure. `stem` supplies
 * the values the question states, which support u and f when the plan does
 * not carry them; v is computed from u and f and must agree with a plan v.
 */
export function opticsArchetypePlanAgreement(
  document: SceneDocument,
  turnPlan: unknown,
  question: string,
): OpticsPlanAgreement {
  const values = figureValues(document);
  if (!values) return { applies: false, issues: [], quantityIds: [], texts: [] };
  const issues: string[] = [];
  // A figure that states some lengths and draws others at stock values
  // (an unread object distance) is a different optical case: never saved.
  const stated = [values.u, values.f].filter((value) => value !== null).length;
  if (stated === 1) issues.push("the figure states one of u and f and draws the other at a stock value");
  const rows = collectPlanQuantities(turnPlan);
  const lengthRows = (aliases: readonly string[]) => rowsFor(rows, aliases).map((row) => {
    const unit = lengthUnitKey(row.unit);
    if (!unit) issues.push(`plan ${row.id} has no length unit`);
    return unit ? { id: row.id, cm: row.value * CM_PER_UNIT[unit], given: row.origin === "given" } : null;
  }).filter((row): row is PlanLength => row !== null);
  const uRows = lengthRows(OBJECT_DISTANCE_ALIASES);
  const vRows = lengthRows(IMAGE_DISTANCE_ALIASES);
  // Every power row of a one lens question is that lens's power, whatever its id.
  const powerRows = values.archetype === "thin_lens"
    ? rows.filter((row) => DIOPTRE_UNIT.test((row.unit ?? "").trim()))
    : [];
  for (const row of powerRows) if (row.value === 0) issues.push(`plan ${row.id} is a zero power`);
  const fRows = [
    ...lengthRows(FOCAL_LENGTH_ALIASES),
    ...powerRows.filter((row) => row.value !== 0).map((row) => ({ id: row.id, cm: 100 / row.value, given: row.origin === "given" })),
    ...(values.archetype === "spherical_mirror" ? lengthRows(RADIUS_ALIASES).map((row) => ({ ...row, cm: row.cm / 2 })) : []),
  ];
  // Fail closed: a plan length this check cannot assign to u, v, f, R or a
  // height (d_obj, u_1, x1, D, a screen distance, a near point) would leave
  // the figure unchecked against it, so the figure is refused.
  const assigned = new Set<PlanQuantity>([
    ...rowsFor(rows, OBJECT_DISTANCE_ALIASES), ...rowsFor(rows, IMAGE_DISTANCE_ALIASES), ...rowsFor(rows, FOCAL_LENGTH_ALIASES),
    ...powerRows, ...(values.archetype === "spherical_mirror" ? rowsFor(rows, RADIUS_ALIASES) : []),
    ...rowsFor(rows, HEIGHT_ALIASES), ...rowsFor(rows, MAGNIFICATION_ALIASES),
  ]);
  for (const row of rows) {
    if (assigned.has(row)) continue;
    const unit = (row.unit ?? "").trim();
    const length = lengthUnitKey(unit) !== null || OTHER_LENGTH_UNIT.test(unit);
    const power = DIOPTRE_UNIT.test(unit);
    const distanceId = DISTANCE_ID.test(row.id) || DISTANCE_ID.test(row.symbol);
    const unitlessOrLength = !unit || length || /^(?:none|dimensionless|1)$/i.test(unit);
    if (length || power || (distanceId && unitlessOrLength)) issues.push(`plan ${row.id} is a length the figure does not check`);
  }
  const signed = [...uRows, ...vRows, ...fRows].some((row) => row.cm < 0);
  const check = (role: "u" | "f" | "v", figure: number | null, planned: PlanLength[]) => {
    for (const row of planned) {
      if (figure === null) { issues.push(`plan ${row.id} has no figure value`); continue; }
      if (!agree(figure, row.cm)) issues.push(`plan ${row.id} = ${row.cm} cm disagrees with the figure's ${role} = ${figure} cm`);
    }
  };
  check("u", values.u, uRows);
  check("f", values.f, fRows);
  check("v", values.v, vRows);

  // Sign meaning. Plans write magnitudes, real-is-positive values or
  // Cartesian values, and often magnitudes for the givens beside signed
  // derived values. A positive given copied from the stem is a magnitude
  // unless the givens themselves are signed; every other row's sign must fit
  // one convention for this figure: a lens focal length is negative for a
  // diverging lens and a lens image distance positive for a real image in
  // both; a mirror's signs depend on the convention.
  if (signed) {
    const givensSigned = [...uRows, ...vRows, ...fRows].some((row) => row.given && row.cm < 0);
    const signedRow = (row: PlanLength) => !(row.given && row.cm > 0 && !givensSigned);
    const mirror = values.archetype === "spherical_mirror";
    const fits = (convention: "cartesian" | "real_positive"): boolean => {
      const realPositiveMirror = mirror && convention === "real_positive";
      const cartesianMirror = mirror && convention === "cartesian";
      if (fRows.filter(signedRow).some((row) => values.concave !== null && (realPositiveMirror ? row.cm > 0 : row.cm < 0) !== values.concave)) return false;
      if (vRows.filter(signedRow).some((row) => values.real !== null && (cartesianMirror ? row.cm < 0 : row.cm > 0) !== values.real)) return false;
      if (mirror && uRows.filter(signedRow).some((row) => (convention === "cartesian" ? row.cm > 0 : row.cm < 0))) return false;
      return true;
    };
    if (!fits("cartesian") && !fits("real_positive")) issues.push("the plan's signs fit no sign convention for this figure (the other kind of element or the image on the other side)");
  }
  // Magnification: inverted (negative) exactly when the image is real, in
  // every convention; an unsigned plan may write its size only.
  if (values.u !== null && values.v !== null) {
    const m = values.archetype === "thin_lens" ? values.v / values.u : -values.v / values.u;
    for (const row of rowsFor(rows, MAGNIFICATION_ALIASES)) {
      const unit = (row.unit ?? "").trim().toLowerCase();
      if (unit && !["x", "×", "dimensionless", "none", "1"].includes(unit)) continue;
      if (!agree(m, row.value)) issues.push(`plan ${row.id} = ${row.value} disagrees with the figure's magnification ${m}`);
      else if (Math.sign(row.value) !== Math.sign(m) && (signed || row.value < 0)) issues.push(`plan ${row.id} sign disagrees with the image's orientation`);
    }
  }

  // u and f need a source: a plan row (checked above) or the question.
  const stem = detectArchetype(question);
  const stemSupports = (key: "u" | "f", figure: number | null): boolean => {
    if (figure === null || stem?.id !== values.archetype || stem.sources[key] !== "stem") return false;
    const value = stem.slots[key];
    return typeof value === "number" && agree(value, figure);
  };
  // A value the question states must be the figure's too, whatever the plan says.
  const stemStates = (key: "u" | "f") => stem?.id === values.archetype && stem.sources[key] === "stem";
  if (values.u !== null && stemStates("u") && !stemSupports("u", values.u)) issues.push("the figure's u is not the question's");
  if (values.f !== null && stemStates("f") && !stemSupports("f", values.f)) issues.push("the figure's f is not the question's");
  if (values.u !== null && uRows.length === 0 && !stemSupports("u", values.u)) issues.push("the figure's u is in neither the plan nor the question");
  if (values.f !== null && fRows.length === 0 && !stemSupports("f", values.f)) issues.push("the figure's f is in neither the plan nor the question");

  // Span texts speak the figure's own values in its unit, to display precision.
  const texts: string[] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "dimension" || typeof entity.label !== "string") continue;
    const match = SPAN.exec(entity.label.trim());
    if (!match) {
      if (/\d/.test(entity.label)) issues.push(`span ${entity.id} text ${JSON.stringify(entity.label)} is not a figure value`);
      texts.push(entity.label);
      continue;
    }
    texts.push(entity.label);
    const figure = values[match[1] as "u" | "f" | "v"];
    const shown = Number(match[2]);
    const decimals = (match[2]!.split(".")[1] ?? "").length;
    const tolerance = 0.5 * 10 ** -decimals * CM_PER_UNIT[match[3] as "cm"] + 1e-9;
    if (figure === null || match[3] !== values.unit || shown < 0 || Math.abs(Math.abs(figure) - shown * CM_PER_UNIT[values.unit]) > Math.max(tolerance, 5e-3 * Math.abs(figure))) {
      issues.push(`span ${entity.id} text ${JSON.stringify(entity.label)} does not show the figure's ${match[1]}`);
    }
  }
  return {
    applies: true,
    issues,
    quantityIds: document.quantities.filter((quantity) => ["u", "f", "v"].includes(quantity.id)).map((quantity) => quantity.id),
    texts,
  };
}

export interface OpticsStrictEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Whether strict may draw this engine lens or mirror figure for `question`:
 * the question names exactly one optical element, and the archetype read
 * from the question alone owns it with u, f and the kind all stated there
 * and equal to the figure's values.
 */
export function opticsArchetypeStrictEligibility(question: string, document: SceneDocument): OpticsStrictEligibility {
  const values = figureValues(document);
  if (!values) return { eligible: false, reason: "not the engine's lens or mirror figure" };
  if (namesSeveralOpticalElements(question)) return { eligible: false, reason: "the question names more than one optical element" };
  const configuration = opticsConfigurationIssue(question);
  if (configuration) return { eligible: false, reason: `the question is not one plain configuration: ${configuration}` };
  const stem = detectArchetype(question);
  if (stem?.id !== values.archetype) return { eligible: false, reason: "the question alone does not select this figure" };
  if (typeof stem.slots.conflict === "string") return { eligible: false, reason: `the question's ${stem.slots.conflict} evidence disagrees` };
  for (const key of ["u", "f", "kind"] as const) {
    if (stem.sources[key] !== "stem") return { eligible: false, reason: `${key} is not stated in the question` };
  }
  const stemU = stem.slots.u;
  const stemF = stem.slots.f;
  if (typeof stemU !== "number" || values.u === null || !agree(stemU, values.u)) return { eligible: false, reason: "the figure's u is not the question's" };
  if (typeof stemF !== "number" || values.f === null || !agree(stemF, values.f)) return { eligible: false, reason: "the figure's f is not the question's" };
  if ((stem.slots.kind === "concave") !== values.concave) return { eligible: false, reason: "the figure's element kind is not the question's" };
  if (values.v === null) return { eligible: false, reason: "the figure computes no image distance" };
  return { eligible: true, reason: `${values.archetype} with u, f and kind read from the question` };
}
