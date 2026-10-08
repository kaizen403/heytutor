/**
 * Periodic placement the trend graph does not settle.
 *
 * The element table in elements.ts is the versioned reference. Block, period
 * and group are read from that row. A neutral configuration is read from
 * electronConfiguration, and its electron total has to equal Z.
 *
 * Modern periodic law orders elements by atomic number. A stem that calls
 * Mendeleev's atomic-mass order the modern law is not drawn.
 *
 * Helium is Z = 2, period 1, group 18, block s, configuration 1s2. Group 18
 * does not make it a p-block element.
 *
 * Chromium (Z = 24, group 6) and copper (Z = 29, group 11) stay d-block when
 * the configuration is written 3d5 4s1 or 3d10 4s1. The last printed term is
 * not the block.
 *
 * An f-block row has no group number. Only elements the stem names are
 * highlighted. A wrong period or group, a block taken from the first shell,
 * and an OCR-corrupt atomic number draw nothing.
 */
import type { SceneDocument } from "../types";
import { electronConfiguration } from "./electronConfiguration";
import {
  ELEMENTS,
  elementByName,
  elementBySymbol,
  elementByZ,
  type ElementBlock,
  type ElementRecord,
} from "./elements";
import { ChemScene, type ChemPlanQuantity } from "./sceneKit";
import { normalizeChemistryText } from "./formula";

const FAMILY = "chem_periodic" as const;
const MAX_ELEMENTS = 8;
const MAX_FACTS = 16;

const PROPERTY = /ioni[sz]ation|electron gain|electron affinit|electronegativ|atomic radi|ionic radi|covalent radi|metallic character/;

const ORDINAL: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
};

const NAME_KEYS = [...new Set([
  ...ELEMENTS.map((element) => element.name.toLowerCase()),
  "aluminum", "sulfur", "cesium",
])].sort((a, b) => b.length - a.length);

const NAME_PATTERN = new RegExp(`\\b(${NAME_KEYS.join("|")})\\b`, "gi");

/** Two-letter symbols that are also English words, dropped unless the next word is chemistry. */
const SYMBOL_STOP: Readonly<Record<string, RegExp>> = {
  In: /^\s+(?:the|a|an|this|that|which|order|group|period|block|modern|its|fact|general)\b/,
  At: /^\s+(?:the|a|an|least|most|room|all|once|atomic|equilibrium)\b/i,
  As: /^\s+(?:the|a|an|modern|atomic|follows|shown|well)\b/,
  Be: /^\s+(?:a|an|the|careful|sure)\b/,
  No: /^\s+(?:group|period|block|modern|such|other)\b/i,
};

interface PlaceMention {
  kind: "period" | "group";
  value: number;
  index: number;
}

function stemOf(question: string): { text: string; stem: string } {
  const text = normalizeChemistryText(question);
  return { text, stem: text.toLowerCase() };
}

function mentionsName(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(text);
}

function mentionsSymbol(text: string, symbol: string): boolean {
  return new RegExp(`(?<![A-Za-z])${symbol}(?![A-Za-z])`).test(text);
}

function mentionsElement(text: string, element: ElementRecord): boolean {
  if (mentionsName(text, element.name)) return true;
  if (element.symbol === "Al" && mentionsName(text, "aluminum")) return true;
  if (element.symbol === "S" && mentionsName(text, "sulfur")) return true;
  if (element.symbol === "Cs" && mentionsName(text, "cesium")) return true;
  return mentionsSymbol(text, element.symbol);
}

