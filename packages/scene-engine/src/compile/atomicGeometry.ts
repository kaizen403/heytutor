import type { RenderPoint, RenderPrimitive, SceneDocument, SceneIssue } from "../types";
import { deriveBohrOrbit } from "../physics/bohrOrbitAuthority";
import { deriveBohrTransition } from "../physics/bohrTransitionAuthority";
import { resolveElement } from "../chemistry/elements";
import { deriveNuclide, deriveNuclearMassDefect, deriveNuclearReaction, deriveRadioactiveDecay, deriveRutherfordScattering, MEV_PER_U, type DecayObservable, type NuclearParticipant } from "../physics/nuclearAuthority";
import { compactNumber, isRecord, placement, rejectUnknownKeys, validationNumber, type SourceContext } from "./sourceScalars";
import { readOriginalCoulombOperand } from "../physics/sourceCoulombObligation";

export const ATOMIC_OPERATORS = ["bohr_orbit", "bohr_transition", "radioactive_decay", "nuclide_state", "nuclear_reaction", "nuclear_binding_curve", "rutherford_scattering"] as const;
export const ATOMIC_OUTPUT_KINDS: Readonly<Record<string, readonly string[]>> = {
  bohr_orbit: ["circle", "point", "segment", "vector"], bohr_transition: ["segment", "segment", "vector"],
  radioactive_decay: ["polyline"], nuclide_state: ["circle"], nuclear_reaction: ["polyline"], nuclear_binding_curve: ["polyline"], rutherford_scattering: ["polyline"],
};
const ATOMIC_RESULT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  bohr_orbit: ["radius", "speed"], bohr_transition: ["energyFrom", "energyTo", "atomicDelta", "photonEnergy", "wavelengthNm", "seriesLowerN", "seriesLimitNm", "seriesLongestNm"],
  radioactive_decay: ["lambdaPerSecond", "initialObservable", "population", "activity", "fraction", "value"], nuclide_state: ["N", "radius", "massDefect", "bindingMeV", "bindingPerNucleonMeV"],
  nuclear_reaction: ["qMeV"], nuclear_binding_curve: ["maximumBinding"], rutherford_scattering: ["thetaDegrees", "closestApproach"],
};

export interface AtomicObservableDefinition {
  kind: (typeof ATOMIC_OPERATORS)[number];
  values: Readonly<Record<string, number>>;
  sourceRefs: string[];
  labels: Array<{ at: RenderPoint; text: string; resultFields?: readonly string[] }>;
  marks?: Array<{ kind: "circle" | "point" | "vector"; points: RenderPoint[]; radius?: number }>;
  observable?: DecayObservable | "binding_per_nucleon";
  timeUnit?: string;
  yUnit?: string;
  valueUnits?: Readonly<Record<string, string>>;
  resultBindings?: Readonly<Record<string, string>>;
  conditions?: readonly string[];
  plotCalibration?: { axesId: string; xMin: number; xMax: number; yMin: number; yMax: number; xUnit: string; yUnit: string; independentAxisScaling: true };
}
type Metadata = { atomicObservable: AtomicObservableDefinition };
export type AtomicGeometry =
  | ({ kind: "point"; point: RenderPoint } & Metadata)
  | ({ kind: "circle"; center: RenderPoint; radius: number } & Metadata)
  | ({ kind: "path"; points: RenderPoint[]; directed?: boolean; closed?: boolean; sampledCurve?: { curveKind: "parametric"; parameterMin: number; parameterMax: number; evaluate(t: number): RenderPoint; derivative(t: number): RenderPoint } } & Metadata)
  | ({ kind: "multi_path"; paths: RenderPoint[][] } & Metadata);

function failure(message: string): never { throw new Error(`atomic physical relation: ${message}`); }
function display(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e8 || value < 1e-8) failure(`${name} must be a positive bounded display scale`);
  return value;
}
function reference(value: unknown, field: string, document: SceneDocument, unit?: string): { value: number; id: string } {
  if (typeof value !== "string") failure(`${field} requires a source quantity id, never an invented literal`);
  const quantity = document.quantities.find(item => item.id === value);
  if (!quantity || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) failure(`${field} requires a finite source-backed quantity`);
  if (unit !== undefined && quantity.unit !== unit) failure(`${field} quantity unit must be exactly ${unit}`);
  if (unit === undefined && quantity.unit !== undefined && quantity.unit !== "1" && quantity.unit !== "count") failure(`${field} must be dimensionless`);
  return { value: quantity.value, id: value };
}
function origin(inputs: Record<string, unknown>, context: SourceContext): RenderPoint { return placement(inputs.origin, "origin", context); }
function metadata(kind: AtomicObservableDefinition["kind"], values: Record<string, number>, refs: string[], labels: AtomicObservableDefinition["labels"] = []): AtomicObservableDefinition {
  if (Object.values(values).some(value => !Number.isFinite(value))) failure("computed values must remain finite");
  return { kind, values, sourceRefs: [...new Set(refs)], labels };
}
function shifted(p: RenderPoint, x: number, y: number): RenderPoint { return { x: p.x + x, y: p.y + y }; }
function checkedSpecies(element: unknown, particle: unknown, A: number, Z: number): string | undefined {
  if (element !== undefined && particle !== undefined) failure("A participant cannot be both an element and an elementary particle");
  if (element !== undefined) {
    const known = typeof element === "string" ? resolveElement(element) : null;
    if (!known || known.z !== Z || A < Z || A === 0) failure("The element identity must agree with its independently known atomic number");
    return known.symbol;
  }
  if (particle !== undefined) {
    const inventory: Readonly<Record<string, readonly [number, number, string]>> = { neutron: [1, 0, "n"], proton: [1, 1, "p"], photon: [0, 0, "γ"], electron: [0, -1, "e⁻"], positron: [0, 1, "e⁺"] };
    const known = typeof particle === "string" && Object.hasOwn(inventory, particle) ? inventory[particle] : undefined;
    if (!known || known[0] !== A || known[1] !== Z) failure("The named particle must agree with its nucleon and charge inventory");
    return known[2];
  }
  return undefined;
}

