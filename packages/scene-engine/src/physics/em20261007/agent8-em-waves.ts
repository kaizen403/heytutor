import { construction, entity, finiteInputs, positive, sceneDocument, type EmModel } from "./sceneKit";
import type { SceneConstruction, SceneDocument, SceneEntity } from "../../types";

const chapter = "Electromagnetic Waves";
const bands = ["radio", "microwave", "infrared", "visible", "ultraviolet", "xray", "gamma"] as const;
const spectrumEdges = Array.from({ length: 8 }, (_, index) => `edge${index}`);
const spectrumIntervals = bands.flatMap(band => [`${band}Min`, `${band}Max`]);

function labeled(id: string, kind: string, role: string, label: string) {
  return { ...entity(id, kind, role), label };
}

const orientationKeys = ["kSign", "eSign", "theta"] as const;
const waveKeys = ["lambda", "phase", "time"] as const;

/** Optional variants are complete groups, never partially defaulted physical
 * assumptions. The legacy ordinary samples keep their declared static model. */
function inputsFor(inputs: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): Record<string, number> {
  const present = optional.filter(key => key in inputs);
  return finiteInputs(inputs, [...required, ...present]);
}

function completeGroup(v: Record<string, number>, keys: readonly string[]): boolean {
  const present = keys.filter(key => key in v);
  if (present.length > 0 && present.length !== keys.length) throw new Error(`the variant requires all of ${keys.join(", ")}`);
  return present.length > 0;
}

function checked(value: number, name: string, nonzero = false): number {
  if (!Number.isFinite(value) || (nonzero && value === 0)) throw new Error(`${name} is not numerically certifiable`);
  return value;
}

function agrees(actual: number, expected: number, name: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-10 * Math.max(Math.abs(actual), Math.abs(expected), Number.MIN_VALUE)) {
    throw new Error(`${name} disagrees with the declared physical model`);
  }
}

function sourceNumberLabel(value: number, unit: string): string {
  const exact = `${value} ${unit}`;
  return exact.length <= 16 ? exact : `≈${value.toExponential(2).replace("e+", "e")} ${unit}`;
}

function quantityLabel(symbol: string, value: number, unit: string): string {
  const exact = `${symbol}=${value} ${unit}`;
  return exact.length <= 16 ? exact : `${symbol}≈${value.toExponential(2).replace("e+", "e").replace(/\.?0+e/, "e")}${unit}`;
}

function refreshEntities(document: SceneDocument): void {
  document.requiredEntityIds = document.entities.map(e => e.id);
  document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
}

function orientation(v: Record<string, number>) {
  const explicit = completeGroup(v, orientationKeys);
  const kSign = explicit ? v.kSign! : 1;
  const eSign = explicit ? v.eSign! : 1;
  const theta = explicit ? v.theta! : 0;
  if (![1, -1].includes(kSign) || ![1, -1].includes(eSign)) throw new Error("propagation and polarization signs must be ±1");
  if (Math.abs(theta) > 2 * Math.PI) throw new Error("orientation angle must be within one turn");
  const k = [kSign * Math.cos(theta), kSign * Math.sin(theta), 0];
  const E = [-eSign * Math.sin(theta), eSign * Math.cos(theta), 0];
  const B = [0, 0, kSign * eSign];
  return { k, E, B, kSign, eSign, theta, frame: "right-handed physical xyz; z out of page" };
}

function triadMarks(frame: ReturnType<typeof orientation>, cy = 0): { entities: SceneEntity[]; constructions: SceneConstruction[] } {
  const at = (u: number[], length: number) => ({ x: u[0]! * length, y: cy + u[1]! * length });
  const center = { x: 0, y: cy };
  const entities: SceneEntity[] = [
    { ...labeled("propagation", "vector", "propagation", "k"), semantic: { physicalDirection: frame.k }, provenance: { displayScaleIsNotMeasurement: true } },
    { ...labeled("electric", "vector", "electric field", "E"), semantic: { physicalDirection: frame.E }, provenance: { displayScaleIsNotMeasurement: true } },
    { ...labeled("magnetic", "circle", frame.B[2]! > 0 ? "magnetic field out of page" : "magnetic field into page", "B"), semantic: { physicalDirection: frame.B } },
  ];
  const constructions = [
    construction("propagation", "vector", { start: at(frame.k, 0.36), end: at(frame.k, 1.4) }, ["propagation"]),
    construction("electric", "vector", { start: at(frame.E, 0.36), end: at(frame.E, 1.3) }, ["electric"]),
    construction("magnetic", "circle", { center, radius: 0.28 }, ["magnetic"]),
  ];
  if (frame.B[2]! > 0) {
    entities.push({ ...entity("magnetic-dot", "circle", "out-of-page dot"), provenance: { inkRole: "opaque_dot" } });
    constructions.push(construction("magnetic-dot", "circle", { center, radius: 0.07 }, ["magnetic-dot"]));
  } else {
    for (const [id, dy] of [["magnetic-cross-a", 1], ["magnetic-cross-b", -1]] as const) {
      entities.push(entity(id, "polyline", "into-page cross"));
      constructions.push(construction(id, "polyline", { points: [{ x: -0.13, y: cy - dy * 0.13 }, { x: 0.13, y: cy + dy * 0.13 }] }, [id]));
    }
  }
  return { entities, constructions };
}

function transverseDocument(model: EmModel, v: Record<string, number>, certified: Record<string, number>): SceneDocument {
  if (v.crossed !== 1) throw new Error("E, B, and k must be mutually transverse electromagnetic fields");
  const frame = orientation(v);
  const wave = completeGroup(v, waveKeys);
  if (wave && (!completeGroup(v, orientationKeys) || !(v.c! > 0) || !(v.B! > 0))) throw new Error("a plane wave requires c, B amplitude, and its full orientation");
  const marks = triadMarks(frame, wave ? -1 : 0);
  const document = sceneDocument({ model: model.name, family: model.family, scope: model.scope, assumptions: model.assumptions, certified, ...marks });
  document.source.physicalFrame = frame;
  if (!wave) return document;
  positive(v.lambda!, "lambda");
  const frequency = checked(v.c! / v.lambda!, "frequency", true);
  const E0 = checked(v.c! * v.B!, "electric amplitude", true);
  const phaseAtOrigin = checked(v.phase! - 2 * Math.PI * frequency * v.time!, "phase at origin");
  if (Math.abs(phaseAtOrigin) > 1e9) throw new Error("phase is too large for a stable trigonometric evaluation");
  const samples = Array.from({ length: 97 }, (_, index) => {
    const s = checked(v.lambda! * (index / 48), "wave position");
    const phase = frame.kSign * 2 * Math.PI * (index / 48) + phaseAtOrigin;
    const oscillation = Math.sin(phase);
    return { s, phase, E: frame.E.map(u => checked(u * E0 * oscillation, "E component")), B: frame.B.map(u => checked(u * v.B! * oscillation, "B component")) };
  });
  document.source.planeWave = {
    electromagnetic: true, constitutiveModel: "lossless isotropic plane wave at declared speed",
    frequency, wavelength: v.lambda, speed: v.c, electricAmplitude: E0, magneticAmplitude: v.B,
    phase: v.phase, time: v.time, frame, samples,
    phaseLaw: "kSign * 2π s/λ - 2π f t + phase; E and B share the same phase",
    display: "two normalized component traces; heights do not measure field units or their ratio",
  };
  for (const [id, baseline, label] of [["electric-wave", 3.4, "E phase"], ["magnetic-wave", 1.4, "B phase"]] as const) {
    document.entities.push({ ...labeled(id, "polyline", label, label), semantic: { electromagneticField: id, sharedPhase: true }, provenance: { displayScaleIsNotMeasurement: true } });
    document.constructions.push(construction(`build_${id}`, "polyline", { points: samples.map((sample, index) => ({ x: -2.4 + index / 20, y: baseline + 0.6 * Math.sin(sample.phase) })) }, [id]));
  }
  document.requiredEntityIds = document.entities.map(e => e.id);
  document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
  return document;
}

