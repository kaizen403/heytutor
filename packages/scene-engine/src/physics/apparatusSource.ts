/** Apparatus is a source fact, not a consequence of a chapter/family name. */
import { parseChemistryScalar, readChemistryLiteral, readChemistryQuantityDeclaration } from "../chemistry/quantityReader";
import { lengthAfterInMetres } from "../archetypes/slots";

interface Span { start: number; end: number }
function positiveDeclaration(question: string, start: number, end?: number): boolean {
  const prefix = question.slice(0, start).split(/[;!?]|\.(?!\d)|\bbut\b/i).at(-1) ?? "";
  if (/\b(?:not|no|without|excluding|background|reference|unrelated)\b/i.test(prefix)) return false;
  return end === undefined || !/^\s+(?:(?:is|are|was|were)\s+)?(?:not\b|absent\b|excluded\b|missing\b)/i.test(question.slice(end));
}
export interface ApertureSource {
  question: string; kind: "single_slit" | "double_slit"; slitCount: 1 | 2; spans: Span[];
}

/** The existing optics length operator owns millimetres. The chemistry
 * reader deliberately has no mm unit; this adapter proves the complete
 * original scalar and local unit before using that existing conversion. */
function youngSeparationSpans(question: string): Span[] | null {
  const readings: Array<{ value: number; span: Span }> = [];
  for (const cue of question.matchAll(/slit[- ]separation/gi)) {
    if (!positiveDeclaration(question, cue.index)) return null;
    const payloadStart = cue.index + cue[0].length;
    const tail = question.slice(payloadStart);
    const delimiter = /[;,!?]|\.(?!\d)|\b(?:and|with|but|while|whereas)\b/i.exec(tail);
    const end = payloadStart + (delimiter?.index ?? tail.length);
    const declared = readChemistryQuantityDeclaration({ question, after: /slit[- ]separation/, within: { start: cue.index, end },
      dimension: "length", targetUnit: "m", owner: "Young slit separation" });
    if (declared.state === "valid") readings.push({ value: declared.reading.value, span: declared.reading.source.span });
    else {
      const payload = question.slice(payloadStart, end);
      const mm = /^\s*(?:(?:is|of|equals?|equal to|[=:])\s*)?(.+?)\s*(mm)\s*$/i.exec(payload);
      if (!mm) return null;
      const scalar = mm[1]!.trim(), start = payloadStart + payload.indexOf(mm[1]!) + mm[1]!.indexOf(scalar);
      const parsed = parseChemistryScalar(question, { start, end: start + scalar.length });
      const value = lengthAfterInMetres(question.slice(cue.index, end), /^slit[- ]separation/);
      if (!parsed.ok || !(parsed.reading > 0) || value === null || !(value > 0)) return null;
      readings.push({ value, span: { start, end: payloadStart + payload.lastIndexOf(mm[2]!) + mm[2]!.length } });
    }
  }
  if (!readings.length || !(readings[0]!.value > 0) || readings.some(reading => reading.value !== readings[0]!.value)) return null;
  return readings.map(reading => reading.span);
}

/** A positive actual slit noun supplies its count. A diffraction relation,
 * excluded apparatus or unowned count cannot stand in for a slit source. */
