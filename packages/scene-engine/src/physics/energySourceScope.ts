import { sourceFigureForegroundContext } from "../chemistry/figureSourceOwnership";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";

export type EnergyDirection = "emission" | "absorption";
export interface EnergyEventFact {
  from?: number;
  to?: number;
  series?: number;
  direction?: EnergyDirection;
  affirmative: boolean;
  exclusive?: true;
}
const HISTORY = /\b(?:previously|earlier|formerly|historically|used\s+to|we\s+used|last\s+(?:time|exercise)|(?:previous|earlier|old)\s+(?:task|exercise|diagram|convention))\b/gi;
const CURRENT = /\b(?:now|currently|for\s+this\s+(?:task|question|exercise|diagram)|in\s+(?:this|the\s+current)\s+diagram|current\s+(?:task|question|exercise|diagram|model))\b/gi;
const EXCLUDED = /\b(?:without|excluding|except|omit(?:ting)?|no|not|never|avoid|rather\s+than|instead\s+of|other\s+than)\b/g;
const RESTART = /\b(?:with|but|however|instead(?!\s+of)|rather(?!\s+than))\b/g;

/** Polarity belongs to this clause/object, never to whole-question tokens. */
export function affirmativeEnergyFact(body: string, at: number): boolean {
  const prefix = body.slice(0, at).split(/[;.!?\n]/).at(-1) ?? "";
  return ([...prefix.matchAll(EXCLUDED)].at(-1)?.index ?? -1) <= ([...prefix.matchAll(RESTART)].at(-1)?.index ?? -1);
}

/** Reuse original request and quotation scope, then retain only current
 * declarations. A historical prefix can be followed by a current restart;
 * reported/retracted actions supply no present physical convention. */
export function currentEnergyClauses(question: string): string[] {
  const unquoted = sourceUnquotedText(question);
  const requests = readSourceDrawingRequests(question);
  return [...unquoted.matchAll(/(?:[^;!?\n]|!(?==))+?(?:[;?\n]|!(?!=)|\.(?=\s|$)|$)/g)].flatMap(match => {
    let text = match[0].replace(/[;.!?\n]$/, "");
    const scoped = requests.filter(request => request.start >= match.index! && request.start < match.index! + match[0].length);
    if (scoped.length && !scoped.some(request => request.scope === "current")) return [];
    const historical = [...text.matchAll(HISTORY)].at(-1)?.index ?? -1;
    if (historical >= 0) {
      const restart = [...text.matchAll(CURRENT)].find(current => current.index! > historical)?.index;
      const action = scoped.find(request => request.scope === "current" && request.start - match.index! > historical);
      const starts = [restart, action ? action.start - match.index! : undefined].filter((value): value is number => value !== undefined);
      if (!starts.length) return [];
      text = text.slice(Math.min(...starts));
    }
    // The older figure foreground helper also drops any 'does not' sentence.
    // Use its reporting/context filter without discarding a declaration's
    // polarity. Negated drawing actions have already retained their scope.
    const scopeProbe = text.replace(/\b(?:do\s+not|does\s+not|don['’]t|doesn['’]t|never|must\s+not|should\s+not|cannot|can['’]t|no\s+need\s+to|not\s+to)\b/gi, " ");
    return sourceFigureForegroundContext(scopeProbe).trim() ? [text] : [];
  });
}

/** A bounded event grammar associates direction with its own ordered pair or
 * named lower state. Coordination keeps multiple events; contrast preserves
 * negative alternatives instead of making them affirmative defaults. */
export function energyDirectionWords(text: string): Array<{ direction: EnergyDirection; index: number }> {
  return [...text.matchAll(/\b(emissions?|absorptions?|emits?|absorbs?|emitted|absorbed|emitting|absorbing)\b/g)]
    .map(match => ({ direction: match[1]!.startsWith("emi") ? "emission" : "absorption", index: match.index! }));
}
export function energyEventFacts(body: string, names: (text: string) => number[], forceNegative = false): EnergyEventFact[] {
  const facts: EnergyEventFact[] = [];
  const allNames = names(body);
  // "Only A and B" owns the coordinated set, not just its first member.
  // Other sentences/clauses retain their own request scope.
  const exclusive = /\bonly\b/.test(body) ? { exclusive: true as const } : {};
  // A word-delimited pair needs the transition noun. The final state may
  // omit the repeated n=, as in “n=4 to 2”, without changing its role.
  const explicitPair = (index: string) => String.raw`\bn\s*=\s*${index}\s+to\s+(?:n\s*=\s*)?${index}\s+(?:radiative\s+)?(?:(?:emission|absorption)\s+)?transitions?\b`;
  const pieces = body.split(new RegExp(
    String.raw`\b(?:and|but|without|excluding|except|no|not|rather\s+than|instead\s+of)\b` +
    String.raw`(?=\s+(?:(?:an?|the|both)\s+)?(?:emission|absorption|emit\w*|absorb\w*|from\s+n\s*=|${explicitPair(String.raw`\d+`)}|lyman|balmer|paschen|brackett|pfund|humphreys))`, "g",
  ));
  let offset = 0;
  for (const piece of pieces) {
    const at = body.indexOf(piece, offset); offset = at + piece.length;
    const localNames = names(piece), owners = localNames.length ? localNames : allNames.length === 1 ? allNames : [undefined];
    const pairs = [...piece.matchAll(new RegExp(
      String.raw`\bfrom\s+n\s*=\s*(\d+)\s*(?:to|->|→)\s*(?:n\s*=\s*)?(\d+)|\bn\s*=\s*(\d+)\s*(?:->|→)\s*(?:n\s*=\s*)?(\d+)|${explicitPair(String.raw`(\d+)`)}`, "g",
    ))].map(match => ({ from: Number(match[1] ?? match[3] ?? match[5]), to: Number(match[2] ?? match[4] ?? match[6]) }));
    const directions = energyDirectionWords(piece);
    const both = /\bboth\s+directions\b/.exec(piece);
    if (!directions.length && both) {
      for (const series of owners) for (const pair of pairs.length ? pairs : [{}]) for (const direction of ["emission", "absorption"] as const) {
        const ordered = "from" in pair && typeof pair.from === "number" && "to" in pair && typeof pair.to === "number" ? {
          from: direction === "emission" ? Math.max(pair.from, pair.to) : Math.min(pair.from, pair.to),
          to: direction === "emission" ? Math.min(pair.from, pair.to) : Math.max(pair.from, pair.to),
        } : {};
        facts.push({ ...ordered, ...exclusive, series, direction, affirmative: !forceNegative && affirmativeEnergyFact(body, at + both.index) });
      }
    } else if (!directions.length) {
      for (const pair of pairs.length ? pairs : exclusive.exclusive ? [{}] : []) for (const series of owners) facts.push({ ...pair, ...exclusive, series, affirmative: !forceNegative && affirmativeEnergyFact(body, at) });
    } else for (const direction of directions) for (const pair of pairs.length ? pairs : [{}]) for (const series of owners) {
      facts.push({ ...pair, ...exclusive, series, direction: direction.direction,
        affirmative: !forceNegative && affirmativeEnergyFact(body, at + direction.index) });
    }
  }
  return facts;
}