function evaluateAtomicGeometry(operator: string, inputs: Record<string, unknown>, context: SourceContext, document: SceneDocument): AtomicGeometry[] {
  const p = origin(inputs, context);
  const ref = (name: string, unit?: string) => reference(inputs[name], name, document, unit);
  if (operator === "radioactive_decay") {
    rejectUnknownKeys(inputs, ["initial", "halfLife", "timeUnit", "observable", "tMin", "tMax", "origin", "timeScale", "ordinateScale", "axes", "at"]);
    const timeUnit = String(inputs.timeUnit), initial = ref("initial", "nuclei"), half = ref("halfLife", timeUnit);
    const observable = inputs.observable;
    if (!["population", "activity", "population_fraction", "activity_fraction"].includes(String(observable))) failure("decay requires an explicit population/activity observable");
    const tMin = inputs.tMin, tMax = inputs.tMax;
    if (typeof tMin !== "number" || typeof tMax !== "number" || tMin < 0 || !(tMax > tMin) || tMax / half.value > 128) failure("decay needs an explicit nonnegative bounded time domain");
    const start = deriveRadioactiveDecay(initial.value, half.value, 0, timeUnit, observable as DecayObservable);
    if (inputs.axes !== undefined && (inputs.timeScale !== undefined && inputs.timeScale !== 1 || inputs.ordinateScale !== undefined && inputs.ordinateScale !== 1)) failure("Axes-attached physical plots require native source coordinates");
    const timeScale = display(inputs.timeScale, "timeScale", inputs.axes === undefined ? 4 / tMax : 1), ordinateScale = display(inputs.ordinateScale, "ordinateScale", inputs.axes === undefined ? 2 / start.value : 1);
    const valueAt = (t: number) => deriveRadioactiveDecay(initial.value, half.value, t, timeUnit, observable as DecayObservable).value;
    const evaluate = (t: number) => shifted(p, t * timeScale, valueAt(t) * ordinateScale);
    const points = Array.from({ length: 129 }, (_, i) => evaluate(tMin + (tMax - tMin) * i / 128));
    const symbol = String(observable).startsWith("activity") ? "A" : "N";
    const yText = String(observable).endsWith("_fraction") ? `${symbol}/${symbol}₀` : `${symbol}(t) / ${start.unit}`;
    const info = metadata("radioactive_decay", { initial: initial.value, halfLife: half.value, lambdaPerSecond: start.lambdaPerSecond, initialObservable: start.value }, [initial.id, half.id], [
      { at: shifted(p, tMax * timeScale / 2, -0.3), text: `t / ${timeUnit}` },
      { at: shifted(p, 0, 2.3), text: yText },
      { at: shifted(p, tMax * timeScale / 2, 2.65), text: `T½ = ${compactNumber(half.value)} ${timeUnit}` },
    ]);
    info.observable = observable as DecayObservable; info.timeUnit = timeUnit; info.yUnit = start.unit;
    info.conditions = ["Single parent with constant decay probability; no production or daughter-chain contribution.", `Time coordinate is in ${timeUnit}; activity is lambda per second times population, in Bq.`, ...(String(observable).endsWith("_fraction") ? ["The vertical observable is normalized to its value at t=0."] : [])];
    info.valueUnits = { initial: "nuclei", halfLife: timeUnit, lambdaPerSecond: "s^-1", initialObservable: start.unit };
    if (inputs.at !== undefined) {
      const at = ref("at", timeUnit), state = deriveRadioactiveDecay(initial.value, half.value, at.value, timeUnit, observable as DecayObservable);
      info.sourceRefs.push(at.id);
      info.values = { ...info.values, population: state.population, activity: state.activity, fraction: state.fraction, value: state.value };
      info.valueUnits = { ...info.valueUnits, population: "nuclei", activity: "Bq", fraction: "1", value: state.unit };
      const resultSymbol = String(observable).endsWith("_fraction") ? `${symbol}/${symbol}₀` : symbol;
      info.labels.push({ at: shifted(p, tMax * timeScale / 2, -0.7), text: `${resultSymbol}(${compactNumber(at.value)} ${timeUnit})=${compactNumber(state.value)}${state.unit === "1" ? "" : ` ${state.unit}`}`,
        resultFields: ["value", String(observable).endsWith("_fraction") ? "fraction" : observable === "activity" ? "activity" : "population"] });
    }
    return [{ kind: "path", points, atomicObservable: info, sampledCurve: { curveKind: "parametric", parameterMin: tMin, parameterMax: tMax, evaluate, derivative: t => ({ x: timeScale, y: -Math.LN2 / half.value * valueAt(t) * ordinateScale }) } }];
  }
  if (operator === "nuclide_state") {
    rejectUnknownKeys(inputs, ["A", "Z", "element", "radiusConstant", "radiusUnit", "origin", "displayRadius", "boundMass", "constituentMass", "neutronMass", "massConvention", "massUnit", "energyPerU"]);
    const A = ref("A"), Z = ref("Z");
    const element = checkedSpecies(inputs.element, undefined, A.value, Z.value);
    const radiusUnit = inputs.radiusUnit;
    if (radiusUnit !== undefined && radiusUnit !== "m" && radiusUnit !== "fm") failure("radiusUnit must be m or fm");
    const r0 = inputs.radiusConstant === undefined ? undefined : ref("radiusConstant", String(radiusUnit));
    const state = deriveNuclide(A.value, Z.value, r0?.value, radiusUnit);
    const radius = display(inputs.displayRadius, "displayRadius", 1);
    const labels: AtomicObservableDefinition["labels"] = [{ at: shifted(p, 0, radius + 0.4), text: `A=${state.A}, Z=${state.Z}, N=${state.N}`, resultFields: ["N"] }];
    if (element) labels.push({ at: shifted(p, 0, radius + 0.8), text: `${state.A} ${element}` });
    if (state.radius !== undefined) labels.push({ at: shifted(p, 0, -radius - 0.4), text: `R≈${compactNumber(state.radius)} ${state.radiusUnit}`, resultFields: ["radius"] });
    const info = metadata("nuclide_state", { A: state.A, Z: state.Z, N: state.N, ...(state.radius === undefined ? {} : { radius: state.radius }) }, [A.id, Z.id, ...(r0 ? [r0.id] : [])], labels);
    info.valueUnits = { A: "1", Z: "1", N: "1", ...(radiusUnit === undefined ? {} : { radius: radiusUnit }) };
    info.conditions = ["A=Z+N; the displayed constituent groups identify counts without claiming a nucleon packing model.",
      ...(r0 ? ["R≈r₀ A^(1/3) is an empirical nuclear-size estimate using the stated radius constant, not a measured rms charge radius."] : [])];
    if (["boundMass", "constituentMass", "neutronMass", "massConvention", "massUnit"].some(key => inputs[key] !== undefined)) {
      if (inputs.massConvention !== "nuclear" && inputs.massConvention !== "atomic" || inputs.massUnit !== "u" && inputs.massUnit !== "kg") failure("Mass defect requires explicit nuclear/atomic convention and u/kg units");
      const bound = ref("boundMass", inputs.massUnit), constituent = ref("constituentMass", inputs.massUnit), neutron = ref("neutronMass", inputs.massUnit);
      const equivalent = inputs.energyPerU === undefined ? undefined : ref("energyPerU", "MeV/u");
      const mass = deriveNuclearMassDefect(A.value, Z.value, bound.value, constituent.value, neutron.value, inputs.massConvention, inputs.massUnit, equivalent?.value);
      info.values = { ...info.values, massDefect: mass.massDefect, bindingMeV: mass.bindingMeV, bindingPerNucleonMeV: mass.bindingPerNucleonMeV };
      info.valueUnits = { ...info.valueUnits, massDefect: inputs.massUnit, bindingMeV: "MeV", bindingPerNucleonMeV: "MeV/nucleon" };
      info.sourceRefs.push(bound.id, constituent.id, neutron.id, ...(equivalent ? [equivalent.id] : []));
      info.conditions = [...info.conditions, `Mass defect uses the ${inputs.massConvention} mass convention; constituentMass is ${inputs.massConvention === "atomic" ? "a hydrogen atom" : "a proton"}.`,
        ...(inputs.massConvention === "atomic" ? ["The nuclear binding-energy estimate from neutral-atom masses neglects electronic binding-energy corrections."] : []),
        `Mass-energy conversion: ${inputs.massUnit === "u" ? `${equivalent?.value ?? MEV_PER_U} MeV/u${equivalent ? " supplied by the source" : " (CODATA 2022 reference)"}` : "E=mc² with exact c and SI joule/eV conversion"}.`];
      info.labels.push({ at: shifted(p, 0, -radius - 0.8), text: `B=${compactNumber(mass.bindingMeV)} MeV`, resultFields: ["bindingMeV", "massDefect", "bindingPerNucleonMeV"] });
    }
    // Representative groups identify both constituents without claiming a spatial packing or a scale.
    info.marks = [...(state.Z ? [{ kind: "point" as const, points: [shifted(p, -radius / 3, 0)] }] : []), ...(state.N ? [{ kind: "point" as const, points: [shifted(p, radius / 3, 0)] }] : [])];
    info.labels.push({ at: shifted(p, -radius / 3, radius / 3), text: `${state.Z} p` }, { at: shifted(p, radius / 3, -radius / 3), text: `${state.N} n`, resultFields: ["N"] });
    return [{ kind: "circle", center: p, radius, atomicObservable: info }];
  }
  if (operator === "bohr_orbit") {
    rejectUnknownKeys(inputs, ["Z", "n", "groundRadius", "radiusUnit", "radiusConvention", "groundSpeed", "speedUnit", "speedConvention", "model", "electronCount", "origin", "displayRadius", "velocityLength"]);
    const Z = ref("Z"), n = ref("n"), r0 = ref("groundRadius", String(inputs.radiusUnit)), v0 = ref("groundSpeed", String(inputs.speedUnit));
    const state = deriveBohrOrbit({ model: inputs.model, electronCount: inputs.electronCount, Z: Z.value, n: n.value, groundRadius: r0.value, radiusUnit: inputs.radiusUnit, radiusConvention: inputs.radiusConvention, groundSpeed: v0.value, speedUnit: inputs.speedUnit, speedConvention: inputs.speedConvention });
    const radius = display(inputs.displayRadius, "displayRadius", 1), velocity = display(inputs.velocityLength, "velocityLength", 0.8);
    const electron = shifted(p, radius, 0);
    const info = metadata("bohr_orbit", { Z: state.Z, n: state.n, radius: state.radius, speed: state.speed }, [Z.id, n.id, r0.id, v0.id], [
      { at: shifted(p, 0, -radius - 0.4), text: `n=${state.n}; r=${compactNumber(state.radius)} ${state.radiusUnit}`, resultFields: ["radius"] },
      { at: shifted(p, radius + 0.8, velocity / 2), text: `v=${compactNumber(state.speed)} ${state.speedUnit}`, resultFields: ["speed"] },
    ]);
    info.valueUnits = { Z: "1", n: "1", radius: state.radiusUnit, speed: state.speedUnit };
    info.conditions = ["One-electron nonrelativistic hydrogenic Bohr orbit model; radius and speed follow the supplied ground-state reference conventions.",
      "The displayed circle is schematic; its screen radius is not a measurement of the independently computed physical radius."];
    return [{ kind: "circle", center: p, radius, atomicObservable: info }, { kind: "point", point: electron, atomicObservable: { ...info, labels: [] } },
      { kind: "path", points: [p, electron], atomicObservable: { ...info, labels: [] } }, { kind: "path", points: [electron, shifted(electron, 0, velocity)], directed: true, atomicObservable: { ...info, labels: [] } }];
  }
  if (operator === "bohr_transition") {
    rejectUnknownKeys(inputs, ["Z", "nFrom", "nTo", "bindingEnergy", "energyUnit", "bindingEnergyConvention", "model", "electronCount", "direction", "origin", "displayScale"]);
    const Z = ref("Z"), from = ref("nFrom"), to = ref("nTo"), binding = ref("bindingEnergy", String(inputs.energyUnit));
    const state = deriveBohrTransition({ model: inputs.model, electronCount: inputs.electronCount, Z: Z.value, nFrom: from.value, nTo: to.value, bindingEnergy: binding.value, bindingEnergyConvention: inputs.bindingEnergyConvention, energyUnit: inputs.energyUnit, ...(inputs.direction === undefined ? {} : { direction: inputs.direction }) });
    const scale = display(inputs.displayScale, "displayScale", 2 / Math.max(Math.abs(state.energyFrom), Math.abs(state.energyTo)));
    const a = shifted(p, 0, state.energyFrom * scale), b = shifted(p, 0, state.energyTo * scale);
    const info = metadata("bohr_transition", { energyFrom: state.energyFrom, energyTo: state.energyTo, atomicDelta: state.atomicDelta, photonEnergy: state.photonEnergy }, [Z.id, from.id, to.id, binding.id], [
      { at: shifted(a, -0.5, 0.3), text: `n=${state.nFrom}: ${compactNumber(state.energyFrom)} ${state.energyUnit}`, resultFields: ["energyFrom"] },
      { at: shifted(b, 3, -0.3), text: `n=${state.nTo}: ${compactNumber(state.energyTo)} ${state.energyUnit}`, resultFields: ["energyTo"] },
      { at: shifted(p, 1, Math.min(a.y, b.y) - p.y - 0.8), text: `${state.direction}; Eγ=${compactNumber(state.photonEnergy)} ${state.energyUnit}`, resultFields: ["photonEnergy", "atomicDelta", "wavelengthNm"] },
    ]);
    info.valueUnits = Object.fromEntries(Object.keys(info.values).map(key => [key, state.energyUnit]));
    const lowerN = Math.min(state.nFrom, state.nTo), referenceJ = state.bindingEnergy * (state.energyUnit === "eV" ? 1.602176634e-19 : 1) * (state.bindingEnergyConvention === "hydrogen_reference" ? state.Z ** 2 : 1);
    const hc = 6.62607015e-34 * 299792458;
    info.values = { ...info.values, wavelengthNm: hc / state.photonEnergyJ * 1e9, seriesLowerN: lowerN, seriesLimitNm: hc * lowerN ** 2 / referenceJ * 1e9, seriesLongestNm: hc / (referenceJ * (1 / lowerN ** 2 - 1 / (lowerN + 1) ** 2)) * 1e9 };
    info.valueUnits = { ...info.valueUnits, wavelengthNm: "nm", seriesLowerN: "1", seriesLimitNm: "nm", seriesLongestNm: "nm" };
    info.conditions = ["One-electron hydrogenic Bohr model; level energies are negative relative to ionization.", `The source reference is ${state.bindingEnergyConvention}; emission lowers atomic energy and absorption raises it.`,
      "The signed atomic change is E_final−E_initial. Photon energy is positive: E_initial−E_final for emission, E_final−E_initial for absorption.",
      "Wavelengths derived from hc/E are vacuum wavelengths; no air or additional reduced-mass correction is silently applied to the supplied energy reference.",
      `For this lower level n=${lowerN}, the series wavelengths approach ${compactNumber(info.values.seriesLimitNm!)} nm from above and extend to ${compactNumber(info.values.seriesLongestNm!)} nm. Visibility must be checked per line; a series is not entirely visible merely because some lines are visible.`];
    return [{ kind: "path", points: [a, shifted(a, 2, 0)], atomicObservable: info }, { kind: "path", points: [b, shifted(b, 2, 0)], atomicObservable: { ...info, labels: [] } }, { kind: "path", points: [shifted(a, 1, 0), shifted(b, 1, 0)], directed: true, atomicObservable: { ...info, labels: [] } }];
  }
  if (operator === "nuclear_reaction") {
    rejectUnknownKeys(inputs, ["initial", "final", "massConvention", "massUnit", "energyPerU", "origin"]);
    if (inputs.massConvention !== "atomic" && inputs.massConvention !== "nuclear") failure("massConvention must be atomic or nuclear");
    const refs: string[] = [];
    const side = (value: unknown): NuclearParticipant[] => {
      if (!Array.isArray(value) || value.length < 1 || value.length > 12) failure("reaction participants must form a bounded array");
      return value.map(item => {
        if (!isRecord(item)) failure("reaction participant must be a source inventory");
        rejectUnknownKeys(item, ["A", "Z", "count", "mass", "element", "particle"]);
        const A = reference(item.A, "participant A", document), Z = reference(item.Z, "participant Z", document);
        const count = item.count === undefined ? undefined : reference(item.count, "participant count", document);
        const mass = item.mass === undefined ? undefined : reference(item.mass, "participant mass", document, String(inputs.massUnit));
        const element = checkedSpecies(item.element, item.particle, A.value, Z.value);
        if (item.particle === "photon" && mass && mass.value !== 0) failure("A photon has zero rest mass; its radiation energy cannot be used as a positive rest mass");
        refs.push(A.id, Z.id, ...(count ? [count.id] : []), ...(mass ? [mass.id] : []));
        return { A: A.value, Z: Z.value, ...(element ? { element } : {}), ...(count ? { count: count.value } : {}), ...(mass ? { mass: mass.value } : {}) };
      });
    };
    const equivalent = inputs.energyPerU === undefined ? undefined : ref("energyPerU", "MeV/u");
    if (equivalent) refs.push(equivalent.id);
    const state = deriveNuclearReaction(side(inputs.initial), side(inputs.final), inputs.massConvention, inputs.massUnit as "u" | "kg" | undefined, equivalent?.value);
    const paths: RenderPoint[][] = [], marks: NonNullable<AtomicObservableDefinition["marks"]> = [], labels: AtomicObservableDefinition["labels"] = [];
    for (const [items, x, tipX] of [[state.reactants, 0, 2], [state.products, 5, 3]] as const) {
      items.forEach((item, index) => {
        const at = shifted(p, x, (index - (items.length - 1) / 2) * 1.4);
        marks.push({ kind: item.A === 0 ? "point" : "circle", points: [at], radius: 0.2 });
        paths.push([at, shifted(p, tipX, 0)]);
        labels.push({ at: shifted(at, x === 0 ? -0.8 : 0.8, 0.45), text: `${item.count > 1 ? `${item.count}× ` : ""}${item.element ? `${item.element}; ` : ""}A=${item.A}, Z=${item.Z}` });
      });
    }
    marks.push({ kind: "vector", points: [shifted(p, 2, 0), shifted(p, 3, 0)] });
    if (state.qMeV !== undefined) labels.push({ at: shifted(p, 2.5, -1.5), text: `Q=${compactNumber(state.qMeV)} MeV`, resultFields: ["qMeV"] });
    const info = metadata("nuclear_reaction", { A: state.totalA, Z: state.totalZ, ...(state.qMeV === undefined ? {} : { qMeV: state.qMeV }) }, refs, labels); info.marks = marks;
    info.valueUnits = { A: "1", Z: "1", qMeV: "MeV" };
    info.conditions = [`Conserves total nucleon number and charge in supported strong/electromagnetic channels; masses consistently use the ${inputs.massConvention} convention.`,
      "Conservation sums include every incident reactant and every emitted product, with each particle's multiplicity, mass number and charge number.",
      "Reaction Q is a total rest-energy difference; individual product energies and laboratory thresholds also require momentum/recoil authority.",
      ...(inputs.massConvention === "atomic" ? ["Neutral-atom electron counts cancel with conserved Z; no electronic binding-energy correction to bare nuclear Q is supplied."] : []),
      ...(state.qMeV === undefined ? ["No numerical reaction Q is certified without all participant masses."] : [`Q=(initial rest mass−final rest mass)c²; ${state.qMeV === 0 ? "Q=0 has no net rest-energy difference" : `Q ${state.qMeV > 0 ? "releases" : "requires"} energy`}.`, `Mass-energy conversion: ${inputs.massUnit === "u" ? `${equivalent?.value ?? MEV_PER_U} MeV/u` : "exact c with SI joule/eV conversion"}.`])];
    return [{ kind: "multi_path", paths, atomicObservable: info }];
  }
  if (operator === "nuclear_binding_curve") {
    rejectUnknownKeys(inputs, ["samples", "origin", "massNumberScale", "bindingScale", "axes"]);
    if (!Array.isArray(inputs.samples) || inputs.samples.length < 2 || inputs.samples.length > 80) failure("binding curve requires 2..80 source samples");
    const refs: string[] = [];
    const samples = inputs.samples.map(item => {
      if (!isRecord(item)) failure("binding sample requires A and bindingPerNucleon");
      rejectUnknownKeys(item, ["A", "bindingPerNucleon"]);
      const A = reference(item.A, "sample A", document), binding = reference(item.bindingPerNucleon, "sample B/A", document, "MeV/nucleon");
      deriveNuclide(A.value, 0);
      if (!(binding.value >= 0 && binding.value < 10)) failure("binding per nucleon lies outside the supported source data range");
      refs.push(A.id, binding.id); return { A: A.value, binding: binding.value };
    });
    if (samples.some((sample, i) => i > 0 && sample.A <= samples[i - 1]!.A)) failure("binding samples must have strictly increasing positive mass numbers");
    const maxA = samples.at(-1)!.A, maxBinding = Math.max(...samples.map(item => item.binding));
    if (!(maxBinding > 0)) failure("binding plot requires a nonzero ordinate range");
    if (inputs.axes !== undefined && (inputs.massNumberScale !== undefined && inputs.massNumberScale !== 1 || inputs.bindingScale !== undefined && inputs.bindingScale !== 1)) failure("Axes-attached physical plots require native source coordinates");
    const sx = display(inputs.massNumberScale, "massNumberScale", inputs.axes === undefined ? 5 / maxA : 1), sy = display(inputs.bindingScale, "bindingScale", inputs.axes === undefined ? 3 / maxBinding : 1);
    const points = samples.map(item => shifted(p, item.A * sx, item.binding * sy));
    const info = metadata("nuclear_binding_curve", { maximumBinding: maxBinding }, refs, [{ at: shifted(p, 2.5, -0.35), text: "Mass number A" }, { at: shifted(p, 2.5, 3.4), text: "B/A / MeV per nucleon" }]);
    info.observable = "binding_per_nucleon"; info.yUnit = "MeV/nucleon"; info.valueUnits = { maximumBinding: "MeV/nucleon" };
    return [{ kind: "path", points, atomicObservable: info }];
  }
  if (operator === "rutherford_scattering") {
    rejectUnknownKeys(inputs, ["model", "projectileCharge", "targetCharge", "kEnergyLength", "energy", "impactParameter", "origin", "displayScale"]);
    if (inputs.model !== "fixed_target_coulomb") failure("Rutherford requires the explicit classical fixed_target_coulomb model");
    // Elementary-charge quantities retain their plan ids and units. Only the
    // original-source physical proof interprets their values as q/e counts;
    // no global charge conversion or candidate-authored premise is added.
    const charge = (field: "projectileCharge" | "targetCharge") => {
      const operand = readOriginalCoulombOperand(document, field, inputs[field]);
      if (!operand || !operand.id) failure(`${field} requires the original-source elementary-charge count in unit e or 1`);
      return { value: operand.value, id: operand.id };
    };
    const q = charge("projectileCharge"), Z = charge("targetCharge"), k = ref("kEnergyLength", "MeV fm"), E = ref("energy", "MeV");
    const b = inputs.impactParameter === undefined
      ? readOriginalCoulombOperand(document, "impactParameter", undefined)
      : ref("impactParameter", "fm");
    if (!b) failure("An omitted impactParameter requires an unambiguous original-source head-on premise");
    const state = deriveRutherfordScattering(q.value, Z.value, k.value, E.value, b.value);
    const scale = display(inputs.displayScale, "displayScale", 1 / state.closestApproach);
    let points: RenderPoint[];
    let sampledCurve: Extract<AtomicGeometry, { kind: "path" }>["sampledCurve"];
    if (b.value === 0) {
      // Incoming motion ends at the computed turning point. The outgoing
      // branch retraces the same line and is not drawn as a second stroke.
      points = [shifted(p, 6 * state.closestApproach * scale, 0), shifted(p, state.closestApproach * scale, 0)];
    } else {
      // Hyperbolic coordinates avoid subtracting eccentricity*cos(angle)-1,
      // which loses the closest approach as b/a tends to zero.
      const focalDistance = Math.hypot(state.a, b.value);
      const outerRadius = 8 * state.closestApproach;
      const bound = Math.acosh((outerRadius - state.a) / focalDistance);
      const evaluate = (parameter: number) => shifted(p, (focalDistance + state.a * Math.cosh(parameter)) * scale, b.value * Math.sinh(parameter) * scale);
      points = Array.from({ length: 129 }, (_, i) => evaluate(-bound + 2 * bound * i / 128));
      sampledCurve = { curveKind: "parametric", parameterMin: -bound, parameterMax: bound, evaluate,
        derivative: parameter => ({ x: state.a * Math.sinh(parameter) * scale, y: b.value * Math.cosh(parameter) * scale }) };
    }
    const info = metadata("rutherford_scattering", { thetaDegrees: state.thetaDegrees, closestApproach: state.closestApproach, impactParameter: b.value }, [q.id, Z.id, k.id, E.id, ...(b.id ? [b.id] : [])], [
      { at: shifted(p, 2, -1.2), text: `θ=${compactNumber(state.thetaDegrees)}°`, resultFields: ["thetaDegrees"] }, { at: shifted(p, 2, 1.2), text: `r_min=${compactNumber(state.closestApproach)} fm`, resultFields: ["closestApproach"] },
      { at: shifted(p, 2, -2), text: "Classical fixed heavy point-target Coulomb model" },
      { at: shifted(p, 0, -0.45), text: b.value === 0 ? `${Z.value > 0 ? "Positive" : "Negative"} point target; size not modelled` : "Point target; size not modelled" },
      ...(b.value === 0 ? [{ at: shifted(p, state.closestApproach * scale, 0.4), text: "Turning point", resultFields: ["closestApproach"] }] : []),
      ...(b.value === 0 ? [
        { at: shifted(p, 6 * state.closestApproach * scale, 0.45), text: `Incoming ${q.value > 0 ? "positive" : "negative"} projectile` },
      ] : []),
    ]);
    info.marks = [{ kind: "point", points: [p] }, ...(b.value === 0 ? [
      { kind: "point" as const, points: [points.at(-1)!] },
      { kind: "point" as const, points: [points[0]!] },
    ] : [])];
    info.valueUnits = { thetaDegrees: "deg", closestApproach: "fm", impactParameter: "fm" };
    info.conditions = ["Classical nonrelativistic repulsive point-charge scattering with a fixed heavy target; recoil and nuclear forces are excluded.", "The trajectory and deflection are independently derived from the stated energy, impact parameter and Coulomb coupling."];
    return [{ kind: "path", points, closed: false, ...(sampledCurve ? { sampledCurve } : {}), directed: true, atomicObservable: info }];
  }
  throw new Error(`unsupported atomic operator ${operator}`);
}