export const emWaveModels: EmModel[] = [
  {
    name: "emw.triad",
    family: "transverse_field",
    scope: "qualitative",
    assumptions: "Transverse triad. E is up, B is out of the page, and propagation k points to the right, so E cross B is along k. No amplitude or wavelength is certified.",
    topics: [
      { topicId: "physics|15|electromagnetic-waves-and-characteristics", packet: "CH-26a", chapter, remaining: "A numeric E = c B relation is emw.amplitude and is not inferred from this sketch." },
      { topicId: "physics|15|transverse-nature", packet: "CH-26a", chapter, remaining: "A longitudinal claim is rejected." },
    ],
    keys: ["crossed", ...orientationKeys],
    ordinary: { crossed: 1 },
    altered: { crossed: 1 },
    rejections: [{ crossed: 0 }],
    build(inputs) {
      return transverseDocument(this, inputsFor(inputs, ["crossed"], orientationKeys), {});
    },
  },
  {
    name: "emw.amplitude",
    family: "transverse_field",
    scope: "solved",
    assumptions: "Plane wave in the declared medium. |E| = c |B| with both c and B explicit. Parallel E and B are rejected. c is not hardcoded as 3e8.",
    topics: [{ topicId: "physics|15|electromagnetic-waves-and-characteristics", packet: "CH-26a", chapter, remaining: "A wave that is not transverse stays on emw.triad and is rejected here." }],
    keys: ["c", "B", "crossed", ...orientationKeys, ...waveKeys],
    ordinary: { c: 3, B: 2, crossed: 1 },
    altered: { c: 3, B: 4, crossed: 1 },
    rejections: [{ c: 3, B: 2, crossed: 0 }, { c: 0, B: 2, crossed: 1 }],
    build(inputs) {
      const v = inputsFor(inputs, ["c", "B", "crossed"], [...orientationKeys, ...waveKeys]);
      positive(v.c, "c");
      positive(v.B!, "B amplitude");
      if (v.crossed !== 1) throw new Error("E parallel to B is not a transverse plane wave");
      const E = checked(v.c! * v.B!, "electric amplitude", true);
      return transverseDocument(this, v, { E });
    },
  },
  {
    name: "emw.speed",
    family: "transverse_field",
    scope: "solved",
    assumptions: "Vacuum v = 1/sqrt(mu0 eps0). A medium variant must declare a lossless isotropic constitutive model and positive muR, epsR; v = c0/sqrt(muR epsR). A supplied frequency sets wavelength = v/f. Display spacing is schematic.",
    topics: [{ topicId: "physics|15|speed-of-electromagnetic-waves", packet: "CH-26b", chapter, remaining: "Dispersive, lossy, anisotropic and negative-index media are outside this declared model. Shared source admission and student lifecycle remain pending." }],
    keys: ["mu0", "eps0", "medium", "isotropic", "lossless", "muR", "epsR", "f", "lambda"],
    ordinary: { mu0: 2, eps0: 0.5 },
    altered: { mu0: 4, eps0: 1 },
    rejections: [{ mu0: 0, eps0: 0.5 }, { mu0: 2, eps0: 0 }],
    build(inputs) {
      const v = inputsFor(inputs, ["mu0", "eps0"], ["medium", "isotropic", "lossless", "muR", "epsR", "f", "lambda"]);
      positive(v.mu0, "mu0");
      positive(v.eps0, "eps0");
      const c0 = checked(1 / Math.sqrt(checked(v.mu0! * v.eps0!, "vacuum constitutive product", true)), "vacuum speed", true);
      const extended = ["medium", "isotropic", "lossless", "muR", "epsR", "f", "lambda"].some(key => key in v);
      let n = 1;
      if (extended) {
        if (v.medium !== 0 && v.medium !== 1) throw new Error("declare vacuum (medium=0) or an isotropic medium (medium=1)");
        positive(v.f!, "frequency");
        if (v.medium === 1) {
          if (v.isotropic !== 1 || v.lossless !== 1) throw new Error("medium speed requires explicit isotropic and lossless assumptions");
          positive(v.muR!, "muR"); positive(v.epsR!, "epsR");
          n = checked(Math.sqrt(checked(v.muR! * v.epsR!, "relative constitutive product", true)), "refractive index", true);
        } else if (["isotropic", "lossless", "muR", "epsR"].some(key => key in v)) throw new Error("vacuum variant cannot carry undeclared medium properties");
      }
      const c = checked(c0 / n, "propagation speed", true);
      const certified: Record<string, number> = extended ? { c, n, f: v.f!, lambda: checked(c / v.f!, "wavelength", true) } : { c };
      if ("lambda" in v) { positive(v.lambda!, "lambda"); agrees(v.lambda!, certified.lambda!, "supplied wavelength"); }
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified,
        entities: [labeled("ray", "vector", "propagation", "v")],
        constructions: [construction("ray", "vector", { start: { x: -1.2, y: 0 }, end: { x: 1.2, y: 0 } }, ["ray"])],
      });
      document.source.propagation = { vacuumSpeed: c0, speed: c, medium: extended ? v.medium : 0, muR: v.muR, epsR: v.epsR, frequency: v.f, wavelength: certified.lambda, displayScaleIsNotMeasurement: true };
      if (extended) {
        document.entities.push(
          { ...labeled("speed-wave", "polyline", "normalized electromagnetic phase trace", quantityLabel("f", certified.f!, "Hz")), semantic: { electromagnetic: true, physicalFrequency: certified.f, physicalWavelength: certified.lambda }, provenance: { displayScaleIsNotMeasurement: true } },
          { ...labeled("wavelength-marker", "polyline", "one wavelength on normalized trace", quantityLabel("λ", certified.lambda!, "m")), semantic: { physicalWavelength: certified.lambda, normalizedCycles: 1 }, provenance: { displayScaleIsNotMeasurement: true } },
          labeled("propagation-medium", "point", "source constitutive environment", v.medium === 0 ? "vacuum" : "medium"),
        );
        document.constructions.push(
          construction("build_speed-wave", "polyline", { points: Array.from({ length: 97 }, (_, index) => ({ x: -2 + index / 24, y: 1.2 + 0.35 * Math.cos(index * Math.PI / 24) })) }, ["speed-wave"]),
          construction("build_wavelength-marker", "polyline", { points: [{ x: -2, y: 1.8 }, { x: -2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1.8 }] }, ["wavelength-marker"]),
          construction("build_propagation-medium", "point", { x: 0, y: -0.6 }, ["propagation-medium"]),
        );
        refreshEntities(document);
      }
      return document;
    },
  },
  {
    name: "emw.energy",
    family: "transverse_field",
    scope: "solved",
    assumptions: "Vacuum plane wave. Legacy E is instantaneous magnitude: u=eps0 E² and g=u/c. Explicit convention 0 is instantaneous, 1 is a sinusoidal peak amplitude averaged over a cycle, 2 is an RMS amplitude averaged over a cycle. S=u c along k. Normal-incidence pressure requires explicit absorption (reflection=0) or ideal reflection (reflection=1). No medium momentum convention is inferred.",
    topics: [{ topicId: "physics|15|energy-and-momentum-of-em-waves", packet: "CH-26a", chapter, remaining: "Oblique surfaces and momentum in material media require separate declared models. Shared admission and live/replay review remain pending." }],
    keys: ["eps0", "E", "c", "convention", "reflection", "mu0", ...orientationKeys],
    ordinary: { eps0: 2, E: 3, c: 3 },
    altered: { eps0: 2, E: 4, c: 2 },
    rejections: [{ eps0: 2, E: 3, c: 0 }, { eps0: 0, E: 3, c: 3 }],
    build(inputs) {
      const v = inputsFor(inputs, ["eps0", "E", "c"], ["convention", "reflection", "mu0", ...orientationKeys]);
      positive(v.eps0, "eps0");
      positive(v.c, "c");
      if (v.E < 0) throw new Error("E is a magnitude in this energy model");
      const extended = ["convention", "reflection", "mu0", ...orientationKeys].some(key => key in v);
      if (extended && ![0, 1, 2].includes(v.convention!)) throw new Error("declare instantaneous, peak-average, or RMS-average field convention");
      if ("mu0" in v) {
        positive(v.mu0!, "mu0");
        agrees(checked(v.mu0! * v.eps0! * v.c! * v.c!, "vacuum constitutive identity", true), 1, "vacuum speed and constants");
      }
      const u = checked(v.eps0! * v.E! * v.E! * (v.convention === 1 ? 0.5 : 1), "energy density", v.E !== 0);
      const momentum = checked(u / v.c!, "momentum density", u !== 0);
      const intensity = checked(u * v.c!, "Poynting magnitude", u !== 0);
      const frame = orientation(v);
      const certified: Record<string, number> = extended ? { u, momentum, intensity, uElectric: u / 2, uMagnetic: u / 2, B: checked(v.E! / v.c!, "magnetic field", v.E !== 0) } : { u, momentum };
      if ("reflection" in v) {
        if (v.reflection !== 0 && v.reflection !== 1) throw new Error("reflection must declare ideal absorption or reflection");
        certified.pressure = checked(u * (1 + v.reflection), "radiation pressure", u !== 0);
      }
      const marks = v.E === 0
        ? { entities: [labeled("electric-zero", "point", "zero electric and magnetic field", "E = B = zero")], constructions: [construction("electric-zero", "point", { x: 0, y: 0 }, ["electric-zero"])] }
        : triadMarks(frame);
      const document = sceneDocument({ model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified, ...marks });
      document.source.energy = {
        convention: v.convention === 1 ? "cycle average from sinusoidal peak" : v.convention === 2 ? "cycle average from RMS" : "instantaneous",
        momentumConvention: "vacuum g=S/c²=u/c", poynting: frame.k.map(value => checked(value * intensity, "Poynting component")),
        fieldFrame: frame, normalIncidence: "reflection" in v, reflection: v.reflection, displayScaleIsNotMeasurement: true,
      };
      const fluxStart = { x: -frame.E[0]! * 1.1, y: -frame.E[1]! * 1.1 };
      const fluxEnd = { x: fluxStart.x + frame.k[0]! * 2.3, y: fluxStart.y + frame.k[1]! * 2.3 };
      document.entities.push({ ...labeled("poynting", intensity === 0 ? "point" : "vector", "vacuum electromagnetic energy flow", intensity === 0 ? "S = zero" : "S"), semantic: { physicalDirection: frame.k, physicalMagnitude: intensity }, provenance: { displayScaleIsNotMeasurement: true } });
      document.constructions.push(construction("build_poynting", intensity === 0 ? "point" : "vector", intensity === 0 ? fluxStart : { start: fluxStart, end: fluxEnd }, ["poynting"]));
      if ("reflection" in v) {
        const center = { x: fluxStart.x + frame.k[0]! * 2.9, y: fluxStart.y + frame.k[1]! * 2.9 };
        document.entities.push({ ...labeled("radiation-surface", "polyline", "normal-incidence radiation surface", v.reflection === 1 ? "reflector" : "absorber"), semantic: { physicalNormal: frame.k, reflection: v.reflection, pressure: certified.pressure }, provenance: { displayScaleIsNotMeasurement: true } });
        document.constructions.push(construction("build_radiation-surface", "polyline", { points: [{ x: center.x - frame.E[0]! * 0.8, y: center.y - frame.E[1]! * 0.8 }, { x: center.x + frame.E[0]! * 0.8, y: center.y + frame.E[1]! * 0.8 }] }, ["radiation-surface"]));
      }
      refreshEntities(document);
      return document;
    },
  },
  {
    name: "emw.production",
    family: "transverse_field",
    scope: "qualitative",
    assumptions: "A nonzero accelerated charge is the source sketch. An outgoing-field variant declares a far-zone electric-dipole approximation, acceleration axis, and observation direction. An antenna also supplies its length and oscillation frequency. No field magnitude, wavelength, power, or quantitative angular pattern is invented.",
    topics: [{ topicId: "physics|15|production-of-electromagnetic-waves", packet: "CH-26a", chapter, remaining: "Finite antennas, near fields and full angular radiation patterns need separate source-defined models. Shared admission and live/replay review remain pending." }],
    keys: ["q", "a", "antenna", "farField", "dipole", "length", "frequency", "axisAngle", "outgoingAngle"],
    ordinary: { q: 1, a: 2 },
    altered: { q: -1, a: 2 },
    rejections: [{ q: 1, a: 0 }],
    build(inputs) {
      const v = inputsFor(inputs, ["q", "a"], ["antenna", "farField", "dipole", "length", "frequency", "axisAngle", "outgoingAngle"]);
      if (v.q === 0) throw new Error("the source charge is zero");
      if (v.a === 0) throw new Error("a charge with no acceleration is not this production sketch");
      const outgoing = completeGroup(v, ["farField", "dipole", "axisAngle", "outgoingAngle"]);
      if (outgoing && (v.farField !== 1 || v.dipole !== 1)) throw new Error("outgoing fields require the declared far-zone electric-dipole approximation");
      if (["antenna", "length", "frequency"].some(key => key in v)) {
        if (!outgoing || v.antenna !== 1) throw new Error("antenna variant requires its full source and far-zone assumptions");
        positive(v.length!, "antenna length"); positive(v.frequency!, "antenna frequency");
      }
      if (outgoing && (Math.abs(v.axisAngle!) > 2 * Math.PI || Math.abs(v.outgoingAngle!) > 2 * Math.PI)) throw new Error("radiation angles must be within one turn");
      const axis = outgoing ? [Math.cos(v.axisAngle!), Math.sin(v.axisAngle!), 0] : [0, 1, 0];
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: [labeled("charge", "point", "charge", v.q! > 0 ? "+q" : "−q"), labeled("acceleration", "vector", "acceleration", "a")],
        constructions: [
          construction("charge", "point", { x: 0, y: 0 }, ["charge"]),
          construction("acceleration", "vector", { start: { x: 0, y: 0 }, end: { x: axis[0]! * Math.sign(v.a!) * 1.2, y: axis[1]! * Math.sign(v.a!) * 1.2 } }, ["acceleration"]),
        ],
      });
      if (v.antenna === 1) {
        document.entities.push(labeled("antenna", "polyline", "electric dipole antenna", "antenna"));
        document.constructions.push(construction("build_antenna", "polyline", { points: [{ x: -axis[0]!, y: -axis[1]! }, { x: axis[0]!, y: axis[1]! }] }, ["antenna"]));
      }
      if (outgoing) {
        const n = [Math.cos(v.outgoingAngle!), Math.sin(v.outgoingAngle!), 0];
        const dot = n[0]! * axis[0]! + n[1]! * axis[1]!;
        const projected = axis.map((value, index) => n[index]! * dot - value);
        const length = Math.hypot(...projected);
        const nullDirection = length < 1e-12;
        const E = nullDirection ? [0, 0, 0] : projected.map(value => value / length * Math.sign(v.q!) * Math.sign(v.a!));
        const B = [0, 0, n[0]! * E[1]! - n[1]! * E[0]!];
        document.source.radiation = { mechanism: v.antenna === 1 ? "oscillating electric dipole antenna" : "accelerated charge in electric-dipole far zone", propagation: n, electricDirection: E, magneticDirection: B, frequency: v.frequency, antennaLength: v.length, nullDirection, displayScaleIsNotMeasurement: true };
        const at = { x: n[0]! * 2.4, y: n[1]! * 2.4 };
        if (nullDirection) {
          document.entities.push(labeled("radiation-null", "point", "electric-dipole radiation null", "radiation null"));
          document.constructions.push(construction("build_radiation-null", "point", at, ["radiation-null"]));
        } else {
          document.entities.push(labeled("outgoing", "vector", "outgoing radiation direction", "outgoing"), labeled("radiation-electric", "vector", "transverse outgoing electric field", "E radiation"));
          document.constructions.push(
            construction("build_outgoing", "vector", { start: { x: n[0]! * 1.5, y: n[1]! * 1.5 }, end: { x: n[0]! * 3.4, y: n[1]! * 3.4 } }, ["outgoing"]),
            construction("build_radiation-electric", "vector", { start: at, end: { x: at.x + E[0]! * 0.7, y: at.y + E[1]! * 0.7 } }, ["radiation-electric"]),
          );
          const bCenter = { x: at.x + E[0]! * 1.2, y: at.y + E[1]! * 1.2 };
          document.entities.push({ ...labeled("radiation-magnetic", "circle", B[2]! > 0 ? "outgoing magnetic field out of page" : "outgoing magnetic field into page", "B radiation"), semantic: { physicalDirection: B }, provenance: { displayScaleIsNotMeasurement: true } });
          document.constructions.push(construction("build_radiation-magnetic", "circle", { center: bCenter, radius: 0.2 }, ["radiation-magnetic"]));
          if (B[2]! > 0) {
            document.entities.push({ ...entity("radiation-magnetic-dot", "circle", "out-of-page radiation dot"), provenance: { inkRole: "opaque_dot" } });
            document.constructions.push(construction("build_radiation-magnetic-dot", "circle", { center: bCenter, radius: 0.05 }, ["radiation-magnetic-dot"]));
          } else for (const [id, sign] of [["radiation-magnetic-cross-a", 1], ["radiation-magnetic-cross-b", -1]] as const) {
            document.entities.push(entity(id, "polyline", "into-page radiation cross"));
            document.constructions.push(construction(`build_${id}`, "polyline", { points: [{ x: bCenter.x - 0.09, y: bCenter.y - sign * 0.09 }, { x: bCenter.x + 0.09, y: bCenter.y + sign * 0.09 }] }, [id]));
          }
        }
      }
      document.requiredEntityIds = document.entities.map(e => e.id);
      document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
      return document;
    },
  },
  {
    name: "emw.spectrum",
    family: "transverse_field",
    scope: "qualitative",
    assumptions: "Radio through gamma are ordered by increasing frequency and decreasing wavelength. order=-1 reverses the display; all categorical spacing is nonmetric. Source bounds use boundUnit=1 (Hz) or 2 (m): either all adjacent edge0..edge7, or explicit Min/Max per band, allowing overlapping intervals whose nominal centres retain the stated order. No universal numerical edges are inserted.",
    topics: [{ topicId: "physics|15|electromagnetic-spectrum", packet: "CH-26b", chapter, remaining: "Overlapping experimental classifications need source-specific band definitions; X-ray membership never grants nuclear-decay or Moseley-law authority. Shared admission and live/replay review remain pending." }],
    keys: ["shown", "order", "boundUnit", ...spectrumEdges, ...spectrumIntervals],
    ordinary: { shown: 1 },
    altered: { shown: 1 },
    rejections: [{ shown: 0 }],
    build(inputs) {
      const v = inputsFor(inputs, ["shown"], ["order", "boundUnit", ...spectrumEdges, ...spectrumIntervals]);
      if (v.shown !== 1) throw new Error("the spectrum strip requires the explicit shown flag");
      const order = v.order ?? 1;
      if (order !== 1 && order !== -1) throw new Error("spectrum order must be +1 or -1");
      const adjacent = completeGroup(v, spectrumEdges);
      const independent = completeGroup(v, spectrumIntervals);
      if (adjacent && independent) throw new Error("declare adjacent edges or independent intervals, not both");
      const bounded = adjacent || independent;
      if (!bounded && "boundUnit" in v) throw new Error("source band limits are omitted");
      if (bounded && v.boundUnit !== 1 && v.boundUnit !== 2) throw new Error("source-defined spectrum edges require Hz or m");
      const limits = bands.map((band, index) => {
        if (!bounded) return { band };
        const first = positive(v[independent ? `${band}Min` : `edge${index}`]!, "band edge");
        const second = positive(v[independent ? `${band}Max` : `edge${index + 1}`]!, "band edge");
        if (independent ? !(second > first) : v.boundUnit === 1 ? !(second > first) : !(second < first)) throw new Error("source band limits disagree with their declared order");
        return { band, min: Math.min(first, second), max: Math.max(first, second), unit: v.boundUnit === 1 ? "Hz" : "m" };
      });
      if (independent) for (let index = 1; index < limits.length; index += 1) {
        const before = limits[index - 1]!; const current = limits[index]!;
        if (!("min" in before) || !("min" in current)) continue;
        const a = Math.log(before.min!) + Math.log(before.max!);
        const b = Math.log(current.min!) + Math.log(current.max!);
        if (v.boundUnit === 1 ? !(b > a) : !(b < a)) throw new Error("source interval centres reverse the nominal spectrum order");
      }
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: limits.map((limit, index) => ({ id: limit.band, kind: "point", role: "spectrum band", label: `${index + 1}. ${limit.band}`, semantic: { order: index + 1, ...limit }, provenance: { displayScaleIsNotMeasurement: true } })),
        constructions: limits.map((limit, index) => construction(limit.band, "point", bounded ? { x: 0, y: order * (3 - index) * 0.8 } : { x: order * (index - 3), y: 0 }, [limit.band])),
      });
      if (bounded) for (const [index, limit] of limits.entries()) {
        if (!("min" in limit)) continue;
        const y = order * (3 - index) * 0.8;
        for (const [suffix, x, value] of [["lower", 1.8, limit.min], ["upper", 3.4, limit.max]] as const) {
          const id = `${limit.band}-${suffix}`;
          document.entities.push({ ...labeled(id, "point", `source ${suffix} band limit`, sourceNumberLabel(value!, limit.unit!)), semantic: { sourceValue: value, unit: limit.unit, bound: suffix }, provenance: { hideMark: true } });
          document.constructions.push(construction(`build_${id}`, "point", { x, y }, [id]));
        }
      }
      document.entities.push(
        { ...labeled("frequency-order", "vector", "frequency ordering", "f increases"), semantic: { increasingQuantity: "frequency", nominalBandDirection: "radio to gamma" }, provenance: { displayScaleIsNotMeasurement: true } },
        { ...labeled("wavelength-order", "vector", "wavelength ordering", "λ increases"), semantic: { increasingQuantity: "wavelength", nominalBandDirection: "gamma to radio" }, provenance: { displayScaleIsNotMeasurement: true } },
      );
      document.constructions.push(
        construction("build_frequency-order", "vector", bounded ? { start: { x: -1, y: order * 2.8 }, end: { x: -1, y: -order * 2.8 } } : { start: { x: -order * 3, y: 1.2 }, end: { x: order * 3, y: 1.2 } }, ["frequency-order"]),
        construction("build_wavelength-order", "vector", bounded ? { start: { x: -2, y: -order * 2.8 }, end: { x: -2, y: order * 2.8 } } : { start: { x: order * 3, y: -1.2 }, end: { x: -order * 3, y: -1.2 } }, ["wavelength-order"]),
      );
      document.requiredEntityIds = document.entities.map(e => e.id);
      document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
      document.source.spectrum = { bands: limits, frequencyDirection: order, wavelengthDirection: -order, displayScale: "categorical; equal spacing does not imply equal band widths", membershipPolicy: independent ? "source-defined independent intervals; overlaps are retained" : bounded ? "source-defined adjacent bands; use source boundary convention" : "ordering only; no numeric membership claim" };
      return document;
    },
  },
  {
    name: "emw.applications",
    family: "transverse_field",
    scope: "qualitative",
    assumptions: "Only explicit selected bands are drawn. A use variant supplies a sourceContext flag and useCode: 1 radio broadcast, 2 microwave oven, 3 X-ray medical imaging, 4 infrared thermal imaging, 5 visible vision, 6 UV disinfection, 7 gamma radiotherapy, 8 microwave radar. Optional useCode2 composes two named uses. No unmentioned band, wavelength, intensity, or solved number is added.",
    topics: [{ topicId: "physics|15|applications-of-electromagnetic-waves", packet: "CH-26b", chapter, remaining: "A band-only selection is a source representation, not a checked application. Recall-only lists may be text-only outside this drawing request; omitted context cannot select a use. Shared source admission and student lifecycle remain pending." }],
    keys: [...bands, "useCode", "useCode2", "sourceContext"],
    ordinary: { radio: 1, microwave: 0, infrared: 0, visible: 1, ultraviolet: 0, xray: 0, gamma: 0 },
    altered: { radio: 0, microwave: 1, infrared: 0, visible: 0, ultraviolet: 0, xray: 0, gamma: 0 },
    rejections: [{ radio: 0, microwave: 0, infrared: 0, visible: 0, ultraviolet: 0, xray: 0, gamma: 0 }],
    build(inputs) {
      const v = inputsFor(inputs, bands, ["useCode", "useCode2", "sourceContext"]);
      const selected = bands.filter((band) => {
        if (v[band] !== 0 && v[band] !== 1) throw new Error(`${band} must be 0 or 1`);
        return v[band] === 1;
      });
      if (selected.length === 0) throw new Error("name at least one supplied band");
      const contexts: Record<number, { band: typeof bands[number]; use: string }> = {
        1: { band: "radio", use: "broadcast communication" }, 2: { band: "microwave", use: "oven heating" },
        3: { band: "xray", use: "medical imaging" }, 4: { band: "infrared", use: "thermal imaging" },
        5: { band: "visible", use: "vision" }, 6: { band: "ultraviolet", use: "disinfection" },
        7: { band: "gamma", use: "radiotherapy" }, 8: { band: "microwave", use: "radar" },
      };
      const hasContext = ["useCode", "useCode2", "sourceContext"].some(key => key in v);
      const uses = hasContext ? [v.useCode, v.useCode2].filter((code): code is number => code !== undefined).map(code => {
        const context = contexts[code];
        if (!Number.isInteger(code) || !context) throw new Error("unsupported source application code");
        return context;
      }) : [];
      if (hasContext && (v.sourceContext !== 1 || v.useCode === undefined)) throw new Error("a use-to-band relationship needs an explicit source context");
      if (uses.length > 0 && (uses.some(use => !selected.includes(use.band)) || selected.some(band => !uses.some(use => use.band === band)))) throw new Error("selected bands and source-defined applications disagree");
      if (uses.length === 2 && v.useCode === v.useCode2) throw new Error("duplicate source use");
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified: {},
        entities: selected.map((band) => ({ id: band, kind: "point", role: "named band", label: band })),
        constructions: selected.map((band, index) => construction(band, "point", { x: hasContext ? 0 : index, y: hasContext ? -index * 1.5 : 0 }, [band])),
      });
      for (const [index, use] of uses.entries()) {
        const id = `use-${index}`;
        const y = -selected.indexOf(use.band) * 1.5 - (uses.slice(0, index).some(previous => previous.band === use.band) ? 0.6 : 0);
        document.entities.push({ ...labeled(id, "point", "source application", use.use === "broadcast communication" ? "broadcast" : use.use), semantic: { sourceUse: use.use, band: use.band } }, entity(`link-${index}`, "vector", "use-to-band relationship"));
        document.constructions.push(construction(`build_${id}`, "point", { x: 3, y }, [id]), construction(`build_link-${index}`, "vector", { start: { x: 0.2, y: -selected.indexOf(use.band) * 1.5 }, end: { x: 2.6, y } }, [`link-${index}`]));
      }
      document.source.applications = uses;
      document.source.applicationReference = "https://ncert.nic.in/textbook/pdf/leph108.pdf, sections 8.4.1–8.4.7; use codes are explicit source semantics, not a question router";
      document.requiredEntityIds = document.entities.map(e => e.id);
      document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
      return document;
    },
  },
  {
    name: "emw.displacement",
    family: "transverse_field",
    scope: "solved",
    assumptions: "Ideal charging capacitor: id=eps0 dPhiE/dt. A linear homogeneous dielectric explicitly changes this to eps0 epsR dPhiE/dt. Uniform field and source area may independently bind dPhi=area*dE. Source conduction current and continuity=1 declare the ideal conductor/no-gap-conduction surface comparison, with ic=id; no continuity is inferred from an unlabeled arrow.",
    topics: [{ topicId: "physics|15|displacement-current", packet: "CH-26c", chapter, remaining: "Nonuniform polarization, leakage and fringe fields require separate source models. Shared topology/source admission and student lifecycle remain pending." }],
    keys: ["eps0", "dPhi", "conduction", "continuity", "dielectric", "epsR", "linear", "homogeneous", "area", "dE", "uniform"],
    ordinary: { eps0: 2, dPhi: 5 },
    altered: { eps0: 2, dPhi: 4 },
    rejections: [{ eps0: 2, dPhi: 0 }, { eps0: 0, dPhi: 5 }],
    build(inputs) {
      const v = inputsFor(inputs, ["eps0", "dPhi"], ["conduction", "continuity", "dielectric", "epsR", "linear", "homogeneous", "area", "dE", "uniform"]);
      positive(v.eps0, "eps0");
      const continuity = completeGroup(v, ["conduction", "continuity"]);
      if (continuity && v.continuity !== 1) throw new Error("the surface-current comparison needs explicit ideal-capacitor continuity");
      if (v.dPhi === 0 && !continuity) throw new Error("the changing-flux sketch requires nonzero displacement current; use a declared steady continuity comparison for zero");
      const dielectric = completeGroup(v, ["dielectric", "epsR", "linear", "homogeneous"]);
      if (dielectric && (v.dielectric !== 1 || v.linear !== 1 || v.homogeneous !== 1)) throw new Error("dielectric displacement current requires a declared linear homogeneous constitutive law");
      if (dielectric) positive(v.epsR!, "epsR");
      const uniform = completeGroup(v, ["area", "dE", "uniform"]);
      if (uniform) {
        positive(v.area!, "area");
        if (v.uniform !== 1) throw new Error("area*dE requires a uniform electric field and fixed area");
        agrees(v.dPhi!, checked(v.area! * v.dE!, "electric flux rate", v.dE !== 0), "supplied electric flux rate");
      }
      const id = checked(v.eps0! * (dielectric ? v.epsR! : 1) * v.dPhi!, "displacement current", v.dPhi !== 0);
      if (continuity) agrees(v.conduction!, id, "conduction versus displacement current");
      const certified: Record<string, number> = continuity ? { id, ic: v.conduction! } : { id };
      const currentSign = Math.sign(id);
      const document = sceneDocument({
        model: this.name, family: this.family, scope: this.scope, assumptions: this.assumptions, certified,
        entities: [entity("gap", "polygon", "capacitor gap"),
          labeled("plate-left", "polyline", "capacitor left plate", "plate"), entity("plate-right", "polyline", "capacitor right plate"),
          labeled("current", id === 0 ? "point" : "vector", "displacement current", id === 0 ? "Id = zero" : "Id")],
        constructions: [
          construction("gap", "rectangle", { center: { x: 0, y: 0 }, width: 0.4, height: 1.4 }, ["gap"]),
          construction("plate-left", "polyline", { points: [{ x: -0.24, y: -0.8 }, { x: -0.24, y: 0.8 }] }, ["plate-left"]),
          construction("plate-right", "polyline", { points: [{ x: 0.24, y: -0.8 }, { x: 0.24, y: 0.8 }] }, ["plate-right"]),
          construction("current", id === 0 ? "point" : "vector", id === 0 ? { x: 0, y: -1.2 } : { start: { x: -currentSign * 0.6, y: -1.2 }, end: { x: currentSign * 0.6, y: -1.2 } }, ["current"]),
        ],
      });
      if (continuity) {
        const ic = v.conduction!;
        document.entities.push(entity("wire", "polyline", "ideal conductor"), labeled("wire-surface", "circle", "wire-cut surface", "wire surface"), labeled("gap-surface", "circle", "gap-cut surface", "gap surface"), labeled("conduction", ic === 0 ? "point" : "vector", "wire conduction current", ic === 0 ? "Ic = zero" : "Ic"));
        document.constructions.push(
          construction("build_wire", "polyline", { points: [{ x: -2.4, y: 0 }, { x: -0.24, y: 0 }] }, ["wire"]),
          construction("build_wire-surface", "circle", { center: { x: -1.5, y: 0 }, radius: 0.3 }, ["wire-surface"]),
          construction("build_gap-surface", "circle", { center: { x: 0, y: 0 }, radius: 0.3 }, ["gap-surface"]),
          construction("build_conduction", ic === 0 ? "point" : "vector", ic === 0 ? { x: -1.5, y: -1.2 } : { start: { x: -1.5 - currentSign * 0.6, y: -1.2 }, end: { x: -1.5 + currentSign * 0.6, y: -1.2 } }, ["conduction"]),
        );
        document.source.surfaceCurrents = { wire: { conduction: ic, displacement: 0 }, gap: { conduction: 0, displacement: id }, surfaceOrientation: "same positive x normal; circles denote cuts schematically, not literal field lines", constitutiveModel: dielectric ? "D=eps0 epsR E, linear homogeneous" : "vacuum D=eps0 E" };
      }
      document.source.displacement = { electricFluxRate: v.dPhi, effectivePermittivity: v.eps0! * (dielectric ? v.epsR! : 1), area: v.area, electricFieldRate: v.dE, displayScaleIsNotMeasurement: true };
      document.requiredEntityIds = document.entities.map(e => e.id);
      document.revealGroups[0]!.entityIds = [...document.requiredEntityIds];
      return document;
    },
  },
];

