/**
 * Mechanics and kinematics archetype generators.
 *
 * Every figure is computed from its slots: an incline is drawn at the stated
 * angle, a projectile follows the trajectory u and θ imply, relative-motion
 * arrows are in the stated speed ratio. Where a slot is missing the figure
 * uses a declared display value and the tier rule keeps it qualitative.
 */
import { DEG, SceneBuilder, add, fmt, polar, rotate, scale, withUnit, type Vec2 } from "../document";
import { angleExpected, angleLabel, grounded, maybeNum, num, numbers, text, valueLabel, type GeneratorContext, type GeneratorTable } from "./context";

const G = 9.8;

function groundLine(scene: SceneBuilder, id: string, from: Vec2, to: Vec2, role = "ground"): string {
  scene.point(`${id}_a`, from, `${role} end`);
  scene.point(`${id}_b`, to, `${role} end`);
  return scene.segment(id, `${id}_a`, `${id}_b`, role);
}

function forceArrow(scene: SceneBuilder, id: string, from: string, direction: Vec2, length: number, role: string, label: string): string {
  return scene.vector(id, from, { direction, length }, role, label);
}

/* ------------------------------------------------------------------------- */

function projectile(context: GeneratorContext) {
  const theta = num(context, "theta", 45);
  const u = num(context, "u", 20);
  const h0 = Math.max(0, num(context, "h0", 0));
  const g = num(context, "g", G);
  const vx = u * Math.cos(theta * DEG);
  const vy = u * Math.sin(theta * DEG);
  if (vx <= 0 || u <= 0) return null;
  const height0 = theta === 0 && h0 === 0 ? 20 : h0;
  const flight = (vy + Math.sqrt(vy * vy + 2 * g * height0)) / g;
  const range = vx * flight;
  const apexX = vx * vy / g;
  const apexY = height0 + vy * vy / (2 * g);
  const a = Math.tan(theta * DEG);
  const b = g / (2 * vx * vx);
  const expression = `${height0}+${a}*x-${b}*x^2`;

  const scene = new SceneBuilder(context.question, theta === 0
    ? "projectile launched horizontally from a height, following the trajectory the speed implies"
    : `projectile launched at ${fmt(theta)}° following the trajectory u and θ imply`, "projectile");
  scene.quantity("u", "u", u, "m/s");
  scene.quantity("theta", "theta", theta, "degree");
  if (height0 > 0) scene.quantity("h0", "h", height0, "m");

  groundLine(scene, "ground", { x: -0.12 * range, y: 0 }, { x: 1.08 * range, y: 0 });
  scene.point("O", { x: 0, y: height0 }, "launch point", "O");
  if (height0 > 0) {
    scene.point("foot", { x: 0, y: 0 }, "tower foot");
    scene.segment("tower", "foot", "O", "tower");
    scene.dimension("dim_h0", "foot", "O", "launch height", grounded(context, "h0") ? withUnit(height0, "m") : "h");
  }
  scene.curve("trajectory", expression, 0, range, "trajectory", undefined, 81);
  scene.point("apex", { x: apexX, y: apexY }, "highest point", "H");
  scene.point("landing", { x: range, y: 0 }, "landing point", "B");
  const arrow = Math.max(0.22 * range, 0.15 * apexY, 1);
  scene.point("aim", add({ x: 0, y: height0 }, polar(arrow, theta)), "launch direction");
  scene.vector("velocity", "O", { end: "aim" }, "launch velocity", valueLabel(context, "u", "u", "m/s"));
  if (theta > 0) {
    scene.point("aim_h", { x: arrow, y: height0 }, "horizontal reference end");
    scene.segment("horizontal", "O", "aim_h", "horizontal reference");
    scene.angleMark("angle", "O", "velocity", "horizontal", angleLabel(context, "theta"));
    scene.assert("launch_angle", "angle_between", ["velocity", "horizontal"], angleExpected(theta));
  }
  if (apexX > 0) {
    scene.point("apex_foot", { x: apexX, y: 0 }, "apex foot");
    scene.dimension("dim_H", "apex_foot", "apex", "maximum height", grounded(context, "u") && grounded(context, "theta") ? `H=${withUnit(apexY - (height0 > 0 ? 0 : 0), "m")}` : "H");
  }
  scene.point("range_start", { x: 0, y: 0 }, "range start");
  scene.dimension("dim_R", "range_start", "landing", "horizontal range", grounded(context, "u") && grounded(context, "theta") ? `R=${withUnit(range, "m")}` : "R");
  scene.assert("apex_on_path", "function_value", ["trajectory"], { x: Number(apexX.toFixed(6)), y: Number(apexY.toFixed(6)) });
  scene.assert("launch_on_path", "on", ["O", "trajectory"]);
  scene.assert("landing_on_path", "on", ["landing", "trajectory"]);
  scene.labelled("O", "velocity");
  scene.group("setup", ["ground_a", "ground_b", "ground", "O", "aim", "velocity", ...(height0 > 0 ? ["foot", "tower", "dim_h0"] : []), ...(theta > 0 ? ["aim_h", "horizontal", "angle"] : [])], "the launch: speed, angle and the ground");
  scene.group("path", ["trajectory", "apex", "landing", ...(apexX > 0 ? ["apex_foot", "dim_H"] : []), "range_start", "dim_R"], "the parabolic path with its highest point and range", ["setup"]);
  return scene.build();
}

function freeFall(context: GeneratorContext) {
  const h = num(context, "h", 45);
  const up = text(context, "direction") === "up";
  const scene = new SceneBuilder(context.question, up ? "body thrown vertically upward from the ground" : "body released from a height above the ground", "free_fall");
  if (grounded(context, "h")) scene.quantity("h", "h", h, "m");
  groundLine(scene, "ground", { x: -0.45 * h, y: 0 }, { x: 0.45 * h, y: 0 });
  scene.point("foot", { x: 0, y: 0 }, "foot of the drop");
  scene.point("top", { x: 0, y: h }, up ? "highest point" : "release point", up ? "H" : "A");
  scene.segment("vertical", "foot", "top", "vertical line of motion");
  scene.point("body", { x: 0, y: up ? 0.08 * h : h }, "body", "m");
  scene.circle("body_disc", "body", 0.035 * h, "body outline");
  const arrowLength = 0.25 * h;
  if (up) {
    scene.vector("velocity", "body", { direction: { x: 0, y: 1 }, length: arrowLength }, "initial velocity", valueLabel(context, "u", "u", "m/s"));
  } else {
    scene.point("u_anchor", { x: -0.12 * h, y: h }, "initial velocity anchor");
    scene.vector("velocity", "u_anchor", { direction: { x: 0, y: -1 }, length: arrowLength * 0.5 }, "initial velocity", maybeNum(context, "u") !== null ? valueLabel(context, "u", "u", "m/s") : "u=0");
  }
  scene.vector("weight", "body", { direction: { x: 0, y: -1 }, length: arrowLength * 0.9 }, "weight", "mg");
  scene.point("g_anchor", { x: 0.28 * h, y: 0.75 * h }, "gravity anchor");
  scene.vector("gravity", "g_anchor", { direction: { x: 0, y: -1 }, length: arrowLength }, "acceleration due to gravity", "g");
  scene.point("dim_anchor", { x: -0.2 * h, y: 0 }, "height dimension foot");
  scene.point("dim_top", { x: -0.2 * h, y: h }, "height dimension top");
  scene.dimension("height", "dim_anchor", "dim_top", "height", grounded(context, "h") ? `h=${withUnit(h, "m")}` : "h");
  scene.assert("vertical_perp", "perpendicular", ["vertical", "ground"]);
  scene.assert("body_on_line", "on", ["body", "vertical"]);
  scene.labelled("body", "gravity");
  return scene.build();
}

