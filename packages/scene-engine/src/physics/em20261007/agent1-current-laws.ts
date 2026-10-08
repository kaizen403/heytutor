// allow: SIZE_OK — ten declarative model rows plus one small figure builder
// each; the packet's ownership contract fixes this file set (this module or
// this module plus agent1-admission.ts), so a further split is not available.
import {
  cellCertified,
  currentDensityCertified,
  driftCertified,
  ivDeclaredCertified,
  ivOhmicCertified,
  jouleCertified,
  powerCertified,
  resistivityCertified,
  resistanceCertified,
  temperatureCertified,
  currentVariants,
} from "./agent1-admission";
import { construction, entity, finiteInputs, sceneDocument, type DeclaredScope, type TopicBinding } from "./sceneKit";
import type { SceneAnnotation, SceneConstruction, SceneDocument, SceneEntity } from "../../types";

export interface CurrentLawModel {
  name: string;
  family: string;
  scope: DeclaredScope;
  assumptions: string;
  topics: TopicBinding[];
  keys: readonly string[];
  ordinary: Record<string, number>;
  altered: Record<string, number>;
  rejections: Record<string, number>[];
  build(inputs: Record<string, unknown>): SceneDocument;
}

const chapter = "Current Electricity";

function labeled(id: string, kind: string, role: string, label: string): SceneEntity {
  return { ...entity(id, kind, role), label };
}

function polarityAnnotation(id: string, target: string): SceneAnnotation {
  return { id, kind: "polarity", targetIds: [target], text: "+-" };
}

/** Drift picture: conductor bar, cross-section face, conventional current
 * arrow, and electron drift arrow pointing the opposite way. */
function driftScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.drift", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("body", "polygon", "conductor", "conductor"),
      labeled("section", "polyline", "cross-section face", "A"),
      labeled("current", "vector", "conventional current", "I"),
      labeled("drift", "vector", "electron drift velocity", "vd"),
    ],
    constructions: [
      construction("body", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 1.2 }, ["body"]),
      construction("section", "polyline", { points: [[2, -0.6], [2, 0.6]] }, ["section"]),
      construction("current", "vector", { start: { x: -1.6, y: 1.1 }, end: { x: 1.6, y: 1.1 } }, ["current"]),
      construction("drift", "vector", { start: { x: 1.6, y: -1.1 }, end: { x: -1.6, y: -1.1 } }, ["drift"]),
    ],
  });
}

/** Current-density picture: bar, cross-section face, and the current, applied
 * field, and drift velocity arrows along the same reference direction. */
function currentDensityScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.current_density", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("body", "polygon", "conductor", "conductor"),
      labeled("section", "polyline", "cross-section face", "A"),
      labeled("current", "vector", "current", "I"),
      labeled("field", "vector", "applied electric field", "E"),
      labeled("drift", "vector", "drift velocity", "vd"),
    ],
    constructions: [
      construction("body", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 1.2 }, ["body"]),
      construction("section", "polyline", { points: [[2, -0.6], [2, 0.6]] }, ["section"]),
      construction("current", "vector", { start: { x: -1.6, y: 1.1 }, end: { x: 1.6, y: 1.1 } }, ["current"]),
      construction("field", "vector", { start: { x: -1.6, y: -1.1 }, end: { x: 1.6, y: -1.1 } }, ["field"]),
      construction("drift", "vector", { start: { x: -1.6, y: -1.9 }, end: { x: 1.6, y: -1.9 } }, ["drift"]),
    ],
  });
}

/** Power picture: battery with polarity marks feeding one load resistor; the
 * current arrow shows the circuit current and the dimension across the load
 * is the voltage V. */
function powerScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return {
    ...sceneDocument({
      model: "ce.power", family: "circuit_network", scope: "solved",
      assumptions,
      certified,
      entities: [
        entity("source", "component", "battery"),
        labeled("load", "component", "load resistor", "R"),
        labeled("current", "vector", "circuit current", "I"),
        labeled("loadV", "dimension", "load voltage", "V"),
      ],
      constructions: [
        construction("source", "symbol", { symbol: "battery", start: { x: -2, y: 0 }, end: { x: -1.2, y: 0 } }, ["source"]),
        construction("load", "symbol", { symbol: "resistor", start: { x: -1.2, y: 0 }, end: { x: 1.2, y: 0 } }, ["load"]),
        construction("current", "vector", { start: { x: -1, y: -1 }, end: { x: 1, y: -1 } }, ["current"]),
        construction("loadV", "dimension", { start: { x: -1.2, y: 0 }, end: { x: 1.2, y: 0 } }, ["loadV"]),
      ],
    }),
    annotations: [polarityAnnotation("sourcePolarity", "source")],
  };
}

/** Joule-heating picture: load resistor, constant current arrow, and a heat
 * arrow pointing away from the resistor over the stated time interval. */
function jouleScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.joule", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("load", "component", "heating resistor", "R"),
      labeled("current", "vector", "constant current", "I"),
      labeled("heat", "vector", "heat flow", "H"),
    ],
    constructions: [
      construction("load", "symbol", { symbol: "resistor", start: { x: -1.2, y: 0 }, end: { x: 1.2, y: 0 } }, ["load"]),
      construction("current", "vector", { start: { x: -1, y: -1 }, end: { x: 1, y: -1 } }, ["current"]),
      construction("heat", "vector", { start: { x: 0, y: 0.6 }, end: { x: 0.5, y: 1.3 } }, ["heat"]),
    ],
  });
}

/** Resistivity picture: one material sample bar carrying its resistivity and
 * the reciprocal conductivity; no geometry is inferred from the bar. */
function resistivityScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.resistivity", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("body", "polygon", "material sample", "ρ"),
      labeled("sigmaMark", "point", "conductivity", "σ = 1/ρ"),
    ],
    constructions: [
      construction("body", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 1.2 }, ["body"]),
      construction("sigmaMark", "point", { x: 0, y: -1.3 }, ["sigmaMark"]),
    ],
  });
}

/** Resistance-from-dimensions picture: uniform wire with the length marked by
 * a dimension, the cross-section face marked at one end, and the material
 * resistivity labelled. */
function resistanceScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.resistance", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("wire", "polygon", "uniform wire", "ρ"),
      labeled("lengthMark", "dimension", "wire length", "L"),
      labeled("section", "polyline", "cross-section face", "A"),
    ],
    constructions: [
      construction("wire", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 1 }, ["wire"]),
      construction("lengthMark", "dimension", { start: { x: -2, y: -0.5 }, end: { x: 2, y: -0.5 } }, ["lengthMark"]),
      construction("section", "polyline", { points: [[2, -0.5], [2, 0.5]] }, ["section"]),
    ],
  });
}

/** Temperature-dependence picture: the reference resistor with the
 * temperature-rise arrow and the explicit coefficient label. */
function temperatureScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return sceneDocument({
    model: "ce.temperature", family: "circuit_network", scope: "solved",
    assumptions,
    certified,
    entities: [
      labeled("wire", "component", "reference resistor", "R₀"),
      labeled("rise", "vector", "temperature rise", "ΔT"),
      labeled("alphaMark", "point", "temperature coefficient", "α"),
    ],
    constructions: [
      construction("wire", "symbol", { symbol: "resistor", start: { x: -1.2, y: 0 }, end: { x: 1.2, y: 0 } }, ["wire"]),
      construction("rise", "vector", { start: { x: 0, y: 0.7 }, end: { x: 0, y: 1.5 } }, ["rise"]),
      construction("alphaMark", "point", { x: 0.7, y: 1.1 }, ["alphaMark"]),
    ],
  });
}

/** Cell picture: cell glyph with polarity marks and emf label, explicit
 * internal resistance in series, named terminals A (+) and B (-), the
 * external discharge current arrow, and the terminal-voltage dimension. */
function cellScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  return {
    ...sceneDocument({
      model: "ce.cell", family: "circuit_network", scope: "solved",
      assumptions,
      certified,
      entities: [
        labeled("cell", "component", "cell emf", "E"),
        labeled("internal", "component", "internal resistance", "r"),
        entity("lead", "component", "terminal lead"),
        labeled("terminalA", "point", "positive terminal", "A"),
        labeled("terminalB", "point", "negative terminal", "B"),
        labeled("current", "vector", "discharge current", "I"),
        labeled("terminalV", "dimension", "terminal voltage", "V"),
      ],
      constructions: [
        construction("cell", "symbol", { symbol: "cell", start: { x: -2.2, y: 0 }, end: { x: -1.4, y: 0 } }, ["cell"]),
        construction("internal", "symbol", { symbol: "resistor", start: { x: -1.4, y: 0 }, end: { x: -0.6, y: 0 } }, ["internal"]),
        construction("lead", "symbol", { symbol: "wire", start: { x: -0.6, y: 0 }, end: { x: 0.6, y: 0 } }, ["lead"]),
        construction("terminalA", "point", { x: -2.2, y: 0 }, ["terminalA"]),
        construction("terminalB", "point", { x: 0.6, y: 0 }, ["terminalB"]),
        construction("current", "vector", { start: { x: -1.6, y: -1 }, end: { x: 0, y: -1 } }, ["current"]),
        construction("terminalV", "dimension", { start: { x: -2.2, y: 0 }, end: { x: 0.6, y: 0 } }, ["terminalV"]),
      ],
    }),
    annotations: [polarityAnnotation("cellPolarity", "cell")],
  };
}

function plotAxes(yMax: number): { entities: SceneEntity[]; constructions: SceneConstruction[] } {
  return {
    entities: [
      entity("axes", "axes", "I-V axes"),
      { ...labeled("iName", "point", "current axis name", "I (A)"), provenance: { hideMark: true } },
      { ...labeled("vName", "point", "voltage axis name", "V (V)"), provenance: { hideMark: true } },
    ],
    constructions: [
      construction("axes", "axes", { xMin: 0, xMax: 3, yMin: 0, yMax }, ["axes"]),
      construction("iName", "point", { x: 3, y: 0 }, ["iName"]),
      construction("vName", "point", { x: 0, y: yMax }, ["vName"]),
    ],
  };
}

/** Ohmic V-I graph: named axes with units, the straight characteristic
 * through the origin, and the observed points marked on it. */
function ivOhmicScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  const yMax = Math.max(1, certified.v1 ?? 0, certified.v2 ?? 0) + 1;
  const axes = plotAxes(yMax);
  return sceneDocument({
    model: "ce.iv_ohmic", family: "state_plot", scope: "solved",
    assumptions,
    certified,
    entities: [
      ...axes.entities,
      entity("curve", "polyline", "ohmic characteristic"),
      entity("observed1", "point", "observed point"),
      entity("observed2", "point", "observed point"),
    ],
    constructions: [
      ...axes.constructions,
      construction("curve", "polyline", { points: [[0, 0], [1, certified.v1 ?? 0], [2, certified.v2 ?? 0]] }, ["curve"]),
      construction("observed1", "point", { x: 1, y: certified.v1 ?? 0 }, ["observed1"]),
      construction("observed2", "point", { x: 2, y: certified.v2 ?? 0 }, ["observed2"]),
    ],
  });
}

/** Declared non-ohmic V-I graph: named axes with units and the supplied
 * points only — no joining curve is invented between them. */
function ivDeclaredScene(certified: Record<string, number>, assumptions: string): SceneDocument {
  const yMax = Math.max(1, certified.y1 ?? 0, certified.y2 ?? 0) + 1;
  const axes = plotAxes(yMax);
  return sceneDocument({
    model: "ce.iv_declared", family: "state_plot", scope: "qualitative",
    assumptions,
    certified: {},
    entities: [
      ...axes.entities,
      entity("observed0", "point", "supplied point"),
      entity("observed1", "point", "supplied point"),
      entity("observed2", "point", "supplied point"),
    ],
    constructions: [
      ...axes.constructions,
      construction("observed0", "point", { x: 0, y: 0 }, ["observed0"]),
      construction("observed1", "point", { x: 1, y: certified.y1 ?? 0 }, ["observed1"]),
      construction("observed2", "point", { x: 2, y: certified.y2 ?? 0 }, ["observed2"]),
    ],
  });
}

