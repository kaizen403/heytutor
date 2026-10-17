/** Source-bound optics inputs, in SI, shared by geometry and teaching authority. */
import type { TurnPlanV3, TurnPlanQuantityV3 } from "../contracts/contractsV3";
import type { ProblemIR } from "../ir/problemIR";

const NUMBER = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
const LENGTH = "(mm|cm|nm|[μµu]m|micromet(?:re|er)s?|millimet(?:re|er)s?|centimet(?:re|er)s?|nanomet(?:re|er)s?|met(?:re|er)s?|m)\\b(?!\\s*(?:/|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻^]|s\\b|s[²^]))";
const INVALID_LENGTH_UNIT = /\b(?:mm|cm|nm|[μµu]m|m)\s*(?:[⁰¹²³⁴⁵⁶⁷⁸⁹⁻^]|\/)/i;
function scale(unit: string): number {
  return /^(?:mm|milli)/i.test(unit) ? 1e-3 : /^(?:cm|centi)/i.test(unit) ? 1e-2
    : /^(?:nm|nano)/i.test(unit) ? 1e-9 : /^(?:[μµu]m|micro)/i.test(unit) ? 1e-6 : 1;
}
function length(question: string, prefix: string, suffix = ""): number | null {
  const match = new RegExp(`${prefix}\\s*${NUMBER}\\s*${LENGTH}${suffix}`, "i").exec(question);
  return match ? Number(match[1]) * scale(match[2]!) : null;
}
/** These single-apparatus laws cannot certify a compound optical system or successive states. */
export function unsupportedMirrorSourceContext(question: string): boolean {
  return INVALID_LENGTH_UNIT.test(question) || /\blens(?:es)?\b|\b(?:two|second|another|multiple) mirrors?\b|\b(?:moved|shifted|inserted|immersed)\b/i.test(question)
    || /\b(?:then|subsequently|afterwards)\b[^.;!?]{0,70}\b(?:placed|positioned|located|object|mirror)\b/i.test(question)
    || (question.match(/focal length/gi)?.length ?? 0) > 1;
}
export function unsupportedDoubleSlitSourceContext(question: string): boolean {
  return INVALID_LENGTH_UNIT.test(question) || /\b(?:immersed|second film|another film|two films|both slits|moving slit|tilted film)\b/i.test(question)
    || (question.match(/refractive index/gi)?.length ?? 0) > 1;
}
export interface MirrorSource {
  kind: "concave" | "convex"; u: number; f: number; v: number; m: number; ho: number | null; hi: number | null;
  objectRegion: string;
}
export function mirrorSource(question: string): MirrorSource | null {
  if (unsupportedMirrorSourceContext(question)) return null;
  const kind = /\b(concave|convex) mirror\b/i.exec(question)?.[1]?.toLowerCase();
  if (kind !== "concave" && kind !== "convex") return null;
  const distance = length(question, "(?:object[^.;!?]{0,45}?(?:placed|located|positioned)(?: at)?|object distance(?: is| of| =)?)", "\\s*(?:in front|from|away)");
  const focal = length(question, "focal length(?: is| of| =)?");
  if (distance === null || focal === null || distance <= 0 || focal <= 0) return null;
  const u = -distance, f = kind === "concave" ? -focal : focal;
  const v = 1 / (1 / f - 1 / u), m = -v / u;
  if (!Number.isFinite(v)) return null;
  const ho = length(question, "(?:an?|the)?", "\\s*(?:tall|high)\\s*object") ?? length(question, "object(?: of)? height(?: is| of| =)?");
  const objectRegion = kind === "convex" ? "in front of the convex mirror"
    : distance < focal ? "between the pole and F" : distance === focal ? "at F"
      : distance < 2 * focal ? "between F and C" : distance === 2 * focal ? "at C" : "beyond C";
  return { kind, u, f, v, m, ho, hi: ho === null ? null : m * ho, objectRegion };
}
export interface DoubleSlitSource {
  d: number; D: number; wavelength: number;
  film: null | { index: number; thickness: number; side: "upper" | "lower"; addedPath: number; phase: number; shift: number };
  beta: number;
}
export function doubleSlitSource(question: string): DoubleSlitSource | null {
  if (unsupportedDoubleSlitSourceContext(question)) return null;
  if (!/\b(?:double[- ]slit|two slits|YDSE)\b/i.test(question)) return null;
  const d = length(question, "(?:slit (?:spacing|separation)|separation between the slits|distance between the slits|slits (?:are )?separated by)(?: is| of| =)?");
  const D = length(question, "(?:screen (?:is )?(?:placed |kept )?(?:at (?:a distance of )?)?|distance (?:of|to) the screen(?: is| of| =)?)");
  const wavelength = length(question, "wavelength(?: is| of| =)?");
  if (d === null || D === null || wavelength === null || d <= 0 || D <= 0 || wavelength <= 0) return null;
  let film: DoubleSlitSource["film"] = null;
  if (/\bfilm|\bplate/i.test(question)) {
    const indexMatch = new RegExp(`refractive index(?: is| of| =)?\\s*${NUMBER}`, "i").exec(question);
    const thickness = length(question, "thickness(?: is| of| =)?");
    const side = /\b(?:covers?|covering|over|at) (?:the )?(upper|lower) slit\b/i.exec(question)?.[1]?.toLowerCase();
    if (!indexMatch || thickness === null || thickness <= 0 || (side !== "upper" && side !== "lower")) return null;
    const index = Number(indexMatch[1]);
    if (index < 1) return null;
    const addedPath = (index - 1) * thickness;
    film = { index, thickness, side, addedPath, phase: 2 * Math.PI * addedPath / wavelength,
      shift: (side === "upper" ? 1 : -1) * D * addedPath / d };
  }
  return { d, D, wavelength, film, beta: wavelength * D / d };
}

