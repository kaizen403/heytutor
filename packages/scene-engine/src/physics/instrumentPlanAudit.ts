import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";

export type InstrumentLawId = "galvanometer_to_voltmeter";
export type InstrumentInputRole = "galvanometer_current" | "galvanometer_resistance" | "voltage_range";
export type InstrumentOutputRole = "total_resistance" | "series_resistance";

export interface InstrumentLawEvaluation {
  lawId: InstrumentLawId;
  currentAmps: number;
  galvanometerResistanceOhms: number;
  rangeVolts: number;
  totalResistanceOhms: number;
  seriesResistanceOhms: number;
}

export interface InstrumentPlanInconsistency {
  lawId: InstrumentLawId;
  quantityId: string;
  role: InstrumentOutputRole;
  reason: "scalar_mismatch" | "sign_mismatch" | "unit_mismatch";
  planValue: number;
  /** Null when the declared output dimension is not resistance. */
  actualOhms: number | null;
  expectedOhms: number;
}

export type InstrumentPlanDeclineReason =
  | "ambiguous_law" | "missing_given" | "ambiguous_given" | "conflicting_role"
  | "unsupported_given_unit" | "invalid_given_value" | "invalid_given_sign"
  | "invalid_given_provenance" | "invalid_output_provenance"
  | "non_finite_result" | "range_below_galvanometer_drop"
  | "missing_output" | "ambiguous_output" | "unsupported_output_unit"
  | "invalid_output_value" | "invalid_output_sign";

export interface InstrumentPlanDecline {
  lawId: InstrumentLawId;
  reason: InstrumentPlanDeclineReason;
  role?: InstrumentInputRole | InstrumentOutputRole;
}

export interface InstrumentPlanAuditResult {
  /** Same input reference; no values, units, symbols or evidence are rewritten. */
  plan: TurnPlanV3;
  results: InstrumentLawEvaluation[];
  inconsistencies: InstrumentPlanInconsistency[];
  /** A law was evaluated, not proof that every plan value or figure is verified. */
  checkedLawIds: InstrumentLawId[];
  declined: InstrumentPlanDecline[];
}

/** Report-only law audit of structured givens; never routes on question text. */
export function auditInstrumentTurnPlanV3(plan: TurnPlanV3): InstrumentPlanAuditResult {
  const audit: InstrumentPlanAuditResult = { plan, results: [], inconsistencies: [], checkedLawIds: [], declined: [] };
  if (!plan.lawIds.some((law) => VOLTMETER_LAW_TAGS.has(lawKey(law)))) return audit;
  if (plan.lawIds.some((law) => AMMETER_LAW_TAGS.has(lawKey(law)))) {
    audit.declined.push({ lawId: LAW_ID, reason: "ambiguous_law" });
    return audit;
  }
  const inputs: Partial<Record<InstrumentInputRole, number>> = {};
  for (const role of INPUT_ROLES) {
    const matches = plan.givens.filter((quantity) => matchesInstrumentQuantityRole(quantity, role));
    if (matches.length !== 1) {
      audit.declined.push({ lawId: LAW_ID, role, reason: matches.length ? "ambiguous_given" : "missing_given" });
      continue;
    }
    const quantity = matches[0]!;
    if (quantity.provenance !== "given") {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_given_provenance" });
      continue;
    }
    if (conflictingRole(quantity)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "conflicting_role" });
      continue;
    }
    if (!consistentSign(quantity)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_given_sign" });
      continue;
    }
    const unit = measuredUnit(quantity.unit);
    if (!unit || unit.dimension !== INPUT_DIMENSIONS[role]) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "unsupported_given_unit" });
      continue;
    }
    const value = quantity.value * unit.factor;
    if (!Number.isFinite(value) || (role === "galvanometer_resistance" ? value < 0 : value <= 0)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_given_value" });
      continue;
    }
    inputs[role] = value;
  }
  if (audit.declined.length) return audit;
  const currentAmps = inputs.galvanometer_current!;
  const galvanometerResistanceOhms = inputs.galvanometer_resistance!;
  const rangeVolts = inputs.voltage_range!;
  const totalResistanceOhms = rangeVolts / currentAmps;
  const seriesResistanceOhms = totalResistanceOhms - galvanometerResistanceOhms;
  if (!Number.isFinite(totalResistanceOhms) || totalResistanceOhms <= 0 || !Number.isFinite(seriesResistanceOhms)) {
    audit.declined.push({ lawId: LAW_ID, reason: "non_finite_result" });
    return audit;
  }
  if (seriesResistanceOhms < 0) {
    audit.declined.push({ lawId: LAW_ID, reason: "range_below_galvanometer_drop" });
    return audit;
  }
  audit.results.push({ lawId: LAW_ID, currentAmps, galvanometerResistanceOhms, rangeVolts,
    totalResistanceOhms, seriesResistanceOhms });
  audit.checkedLawIds.push(LAW_ID);
  const verifiedOutputs = new Set<InstrumentOutputRole>();
  for (const role of OUTPUT_ROLES) {
    const matches = plan.derived.filter((quantity) => matchesInstrumentQuantityRole(quantity, role));
    if (matches.length !== 1) {
      audit.declined.push({ lawId: LAW_ID, role, reason: matches.length ? "ambiguous_output" : "missing_output" });
      continue;
    }
    const quantity = matches[0]!;
    if (quantity.provenance !== "derived") {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_output_provenance" });
      continue;
    }
    if (conflictingRole(quantity)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "conflicting_role" });
      continue;
    }
    const expectedOhms = role === "total_resistance" ? totalResistanceOhms : seriesResistanceOhms;
    if (!consistentSign(quantity)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_output_sign" });
      continue;
    }
    if (!Number.isFinite(quantity.value)) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_output_value" });
      continue;
    }
    const unit = measuredUnit(quantity.unit);
    if (!unit) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "unsupported_output_unit" });
      continue;
    }
    const actualOhms = unit.dimension === "resistance" ? quantity.value * unit.factor : null;
    if (actualOhms !== null && (!Number.isFinite(actualOhms) || (quantity.value !== 0 && actualOhms === 0))) {
      audit.declined.push({ lawId: LAW_ID, role, reason: "invalid_output_value" });
      continue;
    }
    if (actualOhms === null || !outputAgreesAtWrittenPrecision(quantity, actualOhms, expectedOhms)) {
      audit.inconsistencies.push({ lawId: LAW_ID, quantityId: quantity.id, role, planValue: quantity.value,
        actualOhms, expectedOhms, reason: actualOhms === null ? "unit_mismatch"
          : actualOhms < 0 && expectedOhms >= 0 ? "sign_mismatch" : "scalar_mismatch" });
    } else {
      verifiedOutputs.add(role);
    }
  }
  // Either checked output can stand alone when the other was not requested.
  // Missing requested roles and invalid present outputs remain unverified.
  audit.declined = audit.declined.filter((decline) => {
    if (decline.reason !== "missing_output" || !decline.role) return true;
    const role = decline.role;
    return verifiedOutputs.size === 0 || plan.unknowns.some((quantity) => matchesInstrumentQuantityRole(quantity, role));
  });
  return audit;
}

