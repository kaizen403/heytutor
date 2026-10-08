import { evaluateChapterInstrumentConstruction } from "../../compile/chapterInstrumentGeometry";
import { evaluateChapterRemainderConstruction } from "../../compile/chapterRemainderGeometry";
import { evaluateCurrentFieldConstruction } from "../../compile/currentFieldGeometry";
import { evaluateMagneticConstruction } from "../../compile/magneticGeometry";
import { evaluateNetworkConstruction } from "../../compile/networkGeometry";
import { agree, construction, entity, finiteInputs, numberContext, positive, sceneDocument, type EmModel } from "./sceneKit";

const chapter = "Magnetic Effects of Current and Magnetism";
const display = 1.2;

function declared(inputs: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): Record<string, number> {
  return finiteInputs(inputs, [...required, ...optional.filter((key) => key in inputs)]);
}

function named(id: string, kind: string, role: string, label: string) {
  return { ...entity(id, kind, role), label };
}

function together(v: Record<string, number>, keys: readonly string[]): boolean {
  const count = keys.filter((key) => key in v).length;
  if (count !== 0 && count !== keys.length) throw new Error(`${keys.join(", ")} must be declared together`);
  return count > 0;
}

function pageField(id: string, value: number, x: number, y: number) {
  const entities = [named(id, "circle", "page-normal magnetic field", "B"), named(`${id}mark`, value > 0 ? "circle" : "polyline", value > 0 ? "out of page" : "into page", "")];
  const constructions = [construction(id, "circle", { center: [x, y], radius: 0.18 }, [id]), construction(`${id}mark`, value > 0 ? "circle" : "polyline", value > 0 ? { center: [x, y], radius: 0.035 } : { points: [[x - 0.09, y - 0.09], [x + 0.09, y + 0.09]] }, [`${id}mark`])];
  if (value < 0) {
    entities.push(named(`${id}cross`, "polyline", "into page cross", ""));
    constructions.push(construction(`${id}cross`, "polyline", { points: [[x - 0.09, y + 0.09], [x + 0.09, y - 0.09]] }, [`${id}cross`]));
  }
  return { entities, constructions };
}

function planarMark(id: string, value: { x: number; y: number; z: number }, label: string, origin: number[] = [0, 0]) {
  if (value.z !== 0 && (value.x !== 0 || value.y !== 0)) throw new Error(`${id} mixes planar and page-normal components`);
  if (value.z !== 0) {
    const glyph = pageField(id, value.z, origin[0], origin[1]);
    glyph.entities[0].label = label;
    return glyph;
  }
  const length = Math.hypot(value.x, value.y);
  return { entities: [named(id, length === 0 ? "point" : "vector", label, label)], constructions: [construction(id, length === 0 ? "point" : "vector", length === 0 ? { x: origin[0], y: origin[1] } : { start: origin, end: [origin[0] + 0.75 * value.x / length, origin[1] + 0.75 * value.y / length] }, [id])] };
}

/** World-frame direction diagram. Each vector has its own positive display
 * normalization; source components remain numeric authority, never length. */
function worldDirections(vectors: Array<{ id: string; label: string; value: number[] }>) {
  const entities = [
    { ...named("directionOrigin", "point", "projection origin", ""), provenance: { hideMark: true } },
    named("directionFrame", "polyline", "world direction frame", "xyz"),
    { ...named("directionZero", "point", "world zero", ""), provenance: { hideMark: true } },
  ];
  const constructions = [construction("directionOrigin", "point", { x: 0, y: 0 }, ["directionOrigin"]), construction("directionFrame", "space_frame", { origin: "directionOrigin", scale: 1, axisLength: 0.8 }, ["directionFrame"]), construction("directionZero", "space_point", { frame: "directionFrame", x: 0, y: 0, z: 0 }, ["directionZero"])];
  const source = vectors.map(({ id, label, value }, index) => {
    const magnitude = Math.hypot(...value);
    if (!Number.isFinite(magnitude)) throw new Error(`${id} has nonfinite magnitude`);
    // Distinct positive lengths preserve parallel/antiparallel world
    // directions without creating duplicate geometry. They certify no ratio.
    const displayLength = 1.2 + index * 0.25;
    const normalized = magnitude === 0 ? [0, 0, 0] : value.map((v) => v * displayLength / magnitude);
    entities.push(named(`${id}tip`, "point", `world ${id} direction endpoint`, label));
    constructions.push(construction(`${id}tip`, "space_point", { frame: "directionFrame", x: normalized[0], y: normalized[1], z: normalized[2] }, [`${id}tip`]));
    if (magnitude > 0) {
      entities.push(named(id, "segment", `world ${id} direction`, ""));
      constructions.push(construction(id, "space_segment", { frame: "directionFrame", a: "directionZero", b: `${id}tip` }, [id]));
    }
    return { id, components: value, displayMultiplier: magnitude === 0 ? 1 : displayLength / magnitude, frameId: "directionFrame" };
  });
  return { entities, constructions, source };
}

function areaEquivalentLoop(area: number[]) {
  const A = Math.hypot(...area);
  if (!(A > 0) || !Number.isFinite(A)) throw new Error("oriented area must be finite and nonzero");
  const n = area.map((v) => v / A);
  const rawU = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [1, 0, -n[0] / n[2]];
  const uLength = Math.hypot(...rawU);
  const u = rawU.map((v) => v / uLength);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const half = Math.sqrt(A) / 2;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => u.map((value, i) => half * (a * value + b * w[i])));
  const entities = [{ ...named("loopOrigin", "point", "loop projection origin", ""), provenance: { hideMark: true } }, named("loopFrame", "polyline", "world frame for area-equivalent loop", ""), ...corners.map((_, i) => ({ ...named(`loopCorner${i}`, "point", "area-equivalent world loop corner", ""), provenance: { hideMark: true } })), ...corners.map((_, i) => named(`loopEdge${i}`, "segment", "area-equivalent projected loop", i === 0 ? "loop" : ""))];
  const constructions = [construction("loopOrigin", "point", { x: -2.4, y: 0 }, ["loopOrigin"]), construction("loopFrame", "space_frame", { origin: "loopOrigin", scale: 1.5 / Math.sqrt(A), axisLength: Math.sqrt(A) * 0.4 }, ["loopFrame"]), ...corners.map((p, i) => construction(`loopCorner${i}`, "space_point", { frame: "loopFrame", x: p[0], y: p[1], z: p[2] }, [`loopCorner${i}`])), ...corners.map((_, i) => construction(`loopEdge${i}`, "space_segment", { frame: "loopFrame", a: `loopCorner${i}`, b: `loopCorner${(i + 1) % 4}` }, [`loopEdge${i}`]))];
  return { entities, constructions, source: { areaVector: area, corners, frameId: "loopFrame", areaEquivalent: true } };
}