export function evaluateAtomicConstruction(operator: string, rawInputs: Record<string, unknown>, context: SourceContext, document: SceneDocument): AtomicGeometry[] {
  const { resultBindings, ...inputs } = rawInputs;
  const result = evaluateAtomicGeometry(operator, inputs, context, document);
  if (resultBindings !== undefined) {
    if (!isRecord(resultBindings) || Object.entries(resultBindings).some(([field, id]) => !ATOMIC_RESULT_FIELDS[operator]?.includes(field) || !Object.hasOwn(result[0]!.atomicObservable.values, field) || typeof id !== "string" || !id.trim() || id.length > 300)) failure("resultBindings maps only derived result fields, never raw input echoes, to explicit plan quantity ids");
    for (const output of result) output.atomicObservable.resultBindings = resultBindings as Record<string, string>;
  }
  if (inputs.axes !== undefined && (typeof inputs.axes !== "string" || !document.entities.some(entity => entity.id === inputs.axes && entity.kind === "axes"))) failure("Physical plot axes must name a constructed axes entity");
  if (typeof inputs.axes === "string") {
    if (operator !== "radioactive_decay" && operator !== "nuclear_binding_curve") failure("Only a typed physical plot can attach calibrated axes");
    const axes = document.constructions.find(construction => construction.operator === "axes" && construction.outputs.includes(inputs.axes as string));
    if (!axes) failure("Physical plot axes need an axes construction");
    const bounds = Object.fromEntries(["xMin", "xMax", "yMin", "yMax"].map(key => [key, context.number(axes.inputs[key])]));
    const { xMin, xMax, yMin, yMax } = bounds as Record<"xMin" | "xMax" | "yMin" | "yMax", number>;
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite) || !(xMax > xMin) || !(yMax > yMin)) failure("Physical plot axes require finite increasing native source bounds");
    const p = origin(inputs, context);
    if (p.x !== 0 || p.y !== 0) failure("Axes-attached physical plot origin must be the native coordinate origin");
    const points = result.flatMap(value => value.kind === "path" ? value.points : []);
    if (!points.length || points.some(point => point.x < xMin || point.x > xMax || point.y < yMin || point.y > yMax)) failure("Physical curve must fit its stated native-unit axis bounds");
    const calibration = { axesId: inputs.axes, xMin, xMax, yMin, yMax, xUnit: operator === "radioactive_decay" ? String(inputs.timeUnit) : "1", yUnit: result[0]!.atomicObservable.yUnit!, independentAxisScaling: true as const };
    for (const output of result) {
      output.atomicObservable.plotCalibration = calibration;
      // Axes own their titles. Engine-derived values use relative native ranges.
      output.atomicObservable.labels = output.atomicObservable.labels.filter(label => !label.text.startsWith("t /") && !label.text.includes("(t) /") && !label.text.includes("N/N") && !label.text.includes("A/A") && label.text !== "Mass number A" && !label.text.startsWith("B/A /"))
        .map((label, index) => ({ ...label, at: { x: (xMin + xMax) / 2, y: yMin - (index + 1) * (yMax - yMin) * 0.12 } }));
    }
  }
  return result;
}

