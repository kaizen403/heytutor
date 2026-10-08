import { evaluateNetworkConstruction } from "../../compile/networkGeometry";
import { evaluateChapterInstrumentConstruction } from "../../compile/chapterInstrumentGeometry";
import type { SourceContext } from "../../compile/sourceScalars";
import type { SceneDocument } from "../../types";
import { construction, entity, finiteInputs, positive, sceneDocument, type DeclaredScope, type TopicBinding } from "./sceneKit";
import { wheatstoneCurrents } from "./wheatstoneScalar";
import { registerModelAdmission, type InputRole } from "./admission";

const chapter = "Current Electricity";
const context: SourceContext = {
  number(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new Error("network scalar must be a finite number");
  },
  point() { throw new Error("network points are inline"); },
  geometry() { return undefined; },
};

interface Branch { id: string; from: string; to: string; kind: "resistor" | "source" | "wire" | "detector" | "open"; resistance?: number; emf?: number; label?: string; labelOffset?: { x: number; y: number } }
interface Node { id: string; at: [number, number] }

function networkScene(model: string, assumptions: string, scope: DeclaredScope, certified: Record<string, number>, nodes: Node[], branches: Branch[]): SceneDocument {
  const inputs = {
    nodes: nodes.map((node) => ({ id: node.id, at: node.at })),
    branches: branches.map(({ labelOffset: _labelOffset, ...branch }) => branch),
    ground: nodes[0]!.id,
    units: { resistance: "ohm", emf: "V" },
    currentScale: 0.4,
  };
  const solved = evaluateNetworkConstruction("kirchhoff_network", inputs, context);
  for (const [id, expected] of Object.entries(certified)) {
    if (!id.startsWith("I_")) continue;
    const branchId = id.slice(2);
    const mark = solved.find((item) => "networkBranch" in item && item.networkBranch?.id === branchId);
    const actual = mark && "networkBranch" in mark ? mark.networkBranch?.current : undefined;
    if (typeof actual !== "number" || Math.abs(actual - expected) > 1e-9) {
      throw new Error(`${model} current ${id} is ${String(actual)}, expected ${expected}`);
    }
  }
  const entities = [
    ...nodes.map((node) => entity(node.id, "point", "node")),
    ...branches.map((branch) => branch.label ? { ...entity(branch.id, "polyline", branch.kind), label: branch.label, provenance: { pinLabel: Boolean(branch.labelOffset), ...(branch.labelOffset ? { labelOffset: branch.labelOffset } : {}) } } : entity(branch.id, "polyline", branch.kind)),
    ...branches.map((branch) => entity(`I_${branch.id}`, "vector", "branch current")),
  ];
  return sceneDocument({
    model, family: "circuit_network", scope, assumptions, certified, entities,
    constructions: [construction("net", "kirchhoff_network", inputs, entities.map((item) => item.id))],
  });
}

export interface DcNetworkModel {
  name: string;
  scope: DeclaredScope;
  assumptions: string;
  topics: TopicBinding[];
  keys: readonly string[];
  ordinary: Record<string, number>;
  altered: Record<string, number>;
  rejections: Record<string, number>[];
  build(inputs: Record<string, unknown>): SceneDocument;
}

function series(emf: number, rInternal: number, r1: number, r2: number): SceneDocument {
  positive(emf, "emf");
  positive(rInternal, "rInternal");
  positive(r1, "r1");
  positive(r2, "r2");
  const I = emf / (rInternal + r1 + r2);
  return networkScene("dc.series", "Series source and two resistors. Current is emf over the sum of the positive resistances. Branch current is positive from the declared from node to the to node.", "solved", {
    I_S: I, I_R1: I, I_R2: I,
  }, [
    { id: "A", at: [0, 0] },
    { id: "B", at: [2, 0] },
    { id: "C", at: [4, 0] },
  ], [
    { id: "S", from: "A", to: "B", kind: "source", resistance: rInternal, emf },
    { id: "R1", from: "B", to: "C", kind: "resistor", resistance: r1 },
    { id: "R2", from: "C", to: "A", kind: "resistor", resistance: r2 },
  ]);
}

function parallel(emf: number, rInternal: number, r6: number, r3: number): SceneDocument {
  positive(emf, "emf");
  positive(rInternal, "rInternal");
  positive(r6, "r6");
  positive(r3, "r3");
  const req = 1 / (1 / r6 + 1 / r3);
  const I = emf / (rInternal + req);
  const V = I * req;
  return networkScene("dc.parallel", "One source and two resistors between the same nodes. Currents split by conductance. The drawing is not to scale.", "solved", {
    I_S: I, I_R6: V / r6, I_R3: V / r3, V,
  }, [
    { id: "A", at: [0, 0] },
    { id: "B", at: [3, 0] },
  ], [
    { id: "S", from: "A", to: "B", kind: "source", resistance: rInternal, emf },
    { id: "R6", from: "B", to: "A", kind: "resistor", resistance: r6 },
    { id: "R3", from: "B", to: "A", kind: "resistor", resistance: r3 },
  ]);
}

function ohm(emf: number, rInternal: number, R: number): SceneDocument {
  if (emf === 0 || rInternal < 0 || R < 0 || rInternal + R === 0) throw new Error("signed source and nonnegative resistances require a nonsingular total resistance");
  const I = emf / (rInternal + R);
  const V = I * R;
  return networkScene("dc.ohm", "Two-terminal load with an explicit internal resistance. V = I R on the load. This does not remove the separate two-terminal groundedOhm guard.", "solved", {
    I_S: I, I_R: I, V,
  }, [
    { id: "A", at: [0, 0] },
    { id: "B", at: [3, 0] },
  ], [
    { id: "S", from: "A", to: "B", kind: "source", resistance: rInternal, emf },
    R === 0 ? { id: "R", from: "B", to: "A", kind: "wire", label: "short" } : { id: "R", from: "B", to: "A", kind: "resistor", resistance: R },
  ]);
}

