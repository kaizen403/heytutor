import { registerModelAdmission, type InputRole, type ModelAdmission } from "./admission";
import { positive } from "./sceneKit";

/**
 * Source-grounded admissions for the Current Electricity law models.
 * Each scalar recomputes the builder's certified outputs from grounded
 * inputs and rejects the same inputs the builder rejects, so the explicit
 * physical-model path can never pair a correct figure with stale planner
 * numbers. Registered at module load; `agent1-current-laws.ts` imports this
 * file, so the registrations ride every consumer import.
 */

type Certified = (values: Record<string, number>) => Record<string, number>;

/** A grounded scalar receives exactly the model's keys as finite numbers. */
function groundedInputs(inputs: Readonly<Record<string, number>>, keys: readonly string[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${key} is not a grounded finite number`);
    }
    values[key] = value;
  }
  return values;
}

function boundedPairIndices(v: Readonly<Record<string, number>>, first: string, second: string, start: number, staticKeys: readonly string[] = []): number[] {
  const allowedStatic = new Set(staticKeys);
  const indices = new Set<number>();
  for (const key of Object.keys(v)) {
    if (allowedStatic.has(key)) continue;
    const match = new RegExp(`^(?:${first}|${second})(0|[1-9][0-9]*)$`).exec(key);
    if (!match) throw new Error(`unsupported sequence input ${key}`);
    indices.add(Number(match[1]));
  }
  const ordered = [...indices].sort((left, right) => left - right);
  if (ordered.length < 1 || ordered.length > 12 || ordered.some((index, offset) => index !== start + offset)) {
    throw new Error("source sequence must be contiguous and contain between 1 and 12 items");
  }
  for (const index of ordered) {
    for (const prefix of [first, second]) {
      const value = v[`${prefix}${index}`];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`sequence item ${index} is incomplete`);
    }
  }
  return ordered;
}

export const driftCertified: Certified = (v) => {
  positive(v.n, "n");
  positive(v.e, "e");
  positive(v.A, "A");
  if (v.vd < 0) throw new Error("vd sign is a separate reference and is not inferred here");
  return { I: v.n * v.e * v.A * v.vd };
};

export const currentDensityCertified: Certified = (v) => {
  positive(v.A, "A");
  positive(v.E, "E");
  if (v.vd < 0 || v.I < 0) throw new Error("negative current or drift needs an explicit reference axis");
  return { J: v.I / v.A, mu: v.vd / v.E };
};

export const powerCertified: Certified = (v) => {
  positive(v.R, "R");
  if (v.I < 0) throw new Error("negative current is not this power model");
  if (v.V !== v.I * v.R) throw new Error("V, I, and R are inconsistent");
  return { P: v.I * v.V };
};

export const jouleCertified: Certified = (v) => {
  positive(v.R, "R");
  if (v.t < 0 || v.I < 0) throw new Error("time and current must be nonnegative in this heating interval");
  return { H: v.I * v.I * v.R * v.t };
};

export const resistivityCertified: Certified = (v) => {
  positive(v.rho, "rho");
  return { sigma: 1 / v.rho };
};

export const resistanceCertified: Certified = (v) => {
  positive(v.rho, "rho");
  positive(v.L, "L");
  positive(v.A, "A");
  return { R: v.rho * v.L / v.A };
};

export const temperatureCertified: Certified = (v) => {
  positive(v.R0, "R0");
  const R = v.R0 * (1 + v.alpha * v.dT);
  if (!(R > 0)) throw new Error("the linear law left the positive-resistance domain");
  return { R };
};

export const cellCertified: Certified = (v) => {
  if (v.r < 0 || v.I < 0 || v.E <= 0) throw new Error("discharge cell inputs must keep E positive, I nonnegative, and r nonnegative");
  const V = v.E - v.I * v.r;
  if (V < 0) throw new Error("terminal voltage went negative; charging is not this model");
  return { V };
};

export const ivOhmicCertified: Certified = (v) => {
  if (!(v.v1 > 0) || v.v2 !== 2 * v.v1) throw new Error("an ohmic ray through the origin requires v2 = 2 v1 and v1 > 0");
  return { v1: v.v1, v2: v.v2, slope: v.v1 };
};

export const ivDeclaredCertified: Certified = (v) => {
  if (v.y2 === 2 * v.y1) throw new Error("collinear origin data belongs to ce.iv_ohmic, not a declared non-ohmic characteristic");
  return {};
};

registerModelAdmission({
  name: "ce.drift",
  roles: {
    n: { role: "carrier number density", unit: "per m^3" },
    e: { role: "carrier charge", unit: "C" },
    A: { role: "cross-section area", unit: "m^2" },
    vd: { role: "drift velocity", unit: "m/s" },
  },
  assumptions: ["uniform", "conventional current"],
  scalar: (inputs) => driftCertified(groundedInputs(inputs, ["n", "e", "A", "vd"])),
});

registerModelAdmission({
  name: "ce.current_density",
  roles: {
    I: { role: "current", unit: "A" },
    A: { role: "cross-section area", unit: "m^2" },
    vd: { role: "drift velocity", unit: "m/s" },
    E: { role: "electric field", unit: "V/m" },
  },
  assumptions: ["uniform"],
  scalar: (inputs) => currentDensityCertified(groundedInputs(inputs, ["I", "A", "vd", "E"])),
});

registerModelAdmission({
  name: "ce.power",
  roles: {
    I: { role: "current", unit: "A" },
    R: { role: "resistance", unit: "ohm" },
    V: { role: "voltage", unit: "V" },
  },
  assumptions: ["steady"],
  scalar: (inputs) => powerCertified(groundedInputs(inputs, ["I", "R", "V"])),
});

registerModelAdmission({
  name: "ce.joule",
  roles: {
    I: { role: "current", unit: "A" },
    R: { role: "resistance", unit: "ohm" },
    t: { role: "time", unit: "s" },
  },
  assumptions: ["constant"],
  scalar: (inputs) => jouleCertified(groundedInputs(inputs, ["I", "R", "t"])),
});

registerModelAdmission({
  name: "ce.resistivity",
  roles: {
    rho: { role: "resistivity", unit: "ohm m" },
  },
  assumptions: ["isotropic"],
  scalar: (inputs) => resistivityCertified(groundedInputs(inputs, ["rho"])),
});

registerModelAdmission({
  name: "ce.resistance",
  roles: {
    rho: { role: "resistivity", unit: "ohm m" },
    L: { role: "length", unit: "m" },
    A: { role: "cross-section area", unit: "m^2" },
  },
  assumptions: ["uniform"],
  scalar: (inputs) => resistanceCertified(groundedInputs(inputs, ["rho", "L", "A"])),
});

registerModelAdmission({
  name: "ce.temperature",
  roles: {
    R0: { role: "reference resistance", unit: "ohm" },
    alpha: { role: "temperature coefficient", unit: "per degree Celsius" },
    dT: { role: "temperature rise", unit: "degree Celsius" },
  },
  assumptions: ["linear"],
  scalar: (inputs) => temperatureCertified(groundedInputs(inputs, ["R0", "alpha", "dT"])),
});

registerModelAdmission({
  name: "ce.cell",
  roles: {
    E: { role: "emf", unit: "V" },
    I: { role: "current", unit: "A" },
    r: { role: "internal resistance", unit: "ohm" },
  },
  assumptions: ["discharging"],
  scalar: (inputs) => cellCertified(groundedInputs(inputs, ["E", "I", "r"])),
});

registerModelAdmission({
  name: "ce.iv_ohmic",
  roles: {
    v1: { role: "voltage at one ampere", unit: "V" },
    v2: { role: "voltage at two amperes", unit: "V" },
  },
  assumptions: ["ohmic"],
  scalar: (inputs) => ivOhmicCertified(groundedInputs(inputs, ["v1", "v2"])),
});

registerModelAdmission({ name: "ce.iv_declared", roles: { y1: { role: "voltage at one ampere", unit: "V" }, y2: { role: "voltage at two amperes", unit: "V" } }, assumptions: ["supplied observations"], resultKind: "representation", scalar: (v) => ivDeclaredCertified(groundedInputs(v, ["y1", "y2"])) });

/** Packet extensions keep their input roles and scalar authority together.
 * Every value is source-bound in SI before this deterministic seam runs. */
export interface CurrentVariant {
  name: string;
  roles: Record<string, InputRole>;
  assumptions: string[];
  scalar: Certified;
}

export const currentVariants: CurrentVariant[] = [{
  name: "ce.carrier_density",
  roles: { n: { role: "carrier number density", unit: "per m^3" }, q: { role: "signed carrier charge", unit: "C" }, mu: { role: "mobility", unit: "m^2/(V s)" }, E: { role: "signed electric field", unit: "V/m" }, A: { role: "cross-section area", unit: "m^2" } },
  assumptions: ["uniform", "signed reference axis"],
  scalar(v) {
    positive(v.n, "n"); positive(v.A, "A"); positive(v.mu, "mu");
    if (v.q === 0) throw new Error("carrier charge cannot be zero");
    const vd = Math.sign(v.q) * v.mu * v.E;
    return { vd, J: v.n * v.q * vd, I: v.n * v.q * vd * v.A };
  },
}];

export function addCurrentVariant(variant: CurrentVariant): void {
  currentVariants.push(variant);
  admitCurrentVariant(variant);
}

function admitCurrentVariant(variant: CurrentVariant): void {
  const sequence: Pick<ModelAdmission, "roles" | "sequences"> = variant.name === "ce.joule_piecewise"
    ? { roles: { R: variant.roles.R! }, sequences: [{ indexStart: 1, minItems: 1, maxItems: 12, fields: { I: { role: "interval {index} current", unit: "A" }, t: { role: "interval {index} duration", unit: "s" } } }] }
    : variant.name === "ce.iv_samples"
      ? { roles: {}, sequences: [{ indexStart: 0, minItems: 2, maxItems: 12, fields: { i: { role: "observation {index} current", unit: "A" }, v: { role: "observation {index} voltage", unit: "V" } } }] }
      : variant.name === "ce.temperature_samples"
        ? { roles: {}, sequences: [{ indexStart: 0, minItems: 2, maxItems: 12, fields: { T: { role: "observation {index} temperature", unit: "degree Celsius" }, R: { role: "observation {index} resistance", unit: "ohm" } } }] }
        : { roles: variant.roles };
  registerModelAdmission({ name: variant.name, assumptions: variant.assumptions, ...sequence, resultKind: ["ce.iv_samples", "ce.temperature_samples"].includes(variant.name) ? "representation" : "scalar", scalar: (inputs) => {
    const dynamic = sequence.sequences ? groundedInputs(inputs, Object.keys(inputs)) : groundedInputs(inputs, Object.keys(variant.roles));
    const result = variant.scalar(dynamic);
    if (Object.values(result).some((value) => !Number.isFinite(value))) throw new Error("current-law result exceeds finite authority");
    return result;
  } });
}
for (const variant of currentVariants) admitCurrentVariant(variant);

addCurrentVariant({ name: "ce.joule_piecewise", assumptions: ["piecewise constant", "resistor"],
  roles: { R: { role: "resistance", unit: "ohm" }, ...Object.fromEntries([1, 2, 3].flatMap((i) => [[`I${i}`, { role: `interval ${i} current`, unit: "A" }], [`t${i}`, { role: `interval ${i} duration`, unit: "s" }]])) },
  scalar(v) {
    positive(v.R, "R");
    let H = 0, duration = 0;
    for (const i of boundedPairIndices(v, "I", "t", 1, ["R"])) { const t = v[`t${i}`]!; if (t < 0) throw new Error("interval duration cannot be negative"); H += v[`I${i}`]! ** 2 * v.R * t; duration += t; }
    if (duration === 0) throw new Error("a heating source interval is required");
    return { H, duration };
  },
});
addCurrentVariant({ name: "ce.stretched_wire", assumptions: ["uniform", "conserved volume", "constant resistivity"],
  roles: { rho: { role: "resistivity", unit: "ohm m" }, L: { role: "initial length", unit: "m" }, A: { role: "initial cross-section area", unit: "m^2" }, factor: { role: "length multiplier", unit: "1" } },
  scalar(v) { for (const key of ["rho", "L", "A", "factor"]) positive(v[key]!, key); return { L: v.L * v.factor, A: v.A / v.factor, R: v.rho * v.L * v.factor ** 2 / v.A, R0: v.rho * v.L / v.A }; },
});
addCurrentVariant({ name: "ce.cell_signed", assumptions: ["signed discharge reference"],
  roles: { E: { role: "emf", unit: "V" }, I: { role: "signed discharge current", unit: "A" }, r: { role: "internal resistance", unit: "ohm" } },
  scalar(v) { positive(v.E, "E"); if (v.r < 0) throw new Error("internal resistance is passive"); const V = v.E - v.I * v.r; if (V < 0) throw new Error("terminal voltage exceeds the declared polarity domain"); return { V, P_emf: v.E * v.I, P_heat: v.I ** 2 * v.r, P_terminal: V * v.I }; },
});
addCurrentVariant({ name: "ce.temperature_range", assumptions: ["linear", "declared range"],
  roles: { R0: { role: "reference resistance", unit: "ohm" }, alpha: { role: "temperature coefficient", unit: "per degree Celsius" }, T0: { role: "reference temperature", unit: "degree Celsius" }, T: { role: "temperature", unit: "degree Celsius" }, Tmin: { role: "minimum valid temperature", unit: "degree Celsius" }, Tmax: { role: "maximum valid temperature", unit: "degree Celsius" } },
  scalar(v) { positive(v.R0, "R0"); if (!(v.Tmax > v.Tmin) || v.T0 < v.Tmin || v.T0 > v.Tmax || v.T < v.Tmin || v.T > v.Tmax) throw new Error("linear law is outside its source-declared temperature range"); const law = (T: number) => v.R0 * (1 + v.alpha * (T - v.T0)); const R = law(v.T), Rmin = law(v.Tmin), Rmax = law(v.Tmax); positive(Math.min(R, Rmin, Rmax), "passive resistance throughout range"); return { R, Rmin, Rmax }; },
});
addCurrentVariant({ name: "ce.iv_samples", assumptions: ["supplied observations"],
  roles: Object.fromEntries([0, 1, 2].flatMap((i) => [[`i${i}`, { role: `observation ${i} current`, unit: "A" }], [`v${i}`, { role: `observation ${i} voltage`, unit: "V" }]])),
  scalar(v) { const indices = boundedPairIndices(v, "i", "v", 0); for (let offset = 1; offset < indices.length; offset += 1) if (!(v[`i${indices[offset - 1]}`]! < v[`i${indices[offset]}`]!)) throw new Error("observation currents must be distinct and ordered"); return {}; },
});
addCurrentVariant({ name: "ce.temperature_samples", assumptions: ["supplied observations", "passive wire"],
  roles: Object.fromEntries([0, 1, 2].flatMap((i) => [[`T${i}`, { role: `observation ${i} temperature`, unit: "degree Celsius" }], [`R${i}`, { role: `observation ${i} resistance`, unit: "ohm" }]])),
  scalar(v) { const indices = boundedPairIndices(v, "T", "R", 0); for (let offset = 1; offset < indices.length; offset += 1) if (!(v[`T${indices[offset - 1]}`]! < v[`T${indices[offset]}`]!)) throw new Error("observed temperatures must be distinct and ordered"); for (const i of indices) positive(v[`R${i}`]!, `R${i}`); return {}; },
});
addCurrentVariant({ name: "ce.material_comparison", assumptions: ["same uniform geometry", "isotropic"],
  roles: { rho1: { role: "first material resistivity", unit: "ohm m" }, rho2: { role: "second material resistivity", unit: "ohm m" }, L: { role: "length", unit: "m" }, A: { role: "cross-section area", unit: "m^2" } },
  scalar(v) { for (const key of ["rho1", "rho2", "L", "A"]) positive(v[key]!, key); return { sigma1: 1 / v.rho1, sigma2: 1 / v.rho2, R1: v.rho1 * v.L / v.A, R2: v.rho2 * v.L / v.A }; },
});
