/**
 * Planner operator-input aliases that state exactly what the operator already
 * assumes. A rule rewrites inputs only when the rewritten program means the
 * same thing; anything partial, unknown or contradicted by a source quantity
 * is left untouched so the operator still rejects it.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One spelling per unit: trims, drops spaces and middle dots, and writes powers as ^n. */
function unitSpelling(unit: string): string {
  return unit.trim().replace(/[\s·]+/g, "").replace(/⁻¹/g, "^-1").replace(/⁻²/g, "^-2").replace(/²/g, "^2");
}

/**
 * projectile_trajectory computes in metres and seconds: speed m/s, gravity
 * m/s^2, initialHeight m. It takes no `units` key; a block that only restates
 * this convention adds nothing, so it may be dropped.
 */
const PROJECTILE_SI_UNITS: Readonly<Record<"speed" | "gravity" | "length", ReadonlySet<string>>> = {
  speed: new Set(["m/s", "ms^-1"]),
  gravity: new Set(["m/s^2", "m/s2", "ms^-2"]),
  length: new Set(["m", "metre", "meter", "metres", "meters"]),
};
const PROJECTILE_UNIT_SLOTS: ReadonlyArray<readonly [input: string, slot: keyof typeof PROJECTILE_SI_UNITS]> = [
  ["speed", "speed"], ["gravity", "gravity"], ["initialHeight", "length"],
];

/** Units a numeric input carries through quantity references, inline {value,unit} records included. */
function referencedUnits(value: unknown, quantities: ReadonlyMap<string, Json>, depth = 0): string[] | null {
  if (depth > 16) return null;
  if (typeof value === "number") return [];
  if (typeof value === "string") {
    const quantity = quantities.get(value);
    if (!quantity) return [];
    return withOwnUnit(quantity, quantities, depth);
  }
  if (isRecord(value)) return withOwnUnit(value, quantities, depth);
  return [];
}
function withOwnUnit(entry: Json, quantities: ReadonlyMap<string, Json>, depth: number): string[] | null {
  if (entry.unit !== undefined && typeof entry.unit !== "string") return null;
  const nested = "value" in entry ? referencedUnits(entry.value, quantities, depth + 1) : [];
  if (nested === null) return null;
  return typeof entry.unit === "string" && entry.unit.trim() ? [entry.unit, ...nested] : nested;
}

function projectileUnitsRestateConvention(inputs: Json, quantities: ReadonlyMap<string, Json>): boolean {
  const declared = inputs.units;
  if (!isRecord(declared)) return false;
  const keys = Object.keys(declared);
  if (keys.length === 0) return false;
  for (const key of keys) {
    const accepted = PROJECTILE_SI_UNITS[key as keyof typeof PROJECTILE_SI_UNITS];
    const unit = declared[key];
    if (!accepted || typeof unit !== "string" || !accepted.has(unitSpelling(unit))) return false;
  }
  // A referenced quantity in another unit would make the dropped block a silent conversion.
  for (const [input, slot] of PROJECTILE_UNIT_SLOTS) {
    const units = referencedUnits(inputs[input], quantities);
    if (units === null || units.some((unit) => !PROJECTILE_SI_UNITS[slot].has(unitSpelling(unit)))) return false;
  }
  return true;
}

/** Returns new construction records; the planner's own objects are never mutated. */
export function normalizeOperatorInputAliases(constructions: readonly unknown[], rawQuantities: unknown): unknown[] {
  const quantities = new Map<string, Json>(
    (Array.isArray(rawQuantities) ? rawQuantities : []).flatMap((quantity) =>
      isRecord(quantity) && typeof quantity.id === "string" ? [[quantity.id, quantity] as const] : [],
    ),
  );
  return constructions.map((construction) => {
    if (!isRecord(construction) || construction.operator !== "projectile_trajectory" || !isRecord(construction.inputs)) return construction;
    if (!("units" in construction.inputs) || !projectileUnitsRestateConvention(construction.inputs, quantities)) return construction;
    const inputs = { ...construction.inputs };
    delete inputs.units;
    return { ...construction, inputs };
  });
}