function cells(e1: number, r1: number, e2: number, r2: number, R: number): SceneDocument {
  positive(e1, "e1");
  positive(e2, "e2");
  positive(r1, "r1");
  positive(r2, "r2");
  positive(R, "R");
  const I = (e1 + e2) / (r1 + r2 + R);
  return networkScene("dc.cells", "Two aiding cells in series with a load. Opposing cells and unequal parallel cells are not this model.", "solved", {
    I_S1: I, I_S2: I, I_R: I,
  }, [
    { id: "A", at: [0, 0] },
    { id: "B", at: [2, 0] },
    { id: "C", at: [4, 0] },
  ], [
    { id: "S1", from: "A", to: "B", kind: "source", resistance: r1, emf: e1 },
    { id: "S2", from: "B", to: "C", kind: "source", resistance: r2, emf: e2 },
    { id: "R", from: "C", to: "A", kind: "resistor", resistance: R },
  ]);
}

function armLabelOffset(from: [number, number], to: [number, number]): { x: number; y: number } {
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  const dx = midX - 2;
  const dy = midY - 1;
  const length = Math.hypot(dx, dy) || 1;
  const distance = 0.45;
  return { x: (dx / length) * distance, y: (dy / length) * distance };
}

function bridge(emf: number, internal: number, knownLeft: number, knownRight: number, galvanometer: number): SceneDocument {
  positive(emf, "emf");
  positive(internal, "r");
  positive(knownLeft, "P");
  positive(knownRight, "Q");
  positive(galvanometer, "Rg");
  const currents = wheatstoneCurrents({ emf, r: internal, P: knownLeft, Q: knownRight, Rg: galvanometer });
  return networkScene("dc.wheatstone", "Balanced Wheatstone. Equal ratios P/Q on both sides. The detector is a galvanometer of explicit resistance Rg, not a wire. The source sits outside the detector branch, with explicit internal resistance r.", "solved", {
    ...currents,
  }, [
    { id: "L", at: [0, 1] },
    { id: "T", at: [2, 2] },
    { id: "R", at: [4, 1] },
    { id: "B", at: [2, 0] },
    { id: "SL", at: [0, -1.2] },
    { id: "SR", at: [4, -1.2] },
  ], [
    { id: "WL", from: "L", to: "SL", kind: "wire", label: "" },
    { id: "S", from: "SL", to: "SR", kind: "source", resistance: internal, emf, label: `${emf} V, r` },
    { id: "WR", from: "SR", to: "R", kind: "wire", label: "" },
    { id: "LT", from: "L", to: "T", kind: "resistor", resistance: knownLeft, label: "P", labelOffset: armLabelOffset([0, 1], [2, 2]) },
    { id: "TR", from: "T", to: "R", kind: "resistor", resistance: knownRight, label: "Q", labelOffset: armLabelOffset([2, 2], [4, 1]) },
    { id: "LB", from: "L", to: "B", kind: "resistor", resistance: knownLeft, label: "P", labelOffset: armLabelOffset([0, 1], [2, 0]) },
    { id: "BR", from: "B", to: "R", kind: "resistor", resistance: knownRight, label: "Q", labelOffset: armLabelOffset([2, 0], [4, 1]) },
    { id: "G", from: "T", to: "B", kind: "detector", resistance: galvanometer, label: "Rg" },
  ]);
}

function metre(known: number, unknown: number, wire: number): SceneDocument {
  positive(known, "known");
  positive(unknown, "unknown");
  positive(wire, "wire");
  const balance = wire * known / (known + unknown);
  const inputs = {
    knownResistance: known,
    unknownResistance: unknown,
    wireLength: wire,
    origin: [0, 0],
    displayLength: 4,
    units: { resistance: "ohm", length: "cm" },
  };
  const drawn = evaluateChapterInstrumentConstruction("metre_bridge", inputs, context);
  const jockey = drawn[1];
  const certifiedBalance = jockey && "instrument" in jockey ? jockey.instrument.components.x : NaN;
  if (Math.abs(certifiedBalance - balance) > 1e-8) throw new Error("metre bridge jockey disagrees with the ratio");
  return sceneDocument({
    model: "dc.metre_bridge",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Uniform metre wire. Balance length is L R / (R + X) from the known-resistance end. Display length is not the wire length.",
    certified: { balance, unknown },
    entities: [entity("wire", "polyline", "bridge wire"), entity("jockey", "point", "null point"), entity("known", "polyline", "known gap"), entity("unknownArm", "polyline", "unknown gap")],
    constructions: [construction("bridge", "metre_bridge", inputs, ["wire", "jockey", "known", "unknownArm"])],
  });
}

function potentiometer(driver: number, cell: number, wire: number): SceneDocument {
  positive(driver, "driver");
  positive(cell, "cell");
  positive(wire, "wire");
  if (cell > driver) throw new Error("cell emf above the driver has no null point");
  const balance = wire * cell / driver;
  const inputs = {
    driverEmf: driver,
    cellEmf: cell,
    wireLength: wire,
    displayLength: 4,
    units: { emf: "V", length: "cm" },
  };
  const drawn = evaluateChapterInstrumentConstruction("potentiometer", inputs, context);
  const jockey = drawn[1];
  const certifiedBalance = jockey && "instrument" in jockey ? jockey.instrument.components.x : NaN;
  if (Math.abs(certifiedBalance - balance) > 1e-8) throw new Error("potentiometer null point disagrees with the emf ratio");
  return sceneDocument({
    model: "dc.potentiometer",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Uniform potentiometer wire driven by a larger emf. Null length is L E_cell / E_driver. No standard-cell calibration drift is modeled.",
    certified: { balance },
    entities: [entity("wire", "polyline", "potentiometer wire"), entity("jockey", "point", "null point")],
    constructions: [construction("pot", "potentiometer", inputs, ["wire", "jockey"])],
  });
}