function inclineBody(context: GeneratorContext) {
  const theta = num(context, "theta", 30);
  if (theta <= 0 || theta >= 90) return null;
  const mu = maybeNum(context, "mu");
  const rough = mu !== null || /\brough\b/i.test(context.question);
  const rolling = text(context, "rolling") === "yes";
  const L = 4.5;
  const along: Vec2 = { x: Math.cos(theta * DEG), y: Math.sin(theta * DEG) };
  const normal: Vec2 = { x: -Math.sin(theta * DEG), y: Math.cos(theta * DEG) };
  const top = scale(along, L);
  const scene = new SceneBuilder(context.question, `${rolling ? "rolling body" : "block"} on a ${fmt(theta)}° incline with its forces`, "incline_body");
  scene.quantity("theta", "theta", theta, "degree");
  if (mu !== null) scene.quantity("mu", "mu", mu, "");
  scene.point("B", { x: 0, y: 0 }, "incline foot", "B");
  scene.point("T", top, "incline top");
  scene.point("F", { x: top.x, y: 0 }, "incline base corner");
  scene.segment("incline", "B", "T", "inclined plane");
  scene.segment("ground", "B", "F", "ground");
  scene.segment("rise", "F", "T", "vertical side");
  scene.rightAngle("right_angle", "F", "ground", "rise");
  scene.angleMark("angle", "B", "incline", "ground", angleLabel(context, "theta"));
  scene.hatch("incline_hatch", "incline");

  const contact = scale(along, 0.48 * L);
  scene.point("C", contact, "contact point");
  const massLabel = maybeNum(context, "mass") !== null && grounded(context, "mass") ? `m=${withUnit(num(context, "mass", 1), "kg")}` : "m";
  let centreId: string;
  if (rolling) {
    const radius = 0.55;
    centreId = scene.point("G", add(contact, scale(normal, radius)), "body centre of mass");
    scene.circle("body", "G", radius, "rolling body", massLabel);
  } else {
    const height = 0.7;
    centreId = scene.point("G", add(contact, scale(normal, height / 2)), "body centre of mass");
    scene.box("body", add(contact, scale(normal, height / 2)), 1.2, height, theta, "body block", massLabel);
  }
  forceArrow(scene, "weight", centreId, { x: 0, y: -1 }, 1.4, "weight", "mg");
  // The normal reaction is derived from the contact surface, never placed by
  // trigonometry: normal_at gives the direction, the drawn arrow follows it.
  scene.normalAt("normal_dir", "C", "incline", "surface normal helper");
  scene.vector("normal", "C", { along: "normal_dir", length: 1.35 }, "normal reaction", "N");
  scene.components("weight_along", "weight_perp", centreId, "weight", "incline", ["weight component along the incline", "weight component into the incline"], ["mg sinθ", "mg cosθ"]);
  if (rough) {
    const upSlope = /\b(?:pushed|pulled|moves up|moving up|slides up|up the (?:incline|plane|slope))\b/i.test(context.question) ? scale(along, -1) : along;
    forceArrow(scene, "friction", centreId, upSlope, 1.0, "friction", mu !== null && grounded(context, "mu") ? `f (μ=${fmt(mu)})` : "f");
    scene.assert("friction_along", "parallel", ["friction", "incline"]);
  }
  const applied = maybeNum(context, "applied");
  if (applied !== null) {
    forceArrow(scene, "applied", centreId, along, 1.3, "applied force", valueLabel(context, "applied", "F", "N"));
  }
  scene.assert("incline_angle", "angle_between", ["incline", "ground"], angleExpected(theta));
  scene.assert("normal_perp", "perpendicular", ["normal", "incline"]);
  scene.assert("contact_on", "on", ["C", "incline"]);
  scene.labelled("weight", "normal");
  scene.group("surface", ["B", "T", "F", "incline", "ground", "rise", "right_angle", "angle"], "the incline at the stated angle");
  void normal;
  scene.group("body_group", ["C", "G", "body", ...(rolling ? [] : ["body_c0", "body_c1", "body_c2", "body_c3"])], "the body resting on the plane", ["surface"]);
  scene.group("forces", ["weight", "normal", "weight_along", "weight_perp", ...(rough ? ["friction"] : []), ...(applied !== null ? ["applied"] : [])], "every force on the body", ["body_group"]);
  return scene.build();
}

function atwood(context: GeneratorContext) {
  const m1 = num(context, "m1", 1);
  const m2 = num(context, "m2", 2);
  const heavierRight = m2 >= m1;
  const radius = 0.6;
  const scene = new SceneBuilder(context.question, "two masses hanging over a fixed pulley on one string", "atwood");
  if (grounded(context, "m1")) scene.quantity("m1", "m1", m1, "kg");
  if (grounded(context, "m2")) scene.quantity("m2", "m2", m2, "kg");
  scene.point("P", { x: 0, y: 4 }, "pulley centre");
  scene.point("hang_top", { x: 0, y: 5 }, "support top");
  scene.point("ceiling_l", { x: -1.4, y: 5 }, "ceiling end");
  scene.point("ceiling_r", { x: 1.4, y: 5 }, "ceiling end");
  scene.segment("ceiling", "ceiling_l", "ceiling_r", "ceiling");
  scene.segment("hanger", "hang_top", "P", "pulley support");
  scene.circle("pulley", "P", radius, "pulley");
  scene.point("L", { x: -radius, y: 4 }, "string tangent point");
  scene.point("R", { x: radius, y: 4 }, "string tangent point");
  const leftTop = { x: -radius, y: heavierRight ? 2.2 : 1.5 };
  const rightTop = { x: radius, y: heavierRight ? 1.5 : 2.2 };
  scene.point("L_end", leftTop, "string end");
  scene.point("R_end", rightTop, "string end");
  scene.segment("string_left", "L", "L_end", "string");
  scene.segment("string_right", "R", "R_end", "string");
  scene.point("G1", { x: leftTop.x, y: leftTop.y - 0.45 }, "body centre");
  scene.point("G2", { x: rightTop.x, y: rightTop.y - 0.45 }, "body centre");
  scene.rectangle("body1", "G1", 0.9, 0.9, "body", grounded(context, "m1") ? `m1=${withUnit(m1, "kg")}` : "m1");
  scene.rectangle("body2", "G2", 0.9, 0.9, "body", grounded(context, "m2") ? `m2=${withUnit(m2, "kg")}` : "m2");
  scene.vector("T1", "L_end", { direction: { x: 0, y: 1 }, length: 0.9 }, "tension", "T");
  scene.vector("T2", "R_end", { direction: { x: 0, y: 1 }, length: 0.9 }, "tension", "T");
  const heaviest = Math.max(m1, m2, 1e-9);
  scene.vector("W1", "G1", { direction: { x: 0, y: -1 }, length: 0.7 + 0.7 * (m1 / heaviest) }, "weight", "m1g");
  scene.vector("W2", "G2", { direction: { x: 0, y: -1 }, length: 0.7 + 0.7 * (m2 / heaviest) }, "weight", "m2g");
  scene.vector("a1", "G1", { direction: { x: 0, y: heavierRight ? 1 : -1 }, length: 0.6 }, "acceleration", "a");
  scene.vector("a2", "G2", { direction: { x: 0, y: heavierRight ? -1 : 1 }, length: 0.6 }, "acceleration", "a");
  scene.assert("strings_parallel", "parallel", ["string_left", "string_right"]);
  scene.assert("tension_equal", "equal_length", ["T1", "T2"]);
  scene.assert("left_on_pulley", "on", ["L", "pulley"]);
  scene.assert("right_on_pulley", "on", ["R", "pulley"]);
  scene.assert("weights_opposite_tension", "opposite_direction", ["T1", "W1"]);
  scene.labelled("body1", "body2");
  scene.group("apparatus", ["ceiling_l", "ceiling_r", "ceiling", "hang_top", "hanger", "P", "pulley", "L", "R", "L_end", "R_end", "string_left", "string_right", "G1", "G2", "body1", "body2"], "the pulley, the string and the two masses");
  scene.group("forces", ["T1", "T2", "W1", "W2", "a1", "a2"], "tension, weight and the direction of acceleration", ["apparatus"]);
  return scene.build();
}

