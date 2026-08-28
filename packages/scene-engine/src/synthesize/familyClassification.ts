/**
 * Family-program seam — the ONE home of scene visual family classification.
 *
 * Ownership rule (diagram-engine-priority P0): the live family decision is
 * driven by ProblemIR / TurnPlan structure whenever that structure is
 * available. The English stem patterns in this file are a documented TEST
 * ORACLE and the fallback catalog when no ProblemIR exists; they must not be
 * grown as the live coverage mechanism, and structure-derived families win
 * over the English overrides.
 *
 * Both `@heytutor/scene-engine` (familyScene synthesis) and
 * `@heytutor/tutor-core` (sceneCapabilities planner hints) import from here so
 * the two paths can never drift apart.
 */

export const SCENE_VISUAL_FAMILIES = [
  "ray_path",
  "axis_view",
  "interface",
  "instrument_chain",
  "wavefront",
  "aperture",
  "screen_pattern",
  "transverse_field",
  "polarizer",
  "contact_body",
  "circuit_network",
  "state_plot",
  "analytic_curve",
  "bounded_region",
  "solid_figure",
  "fluid_apparatus",
  "point_field",
  "energy_level",
  "coordinate_figure",
  "vector_diagram",
] as const;

export type SceneVisualFamily = (typeof SCENE_VISUAL_FAMILIES)[number];

const SCENE_VISUAL_FAMILY_SET = new Set<string>(SCENE_VISUAL_FAMILIES);

export function isSceneVisualFamily(value: string): value is SceneVisualFamily {
  return SCENE_VISUAL_FAMILY_SET.has(value);
}

/**
 * The structural slice of problem-ir/v1 that family routing reads. Kept as a
 * loose view so callers can pass the validated ProblemIR directly.
 */
export interface ProblemStructureView {
  entities?: ReadonlyArray<{ kind?: string; label?: string }>;
  representationIntents?: ReadonlyArray<{ kind?: string }>;
  constraints?: ReadonlyArray<{ kind?: string; entityIds?: readonly string[] }>;
  facts?: ReadonlyArray<{ kind?: string; statement?: string }>;
}

export function normalizeStem(question: string): string {
  return question
    .replace(/[–—−]/g, "-")
    .replace(/[³]/g, "^3")
    .replace(/[²]/g, "^2")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------------- */
/* English stem classifiers (test oracle / no-ProblemIR fallback).           */
/* ------------------------------------------------------------------------- */

export function isFigureAbsentStem(stem: string): boolean {
  return /\b(?:shown in the figure|as shown in the figure|the figure shows|figure shows|shaded region of the circle given below|circle given below)\b/i.test(stem)
    || /(?:given below|as shown below).{0,80}(?:shaded|figure)/i.test(stem);
}

export function isNamedVariationPlotStem(stem: string): boolean {
  if (isFigureAbsentStem(stem)) return false;
  return /(?:draw a graph showing variation|graph showing variation of|variation of .{1,120} as a function of)/i.test(stem);
}

export function isParallelPlateStem(stem: string): boolean {
  return /(?:parallel[- ]plate capacitor|metal sheets?.{0,80}parallel|kept parallel to each other|electrically conducting walls|horizontal metal plates)/i.test(stem);
}

export function isHangingWiresLoadStem(stem: string): boolean {
  return /(?:upper wire|breaking stress)/i.test(stem) && /(?:lower wire|\bpan\b)/i.test(stem);
}

export function isRiverBoatStem(stem: string): boolean {
  if (/(?:rain falls|umbrella)/i.test(stem)) return false;
  const boat = /(?:\bboat\b|still water)/i.test(stem);
  const stream = /(?:\briver\b|\bcurrent\b|downstream|upstream|still water)/i.test(stem);
  return boat && stream;
}

export function isPlanarConicStem(stem: string): boolean {
  return /(?:\bhyperbola\b|\bellipse\b|\bparabola\b|\blatus rect(?:um)?\b|\blatus ractum\b|\bfocal distances?\b|\bfoci\b|\bdirectrix\b|transverse (?:and conjugate )?ax[ei]s|conjugate ax[ei]s)/i.test(stem);
}

export function isCircleLocusStem(stem: string): boolean {
  return /(?:locus of (?:the )?(?:point|[A-Z]\b)|circles? with variable diameter)/i.test(stem)
    && /(?:circle|touch)/i.test(stem);
}

export function isSpaceGeometryStem(stem: string): boolean {
  if (isPlanarConicStem(stem)) return false;
  return /(?:shortest distance between (?:the )?lines|skew lines|vector equation(?:s)? of (?:the )?(?:line|plane|lines)|cartesian equation of the (?:line|plane)|equation of the plane|angle between (?:the )?(?:two )?planes|in vector form|direction (?:cosines?|ratios?)|non-coplanar|passes through the point\s*\(\s*-?\d[^)]*,[^)]*,)/i.test(stem)
    || /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+/.test(stem);
}

