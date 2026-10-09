/** Compact, representation-level capability prediction for semantic scenes. */

import {
  applyStemFamilyOverrides,
  circleSourceFamilies,
  sectionSourceFamilies,
  circuitTopologyFromProblemStructure,
  LAW_FAMILIES,
  normalizeStem,
  orderFamiliesByStemPreference,
  QUESTION_FAMILIES,
  restrictFamiliesToChemistry,
  riverBoatVariantFromProblemStructure,
  familiesFromProblemStructure,
  sourceMensurationStructure,
  hasMatrixSourceProgram,
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES,
} from "@heytutor/scene-engine";
import type { ProblemStructureView, SceneVisualFamily } from "@heytutor/scene-engine";
import { isExplainRequest } from "../llm/reasoningEffort";

// The family union and the structure router live in the scene-engine seam
// (synthesize/familyClassification.ts); re-exported here for existing callers.
export { SCENE_VISUAL_FAMILIES, familiesFromProblemStructure } from "@heytutor/scene-engine";
export type { ProblemStructureView, SceneVisualFamily } from "@heytutor/scene-engine";

export interface SceneCapabilityRequirements {
  visualRequired: boolean;
  hasSourceProgram?: boolean;
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

/**
 * Chemistry kit operators accept facts and delegate every mark to the same
 * deterministic builders as the live chemistry families. Families without a
 * kit still decline instead of asking the planner for atom-by-atom geometry.
 */
const CHEMISTRY_STRUCTURE_OPERATORS = ["point", "segment", "polygon", "circle", "arc", "label", "vector"] as const;
const CHEMISTRY_LEVEL_OPERATORS = ["point", "segment", "vector", "dimension", "label", "rectangle"] as const;
const CHEMISTRY_GRAPH_OPERATORS = ["axes", "function_curve", "polyline", "point", "dimension", "label", "vector"] as const;

const FAMILY_OPERATORS: Record<SceneVisualFamily, readonly string[]> = {
  chem_coordination: CHEMISTRY_STRUCTURE_OPERATORS,
  chem_cft: CHEMISTRY_LEVEL_OPERATORS,
  chem_organic: ["chem_skeletal_molecule"],
  chem_vsepr: ["chem_vsepr_shape"],
  chem_lewis: ["chem_lewis_structure"],
  chem_mo: CHEMISTRY_LEVEL_OPERATORS,
  chem_orbital: ["chem_orbital_boxes"],
  chem_electrochem: ["point", "segment", "polyline", "polygon", "rectangle", "circle", "vector", "label"],
  chem_unit_cell: ["point", "segment", "circle", "dimension", "label"],
  chem_kinetics: CHEMISTRY_GRAPH_OPERATORS,
  chem_thermo: ["chem_reaction_energy_profile", ...CHEMISTRY_GRAPH_OPERATORS],
  chem_solutions: CHEMISTRY_GRAPH_OPERATORS,
  chem_periodic: ["axes", "polyline", "point", "rectangle", "label"],
  ray_path: [
    "ray", "line", "segment", "vector", "arc", "intersection", "surface_intersection",
    "surface_contact", "normal_at", "reflect_direction", "refract_direction", "parallel_through",
    "reflect_at", "refract_at", "angle_mark", "right_angle_mark",
  ],
  axis_view: ["line", "segment", "ray", "arc", "vector", "dimension", "reflect_point", "sign_badge", "spherical_surface", "lens_section", "gaussian_image", "optical_focus"],
  interface: ["line", "circle", "arc", "polygon", "surface_intersection", "surface_contact", "normal_at", "spherical_surface"],
  instrument_chain: ["line", "segment", "ray", "arc", "vector", "dimension", "parallel_through", "perpendicular_through", "optical_train"],
  wavefront: ["wavefront_family", "line", "vector", "perpendicular_through", "harmonic_wave", "wave_superposition", "wave_sample"],
  aperture: ["aperture", "line", "segment"],
  screen_pattern: ["screen_pattern", "line", "segment", "dimension"],
  transverse_field: ["transverse_field", "line", "vector", "harmonic_wave", "wave_superposition", "wave_sample"],
  polarizer: ["polarizer", "line", "angle_mark"],
  contact_body: ["elastic_profile", "elastic_state",
    "rectangle", "circle", "line", "segment", "vector", "vector_components",
    "surface_contact", "angle_mark", "right_angle_mark", "polyline", "rotate", "arc",
    "midpoint", "tick_mark", "sign_badge",
    "rotational_motion", "rotational_state", "planar_torque",
    "harmonic_motion", "harmonic_state", "gravitational_field", "gravitational_force",
    "constant_acceleration_trajectory", "trajectory_state", "vector_sum", "vector_scale", "vector_projection",
    "free_body", "coupled_bodies", "vertical_circle", "mechanical_energy_pair",
    "work_interval", "spring_energy", "potential_curve", "collision", "incline_friction",
    "uniform_circular_motion", "projectile_trajectory",
  ],
  circuit_network: ["flux_process", "induction_state", "flux_sinusoid", "sinusoid_state",
    "symbol", "connect", "point", "vector", "vector_components", "arc", "angle_mark",
    "impedance", "impedance_combine", "phasor_response", "kirchhoff_network",
    "metre_bridge", "potentiometer", "galvanometer",
  ],
  state_plot: ["permutation_cycles", "subset_lattice", "elastic_profile", "elastic_state", "flux_process", "induction_state", "flux_sinusoid", "sinusoid_state", "set_partition", "set_select", "harmonic_motion", "harmonic_state", "hydrostatic_profile", "hydrostatic_state", "buoyancy", "axes", "point", "polygon", "polyline", "vector", "label", "histogram", "frequency_polygon", "cumulative_frequency", "probability_tree", "polytropic_process", "isochoric_process", "process_state", "motion_graph", "potential_curve"],
  analytic_curve: ["elastic_profile", "elastic_state",
    "axes", "function_curve", "parametric_curve", "polar_curve", "implicit_curve",
    "tangent_line", "normal_line", "function_region", "point", "intersection", "vector_components",
    "conic", "conic_anchor", "conic_directrix", "conic_asymptotes", "conic_tangent",
    "constant_acceleration_trajectory", "trajectory_state",
    "curve_anchor", "curve_secant", "curve_derivative",
    "harmonic_wave", "wave_superposition", "wave_sample",
    "flux_process", "induction_state", "flux_sinusoid", "sinusoid_state", "harmonic_motion", "harmonic_state", "motion_graph", "potential_curve", "projectile_trajectory",
    "hydrostatic_profile", "hydrostatic_state", "complex_point", "complex_transform", "complex_roots",
    "histogram", "frequency_polygon", "cumulative_frequency",
  ],
  bounded_region: [
    "axes", "function_curve", "function_region", "constraint_region", "representative_slice", "solid_of_revolution", "point",
    "circle", "arc", "rectangle", "polygon", "dimension", "right_angle_mark",
  ],
  solid_figure: ["solid_projection", "solid_cross_section", "solid_anchor", "space_frame", "space_point", "point", "dimension", "label"],
  fluid_apparatus: ["elastic_profile", "elastic_state","hydrostatic_profile", "hydrostatic_state", "buoyancy", "solid_projection", "solid_cross_section", "solid_anchor", "point", "rectangle", "polygon", "polyline", "connect", "vector", "dimension", "circle"],
  point_field: ["point", "vector", "circle", "line", "dimension", "angle_mark", "electric_field", "field_components", "coulomb_pair", "point_charge_field", "field_lines", "dipole_field", "dipole_torque", "equipotential", "dipole_energy", "line_charge_field", "gauss_flux", "wire_field", "loop_field", "magnetic_force", "magnetic_components", "gravitational_field", "gravitational_force", "flux_process", "induction_state", "flux_sinusoid", "sinusoid_state", "current_element_field", "conductor_force", "parallel_wire_force", "magnetic_dipole_field", "solenoid_field", "loop_torque", "galvanometer", "bar_magnet", "cyclotron"],
  energy_level: ["axes", "segment", "vector", "dimension", "label", "rectangle", "point"],
  coordinate_figure: ["permutation_cycles", "subset_lattice","set_partition", "set_select",
    "complex_point", "complex_transform", "complex_roots",
    "axes", "point", "line", "circle", "polygon", "intersection", "tangent_line",
    "right_angle_mark", "angle_mark", "angle_bisector", "implicit_curve", "function_curve",
    "space_frame", "space_point", "space_line", "plane", "tick_mark",
    "space_project", "space_intersection", "space_closest_points", "space_segment",
    "conic", "conic_anchor", "conic_directrix", "conic_asymptotes", "conic_tangent",
    "triangle_from_sides", "triangle_from_sas", "triangle_from_asa", "triangle_center",
    "circle_from_three_points", "circle_tangent_at", "circle_tangency_points", "circle_intersections",
    "affine_point", "affine_path", "probability_tree",
    "coordinate_distance", "section_point", "axis_translation", "line_relation", "line_intercepts", "line_equation", "line_intersection_angle", "line_concurrence", "point_line_distance",
    "matrix_array", "matrix_add", "matrix_scale", "matrix_product", "matrix_transpose",
  ],
  vector_diagram: ["centre_of_mass", "com_motion", "point_mass_inertia", "simple_body_inertia", "axes_theorem", "rotational_motion", "rotational_state", "planar_torque", "magnetic_force", "magnetic_components", "gravitational_field", "gravitational_force", "axes", "vector", "vector_components", "angle_mark", "label", "sign_badge", "tick_mark", "vector_sum", "vector_scale", "vector_projection", "velocity_triangle", "collinear_velocity_pair", "crossing_strategies", "parallel_guides", "relative_velocity", "uniform_circular_motion"],
};

const CHEMISTRY_PREDICATES = ["exists", "label_attached"] as const;
const CHEMISTRY_GRAPH_PREDICATES = ["exists", "label_attached", "function_value", "on"] as const;

const FAMILY_PREDICATES: Record<SceneVisualFamily, readonly string[]> = {
  chem_coordination: CHEMISTRY_PREDICATES,
  chem_cft: CHEMISTRY_PREDICATES,
  chem_organic: CHEMISTRY_PREDICATES,
  chem_vsepr: CHEMISTRY_PREDICATES,
  chem_lewis: CHEMISTRY_PREDICATES,
  chem_mo: CHEMISTRY_PREDICATES,
  chem_orbital: CHEMISTRY_PREDICATES,
  chem_electrochem: CHEMISTRY_PREDICATES,
  chem_unit_cell: CHEMISTRY_PREDICATES,
  chem_kinetics: CHEMISTRY_GRAPH_PREDICATES,
  chem_thermo: CHEMISTRY_GRAPH_PREDICATES,
  chem_solutions: CHEMISTRY_GRAPH_PREDICATES,
  chem_periodic: CHEMISTRY_PREDICATES,
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

const CHEMISTRY_GUIDANCE =
  "No planner kit exists for this chemistry figure; return text_only instead of authoring marks.";

const FAMILY_GUIDANCE: Record<SceneVisualFamily, string> = {
  chem_coordination: CHEMISTRY_GUIDANCE,
  chem_cft: CHEMISTRY_GUIDANCE,
  chem_organic: "Use chem_skeletal_molecule panels (1..4 molecules), preferring SMILES. Comparison or reaction layout; optional from/to arrows and reagent/condition labels. Unknown names need SMILES repair. Never supply geometry.",
  chem_vsepr: "Use chem_vsepr_shape with formula and charge; otherwise text_only. Never supply geometry.",
  chem_lewis: "Use chem_lewis_structure with formula, charge and resonance; otherwise text_only. Never supply geometry.",
  chem_mo: CHEMISTRY_GUIDANCE,
  chem_orbital: "For configurations or box diagrams use chem_orbital_boxes with atomic numbers and charges; orbital shapes are text_only.",
  chem_electrochem: CHEMISTRY_GUIDANCE,
  chem_unit_cell: CHEMISTRY_GUIDANCE,
  chem_kinetics: CHEMISTRY_GUIDANCE,
  chem_thermo: "For a one-step profile use chem_reaction_energy_profile with plan quantity IDs. Graph operators remain allowed; otherwise text_only.",
  chem_solutions: CHEMISTRY_GUIDANCE,
  chem_periodic: CHEMISTRY_GUIDANCE,
  ray_path: "Derive every reflected or refracted direction with reflect_at/refract_at or the surface-contact chain; never guess ray endpoints. Prove incidence, angle, convergence, or parallelism named by the question.",
  axis_view: "Use one shared axis, reuse point IDs for named positions on it, prove their order, and attach each dimension to its actual endpoints. Draw every mirror, lens, or spherical interface with spherical_surface or lens_section so convex and concave faces are visible; never replace a curved surface with a straight line. Compress display scale without changing authoritative ratios.",
  interface: "Construct one explicit interface and one shared contact point. A spherical interface uses spherical_surface from the signed Cartesian radius; a plane interface uses a line. Derive the normal and outgoing ray from that surface, and prove the contact and governing reflection/refraction law.",
  instrument_chain: "Build one continuous optical chain on a shared axis. Objective and eyepiece lens elements are perpendicular to that axis. Use optical_train for the six rays; never guess ray endpoints or mix millimetre and centimetre world coordinates. For an afocal normal-adjustment chain, reuse one point ID for the objective image and eyepiece focus, then use optical_train for the six rays. Prove parallel input/output bundles and intermediate convergence. For a finite microscope chain, pass the object, intermediate image, and final virtual image into optical_train.",
  wavefront: "Use wavefront_family with a verified ray/path ID as direction. Prove each front is perpendicular to propagation and use derived reflected/refracted rays when a boundary is present.",
  aperture: "Use aperture for the physical opening; do not imitate slits with boxes or loose segments. Keep slit count and ordering faithful to the question.",
  screen_pattern: "Use screen_pattern for interference, diffraction, or resolution marks. Keep physical spacing in quantities and use normalized display spacing only for rendering.",
  transverse_field: "Use transverse_field for propagation plus field oscillation and prove its transverse relation. Do not substitute prose or a generic box for polarization state.",
  polarizer: "Use polarizer for every transmission axis, derive stated relative angles, and keep labels attached to their own optical element.",
  contact_body: "Construct contact surfaces and rigid bodies first. Attach every force vector to its body with a shared point ID, using vector_components with the physical surface as basis on an incline. Use free_body for explicit forces, incline_friction when mass, angle, and mu determine the contact forces, and coupled_bodies for a string or rod; do not invent a normal, friction, or gravity. Use vertical_circle when a supplied speed and radius determine the constraint force. Use work_interval, spring_energy, or collision only with the supplied source values. For a hinged rod or rotating rigid body, reuse one hinge/axis point and derive the second pose with rotate; attach weight at the centre of mass. Prove contact, perpendicular normals, equal rod lengths, and opposite action-reaction. Never draw a free-body as floating arrows or two disconnected copies of the same body.",
  circuit_network: "Every circuit component is a symbol with two terminals. Series components share consecutive terminals; parallel components share the same terminal pair. Prove path or sameTerminalPair. A supplied multi-loop graph uses kirchhoff_network and must not be redrawn as a series chain. A metre bridge or potentiometer balance uses metre_bridge or potentiometer; do not place the jockey by eye. If a phasor diagram is named, put it in a second reveal group as vectors from one origin with angle_between; do not replace symbols with arrows.",
  state_plot: "Plot named states as points on axes whose x and y spans are comparable layout numbers, not raw SI magnitudes. For supplied grouped counts, use histogram (density for unequal widths), frequency_polygon, or cumulative_frequency. Use probability_tree for explicit conditional outcome branches and computed joint leaf probabilities. A closed cycle is one polygon or polyline through shared point IDs. Independent axis scales are display-only; never place V=0.002 against P=1e5 in world coordinates.",
  analytic_curve: "Use the question's expression in function_curve, parametric_curve, polar_curve, or implicit_curve. A supplied motion or potential graph uses motion_graph or potential_curve; an incline projectile uses projectile_trajectory. Derive tangent_line and normal_line from that curve; never send a slope or guessed endpoints. Prove a named point with function_value {x, y} as cartesian coordinates on that curve (optionally include t or theta). Do not treat the parameter t as x.",
  bounded_region: "For planar mensuration, construct the source's straight or circular boundaries with polygon, rectangle, circle or arc, using shared world points and labelled dimensions. Never substitute an unrelated graph. For function-bounded area, use function_curve plus function_region and a representative_slice strip. A disk or washer about y=axisY uses representative_slice method disk or washer; solid_of_revolution derives the generating-profile silhouette. Never sketch a disk or washer by guessed polygons.",
  solid_figure: "Draw each source solid via solid_projection; retain body quantities and shared/internal joins. Dimensions declare measurementKind and use solid_anchor: radius centre to rim; diameter opposite rims (projection radius=D/2); sphere section at=0.5; cylinder height matching rims; cone/frustum height axis centres. Hollow cylinders retain innerRadius or coaxial inner/outer projections. Polyhedron spans use actual vertices. Preserve cavities and all composite parts; unsupported cuts use source-grounded representations.",
  fluid_apparatus: "Construct connected vessels or pipes with shared terminals. Use solid_projection and solid_anchor for cylindrical or spherical bodies: radii join centre to rim, diameters join opposite rim anchors on the same section. Supply dimension measurementKind for solid-anchor spans and keep each measurement attached to its own body. A fluid-level difference is measured between the actual levels, never as vessel height. Flow and force arrows attach to their bodies; do not draw disconnected tanks.",
  point_field: "Place each named charge or current-carrying wire as a point or line. Field and force vectors share those IDs. Compute point-charge fields with electric_field and field_components; schematic mode expresses direction, SI mode requires explicit consistent length and charge units. Uniform line charges use line_charge_field; spherical Gauss flux uses gauss_flux; straight-wire and loop-center B fields use wire_field and loop_field with their explicit current sign conventions. Use current_element_field for a wire, arc, or loop field, conductor_force for I L cross B, loop_torque for I(A cross B), cyclotron for mv/(|q|B), and solenoid_field, magnetic_dipole_field, galvanometer, or bar_magnet only with explicit source values. Circular field geometry around a wire is a circle, not a guessed arc family. Prove collinearity, opposite directions, or perpendicularity named by the question.",
  energy_level: "Draw energy or stopping-potential as an axis-aligned level diagram. Semiconductor topics reuse the same stacked levels: valence and conduction bands, optional donor/acceptor levels, and a p–n depletion region as adjacent regions on one axis. Transitions are segments or vectors between shared level IDs. Do not invent a circuit or a ray path for a photoelectric/Bohr energy balance; a device I–V curve is a state plot.",
  coordinate_figure: "Plot named points on axes, then construct the asked line, circle, polygon, or right-angle mark from those IDs. Intersections and tangents are derived operators, not guessed extra points. For a canonical hyperbola, ellipse, or parabola, use conic and its derived anchors, directrices, asymptotes, and tangents; use implicit_curve for a different explicit implicit equation; never treat a 2D conic or a planar angle-between-lines as space_frame. For 3D lines, planes, skew lines, or shortest distance, build one space_frame, then space_point / space_line / plane and space_project / space_intersection / space_closest_points / space_segment in that frame; never flatten a 3D question onto a guessed 2D circle.",
  vector_diagram: "Draw named vectors from a shared origin in one frame. Use vector_components for resolved parts and prove the named angle or perpendicular/parallel relation. A stream figure uses parallel_guides plus velocity_triangle, collinear_velocity_pair, or crossing_strategies; do not invent a heading or a straight-across triangle when boat speed does not exceed the current. Use relative_velocity for one shared frame and uniform_circular_motion for v^2/R. Do not substitute a free-body or a circuit.",
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

/** Phrases that are a spatial setup on their own, however the stem is phrased. */
const QUALITATIVE_SETUP_PHRASES =
  /(?:leans against a wall|ladder of mass|conical pendulum|banked|inclined plane|free[- ]body|ray path|rolling without slipping|met(?:er|re) bridge|wheatstone|equipotential|energy band|depletion[- ]region|p-n junction|solar cell|light emitting)/i;

/**
 * Apparatus nouns that imply a figure only when the stem sets the apparatus up.
 * "the electromagnetic wave in a circuit" names no circuit to draw; "two cells
 * connected across a 4 W resistor" does.
 */
const QUALITATIVE_APPARATUS_NOUNS =
  /(?:pulley|lens|mirror|prism|circuit|resistor|projectile|pendulum|slit|dipole|solenoid|capacitor|incline|bar magnet|kepler|satellite|venturi|hydraulic|galvanometer|transformer|cyclotron|toroid|gauss|moment of inertia|microscope|telescope)/i;

/** Evidence that the apparatus is arranged rather than mentioned in passing. */
const QUALITATIVE_APPARATUS_SETUP_CUE =
  /\d|\b(?:connected|placed|kept|joined|suspended|hung|hangs|immersed|across|in series|in parallel|between|as shown|shown|of radius|of length|of mass|of resistance|of capacitance)\b/i;

/** A concept MCQ that still sets up a spatial apparatus should keep a setup figure. */
export function qualitativeQuestionAllowsScene(question: string): boolean {
  return QUALITATIVE_SETUP_PHRASES.test(question)
    || (QUALITATIVE_APPARATUS_NOUNS.test(question)
      && QUALITATIVE_APPARATUS_SETUP_CUE.test(question));
}

export function inferSceneCapabilities(
  question: string,
  lawIdsOrHints: readonly string[] | SceneStructureHints = [],
): SceneCapabilityRequirements {
  const hints = normalizeHints(lawIdsOrHints);
  if (hasMatrixSourceProgram(question)) {
    return {
      visualRequired: hints.turnPlan?.visualRequirement !== "none",
      hasSourceProgram: true,
      families: [],
      constructionOperators: SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.filter((operator) => operator.startsWith("matrix_")),
      proofPredicates: ["exists", "label_attached"],
      planningGuidance: ["Preserve the complete submitted matrix source and every named given. Use source-bound matrix_array/add/scale/product/transpose constructions only, retain ordered requested expressions, and never substitute derived results for source givens. Unresolved original claims remain outside-component in a nonmetric question representation."],
    };
  }
  const lawIds = hints.lawIds ?? hints.turnPlan?.lawIds ?? [];
  const stem = normalizeStem(question);
  const explicitVisual = /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(stem);
  // An explain question with no numbers has no solved apparatus. ProblemIR
  // still sometimes stamps a field or a circuit, and the scene planner then
  // tries to draw charges for the laws of thermodynamics.
  const structureFamilies = isExplainRequest(stem) && !/\d/.test(stem)
    ? []
    : familiesFromProblemStructure(hints.problemIR);
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
  const families = new Set<SceneVisualFamily>([
    ...structureFamilies,
    ...familiesFromProblemStructure(sourceMensurationStructure(question)),
    ...circleSourceFamilies(question),
    ...sectionSourceFamilies(question),
  ]);
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
  // "thermodynamic" in a law id is not a P–V cycle. Keep state_plot only when
  // the stem actually names a process or a graph.
  const statePlotProcess =
    /(?:isothermal|adiabatic|isobaric|isochoric|carnot|indicator diagram|p\s*[-–]?\s*[vt]\s*(?:diagram|graph)|thermodynamic cycle|cyclic process)/i;
  if (
    families.has("state_plot")
    && isExplainRequest(stem)
    && !explicitVisual
    && !statePlotProcess.test(`${stem} ${lawText}`)
  ) {
    families.delete("state_plot");
  }

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
  const orderedFamilies = restrictFamiliesToChemistry(
    stem,
    structureDecisive ? ordered : orderFamiliesByStemPreference(stem, ordered),
  );
  // An explicit visual without a recognized representation still reaches the
  // universal construction language. Do not add chapter keyword routers to
  // make a reusable operator available.
  if (orderedFamilies.length === 0 && (explicitVisual || hints.turnPlan?.visualRequirement === "required")) {
    SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.forEach((operator) => operators.add(operator));
    PLANNER_VISIBLE_SCENE_PROOF_PREDICATES.forEach((predicate) => predicates.add(predicate));
    planningGuidance.add("Choose supported constructions from the question's explicit quantities and relations. Derive landmarks and numeric labels with the engine; do not guess missing physical inputs.");
  }
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
