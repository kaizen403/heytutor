import { declaredElectronCounts } from "./bohrSourceElectronInventory";
import { unwrapMathMarkup } from "@heytutor/drawing";
import { affirmativeEnergyFact as positive, currentEnergyClauses, energyDirectionWords, energyEventFacts, type EnergyEventFact } from "./energySourceScope";
import { resolveElement } from "../chemistry/elements";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";

// Physical definitions of the named hydrogenic spectral series, not scene
// producers. Geometry, principal states and arrow direction still need proof.
export const HYDROGEN_SERIES = ["lyman", "balmer", "paschen", "brackett", "pfund", "humphreys"] as const;
export const energyText = (value: string) => unwrapMathMarkup(value).normalize("NFKC").replace(/[{}]/g, "").replace(/−/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
export interface PrincipalState { min: number; max: number }
export interface EnergyAxis { coordinate: "x" | "y"; sign: 1 | -1 }
export interface EnergyLevelSource {
  physical: boolean;
  requested: boolean;
  supported: boolean;
  hydrogenic: boolean;
  axis: EnergyAxis | null;
  levels: number[];
  series: number[];
  excludedSeries: number[];
  excludedNames: number[];
  transitions: boolean;
  events: Array<{ from: number; to: number; direction?: "emission" | "absorption" }>;
  eventFacts: EnergyEventFact[];
  namedSeries: number[];
  unprovedStates: boolean;
}
const ENERGY = /\benergy[ -]levels?\b|\b(?:spectral\s+series|spectrum|spectra)\b|\b(?:emission|absorption|photon)\b[^.;]{0,60}\btransition\b/;
const affirmed = (body: string, expression: RegExp) => [...body.matchAll(new RegExp(expression.source, "g"))].filter(match => positive(body, match.index!));
const integer = (value: number) => Number.isInteger(value) && value >= 1 && value <= 64;

/** A displayed state claim is deliberately small: a principal integer or an
 * upper collection. No arbitrary variable, energy, role or proof tag can stand
 * in for n. The bound is the existing native Bohr operator's supported domain. */
export function principalState(text: string): PrincipalState | null {
  const normalized = energyText(text);
  if (/^(?:the )?ground state$/.test(normalized)) return { min: 1, max: 1 };
  // A symbolic matching E-index names the same state; it supplies no numeric
  // energy. A different index, arbitrary suffix, or value remains unproved.
  const indexed = /^n\s*=\s*(\d+)\s*\(\s*e_?(\d+)\s*\)$/.exec(normalized);
  if (indexed) {
    const n = Number(indexed[1]);
    return integer(n) && Number(indexed[2]) === n ? { min: n, max: n } : null;
  }
  const match = /^(?:(?:principal |energy )?level\s*:?\s*)?n\s*(=|>=|>|≥)\s*(\d+)$/.exec(normalized);
  if (!match) return null;
  const n = Number(match[2]);
  if (!integer(n)) return null;
  const min = n + (match[1] === ">" ? 1 : 0), max = match[1] === "=" ? n : 64;
  return min <= max ? { min, max } : null;
}
export const mentionsPrincipalState = (text: string) => /\bn\s*(?:=|>|<|≥|≤)|\b(?:principal quantum|ground state)\b/.test(energyText(text));
export function seriesNames(text: string): number[] {
  const value = energyText(text);
  return HYDROGEN_SERIES.flatMap((name, index) => new RegExp(`\\b${name}\\b`).test(value) ? [index + 1] : []);
}

/** Read applicability from original-source carrier declarations. A positive
 * model adjective cannot override a contradictory electron inventory, neutral
 * multi-electron atom, molecule or ionic charge. No candidate metadata enters. */
function oneElectronSource(text: string, originalClauses: readonly string[]): boolean {
  const model = affirmed(text, /\bhydrogen(?:ic|[ -]like)?\b|\bbohr(?:['’]s)?[ -]+(?:atomic[ -]+)?(?:model|orbits?)\b|\b(?:one|single|1)[ -]electron\b/).length > 0;
  if (!model || !/\b(?:hydrogen(?:ic|[ -]like)?|bohr(?:['’]s)?[ -]+(?:atomic[ -]+)?(?:model|orbits?)|atoms?|atomic|ions?)\b/.test(text) || affirmed(text, /\b(?:non[ -]?hydrogenic|multielectron|multi[ -]electron|many[ -]electron|stark|zeeman|relativistic|molecular|screened|harmonic)\b/).length > 0 ||
    /\bnot\s+(?:a\s+)?(?:hydrogen(?:ic|[ -]like)?|one[ -]electron)\b/.test(text) || /\bhydrogen\s*(?:molecule|molecular|anion|negative ion)|\bh2\b|\bh\s*(?:\^\s*)?-/.test(text)) return false;
  const counts = declaredElectronCounts(text.replace(/\bbound\s+electrons?\b/g, "electrons").replace(/\bn_e\b/g, "electronCount"));
  if (counts.some(count => count !== 1)) return false;
  const explicitOne = /\b(?:one|single|1)[ -]electron\b/.test(text) || counts.includes(1) || /\bhydrogen(?:ic|[ -]like)\b/.test(text);
  // Preserve symbol case while reading an explicit neutral/atom inventory.
  // Lower-cased prose tokens such as 'in' must not become indium carriers.
  for (const clause of originalClauses) {
    const raw = unwrapMathMarkup(clause).normalize("NFKC");
    for (const match of raw.matchAll(/\b([A-Z][a-z]?)\b/g)) {
      const element = resolveElement(match[1]!);
      if (!element || element.z === 1 || !positive(raw.toLowerCase(), match.index!)) continue;
      const prefix = energyText(raw.slice(0, match.index!)), tail = energyText(raw.slice(match.index! + match[0].length));
      if (/\bneutral(?:\s+atom)?(?:\s+of)?$/.test(prefix) || /^(?:(?:is|atom\s+is)\s+)?neutral\b|^atom\b/.test(tail)) return false;
    }
  }
  for (const match of text.matchAll(/\b[a-z]+\b/g)) {
    if (!positive(text, match.index!)) continue;
    const element = resolveElement(match[0]);
    if (!element || match[0].length <= 2) continue; // A symbol alone may be an energy/axis designator.
    const tail = text.slice(match.index! + match[0].length);
    if (match[0] === "hydrogen" && /^(?:ic|[ -]like)\b/.test(tail)) continue;
    const charge = /^\s*(?:\^\s*)?(\d*)\s*([+-])/.exec(tail);
    if (charge && element.z - Number(charge[1] || 1) * (charge[2] === "+" ? 1 : -1) !== 1) return false;
    if (!charge && element.z !== 1 && (!explicitOne || /^\s*(?:atom|neutral)\b/.test(tail) || /\bneutral\s*$/.test(text.slice(0, match.index)))) return false;
  }
  for (const match of text.matchAll(/\b([a-z]{1,2})\s*(?:\^\s*)?(\d*)\s*([+-])(?=\s|[,.);]|$)/g)) {
    const symbol = match[1]![0]!.toUpperCase() + match[1]!.slice(1);
    const element = resolveElement(symbol);
    if (element && element.z - Number(match[2] || 1) * (match[3] === "+" ? 1 : -1) !== 1) return false;
  }
  return true;
}

/** World and layout ordinates both reach the compiler's y-up transform.
 * A reversed convention must be declared by the source. A model's axes/title
 * cannot supply it. Unsupported or conflicting directional prose fails closed. */
export function readEnergyAxis(text: string): EnergyAxis | null {
  const declarations: EnergyAxis[] = [];
  const exclusions: EnergyAxis[] = [];
  for (const clause of text.split(/[;.!?\n]/)) {
    if (!/\benergy\b/.test(clause) || !/\b(?:axis|increas\w*|decreas\w*|positive)\b/.test(clause)) continue;
    if (/\b(?:unknown|unspecified|if|unless|rotated|oblique|tilted)\b/.test(clause)) return null;
    const match = /\benergy\s+(?:(?:axis|coordinate)\s+)?(?:(?:is|does|not|never|points?|runs?|increases?|increasing|decreases?|decreasing|positive|towards?)\s+)*(up(?:wards?)?|down(?:wards?)?|right(?:wards?)?|left(?:wards?)?)\b/.exec(clause);
    if (!match || [...clause.matchAll(/\b(?:up(?:wards?)?|down(?:wards?)?|left(?:wards?)?|right(?:wards?)?)\b/g)].length !== 1) return null;
    const prefix = clause.slice(0, match.index).trim();
    const current = /\b(?:now|currently|this\s+(?:task|question|exercise|diagram)|current\s+(?:task|diagram))\b/.test(prefix);
    if (!current && /\b(?:used|was|were|had)\b/.test(prefix)) continue;
    // A bare declaration or current instruction can own an axis fact. An
    // unrecognised speaker/report prefix cannot turn a direction token into
    // a present convention. Keep unsupported declarations unproved.
    if (!/^(?:the\s*)?$|^(?:use|assume|take|let|set|draw|show|sketch|plot|graph)\b|^(?:for\s+this|in\s+this|now|currently)\b/.test(prefix)) return null;
    const word = match[1]!;
    const sign = (/^(?:up|right)/.test(word) ? 1 : -1) * (/\bdecreas\w*/.test(match[0]) ? -1 : 1);
    (/\b(?:not|never)\b/.test(match[0]) ? exclusions : declarations).push({ coordinate: /^(?:left|right)/.test(word) ? "x" : "y", sign: sign === 1 ? 1 : -1 });
  }
  // A separate frame convention also needs direct page-energy orientation;
  // it cannot silently invert raw constructed coordinates through a label.
  if (/\b(?:frame|basis)\b|[+-]\s*[xy]\b|\by\s*(?:axis\s*)?(?:increases?|points?)\s+(?:down|up)/.test(text) && !declarations.length) return null;
  const first = declarations[0] ?? { coordinate: "y" as const, sign: 1 as const };
  return declarations.every(axis => axis.coordinate === first.coordinate && axis.sign === first.sign) &&
    !exclusions.some(axis => axis.coordinate === first.coordinate && axis.sign === first.sign) ? first : null;
}

/** Read source principal-state declarations without silently dropping malformed
 * integers, unresolved subscripts, or the later members of a numeric list. */
function sourceStates(text: string): number[] | null {
  if (/\bn(?:_[a-z]+)?\s*(?:>|<|≥|≤)/.test(text)) return null;
  const values: number[] = [];
  for (const token of text.matchAll(/\bn(?:_[a-z]+)?\s*=\s*/g)) {
    if (!/^n\s*=/.test(token[0])) {
      if (/^n_e\s*=/.test(token[0])) {
        const inventory = /^([+-]?\d+(?:\.\d+)?)(?![\w.])/.exec(text.slice(token.index! + token[0].length));
        if (inventory && Number.isSafeInteger(Number(inventory[1])) && Number(inventory[1]) >= 0 &&
          !/^\s*(?:[/+*^=]|-(?!>))/.test(text.slice(token.index! + token[0].length + inventory[0].length))) continue;
      }
      return null;
    }
    let tail = text.slice(token.index! + token[0].length);
    for (;;) {
      const number = /^([+-]?\d+(?:\.\d+)?)(?![\w.])/.exec(tail);
      if (!number || !integer(Number(number[1]))) return null;
      values.push(Number(number[1]));
      tail = tail.slice(number[0].length);
      if (/^\s*(?:[/+*^=]|-(?!>))/.test(tail)) return null;
      const next = /^\s*(?:,\s*(?:and\s+)?|and\s+)(?=[+-]?\d)/.exec(tail);
      if (!next) break;
      tail = tail.slice(next[0].length);
    }
  }
  return values;
}

/** Admission requirements, never a producer/router. Request scope and original
 * source carrier are independent of plan claims, tiers and native operators. */
export function readEnergyLevelSource(question: string): EnergyLevelSource {
  const originalClauses = currentEnergyClauses(question);
  const clauses = originalClauses.map(energyText);
  const foreground = clauses.join("; ");
  const scoped = readSourceDrawingRequests(question);
  const active = scoped.filter(request => request.scope === "current");
  const requests = active.map(request => energyText(sourceUnquotedText(request.text)));
  const namedRequest = requests.some(body => HYDROGEN_SERIES.some(name => affirmed(body, new RegExp(`\\b${name}\\b`)).length > 0));
  const requested = namedRequest || requests.some(body => affirmed(body, ENERGY).length > 0);
  const atomicCarrier = /\b(?:atoms?|atomic|ions?|hydrogen(?:ic|[ -]like)?|bohr(?:['’]s)?[ -]+(?:atomic[ -]+)?(?:model|orbits?))\b/.test(foreground) || foreground.split(/[^a-z]+/).some(word => word.length > 2 && Boolean(resolveElement(word)));
  const physical = namedRequest || atomicCarrier && ENERGY.test(foreground);
  const naming = (action: string) => ["label", "name", "identify"].includes(action);
  const series: number[] = [], excludedSeries: number[] = [], excludedNames: number[] = [];
  for (const [index, body] of requests.entries()) for (const name of HYDROGEN_SERIES) for (const match of body.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
    const n = HYDROGEN_SERIES.indexOf(name) + 1;
    if (positive(body, match.index!)) series.push(n);
    else if (naming(active[index]!.action)) excludedNames.push(n);
    else if (!energyEventFacts(body, seriesNames).some(fact => fact.series === n && !fact.affirmative && fact.direction)) excludedSeries.push(n);
  }
  for (const request of scoped.filter(request => request.scope === "negated")) {
    if (naming(request.action)) excludedNames.push(...seriesNames(request.text));
    else if (!energyDirectionWords(energyText(request.text)).length) excludedSeries.push(...seriesNames(request.text));
  }
  const requestedStates = sourceStates(requests.join("; "));
  const declaredStates = sourceStates(foreground);
  const eventFacts = clauses.flatMap(body => energyEventFacts(body, seriesNames));
  for (const request of scoped.filter(request => request.scope === "negated"))
    eventFacts.push(...energyEventFacts(energyText(sourceUnquotedText(request.text)), seriesNames, true));
  const events = eventFacts.filter((fact): fact is typeof fact & { from: number; to: number } => fact.affirmative && fact.from !== undefined && fact.to !== undefined);
  const namedSeries = requests.flatMap((body, index) => naming(active[index]!.action)
    ? seriesNames(body).filter(n => { const at = body.indexOf(HYDROGEN_SERIES[n - 1]!); return positive(body, at); }) : []);
  const hydrogenic = affirmed(foreground, /\bhydrogen(?:ic|[ -]like)?\b|\bbohr\b|\binverse[ -]square\b/).length > 0 ||
    atomicCarrier && affirmed(foreground, /\b(?:one|single|1)[ -]electron\b/).length > 0 || series.length > 0;
  const transitions = series.length > 0 || requests.some(body => affirmed(body, /\bspectral\s+series\b|\b(?:spectrum|spectra)\b|\btransitions?\b/).length > 0);
  return { physical, requested, supported: question.length <= 16384 && oneElectronSource(series.length && !affirmed(foreground, /\bhydrogen(?:ic|[ -]like)?\b/).length ? foreground + "; hydrogenic atom" : foreground, originalClauses), hydrogenic, axis: readEnergyAxis(foreground),
    levels: [...new Set([...(requestedStates ?? []), ...events.flatMap(event => [event.from, event.to])])], series: [...new Set(series)], excludedSeries: [...new Set(excludedSeries)], excludedNames: [...new Set(excludedNames)], transitions, events, eventFacts, namedSeries: [...new Set(namedSeries)], unprovedStates: !requestedStates || !declaredStates || events.some(event => !integer(event.from) || !integer(event.to)) };
}
