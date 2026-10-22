/** Contextual mathematics only: no numeric value or quantity-reader exception. */
interface Span { start: number; end: number }
export interface SymbolicArrheniusSource {
  source: { span: Span; text: string };
  exponential: { span: Span; text: string };
}
const IDENTITY = /^k\s*=\s*A\s*((?:e\s*\^\s*|exp\s*)\(\s*[-−]\s*E_?a\s*\/\s*(?:R\s*T|\(\s*R\s*T\s*\))\s*\))/d;
const REQUEST_BRIDGE = /^\s*,\s*(?:find|calculate|determine|compute|evaluate)\s+(?:the\s+)?activation energy\s+(?:if|when)\s+(?:(?:the|a)\s+)?$/i;

/** Entire original owner payload must close; a successful prefix is no proof. */
export function readSymbolicArrheniusSource(question: string, within: Span): SymbolicArrheniusSource | null {
  if (!Number.isInteger(within.start) || !Number.isInteger(within.end) || within.start < 0 || within.end > question.length || within.end <= within.start) return null;
  const before = question.slice(0, within.start);
  if (/[\p{L}\p{N}\p{M}_]$/u.test(before) || /[=+*/^−-]\s*$/.test(before)) return null;
  const body = question.slice(within.start, within.end), match = IDENTITY.exec(body);
  if (!match) return null;
  const rest = body.slice(match[0].length);
  if (rest.trim() !== "" && !REQUEST_BRIDGE.test(rest)) return null;
  const exponent = match.indices![1]!;
  return { source: { span: { start: within.start, end: within.start + match[0].length }, text: match[0] },
    exponential: { span: { start: within.start + exponent[0], end: within.start + exponent[1] }, text: match[1]! } };
}

/** Locate complete statements for the expression-owner inventory. Other
 * declarations still retain their own scalar/contradiction obligations. */
export function findSymbolicArrheniusSources(question: string): SymbolicArrheniusSource[] {
  const found: SymbolicArrheniusSource[] = [];
  for (const owner of question.matchAll(/\bk\s*(?==)/g)) {
    const start = owner.index!, tail = question.slice(start);
    const boundary = /[;?\n]|\.(?=\s|$)/.exec(tail);
    let end = boundary ? start + boundary.index : question.length;
    // A closed conditional request may end at the next independent rate owner.
    const next = /\brate constant\b/.exec(question.slice(start, end));
    if (next) end = start + next.index;
    const source = readSymbolicArrheniusSource(question, { start, end });
    if (source) found.push(source);
  }
  return found;
}
