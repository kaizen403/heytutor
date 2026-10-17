/**
 * Series and parallel structure read from a resistor stem.
 *
 * A mixed network is drawn only when the stem's own clause fixes its
 * grouping. This reads that clause into an explicit expression tree:
 *
 *   "X in parallel with a series combination of Y and Z"   -> P(X, S(Y, Z))
 *   "X and Y in series, connected in parallel with Z"      -> P(S(X, Y), Z)
 *   "a parallel combination of X and Y in series with Z"   -> S(P(X, Y), Z)
 *
 * The grammar is small and closed. Every word between the first and last
 * resistance must belong to it; every stated resistance must be a leaf
 * exactly once; nesting is at most three levels and at most four resistors.
 * Explicit branch declarations may span sentences: each named branch is a
 * complete expression, bound once into the declared parallel group.
 * A phrase with two readings is not resolved by preference: it yields null.
 * That covers a list on either side of "with" ("X in parallel with Y and Z in
 * series", "X and Y in parallel with Z"), a second "in ... with" chained on
 * without "this combination" ("X in series with Y in parallel with Z"), and
 * any other referring word ("X in series with Y which is in parallel with Z").
 */

export type ResistorTree = { kind: "leaf"; index: number } | { kind: "series" | "parallel"; children: ResistorTree[] };

const OHM = /(\d+(?:\.\d+)?)\s*(kΩ|MΩ|k\s*ohms?|M\s*ohms?|Ω|ohms?)(?![A-Za-z0-9])/gi;
const DROPPED = new Set(["a", "an", "the", "of", "resistor", "resistors", "is", "are", "connected", "joined", "placed", "arranged",
  "two", "three", "four", "each", "all", "then", "together", "first", "now"]);
const KEPT = new Set(["series", "parallel", "with", "and", ",", "in", "combination"]);
/** Words that point back at part of the clause without saying which part. */
const REFERRING = new Set(["which", "that", "this", "these", "it", "its", "whole", "entire", "former", "latter", "who", "whose"]);
const GROUP_NOUNS = new Set(["combination", "arrangement", "group"]);
const KINDS = new Set(["series", "parallel"]);

class Unreadable extends Error {}

function fail(): never {
  throw new Unreadable();
}