export interface EmWaveSourceRole {
  readonly role: string;
  /** Canonical SI unit. Declaration/selection codes are dimensionless. */
  readonly unit: string;
  readonly kind: "quantity" | "declaration" | "selection";
  readonly sourceValues?: Readonly<Record<string, string>>;
  /** The binding unit must resolve from this source-declared choice; the
   * default unit must never silently certify the other unit's variant. */
  readonly unitByInput?: { readonly key: string; readonly cases: Readonly<Record<string, string>> };
}

export interface EmWaveSourceRule {
  /** All supplied predicates must hold. Presence means a supplied input key,
   * not truthiness (zero is a meaningful declaration/quantity value). */
  readonly when: {
    readonly presentAny?: readonly string[];
    readonly absentAll?: readonly string[];
    readonly equals?: Readonly<Record<string, number>>;
  };
  readonly requiredKeys?: readonly string[];
  readonly forbiddenKeys?: readonly string[];
  readonly requiredAnyGroup?: readonly (readonly string[])[];
  readonly assumptions?: readonly string[];
  readonly roleOverrides?: Readonly<Record<string, Partial<EmWaveSourceRole>>>;
}

export interface EmWaveSourceAdmission {
  readonly schemaVersion: "em-wave-source-admission/v1";
  readonly name: string;
  readonly resultKind: "scalar" | "representation";
  readonly closedInputs: true;
  readonly roles: Readonly<Record<string, EmWaveSourceRole>>;
  readonly optionalRoles: Readonly<Record<string, EmWaveSourceRole>>;
  /** Each group is all-or-none; conditionalRules may require a whole group. */
  readonly optionalGroups: readonly (readonly string[])[];
  readonly assumptions: readonly string[];
  readonly conditionalRules: readonly EmWaveSourceRule[];
  /** Possible outputs, not permission to invent absent variant outputs.
   * emWaveScalar returns exactly the selected variant's certified record. */
  readonly scalarOutputs: Readonly<Record<string, { readonly unit: string; readonly meaning: string }>>;
  readonly diagramClaims: readonly string[];
}