/** Bind only the supported mirror law; source values win over stale model claims. */
export function applyOpticsSourceAuthority(question: string, plan: TurnPlanV3): { plan: TurnPlanV3 } | null {
  const mirror = mirrorSource(question);
  if (!mirror) return applyDoubleSlitSourceAuthority(question, plan);
  const values: Array<{ aliases: string[]; symbol: string; value: number; given: boolean; unit?: string }> = [
    { aliases: ["u", "objectdistance", "do"], symbol: "u", value: mirror.u * 100, given: true, unit: "cm" },
    { aliases: ["f", "focallength"], symbol: "f", value: mirror.f * 100, given: true, unit: "cm" },
    { aliases: ["v", "imagedistance", "vimg", "vi", "di"], symbol: "v", value: mirror.v * 100, given: false, unit: "cm" },
    { aliases: ["m", "magnification"], symbol: "m", value: mirror.m, given: false },
    ...(mirror.ho === null ? [] : [{ aliases: ["ho", "h0", "objectheight", "h"], symbol: "h_o", value: mirror.ho * 100, given: true, unit: "cm" }]),
    ...(mirror.hi === null ? [] : [{ aliases: ["hi", "imageheight"], symbol: "h_i", value: mirror.hi * 100, given: false, unit: "cm" }]),
  ];
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = (q: TurnPlanQuantityV3, aliases: string[]) => aliases.includes(key(q.id)) || aliases.includes(key(q.symbol));
  const before = [...plan.givens, ...plan.derived];
  const given = plan.givens.filter(q => !values.some(v => matches(q, v.aliases)));
  const derived = plan.derived.filter(q => !values.some(v => matches(q, v.aliases)));
  for (const value of values) {
    const previous = before.find(q => matches(q, value.aliases) && values.filter(v => matches(q, v.aliases)).length === 1);
    const from = value.unit && /^(?:mm|cm|nm|[μµu]m|m)$/.test(value.unit) ? scale(value.unit) : null;
    const to = previous?.unit && /^(?:mm|cm|nm|[μµu]m|m)$/.test(previous.unit) ? scale(previous.unit) : null;
    const preserve = previous && ((from !== null && to !== null) || previous.unit === value.unit);
    const quantity: TurnPlanQuantityV3 = {
      ...(preserve ? previous : {}), id: preserve ? previous.id : value.symbol,
      symbol: preserve ? previous.symbol : value.symbol,
      value: preserve && from !== null && to !== null ? value.value * from / to : value.value,
      ...((preserve ? previous.unit : value.unit) ? { unit: preserve ? previous.unit : value.unit } : {}),
      provenance: value.given ? "given" : "derived", uncertainty: 0,
      sourceText: value.given ? "Source-bound Cartesian mirror input" : "Computed from the source-bound Cartesian mirror formula" };
    (value.given ? given : derived).push(quantity);
  }
  const regionClaim = { id: "source_mirror_object_region", claim: "object_position_relative_to_focus_and_centre", expected: mirror.objectRegion };
  const claims = plan.qualitativeClaims.filter(c => !/object.*(?:position|region|beyond|centre|center|focus)|image.*(?:nature|orientation|real|virtual|inverted|upright)|source_mirror_/i.test(`${c.id} ${c.claim}`));
  return { plan: { ...plan, givens: given, derived, qualitativeClaims: [...claims, regionClaim,
    { id: "source_mirror_image_nature", claim: "image_nature", expected: mirror.v < 0 ? "real" : "virtual" },
    { id: "source_mirror_image_orientation", claim: "image_orientation", expected: mirror.m < 0 ? "inverted" : "upright" },
  ] } };
}

