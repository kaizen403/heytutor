import type { SceneConstruction, SceneEntity } from "../../types";
import { construction, entity, finiteInputs, positive, sceneDocument as baseSceneDocument, type EmModel } from "./sceneKit";
import type { ModelAdmission } from "./admission";

const chapter = "Electrostatics";

function sceneDocument(args: Parameters<typeof baseSceneDocument>[0]) {
  for (const [key, value] of Object.entries(args.certified)) {
    if (!Number.isFinite(value)) throw new Error(`${key} exceeds finite numeric authority`);
    if (["C", "C0", "Ceq"].includes(key) && !(value > 0)) throw new Error(`${key} capacitance underflow or invalid value`);
  }
  return baseSceneDocument(args);
}

function productValue(value: number, factors: number[], name: string): number {
  if (!Number.isFinite(value) || (factors.every((factor) => factor !== 0) && value === 0)) throw new Error(`${name} overflows or underflows numeric authority`);
  return value;
}

function labeled(id: string, kind: string, role: string, label: string): SceneEntity {
  return { ...entity(id, kind, role), label };
}

function capacitorGlyph(id: string, label: string, at: { x: number; y: number }): { entities: SceneEntity[]; constructions: SceneConstruction[] } {
  const left = `${id}LeftPlate`;
  const right = `${id}RightPlate`;
  const halfGap = 0.1;
  const halfPlate = 0.55;
  return {
    entities: [labeled(left, "line", "capacitor plate", label), entity(right, "line", "capacitor plate")],
    constructions: [
      construction(left, "segment", { start: { x: at.x - halfGap, y: at.y - halfPlate }, end: { x: at.x - halfGap, y: at.y + halfPlate } }, [left]),
      construction(right, "segment", { start: { x: at.x + halfGap, y: at.y - halfPlate }, end: { x: at.x + halfGap, y: at.y + halfPlate } }, [right]),
    ],
  };
}

function plateScene(d: number, thickness = 0, offset = 0, dielectric = false, fraction = 1) {
  const gap = 1.4;
  const height = thickness / d * gap;
  const y = (offset / d - 0.5) * gap + height / 2;
  const entities = [labeled("upper", "polygon", "upper reference plate", "plate A"), labeled("lower", "polygon", "lower reference plate", "plate B")];
  const constructions = [construction("upper", "rectangle", { center: { x: 0, y: gap / 2 + 0.05 }, width: 3, height: 0.1 }, ["upper"]), construction("lower", "rectangle", { center: { x: 0, y: -gap / 2 - 0.05 }, width: 3, height: 0.1 }, ["lower"])];
  if (thickness > 0 && fraction > 0) {
    entities.push(labeled("insert", "polygon", dielectric ? "dielectric region" : "floating conducting slab", dielectric ? "dielectric" : "Eslab=0"));
    constructions.push(construction("insert", "rectangle", { center: { x: -1.5 + 1.5 * fraction, y }, width: 3 * fraction, height }, ["insert"]));
  }
  return { entities, constructions };
}

function sharingScene(grounded = false, separation = false, radii?: [number, number]) {
  const radiusA = radii ? radii[0] / Math.max(...radii) : 0.7;
  const radiusB = radii ? radii[1] / Math.max(...radii) : 1;
  const entities = [labeled("a", "circle", "first conductor", "sphere 1"), labeled("b", "circle", "second conductor", "sphere 2"), labeled("wire", "line", "declared connection", separation ? "disconnected" : "wire")];
  const constructions = [construction("a", "circle", { center: { x: -1.8, y: 0 }, radius: radiusA }, ["a"]), construction("b", "circle", { center: { x: 1.8, y: 0 }, radius: radiusB }, ["b"]), construction("wire", "segment", { start: { x: -1.8 + radiusA, y: 0 }, end: { x: separation ? -0.3 : 1.8 - radiusB, y: 0 } }, ["wire"])];
  if (grounded) {
    entities.push(labeled("groundLead", "line", "external ground connection", "earth reservoir"), entity("ground", "polyline", "ground symbol"));
    constructions.push(construction("groundLead", "segment", { start: { x: 0, y: 0 }, end: { x: 0, y: -1.4 } }, ["groundLead"]), construction("ground", "polyline", { points: [[-0.4, -1.4], [0.4, -1.4], [0, -1.4], [0, -1.6], [-0.25, -1.6], [0.25, -1.6]] }, ["ground"]));
  }
  return { entities, constructions };
}