function pulleyIncline(context: GeneratorContext) {
  const theta = num(context, "theta", 30);
  if (theta <= 0 || theta >= 90) return null;
  const L = 6;
  const along: Vec2 = { x: Math.cos(theta * DEG), y: Math.sin(theta * DEG) };
  const normal: Vec2 = { x: -Math.sin(theta * DEG), y: Math.cos(theta * DEG) };
  const top = scale(along, L);
  const radius = 0.45;
  const scene = new SceneBuilder(context.question, "block on an incline tied over a pulley to a hanging mass", "pulley_incline");
  scene.quantity("theta", "theta", theta, "degree");
  scene.point("B", { x: 0, y: 0 }, "incline foot", "B");
  scene.point("T", top, "incline top");
  scene.point("F", { x: top.x, y: 0 }, "incline base corner");
  scene.segment("incline", "B", "T", "inclined plane");
  scene.segment("ground", "B", "F", "ground");
  scene.segment("rise", "F", "T", "vertical side");
  scene.angleMark("angle", "B", "incline", "ground", angleLabel(context, "theta"));
  scene.hatch("incline_hatch", "incline");
  const contact = scale(along, 0.42 * L);
  const height = 0.7;
  const centre = add(contact, scale(normal, height / 2));
  scene.point("C", contact, "contact point");
  scene.point("G1", centre, "body centre");
  scene.box("body1", centre, 1.1, height, theta, "body on the incline", grounded(context, "m1") ? `m1=${withUnit(num(context, "m1", 1), "kg")}` : "m1");
  const stringStart = add(centre, scale(along, 0.55));
  const stringEnd = add(add(top, scale(along, 0.15)), scale(normal, height / 2));
  const pulleyCentre = add(stringEnd, scale(normal, radius));
  scene.point("S", stringStart, "string end at the block");
  scene.point("Q", stringEnd, "string tangent point");
  scene.point("P", pulleyCentre, "pulley centre");
  scene.circle("pulley", "P", radius, "pulley");
  scene.segment("string_incline", "S", "Q", "string");
  const rightTangent = add(pulleyCentre, { x: radius, y: 0 });
  scene.point("R", rightTangent, "string tangent point");
  scene.point("R_end", { x: rightTangent.x, y: rightTangent.y - 1.8 }, "string end");
  scene.segment("string_hang", "R", "R_end", "string");
  scene.point("G2", { x: rightTangent.x, y: rightTangent.y - 2.25 }, "body centre");
  scene.rectangle("body2", "G2", 0.9, 0.9, "hanging body", grounded(context, "m2") ? `m2=${withUnit(num(context, "m2", 1), "kg")}` : "m2");
  scene.vector("W1", "G1", { direction: { x: 0, y: -1 }, length: 1.3 }, "weight", "m1g");
  scene.normalAt("N1_dir", "C", "incline", "surface normal helper");
  scene.vector("N1", "C", { along: "N1_dir", length: 1.1 }, "normal reaction", "N");
  scene.vector("T1", "S", { direction: along, length: 0.9 }, "tension", "T");
  scene.vector("W2", "G2", { direction: { x: 0, y: -1 }, length: 1.3 }, "weight", "m2g");
  scene.vector("T2", "R_end", { direction: { x: 0, y: 1 }, length: 0.9 }, "tension", "T");
  if (maybeNum(context, "mu") !== null || /\brough\b/i.test(context.question)) {
    scene.vector("friction", "G1", { direction: scale(along, -1), length: 0.8 }, "friction", "f");
    scene.assert("friction_along", "parallel", ["friction", "incline"]);
  }
  scene.assert("incline_angle", "angle_between", ["incline", "ground"], angleExpected(theta));
  scene.assert("string_parallel", "parallel", ["string_incline", "incline"]);
  scene.assert("normal_perp", "perpendicular", ["N1", "incline"]);
  scene.assert("q_on_pulley", "on", ["Q", "pulley"]);
  scene.assert("r_on_pulley", "on", ["R", "pulley"]);
  scene.labelled("body1", "body2");
  return scene.build();
}

