/**
 * Topic figures: the standard textbook picture for a named topic, still
 * parameterized (a phase, an amplitude, a half-life) whenever the question
 * gives one. These exist because "draw a labelled diagram for <topic>" is a
 * real question a student asks, and an honest generic figure beats no figure.
 */
import { DEG, SceneBuilder, fmt, withUnit, type Vec2 } from "../document";
import { grounded, maybeNum, num, numbers, text, valueLabel, type GeneratorContext, type GeneratorTable } from "./context";

function pageNormalGrid(scene: SceneBuilder, prefix: string, origin: Vec2, columns: number, rows: number, spacing: number, into: boolean, role: string, label?: string): void {
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const anchor = scene.point(`${prefix}_${row}_${column}`, { x: origin.x + column * spacing, y: origin.y + row * spacing }, `${role} anchor`);
      scene.vector(`${prefix}_b_${row}_${column}`, anchor, { direction: { x: 0, y: 0 }, length: 0.3 }, role, row === 0 && column === columns - 1 ? label ?? "B" : undefined);
    }
  }
  for (const construction of scene.constructions) {
    if (construction.id.startsWith(`make_${prefix}_b_`)) construction.inputs = { ...construction.inputs, direction: [0, 0, into ? -1 : 1] };
  }
}

function shmEnergy(context: GeneratorContext) {
  const A = num(context, "amplitude", 1);
  const k = num(context, "k", 2);
  const total = 0.5 * k * A * A;
  const scene = new SceneBuilder(context.question, "kinetic, potential and total energy of SHM against displacement", "shm_energy");
  scene.axes("axes", -1.25 * A, 1.25 * A, -0.15 * total, 1.3 * total, "energy axes", "E-x");
  scene.curve("potential", `${0.5 * k}*x^2`, -A, A, "potential energy U=½kx²", "U", 65);
  scene.curve("kinetic", `${total}-${0.5 * k}*x^2`, -A, A, "kinetic energy K=½k(A²−x²)", "K", 65);
  scene.curve("total", `${total}`, -A, A, "total energy E=½kA²", "E", 17);
  scene.point("minusA", { x: -A, y: 0 }, "extreme position", "−A");
  scene.point("plusA", { x: A, y: 0 }, "extreme position", "+A");
  scene.point("origin_mark", { x: 0, y: 0 }, "equilibrium", "0");
  scene.assert("u_at_a", "function_value", ["potential"], { x: Number(A.toFixed(6)), y: Number(total.toFixed(6)) });
  scene.assert("k_at_zero", "function_value", ["kinetic"], { x: 0, y: Number(total.toFixed(6)) });
  scene.assert("sum_at_half", "function_value", ["total"], { x: Number((A / 2).toFixed(6)), y: Number(total.toFixed(6)) });
  scene.labelled("potential", "kinetic", "total");
  return scene.build();
}

function shmSuperposition(context: GeneratorContext) {
  const phase = num(context, "phase", 60);
  const A = 1;
  const omega = 2 * Math.PI / 4;
  const phi = phase * DEG;
  const resultant = 2 * A * Math.cos(phi / 2);
  const scene = new SceneBuilder(context.question, `two SHMs with phase difference ${fmt(phase)}° and their superposition`, "shm_superposition");
  if (grounded(context, "phase")) scene.quantity("phi", "phi", phase, "degree");
  scene.axes("axes", -0.3, 8.5, -2.4, 2.6, "displacement–time axes", "x-t");
  scene.curve("x1", `${A}*sin(${omega}*x)`, 0, 8, "first SHM x1", "x1", 97);
  scene.curve("x2", `${A}*sin(${omega}*x+${phi})`, 0, 8, "second SHM x2", `x2 (φ=${fmt(phase)}°)`, 97);
  scene.curve("sum", `${A}*sin(${omega}*x)+${A}*sin(${omega}*x+${phi})`, 0, 8, "resultant x1+x2", "x1+x2", 97);
  const tPeak = (Math.PI / 2 - phi / 2) / omega;
  scene.point("peak", { x: tPeak, y: resultant }, "resultant amplitude", `A'=${fmt(Math.abs(resultant))}`);
  scene.assert("peak_on_sum", "function_value", ["sum"], { x: Number(tPeak.toFixed(6)), y: Number(resultant.toFixed(6)) });
  scene.assert("x1_zero", "function_value", ["x1"], { x: 0, y: 0 });
  scene.labelled("x1", "x2", "sum");
  return scene.build();
}