function model(spec: {
  name: string;
  family: string;
  scope: DeclaredScope;
  assumptions: string;
  topics: TopicBinding[];
  keys: readonly string[];
  ordinary: Record<string, number>;
  altered: Record<string, number>;
  rejections: Record<string, number>[];
  certified: (values: Record<string, number>) => Record<string, number>;
  figure: (certified: Record<string, number>, assumptions: string, inputs: Record<string, number>) => SceneDocument;
}): CurrentLawModel {
  return {
    name: spec.name,
    family: spec.family,
    scope: spec.scope,
    assumptions: spec.assumptions,
    topics: spec.topics,
    keys: spec.keys,
    ordinary: spec.ordinary,
    altered: spec.altered,
    rejections: spec.rejections,
    build(inputs) {
      const values = finiteInputs(inputs, spec.keys);
      return spec.figure(spec.certified(values), spec.assumptions, values);
    },
  };
}

export const currentLawModels: CurrentLawModel[] = [
  model({
    name: "ce.drift",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Uniform drift in a straight conductor. I = n e A v_d. e is an explicit input, not a hidden constant. The conventional current arrow and the electron drift arrow point opposite ways; arrow length is display scale.",
    topics: [{
      topicId: "physics|12|current-drift-velocity-and-mobility",
      packet: "CH-02b",
      chapter,
      remaining: "Nonuniform density, alternating drift, and microscopic collision pictures are unsupported.",
    }],
    keys: ["n", "e", "A", "vd"],
    ordinary: { n: 10, e: 2, A: 3, vd: 4 },
    altered: { n: 10, e: 2, A: 3, vd: 5 },
    rejections: [{ n: 10, e: 2, A: 0, vd: 4 }, { n: 10, e: -1, A: 3, vd: 4 }],
    certified: driftCertified,
    figure: driftScene,
  }),
  model({
    name: "ce.current_density",
    family: "circuit_network",
    scope: "solved",
    assumptions: "J = I/A and mobility mu = v_d/E for a uniform field, taken as magnitudes along one reference direction. No temperature or scattering model is implied. Arrow length is display scale.",
    topics: [{
      topicId: "physics|12|mobility-and-current-density",
      packet: "CH-02b",
      chapter,
      remaining: "Anisotropic conductivity and Hall mobility are unsupported.",
    }],
    keys: ["I", "A", "vd", "E"],
    ordinary: { I: 8, A: 2, vd: 4, E: 2 },
    altered: { I: 9, A: 3, vd: 6, E: 3 },
    rejections: [{ I: 8, A: 0, vd: 4, E: 2 }, { I: 8, A: 2, vd: 4, E: 0 }],
    certified: currentDensityCertified,
    figure: currentDensityScene,
  }),
  model({
    name: "ce.power",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Steady DC power P = I V = I^2 R = V^2/R. The three inputs must agree. The battery polarity marks the source, the dimension across the load is V, and display length is not power.",
    topics: [{
      topicId: "physics|12|electrical-energy-and-power",
      packet: "CH-02b",
      chapter,
      remaining: "AC average power and time-varying loads belong to the induction chapter, not this DC identity.",
    }],
    keys: ["I", "R", "V"],
    ordinary: { I: 2, R: 3, V: 6 },
    altered: { I: 4, R: 3, V: 12 },
    rejections: [{ I: 2, R: 3, V: 7 }, { I: 2, R: 0, V: 0 }],
    certified: powerCertified,
    figure: powerScene,
  }),
  model({
    name: "ce.joule",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Joule heat H = I^2 R t for constant current over the stated interval. No temperature feedback. The heat arrow points away from the resistor; its length is display scale.",
    topics: [{
      topicId: "physics|12|joules-law-of-heating",
      packet: "CH-02b",
      chapter,
      remaining: "A heating curve versus time and a fuse rating are not drawn.",
    }],
    keys: ["I", "R", "t"],
    ordinary: { I: 2, R: 3, t: 4 },
    altered: { I: 2, R: 3, t: 5 },
    rejections: [{ I: 2, R: 3, t: -1 }, { I: 2, R: -3, t: 4 }],
    certified: jouleCertified,
    figure: jouleScene,
  }),
  model({
    name: "ce.resistivity",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Isotropic resistivity. Conductivity is the reciprocal. The bar is a material sample, not a scale drawing, and no geometry is inferred from it.",
    topics: [{
      topicId: "physics|12|resistivity-and-conductivity",
      packet: "CH-02b",
      chapter,
      remaining: "Tensor conductivity and a measured rho-versus-T table are unsupported.",
    }],
    keys: ["rho"],
    ordinary: { rho: 2 },
    altered: { rho: 4 },
    rejections: [{ rho: 0 }, { rho: -2 }],
    certified: resistivityCertified,
    figure: resistivityScene,
  }),
  model({
    name: "ce.resistance",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Uniform prism R = rho L / A. The rectangle is a schematic, not a scale drawing: the dimension marks the length L, the end face marks the cross-section A, and the label names the material resistivity.",
    topics: [{
      topicId: "physics|12|resistance-from-dimensions",
      packet: "CH-02b",
      chapter,
      remaining: "Tapered conductors and temperature combined with geometry are separate inputs, not this model.",
    }],
    keys: ["rho", "L", "A"],
    ordinary: { rho: 2, L: 6, A: 3 },
    altered: { rho: 2, L: 3, A: 3 },
    rejections: [{ rho: 2, L: 6, A: 0 }, { rho: -1, L: 6, A: 3 }],
    certified: resistanceCertified,
    figure: resistanceScene,
  }),
  model({
    name: "ce.temperature",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Linear metal law R = R0 (1 + alpha DeltaT) about the stated reference. Alpha is an explicit input. The rise arrow shows the temperature rise; its length is display scale.",
    topics: [{
      topicId: "physics|12|temperature-dependence-of-resistance",
      packet: "CH-02b",
      chapter,
      remaining: "Semiconductor exponential laws and a plotted R-T curve are unsupported.",
    }],
    keys: ["R0", "alpha", "dT"],
    ordinary: { R0: 10, alpha: 0.5, dT: 2 },
    altered: { R0: 10, alpha: 0.5, dT: 0 },
    rejections: [{ R0: 0, alpha: 0.5, dT: 2 }, { R0: 10, alpha: -3, dT: 2 }],
    certified: temperatureCertified,
    figure: temperatureScene,
  }),
  model({
    name: "ce.cell",
    family: "circuit_network",
    scope: "solved",
    assumptions: "Terminal law V = E - I r for discharge. r is the explicit internal resistance inside the cell, A is the positive terminal and B the negative terminal, the current arrow shows the external discharge direction from A to B, and open circuit is I = 0.",
    topics: [{
      topicId: "physics|12|cell-emf-potential-difference-and-internal-resistance",
      packet: "CH-02b",
      chapter,
      remaining: "Charging (V = E + I r) and a multi-cell pack are separate models.",
    }],
    keys: ["E", "I", "r"],
    ordinary: { E: 12, I: 2, r: 1 },
    altered: { E: 12, I: 0, r: 1 },
    rejections: [{ E: 12, I: 2, r: -1 }, { E: 1, I: 2, r: 1 }],
    certified: cellCertified,
    figure: cellScene,
  }),
  model({
    name: "ce.iv_ohmic",
    family: "state_plot",
    scope: "solved",
    assumptions: "Ohmic characteristic through the origin. Points (0,0), (1,v1), (2,v2) must be collinear with v2 = 2 v1. Slope is V/I. The observed points are marked on the line and the axes carry their quantities and units.",
    topics: [{
      topicId: "physics|12|iv-characteristics",
      packet: "CH-02c",
      chapter,
      remaining: "A non-ohmic device is ce.iv_declared and is only the supplied points. No curve is invented between them.",
    }],
    keys: ["v1", "v2"],
    ordinary: { v1: 2, v2: 4 },
    altered: { v1: 3, v2: 6 },
    rejections: [{ v1: 2, v2: 5 }, { v1: -1, v2: -2 }],
    certified: ivOhmicCertified,
    figure: ivOhmicScene,
  }),
  model({
    name: "ce.iv_declared",
    family: "state_plot",
    scope: "qualitative",
    assumptions: "Non-ohmic plot of the three supplied points only; no joining curve is invented between them. No slope, fit, or intermediate value is certified. The axes carry their quantities and units.",
    topics: [{
      topicId: "physics|12|iv-characteristics",
      packet: "CH-02c",
      chapter,
      remaining: "Device identity (diode, filament) is not inferred from the points.",
    }],
    keys: ["y1", "y2"],
    ordinary: { y1: 1, y2: 4 },
    altered: { y1: 2, y2: 3 },
    rejections: [{ y1: Number.NaN, y2: 1 }],
    certified: ivDeclaredCertified,
    figure: (_certified, assumptions, inputs) => ivDeclaredScene(inputs, assumptions),
  }),
];

