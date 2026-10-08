import { evaluateChapterRemainderConstruction } from "../../compile/chapterRemainderGeometry";
import { evaluateCurrentFieldConstruction } from "../../compile/currentFieldGeometry";
import { agree, construction, entity, finiteInputs, numberContext, positive, sceneDocument, type EmModel } from "./sceneKit";

function declared(inputs: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): Record<string, number> {
  const values = finiteInputs(inputs, [...required, ...optional.filter((key) => key in inputs)]);
  return values;
}

function paired(v: Record<string, number>, keys: readonly string[]): boolean {
  const count = keys.filter((key) => key in v).length;
  if (count !== 0 && count !== keys.length) throw new Error(`${keys.join(", ")} must be declared together`);
  return count > 0;
}

function trace(id: string, role: string, label: string, points: number[][]) {
  return { mark: labeled(id, "polyline", role, label), build: construction(id, "polyline", { points }, [id]) };
}

function amperianScene(model: EmModel, v: Record<string, number>) {
  positive(v.d, "path radius d");
  const exterior = paired(v, ["externalI", "externalRadius"]);
  if (exterior && !(v.externalRadius > v.d)) throw new Error("the declared exterior source must lie outside the circular path");
  if (v.start !== undefined || v.end !== undefined || v.atX !== undefined) throw new Error("the circular Ampere model requires axial infinite wires, not finite planar endpoints");
  const scale = 2 / (exterior ? v.externalRadius : 2 * v.d);
  const radius = v.d * scale;
  const B = v.mu0 / (2 * Math.PI) * (v.I / v.d - (exterior ? v.externalI / (v.externalRadius - v.d) : 0));
  const currents = [{ id: "enclosedCurrent", value: v.I, at: 0 }, ...(exterior ? [{ id: "externalCurrent", value: v.externalI, at: v.externalRadius * scale }] : [])];
  const entities = [labeled("amperianPath", "circle", "oriented circular Amperian path", "C"), labeled("pathDirection", "vector", "positive counterclockwise path orientation", "dl"), labeled("field", B === 0 ? "point" : "vector", "local tangent field at P", "B")];
  const constructions = [construction("amperianPath", "circle", { center: [0, 0], radius }, ["amperianPath"]), construction("pathDirection", "vector", { start: [0, radius], end: [-0.3, radius] }, ["pathDirection"]), construction("field", B === 0 ? "point" : "vector", B === 0 ? { x: radius, y: 0 } : { start: [radius, 0], end: [radius, Math.sign(B) * 0.6] }, ["field"])];
  for (const { id, value, at } of currents) {
    entities.push(labeled(id, "circle", "signed axial source current", id === "enclosedCurrent" ? "I-in" : "I-out"));
    constructions.push(construction(id, "circle", { center: [at, 0], radius: 0.12 }, [id]));
    if (value > 0) {
      entities.push(labeled(`${id}dot`, "circle", "current out of page", ""));
      constructions.push(construction(`${id}dot`, "circle", { center: [at, 0], radius: 0.025 }, [`${id}dot`]));
    } else if (value < 0) {
      for (const sign of [-1, 1]) {
        const crossId = `${id}cross${sign === 1 ? "A" : "B"}`;
        entities.push(labeled(crossId, "polyline", "current into page", ""));
        constructions.push(construction(crossId, "polyline", { points: [[at - 0.07, -sign * 0.07], [at + 0.07, sign * 0.07]] }, [crossId]));
      }
    }
  }
  return sceneDocument({ model: model.name, family: model.family, scope: model.scope, assumptions: "Axial infinite-wire sources, positive counterclockwise circular path. Circulation is mu0 I-in. An exterior current changes local B but contributes zero enclosed current; B is not assumed uniform along that path.", certified: { B, circulation: v.mu0 * v.I }, entities, constructions });
}

const chapter = "Magnetic Effects of Current and Magnetism";
const display = 1.2;
const elementUnits = { current: "A", length: "m", mu0: "N/A^2" };
const solenoidUnits = { turnsPerLength: "1/m", current: "A", mu0: "N/A^2" };
const dipoleUnits = { moment: "A m^2", length: "m", mu0: "N/A^2" };

function fieldMark(value: unknown): { x: number; y: number; z: number } {
  if (typeof value === "object" && value !== null && "currentField" in value) {
    return (value as { currentField: { components: { x: number; y: number; z: number } } }).currentField.components;
  }
  throw new Error("magnetic field metadata is missing");
}

function labeled(id: string, kind: string, role: string, label: string) {
  return { ...entity(id, kind, role), label };
}

/** Face half-length of the bar-magnet operator, in scene units. */
const MAGNET_FACE = 0.7;

/**
 * Regression lock for the bar-magnet repair: every field line must span the
 * two faces at MAGNET_FACE along the moment axis. The pre-repair operator
 * drew point-dipole lobes whose endpoints met at the origin; that regression
 * must fail the build, never render.
 */