function waveTypes(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "a transverse wave above a longitudinal wave, with the direction of propagation", "wave_types");
  const lambda = 4;
  scene.axes("axes", -0.5, 2.2 * lambda, -4.2, 2.2, "axes", "");
  scene.curve("transverse", `1*sin(${2 * Math.PI / lambda}*x)`, 0, 2 * lambda, "transverse wave: particles move across the direction of travel", "transverse", 97);
  scene.point("t_particle", { x: lambda / 4, y: 1 }, "particle on the transverse wave");
  scene.vector("t_osc", "t_particle", { direction: { x: 0, y: -1 }, length: 0.8 }, "transverse oscillation", "oscillation");
  scene.point("prop_a", { x: 0, y: 1.7 }, "propagation arrow tail");
  scene.vector("propagation", "prop_a", { direction: { x: 1, y: 0 }, length: 2 }, "direction of propagation", "v");
  const baseY = -2.8;
  const ticks: string[] = [];
  for (let index = 0; index < 40; index += 1) {
    const u = index / 40 * 2 * lambda;
    const x = u + 0.35 * Math.sin(2 * Math.PI * u / lambda);
    const a = scene.point(`l${index}_a`, { x, y: baseY - 0.5 }, "longitudinal wave particle");
    const b = scene.point(`l${index}_b`, { x, y: baseY + 0.5 }, "longitudinal wave particle");
    ticks.push(scene.segment(`l${index}`, a, b, index === 0 ? "longitudinal wave: particles move along the direction of travel" : "longitudinal wave particle line"));
  }
  scene.point("comp", { x: lambda / 4, y: baseY + 0.9 }, "compression", "compression");
  scene.point("rare", { x: 3 * lambda / 4, y: baseY + 0.9 }, "rarefaction", "rarefaction");
  scene.point("l_particle", { x: lambda / 2, y: baseY - 0.9 }, "particle on the longitudinal wave");
  scene.vector("l_osc", "l_particle", { direction: { x: 1, y: 0 }, length: 0.9 }, "longitudinal oscillation", "oscillation");
  scene.assert("transverse_crest", "function_value", ["transverse"], { x: Number((lambda / 4).toFixed(6)), y: 1 });
  scene.assert("ticks_parallel", "parallel", [ticks[0]!, ticks[1]!]);
  scene.labelled("transverse", "comp");
  return scene.build();
}

function forceOnConductor(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "straight conductor carrying current across a uniform magnetic field, with the force on it", "force_on_conductor");
  pageNormalGrid(scene, "grid", { x: -3, y: -2 }, 6, 4, 1.2, true, "magnetic field into the page");
  scene.point("w_a", { x: -3.4, y: 0.4 }, "conductor end");
  scene.point("w_b", { x: 3.4, y: 0.4 }, "conductor end");
  scene.segment("wire", "w_a", "w_b", "conductor", valueLabel(context, "length", "l", "m"));
  scene.point("i_at", { x: -1.5, y: 0.4 }, "current arrow anchor");
  scene.vector("current", "i_at", { direction: { x: 1, y: 0 }, length: 1.4 }, "current", valueLabel(context, "current", "I", "A"));
  scene.point("mid", { x: 0.6, y: 0.4 }, "midpoint of the conductor");
  scene.vector("force", "mid", { direction: { x: 0, y: 1 }, length: 1.6 }, "force on the conductor", "F=BIl");
  scene.assert("force_perp_wire", "perpendicular", ["force", "wire"]);
  scene.assert("current_along_wire", "parallel", ["current", "wire"]);
  scene.labelled("wire", "force");
  return scene.build();
}