/** The validation and compilation paths share one parser and one scalar authority. */
export function validateAtomicConstruction(operator: string, inputs: Record<string, unknown>, document: SceneDocument, path: string): SceneIssue[] {
  if (!(ATOMIC_OPERATORS as readonly string[]).includes(operator)) return [];
  try {
    evaluateAtomicConstruction(operator, inputs, { number: value => validationNumber(value, document), geometry: () => undefined, point: value => {
      if (typeof value !== "string" || !document.entities.some(entity => entity.id === value && entity.kind === "point")) failure("origin must name a constructed point");
      return { x: 0, y: 0 };
    } }, document);
    return [];
  } catch (error) { return [{ code: "invalid_atomic_source", message: error instanceof Error ? error.message : String(error), path, severity: "fatal" }]; }
}

export function atomicExtraPrimitives(info: AtomicObservableDefinition, entityId: string, groupId: string, transform: (p: RenderPoint) => RenderPoint): RenderPrimitive[] {
  return [
    ...info.labels.map((label, i): RenderPrimitive => ({ id: `${entityId}_physical_label_${i}`, entityId, groupId, kind: "label", points: [transform(label.at)], text: label.text,
      provenance: { atomicOperator: info.kind, atomicSourceRefs: info.sourceRefs, atomicValues: info.values, atomicValueUnits: info.valueUnits,
        atomicLabelBinding: { version: "atomic-label/v1", fields: label.resultFields ?? [], resultIds: (label.resultFields ?? []).flatMap(field => info.resultBindings?.[field] ? [info.resultBindings[field]!] : []) },
        ...(info.plotCalibration ? { atomicPlotCalibration: info.plotCalibration } : {}) } })),
    ...(info.marks ?? []).map((mark, i): RenderPrimitive => ({ id: `${entityId}_physical_mark_${i}`, entityId, groupId, kind: mark.kind, points: mark.points.map(transform), ...(mark.radius === undefined ? {} : { radius: Math.abs(transform({ x: mark.points[0]!.x + mark.radius, y: mark.points[0]!.y }).x - transform(mark.points[0]!).x) }), provenance: { atomicOperator: info.kind } })),
  ];
}