export function readApertureSource(question: string): ApertureSource | null {
  const spans: Span[] = [], counts = new Set<number>();
  for (const match of question.matchAll(/\b(single|one|double|two|three|four|\d+)\s*[- ]\s*slits?\b/gi)) {
    const start = match.index, end = start + match[0].length;
    const prefix = question.slice(0, start).split(/[;!?]|\.(?!\d)|\b(?:but|and\s+(?:draw|show|sketch))\b/i).at(-1) ?? "";
    if (/\b(?:not|no|without|excluding|background|reference)\b/i.test(prefix)) continue;
    const suffix = question.slice(end).split(/[;!?]|\.(?!\d)/)[0] ?? "";
    if (/^\s+(?:is|are)\s+(?:not|absent|excluded)\b/i.test(suffix)) continue;
    const count = ({ single: 1, one: 1, double: 2, two: 2, three: 3, four: 4 } as Record<string, number>)[match[1]!.toLowerCase()] ?? Number(match[1]);
    counts.add(count); spans.push({ start, end });
  }
  // Young's specifically requested slit apparatus names the existing
  // two-aperture operator. Its separation must still be supplied/read whole;
  // a named topic or background mention contributes no count authority.
  for (const request of question.matchAll(/\b(?:draw|show|sketch|represent)\s+(?:only\s+)?(?:the\s+)?Young(?:'s)?\s+(?:(?:slit|interference)\s+)?(?:apparatus|setup|experiment)\b/gi)) {
    if (!positiveDeclaration(question, request.index)) continue;
    const separation = youngSeparationSpans(question);
    if (!separation) continue;
    counts.add(2); spans.push({ start: request.index, end: request.index + request[0].length }, ...separation);
  }
  if (counts.size !== 1) return null;
  const count = [...counts][0]!;
  return count === 1 || count === 2 ? { question, kind: count === 1 ? "single_slit" : "double_slit", slitCount: count, spans } : null;
}

export interface CircuitComponent { symbol: string; value: number | null }
export interface TwoLoopSource {
  question: string; left: CircuitComponent; right: CircuitComponent; shared: CircuitComponent;
  leftSource: CircuitComponent; rightSource: CircuitComponent; positiveTerminal: "top" | "bottom"; spans: Span[];
}

/** Applicability only: incomplete source topology cannot fall through into a
 * different stock network. This never supplies nodes, components or values. */
export function twoLoopTopologyClaimed(question: string): boolean {
  return [...question.matchAll(/\btwo[- ]loops?\s+(?:circuit|network)\b/gi)].some(match => positiveDeclaration(question, match.index))
    || ["left", "right"].every(side => [...question.matchAll(new RegExp(`\\b${side}\\s+loop\\s+(?:contains|includes|consists\\s+of)\\b`, "gi"))]
      .some(match => positiveDeclaration(question, match.index)));
}

/** Loop membership and a shared branch are independent source operators.
 * Numeric assignments belong to the actual component, never mention order. */
export function readTwoLoopTopology(question: string): TwoLoopSource | null {
  const spans: Span[] = [];
  const loopMatches = [...question.matchAll(/\b(left|right)\s+loop\s+(?:contains|includes|consists\s+of)\s+([^;!?]+?)(?=\.(?!\d)|[;!?]|$)/gi)];
  if (loopMatches.length !== 2 || new Set(loopMatches.map(match => match[1]!.toLowerCase())).size !== 2) return null;
  if (loopMatches.some(match => !positiveDeclaration(question, match.index))) return null;
  const sharedMatches = [...question.matchAll(/\bshared\s+(?:middle\s+)?(?:resistor\s+)?(R\d+)\b/gi)];
  if (sharedMatches.some(match => !positiveDeclaration(question, match.index, match.index + match[0].length))) return null;
  spans.push(...sharedMatches.map(match => ({ start: match.index, end: match.index + match[0].length })));
  const sharedNames = sharedMatches.map(match => match[1]!);
  if (!sharedNames.length || new Set(sharedNames).size !== 1) return null;
  const sharedName = sharedNames[0]!;
  const polarity = [...question.matchAll(/\bboth\s+(?:batter(?:y|ies)|sources?)\s+(?:(?:have\s+)?their\s+)?positive\s+terminals\s+(?:are\s+)?at\s+the\s+(top|bottom)\b/gi)];
  if (!polarity.length || new Set(polarity.map(match => match[1]!.toLowerCase())).size !== 1) return null;
  if (polarity.some(match => !positiveDeclaration(question, match.index, match.index + match[0].length))) return null;
  spans.push(...polarity.map(match => ({ start: match.index, end: match.index + match[0].length })));
  const resistors = new Map<string, CircuitComponent>();
  const loops = new Map<string, { resistor: CircuitComponent; source: CircuitComponent }>();
  for (const loop of loopMatches) {
    const side = loop[1]!.toLowerCase(), argument = loop[2]!;
    const argumentStart = loop.index + loop[0].indexOf(argument);
    const members: CircuitComponent[] = [], sources: CircuitComponent[] = [];
    let cursor = 0;
    for (const item of argument.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean)) {
      const start = argumentStart + argument.indexOf(item, cursor); cursor = start - argumentStart + item.length;
      const resistor = /^(?:(?:the|same)\s+)*(?:shared\s+(?:middle\s+)?)?(?:resistor\s+)?(R\d+)(?:\s*=\s*(.+?)\s*(ohms?|Ω))?$/i.exec(item.trim());
      if (resistor) {
        const name = resistor[1]!;
        let value: number | null = null;
        if (resistor[2] !== undefined) {
          const scalarStart = start + item.indexOf(resistor[2]);
          const scalar = parseChemistryScalar(question, { start: scalarStart, end: scalarStart + resistor[2].length });
          if (!scalar.ok || !(scalar.reading > 0)) return null;
          value = scalar.reading;
        }
        const prior = resistors.get(name);
        if (prior?.value !== null && value !== null && prior?.value !== undefined && prior.value !== value) return null;
        const component = { symbol: name, value: value ?? prior?.value ?? null };
        resistors.set(name, component); members.push(component);
      } else {
        const symbolic = /^source\s+(E\d+)$/i.exec(item.trim());
        const numeric = /^(?:an?\s+)?(.+?)\s+(?:ideal\s+)?battery$/i.exec(item.trim());
        if (symbolic) sources.push({ symbol: symbolic[1]!, value: null });
        else if (numeric) {
          const payload = numeric[1]!, unit = /\s*(?:V|volts?)$/i.exec(payload);
          if (!unit) return null;
          const scalar = payload.slice(0, unit.index).trim();
          const scalarStart = start + item.indexOf(payload) + payload.indexOf(scalar);
          const literal = readChemistryLiteral({ question, scalarSpan: { start: scalarStart, end: scalarStart + scalar.length }, dimension: "potential", targetUnit: "V" });
          if (!literal.ok || !(literal.reading.value > 0)) return null;
          sources.push({ symbol: side === "left" ? "E1" : "E2", value: literal.reading.value });
        } else return null;
      }
      spans.push({ start, end: start + item.length });
    }
    const own = members.filter(member => member.symbol !== sharedName);
    if (own.length !== 1 || sources.length !== 1 || members.filter(member => member.symbol === sharedName).length > 1) return null;
    loops.set(side, { resistor: own[0]!, source: sources[0]! });
  }
  const left = loops.get("left")!, right = loops.get("right")!;
  if (left.resistor.symbol === right.resistor.symbol || left.source.symbol === right.source.symbol || resistors.size > 3) return null;
  // A shared-middle declaration binds the branch to both explicitly described
  // loops even when their local lists omit its repeated name.
  const shared = resistors.get(sharedName) ?? { symbol: sharedName, value: null };
  const known = new Set([left.resistor.symbol, right.resistor.symbol, sharedName, left.source.symbol, right.source.symbol]);
  if ([...question.matchAll(/\b[RE]\d+\b/g)].some(match => !known.has(match[0]))) return null;
  // Every component reference belongs to a parsed member/shared head.
  // Unsupported separate declarations are a refusal, never ignored facts.
  const owned = (start: number, end: number): boolean => spans.some(span => start >= span.start && end <= span.end);
  if ([...question.matchAll(/\b[RE]\d+\b/gi)].some(match => !owned(match.index, match.index + match[0].length))
    || [...question.matchAll(/Ω|\bohms?\b|\bV\b|\bvolts?\b/g)].some(match => !owned(match.index, match.index + match[0].length))) return null;
  return { question, left: left.resistor, right: right.resistor, shared, leftSource: left.source, rightSource: right.source,
    positiveTerminal: polarity[0]![1]!.toLowerCase() as "top" | "bottom", spans };
}

export interface CircuitLawExampleSource {
  question: string;
  lawSet: Array<"current" | "voltage">;
  requestSpans: Span[];
}

/** Complete comparison of one source roster in two distinct arrangements.
 * The existing resistor reader owns its numbers. This ledger only binds the
 * count/topologies and each requested view/result; unknown clauses refuse. */
export function readSeriesParallelSourceComparison(question: string): {
  count: number; rosterSpan: Span; scalarSpan: Span; unitSpan: Span;
  rawValue: number; rawUnit: string; resistanceOhm: number;
} | null {
  const counts: Record<string, number> = { two: 2, three: 3, four: 4, 2: 2, 3: 3, 4: 4 };
  let roster: { count: number; rosterSpan: Span; scalarSpan: Span; unitSpan: Span;
    rawValue: number; rawUnit: string; resistanceOhm: number } | null = null;
  let views = false, equivalents = false;
  for (const clause of question.matchAll(/(?:\.(?=\d)|[^.;!?])+/g)) {
    const raw = clause[0], text = raw.trim();
    const declared = /^(two|three|four|[2-4])\s+(\d+(?:\.\d+)?)\s+(ohms?|Ω|kΩ)\s+resistors\s+(?:are\s+connected\s+)?in\s+(?:series\s+and\s+(?:in\s+)?parallel|parallel\s+and\s+(?:in\s+)?series)$/i.exec(text);
    if (declared) {
      if (roster) return null;
      const start = clause.index + raw.indexOf(text);
      const scalarStart = start + text.indexOf(declared[2]!, declared[1]!.length);
      const scalarSpan = { start: scalarStart, end: scalarStart + declared[2]!.length };
      const parsed = parseChemistryScalar(question, scalarSpan);
      const rawUnit = declared[3]!;
      if (!parsed.ok || !(parsed.reading > 0) || !["ohm", "ohms", "Ω", "kΩ"].includes(rawUnit)) return null;
      const unitStart = start + text.indexOf(rawUnit, scalarSpan.end - start);
      roster = { count: counts[declared[1]!.toLowerCase()]!, rosterSpan: { start, end: start + text.length },
        scalarSpan, unitSpan: { start: unitStart, end: unitStart + rawUnit.length }, rawValue: parsed.reading,
        rawUnit, resistanceOhm: parsed.reading * (rawUnit === "kΩ" ? 1000 : 1) };
      continue;
    }
    const argument = text.replace(/^(?:Using|Apply)\s+Kirchhoff(?:['’]s)?\s+laws\s*,?\s*(?:and\s+)?/i, "");
    for (const request of argument.split(/\s+and\s+(?=(?:draw|sketch|find|calculate)\b)/i)) {
      if (/^(?:find|calculate)\s+both\s+equivalent\s+resistances$/i.test(request)) equivalents = true;
      else if (/^(?:draw|sketch)\s+(?:both|each)\s+(?:circuits?|arrangements)(?:\s+with\s+their\s+equivalent\s+resistances)?$/i.test(request)) {
        views = true;
        if (/with\s+their\s+equivalent\s+resistances$/i.test(request)) equivalents = true;
      } else return null;
    }
  }
  return roster && views && equivalents ? roster : null;
}
type CircuitLawExampleOutcome = { status: "not_applicable" } | { status: "declined" }
  | { status: "example"; source: CircuitLawExampleSource };

/** A law illustration chooses an explicitly qualified example. Every clause
 * must request that illustration or its symbolic marks: no supplied network,
 * current calculation or unread component is inferred from the law's name. */
export function readCircuitLawExample(question: string): CircuitLawExampleOutcome {
  if (!/\bKirchhoff(?:['’]s)?\b/i.test(question)) return { status: "not_applicable" };
  const requestSpans: Span[] = [], lawSet = new Set<"current" | "voltage">();
  const depiction = "(?:(?:a|an|the)\\s+)?(?:(?:labelled|labeled|illustrative|symbolic|example|suitable|standard)\\s+)*(?:diagram|circuit|illustration|setup)";
  const marks = /^(?:(?:a|an|the)\s+)?(?:junction|(?:closed\s+)?loop|(?:circuit\s+)?symbols|(?:labelled\s+|labeled\s+)?terminals(?:\s+of\s+the\s+components)?|source\s+polarities|reference\s+current\s+directions)$/i;
  const requests: Array<{ text: string; span: Span }> = [];
  for (const clause of question.matchAll(/[^.;!?]+/g)) {
    // A coordinated mark verb starts a separate owned request. Only this
    // positive conjunction is consumed; unknown coordinated actions remain
    // in the original argument and fail its complete grammar.
    const cuts = [...clause[0].matchAll(/\s+and\s+(?=(?:label|mark|show)\s+)/gi)];
    let start = 0;
    for (const cut of [...cuts, { index: clause[0].length, 0: "" }]) {
      const raw = clause[0].slice(start, cut.index), text = raw.trim();
      if (text) {
        const offset = clause.index + start + raw.indexOf(text);
        requests.push({ text, span: { start: offset, end: offset + text.length } });
      }
      start = cut.index + cut[0].length;
    }
  }
  for (const { text, span } of requests) {
    // This is a source constraint, not a negation exemption for any drawing.
    if (/^Do\s+not\s+assign\s+numerical\s+values$/i.test(text)) { requestSpans.push(span); continue; }
    const request = /^(draw|show|sketch|illustrate|represent|explain|label|mark)\s+(.+)$/i.exec(text);
    if (!request) return { status: "declined" };
    let argument = request[2]!;
    const law = /\bKirchhoff(?:['’]s)?\s+(?:(?:current|voltage)\s+(?:and\s+(?:current|voltage)\s+)?laws?|laws?|rules?)(?:\s+and\s+(?:(?:Kirchhoff(?:['’]s)?\s+)?(?:current|voltage)\s+laws?))?(?:\s+and\s+their\s+applications)?/i.exec(argument);
    if (law) {
      const hasCurrent = /\bcurrent\b/i.test(law[0]), hasVoltage = /\bvoltage\b/i.test(law[0]);
      if (hasCurrent || !hasVoltage) lawSet.add("current");
      if (hasVoltage || !hasCurrent) lawSet.add("voltage");
      argument = `${argument.slice(0, law.index)}LAW${argument.slice(law.index + law[0].length)}`;
      const lawView = new RegExp(`^(?:${depiction}\\s+(?:for|of|to\\s+explain)\\s+LAW|LAW(?:\\s+with\\s+${depiction})?)$`, "i");
      if (!lawView.test(argument) || /^(?:label|mark)$/i.test(request[1]!)) return { status: "declined" };
    } else {
      // Positive independently parsed mark list; an unknown coordinated object
      // or verb cannot disappear into an allowed-word mask.
      const named = /^(?:the|any)\s+named\s+/i.test(argument);
      const memberText = argument.replace(/\s+on\s+the\s+figure$/i, "").replace(/^(?:the|any)\s+named\s+/i, "");
      const members = memberText.split(/\s*,\s*(?:or\s+)?|\s+(?:and|or)\s+/i);
      if (!/^(?:show|label|mark)$/i.test(request[1]!) || !members.length
        || members.some(member => !(marks.test(member) || named && /^(?:quantities|directions|levels|components)$/i.test(member)))) return { status: "declined" };
    }
    requestSpans.push(span);
  }
  return lawSet.size && requestSpans.length
    ? { status: "example", source: { question, lawSet: [...lawSet], requestSpans } }
    : { status: "declined" };
}