function currentLoopTorque(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "rectangular current loop in a uniform field: equal and opposite forces on the two sides give a torque", "current_loop_torque");
  for (let index = 0; index < 4; index += 1) {
    scene.point(`B${index}_a`, { x: -4, y: -2.1 + index * 1.4 }, "field line start");
    scene.vector(`B${index}`, `B${index}_a`, { direction: { x: 1, y: 0 }, length: 8 }, "uniform magnetic field", index === 3 ? valueLabel(context, "B", "B", "T") : undefined);
  }
  scene.point("c1", { x: -1.5, y: -1.2 }, "loop corner");
  scene.point("c2", { x: 1.5, y: -1.2 }, "loop corner");
  scene.point("c3", { x: 1.5, y: 1.2 }, "loop corner");
  scene.point("c4", { x: -1.5, y: 1.2 }, "loop corner");
  scene.polygon("loop", ["c1", "c2", "c3", "c4"], "current loop", valueLabel(context, "current", "I", "A"));
  scene.point("i_at", { x: 0, y: -1.2 }, "current sense anchor");
  scene.vector("sense", "i_at", { direction: { x: 1, y: 0 }, length: 0.8 }, "current direction along the bottom side", "I");
  scene.point("left_mid", { x: -1.5, y: 0 }, "midpoint of the left side");
  scene.point("right_mid", { x: 1.5, y: 0 }, "midpoint of the right side");
  scene.vector("F_left", "left_mid", { direction: { x: 0, y: 0 }, length: 1.2 }, "force on the left side (out of the page)", "F");
  scene.vector("F_right", "right_mid", { direction: { x: 0, y: 0 }, length: 1.2 }, "force on the right side (into the page)", "F");
  for (const construction of scene.constructions) {
    if (construction.id === "make_F_left") construction.inputs = { ...construction.inputs, direction: [0, 0, 1] };
    if (construction.id === "make_F_right") construction.inputs = { ...construction.inputs, direction: [0, 0, -1] };
  }
  scene.point("axis_a", { x: 0, y: -2.6 }, "axis end");
  scene.point("axis_b", { x: 0, y: 2.6 }, "axis end");
  scene.segment("axis", "axis_a", "axis_b", "axis of rotation");
  scene.point("tau_at", { x: 2.6, y: 2.1 }, "torque label anchor", "τ = NIAB sinθ");
  scene.assert("axis_perp_field", "perpendicular", ["axis", "B0"]);
  scene.assert("sides_parallel", "parallel", ["axis", "B0"], false);
  scene.labelled("loop", "tau_at");
  return scene.build();
}

function revolvingCharge(context: GeneratorContext) {
  const radius = 2.2;
  const scene = new SceneBuilder(context.question, "charge revolving on a circular orbit: equivalent current and magnetic moment", "revolving_charge");
  scene.point("O", { x: 0, y: 0 }, "centre", "O");
  scene.circle("orbit", "O", radius, "orbit", valueLabel(context, "radius", "r", "m"));
  scene.point("q", { x: radius, y: 0 }, "charge", "−e");
  scene.segment("radius", "O", "q", "radius", "r");
  scene.vector("velocity", "q", { direction: { x: 0, y: 1 }, length: 1.3 }, "velocity", "v");
  scene.point("i_at", { x: -radius, y: 0 }, "current sense anchor");
  scene.vector("current", "i_at", { direction: { x: 0, y: 1 }, length: 1.1 }, "equivalent current (opposite to electron motion)", "I");
  scene.vector("moment", "O", { direction: { x: 0, y: 0 }, length: 0.4 }, "magnetic moment (out of the page)", "μ=IA");
  for (const construction of scene.constructions) {
    if (construction.id === "make_moment") construction.inputs = { ...construction.inputs, direction: [0, 0, 1] };
  }
  scene.assert("v_tangent", "perpendicular", ["velocity", "radius"]);
  scene.assert("q_on_orbit", "on", ["q", "orbit"]);
  scene.labelled("q", "velocity");
  return scene.build();
}

function barMagnetBody(scene: SceneBuilder, centre: Vec2, angleDeg: number): void {
  const half = 2;
  const along = { x: Math.cos(angleDeg * DEG), y: Math.sin(angleDeg * DEG) };
  scene.box("magnet", centre, 2 * half, 0.8, angleDeg, "bar magnet");
  scene.point("S", { x: centre.x - along.x * (half - 0.5), y: centre.y - along.y * (half - 0.5) }, "south pole", "S");
  scene.point("N", { x: centre.x + along.x * (half - 0.5), y: centre.y + along.y * (half - 0.5) }, "north pole", "N");
  scene.segment("axis", "S", "N", "magnetic axis");
}

