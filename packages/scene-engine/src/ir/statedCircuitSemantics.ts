/**
 * Closed source/fact grammar for the ideal external DC binding contract.
 * This validates a source already selected by the existing circuit reader; it
 * neither routes topics nor constructs ink. Unconsumed clauses decline.
 */
import { readResistorTree, type ResistorTree } from "../archetypes/resistorTree";
import type { StatedCircuitSolution, CircuitValue } from "./statedCircuitAuthority";
import type { ProblemFact } from "./problemIR";

type LiteralReader = typeof import("./statedCircuitAuthority").readCircuitLiterals;
type Literal = ReturnType<LiteralReader>[number];
export interface CircuitAsk { unit: "ohm" | "A"; owner: "network" | "battery"; value: CircuitValue }
export interface CircuitSourceSemantics {
  tree: ResistorTree;
  asks: CircuitAsk[];
  literals: Literal[];
  source: { owner: "battery"; memberIds: string[] };
  meters: {
    ammeter?: { connection: "series"; targetId: "R1" };
    voltmeter?: { connection: "across"; targetId: "R1" };
  };
}
const clean = (text: string): string => text.trim().replace(/\s+/g, " ").replace(/[.?!]$/, "").trim();
const same = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
const ids = (tree: ResistorTree): string[] => tree.kind === "leaf" ? [`R${tree.index + 1}`] : tree.children.flatMap(ids);

function flatConnection(tree: ResistorTree, kind: string, members: string[]): boolean {
  if (tree.kind === "leaf") return false;
  return (tree.kind === kind && tree.children.every(child => child.kind === "leaf") &&
    tree.children.length === members.length && ids(tree).every(id => members.includes(id))) ||
    tree.children.some(child => flatConnection(child, kind, members));
}

/** A count names the members of one explicit flat combination. The legacy
 * resistor reader cannot expand repeated leaves; do not let it erase their
 * multiplicity while reading a valid grouping window. */