const quantityRole = (role: string, unit: string): EmWaveSourceRole => ({ role, unit, kind: "quantity" });
const declarationRole = (role: string, sourceValues: Record<string, string>): EmWaveSourceRole => ({ role, unit: "1", kind: "declaration", sourceValues });
const orientationRoles = {
  kSign: declarationRole("propagation sign", { "1": "along the declared positive propagation axis", "-1": "opposite the declared positive propagation axis" }),
  eSign: declarationRole("electric polarization sign", { "1": "along the declared positive transverse electric axis", "-1": "opposite the declared positive transverse electric axis" }),
  theta: quantityRole("propagation axis angle", "rad"),
};
const defaultOrientationRule: EmWaveSourceRule = { when: { absentAll: orientationKeys }, assumptions: ["propagation along positive x", "electric polarization along positive y", "right-handed xyz frame"] };
const spectrumUnit = { key: "boundUnit", cases: { "1": "Hz", "2": "m" } } as const;
const spectrumLimitRoles: Record<string, EmWaveSourceRole> = {
  ...Object.fromEntries(spectrumEdges.map((key, index) => [key, { ...quantityRole(`spectrum boundary ${index}`, "Hz"), unitByInput: spectrumUnit }])),
  ...Object.fromEntries(bands.flatMap(band => [[`${band}Min`, { ...quantityRole(`${band} lower band limit`, "Hz"), unitByInput: spectrumUnit }], [`${band}Max`, { ...quantityRole(`${band} upper band limit`, "Hz"), unitByInput: spectrumUnit }]])),
};