export const dcNetworkModels: DcNetworkModel[] = [
  {
    name: "dc.ohm",
    scope: "solved",
    assumptions: "Explicit emf, internal resistance, and one load.",
    topics: [{ topicId: "physics|12|ohms-law-and-resistance", packet: "CH-02a", chapter, remaining: "A bare two-terminal source with no internal resistance stays on the existing groundedOhm guard." }],
    keys: ["emf", "rInternal", "R"],
    ordinary: { emf: 10, rInternal: 2, R: 3 },
    altered: { emf: 12, rInternal: 1, R: 5 },
    rejections: [{ emf: 10, rInternal: 0, R: 0 }, { emf: 10, rInternal: 2, R: -3 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["emf", "rInternal", "R"]);
      return ohm(v.emf, v.rInternal, v.R);
    },
  },
  {
    name: "dc.series",
    scope: "solved",
    assumptions: "Two resistors in series with one source.",
    topics: [{ topicId: "physics|12|resistor-combinations", packet: "CH-02a", chapter, remaining: "More than two series elements use dc.mixed or a later netlist." }],
    keys: ["emf", "rInternal", "r1", "r2"],
    ordinary: { emf: 10, rInternal: 2, r1: 3, r2: 5 },
    altered: { emf: 12, rInternal: 1, r1: 2, r2: 3 },
    rejections: [{ emf: 10, rInternal: 2, r1: 0, r2: 5 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["emf", "rInternal", "r1", "r2"]);
      return series(v.emf, v.rInternal, v.r1, v.r2);
    },
  },
  {
    name: "dc.parallel",
    scope: "solved",
    assumptions: "Two parallel loads and a source internal resistance.",
    topics: [{ topicId: "physics|12|resistor-combinations", packet: "CH-02a", chapter, remaining: "More than two parallel branches are not this fixed topology." }],
    keys: ["emf", "rInternal", "r6", "r3"],
    ordinary: { emf: 12, rInternal: 2, r6: 6, r3: 3 },
    altered: { emf: 12, rInternal: 2, r6: 6, r3: 6 },
    rejections: [{ emf: 12, rInternal: 2, r6: 6, r3: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["emf", "rInternal", "r6", "r3"]);
      return parallel(v.emf, v.rInternal, v.r6, v.r3);
    },
  },
  {
    name: "dc.mixed",
    scope: "solved",
    assumptions: "Series pair whose second element is the parallel of two resistors, then returned through the source. Fixed topology.",
    topics: [{ topicId: "physics|12|mixed-resistor-networks", packet: "CH-02a", chapter, remaining: "Arbitrary unlabeled meshes are not inferred from a sentence." }],
    keys: ["emf", "rSource", "rSeries", "rA", "rB"],
    ordinary: { emf: 12, rSource: 2, rSeries: 2, rA: 4, rB: 4 },
    altered: { emf: 18, rSource: 2, rSeries: 2, rA: 4, rB: 4 },
    rejections: [{ emf: 12, rSource: 2, rSeries: 2, rA: 0, rB: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["emf", "rSource", "rSeries", "rA", "rB"]);
      positive(v.emf, "emf");
      positive(v.rSource, "rSource");
      positive(v.rSeries, "rSeries");
      positive(v.rA, "rA");
      positive(v.rB, "rB");
      const parallel = 1 / (1 / v.rA + 1 / v.rB);
      const I = v.emf / (v.rSource + v.rSeries + parallel);
      const parallelVoltage = I * parallel;
      return networkScene("dc.mixed", "Series resistor then two equal-topology parallel resistors. Source resistance is explicit.", "solved", {
        I_S: I, I_RS: I, I_Aload: parallelVoltage / v.rA, I_Bload: parallelVoltage / v.rB,
      }, [
        { id: "A", at: [0, 0] },
        { id: "B", at: [2, 0] },
        { id: "C", at: [4, 1] },
      ], [
        { id: "S", from: "A", to: "B", kind: "source", resistance: v.rSource, emf: v.emf },
        { id: "RS", from: "B", to: "C", kind: "resistor", resistance: v.rSeries },
        { id: "Aload", from: "C", to: "A", kind: "resistor", resistance: v.rA },
        { id: "Bload", from: "C", to: "A", kind: "resistor", resistance: v.rB },
      ]);
    },
  },
  {
    name: "dc.cells",
    scope: "solved",
    assumptions: "Two aiding series cells.",
    topics: [{ topicId: "physics|12|cell-combinations", packet: "CH-02a", chapter, remaining: "Parallel identical cells and opposing cells are not this topology." }],
    keys: ["e1", "r1", "e2", "r2", "R"],
    ordinary: { e1: 3, r1: 1, e2: 3, r2: 1, R: 4 },
    altered: { e1: 4, r1: 1, e2: 2, r2: 1, R: 2 },
    rejections: [{ e1: 3, r1: 1, e2: -3, r2: 1, R: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["e1", "r1", "e2", "r2", "R"]);
      return cells(v.e1, v.r1, v.e2, v.r2, v.R);
    },
  },
  {
    name: "dc.kirchhoff",
    scope: "solved",
    assumptions: "Two-loop network with a shared resistor. Currents are the signed from-to branch currents of kirchhoff_network.",
    topics: [{ topicId: "physics|12|kirchhoffs-laws", packet: "CH-02a", chapter, remaining: "Dependent sources and non-ohmic branches are unsupported." }],
    keys: ["e1", "e2"],
    ordinary: { e1: 5, e2: 5 },
    altered: { e1: 10, e2: 5 },
    rejections: [{ e1: 0, e2: 4 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["e1", "e2"]);
      positive(v.e1, "e1");
      positive(v.e2, "e2");
      // Unit resistors. Node B is the first source terminal and C the second.
      // VB = (3 e1 + e2) / 5, VC = (e1 + 2 e2) / 5, ground at A.
      const vb = (3 * v.e1 + v.e2) / 5;
      const vc = (v.e1 + 2 * v.e2) / 5;
      return networkScene("dc.kirchhoff", "Two unit-resistance source branches and two unit resistors. Signed from-to currents.", "solved", {
        I_S1: v.e1 - vb,
        I_M: vb - vc,
        I_CA: vc,
        I_S2: v.e2 - vc,
      }, [
        { id: "A", at: [0, 0] },
        { id: "B", at: [0, 2] },
        { id: "C", at: [2, 0] },
      ], [
        { id: "S1", from: "A", to: "B", kind: "source", resistance: 1, emf: v.e1 },
        { id: "M", from: "B", to: "C", kind: "resistor", resistance: 1 },
        { id: "CA", from: "C", to: "A", kind: "resistor", resistance: 1 },
        { id: "S2", from: "A", to: "C", kind: "source", resistance: 1, emf: v.e2 },
      ]);
    },
  },
  {
    name: "dc.wheatstone",
    scope: "solved",
    assumptions: "Balanced equal-ratio bridge. Source internal resistance and galvanometer resistance are explicit inputs. Unbalanced galvanometer current is a remaining variant.",
    topics: [{ topicId: "physics|12|wheatstone-and-metre-bridge", packet: "CH-02c", chapter, remaining: "An unbalanced bridge current is not certified in this batch." }],
    keys: ["emf", "r", "P", "Q", "Rg"],
    ordinary: { emf: 12, r: 1, P: 2, Q: 4, Rg: 5 },
    altered: { emf: 6, r: 1, P: 2, Q: 4, Rg: 5 },
    rejections: [{ emf: 0, r: 1, P: 2, Q: 4, Rg: 5 }, { emf: 12, r: 1, P: 2, Q: 0, Rg: 5 }, { emf: 12, r: 0, P: 2, Q: 4, Rg: 5 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["emf", "r", "P", "Q", "Rg"]);
      return bridge(v.emf, v.r, v.P, v.Q, v.Rg);
    },
  },
  {
    name: "dc.metre_bridge",
    scope: "solved",
    assumptions: "Uniform wire, known and unknown in the end gaps.",
    topics: [
      { topicId: "physics|12|wheatstone-and-metre-bridge", packet: "CH-02c", chapter, remaining: "End corrections and a nonuniform wire are unsupported." },
      { topicId: "physics|12|metre-bridge", packet: "CH-02c", chapter, remaining: "End corrections and a nonuniform wire are unsupported." },
    ],
    keys: ["known", "unknown", "wire"],
    ordinary: { known: 2, unknown: 6, wire: 100 },
    altered: { known: 3, unknown: 6, wire: 90 },
    rejections: [{ known: 2, unknown: 6, wire: 0 }, { known: 0, unknown: 6, wire: 100 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["known", "unknown", "wire"]);
      return metre(v.known, v.unknown, v.wire);
    },
  },
  {
    name: "dc.potentiometer",
    scope: "solved",
    assumptions: "Ideal uniform wire and a cell that does not exceed the driver.",
    topics: [{ topicId: "physics|12|potentiometer", packet: "CH-02c", chapter, remaining: "Internal resistance of the cell under comparison and a two-cell comparison beyond E1/E2 = l1/l2 are remaining." }],
    keys: ["driver", "cell", "wire"],
    ordinary: { driver: 2, cell: 0.5, wire: 100 },
    altered: { driver: 4, cell: 1, wire: 80 },
    rejections: [{ driver: 1, cell: 2, wire: 100 }, { driver: 2, cell: 0.5, wire: 0 }],
    build(inputs) {
      const v = finiteInputs(inputs, ["driver", "cell", "wire"]);
      return potentiometer(v.driver, v.cell, v.wire);
    },
  },
];