export function isRelatedRateCircleStem(stem: string): boolean {
  return /(?:radius of (?:the |a )?circle|circumference of (?:the |a )?circle|area of (?:the |a )?circle).{0,120}(?:increas|decreas|rate)|rate of (?:increase|change) of (?:its )?(?:circumference|area)|rectangles inscribed in a (?:given )?(?:fixed )?circle/i.test(stem);
}

export function isRelatedRateTriangleStem(stem: string): boolean {
  return /(?:median of an equilateral triangle|equilateral triangle.{0,80}(?:increas|rate))/i.test(stem);
}

export function isRelatedRateSolidStem(stem: string): boolean {
  return /(?:variable cube|edge of a (?:variable )?cube|cube increases)/i.test(stem);
}

export function isBoundedRegionStem(stem: string): boolean {
  return /(?:area (?:of the region |enclosed by|bounded by)|using integration.{0,80}area|region bounded by the curve)/i.test(stem);
}

export function isCurrentSegmentFieldStem(stem: string): boolean {
  return /(?:straight segment of a conductor|magnetic field due to this segment)/i.test(stem);
}

export function isSemiconductorBandStem(stem: string): boolean {
  return /(?:energy band|valence band|conduction band|(?:n-type|p-type)|intrinsic semiconductor)/i.test(stem);
}

export function isIvCharacteristicStem(stem: string): boolean {
  return /(?:transfer characteristic|i[-–]?v characteristic|characteristic curve)/i.test(stem);
}

export function isDeviceCircuitStem(stem: string): boolean {
  return /(?:rectifier|zener|(?:p-n|pn) junction diode|nand|nor gate|logic gate|with (?:a )?battery)/i.test(stem)
    && !isSemiconductorBandStem(stem)
    && !/(?:depletion.{0,4}region|solar cell|photodiode)/i.test(stem)
    && !isIvCharacteristicStem(stem);
}

export function isJunctionSpatialStem(stem: string): boolean {
  if (isDeviceCircuitStem(stem)) return false;
  return /(?:depletion.{0,4}region|solar cell|photodiode|light emitting|\bled\b|(?:p-n|pn) junction)/i.test(stem);
}

/** Kirchhoff-style multi-loop wording; structure twin is circuitTopologyFromProblemStructure. */
export function isTwoLoopNetworkStem(question: string): boolean {
  return /(?:kirchhoff|kvl|kcl|loop law|junction law)/i.test(normalizeStem(question));
}

export type RiverBoatVariant = "along_stream" | "two_triangles" | "crossing";

/** English variant oracle; the live variant comes from riverBoatVariantFromProblemStructure when ProblemIR exists. */
export function riverBoatVariant(stem: string): RiverBoatVariant {
  if (
    /(?:two velocity triangles|draw the two velocity triangles)/i.test(stem)
    || (/(?:straight across|resultant is straight)/i.test(stem) && /shortest/i.test(stem))
  ) {
    return "two_triangles";
  }
  if (/(?:cross(?:es|ing)?|\bwide river\b|width of the river|heading|straight across|to the direction of (?:the )?river)/i.test(stem)) {
    return "crossing";
  }
  return "along_stream";
}

