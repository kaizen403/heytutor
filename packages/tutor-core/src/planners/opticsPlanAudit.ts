import {
  evaluateOpticsLaw,
  isOpticsLawId,
  type OpticsLawId,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

/**
 * A plan value that disagrees with a recognized optics law under an
 * unambiguously detected sign convention. The audit never rewrites the plan,
 * because a misread configuration (a virtual object read as real) would
 * otherwise overwrite a correct value; turnPlannerV3 rejects the lane instead,
 * so a wrong value is never taught when the ProblemIR solver is unavailable.
 */
export interface OpticsPlanInconsistency {
  lawId: OpticsLawId;
  quantityId: string;
  planValue: number;
  lawValue: number;
}

/** A recognized law the audit refused to evaluate, so the plan value stands unverified. */
export interface OpticsPlanDecline {
  lawId: OpticsLawId;
  reason: string;
}

export interface OpticsPlanAuditResult {
  /** The input plan, returned unchanged: the audit is report only. */
  plan: TurnPlanV3;
  inconsistencies: OpticsPlanInconsistency[];
  checkedLawIds: OpticsLawId[];
  declined: OpticsPlanDecline[];
}

type Dimension = "length" | "angle" | "power" | "time" | "speed" | "scalar";

/**
 * Recompute recognized optics results from plan givens and report any plan
 * value that disagrees. Never changes a plan value. Ambiguous or incomplete
 * laws are declined instead of guessed.
 */
export function reconcileTurnPlanWithOpticsLaws(plan: TurnPlanV3): OpticsPlanAuditResult {
  const lawIds = [...new Set(plan.lawIds.flatMap(canonicalOpticsLawId))];
  if (lawIds.length === 0) return { plan, inconsistencies: [], checkedLawIds: [], declined: [] };

  const inconsistencies: OpticsPlanInconsistency[] = [];
  const checkedLawIds: OpticsLawId[] = [];
  const declined: OpticsPlanDecline[] = [];
  for (const lawId of lawIds) {
    const evaluation = evaluatePlanLaw(plan, lawId);
    if (!evaluation) continue;
    if ("declined" in evaluation) {
      declined.push({ lawId, reason: evaluation.declined });
      continue;
    }
    checkedLawIds.push(lawId);
    for (const output of evaluation.outputs) {
      const result = auditDerivedQuantity(plan, lawId, output);
      inconsistencies.push(...result.inconsistencies);
      declined.push(...result.declined);
    }
  }
  return { plan, inconsistencies, checkedLawIds, declined };
}

interface EvaluatedOutput {
  aliases: string[];
  value: number;
  dimension: Dimension;
  /** The sign depends on the convention; a plan value differing only in sign is a convention clash, not a slip. */
  conventionSigned?: boolean;
}

function evaluatePlanLaw(
  plan: TurnPlanV3,
  lawId: OpticsLawId,
): { outputs: EvaluatedOutput[] } | { declined: string } | null {
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
  const output = (aliases: string[], value: number, dimension: Dimension, conventionSigned = false): EvaluatedOutput =>
    ({ aliases, value, dimension, conventionSigned });

  if (lawId === "mirror_formula" || lawId === "thin_lens_formula") {
    const element = opticalElement(plan, lawId === "mirror_formula" ? "mirror" : "lens");
    const objectQuantity = findQuantity(plan.givens, ["object_distance", "objectdistance", "u"]);
    const focalQuantity = findQuantity(plan.givens, ["focal_length", "focallength", "f"]);
    if (!objectQuantity || !focalQuantity) return null;
    const signs = resolveSignedDistances(plan, element, objectQuantity, focalQuantity);
    if ("reason" in signs) return { declined: signs.reason };
    const values = evaluate(toRealIsPositive(element, signs));
    if (!values) return { declined: "the law has no finite real-object solution for these givens" };
    return { outputs: [
      // A v equal in size and opposite in sign is a convention clash only
      // when the convention is not fixed by signed givens; otherwise it is
      // reported as an inconsistency like any other.
      output(["image_distance", "imagedistance", "v"], imageSideBetweenConventions(element, signs.convention, values.imageDistance!), "length", !signs.fixedByGivens),
      // Magnification is the ratio of image to object height, so it reads the same in both conventions.
      output(["magnification", "m"], values.magnification!, "scalar"),
    ] };
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
    const objectQuantity = findQuantity(plan.givens, ["object_distance", "u"]);
    const imageQuantity = findQuantity(plan.givens, ["image_distance", "v"]);
    if (!objectQuantity || !imageQuantity) return null;
    const objectDistance = Math.abs(toBaseUnit(objectQuantity.value, objectQuantity.unit, "length"));
    const imageDistance = Math.abs(toBaseUnit(imageQuantity.value, imageQuantity.unit, "length"));
    const orientationSign = signedOrientation(plan, objectQuantity, imageQuantity) ?? claimedOrientation(plan);
    if (orientationSign === null) return { declined: "image orientation is not determined by signed distances or an orientation claim" };
    const values = evaluate({ objectDistance, imageDistance, orientationSign });
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
    const objectiveFocalLength = length(["objective_focal_length", "f_o", "fo"]);
    const eyepieceFocalLength = length(["eyepiece_focal_length", "f_e", "fe"]);
    const nearPoint = length(["near_point", "least_distance", "D"]) ?? 0.25;
    const objectDistance = length(["object_distance", "u_o", "uo"], true);
    if (objectDistance !== null && objectiveFocalLength !== null && eyepieceFocalLength !== null) {
      const values = evaluate({ objectDistance, objectiveFocalLength, eyepieceFocalLength, nearPoint });
      return values ? { outputs: [
        output(["tube_length", "L"], values.tubeLength!, "length"),
        output(["magnifying_power", "magnification", "M"], values.magnifyingPower!, "scalar"),
        output(["image_distance", "v_o", "vo"], values.imageDistance!, "length"),
        output(["eyepiece_object_distance", "u_e", "ue"], values.eyepieceObjectDistance!, "length"),
      ] } : null;
    }
    const tubeLength = length(["tube_length", "L"]);
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

function auditDerivedQuantity(
  plan: TurnPlanV3,
  lawId: OpticsLawId,
  { aliases, value: baseValue, dimension, conventionSigned }: EvaluatedOutput,
): { inconsistencies: OpticsPlanInconsistency[]; declined: OpticsPlanDecline[] } {
  const unknown = findQuantity(plan.unknowns, aliases);
  const expandedAliases = unknown ? [...aliases, unknown.id, unknown.symbol] : aliases;
  const targets = findOutputQuantities(plan.derived, expandedAliases);
  const inconsistencies: OpticsPlanInconsistency[] = [];
  const declined: OpticsPlanDecline[] = [];
  for (const target of targets) {
    const signedValue = fromBaseUnit(baseValue, target.unit, dimension);
    // A quantity the plan marks unsigned is a magnitude; compare magnitudes only.
    const lawValue = target.sign === "unsigned" ? Math.abs(signedValue) : signedValue;
    if (matchesWithinStatedPrecision(target.value, lawValue)) continue;
    if (conventionSigned && matchesWithinStatedPrecision(Math.abs(target.value), Math.abs(lawValue))) {
      declined.push({ lawId, reason: `${target.id} matches in size but its sign follows a different convention than the givens` });
      continue;
    }
    inconsistencies.push({ lawId, quantityId: target.id, planValue: target.value, lawValue });
  }
  return { inconsistencies, declined };
}

type SignConvention = "cartesian" | "real_is_positive";

interface OpticalElement {
  kind: "mirror" | "lens";
  /** True for concave mirrors and converging lenses, false for convex mirrors and diverging lenses, null when unstated. */
  converging: boolean | null;
}

interface SignedDistances {
  convention: SignConvention;
  /**
   * A given carries the sign that fixed the convention (a negative distance,
   * or a declared positive/negative sign), so it is not a magnitude read one
   * way or the other.
   */
  fixedByGivens: boolean;
  /** Signed object distance in metres, in the plan's own convention. */
  objectDistance: number;
  /** Signed focal length in metres, in the plan's own convention. */
  focalLength: number | null;
}

interface SignedLength {
  value: number;
  magnitudeOnly: boolean;
}

/**
 * Read the element from the question: the law fixes mirror or lens, the stem
 * fixes concave/convex. A stem naming both types leaves the type unknown.
 */
function opticalElement(plan: TurnPlanV3, kind: OpticalElement["kind"]): OpticalElement {
  const text = plan.question.toLowerCase();
  const converging = kind === "mirror"
    ? /(?:concave|converging)(?:\s+[a-z]+)?\s+mirror/.test(text)
    : /(?:convex|converging)(?:\s+[a-z]+)?\s+lens/.test(text);
  const diverging = kind === "mirror"
    ? /(?:convex|diverging)(?:\s+[a-z]+)?\s+mirror/.test(text)
    : /(?:concave|diverging)(?:\s+[a-z]+)?\s+lens/.test(text);
  return { kind, converging: converging === diverging ? null : converging };
}

/**
 * Decide which sign convention the plan's own distances use, and return them
 * signed in that convention. Evidence: a stated convention, the sign of a real
 * object's distance (negative only in Cartesian), and for a mirror of known type
 * the sign of f (a concave mirror has negative f only in Cartesian). Any
 * disagreement, or no evidence at all, declines instead of guessing.
 */
function resolveSignedDistances(
  plan: TurnPlanV3,
  element: OpticalElement,
  objectQuantity: TurnPlanQuantityV3,
  focalQuantity: TurnPlanQuantityV3 | null,
): SignedDistances | { reason: string } {
  const objectReason = realObjectDeclineReason(plan);
  if (objectReason) return { reason: objectReason };
  const object = signedLength(objectQuantity);
  const focal = focalQuantity ? signedLength(focalQuantity) : null;
  if (!object || (focalQuantity && !focal)) return { reason: "a distance contradicts its own sign marker" };
  if (object.value === 0) return { reason: "object distance is zero" };

  const votes = new Set<SignConvention>();
  const declared = declaredConvention(plan);
  if (declared === "conflict") return { reason: "the plan states both Cartesian and real-is-positive conventions" };
  if (declared) votes.add(declared);
  if (!object.magnitudeOnly) votes.add(object.value < 0 ? "cartesian" : "real_is_positive");
  if (focal && !focal.magnitudeOnly && element.converging !== null) {
    if (element.kind === "mirror") {
      votes.add((focal.value < 0) === element.converging ? "cartesian" : "real_is_positive");
    } else if ((focal.value > 0) !== element.converging) {
      return { reason: "focal length sign contradicts the stated lens type" };
    }
  }
  if (votes.size === 0) return { reason: "no signed distance or stated convention fixes the sign convention" };
  if (votes.size > 1) return { reason: "the plan mixes Cartesian and real-is-positive signs" };
  const convention = [...votes][0]!;
  const explicitlySigned = (quantity: TurnPlanQuantityV3, length: SignedLength) =>
    !length.magnitudeOnly && (length.value < 0 || quantity.sign === "positive" || quantity.sign === "negative");
  const fixedByGivens = explicitlySigned(objectQuantity, object) ||
    Boolean(focal && focalQuantity && element.kind === "mirror" && element.converging !== null &&
      explicitlySigned(focalQuantity, focal));

  const objectDistance = object.magnitudeOnly && convention === "cartesian" ? -object.value : object.value;
  if (!focal) return { convention, fixedByGivens, objectDistance, focalLength: null };
  if (!focal.magnitudeOnly) return { convention, fixedByGivens, objectDistance, focalLength: focal.value };
  if (element.converging === null) return { reason: "focal length is a magnitude and the element type is unstated" };
  // Converging lenses have positive f in both conventions; mirrors flip with the convention.
  const positive = element.kind === "lens" || convention === "real_is_positive" ? element.converging : !element.converging;
  return { convention, fixedByGivens, objectDistance, focalLength: positive ? focal.value : -focal.value };
}

/**
 * Light aimed at a point the element interrupts, an image used as the next
 * element's object, or an object the stem calls virtual. Converging or
 * meeting light is judged clause by clause in convergenceMayBeVirtualObject.
 */
const VIRTUAL_OBJECT_CUE = new RegExp([
  String.raw`\bvirtual\s+object`,
  String.raw`\b(?:directed|aimed|heading|incident)\s+(?:at|to|towards?)\s+(?:a|the)\s+point\b`,
  String.raw`\b(?:acts?|serves?|behaves?|treated|used)\s+as\s+(?:an?\s+|the\s+)?(?:\w+\s+)?object\b`,
  // An object placed behind, beyond or past the element sits where light leaves it: a virtual object.
  String.raw`\bobject\s+(?:(?:is|lies|sits|stands|placed|located|situated|kept|positioned)\s+)*(?:at\s+)?(?:a\s+(?:point|distance)\s+(?:of\s+)?)?(?:\d+(?:\.\d+)?\s*(?:cm|mm|m)\s+)?(?:behind|beyond|past)\b`,
  // The same placement worded by side: "the object is on the far side of the lens".
  String.raw`\bobject\b[^.;]{0,80}?\bon\s+(?:the|its)\s+(?:far|other|opposite)\s+side\b`,
].join("|"), "i");

/**
 * Rays that converge or meet. "Converging" naming the element itself (a
 * converging lens) describes no light.
 */
const CONVERGING_LIGHT =
  /\bconverg(?:e|es|ed|ing|ence|ent)\b(?!\s+(?:[a-z-]+\s+)?(?:lens|lenses|mirror|mirrors)\b)|\b(?:meet|meets|met|meeting|intersect|intersects|intersecting|cross|crosses|crossing)\b/i;

/**
 * Converging light that has not yet reached the element: an incident beam,
 * light that "would" meet, or light heading for a point behind or beyond
 * the element. That point is a virtual object.
 */
const INCIDENT_LIGHT = new RegExp([
  String.raw`\b(?:incident|incoming|falls?\s+on|falling\s+on|strikes?|striking|impinges?|impinging)\b`,
  String.raw`\bwould\b`,
  String.raw`\bbefore\s+(?:it\s+|they\s+)?(?:reach|reaches|reaching|strikes?|striking|hits?|hitting|meets?|meeting)\b`,
  String.raw`\b(?:if|when)\s+the\s+(?:lens|mirror)\s+(?:is|were|was)\s+(?:absent|removed|not)\b`,
  String.raw`\bin\s+the\s+absence\b`,
  String.raw`\b(?:behind|beyond|past)\b`,
  String.raw`\btowards?\s+(?:a|the|some)\s+point\b`,
  String.raw`\bvirtual\b`,
].join("|"), "i");

/**
 * Light after the element, or the image it forms: "the reflected rays meet",
 * "the rays converge after refraction", "converge to form the image".
 */
const OUTGOING_LIGHT = new RegExp([
  String.raw`\b(?:reflected|refracted|emergent|emerging|emerge|emerges|transmitted)\b`,
  String.raw`\b(?:after|on|upon|following)\s+(?:the\s+)?(?:reflection|refraction|reflecting|refracting|passing)\b`,
  String.raw`\bto\s+form\s+(?:a|an|the|its)\s+(?:[a-z]+\s+)?image\b`,
  String.raw`\bform(?:s|ing)?\s+(?:a|an|the|its)\s+(?:[a-z]+\s+)?image\b`,
  String.raw`\bimage\s+(?:is\s+)?formed\b`,
].join("|"), "i");

/** Clause boundaries: punctuation and the conjunctions that join clauses. */
const LIGHT_CLAUSE_BOUNDARY = /[,;:!?]|\.(?:\s|$)|\b(?:and|but|then|while|whereas)\b/i;

/**
 * Converging or meeting light may describe a virtual object. A clause about
 * light after the element or about the image it forms is not one; a clause
 * about incident light is, and a clause that says neither, or both, stays a
 * possible virtual object.
 */
function convergenceMayBeVirtualObject(text: string): boolean {
  return text.split(LIGHT_CLAUSE_BOUNDARY).some((clause) =>
    CONVERGING_LIGHT.test(clause) && !(OUTGOING_LIGHT.test(clause) && !INCIDENT_LIGHT.test(clause)));
}

/** More than one element: a later element's object may be virtual. */
const MULTIPLE_ELEMENT_CUE =
  /\b(?:lenses|mirrors|combination|system)\b|\b(?:first|second|third|another|other)\s+(?:[a-z-]+\s+)?(?:lens|mirror)\b/i;

/** Something physical placed before the element: the stem's evidence of a real object. */
const REAL_OBJECT_CUE =
  /\b(?:object|candle|pin|needle|flame|bulb|lamp|arrow|source|filament|person|man|woman|boy|girl|child|face|tree|building|tower|coin|insect|bird|fish|toy|card|pencil|rod|stick|matchstick)\b/i;

/**
 * The real-is-positive evaluator takes a real object, and a real object's
 * distance sign is the evidence that fixes the convention. A virtual object
 * flips that sign, so the audit declines unless the question establishes a
 * single element with a real object in front of it: anything else could be a
 * virtual object, and a reported inconsistency would then be wrong.
 */
function realObjectDeclineReason(plan: TurnPlanV3): string | null {
  const planText = [
    plan.question,
    ...plan.assumptions,
    ...plan.qualitativeClaims.flatMap((claim) => [claim.claim, typeof claim.expected === "string" ? claim.expected : ""]),
  ].join(" ");
  if (VIRTUAL_OBJECT_CUE.test(planText) || convergenceMayBeVirtualObject(planText)) {
    return "the object may be virtual, which reverses the object distance sign, so it cannot fix the convention";
  }
  const question = plan.question.toLowerCase();
  if (MULTIPLE_ELEMENT_CUE.test(question) || (/\blens\b/.test(question) && /\bmirror\b/.test(question))) {
    return "more than one optical element: a later element's object may be virtual";
  }
  if (!REAL_OBJECT_CUE.test(question)) {
    return "the question does not establish a real object in front of the element";
  }
  return null;
}

function signedLength(quantity: TurnPlanQuantityV3): SignedLength | null {
  const value = toBaseUnit(quantity.value, quantity.unit, "length");
  if (quantity.sign === "unsigned") return { value: Math.abs(value), magnitudeOnly: true };
  if ((quantity.sign === "positive" && value < 0) || (quantity.sign === "negative" && value > 0)) return null;
  return { value, magnitudeOnly: false };
}

function declaredConvention(plan: TurnPlanV3): SignConvention | "conflict" | null {
  const text = [
    ...plan.lawIds,
    ...plan.assumptions,
    ...plan.qualitativeClaims.flatMap((claim) => [claim.claim, typeof claim.expected === "string" ? claim.expected : ""]),
  ].join(" ");
  const cartesian = /cartesian/i.test(text);
  const realIsPositive = /real[\s_-]*is[\s_-]*positive/i.test(text);
  if (cartesian && realIsPositive) return "conflict";
  return cartesian ? "cartesian" : realIsPositive ? "real_is_positive" : null;
}

/**
 * The scene engine evaluates mirror and lens laws real-is-positive. Cartesian
 * object distances flip sign; a Cartesian mirror also flips f and v, while a
 * lens keeps them (both conventions put a converging f and a real image positive).
 */
function toRealIsPositive(element: OpticalElement, distances: SignedDistances): { objectDistance: number; focalLength: number } {
  const cartesian = distances.convention === "cartesian";
  return {
    objectDistance: cartesian ? -distances.objectDistance : distances.objectDistance,
    focalLength: imageSideBetweenConventions(element, distances.convention, distances.focalLength ?? Number.NaN),
  };
}

/** Self inverse: converts an image side length (v or f) either way between the plan convention and real-is-positive. */
function imageSideBetweenConventions(element: OpticalElement, convention: SignConvention, value: number): number {
  return convention === "cartesian" && element.kind === "mirror" ? -value : value;
}

/** Orientation from signed u and v when the plan names exactly one element type and its convention is clear. */
function signedOrientation(
  plan: TurnPlanV3,
  objectQuantity: TurnPlanQuantityV3,
  imageQuantity: TurnPlanQuantityV3,
): 1 | -1 | null {
  const mentionsMirror = /mirror/i.test(plan.question);
  const mentionsLens = /\blens/i.test(plan.question);
  if (mentionsMirror === mentionsLens) return null;
  const element = opticalElement(plan, mentionsMirror ? "mirror" : "lens");
  const focalQuantity = findQuantity(plan.givens, ["focal_length", "focallength", "f"]);
  const distances = resolveSignedDistances(plan, element, objectQuantity, focalQuantity);
  const image = signedLength(imageQuantity);
  if ("reason" in distances || !image || image.magnitudeOnly || image.value === 0) return null;
  const objectRealPositive = distances.convention === "cartesian" ? -distances.objectDistance : distances.objectDistance;
  const imageRealPositive = imageSideBetweenConventions(element, distances.convention, image.value);
  return -imageRealPositive / objectRealPositive < 0 ? -1 : 1;
}

/** Orientation from explicit claims; none, or claims that disagree, give null. */
function claimedOrientation(plan: TurnPlanV3): 1 | -1 | null {
  let orientation: 1 | -1 | null = null;
  for (const claim of plan.qualitativeClaims) {
    const holds = claim.expected !== false;
    const notInverted = /\b(?:not\s+inverted|non-?inverted)\b/i.test(claim.claim);
    const inverted = !notInverted && /\b(?:inverted|upside[\s-]*down)\b/i.test(claim.claim);
    const erect = notInverted || /\b(?:erect|upright)\b/i.test(claim.claim);
    if (inverted === erect) continue;
    const sign: 1 | -1 = inverted === holds ? -1 : 1;
    if (orientation !== null && orientation !== sign) return null;
    orientation = sign;
  }
  return orientation;
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
      key === alias && (alias.length >= 4 || normalizeKey(quantity.id) === alias) ||
      (alias.length >= 4 && key.length >= 4 && (key.startsWith(alias) || alias.startsWith(key))),
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
    const keys = [normalizeKey(quantity.id), normalizeKey(quantity.symbol)].filter((key) => key.length >= 5);
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
    [/thinlens|lensformula|lensequation/, "thin_lens_formula"],
    [/mirrorformula|mirrorequation/, "mirror_formula"],
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

/**
 * A reported mismatch rejects the planner lane, so a plan value rounded to the
 * precision it states must still match: 6.67 matches 6.6667 and 12.0 matches 12.
 * The tolerance is half a unit in the plan value's last stated decimal place,
 * capped at 2% of the law value so an integer such as 4 cannot absorb 4.4, with
 * a floor of 0.5% for values stated to more places than the law supports.
 * A value only written with an exponent (2e-7) is stated in significant
 * figures, so its cap is 5%: 2e-7 matches 1.952e-7.
 */
function matchesWithinStatedPrecision(planValue: number, lawValue: number): boolean {
  const scale = Math.abs(lawValue);
  const halfLastPlace = 0.5 * 10 ** -statedDecimalPlaces(planValue);
  const cap = /e/i.test(String(planValue)) ? 0.05 : 0.02;
  const tolerance = Math.max(1e-10, scale * 0.005, Math.min(halfLastPlace, scale * cap));
  return Math.abs(planValue - lawValue) <= tolerance * (1 + 1e-9);
}

function statedDecimalPlaces(value: number): number {
  const [mantissa, exponent] = Math.abs(value).toString().toLowerCase().split("e");
  const fraction = mantissa?.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent ?? 0));
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}