function barMagnet(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "bar magnet with its field lines, running N to S outside the magnet", "bar_magnet");
  barMagnetBody(scene, { x: 0, y: 0 }, 0);
  scene.point("centre_ref", { x: 0, y: 0 }, "magnet centre");
  // Closed loops leave N, curve round outside the magnet and re-enter at S.
  for (const [index, radius] of [2.5, 3.2, 3.9].entries()) {
    scene.arc(`line_top${index}`, "centre_ref", radius, 12, 168, "field line", index === 0 ? "B" : undefined);
    scene.arc(`line_bottom${index}`, "centre_ref", radius, 192, 348, "field line");
    scene.point(`arrow_top${index}_at`, { x: 0, y: radius }, "field arrow anchor");
    scene.vector(`arrow_top${index}`, `arrow_top${index}_at`, { direction: { x: -1, y: 0 }, length: 0.4 }, "field direction (N to S outside)");
    scene.point(`arrow_bottom${index}_at`, { x: 0, y: -radius }, "field arrow anchor");
    scene.vector(`arrow_bottom${index}`, `arrow_bottom${index}_at`, { direction: { x: -1, y: 0 }, length: 0.4 }, "field direction (N to S outside)");
  }
  scene.point("axial_P", { x: 5.2, y: 0 }, "axial point", "P");
  scene.vector("B_axial", "axial_P", { direction: { x: 1, y: 0 }, length: 1.0 }, "field at the axial point", "B_axial");
  scene.point("eq_Q", { x: 0, y: 4.6 }, "equatorial point", "Q");
  scene.vector("B_eq", "eq_Q", { direction: { x: -1, y: 0 }, length: 1.0 }, "field at the equatorial point", "B_eq");
  scene.segment("axial_line", "N", "axial_P", "axial line");
  scene.assert("axial_along", "parallel", ["B_axial", "axis"]);
  scene.assert("equatorial_opposite", "opposite_direction", ["B_eq", "B_axial"]);
  scene.labelled("N", "S");
  return scene.build();
}

function barMagnetInField(context: GeneratorContext) {
  const theta = num(context, "theta", 30);
  const scene = new SceneBuilder(context.question, `bar magnet at ${fmt(theta)}° to a uniform field: equal and opposite forces on the poles form a couple`, "bar_magnet_in_field");
  scene.quantity("theta", "theta", theta, "degree");
  for (let index = 0; index < 4; index += 1) {
    scene.point(`B${index}_a`, { x: -4, y: -2.1 + index * 1.4 }, "field line start");
    scene.vector(`B${index}`, `B${index}_a`, { direction: { x: 1, y: 0 }, length: 8 }, "uniform magnetic field", index === 3 ? "B" : undefined);
  }
  barMagnetBody(scene, { x: 0, y: 0 }, theta);
  scene.vector("F_N", "N", { direction: { x: 1, y: 0 }, length: 1.2 }, "force on the north pole", "mB");
  scene.vector("F_S", "S", { direction: { x: -1, y: 0 }, length: 1.2 }, "force on the south pole", "mB");
  scene.point("ref_end", { x: 2.4, y: 0 }, "field direction reference end");
  scene.point("centre_ref", { x: 0, y: 0 }, "magnet centre");
  scene.segment("ref", "centre_ref", "ref_end", "field direction reference");
  scene.segment("half_axis", "centre_ref", "N", "axis from the centre to the north pole");
  scene.angleMark("angle", "centre_ref", "half_axis", "ref", `θ=${fmt(theta)}°`);
  scene.assert("axis_angle", "angle_between", ["half_axis", "ref"], { value: theta, unit: "degree" });
  scene.assert("forces_opposite", "opposite_direction", ["F_N", "F_S"]);
  scene.labelled("N", "S");
  return scene.build();
}

