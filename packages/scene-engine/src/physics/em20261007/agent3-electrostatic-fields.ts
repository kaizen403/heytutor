import { evaluateDistributedFieldsConstruction } from "../../compile/distributedFieldsGeometry";
import { evaluateDipoleFieldConstruction } from "../../compile/dipoleFieldGeometry";
import { evaluateFieldConstruction } from "../../compile/fieldGeometry";
import { agree, construction, entity, finiteInputs, numberContext, positive, sceneDocument as baseSceneDocument, type EmModel } from "./sceneKit";
import type { SceneConstruction, SceneEntity } from "../../types";
import type { ModelAdmission } from "./admission";

const chapter = "Electrostatics";
const display = 1.5;

function sceneDocument(args: Parameters<typeof baseSceneDocument>[0]) {
  if (Object.values(args.certified).some((value) => !Number.isFinite(value))) throw new Error("electrostatic output exceeds finite numeric authority");
  return baseSceneDocument(args);
}

function componentsOf(value: unknown): { x: number; y: number } {
  if (typeof value === "object" && value !== null && "dipoleField" in value) {
    const field = (value as { dipoleField: { components?: { x: number; y: number } } }).dipoleField;
    if (field.components) return field.components;
  }
  if (typeof value === "object" && value !== null && "electricField" in value) {
    return (value as { electricField: { components: { x: number; y: number } } }).electricField.components;
  }
  throw new Error("field metadata is missing");
}

function fluxOf(value: unknown): number {
  if (typeof value === "object" && value !== null && "gaussFlux" in value) {
    return (value as { gaussFlux: { flux: number } }).gaussFlux.flux;
  }
  throw new Error("gauss metadata is missing");
}

function labeled(id: string, kind: string, role: string, label: string) {
  return { ...entity(id, kind, role), label };
}

function signed(value: number, symbol: string): string {
  return `${value < 0 ? "−" : "+"}${symbol}`;
}

function uniformVectors(v: Record<string, number>): SceneConstruction[] {
  const vector = (id: string, x: number, y: number, at: { x: number; y: number }) => {
    const length = Math.hypot(x, y);
    return construction(id, length === 0 ? "point" : "vector", length === 0 ? at : { start: at, end: { x: at.x + display * x / length, y: at.y + display * y / length } }, [id]);
  };
  return [vector("p", v.px!, v.py!, { x: -1, y: 0 }), vector("E", v.Ex!, v.Ey!, { x: 1, y: 0 })];
}

interface Charge { position: { x: number; y: number }; charge: number }

function field(charges: Charge[], at: { x: number; y: number }, k: number) {
  let Ex = 0;
  let Ey = 0;
  let V = 0;
  for (const source of charges) {
    const dx = at.x - source.position.x;
    const dy = at.y - source.position.y;
    const r = Math.hypot(dx, dy);
    if (!(r > 0)) throw new Error("observation coincides with a point source");
    Ex += k * source.charge * dx / r ** 3;
    Ey += k * source.charge * dy / r ** 3;
    V += k * source.charge / r;
  }
  if (![Ex, Ey, V].every(Number.isFinite)) throw new Error("field overflows finite authority");
  return { Ex, Ey, V, E: Math.hypot(Ex, Ey) };
}

function chargeScene(charges: Charge[], at: { x: number; y: number }, operator: string, inputs: Record<string, unknown>) {
  const entities: SceneEntity[] = charges.map((source, i) => labeled(`q${i}`, "point", "source charge", signed(source.charge, `q${i + 1}`)));
  const constructions: SceneConstruction[] = charges.map((source, i) => construction(`q${i}`, "point", source.position, [`q${i}`]));
  entities.push(labeled("P", "point", "observation", "P"), entity("field", "vector", "electric field"));
  constructions.push(construction("P", "point", at, ["P"]), construction("field", operator, inputs, ["field"]));
  return { entities, constructions };
}