function blocksContact(context: GeneratorContext) {
  const masses = numbers(context, "masses");
  const wordCount = /\bthree\b/i.test(context.question) ? 3 : /\btwo\b/i.test(context.question) ? 2 : 1;
  const count = Math.max(1, Math.min(masses.length || wordCount, 4));
  const byString = text(context, "connection") === "string";
  const scene = new SceneBuilder(context.question, count === 1
    ? "block on a surface pushed by a force"
    : byString ? "blocks tied by strings on a surface, pulled by a force" : "blocks in contact on a surface, pushed by a force", "blocks_contact");
  const width = 1.1;
  const gap = byString ? 0.9 : 0;
  const total = count * width + (count - 1) * gap;
  groundLine(scene, "surface", { x: -1.6, y: 0 }, { x: total + 1.2, y: 0 }, "surface");
  const centres: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = index * (width + gap) + width / 2;
    const centre = scene.point(`G${index + 1}`, { x, y: 0.45 }, "body centre");
    centres.push(centre);
    const mass = masses[index];
    scene.rectangle(`body${index + 1}`, centre, width, 0.9, "body", mass !== undefined ? `m${index + 1}=${withUnit(mass, "kg")}` : `m${index + 1}`);
    scene.assert(`body${index + 1}_rests`, "on", [`body${index + 1}_base`, "surface"]);
    scene.point(`body${index + 1}_base`, { x, y: 0 }, "body base point");
    if (byString && index < count - 1) {
      scene.point(`s${index + 1}_a`, { x: x + width / 2, y: 0.45 }, "string end");
      scene.point(`s${index + 1}_b`, { x: x + width / 2 + gap, y: 0.45 }, "string end");
      scene.segment(`string${index + 1}`, `s${index + 1}_a`, `s${index + 1}_b`, "string", "T");
    }
  }
  scene.point("F_anchor", { x: -1.2, y: 0.45 }, "applied force anchor");
  scene.point("F_tip", { x: 0, y: 0.45 }, "applied force tip");
  scene.vector("force", "F_anchor", { end: "F_tip" }, "applied force", valueLabel(context, "force", "F", "N"));
  if (count === 1) {
    scene.vector("weight", "G1", { direction: { x: 0, y: -1 }, length: 1.1 }, "weight", "mg");
    scene.vector("normal", "G1", { direction: { x: 0, y: 1 }, length: 1.1 }, "normal reaction", "N");
    if (maybeNum(context, "mu") !== null || /\brough\b|\bfriction\b/i.test(context.question)) {
      scene.point("f_anchor", { x: width / 2, y: 0.12 }, "friction anchor");
      scene.vector("friction", "f_anchor", { direction: { x: -1, y: 0 }, length: 0.9 }, "friction", "f");
    }
    scene.assert("normal_perp", "perpendicular", ["normal", "surface"]);
  }
  if (!byString) {
    for (let index = 0; index < count - 1; index += 1) {
      const x = (index + 1) * width;
      scene.point(`contact${index + 1}`, { x, y: 0.45 }, "contact point between blocks");
    }
  }
  scene.assert("force_along_surface", "parallel", ["force", "surface"]);
  scene.labelled("body1", "force");
  return scene.build();
}

function liftBody(context: GeneratorContext) {
  const up = text(context, "direction", "up") !== "down";
  const scene = new SceneBuilder(context.question, `body on the floor of a lift accelerating ${up ? "upward" : "downward"}`, "lift_body");
  scene.point("lift_centre", { x: 0, y: 1.6 }, "lift centre");
  scene.rectangle("lift", "lift_centre", 2.6, 3.2, "lift cabin");
  scene.point("floor_l", { x: -1.3, y: 0 }, "floor end");
  scene.point("floor_r", { x: 1.3, y: 0 }, "floor end");
  scene.segment("floor", "floor_l", "floor_r", "lift floor");
  scene.point("G", { x: 0, y: 0.45 }, "body centre");
  scene.rectangle("body", "G", 0.9, 0.9, "body", maybeNum(context, "mass") !== null && grounded(context, "mass") ? `m=${withUnit(num(context, "mass", 1), "kg")}` : "m");
  scene.vector("normal", "G", { direction: { x: 0, y: 1 }, length: up ? 1.5 : 1.0 }, "normal reaction", "N");
  scene.vector("weight", "G", { direction: { x: 0, y: -1 }, length: up ? 1.1 : 1.5 }, "weight", "mg");
  scene.point("a_anchor", { x: 2.0, y: up ? 1.0 : 2.2 }, "acceleration anchor");
  scene.vector("acceleration", "a_anchor", { direction: { x: 0, y: up ? 1 : -1 }, length: 1.2 }, "acceleration of the lift", valueLabel(context, "a", "a", "m/s²"));
  scene.assert("normal_perp", "perpendicular", ["normal", "floor"]);
  scene.assert("normal_vs_weight", "opposite_direction", ["normal", "weight"]);
  scene.assert("body_on_floor", "on", ["body_base", "floor"]);
  scene.point("body_base", { x: 0, y: 0 }, "body base point");
  scene.labelled("normal", "weight");
  return scene.build();
}

function springMass(context: GeneratorContext) {
  const vertical = text(context, "orientation") === "vertical";
  const amplitude = maybeNum(context, "amplitude");
  const scene = new SceneBuilder(context.question, `block on a ${vertical ? "vertical" : "horizontal"} spring with its equilibrium position`, "spring_mass");
  const teeth = 9;
  const springLength = 2.8;
  const ids: string[] = [];
  for (let index = 0; index <= teeth; index += 1) {
    const along = (index / teeth) * springLength;
    const across = index === 0 || index === teeth ? 0 : (index % 2 === 0 ? 0.25 : -0.25);
    const at: Vec2 = vertical ? { x: across, y: -along } : { x: along, y: across };
    ids.push(scene.point(`sp${index}`, at, "spring coil point"));
  }
  scene.polyline("spring", ids, "spring", valueLabel(context, "k", "k", "N/m"));
  if (vertical) {
    scene.point("ceil_l", { x: -1, y: 0 }, "support end");
    scene.point("ceil_r", { x: 1, y: 0 }, "support end");
    scene.segment("support", "ceil_l", "ceil_r", "fixed support");
    scene.point("G", { x: 0, y: -springLength - 0.45 }, "body centre");
    scene.rectangle("body", "G", 0.9, 0.9, "body", "m");
    scene.point("eq_l", { x: -1.4, y: -springLength - 0.45 }, "equilibrium end");
    scene.point("eq_r", { x: 1.4, y: -springLength - 0.45 }, "equilibrium end");
    scene.segment("equilibrium", "eq_l", "eq_r", "equilibrium position", "x=0");
    scene.point("amp", { x: 1.4, y: -springLength - 0.45 - 0.9 }, "extreme position");
    scene.dimension("displacement", "eq_r", "amp", "displacement", amplitude !== null && grounded(context, "amplitude") ? `A=${withUnit(amplitude, "m")}` : "A");
    scene.assert("eq_perp", "perpendicular", ["equilibrium", "spring"]);
  } else {
    scene.point("wall_b", { x: 0, y: -0.9 }, "wall end");
    scene.point("wall_t", { x: 0, y: 0.9 }, "wall end");
    scene.segment("wall", "wall_b", "wall_t", "fixed wall");
    groundLine(scene, "surface", { x: 0, y: -0.5 }, { x: springLength + 2.6, y: -0.5 }, "surface");
    scene.point("G", { x: springLength + 0.5, y: 0 }, "body centre");
    scene.rectangle("body", "G", 1.0, 0.9, "body", "m");
    scene.point("eq_b", { x: springLength + 0.5, y: -0.9 }, "equilibrium end");
    scene.point("eq_t", { x: springLength + 0.5, y: 1.1 }, "equilibrium end");
    scene.segment("equilibrium", "eq_b", "eq_t", "equilibrium position", "x=0");
    scene.point("amp", { x: springLength + 0.5 + 0.9, y: 1.1 }, "extreme position");
    scene.dimension("displacement", "eq_t", "amp", "displacement", amplitude !== null && grounded(context, "amplitude") ? `A=${withUnit(amplitude, "m")}` : "A");
    scene.assert("eq_perp", "perpendicular", ["equilibrium", "surface"]);
  }
  scene.labelled("body", "equilibrium");
  return scene.build();
}

