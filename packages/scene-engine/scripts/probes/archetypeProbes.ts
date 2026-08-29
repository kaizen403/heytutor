/**
 * Archetype picture corpus — questions a student would actually type, with
 * the figure each one must produce.
 *
 * This is a test oracle for the archetype layer: `verify-archetype-pictures`
 * asserts the detected archetype, the minimum representation tier, and that a
 * document compiles under the picture contract. Variants of one physical
 * situation are grouped so a phrasing change cannot silently change the
 * figure. Nothing here is consulted at runtime.
 */
import type { ArchetypeId } from "../../src/archetypes/catalog";

export type TierFloor = "exact_verified" | "qualitative_verified";

export interface ArchetypeProbe {
  id: string;
  question: string;
  /** Expected archetype, or null when the layer must decline (pure algebra, definitions). */
  archetype: ArchetypeId | null;
  /** Lowest acceptable tier when a scene is expected. */
  tier?: TierFloor;
  /** Probes sharing a group must resolve to the same archetype. */
  group?: string;
  /** Archetypes without a generator yet: detection is asserted, no scene is required. */
  detectOnly?: boolean;
  /** The archetype is detected but its generator must decline (another layer owns the figure). */
  declines?: boolean;
  /** Exact count of circuit symbols the figure must contain (0 forbids the symbol). */
  symbols?: Readonly<Record<string, number>>;
  /** Construction operators the figure must use (e.g. normal_at for a contact normal). */
  operators?: readonly string[];
  /** Annotation kinds the figure must carry (e.g. hatch on a contact surface). */
  annotations?: readonly string[];
  /** Entity ids the figure must declare (shared contracts with the family gate, e.g. `weight`, `force`). */
  entities?: readonly string[];
}

