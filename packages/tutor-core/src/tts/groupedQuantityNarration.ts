import { mathToSpeech } from "./speechNotation";
import { numberToSpokenWords } from "./numberWords";

const GROUPED_RATIO_SQUARE = /\(\s*(\d+(?:\.\d+)?)\s*((?:µ?[A-Za-zΩ]{1,3})\s*\/\s*(?:µ?[A-Za-zΩ]{1,3}))\s*\)\s*(?:\^2(?![\d.]|[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻⁼⁽⁾\p{Lm}])|²(?![⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ⁺⁻⁼⁽⁾\p{Lm}]))/gu;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMBER_PREFIX = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|point|minus|negative)(?:[\s-]+and)?[\s-]+$/i;

/**
 * The model may say "twenty meters per second squared" while writing
 * `(20 m/s)²`. Only that same scalar and unit in the paired WRITE licenses
 * saying "the quantity ... all squared". A genuine acceleration, another
 * value/unit, or an already bracketed spoken expression is left alone.
 *
 * The rewrite also needs positive evidence that the spoken phrase reads the
 * grouped term: the group must open the right side of `lhs =` in its row, and
 * the narration must say that left side and "equals" right before the phrase.
 * "Take g as ten meters per second squared" beside `v² = (10 m/s)² − 2gh` is
 * an acceleration and keeps the model's words.
 */
export function clarifyGroupedQuantityNarration(narration: string, writtenRows: readonly string[]): string {
  const written = writtenRows.join(" ");
  const groups = [...written.matchAll(GROUPED_RATIO_SQUARE)];
  const leadReadings = new Map<string, Set<string>>();
  for (const row of writtenRows) {
    for (const match of row.matchAll(GROUPED_RATIO_SQUARE)) {
      const lead = /^([^=]*\S[^=]*)=\s*$/u.exec(row.slice(0, match.index));
      if (!lead) continue;
      const key = `${Number(match[1])}@${match[2]!.replace(/\s/g, "")}`;
      const readings = leadReadings.get(key) ?? new Set<string>();
      readings.add(spokenKey(mathToSpeech(`${lead[1]!.trim()} =`).replace(/\d+(?:\.\d+)?/g, numberToSpokenWords)));
      leadReadings.set(key, readings);
    }
  }
  // A following exponent may apply to sqrt(...), sin(...), f(...), or an
  // ambiguous adjacent identifier. Their arguments do not prove a squared
  // speed. Numeric coefficients, e.g. 2(20 m/s)^2, keep the quantity's scope.
  const functionArguments = new Set(groups.filter((group) =>
    /(?:[\p{L}_][\p{L}\p{N}_]*|√)\s*$/u.test(written.slice(0, group.index)),
  ).map((group) => `${Number(group[1])}@${group[2]!.replace(/\s/g, "")}`));
  const otherTerms = written.replace(GROUPED_RATIO_SQUARE, "");
  let clarified = narration;
  for (const [, value, rawUnit] of groups) {
    const unit = rawUnit!.replace(/\s/g, "");
    if (functionArguments.has(`${Number(value)}@${unit}`)) continue;
    const leads = leadReadings.get(`${Number(value)}@${unit}`);
    if (!leads) continue;
    const [numerator, denominator] = unit.split("/");
    // If the same-looking ungrouped unit square is also written, the spoken
    // phrase is ambiguous. Do not turn a valid acceleration into a speed.
    if (new RegExp(`(?<![\\d.])${escape(value!)}\\s*${escape(numerator!)}\\s*/\\s*${escape(denominator!)}(?:\\^2|²)`).test(otherTerms)) continue;
    const reading = mathToSpeech(`${value} ${unit}`);
    // Unknown variable ratios are not physical units and do not establish a
    // spoken quantity. Reuse the established unit reader as that boundary.
    if (!reading.includes(" per ")) continue;
    const words = reading.replace(/\d+(?:\.\d+)?/g, numberToSpokenWords);
    const phrase = new RegExp(`(?<![\\p{L}\\p{N}])${escape(words)} squared(?![\\p{L}\\p{N}])`, "giu");
    // The paired WRITE identifies a scalar/unit, not which repeated spoken
    // occurrence describes it. Another occurrence may be an acceleration
    // spoken in this segment but absent from the written row.
    const occurrences = [...clarified.matchAll(phrase)].filter((match) =>
      !NUMBER_PREFIX.test(clarified.slice(0, match.index)));
    if (occurrences.length !== 1) continue;
    const occurrence = occurrences[0]!;
    const before = ` ${spokenKey(clarified.slice(0, occurrence.index))}`;
    if (![...leads].some((lead) => before.endsWith(` ${lead}`))) continue;
    clarified = `${clarified.slice(0, occurrence.index)}the quantity ${words} all squared${clarified.slice(occurrence.index + occurrence[0].length)}`;
  }
  return clarified;
}

function spokenKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}
