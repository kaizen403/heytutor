/** Original-source scalar programs. A number occurring in prose is not a datum.
 * This reader supplies no geometry, routing, law or model applicability. */
import { readSourceDrawingRequests, sourceUnquotedText } from "./sourceRequestScope";
import { parseStemNumber } from "../archetypes/slots";

export interface SourceMeasurementFact {
  owner: string; value: number; unit: string;
  start: number; end: number; quote: string;
}
export interface SourceMeasurementOptions {
  /** A constructor's already-proved object identity, not a topic classifier. */
  constructors?: ReadonlyArray<{ noun: string; name: string }>;
  aliases?: ReadonlyArray<readonly string[]>;
}
export interface SourceMeasurementProgram {
  facts: SourceMeasurementFact[];
  /** Anonymous ordered data retain their original spans but prove no name. */
  ordered: SourceMeasurementFact[];
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMBER = /^[+-]?(?:\d+\s*\/\s*\d+|(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(?![\p{L}\p{N}_./])/u;
const ASSIGNMENT = /\b[A-Za-z][A-Za-z0-9_]*\s*(?:=|\bis\b|\bequals\b)\s*[+−-]?(?:\d|\.\d)/u;
const RETRACT = /^(?:please\s+)?(?:do\s+not\s+use|ignore|cancel|retract|withdraw|discard|reject|omit|disregard)\b\s*/i;
const REPORT = /^(?:the\s+following|these\s+values|this\s+value|the\s+claim)\s+(?:is|are)\s+(?:retracted|withdrawn|hypothetical|false)\s*:/i;
const REPORTED = /^(?:(?:the|a|an)\s+)?(?:(?:previous|earlier|old|stale|obsolete|withdrawn|retracted|hypothetical|separate|reported|unreliable)\s+)+(?:note|measurement|value|example|claim|data)\b|^(?:previously|earlier|formerly|if|unless|suppose|according\s+to)\b|^(?:(?:the|a|an)\s+)?[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:said|says|claimed|claims|reported|wrote|asked)\b/i;
const SCOPE_QUALIFICATION = /\b(?:retracted|withdrawn|cancel(?:l)?ed|discarded|rejected|false|hypothetical|obsolete|superseded)\b|\bnot\s+(?:(?:a|the|actually|really|current|source)\s+)*(?:fact|given|true)\b/i;
const POSTFIX_WITHDRAWAL = /^(.*?)(?:,\s*(?:but\s+)?(?:(?:this|the|that)\s+)?(?:declaration|statement|fact|measurement|reading|value)\s+(?:is|was|remains)\s+(?:retracted|withdrawn|cancel(?:l)?ed)|\s+is\s+not\s+(?:(?:a|the|current|positive)\s+)*(?:source\s+)?(?:fact|given|declaration|measurement|reading|true))\s*$/i;
const PREVIOUS_WITHDRAWAL = /^(?:this|that|the)\s+(?:(?:preceding|previous|prior)\s+)?(?:statement|declaration|measurement|reading|fact)\s+(?:is|was|has\s+been)\s+(?:retracted|withdrawn|cancel(?:l)?ed)\s*$/i;

function readList(question: string, body: string, offset: number): SourceMeasurementFact[] | null {
  const facts: SourceMeasurementFact[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const space = /^\s*/.exec(body.slice(cursor))![0]; cursor += space.length;
    if (cursor === body.length) break;
    const start = cursor;
    const identifier = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*/.exec(body.slice(cursor));
    if (identifier) cursor += identifier[0].length;
    const number = NUMBER.exec(body.slice(cursor));
    if (!number) return null;
    const value = parseStemNumber(number[0]);
    if (value === null || !Number.isFinite(value)) return null;
    cursor += number[0].length;
    let end = cursor, unit = "";
    const tail = body.slice(cursor);
    // A whole optional unit, never a cropped suffix. Unknown units remain
    // explicit and a numeric consumer must prove their dimensional meaning.
    const measurementUnit = /^\s+((?!and\b|or\b)[\p{L}µμΩ°%][\p{L}\p{N}µμΩ°%_]*(?:\s*[/*^·⋅]\s*[+−-]?[\p{L}\p{N}µμΩ°%_]+)*)/u.exec(tail);
    if (measurementUnit) { unit = measurementUnit[1]!.trim(); cursor += measurementUnit[0].length; end = cursor; }
    facts.push({ owner: identifier?.[1] ?? "", value, unit, start: offset + start, end: offset + end, quote: question.slice(offset + start, offset + end) });
    const separator = /^\s*(?:,\s*(?:and\s+)?|and\s+)/i.exec(body.slice(cursor));
    if (separator) { cursor += separator[0].length; continue; }
    if (/^\s*[,.:]?\s*$/.test(body.slice(cursor))) break;
    return null;
  }
  return facts.length && facts.every(f => Boolean(f.owner) === Boolean(facts[0]!.owner)) ? facts : null;
}

/** Whole affirmative declarations/constructor data are the only facts. Explicit
 * replacement and withdrawal are operations; quotations, reports and examples
 * cannot supply operands. An unknown scalar statement is unproved, not ignored. */
export function readCurrentMeasurementFacts(question: string, options: SourceMeasurementOptions = {}): SourceMeasurementProgram | null {
  if (question.length > 16384) return null;
  const source = sourceUnquotedText(question);
  const requests = readSourceDrawingRequests(question);
  const relevant = (body: string) => {
    const owners = options.aliases?.flat();
    if (!owners?.length) return ASSIGNMENT.test(body);
    return owners.some(owner => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(owner)}\\s*(?:=|is\\b|equals\\b)\\s*[+−-]?(?:\\d|\\.\\d)`, "u").test(body));
  };
  const facts = new Map<string, SourceMeasurementFact[]>();
  let ordered: SourceMeasurementFact[] = [];
  let precedingFacts: SourceMeasurementFact[] | null = null;
  const key = (owner: string) => options.aliases?.find(group => group.includes(owner))?.[0] ?? owner;
  for (const clause of source.matchAll(/(?:[^;!?\n]|!(?==))+?(?:[;?\n]|!(?!=)|\.(?=\s|$)|$)/g)) {
    const text = clause[0].replace(/[;.!?\n]$/, "");
    const left = /^\s*/.exec(text)![0].length;
    let body = text.slice(left);
    const offset = clause.index! + left;
    if (!body.trim()) {
      if (question.slice(clause.index!, clause.index! + clause[0].length).replace(/[;.!?\n]$/, "").trim()) precedingFacts = null;
      continue;
    }
    const previous: SourceMeasurementFact[] | null = precedingFacts;
    precedingFacts = null;
    if (PREVIOUS_WITHDRAWAL.test(body)) {
      if (!previous) return null;
      for (const fact of previous) {
        if (fact.owner) {
          const owner = key(fact.owner);
          facts.set(owner, (facts.get(owner) ?? []).filter(current => current.start !== fact.start || current.end !== fact.end));
        } else ordered = ordered.filter(current => current.start !== fact.start || current.end !== fact.end);
      }
      continue;
    }
    const postfixed = POSTFIX_WITHDRAWAL.exec(body);
    if (postfixed) body = postfixed[1]!;
    let header: { 0: string } | null = null;
    let constructor = false, mode: "declare" | "replace" | "withdraw" | "exclude" = "declare";
    for (const object of options.constructors ?? []) {
      const noun = escape(object.noun), name = escape(object.name);
      header = new RegExp(`^(?:(?:now|currently|please|kindly|also|then)[ ,]+)*(?:draw|construct|sketch|show)\\s+(?:(?:a|the|labelled|labeled)\\s+)*${noun}(?:\\s+${name})?\\s+(?:with|having|where)(?:\\s+(?:the\\s+)?sides)?\\s+`, "i").exec(body)
        ?? new RegExp(`^(?:in|for|given)\\s+(?:the\\s+)?${noun}\\s+${name}\\s*[:,]\\s*`, "i").exec(body)
        ?? new RegExp(`^(?:(?:a|the)\\s+)?${noun}(?:\\s+${name})?\\s+(?:has|with|having)\\s+(?:sides\\s+)?`, "i").exec(body);
      if (header) {
        const action = /\b(?:draw|sketch|show)\b/i.exec(header[0]);
        const request = action ? requests.find(item => item.start === offset + action.index) : undefined;
        if (request?.scope === "retracted" || request?.scope === "negated" || request?.scope === "quoted") return null;
        constructor = true; break;
      }
    }
    if (!header) {
      const dataRequest = requests.find(request => request.start === offset && request.scope === "current" && ["label", "mark", "name"].includes(request.action));
      if (dataRequest) {
        header = /^(?:label|mark|name)\s+(?:(?:the\s+)?(?:positions?|points?|values?)\s+)?/i.exec(body);
        body = body.slice(0, dataRequest.end - offset).replace(/(?:,\s*)?(?:and|then|also)\s*$/i, "");
      }
      const retract = header ? null : RETRACT.exec(body);
      if (retract) {
        const rest = body.slice(retract[0].length);
        const quotation = /^(?:(?:the|a|an)\s+)?(?:student(?:'s)?\s+)?(?:quotation|quoted\s+(?:note|claim|statement))\s*/i.exec(rest);
        const object = quotation ?? /^(?:(?:the|a|an)\s+)?(?:previous\s+|above\s+|current\s+|earlier\s+|that\s+)?(?:note|claim|value|measurement|fact)\s*/i.exec(rest);
        const label = object?.[0] ?? "";
        mode = quotation || /\b(?:note|claim)\b/i.test(label) && !/\b(?:previous|above|current|earlier|that)\b/i.test(label) ? "exclude" : "withdraw";
        header = { 0: retract[0] + label };
      } else if (!header && (REPORT.test(body) || REPORTED.test(body) || /^(?:not|never)\s+/i.test(body))) {
        // Excluded prose has no positive fact witness, whatever its value.
        continue;
      } else if (!header) {
        header = /^(?:(?:now|currently|instead|actually)[ ,]+)?(?:(?:given|let|take|use|set|where|with)\s*[:,]?\s*)?(?=[A-Za-z][A-Za-z0-9_]*\s*=)/i.exec(body);
        if (header && /\b(?:now|currently|instead|actually|take|use|set)\b/i.test(header[0])) mode = "replace";
      }
    }
    if (!header) { if (relevant(body) || SCOPE_QUALIFICATION.test(body)) return null; continue; }
    if (postfixed && mode !== "exclude") mode = "withdraw";
    const values = readList(question, body.slice(header[0].length), offset + header[0].length);
    if (!values) {
      if (relevant(body) || mode === "withdraw") return null;
      continue;
    }
    if (values.some(value => !value.owner)) {
      if (!constructor || mode !== "declare" || ordered.length || facts.size) return null;
      ordered = values; precedingFacts = values; continue;
    }
    if (ordered.length) return null;
    for (const value of values) {
      const owner = key(value.owner), current = facts.get(owner) ?? [];
      if (mode === "exclude") continue;
      if (mode === "withdraw") {
        facts.set(owner, current.filter(fact => fact.value !== value.value || fact.unit !== value.unit));
      } else if (mode === "replace") facts.set(owner, [value]);
      else {
        if (current.some(fact => fact.value !== value.value || fact.unit !== value.unit)) return null;
        facts.set(owner, [...current, value]);
      }
    }
    if (mode === "declare" || mode === "replace") precedingFacts = values;
  }
  return { facts: [...facts.values()].flat(), ordered };
}