export const ARCHETYPE_PROBES: readonly ArchetypeProbe[] = [
  // Kinematics
  { id: "proj-thrown", group: "projectile", archetype: "projectile", tier: "exact_verified", question: "A ball is thrown at 20 m/s at 30 degrees above the horizontal. Find the maximum height and the horizontal range." },
  { id: "proj-launched", group: "projectile", archetype: "projectile", tier: "exact_verified", question: "A projectile is launched with speed 20 m/s at 30 degrees to the horizontal. Find the range." },
  { id: "proj-kicked", group: "projectile", archetype: "projectile", tier: "exact_verified", question: "A ball is kicked at 20 m/s making 30 degrees with the ground. How far away does it land?" },
  { id: "proj-time", group: "projectile", archetype: "projectile", tier: "exact_verified", question: "Find the time of flight of a body projected from the ground at 30° with 20 m/s." },
  { id: "proj-tower", archetype: "projectile", tier: "exact_verified", question: "A stone is thrown horizontally at 15 m/s from the top of a tower 20 m high. Find where it hits the ground." },
  { id: "fall-dropped", group: "free_fall", archetype: "free_fall", tier: "qualitative_verified", question: "A stone is dropped from the top of a 45 m tall tower. How long does it take to reach the ground?" },
  { id: "fall-released", group: "free_fall", archetype: "free_fall", tier: "qualitative_verified", question: "A stone is released from rest at a height of 45 m. Find the time to hit the ground." },
  { id: "fall-vertical-up", archetype: "free_fall", tier: "qualitative_verified", question: "If a ball is thrown vertically upwards with speed u, the distance covered during the last t seconds of its ascent is" },
  { id: "fall-raindrop", archetype: "free_fall", tier: "qualitative_verified", entities: ["weight"], question: "A raindrop of mass 1 g starts from rest at height 1 km and hits the ground at 5 m/s." },
  { id: "vt-three-phases", archetype: "vt_graph", tier: "qualitative_verified", question: "A car accelerates uniformly from rest to 20 m/s in 10 s, then moves at constant speed for 20 s, then decelerates to rest in 5 s. Draw the velocity-time graph and find the total distance travelled." },
  { id: "vt-train", archetype: "vt_graph", tier: "qualitative_verified", question: "A train starts from rest and accelerates at 2 m/s^2 for 10 s, then travels at constant velocity for 30 s and finally retards uniformly to rest in 20 s. Draw the v-t graph." },
  { id: "xt-quadratic", archetype: "xt_graph", tier: "exact_verified", question: "The position of a particle along a line is x = 3t^2 - 2t + 1 metres. Sketch the position-time graph for 0 to 4 s and find the velocity at t = 2 s." },
  { id: "xt-shm", archetype: "xt_graph", tier: "exact_verified", question: "A particle executes simple harmonic motion with amplitude 5 cm and period 2 s. Draw the displacement-time graph." },
  { id: "rel-cars-catch", group: "relative", archetype: "relative_motion_line", tier: "qualitative_verified", question: "Car A moves at 20 m/s and car B, 100 m ahead of A, moves at 12 m/s in the same direction. Find the time for A to catch B." },
  { id: "rel-cars-east", group: "relative", archetype: "relative_motion_line", tier: "qualitative_verified", question: "Car A travels east at 20 m/s and car B travels east at 5.0 m/s on the same straight road. Find the velocity of A relative to B." },
  { id: "river-crossing", archetype: "river_boat", tier: "exact_verified", question: "A boat can move at 5 m/s in still water. The river flows at 3 m/s. In what direction should the boat head to reach the point directly opposite on the other bank?" },
  { id: "vectors-resultant", archetype: "vectors_resultant", tier: "exact_verified", question: "Two vectors of magnitude 6 and 8 units act at an angle of 60 degrees. Draw the vector triangle and find the magnitude of their resultant." },
  { id: "vectors-dot-concept", archetype: "vectors_resultant", declines: true, question: "If a . b = 0 for two non-zero vectors a and b, what is the angle between a and b?" },
  // Laws of motion
  { id: "incline-fbd", archetype: "incline_body", tier: "exact_verified", operators: ["normal_at", "vector_components"], annotations: ["hatch"], question: "A block of mass 5 kg rests on a rough inclined plane of inclination 37 degrees. The coefficient of friction is 0.4. Draw the free-body diagram and find the acceleration of the block." },
  { id: "incline-block-30", archetype: "incline_body", tier: "exact_verified", operators: ["normal_at"], annotations: ["hatch"], symbols: {}, question: "A block rests on a 30 degree incline. Draw the free-body diagram." },
  { id: "kirchhoff-bilingual", group: "kirchhoff", archetype: "two_loop_network", tier: "qualitative_verified", question: "wlefeettiex ferandh Kirchhoff ke niyam likhiye an arent fara. Using Kirchhoff's rules calculate the current in each branch of the circuit and explain the figure. qwrt zxcv pqrs." },
  { id: "atwood", archetype: "atwood", tier: "qualitative_verified", question: "Two masses 3 kg and 5 kg are connected by a light string passing over a frictionless pulley. Find the acceleration of the system and the tension in the string." },
  { id: "pulley-incline", archetype: "pulley_incline", tier: "exact_verified", question: "A 2 kg block on a 37° rough incline is connected by a light inextensible string over a smooth pulley to a hanging 3 kg block. Coefficient of friction 0.2. Find the acceleration." },
  { id: "lift", archetype: "lift_body", tier: "qualitative_verified", question: "A man of mass 70 kg stands in a lift accelerating upward at 2 m/s^2. Find the normal reaction from the floor." },
  { id: "blocks-contact", archetype: "blocks_contact", tier: "qualitative_verified", question: "A force of 20 N pushes a block of mass 3 kg which is in contact with a block of mass 2 kg on a frictionless horizontal track. Find the contact force between them." },
  { id: "pushed-box-work", archetype: "blocks_contact", tier: "qualitative_verified", entities: ["force"], question: "A constant 10 N force pushes a box 4.0 m in the same direction as the force. Find the work done by the force." },
  { id: "same-direction-not-relative", archetype: "blocks_contact", tier: "qualitative_verified", question: "A body moves 12 m in the same direction as a 5 N force acting on it." },
  { id: "spring", archetype: "spring_mass", tier: "qualitative_verified", question: "A block of mass 2 kg attached to a spring of force constant 200 N/m oscillates with amplitude 0.1 m. Draw the setup and find the maximum speed." },
  { id: "pendulum", archetype: "simple_pendulum", tier: "exact_verified", question: "A simple pendulum of length 1 m is displaced by 10 degrees from the vertical and released. Find its speed at the lowest point." },
  { id: "ladder", archetype: "ladder_wall", tier: "exact_verified", question: "A ladder of mass 10 kg and length 5 m leans against a smooth wall making 60 degrees with the floor. Find the friction at the floor." },
  { id: "circular-level", archetype: "circular_motion_level", tier: "qualitative_verified", question: "A car takes a turn of radius 50 m on a level road with coefficient of friction 0.5. Find the maximum speed." },
  { id: "banked", archetype: "banked_road", tier: "exact_verified", question: "A road is banked at 15 degrees for a curve of radius 100 m. Find the speed at which no friction is needed." },
  { id: "vertical-circle", archetype: "vertical_circle", tier: "qualitative_verified", question: "A stone tied to a string of length 1 m is whirled in a vertical circle. Find the minimum speed at the top." },
  { id: "rod-hinged", archetype: "hinged_rod", tier: "qualitative_verified", question: "A thin uniform rod of mass 2 kg and length 1.0 m is hinged at one end and held horizontal. It is released. Find the initial angular acceleration." },
  { id: "collision", archetype: "collision_line", tier: "qualitative_verified", question: "A 2 kg ball moving at 6 m/s collides head-on with a 4 kg ball at rest and sticks to it. Find the common velocity." },
  { id: "fx-area", archetype: "fx_graph_area", tier: "exact_verified", question: "A force F = 5x newton acts on a particle moving along the x-axis. Draw the graph of F versus x and find the work done from x = 0 to x = 4 m." },
  // Fields, gravitation, electromagnetism
  { id: "two-charges", archetype: "two_point_charges", tier: "qualitative_verified", question: "Two point charges +4 microcoulomb and -1 microcoulomb are placed 30 cm apart. Find the point on the line joining them where the electric field is zero." },
  { id: "dipole", archetype: "dipole_in_field", tier: "exact_verified", question: "An electric dipole of dipole moment 6 x 10^-30 C m is placed in a uniform field of 10^5 N/C at 30 degrees. Find the torque on the dipole." },
  { id: "wire-field", archetype: "straight_wire_field", tier: "qualitative_verified", question: "A long straight wire carries a current of 5 A. Find the magnetic field at a perpendicular distance of 10 cm from the wire." },
  { id: "charge-in-B", archetype: "charge_in_magnetic_field", tier: "qualitative_verified", question: "An electron enters a uniform magnetic field of 0.01 T perpendicular to its velocity of 2 x 10^6 m/s. Find the radius of its circular path." },
  { id: "solenoid", archetype: "solenoid_field", tier: "qualitative_verified", question: "A solenoid of 1000 turns per metre carries a current of 2 A. Find the magnetic field inside the solenoid." },
  { id: "satellite", archetype: "satellite_orbit", tier: "qualitative_verified", question: "A satellite orbits the Earth in a circular orbit of radius 7000 km. Find its orbital speed." },
  { id: "emf-rod", archetype: "motional_emf_rod", tier: "qualitative_verified", question: "A conducting rod of length 0.5 m moves at 4 m/s perpendicular to a magnetic field of 0.2 T. Find the motional emf induced." },
  // Circuits
  { id: "kirchhoff", group: "kirchhoff", archetype: "two_loop_network", tier: "qualitative_verified", question: "In the circuit a 6 V battery and a 12 V battery are connected with resistors of 2 ohm, 4 ohm and 6 ohm forming two loops. Use Kirchhoff's laws to find the current in each branch." },
  { id: "kirchhoff-state", group: "kirchhoff", archetype: "two_loop_network", tier: "qualitative_verified", question: "State Kirchhoff's rules of current distribution in an electrical network. Using these rules determine the value of the current in the electric circuit given below." },
  { id: "series-and-parallel-both", archetype: "resistor_network", declines: true, question: "Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit." },
  { id: "parallel-no-source", archetype: "resistor_network", tier: "qualitative_verified", symbols: { resistor: 3, battery: 0, cell: 0 }, question: "Three resistors R1 = 12 ohm, R2 = 12 ohm, and R3 = 12 ohm are connected in parallel. Find the equivalent resistance." },
  { id: "series-with-source", archetype: "resistor_network", tier: "qualitative_verified", symbols: { resistor: 2, battery: 1 }, question: "Two resistors of 4 ohm and 6 ohm are connected in series across a 10 V battery. Find the current." },
  { id: "capacitors-no-source", archetype: "capacitor_network", tier: "qualitative_verified", symbols: { capacitor: 2, battery: 0 }, question: "Two capacitors of 4 μF and 6 μF are connected in parallel. Find the equivalent capacitance." },
  { id: "kirchhoff-ocr-garbage", archetype: "two_loop_network", declines: true, question: "wlefeettiex ferandh an arent fara Kirchhoff qwrt zxcv pqrs mnbv." },
  // Topic figures
  { id: "topic-shm", archetype: "spring_mass", question: "Draw a labelled diagram for Simple harmonic motion and its equation." },
  { id: "topic-shm-energy", archetype: "shm_energy", question: "Draw a labelled diagram for Kinetic and potential energies in simple harmonic motion." },
  { id: "topic-wave-types", archetype: "wave_types", question: "Draw a labelled diagram for Wave motion and longitudinal and transverse waves." },
  { id: "topic-organ-pipes", archetype: "standing_wave", question: "Draw a labelled diagram for Standing waves in organ pipes." },
  { id: "topic-force-conductor", archetype: "force_on_conductor", question: "Draw a labelled diagram for Force on a current-carrying conductor in a uniform magnetic field." },
  { id: "topic-parallel-conductors", archetype: "parallel_wires", question: "Draw a labelled diagram for Force between two parallel current-carrying conductors." },
  { id: "topic-loop-torque", archetype: "current_loop_torque", question: "Draw a labelled diagram for Torque experienced by a current loop in a uniform magnetic field." },
  { id: "topic-bar-magnet", archetype: "bar_magnet", question: "Draw a labelled diagram for Bar magnet and magnetic field lines." },
  { id: "topic-magnetic-dipole-torque", archetype: "bar_magnet_in_field", question: "Draw a labelled diagram for Torque on a magnetic dipole in a uniform magnetic field. Show the magnet, the field and the forces." },
  { id: "topic-faraday", archetype: "faraday_induction", question: "Draw a labelled diagram for Electromagnetic induction and Faraday's law. Show the coils or the magnet and the galvanometer." },
  { id: "topic-mutual-inductance", archetype: "inductance_coils", question: "Draw a labelled diagram for Mutual inductance." },
  { id: "topic-decay", archetype: "radioactive_decay", question: "Draw a labelled diagram for Radioactive decay and half-life." },
  { id: "topic-cooling", archetype: "cooling_curve", question: "Draw a labelled diagram for Newton's law of cooling." },
  { id: "topic-logic-gates", archetype: "logic_gates", question: "Draw a labelled diagram for Logic gates: OR, AND, NOT, NAND, and NOR." },
  { id: "topic-centre-of-mass", archetype: "centre_of_mass", question: "Draw a labelled diagram for Motion of the centre of mass." },
  { id: "topic-escape", archetype: "escape_velocity", question: "Draw a labelled diagram for Escape velocity." },
  { id: "topic-velocity-selector", archetype: "velocity_selector", question: "Draw a labelled diagram for Velocity selector." },
  { id: "topic-faraday-rails", group: "faraday", archetype: "faraday_induction", question: "Draw a labelled diagram for Electromagnetic induction and Faraday's law. Show the coils or the rod-and-rails setup named in the topic." },
  { id: "topic-faraday-mark", group: "faraday", archetype: "faraday_induction", question: "Draw Electromagnetic induction and Faraday's law and mark any named directions, levels, or components on the figure. Show the coils or the rod-and-rails setup named in the topic." },
  { id: "topic-magnetic-materials", archetype: "magnetic_susceptibility", question: "Draw a labelled diagram for Para-, dia-, and ferromagnetic substances with examples and the effect of temperature on magnetic properties." },
  { id: "topic-mass-defect", archetype: "binding_energy_curve", question: "Draw a labelled diagram for Mass-energy relation and mass defect." },
  { id: "topic-vernier", group: "vernier", archetype: "vernier_calliper", question: "Draw a labelled diagram for Using vernier callipers to measure internal diameter, external diameter, and depth. Mark the named measured length." },
  { id: "topic-vernier-zero", group: "vernier", archetype: "vernier_calliper", question: "Draw a labelled diagram for Zero error of a vernier calliper. Mark the named measured length." },
  { id: "vernier-reading", archetype: "vernier_calliper", tier: "exact_verified", question: "In a vernier calliper of least count 0.1 mm, the main scale reading is 23 mm and the 4th vernier division coincides with a main scale division. Find the reading." },
  { id: "topic-screw-gauge", group: "screw", archetype: "screw_gauge", question: "Draw a labelled diagram for Using a screw gauge to determine the thickness or diameter of a thin sheet or wire. Mark the named measured length." },
  { id: "topic-screw-gauge-zero", group: "screw", archetype: "screw_gauge", question: "Draw a labelled diagram for Zero error of a screw gauge. Mark the named measured length." },
  { id: "series-parallel", archetype: "resistor_network", tier: "qualitative_verified", question: "A 6 ohm resistor is connected in series with a parallel combination of 4 ohm and 12 ohm resistors across a 12 V battery. Find the total current drawn." },
  { id: "wheatstone", group: "bridge", archetype: "wheatstone_bridge", tier: "qualitative_verified", question: "In a Wheatstone bridge the resistances are 10 ohm, 20 ohm, 30 ohm and an unknown R. The galvanometer shows no deflection. Find R." },
  { id: "meter-bridge", archetype: "meter_bridge", tier: "exact_verified", question: "In a meter bridge the balance point is at 40 cm with a known resistance of 10 ohm in the right gap. Find the unknown resistance." },
  { id: "capacitors-series", archetype: "capacitor_network", tier: "qualitative_verified", question: "Three capacitors of 2 uF, 3 uF and 6 uF are connected in series to a 12 V battery. Find the charge on each capacitor." },
  // Optics and modern physics
  { id: "concave-mirror", archetype: "spherical_mirror", tier: "exact_verified", question: "An object is placed 30 cm from a concave mirror of focal length 10 cm. Draw the ray diagram and find the position and nature of the image." },
  { id: "convex-lens", archetype: "thin_lens", tier: "exact_verified", question: "An object is placed 20 cm in front of a convex lens of focal length 15 cm. Draw the ray diagram and find the image distance and magnification.", operators: ["lens_section"] },
  { id: "concave-lens", archetype: "thin_lens", tier: "exact_verified", question: "An object is placed 20 cm in front of a concave lens of focal length 15 cm. Draw the ray diagram and find the image distance.", operators: ["lens_section"] },
  { id: "lens-maker-topic", group: "lens-maker", archetype: "lens_maker", tier: "qualitative_verified", question: "Draw a labelled diagram for Lens maker's formula. Show the principal axis and the named rays.", operators: ["spherical_surface"] },
  { id: "lens-maker-setup", group: "lens-maker", archetype: "lens_maker", tier: "qualitative_verified", question: "Draw the standard setup for Lens maker's formula and label the named quantities.", operators: ["spherical_surface"] },
  { id: "lens-maker-radii", archetype: "lens_maker", tier: "exact_verified", question: "A biconvex glass lens of index 1.5 has radii plus 20 cm and minus 20 cm in air. Find its focal length and identify both refracting surfaces.", operators: ["spherical_surface"] },
  { id: "spherical-surface-topic", group: "spherical-surface", archetype: "spherical_refraction", tier: "qualitative_verified", question: "Draw a labelled diagram for Refraction at a spherical surface. Show the interface and the incident and refracted rays.", operators: ["spherical_surface"] },
  { id: "spherical-surface-numeric", group: "spherical-surface", archetype: "spherical_refraction", tier: "exact_verified", question: "A point object is 30 cm from a spherical air-glass interface of radius 10 cm, glass index 1.5. Locate the paraxial image and show the surface-normal construction.", operators: ["spherical_surface"] },
  { id: "prism-45", archetype: "prism", tier: "exact_verified", question: "A ray of light is incident at 45 degrees on one face of an equilateral glass prism of refractive index 1.5. Draw the ray path and find the angle of deviation." },
  { id: "prism-min-dev", archetype: "prism", tier: "exact_verified", question: "A prism has apex angle 60° and refractive index √3. A ray passes through it at minimum deviation. Find the angle of incidence and the angle of minimum deviation." },
  { id: "snell", archetype: "plane_refraction", tier: "exact_verified", question: "Light enters glass at 45 degrees from air with refractive index 1.5. Find the angle of refraction and draw both rays with the normal." },
  { id: "ydse", archetype: "double_slit", tier: "qualitative_verified", question: "In Young's double slit experiment the slit separation is 0.5 mm and the screen is 1 m away. For light of wavelength 600 nm find the fringe width." },
  { id: "photoelectric", archetype: "photoelectric", tier: "qualitative_verified", question: "The work function of a metal is 2.0 eV. Light of wavelength 400 nm falls on it. Find the maximum kinetic energy of the photoelectrons." },
  { id: "pv-cycle", archetype: "pv_cycle", tier: "qualitative_verified", question: "An ideal gas is taken through a cycle: isobaric expansion from A to B, isochoric cooling B to C, and isothermal compression C to A. Draw the P-V diagram and find the work done in one cycle." },
  { id: "wave-equation", group: "wave", archetype: "wave_profile", tier: "qualitative_verified", question: "A transverse wave is described by y = 0.02 sin(4x - 100t) in SI units. Sketch the wave and find its wavelength and speed." },
  { id: "wave-stated", group: "wave", archetype: "wave_profile", tier: "exact_verified", question: "A progressive wave has amplitude 2 cm and wavelength 40 cm. Draw one wavelength of the wave and mark the amplitude." },
  // Mathematics
  { id: "area-between", archetype: "area_between_curves", tier: "qualitative_verified", question: "Find the area of the region bounded by the curves y = x^2 and y = 2x." },
  { id: "tangent-cubic", archetype: "tangent_to_curve", tier: "exact_verified", question: "Find the equation of the tangent to the curve y = x^3 - 2x + 1 at the point where x = 1, and sketch the curve with the tangent." },
  { id: "circle-tangent-length", group: "circle", archetype: "circle_and_point", tier: "exact_verified", question: "Find the length of the tangent from the point (5, 3) to the circle x^2 + y^2 - 4x - 6y + 9 = 0, and draw the figure." },
  { id: "circle-tangent-at", group: "circle", archetype: "circle_and_point", tier: "exact_verified", question: "Find the equation of the tangent to the circle x^2 + y^2 = 25 at the point (3, 4)." },
  { id: "triangle-sides", archetype: "triangle_sides", tier: "exact_verified", question: "In triangle ABC, AB = 5 cm, BC = 7 cm and CA = 8 cm. Find the area of the triangle and draw it." },
  { id: "point-plane", archetype: "space_point_plane", tier: "qualitative_verified", question: "Find the distance of the point (2, 3, -1) from the plane 2x - y + 2z + 3 = 0, and show the point and plane." },
  { id: "max-cubic", archetype: "function_graph", tier: "exact_verified", question: "Find the maximum value of f(x) = x^3 - 6x^2 + 9x + 1 on the interval [0, 4]." },
  { id: "parabola", archetype: "conic", detectOnly: true, question: "Find the focus, directrix and length of the latus rectum of the parabola y^2 = 12x, and sketch it." },
  // Must decline: nothing to draw, or another layer owns the figure
  { id: "algebra-quadratic", archetype: null, question: "Solve the quadratic equation x^2 - 5x + 6 = 0." },
  { id: "definition-newton", archetype: null, question: "State Newton's second law of motion and give its SI unit." },
  { id: "arithmetic-ohm", archetype: null, question: "What is the SI unit of electrical resistance?" },
  { id: "parametric-tangent", archetype: null, question: "Sketch the curve given by x = t^2 - 1, y = t^3 - t near t = 2, mark the point at that parameter and draw the tangent." },
];
