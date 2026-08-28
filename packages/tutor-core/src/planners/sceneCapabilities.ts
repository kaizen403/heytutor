/** Compact, representation-level capability prediction for semantic scenes. */

import {
  applyStemFamilyOverrides,
  circuitTopologyFromProblemStructure,
  LAW_FAMILIES,
  normalizeStem,
  orderFamiliesByStemPreference,
  QUESTION_FAMILIES,
  riverBoatVariantFromProblemStructure,
  familiesFromProblemStructure,
} from "@heytutor/scene-engine";
import type { ProblemStructureView, SceneVisualFamily } from "@heytutor/scene-engine";

// The family union and the structure router live in the scene-engine seam
// (synthesize/familyClassification.ts); re-exported here for existing callers.
export { SCENE_VISUAL_FAMILIES, familiesFromProblemStructure } from "@heytutor/scene-engine";
export type { ProblemStructureView, SceneVisualFamily } from "@heytutor/scene-engine";

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
  problemIR?: ProblemStructureView | null;
  turnPlan?: {
    lawIds?: readonly string[];
    visualRequirement?: string;
  } | null;
}

const BASE_OPERATORS = [
  "point", "segment", "line", "polyline", "vector", "label", "dimension", "angle_mark",
  "tick_mark", "sign_badge",
];

const FAMILY_OPERATORS: Record<SceneVisualFamily, readonly string[]> = {
  ray_path: [
    "ray", "line", "segment", "vector", "arc", "intersection", "surface_intersection",
    "surface_contact", "normal_at", "reflect_direction", "refract_direction", "parallel_through",
    "reflect_at", "refract_at", "angle_mark", "right_angle_mark",
  ],
  axis_view: ["line", "segment", "ray", "arc", "vector", "dimension", "reflect_point", "sign_badge"],
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
    "midpoint", "tick_mark", "sign_badge",
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
    "right_angle_mark", "angle_mark", "angle_bisector", "implicit_curve", "function_curve",
    "space_frame", "space_point", "space_line", "plane", "tick_mark",
  ],
  vector_diagram: ["axes", "vector", "vector_components", "angle_mark", "label", "sign_badge", "tick_mark"],
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
  coordinate_figure: "Plot named points on axes, then construct the asked line, circle, polygon, or right-angle mark from those IDs. Intersections and tangents are derived operators, not guessed extra points. For a named hyperbola, ellipse, or parabola, use implicit_curve (or function_curve when y is explicit) on display axes; never treat a 2D conic or a planar angle-between-lines as space_frame. For 3D lines, planes, skew lines, or shortest distance, build one space_frame, then space_point / space_line / plane in that frame; never flatten a 3D question onto a guessed 2D circle.",
  vector_diagram: "Draw named vectors from a shared origin in one frame. Use vector_components for resolved parts and prove the named angle or perpendicular/parallel relation. Do not substitute a free-body or a circuit.",
};

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

/** Pure-concept markers where an honest text-only answer is expected, even if hardware words appear. */
export function isQualitativeConceptQuestion(question: string): boolean {
  return /\b(?:assertion|reason\s*\(?r?|which\s+of\s+the\s+following|which\s+of\s+these|correct\s+statement|statement(?:s)?\s+(?:is|are)|not\s+true|does\s+not\s+occur|true\s+about|match the motions|match list|column i\b|column ii\b)\b/i.test(question);
}

/** A concept MCQ that still names a spatial apparatus should keep a setup figure. */
export function qualitativeQuestionAllowsScene(question: string): boolean {
  return /(?:leans against a wall|ladder of mass|conical pendulum|banked|inclined plane|free[- ]body|pulley|lens|mirror|prism|circuit|resistor|projectile|pendulum|ray path|slit|dipole|solenoid|capacitor|incline|bar magnet|kepler|satellite|venturi|hydraulic|wheatstone|met(?:er|re) bridge|galvanometer|transformer|cyclotron|toroid|gauss|equipotential|rolling without slipping|moment of inertia|energy band|depletion[- ]region|solar cell|p-n junction|light emitting|microscope|telescope)/i.test(question);
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
  // When ProblemIR structure names families it is the live catalog: the
  // English tables below only add coverage, their delete-overrides may not
  // revoke a structure-derived family, and structure keeps the leading
  // positions. Without ProblemIR the English oracle decides, unchanged.
  const structureDecisive = Boolean(hints.problemIR) && structureFamilies.length > 0;
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
  applyStemFamilyOverrides(stem, families, {
    preserveFamilies: structureDecisive ? structureFamilies : [],
  });

  const operators = new Set(BASE_OPERATORS);
  const predicates = new Set(["exists", "label_attached"]);
  const planningGuidance = new Set<string>();
  for (const family of families) {
    FAMILY_OPERATORS[family].forEach((operator) => operators.add(operator));
    FAMILY_PREDICATES[family].forEach((predicate) => predicates.add(predicate));
    planningGuidance.add(FAMILY_GUIDANCE[family]);
  }
  // Surface the structure-derived topology to the exact planner: circuit
  // loop/branch counts and the river variant come from ProblemIR entities,
  // constraints, and facts — not from a second English regex pass.
  const circuitTopology = circuitTopologyFromProblemStructure(hints.problemIR);
  if (circuitTopology?.twoLoop) {
    planningGuidance.add(
      `ProblemIR structure shows a multi-loop network (${circuitTopology.sources} source(s), ${circuitTopology.branches} branch component(s)): draw the two-loop network with both sources and the shared branch, never a single series resistor chain.`,
    );
  }
  const riverVariant = riverBoatVariantFromProblemStructure(hints.problemIR);
  if (riverVariant) {
    const figure = riverVariant === "two_triangles"
      ? "two velocity triangles (straight-across and shortest-time)"
      : riverVariant === "crossing"
        ? "river banks with a heading-and-current velocity triangle"
        : "river banks with downstream and upstream velocities along the current";
    planningGuidance.add(`ProblemIR structure selects the river-boat figure: ${figure}; never generic origin-A-B arrows.`);
  }
  const remaining = [...families].filter((family) => !structureFamilies.includes(family));
  const ordered = [...structureFamilies, ...remaining];
  const orderedFamilies = structureDecisive
    ? ordered
    : orderFamiliesByStemPreference(stem, ordered);
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
