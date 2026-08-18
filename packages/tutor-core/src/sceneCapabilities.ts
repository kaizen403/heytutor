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
  energy_level: ["axes", "segment", "vector", "dimension", "label"],
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
  instrument_chain: "Build one continuous optical chain on a shared axis. Objective and eyepiece lens elements are perpendicular to that axis. For an afocal normal-adjustment chain, reuse one point ID for the objective image and eyepiece focus, then use optical_train for the six rays. Prove parallel input/output bundles and intermediate convergence.",
  wavefront: "Use wavefront_family with a verified ray/path ID as direction. Prove each front is perpendicular to propagation and use derived reflected/refracted rays when a boundary is present.",
  aperture: "Use aperture for the physical opening; do not imitate slits with boxes or loose segments. Keep slit count and ordering faithful to the question.",
  screen_pattern: "Use screen_pattern for interference, diffraction, or resolution marks. Keep physical spacing in quantities and use normalized display spacing only for rendering.",
  transverse_field: "Use transverse_field for propagation plus field oscillation and prove its transverse relation. Do not substitute prose or a generic box for polarization state.",
  polarizer: "Use polarizer for every transmission axis, derive stated relative angles, and keep labels attached to their own optical element.",
  contact_body: "Construct contact surfaces and rigid bodies first. Attach every force vector to its body with a shared point ID, using vector_components with the physical surface as basis on an incline. Prove contact, perpendicular normals, and opposite action-reaction. Never draw a free-body as floating arrows.",
  circuit_network: "Every circuit component is a symbol with two terminals. Series components share consecutive terminals; parallel components share the same terminal pair. Prove path or sameTerminalPair. If a phasor diagram is named, put it in a second reveal group as vectors from one origin with angle_between; do not replace symbols with arrows.",
  state_plot: "Plot named states as points on axes whose x and y spans are comparable layout numbers, not raw SI magnitudes. A closed cycle is one polygon or polyline through shared point IDs. Independent axis scales are display-only; never place V=0.002 against P=1e5 in world coordinates.",
  analytic_curve: "Use the question's expression in function_curve, parametric_curve, polar_curve, or implicit_curve. Derive tangent_line and normal_line from that curve; never send a slope or guessed endpoints. Mark named intercepts and intersections with on or function_value proofs.",
  bounded_region: "Build each bounding curve with function_curve, then function_region for the enclosed area. A representative_slice or solid_of_revolution must be derived from those curves; never sketch a disk or washer by guessed polygons.",
  solid_figure: "Use solid_projection for each named solid. Composite solids share the join radius. Dimension true radii and heights; do not invent hidden faces as separate guessed polygons.",
  fluid_apparatus: "Construct the connected vessel or pipe as closed polygons/rectangles that share terminals. Dimension named radii or diameters. Flow and force arrows attach to those bodies; do not draw disconnected tanks.",
  point_field: "Place each named charge or current-carrying wire as a point or line. Field and force vectors share those IDs. Circular field geometry around a wire is a circle, not a guessed arc family. Prove collinearity, opposite directions, or perpendicularity named by the question.",
  energy_level: "Draw energy or stopping-potential as an axis-aligned level diagram. Transitions are segments or vectors between shared level IDs. Do not invent a circuit or a ray path for a photoelectric/Bohr energy balance.",
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
  [/newton|friction|tension|pulley|free.?body|hooke/i, ["contact_body"]],
  [/kirchhoff|ohm|wheatstone|lcr|rlc|ac.?circuit/i, ["circuit_network"]],
  [/first.?law|thermodynamic|ideal.?gas|indicator.?diagram/i, ["state_plot"]],
  [/coulomb|gauss|biot|ampere|lorentz/i, ["point_field"]],
  [/bernoulli|continuity.?equation|pascal/i, ["fluid_apparatus"]],
  [/photoelectric|bohr|rydberg/i, ["energy_level"]],
];