/* ------------------------------------------------------------------------- */
/* English family tables (test oracle / no-ProblemIR fallback).              */
/* ------------------------------------------------------------------------- */

export const LAW_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
  [/mirror|thin.?lens|lens.?maker|magnification|lens.?power|lenses?.?in.?contact/i, ["axis_view", "ray_path"]],
  [/snell|spherical.?refraction|critical.?angle|fiber.?acceptance|prism/i, ["interface", "ray_path"]],
  [/microscope|telescope/i, ["instrument_chain", "axis_view", "ray_path"]],
  [/wavefront|huygens/i, ["wavefront", "ray_path", "interface"]],
  [/ydse|fringe.?width|phase.?difference/i, ["aperture", "ray_path", "screen_pattern"]],
  [/single.?slit|diffraction/i, ["aperture", "wavefront", "ray_path", "screen_pattern"]],
  [/resolution|resolving/i, ["aperture", "screen_pattern", "instrument_chain"]],
  [/brewster/i, ["ray_path", "interface", "polarizer"]],
  [/malus|polari[sz]/i, ["transverse_field", "polarizer"]],
  [/newton|friction|tension|pulley|free.?body|hooke|torque|angular.?momentum|moment of inertia|rigid.?body|suvat|equations of motion/i, ["contact_body"]],
  [/work.?energy|conservation of mechanical energy/i, ["contact_body"]],
  [/kirchhoff|ohm|wheatstone|lcr|rlc|ac.?circuit/i, ["circuit_network"]],
  [/first.?law|thermodynamic|ideal.?gas|indicator.?diagram/i, ["state_plot"]],
  [/coulomb|gauss|biot|ampere|lorentz/i, ["point_field"]],
  [/bernoulli|continuity.?equation|pascal/i, ["fluid_apparatus"]],
  [/photoelectric|bohr|rydberg/i, ["energy_level"]],
];