function faradayInduction(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "coil connected to a galvanometer with a magnet moving towards it", "faraday_induction");
  scene.point("n_top", { x: 0, y: 1.5 }, "node");
  scene.point("n_bottom", { x: 0, y: -1.5 }, "node");
  scene.symbol("coil", "inductor", "n_top", "n_bottom", "coil", "coil");
  scene.point("g_top", { x: 4, y: 1.5 }, "node");
  scene.point("g_bottom", { x: 4, y: -1.5 }, "node");
  scene.connect("w_top", "n_top", "g_top");
  scene.connect("w_bottom", "n_bottom", "g_bottom");
  scene.symbol("G", "galvanometer", "g_top", "g_bottom", "galvanometer", "G");
  scene.point("m_centre", { x: -4, y: 0 }, "magnet centre");
  scene.rectangle("magnet", "m_centre", 3, 0.8, "bar magnet", "S      N");
  scene.point("m_front", { x: -2.5, y: 0 }, "leading pole");
  scene.vector("velocity", "m_front", { direction: { x: 1, y: 0 }, length: 1.2 }, "velocity of the magnet", "v");
  scene.point("i_at", { x: 2, y: 1.5 }, "induced current anchor");
  scene.vector("induced", "i_at", { direction: { x: 1, y: 0 }, length: 0.8 }, "induced current", "I");
  scene.assert("loop", "path", ["coil", "G"], true);
  scene.sense("current_sense", "coil");
  scene.labelled("coil", "G");
  return scene.build();
}

function inductanceCoils(context: GeneratorContext) {
  const mutual = text(context, "kind", "self") === "mutual";
  const scene = new SceneBuilder(context.question, mutual ? "primary and secondary coils: a changing primary current induces an emf in the secondary" : "one coil in a circuit with a cell and a switch: its own changing current induces a back emf", "inductance_coils");
  scene.point("a1", { x: 0, y: 2 }, "node");
  scene.point("b1", { x: 3, y: 2 }, "node");
  scene.point("c1", { x: 3, y: -1 }, "node");
  scene.point("d1", { x: 0, y: -1 }, "node");
  scene.symbol("coil1", "inductor", "b1", "c1", mutual ? "primary coil" : "coil", mutual ? "P" : "L");
  scene.symbol("cell1", "cell", "d1", "a1", "cell", "E");
  scene.symbol("switch1", "switch", "a1", "b1", "switch", "K");
  scene.connect("w1", "c1", "d1");
  scene.point("i_at", { x: 1.5, y: -1.4 }, "current anchor");
  scene.vector("current", "i_at", { direction: { x: -1, y: 0 }, length: 0.9 }, "changing current", "I(t)");
  scene.assert("loop1", "path", ["cell1", "switch1", "coil1"], true);
  scene.sense("current_sense", "coil1");
  if (mutual) {
    scene.point("a2", { x: 4.5, y: 2 }, "node");
    scene.point("b2", { x: 7.5, y: 2 }, "node");
    scene.point("c2", { x: 7.5, y: -1 }, "node");
    scene.point("d2", { x: 4.5, y: -1 }, "node");
    scene.symbol("coil2", "inductor", "a2", "d2", "secondary coil", "S");
    scene.symbol("G", "galvanometer", "b2", "c2", "galvanometer", "G");
    scene.connect("w2_top", "a2", "b2");
    scene.connect("w2_bottom", "d2", "c2");
    scene.assert("loop2", "path", ["coil2", "G"], true);
    scene.assert("coils_parallel", "parallel", ["coil1", "coil2"]);
    scene.labelled("coil1", "coil2");
  } else {
    scene.point("emf_at", { x: 3.6, y: 0.5 }, "induced emf note", "ε=−L dI/dt");
    scene.labelled("coil1", "emf_at");
  }
  return scene.build();
}

