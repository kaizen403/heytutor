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
 * exactly once; nesting is at most two levels and at most four resistors.
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
  let at = 0;
  const peek = (offset = 0): string | undefined => tokens[at + offset];
  const take = (expected?: string): string => {
    const token = tokens[at];
    if (token === undefined || (expected !== undefined && token !== expected)) fail();
    at += 1;
    return token;
  };
  const atom = (): ResistorTree => {
    const token = take();
    if (!token.startsWith("#")) fail();
    return { kind: "leaf", index: Number(token.slice(1)) };
  };
  // item ((, | and | , and) item)*: plain resistances only, so a list never
  // hides a nested grouping.
  const list = (): ResistorTree[] => {
    const items = [atom()];
    while (true) {
      if (peek() === "," && peek(1)?.startsWith("#")) { take(","); items.push(atom()); continue; }
      if (peek() === "," && peek(1) === "and" && peek(2)?.startsWith("#")) { take(","); take("and"); items.push(atom()); continue; }
      if (peek() === "and" && peek(1)?.startsWith("#")) { take("and"); items.push(atom()); continue; }
      return items;
    }
  };
  const combination = (): ResistorTree | null => {
    if (KINDS.has(peek() ?? "") && peek(1) === "combination") {
      const kind = take() as "series" | "parallel";
      take("combination");
      const items = list();
      if (items.length < 2) fail();
      return node(kind, items);
    }
    return null;
  };
  // A term is a named combination, a single resistance, or a list closed by
  // its own arrangement ("#0 and #1 in series"). A bare list is unarranged.
  const term = (): { tree: ResistorTree; bare: boolean } => {
    const named = combination();
    if (named) return { tree: named, bare: false };
    const items = list();
    if (peek() === "in" && KINDS.has(peek(1) ?? "") && peek(2) !== "with") {
      take("in");
      const kind = take() as "series" | "parallel";
      if (items.length < 2) fail();
      return { tree: node(kind, items), bare: false };
    }
    return items.length === 1 ? { tree: items[0]!, bare: false } : { tree: { kind: "series", children: items }, bare: true };
  };
  // The operand after "with" is one resistance or a named combination. "with
  // #1 and #2 in series" has two readings and is refused.
  const operand = (): ResistorTree => {
    const named = combination();
    if (named) return named;
    const single = atom();
    if (peek() === "and" || (peek() === "," && peek(1)?.startsWith("#"))) fail();
    return single;
  };
  const first = term();
  const bare = first.bare;
  let tree = first.tree;
  let attachments = 0;
  while (at < tokens.length) {
    if (peek() === ",") take(",");
    if (peek() === "and" && peek(1) === "in") take("and");
    const scoped = peek() === "SCOPE";
    if (scoped) take("SCOPE");
    if (peek() !== "in" || !KINDS.has(peek(1) ?? "") || peek(2) !== "with") fail();
    // "#0 and #1 in parallel with #2" could group #0 with #1 first or not.
    if (bare) fail();
    // "#0 in series with #1 in parallel with #2" could attach the second
    // clause to #1 or to the chain; only "this combination" scopes it.
    if (attachments > 0 && !scoped) fail();
    attachments += 1;
    take("in");
    const kind = take() as "series" | "parallel";
    take("with");
    tree = node(kind, [tree, operand()]);
  }
  if (bare) fail();
  return tree;
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
 * not at all, a phrase with two readings, deeper than two levels).
 */
export function readResistorTree(stem: string): ResistorTree | null {
  const clause = clauseTokens(stem);
  if (!clause) return null;
  try {
    const tree = parse(clause.tokens);
    const used = leaves(tree).sort((a, b) => a - b);
    if (tree.kind === "leaf" || depth(tree) > 2 || used.length !== clause.count || used.some((index, position) => index !== position)) return null;
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