export interface AtomicPlotDescriptor {
  x: { symbol: string; unit: string; titles: readonly string[] };
  y: { symbol: string; unit: string; titles: readonly string[] };
  observable: string;
}

/** Operator identity and checked units, not model-authored axis strings, declare an observable. */
export function describeAtomicPlot(construction: SceneDocument["constructions"][number], document: SceneDocument): AtomicPlotDescriptor | null {
  if (construction.operator !== "radioactive_decay" && construction.operator !== "nuclear_binding_curve") return null;
  if (validateAtomicConstruction(construction.operator, construction.inputs, document, "constructions").length) return null;
  if (construction.operator === "nuclear_binding_curve") return {
    x: { symbol: "A", unit: "1", titles: ["A", "Mass number A", "Mass number"] },
    y: { symbol: "B/A", unit: "MeV/nucleon", titles: ["B/A", "Binding energy per nucleon", "Binding energy/nucleon"] }, observable: "binding_per_nucleon",
  };
  const observable = String(construction.inputs.observable), activity = observable.startsWith("activity"), normalized = observable.endsWith("_fraction");
  return {
    x: { symbol: "t", unit: String(construction.inputs.timeUnit), titles: ["t", "Time", "time t"] },
    y: { symbol: normalized ? activity ? "A/A₀" : "N/N₀" : activity ? "A" : "N", unit: normalized ? "1" : activity ? "Bq" : "nuclei", titles: normalized ? activity ? ["A/A₀", "A/A0", "Normalized activity"] : ["N/N₀", "N/N0", "Remaining fraction"] : activity ? ["A", "A(t)", "Activity", "Activity A"] : ["N", "N(t)", "Undecayed nuclei", "Number of nuclei"] },
    observable,
  };
}
