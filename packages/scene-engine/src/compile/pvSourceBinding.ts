import type { SceneDocument, SceneIssue } from "../types";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { evaluatePvProcessConstruction } from "./pvProcessGeometry";
import { pressureCanonical, volumeCanonical, PRESSURE_FACTORS, VOLUME_FACTORS } from "./thermodynamicsGeometry";

type Law = "isobar" | "isochor" | "isotherm" | "adiabat";
type SourceEdge = { from: string; to: string; kind: Law; text: string };
const NAME = "[A-Za-z](?:_?\\d{1,2})?";
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const LAW = "isobar(?:ic)?|isochor(?:ic)?|isotherm(?:al)?|adiabat(?:ic)?";
const UNIT = "kPa|Pa|bar|cm(?:\\^?3)|m(?:\\^?3)|L";
function identity(value: string): string { return value.replace(/^([A-Za-z])_?(\d+)$/, "$1_$2"); }
function law(value: string): Law { return value.toLowerCase().replace(/(?:ic|al)$/, "") as Law; }
function lawSet(text: string): Set<Law> { return new Set([...text.matchAll(new RegExp(`\\b(${LAW})\\b`, "gi"))].map((match) => law(match[1]!))); }
function normalized(text: string): string { return text.replace(/³/g, "^3").normalize("NFKC").replace(/−/g, "-"); }
function close(a: number, b: number): boolean { return Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b)); }
function fail(message: string): never { throw new Error(message); }
function clauseEnd(text: string, start: number): number {
  const end = /[;!?]|\.(?!\d)/g; end.lastIndex = start;
  return end.exec(text)?.index ?? text.length;
}
function positivePrefix(text: string, start: number): boolean {
  const before = text.slice(0, start).split(/[;!?:]|\.(?!\d)/).at(-1)!.trim();
  return /^(?:(?:please\s+)?(?:show|plot|draw|sketch|compare|explain|describe|illustrate)\s+(?:(?:an?|the)\s*)?)?$/i.test(before);
}
function positiveRequest(text: string): boolean {
  // This first slice reads a controlled positive comparison, not arbitrary
  // discourse about a law (disproving a claim is not asserting that claim).
  const request = text.trim().replace(/^for an ideal[- ]gas[, :]\s*/i, "");
  return /^(?:(?:please\s+)?(?:show|plot|draw|sketch|compare|explain|describe|illustrate)\b|what\s+(?:is|are)\b)/i.test(request);
}
function supportedVocabulary(text: string, physical: boolean): boolean {
  const words = new Set(("please show plot draw sketch compare explain describe illustrate what is are a an the of for and all four ideal gas thermodynamic process processes schematic schematically from to between named state states expansion compression reversible pressure volume diagram chart graph same on with as isobar isobaric isochor isochoric isotherm isothermal adiabat adiabatic" + (physical ? " at has pa kpa bar cm gamma" : "")).split(" "));
  return (text.toLowerCase().match(/[a-z]+(?:_?\d{1,2})?/g) ?? []).every((word) => words.has(word) || /^[a-z](?:_?\d{1,2})?$/.test(word));
}
function stateFacts(text: string): Map<string, { pressureSI: number; volumeSI: number }> {
  const starts = [...text.matchAll(new RegExp(`\\b(?:state\\s+)?(${NAME})\\s*(?:(?:is|at|has|with)\\b|:)\\s*`, "g"))];
  const result = new Map<string, { pressureSI: number; volumeSI: number }>();
  for (const [index, match] of starts.entries()) {
    const start = match.index! + match[0].length;
    const nextNamedDirection = new RegExp(`\\b(?:from|to)\\s+${NAME}\\b`).exec(text.slice(start));
    const end = Math.min(starts[index + 1]?.index ?? text.length, clauseEnd(text, start), nextNamedDirection ? start + nextNamedDirection.index : text.length);
    const values = [...text.slice(start, end).matchAll(new RegExp(`(${NUMBER})\\s*(${UNIT})(?![A-Za-z\\d])`, "gi"))];
    const pressures: number[] = [], volumes: number[] = [];
    for (const value of values) {
      const p = pressureCanonical(value[2]!); const v = volumeCanonical(value[2]!.replace(/^(cm|m)3$/i, "$1^3"));
      if (p) pressures.push(Number(value[1]) * PRESSURE_FACTORS[p]);
      if (v) volumes.push(Number(value[1]) * VOLUME_FACTORS[v]);
    }
    if (!pressures.length && !volumes.length) continue;
    if (pressures.length !== 1 || volumes.length !== 1 || ![...pressures, ...volumes].every((value) => Number.isFinite(value) && value > 0)) fail("Each physical named-state clause must specify one positive pressure and one positive volume");
    const id = identity(match[1]!); const value = { pressureSI: pressures[0]!, volumeSI: volumes[0]! }; const prior = result.get(id);
    if (prior && (!close(prior.pressureSI, value.pressureSI) || !close(prior.volumeSI, value.volumeSI))) fail("Repeated named-state source facts contradict one another");
    result.set(id, value);
  }
  return result;
}
function sourceEdges(text: string): SourceEdge[] {
  const result: SourceEdge[] = [];
  const direct = new RegExp(`\\b(${NAME})\\s*(?:to|->|→)\\s*(${NAME})\\s*(?:(?:is|follows|undergoes)\\s+|:\\s*)(?:an?\\s+)?(?:reversible\\s+)?(${LAW})\\b`, "g");
  for (const match of text.matchAll(direct)) if (positivePrefix(text, match.index!)) result.push({ from: identity(match[1]!), to: identity(match[2]!), kind: law(match[3]!), text: text.slice(match.index, clauseEnd(text, match.index! + match[0].length)) });
  const prefix = new RegExp(`\\b(${LAW})\\s+(?:(?:ideal[- ]gas|reversible|expansion|compression|process|schematically)\\s+)*from\\s+(${NAME})\\b`, "g");
  for (const match of text.matchAll(prefix)) {
    if (!positivePrefix(text, match.index!)) continue;
    const start = match.index! + match[0].length; const tail = text.slice(start, Math.min(start + 240, clauseEnd(text, start)));
    const to = new RegExp(`\\bto\\s+(${NAME})\\b`).exec(tail);
    if (to && lawSet(tail.slice(0, to.index)).size === 0) result.push({ from: identity(match[2]!), to: identity(to[1]!), kind: law(match[1]!), text: text.slice(match.index, clauseEnd(text, start)) });
  }
  const unique = new Map<string, SourceEdge>();
  for (const edge of result) {
    const key = `${edge.from}/${edge.to}`; const prior = unique.get(key);
    if (prior && prior.kind !== edge.kind) fail("A directed source process has conflicting laws");
    if (prior && prior.text !== edge.text) fail("Repeated source processes are ambiguous");
    unique.set(key, edge);
  }
  return [...unique.values()];
}
function gammaIn(text: string): number | undefined {
  const matches = [...text.matchAll(new RegExp(`(?:\\bgamma\\b|γ)\\s*(?:=|is|of)?\\s*(${NUMBER})(?![\\d.])`, "gi"))];
  if (matches.length !== 1) return undefined;
  const value = Number(matches[0]![1]); return Number.isFinite(value) ? value : undefined;
}

