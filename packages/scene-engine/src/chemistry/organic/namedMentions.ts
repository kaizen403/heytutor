/** Existing whole-name mention reader, shared unchanged by structure and reaction source readers. */
import { moleculeFromName, normalizeName } from "./names";
import { heavyAtomCount, type Molecule } from "./smiles";
const MAX_HEAVY_ATOMS = 24;

export interface Mention {
  readonly molecule: Molecule;
  readonly key: string;
  readonly text: string;
  /** Character offset in the scanned text. */
  readonly start: number;
  readonly end: number;
  /** True when the hit was a condensed formula alias (CH3CHO), not a word name. */
  readonly weak: boolean;
}

const TOKEN_SPLIT = /\s+/;
const TRIM_LEAD = /^[("'[]+/;
const TRIM_TAIL = /[.,;:?!)"'\]]+$/;
const SENTENCE_END = /[.;:?!]$/;
/** A name followed by one of these is a named test or reaction, not a compound in the question. */
const NAMED_PROCESS = /^(?:test|tests|reagent|reagents|reaction|reactions|rearrangement|synthesis|condensation|coupling|ring|rings|nucleus)$/i;
/** Solvents named in passing; they never carry the cue on their own. */
const SOLVENT = /^(?:dmf|thf|dioxane|1,4-dioxane|tetrahydrofuran|dimethylformamide|n,n-dimethylformamide|dichloromethane|ccl4|chcl3)$/i;

/** Every compound name in the stem, longest span first, in order of appearance. */
export function findMentions(text: string): Mention[] {
  const raw = text.split(TOKEN_SPLIT).filter(Boolean);
  const tokens: Array<{ text: string; start: number; end: number; breaks: boolean }> = [];
  let cursor = 0;
  for (const piece of raw) {
    const start = text.indexOf(piece, cursor);
    cursor = start + piece.length;
    const trimmed = piece.replace(TRIM_LEAD, "").replace(TRIM_TAIL, "");
    tokens.push({ text: trimmed, start, end: cursor, breaks: SENTENCE_END.test(piece) });
  }
  const mentions: Mention[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: Mention | null = null;
    let used = 1;
    for (let span = Math.min(4, tokens.length - i); span >= 1; span -= 1) {
      const slice = tokens.slice(i, i + span);
      if (slice.slice(0, -1).some((token) => token.breaks)) continue;
      if (slice.some((token) => token.text.length === 0)) continue;
      let candidate = slice.map((token) => token.text).join(" ");
      if (!/[a-z]/i.test(candidate)) continue;
      // OCR splits a systematic name at its substituent prefix: "2,4-dimethyl
      // pentane". Read it whole, and never take the bare parent on its own,
      // which drew pentane for 2,4-dimethylpentane.
      if (span > 1 && /(?:yl|-)$/i.test(slice[0]!.text) && !moleculeFromName(candidate)) {
        candidate = slice.map((token) => token.text).join("");
      }
      if (span === 1 && i > 0 && !tokens[i - 1]!.breaks && /(?:yl|-|\d-[a-z]+o)$/i.test(tokens[i - 1]!.text)) continue;
      // A formula split across tokens ("CH3 OH", "(CH3 CO),0") is OCR debris
      // from a drawn structure; a student writes CH3OH as one token.
      if (span > 1 && !/[a-z]{3,}/.test(candidate)) continue;
      if (span === 1 && candidate.length < 3) continue;
      const molecule = moleculeFromName(candidate);
      if (!molecule) continue;
      if (heavyAtomCount(molecule) > MAX_HEAVY_ATOMS) continue;
      const following = tokens[i + span];
      if (following && NAMED_PROCESS.test(following.text) && !slice[slice.length - 1]!.breaks) continue;
      const weak = SOLVENT.test(candidate) || (/\d/.test(candidate) && !/[a-z]{4,}/i.test(candidate.replace(/[^a-z]/gi, "").replace(/^(ch|c\d|h\d)+$/i, "")));
      found = { molecule, key: molecule.name ?? normalizeName(candidate), text: candidate, start: slice[0]!.start, end: slice[slice.length - 1]!.end, weak };
      used = span;
      break;
    }
    if (found) mentions.push(found);
    i += used;
  }
  return mentions;
}