export const potentialCapacitorModels: EmModel[] = [
  {
    name: "ep.conservation",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Isolated pair. The supplied before and after charges are accepted only when their sums match. No flow path is invented.",
    topics: [{ topicId: "physics|11|charge-conservation-and-coulombs-law", packet: "CH-08c", chapter, remaining: "A diagram is conditional. Contact, spark, and grounding paths are not drawn." }],
    keys: ["q1", "q2", "q1After", "q2After"],
    ordinary: { q1: 3, q2: 1, q1After: 2, q2After: 2 },
    altered: { q1: 5, q2: -1, q1After: 1, q2After: 3 },
    rejections: [{ q1: 3, q2: 1, q1After: 2, q2After: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.q1 + v.q2 !== v.q1After + v.q2After) throw new Error("the supplied charges do not conserve charge");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {}, ...sharingScene() });
    },
  },
  {
    name: "ep.potential",
    family: "point_field",
    scope: "solved",
    assumptions: "Point-charge potential V = k q / r, zero at infinity. k is explicit.",
    topics: [{ topicId: "physics|11|electric-potential-and-potential-difference", packet: "CH-08c", chapter, remaining: "A path-dependent potential is not this electrostatic model." }],
    keys: ["k", "q", "r"],
    ordinary: { k: 1, q: 6, r: 3 },
    altered: { k: 2, q: 6, r: 3 },
    rejections: [{ k: 1, q: 6, r: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.r, "r");
      productValue(v.k * v.q / v.r, [v.k, v.q], "potential");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V: v.k * v.q / v.r }, entities: [labeled("source", "point", "point source charge", v.q < 0 ? "−q" : "+q"), labeled("P", "point", "observation", "P")], constructions: [construction("source", "point", { x: 0, y: 0 }, ["source"]), construction("P", "point", { x: v.r, y: 0 }, ["P"])] });
    },
  },
  {
    name: "ep.dipole_potential",
    family: "point_field",
    scope: "solved",
    assumptions: "Ideal dipole. Axial potential is k p / r^2. Equatorial potential is 0. axial=1 selects the axis; axial=0 selects the equator. p is explicit.",
    topics: [{ topicId: "physics|11|potential-for-point-charge-dipole-and-system", packet: "CH-08c", chapter, remaining: "A finite two-charge potential off those two lines is unsupported in this model." }],
    keys: ["k", "p", "r", "axial"],
    ordinary: { k: 1, p: 8, r: 2, axial: 1 },
    altered: { k: 1, p: 8, r: 2, axial: 0 },
    rejections: [{ k: 1, p: 8, r: 0, axial: 1 }, { k: 1, p: 8, r: 2, axial: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.r, "r");
      if (v.axial !== 0 && v.axial !== 1) throw new Error("axial must be 1 on the axis or 0 on the equator");
      const V = v.axial === 1 ? v.k * v.p / (v.r * v.r) : 0;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V }, entities: [labeled("moment", "vector", "ideal dipole moment", "p"), labeled("P", "point", "potential observation", "P")], constructions: [construction("moment", "vector", { start: { x: 0, y: 0 }, end: { x: Math.sign(v.p) || 1, y: 0 } }, ["moment"]), construction("P", "point", { x: v.axial === 1 ? v.r : 0, y: v.axial === 1 ? 0 : v.r }, ["P"])] });
    },
  },
  {
    name: "ep.pair_energy",
    family: "point_field",
    scope: "solved",
    assumptions: "Assembly energy of two point charges, U = k q1 q2 / r, with zero at infinite separation. No third charge is included.",
    topics: [{ topicId: "physics|11|electrostatic-potential-energy-of-charge-systems", packet: "CH-08c", chapter, remaining: "A three-charge assembly is not inferred by adding a missing term." }],
    keys: ["k", "q1", "q2", "r"],
    ordinary: { k: 1, q1: 3, q2: 4, r: 2 },
    altered: { k: 1, q1: -3, q2: 4, r: 2 },
    rejections: [{ k: 1, q1: 3, q2: 4, r: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.k, "k");
      positive(v.r, "r");
      productValue(v.k * v.q1 * v.q2 / v.r, [v.k, v.q1, v.q2], "pair energy");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { U: v.k * v.q1 * v.q2 / v.r }, entities: [labeled("q1", "point", "first source", v.q1 < 0 ? "−q1" : "+q1"), labeled("q2", "point", "second source", v.q2 < 0 ? "−q2" : "+q2"), labeled("r", "line", "source separation", "r")], constructions: [construction("q1", "point", { x: 0, y: 0 }, ["q1"]), construction("q2", "point", { x: v.r, y: 0 }, ["q2"]), construction("r", "segment", { start: { x: 0, y: 0 }, end: { x: v.r, y: 0 } }, ["r"])] });
    },
  },
  {
    name: "ep.conductor",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Electrostatic conductor schematic. The interior field of an empty conductor is the ideal zero. No surface-charge density is invented.",
    topics: [{ topicId: "physics|11|conductors-insulators-and-polarization", packet: "CH-08c", chapter, remaining: "A cavity with an off-centre charge is unsupported." }],
    keys: ["shown"],
    ordinary: { shown: 1 },
    altered: { shown: 1 },
    rejections: [{ shown: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.shown !== 1) throw new Error("the conductor schematic requires the explicit shown flag");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {}, entities: [labeled("body", "circle", "electrostatic conductor", "conductor"), labeled("interior", "point", "equipotential interior", "E=0")], constructions: [construction("body", "circle", { center: { x: 0, y: 0 }, radius: 1.2 }, ["body"]), construction("interior", "point", { x: 0, y: 0 }, ["interior"])] });
    },
  },
  {
    name: "ep.polarization",
    family: "point_field",
    scope: "qualitative",
    assumptions: "Dielectric polarization is drawn as a slab between plates. No polarization magnitude is certified unless a dielectric constant is supplied to ep.dielectric.",
    topics: [{ topicId: "physics|11|dielectrics-and-polarization", packet: "CH-08c", chapter, remaining: "A bound-charge density needs an explicit dielectric model and is not guessed from the slab outline." }],
    keys: ["shown"],
    ordinary: { shown: 1 },
    altered: { shown: 1 },
    rejections: [{ shown: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      if (v.shown !== 1) throw new Error("the polarization schematic requires the explicit shown flag");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {}, ...plateScene(1, 1, 0, true) });
    },
  },
  {
    name: "ep.sharing",
    family: "point_field",
    scope: "solved",
    assumptions: "Two isolated conductors share charge at a common potential. Nothing is grounded. Q is conserved and V = Qtotal / (C1 + C2).",
    topics: [{ topicId: "physics|11|charge-sharing-between-conductors", packet: "CH-08c", chapter, remaining: "A grounded conductor, V = 0, is not this isolated sharing model." }],
    keys: ["C1", "C2", "Q1", "Q2"],
    ordinary: { C1: 2, C2: 4, Q1: 6, Q2: 0 },
    altered: { C1: 2, C2: 2, Q1: 3, Q2: 1 },
    rejections: [{ C1: 0, C2: 4, Q1: 6, Q2: 0 }, { C1: -2, C2: 4, Q1: 6, Q2: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.C1, "C1");
      positive(v.C2, "C2");
      const total = v.Q1 + v.Q2;
      const C = v.C1 + v.C2;
      const V = total / C;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V, Q1: V * v.C1, Q2: V * v.C2, total }, ...sharingScene() });
    },
  },
  {
    name: "ep.series",
    family: "point_field",
    scope: "solved",
    assumptions: "Two capacitors in series. 1/C = 1/C1 + 1/C2. No charge is invented beyond the series identity.",
    topics: [{ topicId: "physics|11|capacitors-and-combinations", packet: "CH-08c", chapter, remaining: "A mixed series-parallel network is a remaining variant." }],
    keys: ["C1", "C2"],
    ordinary: { C1: 2, C2: 2 },
    altered: { C1: 2, C2: 4 },
    rejections: [{ C1: 0, C2: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.C1, "C1");
      positive(v.C2, "C2");
      const c1 = capacitorGlyph("c1", "C1", { x: -1.15, y: 0 });
      const c2 = capacitorGlyph("c2", "C2", { x: 1.15, y: 0 });
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { Ceq: 1 / (1 / v.C1 + 1 / v.C2) },
        entities: [
          labeled("nodeA", "point", "node", "node a"),
          labeled("nodeB", "point", "node", "node b"),
          labeled("nodeC", "point", "node", "node c"),
          ...c1.entities,
          ...c2.entities,
          entity("wireA", "line", "connecting wire"),
          entity("wireB", "line", "connecting wire"),
          entity("wireC", "line", "connecting wire"),
          entity("wireD", "line", "connecting wire"),
        ],
        constructions: [
          construction("nodeA", "point", { x: -2.2, y: 0 }, ["nodeA"]),
          construction("nodeB", "point", { x: 0, y: 0 }, ["nodeB"]),
          construction("nodeC", "point", { x: 2.2, y: 0 }, ["nodeC"]),
          ...c1.constructions,
          ...c2.constructions,
          construction("wireA", "segment", { start: { x: -2.2, y: 0 }, end: { x: -1.25, y: 0 } }, ["wireA"]),
          construction("wireB", "segment", { start: { x: -1.05, y: 0 }, end: { x: 0, y: 0 } }, ["wireB"]),
          construction("wireC", "segment", { start: { x: 0, y: 0 }, end: { x: 1.05, y: 0 } }, ["wireC"]),
          construction("wireD", "segment", { start: { x: 1.25, y: 0 }, end: { x: 2.2, y: 0 } }, ["wireD"]),
        ],
      });
    },
  },
  {
    name: "ep.parallel",
    family: "point_field",
    scope: "solved",
    assumptions: "Two capacitors in parallel. C = C1 + C2.",
    topics: [{ topicId: "physics|11|capacitors-and-combinations", packet: "CH-08c", chapter, remaining: "More than two parallel capacitors are the same sum with extra declared terms." }],
    keys: ["C1", "C2"],
    ordinary: { C1: 2, C2: 2 },
    altered: { C1: 1, C2: 3 },
    rejections: [{ C1: 2, C2: -1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.C1, "C1");
      positive(v.C2, "C2");
      const c1 = capacitorGlyph("c1", "C1", { x: 0, y: 0.9 });
      const c2 = capacitorGlyph("c2", "C2", { x: 0, y: -0.9 });
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { Ceq: v.C1 + v.C2 },
        entities: [
          labeled("nodeA", "point", "node", "node a"),
          labeled("nodeB", "point", "node", "node b"),
          ...c1.entities,
          ...c2.entities,
          entity("leadA1", "polyline", "connecting wire"),
          entity("leadA2", "polyline", "connecting wire"),
          entity("leadB1", "polyline", "connecting wire"),
          entity("leadB2", "polyline", "connecting wire"),
        ],
        constructions: [
          construction("nodeA", "point", { x: -2.4, y: 0 }, ["nodeA"]),
          construction("nodeB", "point", { x: 2.4, y: 0 }, ["nodeB"]),
          ...c1.constructions,
          ...c2.constructions,
          construction("leadA1", "polyline", { points: [{ x: -2.4, y: 0 }, { x: -2.4, y: 0.9 }, { x: -0.1, y: 0.9 }] }, ["leadA1"]),
          construction("leadA2", "polyline", { points: [{ x: 0.1, y: 0.9 }, { x: 2.4, y: 0.9 }, { x: 2.4, y: 0 }] }, ["leadA2"]),
          construction("leadB1", "polyline", { points: [{ x: -2.4, y: 0 }, { x: -2.4, y: -0.9 }, { x: -0.1, y: -0.9 }] }, ["leadB1"]),
          construction("leadB2", "polyline", { points: [{ x: 0.1, y: -0.9 }, { x: 2.4, y: -0.9 }, { x: 2.4, y: 0 }] }, ["leadB2"]),
        ],
      });
    },
  },
  {
    name: "ep.plate",
    family: "point_field",
    scope: "solved",
    assumptions: "Parallel-plate capacitance C = eps0 A / d. eps0 is explicit. Fringing is neglected.",
    topics: [{ topicId: "physics|11|parallel-plate-capacitor-with-dielectric", packet: "CH-08c", chapter, remaining: "The dielectric multiplier is ep.dielectric. This model is the empty plate." }],
    keys: ["eps0", "A", "d"],
    ordinary: { eps0: 2, A: 6, d: 3 },
    altered: { eps0: 2, A: 6, d: 2 },
    rejections: [{ eps0: 2, A: 6, d: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.eps0, "eps0");
      positive(v.A, "A");
      positive(v.d, "d");
      return sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions,
        certified: { C: v.eps0 * v.A / v.d },
        entities: [
          labeled("plateA", "rectangle", "upper plate", "plate A"),
          labeled("plateB", "rectangle", "lower plate", "plate B"),
        ],
        constructions: [
          construction("plateA", "rectangle", { center: { x: 0, y: 0.45 }, width: 2.4, height: 0.18 }, ["plateA"]),
          construction("plateB", "rectangle", { center: { x: 0, y: -0.45 }, width: 2.4, height: 0.18 }, ["plateB"]),
        ],
      });
    },
  },
  {
    name: "ep.dielectric",
    family: "point_field",
    scope: "solved",
    assumptions: "A linear dielectric fills the parallel-plate gap. C = K eps0 A / d. K is explicit. Partial insertion is not this model.",
    topics: [{ topicId: "physics|11|parallel-plate-capacitor-with-dielectric", packet: "CH-08c", chapter, remaining: "A slab that fills only part of the area is unsupported." }],
    keys: ["eps0", "A", "d", "K"],
    ordinary: { eps0: 2, A: 6, d: 3, K: 3 },
    altered: { eps0: 2, A: 6, d: 3, K: 1 },
    rejections: [{ eps0: 2, A: 6, d: 3, K: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.eps0, "eps0");
      positive(v.A, "A");
      positive(v.d, "d");
      positive(v.K, "K");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { C: v.K * v.eps0 * v.A / v.d }, ...plateScene(v.d, v.d, 0, true) });
    },
  },
  {
    name: "ep.slab",
    family: "point_field",
    scope: "solved",
    assumptions: "Conducting slab inserted parallel to the plates, thickness t < d, area covering the plates. C = eps0 A / (d - t). Any other orientation is rejected by not being an input.",
    topics: [{ topicId: "physics|11|capacitor-with-conducting-slab", packet: "CH-08c", chapter, remaining: "A slab perpendicular to the plates, or a floating slab that does not span the area, is unsupported." }],
    keys: ["eps0", "A", "d", "t"],
    ordinary: { eps0: 2, A: 6, d: 4, t: 1 },
    altered: { eps0: 2, A: 6, d: 4, t: 0 },
    rejections: [{ eps0: 2, A: 6, d: 4, t: 4 }, { eps0: 2, A: 6, d: 4, t: -1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.eps0, "eps0");
      positive(v.A, "A");
      positive(v.d, "d");
      if (v.t < 0 || v.t >= v.d) throw new Error("conducting slab thickness must satisfy 0 <= t < d");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { C: v.eps0 * v.A / (v.d - v.t) }, ...plateScene(v.d, v.t, (v.d - v.t) / 2) });
    },
  },
  {
    name: "ep.stored",
    family: "point_field",
    scope: "solved",
    assumptions: "Stored energy U = C V^2 / 2. The supplied charge must equal C V. A mismatched triple is rejected.",
    topics: [{ topicId: "physics|11|energy-stored-in-capacitor", packet: "CH-08c", chapter, remaining: "Energy dissipated while charging from a resistor is not this stored-energy identity." }],
    keys: ["C", "V", "Q"],
    ordinary: { C: 2, V: 3, Q: 6 },
    altered: { C: 4, V: 2, Q: 8 },
    rejections: [{ C: 2, V: 3, Q: 5 }, { C: 0, V: 3, Q: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys);
      positive(v.C, "C");
      if (v.Q !== v.C * v.V) throw new Error("Q, C, and V are inconsistent");
      productValue(v.C * v.V * v.V / 2, [v.C, v.V], "stored energy");
      const glyph = capacitorGlyph("capacitor", "C", { x: 0, y: 0 });
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { U: v.C * v.V * v.V / 2 }, ...glyph });
    },
  },
  {
    name: "ep.paths", family: "point_field", scope: "solved",
    assumptions: "Electrostatic point charge at the origin. Two source endpoints A/B, positive reference radius r0 with V(r0)=0. Two radial-angular paths remain separated from the source; their line integrals equal VA-VB.",
    topics: [{ topicId: "physics|11|electric-potential-and-potential-difference", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["k", "q", "ax", "ay", "bx", "by", "r0"],
    ordinary: { k: 1, q: 6, ax: 1, ay: 0, bx: 0, by: 3, r0: 2 },
    altered: { k: 1, q: -6, ax: -2, ay: 0, bx: 0, by: -4, r0: 2 },
    rejections: [{ k: 1, q: 6, ax: 0, ay: 0, bx: 0, by: 3, r0: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.r0, "r0");
      const ra = Math.hypot(v.ax!, v.ay!); const rb = Math.hypot(v.bx!, v.by!); positive(ra, "A radius"); positive(rb, "B radius");
      if (v.ax === v.bx && v.ay === v.by) throw new Error("distinct path endpoints required");
      const thetaA = Math.atan2(v.ay!, v.ax!); const thetaB = Math.atan2(v.by!, v.bx!);
      const paths = [0, 2 * Math.PI].map((extra) => Array.from({ length: 81 }, (_, i) => { const t = i / 80; const r = ra + (rb - ra) * t; const angle = thetaA + (thetaB - thetaA + extra) * t; return { x: r * Math.cos(angle), y: r * Math.sin(angle) }; }));
      const VA = v.k! * v.q! * (1 / ra - 1 / v.r0!); const VB = v.k! * v.q! * (1 / rb - 1 / v.r0!);
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { VA, VB, deltaV: VB - VA, integral1: VA - VB, integral2: VA - VB }, entities: [labeled("charge", "point", "source point charge", v.q! < 0 ? "−q" : "+q"), labeled("A", "point", "initial endpoint", "A"), labeled("B", "point", "final endpoint", "B"), labeled("path1", "polyline", "first source-frame path", "path 1"), labeled("path2", "polyline", "second source-frame path", "path 2")], constructions: [construction("charge", "point", { x: 0, y: 0 }, ["charge"]), construction("A", "point", { x: v.ax, y: v.ay }, ["A"]), construction("B", "point", { x: v.bx, y: v.by }, ["B"]), ...paths.map((points, i) => construction(`path${i + 1}`, "polyline", { points }, [`path${i + 1}`]))] });
    },
  },
  {
    name: "ep.system", family: "point_field", scope: "solved",
    assumptions: "Three explicit point charges in one plane. Potential zero at infinity. Assembly energy sums each pair once; assemblyOrder=0 means 1,2,3 and =1 means 3,2,1. Continuous self-energy is not this model.",
    topics: [{ topicId: "physics|11|potential-for-point-charge-dipole-and-system", packet: "CH-08c", chapter, remaining: "Production integration pending." }, { topicId: "physics|11|electrostatic-potential-energy-of-charge-systems", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["k", "q1", "x1", "y1", "q2", "x2", "y2", "q3", "x3", "y3", "x", "y", "assemblyOrder"],
    ordinary: { k: 1, q1: 1, x1: 0, y1: 0, q2: 2, x2: 3, y2: 0, q3: -3, x3: 0, y3: 4, x: 3, y: 4, assemblyOrder: 0 },
    altered: { k: 1, q1: 1, x1: 0, y1: 0, q2: 2, x2: 3, y2: 0, q3: -3, x3: 0, y3: 4, x: 3, y: 4, assemblyOrder: 1 },
    rejections: [{ k: 1, q1: 1, x1: 0, y1: 0, q2: 2, x2: 0, y2: 0, q3: -3, x3: 0, y3: 4, x: 3, y: 4, assemblyOrder: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); if (![0, 1].includes(v.assemblyOrder!)) throw new Error("assembly order must be 0/1");
      const charges = [1, 2, 3].map((i) => ({ q: v[`q${i}`]!, x: v[`x${i}`]!, y: v[`y${i}`]! }));
      let V = 0; let U = 0;
      for (let i = 0; i < charges.length; i += 1) { const a = charges[i]!; const r = Math.hypot(v.x! - a.x, v.y! - a.y); positive(r, "observation-source distance"); V += v.k! * a.q / r; for (const b of charges.slice(i + 1)) { const d = Math.hypot(a.x - b.x, a.y - b.y); positive(d, "source separation"); U += v.k! * a.q * b.q / d; } }
      const order = v.assemblyOrder === 0 ? [0, 1, 2] : [2, 1, 0];
      const steps = order.map((i, n) => order.slice(0, n).reduce((sum, j) => { const a = charges[i]!; const b = charges[j]!; return sum + v.k! * a.q * b.q / Math.hypot(a.x - b.x, a.y - b.y); }, 0));
      if (![V, U, ...steps].every(Number.isFinite)) throw new Error("charge system overflow");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V, U, W1: steps[0]!, W2: steps[1]!, W3: steps[2]! }, entities: [...charges.map((q, i) => labeled(`q${i}`, "point", "source point charge", `${q.q < 0 ? "−" : "+"}q${i + 1}`)), labeled("P", "point", "potential observation", "P"), ...["12", "13", "23"].map((pair) => entity(`pair${pair}`, "line", "pair separation counted once"))], constructions: [...charges.map((q, i) => construction(`q${i}`, "point", { x: q.x, y: q.y }, [`q${i}`])), construction("P", "point", { x: v.x, y: v.y }, ["P"]), ...[[0, 1], [0, 2], [1, 2]].map(([i, j]) => construction(`pair${i! + 1}${j! + 1}`, "segment", { start: { x: charges[i!]!.x, y: charges[i!]!.y }, end: { x: charges[j!]!.x, y: charges[j!]!.y } }, [`pair${i! + 1}${j! + 1}`]))] });
    },
  },
  {
    name: "ep.transfer", family: "point_field", scope: "solved",
    assumptions: "Source-declared charge transfer Δ from body 2 to body 1 and exchange G from an external earth reservoir. Q1'=Q1+Δ+G; Q2'=Q2-Δ. Grounding explicitly exchanges charge; isolated means G=0.",
    topics: [{ topicId: "physics|11|charge-conservation-and-coulombs-law", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["Q1", "Q2", "transfer", "reservoir", "grounded"], ordinary: { Q1: 3, Q2: -1, transfer: -2, reservoir: 0, grounded: 0 }, altered: { Q1: 3, Q2: -1, transfer: 0, reservoir: -3, grounded: 1 },
    rejections: [{ Q1: 3, Q2: -1, transfer: 0, reservoir: -3, grounded: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); if (![0, 1].includes(v.grounded!) || (v.grounded === 0 && v.reservoir !== 0)) throw new Error("isolated transfer cannot exchange charge with ground");
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Q1: v.Q1! + v.transfer! + v.reservoir!, Q2: v.Q2! - v.transfer!, total: v.Q1! + v.Q2! + v.reservoir!, earthChange: -v.reservoir! }, ...sharingScene(v.grounded === 1) });
    },
  },
  {
    name: "ep.materials", family: "point_field", scope: "qualitative",
    assumptions: "Electrostatic equilibrium: isolated or grounded conductor in an external field compared with a dielectric insulator. Conductor interior is equipotential with E=0; dielectric dipoles polarize without free-carrier transfer. Surface signs are schematic, not uniform densities.",
    topics: [{ topicId: "physics|11|conductors-insulators-and-polarization", packet: "CH-08c", chapter, remaining: "Production integration pending." }, { topicId: "physics|11|charge-conservation-and-coulombs-law", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["grounded", "direction"], ordinary: { grounded: 0, direction: 1 }, altered: { grounded: 1, direction: -1 }, rejections: [{ grounded: 2, direction: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); if (![0, 1].includes(v.grounded!) || ![-1, 1].includes(v.direction!)) throw new Error("material state flags invalid");
      const entities: SceneEntity[] = [labeled("conductor", "circle", "electrostatic conductor", "conductor E=0"), labeled("insulator", "polygon", "insulator dielectric", "insulator"), labeled("E", "vector", "external uniform field", "external E")];
      const constructions: SceneConstruction[] = [construction("conductor", "circle", { center: { x: -2, y: 0 }, radius: 0.8 }, ["conductor"]), construction("insulator", "rectangle", { center: { x: 2, y: 0 }, width: 1.6, height: 1.6 }, ["insulator"]), construction("E", "vector", { start: { x: -v.direction! * 1.2, y: 1.5 }, end: { x: v.direction! * 1.2, y: 1.5 } }, ["E"])];
      for (const x of [-2.7, -1.3]) { const id = x < -2 ? "conductorLeft" : "conductorRight"; entities.push(labeled(id, "point", "schematic induced surface sign", (x < -2 ? -v.direction! : v.direction!) > 0 ? "+" : "−")); constructions.push(construction(id, "point", { x, y: 0 }, [id])); }
      for (const [i, y] of [-0.4, 0.4].entries()) { for (const [j, x] of [1.6, 2.4].entries()) { const id = `bound${i}${j}`; entities.push(labeled(id, "point", "bound dipole charge", (j === 0 ? -v.direction! : v.direction!) > 0 ? "+" : "−")); constructions.push(construction(id, "point", { x, y }, [id])); } }
      if (v.grounded === 1) { entities.push(labeled("ground", "line", "earth connection", "ground: V=0")); constructions.push(construction("ground", "segment", { start: { x: -2, y: -0.8 }, end: { x: -2, y: -1.6 } }, ["ground"])); }
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {}, entities, constructions });
    },
  },
  {
    name: "ep.linear_polarization", family: "point_field", scope: "solved",
    assumptions: "Linear isotropic homogeneous dielectric filling the plate gap, no fringing. Free surface density σfree, relative permittivity K>=1. E=σfree/(Kε0); P=ε0(K-1)E; bound surface densities are ±P with opposite screening signs.",
    topics: [{ topicId: "physics|11|dielectrics-and-polarization", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "K", "sigmaFree"], ordinary: { eps0: 2, K: 3, sigmaFree: 12 }, altered: { eps0: 2, K: 1, sigmaFree: -4 }, rejections: [{ eps0: 2, K: 0.5, sigmaFree: 12 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); if (v.K! < 1) throw new Error("electrostatic relative permittivity must be >=1");
      const E = v.sigmaFree! / (v.K! * v.eps0!); const P = v.eps0! * (v.K! - 1) * E;
      const scene = plateScene(1, 1, 0, true);
      const sign = Math.sign(v.sigmaFree!) || 1;
      scene.entities[0]!.label = `${sign > 0 ? "+" : "−"} free`; scene.entities[1]!.label = `${sign > 0 ? "−" : "+"} free`;
      for (const [id, y, label] of [["boundTop", 0.55, sign > 0 ? "− bound" : "+ bound"], ["boundBottom", -0.55, sign > 0 ? "+ bound" : "− bound"]] as const) { scene.entities.push(labeled(id, "point", "bound surface charge", P === 0 ? "P=0" : label)); scene.constructions.push(construction(id, "point", { x: 0.6, y }, [id])); }
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { E, P, sigmaBoundUpper: -P, sigmaBoundLower: P }, ...scene });
    },
  },
  {
    name: "ep.spheres", family: "point_field", scope: "solved",
    assumptions: "Far-separated conducting spheres with radii R1/R2, capacitances Ri/k. A thin wire connects them; grounded=1 fixes common potential zero, grounded=0 conserves total charge. separated=1 shows the connection removed after equilibrium. Touching spheres do not use this model.",
    topics: [{ topicId: "physics|11|charge-sharing-between-conductors", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["k", "R1", "R2", "Q1", "Q2", "grounded", "separated"], ordinary: { k: 1, R1: 1, R2: 2, Q1: 6, Q2: 0, grounded: 0, separated: 0 }, altered: { k: 1, R1: 1, R2: 2, Q1: 6, Q2: 0, grounded: 1, separated: 1 },
    rejections: [{ k: 1, R1: 0, R2: 2, Q1: 6, Q2: 0, grounded: 0, separated: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.k, "k"); positive(v.R1, "R1"); positive(v.R2, "R2"); if (![0, 1].includes(v.grounded!) || ![0, 1].includes(v.separated!)) throw new Error("sphere boundary flags invalid");
      const total = v.Q1! + v.Q2!; const V = v.grounded === 1 ? 0 : v.k! * total / (v.R1! + v.R2!);
      const Q1 = v.R1! * V / v.k!; const Q2 = v.R2! * V / v.k!;
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { V, Q1, Q2, reservoirCharge: total - Q1 - Q2 }, ...sharingScene(v.grounded === 1 && v.separated === 0, v.separated === 1, [v.R1!, v.R2!]) });
    },
  },
  {
    name: "ep.mixed", family: "point_field", scope: "solved",
    assumptions: "Explicit topology: C1 and C2 in series across source voltage V; C3 is in parallel across the same terminals. The isolated middle node has zero net free charge. No shorted/open branch is inferred.",
    topics: [{ topicId: "physics|11|capacitors-and-combinations", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["C1", "C2", "C3", "V"], ordinary: { C1: 2, C2: 2, C3: 3, V: 4 }, altered: { C1: 2, C2: 4, C3: 1, V: -3 }, rejections: [{ C1: 0, C2: 2, C3: 3, V: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.C1, "C1"); positive(v.C2, "C2"); positive(v.C3, "C3");
      const series = 1 / (1 / v.C1! + 1 / v.C2!); const Ceq = series + v.C3!; const Qseries = series * v.V!;
      const glyphs = [capacitorGlyph("c1", "C1", { x: -1, y: 0.8 }), capacitorGlyph("c2", "C2", { x: 1, y: 0.8 }), capacitorGlyph("c3", "C3", { x: 0, y: -0.8 })];
      const wires = [[[-2, 0], [-2, 0.8], [-1.1, 0.8]], [[-0.9, 0.8], [0.9, 0.8]], [[1.1, 0.8], [2, 0.8], [2, 0]], [[-2, 0], [-2, -0.8], [-0.1, -0.8]], [[0.1, -0.8], [2, -0.8], [2, 0]]];
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ceq, Qseries, Q3: v.C3! * v.V!, V1: Qseries / v.C1!, V2: Qseries / v.C2!, Qsource: Ceq * v.V!, middleCharge: 0 }, entities: [...glyphs.flatMap((g) => g.entities), ...wires.map((_, i) => entity(`wire${i}`, "polyline", "connecting wire")), labeled("left", "point", "source high-reference terminal", v.V! < 0 ? "− source" : "+ source"), labeled("right", "point", "source low-reference terminal", v.V! < 0 ? "+ source" : "− source"), labeled("middle", "point", "isolated internal node", "node b")], constructions: [...glyphs.flatMap((g) => g.constructions), ...wires.map((points, i) => construction(`wire${i}`, "polyline", { points }, [`wire${i}`])), construction("left", "point", { x: -2, y: 0 }, ["left"]), construction("right", "point", { x: 2, y: 0 }, ["right"]), construction("middle", "point", { x: 0, y: 0.8 }, ["middle"])] });
    },
  },
  {
    name: "ep.insertion", family: "point_field", scope: "solved",
    assumptions: "Parallel plates, no fringing, linear dielectric K>=1. Source thickness t and area fraction f describe partial fill: parallel area paths each have series air/dielectric layers. battery=1 fixes V; battery=0 isolates initial Q=C0V. Insertion is quasistatic.",
    topics: [{ topicId: "physics|11|parallel-plate-capacitor-with-dielectric", packet: "CH-08c", chapter, remaining: "Production integration pending." }, { topicId: "physics|11|energy-stored-in-capacitor", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "A", "d", "K", "t", "fraction", "V", "battery"], ordinary: { eps0: 2, A: 6, d: 3, K: 3, t: 3, fraction: 0.5, V: 2, battery: 1 }, altered: { eps0: 2, A: 6, d: 3, K: 3, t: 3, fraction: 0.5, V: 2, battery: 0 },
    rejections: [{ eps0: 2, A: 6, d: 3, K: 3, t: 4, fraction: 0.5, V: 2, battery: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); positive(v.A, "A"); positive(v.d, "d");
      if (v.K! < 1 || v.t! < 0 || v.t! > v.d! || v.fraction! < 0 || v.fraction! > 1 || ![0, 1].includes(v.battery!)) throw new Error("dielectric insertion boundaries invalid");
      const C0 = v.eps0! * v.A! / v.d!; const C = v.eps0! * v.A! * ((1 - v.fraction!) / v.d! + v.fraction! / (v.d! - v.t! + v.t! / v.K!));
      const Q0 = C0 * v.V!; const V = v.battery === 1 ? v.V! : Q0 / C; const Q = C * V;
      const U0 = C0 * v.V! ** 2 / 2; const U = C * V ** 2 / 2; const batteryWork = v.battery === 1 ? v.V! * (Q - Q0) : 0; const externalWork = U - U0 - batteryWork;
      productValue(U0, [C0, v.V!], "initial stored energy"); productValue(U, [C, V], "final stored energy");
      const diagram = plateScene(v.d!, v.t!, (v.d! - v.t!) / 2, true, v.fraction!);
      diagram.entities[0]!.label = V === 0 ? "plate A" : V > 0 ? "+ plate" : "− plate"; diagram.entities[1]!.label = V === 0 ? "plate B" : V > 0 ? "− plate" : "+ plate";
      diagram.entities.push(labeled("boundary", "point", "electrical boundary condition", v.battery === 1 ? "fixed V" : "fixed Q")); diagram.constructions.push(construction("boundary", "point", { x: 2, y: 0 }, ["boundary"]));
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { C0, C, Q, V, U0, U, batteryWork, externalWork }, ...diagram });
    },
  },
  {
    name: "ep.floating_slab", family: "point_field", scope: "solved",
    assumptions: "Floating uncharged conducting slab spanning the full plate area, parallel to plates, no fringing. Offset g is lower air gap; upper gap d-t-g. Both gaps positive; slab wired to neither plate. battery=1 fixes V, battery=0 conserves initial charge.",
    topics: [{ topicId: "physics|11|capacitor-with-conducting-slab", packet: "CH-08c", chapter, remaining: "Production integration pending." }, { topicId: "physics|11|energy-stored-in-capacitor", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["eps0", "A", "d", "t", "g", "V", "battery"], ordinary: { eps0: 2, A: 6, d: 4, t: 1, g: 1, V: 3, battery: 1 }, altered: { eps0: 2, A: 6, d: 4, t: 1, g: 2, V: 3, battery: 0 },
    rejections: [{ eps0: 2, A: 6, d: 4, t: 4, g: 0, V: 3, battery: 1 }, { eps0: 2, A: 6, d: 4, t: 1, g: 0, V: 3, battery: 1 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.eps0, "eps0"); positive(v.A, "A"); positive(v.d, "d"); positive(v.g, "lower gap");
      if (v.t! < 0 || !(v.d! - v.t! - v.g! > 0) || ![0, 1].includes(v.battery!)) throw new Error("floating slab cannot touch or wire to plates");
      const C0 = v.eps0! * v.A! / v.d!; const C = v.eps0! * v.A! / (v.d! - v.t!); const V = v.battery === 1 ? v.V! : C0 * v.V! / C; const Q = C * V; const E = V / (v.d! - v.t!);
      const U0 = C0 * v.V! ** 2 / 2; const U = C * V ** 2 / 2; const batteryWork = v.battery === 1 ? v.V! * (Q - C0 * v.V!) : 0;
      productValue(U0, [C0, v.V!], "initial stored energy"); productValue(U, [C, V], "final stored energy");
      const diagram = plateScene(v.d!, v.t!, v.g!); diagram.entities[0]!.label = V === 0 ? "plate A" : V > 0 ? "+ plate" : "− plate"; diagram.entities[1]!.label = V === 0 ? "plate B" : V > 0 ? "− plate" : "+ plate";
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { C, V, Q, Eslab: 0, Eair: E, Vlower: E * v.g!, Vupper: E * (v.d! - v.t! - v.g!), U, batteryWork, externalWork: U - U0 - batteryWork }, ...diagram });
    },
  },
  {
    name: "ep.charge_discharge", family: "point_field", scope: "solved",
    assumptions: "Ideal capacitor C charges quasistatically from zero to source voltage V through a passive resistor, then fully discharges. Source supplies CV²; stored energy and resistor heating each CV²/2. No transient time constant is asserted without R.",
    topics: [{ topicId: "physics|11|energy-stored-in-capacitor", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["C", "V"], ordinary: { C: 2, V: 3 }, altered: { C: 4, V: -2 }, rejections: [{ C: -1, V: 3 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.C, "C"); const U = v.C! * v.V! ** 2 / 2;
      productValue(U, [v.C!, v.V!], "charging stored energy");
      const diagram = capacitorGlyph("capacitor", "capacitor", { x: 0, y: 0 });
      diagram.entities.push(labeled("charging", "vector", "charging direction", "charge"), labeled("discharging", "vector", "discharging direction", "discharge")); diagram.constructions.push(construction("charging", "vector", { start: { x: -2, y: 0.8 }, end: { x: -0.3, y: 0.8 } }, ["charging"]), construction("discharging", "vector", { start: { x: 0.3, y: -0.8 }, end: { x: 2, y: -0.8 } }, ["discharging"]));
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Q: v.C! * v.V!, U, sourceWork: 2 * U, chargingHeat: U, dischargeHeat: U }, ...diagram });
    },
  },
  {
    name: "ep.pair_voltage", family: "point_field", scope: "solved",
    assumptions: "Two ideal capacitors connected to a signed source voltage V. connection=0 is series with an uncharged isolated middle node; connection=1 is parallel across the same source terminals. Source polarity and each plate charge follow the signed voltage.",
    topics: [{ topicId: "physics|11|capacitors-and-combinations", packet: "CH-08c", chapter, remaining: "Production integration pending." }],
    keys: ["C1", "C2", "V", "connection"], ordinary: { C1: 2, C2: 4, V: 6, connection: 0 }, altered: { C1: 2, C2: 4, V: -3, connection: 1 }, rejections: [{ C1: 2, C2: 4, V: 6, connection: 2 }],
    build(inputs) {
      const v = finiteInputs(inputs, this.keys); positive(v.C1, "C1"); positive(v.C2, "C2"); if (![0, 1].includes(v.connection!)) throw new Error("capacitor connection must be series=0 or parallel=1");
      const series = v.connection === 0;
      const Ceq = series ? 1 / (1 / v.C1! + 1 / v.C2!) : v.C1! + v.C2!;
      const Qsource = Ceq * v.V!; const Q1 = series ? Qsource : v.C1! * v.V!; const Q2 = series ? Qsource : v.C2! * v.V!;
      const positions = series ? [{ x: -1, y: 0 }, { x: 1, y: 0 }] : [{ x: 0, y: 0.8 }, { x: 0, y: -0.8 }];
      const glyphs = positions.map((at, i) => capacitorGlyph(`c${i + 1}`, `C${i + 1}`, at));
      const wires = series ? [[[-2, 0], [-1.1, 0]], [[-0.9, 0], [0.9, 0]], [[1.1, 0], [2, 0]]] : [[[-2, 0], [-2, 0.8], [-0.1, 0.8]], [[0.1, 0.8], [2, 0.8], [2, 0]], [[-2, 0], [-2, -0.8], [-0.1, -0.8]], [[0.1, -0.8], [2, -0.8], [2, 0]]];
      return sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: { Ceq, Qsource, Q1, Q2, V1: Q1 / v.C1!, V2: Q2 / v.C2!, ...(series ? { middleCharge: 0 } : {}) }, entities: [...glyphs.flatMap((g) => g.entities), ...wires.map((_, i) => entity(`wire${i}`, "polyline", "connecting wire")), labeled("a", "point", "source terminal a", v.V! < 0 ? "− source" : "+ source"), labeled("b", "point", "source terminal b", v.V! < 0 ? "+ source" : "− source"), ...(series ? [labeled("middle", "point", "isolated middle node", "node c")] : [])], constructions: [...glyphs.flatMap((g) => g.constructions), ...wires.map((points, i) => construction(`wire${i}`, "polyline", { points }, [`wire${i}`])), construction("a", "point", { x: -2, y: 0 }, ["a"]), construction("b", "point", { x: 2, y: 0 }, ["b"]), ...(series ? [construction("middle", "point", { x: 0, y: 0 }, ["middle"])] : [])] });
    },
  },
];

