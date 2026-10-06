import { mkdirSync, writeFileSync } from "node:fs";
import { synthesizeFamilyScene } from "../../src/index";
import { renderSceneSvg } from "../lib/renderSceneSvg";
const out = process.argv[2] ?? "/tmp/ucm-render";
mkdirSync(out, { recursive: true });
const cases: Record<string, string> = {
  car: "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.",
  stone_cw: "A stone tied to a string is whirled clockwise in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and centripetal acceleration.",
  car_ccw: "A car travels anticlockwise with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.",
  rotated: "A particle is at P=(1.8,2.4) m relative to centre O in the xy-plane. It moves anticlockwise uniformly on the circle through P at angular speed 2 rad/s. Choose its instantaneous velocity and acceleration, then draw the circle, radius and both vectors.",
  second_quadrant_cw: "A particle is at P=(-3,4) m relative to O and moves clockwise uniformly with angular speed 0.2 rad/s. Choose its velocity and acceleration.",
  east_no_sense: "A particle travels uniformly on a circle of radius 2 m at angular speed 3 rad/s. At the east point, which direction is its velocity?",
  native_q37: "For a particle in uniform circular motion, the acceleration a at any point P(R,θ) on the circular path of radius R is (when θ is measured from the positive x-axis and v is uniform speed):",
};
for (const [name, q] of Object.entries(cases)) {
  const r = synthesizeFamilyScene({ question: q });
  if (!r) { console.log(name, "declined"); continue; }
  writeFileSync(`${out}/${name}.svg`, renderSceneSvg(r.renderScene));
  console.log(name, r.family, r.tier);
}