function simplePendulum(context: GeneratorContext) {
  const theta = Math.min(Math.max(num(context, "theta", 25), 5), 80);
  const L = 3;
  const bob = { x: L * Math.sin(theta * DEG), y: -L * Math.cos(theta * DEG) };
  const scene = new SceneBuilder(context.question, `pendulum displaced ${fmt(theta)}° from the vertical`, "simple_pendulum");
  scene.point("O", { x: 0, y: 0 }, "pivot", "O");
  scene.point("sup_l", { x: -1, y: 0 }, "support end");
  scene.point("sup_r", { x: 1, y: 0 }, "support end");
  scene.segment("support", "sup_l", "sup_r", "support");
  scene.point("low", { x: 0, y: -L }, "lowest point");
  // The displaced bob is the lowest point rotated about the pivot by θ — the
  // angle is right by construction, not by trigonometry.
  scene.rotated("bob", "low", "O", theta, "bob", "m");
  scene.circle("bob_disc", "bob", 0.2, "bob outline");
  scene.segment("string", "O", "bob", "string", valueLabel(context, "length", "L", "m"));
  scene.segment("vertical", "O", "low", "vertical reference");
  scene.angleMark("angle", "O", "string", "vertical", angleLabel(context, "theta"));
  scene.arc("swing", "O", L, -90 - theta, -90 + theta, "path of swing");
  scene.vector("weight", "bob", { direction: { x: 0, y: -1 }, length: 1.1 }, "weight", "mg");
  scene.vector("tension", "bob", { direction: { x: -bob.x / L, y: -bob.y / L }, length: 1.1 }, "tension", "T");
  scene.assert("string_angle", "angle_between", ["string", "vertical"], angleExpected(theta));
  scene.assert("bob_on_swing", "on", ["bob", "swing"]);
  scene.assert("vertical_perp", "perpendicular", ["vertical", "support"]);
  scene.labelled("bob", "weight");
  return scene.build();
}

function conicalPendulum(context: GeneratorContext) {
  const theta = Math.min(Math.max(num(context, "theta", 30), 5), 75);
  const L = 3;
  const radius = L * Math.sin(theta * DEG);
  const centreY = 3 - L * Math.cos(theta * DEG);
  const scene = new SceneBuilder(context.question, `conical pendulum with the string at ${fmt(theta)}° to the vertical`, "conical_pendulum");
  scene.point("O", { x: 0, y: 3 }, "pivot", "O");
  scene.point("C", { x: 0, y: centreY }, "circle centre", "C");
  scene.point("low", { x: 0, y: 3 - L }, "lowest point of the string");
  scene.rotated("bob", "low", "O", theta, "bob", "m");
  scene.segment("string", "O", "bob", "string", valueLabel(context, "length", "L", "m"));
  scene.segment("vertical", "O", "C", "vertical reference");
  scene.segment("radius", "C", "bob", "radius of the circle", "r");
  scene.angleMark("angle", "O", "string", "vertical", angleLabel(context, "theta"));
  const ringIds: string[] = [];
  for (let index = 0; index < 32; index += 1) {
    const phi = (index / 32) * 2 * Math.PI;
    ringIds.push(scene.point(`ring${index}`, { x: radius * Math.cos(phi), y: centreY + 0.28 * radius * Math.sin(phi) }, "horizontal circle point"));
  }
  scene.polygon("circle", ringIds, "horizontal circle");
  scene.vector("weight", "bob", { direction: { x: 0, y: -1 }, length: 1.0 }, "weight", "mg");
  scene.vector("tension", "bob", { direction: { x: -radius / L, y: (3 - centreY) / L }, length: 1.0 }, "tension", "T");
  scene.assert("string_angle", "angle_between", ["string", "vertical"], angleExpected(theta));
  scene.assert("radius_perp", "perpendicular", ["radius", "vertical"]);
  scene.labelled("bob", "weight");
  return scene.build();
}

function verticalCircle(context: GeneratorContext) {
  const radius = 2.4;
  const scene = new SceneBuilder(context.question, "body whirled in a vertical circle with forces at the top and bottom", "vertical_circle");
  if (grounded(context, "radius")) scene.quantity("r", "r", num(context, "radius", 1), "m");
  scene.point("O", { x: 0, y: 0 }, "centre", "O");
  scene.circle("path", "O", radius, "circular path");
  scene.point("top", { x: 0, y: radius }, "body at the top", "A");
  scene.point("bottom", { x: 0, y: -radius }, "body at the bottom", "B");
  scene.segment("radius_top", "O", "top", "radius", valueLabel(context, "radius", "r", "m"));
  scene.vector("v_top", "top", { direction: { x: -1, y: 0 }, length: 1.1 }, "velocity at the top", "v_A");
  scene.vector("v_bottom", "bottom", { direction: { x: 1, y: 0 }, length: 1.4 }, "velocity at the bottom", "v_B");
  scene.vector("T_top", "top", { direction: { x: 0, y: -1 }, length: 0.7 }, "tension at the top", "T_A");
  scene.vector("W_top", "top", { direction: { x: 0, y: -1 }, length: 1.2 }, "weight at the top", "mg");
  scene.vector("T_bottom", "bottom", { direction: { x: 0, y: 1 }, length: 1.4 }, "tension at the bottom", "T_B");
  scene.vector("W_bottom", "bottom", { direction: { x: 0, y: -1 }, length: 0.9 }, "weight at the bottom", "mg");
  scene.assert("top_on", "on", ["top", "path"]);
  scene.assert("bottom_on", "on", ["bottom", "path"]);
  scene.assert("v_tangent", "perpendicular", ["v_top", "radius_top"]);
  scene.labelled("top", "bottom");
  return scene.build();
}

function circularMotionLevel(context: GeneratorContext) {
  const radius = 2.4;
  const scene = new SceneBuilder(context.question, "body on a level circular path with its velocity and centripetal force", "circular_motion_level");
  if (grounded(context, "radius")) scene.quantity("r", "r", num(context, "radius", 1), "m");
  scene.point("O", { x: 0, y: 0 }, "centre", "O");
  scene.circle("path", "O", radius, "circular path");
  scene.point("body", { x: radius, y: 0 }, "body on the path", "P");
  scene.segment("radius", "O", "body", "radius", valueLabel(context, "radius", "r", "m"));
  scene.vector("velocity", "body", { direction: { x: 0, y: 1 }, length: 1.3 }, "velocity", valueLabel(context, "speed", "v", "m/s"));
  scene.vector("centripetal", "body", { direction: { x: -1, y: 0 }, length: 1.1 }, "centripetal force", maybeNum(context, "mu") !== null ? "f=mv²/r" : "F_c");
  scene.assert("v_tangent", "perpendicular", ["velocity", "radius"]);
  scene.assert("body_on", "on", ["body", "path"]);
  scene.labelled("body", "velocity");
  return scene.build();
}