const LAW_ID: InstrumentLawId = "galvanometer_to_voltmeter";
const VOLTMETER_LAW_TAGS = new Set([
  LAW_ID, "voltmeter_conversion", "galvanometer_to_voltmeter_conversion",
]);
const AMMETER_LAW_TAGS = new Set([
  "galvanometer_to_ammeter", "ammeter_conversion", "galvanometer_to_ammeter_conversion",
]);
const lawKey = (law: string) => law.trim().toLowerCase().replace(/-/g, "_");
const INPUT_ROLES = ["galvanometer_current", "galvanometer_resistance", "voltage_range"] as const;
const OUTPUT_ROLES = ["total_resistance", "series_resistance"] as const;
type Dimension = "current" | "resistance" | "voltage";
const INPUT_DIMENSIONS: Record<InstrumentInputRole, Dimension> = {
  galvanometer_current: "current", galvanometer_resistance: "resistance", voltage_range: "voltage",
};
const ROLE_KEYS: Record<InstrumentInputRole | InstrumentOutputRole, readonly string[]> = {
  galvanometer_current: ["Ig", "ig", "galvanometercurrent", "fullscalecurrent"],
  galvanometer_resistance: ["Rg", "RG", "G", "galvanometerresistance"],
  voltage_range: ["V", "Vrange", "Vmax", "voltagerange"],
  total_resistance: ["Rtotal", "totalresistance"],
  series_resistance: ["Rs", "R", "Rseries", "seriesresistance"],
};
/** Exact, case-preserving role identity shared by givens, outputs and requests. */
export function matchesInstrumentQuantityRole(
  quantity: Pick<TurnPlanQuantityV3, "id" | "symbol">,
  role: InstrumentInputRole | InstrumentOutputRole,
): boolean {
  return [quantity.id, quantity.symbol].some((value) => ROLE_KEYS[role].includes(quantityKey(value)));
}
const quantityKey = (value: string) => value.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/g, "").replace(/[{}_\s]/g, "");

