/**
 * Field, gravitation and electromagnetism archetypes, plus circuit networks.
 * Page-normal fields use the engine's [0,0,±1] vector convention, which the
 * runtime renders as ⊗ / ⊙ markers.
 */
import { SceneBuilder, fmt, withUnit, type Vec2 } from "../document";
import { grounded, maybeNum, num, numbers, text, valueLabel, type GeneratorContext, type GeneratorTable } from "./context";

function pageNormalGrid(scene: SceneBuilder, prefix: string, origin: Vec2, columns: number, rows: number, spacing: number, into: boolean, role: string): string[] {
  const ids: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const anchor = scene.point(`${prefix}_${row}_${column}`, { x: origin.x + column * spacing, y: origin.y + row * spacing }, `${role} anchor`);
      ids.push(scene.vector(`${prefix}_b_${row}_${column}`, anchor, { direction: { x: 0, y: 0 } as Vec2, length: 0.3 }, role, row === 0 && column === columns - 1 ? "B" : undefined));
    }
  }
  // Rewrite the just-declared directions to page-normal form.
  for (const construction of scene.constructions) {
    if (construction.id.startsWith(`make_${prefix}_b_`)) construction.inputs = { ...construction.inputs, direction: [0, 0, into ? -1 : 1] };
  }
  return ids;
}

