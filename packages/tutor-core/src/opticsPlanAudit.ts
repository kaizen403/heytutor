import {
  evaluateOpticsLaw,
  isOpticsLawId,
  type OpticsLawId,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

export interface OpticsPlanCorrection {
  lawId: OpticsLawId;
  quantityId: string;
  previousValue: number;
  correctedValue: number;
}

export interface OpticsPlanAuditResult {
  plan: TurnPlanV3;
  corrections: OpticsPlanCorrection[];
  checkedLawIds: OpticsLawId[];
}

type Dimension = "length" | "angle" | "power" | "time" | "speed" | "scalar";

/**
 * Recompute recognized optics results from plan givens. Ambiguous or
 * incomplete laws are skipped instead of guessed.
 */
export function reconcileTurnPlanWithOpticsLaws(plan: TurnPlanV3): OpticsPlanAuditResult {
  const lawIds = [...new Set(plan.lawIds.flatMap(canonicalOpticsLawId))];
  if (lawIds.length === 0) return { plan, corrections: [], checkedLawIds: [] };

  let current = plan;
  const corrections: OpticsPlanCorrection[] = [];
  const checkedLawIds: OpticsLawId[] = [];
  for (const lawId of lawIds) {
    const evaluation = evaluatePlanLaw(current, lawId);
    if (!evaluation) continue;
    checkedLawIds.push(lawId);
    for (const output of evaluation.outputs) {
      const result = correctDerivedQuantity(current, lawId, output.aliases, output.value, output.dimension);
      current = result.plan;
      corrections.push(...result.corrections);
    }
  }
  return { plan: current, corrections, checkedLawIds };
}

interface EvaluatedOutput {
  aliases: string[];
  value: number;
  dimension: Dimension;
}

function evaluatePlanLaw(
  plan: TurnPlanV3,
  lawId: OpticsLawId,
): { outputs: EvaluatedOutput[] } | null {
  const given = (aliases: string[], dimension: Dimension, absolute = false): number | null => {
    const quantity = findQuantity(plan.givens, aliases);
    if (!quantity) return null;
    const value = toBaseUnit(quantity.value, quantity.unit, dimension);
    return absolute ? Math.abs(value) : value;
  };
  const scalar = (aliases: string[], absolute = false) => given(aliases, "scalar", absolute);
  const length = (aliases: string[], absolute = false) => given(aliases, "length", absolute);
  const angle = (aliases: string[]) => given(aliases, "angle");
  const evaluate = (inputs: Record<string, unknown>) => {
    try {
      return evaluateOpticsLaw(lawId, inputs);
    } catch {
      return null;
    }
  };
  const output = (aliases: string[], value: number, dimension: Dimension): EvaluatedOutput => ({ aliases, value, dimension });

  if (lawId === "mirror_formula" || lawId === "thin_lens_formula") {
    const objectDistance = length(["object_distance", "objectdistance", "u"], true);
    const focalLength = length(["focal_length", "focallength", "f"]);
    if (objectDistance === null || focalLength === null) return null;
    const values = evaluate({ objectDistance, focalLength });
    return values ? { outputs: [
      output(["image_distance", "imagedistance", "v"], values.imageDistance!, "length"),
      output(["magnification", "m"], values.magnification!, "scalar"),
    ] } : null;
  }
  if (lawId === "snell_law") {
    const n1 = scalar(["n1", "refractive_index_1", "incident_index"]);
    const n2 = scalar(["n2", "refractive_index_2", "refracted_index"]);
    const incidentDeg = angle(["incident_angle", "incidence_angle", "i"]);
    if (n1 === null || n2 === null || incidentDeg === null) return null;
    const values = evaluate({ n1, n2, incidentDeg });
    return values ? { outputs: [output(["refracted_angle", "refraction_angle", "r"], values.refractedDeg!, "angle")] } : null;
  }
  if (lawId === "spherical_refraction") {
    const n1 = scalar(["n1", "refractive_index_1"]);
    const n2 = scalar(["n2", "refractive_index_2"]);
    const objectDistance = length(["object_distance", "u"]);
    const radius = length(["radius", "radius_of_curvature", "R"]);
    if (n1 === null || n2 === null || objectDistance === null || radius === null) return null;
    const values = evaluate({ n1, n2, objectDistance, radius });
    return values ? { outputs: [output(["image_distance", "v"], values.imageDistance!, "length")] } : null;
  }
  if (lawId === "lens_maker") {
    const lensIndex = scalar(["lens_index", "lens_refractive_index", "n_lens", "n"]);
    const mediumIndex = scalar(["medium_index", "n_medium", "n0"]) ?? 1;
    const radius1 = length(["radius1", "radius_1", "R1"]);
    const radius2 = length(["radius2", "radius_2", "R2"]);
    if (lensIndex === null || radius1 === null || radius2 === null) return null;
    const values = evaluate({ lensIndex, mediumIndex, radius1, radius2 });
    return values ? { outputs: [
      output(["focal_length", "f"], values.focalLength!, "length"),
      output(["power", "P"], values.power!, "power"),
    ] } : null;
  }
  if (lawId === "critical_angle") {
    const denseIndex = scalar(["dense_index", "n_dense", "n1", "refractive_index"]);
    const rareIndex = scalar(["rare_index", "n_rare", "n2"]) ?? 1;
    if (denseIndex === null) return null;
    const values = evaluate({ denseIndex, rareIndex });
    return values ? { outputs: [output(["critical_angle", "critical", "C"], values.criticalDeg!, "angle")] } : null;
  }
  if (lawId === "fiber_acceptance") {
    const coreIndex = scalar(["core_index", "n_core", "n1"]);
    const claddingIndex = scalar(["cladding_index", "n_cladding", "n2"]);
    const outsideIndex = scalar(["outside_index", "n_outside", "n0"]) ?? 1;
    if (coreIndex === null || claddingIndex === null) return null;
    const values = evaluate({ coreIndex, claddingIndex, outsideIndex });
    return values ? { outputs: [
      output(["numerical_aperture", "NA"], values.numericalAperture!, "scalar"),
      output(["acceptance_angle", "theta_a"], values.acceptanceDeg!, "angle"),
    ] } : null;
  }
  if (lawId === "lens_power") {
    const focalLengthMeters = length(["focal_length", "f"]);
    if (focalLengthMeters === null) return null;
    const values = evaluate({ focalLengthMeters });
    return values ? { outputs: [output(["power", "P"], values.power!, "power")] } : null;
  }
  if (lawId === "linear_magnification") {
    const objectDistance = length(["object_distance", "u"], true);
    const imageDistance = length(["image_distance", "v"], true);
    if (objectDistance === null || imageDistance === null) return null;
    const inverted = plan.qualitativeClaims.some((claim) => /inverted/i.test(claim.claim) && claim.expected !== false);
    const values = evaluate({ objectDistance, imageDistance, orientationSign: inverted ? -1 : 1 });
    return values ? { outputs: [output(["magnification", "m"], values.magnification!, "scalar")] } : null;
  }
  if (lawId === "lenses_in_contact") {
    const powers = plan.givens.filter((quantity) => isPowerQuantity(quantity)).map((quantity) =>
      toBaseUnit(quantity.value, quantity.unit, "power"));
    if (powers.length < 2) return null;
    const values = evaluate({ powers });
    return values ? { outputs: [
      output(["equivalent_power", "total_power", "P_eq", "P"], values.power!, "power"),
      output(["equivalent_focal_length", "focal_length", "F_eq", "f"], values.focalLength!, "length"),
    ] } : null;
  }
  if (lawId === "prism_minimum_deviation") {
    const refractiveIndex = scalar(["refractive_index", "prism_index", "n", "mu"]);
    const apexDeg = angle(["apex_angle", "prism_angle", "A"]);
    if (refractiveIndex === null || apexDeg === null) return null;
    const values = evaluate({ refractiveIndex, apexDeg });
    return values ? { outputs: [
      output(["minimum_deviation", "delta_min"], values.minimumDeviationDeg!, "angle"),
      output(["incidence_angle", "incident_angle", "i"], values.incidenceDeg!, "angle"),
      output(["refraction_angle", "r1", "r2"], values.refractionDeg!, "angle"),
      output(["emergence_angle", "e"], values.emergenceDeg!, "angle"),
    ] } : null;
  }
  if (lawId === "compound_microscope") {
    const tubeLength = length(["tube_length", "L"]);
    const objectiveFocalLength = length(["objective_focal_length", "f_o", "fo"]);
    const eyepieceFocalLength = length(["eyepiece_focal_length", "f_e", "fe"]);
    const nearPoint = length(["near_point", "least_distance", "D"]) ?? 0.25;
    if (tubeLength === null || objectiveFocalLength === null || eyepieceFocalLength === null) return null;
    const values = evaluate({ tubeLength, objectiveFocalLength, eyepieceFocalLength, nearPoint });
    return values ? { outputs: [output(["magnifying_power", "magnification", "M"], values.magnifyingPower!, "scalar")] } : null;
  }
  if (lawId === "astronomical_telescope") {
    const objectiveFocalLength = length(["objective_focal_length", "f_o", "fo"]);
    const eyepieceFocalLength = length(["eyepiece_focal_length", "f_e", "fe"]);
    if (objectiveFocalLength === null || eyepieceFocalLength === null) return null;
    const values = evaluate({ objectiveFocalLength, eyepieceFocalLength });
    return values ? { outputs: [output(["magnifying_power", "angular_magnification", "M"], values.magnifyingPower!, "scalar")] } : null;
  }
  if (lawId === "wavefront_propagation") {
    const speed = given(["speed", "wave_speed", "v"], "speed");
    const time = given(["time", "t"], "time");
    if (speed === null || time === null) return null;
    const values = evaluate({ speed, time });
    return values ? { outputs: [output(["distance", "advance", "displacement", "s"], values.distance!, "length")] } : null;
  }
  if (lawId === "huygens_reflection") {
    const incidentDeg = angle(["incident_angle", "incidence_angle", "i"]);
    if (incidentDeg === null) return null;
    const values = evaluate({ incidentDeg });
    return values ? { outputs: [output(["reflected_angle", "reflection_angle", "r"], values.reflectedDeg!, "angle")] } : null;
  }
  if (lawId === "huygens_refraction") {
    const speed1 = given(["speed1", "speed_1", "v1"], "speed");
    const speed2 = given(["speed2", "speed_2", "v2"], "speed");
    const incidentDeg = angle(["incident_angle", "incidence_angle", "i"]);
    if (speed1 === null || speed2 === null || incidentDeg === null) return null;
    const values = evaluate({ speed1, speed2, incidentDeg });
    return values ? { outputs: [output(["refracted_angle", "refraction_angle", "r"], values.refractedDeg!, "angle")] } : null;
  }
  if (lawId === "ydse_fringe_width") {
    const wavelength = length(["wavelength", "lambda"]);
    const screenDistance = length(["screen_distance", "distance_to_screen", "D"]);
    const slitSeparation = length(["slit_separation", "separation", "d"]);
    const order = scalar(["order", "fringe_order", "n"]) ?? 1;
    if (wavelength === null || screenDistance === null || slitSeparation === null) return null;
    const values = evaluate({ wavelength, screenDistance, slitSeparation, order });
    return values ? { outputs: [
      output(["fringe_width", "beta"], values.fringeWidth!, "length"),
      output(["fringe_position", "position", "y_n"], values.fringePosition!, "length"),
    ] } : null;
  }
  if (lawId === "phase_difference") {
    const pathDifference = length(["path_difference", "delta_x", "Delta"]);
    const wavelength = length(["wavelength", "lambda"]);
    if (pathDifference === null || wavelength === null) return null;
    const values = evaluate({ pathDifference, wavelength });
    return values ? { outputs: [output(["phase_difference", "phase", "phi"], radiansToDegrees(values.phaseDifferenceRad!), "angle")] } : null;
  }
  if (lawId === "single_slit_diffraction") {
    const wavelength = length(["wavelength", "lambda"]);
    const slitWidth = length(["slit_width", "aperture_width", "a"]);
    const screenDistance = length(["screen_distance", "distance_to_screen", "D"]);
    if (wavelength === null || slitWidth === null || screenDistance === null) return null;
    const values = evaluate({ wavelength, slitWidth, screenDistance });
    return values ? { outputs: [
      output(["angular_width", "angularWidth"], radiansToDegrees(values.angularWidthRad!), "angle"),
      output(["central_width", "central_maximum_width", "W"], values.centralWidth!, "length"),
    ] } : null;
  }
  if (lawId === "telescope_resolution") {
    const wavelength = length(["wavelength", "lambda"]);
    const aperture = length(["aperture", "aperture_diameter", "D"]);
    if (wavelength === null || aperture === null) return null;
    const values = evaluate({ wavelength, aperture });
    return values ? { outputs: [
      output(["minimum_angle", "angular_resolution", "theta_min"], radiansToDegrees(values.minimumAngleRad!), "angle"),
      output(["resolving_power", "RP"], values.resolvingPower!, "scalar"),
    ] } : null;
  }
  if (lawId === "microscope_resolution") {
    const wavelength = length(["wavelength", "lambda"]);
    const numericalAperture = scalar(["numerical_aperture", "NA"]);
    if (wavelength === null || numericalAperture === null) return null;
    const values = evaluate({ wavelength, numericalAperture });
    return values ? { outputs: [output(["minimum_distance", "resolution", "d_min"], values.minimumDistance!, "length")] } : null;
  }
  if (lawId === "brewster_law") {
    const n1 = scalar(["n1", "incident_index"]) ?? 1;
    const n2 = scalar(["n2", "refractive_index", "glass_index", "n"]);
    if (n2 === null) return null;
    const values = evaluate({ n1, n2 });
    return values ? { outputs: [output(["brewster_angle", "polarizing_angle", "theta_B"], values.brewsterDeg!, "angle")] } : null;
  }
  if (lawId === "malus_law") {
    const incidentIntensity = scalar(["incident_intensity", "initial_intensity", "I0"]);
    const angleDeg = angle(["angle", "analyzer_angle", "theta"]);
    if (incidentIntensity === null || angleDeg === null) return null;
    const values = evaluate({ incidentIntensity, angleDeg });
    return values ? { outputs: [output(["transmitted_intensity", "intensity", "I"], values.transmittedIntensity!, "scalar")] } : null;
  }
  return null;
}

function correctDerivedQuantity(
  plan: TurnPlanV3,
  lawId: OpticsLawId,
  aliases: string[],
  baseValue: number,
  dimension: Dimension,
): { plan: TurnPlanV3; corrections: OpticsPlanCorrection[] } {
  const unknown = findQuantity(plan.unknowns, aliases);
  const expandedAliases = unknown ? [...aliases, unknown.id, unknown.symbol] : aliases;
  const targets = findOutputQuantities(plan.derived, expandedAliases);
  if (targets.length === 0) return { plan, corrections: [] };
  const corrections: OpticsPlanCorrection[] = [];
  const correctedById = new Map<string, number>();
  for (const target of targets) {
    const correctedValue = fromBaseUnit(baseValue, target.unit, dimension);
    if (approximatelyEqual(target.value, correctedValue)) continue;
    correctedById.set(target.id, correctedValue);
    corrections.push({ lawId, quantityId: target.id, previousValue: target.value, correctedValue });
  }
  if (corrections.length === 0) return { plan, corrections };
  const derived = plan.derived.map((quantity) => {
    const correctedValue = correctedById.get(quantity.id);
    return correctedValue === undefined ? quantity : {
      ...quantity,
      value: correctedValue,
      sign: quantity.sign === undefined || quantity.sign === "unsigned"
        ? quantity.sign
        : correctedValue > 0 ? "positive" as const : correctedValue < 0 ? "negative" as const : "zero" as const,
      sourceText: `Deterministically verified with ${lawId}.`,
    };
  });
  return { plan: { ...plan, derived }, corrections };
}

function findOutputQuantities<T extends { id: string; symbol: string }>(
  quantities: readonly T[],
  aliases: readonly string[],
): T[] {
  const normalizedAliases = aliases.map(normalizeKey).filter(Boolean);
  return quantities.filter((quantity) => {
    if (aliases.some((alias) => quantity.id === alias || quantity.symbol === alias)) return true;
    const keys = [normalizeKey(quantity.id), normalizeKey(quantity.symbol)].filter(Boolean);
    return normalizedAliases.some((alias) => keys.some((key) =>
      key === alias || (alias.length >= 4 && (key.startsWith(alias) || alias.startsWith(key))),
    ));
  });
}

function findQuantity<T extends { id: string; symbol: string }>(
  quantities: readonly T[],
  aliases: readonly string[],
): T | null {
  for (const alias of aliases) {
    const exact = quantities.filter((quantity) => quantity.id === alias || quantity.symbol === alias);
    if (exact.length === 1) return exact[0]!;
  }
  const normalizedAliases = aliases.map(normalizeKey).filter((alias) => alias.length > 0);
  const exactNormalized = quantities.filter((quantity) => {
    const keys = [normalizeKey(quantity.id), normalizeKey(quantity.symbol)].filter(Boolean);
    return normalizedAliases.some((alias) => keys.includes(alias));
  });
  if (exactNormalized.length === 1) return exactNormalized[0]!;
  const descriptiveAliases = normalizedAliases.filter((alias) => alias.length >= 5);
  const descriptive = quantities.filter((quantity) => {
    const keys = [normalizeKey(quantity.id), normalizeKey(quantity.symbol)].filter(Boolean);
    return descriptiveAliases.some((alias) => keys.some((key) => key.includes(alias) || alias.includes(key)));
  });
  return descriptive.length === 1 ? descriptive[0]! : null;
}

function canonicalOpticsLawId(value: string): OpticsLawId[] {
  const normalized = normalizeKey(value);
  if (isOpticsLawId(value)) return [value];
  const matches: Array<[RegExp, OpticsLawId]> = [
    [/sphericalrefraction/, "spherical_refraction"],
    [/snell/, "snell_law"],
    [/lensmaker/, "lens_maker"],
    [/thinlens|lensformula/, "thin_lens_formula"],
    [/mirrorformula/, "mirror_formula"],
    [/criticalangle/, "critical_angle"],
    [/fiberacceptance|fibreacceptance|numericalaperture/, "fiber_acceptance"],
    [/lensesincontact|lenscombination|poweraddition/, "lenses_in_contact"],
    [/lenspower|opticalpower/, "lens_power"],
    [/linearmagnification|magnificationequation/, "linear_magnification"],
    [/prism.*minimum|minimumdeviation/, "prism_minimum_deviation"],
    [/compoundmicroscope/, "compound_microscope"],
    [/astronomicaltelescope|telescopemagnif/, "astronomical_telescope"],
    [/wavefrontpropagation/, "wavefront_propagation"],
    [/huygens.*reflection/, "huygens_reflection"],
    [/huygens.*refraction/, "huygens_refraction"],
    [/ydse|fringewidth|young.*slit|doubleslitinterference/, "ydse_fringe_width"],
    [/phasedifference|coherencecondition/, "phase_difference"],
    [/singleslit|diffractionwidth/, "single_slit_diffraction"],
    [/telescoperesolution|rayleigh.*telescope/, "telescope_resolution"],
    [/microscoperesolution|rayleigh.*microscope/, "microscope_resolution"],
    [/brewster/, "brewster_law"],
    [/malus/, "malus_law"],
  ];
  return matches.filter(([pattern]) => pattern.test(normalized)).map(([, id]) => id);
}

function isPowerQuantity(quantity: TurnPlanQuantityV3): boolean {
  const unit = normalizeUnit(quantity.unit);
  const key = normalizeKey(`${quantity.id} ${quantity.symbol}`);
  return unit === "d" || unit === "dioptre" || unit === "diopter" || /power|^p\d*$/.test(key);
}

function toBaseUnit(value: number, unit: string | undefined, dimension: Dimension): number {
  const normalized = normalizeUnit(unit);
  if (dimension === "length") return value * (LENGTH_TO_METERS[normalized] ?? 1);
  if (dimension === "angle") return normalized === "rad" || normalized === "radian"
    ? value * 180 / Math.PI : value;
  if (dimension === "time") return value * (TIME_TO_SECONDS[normalized] ?? 1);
  if (dimension === "speed") return value * (SPEED_TO_METERS_PER_SECOND[normalized] ?? 1);
  return value;
}

function fromBaseUnit(value: number, unit: string | undefined, dimension: Dimension): number {
  const normalized = normalizeUnit(unit);
  if (dimension === "length") return value / (LENGTH_TO_METERS[normalized] ?? 1);
  if (dimension === "angle") return normalized === "rad" || normalized === "radian"
    ? value * Math.PI / 180 : value;
  return value;
}

const LENGTH_TO_METERS: Record<string, number> = {
  m: 1,
  meter: 1,
  metre: 1,
  cm: 1e-2,
  mm: 1e-3,
  um: 1e-6,
  micrometer: 1e-6,
  micrometre: 1e-6,
  nm: 1e-9,
};
const TIME_TO_SECONDS: Record<string, number> = { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9 };
const SPEED_TO_METERS_PER_SECOND: Record<string, number> = { "m/s": 1, "cm/s": 1e-2, "km/s": 1e3 };

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeUnit(value: string | undefined): string {
  return String(value ?? "1").toLowerCase()
    .replace(/µ|μ/g, "u")
    .replace(/degrees?|deg|°/g, "degree")
    .replace(/\s+/g, "")
    .replace(/metres?/g, "metre")
    .replace(/meters?/g, "meter")
    .replace(/dioptres?/g, "dioptre")
    .replace(/diopters?/g, "diopter");
}

function approximatelyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= Math.max(1e-10, Math.abs(second) * 1e-9);
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}