export const electrostaticFieldModels: EmModel[] = [
  {
    name: "ef.coulomb",
    family: "point_field",
    scope: "solved",
    assumptions: "Two point charges in a plane. Force magnitude is k |q1 q2| / r^2. k is an explicit input. Arrow length is display scale.",
    topics: [{ topicId: "physics|11|coulombs-law-for-point-charges", packet: "CH-08a", chapter, remaining: "A continuous charge distribution is not this pair." }],
    keys: ["k", "q1", "q2", "r"],
    ordinary: { k: 1, q1: 2, q2: 2, r: 2 },
    altered: { k: 1, q1: 3, q2: 4, r: 2 },
    rejections: [{ k: 1, q1: 2, q2: 2, r: 0 }, { k: 0, q1: 2, q2: 2, r: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.r, "r");
      const magnitude = v.k * Math.abs(v.q1 * v.q2) / (v.r * v.r);
      const drawn = evaluateDipoleFieldConstruction("coulomb_pair", {
        charges: [{ position: { x: 0, y: 0 }, charge: v.q1 }, { position: { x: v.r, y: 0 }, charge: v.q2 }],
        k: v.k, displayLength: display,
      }, numberContext);
      const actual = Math.hypot(componentsOf(drawn[1]).x, componentsOf(drawn[1]).y);
      agree(actual, magnitude, "F");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { F: magnitude },
        entities: [labeled("q1", "point", "first source charge", signed(v.q1, "q1")), labeled("q2", "point", "second source charge", signed(v.q2, "q2")), entity("f1", "vector", "force on the first charge"), entity("f2", "vector", "force on the second charge")],
        constructions: [construction("q1", "point", { x: 0, y: 0 }, ["q1"]), construction("q2", "point", { x: v.r, y: 0 }, ["q2"]), construction("pair", "coulomb_pair", {
          charges: [{ position: { x: 0, y: 0 }, charge: v.q1 }, { position: { x: v.r, y: 0 }, charge: v.q2 }],
          k: v.k, displayLength: display,
        }, ["f1", "f2"])],
      });
    },
  },
  {
    name: "ef.point",
    family: "point_field",
    scope: "solved",
    assumptions: "Point-charge field E = k q r-hat / r^2. Schematic k is explicit. The 3-4-5 specimen is one allowed input, not a template.",
    topics: [{ topicId: "physics|11|electric-field-for-point-charge", packet: "CH-08a", chapter, remaining: "A non-Coulomb near field is unsupported." }],
    keys: ["k", "q", "x", "y"],
    ordinary: { k: 1, q: 10, x: 3, y: 4 },
    altered: { k: 1, q: 5, x: 3, y: 4 },
    rejections: [{ k: 1, q: 10, x: 0, y: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      const radius = Math.hypot(v.x, v.y);
      if (!(radius > 0)) throw new Error("the observation point is the charge");
      const factor = v.k * v.q / (radius * radius * radius);
      const expected = { x: factor * v.x, y: factor * v.y };
      const drawn = evaluateDipoleFieldConstruction("point_charge_field", {
        charge: { position: { x: 0, y: 0 }, charge: v.q }, at: { x: v.x, y: v.y }, k: v.k, displayLength: display,
      }, numberContext);
      const actual = componentsOf(drawn[0]);
      agree(actual.x, expected.x, "Ex");
      agree(actual.y, expected.y, "Ey");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { Ex: expected.x, Ey: expected.y, E: Math.hypot(expected.x, expected.y) },
        entities: [
          labeled("source", "point", "point charge", signed(v.q, "q")),
          labeled("observation", "point", "field observation point", "P"),
          entity("field", "vector", "electric field"),
        ],
        constructions: [
          construction("source", "point", { x: 0, y: 0 }, ["source"]),
          construction("observation", "point", { x: v.x, y: v.y }, ["observation"]),
          construction("field", "point_charge_field", {
            charge: { position: { x: 0, y: 0 }, charge: v.q }, at: { x: v.x, y: v.y }, k: v.k, displayLength: display,
          }, ["field"]),
        ],
      });
    },
  },
  {
    name: "ef.superposition",
    family: "point_field",
    scope: "solved",
    assumptions: "Two point charges on the x axis. The field is the vector sum. Equal charges cancel at the midpoint; the altered sign does not.",
    topics: [{ topicId: "physics|11|multiple-charges-and-superposition", packet: "CH-08b", chapter, remaining: "More than two charges are the same operator with a longer declared list, not inferred from a sentence." }],
    keys: ["k", "q1", "q2"],
    ordinary: { k: 1, q1: 1, q2: 1 },
    altered: { k: 1, q1: 1, q2: -1 },
    rejections: [{ k: 0, q1: 1, q2: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      const at = { x: 2, y: 0 };
      const sources = [{ position: { x: 0, y: 0 }, charge: v.q1 }, { position: { x: 4, y: 0 }, charge: v.q2 }];
      const part = (charge: number, x: number) => {
        const dx = at.x - x;
        const radius = Math.abs(dx);
        return v.k * charge * dx / (radius * radius * radius);
      };
      const Ex = part(v.q1, 0) + part(v.q2, 4);
      const drawn = evaluateFieldConstruction("electric_field", {
        charges: sources, at, mode: "schematic", k: v.k, displayLength: display,
      }, numberContext);
      agree(componentsOf(drawn[0]).x, Ex, "Ex");
      agree(componentsOf(drawn[0]).y, 0, "Ey");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ex, Ey: 0 },
        entities: [labeled("a", "point", "first charge", signed(v.q1, "q1")), labeled("b", "point", "second charge", signed(v.q2, "q2")), labeled("P", "point", "observation", "P"), entity("field", "vector", "resultant field")],
        constructions: [
          construction("a", "point", { x: 0, y: 0 }, ["a"]),
          construction("b", "point", { x: 4, y: 0 }, ["b"]),
          construction("P", "point", at, ["P"]),
          construction("field", "electric_field", {
            charges: sources, at, mode: "schematic", k: v.k, displayLength: display,
          }, ["field"]),
        ],
      });
    },
  },
  {
    name: "ef.dipole",
    family: "point_field",
    scope: "solved",
    assumptions: "Finite dipole: +q at x=-1 and -q at x=+1, observation on the axis at x=3. This is superposition, not the ideal 2kp/r^3 replacement.",
    topics: [{ topicId: "physics|11|electric-dipole-and-its-field", packet: "CH-08a", chapter, remaining: "An off-axis finite dipole and the ideal far-field formula are separate declared inputs." }],
    keys: ["k", "q"],
    ordinary: { k: 1, q: 1 },
    altered: { k: 2, q: 1 },
    rejections: [{ k: 1, q: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      if (v.q === 0) throw new Error("a dipole needs a nonzero charge magnitude");
      const charges = [{ position: { x: -1, y: 0 }, charge: v.q }, { position: { x: 1, y: 0 }, charge: -v.q }];
      const at = { x: 3, y: 0 };
      const part = (charge: number, x: number) => {
        const dx = at.x - x;
        const radius = Math.abs(dx);
        return v.k * charge * dx / (radius ** 3);
      };
      const Ex = part(v.q, -1) + part(-v.q, 1);
      const drawn = evaluateDipoleFieldConstruction("dipole_field", {
        charges, at, mode: "finite", k: v.k, displayLength: display,
      }, numberContext);
      agree(componentsOf(drawn[0]).x, Ex, "Ex");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ex, Ey: 0 },
        entities: [
          labeled("plus", "point", "first dipole charge", signed(v.q, "q")),
          labeled("minus", "point", "second dipole charge", signed(-v.q, "q")),
          labeled("observation", "point", "field observation point", "P"),
          entity("field", "vector", "finite dipole field"),
        ],
        constructions: [
          construction("plus", "point", { x: -1, y: 0 }, ["plus"]),
          construction("minus", "point", { x: 1, y: 0 }, ["minus"]),
          construction("observation", "point", { x: 3, y: 0 }, ["observation"]),
          construction("field", "dipole_field", {
            charges, at, mode: "finite", k: v.k, displayLength: display,
          }, ["field"]),
        ],
      });
    },
  },
  {
    name: "ef.torque",
    family: "point_field",
    scope: "solved",
    assumptions: "Uniform field. Page-normal torque is px Ey - py Ex. Net force is zero. A gradient is rejected by the operator.",
    topics: [{ topicId: "physics|11|torque-on-electric-dipole", packet: "CH-08a", chapter, remaining: "A nonuniform field is not given a force from an invented gradient." }],
    keys: ["px", "py", "Ex", "Ey"],
    ordinary: { px: 1, py: 0, Ex: 0, Ey: 2 },
    altered: { px: 2, py: 0, Ex: 0, Ey: -1 },
    rejections: [{ px: 0, py: 0, Ex: 0, Ey: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.px === 0 && v.py === 0) throw new Error("the dipole moment is zero");
      const tau = v.px * v.Ey - v.py * v.Ex;
      const drawn = evaluateDipoleFieldConstruction("dipole_torque", {
        p: { x: v.px, y: v.py }, E: { x: v.Ex, y: v.Ey }, at: { x: 0, y: 0 }, displayLength: display,
      }, numberContext);
      const actual = (drawn[0] as { dipoleField: { tau?: number } }).dipoleField.tau;
      if (typeof actual !== "number") throw new Error("torque metadata is missing");
      agree(actual, tau, "tau");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { tau },
        entities: [labeled("p", "vector", "dipole moment", "p"), labeled("E", "vector", "uniform electric field", "E"), labeled("torque", "vector", "dipole torque", "τ")],
        constructions: [...uniformVectors(v), construction("torque", "dipole_torque", {
          p: { x: v.px, y: v.py }, E: { x: v.Ex, y: v.Ey }, at: { x: 0, y: 0 }, displayLength: display,
        }, ["torque"])],
      });
    },
  },
  {
    name: "ef.energy",
    family: "point_field",
    scope: "solved",
    assumptions: "Uniform-field dipole energy U = -p·E with the perpendicular orientation as zero. Agent 3 owns this energy; potential of a charge pair is a different model.",
    topics: [{ topicId: "physics|11|dipole-potential-energy-in-field", packet: "CH-08a", chapter, remaining: "A zero at infinity is not this convention." }],
    keys: ["px", "py", "Ex", "Ey"],
    ordinary: { px: 3, py: 0, Ex: 4, Ey: 0 },
    altered: { px: 0, py: 5, Ex: 4, Ey: 0 },
    rejections: [{ px: 0, py: 0, Ex: 1, Ey: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.px === 0 && v.py === 0) throw new Error("the dipole moment is zero");
      const U = -(v.px * v.Ex + v.py * v.Ey);
      const drawn = evaluateDipoleFieldConstruction("dipole_energy", {
        p: { x: v.px, y: v.py }, E: { x: v.Ex, y: v.Ey }, at: { x: 0, y: 0 }, displayLength: display, zeroConvention: "perpendicular",
      }, numberContext);
      const actual = (drawn[0] as { dipoleField: { U?: number } }).dipoleField.U;
      if (typeof actual !== "number") throw new Error("energy metadata is missing");
      agree(actual, U, "U");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { U },
        entities: [labeled("E", "vector", "uniform electric field", "E"), labeled("energy", "vector", "dipole moment and potential energy", "p")],
        constructions: [uniformVectors(v)[1]!, construction("energy", "dipole_energy", {
          p: { x: v.px, y: v.py }, E: { x: v.Ex, y: v.Ey }, at: { x: 0, y: 0 }, displayLength: display, zeroConvention: "perpendicular",
        }, ["energy"])],
      });
    },
  },
  {
    name: "ef.equipotential",
    family: "point_field",
    scope: "solved",
    assumptions: "Point-charge equipotential circle of radius k q / V. The radius is the physical radius of that surface. V = 0 is not a circle.",
    topics: [{ topicId: "physics|11|equipotential-surfaces", packet: "CH-08a", chapter, remaining: "A dipole contour beyond one point-charge circle is a remaining variant." }],
    keys: ["k", "q", "V"],
    ordinary: { k: 1, q: 2, V: 1 },
    altered: { k: 1, q: 4, V: 2 },
    rejections: [{ k: 1, q: 2, V: 0 }, { k: 1, q: 2, V: -1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      if (v.q * v.V <= 0) throw new Error("point-charge equipotential needs V and q of the same sign");
      const radius = v.k * v.q / v.V;
      const drawn = evaluateDipoleFieldConstruction("equipotential", {
        source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: v.q }, V: v.V, k: v.k,
      }, numberContext);
      if (drawn[0]?.kind !== "circle") throw new Error("equipotential did not draw a circle");
      agree(drawn[0].radius, radius, "radius");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { radius, V: v.V },
        entities: [entity("surface", "circle", "equipotential")],
        constructions: [construction("surface", "equipotential", {
          source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: v.q }, V: v.V, k: v.k,
        }, ["surface"])],
      });
    },
  },
  {
    name: "ef.lines",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Schematic field lines from declared seeds. Line spacing is not a field magnitude. Each line starts at the named positive charge.",
    topics: [{ topicId: "physics|11|electric-field-lines", packet: "CH-08a", chapter, remaining: "A measured line density is not certified." }],
    keys: ["k", "q"],
    ordinary: { k: 1, q: 1 },
    altered: { k: 1, q: 2 },
    rejections: [{ k: 1, q: 0 }, { k: 0, q: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      if (v.q === 0) throw new Error("field lines require a nonzero source");
      const launch = v.q > 0 ? 0.15 : 0.7;
      const lineInputs = {
        charges: [{ id: "source", position: { x: 0, y: 0 }, charge: v.q }],
        starts: [{ x: launch, y: 0 }, { x: 0, y: launch }, { x: -launch, y: 0 }, { x: 0, y: -launch }],
        stepLength: 0.1, stepCount: 9, k: v.k, exclusionRadius: 0.1,
      };
      evaluateDipoleFieldConstruction("field_lines", lineInputs, numberContext);
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: [labeled("source", "point", "source charge", signed(v.q, "q")), entity("lines", "polyline", "schematic field lines")],
        constructions: [construction("source", "point", { x: 0, y: 0 }, ["source"]), construction("lines", "field_lines", lineInputs, ["lines"])],
      });
    },
  },
  {
    name: "ef.ring",
    family: "point_field",
    scope: "solved",
    assumptions: "Axial field of a thin ring, E = k Q x / (R^2 + x^2)^(3/2), away from the centre along +x when Q and x are positive. The circle is a cross-section schematic.",
    topics: [{ topicId: "physics|11|field-on-axis-of-a-charged-ring", packet: "CH-08b", chapter, remaining: "An off-axis ring point is unsupported." }],
    keys: ["k", "Q", "R", "x"],
    ordinary: { k: 1, Q: 2, R: 3, x: 4 },
    altered: { k: 1, Q: 2, R: 3, x: 0 },
    rejections: [{ k: 1, Q: 2, R: 0, x: 4 }, { k: 1, Q: 2, R: -3, x: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.R, "R");
      const denom = (v.R * v.R + v.x * v.x) ** 1.5;
      const E = v.k * v.Q * v.x / denom;
      const position = v.x === 0 ? 0 : Math.sign(v.x) * 2;
      const mark = E === 0
        ? construction("field", "point", { x: position, y: 0 }, ["field"])
        : construction("field", "vector", { start: { x: position, y: 0 }, end: { x: position + Math.sign(E) * 1.2, y: 0 } }, ["field"]);
      const ringPoints = Array.from({ length: 49 }, (_, i) => ({ x: 0.3 * Math.cos(i * Math.PI / 24), y: 1.2 * Math.sin(i * Math.PI / 24) }));
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E },
        entities: [entity("ring", "polyline", "projected ring perpendicular to the axis"), labeled("ringCharge", "point", "ring source charge", signed(v.Q, "Q")), labeled("P", "point", "axial observation", E === 0 ? "" : "P"), labeled("Pnote", "point", "observation callout", E === 0 ? "P: E=0" : ""), entity("leader", "line", "observation callout leader"), labeled("axis", "line", "ring axis", "axis"), entity("field", E === 0 ? "point" : "vector", "axial field")],
        constructions: [
          construction("ring", "polyline", { points: ringPoints }, ["ring"]),
          construction("ringCharge", "point", { x: 0, y: 1.2 }, ["ringCharge"]),
          construction("axis", "segment", { start: { x: -3.4, y: 0 }, end: { x: 3.4, y: 0 } }, ["axis"]),
          construction("P", "point", { x: position, y: 0 }, ["P"]),
          construction("Pnote", "point", { x: position + 0.9, y: 0.7 }, ["Pnote"]),
          construction("leader", "segment", { start: { x: position, y: 0 }, end: { x: position + 0.8, y: 0.6 } }, ["leader"]),
          mark,
        ],
      });
    },
  },
  {
    name: "ef.gauss",
    family: "point_field",
    scope: "solved",
    assumptions: "Spherical Gaussian surface. Schematic flux is Q/eps0 and eps0 must be 1 in that mode. The circle is a cross-section, not a rendered sphere.",
    topics: [{ topicId: "physics|11|electric-flux-and-gausss-law", packet: "CH-08b", chapter, remaining: "A non-spherical closed surface is not given a flux from this operator." }],
    keys: ["Q"],
    ordinary: { Q: 4 },
    altered: { Q: 0 },
    rejections: [{ Q: Number.POSITIVE_INFINITY }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      const flux = v.Q / 1;
      const gaussInputs = { model: "spherical", center: [0, 0], radius: 1.4, enclosedCharge: v.Q, epsilon0: 1, mode: "schematic" };
      const drawn = evaluateDistributedFieldsConstruction("gauss_flux", gaussInputs, numberContext);
      agree(fluxOf(drawn[0]), flux, "flux");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { flux },
        entities: [entity("surface", "circle", "gaussian cross-section"), entity("flux", "label", "flux anchor")],
        constructions: [construction("gauss", "gauss_flux", gaussInputs, ["surface", "flux"])],
      });
    },
  },
  {
    name: "ef.shell_in",
    family: "point_field",
    scope: "solved",
    assumptions: "Spherical shell, observation inside, enclosed charge zero. Gauss flux is zero and the electrostatic field is the ideal zero. This is not a finite charged sheet.",
    topics: [{ topicId: "physics|11|gausss-law-field-applications", packet: "CH-08b", chapter, remaining: "A thick shell with a volume density is unsupported." }],
    keys: ["R", "r"],
    ordinary: { R: 3, r: 1 },
    altered: { R: 4, r: 2 },
    rejections: [{ R: 2, r: 2 }, { R: 2, r: 3 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.R, "R");
      if (!(v.r >= 0) || !(v.r < v.R)) throw new Error("shell interior requires 0 <= r < R");
      const gaussInputs = { model: "spherical", center: [0, 0], radius: 1.2, enclosedCharge: 0, epsilon0: 1, mode: "schematic" };
      const drawn = evaluateDistributedFieldsConstruction("gauss_flux", gaussInputs, numberContext);
      agree(fluxOf(drawn[0]), 0, "flux");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { flux: 0, E: 0 },
        entities: [entity("surface", "circle", "gaussian cross-section"), entity("flux", "label", "flux anchor")],
        constructions: [construction("gauss", "gauss_flux", gaussInputs, ["surface", "flux"])],
      });
    },
  },
  {
    name: "ef.shell_out",
    family: "point_field",
    scope: "solved",
    assumptions: "Outside a spherical shell the field is the point-charge field of the enclosed charge. The drawn circle is display scale, not a measured shell radius.",
    topics: [{ topicId: "physics|11|gausss-law-field-applications", packet: "CH-08b", chapter, remaining: "A point between the inner and outer radius of a thick shell is unsupported." }],
    keys: ["k", "Q", "R", "r"],
    ordinary: { k: 1, Q: 4, R: 1, r: 2 },
    altered: { k: 1, Q: 8, R: 1, r: 2 },
    rejections: [{ k: 1, Q: 4, R: 2, r: 2 }, { k: 1, Q: 4, R: 0, r: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.R, "R");
      if (!(v.r > v.R)) throw new Error("shell exterior requires r > R");
      const E = v.k * v.Q / (v.r * v.r);
      const drawn = evaluateDipoleFieldConstruction("point_charge_field", {
        charge: { position: { x: 0, y: 0 }, charge: v.Q }, at: { x: v.r, y: 0 }, k: v.k, displayLength: display,
      }, numberContext);
      agree(componentsOf(drawn[0]).x, E, "E");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E },
        entities: [entity("shell", "circle", "shell schematic"), entity("field", "vector", "exterior field")],
        constructions: [
          construction("shell", "circle", { center: { x: 0, y: 0 }, radius: 1.1 }, ["shell"]),
          construction("field", "point_charge_field", {
            charge: { position: { x: 0, y: 0 }, charge: v.Q }, at: { x: v.r, y: 0 }, k: v.k, displayLength: display,
          }, ["field"]),
        ],
      });
    },
  },
  {
    name: "ef.line",
    family: "point_field",
    scope: "solved",
    assumptions: "Infinite line idealization E = 2 k lambda / r. This is not the finite line_charge_field operator. The stroke is a schematic segment of an infinite line.",
    topics: [{ topicId: "physics|11|gauss-law-infinite-line", packet: "CH-08b", chapter, remaining: "A finite line must use the finite line-charge operator and is not substituted here." }],
    keys: ["k", "lambda", "r"],
    ordinary: { k: 1, lambda: 3, r: 2 },
    altered: { k: 1, lambda: 4, r: 2 },
    rejections: [{ k: 1, lambda: 3, r: 0 }, { k: 0, lambda: 3, r: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.r, "r");
      const E = 2 * v.k * v.lambda / v.r;
      if (v.lambda !== 0 && E === 0) throw new Error("nonzero line density cannot underflow to a zero field");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E },
        entities: [
          labeled("line", "polyline", "infinite-line schematic", signed(v.lambda, "λ")),
          labeled("observation", "point", "field observation point", "P"),
          entity("field", E === 0 ? "point" : "vector", "radial field"),
          labeled("gaussian", "polygon", "cylindrical Gaussian surface section", "Gaussian S"),
          labeled("normal", "vector", "outward side normal", "n"),
        ],
        constructions: [
          construction("line", "polyline", { points: [[0, -1.4], [0, 1.4]] }, ["line"]),
          construction("observation", "point", { x: 0.4, y: 0 }, ["observation"]),
          construction("gaussian", "rectangle", { center: { x: 0, y: 0 }, width: 0.8, height: 2.1 }, ["gaussian"]),
          construction("normal", "vector", { start: { x: 0.4, y: 0.8 }, end: { x: 1, y: 0.8 } }, ["normal"]),
          construction("field", E === 0 ? "point" : "vector", E === 0 ? { x: 0.4, y: 0 } : { start: { x: 0.4, y: 0 }, end: { x: 0.4 + Math.sign(E) * 1.2, y: 0 } }, ["field"]),
        ],
      });
    },
  },
  {
    name: "ef.sheet",
    family: "point_field",
    scope: "solved",
    assumptions: "Infinite sheet idealization E = sigma / (2 eps0), perpendicular to the sheet. eps0 is explicit. A finite plate is rejected because this model has no width.",
    topics: [{ topicId: "physics|11|gauss-law-infinite-sheet", packet: "CH-08b", chapter, remaining: "A finite charged disk is not this sheet." }],
    keys: ["sigma", "eps0"],
    ordinary: { sigma: 4, eps0: 2 },
    altered: { sigma: 6, eps0: 2 },
    rejections: [{ sigma: 4, eps0: 0 }, { sigma: 4, eps0: -1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.eps0, "eps0");
      const E = v.sigma / (2 * v.eps0);
      if (v.sigma !== 0 && E === 0) throw new Error("nonzero sheet density cannot underflow to a zero field");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E },
        entities: [
          labeled("sheet", "polygon", "sheet cross-section", signed(v.sigma, "σ")),
          labeled("observation", "point", "field observation point", "P"),
          entity("field", E === 0 ? "point" : "vector", "sheet field"),
          entity("below", E === 0 ? "point" : "vector", "field on opposite side"),
          labeled("pillbox", "polygon", "Gaussian pillbox section", "pillbox"),
        ],
        constructions: [
          construction("sheet", "rectangle", { center: { x: 0, y: 0 }, width: 2.4, height: 0.2 }, ["sheet"]),
          construction("observation", "point", { x: 0, y: 0.4 }, ["observation"]),
          construction("pillbox", "rectangle", { center: { x: 0, y: 0 }, width: 1, height: 0.8 }, ["pillbox"]),
          construction("field", E === 0 ? "point" : "vector", E === 0 ? { x: 0, y: 0.4 } : { start: { x: 0, y: 0.4 }, end: { x: 0, y: 0.4 + Math.sign(E) * 1.1 } }, ["field"]),
          construction("below", E === 0 ? "point" : "vector", E === 0 ? { x: 0, y: -0.4 } : { start: { x: 0, y: -0.4 }, end: { x: 0, y: -0.4 - Math.sign(E) * 1.1 } }, ["below"]),
        ],
      });
    },
  },
  {
    name: "ef.finite_dipole", family: "point_field", scope: "solved",
    assumptions: "Finite point dipole in a plane with source half-separation a, axis angle in radians, and explicit observation. ideal=1 uses only the far-field axial/equatorial approximation at r>=20a; ideal=0 uses exact superposition.",
    topics: [{ topicId: "physics|11|electric-dipole-and-its-field", packet: "CH-08a", chapter, remaining: "Production source bindings and lifecycle integration pending." }],
    keys: ["k", "q", "a", "angle", "x", "y", "ideal"],
    ordinary: { k: 1, q: 1, a: 1, angle: 0, x: 3, y: 0, ideal: 0 },
    altered: { k: 1, q: 1, a: 1, angle: 0, x: 0, y: 3, ideal: 0 },
    rejections: [{ k: 1, q: 1, a: 0, angle: 0, x: 3, y: 0, ideal: 0 }, { k: 1, q: 1, a: 1, angle: 0, x: 3, y: 0, ideal: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k"); positive(v.a, "a");
      if (v.q === 0 || ![0, 1].includes(v.ideal!)) throw new Error("nonzero dipole charge and ideal flag 0/1 required");
      const axis = { x: Math.cos(v.angle!), y: Math.sin(v.angle!) };
      const charges = [{ position: { x: v.a! * axis.x, y: v.a! * axis.y }, charge: v.q! }, { position: { x: -v.a! * axis.x, y: -v.a! * axis.y }, charge: -v.q! }];
      const at = { x: v.x!, y: v.y! };
      const exact = field(charges, at, v.k!);
      let Ex = exact.Ex; let Ey = exact.Ey;
      if (v.ideal === 1) {
        const r = Math.hypot(v.x!, v.y!);
        const axial = Math.abs(v.x! * axis.y - v.y! * axis.x) <= 1e-9 * r;
        const equatorial = Math.abs(v.x! * axis.x + v.y! * axis.y) <= 1e-9 * r;
        if (!(r >= 20 * v.a!) || (!axial && !equatorial)) throw new Error("ideal dipole requires axial/equatorial far field");
        const coefficient = (axial ? 2 : -1) * v.k! * 2 * v.a! * v.q! / r ** 3;
        Ex = coefficient * axis.x; Ey = coefficient * axis.y;
      }
      const operatorInputs = { charges, at, mode: v.ideal === 1 ? "ideal" : "finite", k: v.k, displayLength: display };
      const evaluated = evaluateDipoleFieldConstruction("dipole_field", operatorInputs, numberContext);
      const actual = componentsOf(evaluated[0]); agree(actual.x, Ex, "Ex"); agree(actual.y, Ey, "Ey");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ex, Ey, E: Math.hypot(Ex, Ey) }, ...chargeScene(charges, at, "dipole_field", operatorInputs) });
    },
  },
  {
    name: "ef.discrete", family: "point_field", scope: "solved",
    assumptions: "Three independently positioned point sources in one plane. Signed Coulomb superposition; all observation-source coincidences reject. Source positions and charges are explicit.",
    topics: [{ topicId: "physics|11|multiple-charges-and-superposition", packet: "CH-08b", chapter, remaining: "Production integration pending; the electric_field operator supports longer explicit source lists." }],
    keys: ["k", "q1", "x1", "y1", "q2", "x2", "y2", "q3", "x3", "y3", "x", "y"],
    ordinary: { k: 1, q1: 1, x1: -1, y1: 0, q2: 1, x2: 1, y2: 0, q3: 2, x3: 0, y3: -1, x: 0, y: 0 },
    altered: { k: 1, q1: -1, x1: -1, y1: 0, q2: 1, x2: 1, y2: 0, q3: -2, x3: 0, y3: -1, x: 0, y: 0 },
    rejections: [{ k: 1, q1: 1, x1: 0, y1: 0, q2: 1, x2: 1, y2: 0, q3: 2, x3: 0, y3: -1, x: 0, y: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k");
      const charges = [1, 2, 3].map((i) => ({ charge: v[`q${i}`]!, position: { x: v[`x${i}`]!, y: v[`y${i}`]! } }));
      const at = { x: v.x!, y: v.y! }; const f = field(charges, at, v.k!);
      const operatorInputs = { charges, at, mode: "si", k: v.k, lengthUnit: "m", chargeUnit: "C", displayLength: display };
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ex: f.Ex, Ey: f.Ey }, ...chargeScene(charges, at, "electric_field", operatorInputs) });
    },
  },
  {
    name: "ef.finite_line", family: "point_field", scope: "solved",
    assumptions: "Uniform finite line charge in SI. Explicit endpoints, density C/m and observation metres. The analytic integral handles exterior axial limits; observation on the source rejects.",
    topics: [{ topicId: "physics|11|multiple-charges-and-superposition", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["k", "lambda", "x1", "y1", "x2", "y2", "x", "y"],
    ordinary: { k: 1, lambda: 1, x1: -1, y1: 0, x2: 1, y2: 0, x: 0, y: 1 },
    altered: { k: 1, lambda: -2, x1: 0, y1: -1, x2: 0, y2: 1, x: 1, y: 0 },
    rejections: [{ k: 1, lambda: 1, x1: -1, y1: 0, x2: 1, y2: 0, x: 0, y: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k");
      const start = { x: v.x1!, y: v.y1! }; const end = { x: v.x2!, y: v.y2! }; const at = { x: v.x!, y: v.y! };
      const operatorInputs = { start, end, at, chargeDensity: v.lambda, mode: "si", k: v.k, lengthUnit: "m", densityUnit: "C/m", displayLength: display };
      const evaluated = evaluateDistributedFieldsConstruction("line_charge_field", operatorInputs, numberContext);
      const metadata = (evaluated[0] as { lineChargeField?: { components: { x: number; y: number } } }).lineChargeField;
      if (!metadata) throw new Error("missing finite-line integral metadata");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ex: metadata.components.x, Ey: metadata.components.y }, entities: [labeled("line", "line", "finite source segment", signed(v.lambda!, "λ")), labeled("P", "point", "observation", "P"), labeled("field", "vector", "electric field", "E")], constructions: [construction("line", "segment", { start, end }, ["line"]), construction("P", "point", at, ["P"]), construction("field", "line_charge_field", operatorInputs, ["field"])] });
    },
  },
  {
    name: "ef.disk", family: "point_field", scope: "solved",
    assumptions: "Uniform surface density on a thin circular disk of radius R. Axial observation z!=0; E=2πkσ[sign(z)-z/sqrt(z²+R²)]. This is the analytic ring-element surface integral, with transverse cancellation.",
    topics: [{ topicId: "physics|11|multiple-charges-and-superposition", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["k", "sigma", "R", "z"],
    ordinary: { k: 1, sigma: 1, R: 3, z: 4 }, altered: { k: 1, sigma: -2, R: 3, z: -4 },
    rejections: [{ k: 1, sigma: 1, R: 0, z: 4 }, { k: 1, sigma: 1, R: 3, z: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.R, "R"); if (v.z === 0) throw new Error("disk surface needs a declared one-sided limit");
      const radius = Math.hypot(v.z!, v.R!);
      const E = 2 * Math.PI * v.k! * v.sigma! * Math.sign(v.z!) * (v.R! / radius) * (v.R! / (radius + Math.abs(v.z!)));
      if (!Number.isFinite(E) || (v.sigma !== 0 && E === 0)) throw new Error("disk field overflows or underflows numeric authority");
      const at = { x: Math.sign(v.z!) * 2, y: 0 };
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E }, entities: [labeled("disk", "polygon", "projected surface-charge disk", signed(v.sigma!, "σ")), labeled("P", "point", "axial observation", "P"), labeled("field", E === 0 ? "point" : "vector", "axial field", "E")], constructions: [construction("disk", "rectangle", { center: { x: 0, y: 0 }, width: 0.2, height: 2 }, ["disk"]), construction("P", "point", at, ["P"]), construction("field", E === 0 ? "point" : "vector", E === 0 ? at : { start: at, end: { x: at.x + Math.sign(E), y: 0 } }, ["field"])] });
    },
  },
  {
    name: "ef.dipole_contour", family: "point_field", scope: "solved",
    assumptions: "Finite equal/opposite point charges, planar equipotential contour V. Bounded source-frame contour; the existing operator verifies constant potential and field-normal tangents. No projected angle certifies a world angle.",
    topics: [{ topicId: "physics|11|equipotential-surfaces", packet: "CH-08a", chapter, remaining: "Production integration pending." }],
    keys: ["k", "q", "a", "angle", "V", "extent"],
    ordinary: { k: 1, q: 1, a: 1, angle: 0, V: 0, extent: 3 }, altered: { k: 1, q: 1, a: 1, angle: 0, V: 2, extent: 3 },
    rejections: [{ k: 1, q: 0, a: 1, angle: 0, V: 1, extent: 3 }, { k: 1, q: 1, a: 1, angle: 0, V: 2, extent: 0.5 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.a, "a"); positive(v.extent, "extent"); if (v.q === 0) throw new Error("nonzero dipole required");
      const p = { x: v.a! * Math.cos(v.angle!), y: v.a! * Math.sin(v.angle!) };
      const charges = [{ position: p, charge: v.q! }, { position: { x: -p.x, y: -p.y }, charge: -v.q! }];
      const operatorInputs = { source: "dipole", charges, V: v.V, k: v.k, sampleDomain: { min: { x: -v.extent!, y: -v.extent! }, max: { x: v.extent!, y: v.extent! } }, samples: 96 };
      evaluateDipoleFieldConstruction("equipotential", operatorInputs, numberContext);
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V: v.V! }, entities: [labeled("q1", "point", "first charge", signed(v.q!, "q")), labeled("q2", "point", "second charge", signed(-v.q!, "q")), labeled("contour", "polyline", "equipotential in the source plane", "equipotential")], constructions: [construction("q1", "point", charges[0]!.position, ["q1"]), construction("q2", "point", charges[1]!.position, ["q2"]), construction("contour", "equipotential", operatorInputs, ["contour"])] });
    },
  },
  {
    name: "ef.dipole_lines", family: "point_field", scope: "qualitative",
    assumptions: "Finite dipole source charges ±q, axis angle radians and half-separation a. Field-line integration follows the signed superposed field; spacing and count are schematic. No magnitude is certified.",
    topics: [{ topicId: "physics|11|electric-field-lines", packet: "CH-08a", chapter, remaining: "Production integration pending." }],
    keys: ["k", "q", "a", "angle"], ordinary: { k: 1, q: 1, a: 1, angle: 0 }, altered: { k: 1, q: -2, a: 2, angle: Math.PI / 2 },
    rejections: [{ k: 1, q: 0, a: 1, angle: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.a, "a"); if (v.q === 0) throw new Error("nonzero dipole required");
      const axis = { x: Math.cos(v.angle!), y: Math.sin(v.angle!) }; const positiveAt = { x: Math.sign(v.q!) * v.a! * axis.x, y: Math.sign(v.q!) * v.a! * axis.y };
      const negativeAt = { x: -positiveAt.x, y: -positiveAt.y };
      const charges = [{ id: "positive", position: positiveAt, charge: Math.abs(v.q!) }, { id: "negative", position: negativeAt, charge: -Math.abs(v.q!) }];
      const stepLength = v.a! / 40; const exclusionRadius = v.a! / 20;
      const starts = [0, Math.PI / 3, -Math.PI / 3, Math.PI * 2 / 3, -Math.PI * 2 / 3].map((angle) => ({ x: positiveAt.x + 2.5 * stepLength * Math.cos(angle + v.angle!), y: positiveAt.y + 2.5 * stepLength * Math.sin(angle + v.angle!) }));
      const operatorInputs = { charges, starts, stepLength, stepCount: 180, exclusionRadius, k: v.k };
      evaluateDipoleFieldConstruction("field_lines", operatorInputs, numberContext);
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {}, entities: [labeled("positive", "point", "positive source", "+q"), labeled("negative", "point", "negative sink", "−q"), entity("lines", "polyline", "schematic dipole field lines")], constructions: [construction("positive", "point", positiveAt, ["positive"]), construction("negative", "point", negativeAt, ["negative"]), construction("lines", "field_lines", operatorInputs, ["lines"])] });
    },
  },
  {
    name: "ef.shell", family: "point_field", scope: "solved",
    assumptions: "Uniform thin spherical shell, radius R and charge Q. r=R requires side=-1 (inside limit) or side=1 (outside limit); interior field zero and exterior field kQ/r². The cross-section never certifies 3D angles.",
    topics: [{ topicId: "physics|11|gausss-law-field-applications", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["k", "Q", "R", "r", "side"], ordinary: { k: 1, Q: 4, R: 2, r: 2, side: -1 }, altered: { k: 1, Q: 4, R: 2, r: 2, side: 1 },
    rejections: [{ k: 1, Q: 4, R: 2, r: 2, side: 0 }, { k: 1, Q: 4, R: 2, r: -1, side: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.R, "R");
      if (v.r! < 0 || ![-1, 1].includes(v.side!)) throw new Error("nonnegative radius and one-sided convention ±1 required");
      const inside = v.r! < v.R! || (v.r === v.R && v.side === -1); const E = inside ? 0 : v.k! * v.Q! / v.r! ** 2;
      const x = 1.2 * v.r! / v.R!;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E }, entities: [labeled("shell", "circle", "thin spherical charge shell cross-section", signed(v.Q!, "Q")), labeled("P", "point", "observation", "P"), labeled("field", E === 0 ? "point" : "vector", "radial field", E === 0 ? "E=0" : "E")], constructions: [construction("shell", "circle", { center: { x: 0, y: 0 }, radius: 1.2 }, ["shell"]), construction("P", "point", { x, y: 0 }, ["P"]), construction("field", E === 0 ? "point" : "vector", E === 0 ? { x, y: 0 } : { start: { x, y: 0 }, end: { x: x + Math.sign(E), y: 0 } }, ["field"])] });
    },
  },
  {
    name: "ef.closed_flux", family: "point_field", scope: "solved",
    assumptions: "Closed spherical Gaussian surface of radius R centred at the source-frame origin, with two explicitly located charges. orientation=1 outward and -1 inward. Boundary charges reject; the Gaussian surface is not the source.",
    topics: [{ topicId: "physics|11|electric-flux-and-gausss-law", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "R", "q1", "x1", "y1", "q2", "x2", "y2", "orientation"],
    ordinary: { eps0: 2, R: 2, q1: 4, x1: 0, y1: 0, q2: 6, x2: 3, y2: 0, orientation: 1 },
    altered: { eps0: 2, R: 2, q1: 4, x1: 0, y1: 0, q2: -6, x2: 1, y2: 0, orientation: -1 },
    rejections: [{ eps0: 2, R: 2, q1: 4, x1: 2, y1: 0, q2: 6, x2: 3, y2: 0, orientation: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); positive(v.R, "R"); if (![-1, 1].includes(v.orientation!)) throw new Error("normal orientation must be ±1");
      const charges = [1, 2].map((i) => ({ position: { x: v[`x${i}`]!, y: v[`y${i}`]! }, charge: v[`q${i}`]! }));
      let Qenclosed = 0;
      for (const source of charges) { const r = Math.hypot(source.position.x, source.position.y); if (Math.abs(r - v.R!) <= 1e-12 * v.R!) throw new Error("point charge lies on the Gaussian boundary"); if (r < v.R!) Qenclosed += source.charge; }
      const normals = [0, Math.PI / 2, Math.PI, Math.PI * 3 / 2].map((theta, i) => { const start = { x: v.R! * Math.cos(theta), y: v.R! * Math.sin(theta) }; return construction(`n${i}`, "vector", { start, end: { x: start.x + v.orientation! * v.R! / 3 * Math.cos(theta), y: start.y + v.orientation! * v.R! / 3 * Math.sin(theta) } }, [`n${i}`]); });
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Qenclosed, flux: v.orientation! * Qenclosed / v.eps0! }, entities: [labeled("surface", "circle", "closed Gaussian surface cross-section", "Gaussian surface"), ...charges.map((q, i) => labeled(`q${i}`, "point", "source charge", signed(q.charge, `q${i + 1}`))), ...normals.map((_, i) => labeled(`n${i}`, "vector", "oriented surface normal", i === 0 ? "n" : ""))], constructions: [construction("surface", "circle", { center: { x: 0, y: 0 }, radius: v.R }, ["surface"]), ...charges.map((q, i) => construction(`q${i}`, "point", q.position, [`q${i}`])), ...normals] });
    },
  },
  {
    name: "ef.line_gaussian", family: "point_field", scope: "solved",
    assumptions: "Infinite uniform line charge with a coaxial closed Gaussian cylinder of radius r and length L. Outward normal. Radial field makes end-cap flux zero, side flux λL/ε0. The displayed rectangle is an axial cross-section of a cylinder, not a finite wire.",
    topics: [{ topicId: "physics|11|gauss-law-infinite-line", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "lambda", "r", "L"], ordinary: { eps0: 1, lambda: 2 * Math.PI, r: 2, L: 3 }, altered: { eps0: 2, lambda: -4 * Math.PI, r: 1, L: 2 },
    rejections: [{ eps0: 1, lambda: 1, r: 0, L: 3 }, { eps0: 1, lambda: 1, r: 2, L: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); positive(v.r, "r"); positive(v.L, "L");
      const E = v.lambda! / (2 * Math.PI * v.eps0! * v.r!); const Qenclosed = v.lambda! * v.L!; const sideFlux = E * 2 * Math.PI * v.r! * v.L!;
      const r = 0.8; const halfLength = 1.5;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E, Qenclosed, sideFlux, capFlux: 0, flux: Qenclosed / v.eps0! }, entities: [labeled("source", "line", "infinite line source", signed(v.lambda!, "λ")), labeled("surface", "polygon", "Gaussian cylinder axial section", "Gaussian S"), labeled("side", "vector", "radial side field", E === 0 ? "E=0" : "E"), labeled("normal", "vector", "outward side normal", "n"), labeled("cap", "vector", "outward end-cap normal", "ncap")], constructions: [construction("source", "segment", { start: { x: 0, y: -2 }, end: { x: 0, y: 2 } }, ["source"]), construction("surface", "rectangle", { center: { x: 0, y: 0 }, width: 2 * r, height: 2 * halfLength }, ["surface"]), construction("side", E === 0 ? "point" : "vector", E === 0 ? { x: r, y: 0 } : { start: { x: r, y: 0 }, end: { x: r + Math.sign(E) * 0.7, y: 0 } }, ["side"]), construction("normal", "vector", { start: { x: r, y: 0.7 }, end: { x: r + 0.7, y: 0.7 } }, ["normal"]), construction("cap", "vector", { start: { x: 0.4, y: halfLength }, end: { x: 0.4, y: halfLength + 0.6 } }, ["cap"])] });
    },
  },
  {
    name: "ef.sheet_gaussian", family: "point_field", scope: "solved",
    assumptions: "Infinite uniform nonconducting sheet with closed pillbox cap area A straddling it. Signed normal fields above/below the sheet are ±σ/(2ε0); side flux zero. Outward total flux equals σA/ε0, field jump σ/ε0.",
    topics: [{ topicId: "physics|11|gauss-law-infinite-sheet", packet: "CH-08b", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "sigma", "A"], ordinary: { eps0: 2, sigma: 4, A: 3 }, altered: { eps0: 1, sigma: -6, A: 2 }, rejections: [{ eps0: 2, sigma: 4, A: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); positive(v.A, "A"); const Eabove = v.sigma! / (2 * v.eps0!); const capFlux = Eabove * v.A!;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Eabove, Ebelow: -Eabove, jump: v.sigma! / v.eps0!, capFlux, sideFlux: 0, flux: 2 * capFlux, Qenclosed: v.sigma! * v.A! }, entities: [labeled("source", "polygon", "infinite nonconducting sheet section", signed(v.sigma!, "σ")), labeled("surface", "polygon", "Gaussian pillbox section", "pillbox"), labeled("up", Eabove === 0 ? "point" : "vector", "field above sheet", "E+"), labeled("down", Eabove === 0 ? "point" : "vector", "field below sheet", "E−")], constructions: [construction("source", "rectangle", { center: { x: 0, y: 0 }, width: 3, height: 0.12 }, ["source"]), construction("surface", "rectangle", { center: { x: 0, y: 0 }, width: 1.2, height: 1.4 }, ["surface"]), construction("up", Eabove === 0 ? "point" : "vector", Eabove === 0 ? { x: 0, y: 0.7 } : { start: { x: 0, y: 0.7 }, end: { x: 0, y: 0.7 + Math.sign(Eabove) * 0.6 } }, ["up"]), construction("down", Eabove === 0 ? "point" : "vector", Eabove === 0 ? { x: 0, y: -0.7 } : { start: { x: 0, y: -0.7 }, end: { x: 0, y: -0.7 - Math.sign(Eabove) * 0.6 } }, ["down"])] });
    },
  },
];

