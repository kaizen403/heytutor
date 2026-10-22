import { elementByName } from "./elements";
import type { NamedSpeciesMention } from "./namedSpecies";

// Element-name morphology, not a compound catalog. A prefix supplies only
// its explicit atom count; neither valence nor a molecular shape is inferred.
const IDE_ELEMENTS: Readonly<Record<string, string>> = {
  hydride: "H", boride: "B", carbide: "C", nitride: "N", oxide: "O",
  fluoride: "F", silicide: "Si", phosphide: "P", sulfide: "S", sulphide: "S",
  chloride: "Cl", arsenide: "As", selenide: "Se", bromide: "Br",
  telluride: "Te", iodide: "I",
};
const PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ["mono", 1], ["di", 2], ["tri", 3], ["tetra", 4], ["penta", 5],
  ["hexa", 6], ["hepta", 7], ["octa", 8], ["nona", 9], ["deca", 10],
];
interface CountedElement { symbol: string; count: number }

function firstElement(word: string): CountedElement | null {
  const plain = elementByName(word);
  if (plain) return { symbol: plain.symbol, count: 1 };
  for (const [prefix, count] of PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const element = elementByName(word.slice(prefix.length));
    if (element) return { symbol: element.symbol, count };
  }
  return null;
}

function secondElement(word: string): CountedElement | null {
  if (Object.hasOwn(IDE_ELEMENTS, word)) return { symbol: IDE_ELEMENTS[word]!, count: 1 };
  for (const [prefix, count] of PREFIXES) {
    if (word.startsWith(prefix) && Object.hasOwn(IDE_ELEMENTS, word.slice(prefix.length))) {
      return { symbol: IDE_ELEMENTS[word.slice(prefix.length)]!, count };
    }
    // Standard vowel elision in monoxide, tetroxide and pentoxide.
    if (/[ao]$/.test(prefix) && word === `${prefix.slice(0, -1)}oxide`) return { symbol: "O", count };
  }
  return null;
}

/** Closed two-word neutral binary names with exact original text spans. */
export function binaryCovalentNameMentions(text: string): NamedSpeciesMention[] {
  return [...text.matchAll(/\b[A-Za-z]+\b/g)].flatMap(match => {
    const first = firstElement(match[0].toLowerCase());
    if (!first) return [];
    const tail = /^\s+([A-Za-z]+)\b/.exec(text.slice(match.index + match[0].length));
    const second = tail ? secondElement(tail[1]!.toLowerCase()) : null;
    if (!second || first.symbol === second.symbol) return [];
    const atom = (element: CountedElement) => `${element.symbol}${element.count === 1 ? "" : element.count}`;
    return [{ formula: atom(first) + atom(second), start: match.index, end: match.index + match[0].length + tail![0].length }];
  });
}
