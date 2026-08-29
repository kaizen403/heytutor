/**
 * Archetype catalog — the closed vocabulary of figures the engine knows how
 * to construct from a question's own quantities.
 *
 * An archetype is not a topic template: it is a *parameterized* figure whose
 * geometry is computed from typed slots (an angle, two masses, a resistor
 * list, an equation). The catalog owns three things per archetype:
 *
 *   - the family it belongs to (so the LLM planner's operator subset and the
 *     legacy family builders stay in step),
 *   - the slots a generator needs, with which of them are required for the
 *     figure to be *exact* rather than merely qualitative,
 *   - the picture contract: what a document must contain to count as this
 *     figure at all (completeness), and which metric predicates carry the
 *     exact tier.
 *
 * Detection (`detect.ts`) fills slots; generators (`generators/*`) turn them
 * into scene documents; `contract.ts` checks any document — generated or
 * planner-authored — against the contract. No entry here may hold board
 * coordinates.
 */
import type { SceneVisualFamily } from "../synthesize/familyClassification";

export const ARCHETYPE_IDS = [
  // Kinematics and mechanics
  "projectile",
  "free_fall",
  "incline_body",
  "atwood",
  "pulley_incline",
  "blocks_contact",
  "lift_body",
  "spring_mass",
  "simple_pendulum",
  "conical_pendulum",
  "vertical_circle",
  "circular_motion_level",
  "banked_road",
  "hinged_rod",
  "ladder_wall",
  "relative_motion_line",
  "river_boat",
  "vt_graph",
  "xt_graph",
  "fx_graph_area",
  "collision_line",
  "vectors_resultant",
  // Fields and gravitation
  "two_point_charges",
  "dipole_in_field",
  "straight_wire_field",
  "charge_in_magnetic_field",
  "solenoid_field",
  "parallel_wires",
  "parallel_plates",
  "satellite_orbit",
  "motional_emf_rod",
  // Circuits
  "resistor_network",
  "two_loop_network",
  "wheatstone_bridge",
  "meter_bridge",
  "capacitor_network",
  "potentiometer",
  // Optics
  "spherical_mirror",
  "thin_lens",
  "lens_maker",
  "spherical_refraction",
  "plane_refraction",
  "total_internal_reflection",
  "prism",
  "double_slit",
  "single_slit",
  "compound_microscope",
  "telescope",
  // Modern physics and thermodynamics
  "photoelectric",
  "bohr_transition",
  "pv_cycle",
  // Waves
  "wave_profile",
  "standing_wave",
  // Mathematics
  "function_graph",
  "area_between_curves",
  "tangent_to_curve",
  "conic",
  "circle_and_point",
  "triangle_sides",
  "space_point_plane",
  "space_lines",
  // Topic figures: the standard textbook picture, still computed from slots when numbers exist
  "shm_energy",
  "shm_superposition",
  "wave_types",
  "force_on_conductor",
  "current_loop_torque",
  "revolving_charge",
  "bar_magnet",
  "bar_magnet_in_field",
  "faraday_induction",
  "inductance_coils",
  "radioactive_decay",
  "cooling_curve",
  "logic_gates",
  "centre_of_mass",
  "escape_velocity",
  "velocity_selector",
  "magnetic_susceptibility",
  "binding_energy_curve",
  "vernier_calliper",
  "screw_gauge",
] as const;

export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

const ARCHETYPE_ID_SET: ReadonlySet<string> = new Set(ARCHETYPE_IDS);

export function isArchetypeId(value: unknown): value is ArchetypeId {
  return typeof value === "string" && ARCHETYPE_ID_SET.has(value);
}

export type SlotKind = "number" | "angle" | "expression" | "text" | "choice" | "numbers" | "expressions";

export interface SlotSpec {
  kind: SlotKind;
  /** Display unit hint; detection normalizes to it where it can. */
  unit?: string;
  /** Allowed values for `choice`. */
  choices?: readonly string[];
  /** Required for the figure to exist at all (not just for exact tier). */
  required?: boolean;
  /** Required before the generator may claim `exact_verified`. */
  metric?: boolean;
}

export type SlotValue = number | string | number[] | string[];
export type Slots = Record<string, SlotValue>;

/**
 * What a document must contain to *be* this figure. Roles match entity
 * `role` text case-insensitively as substrings; operators and symbols match
 * construction operators / `symbol` inputs exactly.
 */
