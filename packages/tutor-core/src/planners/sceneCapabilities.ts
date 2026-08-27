/** Compact, representation-level capability prediction for semantic scenes. */

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

export interface SceneCapabilityRequirements {
  visualRequired: boolean;
  families: SceneVisualFamily[];
  constructionOperators: string[];
  proofPredicates: string[];
  planningGuidance: string[];
}

/** Optional plan/IR structure. English regex is backup when these are absent. */
export interface SceneStructureHints {
  lawIds?: readonly string[];
  problemIR?: {
    entities?: ReadonlyArray<{ kind?: string }>;
    representationIntents?: ReadonlyArray<{ kind?: string }>;
  } | null;
  turnPlan?: {
    lawIds?: readonly string[];
    visualRequirement?: string;
  } | null;
}

const BASE_OPERATORS = [
  "point", "segment", "line", "polyline", "vector", "label", "dimension", "angle_mark",
];

const FAMILY_OPERATORS: Record<SceneVisualFamily, readonly string[]> = {
  ray_path: [
    "ray", "line", "segment", "vector", "arc", "intersection", "surface_intersection",
    "surface_contact", "normal_at", "reflect_direction", "refract_direction", "parallel_through",
    "reflect_at", "refract_at", "angle_mark", "right_angle_mark",
  ],
  axis_view: ["line", "segment", "ray", "arc", "vector", "dimension", "reflect_point"],
  interface: ["line", "circle", "arc", "polygon", "surface_intersection", "surface_contact", "normal_at"],
  instrument_chain: ["line", "segment", "ray", "arc", "vector", "dimension", "parallel_through", "perpendicular_through", "optical_train"],
  wavefront: ["wavefront_family", "line", "vector", "perpendicular_through"],
  aperture: ["aperture", "line", "segment"],
  screen_pattern: ["screen_pattern", "line", "segment", "dimension"],
  transverse_field: ["transverse_field", "line", "vector"],
  polarizer: ["polarizer", "line", "angle_mark"],
  contact_body: [
    "rectangle", "circle", "line", "segment", "vector", "vector_components",
    "surface_contact", "angle_mark", "right_angle_mark", "polyline", "rotate", "arc",
    "midpoint",
  ],
  circuit_network: [
    "symbol", "connect", "point", "vector", "vector_components", "arc", "angle_mark",
  ],
  state_plot: ["axes", "point", "polygon", "polyline", "vector", "label"],
  analytic_curve: [
    "axes", "function_curve", "parametric_curve", "polar_curve", "implicit_curve",
    "tangent_line", "normal_line", "function_region", "point", "intersection", "vector_components",
  ],
  bounded_region: [
    "axes", "function_curve", "function_region", "representative_slice", "solid_of_revolution", "point",
  ],
  solid_figure: ["solid_projection", "solid_cross_section", "point", "dimension", "label"],
  fluid_apparatus: ["rectangle", "polygon", "polyline", "connect", "vector", "dimension", "circle"],
  point_field: ["point", "vector", "circle", "line", "dimension", "angle_mark"],
  energy_level: ["axes", "segment", "vector", "dimension", "label", "rectangle", "point"],
  coordinate_figure: [
    "axes", "point", "line", "circle", "polygon", "intersection", "tangent_line",
    "right_angle_mark", "angle_mark", "angle_bisector",
  ],
  vector_diagram: ["axes", "vector", "vector_components", "angle_mark", "label"],
};