function chargeLabel(value: number | null, symbol: string): string {
  if (value === null) return symbol;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${fmt(Math.abs(value))} μC`.slice(0, 16);
}

/* ------------------------------------------------------------------------- */

function twoPointCharges(context: GeneratorContext) {
  const q1 = maybeNum(context, "q1");
  const q2 = maybeNum(context, "q2");
  const d = maybeNum(context, "d");
  const unit = /\bcm\b/i.test(context.question) ? "cm" : "m";
  const spacing = 6;
  const scene = new SceneBuilder(context.question, "two point charges on a line at the stated separation", "two_point_charges");
  if (d !== null && grounded(context, "d")) scene.quantity("d", "d", d, unit);
  scene.point("line_a", { x: -2, y: 0 }, "line end");
  scene.point("line_b", { x: spacing + 3.5, y: 0 }, "line end");
  scene.segment("line", "line_a", "line_b", "line joining the charges");
  scene.point("q1", { x: 0, y: 0 }, "point charge", chargeLabel(q1, "q1"));
  scene.point("q2", { x: spacing, y: 0 }, "point charge", chargeLabel(q2, "q2"));
  scene.circle("q1_disc", "q1", 0.22, "charge outline");
  scene.circle("q2_disc", "q2", 0.22, "charge outline");
  scene.point("dim_a", { x: 0, y: -0.9 }, "separation start");
  scene.point("dim_b", { x: spacing, y: -0.9 }, "separation end");
  scene.dimension("separation", "dim_a", "dim_b", "separation", d !== null && grounded(context, "d") ? `d=${withUnit(d, unit)}` : "d");
  const opposite = q1 !== null && q2 !== null && Math.sign(q1) !== Math.sign(q2);
  const wantsPoint = text(context, "fieldPoint") !== "none" || /\b(?:field|force|potential)\b/i.test(context.question);
  if (wantsPoint) {
    const smallerRight = q1 !== null && q2 !== null && Math.abs(q2) < Math.abs(q1);
    const px = opposite ? (smallerRight ? spacing + 2.4 : -1.6) : spacing * 0.42;
    scene.point("P", { x: px, y: 0 }, "field point", "P");
    const signOf = (value: number | null): number => (value === null || value >= 0 ? 1 : -1);
    const dir1 = signOf(q1) * Math.sign(px - 0);
    const dir2 = signOf(q2) * Math.sign(px - spacing);
    scene.vector("E1", "P", { direction: { x: dir1, y: 0 }, length: 1.0 }, "field due to q1 at P", "E1");
    scene.point("P_up", { x: px, y: 0.55 }, "field anchor");
    scene.vector("E2", "P_up", { direction: { x: dir2, y: 0 }, length: 0.8 }, "field due to q2 at P", "E2");
    scene.assert("p_on_line", "on", ["P", "line"]);
    scene.assert("fields_collinear", "parallel", ["E1", "line"]);
  }
  scene.assert("charges_on_line", "on", ["q1", "line"]);
  scene.labelled("q1", "q2");
  return scene.build();
}

function dipoleInField(context: GeneratorContext) {
  const theta = num(context, "theta", 30);
  const half = 1.3;
  const axis: Vec2 = { x: Math.cos(theta * Math.PI / 180), y: Math.sin(theta * Math.PI / 180) };
  const scene = new SceneBuilder(context.question, `electric dipole at ${fmt(theta)}° to a uniform field`, "dipole_in_field");
  scene.quantity("theta", "theta", theta, "degree");
  for (let index = 0; index < 4; index += 1) {
    scene.point(`E${index}_a`, { x: -3.2, y: -1.5 + index }, "field line start");
    scene.vector(`E${index}`, `E${index}_a`, { direction: { x: 1, y: 0 }, length: 6.4 }, "uniform electric field", index === 3 ? "E" : undefined);
  }
  scene.point("neg", { x: -half * axis.x, y: -half * axis.y }, "point charge", "−q");
  scene.point("pos", { x: half * axis.x, y: half * axis.y }, "point charge", "+q");
  scene.segment("dipole", "neg", "pos", "dipole axis", "2a");
  scene.point("O", { x: 0, y: 0 }, "dipole centre", "O");
  scene.vector("p", "O", { direction: axis, length: 2.2 }, "dipole moment", "p");
  scene.point("ref_end", { x: 2.2, y: 0 }, "field direction reference end");
  scene.segment("ref", "O", "ref_end", "field direction reference");
  scene.angleMark("angle", "O", "p", "ref", `θ=${fmt(theta)}°`);
  scene.vector("F_pos", "pos", { direction: { x: 1, y: 0 }, length: 1.1 }, "force on +q", "qE");
  scene.vector("F_neg", "neg", { direction: { x: -1, y: 0 }, length: 1.1 }, "force on −q", "qE");
  scene.assert("dipole_angle", "angle_between", ["p", "ref"], { value: theta, unit: "degree" });
  scene.assert("ref_along_field", "parallel", ["ref", "E0"]);
  scene.assert("forces_opposite", "opposite_direction", ["F_pos", "F_neg"]);
  scene.labelled("pos", "neg");
  return scene.build();
}

function straightWireField(context: GeneratorContext) {
  const r = maybeNum(context, "r");
  const unit = /\bcm\b/i.test(context.question) ? "cm" : "m";
  const scene = new SceneBuilder(context.question, "long straight current seen end-on with its circular field lines", "straight_wire_field");
  scene.point("W", { x: 0, y: 0 }, "wire cross-section (current out of the page)", "I ⊙");
  scene.circle("wire", "W", 0.22, "wire");
  for (const [index, radius] of [1, 2, 3].entries()) {
    scene.circle(`field${index + 1}`, "W", radius, "field line");
    scene.point(`arrow${index + 1}_at`, { x: 0, y: radius }, "field line arrow anchor");
    scene.vector(`arrow${index + 1}`, `arrow${index + 1}_at`, { direction: { x: -1, y: 0 }, length: 0.35 }, "field direction on the line", index === 2 ? "B" : undefined);
  }
  scene.point("P", { x: 2, y: 0 }, "field point", "P");
  scene.segment("radius", "W", "P", "distance from the wire", r !== null && grounded(context, "r") ? `r=${withUnit(r, unit)}` : "r");
  scene.vector("B_P", "P", { direction: { x: 0, y: 1 }, length: 1.0 }, "field at P", "B");
  scene.assert("p_on_line", "on", ["P", "field2"]);
  scene.assert("b_tangent", "perpendicular", ["B_P", "radius"]);
  scene.labelled("W", "B_P");
  return scene.build();
}

function chargeInMagneticField(context: GeneratorContext) {
  const negative = /\belectron\b/i.test(context.question) || /\bnegative(?:ly)?\b/i.test(context.question);
  const radius = 2.2;
  const scene = new SceneBuilder(context.question, `${negative ? "negative" : "positive"} charge entering a magnetic field and moving on a circle`, "charge_in_magnetic_field");
  pageNormalGrid(scene, "grid", { x: 0.4, y: -2.6 }, 5, 5, 1.2, true, "magnetic field into the page");
  const centre = { x: 0.4, y: negative ? -radius : radius };
  scene.point("entry", { x: 0.4, y: 0 }, "particle entering the field", negative ? "e⁻" : "+q");
  scene.point("v_tail", { x: -2.6, y: 0 }, "velocity tail");
  scene.vector("velocity", "v_tail", { end: "entry" }, "velocity", valueLabel(context, "v", "v", "m/s"));
  scene.point("C", centre, "centre of the circular path", "C");
  scene.arc("path", "C", radius, negative ? 90 : -90, negative ? -90 : 90, "circular path", "r");
  scene.segment("radius", "C", "entry", "radius of the path", "r");
  scene.vector("force", "entry", { direction: { x: 0, y: negative ? -1 : 1 }, length: 1.2 }, "magnetic force", "F=qvB");
  scene.assert("force_perp_v", "perpendicular", ["force", "velocity"]);
  scene.assert("v_tangent", "perpendicular", ["velocity", "radius"]);
  scene.assert("entry_on_path", "on", ["entry", "path"]);
  scene.labelled("entry", "velocity");
  return scene.build();
}

function solenoidField(context: GeneratorContext) {
  const turns = 9;
  const scene = new SceneBuilder(context.question, "solenoid with its turns and the axial field inside", "solenoid_field");
  scene.point("body_centre", { x: 0, y: 0 }, "solenoid centre");
  scene.rectangle("solenoid", "body_centre", 8, 2.4, "solenoid outline", valueLabel(context, "turns", "n", "/m"));
  for (let index = 0; index < turns; index += 1) {
    const x = -3.6 + index * 0.9;
    scene.point(`t${index}_a`, { x, y: -1.2 }, "turn end");
    scene.point(`t${index}_b`, { x, y: 1.2 }, "turn end");
    scene.segment(`turn${index}`, `t${index}_a`, `t${index}_b`, "turn of the winding");
  }
  scene.point("axis_a", { x: -5.2, y: 0 }, "axis start");
  scene.point("axis_b", { x: 5.2, y: 0 }, "axis end");
  scene.segment("axis", "axis_a", "axis_b", "axis of the solenoid");
  for (const [index, y] of [-0.6, 0, 0.6].entries()) {
    scene.point(`B${index}_a`, { x: -3.2, y }, "field line start");
    scene.vector(`B${index}`, `B${index}_a`, { direction: { x: 1, y: 0 }, length: 6.4 }, "axial field", index === 1 ? "B" : undefined);
  }
  scene.point("I_at", { x: -4.4, y: 1.8 }, "current label anchor");
  scene.vector("current", "I_at", { direction: { x: 1, y: 0 }, length: 1.0 }, "current in the winding", valueLabel(context, "current", "I", "A"));
  scene.assert("field_along_axis", "parallel", ["B1", "axis"]);
  scene.assert("turns_perp", "perpendicular", ["turn0", "axis"]);
  scene.labelled("solenoid", "B1");
  return scene.build();
}

function parallelWires(context: GeneratorContext) {
  const d = maybeNum(context, "d");
  const unit = /\bcm\b/i.test(context.question) ? "cm" : "m";
  const antiparallel = /\b(?:opposite|antiparallel|anti-parallel)\b/i.test(context.question);
  const scene = new SceneBuilder(context.question, `two parallel currents ${antiparallel ? "in opposite directions repel" : "in the same direction attract"}`, "parallel_wires");
  scene.point("w1_a", { x: 0, y: -2.5 }, "wire end");
  scene.point("w1_b", { x: 0, y: 2.5 }, "wire end");
  scene.point("w2_a", { x: 3, y: -2.5 }, "wire end");
  scene.point("w2_b", { x: 3, y: 2.5 }, "wire end");
  scene.segment("wire1", "w1_a", "w1_b", "wire 1");
  scene.segment("wire2", "w2_a", "w2_b", "wire 2");
  scene.point("i1_at", { x: 0, y: 1.2 }, "current arrow anchor");
  scene.point("i2_at", { x: 3, y: antiparallel ? -1.2 : 1.2 }, "current arrow anchor");
  scene.vector("I1", "i1_at", { direction: { x: 0, y: 1 }, length: 1.0 }, "current in wire 1", valueLabel(context, "i1", "I1", "A"));
  scene.vector("I2", "i2_at", { direction: { x: 0, y: antiparallel ? -1 : 1 }, length: 1.0 }, "current in wire 2", valueLabel(context, "i2", "I2", "A"));
  scene.point("f1_at", { x: 0, y: -0.4 }, "force anchor");
  scene.point("f2_at", { x: 3, y: -0.4 }, "force anchor");
  scene.vector("F1", "f1_at", { direction: { x: antiparallel ? -1 : 1, y: 0 }, length: 1.0 }, "force on wire 1", "F");
  scene.vector("F2", "f2_at", { direction: { x: antiparallel ? 1 : -1, y: 0 }, length: 1.0 }, "force on wire 2", "F");
  scene.point("dim_a", { x: 0, y: -3.1 }, "separation start");
  scene.point("dim_b", { x: 3, y: -3.1 }, "separation end");
  scene.dimension("separation", "dim_a", "dim_b", "separation", d !== null && grounded(context, "d") ? `d=${withUnit(d, unit)}` : "d");
  scene.assert("wires_parallel", "parallel", ["wire1", "wire2"]);
  scene.assert("forces_opposite", "opposite_direction", ["F1", "F2"]);
  scene.labelled("I1", "I2");
  return scene.build();
}

function parallelPlates(context: GeneratorContext) {
  const d = maybeNum(context, "d");
  const unit = /\bmm\b/i.test(context.question) ? "mm" : /\bcm\b/i.test(context.question) ? "cm" : "m";
  const scene = new SceneBuilder(context.question, "two parallel plates with the uniform field between them", "parallel_plates");
  scene.point("p1_a", { x: -3, y: 1 }, "plate end");
  scene.point("p1_b", { x: 3, y: 1 }, "plate end");
  scene.point("p2_a", { x: -3, y: -1 }, "plate end");
  scene.point("p2_b", { x: 3, y: -1 }, "plate end");
  scene.segment("plate1", "p1_a", "p1_b", "positive plate", "+Q");
  scene.segment("plate2", "p2_a", "p2_b", "negative plate", "−Q");
  for (let index = 0; index < 5; index += 1) {
    scene.point(`e${index}_a`, { x: -2.4 + index * 1.2, y: 0.85 }, "field line start");
    scene.vector(`E${index}`, `e${index}_a`, { direction: { x: 0, y: -1 }, length: 1.7 }, "electric field between the plates", index === 4 ? "E" : undefined);
  }
  scene.point("dim_a", { x: 3.5, y: 1 }, "separation start");
  scene.point("dim_b", { x: 3.5, y: -1 }, "separation end");
  scene.dimension("separation", "dim_a", "dim_b", "plate separation", d !== null && grounded(context, "d") ? `d=${withUnit(d, unit)}` : "d");
  scene.assert("plates_parallel", "parallel", ["plate1", "plate2"]);
  scene.assert("field_perp", "perpendicular", ["E0", "plate1"]);
  scene.labelled("plate1", "plate2");
  return scene.build();
}

function satelliteOrbit(context: GeneratorContext) {
  const radius = maybeNum(context, "radius");
  const height = maybeNum(context, "height");
  const planetRadius = maybeNum(context, "planetRadius") ?? 6.4e6;
  const orbitRadius = radius ?? (height !== null ? planetRadius + height : null);
  const orbitDisplay = 3;
  const planetDisplay = orbitRadius !== null && orbitRadius > planetRadius ? Math.max(0.5, orbitDisplay * planetRadius / orbitRadius) : 1.2;
  const scene = new SceneBuilder(context.question, "satellite on a circular orbit around the planet", "satellite_orbit");
  scene.point("O", { x: 0, y: 0 }, "planet centre", "O");
  scene.circle("planet", "O", planetDisplay, "planet", "Earth");
  scene.circle("orbit", "O", orbitDisplay, "orbit");
  scene.point("S", { x: orbitDisplay, y: 0 }, "satellite", "S");
  scene.segment("radius", "O", "S", "orbital radius", orbitRadius !== null && (grounded(context, "radius") || grounded(context, "height")) ? `r=${withUnit(orbitRadius / 1000, "km", 4)}` : "r");
  scene.vector("velocity", "S", { direction: { x: 0, y: 1 }, length: 1.2 }, "orbital velocity", "v");
  scene.vector("gravity", "S", { direction: { x: -1, y: 0 }, length: 1.1 }, "gravitational force", "F");
  scene.point("surface", { x: planetDisplay, y: 0 }, "planet surface point");
  if (height !== null && grounded(context, "height")) {
    scene.dimension("height", "surface", "S", "height above the surface", `h=${withUnit(height / 1000, "km", 4)}`);
  }
  scene.assert("s_on_orbit", "on", ["S", "orbit"]);
  scene.assert("v_tangent", "perpendicular", ["velocity", "radius"]);
  if (orbitRadius !== null && (grounded(context, "radius") || grounded(context, "height")) && grounded(context, "planetRadius")) {
    scene.assert("radius_ratio", "distance_ratio", ["O", "S", "O", "surface"], Number((orbitRadius / planetRadius).toFixed(6)));
  }
  scene.labelled("S", "radius");
  return scene.build();
}

function motionalEmfRod(context: GeneratorContext) {
  const length = maybeNum(context, "length");
  const scene = new SceneBuilder(context.question, "conducting rod moving across a magnetic field", "motional_emf_rod");
  pageNormalGrid(scene, "grid", { x: -3, y: -1.5 }, 6, 4, 1.2, true, "magnetic field into the page");
  scene.point("rod_a", { x: 0.6, y: -2.2 }, "rod end", "Q");
  scene.point("rod_b", { x: 0.6, y: 2.2 }, "rod end", "P");
  scene.segment("rod", "rod_a", "rod_b", "conducting rod", length !== null && grounded(context, "length") ? `l=${withUnit(length, "m")}` : "l");
  if (/\brails?\b/i.test(context.question)) {
    scene.point("rail1_a", { x: -3.4, y: -2.2 }, "rail end");
    scene.point("rail1_b", { x: 4, y: -2.2 }, "rail end");
    scene.point("rail2_a", { x: -3.4, y: 2.2 }, "rail end");
    scene.point("rail2_b", { x: 4, y: 2.2 }, "rail end");
    scene.segment("rail1", "rail1_a", "rail1_b", "rail");
    scene.segment("rail2", "rail2_a", "rail2_b", "rail");
    scene.assert("rod_perp_rail", "perpendicular", ["rod", "rail1"]);
  }
  scene.point("mid", { x: 0.6, y: 0 }, "rod midpoint");
  scene.vector("velocity", "mid", { direction: { x: 1, y: 0 }, length: 1.6 }, "velocity of the rod", valueLabel(context, "v", "v", "m/s"));
  scene.assert("v_perp_rod", "perpendicular", ["velocity", "rod"]);
  scene.labelled("rod", "velocity");
  return scene.build();
}

/* ------------------------------------------------------------------------- */
/* Circuits                                                                   */
/* ------------------------------------------------------------------------- */

function ohmLabel(symbol: string, value: number | undefined): string {
  return value === undefined ? symbol : `${symbol}=${fmt(value)}Ω`.slice(0, 16);
}

/** The stem names a source; only then may the network be closed through one. */
function namesSource(question: string): boolean {
  return /\b(?:battery|batteries|cells?|emf|e\.m\.f|source|supply|\d+(?:\.\d+)?\s*(?:V|volts?)\b|potential difference|connected across|applied across)\b/i.test(question);
}

/** Enough circuit vocabulary to trust that the stem describes a network (guards OCR garbage). */
function describesNetwork(question: string): boolean {
  return /\b(?:resist|ohm|Ω|batter|cells?|emf|volt|current|branch|loop|junction|network|circuit|node)/i.test(question);
}

function closeWithBattery(scene: SceneBuilder, left: string, right: string, leftAt: Vec2, rightAt: Vec2, emfLabel: string): void {
  const y = Math.min(leftAt.y, rightAt.y) - 2;
  const midX = (leftAt.x + rightAt.x) / 2;
  scene.point("bl", { x: leftAt.x, y }, "node");
  scene.point("br", { x: rightAt.x, y }, "node");
  scene.point("bat_a", { x: midX - 0.6, y }, "node");
  scene.point("bat_b", { x: midX + 0.6, y }, "node");
  scene.connect("w_left", left, "bl");
  scene.connect("w_right", right, "br");
  scene.connect("w_bl", "bl", "bat_a");
  scene.connect("w_br", "bat_b", "br");
  scene.symbol("battery", "battery", "bat_b", "bat_a", "source", emfLabel);
}

function resistorNetwork(context: GeneratorContext) {
  const values = numbers(context, "resistors");
  const topology = text(context, "topology", "series");
  // Two separate circuits asked for (series AND parallel, "each circuit"): the
  // family builder draws both views; a single mixed network would be wrong.
  if (topology === "both") return null;
  const count = Math.max(2, Math.min(values.length || 2, 4));
  const scene = new SceneBuilder(context.question, `${topology.replace(/_/g, "–")} resistor network with the stated values`, "resistor_network");
  values.slice(0, count).forEach((value, index) => scene.quantity(`q_R${index + 1}`, `R${index + 1}`, value, "ohm"));
  const emf = maybeNum(context, "emf");
  const emfLabel = emf !== null && grounded(context, "emf") ? `${fmt(emf)} V` : "V";
  const withSource = namesSource(context.question);
  const labels = Array.from({ length: count }, (_, index) => ohmLabel(`R${index + 1}`, values[index]));
  const close = (left: string, right: string, leftAt: Vec2, rightAt: Vec2): void => {
    if (withSource) closeWithBattery(scene, left, right, leftAt, rightAt, emfLabel);
  };
  if (topology === "series") {
    const nodes = Array.from({ length: count + 1 }, (_, index) => scene.point(`n${index}`, { x: index * 2, y: 2 }, "node"));
    const ids = nodes.slice(0, -1).map((node, index) => scene.symbol(`R${index + 1}`, "resistor", node, nodes[index + 1]!, "resistor", labels[index]));
    close(nodes[0]!, nodes.at(-1)!, { x: 0, y: 2 }, { x: count * 2, y: 2 });
    scene.assert("series_path", "path", ids, true);
  } else if (topology === "parallel") {
    const a = scene.point("n0", { x: 0, y: 2 }, "node");
    const b = scene.point("n1", { x: 4, y: 2 }, "node");
    const ids = labels.map((label, index) => scene.symbol(`R${index + 1}`, "resistor", a, b, "resistor", label));
    close(a, b, { x: 0, y: 2 }, { x: 4, y: 2 });
    scene.assert("same_pair", "sameTerminalPair", ids, true);
  } else if (topology === "series_parallel") {
    const a = scene.point("n0", { x: 0, y: 2 }, "node");
    const b = scene.point("n1", { x: 2, y: 2 }, "node");
    const c = scene.point("n2", { x: 5, y: 2 }, "node");
    scene.symbol("R1", "resistor", a, b, "resistor", labels[0]);
    const group = labels.slice(1, 3).map((label, index) => scene.symbol(`R${index + 2}`, "resistor", b, c, "resistor", label));
    close(a, c, { x: 0, y: 2 }, { x: 5, y: 2 });
    scene.assert("parallel_pair", "sameTerminalPair", group, true);
    scene.assert("series_link", "path", ["R1", group[0]!], true);
  } else {
    const a = scene.point("n0", { x: 0, y: 2 }, "node");
    const b = scene.point("n1", { x: 3, y: 2 }, "node");
    const c = scene.point("n2", { x: 5, y: 2 }, "node");
    const group = labels.slice(0, 2).map((label, index) => scene.symbol(`R${index + 1}`, "resistor", a, b, "resistor", label));
    scene.symbol("R3", "resistor", b, c, "resistor", labels[2] ?? "R3");
    close(a, c, { x: 0, y: 2 }, { x: 5, y: 2 });
    scene.assert("parallel_pair", "sameTerminalPair", group, true);
    scene.assert("series_link", "path", [group[0]!, "R3"], true);
  }
  scene.sense("current_sense", "R1");
  scene.labelled("R1", ...(withSource ? ["battery"] : []));
  return scene.build();
}

function twoLoopNetwork(context: GeneratorContext) {
  // "Kirchhoff" alone (an OCR page, a definition) does not describe a network.
  if (!describesNetwork(context.question.replace(/kirchhoff/gi, ""))) return null;
  const values = numbers(context, "resistors");
  const emfs = numbers(context, "emfs");
  const scene = new SceneBuilder(context.question, "two-loop network: two sources with a shared middle branch", "two_loop_network");
  values.slice(0, 3).forEach((value, index) => scene.quantity(`q_R${index + 1}`, `R${index + 1}`, value, "ohm"));
  emfs.slice(0, 2).forEach((value, index) => scene.quantity(`q_E${index + 1}`, `E${index + 1}`, value, "V"));
  scene.point("n_tl", { x: 0, y: 2 }, "node");
  scene.point("n_tc", { x: 3, y: 2 }, "node", "A");
  scene.point("n_tr", { x: 6, y: 2 }, "node");
  scene.point("n_bl", { x: 0, y: 0 }, "node");
  scene.point("n_bc", { x: 3, y: 0 }, "node", "B");
  scene.point("n_br", { x: 6, y: 0 }, "node");
  scene.symbol("r1", "resistor", "n_tl", "n_tc", "resistor", ohmLabel("R1", values[0]));
  scene.symbol("r2", "resistor", "n_tc", "n_tr", "resistor", ohmLabel("R2", values[1]));
  scene.symbol("r3", "resistor", "n_tc", "n_bc", "resistor", ohmLabel("R3", values[2]));
  scene.symbol("v1", "battery", "n_bl", "n_tl", "source", emfs[0] !== undefined ? `E1=${fmt(emfs[0])} V` : "E1");
  scene.symbol("v2", "battery", "n_br", "n_tr", "source", emfs[1] !== undefined ? `E2=${fmt(emfs[1])} V` : "E2");
  scene.connect("w_bl", "n_bl", "n_bc", "return path");
  scene.connect("w_br", "n_bc", "n_br", "return path");
  scene.point("i1_at", { x: 1.2, y: 2.6 }, "current label anchor");
  scene.point("i2_at", { x: 4.8, y: 2.6 }, "current label anchor");
  scene.point("i3_at", { x: 3.6, y: 1.2 }, "current label anchor");
  scene.vector("I1", "i1_at", { direction: { x: 1, y: 0 }, length: 0.7 }, "current in the left loop", "I1");
  scene.vector("I2", "i2_at", { direction: { x: -1, y: 0 }, length: 0.7 }, "current in the right loop", "I2");
  scene.vector("I3", "i3_at", { direction: { x: 0, y: -1 }, length: 0.7 }, "current in the shared branch", "I3");
  scene.assert("left_loop", "path", ["v1", "r1", "r3"], true);
  scene.assert("right_loop", "path", ["v2", "r2", "r3"], true);
  scene.assert("return_connected", "connected", ["w_bl", "w_br"], true);
  scene.sense("current_sense", "r3");
  scene.labelled("r1", "v1");
  scene.group("network", ["n_tl", "n_tc", "n_tr", "n_bl", "n_bc", "n_br", "r1", "r2", "r3", "v1", "v2", "w_bl", "w_br"], "two loops sharing the middle branch");
  scene.group("currents", ["i1_at", "i2_at", "i3_at", "I1", "I2", "I3"], "one current per branch", ["network"]);
  return scene.build();
}

function wheatstoneBridge(context: GeneratorContext) {
  const values = numbers(context, "resistors");
  const names = ["P", "Q", "R", "S"];
  const scene = new SceneBuilder(context.question, "Wheatstone bridge: four arms, a galvanometer across the middle and a cell across the ends", "wheatstone_bridge");
  values.slice(0, 4).forEach((value, index) => scene.quantity(`q_${names[index]}`, names[index]!, value, "ohm"));
  scene.point("A", { x: 0, y: 0 }, "node", "A");
  scene.point("B", { x: 2.5, y: 2 }, "node", "B");
  scene.point("C", { x: 5, y: 0 }, "node", "C");
  scene.point("D", { x: 2.5, y: -2 }, "node", "D");
  scene.symbol("P", "resistor", "A", "B", "bridge arm", ohmLabel("P", values[0]));
  scene.symbol("Q", "resistor", "B", "C", "bridge arm", ohmLabel("Q", values[1]));
  scene.symbol("R", "resistor", "A", "D", "bridge arm", ohmLabel("R", values[2]));
  scene.symbol("S", "resistor", "D", "C", "bridge arm", values[3] !== undefined ? ohmLabel("S", values[3]) : "S=?");
  scene.symbol("G", "galvanometer", "B", "D", "galvanometer", "G");
  closeWithBattery(scene, "A", "C", { x: 0, y: -2 }, { x: 5, y: -2 }, "E");
  scene.assert("upper_path", "path", ["P", "Q"], true);
  scene.assert("lower_path", "path", ["R", "S"], true);
  scene.assert("galvanometer_bridges", "connected", ["G", "P", "Q", "R", "S"], true);
  scene.sense("current_sense", "P");
  scene.labelled("P", "G");
  return scene.build();
}

function meterBridge(context: GeneratorContext) {
  const balance = maybeNum(context, "balance");
  const l = balance !== null && balance > 0 && balance < 100 ? balance : 50;
  const known = maybeNum(context, "known");
  const scene = new SceneBuilder(context.question, `metre bridge balanced at ${fmt(l)} cm along the wire`, "meter_bridge");
  if (balance !== null && grounded(context, "balance")) scene.quantity("l", "l", balance, "cm");
  scene.point("A", { x: 0, y: 0 }, "wire end", "A");
  scene.point("J", { x: l / 10, y: 0 }, "jockey contact", `J (${fmt(l)} cm)`);
  scene.point("C", { x: 10, y: 0 }, "wire end", "C");
  scene.symbol("wire_AJ", "resistor", "A", "J", "bridge wire, left of the jockey", "l");
  scene.symbol("wire_JC", "resistor", "J", "C", "bridge wire, right of the jockey", "100−l");
  scene.point("B", { x: 5, y: 2.4 }, "gap junction", "B");
  const leftUnknown = /\bunknown\b[^.]{0,40}\bleft\b/i.test(context.question) || /\bleft gap\b[^.]{0,30}\bunknown\b/i.test(context.question);
  const knownLabel = known !== null && grounded(context, "known") ? `${fmt(known)}Ω` : "R";
  scene.symbol("left_gap", "resistor", "A", "B", "resistor in the left gap", leftUnknown ? "X=?" : knownLabel);
  scene.symbol("right_gap", "resistor", "B", "C", "resistor in the right gap", leftUnknown ? knownLabel : "X=?");
  scene.symbol("G", "galvanometer", "B", "J", "galvanometer", "G");
  closeWithBattery(scene, "A", "C", { x: 0, y: 0 }, { x: 10, y: 0 }, "E");
  scene.assert("balance_ratio", "distance_ratio", ["A", "J", "J", "C"], Number((l / (100 - l)).toFixed(6)));
  scene.assert("wire_path", "path", ["wire_AJ", "wire_JC"], true);
  scene.assert("gap_path", "path", ["left_gap", "right_gap"], true);
  scene.sense("current_sense", "wire_AJ");
  scene.labelled("J", "G");
  return scene.build();
}

function capacitorNetwork(context: GeneratorContext) {
  const values = numbers(context, "capacitors");
  const topology = text(context, "topology", "series");
  const count = Math.max(2, Math.min(values.length || 2, 4));
  const scene = new SceneBuilder(context.question, `${topology.replace(/_/g, "–")} capacitor network with the stated values`, "capacitor_network");
  values.slice(0, count).forEach((value, index) => scene.quantity(`q_C${index + 1}`, `C${index + 1}`, value, "uF"));
  const emf = maybeNum(context, "emf");
  const emfLabel = emf !== null && grounded(context, "emf") ? `${fmt(emf)} V` : "V";
  const withSource = namesSource(context.question);
  const labels = Array.from({ length: count }, (_, index) => values[index] !== undefined ? `C${index + 1}=${fmt(values[index]!)}μF`.slice(0, 16) : `C${index + 1}`);
  if (topology === "parallel") {
    const a = scene.point("n0", { x: 0, y: 2 }, "node");
    const b = scene.point("n1", { x: 4, y: 2 }, "node");
    const ids = labels.map((label, index) => scene.symbol(`C${index + 1}`, "capacitor", a, b, "capacitor", label));
    if (withSource) closeWithBattery(scene, a, b, { x: 0, y: 2 }, { x: 4, y: 2 }, emfLabel);
    scene.assert("same_pair", "sameTerminalPair", ids, true);
  } else {
    const nodes = Array.from({ length: count + 1 }, (_, index) => scene.point(`n${index}`, { x: index * 2, y: 2 }, "node"));
    const ids = nodes.slice(0, -1).map((node, index) => scene.symbol(`C${index + 1}`, "capacitor", node, nodes[index + 1]!, "capacitor", labels[index]));
    if (withSource) closeWithBattery(scene, nodes[0]!, nodes.at(-1)!, { x: 0, y: 2 }, { x: count * 2, y: 2 }, emfLabel);
    scene.assert("series_path", "path", ids, true);
  }
  scene.sense("current_sense", "C1");
  scene.labelled("C1", ...(withSource ? ["battery"] : []));
  return scene.build();
}

function potentiometer(context: GeneratorContext) {
  const balance = maybeNum(context, "balance");
  const wireLength = maybeNum(context, "wireLength");
  const total = wireLength !== null && wireLength > 0 ? wireLength * (wireLength < 20 ? 100 : 1) : 100;
  const l = balance !== null && balance > 0 && balance < total ? balance : total * 0.6;
  const scene = new SceneBuilder(context.question, `potentiometer balanced at ${fmt(l)} cm from the end A`, "potentiometer");
  if (balance !== null && grounded(context, "balance")) scene.quantity("l", "l", balance, "cm");
  scene.point("A", { x: 0, y: 0 }, "wire end", "A");
  scene.point("J", { x: 10 * l / total, y: 0 }, "jockey contact", `J (${fmt(l)} cm)`);
  scene.point("B", { x: 10, y: 0 }, "wire end", "B");
  scene.symbol("wire_AJ", "resistor", "A", "J", "potentiometer wire, A to the jockey", "l");
  scene.symbol("wire_JB", "resistor", "J", "B", "potentiometer wire, jockey to B", "L−l");
  scene.point("dt_l", { x: 0, y: 2.4 }, "node");
  scene.point("dt_r", { x: 10, y: 2.4 }, "node");
  scene.point("d_a", { x: 4.4, y: 2.4 }, "node");
  scene.point("d_b", { x: 5.6, y: 2.4 }, "node");
  scene.connect("w_dl", "A", "dt_l");
  scene.connect("w_dr", "B", "dt_r");
  scene.connect("w_da", "dt_l", "d_a");
  scene.connect("w_db", "d_b", "dt_r");
  scene.symbol("driver", "cell", "d_a", "d_b", "driver cell", "E₀");
  scene.point("s_l", { x: 0, y: -2.2 }, "node");
  scene.point("s_m", { x: 4, y: -2.2 }, "node");
  scene.point("s_j", { x: 10 * l / total, y: -2.2 }, "node");
  scene.connect("w_sl", "A", "s_l");
  scene.symbol("cell", "cell", "s_l", "s_m", "cell under test", "E");
  scene.symbol("G", "galvanometer", "s_m", "s_j", "galvanometer", "G");
  scene.connect("w_sj", "s_j", "J");
  scene.assert("balance_ratio", "distance_ratio", ["A", "J", "A", "B"], Number((l / total).toFixed(6)));
  scene.assert("wire_path", "path", ["wire_AJ", "wire_JB"], true);
  scene.sense("current_sense", "wire_AJ");
  scene.labelled("J", "driver");
  return scene.build();
}

export const FIELD_GENERATORS: GeneratorTable = {
  two_point_charges: twoPointCharges,
  dipole_in_field: dipoleInField,
  straight_wire_field: straightWireField,
  charge_in_magnetic_field: chargeInMagneticField,
  solenoid_field: solenoidField,
  parallel_wires: parallelWires,
  parallel_plates: parallelPlates,
  satellite_orbit: satelliteOrbit,
  motional_emf_rod: motionalEmfRod,
  resistor_network: resistorNetwork,
  two_loop_network: twoLoopNetwork,
  wheatstone_bridge: wheatstoneBridge,
  meter_bridge: meterBridge,
  capacitor_network: capacitorNetwork,
  potentiometer,
};
