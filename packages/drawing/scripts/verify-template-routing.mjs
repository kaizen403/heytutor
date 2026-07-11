/**
 * Verifies diagram-template routing against representative JEE physics
 * questions (docs/jee-syllabus-checklist.md). Run after `pnpm build`:
 *
 *   node scripts/verify-template-routing.mjs
 */
import { matchDiagramTemplate } from "../dist/index.js";

const cases = [
  // Unit 2 — Kinematics
  ["A particle's velocity-time graph shows v rising from 0 to 20 m/s in 4 s, then constant. Find the distance covered in 6 s.", "motion_graph"],
  ["A ball is thrown at an angle of 30 degrees with speed 20 m/s. Find the maximum height and range.", "projectile"],
  // Unit 3 — Laws of Motion
  ["A 5 kg block on a rough surface is pushed with 20 N. mu = 0.3. Find the acceleration using Newton's second law.", "fbd"],
  ["A 2 kg box rests on a frictionless incline at 30 degrees. Find its acceleration as it slides down.", "incline_fbd"],
  ["A box sits on top of a hill sloped at 25 degrees with friction coefficient 0.2. Does it slide?", "incline_fbd"],
  ["A uniform solid sphere rolls without slipping down a rough incline of 30 degrees. Find the angular velocity at the bottom and the minimum coefficient of friction required.", "rolling_incline"],
  ["Two masses of 3 kg and 5 kg are connected by a light string over a frictionless pulley. Find the acceleration and tension.", "pulley_atwood"],
  ["A car negotiates a banked road of radius 50 m banked at 30 degrees. Find the ideal speed.", "banked_road"],
  // Unit 4 — Work, Energy and Power
  ["A stone on a string is whirled in a vertical circle of radius 1 m. Find the minimum speed at the top.", "vertical_circle"],
  ["A 2 kg ball moving at 4 m/s collides elastically with a 1 kg ball at rest. Find the final velocities.", "collision"],
  ["A bullet embeds in a wooden block and they move together. Use conservation of momentum to find their common speed.", "collision"],
  ["A block slides down a ramp of height 5 m and compresses a spring of k = 200 N/m at the bottom. Find the compression.", "ramp_spring"],
  ["A box slides from the top of a hill of height 4 m onto a spring of stiffness 500 N/m. Find the maximum compression.", "ramp_spring"],
  ["A 0.5 kg block attached to a spring (k = 200 N/m) on a frictionless horizontal surface is given 3 m/s. Find the maximum compression.", "horizontal_spring"],
  // Unit 6 — Gravitation
  ["Find the escape velocity from a planet of mass M and radius R.", "gravitation"],
  // Unit 7 — Properties of Solids and Liquids
  ["Water flows through a horizontal pipe that narrows from radius 4 cm to 2 cm. Pressure in the wider section is 2e5 Pa and flow speed is 1.5 m/s. Find the speed and pressure in the narrow section.", "fluid_flow"],
  ["Use Bernoulli's principle to explain how an airplane wing generates lift.", "fluid_flow"],
  // Unit 8/9 — Thermodynamics
  ["An ideal gas expands isothermally from 2 L to 6 L at 300 K. Find the work done by the gas.", "pv_diagram"],
  // Unit 10 — Oscillations and Waves
  ["A simple pendulum of length 1 m is taken to the moon. Find its time period there.", "pendulum"],
  ["A wave y = 0.02 sin(kx - wt) has frequency 50 Hz and speed 20 m/s. Find the wavelength.", "wave_shm"],
  // Unit 11 — Electrostatics
  ["Two point charges of 2 uC each are 30 cm apart. Find the electric field at the midpoint.", "electrostatics"],
  // Unit 12 — Current Electricity
  ["Find the equivalent resistance of 4 ohm and 12 ohm resistors in parallel.", "circuit"],
  // Unit 13 — Magnetism
  ["A solenoid with 200 turns per metre carries 2 A. Find the magnetic field inside.", "magnetism"],
  // Unit 16 — Optics
  ["A concave mirror of focal length 15 cm forms an image of an object placed 30 cm away. Find the image distance.", "optics_mirror"],
  ["An object is placed 40 cm in front of a convex lens of focal length 20 cm. Find the image distance.", "optics_lens"],
  ["A prism of angle A = 60° and refractive index μ = 1.5. Find the minimum deviation.", "optics_prism"],
  ["Find the critical angle for total internal reflection when μ = 1.5.", "optics_tir"],
  ["Two thin lenses in contact have f1 = 20 cm and f2 = 30 cm. Find equivalent focal length.", "optics_lens_combo"],
  ["A compound microscope has fo = 1 cm, fe = 5 cm, L = 15 cm. Find magnifying power.", "optics_instrument"],
  ["A ray is incident on a glass slab of μ = 1.5 at i = 45°. Find lateral shift.", "optics_refraction_plane"],
  ["In Young's double slit experiment, d = 1 mm, D = 1 m and wavelength 600 nm. Find the fringe width.", "ydse"],
  // Unit 17 — Dual Nature
  ["Light of wavelength 400 nm falls on a metal with work function 2 eV. Find the stopping potential.", "photoelectric"],
  // Unit 18 — Atoms and Nuclei
  ["An electron transitions from n = 3 to n = 2 in hydrogen. Find the wavelength of the emitted photon.", "energy_levels"],
];

let failures = 0;
for (const [question, expected] of cases) {
  const got = matchDiagramTemplate(question)?.id ?? null;
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  expected=${expected}  got=${got}  :: ${question.slice(0, 70)}`);
}

console.log(failures === 0 ? `\nall ${cases.length} routing cases pass` : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