/** Root registers these specs after reviewing source associations; builders never register themselves. */
export function electrostaticFieldAdmissions(): ModelAdmission[] {
  const units: Record<string, string> = { k: "N*m^2/C^2", q: "C", q1: "C", q2: "C", q3: "C", Q: "C", lambda: "C/m", sigma: "C/m^2", eps0: "F/m", px: "C*m", py: "C*m", Ex: "N/C", Ey: "N/C", V: "V", angle: "rad", A: "m^2" };
  const roles: Record<string, string> = { k: "Coulomb coefficient", q: "source charge", q1: "first charge", q2: "second charge", q3: "third charge", Q: "total source charge", lambda: "line charge density", sigma: "surface charge density", eps0: "vacuum permittivity", px: "dipole moment x component", py: "dipole moment y component", Ex: "uniform electric field x component", Ey: "uniform electric field y component", V: "equipotential value", angle: "dipole axis angle", ideal: "ideal dipole flag", side: "boundary side", orientation: "normal orientation" };
  const flags = ["ideal", "side", "orientation"];
  const premises: Record<string, string[]> = {
    "ef.coulomb": ["point charges"], "ef.point": ["point charge"],
    "ef.superposition": ["point charges", "first charge at x=0", "second charge at x=4", "observation at x=2"],
    "ef.dipole": ["point dipole", "charges at x=-1 and x=1", "observation at x=3"],
    "ef.torque": ["uniform electric field"], "ef.energy": ["uniform electric field", "perpendicular energy zero"],
    "ef.equipotential": ["point charge", "potential zero at infinity"], "ef.lines": ["point charge"],
    "ef.ring": ["uniformly charged ring", "axial observation"], "ef.gauss": ["spherical Gaussian surface", "schematic permittivity equals 1"],
    "ef.shell_in": ["uniform thin spherical shell", "interior observation"], "ef.shell_out": ["uniform thin spherical shell", "exterior observation"],
    "ef.line": ["infinite uniform line charge"], "ef.sheet": ["infinite uniform nonconducting sheet"],
    "ef.finite_dipole": ["point dipole"], "ef.discrete": ["point charges"],
    "ef.finite_line": ["uniform finite line charge"], "ef.disk": ["uniform charged disk", "axial observation"],
    "ef.dipole_contour": ["point dipole", "potential zero at infinity"], "ef.dipole_lines": ["point dipole"],
    "ef.shell": ["uniform thin spherical shell"], "ef.closed_flux": ["closed spherical Gaussian surface"],
    "ef.line_gaussian": ["infinite uniform line charge", "coaxial Gaussian cylinder"], "ef.sheet_gaussian": ["infinite uniform nonconducting sheet", "Gaussian pillbox"],
  };
  const geometryRoles: Record<string, string> = { x: "observation x coordinate", y: "observation y coordinate", z: "axial observation coordinate", x1: "first charge x coordinate", y1: "first charge y coordinate", x2: "second charge x coordinate", y2: "second charge y coordinate", x3: "third charge x coordinate", y3: "third charge y coordinate", a: "dipole half separation", R: "source radius", r: "observation radius", L: "Gaussian cylinder length", A: "Gaussian cap area", extent: "contour domain half width" };
  return electrostaticFieldModels.map((model) => ({ name: model.name, assumptions: premises[model.name]!, roles: Object.fromEntries(model.keys.map((key) => [key, { role: roles[key] ?? geometryRoles[key]!, unit: units[key] ?? (flags.includes(key) ? "1" : "m") }])), scalar(inputs) { return model.build({ ...inputs }).source.certified as Record<string, number>; } }));
}