export const QUESTION_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
  [/(?:mirror|lens|magnification|optical power|focal point|principal axis)/i, ["axis_view", "ray_path"]],
  [/(?:refraction|refracted|critical angle|total internal reflection|optical fibre|optical fiber|prism|brewster)/i, ["interface", "ray_path"]],
  [/(?:spherical (?:air|refracting|surface|interface)|air-glass interface|paraxial image|center of curvature|surface[- ]normal construction)/i, ["axis_view", "interface", "ray_path"]],
  [/(?:microscope|telescope|objective|eyepiece)/i, ["instrument_chain", "axis_view"]],
  [/(?:wavefront|huygens|secondary wavelet|coheren(?:t|ce))/i, ["wavefront"]],
  [/(?:double.?slit|young.?s experiment|slit separation|single.?slit|aperture)/i, ["aperture"]],
  [/(?:interference|fringe|diffraction|central maximum|rayleigh|resolving|phase difference)/i, ["screen_pattern"]],
  [/(?:incident ray|reflected ray|refracted ray|ray path|surface normals?|\btheir normals\b|normals? indicating|normals and\b|path difference|first minima|emergent ray)/i, ["ray_path"]],
  [/(?:unpolari[sz]ed|plane.?polari[sz]ed|electric field direction|malus)/i, ["transverse_field"]],
  [/(?:polari[sz]er|analy[sz]er|polaroid|brewster|malus|polari[sz]ation)/i, ["polarizer"]],
  [/(?:microscope|telescope|rayleigh|resolving power)/i, ["instrument_chain"]],
  [/(?:free[- ]body|incline|inclined plane|pulley|friction(?:al)? force|normal reaction|hanging (?:mass|block)|blocks? connected|coefficient of (?:kinetic )?friction|simple pendulum|oscillates with amplitude|force constant|moment of inertia|centre of mass|center of mass)/i, ["contact_body"]],
  [/(?:raindrop|dropped from|dropped onto|starts from rest at height|hits the ground|raised vertically|rebounds? to|released on the slide)/i, ["contact_body"]],
  [/(?:pushes a (?:box|block)|block of mass|force (?:pushes|pulls|acts through)|towed at|frictionless horizontal track)/i, ["contact_body"]],
  [/(?:work done by (?:a |the )?(?:constant |unknown |frictional |resistive )?force|same direction as the force|force is perpendicular to)/i, ["contact_body"]],
  [/(?:spring of stiffness|spring-block|unstretched springs|springs S1|elastic potential energy stored)/i, ["contact_body"]],
  [/(?:pendulum of length|bob of mass|whirled in a vertical|vertical circl|circular loop|circular path of constant radius)/i, ["contact_body"]],
  [/(?:collid(?:e|es|ing|ed)|collision|head-on|sticks to|embeds in|ballistic pendulum|coefficient of restitution|glancing collision)/i, ["contact_body"]],
  [/(?:moved slowly around a closed|closed \d+(?:\.\d+)?\s*m\s*[×x])/i, ["contact_body"]],
  [/(?:\d+(?:\.\d+)?\s*kg (?:particle|block|mass|cart|wad)|particle of mass|body of mass|cart at|moves along a straight line)/i, ["contact_body"]],
  [/(?:average (?:speed|velocity)|instantaneous velocity|starts from rest|constant acceleration|accelerates uniformly|round trip|circular park|motion in a straight.?line|straight-line trip|position along a line|train starting|covers half the distance)/i, ["contact_body"]],
  [/(?:two cars|car [AB] travels|velocity of [AB] relative to [AB]|relative to [AB]|catches? [AB]|100 m ahead of [AB])/i, ["contact_body"]],
  [/(?:(?:(?<!not a )\bprojectile\b)|projected from|thrown horizontally|thrown vertically|from the top of a (?:tower|building)|maximum height of)/i, ["contact_body"]],
  [/(?:uniform circular motion|horizontal circle|centripetal|circular turn|level circular|circular road|curve on a level road|banked|frictionless bank|up the bank|conical pendulum)/i, ["contact_body"]],
  [/(?:impulse|batsman|recoil|on ice|leans against a wall|ladder of mass|hanging over|pseudo force|\blift\b|rolling friction|spring of force constant|pendulum hangs|rests on a table|string now makes|bob has mass)/i, ["contact_body"]],
  [/(?:x\s*=\s*t|position along a line is x\s*=)/i, ["analytic_curve"]],
  [/(?:accelerates uniformly|train starting from rest|average speed for the whole|velocity-?time|position-?time|displacement-?time|v-t graph|s-t graph|x-t graph)/i, ["state_plot"]],
  [/(?:river|still water|downstream|upstream|rain falls|concurrent forces|triangle of forces|velocity triangles?|[îĵ]|makes with the x-axis)/i, ["vector_diagram"]],
  [/(?:circuit|resistor|inductor|capacitor|\bLCR\b|\bRLC\b|wheatstone|galvanometer|phasor|ac source|series[- ]parallel|zener|internal resistance|cells? (?:are )?connected|\bemf\b|ohm['’]?s law|drift velocity|resistivity|transistor)/i, ["circuit_network"]],
  [/(?:p[-–—]?v(?:\s+cycle|\s+diagram|\s+graph)?|thermodynamic cycle|clockwise rectangular cycle)/i, ["state_plot"]],
  [/(?:y\s*=|x\s*=\s*t|sketch.{0,60}(?:curve|graph)|plot.{0,40}(?:curve|graph|against|versus)|parametric|polar curve|tangent (?:at|to)|x-intercept|implicit|trajectory|standing[- ]wave|third harmonic|node and antinode|F\s*=\s*5x|F_x\s*=|F versus x|graph of F|U\s*=\s*\(|U\(x\)|U\(r\)\s*=|potential energy of a particle is U)/i, ["analytic_curve"]],
  [/(?:enclose a region|region under|region between|revolve|washer|representative (?:disk|slice|washer)|solid of revolution|area using integration)/i, ["bounded_region"]],
  [/(?:cylinder|hemisphere|frustum|right circular|composite solid|cone of radius)/i, ["solid_figure"]],
  [/(?:hydraulic|pistons?|venturi|pipe whose diameter|connected fluid|cylindrical vessels|connected at the bottom|buoyancy|archimedes|thermal expansion|heat transfer|fluid column|viscosity|method of mixtures|resonance tube)/i, ["fluid_apparatus"]],
  [/(?:point charges?|electric[- ]field|magnetic field|null point|long straight|current-carrying|microcoulomb)/i, ["point_field"]],
  [/(?:photo.?electric|photoelectron|threshold frequency|work function|stopping potential|bohr|energy levels?|photon energy|hydrogen atom|energy band|valence band|conduction band|depletion.{0,4}region|solar cell|light emitting)/i, ["energy_level"]],
  [/(?:plot [A-Z]\s*\(|triangle [A-Z]{3}|right angle|argand|equation of (?:(?:the|a) )?(?:circle|parabola|ellipse|hyperbola|line|plane)|vector equation(?:s)? of (?:the )?(?:line|plane|lines)|cartesian equation of the (?:line|plane)|skew lines|shortest distance between (?:the )?lines|direction (?:cosines?|ratios?)|coordinates of|\bhyperbola\b|\bellipse\b|\bparabola\b|\bfoci\b|\bdirectrix\b|\blatus rect(?:um)?\b|\blatus ractum\b|locus of (?:the )?(?:point|[A-Z]\b)|circles? with variable diameter|moves from \(|in vector form)/i, ["coordinate_figure"]],
  [/(?:resultant of|two vectors|vector components|parallelogram law|dot product|cross product|vector algebra|unit vector|position vectors?|projection of the vector|a vector of magnitude|velocity vectors|velocity triangles?)/i, ["vector_diagram"]],
  [/(?:v[-–]?t graph|s[-–]?t graph|velocity[- ]time|displacement[- ]time|indicator diagram)/i, ["state_plot"]],
  [/(?:rolling without slipping|torque on a|hinged|hinge reaction|about (?:a |the )?fixed (?:axis|end|hinge)|physical pendulum|uniform (?:rod|bar)\b|angular (?:speed|velocity|acceleration) of|rotat(?:es|ing|ed) about|angular momentum|rigid body rotation)/i, ["contact_body"]],
  [/(?:gauss(?:['’]?s)? law|electric flux|equipotential|electric dipole|microcoulomb|nanocoulomb|\bμC\b|\bnC\b|parallel[- ]plate capacitor|metal sheets?.{0,80}parallel|electrically conducting walls|horizontal metal plates|electric charges?|conservation of charge|electric potential)/i, ["point_field"]],
  [/(?:solenoid|toroid|biot[- ]savart|ampere['’]?s law|cyclotron|bar magnet|lorentz|velocity selector)/i, ["point_field"]],
  [/(?:wheatstone|met(?:er|re) bridge|potentiometer|kirchhoff|galvanometer)/i, ["circuit_network"]],
  [/(?:faraday|lenz|motional emf|self inductance|mutual inductance|transformer)/i, ["circuit_network"]],
  [/(?:kepler|satellite|escape velocity|orbital velocity|gravitat(?:ion|ional field)|acceleration due to gravity|weightlessness)/i, ["point_field"]],
  [/(?:bernoulli|venturi|capillary|young['’]?s modulus|stress[- ]strain|stokes['’]? law)/i, ["fluid_apparatus"]],
  [/(?:isothermal|adiabatic|carnot|indicator diagram|first law of thermodynamics|isobaric|isochoric|zeroth law|refrigerator)/i, ["state_plot"]],
  [/(?:organ pipe|standing waves?|transverse wave|travelling wave|traveling wave)/i, ["analytic_curve"]],
  [/(?:rutherford|bohr orbit|hydrogen spectrum)/i, ["energy_level"]],
  [/(?:zener|(?:p-n|pn) junction diode|rectifier|logic gate|nand|nor gate)/i, ["circuit_network"]],
  [/(?:(?:n-type|p-type) semiconductors?|photodiode|(?:p-n|pn) junction|\bled\b)/i, ["energy_level"]],
  [/(?:transfer characteristic|i[-–]?v characteristic|characteristic curve|draw a graph showing variation|graph showing variation of|variation of .{1,120} as a function of)/i, ["state_plot"]],
  [/(?:argand|complex plane)/i, ["coordinate_figure"]],
  [/(?:electromagnetic wave|em wave|displacement current|electromagnetic spectrum)/i, ["transverse_field"]],
  [/(?:simple harmonic|shm\b|vernier|screw gauge|least count|periodic motion|oscillations? of)/i, ["contact_body"]],
  [/(?:cyclic process|p[-–]?t diagram|isobaric process|thermodynamic system)/i, ["state_plot"]],
  [/(?:binding energy per nucleon|maxwell speed|amplitude modulat|modulating signal|carrier wave|beats|doppler effect|progressive wave)/i, ["analytic_curve"]],
  [/(?:x-ray tube|x ray tube|de broglie|matter[- ]wave|nuclear fission|nuclear fusion|mass defect|radioactive decay|half-life|davisson|dual nature of radiation|q value)/i, ["energy_level"]],
  [/(?:law of cooling)/i, ["analytic_curve"]],
  [/(?:surface tension)/i, ["fluid_apparatus"]],
  [/(?:parallel (?:wires|conductors)|wires carry (?:equal )?currents)/i, ["point_field"]],
  [/(?:rolle['’]?s theorem|f\s*\(\s*x\s*\)\s*=)/i, ["analytic_curve"]],
  [/(?:area (?:of the region |enclosed by|bounded by)|using integration.{0,80}area|region bounded by the curve)/i, ["bounded_region"]],
  [/(?:radius of (?:the |a )?circle|circumference of (?:the |a )?circle).{0,120}(?:increas|decreas|rate)|rectangles inscribed in a (?:given )?(?:fixed )?circle|median of an equilateral triangle|variable cube|edge of a (?:variable )?cube/i, ["coordinate_figure"]],
];

/**
 * The single English question→family catalog application. Both the planner
 * capability inference and the family-scene fallback run this same table; the
 * stem-specific overrides live in applyStemFamilyOverrides.
 */
export function inferFamiliesFromQuestion(question: string): SceneVisualFamily[] {
  const stem = normalizeStem(question);
  const matches: SceneVisualFamily[] = [];
  for (const [pattern, families] of QUESTION_FAMILIES) {
    if (pattern.test(stem)) {
      for (const family of families) {
        if (!matches.includes(family)) matches.push(family);
      }
    }
  }
  return matches;
}

/**
 * Stem-specific add/delete overrides shared by both callers. When the caller
 * has ProblemIR-derived families it passes them as `preserveFamilies`: the
 * English overrides may still add coverage but may never revoke a family the
 * problem structure selected.
 */
export function applyStemFamilyOverrides(
  stem: string,
  families: Set<SceneVisualFamily>,
  options?: { preserveFamilies?: readonly SceneVisualFamily[] },
): void {
  const preserve = new Set<SceneVisualFamily>(options?.preserveFamilies ?? []);
  const drop = (family: SceneVisualFamily): void => {
    if (!preserve.has(family)) families.delete(family);
  };
  if ((isSemiconductorBandStem(stem) || isJunctionSpatialStem(stem)) && !isDeviceCircuitStem(stem)) {
    families.add("energy_level");
    drop("circuit_network");
  }
  if (isIvCharacteristicStem(stem) || isNamedVariationPlotStem(stem)) families.add("state_plot");
  if (isDeviceCircuitStem(stem)) drop("energy_level");
  if (isParallelPlateStem(stem)) families.add("point_field");
  if (isHangingWiresLoadStem(stem)) families.add("contact_body");
  if (isRiverBoatStem(stem)) {
    families.add("vector_diagram");
    drop("bounded_region");
    drop("point_field");
    drop("contact_body");
    drop("coordinate_figure");
  }
  if (isSpaceGeometryStem(stem)) {
    families.add("coordinate_figure");
    drop("vector_diagram");
  }
  if (
    isRelatedRateCircleStem(stem)
    || isRelatedRateTriangleStem(stem)
    || isRelatedRateSolidStem(stem)
    || isPlanarConicStem(stem)
    || /(?:locus of (?:the )?(?:point|[A-Z]\b)|circles? with variable diameter)/i.test(stem)
  ) {
    families.add("coordinate_figure");
  }
  if (isBoundedRegionStem(stem)) families.add("bounded_region");
  if (isFigureAbsentStem(stem)) drop("state_plot");
}

/** Lead with the stem-defining family; shared by both callers. */
export function orderFamiliesByStemPreference(
  stem: string,
  families: readonly SceneVisualFamily[],
): SceneVisualFamily[] {
  if (families.length === 0) return [];
  if ((isSemiconductorBandStem(stem) || isJunctionSpatialStem(stem)) && families.includes("energy_level")) {
    return ["energy_level", ...families.filter((family) => family !== "energy_level")];
  }
  if (
    (isIvCharacteristicStem(stem) || isNamedVariationPlotStem(stem))
    && families.includes("state_plot")
  ) {
    return ["state_plot", ...families.filter((family) => family !== "state_plot")];
  }
  if (isParallelPlateStem(stem) && families.includes("point_field")) {
    return ["point_field", ...families.filter((family) => family !== "point_field")];
  }
  if (isRiverBoatStem(stem) && families.includes("vector_diagram")) {
    return ["vector_diagram", ...families.filter((family) => family !== "vector_diagram")];
  }
  if (isSpaceGeometryStem(stem) && families.includes("coordinate_figure")) {
    return ["coordinate_figure", ...families.filter((family) => family !== "coordinate_figure")];
  }
  return [...families];
}

/* ------------------------------------------------------------------------- */
/* ProblemIR structure routing (the live catalog).                           */
/* ------------------------------------------------------------------------- */

const INTENT_FAMILIES: Record<string, readonly SceneVisualFamily[]> = {
  graph: ["analytic_curve", "state_plot"],
  bounded_region: ["bounded_region", "analytic_curve"],
  network: ["circuit_network"],
  apparatus: ["fluid_apparatus"],
  free_body: ["contact_body"],
  field: ["point_field"],
  solid: ["solid_figure"],
  section: ["solid_figure", "coordinate_figure"],
};

const ENTITY_FAMILIES: Record<string, readonly SceneVisualFamily[]> = {
  field: ["point_field"],
  component: ["circuit_network"],
  body: ["contact_body"],
  curve: ["analytic_curve"],
  region: ["bounded_region"],
  solid: ["solid_figure"],
  state: ["state_plot"],
};

/** Labels that name an electrical source inside a component entity. */
const CIRCUIT_SOURCE_LABEL = /(?:battery|\bcells?\b|source|\bemf\b|power supply|dc supply)/i;
/** Labels that name a branch element inside a component entity. */
const CIRCUIT_BRANCH_LABEL = /(?:resist|inductor|capacitor|lamp|galvanometer|diode|zener|ammeter|voltmeter|rheostat|potentiometer|branch)/i;
/** River-boat vocabulary that must never fall through to the coarse body/region maps. */
const RIVER_BOAT_ENTITY_LABEL = /(?:\bboat\b|\briver\b|\bcurrent\b|downstream|upstream|still water)/i;

/** A boat on a stream is one vector diagram; never a coarse body+region pair. */
export function isRiverBoatProblemIR(problemIR?: ProblemStructureView | null): boolean {
  const blobs = (problemIR?.entities ?? []).map((entity) => JSON.stringify(entity).toLowerCase());
  const boat = blobs.some((blob) => /\bboat\b/.test(blob));
  const stream = blobs.some((blob) => /\b(?:river|current|downstream|upstream)\b/.test(blob));
  return boat && stream;
}

export interface CircuitTopology {
  sources: number;
  branches: number;
  junctions: number;
  /** Kirchhoff/Wheatstone-style network: two loops or a bridge, not a chain. */
  twoLoop: boolean;
}

/**
 * Derive the circuit loop/branch structure from ProblemIR entities and
 * connected-constraints — sources, branch components, and junction hubs — so
 * a two-loop Kirchhoff/Wheatstone network is told apart from a plain resistor
 * chain without an English override regex.
 */
export function circuitTopologyFromProblemStructure(
  problemIR?: ProblemStructureView | null,
): CircuitTopology | null {
  if (!problemIR) return null;
  const entities = problemIR.entities ?? [];
  const components = entities.filter((entity) =>
    entity.kind === "component" || CIRCUIT_BRANCH_LABEL.test(entity.label ?? "")
    || CIRCUIT_SOURCE_LABEL.test(entity.label ?? ""));
  const networkIntent = (problemIR.representationIntents ?? [])
    .some((intent) => intent.kind === "network");
  if (components.length === 0 && !networkIntent) return null;
  const sources = components.filter((entity) => CIRCUIT_SOURCE_LABEL.test(entity.label ?? "")).length;
  const connectedDegree = new Map<string, number>();
  for (const constraint of problemIR.constraints ?? []) {
    if (constraint.kind !== "connected") continue;
    for (const entityId of constraint.entityIds ?? []) {
      connectedDegree.set(entityId, (connectedDegree.get(entityId) ?? 0) + 1);
    }
  }
  const junctions = [...connectedDegree.values()].filter((degree) => degree >= 2).length;
  const branches = components.length;
  // Two voltage sources driving a shared branch (Kirchhoff), or a five-plus
  // branch bridge (Wheatstone), or an explicitly connected multi-junction net.
  const twoLoop = (sources >= 2 && branches >= 3)
    || branches >= 5
    || (networkIntent && junctions >= 2 && branches >= 3);
  return { sources, branches, junctions, twoLoop };
}

/**
 * Pick the river-boat figure variant from ProblemIR fact statements:
 * downstream/upstream round trips are along-stream banks, a crossing with a
 * heading angle is the heading triangle, and straight-across vs shortest-time
 * is the two-triangle figure. Returns null when the facts carry no variant
 * evidence, so the English oracle stays the fallback.
 */
export function riverBoatVariantFromProblemStructure(
  problemIR?: ProblemStructureView | null,
): RiverBoatVariant | null {
  if (!isRiverBoatProblemIR(problemIR)) return null;
  const statements = normalizeStem(
    (problemIR?.facts ?? []).map((fact) => fact.statement ?? "").join(" "),
  );
  if (!statements) return null;
  if (
    /(?:two velocity triangles|draw the two velocity triangles)/i.test(statements)
    || (/(?:straight across|resultant is straight)/i.test(statements) && /shortest/i.test(statements))
  ) {
    return "two_triangles";
  }
  if (/(?:cross(?:es|ing)?|\bwide river\b|width of the river|heading|straight across|to the direction of (?:the )?river)/i.test(statements)) {
    return "crossing";
  }
  if (/(?:downstream|upstream)/i.test(statements)) return "along_stream";
  return null;
}

/**
 * Prefer TurnPlan / ProblemIR structure over the English keyword lists. This
 * is the live family decision; the tables above only apply when the caller
 * has no ProblemIR (or as strictly additive coverage — never to revoke a
 * family selected here).
 */
export function familiesFromProblemStructure(
  problemIR?: ProblemStructureView | null,
): SceneVisualFamily[] {
  if (!problemIR) return [];
  if (isRiverBoatProblemIR(problemIR)) return ["vector_diagram"];
  const families = new Set<SceneVisualFamily>();
  const circuitTopology = circuitTopologyFromProblemStructure(problemIR);
  if (circuitTopology) families.add("circuit_network");
  for (const intent of problemIR.representationIntents ?? []) {
    const kind = intent.kind ?? "";
    if (kind === "conceptual") continue;
    for (const family of INTENT_FAMILIES[kind] ?? []) families.add(family);
  }
  for (const entity of problemIR.entities ?? []) {
    const kind = entity.kind ?? "";
    // A body/region entity labelled with river-boat vocabulary is not a
    // contact body or a bounded region on its own; only the full boat+stream
    // structure above may claim that figure.
    if ((kind === "body" || kind === "region") && RIVER_BOAT_ENTITY_LABEL.test(entity.label ?? "")) {
      continue;
    }
    for (const family of ENTITY_FAMILIES[kind] ?? []) families.add(family);
  }
  return [...families];
}