export function potentialCapacitorAdmissions(): ModelAdmission[] {
  const units: Record<string, string> = { k: "N*m^2/C^2", eps0: "F/m", A: "m^2", K: "1", fraction: "1", shown: "1", axial: "1", grounded: "1", separated: "1", direction: "1", battery: "1", assemblyOrder: "1", connection: "1", sigmaFree: "C/m^2", p: "C*m", V: "V", C: "F", C1: "F", C2: "F", C3: "F" };
  const roles: Record<string, string> = { k: "Coulomb coefficient", eps0: "vacuum permittivity", A: "plate area", d: "plate separation", t: "insert thickness", g: "lower air gap", K: "relative permittivity", fraction: "filled area fraction", V: "initial source voltage", C: "capacitance", C1: "first capacitance", C2: "second capacitance", C3: "third capacitance", Q: "capacitor charge", Q1: "first charge", Q2: "second charge", q1: "first charge", q2: "second charge", q3: "third charge", q: "source charge", transfer: "transferred charge", reservoir: "earth charge exchange", sigmaFree: "free surface charge density", r0: "zero reference radius", R1: "first sphere radius", R2: "second sphere radius", p: "dipole moment", r: "observation radius", shown: "source depiction flag", axial: "axis flag", grounded: "grounding flag", separated: "separation flag", direction: "field direction sign", battery: "battery connection flag", assemblyOrder: "assembly order flag" };
  const premises: Record<string, string[]> = {
    "ep.conservation": ["isolated charge transfer"], "ep.potential": ["point charge", "potential zero at infinity"],
    "ep.dipole_potential": ["ideal point dipole", "potential zero at infinity"], "ep.pair_energy": ["point charges", "energy zero at infinite separation"],
    "ep.conductor": ["electrostatic conductor", "empty conductor"], "ep.polarization": ["polarized dielectric between plates"],
    "ep.sharing": ["isolated conductors", "common potential"], "ep.series": ["series capacitors"], "ep.parallel": ["parallel capacitors"],
    "ep.plate": ["parallel plates", "no fringing"], "ep.dielectric": ["parallel plates", "linear dielectric", "full gap fill", "no fringing"],
    "ep.slab": ["parallel plates", "floating conducting slab", "full area", "no fringing"], "ep.stored": ["ideal capacitor"],
    "ep.paths": ["point charge", "electrostatic field", "specified zero reference"], "ep.system": ["point charges", "potential zero at infinity", "energy zero at infinite separation"],
    "ep.transfer": ["source-declared charge transfer"], "ep.materials": ["electrostatic equilibrium", "conductor", "dielectric insulator"],
    "ep.linear_polarization": ["linear isotropic dielectric", "homogeneous full fill", "no fringing"],
    "ep.spheres": ["far-separated conducting spheres", "thin connecting wire"], "ep.mixed": ["first and second capacitors in series", "third capacitor in parallel", "uncharged middle node"],
    "ep.insertion": ["parallel plates", "linear dielectric", "no fringing", "quasistatic insertion"],
    "ep.floating_slab": ["parallel plates", "floating uncharged conducting slab", "full area", "no fringing"],
    "ep.charge_discharge": ["ideal capacitor", "initially uncharged", "passive charging resistor", "fully discharges"],
    "ep.pair_voltage": ["ideal capacitors", "source voltage"],
  };
  const geometryRoles: Record<string, string> = { x: "observation x coordinate", y: "observation y coordinate", ax: "path start x coordinate", ay: "path start y coordinate", bx: "path end x coordinate", by: "path end y coordinate", x1: "first charge x coordinate", y1: "first charge y coordinate", x2: "second charge x coordinate", y2: "second charge y coordinate", x3: "third charge x coordinate", y3: "third charge y coordinate", q1After: "first final charge", q2After: "second final charge", connection: "capacitor connection flag" };
  return potentialCapacitorModels.map((model) => ({ name: model.name, assumptions: premises[model.name]!, roles: Object.fromEntries(model.keys.map((key) => [key, { role: roles[key] ?? geometryRoles[key]!, unit: units[key] ?? (/^[qQ]|After$|^transfer$|^reservoir$/.test(key) ? "C" : "m") }])), scalar(inputs) { return model.build({ ...inputs }).source.certified as Record<string, number>; } }));
}