/** Serializable source contract; this is an input/output description, not a
 * model selector. Enum numbers encode source statements, never invented
 * quantitative givens. Shared admission must ground sourceValues and enforce
 * conditionalRules (including unit/role overrides) before evaluating scalars. */
export const emWaveSourceAdmissions: readonly EmWaveSourceAdmission[] = [
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.triad", resultKind: "representation", closedInputs: true,
    roles: { crossed: declarationRole("transverse electromagnetic fields", { "1": "E and B are mutually perpendicular and perpendicular to propagation" }) },
    optionalRoles: orientationRoles, optionalGroups: [orientationKeys], assumptions: ["transverse electromagnetic fields"],
    conditionalRules: [defaultOrientationRule, { when: { presentAny: orientationKeys }, assumptions: ["right-handed xyz frame"] }],
    scalarOutputs: {}, diagramClaims: ["physical E·B=E·k=B·k=0", "E×B along k", "dot/cross denotes signed Bz; apparent page angles are not proof"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.amplitude", resultKind: "scalar", closedInputs: true,
    roles: { c: quantityRole("wave speed", "m/s"), B: quantityRole("magnetic field amplitude", "T"), crossed: declarationRole("transverse electromagnetic fields", { "1": "E and B are mutually perpendicular and perpendicular to propagation" }) },
    optionalRoles: { ...orientationRoles, lambda: quantityRole("wavelength", "m"), phase: quantityRole("phase offset", "rad"), time: quantityRole("source time", "s") },
    optionalGroups: [orientationKeys, waveKeys], assumptions: ["plane wave", "transverse electromagnetic fields"],
    conditionalRules: [defaultOrientationRule, { when: { presentAny: orientationKeys }, assumptions: ["right-handed xyz frame"] }, { when: { presentAny: waveKeys }, requiredKeys: [...waveKeys, ...orientationKeys], assumptions: ["sinusoidal", "lossless isotropic propagation"] }],
    scalarOutputs: { E: { unit: "V/m", meaning: "electric amplitude E0=c B0" } },
    diagramClaims: ["shared source phase kSign*2πs/λ-2πft+phase", "frequency derived from source speed/wavelength", "physical frame samples retain E/B ratio independently of normalized trace heights"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.speed", resultKind: "scalar", closedInputs: true,
    roles: { mu0: quantityRole("vacuum permeability", "H/m"), eps0: quantityRole("vacuum permittivity", "F/m") },
    optionalRoles: { medium: declarationRole("propagation medium", { "0": "vacuum", "1": "source-defined isotropic material medium" }), isotropic: declarationRole("isotropic constitutive model", { "1": "isotropic" }), lossless: declarationRole("lossless constitutive model", { "1": "lossless" }), muR: quantityRole("relative permeability", "1"), epsR: quantityRole("relative permittivity", "1"), f: quantityRole("frequency", "Hz"), lambda: quantityRole("wavelength", "m") },
    optionalGroups: [["medium", "f"], ["isotropic", "lossless", "muR", "epsR"]], assumptions: ["electromagnetic propagation"],
    conditionalRules: [
      { when: { absentAll: ["medium", "isotropic", "lossless", "muR", "epsR", "f", "lambda"] }, assumptions: ["vacuum"] },
      { when: { presentAny: ["medium", "isotropic", "lossless", "muR", "epsR", "f", "lambda"] }, requiredKeys: ["medium", "f"] },
      { when: { equals: { medium: 0 } }, forbiddenKeys: ["isotropic", "lossless", "muR", "epsR"], assumptions: ["vacuum"] },
      { when: { equals: { medium: 1 } }, requiredKeys: ["isotropic", "lossless", "muR", "epsR"], assumptions: ["linear", "isotropic", "lossless", "nondispersive"] },
    ],
    scalarOutputs: { c: { unit: "m/s", meaning: "propagation speed (legacy key c denotes v in a medium)" }, n: { unit: "1", meaning: "medium index relative to supplied vacuum constants; extended variant only" }, f: { unit: "Hz", meaning: "source frequency; extended variant only" }, lambda: { unit: "m", meaning: "v/f; extended variant only" } },
    diagramClaims: ["positive source μ/ε establish v", "visible f and one-wavelength marker; distances and heights normalized independently of SI values"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.energy", resultKind: "scalar", closedInputs: true,
    roles: { eps0: quantityRole("vacuum permittivity", "F/m"), E: quantityRole("electric field magnitude", "V/m"), c: quantityRole("vacuum wave speed", "m/s") },
    optionalRoles: { convention: declarationRole("electric field convention", { "0": "instantaneous magnitude", "1": "sinusoidal peak amplitude with cycle-averaged energy", "2": "RMS amplitude with cycle-averaged energy" }), reflection: declarationRole("radiation surface model", { "0": "perfect absorber at normal incidence", "1": "perfect reflector at normal incidence" }), mu0: quantityRole("vacuum permeability", "H/m"), ...orientationRoles },
    optionalGroups: [orientationKeys], assumptions: ["vacuum", "plane wave"],
    conditionalRules: [
      defaultOrientationRule,
      { when: { presentAny: orientationKeys }, assumptions: ["right-handed xyz frame"] },
      { when: { presentAny: ["convention", "reflection", "mu0", ...orientationKeys] }, requiredKeys: ["convention"] },
      { when: { absentAll: ["convention", "reflection", "mu0", ...orientationKeys] }, assumptions: ["instantaneous field"] },
      { when: { equals: { convention: 0 } }, assumptions: ["instantaneous field"] },
      { when: { equals: { convention: 1 } }, assumptions: ["sinusoidal", "peak amplitude", "cycle average"], roleOverrides: { E: { role: "electric field peak amplitude" } } },
      { when: { equals: { convention: 2 } }, assumptions: ["RMS amplitude", "cycle average"], roleOverrides: { E: { role: "electric field RMS amplitude" } } },
      { when: { equals: { reflection: 0 } }, assumptions: ["normal incidence", "perfect absorber"] },
      { when: { equals: { reflection: 1 } }, assumptions: ["normal incidence", "perfect reflector"] },
    ],
    scalarOutputs: { u: { unit: "J/m^3", meaning: "total energy density under the declared field convention" }, momentum: { unit: "N*s/m^3", meaning: "vacuum momentum density u/c" }, intensity: { unit: "W/m^2", meaning: "energy flux magnitude u*c; instantaneous S or cycle-averaged intensity according to convention" }, uElectric: { unit: "J/m^3", meaning: "electric half of total energy" }, uMagnetic: { unit: "J/m^3", meaning: "magnetic half of total energy" }, B: { unit: "T", meaning: "magnetic field in the same amplitude convention E/c" }, pressure: { unit: "Pa", meaning: "u for normal absorption, 2u for normal ideal reflection; surface variant only" } },
    diagramClaims: ["visible S along physical k", "source-declared absorber/reflector is normal to S", "zero energy flux is a zero marker", "no material-medium momentum or oblique surface convention inferred"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.production", resultKind: "representation", closedInputs: true,
    roles: { q: quantityRole("source charge", "C"), a: quantityRole("signed source acceleration", "m/s^2") },
    optionalRoles: { antenna: declarationRole("antenna source model", { "1": "oscillating electric dipole antenna" }), farField: declarationRole("radiation observation regime", { "1": "far field" }), dipole: declarationRole("radiation approximation", { "1": "electric dipole approximation" }), length: quantityRole("antenna length", "m"), frequency: quantityRole("antenna frequency", "Hz"), axisAngle: quantityRole("acceleration axis angle", "rad"), outgoingAngle: quantityRole("observation direction angle", "rad") },
    optionalGroups: [["farField", "dipole", "axisAngle", "outgoingAngle"], ["antenna", "length", "frequency"]], assumptions: ["accelerated charge"],
    conditionalRules: [
      { when: { absentAll: ["farField", "dipole", "axisAngle", "outgoingAngle"] }, assumptions: ["acceleration axis along y"] },
      { when: { presentAny: ["farField", "dipole", "axisAngle", "outgoingAngle"] }, assumptions: ["electric dipole approximation", "far field", "right-handed xyz frame"] },
      { when: { presentAny: ["antenna", "length", "frequency"] }, requiredKeys: ["antenna", "length", "frequency", "farField", "dipole", "axisAngle", "outgoingAngle"], assumptions: ["oscillating antenna"] },
    ],
    scalarOutputs: {}, diagramClaims: ["charge-signed E direction follows n×(n×a)", "marked B follows n×E", "exact dipole-axis null has no nonzero field glyph", "source frequency does not invent power/wavelength/angular intensity"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.spectrum", resultKind: "representation", closedInputs: true,
    roles: { shown: declarationRole("spectrum drawing request", { "1": "draw the ordered electromagnetic spectrum" }) },
    optionalRoles: { order: declarationRole("spectrum display order", { "1": "increasing frequency", "-1": "increasing wavelength" }), boundUnit: declarationRole("source band unit", { "1": "frequency in Hz", "2": "wavelength in m" }), ...spectrumLimitRoles },
    optionalGroups: [spectrumEdges, spectrumIntervals], assumptions: ["electromagnetic spectrum"],
    conditionalRules: [
      { when: { presentAny: [...spectrumEdges, ...spectrumIntervals] }, requiredKeys: ["boundUnit"], assumptions: ["source-defined band limits"] },
      { when: { presentAny: spectrumEdges }, forbiddenKeys: spectrumIntervals },
      { when: { presentAny: spectrumIntervals }, forbiddenKeys: spectrumEdges },
      { when: { presentAny: ["boundUnit"] }, requiredAnyGroup: [spectrumEdges, spectrumIntervals] },
    ],
    scalarOutputs: {}, diagramClaims: ["visible f-increase radio→gamma and λ-increase gamma→radio arrows", "all widths are categorical, not metric/logarithmic", "source-defined independent interval overlaps preserved", "no numeric membership or decay/Moseley inference"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.applications", resultKind: "representation", closedInputs: true,
    roles: Object.fromEntries(bands.map(band => [band, { role: `${band} band selection`, unit: "1", kind: "selection" as const, sourceValues: { "0": "not selected for the source drawing", "1": `source explicitly selects ${band}` } }])),
    optionalRoles: { sourceContext: declarationRole("application source context", { "1": "the source explicitly asks the named band-specific use" }), useCode: declarationRole("electromagnetic application", { "1": "radio broadcast communication", "2": "microwave oven heating", "3": "X-ray medical imaging", "4": "infrared thermal imaging", "5": "visible vision", "6": "ultraviolet disinfection", "7": "gamma radiotherapy", "8": "microwave radar" }), useCode2: declarationRole("second electromagnetic application", { "1": "radio broadcast communication", "2": "microwave oven heating", "3": "X-ray medical imaging", "4": "infrared thermal imaging", "5": "visible vision", "6": "ultraviolet disinfection", "7": "gamma radiotherapy", "8": "microwave radar" }) },
    optionalGroups: [["useCode", "sourceContext"]], assumptions: ["source-defined electromagnetic bands"],
    conditionalRules: [{ when: { presentAny: ["useCode", "useCode2", "sourceContext"] }, requiredKeys: ["useCode", "sourceContext"], assumptions: ["source-defined application context"] }],
    scalarOutputs: {}, diagramClaims: ["every selected band has a matching supplied use in contextual variants", "band-only request claims no application relationship", "recall-only text decisions remain separate from a source drawing request"],
  },
  {
    schemaVersion: "em-wave-source-admission/v1", name: "emw.displacement", resultKind: "scalar", closedInputs: true,
    roles: { eps0: quantityRole("vacuum permittivity", "F/m"), dPhi: quantityRole("electric flux rate", "V*m/s") },
    optionalRoles: { conduction: quantityRole("conduction current", "A"), continuity: declarationRole("capacitor continuity model", { "1": "ideal conductor and insulating gap obey charging-current continuity" }), dielectric: declarationRole("capacitor dielectric model", { "1": "source-defined linear homogeneous dielectric" }), epsR: quantityRole("relative permittivity", "1"), linear: declarationRole("linear constitutive model", { "1": "linear" }), homogeneous: declarationRole("homogeneous dielectric model", { "1": "homogeneous" }), area: quantityRole("fixed capacitor area", "m^2"), dE: quantityRole("electric field rate", "V/m/s"), uniform: declarationRole("uniform electric field model", { "1": "uniform field over the fixed area" }) },
    optionalGroups: [["conduction", "continuity"], ["dielectric", "epsR", "linear", "homogeneous"], ["area", "dE", "uniform"]], assumptions: ["ideal capacitor"],
    conditionalRules: [
      { when: { absentAll: ["dielectric", "epsR", "linear", "homogeneous"] }, assumptions: ["vacuum gap"] },
      { when: { presentAny: ["dielectric", "epsR", "linear", "homogeneous"] }, assumptions: ["linear", "homogeneous", "D=eps0 epsR E"] },
      { when: { presentAny: ["conduction", "continuity"] }, assumptions: ["ideal conductor", "insulating gap", "current continuity", "same oriented surface normal"] },
      { when: { presentAny: ["area", "dE", "uniform"] }, assumptions: ["uniform", "fixed area"] },
      { when: { equals: { dPhi: 0 } }, requiredKeys: ["conduction", "continuity"], assumptions: ["steady state"] },
    ],
    scalarOutputs: { id: { unit: "A", meaning: "signed displacement current ε*dΦE/dt under the source constitutive law" }, ic: { unit: "A", meaning: "source conduction current, proved equal to id in a continuity variant" } },
    diagramClaims: ["wire-cut surface conduction versus capacitor-gap displacement", "current directions use signed values", "cut surfaces and display lengths are schematic", "leakage, fringe/nonuniform polarization models not inferred"],
  },
];

/** Root registration can use this evaluator without copying packet equations.
 * It applies the real model's complete-group/domain/consistency checks; source
 * role/unit/affirmative-assumption evidence must be verified before this call. */
export function emWaveScalar(name: string, inputs: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const model = emWaveModels.find(candidate => candidate.name === name);
  if (!model) throw new Error(`unknown EM-wave admission model ${name}`);
  const document = model.build({ ...inputs });
  const record = document.source.certified;
  if (typeof record !== "object" || record === null || Array.isArray(record)) throw new Error("EM-wave certified output record is missing");
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} is not a finite EM-wave scalar`);
    output[key] = value;
  }
  return output;
}