function radioactiveDecay(context: GeneratorContext) {
  const halfLife = Math.max(num(context, "halfLife", 1), 1e-6);
  const N0 = 1;
  const lambda = Math.LN2 / halfLife;
  const tMax = 4 * halfLife;
  const scene = new SceneBuilder(context.question, "number of undecayed nuclei against time, halving every half-life", "radioactive_decay");
  if (grounded(context, "halfLife")) scene.quantity("T", "T_half", halfLife, "s");
  const k = tMax / (1.3 * N0);
  scene.axes("axes", -0.05 * tMax, 1.1 * tMax, -0.08 * N0 * k, 1.25 * N0 * k, "N–t axes", "N-t");
  scene.curve("decay", `(${k})*(${N0}*exp(-${lambda}*x))`, 0, tMax, "decay curve N=N₀e^(−λt)", "N=N₀e^-λt", 81);
  scene.point("N0", { x: 0, y: N0 * k }, "initial number", "N₀");
  for (const multiple of [1, 2]) {
    const t = multiple * halfLife;
    const n = N0 / 2 ** multiple;
    scene.point(`h${multiple}`, { x: t, y: n * k }, `half-life mark ${multiple}`, multiple === 1 ? "N₀/2" : "N₀/4");
    scene.point(`h${multiple}_foot`, { x: t, y: 0 }, "half-life on the time axis", multiple === 1 ? (grounded(context, "halfLife") ? `T=${withUnit(halfLife, "s")}` : "T½") : "2T½");
    scene.segment(`h${multiple}_drop`, `h${multiple}`, `h${multiple}_foot`, "ordinate at the half-life");
    scene.assert(`half_${multiple}`, "function_value", ["decay"], { x: Number(t.toFixed(6)), y: Number((n * k).toFixed(6)) });
  }
  scene.assert("equal_half_lives", "distance_ratio", ["h1_foot", "h2_foot", "N0", "h1_foot"], 1, "warning");
  scene.labelled("decay", "h1");
  return scene.build();
}

function coolingCurve(context: GeneratorContext) {
  const initial = num(context, "initial", 80);
  const ambient = Math.min(num(context, "ambient", 20), initial - 1);
  const rate = 0.25;
  const tMax = 16;
  const scene = new SceneBuilder(context.question, "temperature falling towards the surroundings under Newton's law of cooling", "cooling_curve");
  const k = tMax / (1.4 * initial);
  scene.axes("axes", -0.5, tMax * 1.1, 0, initial * 1.25 * k, "temperature–time axes", "T-t");
  scene.curve("cooling", `(${k})*(${ambient}+${initial - ambient}*exp(-${rate}*x))`, 0, tMax, "cooling curve", "T(t)", 81);
  scene.curve("ambient", `${ambient * k}`, 0, tMax, "ambient temperature", grounded(context, "ambient") ? `T₀=${fmt(ambient)}°C` : "T₀", 17);
  scene.point("start", { x: 0, y: initial * k }, "initial temperature", grounded(context, "initial") ? `${fmt(initial)}°C` : "T_i");
  scene.assert("start_on_curve", "function_value", ["cooling"], { x: 0, y: Number((initial * k).toFixed(6)) });
  scene.assert("approaches_ambient", "function_value", ["ambient"], { x: Number((tMax / 2).toFixed(6)), y: Number((ambient * k).toFixed(6)) });
  scene.labelled("cooling", "ambient");
  return scene.build();
}

function gateSymbol(scene: SceneBuilder, id: string, kind: string, origin: Vec2): void {
  const w = 1.6;
  const h = 1.2;
  const left = origin.x;
  const midY = origin.y;
  const inputs = kind === "NOT" ? [midY] : [midY + 0.35, midY - 0.35];
  inputs.forEach((y, index) => {
    scene.point(`${id}_in${index}_a`, { x: left - 0.8, y }, "input");
    scene.point(`${id}_in${index}_b`, { x: left, y }, "input end");
    scene.segment(`${id}_in${index}`, `${id}_in${index}_a`, `${id}_in${index}_b`, "input", index === 0 ? "A" : "B");
  });
  if (kind === "NOT") {
    scene.point(`${id}_p0`, { x: left, y: midY + h / 2 }, "gate corner");
    scene.point(`${id}_p1`, { x: left, y: midY - h / 2 }, "gate corner");
    scene.point(`${id}_p2`, { x: left + w * 0.8, y: midY }, "gate tip");
    scene.polygon(`${id}_body`, [`${id}_p0`, `${id}_p1`, `${id}_p2`], `${kind} gate`, kind);
  } else if (kind === "AND" || kind === "NAND") {
    scene.point(`${id}_p0`, { x: left, y: midY + h / 2 }, "gate corner");
    scene.point(`${id}_p1`, { x: left, y: midY - h / 2 }, "gate corner");
    scene.point(`${id}_p2`, { x: left + w / 2, y: midY - h / 2 }, "gate corner");
    scene.point(`${id}_p3`, { x: left + w / 2, y: midY + h / 2 }, "gate corner");
    scene.polyline(`${id}_body`, [`${id}_p3`, `${id}_p0`, `${id}_p1`, `${id}_p2`], `${kind} gate`, kind);
    scene.point(`${id}_arc_c`, { x: left + w / 2, y: midY }, "gate arc centre");
    scene.arc(`${id}_arc`, `${id}_arc_c`, h / 2, -90, 90, `${kind} gate curved face`);
  } else {
    scene.point(`${id}_p0`, { x: left, y: midY + h / 2 }, "gate corner");
    scene.point(`${id}_p1`, { x: left, y: midY - h / 2 }, "gate corner");
    scene.point(`${id}_p2`, { x: left + w, y: midY }, "gate tip");
    scene.polyline(`${id}_body`, [`${id}_p0`, `${id}_p2`, `${id}_p1`], `${kind} gate`, kind);
    scene.point(`${id}_arc_c`, { x: left - 0.5, y: midY }, "gate back arc centre");
    scene.arc(`${id}_arc`, `${id}_arc_c`, Math.hypot(0.5, h / 2), -50, 50, `${kind} gate curved back`);
  }
  const tipX = kind === "NOT" ? left + w * 0.8 : kind === "AND" || kind === "NAND" ? left + w : left + w;
  const inverted = kind === "NOT" || kind === "NAND" || kind === "NOR";
  if (inverted) {
    scene.point(`${id}_bubble_c`, { x: tipX + 0.15, y: midY }, "inversion bubble centre");
    scene.circle(`${id}_bubble`, `${id}_bubble_c`, 0.15, "inversion bubble");
  }
  scene.point(`${id}_out_a`, { x: tipX + (inverted ? 0.3 : 0), y: midY }, "output start");
  scene.point(`${id}_out_b`, { x: tipX + 1.0, y: midY }, "output end");
  scene.segment(`${id}_out`, `${id}_out_a`, `${id}_out_b`, "output", "Y");
}