function lockBarMagnetGeometry(moment: [number, number], drawn: ReturnType<typeof evaluateChapterRemainderConstruction>): void {
  const [barMark, ...fieldLines] = drawn;
  if (!barMark || barMark.kind !== "path" || !barMark.closed) throw new Error("the magnet bar must be a closed path");
  const length = Math.hypot(moment[0], moment[1]);
  const axis = { x: moment[0] / length, y: moment[1] / length };
  const starts = fieldLines.map((line) => line.kind === "path" ? line.points[0] : undefined);
  if (new Set(starts.map((point) => point ? `${point.x.toFixed(4)},${point.y.toFixed(4)}` : "")).size < 2) {
    throw new Error("field lines must leave different points on the north face");
  }
  for (const line of fieldLines) {
    if (line.kind !== "path") throw new Error("a field line must be a path");
    const start = line.points[0];
    const end = line.points.at(-1);
    const next = line.points[1];
    if (!start || !end || !next) throw new Error("a field line has no endpoints");
    const startAlong = start.x * axis.x + start.y * axis.y;
    const endAlong = end.x * axis.x + end.y * axis.y;
    if (Math.abs(startAlong - MAGNET_FACE) > 0.02) throw new Error("a field line must leave the north face");
    if (Math.abs(endAlong + MAGNET_FACE) > 0.02) throw new Error("a field line must enter the south face");
    if ((next.x - start.x) * axis.x + (next.y - start.y) * axis.y <= 0) throw new Error("a field line must leave the north face outward");
    for (const point of line.points.slice(1, -1)) {
      const along = point.x * axis.x + point.y * axis.y;
      const across = Math.abs(point.x * axis.y - point.y * axis.x);
      if (Math.abs(along) < MAGNET_FACE - 0.02 && across < 0.18) throw new Error("a field line crosses the bar");
    }
  }
}