function signedArrow(id: string, y: number, value: number): SceneConstruction {
  return value === 0
    ? construction(id, "point", { x: 0, y }, [id])
    : construction(id, "vector", { start: { x: -1.6 * Math.sign(value), y }, end: { x: 1.6 * Math.sign(value), y } }, [id]);
}

const carrierVariant = currentVariants.find((variant) => variant.name === "ce.carrier_density")!;
currentLawModels.push(model({
  name: carrierVariant.name, family: "circuit_network", scope: "solved",
  assumptions: "Uniform signed reference axis. Mobility is positive; vd = sign(q) mu E, J = n q vd and I = JA. Arrow lengths are schematic; zero values get points, not invented directions.",
  topics: [{ topicId: "physics|12|current-drift-velocity-and-mobility", chapter, packet: "CH-02b", remaining: "Nonuniform drift and scattering pictures require separate source models." }, { topicId: "physics|12|mobility-and-current-density", chapter, packet: "CH-02b", remaining: "Anisotropic/Hall transport is outside the supplied scalar carrier model." }],
  keys: Object.keys(carrierVariant.roles),
  ordinary: { n: 5, q: -2, mu: 3, E: -4, A: 2 }, altered: { n: 5, q: 2, mu: 3, E: 4, A: 3 }, rejections: [{ n: 5, q: 0, mu: 3, E: 4, A: 2 }],
  certified: carrierVariant.scalar,
  figure(certified, assumptions) {
    const values = { current: certified.I, drift: certified.vd, field: Math.sign(certified.J) };
    return sceneDocument({ model: carrierVariant.name, family: "circuit_network", scope: "solved", assumptions, certified,
      entities: [labeled("body", "polygon", "uniform conductor", "conductor"), ...Object.entries(values).map(([id, value]) => labeled(id, value === 0 ? "point" : "vector", `signed ${id}`, id === "current" ? "I" : id === "field" ? "E" : "vd"))],
      constructions: [construction("body", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 1 }, ["body"]), ...Object.entries(values).map(([id, value], index) => signedArrow(id, index + 1, value))],
    });
  },
}));