export interface PictureContract {
  roles: readonly string[];
  operators?: readonly string[];
  symbols?: readonly string[];
  /** Any of these present means the picture is a different figure. */
  forbidSymbols?: readonly string[];
  forbidOperators?: readonly string[];
  forbidRoles?: readonly string[];
  /** Minimum count of entities whose role matches, e.g. two bodies. */
  minRoleCount?: Readonly<Record<string, number>>;
  /** Fatal assertion predicates that carry the exact tier when slot values are plan-backed. */
  metric: readonly string[];
}

export interface ArchetypeSpec {
  id: ArchetypeId;
  family: SceneVisualFamily;
  label: string;
  slots: Readonly<Record<string, SlotSpec>>;
  contract: PictureContract;
}

const angle = (extra: Partial<SlotSpec> = {}): SlotSpec => ({ kind: "angle", unit: "degree", ...extra });
const num = (unit?: string, extra: Partial<SlotSpec> = {}): SlotSpec => ({ kind: "number", unit, ...extra });
const expr = (extra: Partial<SlotSpec> = {}): SlotSpec => ({ kind: "expression", ...extra });
const choice = (choices: readonly string[], extra: Partial<SlotSpec> = {}): SlotSpec => ({ kind: "choice", choices, ...extra });

export const ARCHETYPES: Readonly<Record<ArchetypeId, ArchetypeSpec>> = {
  projectile: {
    id: "projectile", family: "contact_body", label: "projectile on level ground or from a height",
    slots: { u: num("m/s", { metric: true }), theta: angle({ metric: true }), h0: num("m"), g: num("m/s^2") },
    contract: { roles: ["launch point", "trajectory", "launch velocity", "ground"], metric: ["angle_between", "function_value", "on"] },
  },
  free_fall: {
    id: "free_fall", family: "contact_body", label: "body dropped or thrown vertically",
    slots: { h: num("m", { metric: true }), u: num("m/s"), direction: choice(["down", "up"]) },
    contract: { roles: ["body", "ground", "height"], metric: ["distance_ratio", "equal_length"] },
  },
  incline_body: {
    id: "incline_body", family: "contact_body", label: "block on an inclined plane with forces",
    slots: { theta: angle({ required: true, metric: true }), mu: num(), mass: num("kg"), applied: num("N"), rolling: choice(["yes", "no"]) },
    contract: { roles: ["inclined plane", "body", "weight", "normal"], metric: ["angle_between", "perpendicular"] },
  },
  atwood: {
    id: "atwood", family: "contact_body", label: "two masses over a fixed pulley",
    slots: { m1: num("kg"), m2: num("kg") },
    contract: { roles: ["pulley", "body", "string", "tension", "weight"], minRoleCount: { body: 2, tension: 2 }, metric: [] },
  },
  pulley_incline: {
    id: "pulley_incline", family: "contact_body", label: "block on an incline tied over a pulley to a hanging mass",
    slots: { theta: angle({ required: true, metric: true }), m1: num("kg"), m2: num("kg"), mu: num() },
    contract: { roles: ["inclined plane", "pulley", "body", "string", "weight"], minRoleCount: { body: 2 }, metric: ["angle_between", "perpendicular"] },
  },
  blocks_contact: {
    id: "blocks_contact", family: "contact_body", label: "a block, or blocks in contact or tied, on a surface pushed by a force",
    slots: { masses: { kind: "numbers", unit: "kg" }, force: num("N"), mu: num(), connection: choice(["contact", "string"]) },
    contract: { roles: ["body", "surface", "applied force"], minRoleCount: { body: 1 }, metric: ["equal_length"] },
  },
  lift_body: {
    id: "lift_body", family: "contact_body", label: "body in an accelerating lift",
    slots: { a: num("m/s^2"), mass: num("kg"), direction: choice(["up", "down"]) },
    contract: { roles: ["body", "floor", "weight", "normal", "acceleration"], metric: ["perpendicular"] },
  },
  spring_mass: {
    id: "spring_mass", family: "contact_body", label: "block on a spring with equilibrium and displacement",
    slots: { k: num("N/m"), mass: num("kg"), amplitude: num("m"), orientation: choice(["horizontal", "vertical"]) },
    contract: { roles: ["spring", "body", "equilibrium", "displacement"], metric: ["equal_length"] },
  },
  simple_pendulum: {
    id: "simple_pendulum", family: "contact_body", label: "pendulum bob displaced from the vertical",
    slots: { length: num("m"), theta: angle({ metric: true }) },
    contract: { roles: ["pivot", "string", "bob", "weight", "vertical"], metric: ["angle_between", "equal_length"] },
  },
  conical_pendulum: {
    id: "conical_pendulum", family: "contact_body", label: "conical pendulum with the string at an angle to the vertical",
    slots: { length: num("m"), theta: angle({ metric: true }) },
    contract: { roles: ["pivot", "string", "bob", "circle", "vertical"], metric: ["angle_between"] },
  },
  vertical_circle: {
    id: "vertical_circle", family: "contact_body", label: "body whirled in a vertical circle",
    slots: { radius: num("m") },
    contract: { roles: ["circular path", "body", "weight", "tension"], metric: ["equal_length"] },
  },
  circular_motion_level: {
    id: "circular_motion_level", family: "contact_body", label: "body on a level circular path with centripetal force",
    slots: { radius: num("m"), speed: num("m/s"), mu: num() },
    contract: { roles: ["circular path", "body", "centripetal", "velocity"], metric: ["perpendicular"] },
  },
  banked_road: {
    id: "banked_road", family: "contact_body", label: "vehicle on a banked curve",
    slots: { theta: angle({ required: true, metric: true }), radius: num("m") },
    contract: { roles: ["banked surface", "body", "weight", "normal"], metric: ["angle_between", "perpendicular"] },
  },
  hinged_rod: {
    id: "hinged_rod", family: "contact_body", label: "uniform rod hinged at one end",
    slots: { length: num("m"), mass: num("kg"), theta: angle(), orientation: choice(["horizontal", "vertical", "angled"]) },
    contract: { roles: ["hinge", "rod", "centre of mass", "weight"], metric: ["angle_between", "equal_length", "on"] },
  },
  ladder_wall: {
    id: "ladder_wall", family: "contact_body", label: "ladder leaning on a wall",
    slots: { theta: angle({ metric: true }), length: num("m") },
    contract: { roles: ["ladder", "wall", "floor", "weight", "normal"], metric: ["angle_between"] },
  },
  relative_motion_line: {
    id: "relative_motion_line", family: "contact_body", label: "two bodies moving along one line",
    slots: { vA: num("m/s"), vB: num("m/s"), gap: num("m"), sameDirection: choice(["yes", "no"]) },
    contract: { roles: ["velocity", "line"], minRoleCount: { velocity: 2 }, metric: ["distance_ratio", "equal_length"] },
  },
  river_boat: {
    id: "river_boat", family: "vector_diagram", label: "boat on a river with the velocity triangle",
    slots: { vb: num("m/s", { metric: true }), vc: num("m/s", { metric: true }), variant: choice(["crossing", "along_stream", "two_triangles"]) },
    contract: { roles: ["bank", "boat", "current", "resultant"], metric: ["angle_between", "distance_ratio"] },
  },
  vt_graph: {
    id: "vt_graph", family: "state_plot", label: "velocity–time graph from motion phases",
    slots: { phases: { kind: "text", required: true } },
    contract: { roles: ["v-t axes", "phase"], operators: ["axes"], metric: ["function_value"] },
  },
  xt_graph: {
    id: "xt_graph", family: "analytic_curve", label: "position–time graph of x(t)",
    slots: { expression: expr({ required: true, metric: true }), tMax: num("s") },
    contract: { roles: ["x-t axes", "x(t)"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  fx_graph_area: {
    id: "fx_graph_area", family: "analytic_curve", label: "force–displacement graph with the work area",
    slots: { expression: expr({ required: true, metric: true }), from: num("m"), to: num("m") },
    contract: { roles: ["F-x axes", "F(x)", "work"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  collision_line: {
    id: "collision_line", family: "contact_body", label: "two bodies colliding along a line",
    slots: { m1: num("kg"), m2: num("kg"), u1: num("m/s"), u2: num("m/s") },
    contract: { roles: ["body", "velocity"], minRoleCount: { body: 2 }, metric: ["equal_length"] },
  },
  vectors_resultant: {
    id: "vectors_resultant", family: "vector_diagram", label: "two vectors from one origin with their resultant",
    slots: { a: num(undefined, { metric: true }), b: num(undefined, { metric: true }), theta: angle({ metric: true }) },
    contract: { roles: ["origin", "vector", "resultant"], minRoleCount: { vector: 2 }, metric: ["angle_between", "distance_ratio"] },
  },
  two_point_charges: {
    id: "two_point_charges", family: "point_field", label: "two point charges on a line with a field point",
    slots: { q1: num("C"), q2: num("C"), d: num("m", { metric: true }), fieldPoint: choice(["between", "outside", "none"]) },
    contract: { roles: ["point charge", "separation"], minRoleCount: { "point charge": 2 }, metric: ["distance_ratio"] },
  },
  dipole_in_field: {
    id: "dipole_in_field", family: "point_field", label: "electric dipole in a uniform field",
    slots: { theta: angle({ metric: true }) },
    contract: { roles: ["point charge", "dipole", "field"], minRoleCount: { "point charge": 2 }, metric: ["angle_between"] },
  },
  straight_wire_field: {
    id: "straight_wire_field", family: "point_field", label: "long straight current with circular field lines",
    slots: { current: num("A"), r: num("m", { metric: true }) },
    contract: { roles: ["wire", "field line", "field point"], operators: ["circle"], metric: ["distance_ratio"] },
  },
  charge_in_magnetic_field: {
    id: "charge_in_magnetic_field", family: "point_field", label: "charged particle in a uniform magnetic field",
    slots: { B: num("T"), v: num("m/s"), radius: num("m") },
    contract: { roles: ["magnetic field", "particle", "circular path", "velocity"], metric: ["perpendicular"] },
  },
  solenoid_field: {
    id: "solenoid_field", family: "point_field", label: "solenoid or toroid with its axial field",
    slots: { turns: num(), current: num("A") },
    contract: { roles: ["solenoid", "turn", "axial field"], minRoleCount: { turn: 3 }, metric: ["parallel"] },
  },
  parallel_wires: {
    id: "parallel_wires", family: "point_field", label: "two parallel currents and the force between them",
    slots: { d: num("m", { metric: true }), i1: num("A"), i2: num("A") },
    contract: { roles: ["wire", "force"], minRoleCount: { wire: 2 }, metric: ["parallel", "distance_ratio"] },
  },
  parallel_plates: {
    id: "parallel_plates", family: "point_field", label: "parallel plates with the field between",
    slots: { d: num("m"), area: num("m^2") },
    contract: { roles: ["plate", "field"], minRoleCount: { plate: 2 }, metric: ["parallel"] },
  },
  satellite_orbit: {
    id: "satellite_orbit", family: "point_field", label: "satellite on a circular orbit around a planet",
    slots: { radius: num("m", { metric: true }), height: num("m"), planetRadius: num("m") },
    contract: { roles: ["planet", "orbit", "satellite", "radius"], operators: ["circle"], metric: ["distance_ratio"] },
  },
  motional_emf_rod: {
    id: "motional_emf_rod", family: "point_field", label: "conducting rod moving through a magnetic field",
    slots: { length: num("m"), v: num("m/s"), B: num("T") },
    contract: { roles: ["rod", "velocity", "magnetic field"], metric: ["perpendicular"] },
  },
  resistor_network: {
    id: "resistor_network", family: "circuit_network", label: "resistors in series, parallel, or a series–parallel mix",
    slots: { resistors: { kind: "numbers", unit: "ohm" }, topology: choice(["series", "parallel", "series_parallel", "parallel_series", "both"], { required: true }), emf: num("V") },
    contract: { roles: ["resistor"], symbols: ["resistor"], minRoleCount: { resistor: 2 }, metric: [] },
  },
  two_loop_network: {
    id: "two_loop_network", family: "circuit_network", label: "two-loop network with two sources and a shared branch",
    slots: { resistors: { kind: "numbers", unit: "ohm" }, emfs: { kind: "numbers", unit: "V" } },
    contract: { roles: ["resistor", "source"], symbols: ["resistor", "battery"], minRoleCount: { resistor: 3, source: 2 }, metric: [] },
  },
  wheatstone_bridge: {
    id: "wheatstone_bridge", family: "circuit_network", label: "Wheatstone bridge with a galvanometer",
    slots: { resistors: { kind: "numbers", unit: "ohm" } },
    contract: { roles: ["bridge arm", "galvanometer"], symbols: ["resistor", "galvanometer"], minRoleCount: { "bridge arm": 4 }, metric: [] },
  },
  meter_bridge: {
    id: "meter_bridge", family: "circuit_network", label: "metre bridge with the balance point on the wire",
    slots: { balance: num("cm", { metric: true }), known: num("ohm") },
    contract: { roles: ["bridge wire", "jockey", "galvanometer", "gap"], symbols: ["galvanometer"], metric: ["distance_ratio"] },
  },
  capacitor_network: {
    id: "capacitor_network", family: "circuit_network", label: "capacitors in series or parallel",
    slots: { capacitors: { kind: "numbers", unit: "uF" }, topology: choice(["series", "parallel", "series_parallel"], { required: true }), emf: num("V") },
    contract: { roles: ["capacitor"], symbols: ["capacitor"], forbidSymbols: ["resistor"], minRoleCount: { capacitor: 2 }, metric: [] },
  },
  potentiometer: {
    id: "potentiometer", family: "circuit_network", label: "potentiometer with a driver cell and a balance length",
    slots: { balance: num("cm", { metric: true }), wireLength: num("cm") },
    contract: { roles: ["potentiometer wire", "driver", "jockey", "galvanometer"], symbols: ["galvanometer"], metric: ["distance_ratio"] },
  },
  spherical_mirror: {
    id: "spherical_mirror", family: "axis_view", label: "concave or convex mirror ray diagram",
    slots: { kind: choice(["concave", "convex"], { required: true }), u: num("cm", { metric: true }), f: num("cm", { metric: true }), v: num("cm") },
    contract: { roles: ["mirror", "principal axis", "object", "image", "focus"], metric: ["distance_ratio", "converges", "on"] },
  },
  thin_lens: {
    id: "thin_lens", family: "axis_view", label: "convex or concave lens ray diagram",
    slots: { kind: choice(["convex", "concave"], { required: true }), u: num("cm", { metric: true }), f: num("cm", { metric: true }), v: num("cm") },
    contract: { roles: ["lens", "principal axis", "object", "image", "focus"], operators: ["lens_section"], metric: ["distance_ratio", "converges", "on"] },
  },
  lens_maker: {
    id: "lens_maker", family: "axis_view", label: "lens maker two spherical surfaces",
    slots: {
      kind: choice(["biconvex", "biconcave", "plano-convex", "plano-concave"], { required: true }),
      n: num(undefined, { metric: true }),
      n0: num(),
      R1: num("cm", { metric: true }),
      R2: num("cm", { metric: true }),
    },
    contract: {
      roles: ["principal axis", "spherical surface", "centre of curvature"],
      operators: ["spherical_surface"],
      minRoleCount: { "spherical surface": 2, "centre of curvature": 2 },
      forbidSymbols: ["resistor"],
      metric: ["distance_ratio"],
    },
  },
  spherical_refraction: {
    id: "spherical_refraction", family: "interface", label: "refraction at a spherical surface",
    slots: {
      kind: choice(["convex", "concave"]),
      u: num("cm", { metric: true }),
      R: num("cm", { metric: true }),
      n1: num(),
      n2: num(undefined, { metric: true }),
    },
    contract: {
      roles: ["spherical surface", "principal axis", "object", "image", "centre of curvature", "vertex"],
      operators: ["spherical_surface"],
      metric: ["distance_ratio", "on"],
    },
  },
  plane_refraction: {
    id: "plane_refraction", family: "interface", label: "refraction at a plane interface",
    slots: { i: angle({ required: true, metric: true }), n1: num(), n2: num(undefined, { metric: true }) },
    contract: { roles: ["interface", "normal", "incident", "refracted"], metric: ["snells_law", "angle_between"] },
  },
  total_internal_reflection: {
    id: "total_internal_reflection", family: "interface", label: "critical angle and total internal reflection",
    slots: { n1: num(), n2: num(), i: angle() },
    contract: { roles: ["interface", "normal", "incident", "reflected"], metric: ["equal_angle", "angle_between"] },
  },
  prism: {
    id: "prism", family: "interface", label: "ray through a prism with the deviation angle",
    slots: { A: angle({ required: true, metric: true }), i: angle(), n: num(undefined, { metric: true }) },
    contract: { roles: ["prism section", "refracting face", "normal", "ray entering"], metric: ["snells_law", "angle_between"] },
  },
  double_slit: {
    id: "double_slit", family: "aperture", label: "Young's double slit with screen and fringes",
    slots: { d: num("m"), D: num("m"), lambda: num("m") },
    contract: { roles: ["slit", "screen", "fringe", "ray"], operators: ["aperture", "screen_pattern"], metric: ["distance_ratio"] },
  },
  single_slit: {
    id: "single_slit", family: "aperture", label: "single-slit diffraction",
    slots: { a: num("m"), D: num("m"), lambda: num("m") },
    contract: { roles: ["slit", "screen", "central maximum"], operators: ["aperture", "screen_pattern"], metric: ["distance_ratio"] },
  },
  compound_microscope: {
    id: "compound_microscope", family: "instrument_chain", label: "compound microscope ray chain",
    slots: { fo: num("cm", { metric: true }), fe: num("cm", { metric: true }), uo: num("cm"), tubeLength: num("cm") },
    contract: { roles: ["objective", "eyepiece", "optical axis", "object"], operators: ["optical_train"], metric: ["converges", "parallel"] },
  },
  telescope: {
    id: "telescope", family: "instrument_chain", label: "astronomical telescope in normal adjustment",
    slots: { fo: num("cm", { metric: true }), fe: num("cm", { metric: true }) },
    contract: { roles: ["objective", "eyepiece", "optical axis"], operators: ["optical_train"], metric: ["converges", "parallel"] },
  },
  photoelectric: {
    id: "photoelectric", family: "energy_level", label: "photoelectric energy balance or stopping-potential graph",
    slots: { workFunction: num("eV"), photonEnergy: num("eV"), lambda: num("nm") },
    contract: { roles: ["energy axis", "work function", "photon", "kinetic energy"], forbidRoles: ["energy level n"], metric: ["distance_ratio"] },
  },
  bohr_transition: {
    id: "bohr_transition", family: "energy_level", label: "Bohr energy levels with a transition",
    slots: { from: num(), to: num() },
    contract: { roles: ["energy level", "transition"], minRoleCount: { "energy level": 2 }, metric: ["ordered_along"] },
  },
  pv_cycle: {
    id: "pv_cycle", family: "state_plot", label: "P–V diagram built from the named processes",
    slots: { processes: { kind: "text", required: true } },
    contract: { roles: ["P-V axes", "state", "process"], operators: ["axes"], minRoleCount: { state: 3 }, metric: ["function_value"] },
  },
  wave_profile: {
    id: "wave_profile", family: "analytic_curve", label: "one wavelength of a wave with amplitude and wavelength marked",
    slots: { amplitude: num("m", { metric: true }), wavelength: num("m", { metric: true }), expression: expr() },
    contract: { roles: ["wave", "amplitude", "wavelength"], operators: ["function_curve"], metric: ["function_value"] },
  },
  standing_wave: {
    id: "standing_wave", family: "analytic_curve", label: "standing wave mode with nodes and antinodes",
    slots: { harmonic: num(), length: num("m"), ends: choice(["fixed", "open", "closed_open"]) },
    contract: { roles: ["wave", "node", "antinode"], operators: ["function_curve"], metric: ["function_value"] },
  },
  function_graph: {
    id: "function_graph", family: "analytic_curve", label: "graph of one or more explicit functions",
    slots: { expressions: { kind: "expressions", required: true, metric: true }, xMin: num(), xMax: num() },
    contract: { roles: ["axes", "curve"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  area_between_curves: {
    id: "area_between_curves", family: "bounded_region", label: "region enclosed by curves",
    slots: { expressions: { kind: "expressions", required: true }, xMin: num(), xMax: num() },
    contract: { roles: ["axes", "curve", "region"], operators: ["axes", "function_curve", "function_region"], metric: ["function_value", "root"] },
  },
  tangent_to_curve: {
    id: "tangent_to_curve", family: "analytic_curve", label: "curve with the tangent at a point",
    slots: { expression: expr({ required: true, metric: true }), x0: num(undefined, { required: true, metric: true }) },
    contract: { roles: ["axes", "curve", "tangent", "point of tangency"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  conic: {
    id: "conic", family: "coordinate_figure", label: "conic from its equation with focus and directrix",
    slots: { kind: choice(["parabola", "ellipse", "hyperbola", "circle"], { required: true }), equation: expr({ required: true, metric: true }) },
    contract: { roles: ["axes", "conic"], operators: ["axes"], metric: ["function_value", "on"] },
  },
  circle_and_point: {
    id: "circle_and_point", family: "coordinate_figure", label: "circle with an external point and tangents",
    slots: { cx: num(undefined, { metric: true }), cy: num(undefined, { metric: true }), r: num(undefined, { required: true, metric: true }), px: num(), py: num() },
    contract: { roles: ["axes", "circle", "centre"], operators: ["axes", "circle"], metric: ["distance_ratio", "on"] },
  },
  triangle_sides: {
    id: "triangle_sides", family: "coordinate_figure", label: "triangle from three sides or vertices",
    slots: { a: num(undefined, { metric: true }), b: num(undefined, { metric: true }), c: num(undefined, { metric: true }) },
    contract: { roles: ["vertex", "side"], minRoleCount: { vertex: 3, side: 3 }, metric: ["distance_ratio", "equal_length"] },
  },
  space_point_plane: {
    id: "space_point_plane", family: "coordinate_figure", label: "point and plane in 3D with the perpendicular",
    slots: { point: { kind: "numbers" }, plane: { kind: "numbers" } },
    contract: { roles: ["frame", "plane", "point", "shortest distance"], operators: ["space_frame", "plane", "space_point"], metric: ["on", "perpendicular"] },
  },
  space_lines: {
    id: "space_lines", family: "coordinate_figure", label: "two lines in 3D",
    slots: { line1: { kind: "text" }, line2: { kind: "text" } },
    contract: { roles: ["frame", "line"], operators: ["space_frame", "space_line"], minRoleCount: { line: 2 }, metric: ["on"] },
  },
  shm_energy: {
    id: "shm_energy", family: "analytic_curve", label: "kinetic, potential and total energy against displacement in SHM",
    slots: { amplitude: num("m"), k: num("N/m") },
    contract: { roles: ["energy axes", "kinetic energy", "potential energy", "total energy"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  shm_superposition: {
    id: "shm_superposition", family: "analytic_curve", label: "two SHMs along a line and their superposition",
    slots: { phase: angle(), amplitude: num("m") },
    contract: { roles: ["axes", "first SHM", "second SHM", "resultant"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  wave_types: {
    id: "wave_types", family: "analytic_curve", label: "transverse and longitudinal waves side by side",
    slots: {},
    contract: { roles: ["transverse wave", "longitudinal wave", "compression", "rarefaction"], operators: ["function_curve"], metric: [] },
  },
  force_on_conductor: {
    id: "force_on_conductor", family: "point_field", label: "straight conductor in a uniform magnetic field with the force on it",
    slots: { length: num("m"), current: num("A"), B: num("T") },
    contract: { roles: ["conductor", "current", "magnetic field", "force"], metric: ["perpendicular"] },
  },
  current_loop_torque: {
    id: "current_loop_torque", family: "point_field", label: "rectangular current loop in a uniform field with the forces on its sides",
    slots: { current: num("A"), B: num("T") },
    contract: { roles: ["current loop", "magnetic field", "force"], minRoleCount: { force: 2 }, metric: ["opposite_direction"] },
  },
  revolving_charge: {
    id: "revolving_charge", family: "point_field", label: "charge revolving on a circle with its equivalent current and magnetic moment",
    slots: { radius: num("m") },
    contract: { roles: ["orbit", "charge", "velocity", "magnetic moment"], operators: ["circle"], metric: ["perpendicular"] },
  },
  bar_magnet: {
    id: "bar_magnet", family: "point_field", label: "bar magnet with its field lines and a point on the axis",
    slots: { d: num("m") },
    contract: { roles: ["bar magnet", "north pole", "south pole", "field line"], minRoleCount: { "field line": 2 }, metric: [] },
  },
  bar_magnet_in_field: {
    id: "bar_magnet_in_field", family: "point_field", label: "bar magnet (magnetic dipole) at an angle to a uniform field with the forces on its poles",
    slots: { theta: angle({ metric: true }) },
    contract: { roles: ["bar magnet", "magnetic field", "force"], minRoleCount: { force: 2 }, metric: ["angle_between"] },
  },
  faraday_induction: {
    id: "faraday_induction", family: "circuit_network", label: "coil, galvanometer and a moving magnet",
    slots: {},
    contract: { roles: ["coil", "galvanometer", "magnet", "velocity"], symbols: ["galvanometer"], metric: [] },
  },
  inductance_coils: {
    id: "inductance_coils", family: "circuit_network", label: "self inductance (one coil) or mutual inductance (two coils)",
    slots: { kind: choice(["self", "mutual"], { required: true }) },
    contract: { roles: ["coil"], symbols: ["inductor"], metric: [] },
  },
  radioactive_decay: {
    id: "radioactive_decay", family: "analytic_curve", label: "N against t for radioactive decay with half-life marks",
    slots: { halfLife: num("s"), N0: num() },
    contract: { roles: ["decay curve", "half-life"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  cooling_curve: {
    id: "cooling_curve", family: "analytic_curve", label: "temperature against time under Newton's law of cooling",
    slots: { ambient: num("°C"), initial: num("°C") },
    contract: { roles: ["cooling curve", "ambient temperature"], operators: ["axes", "function_curve"], metric: ["function_value"] },
  },
  logic_gates: {
    id: "logic_gates", family: "circuit_network", label: "logic gate symbols with inputs and output",
    slots: { gates: { kind: "text" } },
    contract: { roles: ["gate", "input", "output"], minRoleCount: { gate: 1 }, metric: [] },
  },
  centre_of_mass: {
    id: "centre_of_mass", family: "contact_body", label: "masses on a line with their centre of mass",
    slots: { masses: { kind: "numbers", unit: "kg" }, positions: { kind: "numbers", unit: "m" } },
    contract: { roles: ["body", "centre of mass"], minRoleCount: { body: 2 }, metric: ["distance_ratio"] },
  },
  escape_velocity: {
    id: "escape_velocity", family: "point_field", label: "body leaving a planet radially with the escape speed",
    slots: { planetRadius: num("m") },
    contract: { roles: ["planet", "body", "escape velocity", "gravitational force"], operators: ["circle"], metric: [] },
  },
  velocity_selector: {
    id: "velocity_selector", family: "point_field", label: "crossed electric and magnetic fields with a charge passing undeflected",
    slots: { E: num("N/C"), B: num("T") },
    contract: { roles: ["electric field", "magnetic field", "charge", "velocity"], minRoleCount: { force: 2 }, metric: ["opposite_direction"] },
  },
  magnetic_susceptibility: {
    id: "magnetic_susceptibility", family: "analytic_curve", label: "susceptibility against temperature for dia-, para- and ferromagnetic materials",
    // Law-shaped curves: the ordinates are model values, never a measurement of the stem, so no slot is metric.
    slots: { curieTemperature: num("K") },
    contract: { roles: ["axes", "paramagnetic", "diamagnetic", "ferromagnetic"], operators: ["axes", "function_curve"], metric: [] },
  },
  binding_energy_curve: {
    id: "binding_energy_curve", family: "analytic_curve", label: "binding energy per nucleon against mass number",
    // Semi-empirical shape with a peak near A≈56: honest as a curve, never exact.
    slots: { massNumber: num() },
    contract: { roles: ["axes", "binding energy per nucleon", "most stable"], operators: ["axes", "function_curve"], metric: [] },
  },
  vernier_calliper: {
    id: "vernier_calliper", family: "fluid_apparatus", label: "vernier calliper with main scale, vernier scale and jaws",
    slots: { mainScaleReading: num("mm", { metric: true }), vernierDivision: num(undefined, { metric: true }), zeroError: choice(["none", "positive", "negative"]) },
    contract: { roles: ["main scale", "vernier scale", "jaw"], minRoleCount: { jaw: 2 }, metric: ["distance_ratio"] },
  },
  screw_gauge: {
    id: "screw_gauge", family: "fluid_apparatus", label: "screw gauge with sleeve (pitch) scale, thimble (circular) scale, spindle and anvil",
    slots: { pitch: num("mm"), divisions: num(), zeroError: choice(["none", "positive", "negative"]) },
    contract: { roles: ["sleeve", "thimble", "spindle", "anvil"], metric: [] },
  },
};

export function archetypeSpec(id: ArchetypeId): ArchetypeSpec {
  return ARCHETYPES[id];
}

export function archetypeFamily(id: ArchetypeId): SceneVisualFamily {
  return ARCHETYPES[id].family;
}
