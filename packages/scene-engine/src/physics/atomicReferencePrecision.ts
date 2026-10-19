/** Compatibility with a fixed atomic reference at the given's written precision.
 * The original shared reader owns parsing, units and complete source spans.
 * This private photoelectric check supplies no scalar or replacement value. */
import {
  CHEMISTRY_NUMBER_PATTERN, chemistryCanonicalValuesAgree, parseChemistryScalar,
  type ChemistryReading,
} from "../chemistry/quantityReader";

function decimalQuantum(validatedScalar: string): number | null {
  // Decode notation only after complete original-span validation. Explicit
  // decimal zeros remain meaningful; a fraction is not a rounded decimal.
  const token = validatedScalar.replace(/\s/g, "").replace(/−/g, "-")
    .replace(/([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/, exponent => "^" + [...exponent].map(character => {
      const digit = "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(character);
      return digit >= 0 ? String(digit) : character === "⁻" ? "-" : "+";
    }).join(""));
  if (token.includes("/")) return null;
  let coefficient = token, exponent = 0;
  const scientific = /^(.+?)[eE]([+-]?\d+)$/.exec(token);
  const product = /^(.+?)[x×*]10\^\(?([+-]?\d+)\)?$/.exec(token);
  const power = /^([+-]?)10\^\(?([+-]?\d+)\)?$/.exec(token);
  if (scientific || product) {
    const parts = (scientific ?? product)!;
    coefficient = parts[1]!; exponent = Number(parts[2]);
  } else if (power) {
    coefficient = `${power[1]}1`; exponent = Number(power[2]);
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(coefficient)) return null;
  const decimals = coefficient.includes(".") ? coefficient.split(".")[1]!.length : 0;
  const quantum = 10 ** (exponent - decimals);
  return Number.isFinite(quantum) && quantum > 0 ? quantum : null;
}

export function atomicReferenceReadingCompatible(
  question: string, reading: ChemistryReading, reference: number,
): boolean {
  if (reading.source.kind !== "stem_given" || !reading.rawUnit
    || ![reading.value, reading.rawValue, reference].every(value => Number.isFinite(value) && value > 0)) return false;
  const { span, text } = reading.source;
  if (question.slice(span.start, span.end) !== text) return false;
  const scalar = new RegExp(`^${CHEMISTRY_NUMBER_PATTERN}`).exec(text)?.[1];
  if (!scalar) return false;
  const parsed = parseChemistryScalar(question, { start: span.start, end: span.start + scalar.length });
  if (!parsed.ok || parsed.reading !== reading.rawValue) return false;
  // Preserve the existing exact-reference agreement before considering an
  // explicit decimal's last place. Fractions gain no approximate authority.
  if (chemistryCanonicalValuesAgree(reading.value, reference)) return true;
  const rawQuantum = decimalQuantum(scalar);
  if (rawQuantum === null) return false;
  const quantum = rawQuantum * reading.value / reading.rawValue;
  if (!Number.isFinite(quantum) || !(quantum > 0)) return false;
  return reference >= reading.value - quantum / 2 && reference <= reading.value + quantum / 2;
}