function addVariantModel(name: string, topicId: string, ordinary: Record<string, number>, altered: Record<string, number>, rejections: Record<string, number>[], figure: (v: Record<string, number>, c: Record<string, number>) => { entities: SceneEntity[]; constructions: SceneConstruction[]; annotations?: SceneAnnotation[] }, remaining: string): void {
  const spec = currentVariants.find((variant) => variant.name === name)!;
  const scope = name.endsWith("_samples") ? "qualitative" : "solved";
  currentLawModels.push({ name, family: name.includes("samples") || name.includes("temperature") || name.includes("piecewise") ? "state_plot" : "circuit_network", scope, assumptions: spec.assumptions.join("; "), topics: [{ topicId, packet: topicId.endsWith("iv-characteristics") ? "CH-02c" : "CH-02b", chapter, remaining }], keys: Object.keys(spec.roles), ordinary, altered, rejections,
    build(inputs) {
      const dynamic = ["ce.joule_piecewise", "ce.iv_samples", "ce.temperature_samples"].includes(name);
      const v = finiteInputs(inputs, dynamic ? Object.keys(inputs) : Object.keys(spec.roles)), c = spec.scalar(v);
      if (Object.values(c).some((value) => !Number.isFinite(value))) throw new Error("current-law output is nonfinite");
      const marks = figure(v, c);
      return { ...sceneDocument({ model: name, family: name.includes("samples") || name.includes("temperature") || name.includes("piecewise") ? "state_plot" : "circuit_network", scope, assumptions: spec.assumptions.join("; "), certified: c, ...marks }), ...(marks.annotations ? { annotations: marks.annotations } : {}) };
    },
  });
}