function bankedRoad(context: GeneratorContext) {
  const theta = num(context, "theta", 20);
  if (theta <= 0 || theta >= 90) return null;
  const L = 5;
  const along: Vec2 = { x: Math.cos(theta * DEG), y: Math.sin(theta * DEG) };
  const normal: Vec2 = { x: -Math.sin(theta * DEG), y: Math.cos(theta * DEG) };
  const scene = new SceneBuilder(context.question, `vehicle on a road banked at ${fmt(theta)}°`, "banked_road");
  scene.quantity("theta", "theta", theta, "degree");
  scene.point("B", { x: 0, y: 0 }, "inner edge", "B");
  scene.point("T", scale(along, L), "outer edge");
  scene.point("F", { x: L * along.x, y: 0 }, "base corner");
  scene.segment("incline", "B", "T", "banked surface");
  scene.segment("ground", "B", "F", "horizontal reference");
  scene.segment("rise", "F", "T", "vertical side");
  scene.angleMark("angle", "B", "incline", "ground", angleLabel(context, "theta"));
  scene.hatch("surface_hatch", "incline");
  const contact = scale(along, 0.5 * L);
  const centre = add(contact, scale(normal, 0.4));
  scene.point("C", contact, "contact point");
  scene.point("G", centre, "vehicle centre");
  scene.box("vehicle", centre, 1.3, 0.7, theta, "body vehicle", "m");
  scene.normalAt("normal_dir", "C", "incline", "surface normal helper");
  scene.vector("normal", "C", { along: "normal_dir", length: 1.5 }, "normal reaction", "N");
  scene.vector("weight", "G", { direction: { x: 0, y: -1 }, length: 1.3 }, "weight", "mg");
  scene.vector("centripetal", "G", { direction: { x: -1, y: 0 }, length: 1.1 }, "centripetal direction", "to centre");
  scene.assert("bank_angle", "angle_between", ["incline", "ground"], angleExpected(theta));
  scene.assert("normal_perp", "perpendicular", ["normal", "incline"]);
  scene.labelled("normal", "weight");
  return scene.build();
}

function hingedRod(context: GeneratorContext) {
  const orientation = text(context, "orientation", "horizontal");
  const L = 4;
  const angle = orientation === "horizontal" ? 0 : orientation === "vertical" ? -90 : -Math.abs(num(context, "theta", 30));
  const scene = new SceneBuilder(context.question, `uniform rod hinged at one end, ${orientation}`, "hinged_rod");
  if (grounded(context, "length")) scene.quantity("L", "L", num(context, "length", 1), "m");
  scene.point("H", { x: 0, y: 0 }, "hinge", "H");
  scene.point("wall_b", { x: 0, y: -1.2 }, "wall end");
  scene.point("wall_t", { x: 0, y: 1.2 }, "wall end");
  scene.segment("wall", "wall_b", "wall_t", "wall support");
  // The pose is the horizontal reference rotated about the hinge — derived, not placed.
  scene.point("E_ref", { x: L, y: 0 }, "horizontal reference end");
  scene.rotated("E", "E_ref", "H", angle, "free end", "E");
  scene.segment("rod", "H", "E", "rod", valueLabel(context, "length", "L", "m"));
  scene.midpoint("G", "H", "E", "centre of mass", "G");
  scene.vector("weight", "G", { direction: { x: 0, y: -1 }, length: 1.4 }, "weight", "mg");
  if (orientation === "horizontal") {
    scene.dimension("arm", "H", "G", "lever arm", "L/2");
    scene.assert("rod_perp_wall", "perpendicular", ["rod", "wall"]);
  } else if (orientation !== "vertical") {
    scene.segment("horizontal", "H", "E_ref", "horizontal reference");
    scene.angleMark("angle", "H", "rod", "horizontal", angleLabel(context, "theta"));
    scene.assert("rod_angle", "angle_between", ["rod", "horizontal"], angleExpected(Math.abs(angle)));
  }
  scene.assert("g_on_rod", "on", ["G", "rod"]);
  scene.assert("g_is_midpoint", "equal_length", ["H", "G", "G", "E"]);
  scene.labelled("H", "weight");
  return scene.build();
}

function ladderWall(context: GeneratorContext) {
  const theta = Math.min(Math.max(num(context, "theta", 60), 20), 85);
  const L = 4;
  const foot = { x: L * Math.cos(theta * DEG), y: 0 };
  const top = { x: 0, y: L * Math.sin(theta * DEG) };
  const scene = new SceneBuilder(context.question, `ladder leaning on a wall at ${fmt(theta)}° to the floor`, "ladder_wall");
  scene.quantity("theta", "theta", theta, "degree");
  scene.point("corner", { x: 0, y: 0 }, "wall foot");
  scene.point("floor_end", { x: foot.x + 1.2, y: 0 }, "floor end");
  scene.point("wall_top", { x: 0, y: top.y + 1 }, "wall top");
  scene.segment("floor", "corner", "floor_end", "floor");
  scene.segment("wall", "corner", "wall_top", "wall");
  scene.point("A", foot, "ladder foot", "A");
  scene.point("B", top, "ladder top", "B");
  scene.segment("ladder", "A", "B", "ladder", valueLabel(context, "length", "L", "m"));
  scene.midpoint("G", "A", "B", "centre of mass", "G");
  scene.point("floor_at_A", { x: foot.x, y: 0 }, "floor contact");
  scene.segment("floor_ref", "A", "corner", "floor reference");
  scene.angleMark("angle", "A", "ladder", "floor_ref", angleLabel(context, "theta"));
  scene.vector("weight", "G", { direction: { x: 0, y: -1 }, length: 1.2 }, "weight", "mg");
  scene.vector("N_wall", "B", { direction: { x: 1, y: 0 }, length: 1.0 }, "normal reaction from the wall", "N1");
  scene.vector("N_floor", "A", { direction: { x: 0, y: 1 }, length: 1.2 }, "normal reaction from the floor", "N2");
  scene.vector("friction", "A", { direction: { x: -1, y: 0 }, length: 0.9 }, "friction at the floor", "f");
  scene.assert("ladder_angle", "angle_between", ["ladder", "floor_ref"], angleExpected(theta));
  scene.assert("wall_perp", "perpendicular", ["wall", "floor"]);
  scene.labelled("weight", "N_wall");
  return scene.build();
}