export const magneticSourceModels: EmModel[] = [
  {
    name: "mf.wire",
    family: "point_field",
    scope: "solved",
    assumptions: "Infinite straight wire unless both finite start/end coordinates are supplied. d is signed transverse distance and atX the axial coordinate. Optional amperian=1 selects axial infinite source currents with a circular path of radius d; optional exterior current changes local field but not circulation. mu0 is explicit; source coincidences reject.",
    topics: [
      { topicId: "physics|13|field-due-to-a-straight-wire", packet: "CH-05a", chapter, remaining: "Finite endpoints and signed observation are supported; curved wire paths require a separately supplied source model." },
      { topicId: "physics|13|amperes-law", packet: "CH-05a", chapter, remaining: "Ampere's law here is the infinite-wire application. A non-symmetric Amperian loop is unsupported." },
    ],
    keys: ["mu0", "I", "d"],
    ordinary: { mu0: 2 * Math.PI, I: 3, d: 3 },
    altered: { mu0: 2 * Math.PI, I: 6, d: 3 },
    rejections: [{ mu0: 2 * Math.PI, I: 3, d: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["start", "end", "atX", "amperian", "externalI", "externalRadius"]);
      positive(v.mu0, "mu0");
      if (v.amperian !== undefined && v.amperian !== 1) throw new Error("amperian must be explicitly 1");
      if (v.amperian === 1) return amperianScene(this, v);
      if (v.externalI !== undefined || v.externalRadius !== undefined) throw new Error("exterior currents require a declared circular Amperian path");
      if (v.d === 0) throw new Error("observation lies on the wire");
      const finite = paired(v, ["start", "end"]);
      const atX = v.atX ?? 0;
      if (finite && !(v.end > v.start)) throw new Error("finite endpoints require start < end");
      const factor = finite
        ? (v.end - atX) / Math.hypot(v.end - atX, v.d) - (v.start - atX) / Math.hypot(v.start - atX, v.d)
        : 2;
      const B = v.mu0 * v.I * factor / (4 * Math.PI * v.d);
      const scale = 1.5 / Math.max(Math.abs(v.d), finite ? Math.abs(v.start - atX) : 0, finite ? Math.abs(v.end - atX) : 0);
      const operatorInputs = {
        shape: finite ? "finite_wire" : "infinite_wire", current: v.I, mu0: v.mu0, units: elementUnits, displayLength: 0.18,
        origin: [0, v.d * scale], ...(finite ? { start: [v.start, 0], end: [v.end, 0] } : { through: [0, 0], direction: [1, 0] }), at: [atX, v.d],
      };
      const drawn = evaluateCurrentFieldConstruction("current_element_field", operatorInputs, numberContext);
      agree(fieldMark(drawn[0]).z, B, "Bz");
      const mid = finite ? ((v.start + v.end) / 2 - atX) * scale : 0;
      const currentLength = finite ? Math.min(0.45, (v.end - v.start) * scale / 4) : 0.45;
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B },
        entities: [entity("field", "vector", "wire field"), labeled("wire", "polyline", finite ? "finite source conductor" : "infinite source conductor", finite ? "finite wire" : "infinite wire"), labeled("observation", "point", "observation point", "P"), labeled("current", v.I === 0 ? "point" : "vector", "signed source conductor current", "I")],
        constructions: [
          construction("wire", "polyline", { points: finite ? [[(v.start - atX) * scale, 0], [(v.end - atX) * scale, 0]] : [[-1.5, 0], [1.5, 0]] }, ["wire"]),
          construction("observation", "point", { x: 0, y: v.d * scale }, ["observation"]),
          construction("current", v.I === 0 ? "point" : "vector", v.I === 0 ? { x: mid, y: 0 } : { start: [mid, 0], end: [mid + Math.sign(v.I) * currentLength, 0] }, ["current"]),
          construction("field", "current_element_field", operatorInputs, ["field"]),
        ],
      });
    },
  },
  {
    name: "mf.arc",
    family: "point_field",
    scope: "solved",
    assumptions: "Circular arc at its centre. Angles are radians; signed delta is at most one turn. Explicit startLead/endLead are endpoint radii on the arc's radial lines and contribute zero at the centre. Display scale is not a length measurement.",
    topics: [{ topicId: "physics|13|field-at-the-centre-of-an-arc", packet: "CH-05a", chapter, remaining: "Nonradial leads require independently supplied source geometry." }],
    keys: ["mu0", "I", "delta", "R"],
    ordinary: { mu0: 4 * Math.PI, I: 2, delta: Math.PI / 2, R: 1 },
    altered: { mu0: 4 * Math.PI, I: 2, delta: Math.PI, R: 1 },
    rejections: [{ mu0: 4 * Math.PI, I: 2, delta: Math.PI / 2, R: 0 }, { mu0: 4 * Math.PI, I: 2, delta: 0, R: 1 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["startAngle", "startLead", "endLead"]);
      positive(v.mu0, "mu0");
      positive(v.R, "R");
      if (v.delta === 0 || Math.abs(v.delta) > 2 * Math.PI) throw new Error("arc angle must be a nonzero turn of at most one revolution");
      const startAngle = v.startAngle ?? 0;
      const radial = paired(v, ["startLead", "endLead"]);
      if (radial && [v.startLead, v.endLead].some((r) => !(r > 0) || r === v.R)) throw new Error("radial leads require positive distinct endpoint radii away from the observation centre");
      if (radial && Math.abs(v.delta) === 2 * Math.PI) throw new Error("a closed full loop has no open radial endpoints");
      const B = v.mu0 * v.I * v.delta / (4 * Math.PI * v.R);
      const operatorInputs = {
        shape: "arc", current: v.I, mu0: v.mu0, units: elementUnits, displayLength: 0.18,
        origin: [0, 0], radius: v.R, startAngle, endAngle: startAngle + v.delta,
      };
      const drawn = evaluateCurrentFieldConstruction("current_element_field", operatorInputs, numberContext);
      agree(fieldMark(drawn[0]).z, B, "Bz");
      const scale = 1.6 / Math.max(v.R, radial ? v.startLead : 0, radial ? v.endLead : 0);
      const onRay = (radius: number, angle: number) => [radius * scale * Math.cos(angle), radius * scale * Math.sin(angle)];
      const arc = trace("arc", "source circular arc", "arc", Array.from({ length: 65 }, (_, i) => onRay(v.R, startAngle + v.delta * i / 64)));
      const leads = radial ? [
        trace("startLead", "connected radial lead", "radial lead", [onRay(v.startLead, startAngle), onRay(v.R, startAngle)]),
        trace("endLead", "connected radial lead", "radial lead", [onRay(v.R, startAngle + v.delta), onRay(v.endLead, startAngle + v.delta)]),
      ] : [];
      const middle = startAngle + v.delta / 2;
      const sense = Math.sign(v.I * v.delta);
      const tip = onRay(v.R, middle);
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B },
        entities: [entity("field", "vector", "arc field"), arc.mark, ...leads.map((l) => l.mark), labeled("current", "vector", "signed arc current", "I")],
        constructions: [arc.build, ...leads.map((l) => l.build), construction("current", sense === 0 ? "point" : "vector", sense === 0 ? { x: tip[0], y: tip[1] } : { start: tip, end: [tip[0] - sense * 0.4 * Math.sin(middle), tip[1] + sense * 0.4 * Math.cos(middle)] }, ["current"]), construction("field", "current_element_field", operatorInputs, ["field"])],
      });
    },
  },
  {
    name: "mf.loop",
    family: "point_field",
    scope: "solved",
    assumptions: "Circular coil axial field B = mu0 N I R^2/[2(R^2+x^2)^(3/2)]. N defaults to one turn; axisAngle is in radians. The explicit world normal lies in xy; the front point is world +z. A declared linear projection maps z toward the axis, so positive current at the front follows normal cross +z. Source radius and axial coordinate, not displayed ellipse area, determine the field.",
    topics: [{ topicId: "physics|13|biot-savart-law", packet: "CH-05a", chapter, remaining: "A non-circular loop is not given the circular-loop formula." }],
    keys: ["mu0", "I", "R", "x"],
    ordinary: { mu0: 2 * Math.PI, I: 2, R: Math.PI, x: 0 },
    altered: { mu0: 2 * Math.PI, I: 2, R: Math.PI, x: Math.PI },
    rejections: [{ mu0: 2 * Math.PI, I: 2, R: 0, x: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["N", "axisAngle"]);
      positive(v.mu0, "mu0");
      positive(v.R, "R");
      const N = v.N ?? 1;
      if (!(N > 0) || !Number.isInteger(N)) throw new Error("N must be a positive integer");
      const angle = v.axisAngle ?? 0;
      const axis = [Math.cos(angle), Math.sin(angle)];
      const scale = 1.5 / Math.max(v.R, Math.abs(v.x));
      const strength = v.mu0 * N * v.I * v.R * v.R / (2 * (v.R * v.R + v.x * v.x) ** 1.5);
      const operatorInputs = {
        shape: "loop_axis", current: N * v.I, mu0: v.mu0, units: elementUnits, displayLength: display,
        origin: [axis[0] * v.x * scale, axis[1] * v.x * scale], radius: v.R, distance: v.x, axis,
      };
      const drawn = evaluateCurrentFieldConstruction("current_element_field", operatorInputs, numberContext);
      agree(fieldMark(drawn[0]).x, axis[0] * strength, "Bx");
      agree(fieldMark(drawn[0]).y, axis[1] * strength, "By");
      const project = (a: number, b: number) => [axis[0] * a - axis[1] * b, axis[1] * a + axis[0] * b];
      const samples = Array.from({ length: 65 }, (_, i) => {
        const t = 2 * Math.PI * i / 64;
        return [axis[1] * v.R * Math.sin(t), -axis[0] * v.R * Math.sin(t), v.R * Math.cos(t)];
      });
      const projection = [[scale, 0, 0.25 * axis[0] * scale], [0, scale, 0.25 * axis[1] * scale]];
      const loop = trace("loop", "projected source circular coil", "coil", samples.map((p) => projection.map((row) => row.reduce((sum, value, i) => sum + value * p[i], 0))));
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B: strength },
        entities: [entity("field", "vector", "loop-axis field"), loop.mark, labeled("axis", "polyline", "coil axis", "axis"), labeled("observation", "point", "axial observation", "P"), labeled("current", "vector", "signed coil current", "I")],
        constructions: [loop.build, construction("axis", "polyline", { points: [project(-1.8, 0), project(1.8, 0)] }, ["axis"]), construction("observation", "point", { x: axis[0] * v.x * scale, y: axis[1] * v.x * scale }, ["observation"]), construction("current", v.I === 0 ? "point" : "vector", v.I === 0 ? { x: 0, y: 0 } : { start: project(0.25 * v.R * scale, 0), end: project(0.25 * v.R * scale, -Math.sign(v.I) * 0.45) }, ["current"]), construction("field", "current_element_field", operatorInputs, ["field"])],
      });
      return { ...document, source: { ...document.source, worldCircularCoil: { normal: [...axis, 0], samples, projection, radius: v.R, axialObservation: [...axis.map((a) => a * v.x), 0], current: v.I, turns: N } } };
    },
  },
  {
    name: "mf.solenoid",
    family: "point_field",
    scope: "solved",
    assumptions: "Ideal long solenoid: interior=1 gives mu0 n I, exterior=0 gives zero, interior=2 declares the semi-infinite axial end limit mu0 n I/2. n and mu0 are explicit. The winding is schematic and cannot certify a short-solenoid end correction.",
    topics: [{ topicId: "physics|13|field-due-to-solenoid-and-toroid", packet: "CH-05a", chapter, remaining: "Finite short-solenoid corrections require dimensions; mixed J/N toroid scope needs editorial review." }],
    keys: ["mu0", "n", "I", "interior"],
    ordinary: { mu0: 2, n: 3, I: 4, interior: 1 },
    altered: { mu0: 2, n: 3, I: 4, interior: 0 },
    rejections: [{ mu0: 2, n: 0, I: 4, interior: 1 }, { mu0: 0, n: 3, I: 4, interior: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.mu0, "mu0");
      positive(v.n, "n");
      if (![0, 1, 2].includes(v.interior)) throw new Error("interior must be 0 (exterior), 1 (interior), or 2 (semi-infinite end)");
      const B = v.interior === 0 ? 0 : v.mu0 * v.n * v.I / (v.interior === 2 ? 2 : 1);
      const operatorInputs = {
        turnsPerLength: v.n / (v.interior === 2 ? 2 : 1), current: v.I, mu0: v.mu0, region: v.interior === 0 ? "exterior" : "interior",
        axis: [1, 0], units: solenoidUnits, origin: [0, 0], displayLength: display,
      };
      const drawn = evaluateCurrentFieldConstruction("solenoid_field", operatorInputs, numberContext);
      agree(fieldMark(drawn[0]).x, B, "Bx");
      const winding = trace("winding", "long solenoid winding schematic", "solenoid", Array.from({ length: 161 }, (_, i) => [-1.6 + 3.2 * i / 160, 0.45 * Math.sin(16 * Math.PI * i / 160)]));
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B },
        entities: [entity("field", "vector", "solenoid field"), winding.mark],
        constructions: [winding.build, construction("field", "solenoid_field", { ...operatorInputs, origin: v.interior === 0 ? [0, 0.9] : v.interior === 2 ? [1.6, 0] : [0, 0] }, ["field"])],
      });
    },
  },
  {
    name: "mf.toroid",
    family: "point_field",
    scope: "solved",
    assumptions: "Toroid interior a<r<b: B=mu0 N I/(2 pi r), tangential. ideal=1 explicitly declares the continuously wound ideal toroid, with zero field in the central hole and exterior. Winding surfaces reject without a supplied limiting side.",
    topics: [{ topicId: "physics|13|field-due-to-solenoid-and-toroid", packet: "CH-05a", chapter, remaining: "Leakage of a discrete real winding is outside the continuously wound ideal model." }],
    keys: ["mu0", "N", "I", "a", "b", "r"],
    ordinary: { mu0: 2 * Math.PI, N: 5, I: 2, a: 3, b: 7, r: 5 },
    altered: { mu0: 2 * Math.PI, N: 5, I: 4, a: 3, b: 7, r: 5 },
    rejections: [{ mu0: 2 * Math.PI, N: 5, I: 2, a: 3, b: 7, r: 2 }, { mu0: 2 * Math.PI, N: 5, I: 2, a: 3, b: 7, r: 8 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["ideal"]);
      positive(v.mu0, "mu0");
      positive(v.N, "N");
      positive(v.a, "a");
      if (!(v.b > v.a)) throw new Error("toroid radii require b > a");
      if (v.r < 0 || v.r === v.a || v.r === v.b) throw new Error("observation radius must be nonnegative and away from winding surfaces");
      if (v.ideal !== undefined && v.ideal !== 1) throw new Error("ideal must be explicitly 1");
      const inside = v.r > v.a && v.r < v.b;
      if (!inside && v.ideal !== 1) throw new Error("exterior zero requires the explicit ideal toroid assumption");
      if (!Number.isInteger(v.N)) throw new Error("N must be an integer turn count");
      const B = inside ? v.mu0 * v.N * v.I / (2 * Math.PI * v.r) : 0;
      const scale = 1.7 / Math.max(v.b, v.r);
      const winding = Array.from({ length: 8 }, (_, i) => trace(`winding${i}`, "schematic toroid winding", "", [[v.a * scale * Math.cos(i * Math.PI / 4), v.a * scale * Math.sin(i * Math.PI / 4)], [v.b * scale * Math.cos(i * Math.PI / 4), v.b * scale * Math.sin(i * Math.PI / 4)]]));
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B },
        entities: [labeled("toroid", "circle", "outer toroid winding surface", "toroid"), labeled("inner", "circle", "inner toroid winding surface", ""), labeled("field", B === 0 ? "point" : "vector", "local tangential field", "B"), labeled("observation", "point", "observation point", "P"), ...winding.map((w) => w.mark)],
        constructions: [
          construction("toroid", "circle", { center: { x: 0, y: 0 }, radius: v.b * scale }, ["toroid"]),
          construction("inner", "circle", { center: { x: 0, y: 0 }, radius: v.a * scale }, ["inner"]),
          ...winding.map((w) => w.build),
          construction("observation", "point", { x: v.r * scale, y: 0 }, ["observation"]),
          construction("field", B === 0 ? "point" : "vector", B === 0 ? { x: v.r * scale, y: 0 } : { start: [v.r * scale, 0], end: [v.r * scale, Math.sign(B) * 0.8] }, ["field"]),
        ],
      });
    },
  },
  {
    name: "mm.lines",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Bar-magnet field lines from the bar_magnet operator. The moment direction is supplied. No tesla value is certified from the drawing.",
    topics: [{ topicId: "physics|13|bar-magnet-and-magnetic-field-lines", packet: "CH-05c", chapter, remaining: "A measured field map is not read off the lobe spacing." }],
    keys: ["mx", "my"],
    ordinary: { mx: 2, my: 0 },
    altered: { mx: 0, my: 2 },
    rejections: [{ mx: 0, my: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.mx === 0 && v.my === 0) throw new Error("a bar magnet requires a nonzero moment");
      const operatorInputs = { moment: [v.mx, v.my], displayScale: 1 };
      const drawn = evaluateChapterRemainderConstruction("bar_magnet", operatorInputs, numberContext);
      if (drawn.length !== 5) throw new Error("bar magnet did not draw the bar and four lobes");
      lockBarMagnetGeometry([v.mx, v.my], drawn);
      const span = Math.hypot(v.mx, v.my);
      const axis = { x: v.mx / span, y: v.my / span };
      const returns = drawn.slice(1).map((line, index) => {
        if (line.kind !== "path") throw new Error("external field path is missing");
        const north = line.points[0];
        const south = line.points.at(-1)!;
        return trace(`return${index + 1}`, "internal return field", "", [[south.x, south.y], [north.x, north.y]]);
      });
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: [
          ...["bar", "lobe1", "lobe2", "lobe3", "lobe4"].map((id) => ({ ...entity(id, "polyline", id === "bar" ? "bar magnet" : "field lobe"), label: "" })),
          { ...labeled("northPole", "point", "north pole", "N"), provenance: { pinLabel: true, hideMark: true } },
          { ...labeled("southPole", "point", "south pole", "S"), provenance: { pinLabel: true, hideMark: true } },
          ...returns.map((r) => r.mark),
          ...returns.map((r, i) => labeled(`returnArrow${i + 1}`, "vector", "internal field direction south to north", "")),
        ],
        constructions: [
          construction("magnet", "bar_magnet", operatorInputs, ["bar", "lobe1", "lobe2", "lobe3", "lobe4"]),
          construction("northPole", "point", { x: axis.x * 1.05, y: axis.y * 1.05 }, ["northPole"]),
          construction("southPole", "point", { x: -axis.x * 1.05, y: -axis.y * 1.05 }, ["southPole"]),
          ...returns.map((r) => r.build),
          ...returns.map((r, i) => {
            const points = r.build.inputs.points as number[][];
            const middle = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
            return construction(`returnArrow${i + 1}`, "vector", { start: middle, end: [middle[0] + axis.x * 0.2, middle[1] + axis.y * 0.2] }, [`returnArrow${i + 1}`]);
          }),
        ],
      });
    },
  },
  {
    name: "mm.equivalent",
    family: "point_field",
    scope: "solved",
    assumptions: "Solenoid/bar-magnet dipole correspondence m=NIA along the winding normal; signed current reverses both poles. The diagrams compare source moment orientation and far-field topology. Equivalence does not assert identical real near fields or short-solenoid end corrections.",
    topics: [{ topicId: "physics|13|bar-magnet-as-equivalent-solenoid", packet: "CH-05c", chapter, remaining: "End corrections and a real winding pitch are unsupported." }],
    keys: ["N", "I", "A"],
    ordinary: { N: 10, I: 2, A: 3 },
    altered: { N: 8, I: 2, A: 3 },
    rejections: [{ N: 0, I: 2, A: 3 }, { N: 10, I: 2, A: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.N, "N");
      positive(v.A, "A");
      if (!Number.isInteger(v.N)) throw new Error("N must be an integer turn count");
      if (v.I === 0) throw new Error("a magnet/solenoid correspondence requires nonzero current moment");
      const sign = Math.sign(v.I);
      const winding = trace("winding", "equivalent solenoid winding", "", Array.from({ length: 129 }, (_, i) => [-1.2 + 2.4 * i / 128, -1.1 + 0.35 * Math.sin(16 * Math.PI * i / 128)]));
      const topology = evaluateChapterRemainderConstruction("bar_magnet", { moment: [sign, 0], displayScale: 1 }, numberContext).slice(1);
      const fields = [["solenoidExternal", -1.1], ["barExternal", 1]].flatMap(([prefix, center]) => topology.map((line, i) => {
        if (line.kind !== "path") throw new Error("dipole correspondence requires external paths");
        return trace(`${prefix}${i + 1}`, "qualitative external dipole field", "", line.points.map((p) => [p.x * 1.2 / MAGNET_FACE, p.y + Number(center)]));
      }));
      const arrows = fields.map((field, i) => {
        const points = field.build.inputs.points as number[][];
        const p = points[6], next = points[7];
        const d = Math.hypot(next[0] - p[0], next[1] - p[1]);
        return { mark: labeled(`externalDirection${i + 1}`, "vector", "external field north to south", ""), build: construction(`externalDirection${i + 1}`, "vector", { start: p, end: [p[0] + 0.14 * (next[0] - p[0]) / d, p[1] + 0.14 * (next[1] - p[1]) / d] }, [`externalDirection${i + 1}`]) };
      });
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { m: v.N * v.I * v.A },
        entities: [labeled("coil", "polygon", "equivalent solenoid", "solenoid"), labeled("bar", "polygon", "equivalent bar magnet", "bar magnet"), labeled("moment", "vector", "magnetic moment", "m"), winding.mark, labeled("northPole", "point", "equivalent north pole", "N"), labeled("southPole", "point", "equivalent south pole", "S"), ...fields.map((f) => f.mark), ...arrows.map((a) => a.mark)],
        constructions: [
          construction("coil", "rectangle", { center: { x: 0, y: -1.1 }, width: 2.4, height: 0.8 }, ["coil"]), winding.build,
          construction("bar", "rectangle", { center: { x: 0, y: 1 }, width: 2.4, height: 0.6 }, ["bar"]),
          construction("northPole", "point", { x: sign * 1.3, y: 1 }, ["northPole"]), construction("southPole", "point", { x: -sign * 1.3, y: 1 }, ["southPole"]),
          construction("moment", "vector", { start: [-sign * 0.8, 0], end: [sign * 0.8, 0] }, ["moment"]),
          ...fields.map((f) => f.build), ...arrows.map((a) => a.build),
        ],
      });
    },
  },
  {
    name: "mm.dipole",
    family: "point_field",
    scope: "solved",
    assumptions: "Ideal dipole axial/equatorial far-field model. Optional poleHalfSeparation=a declares a finite two-pole source of strengths ±m/(2a), not an exact measured bar-magnet near field. Axial finite points require r>a; equatorial points require r>0. mu0 is explicit.",
    topics: [{ topicId: "physics|13|magnetic-field-of-bar-magnet", packet: "CH-05c", chapter, remaining: "A point that is neither axial nor equatorial is unsupported." }],
    keys: ["mu0", "m", "r", "axial"],
    ordinary: { mu0: 4 * Math.PI, m: 2, r: 2, axial: 1 },
    altered: { mu0: 4 * Math.PI, m: 2, r: 2, axial: 0 },
    rejections: [{ mu0: 4 * Math.PI, m: 2, r: 0, axial: 1 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["poleHalfSeparation"]);
      positive(v.mu0, "mu0");
      positive(v.r, "r");
      if (v.m === 0) throw new Error("the moment is zero");
      if (v.axial !== 0 && v.axial !== 1) throw new Error("axial must be 1 or 0");
      const at = v.axial === 1 ? [v.r, 0] : [0, v.r];
      const operatorInputs = { moment: [v.m, 0], at, mu0: v.mu0, units: dipoleUnits, origin: [0, 0], displayLength: display };
      const drawn = evaluateCurrentFieldConstruction("magnetic_dipole_field", operatorInputs, numberContext);
      const components = fieldMark(drawn[0]);
      const a = v.poleHalfSeparation;
      if (a !== undefined && (!(a > 0) || (v.axial === 1 && !(v.r > a)))) throw new Error("finite bar requires positive pole half-separation and exterior axial observation");
      const expected = a === undefined
        ? (v.axial === 1 ? v.mu0 * 2 * v.m / (4 * Math.PI * v.r ** 3) : -v.mu0 * v.m / (4 * Math.PI * v.r ** 3))
        : (v.axial === 1 ? v.mu0 * v.m / (8 * Math.PI * a) * (1 / (v.r - a) ** 2 - 1 / (v.r + a) ** 2) : -v.mu0 * v.m / (4 * Math.PI * (v.r * v.r + a * a) ** 1.5));
      if (a === undefined) agree(components.x, expected, "B");
      const scale = 1.6 / Math.max(v.r, a ?? v.r / 4);
      const atDisplay = v.axial === 1 ? [v.r * scale, 0] : [0, v.r * scale];
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { B: expected },
        entities: [labeled("field", "vector", "dipole field", "B"), labeled("bar", "polygon", "source bar model", "bar"), labeled("observation", "point", "axial or equatorial observation", "P"), labeled("moment", "vector", "source magnetic moment", "m")],
        constructions: [
          construction("bar", "rectangle", { center: [0, 0], width: 2 * (a ?? v.r / 4) * scale, height: 0.25 }, ["bar"]),
          construction("observation", "point", { x: atDisplay[0], y: atDisplay[1] }, ["observation"]),
          construction("moment", "vector", { start: [-0.4 * Math.sign(v.m), -0.4], end: [0.4 * Math.sign(v.m), -0.4] }, ["moment"]),
          a === undefined ? construction("field", "magnetic_dipole_field", { ...operatorInputs, origin: atDisplay }, ["field"]) : construction("field", "vector", { start: atDisplay, end: [atDisplay[0] + Math.sign(expected) * 0.7, atDisplay[1]] }, ["field"]),
        ],
      });
    },
  },
  {
    name: "mm.earth",
    family: "point_field",
    scope: "solved",
    assumptions: "Local field only: Bh is a nonnegative horizontal magnitude, Bv is signed positive down, inclination is atan2(Bv,Bh). Optional declination (radians, positive toward east) requires a supplied nonzero horizontal true-north vector northX,northY. Separate horizontal and magnetic-meridian views carry their own coordinate conventions; no geographic field is inferred.",
    topics: [{ topicId: "physics|13|earths-magnetic-field-and-elements", packet: "CH-05c", chapter, remaining: "A geographic location's field must be supplied; it is never guessed from the location name." }],
    keys: ["Bh", "Bv"],
    ordinary: { Bh: 3, Bv: 4 },
    altered: { Bh: 8, Bv: 6 },
    rejections: [{ Bh: 0, Bv: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["declination", "northX", "northY"]);
      if (v.Bh === 0 && v.Bv === 0) throw new Error("both field elements are zero");
      if (v.Bh < 0) throw new Error("Bh must be a nonnegative magnitude");
      const hasReference = paired(v, ["declination", "northX", "northY"]);
      const referenceLength = hasReference ? Math.hypot(v.northX, v.northY) : 1;
      if (hasReference && (!(referenceLength > 0) || v.Bh === 0)) throw new Error("declination requires nonzero true north and horizontal field");
      const scale = 1.6 / Math.hypot(v.Bh, v.Bv);
      const horizontal = hasReference ? [v.northX / referenceLength, v.northY / referenceLength] : [1, 0];
      const D = v.declination ?? 0;
      const horizontalTip = [1.3 * (horizontal[0] * Math.cos(D) - horizontal[1] * Math.sin(D)), 2.4 + 1.3 * (horizontal[1] * Math.cos(D) + horizontal[0] * Math.sin(D))];
      const entities = [...(v.Bv === 0 ? [] : [labeled("horizontal", v.Bh === 0 ? "point" : "vector", "horizontal element in magnetic meridian", v.Bh === 0 ? "Bh=0" : "Bh")]), ...(v.Bh === 0 ? [] : [labeled("vertical", v.Bv === 0 ? "point" : "vector", "vertical element positive down", v.Bv === 0 ? "Bv=0" : "Bv")]), labeled("total", "vector", "total field in magnetic meridian", v.Bv === 0 ? "B=Bh" : v.Bh === 0 ? "B, Bv" : "B")];
      const constructions = [
        ...(v.Bv === 0 ? [] : [construction("horizontal", v.Bh === 0 ? "point" : "vector", v.Bh === 0 ? { x: 0, y: 0 } : { start: [0, 0], end: [v.Bh * scale, 0] }, ["horizontal"])]),
        ...(v.Bh === 0 ? [] : [construction("vertical", v.Bv === 0 ? "point" : "vector", v.Bv === 0 ? { x: v.Bh * scale, y: 0 } : { start: [v.Bh * scale, 0], end: [v.Bh * scale, -v.Bv * scale] }, ["vertical"])]),
        construction("total", "vector", { start: [0, 0], end: [v.Bh * scale, -v.Bv * scale] }, ["total"]),
      ];
      if (hasReference) {
        const sameNorth = Math.abs(Math.sin(D)) < 1e-12 && Math.cos(D) > 0;
        entities.push(labeled("trueNorth", "vector", "true north in supplied horizontal reference", sameNorth ? "Ntrue=Nmag" : "true north"), ...(sameNorth ? [] : [labeled("magneticNorth", "vector", "magnetic horizontal field", "magnetic north")]));
        constructions.push(construction("trueNorth", "vector", { start: [0, 2.4], end: [1.3 * horizontal[0], 2.4 + 1.3 * horizontal[1]] }, ["trueNorth"]), ...(sameNorth ? [] : [construction("magneticNorth", "vector", { start: [0, 2.4], end: horizontalTip }, ["magneticNorth"])]));
      }
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { B: Math.hypot(v.Bh, v.Bv), dip: Math.atan2(v.Bv, v.Bh), ...(hasReference ? { declination: D } : {}) }, entities, constructions,
      });
    },
  },
  {
    name: "mm.materials",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Qualitative response: diamagnetic M opposes H; paramagnetic M follows H; ferromagnetic response follows H but remanence needs history. Optional kind=-1/1/2 selects that source-declared response. Supplied (T,chi) observations and Tc are shown without extrapolation, interpolation or an invented Curie/hysteresis law.",
    topics: [{ topicId: "physics|13|magnetic-materials-and-temperature", packet: "CH-05c", chapter, remaining: "Unmeasured Curie curves and hysteresis need an explicit material law/history; no values are inferred from a material name." }],
    keys: ["shown"],
    ordinary: { shown: 1 },
    altered: { shown: 1 },
    rejections: [{ shown: 0 }],
    build(inputs) {
      const v = declared(inputs, this.keys, ["kind", "T1", "chi1", "T2", "chi2", "T3", "chi3", "Tc"]);
      if (v.shown !== 1) throw new Error("the materials schematic requires the explicit shown flag");
      if (v.kind !== undefined && ![-1, 1, 2].includes(v.kind)) throw new Error("kind must be -1 diamagnetic, 1 paramagnetic, or 2 ferromagnetic");
      const hasData = paired(v, ["T1", "chi1", "T2", "chi2"]);
      const third = paired(v, ["T3", "chi3"]);
      if (third && !hasData) throw new Error("third observation requires the first two");
      const observations = hasData ? [[v.T1, v.chi1], [v.T2, v.chi2], ...(third ? [[v.T3, v.chi3]] : [])] : [];
      if (observations.some(([T, chi], i) => !(T > 0) || (i > 0 && !(T > observations[i - 1][0])) || (v.kind === -1 && !(chi < 0)) || (v.kind !== undefined && v.kind > 0 && !(chi > 0)))) throw new Error("observations require ordered positive kelvin temperatures and susceptibility consistent with the declared response");
      if (v.Tc !== undefined) positive(v.Tc, "Tc");
      const response = (id: string, x: number, sign: number, label: string) => ({
        mark: labeled(id, "vector", "magnetization relative to applied field", label), build: construction(id, "vector", { start: [x, 0], end: [x + sign * 0.65, 0] }, [id]),
      });
      const responses = v.kind === undefined ? [response("dia", -1.4, -1, "diamagnetic"), response("para", 0, 1, "paramagnetic"), response("ferro", 1.5, 1, "ferromagnetic")] : [response("response", 0, v.kind === -1 ? -1 : 1, v.kind === -1 ? "diamagnetic" : v.kind === 1 ? "paramagnetic" : "ferromagnetic")];
      const entities = [labeled("sample", "polygon", "material sample", "sample"), labeled("applied", "vector", "applied field direction", "H"), ...responses.map((r) => r.mark)];
      const constructions = [construction("sample", "rectangle", { center: { x: 0, y: 0 }, width: 5, height: 1 }, ["sample"]), construction("applied", "vector", { start: [-0.6, 0.85], end: [0.6, 0.85] }, ["applied"]), ...responses.map((r) => r.build)];
      if (observations.length) {
        const tMax = Math.max(...observations.map(([T]) => T), v.Tc ?? 0);
        const cMax = Math.max(...observations.map(([, chi]) => Math.abs(chi)));
        if (!(cMax > 0)) throw new Error("zero-only susceptibility data cannot establish a magnetic response");
        entities.push(labeled("temperatureAxis", "vector", "temperature axis in kelvin", "T (K)"), labeled("chiAxis", "vector", "dimensionless susceptibility axis", "chi"));
        constructions.push(construction("temperatureAxis", "vector", { start: [-2, -2], end: [2.5, -2] }, ["temperatureAxis"]), construction("chiAxis", "vector", { start: [-2, -3.3], end: [-2, -0.8] }, ["chiAxis"]));
        observations.forEach(([T, chi], i) => {
          const id = `observation${i + 1}`;
          entities.push(labeled(id, "point", "supplied susceptibility observation", `data ${i + 1}`));
          constructions.push(construction(id, "point", { x: -2 + 4 * T / tMax, y: -2 + chi / cMax }, [id]));
        });
        if (v.Tc !== undefined) {
          entities.push(labeled("curie", "polyline", "supplied Curie temperature marker", "Tc (supplied)"));
          constructions.push(construction("curie", "polyline", { points: [[-2 + 4 * v.Tc / tMax, -3.1], [-2 + 4 * v.Tc / tMax, -0.9]] }, ["curie"]));
        }
      } else if (v.Tc !== undefined) throw new Error("a temperature marker requires supplied temperature observations");
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities, constructions,
      });
      return { ...document, source: { ...document.source, suppliedMaterialData: observations, ...(v.Tc === undefined ? {} : { suppliedCurieTemperature: v.Tc }) } };
    },
  },
];
