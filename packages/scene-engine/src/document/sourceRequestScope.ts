export type SourceDrawingAction = "draw" | "sketch" | "plot" | "graph" | "show" | "separate" | "keep" | "label" | "identify" | "mark" | "name";
export type SourceRequestScope = "current" | "quoted" | "reported" | "negated" | "retracted" | "verbal";
export interface SourceDrawingRequest {
  action: SourceDrawingAction;
  text: string;
  start: number;
  end: number;
  scope: SourceRequestScope;
}

type Span = { start: number; end: number };
const ACTION = /\b(draw|sketch|plot|graph|show|separate|keep|label|identify|mark|name)\b/gi;
const NEGATIVE = /\b(?:no|not|never|without|cannot|don't|can't|mustn't|shouldn't|wouldn't|won't|neither|avoid|refrain|prohibit|forbid)\b/i;
const DRAWING_ACTIONS = new Set<SourceDrawingAction>(["draw", "sketch", "plot", "graph", "show", "separate", "keep", "label", "identify", "mark", "name"]);
const normal = (value: string) => value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const isWord = (value: string | undefined) => Boolean(value && /[\p{L}\p{N}]/u.test(value));

function quotedSpans(question: string): Span[] {
  const spans: Span[] = [];
  let quote: { end: string; start: number } | null = null;
  for (let index = 0; index < question.length; index++) {
    const char = question[index]!;
    if (char === "\\") { index++; continue; }
    if (quote) {
      if (char === quote.end && (!(char === "'" || char === "’") || !isWord(question[index + 1]))) {
        spans.push({ start: quote.start, end: index + 1 });
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "`" || char === "“") quote = { end: char === "“" ? "”" : char, start: index };
    else if ((char === "'" || char === "‘") && !(isWord(question[index - 1]) && isWord(question[index + 1]))) {
      quote = { end: char === "‘" ? "’" : char, start: index };
    }
  }
  if (quote) spans.push({ start: quote.start, end: question.length });
  return spans;
}

function maskSpans(question: string, spans: Span[]): string {
  const chars = question.split("");
  for (const span of spans) for (let index = span.start; index < span.end; index++) chars[index] = " ";
  return chars.join("");
}

/** Quoted declarations supply no current source request or physical observable.
 * Spaces preserve original UTF-16 offsets for independently checked evidence. */
export function sourceUnquotedText(question: string): string {
  return maskSpans(question, quotedSpans(question));
}

/** The verb must be the current instruction, not a word in a reported sentence.
 * These are request syntax forms; no subject, chapter or object names dispatch. */
function currentPrefix(value: string): boolean {
  const prefix = normal(value).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^(?:(?:please|kindly|also|then)(?:\s*,\s*|\s+|$))+/i, "")
    .replace(/(?:\s+(?:please|kindly|also|then))+\s*$/i, "");
  return /^(?:(?:please|kindly)\s*)?$/i.test(prefix) ||
    /^(?:can|could|would|will)\s+you(?:\s+please)?$/i.test(prefix) ||
    /^(?:i|we)\s+(?:want|need|ask)\s+you\s+to$/i.test(prefix) ||
    /^you\s+(?:must|should|may|can|need\s+to|are\s+(?:asked|required)\s+to)$/i.test(prefix) ||
    /^(?:for\s+(?:this|the)\s+(?:task|question|exercise)\s*[:,]?\s*)?(?:please\s*)?$/i.test(prefix) ||
    /^(?:current\s+)?(?:task|question|exercise|instruction|request)\s*:\s*(?:please\s*)?$/i.test(prefix);
}

/** A current imperative may coordinate calculation and drawing without a
 * preceding drawing verb: 'Calculate Q and show the balance'. A reported
 * calculation or a question about whether to draw supplies no such request. */
function linkedImperativePrefix(value: string): boolean {
  if (!/\b(?:and|then|also)\s*$/i.test(value)) return false;
  return [...value.matchAll(/\b(?:calculate|compute|find|determine|evaluate|solve|derive|estimate|compare|explain|describe|list|state|give|write|answer)\b/gi)].some(match => {
    const before = value.slice(0, match.index), body = value.slice(match.index! + match[0].length);
    return currentPrefix(before) && !/\b(?:whether|if|how|wonders?|do\s+not|don['’]t|never|no\s+need|must\s+not|should\s+not|cannot|can['’]t|not\s+to)\b/i.test(body) &&
      !/\bto\s+(?:draw|sketch|plot|graph|show|separate|keep|label|identify|mark|name)\b/i.test(body);
  });
}