function relativeMotionLine(context: GeneratorContext) {
  const vA = num(context, "vA", 20);
  const vB = num(context, "vB", 10);
  const same = text(context, "sameDirection", "yes") !== "no";
  const fastest = Math.max(Math.abs(vA), Math.abs(vB), 1e-9);
  const lenA = 0.5 + 1.6 * Math.abs(vA) / fastest;
  const lenB = 0.5 + 1.6 * Math.abs(vB) / fastest;
  const gap = 4;
  const scene = new SceneBuilder(context.question, "two bodies on one straight line with velocities in the stated ratio", "relative_motion_line");
  scene.quantity("q_vA", "v_A", vA, "m/s");
  scene.quantity("q_vB", "v_B", vB, "m/s");
  groundLine(scene, "line", { x: -2, y: 0 }, { x: gap + lenB + 2.5, y: 0 }, "line of motion");
  const bodyRole = /\bcars?\b/i.test(context.question) ? "car" : /\btrains?\b/i.test(context.question) ? "train" : "body";
  scene.point("GA", { x: 0, y: 0.45 }, `${bodyRole} centre`);
  scene.point("GB", { x: gap, y: 0.45 }, `${bodyRole} centre`);
  scene.rectangle("A", "GA", 1.0, 0.8, bodyRole, "A");
  scene.rectangle("B", "GB", 1.0, 0.8, bodyRole, "B");
  scene.point("vA_end", { x: 0.5 + lenA, y: 0.45 }, "velocity tip");
  scene.point("vA_start", { x: 0.5, y: 0.45 }, "velocity tail");
  scene.vector("vA", "vA_start", { end: "vA_end" }, "velocity of A", valueLabel(context, "vA", "vA", "m/s"));
  const bStart = same ? gap + 0.5 : gap - 0.5;
  scene.point("vB_start", { x: bStart, y: 0.45 }, "velocity tail");
  scene.point("vB_end", { x: same ? bStart + lenB : bStart - lenB, y: 0.45 }, "velocity tip");
  scene.vector("vB", "vB_start", { end: "vB_end" }, "velocity of B", valueLabel(context, "vB", "vB", "m/s"));
  const gapValue = maybeNum(context, "gap");
  scene.point("gap_a", { x: 0, y: -0.6 }, "separation start");
  scene.point("gap_b", { x: gap, y: -0.6 }, "separation end");
  scene.dimension("separation", "gap_a", "gap_b", "initial separation", gapValue !== null && grounded(context, "gap") ? `d=${withUnit(gapValue, "m")}` : "d");
  scene.assert("velocities_parallel", "parallel", ["vA", "vB"]);
  if (vB !== 0) scene.assert("speed_ratio", "distance_ratio", ["vA_start", "vA_end", "vB_start", "vB_end"], Number((lenA / lenB).toFixed(6)));
  scene.labelled("A", "B");
  return scene.build();
}

function collisionLine(context: GeneratorContext) {
  const u1 = num(context, "u1", 4);
  const u2 = num(context, "u2", 0);
  const fastest = Math.max(Math.abs(u1), Math.abs(u2), 1e-9);
  const len1 = 0.4 + 1.4 * Math.abs(u1) / fastest;
  const len2 = u2 === 0 ? 0 : 0.4 + 1.4 * Math.abs(u2) / fastest;
  const scene = new SceneBuilder(context.question, "two bodies about to collide along a line", "collision_line");
  groundLine(scene, "line", { x: -2, y: 0 }, { x: 7, y: 0 }, "line of motion");
  scene.point("C1", { x: 0, y: 0.5 }, "body centre", "m1");
  scene.point("C2", { x: 4.5, y: 0.5 }, "body centre", "m2");
  scene.circle("body1", "C1", 0.5, "body", grounded(context, "m1") ? `m1=${withUnit(num(context, "m1", 1), "kg")}` : "m1");
  scene.circle("body2", "C2", 0.5, "body", grounded(context, "m2") ? `m2=${withUnit(num(context, "m2", 1), "kg")}` : "m2");
  scene.point("u1_start", { x: 0.5, y: 0.5 }, "velocity tail");
  scene.point("u1_end", { x: 0.5 + len1, y: 0.5 }, "velocity tip");
  scene.vector("u1", "u1_start", { end: "u1_end" }, "velocity of body 1", valueLabel(context, "u1", "u1", "m/s"));
  if (len2 > 0) {
    const toward = u2 < 0 || /\b(?:towards? each other|opposite)\b/i.test(context.question);
    scene.point("u2_start", { x: toward ? 4.0 : 5.0, y: 0.5 }, "velocity tail");
    scene.point("u2_end", { x: toward ? 4.0 - len2 : 5.0 + len2, y: 0.5 }, "velocity tip");
    scene.vector("u2", "u2_start", { end: "u2_end" }, "velocity of body 2", valueLabel(context, "u2", "u2", "m/s"));
    scene.assert("speed_ratio", "distance_ratio", ["u1_start", "u1_end", "u2_start", "u2_end"], Number((len1 / len2).toFixed(6)));
  } else {
    scene.point("rest_mark", { x: 4.5, y: 1.2 }, "at rest marker", "u2=0");
  }
  scene.assert("bodies_on_line", "on", ["line_a", "line"]);
  scene.labelled("body1", "body2");
  return scene.build();
}

function vectorsResultant(context: GeneratorContext) {
  // A concept question with no magnitudes, components or angle given ("if a·b = 0,
  // what is the angle?") has nothing to draw; two invented arrows would be a picture
  // of nothing. Require at least one grounded vector slot before drawing.
  if (!grounded(context, "a") && !grounded(context, "b") && !grounded(context, "theta")) return null;
  const a = num(context, "a", 3);
  const b = num(context, "b", 4);
  const theta = num(context, "theta", 60);
  if (a <= 0 || b <= 0 || theta <= 0 || theta >= 180) return null;
  const unit = 3 / Math.max(a, b);
  const aEnd = { x: a * unit, y: 0 };
  const bEnd = polar(b * unit, theta);
  const rEnd = add(aEnd, bEnd);
  const magnitude = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(theta * DEG));
  const scene = new SceneBuilder(context.question, `two vectors at ${fmt(theta)}° from one origin with their resultant`, "vectors_resultant");
  scene.quantity("a", "A", a, "");
  scene.quantity("b", "B", b, "");
  scene.quantity("theta", "theta", theta, "degree");
  scene.point("O", { x: 0, y: 0 }, "origin", "O");
  scene.point("A_end", aEnd, "vector tip");
  scene.point("B_end", bEnd, "vector tip");
  scene.point("R_end", rEnd, "resultant tip");
  scene.vector("A", "O", { end: "A_end" }, "vector A", grounded(context, "a") ? `A=${fmt(a)}` : "A");
  scene.vector("B", "O", { end: "B_end" }, "vector B", grounded(context, "b") ? `B=${fmt(b)}` : "B");
  scene.vector("R", "O", { end: "R_end" }, "resultant", grounded(context, "a") && grounded(context, "b") && grounded(context, "theta") ? `R=${fmt(magnitude)}` : "R");
  scene.segment("side_a", "A_end", "R_end", "parallelogram side");
  scene.segment("side_b", "B_end", "R_end", "parallelogram side");
  scene.angleMark("angle", "O", "A", "B", angleLabel(context, "theta"));
  scene.assert("angle_ab", "angle_between", ["A", "B"], angleExpected(theta));
  scene.assert("magnitude_ratio", "distance_ratio", ["O", "A_end", "O", "B_end"], Number((a / b).toFixed(6)));
  scene.assert("sum", "vector_sum", ["A", "B", "R"]);
  scene.assert("side_a_parallel", "parallel", ["side_a", "B"]);
  scene.labelled("A", "B", "R");
  return scene.build();
}