/**
 * Keep the strict relative comparison unless this output's source assignment
 * explicitly states the same declared value in supported resistance units.
 * Like contractsV3's displayedNumberTolerance, half the last written place
 * bounds rounding; like statedCircuitAuthority, retain at least two figures.
 * The law remains independently recomputed. This does not verify sourceText's
 * whole arithmetic chain, which the plan validator checks before this audit.
 */
function outputAgreesAtWrittenPrecision(quantity: TurnPlanQuantityV3, actualOhms: number, expectedOhms: number): boolean {
  const difference = Math.abs(actualOhms - expectedOhms);
  if (difference <= Math.max(Math.abs(actualOhms), Math.abs(expectedOhms)) * 1e-9) return true;
  if (actualOhms === 0 || expectedOhms === 0 || Math.sign(actualOhms) !== Math.sign(expectedOhms) ||
    !quantity.sourceText || /[;\n]/.test(quantity.sourceText)) return false;
  const parts = quantity.sourceText.split(/[=≈≃≅]/).map((part) => part.trim());
  if (parts.length < 2 || ![quantity.id, quantity.symbol].some((key) => quantityKey(key) === quantityKey(parts[0]!))) return false;
  const stated = parts.at(-1)!.match(
    /^([+\-−]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+\-−]?\d+)?)\s*(.+)$/u,
  );
  if (!stated) return false;
  const written = stated[1]!.replace(/−/g, "-");
  const unit = measuredUnit(stated[2]!);
  if (!unit || unit.dimension !== "resistance") return false;
  const value = Number(written) * unit.factor;
  const conversionSlack = 16 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(actualOhms));
  if (!Number.isFinite(value) || Math.abs(value - actualOhms) > conversionSlack) return false;
  const [mantissa, exponentText = "0"] = written.toLowerCase().split("e");
  const significantFigures = mantissa!.replace(/^[+-]/, "").replace(".", "").replace(/^0+/, "").length;
  if (significantFigures < 2) return false;
  const decimals = (mantissa!.split(".")[1] ?? "").length;
  const tolerance = 0.5 * 10 ** (Number(exponentText) - decimals) * unit.factor;
  if (!Number.isFinite(tolerance) || tolerance === 0) return false;
  const floatingSlack = 16 * Number.EPSILON * Math.max(Math.abs(actualOhms), Math.abs(expectedOhms));
  return difference <= tolerance + floatingSlack;
}
function conflictingRole(quantity: TurnPlanQuantityV3): boolean {
  return [...INPUT_ROLES, ...OUTPUT_ROLES].filter((role) => matchesInstrumentQuantityRole(quantity, role)).length > 1;
}
function consistentSign(quantity: TurnPlanQuantityV3): boolean {
  return quantity.sign === undefined || quantity.sign === "unsigned" ||
    quantity.sign === (quantity.value > 0 ? "positive" : quantity.value < 0 ? "negative" : "zero");
}
function measuredUnit(unit: string | undefined): { dimension: Dimension; factor: number } | null {
  const key = unit?.normalize("NFKC").trim();
  for (const [dimension, factors] of UNIT_FACTORS) {
    if (key !== undefined && Object.hasOwn(factors, key)) return { dimension, factor: factors[key]! };
  }
  for (const [dimension, factors] of WORD_UNIT_FACTORS) {
    if (key !== undefined && Object.hasOwn(factors, key.toLowerCase())) return { dimension, factor: factors[key.toLowerCase()]! };
  }
  return null;
}
const UNIT_FACTORS: ReadonlyArray<readonly [Dimension, Readonly<Record<string, number>>]> = [
  ["current", { A: 1, mA: 1e-3, "μA": 1e-6, uA: 1e-6, nA: 1e-9 }],
  ["voltage", { V: 1, mV: 1e-3, "μV": 1e-6, uV: 1e-6, kV: 1e3 }],
  ["resistance", { "Ω": 1, "mΩ": 1e-3, "kΩ": 1e3, "MΩ": 1e6, ohm: 1, ohms: 1 }],
];
const WORD_UNIT_FACTORS: typeof UNIT_FACTORS = [
  ["current", { amp: 1, amps: 1, ampere: 1, amperes: 1, milliampere: 1e-3, milliamperes: 1e-3,
    microampere: 1e-6, microamperes: 1e-6, nanoampere: 1e-9, nanoamperes: 1e-9 }],
  ["voltage", { volt: 1, volts: 1, millivolt: 1e-3, millivolts: 1e-3,
    microvolt: 1e-6, microvolts: 1e-6, kilovolt: 1e3, kilovolts: 1e3 }],
  ["resistance", { ohm: 1, ohms: 1, milliohm: 1e-3, milliohms: 1e-3,
    kilohm: 1e3, kilohms: 1e3, kiloohm: 1e3, kiloohms: 1e3, megaohm: 1e6, megaohms: 1e6 }],
];