/** Quantities and qualitative phase facts for one film in air/vacuum. */
function applyDoubleSlitSourceAuthority(question: string, plan: TurnPlanV3): { plan: TurnPlanV3 } | null {
  const source = doubleSlitSource(question);
  if (!source) return null;
  type SourceQuantity = { id: string; value: number; unit?: string; given: boolean };
  const values: SourceQuantity[] = [
    { id: "d", value: source.d * 1000, unit: "mm", given: true },
    { id: "D", value: source.D, unit: "m", given: true },
    { id: "lambda", value: source.wavelength * 1e9, unit: "nm", given: true },
    { id: "beta", value: source.beta * 1000, unit: "mm", given: false },
    ...(source.film ? [
      { id: "n", value: source.film.index, given: true },
      { id: "t", value: source.film.thickness * 1e6, unit: "μm", given: true },
      { id: "added_path", value: source.film.addedPath * 1e6, unit: "μm", given: false },
      { id: "dphi", value: source.film.phase, unit: "rad", given: false },
      { id: "y0", value: source.film.shift * 1000, unit: "mm", given: false },
    ] : []),
  ];
  const roles: Record<string, string[]> = {
    d: ["d", "slitspacing", "slitseparation"], D: ["D", "L", "l", "screendistance"],
    lambda: ["lambda", "lam", "λ", "wavelength"], beta: ["beta", "β", "fringespacing", "fringewidth"],
    n: ["n", "mu", "μ", "refractiveindex"], t: ["t", "thickness", "filmthickness"],
    added_path: ["addedpath", "opl", "delta", "Δ", "pathdifference", "extrapath"],
    dphi: ["dphi", "Δφ", "deltaphi", "addedphase", "phasedifference"],
    y0: ["y0", "y₀", "shift", "fringeshift", "displacement"],
  };
  // Preserve d versus D: they are distinct physical roles in this apparatus.
  const normalize = (value: string) => value.replace(/[{}_\\\s]/g, "");
  const owned = (quantity: TurnPlanQuantityV3) => values.some(value =>
    [quantity.id, quantity.symbol].some(token => roles[value.id]!.includes(normalize(token))));
  const givens = plan.givens.filter(quantity => !owned(quantity));
  const derived = plan.derived.filter(quantity => !owned(quantity));
  const before = [...plan.givens, ...plan.derived];
  const roleMatches = (quantity: TurnPlanQuantityV3, role: string) => [quantity.id, quantity.symbol]
    .some(token => roles[role]!.includes(normalize(token)));
  const lengthFactor = (unit: string | undefined): number | null => unit && /^(?:mm|cm|nm|[μµu]m|m)$/.test(unit) ? scale(unit) : null;
  for (const value of values) {
    // Keep valid solver bindings (identifier, symbol and unit) while replacing
    // their value. Canonical defaults are for genuinely missing quantities.
    const previous = before.find(quantity => roleMatches(quantity, value.id)
      && values.filter(other => roleMatches(quantity, other.id)).length === 1);
    const from = lengthFactor(value.unit), to = lengthFactor(previous?.unit);
    const compatible = previous && ((from !== null && to !== null) || previous.unit === value.unit);
    const preserve = compatible && ![...givens, ...derived].some(quantity => quantity.id === previous.id);
    const quantity: TurnPlanQuantityV3 = { id: preserve ? previous.id : value.id,
      symbol: preserve ? previous.symbol : value.id,
      value: preserve && from !== null && to !== null ? value.value * from / to : value.value,
      ...((preserve ? previous.unit : value.unit) ? { unit: preserve ? previous.unit : value.unit } : {}),
      provenance: value.given ? "given" : "derived", uncertainty: 0,
      sourceText: value.given ? "Source-bound double-slit input" : "Computed from source-bound paraxial interference and optical-path laws" };
    (value.given ? givens : derived).push(quantity);
  }
  const film = source.film;
  const claims = plan.qualitativeClaims.filter(claim => !/^source_double_slit_/.test(claim.id)
    && !/fringe|phase|pattern|cent(?:er|re)|bright|dark|slit/i.test(claim.claim));
  if (film) {
    const cycles = film.addedPath / source.wavelength;
    const integer = Math.abs(cycles - Math.round(cycles)) < 1e-9;
    const halfInteger = Math.abs(cycles - Math.floor(cycles) - 0.5) < 1e-9;
    claims.push(
      { id: "source_double_slit_film_side", claim: "film_covers_slit", expected: film.side },
      { id: "source_double_slit_shift_direction", claim: "tracked_zero_order_shift", expected: film.shift === 0 ? "no displacement" : `toward the ${film.side} slit` },
      { id: "source_double_slit_original_centre", claim: "original_screen_centre", expected: integer ? "bright maximum" : halfInteger ? "dark minimum" : "neither a bright maximum nor a dark minimum" },
      { id: "source_double_slit_pattern", claim: "final_unlabeled_intensity_pattern_identical_to_original", expected: integer },
    );
  }
  return { plan: { ...plan, givens, derived, qualitativeClaims: claims } };
}

/** Use the source's compact apparatus name before deriving visual obligations.
 * "Observation screen" is a planner expansion of the stated "screen" and
 * exceeds the scene label contract. IDs, evidence and constraints are retained.
 */
export function groundDoubleSlitProblem(problem: ProblemIR): ProblemIR {
  if (!doubleSlitSource(problem.question)) return problem;
  return { ...problem, entities: problem.entities.map(entity =>
    entity.kind === "line" && /^observation screen$/i.test(entity.label ?? "")
      ? { ...entity, label: "screen" } : entity) };
}
