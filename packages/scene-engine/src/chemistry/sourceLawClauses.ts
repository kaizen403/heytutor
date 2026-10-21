import type { ChemistrySpan } from "./quantityReader";

export type LawClauseKind = "declaration" | "relation" | "domain" | "reaction" | "context" | "graph" | "mark";
export interface LawAxisMeaning {
  /** Semantic identity and operation are distinct from the displayed scale. */
  symbol: string;
  operation: "quantity" | "log10" | "fraction";
  /** Closed syntaxes for this source-bound meaning; formal symbols keep case. */
  syntax: readonly string[];
}
interface Clause { span: ChemistrySpan; kind: LawClauseKind }
export const lawWord = (word: string): string => word.replace(/[A-Za-z]/g, letter => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).replace(/\s+/g, "\\s+");
const article = `(?:${lawWord("the")}\\s+)?`;
const boundary = "(?=$|[^\\p{L}\\p{N}_])";
const alternatives = (axis: LawAxisMeaning) => `(?:${axis.syntax.join("|")})`;
const span = (match: RegExpMatchArray, group = 0): ChemistrySpan => ({ start: match.indices![group]![0], end: match.indices![group]![1] });

/** Positive clause coverage is separate from the scalar/notation inventory. */
export class SourceLawClauses {
  private readonly clauses: Clause[] = [];
  constructor(readonly question: string) {}
  bind(source: ChemistrySpan, kind: LawClauseKind): void {
    this.clauses.push({ span: source, kind });
  }
  consume(body: string, kind: LawClauseKind): RegExpMatchArray[] {
    const matches = [...this.question.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${body})${boundary}`, "gdu"))];
    for (const match of matches) this.bind(span(match), kind);
    return matches;
  }
  graph(y: LawAxisMeaning, x?: LawAxisMeaning): boolean {
    const verb = ["plot", "draw", "sketch"].map(lawWord).join("|");
    const ordered = x ? `\\s+(?:${lawWord("against")}|${lawWord("versus")})\\s+${article}${alternatives(x)}` : "";
    return this.consume(`(?:${verb})\\s+${article}${alternatives(y)}${ordered}`, "graph").length > 0;
  }
  /** Repeated axis descriptions must resolve to the same ordered meanings. */
  repeatedAxes(x: LawAxisMeaning, y: LawAxisMeaning): ChemistrySpan[] | null {
    const notation: ChemistrySpan[] = [];
    const matches = [...this.question.matchAll(/\b(?:[Uu]se|[Pp]ut|[Pp]lace)\s+([^;.?!]+?)\s+on\s+(?:the\s+)?(horizontal|vertical)\s+axis\s+and\s+([^;.?!]+?)\s+on\s+(?:the\s+)?(horizontal|vertical)\s+axis\b/gd)];
    for (const match of matches) {
      if (match[2] === match[4]) return null;
      for (const [group, direction] of [[1, match[2]], [3, match[4]]] as const) {
        const meaning = direction === "horizontal" ? x : y;
        if (!new RegExp(`^${article}${alternatives(meaning)}$`, "u").test(match[group]!.trim())) return null;
        // Only the positively parsed axis expression owns its log base/unit
        // notation; the complete clause never exempts arbitrary numbers.
        notation.push(span(match, group));
      }
      this.bind(span(match), "context");
    }
    return notation;
  }
  complete(): boolean {
    const clauses = [...this.clauses].sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
    if (!clauses.some(clause => clause.kind === "graph")) return false;
    let end = 0;
    for (const clause of clauses) {
      if (clause.span.end <= end) continue;
      if (clause.span.start > end && !this.join(this.question.slice(end, clause.span.start), clause.kind, end > 0)) return false;
      end = clause.span.end;
    }
    return /^[\s,;:.!?]*$/.test(this.question.slice(end));
  }
  private join(text: string, right: LawClauseKind, hasLeft: boolean): boolean {
    const words = text.replace(/^[\s,;:.!?]+|[\s,;:.!?]+$/g, "").toLowerCase();
    if (!words) return true;
    // These are typed grammar edges between proved clauses, not ignored prose.
    // A dangling connector, an unknown modifier or any remaining source word
    // fails because the entire intervening span must be one valid edge.
    if (hasLeft && /^(?:and|also|and also)$/.test(words)) return true;
    const cue = words.replace(hasLeft ? /^(?:and\s+)?/ : /$^/, "");
    if (right === "relation") return /^(?:use|given|take)$/.test(cue);
    if (right === "declaration") return /^(?:given|take|with)$/.test(cue);
    if (right === "domain") return /^(?:use|for)$/.test(cue);
    if (right === "reaction") return cue === "for";
    return false;
  }
}
