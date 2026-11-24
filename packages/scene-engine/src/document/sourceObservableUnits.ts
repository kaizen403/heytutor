import { unwrapMathMarkup } from "@heytutor/drawing";
import { convertMeasuredValue, sceneUnitSignature } from "../contracts/contractsV3";
import { readUnitDimensions } from "../contracts/planEquationDimensions";
import { parseRational, compareRational } from "../math/exactRational";
import { SECONDS_PER_TIME_UNIT } from "../physics/nuclearAuthority";

export interface ObservableUnit {
  /** Dimension alone cannot equate a detector count, frequency and activity. */
  meaning: "scalar" | "decay_activity";
  key: string;
  algebra: string;
  dimension: string;
}
const SUPERSCRIPTS: Readonly<Record<string, string>> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
export function observableMathText(raw: string): string {
  return unwrapMathMarkup(raw.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, group => `^${[...group].map(char => SUPERSCRIPTS[char]).join("")}`))
    .normalize("NFKC").replace(/[−–]/g, "-").replace(/\s+/g, " ").trim();
}
/** Keep the written decimal identity; underflow and lossy long literals do
 * not become an exact zero or a different source operand. */
export function readObservableScalar(raw: string): number | null {
  if (raw.length > 64) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > 1e30 || value !== 0 && Math.abs(value) < 2 ** -1022) return null;
  try { return compareRational(parseRational(raw), parseRational(value)) === 0 ? value : null; }
  catch { return null; }
}
export function sourceTimeUnit(raw: string): string | null {
  const key = raw.trim();
  const alias: Readonly<Record<string, string>> = { second: "s", seconds: "s", sec: "s", minute: "min", minutes: "min", hour: "h", hours: "h", hr: "h" };
  const unit = alias[key] ?? key;
  return ["s", "min", "h"].includes(unit) && SECONDS_PER_TIME_UNIT[unit] ? unit : null;
}
/** Decode the complete unit, never a matching prefix or whitespace-glued id.
 * Activity's semantic unit aliases use the existing inverse-time algebra. */
export function decodeObservableUnit(raw: unknown): ObservableUnit | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 128) return null;
  let unit = observableMathText(raw);
  if (/^(?:\([^()[\]{}]+\)|\[[^()[\]{}]+\]|\{[^()[\]{}]+\})$/.test(unit)) unit = unit.slice(1, -1).trim();
  let meaning: ObservableUnit["meaning"] = "scalar", algebra = unit, key = unit.replace(/\s+/g, "");
  const bq = /^(k|M|m|µ|μ|u)?Bq$/.exec(unit);
  const decay = /^decays?\s*(?:\/|\bper\b)\s*([A-Za-z]+)$/.exec(unit);
  if (bq) {
    meaning = "decay_activity";
    const prefix = bq[1] ?? "";
    // Prefixes apply to activity, not to its denominator. Use a quotient in
    // inverse prefix time to retain the existing scale converter.
    algebra = ({ "": "s^-1", k: "ms^-1", M: "µs^-1", m: "ks^-1", "µ": "Ms^-1", "μ": "Ms^-1", u: "Ms^-1" } as Record<string, string>)[prefix]!;
    key = `${prefix === "u" || prefix === "μ" ? "µ" : prefix}Bq`;
  } else if (decay) {
    const time = sourceTimeUnit(decay[1]!);
    if (!time) return null;
    meaning = "decay_activity"; algebra = `${time}^-1`; key = `decays/${time}`;
  }
  const dimension = readUnitDimensions(algebra, sceneUnitSignature)?.map(value => `${value.n}/${value.d}`).join(",");
  return dimension ? { meaning, key, algebra, dimension } : null;
}
export function convertObservableValue(value: number, from: ObservableUnit, to: ObservableUnit): number | null {
  if (from.meaning !== to.meaning || from.dimension !== to.dimension) return null;
  const converted = convertMeasuredValue(value, from.algebra, to.algebra);
  return converted !== null && Number.isFinite(converted) && (value === 0 || converted !== 0 && Math.abs(converted) >= 2 ** -1022) ? converted : null;
}