function logicGates(context: GeneratorContext) {
  const wanted = text(context, "gates", "AND,OR,NOT,NAND,NOR").split(",").map((gate) => gate.trim().toUpperCase()).filter((gate) => ["AND", "OR", "NOT", "NAND", "NOR"].includes(gate));
  const gates = wanted.length ? [...new Set(wanted)].slice(0, 5) : ["AND", "OR", "NOT"];
  const scene = new SceneBuilder(context.question, `logic gate symbols: ${gates.join(", ")}`, "logic_gates");
  gates.forEach((gate, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    gateSymbol(scene, `g${index}`, gate, { x: column * 4.2, y: -row * 3 });
  });
  scene.assert("inputs_parallel", "parallel", ["g0_in0", "g0_out"]);
  scene.labelled("g0_body", "g0_out");
  return scene.build();
}

function centreOfMass(context: GeneratorContext) {
  const masses = numbers(context, "masses");
  const given = masses.length >= 2 ? masses.slice(0, 3) : [2, 3];
  const positions = numbers(context, "positions");
  const xs = positions.length === given.length ? positions : given.map((_, index) => index * (6 / (given.length - 1)));
  const total = given.reduce((sum, mass) => sum + mass, 0);
  const xcm = given.reduce((sum, mass, index) => sum + mass * xs[index]!, 0) / total;
  const scene = new SceneBuilder(context.question, `${given.length} masses on a line with their centre of mass at the mass-weighted mean position`, "centre_of_mass");
  given.forEach((mass, index) => scene.quantity(`q_m${index + 1}`, `m${index + 1}`, mass, "kg"));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  scene.point("line_a", { x: xMin - 1, y: 0 }, "line end");
  scene.point("line_b", { x: xMax + 1, y: 0 }, "line end");
  scene.segment("line", "line_a", "line_b", "line of the masses");
  const heaviest = Math.max(...given);
  given.forEach((mass, index) => {
    scene.point(`P${index + 1}`, { x: xs[index]!, y: 0 }, "body position", `x${index + 1}=${fmt(xs[index]!)}`);
    scene.circle(`body${index + 1}`, `P${index + 1}`, 0.25 + 0.35 * mass / heaviest, "body", grounded(context, "masses") ? `m${index + 1}=${withUnit(mass, "kg")}` : `m${index + 1}`);
  });
  scene.point("CM", { x: xcm, y: 0 }, "centre of mass", `CM x=${fmt(xcm)}`);
  scene.point("CM_mark_top", { x: xcm, y: 0.9 }, "centre of mass mark");
  scene.segment("CM_mark", "CM", "CM_mark_top", "centre of mass marker");
  if (given.length === 2 && given[0]! > 0 && given[1]! > 0) {
    scene.assert("lever_rule", "distance_ratio", ["P1", "CM", "CM", "P2"], Number((given[1]! / given[0]!).toFixed(6)));
  }
  scene.assert("cm_on_line", "on", ["CM", "line"]);
  scene.labelled("CM", "body1");
  return scene.build();
}