function conversionNetwork(kind: "ammeter" | "voltmeter", G: number, resistor: number, Ig: number, range: number) {
  const nodes = kind === "ammeter" ? [{ id: "terminalA", at: [-1.5, 0] }, { id: "terminalB", at: [1.5, 0] }] : [{ id: "terminalA", at: [-1.5, 0] }, { id: "terminalB", at: [1.5, 0] }, { id: "seriesJunction", at: [0, 1.2] }];
  const branches = kind === "ammeter" ? [
    { id: "meter", kind: "detector", from: "terminalB", to: "terminalA", resistance: G, label: "G" },
    { id: "shunt", kind: "resistor", from: "terminalB", to: "terminalA", resistance: resistor, label: "S" },
    { id: "supply", kind: "source", from: "terminalA", to: "terminalB", resistance: 0, emf: G * Ig, label: "V" },
  ] : [
    { id: "meter", kind: "detector", from: "terminalB", to: "seriesJunction", resistance: G, label: "G" },
    { id: "series", kind: "resistor", from: "seriesJunction", to: "terminalA", resistance: resistor, label: "R" },
    { id: "supply", kind: "source", from: "terminalA", to: "terminalB", resistance: 0, emf: range, label: "V" },
  ];
  const inputs = { nodes, branches, ground: "terminalA", units: { resistance: "ohm", emf: "V" }, currentScale: 0.3 / Ig };
  const drawn = evaluateNetworkConstruction("kirchhoff_network", inputs, numberContext);
  const currents: Record<string, number> = {};
  for (const geometry of drawn) {
    if (!geometry.networkBranch) continue;
    currents[geometry.networkBranch.id] = geometry.networkBranch.current;
  }
  agree(currents.meter, Ig, "galvanometer full-scale current");
  if (kind === "ammeter") {
    agree(currents.shunt, range - Ig, "shunt current");
    agree(currents.supply, range, "range current");
  } else {
    agree(currents.series, Ig, "multiplier current");
    agree(currents.supply, Ig, "range current");
  }
  const entities = [...nodes.map((n) => named(n.id, "point", "electrical terminal", "")), ...branches.map((b) => named(b.id, "polyline", b.kind === "detector" ? "galvanometer" : b.kind, b.label)), ...branches.map((b) => named(`I_${b.id}`, "vector", "solved branch current", ""))];
  return { entities, constructions: [construction("conversionNetwork", "kirchhoff_network", inputs, entities.map((e) => e.id))], source: { kind, nodes, branches, currents } };
}

function componentsOf(value: unknown, key: "magneticForce" | "currentField" | "remainder"): { x: number; y: number; z: number } {
  if (typeof value === "object" && value !== null && key in value) {
    const mark = (value as Record<string, { components: { x: number; y: number; z: number } }>)[key];
    if (mark?.components) return mark.components;
  }
  throw new Error(`${key} metadata is missing`);
}