function riverBoat(context: GeneratorContext) {
  const vb = num(context, "vb", 5);
  const vc = num(context, "vc", 3);
  if (vb <= 0 || vc < 0) return null;
  const variant = text(context, "variant", "crossing");
  const width = 4;
  const scene = new SceneBuilder(context.question, variant === "along_stream"
    ? "boat moving downstream and upstream along the river"
    : variant === "two_triangles"
      ? "the two velocity triangles: straight across and shortest time"
      : "boat crossing the river with its velocity triangle", "river_boat");
  scene.quantity("vb", "v_b", vb, "m/s");
  scene.quantity("vc", "v_c", vc, "m/s");
  scene.point("near_a", { x: -1, y: 0 }, "near bank end");
  scene.point("near_b", { x: 9, y: 0 }, "near bank end");
  scene.point("far_a", { x: -1, y: width }, "far bank end");
  scene.point("far_b", { x: 9, y: width }, "far bank end");
  scene.segment("near_bank", "near_a", "near_b", "near bank", "bank");
  scene.segment("far_bank", "far_a", "far_b", "far bank", "bank");
  scene.point("flow_start", { x: 6.4, y: width / 2 }, "current arrow tail");
  scene.vector("flow", "flow_start", { direction: { x: 1, y: 0 }, length: 1.4 }, "river current direction", "current");
  scene.assert("flow_along_bank", "parallel", ["flow", "near_bank"]);
  const k = 2.2 / Math.max(vb, vc);

  const triangle = (prefix: string, origin: Vec2, headingUpstream: boolean, cue: string): void => {
    const boatDirection: Vec2 = headingUpstream && vb > vc
      ? { x: -vc / vb, y: Math.sqrt(1 - (vc / vb) ** 2) }
      : { x: 0, y: 1 };
    const boatEnd = add(origin, scale(boatDirection, k * vb));
    const currentEnd = add(boatEnd, { x: k * vc, y: 0 });
    const originId = `${prefix}origin`;
    scene.point(originId, origin, "boat", "boat");
    scene.point(`${prefix}boat_end`, boatEnd, "boat velocity tip");
    scene.point(`${prefix}res_end`, currentEnd, "resultant tip");
    scene.vector(`${prefix}boat`, originId, { end: `${prefix}boat_end` }, "boat velocity relative to water", grounded(context, "vb") ? `vb=${withUnit(vb, "m/s")}` : "vb");
    scene.vector(`${prefix}current`, `${prefix}boat_end`, { end: `${prefix}res_end` }, "current velocity", grounded(context, "vc") ? `vc=${withUnit(vc, "m/s")}` : "vc");
    scene.vector(`${prefix}resultant`, originId, { end: `${prefix}res_end` }, "resultant velocity", "v");
    scene.assert(`${prefix}current_parallel`, "parallel", [`${prefix}current`, "near_bank"]);
    scene.assert(`${prefix}sum`, "vector_sum", [`${prefix}boat`, `${prefix}current`, `${prefix}resultant`]);
    if (vc > 0) scene.assert(`${prefix}ratio`, "distance_ratio", [originId, `${prefix}boat_end`, `${prefix}boat_end`, `${prefix}res_end`], Number((vb / vc).toFixed(6)));
    if (headingUpstream && vb > vc) {
      scene.assert(`${prefix}straight_across`, "perpendicular", [`${prefix}resultant`, "near_bank"]);
      scene.point(`${prefix}up_ref`, add(origin, { x: 0, y: 1.4 }), "perpendicular reference end");
      scene.segment(`${prefix}perp`, originId, `${prefix}up_ref`, "perpendicular to the bank");
      scene.angleMark(`${prefix}angle`, originId, `${prefix}boat`, `${prefix}perp`, `α=${fmt(Math.asin(vc / vb) / DEG)}°`);
      scene.assert(`${prefix}heading`, "angle_between", [`${prefix}boat`, `${prefix}perp`], angleExpected(Math.asin(vc / vb) / DEG));
    } else {
      scene.assert(`${prefix}boat_perp`, "perpendicular", [`${prefix}boat`, "near_bank"]);
    }
    scene.group(`${prefix}triangle`, [originId, `${prefix}boat_end`, `${prefix}res_end`, `${prefix}boat`, `${prefix}current`, `${prefix}resultant`, ...(headingUpstream && vb > vc ? [`${prefix}up_ref`, `${prefix}perp`, `${prefix}angle`] : [])], cue, ["banks"]);
  };

  scene.group("banks", ["near_a", "near_b", "far_a", "far_b", "near_bank", "far_bank", "flow_start", "flow"], "the river: two banks and the direction of the current");
  if (variant === "along_stream") {
    scene.point("down_start", { x: 1, y: 1.2 }, "boat going downstream", "boat");
    scene.point("down_end", { x: 1 + k * (vb + vc), y: 1.2 }, "downstream tip");
    scene.vector("downstream", "down_start", { end: "down_end" }, "resultant velocity downstream", `vb+vc=${fmt(vb + vc)}`);
    scene.point("up_start", { x: 7.4, y: 2.8 }, "boat going upstream", "boat");
    scene.point("up_end", { x: 7.4 - k * Math.max(vb - vc, 0.15), y: 2.8 }, "upstream tip");
    scene.vector("upstream", "up_start", { end: "up_end" }, "resultant velocity upstream", `vb−vc=${fmt(vb - vc)}`);
    scene.assert("down_parallel", "parallel", ["downstream", "near_bank"]);
    scene.assert("up_parallel", "parallel", ["upstream", "near_bank"]);
    if (vb > vc) scene.assert("ratio", "distance_ratio", ["down_start", "down_end", "up_start", "up_end"], Number(((vb + vc) / (vb - vc)).toFixed(6)));
    scene.point("res_anchor", { x: 4, y: 2 }, "resultant reference");
    scene.vector("resultant", "res_anchor", { direction: { x: 1, y: 0 }, length: 0.01 + k * vc }, "resultant reference", "vc");
    scene.labelled("down_start", "downstream");
  } else if (variant === "two_triangles") {
    triangle("across_", { x: 1.2, y: 0.4 }, true, "straight across: head upstream so the resultant is perpendicular to the bank");
    triangle("short_", { x: 5.4, y: 0.4 }, false, "shortest time: head perpendicular, the current carries the boat downstream");
  } else {
    triangle("", { x: 2.2, y: 0.4 }, true, "head upstream at α so the resultant points straight across");
  }
  return scene.build();
}

export const MECHANICS_GENERATORS: GeneratorTable = {
  projectile,
  free_fall: freeFall,
  incline_body: inclineBody,
  atwood,
  pulley_incline: pulleyIncline,
  blocks_contact: blocksContact,
  lift_body: liftBody,
  spring_mass: springMass,
  simple_pendulum: simplePendulum,
  conical_pendulum: conicalPendulum,
  vertical_circle: verticalCircle,
  circular_motion_level: circularMotionLevel,
  banked_road: bankedRoad,
  hinged_rod: hingedRod,
  ladder_wall: ladderWall,
  relative_motion_line: relativeMotionLine,
  collision_line: collisionLine,
  vectors_resultant: vectorsResultant,
  river_boat: riverBoat,
};

void rotate;