/** Independent nodal authority for four source-declared bridge arms. The
 * display compiler checks the resulting signed branch currents separately. */
function declaredBridgeValues(v: Record<string, number>): Record<string, number> {
  for (const key of ["r", "P", "Q", "R", "S", "Rg"]) positive(v[key]!, key);
  if (v.emf === 0) throw new Error("a bridge source needs a signed nonzero emf");
  const p = 1 / v.P, q = 1 / v.Q, a = 1 / v.R, b = 1 / v.S, g = 1 / v.Rg, s = 1 / v.r;
  const matrix = [[s + q + b, -q, -b, v.emf * s], [-q, p + q + g, -g, 0], [-b, -g, a + b + g, 0]];
  for (let column = 0; column < 3; column += 1) {
    const pivot = matrix[column]![column]!;
    if (!(Math.abs(pivot) > 1e-12)) throw new Error("bridge is singular or ill-conditioned");
    for (let row = column + 1; row < 3; row += 1) {
      const ratio = matrix[row]![column]! / pivot;
      for (let j = column; j < 4; j += 1) matrix[row]![j] = matrix[row]![j]! - ratio * matrix[column]![j]!;
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let value = matrix[row]![3]!;
    for (let j = row + 1; j < 3; j += 1) value -= matrix[row]![j]! * x[j]!;
    x[row] = value / matrix[row]![row]!;
  }
  const [vr, vt, vb] = x as [number, number, number];
  const i = (v.emf - vr) / v.r;
  const detector = (vt - vb) / v.Rg;
  return { I_S: i, I_WL: i, I_WR: i, I_LT: -vt / v.P, I_TR: (vt - vr) / v.Q, I_LB: -vb / v.R, I_BR: (vb - vr) / v.S, I_G: Math.abs(detector) < 1e-12 ? 0 : detector, V_R: vr, V_T: vt, V_B: vb };
}

function declaredBridge(v: Record<string, number>): SceneDocument {
  return networkScene("dc.wheatstone_declared", "Four independently supplied arms. Source emf is signed in the SL-to-SR direction. G is an explicit detector; crossings add no node. Detector zero is certified only when the arm ratios balance.", "solved", declaredBridgeValues(v), [
    { id: "L", at: [0, 1] }, { id: "T", at: [2, 2] }, { id: "R", at: [4, 1] }, { id: "B", at: [2, 0] }, { id: "SL", at: [0, -1.2] }, { id: "SR", at: [4, -1.2] },
  ], [
    { id: "WL", from: "L", to: "SL", kind: "wire", label: "" },
    { id: "S", from: "SL", to: "SR", kind: "source", resistance: v.r, emf: v.emf, label: `${v.emf} V, r` },
    { id: "WR", from: "SR", to: "R", kind: "wire", label: "" },
    ...([["LT", "L", "T", "P", [0, 1], [2, 2]], ["TR", "T", "R", "Q", [2, 2], [4, 1]], ["LB", "L", "B", "R", [0, 1], [2, 0]], ["BR", "B", "R", "S", [2, 0], [4, 1]]] as const).map(([id, from, to, key, start, end]) => ({ id, from, to, kind: "resistor" as const, resistance: v[key], label: key, labelOffset: armLabelOffset([...start], [...end]) })),
    { id: "G", from: "T", to: "B", kind: "detector", resistance: v.Rg, label: "Rg" },
  ]);
}

function declaredModel(spec: {
  name: string; topics: TopicBinding[]; roles: Record<string, InputRole>; assumptions: string[];
  ordinary: Record<string, number>; altered: Record<string, number>; rejections: Record<string, number>[];
  scalar: (v: Record<string, number>) => Record<string, number>; figure: (v: Record<string, number>) => SceneDocument;
}): DcNetworkModel {
  const keys = Object.keys(spec.roles);
  registerModelAdmission({ name: spec.name, roles: spec.roles, assumptions: spec.assumptions, scalar: (v) => spec.scalar(finiteInputs(v, keys)) });
  return { name: spec.name, scope: "solved", assumptions: spec.assumptions.join("; "), topics: spec.topics, keys, ordinary: spec.ordinary, altered: spec.altered, rejections: spec.rejections, build: (v) => spec.figure(finiteInputs(v, keys)) };
}

dcNetworkModels.push(declaredModel({
  name: "dc.wheatstone_declared",
  topics: [{ topicId: "physics|12|wheatstone-and-metre-bridge", packet: "CH-02c", chapter, remaining: "Dependent sources and nonlinear detector laws require a separately declared model." }, { topicId: "physics|12|mixed-resistor-networks", packet: "CH-02a", chapter, remaining: "Source-declared four-arm bridge covers irreducible networks; an omitted branch cannot be reconstructed." }],
  roles: { emf: { role: "source emf", unit: "V" }, r: { role: "source internal resistance", unit: "ohm" }, P: { role: "upper left arm resistance", unit: "ohm" }, Q: { role: "upper right arm resistance", unit: "ohm" }, R: { role: "lower left arm resistance", unit: "ohm" }, S: { role: "lower right arm resistance", unit: "ohm" }, Rg: { role: "galvanometer resistance", unit: "ohm" } },
  assumptions: ["four-arm bridge"],
  ordinary: { emf: 11.8, r: 1, P: 5, Q: 25 / 6, R: 5, S: 10, Rg: 5 },
  altered: { emf: -11.8, r: 1, P: 5, Q: 25 / 6, R: 5, S: 10, Rg: 5 },
  rejections: [{ emf: 12, r: 1, P: 2, Q: 4, R: 3, S: 4, Rg: 0 }],
  scalar: declaredBridgeValues, figure: declaredBridge,
}));

/** Complete null apparatus. Each panel is a separate switched observation
 * using the same declared wire potential gradient; no pixel length is SI. */
function potPanel(prefix: string, driver: number, emf: number, wire: number, y: number, loaded = false): { entities: ReturnType<typeof entity>[]; constructions: ReturnType<typeof construction>[] } {
  const x = 4 * emf / driver;
  const entities: ReturnType<typeof entity>[] = [], constructions: ReturnType<typeof construction>[] = [];
  const terminals = new Map<string, string>();
  const at = (p: [number, number]): string => {
    const key = p.join(","), existing = terminals.get(key);
    if (existing) return existing;
    const id = `${prefix}_terminal${terminals.size}`;
    terminals.set(key, id); entities.push(entity(id, "point", "electrical terminal")); constructions.push(construction(id, "point", { x: p[0], y: p[1] }, [id])); return id;
  };
  const symbol = (id: string, kind: string, a: [number, number], b: [number, number], label: string): void => {
    const start = at(a), end = at(b), full = `${prefix}_${id}`;
    entities.push({ ...entity(full, "component", id), label }); constructions.push(construction(full, "symbol", { symbol: kind, start, end }, [full]));
  };
  const line = (id: string, points: [number, number][]): void => {
    const start = at(points[0]!), end = at(points.at(-1)!), full = `${prefix}_${id}`;
    entities.push(entity(full, "connector", "wire")); constructions.push(construction(full, "connect", { start, end, ...(points.length > 2 ? { via: points.slice(1, -1).map(([x, y]) => ({ x, y })) } : {}) }, [full]));
  };
  symbol("wireLeft", "resistor", [0, y], [x, y], "wire l"); symbol("wireRight", "resistor", [x, y], [4, y], "wire L-l");
  line("returnLeft", [[0, y], [0, y - 0.8], [1.5, y - 0.8]]); symbol("driver", "battery", [2.5, y - 0.8], [1.5, y - 0.8], "driver"); line("returnRight", [[2.5, y - 0.8], [4, y - 0.8], [4, y]]);
  line("testLead", [[0, y], [0, y + 0.8]]); symbol("testCell", "cell", [1, y + 0.8], [0, y + 0.8], loaded ? "loaded cell" : "test cell"); symbol("detector", "galvanometer", [1, y + 0.8], [x, y], "G = 0");
  if (loaded) { symbol("load", "resistor", [0, y + 1.4], [1, y + 1.4], "load R"); line("loadLeadLeft", [[0, y + 0.8], [0, y + 1.4]]); line("loadLeadRight", [[1, y + 0.8], [1, y + 1.4]]); }
  return { entities, constructions };
}

function potLoadedValues(v: Record<string, number>): Record<string, number> {
  for (const key of ["driver", "wire", "load", "lOpen", "lLoaded"]) positive(v[key]!, key);
  if (!(v.lLoaded <= v.lOpen && v.lOpen < v.wire)) throw new Error("separate open/loaded nulls must be interior and loaded voltage cannot exceed emf");
  return { E: v.driver * v.lOpen / v.wire, V: v.driver * v.lLoaded / v.wire, r: v.load * (v.lOpen / v.lLoaded - 1), gradient: v.driver / v.wire };
}
dcNetworkModels.push(declaredModel({ name: "dc.potentiometer_loaded", assumptions: ["uniform potentiometer wire", "same gradient", "separate open and loaded nulls"],
  roles: { driver: { role: "wire voltage", unit: "V" }, wire: { role: "wire length", unit: "cm" }, lOpen: { role: "open cell null length", unit: "cm" }, lLoaded: { role: "loaded cell null length", unit: "cm" }, load: { role: "cell load resistance", unit: "ohm" } },
  topics: [{ topicId: "physics|12|potentiometer", chapter, packet: "CH-02c", remaining: "Uniform wire voltage is supplied. Driver internal resistance and calibration drift need their own source inputs." }],
  ordinary: { driver: 4, wire: 100, lOpen: 50, lLoaded: 40, load: 8 }, altered: { driver: 6, wire: 120, lOpen: 60, lLoaded: 30, load: 5 }, rejections: [{ driver: 4, wire: 100, lOpen: 40, lLoaded: 50, load: 8 }], scalar: potLoadedValues,
  figure(v) { const c = potLoadedValues(v), a = potPanel("open", v.driver, c.E, v.wire, 0), b = potPanel("loaded", v.driver, c.V, v.wire, 3, true); return sceneDocument({ model: "dc.potentiometer_loaded", family: "circuit_network", scope: "solved", assumptions: "Separate open and loaded null observations on a uniform wire at the same gradient. Cell load is across its two terminals.", certified: c, entities: [...a.entities, ...b.entities], constructions: [...a.constructions, ...b.constructions] }); },
}));

function potComparisonValues(v: Record<string, number>): Record<string, number> {
  for (const key of ["driver", "wire", "l1", "l2"]) positive(v[key]!, key);
  if (v.l1 >= v.wire || v.l2 >= v.wire) throw new Error("comparison nulls must be interior");
  return { E1: v.driver * v.l1 / v.wire, E2: v.driver * v.l2 / v.wire, ratio: v.l1 / v.l2, gradient: v.driver / v.wire };
}
dcNetworkModels.push(declaredModel({ name: "dc.potentiometer_comparison", assumptions: ["uniform potentiometer wire", "same gradient", "separate null observations"],
  roles: { driver: { role: "wire voltage", unit: "V" }, wire: { role: "wire length", unit: "cm" }, l1: { role: "first cell null length", unit: "cm" }, l2: { role: "second cell null length", unit: "cm" } },
  topics: [{ topicId: "physics|12|potentiometer", chapter, packet: "CH-02c", remaining: "The two cell nulls require the same supplied gradient; no driver calibration is inferred." }],
  ordinary: { driver: 4, wire: 100, l1: 25, l2: 60 }, altered: { driver: 6, wire: 120, l1: 80, l2: 40 }, rejections: [{ driver: 4, wire: 100, l1: 25, l2: 100 }], scalar: potComparisonValues,
  figure(v) { const c = potComparisonValues(v), a = potPanel("first", v.driver, c.E1, v.wire, 0), b = potPanel("second", v.driver, c.E2, v.wire, 3); return sceneDocument({ model: "dc.potentiometer_comparison", family: "circuit_network", scope: "solved", assumptions: "Two separate null circuits on the same declared potential gradient.", certified: c, entities: [...a.entities, ...b.entities], constructions: [...a.constructions, ...b.constructions] }); },
}));

const cellRoles: Record<string, InputRole> = { e1: { role: "first signed cell emf", unit: "V" }, r1: { role: "first internal resistance", unit: "ohm" }, e2: { role: "second signed cell emf", unit: "V" }, r2: { role: "second internal resistance", unit: "ohm" }, R: { role: "load resistance", unit: "ohm" } };
function cellPackValues(v: Record<string, number>, parallel: boolean): Record<string, number> {
  positive(v.R, "R");
  if (v.r1 < 0 || v.r2 < 0) throw new Error("internal resistances cannot be negative");
  if (v.e1 === 0 || v.e2 === 0) throw new Error("each declared cell emf is nonzero and signed");
  if (parallel && v.r1 === 0 && v.r2 === 0) throw new Error(v.e1 === v.e2 ? "ideal parallel current split is indeterminate" : "ideal parallel source voltages are incompatible");
  const V = parallel ? v.r1 === 0 ? v.e1 : v.r2 === 0 ? v.e2 : (v.e1 / v.r1 + v.e2 / v.r2) / (1 / v.r1 + 1 / v.r2 + 1 / v.R) : (v.e1 + v.e2) * v.R / (v.r1 + v.r2 + v.R);
  const i1 = parallel ? v.r1 === 0 ? V / v.R - (v.e2 - V) / v.r2 : (v.e1 - V) / v.r1 : V / v.R;
  const i2 = parallel ? v.r2 === 0 ? V / v.R - i1 : (v.e2 - V) / v.r2 : i1;
  return { V, I_S1: i1, I_S2: i2, I_R: V / v.R, P_source1: v.e1 * i1, P_source2: v.e2 * i2, P_internal1: i1 ** 2 * v.r1, P_internal2: i2 ** 2 * v.r2, P_load: V ** 2 / v.R };
}
for (const parallel of [false, true]) {
  const name = parallel ? "dc.cells_parallel" : "dc.cells_signed";
  dcNetworkModels.push(declaredModel({ name, roles: cellRoles, assumptions: [parallel ? "parallel cells" : "series cells", "signed source polarity"],
    topics: [{ topicId: "physics|12|cell-combinations", packet: "CH-02a", chapter, remaining: "Ideal unequal sources in parallel reject; compatible ideal voltage-source constraints need shared MNA support." }, { topicId: "physics|12|electrical-energy-and-power", packet: "CH-02b", chapter, remaining: "This signed steady network balances source, internal, and external load power. Time-varying loads require explicit interval laws." }],
    ordinary: parallel ? { e1: 10, r1: 2, e2: 4, r2: 1, R: 2 } : { e1: 10, r1: 1, e2: -4, r2: 1, R: 4 },
    altered: parallel ? { e1: 8, r1: 2, e2: -4, r2: 1, R: 2 } : { e1: -6, r1: 1, e2: -3, r2: 2, R: 3 },
    rejections: [parallel ? { e1: 10, r1: 0, e2: 4, r2: 0, R: 2 } : { e1: 10, r1: -1, e2: 4, r2: 0, R: 2 }], scalar: (v) => cellPackValues(v, parallel),
    figure: (v) => networkScene(name, "Declared signed source polarity with passive internal and load resistances. Source supplied power is E times the declared branch current; negative power is charging.", "solved", cellPackValues(v, parallel), parallel ? [{ id: "A", at: [0, 0] }, { id: "B", at: [4, 0] }] : [{ id: "A", at: [0, 0] }, { id: "B", at: [2, 0] }, { id: "C", at: [4, 0] }], [
      { id: "S1", from: "A", to: "B", kind: "source", emf: v.e1, resistance: v.r1, label: "E1, r1" },
      { id: "S2", from: parallel ? "A" : "B", to: parallel ? "B" : "C", kind: "source", emf: v.e2, resistance: v.r2, label: "E2, r2" },
      { id: "R", from: parallel ? "B" : "C", to: "A", kind: "resistor", resistance: v.R, label: "R" },
    ]),
  }));
}

function metreObservationValues(v: Record<string, number>): Record<string, number> {
  for (const key of ["known", "wire", "area", "sampleLength"]) positive(v[key]!, key);
  if (!(v.balance > 0 && v.balance < v.wire)) throw new Error("a finite bridge ratio needs an interior observed null");
  if ((v.knownLeft !== 0 && v.knownLeft !== 1) || v.cLeft < 0 || v.cRight < 0) throw new Error("gap placement and equivalent end lengths must be declared");
  const left = v.balance + v.cLeft, right = v.wire - v.balance + v.cRight;
  const unknown = v.known * (v.knownLeft ? right / left : left / right);
  return { balance: v.balance, unknown, rho: unknown * v.area / v.sampleLength, correctedLeft: left, correctedRight: right };
}

dcNetworkModels.push(declaredModel({ name: "dc.metre_bridge_observed", assumptions: ["uniform bridge wire", "equivalent end lengths", "null observation"],
  roles: { known: { role: "known resistance", unit: "ohm" }, balance: { role: "observed balance length", unit: "cm" }, wire: { role: "bridge wire length", unit: "cm" }, cLeft: { role: "left equivalent end length", unit: "cm" }, cRight: { role: "right equivalent end length", unit: "cm" }, knownLeft: { role: "known gap on left", unit: "1" }, area: { role: "sample cross-section area", unit: "m^2" }, sampleLength: { role: "sample length", unit: "m" } },
  topics: [{ topicId: "physics|12|metre-bridge", packet: "CH-02c", chapter, remaining: "Equivalent end-length data are explicit. A nonuniform bridge wire needs a resistance integral, not an assumed length ratio." }],
  ordinary: { known: 2, balance: 25, wire: 100, cLeft: 5, cRight: 5, knownLeft: 1, area: 0.03, sampleLength: 5 },
  altered: { known: 2, balance: 75, wire: 100, cLeft: 5, cRight: 5, knownLeft: 0, area: 0.03, sampleLength: 5 },
  rejections: [{ known: 2, balance: 0, wire: 100, cLeft: 5, cRight: 5, knownLeft: 1, area: 0.03, sampleLength: 5 }], scalar: metreObservationValues,
  figure(v) {
    const x = 4 * v.balance / v.wire;
    const entities = [entity("wire", "polyline", "uniform bridge wire"), { ...entity("known", "component", "known gap"), label: "R" }, { ...entity("unknown", "component", "unknown gap"), label: "X" }, { ...entity("detector", "component", "null detector"), label: "G = 0" }, entity("jockey", "point", "observed interior null"), { ...entity("leftEnd", "point", "left equivalent end correction"), label: "cL" }, { ...entity("rightEnd", "point", "right equivalent end correction"), label: "cR" }];
    const gaps = [{ id: v.knownLeft ? "known" : "unknown", a: 0, b: 2 }, { id: v.knownLeft ? "unknown" : "known", a: 2, b: 4 }];
    return sceneDocument({ model: "dc.metre_bridge_observed", family: "circuit_network", scope: "solved", assumptions: "Uniform bridge wire with supplied equivalent end lengths and observed null. Schematic x position preserves the observed fraction; physical sample area/length use SI only.", certified: metreObservationValues(v), entities,
      constructions: [construction("wire", "polyline", { points: [[0, 0], [4, 0]] }, ["wire"]), ...gaps.map((gap) => construction(gap.id, "symbol", { symbol: "resistor", start: { x: gap.a, y: 1.3 }, end: { x: gap.b, y: 1.3 } }, [gap.id])), construction("detector", "symbol", { symbol: "galvanometer", start: { x: 2, y: 1.3 }, end: { x, y: 0 } }, ["detector"]), construction("jockey", "point", { x, y: 0 }, ["jockey"]), construction("leftEnd", "point", { x: 0, y: -0.4 }, ["leftEnd"]), construction("rightEnd", "point", { x: 4, y: -0.4 }, ["rightEnd"])],
    });
  },
}));

function twoLoopValues(v: Record<string, number>): Record<string, number> {
  for (const key of ["r1", "r2", "Rm", "Ra"]) positive(v[key]!, key);
  if (v.e1 === 0 || v.e2 === 0) throw new Error("source emfs are explicit signed nonzero values");
  const a = 1 / v.r1 + 1 / v.Rm, b = 1 / v.r2 + 1 / v.Rm + 1 / v.Ra, m = 1 / v.Rm, determinant = a * b - m * m;
  const vb = (v.e1 / v.r1 * b + m * v.e2 / v.r2) / determinant, vc = (a * v.e2 / v.r2 + m * v.e1 / v.r1) / determinant;
  return { V_B: vb, V_C: vc, I_S1: (v.e1 - vb) / v.r1, I_S2: (v.e2 - vc) / v.r2, I_M: (vb - vc) / v.Rm, I_CA: vc / v.Ra };
}
dcNetworkModels.push(declaredModel({ name: "dc.kirchhoff_declared", assumptions: ["two-loop network", "declared junctions", "signed source polarity"],
  roles: { e1: { role: "first signed source emf", unit: "V" }, e2: { role: "second signed source emf", unit: "V" }, r1: { role: "first internal resistance", unit: "ohm" }, r2: { role: "second internal resistance", unit: "ohm" }, Rm: { role: "shared resistance", unit: "ohm" }, Ra: { role: "return resistance", unit: "ohm" } },
  topics: [{ topicId: "physics|12|kirchhoffs-laws", chapter, packet: "CH-02a", remaining: "Dependent/non-ohmic sources require additional constitutive laws. Missing branches/junctions are not inferred." }],
  ordinary: { e1: 12, e2: -6, r1: 2, r2: 3, Rm: 4, Ra: 6 }, altered: { e1: -8, e2: 4, r1: 1, r2: 2, Rm: 3, Ra: 2 }, rejections: [{ e1: 12, e2: -6, r1: 2, r2: 3, Rm: 0, Ra: 6 }], scalar: twoLoopValues,
  figure: (v) => networkScene("dc.kirchhoff_declared", "Two explicit independent loops with shared resistor and declared source polarities. Branches connect only the named nodes.", "solved", twoLoopValues(v), [{ id: "A", at: [0, 0] }, { id: "B", at: [0, 2] }, { id: "C", at: [3, 0] }], [{ id: "S1", from: "A", to: "B", kind: "source", emf: v.e1, resistance: v.r1, label: "E1, r1" }, { id: "S2", from: "A", to: "C", kind: "source", emf: v.e2, resistance: v.r2, label: "E2, r2" }, { id: "M", from: "B", to: "C", kind: "resistor", resistance: v.Rm, label: "Rm" }, { id: "CA", from: "C", to: "A", kind: "resistor", resistance: v.Ra, label: "Ra" }]),
}));

const ohmRole = (role: string): InputRole => ({ role, unit: "ohm" });
const emfRole = (role: string): InputRole => ({ role, unit: "V" });
const legacyAdmissions: Record<string, { roles: Record<string, InputRole>; assumptions: string[] }> = {
  "dc.series": { roles: { emf: emfRole("source emf"), rInternal: ohmRole("source internal resistance"), r1: ohmRole("first load resistance"), r2: ohmRole("second load resistance") }, assumptions: ["series connections"] },
  "dc.parallel": { roles: { emf: emfRole("source emf"), rInternal: ohmRole("source internal resistance"), r6: ohmRole("first load resistance"), r3: ohmRole("second load resistance") }, assumptions: ["parallel connections"] },
  "dc.mixed": { roles: { emf: emfRole("source emf"), rSource: ohmRole("source internal resistance"), rSeries: ohmRole("series resistance"), rA: ohmRole("first parallel resistance"), rB: ohmRole("second parallel resistance") }, assumptions: ["declared series-parallel connections"] },
  "dc.cells": { roles: { e1: emfRole("first cell emf"), e2: emfRole("second cell emf"), r1: ohmRole("first internal resistance"), r2: ohmRole("second internal resistance"), R: ohmRole("load resistance") }, assumptions: ["aiding series cells"] },
  "dc.kirchhoff": { roles: { e1: emfRole("first source emf"), e2: emfRole("second source emf") }, assumptions: ["two-loop network", "unit resistances"] },
  "dc.metre_bridge": { roles: { known: ohmRole("known resistance"), unknown: ohmRole("unknown resistance"), wire: { role: "wire length", unit: "cm" } }, assumptions: ["uniform bridge wire", "zero end corrections"] },
  "dc.potentiometer": { roles: { driver: emfRole("wire voltage"), cell: emfRole("test cell emf"), wire: { role: "wire length", unit: "cm" } }, assumptions: ["uniform potentiometer wire"] },
};
for (const [name, spec] of Object.entries(legacyAdmissions)) {
  const model = dcNetworkModels.find((entry) => entry.name === name)!;
  registerModelAdmission({ name, ...spec, scalar: (v) => model.build(finiteInputs(v, model.keys)).source.certified as Record<string, number> });
}

registerModelAdmission({ name: "dc.ohm", roles: { emf: { role: "source emf", unit: "V" }, rInternal: { role: "source internal resistance", unit: "ohm" }, R: { role: "load resistance", unit: "ohm" } }, assumptions: ["declared terminals"], scalar(v) { const d = ohm(v.emf!, v.rInternal!, v.R!); return d.source.certified as Record<string, number>; } });
dcNetworkModels.push(declaredModel({ name: "dc.ohm_open", assumptions: ["declared terminals", "open load"],
  roles: { emf: { role: "source emf", unit: "V" }, rInternal: { role: "source internal resistance", unit: "ohm" } },
  topics: [{ topicId: "physics|12|ohms-law-and-resistance", chapter, packet: "CH-02a", remaining: "R=0 is an explicit wire; infinite R is an explicit open branch. A source short with no resistance rejects as singular." }, { topicId: "physics|12|resistor-combinations", chapter, packet: "CH-02a", remaining: "The open branch certifies zero current. Unspecified connectivity is not inferred." }],
  ordinary: { emf: 12, rInternal: 0 }, altered: { emf: -8, rInternal: 2 }, rejections: [{ emf: 0, rInternal: 1 }],
  scalar(v) { if (v.emf === 0 || v.rInternal < 0) throw new Error("signed source and passive internal resistance required"); return { I_S: 0, I_R: 0, V: v.emf }; },
  figure(v) { if (v.emf === 0 || v.rInternal < 0) throw new Error("signed source and passive internal resistance required"); return networkScene("dc.ohm_open", "Explicit open load has zero current and source voltage across its distinct terminals.", "solved", { I_S: 0, I_R: 0, V: v.emf }, [{ id: "A", at: [0, 0] }, { id: "B", at: [4, 0] }], [{ id: "S", from: "A", to: "B", kind: "source", resistance: v.rInternal, emf: v.emf, label: "E, r" }, { id: "R", from: "B", to: "A", kind: "open", label: "open" }]); },
}));