function observedPlot(points: [number, number][], xLabel: string, yLabel: string, join = false): { entities: SceneEntity[]; constructions: SceneConstruction[] } {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const xMin = Math.min(0, ...xs), yMin = Math.min(0, ...ys), xMax = Math.max(...xs, xMin + 1), yMax = Math.max(...ys, yMin + 1);
  return {
    entities: [entity("axes", "axes", "source data axes"), { ...labeled("xName", "point", "horizontal axis", xLabel), provenance: { hideMark: true } }, { ...labeled("yName", "point", "vertical axis", yLabel), provenance: { hideMark: true } }, ...points.map((_, index) => entity(`sample${index}`, "point", "source observation")), ...(join ? [entity("data", "polyline", "declared piecewise law")] : [])],
    constructions: [construction("axes", "axes", { xMin, xMax, yMin, yMax }, ["axes"]), construction("xName", "point", { x: xMax, y: yMin }, ["xName"]), construction("yName", "point", { x: xMin, y: yMax }, ["yName"]), ...points.map(([x, y], index) => construction(`sample${index}`, "point", { x, y }, [`sample${index}`])), ...(join ? [construction("data", "polyline", { points }, ["data"])] : [])],
  };
}

addVariantModel("ce.joule_piecewise", "physics|12|joules-law-of-heating", { R: 3, I1: 2, t1: 4, I2: -3, t2: 2, I3: 0, t3: 5 }, { R: 2, I1: -1, t1: 3, I2: 4, t2: 2, I3: 2, t3: 1 }, [{ R: 3, I1: 2, t1: -1, I2: 3, t2: 2, I3: 0, t3: 5 }], (v) => {
  const indices = Object.keys(v).flatMap((key) => /^I([0-9]+)$/.exec(key)?.[1] ?? []).map(Number).sort((a, b) => a - b);
  let time = 0, heat = 0;
  const points: [number, number][] = [[0, 0]];
  for (const index of indices) { time += v[`t${index}`]!; heat += v[`I${index}`]! ** 2 * v.R * v[`t${index}`]!; points.push([time, heat]); }
  return observedPlot(points, "t (s)", "H (J)", true);
}, "One to twelve contiguous source-declared intervals are supported. No fuse rating is inferred.");

addVariantModel("ce.stretched_wire", "physics|12|resistance-from-dimensions", { rho: 2, L: 6, A: 3, factor: 2 }, { rho: 3, L: 4, A: 2, factor: 0.5 }, [{ rho: 2, L: 6, A: 3, factor: 0 }], (_v, c) => {
  const result = resistanceScene(c, "Uniform conserved-volume wire at constant resistivity; schematic dimensions");
  return { entities: result.entities, constructions: result.constructions };
}, "A nonuniform wire requires an explicit integral and is not replaced with an average area; temperature feedback needs its own constitutive law.");

