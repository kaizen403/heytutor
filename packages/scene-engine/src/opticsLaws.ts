/**
 * Deterministic scalar laws used to audit optics lesson plans.
 *
 * These are executable physics relationships, not drawing templates. The same
 * law can support many questions and any scene representation that cites it.
 * Length inputs use one consistent unit within each law unless the key names a
 * concrete SI unit. Angles enter and leave in degrees.
 */

export const OPTICS_LAW_IDS = [
  "mirror_formula",
  "snell_law",
  "spherical_refraction",
  "thin_lens_formula",
  "lens_maker",
  "critical_angle",
  "fiber_acceptance",
  "lens_power",
  "linear_magnification",
  "lenses_in_contact",
  "prism_minimum_deviation",
  "compound_microscope",
  "astronomical_telescope",
  "wavefront_propagation",
  "huygens_reflection",
  "huygens_refraction",
  "ydse_fringe_width",
  "phase_difference",
  "single_slit_diffraction",
  "telescope_resolution",
  "microscope_resolution",
  "brewster_law",
  "malus_law",
] as const;

export type OpticsLawId = (typeof OPTICS_LAW_IDS)[number];

export const OPTICS_VISUAL_FAMILIES = new Set([
  "ray_path",
  "axis_view",
  "interface",
  "instrument_chain",
  "wavefront",
  "aperture",
  "screen_pattern",
  "transverse_field",
  "polarizer",
] as const);

const OPTICS_LAW_ID_SET = new Set<string>(OPTICS_LAW_IDS);

export function isOpticsLawId(value: unknown): value is OpticsLawId {
  return typeof value === "string" && OPTICS_LAW_ID_SET.has(value);
}