function readElements(text: string): ElementRecord[] {
  const found: Array<{ element: ElementRecord; index: number }> = [];
  for (const match of text.matchAll(NAME_PATTERN)) {
    const word = match[1] ?? "";
    if (word.toLowerCase() === "lead" && word !== "Lead") continue;
    const element = elementByName(word);
    if (!element) continue;
    found.push({ element, index: match.index ?? 0 });
  }
  const symbolPattern = /(?<![A-Za-z0-9])([A-Z][a-z]?)(?![A-Za-z0-9([])/g;
  for (const match of text.matchAll(symbolPattern)) {
    const symbol = match[1] ?? "";
    const element = elementBySymbol(symbol);
    if (!element) continue;
    const start = match.index ?? 0;
    const end = start + symbol.length;
    const stop = SYMBOL_STOP[symbol];
    if (stop?.test(text.slice(end, end + 24))) continue;
    if (symbol.length === 1) {
      const before = text.slice(Math.max(0, start - 2), start);
      const after = text.slice(end, end + 2);
      if (/\(\s*$/.test(before)) continue;
      const listBefore = /(?:,|\band|\bor|<|>|=)\s*$/.test(text.slice(Math.max(0, start - 6), start));
      if (/^\s*[.):]/.test(after) && !listBefore) continue;
    }
    found.push({ element, index: start });
  }
  found.sort((a, b) => a.index - b.index);
  const unique: ElementRecord[] = [];
  for (const entry of found) {
    if (!unique.some((element) => element.z === entry.element.z)) unique.push(entry.element);
  }
  return unique;
}

/** Clean integer atomic numbers. A mixed token such as l7 or 1O is not read as a Z. */
function atomicNumbers(text: string): number[] {
  const found: number[] = [];
  const pattern = /(?:atomic\s+number|\bZ)\s*(?:=|is|equals|:)?\s*(\d{1,3})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const z = Number(match[1]);
    if (elementByZ(z)) found.push(z);
  }
  return found;
}

function corruptAtomicNumber(text: string): boolean {
  const pattern = /(?:atomic\s+number|\bZ)\s*(?:=|is|equals|:)?\s*([A-Za-z0-9]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const token = match[1] ?? "";
    if (/^\d{1,3}$/.test(token)) continue;
    if (/^[A-Za-z]{2,}$/.test(token)) continue;
    if (/\d/.test(token) && /[A-Za-z]/.test(token)) return true;
    if (/^[OIlol]$/.test(token)) return true;
  }
  return false;
}

function subjectList(text: string): ElementRecord[] | "clash" {
  const named = readElements(text);
  const numbers = [...new Set(atomicNumbers(text))];
  if (named.length === 0) return numbers.map((z) => elementByZ(z)!);
  if (numbers.length === 0) return named;
  if (numbers.some((z) => !named.some((element) => element.z === z))) return "clash";
  return named;
}

function clauseBounds(text: string, index: number): { start: number; end: number } {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("?", index), text.lastIndexOf(";", index)) + 1;
  const ends = [text.indexOf(".", index), text.indexOf("?", index), text.indexOf(";", index)].filter((at) => at >= 0);
  return { start, end: ends.length > 0 ? Math.min(...ends) : text.length };
}

function negatedBefore(text: string, index: number): boolean {
  const prior = text.slice(Math.max(0, index - 48), index).toLowerCase();
  return /\b(?:not|never|no|without|isn't|is not|do not|don't)\b/.test(prior);
}

function questionClause(clause: string): boolean {
  return /\?/.test(clause) || /\b(?:which|what|how)\b/i.test(clause);
}