const FAMILY_PREDICATES: Record<SceneVisualFamily, readonly string[]> = {
  ray_path: ["incident", "on", "parallel", "converges", "equal_angle", "snells_law"],
  axis_view: ["between", "ordered_along", "distance_ratio", "equal_spacing"],
  interface: ["incident", "on", "inside", "snells_law"],
  instrument_chain: ["ordered_along", "parallel", "perpendicular", "on", "between", "converges"],
  wavefront: ["parallel", "perpendicular", "equal_spacing", "equal_angle"],
  aperture: ["inside", "equal_spacing"],
  screen_pattern: ["equal_spacing", "ordered_along"],
  transverse_field: ["perpendicular", "parallel"],
  polarizer: ["angle_between", "perpendicular"],
  contact_body: ["perpendicular", "opposite_direction", "connected", "parallel", "angle_between", "on", "equal_length"],
  circuit_network: ["path", "sameTerminalPair", "pathCount", "degree", "connected", "perpendicular", "angle_between"],
  state_plot: ["connected", "on", "between", "ordered_along", "perpendicular"],
  analytic_curve: ["on", "function_value", "root", "incident", "perpendicular"],
  bounded_region: ["function_value", "root", "between"],
  solid_figure: ["connected", "perpendicular", "equal_length", "same_side"],
  fluid_apparatus: ["connected", "parallel", "distance_ratio"],
  point_field: ["opposite_direction", "equal_length", "parallel", "perpendicular", "between", "collinear", "distance_ratio", "on"],
  energy_level: ["ordered_along", "parallel", "connected", "distance_ratio"],
  coordinate_figure: ["collinear", "perpendicular", "parallel", "on", "angle_between"],
  vector_diagram: ["perpendicular", "parallel", "equal_length", "angle_between"],
};

const FAMILY_GUIDANCE: Record<SceneVisualFamily, string> = {
  ray_path: "Derive every reflected or refracted direction with reflect_at/refract_at or the surface-contact chain; never guess ray endpoints. Prove incidence, angle, convergence, or parallelism named by the question.",
  axis_view: "Use one shared axis, reuse point IDs for named positions on it, prove their order, and attach each dimension to its actual endpoints. Compress display scale without changing authoritative ratios.",
  interface: "Construct one explicit interface and one shared contact point. Derive the normal and outgoing ray from that surface, and prove the contact and governing reflection/refraction law.",
  instrument_chain: "Build one continuous optical chain on a shared axis. Objective and eyepiece lens elements are perpendicular to that axis. Use optical_train for the six rays; never guess ray endpoints or mix millimetre and centimetre world coordinates. For an afocal normal-adjustment chain, reuse one point ID for the objective image and eyepiece focus, then use optical_train for the six rays. Prove parallel input/output bundles and intermediate convergence. For a finite microscope chain, pass the object, intermediate image, and final virtual image into optical_train.",
  wavefront: "Use wavefront_family with a verified ray/path ID as direction. Prove each front is perpendicular to propagation and use derived reflected/refracted rays when a boundary is present.",
  aperture: "Use aperture for the physical opening; do not imitate slits with boxes or loose segments. Keep slit count and ordering faithful to the question.",
  screen_pattern: "Use screen_pattern for interference, diffraction, or resolution marks. Keep physical spacing in quantities and use normalized display spacing only for rendering.",
  transverse_field: "Use transverse_field for propagation plus field oscillation and prove its transverse relation. Do not substitute prose or a generic box for polarization state.",
  polarizer: "Use polarizer for every transmission axis, derive stated relative angles, and keep labels attached to their own optical element.",
  contact_body: "Construct contact surfaces and rigid bodies first. Attach every force vector to its body with a shared point ID, using vector_components with the physical surface as basis on an incline. For a hinged rod or rotating rigid body, reuse one hinge/axis point and derive the second pose with rotate; attach weight at the centre of mass. Prove contact, perpendicular normals, equal rod lengths, and opposite action-reaction. Never draw a free-body as floating arrows or two disconnected copies of the same body.",
  circuit_network: "Every circuit component is a symbol with two terminals. Series components share consecutive terminals; parallel components share the same terminal pair. Prove path or sameTerminalPair. If a phasor diagram is named, put it in a second reveal group as vectors from one origin with angle_between; do not replace symbols with arrows.",
  state_plot: "Plot named states as points on axes whose x and y spans are comparable layout numbers, not raw SI magnitudes. A closed cycle is one polygon or polyline through shared point IDs. Independent axis scales are display-only; never place V=0.002 against P=1e5 in world coordinates.",
  analytic_curve: "Use the question's expression in function_curve, parametric_curve, polar_curve, or implicit_curve. Derive tangent_line and normal_line from that curve; never send a slope or guessed endpoints. Prove a named point with function_value {x, y} as cartesian coordinates on that curve (optionally include t or theta). Do not treat the parameter t as x.",
  bounded_region: "Build each bounding curve with function_curve, then function_region for the enclosed area. For planar area, representative_slice is a vertical strip. For a disk or washer about y=axisY, set method to disk or washer so the engine draws the foreshortened circular face from those function radii; use solid_of_revolution for the generating-profile silhouette. Never sketch a disk or washer by guessed polygons.",
  solid_figure: "Use solid_projection for each named solid. Composite solids share the join radius. Dimension true radii and heights; do not invent hidden faces as separate guessed polygons.",
  fluid_apparatus: "Construct the connected vessel or pipe as closed polygons/rectangles that share terminals. Dimension named radii or diameters. Flow and force arrows attach to those bodies; do not draw disconnected tanks.",
  point_field: "Place each named charge or current-carrying wire as a point or line. Field and force vectors share those IDs. Circular field geometry around a wire is a circle, not a guessed arc family. Prove collinearity, opposite directions, or perpendicularity named by the question.",
  energy_level: "Draw energy or stopping-potential as an axis-aligned level diagram. Semiconductor topics reuse the same stacked levels: valence and conduction bands, optional donor/acceptor levels, and a p–n depletion region as adjacent regions on one axis. Transitions are segments or vectors between shared level IDs. Do not invent a circuit or a ray path for a photoelectric/Bohr energy balance; a device I–V curve is a state plot.",
  coordinate_figure: "Plot named points on axes, then construct the asked line, circle, polygon, or right-angle mark from those IDs. Intersections and tangents are derived operators, not guessed extra points.",
  vector_diagram: "Draw named vectors from a shared origin in one frame. Use vector_components for resolved parts and prove the named angle or perpendicular/parallel relation. Do not substitute a free-body or a circuit.",
};