function networkCardinalityIsBound(network: string, tree: ResistorTree): boolean {
  const counts = [...network.matchAll(/\b(two|three|four)\b/gi)];
  if (!counts.length) return true;
  const declaration = /^(?:(?:a|an|the)\s+)?(series|parallel) combination of (two|three|four) resistors of (?=#0\b)/i.exec(network);
  if (!declaration || counts.length !== 1 || tree.kind === "leaf") return false;
  const count = { two: 2, three: 3, four: 4 }[declaration[2]!.toLowerCase() as "two" | "three" | "four"];
  return counts[0]!.index === declaration[0].toLowerCase().lastIndexOf(declaration[2]!.toLowerCase()) &&
    tree.kind === declaration[1]!.toLowerCase() && tree.children.length === count &&
    tree.children.every(child => child.kind === "leaf");
}

/** All request clauses must parse; a recognized first clause is insufficient. */
export function readCircuitAsks(text: string, solution: StatedCircuitSolution): CircuitAsk[] | null {
  const body = clean(text).replace(/^(?:find|calculate|compute|determine)\s+/i, "");
  const result: CircuitAsk[] = [];
  for (const part of body.split(/\s+and\s+/i)) {
    const clause = part.replace(/^the\s+/i, "");
    if (/^(?:equivalent|effective|total) resistance$/i.test(clause)) {
      result.push({ unit: "ohm", owner: "network", value: solution.equivalentResistance });
    } else if (/^(?:total current|current (?:drawn|supplied|delivered) (?:from|by) the (?:cell|battery)|current from the (?:cell|battery))$/i.test(clause) ||
      (solution.resistors.length === 1 && /^(?:current|current through the resistor)$/i.test(clause)) ||
      (solution.topology === "series" && /^current in the circuit$/i.test(clause))) {
      if (!solution.sourceCurrent) return null;
      result.push({ unit: "A", owner: "battery", value: solution.sourceCurrent });
    } else return null;
  }
  return result.length && new Set(result.map(row => row.owner)).size === result.length ? result : null;
}

/** The entire description, including the source and meter edges, is consumed. */
export function readCircuitSourceSemantics(question: string, solution: StatedCircuitSolution, readCircuitLiterals: LiteralReader): CircuitSourceSemantics | null {
  if (question.length > 8000) return null;
  const request = /\b(?:find|calculate|compute|determine)\s+/i.exec(question);
  if (!request) return null;
  const asks = readCircuitAsks(question.slice(request.index), solution);
  if (!asks) return null;
  const body = clean(question.slice(0, request.index));
  const literals = readCircuitLiterals(body);
  const rs = literals.filter(row => row.dimension === "resistance");
  const vs = literals.filter(row => row.dimension === "voltage");
  if (rs.length !== solution.resistors.length || vs.length !== 1 || literals.length !== rs.length + 1 ||
    rs.some((row, i) => !same(row.si, solution.resistors[i]!.resistance.value)) ||
    !solution.sourceVoltage || !same(vs[0]!.si, solution.sourceVoltage.value)) return null;
  // Mark exact literal spans so no unit or number is silently erased.
  let marked = body;
  for (const row of [...literals].reverse()) marked = marked.slice(0, row.start) + (row.dimension === "resistance" ? `#${rs.indexOf(row)}` : "@V") + marked.slice(row.end);
  const supply = /^(.*?)\s+(?:across|(?:is\s+)?connected (?:to|across))\s+(?:a|an|the)\s+@V\s+(cell|battery)(.*)$/i.exec(marked);
  if (!supply) return null;
  const network = supply[1]!.trim();
  const tail = supply[3]!.trim();
  let ammeterText: string | undefined, voltmeterText: string | undefined;
  if (tail) {
    // Single-load meters only. Their targets are physical identities, not
    // interchangeable equipotential objects.
    if (rs.length !== 1 || !/^with (?:an?|the) ammeter in series and (?:an?|the) voltmeter across the resistor$/i.test(tail)) return null;
    ammeterText = "ammeter in series";
    voltmeterText = "voltmeter across the resistor";
  }
  if (Boolean(solution.ammeter) !== Boolean(ammeterText) || Boolean(solution.voltmeter) !== Boolean(voltmeterText)) return null;
  let tree: ResistorTree | null;
  if (rs.length === 1) {
    if (!/^(?:a|an|the) #0 resistor(?: is)?$/i.test(network)) return null;
    tree = { kind: "leaf", index: 0 };
  } else {
    // The existing recursive grammar reads grouping. Check its complete
    // lexical envelope too: it intentionally reads only the resistance window.
    const envelope = /^(?:(?:a|an|the)\s+)?(?:(?:series|parallel) combination of (?:(?:two|three|four) resistors of )?)?#0\b/i;
    const lastLeaf = [...network.matchAll(/#[0-3]/g)].at(-1);
    if (!envelope.test(network) || !lastLeaf) return null;
    const suffix = network.slice(lastLeaf.index! + lastLeaf[0].length);
    if (!/^\s+resistors?(?:\s+(?:(?:is|are)\s+)?(?:(?:connected|joined|placed|arranged)\s+)?in (?:series|parallel))?$/i.test(suffix)) return null;
    const words = network.toLowerCase().match(/#\d|[a-z]+|[^\s]/g) ?? [];
    const allowed = new Set(["a", "an", "the", "resistor", "resistors", "is", "are", "connected", "joined", "placed", "arranged", "in", "series", "parallel", "and", "with", "this", "combination", "of", "two", "three", "four", ","]);
    if (words.some(word => !/^#[0-3]$/.test(word) && !allowed.has(word))) return null;
    // Restore literals for the existing parser. Prefix conversion is audited
    // above against the independently solved physical quantities.
    let restored = network;
    rs.forEach((row, i) => { restored = restored.replace(`#${i}`, `${row.si} ohm`); });
    tree = readResistorTree(restored);
    if (!tree || !networkCardinalityIsBound(network, tree)) return null;
    const groups: Array<{ kind: string; members: string[] }> = [];
    const visit = (node: ResistorTree): void => { if (node.kind !== "leaf") { groups.push({ kind: node.kind, members: ids(node) }); node.children.forEach(visit); } };
    visit(tree);
    if (groups.length !== solution.groups.length || groups.some(group => !solution.groups.some(actual => actual.kind === group.kind && actual.resistorIds.join(",") === group.members.join(",")))) return null;
  }
  return { tree, asks, literals, source: { owner: "battery", memberIds: ids(tree) }, meters: {
    ...(ammeterText ? { ammeter: { connection: "series", targetId: "R1" } as const } : {}),
    ...(voltmeterText ? { voltmeter: { connection: "across", targetId: "R1" } as const } : {}),
  } };
}

/** Bind a complete fact proposition, not selected words or its first request. */
export function bindCircuitFact(fact: ProblemFact, source: CircuitSourceSemantics, solution: StatedCircuitSolution, readCircuitLiterals: LiteralReader): string[] | null {
  const statement = clean(fact.statement), quote = clean(fact.evidence.quote);
  if (fact.kind === "requested") {
    const claim = readCircuitAsks(statement, solution), evidence = readCircuitAsks(quote, solution);
    const key = (ask: CircuitAsk) => `${ask.unit}:${ask.owner}`;
    return claim && evidence && claim.length === evidence.length && claim.every(ask => evidence.some(row => key(row) === key(ask)) && source.asks.some(row => key(row) === key(ask))) ? claim.map(row => row.owner) : null;
  }
  if (fact.kind === "assumption") {
    if (/^(?:the )?ammeter is ideal with zero (?:internal )?resistance$/i.test(statement)) return source.meters.ammeter && /\bammeter\b/i.test(quote) ? ["ammeter"] : null;
    if (/^(?:the )?voltmeter is ideal with infinite (?:internal )?resistance$/i.test(statement)) return source.meters.voltmeter && /\bvoltmeter\b/i.test(quote) ? ["voltmeter"] : null;
    if (/^(?:the )?(?:cell|battery) (?:has|is ideal with) negligible internal resistance$/i.test(statement)) return /\b(?:cell|battery)\b/i.test(quote) ? ["battery"] : null;
    if (/^(?:the )?resistors? obey Ohm['’]s law$/i.test(statement)) return /\bresistors?\b/i.test(quote) ? solution.resistors.map(row => row.id) : null;
    return null;
  }
  if (fact.kind !== "given") return null;
  const quantities = readCircuitLiterals(statement);
  let marked = statement;
  for (const row of [...quantities].reverse()) marked = marked.slice(0, row.start) + "@Q" + marked.slice(row.end);
  const resistorFact = /^(?:the )?(?:(first|second|third|fourth) )?resistor has resistance @Q$/i.exec(marked);
  if (resistorFact && quantities.length === 1 && quantities[0]!.dimension === "resistance") {
    const matches = solution.resistors.filter(row => same(row.resistance.value, quantities[0]!.si));
    const evidence = readCircuitLiterals(quote);
    if (matches.length !== 1 || evidence.length !== 1 || evidence[0]!.dimension !== "resistance" || !same(evidence[0]!.si, quantities[0]!.si) || !/resistor/i.test(quote)) return null;
    const ordinal = resistorFact[1]?.toLowerCase();
    if (ordinal && solution.resistors[["first", "second", "third", "fourth"].indexOf(ordinal)]?.id !== matches[0]!.id) return null;
    return [matches[0]!.id];
  }
  if (/^(?:the )?(?:cell|battery) (?:provides @Q|voltage is @Q)$/i.test(marked) && quantities.length === 1 && quantities[0]!.dimension === "voltage") {
    const evidence = readCircuitLiterals(quote);
    return evidence.length === 1 && /\b(?:cell|battery)\b/i.test(quote) && evidence[0]!.dimension === "voltage" && same(evidence[0]!.si, quantities[0]!.si) && same(quantities[0]!.si, solution.sourceVoltage!.value) ? ["battery"] : null;
  }
  if (/^(?:the )?ammeter (?:is )?(?:connected )?in series(?: with the resistor)?$/i.test(statement)) return source.meters.ammeter && /\bammeter (?:is )?(?:connected )?in series$/i.test(quote) ? ["ammeter", "R1"] : null;
  if (/^(?:the )?voltmeter (?:is )?(?:connected )?across the resistor$/i.test(statement)) return source.meters.voltmeter && /\bvoltmeter (?:is )?(?:connected )?across the resistor$/i.test(quote) ? ["voltmeter", "R1"] : null;
  const across = /^(?:the )?(series|parallel) combination is across (?:a|the) @Q (?:cell|battery)$/i.exec(marked);
  if (across && quantities.length === 1 && quantities[0]!.dimension === "voltage" && source.tree.kind === across[1]!.toLowerCase() && /\bacross\b/i.test(quote) && same(quantities[0]!.si, solution.sourceVoltage!.value)) return [...ids(source.tree), "battery"];
  const flat = /^(?:the )?(.+?) resistors are (?:connected|joined|placed|arranged) in (series|parallel)$/i.exec(marked);
  if (flat && /\b(?:connected|joined|placed|arranged) in (?:series|parallel)$/i.test(quote)) {
    let members: string[];
    if (flat[1] === "The" || flat[1]!.toLowerCase() === "the") members = ids(source.tree);
    else {
      if (!/^@Q(?: and @Q|, @Q|, and @Q)+$/.test(flat[1]!)) return null;
      if (quantities.some(row => row.dimension !== "resistance")) return null;
      members = quantities.flatMap(row => solution.resistors.filter(part => same(row.si, part.resistance.value)).map(part => part.id));
    }
    const kind = flat[2]!.toLowerCase();
    if (!new RegExp(`\\bin ${kind}$`, "i").test(quote) || new Set(members).size !== members.length) return null;
    return flatConnection(source.tree, kind, members) ? members : null;
  }
  // Generic flat statement with no explicit leaf list.
  const all = /^(?:the )?resistors are (?:connected|joined|placed|arranged) in (series|parallel)$/i.exec(statement);
  if (all && flatConnection(source.tree, all[1]!.toLowerCase(), ids(source.tree)) && new RegExp(`\\bin ${all[1]}$`, "i").test(quote)) return ids(source.tree);
  const nested = /^(?:the )?(series|parallel) combination is connected in (series|parallel) with (?:a|the) @Q resistor$/i.exec(marked);
  if (nested && quantities.length === 1 && quantities[0]!.dimension === "resistance" && source.tree.kind === nested[2]!.toLowerCase() && new RegExp(`connected in ${nested[2]} with (?:a|the)`, "i").test(quote)) {
    const children = source.tree.kind === "leaf" ? [] : source.tree.children;
    const group = children.find(node => node.kind === nested[1]!.toLowerCase());
    const leaf = children.find(node => node.kind === "leaf" && same(solution.resistors[node.index]!.resistance.value, quantities[0]!.si));
    return children.length === 2 && group && leaf ? ids(source.tree) : null;
  }
  return null;
}