/** A bounded mathematical source reader, never a topic router or an ink producer. */
export function validatePvSourceBinding(document: SceneDocument, question: string, plan: TurnPlanV3 | null = null): SceneIssue[] {
  const construction = document.constructions.find((candidate) => candidate.operator === "pv_process");
  if (!construction) return [];
  try {
    const text = normalized(question);
    // Unknown/negative/conditional scope is not positive authority for a path.
    if (/\b(?:no|not|never|neither|without|excluding|except|avoid|cannot|can't|doesn't|lacks|absence|absent|wrong|either|unless|if|hypothetical|would|irreversible|rather than|or|isn't|aren't)\b/i.test(text) || new RegExp(`\\bnon[- ]?(?:${LAW})\\b`, "i").test(text)) fail("Negated, conditional or alternative P-V source statements need a supported explicit positive form");
    if (/\b(?:non[- ]ideal|real[- ]gas|van der waals)\b/i.test(text)) fail("The P-V curve model does not prove non-ideal-gas source paths");
    const plot = evaluatePvProcessConstruction(construction.inputs, document)[0]!.pvPlot;
    const requested = lawSet(text); const drawn = new Set(plot.processes.map((process) => process.kind));
    if (!requested.size || requested.size !== drawn.size || [...requested].some((kind) => !drawn.has(kind))) fail("P-V process laws must exactly match those explicitly requested in the actual question");
    const planLaws = lawSet([...(plan?.lawIds ?? []), ...(plan?.qualitativeClaims ?? []).filter((claim) => claim.expected !== false).map((claim) => claim.claim)].join(" ").replace(/_/g, " "));
    if ([...planLaws].some((kind) => !requested.has(kind))) fail("P-V source and authoritative plan disagree about the process laws");
    const edges = sourceEdges(text);
    const namedPairs = [...text.matchAll(new RegExp(`\\b(${NAME})\\s*(?:to|->|→)\\s*(${NAME})\\b`, "g"))]
      .filter((pair) => !(pair[1] === "L" && new RegExp(`${NUMBER}\\s*$`, "i").test(text.slice(0, pair.index))));
    if (namedPairs.some((pair) => !edges.some((edge) => edge.from === identity(pair[1]!) && edge.to === identity(pair[2]!)))) fail("Every source named-state process must have a supported explicit law");
    if (edges.length && (edges.length !== plot.processes.length || plot.processes.some((process) => !edges.some((edge) => edge.from === process.from && edge.to === process.to && edge.kind === process.kind)))) fail("P-V directed named-state processes disagree with the actual question");
    if (!edges.length && new RegExp(`\\b${NAME}\\s*(?:to|->|→)\\s*${NAME}\\b`).test(text)) fail("Named P-V process wording is unsupported; state each directed law explicitly");
    if (plot.mode === "physical") {
      if (!supportedVocabulary(text, true)) fail("Physical P-V source contains unsupported statement scope; use explicit positive named-state and law clauses");
      if (plot.processes.some((process) => process.kind === "isotherm" || process.kind === "adiabat") && !/\bideal[- ]gas\b/i.test(text)) fail("Physical isotherms/adiabats require an explicitly ideal-gas source model");
      if (!edges.length) fail("Physical P-V processes require explicit directed named-state source laws");
      const facts = stateFacts(text);
      if (facts.size !== plot.states.length) fail("Physical P-V plots require explicit pressure and volume source facts for every named state");
      for (const state of plot.states) {
        const source = facts.get(state.id);
        if (!source || !close(source.pressureSI, state.pressureSI) || !close(source.volumeSI, state.volumeSI)) fail("P-V pressure/volume values are assigned to the wrong source state");
      }
      const adiabats = plot.processes.filter((process) => process.kind === "adiabat");
      for (const process of adiabats) {
        const edge = edges.find((candidate) => candidate.from === process.from && candidate.to === process.to)!;
        if (!/\breversible\b/i.test(edge.text) && !/\breversible\s+ideal[- ]gas\b/i.test(text)) fail("PV^gamma physical authority requires an explicitly reversible ideal-gas adiabat");
        const gamma = gammaIn(edge.text);
        if (gamma === undefined || !close(gamma, process.physicalProcess.exponent!)) fail("Every physical adiabat needs its explicit source gamma bound to that directed process");
      }
    } else {
      if (!positiveRequest(text) || !supportedVocabulary(text, false)) fail("Conceptual P-V source needs a supported explicit positive comparison request");
      if (new RegExp(`${NUMBER}\\s*(?:${UNIT})(?![A-Za-z\\d])`, "i").test(text) || gammaIn(text) !== undefined) fail("A physical P-V source cannot be promoted to an unconstrained conceptual plot");
    }
    const globalExpansion = /\bexpansion\b/i.test(text), globalCompression = /\bcompression\b/i.test(text);
    for (const process of plot.processes) {
      const edge = edges.find((candidate) => candidate.from === process.from && candidate.to === process.to);
      const scope = edge?.text ?? text;
      const expansion = /\bexpansion\b/i.test(scope), compression = /\bcompression\b/i.test(scope);
      const direction = plot.states.find((state) => state.id === process.to)!.volume - plot.states.find((state) => state.id === process.from)!.volume;
      if (expansion && compression || expansion && direction <= 0 || compression && direction >= 0) fail("P-V process direction contradicts the source expansion/compression");
    }
    if (!edges.length && globalExpansion && globalCompression) fail("Mixed process directions require explicit named-state laws");
    return [];
  } catch (error) {
    return [{ code: "pv_source_unproved", severity: "fatal", entityIds: construction.outputs, message: error instanceof Error ? error.message : "P-V source binding is unsupported" }];
  }
}