const LAW_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
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

const QUESTION_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
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
  [/(?:plot [A-Z]\s*\(|triangle [A-Z]{3}|right angle|argand|equation of (?:(?:the|a) )?(?:circle|parabola|ellipse|hyperbola|line|plane)|vector equation of the (?:line|plane)|cartesian equation of the (?:line|plane)|skew lines|direction cosines?|coordinates of|\bhyperbola\b|\bellipse\b|\bparabola\b|\bfoci\b|\bdirectrix\b|moves from \()/i, ["coordinate_figure"]],
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
];

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

function normalizeStem(question: string): string {
  return question
    .replace(/[–—−]/g, "-")
    .replace(/[³]/g, "^3")
    .replace(/[²]/g, "^2")
    .replace(/\s+/g, " ")
    .trim();
}

function isFigureAbsentStem(stem: string): boolean {
  return /\b(?:shown in the figure|as shown in the figure|the figure shows|figure shows)\b/i.test(stem);
}

function isNamedVariationPlotStem(stem: string): boolean {
  if (isFigureAbsentStem(stem)) return false;
  return /(?:draw a graph showing variation|graph showing variation of|variation of .{1,120} as a function of)/i.test(stem);
}

function isParallelPlateStem(stem: string): boolean {
  return /(?:parallel[- ]plate capacitor|metal sheets?.{0,80}parallel|kept parallel to each other|electrically conducting walls|horizontal metal plates)/i.test(stem);
}

function isHangingWiresLoadStem(stem: string): boolean {
  return /(?:upper wire|breaking stress)/i.test(stem) && /(?:lower wire|\bpan\b)/i.test(stem);
}

/** `Array.isArray` predicates `any[]`, which never matches `readonly string[]`, so guard with an explicit predicate. */
function isLawIdsArray(
  value: readonly string[] | SceneStructureHints,
): value is readonly string[] {
  return Array.isArray(value);
}

function normalizeHints(
  lawIdsOrHints: readonly string[] | SceneStructureHints,
): SceneStructureHints {
  if (isLawIdsArray(lawIdsOrHints)) return { lawIds: lawIdsOrHints };
  return lawIdsOrHints;
}

/** Prefer TurnPlan / ProblemIR entity kinds over English keyword lists. */
export function familiesFromProblemStructure(
  problemIR?: SceneStructureHints["problemIR"],
): SceneVisualFamily[] {
  if (!problemIR) return [];
  const families = new Set<SceneVisualFamily>();
  for (const intent of problemIR.representationIntents ?? []) {
    const kind = intent.kind ?? "";
    if (kind === "conceptual") continue;
    for (const family of INTENT_FAMILIES[kind] ?? []) families.add(family);
  }
  for (const entity of problemIR.entities ?? []) {
    const kind = entity.kind ?? "";
    for (const family of ENTITY_FAMILIES[kind] ?? []) families.add(family);
  }
  return [...families];
}

/** Pure-concept markers where an honest text-only answer is expected, even if hardware words appear. */
export function isQualitativeConceptQuestion(question: string): boolean {
  return /\b(?:assertion|reason\s*\(?r?|which\s+of\s+the\s+following|which\s+of\s+these|correct\s+statement|statement(?:s)?\s+(?:is|are)|not\s+true|does\s+not\s+occur|true\s+about|match the motions|match list|column i\b|column ii\b)\b/i.test(question);
}

/** A concept MCQ that still names a spatial apparatus should keep a setup figure. */
export function qualitativeQuestionAllowsScene(question: string): boolean {
  return /(?:leans against a wall|ladder of mass|conical pendulum|banked|inclined plane|free[- ]body|pulley|lens|mirror|prism|circuit|resistor|projectile|pendulum|ray path|slit|dipole|solenoid|capacitor|incline|bar magnet|kepler|satellite|venturi|hydraulic|wheatstone|met(?:er|re) bridge|galvanometer|transformer|cyclotron|toroid|gauss|equipotential|rolling without slipping|moment of inertia|energy band|depletion[- ]region|solar cell|p-n junction|light emitting|microscope|telescope)/i.test(question);
}

function isSemiconductorBandStem(stem: string): boolean {
  return /(?:energy band|valence band|conduction band|(?:n-type|p-type)|intrinsic semiconductor)/i.test(stem);
}

function isJunctionSpatialStem(stem: string): boolean {
  if (
    /(?:rectifier|zener|(?:p-n|pn) junction diode|nand|nor gate|logic gate|with (?:a )?battery)/i.test(stem)
    && !/(?:depletion.{0,4}region|solar cell|photodiode|energy band)/i.test(stem)
  ) {
    return false;
  }
  return /(?:depletion.{0,4}region|solar cell|photodiode|light emitting|\bled\b|(?:p-n|pn) junction)/i.test(stem);
}

function isIvCharacteristicStem(stem: string): boolean {
  return /(?:transfer characteristic|i[-–]?v characteristic|characteristic curve)/i.test(stem);
}

function isDeviceCircuitStem(stem: string): boolean {
  return /(?:rectifier|zener|(?:p-n|pn) junction diode|nand|nor gate|logic gate|with (?:a )?battery)/i.test(stem)
    && !isSemiconductorBandStem(stem)
    && !/(?:depletion.{0,4}region|solar cell|photodiode)/i.test(stem)
    && !isIvCharacteristicStem(stem);
}

function routeSemiconductorFamilies(stem: string, families: Set<SceneVisualFamily>): void {
  if ((isSemiconductorBandStem(stem) || isJunctionSpatialStem(stem)) && !isDeviceCircuitStem(stem)) {
    families.add("energy_level");
    families.delete("circuit_network");
  }
  if (isIvCharacteristicStem(stem)) families.add("state_plot");
  if (isDeviceCircuitStem(stem)) families.delete("energy_level");
}

function preferSemiconductorFamilyOrder(
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
  return [...families];
}

export function inferSceneCapabilities(
  question: string,
  lawIdsOrHints: readonly string[] | SceneStructureHints = [],
): SceneCapabilityRequirements {
  const hints = normalizeHints(lawIdsOrHints);
  const lawIds = hints.lawIds ?? hints.turnPlan?.lawIds ?? [];
  const stem = normalizeStem(question);
  const explicitVisual = /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(stem);
  const structureFamilies = familiesFromProblemStructure(hints.problemIR);
  if (
    hints.turnPlan?.visualRequirement !== "required"
    && isQualitativeConceptQuestion(stem)
    && !explicitVisual
    && !qualitativeQuestionAllowsScene(stem)
    && structureFamilies.length === 0
  ) {
    return {
      visualRequired: false,
      families: [],
      constructionOperators: [...BASE_OPERATORS],
      proofPredicates: ["exists", "label_attached"],
      planningGuidance: [],
    };
  }
  const families = new Set<SceneVisualFamily>(structureFamilies);
  const lawText = lawIds.join(" ");
  for (const [pattern, matches] of LAW_FAMILIES) {
    if (pattern.test(lawText)) matches.forEach((family) => families.add(family));
  }
  for (const [pattern, matches] of QUESTION_FAMILIES) {
    if (pattern.test(stem)) matches.forEach((family) => families.add(family));
  }

  // A wave-pattern calculation needs its physical aperture and propagation
  // path even when the question abbreviates the setup.
  if (families.has("screen_pattern") && /(?:interference|fringe|diffraction|ydse|young)/i.test(`${question} ${lawText}`)) {
    families.add("aperture");
    families.add("ray_path");
  }
  if (families.has("instrument_chain") && /(?:telescope|microscope)/i.test(`${question} ${lawText}`)) {
    families.add("axis_view");
  }
  if (families.has("bounded_region")) families.add("analytic_curve");
  // Huygens reflection/refraction constructions need the interface and
  // derived normals even when the stem never says "incident ray".
  if (families.has("wavefront") && /huygens/i.test(`${stem} ${lawText}`)) {
    families.add("ray_path");
    if (/(?:reflect|refract|incident)/i.test(`${stem} ${lawText}`)) {
      families.add("interface");
    }
  }
  if (isNamedVariationPlotStem(stem)) families.add("state_plot");
  if (isParallelPlateStem(stem)) families.add("point_field");
  if (isHangingWiresLoadStem(stem)) families.add("contact_body");
  routeSemiconductorFamilies(stem, families);
  if (isFigureAbsentStem(stem)) families.delete("state_plot");

  const operators = new Set(BASE_OPERATORS);
  const predicates = new Set(["exists", "label_attached"]);
  const planningGuidance = new Set<string>();
  for (const family of families) {
    FAMILY_OPERATORS[family].forEach((operator) => operators.add(operator));
    FAMILY_PREDICATES[family].forEach((predicate) => predicates.add(predicate));
    planningGuidance.add(FAMILY_GUIDANCE[family]);
  }
  const remaining = [...families].filter((family) => !structureFamilies.includes(family));
  const orderedFamilies = preferSemiconductorFamilyOrder(stem, [
    ...structureFamilies,
    ...remaining,
  ]);
  return {
    visualRequired: orderedFamilies.length > 0
      || explicitVisual
      || hints.turnPlan?.visualRequirement === "required",
    families: orderedFamilies,
    constructionOperators: [...operators],
    proofPredicates: [...predicates],
    planningGuidance: [...planningGuidance],
  };
}

/** Charge/energy stems are common as pure numericals. Compact the planner if a
 *  diagram is requested, but do not force visualRequirement=required alone. */
const NUMERIC_COMMON_FAMILIES = new Set<SceneVisualFamily>([
  "point_field",
  "energy_level",
]);

export function sceneFamiliesForceVisualRequirement(
  families: readonly SceneVisualFamily[],
): boolean {
  return families.some((family) => !NUMERIC_COMMON_FAMILIES.has(family));
}