export const magneticForceModels: EmModel[] = [
  {
    name: "mf.lorentz",
    family: "point_field",
    scope: "solved",
    assumptions: "Uniform Lorentz force F=q(E+v cross B). Optional Ex,Ey,Ez must be declared together; their absence declares E=0. Velocity, field and charge accompany the force. Mixed planar/page-normal glyphs are rejected; no planar path is inferred from an out-of-page mark.",
    topics: [{ topicId: "physics|13|force-on-moving-charge", packet: "CH-05b", chapter, remaining: "A nonuniform B is unsupported." }],
    keys: ["q", "vx", "vy", "vz", "Bx", "By", "Bz"],
    ordinary: { q: 2, vx: 3, vy: 0, vz: 0, Bx: 0, By: 0, Bz: 4 },
    altered: { q: 2, vx: 3, vy: 0, vz: 0, Bx: 0, By: 0, Bz: 0 },
    rejections: [{ q: 2, vx: 1, vy: 0, vz: 1, Bx: 0, By: 1, Bz: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["Ex", "Ey", "Ez"]);
      const electric = together(v, ["Ex", "Ey", "Ez"]);
      const magneticForce = {
        x: v.q * (v.vy * v.Bz - v.vz * v.By),
        y: v.q * (v.vz * v.Bx - v.vx * v.Bz),
        z: v.q * (v.vx * v.By - v.vy * v.Bx),
      };
      const F = { x: magneticForce.x + v.q * (v.Ex ?? 0), y: magneticForce.y + v.q * (v.Ey ?? 0), z: magneticForce.z + v.q * (v.Ez ?? 0) };
      if (F.z !== 0 && (F.x !== 0 || F.y !== 0)) throw new Error("mixed planar and page-normal force is not drawn");
      const operatorInputs = {
        charge: v.q, velocity: [v.vx, v.vy, v.vz], magneticField: [v.Bx, v.By, v.Bz],
        units: { charge: "C", velocity: "m/s", magneticField: "T" }, displayLength: magneticForce.z !== 0 ? 0.18 : display,
      };
      const drawn = evaluateMagneticConstruction("magnetic_force", operatorInputs, numberContext);
      const actual = componentsOf(drawn[0], "magneticForce");
      agree(actual.x, magneticForce.x, "Fx");
      agree(actual.y, magneticForce.y, "Fy");
      agree(actual.z, magneticForce.z, "Fz");
      const velocityMark = planarMark("velocity", { x: v.vx, y: v.vy, z: v.vz }, "v", [-1.5, 0]);
      const magneticMark = planarMark("magnetic", { x: v.Bx, y: v.By, z: v.Bz }, "B", [1.5, 0]);
      const electricMark = electric ? planarMark("electric", { x: v.Ex, y: v.Ey, z: v.Ez }, "E", [-1.5, 1.2]) : { entities: [], constructions: [] };
      const forceMark = electric ? planarMark("force", F, "F") : { entities: [entity("force", "vector", "Lorentz force")], constructions: [construction("force", "magnetic_force", operatorInputs, ["force"])] };
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { Fx: F.x, Fy: F.y, Fz: F.z, F: Math.hypot(F.x, F.y, F.z) },
        entities: [...forceMark.entities, ...velocityMark.entities, ...magneticMark.entities, ...electricMark.entities, named("charge", "point", "source charge", v.q < 0 ? "q-" : v.q > 0 ? "q+" : "q=0")],
        constructions: [...forceMark.constructions, ...velocityMark.constructions, ...magneticMark.constructions, ...electricMark.constructions, construction("charge", "point", { x: 0, y: 0 }, ["charge"])],
      });
    },
  },
  {
    name: "mf.selector",
    family: "vector_diagram",
    scope: "solved",
    assumptions: "Uniform crossed fields E along signed y and B along signed z; selected signed vx=E/B. crossed=1 declares perpendicular fields. Optional nonzero q declares the beam charge; optional vx must satisfy E-vx B=0. Electric and magnetic forces are equal and opposite for either charge sign.",
    topics: [{ topicId: "physics|13|velocity-selector", packet: "CH-05b", chapter, remaining: "A velocity that does not equal E/B is not drawn as undeflected." }],
    keys: ["E", "B", "crossed"],
    ordinary: { E: 6, B: 2, crossed: 1 },
    altered: { E: 8, B: 2, crossed: 1 },
    rejections: [{ E: 6, B: 0, crossed: 1 }, { E: 6, B: 2, crossed: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["q", "vx"]);
      if (v.E === 0 || v.B === 0) throw new Error("nonzero crossed fields are required for a velocity selector");
      if (v.crossed !== 1) throw new Error("the selector model requires perpendicular E and B");
      const selected = v.E / v.B;
      const q = v.q ?? 1;
      if (q === 0) throw new Error("the beam charge must be nonzero");
      if (v.vx !== undefined && Math.abs(v.E - v.vx * v.B) > 1e-10 * Math.max(Math.abs(v.E), Math.abs(v.vx * v.B))) throw new Error("beam direction/speed does not balance the crossed forces");
      const field = pageField("magnetic", v.B, 1.8, 0);
      const currentInputs = { charge: q, velocity: [selected, 0, 0], magneticField: [0, 0, v.B], units: { charge: "C", velocity: "m/s", magneticField: "T" }, displayLength: 0.6 };
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { v: v.E / v.B },
        entities: [named("electric", "vector", "electric field", "E"), named("velocity", "vector", "selected velocity", "v"), named("electricForce", "vector", "electric force qE", "qE"), entity("magneticForce", "vector", "magnetic force qv cross B"), named("platePositive", "polyline", "positive selector plate", "+"), named("plateNegative", "polyline", "negative selector plate", "-"), ...field.entities],
        constructions: [
          construction("electric", "vector", { start: [-1.8, 0], end: [-1.8, Math.sign(v.E) * 0.55] }, ["electric"]),
          construction("velocity", "vector", { start: [-0.6 * Math.sign(selected), 0], end: [0.6 * Math.sign(selected), 0] }, ["velocity"]),
          construction("electricForce", "vector", { start: [0, 0], end: [0, Math.sign(q * v.E) * 0.6] }, ["electricForce"]),
          construction("magneticForce", "magnetic_force", currentInputs, ["magneticForce"]),
          construction("platePositive", "polyline", { points: [[-1.2, -Math.sign(v.E)], [1.2, -Math.sign(v.E)]] }, ["platePositive"]),
          construction("plateNegative", "polyline", { points: [[-1.2, Math.sign(v.E)], [1.2, Math.sign(v.E)]] }, ["plateNegative"]),
          ...field.constructions,
        ],
      });
    },
  },
  {
    name: "mf.cyclotron",
    family: "point_field",
    scope: "solved",
    assumptions: "Nonrelativistic cyclotron snapshot in uniform signed B. r=mv/|qB|, T=2pi m/|qB|. timing=1 explicitly requests period/frequency. Optional gapVoltage and integer crossing declare alternating gap acceleration: crossing 0 is +x, the next is -x; rfSign must equal sign(q)*(-1)^crossing. Gain=|q|gapVoltage. This is a snapshot of the stated speed, not a fabricated accelerating spiral.",
    topics: [{ topicId: "physics|13|cyclotron-and-circular-motion-in-b", packet: "CH-05b", chapter, remaining: "Relativistic detuning and an accelerating orbit require a supplied time-dependent model; named cyclotron scope remains editorial review for J/N." }],
    keys: ["q", "m", "B", "v"],
    ordinary: { q: 1, m: 2, B: 2, v: 3 },
    altered: { q: -1, m: 2, B: 2, v: 3 },
    rejections: [{ q: 0, m: 2, B: 2, v: 3 }, { q: 1, m: 2, B: 0, v: 3 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["timing", "gapVoltage", "crossing", "rfSign"]);
      positive(v.m, "m");
      positive(v.v, "v");
      if (v.q === 0 || v.B === 0) throw new Error("cyclotron charge and field must be nonzero");
      const radius = v.m * v.v / (Math.abs(v.q) * Math.abs(v.B));
      if (v.timing !== undefined && v.timing !== 1) throw new Error("timing must be explicitly 1");
      const gap = together(v, ["gapVoltage", "crossing"]);
      if (gap && (!(v.gapVoltage > 0) || !Number.isInteger(v.crossing) || v.crossing < 0)) throw new Error("gap voltage magnitude must be positive and crossing a nonnegative integer");
      if (v.rfSign !== undefined && !gap) throw new Error("RF polarity needs the declared crossing and gap voltage");
      const rfSign = gap ? Math.sign(v.q) * (v.crossing % 2 === 0 ? 1 : -1) : 0;
      if (v.rfSign !== undefined && v.rfSign !== rfSign) throw new Error("RF polarity decelerates this signed charge crossing");
      const operatorInputs = {
        charge: v.q, mass: v.m, field: v.B, speed: v.v, displayScale: 0.4,
        units: { charge: "C", mass: "kg", field: "T", speed: "m/s" },
      };
      const drawn = evaluateChapterInstrumentConstruction("cyclotron", operatorInputs, numberContext);
      const certified = drawn[0] && "instrument" in drawn[0] ? drawn[0].instrument.certified : undefined;
      if (typeof certified !== "number") throw new Error("cyclotron radius metadata is missing");
      agree(certified, radius, "radius");
      const fieldGlyph = drawn[4];
      if (fieldGlyph?.kind !== "multi_path" || !fieldGlyph.paths[0]?.length) throw new Error("cyclotron field ring is missing");
      const ring = fieldGlyph.paths[0];
      const xs = ring.map((point) => point.x);
      const ys = ring.map((point) => point.y);
      const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const ringRadius = (Math.max(...xs) - Math.min(...xs)) / 2;
      if (!(ringRadius > 0)) throw new Error("cyclotron field ring has no radius");
      const outOfPage = v.B > 0;
      const arm = ringRadius / 2;
      const markerEntities = outOfPage
        ? [{ ...entity("fieldDot", "circle", "field out of the page"), label: "⊙" }]
        : [{ ...entity("fieldCrossA", "polyline", "field into the page"), label: "⊗" }, entity("fieldCrossB", "polyline", "field into the page")];
      const markerConstructions = outOfPage
        ? [construction("fieldDot", "circle", { center, radius: ringRadius * 2 / 7 }, ["fieldDot"])]
        : [
            construction("fieldCrossA", "polyline", { points: [[center.x - arm, center.y - arm], [center.x + arm, center.y + arm]] }, ["fieldCrossA"]),
            construction("fieldCrossB", "polyline", { points: [[center.x - arm, center.y + arm], [center.x + arm, center.y - arm]] }, ["fieldCrossB"]),
          ];
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { radius, ...(v.timing === 1 ? { period: 2 * Math.PI * v.m / Math.abs(v.q * v.B), frequency: Math.abs(v.q * v.B) / (2 * Math.PI * v.m) } : {}), ...(gap ? { gapEnergy: Math.abs(v.q) * v.gapVoltage } : {}) },
        entities: [
          entity("orbit", "circle", "orbit"),
          entity("dee1", "polyline", "dee"),
          entity("dee2", "polyline", "dee"),
          entity("velocity", "vector", "velocity"),
          entity("field", "polyline", "page-normal field"),
          ...markerEntities,
          ...(gap ? [named("gapField", "vector", "RF electric field at declared crossing", "Egap"), named("nextGapField", "vector", "RF field at next half-cycle", "Egap-next")] : []),
        ],
        constructions: [construction("orbit", "cyclotron", operatorInputs, ["orbit", "dee1", "dee2", "velocity", "field"]), ...markerConstructions, ...(gap ? [construction("gapField", "vector", { start: [-rfSign * 0.15, radius * 0.4 * 0.6], end: [rfSign * 0.15, radius * 0.4 * 0.6] }, ["gapField"]), construction("nextGapField", "vector", { start: [rfSign * 0.15, -radius * 0.4 * 0.6], end: [-rfSign * 0.15, -radius * 0.4 * 0.6] }, ["nextGapField"])] : [])],
      });
    },
  },
  {
    name: "mf.helix",
    family: "point_field",
    scope: "solved",
    assumptions: "Uniform signed B along world z. World trajectory (r cos(omega t),r sin(omega t),vPar t), omega=-qB/m, is projected by a single space_frame. Radius=m vPerp/|qB|, T=2pi m/|qB| and signed pitch=vPar T. vPar is signed along world +z, not necessarily along B. The adjacent circle is explicitly the xy projection, not a 3D proof.",
    topics: [{ topicId: "physics|13|helical-path-in-magnetic-field", packet: "CH-05b", chapter, remaining: "Nonuniform field and relativistic trajectories require separate source models." }],
    keys: ["m", "q", "B", "vPerp", "vPar"],
    ordinary: { m: 2, q: 1, B: 2, vPerp: 3, vPar: 4 },
    altered: { m: 2, q: 1, B: 2, vPerp: 4, vPar: 2 },
    rejections: [{ m: 2, q: 0, B: 2, vPerp: 3, vPar: 4 }, { m: 2, q: 1, B: 2, vPerp: 0, vPar: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.m, "m");
      positive(v.vPerp, "vPerp");
      if (v.q === 0 || v.B === 0) throw new Error("charge and field must be nonzero");
      const radius = v.m * v.vPerp / Math.abs(v.q * v.B);
      const period = 2 * Math.PI * v.m / Math.abs(v.q * v.B);
      const pitch = period * v.vPar;
      const omega = -v.q * v.B / v.m;
      if (![radius, period, pitch, omega].every(Number.isFinite) || radius > 1e9 || Math.abs(pitch) > 1e9) throw new Error("helix exceeds finite world authority");
      const samples = Array.from({ length: 65 }, (_, i) => {
        const t = i * period / 32;
        return { t, x: radius * Math.cos(omega * t), y: radius * Math.sin(omega * t), z: v.vPar * t };
      });
      const worldScale = 2 / Math.max(radius, Math.abs(2 * pitch), 1e-9);
      // A zero-parallel orbit revisits the same circle on the second turn;
      // preserve all source samples, but draw each geometric segment once.
      const visibleSegments = samples.slice(1, v.vPar === 0 ? 33 : undefined);
      const worldEntities = [
        { ...named("worldOrigin", "point", "projection origin", ""), provenance: { hideMark: true } },
        named("worldFrame", "polyline", "single world frame for helix", "xyz"),
        ...samples.map((_, i) => ({ ...named(`worldP${i}`, "point", "source world helix sample", ""), provenance: { hideMark: true } })),
        ...visibleSegments.map((_, i) => named(`helix${i}`, "segment", "world helix projected segment", i === 0 ? (v.vPar === 0 ? "circle (z=0)" : "helix") : "")),
      ];
      const worldConstructions = [
        construction("worldOrigin", "point", { x: -1.8, y: 0 }, ["worldOrigin"]),
        construction("worldFrame", "space_frame", { origin: "worldOrigin", scale: worldScale, axisLength: 1 / worldScale }, ["worldFrame"]),
        ...samples.map((p, i) => construction(`worldP${i}`, "space_point", { frame: "worldFrame", x: p.x, y: p.y, z: p.z }, [`worldP${i}`])),
        ...visibleSegments.map((_, i) => construction(`helix${i}`, "space_segment", { frame: "worldFrame", a: `worldP${i}`, b: `worldP${i + 1}` }, [`helix${i}`])),
      ];
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { radius, pitch },
        entities: [...worldEntities, named("projection", "circle", "xy circular projection", "xy"), named("pitch", v.vPar === 0 ? "point" : "segment", "signed pitch along z", "pitch")],
        constructions: [
          ...worldConstructions,
          construction("projection", "circle", { center: { x: 2, y: 0 }, radius: 0.7 }, ["projection"]),
          construction("pitch", v.vPar === 0 ? "space_point" : "space_segment", v.vPar === 0 ? { frame: "worldFrame", x: radius, y: 0, z: 0 } : { frame: "worldFrame", a: "worldP0", b: "worldP32" }, ["pitch"]),
        ],
      });
      return { ...document, source: { ...document.source, worldHelix: { frameId: "worldFrame", radius, period, pitch, omega, field: [0, 0, v.B], samples } } };
    },
  },
  {
    name: "mf.conductor",
    family: "point_field",
    scope: "solved",
    assumptions: "Force on a straight conductor F = I L × B. The length vector is explicit.",
    topics: [{ topicId: "physics|13|force-on-current-carrying-conductor", packet: "CH-05b", chapter, remaining: "A curved conductor is not replaced by one chord." }],
    keys: ["I", "Lx", "Ly", "Lz", "Bx", "By", "Bz"],
    ordinary: { I: 2, Lx: 3, Ly: 0, Lz: 0, Bx: 0, By: 0, Bz: 4 },
    altered: { I: 1, Lx: 3, Ly: 0, Lz: 0, Bx: 0, By: 0, Bz: 4 },
    rejections: [{ I: 2, Lx: 1, Ly: 0, Lz: 1, Bx: 0, By: 1, Bz: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      const F = {
        x: v.I * (v.Ly * v.Bz - v.Lz * v.By),
        y: v.I * (v.Lz * v.Bx - v.Lx * v.Bz),
        z: v.I * (v.Lx * v.By - v.Ly * v.Bx),
      };
      if (F.z !== 0 && (F.x !== 0 || F.y !== 0)) throw new Error("mixed planar and page-normal force is not drawn");
      const operatorInputs = {
        current: v.I, length: [v.Lx, v.Ly, v.Lz], magneticField: [v.Bx, v.By, v.Bz],
        units: { current: "A", length: "m", magneticField: "T" }, origin: [0, 0], displayLength: F.z !== 0 ? 0.18 : display,
      };
      const drawn = evaluateCurrentFieldConstruction("conductor_force", operatorInputs, numberContext);
      const actual = componentsOf(drawn[0], "currentField");
      agree(actual.y, F.y, "Fy");
      agree(actual.x, F.x, "Fx");
      agree(actual.z, F.z, "Fz");
      if (v.Lz !== 0) throw new Error("the conductor source path requires a planar length vector");
      const length = Math.hypot(v.Lx, v.Ly);
      if (!(length > 0)) throw new Error("conductor must have nonzero length");
      const source = planarMark("magnetic", { x: v.Bx, y: v.By, z: v.Bz }, "B", [1.5, 0]);
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { Fx: F.x, Fy: F.y, Fz: F.z },
        entities: [entity("force", "vector", "conductor force"), named("conductor", "polyline", "source conductor", "wire"), named("current", v.I === 0 ? "point" : "vector", "signed current along source conductor", "I"), ...source.entities],
        constructions: [construction("conductor", "polyline", { points: [[-v.Lx / length, -v.Ly / length], [v.Lx / length, v.Ly / length]] }, ["conductor"]), construction("current", v.I === 0 ? "point" : "vector", v.I === 0 ? { x: -0.5, y: -0.5 } : { start: [-0.5, -0.5], end: [-0.5 + Math.sign(v.I) * 0.6 * v.Lx / length, -0.5 + Math.sign(v.I) * 0.6 * v.Ly / length] }, ["current"]), construction("force", "conductor_force", operatorInputs, ["force"]), ...source.constructions],
      });
    },
  },
  {
    name: "mf.parallel",
    family: "point_field",
    scope: "solved",
    assumptions: "Two parallel wires. Force per unit length is mu0 I1 I2 / (2 pi d). Same-sign currents attract. mu0 is explicit.",
    topics: [{ topicId: "physics|13|force-between-parallel-conductors", packet: "CH-05b", chapter, remaining: "Non-parallel wires are unsupported." }],
    keys: ["mu0", "I1", "I2", "d", "length"],
    ordinary: { mu0: 2 * Math.PI, I1: 3, I2: 4, d: 3, length: 2 },
    altered: { mu0: 2 * Math.PI, I1: 3, I2: -4, d: 3, length: 2 },
    rejections: [{ mu0: 2 * Math.PI, I1: 3, I2: 4, d: 0, length: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.mu0, "mu0");
      positive(v.d, "d");
      positive(v.length, "length");
      const perLength = v.mu0 * v.I1 * v.I2 / (2 * Math.PI * v.d);
      const operatorInputs = {
        currents: [v.I1, v.I2], separation: v.d, mu0: v.mu0, length: v.length,
        units: { current: "A", length: "m", mu0: "N/A^2" }, origin: [0, 0], displayScale: 0.4, forceScale: 0.2,
      };
      const drawn = evaluateCurrentFieldConstruction("parallel_wire_force", operatorInputs, numberContext);
      if (drawn.length !== 4) throw new Error("parallel wires must draw two wires and two forces");
      const firstForce = componentsOf(drawn[2], "currentField"), secondForce = componentsOf(drawn[3], "currentField");
      agree(firstForce.x, perLength, "signed first-wire force per length");
      agree(secondForce.x, -firstForce.x, "reciprocal second-wire force per length");
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { perLength, attract: v.I1 * v.I2 >= 0 ? 1 : 0 },
        entities: [entity("w1", "polyline", "wire"), entity("w2", "polyline", "wire"), entity("f1", "vector", "force"), entity("f2", "vector", "force"), ...[v.I1, v.I2].map((I, i) => named(`current${i + 1}`, I === 0 ? "point" : "vector", "signed source wire current", `I${i + 1}`))],
        constructions: [construction("wires", "parallel_wire_force", operatorInputs, ["w1", "w2", "f1", "f2"]), ...[v.I1, v.I2].map((I, i) => construction(`current${i + 1}`, I === 0 ? "point" : "vector", I === 0 ? { x: (i === 0 ? -1 : 1) * v.d * 0.2, y: 0 } : { start: [(i === 0 ? -1 : 1) * v.d * 0.2, -0.2], end: [(i === 0 ? -1 : 1) * v.d * 0.2, -0.2 + Math.sign(I) * Math.min(0.5, v.length * 0.4)] }, [`current${i + 1}`]))],
      });
      return { ...document, source: { ...document.source, parallelForces: [firstForce, secondForce] } };
    },
  },
  {
    name: "mf.ampere",
    family: "circuit_network",
    scope: "text_only",
    assumptions: "Historical (1948) force-based ampere: two straight parallel infinite conductors of negligible circular cross-section, one metre apart in vacuum, carry equal constant current and exert 2e-7 N/m. Contemporary SI (in force since 2019) fixes elementary charge e=1.602176634e-19 C exactly, with C=A s. Definition recall is text-only; current SI does not define the ampere by an exact wire-force value.",
    topics: [{ topicId: "physics|13|definition-of-ampere", packet: "CH-05b", chapter, remaining: "No diagram is declared for the definition. The parallel-wire scene is a different row." }],
    keys: ["stated"],
    ordinary: { stated: 1 },
    altered: { stated: 1 },
    rejections: [{ stated: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["currentSI"]);
      if (v.stated !== 1) throw new Error("the ampere definition is text only");
      if (v.currentSI !== undefined && v.currentSI !== 1) throw new Error("currentSI must be explicitly 1");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        // Definition recall is text authority, not a solved numeric request.
        // The exact constants remain in the source-owned prose below.
        certified: {},
      });
    },
  },
  {
    name: "mf.loop_torque",
    family: "point_field",
    scope: "solved",
    assumptions: "Planar N-turn loop, tau=NI(A cross B), with source area vector in m^2. N defaults to one. The world-frame square is explicitly an area-equivalent schematic, not an inferred source shape. Arbitrary 3D normal and field directions retain their source components independently of display lengths.",
    topics: [{ topicId: "physics|13|torque-on-current-loop", packet: "CH-05b", chapter, remaining: "A non-planar winding is unsupported." }],
    keys: ["I", "Ax", "Ay", "Az", "Bx", "By", "Bz"],
    ordinary: { I: 2, Ax: 0, Ay: 0, Az: 3, Bx: 0, By: 4, Bz: 0 },
    altered: { I: 1, Ax: 0, Ay: 0, Az: 3, Bx: 0, By: 4, Bz: 0 },
    rejections: [{ I: 2, Ax: 0, Ay: 0, Az: 0, Bx: 0, By: 1, Bz: 1 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["N"]);
      const N = v.N ?? 1;
      if (!(N > 0) || !Number.isInteger(N)) throw new Error("N must be a positive integer");
      const tau = {
        x: N * v.I * (v.Ay * v.Bz - v.Az * v.By),
        y: N * v.I * (v.Az * v.Bx - v.Ax * v.Bz),
        z: N * v.I * (v.Ax * v.By - v.Ay * v.Bx),
      };
      const mixed = tau.z !== 0 && (tau.x !== 0 || tau.y !== 0);
      const operatorInputs = { current: N * v.I, area: [v.Ax, v.Ay, v.Az], magneticField: [v.Bx, v.By, v.Bz], displayLength: display, origin: [2.4, 0] };
      if (!mixed) {
        const drawn = evaluateChapterRemainderConstruction("loop_torque", operatorInputs, numberContext);
        const actual = componentsOf(drawn[0], "remainder");
        agree(actual.x, tau.x, "taux");
        agree(actual.y, tau.y, "tauy");
        agree(actual.z, tau.z, "tauz");
      }
      const loop = areaEquivalentLoop([v.Ax, v.Ay, v.Az]);
      const directions = worldDirections([{ id: "moment", label: "m", value: [N * v.I * v.Ax, N * v.I * v.Ay, N * v.I * v.Az] }, { id: "magnetic", label: "B", value: [v.Bx, v.By, v.Bz] }, { id: "worldTorque", label: "tau", value: [tau.x, tau.y, tau.z] }]);
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { taux: tau.x, tauy: tau.y, tauz: tau.z, tau: Math.hypot(tau.x, tau.y, tau.z) },
        entities: [...loop.entities, ...directions.entities, ...(mixed ? [] : [entity("torque", "vector", "loop torque")])],
        constructions: [...loop.constructions, ...directions.constructions, ...(mixed ? [] : [construction("torque", "loop_torque", operatorInputs, ["torque"])])],
      });
      return { ...document, source: { ...document.source, physicalVectors: directions.source, worldLoop: loop.source } };
    },
  },
  {
    name: "mf.dipole_moment",
    family: "point_field",
    scope: "solved",
    assumptions: "Planar current-loop moment m=NIA n in A m^2. N defaults to one; optional nx,ny,nz must together specify a unit world normal. Current reversal reverses the moment. The world loop is an area-equivalent schematic, not an inferred actual source shape.",
    topics: [{ topicId: "physics|13|current-loop-as-magnetic-dipole", packet: "CH-05b", chapter, remaining: "A nonplanar loop moment is unsupported." }],
    keys: ["I", "A"],
    ordinary: { I: 2, A: 5 },
    altered: { I: 3, A: 4 },
    rejections: [{ I: 2, A: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["N", "nx", "ny", "nz"]);
      positive(v.A, "A");
      const N = v.N ?? 1;
      if (!(N > 0) || !Number.isInteger(N)) throw new Error("N must be a positive integer");
      const oriented = together(v, ["nx", "ny", "nz"]);
      const n = oriented ? [v.nx, v.ny, v.nz] : [0, 1, 0];
      if (Math.abs(Math.hypot(...n) - 1) > 1e-8) throw new Error("area normal must be a unit world vector");
      const m = N * v.I * v.A;
      const loop = areaEquivalentLoop(n.map((x) => x * v.A));
      const world = oriented ? worldDirections([{ id: "moment", label: "m", value: n.map((x) => x * m) }]) : { entities: [], constructions: [], source: [] };
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { m, ...(oriented ? { mx: m * n[0], my: m * n[1], mz: m * n[2] } : {}) },
        entities: [...loop.entities, ...world.entities, ...(oriented ? [] : [entity("loop", "circle", "current loop projection"), named("moment", m === 0 ? "point" : "vector", "moment", "m")])],
        constructions: [
          ...loop.constructions, ...world.constructions,
          ...(oriented ? [] : [construction("loop", "circle", { center: { x: 1, y: 0 }, radius: 0.7 }, ["loop"]), construction("moment", m === 0 ? "point" : "vector", m === 0 ? { x: 1, y: 0 } : { start: [1, 0], end: [1, Math.sign(m) * 1.2] }, ["moment"])]),
        ],
      });
      return { ...document, source: { ...document.source, physicalVectors: world.source, worldLoop: loop.source } };
    },
  },
  {
    name: "mf.revolving",
    family: "point_field",
    scope: "solved",
    assumptions: "Circular revolving charge: direction=±1 (default +1) declares CCW/CW in the xy plane. I=direction*q/T and moment=q*direction*v*r/2. Optional period must agree with v=2pi r/T. Optional positive mass declares the classical particle model L=direction*mass*v*r, giving m=qL/(2mass). Charge motion and conventional current remain distinct.",
    topics: [{ topicId: "physics|13|magnetic-moment-of-a-revolving-charge", packet: "CH-05b", chapter, remaining: "Classical angular momentum is supported only with explicit particle mass; a quantum orbital model is not inferred." }],
    keys: ["q", "v", "r"],
    ordinary: { q: 2, v: 3, r: 4 },
    altered: { q: 2, v: 4, r: 4 },
    rejections: [{ q: 2, v: 3, r: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["period", "direction", "mass"]);
      positive(v.r, "r");
      if (v.v < 0) throw new Error("speed must be nonnegative");
      const direction = v.direction ?? 1;
      if (direction !== 1 && direction !== -1) throw new Error("orbit direction must be +1 or -1");
      if (v.period !== undefined) {
        positive(v.period, "period");
        if (Math.abs(v.v - 2 * Math.PI * v.r / v.period) > 1e-9 * Math.max(v.v, 2 * Math.PI * v.r / v.period)) throw new Error("supplied speed, radius and period disagree");
      }
      if (v.mass !== undefined) positive(v.mass, "mass");
      const m = direction * v.q * v.v * v.r / 2;
      const moment = m === 0 ? planarMark("moment", { x: 0, y: 0, z: 0 }, "m", [-1.6, 0]) : pageField("moment", m, -1.6, 0);
      moment.entities[0].label = "m";
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { m, ...(v.period !== undefined ? { I: direction * v.q / v.period } : {}), ...(v.mass !== undefined ? { L: direction * v.mass * v.v * v.r } : {}) },
        entities: [entity("orbit", "circle", "orbit"), named("charge", "point", "source charge", v.q < 0 ? "q-" : "q+"), ...moment.entities, named("velocity", v.v === 0 ? "point" : "vector", "charge motion direction", "v"), named("current", v.q * v.v === 0 ? "point" : "vector", "conventional current direction", "I")],
        constructions: [
          construction("orbit", "circle", { center: { x: 0, y: 0 }, radius: 1.2 }, ["orbit"]),
          construction("charge", "point", { x: 1.2, y: 0 }, ["charge"]),
          ...moment.constructions,
          construction("velocity", v.v === 0 ? "point" : "vector", v.v === 0 ? { x: 1.2, y: 0 } : { start: [1.2, 0], end: [1.2, direction * 0.65] }, ["velocity"]),
          construction("current", v.q * v.v === 0 ? "point" : "vector", v.q * v.v === 0 ? { x: 0, y: 1.2 } : { start: [0, 1.2], end: [-direction * Math.sign(v.q) * 0.65, 1.2] }, ["current"]),
        ],
      });
    },
  },
  {
    name: "mf.galvanometer",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Linear radial-field moving-coil galvanometer with explicit torsion constant k in N m/rad. Deflection=NBAI/k stays within a right angle. Optional positive G (ohm) requests current sensitivity NBA/k (rad/A) and voltage sensitivity NBA/(kG) (rad/V). Pole, core and spring outlines are apparatus schematics, not measured dimensions.",
    topics: [{ topicId: "physics|13|moving-coil-galvanometer", packet: "CH-05c", chapter, remaining: "A deflection past a right angle is rejected." }],
    keys: ["N", "I", "A", "B", "k"],
    ordinary: { N: 10, I: 0.01, A: 2, B: 1, k: 1 },
    altered: { N: 10, I: 0.02, A: 2, B: 1, k: 1 },
    rejections: [{ N: 100, I: 1, A: 1, B: 1, k: 1 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["G"]);
      positive(v.N, "N");
      positive(v.A, "A");
      positive(v.B, "B");
      positive(v.k, "k");
      if (v.G !== undefined) positive(v.G, "G");
      if (!Number.isInteger(v.N)) throw new Error("turns must be an integer");
      const theta = v.N * v.I * v.A * v.B / v.k;
      if (Math.abs(theta) > Math.PI / 2) throw new Error("deflection exceeds a right angle");
      const operatorInputs = { current: v.I, turns: v.N, area: v.A, field: v.B, springConstant: v.k, displayScale: 1 };
      const drawn = evaluateChapterRemainderConstruction("galvanometer", operatorInputs, numberContext);
      agree(componentsOf(drawn[1], "remainder").x, theta, "theta");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { theta, ...(v.G !== undefined ? { currentSensitivity: v.N * v.A * v.B / v.k, voltageSensitivity: v.N * v.A * v.B / (v.k * v.G) } : {}) },
        entities: [entity("coil", "circle", "coil"), entity("needle", "vector", "needle"), named("spring", "polyline", "torsion spring", "k"), named("core", "circle", "soft iron core", "core"), named("northPole", "polygon", "radial-field north pole", "N"), named("southPole", "polygon", "radial-field south pole", "S"), named("radialField", "vector", "radial magnetic field at coil side", "B")],
        constructions: [construction("meter", "galvanometer", operatorInputs, ["coil", "needle"]), construction("core", "circle", { center: [0, 0], radius: 0.4 }, ["core"]), construction("spring", "polyline", { points: [[0, 1], [0, 1.2], [-0.15, 1.3], [0.15, 1.4], [-0.15, 1.5], [0.15, 1.6], [0, 1.7], [0, 1.9]] }, ["spring"]), construction("northPole", "rectangle", { center: [-1.5, 0], width: 0.55, height: 1.6 }, ["northPole"]), construction("southPole", "rectangle", { center: [1.5, 0], width: 0.55, height: 1.6 }, ["southPole"]), construction("radialField", "vector", { start: [-1.2, 0], end: [-0.7, 0] }, ["radialField"])],
      });
    },
  },
  {
    name: "mf.shunt",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Ammeter shunt S = G Ig / (I - Ig), with I > Ig. The galvanometer and shunt are in parallel.",
    topics: [{ topicId: "physics|13|galvanometer-to-ammeter-and-voltmeter", packet: "CH-05c", chapter, remaining: "The series voltmeter resistor is mf.voltmeter." }],
    keys: ["G", "Ig", "I"],
    ordinary: { G: 100, Ig: 0.001, I: 0.011 },
    altered: { G: 100, Ig: 0.001, I: 0.021 },
    rejections: [{ G: 100, Ig: 0.01, I: 0.01 }, { G: 0, Ig: 0.001, I: 0.011 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.G, "G");
      positive(v.Ig, "Ig");
      if (!(v.I > v.Ig)) throw new Error("ammeter range must exceed the galvanometer current");
      const S = v.G * v.Ig / (v.I - v.Ig);
      const net = conversionNetwork("ammeter", v.G, S, v.Ig, v.I);
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { S: v.G * v.Ig / (v.I - v.Ig) },
        entities: net.entities, constructions: net.constructions,
      });
      return { ...document, source: { ...document.source, conversionTopology: net.source } };
    },
  },
  {
    name: "mf.voltmeter",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Voltmeter series resistor R = V / Ig - G. The range voltage and galvanometer current are explicit.",
    topics: [{ topicId: "physics|13|galvanometer-to-ammeter-and-voltmeter", packet: "CH-05c", chapter, remaining: "The parallel ammeter shunt is mf.shunt." }],
    keys: ["V", "Ig", "G"],
    ordinary: { V: 2, Ig: 0.001, G: 100 },
    altered: { V: 3, Ig: 0.001, G: 100 },
    rejections: [{ V: 0.05, Ig: 0.001, G: 100 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.V, "V");
      positive(v.Ig, "Ig");
      positive(v.G, "G");
      const R = v.V / v.Ig - v.G;
      if (!(R > 0)) throw new Error("the series resistor is not positive for this range");
      const net = conversionNetwork("voltmeter", v.G, R, v.Ig, v.V);
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { R },
        entities: net.entities, constructions: net.constructions,
      });
      return { ...document, source: { ...document.source, conversionTopology: net.source } };
    },
  },
  {
    name: "mf.dipole_torque",
    family: "point_field",
    scope: "solved",
    assumptions: "Supplied magnetic moment in A m^2, independent of any assumed current loop: tau=m cross B in N m. Optional energy=1 requests U=-m dot B, with the conventional zero at perpendicular orientation. Arbitrary world directions are projected in one frame; display lengths do not certify physical magnitudes.",
    topics: [{ topicId: "physics|13|torque-on-magnetic-dipole", packet: "CH-05c", chapter, remaining: "Nonuniform-field force needs a supplied spatial gradient; uniform-field torque does not invent it." }],
    keys: ["mx", "my", "mz", "Bx", "By", "Bz"],
    ordinary: { mx: 0, my: 0, mz: 3, Bx: 0, By: 4, Bz: 0 },
    altered: { mx: 0, my: 0, mz: 2, Bx: 0, By: 4, Bz: 0 },
    rejections: [{ mx: 0, my: 0, mz: 0, Bx: 0, By: 1, Bz: 1 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["energy"]);
      if (Math.hypot(v.mx, v.my, v.mz) === 0) throw new Error("dipole moment must be nonzero");
      if (v.energy !== undefined && v.energy !== 1) throw new Error("energy must be explicitly 1");
      const tau = {
        x: v.my * v.Bz - v.mz * v.By,
        y: v.mz * v.Bx - v.mx * v.Bz,
        z: v.mx * v.By - v.my * v.Bx,
      };
      const world = worldDirections([{ id: "moment", label: "m", value: [v.mx, v.my, v.mz] }, { id: "magnetic", label: "B", value: [v.Bx, v.By, v.Bz] }, { id: "worldTorque", label: "tau", value: [tau.x, tau.y, tau.z] }]);
      const mixed = tau.z !== 0 && (tau.x !== 0 || tau.y !== 0);
      const operatorInputs = { current: 1, area: [v.mx, v.my, v.mz], magneticField: [v.Bx, v.By, v.Bz], displayLength: display };
      if (!mixed) {
        const drawn = evaluateChapterRemainderConstruction("loop_torque", operatorInputs, numberContext);
        agree(componentsOf(drawn[0], "remainder").x, tau.x, "taux");
      }
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { taux: tau.x, tauy: tau.y, tauz: tau.z, ...(v.energy === 1 ? { U: -(v.mx * v.Bx + v.my * v.By + v.mz * v.Bz) } : {}) },
        entities: [...world.entities, ...(mixed ? [] : [entity("torque", "vector", "dipole torque")])],
        constructions: [...world.constructions, ...(mixed ? [] : [construction("torque", "loop_torque", { ...operatorInputs, origin: [2.3, 0] }, ["torque"])])],
      });
      return { ...document, source: { ...document.source, physicalVectors: world.source } };
    },
  },
];