const QUESTION_FAMILIES: ReadonlyArray<readonly [RegExp, readonly SceneVisualFamily[]]> = [
  [/(?:mirror|lens|magnification|optical power|focal point|principal axis)/i, ["axis_view", "ray_path"]],
  [/(?:refraction|refracted|critical angle|total internal reflection|optical fibre|optical fiber|prism|brewster)/i, ["interface", "ray_path"]],
  [/(?:microscope|telescope|objective|eyepiece)/i, ["instrument_chain", "axis_view"]],
  [/(?:wavefront|huygens|secondary wavelet|coheren(?:t|ce))/i, ["wavefront"]],
  [/(?:double.?slit|young.?s experiment|slit separation|single.?slit|aperture)/i, ["aperture"]],
  [/(?:interference|fringe|diffraction|central maximum|rayleigh|resolving|phase difference)/i, ["screen_pattern"]],
  [/(?:incident ray|reflected ray|refracted ray|ray path|surface normals?|\btheir normals\b|normals? indicating|normals and\b|path difference|first minima|emergent ray)/i, ["ray_path"]],
  [/(?:unpolari[sz]ed|plane.?polari[sz]ed|electric field direction|malus)/i, ["transverse_field"]],
  [/(?:polari[sz]er|analy[sz]er|polaroid|brewster|malus|polari[sz]ation)/i, ["polarizer"]],
  [/(?:microscope|telescope|rayleigh|resolving power)/i, ["instrument_chain"]],
  [/(?:free[- ]body|incline|inclined plane|pulley|friction(?:al)? force|normal reaction|hanging (?:mass|block)|blocks? connected|coefficient of (?:kinetic )?friction|simple pendulum|oscillates with amplitude|force constant|moment of inertia|centre of mass|center of mass)/i, ["contact_body"]],
  [/(?:circuit|resistor|inductor|capacitor|\bLCR\b|\bRLC\b|wheatstone|galvanometer|phasor|ac source|series[- ]parallel|zener|internal resistance|cells? (?:are )?connected|\bemf\b)/i, ["circuit_network"]],
  [/(?:p[-–—]?v(?:\s+cycle|\s+diagram|\s+graph)?|thermodynamic cycle|clockwise rectangular cycle)/i, ["state_plot"]],
  [/(?:y\s*=|sketch (?:the )?(?:curve|graph)|parametric|polar curve|tangent (?:at|to)|x-intercept|implicit|projectile|trajectory|standing[- ]wave|third harmonic|node and antinode)/i, ["analytic_curve"]],
  [/(?:enclose a region|region under|region between|revolve|washer|representative (?:disk|slice|washer)|solid of revolution|area using integration)/i, ["bounded_region"]],
  [/(?:cylinder|hemisphere|frustum|right circular|composite solid|cone of radius)/i, ["solid_figure"]],
  [/(?:hydraulic|pistons?|venturi|pipe whose diameter|connected fluid)/i, ["fluid_apparatus"]],
  [/(?:point charges?|electric[- ]field|magnetic field|null point|long straight|current-carrying|microcoulomb)/i, ["point_field"]],
  [/(?:photoelectric|work function|stopping potential|bohr|energy levels?|photon energy|hydrogen atom)/i, ["energy_level"]],
  [/(?:plot [A-Z]\s*\(|triangle [A-Z]{3}|right angle|argand|equation of (?:(?:the|a) )?(?:circle|parabola|ellipse|hyperbola|line|plane)|vector equation of the (?:line|plane)|cartesian equation of the (?:line|plane)|skew lines|direction cosines?|coordinates of|\bhyperbola\b|\bellipse\b|\bparabola\b|\bfoci\b|\bdirectrix\b)/i, ["coordinate_figure"]],
  [/(?:resultant of|two vectors|vector components|parallelogram law|dot product|cross product|vector algebra|unit vector|position vectors?|projection of the vector|a vector of magnitude)/i, ["vector_diagram"]],
  [/(?:v[-–]?t graph|s[-–]?t graph|velocity[- ]time|displacement[- ]time|indicator diagram)/i, ["state_plot"]],
  [/(?:rolling without slipping|torque on a)/i, ["contact_body"]],
];

export function inferSceneCapabilities(
  question: string,
  lawIds: readonly string[] = [],
): SceneCapabilityRequirements {
  const families = new Set<SceneVisualFamily>();
  const lawText = lawIds.join(" ");
  for (const [pattern, matches] of LAW_FAMILIES) {
    if (pattern.test(lawText)) matches.forEach((family) => families.add(family));
  }
  for (const [pattern, matches] of QUESTION_FAMILIES) {
    if (pattern.test(question)) matches.forEach((family) => families.add(family));
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
  if (families.has("wavefront") && /huygens/i.test(`${question} ${lawText}`)) {
    families.add("ray_path");
    if (/(?:reflect|refract|incident)/i.test(`${question} ${lawText}`)) {
      families.add("interface");
    }
  }

  const operators = new Set(BASE_OPERATORS);
  const predicates = new Set(["exists", "label_attached"]);
  const planningGuidance = new Set<string>();
  for (const family of families) {
    FAMILY_OPERATORS[family].forEach((operator) => operators.add(operator));
    FAMILY_PREDICATES[family].forEach((predicate) => predicates.add(predicate));
    planningGuidance.add(FAMILY_GUIDANCE[family]);
  }
  const explicitVisual = /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(question);
  return {
    visualRequired: families.size > 0 || explicitVisual,
    families: [...families],
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
