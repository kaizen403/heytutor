import type { SceneIssue } from "../types";

export interface VerifiedPartsInputResult {
  candidate: Record<string, unknown>;
  issues: SceneIssue[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Spelling changes only: no scale conversion and no inferred physical units. */
function canonicalUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .trim()
    .replace(/²/g, "^2")
    .replace(/\s+/g, "")
    .replace(/metres?|meters?/g, "m")
    .replace(/seconds?|secs?/g, "s");
}

function sourceUsesUnit(
  value: unknown,
  expected: string,
  quantities: unknown[],
  seen = new Set<unknown>(),
): boolean {
  if (seen.size > 16 || seen.has(value)) return false;
  if (typeof value === "number") return Number.isFinite(value);
  seen.add(value);
  if (typeof value === "string") {
    const quantity = quantities.filter(
      (entry) => record(entry) && entry.id === value,
    );
    if (quantity.length !== 1) return false;
    return sourceUsesUnit(quantity[0], expected, quantities, seen);
  }
  if (!record(value) || !("value" in value)) return false;
  if (value.unit !== undefined && canonicalUnit(value.unit) !== expected)
    return false;
  return sourceUsesUnit(value.value, expected, quantities, seen);
}

/**
 * Opt-in syntax normalization before the ordinary validator. All source/numeric,
 * construction, assertion and compile gates still run on the returned document.
 * Ambiguous aliases, conflicting units and normalized-parameter guesses remain
 * untouched so the existing validator rejects them.
 */
export function normalizeVerifiedPartsInputs(
  candidate: Record<string, unknown>,
  enabled = false,
): VerifiedPartsInputResult {
  if (!enabled || !Array.isArray(candidate.constructions))
    return { candidate, issues: [] };
  const issues: SceneIssue[] = [];
  const quantities = Array.isArray(candidate.quantities)
    ? candidate.quantities
    : [];
  let changed = false;
  const constructions = candidate.constructions.map((construction, index) => {
    if (
      !record(construction) ||
      !record(construction.inputs) ||
      typeof construction.operator !== "string"
    )
      return construction;
    const operator = construction.operator;
    const original = construction.inputs;
    const inputs = { ...original };
    const normalized: Array<{ field: string; reason: string }> = [];
    // These names explicitly retain the same coordinate/parameter meaning.
    // In particular, fraction/normalizedAt/angle are intentionally not aliases.
    const aliases: Record<string, string> =
      operator === "projectile_trajectory"
        ? {
            initialSpeed: "speed",
            launchAngleDegrees: "launchAngleDeg",
            inclineAngleDegrees: "inclineAngleDeg",
          }
        : operator === "curve_anchor" || operator === "curve_derivative"
          ? { target: "curve", parameter: "at" }
          : operator === "trajectory_state"
            ? { trajectoryId: "trajectory", t: "time" }
            : {};
    if (
      Object.entries(aliases).some(
        ([alias, canonical]) => alias in inputs && canonical in inputs,
      )
    )
      return construction;
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (!(alias in inputs)) continue;
      inputs[canonical] = inputs[alias];
      delete inputs[alias];
      normalized.push({
        field: alias,
        reason: `Normalized explicit ${alias} alias to ${canonical}.`,
      });
    }
    if (operator === "projectile_trajectory" && "units" in inputs) {
      const units = inputs.units;
      // This operator's output metadata is SI. Accept only redundant explicit SI
      // declarations, never delete a scale declaration such as cm or km/h.
      const expected = { speed: "m/s", gravity: "m/s^2", length: "m" };
      const redundant =
        record(units) &&
        Object.keys(units).length === 3 &&
        Object.entries(expected).every(
          ([key, unit]) => canonicalUnit(units[key]) === unit,
        ) &&
        sourceUsesUnit(inputs.speed, "m/s", quantities) &&
        sourceUsesUnit(inputs.gravity, "m/s^2", quantities) &&
        (inputs.initialHeight === undefined ||
          sourceUsesUnit(inputs.initialHeight, "m", quantities));
      if (!redundant) return construction;
      delete inputs.units;
      normalized.push({
        field: "units",
        reason:
          "Removed redundant explicit SI units already fixed by the projectile operator; source quantity units agree.",
      });
    }
    if (
      operator === "constant_acceleration_trajectory" &&
      record(inputs.units)
    ) {
      const units = { ...inputs.units };
      for (const key of ["length", "time"]) {
        const normalizedUnit = canonicalUnit(units[key]);
        if (
          normalizedUnit !== null &&
          normalizedUnit !== units[key] &&
          (key === "length"
            ? ["m", "cm", "mm", "km"].includes(normalizedUnit)
            : ["s", "ms"].includes(normalizedUnit))
        ) {
          units[key] = normalizedUnit;
          normalized.push({
            field: `units.${key}`,
            reason: `Normalized ${key} unit spelling without changing its scale.`,
          });
        }
      }
      inputs.units = units;
    }
    if (
      operator === "function_curve" &&
      typeof inputs.samples === "number" &&
      Number.isInteger(inputs.samples) &&
      inputs.samples >= 18 &&
      inputs.samples <= 160 &&
      inputs.samples % 2 === 0
    ) {
      // One extra sample retains the expression/domain/endpoints and satisfies
      // the compiler's odd-count contract. No geometric parameter is inferred.
      inputs.samples += 1;
      normalized.push({
        field: "samples",
        reason:
          "Increased even sample count by one, retaining the curve expression and domain.",
      });
    }
    if (!normalized.length) return construction;
    changed = true;
    for (const item of normalized)
      issues.push({
        code:
          item.field === "samples"
            ? "invalid_function_samples"
            : `invalid_${operator}_${item.field.startsWith("units") ? (operator === "projectile_trajectory" ? "fields" : "units") : "fields"}`,
        severity: "warning",
        path: `constructions[${index}].inputs.${item.field}`,
        message: item.reason,
        ...(Array.isArray(construction.outputs) &&
        construction.outputs.every((id) => typeof id === "string")
          ? { entityIds: construction.outputs as string[] }
          : {}),
      });
    return { ...construction, inputs };
  });
  return {
    candidate: changed ? { ...candidate, constructions } : candidate,
    issues,
  };
}