addVariantModel("ce.cell_signed", "physics|12|cell-emf-potential-difference-and-internal-resistance", { E: 12, I: -2, r: 1 }, { E: 12, I: 12, r: 1 }, [{ E: 12, I: 13, r: 1 }, { E: 0, I: 0, r: 0 }], (v, c) => {
  const result = cellScene(c, "Signed discharge reference: negative I charges, zero I is open, V=0 is short. P_emf=P_terminal+P_heat; terminals carry an explicit polarity.");
  const constructions = result.constructions.map((item) => item.outputs.includes("current") ? signedArrow("current", -1, v.I) : item);
  const entities = result.entities.map((item) => item.id === "current" ? { ...item, kind: v.I === 0 ? "point" : "vector", role: v.I < 0 ? "charging current" : v.I === 0 ? "open circuit current" : "discharge current", label: v.I === 0 ? "I = 0" : "I" } : item);
  return { entities, constructions, annotations: result.annotations };
}, "Cell chemistry/transients require source models. Signed steady charging, open and resistive short-circuit power are supported; ideal zero-resistance short is singular.");

addVariantModel("ce.temperature_range", "physics|12|temperature-dependence-of-resistance", { R0: 10, alpha: -0.01, T0: 20, T: 40, Tmin: 0, Tmax: 50 }, { R0: 20, alpha: 0.01, T0: 10, T: -10, Tmin: -20, Tmax: 30 }, [{ R0: 10, alpha: -0.01, T0: 20, T: 51, Tmin: 0, Tmax: 50 }], (v, c) => observedPlot([[v.Tmin, c.Rmin], [v.T, c.R], [v.Tmax, c.Rmax]], "T (°C)", "R (Ω)", true), "A measured nonlinear alternative is source observations, not this linear law; extrapolation outside the supplied range rejects.");

addVariantModel("ce.iv_samples", "physics|12|iv-characteristics", { i0: -2, v0: -3, i1: 0.5, v1: 1, i2: 3, v2: 9 }, { i0: -3, v0: 4, i1: 0, v1: 2, i2: 2, v2: 1 }, [{ i0: 1, v0: 1, i1: 1, v1: 2, i2: 3, v2: 9 }], (v) => observedPlot(Object.keys(v).flatMap((key) => /^i([0-9]+)$/.exec(key)?.[1] ?? []).map(Number).sort((a, b) => a - b).map((index) => [v[`i${index}`]!, v[`v${index}`]!] as [number, number]), "I (A)", "V (V)"), "Two to twelve contiguous supplied observations are marked; intermediate slopes and device identity are not invented.");
addVariantModel("ce.temperature_samples", "physics|12|temperature-dependence-of-resistance", { T0: -10, R0: 8, T1: 20, R1: 10, T2: 50, R2: 17 }, { T0: -20, R0: 15, T1: 0, R1: 10, T2: 30, R2: 9 }, [{ T0: -10, R0: 8, T1: 20, R1: 0, T2: 50, R2: 17 }], (v) => observedPlot(Object.keys(v).flatMap((key) => /^T([0-9]+)$/.exec(key)?.[1] ?? []).map(Number).sort((a, b) => a - b).map((index) => [v[`T${index}`]!, v[`R${index}`]!] as [number, number]), "T (°C)", "R (Ω)"), "Two to twelve supplied nonlinear observations, with no fitted law or extrapolation.");
addVariantModel("ce.material_comparison", "physics|12|resistivity-and-conductivity", { rho1: 2, rho2: 5, L: 6, A: 3 }, { rho1: 4, rho2: 1, L: 3, A: 2 }, [{ rho1: 0, rho2: 5, L: 6, A: 3 }], () => ({ entities: [labeled("first", "polygon", "first isotropic material", "ρ1, σ1"), labeled("second", "polygon", "second isotropic material", "ρ2, σ2"), labeled("length", "dimension", "common length", "L"), labeled("area", "point", "common cross section", "same A")], constructions: [construction("first", "rectangle", { center: { x: 0, y: 0 }, width: 4, height: 0.8 }, ["first"]), construction("second", "rectangle", { center: { x: 0, y: 1.5 }, width: 4, height: 0.8 }, ["second"]), construction("length", "dimension", { start: { x: -2, y: -0.4 }, end: { x: 2, y: -0.4 } }, ["length"]), construction("area", "point", { x: 2, y: 0.75 }, ["area"])] }), "Tensor conductivity and temperature-dependent constitutive laws are not replaced with the scalar isotropic reciprocal.");