function escapeVelocity(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "body projected radially from a planet's surface with the escape speed", "escape_velocity");
  scene.point("O", { x: 0, y: 0 }, "planet centre", "O");
  scene.circle("planet", "O", 2, "planet", "Earth, M");
  scene.point("body", { x: 2, y: 0 }, "body on the surface", "m");
  scene.segment("radius", "O", "body", "planet radius", valueLabel(context, "planetRadius", "R", "m"));
  scene.vector("escape", "body", { direction: { x: 1, y: 0 }, length: 2.4 }, "escape velocity", "v_e=√(2GM/R)");
  scene.vector("gravity", "body", { direction: { x: -1, y: 0 }, length: 1.2 }, "gravitational force", "GMm/R²");
  scene.point("far", { x: 6.2, y: 0 }, "far point", "r→∞");
  scene.segment("path", "body", "far", "radial path");
  scene.assert("radial", "parallel", ["escape", "radius"]);
  scene.assert("opposite", "opposite_direction", ["escape", "gravity"]);
  scene.labelled("body", "escape");
  return scene.build();
}

function velocitySelector(context: GeneratorContext) {
  const scene = new SceneBuilder(context.question, "crossed E and B fields: electric and magnetic forces cancel for one speed", "velocity_selector");
  pageNormalGrid(scene, "grid", { x: -2.4, y: -1.6 }, 5, 3, 1.2, true, "magnetic field into the page", "B");
  scene.point("plate_top_a", { x: -3.2, y: 2.2 }, "plate end");
  scene.point("plate_top_b", { x: 3.2, y: 2.2 }, "plate end");
  scene.point("plate_bottom_a", { x: -3.2, y: -2.2 }, "plate end");
  scene.point("plate_bottom_b", { x: 3.2, y: -2.2 }, "plate end");
  scene.segment("plate_top", "plate_top_a", "plate_top_b", "positive plate", "+");
  scene.segment("plate_bottom", "plate_bottom_a", "plate_bottom_b", "negative plate", "−");
  scene.point("E_at", { x: 3.6, y: 1.8 }, "electric field arrow anchor");
  scene.vector("E", "E_at", { direction: { x: 0, y: -1 }, length: 3.4 }, "electric field", valueLabel(context, "E", "E", "N/C"));
  scene.point("q", { x: 0, y: 0.3 }, "charge", "+q");
  scene.point("v_tail", { x: -3.8, y: 0.3 }, "velocity tail");
  scene.vector("velocity", "v_tail", { end: "q" }, "velocity", "v=E/B");
  scene.vector("F_E", "q", { direction: { x: 0, y: -1 }, length: 1.2 }, "electric force", "qE");
  scene.vector("F_B", "q", { direction: { x: 0, y: 1 }, length: 1.2 }, "magnetic force", "qvB");
  scene.assert("forces_cancel", "opposite_direction", ["F_E", "F_B"]);
  scene.assert("forces_perp_v", "perpendicular", ["F_E", "velocity"]);
  scene.labelled("q", "velocity");
  return scene.build();
}

export const TOPIC_GENERATORS: GeneratorTable = {
  shm_energy: shmEnergy,
  shm_superposition: shmSuperposition,
  wave_types: waveTypes,
  force_on_conductor: forceOnConductor,
  current_loop_torque: currentLoopTorque,
  revolving_charge: revolvingCharge,
  bar_magnet: barMagnet,
  bar_magnet_in_field: barMagnetInField,
  faraday_induction: faradayInduction,
  inductance_coils: inductanceCoils,
  radioactive_decay: radioactiveDecay,
  cooling_curve: coolingCurve,
  logic_gates: logicGates,
  centre_of_mass: centreOfMass,
  escape_velocity: escapeVelocity,
  velocity_selector: velocitySelector,
};

void maybeNum;