/** Words of the network clause, with each stated resistance as "#i". */
function clauseTokens(stem: string): { tokens: string[]; count: number } | null {
  let count = 0;
  // "joined end to end" is the series arrangement in other words.
  const marked = stem.replace(OHM, () => ` #${count++} `).replace(/\bend[- ]to[- ]end\b/gi, " in series ");
  if (count < 2 || count > 4) return null;
  const words = marked.toLowerCase().replace(/\b(?:resistors?|resistances?)\b/g, " ").match(/#\d|[a-z]+|,|\.|;|\?/g) ?? [];
  const first = words.findIndex((word) => word.startsWith("#"));
  let last = words.length - 1 - [...words].reverse().findIndex((word) => word.startsWith("#"));
  // Lead in: "a parallel combination of two resistors of #0 ...".
  let start = first;
  while (start > 0 && ["of", "combination", "series", "parallel", "a", "an", "the", "two", "three", "four"].includes(words[start - 1]!)) start -= 1;
  // Trail: "... are connected in series", but not "in series with <the source>".
  let end = last + 1;
  while (end < words.length && ["is", "are", "connected", "joined", "placed", "arranged", "together", "all", "each"].includes(words[end]!)) end += 1;
  if (words[end] === "in" && KINDS.has(words[end + 1] ?? "") && words[end + 2] !== "with") {
    end += 2;
    last = end - 1;
  }
  // "in series and parallel", "in series or in parallel": two arrangements.
  if (["and", "or"].includes(words[end] ?? "") && (KINDS.has(words[end + 1] ?? "") || words[end + 1] === "in" || words[end + 1] === "then")) return null;
  const window = words.slice(start, Math.max(end, last + 1));
  if (window.some((word) => word === "." || word === ";" || word === "?")) return null;
  // "this combination" / "the whole combination" names everything built so
  // far, so it scopes the next attachment ("SCOPE"). Any other referring word
  // ("which", "that", a bare "this") could point at the nearest resistance or
  // at the whole chain; the clause has two readings and is refused.
  const tokens: string[] = [];
  for (let index = 0; index < window.length; index += 1) {
    const word = window[index]!;
    const next = window[index + 1] ?? "";
    if ((word === "this" || word === "the") && (GROUP_NOUNS.has(next) || ((next === "whole" || next === "entire") && GROUP_NOUNS.has(window[index + 2] ?? "")))) {
      if (word === "the" && KINDS.has(tokens.at(-1) ?? "")) return null;
      index += next === "whole" || next === "entire" ? 2 : 1;
      if (tokens.at(-1) === "and") tokens.pop();
      tokens.push("SCOPE");
      continue;
    }
    if (REFERRING.has(word)) return null;
    if (word === "combination" && !KINDS.has(tokens.at(-1) ?? "")) return null;
    if (word.startsWith("#") || KEPT.has(word)) tokens.push(word);
    else if (!DROPPED.has(word)) return null;
  }
  // Collapse repeated commas.
  return { tokens: tokens.filter((token, index) => !(token === "," && tokens[index - 1] === ",")), count };
}

function node(kind: "series" | "parallel", children: ResistorTree[]): ResistorTree {
  // A series child of a series node is the same series chain.
  return { kind, children: children.flatMap((child) => child.kind === kind ? (child as { children: ResistorTree[] }).children : [child]) };
}

function parse(tokens: string[]): ResistorTree {
  type Parsed = { tree: ResistorTree; at: number };
  const isLeaf = (at: number) => /^#\d$/.test(tokens[at] ?? "");
  const separator = (at: number): number | null => {
    if (tokens[at] === "and") return at + 1;
    if (tokens[at] === ",") return tokens[at + 1] === "and" ? at + 2 : at + 1;
    return null;
  };
  const atom = (at: number): Parsed[] => isLeaf(at)
    ? [{ tree: { kind: "leaf", index: Number(tokens[at]!.slice(1)) }, at: at + 1 }] : [];
  // Enumerate all possible ends of an explicitly named group. A nested
  // conjunction can close either group; only a unique complete parse wins.
  // Four source resistors bound the search, and every group needs >=2 items.
  const combination = (at: number, nesting = 0): Parsed[] => {
    if (nesting >= 3) return [];
    if (!KINDS.has(tokens[at] ?? "") || tokens[at + 1] !== "combination") return [];
    const kind = tokens[at] as "series" | "parallel";
    const results: Parsed[] = [];
    const item = (start: number): Parsed[] => [...atom(start), ...combination(start, nesting + 1)];
    const extend = (children: ResistorTree[], end: number): void => {
      if (children.length >= 2) results.push({ tree: node(kind, children), at: end });
      const next = separator(end);
      if (next !== null) for (const parsed of item(next)) extend([...children, parsed.tree], parsed.at);
    };
    for (const parsed of item(at + 2)) extend([parsed.tree], parsed.at);
    return results;
  };
  // An unnamed list still needs its own closing arrangement. Unlike named
  // groups, its end is never inferred by an outer conjunction.
  const plainList = (start: number): { children: ResistorTree[]; at: number } | null => {
    const first = atom(start)[0];
    if (!first) return null;
    const children = [first.tree];
    let at = first.at;
    while (true) {
      const next = separator(at);
      const parsed = next === null ? undefined : atom(next)[0];
      if (!parsed) return { children, at };
      children.push(parsed.tree);
      at = parsed.at;
    }
  };
  const terms: Parsed[] = combination(0);
  const plain = plainList(0);
  if (plain) {
    const { children, at } = plain;
    if (tokens[at] === "in" && KINDS.has(tokens[at + 1] ?? "") && tokens[at + 2] !== "with") {
      if (children.length >= 2) terms.push({ tree: node(tokens[at + 1] as "series" | "parallel", children), at: at + 2 });
    } else if (children.length === 1) terms.push({ tree: children[0]!, at });
  }
  const complete = new Map<string, ResistorTree>();
  const attach = ({ tree, at: start }: Parsed, attachments: number): void => {
    if (start === tokens.length) { complete.set(formatResistorTree(tree), tree); return; }
    let at = start;
    if (tokens[at] === ",") at += 1;
    if (tokens[at] === "and" && tokens[at + 1] === "in") at += 1;
    const scoped = tokens[at] === "SCOPE";
    if (scoped) at += 1;
    if (tokens[at] !== "in" || !KINDS.has(tokens[at + 1] ?? "") || tokens[at + 2] !== "with") return;
    if (attachments > 0 && !scoped) return;
    const kind = tokens[at + 1] as "series" | "parallel";
    const operands = combination(at + 3);
    const single = atom(at + 3)[0];
    // A bare list after 'with' has two readings, even with a trailing kind.
    if (single && tokens[single.at] !== "and" && !(tokens[single.at] === "," && isLeaf(single.at + 1))) operands.push(single);
    for (const operand of operands) attach({ tree: node(kind, [tree, operand.tree]), at: operand.at }, attachments + 1);
  };
  for (const term of terms) attach(term, 0);
  if (complete.size !== 1) fail();
  return complete.values().next().value!;
}

/**
 * Resolve explicitly enumerated branch declarations before the expression
 * reader. Sentence boundaries are meaningful here: each declaration supplies
 * one complete operand of the named parallel group. No nearest-reference or
 * conjunction guessing is used, and every resistance must occur once.
 */
function readBranchDeclarations(stem: string): ResistorTree | null {
  let count = 0;
  const marked = stem.replace(OHM, () => ` #${count++} `).toLowerCase();
  if (count < 2 || count > 4 || /[-+]\s*#/.test(marked)) return null;
  const clauses = marked.split(/[.;]\s+/).map((part) => part.trim());
  const header = clauses.shift() ?? "";
  const group = /\b(two|three|2|3) parallel branches\s*[.]?$/.exec(header);
  if (!group) return null;
  const expected = group[1] === "two" || group[1] === "2" ? 2 : 3;
  const branches: ResistorTree[] = [];
  const names = new Set<string>();
  // Ordered names bind to a branch exactly once; "the other" is only
  // meaningful for a pair. Unparsed trailing declarations never disappear.
  const ordinals: Record<string, number> = { one: 0, first: 0, second: 1, third: 2, other: 1 };
  for (const clause of clauses) {
    if (/^(?:draw|find|calculate|determine|explain|what)\b/.test(clause)) {
      if (branches.length !== expected || /#\d|\b(?:connect(?:ed|ing)?|disconnect(?:ed|ing)?|short(?:ed|ing)?|open(?:ed|ing)?|switch(?:ed|ing)?|replac(?:e|ed|ing))\b/.test(clause)) return null;
      continue;
    }
    const declaration = /^(?:the )?(one|first|second|third|other)(?: branch)? (?:contains|has|consists of) (.+?)[.]?$/.exec(clause);
    if (!declaration) return null;
    const name = declaration[1]!;
    const index = ordinals[name]!;
    if (index !== branches.length || names.has(name) || (name === "other" && expected !== 2)) return null;
    names.add(name);
    const words = declaration[2]!.match(/#\d|[a-z]+|[,.;?]/g) ?? [];
    const tokens: string[] = [];
    for (const word of words) {
      if (word.startsWith("#") || KEPT.has(word)) tokens.push(word);
      else if (!DROPPED.has(word)) return null;
    }
    branches.push(parse(tokens));
  }
  if (branches.length !== expected) return null;
  const parallel = node("parallel", branches);
  const prefix = header.slice(0, group.index).trim();
  if (!/#\d/.test(prefix)) {
    // A source can be connected directly across the declared branch group.
    if (!/\b(?:across|to)\s*$/.test(prefix)) return null;
    return parallel;
  }
  // A placeholder denotes the already-bound group, never an invented
  // resistor. The ordinary expression grammar still proves its attachment.
  const placeholder = count;
  const first = prefix.indexOf("#");
  const words = `${prefix.slice(first)} #${placeholder}`.match(/#\d|[a-z]+|[,.;?]/g) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    if (word.startsWith("#") || KEPT.has(word)) tokens.push(word);
    else if (!DROPPED.has(word)) return null;
  }
  const substitute = (tree: ResistorTree): ResistorTree => tree.kind === "leaf"
    ? tree.index === placeholder ? parallel : tree
    : node(tree.kind, tree.children.map(substitute));
  return substitute(parse(tokens));
}

function depth(tree: ResistorTree): number {
  return tree.kind === "leaf" ? 0 : 1 + Math.max(...tree.children.map(depth));
}

function leaves(tree: ResistorTree): number[] {
  return tree.kind === "leaf" ? [tree.index] : tree.children.flatMap(leaves);
}

/**
 * The bound series/parallel tree of a mixed resistor stem, or null when the
 * stem's clause does not fix one (unknown words, a resistance used twice or
 * not at all, a phrase with two readings, deeper than three levels).
 */
export function readResistorTree(stem: string): ResistorTree | null {
  try {
    const declared = readBranchDeclarations(stem);
    const clause = declared ? null : clauseTokens(stem);
    if (!declared && !clause) return null;
    const tree = declared ?? parse(clause!.tokens);
    const count = [...stem.matchAll(OHM)].length;
    const used = leaves(tree).sort((a, b) => a - b);
    if (tree.kind === "leaf" || depth(tree) > 3 || used.length !== count || used.some((index, position) => index !== position)) return null;
    return tree;
  } catch (error) {
    if (error instanceof Unreadable) return null;
    throw error;
  }
}

export function formatResistorTree(tree: ResistorTree): string {
  return tree.kind === "leaf" ? String(tree.index) : `${tree.kind === "series" ? "S" : "P"}(${tree.children.map(formatResistorTree).join(",")})`;
}

export function parseResistorTree(text: string): ResistorTree | null {
  let at = 0;
  const read = (): ResistorTree | null => {
    const head = text[at];
    if (head === "S" || head === "P") {
      at += 2;
      const children: ResistorTree[] = [];
      while (text[at] !== ")") {
        const child = read();
        if (!child) return null;
        children.push(child);
        if (text[at] === ",") at += 1;
      }
      at += 1;
      return { kind: head === "S" ? "series" : "parallel", children };
    }
    const digits = /^\d+/.exec(text.slice(at))?.[0];
    if (!digits) return null;
    at += digits.length;
    return { kind: "leaf", index: Number(digits) };
  };
  const tree = read();
  return tree && at === text.length ? tree : null;
}