export function evaluateOpticsLaw(
  lawId: OpticsLawId,
  rawInputs: Record<string, unknown>,
): Record<string, number> {
  const input = (key: string): number => finiteNumber(rawInputs[key], key);
  switch (lawId) {
    case "mirror_formula": {
      const u = positive(input("objectDistance"), "objectDistance");
      const f = nonzero(input("focalLength"), "focalLength");
      const denominator = u - f;
      requireNonzero(denominator, "object lies at the focal point, so the image is at infinity");
      const v = f * u / denominator;
      return { imageDistance: v, magnification: -v / u };
    }
    case "snell_law": {
      const n1 = positive(input("n1"), "n1");
      const n2 = positive(input("n2"), "n2");
      const incident = degreesToRadians(input("incidentDeg"));
      return { refractedDeg: radiansToDegrees(safeAsin(n1 * Math.sin(incident) / n2, "Snell law")) };
    }
    case "spherical_refraction": {
      const n1 = positive(input("n1"), "n1");
      const n2 = positive(input("n2"), "n2");
      const u = nonzero(input("objectDistance"), "objectDistance");
      const radius = nonzero(input("radius"), "radius");
      const reciprocalV = ((n2 - n1) / radius + n1 / u) / n2;
      requireNonzero(reciprocalV, "spherical refraction produces an image at infinity");
      return { imageDistance: 1 / reciprocalV };
    }
    case "thin_lens_formula": {
      const u = positive(input("objectDistance"), "objectDistance");
      const f = nonzero(input("focalLength"), "focalLength");
      const denominator = u - f;
      requireNonzero(denominator, "object lies at the focal point, so the image is at infinity");
      const v = f * u / denominator;
      return { imageDistance: v, magnification: -v / u };
    }
    case "lens_maker": {
      const lensIndex = positive(input("lensIndex"), "lensIndex");
      const mediumIndex = positive(input("mediumIndex"), "mediumIndex");
      const radius1 = nonzero(input("radius1"), "radius1");
      const radius2 = nonzero(input("radius2"), "radius2");
      const power = (lensIndex / mediumIndex - 1) * (1 / radius1 - 1 / radius2);
      requireNonzero(power, "lens maker power is zero");
      return { focalLength: 1 / power, power };
    }
    case "critical_angle": {
      const dense = positive(input("denseIndex"), "denseIndex");
      const rare = positive(input("rareIndex"), "rareIndex");
      if (!(dense > rare)) throw new Error("critical_angle requires denseIndex > rareIndex");
      return { criticalDeg: radiansToDegrees(Math.asin(rare / dense)) };
    }
    case "fiber_acceptance": {
      const core = positive(input("coreIndex"), "coreIndex");
      const cladding = positive(input("claddingIndex"), "claddingIndex");
      const outside = positive(input("outsideIndex"), "outsideIndex");
      if (!(core > cladding)) throw new Error("fiber_acceptance requires coreIndex > claddingIndex");
      const numericalAperture = Math.sqrt(core ** 2 - cladding ** 2);
      return {
        numericalAperture,
        acceptanceDeg: radiansToDegrees(safeAsin(numericalAperture / outside, "fiber acceptance")),
      };
    }
    case "lens_power": {
      const focalLength = nonzero(input("focalLengthMeters"), "focalLengthMeters");
      return { power: 1 / focalLength };
    }
    case "linear_magnification": {
      const u = positive(input("objectDistance"), "objectDistance");
      const v = positive(input("imageDistance"), "imageDistance");
      const sign = input("orientationSign");
      if (sign !== 1 && sign !== -1) throw new Error("orientationSign must be +1 or -1");
      return { magnification: sign * v / u };
    }
    case "lenses_in_contact": {
      const values = rawInputs.powers;
      if (!Array.isArray(values) || values.length === 0) throw new Error("powers must be a non-empty array");
      const power = values.reduce<number>((sum, value, index) =>
        sum + finiteNumber(value, `powers[${index}]`), 0);
      requireNonzero(power, "equivalent lens power is zero");
      return { power, focalLength: 1 / power };
    }
    case "prism_minimum_deviation": {
      const refractiveIndex = positive(input("refractiveIndex"), "refractiveIndex");
      const apexDeg = input("apexDeg");
      if (!(apexDeg > 0 && apexDeg < 180)) throw new Error("apexDeg must be between 0 and 180");
      const halfApex = degreesToRadians(apexDeg / 2);
      const incidenceDeg = radiansToDegrees(safeAsin(
        refractiveIndex * Math.sin(halfApex),
        "prism minimum deviation",
      ));
      return {
        minimumDeviationDeg: 2 * incidenceDeg - apexDeg,
        incidenceDeg,
        refractionDeg: apexDeg / 2,
        emergenceDeg: incidenceDeg,
      };
    }
    case "compound_microscope": {
      const tubeLength = positive(input("tubeLength"), "tubeLength");
      const objectiveFocalLength = positive(input("objectiveFocalLength"), "objectiveFocalLength");
      const eyepieceFocalLength = positive(input("eyepieceFocalLength"), "eyepieceFocalLength");
      const nearPoint = positive(input("nearPoint"), "nearPoint");
      return { magnifyingPower: tubeLength * nearPoint / (objectiveFocalLength * eyepieceFocalLength) };
    }
    case "astronomical_telescope": {
      const objective = positive(input("objectiveFocalLength"), "objectiveFocalLength");
      const eyepiece = positive(input("eyepieceFocalLength"), "eyepieceFocalLength");
      return { magnifyingPower: objective / eyepiece };
    }
    case "wavefront_propagation": {
      return {
        distance: positive(input("speed"), "speed") * nonnegative(input("time"), "time"),
      };
    }
    case "huygens_reflection": {
      const incidentDeg = boundedAngle(input("incidentDeg"), "incidentDeg");
      return { reflectedDeg: incidentDeg };
    }
    case "huygens_refraction": {
      const speed1 = positive(input("speed1"), "speed1");
      const speed2 = positive(input("speed2"), "speed2");
      const incident = degreesToRadians(boundedAngle(input("incidentDeg"), "incidentDeg"));
      return { refractedDeg: radiansToDegrees(safeAsin(speed2 * Math.sin(incident) / speed1, "Huygens refraction")) };
    }
    case "ydse_fringe_width": {
      const wavelength = positive(input("wavelength"), "wavelength");
      const distance = positive(input("screenDistance"), "screenDistance");
      const separation = positive(input("slitSeparation"), "slitSeparation");
      const order = input("order");
      const fringeWidth = wavelength * distance / separation;
      return { fringeWidth, fringePosition: order * fringeWidth };
    }
    case "phase_difference": {
      const pathDifference = input("pathDifference");
      const wavelength = positive(input("wavelength"), "wavelength");
      return { phaseDifferenceRad: 2 * Math.PI * pathDifference / wavelength };
    }
    case "single_slit_diffraction": {
      const wavelength = positive(input("wavelength"), "wavelength");
      const width = positive(input("slitWidth"), "slitWidth");
      const distance = positive(input("screenDistance"), "screenDistance");
      const angularWidthRad = 2 * wavelength / width;
      return { angularWidthRad, centralWidth: distance * angularWidthRad };
    }
    case "telescope_resolution": {
      const wavelength = positive(input("wavelength"), "wavelength");
      const aperture = positive(input("aperture"), "aperture");
      const minimumAngleRad = 1.22 * wavelength / aperture;
      return { minimumAngleRad, resolvingPower: 1 / minimumAngleRad };
    }
    case "microscope_resolution": {
      const wavelength = positive(input("wavelength"), "wavelength");
      const numericalAperture = positive(input("numericalAperture"), "numericalAperture");
      return { minimumDistance: 0.61 * wavelength / numericalAperture };
    }
    case "brewster_law": {
      const n1 = positive(input("n1"), "n1");
      const n2 = positive(input("n2"), "n2");
      return { brewsterDeg: radiansToDegrees(Math.atan(n2 / n1)) };
    }
    case "malus_law": {
      const intensity = nonnegative(input("incidentIntensity"), "incidentIntensity");
      const angle = degreesToRadians(input("angleDeg"));
      return { transmittedIntensity: intensity * Math.cos(angle) ** 2 };
    }
  }
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function positive(value: number, name: string): number {
  if (!(value > 0)) throw new Error(`${name} must be positive`);
  return value;
}

function nonnegative(value: number, name: string): number {
  if (value < 0) throw new Error(`${name} must be nonnegative`);
  return value;
}

function nonzero(value: number, name: string): number {
  requireNonzero(value, `${name} must be nonzero`);
  return value;
}

function requireNonzero(value: number, message: string): void {
  if (Math.abs(value) <= 1e-15) throw new Error(message);
}

function boundedAngle(value: number, name: string): number {
  if (!(value >= 0 && value < 90)) throw new Error(`${name} must be in [0, 90) degrees`);
  return value;
}

function safeAsin(value: number, name: string): number {
  if (value < -1 - 1e-12 || value > 1 + 1e-12) {
    throw new Error(`${name} has no transmitted real-angle solution`);
  }
  return Math.asin(Math.max(-1, Math.min(1, value)));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}