function drawingWords(value: string): string[] {
  const omitted = new Set(["a", "an", "the", "this", "that", "it", "and", "or", "of", "from", "with", "for", "on", "in", "to", "requested", "previous", "above", "draw", "sketch", "plot", "graph", "show", "separate", "keep", "label", "identify", "mark", "name", "figure", "diagram", "view", "inset", "panel", "qualitative", "schematic", "illustrative", "do", "not", "please"]);
  return (normal(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !omitted.has(word));
}

function retracts(request: SourceDrawingRequest, later: SourceDrawingRequest): boolean {
  if (later.scope !== "negated" || !DRAWING_ACTIONS.has(later.action) || later.start <= request.start) return false;
  if (/\b(?:the\s+)?(?:requested|previous|above|that|this)\s+(?:sketch|diagram|plot|graph|figure|view|inset|drawing|request)\b/i.test(later.text)) return true;
  const structural = (action: SourceDrawingAction) => action === "separate" || action === "keep";
  if (structural(request.action) !== structural(later.action)) return false;
  const before = drawingWords(request.text), after = drawingWords(later.text);
  return before.some(word => after.includes(word));
}

/** Original-source drawing actions with their complete linguistic scope.
 * A quote/evidence span does not become an instruction merely because it
 * contains a drawing verb. Retractions are evaluated after all source clauses,
 * so a later verbal-only instruction cannot leave an earlier request active. */
export function readSourceDrawingRequests(question: string): SourceDrawingRequest[] {
  const quotes = quotedSpans(question);
  const unquoted = maskSpans(question, quotes);
  const requests: SourceDrawingRequest[] = [];
  for (const clause of question.matchAll(/[^.!?;\n]+/g)) {
    const offset = clause.index!, body = clause[0];
    // The object in 'draw a sketch' is a noun, not another request. Only a
    // request boundary may introduce a further drawing verb in this clause.
    const actions = [...body.matchAll(ACTION)].filter((match, index) => index === 0 ||
      /(?:\b(?:and|then|also|but|instead|to|can|could|would|will|must|should|may|never|not)|don['’]t|can['’]t|[,:“"`])\s*$/i.test(normal(body.slice(0, match.index))));
    let parent: SourceDrawingRequest | null = null;
    for (let index = 0; index < actions.length; index++) {
      const match = actions[index]!, start = offset + match.index!;
      const end = offset + (actions[index + 1]?.index ?? body.length);
      const action = match[1]!.toLowerCase() as SourceDrawingAction;
      const prefix = normal(unquoted.slice(offset, start));
      const after = normal(unquoted.slice(start + match[0].length, end));
      const linkedCurrent = parent?.scope === "current" && /\b(?:and|then|also)\s*$/i.test(prefix) || linkedImperativePrefix(prefix);
      const restarted = /\b(?:but|instead|however|rather)(?:\s+please)?\s*$/i.test(prefix);
      let scope: SourceRequestScope;
      if (quotes.some(span => start >= span.start && start < span.end)) scope = "quoted";
      else if ((!linkedCurrent && !restarted && NEGATIVE.test(prefix)) || /^(?:no|not|never|neither)\b/i.test(after)) scope = "negated";
      else if (action === "show" && /^(?:that|why|whether|how)\b/i.test(after)) scope = "verbal";
      else if (currentPrefix(prefix) || linkedCurrent || restarted) scope = "current";
      else scope = "reported";
      const request = { action, start, end, text: question.slice(start, end).trim(), scope };
      requests.push(request);
      parent = request;
    }
  }
  const verbalOnly = [...unquoted.matchAll(/\b(?:verbal|written|text(?:ual)?)\s+(?:answer|explanation|response)\s+only\b|\bonly\s+(?:a\s+)?(?:verbal|written|text(?:ual)?)\s+(?:answer|explanation|response)\b/gi)];
  const explicitRetractions = [...unquoted.matchAll(/(?:^|[.!?;\n])\s*(?:please\s+)?(?:ignore|cancel|withdraw|retract|omit|skip|disregard)\b[^.!?;\n]*\b(?:drawing|diagram|sketch|plot|graph|view|inset|label|mark|request|instruction)\b/gi)];
  return requests.map(request => request.scope === "current" && DRAWING_ACTIONS.has(request.action) &&
    (verbalOnly.some(match => match.index! > request.start) || explicitRetractions.some(match => match.index! > request.start) || requests.some(later => retracts(request, later)))
    ? { ...request, scope: "retracted" } : request);
}
