/**
 * Shared shape of fixtures/regression/label-ink-golden-v1.json. JSON has no
 * -0, NaN or Infinity, so those doubles travel as strings; every other double
 * travels as a JSON number, which round-trips exactly.
 */
export const LABEL_INK_GOLDEN_SCHEMA = "label-ink-golden/v1";

export type EncodedInkDouble = number | "-0" | "NaN" | "Infinity" | "-Infinity";

export interface LabelInkGoldenRecord {
  args: [text: string, x: EncodedInkDouble, y: EncodedInkDouble, fontSize: EncodedInkDouble];
  ink?: [EncodedInkDouble, EncodedInkDouble, EncodedInkDouble, EncodedInkDouble] | null;
  throws?: string;
}

export function encodeInkDouble(value: number): EncodedInkDouble {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return value;
}

export function decodeInkDouble(value: EncodedInkDouble): number {
  return typeof value === "number" ? value : value === "-0" ? -0 : Number(value);
}