function nearestElement(clause: string, index: number, elements: readonly ElementRecord[]): ElementRecord | null {
  let best: ElementRecord | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const element of elements) {
    const pattern = new RegExp(`\\b${element.name}\\b|(?<![A-Za-z])${element.symbol}(?![A-Za-z])`, "gi");
    for (const match of clause.matchAll(pattern)) {
      const distance = Math.abs((match.index ?? 0) - index);
      if (distance < bestDistance) {
        best = element;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function placeMentions(text: string): PlaceMention[] {
  const mentions: PlaceMention[] = [];
  const numbered = /\b(period|group)\s*(?:number\s*)?(1[0-8]|[1-9])\b/gi;
  for (const match of text.matchAll(numbered)) {
    mentions.push({
      kind: (match[1] ?? "").toLowerCase() === "period" ? "period" : "group",
      value: Number(match[2]),
      index: match.index ?? 0,
    });
  }
  const ordinal = /\b(first|second|third|fourth|fifth|sixth|seventh)\s+period\b/gi;
  for (const match of text.matchAll(ordinal)) {
    const value = ORDINAL[(match[1] ?? "").toLowerCase()];
    if (value) mentions.push({ kind: "period", value, index: match.index ?? 0 });
  }
  return mentions;
}

function wrongPlaceAsserted(text: string, elements: readonly ElementRecord[]): boolean {
  for (const mention of placeMentions(text)) {
    const bounds = clauseBounds(text, mention.index);
    const clause = text.slice(bounds.start, bounds.end);
    if (questionClause(clause) || negatedBefore(text, mention.index)) continue;
    const local = elements.filter((element) => mentionsElement(clause, element));
    const element = nearestElement(clause, mention.index - bounds.start, local);
    if (!element) continue;
    if (mention.kind === "period" && element.period !== mention.value) return true;
    if (mention.kind === "group" && element.group !== mention.value) return true;
  }
  return false;
}

function wrongBlockAsserted(text: string, elements: readonly ElementRecord[]): boolean {
  const pattern = /\b([spdf])[\s-]?block\b/gi;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const bounds = clauseBounds(text, index);
    const clause = text.slice(bounds.start, bounds.end);
    if (questionClause(clause) || negatedBefore(text, index)) continue;
    const claimed = (match[1] ?? "").toLowerCase() as ElementBlock;
    const local = elements.filter((element) => mentionsElement(clause, element));
    const element = nearestElement(clause, index - bounds.start, local);
    if (element && element.block !== claimed) return true;
  }
  return false;
}

function modernLawStem(stem: string): boolean {
  if (/modern periodic law/.test(stem)) return true;
  return /mendeleev/.test(stem) && /modern/.test(stem) && /periodic law|atomic mass|atomic number/.test(stem);
}

function assertsMassIsModernLaw(stem: string): boolean {
  if (!/modern periodic law/.test(stem)) return false;
  if (!/atomic mass|mass order|mendeleev/.test(stem)) return false;
  if (/\?/.test(stem)) return false;
  if (/\b(?:not|isn't|is not|never|rather|instead|wrong|unlike)\b/.test(stem)) return false;
  if (/\b(?:which|what|why|explain|state|give|describe)\b/.test(stem)) return false;
  return true;
}

function heliumStem(text: string, stem: string): boolean {
  const helium = mentionsName(text, "helium") || mentionsSymbol(text, "He") || atomicNumbers(text).includes(2);
  if (!helium) return false;
  return /block|group|period|periodic|configuration|1s\s*\^?\(?2\)?|atomic number|\bz\s*=/.test(stem);
}

function anomalyStem(text: string, stem: string): boolean {
  const numbers = atomicNumbers(text);
  const chromium = mentionsName(text, "chromium") || mentionsSymbol(text, "Cr") || numbers.includes(24);
  const copper = mentionsName(text, "copper") || mentionsSymbol(text, "Cu") || numbers.includes(29);
  if (!chromium && !copper) return false;
  return /3d|4s|configuration|last term|last subshell|aufbau|exception/.test(stem);
}

function fBlockStem(text: string, stem: string): boolean {
  const namedF = readElements(text).some((element) => element.block === "f");
  if (/f[\s-]?block/.test(stem)) return /group|electron|period|block|element|classify|lanthan|actin/.test(stem);
  return namedF && /group|electron|block|period|classify/.test(stem);
}

function firstShellStem(stem: string): boolean {
  return /first shell|begins with 1s|starts with 1s|first subshell/.test(stem) && /block/.test(stem);
}

function assertsFirstShellBlock(stem: string): boolean {
  if (!firstShellStem(stem)) return false;
  if (/\b(?:not|don't|do not|rather|instead|wrong)\b/.test(stem)) return false;
  if (/\?/.test(stem) || /\b(?:which|what)\b/.test(stem)) return false;
  return true;
}

function assertsFBlockIsGroup(stem: string): boolean {
  if (!/f[\s-]?block/.test(stem)) return false;
  if (/\?/.test(stem) || /\b(?:which|what|how)\b/.test(stem)) return false;
  if (/\b(?:not|never|no|isn't|is not|do not|don't)\b/.test(stem)) return false;
  return /\bgroup\s*(?:number\s*)?(?:is\s*)?(?:=|:)?\s*\d+\b/.test(stem) || /\bis\s+group\s+\d+\b/.test(stem);
}

function totalElectronAsk(stem: string): boolean {
  if (/unpaired|valence electron/.test(stem)) return false;
  if (!/\belectrons?\b/.test(stem)) return false;
  return /neutral|electron count|number of electrons|how many electrons|\d+\s+electrons?\b/.test(stem);
}

function wrongNeutralCount(stem: string, elements: readonly ElementRecord[]): boolean {
  if (/unpaired|valence/.test(stem)) return false;
  if (!/neutral|electron count|number of electrons/.test(stem)) return false;
  const numbers = [...stem.matchAll(/(\d+)\s*electrons?\b/g)].map((match) => Number(match[1]));
  if (numbers.length === 0 || elements.length !== 1) return false;
  return numbers.some((count) => count !== elements[0]!.z);
}

function namedBlockSet(text: string, stem: string): boolean {
  if (PROPERTY.test(stem)) return false;
  if (!/\bblocks?\b|classify|s[\s-]?block|p[\s-]?block|d[\s-]?block|f[\s-]?block/.test(stem)) return false;
  return readElements(text).length >= 2;
}

function contradictionStem(text: string, stem: string): boolean {
  if (!/period|group/.test(stem)) return false;
  if (!/periodic|element|block/.test(stem)) return false;
  const subjects = subjectList(text);
  if (subjects === "clash") return true;
  return wrongPlaceAsserted(text, subjects);
}

/** True when this placement figure owns the stem, including stems that must not be drawn. */
export function claimsPeriodicPlacement(question: string): boolean {
  const { text, stem } = stemOf(question);
  if (!stem) return false;
  if (corruptAtomicNumber(text) && /periodic|period|group|block|element|position/.test(stem)) return true;
  if (modernLawStem(stem)) return true;
  if (heliumStem(text, stem)) return true;
  if (anomalyStem(text, stem)) return true;
  if (fBlockStem(text, stem)) return true;
  if (firstShellStem(stem)) return true;
  if (totalElectronAsk(stem) && (readElements(text).length > 0 || atomicNumbers(text).length > 0)) return true;
  if (contradictionStem(text, stem)) return true;
  if (namedBlockSet(text, stem)) return true;
  return false;
}

function keep(label: string): boolean {
  return label.length > 0 && label.length <= 16;
}

/**
 * Labels for one named element. Block and group come from the table row.
 * The electron total comes from the configuration and must equal Z.
 */
function factsFor(element: ElementRecord, stem: string): string[] | null {
  const config = electronConfiguration(element);
  if (!config || config.electrons !== element.z) return null;
  const facts: string[] = [];
  if (element.symbol === "He") {
    if (element.group === null) return null;
    facts.push(
      `He grp ${element.group}`,
      `block ${element.block}`,
      `period ${element.period}`,
      `Z=${element.z}`,
      config.full,
      `e=Z=${config.electrons}`,
    );
  } else if (element.group === null) {
    facts.push(`${element.symbol} block ${element.block}`);
    if (/f[\s-]?block|group/.test(stem)) facts.push("f not group");
    facts.push(`e=Z=${config.electrons}`);
  } else {
    facts.push(
      `${element.symbol} block ${element.block}`,
      `${element.symbol} grp ${element.group}`,
      `${element.symbol} per ${element.period}`,
    );
    if (/electron/.test(stem) || element.symbol === "Cr" || element.symbol === "Cu") {
      facts.push(`e=Z=${config.electrons}`);
    }
  }
  if (element.block !== "s" && /first shell|begins with 1s|starts with 1s/.test(stem) && /\b(?:not|do not|don't)\b/.test(stem)) {
    facts.push("not 1s");
  }
  if (!facts.every(keep)) return null;
  return facts;
}

function draw(
  question: string,
  reason: string,
  caption: string,
  elements: readonly ElementRecord[],
  facts: readonly string[],
): SceneDocument | null {
  if (facts.length < 1 || facts.length > MAX_FACTS) return null;
  if (!facts.every(keep)) return null;
  if (elements.length > MAX_ELEMENTS) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids: string[] = [];
  const rowY = 2.4;
  const cellW = 1.6;
  const cellH = 1.2;
  const gap = 2.8;
  elements.forEach((element, index) => {
    const x = (index - (elements.length - 1) / 2) * gap;
    const centre = scene.scene.helper(`cell_${element.symbol}_c`, { x, y: rowY }, "cell centre helper");
    ids.push(scene.scene.rectangle(
      `cell_${element.symbol}`,
      centre,
      cellW,
      cellH,
      `${element.symbol} highlighted cell`,
    ));
    ids.push(scene.text(`sym_${element.symbol}`, { x, y: rowY }, element.symbol, `${element.symbol} symbol`));
  });
  const firstFactY = elements.length > 0 ? rowY - cellH / 2 - 1.05 : 1.6;
  facts.forEach((label, index) => {
    ids.push(scene.text(`fact_${index}`, { x: 0, y: firstFactY - index * 0.85 }, label, "placement fact"));
  });
  const spoken = [...elements.map((element) => element.symbol), ...facts];
  scene.scene.group("placement", ids, `${reason}. ${spoken.join(", ")}.`);
  return scene.build({ caption });
}

function lawScene(question: string): SceneDocument | null {
  return draw(
    question,
    "modern periodic law orders elements by atomic number",
    "Modern periodic law: the properties of the elements are periodic functions of atomic number. Mendeleev's atomic-mass order is not this law.",
    [],
    ["by Z", "not mass", "modern law"],
  );
}

function renderPlacement(question: string): SceneDocument | null {
  const { text, stem } = stemOf(question);
  if (corruptAtomicNumber(text)) return null;
  if (assertsMassIsModernLaw(stem)) return null;
  if (assertsFirstShellBlock(stem)) return null;
  if (assertsFBlockIsGroup(stem)) return null;
  const subjects = subjectList(text);
  if (subjects === "clash") return null;
  if (subjects.length > MAX_ELEMENTS) return null;
  if (wrongNeutralCount(stem, subjects)) return null;
  if (wrongPlaceAsserted(text, subjects)) return null;
  if (wrongBlockAsserted(text, subjects)) return null;
  if (subjects.length === 0) {
    if (modernLawStem(stem)) return lawScene(question);
    if (/f[\s-]?block/.test(stem) && /\bnot\b/.test(stem) && /group/.test(stem)) {
      return draw(
        question,
        "f-block has no group number",
        "f-block elements have no group number in this table. The electron count of a neutral atom equals Z.",
        [],
        ["f not group"],
      );
    }
    return null;
  }
  const facts: string[] = [];
  for (const element of subjects) {
    const row = factsFor(element, stem);
    if (!row) return null;
    for (const fact of row) if (!facts.includes(fact)) facts.push(fact);
  }
  if (modernLawStem(stem)) {
    for (const fact of ["by Z", "not mass"]) if (!facts.includes(fact)) facts.push(fact);
  }
  const described = subjects.map((element) => {
    const group = element.group === null ? "no group" : `group ${element.group}`;
    return `${element.symbol} Z=${element.z}, period ${element.period}, ${group}, ${element.block} block`;
  }).join("; ");
  return draw(
    question,
    `placement of ${subjects.map((element) => element.symbol).join(", ")} from the element table`,
    `Only the named elements are highlighted. ${described}. A neutral atom has Z electrons. Block is the table block, not the first shell and not the last printed term.`,
    subjects,
    facts,
  );
}

/** The placement figure, or null when the stem is not owned or must not be drawn. */
export function buildPeriodicPlacementScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  if (!claimsPeriodicPlacement(question)) return null;
  try {
    return renderPlacement(question);
  } catch {
    return null;
  }
}
